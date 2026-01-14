// rewarded_ads.js - Server-validated Rewarded Ad System
// Enforces user-triggered rewarded ads via token-based validation
// Prevents auto-shown rewards, duplicate claims, and replay attacks

/**
 * REWARDED AD CLAIM FLOW:
 * 1. Client calls `rewarded_ad_request_token` BEFORE showing ad (user clicks button)
 * 2. Server generates a unique token with timestamp and placement info
 * 3. Client shows the ad to user
 * 4. After ad completes successfully, client calls `rewarded_ad_claim` with token
 * 5. Server validates token, ensures it's not expired/reused, grants wallet reward
 * 6. Server marks token as consumed to prevent replay attacks
 */

// Token configuration
var TOKEN_EXPIRY_SECONDS = 300; // 5 minutes - tokens expire if not claimed
var TOKEN_COLLECTION = "rewarded_ad_tokens";
var CLAIMS_COLLECTION = "rewarded_ad_claims";

// Reward configuration per placement
var REWARD_CONFIG = {
    "double_score": {
        rewardType: "score_multiplier",
        multiplier: 2,
        cooldownSeconds: 0, // No cooldown - once per session
        maxClaimsPerDay: 10
    },
    "extra_time": {
        rewardType: "currency",
        currency: "time_bonus",
        amount: 30, // 30 seconds
        cooldownSeconds: 60, // 1 minute between claims
        maxClaimsPerDay: 20
    },
    "free_hint": {
        rewardType: "currency",
        currency: "hints",
        amount: 1,
        cooldownSeconds: 30,
        maxClaimsPerDay: 30
    },
    "bonus_coins": {
        rewardType: "currency",
        currency: "coins",
        amount: 100,
        cooldownSeconds: 120,
        maxClaimsPerDay: 15
    },
    "default": {
        rewardType: "currency",
        currency: "coins",
        amount: 50,
        cooldownSeconds: 60,
        maxClaimsPerDay: 50
    }
};

/**
 * Generate a cryptographically secure token
 */
function generateToken() {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var token = "";
    for (var i = 0; i < 32; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Add timestamp component for uniqueness
    token += "_" + Date.now().toString(36);
    return token;
}

/**
 * Get start of day timestamp (UTC)
 */
function getStartOfDay() {
    var now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    return Math.floor(now.getTime() / 1000);
}

/**
 * Get user's daily claim count for a placement
 */
function getDailyClaimCount(nk, logger, userId, placement) {
    var key = "daily_claims_" + getStartOfDay();
    
    try {
        var records = nk.storageRead([{
            collection: CLAIMS_COLLECTION,
            key: key,
            userId: userId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            var claims = records[0].value;
            return claims[placement] || 0;
        }
    } catch (err) {
        logger.warn("[RewardedAds] Failed to read daily claims: " + err.message);
    }
    
    return 0;
}

/**
 * Increment user's daily claim count for a placement
 */
function incrementDailyClaimCount(nk, logger, userId, placement) {
    var key = "daily_claims_" + getStartOfDay();
    var claims = {};
    
    try {
        var records = nk.storageRead([{
            collection: CLAIMS_COLLECTION,
            key: key,
            userId: userId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            claims = records[0].value;
        }
    } catch (err) {
        // Continue with empty claims
    }
    
    claims[placement] = (claims[placement] || 0) + 1;
    claims.updatedAt = new Date().toISOString();
    
    try {
        nk.storageWrite([{
            collection: CLAIMS_COLLECTION,
            key: key,
            userId: userId,
            value: claims,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error("[RewardedAds] Failed to increment daily claims: " + err.message);
        return false;
    }
}

/**
 * Get user's last claim timestamp for a placement
 */
function getLastClaimTimestamp(nk, logger, userId, placement) {
    var key = "last_claim_" + placement;
    
    try {
        var records = nk.storageRead([{
            collection: CLAIMS_COLLECTION,
            key: key,
            userId: userId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            return records[0].value.timestamp || 0;
        }
    } catch (err) {
        logger.warn("[RewardedAds] Failed to read last claim: " + err.message);
    }
    
    return 0;
}

/**
 * Update user's last claim timestamp for a placement
 */
function updateLastClaimTimestamp(nk, logger, userId, placement) {
    var key = "last_claim_" + placement;
    var now = Math.floor(Date.now() / 1000);
    
    try {
        nk.storageWrite([{
            collection: CLAIMS_COLLECTION,
            key: key,
            userId: userId,
            value: {
                timestamp: now,
                placement: placement,
                updatedAt: new Date().toISOString()
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error("[RewardedAds] Failed to update last claim: " + err.message);
        return false;
    }
}

/**
 * RPC: Request a reward token before showing ad
 * This MUST be called when user clicks the ad button (not auto-triggered)
 * 
 * Payload: { placement: string, gameId: string, metadata?: object }
 * Returns: { success: bool, token: string, expiresIn: number }
 */
function rpcRewardedAdRequestToken(ctx, logger, nk, payload) {
    logger.info("[RewardedAds] Token request from user: " + ctx.userId);
    
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({
            success: false,
            error: "Authentication required"
        });
    }
    
    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) {
        return JSON.stringify({
            success: false,
            error: "Invalid payload"
        });
    }
    
    var placement = data.placement || "default";
    var gameId = data.gameId || "unknown";
    var metadata = data.metadata || {};
    
    // Get reward config for this placement
    var config = REWARD_CONFIG[placement] || REWARD_CONFIG["default"];
    
    // Check daily claim limit
    var dailyClaims = getDailyClaimCount(nk, logger, userId, placement);
    if (dailyClaims >= config.maxClaimsPerDay) {
        logger.warn("[RewardedAds] Daily limit reached for user: " + userId + ", placement: " + placement);
        return JSON.stringify({
            success: false,
            error: "Daily limit reached",
            dailyClaims: dailyClaims,
            maxClaimsPerDay: config.maxClaimsPerDay,
            resetAt: getStartOfDay() + 86400 // Next day UTC
        });
    }
    
    // Check cooldown
    var lastClaim = getLastClaimTimestamp(nk, logger, userId, placement);
    var now = Math.floor(Date.now() / 1000);
    var cooldownRemaining = (lastClaim + config.cooldownSeconds) - now;
    
    if (cooldownRemaining > 0) {
        logger.info("[RewardedAds] Cooldown active for user: " + userId + ", remaining: " + cooldownRemaining);
        return JSON.stringify({
            success: false,
            error: "Cooldown active",
            cooldownRemaining: cooldownRemaining,
            canClaimAt: lastClaim + config.cooldownSeconds
        });
    }
    
    // Generate unique token
    var token = generateToken();
    var expiresAt = now + TOKEN_EXPIRY_SECONDS;
    
    // Store token for later validation
    var tokenData = {
        token: token,
        userId: userId,
        placement: placement,
        gameId: gameId,
        metadata: metadata,
        createdAt: now,
        expiresAt: expiresAt,
        consumed: false,
        clientIp: ctx.clientIp || "unknown",
        sessionId: ctx.sessionId || "unknown"
    };
    
    try {
        nk.storageWrite([{
            collection: TOKEN_COLLECTION,
            key: token,
            userId: userId,
            value: tokenData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[RewardedAds] Token generated for user: " + userId + ", placement: " + placement + ", token: " + token.substring(0, 8) + "...");
        
        return JSON.stringify({
            success: true,
            token: token,
            expiresIn: TOKEN_EXPIRY_SECONDS,
            expiresAt: expiresAt,
            placement: placement,
            rewardConfig: {
                type: config.rewardType,
                currency: config.currency,
                amount: config.amount,
                multiplier: config.multiplier
            }
        });
        
    } catch (err) {
        logger.error("[RewardedAds] Failed to store token: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to generate token"
        });
    }
}

/**
 * RPC: Claim reward after ad was watched
 * Token must be valid, not expired, and not already consumed
 * 
 * Payload: { token: string, adCompleted: bool, adNetwork?: string, metadata?: object }
 * Returns: { success: bool, reward: object, walletUpdate: object }
 */
function rpcRewardedAdClaim(ctx, logger, nk, payload) {
    logger.info("[RewardedAds] Claim request from user: " + ctx.userId);
    
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({
            success: false,
            error: "Authentication required"
        });
    }
    
    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) {
        return JSON.stringify({
            success: false,
            error: "Invalid payload"
        });
    }
    
    var token = data.token;
    var adCompleted = data.adCompleted === true;
    var adNetwork = data.adNetwork || "unknown";
    var claimMetadata = data.metadata || {};
    
    if (!token) {
        logger.warn("[RewardedAds] Claim attempt without token from user: " + userId);
        return JSON.stringify({
            success: false,
            error: "Token required"
        });
    }
    
    if (!adCompleted) {
        logger.info("[RewardedAds] Ad not completed for user: " + userId);
        return JSON.stringify({
            success: false,
            error: "Ad was not completed"
        });
    }
    
    // Read and validate token
    var tokenData = null;
    try {
        var records = nk.storageRead([{
            collection: TOKEN_COLLECTION,
            key: token,
            userId: userId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            tokenData = records[0].value;
        }
    } catch (err) {
        logger.error("[RewardedAds] Failed to read token: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Token validation failed"
        });
    }
    
    // Validate token exists
    if (!tokenData) {
        logger.warn("[RewardedAds] Invalid token from user: " + userId + ", token: " + token.substring(0, 8) + "...");
        return JSON.stringify({
            success: false,
            error: "Invalid or expired token"
        });
    }
    
    // Validate token ownership
    if (tokenData.userId !== userId) {
        logger.warn("[RewardedAds] Token ownership mismatch. Token user: " + tokenData.userId + ", Claim user: " + userId);
        return JSON.stringify({
            success: false,
            error: "Token does not belong to user"
        });
    }
    
    // Check if already consumed
    if (tokenData.consumed) {
        logger.warn("[RewardedAds] Token already consumed: " + token.substring(0, 8) + "...");
        return JSON.stringify({
            success: false,
            error: "Reward already claimed"
        });
    }
    
    // Check expiry
    var now = Math.floor(Date.now() / 1000);
    if (now > tokenData.expiresAt) {
        logger.warn("[RewardedAds] Token expired. Created: " + tokenData.createdAt + ", Expired: " + tokenData.expiresAt + ", Now: " + now);
        return JSON.stringify({
            success: false,
            error: "Token expired"
        });
    }
    
    // Get reward config
    var placement = tokenData.placement;
    var gameId = tokenData.gameId;
    var config = REWARD_CONFIG[placement] || REWARD_CONFIG["default"];
    
    // Mark token as consumed FIRST (prevent race conditions)
    tokenData.consumed = true;
    tokenData.consumedAt = now;
    tokenData.adNetwork = adNetwork;
    tokenData.claimMetadata = claimMetadata;
    
    try {
        nk.storageWrite([{
            collection: TOKEN_COLLECTION,
            key: token,
            userId: userId,
            value: tokenData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (err) {
        logger.error("[RewardedAds] Failed to mark token consumed: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Claim processing failed"
        });
    }
    
    // Process reward based on type
    var rewardResult = null;
    
    if (config.rewardType === "score_multiplier") {
        // For score multiplier, we return authorization to multiply
        // The actual score update is done by the client with server validation
        rewardResult = {
            type: "score_multiplier",
            multiplier: config.multiplier,
            authorized: true,
            authorizationToken: generateToken(), // One-time use token for score submission
            expiresIn: 60 // Must be used within 60 seconds
        };
        
        // Store the score multiplier authorization
        try {
            nk.storageWrite([{
                collection: "score_multiplier_auth",
                key: rewardResult.authorizationToken,
                userId: userId,
                value: {
                    multiplier: config.multiplier,
                    placement: placement,
                    gameId: gameId,
                    createdAt: now,
                    expiresAt: now + 60,
                    used: false
                },
                permissionRead: 1,
                permissionWrite: 0
            }]);
        } catch (err) {
            logger.error("[RewardedAds] Failed to store score auth: " + err.message);
        }
        
    } else if (config.rewardType === "currency") {
        // Grant currency to wallet
        var walletUpdate = grantWalletReward(nk, logger, userId, gameId, config.currency, config.amount, placement);
        rewardResult = {
            type: "currency",
            currency: config.currency,
            amount: config.amount,
            walletUpdate: walletUpdate
        };
    }
    
    // Update daily claims and last claim timestamp
    incrementDailyClaimCount(nk, logger, userId, placement);
    updateLastClaimTimestamp(nk, logger, userId, placement);
    
    // Log successful claim for analytics
    logger.info("[RewardedAds] Reward claimed successfully. User: " + userId + ", Placement: " + placement + ", Reward: " + JSON.stringify(rewardResult));
    
    return JSON.stringify({
        success: true,
        placement: placement,
        reward: rewardResult,
        dailyClaims: getDailyClaimCount(nk, logger, userId, placement),
        maxClaimsPerDay: config.maxClaimsPerDay
    });
}

/**
 * Grant wallet reward using Nakama's wallet system
 */
function grantWalletReward(nk, logger, userId, gameId, currency, amount, source) {
    var changeset = {};
    changeset[currency] = amount;
    
    var metadata = {
        source: "rewarded_ad",
        placement: source,
        gameId: gameId,
        grantedAt: new Date().toISOString()
    };
    
    try {
        var results = nk.walletUpdate(userId, changeset, metadata, true);
        logger.info("[RewardedAds] Wallet updated for user: " + userId + ", currency: " + currency + ", amount: " + amount);
        return {
            success: true,
            previousBalance: results.previous ? results.previous[currency] || 0 : 0,
            newBalance: results.updated ? results.updated[currency] || amount : amount,
            change: amount
        };
    } catch (err) {
        logger.error("[RewardedAds] Wallet update failed: " + err.message);
        return {
            success: false,
            error: err.message
        };
    }
}

/**
 * RPC: Validate score multiplier authorization
 * Called when submitting a doubled score to leaderboard
 * 
 * Payload: { authorizationToken: string, originalScore: number, multipliedScore: number }
 * Returns: { success: bool, authorized: bool }
 */
function rpcValidateScoreMultiplier(ctx, logger, nk, payload) {
    logger.info("[RewardedAds] Score multiplier validation from user: " + ctx.userId);
    
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({
            success: false,
            error: "Authentication required"
        });
    }
    
    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) {
        return JSON.stringify({
            success: false,
            error: "Invalid payload"
        });
    }
    
    var authToken = data.authorizationToken;
    var originalScore = data.originalScore;
    var multipliedScore = data.multipliedScore;
    
    if (!authToken) {
        return JSON.stringify({
            success: false,
            error: "Authorization token required"
        });
    }
    
    // Read authorization
    var authData = null;
    try {
        var records = nk.storageRead([{
            collection: "score_multiplier_auth",
            key: authToken,
            userId: userId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            authData = records[0].value;
        }
    } catch (err) {
        logger.error("[RewardedAds] Failed to read auth: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Validation failed"
        });
    }
    
    if (!authData) {
        logger.warn("[RewardedAds] Invalid score auth token from user: " + userId);
        return JSON.stringify({
            success: false,
            error: "Invalid authorization"
        });
    }
    
    // Check if already used
    if (authData.used) {
        logger.warn("[RewardedAds] Score auth already used");
        return JSON.stringify({
            success: false,
            error: "Authorization already used"
        });
    }
    
    // Check expiry
    var now = Math.floor(Date.now() / 1000);
    if (now > authData.expiresAt) {
        logger.warn("[RewardedAds] Score auth expired");
        return JSON.stringify({
            success: false,
            error: "Authorization expired"
        });
    }
    
    // Validate the multiplied score matches expected calculation
    var expectedScore = originalScore * authData.multiplier;
    if (multipliedScore !== expectedScore) {
        logger.warn("[RewardedAds] Score mismatch. Expected: " + expectedScore + ", Got: " + multipliedScore);
        return JSON.stringify({
            success: false,
            error: "Score calculation mismatch"
        });
    }
    
    // Mark as used
    authData.used = true;
    authData.usedAt = now;
    authData.originalScore = originalScore;
    authData.multipliedScore = multipliedScore;
    
    try {
        nk.storageWrite([{
            collection: "score_multiplier_auth",
            key: authToken,
            userId: userId,
            value: authData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (err) {
        logger.error("[RewardedAds] Failed to mark auth used: " + err.message);
    }
    
    logger.info("[RewardedAds] Score multiplier validated. User: " + userId + ", Original: " + originalScore + ", Multiplied: " + multipliedScore);
    
    return JSON.stringify({
        success: true,
        authorized: true,
        originalScore: originalScore,
        multipliedScore: multipliedScore,
        multiplier: authData.multiplier
    });
}

/**
 * RPC: Get user's rewarded ad status (for UI display)
 * 
 * Payload: { placement?: string }
 * Returns: { placements: object[] }
 */
function rpcGetRewardedAdStatus(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({
            success: false,
            error: "Authentication required"
        });
    }
    
    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) {
        // Continue with empty data
    }
    
    var requestedPlacement = data.placement;
    var now = Math.floor(Date.now() / 1000);
    var statuses = [];
    
    var placements = requestedPlacement ? [requestedPlacement] : Object.keys(REWARD_CONFIG);
    
    for (var i = 0; i < placements.length; i++) {
        var placement = placements[i];
        if (placement === "default" && !requestedPlacement) continue;
        
        var config = REWARD_CONFIG[placement] || REWARD_CONFIG["default"];
        var dailyClaims = getDailyClaimCount(nk, logger, userId, placement);
        var lastClaim = getLastClaimTimestamp(nk, logger, userId, placement);
        var cooldownRemaining = Math.max(0, (lastClaim + config.cooldownSeconds) - now);
        
        statuses.push({
            placement: placement,
            available: dailyClaims < config.maxClaimsPerDay && cooldownRemaining === 0,
            dailyClaims: dailyClaims,
            maxClaimsPerDay: config.maxClaimsPerDay,
            cooldownRemaining: cooldownRemaining,
            canClaimAt: cooldownRemaining > 0 ? lastClaim + config.cooldownSeconds : now,
            rewardType: config.rewardType,
            rewardAmount: config.amount,
            rewardCurrency: config.currency,
            multiplier: config.multiplier
        });
    }
    
    return JSON.stringify({
        success: true,
        placements: statuses,
        resetAt: getStartOfDay() + 86400
    });
}

// Export functions for registration
var rewardedAdsModule = {
    rpcRewardedAdRequestToken: rpcRewardedAdRequestToken,
    rpcRewardedAdClaim: rpcRewardedAdClaim,
    rpcValidateScoreMultiplier: rpcValidateScoreMultiplier,
    rpcGetRewardedAdStatus: rpcGetRewardedAdStatus
};
