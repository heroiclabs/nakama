// quiz_results.js - Quiz Results Tracking & Analytics System
// Stores ALL quiz results from ALL game modes for analytics, history, and leaderboards
//
// Seen-question merging is delegated to globalThis.__qvsSeen (quizverse_seen.js)
// so that OCC, scope/topic slugification, and the safety cap are applied consistently.

// ─────────────────────────────────────────────────────────────────────────────
// KNOWLEDGE MAP HISTORY — constants
// ─────────────────────────────────────────────────────────────────────────────
// Maximum number of per-question history entries kept per user in the knowledge
// map rolling window. Older entries are dropped when this cap is exceeded so the
// storageRead payload stays bounded regardless of play-session count.
var KM_HISTORY_MAX_ENTRIES = 2000;

// Canonical UUID → slug map. Mirrors the entry in analytics.js so both systems
// resolve to the same slug-based collection name without a shared dependency.
var KM_UUID_TO_SLUG = {
    "126bf539-dae2-4bcf-964d-316c0fa1f92b": "quiz-verse"
};

/**
 * Resolve a gameId (UUID or slug) to its short slug, which is used as the
 * prefix for the knowledge-map history collection.
 * Returns the input unchanged if no mapping is found (graceful no-op).
 */
function kmResolveSlug(gameId) {
    if (!gameId) return "quiz-verse";
    var mapped = KM_UUID_TO_SLUG[gameId];
    return mapped || gameId;
}

/**
 * Append per-question knowledge-map history entries for a completed quiz and
 * persist them as a rolling window in Nakama storage.
 *
 * Called as a non-critical side-effect of quiz_submit_result. Any failure is
 * caught and logged so it never blocks the main result submission.
 *
 * Entry sources (in priority order):
 *  1. data.questionHistory   — [{category, correct, time_ms}] (AsyncChallenge / ScoreCalculationEngine)
 *  1b. data.questionDetails  — [{category, isCorrect, timeTakenSeconds}] (IVXQuizResultsManager SDK)
 *  2. data.categoryName + result aggregate — one synthesized entry per quiz
 *
 * The synthesized fallback maps:
 *   category  = data.categoryName || data.categoryId || "general"
 *   correct   = accuracy >= 60 %  (i.e. the player knew most of this category)
 *   time_ms   = round(timeTakenSeconds / totalQuestions * 1000)  per-question avg
 *
 * Rolling window: after appending, entries are trimmed to KM_HISTORY_MAX_ENTRIES
 * keeping the most recent ones so the document stays bounded forever.
 */
function appendKnowledgeMapHistory(nk, logger, userId, data, result, metrics) {
    try {
        var slug = kmResolveSlug(data.gameId);
        var collection = slug + "_quiz_history";
        var storageKey  = "history";

        // Read current history document (may not exist yet for a new player).
        var existing = null;
        try {
            var records = nk.storageRead([{ collection: collection, key: storageKey, userId: userId }]);
            if (records && records.length > 0 && records[0].value) {
                existing = records[0].value;
            }
        } catch (readErr) {
            // Missing document is fine — we will create it below.
            logger.debug("[KMHistory] No existing history for user " + userId + " — creating new document.");
        }

        var entries = (existing && Array.isArray(existing.entries)) ? existing.entries : [];

        // ── Build new entries to append ───────────────────────────────────────
        var newEntries = [];

        // Priority 1: explicit per-question breakdown — QuestionHistoryEntry schema
        // (from AsyncChallengeManager / ScoreCalculationEngine).
        // Expected shape: [{category, correct, time_ms}]
        // Also accepts alternate field names for forward/backward compat.
        if (data.questionHistory && Array.isArray(data.questionHistory) && data.questionHistory.length > 0) {
            for (var qi = 0; qi < data.questionHistory.length; qi++) {
                var q = data.questionHistory[qi];
                if (!q || typeof q !== "object") continue;
                var cat     = q.category  || q.categoryName || q.categoryId || "general";
                var correct = (q.correct !== undefined) ? !!q.correct
                            : (q.was_correct !== undefined) ? !!q.was_correct
                            : false;
                var timeMs  = parseInt(q.time_ms || q.timeMs || 0, 10);
                newEntries.push({ category: cat, correct: correct, time_ms: timeMs });
            }
        }

        // Priority 1b: IVXQuizResultsManager.QuizResultData uses "questionDetails"
        // (QuestionAnswerDetail[] schema from the SDK).  Fields: category, isCorrect,
        // timeTakenSeconds (seconds, not ms).  This is the path used by
        // DailyQuizManager and any mode submitting through QuizContainer.
        if (newEntries.length === 0 &&
            data.questionDetails && Array.isArray(data.questionDetails) && data.questionDetails.length > 0) {
            for (var qd = 0; qd < data.questionDetails.length; qd++) {
                var d = data.questionDetails[qd];
                if (!d || typeof d !== "object") continue;
                var cat     = d.category || d.concept || "general";
                var correct = (d.isCorrect !== undefined) ? !!d.isCorrect : false;
                var timeMs  = Math.round((parseFloat(d.timeTakenSeconds) || 0) * 1000);
                newEntries.push({ category: cat, correct: correct, time_ms: timeMs });
            }
        }

        // Priority 2: synthesize one aggregate entry from the quiz-level result.
        // Used when Unity does not send a per-question breakdown (older clients,
        // multiplayer modes, etc.).
        if (newEntries.length === 0) {
            var cat     = data.categoryName || data.categoryId || "general";
            var correct = (typeof metrics.accuracy === "number") ? metrics.accuracy >= 60 : false;
            var perQMs  = (result.totalQuestions > 0)
                        ? Math.round((result.timeTakenSeconds * 1000) / result.totalQuestions)
                        : 0;
            newEntries.push({ category: cat, correct: correct, time_ms: perQMs });
        }

        // ── Append + enforce rolling cap ──────────────────────────────────────
        var combined = entries.concat(newEntries);
        if (combined.length > KM_HISTORY_MAX_ENTRIES) {
            combined = combined.slice(combined.length - KM_HISTORY_MAX_ENTRIES);
        }

        nk.storageWrite([{
            collection:      collection,
            key:             storageKey,
            userId:          userId,
            value:           { entries: combined },
            permissionRead:  1,
            permissionWrite: 0
        }]);

        logger.info("[KMHistory] Appended " + newEntries.length + " entries for user " + userId +
            " (total=" + combined.length + ", slug=" + slug + ")");

    } catch (err) {
        // Non-critical: never let a history write failure block the main submit.
        logger.warn("[KMHistory] appendKnowledgeMapHistory failed (non-critical): " + err.message);
    }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// MANAGER PLAYER SUMMARY — helpers (QVBF player-tracking)
// ─────────────────────────────────────────────────────────────────────────────
// A single clean, human-readable per-player document that the manager can read
// straight off the Nakama Console → Storage tab. Collection: "qv_player_stats",
// Key: "summary" (owner = userId, server-write only). Holds exactly the 5 asked
// metrics: Accuracy, Quizzes Taken, Quiz Scores, Consistency, Participation.

/** UTC calendar date string (YYYY-MM-DD). */
function qvDateStr(d) {
    return d.getUTCFullYear() + "-" +
        String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
        String(d.getUTCDate()).padStart(2, "0");
}

/** Whole days between two YYYY-MM-DD strings (b - a). */
function qvDaysBetween(a, b) {
    var ms = Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z");
    return Math.round(ms / 86400000);
}

/**
 * Build the compact, manager-facing player summary from the aggregate stats.
 * Pure function (no I/O) so it can be reused by both the write path
 * (updateUserStats) and the read path (quizverse_get_player_summary).
 *
 * Holds exactly the manager-requested metrics — Accuracy, Quizzes Taken,
 * Quiz Scores, Consistency, Participation — plus the raw counts behind them
 * for full transparency in the Nakama Console Storage tab.
 */
function buildPlayerSummary(stats) {
    stats = stats || {};

    var totalGames    = stats.totalGames || 0;
    var totalQuestions = stats.totalQuestions || 0;
    var totalCorrect  = stats.totalCorrect || 0;
    var totalScore    = stats.totalScore || 0;
    var totalTime     = stats.totalTimePlayed || 0;

    var accuracyPct = totalQuestions > 0
        ? Math.round((totalCorrect / totalQuestions) * 1000) / 10 : 0;
    var avgScore = totalGames > 0 ? Math.round(totalScore / totalGames) : 0;
    var winRatePct = totalGames > 0
        ? Math.round((stats.totalWins || 0) / totalGames * 100) : 0;
    var avgSecondsPerQuestion = totalQuestions > 0
        ? Math.round((totalTime / totalQuestions) * 10) / 10 : 0;

    // Consistency = how regularly they play: active days vs days since first play.
    var windowDays = (stats.firstPlayedDate && stats.lastPlayedDate)
        ? qvDaysBetween(stats.firstPlayedDate, stats.lastPlayedDate) + 1 : 1;
    if (windowDays < 1) windowDays = 1;
    var consistencyPct = Math.min(100, Math.round(((stats.activeDays || 0) / windowDays) * 100));

    return {
        // ── Quizzes Taken ──
        quizzesTaken: totalGames,
        // ── Accuracy ──
        accuracyPct: accuracyPct,
        correctAnswers: totalCorrect,
        totalQuestions: totalQuestions,
        // ── Quiz Scores ──
        totalScore: totalScore,
        avgScore: avgScore,
        highestScore: stats.highestScore || 0,
        // ── Performance ──
        wins: stats.totalWins || 0,
        winRatePct: winRatePct,
        perfectQuizzes: stats.perfectGames || 0,
        timePlayedSeconds: totalTime,
        avgSecondsPerQuestion: avgSecondsPerQuestion,
        // ── Consistency ──
        consistency: {
            consistencyPct: consistencyPct,
            currentStreakDays: stats.currentStreakDays || 0,
            longestStreakDays: stats.longestStreakDays || 0,
            activeDays: stats.activeDays || 0,
            firstPlayedDate: stats.firstPlayedDate || null,
            lastPlayedDate: stats.lastPlayedDate || null
        },
        // ── Participation (per game mode) ──
        participationByMode: stats.modeStats || {},
        updatedAt: utils.getCurrentTimestamp()
    };
}

/**
 * Build a compact, flat snapshot for the Nakama Console **Account tab**
 * (account.metadata). Kept small + string-friendly so it reads cleanly in the
 * metadata box. Full structured data still lives in the Storage tab.
 */
function buildAccountStatsSnapshot(summary) {
    return {
        quizzesTaken: summary.quizzesTaken,
        accuracyPct: summary.accuracyPct,
        avgScore: summary.avgScore,
        highestScore: summary.highestScore,
        totalScore: summary.totalScore,
        wins: summary.wins,
        winRatePct: summary.winRatePct,
        consistencyPct: summary.consistency.consistencyPct,
        currentStreakDays: summary.consistency.currentStreakDays,
        longestStreakDays: summary.consistency.longestStreakDays,
        activeDays: summary.consistency.activeDays,
        lastPlayedDate: summary.consistency.lastPlayedDate,
        updatedAt: summary.updatedAt
    };
}

/**
 * Merge the quiz-stats snapshot into the player's account.metadata so it shows
 * on the Console **Account tab**. Reads existing metadata first and merges,
 * so pre-existing keys (e.g. country) are preserved. Non-critical.
 */
function writeAccountStatsMeta(nk, logger, userId, summary) {
    try {
        var meta = {};
        var user = null;
        try {
            var acct = nk.accountGetId(userId);
            user = (acct && acct.user) || null;
            if (user && user.metadata) {
                meta = user.metadata;
            }
        } catch (readErr) {
            // user may not exist yet / no account — skip silently
            return;
        }

        meta.quizStats = buildAccountStatsSnapshot(summary);

        // Backfill native Account-tab fields ONLY when empty — never clobber
        // real values the user/profile-sync already set.
        //   • Display name → fall back to username
        //   • Location     → fall back to the country already in metadata (e.g. "IN")
        var displayName = null;
        if (user && (!user.displayName || user.displayName === "") && user.username) {
            displayName = user.username;
        }
        var location = null;
        if (user && (!user.location || user.location === "") && meta && meta.country) {
            location = String(meta.country);
        }

        // Signature: accountUpdateId(userId, username, displayName, timezone, location, langTag, avatarUrl, metadata)
        nk.accountUpdateId(userId, null, displayName, null, location, null, null, meta);
    } catch (err) {
        utils.logWarning(logger, "[PlayerSummary] account metadata update failed (non-critical): " + err.message);
    }
}

/**
 * Write the compact manager-facing summary from the aggregate stats to BOTH:
 *   1. Storage tab  → qv_player_stats/summary  (full structured doc)
 *   2. Account tab  → account.metadata.quizStats (compact snapshot)
 * Non-critical: never blocks result submission.
 */
function writePlayerSummary(nk, logger, userId, stats) {
    var summary = buildPlayerSummary(stats);
    try {
        nk.storageWrite([{
            collection: "qv_player_stats",
            key: "summary",
            userId: userId,
            value: summary,
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (err) {
        utils.logWarning(logger, "[PlayerSummary] storage write failed (non-critical): " + err.message);
    }
    writeAccountStatsMeta(nk, logger, userId, summary);
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
            // Day-based consistency (distinct calendar days played)
            firstPlayedDate: null,
            lastPlayedDate: null,
            activeDays: 0,
            currentStreakDays: 0,
            longestStreakDays: 0,
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

    // ── Day-based consistency tracking (distinct calendar days + day streak) ──
    var todayStr = qvDateStr(new Date());
    if (!stats.firstPlayedDate) stats.firstPlayedDate = todayStr;
    if (stats.lastPlayedDate !== todayStr) {
        // New distinct day played.
        stats.activeDays = (stats.activeDays || 0) + 1;
        if (stats.lastPlayedDate && qvDaysBetween(stats.lastPlayedDate, todayStr) === 1) {
            stats.currentStreakDays = (stats.currentStreakDays || 0) + 1; // consecutive day
        } else {
            stats.currentStreakDays = 1; // first day or a gap → reset
        }
        stats.longestStreakDays = Math.max(stats.longestStreakDays || 0, stats.currentStreakDays);
        stats.lastPlayedDate = todayStr;
    }
    
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

    // Write the compact manager-facing summary (qv_player_stats/summary).
    writePlayerSummary(nk, logger, userId, stats);

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
        
        // 5. Merge seen question IDs into the qv_seen ledger (if provided)
        // Delegates to globalThis.__qvsSeen (quizverse_seen.js) for OCC-safe,
        // correctly slugified writes. Supports both top-level and nested metadata
        // layouts from the Unity SDK.
        var seenIds = null;
        var seenScopeRaw = null;
        var seenTopicRaw = null;
        if (data.seenQuestionIds && Array.isArray(data.seenQuestionIds) && data.seenQuestionIds.length > 0) {
            seenIds = data.seenQuestionIds;
            seenScopeRaw = data.seenScope;
            seenTopicRaw = data.seenTopic;
        } else if (data.metadata && data.metadata.seenQuestionIds &&
                   Array.isArray(data.metadata.seenQuestionIds) && data.metadata.seenQuestionIds.length > 0) {
            seenIds = data.metadata.seenQuestionIds;
            seenScopeRaw = data.metadata.seenScope;
            seenTopicRaw = data.metadata.seenTopic;
        }
        if (seenIds && seenIds.length > 0) {
            try {
                var seenScope = seenScopeRaw || "global";
                var seenTopic = seenTopicRaw || data.categoryName || "general";
                globalThis.__qvsSeen.merge(nk, userId, seenScope, seenTopic, seenIds);
                utils.logInfo(logger, "Merged " + seenIds.length +
                    " seen IDs into qv_seen/" + globalThis.__qvsSeen.buildKey(seenScope, seenTopic) +
                    " for user " + userId);
            } catch (seenErr) {
                utils.logWarning(logger, "Seen ledger merge failed (non-critical): " + seenErr.message);
            }
        }

        // 6. Append per-question entries to the knowledge-map history document.
        // Non-critical: wrapped internally so failures never block the response.
        appendKnowledgeMapHistory(nk, logger, userId, data, result, metrics);

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

/**
 * RPC: quizverse_get_player_summary
 * Returns the compact, manager-facing player summary (accuracy, quizzes taken,
 * scores, consistency, participation) for the authenticated user.
 *
 * Read order (world-class, never empty for an existing player):
 *   1. qv_player_stats/summary           — the canonical pre-built doc
 *   2. quiz_user_stats_<gameId>/stats_*  — fallback: build on the fly AND
 *                                          lazily backfill the summary doc
 *   3. zeroed summary                    — brand-new player (no quizzes yet)
 *
 * Optional payload: { "gameId": "<uuid>" } (defaults to the QuizVerse game id).
 */
var QV_DEFAULT_GAME_ID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";

function rpcQuizverseGetPlayerSummary(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }

    var gameId = QV_DEFAULT_GAME_ID;
    if (payload) {
        var parsed = utils.safeJsonParse(payload);
        if (parsed.success && parsed.data && parsed.data.gameId && utils.isValidUUID(parsed.data.gameId)) {
            gameId = parsed.data.gameId;
        }
    }

    try {
        // 1. Canonical pre-built summary.
        var existing = utils.readStorage(nk, logger, "qv_player_stats", "summary", userId);
        if (existing) {
            return JSON.stringify({ success: true, summary: existing, source: "summary" });
        }

        // 2. Fallback: build from aggregate stats + lazily backfill the summary doc.
        var stats = utils.readStorage(nk, logger, getUserStatsCollection(gameId), "stats_" + userId, userId);
        if (stats) {
            var built = buildPlayerSummary(stats);
            try { writePlayerSummary(nk, logger, userId, stats); } catch (e) { /* non-critical */ }
            return JSON.stringify({ success: true, summary: built, source: "backfill" });
        }

        // 3. Brand-new player — return a complete, zeroed summary (never null).
        return JSON.stringify({ success: true, summary: buildPlayerSummary({}), source: "empty" });

    } catch (err) {
        utils.logError(logger, "quizverse_get_player_summary failed: " + err.message);
        return JSON.stringify({ success: false, error: "Failed to load summary: " + err.message });
    }
}

/**
 * RPC: quizverse_backfill_player_summaries  (ADMIN / one-time)
 * Scans every existing `quiz_user_stats_<gameId>/stats_*` doc across ALL users
 * and writes their summary (Storage tab) + account snapshot (Account tab).
 * Use this once after deploy so players who already played show up immediately
 * instead of only after their next quiz.
 *
 * Security: runtime-only. Must be called WITHOUT a user session (Nakama Console
 * API Explorer "Run as the system" / server HTTP key). A logged-in user cannot
 * run it.
 *
 * Optional payload: { "gameId": "<uuid>" } (defaults to the QuizVerse game id).
 * Returns: { success, gameId, processed, errors }.
 */
function rpcQuizverseBackfillPlayerSummaries(ctx, logger, nk, payload) {
    // Admin gate: allow only runtime/system callers.
    //   • HTTP server-key call  → ctx.userId === ""        (empty)
    //   • Console "run as system" → ctx.userId === zero-UUID
    // A real logged-in player is rejected.
    var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
    if (ctx.userId && ctx.userId !== SYSTEM_USER_ID) {
        return JSON.stringify({ success: false, error: "Admin only — run without a user session (server key) or as the system user." });
    }

    var gameId = QV_DEFAULT_GAME_ID;
    if (payload) {
        var parsed = utils.safeJsonParse(payload);
        if (parsed.success && parsed.data && parsed.data.gameId && utils.isValidUUID(parsed.data.gameId)) {
            gameId = parsed.data.gameId;
        }
    }

    var collection = getUserStatsCollection(gameId);
    var processed = 0;
    var errors = 0;
    var cursor = "";

    try {
        do {
            // userId = null → list this collection across ALL users (admin scan).
            var page = nk.storageList(null, collection, 100, cursor);
            var objects = (page && page.objects) || [];

            for (var i = 0; i < objects.length; i++) {
                var obj = objects[i];
                try {
                    var stats = obj.value;
                    if (typeof stats === "string") {
                        stats = JSON.parse(stats);
                    }
                    writePlayerSummary(nk, logger, obj.userId, stats);
                    processed++;
                } catch (rowErr) {
                    errors++;
                    utils.logWarning(logger, "[Backfill] failed for user " + (obj && obj.userId) + ": " + rowErr.message);
                }
            }

            cursor = (page && page.cursor) || "";
        } while (cursor);

        utils.logInfo(logger, "[Backfill] done — gameId=" + gameId + " processed=" + processed + " errors=" + errors);
        return JSON.stringify({ success: true, gameId: gameId, processed: processed, errors: errors });
    } catch (err) {
        utils.logError(logger, "quizverse_backfill_player_summaries failed: " + err.message);
        return JSON.stringify({ success: false, error: err.message, processed: processed, errors: errors });
    }
}

// ============================================================================
// MODULE INIT (postbuild AST hook)
// ----------------------------------------------------------------------------
// Registers the harmonized `rpcQuizSubmitResult` (with qv_seen ledger merge)
// over the legacy_runtime.js copy. postbuild's collision-rename pass renames
// the legacy declaration to `__legacy_rpcQuizSubmitResult`, so the modules
// version wins at the global scope when the guarded `||` assignments are
// replayed (modules first, legacy fallback second).
// ============================================================================
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("quiz_submit_result",         rpcQuizSubmitResult);
    initializer.registerRpc("quiz_get_history",           rpcQuizGetHistory);
    initializer.registerRpc("quiz_get_stats",             rpcQuizGetStats);
    initializer.registerRpc("quiz_check_daily_completion", rpcQuizCheckDailyCompletion);
    initializer.registerRpc("quizverse_get_player_summary", rpcQuizverseGetPlayerSummary);
    initializer.registerRpc("quizverse_backfill_player_summaries", rpcQuizverseBackfillPlayerSummaries);

    // ── Cross-module bridge ───────────────────────────────────────────────────
    // Expose appendKnowledgeMapHistory on globalThis so sibling modules
    // (legacy_runtime.js, async_challenge, etc.) can write knowledge-map history
    // entries without a hard module dependency.
    // Pattern mirrors globalThis.__qvsSeen used by the seen-question ledger.
    // Guarded with `||` so the first module to register wins (identical to the
    // postbuild collision-rename convention used throughout this codebase).
    globalThis.__kmAppendHistory = globalThis.__kmAppendHistory || appendKnowledgeMapHistory;

    logger.info("[QuizResults] Module InitModule registered: 4 RPCs + __kmAppendHistory bridge");
}
