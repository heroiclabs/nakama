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

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validatePayload: validatePayload,
        readRegistry: readRegistry,
        safeJsonParse: safeJsonParse,
        handleError: handleError,
        logInfo: logInfo,
        logWarn: logWarn,
        logError: logError
    };
}
