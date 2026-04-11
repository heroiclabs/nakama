// analytics.js - Analytics System (Per gameId UUID)

/**
 * RPC: Log analytics event
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid", eventName: "string", eventData: {} }
 * @returns {string} JSON response
 */
function rpcAnalyticsLogEvent(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC analytics_log_event called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId', 'eventName']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!utils.isValidUUID(gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var eventName = data.eventName;
    var eventData = data.eventData || {};
    
    // Create event record
    var event = {
        userId: userId,
        gameId: gameId,
        eventName: eventName,
        eventData: eventData,
        timestamp: utils.getCurrentTimestamp(),
        unixTimestamp: utils.getUnixTimestamp()
    };
    
    // Store event
    var collection = "analytics_events";
    var key = "event_" + userId + "_" + gameId + "_" + utils.getUnixTimestamp();
    
    if (!utils.writeStorage(nk, logger, collection, key, userId, event)) {
        return utils.handleError(ctx, null, "Failed to log event");
    }
    
    // Track DAU (Daily Active Users)
    trackDAU(nk, logger, userId, gameId);
    
    // Track session if session event
    if (eventName === "session_start" || eventName === "session_end") {
        trackSession(nk, logger, userId, gameId, eventName, eventData);
    }
    
    utils.logInfo(logger, "Event logged: " + eventName + " for user " + userId + " in game " + gameId);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        eventName: eventName,
        timestamp: event.timestamp
    });
}

/**
 * Track Daily Active User - writes both game-level and platform-level DAU keys.
 * Dashboard reads: dauData.uniqueUsers, dauData.count, dauData.newUsers
 */
function trackDAU(nk, logger, userId, gameId) {
    var today = utils.getStartOfDay();
    var collection = "analytics_dau";
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

    var keys = [
        "dau_" + gameId + "_" + today,
        "dau_platform_" + today
    ];

    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var dauData = utils.readStorage(nk, logger, collection, key, SYSTEM_USER);

        if (!dauData) {
            dauData = {
                date: today,
                uniqueUsers: [],
                count: 0,
                newUsers: 0
            };
        }

        // Migrate old "users" field to "uniqueUsers" for dashboard compatibility
        if (!Array.isArray(dauData.uniqueUsers)) {
            dauData.uniqueUsers = Array.isArray(dauData.users) ? dauData.users : [];
        }

        if (dauData.uniqueUsers.indexOf(userId) === -1) {
            dauData.uniqueUsers.push(userId);
            dauData.count = dauData.uniqueUsers.length;
            utils.writeStorage(nk, logger, collection, key, SYSTEM_USER, dauData);
        }
    }
}

/**
 * Track session data (start/end)
 */
function trackSession(nk, logger, userId, gameId, eventName, eventData) {
    var collection = "analytics_sessions";
    var key = utils.makeGameStorageKey("analytics_session", userId, gameId);
    
    if (eventName === "session_start") {
        var sessionData = {
            userId: userId,
            gameId: gameId,
            startTime: utils.getUnixTimestamp(),
            startTimestamp: utils.getCurrentTimestamp(),
            active: true
        };
        utils.writeStorage(nk, logger, collection, key, userId, sessionData);
    } else if (eventName === "session_end") {
        var sessionData = utils.readStorage(nk, logger, collection, key, userId);
        if (sessionData && sessionData.active) {
            sessionData.endTime = utils.getUnixTimestamp();
            sessionData.endTimestamp = utils.getCurrentTimestamp();
            sessionData.duration = sessionData.endTime - sessionData.startTime;
            sessionData.active = false;
            
            // Save session summary
            var summaryKey = "session_summary_" + userId + "_" + gameId + "_" + sessionData.startTime;
            utils.writeStorage(nk, logger, "analytics_session_summaries", summaryKey, userId, sessionData);
            
            // Clear active session
            utils.writeStorage(nk, logger, collection, key, userId, { active: false });

            // Aggregate session stats for dashboard
            aggregateSessionStats(nk, logger, sessionData.duration);
        }
    }
}

/**
 * Aggregate session stats into a daily summary for the analytics dashboard.
 * Key: session_stats_{YYYY-MM-DD}, stored under SYSTEM_USER.
 */
function aggregateSessionStats(nk, logger, durationSeconds) {
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
    var today = utils.getStartOfDay();
    var collection = "analytics_sessions";
    var key = "session_stats_" + today;

    var stats = utils.readStorage(nk, logger, collection, key, SYSTEM_USER);
    if (!stats) {
        stats = { date: today, totalSessions: 0, totalDuration: 0, avgDuration: 0 };
    }

    stats.totalSessions++;
    stats.totalDuration += (durationSeconds || 0);
    stats.avgDuration = stats.totalSessions > 0 ? Math.round(stats.totalDuration / stats.totalSessions) : 0;

    utils.writeStorage(nk, logger, collection, key, SYSTEM_USER, stats);
}