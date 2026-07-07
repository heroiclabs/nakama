/**
 * QuizVerse Link & Play Badge Event Bridge
 *
 * Provides a web-friendly RPC wrapper that auto-sets game_id="quizverse"
 * and maps LAP client event names to existing badge events.
 */

var LAP_BADGE_COLLECTION = "badges";
var LAP_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * RPC: quizverse_lap_badge_event
 * Payload: { event_type, event_data? }
 *   event_type examples:
 *     - "lap_quiz_played"          → triggers lap_quiz_master badge progression
 *     - "lap_flash_completed"      → triggers lap_flash_ninja badge progression
 *     - "lap_note_created"         → triggers lap_explorer / link_creator
 *     - "lap_note_shared"          → triggers lap_sharer
 *     - "lap_streak_day"           → triggers lap_streak_keeper
 *     - "lap_battle_won"           → triggers lap_battle_winner
 *
 * Internally delegates to the existing badges_check_event RPC logic
 * with game_id hard-coded to "quizverse".
 */
var rpcQuizverseLapBadgeEvent = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId;

        if (!data.event_type) {
            return JSON.stringify({
                success: false,
                error: "event_type is required",
            });
        }

        // Build the standard badges_check_event payload
        var checkPayload = JSON.stringify({
            game_id: "quizverse",
            event_type: data.event_type,
            event_data: data.event_data || {},
        });

        // Re-use the existing badge check function from badges.js
        var resultRaw = rpcBadgesCheckEvent(ctx, logger, nk, checkPayload);
        var result = JSON.parse(resultRaw);

        // If badges were unlocked, send a persistent notification
        if (result.badges_unlocked && result.badges_unlocked.length > 0) {
            result.badges_unlocked.forEach(function(b) {
                try {
                    nk.notificationSend(userId, "badge_unlocked", {
                        badge_id: b.badge_id,
                        title: b.title,
                        category: b.category,
                    }, 1, userId, "");
                } catch (notifyErr) {
                    logger.warn("[LAP-Badges] Failed to send notification: " + notifyErr.message);
                }
            });
        }

        return JSON.stringify({
            success: true,
            badges_updated: result.badges_updated || [],
            badges_unlocked: result.badges_unlocked || [],
            event_type: data.event_type,
        });
    } catch (err) {
        logger.error("[LAP-Badges] Error in quizverse_lap_badge_event: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message,
        });
    }
};

/**
 * RPC: quizverse_lap_badge_sync
 *
 * Called by Unity BadgeServiceMono on startup or when the user returns
 * from the Link & Play WebView. Returns the user's current badge progress
 * for all LAP-related badges so Unity can update its local cache.
 *
 * Payload: { }
 * Response: { success, lap_badges: [...] }
 */
var rpcQuizverseLapBadgeSync = function(ctx, logger, nk, payload) {
    try {
        var userId = ctx.userId;
        var gameId = "quizverse";

        // Read player progress
        var progressKey = "progress_" + userId + "_" + gameId;
        var progressData = {};
        try {
            var pRecords = nk.storageRead([{
                collection: "badges",
                key: progressKey,
                userId: userId,
            }]);
            if (pRecords && pRecords.length > 0 && pRecords[0].value) {
                progressData = pRecords[0].value;
            }
        } catch (e) {
            // No progress yet → return empty
        }

        // Filter only LAP badge keys
        var lapBadgeKeys = Object.keys(progressData).filter(function(k) {
            return k.indexOf("lap_") === 0;
        });

        var lapBadges = lapBadgeKeys.map(function(k) {
            var badge = progressData[k];
            return {
                badge_id: k,
                progress: badge.progress || 0,
                unlocked: !!badge.unlocked,
                unlock_date: badge.unlock_date || null,
                displayed: !!badge.displayed,
            };
        });

        return JSON.stringify({
            success: true,
            lap_badges: lapBadges,
        });
    } catch (err) {
        logger.error("[LAP-Badges] Sync error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message,
        });
    }
};

function InitModule(ctx, logger, nk, initializer) {
    try {
        initializer.registerRpc("quizverse_lap_badge_event", rpcQuizverseLapBadgeEvent);
        logger.info("[LAP-Badges] Registered RPC: quizverse_lap_badge_event");
    } catch (e) {
        logger.error("[LAP-Badges] Failed to register quizverse_lap_badge_event: " + e.message);
    }

    try {
        initializer.registerRpc("quizverse_lap_badge_sync", rpcQuizverseLapBadgeSync);
        logger.info("[LAP-Badges] Registered RPC: quizverse_lap_badge_sync");
    } catch (e) {
        logger.error("[LAP-Badges] Failed to register quizverse_lap_badge_sync: " + e.message);
    }

    logger.info("[LAP-Badges] LAP badge bridge module initialized");
}
