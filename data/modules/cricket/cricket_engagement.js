/**
 * Cricket Engagement Module
 * 
 * Tracks and rewards user engagement for Cricket VR Mob:
 * - Match build-up engagement
 * - Trivia completion tracking
 * - Daily login streaks
 * - Engagement-based rewards
 * - Session analytics
 * 
 * Game ID: 78244246-1e9e-4e0f-a8a2-7447d5b0284e
 */

const CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// Collections
const COLLECTIONS = {
    ENGAGEMENT: "cricket_engagement",
    DAILY_STREAKS: "cricket_daily_streaks",
    SESSION_DATA: "cricket_sessions",
    REWARDS: "cricket_rewards",
    BUILD_UP: "cricket_match_buildup"
};

// Engagement point values
const ENGAGEMENT_POINTS = {
    VIEW_MATCH: 5,
    VIEW_LINEUP: 10,
    WATCH_HIGHLIGHT: 15,
    SHARE_MATCH: 20,
    SET_REMINDER: 10,
    TAP_NOTIFICATION: 5,
    START_TRIVIA: 10,
    COMPLETE_TRIVIA: 25,
    MAKE_PREDICTION: 30,
    CORRECT_PREDICTION: 50,
    FULL_ENGAGEMENT: 50, // Bonus for all actions
    DAILY_LOGIN: 10,
    STREAK_BONUS_PER_DAY: 5
};

// Engagement thresholds for rewards
const ENGAGEMENT_TIERS = {
    BRONZE: 25,
    SILVER: 50,
    GOLD: 100,
    PLATINUM: 200
};

// Rewards for engagement tiers
const TIER_REWARDS = {
    BRONZE: { coins: 50, xp: 25 },
    SILVER: { coins: 100, xp: 50, item: "bronze_cap" },
    GOLD: { coins: 200, xp: 100, item: "silver_cap" },
    PLATINUM: { coins: 500, xp: 250, item: "gold_cap" }
};

/**
 * RPC: Track engagement event
 * 
 * Payload: {
 *   eventType: string,
 *   matchId: string,
 *   data: object
 * }
 */
function rpcTrackEngagement(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { eventType, matchId, data: eventData } = data;

    if (!eventType) {
        throw new Error("eventType is required");
    }

    const engagementKey = matchId ? `${userId}_${matchId}` : `${userId}_general`;
    
    // Get existing engagement
    const existing = nk.storageRead([{
        collection: COLLECTIONS.ENGAGEMENT,
        key: engagementKey,
        userId: userId
    }]);

    const engagement = existing.length > 0 ? existing[0].value : {
        matchId,
        events: [],
        score: 0,
        completedActions: [],
        unlockedTiers: [],
        rewards: []
    };

    // Calculate points for this event
    const eventKey = eventType.toUpperCase().replace(/-/g, "_");
    const points = ENGAGEMENT_POINTS[eventKey] || 5;

    // Check if this is a new action type
    const isNewAction = !engagement.completedActions.includes(eventType);

    // Add event
    engagement.events.push({
        type: eventType,
        data: eventData,
        points,
        timestamp: Date.now()
    });

    // Update score
    engagement.score += points;

    // Track unique actions
    if (isNewAction) {
        engagement.completedActions.push(eventType);
    }

    // Check for full engagement bonus
    const requiredActions = ["view_match", "start_trivia", "complete_trivia", "make_prediction"];
    const hasAllActions = requiredActions.every(action => 
        engagement.completedActions.includes(action) || 
        engagement.completedActions.includes(action.replace(/_/g, "-"))
    );

    if (hasAllActions && !engagement.fullEngagementClaimed) {
        engagement.score += ENGAGEMENT_POINTS.FULL_ENGAGEMENT;
        engagement.fullEngagementClaimed = true;
        engagement.events.push({
            type: "full_engagement_bonus",
            points: ENGAGEMENT_POINTS.FULL_ENGAGEMENT,
            timestamp: Date.now()
        });
    }

    // Check for tier unlocks
    const newRewards = [];
    for (const [tier, threshold] of Object.entries(ENGAGEMENT_TIERS)) {
        if (engagement.score >= threshold && !engagement.unlockedTiers.includes(tier)) {
            engagement.unlockedTiers.push(tier);
            const reward = TIER_REWARDS[tier];
            engagement.rewards.push({
                tier,
                reward,
                unlockedAt: Date.now()
            });
            newRewards.push({ tier, reward });

            // Award coins to wallet
            if (reward.coins) {
                awardCoins(nk, userId, reward.coins, `engagement_${tier.toLowerCase()}`);
            }
        }
    }

    // Calculate multiplier based on engagement score
    engagement.bonusMultiplier = 1 + Math.floor(engagement.score / 50) * 0.1;

    // Save engagement
    nk.storageWrite([{
        collection: COLLECTIONS.ENGAGEMENT,
        key: engagementKey,
        userId: userId,
        value: engagement,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} engagement: ${eventType} = ${points}pts, total: ${engagement.score}`);

    return JSON.stringify({
        matchId,
        eventType,
        pointsEarned: points,
        totalScore: engagement.score,
        completedActions: engagement.completedActions,
        bonusMultiplier: engagement.bonusMultiplier,
        unlockedRewards: newRewards,
        fullEngagementClaimed: engagement.fullEngagementClaimed
    });
}

/**
 * RPC: Get match build-up status
 * 
 * Payload: {
 *   matchId: string
 * }
 */
function rpcGetBuildUpStatus(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { matchId } = data;

    if (!matchId) {
        throw new Error("matchId is required");
    }

    // Get user's engagement for this match
    const engagementKey = `${userId}_${matchId}`;
    const existing = nk.storageRead([{
        collection: COLLECTIONS.ENGAGEMENT,
        key: engagementKey,
        userId: userId
    }]);

    const userEngagement = existing.length > 0 ? existing[0].value : {
        score: 0,
        completedActions: []
    };

    // Get match info
    const matchInfo = nk.storageRead([{
        collection: "cricket_schedules",
        key: matchId,
        userId: null
    }]);

    const match = matchInfo.length > 0 ? matchInfo[0].value : null;

    // Get prediction stats for this match
    const query = `+value.matchId:${matchId}`;
    let totalPredictions = 0;
    let team1Predictions = 0;
    let team2Predictions = 0;

    try {
        const predictions = nk.storageIndexList("cricket_predictions_idx", query, 1000, null, null);
        if (predictions && predictions.objects) {
            totalPredictions = predictions.objects.length;
            for (const pred of predictions.objects) {
                if (pred.value.predictedWinner === match?.team1) {
                    team1Predictions++;
                } else if (pred.value.predictedWinner === match?.team2) {
                    team2Predictions++;
                }
            }
        }
    } catch (e) {
        // Index might not exist yet
    }

    // Check if user has predicted
    const userPrediction = nk.storageRead([{
        collection: "cricket_predictions",
        key: `${userId}_${matchId}`,
        userId: userId
    }]);

    const hasPredicted = userPrediction.length > 0;

    // Calculate hours until match
    let hoursUntilMatch = 0;
    if (match?.matchTime) {
        const matchTime = new Date(match.matchTime).getTime();
        hoursUntilMatch = Math.max(0, (matchTime - Date.now()) / (1000 * 60 * 60));
    }

    return JSON.stringify({
        matchId,
        team1: match?.team1,
        team2: match?.team2,
        matchTime: match?.matchTime,
        hoursUntilMatch: Math.floor(hoursUntilMatch),
        totalPredictions,
        team1PredictionPercent: totalPredictions > 0 ? (team1Predictions / totalPredictions * 100) : 50,
        team2PredictionPercent: totalPredictions > 0 ? (team2Predictions / totalPredictions * 100) : 50,
        triviaQuestionsAvailable: 10, // Default
        userHasPredicted: hasPredicted,
        userEngagementScore: userEngagement.score,
        userCompletedActions: userEngagement.completedActions,
        bonusMultiplier: userEngagement.bonusMultiplier || 1
    });
}

/**
 * RPC: Claim daily login reward
 */
function rpcClaimDailyLogin(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    const now = Date.now();
    const today = new Date(now).toISOString().split('T')[0];

    // Get streak data
    const streakData = nk.storageRead([{
        collection: COLLECTIONS.DAILY_STREAKS,
        key: "streak",
        userId: userId
    }]);

    let streak = streakData.length > 0 ? streakData[0].value : {
        currentStreak: 0,
        longestStreak: 0,
        lastLoginDate: null,
        totalLogins: 0,
        rewards: []
    };

    // Check if already claimed today
    if (streak.lastLoginDate === today) {
        return JSON.stringify({
            success: false,
            message: "Already claimed today's reward",
            currentStreak: streak.currentStreak,
            nextRewardIn: getTimeUntilNextDay()
        });
    }

    // Check if streak continues
    const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    if (streak.lastLoginDate === yesterday) {
        streak.currentStreak++;
    } else {
        streak.currentStreak = 1; // Reset streak
    }

    streak.lastLoginDate = today;
    streak.totalLogins++;
    streak.longestStreak = Math.max(streak.longestStreak, streak.currentStreak);

    // Calculate reward
    const baseCoins = ENGAGEMENT_POINTS.DAILY_LOGIN;
    const streakBonus = (streak.currentStreak - 1) * ENGAGEMENT_POINTS.STREAK_BONUS_PER_DAY;
    const totalCoins = baseCoins + streakBonus;

    // Check for milestone rewards
    let milestoneReward = null;
    const milestones = {
        3: { item: "country_cap_common", name: "3-Day Streak Cap" },
        7: { item: "flag_helmet", name: "Flag Helmet" },
        14: { item: "team_jersey_common", name: "Team Jersey" },
        30: { item: "legendary_kit_shard", name: "Legendary Kit Shard" }
    };

    if (milestones[streak.currentStreak]) {
        milestoneReward = milestones[streak.currentStreak];
        streak.rewards.push({
            day: streak.currentStreak,
            reward: milestoneReward,
            claimedAt: now
        });
    }

    // Award coins
    awardCoins(nk, userId, totalCoins, "daily_login");

    // Save streak data
    nk.storageWrite([{
        collection: COLLECTIONS.DAILY_STREAKS,
        key: "streak",
        userId: userId,
        value: streak,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} claimed daily login: day ${streak.currentStreak}, ${totalCoins} coins`);

    return JSON.stringify({
        success: true,
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        coinsEarned: totalCoins,
        streakBonus,
        milestoneReward,
        totalLogins: streak.totalLogins,
        nextRewardIn: getTimeUntilNextDay()
    });
}

/**
 * RPC: Get engagement summary
 */
function rpcGetEngagementSummary(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    // Get streak data
    const streakData = nk.storageRead([{
        collection: COLLECTIONS.DAILY_STREAKS,
        key: "streak",
        userId: userId
    }]);

    const streak = streakData.length > 0 ? streakData[0].value : {
        currentStreak: 0,
        longestStreak: 0,
        totalLogins: 0
    };

    // Get all engagement records
    const engagements = nk.storageList(userId, COLLECTIONS.ENGAGEMENT, 100, null);
    
    let totalEngagementScore = 0;
    let matchesEngaged = 0;
    let fullEngagementCount = 0;

    for (const engagement of (engagements.objects || [])) {
        totalEngagementScore += engagement.value.score || 0;
        matchesEngaged++;
        if (engagement.value.fullEngagementClaimed) {
            fullEngagementCount++;
        }
    }

    // Calculate engagement tier
    let currentTier = null;
    let nextTier = "BRONZE";
    let progressToNextTier = 0;

    for (const [tier, threshold] of Object.entries(ENGAGEMENT_TIERS)) {
        if (totalEngagementScore >= threshold) {
            currentTier = tier;
        } else {
            nextTier = tier;
            progressToNextTier = (totalEngagementScore / threshold) * 100;
            break;
        }
    }

    return JSON.stringify({
        dailyStreak: {
            current: streak.currentStreak,
            longest: streak.longestStreak,
            totalLogins: streak.totalLogins
        },
        engagement: {
            totalScore: totalEngagementScore,
            matchesEngaged,
            fullEngagementCount,
            currentTier,
            nextTier,
            progressToNextTier: Math.floor(progressToNextTier)
        },
        rewards: streak.rewards || []
    });
}

/**
 * RPC: Start session tracking
 */
function rpcStartSession(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    const sessionId = context.sessionId || `session_${Date.now()}`;
    const now = Date.now();

    const session = {
        sessionId,
        startTime: now,
        events: [],
        isActive: true
    };

    nk.storageWrite([{
        collection: COLLECTIONS.SESSION_DATA,
        key: sessionId,
        userId: userId,
        value: session,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} started session: ${sessionId}`);

    return JSON.stringify({
        success: true,
        sessionId,
        startTime: now
    });
}

/**
 * RPC: End session tracking
 */
function rpcEndSession(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        // ignore
    }

    const { sessionId } = data;
    const sessionKey = sessionId || context.sessionId;

    if (!sessionKey) {
        return JSON.stringify({ success: false, message: "No session to end" });
    }

    const sessions = nk.storageRead([{
        collection: COLLECTIONS.SESSION_DATA,
        key: sessionKey,
        userId: userId
    }]);

    if (sessions.length === 0) {
        return JSON.stringify({ success: false, message: "Session not found" });
    }

    const session = sessions[0].value;
    const now = Date.now();
    const duration = now - session.startTime;

    session.endTime = now;
    session.duration = duration;
    session.isActive = false;

    nk.storageWrite([{
        collection: COLLECTIONS.SESSION_DATA,
        key: sessionKey,
        userId: userId,
        value: session,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} ended session: ${sessionKey}, duration: ${Math.floor(duration / 1000)}s`);

    return JSON.stringify({
        success: true,
        sessionId: sessionKey,
        duration: Math.floor(duration / 1000)
    });
}

// Helper functions
function awardCoins(nk, userId, amount, reason) {
    try {
        const changeset = {
            coins: amount
        };
        const metadata = {
            reason,
            timestamp: Date.now()
        };
        nk.walletUpdate(userId, changeset, metadata, true);
    } catch (e) {
        // Wallet error
    }
}

function getTimeUntilNextDay() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime() - now.getTime();
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Cricket Engagement Module loaded");

    initializer.registerRpc("cricket_track_engagement", rpcTrackEngagement);
    initializer.registerRpc("cricket_get_buildup_status", rpcGetBuildUpStatus);
    initializer.registerRpc("cricket_claim_daily_login", rpcClaimDailyLogin);
    initializer.registerRpc("cricket_get_engagement_summary", rpcGetEngagementSummary);
    initializer.registerRpc("cricket_start_session", rpcStartSession);
    initializer.registerRpc("cricket_end_session", rpcEndSession);

    logger.info("Cricket Engagement Module initialized successfully");
}

!InitModule.toString().includes("InitModule") || InitModule;

