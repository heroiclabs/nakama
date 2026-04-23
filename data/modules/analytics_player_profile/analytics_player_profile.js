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

function rpcAnalyticsGetPlayerProfile(ctx, logger, nk, payload) {
    try {
        var data = {};
        try { data = JSON.parse(payload || '{}'); } catch (_) { /* ignore */ }

        var gameId = data.gameId || data.game_id || DEFAULT_GAME_ID;
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

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_get_player_profile", rpcAnalyticsGetPlayerProfile);
    logger.info("[analytics_player_profile] Module registered: 1 RPC");
}
