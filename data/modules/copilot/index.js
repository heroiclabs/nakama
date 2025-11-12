// copilot/index.js - Copilot Wallet Mapping Module Entry Point

/**
 * Initialize the Copilot Wallet Mapping Module
 * This function is called by the main index.js to register wallet RPC functions
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Nakama logger
 * @param {object} nk - Nakama runtime
 * @param {object} initializer - Nakama module initializer
 */
function InitCopilotModule(ctx, logger, nk, initializer) {
    logger.info('========================================');
    logger.info('Copilot Wallet Mapping Module - Initialization');
    logger.info('========================================');
    
    try {
        // Register RPC: get_user_wallet
        initializer.registerRpc('get_user_wallet', CognitoWalletMapper.getUserWallet);
        logger.info('[Copilot] Registered RPC: get_user_wallet');
        
        // Register RPC: link_wallet_to_game
        initializer.registerRpc('link_wallet_to_game', CognitoWalletMapper.linkWalletToGame);
        logger.info('[Copilot] Registered RPC: link_wallet_to_game');
        
        // Register RPC: get_wallet_registry
        initializer.registerRpc('get_wallet_registry', CognitoWalletMapper.getWalletRegistry);
        logger.info('[Copilot] Registered RPC: get_wallet_registry');
        
        logger.info('[Copilot] Successfully registered 3 wallet RPC functions');
        logger.info('[Copilot] Wallet mapping module ready for Cognito user integration');
        
    } catch (err) {
        logger.error('[Copilot] Failed to initialize wallet module: ' + err.message);
        throw err;
    }
    
    logger.info('========================================');
    logger.info('Copilot Wallet Mapping Module - Ready');
    logger.info('========================================');
}

// Export initialization function
var CopilotModule = {
    init: InitCopilotModule
};
