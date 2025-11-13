// daily_rewards.js - Daily Rewards & Streak System (Per gameId UUID)

var utils = require("../copilot/utils");

/**
 * Reward configurations per gameId UUID
 * This can be extended or moved to storage for dynamic configuration
 */
var REWARD_CONFIGS = {
    // Default rewards for any game
    "default": [
        { day: 1, xp: 100, tokens: 10, description: "Day 1 Reward" },
        { day: 2, xp: 150, tokens: 15, description: "Day 2 Reward" },
        { day: 3, xp: 200, tokens: 20, description: "Day 3 Reward" },
        { day: 4, xp: 250, tokens: 25, description: "Day 4 Reward" },
        { day: 5, xp: 300, tokens: 30, multiplier: "2x XP", description: "Day 5 Bonus" },
        { day: 6, xp: 350, tokens: 35, description: "Day 6 Reward" },
        { day: 7, xp: 500, tokens: 50, nft: "weekly_badge", description: "Day 7 Special Badge" }
    ]
};

/**
 * Get or create streak data for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @returns {object} Streak data
 */
function getStreakData(nk, logger, userId, gameId) {
    var collection = "daily_streaks";
    var key = utils.makeGameStorageKey("user_daily_streak", userId, gameId);
    
    var data = utils.readStorage(nk, logger, collection, key, userId);
    
    if (!data) {
        // Initialize new streak
        data = {
            userId: userId,
            gameId: gameId,
            currentStreak: 0,
            lastClaimTimestamp: 0,
            totalClaims: 0,
            createdAt: utils.getCurrentTimestamp()
        };
    }
    
    return data;
}

/**
 * Save streak data
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {object} data - Streak data to save
 * @returns {boolean} Success status
 */
function saveStreakData(nk, logger, userId, gameId, data) {
    var collection = "daily_streaks";
    var key = utils.makeGameStorageKey("user_daily_streak", userId, gameId);
    return utils.writeStorage(nk, logger, collection, key, userId, data);
}

/**
 * Check if user can claim reward today
 * @param {object} streakData - Current streak data
 * @returns {object} { canClaim: boolean, reason: string }
 */
function canClaimToday(streakData) {
    var now = utils.getUnixTimestamp();
    var lastClaim = streakData.lastClaimTimestamp;
    
    // First claim ever
    if (lastClaim === 0) {
        return { canClaim: true, reason: "first_claim" };
    }
    
    var lastClaimStartOfDay = utils.getStartOfDay(new Date(lastClaim * 1000));
    var todayStartOfDay = utils.getStartOfDay();
    
    // Already claimed today
    if (lastClaimStartOfDay === todayStartOfDay) {
        return { canClaim: false, reason: "already_claimed_today" };
    }
    
    // Can claim
    return { canClaim: true, reason: "eligible" };
}

/**
 * Update streak status based on time elapsed
 * @param {object} streakData - Current streak data
 * @returns {object} Updated streak data
 */
function updateStreakStatus(streakData) {
    var now = utils.getUnixTimestamp();
    var lastClaim = streakData.lastClaimTimestamp;
    
    // First claim
    if (lastClaim === 0) {
        return streakData;
    }
    
    // Check if more than 48 hours passed (streak broken)
    if (!utils.isWithinHours(lastClaim, now, 48)) {
        streakData.currentStreak = 0;
    }
    
    return streakData;
}

/**
 * Get reward configuration for current day
 * @param {string} gameId - Game ID
 * @param {number} day - Streak day (1-7)
 * @returns {object} Reward configuration
 */
function getRewardForDay(gameId, day) {
    var config = REWARD_CONFIGS[gameId] || REWARD_CONFIGS["default"];
    var rewardDay = ((day - 1) % 7) + 1; // Cycle through 1-7
    
    for (var i = 0; i < config.length; i++) {
        if (config[i].day === rewardDay) {
            return config[i];
        }
    }
    
    // Fallback to day 1 if not found
    return config[0];
}

/**
 * RPC: Get daily reward status
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 * @returns {string} JSON response
 */
function rpcDailyRewardsGetStatus(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC daily_rewards_get_status called");
    
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
    
    // Get current streak data
    var streakData = getStreakData(nk, logger, userId, gameId);
    streakData = updateStreakStatus(streakData);
    
    // Check if can claim
    var claimCheck = canClaimToday(streakData);
    
    // Get next reward info
    var nextDay = streakData.currentStreak + 1;
    var nextReward = getRewardForDay(gameId, nextDay);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        currentStreak: streakData.currentStreak,
        totalClaims: streakData.totalClaims,
        lastClaimTimestamp: streakData.lastClaimTimestamp,
        canClaimToday: claimCheck.canClaim,
        claimReason: claimCheck.reason,
        nextReward: nextReward,
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Claim daily reward
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 * @returns {string} JSON response
 */
function rpcDailyRewardsClaim(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC daily_rewards_claim called");
    
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
    
    // Get current streak data
    var streakData = getStreakData(nk, logger, userId, gameId);
    streakData = updateStreakStatus(streakData);
    
    // Check if can claim
    var claimCheck = canClaimToday(streakData);
    if (!claimCheck.canClaim) {
        return JSON.stringify({
            success: false,
            error: "Cannot claim reward: " + claimCheck.reason,
            canClaimToday: false
        });
    }
    
    // Update streak
    streakData.currentStreak += 1;
    streakData.lastClaimTimestamp = utils.getUnixTimestamp();
    streakData.totalClaims += 1;
    streakData.updatedAt = utils.getCurrentTimestamp();
    
    // Get reward for current day
    var reward = getRewardForDay(gameId, streakData.currentStreak);
    
    // Save updated streak
    if (!saveStreakData(nk, logger, userId, gameId, streakData)) {
        return utils.handleError(ctx, null, "Failed to save streak data");
    }
    
    // Log reward claim for transaction history
    var transactionKey = "transaction_log_" + userId + "_" + utils.getUnixTimestamp();
    var transactionData = {
        userId: userId,
        gameId: gameId,
        type: "daily_reward_claim",
        day: streakData.currentStreak,
        reward: reward,
        timestamp: utils.getCurrentTimestamp()
    };
    utils.writeStorage(nk, logger, "transaction_logs", transactionKey, userId, transactionData);
    
    utils.logInfo(logger, "User " + userId + " claimed day " + streakData.currentStreak + " reward for game " + gameId);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        currentStreak: streakData.currentStreak,
        totalClaims: streakData.totalClaims,
        reward: reward,
        claimedAt: utils.getCurrentTimestamp()
    });
}

// Export RPC functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        rpcDailyRewardsGetStatus: rpcDailyRewardsGetStatus,
        rpcDailyRewardsClaim: rpcDailyRewardsClaim
    };
}
