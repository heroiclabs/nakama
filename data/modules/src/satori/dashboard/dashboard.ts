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

  // Legacy analytics pipeline collections — the real game telemetry sink.
  // The Unity/web clients send their events to `analytics_log_event`, which
  // maintains durable per-day aggregate docs here. This is the SAME data that
  // powers nakama.intelli-verse-x.ai/analytics.htm, so the IVX console reads
  // straight from it instead of scanning the sparse `satori_events` ring.
  var LEGACY_DAU = "analytics_dau";          // key: dau_platform_<date> | dau_<gameId>_<date>
  var LEGACY_LIVE = "analytics_live_daily";  // key: live_all_<date>     | live_<gameId>_<date>

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

  function dateStrOf(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function round2(n: number): number {
    return Math.round(n * 100) / 100;
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

    // ── Real game telemetry overlay (legacy analytics pipeline) ───────────────
    // The satori_events ring only sees the web SDK. The actual game DAU / event
    // volume / geo lives in the legacy per-day aggregate. Overlay it so the IVX
    // console shows the same numbers as analytics.htm instead of a near-empty map.
    var todayStr = dateStrOf(now);
    var legacyToday = readLegacyDay(nk, todayStr, gameId);
    var dauToday = legacyToday.dau;
    var eventsToday = legacyToday.events;
    var revenueToday = round2(legacyToday.revenue);

    var legacyCountries = topN(legacyToday.byCountry, 8).map(function (r) { return { country: r.key, users: r.count }; });
    if (legacyCountries.length > 0) topCountries = legacyCountries;

    var legacyEvents = topN(legacyToday.byName, 8).map(function (r) { return { name: r.key, count: r.count }; });
    if (legacyEvents.length > 0) topEvents = legacyEvents;

    return RpcHelpers.successResponse({
      generatedAt: now,
      activeUsers5m: distinctCount(users5m),
      activeUsers1h: distinctCount(users1h),
      activeUsers24h: Math.max(distinctCount(users24h), dauToday),
      eventsLast24h: eventsToday > 0 ? eventsToday : events24h,
      // Real daily truth from the analytics pipeline (matches analytics.htm).
      dauToday: dauToday,
      eventsToday: eventsToday,
      revenueToday: revenueToday,
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

  // ── Daily game-metrics (Satori "Game Metrics" tab) ─────────────────────────
  // Mirrors Satori Cloud's Daily Active Users / Sessions / Revenue / ARPAU
  // charts. Instead of scanning the sparse `satori_events` ring (which only
  // holds the web SDK's events and times out at scale), we read the durable
  // per-day aggregate docs the legacy analytics pipeline already maintains —
  // the same source as nakama.intelli-verse-x.ai/analytics.htm. One batched
  // storage read per day → fast and complete.

  var GM_MAX_DAYS = 31;

  interface LegacyDay {
    dau: number;
    events: number;
    sessions: number;
    revenue: number;
    purchases: number;
    byCountry: { [c: string]: number };
    byName: { [n: string]: number };
    lastEventAt: number;
  }

  // Read the legacy analytics_dau + analytics_live_daily aggregate docs for a
  // single date. gameId "all" maps to the platform-wide aggregate keys.
  function readLegacyDay(nk: nkruntime.Nakama, dateStr: string, gameId: string): LegacyDay {
    var sys = Constants.SYSTEM_USER_ID;
    var isAll = !gameId || gameId === "all";
    var dauKey = isAll ? "dau_platform_" + dateStr : "dau_" + gameId + "_" + dateStr;
    var liveKey = isAll ? "live_all_" + dateStr : "live_" + gameId + "_" + dateStr;

    var out: LegacyDay = { dau: 0, events: 0, sessions: 0, revenue: 0, purchases: 0, byCountry: {}, byName: {}, lastEventAt: 0 };
    try {
      var recs = nk.storageRead([
        { collection: LEGACY_DAU, key: dauKey, userId: sys },
        { collection: LEGACY_LIVE, key: liveKey, userId: sys }
      ]);
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (!r || !r.value) continue;
        if (r.collection === LEGACY_DAU) {
          var dv = r.value as any;
          out.dau = (parseInt(dv.count, 10) || 0) ||
            (Array.isArray(dv.users) ? dv.users.length : 0) ||
            (Array.isArray(dv.uniqueUsers) ? dv.uniqueUsers.length : 0) || 0;
        } else if (r.collection === LEGACY_LIVE) {
          var lv = r.value as any;
          out.events = parseInt(lv.total, 10) || 0;
          out.byName = lv.by_name || {};
          out.byCountry = lv.by_country || {};
          out.revenue = (parseFloat(lv.revenue_usd) || 0) + (parseFloat(lv.ad_revenue_usd) || 0);
          out.lastEventAt = parseInt(lv.last_event_at, 10) || 0;
          out.sessions = parseInt(lv.session_count, 10) ||
            (out.byName.session_end || out.byName.session_start || 0);
          out.purchases = out.byName.iap_purchased || out.byName.iap_purchase || 0;
        }
      }
    } catch (e) { /* missing day → zeros */ }
    return out;
  }

  // satori_game_metrics — Payload: { days?, game_id? }
  function rpcGameMetrics(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var days = Math.min(Math.max(parseInt(data.days, 10) || 14, 3), GM_MAX_DAYS);
    var gameId = (typeof data.game_id === "string" && data.game_id) ? data.game_id : "all";

    var nowMs = Date.now();
    var series: any[] = [];
    var totalsSessions = 0, totalsEvents = 0, totalsRevenue = 0, dauSum = 0;

    for (var d = days - 1; d >= 0; d--) {
      var dStr = dateStrOf(nowMs - d * 86400000);
      var day = readLegacyDay(nk, dStr, gameId);
      var dau = day.dau;
      var revenue = day.revenue;
      var payers = day.purchases;
      series.push({
        date: dStr,
        dau: dau,
        sessions: day.sessions,
        events: day.events,
        revenue: round2(revenue),
        payers: payers,
        arpau: dau > 0 ? round2(revenue / dau) : 0,
        arppu: payers > 0 ? round2(revenue / payers) : 0
      });
      totalsSessions += day.sessions;
      totalsEvents += day.events;
      totalsRevenue += revenue;
      dauSum += dau;
    }
    var avgDau = series.length > 0 ? Math.round(dauSum / series.length) : 0;

    return RpcHelpers.successResponse({
      days: days,
      generatedAt: nowMs,
      series: series,
      totals: { sessions: totalsSessions, events: totalsEvents, revenue: round2(totalsRevenue), avgDau: avgDau },
      scannedRecords: days * 2,
      truncated: false
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_dashboard_summary", rpcSummary);
    initializer.registerRpc("satori_game_metrics", rpcGameMetrics);
  }
}
