/**
 * ICC T20 World Cup 2026 Cricket Module
 * For Nakama Server
 * 
 * Features:
 * - Match Predictions
 * - Score Predictions
 * - Trivia Integration
 * - Leaderboards
 * - Live Match Engagement
 */

// ============================================================================
// CRICKET WORLD CUP 2026 MODULE
// ============================================================================

const CRICKET_WC_COLLECTION = "cricket_worldcup_2026";
const CRICKET_PREDICTIONS_COLLECTION = "cricket_predictions";
const CRICKET_LEADERBOARD_ID = "cricket_worldcup_2026_leaderboard";
const CRICKET_TRIVIA_LEADERBOARD = "cricket_trivia_leaderboard";

// Points Configuration
const CRICKET_POINTS = {
    // Prediction Points
    correctWinner: 100,
    exactScore: 200,
    closeScore: 50,          // Within 10 runs
    correctMOTM: 50,
    correctTopScorer: 30,
    correctTopBowler: 30,
    
    // Trivia Points
    triviaCorrect: 10,
    triviaStreak3: 30,
    triviaStreak5: 75,
    triviaPerfect: 150,
    
    // Engagement Bonuses
    earlyPrediction: 25,     // 24h+ before match
    megaMatchBonus: 2.0,     // IND vs PAK etc.
    dailyLogin: 50,
    streakDay3: 100,
    streakDay7: 300,
};

// ============================================================================
// RPC: Submit Match Prediction
// ============================================================================
function rpcCricketSubmitPrediction(ctx, logger, nk, payload) {
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
    
    const { matchId, prediction, gameId } = data;
    
    if (!matchId || !prediction) {
        return JSON.stringify({ success: false, error: "matchId and prediction required" });
    }
    
    // Validate prediction fields
    const { winner, winningScore, losingScore, motm, topScorer, topBowler } = prediction;
    
    if (!winner || !winningScore) {
        return JSON.stringify({ success: false, error: "winner and winningScore required" });
    }
    
    // Check for existing prediction
    const existingKey = `${matchId}_prediction`;
    try {
        const existing = nk.storageRead([{
            collection: CRICKET_PREDICTIONS_COLLECTION,
            key: existingKey,
            userId: userId
        }]);
        
        if (existing && existing.length > 0) {
            return JSON.stringify({ 
                success: false, 
                error: "Prediction already submitted for this match",
                existingPrediction: existing[0].value 
            });
        }
    } catch (e) {
        // No existing prediction, continue
    }
    
    // Calculate early bird bonus
    let earlyBonus = 0;
    const now = Date.now();
    // In production, check match start time from schedule
    
    // Create prediction record
    const predictionRecord = {
        matchId: matchId,
        gameId: gameId || "cricket",
        prediction: {
            winner: winner,
            winningScore: parseInt(winningScore),
            losingScore: parseInt(losingScore) || 0,
            motm: motm || "",
            topScorer: topScorer || "",
            topBowler: topBowler || "",
        },
        submittedAt: now,
        earlyBonus: earlyBonus,
        processed: false,
        pointsEarned: 0,
    };
    
    // Save prediction
    try {
        nk.storageWrite([{
            collection: CRICKET_PREDICTIONS_COLLECTION,
            key: existingKey,
            userId: userId,
            value: predictionRecord,
            permissionRead: 1,
            permissionWrite: 1,
        }]);
    } catch (e) {
        return JSON.stringify({ success: false, error: "Failed to save prediction: " + e.message });
    }
    
    // Award participation coins (10 coins)
    try {
        nk.walletUpdate(userId, { coins: 10 }, { reason: "prediction_participation" }, true);
    } catch (e) {
        logger.warn("[Cricket] Failed to award coins: " + e.message);
    }
    
    logger.info("[Cricket] Prediction submitted: " + userId + " for match " + matchId);
    
    return JSON.stringify({
        success: true,
        message: "Prediction submitted successfully!",
        prediction: predictionRecord,
        coinsEarned: 10 + earlyBonus,
    });
}

// ============================================================================
// RPC: Get User Predictions
// ============================================================================
function rpcCricketGetPredictions(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    
    let matchId = null;
    if (payload) {
        try {
            const data = JSON.parse(payload);
            matchId = data.matchId;
        } catch (e) {}
    }
    
    try {
        const result = nk.storageList(userId, CRICKET_PREDICTIONS_COLLECTION, 100, "");
        let predictions = result.objects || [];
        
        // Filter by matchId if provided
        if (matchId) {
            predictions = predictions.filter(p => p.value.matchId === matchId);
        }
        
        return JSON.stringify({
            success: true,
            predictions: predictions.map(p => p.value),
            count: predictions.length,
        });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

// ============================================================================
// RPC: Get Prediction Leaderboard
// ============================================================================
function rpcCricketGetLeaderboard(ctx, logger, nk, payload) {
    let limit = 100;
    let ownerIds = [];
    
    if (payload) {
        try {
            const data = JSON.parse(payload);
            limit = data.limit || 100;
            if (data.userId) {
                ownerIds = [data.userId];
            }
        } catch (e) {}
    }
    
    try {
        // Ensure leaderboard exists
        try {
            nk.leaderboardCreate(
                CRICKET_LEADERBOARD_ID,
                false,  // authoritative
                "desc", // sort order
                "incr", // operator
                "",     // reset schedule
                null    // metadata
            );
        } catch (e) {
            // Already exists
        }
        
        const records = nk.leaderboardRecordsList(
            CRICKET_LEADERBOARD_ID,
            ownerIds,
            limit,
            "",
            0
        );
        
        return JSON.stringify({
            success: true,
            leaderboard: records.records || [],
            ownerRecords: records.ownerRecords || [],
        });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

// ============================================================================
// RPC: Get User World Cup Stats
// ============================================================================
function rpcCricketGetUserStats(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    
    try {
        // Get all predictions
        const result = nk.storageList(userId, CRICKET_PREDICTIONS_COLLECTION, 100, "");
        const predictions = result.objects || [];
        
        // Calculate stats
        let totalPredictions = predictions.length;
        let correctPredictions = 0;
        let totalPoints = 0;
        let currentStreak = 0;
        let bestStreak = 0;
        let tempStreak = 0;
        
        for (const pred of predictions) {
            const p = pred.value;
            if (p.processed) {
                totalPoints += p.pointsEarned || 0;
                if (p.pointsEarned > 0) {
                    correctPredictions++;
                    tempStreak++;
                    if (tempStreak > bestStreak) bestStreak = tempStreak;
                } else {
                    tempStreak = 0;
                }
            }
        }
        currentStreak = tempStreak;
        
        // Get leaderboard rank
        let rank = 0;
        try {
            const records = nk.leaderboardRecordsList(CRICKET_LEADERBOARD_ID, [userId], 1, "", 0);
            if (records.ownerRecords && records.ownerRecords.length > 0) {
                rank = records.ownerRecords[0].rank;
            }
        } catch (e) {}
        
        return JSON.stringify({
            success: true,
            stats: {
                totalPredictions,
                correctPredictions,
                accuracy: totalPredictions > 0 ? (correctPredictions / totalPredictions * 100).toFixed(1) : 0,
                totalPoints,
                currentStreak,
                bestStreak,
                rank,
            },
        });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

// ============================================================================
// RPC: Process Match Result (Admin)
// ============================================================================
function rpcCricketProcessMatchResult(ctx, logger, nk, payload) {
    if (!payload) {
        return JSON.stringify({ success: false, error: "Payload required" });
    }
    
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid JSON" });
    }
    
    const { matchId, result, isMegaMatch } = data;
    
    if (!matchId || !result) {
        return JSON.stringify({ success: false, error: "matchId and result required" });
    }
    
    const { winner, winningScore, losingScore, motm, topScorer, topBowler } = result;
    
    // Get all predictions for this match
    // In production, use storage index
    // For now, we'll do a basic query
    
    let processedCount = 0;
    let totalPointsAwarded = 0;
    const bonusMultiplier = isMegaMatch ? CRICKET_POINTS.megaMatchBonus : 1.0;
    
    // Process each prediction
    // Note: In production, use pagination for large datasets
    const users = nk.usersGetId([]); // Get all users - simplified
    
    // For each user, check their prediction
    logger.info("[Cricket] Processing match " + matchId + " results...");
    
    // Example processing for one user (in production, iterate through all)
    // This is a simplified version
    
    return JSON.stringify({
        success: true,
        matchId: matchId,
        processedCount: processedCount,
        totalPointsAwarded: totalPointsAwarded,
        bonusMultiplier: bonusMultiplier,
    });
}

// ============================================================================
// RPC: Get Community Prediction Stats
// ============================================================================
function rpcCricketGetCommunityStats(ctx, logger, nk, payload) {
    if (!payload) {
        return JSON.stringify({ success: false, error: "matchId required" });
    }
    
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid JSON" });
    }
    
    const { matchId } = data;
    
    // In production, aggregate from all predictions
    // For now, return placeholder
    return JSON.stringify({
        success: true,
        matchId: matchId,
        stats: {
            totalPredictions: 0,
            team1VotePercent: 50,
            team2VotePercent: 50,
            avgPredictedScore: 165,
        },
    });
}

// ============================================================================
// RPC: Submit Trivia Score (World Cup themed)
// ============================================================================
function rpcCricketSubmitTriviaScore(ctx, logger, nk, payload) {
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
    
    const { score, correctAnswers, totalQuestions, streak, matchId } = data;
    
    // Calculate bonus
    let bonus = 0;
    if (correctAnswers === totalQuestions) {
        bonus += CRICKET_POINTS.triviaPerfect;
    }
    if (streak >= 5) {
        bonus += CRICKET_POINTS.triviaStreak5;
    } else if (streak >= 3) {
        bonus += CRICKET_POINTS.triviaStreak3;
    }
    
    const totalScore = score + bonus;
    
    // Update trivia leaderboard
    try {
        nk.leaderboardCreate(CRICKET_TRIVIA_LEADERBOARD, false, "desc", "best", "", null);
    } catch (e) {}
    
    try {
        nk.leaderboardRecordWrite(
            CRICKET_TRIVIA_LEADERBOARD,
            userId,
            "",
            totalScore,
            0,
            null,
            "best"
        );
    } catch (e) {
        logger.warn("[Cricket] Failed to update trivia leaderboard: " + e.message);
    }
    
    // Award coins
    const coinsEarned = Math.floor(totalScore / 10);
    try {
        nk.walletUpdate(userId, { coins: coinsEarned }, { reason: "cricket_trivia" }, true);
    } catch (e) {}
    
    // If linked to a match prediction, boost it
    if (matchId) {
        // Store trivia bonus for the match prediction
        try {
            nk.storageWrite([{
                collection: CRICKET_WC_COLLECTION,
                key: `${matchId}_trivia_bonus`,
                userId: userId,
                value: { bonus: bonus, score: totalScore },
                permissionRead: 1,
                permissionWrite: 0,
            }]);
        } catch (e) {}
    }
    
    return JSON.stringify({
        success: true,
        score: totalScore,
        bonus: bonus,
        coinsEarned: coinsEarned,
    });
}

// ============================================================================
// RPC: Get Upcoming Matches
// ============================================================================
function rpcCricketGetUpcomingMatches(ctx, logger, nk, payload) {
    let limit = 10;
    if (payload) {
        try {
            const data = JSON.parse(payload);
            limit = data.limit || 10;
        } catch (e) {}
    }
    
    // In production, fetch from match schedule storage
    // For now, return a structure
    return JSON.stringify({
        success: true,
        matches: [],
        message: "Load matches from StreamingAssets/WorldCup2026/schedule.json on client",
    });
}

// ============================================================================
// RPC: Get Match Schedule
// ============================================================================
function rpcCricketGetSchedule(ctx, logger, nk, payload) {
    let stage = null;
    let group = null;
    
    if (payload) {
        try {
            const data = JSON.parse(payload);
            stage = data.stage;
            group = data.group;
        } catch (e) {}
    }
    
    return JSON.stringify({
        success: true,
        message: "Schedule is loaded client-side from StreamingAssets",
        filters: { stage, group },
    });
}

// ============================================================================
// RPC: Claim Daily Reward (World Cup Special)
// ============================================================================
function rpcCricketClaimDailyReward(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    const today = new Date().toISOString().split('T')[0];
    const key = `daily_reward_${today}`;
    
    // Check if already claimed
    try {
        const existing = nk.storageRead([{
            collection: CRICKET_WC_COLLECTION,
            key: key,
            userId: userId
        }]);
        
        if (existing && existing.length > 0) {
            return JSON.stringify({
                success: false,
                error: "Already claimed today",
                nextClaimIn: getTimeUntilMidnight(),
            });
        }
    } catch (e) {}
    
    // Get streak
    let streak = 1;
    try {
        const streakData = nk.storageRead([{
            collection: CRICKET_WC_COLLECTION,
            key: "daily_streak",
            userId: userId
        }]);
        
        if (streakData && streakData.length > 0) {
            const lastClaim = streakData[0].value.lastClaim;
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            
            if (lastClaim === yesterdayStr) {
                streak = (streakData[0].value.streak || 0) + 1;
            }
        }
    } catch (e) {}
    
    // Calculate reward
    let coins = CRICKET_POINTS.dailyLogin;
    if (streak >= 7) coins += CRICKET_POINTS.streakDay7;
    else if (streak >= 3) coins += CRICKET_POINTS.streakDay3;
    
    // Award coins
    try {
        nk.walletUpdate(userId, { coins: coins }, { reason: "wc_daily_reward" }, true);
    } catch (e) {
        return JSON.stringify({ success: false, error: "Failed to award coins" });
    }
    
    // Save claim record
    try {
        nk.storageWrite([
            {
                collection: CRICKET_WC_COLLECTION,
                key: key,
                userId: userId,
                value: { claimed: true, coins: coins, streak: streak },
                permissionRead: 1,
                permissionWrite: 0,
            },
            {
                collection: CRICKET_WC_COLLECTION,
                key: "daily_streak",
                userId: userId,
                value: { lastClaim: today, streak: streak },
                permissionRead: 1,
                permissionWrite: 1,
            }
        ]);
    } catch (e) {}
    
    return JSON.stringify({
        success: true,
        coinsEarned: coins,
        streak: streak,
        message: streak >= 7 ? "🔥 WEEK STREAK BONUS!" : `Day ${streak} - Keep it up!`,
    });
}

// Helper function
function getTimeUntilMidnight() {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    return Math.floor((midnight - now) / 1000);
}

// ============================================================================
// Initialize Cricket World Cup Module
// ============================================================================
function initCricketWorldCupModule(ctx, logger, nk, initializer) {
    logger.info('[CricketWorldCup] Initializing ICC T20 World Cup 2026 Module...');
    
    // Register RPCs
    initializer.registerRpc('cricket_submit_prediction', rpcCricketSubmitPrediction);
    logger.info('[CricketWorldCup] Registered: cricket_submit_prediction');
    
    initializer.registerRpc('cricket_get_predictions', rpcCricketGetPredictions);
    logger.info('[CricketWorldCup] Registered: cricket_get_predictions');
    
    initializer.registerRpc('cricket_get_leaderboard', rpcCricketGetLeaderboard);
    logger.info('[CricketWorldCup] Registered: cricket_get_leaderboard');
    
    initializer.registerRpc('cricket_get_user_stats', rpcCricketGetUserStats);
    logger.info('[CricketWorldCup] Registered: cricket_get_user_stats');
    
    initializer.registerRpc('cricket_process_result', rpcCricketProcessMatchResult);
    logger.info('[CricketWorldCup] Registered: cricket_process_result (admin)');
    
    initializer.registerRpc('cricket_get_community_stats', rpcCricketGetCommunityStats);
    logger.info('[CricketWorldCup] Registered: cricket_get_community_stats');
    
    initializer.registerRpc('cricket_submit_trivia', rpcCricketSubmitTriviaScore);
    logger.info('[CricketWorldCup] Registered: cricket_submit_trivia');
    
    initializer.registerRpc('cricket_get_upcoming_matches', rpcCricketGetUpcomingMatches);
    logger.info('[CricketWorldCup] Registered: cricket_get_upcoming_matches');
    
    initializer.registerRpc('cricket_get_schedule', rpcCricketGetSchedule);
    logger.info('[CricketWorldCup] Registered: cricket_get_schedule');
    
    initializer.registerRpc('cricket_claim_daily_reward', rpcCricketClaimDailyReward);
    logger.info('[CricketWorldCup] Registered: cricket_claim_daily_reward');
    
    logger.info('[CricketWorldCup] Successfully registered 10 Cricket World Cup 2026 RPCs');
}

// Export for manual inclusion in main index.js
// Add this to the InitModule function in main index.js:
// initCricketWorldCupModule(ctx, logger, nk, initializer);

