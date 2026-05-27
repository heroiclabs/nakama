// analytics/recap_signals/recap_signals.js
// ─────────────────────────────────────────────────────────────────────────────
// Typed recap-signal capture: small, focused event surface that fuels
// content-factory's weekly + monthly recap pipelines.
//
// Why a separate RPC pair (vs analytics_log_event)?
//   * Recap pipelines want a *fast* read of "what happened in the last 7/30
//     days for this user, of these specific kinds".
//   * analytics_log_event stores into a generic ring buffer; filtering by
//     kind + date window at read time costs CPU on every recap render.
//   * The recap-signal pair stores typed signals in a tight per-user ring
//     buffer keyed for cheap windowed reads.
//
// KINDS captured (the only kinds clients/jobs should record):
//   * pb_set            — { topic, kind:'best_accuracy_in_topic'|'fastest_correct'|...,
//                           value:number, unit:'pct'|'ms'|'count' }
//   * comeback          — { gap_days:number }
//                         First session after a >=3-day gap.
//   * topic_mastered    — { topic, accuracy_pct:number, attempts:number }
//                         First time topic crossed >=80% with >=10 attempts.
//   * league_changed    — { from:tier, to:tier, points_delta:number,
//                           direction:'up'|'down' }
//   * daily_summary     — { quizzes:int, correct:int, answered:int,
//                           minutes:number, league_pts_delta:int,
//                           friend_sessions:int }
//                         Server-side rollup written once per UTC day.
//
// REGISTERS:
//   analytics_recap_signal_record   POST { user_id, kind, payload, occurred_at? }
//   analytics_recap_signals_read    POST { user_id, since_iso?, kinds?, limit? }
//   analytics_recap_signals_stats   POST { user_id } — counts per kind + window
//
// AUTH:
//   * All three RPCs accept either:
//     - a logged-in session (ctx.userId), OR
//     - server-to-server http_key calls that pass `user_id` in the payload.
//   * This matches the http_key-acceptance pattern landed in nakama#89.
//
// STORAGE:
//   Collection : "recap_signals"
//   Key        : "timeline"
//   Owner      : the player whose signals these are
//   Shape      : { events: [ { id, kind, payload, occurred_at, recorded_at }, ... ] }
//   Cap        : RECAP_SIGNALS_RING_CAP newest entries (older ones evicted).
//
// PRIVACY:
//   * No raw quiz answers, no free-text inputs, no PII beyond the kinds above.
//   * payload sizes are bounded (RECAP_SIGNAL_PAYLOAD_MAX_BYTES).
// ─────────────────────────────────────────────────────────────────────────────

var RECAP_SIGNALS_COLLECTION       = "recap_signals";
var RECAP_SIGNALS_KEY              = "timeline";
var RECAP_SIGNALS_RING_CAP         = 100;
var RECAP_SIGNAL_PAYLOAD_MAX_BYTES = 2048;
var RECAP_SIGNAL_DEFAULT_READ_LIMIT = 50;
var RECAP_SIGNAL_MAX_READ_LIMIT     = 200;

// Whitelist of supported signal kinds — clients sending anything else get
// rejected so the recap pipelines never see garbage they can't interpret.
var RECAP_SIGNAL_KINDS = {
    pb_set:         true,
    comeback:       true,
    topic_mastered: true,
    league_changed: true,
    daily_summary:  true
};

// ── Helpers ────────────────────────────────────────────────────────────────

function recapSignalsResolveUserId(ctx, data) {
    // Mirrors the http_key-acceptance pattern from nakama#89. Server-to-server
    // callers (content-factory daily rollup job, admin scripts) supply
    // user_id in the payload; logged-in sessions use ctx.userId.
    var userId = ctx && ctx.userId;
    if (userId) return userId;
    if (data && (data.user_id || data.userId)) {
        return (data.user_id || data.userId).toString();
    }
    return "";
}

function recapSignalsSafeJsonParse(s) {
    if (!s) return {};
    try { return JSON.parse(s) || {}; } catch (_e) { return {}; }
}

function recapSignalsReadTimeline(nk, userId) {
    try {
        var records = nk.storageRead([{
            collection: RECAP_SIGNALS_COLLECTION,
            key:        RECAP_SIGNALS_KEY,
            userId:     userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            var v = records[0].value;
            if (v && Array.isArray(v.events)) return v.events;
        }
    } catch (_e) { /* fall through to empty timeline */ }
    return [];
}

function recapSignalsWriteTimeline(nk, userId, events) {
    // Cap to RECAP_SIGNALS_RING_CAP newest entries — keeps the doc tight and
    // avoids the "ring grows forever" trap.
    if (events.length > RECAP_SIGNALS_RING_CAP) {
        events = events.slice(events.length - RECAP_SIGNALS_RING_CAP);
    }
    nk.storageWrite([{
        collection:     RECAP_SIGNALS_COLLECTION,
        key:            RECAP_SIGNALS_KEY,
        userId:         userId,
        value:          { events: events, updated_at: new Date().toISOString() },
        permissionRead:  1,
        permissionWrite: 0  // owner-only writes prevent client tampering
    }]);
}

function recapSignalsValidatePayload(payload) {
    // Strings come from the network — be paranoid about size and shape.
    if (payload === undefined || payload === null) return {};
    if (typeof payload !== "object" || Array.isArray(payload)) {
        return null;  // signal: rejected
    }
    try {
        var s = JSON.stringify(payload);
        if (s.length > RECAP_SIGNAL_PAYLOAD_MAX_BYTES) return null;
    } catch (_e) {
        return null;
    }
    return payload;
}

function recapSignalsParseIso(iso) {
    if (!iso || typeof iso !== "string") return 0;
    try {
        var t = Date.parse(iso);
        return isNaN(t) ? 0 : t;
    } catch (_e) {
        return 0;
    }
}

// ── RPC: record ────────────────────────────────────────────────────────────

function rpcAnalyticsRecapSignalRecord(ctx, logger, nk, payload) {
    var data = recapSignalsSafeJsonParse(payload);
    var userId = recapSignalsResolveUserId(ctx, data);
    if (!userId) {
        return JSON.stringify({ success: false, error: "no_session" });
    }

    var kind = (data.kind || data.event_kind || "").toString();
    if (!kind || !RECAP_SIGNAL_KINDS[kind]) {
        return JSON.stringify({
            success: false,
            error:   "unsupported_kind",
            allowed: Object.keys(RECAP_SIGNAL_KINDS)
        });
    }

    var validated = recapSignalsValidatePayload(data.payload || {});
    if (validated === null) {
        return JSON.stringify({ success: false, error: "invalid_payload" });
    }

    var occurredAt = (data.occurred_at || data.occurredAt || "").toString();
    if (!occurredAt) {
        occurredAt = new Date().toISOString();
    }

    var event = {
        // Lightweight stable id — userId+timestamp+kind is sufficient since
        // we cap to 100 entries and the ring buffer is per-user.
        id:          (kind + "_" + Date.now() + "_" + Math.floor(Math.random() * 1e6)),
        kind:        kind,
        payload:     validated,
        occurred_at: occurredAt,
        recorded_at: new Date().toISOString()
    };

    var events = recapSignalsReadTimeline(nk, userId);
    events.push(event);
    try {
        recapSignalsWriteTimeline(nk, userId, events);
    } catch (e) {
        logger.error("[recap_signals] write failed for " + userId + ": " + e.message);
        return JSON.stringify({ success: false, error: "storage_write_failed" });
    }

    return JSON.stringify({
        success:  true,
        event_id: event.id,
        kind:     kind
    });
}

// ── RPC: read ──────────────────────────────────────────────────────────────

function rpcAnalyticsRecapSignalsRead(ctx, logger, nk, payload) {
    var data = recapSignalsSafeJsonParse(payload);
    var userId = recapSignalsResolveUserId(ctx, data);
    if (!userId) {
        return JSON.stringify({ success: false, error: "no_session" });
    }

    var kindsFilter = null;
    if (Array.isArray(data.kinds) && data.kinds.length > 0) {
        kindsFilter = {};
        for (var i = 0; i < data.kinds.length; i++) {
            var k = (data.kinds[i] || "").toString();
            if (RECAP_SIGNAL_KINDS[k]) kindsFilter[k] = true;
        }
        if (Object.keys(kindsFilter).length === 0) kindsFilter = null;
    }

    var sinceMs = recapSignalsParseIso(data.since_iso || data.sinceIso || "");

    var limit = parseInt(data.limit || RECAP_SIGNAL_DEFAULT_READ_LIMIT, 10);
    if (isNaN(limit) || limit <= 0) limit = RECAP_SIGNAL_DEFAULT_READ_LIMIT;
    if (limit > RECAP_SIGNAL_MAX_READ_LIMIT) limit = RECAP_SIGNAL_MAX_READ_LIMIT;

    var events = recapSignalsReadTimeline(nk, userId);
    var out = [];
    for (var j = events.length - 1; j >= 0 && out.length < limit; j--) {
        var e = events[j];
        if (!e || !e.kind) continue;
        if (kindsFilter && !kindsFilter[e.kind]) continue;
        if (sinceMs > 0) {
            var t = recapSignalsParseIso(e.occurred_at);
            if (t > 0 && t < sinceMs) continue;
        }
        out.push(e);
    }

    return JSON.stringify({
        success: true,
        user_id: userId,
        events:  out,
        count:   out.length,
        window:  {
            since_iso: data.since_iso || data.sinceIso || null,
            kinds:    kindsFilter ? Object.keys(kindsFilter) : null
        }
    });
}

// ── RPC: stats ─────────────────────────────────────────────────────────────
// Compact summary that the content-factory recap fan-out can consume in one
// call instead of pulling the full timeline. Returns counts per kind for the
// 7d and 30d windows so weekly + monthly pipelines can decide which beats
// to render.

function rpcAnalyticsRecapSignalsStats(ctx, logger, nk, payload) {
    var data = recapSignalsSafeJsonParse(payload);
    var userId = recapSignalsResolveUserId(ctx, data);
    if (!userId) {
        return JSON.stringify({ success: false, error: "no_session" });
    }

    var now = Date.now();
    var cutoff7d  = now - 7  * 86400 * 1000;
    var cutoff30d = now - 30 * 86400 * 1000;

    var events = recapSignalsReadTimeline(nk, userId);
    var counts7d  = {};
    var counts30d = {};
    var latestByKind = {};

    for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (!e || !e.kind) continue;
        var t = recapSignalsParseIso(e.occurred_at);
        if (t <= 0) continue;
        if (t >= cutoff30d) {
            counts30d[e.kind] = (counts30d[e.kind] || 0) + 1;
            if (!latestByKind[e.kind] || recapSignalsParseIso(latestByKind[e.kind].occurred_at) < t) {
                latestByKind[e.kind] = e;
            }
        }
        if (t >= cutoff7d) {
            counts7d[e.kind] = (counts7d[e.kind] || 0) + 1;
        }
    }

    return JSON.stringify({
        success:   true,
        user_id:   userId,
        counts_7d: counts7d,
        counts_30d: counts30d,
        latest_by_kind: latestByKind,
        total_events: events.length
    });
}

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_recap_signal_record",  rpcAnalyticsRecapSignalRecord);
    initializer.registerRpc("analytics_recap_signals_read",   rpcAnalyticsRecapSignalsRead);
    initializer.registerRpc("analytics_recap_signals_stats",  rpcAnalyticsRecapSignalsStats);
    logger.info("[analytics/recap_signals] registered 3 RPCs (record/read/stats)");
}
