// wallet.js - Enhanced Wallet System (Global + Per-Game Sub-Wallets)

import * as utils from "../copilot/utils.js";

/**
 * Get or create global wallet for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @returns {object} Global wallet data
 */
function getGlobalWallet(nk, logger, userId) {
    var collection = "wallets";
    var key = utils.makeGlobalStorageKey("global_wallet", userId);
    
    var wallet = utils.readStorage(nk, logger, collection, key, userId);
    
    if (!wallet) {
        // Initialize new global wallet
        wallet = {
            userId: userId,
            currencies: {
                xut: 0,
                xp: 0
            },
            items: {},
            nfts: [],
            createdAt: utils.getCurrentTimestamp()
        };
    }
    
    return wallet;
}

/**
 * Get or create game-specific wallet for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @returns {object} Game wallet data
 */
function getGameWallet(nk, logger, userId, gameId) {
    var collection = "wallets";
    var key = utils.makeGameStorageKey("wallet", userId, gameId);
    
    var wallet = utils.readStorage(nk, logger, collection, key, userId);
    
    if (!wallet) {
        // Initialize new game wallet
        wallet = {
            userId: userId,
            gameId: gameId,
            currencies: {
                tokens: 0,
                xp: 0
            },
            items: {},
            consumables: {},
            cosmetics: {},
            createdAt: utils.getCurrentTimestamp()
        };
    }
    
    return wallet;
}

/**
 * Save global wallet
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {object} wallet - Wallet data
 * @returns {boolean} Success status
 */
function saveGlobalWallet(nk, logger, userId, wallet) {
    var collection = "wallets";
    var key = utils.makeGlobalStorageKey("global_wallet", userId);
    wallet.updatedAt = utils.getCurrentTimestamp();
    return utils.writeStorage(nk, logger, collection, key, userId, wallet);
}

/**
 * Save game wallet
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {object} wallet - Wallet data
 * @returns {boolean} Success status
 */
function saveGameWallet(nk, logger, userId, gameId, wallet) {
    var collection = "wallets";
    var key = utils.makeGameStorageKey("wallet", userId, gameId);
    wallet.updatedAt = utils.getCurrentTimestamp();
    return utils.writeStorage(nk, logger, collection, key, userId, wallet);
}

/**
 * Log transaction
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {object} transaction - Transaction data
 */
function logTransaction(nk, logger, userId, transaction) {
    var key = "transaction_log_" + userId + "_" + utils.getUnixTimestamp();
    transaction.timestamp = utils.getCurrentTimestamp();
    utils.writeStorage(nk, logger, "transaction_logs", key, userId, transaction);
}

/**
 * RPC: Get all wallets (global + all game wallets)
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload (empty)
 * @returns {string} JSON response
 */
function rpcWalletGetAll(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC wallet_get_all called");
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    // Get global wallet
    var globalWallet = getGlobalWallet(nk, logger, userId);
    
    // Get all game wallets
    var gameWallets = [];
    try {
        var records = nk.storageList(userId, "wallets", 100);
        for (var i = 0; i < records.length; i++) {
            if (records[i].key.indexOf("wallet_" + userId + "_") === 0) {
                gameWallets.push(records[i].value);
            }
        }
    } catch (err) {
        utils.logWarn(logger, "Failed to list game wallets: " + err.message);
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        globalWallet: globalWallet,
        gameWallets: gameWallets,
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Update global wallet
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { currency: "xut", amount: 100, operation: "add" }
 * @returns {string} JSON response
 */
function rpcWalletUpdateGlobal(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC wallet_update_global called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['currency', 'amount', 'operation']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var currency = data.currency;
    var amount = data.amount;
    var operation = data.operation; // "add" or "subtract"
    
    // Get global wallet
    var wallet = getGlobalWallet(nk, logger, userId);
    
    // Initialize currency if not exists
    if (!wallet.currencies[currency]) {
        wallet.currencies[currency] = 0;
    }
    
    // Update currency
    if (operation === "add") {
        wallet.currencies[currency] += amount;
    } else if (operation === "subtract") {
        wallet.currencies[currency] -= amount;
        if (wallet.currencies[currency] < 0) {
            wallet.currencies[currency] = 0;
        }
    } else {
        return utils.handleError(ctx, null, "Invalid operation: " + operation);
    }
    
    // Save wallet
    if (!saveGlobalWallet(nk, logger, userId, wallet)) {
        return utils.handleError(ctx, null, "Failed to save global wallet");
    }
    
    // Log transaction
    logTransaction(nk, logger, userId, {
        type: "global_wallet_update",
        currency: currency,
        amount: amount,
        operation: operation,
        newBalance: wallet.currencies[currency]
    });
    
    return JSON.stringify({
        success: true,
        userId: userId,
        currency: currency,
        newBalance: wallet.currencies[currency],
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Update game wallet
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid", currency: "tokens", amount: 100, operation: "add" }
 * @returns {string} JSON response
 */
function rpcWalletUpdateGameWallet(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC wallet_update_game_wallet called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId', 'currency', 'amount', 'operation']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!utils.isValidUUID(gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var currency = data.currency;
    var amount = data.amount;
    var operation = data.operation;
    
    // Get game wallet
    var wallet = getGameWallet(nk, logger, userId, gameId);
    
    // Initialize currency if not exists
    if (!wallet.currencies[currency]) {
        wallet.currencies[currency] = 0;
    }
    
    // Update currency
    if (operation === "add") {
        wallet.currencies[currency] += amount;
    } else if (operation === "subtract") {
        wallet.currencies[currency] -= amount;
        if (wallet.currencies[currency] < 0) {
            wallet.currencies[currency] = 0;
        }
    } else {
        return utils.handleError(ctx, null, "Invalid operation: " + operation);
    }
    
    // Save wallet
    if (!saveGameWallet(nk, logger, userId, gameId, wallet)) {
        return utils.handleError(ctx, null, "Failed to save game wallet");
    }
    
    // Log transaction
    logTransaction(nk, logger, userId, {
        type: "game_wallet_update",
        gameId: gameId,
        currency: currency,
        amount: amount,
        operation: operation,
        newBalance: wallet.currencies[currency]
    });
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        currency: currency,
        newBalance: wallet.currencies[currency],
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Transfer between game wallets
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON with { fromGameId: "uuid", toGameId: "uuid", currency: "tokens", amount: 100 }
 * @returns {string} JSON response
 */
function rpcWalletTransferBetweenGameWallets(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC wallet_transfer_between_game_wallets called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['fromGameId', 'toGameId', 'currency', 'amount']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var fromGameId = data.fromGameId;
    var toGameId = data.toGameId;
    
    if (!utils.isValidUUID(fromGameId) || !utils.isValidUUID(toGameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var currency = data.currency;
    var amount = data.amount;
    
    // Get both wallets
    var fromWallet = getGameWallet(nk, logger, userId, fromGameId);
    var toWallet = getGameWallet(nk, logger, userId, toGameId);
    
    // Check if source wallet has enough
    if (!fromWallet.currencies[currency] || fromWallet.currencies[currency] < amount) {
        return JSON.stringify({
            success: false,
            error: "Insufficient balance in source wallet"
        });
    }
    
    // Transfer
    fromWallet.currencies[currency] -= amount;
    if (!toWallet.currencies[currency]) {
        toWallet.currencies[currency] = 0;
    }
    toWallet.currencies[currency] += amount;
    
    // Save both wallets
    if (!saveGameWallet(nk, logger, userId, fromGameId, fromWallet)) {
        return utils.handleError(ctx, null, "Failed to save source wallet");
    }
    if (!saveGameWallet(nk, logger, userId, toGameId, toWallet)) {
        return utils.handleError(ctx, null, "Failed to save destination wallet");
    }
    
    // Log transaction
    logTransaction(nk, logger, userId, {
        type: "wallet_transfer",
        fromGameId: fromGameId,
        toGameId: toGameId,
        currency: currency,
        amount: amount
    });
    
    return JSON.stringify({
        success: true,
        userId: userId,
        fromGameId: fromGameId,
        toGameId: toGameId,
        currency: currency,
        amount: amount,
        fromBalance: fromWallet.currencies[currency],
        toBalance: toWallet.currencies[currency],
        timestamp: utils.getCurrentTimestamp()
    });
}

// Export RPC functions (ES Module syntax)
export {
    rpcWalletGetAll,
    rpcWalletUpdateGlobal,
    rpcWalletUpdateGameWallet,
    rpcWalletTransferBetweenGameWallets
};
