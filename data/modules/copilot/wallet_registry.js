// wallet_registry.js - CRUD operations for global wallet registry

/**
 * Collection name for wallet registry storage
 */
var WALLET_COLLECTION = 'wallet_registry';

/**
 * System user ID for wallet registry operations
 */
var SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Get wallet record by user ID (Cognito sub)
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Nakama logger
 * @param {string} userId - User ID (Cognito sub)
 * @returns {object|null} Wallet record or null if not found
 */
function getWalletByUserId(nk, logger, userId) {
    try {
        var records = nk.storageRead([{
            collection: WALLET_COLLECTION,
            key: userId,
            userId: SYSTEM_USER_ID
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            logger.debug('[WalletRegistry] Found wallet for user: ' + userId);
            return records[0].value;
        }
        
        logger.debug('[WalletRegistry] No wallet found for user: ' + userId);
        return null;
    } catch (err) {
        logger.error('[WalletRegistry] Error reading wallet: ' + err.message);
        throw err;
    }
}

/**
 * Create a new wallet record
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Nakama logger
 * @param {string} userId - User ID (Cognito sub)
 * @param {string} username - User's username or email
 * @returns {object} Created wallet record
 */
function createWalletRecord(nk, logger, userId, username) {
    try {
        var walletRecord = {
            walletId: userId,
            userId: userId,
            username: username,
            createdAt: new Date().toISOString(),
            gamesLinked: [],
            status: 'active'
        };
        
        nk.storageWrite([{
            collection: WALLET_COLLECTION,
            key: userId,
            userId: SYSTEM_USER_ID,
            value: walletRecord,
            permissionRead: 1,  // Public read
            permissionWrite: 0  // No public write
        }]);
        
        logger.info('[WalletRegistry] Created wallet for user: ' + userId);
        return walletRecord;
    } catch (err) {
        logger.error('[WalletRegistry] Error creating wallet: ' + err.message);
        throw err;
    }
}

/**
 * Update wallet's linked games array
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Nakama logger
 * @param {string} walletId - Wallet ID
 * @param {string} gameId - Game ID to add
 * @returns {object} Updated wallet record
 */
function updateWalletGames(nk, logger, walletId, gameId) {
    try {
        // Read existing wallet
        var wallet = getWalletByUserId(nk, logger, walletId);
        if (!wallet) {
            throw new Error('Wallet not found: ' + walletId);
        }
        
        // Add game if not already linked
        if (!wallet.gamesLinked) {
            wallet.gamesLinked = [];
        }
        
        if (wallet.gamesLinked.indexOf(gameId) === -1) {
            wallet.gamesLinked.push(gameId);
            wallet.lastUpdated = new Date().toISOString();
            
            // Write updated wallet
            nk.storageWrite([{
                collection: WALLET_COLLECTION,
                key: walletId,
                userId: SYSTEM_USER_ID,
                value: wallet,
                permissionRead: 1,
                permissionWrite: 0
            }]);
            
            logger.info('[WalletRegistry] Linked game ' + gameId + ' to wallet: ' + walletId);
        } else {
            logger.debug('[WalletRegistry] Game ' + gameId + ' already linked to wallet: ' + walletId);
        }
        
        return wallet;
    } catch (err) {
        logger.error('[WalletRegistry] Error updating wallet games: ' + err.message);
        throw err;
    }
}

/**
 * Get all wallet records (for admin/registry view)
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Nakama logger
 * @param {number} limit - Max records to return
 * @returns {array} Array of wallet records
 */
function getAllWallets(nk, logger, limit) {
    try {
        limit = limit || 100;
        
        var records = nk.storageList(SYSTEM_USER_ID, WALLET_COLLECTION, limit, null);
        
        if (!records || !records.objects) {
            return [];
        }
        
        var wallets = [];
        for (var i = 0; i < records.objects.length; i++) {
            wallets.push(records.objects[i].value);
        }
        
        logger.debug('[WalletRegistry] Retrieved ' + wallets.length + ' wallet records');
        return wallets;
    } catch (err) {
        logger.error('[WalletRegistry] Error listing wallets: ' + err.message);
        throw err;
    }
}

// Export functions for use in other modules (ES Module syntax)
export {
    getWalletByUserId,
    createWalletRecord,
    updateWalletGames,
    getAllWallets
};
