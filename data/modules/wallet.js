// wallet.js - DEPRECATED: Wrapper for backward compatibility
// All wallet operations now go through data/modules/wallet/wallet.js
// 
// This file provides backward-compatible functions that map old storage
// patterns to the new unified wallet system. 

/**
 * MIGRATION NOTES:
 * - Old system used deviceId-based keys: "wallet:{deviceId}:{gameId}"
 * - Old system used collections: "game_wallets", "global_wallets", "quizverse"
 * - Old system used single "balance" field
 * 
 * New system uses:
 * - userId-based keys: "wallet_{userId}_{gameId}"
 * - Collection: "wallets"  
 * - currencies object: { game: 0, global: 0, tokens: 0, xut: 0 }
 */

/**
 * Get or create a per-game wallet (backward compatible wrapper)
 * Maps old deviceId-based lookups to new userId-based system
 */
function getOrCreateGameWallet(nk, logger, deviceId, gameId, walletId, userId) {
    // Use the new wallet system's collection and key format
    var collection = "wallets";
    var actualUserId = userId || deviceId; // Fallback to deviceId for legacy clients
    var key = "wallet_" + actualUserId + "_" + gameId;
    
    logger.info("[Wallet-Compat] Looking for game wallet with key: " + key);
    
    // Try to read from new system first
    var wallet = null;
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: actualUserId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            wallet = records[0].value;
            logger.info("[Wallet-Compat] Found wallet in new system");
            
            // Convert new format to old format for backward compatibility
            return {
                wallet_id: walletId || wallet.userId,
                device_id: deviceId,
                game_id: gameId,
                user_id: actualUserId,
                balance: (wallet.currencies && wallet.currencies.game) || 
                         (wallet.currencies && wallet.currencies.tokens) || 0,
                currency: "coins",
                currencies: wallet.currencies || { game: 0, tokens: 0 },
                created_at: wallet.createdAt || new Date().toISOString(),
                updated_at: wallet.updatedAt || new Date().toISOString()
            };
        }
    } catch (err) {
        logger.warn("[Wallet-Compat] Error reading from new system: " + err.message);
    }
    
    // Try legacy locations for migration
    var legacyCollections = ["game_wallets", "quizverse"];
    var legacyKey = "wallet:" + deviceId + ":" + gameId;
    
    for (var i = 0; i < legacyCollections.length; i++) {
        try {
            var legacyRecords = nk.storageRead([{
                collection: legacyCollections[i],
                key: legacyKey,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
            
            if (legacyRecords && legacyRecords.length > 0 && legacyRecords[0].value) {
                var legacyWallet = legacyRecords[0].value;
                logger.info("[Wallet-Compat] Found legacy wallet in " + legacyCollections[i] + ", migrating...");
                
                // Migrate to new system
                var newWallet = {
                    userId: actualUserId,
                    gameId: gameId,
                    currencies: {
                        game: legacyWallet.balance || 0,
                        tokens: legacyWallet.balance || 0,
                        xp: 0
                    },
                    items: {},
                    createdAt: legacyWallet.created_at || new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                
                // Write to new system
                nk.storageWrite([{
                    collection: collection,
                    key: key,
                    userId: actualUserId,
                    value: newWallet,
                    permissionRead: 1,
                    permissionWrite: 0,
                    version: "*"
                }]);
                
                logger.info("[Wallet-Compat] Migrated wallet to new system");
                
                return {
                    wallet_id: walletId || actualUserId,
                    device_id: deviceId,
                    game_id: gameId,
                    user_id: actualUserId,
                    balance: newWallet.currencies.game,
                    currency: "coins",
                    currencies: newWallet.currencies,
                    created_at: newWallet.createdAt,
                    updated_at: newWallet.updatedAt
                };
            }
        } catch (err) {
            logger.debug("[Wallet-Compat] Not found in " + legacyCollections[i]);
        }
    }
    
    // Create new wallet in the new system
    logger.info("[Wallet-Compat] Creating new wallet in unified system");
    
    var newWallet = {
        userId: actualUserId,
        gameId: gameId,
        currencies: {
            game: 0,
            tokens: 0,
            xp: 0
        },
        items: {},
        consumables: {},
        cosmetics: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: actualUserId,
            value: newWallet,
            permissionRead: 1,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[Wallet-Compat] Created new wallet for user: " + actualUserId);
    } catch (err) {
        logger.error("[Wallet-Compat] Failed to create wallet: " + err.message);
        throw err;
    }
    
    return {
        wallet_id: walletId || actualUserId,
        device_id: deviceId,
        game_id: gameId,
        user_id: actualUserId,
        balance: 0,
        currency: "coins",
        currencies: newWallet.currencies,
        created_at: newWallet.createdAt,
        updated_at: newWallet.updatedAt
    };
}

/**
 * Get or create a global wallet (backward compatible wrapper)
 */
function getOrCreateGlobalWallet(nk, logger, deviceId, globalWalletId, userId) {
    var collection = "wallets";
    var actualUserId = userId || deviceId;
    var key = "global_wallet_" + actualUserId;
    
    logger.info("[Wallet-Compat] Looking for global wallet with key: " + key);
    
    // Try to read from new system
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: actualUserId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            var wallet = records[0].value;
            logger.info("[Wallet-Compat] Found global wallet in new system");
            
            return {
                wallet_id: globalWalletId || wallet.userId,
                device_id: deviceId,
                game_id: "global",
                user_id: actualUserId,
                balance: (wallet.currencies && wallet.currencies.global) ||
                         (wallet.currencies && wallet.currencies.xut) || 0,
                currency: "global_coins",
                currencies: wallet.currencies || { global: 0, xut: 0 },
                created_at: wallet.createdAt || new Date().toISOString(),
                updated_at: wallet.updatedAt || new Date().toISOString()
            };
        }
    } catch (err) {
        logger.warn("[Wallet-Compat] Error reading global wallet: " + err.message);
    }
    
    // Create new global wallet
    logger.info("[Wallet-Compat] Creating new global wallet");
    
    var newWallet = {
        userId: actualUserId,
        currencies: {
            global: 0,
            xut: 0,
            xp: 0
        },
        items: {},
        nfts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: actualUserId,
            value: newWallet,
            permissionRead: 1,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[Wallet-Compat] Created new global wallet for user: " + actualUserId);
    } catch (err) {
        logger.error("[Wallet-Compat] Failed to create global wallet: " + err.message);
        throw err;
    }
    
    return {
        wallet_id: globalWalletId || actualUserId,
        device_id: deviceId,
        game_id: "global",
        user_id: actualUserId,
        balance: 0,
        currency: "global_coins",
        currencies: newWallet.currencies,
        created_at: newWallet.createdAt,
        updated_at: newWallet.updatedAt
    };
}

/**
 * Update game wallet balance (backward compatible wrapper)
 * CRITICAL: This now increments the balance, not sets it
 */
function updateGameWalletBalance(nk, logger, deviceId, gameId, amountToAdd, userId) {
    var collection = "wallets";
    var actualUserId = userId || deviceId;
    var key = "wallet_" + actualUserId + "_" + gameId;
    
    logger.info("[Wallet-Compat] Incrementing wallet balance by " + amountToAdd);
    
    // Read current wallet
    var wallet = null;
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: actualUserId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            wallet = records[0].value;
        }
    } catch (err) {
        logger.warn("[Wallet-Compat] Error reading wallet: " + err.message);
    }
    
    if (!wallet) {
        // Get or create wallet first
        var compatWallet = getOrCreateGameWallet(nk, logger, deviceId, gameId, null, userId);
        wallet = {
            userId: actualUserId,
            gameId: gameId,
            currencies: compatWallet.currencies || { game: 0, tokens: 0 },
            createdAt: compatWallet.created_at,
            updatedAt: new Date().toISOString()
        };
    }
    
    // Ensure currencies object exists
    if (!wallet.currencies) {
        wallet.currencies = { game: 0, tokens: 0, xp: 0 };
    }
    
    // INCREMENT both game and tokens (keep them in sync)
    var oldBalance = wallet.currencies.game || wallet.currencies.tokens || 0;
    var newBalance = oldBalance + amountToAdd;
    
    wallet.currencies.game = newBalance;
    wallet.currencies.tokens = newBalance;
    wallet.updatedAt = new Date().toISOString();
    
    // Save updated wallet
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: actualUserId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[Wallet-Compat] Updated wallet: " + oldBalance + " + " + amountToAdd + " = " + newBalance);
    } catch (err) {
        logger.error("[Wallet-Compat] Failed to update wallet: " + err.message);
        throw err;
    }
    
    return {
        wallet_id: actualUserId,
        device_id: deviceId,
        game_id: gameId,
        user_id: actualUserId,
        balance: newBalance,
        currency: "coins",
        currencies: wallet.currencies,
        updated_at: wallet.updatedAt
    };
}