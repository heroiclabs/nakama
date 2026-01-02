/**
 * Cricket Engagement Module for Nakama
 * 
 * Features:
 * - Daily/Weekly/All-Time Leaderboards
 * - Cricket-specific missions
 * - Share tracking
 * - Rate app tracking
 * - Super sticky engagement loops
 */

const CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// Leaderboard IDs
const LEADERBOARDS = {
    daily: "cricket_daily",
    weekly: "cricket_weekly",
    allTime: "cricket_all_time",
    trivia: "cricket_trivia",
    predictions: "cricket_predictions",
    worldcup: "cricket_worldcup_2026"
};

// Cricket-specific mission templates
const CRICKET_MISSIONS = [
    {
        id: "daily_login",
        name: "Daily Login",
        description: "Log in to the game",
        objective: "login",
        targetValue: 1,
        rewards: { coins: 50, xp: 25 }
    },
    {
        id: "play_trivia",
        name: "Cricket Brain",
        description: "Answer 10 trivia questions",
        objective: "trivia_answered",
        targetValue: 10,
        rewards: { coins: 100, xp: 50 }
    },
    {
        id: "trivia_streak",
        name: "On Fire!",
        description: "Get 5 correct answers in a row",
        objective: "trivia_streak",
        targetValue: 5,
        rewards: { coins: 150, xp: 75 }
    },
    {
        id: "make_prediction",
        name: "Fortune Teller",
        description: "Make a World Cup prediction",
        objective: "predictions_made",
        targetValue: 1,
        rewards: { coins: 75, xp: 35 }
    },
    {
        id: "score_runs",
        name: "Run Machine",
        description: "Score 500 runs in gameplay",
        objective: "runs_scored",
        targetValue: 500,
        rewards: { coins: 150, xp: 75 }
    },
    {
        id: "win_match",
        name: "Champion",
        description: "Win a match",
        objective: "matches_won",
        targetValue: 1,
        rewards: { coins: 200, xp: 100, gems: 1 }
    },
    {
        id: "share_score",
        name: "Social Star",
        description: "Share your score with friends",
        objective: "shares",
        targetValue: 1,
        rewards: { coins: 100, xp: 50 }
    },
    {
        id: "perfect_over",
        name: "Perfect Over",
        description: "Score 36 runs in a single over",
        objective: "perfect_over",
        targetValue: 1,
        rewards: { coins: 500, xp: 250, gems: 3 }
    }
];

// Weekly special missions
const WEEKLY_MISSIONS = [
    {
        id: "weekly_trivia_master",
        name: "Trivia Master",
        description: "Answer 100 trivia questions correctly this week",
        objective: "weekly_trivia_correct",
        targetValue: 100,
        rewards: { coins: 1000, xp: 500, gems: 10 }
    },
    {
        id: "weekly_predictor",
        name: "Crystal Ball",
        description: "Make 5 correct predictions this week",
        objective: "weekly_predictions_correct",
        targetValue: 5,
        rewards: { coins: 1500, xp: 750, gems: 15 }
    },
    {
        id: "weekly_champion",
        name: "Weekly Champion",
        description: "Win 10 matches this week",
        objective: "weekly_wins",
        targetValue: 10,
        rewards: { coins: 2000, xp: 1000, gems: 20, specialReward: "gold_cap" }
    }
];

// ============================================================================
// RPC: Initialize Cricket Leaderboards
// ============================================================================
function rpcCricketInitLeaderboards(ctx, logger, nk, payload) {
    logger.info("[CricketEngagement] Initializing leaderboards...");
    
    // Create daily leaderboard (resets at midnight UTC)
    try {
        nk.leaderboardCreate(
            LEADERBOARDS.daily,
            false,  // authoritative
            "desc", // sort order
            "best", // operator
            "0 0 * * *", // reset daily at midnight
            { game: "cricket", type: "daily" }
        );
        logger.info("[CricketEngagement] Created daily leaderboard");
    } catch (e) {
        // Already exists
    }
    
    // Create weekly leaderboard (resets on Monday)
    try {
        nk.leaderboardCreate(
            LEADERBOARDS.weekly,
            false,
            "desc",
            "best",
            "0 0 * * 1", // reset every Monday
            { game: "cricket", type: "weekly" }
        );
        logger.info("[CricketEngagement] Created weekly leaderboard");
    } catch (e) {}
    
    // Create all-time leaderboard (never resets)
    try {
        nk.leaderboardCreate(
            LEADERBOARDS.allTime,
            false,
            "desc",
            "best",
            "", // never reset
            { game: "cricket", type: "all_time" }
        );
        logger.info("[CricketEngagement] Created all-time leaderboard");
    } catch (e) {}
    
    // Create trivia leaderboard
    try {
        nk.leaderboardCreate(
            LEADERBOARDS.trivia,
            false,
            "desc",
            "incr", // accumulate
            "0 0 * * *", // reset daily
            { game: "cricket", type: "trivia" }
        );
        logger.info("[CricketEngagement] Created trivia leaderboard");
    } catch (e) {}
    
    // Create prediction leaderboard
    try {
        nk.leaderboardCreate(
            LEADERBOARDS.predictions,
            false,
            "desc",
            "incr",
            "", // never reset
            { game: "cricket", type: "predictions" }
        );
        logger.info("[CricketEngagement] Created predictions leaderboard");
    } catch (e) {}
    
    return JSON.stringify({
        success: true,
        leaderboards: Object.values(LEADERBOARDS)
    });
}

// ============================================================================
// RPC: Submit Score to All Relevant Leaderboards
// ============================================================================
function rpcCricketSubmitScore(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    
    if (!payload) {
        return JSON.stringify({ success: false, error: "Payload required" });
    }
    
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid JSON" });
    }
    
    const { score, gameType, metadata } = data;
    
    if (score === undefined) {
        return JSON.stringify({ success: false, error: "score required" });
    }
    
    const results = {};
    
    // Submit to daily leaderboard
    try {
        nk.leaderboardRecordWrite(LEADERBOARDS.daily, userId, "", score, 0, metadata || {}, "best");
        results.daily = true;
    } catch (e) {
        results.daily = false;
    }
    
    // Submit to weekly leaderboard
    try {
        nk.leaderboardRecordWrite(LEADERBOARDS.weekly, userId, "", score, 0, metadata || {}, "best");
        results.weekly = true;
    } catch (e) {
        results.weekly = false;
    }
    
    // Submit to all-time leaderboard
    try {
        nk.leaderboardRecordWrite(LEADERBOARDS.allTime, userId, "", score, 0, metadata || {}, "best");
        results.allTime = true;
    } catch (e) {
        results.allTime = false;
    }
    
    logger.info(`[CricketEngagement] Score ${score} submitted for user ${userId}`);
    
    return JSON.stringify({
        success: true,
        score: score,
        submitted: results
    });
}

// ============================================================================
// RPC: Get All Leaderboards
// ============================================================================
function rpcCricketGetAllLeaderboards(ctx, logger, nk, payload) {
    let limit = 20;
    if (payload) {
        try {
            const data = JSON.parse(payload);
            limit = data.limit || 20;
        } catch (e) {}
    }
    
    const userId = ctx.userId;
    const result = {};
    
    // Daily leaderboard
    try {
        const daily = nk.leaderboardRecordsList(LEADERBOARDS.daily, [userId], limit, "", 0);
        result.daily = {
            records: daily.records || [],
            ownerRecord: (daily.ownerRecords && daily.ownerRecords.length > 0) ? daily.ownerRecords[0] : null
        };
    } catch (e) {
        result.daily = { records: [], ownerRecord: null };
    }
    
    // Weekly leaderboard
    try {
        const weekly = nk.leaderboardRecordsList(LEADERBOARDS.weekly, [userId], limit, "", 0);
        result.weekly = {
            records: weekly.records || [],
            ownerRecord: (weekly.ownerRecords && weekly.ownerRecords.length > 0) ? weekly.ownerRecords[0] : null
        };
    } catch (e) {
        result.weekly = { records: [], ownerRecord: null };
    }
    
    // All-time leaderboard
    try {
        const allTime = nk.leaderboardRecordsList(LEADERBOARDS.allTime, [userId], limit, "", 0);
        result.allTime = {
            records: allTime.records || [],
            ownerRecord: (allTime.ownerRecords && allTime.ownerRecords.length > 0) ? allTime.ownerRecords[0] : null
        };
    } catch (e) {
        result.allTime = { records: [], ownerRecord: null };
    }
    
    // Trivia leaderboard
    try {
        const trivia = nk.leaderboardRecordsList(LEADERBOARDS.trivia, [userId], limit, "", 0);
        result.trivia = {
            records: trivia.records || [],
            ownerRecord: (trivia.ownerRecords && trivia.ownerRecords.length > 0) ? trivia.ownerRecords[0] : null
        };
    } catch (e) {
        result.trivia = { records: [], ownerRecord: null };
    }
    
    return JSON.stringify({
        success: true,
        leaderboards: result
    });
}

// ============================================================================
// RPC: Get Cricket Missions
// ============================================================================
function rpcCricketGetMissions(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    const today = new Date().toISOString().split('T')[0];
    
    // Get user's mission progress
    let progressData = null;
    try {
        const stored = nk.storageRead([{
            collection: "cricket_missions",
            key: `missions_${today}`,
            userId: userId
        }]);
        
        if (stored && stored.length > 0) {
            progressData = stored[0].value;
        }
    } catch (e) {}
    
    // Initialize progress if needed
    if (!progressData || progressData.date !== today) {
        progressData = {
            date: today,
            missions: {}
        };
        
        for (const mission of CRICKET_MISSIONS) {
            progressData.missions[mission.id] = {
                currentValue: 0,
                completed: false,
                claimed: false
            };
        }
        
        // Save initial progress
        try {
            nk.storageWrite([{
                collection: "cricket_missions",
                key: `missions_${today}`,
                userId: userId,
                value: progressData,
                permissionRead: 1,
                permissionWrite: 1
            }]);
        } catch (e) {}
    }
    
    // Build response with mission details
    const missions = CRICKET_MISSIONS.map(mission => ({
        ...mission,
        currentValue: progressData.missions[mission.id]?.currentValue || 0,
        completed: progressData.missions[mission.id]?.completed || false,
        claimed: progressData.missions[mission.id]?.claimed || false
    }));
    
    return JSON.stringify({
        success: true,
        date: today,
        missions: missions
    });
}

// ============================================================================
// RPC: Track Share Event
// ============================================================================
function rpcCricketTrackShare(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    
    let data = {};
    if (payload) {
        try {
            data = JSON.parse(payload);
        } catch (e) {}
    }
    
    const shareType = data.shareType || "generic";
    const timestamp = Date.now();
    
    // Log share event
    try {
        nk.storageWrite([{
            collection: "cricket_shares",
            key: `share_${timestamp}`,
            userId: userId,
            value: {
                shareType: shareType,
                platform: data.platform || "unknown",
                content: data.content || "",
                timestamp: timestamp
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (e) {}
    
    // Update mission progress for share
    updateMissionProgress(nk, logger, userId, "share_score", 1);
    
    // Award coins for sharing
    try {
        nk.walletUpdate(userId, { coins: 25 }, { reason: "share_reward" }, true);
    } catch (e) {}
    
    logger.info(`[CricketEngagement] Share tracked for user ${userId}: ${shareType}`);
    
    return JSON.stringify({
        success: true,
        coinsAwarded: 25,
        shareType: shareType
    });
}

// ============================================================================
// RPC: Track Rate App Event
// ============================================================================
function rpcCricketTrackRateApp(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    
    let data = {};
    if (payload) {
        try {
            data = JSON.parse(payload);
        } catch (e) {}
    }
    
    const action = data.action || "shown"; // shown, rated, later, never
    const timestamp = Date.now();
    
    // Log rate event
    try {
        nk.storageWrite([{
            collection: "cricket_rate_events",
            key: `rate_${timestamp}`,
            userId: userId,
            value: {
                action: action,
                timestamp: timestamp
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (e) {}
    
    // Award bonus coins if user rated
    let coinsAwarded = 0;
    if (action === "rated") {
        coinsAwarded = 500;
        try {
            nk.walletUpdate(userId, { coins: coinsAwarded, gems: 5 }, { reason: "rate_app_bonus" }, true);
        } catch (e) {}
    }
    
    logger.info(`[CricketEngagement] Rate app event: ${action} for user ${userId}`);
    
    return JSON.stringify({
        success: true,
        action: action,
        coinsAwarded: coinsAwarded,
        gemsAwarded: action === "rated" ? 5 : 0
    });
}

// ============================================================================
// RPC: Get Engagement Summary
// ============================================================================
function rpcCricketGetEngagementSummary(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    
    // Get all engagement data
    const summary = {
        dailyStreak: 0,
        totalGames: 0,
        totalWins: 0,
        triviaCorrect: 0,
        predictionsCorrect: 0,
        shares: 0,
        coinsEarned: 0,
        leaderboardRanks: {}
    };
    
    // Get streak data
    try {
        const streakData = nk.storageRead([{
            collection: "daily_streaks",
            key: `user_daily_streak_${userId}_${CRICKET_GAME_ID}`,
            userId: userId
        }]);
        
        if (streakData && streakData.length > 0) {
            summary.dailyStreak = streakData[0].value.currentStreak || 0;
        }
    } catch (e) {}
    
    // Get leaderboard ranks
    for (const [name, id] of Object.entries(LEADERBOARDS)) {
        try {
            const records = nk.leaderboardRecordsList(id, [userId], 1, "", 0);
            if (records.ownerRecords && records.ownerRecords.length > 0) {
                summary.leaderboardRanks[name] = records.ownerRecords[0].rank;
            }
        } catch (e) {}
    }
    
    return JSON.stringify({
        success: true,
        summary: summary
    });
}

// ============================================================================
// Helper: Update Mission Progress
// ============================================================================
function updateMissionProgress(nk, logger, userId, missionId, value) {
    const today = new Date().toISOString().split('T')[0];
    
    try {
        const stored = nk.storageRead([{
            collection: "cricket_missions",
            key: `missions_${today}`,
            userId: userId
        }]);
        
        if (stored && stored.length > 0) {
            const progressData = stored[0].value;
            
            if (progressData.missions[missionId]) {
                progressData.missions[missionId].currentValue += value;
                
                const mission = CRICKET_MISSIONS.find(m => m.id === missionId);
                if (mission && progressData.missions[missionId].currentValue >= mission.targetValue) {
                    progressData.missions[missionId].completed = true;
                }
                
                nk.storageWrite([{
                    collection: "cricket_missions",
                    key: `missions_${today}`,
                    userId: userId,
                    value: progressData,
                    permissionRead: 1,
                    permissionWrite: 1
                }]);
            }
        }
    } catch (e) {
        logger.warn(`[CricketEngagement] Failed to update mission progress: ${e.message}`);
    }
}

// ============================================================================
// Initialize Cricket Engagement Module
// ============================================================================
function initCricketEngagementModule(ctx, logger, nk, initializer) {
    logger.info('[CricketEngagement] Initializing Cricket Engagement Module...');
    
    initializer.registerRpc('cricket_init_leaderboards', rpcCricketInitLeaderboards);
    logger.info('[CricketEngagement] Registered: cricket_init_leaderboards');
    
    initializer.registerRpc('cricket_submit_score', rpcCricketSubmitScore);
    logger.info('[CricketEngagement] Registered: cricket_submit_score');
    
    initializer.registerRpc('cricket_get_all_leaderboards', rpcCricketGetAllLeaderboards);
    logger.info('[CricketEngagement] Registered: cricket_get_all_leaderboards');
    
    initializer.registerRpc('cricket_get_missions', rpcCricketGetMissions);
    logger.info('[CricketEngagement] Registered: cricket_get_missions');
    
    initializer.registerRpc('cricket_track_share', rpcCricketTrackShare);
    logger.info('[CricketEngagement] Registered: cricket_track_share');
    
    initializer.registerRpc('cricket_track_rate_app', rpcCricketTrackRateApp);
    logger.info('[CricketEngagement] Registered: cricket_track_rate_app');
    
    initializer.registerRpc('cricket_get_engagement_summary', rpcCricketGetEngagementSummary);
    logger.info('[CricketEngagement] Registered: cricket_get_engagement_summary');
    
    logger.info('[CricketEngagement] Successfully registered 7 Cricket Engagement RPCs');
}

// Export for inclusion in main index.js

