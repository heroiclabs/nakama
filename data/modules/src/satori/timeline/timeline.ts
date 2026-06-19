// ---------------------------------------------------------------------------
// Satori Timeline — calendar view backing data. Mirrors Satori Cloud's
// "Timeline" surface: a per-day metric track (DAU + events) plus activity
// bars for experiments / live events / messages laid out across the date
// range, so admins can see what was live on any given day.
//
// DAU/events are read from the legacy analytics pipeline's durable per-day
// aggregate docs (via LegacyAnalytics) — the real game telemetry behind
// analytics.htm — instead of scanning the sparse `satori_events` ring.
// Activities come from the Satori config objects. Admin-only.
// ---------------------------------------------------------------------------
namespace SatoriTimeline {

  var MAX_DAYS = 31;

  // satori_timeline — Payload: { days?, game_id? }
  function rpcTimeline(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var days = Math.min(Math.max(parseInt(data.days, 10) || 14, 3), MAX_DAYS);
    var gameId = RpcHelpers.gameId(data);

    var nowMs = Date.now();
    var sinceMs = nowMs - days * 86400000;

    // Per-day DAU + event volume from the real analytics aggregates.
    var dau: { date: string; users: number; events: number }[] = [];
    var legacyDays = LegacyAnalytics.readRange(nk, nowMs, days, gameId);
    for (var i = 0; i < legacyDays.length; i++) {
      var ld = legacyDays[i];
      dau.push({ date: ld.date, users: ld.dau, events: ld.events });
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
      scannedRecords: legacyDays.length,
      truncated: false
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_timeline", rpcTimeline);
  }
}
