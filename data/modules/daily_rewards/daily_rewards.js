// daily_rewards.js - Daily Rewards & Streak System (Per gameId UUID)

import * as utils from "../copilot/utils.js";

/**
 * Reward configurations per gameId UUID
 * This can be extended or moved to storage for dynamic configuration
 */
/**
 * BALANCED DAILY REWARDS CONFIGURATION
 * 
 * Design Philosophy:
 * - Day 1: 40 coins = ~4 QuickPlay games (keeps them playing after free plays)
 * - Day 3: 65 coins = Can afford first Hint power-up (75) with Day 2 leftover (milestone!)
 * - Day 7: 200 coins = Big reward validates loyalty, can afford Extra Life (200)
 * - Weekly total: 660 coins (enough for ~6-8 sessions/day with free plays)
 * 
 * Key metrics:
 * - Creates "slightly short" feeling → drives ad watching & IAP
 * - Never leaves user completely stuck (can always play with free plays + Day 1)
 * - Milestone at Day 3 (first power-up affordable) creates mid-week retention hook
 * - Day 7 jackpot encourages full week completion (4x Day 1 reward)
 */
var REWARD_CONFIGS = {
    // Default rewards for any game - BALANCED FOR ENGAGEMENT + MONETIZATION
    "default": [
        { day: 1, xp: 50, tokens: 40, description: "Welcome Back!" },
        { day: 2, xp: 75, tokens: 50, description: "Day 2 Reward" },
        { day: 3, xp: 100, tokens: 65, description: "Power-Up Unlocked! 💪" },
        { day: 4, xp: 150, tokens: 80, description: "Halfway There!" },
        { day: 5, xp: 200, tokens: 100, multiplier: "2x XP", description: "Day 5 Bonus! 🔥" },
        { day: 6, xp: 275, tokens: 125, description: "Almost There!" },
        { day: 7, xp: 400, tokens: 200, nft: "weekly_badge", description: "🎉 Weekly Champion!" }
    ],
    
    // QuizVerse specific - CORRECT GAME ID
    "126bf539-dae2-4bcf-964d-316c0fa1f92b": [
        { day: 1, xp: 50, tokens: 40, description: "Welcome Back!" },
        { day: 2, xp: 75, tokens: 50, description: "Day 2 Reward" },
        { day: 3, xp: 100, tokens: 65, description: "Power-Up Unlocked! 💪" },
        { day: 4, xp: 150, tokens: 80, description: "Halfway There!" },
        { day: 5, xp: 200, tokens: 100, multiplier: "2x XP", description: "Day 5 Bonus! 🔥" },
        { day: 6, xp: 275, tokens: 125, description: "Almost There!" },
        { day: 7, xp: 400, tokens: 200, nft: "weekly_badge", description: "🎉 Weekly Champion!" }
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
    
    // Grant rewards to wallet (tokens mapped to coins)
    var walletChanges = {};
    if (reward.tokens) walletChanges.coins = reward.tokens;
    if (reward.xp) walletChanges.xp = reward.xp;
    if (Object.keys(walletChanges).length > 0) {
        try {
            nk.walletUpdate(userId, walletChanges, { source: "daily_reward", day: streakData.currentStreak, gameId: gameId }, true);
            logger.info("[DailyRewards] Granted wallet: " + JSON.stringify(walletChanges) + " to " + userId);
        } catch (walletErr) {
            logger.error("[DailyRewards] Wallet grant failed: " + walletErr.message);
        }
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        currentStreak: streakData.currentStreak,
        totalClaims: streakData.totalClaims,
        reward: reward,
        walletGranted: walletChanges,
        claimedAt: utils.getCurrentTimestamp()
    });
}

// Export RPC functions (ES Module syntax)
export {
    rpcDailyRewardsGetStatus,
    rpcDailyRewardsClaim
};
