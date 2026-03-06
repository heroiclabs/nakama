// player_rpcs.js - Player-specific RPC implementations
// These RPCs provide standard naming conventions for common player operations

/**
 * RPC: create_player_wallet
 * Creates a wallet for a player (both game-specific and global wallets)
 * 
 * @param {object} ctx - Nakama context with userId, username, etc.
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON: { device_id: string, game_id: string, username?: string }
 * @returns {string} JSON response with wallet information
 * 
 * Example payload:
 * {
 *   "device_id": "unique-device-id",
 *   "game_id": "game-uuid",
 *   "username": "PlayerName"
 * }
 * 
 * Example response:
 * {
 *   "success": true,
 *   "wallet_id": "uuid",
 *   "global_wallet_id": "uuid",
 *   "game_wallet": { "balance": 0, "currency": "coins" },
 *   "global_wallet": { "balance": 0, "currency": "global_coins" }
 * }
 */
function rpcCreatePlayerWallet(ctx, logger, nk, payload) {
    logger.info('[RPC] create_player_wallet called');
    
    try {
        // Parse input
        var data = JSON.parse(payload || '{}');
        
        if (!data.device_id || !data.game_id) {
            return JSON.stringify({
                success: false,
                error: 'device_id and game_id are required'
            });
        }
        
        var deviceId = data.device_id;
        var gameId = data.game_id;
        var username = data.username || ctx.username || 'Player';
        
        // Create or sync user identity first
        var identityPayload = JSON.stringify({
            username: username,
            device_id: deviceId,
            game_id: gameId
        });
        
        var identityResult = nk.rpc(ctx, 'create_or_sync_user', identityPayload);
        var identity = JSON.parse(identityResult);
        
        if (!identity.success) {
            return JSON.stringify({
                success: false,
                error: 'Failed to create/sync user identity: ' + (identity.error || 'Unknown error')
            });
        }
        
        // Create or get wallets
        var walletPayload = JSON.stringify({
            device_id: deviceId,
            game_id: gameId
        });
        
        var walletResult = nk.rpc(ctx, 'create_or_get_wallet', walletPayload);
        var wallets = JSON.parse(walletResult);
        
        if (!wallets.success) {
            return JSON.stringify({
                success: false,
                error: 'Failed to create/get wallets: ' + (wallets.error || 'Unknown error')
            });
        }
        
        logger.info('[RPC] create_player_wallet - Successfully created wallet for device: ' + deviceId);
        
        return JSON.stringify({
            success: true,
            wallet_id: identity.wallet_id,
            global_wallet_id: identity.global_wallet_id,
            game_wallet: wallets.game_wallet,
            global_wallet: wallets.global_wallet,
            message: 'Player wallet created successfully'
        });
        
    } catch (err) {
        logger.error('[RPC] create_player_wallet - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: update_wallet_balance
 * Updates a player's wallet balance
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON: { device_id: string, game_id: string, balance: number, wallet_type?: "game"|"global" }
 * @returns {string} JSON response
 * 
 * Example payload:
 * {
 *   "device_id": "unique-device-id",
 *   "game_id": "game-uuid",
 *   "balance": 1500,
 *   "wallet_type": "game"  // Optional: "game" or "global", defaults to "game"
 * }
 * 
 * Example response:
 * {
 *   "success": true,
 *   "wallet": { "balance": 1500, "currency": "coins", "updated_at": "2024-01-01T00:00:00Z" }
 * }
 */
function rpcUpdateWalletBalance(ctx, logger, nk, payload) {
    logger.info('[RPC] update_wallet_balance called');
    
    try {
        // Parse input
        var data = JSON.parse(payload || '{}');
        
        if (!data.device_id || !data.game_id) {
            return JSON.stringify({
                success: false,
                error: 'device_id and game_id are required'
            });
        }
        
        if (data.balance === undefined || data.balance === null) {
            return JSON.stringify({
                success: false,
                error: 'balance is required'
            });
        }
        
        var deviceId = data.device_id;
        var gameId = data.game_id;
        var balance = Number(data.balance);
        var walletType = data.wallet_type || 'game';
        
        if (isNaN(balance) || balance < 0) {
            return JSON.stringify({
                success: false,
                error: 'balance must be a non-negative number'
            });
        }
        
        // Determine which RPC to call based on wallet type
        var rpcName = walletType === 'global' ? 'wallet_update_global' : 'wallet_update_game_wallet';
        
        var updatePayload = JSON.stringify({
            device_id: deviceId,
            game_id: gameId,
            balance: balance
        });
        
        var result = nk.rpc(ctx, rpcName, updatePayload);
        var wallet = JSON.parse(result);
        
        if (!wallet.success) {
            return JSON.stringify({
                success: false,
                error: 'Failed to update wallet: ' + (wallet.error || 'Unknown error')
            });
        }
        
        logger.info('[RPC] update_wallet_balance - Updated ' + walletType + ' wallet to balance: ' + balance);
        
        return JSON.stringify({
            success: true,
            wallet: wallet.wallet || wallet,
            wallet_type: walletType,
            message: 'Wallet balance updated successfully'
        });
        
    } catch (err) {
        logger.error('[RPC] update_wallet_balance - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: get_wallet_balance
 * Gets a player's wallet balance
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON: { device_id: string, game_id: string }
 * @returns {string} JSON response
 * 
 * Example payload:
 * {
 *   "device_id": "unique-device-id",
 *   "game_id": "game-uuid"
 * }
 * 
 * Example response:
 * {
 *   "success": true,
 *   "game_wallet": { "balance": 1500, "currency": "coins" },
 *   "global_wallet": { "balance": 3000, "currency": "global_coins" }
 * }
 */
function rpcGetWalletBalance(ctx, logger, nk, payload) {
    logger.info('[RPC] get_wallet_balance called');
    
    try {
        // Parse input
        var data = JSON.parse(payload || '{}');
        
        if (!data.device_id || !data.game_id) {
            return JSON.stringify({
                success: false,
                error: 'device_id and game_id are required'
            });
        }
        
        var deviceId = data.device_id;
        var gameId = data.game_id;
        
        // Get wallets using existing RPC
        var walletPayload = JSON.stringify({
            device_id: deviceId,
            game_id: gameId
        });
        
        var result = nk.rpc(ctx, 'create_or_get_wallet', walletPayload);
        var wallets = JSON.parse(result);
        
        if (!wallets.success) {
            return JSON.stringify({
                success: false,
                error: 'Failed to get wallet: ' + (wallets.error || 'Unknown error')
            });
        }
        
        logger.info('[RPC] get_wallet_balance - Retrieved wallets for device: ' + deviceId);
        
        return JSON.stringify({
            success: true,
            game_wallet: wallets.game_wallet,
            global_wallet: wallets.global_wallet,
            device_id: deviceId,
            game_id: gameId
        });
        
    } catch (err) {
        logger.error('[RPC] get_wallet_balance - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: submit_leaderboard_score
 * Submits a score to leaderboards (submits to all time-period leaderboards)
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON: { device_id: string, game_id: string, score: number, metadata?: object }
 * @returns {string} JSON response
 * 
 * Example payload:
 * {
 *   "device_id": "unique-device-id",
 *   "game_id": "game-uuid",
 *   "score": 1500,
 *   "metadata": { "level": 5, "time": 120 }
 * }
 * 
 * Example response:
 * {
 *   "success": true,
 *   "leaderboards_updated": ["leaderboard_game_id", "leaderboard_game_id_daily", ...],
 *   "score": 1500,
 *   "wallet_updated": true
 * }
 */
function rpcSubmitLeaderboardScore(ctx, logger, nk, payload) {
    logger.info('[RPC] submit_leaderboard_score called');
    
    try {
        // Parse input
        var data = JSON.parse(payload || '{}');
        
        if (!data.device_id || !data.game_id) {
            return JSON.stringify({
                success: false,
                error: 'device_id and game_id are required'
            });
        }
        
        if (data.score === undefined || data.score === null) {
            return JSON.stringify({
                success: false,
                error: 'score is required'
            });
        }
        
        var deviceId = data.device_id;
        var gameId = data.game_id;
        var score = Number(data.score);
        
        if (isNaN(score)) {
            return JSON.stringify({
                success: false,
                error: 'score must be a number'
            });
        }
        
        // Submit score using the comprehensive score sync RPC
        var scorePayload = JSON.stringify({
            device_id: deviceId,
            game_id: gameId,
            score: score,
            metadata: data.metadata || {}
        });
        
        var result = nk.rpc(ctx, 'submit_score_and_sync', scorePayload);
        var scoreResult = JSON.parse(result);
        
        if (!scoreResult.success) {
            return JSON.stringify({
                success: false,
                error: 'Failed to submit score: ' + (scoreResult.error || 'Unknown error')
            });
        }
        
        logger.info('[RPC] submit_leaderboard_score - Submitted score ' + score + ' for device: ' + deviceId);
        
        return JSON.stringify({
            success: true,
            leaderboards_updated: scoreResult.leaderboards_updated || [],
            score: score,
            wallet_updated: scoreResult.wallet_updated || false,
            message: 'Score submitted successfully to all leaderboards'
        });
        
    } catch (err) {
        logger.error('[RPC] submit_leaderboard_score - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: get_leaderboard
 * Gets leaderboard records for a specific game
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON: { game_id: string, period?: string, limit?: number, cursor?: string }
 * @returns {string} JSON response
 * 
 * Example payload:
 * {
 *   "game_id": "game-uuid",
 *   "period": "daily",  // Optional: "daily", "weekly", "monthly", "alltime", or leave empty for main
 *   "limit": 10,        // Optional: default 10, max 100
 *   "cursor": ""        // Optional: for pagination
 * }
 * 
 * Example response:
 * {
 *   "success": true,
 *   "leaderboard_id": "leaderboard_game_uuid_daily",
 *   "records": [
 *     { "rank": 1, "user_id": "...", "score": 1500, "username": "Player1" },
 *     ...
 *   ],
 *   "next_cursor": "...",
 *   "prev_cursor": "..."
 * }
 */
function rpcGetLeaderboard(ctx, logger, nk, payload) {
    logger.info('[RPC] get_leaderboard called');
    
    try {
        // Parse input
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id) {
            return JSON.stringify({
                success: false,
                error: 'game_id is required'
            });
        }
        
        var gameId = data.game_id;
        var period = data.period || '';  // empty string = main leaderboard
        var limit = data.limit || 10;
        var cursor = data.cursor || '';
        
        // Validate limit
        if (limit < 1 || limit > 100) {
            return JSON.stringify({
                success: false,
                error: 'limit must be between 1 and 100'
            });
        }
        
        // Get leaderboard using existing RPC
        var leaderboardPayload = JSON.stringify({
            gameId: gameId,
            period: period,
            limit: limit,
            cursor: cursor
        });
        
        var result = nk.rpc(ctx, 'get_time_period_leaderboard', leaderboardPayload);
        var leaderboard = JSON.parse(result);
        
        if (!leaderboard.success) {
            return JSON.stringify({
                success: false,
                error: 'Failed to get leaderboard: ' + (leaderboard.error || 'Unknown error')
            });
        }
        
        logger.info('[RPC] get_leaderboard - Retrieved ' + period + ' leaderboard for game: ' + gameId);
        
        return JSON.stringify({
            success: true,
            leaderboard_id: leaderboard.leaderboard_id,
            records: leaderboard.records || [],
            next_cursor: leaderboard.next_cursor || '',
            prev_cursor: leaderboard.prev_cursor || '',
            period: period || 'main',
            game_id: gameId
        });
        
    } catch (err) {
        logger.error('[RPC] get_leaderboard - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// Export functions for registration
// These will be registered in the main index.js
