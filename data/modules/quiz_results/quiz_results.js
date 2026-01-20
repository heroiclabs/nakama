// quiz_results.js - Quiz Results Tracking & Analytics System
// Stores ALL quiz results from ALL game modes for analytics, history, and leaderboards

import * as utils from "../copilot/utils.js";

/**
 * Quiz Result Schema
 * Captures comprehensive data about each quiz attempt
 */
const QUIZ_RESULT_SCHEMA = {
    // Required fields
    gameId: "string",           // Game UUID
    gameMode: "string",         // QuickPlay, DailyChallenge, Championship, etc.
    
    // Score data
    score: "number",            // Final score
    correctAnswers: "number",   // Number of correct answers
    totalQuestions: "number",   // Total questions in quiz
    
    // Timing
    timeTakenSeconds: "number", // Total time taken
    
    // Win/Loss
    won: "boolean",             // Did user win?
    
    // Optional fields
    difficulty: "string",       // easy, medium, hard
    categoryId: "string",       // Category/topic ID
    categoryName: "string",     // Category/topic name
    opponentId: "string",       // For multiplayer
    opponentName: "string",     // Opponent display name
    tournamentId: "string",     // If part of tournament
    matchId: "string",          // Match ID for multiplayer
    hintsUsed: "number",        // Power-ups used
    skipsUsed: "number",
    extraTimeUsed: "number",
    extraLivesUsed: "number",
    coinsSpent: "number",       // Coins spent on power-ups
    coinsEarned: "number",      // Coins earned from this quiz
    xpEarned: "number",         // XP earned
    streakDay: "number",        // Daily streak day
    perfectScore: "boolean",    // 100% accuracy
    metadata: "object"          // Any additional game-specific data
};

/**
 * Get collection name for quiz results
 */
function getResultsCollection(gameId) {
    return "quiz_results_" + gameId;
}

/**
 * Get user stats collection
 */
function getUserStatsCollection(gameId) {
    return "quiz_user_stats_" + gameId;
}

/**
 * Generate unique result key
 */
function generateResultKey(userId, timestamp) {
    return "result_" + userId + "_" + timestamp;
}

/**
 * Calculate performance metrics
 */
function calculateMetrics(result) {
    const accuracy = result.totalQuestions > 0 
        ? (result.correctAnswers / result.totalQuestions) * 100 
        : 0;
    
    const avgTimePerQuestion = result.totalQuestions > 0 
        ? result.timeTakenSeconds / result.totalQuestions 
        : 0;
    
    const isPerfect = result.correctAnswers === result.totalQuestions && result.totalQuestions > 0;
    
    return {
        accuracy: Math.round(accuracy * 100) / 100,
        avgTimePerQuestion: Math.round(avgTimePerQuestion * 100) / 100,
        isPerfect: isPerfect,
        performanceRating: calculatePerformanceRating(accuracy, avgTimePerQuestion, result.won)
    };
}

/**
 * Calculate performance rating (1-5 stars)
 */
function calculatePerformanceRating(accuracy, avgTime, won) {
    let rating = 0;
    
    // Accuracy contribution (0-2.5 stars)
    if (accuracy >= 90) rating += 2.5;
    else if (accuracy >= 70) rating += 2.0;
    else if (accuracy >= 50) rating += 1.5;
    else if (accuracy >= 30) rating += 1.0;
    else rating += 0.5;
    
    // Speed contribution (0-1.5 stars)
    if (avgTime <= 5) rating += 1.5;
    else if (avgTime <= 10) rating += 1.0;
    else if (avgTime <= 15) rating += 0.5;
    
    // Win bonus (0-1 star)
    if (won) rating += 1.0;
    
    return Math.min(5, Math.round(rating * 10) / 10);
}

/**
 * Update user's aggregate statistics
 */
function updateUserStats(nk, logger, userId, gameId, result, metrics) {
    const collection = getUserStatsCollection(gameId);
    const key = "stats_" + userId;
    
    // Get existing stats
    let stats = utils.readStorage(nk, logger, collection, key, userId);
    
    if (!stats) {
        stats = {
            userId: userId,
            gameId: gameId,
            totalGames: 0,
            totalWins: 0,
            totalScore: 0,
            totalCorrect: 0,
            totalQuestions: 0,
            totalTimePlayed: 0,
            perfectGames: 0,
            highestScore: 0,
            longestStreak: 0,
            currentStreak: 0,
            lastPlayedAt: null,
            modeStats: {},
            createdAt: utils.getCurrentTimestamp()
        };
    }
    
    // Update totals
    stats.totalGames++;
    stats.totalScore += result.score || 0;
    stats.totalCorrect += result.correctAnswers || 0;
    stats.totalQuestions += result.totalQuestions || 0;
    stats.totalTimePlayed += result.timeTakenSeconds || 0;
    
    if (result.won) {
        stats.totalWins++;
        stats.currentStreak++;
        stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
    } else {
        stats.currentStreak = 0;
    }
    
    if (metrics.isPerfect) {
        stats.perfectGames++;
    }
    
    stats.highestScore = Math.max(stats.highestScore, result.score || 0);
    stats.lastPlayedAt = utils.getCurrentTimestamp();
    
    // Update per-mode stats
    const mode = result.gameMode || "unknown";
    if (!stats.modeStats[mode]) {
        stats.modeStats[mode] = {
            games: 0,
            wins: 0,
            totalScore: 0,
            highestScore: 0
        };
    }
    stats.modeStats[mode].games++;
    if (result.won) stats.modeStats[mode].wins++;
    stats.modeStats[mode].totalScore += result.score || 0;
    stats.modeStats[mode].highestScore = Math.max(
        stats.modeStats[mode].highestScore, 
        result.score || 0
    );
    
    stats.updatedAt = utils.getCurrentTimestamp();
    
    // Save stats
    utils.writeStorage(nk, logger, collection, key, userId, stats);
    
    return stats;
}

/**
 * RPC: quiz_submit_result
 * Submit quiz result from any game mode
 * 
 * Required payload:
 * {
 *   gameId: "uuid",
 *   gameMode: "QuickPlay",
 *   score: 850,
 *   correctAnswers: 8,
 *   totalQuestions: 10,
 *   timeTakenSeconds: 120,
 *   won: true
 * }
 * 
 * Optional fields: difficulty, categoryId, categoryName, opponentId,
 *   tournamentId, matchId, hintsUsed, skipsUsed, coinsSpent, coinsEarned, etc.
 */
function rpcQuizSubmitResult(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC quiz_submit_result called");
    
    // Parse payload
    const parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    const data = parsed.data;
    
    // Validate required fields
    const required = ['gameId', 'gameMode', 'score', 'correctAnswers', 'totalQuestions', 'timeTakenSeconds'];
    const validation = utils.validatePayload(data, required);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    // Validate gameId UUID
    if (!utils.isValidUUID(data.gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    const userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    const username = ctx.username || "unknown";
    const timestamp = utils.getUnixTimestamp();
    
    // Build result object
    const result = {
        id: generateResultKey(userId, timestamp),
        userId: userId,
        username: username,
        gameId: data.gameId,
        gameMode: data.gameMode,
        score: parseInt(data.score) || 0,
        correctAnswers: parseInt(data.correctAnswers) || 0,
        totalQuestions: parseInt(data.totalQuestions) || 0,
        timeTakenSeconds: parseFloat(data.timeTakenSeconds) || 0,
        won: data.won === true || data.won === "true",
        
        // Optional fields
        difficulty: data.difficulty || "normal",
        categoryId: data.categoryId || null,
        categoryName: data.categoryName || null,
        opponentId: data.opponentId || null,
        opponentName: data.opponentName || null,
        tournamentId: data.tournamentId || null,
        matchId: data.matchId || null,
        hintsUsed: parseInt(data.hintsUsed) || 0,
        skipsUsed: parseInt(data.skipsUsed) || 0,
        extraTimeUsed: parseInt(data.extraTimeUsed) || 0,
        extraLivesUsed: parseInt(data.extraLivesUsed) || 0,
        coinsSpent: parseInt(data.coinsSpent) || 0,
        coinsEarned: parseInt(data.coinsEarned) || 0,
        xpEarned: parseInt(data.xpEarned) || 0,
        streakDay: parseInt(data.streakDay) || 0,
        metadata: data.metadata || {},
        
        // Server-generated
        timestamp: timestamp,
        submittedAt: utils.getCurrentTimestamp()
    };
    
    // Calculate metrics
    const metrics = calculateMetrics(result);
    result.metrics = metrics;
    result.perfectScore = metrics.isPerfect;
    
    try {
        // 1. Store the result
        const collection = getResultsCollection(data.gameId);
        const resultKey = result.id;
        utils.writeStorage(nk, logger, collection, resultKey, userId, result);
        utils.logInfo(logger, "Stored quiz result: " + resultKey);
        
        // 2. Update user stats
        const updatedStats = updateUserStats(nk, logger, userId, data.gameId, result, metrics);
        
        // 3. Update leaderboard if score > 0
        if (result.score > 0) {
            try {
                const leaderboardId = "leaderboard_" + data.gameId;
                const leaderboardMetadata = {
                    gameMode: result.gameMode,
                    accuracy: metrics.accuracy,
                    submittedAt: result.submittedAt
                };
                
                nk.leaderboardRecordWrite(
                    leaderboardId,
                    userId,
                    username,
                    result.score,
                    0, // subscore
                    JSON.stringify(leaderboardMetadata),
                    null // operator - use default (best)
                );
                utils.logInfo(logger, "Updated leaderboard: " + leaderboardId);
            } catch (lbErr) {
                utils.logWarning(logger, "Leaderboard update failed (non-critical): " + lbErr.message);
            }
        }
        
        // 4. Store in transaction log for analytics
        const transactionKey = "quiz_result_" + userId + "_" + timestamp;
        utils.writeStorage(nk, logger, "transaction_logs", transactionKey, userId, {
            type: "quiz_result",
            resultId: result.id,
            gameMode: result.gameMode,
            score: result.score,
            won: result.won,
            timestamp: result.submittedAt
        });
        
        utils.logInfo(logger, "Quiz result submitted: User " + userId + ", Mode: " + result.gameMode + ", Score: " + result.score);
        
        return JSON.stringify({
            success: true,
            resultId: result.id,
            metrics: metrics,
            stats: {
                totalGames: updatedStats.totalGames,
                totalWins: updatedStats.totalWins,
                currentStreak: updatedStats.currentStreak,
                highestScore: updatedStats.highestScore
            }
        });
        
    } catch (err) {
        utils.logError(logger, "Failed to submit quiz result: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to submit result: " + err.message
        });
    }
}

/**
 * RPC: quiz_get_history
 * Get quiz history for a user
 * 
 * Payload:
 * {
 *   gameId: "uuid",
 *   gameMode: "QuickPlay" (optional, filter by mode),
 *   limit: 20,
 *   cursor: "..." (for pagination)
 * }
 */
function rpcQuizGetHistory(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC quiz_get_history called");
    
    const parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    const data = parsed.data;
    const validation = utils.validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing gameId");
    }
    
    const userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    const collection = getResultsCollection(data.gameId);
    const limit = Math.min(parseInt(data.limit) || 20, 100);
    
    try {
        // List storage objects for this user
        const objects = nk.storageList(userId, collection, limit, data.cursor || "");
        
        let results = [];
        for (const obj of objects.objects || []) {
            const result = JSON.parse(obj.value);
            
            // Filter by gameMode if specified
            if (data.gameMode && result.gameMode !== data.gameMode) {
                continue;
            }
            
            results.push({
                id: result.id,
                gameMode: result.gameMode,
                score: result.score,
                correctAnswers: result.correctAnswers,
                totalQuestions: result.totalQuestions,
                won: result.won,
                metrics: result.metrics,
                categoryName: result.categoryName,
                submittedAt: result.submittedAt
            });
        }
        
        return JSON.stringify({
            success: true,
            results: results,
            cursor: objects.cursor || null,
            count: results.length
        });
        
    } catch (err) {
        utils.logError(logger, "Failed to get quiz history: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to get history: " + err.message
        });
    }
}

/**
 * RPC: quiz_get_stats
 * Get user's aggregate quiz statistics
 */
function rpcQuizGetStats(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC quiz_get_stats called");
    
    const parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    const data = parsed.data;
    const validation = utils.validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing gameId");
    }
    
    const userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    const collection = getUserStatsCollection(data.gameId);
    const key = "stats_" + userId;
    
    const stats = utils.readStorage(nk, logger, collection, key, userId);
    
    if (!stats) {
        return JSON.stringify({
            success: true,
            stats: {
                totalGames: 0,
                totalWins: 0,
                winRate: 0,
                totalScore: 0,
                averageScore: 0,
                accuracy: 0,
                highestScore: 0,
                currentStreak: 0,
                longestStreak: 0,
                perfectGames: 0,
                modeStats: {}
            }
        });
    }
    
    // Calculate derived stats
    const winRate = stats.totalGames > 0 
        ? Math.round((stats.totalWins / stats.totalGames) * 100) 
        : 0;
    
    const averageScore = stats.totalGames > 0 
        ? Math.round(stats.totalScore / stats.totalGames) 
        : 0;
    
    const accuracy = stats.totalQuestions > 0 
        ? Math.round((stats.totalCorrect / stats.totalQuestions) * 100) 
        : 0;
    
    return JSON.stringify({
        success: true,
        stats: {
            totalGames: stats.totalGames,
            totalWins: stats.totalWins,
            winRate: winRate,
            totalScore: stats.totalScore,
            averageScore: averageScore,
            accuracy: accuracy,
            highestScore: stats.highestScore,
            currentStreak: stats.currentStreak,
            longestStreak: stats.longestStreak,
            perfectGames: stats.perfectGames,
            totalTimePlayed: stats.totalTimePlayed,
            modeStats: stats.modeStats,
            lastPlayedAt: stats.lastPlayedAt
        }
    });
}

// Export RPC functions (ES Module syntax)
export {
    rpcQuizSubmitResult,
    rpcQuizGetHistory,
    rpcQuizGetStats
};
