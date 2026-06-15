// ---------------------------------------------------------------------------
// Satori Dashboard — single admin summary RPC that powers the Satori-Cloud
// style overview page (Active users, world map, Top countries/cities,
// Ongoing/Scheduled experiment·live-event·message counts, events timeline).
//
// Everything is computed server-side in ONE call so the admin UI polls a
// single endpoint instead of fanning out to a dozen RPCs:
//   - "Live" signals (active users, geo, timeline, top events) come from the
//     event-debugger ring buffer (one storage read, never a scan).
//   - Counts come from the Satori config objects (experiments / live_events /
//     messages), reusing the same status logic the per-feature modules use.
//
// Admin-only. Geo fields (country/city) are stamped onto events at capture
// time by SatoriEventCapture; events without geo simply don't contribute to
// the map, which the UI renders as "No data available" (matches Satori).
// ---------------------------------------------------------------------------
namespace SatoriDashboard {

  var RING_COLLECTION = "satori_debugger";
  var RING_KEY = "recent_events";

  var MIN_5 = 5 * 60 * 1000;
  var HOUR = 60 * 60 * 1000;
  var DAY = 24 * HOUR;

  interface RingEvent {
    userId?: string;
    identityId?: string;
    name: string;
    timestamp: number;
    country?: string;
    city?: string;
    external?: boolean;
  }

  function toMs(ts: number): number {
    if (!ts) return 0;
    return ts < 100000000000 ? ts * 1000 : ts;
  }

  function uidOf(ev: RingEvent): string {
    return ev.userId || ev.identityId || "";
  }

  function topN(counts: { [key: string]: number }, n: number): { key: string; count: number }[] {
    var rows: { key: string; count: number }[] = [];
    for (var k in counts) rows.push({ key: k, count: counts[k] });
    rows.sort(function (a, b) { return b.count - a.count; });
    return rows.slice(0, n);
  }

  // ── Count helpers (status logic mirrors the per-feature modules) ──────────

  function experimentCounts(nk: nkruntime.Nakama, gameId?: string): { ongoing: number; scheduled: number; total: number } {
    var defs = ConfigLoader.loadSatoriConfigForGame<{ [id: string]: any }>(nk, "experiments", gameId, {});
    var now = Math.floor(Date.now() / 1000);
    var ongoing = 0, scheduled = 0, total = 0;
    for (var id in defs) {
      var d = defs[id]; total++;
      if (d.startAt && now < d.startAt) { scheduled++; continue; }
      if (d.status === "running" && (!d.endAt || now <= d.endAt)) ongoing++;
    }
    return { ongoing: ongoing, scheduled: scheduled, total: total };
  }

  function liveEventCounts(nk: nkruntime.Nakama, gameId?: string): { ongoing: number; scheduled: number; total: number } {
    var defs = ConfigLoader.loadSatoriConfigForGame<{ [id: string]: any }>(nk, "live_events", gameId, {});
    var now = Math.floor(Date.now() / 1000);
    var ongoing = 0, scheduled = 0, total = 0;
    for (var id in defs) {
      var d = defs[id]; total++;
      var startAt = d.startAt, endAt = d.endAt;
      if (d.recurrenceCron && d.recurrenceIntervalSec) {
        var interval = d.recurrenceIntervalSec || 86400;
        var duration = (d.endAt || 0) - (d.startAt || 0);
        var elapsed = now - (d.startAt || 0);
        if (elapsed >= 0) {
          var cycle = Math.floor(elapsed / interval);
          startAt = d.startAt + cycle * interval;
          endAt = startAt + duration;
        }
      }
      if (now < startAt) scheduled++;
      else if (now <= endAt) ongoing++;
    }
    return { ongoing: ongoing, scheduled: scheduled, total: total };
  }

  function messageCounts(nk: nkruntime.Nakama, gameId?: string): { scheduled: number; total: number } {
    var raw = ConfigLoader.loadSatoriConfigForGame<any>(nk, "messages", gameId, {});
    var defs = raw && raw.messages ? raw.messages : raw;
    var now = Math.floor(Date.now() / 1000);
    var scheduled = 0, total = 0;
    for (var id in defs) {
      var d = defs[id];
      if (!d || typeof d !== "object") continue;
      total++;
      if (d.scheduleAt && d.scheduleAt > now) scheduled++;
    }
    return { scheduled: scheduled, total: total };
  }

  // ── RPC ───────────────────────────────────────────────────────────────────

  // satori_dashboard_summary — Payload: { game_id? }
  function rpcSummary(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = RpcHelpers.gameId(data);

    var now = Date.now();
    var buf = Storage.readSystemJson<{ events: RingEvent[] }>(nk, RING_COLLECTION, RING_KEY);
    var events = (buf && buf.events) || [];

    // Distinct-user sets per window + counts.
    var users5m: { [u: string]: boolean } = {};
    var users1h: { [u: string]: boolean } = {};
    var users24h: { [u: string]: boolean } = {};
    var events24h = 0;
    var countryUsers: { [c: string]: { [u: string]: boolean } } = {};
    var cityUsers: { [c: string]: { [u: string]: boolean } } = {};
    var eventNameCounts: { [n: string]: number } = {};

    // 24 hourly buckets, index 0 = oldest hour, 23 = current hour.
    var buckets: number[] = [];
    for (var b = 0; b < 24; b++) buckets.push(0);
    var windowStart = now - DAY;

    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var t = toMs(ev.timestamp);
      if (t < windowStart || t > now) continue;
      var uid = uidOf(ev);

      events24h++;
      if (uid) users24h[uid] = true;
      if (t >= now - HOUR && uid) users1h[uid] = true;
      if (t >= now - MIN_5 && uid) users5m[uid] = true;

      eventNameCounts[ev.name] = (eventNameCounts[ev.name] || 0) + 1;

      var bucketIdx = 23 - Math.floor((now - t) / HOUR);
      if (bucketIdx >= 0 && bucketIdx < 24) buckets[bucketIdx]++;

      var cc = (ev.country || "").toUpperCase();
      if (cc && uid) {
        if (!countryUsers[cc]) countryUsers[cc] = {};
        countryUsers[cc][uid] = true;
      }
      var city = ev.city || "";
      if (city && uid) {
        if (!cityUsers[city]) cityUsers[city] = {};
        cityUsers[city][uid] = true;
      }
    }

    function distinctCount(set: { [u: string]: boolean }): number {
      return Object.keys(set).length;
    }

    var countryCounts: { [c: string]: number } = {};
    for (var cc2 in countryUsers) countryCounts[cc2] = distinctCount(countryUsers[cc2]);
    var cityCounts: { [c: string]: number } = {};
    for (var ci in cityUsers) cityCounts[ci] = distinctCount(cityUsers[ci]);

    var timeline: { hourMs: number; count: number }[] = [];
    for (var h = 0; h < 24; h++) {
      timeline.push({ hourMs: now - (23 - h) * HOUR, count: buckets[h] });
    }

    var topCountries = topN(countryCounts, 8).map(function (r) { return { country: r.key, users: r.count }; });
    var topCities = topN(cityCounts, 8).map(function (r) { return { city: r.key, users: r.count }; });
    var topEvents = topN(eventNameCounts, 8).map(function (r) { return { name: r.key, count: r.count }; });

    return RpcHelpers.successResponse({
      generatedAt: now,
      activeUsers5m: distinctCount(users5m),
      activeUsers1h: distinctCount(users1h),
      activeUsers24h: distinctCount(users24h),
      eventsLast24h: events24h,
      ringBufferSize: events.length,
      timeline: timeline,
      topCountries: topCountries,
      topCities: topCities,
      topEvents: topEvents,
      geoAvailable: topCountries.length > 0,
      experiments: experimentCounts(nk, gameId),
      liveEvents: liveEventCounts(nk, gameId),
      messages: messageCounts(nk, gameId)
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_dashboard_summary", rpcSummary);
  }
}
