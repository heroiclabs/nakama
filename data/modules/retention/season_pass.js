// season_pass.js - Season Pass / Battle Pass System for D7/D30 Retention
// Provides 30-day season with free and premium tracks

/**
 * Season Pass System
 * 
 * Features:
 * - 50 levels of rewards (free + premium tracks)
 * - Daily and weekly XP quests
 * - Season themes and exclusive rewards
 * - Premium pass purchase support
 * - Per-game season support
 */

// Season configuration
var SEASON_CONFIG = {
    maxLevel: 50,
    xpPerLevel: 1000,      // XP needed per level
    seasonDuration: 30,     // Days
    premiumPrice: 499,      // In gems
};

// Free track rewards (every 5 levels)
var FREE_REWARDS = {
    1:  { coins: 100 },
    5:  { coins: 200, avatar: "season_common_1" },
    10: { coins: 300, energyRefill: 1 },
    15: { coins: 500 },
    20: { coins: 500, frame: "season_bronze" },
    25: { coins: 750, luckyWheelSpin: 1 },
    30: { coins: 1000 },
    35: { coins: 1000, mysteryBox: 1 },
    40: { coins: 1500 },
    45: { coins: 2000, badge: "season_veteran" },
    50: { coins: 3000, title: "Season Veteran", badge: "season_badge" }
};

// Premium track rewards (every level)
var PREMIUM_REWARDS = {
    1:  { gems: 50, frame: "premium_starter" },
    5:  { gems: 100, avatar: "season_rare_1" },
    10: { gems: 150, coins: 1000 },
    15: { gems: 200, title: "Premium Player" },
    20: { gems: 250, avatar: "season_epic_1" },
    25: { gems: 300, coins: 2000, streakShield: 3 },
    30: { gems: 400, frame: "premium_gold" },
    35: { gems: 500, avatar: "season_epic_2" },
    40: { gems: 600, coins: 3000 },
    45: { gems: 750, avatar: "season_legendary" },
    50: { gems: 1000, title: "Season Master", avatar: "season_master", frame: "season_master_frame", badge: "season_master_badge" }
};

// Daily quests for XP
var DAILY_QUESTS = [
    { id: "daily_login", title: "Daily Login", description: "Log in today", xp: 50, autoComplete: true },
    { id: "daily_quiz_1", title: "First Quiz", description: "Complete 1 quiz", target: 1, xp: 100 },
    { id: "daily_quiz_3", title: "Quiz Trio", description: "Complete 3 quizzes", target: 3, xp: 150 },
    { id: "daily_correct_10", title: "Knowledge", description: "Answer 10 questions correctly", target: 10, xp: 100 },
    { id: "daily_accuracy", title: "Accurate", description: "Get 80%+ accuracy in a quiz", target: 80, xp: 150 }
];

// Weekly quests for XP
var WEEKLY_QUESTS = [
    { id: "weekly_quiz_10", title: "Quiz Master", description: "Complete 10 quizzes", target: 10, xp: 500 },
    { id: "weekly_win_3", title: "Triple Win", description: "Win 3 multiplayer matches", target: 3, xp: 400 },
    { id: "weekly_streak", title: "Streak Keeper", description: "Maintain 5-day streak", target: 5, xp: 300 },
    { id: "weekly_create", title: "Creator", description: "Create a quiz with Link & Play", target: 1, xp: 350 },
    { id: "weekly_challenge", title: "Challenger", description: "Challenge 3 friends", target: 3, xp: 350 }
];

/**
 * Get current season info
 */
function getCurrentSeasonInfo() {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth() + 1;
    
    // Season number (12 per year)
    var seasonNumber = (year * 12) + month;
    
    // Season start date (1st of month)
    var seasonStart = new Date(year, month - 1, 1);
    
    // Season end date (last day of month)
    var seasonEnd = new Date(year, month, 0, 23, 59, 59);
    
    // Days remaining
    var daysRemaining = Math.ceil((seasonEnd - now) / (1000 * 60 * 60 * 24));
    
    return {
        seasonNumber: seasonNumber,
        seasonName: "Season " + seasonNumber,
        startDate: seasonStart.toISOString(),
        endDate: seasonEnd.toISOString(),
        daysRemaining: Math.max(0, daysRemaining),
        month: month,
        year: year
    };
}

/**
 * Read season pass data for user
 */
function getSeasonPassData(nk, logger, userId, gameId) {
    var collection = "season_pass";
    var season = getCurrentSeasonInfo();
    var key = "progress_" + userId + "_" + gameId + "_" + season.seasonNumber;
    
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: userId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logger.warn("[SeasonPass] Failed to read data: " + err.message);
    }
    
    return null;
}

/**
 * Save season pass data
 */
function saveSeasonPassData(nk, logger, userId, gameId, data) {
    var collection = "season_pass";
    var season = getCurrentSeasonInfo();
    var key = "progress_" + userId + "_" + gameId + "_" + season.seasonNumber;
    
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: data,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error("[SeasonPass] Failed to save data: " + err.message);
        return false;
    }
}

/**
 * Initialize season pass for new season
 */
function initializeSeasonPass(seasonInfo, isPremium) {
    var dailyQuests = {};
    var weeklyQuests = {};
    
    // Initialize daily quests
    for (var i = 0; i < DAILY_QUESTS.length; i++) {
        var quest = DAILY_QUESTS[i];
        dailyQuests[quest.id] = {
            current: 0,
            target: quest.target || 1,
            completed: false,
            claimed: false
        };
    }
    
    // Initialize weekly quests
    for (var j = 0; j < WEEKLY_QUESTS.length; j++) {
        var wquest = WEEKLY_QUESTS[j];
        weeklyQuests[wquest.id] = {
            current: 0,
            target: wquest.target || 1,
            completed: false,
            claimed: false
        };
    }
    
    return {
        seasonNumber: seasonInfo.seasonNumber,
        level: 1,
        xp: 0,
        totalXpEarned: 0,
        isPremium: isPremium || false,
        freeRewardsClaimed: {},
        premiumRewardsClaimed: {},
        dailyQuests: dailyQuests,
        weeklyQuests: weeklyQuests,
        lastDailyReset: new Date().toISOString().split('T')[0], // Date only
        lastWeeklyReset: getWeekStart().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Get week start date (Monday)
 */
function getWeekStart() {
    var now = new Date();
    var day = now.getDay();
    var diff = now.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(now.setDate(diff));
}

/**
 * Check and reset daily/weekly quests if needed
 */
function checkQuestResets(data) {
    var today = new Date().toISOString().split('T')[0];
    var currentWeekStart = getWeekStart().toISOString();
    var needsSave = false;
    
    // Daily reset
    if (data.lastDailyReset !== today) {
        for (var dqId in data.dailyQuests) {
            data.dailyQuests[dqId].current = 0;
            data.dailyQuests[dqId].completed = false;
            data.dailyQuests[dqId].claimed = false;
        }
        // Auto-complete login quest
        data.dailyQuests["daily_login"].current = 1;
        data.dailyQuests["daily_login"].completed = true;
        
        data.lastDailyReset = today;
        needsSave = true;
    }
    
    // Weekly reset
    if (data.lastWeeklyReset !== currentWeekStart) {
        for (var wqId in data.weeklyQuests) {
            data.weeklyQuests[wqId].current = 0;
            data.weeklyQuests[wqId].completed = false;
            data.weeklyQuests[wqId].claimed = false;
        }
        data.lastWeeklyReset = currentWeekStart;
        needsSave = true;
    }
    
    return needsSave;
}

/**
 * Calculate level from XP
 */
function calculateLevel(xp) {
    var level = Math.floor(xp / SEASON_CONFIG.xpPerLevel) + 1;
    return Math.min(level, SEASON_CONFIG.maxLevel);
}

/**
 * RPC: season_pass_get_status
 * Get current season pass status
 */
function rpcSeasonPassGetStatus(ctx, logger, nk, payload) {
    logger.info("[SeasonPass] RPC season_pass_get_status called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    var gameId = data.gameId;
    if (!gameId) {
        return JSON.stringify({ success: false, error: "Missing required field: gameId" });
    }
    
    var seasonInfo = getCurrentSeasonInfo();
    var passData = getSeasonPassData(nk, logger, ctx.userId, gameId);
    
    // Initialize if new or different season
    if (!passData || passData.seasonNumber !== seasonInfo.seasonNumber) {
        var wasPremium = passData ? passData.isPremium : false;
        passData = initializeSeasonPass(seasonInfo, wasPremium);
        saveSeasonPassData(nk, logger, ctx.userId, gameId, passData);
    }
    
    // Check quest resets
    if (checkQuestResets(passData)) {
        saveSeasonPassData(nk, logger, ctx.userId, gameId, passData);
    }
    
    // Build daily quests response
    var dailyQuests = [];
    for (var i = 0; i < DAILY_QUESTS.length; i++) {
        var dq = DAILY_QUESTS[i];
        var progress = passData.dailyQuests[dq.id];
        dailyQuests.push({
            id: dq.id,
            title: dq.title,
            description: dq.description,
            xp: dq.xp,
            current: progress.current,
            target: progress.target,
            completed: progress.completed,
            claimed: progress.claimed
        });
    }
    
    // Build weekly quests response
    var weeklyQuests = [];
    for (var j = 0; j < WEEKLY_QUESTS.length; j++) {
        var wq = WEEKLY_QUESTS[j];
        var wprogress = passData.weeklyQuests[wq.id];
        weeklyQuests.push({
            id: wq.id,
            title: wq.title,
            description: wq.description,
            xp: wq.xp,
            current: wprogress.current,
            target: wprogress.target,
            completed: wprogress.completed,
            claimed: wprogress.claimed
        });
    }
    
    // Build rewards for current level range
    var currentLevel = passData.level;
    var xpForNextLevel = (currentLevel < SEASON_CONFIG.maxLevel) 
        ? (currentLevel * SEASON_CONFIG.xpPerLevel) - passData.xp + SEASON_CONFIG.xpPerLevel
        : 0;
    
    return JSON.stringify({
        success: true,
        userId: ctx.userId,
        gameId: gameId,
        season: seasonInfo,
        level: currentLevel,
        xp: passData.xp,
        totalXpEarned: passData.totalXpEarned,
        xpToNextLevel: Math.max(0, xpForNextLevel),
        xpPerLevel: SEASON_CONFIG.xpPerLevel,
        maxLevel: SEASON_CONFIG.maxLevel,
        isPremium: passData.isPremium,
        premiumPrice: SEASON_CONFIG.premiumPrice,
        dailyQuests: dailyQuests,
        weeklyQuests: weeklyQuests,
        freeRewardsClaimed: passData.freeRewardsClaimed,
        premiumRewardsClaimed: passData.premiumRewardsClaimed,
        freeRewards: FREE_REWARDS,
        premiumRewards: PREMIUM_REWARDS,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: season_pass_add_xp
 * Add XP to season pass
 */
function rpcSeasonPassAddXP(ctx, logger, nk, payload) {
    logger.info("[SeasonPass] RPC season_pass_add_xp called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    if (!data.gameId || data.xp === undefined) {
        return JSON.stringify({ success: false, error: "Missing required fields: gameId, xp" });
    }
    
    var gameId = data.gameId;
    var xpToAdd = parseInt(data.xp);
    var source = data.source || "unknown";
    
    var seasonInfo = getCurrentSeasonInfo();
    var passData = getSeasonPassData(nk, logger, ctx.userId, gameId);
    
    if (!passData || passData.seasonNumber !== seasonInfo.seasonNumber) {
        return JSON.stringify({ success: false, error: "Season pass not initialized" });
    }
    
    var oldLevel = passData.level;
    passData.xp += xpToAdd;
    passData.totalXpEarned += xpToAdd;
    
    // Calculate new level
    passData.level = calculateLevel(passData.totalXpEarned);
    var leveledUp = passData.level > oldLevel;
    var levelsGained = passData.level - oldLevel;
    
    passData.updatedAt = new Date().toISOString();
    saveSeasonPassData(nk, logger, ctx.userId, gameId, passData);
    
    logger.info("[SeasonPass] Added " + xpToAdd + " XP from " + source + " for user " + ctx.userId + ", level: " + passData.level);
    
    return JSON.stringify({
        success: true,
        xpAdded: xpToAdd,
        source: source,
        totalXp: passData.totalXpEarned,
        level: passData.level,
        oldLevel: oldLevel,
        leveledUp: leveledUp,
        levelsGained: levelsGained,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: season_pass_complete_quest
 * Complete and claim a quest
 */
function rpcSeasonPassCompleteQuest(ctx, logger, nk, payload) {
    logger.info("[SeasonPass] RPC season_pass_complete_quest called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    if (!data.gameId || !data.questId || !data.questType) {
        return JSON.stringify({ success: false, error: "Missing required fields: gameId, questId, questType" });
    }
    
    var gameId = data.gameId;
    var questId = data.questId;
    var questType = data.questType; // "daily" or "weekly"
    var value = data.value !== undefined ? data.value : 1;
    
    var passData = getSeasonPassData(nk, logger, ctx.userId, gameId);
    if (!passData) {
        return JSON.stringify({ success: false, error: "Season pass not initialized" });
    }
    
    // Check resets
    checkQuestResets(passData);
    
    // Get quest config and progress
    var questConfig = null;
    var questProgress = null;
    var xpReward = 0;
    
    if (questType === "daily") {
        for (var i = 0; i < DAILY_QUESTS.length; i++) {
            if (DAILY_QUESTS[i].id === questId) {
                questConfig = DAILY_QUESTS[i];
                break;
            }
        }
        questProgress = passData.dailyQuests[questId];
        xpReward = questConfig ? questConfig.xp : 0;
    } else if (questType === "weekly") {
        for (var j = 0; j < WEEKLY_QUESTS.length; j++) {
            if (WEEKLY_QUESTS[j].id === questId) {
                questConfig = WEEKLY_QUESTS[j];
                break;
            }
        }
        questProgress = passData.weeklyQuests[questId];
        xpReward = questConfig ? questConfig.xp : 0;
    }
    
    if (!questConfig || !questProgress) {
        return JSON.stringify({ success: false, error: "Quest not found: " + questId });
    }
    
    if (questProgress.claimed) {
        return JSON.stringify({ success: true, alreadyClaimed: true });
    }
    
    // Update progress
    questProgress.current = Math.min(questProgress.current + value, questProgress.target);
    
    // Check completion
    var justCompleted = false;
    if (questProgress.current >= questProgress.target && !questProgress.completed) {
        questProgress.completed = true;
        justCompleted = true;
    }
    
    // Auto-claim if completed
    var xpEarned = 0;
    if (questProgress.completed && !questProgress.claimed) {
        questProgress.claimed = true;
        
        // Add XP
        var oldLevel = passData.level;
        passData.xp += xpReward;
        passData.totalXpEarned += xpReward;
        passData.level = calculateLevel(passData.totalXpEarned);
        xpEarned = xpReward;
        
        logger.info("[SeasonPass] Quest " + questId + " completed, +" + xpReward + " XP");
    }
    
    passData.updatedAt = new Date().toISOString();
    saveSeasonPassData(nk, logger, ctx.userId, gameId, passData);
    
    return JSON.stringify({
        success: true,
        questId: questId,
        questType: questType,
        current: questProgress.current,
        target: questProgress.target,
        completed: questProgress.completed,
        claimed: questProgress.claimed,
        justCompleted: justCompleted,
        xpEarned: xpEarned,
        newLevel: passData.level,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: season_pass_claim_reward
 * Claim a level reward
 */
function rpcSeasonPassClaimReward(ctx, logger, nk, payload) {
    logger.info("[SeasonPass] RPC season_pass_claim_reward called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    if (!data.gameId || !data.level || !data.track) {
        return JSON.stringify({ success: false, error: "Missing required fields: gameId, level, track" });
    }
    
    var gameId = data.gameId;
    var level = parseInt(data.level);
    var track = data.track; // "free" or "premium"
    
    var passData = getSeasonPassData(nk, logger, ctx.userId, gameId);
    if (!passData) {
        return JSON.stringify({ success: false, error: "Season pass not initialized" });
    }
    
    // Check if level is reached
    if (passData.level < level) {
        return JSON.stringify({ success: false, error: "Level " + level + " not reached yet" });
    }
    
    // Check track eligibility
    if (track === "premium" && !passData.isPremium) {
        return JSON.stringify({ success: false, error: "Premium pass required" });
    }
    
    // Get reward
    var rewardMap = track === "premium" ? PREMIUM_REWARDS : FREE_REWARDS;
    var reward = rewardMap[level];
    
    if (!reward) {
        return JSON.stringify({ success: false, error: "No reward at level " + level + " for " + track + " track" });
    }
    
    // Check if already claimed
    var claimedMap = track === "premium" ? passData.premiumRewardsClaimed : passData.freeRewardsClaimed;
    if (claimedMap[level]) {
        return JSON.stringify({ success: false, error: "Reward already claimed" });
    }
    
    // Mark as claimed
    claimedMap[level] = true;
    passData.updatedAt = new Date().toISOString();
    saveSeasonPassData(nk, logger, ctx.userId, gameId, passData);
    
    logger.info("[SeasonPass] Level " + level + " " + track + " reward claimed by user " + ctx.userId);
    
    return JSON.stringify({
        success: true,
        level: level,
        track: track,
        reward: reward,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: season_pass_purchase_premium
 * Purchase premium season pass
 */
function rpcSeasonPassPurchasePremium(ctx, logger, nk, payload) {
    logger.info("[SeasonPass] RPC season_pass_purchase_premium called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    if (!data.gameId) {
        return JSON.stringify({ success: false, error: "Missing required field: gameId" });
    }
    
    var gameId = data.gameId;
    
    var passData = getSeasonPassData(nk, logger, ctx.userId, gameId);
    if (!passData) {
        return JSON.stringify({ success: false, error: "Season pass not initialized" });
    }
    
    if (passData.isPremium) {
        return JSON.stringify({ success: false, error: "Already premium" });
    }
    
    // In production, verify IAP receipt here
    // For now, just mark as premium
    passData.isPremium = true;
    passData.premiumPurchaseDate = new Date().toISOString();
    passData.updatedAt = new Date().toISOString();
    
    saveSeasonPassData(nk, logger, ctx.userId, gameId, passData);
    
    logger.info("[SeasonPass] Premium purchased by user " + ctx.userId);
    
    return JSON.stringify({
        success: true,
        isPremium: true,
        currentLevel: passData.level,
        availablePremiumRewards: Object.keys(PREMIUM_REWARDS).filter(function(l) { return parseInt(l) <= passData.level; }),
        timestamp: new Date().toISOString()
    });
}

// Export functions
export {
    rpcSeasonPassGetStatus,
    rpcSeasonPassAddXP,
    rpcSeasonPassCompleteQuest,
    rpcSeasonPassClaimReward,
    rpcSeasonPassPurchasePremium
};

