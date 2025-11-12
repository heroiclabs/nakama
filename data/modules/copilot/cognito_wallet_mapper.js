// cognito_wallet_mapper.js - Core RPC functions for Cognito ↔ Wallet mapping

/**
 * RPC: get_user_wallet
 * Retrieves or creates a wallet for a Cognito user
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Nakama logger
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON string with { "token": "<cognito_jwt>" }
 * @returns {string} JSON response with wallet info
 */
function getUserWallet(ctx, logger, nk, payload) {
    try {
        WalletUtils.logWalletOperation(logger, 'get_user_wallet', { payload: payload });
        
        // Parse input
        var input = {};
        if (payload) {
            try {
                input = JSON.parse(payload);
            } catch (err) {
                return JSON.stringify({
                    success: false,
                    error: 'Invalid JSON payload'
                });
            }
        }
        
        var token = input.token;
        
        // If no token provided, try to use ctx.userId (for authenticated Nakama users)
        var userId;
        var username;
        
        if (token) {
            // Validate JWT structure
            if (!WalletUtils.validateJWTStructure(token)) {
                return JSON.stringify({
                    success: false,
                    error: 'Invalid JWT token format'
                });
            }
            
            // Extract user info from Cognito JWT
            var userInfo = WalletUtils.extractUserInfo(token);
            userId = userInfo.sub;
            username = userInfo.username;
            
            WalletUtils.logWalletOperation(logger, 'extracted_user_info', {
                userId: userId,
                username: username
            });
        } else if (ctx.userId) {
            // Fallback to Nakama context user
            userId = ctx.userId;
            username = ctx.username || userId;
            
            WalletUtils.logWalletOperation(logger, 'using_context_user', {
                userId: userId,
                username: username
            });
        } else {
            return JSON.stringify({
                success: false,
                error: 'No token provided and no authenticated user in context'
            });
        }
        
        // Query wallet registry
        var wallet = WalletRegistry.getWalletByUserId(nk, logger, userId);
        
        // Create wallet if not found
        if (!wallet) {
            wallet = WalletRegistry.createWalletRecord(nk, logger, userId, username);
            WalletUtils.logWalletOperation(logger, 'wallet_created', {
                walletId: wallet.walletId
            });
        } else {
            WalletUtils.logWalletOperation(logger, 'wallet_found', {
                walletId: wallet.walletId,
                gamesLinked: wallet.gamesLinked
            });
        }
        
        // Return wallet info
        return JSON.stringify({
            success: true,
            walletId: wallet.walletId,
            userId: wallet.userId,
            status: wallet.status,
            gamesLinked: wallet.gamesLinked || [],
            createdAt: wallet.createdAt
        });
        
    } catch (err) {
        return JSON.stringify(WalletUtils.handleWalletError(logger, 'get_user_wallet', err));
    }
}

/**
 * RPC: link_wallet_to_game
 * Links a wallet to a specific game
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Nakama logger
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON string with { "token": "<cognito_jwt>", "gameId": "<game_id>" }
 * @returns {string} JSON response with updated wallet info
 */
function linkWalletToGame(ctx, logger, nk, payload) {
    try {
        WalletUtils.logWalletOperation(logger, 'link_wallet_to_game', { payload: payload });
        
        // Parse input
        var input = {};
        if (payload) {
            try {
                input = JSON.parse(payload);
            } catch (err) {
                return JSON.stringify({
                    success: false,
                    error: 'Invalid JSON payload'
                });
            }
        }
        
        var token = input.token;
        var gameId = input.gameId;
        
        if (!gameId) {
            return JSON.stringify({
                success: false,
                error: 'gameId is required'
            });
        }
        
        // Get user ID from token or context
        var userId;
        var username;
        
        if (token) {
            if (!WalletUtils.validateJWTStructure(token)) {
                return JSON.stringify({
                    success: false,
                    error: 'Invalid JWT token format'
                });
            }
            
            var userInfo = WalletUtils.extractUserInfo(token);
            userId = userInfo.sub;
            username = userInfo.username;
        } else if (ctx.userId) {
            userId = ctx.userId;
            username = ctx.username || userId;
        } else {
            return JSON.stringify({
                success: false,
                error: 'No token provided and no authenticated user in context'
            });
        }
        
        // Ensure wallet exists
        var wallet = WalletRegistry.getWalletByUserId(nk, logger, userId);
        if (!wallet) {
            wallet = WalletRegistry.createWalletRecord(nk, logger, userId, username);
        }
        
        // Link game to wallet
        wallet = WalletRegistry.updateWalletGames(nk, logger, wallet.walletId, gameId);
        
        WalletUtils.logWalletOperation(logger, 'game_linked', {
            walletId: wallet.walletId,
            gameId: gameId,
            totalGames: wallet.gamesLinked.length
        });
        
        return JSON.stringify({
            success: true,
            walletId: wallet.walletId,
            gameId: gameId,
            gamesLinked: wallet.gamesLinked,
            message: 'Game successfully linked to wallet'
        });
        
    } catch (err) {
        return JSON.stringify(WalletUtils.handleWalletError(logger, 'link_wallet_to_game', err));
    }
}

/**
 * RPC: get_wallet_registry
 * Returns all wallets in the registry (admin function)
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Nakama logger
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON string with optional { "limit": 100 }
 * @returns {string} JSON response with wallet array
 */
function getWalletRegistry(ctx, logger, nk, payload) {
    try {
        WalletUtils.logWalletOperation(logger, 'get_wallet_registry', { userId: ctx.userId });
        
        // Parse input
        var input = {};
        if (payload) {
            try {
                input = JSON.parse(payload);
            } catch (err) {
                // Ignore parse errors for optional payload
            }
        }
        
        var limit = input.limit || 100;
        
        // Get all wallets
        var wallets = WalletRegistry.getAllWallets(nk, logger, limit);
        
        return JSON.stringify({
            success: true,
            wallets: wallets,
            count: wallets.length
        });
        
    } catch (err) {
        return JSON.stringify(WalletUtils.handleWalletError(logger, 'get_wallet_registry', err));
    }
}

// Export RPC functions
var CognitoWalletMapper = {
    getUserWallet: getUserWallet,
    linkWalletToGame: linkWalletToGame,
    getWalletRegistry: getWalletRegistry
};
