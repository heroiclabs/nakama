// identity.js - Device-based identity management per game
// Compatible with Nakama JavaScript runtime (no ES modules)

/**
 * Get or create identity for a device + game combination
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} deviceId - Device identifier
 * @param {string} gameId - Game UUID
 * @param {string} username - Username to assign
 * @returns {object} Identity object with wallet_id and global_wallet_id
 */
function getOrCreateIdentity(nk, logger, deviceId, gameId, username) {
    var collection = "quizverse";
    var key = "identity:" + deviceId + ":" + gameId;
    
    logger.info("[NAKAMA] Looking for identity: " + key);
    
    // Try to read existing identity
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            logger.info("[NAKAMA] Found existing identity for device " + deviceId + " game " + gameId);
            return {
                exists: true,
                identity: records[0].value
            };
        }
    } catch (err) {
        logger.warn("[NAKAMA] Failed to read identity: " + err.message);
    }
    
    // Create new identity
    logger.info("[NAKAMA] Creating new identity for device " + deviceId + " game " + gameId);
    
    // Generate wallet IDs
    var walletId = generateUUID();
    var globalWalletId = "global:" + deviceId;
    
    var identity = {
        username: username,
        device_id: deviceId,
        game_id: gameId,
        wallet_id: walletId,
        global_wallet_id: globalWalletId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    // Write identity to storage
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000",
            value: identity,
            permissionRead: 1,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[NAKAMA] Created identity with wallet_id " + walletId);
    } catch (err) {
        logger.error("[NAKAMA] Failed to write identity: " + err.message);
        throw err;
    }
    
    return {
        exists: false,
        identity: identity
    };
}

/**
 * Simple UUID v4 generator
 * @returns {string} UUID
 */
function generateUUID() {
    var d = new Date().getTime();
    var d2 = (typeof performance !== 'undefined' && performance.now && (performance.now() * 1000)) || 0;
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16;
        if (d > 0) {
            r = (d + r) % 16 | 0;
            d = Math.floor(d / 16);
        } else {
            r = (d2 + r) % 16 | 0;
            d2 = Math.floor(d2 / 16);
        }
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * Update Nakama username for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} username - New username
 */
function updateNakamaUsername(nk, logger, userId, username) {
    try {
        nk.accountUpdateId(userId, username, null, null, null, null, null);
        logger.info("[NAKAMA] Updated username to " + username + " for user " + userId);
    } catch (err) {
        logger.warn("[NAKAMA] Failed to update username: " + err.message);
    }
}
