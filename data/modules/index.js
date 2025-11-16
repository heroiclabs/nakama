// Nakama Runtime Module - Consolidated
// Compatible with Nakama V8 JavaScript runtime (No ES Modules)
// All import/export statements have been removed


// ============================================================================
// COPILOT/UTILS.JS
// ============================================================================

// js - Shared helper functions for leaderboard modules

/**
 * Validate that required fields are present in payload
 * @param {object} payload - The payload object to validate
 * @param {string[]} fields - Array of required field names
 * @returns {object} { valid: boolean, missing: string[] }
 */
function validatePayload(payload, fields) {
    const missing = [];
    for (let i = 0; i < fields.length; i++) {
        if (!payload.hasOwnProperty(fields[i]) || payload[fields[i]] === null || payload[fields[i]] === undefined) {
            missing.push(fields[i]);
        }
    }
    return {
        valid: missing.length === 0,
        missing: missing
    };
}

/**
 * Read the leaderboards registry from storage
 * @param {object} nk - Nakama runtime context
 * @param {object} logger - Logger instance
 * @returns {Array} Array of leaderboard records
 */
function readRegistry(nk, logger) {
    const collection = "leaderboards_registry";
    try {
        const records = nk.storageRead([{
            collection: collection,
            key: "all_created",
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logger.warn("Failed to read leaderboards registry: " + err.message);
    }
    return [];
}

/**
 * Safely parse JSON string
 * @param {string} payload - JSON string to parse
 * @returns {object} { success: boolean, data: object|null, error: string|null }
 */
function safeJsonParse(payload) {
    try {
        const data = JSON.parse(payload);
        return { success: true, data: data, error: null };
    } catch (err) {
        return { success: false, data: null, error: err.message };
    }
}

/**
 * Handle error and return standardized error response
 * @param {object} ctx - Request context
 * @param {Error} err - Error object
 * @param {string} message - User-friendly error message
 * @returns {string} JSON error response
 */
function handleError(ctx, err, message) {
    return JSON.stringify({
        success: false,
        error: message
    });
}

/**
 * Log info message
 * @param {object} logger - Logger instance
 * @param {string} msg - Message to log
 */
function logInfo(logger, msg) {
    logger.info("[Copilot] " + msg);
}

/**
 * Log warning message
 * @param {object} logger - Logger instance
 * @param {string} msg - Message to log
 */
function logWarn(logger, msg) {
    logger.warn("[Copilot] " + msg);
}

/**
 * Log error message
 * @param {object} logger - Logger instance
 * @param {string} msg - Message to log
 */
function logError(logger, msg) {
    logger.error("[Copilot] " + msg);
}

/**
 * Validate UUID format (RFC 4122)
 * @param {string} uuid - UUID string to validate
 * @returns {boolean} True if valid UUID format
 */
function isValidUUID(uuid) {
    if (!uuid || typeof uuid !== 'string') {
        return false;
    }
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    return uuidRegex.test(uuid);
}

/**
 * Get current timestamp in ISO 8601 format
 * @returns {string} ISO timestamp
 */
function getCurrentTimestamp() {
    return new Date().toISOString();
}

/**
 * Get Unix timestamp in seconds
 * @returns {number} Unix timestamp
 */
function getUnixTimestamp() {
    return Math.floor(Date.now() / 1000);
}

/**
 * Check if two timestamps are within specified hours
 * @param {number} timestamp1 - First Unix timestamp (seconds)
 * @param {number} timestamp2 - Second Unix timestamp (seconds)
 * @param {number} hours - Maximum hours difference
 * @returns {boolean} True if within hours
 */
function isWithinHours(timestamp1, timestamp2, hours) {
    const diffSeconds = Math.abs(timestamp1 - timestamp2);
    const maxSeconds = hours * 3600;
    return diffSeconds <= maxSeconds;
}

/**
 * Get start of day timestamp for a given date
 * @param {Date} [date] - Optional date, defaults to now
 * @returns {number} Unix timestamp at start of day
 */
function getStartOfDay(date) {
    const d = date || new Date();
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
}

/**
 * Generate storage key with userId and gameId
 * @param {string} prefix - Key prefix (e.g., 'wallet', 'mission_progress')
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @returns {string} Formatted storage key
 */
function makeGameStorageKey(prefix, userId, gameId) {
    return prefix + "_" + userId + "_" + gameId;
}

/**
 * Generate global storage key with userId only
 * @param {string} prefix - Key prefix (e.g., 'global_wallet')
 * @param {string} userId - User ID
 * @returns {string} Formatted storage key
 */
function makeGlobalStorageKey(prefix, userId) {
    return prefix + "_" + userId;
}

/**
 * Read from storage with error handling
 * @param {object} nk - Nakama runtime context
 * @param {object} logger - Logger instance
 * @param {string} collection - Collection name
 * @param {string} key - Storage key
 * @param {string} userId - User ID
 * @returns {object|null} Storage value or null if not found
 */
function readStorage(nk, logger, collection, key, userId) {
    try {
        const records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logWarn(logger, "Failed to read storage [" + collection + ":" + key + "]: " + err.message);
    }
    return null;
}

/**
 * Write to storage with error handling
 * @param {object} nk - Nakama runtime context
 * @param {object} logger - Logger instance
 * @param {string} collection - Collection name
 * @param {string} key - Storage key
 * @param {string} userId - User ID
 * @param {object} value - Value to store
 * @param {number} [permissionRead=1] - Read permission (default: 1 = owner read)
 * @param {number} [permissionWrite=0] - Write permission (default: 0 = owner write)
 * @returns {boolean} True if successful
 */
function writeStorage(nk, logger, collection, key, userId, value, permissionRead, permissionWrite) {
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: value,
            permissionRead: permissionRead !== undefined ? permissionRead : 1,
            permissionWrite: permissionWrite !== undefined ? permissionWrite : 0
        }]);
        return true;
    } catch (err) {
        logError(logger, "Failed to write storage [" + collection + ":" + key + "]: " + err.message);
        return false;
    }
}

// Export functions for use in other modules (ES Module syntax)

// ============================================================================
// COPILOT/WALLET_UTILS.JS
// ============================================================================

// wallet_js - Helper utilities for Cognito JWT handling and validation

/**
 * Decode a JWT token (simplified - extracts payload without verification)
 * In production, use proper JWT verification with Cognito public keys
 * @param {string} token - JWT token string
 * @returns {object} Decoded token payload
 */
function decodeJWT(token) {
    try {
        // JWT structure: header.payload.signature
        const parts = token.split('.');
        if (parts.length !== 3) {
            throw new Error('Invalid JWT format');
        }
        
        // Decode base64url payload
        const payload = parts[1];
        // Replace base64url chars with base64 standard
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        // Add padding if needed
        const padded = base64 + '=='.substring(0, (4 - base64.length % 4) % 4);
        
        // Decode base64 and parse JSON
        const decoded = JSON.parse(atob(padded));
        return decoded;
    } catch (err) {
        throw new Error('Failed to decode JWT: ' + err.message);
    }
}

/**
 * Extract Cognito user info from JWT token
 * @param {string} token - Cognito JWT token
 * @returns {object} User info with sub and email
 */
function extractUserInfo(token) {
    const decoded = decodeJWT(token);
    
    // Validate required fields
    if (!decoded.sub) {
        throw new Error('JWT missing required "sub" claim');
    }
    
    return {
        sub: decoded.sub,
        email: decoded.email || decoded['cognito:username'] || 'unknown@example.com',
        username: decoded['cognito:username'] || decoded.email || decoded.sub
    };
}

/**
 * Validate JWT token structure
 * @param {string} token - JWT token to validate
 * @returns {boolean} True if valid structure
 */
function validateJWTStructure(token) {
    if (!token || typeof token !== 'string') {
        return false;
    }
    
    const parts = token.split('.');
    return parts.length === 3;
}

/**
 * Generate a wallet ID from Cognito sub
 * @param {string} cognitoSub - Cognito user sub (UUID)
 * @returns {string} Wallet ID (same as sub for one-to-one mapping)
 */
function generateWalletId(cognitoSub) {
    // Wallet ID is the same as Cognito sub for one-to-one mapping
    return cognitoSub;
}

/**
 * Log wallet operation with context
 * @param {object} logger - Nakama logger
 * @param {string} operation - Operation name
 * @param {object} details - Additional details to log
 */
function logWalletOperation(logger, operation, details) {
    logger.info('[Wallet] ' + operation + ': ' + JSON.stringify(details));
}

/**
 * Error handler for wallet operations
 * @param {object} logger - Nakama logger
 * @param {string} operation - Operation that failed
 * @param {Error} error - Error object
 * @returns {object} Standardized error response
 */
function handleWalletError(logger, operation, error) {
    const errorMsg = error.message || String(error);
    logger.error('[Wallet Error] ' + operation + ': ' + errorMsg);
    
    return {
        success: false,
        error: errorMsg,
        operation: operation
    };
}

// Export functions for use in other modules (ES Module syntax)

// ============================================================================
// COPILOT/WALLET_REGISTRY.JS
// ============================================================================

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

// ============================================================================
// COPILOT/COGNITO_WALLET_MAPPER.JS
// ============================================================================

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
        logWalletOperation(logger, 'get_user_wallet', { payload: payload });
        
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
            if (!validateJWTStructure(token)) {
                return JSON.stringify({
                    success: false,
                    error: 'Invalid JWT token format'
                });
            }
            
            // Extract user info from Cognito JWT
            var userInfo = extractUserInfo(token);
            userId = userInfo.sub;
            username = userInfo.username;
            
            logWalletOperation(logger, 'extracted_user_info', {
                userId: userId,
                username: username
            });
        } else if (ctx.userId) {
            // Fallback to Nakama context user
            userId = ctx.userId;
            username = ctx.username || userId;
            
            logWalletOperation(logger, 'using_context_user', {
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
        var wallet = getWalletByUserId(nk, logger, userId);
        
        // Create wallet if not found
        if (!wallet) {
            wallet = createWalletRecord(nk, logger, userId, username);
            logWalletOperation(logger, 'wallet_created', {
                walletId: wallet.walletId
            });
        } else {
            logWalletOperation(logger, 'wallet_found', {
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
        return JSON.stringify(handleWalletError(logger, 'get_user_wallet', err));
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
        logWalletOperation(logger, 'link_wallet_to_game', { payload: payload });
        
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
            if (!validateJWTStructure(token)) {
                return JSON.stringify({
                    success: false,
                    error: 'Invalid JWT token format'
                });
            }
            
            var userInfo = extractUserInfo(token);
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
        var wallet = getWalletByUserId(nk, logger, userId);
        if (!wallet) {
            wallet = createWalletRecord(nk, logger, userId, username);
        }
        
        // Link game to wallet
        wallet = updateWalletGames(nk, logger, wallet.walletId, gameId);
        
        logWalletOperation(logger, 'game_linked', {
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
        return JSON.stringify(handleWalletError(logger, 'link_wallet_to_game', err));
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
        logWalletOperation(logger, 'get_wallet_registry', { userId: ctx.userId });
        
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
        var wallets = getAllWallets(nk, logger, limit);
        
        return JSON.stringify({
            success: true,
            wallets: wallets,
            count: wallets.length
        });
        
    } catch (err) {
        return JSON.stringify(handleWalletError(logger, 'get_wallet_registry', err));
    }
}

// Export RPC functions (ES Module syntax)

// ============================================================================
// COPILOT/LEADERBOARD_SYNC.JS
// ============================================================================

// leaderboard_sync.js - Base score synchronization between per-game and global leaderboards

// Import utils

/**
 * RPC: submit_score_sync
 * Synchronizes score between per-game and global leaderboards
 */
function submitScoreSync(ctx, logger, nk, payload) {
    try {
        // Validate authentication
        if (!ctx.userId) {
            return handleError(ctx, null, "Authentication required");
        }

        // Parse and validate payload
        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = validatePayload(data, ['gameId', 'score']);
        if (!validation.valid) {
            return handleError(ctx, null, "Missing required fields: " + validation.missing.join(', '));
        }

        const gameId = data.gameId;
        const score = parseInt(data.score);
        
        if (isNaN(score)) {
            return handleError(ctx, null, "Score must be a valid number");
        }

        const userId = ctx.userId;
        const username = ctx.username || userId;
        const submittedAt = new Date().toISOString();

        // Create metadata
        const metadata = {
            source: "submit_score_sync",
            gameId: gameId,
            submittedAt: submittedAt
        };

        const gameLeaderboardId = "leaderboard_" + gameId;
        const globalLeaderboardId = "leaderboard_global";

        logInfo(logger, "Submitting score: " + score + " for user " + username + " to game " + gameId);

        // Write to per-game leaderboard
        try {
            nk.leaderboardRecordWrite(
                gameLeaderboardId,
                userId,
                username,
                score,
                0, // subscore
                metadata
            );
            logInfo(logger, "Score written to game leaderboard: " + gameLeaderboardId);
        } catch (err) {
            logError(logger, "Failed to write to game leaderboard: " + err.message);
            return handleError(ctx, err, "Failed to write score to game leaderboard");
        }

        // Write to global leaderboard
        try {
            nk.leaderboardRecordWrite(
                globalLeaderboardId,
                userId,
                username,
                score,
                0, // subscore
                metadata
            );
            logInfo(logger, "Score written to global leaderboard: " + globalLeaderboardId);
        } catch (err) {
            logError(logger, "Failed to write to global leaderboard: " + err.message);
            return handleError(ctx, err, "Failed to write score to global leaderboard");
        }

        return JSON.stringify({
            success: true,
            gameId: gameId,
            score: score,
            userId: userId,
            submittedAt: submittedAt
        });

    } catch (err) {
        logError(logger, "Unexpected error in submitScoreSync: " + err.message);
        return handleError(ctx, err, "An error occurred while processing your request");
    }
}

// Register RPC in InitModule context if available
var rpcSubmitScoreSync = submitScoreSync;

// Export for module systems (ES Module syntax)

// ============================================================================
// COPILOT/LEADERBOARD_AGGREGATE.JS
// ============================================================================

// leaderboard_aggregate.js - Aggregate player scores across all game leaderboards

// Import utils

/**
 * RPC: submit_score_with_aggregate
 * Aggregates player scores across all game leaderboards to compute Global Power Rank
 */
function submitScoreWithAggregate(ctx, logger, nk, payload) {
    try {
        // Validate authentication
        if (!ctx.userId) {
            return handleError(ctx, null, "Authentication required");
        }

        // Parse and validate payload
        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = validatePayload(data, ['gameId', 'score']);
        if (!validation.valid) {
            return handleError(ctx, null, "Missing required fields: " + validation.missing.join(', '));
        }

        const gameId = data.gameId;
        const individualScore = parseInt(data.score);
        
        if (isNaN(individualScore)) {
            return handleError(ctx, null, "Score must be a valid number");
        }

        const userId = ctx.userId;
        const username = ctx.username || userId;
        const submittedAt = new Date().toISOString();

        logInfo(logger, "Processing aggregate score for user " + username + " in game " + gameId);

        // Write individual score to game leaderboard
        const gameLeaderboardId = "leaderboard_" + gameId;
        const metadata = {
            source: "submit_score_with_aggregate",
            gameId: gameId,
            submittedAt: submittedAt
        };

        try {
            nk.leaderboardRecordWrite(
                gameLeaderboardId,
                userId,
                username,
                individualScore,
                0,
                metadata
            );
            logInfo(logger, "Individual score written to game leaderboard: " + gameLeaderboardId);
        } catch (err) {
            logError(logger, "Failed to write individual score: " + err.message);
            return handleError(ctx, err, "Failed to write score to game leaderboard");
        }

        // Retrieve all game leaderboards from registry
        const registry = readRegistry(nk, logger);
        const gameLeaderboards = [];
        
        for (let i = 0; i < registry.length; i++) {
            if (registry[i].scope === "game" && registry[i].leaderboardId) {
                gameLeaderboards.push(registry[i].leaderboardId);
            }
        }

        logInfo(logger, "Found " + gameLeaderboards.length + " game leaderboards in registry");

        // Query all game leaderboards for this user's scores
        let aggregateScore = 0;
        let processedBoards = 0;

        for (let i = 0; i < gameLeaderboards.length; i++) {
            const leaderboardId = gameLeaderboards[i];
            try {
                const records = nk.leaderboardRecordsList(leaderboardId, [userId], 1, null, 0);
                if (records && records.records && records.records.length > 0) {
                    const userScore = records.records[0].score;
                    aggregateScore += userScore;
                    processedBoards++;
                    logInfo(logger, "Found score " + userScore + " in leaderboard " + leaderboardId);
                }
            } catch (err) {
                // Leaderboard might not exist, skip silently
                logInfo(logger, "Skipping leaderboard " + leaderboardId + ": " + err.message);
            }
        }

        logInfo(logger, "Calculated aggregate score: " + aggregateScore + " from " + processedBoards + " leaderboards");

        // Write aggregate score to global leaderboard
        const globalLeaderboardId = "leaderboard_global";
        const globalMetadata = {
            source: "submit_score_with_aggregate",
            aggregateScore: aggregateScore,
            individualScore: individualScore,
            gameId: gameId,
            submittedAt: submittedAt
        };

        try {
            nk.leaderboardRecordWrite(
                globalLeaderboardId,
                userId,
                username,
                aggregateScore,
                0,
                globalMetadata
            );
            logInfo(logger, "Aggregate score written to global leaderboard");
        } catch (err) {
            logError(logger, "Failed to write aggregate score: " + err.message);
            return handleError(ctx, err, "Failed to write aggregate score to global leaderboard");
        }

        return JSON.stringify({
            success: true,
            gameId: gameId,
            individualScore: individualScore,
            aggregateScore: aggregateScore,
            leaderboardsProcessed: processedBoards
        });

    } catch (err) {
        logError(logger, "Unexpected error in submitScoreWithAggregate: " + err.message);
        return handleError(ctx, err, "An error occurred while processing your request");
    }
}

// Register RPC in InitModule context if available
var rpcSubmitScoreWithAggregate = submitScoreWithAggregate;

// Export for module systems (ES Module syntax)

// ============================================================================
// COPILOT/LEADERBOARD_FRIENDS.JS
// ============================================================================

// leaderboard_friends.js - Friend-specific leaderboard features

// Import utils

/**
 * RPC: create_all_leaderboards_with_friends
 * Creates parallel friend leaderboards for all games
 */
function createAllLeaderboardsWithFriends(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return handleError(ctx, null, "Authentication required");
        }

        logInfo(logger, "Creating friend leaderboards");

        const sort = "desc";
        const operator = "best";
        const resetSchedule = "0 0 * * 0"; // Weekly reset
        const created = [];
        const skipped = [];

        // Create global friends leaderboard
        const globalFriendsId = "leaderboard_friends_global";
        try {
            nk.leaderboardCreate(
                globalFriendsId,
                true,
                sort,
                operator,
                resetSchedule,
                { scope: "friends_global", desc: "Global Friends Leaderboard" }
            );
            created.push(globalFriendsId);
            logInfo(logger, "Created global friends leaderboard");
        } catch (err) {
            logInfo(logger, "Global friends leaderboard may already exist: " + err.message);
            skipped.push(globalFriendsId);
        }

        // Get all game leaderboards from registry
        const registry = readRegistry(nk, logger);
        
        for (let i = 0; i < registry.length; i++) {
            const record = registry[i];
            if (record.scope === "game" && record.gameId) {
                const friendsLeaderboardId = "leaderboard_friends_" + record.gameId;
                try {
                    nk.leaderboardCreate(
                        friendsLeaderboardId,
                        true,
                        sort,
                        operator,
                        resetSchedule,
                        {
                            scope: "friends_game",
                            gameId: record.gameId,
                            desc: "Friends Leaderboard for game " + record.gameId
                        }
                    );
                    created.push(friendsLeaderboardId);
                    logInfo(logger, "Created friends leaderboard: " + friendsLeaderboardId);
                } catch (err) {
                    logInfo(logger, "Friends leaderboard may already exist: " + friendsLeaderboardId);
                    skipped.push(friendsLeaderboardId);
                }
            }
        }

        return JSON.stringify({
            success: true,
            created: created,
            skipped: skipped,
            totalProcessed: registry.length
        });

    } catch (err) {
        logError(logger, "Error in createAllLeaderboardsWithFriends: " + err.message);
        return handleError(ctx, err, "An error occurred while creating friend leaderboards");
    }
}

/**
 * RPC: submit_score_with_friends_sync
 * Submits score to both regular and friend-specific leaderboards
 */
function submitScoreWithFriendsSync(ctx, logger, nk, payload) {
    const validatePayload = utils ? validatePayload : function(p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? logInfo : function(l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? logError : function(l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? handleError : function(c, e, m) { 
        return JSON.stringify({ success: false, error: m }); 
    };

    try {
        if (!ctx.userId) {
            return handleError(ctx, null, "Authentication required");
        }

        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = validatePayload(data, ['gameId', 'score']);
        if (!validation.valid) {
            return handleError(ctx, null, "Missing required fields: " + validation.missing.join(', '));
        }

        const gameId = data.gameId;
        const score = parseInt(data.score);
        
        if (isNaN(score)) {
            return handleError(ctx, null, "Score must be a valid number");
        }

        const userId = ctx.userId;
        const username = ctx.username || userId;
        const submittedAt = new Date().toISOString();

        const metadata = {
            source: "submit_score_with_friends_sync",
            gameId: gameId,
            submittedAt: submittedAt
        };

        logInfo(logger, "Submitting score with friends sync for user " + username);

        // Write to regular leaderboards
        const gameLeaderboardId = "leaderboard_" + gameId;
        const globalLeaderboardId = "leaderboard_global";
        const friendsGameLeaderboardId = "leaderboard_friends_" + gameId;
        const friendsGlobalLeaderboardId = "leaderboard_friends_global";

        const results = {
            regular: { game: false, global: false },
            friends: { game: false, global: false }
        };

        // Write to game leaderboard
        try {
            nk.leaderboardRecordWrite(gameLeaderboardId, userId, username, score, 0, metadata);
            results.regular.game = true;
            logInfo(logger, "Score written to game leaderboard");
        } catch (err) {
            logError(logger, "Failed to write to game leaderboard: " + err.message);
        }

        // Write to global leaderboard
        try {
            nk.leaderboardRecordWrite(globalLeaderboardId, userId, username, score, 0, metadata);
            results.regular.global = true;
            logInfo(logger, "Score written to global leaderboard");
        } catch (err) {
            logError(logger, "Failed to write to global leaderboard: " + err.message);
        }

        // Write to friends game leaderboard
        try {
            nk.leaderboardRecordWrite(friendsGameLeaderboardId, userId, username, score, 0, metadata);
            results.friends.game = true;
            logInfo(logger, "Score written to friends game leaderboard");
        } catch (err) {
            logError(logger, "Failed to write to friends game leaderboard: " + err.message);
        }

        // Write to friends global leaderboard
        try {
            nk.leaderboardRecordWrite(friendsGlobalLeaderboardId, userId, username, score, 0, metadata);
            results.friends.global = true;
            logInfo(logger, "Score written to friends global leaderboard");
        } catch (err) {
            logError(logger, "Failed to write to friends global leaderboard: " + err.message);
        }

        return JSON.stringify({
            success: true,
            gameId: gameId,
            score: score,
            results: results,
            submittedAt: submittedAt
        });

    } catch (err) {
        logError(logger, "Error in submitScoreWithFriendsSync: " + err.message);
        return handleError(ctx, err, "An error occurred while submitting score");
    }
}

/**
 * RPC: get_friend_leaderboard
 * Retrieves leaderboard filtered by friends
 */
function getFriendLeaderboard(ctx, logger, nk, payload) {
    const validatePayload = utils ? validatePayload : function(p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? logInfo : function(l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? logError : function(l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? handleError : function(c, e, m) { 
        return JSON.stringify({ success: false, error: m }); 
    };

    try {
        if (!ctx.userId) {
            return handleError(ctx, null, "Authentication required");
        }

        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = validatePayload(data, ['leaderboardId']);
        if (!validation.valid) {
            return handleError(ctx, null, "Missing required field: leaderboardId");
        }

        const leaderboardId = data.leaderboardId;
        const limit = data.limit || 100;
        const userId = ctx.userId;

        logInfo(logger, "Getting friend leaderboard for user " + userId);

        // Get user's friends list
        let friends = [];
        try {
            const friendsList = nk.friendsList(userId, limit, null, null);
            if (friendsList && friendsList.friends) {
                for (let i = 0; i < friendsList.friends.length; i++) {
                    const friend = friendsList.friends[i];
                    if (friend.user && friend.user.id) {
                        friends.push(friend.user.id);
                    }
                }
            }
            logInfo(logger, "Found " + friends.length + " friends");
        } catch (err) {
            logError(logger, "Failed to get friends list: " + err.message);
            return handleError(ctx, err, "Failed to retrieve friends list");
        }

        // Include the user themselves
        friends.push(userId);

        // Query leaderboard for friends
        let records = [];
        try {
            const leaderboardRecords = nk.leaderboardRecordsList(leaderboardId, friends, limit, null, 0);
            if (leaderboardRecords && leaderboardRecords.records) {
                records = leaderboardRecords.records;
            }
            logInfo(logger, "Retrieved " + records.length + " friend records");
        } catch (err) {
            logError(logger, "Failed to query leaderboard: " + err.message);
            return handleError(ctx, err, "Failed to retrieve leaderboard records");
        }

        return JSON.stringify({
            success: true,
            leaderboardId: leaderboardId,
            records: records,
            totalFriends: friends.length - 1 // Exclude self
        });

    } catch (err) {
        logError(logger, "Error in getFriendLeaderboard: " + err.message);
        return handleError(ctx, err, "An error occurred while retrieving friend leaderboard");
    }
}

// Register RPCs in InitModule context if available
var rpcCreateAllLeaderboardsWithFriends = createAllLeaderboardsWithFriends;
var rpcSubmitScoreWithFriendsSync = submitScoreWithFriendsSync;
var rpcGetFriendLeaderboard = getFriendLeaderboard;

// Export for module systems (ES Module syntax)

// ============================================================================
// COPILOT/SOCIAL_FEATURES.JS
// ============================================================================

// social_features.js - Social graph and notification features

// Import utils

/**
 * RPC: send_friend_invite
 * Sends a friend invite to another user
 */
function sendFriendInvite(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return handleError(ctx, null, "Authentication required");
        }

        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = validatePayload(data, ['targetUserId']);
        if (!validation.valid) {
            return handleError(ctx, null, "Missing required field: targetUserId");
        }

        const fromUserId = ctx.userId;
        const fromUsername = ctx.username || fromUserId;
        const targetUserId = data.targetUserId;
        const message = data.message || "You have a new friend request";

        logInfo(logger, "User " + fromUsername + " sending friend invite to " + targetUserId);

        // Store friend invite in storage
        const inviteId = fromUserId + "_" + targetUserId + "_" + Date.now();
        const inviteData = {
            inviteId: inviteId,
            fromUserId: fromUserId,
            fromUsername: fromUsername,
            targetUserId: targetUserId,
            message: message,
            status: "pending",
            createdAt: new Date().toISOString()
        };

        try {
            nk.storageWrite([{
                collection: "friend_invites",
                key: inviteId,
                userId: targetUserId,
                value: inviteData,
                permissionRead: 1,
                permissionWrite: 0
            }]);
            logInfo(logger, "Friend invite stored: " + inviteId);
        } catch (err) {
            logError(logger, "Failed to store friend invite: " + err.message);
            return handleError(ctx, err, "Failed to store friend invite");
        }

        // Send notification to target user
        try {
            const notificationContent = {
                type: "friend_invite",
                inviteId: inviteId,
                fromUserId: fromUserId,
                fromUsername: fromUsername,
                message: message
            };

            nk.notificationSend(
                targetUserId,
                "Friend Request",
                notificationContent,
                1, // code for friend invite
                fromUserId,
                true
            );
            logInfo(logger, "Notification sent to " + targetUserId);
        } catch (err) {
            logError(logger, "Failed to send notification: " + err.message);
            // Don't fail the whole operation if notification fails
        }

        return JSON.stringify({
            success: true,
            inviteId: inviteId,
            targetUserId: targetUserId,
            status: "sent"
        });

    } catch (err) {
        logError(logger, "Error in sendFriendInvite: " + err.message);
        return handleError(ctx, err, "An error occurred while sending friend invite");
    }
}

/**
 * RPC: accept_friend_invite
 * Accepts a friend invite
 */
function acceptFriendInvite(ctx, logger, nk, payload) {
    const validatePayload = utils ? validatePayload : function(p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? logInfo : function(l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? logError : function(l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? handleError : function(c, e, m) { 
        return JSON.stringify({ success: false, error: m }); 
    };

    try {
        if (!ctx.userId) {
            return handleError(ctx, null, "Authentication required");
        }

        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = validatePayload(data, ['inviteId']);
        if (!validation.valid) {
            return handleError(ctx, null, "Missing required field: inviteId");
        }

        const userId = ctx.userId;
        const inviteId = data.inviteId;

        logInfo(logger, "User " + userId + " accepting friend invite " + inviteId);

        // Read invite from storage
        let inviteData;
        try {
            const records = nk.storageRead([{
                collection: "friend_invites",
                key: inviteId,
                userId: userId
            }]);
            
            if (!records || records.length === 0) {
                return handleError(ctx, null, "Friend invite not found");
            }
            
            inviteData = records[0].value;
        } catch (err) {
            logError(logger, "Failed to read invite: " + err.message);
            return handleError(ctx, err, "Failed to retrieve friend invite");
        }

        // Verify invite is for this user and is pending
        if (inviteData.targetUserId !== userId) {
            return handleError(ctx, null, "This invite is not for you");
        }

        if (inviteData.status !== "pending") {
            return handleError(ctx, null, "This invite has already been processed");
        }

        // Add friend using Nakama's built-in friend system
        try {
            nk.friendsAdd(userId, [inviteData.fromUserId], [inviteData.fromUsername]);
            logInfo(logger, "Friend added: " + inviteData.fromUserId);
        } catch (err) {
            logError(logger, "Failed to add friend: " + err.message);
            return handleError(ctx, err, "Failed to add friend");
        }

        // Update invite status
        inviteData.status = "accepted";
        inviteData.acceptedAt = new Date().toISOString();

        try {
            nk.storageWrite([{
                collection: "friend_invites",
                key: inviteId,
                userId: userId,
                value: inviteData,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        } catch (err) {
            logError(logger, "Failed to update invite status: " + err.message);
        }

        // Notify the sender
        try {
            const notificationContent = {
                type: "friend_invite_accepted",
                acceptedBy: userId,
                acceptedByUsername: ctx.username || userId
            };

            nk.notificationSend(
                inviteData.fromUserId,
                "Friend Request Accepted",
                notificationContent,
                2, // code for friend invite accepted
                userId,
                true
            );
        } catch (err) {
            logError(logger, "Failed to send notification to sender: " + err.message);
        }

        return JSON.stringify({
            success: true,
            inviteId: inviteId,
            friendUserId: inviteData.fromUserId,
            friendUsername: inviteData.fromUsername
        });

    } catch (err) {
        logError(logger, "Error in acceptFriendInvite: " + err.message);
        return handleError(ctx, err, "An error occurred while accepting friend invite");
    }
}

/**
 * RPC: decline_friend_invite
 * Declines a friend invite
 */
function declineFriendInvite(ctx, logger, nk, payload) {
    const validatePayload = utils ? validatePayload : function(p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? logInfo : function(l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? logError : function(l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? handleError : function(c, e, m) { 
        return JSON.stringify({ success: false, error: m }); 
    };

    try {
        if (!ctx.userId) {
            return handleError(ctx, null, "Authentication required");
        }

        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = validatePayload(data, ['inviteId']);
        if (!validation.valid) {
            return handleError(ctx, null, "Missing required field: inviteId");
        }

        const userId = ctx.userId;
        const inviteId = data.inviteId;

        logInfo(logger, "User " + userId + " declining friend invite " + inviteId);

        // Read invite from storage
        let inviteData;
        try {
            const records = nk.storageRead([{
                collection: "friend_invites",
                key: inviteId,
                userId: userId
            }]);
            
            if (!records || records.length === 0) {
                return handleError(ctx, null, "Friend invite not found");
            }
            
            inviteData = records[0].value;
        } catch (err) {
            logError(logger, "Failed to read invite: " + err.message);
            return handleError(ctx, err, "Failed to retrieve friend invite");
        }

        // Verify invite is for this user and is pending
        if (inviteData.targetUserId !== userId) {
            return handleError(ctx, null, "This invite is not for you");
        }

        if (inviteData.status !== "pending") {
            return handleError(ctx, null, "This invite has already been processed");
        }

        // Update invite status
        inviteData.status = "declined";
        inviteData.declinedAt = new Date().toISOString();

        try {
            nk.storageWrite([{
                collection: "friend_invites",
                key: inviteId,
                userId: userId,
                value: inviteData,
                permissionRead: 1,
                permissionWrite: 0
            }]);
            logInfo(logger, "Friend invite declined: " + inviteId);
        } catch (err) {
            logError(logger, "Failed to update invite status: " + err.message);
            return handleError(ctx, err, "Failed to decline friend invite");
        }

        return JSON.stringify({
            success: true,
            inviteId: inviteId,
            status: "declined"
        });

    } catch (err) {
        logError(logger, "Error in declineFriendInvite: " + err.message);
        return handleError(ctx, err, "An error occurred while declining friend invite");
    }
}

/**
 * RPC: get_notifications
 * Retrieves notifications for the user
 */
function getNotifications(ctx, logger, nk, payload) {
    const logInfo = utils ? logInfo : function(l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? logError : function(l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? handleError : function(c, e, m) { 
        return JSON.stringify({ success: false, error: m }); 
    };

    try {
        if (!ctx.userId) {
            return handleError(ctx, null, "Authentication required");
        }

        let data = {};
        if (payload) {
            try {
                data = JSON.parse(payload);
            } catch (err) {
                // Use defaults if payload is invalid
            }
        }

        const userId = ctx.userId;
        const limit = data.limit || 100;

        logInfo(logger, "Getting notifications for user " + userId);

        // Get notifications using Nakama's built-in system
        let notifications = [];
        try {
            const result = nk.notificationsList(userId, limit, null);
            if (result && result.notifications) {
                notifications = result.notifications;
            }
            logInfo(logger, "Retrieved " + notifications.length + " notifications");
        } catch (err) {
            logError(logger, "Failed to retrieve notifications: " + err.message);
            return handleError(ctx, err, "Failed to retrieve notifications");
        }

        return JSON.stringify({
            success: true,
            notifications: notifications,
            count: notifications.length
        });

    } catch (err) {
        logError(logger, "Error in getNotifications: " + err.message);
        return handleError(ctx, err, "An error occurred while retrieving notifications");
    }
}

// Register RPCs in InitModule context if available
var rpcSendFriendInvite = sendFriendInvite;
var rpcAcceptFriendInvite = acceptFriendInvite;
var rpcDeclineFriendInvite = declineFriendInvite;
var rpcGetNotifications = getNotifications;

// Export for module systems (ES Module syntax)

// ============================================================================
// DAILY_REWARDS/DAILY_REWARDS.JS
// ============================================================================

// daily_rewards.js - Daily Rewards & Streak System (Per gameId UUID)


/**
 * Reward configurations per gameId UUID
 * This can be extended or moved to storage for dynamic configuration
 */
var REWARD_CONFIGS = {
    // Default rewards for any game
    "default": [
        { day: 1, xp: 100, tokens: 10, description: "Day 1 Reward" },
        { day: 2, xp: 150, tokens: 15, description: "Day 2 Reward" },
        { day: 3, xp: 200, tokens: 20, description: "Day 3 Reward" },
        { day: 4, xp: 250, tokens: 25, description: "Day 4 Reward" },
        { day: 5, xp: 300, tokens: 30, multiplier: "2x XP", description: "Day 5 Bonus" },
        { day: 6, xp: 350, tokens: 35, description: "Day 6 Reward" },
        { day: 7, xp: 500, tokens: 50, nft: "weekly_badge", description: "Day 7 Special Badge" }
    ]
};

/**
 * Get or create streak data for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @returns {object} Streak data
 */
function getStreakData(nk, logger, userId, gameId) {
    var collection = "daily_streaks";
    var key = makeGameStorageKey("user_daily_streak", userId, gameId);
    
    var data = readStorage(nk, logger, collection, key, userId);
    
    if (!data) {
        // Initialize new streak
        data = {
            userId: userId,
            gameId: gameId,
            currentStreak: 0,
            lastClaimTimestamp: 0,
            totalClaims: 0,
            createdAt: getCurrentTimestamp()
        };
    }
    
    return data;
}

/**
 * Save streak data
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {object} data - Streak data to save
 * @returns {boolean} Success status
 */
function saveStreakData(nk, logger, userId, gameId, data) {
    var collection = "daily_streaks";
    var key = makeGameStorageKey("user_daily_streak", userId, gameId);
    return writeStorage(nk, logger, collection, key, userId, data);
}

/**
 * Check if user can claim reward today
 * @param {object} streakData - Current streak data
 * @returns {object} { canClaim: boolean, reason: string }
 */
function canClaimToday(streakData) {
    var now = getUnixTimestamp();
    var lastClaim = streakData.lastClaimTimestamp;
    
    // First claim ever
    if (lastClaim === 0) {
        return { canClaim: true, reason: "first_claim" };
    }
    
    var lastClaimStartOfDay = getStartOfDay(new Date(lastClaim * 1000));
    var todayStartOfDay = getStartOfDay();
    
    // Already claimed today
    if (lastClaimStartOfDay === todayStartOfDay) {
        return { canClaim: false, reason: "already_claimed_today" };
    }
    
    // Can claim
    return { canClaim: true, reason: "eligible" };
}

/**
 * Update streak status based on time elapsed
 * @param {object} streakData - Current streak data
 * @returns {object} Updated streak data
 */
function updateStreakStatus(streakData) {
    var now = getUnixTimestamp();
    var lastClaim = streakData.lastClaimTimestamp;
    
    // First claim
    if (lastClaim === 0) {
        return streakData;
    }
    
    // Check if more than 48 hours passed (streak broken)
    if (!isWithinHours(lastClaim, now, 48)) {
        streakData.currentStreak = 0;
    }
    
    return streakData;
}

/**
 * Get reward configuration for current day
 * @param {string} gameId - Game ID
 * @param {number} day - Streak day (1-7)
 * @returns {object} Reward configuration
 */
function getRewardForDay(gameId, day) {
    var config = REWARD_CONFIGS[gameId] || REWARD_CONFIGS["default"];
    var rewardDay = ((day - 1) % 7) + 1; // Cycle through 1-7
    
    for (var i = 0; i < config.length; i++) {
        if (config[i].day === rewardDay) {
            return config[i];
        }
    }
    
    // Fallback to day 1 if not found
    return config[0];
}

/**
 * RPC: Get daily reward status
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 * @returns {string} JSON response
 */
function rpcDailyRewardsGetStatus(ctx, logger, nk, payload) {
    logInfo(logger, "RPC daily_rewards_get_status called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!isValidUUID(gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    // Get current streak data
    var streakData = getStreakData(nk, logger, userId, gameId);
    streakData = updateStreakStatus(streakData);
    
    // Check if can claim
    var claimCheck = canClaimToday(streakData);
    
    // Get next reward info
    var nextDay = streakData.currentStreak + 1;
    var nextReward = getRewardForDay(gameId, nextDay);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        currentStreak: streakData.currentStreak,
        totalClaims: streakData.totalClaims,
        lastClaimTimestamp: streakData.lastClaimTimestamp,
        canClaimToday: claimCheck.canClaim,
        claimReason: claimCheck.reason,
        nextReward: nextReward,
        timestamp: getCurrentTimestamp()
    });
}

/**
 * RPC: Claim daily reward
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 * @returns {string} JSON response
 */
function rpcDailyRewardsClaim(ctx, logger, nk, payload) {
    logInfo(logger, "RPC daily_rewards_claim called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!isValidUUID(gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    // Get current streak data
    var streakData = getStreakData(nk, logger, userId, gameId);
    streakData = updateStreakStatus(streakData);
    
    // Check if can claim
    var claimCheck = canClaimToday(streakData);
    if (!claimCheck.canClaim) {
        return JSON.stringify({
            success: false,
            error: "Cannot claim reward: " + claimCheck.reason,
            canClaimToday: false
        });
    }
    
    // Update streak
    streakData.currentStreak += 1;
    streakData.lastClaimTimestamp = getUnixTimestamp();
    streakData.totalClaims += 1;
    streakData.updatedAt = getCurrentTimestamp();
    
    // Get reward for current day
    var reward = getRewardForDay(gameId, streakData.currentStreak);
    
    // Save updated streak
    if (!saveStreakData(nk, logger, userId, gameId, streakData)) {
        return handleError(ctx, null, "Failed to save streak data");
    }
    
    // Log reward claim for transaction history
    var transactionKey = "transaction_log_" + userId + "_" + getUnixTimestamp();
    var transactionData = {
        userId: userId,
        gameId: gameId,
        type: "daily_reward_claim",
        day: streakData.currentStreak,
        reward: reward,
        timestamp: getCurrentTimestamp()
    };
    writeStorage(nk, logger, "transaction_logs", transactionKey, userId, transactionData);
    
    logInfo(logger, "User " + userId + " claimed day " + streakData.currentStreak + " reward for game " + gameId);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        currentStreak: streakData.currentStreak,
        totalClaims: streakData.totalClaims,
        reward: reward,
        claimedAt: getCurrentTimestamp()
    });
}

// Export RPC functions (ES Module syntax)

// ============================================================================
// DAILY_MISSIONS/DAILY_MISSIONS.JS
// ============================================================================

// daily_missions.js - Daily Missions System (Per gameId UUID)


/**
 * Mission configurations per gameId UUID
 * This can be extended or moved to storage for dynamic configuration
 */
var MISSION_CONFIGS = {
    // Default missions for any game
    "default": [
        {
            id: "login_daily",
            name: "Daily Login",
            description: "Log in to the game",
            objective: "login",
            targetValue: 1,
            rewards: { xp: 50, tokens: 5 }
        },
        {
            id: "play_matches",
            name: "Play Matches",
            description: "Complete 3 matches",
            objective: "matches_played",
            targetValue: 3,
            rewards: { xp: 100, tokens: 10 }
        },
        {
            id: "score_points",
            name: "Score Points",
            description: "Score 1000 points",
            objective: "total_score",
            targetValue: 1000,
            rewards: { xp: 150, tokens: 15 }
        }
    ]
};

/**
 * Get mission configurations for a game
 * @param {string} gameId - Game ID (UUID)
 * @returns {Array} Mission configurations
 */
function getMissionConfig(gameId) {
    return MISSION_CONFIGS[gameId] || MISSION_CONFIGS["default"];
}

/**
 * Get or create daily mission progress for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @returns {object} Mission progress data
 */
function getMissionProgress(nk, logger, userId, gameId) {
    var collection = "daily_missions";
    var key = makeGameStorageKey("mission_progress", userId, gameId);
    
    var data = readStorage(nk, logger, collection, key, userId);
    
    if (!data || !isToday(data.resetDate)) {
        // Initialize new daily missions
        var missions = getMissionConfig(gameId);
        var progress = {};
        
        for (var i = 0; i < missions.length; i++) {
            progress[missions[i].id] = {
                currentValue: 0,
                targetValue: missions[i].targetValue,
                completed: false,
                claimed: false
            };
        }
        
        data = {
            userId: userId,
            gameId: gameId,
            resetDate: getStartOfDay(),
            progress: progress,
            updatedAt: getCurrentTimestamp()
        };
    }
    
    return data;
}

/**
 * Check if a timestamp is from today
 * @param {number} timestamp - Unix timestamp (seconds)
 * @returns {boolean} True if timestamp is from today
 */
function isToday(timestamp) {
    if (!timestamp) return false;
    var todayStart = getStartOfDay();
    var tomorrowStart = todayStart + 86400; // +24 hours
    return timestamp >= todayStart && timestamp < tomorrowStart;
}

/**
 * Save mission progress
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {object} data - Mission progress data
 * @returns {boolean} Success status
 */
function saveMissionProgress(nk, logger, userId, gameId, data) {
    var collection = "daily_missions";
    var key = makeGameStorageKey("mission_progress", userId, gameId);
    data.updatedAt = getCurrentTimestamp();
    return writeStorage(nk, logger, collection, key, userId, data);
}

/**
 * RPC: Get daily missions
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 * @returns {string} JSON response
 */
function rpcGetDailyMissions(ctx, logger, nk, payload) {
    logInfo(logger, "RPC get_daily_missions called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!isValidUUID(gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    // Get mission progress
    var progressData = getMissionProgress(nk, logger, userId, gameId);
    
    // Get mission configs
    var missions = getMissionConfig(gameId);
    
    // Build response with mission details and progress
    var missionsList = [];
    for (var i = 0; i < missions.length; i++) {
        var mission = missions[i];
        var progress = progressData.progress[mission.id] || {
            currentValue: 0,
            targetValue: mission.targetValue,
            completed: false,
            claimed: false
        };
        
        missionsList.push({
            id: mission.id,
            name: mission.name,
            description: mission.description,
            objective: mission.objective,
            currentValue: progress.currentValue,
            targetValue: progress.targetValue,
            completed: progress.completed,
            claimed: progress.claimed,
            rewards: mission.rewards
        });
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        resetDate: progressData.resetDate,
        missions: missionsList,
        timestamp: getCurrentTimestamp()
    });
}

/**
 * RPC: Submit mission progress
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid", missionId: "string", value: number }
 * @returns {string} JSON response
 */
function rpcSubmitMissionProgress(ctx, logger, nk, payload) {
    logInfo(logger, "RPC submit_mission_progress called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['gameId', 'missionId', 'value']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!isValidUUID(gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var missionId = data.missionId;
    var value = data.value;
    
    // Get current progress
    var progressData = getMissionProgress(nk, logger, userId, gameId);
    
    // Check if mission exists
    if (!progressData.progress[missionId]) {
        return handleError(ctx, null, "Mission not found: " + missionId);
    }
    
    var missionProgress = progressData.progress[missionId];
    
    // Update progress
    missionProgress.currentValue += value;
    
    // Check if completed
    if (missionProgress.currentValue >= missionProgress.targetValue && !missionProgress.completed) {
        missionProgress.completed = true;
        logInfo(logger, "Mission " + missionId + " completed for user " + userId);
    }
    
    // Save progress
    if (!saveMissionProgress(nk, logger, userId, gameId, progressData)) {
        return handleError(ctx, null, "Failed to save mission progress");
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        missionId: missionId,
        currentValue: missionProgress.currentValue,
        targetValue: missionProgress.targetValue,
        completed: missionProgress.completed,
        claimed: missionProgress.claimed,
        timestamp: getCurrentTimestamp()
    });
}

/**
 * RPC: Claim mission reward
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid", missionId: "string" }
 * @returns {string} JSON response
 */
function rpcClaimMissionReward(ctx, logger, nk, payload) {
    logInfo(logger, "RPC claim_mission_reward called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['gameId', 'missionId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!isValidUUID(gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var missionId = data.missionId;
    
    // Get current progress
    var progressData = getMissionProgress(nk, logger, userId, gameId);
    
    // Check if mission exists
    if (!progressData.progress[missionId]) {
        return handleError(ctx, null, "Mission not found: " + missionId);
    }
    
    var missionProgress = progressData.progress[missionId];
    
    // Check if completed
    if (!missionProgress.completed) {
        return JSON.stringify({
            success: false,
            error: "Mission not completed yet"
        });
    }
    
    // Check if already claimed
    if (missionProgress.claimed) {
        return JSON.stringify({
            success: false,
            error: "Reward already claimed"
        });
    }
    
    // Mark as claimed
    missionProgress.claimed = true;
    
    // Get mission config to retrieve rewards
    var missions = getMissionConfig(gameId);
    var missionConfig = null;
    for (var i = 0; i < missions.length; i++) {
        if (missions[i].id === missionId) {
            missionConfig = missions[i];
            break;
        }
    }
    
    if (!missionConfig) {
        return handleError(ctx, null, "Mission configuration not found");
    }
    
    // Save progress
    if (!saveMissionProgress(nk, logger, userId, gameId, progressData)) {
        return handleError(ctx, null, "Failed to save mission progress");
    }
    
    // Log reward claim for transaction history
    var transactionKey = "transaction_log_" + userId + "_" + getUnixTimestamp();
    var transactionData = {
        userId: userId,
        gameId: gameId,
        type: "mission_reward_claim",
        missionId: missionId,
        rewards: missionConfig.rewards,
        timestamp: getCurrentTimestamp()
    };
    writeStorage(nk, logger, "transaction_logs", transactionKey, userId, transactionData);
    
    logInfo(logger, "User " + userId + " claimed mission reward for " + missionId);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        missionId: missionId,
        rewards: missionConfig.rewards,
        claimedAt: getCurrentTimestamp()
    });
}

// Export RPC functions (ES Module syntax)

// ============================================================================
// WALLET/WALLET.JS
// ============================================================================

// wallet.js - Enhanced Wallet System (Global + Per-Game Sub-Wallets)


/**
 * Get or create global wallet for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @returns {object} Global wallet data
 */
function getGlobalWallet(nk, logger, userId) {
    var collection = "wallets";
    var key = makeGlobalStorageKey("global_wallet", userId);
    
    var wallet = readStorage(nk, logger, collection, key, userId);
    
    if (!wallet) {
        // Initialize new global wallet
        wallet = {
            userId: userId,
            currencies: {
                xut: 0,
                xp: 0
            },
            items: {},
            nfts: [],
            createdAt: getCurrentTimestamp()
        };
    }
    
    return wallet;
}

/**
 * Get or create game-specific wallet for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @returns {object} Game wallet data
 */
function getGameWallet(nk, logger, userId, gameId) {
    var collection = "wallets";
    var key = makeGameStorageKey("wallet", userId, gameId);
    
    var wallet = readStorage(nk, logger, collection, key, userId);
    
    if (!wallet) {
        // Initialize new game wallet
        wallet = {
            userId: userId,
            gameId: gameId,
            currencies: {
                tokens: 0,
                xp: 0
            },
            items: {},
            consumables: {},
            cosmetics: {},
            createdAt: getCurrentTimestamp()
        };
    }
    
    return wallet;
}

/**
 * Save global wallet
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {object} wallet - Wallet data
 * @returns {boolean} Success status
 */
function saveGlobalWallet(nk, logger, userId, wallet) {
    var collection = "wallets";
    var key = makeGlobalStorageKey("global_wallet", userId);
    wallet.updatedAt = getCurrentTimestamp();
    return writeStorage(nk, logger, collection, key, userId, wallet);
}

/**
 * Save game wallet
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {object} wallet - Wallet data
 * @returns {boolean} Success status
 */
function saveGameWallet(nk, logger, userId, gameId, wallet) {
    var collection = "wallets";
    var key = makeGameStorageKey("wallet", userId, gameId);
    wallet.updatedAt = getCurrentTimestamp();
    return writeStorage(nk, logger, collection, key, userId, wallet);
}

/**
 * Log transaction
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {object} transaction - Transaction data
 */
function logTransaction(nk, logger, userId, transaction) {
    var key = "transaction_log_" + userId + "_" + getUnixTimestamp();
    transaction.timestamp = getCurrentTimestamp();
    writeStorage(nk, logger, "transaction_logs", key, userId, transaction);
}

/**
 * RPC: Get all wallets (global + all game wallets)
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload (empty)
 * @returns {string} JSON response
 */
function rpcWalletGetAll(ctx, logger, nk, payload) {
    logInfo(logger, "RPC wallet_get_all called");
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    // Get global wallet
    var globalWallet = getGlobalWallet(nk, logger, userId);
    
    // Get all game wallets
    var gameWallets = [];
    try {
        var records = nk.storageList(userId, "wallets", 100);
        for (var i = 0; i < records.length; i++) {
            if (records[i].key.indexOf("wallet_" + userId + "_") === 0) {
                gameWallets.push(records[i].value);
            }
        }
    } catch (err) {
        logWarn(logger, "Failed to list game wallets: " + err.message);
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        globalWallet: globalWallet,
        gameWallets: gameWallets,
        timestamp: getCurrentTimestamp()
    });
}

/**
 * RPC: Update global wallet
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { currency: "xut", amount: 100, operation: "add" }
 * @returns {string} JSON response
 */
function rpcWalletUpdateGlobal(ctx, logger, nk, payload) {
    logInfo(logger, "RPC wallet_update_global called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['currency', 'amount', 'operation']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var currency = data.currency;
    var amount = data.amount;
    var operation = data.operation; // "add" or "subtract"
    
    // Get global wallet
    var wallet = getGlobalWallet(nk, logger, userId);
    
    // Initialize currency if not exists
    if (!wallet.currencies[currency]) {
        wallet.currencies[currency] = 0;
    }
    
    // Update currency
    if (operation === "add") {
        wallet.currencies[currency] += amount;
    } else if (operation === "subtract") {
        wallet.currencies[currency] -= amount;
        if (wallet.currencies[currency] < 0) {
            wallet.currencies[currency] = 0;
        }
    } else {
        return handleError(ctx, null, "Invalid operation: " + operation);
    }
    
    // Save wallet
    if (!saveGlobalWallet(nk, logger, userId, wallet)) {
        return handleError(ctx, null, "Failed to save global wallet");
    }
    
    // Log transaction
    logTransaction(nk, logger, userId, {
        type: "global_wallet_update",
        currency: currency,
        amount: amount,
        operation: operation,
        newBalance: wallet.currencies[currency]
    });
    
    return JSON.stringify({
        success: true,
        userId: userId,
        currency: currency,
        newBalance: wallet.currencies[currency],
        timestamp: getCurrentTimestamp()
    });
}

/**
 * RPC: Update game wallet
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid", currency: "tokens", amount: 100, operation: "add" }
 * @returns {string} JSON response
 */
function rpcWalletUpdateGameWallet(ctx, logger, nk, payload) {
    logInfo(logger, "RPC wallet_update_game_wallet called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['gameId', 'currency', 'amount', 'operation']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!isValidUUID(gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var currency = data.currency;
    var amount = data.amount;
    var operation = data.operation;
    
    // Get game wallet
    var wallet = getGameWallet(nk, logger, userId, gameId);
    
    // Initialize currency if not exists
    if (!wallet.currencies[currency]) {
        wallet.currencies[currency] = 0;
    }
    
    // Update currency
    if (operation === "add") {
        wallet.currencies[currency] += amount;
    } else if (operation === "subtract") {
        wallet.currencies[currency] -= amount;
        if (wallet.currencies[currency] < 0) {
            wallet.currencies[currency] = 0;
        }
    } else {
        return handleError(ctx, null, "Invalid operation: " + operation);
    }
    
    // Save wallet
    if (!saveGameWallet(nk, logger, userId, gameId, wallet)) {
        return handleError(ctx, null, "Failed to save game wallet");
    }
    
    // Log transaction
    logTransaction(nk, logger, userId, {
        type: "game_wallet_update",
        gameId: gameId,
        currency: currency,
        amount: amount,
        operation: operation,
        newBalance: wallet.currencies[currency]
    });
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        currency: currency,
        newBalance: wallet.currencies[currency],
        timestamp: getCurrentTimestamp()
    });
}

/**
 * RPC: Transfer between game wallets
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON with { fromGameId: "uuid", toGameId: "uuid", currency: "tokens", amount: 100 }
 * @returns {string} JSON response
 */
function rpcWalletTransferBetweenGameWallets(ctx, logger, nk, payload) {
    logInfo(logger, "RPC wallet_transfer_between_game_wallets called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['fromGameId', 'toGameId', 'currency', 'amount']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var fromGameId = data.fromGameId;
    var toGameId = data.toGameId;
    
    if (!isValidUUID(fromGameId) || !isValidUUID(toGameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var currency = data.currency;
    var amount = data.amount;
    
    // Get both wallets
    var fromWallet = getGameWallet(nk, logger, userId, fromGameId);
    var toWallet = getGameWallet(nk, logger, userId, toGameId);
    
    // Check if source wallet has enough
    if (!fromWallet.currencies[currency] || fromWallet.currencies[currency] < amount) {
        return JSON.stringify({
            success: false,
            error: "Insufficient balance in source wallet"
        });
    }
    
    // Transfer
    fromWallet.currencies[currency] -= amount;
    if (!toWallet.currencies[currency]) {
        toWallet.currencies[currency] = 0;
    }
    toWallet.currencies[currency] += amount;
    
    // Save both wallets
    if (!saveGameWallet(nk, logger, userId, fromGameId, fromWallet)) {
        return handleError(ctx, null, "Failed to save source wallet");
    }
    if (!saveGameWallet(nk, logger, userId, toGameId, toWallet)) {
        return handleError(ctx, null, "Failed to save destination wallet");
    }
    
    // Log transaction
    logTransaction(nk, logger, userId, {
        type: "wallet_transfer",
        fromGameId: fromGameId,
        toGameId: toGameId,
        currency: currency,
        amount: amount
    });
    
    return JSON.stringify({
        success: true,
        userId: userId,
        fromGameId: fromGameId,
        toGameId: toGameId,
        currency: currency,
        amount: amount,
        fromBalance: fromWallet.currencies[currency],
        toBalance: toWallet.currencies[currency],
        timestamp: getCurrentTimestamp()
    });
}

// Export RPC functions (ES Module syntax)

// ============================================================================
// ANALYTICS/ANALYTICS.JS
// ============================================================================

// analytics.js - Analytics System (Per gameId UUID)


/**
 * RPC: Log analytics event
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid", eventName: "string", eventData: {} }
 * @returns {string} JSON response
 */
function rpcAnalyticsLogEvent(ctx, logger, nk, payload) {
    logInfo(logger, "RPC analytics_log_event called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['gameId', 'eventName']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!isValidUUID(gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var eventName = data.eventName;
    var eventData = data.eventData || {};
    
    // Create event record
    var event = {
        userId: userId,
        gameId: gameId,
        eventName: eventName,
        eventData: eventData,
        timestamp: getCurrentTimestamp(),
        unixTimestamp: getUnixTimestamp()
    };
    
    // Store event
    var collection = "analytics_events";
    var key = "event_" + userId + "_" + gameId + "_" + getUnixTimestamp();
    
    if (!writeStorage(nk, logger, collection, key, userId, event)) {
        return handleError(ctx, null, "Failed to log event");
    }
    
    // Track DAU (Daily Active Users)
    trackDAU(nk, logger, userId, gameId);
    
    // Track session if session event
    if (eventName === "session_start" || eventName === "session_end") {
        trackSession(nk, logger, userId, gameId, eventName, eventData);
    }
    
    logInfo(logger, "Event logged: " + eventName + " for user " + userId + " in game " + gameId);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        eventName: eventName,
        timestamp: event.timestamp
    });
}

/**
 * Track Daily Active User
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 */
function trackDAU(nk, logger, userId, gameId) {
    var today = getStartOfDay();
    var collection = "analytics_dau";
    var key = "dau_" + gameId + "_" + today;
    
    // Read existing DAU data
    var dauData = readStorage(nk, logger, collection, key, "00000000-0000-0000-0000-000000000000");
    
    if (!dauData) {
        dauData = {
            gameId: gameId,
            date: today,
            users: [],
            count: 0
        };
    }
    
    // Add user if not already in list
    if (dauData.users.indexOf(userId) === -1) {
        dauData.users.push(userId);
        dauData.count = dauData.users.length;
        
        // Save updated DAU data
        writeStorage(nk, logger, collection, key, "00000000-0000-0000-0000-000000000000", dauData);
    }
}

/**
 * Track session data
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {string} eventName - Event name (session_start or session_end)
 * @param {object} eventData - Event data
 */
function trackSession(nk, logger, userId, gameId, eventName, eventData) {
    var collection = "analytics_sessions";
    var key = makeGameStorageKey("analytics_session", userId, gameId);
    
    if (eventName === "session_start") {
        // Start new session
        var sessionData = {
            userId: userId,
            gameId: gameId,
            startTime: getUnixTimestamp(),
            startTimestamp: getCurrentTimestamp(),
            active: true
        };
        writeStorage(nk, logger, collection, key, userId, sessionData);
    } else if (eventName === "session_end") {
        // End session
        var sessionData = readStorage(nk, logger, collection, key, userId);
        if (sessionData && sessionData.active) {
            sessionData.endTime = getUnixTimestamp();
            sessionData.endTimestamp = getCurrentTimestamp();
            sessionData.duration = sessionData.endTime - sessionData.startTime;
            sessionData.active = false;
            
            // Save session summary
            var summaryKey = "session_summary_" + userId + "_" + gameId + "_" + sessionData.startTime;
            writeStorage(nk, logger, "analytics_session_summaries", summaryKey, userId, sessionData);
            
            // Clear active session
            writeStorage(nk, logger, collection, key, userId, { active: false });
        }
    }
}

// Export RPC functions (ES Module syntax)

// ============================================================================
// FRIENDS/FRIENDS.JS
// ============================================================================

// friends.js - Enhanced Friend System


/**
 * RPC: Block user
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { targetUserId: "uuid" }
 * @returns {string} JSON response
 */
function rpcFriendsBlock(ctx, logger, nk, payload) {
    logInfo(logger, "RPC friends_block called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['targetUserId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var targetUserId = data.targetUserId;
    
    // Store block relationship
    var collection = "user_blocks";
    var key = "blocked_" + userId + "_" + targetUserId;
    var blockData = {
        userId: userId,
        blockedUserId: targetUserId,
        blockedAt: getCurrentTimestamp()
    };
    
    if (!writeStorage(nk, logger, collection, key, userId, blockData)) {
        return handleError(ctx, null, "Failed to block user");
    }
    
    // Remove from friends if exists
    try {
        nk.friendsDelete(userId, [targetUserId]);
    } catch (err) {
        logWarn(logger, "Could not remove friend relationship: " + err.message);
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        blockedUserId: targetUserId,
        blockedAt: blockData.blockedAt
    });
}

/**
 * RPC: Unblock user
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { targetUserId: "uuid" }
 * @returns {string} JSON response
 */
function rpcFriendsUnblock(ctx, logger, nk, payload) {
    logInfo(logger, "RPC friends_unblock called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['targetUserId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var targetUserId = data.targetUserId;
    
    // Remove block relationship
    var collection = "user_blocks";
    var key = "blocked_" + userId + "_" + targetUserId;
    
    try {
        nk.storageDelete([{
            collection: collection,
            key: key,
            userId: userId
        }]);
    } catch (err) {
        logWarn(logger, "Failed to unblock user: " + err.message);
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        unblockedUserId: targetUserId,
        unblockedAt: getCurrentTimestamp()
    });
}

/**
 * RPC: Remove friend
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { friendUserId: "uuid" }
 * @returns {string} JSON response
 */
function rpcFriendsRemove(ctx, logger, nk, payload) {
    logInfo(logger, "RPC friends_remove called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['friendUserId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var friendUserId = data.friendUserId;
    
    try {
        nk.friendsDelete(userId, [friendUserId]);
    } catch (err) {
        return handleError(ctx, err, "Failed to remove friend");
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        removedFriendUserId: friendUserId,
        removedAt: getCurrentTimestamp()
    });
}

/**
 * RPC: List friends
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with optional { limit: 100 }
 * @returns {string} JSON response
 */
function rpcFriendsList(ctx, logger, nk, payload) {
    logInfo(logger, "RPC friends_list called");
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var limit = 100;
    if (payload) {
        var parsed = safeJsonParse(payload);
        if (parsed.success && parsed.data.limit) {
            limit = parsed.data.limit;
        }
    }
    
    var friends = [];
    try {
        var friendsList = nk.friendsList(userId, limit, null, null);
        for (var i = 0; i < friendsList.friends.length; i++) {
            var friend = friendsList.friends[i];
            friends.push({
                userId: friend.user.id,
                username: friend.user.username,
                displayName: friend.user.displayName,
                online: friend.user.online,
                state: friend.state
            });
        }
    } catch (err) {
        return handleError(ctx, err, "Failed to list friends");
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        friends: friends,
        count: friends.length,
        timestamp: getCurrentTimestamp()
    });
}

/**
 * RPC: Challenge friend to a match
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { friendUserId: "uuid", gameId: "uuid", challengeData: {} }
 * @returns {string} JSON response
 */
function rpcFriendsChallengeUser(ctx, logger, nk, payload) {
    logInfo(logger, "RPC friends_challenge_user called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['friendUserId', 'gameId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!isValidUUID(gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var friendUserId = data.friendUserId;
    var challengeData = data.challengeData || {};
    
    // Create challenge
    var challengeId = "challenge_" + userId + "_" + friendUserId + "_" + getUnixTimestamp();
    var challenge = {
        challengeId: challengeId,
        fromUserId: userId,
        toUserId: friendUserId,
        gameId: gameId,
        challengeData: challengeData,
        status: "pending",
        createdAt: getCurrentTimestamp()
    };
    
    // Store challenge
    var collection = "challenges";
    if (!writeStorage(nk, logger, collection, challengeId, userId, challenge)) {
        return handleError(ctx, null, "Failed to create challenge");
    }
    
    // Send notification to friend
    try {
        nk.notificationSend(friendUserId, "Friend Challenge", {
            type: "friend_challenge",
            challengeId: challengeId,
            fromUserId: userId,
            gameId: gameId
        }, 1);
    } catch (err) {
        logWarn(logger, "Failed to send challenge notification: " + err.message);
    }
    
    return JSON.stringify({
        success: true,
        challengeId: challengeId,
        fromUserId: userId,
        toUserId: friendUserId,
        gameId: gameId,
        status: "pending",
        timestamp: getCurrentTimestamp()
    });
}

/**
 * RPC: Spectate friend's match
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { friendUserId: "uuid" }
 * @returns {string} JSON response
 */
function rpcFriendsSpectate(ctx, logger, nk, payload) {
    logInfo(logger, "RPC friends_spectate called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['friendUserId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var friendUserId = data.friendUserId;
    
    // Get friend's presence
    var presences = [];
    try {
        var statuses = nk.usersGetStatus([friendUserId]);
        if (statuses && statuses.length > 0) {
            presences = statuses[0].presences;
        }
    } catch (err) {
        return handleError(ctx, err, "Failed to get friend presence");
    }
    
    // Find if friend is in a match
    var matchId = null;
    for (var i = 0; i < presences.length; i++) {
        if (presences[i].status && presences[i].status.indexOf("match:") === 0) {
            matchId = presences[i].status.substring(6);
            break;
        }
    }
    
    if (!matchId) {
        return JSON.stringify({
            success: false,
            error: "Friend is not currently in a match"
        });
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        friendUserId: friendUserId,
        matchId: matchId,
        spectateReady: true,
        timestamp: getCurrentTimestamp()
    });
}

// Export RPC functions (ES Module syntax)

// ============================================================================
// GROUPS/GROUPS.JS
// ============================================================================

// groups.js - Groups/Clans/Guilds system for multi-game backend
// Provides comprehensive group management with roles, shared wallets, and group challenges

/**
 * Groups/Clans/Guilds System
 * 
 * Features:
 * - Create and manage groups with roles (Owner, Admin, Member)
 * - Group leaderboards and shared wallets
 * - Group XP and quest challenges
 * - Group chat channels (via Nakama built-in)
 * - Per-game group support
 */

// Group role hierarchy
var GROUP_ROLES = {
    OWNER: 0,      // Creator, full control
    ADMIN: 1,      // Can manage members, not delete group
    MEMBER: 2      // Regular member
};

// Group metadata structure
function createGroupMetadata(gameId, groupType, customData) {
    return {
        gameId: gameId,
        groupType: groupType || "guild",
        createdAt: new Date().toISOString(),
        level: 1,
        xp: 0,
        totalMembers: 1,
        customData: customData || {}
    };
}

/**
 * RPC: create_game_group
 * Create a group/clan/guild for a specific game
 */
function rpcCreateGameGroup(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        // Validate required fields
        if (!data.gameId || !data.name) {
            return JSON.stringify({
                success: false,
                error: "Missing required fields: gameId, name"
            });
        }

        var gameId = data.gameId;
        var name = data.name;
        var description = data.description || "";
        var avatarUrl = data.avatarUrl || "";
        var langTag = data.langTag || "en";
        var open = data.open !== undefined ? data.open : false;
        var maxCount = data.maxCount || 100;
        var groupType = data.groupType || "guild";

        // Create group metadata
        var metadata = createGroupMetadata(gameId, groupType, data.customData);

        // Create group using Nakama's built-in Groups API
        var group;
        try {
            group = nk.groupCreate(
                ctx.userId,
                name,
                description,
                avatarUrl,
                langTag,
                JSON.stringify(metadata),
                open,
                maxCount
            );
        } catch (err) {
            logger.error("[Groups] Failed to create group: " + err.message);
            return JSON.stringify({
                success: false,
                error: "Failed to create group: " + err.message
            });
        }

        // Initialize group wallet
        try {
            var walletKey = "group_wallet_" + group.id;
            nk.storageWrite([{
                collection: "group_wallets",
                key: walletKey,
                userId: "00000000-0000-0000-0000-000000000000",
                value: {
                    groupId: group.id,
                    gameId: gameId,
                    currencies: {
                        tokens: 0,
                        xp: 0
                    },
                    createdAt: new Date().toISOString()
                },
                permissionRead: 1,
                permissionWrite: 0
            }]);
        } catch (err) {
            logger.warn("[Groups] Failed to create group wallet: " + err.message);
        }

        logger.info("[Groups] Created group: " + group.id + " for game: " + gameId);

        return JSON.stringify({
            success: true,
            group: {
                id: group.id,
                creatorId: group.creatorId,
                name: group.name,
                description: group.description,
                avatarUrl: group.avatarUrl,
                langTag: group.langTag,
                open: group.open,
                edgeCount: group.edgeCount,
                maxCount: group.maxCount,
                createTime: group.createTime,
                updateTime: group.updateTime,
                metadata: metadata
            },
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcCreateGameGroup: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

/**
 * RPC: update_group_xp
 * Update group XP (for challenges/quests)
 */
function rpcUpdateGroupXP(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        if (!data.groupId || data.xp === undefined) {
            return JSON.stringify({
                success: false,
                error: "Missing required fields: groupId, xp"
            });
        }

        var groupId = data.groupId;
        var xpToAdd = parseInt(data.xp);

        // Get group to verify it exists and get metadata
        var groups;
        try {
            groups = nk.groupsGetId([groupId]);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Group not found"
            });
        }

        if (!groups || groups.length === 0) {
            return JSON.stringify({
                success: false,
                error: "Group not found"
            });
        }

        var group = groups[0];
        var metadata = JSON.parse(group.metadata || "{}");
        
        // Update XP
        metadata.xp = (metadata.xp || 0) + xpToAdd;
        
        // Calculate level (100 XP per level)
        var newLevel = Math.floor(metadata.xp / 100) + 1;
        var leveledUp = newLevel > (metadata.level || 1);
        metadata.level = newLevel;

        // Update group metadata
        try {
            nk.groupUpdate(
                groupId,
                ctx.userId,
                group.name,
                group.description,
                group.avatarUrl,
                group.langTag,
                JSON.stringify(metadata),
                group.open,
                group.maxCount
            );
        } catch (err) {
            logger.error("[Groups] Failed to update group: " + err.message);
            return JSON.stringify({
                success: false,
                error: "Failed to update group XP"
            });
        }

        logger.info("[Groups] Updated group XP: " + groupId + " +" + xpToAdd + " XP");

        return JSON.stringify({
            success: true,
            groupId: groupId,
            xpAdded: xpToAdd,
            totalXP: metadata.xp,
            level: metadata.level,
            leveledUp: leveledUp,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcUpdateGroupXP: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

/**
 * RPC: get_group_wallet
 * Get group's shared wallet
 */
function rpcGetGroupWallet(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        if (!data.groupId) {
            return JSON.stringify({
                success: false,
                error: "Missing required field: groupId"
            });
        }

        var groupId = data.groupId;
        var walletKey = "group_wallet_" + groupId;

        // Read wallet from storage
        var records;
        try {
            records = nk.storageRead([{
                collection: "group_wallets",
                key: walletKey,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Failed to read group wallet"
            });
        }

        if (!records || records.length === 0) {
            // Initialize wallet if it doesn't exist
            var wallet = {
                groupId: groupId,
                gameId: data.gameId || "",
                currencies: {
                    tokens: 0,
                    xp: 0
                },
                createdAt: new Date().toISOString()
            };

            try {
                nk.storageWrite([{
                    collection: "group_wallets",
                    key: walletKey,
                    userId: "00000000-0000-0000-0000-000000000000",
                    value: wallet,
                    permissionRead: 1,
                    permissionWrite: 0
                }]);
            } catch (err) {
                logger.warn("[Groups] Failed to create group wallet: " + err.message);
            }

            return JSON.stringify({
                success: true,
                wallet: wallet,
                timestamp: new Date().toISOString()
            });
        }

        return JSON.stringify({
            success: true,
            wallet: records[0].value,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcGetGroupWallet: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

/**
 * RPC: update_group_wallet
 * Update group's shared wallet (admins only)
 */
function rpcUpdateGroupWallet(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        if (!data.groupId || !data.currency || data.amount === undefined || !data.operation) {
            return JSON.stringify({
                success: false,
                error: "Missing required fields: groupId, currency, amount, operation"
            });
        }

        var groupId = data.groupId;
        var currency = data.currency;
        var amount = parseInt(data.amount);
        var operation = data.operation; // "add" or "subtract"

        // Verify user is admin of the group
        var userGroups;
        try {
            userGroups = nk.userGroupsList(ctx.userId);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Failed to verify group membership"
            });
        }

        var isAdmin = false;
        if (userGroups && userGroups.userGroups) {
            for (var i = 0; i < userGroups.userGroups.length; i++) {
                var ug = userGroups.userGroups[i];
                if (ug.group.id === groupId && (ug.state <= GROUP_ROLES.ADMIN)) {
                    isAdmin = true;
                    break;
                }
            }
        }

        if (!isAdmin) {
            return JSON.stringify({
                success: false,
                error: "Only group admins can update group wallet"
            });
        }

        // Get current wallet
        var walletKey = "group_wallet_" + groupId;
        var records;
        try {
            records = nk.storageRead([{
                collection: "group_wallets",
                key: walletKey,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Failed to read group wallet"
            });
        }

        if (!records || records.length === 0) {
            return JSON.stringify({
                success: false,
                error: "Group wallet not found"
            });
        }

        var wallet = records[0].value;
        var currentBalance = wallet.currencies[currency] || 0;
        var newBalance;

        if (operation === "add") {
            newBalance = currentBalance + amount;
        } else if (operation === "subtract") {
            newBalance = currentBalance - amount;
            if (newBalance < 0) {
                return JSON.stringify({
                    success: false,
                    error: "Insufficient balance"
                });
            }
        } else {
            return JSON.stringify({
                success: false,
                error: "Invalid operation. Use 'add' or 'subtract'"
            });
        }

        wallet.currencies[currency] = newBalance;

        // Update wallet
        try {
            nk.storageWrite([{
                collection: "group_wallets",
                key: walletKey,
                userId: "00000000-0000-0000-0000-000000000000",
                value: wallet,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Failed to update group wallet"
            });
        }

        logger.info("[Groups] Updated group wallet: " + groupId + " " + operation + " " + amount + " " + currency);

        return JSON.stringify({
            success: true,
            groupId: groupId,
            currency: currency,
            operation: operation,
            amount: amount,
            newBalance: newBalance,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcUpdateGroupWallet: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

/**
 * RPC: get_user_groups
 * Get all groups for a user (filtered by gameId if provided)
 */
function rpcGetUserGroups(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload || "{}");
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        var gameId = data.gameId || null;

        // Get user groups
        var userGroups;
        try {
            userGroups = nk.userGroupsList(ctx.userId);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Failed to retrieve user groups"
            });
        }

        var groups = [];
        if (userGroups && userGroups.userGroups) {
            for (var i = 0; i < userGroups.userGroups.length; i++) {
                var ug = userGroups.userGroups[i];
                var group = ug.group;
                var metadata = JSON.parse(group.metadata || "{}");

                // Filter by gameId if provided
                if (gameId && metadata.gameId !== gameId) {
                    continue;
                }

                groups.push({
                    id: group.id,
                    name: group.name,
                    description: group.description,
                    avatarUrl: group.avatarUrl,
                    langTag: group.langTag,
                    open: group.open,
                    edgeCount: group.edgeCount,
                    maxCount: group.maxCount,
                    createTime: group.createTime,
                    updateTime: group.updateTime,
                    metadata: metadata,
                    userRole: ug.state,
                    userRoleName: getRoleName(ug.state)
                });
            }
        }

        return JSON.stringify({
            success: true,
            userId: ctx.userId,
            gameId: gameId,
            groups: groups,
            count: groups.length,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcGetUserGroups: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

function getRoleName(state) {
    if (state === GROUP_ROLES.OWNER) return "Owner";
    if (state === GROUP_ROLES.ADMIN) return "Admin";
    if (state === GROUP_ROLES.MEMBER) return "Member";
    return "Unknown";
}

// Export functions (ES Module syntax)

// ============================================================================
// PUSH_NOTIFICATIONS/PUSH_NOTIFICATIONS.JS
// ============================================================================

// push_notifications.js - Push Notification System (AWS SNS + Pinpoint + Lambda)
// Unity does NOT use AWS SDK - Unity only sends raw push tokens
// Nakama forwards to AWS Lambda Function URL for endpoint creation


/**
 * Lambda Function URL for push endpoint registration
 * This should be configured in your environment
 */
var LAMBDA_FUNCTION_URL = "https://your-lambda-url.lambda-url.region.on.aws/register-endpoint";

/**
 * Lambda Function URL for sending push notifications
 */
var LAMBDA_PUSH_URL = "https://your-lambda-url.lambda-url.region.on.aws/send-push";

/**
 * Platform token types
 */
var PLATFORM_TYPES = {
    ios: "APNS",
    android: "FCM", 
    web: "FCM",
    windows: "WNS"
};

/**
 * Store endpoint ARN for user device
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {string} platform - Platform type (ios, android, web, windows)
 * @param {string} endpointArn - SNS endpoint ARN
 * @returns {boolean} Success status
 */
function storeEndpointArn(nk, logger, userId, gameId, platform, endpointArn) {
    var collection = "push_endpoints";
    var key = "push_endpoint_" + userId + "_" + gameId + "_" + platform;
    
    var data = {
        userId: userId,
        gameId: gameId,
        platform: platform,
        endpointArn: endpointArn,
        createdAt: getCurrentTimestamp(),
        updatedAt: getCurrentTimestamp()
    };
    
    return writeStorage(nk, logger, collection, key, userId, data);
}

/**
 * Get endpoint ARN for user device
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {string} platform - Platform type
 * @returns {object|null} Endpoint data or null
 */
function getEndpointArn(nk, logger, userId, gameId, platform) {
    var collection = "push_endpoints";
    var key = "push_endpoint_" + userId + "_" + gameId + "_" + platform;
    return readStorage(nk, logger, collection, key, userId);
}

/**
 * Get all endpoint ARNs for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @returns {Array} List of endpoint data
 */
function getAllEndpointArns(nk, logger, userId, gameId) {
    var collection = "push_endpoints";
    var endpoints = [];
    
    try {
        var records = nk.storageList(userId, collection, 100);
        for (var i = 0; i < records.length; i++) {
            var value = records[i].value;
            if (value.gameId === gameId) {
                endpoints.push(value);
            }
        }
    } catch (err) {
        logWarn(logger, "Failed to list endpoints: " + err.message);
    }
    
    return endpoints;
}

/**
 * RPC: Register device token
 * Unity sends raw device token, Nakama forwards to Lambda
 * Lambda creates SNS endpoint and returns ARN
 * 
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with:
 *   {
 *     gameId: "uuid",
 *     platform: "ios"|"android"|"web"|"windows",
 *     token: "raw_device_token"
 *   }
 * @returns {string} JSON response
 */
function rpcPushRegisterToken(ctx, logger, nk, payload) {
    logInfo(logger, "RPC push_register_token called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['gameId', 'platform', 'token']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!isValidUUID(gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var platform = data.platform;
    var token = data.token;
    
    // Validate platform
    if (!PLATFORM_TYPES[platform]) {
        return handleError(ctx, null, "Invalid platform. Must be: ios, android, web, or windows");
    }
    
    logInfo(logger, "Registering " + platform + " push token for user " + userId);
    
    // Call Lambda to create SNS endpoint
    var lambdaPayload = {
        userId: userId,
        gameId: gameId,
        platform: platform,
        platformType: PLATFORM_TYPES[platform],
        deviceToken: token
    };
    
    var lambdaResponse;
    try {
        lambdaResponse = nk.httpRequest(
            LAMBDA_FUNCTION_URL,
            "post",
            {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            JSON.stringify(lambdaPayload)
        );
    } catch (err) {
        logError(logger, "Lambda request failed: " + err.message);
        return handleError(ctx, err, "Failed to register push token with Lambda");
    }
    
    if (lambdaResponse.code !== 200 && lambdaResponse.code !== 201) {
        logError(logger, "Lambda returned code " + lambdaResponse.code);
        return handleError(ctx, null, "Lambda endpoint registration failed with code " + lambdaResponse.code);
    }
    
    var lambdaData;
    try {
        lambdaData = JSON.parse(lambdaResponse.body);
    } catch (err) {
        return handleError(ctx, null, "Invalid Lambda response JSON");
    }
    
    if (!lambdaData.success || !lambdaData.snsEndpointArn) {
        return handleError(ctx, null, "Lambda did not return endpoint ARN: " + (lambdaData.error || "Unknown error"));
    }
    
    var endpointArn = lambdaData.snsEndpointArn;
    
    // Store endpoint ARN
    if (!storeEndpointArn(nk, logger, userId, gameId, platform, endpointArn)) {
        return handleError(ctx, null, "Failed to store endpoint ARN");
    }
    
    logInfo(logger, "Successfully registered push endpoint: " + endpointArn);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        platform: platform,
        endpointArn: endpointArn,
        registeredAt: getCurrentTimestamp()
    });
}

/**
 * RPC: Send push notification event
 * Server-side triggered push notifications
 * 
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with:
 *   {
 *     targetUserId: "uuid",
 *     gameId: "uuid",
 *     eventType: "daily_reward_available|mission_completed|streak_warning|friend_online|etc",
 *     title: "Notification Title",
 *     body: "Notification Body",
 *     data: { custom: "data" }
 *   }
 * @returns {string} JSON response
 */
function rpcPushSendEvent(ctx, logger, nk, payload) {
    logInfo(logger, "RPC push_send_event called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['targetUserId', 'gameId', 'eventType', 'title', 'body']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!isValidUUID(gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var targetUserId = data.targetUserId;
    var eventType = data.eventType;
    var title = data.title;
    var body = data.body;
    var customData = data.data || {};
    
    logInfo(logger, "Sending push notification to user " + targetUserId + " for event " + eventType);
    
    // Get all endpoints for target user
    var endpoints = getAllEndpointArns(nk, logger, targetUserId, gameId);
    
    if (endpoints.length === 0) {
        return JSON.stringify({
            success: false,
            error: "No registered push endpoints for user"
        });
    }
    
    var sentCount = 0;
    var errors = [];
    
    // Send to each endpoint
    for (var i = 0; i < endpoints.length; i++) {
        var endpoint = endpoints[i];
        
        var pushPayload = {
            endpointArn: endpoint.endpointArn,
            platform: endpoint.platform,
            title: title,
            body: body,
            data: customData,
            gameId: gameId,
            eventType: eventType
        };
        
        try {
            var lambdaResponse = nk.httpRequest(
                LAMBDA_PUSH_URL,
                "post",
                {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                JSON.stringify(pushPayload)
            );
            
            if (lambdaResponse.code === 200 || lambdaResponse.code === 201) {
                sentCount++;
                logInfo(logger, "Push sent to " + endpoint.platform + " endpoint");
            } else {
                errors.push({
                    platform: endpoint.platform,
                    error: "Lambda returned code " + lambdaResponse.code
                });
            }
        } catch (err) {
            errors.push({
                platform: endpoint.platform,
                error: err.message
            });
            logWarn(logger, "Failed to send push to " + endpoint.platform + ": " + err.message);
        }
    }
    
    // Log notification event
    var notificationLog = {
        targetUserId: targetUserId,
        gameId: gameId,
        eventType: eventType,
        title: title,
        body: body,
        sentCount: sentCount,
        totalEndpoints: endpoints.length,
        timestamp: getCurrentTimestamp()
    };
    
    var logKey = "push_log_" + targetUserId + "_" + getUnixTimestamp();
    writeStorage(nk, logger, "push_notification_logs", logKey, targetUserId, notificationLog);
    
    return JSON.stringify({
        success: sentCount > 0,
        targetUserId: targetUserId,
        gameId: gameId,
        eventType: eventType,
        sentCount: sentCount,
        totalEndpoints: endpoints.length,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: getCurrentTimestamp()
    });
}

/**
 * RPC: Get user's registered endpoints
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 * @returns {string} JSON response
 */
function rpcPushGetEndpoints(ctx, logger, nk, payload) {
    logInfo(logger, "RPC push_get_endpoints called");
    
    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!isValidUUID(gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }
    
    var endpoints = getAllEndpointArns(nk, logger, userId, gameId);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        endpoints: endpoints,
        count: endpoints.length,
        timestamp: getCurrentTimestamp()
    });
}

// Export RPC functions (ES Module syntax)

// ============================================================================
// LEADERBOARDS_TIMEPERIOD.JS
// ============================================================================

// leaderboards_timeperiod.js - Time-based leaderboard management (daily, weekly, monthly)

/**
 * This module provides functionality to create and manage time-period leaderboards
 * for each gameID. It supports:
 * - Daily leaderboards (reset at midnight UTC)
 * - Weekly leaderboards (reset Sunday at midnight UTC)
 * - Monthly leaderboards (reset on the 1st of the month at midnight UTC)
 * - All-time leaderboards (no reset)
 */

// Leaderboard reset schedules (cron format)
var RESET_SCHEDULES = {
    daily: "0 0 * * *",      // Every day at midnight UTC
    weekly: "0 0 * * 0",     // Every Sunday at midnight UTC
    monthly: "0 0 1 * *",    // First day of month at midnight UTC
    alltime: ""              // No reset (all-time)
};

// Leaderboard configuration
var LEADERBOARD_CONFIG = {
    sort: "desc",            // Descending order (highest scores first)
    operator: "best",        // Keep best score per user
    authoritative: true      // Server-authoritative (clients can't write directly)
};

/**
 * Create all time-period leaderboards for a specific game
 * @param {*} nk - Nakama runtime
 * @param {*} logger - Logger instance
 * @param {string} gameId - Game UUID
 * @param {string} gameTitle - Game title for metadata
 * @returns {object} Result with created leaderboards
 */
function createGameLeaderboards(nk, logger, gameId, gameTitle) {
    var created = [];
    var skipped = [];
    var errors = [];

    // Create leaderboards for each time period
    var periods = ['daily', 'weekly', 'monthly', 'alltime'];
    
    for (var i = 0; i < periods.length; i++) {
        var period = periods[i];
        var leaderboardId = "leaderboard_" + gameId + "_" + period;
        var resetSchedule = RESET_SCHEDULES[period];
        
        try {
            // Check if leaderboard already exists
            var existing = null;
            try {
                existing = nk.leaderboardsGetId([leaderboardId]);
                if (existing && existing.length > 0) {
                    logger.info("[Leaderboards] Leaderboard already exists: " + leaderboardId);
                    skipped.push({
                        leaderboardId: leaderboardId,
                        period: period,
                        gameId: gameId
                    });
                    continue;
                }
            } catch (e) {
                // Leaderboard doesn't exist, proceed to create
            }

            // Create leaderboard
            var metadata = {
                gameId: gameId,
                gameTitle: gameTitle || "Untitled Game",
                scope: "game",
                timePeriod: period,
                resetSchedule: resetSchedule,
                description: period.charAt(0).toUpperCase() + period.slice(1) + " Leaderboard for " + (gameTitle || gameId)
            };

            nk.leaderboardCreate(
                leaderboardId,
                LEADERBOARD_CONFIG.authoritative,
                LEADERBOARD_CONFIG.sort,
                LEADERBOARD_CONFIG.operator,
                resetSchedule,
                metadata
            );

            logger.info("[Leaderboards] Created " + period + " leaderboard: " + leaderboardId);
            created.push({
                leaderboardId: leaderboardId,
                period: period,
                gameId: gameId,
                resetSchedule: resetSchedule
            });

        } catch (err) {
            logger.error("[Leaderboards] Failed to create " + period + " leaderboard for game " + gameId + ": " + err.message);
            errors.push({
                leaderboardId: leaderboardId,
                period: period,
                gameId: gameId,
                error: err.message
            });
        }
    }

    return {
        gameId: gameId,
        created: created,
        skipped: skipped,
        errors: errors
    };
}

/**
 * Create global time-period leaderboards
 * @param {*} nk - Nakama runtime
 * @param {*} logger - Logger instance
 * @returns {object} Result with created leaderboards
 */
function createGlobalLeaderboards(nk, logger) {
    var created = [];
    var skipped = [];
    var errors = [];

    var periods = ['daily', 'weekly', 'monthly', 'alltime'];
    
    for (var i = 0; i < periods.length; i++) {
        var period = periods[i];
        var leaderboardId = "leaderboard_global_" + period;
        var resetSchedule = RESET_SCHEDULES[period];
        
        try {
            // Check if leaderboard already exists
            var existing = null;
            try {
                existing = nk.leaderboardsGetId([leaderboardId]);
                if (existing && existing.length > 0) {
                    logger.info("[Leaderboards] Global leaderboard already exists: " + leaderboardId);
                    skipped.push({
                        leaderboardId: leaderboardId,
                        period: period,
                        scope: "global"
                    });
                    continue;
                }
            } catch (e) {
                // Leaderboard doesn't exist, proceed to create
            }

            // Create global leaderboard
            var metadata = {
                scope: "global",
                timePeriod: period,
                resetSchedule: resetSchedule,
                description: period.charAt(0).toUpperCase() + period.slice(1) + " Global Ecosystem Leaderboard"
            };

            nk.leaderboardCreate(
                leaderboardId,
                LEADERBOARD_CONFIG.authoritative,
                LEADERBOARD_CONFIG.sort,
                LEADERBOARD_CONFIG.operator,
                resetSchedule,
                metadata
            );

            logger.info("[Leaderboards] Created global " + period + " leaderboard: " + leaderboardId);
            created.push({
                leaderboardId: leaderboardId,
                period: period,
                scope: "global",
                resetSchedule: resetSchedule
            });

        } catch (err) {
            logger.error("[Leaderboards] Failed to create global " + period + " leaderboard: " + err.message);
            errors.push({
                leaderboardId: leaderboardId,
                period: period,
                scope: "global",
                error: err.message
            });
        }
    }

    return {
        created: created,
        skipped: skipped,
        errors: errors
    };
}

/**
 * RPC: create_time_period_leaderboards
 * Creates daily, weekly, monthly, and all-time leaderboards for all games
 */
function rpcCreateTimePeriodLeaderboards(ctx, logger, nk, payload) {
    try {
        logger.info("[Leaderboards] Creating time-period leaderboards for all games...");

        // OAuth configuration
        var tokenUrl = "https://api.intelli-verse-x.ai/api/admin/oauth/token";
        var gamesUrl = "https://api.intelli-verse-x.ai/api/games/games/all";
        var client_id = "54clc0uaqvr1944qvkas63o0rb";
        var client_secret = "1eb7ooua6ft832nh8dpmi37mos4juqq27svaqvmkt5grc3b7e377";

        // Step 1: Get OAuth token
        logger.info("[Leaderboards] Requesting IntelliVerse OAuth token...");
        var tokenResponse;
        try {
            tokenResponse = nk.httpRequest(tokenUrl, "post", {
                "accept": "application/json",
                "Content-Type": "application/json"
            }, JSON.stringify({
                client_id: client_id,
                client_secret: client_secret
            }));
        } catch (err) {
            logger.error("[Leaderboards] Token request failed: " + err.message);
            return JSON.stringify({ 
                success: false, 
                error: "Failed to authenticate with IntelliVerse API: " + err.message 
            });
        }

        if (tokenResponse.code !== 200 && tokenResponse.code !== 201) {
            return JSON.stringify({ 
                success: false, 
                error: "Token request failed with status code " + tokenResponse.code 
            });
        }

        var tokenData;
        try {
            tokenData = JSON.parse(tokenResponse.body);
        } catch (err) {
            return JSON.stringify({ 
                success: false, 
                error: "Invalid token response format" 
            });
        }

        var accessToken = tokenData.access_token;
        if (!accessToken) {
            return JSON.stringify({ 
                success: false, 
                error: "No access token received from IntelliVerse API" 
            });
        }

        // Step 2: Fetch game list
        logger.info("[Leaderboards] Fetching game list from IntelliVerse...");
        var gameResponse;
        try {
            gameResponse = nk.httpRequest(gamesUrl, "get", {
                "accept": "application/json",
                "Authorization": "Bearer " + accessToken
            });
        } catch (err) {
            logger.error("[Leaderboards] Game fetch failed: " + err.message);
            return JSON.stringify({ 
                success: false, 
                error: "Failed to fetch games from IntelliVerse API: " + err.message 
            });
        }

        if (gameResponse.code !== 200) {
            return JSON.stringify({ 
                success: false, 
                error: "Games API responded with status code " + gameResponse.code 
            });
        }

        var games;
        try {
            var parsed = JSON.parse(gameResponse.body);
            games = parsed.data || [];
        } catch (err) {
            return JSON.stringify({ 
                success: false, 
                error: "Invalid games response format" 
            });
        }

        logger.info("[Leaderboards] Found " + games.length + " games");

        // Step 3: Create global leaderboards
        var globalResult = createGlobalLeaderboards(nk, logger);

        // Step 4: Create per-game leaderboards
        var gameResults = [];
        var totalCreated = globalResult.created.length;
        var totalSkipped = globalResult.skipped.length;
        var totalErrors = globalResult.errors.length;

        for (var i = 0; i < games.length; i++) {
            var game = games[i];
            if (!game.id) {
                logger.warn("[Leaderboards] Skipping game with no ID");
                continue;
            }

            var gameResult = createGameLeaderboards(
                nk, 
                logger, 
                game.id, 
                game.gameTitle || game.name || "Untitled Game"
            );

            gameResults.push(gameResult);
            totalCreated += gameResult.created.length;
            totalSkipped += gameResult.skipped.length;
            totalErrors += gameResult.errors.length;
        }

        // Step 5: Store leaderboard registry
        var allLeaderboards = [];
        
        // Add global leaderboards
        for (var i = 0; i < globalResult.created.length; i++) {
            allLeaderboards.push(globalResult.created[i]);
        }
        for (var i = 0; i < globalResult.skipped.length; i++) {
            allLeaderboards.push(globalResult.skipped[i]);
        }

        // Add game leaderboards
        for (var i = 0; i < gameResults.length; i++) {
            var result = gameResults[i];
            for (var j = 0; j < result.created.length; j++) {
                allLeaderboards.push(result.created[j]);
            }
            for (var j = 0; j < result.skipped.length; j++) {
                allLeaderboards.push(result.skipped[j]);
            }
        }

        // Save to storage
        try {
            nk.storageWrite([{
                collection: "leaderboards_registry",
                key: "time_period_leaderboards",
                userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
                value: {
                    leaderboards: allLeaderboards,
                    lastUpdated: new Date().toISOString(),
                    totalGames: games.length
                },
                permissionRead: 1,
                permissionWrite: 0
            }]);
            logger.info("[Leaderboards] Stored " + allLeaderboards.length + " leaderboard records");
        } catch (err) {
            logger.error("[Leaderboards] Failed to store registry: " + err.message);
        }

        logger.info("[Leaderboards] Time-period leaderboard creation complete");
        logger.info("[Leaderboards] Created: " + totalCreated + ", Skipped: " + totalSkipped + ", Errors: " + totalErrors);

        return JSON.stringify({
            success: true,
            summary: {
                totalCreated: totalCreated,
                totalSkipped: totalSkipped,
                totalErrors: totalErrors,
                gamesProcessed: games.length
            },
            global: globalResult,
            games: gameResults,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Leaderboards] Unexpected error in rpcCreateTimePeriodLeaderboards: " + err.message);
        return JSON.stringify({ 
            success: false, 
            error: "An unexpected error occurred: " + err.message 
        });
    }
}

/**
 * RPC: submit_score_to_time_periods
 * Submit a score to all time-period leaderboards for a specific game
 */
function rpcSubmitScoreToTimePeriods(ctx, logger, nk, payload) {
    try {
        // Validate authentication
        if (!ctx.userId) {
            return JSON.stringify({ 
                success: false, 
                error: "Authentication required" 
            });
        }

        // Parse payload
        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return JSON.stringify({ 
                success: false, 
                error: "Invalid JSON payload" 
            });
        }

        // Validate required fields
        if (!data.gameId) {
            return JSON.stringify({ 
                success: false, 
                error: "Missing required field: gameId" 
            });
        }

        if (data.score === null || data.score === undefined) {
            return JSON.stringify({ 
                success: false, 
                error: "Missing required field: score" 
            });
        }

        var gameId = data.gameId;
        var score = parseInt(data.score);
        var subscore = parseInt(data.subscore) || 0;
        var metadata = data.metadata || {};

        if (isNaN(score)) {
            return JSON.stringify({ 
                success: false, 
                error: "Score must be a valid number" 
            });
        }

        var userId = ctx.userId;
        var username = ctx.username || userId;

        // Add submission metadata
        metadata.submittedAt = new Date().toISOString();
        metadata.gameId = gameId;
        metadata.source = "submit_score_to_time_periods";

        // Submit to all time-period leaderboards
        var periods = ['daily', 'weekly', 'monthly', 'alltime'];
        var results = [];
        var errors = [];

        // Submit to game leaderboards
        for (var i = 0; i < periods.length; i++) {
            var period = periods[i];
            var leaderboardId = "leaderboard_" + gameId + "_" + period;
            
            try {
                nk.leaderboardRecordWrite(
                    leaderboardId,
                    userId,
                    username,
                    score,
                    subscore,
                    metadata
                );
                results.push({
                    leaderboardId: leaderboardId,
                    period: period,
                    scope: "game",
                    success: true
                });
                logger.info("[Leaderboards] Score written to " + period + " leaderboard: " + leaderboardId);
            } catch (err) {
                logger.error("[Leaderboards] Failed to write to " + period + " leaderboard: " + err.message);
                errors.push({
                    leaderboardId: leaderboardId,
                    period: period,
                    scope: "game",
                    error: err.message
                });
            }
        }

        // Submit to global leaderboards
        for (var i = 0; i < periods.length; i++) {
            var period = periods[i];
            var leaderboardId = "leaderboard_global_" + period;
            
            try {
                nk.leaderboardRecordWrite(
                    leaderboardId,
                    userId,
                    username,
                    score,
                    subscore,
                    metadata
                );
                results.push({
                    leaderboardId: leaderboardId,
                    period: period,
                    scope: "global",
                    success: true
                });
                logger.info("[Leaderboards] Score written to global " + period + " leaderboard");
            } catch (err) {
                logger.error("[Leaderboards] Failed to write to global " + period + " leaderboard: " + err.message);
                errors.push({
                    leaderboardId: leaderboardId,
                    period: period,
                    scope: "global",
                    error: err.message
                });
            }
        }

        return JSON.stringify({
            success: true,
            gameId: gameId,
            score: score,
            userId: userId,
            results: results,
            errors: errors,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Leaderboards] Unexpected error in rpcSubmitScoreToTimePeriods: " + err.message);
        return JSON.stringify({ 
            success: false, 
            error: "An unexpected error occurred: " + err.message 
        });
    }
}

/**
 * RPC: get_time_period_leaderboard
 * Get leaderboard records for a specific time period
 */
function rpcGetTimePeriodLeaderboard(ctx, logger, nk, payload) {
    try {
        // Parse payload
        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return JSON.stringify({ 
                success: false, 
                error: "Invalid JSON payload" 
            });
        }

        // Validate required fields
        if (!data.gameId && data.scope !== "global") {
            return JSON.stringify({ 
                success: false, 
                error: "Missing required field: gameId (or set scope to 'global')" 
            });
        }

        if (!data.period) {
            return JSON.stringify({ 
                success: false, 
                error: "Missing required field: period (daily, weekly, monthly, or alltime)" 
            });
        }

        var period = data.period;
        var validPeriods = ['daily', 'weekly', 'monthly', 'alltime'];
        if (validPeriods.indexOf(period) === -1) {
            return JSON.stringify({ 
                success: false, 
                error: "Invalid period. Must be one of: daily, weekly, monthly, alltime" 
            });
        }

        // Build leaderboard ID
        var leaderboardId;
        if (data.scope === "global") {
            leaderboardId = "leaderboard_global_" + period;
        } else {
            leaderboardId = "leaderboard_" + data.gameId + "_" + period;
        }

        var limit = parseInt(data.limit) || 10;
        var cursor = data.cursor || "";
        var ownerIds = data.ownerIds || null;

        // Get leaderboard records
        try {
            var result = nk.leaderboardRecordsList(leaderboardId, ownerIds, limit, cursor, 0);
            
            return JSON.stringify({
                success: true,
                leaderboardId: leaderboardId,
                period: period,
                gameId: data.gameId,
                scope: data.scope || "game",
                records: result.records || [],
                ownerRecords: result.ownerRecords || [],
                prevCursor: result.prevCursor || "",
                nextCursor: result.nextCursor || "",
                rankCount: result.rankCount || 0
            });
        } catch (err) {
            logger.error("[Leaderboards] Failed to fetch leaderboard: " + err.message);
            return JSON.stringify({ 
                success: false, 
                error: "Failed to fetch leaderboard records: " + err.message 
            });
        }

    } catch (err) {
        logger.error("[Leaderboards] Unexpected error in rpcGetTimePeriodLeaderboard: " + err.message);
        return JSON.stringify({ 
            success: false, 
            error: "An unexpected error occurred: " + err.message 
        });
    }
}

// Export functions (ES Module syntax)

// ============================================================================
// MAIN INDEX.JS - LEADERBOARD CREATION
// ============================================================================

function createAllLeaderboardsPersistent(ctx, logger, nk, payload) {
    const tokenUrl = "https://api.intelli-verse-x.ai/api/admin/oauth/token";
    const gamesUrl = "https://api.intelli-verse-x.ai/api/games/games/all";
    const client_id = "54clc0uaqvr1944qvkas63o0rb";
    const client_secret = "1eb7ooua6ft832nh8dpmi37mos4juqq27svaqvmkt5grc3b7e377";
    const sort = "desc";
    const operator = "best";
    const resetSchedule = "0 0 * * 0";
    const collection = "leaderboards_registry";

    // Fetch existing records
    let existingRecords = [];
    try {
        const records = nk.storageRead([{ 
            collection: collection, 
            key: "all_created", 
            userId: ctx.userId || "00000000-0000-0000-0000-000000000000" 
        }]);
        if (records && records.length > 0 && records[0].value) {
            existingRecords = records[0].value;
        }
    } catch (err) {
        logger.warn("Failed to read existing leaderboard records: " + err);
    }

    const existingIds = new Set(existingRecords.map(function(r) { return r.leaderboardId; }));
    const created = [];
    const skipped = [];

    // Step 1: Request token
    logger.info("Requesting IntelliVerse OAuth token...");
    let tokenResponse;
    try {
        tokenResponse = nk.httpRequest(tokenUrl, "post", {
            "accept": "application/json",
            "Content-Type": "application/json"
        }, JSON.stringify({
            client_id: client_id,
            client_secret: client_secret
        }));
    } catch (err) {
        return JSON.stringify({ success: false, error: "Token request failed: " + err.message });
    }

    if (tokenResponse.code !== 200 && tokenResponse.code !== 201) {
        return JSON.stringify({ 
            success: false, 
            error: "Token request failed with code " + tokenResponse.code 
        });
    }

    let tokenData;
    try {
        tokenData = JSON.parse(tokenResponse.body);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid token response JSON." });
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
        return JSON.stringify({ success: false, error: "No access_token in response." });
    }

    // Step 2: Fetch game list
    logger.info("Fetching onboarded game list...");
    let gameResponse;
    try {
        gameResponse = nk.httpRequest(gamesUrl, "get", {
            "accept": "application/json",
            "Authorization": "Bearer " + accessToken
        });
    } catch (err) {
        return JSON.stringify({ success: false, error: "Game fetch failed: " + err.message });
    }

    if (gameResponse.code !== 200) {
        return JSON.stringify({ 
            success: false, 
            error: "Game API responded with " + gameResponse.code 
        });
    }

    let games;
    try {
        const parsed = JSON.parse(gameResponse.body);
        games = parsed.data || [];
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid games JSON format." });
    }

    // Step 3: Create global leaderboard
    const globalId = "leaderboard_global";
    if (!existingIds.has(globalId)) {
        try {
            nk.leaderboardCreate(
                globalId, 
                true, 
                sort, 
                operator, 
                resetSchedule, 
                { scope: "global", desc: "Global Ecosystem Leaderboard" }
            );
            created.push(globalId);
            existingRecords.push({ 
                leaderboardId: globalId, 
                scope: "global", 
                createdAt: new Date().toISOString() 
            });
            logger.info("Created global leaderboard: " + globalId);
        } catch (err) {
            logger.warn("Failed to create global leaderboard: " + err.message);
            skipped.push(globalId);
        }
    } else {
        skipped.push(globalId);
    }

    // Step 4: Create per-game leaderboards
    logger.info("Processing " + games.length + " games for leaderboard creation...");
    for (let i = 0; i < games.length; i++) {
        const game = games[i];
        if (!game.id) continue;

        const leaderboardId = "leaderboard_" + game.id;
        if (existingIds.has(leaderboardId)) {
            skipped.push(leaderboardId);
            continue;
        }

        try {
            nk.leaderboardCreate(
                leaderboardId, 
                true, 
                sort, 
                operator, 
                resetSchedule, 
                {
                    desc: "Leaderboard for " + (game.gameTitle || "Untitled Game"),
                    gameId: game.id,
                    scope: "game"
                }
            );
            created.push(leaderboardId);
            existingRecords.push({
                leaderboardId: leaderboardId,
                gameId: game.id,
                scope: "game",
                createdAt: new Date().toISOString()
            });
            logger.info("Created leaderboard: " + leaderboardId);
        } catch (err) {
            logger.warn("Failed to create leaderboard " + leaderboardId + ": " + err.message);
            skipped.push(leaderboardId);
        }
    }

    // Step 5: Persist records
    try {
        nk.storageWrite([{
            collection: collection,
            key: "all_created",
            userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
            value: existingRecords,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        logger.info("Persisted " + existingRecords.length + " leaderboard records to storage");
    } catch (err) {
        logger.error("Failed to write leaderboard records: " + err.message);
    }

    return JSON.stringify({
        success: true,
        created: created,
        skipped: skipped,
        totalProcessed: games.length,
        storedRecords: existingRecords.length
    });
}


// ============================================================================
// IDENTITY MODULE HELPERS (from identity.js)
// ============================================================================

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

// ============================================================================
// WALLET MODULE HELPERS (from wallet.js)
// ============================================================================

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

// ============================================================================
// LEADERBOARD MODULE HELPERS (from leaderboard.js)
// ============================================================================

/**
 * Get user's friends list
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @returns {array} Array of friend user IDs
 */
function getUserFriends(nk, logger, userId) {
    var friends = [];
    
    try {
        var friendsList = nk.friendsList(userId, 1000, null, null);
        if (friendsList && friendsList.friends) {
            for (var i = 0; i < friendsList.friends.length; i++) {
                var friend = friendsList.friends[i];
                if (friend.user && friend.user.id) {
                    friends.push(friend.user.id);
                }
            }
        }
        logger.info("[NAKAMA] Found " + friends.length + " friends for user " + userId);
    } catch (err) {
        logger.warn("[NAKAMA] Failed to get friends list: " + err.message);
    }
    
    return friends;
}

/**
 * Get all existing leaderboards from registry
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @returns {array} Array of leaderboard IDs
 */
function getAllLeaderboardIds(nk, logger) {
    var leaderboardIds = [];
    
    // Read from leaderboards_registry
    try {
        var records = nk.storageRead([{
            collection: "leaderboards_registry",
            key: "all_created",
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            var registry = records[0].value;
            for (var i = 0; i < registry.length; i++) {
                if (registry[i].leaderboardId) {
                    leaderboardIds.push(registry[i].leaderboardId);
                }
            }
        }
    } catch (err) {
        logger.warn("[NAKAMA] Failed to read leaderboards registry: " + err.message);
    }
    
    // Also read from time_period_leaderboards registry
    try {
        var timePeriodRecords = nk.storageRead([{
            collection: "leaderboards_registry",
            key: "time_period_leaderboards",
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (timePeriodRecords && timePeriodRecords.length > 0 && timePeriodRecords[0].value) {
            var timePeriodRegistry = timePeriodRecords[0].value;
            if (timePeriodRegistry.leaderboards) {
                for (var i = 0; i < timePeriodRegistry.leaderboards.length; i++) {
                    var lb = timePeriodRegistry.leaderboards[i];
                    if (lb.leaderboardId && leaderboardIds.indexOf(lb.leaderboardId) === -1) {
                        leaderboardIds.push(lb.leaderboardId);
                    }
                }
            }
        }
    } catch (err) {
        logger.warn("[NAKAMA] Failed to read time period leaderboards registry: " + err.message);
    }
    
    logger.info("[NAKAMA] Found " + leaderboardIds.length + " existing leaderboards in registry");
    return leaderboardIds;
}

/**
 * Ensure a leaderboard exists, creating it if necessary
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} leaderboardId - Leaderboard ID
 * @param {string} resetSchedule - Optional cron reset schedule
 * @param {object} metadata - Optional metadata
 * @returns {boolean} true if leaderboard exists or was created
 */
function ensureLeaderboardExists(nk, logger, leaderboardId, resetSchedule, metadata) {
    try {
        // Try to create the leaderboard - if it exists, this will fail silently
        nk.leaderboardCreate(
            leaderboardId,
            LEADERBOARD_CONFIG.authoritative,
            LEADERBOARD_CONFIG.sort,
            LEADERBOARD_CONFIG.operator,
            resetSchedule || "",
            metadata || {}
        );
        logger.info("[NAKAMA] Created leaderboard: " + leaderboardId);
        return true;
    } catch (err) {
        // Leaderboard likely already exists, which is fine
        return true;
    }
}

/**
 * Write score to all relevant leaderboards
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} username - Username
 * @param {string} gameId - Game UUID
 * @param {number} score - Score value
 * @returns {array} Array of leaderboards updated
 */
function writeToAllLeaderboards(nk, logger, userId, username, gameId, score) {
    var leaderboardsUpdated = [];
    var metadata = {
        source: "submit_score_and_sync",
        gameId: gameId,
        submittedAt: new Date().toISOString()
    };
    
    // 1. Write to main game leaderboard
    var gameLeaderboardId = "leaderboard_" + gameId;
    ensureLeaderboardExists(nk, logger, gameLeaderboardId, "", { scope: "game", gameId: gameId, description: "Main leaderboard for game " + gameId });
    try {
        nk.leaderboardRecordWrite(gameLeaderboardId, userId, username, score, 0, metadata);
        leaderboardsUpdated.push(gameLeaderboardId);
        logger.info("[NAKAMA] Score written to " + gameLeaderboardId);
    } catch (err) {
        logger.warn("[NAKAMA] Failed to write to " + gameLeaderboardId + ": " + err.message);
    }
    
    // 2. Write to time-period game leaderboards
    var timePeriods = ["daily", "weekly", "monthly", "alltime"];
    for (var i = 0; i < timePeriods.length; i++) {
        var period = timePeriods[i];
        var periodLeaderboardId = "leaderboard_" + gameId + "_" + period;
        var resetSchedule = RESET_SCHEDULES[period];
        ensureLeaderboardExists(nk, logger, periodLeaderboardId, resetSchedule, { 
            scope: "game", 
            gameId: gameId, 
            timePeriod: period,
            description: period.charAt(0).toUpperCase() + period.slice(1) + " leaderboard for game " + gameId
        });
        try {
            nk.leaderboardRecordWrite(periodLeaderboardId, userId, username, score, 0, metadata);
            leaderboardsUpdated.push(periodLeaderboardId);
            logger.info("[NAKAMA] Score written to " + periodLeaderboardId);
        } catch (err) {
            logger.warn("[NAKAMA] Failed to write to " + periodLeaderboardId + ": " + err.message);
        }
    }
    
    // 3. Write to global leaderboards
    var globalLeaderboardId = "leaderboard_global";
    ensureLeaderboardExists(nk, logger, globalLeaderboardId, "", { scope: "global", description: "Global all-time leaderboard" });
    try {
        nk.leaderboardRecordWrite(globalLeaderboardId, userId, username, score, 0, metadata);
        leaderboardsUpdated.push(globalLeaderboardId);
        logger.info("[NAKAMA] Score written to " + globalLeaderboardId);
    } catch (err) {
        logger.warn("[NAKAMA] Failed to write to " + globalLeaderboardId + ": " + err.message);
    }
    
    // 4. Write to time-period global leaderboards
    for (var i = 0; i < timePeriods.length; i++) {
        var period = timePeriods[i];
        var globalPeriodId = "leaderboard_global_" + period;
        var resetSchedule = RESET_SCHEDULES[period];
        ensureLeaderboardExists(nk, logger, globalPeriodId, resetSchedule, { 
            scope: "global", 
            timePeriod: period,
            description: period.charAt(0).toUpperCase() + period.slice(1) + " global leaderboard"
        });
        try {
            nk.leaderboardRecordWrite(globalPeriodId, userId, username, score, 0, metadata);
            leaderboardsUpdated.push(globalPeriodId);
            logger.info("[NAKAMA] Score written to " + globalPeriodId);
        } catch (err) {
            logger.warn("[NAKAMA] Failed to write to " + globalPeriodId + ": " + err.message);
        }
    }
    
    // 5. Write to friends leaderboards
    var friendsGameId = "leaderboard_friends_" + gameId;
    ensureLeaderboardExists(nk, logger, friendsGameId, "", { scope: "friends_game", gameId: gameId, description: "Friends leaderboard for game " + gameId });
    try {
        nk.leaderboardRecordWrite(friendsGameId, userId, username, score, 0, metadata);
        leaderboardsUpdated.push(friendsGameId);
        logger.info("[NAKAMA] Score written to " + friendsGameId);
    } catch (err) {
        logger.warn("[NAKAMA] Failed to write to " + friendsGameId + ": " + err.message);
    }
    
    var friendsGlobalId = "leaderboard_friends_global";
    ensureLeaderboardExists(nk, logger, friendsGlobalId, "", { scope: "friends_global", description: "Global friends leaderboard" });
    try {
        nk.leaderboardRecordWrite(friendsGlobalId, userId, username, score, 0, metadata);
        leaderboardsUpdated.push(friendsGlobalId);
        logger.info("[NAKAMA] Score written to " + friendsGlobalId);
    } catch (err) {
        logger.warn("[NAKAMA] Failed to write to " + friendsGlobalId + ": " + err.message);
    }
    
    // 6. Write to all other existing leaderboards found in registry
    var allLeaderboards = getAllLeaderboardIds(nk, logger);
    for (var i = 0; i < allLeaderboards.length; i++) {
        var lbId = allLeaderboards[i];
        // Skip if already written
        if (leaderboardsUpdated.indexOf(lbId) !== -1) {
            continue;
        }
        // Only write to leaderboards related to this game or global
        if (lbId.indexOf(gameId) !== -1 || lbId.indexOf("global") !== -1) {
            try {
                nk.leaderboardRecordWrite(lbId, userId, username, score, 0, metadata);
                leaderboardsUpdated.push(lbId);
                logger.info("[NAKAMA] Score written to registry leaderboard " + lbId);
            } catch (err) {
                logger.warn("[NAKAMA] Failed to write to " + lbId + ": " + err.message);
            }
        }
    }
    
    logger.info("[NAKAMA] Total leaderboards updated: " + leaderboardsUpdated.length);
    return leaderboardsUpdated;
}


// ============================================================================
// NEW MULTI-GAME IDENTITY, WALLET, AND LEADERBOARD RPCs
// ============================================================================

/**
 * RPC: create_or_sync_user
 * Creates or retrieves user identity with per-game and global wallets
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON with username, device_id, game_id
 * @returns {string} JSON response
 */
function createOrSyncUser(ctx, logger, nk, payload) {
    logger.info("[NAKAMA] RPC create_or_sync_user called");
    
    // Parse payload
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({
            success: false,
            error: "Invalid JSON payload"
        });
    }
    
    // Validate required fields
    if (!data.username || !data.device_id || !data.game_id) {
        return JSON.stringify({
            success: false,
            error: "Missing required fields: username, device_id, game_id"
        });
    }
    
    var username = data.username;
    var deviceId = data.device_id;
    var gameId = data.game_id;
    
    try {
        // Get or create identity - pass userId from context
        var identityResult = getOrCreateIdentity(nk, logger, deviceId, gameId, username, ctx.userId);
        var identity = identityResult.identity;
        var created = !identityResult.exists;
        
        // Ensure per-game wallet exists - pass userId from context
        var gameWallet = getOrCreateGameWallet(nk, logger, deviceId, gameId, identity.wallet_id, ctx.userId);
        
        // Ensure global wallet exists - pass userId from context
        var globalWallet = getOrCreateGlobalWallet(nk, logger, deviceId, identity.global_wallet_id, ctx.userId);
        
        // Update Nakama username if this is a new identity
        if (created && ctx.userId) {
            updateNakamaUsername(nk, logger, ctx.userId, username);
        }
        
        return JSON.stringify({
            success: true,
            created: created,
            username: identity.username,
            device_id: identity.device_id,
            game_id: identity.game_id,
            wallet_id: identity.wallet_id,
            global_wallet_id: identity.global_wallet_id
        });
        
    } catch (err) {
        logger.error("[NAKAMA] Error in create_or_sync_user: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to create or sync user: " + err.message
        });
    }
}

/**
 * RPC: create_or_get_wallet
 * Ensures per-game and global wallets exist
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON with device_id, game_id
 * @returns {string} JSON response
 */
function createOrGetWallet(ctx, logger, nk, payload) {
    logger.info("[NAKAMA] RPC create_or_get_wallet called");
    
    // Parse payload
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({
            success: false,
            error: "Invalid JSON payload"
        });
    }
    
    // Validate required fields
    if (!data.device_id || !data.game_id) {
        return JSON.stringify({
            success: false,
            error: "Missing required fields: device_id, game_id"
        });
    }
    
    var deviceId = data.device_id;
    var gameId = data.game_id;
    
    try {
        // Read identity to get wallet IDs
        var collection = "quizverse";
        var key = "identity:" + deviceId + ":" + gameId;
        
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (!records || records.length === 0 || !records[0].value) {
            return JSON.stringify({
                success: false,
                error: "Identity not found. Please call create_or_sync_user first."
            });
        }
        
        var identity = records[0].value;
        
        // Ensure wallets exist - pass userId from context
        var gameWallet = getOrCreateGameWallet(nk, logger, deviceId, gameId, identity.wallet_id, ctx.userId);
        var globalWallet = getOrCreateGlobalWallet(nk, logger, deviceId, identity.global_wallet_id, ctx.userId);
        
        return JSON.stringify({
            success: true,
            game_wallet: {
                wallet_id: gameWallet.wallet_id,
                balance: gameWallet.balance,
                currency: gameWallet.currency,
                game_id: gameWallet.game_id
            },
            global_wallet: {
                wallet_id: globalWallet.wallet_id,
                balance: globalWallet.balance,
                currency: globalWallet.currency
            }
        });
        
    } catch (err) {
        logger.error("[NAKAMA] Error in create_or_get_wallet: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to get wallets: " + err.message
        });
    }
}

/**
 * RPC: submit_score_and_sync
 * Submits score to all relevant leaderboards and updates game wallet
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON with score, device_id, game_id
 * @returns {string} JSON response
 */
function submitScoreAndSync(ctx, logger, nk, payload) {
    logger.info("[NAKAMA] RPC submit_score_and_sync called");
    
    // Parse payload
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({
            success: false,
            error: "Invalid JSON payload"
        });
    }
    
    // Validate required fields
    if (data.score === null || data.score === undefined || !data.device_id || !data.game_id) {
        return JSON.stringify({
            success: false,
            error: "Missing required fields: score, device_id, game_id"
        });
    }
    
    var score = parseInt(data.score);
    var deviceId = data.device_id;
    var gameId = data.game_id;
    
    if (isNaN(score)) {
        return JSON.stringify({
            success: false,
            error: "Score must be a valid number"
        });
    }
    
    try {
        // Get identity to find userId
        var collection = "quizverse";
        var key = "identity:" + deviceId + ":" + gameId;
        
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (!records || records.length === 0 || !records[0].value) {
            return JSON.stringify({
                success: false,
                error: "Identity not found. Please call create_or_sync_user first."
            });
        }
        
        var identity = records[0].value;
        var username = identity.username;
        
        // Use context userId if available, otherwise use device_id as userId
        var userId = ctx.userId || deviceId;
        
        // Write score to all leaderboards
        var leaderboardsUpdated = writeToAllLeaderboards(nk, logger, userId, username, gameId, score);
        
        // Update game wallet balance - pass userId from context
        var updatedWallet = updateGameWalletBalance(nk, logger, deviceId, gameId, score, ctx.userId);
        
        return JSON.stringify({
            success: true,
            score: score,
            wallet_balance: updatedWallet.balance,
            leaderboards_updated: leaderboardsUpdated,
            game_id: gameId
        });
        
    } catch (err) {
        logger.error("[NAKAMA] Error in submit_score_and_sync: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to submit score: " + err.message
        });
    }
}

/**
 * RPC: get_all_leaderboards
 * Retrieves all leaderboard records for a player across all types
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON with device_id, game_id
 * @returns {string} JSON response with all leaderboard records
 */
function getAllLeaderboards(ctx, logger, nk, payload) {
    logger.info("[NAKAMA] RPC get_all_leaderboards called");
    
    // Parse payload
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({
            success: false,
            error: "Invalid JSON payload"
        });
    }
    
    // Validate required fields
    if (!data.device_id || !data.game_id) {
        return JSON.stringify({
            success: false,
            error: "Missing required fields: device_id, game_id"
        });
    }
    
    var deviceId = data.device_id;
    var gameId = data.game_id;
    var limit = data.limit || 10;
    
    try {
        // Get identity to find userId
        var collection = "quizverse";
        var key = "identity:" + deviceId + ":" + gameId;
        
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (!records || records.length === 0 || !records[0].value) {
            return JSON.stringify({
                success: false,
                error: "Identity not found. Please call create_or_sync_user first."
            });
        }
        
        var identity = records[0].value;
        var userId = ctx.userId || deviceId;
        
        // Build list of all leaderboard IDs to query
        var leaderboardIds = [];
        
        // 1. Main game leaderboard
        leaderboardIds.push("leaderboard_" + gameId);
        
        // 2. Time-period game leaderboards
        var timePeriods = ["daily", "weekly", "monthly", "alltime"];
        for (var i = 0; i < timePeriods.length; i++) {
            leaderboardIds.push("leaderboard_" + gameId + "_" + timePeriods[i]);
        }
        
        // 3. Global leaderboards
        leaderboardIds.push("leaderboard_global");
        for (var i = 0; i < timePeriods.length; i++) {
            leaderboardIds.push("leaderboard_global_" + timePeriods[i]);
        }
        
        // 4. Friends leaderboards
        leaderboardIds.push("leaderboard_friends_" + gameId);
        leaderboardIds.push("leaderboard_friends_global");
        
        // 5. Get all registry leaderboards and filter relevant ones
        var allRegistryIds = getAllLeaderboardIds(nk, logger);
        for (var i = 0; i < allRegistryIds.length; i++) {
            var lbId = allRegistryIds[i];
            if (leaderboardIds.indexOf(lbId) === -1) {
                // Only include if related to this game or global
                if (lbId.indexOf(gameId) !== -1 || lbId.indexOf("global") !== -1) {
                    leaderboardIds.push(lbId);
                }
            }
        }
        
        // Query all leaderboards and collect records
        var leaderboards = {};
        var successCount = 0;
        var errorCount = 0;
        
        for (var i = 0; i < leaderboardIds.length; i++) {
            var leaderboardId = leaderboardIds[i];
            
            try {
                var leaderboardRecords = nk.leaderboardRecordsList(leaderboardId, null, limit, null, 0);
                
                // Also get user's own record
                var userRecord = null;
                try {
                    var userRecords = nk.leaderboardRecordsList(leaderboardId, [userId], 1, null, 0);
                    if (userRecords && userRecords.records && userRecords.records.length > 0) {
                        userRecord = userRecords.records[0];
                    }
                } catch (err) {
                    logger.warn("[NAKAMA] Failed to get user record from " + leaderboardId + ": " + err.message);
                }
                
                leaderboards[leaderboardId] = {
                    leaderboard_id: leaderboardId,
                    records: leaderboardRecords.records || [],
                    user_record: userRecord,
                    next_cursor: leaderboardRecords.nextCursor || "",
                    prev_cursor: leaderboardRecords.prevCursor || ""
                };
                
                successCount++;
                logger.info("[NAKAMA] Retrieved " + leaderboardRecords.records.length + " records from " + leaderboardId);
            } catch (err) {
                logger.warn("[NAKAMA] Failed to query leaderboard " + leaderboardId + ": " + err.message);
                leaderboards[leaderboardId] = {
                    leaderboard_id: leaderboardId,
                    error: err.message,
                    records: [],
                    user_record: null
                };
                errorCount++;
            }
        }
        
        return JSON.stringify({
            success: true,
            device_id: deviceId,
            game_id: gameId,
            leaderboards: leaderboards,
            total_leaderboards: leaderboardIds.length,
            successful_queries: successCount,
            failed_queries: errorCount
        });
        
    } catch (err) {
        logger.error("[NAKAMA] Error in get_all_leaderboards: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to retrieve leaderboards: " + err.message
        });
    }
}

// ============================================================================
// INIT MODULE - ENTRY POINT
// ============================================================================



// ============================================================================
// COPILOT INITIALIZATION
// ============================================================================

/**
 * Initialize copilot modules and register RPCs
 * This function is called from the parent InitModule
 */
function initializeCopilotModules(ctx, logger, nk, initializer) {
    logger.info('========================================');
    logger.info('Initializing Copilot Leaderboard Modules');
    logger.info('========================================');

    // Register leaderboard_sync RPCs
    try {
        initializer.registerRpc('submit_score_sync', rpcSubmitScoreSync);
        logger.info('✓ Registered RPC: submit_score_sync');
    } catch (err) {
        logger.error('✗ Failed to register submit_score_sync: ' + err.message);
    }

    // Register leaderboard_aggregate RPCs
    try {
        initializer.registerRpc('submit_score_with_aggregate', rpcSubmitScoreWithAggregate);
        logger.info('✓ Registered RPC: submit_score_with_aggregate');
    } catch (err) {
        logger.error('✗ Failed to register submit_score_with_aggregate: ' + err.message);
    }

    // Register leaderboard_friends RPCs
    try {
        initializer.registerRpc('create_all_leaderboards_with_friends', rpcCreateAllLeaderboardsWithFriends);
        logger.info('✓ Registered RPC: create_all_leaderboards_with_friends');
    } catch (err) {
        logger.error('✗ Failed to register create_all_leaderboards_with_friends: ' + err.message);
    }

    try {
        initializer.registerRpc('submit_score_with_friends_sync', rpcSubmitScoreWithFriendsSync);
        logger.info('✓ Registered RPC: submit_score_with_friends_sync');
    } catch (err) {
        logger.error('✗ Failed to register submit_score_with_friends_sync: ' + err.message);
    }

    try {
        initializer.registerRpc('get_friend_leaderboard', rpcGetFriendLeaderboard);
        logger.info('✓ Registered RPC: get_friend_leaderboard');
    } catch (err) {
        logger.error('✗ Failed to register get_friend_leaderboard: ' + err.message);
    }

    // Register social_features RPCs
    try {
        initializer.registerRpc('send_friend_invite', rpcSendFriendInvite);
        logger.info('✓ Registered RPC: send_friend_invite');
    } catch (err) {
        logger.error('✗ Failed to register send_friend_invite: ' + err.message);
    }

    try {
        initializer.registerRpc('accept_friend_invite', rpcAcceptFriendInvite);
        logger.info('✓ Registered RPC: accept_friend_invite');
    } catch (err) {
        logger.error('✗ Failed to register accept_friend_invite: ' + err.message);
    }

    try {
        initializer.registerRpc('decline_friend_invite', rpcDeclineFriendInvite);
        logger.info('✓ Registered RPC: decline_friend_invite');
    } catch (err) {
        logger.error('✗ Failed to register decline_friend_invite: ' + err.message);
    }

    try {
        initializer.registerRpc('get_notifications', rpcGetNotifications);
        logger.info('✓ Registered RPC: get_notifications');
    } catch (err) {
        logger.error('✗ Failed to register get_notifications: ' + err.message);
    }

    logger.info('========================================');
    logger.info('Copilot Leaderboard Modules Loaded Successfully');
    logger.info('========================================');
}

// ============================================================================
// PLAYER RPCs - Standard naming conventions for common player operations
// ============================================================================

/**
 * RPC: create_player_wallet
 * Creates both game-specific and global wallets for a player
 */
function rpcCreatePlayerWallet(ctx, logger, nk, payload) {
    logger.info('[RPC] create_player_wallet called');
    
    try {
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
        
        var identityResultStr = createOrSyncUser(ctx, logger, nk, identityPayload);
        var identity = JSON.parse(identityResultStr);
        
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
        
        var walletResultStr = createOrGetWallet(ctx, logger, nk, walletPayload);
        var wallets = JSON.parse(walletResultStr);
        
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
 */
function rpcUpdateWalletBalance(ctx, logger, nk, payload) {
    logger.info('[RPC] update_wallet_balance called');
    
    try {
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
        
        // Call appropriate wallet update function
        var updatePayload = JSON.stringify({
            device_id: deviceId,
            game_id: gameId,
            balance: balance
        });
        
        var resultStr;
        if (walletType === 'global') {
            resultStr = rpcWalletUpdateGlobal(ctx, logger, nk, updatePayload);
        } else {
            resultStr = rpcWalletUpdateGameWallet(ctx, logger, nk, updatePayload);
        }
        
        var wallet = JSON.parse(resultStr);
        
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
 */
function rpcGetWalletBalance(ctx, logger, nk, payload) {
    logger.info('[RPC] get_wallet_balance called');
    
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.device_id || !data.game_id) {
            return JSON.stringify({
                success: false,
                error: 'device_id and game_id are required'
            });
        }
        
        var deviceId = data.device_id;
        var gameId = data.game_id;
        
        // Get wallets using existing function
        var walletPayload = JSON.stringify({
            device_id: deviceId,
            game_id: gameId
        });
        
        var resultStr = createOrGetWallet(ctx, logger, nk, walletPayload);
        var wallets = JSON.parse(resultStr);
        
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
 * Submits a score to leaderboards
 */
function rpcSubmitLeaderboardScore(ctx, logger, nk, payload) {
    logger.info('[RPC] submit_leaderboard_score called');
    
    try {
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
        
        // Submit score using existing function
        var scorePayload = JSON.stringify({
            device_id: deviceId,
            game_id: gameId,
            score: score,
            metadata: data.metadata || {}
        });
        
        var resultStr = submitScoreAndSync(ctx, logger, nk, scorePayload);
        var scoreResult = JSON.parse(resultStr);
        
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
 * Gets leaderboard records
 */
function rpcGetLeaderboard(ctx, logger, nk, payload) {
    logger.info('[RPC] get_leaderboard called');
    
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id) {
            return JSON.stringify({
                success: false,
                error: 'game_id is required'
            });
        }
        
        var gameId = data.game_id;
        var period = data.period || '';
        var limit = data.limit || 10;
        var cursor = data.cursor || '';
        
        // Validate limit
        if (limit < 1 || limit > 100) {
            return JSON.stringify({
                success: false,
                error: 'limit must be between 1 and 100'
            });
        }
        
        // Get leaderboard using existing function
        var leaderboardPayload = JSON.stringify({
            gameId: gameId,
            period: period,
            limit: limit,
            cursor: cursor
        });
        
        var resultStr = rpcGetTimePeriodLeaderboard(ctx, logger, nk, leaderboardPayload);
        var leaderboard = JSON.parse(resultStr);
        
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

// ============================================================================
// CHAT MODULE - Group Chat, Direct Chat, and Chat Rooms
// ============================================================================

/**
 * RPC: send_group_chat_message
 * Send a message in a group chat
 */
function rpcSendGroupChatMessage(ctx, logger, nk, payload) {
    logger.info('[RPC] send_group_chat_message called');
    
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: 'Authentication required'
            });
        }
        
        var data = JSON.parse(payload || '{}');
        
        if (!data.group_id || !data.message) {
            return JSON.stringify({
                success: false,
                error: 'group_id and message are required'
            });
        }
        
        var groupId = data.group_id;
        var message = data.message;
        var username = ctx.username || 'User';
        var metadata = data.metadata || {};
        
        // Send message using chat helper (inline implementation)
        var collection = "group_chat";
        var key = "msg:" + groupId + ":" + Date.now() + ":" + ctx.userId;
        
        var messageData = {
            message_id: key,
            group_id: groupId,
            user_id: ctx.userId,
            username: username,
            message: message,
            metadata: metadata,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: ctx.userId,
            value: messageData,
            permissionRead: 2,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info('[RPC] Group message sent: ' + key);
        
        return JSON.stringify({
            success: true,
            message_id: key,
            group_id: groupId,
            timestamp: messageData.created_at
        });
        
    } catch (err) {
        logger.error('[RPC] send_group_chat_message - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: send_direct_message
 * Send a direct message to another user
 */
function rpcSendDirectMessage(ctx, logger, nk, payload) {
    logger.info('[RPC] send_direct_message called');
    
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: 'Authentication required'
            });
        }
        
        var data = JSON.parse(payload || '{}');
        
        if (!data.to_user_id || !data.message) {
            return JSON.stringify({
                success: false,
                error: 'to_user_id and message are required'
            });
        }
        
        var toUserId = data.to_user_id;
        var message = data.message;
        var username = ctx.username || 'User';
        var metadata = data.metadata || {};
        
        // Create conversation ID (consistent ordering)
        var conversationId = ctx.userId < toUserId ? 
            ctx.userId + ":" + toUserId : 
            toUserId + ":" + ctx.userId;
        
        var collection = "direct_chat";
        var key = "msg:" + conversationId + ":" + Date.now() + ":" + ctx.userId;
        
        var messageData = {
            message_id: key,
            conversation_id: conversationId,
            from_user_id: ctx.userId,
            from_username: username,
            to_user_id: toUserId,
            message: message,
            metadata: metadata,
            read: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: ctx.userId,
            value: messageData,
            permissionRead: 2,
            permissionWrite: 0,
            version: "*"
        }]);
        
        // Send notification
        try {
            var notificationContent = {
                type: "direct_message",
                from_user_id: ctx.userId,
                from_username: username,
                message: message,
                conversation_id: conversationId
            };
            
            nk.notificationSend(
                toUserId,
                "New Direct Message",
                notificationContent,
                100,
                ctx.userId,
                true
            );
        } catch (notifErr) {
            logger.warn('[RPC] Failed to send notification: ' + notifErr.message);
        }
        
        logger.info('[RPC] Direct message sent: ' + key);
        
        return JSON.stringify({
            success: true,
            message_id: key,
            conversation_id: conversationId,
            timestamp: messageData.created_at
        });
        
    } catch (err) {
        logger.error('[RPC] send_direct_message - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: send_chat_room_message
 * Send a message in a public chat room
 */
function rpcSendChatRoomMessage(ctx, logger, nk, payload) {
    logger.info('[RPC] send_chat_room_message called');
    
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: 'Authentication required'
            });
        }
        
        var data = JSON.parse(payload || '{}');
        
        if (!data.room_id || !data.message) {
            return JSON.stringify({
                success: false,
                error: 'room_id and message are required'
            });
        }
        
        var roomId = data.room_id;
        var message = data.message;
        var username = ctx.username || 'User';
        var metadata = data.metadata || {};
        
        var collection = "chat_room";
        var key = "msg:" + roomId + ":" + Date.now() + ":" + ctx.userId;
        
        var messageData = {
            message_id: key,
            room_id: roomId,
            user_id: ctx.userId,
            username: username,
            message: message,
            metadata: metadata,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: ctx.userId,
            value: messageData,
            permissionRead: 2,
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info('[RPC] Chat room message sent: ' + key);
        
        return JSON.stringify({
            success: true,
            message_id: key,
            room_id: roomId,
            timestamp: messageData.created_at
        });
        
    } catch (err) {
        logger.error('[RPC] send_chat_room_message - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: get_group_chat_history
 * Get chat history for a group
 */
function rpcGetGroupChatHistory(ctx, logger, nk, payload) {
    logger.info('[RPC] get_group_chat_history called');
    
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: 'Authentication required'
            });
        }
        
        var data = JSON.parse(payload || '{}');
        
        if (!data.group_id) {
            return JSON.stringify({
                success: false,
                error: 'group_id is required'
            });
        }
        
        var groupId = data.group_id;
        var limit = data.limit || 50;
        
        var collection = "group_chat";
        var records = nk.storageList(null, collection, limit * 2, null);
        
        var messages = [];
        if (records && records.objects) {
            for (var i = 0; i < records.objects.length; i++) {
                var record = records.objects[i];
                if (record.value && record.value.group_id === groupId) {
                    messages.push(record.value);
                }
            }
        }
        
        // Sort by created_at descending
        messages.sort(function(a, b) {
            return new Date(b.created_at) - new Date(a.created_at);
        });
        
        logger.info('[RPC] Retrieved ' + messages.length + ' group messages');
        
        return JSON.stringify({
            success: true,
            group_id: groupId,
            messages: messages.slice(0, limit),
            total: messages.length
        });
        
    } catch (err) {
        logger.error('[RPC] get_group_chat_history - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: get_direct_message_history
 * Get direct message history between two users
 */
function rpcGetDirectMessageHistory(ctx, logger, nk, payload) {
    logger.info('[RPC] get_direct_message_history called');
    
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: 'Authentication required'
            });
        }
        
        var data = JSON.parse(payload || '{}');
        
        if (!data.other_user_id) {
            return JSON.stringify({
                success: false,
                error: 'other_user_id is required'
            });
        }
        
        var otherUserId = data.other_user_id;
        var limit = data.limit || 50;
        
        // Create conversation ID
        var conversationId = ctx.userId < otherUserId ? 
            ctx.userId + ":" + otherUserId : 
            otherUserId + ":" + ctx.userId;
        
        var collection = "direct_chat";
        var records = nk.storageList(null, collection, limit * 2, null);
        
        var messages = [];
        if (records && records.objects) {
            for (var i = 0; i < records.objects.length; i++) {
                var record = records.objects[i];
                if (record.value && record.value.conversation_id === conversationId) {
                    messages.push(record.value);
                }
            }
        }
        
        // Sort by created_at descending
        messages.sort(function(a, b) {
            return new Date(b.created_at) - new Date(a.created_at);
        });
        
        logger.info('[RPC] Retrieved ' + messages.length + ' direct messages');
        
        return JSON.stringify({
            success: true,
            conversation_id: conversationId,
            messages: messages.slice(0, limit),
            total: messages.length
        });
        
    } catch (err) {
        logger.error('[RPC] get_direct_message_history - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: get_chat_room_history
 * Get chat room message history
 */
function rpcGetChatRoomHistory(ctx, logger, nk, payload) {
    logger.info('[RPC] get_chat_room_history called');
    
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: 'Authentication required'
            });
        }
        
        var data = JSON.parse(payload || '{}');
        
        if (!data.room_id) {
            return JSON.stringify({
                success: false,
                error: 'room_id is required'
            });
        }
        
        var roomId = data.room_id;
        var limit = data.limit || 50;
        
        var collection = "chat_room";
        var records = nk.storageList(null, collection, limit * 2, null);
        
        var messages = [];
        if (records && records.objects) {
            for (var i = 0; i < records.objects.length; i++) {
                var record = records.objects[i];
                if (record.value && record.value.room_id === roomId) {
                    messages.push(record.value);
                }
            }
        }
        
        // Sort by created_at descending
        messages.sort(function(a, b) {
            return new Date(b.created_at) - new Date(a.created_at);
        });
        
        logger.info('[RPC] Retrieved ' + messages.length + ' room messages');
        
        return JSON.stringify({
            success: true,
            room_id: roomId,
            messages: messages.slice(0, limit),
            total: messages.length
        });
        
    } catch (err) {
        logger.error('[RPC] get_chat_room_history - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: mark_direct_messages_read
 * Mark direct messages as read
 */
function rpcMarkDirectMessagesRead(ctx, logger, nk, payload) {
    logger.info('[RPC] mark_direct_messages_read called');
    
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: 'Authentication required'
            });
        }
        
        var data = JSON.parse(payload || '{}');
        
        if (!data.conversation_id) {
            return JSON.stringify({
                success: false,
                error: 'conversation_id is required'
            });
        }
        
        var conversationId = data.conversation_id;
        var collection = "direct_chat";
        
        var records = nk.storageList(null, collection, 100, null);
        var updatedCount = 0;
        
        if (records && records.objects) {
            var toUpdate = [];
            
            for (var i = 0; i < records.objects.length; i++) {
                var record = records.objects[i];
                if (record.value && 
                    record.value.conversation_id === conversationId &&
                    record.value.to_user_id === ctx.userId &&
                    !record.value.read) {
                    
                    record.value.read = true;
                    record.value.read_at = new Date().toISOString();
                    
                    toUpdate.push({
                        collection: collection,
                        key: record.key,
                        userId: record.userId,
                        value: record.value,
                        permissionRead: 2,
                        permissionWrite: 0,
                        version: "*"
                    });
                }
            }
            
            if (toUpdate.length > 0) {
                nk.storageWrite(toUpdate);
                updatedCount = toUpdate.length;
            }
        }
        
        logger.info('[RPC] Marked ' + updatedCount + ' messages as read');
        
        return JSON.stringify({
            success: true,
            conversation_id: conversationId,
            messages_marked: updatedCount
        });
        
    } catch (err) {
        logger.error('[RPC] mark_direct_messages_read - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// ============================================================================
// MULTI-GAME RPCs FOR QUIZVERSE AND LASTTOLIVE
// ============================================================================

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse and validate payload with gameID
 */
function parseAndValidateGamePayload(payload, requiredFields) {
    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (e) {
        throw Error("Invalid JSON payload");
    }

    var gameID = data.gameID;
    if (!gameID || !["quizverse", "lasttolive"].includes(gameID)) {
        throw Error("Unsupported gameID: " + gameID);
    }

    // Validate required fields
    for (var i = 0; i < requiredFields.length; i++) {
        var field = requiredFields[i];
        if (!data.hasOwnProperty(field) || data[field] === null || data[field] === undefined) {
            throw Error("Missing required field: " + field);
        }
    }

    return data;
}

/**
 * Get user ID from data or context
 */
function getUserId(data, ctx) {
    return data.userID || ctx.userId;
}

/**
 * Create namespaced collection name
 */
function getCollection(gameID, type) {
    return gameID + "_" + type;
}

/**
 * Get leaderboard ID for game
 */
function getLeaderboardId(gameID, type) {
    if (type === "weekly" || !type) {
        return gameID + "_weekly";
    }
    return gameID + "_" + type;
}

// ============================================================================
// AUTHENTICATION & PROFILE
// ============================================================================

/**
 * RPC: quizverse_update_user_profile
 * Updates user profile for QuizVerse
 */
function quizverseUpdateUserProfile(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var userId = getUserId(data, context);
        
        var collection = getCollection(data.gameID, "profiles");
        var key = "profile_" + userId;
        
        // Read existing profile or create new
        var profile = {};
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                profile = records[0].value;
            }
        } catch (err) {
            logger.debug("No existing profile found, creating new");
        }
        
        // Update profile fields
        if (data.displayName) profile.displayName = data.displayName;
        if (data.avatar) profile.avatar = data.avatar;
        if (data.level !== undefined) profile.level = data.level;
        if (data.xp !== undefined) profile.xp = data.xp;
        if (data.metadata) profile.metadata = data.metadata;
        
        profile.updatedAt = new Date().toISOString();
        if (!profile.createdAt) {
            profile.createdAt = profile.updatedAt;
        }
        
        // Write profile
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: profile,
            permissionRead: 2,
            permissionWrite: 1
        }]);
        
        logger.info("[" + data.gameID + "] Profile updated for user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: profile
        });
        
    } catch (err) {
        logger.error("quizverse_update_user_profile error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_update_user_profile
 * Updates user profile for LastToLive
 */
function lasttoliveUpdateUserProfile(context, logger, nk, payload) {
    // Reuse the same logic as QuizVerse
    return quizverseUpdateUserProfile(context, logger, nk, payload);
}

// ============================================================================
// WALLET OPERATIONS
// ============================================================================

/**
 * RPC: quizverse_grant_currency
 * Grant currency to user wallet
 */
function quizverseGrantCurrency(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "amount"]);
        var userId = getUserId(data, context);
        var amount = parseInt(data.amount);
        
        if (isNaN(amount) || amount <= 0) {
            throw Error("Amount must be a positive number");
        }
        
        var collection = getCollection(data.gameID, "wallets");
        var key = "wallet_" + userId;
        
        // Read existing wallet
        var wallet = { balance: 0, currency: "coins" };
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                wallet = records[0].value;
            }
        } catch (err) {
            logger.debug("No existing wallet found, creating new");
        }
        
        // Grant currency
        wallet.balance = (wallet.balance || 0) + amount;
        wallet.updatedAt = new Date().toISOString();
        
        // Write wallet
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] Granted " + amount + " currency to user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: {
                balance: wallet.balance,
                amount: amount
            }
        });
        
    } catch (err) {
        logger.error("quizverse_grant_currency error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_grant_currency
 */
function lasttoliveGrantCurrency(context, logger, nk, payload) {
    return quizverseGrantCurrency(context, logger, nk, payload);
}

/**
 * RPC: quizverse_spend_currency
 * Spend currency from user wallet
 */
function quizverseSpendCurrency(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "amount"]);
        var userId = getUserId(data, context);
        var amount = parseInt(data.amount);
        
        if (isNaN(amount) || amount <= 0) {
            throw Error("Amount must be a positive number");
        }
        
        var collection = getCollection(data.gameID, "wallets");
        var key = "wallet_" + userId;
        
        // Read existing wallet
        var wallet = null;
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                wallet = records[0].value;
            }
        } catch (err) {
            throw Error("Wallet not found");
        }
        
        if (!wallet || wallet.balance < amount) {
            throw Error("Insufficient balance");
        }
        
        // Spend currency
        wallet.balance -= amount;
        wallet.updatedAt = new Date().toISOString();
        
        // Write wallet
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] User " + userId + " spent " + amount + " currency");
        
        return JSON.stringify({
            success: true,
            data: {
                balance: wallet.balance,
                amount: amount
            }
        });
        
    } catch (err) {
        logger.error("quizverse_spend_currency error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_spend_currency
 */
function lasttoliveSpendCurrency(context, logger, nk, payload) {
    return quizverseSpendCurrency(context, logger, nk, payload);
}

/**
 * RPC: quizverse_validate_purchase
 * Validate and process purchase
 */
function quizverseValidatePurchase(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "itemId", "price"]);
        var userId = getUserId(data, context);
        var price = parseInt(data.price);
        
        if (isNaN(price) || price < 0) {
            throw Error("Invalid price");
        }
        
        var collection = getCollection(data.gameID, "wallets");
        var key = "wallet_" + userId;
        
        // Read wallet
        var wallet = null;
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                wallet = records[0].value;
            }
        } catch (err) {
            throw Error("Wallet not found");
        }
        
        if (!wallet || wallet.balance < price) {
            return JSON.stringify({
                success: false,
                error: "Insufficient balance",
                data: { canPurchase: false }
            });
        }
        
        return JSON.stringify({
            success: true,
            data: {
                canPurchase: true,
                itemId: data.itemId,
                price: price,
                balance: wallet.balance
            }
        });
        
    } catch (err) {
        logger.error("quizverse_validate_purchase error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_validate_purchase
 */
function lasttoliveValidatePurchase(context, logger, nk, payload) {
    return quizverseValidatePurchase(context, logger, nk, payload);
}

// ============================================================================
// INVENTORY OPERATIONS
// ============================================================================

/**
 * RPC: quizverse_list_inventory
 * List user inventory items
 */
function quizverseListInventory(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var userId = getUserId(data, context);
        
        var collection = getCollection(data.gameID, "inventory");
        var key = "inv_" + userId;
        
        // Read inventory
        var inventory = { items: [] };
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                inventory = records[0].value;
            }
        } catch (err) {
            logger.debug("No existing inventory found");
        }
        
        return JSON.stringify({
            success: true,
            data: {
                items: inventory.items || []
            }
        });
        
    } catch (err) {
        logger.error("quizverse_list_inventory error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_list_inventory
 */
function lasttoliveListInventory(context, logger, nk, payload) {
    return quizverseListInventory(context, logger, nk, payload);
}

/**
 * RPC: quizverse_grant_item
 * Grant item to user inventory
 */
function quizverseGrantItem(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "itemId", "quantity"]);
        var userId = getUserId(data, context);
        var quantity = parseInt(data.quantity);
        
        if (isNaN(quantity) || quantity <= 0) {
            throw Error("Quantity must be a positive number");
        }
        
        var collection = getCollection(data.gameID, "inventory");
        var key = "inv_" + userId;
        
        // Read inventory
        var inventory = { items: [] };
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                inventory = records[0].value;
            }
        } catch (err) {
            logger.debug("Creating new inventory");
        }
        
        // Find or create item
        var itemFound = false;
        for (var i = 0; i < inventory.items.length; i++) {
            if (inventory.items[i].itemId === data.itemId) {
                inventory.items[i].quantity = (inventory.items[i].quantity || 0) + quantity;
                inventory.items[i].updatedAt = new Date().toISOString();
                itemFound = true;
                break;
            }
        }
        
        if (!itemFound) {
            inventory.items.push({
                itemId: data.itemId,
                quantity: quantity,
                metadata: data.metadata || {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }
        
        inventory.updatedAt = new Date().toISOString();
        
        // Write inventory
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: inventory,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] Granted " + quantity + "x " + data.itemId + " to user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: {
                itemId: data.itemId,
                quantity: quantity
            }
        });
        
    } catch (err) {
        logger.error("quizverse_grant_item error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_grant_item
 */
function lasttoliveGrantItem(context, logger, nk, payload) {
    return quizverseGrantItem(context, logger, nk, payload);
}

/**
 * RPC: quizverse_consume_item
 * Consume item from user inventory
 */
function quizverseConsumeItem(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "itemId", "quantity"]);
        var userId = getUserId(data, context);
        var quantity = parseInt(data.quantity);
        
        if (isNaN(quantity) || quantity <= 0) {
            throw Error("Quantity must be a positive number");
        }
        
        var collection = getCollection(data.gameID, "inventory");
        var key = "inv_" + userId;
        
        // Read inventory
        var inventory = null;
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                inventory = records[0].value;
            }
        } catch (err) {
            throw Error("Inventory not found");
        }
        
        if (!inventory || !inventory.items) {
            throw Error("No items in inventory");
        }
        
        // Find and consume item
        var itemFound = false;
        for (var i = 0; i < inventory.items.length; i++) {
            if (inventory.items[i].itemId === data.itemId) {
                if (inventory.items[i].quantity < quantity) {
                    throw Error("Insufficient quantity");
                }
                inventory.items[i].quantity -= quantity;
                inventory.items[i].updatedAt = new Date().toISOString();
                
                // Remove item if quantity is 0
                if (inventory.items[i].quantity === 0) {
                    inventory.items.splice(i, 1);
                }
                itemFound = true;
                break;
            }
        }
        
        if (!itemFound) {
            throw Error("Item not found in inventory");
        }
        
        inventory.updatedAt = new Date().toISOString();
        
        // Write inventory
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: inventory,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] User " + userId + " consumed " + quantity + "x " + data.itemId);
        
        return JSON.stringify({
            success: true,
            data: {
                itemId: data.itemId,
                quantity: quantity
            }
        });
        
    } catch (err) {
        logger.error("quizverse_consume_item error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_consume_item
 */
function lasttoliveConsumeItem(context, logger, nk, payload) {
    return quizverseConsumeItem(context, logger, nk, payload);
}

// ============================================================================
// LEADERBOARD - QUIZVERSE
// ============================================================================

/**
 * RPC: quizverse_submit_score
 * Submit score with QuizVerse-specific validations
 */
function quizverseSubmitScore(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "score"]);
        var userId = getUserId(data, context);
        var score = parseInt(data.score);
        
        if (isNaN(score) || score < 0) {
            throw Error("Invalid score");
        }
        
        // QuizVerse-specific validation
        if (data.answersCount !== undefined) {
            var answersCount = parseInt(data.answersCount);
            if (isNaN(answersCount) || answersCount < 0) {
                throw Error("Invalid answers count");
            }
            // Anti-cheat: max score per answer
            var maxScorePerAnswer = 100;
            if (score > answersCount * maxScorePerAnswer) {
                throw Error("Score exceeds maximum possible value");
            }
        }
        
        if (data.completionTime !== undefined) {
            var completionTime = parseInt(data.completionTime);
            if (isNaN(completionTime) || completionTime < 0) {
                throw Error("Invalid completion time");
            }
            // Anti-cheat: minimum time per question
            var minTimePerQuestion = 1; // seconds
            if (data.answersCount && completionTime < data.answersCount * minTimePerQuestion) {
                throw Error("Completion time too fast");
            }
        }
        
        var leaderboardId = getLeaderboardId(data.gameID, "weekly");
        var username = context.username || userId;
        
        var metadata = {
            gameID: data.gameID,
            submittedAt: new Date().toISOString(),
            answersCount: data.answersCount || 0,
            completionTime: data.completionTime || 0
        };
        
        // Submit to leaderboard
        nk.leaderboardRecordWrite(
            leaderboardId,
            userId,
            username,
            score,
            0,
            metadata
        );
        
        logger.info("[quizverse] Score " + score + " submitted for user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: {
                score: score,
                leaderboardId: leaderboardId
            }
        });
        
    } catch (err) {
        logger.error("quizverse_submit_score error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: quizverse_get_leaderboard
 * Get leaderboard for QuizVerse
 */
function quizverseGetLeaderboard(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var limit = data.limit || 10;
        
        if (limit < 1 || limit > 100) {
            throw Error("Limit must be between 1 and 100");
        }
        
        var leaderboardId = getLeaderboardId(data.gameID, "weekly");
        
        // Get leaderboard records
        var records = nk.leaderboardRecordsList(leaderboardId, null, limit, null, 0);
        
        return JSON.stringify({
            success: true,
            data: {
                leaderboardId: leaderboardId,
                records: records.records || []
            }
        });
        
    } catch (err) {
        logger.error("quizverse_get_leaderboard error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// ============================================================================
// LEADERBOARD - LASTTOLIVE
// ============================================================================

/**
 * RPC: lasttolive_submit_score
 * Submit score with LastToLive-specific survival validations
 */
function lasttoliveSubmitScore(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var userId = getUserId(data, context);
        
        // LastToLive-specific validation
        var kills = parseInt(data.kills || 0);
        var timeSurvivedSec = parseInt(data.timeSurvivedSec || 0);
        var damageTaken = parseFloat(data.damageTaken || 0);
        var damageDealt = parseFloat(data.damageDealt || 0);
        var reviveCount = parseInt(data.reviveCount || 0);
        
        // Validate metrics
        if (isNaN(kills) || kills < 0) {
            throw Error("Invalid kills count");
        }
        if (isNaN(timeSurvivedSec) || timeSurvivedSec < 0) {
            throw Error("Invalid survival time");
        }
        if (isNaN(damageTaken) || damageTaken < 0) {
            throw Error("Invalid damage taken");
        }
        if (isNaN(damageDealt) || damageDealt < 0) {
            throw Error("Invalid damage dealt");
        }
        if (isNaN(reviveCount) || reviveCount < 0) {
            throw Error("Invalid revive count");
        }
        
        // Anti-cheat: reject impossible values
        var maxKillsPerMinute = 10;
        var minutesSurvived = timeSurvivedSec / 60;
        if (minutesSurvived > 0 && kills > maxKillsPerMinute * minutesSurvived) {
            throw Error("Kills count exceeds maximum possible value");
        }
        
        var maxDamagePerSecond = 1000;
        if (damageDealt > maxDamagePerSecond * timeSurvivedSec) {
            throw Error("Damage dealt exceeds maximum possible value");
        }
        
        // Calculate score using LastToLive formula
        var score = Math.floor(
            (timeSurvivedSec * 10) +
            (kills * 500) -
            (damageTaken * 0.1)
        );
        
        if (score < 0) score = 0;
        
        var leaderboardId = getLeaderboardId(data.gameID, "survivor_rank");
        var username = context.username || userId;
        
        var metadata = {
            gameID: data.gameID,
            submittedAt: new Date().toISOString(),
            kills: kills,
            timeSurvivedSec: timeSurvivedSec,
            damageTaken: damageTaken,
            damageDealt: damageDealt,
            reviveCount: reviveCount
        };
        
        // Submit to leaderboard
        nk.leaderboardRecordWrite(
            leaderboardId,
            userId,
            username,
            score,
            0,
            metadata
        );
        
        logger.info("[lasttolive] Score " + score + " submitted for user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: {
                score: score,
                leaderboardId: leaderboardId,
                metrics: {
                    kills: kills,
                    timeSurvivedSec: timeSurvivedSec,
                    damageTaken: damageTaken,
                    damageDealt: damageDealt,
                    reviveCount: reviveCount
                }
            }
        });
        
    } catch (err) {
        logger.error("lasttolive_submit_score error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_get_leaderboard
 * Get leaderboard for LastToLive
 */
function lasttoliveGetLeaderboard(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var limit = data.limit || 10;
        
        if (limit < 1 || limit > 100) {
            throw Error("Limit must be between 1 and 100");
        }
        
        var leaderboardId = getLeaderboardId(data.gameID, "survivor_rank");
        
        // Get leaderboard records
        var records = nk.leaderboardRecordsList(leaderboardId, null, limit, null, 0);
        
        return JSON.stringify({
            success: true,
            data: {
                leaderboardId: leaderboardId,
                records: records.records || []
            }
        });
        
    } catch (err) {
        logger.error("lasttolive_get_leaderboard error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// ============================================================================
// MULTIPLAYER
// ============================================================================

/**
 * RPC: quizverse_join_or_create_match
 * Join or create a multiplayer match
 */
function quizverseJoinOrCreateMatch(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var userId = getUserId(data, context);
        
        // For now, return a placeholder match ID
        // In a full implementation, this would use Nakama's matchmaker
        var matchId = data.gameID + "_match_" + Date.now();
        
        logger.info("[" + data.gameID + "] User " + userId + " joined/created match: " + matchId);
        
        return JSON.stringify({
            success: true,
            data: {
                matchId: matchId,
                gameID: data.gameID
            }
        });
        
    } catch (err) {
        logger.error("quizverse_join_or_create_match error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_join_or_create_match
 */
function lasttoliveJoinOrCreateMatch(context, logger, nk, payload) {
    return quizverseJoinOrCreateMatch(context, logger, nk, payload);
}

// ============================================================================
// DAILY REWARDS
// ============================================================================

/**
 * RPC: quizverse_claim_daily_reward
 * Claim daily reward
 */
function quizverseClaimDailyReward(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var userId = getUserId(data, context);
        
        var collection = getCollection(data.gameID, "daily_rewards");
        var key = "daily_" + userId;
        
        var now = new Date();
        var today = now.toISOString().split('T')[0];
        
        // Read reward state
        var rewardState = { lastClaim: null, streak: 0 };
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                rewardState = records[0].value;
            }
        } catch (err) {
            logger.debug("No existing reward state found");
        }
        
        // Check if already claimed today
        if (rewardState.lastClaim === today) {
            return JSON.stringify({
                success: false,
                error: "Daily reward already claimed today"
            });
        }
        
        // Calculate streak
        var yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        var yesterdayStr = yesterday.toISOString().split('T')[0];
        
        if (rewardState.lastClaim === yesterdayStr) {
            rewardState.streak += 1;
        } else {
            rewardState.streak = 1;
        }
        
        rewardState.lastClaim = today;
        
        // Calculate reward amount (increases with streak)
        var baseReward = 100;
        var rewardAmount = baseReward + (rewardState.streak - 1) * 10;
        
        // Write reward state
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: rewardState,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] User " + userId + " claimed daily reward. Streak: " + rewardState.streak);
        
        return JSON.stringify({
            success: true,
            data: {
                rewardAmount: rewardAmount,
                streak: rewardState.streak,
                nextReward: baseReward + rewardState.streak * 10
            }
        });
        
    } catch (err) {
        logger.error("quizverse_claim_daily_reward error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_claim_daily_reward
 */
function lasttoliveClaimDailyReward(context, logger, nk, payload) {
    return quizverseClaimDailyReward(context, logger, nk, payload);
}

// ============================================================================
// SOCIAL
// ============================================================================

/**
 * RPC: quizverse_find_friends
 * Find friends by username or user ID
 */
function quizverseFindFriends(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        
        if (!data.query) {
            throw Error("Query string is required");
        }
        
        var query = data.query;
        var limit = data.limit || 20;
        
        if (limit < 1 || limit > 100) {
            throw Error("Limit must be between 1 and 100");
        }
        
        // Search for users using Nakama's user search
        var users = nk.usersGetUsername([query]);
        
        var results = [];
        if (users && users.length > 0) {
            for (var i = 0; i < users.length && i < limit; i++) {
                results.push({
                    userId: users[i].id,
                    username: users[i].username,
                    displayName: users[i].displayName || users[i].username
                });
            }
        }
        
        return JSON.stringify({
            success: true,
            data: {
                results: results,
                query: query
            }
        });
        
    } catch (err) {
        logger.error("quizverse_find_friends error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_find_friends
 */
function lasttolliveFindFriends(context, logger, nk, payload) {
    return quizverseFindFriends(context, logger, nk, payload);
}

// ============================================================================
// PLAYER DATA
// ============================================================================

/**
 * RPC: quizverse_save_player_data
 * Save player data to storage
 */
function quizverseSavePlayerData(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "key", "value"]);
        var userId = getUserId(data, context);
        
        var collection = getCollection(data.gameID, "player_data");
        var storageKey = data.key;
        
        var playerData = {
            value: data.value,
            updatedAt: new Date().toISOString()
        };
        
        // Write player data
        nk.storageWrite([{
            collection: collection,
            key: storageKey,
            userId: userId,
            value: playerData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] Saved player data for user: " + userId + ", key: " + storageKey);
        
        return JSON.stringify({
            success: true,
            data: {
                key: storageKey,
                saved: true
            }
        });
        
    } catch (err) {
        logger.error("quizverse_save_player_data error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_save_player_data
 */
function lasttolliveSavePlayerData(context, logger, nk, payload) {
    return quizverseSavePlayerData(context, logger, nk, payload);
}

/**
 * RPC: quizverse_load_player_data
 * Load player data from storage
 */
function quizverseLoadPlayerData(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "key"]);
        var userId = getUserId(data, context);
        
        var collection = getCollection(data.gameID, "player_data");
        var storageKey = data.key;
        
        // Read player data
        var playerData = null;
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: storageKey,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                playerData = records[0].value;
            }
        } catch (err) {
            logger.debug("No player data found for key: " + storageKey);
        }
        
        if (!playerData) {
            return JSON.stringify({
                success: false,
                error: "Player data not found"
            });
        }
        
        return JSON.stringify({
            success: true,
            data: {
                key: storageKey,
                value: playerData.value,
                updatedAt: playerData.updatedAt
            }
        });
        
    } catch (err) {
        logger.error("quizverse_load_player_data error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: lasttolive_load_player_data
 */
function lasttoliveLoadPlayerData(context, logger, nk, payload) {
    return quizverseLoadPlayerData(context, logger, nk, payload);
}

// ============================================================================
// ADDITIONAL MEGA CODEX FEATURES
// ============================================================================

// ============================================================================
// STORAGE INDEXING + CATALOG SYSTEMS
// ============================================================================

/**
 * RPC: quizverse_get_item_catalog
 * Get item catalog for the game
 */
function quizverseGetItemCatalog(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        
        var collection = getCollection(data.gameID, "catalog");
        var limit = data.limit || 100;
        
        // Read catalog items
        var records = nk.storageList("00000000-0000-0000-0000-000000000000", collection, limit, null);
        
        var items = [];
        if (records && records.objects) {
            for (var i = 0; i < records.objects.length; i++) {
                items.push(records.objects[i].value);
            }
        }
        
        logger.info("[" + data.gameID + "] Retrieved " + items.length + " catalog items");
        
        return JSON.stringify({
            success: true,
            data: { items: items }
        });
        
    } catch (err) {
        logger.error("quizverse_get_item_catalog error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_get_item_catalog
 */
function lasttoliveGetItemCatalog(context, logger, nk, payload) {
    return quizverseGetItemCatalog(context, logger, nk, payload);
}

/**
 * RPC: quizverse_search_items
 * Search items in catalog
 */
function quizverseSearchItems(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "query"]);
        
        var collection = getCollection(data.gameID, "catalog");
        var query = data.query.toLowerCase();
        
        // Read all catalog items
        var records = nk.storageList("00000000-0000-0000-0000-000000000000", collection, 100, null);
        
        var results = [];
        if (records && records.objects) {
            for (var i = 0; i < records.objects.length; i++) {
                var item = records.objects[i].value;
                if (item.name && item.name.toLowerCase().indexOf(query) !== -1) {
                    results.push(item);
                }
            }
        }
        
        logger.info("[" + data.gameID + "] Search for '" + query + "' found " + results.length + " items");
        
        return JSON.stringify({
            success: true,
            data: { results: results, query: query }
        });
        
    } catch (err) {
        logger.error("quizverse_search_items error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_search_items
 */
function lasttoliveSearchItems(context, logger, nk, payload) {
    return quizverseSearchItems(context, logger, nk, payload);
}

/**
 * RPC: quizverse_get_quiz_categories
 * Get quiz categories for QuizVerse
 */
function quizverseGetQuizCategories(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        
        var collection = getCollection(data.gameID, "categories");
        
        // Read categories
        var records = nk.storageList("00000000-0000-0000-0000-000000000000", collection, 50, null);
        
        var categories = [];
        if (records && records.objects) {
            for (var i = 0; i < records.objects.length; i++) {
                categories.push(records.objects[i].value);
            }
        }
        
        logger.info("[quizverse] Retrieved " + categories.length + " quiz categories");
        
        return JSON.stringify({
            success: true,
            data: { categories: categories }
        });
        
    } catch (err) {
        logger.error("quizverse_get_quiz_categories error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_get_weapon_stats
 * Get weapon stats for LastToLive
 */
function lasttoliveGetWeaponStats(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        
        var collection = getCollection(data.gameID, "weapon_stats");
        
        // Read weapon stats
        var records = nk.storageList("00000000-0000-0000-0000-000000000000", collection, 100, null);
        
        var weapons = [];
        if (records && records.objects) {
            for (var i = 0; i < records.objects.length; i++) {
                weapons.push(records.objects[i].value);
            }
        }
        
        logger.info("[lasttolive] Retrieved " + weapons.length + " weapon stats");
        
        return JSON.stringify({
            success: true,
            data: { weapons: weapons }
        });
        
    } catch (err) {
        logger.error("lasttolive_get_weapon_stats error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: quizverse_refresh_server_cache
 * Refresh server cache
 */
function quizverseRefreshServerCache(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        
        logger.info("[" + data.gameID + "] Server cache refresh requested");
        
        // In a real implementation, this would refresh various caches
        // For now, just acknowledge the request
        
        return JSON.stringify({
            success: true,
            data: { 
                refreshed: true,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (err) {
        logger.error("quizverse_refresh_server_cache error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_refresh_server_cache
 */
function lasttoliveRefreshServerCache(context, logger, nk, payload) {
    return quizverseRefreshServerCache(context, logger, nk, payload);
}

// ============================================================================
// GROUPS / CLANS / GUILDS
// ============================================================================

/**
 * RPC: quizverse_guild_create
 * Create a guild/clan
 */
function quizverseGuildCreate(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "name"]);
        var userId = getUserId(data, context);
        
        var guildName = data.name;
        var description = data.description || "";
        var avatarUrl = data.avatarUrl || "";
        var open = data.open !== undefined ? data.open : true;
        var maxCount = data.maxCount || 100;
        
        // Create group
        var group = nk.groupCreate(
            userId,
            guildName,
            description,
            avatarUrl,
            "en",
            JSON.stringify({ gameID: data.gameID }),
            open,
            maxCount
        );
        
        logger.info("[" + data.gameID + "] Guild created: " + group.id);
        
        return JSON.stringify({
            success: true,
            data: {
                guildId: group.id,
                name: group.name,
                description: group.description
            }
        });
        
    } catch (err) {
        logger.error("quizverse_guild_create error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_guild_create
 */
function lasttoliveGuildCreate(context, logger, nk, payload) {
    return quizverseGuildCreate(context, logger, nk, payload);
}

/**
 * RPC: quizverse_guild_join
 * Join a guild
 */
function quizverseGuildJoin(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "guildId"]);
        var userId = getUserId(data, context);
        
        // Join group
        nk.groupUserJoin(data.guildId, userId, context.username || userId);
        
        logger.info("[" + data.gameID + "] User " + userId + " joined guild: " + data.guildId);
        
        return JSON.stringify({
            success: true,
            data: {
                guildId: data.guildId,
                userId: userId
            }
        });
        
    } catch (err) {
        logger.error("quizverse_guild_join error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_guild_join
 */
function lasttoliveGuildJoin(context, logger, nk, payload) {
    return quizverseGuildJoin(context, logger, nk, payload);
}

/**
 * RPC: quizverse_guild_leave
 * Leave a guild
 */
function quizverseGuildLeave(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "guildId"]);
        var userId = getUserId(data, context);
        
        // Leave group
        nk.groupUserLeave(data.guildId, userId);
        
        logger.info("[" + data.gameID + "] User " + userId + " left guild: " + data.guildId);
        
        return JSON.stringify({
            success: true,
            data: {
                guildId: data.guildId,
                userId: userId
            }
        });
        
    } catch (err) {
        logger.error("quizverse_guild_leave error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_guild_leave
 */
function lasttoliveGuildLeave(context, logger, nk, payload) {
    return quizverseGuildLeave(context, logger, nk, payload);
}

/**
 * RPC: quizverse_guild_list
 * List guilds
 */
function quizverseGuildList(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var limit = data.limit || 20;
        
        // List groups
        var groups = nk.groupsList("", null, limit);
        
        var guilds = [];
        if (groups) {
            for (var i = 0; i < groups.length; i++) {
                var group = groups[i];
                try {
                    var metadata = JSON.parse(group.metadata);
                    if (metadata.gameID === data.gameID) {
                        guilds.push({
                            guildId: group.id,
                            name: group.name,
                            description: group.description,
                            memberCount: group.edgeCount || 0
                        });
                    }
                } catch (e) {
                    // Skip groups with invalid metadata
                }
            }
        }
        
        logger.info("[" + data.gameID + "] Listed " + guilds.length + " guilds");
        
        return JSON.stringify({
            success: true,
            data: { guilds: guilds }
        });
        
    } catch (err) {
        logger.error("quizverse_guild_list error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_guild_list
 */
function lasttoliveGuildList(context, logger, nk, payload) {
    return quizverseGuildList(context, logger, nk, payload);
}

// ============================================================================
// CHAT / CHANNELS / MESSAGING
// ============================================================================

/**
 * RPC: quizverse_send_channel_message
 * Send message to a channel
 */
function quizverseSendChannelMessage(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "channelId", "content"]);
        var userId = getUserId(data, context);
        
        // Send channel message
        var ack = nk.channelMessageSend(
            data.channelId,
            JSON.stringify({
                content: data.content,
                userId: userId,
                username: context.username || userId
            }),
            userId,
            context.username || userId,
            true
        );
        
        logger.info("[" + data.gameID + "] Message sent to channel: " + data.channelId);
        
        return JSON.stringify({
            success: true,
            data: {
                channelId: data.channelId,
                messageId: ack.messageId,
                timestamp: ack.createTime
            }
        });
        
    } catch (err) {
        logger.error("quizverse_send_channel_message error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_send_channel_message
 */
function lasttolliveSendChannelMessage(context, logger, nk, payload) {
    return quizverseSendChannelMessage(context, logger, nk, payload);
}

// ============================================================================
// TELEMETRY / ANALYTICS
// ============================================================================

/**
 * RPC: quizverse_log_event
 * Log analytics event
 */
function quizverseLogEvent(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "eventName"]);
        var userId = getUserId(data, context);
        
        var eventData = {
            eventName: data.eventName,
            properties: data.properties || {},
            userId: userId,
            timestamp: new Date().toISOString(),
            gameID: data.gameID
        };
        
        // Store event
        var collection = getCollection(data.gameID, "analytics");
        var key = "event_" + userId + "_" + Date.now();
        
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: "00000000-0000-0000-0000-000000000000",
            value: eventData,
            permissionRead: 0,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] Event logged: " + data.eventName);
        
        return JSON.stringify({
            success: true,
            data: { logged: true }
        });
        
    } catch (err) {
        logger.error("quizverse_log_event error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_log_event
 */
function lasttoliveLogEvent(context, logger, nk, payload) {
    return quizverseLogEvent(context, logger, nk, payload);
}

/**
 * RPC: quizverse_track_session_start
 * Track session start
 */
function quizverseTrackSessionStart(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        var userId = getUserId(data, context);
        
        var sessionData = {
            userId: userId,
            startTime: new Date().toISOString(),
            gameID: data.gameID,
            deviceInfo: data.deviceInfo || {}
        };
        
        var collection = getCollection(data.gameID, "sessions");
        var key = "session_" + userId + "_" + Date.now();
        
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: sessionData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] Session started for user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: { sessionKey: key }
        });
        
    } catch (err) {
        logger.error("quizverse_track_session_start error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_track_session_start
 */
function lasttoliveTrackSessionStart(context, logger, nk, payload) {
    return quizverseTrackSessionStart(context, logger, nk, payload);
}

/**
 * RPC: quizverse_track_session_end
 * Track session end
 */
function quizverseTrackSessionEnd(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "sessionKey"]);
        var userId = getUserId(data, context);
        
        var collection = getCollection(data.gameID, "sessions");
        
        // Read session
        var sessionData = null;
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: data.sessionKey,
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value) {
                sessionData = records[0].value;
            }
        } catch (err) {
            throw new Error("Session not found");
        }
        
        if (sessionData) {
            sessionData.endTime = new Date().toISOString();
            sessionData.duration = data.duration || 0;
            
            nk.storageWrite([{
                collection: collection,
                key: data.sessionKey,
                userId: userId,
                value: sessionData,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }
        
        logger.info("[" + data.gameID + "] Session ended for user: " + userId);
        
        return JSON.stringify({
            success: true,
            data: { sessionKey: data.sessionKey }
        });
        
    } catch (err) {
        logger.error("quizverse_track_session_end error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_track_session_end
 */
function lasttoliveTrackSessionEnd(context, logger, nk, payload) {
    return quizverseTrackSessionEnd(context, logger, nk, payload);
}

// ============================================================================
// ADMIN / CONFIG RPCs
// ============================================================================

/**
 * RPC: quizverse_get_server_config
 * Get server configuration
 */
function quizverseGetServerConfig(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID"]);
        
        var collection = getCollection(data.gameID, "config");
        var key = "server_config";
        
        var config = {};
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
            if (records && records.length > 0 && records[0].value) {
                config = records[0].value;
            }
        } catch (err) {
            // Return default config
            config = {
                maxPlayersPerMatch: 10,
                matchDuration: 300,
                enableChat: true
            };
        }
        
        logger.info("[" + data.gameID + "] Server config retrieved");
        
        return JSON.stringify({
            success: true,
            data: { config: config }
        });
        
    } catch (err) {
        logger.error("quizverse_get_server_config error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_get_server_config
 */
function lasttoliveGetServerConfig(context, logger, nk, payload) {
    return quizverseGetServerConfig(context, logger, nk, payload);
}

/**
 * RPC: quizverse_admin_grant_item
 * Admin function to grant item to user
 */
function quizverseAdminGrantItem(context, logger, nk, payload) {
    try {
        var data = parseAndValidateGamePayload(payload, ["gameID", "targetUserId", "itemId", "quantity"]);
        
        // In production, add admin permission check here
        
        var quantity = parseInt(data.quantity);
        if (isNaN(quantity) || quantity <= 0) {
            throw new Error("Invalid quantity");
        }
        
        var collection = getCollection(data.gameID, "inventory");
        var key = "inv_" + data.targetUserId;
        
        // Read inventory
        var inventory = { items: [] };
        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: data.targetUserId
            }]);
            if (records && records.length > 0 && records[0].value) {
                inventory = records[0].value;
            }
        } catch (err) {
            logger.debug("Creating new inventory for admin grant");
        }
        
        // Add item
        var itemFound = false;
        for (var i = 0; i < inventory.items.length; i++) {
            if (inventory.items[i].itemId === data.itemId) {
                inventory.items[i].quantity = (inventory.items[i].quantity || 0) + quantity;
                itemFound = true;
                break;
            }
        }
        
        if (!itemFound) {
            inventory.items.push({
                itemId: data.itemId,
                quantity: quantity,
                grantedBy: "admin",
                createdAt: new Date().toISOString()
            });
        }
        
        // Write inventory
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: data.targetUserId,
            value: inventory,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[" + data.gameID + "] Admin granted " + quantity + "x " + data.itemId + " to user: " + data.targetUserId);
        
        return JSON.stringify({
            success: true,
            data: {
                targetUserId: data.targetUserId,
                itemId: data.itemId,
                quantity: quantity
            }
        });
        
    } catch (err) {
        logger.error("quizverse_admin_grant_item error: " + err.message);
        throw {
            code: 400,
            message: err.message,
            data: {}
        };
    }
}

/**
 * RPC: lasttolive_admin_grant_item
 */
function lasttoliveAdminGrantItem(context, logger, nk, payload) {
    return quizverseAdminGrantItem(context, logger, nk, payload);
}


function InitModule(ctx, logger, nk, initializer) {
    logger.info('========================================');
    logger.info('Starting JavaScript Runtime Initialization');
    logger.info('========================================');
    
    // Register Copilot Wallet Mapping RPCs
    try {
        logger.info('[Copilot] Initializing Wallet Mapping Module...');
        
        // Register RPC: get_user_wallet
        initializer.registerRpc('get_user_wallet', getUserWallet);
        logger.info('[Copilot] Registered RPC: get_user_wallet');
        
        // Register RPC: link_wallet_to_game
        initializer.registerRpc('link_wallet_to_game', linkWalletToGame);
        logger.info('[Copilot] Registered RPC: link_wallet_to_game');
        
        // Register RPC: get_wallet_registry
        initializer.registerRpc('get_wallet_registry', getWalletRegistry);
        logger.info('[Copilot] Registered RPC: get_wallet_registry');
        
        logger.info('[Copilot] Successfully registered 3 wallet RPC functions');
    } catch (err) {
        logger.error('[Copilot] Failed to initialize wallet module: ' + err.message);
    }
    
    // Register Leaderboard RPCs
    initializer.registerRpc('create_all_leaderboards_persistent', createAllLeaderboardsPersistent);
    logger.info('[Leaderboards] Registered RPC: create_all_leaderboards_persistent');
    
    // Register Time-Period Leaderboard RPCs
    try {
        logger.info('[Leaderboards] Initializing Time-Period Leaderboard Module...');
        initializer.registerRpc('create_time_period_leaderboards', rpcCreateTimePeriodLeaderboards);
        logger.info('[Leaderboards] Registered RPC: create_time_period_leaderboards');
        initializer.registerRpc('submit_score_to_time_periods', rpcSubmitScoreToTimePeriods);
        logger.info('[Leaderboards] Registered RPC: submit_score_to_time_periods');
        initializer.registerRpc('get_time_period_leaderboard', rpcGetTimePeriodLeaderboard);
        logger.info('[Leaderboards] Registered RPC: get_time_period_leaderboard');
        logger.info('[Leaderboards] Successfully registered 3 Time-Period Leaderboard RPCs');
    } catch (err) {
        logger.error('[Leaderboards] Failed to initialize time-period leaderboards: ' + err.message);
    }
    
    // Register Daily Rewards RPCs
    try {
        logger.info('[DailyRewards] Initializing Daily Rewards Module...');
        initializer.registerRpc('daily_rewards_get_status', rpcDailyRewardsGetStatus);
        logger.info('[DailyRewards] Registered RPC: daily_rewards_get_status');
        initializer.registerRpc('daily_rewards_claim', rpcDailyRewardsClaim);
        logger.info('[DailyRewards] Registered RPC: daily_rewards_claim');
        logger.info('[DailyRewards] Successfully registered 2 Daily Rewards RPCs');
    } catch (err) {
        logger.error('[DailyRewards] Failed to initialize: ' + err.message);
    }
    
    // Register Daily Missions RPCs
    try {
        logger.info('[DailyMissions] Initializing Daily Missions Module...');
        initializer.registerRpc('get_daily_missions', rpcGetDailyMissions);
        logger.info('[DailyMissions] Registered RPC: get_daily_missions');
        initializer.registerRpc('submit_mission_progress', rpcSubmitMissionProgress);
        logger.info('[DailyMissions] Registered RPC: submit_mission_progress');
        initializer.registerRpc('claim_mission_reward', rpcClaimMissionReward);
        logger.info('[DailyMissions] Registered RPC: claim_mission_reward');
        logger.info('[DailyMissions] Successfully registered 3 Daily Missions RPCs');
    } catch (err) {
        logger.error('[DailyMissions] Failed to initialize: ' + err.message);
    }
    
    // Register Enhanced Wallet RPCs
    try {
        logger.info('[Wallet] Initializing Enhanced Wallet Module...');
        initializer.registerRpc('wallet_get_all', rpcWalletGetAll);
        logger.info('[Wallet] Registered RPC: wallet_get_all');
        initializer.registerRpc('wallet_update_global', rpcWalletUpdateGlobal);
        logger.info('[Wallet] Registered RPC: wallet_update_global');
        initializer.registerRpc('wallet_update_game_wallet', rpcWalletUpdateGameWallet);
        logger.info('[Wallet] Registered RPC: wallet_update_game_wallet');
        initializer.registerRpc('wallet_transfer_between_game_wallets', rpcWalletTransferBetweenGameWallets);
        logger.info('[Wallet] Registered RPC: wallet_transfer_between_game_wallets');
        logger.info('[Wallet] Successfully registered 4 Enhanced Wallet RPCs');
    } catch (err) {
        logger.error('[Wallet] Failed to initialize: ' + err.message);
    }
    
    // Register Analytics RPCs
    try {
        logger.info('[Analytics] Initializing Analytics Module...');
        initializer.registerRpc('analytics_log_event', rpcAnalyticsLogEvent);
        logger.info('[Analytics] Registered RPC: analytics_log_event');
        logger.info('[Analytics] Successfully registered 1 Analytics RPC');
    } catch (err) {
        logger.error('[Analytics] Failed to initialize: ' + err.message);
    }
    
    // Register Enhanced Friends RPCs
    try {
        logger.info('[Friends] Initializing Enhanced Friends Module...');
        initializer.registerRpc('friends_block', rpcFriendsBlock);
        logger.info('[Friends] Registered RPC: friends_block');
        initializer.registerRpc('friends_unblock', rpcFriendsUnblock);
        logger.info('[Friends] Registered RPC: friends_unblock');
        initializer.registerRpc('friends_remove', rpcFriendsRemove);
        logger.info('[Friends] Registered RPC: friends_remove');
        initializer.registerRpc('friends_list', rpcFriendsList);
        logger.info('[Friends] Registered RPC: friends_list');
        initializer.registerRpc('friends_challenge_user', rpcFriendsChallengeUser);
        logger.info('[Friends] Registered RPC: friends_challenge_user');
        initializer.registerRpc('friends_spectate', rpcFriendsSpectate);
        logger.info('[Friends] Registered RPC: friends_spectate');
        logger.info('[Friends] Successfully registered 6 Enhanced Friends RPCs');
    } catch (err) {
        logger.error('[Friends] Failed to initialize: ' + err.message);
    }
    
    // Register Groups/Clans/Guilds RPCs
    try {
        logger.info('[Groups] Initializing Groups/Clans/Guilds Module...');
        initializer.registerRpc('create_game_group', rpcCreateGameGroup);
        logger.info('[Groups] Registered RPC: create_game_group');
        initializer.registerRpc('update_group_xp', rpcUpdateGroupXP);
        logger.info('[Groups] Registered RPC: update_group_xp');
        initializer.registerRpc('get_group_wallet', rpcGetGroupWallet);
        logger.info('[Groups] Registered RPC: get_group_wallet');
        initializer.registerRpc('update_group_wallet', rpcUpdateGroupWallet);
        logger.info('[Groups] Registered RPC: update_group_wallet');
        initializer.registerRpc('get_user_groups', rpcGetUserGroups);
        logger.info('[Groups] Registered RPC: get_user_groups');
        logger.info('[Groups] Successfully registered 5 Groups/Clans RPCs');
    } catch (err) {
        logger.error('[Groups] Failed to initialize: ' + err.message);
    }
    
    // Register Push Notifications RPCs
    try {
        logger.info('[PushNotifications] Initializing Push Notification Module...');
        initializer.registerRpc('push_register_token', rpcPushRegisterToken);
        logger.info('[PushNotifications] Registered RPC: push_register_token');
        initializer.registerRpc('push_send_event', rpcPushSendEvent);
        logger.info('[PushNotifications] Registered RPC: push_send_event');
        initializer.registerRpc('push_get_endpoints', rpcPushGetEndpoints);
        logger.info('[PushNotifications] Registered RPC: push_get_endpoints');
        logger.info('[PushNotifications] Successfully registered 3 Push Notification RPCs');
    } catch (err) {
        logger.error('[PushNotifications] Failed to initialize: ' + err.message);
    }
    
    // Load copilot modules
    try {
        initializeCopilotModules(ctx, logger, nk, initializer);
    } catch (err) {
        logger.error('Failed to load copilot modules: ' + err.message);
    }
    
    // Register New Multi-Game Identity, Wallet, and Leaderboard RPCs
    try {
        logger.info('[MultiGame] Initializing Multi-Game Identity, Wallet, and Leaderboard Module...');
        initializer.registerRpc('create_or_sync_user', createOrSyncUser);
        logger.info('[MultiGame] Registered RPC: create_or_sync_user');
        initializer.registerRpc('create_or_get_wallet', createOrGetWallet);
        logger.info('[MultiGame] Registered RPC: create_or_get_wallet');
        initializer.registerRpc('submit_score_and_sync', submitScoreAndSync);
        logger.info('[MultiGame] Registered RPC: submit_score_and_sync');
        initializer.registerRpc('get_all_leaderboards', getAllLeaderboards);
        logger.info('[MultiGame] Registered RPC: get_all_leaderboards');
        logger.info('[MultiGame] Successfully registered 4 Multi-Game RPCs');
    } catch (err) {
        logger.error('[MultiGame] Failed to initialize: ' + err.message);
    }
    
    // Register Standard Player RPCs (simplified naming conventions)
    try {
        logger.info('[PlayerRPCs] Initializing Standard Player RPCs...');
        initializer.registerRpc('create_player_wallet', rpcCreatePlayerWallet);
        logger.info('[PlayerRPCs] Registered RPC: create_player_wallet');
        initializer.registerRpc('update_wallet_balance', rpcUpdateWalletBalance);
        logger.info('[PlayerRPCs] Registered RPC: update_wallet_balance');
        initializer.registerRpc('get_wallet_balance', rpcGetWalletBalance);
        logger.info('[PlayerRPCs] Registered RPC: get_wallet_balance');
        initializer.registerRpc('submit_leaderboard_score', rpcSubmitLeaderboardScore);
        logger.info('[PlayerRPCs] Registered RPC: submit_leaderboard_score');
        initializer.registerRpc('get_leaderboard', rpcGetLeaderboard);
        logger.info('[PlayerRPCs] Registered RPC: get_leaderboard');
        logger.info('[PlayerRPCs] Successfully registered 5 Standard Player RPCs');
    } catch (err) {
        logger.error('[PlayerRPCs] Failed to initialize: ' + err.message);
    }
    
    // Register Chat RPCs (Group Chat, Direct Chat, Chat Rooms)
    try {
        logger.info('[Chat] Initializing Chat Module...');
        initializer.registerRpc('send_group_chat_message', rpcSendGroupChatMessage);
        logger.info('[Chat] Registered RPC: send_group_chat_message');
        initializer.registerRpc('send_direct_message', rpcSendDirectMessage);
        logger.info('[Chat] Registered RPC: send_direct_message');
        initializer.registerRpc('send_chat_room_message', rpcSendChatRoomMessage);
        logger.info('[Chat] Registered RPC: send_chat_room_message');
        initializer.registerRpc('get_group_chat_history', rpcGetGroupChatHistory);
        logger.info('[Chat] Registered RPC: get_group_chat_history');
        initializer.registerRpc('get_direct_message_history', rpcGetDirectMessageHistory);
        logger.info('[Chat] Registered RPC: get_direct_message_history');
        initializer.registerRpc('get_chat_room_history', rpcGetChatRoomHistory);
        logger.info('[Chat] Registered RPC: get_chat_room_history');
        initializer.registerRpc('mark_direct_messages_read', rpcMarkDirectMessagesRead);
        logger.info('[Chat] Registered RPC: mark_direct_messages_read');
        logger.info('[Chat] Successfully registered 7 Chat RPCs');
    } catch (err) {
        logger.error('[Chat] Failed to initialize: ' + err.message);
    }
    
    // Register Multi-Game RPCs (QuizVerse and LastToLive)
    try {
        logger.info('[MultiGameRPCs] Initializing Multi-Game RPC Module...');
        
        // Initialize global RPC registry for safe auto-registration
        if (!globalThis.__registeredRPCs) {
            globalThis.__registeredRPCs = new Set();
        }
        
        var mgRpcs = [
            // QuizVerse RPCs - Core
            { id: 'quizverse_update_user_profile', handler: quizverseUpdateUserProfile },
            { id: 'quizverse_grant_currency', handler: quizverseGrantCurrency },
            { id: 'quizverse_spend_currency', handler: quizverseSpendCurrency },
            { id: 'quizverse_validate_purchase', handler: quizverseValidatePurchase },
            { id: 'quizverse_list_inventory', handler: quizverseListInventory },
            { id: 'quizverse_grant_item', handler: quizverseGrantItem },
            { id: 'quizverse_consume_item', handler: quizverseConsumeItem },
            { id: 'quizverse_submit_score', handler: quizverseSubmitScore },
            { id: 'quizverse_get_leaderboard', handler: quizverseGetLeaderboard },
            { id: 'quizverse_join_or_create_match', handler: quizverseJoinOrCreateMatch },
            { id: 'quizverse_claim_daily_reward', handler: quizverseClaimDailyReward },
            { id: 'quizverse_find_friends', handler: quizverseFindFriends },
            { id: 'quizverse_save_player_data', handler: quizverseSavePlayerData },
            { id: 'quizverse_load_player_data', handler: quizverseLoadPlayerData },
            
            // QuizVerse RPCs - Catalog & Search
            { id: 'quizverse_get_item_catalog', handler: quizverseGetItemCatalog },
            { id: 'quizverse_search_items', handler: quizverseSearchItems },
            { id: 'quizverse_get_quiz_categories', handler: quizverseGetQuizCategories },
            { id: 'quizverse_refresh_server_cache', handler: quizverseRefreshServerCache },
            
            // QuizVerse RPCs - Guilds
            { id: 'quizverse_guild_create', handler: quizverseGuildCreate },
            { id: 'quizverse_guild_join', handler: quizverseGuildJoin },
            { id: 'quizverse_guild_leave', handler: quizverseGuildLeave },
            { id: 'quizverse_guild_list', handler: quizverseGuildList },
            
            // QuizVerse RPCs - Chat
            { id: 'quizverse_send_channel_message', handler: quizverseSendChannelMessage },
            
            // QuizVerse RPCs - Analytics
            { id: 'quizverse_log_event', handler: quizverseLogEvent },
            { id: 'quizverse_track_session_start', handler: quizverseTrackSessionStart },
            { id: 'quizverse_track_session_end', handler: quizverseTrackSessionEnd },
            
            // QuizVerse RPCs - Admin
            { id: 'quizverse_get_server_config', handler: quizverseGetServerConfig },
            { id: 'quizverse_admin_grant_item', handler: quizverseAdminGrantItem },
            
            // LastToLive RPCs - Core
            { id: 'lasttolive_update_user_profile', handler: lasttoliveUpdateUserProfile },
            { id: 'lasttolive_grant_currency', handler: lasttoliveGrantCurrency },
            { id: 'lasttolive_spend_currency', handler: lasttoliveSpendCurrency },
            { id: 'lasttolive_validate_purchase', handler: lasttoliveValidatePurchase },
            { id: 'lasttolive_list_inventory', handler: lasttoliveListInventory },
            { id: 'lasttolive_grant_item', handler: lasttoliveGrantItem },
            { id: 'lasttolive_consume_item', handler: lasttoliveConsumeItem },
            { id: 'lasttolive_submit_score', handler: lasttoliveSubmitScore },
            { id: 'lasttolive_get_leaderboard', handler: lasttoliveGetLeaderboard },
            { id: 'lasttolive_join_or_create_match', handler: lasttoliveJoinOrCreateMatch },
            { id: 'lasttolive_claim_daily_reward', handler: lasttoliveClaimDailyReward },
            { id: 'lasttolive_find_friends', handler: lasttolliveFindFriends },
            { id: 'lasttolive_save_player_data', handler: lasttolliveSavePlayerData },
            { id: 'lasttolive_load_player_data', handler: lasttoliveLoadPlayerData },
            
            // LastToLive RPCs - Catalog & Search
            { id: 'lasttolive_get_item_catalog', handler: lasttoliveGetItemCatalog },
            { id: 'lasttolive_search_items', handler: lasttoliveSearchItems },
            { id: 'lasttolive_get_weapon_stats', handler: lasttoliveGetWeaponStats },
            { id: 'lasttolive_refresh_server_cache', handler: lasttoliveRefreshServerCache },
            
            // LastToLive RPCs - Guilds
            { id: 'lasttolive_guild_create', handler: lasttoliveGuildCreate },
            { id: 'lasttolive_guild_join', handler: lasttoliveGuildJoin },
            { id: 'lasttolive_guild_leave', handler: lasttoliveGuildLeave },
            { id: 'lasttolive_guild_list', handler: lasttoliveGuildList },
            
            // LastToLive RPCs - Chat
            { id: 'lasttolive_send_channel_message', handler: lasttolliveSendChannelMessage },
            
            // LastToLive RPCs - Analytics
            { id: 'lasttolive_log_event', handler: lasttoliveLogEvent },
            { id: 'lasttolive_track_session_start', handler: lasttoliveTrackSessionStart },
            { id: 'lasttolive_track_session_end', handler: lasttoliveTrackSessionEnd },
            
            // LastToLive RPCs - Admin
            { id: 'lasttolive_get_server_config', handler: lasttoliveGetServerConfig },
            { id: 'lasttolive_admin_grant_item', handler: lasttoliveAdminGrantItem }
        ];
        
        var mgRegistered = 0;
        var mgSkipped = 0;
        
        for (var i = 0; i < mgRpcs.length; i++) {
            var mgRpc = mgRpcs[i];
            
            if (!globalThis.__registeredRPCs.has(mgRpc.id)) {
                try {
                    initializer.registerRpc(mgRpc.id, mgRpc.handler);
                    globalThis.__registeredRPCs.add(mgRpc.id);
                    logger.info('[MultiGameRPCs] ✓ Registered RPC: ' + mgRpc.id);
                    mgRegistered++;
                } catch (err) {
                    logger.error('[MultiGameRPCs] ✗ Failed to register ' + mgRpc.id + ': ' + err.message);
                }
            } else {
                logger.info('[MultiGameRPCs] ⊘ Skipped (already registered): ' + mgRpc.id);
                mgSkipped++;
            }
        }
        
        logger.info('[MultiGameRPCs] Registration complete: ' + mgRegistered + ' registered, ' + mgSkipped + ' skipped');
        logger.info('[MultiGameRPCs] Successfully registered ' + mgRpcs.length + ' Multi-Game RPCs');
    } catch (err) {
        logger.error('[MultiGameRPCs] Failed to initialize: ' + err.message);
    }
    
    logger.info('========================================');
    logger.info('JavaScript Runtime Initialization Complete');
    logger.info('Total New System RPCs: 71 (28 Multi-Game + 4 Multi-Game + 5 Standard Player + 2 Daily Rewards + 3 Daily Missions + 4 Wallet + 1 Analytics + 6 Friends + 3 Time-Period Leaderboards + 5 Groups/Clans + 3 Push Notifications + 7 Chat)');
    logger.info('Plus existing Copilot RPCs (Wallet Mapping + Leaderboards + Social)');
    logger.info('========================================');
}
