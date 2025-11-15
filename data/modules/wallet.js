// wallet.js - Per-game and global wallet management
// Compatible with Nakama JavaScript runtime (no ES modules)

/**
 * Get or create a per-game wallet
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} deviceId - Device identifier
 * @param {string} gameId - Game UUID
 * @param {string} walletId - Wallet ID from identity
 * @returns {object} Wallet object
 */
function getOrCreateGameWallet(nk, logger, deviceId, gameId, walletId) {
    var collection = "quizverse";
    var key = "wallet:" + deviceId + ":" + gameId;
    
    logger.info("[NAKAMA] Looking for game wallet: " + key);
    
    // Try to read existing wallet
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            logger.info("[NAKAMA] Found existing game wallet");
            return records[0].value;
        }
    } catch (err) {
        logger.warn("[NAKAMA] Failed to read game wallet: " + err.message);
    }
    
    // Create new game wallet
    logger.info("[NAKAMA] Creating new game wallet");
    
    var wallet = {
        wallet_id: walletId,
        device_id: deviceId,
        game_id: gameId,
        balance: 0,
        currency: "coins",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    // Write wallet to storage
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000",
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[NAKAMA] Created game wallet with balance 0");
    } catch (err) {
        logger.error("[NAKAMA] Failed to write game wallet: " + err.message);
        throw err;
    }
    
    return wallet;
}

/**
 * Get or create a global wallet (shared across all games)
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} deviceId - Device identifier
 * @param {string} globalWalletId - Global wallet ID
 * @returns {object} Global wallet object
 */
function getOrCreateGlobalWallet(nk, logger, deviceId, globalWalletId) {
    var collection = "quizverse";
    var key = "wallet:" + deviceId + ":global";
    
    logger.info("[NAKAMA] Looking for global wallet: " + key);
    
    // Try to read existing wallet
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            logger.info("[NAKAMA] Found existing global wallet");
            return records[0].value;
        }
    } catch (err) {
        logger.warn("[NAKAMA] Failed to read global wallet: " + err.message);
    }
    
    // Create new global wallet
    logger.info("[NAKAMA] Creating new global wallet");
    
    var wallet = {
        wallet_id: globalWalletId,
        device_id: deviceId,
        game_id: "global",
        balance: 0,
        currency: "global_coins",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    // Write wallet to storage
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000",
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[NAKAMA] Created global wallet with balance 0");
    } catch (err) {
        logger.error("[NAKAMA] Failed to write global wallet: " + err.message);
        throw err;
    }
    
    return wallet;
}

/**
 * Update game wallet balance
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} deviceId - Device identifier
 * @param {string} gameId - Game UUID
 * @param {number} newBalance - New balance value
 * @returns {object} Updated wallet
 */
function updateGameWalletBalance(nk, logger, deviceId, gameId, newBalance) {
    var collection = "quizverse";
    var key = "wallet:" + deviceId + ":" + gameId;
    
    logger.info("[NAKAMA] Updating game wallet balance to " + newBalance);
    
    // Read current wallet
    var wallet;
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            wallet = records[0].value;
        } else {
            logger.error("[NAKAMA] Wallet not found for update");
            throw new Error("Wallet not found");
        }
    } catch (err) {
        logger.error("[NAKAMA] Failed to read wallet for update: " + err.message);
        throw err;
    }
    
    // Update balance
    wallet.balance = newBalance;
    wallet.updated_at = new Date().toISOString();
    
    // Write updated wallet
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000",
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[NAKAMA] Updated wallet balance to " + newBalance);
    } catch (err) {
        logger.error("[NAKAMA] Failed to write updated wallet: " + err.message);
        throw err;
    }
    
    return wallet;
}
