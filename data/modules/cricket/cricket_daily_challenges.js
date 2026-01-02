/**
 * Cricket Daily Challenges Module
 * 
 * Manages daily challenges, missions, and rewards:
 * - Daily challenge generation
 * - Progress tracking
 * - Reward distribution
 * - Streak bonuses
 * 
 * Game ID: 78244246-1e9e-4e0f-a8a2-7447d5b0284e
 */

const CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// Collections
const COLLECTIONS = {
    DAILY_CHALLENGES: "cricket_daily_challenges",
    CHALLENGE_PROGRESS: "cricket_challenge_progress",
    CHALLENGE_HISTORY: "cricket_challenge_history"
};

// Challenge types
const CHALLENGE_TYPES = {
    TRIVIA_SCORE: "trivia_score",
    TRIVIA_ACCURACY: "trivia_accuracy",
    PREDICTIONS_MADE: "predictions_made",
    MATCHES_VIEWED: "matches_viewed",
    STREAK_DAYS: "streak_days",
    CORRECT_PREDICTIONS: "correct_predictions",
    PLAY_TIME: "play_time",
    SHARE_MATCHES: "share_matches"
};

// Challenge templates
const CHALLENGE_TEMPLATES = [
    {
        type: CHALLENGE_TYPES.TRIVIA_SCORE,
        title: "Trivia Master",
        description: "Score {target} points in trivia today",
        targets: [500, 750, 1000],
        rewards: [50, 100, 200],
        xp: [25, 50, 100]
    },
    {
        type: CHALLENGE_TYPES.TRIVIA_ACCURACY,
        title: "Accuracy Challenge",
        description: "Achieve {target}% accuracy in trivia",
        targets: [70, 80, 90],
        rewards: [30, 75, 150],
        xp: [15, 35, 75]
    },
    {
        type: CHALLENGE_TYPES.PREDICTIONS_MADE,
        title: "Prediction Pro",
        description: "Make {target} match prediction(s) today",
        targets: [1, 2, 3],
        rewards: [25, 50, 100],
        xp: [10, 25, 50]
    },
    {
        type: CHALLENGE_TYPES.MATCHES_VIEWED,
        title: "Match Explorer",
        description: "View {target} upcoming match(es)",
        targets: [3, 5, 10],
        rewards: [20, 40, 80],
        xp: [10, 20, 40]
    },
    {
        type: CHALLENGE_TYPES.STREAK_DAYS,
        title: "Streak Keeper",
        description: "Maintain a {target}-day login streak",
        targets: [3, 7, 14],
        rewards: [100, 300, 500],
        xp: [50, 150, 250]
    },
    {
        type: CHALLENGE_TYPES.SHARE_MATCHES,
        title: "Cricket Ambassador",
        description: "Share {target} match(es) with friends",
        targets: [1, 2, 3],
        rewards: [50, 100, 150],
        xp: [25, 50, 75]
    }
];

/**
 * RPC: Get today's challenges
 */
function rpcGetDailyChallenges(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    const today = getTodayKey();

    // Get or generate daily challenges
    let challenges = nk.storageRead([{
        collection: COLLECTIONS.DAILY_CHALLENGES,
        key: today,
        userId: null
    }]);

    if (challenges.length === 0) {
        // Generate new daily challenges
        const newChallenges = generateDailyChallenges();
        nk.storageWrite([{
            collection: COLLECTIONS.DAILY_CHALLENGES,
            key: today,
            userId: null,
            value: { challenges: newChallenges, generatedAt: Date.now() },
            permissionRead: 2,
            permissionWrite: 0
        }]);
        challenges = [{ value: { challenges: newChallenges } }];
    }

    const dailyChallenges = challenges[0].value.challenges;

    // Get user's progress
    const progress = nk.storageRead([{
        collection: COLLECTIONS.CHALLENGE_PROGRESS,
        key: today,
        userId: userId
    }]);

    const userProgress = progress.length > 0 ? progress[0].value : {
        progress: {},
        completed: [],
        claimed: []
    };

    // Merge progress with challenges
    const result = dailyChallenges.map(challenge => ({
        ...challenge,
        currentProgress: userProgress.progress[challenge.id] || 0,
        isCompleted: userProgress.completed.includes(challenge.id),
        isClaimed: userProgress.claimed.includes(challenge.id)
    }));

    return JSON.stringify({
        date: today,
        challenges: result,
        totalCompleted: userProgress.completed.length,
        totalClaimed: userProgress.claimed.length,
        timeUntilReset: getTimeUntilReset()
    });
}

/**
 * RPC: Update challenge progress
 * 
 * Payload: {
 *   challengeType: string,
 *   value: number
 * }
 */
function rpcUpdateChallengeProgress(context, logger, nk, payload) {
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

    const { challengeType, value } = data;

    if (!challengeType || value === undefined) {
        throw new Error("challengeType and value are required");
    }

    const today = getTodayKey();

    // Get daily challenges
    const challenges = nk.storageRead([{
        collection: COLLECTIONS.DAILY_CHALLENGES,
        key: today,
        userId: null
    }]);

    if (challenges.length === 0) {
        return JSON.stringify({ success: false, message: "No challenges available today" });
    }

    const dailyChallenges = challenges[0].value.challenges;

    // Get user's progress
    const progressRecords = nk.storageRead([{
        collection: COLLECTIONS.CHALLENGE_PROGRESS,
        key: today,
        userId: userId
    }]);

    const userProgress = progressRecords.length > 0 ? progressRecords[0].value : {
        progress: {},
        completed: [],
        claimed: []
    };

    // Update progress for matching challenges
    const updatedChallenges = [];
    const newlyCompleted = [];

    for (const challenge of dailyChallenges) {
        if (challenge.type === challengeType && !userProgress.completed.includes(challenge.id)) {
            const currentProgress = userProgress.progress[challenge.id] || 0;
            const newProgress = challengeType === CHALLENGE_TYPES.TRIVIA_ACCURACY 
                ? value // Accuracy is a direct value, not cumulative
                : currentProgress + value;

            userProgress.progress[challenge.id] = newProgress;

            // Check if completed
            if (newProgress >= challenge.target) {
                if (!userProgress.completed.includes(challenge.id)) {
                    userProgress.completed.push(challenge.id);
                    newlyCompleted.push(challenge);
                }
            }

            updatedChallenges.push({
                id: challenge.id,
                title: challenge.title,
                currentProgress: Math.min(newProgress, challenge.target),
                target: challenge.target,
                isCompleted: newProgress >= challenge.target
            });
        }
    }

    // Save progress
    nk.storageWrite([{
        collection: COLLECTIONS.CHALLENGE_PROGRESS,
        key: today,
        userId: userId,
        value: userProgress,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} updated challenge progress: ${challengeType} += ${value}`);

    return JSON.stringify({
        success: true,
        updatedChallenges,
        newlyCompleted: newlyCompleted.map(c => ({
            id: c.id,
            title: c.title,
            reward: c.reward,
            xp: c.xp
        }))
    });
}

/**
 * RPC: Claim challenge reward
 * 
 * Payload: {
 *   challengeId: string
 * }
 */
function rpcClaimChallengeReward(context, logger, nk, payload) {
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

    const { challengeId } = data;

    if (!challengeId) {
        throw new Error("challengeId is required");
    }

    const today = getTodayKey();

    // Get daily challenges
    const challenges = nk.storageRead([{
        collection: COLLECTIONS.DAILY_CHALLENGES,
        key: today,
        userId: null
    }]);

    if (challenges.length === 0) {
        return JSON.stringify({ success: false, message: "No challenges available today" });
    }

    const dailyChallenges = challenges[0].value.challenges;
    const challenge = dailyChallenges.find(c => c.id === challengeId);

    if (!challenge) {
        return JSON.stringify({ success: false, message: "Challenge not found" });
    }

    // Get user's progress
    const progressRecords = nk.storageRead([{
        collection: COLLECTIONS.CHALLENGE_PROGRESS,
        key: today,
        userId: userId
    }]);

    const userProgress = progressRecords.length > 0 ? progressRecords[0].value : {
        progress: {},
        completed: [],
        claimed: []
    };

    // Check if completed
    if (!userProgress.completed.includes(challengeId)) {
        return JSON.stringify({ success: false, message: "Challenge not completed yet" });
    }

    // Check if already claimed
    if (userProgress.claimed.includes(challengeId)) {
        return JSON.stringify({ success: false, message: "Reward already claimed" });
    }

    // Award reward
    const changeset = {
        coins: challenge.reward
    };
    const metadata = {
        reason: `daily_challenge_${challengeId}`,
        timestamp: Date.now()
    };

    try {
        nk.walletUpdate(userId, changeset, metadata, true);
    } catch (e) {
        logger.error(`Failed to award coins: ${e.message}`);
    }

    // Mark as claimed
    userProgress.claimed.push(challengeId);

    // Save progress
    nk.storageWrite([{
        collection: COLLECTIONS.CHALLENGE_PROGRESS,
        key: today,
        userId: userId,
        value: userProgress,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    // Store in history
    storeChallengeHistory(nk, userId, challengeId, challenge);

    logger.info(`User ${userId} claimed challenge reward: ${challengeId} (${challenge.reward} coins)`);

    return JSON.stringify({
        success: true,
        challengeId,
        coinsEarned: challenge.reward,
        xpEarned: challenge.xp,
        totalCompleted: userProgress.completed.length,
        totalClaimed: userProgress.claimed.length
    });
}

/**
 * RPC: Get challenge history
 */
function rpcGetChallengeHistory(context, logger, nk, payload) {
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

    const { limit = 30 } = data;

    const history = nk.storageList(userId, COLLECTIONS.CHALLENGE_HISTORY, limit, null);

    const records = (history.objects || []).map(obj => obj.value);

    // Calculate stats
    const stats = {
        totalChallengesCompleted: records.length,
        totalCoinsEarned: records.reduce((sum, r) => sum + (r.reward || 0), 0),
        totalXPEarned: records.reduce((sum, r) => sum + (r.xp || 0), 0),
        streakDays: calculateStreakDays(records)
    };

    return JSON.stringify({
        history: records.slice(0, 20),
        stats
    });
}

/**
 * RPC: Get weekly summary
 */
function rpcGetWeeklySummary(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    // Get last 7 days of progress
    const summaryDays = [];
    const now = new Date();

    for (let i = 0; i < 7; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dayKey = date.toISOString().split('T')[0];

        const progress = nk.storageRead([{
            collection: COLLECTIONS.CHALLENGE_PROGRESS,
            key: dayKey,
            userId: userId
        }]);

        const dayProgress = progress.length > 0 ? progress[0].value : {
            completed: [],
            claimed: []
        };

        summaryDays.push({
            date: dayKey,
            completed: dayProgress.completed.length,
            claimed: dayProgress.claimed.length
        });
    }

    // Calculate weekly stats
    const weeklyStats = {
        totalDaysPlayed: summaryDays.filter(d => d.completed > 0).length,
        totalChallengesCompleted: summaryDays.reduce((sum, d) => sum + d.completed, 0),
        totalChallengesClaimed: summaryDays.reduce((sum, d) => sum + d.claimed, 0),
        perfectDays: summaryDays.filter(d => d.completed >= 3).length
    };

    return JSON.stringify({
        days: summaryDays,
        stats: weeklyStats
    });
}

// Helper functions
function getTodayKey() {
    return new Date().toISOString().split('T')[0];
}

function getTimeUntilReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime() - now.getTime();
}

function generateDailyChallenges() {
    const challenges = [];
    const usedTypes = new Set();

    // Generate 3 challenges of different types
    const shuffled = [...CHALLENGE_TEMPLATES].sort(() => Math.random() - 0.5);

    for (const template of shuffled) {
        if (challenges.length >= 3) break;
        if (usedTypes.has(template.type)) continue;

        // Pick a random difficulty (0=easy, 1=medium, 2=hard)
        const difficulty = Math.floor(Math.random() * 3);
        
        const challenge = {
            id: `${template.type}_${getTodayKey()}_${difficulty}`,
            type: template.type,
            title: template.title,
            description: template.description.replace('{target}', template.targets[difficulty]),
            target: template.targets[difficulty],
            reward: template.rewards[difficulty],
            xp: template.xp[difficulty],
            difficulty: ['easy', 'medium', 'hard'][difficulty]
        };

        challenges.push(challenge);
        usedTypes.add(template.type);
    }

    return challenges;
}

function storeChallengeHistory(nk, userId, challengeId, challenge) {
    const historyKey = `${challengeId}_${Date.now()}`;
    
    nk.storageWrite([{
        collection: COLLECTIONS.CHALLENGE_HISTORY,
        key: historyKey,
        userId: userId,
        value: {
            challengeId,
            title: challenge.title,
            type: challenge.type,
            target: challenge.target,
            reward: challenge.reward,
            xp: challenge.xp,
            completedAt: Date.now()
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function calculateStreakDays(records) {
    if (records.length === 0) return 0;

    const sortedDates = records
        .map(r => new Date(r.completedAt).toISOString().split('T')[0])
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort()
        .reverse();

    if (sortedDates.length === 0) return 0;

    const today = getTodayKey();
    let streak = 0;

    for (let i = 0; i < sortedDates.length; i++) {
        const expectedDate = new Date(today);
        expectedDate.setDate(expectedDate.getDate() - i);
        const expectedKey = expectedDate.toISOString().split('T')[0];

        if (sortedDates.includes(expectedKey)) {
            streak++;
        } else {
            break;
        }
    }

    return streak;
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Cricket Daily Challenges Module loaded");

    initializer.registerRpc("cricket_get_daily_challenges", rpcGetDailyChallenges);
    initializer.registerRpc("cricket_update_challenge_progress", rpcUpdateChallengeProgress);
    initializer.registerRpc("cricket_claim_challenge_reward", rpcClaimChallengeReward);
    initializer.registerRpc("cricket_get_challenge_history", rpcGetChallengeHistory);
    initializer.registerRpc("cricket_get_weekly_summary", rpcGetWeeklySummary);

    logger.info("Cricket Daily Challenges Module initialized successfully");
}

!InitModule.toString().includes("InitModule") || InitModule;

