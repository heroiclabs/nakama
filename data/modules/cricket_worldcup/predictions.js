/**
 * Cricket Prediction System - Nakama Server Module
 * Handles match predictions, trivia boosts, and point calculations
 */

// Collections
const PREDICTIONS_COLLECTION = 'cricket_predictions';
const RESULTS_COLLECTION = 'cricket_results';
const LEADERBOARD_PREDICTION = 'cricket_prediction_leaderboard';
const LEADERBOARD_DAILY = 'cricket_daily_prediction';

// Point values
const POINTS = {
    CORRECT_WINNER: 100,
    EXACT_SCORE: 200,
    CLOSE_SCORE: 50,        // Within 10 runs
    CORRECT_MOTM: 50,
    CORRECT_TOP_SCORER: 30,
    CORRECT_TOP_BOWLER: 30,
    MEGA_MATCH_MULTIPLIER: 2,
    TRIVIA_BONUS_PER_CORRECT: 50,
    STREAK_BONUS_MULTIPLIER: 1.5
};

/**
 * Submit a match prediction
 * Called when user makes prediction from notification or app
 */
function rpcSubmitPrediction(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    const data = JSON.parse(payload);
    
    const { 
        matchId, 
        team1, 
        team2, 
        predictedWinner, 
        predictedTeam1Score, 
        predictedTeam2Score,
        predictedMOTM,
        predictedTopScorer,
        predictedTopBowler,
        tournament,
        isMegaMatch
    } = data;

    if (!matchId || !predictedWinner) {
        throw new Error('Missing required prediction data');
    }

    // Check if prediction already exists
    const existingPredictions = nk.storageRead([{
        collection: PREDICTIONS_COLLECTION,
        key: matchId,
        userId: userId
    }]);

    if (existingPredictions.length > 0) {
        // Update existing prediction (if not locked)
        const existing = JSON.parse(existingPredictions[0].value);
        if (existing.locked) {
            throw new Error('Prediction is locked - match has started');
        }
    }

    const prediction = {
        matchId,
        team1,
        team2,
        predictedWinner,
        predictedTeam1Score: predictedTeam1Score || 0,
        predictedTeam2Score: predictedTeam2Score || 0,
        predictedMOTM: predictedMOTM || '',
        predictedTopScorer: predictedTopScorer || '',
        predictedTopBowler: predictedTopBowler || '',
        tournament: tournament || 'unknown',
        isMegaMatch: isMegaMatch || false,
        bonusPoints: 0,
        triviaCorrect: 0,
        triviaTotal: 0,
        submittedAt: Date.now(),
        locked: false,
        processed: false
    };

    // Save prediction
    nk.storageWrite([{
        collection: PREDICTIONS_COLLECTION,
        key: matchId,
        userId: userId,
        value: JSON.stringify(prediction),
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`[Prediction] User ${userId} predicted ${predictedWinner} for match ${matchId}`);

    return JSON.stringify({
        success: true,
        prediction,
        message: 'Prediction submitted successfully!'
    });
}

/**
 * Add trivia boost to a prediction
 */
function rpcAddTriviaBoost(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    const data = JSON.parse(payload);
    
    const { matchId, triviaCorrect, triviaTotal } = data;

    if (!matchId) {
        throw new Error('Missing matchId');
    }

    // Get existing prediction
    const predictions = nk.storageRead([{
        collection: PREDICTIONS_COLLECTION,
        key: matchId,
        userId: userId
    }]);

    if (predictions.length === 0) {
        throw new Error('No prediction found for this match');
    }

    const prediction = JSON.parse(predictions[0].value);
    
    if (prediction.locked) {
        throw new Error('Cannot add trivia boost - prediction is locked');
    }

    // Calculate bonus
    const bonusPoints = triviaCorrect * POINTS.TRIVIA_BONUS_PER_CORRECT;
    
    prediction.triviaCorrect = triviaCorrect;
    prediction.triviaTotal = triviaTotal;
    prediction.bonusPoints = bonusPoints;

    // Save updated prediction
    nk.storageWrite([{
        collection: PREDICTIONS_COLLECTION,
        key: matchId,
        userId: userId,
        value: JSON.stringify(prediction),
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`[Prediction] User ${userId} earned ${bonusPoints} trivia bonus for match ${matchId}`);

    return JSON.stringify({
        success: true,
        bonusPoints,
        totalBonus: prediction.bonusPoints
    });
}

/**
 * Lock predictions for a match (called before match starts)
 */
function rpcLockMatchPredictions(ctx, logger, nk, payload) {
    const data = JSON.parse(payload);
    const { matchId, adminKey } = data;

    // Simple admin check (in production, use proper auth)
    if (adminKey !== 'cricket_admin_2026') {
        throw new Error('Unauthorized');
    }

    // List all predictions for this match
    const cursor = '';
    const predictions = nk.storageList(userId = null, PREDICTIONS_COLLECTION, 100, cursor);

    let lockedCount = 0;
    const writes = [];

    for (const pred of predictions) {
        if (pred.key === matchId) {
            const predData = JSON.parse(pred.value);
            predData.locked = true;
            writes.push({
                collection: PREDICTIONS_COLLECTION,
                key: matchId,
                userId: pred.userId,
                value: JSON.stringify(predData),
                permissionRead: 1,
                permissionWrite: 0
            });
            lockedCount++;
        }
    }

    if (writes.length > 0) {
        nk.storageWrite(writes);
    }

    logger.info(`[Prediction] Locked ${lockedCount} predictions for match ${matchId}`);

    return JSON.stringify({
        success: true,
        lockedCount
    });
}

/**
 * Process match results and calculate points
 */
function rpcProcessMatchResults(ctx, logger, nk, payload) {
    const data = JSON.parse(payload);
    const { 
        matchId, 
        winner, 
        team1Score, 
        team2Score, 
        motm, 
        topScorer, 
        topBowler,
        adminKey 
    } = data;

    // Admin check
    if (adminKey !== 'cricket_admin_2026') {
        throw new Error('Unauthorized');
    }

    // Get all predictions for this match
    const predictions = [];
    // Note: In production, implement proper pagination
    const results = nk.storageList(null, PREDICTIONS_COLLECTION, 1000, '');
    
    for (const pred of results) {
        if (pred.key === matchId) {
            predictions.push({
                userId: pred.userId,
                data: JSON.parse(pred.value)
            });
        }
    }

    logger.info(`[Prediction] Processing ${predictions.length} predictions for match ${matchId}`);

    const leaderboardWrites = [];

    for (const pred of predictions) {
        const { userId, data: predData } = pred;
        let points = 0;
        const breakdown = [];

        // Correct winner
        if (predData.predictedWinner === winner) {
            let winnerPoints = POINTS.CORRECT_WINNER;
            if (predData.isMegaMatch) {
                winnerPoints *= POINTS.MEGA_MATCH_MULTIPLIER;
            }
            points += winnerPoints;
            breakdown.push({ type: 'winner', points: winnerPoints });
        }

        // Score prediction
        const predTeam1Diff = Math.abs(predData.predictedTeam1Score - team1Score);
        const predTeam2Diff = Math.abs(predData.predictedTeam2Score - team2Score);
        
        if (predTeam1Diff === 0 && predTeam2Diff === 0) {
            points += POINTS.EXACT_SCORE;
            breakdown.push({ type: 'exact_score', points: POINTS.EXACT_SCORE });
        } else if (predTeam1Diff <= 10 && predTeam2Diff <= 10) {
            points += POINTS.CLOSE_SCORE;
            breakdown.push({ type: 'close_score', points: POINTS.CLOSE_SCORE });
        }

        // MOTM
        if (predData.predictedMOTM && predData.predictedMOTM === motm) {
            points += POINTS.CORRECT_MOTM;
            breakdown.push({ type: 'motm', points: POINTS.CORRECT_MOTM });
        }

        // Top scorer
        if (predData.predictedTopScorer && predData.predictedTopScorer === topScorer) {
            points += POINTS.CORRECT_TOP_SCORER;
            breakdown.push({ type: 'top_scorer', points: POINTS.CORRECT_TOP_SCORER });
        }

        // Top bowler
        if (predData.predictedTopBowler && predData.predictedTopBowler === topBowler) {
            points += POINTS.CORRECT_TOP_BOWLER;
            breakdown.push({ type: 'top_bowler', points: POINTS.CORRECT_TOP_BOWLER });
        }

        // Add trivia bonus
        points += predData.bonusPoints || 0;
        if (predData.bonusPoints > 0) {
            breakdown.push({ type: 'trivia_bonus', points: predData.bonusPoints });
        }

        // Save result
        const result = {
            matchId,
            userId,
            totalPoints: points,
            breakdown,
            winnerCorrect: predData.predictedWinner === winner,
            processedAt: Date.now()
        };

        nk.storageWrite([{
            collection: RESULTS_COLLECTION,
            key: matchId,
            userId: userId,
            value: JSON.stringify(result),
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Update leaderboard
        leaderboardWrites.push({
            id: LEADERBOARD_PREDICTION,
            owner: userId,
            score: points,
            subscore: predData.bonusPoints || 0
        });

        logger.info(`[Prediction] User ${userId} earned ${points} points for match ${matchId}`);
    }

    // Submit leaderboard scores
    if (leaderboardWrites.length > 0) {
        for (const write of leaderboardWrites) {
            nk.leaderboardRecordWrite(write.id, write.owner, '', write.score, write.subscore, null);
        }
    }

    return JSON.stringify({
        success: true,
        processedCount: predictions.length
    });
}

/**
 * Get user's prediction for a match
 */
function rpcGetPrediction(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    const data = JSON.parse(payload);
    const { matchId } = data;

    const predictions = nk.storageRead([{
        collection: PREDICTIONS_COLLECTION,
        key: matchId,
        userId: userId
    }]);

    if (predictions.length === 0) {
        return JSON.stringify({ hasPrediction: false });
    }

    const prediction = JSON.parse(predictions[0].value);

    // Check for result
    const results = nk.storageRead([{
        collection: RESULTS_COLLECTION,
        key: matchId,
        userId: userId
    }]);

    let result = null;
    if (results.length > 0) {
        result = JSON.parse(results[0].value);
    }

    return JSON.stringify({
        hasPrediction: true,
        prediction,
        result
    });
}

/**
 * Get prediction leaderboard
 */
function rpcGetPredictionLeaderboard(ctx, logger, nk, payload) {
    const data = JSON.parse(payload);
    const { limit = 100, cursor = '' } = data;

    const records = nk.leaderboardRecordsList(
        LEADERBOARD_PREDICTION,
        [],
        limit,
        cursor,
        0
    );

    // Get user's own record
    const userId = ctx.userId;
    let userRecord = null;
    
    const userRecords = nk.leaderboardRecordsList(
        LEADERBOARD_PREDICTION,
        [userId],
        1,
        '',
        userId
    );

    if (userRecords.records && userRecords.records.length > 0) {
        userRecord = userRecords.records[0];
    }

    return JSON.stringify({
        records: records.records || [],
        nextCursor: records.nextCursor || '',
        userRecord
    });
}

/**
 * Get user's prediction stats
 */
function rpcGetPredictionStats(ctx, logger, nk, payload) {
    const userId = ctx.userId;

    // Get all user's results
    const results = nk.storageList(userId, RESULTS_COLLECTION, 100, '');

    let totalPredictions = 0;
    let correctPredictions = 0;
    let totalPoints = 0;
    let totalTriviaBonus = 0;
    let currentStreak = 0;
    let maxStreak = 0;

    for (const res of results) {
        const result = JSON.parse(res.value);
        totalPredictions++;
        totalPoints += result.totalPoints;

        if (result.winnerCorrect) {
            correctPredictions++;
            currentStreak++;
            maxStreak = Math.max(maxStreak, currentStreak);
        } else {
            currentStreak = 0;
        }

        // Get trivia bonus from breakdown
        const triviaBonus = result.breakdown?.find(b => b.type === 'trivia_bonus');
        if (triviaBonus) {
            totalTriviaBonus += triviaBonus.points;
        }
    }

    const accuracy = totalPredictions > 0 ? 
        Math.round((correctPredictions / totalPredictions) * 100) : 0;

    return JSON.stringify({
        totalPredictions,
        correctPredictions,
        accuracy,
        totalPoints,
        totalTriviaBonus,
        currentStreak,
        maxStreak
    });
}

/**
 * Get community prediction stats for a match
 */
function rpcGetCommunityPredictions(ctx, logger, nk, payload) {
    const data = JSON.parse(payload);
    const { matchId } = data;

    // Get all predictions for this match
    const predictions = nk.storageList(null, PREDICTIONS_COLLECTION, 1000, '');
    
    let team1Votes = 0;
    let team2Votes = 0;
    let totalPredictions = 0;
    let avgTeam1Score = 0;
    let avgTeam2Score = 0;

    for (const pred of predictions) {
        if (pred.key === matchId) {
            const predData = JSON.parse(pred.value);
            totalPredictions++;

            if (predData.predictedWinner === predData.team1) {
                team1Votes++;
            } else {
                team2Votes++;
            }

            avgTeam1Score += predData.predictedTeam1Score || 0;
            avgTeam2Score += predData.predictedTeam2Score || 0;
        }
    }

    if (totalPredictions > 0) {
        avgTeam1Score = Math.round(avgTeam1Score / totalPredictions);
        avgTeam2Score = Math.round(avgTeam2Score / totalPredictions);
    }

    return JSON.stringify({
        matchId,
        totalPredictions,
        team1Percentage: totalPredictions > 0 ? Math.round((team1Votes / totalPredictions) * 100) : 50,
        team2Percentage: totalPredictions > 0 ? Math.round((team2Votes / totalPredictions) * 100) : 50,
        avgTeam1Score,
        avgTeam2Score
    });
}

// Register RPCs
var rpcFunctions = {
    'cricket_submit_prediction': rpcSubmitPrediction,
    'cricket_add_trivia_boost': rpcAddTriviaBoost,
    'cricket_lock_predictions': rpcLockMatchPredictions,
    'cricket_process_results': rpcProcessMatchResults,
    'cricket_get_prediction': rpcGetPrediction,
    'cricket_get_prediction_leaderboard': rpcGetPredictionLeaderboard,
    'cricket_get_prediction_stats': rpcGetPredictionStats,
    'cricket_get_community_predictions': rpcGetCommunityPredictions
};

// Export for Nakama
for (var name in rpcFunctions) {
    var InitModule = function(ctx, logger, nk, initializer) {
        initializer.registerRpc(name, rpcFunctions[name]);
    };
}
