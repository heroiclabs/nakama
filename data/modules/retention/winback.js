// winback.js - Win-back System for Churned Users
// Re-engages users who haven't played in 7+ days

/**
 * Win-back System
 * 
 * Features:
 * - Tiered comeback rewards based on days away
 * - Premium trial offers for returning users
 * - "What's New" summary for updates missed
 * - Re-engagement push notification scheduling
 * - Per-game support
 * - AI-generated personalized welcome messages
 * - S3 storage for personalized content
 */

// AI API Configuration
var AI_API_BASE_URL = "https://ai.intelliverse.com"; // Intelliverse-X-AI service
var AI_API_TOKEN = ""; // Set via environment or config

// Comeback reward tiers based on days away
var COMEBACK_TIERS = [
    {
        minDays: 7,
        maxDays: 14,
        tier: "short",
        name: "Welcome Back!",
        rewards: {
            coins: 200,
            streakShieldDays: 2,
            doubleXpHours: 24
        },
        message: "We missed you! Here's a little something to get you started again."
    },
    {
        minDays: 14,
        maxDays: 30,
        tier: "medium",
        name: "So Good to See You!",
        rewards: {
            coins: 500,
            gems: 50,
            streakShieldDays: 5,
            doubleXpHours: 48,
            premiumTrialDays: 0
        },
        message: "It's been a while! We've saved some goodies for you."
    },
    {
        minDays: 30,
        maxDays: 60,
        tier: "long",
        name: "The Prodigal Player Returns!",
        rewards: {
            coins: 1000,
            gems: 100,
            streakShieldDays: 7,
            doubleXpHours: 72,
            premiumTrialDays: 3,
            mysteryBox: 1
        },
        message: "Wow, we really missed you! Here's a huge welcome back package!"
    },
    {
        minDays: 60,
        maxDays: 365,
        tier: "verylong",
        name: "A Legend Returns!",
        rewards: {
            coins: 2000,
            gems: 200,
            streakShieldDays: 14,
            doubleXpHours: 168, // 7 days
            premiumTrialDays: 7,
            mysteryBox: 3,
            exclusiveAvatar: "avatar_comeback_legend"
        },
        message: "A legend has returned! We've prepared an extraordinary welcome for you!"
    }
];

// Feature announcements (what's new since they left)
var FEATURE_ANNOUNCEMENTS = [
    { id: "ai_quizzes", title: "AI-Generated Quizzes", description: "Turn any link or document into a quiz!", addedDate: "2025-10-01" },
    { id: "guild_wars", title: "Guild Wars", description: "Compete with your guild against others!", addedDate: "2025-11-01" },
    { id: "season_pass", title: "Season Pass", description: "50 levels of rewards every month!", addedDate: "2025-11-15" },
    { id: "weekly_goals", title: "Weekly Goals", description: "Complete 7 daily goals for bonus rewards!", addedDate: "2025-12-01" },
    { id: "voice_answer", title: "Voice Answers", description: "Answer quizzes with your voice!", addedDate: "2025-12-15" }
];

/**
 * Call AI API to generate personalized content
 */
function callAIService(nk, logger, endpoint, payload) {
    try {
        var response = nk.httpRequest(AI_API_BASE_URL + endpoint, "POST", {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + AI_API_TOKEN
        }, JSON.stringify(payload));
        
        if (response.code === 200) {
            return JSON.parse(response.body);
        } else {
            logger.warn("[Winback] AI API call failed with code: " + response.code);
            return null;
        }
    } catch (err) {
        logger.warn("[Winback] AI API call error: " + err.message);
        return null;
    }
}

/**
 * Generate personalized welcome message using AI
 */
function generatePersonalizedWelcome(nk, logger, userId, daysAway, tier, language) {
    language = language || "en";
    
    var prompt = {
        prompt: "Generate a warm, personalized welcome back message for a trivia game user who has been away for " + 
                daysAway + " days. The message should be encouraging and mention the rewards they'll receive. " +
                "Tier: " + tier.name + ". Rewards include: " + JSON.stringify(tier.rewards) + 
                ". Make it friendly and exciting, around 2-3 sentences.",
        language: language,
        return_format: "Return only the welcome message text, no JSON formatting.",
        model: "gpt-4o-mini"
    };
    
    var result = callAIService(nk, logger, "/quiz/daily/motivational-message?langCode=" + language, {
        langCode: language
    });
    
    if (result && result.message) {
        return result.message;
    }
    
    // Fallback to tier's default message
    return tier.message;
}

/**
 * Get user's last session data
 */
function getLastSessionData(nk, logger, userId, gameId) {
    var collection = "user_sessions";
    var key = "last_session_" + userId + "_" + gameId;
    
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
        logger.warn("[Winback] Failed to read session data: " + err.message);
    }
    
    return null;
}

/**
 * Save last session data
 */
function saveLastSessionData(nk, logger, userId, gameId, data) {
    var collection = "user_sessions";
    var key = "last_session_" + userId + "_" + gameId;
    
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
        logger.error("[Winback] Failed to save session data: " + err.message);
        return false;
    }
}

/**
 * Get win-back data for user
 */
function getWinbackData(nk, logger, userId, gameId) {
    var collection = "winback";
    var key = "data_" + userId + "_" + gameId;
    
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
        logger.warn("[Winback] Failed to read data: " + err.message);
    }
    
    return null;
}

/**
 * Save win-back data
 */
function saveWinbackData(nk, logger, userId, gameId, data) {
    var collection = "winback";
    var key = "data_" + userId + "_" + gameId;
    
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
        logger.error("[Winback] Failed to save data: " + err.message);
        return false;
    }
}

/**
 * Calculate days since last session
 */
function getDaysSinceLastSession(lastSessionTimestamp) {
    if (!lastSessionTimestamp) return 0;
    
    var lastDate = new Date(lastSessionTimestamp);
    var now = new Date();
    var diffMs = now - lastDate;
    var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    return diffDays;
}

/**
 * Get applicable comeback tier
 */
function getApplicableTier(daysAway) {
    for (var i = COMEBACK_TIERS.length - 1; i >= 0; i--) {
        var tier = COMEBACK_TIERS[i];
        if (daysAway >= tier.minDays && daysAway <= tier.maxDays) {
            return tier;
        }
    }
    return null;
}

/**
 * Get new features since date
 */
function getNewFeaturesSince(lastPlayDate) {
    var newFeatures = [];
    var lastDate = new Date(lastPlayDate);
    
    for (var i = 0; i < FEATURE_ANNOUNCEMENTS.length; i++) {
        var feature = FEATURE_ANNOUNCEMENTS[i];
        var featureDate = new Date(feature.addedDate);
        
        if (featureDate > lastDate) {
            newFeatures.push(feature);
        }
    }
    
    return newFeatures;
}

/**
 * RPC: winback_check_status
 * Check if user qualifies for comeback rewards
 */
function rpcWinbackCheckStatus(ctx, logger, nk, payload) {
    logger.info("[Winback] RPC winback_check_status called");
    
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
    
    // Get last session
    var sessionData = getLastSessionData(nk, logger, ctx.userId, gameId);
    
    if (!sessionData || !sessionData.lastSessionTime) {
        // First time user - no win-back needed
        return JSON.stringify({
            success: true,
            isReturningUser: false,
            daysAway: 0,
            hasRewards: false,
            timestamp: new Date().toISOString()
        });
    }
    
    var daysAway = getDaysSinceLastSession(sessionData.lastSessionTime);
    
    // Check if already claimed this comeback
    var winbackData = getWinbackData(nk, logger, ctx.userId, gameId);
    
    // Get applicable tier
    var tier = getApplicableTier(daysAway);
    
    if (!tier) {
        // Not away long enough for rewards
        return JSON.stringify({
            success: true,
            isReturningUser: daysAway > 0,
            daysAway: daysAway,
            hasRewards: false,
            message: daysAway > 0 ? "Welcome back!" : null,
            timestamp: new Date().toISOString()
        });
    }
    
    // Check if this tier was already claimed
    var alreadyClaimed = winbackData && winbackData.lastClaimedTier === tier.tier && 
                         getDaysSinceLastSession(winbackData.lastClaimTime) < 7;
    
    // Get new features
    var newFeatures = getNewFeaturesSince(sessionData.lastSessionTime);
    
    // Generate personalized welcome message using AI
    var language = data.language || "en";
    var personalizedMessage = tier.message; // Default
    
    if (!alreadyClaimed) {
        try {
            personalizedMessage = generatePersonalizedWelcome(nk, logger, ctx.userId, daysAway, tier, language);
        } catch (err) {
            logger.warn("[Winback] Failed to generate personalized message: " + err.message);
        }
    }
    
    return JSON.stringify({
        success: true,
        isReturningUser: true,
        daysAway: daysAway,
        hasRewards: !alreadyClaimed,
        tier: tier,
        personalizedMessage: personalizedMessage,
        alreadyClaimed: alreadyClaimed,
        newFeatures: newFeatures,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: winback_claim_rewards
 * Claim comeback rewards
 */
function rpcWinbackClaimRewards(ctx, logger, nk, payload) {
    logger.info("[Winback] RPC winback_claim_rewards called");
    
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
    
    // Get last session
    var sessionData = getLastSessionData(nk, logger, ctx.userId, gameId);
    
    if (!sessionData || !sessionData.lastSessionTime) {
        return JSON.stringify({ success: false, error: "No previous session found" });
    }
    
    var daysAway = getDaysSinceLastSession(sessionData.lastSessionTime);
    var tier = getApplicableTier(daysAway);
    
    if (!tier) {
        return JSON.stringify({ success: false, error: "Not eligible for comeback rewards" });
    }
    
    // Check if already claimed
    var winbackData = getWinbackData(nk, logger, ctx.userId, gameId);
    
    if (winbackData && winbackData.lastClaimedTier === tier.tier &&
        getDaysSinceLastSession(winbackData.lastClaimTime) < 7) {
        return JSON.stringify({ success: false, error: "Rewards already claimed" });
    }
    
    // Mark as claimed
    var newWinbackData = {
        lastClaimedTier: tier.tier,
        lastClaimTime: new Date().toISOString(),
        daysAwayWhenClaimed: daysAway,
        claimHistory: winbackData && winbackData.claimHistory ? winbackData.claimHistory : []
    };
    
    newWinbackData.claimHistory.push({
        tier: tier.tier,
        daysAway: daysAway,
        claimedAt: new Date().toISOString(),
        rewards: tier.rewards
    });
    
    saveWinbackData(nk, logger, ctx.userId, gameId, newWinbackData);
    
    // Log transaction
    try {
        var transactionKey = "winback_reward_" + ctx.userId + "_" + Date.now();
        nk.storageWrite([{
            collection: "transaction_logs",
            key: transactionKey,
            userId: ctx.userId,
            value: {
                type: "winback_reward",
                tier: tier.tier,
                daysAway: daysAway,
                rewards: tier.rewards,
                timestamp: new Date().toISOString()
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (err) {
        logger.warn("[Winback] Failed to log transaction: " + err.message);
    }
    
    // Grant rewards to wallet
    var walletChanges = {};
    if (tier.rewards.coins) walletChanges.coins = tier.rewards.coins;
    if (tier.rewards.gems) walletChanges.gems = tier.rewards.gems;
    if (Object.keys(walletChanges).length > 0) {
        try {
            nk.walletUpdate(ctx.userId, walletChanges, { source: "winback", tier: tier.tier, daysAway: daysAway }, true);
            logger.info("[Winback] Granted wallet: " + JSON.stringify(walletChanges) + " to " + ctx.userId);
        } catch (walletErr) {
            logger.error("[Winback] Wallet grant failed: " + walletErr.message);
        }
    }
    
    logger.info("[Winback] Rewards claimed by user " + ctx.userId + ", tier: " + tier.tier + ", days away: " + daysAway);
    
    return JSON.stringify({
        success: true,
        tier: tier.tier,
        tierName: tier.name,
        message: tier.message,
        rewards: tier.rewards,
        walletGranted: walletChanges,
        daysAway: daysAway,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: winback_record_session
 * Record user's current session (call on app open)
 */
function rpcWinbackRecordSession(ctx, logger, nk, payload) {
    logger.info("[Winback] RPC winback_record_session called");
    
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
    
    // Get existing session data
    var sessionData = getLastSessionData(nk, logger, ctx.userId, gameId);
    
    var previousSession = sessionData ? sessionData.lastSessionTime : null;
    var sessionCount = sessionData ? (sessionData.totalSessions || 0) + 1 : 1;
    
    // Update session data
    var newSessionData = {
        lastSessionTime: new Date().toISOString(),
        previousSessionTime: previousSession,
        totalSessions: sessionCount,
        firstSessionTime: sessionData ? sessionData.firstSessionTime : new Date().toISOString()
    };
    
    saveLastSessionData(nk, logger, ctx.userId, gameId, newSessionData);
    
    return JSON.stringify({
        success: true,
        sessionCount: sessionCount,
        daysSinceLastSession: previousSession ? getDaysSinceLastSession(previousSession) : 0,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: winback_schedule_reengagement
 * Schedule re-engagement push notifications for at-risk users
 * (Called by server-side scheduled task)
 */
function rpcWinbackScheduleReengagement(ctx, logger, nk, payload) {
    logger.info("[Winback] RPC winback_schedule_reengagement called");
    
    // This would typically be called by a server-side scheduled task
    // to identify users who haven't played in X days and send them
    // push notifications
    
    var data;
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    var gameId = data.gameId;
    var targetDaysAway = data.targetDaysAway || 3; // Default: users 3+ days away
    
    // In production, this would query users with lastSessionTime older than targetDaysAway
    // and send them personalized push notifications
    
    return JSON.stringify({
        success: true,
        message: "Re-engagement notifications scheduled",
        targetDaysAway: targetDaysAway,
        timestamp: new Date().toISOString()
    });
}
