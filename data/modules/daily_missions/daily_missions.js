// daily_missions.js - Daily Missions System (Per gameId UUID)

var utils = require("../copilot/utils");

/**
 * Mission configurations per gameId UUID
 * This can be extended or moved to storage for dynamic configuration
 */
var MISSION_CONFIGS = {
    // Default missions for any game
    "default": [
        {
            id: "login_daily",
            name: "Daily Login",
            description: "Log in to the game",
            objective: "login",
            targetValue: 1,
            rewards: { xp: 50, tokens: 5 }
        },
        {
            id: "play_matches",
            name: "Play Matches",
            description: "Complete 3 matches",
            objective: "matches_played",
            targetValue: 3,
            rewards: { xp: 100, tokens: 10 }
        },
        {
            id: "score_points",
            name: "Score Points",
            description: "Score 1000 points",
            objective: "total_score",
            targetValue: 1000,
            rewards: { xp: 150, tokens: 15 }
        }
    ]
};

/**
 * Get mission configurations for a game
 * @param {string} gameId - Game ID (UUID)
 * @returns {Array} Mission configurations
 */
function getMissionConfig(gameId) {
    return MISSION_CONFIGS[gameId] || MISSION_CONFIGS["default"];
}

/**
 * Get or create daily mission progress for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @returns {object} Mission progress data
 */
function getMissionProgress(nk, logger, userId, gameId) {
    var collection = "daily_missions";
    var key = utils.makeGameStorageKey("mission_progress", userId, gameId);
    
    var data = utils.readStorage(nk, logger, collection, key, userId);
    
    if (!data || !isToday(data.resetDate)) {
        // Initialize new daily missions
        var missions = getMissionConfig(gameId);
        var progress = {};
        
        for (var i = 0; i < missions.length; i++) {
            progress[missions[i].id] = {
                currentValue: 0,
                targetValue: missions[i].targetValue,
                completed: false,
                claimed: false
            };
        }
        
        data = {
            userId: userId,
            gameId: gameId,
            resetDate: utils.getStartOfDay(),
            progress: progress,
            updatedAt: utils.getCurrentTimestamp()
        };
    }
    
    return data;
}

/**
 * Check if a timestamp is from today
 * @param {number} timestamp - Unix timestamp (seconds)
 * @returns {boolean} True if timestamp is from today
 */
function isToday(timestamp) {
    if (!timestamp) return false;
    var todayStart = utils.getStartOfDay();
    var tomorrowStart = todayStart + 86400; // +24 hours
    return timestamp >= todayStart && timestamp < tomorrowStart;
}

/**
 * Save mission progress
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {object} data - Mission progress data
 * @returns {boolean} Success status
 */
function saveMissionProgress(nk, logger, userId, gameId, data) {
    var collection = "daily_missions";
    var key = utils.makeGameStorageKey("mission_progress", userId, gameId);
    data.updatedAt = utils.getCurrentTimestamp();
    return utils.writeStorage(nk, logger, collection, key, userId, data);
}

/**
 * RPC: Get daily missions
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 * @returns {string} JSON response
 */
function rpcGetDailyMissions(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC get_daily_missions called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId']);
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
    
    // Get mission progress
    var progressData = getMissionProgress(nk, logger, userId, gameId);
    
    // Get mission configs
    var missions = getMissionConfig(gameId);
    
    // Build response with mission details and progress
    var missionsList = [];
    for (var i = 0; i < missions.length; i++) {
        var mission = missions[i];
        var progress = progressData.progress[mission.id] || {
            currentValue: 0,
            targetValue: mission.targetValue,
            completed: false,
            claimed: false
        };
        
        missionsList.push({
            id: mission.id,
            name: mission.name,
            description: mission.description,
            objective: mission.objective,
            currentValue: progress.currentValue,
            targetValue: progress.targetValue,
            completed: progress.completed,
            claimed: progress.claimed,
            rewards: mission.rewards
        });
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        resetDate: progressData.resetDate,
        missions: missionsList,
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Submit mission progress
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid", missionId: "string", value: number }
 * @returns {string} JSON response
 */
function rpcSubmitMissionProgress(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC submit_mission_progress called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId', 'missionId', 'value']);
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
    
    var missionId = data.missionId;
    var value = data.value;
    
    // Get current progress
    var progressData = getMissionProgress(nk, logger, userId, gameId);
    
    // Check if mission exists
    if (!progressData.progress[missionId]) {
        return utils.handleError(ctx, null, "Mission not found: " + missionId);
    }
    
    var missionProgress = progressData.progress[missionId];
    
    // Update progress
    missionProgress.currentValue += value;
    
    // Check if completed
    if (missionProgress.currentValue >= missionProgress.targetValue && !missionProgress.completed) {
        missionProgress.completed = true;
        utils.logInfo(logger, "Mission " + missionId + " completed for user " + userId);
    }
    
    // Save progress
    if (!saveMissionProgress(nk, logger, userId, gameId, progressData)) {
        return utils.handleError(ctx, null, "Failed to save mission progress");
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        missionId: missionId,
        currentValue: missionProgress.currentValue,
        targetValue: missionProgress.targetValue,
        completed: missionProgress.completed,
        claimed: missionProgress.claimed,
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Claim mission reward
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid", missionId: "string" }
 * @returns {string} JSON response
 */
function rpcClaimMissionReward(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC claim_mission_reward called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId', 'missionId']);
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
    
    var missionId = data.missionId;
    
    // Get current progress
    var progressData = getMissionProgress(nk, logger, userId, gameId);
    
    // Check if mission exists
    if (!progressData.progress[missionId]) {
        return utils.handleError(ctx, null, "Mission not found: " + missionId);
    }
    
    var missionProgress = progressData.progress[missionId];
    
    // Check if completed
    if (!missionProgress.completed) {
        return JSON.stringify({
            success: false,
            error: "Mission not completed yet"
        });
    }
    
    // Check if already claimed
    if (missionProgress.claimed) {
        return JSON.stringify({
            success: false,
            error: "Reward already claimed"
        });
    }
    
    // Mark as claimed
    missionProgress.claimed = true;
    
    // Get mission config to retrieve rewards
    var missions = getMissionConfig(gameId);
    var missionConfig = null;
    for (var i = 0; i < missions.length; i++) {
        if (missions[i].id === missionId) {
            missionConfig = missions[i];
            break;
        }
    }
    
    if (!missionConfig) {
        return utils.handleError(ctx, null, "Mission configuration not found");
    }
    
    // Save progress
    if (!saveMissionProgress(nk, logger, userId, gameId, progressData)) {
        return utils.handleError(ctx, null, "Failed to save mission progress");
    }
    
    // Log reward claim for transaction history
    var transactionKey = "transaction_log_" + userId + "_" + utils.getUnixTimestamp();
    var transactionData = {
        userId: userId,
        gameId: gameId,
        type: "mission_reward_claim",
        missionId: missionId,
        rewards: missionConfig.rewards,
        timestamp: utils.getCurrentTimestamp()
    };
    utils.writeStorage(nk, logger, "transaction_logs", transactionKey, userId, transactionData);
    
    utils.logInfo(logger, "User " + userId + " claimed mission reward for " + missionId);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        missionId: missionId,
        rewards: missionConfig.rewards,
        claimedAt: utils.getCurrentTimestamp()
    });
}

// Export RPC functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        rpcGetDailyMissions: rpcGetDailyMissions,
        rpcSubmitMissionProgress: rpcSubmitMissionProgress,
        rpcClaimMissionReward: rpcClaimMissionReward
    };
}
