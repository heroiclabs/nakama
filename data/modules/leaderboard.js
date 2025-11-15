// leaderboard.js - Comprehensive leaderboard management for all types
// Compatible with Nakama JavaScript runtime (no ES modules)

/**
 * Get user's friends list
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @returns {array} Array of friend user IDs
 */
function getUserFriends(nk, logger, userId) {
    var friends = [];
    
    try {
        var friendsList = nk.friendsList(userId, 1000, null, null);
        if (friendsList && friendsList.friends) {
            for (var i = 0; i < friendsList.friends.length; i++) {
                var friend = friendsList.friends[i];
                if (friend.user && friend.user.id) {
                    friends.push(friend.user.id);
                }
            }
        }
        logger.info("[NAKAMA] Found " + friends.length + " friends for user " + userId);
    } catch (err) {
        logger.warn("[NAKAMA] Failed to get friends list: " + err.message);
    }
    
    return friends;
}

/**
 * Get all existing leaderboards from registry
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @returns {array} Array of leaderboard IDs
 */
function getAllLeaderboardIds(nk, logger) {
    var leaderboardIds = [];
    
    // Read from leaderboards_registry
    try {
        var records = nk.storageRead([{
            collection: "leaderboards_registry",
            key: "all_created",
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            var registry = records[0].value;
            for (var i = 0; i < registry.length; i++) {
                if (registry[i].leaderboardId) {
                    leaderboardIds.push(registry[i].leaderboardId);
                }
            }
        }
    } catch (err) {
        logger.warn("[NAKAMA] Failed to read leaderboards registry: " + err.message);
    }
    
    // Also read from time_period_leaderboards registry
    try {
        var timePeriodRecords = nk.storageRead([{
            collection: "leaderboards_registry",
            key: "time_period_leaderboards",
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (timePeriodRecords && timePeriodRecords.length > 0 && timePeriodRecords[0].value) {
            var timePeriodRegistry = timePeriodRecords[0].value;
            if (timePeriodRegistry.leaderboards) {
                for (var i = 0; i < timePeriodRegistry.leaderboards.length; i++) {
                    var lb = timePeriodRegistry.leaderboards[i];
                    if (lb.leaderboardId && leaderboardIds.indexOf(lb.leaderboardId) === -1) {
                        leaderboardIds.push(lb.leaderboardId);
                    }
                }
            }
        }
    } catch (err) {
        logger.warn("[NAKAMA] Failed to read time period leaderboards registry: " + err.message);
    }
    
    logger.info("[NAKAMA] Found " + leaderboardIds.length + " existing leaderboards in registry");
    return leaderboardIds;
}

/**
 * Write score to all relevant leaderboards
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} username - Username
 * @param {string} gameId - Game UUID
 * @param {number} score - Score value
 * @returns {array} Array of leaderboards updated
 */
function writeToAllLeaderboards(nk, logger, userId, username, gameId, score) {
    var leaderboardsUpdated = [];
    var metadata = {
        source: "submit_score_and_sync",
        gameId: gameId,
        submittedAt: new Date().toISOString()
    };
    
    // 1. Write to main game leaderboard
    var gameLeaderboardId = "leaderboard_" + gameId;
    try {
        nk.leaderboardRecordWrite(gameLeaderboardId, userId, username, score, 0, metadata);
        leaderboardsUpdated.push(gameLeaderboardId);
        logger.info("[NAKAMA] Score written to " + gameLeaderboardId);
    } catch (err) {
        logger.warn("[NAKAMA] Failed to write to " + gameLeaderboardId + ": " + err.message);
    }
    
    // 2. Write to time-period game leaderboards
    var timePeriods = ["daily", "weekly", "monthly", "alltime"];
    for (var i = 0; i < timePeriods.length; i++) {
        var period = timePeriods[i];
        var periodLeaderboardId = "leaderboard_" + gameId + "_" + period;
        try {
            nk.leaderboardRecordWrite(periodLeaderboardId, userId, username, score, 0, metadata);
            leaderboardsUpdated.push(periodLeaderboardId);
            logger.info("[NAKAMA] Score written to " + periodLeaderboardId);
        } catch (err) {
            logger.warn("[NAKAMA] Failed to write to " + periodLeaderboardId + ": " + err.message);
        }
    }
    
    // 3. Write to global leaderboards
    var globalLeaderboardId = "leaderboard_global";
    try {
        nk.leaderboardRecordWrite(globalLeaderboardId, userId, username, score, 0, metadata);
        leaderboardsUpdated.push(globalLeaderboardId);
        logger.info("[NAKAMA] Score written to " + globalLeaderboardId);
    } catch (err) {
        logger.warn("[NAKAMA] Failed to write to " + globalLeaderboardId + ": " + err.message);
    }
    
    // 4. Write to time-period global leaderboards
    for (var i = 0; i < timePeriods.length; i++) {
        var period = timePeriods[i];
        var globalPeriodId = "leaderboard_global_" + period;
        try {
            nk.leaderboardRecordWrite(globalPeriodId, userId, username, score, 0, metadata);
            leaderboardsUpdated.push(globalPeriodId);
            logger.info("[NAKAMA] Score written to " + globalPeriodId);
        } catch (err) {
            logger.warn("[NAKAMA] Failed to write to " + globalPeriodId + ": " + err.message);
        }
    }
    
    // 5. Write to friends leaderboards
    var friendsGameId = "leaderboard_friends_" + gameId;
    try {
        nk.leaderboardRecordWrite(friendsGameId, userId, username, score, 0, metadata);
        leaderboardsUpdated.push(friendsGameId);
        logger.info("[NAKAMA] Score written to " + friendsGameId);
    } catch (err) {
        logger.warn("[NAKAMA] Failed to write to " + friendsGameId + ": " + err.message);
    }
    
    var friendsGlobalId = "leaderboard_friends_global";
    try {
        nk.leaderboardRecordWrite(friendsGlobalId, userId, username, score, 0, metadata);
        leaderboardsUpdated.push(friendsGlobalId);
        logger.info("[NAKAMA] Score written to " + friendsGlobalId);
    } catch (err) {
        logger.warn("[NAKAMA] Failed to write to " + friendsGlobalId + ": " + err.message);
    }
    
    // 6. Write to all other existing leaderboards found in registry
    var allLeaderboards = getAllLeaderboardIds(nk, logger);
    for (var i = 0; i < allLeaderboards.length; i++) {
        var lbId = allLeaderboards[i];
        // Skip if already written
        if (leaderboardsUpdated.indexOf(lbId) !== -1) {
            continue;
        }
        // Only write to leaderboards related to this game or global
        if (lbId.indexOf(gameId) !== -1 || lbId.indexOf("global") !== -1) {
            try {
                nk.leaderboardRecordWrite(lbId, userId, username, score, 0, metadata);
                leaderboardsUpdated.push(lbId);
                logger.info("[NAKAMA] Score written to registry leaderboard " + lbId);
            } catch (err) {
                logger.warn("[NAKAMA] Failed to write to " + lbId + ": " + err.message);
            }
        }
    }
    
    logger.info("[NAKAMA] Total leaderboards updated: " + leaderboardsUpdated.length);
    return leaderboardsUpdated;
}
