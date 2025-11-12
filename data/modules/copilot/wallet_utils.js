// wallet_utils.js - Helper utilities for Cognito JWT handling and validation

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

// Export functions for use in other modules
var WalletUtils = {
    decodeJWT: decodeJWT,
    extractUserInfo: extractUserInfo,
    validateJWTStructure: validateJWTStructure,
    generateWalletId: generateWalletId,
    logWalletOperation: logWalletOperation,
    handleWalletError: handleWalletError
};
