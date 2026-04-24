// analytics_player_profile.js
// Per-player analytics snapshot — backs the AnalyticsManager.GetPlayerAnalyticsProfile
// client call. Reads the player's first_seen marker, lifetime event counters from
// storage_user, and computes simple D-bucket / engagement signals. Cheap enough
// to call once per session at boot for tier/country/device-aware HUD widgets.
//
// REGISTERS:
//   analytics_get_player_profile  — returns { success, data:{...profile...} }
//
// REQUEST PAYLOAD:
//   { "gameId": "quizverse" }   // optional, defaults to "default"
//
// RESPONSE:
//   {
//     "success": true,
//     "data": {
//       "user_id":           "<uuid>",
//       "game_id":           "quizverse",
//       "first_seen_utc":    1700000000,
//       "days_since_install": 12,
//       "lifetime_event_count": 2840,
//       "lifetime_session_count": 18,
//       "last_event_utc":    1701000000,
//       "tier_signals": { "country": "US", "platform": "ios" }
//     }
//   }
//
// SAFETY:
//   * Reads ONLY storage objects owned by the caller (or system).
//   * No writes — pure read snapshot.
//   * Falls back to zero-valued profile on any error (never throws to client).

var FIRST_SEEN_COLLECTION = "analytics_user_first_seen";
var EVENT_INDEX_COLLECTION = "analytics_event_count_user"; // optional rollup
var DEFAULT_GAME_ID = "default";

// Slug→UUID alias for legacy ingestion ("quizverse" → "126bf539-...").
// Delegates to the bundled global resolveGameIdAlias when available so the
// alias map (defined in analytics.js) stays the single source of truth.
function appResolveGameId(g) {
    if (!g) return g;
    try {
        if (typeof resolveGameIdAlias === 'function') return resolveGameIdAlias(g);
    } catch (e) { /* fall through */ }
    return g;
}

function rpcAnalyticsGetPlayerProfile(ctx, logger, nk, payload) {
    try {
        var data = {};
        try { data = JSON.parse(payload || '{}'); } catch (_) { /* ignore */ }

        var gameId = appResolveGameId(data.gameId || data.game_id || DEFAULT_GAME_ID);
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "no_session" });
        }

        var firstSeenUtc = 0;
        try {
            var fsObjs = nk.storageRead([{
                collection: FIRST_SEEN_COLLECTION,
                key: gameId + "_" + userId,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
            if (fsObjs && fsObjs.length > 0 && fsObjs[0].value && fsObjs[0].value.firstSeenUtc) {
                firstSeenUtc = parseInt(fsObjs[0].value.firstSeenUtc, 10) || 0;
            }
        } catch (e) { /* missing first_seen is fine — treat as new */ }

        var nowUtc = Math.floor(Date.now() / 1000);
        if (!firstSeenUtc) firstSeenUtc = nowUtc;
        var daysSinceInstall = Math.floor((nowUtc - firstSeenUtc) / 86400);

        var lifetimeEvents = 0;
        var lifetimeSessions = 0;
        var lastEventUtc = 0;
        var modeCounts = {};
        var totalQuizPlays = 0;
        var favoriteMode = "";
        var favoriteModeCount = 0;
        try {
            var rollup = nk.storageRead([{
                collection: EVENT_INDEX_COLLECTION,
                key: gameId + "_" + userId,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
            if (rollup && rollup.length > 0 && rollup[0].value) {
                lifetimeEvents = rollup[0].value.eventCount || 0;
                lifetimeSessions = rollup[0].value.sessionCount || 0;
                lastEventUtc = rollup[0].value.lastEventUtc || 0;
                if (rollup[0].value.modeCounts && typeof rollup[0].value.modeCounts === "object") {
                    modeCounts = rollup[0].value.modeCounts;
                    // Derive total + favorite mode for cheap dashboard usage
                    for (var k in modeCounts) {
                        if (Object.prototype.hasOwnProperty.call(modeCounts, k)) {
                            var v = parseInt(modeCounts[k], 10) || 0;
                            totalQuizPlays += v;
                            if (v > favoriteModeCount) {
                                favoriteModeCount = v;
                                favoriteMode = k;
                            }
                        }
                    }
                }
            }
        } catch (e) { /* no rollup yet — return zero counts */ }

        var country = (ctx.vars && ctx.vars.country) || "??";
        var platform = (ctx.vars && ctx.vars.platform) || "unknown";

        return JSON.stringify({
            success: true,
            data: {
                user_id: userId,
                game_id: gameId,
                first_seen_utc: firstSeenUtc,
                days_since_install: daysSinceInstall,
                lifetime_event_count: lifetimeEvents,
                lifetime_session_count: lifetimeSessions,
                last_event_utc: lastEventUtc,
                mode_counts: modeCounts,
                lifetime_quiz_plays: totalQuizPlays,
                favorite_mode: favoriteMode,
                favorite_mode_count: favoriteModeCount,
                tier_signals: {
                    country: country,
                    platform: platform
                }
            }
        });
    } catch (err) {
        logger.warn("[analytics_get_player_profile] error: " + err.message);
        return JSON.stringify({ success: false, error: err.message || "unknown_error" });
    }
}

// ─────────────────────────────────────────────────────────────────────
// analytics_record_user_rollup
// ─────────────────────────────────────────────────────────────────────
// Daily client-side counter flush. Client tracks event/session counts in
// PlayerPrefs and calls this RPC at most once per 24h (idempotency-key
// guarded). Server reads the existing rollup, adds the day's deltas, and
// writes back. This is what makes analytics_get_player_profile's
// lifetime_event_count + lifetime_session_count fields actually accurate.
//
// PAYLOAD:
//   {
//     "gameId":         "quizverse",   // optional
//     "events_delta":   42,            // events fired since last flush
//     "sessions_delta": 1,             // sessions started since last flush
//     "last_event_utc": 1700000000,    // optional, defaults to now
//     "idempotency_key": "2026-04-22"  // typically a date string; replays
//                                       // within 36h are silent no-ops
//   }
//
// RESPONSE:
//   { success:true, data:{ event_count, session_count, last_event_utc,
//                          accepted, replayed } }
//
// SAFETY:
//   * Caps single-call deltas at 10k events / 50 sessions (anti-abuse).
//   * Idempotency: the last accepted key is persisted alongside counters;
//     re-sends with the same key return the current totals with
//     replayed:true and DO NOT double-count.
//   * On any error returns { success:false } — client should treat as
//     "try again next session" and not retry hard.

var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
var MAX_EVENTS_PER_FLUSH   = 10000;
var MAX_SESSIONS_PER_FLUSH = 50;
// Per-mode counts are an *absolute* snapshot (not a delta); cap each entry
// to the same daily ceiling as events to bound storage/abuse. Cap mode-key
// length so a malicious client can't pump huge keys into our storage row.
var MAX_MODE_COUNT         = 1000000;
var MAX_MODE_KEY_LEN       = 64;
var MAX_MODE_ENTRIES       = 64;

function rpcAnalyticsRecordUserRollup(ctx, logger, nk, payload) {
    try {
        var data = {};
        try { data = JSON.parse(payload || '{}'); } catch (_) { /* ignore */ }

        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "no_session" });
        }

        var gameId = appResolveGameId(data.gameId || data.game_id || DEFAULT_GAME_ID);
        var idempotencyKey = (data.idempotency_key || data.idempotencyKey || "").toString();

        var eventsDelta = parseInt(data.events_delta || data.eventsDelta || 0, 10) || 0;
        var sessionsDelta = parseInt(data.sessions_delta || data.sessionsDelta || 0, 10) || 0;
        if (eventsDelta < 0) eventsDelta = 0;
        if (sessionsDelta < 0) sessionsDelta = 0;
        if (eventsDelta > MAX_EVENTS_PER_FLUSH) eventsDelta = MAX_EVENTS_PER_FLUSH;
        if (sessionsDelta > MAX_SESSIONS_PER_FLUSH) sessionsDelta = MAX_SESSIONS_PER_FLUSH;

        var nowUtc = Math.floor(Date.now() / 1000);
        var lastEventUtc = parseInt(data.last_event_utc || data.lastEventUtc || nowUtc, 10) || nowUtc;
        if (lastEventUtc > nowUtc + 300) lastEventUtc = nowUtc; // clamp clock-skew

        var storageKey = gameId + "_" + userId;

        var existing = {
            eventCount: 0,
            sessionCount: 0,
            lastEventUtc: 0,
            lastIdempotencyKey: "",
            updatedUtc: 0,
            modeCounts: {}
        };
        try {
            var prev = nk.storageRead([{
                collection: EVENT_INDEX_COLLECTION,
                key: storageKey,
                userId: SYSTEM_USER_ID
            }]);
            if (prev && prev.length > 0 && prev[0].value) {
                existing.eventCount = parseInt(prev[0].value.eventCount || 0, 10) || 0;
                existing.sessionCount = parseInt(prev[0].value.sessionCount || 0, 10) || 0;
                existing.lastEventUtc = parseInt(prev[0].value.lastEventUtc || 0, 10) || 0;
                existing.lastIdempotencyKey = (prev[0].value.lastIdempotencyKey || "").toString();
                existing.updatedUtc = parseInt(prev[0].value.updatedUtc || 0, 10) || 0;
                if (prev[0].value.modeCounts && typeof prev[0].value.modeCounts === "object") {
                    existing.modeCounts = prev[0].value.modeCounts;
                }
            }
        } catch (e) { /* no prior rollup — start fresh */ }

        // Sanitize incoming mode_counts. Treated as an *absolute* snapshot
        // of lifetime per-mode plays; we max-merge with the prior snapshot
        // so a temporarily-cleared client cache can never decrement totals.
        var incomingMode = (data.mode_counts || data.modeCounts) || null;
        var mergedModeCounts = {};
        // Seed with prior values
        for (var pk in existing.modeCounts) {
            if (Object.prototype.hasOwnProperty.call(existing.modeCounts, pk)) {
                mergedModeCounts[pk] = parseInt(existing.modeCounts[pk], 10) || 0;
            }
        }
        if (incomingMode && typeof incomingMode === "object") {
            var entries = 0;
            for (var ik in incomingMode) {
                if (!Object.prototype.hasOwnProperty.call(incomingMode, ik)) continue;
                if (entries >= MAX_MODE_ENTRIES) break;
                var key = ("" + ik).substring(0, MAX_MODE_KEY_LEN);
                var iv = parseInt(incomingMode[ik], 10) || 0;
                if (iv < 0) iv = 0;
                if (iv > MAX_MODE_COUNT) iv = MAX_MODE_COUNT;
                var prevV = mergedModeCounts[key] || 0;
                mergedModeCounts[key] = (iv > prevV) ? iv : prevV;
                entries++;
            }
        }

        // Idempotency: replay of the same key returns current totals
        // unchanged. Client should pick a key like "YYYY-MM-DD" so retries
        // within the same day are silent no-ops.
        if (idempotencyKey && existing.lastIdempotencyKey === idempotencyKey) {
            return JSON.stringify({
                success: true,
                data: {
                    event_count: existing.eventCount,
                    session_count: existing.sessionCount,
                    last_event_utc: existing.lastEventUtc,
                    accepted: false,
                    replayed: true
                }
            });
        }

        var newEventCount   = existing.eventCount + eventsDelta;
        var newSessionCount = existing.sessionCount + sessionsDelta;
        var newLastEventUtc = Math.max(existing.lastEventUtc, lastEventUtc);

        nk.storageWrite([{
            collection: EVENT_INDEX_COLLECTION,
            key: storageKey,
            userId: SYSTEM_USER_ID,
            value: {
                eventCount: newEventCount,
                sessionCount: newSessionCount,
                lastEventUtc: newLastEventUtc,
                lastIdempotencyKey: idempotencyKey,
                updatedUtc: nowUtc,
                gameId: gameId,
                modeCounts: mergedModeCounts
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);

        return JSON.stringify({
            success: true,
            data: {
                event_count: newEventCount,
                session_count: newSessionCount,
                last_event_utc: newLastEventUtc,
                mode_counts: mergedModeCounts,
                accepted: true,
                replayed: false
            }
        });
    } catch (err) {
        logger.warn("[analytics_record_user_rollup] error: " + err.message);
        return JSON.stringify({ success: false, error: err.message || "unknown_error" });
    }
}

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_get_player_profile", rpcAnalyticsGetPlayerProfile);
    initializer.registerRpc("analytics_record_user_rollup", rpcAnalyticsRecordUserRollup);
    logger.info("[analytics_player_profile] Module registered: 2 RPCs");
}
