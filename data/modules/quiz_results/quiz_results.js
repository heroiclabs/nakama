// quiz_results.js - Quiz Results Tracking & Analytics System
// Stores ALL quiz results from ALL game modes for analytics, history, and leaderboards

/**
 * Quiz Result Schema
 * Captures comprehensive data about each quiz attempt
 */
var QUIZ_RESULT_SCHEMA = {
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
    var accuracy = result.totalQuestions > 0 
        ? (result.correctAnswers / result.totalQuestions) * 100 
        : 0;
    
    var avgTimePerQuestion = result.totalQuestions > 0 
        ? result.timeTakenSeconds / result.totalQuestions 
        : 0;
    
    var isPerfect = result.correctAnswers === result.totalQuestions && result.totalQuestions > 0;
    
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
    var rating = 0;
    
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
    var collection = getUserStatsCollection(gameId);
    var key = "stats_" + userId;
    
    // Get existing stats
    var stats = utils.readStorage(nk, logger, collection, key, userId);
    
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
    var mode = result.gameMode || "unknown";
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
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    
    // Validate required fields
    var required = ['gameId', 'gameMode', 'score', 'correctAnswers', 'totalQuestions', 'timeTakenSeconds'];
    var validation = utils.validatePayload(data, required);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    // Validate gameId UUID
    if (!utils.isValidUUID(data.gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var username = ctx.username || "unknown";
    var timestamp = utils.getUnixTimestamp();
    
    // Build result object
    var result = {
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
    var metrics = calculateMetrics(result);
    result.metrics = metrics;
    result.perfectScore = metrics.isPerfect;
    
    try {
        // 1. Store the result
        var collection = getResultsCollection(data.gameId);
        var resultKey = result.id;
        utils.writeStorage(nk, logger, collection, resultKey, userId, result);
        utils.logInfo(logger, "Stored quiz result: " + resultKey);
        
        // 2. Update user stats
        var updatedStats = updateUserStats(nk, logger, userId, data.gameId, result, metrics);
        
        // 3. Update leaderboard if score > 0
        if (result.score > 0) {
            try {
                var leaderboardId = "leaderboard_" + data.gameId;
                var leaderboardMetadata = {
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
        var transactionKey = "quiz_result_" + userId + "_" + timestamp;
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
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing gameId");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var collection = getResultsCollection(data.gameId);
    var limit = Math.min(parseInt(data.limit) || 20, 100);
    
    try {
        // List storage objects for this user
        var objects = nk.storageList(userId, collection, limit, data.cursor || "");
        
        var results = [];
        for (var obj of objects.objects || []) {
            var result = JSON.parse(obj.value);
            
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
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing gameId");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var collection = getUserStatsCollection(data.gameId);
    var key = "stats_" + userId;
    
    var stats = utils.readStorage(nk, logger, collection, key, userId);
    
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
    var winRate = stats.totalGames > 0 
        ? Math.round((stats.totalWins / stats.totalGames) * 100) 
        : 0;
    
    var averageScore = stats.totalGames > 0 
        ? Math.round(stats.totalScore / stats.totalGames) 
        : 0;
    
    var accuracy = stats.totalQuestions > 0 
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

/**
 * RPC: quiz_check_daily_completion
 * Check if user has completed a quiz for a specific game mode today
 * Based on user UUID - queries across all quiz result collections for the user
 * 
 * Payload:
 * {
 *   gameMode: "DailyChallenge" | "DailyPremiumQuiz"
 *   gameId: "uuid" (optional - if provided, only checks that specific game)
 * }
 * 
 * Returns:
 * {
 *   success: true,
 *   completed: boolean,
 *   gameMode: "DailyChallenge",
 *   date: "2025-01-15" (YYYY-MM-DD format)
 * }
 */
function rpcQuizCheckDailyCompletion(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC quiz_check_daily_completion called");
    
    // Parse payload
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    
    // Validate required fields (only gameMode is required now)
    var validation = utils.validatePayload(data, ['gameMode']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    // Validate gameMode
    var validModes = ['DailyChallenge', 'DailyPremiumQuiz'];
    if (validModes.indexOf(data.gameMode) === -1) {
        return utils.handleError(ctx, null, "Invalid gameMode. Must be 'DailyChallenge' or 'DailyPremiumQuiz'");
    }
    
    // Validate gameId if provided (optional)
    if (data.gameId && !utils.isValidUUID(data.gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    try {
        // Get today's start timestamp (00:00:00 UTC)
        var todayStart = utils.getStartOfDay();
        var todayEnd = todayStart + 86400; // End of day (24 hours later)
        
        // Get current date string for response (YYYY-MM-DD)
        var today = new Date();
        var dateString = today.getUTCFullYear() + "-" + 
                          String(today.getUTCMonth() + 1).padStart(2, '0') + "-" + 
                          String(today.getUTCDate()).padStart(2, '0');
        
        var completed = false;
        
        // If gameId is provided, only check that specific collection
        if (data.gameId) {
            var collection = getResultsCollection(data.gameId);
            var limit = 100; // Check last 100 results (should be enough for daily check)
            
            var objects = nk.storageList(userId, collection, limit, "");
            
            // Check if any result matches gameMode and was submitted today
            for (var obj of objects.objects || []) {
                var result = JSON.parse(obj.value);
                
                // Check if gameMode matches
                if (result.gameMode !== data.gameMode) {
                    continue;
                }
                
                // Check if submitted today
                // result.timestamp is Unix timestamp in seconds
                if (result.timestamp >= todayStart && result.timestamp < todayEnd) {
                    completed = true;
                    utils.logInfo(logger, `User ${userId} completed ${data.gameMode} today (timestamp: ${result.timestamp})`);
                    break;
                }
            }
        } else {
            // No gameId provided - query transaction_logs which stores all quiz results
            var transactionCollection = "transaction_logs";
            var limit = 1000; // Higher limit to check more results
            var transactionObjects = nk.storageList(userId, transactionCollection, limit, "");
            
            // Check transaction logs for quiz results submitted today
            for (var obj of transactionObjects.objects || []) {
                var transaction = JSON.parse(obj.value);
                
                // Check if this is a quiz result transaction
                if (transaction.type === "quiz_result" && 
                    transaction.gameMode === data.gameMode) {
                    
                    // Parse timestamp from submittedAt (ISO string) or use timestamp if available
                    var transactionTimestamp = null;
                    if (transaction.timestamp) {
                        // If timestamp is a Unix timestamp (seconds)
                        if (typeof transaction.timestamp === 'number') {
                            transactionTimestamp = transaction.timestamp;
                        } else if (typeof transaction.timestamp === 'string') {
                            // If it's an ISO string, convert to Unix timestamp
                            var dateObj = new Date(transaction.timestamp);
                            if (!isNaN(dateObj.getTime())) {
                                transactionTimestamp = Math.floor(dateObj.getTime() / 1000);
                            }
                        }
                    } else if (transaction.submittedAt) {
                        // Fallback to submittedAt if timestamp not available
                        var dateObj = new Date(transaction.submittedAt);
                        if (!isNaN(dateObj.getTime())) {
                            transactionTimestamp = Math.floor(dateObj.getTime() / 1000);
                        }
                    }
                    
                    // Check if submitted today
                    if (transactionTimestamp && transactionTimestamp >= todayStart && transactionTimestamp < todayEnd) {
                        completed = true;
                        utils.logInfo(logger, `User ${userId} completed ${data.gameMode} today (from transaction log, timestamp: ${transactionTimestamp})`);
                        break;
                    }
                }
            }
        }
        
        return JSON.stringify({
            success: true,
            completed: completed,
            gameMode: data.gameMode,
            date: dateString
        });
        
    } catch (err) {
        utils.logError(logger, "Failed to check daily completion: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to check completion: " + err.message,
            completed: false
        });
    }
}
