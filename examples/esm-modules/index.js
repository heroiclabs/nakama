// index.js - Main entry point for Nakama JavaScript runtime
// ✅ This is the CORRECT ESM version

// Import RPC functions from feature modules
import { rpcWalletGetAll, rpcWalletUpdate } from './wallet/wallet.js';
import { rpcLeaderboardSubmit, rpcGetLeaderboard } from './leaderboards/leaderboards.js';
import { getCurrentTimestamp } from './utils/helper.js';

/**
 * Main initialization function called by Nakama on startup
 * 
 * CRITICAL: This MUST be exported as the default export
 * Nakama calls this function to initialize your runtime modules
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {object} initializer - Module initializer for registering RPCs
 */
export default function InitModule(ctx, logger, nk, initializer) {
    logger.info('========================================');
    logger.info('JavaScript Runtime Initialization Started');
    logger.info('Runtime: ES Modules (ESM)');
    logger.info('Timestamp: ' + getCurrentTimestamp());
    logger.info('========================================');
    
    try {
        // Register Wallet RPCs
        logger.info('[Wallet] Initializing Wallet Module...');
        initializer.registerRpc('wallet_get_all', rpcWalletGetAll);
        logger.info('[Wallet] ✅ Registered RPC: wallet_get_all');
        
        initializer.registerRpc('wallet_update', rpcWalletUpdate);
        logger.info('[Wallet] ✅ Registered RPC: wallet_update');
        
        // Register Leaderboard RPCs
        logger.info('[Leaderboards] Initializing Leaderboard Module...');
        initializer.registerRpc('leaderboard_submit', rpcLeaderboardSubmit);
        logger.info('[Leaderboards] ✅ Registered RPC: leaderboard_submit');
        
        initializer.registerRpc('leaderboard_get', rpcGetLeaderboard);
        logger.info('[Leaderboards] ✅ Registered RPC: leaderboard_get');
        
        logger.info('========================================');
        logger.info('✅ Successfully registered 4 RPC functions');
        logger.info('   - 2 Wallet RPCs');
        logger.info('   - 2 Leaderboard RPCs');
        logger.info('========================================');
        logger.info('🎉 JavaScript Runtime Initialization Complete');
        logger.info('========================================');
    } catch (err) {
        logger.error('========================================');
        logger.error('❌ Initialization FAILED');
        logger.error('Error: ' + err.message);
        logger.error('Stack: ' + err.stack);
        logger.error('========================================');
        throw err;
    }
}

// Note: This file demonstrates the CORRECT way to structure
// your Nakama JavaScript runtime entry point using ES modules.
// 
// Key points:
// 1. ✅ Use 'import' statements, NOT 'require()'
// 2. ✅ Export InitModule as default: 'export default function InitModule'
// 3. ✅ Include .js extension in all import paths
// 4. ✅ Use relative paths (./module.js or ../module.js)
// 5. ✅ Comprehensive error handling and logging
