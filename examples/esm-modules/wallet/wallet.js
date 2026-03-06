// wallet/wallet.js - Wallet system with ESM exports
// ✅ This is the CORRECT ESM version

// Import utilities from other modules
import { formatCurrency, getCurrentTimestamp, validateAmount } from '../utils/helper.js';
import { WALLET_COLLECTION, CURRENCIES } from '../utils/constants.js';

/**
 * RPC: Get all wallets for a user
 * 
 * @param {object} ctx - Nakama context with userId, username, etc.
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON string from client (can be empty)
 * @returns {string} JSON response
 */
export function rpcWalletGetAll(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    
    logger.info('[Wallet] Getting wallet for user: ' + userId);
    
    try {
        // Read wallet from storage
        const records = nk.storageRead([{
            collection: WALLET_COLLECTION,
            key: 'user_wallet',
            userId: userId
        }]);
        
        if (records && records.length > 0) {
            const wallet = records[0].value;
            logger.info('[Wallet] Found existing wallet for user: ' + userId);
            
            return JSON.stringify({
                success: true,
                wallet: wallet,
                formatted: {
                    xut: formatCurrency(wallet.currencies.xut),
                    xp: formatCurrency(wallet.currencies.xp)
                }
            });
        }
        
        // Return empty wallet if not found
        logger.info('[Wallet] Creating new wallet for user: ' + userId);
        
        const newWallet = {
            userId: userId,
            currencies: {
                xut: 0,
                xp: 0
            },
            createdAt: getCurrentTimestamp()
        };
        
        // Save new wallet
        nk.storageWrite([{
            collection: WALLET_COLLECTION,
            key: 'user_wallet',
            userId: userId,
            value: newWallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        return JSON.stringify({
            success: true,
            wallet: newWallet,
            formatted: {
                xut: formatCurrency(0),
                xp: formatCurrency(0)
            }
        });
    } catch (err) {
        logger.error('[Wallet] Failed to get wallet: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: Update wallet currencies
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON: { xut: number, xp: number }
 * @returns {string} JSON response
 */
export function rpcWalletUpdate(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    
    logger.info('[Wallet] Updating wallet for user: ' + userId);
    
    try {
        // Parse and validate input
        const data = JSON.parse(payload || '{}');
        
        if (!data.xut && !data.xp) {
            return JSON.stringify({
                success: false,
                error: 'Must provide xut or xp to update'
            });
        }
        
        // Validate amounts
        if (data.xut && !validateAmount(data.xut)) {
            return JSON.stringify({
                success: false,
                error: 'Invalid xut amount'
            });
        }
        
        if (data.xp && !validateAmount(data.xp)) {
            return JSON.stringify({
                success: false,
                error: 'Invalid xp amount'
            });
        }
        
        // Get current wallet
        const currentRecords = nk.storageRead([{
            collection: WALLET_COLLECTION,
            key: 'user_wallet',
            userId: userId
        }]);
        
        let currentWallet = {
            userId: userId,
            currencies: { xut: 0, xp: 0 },
            createdAt: getCurrentTimestamp()
        };
        
        if (currentRecords && currentRecords.length > 0) {
            currentWallet = currentRecords[0].value;
        }
        
        // Update currencies (additive)
        const updatedWallet = {
            userId: userId,
            currencies: {
                xut: currentWallet.currencies.xut + (data.xut || 0),
                xp: currentWallet.currencies.xp + (data.xp || 0)
            },
            createdAt: currentWallet.createdAt,
            updatedAt: getCurrentTimestamp()
        };
        
        // Ensure non-negative values
        updatedWallet.currencies.xut = Math.max(0, updatedWallet.currencies.xut);
        updatedWallet.currencies.xp = Math.max(0, updatedWallet.currencies.xp);
        
        // Save updated wallet
        nk.storageWrite([{
            collection: WALLET_COLLECTION,
            key: 'user_wallet',
            userId: userId,
            value: updatedWallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info('[Wallet] Updated wallet - XUT: ' + updatedWallet.currencies.xut + ', XP: ' + updatedWallet.currencies.xp);
        
        return JSON.stringify({
            success: true,
            wallet: updatedWallet,
            delta: {
                xut: data.xut || 0,
                xp: data.xp || 0
            }
        });
    } catch (err) {
        logger.error('[Wallet] Failed to update wallet: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// Note: This file demonstrates the CORRECT way to export RPC functions
// using ES modules.
// 
// Key points:
// 1. ✅ Use 'export function' for each RPC
// 2. ✅ Import utilities with 'import { ... } from ...'
// 3. ✅ Always include .js extension in import paths
// 4. ✅ Each function is exported individually (named exports)
// 5. ✅ No 'module.exports' or 'require()' - those are CommonJS!
