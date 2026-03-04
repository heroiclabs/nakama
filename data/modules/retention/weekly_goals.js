// weekly_goals.js - Weekly Goals System for D7 Retention
// Provides progressive daily goals that reset weekly

/**
 * Weekly Goals System
 * 
 * Features:
 * - 7 progressive daily goals that build engagement
 * - Week streak bonuses for consecutive weeks
 * - Mystery box rewards for completing all 7 days
 * - Per-game support
 */

// Default weekly goals configuration
var DEFAULT_WEEKLY_GOALS = [
    { day: 1, id: "login", title: "Welcome Back", description: "Log in to the app", reward: { coins: 50 }, autoComplete: true },
    { day: 2, id: "complete_quizzes", title: "Quiz Starter", description: "Complete 3 quizzes", target: 3, reward: { coins: 100, xp: 50 } },
    { day: 3, id: "win_multiplayer", title: "Champion", description: "Win 1 multiplayer match", target: 1, reward: { coins: 150, xp: 75 } },
    { day: 4, id: "accuracy", title: "Precision", description: "Score 80%+ on any quiz", target: 80, reward: { coins: 200, xp: 100 } },
    { day: 5, id: "challenge_friend", title: "Social", description: "Challenge a friend", target: 1, reward: { coins: 250, xp: 125 } },
    { day: 6, id: "create_quiz", title: "Creator", description: "Create a quiz with Link & Play", target: 1, reward: { coins: 300, xp: 150 } },
    { day: 7, id: "complete_all", title: "Weekly Master", description: "Complete all weekly goals", reward: { coins: 500, xp: 250, mysteryBox: true } }
];

// Week streak bonus multipliers
var WEEK_STREAK_MULTIPLIERS = {
    1: 1.0,   // Week 1: Normal
    2: 1.25,  // Week 2: 25% bonus
    3: 1.5,   // Week 3: 50% bonus
    4: 2.0,   // Week 4+: Double rewards
};

/**
 * Get current week number (ISO week)
 */
function getCurrentWeekNumber() {
    var now = new Date();
    var startOfYear = new Date(now.getFullYear(), 0, 1);
    var days = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000));
    return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

/**
 * Get current year
 */
function getCurrentYear() {
    return new Date().getFullYear();
}

/**
 * Get day of week (1-7, Monday = 1)
 */
function getCurrentDayOfWeek() {
    var day = new Date().getDay();
    return day === 0 ? 7 : day; // Sunday becomes 7
}

/**
 * Read weekly goals progress for user
 */
function getWeeklyGoalsProgress(nk, logger, userId, gameId) {
    var collection = "weekly_goals";
    var key = "progress_" + userId + "_" + gameId;
    
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
        logger.warn("[WeeklyGoals] Failed to read progress: " + err.message);
    }
    
    return null;
}

/**
 * Save weekly goals progress
 */
function saveWeeklyGoalsProgress(nk, logger, userId, gameId, data) {
    var collection = "weekly_goals";
    var key = "progress_" + userId + "_" + gameId;
    
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
        logger.error("[WeeklyGoals] Failed to save progress: " + err.message);
        return false;
    }
}

/**
 * Initialize or reset weekly goals for a new week
 */
function initializeWeeklyGoals(currentWeek, currentYear, weekStreak) {
    var goals = {};
    
    for (var i = 0; i < DEFAULT_WEEKLY_GOALS.length; i++) {
        var goal = DEFAULT_WEEKLY_GOALS[i];
        goals[goal.id] = {
            day: goal.day,
            title: goal.title,
            description: goal.description,
            target: goal.target || 1,
            current: 0,
            completed: false,
            claimed: false,
            reward: goal.reward,
            autoComplete: goal.autoComplete || false
        };
    }
    
    return {
        weekNumber: currentWeek,
        year: currentYear,
        weekStreak: weekStreak,
        goals: goals,
        allCompleted: false,
        bonusClaimed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Calculate reward with week streak multiplier
 */
function calculateRewardWithMultiplier(reward, weekStreak) {
    var multiplier = WEEK_STREAK_MULTIPLIERS[Math.min(weekStreak, 4)] || 2.0;
    
    var adjustedReward = {};
    if (reward.coins) adjustedReward.coins = Math.floor(reward.coins * multiplier);
    if (reward.xp) adjustedReward.xp = Math.floor(reward.xp * multiplier);
    if (reward.gems) adjustedReward.gems = Math.floor(reward.gems * multiplier);
    if (reward.mysteryBox) adjustedReward.mysteryBox = true;
    
    return adjustedReward;
}

/**
 * RPC: weekly_goals_get_status
 * Get current weekly goals status
 */
function rpcWeeklyGoalsGetStatus(ctx, logger, nk, payload) {
    logger.info("[WeeklyGoals] RPC weekly_goals_get_status called");
    
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
    
    var currentWeek = getCurrentWeekNumber();
    var currentYear = getCurrentYear();
    var currentDay = getCurrentDayOfWeek();
    
    // Get existing progress
    var progress = getWeeklyGoalsProgress(nk, logger, ctx.userId, gameId);
    
    // Check if we need to reset for a new week
    if (!progress || progress.weekNumber !== currentWeek || progress.year !== currentYear) {
        // Calculate week streak
        var weekStreak = 1;
        if (progress) {
            var wasLastWeek = (progress.weekNumber === currentWeek - 1 && progress.year === currentYear) ||
                              (currentWeek === 1 && progress.weekNumber === 52 && progress.year === currentYear - 1);
            
            if (wasLastWeek && progress.allCompleted) {
                weekStreak = (progress.weekStreak || 0) + 1;
            }
        }
        
        // Initialize new week
        progress = initializeWeeklyGoals(currentWeek, currentYear, weekStreak);
        
        // Auto-complete day 1 login goal
        progress.goals["login"].current = 1;
        progress.goals["login"].completed = true;
        
        saveWeeklyGoalsProgress(nk, logger, ctx.userId, gameId, progress);
        
        logger.info("[WeeklyGoals] New week initialized for user " + ctx.userId + ", week streak: " + weekStreak);
    }
    
    // Build response with goal details
    var goalsArray = [];
    var totalCompleted = 0;
    var totalGoals = Object.keys(progress.goals).length;
    
    for (var goalId in progress.goals) {
        var goal = progress.goals[goalId];
        var adjustedReward = calculateRewardWithMultiplier(goal.reward, progress.weekStreak);
        
        goalsArray.push({
            id: goalId,
            day: goal.day,
            title: goal.title,
            description: goal.description,
            target: goal.target,
            current: goal.current,
            completed: goal.completed,
            claimed: goal.claimed,
            reward: adjustedReward,
            isUnlocked: goal.day <= currentDay,
            isToday: goal.day === currentDay
        });
        
        if (goal.completed) totalCompleted++;
    }
    
    // Sort by day
    goalsArray.sort(function(a, b) { return a.day - b.day; });
    
    return JSON.stringify({
        success: true,
        userId: ctx.userId,
        gameId: gameId,
        weekNumber: currentWeek,
        year: currentYear,
        currentDay: currentDay,
        weekStreak: progress.weekStreak,
        weekStreakMultiplier: WEEK_STREAK_MULTIPLIERS[Math.min(progress.weekStreak, 4)] || 2.0,
        goals: goalsArray,
        totalCompleted: totalCompleted,
        totalGoals: totalGoals,
        allCompleted: progress.allCompleted,
        bonusClaimed: progress.bonusClaimed,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: weekly_goals_update_progress
 * Update progress on a specific goal
 */
function rpcWeeklyGoalsUpdateProgress(ctx, logger, nk, payload) {
    logger.info("[WeeklyGoals] RPC weekly_goals_update_progress called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    if (!data.gameId || !data.goalId) {
        return JSON.stringify({ success: false, error: "Missing required fields: gameId, goalId" });
    }
    
    var gameId = data.gameId;
    var goalId = data.goalId;
    var value = data.value !== undefined ? data.value : 1;
    var increment = data.increment !== false;
    
    var currentWeek = getCurrentWeekNumber();
    var currentYear = getCurrentYear();
    var currentDay = getCurrentDayOfWeek();
    
    // Get progress
    var progress = getWeeklyGoalsProgress(nk, logger, ctx.userId, gameId);
    
    if (!progress || progress.weekNumber !== currentWeek) {
        return JSON.stringify({ success: false, error: "Weekly goals not initialized. Call get_status first." });
    }
    
    var goal = progress.goals[goalId];
    if (!goal) {
        return JSON.stringify({ success: false, error: "Goal not found: " + goalId });
    }
    
    // Check if goal day is unlocked
    if (goal.day > currentDay) {
        return JSON.stringify({ success: false, error: "This goal is not yet unlocked" });
    }
    
    // Don't update if already completed
    if (goal.completed) {
        return JSON.stringify({
            success: true,
            goalId: goalId,
            alreadyCompleted: true,
            current: goal.current,
            target: goal.target
        });
    }
    
    // Update progress
    if (increment) {
        goal.current += value;
    } else {
        goal.current = Math.max(goal.current, value);
    }
    
    // Check completion
    var justCompleted = false;
    if (goal.current >= goal.target && !goal.completed) {
        goal.completed = true;
        justCompleted = true;
        logger.info("[WeeklyGoals] Goal completed: " + goalId + " by user " + ctx.userId);
    }
    
    // Check if all goals completed
    var allCompleted = true;
    for (var gid in progress.goals) {
        if (gid !== "complete_all" && !progress.goals[gid].completed) {
            allCompleted = false;
            break;
        }
    }
    
    // Auto-complete the "complete all" goal
    if (allCompleted && !progress.goals["complete_all"].completed) {
        progress.goals["complete_all"].current = 1;
        progress.goals["complete_all"].completed = true;
        progress.allCompleted = true;
        logger.info("[WeeklyGoals] All goals completed by user " + ctx.userId);
    }
    
    progress.updatedAt = new Date().toISOString();
    saveWeeklyGoalsProgress(nk, logger, ctx.userId, gameId, progress);
    
    return JSON.stringify({
        success: true,
        goalId: goalId,
        current: goal.current,
        target: goal.target,
        completed: goal.completed,
        justCompleted: justCompleted,
        allCompleted: progress.allCompleted,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: weekly_goals_claim_reward
 * Claim reward for a completed goal
 */
function rpcWeeklyGoalsClaimReward(ctx, logger, nk, payload) {
    logger.info("[WeeklyGoals] RPC weekly_goals_claim_reward called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    if (!data.gameId || !data.goalId) {
        return JSON.stringify({ success: false, error: "Missing required fields: gameId, goalId" });
    }
    
    var gameId = data.gameId;
    var goalId = data.goalId;
    
    var currentWeek = getCurrentWeekNumber();
    
    // Get progress
    var progress = getWeeklyGoalsProgress(nk, logger, ctx.userId, gameId);
    
    if (!progress || progress.weekNumber !== currentWeek) {
        return JSON.stringify({ success: false, error: "Weekly goals not initialized" });
    }
    
    var goal = progress.goals[goalId];
    if (!goal) {
        return JSON.stringify({ success: false, error: "Goal not found: " + goalId });
    }
    
    if (!goal.completed) {
        return JSON.stringify({ success: false, error: "Goal not completed yet" });
    }
    
    if (goal.claimed) {
        return JSON.stringify({ success: false, error: "Reward already claimed" });
    }
    
    // Calculate reward with multiplier
    var reward = calculateRewardWithMultiplier(goal.reward, progress.weekStreak);
    
    // Mark as claimed
    goal.claimed = true;
    progress.updatedAt = new Date().toISOString();
    saveWeeklyGoalsProgress(nk, logger, ctx.userId, gameId, progress);
    
    // Log transaction
    try {
        var transactionKey = "weekly_goal_reward_" + ctx.userId + "_" + Date.now();
        nk.storageWrite([{
            collection: "transaction_logs",
            key: transactionKey,
            userId: ctx.userId,
            value: {
                type: "weekly_goal_reward",
                goalId: goalId,
                weekNumber: currentWeek,
                reward: reward,
                weekStreak: progress.weekStreak,
                timestamp: new Date().toISOString()
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (err) {
        logger.warn("[WeeklyGoals] Failed to log transaction: " + err.message);
    }
    
    // Grant rewards to wallet
    var walletChanges = {};
    if (reward.coins) walletChanges.coins = reward.coins;
    if (reward.gems) walletChanges.gems = reward.gems;
    if (reward.xp) walletChanges.xp = reward.xp;
    if (Object.keys(walletChanges).length > 0) {
        try {
            nk.walletUpdate(ctx.userId, walletChanges, { source: "weekly_goal", goalId: goalId }, true);
            logger.info("[WeeklyGoals] Granted wallet: " + JSON.stringify(walletChanges) + " to " + ctx.userId);
        } catch (walletErr) {
            logger.error("[WeeklyGoals] Wallet grant failed: " + walletErr.message);
        }
    }
    
    logger.info("[WeeklyGoals] Reward claimed for goal " + goalId + " by user " + ctx.userId);
    
    return JSON.stringify({
        success: true,
        goalId: goalId,
        reward: reward,
        walletGranted: walletChanges,
        weekStreak: progress.weekStreak,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: weekly_goals_claim_bonus
 * Claim bonus for completing all weekly goals
 */
function rpcWeeklyGoalsClaimBonus(ctx, logger, nk, payload) {
    logger.info("[WeeklyGoals] RPC weekly_goals_claim_bonus called");
    
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
    var currentWeek = getCurrentWeekNumber();
    
    // Get progress
    var progress = getWeeklyGoalsProgress(nk, logger, ctx.userId, gameId);
    
    if (!progress || progress.weekNumber !== currentWeek) {
        return JSON.stringify({ success: false, error: "Weekly goals not initialized" });
    }
    
    if (!progress.allCompleted) {
        return JSON.stringify({ success: false, error: "Not all goals completed" });
    }
    
    if (progress.bonusClaimed) {
        return JSON.stringify({ success: false, error: "Bonus already claimed" });
    }
    
    // Calculate bonus with streak multiplier
    var baseBonus = { coins: 500, gems: 100, mysteryBox: true };
    var bonus = calculateRewardWithMultiplier(baseBonus, progress.weekStreak);
    
    // Mark as claimed
    progress.bonusClaimed = true;
    progress.updatedAt = new Date().toISOString();
    saveWeeklyGoalsProgress(nk, logger, ctx.userId, gameId, progress);
    
    // Grant bonus rewards to wallet
    var bonusWalletChanges = {};
    if (bonus.coins) bonusWalletChanges.coins = bonus.coins;
    if (bonus.gems) bonusWalletChanges.gems = bonus.gems;
    if (Object.keys(bonusWalletChanges).length > 0) {
        try {
            nk.walletUpdate(ctx.userId, bonusWalletChanges, { source: "weekly_goal_bonus", weekStreak: progress.weekStreak }, true);
            logger.info("[WeeklyGoals] Granted bonus wallet: " + JSON.stringify(bonusWalletChanges) + " to " + ctx.userId);
        } catch (walletErr) {
            logger.error("[WeeklyGoals] Bonus wallet grant failed: " + walletErr.message);
        }
    }
    
    logger.info("[WeeklyGoals] Week bonus claimed by user " + ctx.userId + ", streak: " + progress.weekStreak);
    
    return JSON.stringify({
        success: true,
        bonus: bonus,
        walletGranted: bonusWalletChanges,
        weekStreak: progress.weekStreak,
        message: progress.weekStreak >= 4 ? "4+ Week Streak! DOUBLE REWARDS!" : "Week " + progress.weekStreak + " completed!",
        timestamp: new Date().toISOString()
    });
}

// Export functions
export {
    rpcWeeklyGoalsGetStatus,
    rpcWeeklyGoalsUpdateProgress,
    rpcWeeklyGoalsClaimReward,
    rpcWeeklyGoalsClaimBonus
};

