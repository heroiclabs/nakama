// multigame_rpcs.js - Multi-Game RPCs for QuizVerse, LastToLive, and Custom Games
// Pure JavaScript - No TypeScript
// Compatible with Nakama V8 JavaScript runtime (No ES Modules)
//
// IMPORTANT TERMINOLOGY:
// - gameID: Legacy identifier for built-in games ("quizverse", "lasttolive")
// - gameUUID: Unique identifier (UUID) from external game registry API
// - gameTitle: Human-readable game name from external API
//
// This module supports both:
// 1. Legacy built-in games using gameID (backward compatibility)
// 2. New games using gameUUID from external registry

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse and validate payload with gameID or gameUUID
 * Supports both legacy gameID ("quizverse", "lasttolive") and new gameUUID (UUID)
 */
function parseAndValidateGamePayload(payload, requiredFields) {
    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (e) {
        throw Error("Invalid JSON payload");
    }

    // Support both gameID (legacy) and gameUUID (new)
    var gameIdentifier = data.gameID || data.gameUUID;
    
    if (!gameIdentifier) {
        throw Error("Missing game identifier: provide either 'gameID' (for built-in games) or 'gameUUID' (for custom games)");
    }
    
    // Normalize to gameID field for backward compatibility
    if (!data.gameID && data.gameUUID) {
        data.gameID = data.gameUUID;
    }
    
    // Legacy validation for built-in games
    var isLegacyGame = ["quizverse", "lasttolive"].includes(data.gameID);
    var isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(data.gameID);
    
    if (!isLegacyGame && !isUUID) {
        throw Error("Invalid game identifier. Must be 'quizverse', 'lasttolive', or a valid UUID");
    }

    // Validate required fields
    for (var i = 0; i < requiredFields.length; i++) {
        var field = requiredFields[i];
        if (!data.hasOwnProperty(field) || data[field] === null || data[field] === undefined) {
            throw Error("Missing required field: " + field);
        }
    }

    return data;
}

/**
 * Get user ID from data or context
 */
function getUserId(data, ctx) {
    return data.userID || ctx.userId;
}

/**
 * Create namespaced collection name
 */
function getCollection(gameID, type) {
    return gameID + "_" + type;
}

/**
 * Get leaderboard ID for game
 */
function getLeaderboardId(gameID, type) {
    if (type === "weekly" || !type) {
        return gameID + "_weekly";
    }
    return gameID + "_" + type;
}

// ============================================================================
// AUTHENTICATION & PROFILE
// ============================================================================

/**
 * RPC: quizverse_update_user_profile
 * Updates user profile for QuizVerse
 */
function quizverseUpdateUserProfile(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var userId = getUserId(data, context);
        
        var collection = getCollection(data.gameID, "profiles");
        var key = "profile_" + userId;
        
        // Read existing profile or create new
        var profile = {};
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                profile = records[0].value;
            }
        } catch (err) {
            logger.debug("No existing profile found, creating new");
        }
        
        // Update profile fields
        if (data.displayName) profile.displayName = data.displayName;
        if (data.avatar) profile.avatar = data.avatar;
        if (data.level !== undefined) profile.level = data.level;
        if (data.xp !== undefined) profile.xp = data.xp;
        if (data.metadata) profile.metadata = data.metadata;
        
        profile.updatedAt = new Date().toISOString();
        if (!profile.createdAt) {
            profile.createdAt = profile.updatedAt;
        }
        
        // Write profile
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: profile,
            permissionRead: 2,
            permissionWrite: 1
        }]);
        
        logger.info("[" + data.gameID + "] Profile updated for user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: profile
        });
        
    } catch (err) {
        logger.error("quizverse_update_user_profile error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_update_user_profile
 * Updates user profile for LastToLive
 */
function lasttoliveUpdateUserProfile(context, logger, nk, payload) {
    // Reuse the same logic as QuizVerse
    return quizverseUpdateUserProfile(context, logger, nk, payload);
}

// ============================================================================
// WALLET OPERATIONS
// ============================================================================

/**
 * RPC: quizverse_grant_currency
 * Grant currency to user wallet
 */
function quizverseGrantCurrency(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "amount"]);
        var userId = getUserId(data, context);
        var amount = parseInt(data.amount);
        
        if (isNaN(amount) || amount <= 0) {
            throw Error("Amount must be a positive number");
        }
        
        var collection = getCollection(data.gameID, "wallets");
        var key = "wallet_" + userId;
        
        // Read existing wallet
        var wallet = { balance: 0, currency: "coins" };
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                wallet = records[0].value;
            }
        } catch (err) {
            logger.debug("No existing wallet found, creating new");
        }
        
        // Grant currency
        wallet.balance = (wallet.balance || 0) + amount;
        wallet.updatedAt = new Date().toISOString();
        
        // Write wallet
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] Granted " + amount + " currency to user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: {
                balance: wallet.balance,
                amount: amount
            }
        });
        
    } catch (err) {
        logger.error("quizverse_grant_currency error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_grant_currency
 */
function lasttoliveGrantCurrency(context, logger, nk, payload) {
    return quizverseGrantCurrency(context, logger, nk, payload);
}

/**
 * RPC: quizverse_spend_currency
 * Spend currency from user wallet
 */
function quizverseSpendCurrency(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "amount"]);
        var userId = getUserId(data, context);
        var amount = parseInt(data.amount);
        
        if (isNaN(amount) || amount <= 0) {
            throw Error("Amount must be a positive number");
        }
        
        var collection = getCollection(data.gameID, "wallets");
        var key = "wallet_" + userId;
        
        // Read existing wallet
        var wallet = null;
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                wallet = records[0].value;
            }
        } catch (err) {
            throw Error("Wallet not found");
        }
        
        if (!wallet || wallet.balance < amount) {
            throw Error("Insufficient balance");
        }
        
        // Spend currency
        wallet.balance -= amount;
        wallet.updatedAt = new Date().toISOString();
        
        // Write wallet
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] User " + userId + " spent " + amount + " currency");
        
        return JSON.stringify({
            success: true,
            data: {
                balance: wallet.balance,
                amount: amount
            }
        });
        
    } catch (err) {
        logger.error("quizverse_spend_currency error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_spend_currency
 */
function lasttoliveSpendCurrency(context, logger, nk, payload) {
    return quizverseSpendCurrency(context, logger, nk, payload);
}

/**
 * RPC: quizverse_validate_purchase
 * Validate and process purchase
 */
function quizverseValidatePurchase(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "itemId", "price"]);
        var userId = getUserId(data, context);
        var price = parseInt(data.price);
        
        if (isNaN(price) || price < 0) {
            throw Error("Invalid price");
        }
        
        var collection = getCollection(data.gameID, "wallets");
        var key = "wallet_" + userId;
        
        // Read wallet
        var wallet = null;
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                wallet = records[0].value;
            }
        } catch (err) {
            throw Error("Wallet not found");
        }
        
        if (!wallet || wallet.balance < price) {
            return JSON.stringify({
                success: false,
                error: "Insufficient balance",
                data: { canPurchase: false }
            });
        }
        
        return JSON.stringify({
            success: true,
            data: {
                canPurchase: true,
                itemId: data.itemId,
                price: price,
                balance: wallet.balance
            }
        });
        
    } catch (err) {
        logger.error("quizverse_validate_purchase error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_validate_purchase
 */
function lasttoliveValidatePurchase(context, logger, nk, payload) {
    return quizverseValidatePurchase(context, logger, nk, payload);
}

// ============================================================================
// INVENTORY OPERATIONS
// ============================================================================

/**
 * RPC: quizverse_list_inventory
 * List user inventory items
 */
function quizverseListInventory(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var userId = getUserId(data, context);
        
        var collection = getCollection(data.gameID, "inventory");
        var key = "inv_" + userId;
        
        // Read inventory
        var inventory = { items: [] };
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                inventory = records[0].value;
            }
        } catch (err) {
            logger.debug("No existing inventory found");
        }
        
        return JSON.stringify({
            success: true,
            data: {
                items: inventory.items || []
            }
        });
        
    } catch (err) {
        logger.error("quizverse_list_inventory error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_list_inventory
 */
function lasttoliveListInventory(context, logger, nk, payload) {
    return quizverseListInventory(context, logger, nk, payload);
}

/**
 * RPC: quizverse_grant_item
 * Grant item to user inventory
 */
function quizverseGrantItem(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "itemId", "quantity"]);
        var userId = getUserId(data, context);
        var quantity = parseInt(data.quantity);
        
        if (isNaN(quantity) || quantity <= 0) {
            throw Error("Quantity must be a positive number");
        }
        
        var collection = getCollection(data.gameID, "inventory");
        var key = "inv_" + userId;
        
        // Read inventory
        var inventory = { items: [] };
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                inventory = records[0].value;
            }
        } catch (err) {
            logger.debug("Creating new inventory");
        }
        
        // Find or create item
        var itemFound = false;
        for (var i = 0; i < inventory.items.length; i++) {
            if (inventory.items[i].itemId === data.itemId) {
                inventory.items[i].quantity = (inventory.items[i].quantity || 0) + quantity;
                inventory.items[i].updatedAt = new Date().toISOString();
                itemFound = true;
                break;
            }
        }
        
        if (!itemFound) {
            inventory.items.push({
                itemId: data.itemId,
                quantity: quantity,
                metadata: data.metadata || {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }
        
        inventory.updatedAt = new Date().toISOString();
        
        // Write inventory
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: inventory,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] Granted " + quantity + "x " + data.itemId + " to user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: {
                itemId: data.itemId,
                quantity: quantity
            }
        });
        
    } catch (err) {
        logger.error("quizverse_grant_item error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_grant_item
 */
function lasttoliveGrantItem(context, logger, nk, payload) {
    return quizverseGrantItem(context, logger, nk, payload);
}

/**
 * RPC: quizverse_consume_item
 * Consume item from user inventory
 */
function quizverseConsumeItem(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "itemId", "quantity"]);
        var userId = getUserId(data, context);
        var quantity = parseInt(data.quantity);
        
        if (isNaN(quantity) || quantity <= 0) {
            throw Error("Quantity must be a positive number");
        }
        
        var collection = getCollection(data.gameID, "inventory");
        var key = "inv_" + userId;
        
        // Read inventory
        var inventory = null;
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                inventory = records[0].value;
            }
        } catch (err) {
            throw Error("Inventory not found");
        }
        
        if (!inventory || !inventory.items) {
            throw Error("No items in inventory");
        }
        
        // Find and consume item
        var itemFound = false;
        for (var i = 0; i < inventory.items.length; i++) {
            if (inventory.items[i].itemId === data.itemId) {
                if (inventory.items[i].quantity < quantity) {
                    throw Error("Insufficient quantity");
                }
                inventory.items[i].quantity -= quantity;
                inventory.items[i].updatedAt = new Date().toISOString();
                
                // Remove item if quantity is 0
                if (inventory.items[i].quantity === 0) {
                    inventory.items.splice(i, 1);
                }
                itemFound = true;
                break;
            }
        }
        
        if (!itemFound) {
            throw Error("Item not found in inventory");
        }
        
        inventory.updatedAt = new Date().toISOString();
        
        // Write inventory
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: inventory,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] User " + userId + " consumed " + quantity + "x " + data.itemId);
        
        return JSON.stringify({
            success: true,
            data: {
                itemId: data.itemId,
                quantity: quantity
            }
        });
        
    } catch (err) {
        logger.error("quizverse_consume_item error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_consume_item
 */
function lasttoliveConsumeItem(context, logger, nk, payload) {
    return quizverseConsumeItem(context, logger, nk, payload);
}

// ============================================================================
// LEADERBOARD - QUIZVERSE
// ============================================================================

/**
 * RPC: quizverse_submit_score
 * Submit score with QuizVerse-specific validations
 */
function quizverseSubmitScore(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "score"]);
        var userId = getUserId(data, context);
        var score = parseInt(data.score);
        
        if (isNaN(score) || score < 0) {
            throw Error("Invalid score");
        }
        
        // QuizVerse-specific validation
        if (data.answersCount !== undefined) {
            var answersCount = parseInt(data.answersCount);
            if (isNaN(answersCount) || answersCount < 0) {
                throw Error("Invalid answers count");
            }
            // Anti-cheat: max score per answer
            var maxScorePerAnswer = 100;
            if (score > answersCount * maxScorePerAnswer) {
                throw Error("Score exceeds maximum possible value");
            }
        }
        
        if (data.completionTime !== undefined) {
            var completionTime = parseInt(data.completionTime);
            if (isNaN(completionTime) || completionTime < 0) {
                throw Error("Invalid completion time");
            }
            // Anti-cheat: minimum time per question
            var minTimePerQuestion = 1; // seconds
            if (data.answersCount && completionTime < data.answersCount * minTimePerQuestion) {
                throw Error("Completion time too fast");
            }
        }
        
        var leaderboardId = getLeaderboardId(data.gameID, "weekly");
        var username = context.username || userId;
        
        var metadata = {
            gameID: data.gameID,
            submittedAt: new Date().toISOString(),
            answersCount: data.answersCount || 0,
            completionTime: data.completionTime || 0
        };
        
        // Submit to leaderboard
        nk.leaderboardRecordWrite(
            leaderboardId,
            userId,
            username,
            score,
            0,
            metadata
        );
        
        logger.info("[quizverse] Score " + score + " submitted for user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: {
                score: score,
                leaderboardId: leaderboardId
            }
        });
        
    } catch (err) {
        logger.error("quizverse_submit_score error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: quizverse_get_leaderboard
 * Get leaderboard for QuizVerse
 */
function quizverseGetLeaderboard(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var limit = data.limit || 10;
        
        if (limit < 1 || limit > 100) {
            throw Error("Limit must be between 1 and 100");
        }
        
        var leaderboardId = getLeaderboardId(data.gameID, "weekly");
        
        // Get leaderboard records
        var records = nk.leaderboardRecordsList(leaderboardId, null, limit, null, 0);
        
        return JSON.stringify({
            success: true,
            data: {
                leaderboardId: leaderboardId,
                records: records.records || []
            }
        });
        
    } catch (err) {
        logger.error("quizverse_get_leaderboard error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// ============================================================================
// LEADERBOARD - LASTTOLIVE
// ============================================================================

/**
 * RPC: lasttolive_submit_score
 * Submit score with LastToLive-specific survival validations
 */
function lasttoliveSubmitScore(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var userId = getUserId(data, context);
        
        // LastToLive-specific validation
        var kills = parseInt(data.kills || 0);
        var timeSurvivedSec = parseInt(data.timeSurvivedSec || 0);
        var damageTaken = parseFloat(data.damageTaken || 0);
        var damageDealt = parseFloat(data.damageDealt || 0);
        var reviveCount = parseInt(data.reviveCount || 0);
        
        // Validate metrics
        if (isNaN(kills) || kills < 0) {
            throw Error("Invalid kills count");
        }
        if (isNaN(timeSurvivedSec) || timeSurvivedSec < 0) {
            throw Error("Invalid survival time");
        }
        if (isNaN(damageTaken) || damageTaken < 0) {
            throw Error("Invalid damage taken");
        }
        if (isNaN(damageDealt) || damageDealt < 0) {
            throw Error("Invalid damage dealt");
        }
        if (isNaN(reviveCount) || reviveCount < 0) {
            throw Error("Invalid revive count");
        }
        
        // Anti-cheat: reject impossible values
        var maxKillsPerMinute = 10;
        var minutesSurvived = timeSurvivedSec / 60;
        if (minutesSurvived > 0 && kills > maxKillsPerMinute * minutesSurvived) {
            throw Error("Kills count exceeds maximum possible value");
        }
        
        var maxDamagePerSecond = 1000;
        if (damageDealt > maxDamagePerSecond * timeSurvivedSec) {
            throw Error("Damage dealt exceeds maximum possible value");
        }
        
        // Calculate score using LastToLive formula
        var score = Math.floor(
            (timeSurvivedSec * 10) +
            (kills * 500) -
            (damageTaken * 0.1)
        );
        
        if (score < 0) score = 0;
        
        var leaderboardId = getLeaderboardId(data.gameID, "survivor_rank");
        var username = context.username || userId;
        
        var metadata = {
            gameID: data.gameID,
            submittedAt: new Date().toISOString(),
            kills: kills,
            timeSurvivedSec: timeSurvivedSec,
            damageTaken: damageTaken,
            damageDealt: damageDealt,
            reviveCount: reviveCount
        };
        
        // Submit to leaderboard
        nk.leaderboardRecordWrite(
            leaderboardId,
            userId,
            username,
            score,
            0,
            metadata
        );
        
        logger.info("[lasttolive] Score " + score + " submitted for user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: {
                score: score,
                leaderboardId: leaderboardId,
                metrics: {
                    kills: kills,
                    timeSurvivedSec: timeSurvivedSec,
                    damageTaken: damageTaken,
                    damageDealt: damageDealt,
                    reviveCount: reviveCount
                }
            }
        });
        
    } catch (err) {
        logger.error("lasttolive_submit_score error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_get_leaderboard
 * Get leaderboard for LastToLive
 */
function lasttoliveGetLeaderboard(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var limit = data.limit || 10;
        
        if (limit < 1 || limit > 100) {
            throw Error("Limit must be between 1 and 100");
        }
        
        var leaderboardId = getLeaderboardId(data.gameID, "survivor_rank");
        
        // Get leaderboard records
        var records = nk.leaderboardRecordsList(leaderboardId, null, limit, null, 0);
        
        return JSON.stringify({
            success: true,
            data: {
                leaderboardId: leaderboardId,
                records: records.records || []
            }
        });
        
    } catch (err) {
        logger.error("lasttolive_get_leaderboard error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// ============================================================================
// MULTIPLAYER
// ============================================================================

/**
 * RPC: quizverse_join_or_create_match
 * Join or create a multiplayer match
 */
function quizverseJoinOrCreateMatch(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var userId = getUserId(data, context);
        
        // For now, return a placeholder match ID
        // In a full implementation, this would use Nakama's matchmaker
        var matchId = data.gameID + "_match_" + Date.now();
        
        logger.info("[" + data.gameID + "] User " + userId + " joined/created match: " + matchId);
        
        return JSON.stringify({
            success: true,
            data: {
                matchId: matchId,
                gameID: data.gameID
            }
        });
        
    } catch (err) {
        logger.error("quizverse_join_or_create_match error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_join_or_create_match
 */
function lasttoliveJoinOrCreateMatch(context, logger, nk, payload) {
    return quizverseJoinOrCreateMatch(context, logger, nk, payload);
}

// ============================================================================
// DAILY REWARDS
// ============================================================================

/**
 * RPC: quizverse_claim_daily_reward
 * Claim daily reward
 */
function quizverseClaimDailyReward(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var userId = getUserId(data, context);
        
        var collection = getCollection(data.gameID, "daily_rewards");
        var key = "daily_" + userId;
        
        var now = new Date();
        var today = now.toISOString().split('T')[0];
        
        // Read reward state
        var rewardState = { lastClaim: null, streak: 0 };
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                rewardState = records[0].value;
            }
        } catch (err) {
            logger.debug("No existing reward state found");
        }
        
        // Check if already claimed today
        if (rewardState.lastClaim === today) {
            return JSON.stringify({
                success: false,
                error: "Daily reward already claimed today"
            });
        }
        
        // Calculate streak
        var yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        var yesterdayStr = yesterday.toISOString().split('T')[0];
        
        if (rewardState.lastClaim === yesterdayStr) {
            rewardState.streak += 1;
        } else {
            rewardState.streak = 1;
        }
        
        rewardState.lastClaim = today;
        
        // Calculate reward amount (increases with streak)
        var baseReward = 100;
        var rewardAmount = baseReward + (rewardState.streak - 1) * 10;
        
        // Write reward state
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: rewardState,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] User " + userId + " claimed daily reward. Streak: " + rewardState.streak);
        
        return JSON.stringify({
            success: true,
            data: {
                rewardAmount: rewardAmount,
                streak: rewardState.streak,
                nextReward: baseReward + rewardState.streak * 10
            }
        });
        
    } catch (err) {
        logger.error("quizverse_claim_daily_reward error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_claim_daily_reward
 */
function lasttoliveClaimDailyReward(context, logger, nk, payload) {
    return quizverseClaimDailyReward(context, logger, nk, payload);
}

// ============================================================================
// SOCIAL
// ============================================================================

/**
 * RPC: quizverse_find_friends
 * Production-ready player search with partial matching and relationship enrichment.
 *
 * Features:
 *   1. Case-insensitive partial match on username AND display_name via SQL ILIKE
 *   2. Excludes self, disabled, and banned accounts
 *   3. Enriches every result with relationshipStatus (friend / blocked / pending_sent / pending_received / none)
 *   4. Returns avatarUrl, online status, createTime
 *   5. SQL-injection safe via parameterised queries
 *
 * Payload: { gameID: "quizverse", query: "carlos", limit: 20 }
 * Response: { success: true, data: { results: [...], query: "...", count: N, searcherId: "..." } }
 */
function quizverseFindFriends(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);

        if (!data.query || typeof data.query !== "string") {
            throw Error("Query string is required");
        }

        var query = data.query.trim();
        if (query.length < 2) {
            throw Error("Query must be at least 2 characters");
        }
        if (query.length > 50) {
            query = query.substring(0, 50);
        }

        var limit = parseInt(data.limit) || 20;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var userId = context.userId;
        if (!userId) {
            throw Error("User not authenticated");
        }

        // ── Phase 1: Partial search via SQL ──
        // Uses PostgreSQL ILIKE for case-insensitive substring matching.
        // The '%' wildcards around the query enable "contains" matching.
        // We exclude the caller, disabled accounts, and fetch limit+1 to account
        // for possible self-exclusion in results.
        var sqlPattern = "%" + query + "%";
        var rows = [];
        try {
            rows = nk.sqlQuery(
                "SELECT id, username, display_name, avatar_url, create_time " +
                "FROM users " +
                "WHERE (username ILIKE $1 OR display_name ILIKE $1) " +
                "AND id != $2 " +
                "AND disable_time = '1970-01-01 00:00:00 UTC' " +
                "ORDER BY username ASC " +
                "LIMIT $3",
                [sqlPattern, userId, limit]
            );
        } catch (sqlErr) {
            logger.warn("quizverse_find_friends SQL fallback: " + sqlErr.message);
            // Fallback: exact match via Nakama API (original behaviour)
            try {
                var exactUsers = nk.usersGetUsername([query]);
                if (exactUsers && exactUsers.length > 0) {
                    for (var e = 0; e < exactUsers.length; e++) {
                        if (exactUsers[e].id !== userId) {
                            rows.push({
                                id: exactUsers[e].id,
                                username: exactUsers[e].username,
                                display_name: exactUsers[e].displayName || exactUsers[e].username,
                                avatar_url: exactUsers[e].avatarUrl || "",
                                create_time: exactUsers[e].createTime || ""
                            });
                        }
                    }
                }
            } catch (fallbackErr) {
                logger.warn("quizverse_find_friends fallback also failed: " + fallbackErr.message);
            }
        }

        // ── Phase 2: Build relationship map from caller's friends list ──
        // States: 0 = mutual friends, 1 = sent invite, 2 = received invite, 3 = blocked
        var relationMap = {};
        try {
            var friendsResult = nk.friendsList(userId, 1000, null, null);
            if (friendsResult && friendsResult.friends) {
                for (var f = 0; f < friendsResult.friends.length; f++) {
                    var fr = friendsResult.friends[f];
                    var state = fr.state;
                    var fid = fr.user.id;
                    if (state === 0) {
                        relationMap[fid] = "friend";
                    } else if (state === 1) {
                        relationMap[fid] = "pending_sent";
                    } else if (state === 2) {
                        relationMap[fid] = "pending_received";
                    } else if (state === 3) {
                        relationMap[fid] = "blocked";
                    }
                }
            }
        } catch (friendsErr) {
            logger.warn("quizverse_find_friends: could not load friends list: " + friendsErr.message);
            // Continue without relationship data — search still works
        }

        // ── Phase 3: Build enriched results ──
        var results = [];
        for (var i = 0; i < rows.length && results.length < limit; i++) {
            var row = rows[i];
            var rid = row.id;

            // Skip self (safety net)
            if (rid === userId) continue;

            var status = relationMap[rid] || "none";

            results.push({
                userId: rid,
                username: row.username || "",
                displayName: row.display_name || row.username || "",
                avatarUrl: row.avatar_url || "",
                online: false, // SQL doesn't tell us; client can check separately
                createTime: row.create_time || "",
                relationshipStatus: status
            });
        }

        logger.info("quizverse_find_friends: query='" + query + "' found " + results.length + " results for user " + userId);

        return JSON.stringify({
            success: true,
            data: {
                results: results,
                query: query,
                count: results.length,
                searcherId: userId
            }
        });

    } catch (err) {
        logger.error("quizverse_find_friends error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_find_friends
 */
function lasttolliveFindFriends(context, logger, nk, payload) {
    return quizverseFindFriends(context, logger, nk, payload);
}

// ============================================================================
// PLAYER DATA
// ============================================================================

/**
 * RPC: quizverse_save_player_data
 * Save player data to storage
 */
function quizverseSavePlayerData(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "key", "value"]);
        var userId = getUserId(data, context);
        
        var collection = getCollection(data.gameID, "player_data");
        var storageKey = data.key;
        
        var playerData = {
            value: data.value,
            updatedAt: new Date().toISOString()
        };
        
        // Write player data
        nk.storageWrite([{
            collection: collection,
            key: storageKey,
            userId: userId,
            value: playerData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] Saved player data for user: " + userId + ", key: " + storageKey);
        
        return JSON.stringify({
            success: true,
            data: {
                key: storageKey,
                saved: true
            }
        });
        
    } catch (err) {
        logger.error("quizverse_save_player_data error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_save_player_data
 */
function lasttolliveSavePlayerData(context, logger, nk, payload) {
    return quizverseSavePlayerData(context, logger, nk, payload);
}

/**
 * RPC: quizverse_load_player_data
 * Load player data from storage
 */
function quizverseLoadPlayerData(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "key"]);
        var userId = getUserId(data, context);
        
        var collection = getCollection(data.gameID, "player_data");
        var storageKey = data.key;
        
        // Read player data
        var playerData = null;
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: storageKey,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                playerData = records[0].value;
            }
        } catch (err) {
            logger.debug("No player data found for key: " + storageKey);
        }
        
        if (!playerData) {
            return JSON.stringify({
                success: false,
                error: "Player data not found"
            });
        }
        
        return JSON.stringify({
            success: true,
            data: {
                key: storageKey,
                value: playerData.value,
                updatedAt: playerData.updatedAt
            }
        });
        
    } catch (err) {
        logger.error("quizverse_load_player_data error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_load_player_data
 */
function lasttoliveLoadPlayerData(context, logger, nk, payload) {
    return quizverseLoadPlayerData(context, logger, nk, payload);
}

// ============================================================================
// REGISTRATION FUNCTIONS
// ============================================================================

/**
 * Register all multi-game RPCs with safe auto-registration
 */
function registerMultiGameRPCs(initializer, logger) {
    logger.info('[MultiGameRPCs] Initializing Multi-Game RPC Module...');
    
    // Initialize global RPC registry
    if (!globalThis.__registeredRPCs) {
        globalThis.__registeredRPCs = new Set();
    }
    
    var rpcs = [
        // QuizVerse RPCs
        { id: 'quizverse_update_user_profile', handler: quizverseUpdateUserProfile },
        { id: 'quizverse_grant_currency', handler: quizverseGrantCurrency },
        { id: 'quizverse_spend_currency', handler: quizverseSpendCurrency },
        { id: 'quizverse_validate_purchase', handler: quizverseValidatePurchase },
        { id: 'quizverse_list_inventory', handler: quizverseListInventory },
        { id: 'quizverse_grant_item', handler: quizverseGrantItem },
        { id: 'quizverse_consume_item', handler: quizverseConsumeItem },
        { id: 'quizverse_submit_score', handler: quizverseSubmitScore },
        { id: 'quizverse_get_leaderboard', handler: quizverseGetLeaderboard },
        { id: 'quizverse_join_or_create_match', handler: quizverseJoinOrCreateMatch },
        { id: 'quizverse_claim_daily_reward', handler: quizverseClaimDailyReward },
        { id: 'quizverse_find_friends', handler: quizverseFindFriends },
        { id: 'quizverse_save_player_data', handler: quizverseSavePlayerData },
        { id: 'quizverse_load_player_data', handler: quizverseLoadPlayerData },
        
        // LastToLive RPCs
        { id: 'lasttolive_update_user_profile', handler: lasttoliveUpdateUserProfile },
        { id: 'lasttolive_grant_currency', handler: lasttoliveGrantCurrency },
        { id: 'lasttolive_spend_currency', handler: lasttoliveSpendCurrency },
        { id: 'lasttolive_validate_purchase', handler: lasttoliveValidatePurchase },
        { id: 'lasttolive_list_inventory', handler: lasttoliveListInventory },
        { id: 'lasttolive_grant_item', handler: lasttoliveGrantItem },
        { id: 'lasttolive_consume_item', handler: lasttoliveConsumeItem },
        { id: 'lasttolive_submit_score', handler: lasttoliveSubmitScore },
        { id: 'lasttolive_get_leaderboard', handler: lasttoliveGetLeaderboard },
        { id: 'lasttolive_join_or_create_match', handler: lasttoliveJoinOrCreateMatch },
        { id: 'lasttolive_claim_daily_reward', handler: lasttoliveClaimDailyReward },
        { id: 'lasttolive_find_friends', handler: lasttolliveFindFriends },
        { id: 'lasttolive_save_player_data', handler: lasttolliveSavePlayerData },
        { id: 'lasttolive_load_player_data', handler: lasttoliveLoadPlayerData }
    ];
    
    var registered = 0;
    var skipped = 0;
    
    for (var i = 0; i < rpcs.length; i++) {
        var rpc = rpcs[i];
        
        if (!globalThis.__registeredRPCs.has(rpc.id)) {
            try {
                initializer.registerRpc(rpc.id, rpc.handler);
                globalThis.__registeredRPCs.add(rpc.id);
                logger.info('[MultiGameRPCs] ✓ Registered RPC: ' + rpc.id);
                registered++;
            } catch (err) {
                logger.error('[MultiGameRPCs] ✗ Failed to register ' + rpc.id + ': ' + err.message);
            }
        } else {
            logger.info('[MultiGameRPCs] ⊘ Skipped (already registered): ' + rpc.id);
            skipped++;
        }
    }
    
    logger.info('[MultiGameRPCs] Registration complete: ' + registered + ' registered, ' + skipped + ' skipped');
    logger.info('[MultiGameRPCs] Total RPCs available: ' + rpcs.length);
}
