// wallet.js - Per-game and global wallet management
// Compatible with Nakama JavaScript runtime (no ES modules)
//
// IMPORTANT:
// - gameId parameter can be either:
//   1. Legacy game name ("quizverse", "lasttolive") for backward compatibility
//   2. Game UUID from external registry for new games
// - Storage keys use the gameId as-is to maintain compatibility

/**
 * Get or create a per-game wallet
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} deviceId - Device identifier
 * @param {string} gameId - Game identifier (legacy name or UUID)
 * @param {string} walletId - Wallet ID from identity
 * @param {string} userId - Optional authenticated user ID
 * @returns {object} Wallet object
 */
function getOrCreateGameWallet(nk, logger, deviceId, gameId, walletId, userId) {
    var collection = "game_wallets";  // Updated to more generic collection name
    var key = "wallet:" + deviceId + ":" + gameId;
    var storageUserId = userId || "00000000-0000-0000-0000-000000000000";
    
    logger.info("[Wallet] Looking for game wallet: " + key + " (userId: " + storageUserId + ", gameId: " + gameId + ")");
    
    // Try to read existing wallet with actual userId first
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: storageUserId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            logger.info("[Wallet] Found existing game wallet for gameId: " + gameId);
            return records[0].value;
        }
        
        // Try with system userId for backward compatibility
        if (userId && storageUserId !== "00000000-0000-0000-0000-000000000000") {
            records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
            
            if (records && records.length > 0 && records[0].value) {
                logger.info("[Wallet] Found existing game wallet with system userId, migrating");
                var existingWallet = records[0].value;
                existingWallet.user_id = userId;
                
                // Migrate to user-scoped storage
                nk.storageWrite([{
                    collection: collection,
                    key: key,
                    userId: userId,
                    value: existingWallet,
                    permissionRead: 1,
                    permissionWrite: 0,
                    version: "*"
                }]);
                
                return existingWallet;
            }
        }
    } catch (err) {
        logger.warn("[Wallet] Failed to read game wallet: " + err.message);
    }
    
    // Create new game wallet with enhanced metadata
    logger.info("[Wallet] Creating new game wallet for gameId: " + gameId);
    
    // Try to get game metadata from registry
    var gameTitle = null;
    try {
        var registryRecords = nk.storageRead([{
            collection: "game_registry",
            key: "all_games",
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (registryRecords && registryRecords.length > 0 && registryRecords[0].value) {
            var registry = registryRecords[0].value;
            if (registry.games) {
                for (var i = 0; i < registry.games.length; i++) {
                    if (registry.games[i].gameId === gameId) {
                        gameTitle = registry.games[i].gameTitle;
                        break;
                    }
                }
            }
        }
    } catch (err) {
        logger.debug("[Wallet] Could not fetch game title from registry: " + err.message);
    }
    
    var wallet = {
        wallet_id: walletId,
        device_id: deviceId,
        game_id: gameId,
        game_title: gameTitle || "Unknown Game",  // Add game title for admin visibility
        user_id: userId || null,
        balance: 0,
        currency: "coins",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    // Write wallet to storage with proper userId
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: storageUserId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[Wallet] Created game wallet with balance 0 for userId " + storageUserId + ", gameId: " + gameId);
    } catch (err) {
        logger.error("[Wallet] Failed to write game wallet: " + err.message);
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
 * @param {string} userId - Optional authenticated user ID
 * @returns {object} Global wallet object
 */
function getOrCreateGlobalWallet(nk, logger, deviceId, globalWalletId, userId) {
    var collection = "global_wallets";  // Use dedicated collection for global wallets
    var key = "wallet:" + deviceId + ":global";
    var storageUserId = userId || "00000000-0000-0000-0000-000000000000";
    
    logger.info("[Wallet] Looking for global wallet: " + key + " (userId: " + storageUserId + ")");
    
    // Try to read existing wallet with actual userId first
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: storageUserId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            logger.info("[Wallet] Found existing global wallet");
            return records[0].value;
        }
        
        // Try with system userId for backward compatibility
        if (userId && storageUserId !== "00000000-0000-0000-0000-000000000000") {
            records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
            
            if (records && records.length > 0 && records[0].value) {
                logger.info("[Wallet] Found existing global wallet with system userId, migrating");
                var existingWallet = records[0].value;
                existingWallet.user_id = userId;
                
                // Migrate to user-scoped storage
                nk.storageWrite([{
                    collection: collection,
                    key: key,
                    userId: userId,
                    value: existingWallet,
                    permissionRead: 1,
                    permissionWrite: 0,
                    version: "*"
                }]);
                
                return existingWallet;
            }
        }
    } catch (err) {
        logger.warn("[Wallet] Failed to read global wallet: " + err.message);
    }
    
    // Create new global wallet with enhanced metadata
    logger.info("[Wallet] Creating new global wallet for user");
    
    // Get user's linked games for metadata
    var linkedGames = [];
    try {
        var gameWalletRecords = nk.storageList(storageUserId, "game_wallets", 100, null);
        if (gameWalletRecords && gameWalletRecords.objects) {
            for (var i = 0; i < gameWalletRecords.objects.length; i++) {
                var gw = gameWalletRecords.objects[i].value;
                if (gw.game_id) {
                    linkedGames.push({
                        gameId: gw.game_id,
                        gameTitle: gw.game_title || "Unknown"
                    });
                }
            }
        }
    } catch (err) {
        logger.debug("[Wallet] Could not fetch linked games: " + err.message);
    }
    
    var wallet = {
        wallet_id: globalWalletId,
        device_id: deviceId,
        game_id: "global",
        game_title: "Global Ecosystem Wallet",  // Add descriptive title
        user_id: userId || null,
        balance: 0,
        currency: "global_coins",
        linked_games: linkedGames,  // Track which games this user plays
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    // Write wallet to storage with proper userId
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: storageUserId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[Wallet] Created global wallet with balance 0 for userId " + storageUserId);
    } catch (err) {
        logger.error("[Wallet] Failed to write global wallet: " + err.message);
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
 * @param {string} userId - Optional authenticated user ID
 * @returns {object} Updated wallet
 */
function updateGameWalletBalance(nk, logger, deviceId, gameId, newBalance, userId) {
    var collection = "quizverse";
    var key = "wallet:" + deviceId + ":" + gameId;
    var storageUserId = userId || "00000000-0000-0000-0000-000000000000";
    
    logger.info("[NAKAMA] Updating game wallet balance to " + newBalance + " (userId: " + storageUserId + ")");
    
    // Read current wallet - try with actual userId first
    var wallet;
    var foundUserId = storageUserId;
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: storageUserId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            wallet = records[0].value;
        } else if (userId && storageUserId !== "00000000-0000-0000-0000-000000000000") {
            // Try with system userId for backward compatibility
            records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
            
            if (records && records.length > 0 && records[0].value) {
                wallet = records[0].value;
                foundUserId = "00000000-0000-0000-0000-000000000000";
                logger.info("[NAKAMA] Found wallet with system userId, will migrate during update");
            }
        }
        
        if (!wallet) {
            logger.error("[NAKAMA] Wallet not found for update");
            throw new Error("Wallet not found");
        }
    } catch (err) {
        logger.error("[NAKAMA] Failed to read wallet for update: " + err.message);
        throw err;
    }
    
    // Update balance and user_id
    wallet.balance = newBalance;
    wallet.user_id = userId || wallet.user_id || null;
    wallet.updated_at = new Date().toISOString();
    
    // Write updated wallet - use actual userId if available
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: storageUserId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[NAKAMA] Updated wallet balance to " + newBalance);
        
        // If migrating from system userId, try to delete old record
        if (foundUserId !== storageUserId && foundUserId === "00000000-0000-0000-0000-000000000000") {
            try {
                nk.storageDelete([{
                    collection: collection,
                    key: key,
                    userId: foundUserId
                }]);
                logger.info("[NAKAMA] Deleted old system userId wallet record after migration");
            } catch (delErr) {
                logger.warn("[NAKAMA] Failed to delete old wallet record: " + delErr.message);
            }
        }
    } catch (err) {
        logger.error("[NAKAMA] Failed to write updated wallet: " + err.message);
        throw err;
    }
    
    return wallet;
}
