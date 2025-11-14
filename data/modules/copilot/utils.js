// utils.js - Shared helper functions for leaderboard modules

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
export {
    validatePayload,
    readRegistry,
    safeJsonParse,
    handleError,
    logInfo,
    logWarn,
    logError,
    isValidUUID,
    getCurrentTimestamp,
    getUnixTimestamp,
    isWithinHours,
    getStartOfDay,
    makeGameStorageKey,
    makeGlobalStorageKey,
    readStorage,
    writeStorage
};
