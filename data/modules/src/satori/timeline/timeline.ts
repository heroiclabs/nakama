// ---------------------------------------------------------------------------
// Satori Timeline — calendar view backing data. Mirrors Satori Cloud's
// "Timeline" surface: a per-day metric track (DAU + events) plus activity
// bars for experiments / live events / messages laid out across the date
// range, so admins can see what was live on any given day.
//
// DAU/events come from a page-capped scan of `satori_events` (newest-first
// keys mean recent days are reached first). Activities come from the Satori
// config objects. Admin-only.
// ---------------------------------------------------------------------------
namespace SatoriTimeline {

  var PAGE_SIZE = 100;
  var DEFAULT_PAGES = 320;
  var MAX_PAGES = 800;
  var MAX_DAYS = 31;

  function toMs(ts: number): number {
    if (!ts) return 0;
    return ts < 100000000000 ? ts * 1000 : ts;
  }

  function dateStrOf(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  // satori_timeline — Payload: { days?, game_id?, max_pages? }
  function rpcTimeline(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var days = Math.min(Math.max(parseInt(data.days, 10) || 14, 3), MAX_DAYS);
    var maxPages = Math.min(Math.max(parseInt(data.max_pages, 10) || DEFAULT_PAGES, 1), MAX_PAGES);
    var gameId = RpcHelpers.gameId(data);

    var nowMs = Date.now();
    var sinceMs = nowMs - days * 86400000;

    // date → { users set, events count }
    var perDay: { [d: string]: { users: { [u: string]: boolean }; events: number } } = {};
    var cursor = "";
    var scanned = 0;
    var truncated = false;

    for (var p = 0; p < maxPages; p++) {
      var page = nk.storageList(Constants.SYSTEM_USER_ID, Constants.SATORI_EVENTS_COLLECTION, PAGE_SIZE, cursor);
      var objects = (page && page.objects) || [];
      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (!obj.key || obj.key.indexOf("ev_") !== 0 || !obj.value) continue;
        scanned++;
        var rec = obj.value as any;
        var t = toMs(rec.timestamp);
        if (t < sinceMs || t > nowMs) continue;
        var uid = rec.userId || rec.identityId;
        var dStr = rec.date || dateStrOf(t);
        if (!perDay[dStr]) perDay[dStr] = { users: {}, events: 0 };
        perDay[dStr].events++;
        if (uid) perDay[dStr].users[uid] = true;
      }
      cursor = (page && page.cursor) || "";
      if (!cursor) break;
    }
    if (cursor) truncated = true;

    // Emit a continuous day axis (oldest → newest) so the UI can render an
    // unbroken calendar even for days with zero activity.
    var dau: { date: string; users: number; events: number }[] = [];
    for (var d = days - 1; d >= 0; d--) {
      var dStr2 = dateStrOf(nowMs - d * 86400000);
      var entry = perDay[dStr2];
      dau.push({
        date: dStr2,
        users: entry ? Object.keys(entry.users).length : 0,
        events: entry ? entry.events : 0
      });
    }

    // Activities laid out across the range (seconds → kept as seconds).
    var activities: any[] = [];
    var sinceSec = Math.floor(sinceMs / 1000);

    var experiments = ConfigLoader.loadSatoriConfigForGame<{ [id: string]: any }>(nk, "experiments", gameId, {});
    for (var ex in experiments) {
      var e = experiments[ex];
      if (e.endAt && e.endAt < sinceSec) continue;
      activities.push({ type: "experiment", id: ex, name: e.name || ex, startAt: e.startAt || null, endAt: e.endAt || null, status: e.status || "" });
    }

    var liveEvents = ConfigLoader.loadSatoriConfigForGame<{ [id: string]: any }>(nk, "live_events", gameId, {});
    for (var le in liveEvents) {
      var l = liveEvents[le];
      if (l.endAt && l.endAt < sinceSec) continue;
      activities.push({ type: "live_event", id: le, name: l.name || le, startAt: l.startAt || null, endAt: l.endAt || null, category: l.category || "" });
    }

    var rawMsgs = ConfigLoader.loadSatoriConfigForGame<any>(nk, "messages", gameId, {});
    var messages = rawMsgs && rawMsgs.messages ? rawMsgs.messages : rawMsgs;
    for (var mid in messages) {
      var m = messages[mid];
      if (!m || typeof m !== "object") continue;
      if (m.scheduleAt && m.scheduleAt < sinceSec) continue;
      activities.push({ type: "message", id: mid, name: m.title || mid, startAt: m.scheduleAt || null, endAt: m.expiresAt || null });
    }

    return RpcHelpers.successResponse({
      days: days,
      sinceMs: sinceMs,
      generatedAt: nowMs,
      dau: dau,
      activities: activities,
      scannedRecords: scanned,
      truncated: truncated
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_timeline", rpcTimeline);
  }
}
