/**
 * Progressive Content Unlocks Module
 * Unlocks game features over the first 7 days to maintain engagement
 * 
 * Impact: D7 +5% retention
 */

// ============================================================================
// UNLOCK CONFIGURATION
// ============================================================================

var UNLOCK_CONFIG = {
    // Day 1: Basic features (default)
    day1: {
        features: ["basic_quiz", "championship", "daily_quiz"],
        rewards: { coins: 50 },
        message: "Welcome! Start your trivia journey!"
    },
    // Day 2: Engagement features
    day2: {
        features: ["lucky_wheel", "daily_streak", "power_ups"],
        rewards: { coins: 100, energy: 3 },
        message: "🎡 Lucky Wheel unlocked! Spin for rewards!",
        requirement: { type: "login", day: 2 }
    },
    // Day 3: Social features
    day3: {
        features: ["multiplayer", "friends_list", "chat"],
        rewards: { coins: 150, gems: 10 },
        message: "⚔️ Multiplayer unlocked! Battle friends!",
        requirement: { type: "quizzes_won", count: 3 }
    },
    // Day 4: Content creation
    day4: {
        features: ["link_and_play", "custom_quizzes", "share_quiz"],
        rewards: { coins: 200, gems: 15 },
        message: "📚 Link & Play unlocked! Create your own quizzes!",
        requirement: { type: "login", day: 4 }
    },
    // Day 5: Advanced modes
    day5: {
        features: ["survival_mode", "timed_challenge", "hard_mode"],
        rewards: { coins: 250, gems: 20, mystery_box: 1 },
        message: "💀 Survival Mode unlocked! How long can you last?",
        requirement: { type: "quizzes_completed", count: 10 }
    },
    // Day 6: Competitive features
    day6: {
        features: ["weekly_tournament", "global_leaderboard", "rankings"],
        rewards: { coins: 300, gems: 25 },
        message: "🏆 Weekly Tournament unlocked! Compete globally!",
        requirement: { type: "login", day: 6 }
    },
    // Day 7: Premium trial
    day7: {
        features: ["premium_trial", "all_categories", "ad_free_trial"],
        rewards: { coins: 500, gems: 50, premium_days: 3 },
        message: "👑 VIP Trial unlocked! 3 days of Premium FREE!",
        requirement: { type: "login", day: 7 }
    }
};

// All possible features
var ALL_FEATURES = [
    "basic_quiz", "championship", "daily_quiz",
    "lucky_wheel", "daily_streak", "power_ups",
    "multiplayer", "friends_list", "chat",
    "link_and_play", "custom_quizzes", "share_quiz",
    "survival_mode", "timed_challenge", "hard_mode",
    "weekly_tournament", "global_leaderboard", "rankings",
    "premium_trial", "all_categories", "ad_free_trial"
];

// ============================================================================
// STORAGE KEYS
// ============================================================================

var STORAGE_COLLECTION = "progression";
var STORAGE_KEY_UNLOCKS = "progressive_unlocks";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getUnlockData(nk, userId) {
    try {
        var objects = nk.storageRead([{
            collection: STORAGE_COLLECTION,
            key: STORAGE_KEY_UNLOCKS,
            userId: userId
        }]);
        
        if (objects && objects.length > 0) {
            return objects[0].value;
        }
    } catch (e) {
        // No data yet
    }
    
    // Initialize default data
    return {
        firstLoginDate: Date.now(),
        currentDay: 1,
        unlockedFeatures: UNLOCK_CONFIG.day1.features.slice(),
        claimedDays: [1],
        totalQuizzesCompleted: 0,
        totalQuizzesWon: 0,
        lastCheckDate: Date.now()
    };
}

function saveUnlockData(nk, userId, data) {
    data.lastUpdated = Date.now();
    
    nk.storageWrite([{
        collection: STORAGE_COLLECTION,
        key: STORAGE_KEY_UNLOCKS,
        userId: userId,
        value: data,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function calculateCurrentDay(firstLoginDate) {
    var now = Date.now();
    var daysSinceFirst = Math.floor((now - firstLoginDate) / (24 * 60 * 60 * 1000));
    return Math.min(daysSinceFirst + 1, 7); // Cap at day 7
}

function checkRequirement(data, requirement) {
    if (!requirement) return true;
    
    switch (requirement.type) {
        case "login":
            return data.currentDay >= requirement.day;
        case "quizzes_won":
            return data.totalQuizzesWon >= requirement.count;
        case "quizzes_completed":
            return data.totalQuizzesCompleted >= requirement.count;
        default:
            return true;
    }
}

function grantRewards(nk, userId, rewards, logger) {
    if (!rewards) return;
    
    try {
        // Grant coins
        if (rewards.coins) {
            nk.walletUpdate(userId, { coins: rewards.coins }, {}, true);
            logger.info("Granted " + rewards.coins + " coins to " + userId);
        }
        
        // Grant gems
        if (rewards.gems) {
            nk.walletUpdate(userId, { gems: rewards.gems }, {}, true);
            logger.info("Granted " + rewards.gems + " gems to " + userId);
        }
        
        // Grant energy
        if (rewards.energy) {
            nk.walletUpdate(userId, { energy: rewards.energy }, {}, true);
        }
        
        // Grant premium days
        if (rewards.premium_days) {
            var premiumExpiry = Date.now() + (rewards.premium_days * 24 * 60 * 60 * 1000);
            nk.storageWrite([{
                collection: "premium",
                key: "trial",
                userId: userId,
                value: { expiresAt: premiumExpiry, type: "trial" },
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }
        
        // Grant mystery box
        if (rewards.mystery_box) {
            var inventoryData = { mystery_boxes: rewards.mystery_box };
            nk.walletUpdate(userId, inventoryData, {}, true);
        }
    } catch (e) {
        logger.error("Error granting rewards: " + e.message);
    }
}

// ============================================================================
// RPC FUNCTIONS
// ============================================================================

/**
 * Get current unlock state
 * Returns: unlockedFeatures, currentDay, nextUnlock, progress
 */
function rpcGetUnlockState(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }
    
    var data = getUnlockData(nk, ctx.userId);
    
    // Update current day
    data.currentDay = calculateCurrentDay(data.firstLoginDate);
    saveUnlockData(nk, ctx.userId, data);
    
    // Calculate next unlock info
    var nextDay = null;
    var nextUnlock = null;
    
    for (var day = 1; day <= 7; day++) {
        var dayKey = "day" + day;
        var config = UNLOCK_CONFIG[dayKey];
        
        if (config && data.claimedDays.indexOf(day) === -1) {
            nextDay = day;
            nextUnlock = {
                day: day,
                features: config.features,
                rewards: config.rewards,
                message: config.message,
                canClaim: checkRequirement(data, config.requirement),
                requirement: config.requirement
            };
            break;
        }
    }
    
    // Build locked features list
    var lockedFeatures = [];
    ALL_FEATURES.forEach(function(feature) {
        if (data.unlockedFeatures.indexOf(feature) === -1) {
            lockedFeatures.push(feature);
        }
    });
    
    return JSON.stringify({
        success: true,
        data: {
            currentDay: data.currentDay,
            firstLoginDate: data.firstLoginDate,
            unlockedFeatures: data.unlockedFeatures,
            lockedFeatures: lockedFeatures,
            claimedDays: data.claimedDays,
            nextUnlock: nextUnlock,
            totalQuizzesCompleted: data.totalQuizzesCompleted,
            totalQuizzesWon: data.totalQuizzesWon,
            allUnlocked: data.claimedDays.length >= 7
        }
    });
}

/**
 * Claim unlock for a specific day
 * Payload: { day: number }
 */
function rpcClaimUnlock(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }
    
    var request = {};
    try {
        request = JSON.parse(payload || "{}");
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid payload" });
    }
    
    var day = request.day;
    if (!day || day < 1 || day > 7) {
        return JSON.stringify({ success: false, error: "Invalid day" });
    }
    
    var data = getUnlockData(nk, ctx.userId);
    data.currentDay = calculateCurrentDay(data.firstLoginDate);
    
    // Check if already claimed
    if (data.claimedDays.indexOf(day) !== -1) {
        return JSON.stringify({ success: false, error: "Already claimed" });
    }
    
    // Check if day is reachable
    if (day > data.currentDay) {
        return JSON.stringify({ success: false, error: "Day not yet available" });
    }
    
    // Check requirements
    var dayKey = "day" + day;
    var config = UNLOCK_CONFIG[dayKey];
    
    if (!config) {
        return JSON.stringify({ success: false, error: "Invalid day config" });
    }
    
    if (!checkRequirement(data, config.requirement)) {
        return JSON.stringify({ 
            success: false, 
            error: "Requirement not met",
            requirement: config.requirement
        });
    }
    
    // Claim the unlock
    data.claimedDays.push(day);
    config.features.forEach(function(feature) {
        if (data.unlockedFeatures.indexOf(feature) === -1) {
            data.unlockedFeatures.push(feature);
        }
    });
    
    // Grant rewards
    grantRewards(nk, ctx.userId, config.rewards, logger);
    
    // Save
    saveUnlockData(nk, ctx.userId, data);
    
    logger.info("User " + ctx.userId + " claimed Day " + day + " unlock");
    
    return JSON.stringify({
        success: true,
        data: {
            day: day,
            unlockedFeatures: config.features,
            rewards: config.rewards,
            message: config.message,
            allUnlockedFeatures: data.unlockedFeatures
        }
    });
}

/**
 * Check if a specific feature is unlocked
 */
function rpcCheckFeatureUnlocked(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }
    
    var request = {};
    try {
        request = JSON.parse(payload || "{}");
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid payload" });
    }
    
    var feature = request.feature;
    if (!feature) {
        return JSON.stringify({ success: false, error: "Feature required" });
    }
    
    var data = getUnlockData(nk, ctx.userId);
    var isUnlocked = data.unlockedFeatures.indexOf(feature) !== -1;
    
    // Find which day unlocks this feature
    var unlockDay = null;
    for (var day = 1; day <= 7; day++) {
        var config = UNLOCK_CONFIG["day" + day];
        if (config && config.features.indexOf(feature) !== -1) {
            unlockDay = day;
            break;
        }
    }
    
    return JSON.stringify({
        success: true,
        data: {
            feature: feature,
            isUnlocked: isUnlocked,
            unlockDay: unlockDay,
            currentDay: calculateCurrentDay(data.firstLoginDate)
        }
    });
}

/**
 * Update progress (quizzes completed/won)
 */
function rpcUpdateProgress(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }
    
    var request = {};
    try {
        request = JSON.parse(payload || "{}");
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid payload" });
    }
    
    var data = getUnlockData(nk, ctx.userId);
    
    if (request.quizCompleted) {
        data.totalQuizzesCompleted++;
    }
    if (request.quizWon) {
        data.totalQuizzesWon++;
    }
    
    data.currentDay = calculateCurrentDay(data.firstLoginDate);
    saveUnlockData(nk, ctx.userId, data);
    
    // Check if any new unlocks are available
    var newUnlocksAvailable = [];
    for (var day = 1; day <= data.currentDay; day++) {
        if (data.claimedDays.indexOf(day) === -1) {
            var config = UNLOCK_CONFIG["day" + day];
            if (config && checkRequirement(data, config.requirement)) {
                newUnlocksAvailable.push({
                    day: day,
                    features: config.features,
                    message: config.message
                });
            }
        }
    }
    
    return JSON.stringify({
        success: true,
        data: {
            totalQuizzesCompleted: data.totalQuizzesCompleted,
            totalQuizzesWon: data.totalQuizzesWon,
            newUnlocksAvailable: newUnlocksAvailable
        }
    });
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    rpcGetUnlockState: rpcGetUnlockState,
    rpcClaimUnlock: rpcClaimUnlock,
    rpcCheckFeatureUnlocked: rpcCheckFeatureUnlocked,
    rpcUpdateProgress: rpcUpdateProgress
};


