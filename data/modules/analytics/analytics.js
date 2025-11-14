// analytics.js - Analytics System (Per gameId UUID)

import * as utils from "../copilot/utils.js";

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
 * Track Daily Active User
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 */
function trackDAU(nk, logger, userId, gameId) {
    var today = utils.getStartOfDay();
    var collection = "analytics_dau";
    var key = "dau_" + gameId + "_" + today;
    
    // Read existing DAU data
    var dauData = utils.readStorage(nk, logger, collection, key, "00000000-0000-0000-0000-000000000000");
    
    if (!dauData) {
        dauData = {
            gameId: gameId,
            date: today,
            users: [],
            count: 0
        };
    }
    
    // Add user if not already in list
    if (dauData.users.indexOf(userId) === -1) {
        dauData.users.push(userId);
        dauData.count = dauData.users.length;
        
        // Save updated DAU data
        utils.writeStorage(nk, logger, collection, key, "00000000-0000-0000-0000-000000000000", dauData);
    }
}

/**
 * Track session data
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {string} eventName - Event name (session_start or session_end)
 * @param {object} eventData - Event data
 */
function trackSession(nk, logger, userId, gameId, eventName, eventData) {
    var collection = "analytics_sessions";
    var key = utils.makeGameStorageKey("analytics_session", userId, gameId);
    
    if (eventName === "session_start") {
        // Start new session
        var sessionData = {
            userId: userId,
            gameId: gameId,
            startTime: utils.getUnixTimestamp(),
            startTimestamp: utils.getCurrentTimestamp(),
            active: true
        };
        utils.writeStorage(nk, logger, collection, key, userId, sessionData);
    } else if (eventName === "session_end") {
        // End session
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
        }
    }
}

// Export RPC functions (ES Module syntax)
export {
    rpcAnalyticsLogEvent
};
