/**
 * Cricket Predictions Module
 * 
 * Handles all match prediction functionality for Cricket VR Mob:
 * - Submit match predictions
 * - Process match results
 * - Award points based on prediction accuracy
 * - Manage prediction leaderboards
 * 
 * Game ID: 78244246-1e9e-4e0f-a8a2-7447d5b0284e
 */

const CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// Leaderboard IDs
const LEADERBOARDS = {
    DAILY_TRIVIA: "cricket_daily_trivia",
    WEEKLY_TOURNAMENT: "cricket_weekly_tournament",
    WORLDCUP_2026: "cricket_worldcup_2026",
    IPL_2026: "cricket_ipl_2026",
    ALL_TIME: "cricket_all_time_master",
    PREDICTIONS_ACCURACY: "cricket_prediction_accuracy"
};

// Collection names
const COLLECTIONS = {
    PREDICTIONS: "cricket_predictions",
    MATCH_RESULTS: "cricket_match_results",
    USER_STATS: "cricket_user_stats",
    ENGAGEMENT: "cricket_engagement",
    TRIVIA_SCORES: "cricket_trivia_scores"
};

// Points configuration
const POINTS = {
    CORRECT_WINNER: 100,
    CORRECT_SCORE_EXACT: 500,
    CORRECT_SCORE_CLOSE: 200, // Within 10 runs
    CORRECT_MOM: 150,
    CORRECT_TOP_SCORER: 100,
    CORRECT_TOP_BOWLER: 100,
    EARLY_PREDICTION_BONUS: 50, // 24h+ before match
    STREAK_BONUS_MULTIPLIER: 0.1, // 10% per streak day
    TRIVIA_COMPLETION_BONUS: 25,
    FULL_ENGAGEMENT_BONUS: 200
};

/**
 * RPC: Submit a match prediction
 * 
 * Payload: {
 *   matchId: string,
 *   tournamentId: "WC2026" | "IPL2026",
 *   predictedWinner: string,
 *   predictedScore1: number,
 *   predictedScore2: number,
 *   manOfTheMatch: string,
 *   topScorerRuns: number,
 *   topBowlerWickets: number,
 *   additionalPredictions: object
 * }
 */
function rpcSubmitPrediction(context, logger, nk, payload) {
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

    const { matchId, tournamentId, predictedWinner, predictedScore1, predictedScore2, 
            manOfTheMatch, topScorerRuns, topBowlerWickets, additionalPredictions } = data;

    if (!matchId || !predictedWinner) {
        throw new Error("matchId and predictedWinner are required");
    }

    // Check if prediction already exists
    const existingPredictions = nk.storageRead([{
        collection: COLLECTIONS.PREDICTIONS,
        key: `${userId}_${matchId}`,
        userId: userId
    }]);

    if (existingPredictions.length > 0) {
        return JSON.stringify({
            success: false,
            message: "You have already made a prediction for this match",
            existingPrediction: existingPredictions[0].value
        });
    }

    // Calculate bonus for early prediction
    const now = Date.now();
    const matchTime = getMatchTime(nk, matchId);
    const hoursUntilMatch = matchTime ? (matchTime - now) / (1000 * 60 * 60) : 0;
    const earlyBonus = hoursUntilMatch >= 24 ? POINTS.EARLY_PREDICTION_BONUS : 0;

    // Create prediction record
    const prediction = {
        matchId,
        tournamentId,
        predictedWinner,
        predictedScore1: predictedScore1 || 0,
        predictedScore2: predictedScore2 || 0,
        manOfTheMatch: manOfTheMatch || null,
        topScorerRuns: topScorerRuns || 0,
        topBowlerWickets: topBowlerWickets || 0,
        additionalPredictions: additionalPredictions || {},
        submittedAt: now,
        hoursBeforeMatch: hoursUntilMatch,
        earlyBonus,
        isProcessed: false,
        pointsEarned: 0
    };

    // Store prediction
    nk.storageWrite([{
        collection: COLLECTIONS.PREDICTIONS,
        key: `${userId}_${matchId}`,
        userId: userId,
        value: prediction,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    // Update user stats
    updateUserStats(nk, userId, "predictionsMade", 1);

    // Track engagement
    trackEngagement(nk, userId, matchId, "prediction_submitted", { earlyBonus });

    logger.info(`User ${userId} submitted prediction for match ${matchId}`);

    return JSON.stringify({
        success: true,
        matchId,
        earlyBonus,
        message: "Prediction submitted successfully!",
        hoursUntilMatch: Math.floor(hoursUntilMatch)
    });
}

/**
 * RPC: Process match results and award points
 * 
 * Payload: {
 *   matchId: string,
 *   tournamentId: string,
 *   winner: string,
 *   team1Score: number,
 *   team2Score: number,
 *   manOfTheMatch: string,
 *   topScorer: string,
 *   topScorerRuns: number,
 *   topBowler: string,
 *   topBowlerWickets: number
 * }
 */
function rpcProcessMatchResults(context, logger, nk, payload) {
    // This should be called by admin/server only
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { matchId, tournamentId, winner, team1Score, team2Score, 
            manOfTheMatch, topScorer, topScorerRuns, topBowler, topBowlerWickets } = data;

    if (!matchId || !winner) {
        throw new Error("matchId and winner are required");
    }

    // Store match result
    nk.storageWrite([{
        collection: COLLECTIONS.MATCH_RESULTS,
        key: matchId,
        userId: null,
        value: {
            matchId,
            tournamentId,
            winner,
            team1Score,
            team2Score,
            manOfTheMatch,
            topScorer,
            topScorerRuns,
            topBowler,
            topBowlerWickets,
            processedAt: Date.now()
        },
        permissionRead: 2,
        permissionWrite: 0
    }]);

    // Get all predictions for this match
    const cursor = null;
    const limit = 1000;
    let predictions = [];
    
    // Query all predictions for this match
    const query = `+value.matchId:${matchId} +value.isProcessed:false`;
    const results = nk.storageIndexList("cricket_predictions_idx", query, limit, null, cursor);
    
    if (results && results.objects) {
        predictions = results.objects;
    }

    let processedCount = 0;
    let totalPointsAwarded = 0;
    const topPredictors = [];

    for (const pred of predictions) {
        const prediction = pred.value;
        const predUserId = pred.userId;
        
        let points = 0;
        let bonuses = [];

        // Check winner prediction
        if (prediction.predictedWinner === winner) {
            points += POINTS.CORRECT_WINNER;
            bonuses.push("correct_winner");
        }

        // Check score prediction
        const actualTotal = team1Score + team2Score;
        const predictedTotal = prediction.predictedScore1 + prediction.predictedScore2;
        
        if (predictedTotal === actualTotal) {
            points += POINTS.CORRECT_SCORE_EXACT;
            bonuses.push("exact_score");
        } else if (Math.abs(predictedTotal - actualTotal) <= 10) {
            points += POINTS.CORRECT_SCORE_CLOSE;
            bonuses.push("close_score");
        }

        // Check Man of the Match
        if (prediction.manOfTheMatch && prediction.manOfTheMatch === manOfTheMatch) {
            points += POINTS.CORRECT_MOM;
            bonuses.push("correct_mom");
        }

        // Add early prediction bonus
        if (prediction.earlyBonus) {
            points += prediction.earlyBonus;
            bonuses.push("early_bird");
        }

        // Calculate streak bonus
        const userStats = getUserStats(nk, predUserId);
        const streakBonus = Math.floor(points * (userStats.predictionStreak || 0) * POINTS.STREAK_BONUS_MULTIPLIER);
        points += streakBonus;

        // Update prediction record
        nk.storageWrite([{
            collection: COLLECTIONS.PREDICTIONS,
            key: `${predUserId}_${matchId}`,
            userId: predUserId,
            value: {
                ...prediction,
                isProcessed: true,
                pointsEarned: points,
                bonuses,
                streakBonus,
                processedAt: Date.now()
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Update leaderboards
        if (points > 0) {
            // Tournament leaderboard
            const leaderboardId = tournamentId === "IPL2026" ? LEADERBOARDS.IPL_2026 : LEADERBOARDS.WORLDCUP_2026;
            nk.leaderboardRecordWrite(leaderboardId, predUserId, null, points, null, {
                matchId,
                bonuses: bonuses.join(",")
            });

            // All-time leaderboard
            nk.leaderboardRecordWrite(LEADERBOARDS.ALL_TIME, predUserId, null, points, null, null);

            // Update user stats
            updateUserStats(nk, predUserId, "totalPredictionPoints", points);
            if (prediction.predictedWinner === winner) {
                updateUserStats(nk, predUserId, "correctPredictions", 1);
                updateUserStats(nk, predUserId, "predictionStreak", 1);
            } else {
                resetUserStat(nk, predUserId, "predictionStreak");
            }

            topPredictors.push({
                userId: predUserId,
                points,
                bonuses,
                isPerfect: bonuses.includes("exact_score") && bonuses.includes("correct_mom")
            });
        }

        totalPointsAwarded += points;
        processedCount++;
    }

    // Sort top predictors
    topPredictors.sort((a, b) => b.points - a.points);

    logger.info(`Processed ${processedCount} predictions for match ${matchId}, awarded ${totalPointsAwarded} total points`);

    return JSON.stringify({
        success: true,
        matchId,
        predictionsProcessed: processedCount,
        totalPointsAwarded,
        topPredictors: topPredictors.slice(0, 10)
    });
}

/**
 * RPC: Get user's predictions
 */
function rpcGetUserPredictions(context, logger, nk, payload) {
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

    const { tournamentId, limit = 50 } = data;

    // Get user's predictions
    const predictions = nk.storageList(userId, COLLECTIONS.PREDICTIONS, limit, null);

    let filteredPredictions = predictions.objects || [];
    
    if (tournamentId) {
        filteredPredictions = filteredPredictions.filter(p => p.value.tournamentId === tournamentId);
    }

    // Calculate stats
    const stats = {
        totalPredictions: filteredPredictions.length,
        correctPredictions: filteredPredictions.filter(p => p.value.bonuses && p.value.bonuses.includes("correct_winner")).length,
        totalPoints: filteredPredictions.reduce((sum, p) => sum + (p.value.pointsEarned || 0), 0),
        pendingPredictions: filteredPredictions.filter(p => !p.value.isProcessed).length
    };

    return JSON.stringify({
        predictions: filteredPredictions.map(p => p.value),
        stats
    });
}

/**
 * RPC: Get match leaderboard
 */
function rpcGetMatchLeaderboard(context, logger, nk, payload) {
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { matchId, limit = 50 } = data;

    if (!matchId) {
        throw new Error("matchId is required");
    }

    // Query predictions for this match
    const query = `+value.matchId:${matchId} +value.isProcessed:true`;
    const results = nk.storageIndexList("cricket_predictions_idx", query, limit, null, null);

    const entries = (results?.objects || [])
        .map(obj => ({
            userId: obj.userId,
            username: getUserDisplayName(nk, obj.userId),
            predictedWinner: obj.value.predictedWinner,
            points: obj.value.pointsEarned,
            bonuses: obj.value.bonuses
        }))
        .sort((a, b) => b.points - a.points)
        .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

    // Get match info
    const matchResults = nk.storageRead([{
        collection: COLLECTIONS.MATCH_RESULTS,
        key: matchId,
        userId: null
    }]);

    const matchInfo = matchResults.length > 0 ? matchResults[0].value : null;

    return JSON.stringify({
        matchId,
        matchInfo,
        predictions: entries,
        totalPredictions: entries.length
    });
}

/**
 * RPC: Get tournament leaderboard
 */
function rpcGetTournamentLeaderboard(context, logger, nk, payload) {
    const userId = context.userId;
    
    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        // ignore
    }

    const { tournamentId = "WC2026", limit = 100 } = data;

    const leaderboardId = tournamentId === "IPL2026" ? LEADERBOARDS.IPL_2026 : LEADERBOARDS.WORLDCUP_2026;

    // Get leaderboard records
    const records = nk.leaderboardRecordsList(leaderboardId, null, limit, null, 0);
    
    const entries = (records.records || []).map(record => ({
        rank: record.rank,
        userId: record.ownerId,
        username: record.username?.value || "Anonymous",
        score: record.score,
        metadata: record.metadata ? JSON.parse(record.metadata) : null
    }));

    // Get user's own rank
    let userRank = null;
    let userScore = 0;
    
    if (userId) {
        const aroundOwner = nk.leaderboardRecordsList(leaderboardId, [userId], 1, null, 0);
        if (aroundOwner.records && aroundOwner.records.length > 0) {
            userRank = aroundOwner.records[0].rank;
            userScore = aroundOwner.records[0].score;
        }
    }

    return JSON.stringify({
        leaderboardId,
        tournamentId,
        entries,
        userRank,
        userScore,
        totalEntries: records.records?.length || 0
    });
}

// Helper functions
function getMatchTime(nk, matchId) {
    // Try to get match time from stored schedule
    const schedules = nk.storageRead([{
        collection: "cricket_schedules",
        key: matchId,
        userId: null
    }]);
    
    if (schedules.length > 0) {
        return new Date(schedules[0].value.matchTime).getTime();
    }
    return null;
}

function getUserStats(nk, userId) {
    const stats = nk.storageRead([{
        collection: COLLECTIONS.USER_STATS,
        key: "stats",
        userId: userId
    }]);
    
    return stats.length > 0 ? stats[0].value : {
        predictionsMade: 0,
        correctPredictions: 0,
        predictionStreak: 0,
        totalPredictionPoints: 0
    };
}

function updateUserStats(nk, userId, field, increment) {
    const stats = getUserStats(nk, userId);
    stats[field] = (stats[field] || 0) + increment;
    stats.lastUpdated = Date.now();
    
    nk.storageWrite([{
        collection: COLLECTIONS.USER_STATS,
        key: "stats",
        userId: userId,
        value: stats,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function resetUserStat(nk, userId, field) {
    const stats = getUserStats(nk, userId);
    stats[field] = 0;
    stats.lastUpdated = Date.now();
    
    nk.storageWrite([{
        collection: COLLECTIONS.USER_STATS,
        key: "stats",
        userId: userId,
        value: stats,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function trackEngagement(nk, userId, matchId, eventType, data) {
    const engagementKey = `${userId}_${matchId}`;
    
    const existing = nk.storageRead([{
        collection: COLLECTIONS.ENGAGEMENT,
        key: engagementKey,
        userId: userId
    }]);
    
    const engagement = existing.length > 0 ? existing[0].value : {
        matchId,
        events: [],
        score: 0
    };
    
    engagement.events.push({
        type: eventType,
        data,
        timestamp: Date.now()
    });
    
    // Update engagement score
    const pointsMap = {
        "prediction_submitted": 30,
        "trivia_completed": 25,
        "match_viewed": 5,
        "lineup_viewed": 10,
        "notification_tapped": 5,
        "shared_match": 20
    };
    
    engagement.score += pointsMap[eventType] || 5;
    
    nk.storageWrite([{
        collection: COLLECTIONS.ENGAGEMENT,
        key: engagementKey,
        userId: userId,
        value: engagement,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function getUserDisplayName(nk, userId) {
    try {
        const users = nk.usersGetId([userId]);
        if (users.length > 0) {
            return users[0].displayName || users[0].username || "Anonymous";
        }
    } catch (e) {
        // ignore
    }
    return "Anonymous";
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Cricket Predictions Module loaded");

    // Register RPCs
    initializer.registerRpc("cricket_submit_prediction", rpcSubmitPrediction);
    initializer.registerRpc("cricket_process_match_results", rpcProcessMatchResults);
    initializer.registerRpc("cricket_get_user_predictions", rpcGetUserPredictions);
    initializer.registerRpc("cricket_get_match_leaderboard", rpcGetMatchLeaderboard);
    initializer.registerRpc("cricket_get_tournament_leaderboard", rpcGetTournamentLeaderboard);

    // Create leaderboards if they don't exist
    const leaderboardConfigs = [
        { id: LEADERBOARDS.DAILY_TRIVIA, sortOrder: 1, operator: 2, resetSchedule: "0 0 * * *" }, // Daily reset
        { id: LEADERBOARDS.WEEKLY_TOURNAMENT, sortOrder: 1, operator: 2, resetSchedule: "0 0 * * 1" }, // Weekly reset
        { id: LEADERBOARDS.WORLDCUP_2026, sortOrder: 1, operator: 2, resetSchedule: null }, // No reset
        { id: LEADERBOARDS.IPL_2026, sortOrder: 1, operator: 2, resetSchedule: null }, // No reset
        { id: LEADERBOARDS.ALL_TIME, sortOrder: 1, operator: 2, resetSchedule: null } // No reset
    ];

    for (const config of leaderboardConfigs) {
        try {
            nk.leaderboardCreate(config.id, false, config.sortOrder, config.operator, config.resetSchedule, null);
            logger.info(`Created leaderboard: ${config.id}`);
        } catch (e) {
            // Leaderboard already exists
        }
    }

    // Create storage index for predictions
    try {
        nk.storageIndexList("cricket_predictions_idx", "", 1, null, null);
    } catch (e) {
        // Index doesn't exist, will be created on first use
    }

    logger.info("Cricket Predictions Module initialized successfully");
}

!InitModule.toString().includes("InitModule") || InitModule;

