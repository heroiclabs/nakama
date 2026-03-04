// monthly_milestones.js - Monthly Milestones System for D30 Retention
// Provides long-term goals that reset monthly

/**
 * Monthly Milestones System
 * 
 * Features:
 * - 12 milestones per month with escalating difficulty
 * - Legendary reward for completing all 12
 * - Progress carries over within month
 * - Per-game support
 */

// Monthly milestones configuration
var MONTHLY_MILESTONES = [
    { id: "quiz_50", title: "Quiz Master", description: "Complete 50 quizzes", target: 50, reward: { coins: 500 }, category: "engagement" },
    { id: "streak_7", title: "Week Warrior", description: "Login 7 consecutive days", target: 7, reward: { mysteryBox: 1 }, category: "streak" },
    { id: "accuracy_80", title: "Sharpshooter", description: "Reach 80% accuracy", target: 80, reward: { badge: "accurate" }, category: "skill" },
    { id: "win_5", title: "Champion", description: "Win 5 multiplayer battles", target: 5, reward: { gems: 100 }, category: "competitive" },
    { id: "create_3", title: "Creator", description: "Create 3 quizzes with Link & Play", target: 3, reward: { badge: "creator" }, category: "content" },
    { id: "invite_1", title: "Social", description: "Invite 1 friend who plays", target: 1, reward: { coins: 200, coinsForFriend: 200 }, category: "social" },
    { id: "guild_join", title: "Team Player", description: "Join or create a guild", target: 1, reward: { coins: 300 }, category: "social" },
    { id: "weekly_goals", title: "Goal Getter", description: "Complete all weekly goals", target: 1, reward: { mysteryBox: 1 }, category: "engagement" },
    { id: "questions_1000", title: "1K Club", description: "Answer 1000 questions", target: 1000, reward: { title: "1K Club", badge: "1k_club" }, category: "volume" },
    { id: "level_20", title: "Leveled Up", description: "Reach Level 20", target: 20, reward: { avatar: "level_20" }, category: "progression" },
    { id: "tournament_50", title: "Competitor", description: "Top 50 in weekly tournament", target: 50, reward: { badge: "competitor", gems: 150 }, category: "competitive" },
    { id: "season_25", title: "Season Climber", description: "Reach Season Pass Level 25", target: 25, reward: { coins: 1000, frame: "milestone_frame" }, category: "progression" }
];

// Legendary reward for completing all milestones
var LEGENDARY_REWARD = {
    coins: 5000,
    gems: 500,
    avatar: "legendary_monthly",
    title: "Monthly Legend",
    badge: "monthly_legend",
    frame: "legendary_frame"
};

/**
 * Get current month info
 */
function getCurrentMonthInfo() {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth() + 1;
    
    // Days remaining in month
    var lastDay = new Date(year, month, 0).getDate();
    var currentDay = now.getDate();
    var daysRemaining = lastDay - currentDay;
    
    return {
        year: year,
        month: month,
        monthKey: year + "_" + (month < 10 ? "0" + month : month),
        daysRemaining: daysRemaining,
        totalDays: lastDay
    };
}

/**
 * Read milestones progress for user
 */
function getMilestonesProgress(nk, logger, userId, gameId) {
    var collection = "monthly_milestones";
    var monthInfo = getCurrentMonthInfo();
    var key = "progress_" + userId + "_" + gameId + "_" + monthInfo.monthKey;
    
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
        logger.warn("[MonthlyMilestones] Failed to read progress: " + err.message);
    }
    
    return null;
}

/**
 * Save milestones progress
 */
function saveMilestonesProgress(nk, logger, userId, gameId, data) {
    var collection = "monthly_milestones";
    var monthInfo = getCurrentMonthInfo();
    var key = "progress_" + userId + "_" + gameId + "_" + monthInfo.monthKey;
    
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
        logger.error("[MonthlyMilestones] Failed to save progress: " + err.message);
        return false;
    }
}

/**
 * Initialize milestones for new month
 */
function initializeMilestones(monthInfo) {
    var milestones = {};
    
    for (var i = 0; i < MONTHLY_MILESTONES.length; i++) {
        var m = MONTHLY_MILESTONES[i];
        milestones[m.id] = {
            current: 0,
            target: m.target,
            completed: false,
            claimed: false
        };
    }
    
    return {
        monthKey: monthInfo.monthKey,
        year: monthInfo.year,
        month: monthInfo.month,
        milestones: milestones,
        totalCompleted: 0,
        allCompleted: false,
        legendaryRewardClaimed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

/**
 * RPC: monthly_milestones_get_status
 * Get current monthly milestones status
 */
function rpcMonthlyMilestonesGetStatus(ctx, logger, nk, payload) {
    logger.info("[MonthlyMilestones] RPC monthly_milestones_get_status called");
    
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
    
    var monthInfo = getCurrentMonthInfo();
    var progress = getMilestonesProgress(nk, logger, ctx.userId, gameId);
    
    // Initialize if new month
    if (!progress || progress.monthKey !== monthInfo.monthKey) {
        progress = initializeMilestones(monthInfo);
        saveMilestonesProgress(nk, logger, ctx.userId, gameId, progress);
    }
    
    // Build milestones array with details
    var milestonesArray = [];
    var completedCount = 0;
    
    for (var i = 0; i < MONTHLY_MILESTONES.length; i++) {
        var m = MONTHLY_MILESTONES[i];
        var p = progress.milestones[m.id];
        
        if (p.completed) completedCount++;
        
        milestonesArray.push({
            id: m.id,
            title: m.title,
            description: m.description,
            category: m.category,
            current: p.current,
            target: p.target,
            completed: p.completed,
            claimed: p.claimed,
            reward: m.reward,
            progress: Math.min(100, Math.round((p.current / p.target) * 100))
        });
    }
    
    return JSON.stringify({
        success: true,
        userId: ctx.userId,
        gameId: gameId,
        month: monthInfo,
        milestones: milestonesArray,
        totalMilestones: MONTHLY_MILESTONES.length,
        completedCount: completedCount,
        allCompleted: progress.allCompleted,
        legendaryReward: LEGENDARY_REWARD,
        legendaryRewardClaimed: progress.legendaryRewardClaimed,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: monthly_milestones_update_progress
 * Update progress on a milestone
 */
function rpcMonthlyMilestonesUpdateProgress(ctx, logger, nk, payload) {
    logger.info("[MonthlyMilestones] RPC monthly_milestones_update_progress called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    if (!data.gameId || !data.milestoneId) {
        return JSON.stringify({ success: false, error: "Missing required fields: gameId, milestoneId" });
    }
    
    var gameId = data.gameId;
    var milestoneId = data.milestoneId;
    var value = data.value !== undefined ? data.value : 1;
    var increment = data.increment !== false;
    var setMax = data.setMax || false; // For accuracy-type milestones
    
    var monthInfo = getCurrentMonthInfo();
    var progress = getMilestonesProgress(nk, logger, ctx.userId, gameId);
    
    if (!progress || progress.monthKey !== monthInfo.monthKey) {
        return JSON.stringify({ success: false, error: "Milestones not initialized for this month" });
    }
    
    var milestone = progress.milestones[milestoneId];
    if (!milestone) {
        return JSON.stringify({ success: false, error: "Milestone not found: " + milestoneId });
    }
    
    if (milestone.completed) {
        return JSON.stringify({
            success: true,
            milestoneId: milestoneId,
            alreadyCompleted: true,
            current: milestone.current,
            target: milestone.target
        });
    }
    
    // Update progress
    if (setMax) {
        milestone.current = Math.max(milestone.current, value);
    } else if (increment) {
        milestone.current += value;
    } else {
        milestone.current = value;
    }
    
    // Check completion
    var justCompleted = false;
    if (milestone.current >= milestone.target && !milestone.completed) {
        milestone.completed = true;
        justCompleted = true;
        progress.totalCompleted++;
        
        logger.info("[MonthlyMilestones] Milestone completed: " + milestoneId + " by user " + ctx.userId);
    }
    
    // Check if all completed
    if (progress.totalCompleted >= MONTHLY_MILESTONES.length && !progress.allCompleted) {
        progress.allCompleted = true;
        logger.info("[MonthlyMilestones] All milestones completed by user " + ctx.userId);
    }
    
    progress.updatedAt = new Date().toISOString();
    saveMilestonesProgress(nk, logger, ctx.userId, gameId, progress);
    
    return JSON.stringify({
        success: true,
        milestoneId: milestoneId,
        current: milestone.current,
        target: milestone.target,
        completed: milestone.completed,
        justCompleted: justCompleted,
        totalCompleted: progress.totalCompleted,
        allCompleted: progress.allCompleted,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: monthly_milestones_claim_reward
 * Claim reward for a completed milestone
 */
function rpcMonthlyMilestonesClaimReward(ctx, logger, nk, payload) {
    logger.info("[MonthlyMilestones] RPC monthly_milestones_claim_reward called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    if (!data.gameId || !data.milestoneId) {
        return JSON.stringify({ success: false, error: "Missing required fields: gameId, milestoneId" });
    }
    
    var gameId = data.gameId;
    var milestoneId = data.milestoneId;
    
    var progress = getMilestonesProgress(nk, logger, ctx.userId, gameId);
    if (!progress) {
        return JSON.stringify({ success: false, error: "Milestones not initialized" });
    }
    
    var milestone = progress.milestones[milestoneId];
    if (!milestone) {
        return JSON.stringify({ success: false, error: "Milestone not found" });
    }
    
    if (!milestone.completed) {
        return JSON.stringify({ success: false, error: "Milestone not completed" });
    }
    
    if (milestone.claimed) {
        return JSON.stringify({ success: false, error: "Reward already claimed" });
    }
    
    // Find reward
    var reward = null;
    for (var i = 0; i < MONTHLY_MILESTONES.length; i++) {
        if (MONTHLY_MILESTONES[i].id === milestoneId) {
            reward = MONTHLY_MILESTONES[i].reward;
            break;
        }
    }
    
    milestone.claimed = true;
    progress.updatedAt = new Date().toISOString();
    saveMilestonesProgress(nk, logger, ctx.userId, gameId, progress);
    
    logger.info("[MonthlyMilestones] Reward claimed for " + milestoneId + " by user " + ctx.userId);
    
    return JSON.stringify({
        success: true,
        milestoneId: milestoneId,
        reward: reward,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: monthly_milestones_claim_legendary
 * Claim legendary reward for completing all milestones
 */
function rpcMonthlyMilestonesClaimLegendary(ctx, logger, nk, payload) {
    logger.info("[MonthlyMilestones] RPC monthly_milestones_claim_legendary called");
    
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
    
    var progress = getMilestonesProgress(nk, logger, ctx.userId, gameId);
    if (!progress) {
        return JSON.stringify({ success: false, error: "Milestones not initialized" });
    }
    
    if (!progress.allCompleted) {
        return JSON.stringify({ success: false, error: "Not all milestones completed" });
    }
    
    if (progress.legendaryRewardClaimed) {
        return JSON.stringify({ success: false, error: "Legendary reward already claimed" });
    }
    
    progress.legendaryRewardClaimed = true;
    progress.updatedAt = new Date().toISOString();
    saveMilestonesProgress(nk, logger, ctx.userId, gameId, progress);
    
    logger.info("[MonthlyMilestones] Legendary reward claimed by user " + ctx.userId);
    
    return JSON.stringify({
        success: true,
        reward: LEGENDARY_REWARD,
        message: "Congratulations! You've achieved Monthly Legend status!",
        timestamp: new Date().toISOString()
    });
}

// Export functions
export {
    rpcMonthlyMilestonesGetStatus,
    rpcMonthlyMilestonesUpdateProgress,
    rpcMonthlyMilestonesClaimReward,
    rpcMonthlyMilestonesClaimLegendary
};

