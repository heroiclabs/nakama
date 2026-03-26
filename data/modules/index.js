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
    const REGISTRY_SYSTEM_USER = "00000000-0000-0000-0000-000000000000"; // Only for registry metadata
    try {
        const records = nk.storageRead([{
            collection: collection,
            key: "all_created",
            userId: REGISTRY_SYSTEM_USER
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
 * Log an RPC error to the analytics_error_events collection for tracking.
 * Safe to call from any RPC catch block. Failures are silently ignored.
 */
function logRpcError(nk, logger, rpcName, errorMessage, userId, gameId) {
    try {
        var now = new Date();
        var dateStr = now.toISOString().slice(0, 10);
        var key = "err_" + rpcName + "_" + (userId || "system") + "_" + Date.now();
        nk.storageWrite([{
            collection: "analytics_error_events",
            key: key,
            userId: "00000000-0000-0000-0000-000000000000",
            value: {
                rpc_name: rpcName,
                error_message: errorMessage,
                user_id: userId || null,
                game_id: gameId || null,
                date: dateStr,
                timestamp: now.toISOString(),
                unix_ts: Math.floor(now.getTime() / 1000)
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (e) {
        if (logger) {
            logger.warn("[ErrorTracking] Failed to log error event: " + e.message);
        }
    }
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
 * =============================================================================
 * RPC: rpc_update_player_metadata (UNIFIED - Production Ready)
 * =============================================================================
 *
 * STORAGE SPECIFICATION:
 *   Collection: "player_metadata"
 *   Key: "user_identity"
 *   Permissions:
 *     - permissionRead: 1 (OWNER_READ)
 *     - permissionWrite: 0 (NO_WRITE - server only)
 *
 * FEATURES:
 *   - Single source of truth for player identity
 *   - Game history tracking (list of all games played)
 *   - Geolocation with lat/long support
 *   - Device tracking and fingerprinting
 *   - Session analytics
 *   - Wallet references
 *   - Cognito/IDP integration
 *   - Automatic cleanup of legacy data
 *   - Comprehensive validation and error handling
 *   - Rate limiting protection
 *   - Data sanitization
 *
 * EXPECTED PAYLOAD:
 * {
 *   "role": "user",
 *   "email": "user@example.com",
 *   "game_id": "uuid",
 *   "is_adult": "True",
 *   "last_name": "Doe",
 *   "first_name": "John",
 *   "login_type": "cognito",
 *   "idp_username": ".. .",
 *   "account_status": "active",
 *   "wallet_address": "0x...",
 *   "cognito_user_id": "uuid",
 *   "geo_location": "US",
 *   "device_id": ".. .",
 *   "latitude": 29.7604,
 *   "longitude": -95.3698,
 *   "platform": "Android",
 *   "app_version": "1.2.3",
 *   "device_model": "Pixel 7",
 *   "os_version": "14.0"
 * }
 *
 * =============================================================================
 */

// ============================================================================
// CONSTANTS
// ============================================================================

var PLAYER_METADATA_COLLECTION = "player_metadata";
var PLAYER_METADATA_KEY = "user_identity";
var PERMISSION_READ_OWNER = 1;   // OWNER_READ
var PERMISSION_WRITE_NONE = 0;   // NO_WRITE (server only)

// Rate limiting: minimum seconds between updates
var MIN_UPDATE_INTERVAL_SECONDS = 5;

// Guest user cleanup constants
var GUEST_USER_USERNAME_PREFIX = "guest_test_";
var GUEST_CLEANUP_DEFAULT_LIMIT = 10000;
var DEVICE_USER_MAPPINGS_COLLECTION = "device_user_mappings";
var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";


// Maximum lengths for string fields (prevent abuse)
var MAX_STRING_LENGTHS = {
    email: 254,
    first_name: 100,
    last_name: 100,
    display_name: 50,
    avatar_url: 2048,
    role: 50,
    login_type: 50,
    idp_username: 256,
    account_status: 50,
    wallet_address: 256,
    cognito_user_id: 128,
    geo_location: 10,
    device_id: 256,
    platform: 50,
    app_version: 50,
    device_model: 100,
    device_name: 100,
    os_version: 100,
    unity_version: 50,
    city: 100,
    region: 100,
    country: 100,
    country_code: 5,
    timezone: 100,
    locale: 20,
    screen_dpi: 20,
    graphics_device: 150,
    processor_type: 150
};

// Valid account statuses
var VALID_ACCOUNT_STATUSES = ["active", "inactive", "suspended", "pending", "banned"];

// Valid login types
var VALID_LOGIN_TYPES = ["cognito", "device", "guest", "email", "google", "apple", "facebook", "custom"];

// Valid roles
var VALID_ROLES = ["user", "guest", "admin", "moderator", "premium", "vip"];

// Legacy storage locations to clean up
var LEGACY_STORAGE_LOCATIONS = [
    { collection: "player_data", key: "player_metadata" },
    { collection: "player_metadata", key: "metadata" },
    { collection: "personal", key: "PlayerSnapshot" }
];

// ============================================================================
// MAIN RPC FUNCTION
// ============================================================================

function rpcUpdatePlayerMetadataUnified(ctx, logger, nk, payload) {
    var startTime = Date.now();
    var requestId = generateShortUUID();

    logger.info("[PlayerMetadata:" + requestId + "] RPC called");

    // -------------------------------------------------------------------------
    // Step 1: Authentication Check
    // -------------------------------------------------------------------------
    if (!ctx.userId) {
        logger.error("[PlayerMetadata:" + requestId + "] User not authenticated");
        return buildErrorResponse("User not authenticated", "AUTH_REQUIRED", requestId);
    }

    var userId = ctx.userId;

    // -------------------------------------------------------------------------
    // Step 2: Parse and Validate Payload
    // -------------------------------------------------------------------------
    var meta;
    try {
        meta = JSON.parse(payload || "{}");
    } catch (err) {
        logger.error("[PlayerMetadata:" + requestId + "] Invalid JSON: " + err.message);
        return buildErrorResponse("Invalid JSON payload", "INVALID_JSON", requestId);
    }

    // Validate payload is an object
    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
        logger.error("[PlayerMetadata:" + requestId + "] Payload must be an object");
        return buildErrorResponse("Payload must be a JSON object", "INVALID_PAYLOAD", requestId);
    }

    // -------------------------------------------------------------------------
    // Step 3: Read Existing Metadata
    // -------------------------------------------------------------------------
    var existing = null;
    var existingVersion = null;
    var isNewUser = false;

    try {
        var records = nk.storageRead([{
            collection: PLAYER_METADATA_COLLECTION,
            key: PLAYER_METADATA_KEY,
            userId: userId
        }]);

        if (records && records.length > 0 && records[0].value) {
            existing = records[0].value;
            existingVersion = records[0].version;
            logger.debug("[PlayerMetadata:" + requestId + "] Found existing metadata (version: " + existingVersion + ")");

            // Rate limiting check
            if (existing.updated_at) {
                var lastUpdate = new Date(existing.updated_at).getTime();
                var now = Date.now();
                var secondsSinceUpdate = (now - lastUpdate) / 1000;

                if (secondsSinceUpdate < MIN_UPDATE_INTERVAL_SECONDS) {
                    logger.warn("[PlayerMetadata:" + requestId + "] Rate limited.  Last update: " +
                        secondsSinceUpdate.toFixed(1) + "s ago");
                    // Don't reject, but log the rapid updates
                }
            }
        } else {
            isNewUser = true;
            logger.info("[PlayerMetadata:" + requestId + "] New user, creating metadata");
        }
    } catch (err) {
        logger.warn("[PlayerMetadata:" + requestId + "] Error reading existing: " + err.message);
        isNewUser = true;
    }

    // -------------------------------------------------------------------------
    // Step 4: Sanitize and Validate Input Fields
    // -------------------------------------------------------------------------
    var sanitized = sanitizeMetadataPayload(meta, logger, requestId);
    var validationResult = validateMetadataPayload(sanitized, logger, requestId);

    if (validationResult.errors.length > 0) {
        logger.warn("[PlayerMetadata:" + requestId + "] Validation warnings: " +
            validationResult.errors.join("; "));
    }

    // -------------------------------------------------------------------------
    // Step 5: Build Merged Metadata Object
    // -------------------------------------------------------------------------
    var now = new Date().toISOString();
    var merged = buildMergedMetadata(existing, sanitized, now, isNewUser, userId, ctx);

    // -------------------------------------------------------------------------
    // Step 6: Handle Game Tracking
    // -------------------------------------------------------------------------
    if (sanitized.game_id && isValidUUIDFormat(sanitized.game_id)) {
        merged = updateGameHistory(merged, sanitized.game_id, now);
        logger.debug("[PlayerMetadata:" + requestId + "] Updated game history for: " + sanitized.game_id);
    }

    // -------------------------------------------------------------------------
    // Step 7: Handle Geolocation
    // -------------------------------------------------------------------------
    merged = updateGeolocation(merged, sanitized, now);

    // -------------------------------------------------------------------------
    // Step 7b: Auto-resolve location if coordinates provided but city/country missing
    // -------------------------------------------------------------------------
    if (merged.has_location_data && !merged.has_resolved_location) {
        // We have lat/long but no city/country - try to resolve automatically
        logger.info("[PlayerMetadata:" + requestId + "] Attempting auto-resolution for coordinates: " +
            merged.latitude + ", " + merged.longitude);

        var resolved = resolveLocationFromCoordinates(nk, logger, ctx, merged.latitude, merged.longitude);

        if (resolved) {
            // Update merged metadata with resolved location
            if (resolved.country) {
                merged.country = resolved.country;
            }
            if (resolved.country_code) {
                merged.country_code = resolved.country_code;
                merged.geo_location = resolved.country_code;
            }
            if (resolved.region) {
                merged.region = resolved.region;
                merged.state = resolved.region;
            }
            if (resolved.city) {
                merged.city = resolved.city;
            }

            // Update location history entry with resolved data
            if (merged.location_history && merged.location_history.length > 0) {
                var lastEntry = merged.location_history[merged.location_history.length - 1];
                if (resolved.country_code) lastEntry.country_code = resolved.country_code;
                if (resolved.city) lastEntry.city = resolved.city;
                if (resolved.region) lastEntry.region = resolved.region;
            }

            // Update most_visited_location if exists
            if (merged.most_visited_location) {
                if (resolved.city) merged.most_visited_location.city = resolved.city;
                if (resolved.country_code) merged.most_visited_location.country_code = resolved.country_code;
            }

            // Build formatted location strings
            var locationParts = [];
            if (merged.city) locationParts.push(merged.city);
            if (merged.region) locationParts.push(merged.region);
            if (merged.country) locationParts.push(merged.country);

            if (locationParts.length > 0) {
                merged.formatted_location = locationParts.join(", ");
            }

            if (merged.city && merged.country_code) {
                merged.location_short = merged.city + ", " + merged.country_code;
            } else if (merged.country_code) {
                merged.location_short = merged.country_code;
            }

            // Update flags
            merged.has_resolved_location = true;
            merged.location_resolved_at = now;
            merged.unique_countries_visited = merged.unique_countries_visited || 1;
            merged.unique_cities_visited = merged.unique_cities_visited || (merged.city ? 1 : 0);

            logger.info("[PlayerMetadata:" + requestId + "] âœ“ Location auto-resolved: " +
                (merged.city || "N/A") + ", " + (merged.region || "N/A") + ", " +
                (merged.country_code || "N/A"));
        } else {
            logger.warn("[PlayerMetadata:" + requestId + "] Could not auto-resolve location from coordinates");
        }
    }

    // -------------------------------------------------------------------------
    // Step 8: Handle Device Information
    // -------------------------------------------------------------------------
    merged = updateDeviceInfo(merged, sanitized, now);

    // -------------------------------------------------------------------------
    // Step 9: Handle Session Analytics
    // -------------------------------------------------------------------------
    merged = updateSessionAnalytics(merged, now, isNewUser);

    // -------------------------------------------------------------------------
    // Step 10: Sync to Nakama Account FIRST (display_name, timezone, location)
    // This ensures Account tab is updated even if storage write fails later
    // -------------------------------------------------------------------------
    syncMetadataToNakamaAccount(nk, logger, userId, merged, sanitized, requestId);

    // -------------------------------------------------------------------------
    // Step 11: Write to Storage with optimistic concurrency + retry
    // -------------------------------------------------------------------------
    var storageWriteSuccess = true;
    var WRITE_MAX_RETRIES = 3;

    for (var writeAttempt = 0; writeAttempt <= WRITE_MAX_RETRIES; writeAttempt++) {
        try {
            nk.storageWrite([{
                collection: PLAYER_METADATA_COLLECTION,
                key: PLAYER_METADATA_KEY,
                userId: userId,
                value: merged,
                permissionRead: PERMISSION_READ_OWNER,
                permissionWrite: PERMISSION_WRITE_NONE,
                version: existingVersion || "*"
            }]);

            logger.info("[PlayerMetadata:" + requestId + "] Metadata saved successfully" +
                (writeAttempt > 0 ? " (after " + writeAttempt + " retries)" : ""));
            break;
        } catch (err) {
            if (writeAttempt < WRITE_MAX_RETRIES) {
                logger.warn("[PlayerMetadata:" + requestId + "] Storage version conflict (attempt " +
                    (writeAttempt + 1) + "/" + WRITE_MAX_RETRIES + "), re-reading and retrying");
                try {
                    var freshRecords = nk.storageRead([{
                        collection: PLAYER_METADATA_COLLECTION,
                        key: PLAYER_METADATA_KEY,
                        userId: userId
                    }]);
                    if (freshRecords && freshRecords.length > 0 && freshRecords[0].value) {
                        existingVersion = freshRecords[0].version;
                        var freshData = freshRecords[0].value;
                        merged = buildMergedMetadata(freshData, sanitized, now, false, userId, ctx);
                        if (sanitized.game_id && isValidUUIDFormat(sanitized.game_id)) {
                            merged = updateGameHistory(merged, sanitized.game_id, now);
                        }
                        merged = updateGeolocation(merged, sanitized, now);
                        merged = updateDeviceInfo(merged, sanitized, now);
                        merged = updateSessionAnalytics(merged, now, false);
                    }
                } catch (readErr) {
                    logger.error("[PlayerMetadata:" + requestId + "] Re-read failed during retry: " + readErr.message);
                }
            } else {
                logger.error("[PlayerMetadata:" + requestId + "] Storage write failed after " +
                    WRITE_MAX_RETRIES + " retries (Account already synced): " + err.message);
                storageWriteSuccess = false;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Step 12: Cleanup Legacy Data (async, non-blocking)
    // -------------------------------------------------------------------------
    cleanupLegacyMetadataAsync(nk, logger, userId, requestId);

    // -------------------------------------------------------------------------
    // Step 13: Build Success Response
    // -------------------------------------------------------------------------
    var executionTime = Date.now() - startTime;

    logger.info("[PlayerMetadata:" + requestId + "] Completed in " + executionTime + "ms" +
        " | Games: " + (merged.total_games || 0) +
        " | New: " + isNewUser +
        " | StorageOK: " + storageWriteSuccess);

    return JSON.stringify({
        success: true,
        metadata: merged,
        is_new_user: isNewUser,
        execution_time_ms: executionTime,
        request_id: requestId,
        storage_write_success: storageWriteSuccess,
        storage: {
            collection: PLAYER_METADATA_COLLECTION,
            key: PLAYER_METADATA_KEY,
            permission_read: "OWNER_READ",
            permission_write: "NO_WRITE"
        }
    });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate short UUID for request tracking
 */
function generateShortUUID() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var result = '';
    for (var i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Build standardized error response
 */
function buildErrorResponse(message, errorCode, requestId) {
    return JSON.stringify({
        success: false,
        error: message,
        error_code: errorCode,
        request_id: requestId,
        timestamp: new Date().toISOString()
    });
}

/**
 * Validate UUID format (RFC 4122)
 */
function isValidUUIDFormat(str) {
    if (!str || typeof str !== 'string') return false;
    var uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    return uuidRegex.test(str);
}

/**
 * Validate email format
 */
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= MAX_STRING_LENGTHS.email;
}


/**
 * Validate latitude
 */
function isValidLatitude(lat) {
    if (lat === null || lat === undefined) return false;
    var num = Number(lat);
    return !isNaN(num) && num >= -90 && num <= 90;
}

/**
 * Validate longitude
 */
function isValidLongitude(lon) {
    if (lon === null || lon === undefined) return false;
    var num = Number(lon);
    return !isNaN(num) && num >= -180 && num <= 180;
}

/**
 * Sanitize string field
 */
function sanitizeString(value, maxLength) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value !== 'string') {
        value = String(value);
    }

    // Trim whitespace
    value = value.trim();

    // Remove control characters (except newlines and tabs for some fields)
    value = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Truncate if too long
    if (maxLength && value.length > maxLength) {
        value = value.substring(0, maxLength);
    }

    return value;
}


/**
 * Sanitize the entire metadata payload
 */
function sanitizeMetadataPayload(meta, logger, requestId) {
    var sanitized = {};

    // Identity string fields
    var identityFields = [
        'role', 'email', 'first_name', 'last_name', 'display_name', 'login_type',
        'idp_username', 'account_status', 'wallet_address', 'cognito_user_id',
        'geo_location', 'device_id'
    ];

    for (var i = 0; i < identityFields.length; i++) {
        var field = identityFields[i];
        if (meta.hasOwnProperty(field) && meta[field] !== null && meta[field] !== undefined) {
            var maxLen = MAX_STRING_LENGTHS[field] || 256;
            sanitized[field] = sanitizeString(meta[field], maxLen);
        }
    }

    // Geolocation string fields (NEW)
    var geoFields = ['country', 'country_code', 'region', 'city', 'location_timezone'];
    for (var g = 0; g < geoFields.length; g++) {
        var geoField = geoFields[g];
        if (meta.hasOwnProperty(geoField) && meta[geoField] !== null && meta[geoField] !== undefined && meta[geoField] !== "") {
            sanitized[geoField] = sanitizeString(meta[geoField], 100);
        }
    }

    // Device info string fields
    var deviceStringFields = [
        'platform', 'device_model', 'device_name', 'os_version',
        'app_version', 'unity_version', 'locale', 'timezone',
        'screen_dpi', 'graphics_device', 'processor_type'
    ];

    for (var j = 0; j < deviceStringFields.length; j++) {
        var deviceField = deviceStringFields[j];
        if (meta.hasOwnProperty(deviceField) && meta[deviceField] !== null && meta[deviceField] !== undefined) {
            var deviceMaxLen = MAX_STRING_LENGTHS[deviceField] || 256;
            sanitized[deviceField] = sanitizeString(meta[deviceField], deviceMaxLen);
        }
    }


    // Special handling for game_id (UUID validation)
    if (meta.game_id) {
        var gameIdStr = sanitizeString(meta.game_id, 36);
        if (gameIdStr && isValidUUIDFormat(gameIdStr)) {
            sanitized.game_id = gameIdStr.toLowerCase();
        } else if (gameIdStr) {
            logger.warn("[PlayerMetadata:" + requestId + "] Invalid game_id format: " + gameIdStr);
        }
    }

    // Boolean-like fields
    if (meta.is_adult !== undefined) {
        var isAdultStr = String(meta.is_adult).toLowerCase();
        sanitized.is_adult = (isAdultStr === 'true' || isAdultStr === '1' || isAdultStr === 'yes') ? "True" : "False";
    }

    // Numeric fields - latitude/longitude
    if (meta.latitude !== undefined && meta.latitude !== null) {
        var lat = Number(meta.latitude);
        if (isValidLatitude(lat)) {
            sanitized.latitude = lat;
        }
    }

    if (meta.longitude !== undefined && meta.longitude !== null) {
        var lon = Number(meta.longitude);
        if (isValidLongitude(lon)) {
            sanitized.longitude = lon;
        }
    }

    // Numeric device fields
    if (meta.screen_width !== undefined) {
        var sw = parseInt(meta.screen_width, 10);
        if (!isNaN(sw) && sw > 0 && sw < 10000) {
            sanitized.screen_width = sw;
        }
    }

    if (meta.screen_height !== undefined) {
        var sh = parseInt(meta.screen_height, 10);
        if (!isNaN(sh) && sh > 0 && sh < 10000) {
            sanitized.screen_height = sh;
        }
    }

    if (meta.system_memory_mb !== undefined) {
        var mem = parseInt(meta.system_memory_mb, 10);
        if (!isNaN(mem) && mem > 0 && mem < 1000000) {
            sanitized.system_memory_mb = mem;
        }
    }

    if (meta.processor_count !== undefined) {
        var pc = parseInt(meta.processor_count, 10);
        if (!isNaN(pc) && pc > 0 && pc < 1000) {
            sanitized.processor_count = pc;
        }
    }

    // Avatar URL (HTTP/HTTPS only, max 2048)
    if (meta.avatar_url !== undefined && meta.avatar_url !== null && meta.avatar_url !== "") {
        var avatarStr = sanitizeString(meta.avatar_url, MAX_STRING_LENGTHS.avatar_url);
        if (avatarStr && /^https?:\/\//i.test(avatarStr)) {
            sanitized.avatar_url = avatarStr;
        } else if (avatarStr) {
            logger.warn("[PlayerMetadata:" + requestId + "] avatar_url must be HTTP/HTTPS URL, ignored");
        }
    }

    // Optional numeric fields
    if (meta.age !== undefined) {
        var age = parseInt(meta.age, 10);
        if (!isNaN(age) && age >= 0 && age <= 150) {
            sanitized.age = age;
        }
    }

    return sanitized;
}


/**
 * Validate the sanitized payload
 */
function validateMetadataPayload(sanitized, logger, requestId) {
    var errors = [];
    var warnings = [];

    // Validate email format if provided
    if (sanitized.email && !isValidEmail(sanitized.email)) {
        warnings.push("Invalid email format");
    }

    // Validate account_status if provided
    if (sanitized.account_status) {
        var statusLower = sanitized.account_status.toLowerCase();
        if (VALID_ACCOUNT_STATUSES.indexOf(statusLower) === -1) {
            warnings.push("Unknown account_status: " + sanitized.account_status);
        }
    }

    // Validate login_type if provided
    if (sanitized.login_type) {
        var loginLower = sanitized.login_type.toLowerCase();
        if (VALID_LOGIN_TYPES.indexOf(loginLower) === -1) {
            warnings.push("Unknown login_type: " + sanitized.login_type);
        }
    }

    // Validate role if provided
    if (sanitized.role) {
        var roleLower = sanitized.role.toLowerCase();
        if (VALID_ROLES.indexOf(roleLower) === -1) {
            warnings.push("Unknown role: " + sanitized.role);
        }
    }

    // Validate coordinates consistency
    var hasLat = sanitized.latitude !== undefined;
    var hasLon = sanitized.longitude !== undefined;
    if (hasLat !== hasLon) {
        warnings.push("Latitude and longitude should be provided together");
    }

    // Validate screen dimensions consistency
    var hasWidth = sanitized.screen_width !== undefined;
    var hasHeight = sanitized.screen_height !== undefined;
    if (hasWidth !== hasHeight) {
        warnings.push("Screen width and height should be provided together");
    }

    return {
        errors: errors,
        warnings: warnings,
        isValid: errors.length === 0
    };
}


/**
 * Build merged metadata object
 */
function buildMergedMetadata(existing, sanitized, now, isNewUser, userId, ctx) {
    var merged = {};

    // Start with existing data (preserve all existing fields)
    if (existing && typeof existing === "object") {
        for (var prop in existing) {
            if (Object.prototype.hasOwnProperty.call(existing, prop)) {
                merged[prop] = existing[prop];
            }
        }
    }

    // Override with sanitized new values (only non-null/empty values)
    for (var prop2 in sanitized) {
        if (Object.prototype.hasOwnProperty.call(sanitized, prop2)) {
            var value = sanitized[prop2];
            if (value !== null && value !== undefined && value !== "") {
                merged[prop2] = value;
            }
        }
    }

    // System fields (always update)
    merged.user_id = userId;
    merged.updated_at = now;

    // First-time fields
    if (isNewUser) {
        merged.created_at = now;
        merged.first_seen_at = now;
    }

    // Track Nakama username if available
    if (ctx.username) {
        merged.nakama_username = ctx.username;
    }

    return merged;
}


/**
 * Update game history
 */
function updateGameHistory(merged, gameId, now) {
    // Initialize games array if not exists
    if (!merged.games || !Array.isArray(merged.games)) {
        merged.games = [];
    }

    // Find existing game entry
    var gameIndex = -1;
    for (var i = 0; i < merged.games.length; i++) {
        if (merged.games[i].game_id === gameId) {
            gameIndex = i;
            break;
        }
    }

    if (gameIndex >= 0) {
        // Update existing game entry
        merged.games[gameIndex].last_played = now;
        merged.games[gameIndex].play_count = (merged.games[gameIndex].play_count || 0) + 1;
        merged.games[gameIndex].session_count = (merged.games[gameIndex].session_count || 0) + 1;
    } else {
        // Add new game entry
        merged.games.push({
            game_id: gameId,
            first_played: now,
            last_played: now,
            play_count: 1,
            session_count: 1,
            total_playtime_seconds: 0
        });
    }

    // Update summary fields
    merged.total_games = merged.games.length;
    merged.current_game_id = gameId;
    merged.last_game_played_at = now;

    // Calculate total sessions across all games
    var totalSessions = 0;
    for (var j = 0; j < merged.games.length; j++) {
        totalSessions += merged.games[j].session_count || 0;
    }
    merged.total_sessions = totalSessions;

    return merged;
}
/**
 * Update geolocation data
 */
function updateGeolocation(merged, sanitized, now) {

    // -------------------------------------------------------------------------
    // Step 1: Handle Coordinates (latitude/longitude)
    // -------------------------------------------------------------------------
    var hasNewCoords = sanitized.latitude !== undefined &&
        sanitized.longitude !== undefined &&
        sanitized.latitude !== null &&
        sanitized.longitude !== null;

    if (hasNewCoords) {
        // Validate coordinates are within valid range
        var lat = Number(sanitized.latitude);
        var lon = Number(sanitized.longitude);

        if (!isNaN(lat) && !isNaN(lon) &&
            lat >= -90 && lat <= 90 &&
            lon >= -180 && lon <= 180) {

            merged.latitude = lat;
            merged.longitude = lon;
            merged.location_updated_at = now;

            // Determine location source
            if (sanitized.location_source) {
                merged.location_source = sanitized.location_source;
            } else if (Math.abs(lat) > 0.001 && Math.abs(lon) > 0.001) {
                // If coordinates are precise, likely from GPS; otherwise IP
                merged.location_source = "client";
            }
            else {
                merged.location_source = "unknown";
            }

            // -------------------------------------------------------------------------
            // Step 2: Maintain Location History (last 10 unique locations)
            // -------------------------------------------------------------------------
            if (!merged.location_history || !Array.isArray(merged.location_history)) {
                merged.location_history = [];
            }

            // Check if we should add this location to history
            var shouldAddToHistory = true;
            var minDistanceKm = 0.1; // 100 meters minimum distance

            if (merged.location_history.length > 0) {
                var lastLoc = merged.location_history[merged.location_history.length - 1];

                if (lastLoc && lastLoc.latitude !== undefined && lastLoc.longitude !== undefined) {
                    var distance = calculateDistance(
                        lastLoc.latitude,
                        lastLoc.longitude,
                        lat,
                        lon
                    );

                    // Don't add if within 100 meters of last location
                    if (distance < minDistanceKm) {
                        shouldAddToHistory = false;

                        // But update the timestamp of the last location
                        lastLoc.last_seen = now;
                        lastLoc.visit_count = (lastLoc.visit_count || 1) + 1;
                    }
                }
            }

            if (shouldAddToHistory) {
                var locationEntry = {
                    latitude: lat,
                    longitude: lon,
                    timestamp: now,
                    first_seen: now,
                    last_seen: now,
                    visit_count: 1
                };

                // Add country/city if available
                if (sanitized.country_code) {
                    locationEntry.country_code = sanitized.country_code.toUpperCase();
                }
                if (sanitized.city) {
                    locationEntry.city = sanitized.city;
                }
                if (sanitized.region) {
                    locationEntry.region = sanitized.region;
                }

                merged.location_history.push(locationEntry);

                // Keep only last 10 locations
                if (merged.location_history.length > 10) {
                    merged.location_history = merged.location_history.slice(-10);
                }
            }

            // Update total unique locations count
            merged.total_unique_locations = merged.location_history.length;
        }
    }

    // -------------------------------------------------------------------------
    // Step 3: Handle Country Information
    // -------------------------------------------------------------------------
    if (sanitized.country && sanitized.country !== "") {
        merged.country = sanitized.country.trim();
    }

    if (sanitized.country_code && sanitized.country_code !== "") {
        var countryCode = sanitized.country_code.trim().toUpperCase();

        // Validate country code format (2-3 characters)
        if (countryCode.length >= 2 && countryCode.length <= 3) {
            merged.country_code = countryCode;
            merged.geo_location = countryCode; // Also set geo_location for compatibility
        }
    }

    // Fallback: if geo_location provided but not country_code
    if (sanitized.geo_location && sanitized.geo_location !== "" && !merged.country_code) {
        var geoLoc = sanitized.geo_location.trim().toUpperCase();
        if (geoLoc.length >= 2 && geoLoc.length <= 3) {
            merged.geo_location = geoLoc;
            merged.country_code = geoLoc;
        }
    }

    // -------------------------------------------------------------------------
    // Step 4: Handle Region/State Information
    // -------------------------------------------------------------------------
    if (sanitized.region && sanitized.region !== "") {
        merged.region = sanitized.region.trim();

        // Also store as state for compatibility
        merged.state = merged.region;
    }

    if (sanitized.regionName && sanitized.regionName !== "") {
        merged.region = sanitized.regionName.trim();
        merged.state = merged.region;
    }

    // -------------------------------------------------------------------------
    // Step 5: Handle City Information
    // -------------------------------------------------------------------------
    if (sanitized.city && sanitized.city !== "") {
        merged.city = sanitized.city.trim();
    }

    // -------------------------------------------------------------------------
    // Step 6: Handle Timezone Information
    // -------------------------------------------------------------------------
    if (sanitized.timezone && sanitized.timezone !== "") {
        merged.timezone = sanitized.timezone.trim();
    }

    if (sanitized.location_timezone && sanitized.location_timezone !== "") {
        merged.location_timezone = sanitized.location_timezone.trim();

        // Use location_timezone as primary if timezone not set
        if (!merged.timezone) {
            merged.timezone = merged.location_timezone;
        }
    }

    // -------------------------------------------------------------------------
    // Step 7: Build Formatted Location String
    // -------------------------------------------------------------------------
    var locationParts = [];
    if (merged.city) locationParts.push(merged.city);
    if (merged.region) locationParts.push(merged.region);
    if (merged.country) locationParts.push(merged.country);

    if (locationParts.length > 0) {
        merged.formatted_location = locationParts.join(", ");
    }

    // Short format: "City, Country Code"
    if (merged.city && merged.country_code) {
        merged.location_short = merged.city + ", " + merged.country_code;
    } else if (merged.country_code) {
        merged.location_short = merged.country_code;
    }

    // -------------------------------------------------------------------------
    // Step 8: Calculate Location Statistics
    // -------------------------------------------------------------------------
    if (merged.location_history && merged.location_history.length > 0) {
        // Find most visited location
        var mostVisited = merged.location_history.reduce(function (max, loc) {
            return (loc.visit_count || 1) > (max.visit_count || 1) ? loc : max;
        }, merged.location_history[0]);

        if (mostVisited) {
            merged.most_visited_location = {
                latitude: mostVisited.latitude,
                longitude: mostVisited.longitude,
                city: mostVisited.city || merged.city,
                country_code: mostVisited.country_code || merged.country_code,
                visit_count: mostVisited.visit_count || 1
            };
        }

        // Count unique countries
        var uniqueCountries = {};
        for (var i = 0; i < merged.location_history.length; i++) {
            var loc = merged.location_history[i];
            if (loc.country_code) {
                uniqueCountries[loc.country_code] = true;
            }
        }
        merged.unique_countries_visited = Object.keys(uniqueCountries).length;

        // Count unique cities
        var uniqueCities = {};
        for (var j = 0; j < merged.location_history.length; j++) {
            var loc2 = merged.location_history[j];
            if (loc2.city) {
                uniqueCities[loc2.city] = true;
            }
        }
        merged.unique_cities_visited = Object.keys(uniqueCities).length;
    }

    // -------------------------------------------------------------------------
    // Step 9: Set Location Availability Flag
    // -------------------------------------------------------------------------
    merged.has_location_data = ! !(
        merged.latitude !== undefined &&
        merged.longitude !== undefined &&
        merged.latitude !== null &&
        merged.longitude !== null
    );

    merged.has_resolved_location = !!(
        merged.country_code &&
        merged.country_code !== ""
    );

    return merged;
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 * Returns distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    // Validate inputs
    if (lat1 === undefined || lon1 === undefined ||
        lat2 === undefined || lon2 === undefined) {
        return 999999; // Return large distance if invalid
    }

    lat1 = Number(lat1);
    lon1 = Number(lon1);
    lat2 = Number(lat2);
    lon2 = Number(lon2);

    if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
        return 999999;
    }

    var R = 6371; // Earth's radius in kilometers
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;

    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var distance = R * c;

    return distance;
}

/**
 * Resolve location from latitude/longitude using Google Maps Reverse Geocoding API
 * Returns resolved location data or null if resolution fails
 *
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {object} ctx - Request context (for env vars)
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {object|null} Location data { country, country_code, region, city } or null
 */
function resolveLocationFromCoordinates(nk, logger, ctx, latitude, longitude) {
    try {
        // Get API key from environment
        var apiKey = ctx.env ? ctx.env["GOOGLE_MAPS_API_KEY"] : null;

        if (!apiKey) {
            logger.warn("[LocationResolver] GOOGLE_MAPS_API_KEY not configured, skipping location resolution");
            return null;
        }

        // Validate coordinates
        var lat = Number(latitude);
        var lon = Number(longitude);

        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            logger.warn("[LocationResolver] Invalid coordinates: " + latitude + ", " + longitude);
            return null;
        }

        // Call Google Maps Reverse Geocoding API
        var geocodeUrl = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' +
            lat + ',' + lon + '&key=' + apiKey;

        var geocodeResponse;
        try {
            geocodeResponse = nk.httpRequest(
                geocodeUrl,
                'get',
                { 'Accept': 'application/json' }
            );
        } catch (httpErr) {
            logger.error("[LocationResolver] HTTP request failed: " + httpErr.message);
            return null;
        }

        if (geocodeResponse.code !== 200) {
            logger.warn("[LocationResolver] API returned status " + geocodeResponse.code);
            return null;
        }

        // Parse response
        var geocodeData;
        try {
            geocodeData = JSON.parse(geocodeResponse.body);
        } catch (parseErr) {
            logger.error("[LocationResolver] Failed to parse response: " + parseErr.message);
            return null;
        }

        if (geocodeData.status !== 'OK' || !geocodeData.results || geocodeData.results.length === 0) {
            logger.warn("[LocationResolver] No results from API: " + geocodeData.status);
            return null;
        }

        // Extract location components
        var result = {
            country: null,
            country_code: null,
            region: null,
            city: null
        };

        var addressComponents = geocodeData.results[0].address_components;

        for (var i = 0; i < addressComponents.length; i++) {
            var component = addressComponents[i];
            var types = component.types;

            // Country
            if (types.indexOf('country') !== -1) {
                result.country = component.long_name;
                result.country_code = component.short_name;
            }

            // Region/State
            if (types.indexOf('administrative_area_level_1') !== -1) {
                result.region = component.long_name;
            }

            // City - try multiple types
            if (types.indexOf('locality') !== -1) {
                result.city = component.long_name;
            } else if (!result.city && types.indexOf('administrative_area_level_2') !== -1) {
                result.city = component.long_name;
            } else if (!result.city && types.indexOf('sublocality') !== -1) {
                result.city = component.long_name;
            }
        }

        logger.info("[LocationResolver] Resolved: " +
            (result.city || "N/A") + ", " +
            (result.region || "N/A") + ", " +
            (result.country || "N/A") + " (" + (result.country_code || "N/A") + ")");

        return result;

    } catch (err) {
        logger.error("[LocationResolver] Error resolving location: " + err.message);
        return null;
    }
}

/**
 * Update device information - tracks all devices used
 */
function updateDeviceInfo(merged, sanitized, now) {
    // Initialize devices array if tracking multiple devices
    if (!merged.devices || !Array.isArray(merged.devices)) {
        merged.devices = [];
    }

    if (sanitized.device_id) {
        // Find existing device
        var deviceIndex = -1;
        for (var i = 0; i < merged.devices.length; i++) {
            if (merged.devices[i].device_id === sanitized.device_id) {
                deviceIndex = i;
                break;
            }
        }

        // Build device info object
        var deviceInfo = {
            device_id: sanitized.device_id,
            last_seen: now,
            platform: sanitized.platform || merged.platform || null,
            device_model: sanitized.device_model || merged.device_model || null,
            device_name: sanitized.device_name || merged.device_name || null,
            os_version: sanitized.os_version || merged.os_version || null,
            app_version: sanitized.app_version || merged.app_version || null,
            unity_version: sanitized.unity_version || merged.unity_version || null,
            locale: sanitized.locale || merged.locale || null,
            timezone: sanitized.timezone || merged.timezone || null,
            screen_width: sanitized.screen_width || null,
            screen_height: sanitized.screen_height || null,
            screen_dpi: sanitized.screen_dpi || null,
            graphics_device: sanitized.graphics_device || null,
            system_memory_mb: sanitized.system_memory_mb || null,
            processor_type: sanitized.processor_type || null,
            processor_count: sanitized.processor_count || null
        };

        // Clean null values from device info
        for (var key in deviceInfo) {
            if (deviceInfo[key] === null) {
                delete deviceInfo[key];
            }
        }

        if (deviceIndex >= 0) {
            // Update existing device
            var existingDevice = merged.devices[deviceIndex];
            deviceInfo.first_seen = existingDevice.first_seen || now;
            deviceInfo.session_count = (existingDevice.session_count || 0) + 1;
            merged.devices[deviceIndex] = deviceInfo;
        } else {
            // Add new device
            deviceInfo.first_seen = now;
            deviceInfo.session_count = 1;
            merged.devices.push(deviceInfo);
        }

        // Update current device fields at top level
        merged.current_device_id = sanitized.device_id;
        merged.device_id = sanitized.device_id;
        merged.total_devices = merged.devices.length;

        // Keep only last 10 devices (sorted by last_seen)
        if (merged.devices.length > 10) {
            merged.devices.sort(function (a, b) {
                return new Date(b.last_seen) - new Date(a.last_seen);
            });
            merged.devices = merged.devices.slice(0, 10);
        }
    }

    // Update top-level device fields (for quick access)
    if (sanitized.platform) merged.platform = sanitized.platform;
    if (sanitized.device_model) merged.device_model = sanitized.device_model;
    if (sanitized.device_name) merged.device_name = sanitized.device_name;
    if (sanitized.os_version) merged.os_version = sanitized.os_version;
    if (sanitized.app_version) merged.app_version = sanitized.app_version;
    if (sanitized.unity_version) merged.unity_version = sanitized.unity_version;
    if (sanitized.locale) merged.locale = sanitized.locale;
    if (sanitized.timezone) merged.timezone = sanitized.timezone;
    if (sanitized.screen_width) merged.screen_width = sanitized.screen_width;
    if (sanitized.screen_height) merged.screen_height = sanitized.screen_height;
    if (sanitized.screen_dpi) merged.screen_dpi = sanitized.screen_dpi;
    if (sanitized.graphics_device) merged.graphics_device = sanitized.graphics_device;
    if (sanitized.system_memory_mb) merged.system_memory_mb = sanitized.system_memory_mb;
    if (sanitized.processor_type) merged.processor_type = sanitized.processor_type;
    if (sanitized.processor_count) merged.processor_count = sanitized.processor_count;

    // Calculate screen resolution string
    if (merged.screen_width && merged.screen_height) {
        merged.screen_resolution = merged.screen_width + "x" + merged.screen_height;
    }

    return merged;
}

/**
 * Update session analytics
 */
function updateSessionAnalytics(merged, now, isNewUser) {
    // Initialize analytics object
    if (!merged.analytics) {
        merged.analytics = {
            first_session: now,
            total_sessions: 0,
            last_session: null,
            days_since_first_session: 0,
            average_sessions_per_day: 0,
            days_active: 0,
            current_streak: 0,
            longest_streak: 0,
            last_active_date: null
        };
    }

    // Update session count
    merged.analytics.total_sessions = (merged.analytics.total_sessions || 0) + 1;
    merged.analytics.last_session = now;

    // Calculate days since first session
    if (merged.analytics.first_session) {
        var firstDate = new Date(merged.analytics.first_session);
        var nowDate = new Date(now);
        var diffTime = Math.abs(nowDate - firstDate);
        var diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        merged.analytics.days_since_first_session = diffDays;

        // Calculate average sessions per day
        if (diffDays > 0) {
            merged.analytics.average_sessions_per_day =
                Math.round((merged.analytics.total_sessions / diffDays) * 100) / 100;
        } else {
            merged.analytics.average_sessions_per_day = merged.analytics.total_sessions;
        }
    }

    // Daily active tracking and streak calculation
    var today = now.split('T')[0]; // YYYY-MM-DD format
    var previousActiveDate = merged.analytics.last_active_date;

    if (previousActiveDate !== today) {
        // New day - update days active
        merged.analytics.days_active = (merged.analytics.days_active || 0) + 1;

        // Streak calculation
        if (previousActiveDate) {
            var prevDate = new Date(previousActiveDate);
            var currentDate = new Date(today);
            var daysDiff = Math.floor((currentDate - prevDate) / (1000 * 60 * 60 * 24));

            if (daysDiff === 1) {
                // Consecutive day - increase streak
                merged.analytics.current_streak = (merged.analytics.current_streak || 0) + 1;
            } else if (daysDiff > 1) {
                // Streak broken - reset to 1
                merged.analytics.current_streak = 1;
            }
            // daysDiff === 0 means same day, don't change streak
        } else {
            // First time tracking - start streak at 1
            merged.analytics.current_streak = 1;
        }

        // Update longest streak
        if ((merged.analytics.current_streak || 0) > (merged.analytics.longest_streak || 0)) {
            merged.analytics.longest_streak = merged.analytics.current_streak;
        }

        merged.analytics.last_active_date = today;
    }

    // For new users, ensure first session is set
    if (isNewUser) {
        merged.analytics.first_session = now;
        merged.analytics.current_streak = 1;
        merged.analytics.longest_streak = 1;
        merged.analytics.days_active = 1;
        merged.analytics.last_active_date = today;
    }

    return merged;
}

/**
 * Sync profile fields to Nakama native account (display_name, avatar_url, timezone, location, langTag).
 * FIXED: Proper timezone validation, display name building, and account metadata
 * Does NOT update username - use rpc_change_username for that.
 * Idempotent: only passes non-null values; accountUpdateId leaves unchanged fields as-is.
 */
function syncMetadataToNakamaAccount(nk, logger, userId, merged, sanitized, requestId) {
    try {
        // Build display name from various sources
        var displayName = null;

        // Priority 1: Explicit display_name
        if (merged.display_name && typeof merged.display_name === 'string' && merged.display_name.trim() !== "") {
            displayName = merged.display_name.trim();
        }
        // Priority 2: first_name + last_name (handle empty strings)
        if (!displayName) {
            var nameParts = [];
            if (merged.first_name && typeof merged.first_name === 'string' && merged.first_name.trim() !== "") {
                nameParts.push(merged.first_name.trim());
            }
            if (merged.last_name && typeof merged.last_name === 'string' && merged.last_name.trim() !== "") {
                nameParts.push(merged.last_name.trim());
            }
            if (nameParts.length > 0) {
                displayName = nameParts.join(" ");
            }
        }
        // Priority 3: nakama_username fallback
        if (!displayName && merged.nakama_username && merged.nakama_username.trim() !== "") {
            displayName = merged.nakama_username.trim();
        }

        // Validate and normalize timezone - MUST be IANA format (contains /)
        var timezone = null;
        var rawTimezone = merged.timezone || merged.location_timezone || null;
        if (rawTimezone && rawTimezone !== "Local" && rawTimezone !== "local" && rawTimezone.indexOf("/") !== -1) {
            timezone = rawTimezone;
        }

        // Build location string from geolocation data
        var location = merged.formatted_location || null;
        if (!location && (merged.city || merged.region || merged.country)) {
            var parts = [];
            if (merged.city) parts.push(merged.city);
            if (merged.region) parts.push(merged.region);
            if (merged.country) parts.push(merged.country);
            if (parts.length > 0) {
                location = parts.join(", ");
            }
        }

        // Extract language tag from locale (e.g., "en-AU" -> "en")
        var langTag = null;
        if (merged.locale && typeof merged.locale === 'string') {
            langTag = merged.locale.split("-")[0].toLowerCase();
        }

        // Avatar URL validation â€” ONLY update when client explicitly sent avatar_url
        // in the current request. This prevents overwriting user-picked avatars with
        // auto-assigned defaults from the merge process on every login sync.
        var avatarURL = null;
        if (sanitized) {
            var rawAvatar = sanitized.avatar_url || sanitized.avatarUrl || null;
            if (rawAvatar && /^https?:\/\//i.test(rawAvatar)) {
                avatarURL = rawAvatar;
            }
        }

        // Build account metadata (visible in Nakama Console Account tab)
        var accountMetadata = {};
        if (merged.email) accountMetadata.email = merged.email;
        if (merged.wallet_address || merged.walletAddress) {
            accountMetadata.wallet_address = merged.wallet_address || merged.walletAddress;
        }
        if (merged.cognito_user_id || merged.cognitoUserId) {
            accountMetadata.cognito_user_id = merged.cognito_user_id || merged.cognitoUserId;
        }
        if (merged.first_name) accountMetadata.first_name = merged.first_name;
        if (merged.last_name) accountMetadata.last_name = merged.last_name;
        if (merged.role) accountMetadata.role = merged.role;
        if (merged.account_status) accountMetadata.account_status = merged.account_status;
        if (merged.login_type) accountMetadata.login_type = merged.login_type;
        accountMetadata.last_synced = new Date().toISOString();

        // Skip if nothing to update
        var hasMetadata = Object.keys(accountMetadata).length > 1; // > 1 because last_synced always exists
        if (!displayName && !timezone && !location && !langTag && !avatarURL && !hasMetadata) {
            logger.debug("[PlayerMetadata:" + requestId + "] No account fields to sync");
            return;
        }

        // Log what we're syncing
        logger.info("[PlayerMetadata:" + requestId + "] Syncing to account: displayName=" +
            (displayName || "(none)") + ", timezone=" + (timezone || "(none)") +
            ", location=" + (location || "(none)") + ", langTag=" + (langTag || "(none)") +
            ", hasMetadata=" + hasMetadata);

        // Update native Nakama account
        // Signature: accountUpdateId(userId, username, displayName, timezone, location, langTag, avatarUrl, metadata)
        nk.accountUpdateId(
            userId,
            null,                                                           // username - don't change
            displayName || null,                                            // display_name
            timezone,                                                       // timezone (IANA only)
            location,                                                       // location
            langTag,                                                        // language tag
            avatarURL,                                                      // avatar URL
            hasMetadata ? accountMetadata : null                            // account metadata object
        );

        logger.info("[PlayerMetadata:" + requestId + "] âœ“ Synced to Nakama account successfully");
    } catch (err) {
        logger.warn("[PlayerMetadata:" + requestId + "] Account sync failed (metadata saved): " + (err.message || String(err)));
    }
}

/**
 * Cleanup legacy metadata documents (non-blocking)
 */
function cleanupLegacyMetadataAsync(nk, logger, userId, requestId) {
    for (var i = 0; i < LEGACY_STORAGE_LOCATIONS.length; i++) {
        var loc = LEGACY_STORAGE_LOCATIONS[i];
        try {
            nk.storageDelete([{
                collection: loc.collection,
                key: loc.key,
                userId: userId
            }]);
            logger.debug("[PlayerMetadata:" + requestId + "] Cleaned: " + loc.collection + "/" + loc.key);
        } catch (err) {
            // Ignore - document may not exist
        }
    }

    // Also clean up identity documents from quizverse collection
    try {
        nk.storageDelete([{
            collection: "quizverse",
            key: "identity:" + userId,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
    } catch (err) {
        // Ignore
    }
}

// ============================================================================
// ADDITIONAL HELPER RPC: Get Player Metadata
// ============================================================================

/**
 * RPC: get_player_metadata
 * Retrieves the unified player metadata for the authenticated user
 */
function rpcUpdatePlayerMetadataUnified(ctx, logger, nk, payload) {
    var startTime = Date.now();
    var requestId = generateShortUUID();

    logger.info("[PlayerMetadata:" + requestId + "] RPC called");

    // -------------------------------------------------------------------------
    // Step 1: Authentication Check
    // -------------------------------------------------------------------------
    if (!ctx.userId) {
        logger.error("[PlayerMetadata:" + requestId + "] User not authenticated");
        return buildErrorResponse("User not authenticated", "AUTH_REQUIRED", requestId);
    }

    var userId = ctx.userId;

    // -------------------------------------------------------------------------
    // Step 2: Parse and Validate Payload
    // -------------------------------------------------------------------------
    var meta;
    try {
        meta = JSON.parse(payload || "{}");
    } catch (err) {
        logger.error("[PlayerMetadata:" + requestId + "] Invalid JSON: " + err.message);
        return buildErrorResponse("Invalid JSON payload", "INVALID_JSON", requestId);
    }

    // Validate payload is an object
    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
        logger.error("[PlayerMetadata:" + requestId + "] Payload must be an object");
        return buildErrorResponse("Payload must be a JSON object", "INVALID_PAYLOAD", requestId);
    }

    // -------------------------------------------------------------------------
    // Step 3: Read Existing Metadata
    // -------------------------------------------------------------------------
    var existing = null;
    var existingVersion = null;
    var isNewUser = false;

    try {
        var records = nk.storageRead([{
            collection: PLAYER_METADATA_COLLECTION,
            key: PLAYER_METADATA_KEY,
            userId: userId
        }]);

        if (records && records.length > 0 && records[0].value) {
            existing = records[0].value;
            existingVersion = records[0].version;
            logger.debug("[PlayerMetadata:" + requestId + "] Found existing metadata (version: " + existingVersion + ")");

            // Rate limiting check (log only, don't reject)
            if (existing.updated_at) {
                var lastUpdate = new Date(existing.updated_at).getTime();
                var now = Date.now();
                var secondsSinceUpdate = (now - lastUpdate) / 1000;

                if (secondsSinceUpdate < MIN_UPDATE_INTERVAL_SECONDS) {
                    logger.warn("[PlayerMetadata:" + requestId + "] Rapid update detected.  Last: " +
                        secondsSinceUpdate.toFixed(1) + "s ago");
                }
            }
        } else {
            isNewUser = true;
            logger.info("[PlayerMetadata:" + requestId + "] New user, creating metadata");
        }
    } catch (err) {
        logger.warn("[PlayerMetadata:" + requestId + "] Error reading existing: " + err.message);
        isNewUser = true;
    }

    // -------------------------------------------------------------------------
    // Step 4: Sanitize and Validate Input Fields
    // -------------------------------------------------------------------------
    var sanitized = sanitizeMetadataPayload(meta, logger, requestId);
    var validationResult = validateMetadataPayload(sanitized, logger, requestId);

    if (validationResult.warnings.length > 0) {
        logger.warn("[PlayerMetadata:" + requestId + "] Validation warnings: " +
            validationResult.warnings.join("; "));
    }

    if (validationResult.errors.length > 0) {
        logger.error("[PlayerMetadata:" + requestId + "] Validation errors: " +
            validationResult.errors.join("; "));
    }

    // -------------------------------------------------------------------------
    // Step 5: Build Merged Metadata Object
    // -------------------------------------------------------------------------
    var now = new Date().toISOString();
    var merged = buildMergedMetadata(existing, sanitized, now, isNewUser, userId, ctx);

    // -------------------------------------------------------------------------
    // Step 6: Handle Game Tracking
    // -------------------------------------------------------------------------
    if (sanitized.game_id && isValidUUIDFormat(sanitized.game_id)) {
        merged = updateGameHistory(merged, sanitized.game_id, now);
        logger.debug("[PlayerMetadata:" + requestId + "] Updated game history for: " + sanitized.game_id);
    }

    // -------------------------------------------------------------------------
    // Step 7: Handle Geolocation
    // -------------------------------------------------------------------------
    merged = updateGeolocation(merged, sanitized, now);

    if (sanitized.latitude !== undefined && sanitized.longitude !== undefined) {
        logger.debug("[PlayerMetadata:" + requestId + "] Updated geolocation: " +
            sanitized.latitude.toFixed(4) + ", " + sanitized.longitude.toFixed(4));
    }

    // -------------------------------------------------------------------------
    // Step 7b: Auto-resolve location if coordinates provided but city/country missing
    // -------------------------------------------------------------------------
    if (merged.has_location_data && !merged.has_resolved_location) {
        // We have lat/long but no city/country - try to resolve automatically
        logger.info("[PlayerMetadata:" + requestId + "] Attempting auto-resolution for coordinates: " +
            merged.latitude + ", " + merged.longitude);

        var resolved = resolveLocationFromCoordinates(nk, logger, ctx, merged.latitude, merged.longitude);

        if (resolved) {
            // Update merged metadata with resolved location
            if (resolved.country) {
                merged.country = resolved.country;
            }
            if (resolved.country_code) {
                merged.country_code = resolved.country_code;
                merged.geo_location = resolved.country_code;
            }
            if (resolved.region) {
                merged.region = resolved.region;
                merged.state = resolved.region;
            }
            if (resolved.city) {
                merged.city = resolved.city;
            }

            // Update location history entry with resolved data
            if (merged.location_history && merged.location_history.length > 0) {
                var lastEntry = merged.location_history[merged.location_history.length - 1];
                if (resolved.country_code) lastEntry.country_code = resolved.country_code;
                if (resolved.city) lastEntry.city = resolved.city;
                if (resolved.region) lastEntry.region = resolved.region;
            }

            // Update most_visited_location if exists
            if (merged.most_visited_location) {
                if (resolved.city) merged.most_visited_location.city = resolved.city;
                if (resolved.country_code) merged.most_visited_location.country_code = resolved.country_code;
            }

            // Build formatted location strings
            var locationParts = [];
            if (merged.city) locationParts.push(merged.city);
            if (merged.region) locationParts.push(merged.region);
            if (merged.country) locationParts.push(merged.country);

            if (locationParts.length > 0) {
                merged.formatted_location = locationParts.join(", ");
            }

            if (merged.city && merged.country_code) {
                merged.location_short = merged.city + ", " + merged.country_code;
            } else if (merged.country_code) {
                merged.location_short = merged.country_code;
            }

            // Update flags
            merged.has_resolved_location = true;
            merged.location_resolved_at = now;
            merged.unique_countries_visited = merged.unique_countries_visited || 1;
            merged.unique_cities_visited = merged.unique_cities_visited || (merged.city ? 1 : 0);

            logger.info("[PlayerMetadata:" + requestId + "] âœ“ Location auto-resolved: " +
                (merged.city || "N/A") + ", " + (merged.region || "N/A") + ", " +
                (merged.country_code || "N/A"));
        } else {
            logger.warn("[PlayerMetadata:" + requestId + "] Could not auto-resolve location from coordinates");
        }
    }

    // -------------------------------------------------------------------------
    // Step 8: Handle Device Information
    // -------------------------------------------------------------------------
    merged = updateDeviceInfo(merged, sanitized, now);

    if (sanitized.device_id) {
        logger.debug("[PlayerMetadata:" + requestId + "] Updated device info: " +
            (sanitized.platform || "unknown") + " | " +
            (sanitized.device_model || "unknown"));
    }

    // -------------------------------------------------------------------------
    // Step 9: Handle Session Analytics
    // -------------------------------------------------------------------------
    merged = updateSessionAnalytics(merged, now, isNewUser);

    // -------------------------------------------------------------------------
    // Step 10: Sync to Nakama Account FIRST (display_name, timezone, location)
    // This ensures Account tab is updated even if storage write fails later
    // -------------------------------------------------------------------------
    syncMetadataToNakamaAccount(nk, logger, userId, merged, sanitized, requestId);

    // -------------------------------------------------------------------------
    // Step 11: Write to Storage with optimistic concurrency + retry
    // -------------------------------------------------------------------------
    var storageWriteSuccess = true;
    var WRITE_MAX_RETRIES = 3;

    for (var writeAttempt = 0; writeAttempt <= WRITE_MAX_RETRIES; writeAttempt++) {
        try {
            nk.storageWrite([{
                collection: PLAYER_METADATA_COLLECTION,
                key: PLAYER_METADATA_KEY,
                userId: userId,
                value: merged,
                permissionRead: PERMISSION_READ_OWNER,
                permissionWrite: PERMISSION_WRITE_NONE,
                version: existingVersion || "*"
            }]);

            logger.info("[PlayerMetadata:" + requestId + "] Metadata saved successfully" +
                (writeAttempt > 0 ? " (after " + writeAttempt + " retries)" : ""));
            break;
        } catch (err) {
            if (writeAttempt < WRITE_MAX_RETRIES) {
                logger.warn("[PlayerMetadata:" + requestId + "] Storage version conflict (attempt " +
                    (writeAttempt + 1) + "/" + WRITE_MAX_RETRIES + "), re-reading and retrying");
                try {
                    var freshRecords = nk.storageRead([{
                        collection: PLAYER_METADATA_COLLECTION,
                        key: PLAYER_METADATA_KEY,
                        userId: userId
                    }]);
                    if (freshRecords && freshRecords.length > 0 && freshRecords[0].value) {
                        existingVersion = freshRecords[0].version;
                        var freshData = freshRecords[0].value;
                        merged = buildMergedMetadata(freshData, sanitized, now, false, userId, ctx);
                        if (sanitized.game_id && isValidUUIDFormat(sanitized.game_id)) {
                            merged = updateGameHistory(merged, sanitized.game_id, now);
                        }
                        merged = updateGeolocation(merged, sanitized, now);
                        merged = updateDeviceInfo(merged, sanitized, now);
                        merged = updateSessionAnalytics(merged, now, false);
                    }
                } catch (readErr) {
                    logger.error("[PlayerMetadata:" + requestId + "] Re-read failed during retry: " + readErr.message);
                }
            } else {
                logger.error("[PlayerMetadata:" + requestId + "] Storage write failed after " +
                    WRITE_MAX_RETRIES + " retries (Account already synced): " + err.message);
                storageWriteSuccess = false;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Step 12: Cleanup Legacy Data (non-blocking)
    // -------------------------------------------------------------------------
    cleanupLegacyMetadataAsync(nk, logger, userId, requestId);

    // -------------------------------------------------------------------------
    // Step 13: Build Success Response
    // -------------------------------------------------------------------------
    var executionTime = Date.now() - startTime;

    logger.info("[PlayerMetadata:" + requestId + "] Completed in " + executionTime + "ms" +
        " | Games: " + (merged.total_games || 0) +
        " | Devices: " + (merged.total_devices || 0) +
        " | Sessions: " + (merged.analytics ? merged.analytics.total_sessions : 0) +
        " | Streak: " + (merged.analytics ? merged.analytics.current_streak : 0) +
        " | New: " + isNewUser +
        " | StorageOK: " + storageWriteSuccess);

    return JSON.stringify({
        success: true,
        metadata: merged,
        is_new_user: isNewUser,
        execution_time_ms: executionTime,
        request_id: requestId,
        storage_write_success: storageWriteSuccess,
        storage: {
            collection: PLAYER_METADATA_COLLECTION,
            key: PLAYER_METADATA_KEY,
            permission_read: "OWNER_READ",
            permission_write: "NO_WRITE"
        }
    });
}

// ============================================================================
// RPC: rpc_change_username (Dedicated username change - atomic, validated)
// ============================================================================

var USERNAME_MIN_LEN = 3;
var USERNAME_MAX_LEN = 20;
var USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
var RESERVED_USERNAMES = ["admin", "system", "nakama", "root", "moderator", "support", "null", "undefined", "guest", "anonymous", "intelliversex", "intelliverse"];

/**
 * RPC: rpc_change_username
 * Atomic username change with uniqueness check and validation.
 * Syncs to Nakama account + metadata.
 */
function rpcChangeUsername(ctx, logger, nk, payload) {
    var requestId = generateShortUUID();
    logger.info("[ChangeUsername:" + requestId + "] RPC called");

    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated", error_code: "AUTH_REQUIRED", request_id: requestId });
    }

    var data;
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload", error_code: "INVALID_JSON", request_id: requestId });
    }

    var raw = (data.new_username || data.newUsername || "").trim();
    if (!raw) {
        return JSON.stringify({ success: false, error: "Username is required", error_code: "USERNAME_INVALID", request_id: requestId });
    }

    if (raw.length < USERNAME_MIN_LEN) {
        return JSON.stringify({ success: false, error: "Username must be at least " + USERNAME_MIN_LEN + " characters", error_code: "USERNAME_TOO_SHORT", request_id: requestId });
    }
    if (raw.length > USERNAME_MAX_LEN) {
        return JSON.stringify({ success: false, error: "Username must be at most " + USERNAME_MAX_LEN + " characters", error_code: "USERNAME_TOO_LONG", request_id: requestId });
    }
    if (!USERNAME_REGEX.test(raw)) {
        return JSON.stringify({ success: false, error: "Username can only contain letters, numbers, and underscores", error_code: "USERNAME_INVALID", request_id: requestId });
    }

    var normalized = raw.toLowerCase();
    if (RESERVED_USERNAMES.indexOf(normalized) !== -1) {
        return JSON.stringify({ success: false, error: "Username is reserved", error_code: "USERNAME_RESERVED", request_id: requestId });
    }

    var userId = ctx.userId;

    try {
        var users = nk.usersGetUsername([normalized]);
        if (users && users.length > 0) {
            var existing = users[0];
            if (existing.id !== userId) {
                return JSON.stringify({ success: false, error: "Username is already taken", error_code: "USERNAME_TAKEN", request_id: requestId });
            }
            return JSON.stringify({ success: true, username: existing.username, message: "Username unchanged", request_id: requestId });
        }

        nk.accountUpdateId(userId, normalized, null, null, null, null, null, null);
        logger.info("[ChangeUsername:" + requestId + "] Updated username to " + normalized + " for user " + userId);

        for (var usernameWriteAttempt = 0; usernameWriteAttempt <= 3; usernameWriteAttempt++) {
            var records = nk.storageRead([{ collection: PLAYER_METADATA_COLLECTION, key: PLAYER_METADATA_KEY, userId: userId }]);
            if (records && records.length > 0 && records[0].value) {
                var meta = records[0].value;
                meta.username = normalized;
                meta.nakama_username = normalized;
                meta.updated_at = new Date().toISOString();
                try {
                    nk.storageWrite([{
                        collection: PLAYER_METADATA_COLLECTION,
                        key: PLAYER_METADATA_KEY,
                        userId: userId,
                        value: meta,
                        permissionRead: PERMISSION_READ_OWNER,
                        permissionWrite: PERMISSION_WRITE_NONE,
                        version: records[0].version
                    }]);
                    break;
                } catch (writeErr) {
                    if (usernameWriteAttempt < 3) {
                        logger.warn("[ChangeUsername:" + requestId + "] Storage version conflict, retrying (" + (usernameWriteAttempt + 1) + "/3)");
                        continue;
                    }
                    logger.error("[ChangeUsername:" + requestId + "] Storage write failed after retries: " + writeErr.message);
                }
            } else {
                break;
            }
        }

        return JSON.stringify({ success: true, username: normalized, request_id: requestId });
    } catch (err) {
        logger.error("[ChangeUsername:" + requestId + "] Update failed: " + err.message);
        var code = "UPDATE_FAILED";
        if (err.message && err.message.indexOf("username") !== -1 && err.message.toLowerCase().indexOf("unique") !== -1) {
            code = "USERNAME_TAKEN";
        }
        return JSON.stringify({ success: false, error: err.message || "Update failed", error_code: code, request_id: requestId });
    }
}

// ============================================================================
// ADDITIONAL RPC: Get Player Metadata
// ============================================================================

/**
 * RPC: get_player_metadata
 * Retrieves the unified player metadata for the authenticated user
 */
function rpcGetPlayerMetadata(ctx, logger, nk, payload) {
    var requestId = generateShortUUID();

    if (!ctx.userId) {
        return JSON.stringify({
            success: false,
            error: "User not authenticated",
            error_code: "AUTH_REQUIRED"
        });
    }

    try {
        var records = nk.storageRead([{
            collection: PLAYER_METADATA_COLLECTION,
            key: PLAYER_METADATA_KEY,
            userId: ctx.userId
        }]);

        if (records && records.length > 0 && records[0].value) {
            logger.info("[GetPlayerMetadata:" + requestId + "] Retrieved for user: " + ctx.userId);

            return JSON.stringify({
                success: true,
                metadata: records[0].value,
                storage: {
                    collection: PLAYER_METADATA_COLLECTION,
                    key: PLAYER_METADATA_KEY
                }
            });
        }

        logger.warn("[GetPlayerMetadata:" + requestId + "] No metadata found for user: " + ctx.userId);

        return JSON.stringify({
            success: false,
            error: "No metadata found for user",
            error_code: "NOT_FOUND"
        });
    } catch (err) {
        logger.error("[GetPlayerMetadata:" + requestId + "] Error: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to read metadata",
            error_code: "STORAGE_ERROR"
        });
    }
}

// ============================================================================
// ADDITIONAL RPC: Delete Player Metadata (Admin/Testing)
// ============================================================================

/**
 * RPC: admin_delete_player_metadata
 * Deletes all player metadata (for testing/admin purposes)
 */
function rpcAdminDeletePlayerMetadata(ctx, logger, nk, payload) {
    var requestId = generateShortUUID();

    if (!ctx.userId) {
        return JSON.stringify({
            success: false,
            error: "User not authenticated",
            error_code: "AUTH_REQUIRED"
        });
    }

    try {
        // Delete main metadata
        nk.storageDelete([{
            collection: PLAYER_METADATA_COLLECTION,
            key: PLAYER_METADATA_KEY,
            userId: ctx.userId
        }]);

        // Cleanup legacy locations
        cleanupLegacyMetadataAsync(nk, logger, ctx.userId, requestId);

        logger.info("[AdminDeletePlayerMetadata:" + requestId + "] Deleted metadata for user: " + ctx.userId);

        return JSON.stringify({
            success: true,
            message: "Player metadata deleted successfully"
        });
    } catch (err) {
        logger.error("[AdminDeletePlayerMetadata:" + requestId + "] Error: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to delete metadata",
            error_code: "STORAGE_ERROR"
        });
    }
}
/**
 * RPC:
 *
 * Stores or updates per-user metadata in Nakama Storage.
 *
 * Storage:
 *   collection: "player_metadata"
 *   key: "metadata"
 *   userId: ctx.userId (authenticated user)
 *
 * Behavior:
 * - If a record exists, merge new fields on top (new values override).
 * - If no record exists, create one with provided payload.
 * - Always ensure only one record per (collection, key, userId).
 *
 * Expected payload (example):
 * {
 *   "role": "guest",
 *   "email": "...",
 *   "game_id": "uuid",
 *   "is_adult": "True",
 *   "last_name": "User",
 *   "first_name": "Guest",
 *   "login_type": "guest",
 *   "idp_username": "...",
 *   "account_status": "active",
 *   "wallet_address": "global:...",
 *   "cognito_user_id": "...",
 *   "geo_location": "IN",
 *   "device_id": "example-device-id-123"
 * }
 */


function NewrpcUpdatePlayerMetadata(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({
            success: false,
            error: "User not authenticated",
            error_code: "AUTH_REQUIRED"
        });
    }

    var userId = ctx.userId;
    var requestId = generateUUID(). substring(0, 8);
    var meta;

    logger.info("[PlayerMetadata:" + requestId + "] Processing metadata update for user " + userId);

    // Parse JSON
    try {
        meta = JSON.parse(payload || "{}");
    } catch (err) {
        logger.error("[PlayerMetadata:" + requestId + "] Invalid JSON payload: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Invalid JSON payload",
            error_code: "INVALID_JSON",
            request_id: requestId
        });
    }

    // Light validation of core fields (log-only, do not reject)
    var requiredFields = [
        "role",
        "email",
        "game_id",
        "is_adult",
        "is_guest",
        "last_name",
        "first_name",
        "login_type",
        "idp_username",
        "account_status",
        "wallet_address",
        "cognito_user_id",
        "geo_location",
        "device_id"
    ];

    var missing = [];
    for (var i = 0; i < requiredFields. length; i++) {
        var f = requiredFields[i];
        if (! Object.prototype.hasOwnProperty.call(meta, f)) {
            missing. push(f);
        }
    }

    if (missing.length > 0) {
        logger.warn("[PlayerMetadata:" + requestId + "] Missing recommended fields for user " + userId + ": " + missing.join(", "));
    }

    // Log received geolocation data for debugging
    if (meta.latitude !== undefined || meta.longitude !== undefined) {
        logger. info("[PlayerMetadata:" + requestId + "] Received geolocation: lat=" +
            meta.latitude + ", lon=" + meta.longitude +
            ", country=" + (meta.country_code || meta.geo_location || "N/A") +
            ", city=" + (meta.city || "N/A") +
            ", source=" + (meta. location_source || "N/A"));
    } else {
        logger.warn("[PlayerMetadata:" + requestId + "] No geolocation coordinates in payload");
    }

    // Log isGuest status
    logger.info("[PlayerMetadata:" + requestId + "] is_guest received: " + (meta.is_guest !== undefined ? meta.is_guest : "not provided"));

    // Read existing metadata
    var collection = "player_metadata";
    var key = "metadata";

    var existing = null;
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: userId
        }]);

        if (records && records.length > 0 && records[0].value) {
            existing = records[0].value;
            logger.info("[PlayerMetadata:" + requestId + "] Found existing metadata for user");
        }
    } catch (err) {
        logger.error("[PlayerMetadata:" + requestId + "] Error reading existing metadata for user " + userId + ": " + err.message);
    }

    var isNewUser = (existing === null);
    var now = new Date().toISOString();

    // Merge: new fields override existing ones
    var merged = {};

    // Copy existing fields first
    if (existing && typeof existing === "object") {
        for (var prop in existing) {
            if (Object.prototype.hasOwnProperty.call(existing, prop)) {
                merged[prop] = existing[prop];
            }
        }
    }

    // Merge new fields from payload (only non-null/undefined values)
    if (meta && typeof meta === "object") {
        for (var prop2 in meta) {
            if (Object.prototype.hasOwnProperty.call(meta, prop2)) {
                if (meta[prop2] !== null && meta[prop2] !== undefined) {
                    merged[prop2] = meta[prop2];
                }
            }
        }
    }

    // Ensure user_id is set
    merged.user_id = userId;

    // ============================================================================
    // HANDLE isGuest EXPLICITLY - Convert string "True"/"False" to boolean
    // ============================================================================
    if (meta.is_guest !== undefined && meta.is_guest !== null) {
        if (typeof meta.is_guest === "string") {
            merged.is_guest = (meta.is_guest. toLowerCase() === "true");
        } else if (typeof meta.is_guest === "boolean") {
            merged.is_guest = meta. is_guest;
        } else {
            merged.is_guest = !!meta.is_guest;
        }
        logger.info("[PlayerMetadata:" + requestId + "] is_guest parsed as: " + merged. is_guest);
    } else if (merged.is_guest === undefined) {
        merged.is_guest = false;
    }

    // ============================================================================
    // HANDLE GEOLOCATION FIELDS EXPLICITLY
    // ============================================================================

    // Latitude - ensure it's stored as a number with validation
    if (meta.latitude !== undefined && meta.latitude !== null && meta.latitude !== "") {
        var lat = parseFloat(meta.latitude);
        if (! isNaN(lat) && lat >= -90 && lat <= 90) {
            merged.latitude = lat;
            merged.has_location_data = true;
            logger.info("[PlayerMetadata:" + requestId + "] âœ“ Stored latitude: " + lat);
        } else {
            logger. warn("[PlayerMetadata:" + requestId + "] âœ— Invalid latitude value: " + meta. latitude);
        }
    }

    // Longitude - ensure it's stored as a number with validation
    if (meta.longitude !== undefined && meta.longitude !== null && meta.longitude !== "") {
        var lon = parseFloat(meta.longitude);
        if (!isNaN(lon) && lon >= -180 && lon <= 180) {
            merged.longitude = lon;
            merged. has_location_data = true;
            logger.info("[PlayerMetadata:" + requestId + "] âœ“ Stored longitude: " + lon);
        } else {
            logger. warn("[PlayerMetadata:" + requestId + "] âœ— Invalid longitude value: " + meta.longitude);
        }
    }

    // Country code (prefer country_code, fallback to geo_location)
    if (meta.country_code && meta.country_code !== "") {
        merged.country_code = meta.country_code;
        merged.geo_location = meta. country_code; // Keep both for compatibility
    } else if (meta.geo_location && meta.geo_location !== "" && ! merged.country_code) {
        merged.country_code = meta.geo_location;
        merged.geo_location = meta.geo_location;
    }

    // Country name
    if (meta. country && meta.country !== "") {
        merged.country = meta.country;
    }

    // Region/State
    if (meta.region && meta. region !== "") {
        merged.region = meta.region;
    }

    // City
    if (meta.city && meta.city !== "") {
        merged.city = meta. city;
    }

    // Timezone from location
    if (meta. location_timezone && meta.location_timezone !== "") {
        merged.location_timezone = meta. location_timezone;
    }

    // Location source (gps, ip, etc.)
    if (meta.location_source && meta. location_source !== "") {
        merged. location_source = meta.location_source;
    }

    // Track if location was fully resolved
    if (merged.latitude !== undefined && merged.longitude !== undefined && merged.country_code) {
        merged.has_resolved_location = true;
        merged.location_updated_at = now;
        logger.info("[PlayerMetadata:" + requestId + "] âœ“ Location fully resolved: " +
            (merged.city || "Unknown") + ", " + (merged.region || "Unknown") + ", " +
            (merged.country || merged.country_code) + " (" + merged.country_code + ") via " +
            (merged.location_source || "unknown"));
    } else if (merged.latitude !== undefined && merged. longitude !== undefined) {
        merged.has_resolved_location = false;
        merged. has_location_data = true;
        merged.location_updated_at = now;
        logger.info("[PlayerMetadata:" + requestId + "] Location coords only: lat=" +
            merged.latitude + ", lon=" + merged. longitude);
    } else if (merged.country_code || merged.geo_location) {
        merged.has_resolved_location = false;
        merged.has_location_data = true;
        logger.info("[PlayerMetadata:" + requestId + "] Country code only: " + (merged.country_code || merged.geo_location));
    } else {
        merged.has_resolved_location = false;
        if (merged.has_location_data === undefined) {
            merged.has_location_data = false;
        }
        logger.warn("[PlayerMetadata:" + requestId + "] No valid location data received");
    }

    // ============================================================================
    // HANDLE DEVICE INFO
    // ============================================================================
    if (meta.device_id) merged.device_id = meta.device_id;
    if (meta.platform) merged.platform = meta.platform;
    if (meta. device_model) merged.device_model = meta.device_model;
    if (meta.device_name) merged.device_name = meta.device_name;
    if (meta.os_version) merged. os_version = meta.os_version;
    if (meta.app_version) merged. app_version = meta.app_version;
    if (meta.unity_version) merged. unity_version = meta.unity_version;
    if (meta.locale) merged.locale = meta.locale;
    if (meta. timezone) merged.timezone = meta.timezone;
    if (meta. screen_width) merged.screen_width = meta.screen_width;
    if (meta.screen_height) merged. screen_height = meta.screen_height;
    if (meta.screen_dpi) merged.screen_dpi = meta.screen_dpi;
    if (meta.graphics_device) merged.graphics_device = meta.graphics_device;
    if (meta.system_memory_mb) merged.system_memory_mb = meta.system_memory_mb;
    if (meta.processor_type) merged.processor_type = meta.processor_type;
    if (meta.processor_count) merged. processor_count = meta.processor_count;

    // Screen resolution helper
    if (meta.screen_width && meta.screen_height) {
        merged.screen_resolution = meta.screen_width + "x" + meta.screen_height;
    }

    // ============================================================================
    // HANDLE IDENTITY FIELDS
    // ============================================================================
    if (meta.role) merged.role = meta. role;
    if (meta.email) merged.email = meta.email;
    if (meta.first_name) merged. first_name = meta.first_name;
    if (meta.last_name) merged.last_name = meta.last_name;
    if (meta.login_type) merged.login_type = meta. login_type;
    if (meta. idp_username) merged.idp_username = meta.idp_username;
    if (meta. account_status) merged.account_status = meta.account_status;
    if (meta.wallet_address) merged.wallet_address = meta.wallet_address;
    if (meta.cognito_user_id) merged.cognito_user_id = meta.cognito_user_id;

    // Handle is_adult (keep as string for compatibility)
    if (meta.is_adult !== undefined && meta. is_adult !== null) {
        if (typeof meta.is_adult === "string") {
            merged.is_adult = meta.is_adult;
        } else {
            merged.is_adult = meta. is_adult ?  "True" : "False";
        }
    }

    // Nakama username
    if (ctx.username) {
        merged.nakama_username = ctx.username;
    }

    // ============================================================================
    // TRACK GAMES PLAYED
    // ============================================================================
    var gameId = meta.game_id || meta.current_game_id;
    if (gameId) {
        merged.current_game_id = gameId;
        merged.game_id = gameId;

        if (! merged.games) merged.games = [];

        var gameIndex = -1;
        for (var g = 0; g < merged.games. length; g++) {
            if (merged.games[g]. game_id === gameId) {
                gameIndex = g;
                break;
            }
        }

        if (gameIndex >= 0) {
            merged.games[gameIndex].last_played = now;
            merged.games[gameIndex].session_count = (merged.games[gameIndex].session_count || 0) + 1;
        } else {
            merged.games.push({
                game_id: gameId,
                first_played: now,
                last_played: now,
                play_count: 1,
                session_count: 1,
                total_playtime_seconds: 0
            });
        }

        merged.total_games = merged.games.length;
        merged.last_game_played_at = now;
    }

    // ============================================================================
    // TRACK DEVICES
    // ============================================================================
    if (meta.device_id) {
        merged.current_device_id = meta.device_id;

        if (!merged. devices) merged.devices = [];

        var deviceIndex = -1;
        for (var d = 0; d < merged.devices.length; d++) {
            if (merged. devices[d].device_id === meta. device_id) {
                deviceIndex = d;
                break;
            }
        }

        if (deviceIndex >= 0) {
            merged.devices[deviceIndex].last_seen = now;
            merged.devices[deviceIndex].session_count = (merged.devices[deviceIndex].session_count || 0) + 1;
            if (meta.platform) merged.devices[deviceIndex].platform = meta.platform;
            if (meta.device_model) merged. devices[deviceIndex]. device_model = meta.device_model;
            if (meta.os_version) merged. devices[deviceIndex]. os_version = meta.os_version;
            if (meta.app_version) merged.devices[deviceIndex].app_version = meta.app_version;
        } else {
            merged.devices.push({
                device_id: meta.device_id,
                platform: meta.platform || "",
                device_model: meta.device_model || "",
                device_name: meta. device_name || "",
                os_version: meta.os_version || "",
                app_version: meta.app_version || "",
                unity_version: meta. unity_version || "",
                locale: meta.locale || "",
                timezone: meta. timezone || "",
                screen_width: meta.screen_width || 0,
                screen_height: meta. screen_height || 0,
                screen_dpi: meta.screen_dpi || "",
                graphics_device: meta.graphics_device || "",
                system_memory_mb: meta.system_memory_mb || 0,
                processor_type: meta. processor_type || "",
                processor_count: meta.processor_count || 0,
                first_seen: now,
                last_seen: now,
                session_count: 1
            });
        }

        merged.total_devices = merged. devices.length;
    }

    // ============================================================================
    // ANALYTICS TRACKING
    // ============================================================================
    if (! merged.analytics) {
        merged.analytics = {
            first_session: now,
            last_session: now,
            total_sessions: 1,
            days_active: 1,
            current_streak: 1,
            longest_streak: 1,
            last_active_date: now. split('T')[0],
            days_since_first_session: 0,
            average_sessions_per_day: 1
        };
    } else {
        merged.analytics.last_session = now;
        merged.analytics.total_sessions = (merged.analytics. total_sessions || 0) + 1;

        var today = now.split('T')[0];
        var lastActiveDate = merged.analytics.last_active_date;

        if (lastActiveDate !== today) {
            merged.analytics.days_active = (merged.analytics.days_active || 0) + 1;

            // Check streak
            var yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            var yesterdayStr = yesterday.toISOString().split('T')[0];

            if (lastActiveDate === yesterdayStr) {
                merged.analytics. current_streak = (merged.analytics. current_streak || 0) + 1;
                if (merged.analytics. current_streak > (merged.analytics.longest_streak || 0)) {
                    merged.analytics.longest_streak = merged. analytics.current_streak;
                }
            } else {
                merged.analytics.current_streak = 1;
            }

            merged.analytics.last_active_date = today;
        }

        // Calculate days since first session
        if (merged.analytics.first_session) {
            var firstDate = new Date(merged.analytics.first_session);
            var nowDate = new Date(now);
            var diffTime = Math.abs(nowDate - firstDate);
            var diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            merged.analytics.days_since_first_session = diffDays;

            if (diffDays > 0) {
                merged.analytics.average_sessions_per_day =
                    Math.round((merged.analytics.total_sessions / diffDays) * 100) / 100;
            }
        }
    }

    // Track total_sessions at top level for easy access
    merged. total_sessions = merged.analytics ?  merged.analytics.total_sessions : 1;

    // ============================================================================
    // SET TIMESTAMPS
    // ============================================================================
    merged. updated_at = now;
    if (! merged.created_at && isNewUser) {
        merged.created_at = now;
        merged.first_seen_at = now;
    }

    // ============================================================================
    // WRITE TO STORAGE
    // ============================================================================
    var write = {
        collection: collection,
        key: key,
        userId: userId,
        value: merged,
        permissionRead: 2,  // public read (for admin visibility)
        permissionWrite: 1, // owner write
        version: "*"        // last-write-wins upsert
    };

    try {
        nk.storageWrite([write]);
        logger.info("[PlayerMetadata:" + requestId + "] âœ“ Metadata saved successfully for user " + userId);

        // Log final status
        if (merged.has_resolved_location) {
            logger. info("[PlayerMetadata:" + requestId + "] âœ“ Location: " +
                (merged.city || "") + ", " + (merged.region || "") + ", " +
                (merged. country || merged.country_code) +
                " | Coords: " + merged.latitude + ", " + merged.longitude +
                " | Source: " + (merged.location_source || "unknown"));
        }
        logger.info("[PlayerMetadata:" + requestId + "] âœ“ is_guest: " + merged.is_guest +
            " | Games: " + (merged.total_games || 0) +
            " | Sessions: " + (merged.total_sessions || 1));

    } catch (err) {
        logger. error("[PlayerMetadata:" + requestId + "] âœ— Error writing metadata for user " + userId + ": " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to save metadata",
            error_code: "STORAGE_ERROR",
            request_id: requestId
        });
    }

    // ============================================================================
    // RETURN SUCCESS RESPONSE
    // ============================================================================
    return JSON.stringify({
        success: true,
        is_new_user: isNewUser,
        request_id: requestId,
        metadata: {
            // Identity
            user_id: merged.user_id,
            role: merged.role,
            email: merged.email,
            game_id: merged.current_game_id,
            is_adult: merged. is_adult,
            is_guest: merged.is_guest,
            last_name: merged.last_name,
            first_name: merged.first_name,
            login_type: merged.login_type,
            account_status: merged. account_status,
            nakama_username: merged.nakama_username,

            // Geolocation
            latitude: merged.latitude,
            longitude: merged.longitude,
            country: merged. country,
            country_code: merged. country_code,
            geo_location: merged. geo_location,
            region: merged.region,
            city: merged.city,
            timezone: merged.timezone,
            location_timezone: merged.location_timezone,
            location_source: merged. location_source,
            location_updated_at: merged.location_updated_at,
            has_location_data: merged. has_location_data,
            has_resolved_location: merged.has_resolved_location,

            // Device
            device_id: merged.current_device_id,
            platform: merged.platform,
            device_model: merged.device_model,
            os_version: merged. os_version,
            app_version: merged.app_version,
            locale: merged.locale,
            total_devices: merged. total_devices,

            // Games & Analytics
            games: merged.games,
            total_games: merged.total_games,
            total_sessions: merged. total_sessions,
            last_game_played_at: merged.last_game_played_at,
            analytics: merged.analytics,

            // Timestamps
            created_at: merged.created_at,
            updated_at: merged. updated_at,
            first_seen_at: merged.first_seen_at
        },
        storage: {
            collection: collection,
            key: key,
            permission_read: "public",
            permission_write: "owner"
        }
    });
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

// cognito_wallet_mapper.js - Core RPC functions for Cognito â†” Wallet mapping


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

/**
 * RPC: Get balances for a specific game wallet
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 * @returns {string} JSON response
 *
 * Response shape matches what your Unity client expects:
 * {
 *   "success": true,
 *   "game_balance":   <number>,
 *   "global_balance": <number>,
 *   "currencies": { ... },
 *   "gameId": "uuid",
 *   "userId": "uuid"
 * }
 */
function rpcWalletGetBalances(ctx, logger, nk, payload) {
    logInfo(logger, "RPC wallet_get_balances called");

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

    // Get game wallet
    var wallet = getGameWallet(nk, logger, userId, gameId);
    var currencies = wallet.currencies || {};

    // Get global wallet too for global_balance
    var globalWallet = getGlobalWallet(nk, logger, userId);
    var globalCurrencies = globalWallet.currencies || {};

    // Return BOTH key formats for maximum compatibility
    var gameBalance = currencies.game || currencies.tokens || 0;
    var globalBalance = globalCurrencies.global || globalCurrencies.xut || 0;

    logInfo(logger, "Returning balances - game: " + gameBalance + ", global: " + globalBalance);

    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        game_balance: gameBalance,
        global_balance: globalBalance,
        currencies: currencies,
        timestamp: getCurrentTimestamp()
    });
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
    const validatePayload = utils ? validatePayload : function (p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? logInfo : function (l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? logError : function (l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? handleError : function (c, e, m) {
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
    const validatePayload = utils ? validatePayload : function (p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? logInfo : function (l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? logError : function (l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? handleError : function (c, e, m) {
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
    const validatePayload = utils ? validatePayload : function (p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? logInfo : function (l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? logError : function (l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? handleError : function (c, e, m) {
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
    const validatePayload = utils ? validatePayload : function (p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? logInfo : function (l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? logError : function (l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? handleError : function (c, e, m) {
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
    const logInfo = utils ? logInfo : function (l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? logError : function (l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? handleError : function (c, e, m) {
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
// QUIZ_RESULTS - Comprehensive Quiz Result Tracking
// ============================================================================

/**
 * Quiz Results System - Stores ALL quiz results from ALL game modes
 * for analytics, history, leaderboards, and mission progress tracking
 */

/**
 * Get collection name for quiz results
 */
function getQuizResultsCollection(gameId) {
    return "quiz_results_" + gameId;
}

/**
 * Get user stats collection
 */
function getQuizUserStatsCollection(gameId) {
    return "quiz_user_stats_" + gameId;
}

/**
 * Generate unique result key
 */
function generateQuizResultKey(userId, timestamp) {
    return "result_" + userId + "_" + timestamp;
}

/**
 * Calculate quiz performance metrics
 */
function calculateQuizMetrics(result) {
    var accuracy = result.totalQuestions > 0
        ? (result.correctAnswers / result.totalQuestions) * 100
        : 0;

    var avgTimePerQuestion = result.totalQuestions > 0
        ? result.timeTakenSeconds / result.totalQuestions
        : 0;

    var isPerfect = result.correctAnswers === result.totalQuestions && result.totalQuestions > 0;

    // Calculate performance rating (1-5 stars)
    var rating = 0;
    if (accuracy >= 90) rating += 2.5;
    else if (accuracy >= 70) rating += 2.0;
    else if (accuracy >= 50) rating += 1.5;
    else if (accuracy >= 30) rating += 1.0;
    else rating += 0.5;

    if (avgTimePerQuestion <= 5) rating += 1.5;
    else if (avgTimePerQuestion <= 10) rating += 1.0;
    else if (avgTimePerQuestion <= 15) rating += 0.5;

    if (result.won) rating += 1.0;

    return {
        accuracy: Math.round(accuracy * 100) / 100,
        avgTimePerQuestion: Math.round(avgTimePerQuestion * 100) / 100,
        isPerfect: isPerfect,
        performanceRating: Math.min(5, Math.round(rating * 10) / 10)
    };
}

/**
 * Update user's aggregate quiz statistics
 */
function updateQuizUserStats(nk, logger, userId, gameId, result, metrics) {
    var collection = getQuizUserStatsCollection(gameId);
    var key = "stats_" + userId;

    var stats = readStorage(nk, logger, collection, key, userId);

    if (!stats) {
        stats = {
            userId: userId,
            gameId: gameId,
            totalGames: 0,
            totalWins: 0,
            totalScore: 0,
            totalCorrect: 0,
            totalQuestions: 0,
            totalTimePlayed: 0,
            perfectGames: 0,
            highestScore: 0,
            longestStreak: 0,
            currentStreak: 0,
            lastPlayedAt: null,
            modeStats: {},
            createdAt: getCurrentTimestamp()
        };
    }

    // Update totals
    stats.totalGames++;
    stats.totalScore += result.score || 0;
    stats.totalCorrect += result.correctAnswers || 0;
    stats.totalQuestions += result.totalQuestions || 0;
    stats.totalTimePlayed += result.timeTakenSeconds || 0;

    if (result.won) {
        stats.totalWins++;
        stats.currentStreak++;
        stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
    } else {
        stats.currentStreak = 0;
    }

    if (metrics.isPerfect) {
        stats.perfectGames++;
    }

    stats.highestScore = Math.max(stats.highestScore, result.score || 0);
    stats.lastPlayedAt = getCurrentTimestamp();

    // Update per-mode stats
    var mode = result.gameMode || "unknown";
    if (!stats.modeStats[mode]) {
        stats.modeStats[mode] = {
            games: 0,
            wins: 0,
            totalScore: 0,
            highestScore: 0
        };
    }
    stats.modeStats[mode].games++;
    if (result.won) stats.modeStats[mode].wins++;
    stats.modeStats[mode].totalScore += result.score || 0;
    stats.modeStats[mode].highestScore = Math.max(
        stats.modeStats[mode].highestScore,
        result.score || 0
    );

    stats.updatedAt = getCurrentTimestamp();

    writeStorage(nk, logger, collection, key, userId, stats);

    return stats;
}

/**
 * RPC: quiz_submit_result
 * Submit quiz result from any game mode with detailed question-level data
 *
 * Required payload:
 * {
 *   gameId: "uuid",
 *   gameMode: "QuickPlay | DailyChallenge | Championship | ...",
 *   score: 850,
 *   correctAnswers: 8,
 *   totalQuestions: 10,
 *   timeTakenSeconds: 120,
 *   won: true,
 *
 *   // Optional - Detailed question data
 *   questionDetails: [
 *     {
 *       questionIndex: 0,
 *       questionId: "q_123",
 *       questionText: "What is 2+2?",
 *       options: ["1", "2", "3", "4"],
 *       selectedAnswerIndex: 3,
 *       selectedAnswerText: "4",
 *       correctAnswerIndex: 3,
 *       correctAnswerText: "4",
 *       isCorrect: true,
 *       timeTakenSeconds: 5.2,
 *       explanation: "2+2=4",
 *       category: "Math",
 *       concept: "Addition",
 *       difficulty: "easy",
 *       usedHint: false,
 *       timedOut: false
 *     }
 *   ],
 *   missedConcepts: ["Algebra", "Geometry"],
 *   masteredConcepts: ["Arithmetic"]
 * }
 */
function rpcQuizSubmitResult(ctx, logger, nk, payload) {
    logInfo(logger, "RPC quiz_submit_result called");

    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data;

    // Validate required fields
    var required = ['gameId', 'gameMode', 'score', 'correctAnswers', 'totalQuestions', 'timeTakenSeconds'];
    var validation = validatePayload(data, required);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }

    if (!isValidUUID(data.gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }

    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }

    var username = ctx.username || "unknown";
    var timestamp = getUnixTimestamp();

    // Process question details to extract missed/mastered concepts
    var questionDetails = data.questionDetails || [];
    var missedConcepts = data.missedConcepts || [];
    var masteredConcepts = data.masteredConcepts || [];

    // Auto-extract concepts from question details if not provided
    if (questionDetails.length > 0 && missedConcepts.length === 0 && masteredConcepts.length === 0) {
        var conceptTracker = {};
        for (var i = 0; i < questionDetails.length; i++) {
            var qd = questionDetails[i];
            var concept = qd.concept || qd.category || "General";
            if (!conceptTracker[concept]) {
                conceptTracker[concept] = { correct: 0, total: 0 };
            }
            conceptTracker[concept].total++;
            if (qd.isCorrect) {
                conceptTracker[concept].correct++;
            }
        }

        // Classify concepts based on accuracy
        for (var concept in conceptTracker) {
            var stats = conceptTracker[concept];
            var accuracy = stats.total > 0 ? stats.correct / stats.total : 0;
            if (accuracy >= 0.7) {
                masteredConcepts.push(concept);
            } else if (accuracy < 0.5 && stats.total >= 1) {
                missedConcepts.push(concept);
            }
        }
    }

    // Build result object with all details
    var result = {
        id: generateQuizResultKey(userId, timestamp),
        userId: userId,
        username: username,
        gameId: data.gameId,
        gameMode: data.gameMode,
        score: parseInt(data.score) || 0,
        correctAnswers: parseInt(data.correctAnswers) || 0,
        totalQuestions: parseInt(data.totalQuestions) || 0,
        timeTakenSeconds: parseFloat(data.timeTakenSeconds) || 0,
        won: data.won === true || data.won === "true",

        // Optional summary fields
        difficulty: data.difficulty || "normal",
        categoryId: data.categoryId || null,
        categoryName: data.categoryName || null,
        topicName: data.topicName || null,
        opponentId: data.opponentId || null,
        opponentName: data.opponentName || null,
        tournamentId: data.tournamentId || null,
        matchId: data.matchId || null,
        hintsUsed: parseInt(data.hintsUsed) || 0,
        skipsUsed: parseInt(data.skipsUsed) || 0,
        extraTimeUsed: parseInt(data.extraTimeUsed) || 0,
        extraLivesUsed: parseInt(data.extraLivesUsed) || 0,
        coinsSpent: parseInt(data.coinsSpent) || 0,
        coinsEarned: parseInt(data.coinsEarned) || 0,
        xpEarned: parseInt(data.xpEarned) || 0,
        streakDay: parseInt(data.streakDay) || 0,
        maxStreak: parseInt(data.maxStreak) || 0,
        perfectAnswerCount: parseInt(data.perfectAnswerCount) || 0,
        metadata: data.metadata || {},

        // NEW: Detailed question-level data
        questionDetails: questionDetails,
        questionCount: questionDetails.length,

        // NEW: Concept tracking for learning insights
        missedConcepts: missedConcepts,
        masteredConcepts: masteredConcepts,

        timestamp: timestamp,
        submittedAt: getCurrentTimestamp()
    };

    // Calculate metrics
    var metrics = calculateQuizMetrics(result);
    result.metrics = metrics;
    result.perfectScore = metrics.isPerfect;

    // Add learning insights
    result.learningInsights = {
        needsImprovement: missedConcepts,
        strengths: masteredConcepts,
        conceptAccuracy: {},
        recommendedTopics: missedConcepts.slice(0, 3) // Top 3 concepts to practice
    };

    try {
        // 1. Store the result
        var collection = getQuizResultsCollection(data.gameId);
        var resultKey = result.id;
        writeStorage(nk, logger, collection, resultKey, userId, result);
        logInfo(logger, "Stored quiz result: " + resultKey);

        // 2. Update user stats
        var updatedStats = updateQuizUserStats(nk, logger, userId, data.gameId, result, metrics);

        // 3. Update leaderboard if score > 0
        if (result.score > 0) {
            try {
                var leaderboardId = "leaderboard_" + data.gameId;
                var leaderboardMetadata = {
                    gameMode: result.gameMode,
                    accuracy: metrics.accuracy,
                    submittedAt: result.submittedAt
                };

                nk.leaderboardRecordWrite(
                    leaderboardId,
                    userId,
                    username,
                    result.score,
                    0,
                    JSON.stringify(leaderboardMetadata),
                    null
                );
                logInfo(logger, "Updated leaderboard: " + leaderboardId);
            } catch (lbErr) {
                logWarning(logger, "Leaderboard update failed (non-critical): " + lbErr.message);
            }
        }

        // 4. Store in transaction log for analytics
        var transactionKey = "quiz_result_" + userId + "_" + timestamp;
        writeStorage(nk, logger, "transaction_logs", transactionKey, userId, {
            type: "quiz_result",
            resultId: result.id,
            gameMode: result.gameMode,
            score: result.score,
            won: result.won,
            timestamp: result.submittedAt
        });

        logInfo(logger, "Quiz result submitted: User " + userId + ", Mode: " + result.gameMode + ", Score: " + result.score);

        return JSON.stringify({
            success: true,
            resultId: result.id,
            metrics: metrics,
            stats: {
                totalGames: updatedStats.totalGames,
                totalWins: updatedStats.totalWins,
                currentStreak: updatedStats.currentStreak,
                highestScore: updatedStats.highestScore
            }
        });

    } catch (err) {
        logError(logger, "Failed to submit quiz result: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to submit result: " + err.message
        });
    }
}

/**
 * RPC: quiz_get_history
 * Get quiz history for a user
 */
function rpcQuizGetHistory(ctx, logger, nk, payload) {
    logInfo(logger, "RPC quiz_get_history called");

    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data;
    var validation = validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing gameId");
    }

    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }

    var collection = getQuizResultsCollection(data.gameId);
    var limit = Math.min(parseInt(data.limit) || 20, 100);

    try {
        var objects = nk.storageList(userId, collection, limit, data.cursor || "");

        var results = [];
        for (var i = 0; i < (objects.objects || []).length; i++) {
            var obj = objects.objects[i];
            var result = JSON.parse(obj.value);

            if (data.gameMode && result.gameMode !== data.gameMode) {
                continue;
            }

            results.push({
                id: result.id,
                gameMode: result.gameMode,
                score: result.score,
                correctAnswers: result.correctAnswers,
                totalQuestions: result.totalQuestions,
                won: result.won,
                metrics: result.metrics,
                categoryName: result.categoryName,
                submittedAt: result.submittedAt
            });
        }

        return JSON.stringify({
            success: true,
            results: results,
            cursor: objects.cursor || null,
            count: results.length
        });

    } catch (err) {
        logError(logger, "Failed to get quiz history: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to get history: " + err.message
        });
    }
}

/**
 * RPC: quiz_get_stats
 * Get user's aggregate quiz statistics
 */
function rpcQuizGetStats(ctx, logger, nk, payload) {
    logInfo(logger, "RPC quiz_get_stats called");

    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data;
    var validation = validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing gameId");
    }

    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }

    var collection = getQuizUserStatsCollection(data.gameId);
    var key = "stats_" + userId;

    var stats = readStorage(nk, logger, collection, key, userId);

    if (!stats) {
        return JSON.stringify({
            success: true,
            stats: {
                totalGames: 0,
                totalWins: 0,
                winRate: 0,
                totalScore: 0,
                averageScore: 0,
                accuracy: 0,
                highestScore: 0,
                currentStreak: 0,
                longestStreak: 0,
                perfectGames: 0,
                modeStats: {}
            }
        });
    }

    var winRate = stats.totalGames > 0
        ? Math.round((stats.totalWins / stats.totalGames) * 100)
        : 0;

    var averageScore = stats.totalGames > 0
        ? Math.round(stats.totalScore / stats.totalGames)
        : 0;

    var accuracy = stats.totalQuestions > 0
        ? Math.round((stats.totalCorrect / stats.totalQuestions) * 100)
        : 0;

    return JSON.stringify({
        success: true,
        stats: {
            totalGames: stats.totalGames,
            totalWins: stats.totalWins,
            winRate: winRate,
            totalScore: stats.totalScore,
            averageScore: averageScore,
            accuracy: accuracy,
            highestScore: stats.highestScore,
            currentStreak: stats.currentStreak,
            longestStreak: stats.longestStreak,
            perfectGames: stats.perfectGames,
            totalTimePlayed: stats.totalTimePlayed,
            modeStats: stats.modeStats,
            lastPlayedAt: stats.lastPlayedAt
        }
    });
}

/**
 * RPC: quiz_check_daily_completion
 * Check if user has completed a quiz for a specific game mode today
 * Based on user UUID - queries across all quiz result collections for the user
 *
 * Payload:
 * {
 *   gameMode: "DailyChallenge" | "DailyPremiumQuiz"
 *   gameId: "uuid" (optional - if provided, only checks that specific game)
 * }
 *
 * Returns:
 * {
 *   success: true,
 *   completed: boolean,
 *   gameMode: "DailyChallenge",
 *   date: "2025-01-15" (YYYY-MM-DD format)
 * }
 */
function rpcQuizCheckDailyCompletion(ctx, logger, nk, payload) {
    logInfo(logger, "RPC quiz_check_daily_completion called");

    var parsed = safeJsonParse(payload);
    if (!parsed.success) {
        return handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data;

    // Validate required fields (only gameMode is required now)
    var validation = validatePayload(data, ['gameMode']);
    if (!validation.valid) {
        return handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }

    // Validate gameMode
    var validModes = ['DailyChallenge', 'DailyPremiumQuiz'];
    if (validModes.indexOf(data.gameMode) === -1) {
        return handleError(ctx, null, "Invalid gameMode. Must be 'DailyChallenge' or 'DailyPremiumQuiz'");
    }

    // Validate gameId if provided (optional)
    if (data.gameId && !isValidUUID(data.gameId)) {
        return handleError(ctx, null, "Invalid gameId UUID format");
    }

    var userId = ctx.userId;
    if (!userId) {
        return handleError(ctx, null, "User not authenticated");
    }

    try {
        // Get today's start timestamp (00:00:00 UTC)
        var todayStart = getStartOfDay();
        var todayEnd = todayStart + 86400; // End of day (24 hours later)

        // Get current date string for response (YYYY-MM-DD)
        var today = new Date();
        var dateString = today.getUTCFullYear() + "-" +
                        String(today.getUTCMonth() + 1).padStart(2, '0') + "-" +
                        String(today.getUTCDate()).padStart(2, '0');

        var completed = false;

        // If gameId is provided, only check that specific collection
        if (data.gameId) {
            var collection = getQuizResultsCollection(data.gameId);
            var limit = 100; // Check last 100 results (should be enough for daily check)

            var objects = nk.storageList(userId, collection, limit, "");

            // Check if any result matches gameMode and was submitted today
            for (var i = 0; i < (objects.objects || []).length; i++) {
                var obj = objects.objects[i];
                var result = JSON.parse(obj.value);

                // Check if gameMode matches
                if (result.gameMode !== data.gameMode) {
                    continue;
                }

                // Check if submitted today
                // result.timestamp is Unix timestamp in seconds
                if (result.timestamp >= todayStart && result.timestamp < todayEnd) {
                    completed = true;
                    logInfo(logger, "User " + userId + " completed " + data.gameMode + " today (timestamp: " + result.timestamp + ")");
                    break;
                }
            }
        } else {
            // No gameId provided - query across all quiz result collections
            // We'll check common collection patterns and user's storage objects
            // Since we can't list all collections, we'll use a different approach:
            // Query the user's storage objects with a pattern match

            // Get all storage objects for this user (with a reasonable limit)
            // We'll search for objects in collections that match "quiz_results_*"
            var limit = 1000; // Higher limit to check more results across collections

            // Try to find quiz results by querying known collections or using storage index
            // Since Nakama doesn't support wildcard collection queries directly,
            // we'll use a workaround: check transaction_logs which stores all quiz results
            var transactionCollection = "transaction_logs";
            var transactionObjects = nk.storageList(userId, transactionCollection, limit, "");

            // Check transaction logs for quiz results submitted today
            for (var i = 0; i < (transactionObjects.objects || []).length; i++) {
                var obj = transactionObjects.objects[i];
                var transaction = JSON.parse(obj.value);

                // Check if this is a quiz result transaction
                if (transaction.type === "quiz_result" &&
                    transaction.gameMode === data.gameMode) {

                    // Parse timestamp from submittedAt (ISO string) or use timestamp if available
                    var transactionTimestamp = null;
                    if (transaction.timestamp) {
                        // If timestamp is a Unix timestamp (seconds)
                        if (typeof transaction.timestamp === 'number') {
                            transactionTimestamp = transaction.timestamp;
                        } else if (typeof transaction.timestamp === 'string') {
                            // If it's an ISO string, convert to Unix timestamp
                            var dateObj = new Date(transaction.timestamp);
                            if (!isNaN(dateObj.getTime())) {
                                transactionTimestamp = Math.floor(dateObj.getTime() / 1000);
                            }
                        }
                    } else if (transaction.submittedAt) {
                        // Fallback to submittedAt if timestamp not available
                        var dateObj = new Date(transaction.submittedAt);
                        if (!isNaN(dateObj.getTime())) {
                            transactionTimestamp = Math.floor(dateObj.getTime() / 1000);
                        }
                    }

                    // Check if submitted today
                    if (transactionTimestamp && transactionTimestamp >= todayStart && transactionTimestamp < todayEnd) {
                        completed = true;
                        logInfo(logger, "User " + userId + " completed " + data.gameMode + " today (from transaction log, timestamp: " + transactionTimestamp + ")");
                        break;
                    }
                }
            }

            // If not found in transaction logs, try to query known game collections
            // This is a fallback - in production, you might want to maintain a registry of gameIds
            if (!completed) {
                // Try common gameId patterns or query user's metadata for known gameIds
                // For now, we'll log that we couldn't find it in transaction logs
                logInfo(logger, "User " + userId + " daily completion check: not found in transaction logs, may need gameId");
            }
        }

        return JSON.stringify({
            success: true,
            completed: completed,
            gameMode: data.gameMode,
            date: dateString
        });

    } catch (err) {
        logError(logger, "Failed to check daily completion: " + err.message);
        return JSON.stringify({
            success: false,
            error: "Failed to check completion: " + err.message,
            completed: false
        });
    }
}

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
        // Initialize new global wallet with BOTH key formats
        wallet = {
            userId: userId,
            currencies: {
                global: 0,  // Unity client key
                xut: 0,     // Legacy/XUT token key
                xp: 0
            },
            items: {},
            nfts: [],
            createdAt: getCurrentTimestamp()
        };
    }

    // Ensure both keys exist (migration for existing wallets)
    if (wallet.currencies) {
        if (wallet.currencies.global === undefined) {
            wallet.currencies.global = wallet.currencies.xut || 0;
        }
        if (wallet.currencies.xut === undefined) {
            wallet.currencies.xut = wallet.currencies.global || 0;
        }
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
        // Initialize new game wallet with BOTH key formats
        wallet = {
            userId: userId,
            gameId: gameId,
            currencies: {
                game: 0,    // Unity client key
                tokens: 0,  // Legacy key
                xp: 0
            },
            items: {},
            consumables: {},
            cosmetics: {},
            createdAt: getCurrentTimestamp()
        };
    }

    // Ensure both keys exist (migration for existing wallets)
    if (wallet.currencies) {
        if (wallet.currencies.game === undefined) {
            wallet.currencies.game = wallet.currencies.tokens || 0;
        }
        if (wallet.currencies.tokens === undefined) {
            wallet.currencies.tokens = wallet.currencies.game || 0;
        }
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
    var amount = Number(data.amount);
    var operation = data.operation;

    if (isNaN(amount)) {
        return handleError(ctx, null, "Amount must be a valid number");
    }

    // Get game wallet
    var wallet = getGameWallet(nk, logger, userId, gameId);

    // NORMALIZE: Map client currency keys to storage keys
    // "game" -> updates both "game" and "tokens"
    // "tokens" -> updates both "game" and "tokens"
    var currenciesToUpdate = [];
    if (currency === "game" || currency === "tokens") {
        currenciesToUpdate = ["game", "tokens"];
    } else {
        currenciesToUpdate = [currency];
    }

    // Initialize currencies if not exists
    for (var i = 0; i < currenciesToUpdate.length; i++) {
        var curr = currenciesToUpdate[i];
        if (wallet.currencies[curr] === undefined || wallet.currencies[curr] === null) {
            wallet.currencies[curr] = 0;
        }
    }

    // Update all mapped currencies
    for (var i = 0; i < currenciesToUpdate.length; i++) {
        var curr = currenciesToUpdate[i];
        if (operation === "add") {
            wallet.currencies[curr] += amount;
        } else if (operation === "subtract") {
            wallet.currencies[curr] -= amount;
            if (wallet.currencies[curr] < 0) {
                wallet.currencies[curr] = 0;
            }
        } else {
            return handleError(ctx, null, "Invalid operation: " + operation);
        }
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
        newBalance: wallet.currencies[currency] || wallet.currencies.game || 0
    });

    logInfo(logger, "Wallet updated successfully.  New balances - game: " +
        wallet.currencies.game + ", tokens: " + wallet.currencies.tokens);

    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        currency: currency,
        newBalance: wallet.currencies[currency] || wallet.currencies.game || 0,
        // Include all balances for Unity compatibility
        game_balance: wallet.currencies.game || 0,
        global_balance: wallet.currencies.global || wallet.currencies.xut || 0,
        currencies: wallet.currencies,
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

    const existingIds = new Set(existingRecords.map(function (r) { return r.leaderboardId; }));
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

    // System user used for identity documents
    var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

    logger.info("[NAKAMA] Looking for identity: " + key);

    // Try to read existing identity
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: SYSTEM_USER_ID
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

    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: SYSTEM_USER_ID,
            value: identity,
            permissionRead: 1,
            permissionWrite: 0,
            version: "*"
        }]);

        logger.info("[NAKAMA] Created identity with wallet_id " + walletId + " for device " + deviceId);
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
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
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

    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: SYSTEM_USER,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[NAKAMA] Created game wallet with balance 0 for device " + deviceId);
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

    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: SYSTEM_USER
        }]);

        if (records && records.length > 0 && records[0].value) {
            logger.info("[NAKAMA] Found existing global wallet for device " + deviceId);
            return records[0].value;
        }
    } catch (err) {
        logger.warn("[NAKAMA] Failed to read global wallet: " + err.message);
    }

    // Create new global wallet
    logger.info("[NAKAMA] Creating new global wallet for device " + deviceId);

    var wallet = {
        wallet_id: globalWalletId,
        device_id: deviceId,
        game_id: "global",
        balance: 0,
        currency: "global_coins",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: SYSTEM_USER,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[NAKAMA] Created global wallet with balance 0 for device " + deviceId);
    } catch (err) {
        logger.error("[NAKAMA] Failed to write global wallet: " + err.message);
        throw err;
    }

    return wallet;
}

// ============================================================================
// ADAPTIVE REWARD SYSTEM - Per-Game Reward Configuration
// ============================================================================

/**
 * Game-specific reward configurations
 * Each game can have custom multipliers, currencies, and reward rules
 */
var GAME_REWARD_CONFIGS = {
    // QuizVerse - TUNED FOR SCARCITY (interstitials-only monetization)
    // Target: Average player earns ~50 coins/game, power users ~100 coins/game
    // Feature costs: Hint=75, ExtraTime=150, DoubleScore=300, PremiumAccess=500
    "126bf539-dae2-4bcf-964d-316c0fa1f92b": {
        game_name: "QuizVerse",
        score_to_coins_multiplier: 0.08,       // 8% of score = coins (scarcity tuned)
        min_score_for_reward: 50,              // Need 50+ score to earn anything
        max_reward_per_match: 150,             // Cap prevents inflation (3 hints max)
        currency: "coins",
        bonus_thresholds: [                     // Milestone bonuses encourage high performance
            { score: 500, bonus: 10, type: "good_game" },
            { score: 1000, bonus: 25, type: "great_game" },
            { score: 2000, bonus: 50, type: "perfect_game" }
        ],
        streak_multipliers: {                   // Streak rewards encourage retention
            3: 1.1,   // 10% bonus for 3 wins
            5: 1.2,   // 20% bonus for 5 wins
            7: 1.3,   // 30% bonus for 7 wins (weekly engagement)
            10: 1.5   // 50% bonus for 10 wins (power users)
        }
    },

    // LastToLive
    "8f3b1c2a-5d6e-4f7a-9b8c-1d2e3f4a5b6c": {
        game_name: "LastToLive",
        score_to_coins_multiplier: 0.05,       // 1000 score = 50 coins (harder)
        min_score_for_reward: 50,
        max_reward_per_match: 5000,
        currency: "survival_tokens",
        bonus_thresholds: [
            { score: 2000, bonus: 100, type: "survivor" },
            { score: 5000, bonus: 500, type: "elite" }
        ],
        streak_multipliers: {
            5: 1.2,
            10: 1.5,
            20: 2.0
        }
    },

    // Default config for any game not explicitly configured
    "default": {
        game_name: "Default",
        score_to_coins_multiplier: 0.1,
        min_score_for_reward: 0,
        max_reward_per_match: 100000,
        currency: "coins",
        bonus_thresholds: [],
        streak_multipliers: {}
    }
};

/**
 * Calculate reward amount based on game-specific rules
 * CRITICAL: This ensures wallet balance is NEVER set equal to score
 * Instead, it calculates a DERIVED reward based on score
 *
 * @param {string} gameId - Game UUID
 * @param {number} score - Player's score
 * @param {number} currentStreak - Current win streak (optional)
 * @returns {object} { reward: number, currency: string, bonuses: array, details: object }
 */
function calculateScoreReward(gameId, score, currentStreak) {
    // Get game config (fallback to default)
    var config = GAME_REWARD_CONFIGS[gameId] || GAME_REWARD_CONFIGS["default"];

    // Check minimum score
    if (score < config.min_score_for_reward) {
        return {
            reward: 0,
            currency: config.currency,
            bonuses: [],
            details: {
                reason: "below_minimum",
                min_required: config.min_score_for_reward
            }
        };
    }

    // Calculate base reward using multiplier
    var baseReward = Math.floor(score * config.score_to_coins_multiplier);

    // Apply streak multiplier if applicable
    var streakMultiplier = 1.0;
    if (currentStreak && config.streak_multipliers) {
        // Find highest applicable streak bonus
        var streakKeys = Object.keys(config.streak_multipliers).map(Number).sort(function (a, b) { return b - a; });
        for (var i = 0; i < streakKeys.length; i++) {
            if (currentStreak >= streakKeys[i]) {
                streakMultiplier = config.streak_multipliers[streakKeys[i]];
                break;
            }
        }
    }

    var rewardWithStreak = Math.floor(baseReward * streakMultiplier);

    // Check for milestone bonuses
    var bonuses = [];
    var totalBonus = 0;
    if (config.bonus_thresholds) {
        for (var j = 0; j < config.bonus_thresholds.length; j++) {
            var threshold = config.bonus_thresholds[j];
            if (score >= threshold.score) {
                bonuses.push({
                    type: threshold.type,
                    amount: threshold.bonus,
                    threshold: threshold.score
                });
                totalBonus += threshold.bonus;
            }
        }
    }

    // Calculate final reward
    var finalReward = rewardWithStreak + totalBonus;

    // Apply max cap
    if (finalReward > config.max_reward_per_match) {
        finalReward = config.max_reward_per_match;
    }

    return {
        reward: finalReward,
        currency: config.currency,
        bonuses: bonuses,
        details: {
            game_name: config.game_name,
            score: score,
            base_reward: baseReward,
            multiplier: config.score_to_coins_multiplier,
            streak: currentStreak || 0,
            streak_multiplier: streakMultiplier,
            milestone_bonus: totalBonus,
            final_reward: finalReward,
            capped: finalReward === config.max_reward_per_match
        }
    };
}

/**
 * RPC: calculate_score_reward
 * Calculate reward for a score without applying it
 * Useful for showing players their potential earnings
 */
function rpcCalculateScoreReward(ctx, logger, nk, payload) {
    logger.info('[RPC] calculate_score_reward called');

    try {
        var data = JSON.parse(payload || '{}');

        if (!data.game_id) {
            return JSON.stringify({
                success: false,
                error: 'game_id is required'
            });
        }

        if (data.score === undefined || data.score === null) {
            return JSON.stringify({
                success: false,
                error: 'score is required'
            });
        }

        var result = calculateScoreReward(
            data.game_id,
            parseInt(data.score),
            data.current_streak ? parseInt(data.current_streak) : 0
        );

        return JSON.stringify({
            success: true,
            reward: result.reward,
            currency: result.currency,
            bonuses: result.bonuses,
            details: result.details
        });

    } catch (err) {
        logger.error('[RPC] calculate_score_reward - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: update_game_reward_config
 * Admin RPC to update reward configuration for a game
 */
function rpcUpdateGameRewardConfig(ctx, logger, nk, payload) {
    logger.info('[RPC] update_game_reward_config called');

    try {
        var data = JSON.parse(payload || '{}');

        if (!data.game_id) {
            return JSON.stringify({
                success: false,
                error: 'game_id is required'
            });
        }

        if (!data.config) {
            return JSON.stringify({
                success: false,
                error: 'config object is required'
            });
        }

        // Validate config structure
        var config = data.config;
        if (config.score_to_coins_multiplier === undefined ||
            config.min_score_for_reward === undefined ||
            config.max_reward_per_match === undefined ||
            !config.currency) {
            return JSON.stringify({
                success: false,
                error: 'Invalid config structure. Required: score_to_coins_multiplier, min_score_for_reward, max_reward_per_match, currency'
            });
        }

        // Store config in storage for persistence
        var collection = "game_configs";
        var key = "reward_config:" + data.game_id;

        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: ctx.userId,
            value: config,
            permissionRead: 2, // Public read
            permissionWrite: 0,
            version: "*"
        }]);

        // Update in-memory config
        GAME_REWARD_CONFIGS[data.game_id] = config;

        logger.info('[RPC] Reward config updated for game: ' + data.game_id);

        return JSON.stringify({
            success: true,
            game_id: data.game_id,
            config: config,
            message: 'Reward configuration updated successfully'
        });

    } catch (err) {
        logger.error('[RPC] update_game_reward_config - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * Update game wallet balance by incrementing with score
 * FIXED: Now increments wallet instead of setting it to score value
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} deviceId - Device identifier
 * @param {string} gameId - Game UUID
 * @param {number} scoreToAdd - Score to add to current balance
 * @returns {object} Updated wallet
 */
function updateGameWalletBalance(nk, logger, deviceId, gameId, scoreToAdd) {
    var collection = "quizverse";
    var key = "wallet:" + deviceId + ":" + gameId;
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

    logger.info("[NAKAMA] Incrementing game wallet balance by " + scoreToAdd);

    var wallet;
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: SYSTEM_USER
        }]);

        if (records && records.length > 0 && records[0].value) {
            wallet = records[0].value;
        } else {
            logger.warn("[NAKAMA] Wallet not found, auto-creating for device " + deviceId);
            wallet = {
                wallet_id: generateUUID(),
                device_id: deviceId,
                game_id: gameId,
                balance: 0,
                currency: "coins",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
        }
    } catch (err) {
        logger.error("[NAKAMA] Failed to read wallet for update: " + err.message);
        throw err;
    }

    // BUG FIX: Increment balance instead of setting it
    var oldBalance = wallet.balance || 0;
    wallet.balance = oldBalance + scoreToAdd;
    wallet.updated_at = new Date().toISOString();

    // Write updated wallet
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: SYSTEM_USER,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Log transaction for history
        try {
            var transactionLog = {
                device_id: deviceId,
                game_id: gameId,
                transaction_type: "score_reward",
                currency: wallet.currency,
                amount: scoreToAdd,
                old_balance: oldBalance,
                new_balance: wallet.balance,
                timestamp: wallet.updated_at
            };
            var txKey = "transaction:" + deviceId + ":" + gameId + ":" + Date.now();
            nk.storageWrite([{
                collection: collection,
                key: txKey,
                userId: SYSTEM_USER,
                value: transactionLog,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        } catch (txErr) {
            logger.warn("[NAKAMA] Could not log transaction: " + txErr.message);
        }

        logger.info("[NAKAMA] Wallet balance updated: " + oldBalance + " + " + scoreToAdd + " = " + wallet.balance + " for device " + deviceId);
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
        // Check if leaderboard already exists
        try {
            var existing = nk.leaderboardsGetId([leaderboardId]);
            if (existing && existing.length > 0) {
                logger.debug("[NAKAMA] Leaderboard already exists: " + leaderboardId);
                return true;
            }
        } catch (checkErr) {
            // Leaderboard doesn't exist, proceed to create
        }

        // Nakama leaderboardCreate expects metadata as object, NOT JSON string
        var metadataObj = metadata || {};

        // Try to create the leaderboard
        nk.leaderboardCreate(
            leaderboardId,
            LEADERBOARD_CONFIG.authoritative,
            LEADERBOARD_CONFIG.sort,
            LEADERBOARD_CONFIG.operator,
            resetSchedule || "",
            metadataObj
        );
        logger.info("[NAKAMA] âœ“ Created leaderboard: " + leaderboardId);
        return true;
    } catch (err) {
        // Log actual error for debugging
        logger.error("[NAKAMA] âœ— Failed to create leaderboard " + leaderboardId + ": " + err.message);
        // Still return true if it's a "leaderboard already exists" error
        if (err.message && err.message.indexOf("already exists") !== -1) {
            logger.info("[NAKAMA] Leaderboard already exists (from error): " + leaderboardId);
            return true;
        }
        return false;
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
    var created = ensureLeaderboardExists(nk, logger, gameLeaderboardId, "", { scope: "game", gameId: gameId, description: "Main leaderboard for game " + gameId });
    if (created) {
        try {
            nk.leaderboardRecordWrite(gameLeaderboardId, userId, username, score, 0, metadata);
            leaderboardsUpdated.push(gameLeaderboardId);
            logger.info("[NAKAMA] âœ“ Score written to " + gameLeaderboardId + " (Rank updated)");
        } catch (err) {
            logger.error("[NAKAMA] âœ— Failed to write to " + gameLeaderboardId + ": " + err.message);
        }
    } else {
        logger.error("[NAKAMA] âœ— Skipping score write - leaderboard creation failed: " + gameLeaderboardId);
    }

    // 2. Write to time-period game leaderboards
    var timePeriods = ["daily", "weekly", "monthly", "alltime"];
    for (var i = 0; i < timePeriods.length; i++) {
        var period = timePeriods[i];
        var periodLeaderboardId = "leaderboard_" + gameId + "_" + period;
        var resetSchedule = RESET_SCHEDULES[period];
        var created = ensureLeaderboardExists(nk, logger, periodLeaderboardId, resetSchedule, {
            scope: "game",
            gameId: gameId,
            timePeriod: period,
            description: period.charAt(0).toUpperCase() + period.slice(1) + " leaderboard for game " + gameId
        });
        if (created) {
            try {
                nk.leaderboardRecordWrite(periodLeaderboardId, userId, username, score, 0, metadata);
                leaderboardsUpdated.push(periodLeaderboardId);
                logger.info("[NAKAMA] âœ“ Score written to " + periodLeaderboardId);
            } catch (err) {
                logger.error("[NAKAMA] âœ— Failed to write to " + periodLeaderboardId + ": " + err.message);
            }
        } else {
            logger.error("[NAKAMA] âœ— Skipping score write - leaderboard creation failed: " + periodLeaderboardId);
        }
    }

    // 3. Write to global leaderboards
    var globalLeaderboardId = "leaderboard_global";
    var created = ensureLeaderboardExists(nk, logger, globalLeaderboardId, "", { scope: "global", description: "Global all-time leaderboard" });
    if (created) {
        try {
            nk.leaderboardRecordWrite(globalLeaderboardId, userId, username, score, 0, metadata);
            leaderboardsUpdated.push(globalLeaderboardId);
            logger.info("[NAKAMA] âœ“ Score written to " + globalLeaderboardId);
        } catch (err) {
            logger.error("[NAKAMA] âœ— Failed to write to " + globalLeaderboardId + ": " + err.message);
        }
    } else {
        logger.error("[NAKAMA] âœ— Skipping score write - leaderboard creation failed: " + globalLeaderboardId);
    }

    // 4. Write to time-period global leaderboards
    for (var i = 0; i < timePeriods.length; i++) {
        var period = timePeriods[i];
        var globalPeriodId = "leaderboard_global_" + period;
        var resetSchedule = RESET_SCHEDULES[period];
        var created = ensureLeaderboardExists(nk, logger, globalPeriodId, resetSchedule, {
            scope: "global",
            timePeriod: period,
            description: period.charAt(0).toUpperCase() + period.slice(1) + " global leaderboard"
        });
        if (created) {
            try {
                nk.leaderboardRecordWrite(globalPeriodId, userId, username, score, 0, metadata);
                leaderboardsUpdated.push(globalPeriodId);
                logger.info("[NAKAMA] âœ“ Score written to " + globalPeriodId);
            } catch (err) {
                logger.error("[NAKAMA] âœ— Failed to write to " + globalPeriodId + ": " + err.message);
            }
        }
    }

    // 5. Write to friends leaderboards
    var friendsGameId = "leaderboard_friends_" + gameId;
    var created = ensureLeaderboardExists(nk, logger, friendsGameId, "", { scope: "friends_game", gameId: gameId, description: "Friends leaderboard for game " + gameId });
    if (created) {
        try {
            nk.leaderboardRecordWrite(friendsGameId, userId, username, score, 0, metadata);
            leaderboardsUpdated.push(friendsGameId);
            logger.info("[NAKAMA] âœ“ Score written to " + friendsGameId);
        } catch (err) {
            logger.error("[NAKAMA] âœ— Failed to write to " + friendsGameId + ": " + err.message);
        }
    }

    var friendsGlobalId = "leaderboard_friends_global";
    var created = ensureLeaderboardExists(nk, logger, friendsGlobalId, "", { scope: "friends_global", description: "Global friends leaderboard" });
    if (created) {
        try {
            nk.leaderboardRecordWrite(friendsGlobalId, userId, username, score, 0, metadata);
            leaderboardsUpdated.push(friendsGlobalId);
            logger.info("[NAKAMA] âœ“ Score written to " + friendsGlobalId);
        } catch (err) {
            logger.error("[NAKAMA] âœ— Failed to write to " + friendsGlobalId + ": " + err.message);
        }
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
 * Production-grade user identity management with proper error handling,
 * idempotency, security validation, and comprehensive logging
 *
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON with username, device_id, game_id
 * @returns {string} JSON response
 */
function createOrSyncUser(ctx, logger, nk, payload) {
    var startTime = Date.now();
    var requestId = generateUUID().substring(0, 8); // Short request ID for tracing

    logger.info("[NAKAMA:" + requestId + "] RPC create_or_sync_user called");

    // Parse and validate payload
    var data;
    try {
        data = JSON.parse(payload);
    } catch (parseErr) {
        logger.error("[NAKAMA:" + requestId + "] Invalid JSON payload: " + parseErr.message);
        return JSON.stringify({
            success: false,
            error: "Invalid JSON payload",
            errorCode: "INVALID_JSON",
            requestId: requestId
        });
    }

    // Validate required fields with detailed error messages
    var validationErrors = [];

    if (!data.username || typeof data.username !== 'string' || data.username.trim().length === 0) {
        validationErrors.push("username: required, must be non-empty string");
    }

    if (!data.device_id || typeof data.device_id !== 'string' || data.device_id.trim().length === 0) {
        validationErrors.push("device_id: required, must be non-empty string");
    }

    if (!data.game_id || typeof data.game_id !== 'string') {
        validationErrors.push("game_id: required, must be string");
    } else if (!isValidUUID(data.game_id)) {
        validationErrors.push("game_id: must be valid UUID format");
    }

    if (validationErrors.length > 0) {
        logger.warn("[NAKAMA:" + requestId + "] Validation failed: " + validationErrors.join("; "));
        return JSON.stringify({
            success: false,
            error: "Missing or invalid required fields",
            errorCode: "VALIDATION_ERROR",
            validationErrors: validationErrors,
            requestId: requestId
        });
    }

    // Sanitize inputs
    var username = sanitizeUsername(data.username);
    var deviceId = data.device_id.trim();
    var gameId = data.game_id.trim();

    logger.info("[NAKAMA:" + requestId + "] Processing: device=" + deviceId + ", game=" + gameId + ", username=" + username);

    try {
        // Step 1: Determine userId with proper validation and persistence
        var userId;
        try {
            userId = getOrCreateUserIdForDevice(nk, logger, deviceId, ctx);

            if (!isValidUUID(userId)) {
                throw new Error("Generated userId is not a valid UUID: " + userId);
            }

            logger.info("[NAKAMA:" + requestId + "] Resolved userId: " + userId);
        } catch (userIdErr) {
            logger.error("[NAKAMA:" + requestId + "] Failed to resolve userId: " + userIdErr.message);
            return JSON.stringify({
                success: false,
                error: "Failed to generate user identifier",
                errorCode: "USER_ID_GENERATION_FAILED",
                details: userIdErr.message,
                requestId: requestId
            });
        }

        // Step 2: Get or create identity with race condition protection
        var identityResult;
        var identity;
        var created;

        try {
            identityResult = getOrCreateIdentity(nk, logger, deviceId, gameId, username);
            identity = identityResult.identity;
            created = !identityResult.exists;

            logger.info("[NAKAMA:" + requestId + "] Identity " + (created ? "created" : "retrieved") + " successfully");
        } catch (identityErr) {
            logger.error("[NAKAMA:" + requestId + "] Identity operation failed: " + identityErr.message);
            return JSON.stringify({
                success: false,
                error: "Failed to create or retrieve user identity",
                errorCode: "IDENTITY_OPERATION_FAILED",
                details: identityErr.message,
                requestId: requestId
            });
        }

        // Step 3: Ensure per-game wallet exists
        var gameWallet;
        try {
            gameWallet = getOrCreateGameWallet(nk, logger, deviceId, gameId, identity.wallet_id);
            logger.info("[NAKAMA:" + requestId + "] Game wallet ready: balance=" + gameWallet.balance);
        } catch (walletErr) {
            logger.error("[NAKAMA:" + requestId + "] Game wallet creation failed: " + walletErr.message);
            // Non-fatal - continue with warning
            gameWallet = null;
        }

        // Step 4: Ensure global wallet exists
        var globalWallet;
        try {
            globalWallet = getOrCreateGlobalWallet(nk, logger, deviceId, identity.global_wallet_id);
            logger.info("[NAKAMA:" + requestId + "] Global wallet ready: balance=" + globalWallet.balance);
        } catch (globalWalletErr) {
            logger.error("[NAKAMA:" + requestId + "] Global wallet creation failed: " + globalWalletErr.message);
            // Non-fatal - continue with warning
            globalWallet = null;
        }

        // Step 5: Update Nakama username for new identities
        if (created && userId) {
            try {
                updateNakamaUsername(nk, logger, userId, username);
                logger.info("[NAKAMA:" + requestId + "] Updated Nakama username to: " + username);
            } catch (usernameErr) {
                logger.warn("[NAKAMA:" + requestId + "] Failed to update Nakama username: " + usernameErr.message);
                // Non-fatal - username update is optional
            }
        }

        // Step 6: Update player metadata with comprehensive tracking
        try {
            updatePlayerMetadata(nk, logger, userId, gameId, data);
            logger.info("[NAKAMA:" + requestId + "] Player metadata updated successfully");
        } catch (metaErr) {
            logger.warn("[NAKAMA:" + requestId + "] Player metadata update failed: " + metaErr.message);
            // Non-fatal - metadata is supplementary
        }

        // Calculate execution time
        var executionTime = Date.now() - startTime;
        logger.info("[NAKAMA:" + requestId + "] create_or_sync_user completed in " + executionTime + "ms");

        // Return success with comprehensive data
        return JSON.stringify({
            success: true,
            created: created,
            userId: userId,
            username: identity.username,
            device_id: identity.device_id,
            game_id: identity.game_id,
            wallet_id: identity.wallet_id,
            global_wallet_id: identity.global_wallet_id,
            gameWalletBalance: gameWallet ? gameWallet.balance : 0,
            globalWalletBalance: globalWallet ? globalWallet.balance : 0,
            executionTimeMs: executionTime,
            requestId: requestId,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        var executionTime = Date.now() - startTime;
        logger.error("[NAKAMA:" + requestId + "] Unhandled error in create_or_sync_user: " + err.message);
        logger.error("[NAKAMA:" + requestId + "] Stack trace: " + (err.stack || "N/A"));

        return JSON.stringify({
            success: false,
            error: "Internal server error during user creation/sync",
            errorCode: "INTERNAL_ERROR",
            details: err.message,
            executionTimeMs: executionTime,
            requestId: requestId,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Sanitize username to prevent injection and ensure compliance
 * @param {string} username - Raw username input
 * @returns {string} Sanitized username
 */
function sanitizeUsername(username) {
    if (!username || typeof username !== 'string') {
        return "Player";
    }

    // Remove leading/trailing whitespace
    var sanitized = username.trim();

    // Remove any characters that aren't alphanumeric, underscore, hyphen, or space
    sanitized = sanitized.replace(/[^a-zA-Z0-9_\- ]/g, '');

    // Collapse multiple spaces into one
    sanitized = sanitized.replace(/\s+/g, ' ');

    // Limit length
    if (sanitized.length > 20) {
        sanitized = sanitized.substring(0, 20);
    }

    // Ensure not empty after sanitization
    if (sanitized.length === 0) {
        sanitized = "Player";
    }

    return sanitized;
}

/**
 * Generate deterministic UUID v5 from device ID using SHA-1 hash
 * RFC 4122 compliant - same deviceId always produces same UUID
 * @param {string} deviceId - Device identifier string
 * @returns {string} Valid UUID v5 (RFC 4122)
 */
function generateDeterministicUUID(deviceId) {
    // Namespace UUID for device IDs (custom namespace)
    // Using ISO OID namespace as base: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
    var DEVICE_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

    // Validate input
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length === 0) {
        throw new Error("deviceId must be a non-empty string");
    }

    // Normalize deviceId to prevent case-sensitivity issues
    var normalizedDeviceId = deviceId.toLowerCase().trim();

    // Create a deterministic hash using simple but collision-resistant algorithm
    // Note: JavaScript doesn't have native SHA-1, so we use a strong custom hash
    var hash = deterministicHash(DEVICE_NAMESPACE + normalizedDeviceId);

    // Format as UUID v5 (RFC 4122)
    // Format: xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx
    // Where 5 = version, y = variant (8, 9, a, or b)
    var uuid =
        hash.substring(0, 8) + '-' +
        hash.substring(8, 12) + '-' +
        '5' + hash.substring(13, 16) + '-' +  // Version 5
        ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') +
        hash.substring(18, 20) + '-' +  // Variant bits
        hash.substring(20, 32);

    return uuid;
}

/**
 * Deterministic hash function for UUID generation
 * Based on FNV-1a algorithm (fast, good distribution)
 * @param {string} input - Input string to hash
 * @returns {string} 32-character hex hash
 */
function deterministicHash(input) {
    // FNV-1a hash parameters
    var FNV_PRIME = 0x01000193;
    var FNV_OFFSET = 0x811c9dc5;

    var hash = FNV_OFFSET;

    for (var i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = (hash * FNV_PRIME) >>> 0; // Keep as 32-bit unsigned
    }

    // Generate additional entropy for 128-bit UUID
    var hash2 = FNV_OFFSET;
    for (var i = input.length - 1; i >= 0; i--) {
        hash2 ^= input.charCodeAt(i) * (i + 1);
        hash2 = (hash2 * FNV_PRIME) >>> 0;
    }

    var hash3 = FNV_OFFSET;
    for (var i = 0; i < input.length; i += 2) {
        hash3 ^= input.charCodeAt(i) + (input.charCodeAt(i + 1) || 0);
        hash3 = (hash3 * FNV_PRIME) >>> 0;
    }

    var hash4 = FNV_OFFSET;
    for (var i = 1; i < input.length; i += 2) {
        hash4 ^= input.charCodeAt(i) * 31;
        hash4 = (hash4 * FNV_PRIME) >>> 0;
    }

    // Combine hashes to create 128-bit output
    return (
        hash.toString(16).padStart(8, '0') +
        hash2.toString(16).padStart(8, '0') +
        hash3.toString(16).padStart(8, '0') +
        hash4.toString(16).padStart(8, '0')
    );
}

/**
 * Get or create userId for device with proper persistence and caching
 * Implements idempotent device-to-user mapping with race condition protection
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} deviceId - Device identifier
 * @param {object} ctx - Request context
 * @returns {string} Valid UUID for user
 */
function getOrCreateUserIdForDevice(nk, logger, deviceId, ctx) {
    // Input validation
    if (!deviceId || typeof deviceId !== 'string') {
        throw new Error("deviceId must be a valid string");
    }

    // Normalize deviceId
    var normalizedDeviceId = deviceId.trim();

    // Check if deviceId is already a valid UUID (e.g., from Cognito)
    if (isValidUUID(normalizedDeviceId)) {
        logger.info("[UserId] DeviceId is already valid UUID: " + normalizedDeviceId);
        return normalizedDeviceId;
    }

    // Check if user is already authenticated via Nakama
    if (ctx.userId && isValidUUID(ctx.userId)) {
        logger.info("[UserId] Using authenticated ctx.userId: " + ctx.userId);

        // Update mapping to link this device to authenticated user
        try {
            linkDeviceToUser(nk, logger, normalizedDeviceId, ctx.userId);
        } catch (linkErr) {
            logger.warn("[UserId] Failed to link device to user: " + linkErr.message);
        }

        return ctx.userId;
    }

    // Try to read existing device-to-user mapping
    var collection = "device_user_mappings";
    var mappingKey = "device_" + normalizedDeviceId;
    var systemUserId = "00000000-0000-0000-0000-000000000000";

    try {
        var records = nk.storageRead([{
            collection: collection,
            key: mappingKey,
            userId: systemUserId
        }]);

        if (records && records.length > 0 && records[0].value) {
            var mapping = records[0].value;
            var existingUserId = mapping.userId;

            // Validate stored userId
            if (isValidUUID(existingUserId)) {
                logger.info("[UserId] Retrieved existing mapping: device=" + normalizedDeviceId + " -> user=" + existingUserId);

                // Update last_seen timestamp (unconditional overwrite)
                try {
                    mapping.lastSeen = new Date().toISOString();
                    mapping.accessCount = (mapping.accessCount || 0) + 1;

                    nk.storageWrite([{
                        collection: collection,
                        key: mappingKey,
                        userId: systemUserId,
                        value: mapping,
                        permissionRead: 1,
                        permissionWrite: 0
                    }]);
                } catch (updateErr) {
                    logger.debug("[UserId] Failed to update mapping timestamp: " + updateErr.message);
                }

                return existingUserId;
            } else {
                logger.warn("[UserId] Stored userId is invalid, regenerating: " + existingUserId);
            }
        }
    } catch (readErr) {
        logger.debug("[UserId] No existing device mapping found: " + readErr.message);
    }

    // Generate new deterministic UUID for this device
    var newUserId = generateDeterministicUUID(normalizedDeviceId);

    logger.info("[UserId] Generated new userId: " + newUserId + " for device: " + normalizedDeviceId);

    // Store mapping with metadata
    var mapping = {
        deviceId: normalizedDeviceId,
        userId: newUserId,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        accessCount: 1,
        version: "1.0"
    };

    try {
        nk.storageWrite([{
            collection: collection,
            key: mappingKey,
            userId: systemUserId,
            value: mapping,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[UserId] Stored device-to-user mapping successfully");
    } catch (writeErr) {
        logger.error("[UserId] CRITICAL: Failed to store device mapping: " + writeErr.message);
    }

    // Create reverse mapping (user -> devices) for audit trail
    try {
        createReverseMapping(nk, logger, newUserId, normalizedDeviceId);
    } catch (reverseErr) {
        logger.warn("[UserId] Failed to create reverse mapping: " + reverseErr.message);
    }

    return newUserId;
}

/**
 * Link device to authenticated user
 * Handles device migration when user logs in with Cognito
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} deviceId - Device identifier
 * @param {string} userId - Authenticated user ID
 */
function linkDeviceToUser(nk, logger, deviceId, userId) {
    var collection = "device_user_mappings";
    var mappingKey = "device_" + deviceId;
    var systemUserId = "00000000-0000-0000-0000-000000000000";

    // Read existing mapping to preserve accessCount
    var existingMapping = null;
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: mappingKey,
            userId: systemUserId
        }]);
        if (records && records.length > 0 && records[0].value) {
            existingMapping = records[0].value;
        }
    } catch (readErr) {
        // No existing mapping
    }

    var mapping = {
        deviceId: deviceId,
        userId: userId,
        createdAt: existingMapping ? existingMapping.createdAt : new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        accessCount: (existingMapping ? (existingMapping.accessCount || 0) : 0) + 1,
        linkedVia: "authentication",
        version: "1.0"
    };

    nk.storageWrite([{
        collection: collection,
        key: mappingKey,
        userId: systemUserId,
        value: mapping,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info("[UserId] Linked device " + deviceId + " to authenticated user " + userId);
}

/**
 * Create reverse mapping from user to devices
 * Useful for security audits and device management
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} deviceId - Device identifier
 */
function createReverseMapping(nk, logger, userId, deviceId) {
    var collection = "user_devices_mappings";
    var key = "user_" + userId;
    var systemUserId = "00000000-0000-0000-0000-000000000000";

    // Read existing devices for this user
    var devices = [];
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: systemUserId
        }]);

        if (records && records.length > 0 && records[0].value) {
            devices = records[0].value.devices || [];
        }
    } catch (err) {
        logger.debug("[ReverseMapping] No existing device list");
    }

    // Add device if not already in list
    var deviceExists = false;
    for (var i = 0; i < devices.length; i++) {
        if (devices[i].deviceId === deviceId) {
            devices[i].lastSeen = new Date().toISOString();
            deviceExists = true;
            break;
        }
    }

    if (!deviceExists) {
        devices.push({
            deviceId: deviceId,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString()
        });
    }

    // Store updated device list
    nk.storageWrite([{
        collection: collection,
        key: key,
        userId: systemUserId,
        value: {
            userId: userId,
            devices: devices,
            updatedAt: new Date().toISOString()
        },
        permissionRead: 1,
        permissionWrite: 0,
        version: "*"
    }]);
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

        // Use context userId if available, otherwise use device_id as userId
        var userId = ctx.userId || deviceId;

        // Fetch actual username from Nakama account (players tab) instead of using identity.username
        var username = identity.username; // Fallback to identity username
        try {
            var users = nk.usersGetId([userId]);
            if (users && users.length > 0 && users[0].username) {
                username = users[0].username;
            }
        } catch (userErr) {
            logger.warn("[NAKAMA] Could not fetch user account, using identity username: " + userErr.message);
        }

        // CRITICAL: Calculate adaptive reward based on game-specific rules
        // This ensures wallet is NEVER set equal to score
        var rewardCalc = calculateScoreReward(gameId, score, data.current_streak || 0);

        logger.info("[NAKAMA] Score: " + score + ", Calculated Reward: " + rewardCalc.reward + " " + rewardCalc.currency);
        if (rewardCalc.bonuses && rewardCalc.bonuses.length > 0) {
            logger.info("[NAKAMA] Bonuses applied: " + JSON.stringify(rewardCalc.bonuses));
        }

        // Write score to all leaderboards
        var leaderboardsUpdated = writeToAllLeaderboards(nk, logger, userId, username, gameId, score);

        // Update game wallet balance with CALCULATED REWARD (not raw score)
        var updatedWallet = updateGameWalletBalance(nk, logger, deviceId, gameId, rewardCalc.reward);

        return JSON.stringify({
            success: true,
            score: score,
            reward_earned: rewardCalc.reward,
            reward_currency: rewardCalc.currency,
            reward_details: rewardCalc.details,
            bonuses: rewardCalc.bonuses,
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

        // Enrich records with avatar URLs from user accounts
        try {
            // Collect all unique owner IDs from all leaderboards
            var ownerIdSet = {};
            for (var lbKey in leaderboards) {
                var lb = leaderboards[lbKey];
                if (lb.records) {
                    for (var r = 0; r < lb.records.length; r++) {
                        if (lb.records[r].ownerId) {
                            ownerIdSet[lb.records[r].ownerId] = true;
                        }
                    }
                }
                if (lb.user_record && lb.user_record.ownerId) {
                    ownerIdSet[lb.user_record.ownerId] = true;
                }
            }
            
            var ownerIdList = Object.keys(ownerIdSet);
            if (ownerIdList.length > 0) {
                var userAccounts = nk.accountsGetId(ownerIdList);
                // Build lookup map: userId -> avatarUrl
                var avatarMap = {};
                if (userAccounts) {
                    for (var a = 0; a < userAccounts.length; a++) {
                        if (userAccounts[a] && userAccounts[a].user) {
                            avatarMap[userAccounts[a].user.id] = userAccounts[a].user.avatarUrl || "";
                        }
                    }
                }
                
                // Inject avatarUrl into all records
                for (var lbKey2 in leaderboards) {
                    var lb2 = leaderboards[lbKey2];
                    if (lb2.records) {
                        for (var r2 = 0; r2 < lb2.records.length; r2++) {
                            lb2.records[r2].avatarUrl = avatarMap[lb2.records[r2].ownerId] || "";
                        }
                    }
                    if (lb2.user_record && lb2.user_record.ownerId) {
                        lb2.user_record.avatarUrl = avatarMap[lb2.user_record.ownerId] || "";
                    }
                }
                
                logger.info("[NAKAMA] Enriched " + ownerIdList.length + " leaderboard users with avatar URLs");
            }
        } catch (avatarErr) {
            logger.warn("[NAKAMA] Failed to enrich leaderboard avatars (non-fatal): " + avatarErr.message);
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
// QUIZVERSE MULTIPLAYER-SPECIFIC RPCs
// ============================================================================

/**
 * RPC: quizverse_submit_score
 * Submit score with quiz-specific validation and metadata
 */
function rpcQuizVerseSubmitScore(context, logger, nk, payload) {
    try {
        var data = JSON.parse(payload);
        var userId = context.userId;
        var username = context.username || "Anonymous";

        if (typeof data.score !== 'number') {
            return JSON.stringify({ success: false, error: "Score is required and must be a number" });
        }

        var score = data.score;
        var leaderboardId = data.leaderboard_id || "quizverse_global";
        var subscore = data.subscore || 0;
        var metadata = data.metadata || {};

        metadata.submittedAt = new Date().toISOString();
        metadata.userId = userId;
        metadata.username = username;

        logger.info("[QuizVerse-MP] Score submission: " + username + " => " + score + " pts (LB: " + leaderboardId + ")");
        if (metadata.isMultiplayer) {
            logger.info("[QuizVerse-MP] Multiplayer match: Room=" + metadata.roomCode + ", Players=" + metadata.playerCount);
        }

        try {
            nk.leaderboardCreate(leaderboardId, true, "desc", "best", "", { gameId: "quizverse" });
        } catch (err) { /* Leaderboard exists */ }

        nk.leaderboardRecordWrite(leaderboardId, userId, username, score, subscore, metadata);
        logger.info("[QuizVerse-MP] âœ“ Score written successfully");

        return JSON.stringify({ success: true, data: { score: score, leaderboardId: leaderboardId, userId: userId, username: username } });
    } catch (err) {
        logger.error("[QuizVerse-MP] quizverse_submit_score error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: quizverse_get_leaderboard
 * Get leaderboard records for QuizVerse
 */
function rpcQuizVerseGetLeaderboard(context, logger, nk, payload) {
    try {
        var data = JSON.parse(payload);
        var leaderboardId = data.leaderboard_id || "quizverse_global";
        var limit = data.limit || 10;
        var cursor = data.cursor || null;
        var ownerIds = data.owner_ids || null;

        logger.info("[QuizVerse-MP] Fetching leaderboard: " + leaderboardId + " (limit: " + limit + ")");

        var records = nk.leaderboardRecordsList(leaderboardId, ownerIds, limit, cursor, 0);

        var transformedRecords = [];
        if (records && records.records) {
            for (var i = 0; i < records.records.length; i++) {
                var record = records.records[i];
                transformedRecords.push({
                    user_id: record.ownerId,
                    username: record.username || "Unknown",
                    score: record.score,
                    subscore: record.subscore,
                    rank: record.rank,
                    metadata: record.metadata || {},
                    create_time: record.createTime,
                    update_time: record.updateTime
                });
            }
        }

        logger.info("[QuizVerse-MP] âœ“ Fetched " + transformedRecords.length + " records");

        return JSON.stringify({
            success: true,
            data: {
                leaderboard_id: leaderboardId,
                records: transformedRecords,
                prev_cursor: records.prevCursor || "",
                next_cursor: records.nextCursor || ""
            }
        });
    } catch (err) {
        logger.error("[QuizVerse-MP] quizverse_get_leaderboard error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: quizverse_submit_multiplayer_match
 * Submit complete multiplayer match data with all participants
 */
function rpcQuizVerseSubmitMultiplayerMatch(context, logger, nk, payload) {
    try {
        var data = JSON.parse(payload);
        var userId = context.userId;
        var username = context.username || "Anonymous";

        if (!data.roomCode || !data.participants || data.participants.length === 0) {
            return JSON.stringify({ success: false, error: "roomCode and participants required" });
        }

        var roomCode = data.roomCode;
        var matchDuration = data.matchDuration || 0;
        var topics = data.topics || [];
        var participants = data.participants;

        logger.info("[QuizVerse-MP] Match: Room=" + roomCode + ", Duration=" + matchDuration + "s, Players=" + participants.length);

        var matchData = {
            roomCode: roomCode,
            matchDuration: matchDuration,
            topics: topics,
            participants: participants,
            submittedBy: userId,
            submittedByUsername: username,
            submittedAt: new Date().toISOString()
        };

        var key = "match_" + roomCode + "_" + Date.now();
        nk.storageWrite([{
            collection: "quizverse_matches",
            key: key,
            userId: userId,
            value: matchData,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[QuizVerse-MP] âœ“ Match data stored: " + key);

        return JSON.stringify({ success: true, data: { matchKey: key, roomCode: roomCode, participantsCount: participants.length } });
    } catch (err) {
        logger.error("[QuizVerse-MP] quizverse_submit_multiplayer_match error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// INIT MODULE - ENTRY POINT
// ============================================================================



// ============================================================================
// COPILOT INITIALIZATION
// ============================================================================

// ============================================================================
// NEW SYSTEMS - ACHIEVEMENTS
// ============================================================================
// Note: Full implementation in achievements/achievements.js
// These are placeholder declarations - actual code should be loaded from modules

var rpcAchievementsGetAll;
var rpcAchievementsUpdateProgress;
var rpcAchievementsCreateDefinition;
var rpcAchievementsBulkCreate;

// ============================================================================
// NEW SYSTEMS - MATCHMAKING
// ============================================================================
// Note: Full implementation in matchmaking/matchmaking.js

var rpcMatchmakingFindMatch;
var rpcMatchmakingCancel;
var rpcMatchmakingGetStatus;
var rpcMatchmakingCreateParty;
var rpcMatchmakingJoinParty;

// ============================================================================
// NEW SYSTEMS - TOURNAMENTS
// ============================================================================
// Note: Full implementation in tournaments/tournaments.js

var rpcTournamentCreate;
var rpcTournamentJoin;
var rpcTournamentListActive;
var rpcTournamentSubmitScore;
var rpcTournamentGetLeaderboard;
var rpcTournamentClaimRewards;

// ============================================================================
// NEW SYSTEMS - INFRASTRUCTURE
// ============================================================================
// Note: Full implementations in infrastructure/*.js

var rpcBatchExecute;
var rpcBatchWalletOperations;
var rpcBatchAchievementProgress;
var rpcRateLimitStatus;
var rpcCacheStats;
var rpcCacheClear;

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
        logger.info('âœ“ Registered RPC: submit_score_sync');
    } catch (err) {
        logger.error('âœ— Failed to register submit_score_sync: ' + err.message);
    }

    // Register leaderboard_aggregate RPCs
    try {
        initializer.registerRpc('submit_score_with_aggregate', rpcSubmitScoreWithAggregate);
        logger.info('âœ“ Registered RPC: submit_score_with_aggregate');
    } catch (err) {
        logger.error('âœ— Failed to register submit_score_with_aggregate: ' + err.message);
    }

    // Register leaderboard_friends RPCs
    try {
        initializer.registerRpc('create_all_leaderboards_with_friends', rpcCreateAllLeaderboardsWithFriends);
        logger.info('âœ“ Registered RPC: create_all_leaderboards_with_friends');
    } catch (err) {
        logger.error('âœ— Failed to register create_all_leaderboards_with_friends: ' + err.message);
    }

    try {
        initializer.registerRpc('submit_score_with_friends_sync', rpcSubmitScoreWithFriendsSync);
        logger.info('âœ“ Registered RPC: submit_score_with_friends_sync');
    } catch (err) {
        logger.error('âœ— Failed to register submit_score_with_friends_sync: ' + err.message);
    }

    try {
        initializer.registerRpc('get_friend_leaderboard', rpcGetFriendLeaderboard);
        logger.info('âœ“ Registered RPC: get_friend_leaderboard');
    } catch (err) {
        logger.error('âœ— Failed to register get_friend_leaderboard: ' + err.message);
    }

    // Register social_features RPCs
    try {
        initializer.registerRpc('send_friend_invite', rpcSendFriendInvite);
        logger.info('âœ“ Registered RPC: send_friend_invite');
    } catch (err) {
        logger.error('âœ— Failed to register send_friend_invite: ' + err.message);
    }

    try {
        initializer.registerRpc('accept_friend_invite', rpcAcceptFriendInvite);
        logger.info('âœ“ Registered RPC: accept_friend_invite');
    } catch (err) {
        logger.error('âœ— Failed to register accept_friend_invite: ' + err.message);
    }

    try {
        initializer.registerRpc('decline_friend_invite', rpcDeclineFriendInvite);
        logger.info('âœ“ Registered RPC: decline_friend_invite');
    } catch (err) {
        logger.error('âœ— Failed to register decline_friend_invite: ' + err.message);
    }

    try {
        initializer.registerRpc('get_notifications', rpcGetNotifications);
        logger.info('âœ“ Registered RPC: get_notifications');
    } catch (err) {
        logger.error('âœ— Failed to register get_notifications: ' + err.message);
    }

    logger.info('========================================');
    logger.info('Copilot Leaderboard Modules Loaded Successfully');
    logger.info('========================================');
}

// ============================================================================
// PLAYER METADATA SYSTEM - Track user identity across games
// ============================================================================

/**
 * Update or create player metadata with cognito info and game tracking
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID (from ctx.userId or deviceId)
 * @param {string} gameId - Game ID (UUID)
 * @param {object} metadata - Player metadata from client (cognito_user_id, email, etc.)
 * @returns {object} Updated player metadata
 */
function updatePlayerMetadata(nk, logger, userId, gameId, metadata) {
    var collection = "player_data";
    var key = "player_metadata:" + userId;
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

    logger.info("[PlayerMetadata] Updating metadata for user: " + userId + " game: " + gameId);

    // Read existing metadata (try system-owned key first, fall back to legacy user-owned key)
    var playerMeta;
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: SYSTEM_USER
        }]);

        if (records && records.length > 0 && records[0].value) {
            playerMeta = records[0].value;
            logger.info("[PlayerMetadata] Found existing metadata for user " + userId);
        } else {
            // Try legacy key format (user-owned, no userId in key)
            try {
                var legacyRecords = nk.storageRead([{
                    collection: collection,
                    key: "player_metadata",
                    userId: userId
                }]);
                if (legacyRecords && legacyRecords.length > 0 && legacyRecords[0].value) {
                    playerMeta = legacyRecords[0].value;
                    logger.info("[PlayerMetadata] Migrated metadata from legacy format for user " + userId);
                }
            } catch (legacyErr) {
                // Legacy read may fail if userId doesn't exist in users table
            }

            if (!playerMeta) {
                playerMeta = {
                    user_id: userId,
                    created_at: new Date().toISOString(),
                    games: []
                };
                logger.info("[PlayerMetadata] Creating new metadata for user " + userId);
            }
        }
    } catch (err) {
        logger.warn("[PlayerMetadata] Failed to read metadata: " + err.message);
        playerMeta = {
            user_id: userId,
            created_at: new Date().toISOString(),
            games: []
        };
    }

    // Update cognito and account info if provided
    if (metadata) {
        if (metadata.cognito_user_id) playerMeta.cognito_user_id = metadata.cognito_user_id;
        if (metadata.email) playerMeta.email = metadata.email;
        if (metadata.first_name) playerMeta.first_name = metadata.first_name;
        if (metadata.last_name) playerMeta.last_name = metadata.last_name;
        if (metadata.role) playerMeta.role = metadata.role;
        if (metadata.login_type) playerMeta.login_type = metadata.login_type;
        if (metadata.idp_username) playerMeta.idp_username = metadata.idp_username;
        if (metadata.account_status) playerMeta.account_status = metadata.account_status;
        if (metadata.wallet_address) playerMeta.wallet_address = metadata.wallet_address;
        if (metadata.is_adult) playerMeta.is_adult = metadata.is_adult;
    }

    // Track gameId
    if (!playerMeta.games) playerMeta.games = [];
    var gameIndex = -1;
    for (var i = 0; i < playerMeta.games.length; i++) {
        if (playerMeta.games[i].game_id === gameId) {
            gameIndex = i;
            break;
        }
    }

    var now = new Date().toISOString();
    if (gameIndex >= 0) {
        // Update existing game entry
        playerMeta.games[gameIndex].last_played = now;
        playerMeta.games[gameIndex].play_count = (playerMeta.games[gameIndex].play_count || 0) + 1;
    } else {
        // Add new game entry
        playerMeta.games.push({
            game_id: gameId,
            first_played: now,
            last_played: now,
            play_count: 1
        });
    }

    playerMeta.updated_at = now;
    playerMeta.total_games = playerMeta.games.length;

    // Write metadata to storage using system user to avoid FK violations
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: SYSTEM_USER,
            value: playerMeta,
            permissionRead: 2,
            permissionWrite: 0
        }]);

        logger.info("[PlayerMetadata] Saved metadata for user " + userId + " (" + playerMeta.total_games + " games)");

        // Update account metadata only if user exists in Nakama
        // Signature: accountUpdateId(userId, username, displayName, timezone, location, langTag, avatarUrl, metadata)
        try {
            var users = nk.usersGetId([userId]);
            if (users && users.length > 0) {
                nk.accountUpdateId(userId, null, null, null, null, null, null, {
                    cognito_user_id: String(playerMeta.cognito_user_id || ""),
                    email: String(playerMeta.email || ""),
                    total_games: String(playerMeta.total_games || 0),
                    last_game_id: String(gameId || "")
                });
            }
        } catch (acctErr) {
            logger.debug("[PlayerMetadata] Could not update account metadata (user may not exist): " + acctErr.message);
        }
    } catch (err) {
        logger.error("[PlayerMetadata] Failed to write metadata: " + err.message);
        throw err;
    }

    return playerMeta;
}

/**
 * RPC: get_player_portfolio
 * Get all games played by user with wallet balances and stats
 */
function rpcGetPlayerPortfolio(ctx, logger, nk, payload) {
    logger.info('[RPC] get_player_portfolio called');

    try {
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({
                success: false,
                error: 'User not authenticated'
            });
        }

        // Get player metadata (try new system-user key, fall back to legacy)
        var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
        var metadata;
        try {
            var records = nk.storageRead([{
                collection: "player_data",
                key: "player_metadata:" + userId,
                userId: SYSTEM_USER
            }]);

            if (records && records.length > 0 && records[0].value) {
                metadata = records[0].value;
            } else {
                // Fall back to legacy format
                try {
                    var legacyRecords = nk.storageRead([{
                        collection: "player_data",
                        key: "player_metadata",
                        userId: userId
                    }]);
                    if (legacyRecords && legacyRecords.length > 0 && legacyRecords[0].value) {
                        metadata = legacyRecords[0].value;
                    }
                } catch (legacyErr) {
                    // Legacy read may fail
                }
            }

            if (!metadata) {
                return JSON.stringify({
                    success: false,
                    error: 'No player metadata found'
                });
            }
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: 'Failed to read metadata: ' + err.message
            });
        }

        // Get wallet balances for each game
        var gamesWithWallets = [];
        for (var i = 0; i < metadata.games.length; i++) {
            var game = metadata.games[i];
            var walletKey = "wallet:" + userId + ":" + game.game_id;

            try {
                var walletRecords = nk.storageRead([{
                    collection: "quizverse",
                    key: walletKey,
                    userId: SYSTEM_USER
                }]);

                if (walletRecords && walletRecords.length > 0) {
                    game.wallet = walletRecords[0].value;
                }
            } catch (walletErr) {
                logger.warn("[Portfolio] Could not read wallet for game " + game.game_id);
            }

            gamesWithWallets.push(game);
        }

        // Get global wallet
        var globalWallet;
        try {
            var globalRecords = nk.storageRead([{
                collection: "quizverse",
                key: "wallet:" + userId + ":global",
                userId: userId
            }]);

            if (globalRecords && globalRecords.length > 0) {
                globalWallet = globalRecords[0].value;
            }
        } catch (globalErr) {
            logger.warn("[Portfolio] Could not read global wallet");
        }

        return JSON.stringify({
            success: true,
            user_id: userId,
            cognito_user_id: metadata.cognito_user_id,
            email: metadata.email,
            account_status: metadata.account_status,
            total_games: metadata.total_games,
            games: gamesWithWallets,
            global_wallet: globalWallet,
            created_at: metadata.created_at,
            updated_at: metadata.updated_at
        });

    } catch (err) {
        logger.error('[RPC] get_player_portfolio - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: update_player_metadata
 * Update player metadata with cognito info
 */
function OldrpcUpdatePlayerMetadata(ctx, logger, nk, payload) {
    logger.info('[RPC] update_player_metadata called');

    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId || data.device_id;

        if (!userId) {
            return JSON.stringify({
                success: false,
                error: 'user_id or device_id required'
            });
        }

        if (!data.game_id) {
            return JSON.stringify({
                success: false,
                error: 'game_id is required'
            });
        }

        var metadata = updatePlayerMetadata(nk, logger, userId, data.game_id, data);

        return JSON.stringify({
            success: true,
            metadata: metadata
        });

    } catch (err) {
        logger.error('[RPC] update_player_metadata - Error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
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

/**
 * RPC: check_geo_and_update_profile
 * Validates geolocation, calls Google Maps Reverse Geocoding API,
 * applies business logic, and updates user metadata
 *
 * @param {object} ctx - Nakama context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON: { latitude: float, longitude: float }
 * @returns {string} JSON response with allowed status and location details
 *
 * Example payload:
 * {
 *   "latitude": 29.7604,
 *   "longitude": -95.3698
 * }
 *
 * Example response (allowed):
 * {
 *   "allowed": true,
 *   "country": "US",
 *   "region": "Texas",
 *   "city": "Houston",
 *   "reason": null
 * }
 *
 * Example response (blocked):
 * {
 *   "allowed": false,
 *   "country": "DE",
 *   "region": "Berlin",
 *   "city": "Berlin",
 *   "reason": "Region not supported"
 * }
 */
function rpcCheckGeoAndUpdateProfile(ctx, logger, nk, payload) {
    logger.info('[RPC] check_geo_and_update_profile called');

    try {
        // 2.1 Validate input
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: 'Authentication required'
            });
        }

        var data = JSON.parse(payload || '{}');

        // Ensure latitude and longitude exist
        if (data.latitude === undefined || data.latitude === null) {
            return JSON.stringify({
                success: false,
                error: 'latitude is required'
            });
        }

        if (data.longitude === undefined || data.longitude === null) {
            return JSON.stringify({
                success: false,
                error: 'longitude is required'
            });
        }

        // Ensure values are numeric
        var latitude = Number(data.latitude);
        var longitude = Number(data.longitude);

        if (isNaN(latitude) || isNaN(longitude)) {
            return JSON.stringify({
                success: false,
                error: 'latitude and longitude must be numeric values'
            });
        }

        // Ensure they fall within valid GPS ranges
        if (latitude < -90 || latitude > 90) {
            return JSON.stringify({
                success: false,
                error: 'latitude must be between -90 and 90'
            });
        }

        if (longitude < -180 || longitude > 180) {
            return JSON.stringify({
                success: false,
                error: 'longitude must be between -180 and 180'
            });
        }

        logger.info('[RPC] check_geo_and_update_profile - Valid coordinates: ' + latitude + ', ' + longitude);

        // 2.2 Call Google Maps Reverse Geocoding API
        var apiKey = ctx.env ? ctx.env["GOOGLE_MAPS_API_KEY"] : null;

        if (!apiKey) {
            logger.debug('[RPC] check_geo_and_update_profile - GOOGLE_MAPS_API_KEY not configured, returning allowed without geo data');
            return JSON.stringify({
                success: true,
                allowed: true,
                country: null,
                region: null,
                city: null,
                reason: 'Geocoding service not configured - location check skipped'
            });
        }

        var geocodeUrl = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' +
            latitude + ',' + longitude + '&key=' + apiKey;

        var geocodeResponse;
        try {
            geocodeResponse = nk.httpRequest(
                geocodeUrl,
                'get',
                {
                    'Accept': 'application/json'
                }
            );
        } catch (err) {
            logger.error('[RPC] check_geo_and_update_profile - Geocoding API request failed: ' + err.message);
            return JSON.stringify({
                success: false,
                error: 'Failed to connect to geocoding service'
            });
        }

        if (geocodeResponse.code !== 200) {
            logger.error('[RPC] check_geo_and_update_profile - Geocoding API returned code ' + geocodeResponse.code);
            return JSON.stringify({
                success: false,
                error: 'Geocoding service returned error code ' + geocodeResponse.code
            });
        }

        // 2.3 Parse Response
        var geocodeData;
        try {
            geocodeData = JSON.parse(geocodeResponse.body);
        } catch (err) {
            logger.error('[RPC] check_geo_and_update_profile - Failed to parse geocoding response: ' + err.message);
            return JSON.stringify({
                success: false,
                error: 'Invalid response from geocoding service'
            });
        }

        if (geocodeData.status !== 'OK' || !geocodeData.results || geocodeData.results.length === 0) {
            logger.warn('[RPC] check_geo_and_update_profile - No results from geocoding API: ' + geocodeData.status);
            return JSON.stringify({
                success: false,
                error: 'Could not determine location from coordinates'
            });
        }

        // Extract country, region, and city from address_components
        var country = null;
        var region = null;
        var city = null;
        var countryCode = null;

        var addressComponents = geocodeData.results[0].address_components;

        for (var i = 0; i < addressComponents.length; i++) {
            var component = addressComponents[i];
            var types = component.types;

            // Country
            if (types.indexOf('country') !== -1) {
                country = component.long_name;
                countryCode = component.short_name;
            }

            // Region/State
            if (types.indexOf('administrative_area_level_1') !== -1) {
                region = component.long_name;
            }

            // City
            if (types.indexOf('locality') !== -1) {
                city = component.long_name;
            }
        }

        logger.info('[RPC] check_geo_and_update_profile - Parsed location: ' +
            'Country=' + (country || 'N/A') +
            ', Region=' + (region || 'N/A') +
            ', City=' + (city || 'N/A'));

        // 2.4 Apply Business Logic
        var blockedCountries = ['FR', 'DE'];
        var allowed = true;
        var reason = null;

        if (countryCode && blockedCountries.indexOf(countryCode) !== -1) {
            allowed = false;
            reason = 'Region not supported';
            logger.info('[RPC] check_geo_and_update_profile - Country ' + countryCode + ' is blocked');
        }

        // 2.5 Update Nakama User Metadata
        var userId = ctx.userId;

        // Read existing metadata
        var collection = "player_data";
        var key = "player_metadata";
        var playerMeta;

        try {
            var records = nk.storageRead([{
                collection: collection,
                key: key,
                userId: userId
            }]);

            if (records && records.length > 0 && records[0].value) {
                playerMeta = records[0].value;
                logger.info('[RPC] check_geo_and_update_profile - Found existing metadata for user');
            } else {
                playerMeta = {
                    user_id: userId,
                    created_at: new Date().toISOString()
                };
                logger.info('[RPC] check_geo_and_update_profile - Creating new metadata for user');
            }
        } catch (err) {
            logger.warn('[RPC] check_geo_and_update_profile - Failed to read metadata: ' + err.message);
            playerMeta = {
                user_id: userId,
                created_at: new Date().toISOString()
            };
        }

        // Update location fields
        playerMeta.latitude = latitude;
        playerMeta.longitude = longitude;
        playerMeta.country = country;
        playerMeta.region = region;
        playerMeta.city = city;
        playerMeta.location_updated_at = new Date().toISOString();

        // Write updated metadata
        try {
            nk.storageWrite([{
                collection: collection,
                key: key,
                userId: userId,
                value: playerMeta,
                permissionRead: 1,
                permissionWrite: 0,
                version: "*"
            }]);

            logger.info('[RPC] check_geo_and_update_profile - Updated metadata for user ' + userId);

            // Also update account metadata for quick access
            try {
                nk.accountUpdateId(userId, null, {
                    latitude: latitude,
                    longitude: longitude,
                    country: country,
                    region: region,
                    city: city
                }, null, null, null, null);
            } catch (acctErr) {
                logger.warn('[RPC] check_geo_and_update_profile - Could not update account: ' + acctErr.message);
            }
        } catch (err) {
            logger.error('[RPC] check_geo_and_update_profile - Failed to write metadata: ' + err.message);
            return JSON.stringify({
                success: false,
                error: 'Failed to update user profile with location data'
            });
        }

        logger.info('[RPC] check_geo_and_update_profile - Complete. Allowed: ' + allowed);

        // Return result
        return JSON.stringify({
            allowed: allowed,
            country: countryCode,
            region: region,
            city: city,
            reason: reason
        });

    } catch (err) {
        logger.error('[RPC] check_geo_and_update_profile - Error: ' + err.message);
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
        messages.sort(function (a, b) {
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
        messages.sort(function (a, b) {
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
        messages.sort(function (a, b) {
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

// ============================================================================
// GUEST USER METADATA CLEANUP
// ============================================================================

/**
 * Clean up player metadata and device mappings for guest users.
 * Guest users are identified by:
 * - is_guest flag set to true in their metadata
 * - Username starting with "guest_test_" pattern
 * - role === "guest" in metadata
 * - login_type === "guest" in metadata
 *
 * This function also cleans up:
 * - device_user_mappings entries for guest users
 *
 * This function should be called daily to clean up guest user data.
 *
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload (optional, can include { dryRun: boolean, limit: number })
 * @returns {string} JSON response with cleanup results
 */
function rpcCleanupGuestUserMetadata(ctx, logger, nk, payload) {
    logger.info("[GuestCleanup] Starting guest user metadata cleanup job");

    var dryRun = false;
    var limit = 1000;

    // Parse optional payload
    if (payload && payload !== "") {
        try {
            var data = JSON.parse(payload);
            if (data.dryRun !== undefined) {
                dryRun = !!data.dryRun;
            }
            if (data.limit !== undefined && data.limit > 0) {
                limit = Math.min(data.limit, 10000);
            }
        } catch (err) {
            logger.warn("[GuestCleanup] Invalid payload, using defaults: " + err.message);
        }
    }

    var collection = PLAYER_METADATA_COLLECTION;
    var deletedCount = 0;
    var deviceMappingsDeleted = 0;
    var processedCount = 0;
    var guestUsersFound = [];
    var errors = [];

    try {
        // List all player metadata records
        var cursor = null;
        var hasMore = true;

        while (hasMore && processedCount < limit) {
            var batchSize = Math.min(100, limit - processedCount);
            var result = nk.storageList(null, collection, batchSize, cursor);

            if (!result || !result.objects || result.objects.length === 0) {
                hasMore = false;
                break;
            }

            for (var i = 0; i < result.objects.length; i++) {
                var obj = result.objects[i];
                processedCount++;

                var isGuestUser = false;
                var guestReason = "";
                var deviceIds = [];

                // Check if metadata has is_guest flag
                if (obj.value && obj.value.is_guest === true) {
                    isGuestUser = true;
                    guestReason = "is_guest flag";
                }

                // Check if role === "guest" in metadata
                if (!isGuestUser && obj.value && obj.value.role === "guest") {
                    isGuestUser = true;
                    guestReason = "role=guest";
                }

                // Check if login_type === "guest" in metadata
                if (!isGuestUser && obj.value && obj.value.login_type === "guest") {
                    isGuestUser = true;
                    guestReason = "login_type=guest";
                }

                // If not identified by metadata flags, check username pattern
                if (!isGuestUser && obj.userId) {
                    try {
                        var users = nk.usersGetId([obj.userId]);
                        if (users && users.length > 0) {
                            var username = users[0].username;
                            if (username && username.indexOf(GUEST_USER_USERNAME_PREFIX) === 0) {
                                isGuestUser = true;
                                guestReason = "username pattern (" + GUEST_USER_USERNAME_PREFIX + "*)";
                            }
                        }
                    } catch (userErr) {
                        logger.warn("[GuestCleanup] Failed to get user info for " + obj.userId + ": " + userErr.message);
                    }
                }

                // Collect device IDs from metadata for cleanup
                if (isGuestUser && obj.value) {
                    // Get device_id from metadata
                    if (obj.value.device_id) {
                        deviceIds.push(obj.value.device_id);
                    }
                    if (obj.value.current_device_id && obj.value.current_device_id !== obj.value.device_id) {
                        deviceIds.push(obj.value.current_device_id);
                    }
                    // Get device IDs from devices array
                    if (obj.value.devices && Array.isArray(obj.value.devices)) {
                        for (var d = 0; d < obj.value.devices.length; d++) {
                            var dev = obj.value.devices[d];
                            if (dev.device_id && deviceIds.indexOf(dev.device_id) === -1) {
                                deviceIds.push(dev.device_id);
                            }
                        }
                    }
                }

                if (isGuestUser) {
                    guestUsersFound.push({
                        userId: obj.userId,
                        key: obj.key,
                        reason: guestReason,
                        deviceIds: deviceIds
                    });

                    if (!dryRun) {
                        // Delete player metadata
                        try {
                            nk.storageDelete([{
                                collection: collection,
                                key: obj.key,
                                userId: obj.userId
                            }]);
                            deletedCount++;
                            logger.info("[GuestCleanup] Deleted metadata for guest user: " + obj.userId + " (reason: " + guestReason + ")");
                        } catch (deleteErr) {
                            errors.push({
                                userId: obj.userId,
                                type: "metadata",
                                error: deleteErr.message
                            });
                            logger.error("[GuestCleanup] Failed to delete metadata for user " + obj.userId + ": " + deleteErr.message);
                        }

                        // Delete device_user_mappings for each device
                        for (var di = 0; di < deviceIds.length; di++) {
                            var devId = deviceIds[di];
                            var mappingKey = "device_" + devId;
                            try {
                                nk.storageDelete([{
                                    collection: DEVICE_USER_MAPPINGS_COLLECTION,
                                    key: mappingKey,
                                    userId: SYSTEM_USER_ID
                                }]);
                                deviceMappingsDeleted++;
                                logger.info("[GuestCleanup] Deleted device mapping: " + mappingKey + " for guest user: " + obj.userId);
                            } catch (devDeleteErr) {
                                errors.push({
                                    userId: obj.userId,
                                    type: "device_mapping",
                                    deviceId: devId,
                                    error: devDeleteErr.message
                                });
                                logger.warn("[GuestCleanup] Failed to delete device mapping " + mappingKey + ": " + devDeleteErr.message);
                            }
                        }
                    } else {
                        logger.info("[GuestCleanup] [DRY RUN] Would delete metadata for guest user: " + obj.userId + " (reason: " + guestReason + ")");
                        if (deviceIds.length > 0) {
                            logger.info("[GuestCleanup] [DRY RUN] Would delete " + deviceIds.length + " device mapping(s) for user: " + obj.userId);
                        }
                    }
                }
            }

            // Get next cursor for pagination
            cursor = result.cursor;
            if (!cursor || cursor === "") {
                hasMore = false;
            }
        }

        var summary = {
            success: true,
            dryRun: dryRun,
            processedCount: processedCount,
            guestUsersFound: guestUsersFound.length,
            deletedCount: deletedCount,
            deviceMappingsDeleted: deviceMappingsDeleted,
            errors: errors,
            timestamp: new Date().toISOString()
        };

        if (dryRun) {
            summary.guestUsers = guestUsersFound;
        }

        logger.info("[GuestCleanup] Cleanup complete. Processed: " + processedCount +
            ", Guest users found: " + guestUsersFound.length +
            ", Metadata deleted: " + deletedCount +
            ", Device mappings deleted: " + deviceMappingsDeleted +
            ", Errors: " + errors.length);

        return JSON.stringify(summary);

    } catch (err) {
        logger.error("[GuestCleanup] Cleanup job failed: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message,
            processedCount: processedCount,
            deletedCount: deletedCount,
            deviceMappingsDeleted: deviceMappingsDeleted,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Scheduled function to clean up guest user metadata daily.
 * This function is intended to be called by a cron job configured externally.
 * Cron expression for daily at 3 AM UTC: "0 3 * * *"
 *
 * Note: In Nakama, scheduled tasks are typically configured in the server config
 * or via external schedulers. This function provides the implementation that
 * can be invoked via the RPC cleanup_guest_user_metadata.
 *
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 */
function scheduledCleanupGuestUserMetadata(ctx, logger, nk) {
    logger.info("[GuestCleanup] Daily scheduled cleanup started");

    try {
        var result = rpcCleanupGuestUserMetadata(ctx, logger, nk, JSON.stringify({ dryRun: false, limit: GUEST_CLEANUP_DEFAULT_LIMIT }));
        var parsed = JSON.parse(result);

        if (parsed.success) {
            logger.info("[GuestCleanup] Daily cleanup completed successfully. Deleted " + parsed.deletedCount + " guest user metadata records");
        } else {
            logger.error("[GuestCleanup] Daily cleanup failed: " + parsed.error);
        }
    } catch (err) {
        logger.error("[GuestCleanup] Scheduled cleanup error: " + err.message);
    }
}


// ============================================================================
// ONBOARDING MODULE
// Handles user onboarding state, preferences, and first-session hooks
// For 75% D1 retention target
// ============================================================================

var COLLECTION_ONBOARDING = "onboarding_state";
var COLLECTION_PREFERENCES = "user_preferences";
var COLLECTION_FIRST_SESSION = "first_session";
var KEY_ONBOARDING = "state";
var KEY_PREFERENCES = "prefs";
var KEY_SESSION = "session";

/**
 * Initialize new user with default onboarding state
 */
function initializeNewOnboardingUser(nk, logger, userId) {
    var now = Date.now();

    var onboardingState = {
        userId: userId,
        createdAt: now,
        currentStep: 1,
        totalSteps: 5,
        completedSteps: [],
        welcomeBonusClaimed: false,
        firstQuizCompleted: false,
        onboardingComplete: false,
        streakShieldExpiry: 0,
        lastUpdated: now
    };

    var preferences = {
        userId: userId,
        interests: [],
        preferredDifficulty: "easy",
        dailyReminderEnabled: true,
        reminderTime: "09:00",
        language: "en",
        createdAt: now,
        lastUpdated: now
    };

    var sessionData = {
        userId: userId,
        firstSessionAt: now,
        totalSessions: 1,
        lastSessionAt: now,
        totalQuizzesPlayed: 0,
        totalCoinsEarned: 0,
        currentStreak: 0,
        longestStreak: 0,
        d1Returned: false,
        d7Returned: false
    };

    nk.storageWrite([
        {
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId,
            value: onboardingState,
            permissionRead: 1,
            permissionWrite: 0
        },
        {
            collection: COLLECTION_PREFERENCES,
            key: KEY_PREFERENCES,
            userId: userId,
            value: preferences,
            permissionRead: 1,
            permissionWrite: 0
        },
        {
            collection: COLLECTION_FIRST_SESSION,
            key: KEY_SESSION,
            userId: userId,
            value: sessionData,
            permissionRead: 1,
            permissionWrite: 0
        }
    ]);

    logger.info("[Onboarding] Initialized new user: " + userId);
}

/**
 * Get rewards for completing a specific step
 */
function getOnboardingStepRewards(stepId) {
    var stepRewards = {
        1: { coins: 0, message: "Welcome to QuizVerse!" },
        2: { coins: 50, message: "Interests saved! +50 coins" },
        3: { coins: 200, message: "First quiz done! +200 coins + Streak Shield!" },
        4: { coins: 50, message: "Daily rewards unlocked! +50 coins" },
        5: { coins: 100, message: "Onboarding complete! +100 bonus coins!" }
    };
    return stepRewards[stepId] || { coins: 0, message: "" };
}

/**
 * RPC: onboarding_get_state - Get user's onboarding state
 */
function rpcOnboardingGetState(ctx, logger, nk, payload) {
    var userId = ctx.userId;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (result.length === 0) {
            initializeNewOnboardingUser(nk, logger, userId);
            return JSON.stringify({
                success: true,
                isNewUser: true,
                state: {
                    currentStep: 1,
                    totalSteps: 5,
                    completedSteps: [],
                    welcomeBonusClaimed: false,
                    firstQuizCompleted: false,
                    onboardingComplete: false
                }
            });
        }

        return JSON.stringify({
            success: true,
            isNewUser: false,
            state: result[0].value
        });
    } catch (e) {
        logger.error("[Onboarding] Get state error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: onboarding_update_state - Update onboarding state
 */
function rpcOnboardingUpdateState(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No onboarding state found" });
        }

        var state = result[0].value;

        if (input.currentStep !== undefined) state.currentStep = input.currentStep;
        if (input.completedSteps !== undefined) state.completedSteps = input.completedSteps;
        if (input.onboardingComplete !== undefined) state.onboardingComplete = input.onboardingComplete;
        state.lastUpdated = Date.now();

        nk.storageWrite([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        return JSON.stringify({ success: true, state: state });
    } catch (e) {
        logger.error("[Onboarding] Update state error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: onboarding_complete_step - Complete a specific onboarding step
 */
function rpcOnboardingCompleteStep(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);
    var stepId = input.stepId;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No onboarding state" });
        }

        var state = result[0].value;

        if (state.completedSteps.indexOf(stepId) === -1) {
            state.completedSteps.push(stepId);
        }

        if (stepId >= state.currentStep) {
            state.currentStep = stepId + 1;
        }

        if (state.completedSteps.length >= state.totalSteps) {
            state.onboardingComplete = true;
            logger.info("[Onboarding] User " + userId + " completed onboarding!");
        }

        state.lastUpdated = Date.now();

        nk.storageWrite([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        var rewards = getOnboardingStepRewards(stepId);

        return JSON.stringify({
            success: true,
            state: state,
            rewards: rewards
        });
    } catch (e) {
        logger.error("[Onboarding] Complete step error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: onboarding_set_interests - Set user interests/preferences
 */
function rpcOnboardingSetInterests(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_PREFERENCES,
            key: KEY_PREFERENCES,
            userId: userId
        }]);

        var prefs;
        if (result.length === 0) {
            prefs = {
                userId: userId,
                interests: input.interests || [],
                preferredDifficulty: input.difficulty || "easy",
                dailyReminderEnabled: true,
                reminderTime: "09:00",
                language: input.language || "en",
                createdAt: Date.now(),
                lastUpdated: Date.now()
            };
        } else {
            prefs = result[0].value;
            if (input.interests) prefs.interests = input.interests;
            if (input.difficulty) prefs.preferredDifficulty = input.difficulty;
            if (input.language) prefs.language = input.language;
            if (input.reminderEnabled !== undefined) prefs.dailyReminderEnabled = input.reminderEnabled;
            if (input.reminderTime) prefs.reminderTime = input.reminderTime;
            prefs.lastUpdated = Date.now();
        }

        nk.storageWrite([{
            collection: COLLECTION_PREFERENCES,
            key: KEY_PREFERENCES,
            userId: userId,
            value: prefs,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[Onboarding] User " + userId + " set interests: " + prefs.interests.join(", "));

        return JSON.stringify({ success: true, preferences: prefs });
    } catch (e) {
        logger.error("[Onboarding] Set interests error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: onboarding_get_interests - Get user interests
 */
function rpcOnboardingGetInterests(ctx, logger, nk, payload) {
    var userId = ctx.userId;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_PREFERENCES,
            key: KEY_PREFERENCES,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({
                success: true,
                preferences: {
                    interests: [],
                    preferredDifficulty: "easy"
                }
            });
        }

        return JSON.stringify({ success: true, preferences: result[0].value });
    } catch (e) {
        logger.error("[Onboarding] Get interests error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: onboarding_claim_welcome_bonus - Claim welcome bonus (50 coins)
 */
function rpcOnboardingClaimWelcomeBonus(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var WELCOME_BONUS = 50;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No onboarding state" });
        }

        var state = result[0].value;

        if (state.welcomeBonusClaimed) {
            return JSON.stringify({
                success: false,
                error: "Welcome bonus already claimed",
                alreadyClaimed: true
            });
        }

        var changeset = { coins: WELCOME_BONUS };
        var metadata = { source: "welcome_bonus" };
        nk.walletUpdate(userId, changeset, metadata, true);

        state.welcomeBonusClaimed = true;
        state.lastUpdated = Date.now();

        nk.storageWrite([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[Onboarding] User " + userId + " claimed welcome bonus: " + WELCOME_BONUS + " coins");

        return JSON.stringify({
            success: true,
            coinsAwarded: WELCOME_BONUS,
            message: "Welcome! Here's 50 free coins! ðŸŽ‰"
        });
    } catch (e) {
        logger.error("[Onboarding] Claim welcome bonus error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: onboarding_first_quiz_complete - First quiz completed bonus
 */
function rpcOnboardingFirstQuizComplete(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);
    var FIRST_QUIZ_BONUS = 200;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No onboarding state" });
        }

        var state = result[0].value;

        if (state.firstQuizCompleted) {
            return JSON.stringify({
                success: false,
                error: "First quiz bonus already claimed",
                alreadyClaimed: true
            });
        }

        var changeset = { coins: FIRST_QUIZ_BONUS };
        var metadata = {
            source: "first_quiz_bonus",
            score: input.score || 0,
            correctAnswers: input.correctAnswers || 0
        };
        nk.walletUpdate(userId, changeset, metadata, true);

        state.firstQuizCompleted = true;
        state.lastUpdated = Date.now();
        state.streakShieldExpiry = Date.now() + (48 * 60 * 60 * 1000);

        nk.storageWrite([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[Onboarding] User " + userId + " completed first quiz: " + FIRST_QUIZ_BONUS + " coins + streak shield");

        return JSON.stringify({
            success: true,
            coinsAwarded: FIRST_QUIZ_BONUS,
            streakShieldHours: 48,
            message: "Amazing! First Quiz Bonus: +200 Coins! ðŸŽ‰\nðŸ›¡ï¸ Streak Shield activated for 48 hours!"
        });
    } catch (e) {
        logger.error("[Onboarding] First quiz complete error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: onboarding_get_tomorrow_preview - Get personalized tomorrow preview
 */
function rpcOnboardingGetTomorrowPreview(ctx, logger, nk, payload) {
    var userId = ctx.userId;

    try {
        var prefsResult = nk.storageRead([{
            collection: COLLECTION_PREFERENCES,
            key: KEY_PREFERENCES,
            userId: userId
        }]);

        var interests = ["General Knowledge"];
        if (prefsResult.length > 0 && prefsResult[0].value.interests.length > 0) {
            interests = prefsResult[0].value.interests;
        }

        var tomorrowCategory = interests[Math.floor(Math.random() * interests.length)];

        var preview = {
            category: tomorrowCategory,
            xpMultiplier: 2,
            bonusCoins: 100,
            specialReward: "Mystery Box",
            message: "Tomorrow: " + tomorrowCategory + " Quiz with 2x XP! ðŸ”¥",
            notificationText: "Your " + tomorrowCategory + " quiz is ready! Don't miss the 2x XP bonus!"
        };

        return JSON.stringify({ success: true, preview: preview });
    } catch (e) {
        logger.error("[Onboarding] Get tomorrow preview error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: onboarding_track_session - Track session for retention
 */
function rpcOnboardingTrackSession(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_FIRST_SESSION,
            key: KEY_SESSION,
            userId: userId
        }]);

        if (result.length > 0) {
            var sessionData = result[0].value;
            var now = Date.now();
            var firstSession = sessionData.firstSessionAt;
            var hoursSinceFirst = (now - firstSession) / (1000 * 60 * 60);

            sessionData.totalSessions++;
            sessionData.lastSessionAt = now;

            if (!sessionData.d1Returned && hoursSinceFirst >= 20 && hoursSinceFirst <= 48) {
                sessionData.d1Returned = true;
                logger.info("[Onboarding] User " + userId + " returned on D1!");
            }

            if (!sessionData.d7Returned && hoursSinceFirst >= 144 && hoursSinceFirst <= 192) {
                sessionData.d7Returned = true;
                logger.info("[Onboarding] User " + userId + " returned on D7!");
            }

            if (input.quizzesPlayed) {
                sessionData.totalQuizzesPlayed += input.quizzesPlayed;
            }
            if (input.coinsEarned) {
                sessionData.totalCoinsEarned += input.coinsEarned;
            }

            nk.storageWrite([{
                collection: COLLECTION_FIRST_SESSION,
                key: KEY_SESSION,
                userId: userId,
                value: sessionData,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }

        return JSON.stringify({ success: true });
    } catch (e) {
        logger.error("[Onboarding] Track session error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: onboarding_get_retention_data - Get retention analytics
 */
function rpcOnboardingGetRetentionData(ctx, logger, nk, payload) {
    var userId = ctx.userId;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_FIRST_SESSION,
            key: KEY_SESSION,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No session data" });
        }

        var sessionData = result[0].value;
        var now = Date.now();
        var daysSinceFirst = Math.floor((now - sessionData.firstSessionAt) / (1000 * 60 * 60 * 24));

        return JSON.stringify({
            success: true,
            data: {
                firstSessionAt: sessionData.firstSessionAt,
                totalSessions: sessionData.totalSessions,
                lastSessionAt: sessionData.lastSessionAt,
                totalQuizzesPlayed: sessionData.totalQuizzesPlayed,
                totalCoinsEarned: sessionData.totalCoinsEarned,
                currentStreak: sessionData.currentStreak,
                longestStreak: sessionData.longestStreak,
                d1Returned: sessionData.d1Returned,
                d7Returned: sessionData.d7Returned,
                daysSinceFirstSession: daysSinceFirst,
                isD1: daysSinceFirst === 1,
                isD7: daysSinceFirst === 7
            }
        });
    } catch (e) {
        logger.error("[Onboarding] Get retention data error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}


// ============================================================================
// RETENTION MODULE
// Additional RPCs for 75% D1 retention: Streak Shields, Personalization, etc.
// ============================================================================

var COLLECTION_STREAK_SHIELD = "streak_shield";
var COLLECTION_PERSONALIZATION = "personalization";
var KEY_SHIELD = "shield";
var KEY_PERSONALIZATION = "prefs";

/**
 * RPC: retention_grant_streak_shield - Grant streak shield
 */
function rpcRetentionGrantStreakShield(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);
    var hours = input.hours || 48;

    try {
        var expiryTime = Date.now() + (hours * 60 * 60 * 1000);

        var shieldData = {
            userId: userId,
            isActive: true,
            grantedAt: Date.now(),
            expiryTime: expiryTime,
            hoursGranted: hours,
            usedCount: 0
        };

        nk.storageWrite([{
            collection: COLLECTION_STREAK_SHIELD,
            key: KEY_SHIELD,
            userId: userId,
            value: shieldData,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[Retention] Granted " + hours + "h streak shield to user: " + userId);

        return JSON.stringify({
            success: true,
            expiryTime: expiryTime,
            hoursRemaining: hours
        });
    } catch (e) {
        logger.error("[Retention] Grant shield error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: retention_get_streak_shield - Get streak shield status
 */
function rpcRetentionGetStreakShield(ctx, logger, nk, payload) {
    var userId = ctx.userId;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_STREAK_SHIELD,
            key: KEY_SHIELD,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({
                success: true,
                isActive: false,
                expiryTimestamp: 0,
                hoursRemaining: 0
            });
        }

        var shieldData = result[0].value;
        var now = Date.now();
        var isActive = shieldData.isActive && shieldData.expiryTime > now;
        var hoursRemaining = isActive ? Math.ceil((shieldData.expiryTime - now) / (1000 * 60 * 60)) : 0;

        return JSON.stringify({
            success: true,
            isActive: isActive,
            expiryTimestamp: shieldData.expiryTime,
            hoursRemaining: hoursRemaining
        });
    } catch (e) {
        logger.error("[Retention] Get shield error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: retention_use_streak_shield - Use shield to protect streak
 */
function rpcRetentionUseStreakShield(ctx, logger, nk, payload) {
    var userId = ctx.userId;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_STREAK_SHIELD,
            key: KEY_SHIELD,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No shield found" });
        }

        var shieldData = result[0].value;
        var now = Date.now();

        if (!shieldData.isActive || shieldData.expiryTime <= now) {
            return JSON.stringify({ success: false, error: "Shield expired" });
        }

        // Mark shield as used
        shieldData.usedCount++;
        shieldData.lastUsedAt = now;

        nk.storageWrite([{
            collection: COLLECTION_STREAK_SHIELD,
            key: KEY_SHIELD,
            userId: userId,
            value: shieldData,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[Retention] Shield used by user: " + userId);

        return JSON.stringify({ success: true, usedCount: shieldData.usedCount });
    } catch (e) {
        logger.error("[Retention] Use shield error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: retention_schedule_notification - Schedule return notification
 * Accepts both Unity SDK payload (template_id, fire_at, channel, priority)
 * and legacy payload (scheduledTime, message, category) for backward compatibility.
 * Also writes to notification_inbox collection so it appears in the user's inbox.
 */
function rpcRetentionScheduleNotification(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);

    try {
        // Resolve fields: support both Unity SDK and legacy payload formats
        var templateId = input.template_id || input.notificationType || 'daily_reminder';
        var gameId = input.game_id || 'quizverse';
        var fireAt = input.fire_at || input.scheduledTime || Date.now();
        var channel = input.channel || 'both';
        var priority = input.priority || 5;
        var title = input.title || input.message || templateId;
        var body = input.body || input.message || '';
        var category = input.category || 'retention';
        var eventType = input.event_type || templateId;

        // Normalize fireAt to timestamp (accept both epoch ms and ISO string)
        if (typeof fireAt === 'string') {
            fireAt = new Date(fireAt).getTime();
        }

        var notifId = 'sched_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
        var now = Date.now();
        var isImmediate = (fireAt <= now);

        // Store notification schedule
        var notification = {
            userId: userId,
            notification_id: notifId,
            template_id: templateId,
            game_id: gameId,
            fire_at: fireAt,
            channel: channel,
            priority: priority,
            title: title,
            body: body,
            category: category,
            event_type: eventType,
            notificationType: templateId,
            scheduledTime: fireAt,
            message: body,
            createdAt: now
        };

        nk.storageWrite([{
            collection: 'scheduled_notifications',
            key: notifId,
            userId: userId,
            value: notification,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Also write to notification_inbox so it appears in the user's inbox
        // (for immediate notifications or when fire_at has passed)
        if (isImmediate || (fireAt - now) < 60000) {
            // Immediate or fires within 1 minute â€” add to inbox now
            try {
                nk.storageWrite([{
                    collection: 'notification_inbox',
                    key: notifId,
                    userId: userId,
                    value: {
                        notification_id: notifId,
                        title: title,
                        body: body,
                        event_type: eventType,
                        data: { template_id: templateId, game_id: gameId, category: category },
                        template_id: templateId,
                        priority: priority,
                        channel: channel,
                        is_read: false,
                        sent_at: now,
                        created_at: now
                    },
                    permissionRead: 1,
                    permissionWrite: 0
                }]);
                logger.info('[Retention] Notification added to inbox for user ' + userId + ': ' + templateId);
            } catch (inboxErr) {
                logger.warn('[Retention] Could not write to inbox: ' + inboxErr.message);
            }
        }

        var delaySeconds = Math.max(0, (fireAt - now) / 1000);
        logger.info('[Retention] Scheduled notification for user ' + userId + ' in ' + Math.round(delaySeconds) + 's (template: ' + templateId + ')');

        return JSON.stringify({
            success: true,
            notification_id: notifId,
            immediate: isImmediate,
            fire_at: fireAt
        });
    } catch (e) {
        logger.error('[Retention] Schedule notification error: ' + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: retention_get_recommendations - Get personalized recommendations
 */
function rpcRetentionGetRecommendations(ctx, logger, nk, payload) {
    var userId = ctx.userId;

    try {
        // Get user preferences from onboarding
        var prefsResult = nk.storageRead([{
            collection: COLLECTION_PREFERENCES,
            key: KEY_PREFERENCES,
            userId: userId
        }]);

        var interests = ["General Knowledge"];
        if (prefsResult.length > 0 && prefsResult[0].value.interests) {
            interests = prefsResult[0].value.interests;
        }

        // Generate recommendations based on interests
        var recommendations = [];
        for (var i = 0; i < Math.min(interests.length, 5); i++) {
            recommendations.push({
                category: interests[i],
                title: interests[i] + " Quiz",
                xpMultiplier: 1,
                bonusCoins: 50,
                difficulty: "medium"
            });
        }

        // Tomorrow's quiz with bonus
        var tomorrowCategory = interests[Math.floor(Math.random() * interests.length)];
        var tomorrowQuiz = {
            category: tomorrowCategory,
            title: "Daily " + tomorrowCategory + " Quiz",
            xpMultiplier: 2,
            bonusCoins: 100,
            difficulty: "medium"
        };

        return JSON.stringify({
            success: true,
            recommendedCategories: interests,
            dailyQuizzes: recommendations,
            tomorrowQuiz: tomorrowQuiz
        });
    } catch (e) {
        logger.error("[Retention] Get recommendations error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: retention_track_first_session - Track first session completion
 */
function rpcRetentionTrackFirstSession(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);

    try {
        var sessionData = {
            userId: userId,
            firstSessionCompleted: true,
            completedAt: Date.now(),
            score: input.score || 0,
            quizzesPlayed: input.quizzesPlayed || 1,
            interests: input.interests || []
        };

        nk.storageWrite([{
            collection: "first_session_complete",
            key: "session",
            userId: userId,
            value: sessionData,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Grant achievements
        try {
            nk.walletUpdate(userId, { coins: 100 }, { source: "first_session_complete" }, true);
        } catch (walletErr) {
            logger.warn("[Retention] Could not grant first session bonus: " + walletErr.message);
        }

        logger.info("[Retention] User " + userId + " completed first session");

        return JSON.stringify({ success: true, bonusCoins: 100 });
    } catch (e) {
        logger.error("[Retention] Track first session error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: onboarding_create_link_quiz - Create quiz from link (AHA MOMENT)
 * This is the killer feature - AI generates quiz from user's content
 */
function rpcOnboardingCreateLinkQuiz(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);
    var url = input.url || "";
    var title = input.title || "My Quiz";

    try {
        // In production, this would call AI service to generate quiz
        // For now, return mock quiz based on URL patterns

        var generatedQuiz = {
            title: title,
            sourceUrl: url,
            topics: detectTopics(url),
            totalQuestions: 10,
            previewQuestions: generatePreviewQuestions(url),
            createdAt: Date.now(),
            userId: userId,
            isOnboardingQuiz: true
        };

        // Save quiz for user
        nk.storageWrite([{
            collection: "user_quizzes",
            key: "onboarding_quiz",
            userId: userId,
            value: generatedQuiz,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[Onboarding] Created Link and Play quiz for user: " + userId);

        return JSON.stringify({
            success: true,
            quiz: generatedQuiz
        });
    } catch (e) {
        logger.error("[Onboarding] Create link quiz error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

// Helper: Detect topics from URL
function detectTopics(url) {
    url = url.toLowerCase();
    if (url.includes("solar") || url.includes("space") || url.includes("planet")) {
        return ["Science", "Space", "Astronomy"];
    }
    if (url.includes("history") || url.includes("war") || url.includes("ancient")) {
        return ["History", "World Events"];
    }
    if (url.includes("sports") || url.includes("football") || url.includes("soccer")) {
        return ["Sports"];
    }
    return ["General Knowledge"];
}

// Helper: Generate preview questions
function generatePreviewQuestions(url) {
    // In production, AI would generate these from the actual content
    // For demo, return topic-appropriate questions
    url = url.toLowerCase();

    if (url.includes("solar") || url.includes("space")) {
        return [
            {
                question: "Which planet is known as the 'Red Planet'?",
                answers: ["Venus", "Mars", "Jupiter", "Saturn"],
                correctIndex: 1
            },
            {
                question: "What is the largest planet in our Solar System?",
                answers: ["Saturn", "Neptune", "Jupiter", "Uranus"],
                correctIndex: 2
            }
        ];
    }

    // Default questions
    return [
        {
            question: "What is the content about?",
            answers: ["Topic A", "Topic B", "Topic C", "Topic D"],
            correctIndex: 0
        },
        {
            question: "What did you learn from this?",
            answers: ["Fact A", "Fact B", "Fact C", "Fact D"],
            correctIndex: 1
        }
    ];
}

/**
 * RPC: retention_claim_welcome_bonus - Claim welcome bonus (50 coins)
 */
function rpcRetentionClaimWelcomeBonus(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var WELCOME_BONUS = 50;

    try {
        // Check if already claimed
        var result = nk.storageRead([{
            collection: "welcome_bonus",
            key: "claimed",
            userId: userId
        }]);

        if (result.length > 0 && result[0].value.claimed) {
            return JSON.stringify({
                success: false,
                error: "Already claimed",
                alreadyClaimed: true,
                coinsAwarded: 0
            });
        }

        // Grant bonus
        nk.walletUpdate(userId, { coins: WELCOME_BONUS }, { source: "welcome_bonus" }, true);

        // Mark as claimed
        nk.storageWrite([{
            collection: "welcome_bonus",
            key: "claimed",
            userId: userId,
            value: { claimed: true, claimedAt: Date.now() },
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[Retention] User " + userId + " claimed welcome bonus: " + WELCOME_BONUS);

        return JSON.stringify({
            success: true,
            coinsAwarded: WELCOME_BONUS,
            message: "Welcome! Here's 50 free coins! ðŸŽ‰",
            alreadyClaimed: false
        });
    } catch (e) {
        logger.error("[Retention] Claim welcome bonus error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}


// ============================================================================
// D7/D30 RETENTION SYSTEMS - Weekly Goals, Season Pass, Milestones, Collections
// ============================================================================

// ==================== WEEKLY GOALS SYSTEM ====================

var DEFAULT_WEEKLY_GOALS = [
    { day: 1, id: "login", title: "Welcome Back", description: "Log in to the app", reward: { coins: 50 }, autoComplete: true },
    { day: 2, id: "complete_quizzes", title: "Quiz Starter", description: "Complete 3 quizzes", target: 3, reward: { coins: 100, xp: 50 } },
    { day: 3, id: "win_multiplayer", title: "Champion", description: "Win 1 multiplayer match", target: 1, reward: { coins: 150, xp: 75 } },
    { day: 4, id: "accuracy", title: "Precision", description: "Score 80%+ on any quiz", target: 80, reward: { coins: 200, xp: 100 } },
    { day: 5, id: "challenge_friend", title: "Social", description: "Challenge a friend", target: 1, reward: { coins: 250, xp: 125 } },
    { day: 6, id: "create_quiz", title: "Creator", description: "Create a quiz with Link & Play", target: 1, reward: { coins: 300, xp: 150 } },
    { day: 7, id: "complete_all", title: "Weekly Master", description: "Complete all weekly goals", reward: { coins: 500, xp: 250, mysteryBox: true } }
];

function getCurrentWeekNumber() {
    var now = new Date();
    var startOfYear = new Date(now.getFullYear(), 0, 1);
    var days = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000));
    return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

function getCurrentDayOfWeek() {
    var day = new Date().getDay();
    return day === 0 ? 7 : day;
}

function rpcWeeklyGoalsGetStatus(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var data = JSON.parse(payload || "{}");
        var gameId = data.gameId || "quiz-verse";
        var currentWeek = getCurrentWeekNumber();
        var currentDay = getCurrentDayOfWeek();

        var key = "weekly_goals_" + currentWeek;
        var records = nk.storageRead([{ collection: "weekly_goals", key: key, userId: ctx.userId }]);

        var progress = records.length > 0 ? records[0].value : null;

        if (!progress) {
            progress = { weekNumber: currentWeek, weekStreak: 1, goals: {}, allCompleted: false };
            for (var i = 0; i < DEFAULT_WEEKLY_GOALS.length; i++) {
                var g = DEFAULT_WEEKLY_GOALS[i];
                progress.goals[g.id] = { current: g.id === "login" ? 1 : 0, target: g.target || 1, completed: g.id === "login", claimed: false };
            }
            nk.storageWrite([{ collection: "weekly_goals", key: key, userId: ctx.userId, value: progress, permissionRead: 1, permissionWrite: 0 }]);
        }

        var goalsArray = DEFAULT_WEEKLY_GOALS.map(function(g) {
            var p = progress.goals[g.id] || { current: 0, target: g.target || 1, completed: false, claimed: false };
            return { id: g.id, day: g.day, title: g.title, description: g.description, current: p.current, target: p.target, completed: p.completed, claimed: p.claimed, reward: g.reward, isUnlocked: g.day <= currentDay };
        });

        return JSON.stringify({ success: true, weekNumber: currentWeek, currentDay: currentDay, weekStreak: progress.weekStreak || 1, goals: goalsArray, allCompleted: progress.allCompleted });
    } catch (e) {
        logger.error("[WeeklyGoals] Error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcWeeklyGoalsUpdateProgress(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var data = JSON.parse(payload);
        var goalId = data.goalId;
        var value = data.value || 1;
        var currentWeek = getCurrentWeekNumber();

        var key = "weekly_goals_" + currentWeek;
        var records = nk.storageRead([{ collection: "weekly_goals", key: key, userId: ctx.userId }]);

        if (records.length === 0) return JSON.stringify({ success: false, error: "Goals not initialized" });

        var progress = records[0].value;
        var goal = progress.goals[goalId];
        if (!goal) return JSON.stringify({ success: false, error: "Goal not found" });

        goal.current = Math.min(goal.current + value, goal.target);
        if (goal.current >= goal.target && !goal.completed) goal.completed = true;

        var allDone = true;
        for (var gid in progress.goals) {
            if (gid !== "complete_all" && !progress.goals[gid].completed) allDone = false;
        }
        if (allDone) {
            progress.goals["complete_all"].completed = true;
            progress.allCompleted = true;
        }

        nk.storageWrite([{ collection: "weekly_goals", key: key, userId: ctx.userId, value: progress, permissionRead: 1, permissionWrite: 0 }]);

        return JSON.stringify({ success: true, goalId: goalId, current: goal.current, target: goal.target, completed: goal.completed, allCompleted: progress.allCompleted });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcWeeklyGoalsClaimReward(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var data = JSON.parse(payload);
        var goalId = data.goalId;
        var currentWeek = getCurrentWeekNumber();

        var key = "weekly_goals_" + currentWeek;
        var records = nk.storageRead([{ collection: "weekly_goals", key: key, userId: ctx.userId }]);

        if (records.length === 0) return JSON.stringify({ success: false, error: "Goals not initialized" });

        var progress = records[0].value;
        var goal = progress.goals[goalId];

        if (!goal || !goal.completed) return JSON.stringify({ success: false, error: "Goal not completed" });
        if (goal.claimed) return JSON.stringify({ success: false, error: "Already claimed" });

        goal.claimed = true;
        nk.storageWrite([{ collection: "weekly_goals", key: key, userId: ctx.userId, value: progress, permissionRead: 1, permissionWrite: 0 }]);

        var reward = DEFAULT_WEEKLY_GOALS.find(function(g) { return g.id === goalId; }).reward;

        return JSON.stringify({ success: true, goalId: goalId, reward: reward });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcWeeklyGoalsClaimBonus(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var currentWeek = getCurrentWeekNumber();
        var key = "weekly_goals_" + currentWeek;
        var records = nk.storageRead([{ collection: "weekly_goals", key: key, userId: ctx.userId }]);

        if (records.length === 0) return JSON.stringify({ success: false, error: "Goals not initialized" });

        var progress = records[0].value;
        if (!progress.allCompleted) return JSON.stringify({ success: false, error: "Not all goals completed" });
        if (progress.bonusClaimed) return JSON.stringify({ success: false, error: "Bonus already claimed" });

        progress.bonusClaimed = true;
        nk.storageWrite([{ collection: "weekly_goals", key: key, userId: ctx.userId, value: progress, permissionRead: 1, permissionWrite: 0 }]);

        return JSON.stringify({ success: true, bonus: { coins: 500, gems: 100, mysteryBox: true }, weekStreak: progress.weekStreak });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

// ==================== SEASON PASS SYSTEM ====================

var SEASON_CONFIG = { maxLevel: 50, xpPerLevel: 1000 };

function rpcSeasonPassGetStatus(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var data = JSON.parse(payload || "{}");
        var now = new Date();
        var seasonNumber = (now.getFullYear() * 12) + now.getMonth() + 1;

        var key = "season_pass_" + seasonNumber;
        var records = nk.storageRead([{ collection: "season_pass", key: key, userId: ctx.userId }]);

        var passData = records.length > 0 ? records[0].value : { seasonNumber: seasonNumber, level: 1, xp: 0, totalXpEarned: 0, isPremium: false, freeRewardsClaimed: {}, premiumRewardsClaimed: {} };

        if (records.length === 0) {
            nk.storageWrite([{ collection: "season_pass", key: key, userId: ctx.userId, value: passData, permissionRead: 1, permissionWrite: 0 }]);
        }

        return JSON.stringify({ success: true, seasonNumber: seasonNumber, level: passData.level, xp: passData.xp, totalXpEarned: passData.totalXpEarned, isPremium: passData.isPremium, maxLevel: SEASON_CONFIG.maxLevel, xpPerLevel: SEASON_CONFIG.xpPerLevel, freeRewardsClaimed: passData.freeRewardsClaimed, premiumRewardsClaimed: passData.premiumRewardsClaimed });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcSeasonPassAddXP(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var data = JSON.parse(payload);
        var xpToAdd = parseInt(data.xp) || 0;
        var now = new Date();
        var seasonNumber = (now.getFullYear() * 12) + now.getMonth() + 1;

        var key = "season_pass_" + seasonNumber;
        var records = nk.storageRead([{ collection: "season_pass", key: key, userId: ctx.userId }]);

        var passData = records.length > 0 ? records[0].value : { seasonNumber: seasonNumber, level: 1, xp: 0, totalXpEarned: 0, isPremium: false };

        var oldLevel = passData.level;
        passData.xp += xpToAdd;
        passData.totalXpEarned += xpToAdd;
        passData.level = Math.min(Math.floor(passData.totalXpEarned / SEASON_CONFIG.xpPerLevel) + 1, SEASON_CONFIG.maxLevel);

        nk.storageWrite([{ collection: "season_pass", key: key, userId: ctx.userId, value: passData, permissionRead: 1, permissionWrite: 0 }]);

        return JSON.stringify({ success: true, xpAdded: xpToAdd, level: passData.level, oldLevel: oldLevel, leveledUp: passData.level > oldLevel, totalXp: passData.totalXpEarned });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcSeasonPassCompleteQuest(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });
    try {
        var data = JSON.parse(payload);
        return JSON.stringify({ success: true, questId: data.questId, xpEarned: 100 });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcSeasonPassClaimReward(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var data = JSON.parse(payload);
        var level = parseInt(data.level);
        var track = data.track || "free";
        var now = new Date();
        var seasonNumber = (now.getFullYear() * 12) + now.getMonth() + 1;

        var key = "season_pass_" + seasonNumber;
        var records = nk.storageRead([{ collection: "season_pass", key: key, userId: ctx.userId }]);

        if (records.length === 0) return JSON.stringify({ success: false, error: "Season pass not initialized" });

        var passData = records[0].value;
        if (passData.level < level) return JSON.stringify({ success: false, error: "Level not reached" });

        var claimedMap = track === "premium" ? passData.premiumRewardsClaimed : passData.freeRewardsClaimed;
        if (claimedMap[level]) return JSON.stringify({ success: false, error: "Already claimed" });

        claimedMap[level] = true;
        nk.storageWrite([{ collection: "season_pass", key: key, userId: ctx.userId, value: passData, permissionRead: 1, permissionWrite: 0 }]);

        return JSON.stringify({ success: true, level: level, track: track, reward: { coins: level * 50 } });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcSeasonPassPurchasePremium(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var now = new Date();
        var seasonNumber = (now.getFullYear() * 12) + now.getMonth() + 1;
        var key = "season_pass_" + seasonNumber;
        var records = nk.storageRead([{ collection: "season_pass", key: key, userId: ctx.userId }]);

        var passData = records.length > 0 ? records[0].value : { seasonNumber: seasonNumber, level: 1, xp: 0, totalXpEarned: 0, isPremium: false };
        passData.isPremium = true;

        nk.storageWrite([{ collection: "season_pass", key: key, userId: ctx.userId, value: passData, permissionRead: 1, permissionWrite: 0 }]);

        return JSON.stringify({ success: true, isPremium: true });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

// ==================== MONTHLY MILESTONES SYSTEM ====================

var MONTHLY_MILESTONES = [
    { id: "quiz_50", title: "Quiz Master", description: "Complete 50 quizzes", target: 50, reward: { coins: 500 } },
    { id: "streak_7", title: "Week Warrior", description: "Login 7 consecutive days", target: 7, reward: { mysteryBox: 1 } },
    { id: "accuracy_80", title: "Sharpshooter", description: "Reach 80% accuracy", target: 80, reward: { badge: "accurate" } },
    { id: "win_5", title: "Champion", description: "Win 5 multiplayer battles", target: 5, reward: { gems: 100 } },
    { id: "create_3", title: "Creator", description: "Create 3 quizzes", target: 3, reward: { badge: "creator" } }
];

function rpcMonthlyMilestonesGetStatus(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var now = new Date();
        var monthKey = now.getFullYear() + "_" + (now.getMonth() + 1);

        var key = "monthly_milestones_" + monthKey;
        var records = nk.storageRead([{ collection: "monthly_milestones", key: key, userId: ctx.userId }]);

        var progress = records.length > 0 ? records[0].value : null;

        if (!progress) {
            progress = { monthKey: monthKey, milestones: {}, totalCompleted: 0, allCompleted: false, legendaryRewardClaimed: false };
            for (var i = 0; i < MONTHLY_MILESTONES.length; i++) {
                var m = MONTHLY_MILESTONES[i];
                progress.milestones[m.id] = { current: 0, target: m.target, completed: false, claimed: false };
            }
            nk.storageWrite([{ collection: "monthly_milestones", key: key, userId: ctx.userId, value: progress, permissionRead: 1, permissionWrite: 0 }]);
        }

        var milestonesArray = MONTHLY_MILESTONES.map(function(m) {
            var p = progress.milestones[m.id];
            return { id: m.id, title: m.title, description: m.description, current: p.current, target: p.target, completed: p.completed, claimed: p.claimed, reward: m.reward };
        });

        return JSON.stringify({ success: true, monthKey: monthKey, milestones: milestonesArray, totalCompleted: progress.totalCompleted, allCompleted: progress.allCompleted, legendaryRewardClaimed: progress.legendaryRewardClaimed });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcMonthlyMilestonesUpdateProgress(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var data = JSON.parse(payload);
        var milestoneId = data.milestoneId;
        var value = data.value || 1;
        var setMax = data.setMax || false;

        var now = new Date();
        var monthKey = now.getFullYear() + "_" + (now.getMonth() + 1);
        var key = "monthly_milestones_" + monthKey;

        var records = nk.storageRead([{ collection: "monthly_milestones", key: key, userId: ctx.userId }]);
        if (records.length === 0) return JSON.stringify({ success: false, error: "Milestones not initialized" });

        var progress = records[0].value;
        var milestone = progress.milestones[milestoneId];
        if (!milestone) return JSON.stringify({ success: false, error: "Milestone not found" });

        if (setMax) milestone.current = Math.max(milestone.current, value);
        else milestone.current = Math.min(milestone.current + value, milestone.target);

        if (milestone.current >= milestone.target && !milestone.completed) {
            milestone.completed = true;
            progress.totalCompleted++;
        }

        if (progress.totalCompleted >= MONTHLY_MILESTONES.length) progress.allCompleted = true;

        nk.storageWrite([{ collection: "monthly_milestones", key: key, userId: ctx.userId, value: progress, permissionRead: 1, permissionWrite: 0 }]);

        return JSON.stringify({ success: true, milestoneId: milestoneId, current: milestone.current, target: milestone.target, completed: milestone.completed, allCompleted: progress.allCompleted });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcMonthlyMilestonesClaimReward(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var data = JSON.parse(payload);
        var milestoneId = data.milestoneId;

        var now = new Date();
        var monthKey = now.getFullYear() + "_" + (now.getMonth() + 1);
        var key = "monthly_milestones_" + monthKey;

        var records = nk.storageRead([{ collection: "monthly_milestones", key: key, userId: ctx.userId }]);
        if (records.length === 0) return JSON.stringify({ success: false, error: "Not initialized" });

        var progress = records[0].value;
        var milestone = progress.milestones[milestoneId];

        if (!milestone || !milestone.completed) return JSON.stringify({ success: false, error: "Not completed" });
        if (milestone.claimed) return JSON.stringify({ success: false, error: "Already claimed" });

        milestone.claimed = true;
        nk.storageWrite([{ collection: "monthly_milestones", key: key, userId: ctx.userId, value: progress, permissionRead: 1, permissionWrite: 0 }]);

        var reward = MONTHLY_MILESTONES.find(function(m) { return m.id === milestoneId; }).reward;
        return JSON.stringify({ success: true, milestoneId: milestoneId, reward: reward });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcMonthlyMilestonesClaimLegendary(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var now = new Date();
        var monthKey = now.getFullYear() + "_" + (now.getMonth() + 1);
        var key = "monthly_milestones_" + monthKey;

        var records = nk.storageRead([{ collection: "monthly_milestones", key: key, userId: ctx.userId }]);
        if (records.length === 0) return JSON.stringify({ success: false, error: "Not initialized" });

        var progress = records[0].value;
        if (!progress.allCompleted) return JSON.stringify({ success: false, error: "Not all milestones completed" });
        if (progress.legendaryRewardClaimed) return JSON.stringify({ success: false, error: "Already claimed" });

        progress.legendaryRewardClaimed = true;
        nk.storageWrite([{ collection: "monthly_milestones", key: key, userId: ctx.userId, value: progress, permissionRead: 1, permissionWrite: 0 }]);

        return JSON.stringify({ success: true, reward: { coins: 5000, gems: 500, avatar: "legendary_monthly", title: "Monthly Legend" } });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

// ==================== COLLECTIONS & PRESTIGE SYSTEM ====================

function rpcCollectionsGetStatus(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var key = "collections_" + ctx.userId;
        var records = nk.storageRead([{ collection: "user_collections", key: key, userId: ctx.userId }]);

        var collectionData = records.length > 0 ? records[0].value : {
            unlocked: { avatars: ["avatar_default"], badges: [], titles: ["title_newbie"], frames: ["frame_default"] },
            equipped: { avatar: "avatar_default", title: "title_newbie", frame: "frame_default", badge: null },
            mastery: {},
            prestige: { level: 0, totalXp: 0 }
        };

        if (records.length === 0) {
            nk.storageWrite([{ collection: "user_collections", key: key, userId: ctx.userId, value: collectionData, permissionRead: 1, permissionWrite: 0 }]);
        }

        return JSON.stringify({ success: true, unlocked: collectionData.unlocked, equipped: collectionData.equipped, mastery: collectionData.mastery, prestige: collectionData.prestige });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcCollectionsUnlockItem(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var data = JSON.parse(payload);
        var collectionType = data.collectionType;
        var itemId = data.itemId;

        var key = "collections_" + ctx.userId;
        var records = nk.storageRead([{ collection: "user_collections", key: key, userId: ctx.userId }]);

        if (records.length === 0) return JSON.stringify({ success: false, error: "Collections not initialized" });

        var collectionData = records[0].value;
        if (collectionData.unlocked[collectionType].indexOf(itemId) !== -1) {
            return JSON.stringify({ success: true, alreadyUnlocked: true });
        }

        collectionData.unlocked[collectionType].push(itemId);
        nk.storageWrite([{ collection: "user_collections", key: key, userId: ctx.userId, value: collectionData, permissionRead: 1, permissionWrite: 0 }]);

        return JSON.stringify({ success: true, itemId: itemId, collectionType: collectionType });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcCollectionsEquipItem(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var data = JSON.parse(payload);
        var slot = data.slot;
        var itemId = data.itemId;

        var key = "collections_" + ctx.userId;
        var records = nk.storageRead([{ collection: "user_collections", key: key, userId: ctx.userId }]);

        if (records.length === 0) return JSON.stringify({ success: false, error: "Collections not initialized" });

        var collectionData = records[0].value;
        collectionData.equipped[slot] = itemId;
        nk.storageWrite([{ collection: "user_collections", key: key, userId: ctx.userId, value: collectionData, permissionRead: 1, permissionWrite: 0 }]);

        return JSON.stringify({ success: true, slot: slot, itemId: itemId, equipped: collectionData.equipped });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcCollectionsAddMasteryXP(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var data = JSON.parse(payload);
        var category = data.category;
        var xpToAdd = parseInt(data.xp) || 0;

        var key = "collections_" + ctx.userId;
        var records = nk.storageRead([{ collection: "user_collections", key: key, userId: ctx.userId }]);

        var collectionData = records.length > 0 ? records[0].value : { unlocked: {}, equipped: {}, mastery: {}, prestige: { level: 0, totalXp: 0 } };

        if (!collectionData.mastery[category]) collectionData.mastery[category] = { level: 1, xp: 0 };

        collectionData.mastery[category].xp += xpToAdd;
        collectionData.mastery[category].level = Math.min(5, Math.floor(collectionData.mastery[category].xp / 1000) + 1);
        collectionData.prestige.totalXp += xpToAdd;
        collectionData.prestige.level = Math.min(5, Math.floor(collectionData.prestige.totalXp / 50000));

        nk.storageWrite([{ collection: "user_collections", key: key, userId: ctx.userId, value: collectionData, permissionRead: 1, permissionWrite: 0 }]);

        return JSON.stringify({ success: true, category: category, mastery: collectionData.mastery[category], prestige: collectionData.prestige });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

// ==================== WIN-BACK SYSTEM ====================

var COMEBACK_TIERS = [
    { minDays: 7, maxDays: 14, tier: "short", rewards: { coins: 200, streakShieldDays: 2 } },
    { minDays: 14, maxDays: 30, tier: "medium", rewards: { coins: 500, gems: 50, streakShieldDays: 5 } },
    { minDays: 30, maxDays: 60, tier: "long", rewards: { coins: 1000, gems: 100, premiumTrialDays: 3 } },
    { minDays: 60, maxDays: 365, tier: "verylong", rewards: { coins: 2000, gems: 200, premiumTrialDays: 7 } }
];

function rpcWinbackCheckStatus(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var records = nk.storageRead([{ collection: "user_sessions", key: "last_session", userId: ctx.userId }]);

        if (records.length === 0) {
            return JSON.stringify({ success: true, isReturningUser: false, daysAway: 0, hasRewards: false });
        }

        var lastSession = new Date(records[0].value.lastSessionTime);
        var daysAway = Math.floor((new Date() - lastSession) / (1000 * 60 * 60 * 24));

        var tier = null;
        for (var i = COMEBACK_TIERS.length - 1; i >= 0; i--) {
            if (daysAway >= COMEBACK_TIERS[i].minDays && daysAway <= COMEBACK_TIERS[i].maxDays) {
                tier = COMEBACK_TIERS[i];
                break;
            }
        }

        return JSON.stringify({ success: true, isReturningUser: daysAway > 0, daysAway: daysAway, hasRewards: tier !== null, tier: tier });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcWinbackClaimRewards(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var records = nk.storageRead([{ collection: "user_sessions", key: "last_session", userId: ctx.userId }]);
        if (records.length === 0) return JSON.stringify({ success: false, error: "No previous session" });

        var lastSession = new Date(records[0].value.lastSessionTime);
        var daysAway = Math.floor((new Date() - lastSession) / (1000 * 60 * 60 * 24));

        var tier = null;
        for (var i = COMEBACK_TIERS.length - 1; i >= 0; i--) {
            if (daysAway >= COMEBACK_TIERS[i].minDays && daysAway <= COMEBACK_TIERS[i].maxDays) {
                tier = COMEBACK_TIERS[i];
                break;
            }
        }

        if (!tier) return JSON.stringify({ success: false, error: "Not eligible for comeback rewards" });

        var winbackRecords = nk.storageRead([{ collection: "winback", key: "claimed", userId: ctx.userId }]);
        if (winbackRecords.length > 0 && winbackRecords[0].value.lastTier === tier.tier) {
            return JSON.stringify({ success: false, error: "Already claimed" });
        }

        nk.storageWrite([{ collection: "winback", key: "claimed", userId: ctx.userId, value: { lastTier: tier.tier, claimedAt: new Date().toISOString() }, permissionRead: 1, permissionWrite: 0 }]);

        return JSON.stringify({ success: true, tier: tier.tier, rewards: tier.rewards, daysAway: daysAway });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcWinbackRecordSession(ctx, logger, nk, payload) {
    if (!ctx.userId) return JSON.stringify({ success: false, error: "Not authenticated" });

    try {
        var records = nk.storageRead([{ collection: "user_sessions", key: "last_session", userId: ctx.userId }]);
        var sessionCount = records.length > 0 ? (records[0].value.totalSessions || 0) + 1 : 1;

        nk.storageWrite([{
            collection: "user_sessions",
            key: "last_session",
            userId: ctx.userId,
            value: { lastSessionTime: new Date().toISOString(), totalSessions: sessionCount },
            permissionRead: 1,
            permissionWrite: 0
        }]);

        return JSON.stringify({ success: true, sessionCount: sessionCount });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

function rpcWinbackScheduleReengagement(ctx, logger, nk, payload) {
    return JSON.stringify({ success: true, message: "Re-engagement notifications scheduled" });
}


// ============================================================================
// PROGRESSION/PROGRESSIVE_UNLOCKS.JS
// ============================================================================

/**
 * Progressive Content Unlocks Module
 * Unlocks game features over the first 7 days to maintain engagement
 *
 * Impact: D7 +5% retention
 */

// ============================================================================
// UNLOCK CONFIGURATION
// ============================================================================

var UNLOCK_CONFIG = {
    // Day 1: Basic features (default)
    day1: {
        features: ["basic_quiz", "championship", "daily_quiz"],
        rewards: { coins: 50 },
        message: "Welcome! Start your trivia journey!"
    },
    // Day 2: Engagement features
    day2: {
        features: ["lucky_wheel", "daily_streak", "power_ups"],
        rewards: { coins: 100, energy: 3 },
        message: "ðŸŽ¡ Lucky Wheel unlocked! Spin for rewards!",
        requirement: { type: "login", day: 2 }
    },
    // Day 3: Social features
    day3: {
        features: ["multiplayer", "friends_list", "chat"],
        rewards: { coins: 150, gems: 10 },
        message: "âš”ï¸ Multiplayer unlocked! Battle friends!",
        requirement: { type: "quizzes_won", count: 3 }
    },
    // Day 4: Content creation
    day4: {
        features: ["link_and_play", "custom_quizzes", "share_quiz"],
        rewards: { coins: 200, gems: 15 },
        message: "ðŸ“š Link & Play unlocked! Create your own quizzes!",
        requirement: { type: "login", day: 4 }
    },
    // Day 5: Advanced modes
    day5: {
        features: ["survival_mode", "timed_challenge", "hard_mode"],
        rewards: { coins: 250, gems: 20, mystery_box: 1 },
        message: "ðŸ’€ Survival Mode unlocked! How long can you last?",
        requirement: { type: "quizzes_completed", count: 10 }
    },
    // Day 6: Competitive features
    day6: {
        features: ["weekly_tournament", "global_leaderboard", "rankings"],
        rewards: { coins: 300, gems: 25 },
        message: "ðŸ† Weekly Tournament unlocked! Compete globally!",
        requirement: { type: "login", day: 6 }
    },
    // Day 7: Premium trial
    day7: {
        features: ["premium_trial", "all_categories", "ad_free_trial"],
        rewards: { coins: 500, gems: 50, premium_days: 3 },
        message: "ðŸ‘‘ VIP Trial unlocked! 3 days of Premium FREE!",
        requirement: { type: "login", day: 7 }
    }
};

// All possible features
var ALL_FEATURES_PROGRESSIVE = [
    "basic_quiz", "championship", "daily_quiz",
    "lucky_wheel", "daily_streak", "power_ups",
    "multiplayer", "friends_list", "chat",
    "link_and_play", "custom_quizzes", "share_quiz",
    "survival_mode", "timed_challenge", "hard_mode",
    "weekly_tournament", "global_leaderboard", "rankings",
    "premium_trial", "all_categories", "ad_free_trial"
];

// ============================================================================
// STORAGE KEYS
// ============================================================================

var STORAGE_COLLECTION_PROG = "progression";
var STORAGE_KEY_UNLOCKS = "progressive_unlocks";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getUnlockData(nk, userId) {
    try {
        var objects = nk.storageRead([{
            collection: STORAGE_COLLECTION_PROG,
            key: STORAGE_KEY_UNLOCKS,
            userId: userId
        }]);

        if (objects && objects.length > 0) {
            return objects[0].value;
        }
    } catch (e) {
        // No data yet
    }

    // Initialize default data
    return {
        firstLoginDate: Date.now(),
        currentDay: 1,
        unlockedFeatures: UNLOCK_CONFIG.day1.features.slice(),
        claimedDays: [1],
        totalQuizzesCompleted: 0,
        totalQuizzesWon: 0,
        lastCheckDate: Date.now()
    };
}

function saveUnlockData(nk, userId, data) {
    data.lastUpdated = Date.now();

    nk.storageWrite([{
        collection: STORAGE_COLLECTION_PROG,
        key: STORAGE_KEY_UNLOCKS,
        userId: userId,
        value: data,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function calculateCurrentDay(firstLoginDate) {
    var now = Date.now();
    var daysSinceFirst = Math.floor((now - firstLoginDate) / (24 * 60 * 60 * 1000));
    return Math.min(daysSinceFirst + 1, 7); // Cap at day 7
}

function checkRequirementProgressive(data, requirement) {
    if (!requirement) return true;

    switch (requirement.type) {
        case "login":
            return data.currentDay >= requirement.day;
        case "quizzes_won":
            return data.totalQuizzesWon >= requirement.count;
        case "quizzes_completed":
            return data.totalQuizzesCompleted >= requirement.count;
        default:
            return true;
    }
}

function grantRewardsProgressive(nk, userId, rewards, logger) {
    if (!rewards) return;

    try {
        // Grant coins
        if (rewards.coins) {
            nk.walletUpdate(userId, { coins: rewards.coins }, {}, true);
            logger.info("Granted " + rewards.coins + " coins to " + userId);
        }

        // Grant gems
        if (rewards.gems) {
            nk.walletUpdate(userId, { gems: rewards.gems }, {}, true);
            logger.info("Granted " + rewards.gems + " gems to " + userId);
        }

        // Grant energy
        if (rewards.energy) {
            nk.walletUpdate(userId, { energy: rewards.energy }, {}, true);
        }

        // Grant premium days
        if (rewards.premium_days) {
            var premiumExpiry = Date.now() + (rewards.premium_days * 24 * 60 * 60 * 1000);
            nk.storageWrite([{
                collection: "premium",
                key: "trial",
                userId: userId,
                value: { expiresAt: premiumExpiry, type: "trial" },
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }

        // Grant mystery box
        if (rewards.mystery_box) {
            var inventoryData = { mystery_boxes: rewards.mystery_box };
            nk.walletUpdate(userId, inventoryData, {}, true);
        }
    } catch (e) {
        logger.error("Error granting rewards: " + e.message);
    }
}

// ============================================================================
// RPC FUNCTIONS
// ============================================================================

/**
 * Get current unlock state
 * Returns: unlockedFeatures, currentDay, nextUnlock, progress
 */
function rpcGetUnlockState(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }

    var data = getUnlockData(nk, ctx.userId);

    // Update current day
    data.currentDay = calculateCurrentDay(data.firstLoginDate);
    saveUnlockData(nk, ctx.userId, data);

    // Calculate next unlock info
    var nextDay = null;
    var nextUnlock = null;

    for (var day = 1; day <= 7; day++) {
        var dayKey = "day" + day;
        var config = UNLOCK_CONFIG[dayKey];

        if (config && data.claimedDays.indexOf(day) === -1) {
            nextDay = day;
            nextUnlock = {
                day: day,
                features: config.features,
                rewards: config.rewards,
                message: config.message,
                canClaim: checkRequirementProgressive(data, config.requirement),
                requirement: config.requirement
            };
            break;
        }
    }

    // Build locked features list
    var lockedFeatures = [];
    ALL_FEATURES_PROGRESSIVE.forEach(function(feature) {
        if (data.unlockedFeatures.indexOf(feature) === -1) {
            lockedFeatures.push(feature);
        }
    });

    return JSON.stringify({
        success: true,
        data: {
            currentDay: data.currentDay,
            firstLoginDate: data.firstLoginDate,
            unlockedFeatures: data.unlockedFeatures,
            lockedFeatures: lockedFeatures,
            claimedDays: data.claimedDays,
            nextUnlock: nextUnlock,
            totalQuizzesCompleted: data.totalQuizzesCompleted,
            totalQuizzesWon: data.totalQuizzesWon,
            allUnlocked: data.claimedDays.length >= 7
        }
    });
}

/**
 * Claim unlock for a specific day
 * Payload: { day: number }
 */
function rpcClaimUnlock(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }

    var request = {};
    try {
        request = JSON.parse(payload || "{}");
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid payload" });
    }

    var day = request.day;
    if (!day || day < 1 || day > 7) {
        return JSON.stringify({ success: false, error: "Invalid day" });
    }

    var data = getUnlockData(nk, ctx.userId);
    data.currentDay = calculateCurrentDay(data.firstLoginDate);

    // Check if already claimed
    if (data.claimedDays.indexOf(day) !== -1) {
        return JSON.stringify({ success: false, error: "Already claimed" });
    }

    // Check if day is reachable
    if (day > data.currentDay) {
        return JSON.stringify({ success: false, error: "Day not yet available" });
    }

    // Check requirements
    var dayKey = "day" + day;
    var config = UNLOCK_CONFIG[dayKey];

    if (!config) {
        return JSON.stringify({ success: false, error: "Invalid day config" });
    }

    if (!checkRequirementProgressive(data, config.requirement)) {
        return JSON.stringify({
            success: false,
            error: "Requirement not met",
            requirement: config.requirement
        });
    }

    // Claim the unlock
    data.claimedDays.push(day);
    config.features.forEach(function(feature) {
        if (data.unlockedFeatures.indexOf(feature) === -1) {
            data.unlockedFeatures.push(feature);
        }
    });

    // Grant rewards
    grantRewardsProgressive(nk, ctx.userId, config.rewards, logger);

    // Save
    saveUnlockData(nk, ctx.userId, data);

    logger.info("User " + ctx.userId + " claimed Day " + day + " unlock");

    return JSON.stringify({
        success: true,
        data: {
            day: day,
            unlockedFeatures: config.features,
            rewards: config.rewards,
            message: config.message,
            allUnlockedFeatures: data.unlockedFeatures
        }
    });
}

/**
 * Check if a specific feature is unlocked
 */
function rpcCheckFeatureUnlocked(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }

    var request = {};
    try {
        request = JSON.parse(payload || "{}");
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid payload" });
    }

    var feature = request.feature;
    if (!feature) {
        return JSON.stringify({ success: false, error: "Feature required" });
    }

    var data = getUnlockData(nk, ctx.userId);
    var isUnlocked = data.unlockedFeatures.indexOf(feature) !== -1;

    // Find which day unlocks this feature
    var unlockDay = null;
    for (var day = 1; day <= 7; day++) {
        var config = UNLOCK_CONFIG["day" + day];
        if (config && config.features.indexOf(feature) !== -1) {
            unlockDay = day;
            break;
        }
    }

    return JSON.stringify({
        success: true,
        data: {
            feature: feature,
            isUnlocked: isUnlocked,
            unlockDay: unlockDay,
            currentDay: calculateCurrentDay(data.firstLoginDate)
        }
    });
}

/**
 * Update progress (quizzes completed/won)
 */
function rpcUpdateProgressProgressive(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }

    var request = {};
    try {
        request = JSON.parse(payload || "{}");
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid payload" });
    }

    var data = getUnlockData(nk, ctx.userId);

    if (request.quizCompleted) {
        data.totalQuizzesCompleted++;
    }
    if (request.quizWon) {
        data.totalQuizzesWon++;
    }

    data.currentDay = calculateCurrentDay(data.firstLoginDate);
    saveUnlockData(nk, ctx.userId, data);

    // Check if any new unlocks are available
    var newUnlocksAvailable = [];
    for (var day = 1; day <= data.currentDay; day++) {
        if (data.claimedDays.indexOf(day) === -1) {
            var config = UNLOCK_CONFIG["day" + day];
            if (config && checkRequirementProgressive(data, config.requirement)) {
                newUnlocksAvailable.push({
                    day: day,
                    features: config.features,
                    message: config.message
                });
            }
        }
    }

    return JSON.stringify({
        success: true,
        data: {
            totalQuizzesCompleted: data.totalQuizzesCompleted,
            totalQuizzesWon: data.totalQuizzesWon,
            newUnlocksAvailable: newUnlocksAvailable
        }
    });
}

// ============================================================================
// PROGRESSION/MASTERY_SYSTEM.JS
// ============================================================================

/**
 * Prestige & Category Mastery System
 * Rewards deep engagement with specific categories and long-term progression
 *
 * Impact: D30 +10% retention, increases session duration
 */

// ============================================================================
// MASTERY CONFIGURATION
// ============================================================================

var MASTERY_CONFIG_PROG = {
    // XP needed for each level in a category
    levels: [
        0,      // Level 0
        100,    // Level 1
        250,    // Level 2
        500,    // Level 3 (Bronze Badge)
        1000,   // Level 4
        2000,   // Level 5 (Silver Badge)
        4000,   // Level 6
        8000,   // Level 7 (Gold Badge)
        15000,  // Level 8
        30000   // Level 9 (Platinum Badge)
    ],

    // Rewards for reaching levels
    rewards: {
        3: { coins: 500, badge: "bronze" },
        5: { coins: 1500, gems: 20, badge: "silver" },
        7: { coins: 5000, gems: 100, badge: "gold" },
        9: { coins: 15000, gems: 500, badge: "platinum" }
    },

    // Prestige configuration
    prestige: {
        maxMasteryLevel: 9,
        prestigeLevels: [
            { id: 1, name: "Novice", xpBoost: 1.1, coinBoost: 1.05, requirements: { totalMastery: 5 } },
            { id: 2, name: "Scholar", xpBoost: 1.2, coinBoost: 1.1, requirements: { totalMastery: 15 } },
            { id: 3, name: "Sage", xpBoost: 1.5, coinBoost: 1.2, requirements: { totalMastery: 40 } },
            { id: 4, name: "Master", xpBoost: 2.0, coinBoost: 1.5, requirements: { totalMastery: 80 } },
            { id: 5, name: "Legend", xpBoost: 3.0, coinBoost: 2.0, requirements: { totalMastery: 150 } }
        ]
    }
};

// ============================================================================
// STORAGE KEYS
// ============================================================================

var STORAGE_KEY_MASTERY_PROG = "category_mastery";
var STORAGE_KEY_PRESTIGE_PROG = "prestige_data";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getMasteryDataProg(nk, userId) {
    try {
        var objects = nk.storageRead([{
            collection: STORAGE_COLLECTION_PROG,
            key: STORAGE_KEY_MASTERY_PROG,
            userId: userId
        }]);

        if (objects && objects.length > 0) {
            return objects[0].value;
        }
    } catch (e) {
        // No data yet
    }

    return {
        categories: {}, // categoryId -> { xp, level, badges: [] }
        totalMasteryLevel: 0,
        lastUpdated: Date.now()
    };
}

function getPrestigeDataProg(nk, userId) {
    try {
        var objects = nk.storageRead([{
            collection: STORAGE_COLLECTION_PROG,
            key: STORAGE_KEY_PRESTIGE_PROG,
            userId: userId
        }]);

        if (objects && objects.length > 0) {
            return objects[0].value;
        }
    } catch (e) {
        // No data yet
    }

    return {
        prestigeLevel: 0,
        unlockedPrestigeNames: [],
        currentXpBoost: 1.0,
        currentCoinBoost: 1.0,
        lastUpdated: Date.now()
    };
}

function saveMasteryDataProg(nk, userId, data) {
    data.lastUpdated = Date.now();
    nk.storageWrite([{
        collection: STORAGE_COLLECTION_PROG,
        key: STORAGE_KEY_MASTERY_PROG,
        userId: userId,
        value: data,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function savePrestigeDataProg(nk, userId, data) {
    data.lastUpdated = Date.now();
    nk.storageWrite([{
        collection: STORAGE_COLLECTION_PROG,
        key: STORAGE_KEY_PRESTIGE_PROG,
        userId: userId,
        value: data,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function calculateLevelProg(xp) {
    var level = 0;
    for (var i = 0; i < MASTERY_CONFIG_PROG.levels.length; i++) {
        if (xp >= MASTERY_CONFIG_PROG.levels[i]) {
            level = i;
        } else {
            break;
        }
    }
    return level;
}

// ============================================================================
// RPC FUNCTIONS
// ============================================================================

/**
 * Add XP to a category after a quiz
 * Payload: { categoryId: string, xp: number }
 */
function rpcProgressionAddMasteryXp(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }

    var request = {};
    try {
        request = JSON.parse(payload || "{}");
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid payload" });
    }

    var categoryId = request.categoryId;
    var xpToAdd = request.xp || 0;

    if (!categoryId) {
        return JSON.stringify({ success: false, error: "Category ID required" });
    }

    var masteryData = getMasteryDataProg(nk, ctx.userId);
    var prestigeData = getPrestigeDataProg(nk, ctx.userId);

    // Apply prestige boost
    var boostedXp = Math.floor(xpToAdd * (prestigeData.currentXpBoost || 1.0));

    if (!masteryData.categories[categoryId]) {
        masteryData.categories[categoryId] = { xp: 0, level: 0, badges: [] };
    }

    var oldLevel = masteryData.categories[categoryId].level;
    masteryData.categories[categoryId].xp += boostedXp;
    var newLevel = calculateLevelProg(masteryData.categories[categoryId].xp);

    var levelUps = [];
    if (newLevel > oldLevel) {
        masteryData.categories[categoryId].level = newLevel;

        // Grant rewards for each level up
        for (var l = oldLevel + 1; l <= newLevel; l++) {
            var reward = MASTERY_CONFIG_PROG.rewards[l];
            if (reward) {
                // Grant rewards to wallet
                var walletChanges = {};
                if (reward.coins) walletChanges.coins = reward.coins;
                if (reward.gems) walletChanges.gems = reward.gems;

                if (Object.keys(walletChanges).length > 0) {
                    nk.walletUpdate(ctx.userId, walletChanges, {}, true);
                }

                if (reward.badge) {
                    masteryData.categories[categoryId].badges.push(reward.badge);
                }

                levelUps.push({ level: l, reward: reward });
            } else {
                levelUps.push({ level: l });
            }
        }

        // Update total mastery level
        var total = 0;
        for (var cat in masteryData.categories) {
            total += masteryData.categories[cat].level;
        }
        masteryData.totalMasteryLevel = total;
    }

    saveMasteryDataProg(nk, ctx.userId, masteryData);

    return JSON.stringify({
        success: true,
        data: {
            categoryId: categoryId,
            addedXp: boostedXp,
            totalXp: masteryData.categories[categoryId].xp,
            level: newLevel,
            levelUps: levelUps,
            totalMasteryLevel: masteryData.totalMasteryLevel
        }
    });
}

/**
 * Get current mastery and prestige state
 */
function rpcProgressionGetState(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }

    var masteryData = getMasteryDataProg(nk, ctx.userId);
    var prestigeData = getPrestigeDataProg(nk, ctx.userId);

    // Check if new prestige levels are available
    var nextPrestige = null;
    for (var i = 0; i < MASTERY_CONFIG_PROG.prestige.prestigeLevels.length; i++) {
        var p = MASTERY_CONFIG_PROG.prestige.prestigeLevels[i];
        if (p.id > prestigeData.prestigeLevel) {
            var met = masteryData.totalMasteryLevel >= p.requirements.totalMastery;
            nextPrestige = {
                id: p.id,
                name: p.name,
                requirements: p.requirements,
                met: met,
                xpBoost: p.xpBoost,
                coinBoost: p.coinBoost
            };
            break;
        }
    }

    return JSON.stringify({
        success: true,
        data: {
            mastery: masteryData,
            prestige: prestigeData,
            nextPrestige: nextPrestige,
            levelConfig: MASTERY_CONFIG_PROG.levels
        }
    });
}

/**
 * Claim a prestige level if requirements are met
 */
function rpcProgressionClaimPrestige(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }

    var masteryData = getMasteryDataProg(nk, ctx.userId);
    var prestigeData = getPrestigeDataProg(nk, ctx.userId);

    var nextLevelId = prestigeData.prestigeLevel + 1;
    var nextLevelConfig = null;

    for (var i = 0; i < MASTERY_CONFIG_PROG.prestige.prestigeLevels.length; i++) {
        if (MASTERY_CONFIG_PROG.prestige.prestigeLevels[i].id === nextLevelId) {
            nextLevelConfig = MASTERY_CONFIG_PROG.prestige.prestigeLevels[i];
            break;
        }
    }

    if (!nextLevelConfig) {
        return JSON.stringify({ success: false, error: "No more prestige levels" });
    }

    if (masteryData.totalMasteryLevel < nextLevelConfig.requirements.totalMastery) {
        return JSON.stringify({ success: false, error: "Requirements not met" });
    }

    // Update prestige
    prestigeData.prestigeLevel = nextLevelConfig.id;
    prestigeData.unlockedPrestigeNames.push(nextLevelConfig.name);
    prestigeData.currentXpBoost = nextLevelConfig.xpBoost;
    prestigeData.currentCoinBoost = nextLevelConfig.coinBoost;

    savePrestigeDataProg(nk, ctx.userId, prestigeData);

    logger.info("User " + ctx.userId + " reached prestige level " + nextLevelConfig.id + " (" + nextLevelConfig.name + ")");

    return JSON.stringify({
        success: true,
        data: {
            prestigeLevel: prestigeData.prestigeLevel,
            name: nextLevelConfig.name,
            xpBoost: prestigeData.currentXpBoost,
            coinBoost: prestigeData.currentCoinBoost
        }
    });
}


// ============================================================================
// REWARDED ADS SYSTEM - Server-Validated Ad Rewards
// Prevents auto-shown rewards, duplicate claims, and replay attacks
// ============================================================================

var REWARDED_AD_TOKEN_EXPIRY_SECONDS = 300; // 5 minutes
var REWARDED_AD_TOKEN_COLLECTION = "rewarded_ad_tokens";
var REWARDED_AD_CLAIMS_COLLECTION = "rewarded_ad_claims";

var REWARDED_AD_CONFIG = {
    "double_score": {
        rewardType: "score_multiplier",
        multiplier: 2,
        cooldownSeconds: 0,
        maxClaimsPerDay: 10
    },
    "extra_time": {
        rewardType: "currency",
        currency: "time_bonus",
        amount: 30,
        cooldownSeconds: 60,
        maxClaimsPerDay: 20
    },
    "free_hint": {
        rewardType: "currency",
        currency: "hints",
        amount: 1,
        cooldownSeconds: 30,
        maxClaimsPerDay: 30
    },
    "bonus_coins": {
        rewardType: "currency",
        currency: "coins",
        amount: 100,
        cooldownSeconds: 120,
        maxClaimsPerDay: 15
    },
    "default": {
        rewardType: "currency",
        currency: "coins",
        amount: 50,
        cooldownSeconds: 60,
        maxClaimsPerDay: 50
    }
};

function generateAdRewardToken() {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var token = "";
    for (var i = 0; i < 32; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    token += "_" + Date.now().toString(36);
    return token;
}

function getAdRewardStartOfDay() {
    var now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    return Math.floor(now.getTime() / 1000);
}

function getAdDailyClaimCount(nk, logger, userId, placement) {
    var key = "daily_claims_" + getAdRewardStartOfDay();
    try {
        var records = nk.storageRead([{
            collection: REWARDED_AD_CLAIMS_COLLECTION,
            key: key,
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value[placement] || 0;
        }
    } catch (err) {
        logger.warn("[RewardedAds] Failed to read daily claims: " + err.message);
    }
    return 0;
}

function incrementAdDailyClaimCount(nk, logger, userId, placement) {
    var key = "daily_claims_" + getAdRewardStartOfDay();
    var claims = {};
    try {
        var records = nk.storageRead([{
            collection: REWARDED_AD_CLAIMS_COLLECTION,
            key: key,
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            claims = records[0].value;
        }
    } catch (err) { /* continue */ }

    claims[placement] = (claims[placement] || 0) + 1;
    claims.updatedAt = new Date().toISOString();

    try {
        nk.storageWrite([{
            collection: REWARDED_AD_CLAIMS_COLLECTION,
            key: key,
            userId: userId,
            value: claims,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error("[RewardedAds] Failed to increment daily claims: " + err.message);
        return false;
    }
}

function getAdLastClaimTimestamp(nk, logger, userId, placement) {
    var key = "last_claim_" + placement;
    try {
        var records = nk.storageRead([{
            collection: REWARDED_AD_CLAIMS_COLLECTION,
            key: key,
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value.timestamp || 0;
        }
    } catch (err) {
        logger.warn("[RewardedAds] Failed to read last claim: " + err.message);
    }
    return 0;
}

function updateAdLastClaimTimestamp(nk, logger, userId, placement) {
    var key = "last_claim_" + placement;
    var now = Math.floor(Date.now() / 1000);
    try {
        nk.storageWrite([{
            collection: REWARDED_AD_CLAIMS_COLLECTION,
            key: key,
            userId: userId,
            value: {
                timestamp: now,
                placement: placement,
                updatedAt: new Date().toISOString()
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error("[RewardedAds] Failed to update last claim: " + err.message);
        return false;
    }
}

/**
 * RPC: Request a reward token BEFORE showing ad (user clicks button)
 * Payload: { placement: string, gameId: string, metadata?: object }
 */
function rpcRewardedAdRequestToken(ctx, logger, nk, payload) {
    logger.info("[RewardedAds] Token request from user: " + ctx.userId);

    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ success: false, error: "Authentication required" });
    }

    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid payload" });
    }

    var placement = data.placement || "default";
    var gameId = data.gameId || "unknown";
    var metadata = data.metadata || {};

    var config = REWARDED_AD_CONFIG[placement] || REWARDED_AD_CONFIG["default"];

    // Check daily claim limit
    var dailyClaims = getAdDailyClaimCount(nk, logger, userId, placement);
    if (dailyClaims >= config.maxClaimsPerDay) {
        logger.warn("[RewardedAds] Daily limit reached for user: " + userId);
        return JSON.stringify({
            success: false,
            error: "Daily limit reached",
            dailyClaims: dailyClaims,
            maxClaimsPerDay: config.maxClaimsPerDay,
            resetAt: getAdRewardStartOfDay() + 86400
        });
    }

    // Check cooldown
    var now = Math.floor(Date.now() / 1000);
    var lastClaim = getAdLastClaimTimestamp(nk, logger, userId, placement);
    var cooldownRemaining = (lastClaim + config.cooldownSeconds) - now;

    if (cooldownRemaining > 0) {
        logger.info("[RewardedAds] Cooldown active for user: " + userId);
        return JSON.stringify({
            success: false,
            error: "Cooldown active",
            cooldownRemaining: cooldownRemaining,
            canClaimAt: lastClaim + config.cooldownSeconds
        });
    }

    // Generate unique token
    var token = generateAdRewardToken();
    var expiresAt = now + REWARDED_AD_TOKEN_EXPIRY_SECONDS;

    var tokenData = {
        token: token,
        userId: userId,
        placement: placement,
        gameId: gameId,
        metadata: metadata,
        createdAt: now,
        expiresAt: expiresAt,
        consumed: false,
        clientIp: ctx.clientIp || "unknown",
        sessionId: ctx.sessionId || "unknown"
    };

    try {
        nk.storageWrite([{
            collection: REWARDED_AD_TOKEN_COLLECTION,
            key: token,
            userId: userId,
            value: tokenData,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[RewardedAds] Token generated for user: " + userId + ", placement: " + placement);

        return JSON.stringify({
            success: true,
            token: token,
            expiresIn: REWARDED_AD_TOKEN_EXPIRY_SECONDS,
            expiresAt: expiresAt,
            placement: placement,
            rewardConfig: {
                type: config.rewardType,
                currency: config.currency,
                amount: config.amount,
                multiplier: config.multiplier
            }
        });
    } catch (err) {
        logger.error("[RewardedAds] Failed to store token: " + err.message);
        return JSON.stringify({ success: false, error: "Failed to generate token" });
    }
}

/**
 * RPC: Claim reward after ad was watched
 * Payload: { token: string, adCompleted: bool, adNetwork?: string, metadata?: object }
 */
function rpcRewardedAdClaim(ctx, logger, nk, payload) {
    logger.info("[RewardedAds] Claim request from user: " + ctx.userId);

    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ success: false, error: "Authentication required" });
    }

    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid payload" });
    }

    var token = data.token;
    var adCompleted = data.adCompleted === true;
    var adNetwork = data.adNetwork || "unknown";
    var claimMetadata = data.metadata || {};

    if (!token) {
        logger.warn("[RewardedAds] Claim attempt without token from user: " + userId);
        return JSON.stringify({ success: false, error: "Token required" });
    }

    if (!adCompleted) {
        logger.info("[RewardedAds] Ad not completed for user: " + userId);
        return JSON.stringify({ success: false, error: "Ad was not completed" });
    }

    // Read and validate token
    var tokenData = null;
    try {
        var records = nk.storageRead([{
            collection: REWARDED_AD_TOKEN_COLLECTION,
            key: token,
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            tokenData = records[0].value;
        }
    } catch (err) {
        logger.error("[RewardedAds] Failed to read token: " + err.message);
        return JSON.stringify({ success: false, error: "Token validation failed" });
    }

    if (!tokenData) {
        logger.warn("[RewardedAds] Invalid token from user: " + userId);
        return JSON.stringify({ success: false, error: "Invalid or expired token" });
    }

    if (tokenData.userId !== userId) {
        logger.warn("[RewardedAds] Token ownership mismatch");
        return JSON.stringify({ success: false, error: "Token does not belong to user" });
    }

    if (tokenData.consumed) {
        logger.warn("[RewardedAds] Token already consumed");
        return JSON.stringify({ success: false, error: "Reward already claimed" });
    }

    var now = Math.floor(Date.now() / 1000);
    if (now > tokenData.expiresAt) {
        logger.warn("[RewardedAds] Token expired");
        return JSON.stringify({ success: false, error: "Token expired" });
    }

    var placement = tokenData.placement;
    var gameId = tokenData.gameId;
    var config = REWARDED_AD_CONFIG[placement] || REWARDED_AD_CONFIG["default"];

    // Mark token as consumed FIRST (prevent race conditions)
    tokenData.consumed = true;
    tokenData.consumedAt = now;
    tokenData.adNetwork = adNetwork;
    tokenData.claimMetadata = claimMetadata;

    try {
        nk.storageWrite([{
            collection: REWARDED_AD_TOKEN_COLLECTION,
            key: token,
            userId: userId,
            value: tokenData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (err) {
        logger.error("[RewardedAds] Failed to mark token consumed: " + err.message);
        return JSON.stringify({ success: false, error: "Claim processing failed" });
    }

    var rewardResult = null;

    if (config.rewardType === "score_multiplier") {
        var authToken = generateAdRewardToken();
        rewardResult = {
            type: "score_multiplier",
            multiplier: config.multiplier,
            authorized: true,
            authorizationToken: authToken,
            expiresIn: 60
        };

        try {
            nk.storageWrite([{
                collection: "score_multiplier_auth",
                key: authToken,
                userId: userId,
                value: {
                    multiplier: config.multiplier,
                    placement: placement,
                    gameId: gameId,
                    createdAt: now,
                    expiresAt: now + 60,
                    used: false
                },
                permissionRead: 1,
                permissionWrite: 0
            }]);
        } catch (err) {
            logger.error("[RewardedAds] Failed to store score auth: " + err.message);
        }
    } else if (config.rewardType === "currency") {
        var changeset = {};
        changeset[config.currency] = config.amount;
        var walletMeta = {
            source: "rewarded_ad",
            placement: placement,
            gameId: gameId,
            grantedAt: new Date().toISOString()
        };

        try {
            var results = nk.walletUpdate(userId, changeset, walletMeta, true);
            logger.info("[RewardedAds] Wallet updated for user: " + userId);
            rewardResult = {
                type: "currency",
                currency: config.currency,
                amount: config.amount,
                walletUpdate: {
                    success: true,
                    previousBalance: results.previous ? results.previous[config.currency] || 0 : 0,
                    newBalance: results.updated ? results.updated[config.currency] || config.amount : config.amount,
                    change: config.amount
                }
            };
        } catch (err) {
            logger.error("[RewardedAds] Wallet update failed: " + err.message);
            rewardResult = {
                type: "currency",
                currency: config.currency,
                amount: config.amount,
                walletUpdate: { success: false, error: err.message }
            };
        }
    }

    incrementAdDailyClaimCount(nk, logger, userId, placement);
    updateAdLastClaimTimestamp(nk, logger, userId, placement);

    logger.info("[RewardedAds] Reward claimed successfully. User: " + userId + ", Placement: " + placement);

    return JSON.stringify({
        success: true,
        placement: placement,
        reward: rewardResult,
        dailyClaims: getAdDailyClaimCount(nk, logger, userId, placement),
        maxClaimsPerDay: config.maxClaimsPerDay
    });
}

/**
 * RPC: Validate score multiplier authorization
 * Payload: { authorizationToken: string, originalScore: number, multipliedScore: number }
 */
function rpcValidateScoreMultiplier(ctx, logger, nk, payload) {
    logger.info("[RewardedAds] Score multiplier validation from user: " + ctx.userId);

    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ success: false, error: "Authentication required" });
    }

    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid payload" });
    }

    var authToken = data.authorizationToken;
    var originalScore = data.originalScore;
    var multipliedScore = data.multipliedScore;

    if (!authToken) {
        return JSON.stringify({ success: false, error: "Authorization token required" });
    }

    var authData = null;
    try {
        var records = nk.storageRead([{
            collection: "score_multiplier_auth",
            key: authToken,
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            authData = records[0].value;
        }
    } catch (err) {
        logger.error("[RewardedAds] Failed to read auth: " + err.message);
        return JSON.stringify({ success: false, error: "Validation failed" });
    }

    if (!authData) {
        logger.warn("[RewardedAds] Invalid score auth token");
        return JSON.stringify({ success: false, error: "Invalid authorization" });
    }

    if (authData.used) {
        logger.warn("[RewardedAds] Score auth already used");
        return JSON.stringify({ success: false, error: "Authorization already used" });
    }

    var now = Math.floor(Date.now() / 1000);
    if (now > authData.expiresAt) {
        logger.warn("[RewardedAds] Score auth expired");
        return JSON.stringify({ success: false, error: "Authorization expired" });
    }

    var expectedScore = originalScore * authData.multiplier;
    if (multipliedScore !== expectedScore) {
        logger.warn("[RewardedAds] Score mismatch. Expected: " + expectedScore + ", Got: " + multipliedScore);
        return JSON.stringify({ success: false, error: "Score calculation mismatch" });
    }

    authData.used = true;
    authData.usedAt = now;
    authData.originalScore = originalScore;
    authData.multipliedScore = multipliedScore;

    try {
        nk.storageWrite([{
            collection: "score_multiplier_auth",
            key: authToken,
            userId: userId,
            value: authData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (err) {
        logger.error("[RewardedAds] Failed to mark auth used: " + err.message);
    }

    logger.info("[RewardedAds] Score multiplier validated. User: " + userId);

    return JSON.stringify({
        success: true,
        authorized: true,
        originalScore: originalScore,
        multipliedScore: multipliedScore,
        multiplier: authData.multiplier
    });
}

/**
 * RPC: Get user's rewarded ad status
 * Payload: { placement?: string }
 */
function rpcGetRewardedAdStatus(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ success: false, error: "Authentication required" });
    }

    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) { /* continue */ }

    var requestedPlacement = data.placement;
    var now = Math.floor(Date.now() / 1000);
    var statuses = [];

    var placements = requestedPlacement ? [requestedPlacement] : Object.keys(REWARDED_AD_CONFIG);

    for (var i = 0; i < placements.length; i++) {
        var placement = placements[i];
        if (placement === "default" && !requestedPlacement) continue;

        var config = REWARDED_AD_CONFIG[placement] || REWARDED_AD_CONFIG["default"];
        var dailyClaims = getAdDailyClaimCount(nk, logger, userId, placement);
        var lastClaim = getAdLastClaimTimestamp(nk, logger, userId, placement);
        var cooldownRemaining = Math.max(0, (lastClaim + config.cooldownSeconds) - now);

        statuses.push({
            placement: placement,
            available: dailyClaims < config.maxClaimsPerDay && cooldownRemaining === 0,
            dailyClaims: dailyClaims,
            maxClaimsPerDay: config.maxClaimsPerDay,
            cooldownRemaining: cooldownRemaining,
            canClaimAt: cooldownRemaining > 0 ? lastClaim + config.cooldownSeconds : now,
            rewardType: config.rewardType,
            rewardAmount: config.amount,
            rewardCurrency: config.currency,
            multiplier: config.multiplier
        });
    }

    return JSON.stringify({
        success: true,
        placements: statuses,
        resetAt: getAdRewardStartOfDay() + 86400
    });
}


// ============================================================================
// GAME ENTRY COST SYSTEM - Server-Side Validation
// Enforces coin economy across ALL game modes
// ============================================================================

var GAME_MODE_COSTS = {
    // Solo Modes
    "quick_play": { entryCost: 10, rewardOnComplete: 5, rewardOnWin: 15, freeDaily: 3 },
    "championship": { entryCost: 25, rewardOnComplete: 10, rewardOnWin: 50, freeDaily: 2 },
    "daily_challenge": { entryCost: 15, rewardOnComplete: 20, rewardOnWin: 40, freeDaily: 1 },
    "practice": { entryCost: 5, rewardOnComplete: 2, rewardOnWin: 5, freeDaily: 5 },

    // Topic-Based
    "topic_quiz": { entryCost: 15, rewardOnComplete: 8, rewardOnWin: 25, freeDaily: 2 },
    "category_quiz": { entryCost: 15, rewardOnComplete: 8, rewardOnWin: 25, freeDaily: 2 },
    "pic_a_topic": { entryCost: 20, rewardOnComplete: 10, rewardOnWin: 30, freeDaily: 2 },

    // Multiplayer
    "online_multiplayer": { entryCost: 30, rewardOnComplete: 10, rewardOnWin: 60, freeDaily: 2 },
    "local_multiplayer": { entryCost: 20, rewardOnComplete: 8, rewardOnWin: 40, freeDaily: 3 },
    "party_mode": { entryCost: 25, rewardOnComplete: 10, rewardOnWin: 50, freeDaily: 2 },

    // Premium
    "daily_premium": { entryCost: 50, rewardOnComplete: 30, rewardOnWin: 100, freeDaily: 1 },
    "study_mode": { entryCost: 15, rewardOnComplete: 5, rewardOnWin: 10, freeDaily: 3 },
    "upload_doc": { entryCost: 30, rewardOnComplete: 15, rewardOnWin: 30, freeDaily: 2 },

    // Special
    "tournament": { entryCost: 100, rewardOnComplete: 25, rewardOnWin: 500, freeDaily: 0 },
    "weekly_challenge": { entryCost: 40, rewardOnComplete: 20, rewardOnWin: 150, freeDaily: 1 }
};

/**
 * RPC: game_entry_validate
 * Validates and processes game entry - deducts coins or uses free play
 */
function rpcGameEntryValidate(ctx, logger, nk, payload) {
    logger.info('[GameEntry] Validating game entry');

    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId;
        var gameId = data.gameId || "126bf539-dae2-4bcf-964d-316c0fa1f92b"; // QuizVerse default
        var gameMode = data.gameMode;
        var entryMethod = data.entryMethod || "coins"; // "coins", "free_play", "ad_entry"

        if (!gameMode) {
            return JSON.stringify({ success: false, error: "gameMode required" });
        }

        var config = GAME_MODE_COSTS[gameMode];
        if (!config) {
            return JSON.stringify({ success: false, error: "Unknown game mode: " + gameMode });
        }

        // Get user's wallet
        var walletKey = "wallet_" + userId + "_" + gameId;
        var walletRecords = nk.storageRead([{
            collection: "wallets",
            key: walletKey,
            userId: userId
        }]);

        var wallet = (walletRecords && walletRecords.length > 0) ? walletRecords[0].value : null;
        var currentBalance = wallet && wallet.currencies ? (wallet.currencies.game || wallet.currencies.tokens || 0) : 0;

        // Get daily tracking
        var today = new Date().toISOString().split('T')[0];
        var dailyKey = "game_entry_daily_" + userId + "_" + today;
        var dailyRecords = nk.storageRead([{
            collection: "game_entry_tracking",
            key: dailyKey,
            userId: userId
        }]);

        var dailyData = (dailyRecords && dailyRecords.length > 0) ? dailyRecords[0].value : {
            freePlaysUsed: {},
            adEntriesUsed: {},
            date: today
        };

        var freePlaysUsed = dailyData.freePlaysUsed[gameMode] || 0;
        var adEntriesUsed = dailyData.adEntriesUsed[gameMode] || 0;
        var MAX_AD_ENTRIES = 10;

        var entryGranted = false;
        var coinsDeducted = 0;
        var method = "";

        // Process entry based on method
        if (entryMethod === "free_play") {
            if (freePlaysUsed < config.freeDaily) {
                dailyData.freePlaysUsed[gameMode] = freePlaysUsed + 1;
                entryGranted = true;
                method = "free_play";
                logger.info("[GameEntry] Free play used for " + gameMode);
            } else {
                return JSON.stringify({
                    success: false,
                    error: "No free plays remaining",
                    freePlayesRemaining: 0
                });
            }
        } else if (entryMethod === "ad_entry") {
            if (adEntriesUsed < MAX_AD_ENTRIES) {
                dailyData.adEntriesUsed[gameMode] = adEntriesUsed + 1;
                entryGranted = true;
                method = "ad_entry";
                logger.info("[GameEntry] Ad entry used for " + gameMode);
            } else {
                return JSON.stringify({
                    success: false,
                    error: "Daily ad entry limit reached",
                    adEntriesRemaining: 0
                });
            }
        } else {
            // Coins entry
            if (currentBalance >= config.entryCost) {
                // Deduct coins
                if (wallet && wallet.currencies) {
                    wallet.currencies.game = (wallet.currencies.game || 0) - config.entryCost;
                    wallet.currencies.tokens = (wallet.currencies.tokens || 0) - config.entryCost;
                    wallet.updatedAt = new Date().toISOString();

                    nk.storageWrite([{
                        collection: "wallets",
                        key: walletKey,
                        userId: userId,
                        value: wallet,
                        permissionRead: 1,
                        permissionWrite: 0
                    }]);

                    coinsDeducted = config.entryCost;
                    entryGranted = true;
                    method = "coins";
                    logger.info("[GameEntry] Deducted " + config.entryCost + " coins for " + gameMode);
                }
            } else {
                return JSON.stringify({
                    success: false,
                    error: "Insufficient coins",
                    required: config.entryCost,
                    current: currentBalance,
                    shortfall: config.entryCost - currentBalance
                });
            }
        }

        if (!entryGranted) {
            return JSON.stringify({ success: false, error: "Entry not granted" });
        }

        // Save daily tracking
        nk.storageWrite([{
            collection: "game_entry_tracking",
            key: dailyKey,
            userId: userId,
            value: dailyData,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Generate entry token for game session validation
        var entryToken = generateEntryToken(userId, gameMode, Date.now());

        // Log the entry
        nk.storageWrite([{
            collection: "game_entry_logs",
            key: "entry_" + userId + "_" + Date.now(),
            userId: userId,
            value: {
                userId: userId,
                gameMode: gameMode,
                entryMethod: method,
                coinsDeducted: coinsDeducted,
                timestamp: new Date().toISOString(),
                entryToken: entryToken
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);

        return JSON.stringify({
            success: true,
            entryGranted: true,
            entryMethod: method,
            coinsDeducted: coinsDeducted,
            newBalance: wallet ? (wallet.currencies.game || 0) : currentBalance - coinsDeducted,
            entryToken: entryToken,
            freePlayesRemaining: Math.max(0, config.freeDaily - (dailyData.freePlaysUsed[gameMode] || 0)),
            adEntriesRemaining: Math.max(0, MAX_AD_ENTRIES - (dailyData.adEntriesUsed[gameMode] || 0)),
            potentialRewards: {
                onComplete: config.rewardOnComplete,
                onWin: config.rewardOnWin
            }
        });

    } catch (err) {
        logger.error("[GameEntry] Error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: game_entry_complete
 * Awards coins when game is completed
 */
function rpcGameEntryComplete(ctx, logger, nk, payload) {
    logger.info('[GameEntry] Processing game completion');

    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId;
        var gameId = data.gameId || "126bf539-dae2-4bcf-964d-316c0fa1f92b";
        var gameMode = data.gameMode;
        var won = data.won === true;
        var score = data.score || 0;
        var entryToken = data.entryToken;

        if (!gameMode) {
            return JSON.stringify({ success: false, error: "gameMode required" });
        }

        var config = GAME_MODE_COSTS[gameMode];
        if (!config) {
            return JSON.stringify({ success: false, error: "Unknown game mode" });
        }

        // Calculate rewards
        var reward = config.rewardOnComplete;
        if (won) {
            reward += config.rewardOnWin;
        }

        // Bonus for high scores (10% of score, capped at 50)
        var scoreBonus = Math.min(Math.floor(score / 10), 50);
        reward += scoreBonus;

        // Get and update wallet
        var walletKey = "wallet_" + userId + "_" + gameId;
        var walletRecords = nk.storageRead([{
            collection: "wallets",
            key: walletKey,
            userId: userId
        }]);

        var wallet = (walletRecords && walletRecords.length > 0) ? walletRecords[0].value : {
            userId: userId,
            currencies: { game: 0, tokens: 0 },
            createdAt: new Date().toISOString()
        };

        // Add reward
        wallet.currencies.game = (wallet.currencies.game || 0) + reward;
        wallet.currencies.tokens = (wallet.currencies.tokens || 0) + reward;
        wallet.updatedAt = new Date().toISOString();

        nk.storageWrite([{
            collection: "wallets",
            key: walletKey,
            userId: userId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info("[GameEntry] Awarded " + reward + " coins for " + gameMode + " (won: " + won + ", score: " + score + ")");

        return JSON.stringify({
            success: true,
            reward: reward,
            breakdown: {
                completion: config.rewardOnComplete,
                winBonus: won ? config.rewardOnWin : 0,
                scoreBonus: scoreBonus
            },
            won: won,
            newBalance: wallet.currencies.game
        });

    } catch (err) {
        logger.error("[GameEntry] Complete error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: game_entry_get_status
 * Get entry status for all game modes
 */
function rpcGameEntryGetStatus(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId;
        var gameId = data.gameId || "126bf539-dae2-4bcf-964d-316c0fa1f92b";

        // Get wallet balance
        var walletKey = "wallet_" + userId + "_" + gameId;
        var walletRecords = nk.storageRead([{
            collection: "wallets",
            key: walletKey,
            userId: userId
        }]);
        var wallet = (walletRecords && walletRecords.length > 0) ? walletRecords[0].value : null;
        var currentBalance = wallet && wallet.currencies ? (wallet.currencies.game || 0) : 0;

        // Get daily tracking
        var today = new Date().toISOString().split('T')[0];
        var dailyKey = "game_entry_daily_" + userId + "_" + today;
        var dailyRecords = nk.storageRead([{
            collection: "game_entry_tracking",
            key: dailyKey,
            userId: userId
        }]);
        var dailyData = (dailyRecords && dailyRecords.length > 0) ? dailyRecords[0].value : {
            freePlaysUsed: {},
            adEntriesUsed: {}
        };

        var MAX_AD_ENTRIES = 10;
        var modeStatuses = [];

        for (var mode in GAME_MODE_COSTS) {
            var config = GAME_MODE_COSTS[mode];
            var freePlaysUsed = dailyData.freePlaysUsed[mode] || 0;
            var adEntriesUsed = dailyData.adEntriesUsed[mode] || 0;

            modeStatuses.push({
                mode: mode,
                entryCost: config.entryCost,
                canAfford: currentBalance >= config.entryCost,
                freePlayesRemaining: Math.max(0, config.freeDaily - freePlaysUsed),
                adEntriesRemaining: Math.max(0, MAX_AD_ENTRIES - adEntriesUsed),
                rewardOnComplete: config.rewardOnComplete,
                rewardOnWin: config.rewardOnWin,
                hasAnyEntry: (currentBalance >= config.entryCost) ||
                             (freePlaysUsed < config.freeDaily) ||
                             (adEntriesUsed < MAX_AD_ENTRIES)
            });
        }

        return JSON.stringify({
            success: true,
            currentBalance: currentBalance,
            modes: modeStatuses,
            resetAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
        });

    } catch (err) {
        logger.error("[GameEntry] GetStatus error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * Generate entry token for session validation
 */
function generateEntryToken(userId, gameMode, timestamp) {
    var data = userId + "_" + gameMode + "_" + timestamp;
    // Simple hash for validation
    var hash = 0;
    for (var i = 0; i < data.length; i++) {
        hash = ((hash << 5) - hash) + data.charCodeAt(i);
        hash = hash & hash;
    }
    return "entry_" + Math.abs(hash).toString(16) + "_" + timestamp.toString(36);
}

// ============================================================================
// COMPATIBILITY QUIZ SYSTEM - Valentine's Day Feature (QuizVerse)
// ============================================================================

var COLLECTION_COMPATIBILITY_SESSIONS = 'compatibility_sessions';

/**
 * Generate a unique share code from session ID
 */
function compatibilityGenerateShareCode(sessionId) {
    return sessionId.replace(/-/g, '').substring(0, 8).toUpperCase();
}

/**
 * Send a push notification to a user for compatibility quiz
 */
function compatibilitySendNotification(nk, userId, subject, content, data) {
    try {
        var notifications = [{
            userId: userId,
            subject: subject,
            content: JSON.stringify({
                message: content,
                ...data
            }),
            code: 100,
            persistent: true
        }];
        nk.notificationsSend(notifications);
    } catch (e) {
        // Silently fail if notification fails
    }
}

/**
 * Convert internal session storage to Unity-compatible format
 * Status mapping: 0=WaitingForPartner, 1=PartnerJoined, 2=BothCompleted, 3=Expired, 4=Cancelled
 */
function compatibilitySessionToUnityFormat(session) {
    // Convert string status to numeric
    var statusMap = {
        'waiting_for_partner': 0,
        'partner_joined': 1,
        'creator_completed': 1,
        'partner_completed': 1,
        'both_completed': 2,
        'completed': 2,
        'expired': 3,
        'cancelled': 4
    };
    var numericStatus = typeof session.status === 'number' ? session.status : (statusMap[session.status] || 0);

    // Check expiry
    if (Date.now() > session.expiresAt && numericStatus < 2) {
        numericStatus = 3; // Expired
    }

    return {
        sessionId: session.sessionId || '',
        quizId: session.quizId || 'compatibility_quiz_v1',
        quizTitle: session.quizTitle || 'Compatibility Quiz',
        createdByUserId: session.creatorId || '',
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        playerA: {
            userId: session.creatorId || '',
            displayName: session.creatorName || 'Player A',
            isComplete: session.creatorCompleted || false,
            answers: session.creatorAnswers || [],
            traitScores: session.creatorTraitScores || {},
            resultId: session.creatorResultId || '',
            personalityTitle: session.creatorPersonalityTitle || '',
            personalityEmoji: session.creatorPersonalityEmoji || '',
            completedAt: session.creatorCompletedAt || 0
        },
        playerB: session.partnerId ? {
            userId: session.partnerId || '',
            displayName: session.partnerName || 'Player B',
            isComplete: session.partnerCompleted || false,
            answers: session.partnerAnswers || [],
            traitScores: session.partnerTraitScores || {},
            resultId: session.partnerResultId || '',
            personalityTitle: session.partnerPersonalityTitle || '',
            personalityEmoji: session.partnerPersonalityEmoji || '',
            completedAt: session.partnerCompletedAt || 0
        } : null,
        compatibilityScore: session.compatibilityResult ? session.compatibilityResult.score : 0,
        compatibilityLevel: session.compatibilityResult ? (session.compatibilityResult.level || '') : '',
        matchingTraits: session.compatibilityResult ? (session.compatibilityResult.matchingTraits || []) : [],
        differentTraits: session.compatibilityResult ? (session.compatibilityResult.differentTraits || []) : [],
        compatibilityInsight: session.compatibilityResult ? (session.compatibilityResult.message || '') : '',
        status: numericStatus,
        shareCode: session.shareCode || ''
    };
}

/**
 * Calculate trait similarity between two trait score sets
 */
function compatibilityCalculateTraitSimilarity(traits1, traits2, relevantTraits) {
    var similarity = 0;
    var count = 0;

    for (var i = 0; i < relevantTraits.length; i++) {
        var trait = relevantTraits[i];
        var score1 = traits1[trait] || 0;
        var score2 = traits2[trait] || 0;

        var norm1 = Math.min(score1 / 5, 1);
        var norm2 = Math.min(score2 / 5, 1);

        var diff = Math.abs(norm1 - norm2);
        similarity += (1 - diff);
        count++;
    }

    return count > 0 ? similarity / count : 0.5;
}

/**
 * Count how many answers match between two players
 */
function compatibilityCountMatchingAnswers(answers1, answers2) {
    var matches = 0;
    var minLen = Math.min(answers1.length, answers2.length);

    for (var i = 0; i < minLen; i++) {
        var a1 = answers1[i];
        var a2 = answers2[i];

        if (a1 && a2 && a1.optionId === a2.optionId) {
            matches++;
        }
    }

    return matches;
}

/**
 * Compute compatibility score based on trait scores and answers
 */
function compatibilityComputeScore(creatorTraits, partnerTraits, creatorAnswers, partnerAnswers) {
    var totalScore = 0;
    var categoryCount = 0;
    var breakdown = {};

    // 1. Communication Style
    var commScore = compatibilityCalculateTraitSimilarity(
        creatorTraits,
        partnerTraits,
        ['mbti:E', 'mbti:I', 'mbti:J', 'mbti:P']
    );
    breakdown.communicationStyle = Math.round(commScore * 100);
    totalScore += commScore;
    categoryCount++;

    // 2. Emotional Connection
    var emotionalScore = compatibilityCalculateTraitSimilarity(
        creatorTraits,
        partnerTraits,
        ['mbti:F', 'mbti:T', 'big_five:high_agreeableness', 'big_five:high_openness']
    );
    breakdown.emotionalConnection = Math.round(emotionalScore * 100);
    totalScore += emotionalScore;
    categoryCount++;

    // 3. Shared Values
    var valuesScore = compatibilityCalculateTraitSimilarity(
        creatorTraits,
        partnerTraits,
        ['mbti:N', 'mbti:S', 'big_five:high_conscientiousness']
    );
    breakdown.sharedValues = Math.round(valuesScore * 100);
    totalScore += valuesScore;
    categoryCount++;

    // 4. Direct answer matching bonus
    var matchingAnswers = compatibilityCountMatchingAnswers(creatorAnswers, partnerAnswers);
    var maxLen = Math.max(creatorAnswers.length, partnerAnswers.length, 1);
    var matchRatio = matchingAnswers / maxLen;
    breakdown.answerAlignment = Math.round(matchRatio * 100);
    totalScore += matchRatio * 0.5;
    categoryCount += 0.5;

    var finalScore = (totalScore / categoryCount) * 100;

    var message;
    var emoji;
    if (finalScore >= 90) {
        message = "You're a perfect match! Your connection is extraordinary!";
        emoji = "heart";
    } else if (finalScore >= 75) {
        message = "Highly compatible! You complement each other wonderfully!";
        emoji = "hearts";
    } else if (finalScore >= 60) {
        message = "Good compatibility! You share many common values!";
        emoji = "heart_pink";
    } else if (finalScore >= 45) {
        message = "Moderate compatibility! Opposites can attract!";
        emoji = "heart_yellow";
    } else {
        message = "Different perspectives! Diversity makes life interesting!";
        emoji = "star";
    }

    // Determine compatibility level string
    var level;
    if (finalScore >= 90) {
        level = "Perfect Match";
    } else if (finalScore >= 75) {
        level = "Highly Compatible";
    } else if (finalScore >= 60) {
        level = "Good Match";
    } else if (finalScore >= 45) {
        level = "Moderate";
    } else {
        level = "Different Perspectives";
    }

    // Generate matching traits based on category scores
    var matchingTraits = [];
    var differentTraits = [];

    if (breakdown.communicationStyle >= 70) {
        matchingTraits.push("Communication Style");
    } else if (breakdown.communicationStyle < 40) {
        differentTraits.push("Communication Style");
    }

    if (breakdown.emotionalConnection >= 70) {
        matchingTraits.push("Emotional Connection");
    } else if (breakdown.emotionalConnection < 40) {
        differentTraits.push("Emotional Connection");
    }

    if (breakdown.sharedValues >= 70) {
        matchingTraits.push("Shared Values");
    } else if (breakdown.sharedValues < 40) {
        differentTraits.push("Shared Values");
    }

    if (breakdown.answerAlignment >= 60) {
        matchingTraits.push("Similar Thinking");
    } else if (breakdown.answerAlignment < 30) {
        differentTraits.push("Different Viewpoints");
    }

    // Add personality-based traits
    if (creatorTraits['mbti:E'] && partnerTraits['mbti:E'] &&
        creatorTraits['mbti:E'] > 2 && partnerTraits['mbti:E'] > 2) {
        matchingTraits.push("Both Outgoing");
    }
    if (creatorTraits['mbti:I'] && partnerTraits['mbti:I'] &&
        creatorTraits['mbti:I'] > 2 && partnerTraits['mbti:I'] > 2) {
        matchingTraits.push("Both Thoughtful");
    }
    if (creatorTraits['big_five:high_openness'] && partnerTraits['big_five:high_openness'] &&
        creatorTraits['big_five:high_openness'] > 2 && partnerTraits['big_five:high_openness'] > 2) {
        matchingTraits.push("Creative Minds");
    }
    if (creatorTraits['big_five:high_agreeableness'] && partnerTraits['big_five:high_agreeableness'] &&
        creatorTraits['big_five:high_agreeableness'] > 2 && partnerTraits['big_five:high_agreeableness'] > 2) {
        matchingTraits.push("Caring Hearts");
    }

    // Ensure we have at least one matching trait or different trait
    if (matchingTraits.length === 0 && finalScore >= 50) {
        matchingTraits.push("Open to Growth");
    }
    if (differentTraits.length === 0 && finalScore < 50) {
        differentTraits.push("Unique Perspectives");
    }

    // Format category scores for Unity frontend
    var categoryScores = {
        communication: breakdown.communicationStyle || 0,
        emotional: breakdown.emotionalConnection || 0,
        values: breakdown.sharedValues || 0,
        lifestyle: Math.round((breakdown.answerAlignment || 0) * 0.8), // Derive lifestyle from answer alignment
        interests: Math.round(finalScore * 0.9) // Derive interests from overall score
    };

    // Generate growth areas from low-scoring categories
    var growthAreas = [];
    if (categoryScores.communication < 50) growthAreas.push("Communication Skills");
    if (categoryScores.emotional < 50) growthAreas.push("Emotional Understanding");
    if (categoryScores.values < 50) growthAreas.push("Aligning Core Values");
    if (categoryScores.lifestyle < 50) growthAreas.push("Lifestyle Balance");
    if (categoryScores.interests < 50) growthAreas.push("Discovering Shared Interests");

    // Ensure at least one growth area
    if (growthAreas.length === 0) {
        growthAreas.push("Keep Growing Together");
    }

    // Generate relationship advice based on score
    var relationshipAdvice;
    if (finalScore >= 85) {
        relationshipAdvice = "Your connection is truly special! Keep nurturing this beautiful bond. ðŸ’•";
    } else if (finalScore >= 70) {
        relationshipAdvice = "You have great potential together. Communication is your superpower! ðŸ’–";
    } else if (finalScore >= 55) {
        relationshipAdvice = "Embrace your differences - they make your relationship unique! ðŸ’—";
    } else if (finalScore >= 40) {
        relationshipAdvice = "Every relationship is a journey of discovery. Keep exploring together! ðŸ’›";
    } else {
        relationshipAdvice = "Your different perspectives can lead to amazing growth. Stay curious! ðŸŒŸ";
    }

    return {
        score: finalScore,
        overallScore: finalScore, // Alias for Unity compatibility
        level: level,
        compatibilityLevel: level, // Alias for Unity compatibility
        breakdown: breakdown,
        categoryScores: categoryScores,
        message: message,
        relationshipAdvice: relationshipAdvice, // Explicit advice field for Unity
        compatibilityInsight: message, // Alias for backward compatibility
        emoji: emoji,
        matchingTraits: matchingTraits,
        differentTraits: differentTraits,
        growthAreas: growthAreas,
        matchingAnswers: matchingAnswers,
        totalQuestions: maxLen
    };
}

/**
 * RPC: Create a new compatibility quiz session
 * Payload: { quizId: string, userId?: string, playerDisplayName?: string }
 */
function rpcCompatibilityCreateSession(ctx, logger, nk, payload) {
    logger.debug('[CompatibilityQuiz] Creating session for user: ' + ctx.userId);

    var request;
    try {
        request = JSON.parse(payload || '{}');
    } catch (e) {
        return JSON.stringify({ success: false, message: 'Invalid JSON payload', data: null });
    }

    try {
        // CRITICAL: Validate userId - use from context or fallback to payload
        var userId = ctx.userId;
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            userId = request.userId;
        }
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            return JSON.stringify({
                success: false,
                message: 'User authentication required. Please ensure you are logged in.',
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }

        var quizId = request.quizId || 'compatibility_quiz_v1';
        var quizTitle = request.quizTitle || 'Compatibility Quiz';
        var playerDisplayName = request.playerDisplayName || 'Unknown';
        var sessionId = nk.uuidv4();
        var shareCode = compatibilityGenerateShareCode(sessionId);
        var now = Date.now();
        var expiresAt = now + (48 * 60 * 60 * 1000);

        // Fetch user display name (with fallback)
        var displayName = playerDisplayName;
        try {
            var users = nk.usersGetId([userId]);
            if (users && users.length > 0) {
                displayName = users[0].displayName || users[0].username || playerDisplayName;
            }
        } catch (userErr) {
            logger.warn('[CompatibilityQuiz] Could not fetch user info: ' + userErr.message);
        }

        // Internal storage format
        var sessionStorage = {
            sessionId: sessionId,
            shareCode: shareCode,
            quizId: quizId,
            quizTitle: quizTitle,
            creatorId: userId,
            creatorName: displayName,
            partnerId: null,
            partnerName: null,
            status: 0, // WaitingForPartner
            createdAt: now,
            expiresAt: expiresAt,
            creatorCompleted: false,
            partnerCompleted: false,
            creatorAnswers: null,
            partnerAnswers: null,
            creatorTraitScores: null,
            partnerTraitScores: null,
            compatibilityResult: null
        };

        nk.storageWrite([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: sessionId,
            userId: userId,
            value: sessionStorage,
            permissionRead: 2,
            permissionWrite: 1
        }]);

        // Store code mapping with system user ID for public lookup
        nk.storageWrite([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: 'code_' + shareCode,
            userId: '00000000-0000-0000-0000-000000000000',
            value: { sessionId: sessionId, creatorId: userId },
            permissionRead: 2,
            permissionWrite: 0
        }]);

        logger.info('[CompatibilityQuiz] Session created: ' + sessionId + ' with code: ' + shareCode);

        // Response format matching Unity client expectations
        return JSON.stringify({
            success: true,
            message: 'Session created successfully',
            data: {
                sessionId: sessionId,
                quizId: quizId,
                quizTitle: quizTitle,
                createdByUserId: ctx.userId,
                createdAt: now,
                expiresAt: expiresAt,
                playerA: {
                    userId: ctx.userId,
                    displayName: displayName,
                    isComplete: false,
                    answeredQuestions: [],
                    traitScores: {}
                },
                playerB: null,
                compatibilityScore: 0,
                compatibilityLevel: null,
                matchingTraits: [],
                differentTraits: [],
                compatibilityInsight: null,
                status: 0, // WaitingForPartner
                shareCode: shareCode
            }
        });
    } catch (err) {
        logger.error('[CompatibilityQuiz] Create session error: ' + err.message);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

/**
 * RPC: Join an existing compatibility quiz session
 * Payload: { shareCode: string, userId?: string, playerDisplayName?: string }
 */
function rpcCompatibilityJoinSession(ctx, logger, nk, payload) {
    logger.debug('[CompatibilityQuiz] User ' + ctx.userId + ' attempting to join session');

    var request;
    try {
        request = JSON.parse(payload || '{}');
    } catch (e) {
        return JSON.stringify({ success: false, message: 'Invalid JSON payload', data: null });
    }

    try {
        // CRITICAL: Validate userId - use from context or fallback to payload
        var userId = ctx.userId;
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            userId = request.userId;
        }
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            return JSON.stringify({
                success: false,
                message: 'User authentication required. Please ensure you are logged in.',
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }

        var shareCode = (request.shareCode || request.shareCodeOrSessionId || '').toUpperCase().trim();
        if (!shareCode || shareCode.length < 6) {
            return JSON.stringify({ success: false, message: 'Invalid share code', data: null });
        }

        // Note: We must read using the creator's ID, but we don't know it yet.
        // First, try to find the code record by listing storage with the code key pattern.
        // For now, we'll use a different approach - store the code mapping with system user.
        var codeResults = nk.storageRead([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: 'code_' + shareCode,
            userId: '00000000-0000-0000-0000-000000000000'
        }]);

        if (codeResults.length === 0) {
            return JSON.stringify({ success: false, message: 'Session not found', data: null });
        }

        var codeRecord = codeResults[0].value;
        var sessionId = codeRecord.sessionId;
        var creatorId = codeRecord.creatorId;

        var sessionResults = nk.storageRead([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: sessionId,
            userId: creatorId
        }]);

        if (sessionResults.length === 0) {
            return JSON.stringify({ success: false, message: 'Session data not found', data: null });
        }

        var session = sessionResults[0].value;

        if (session.status === 3 || session.status === 'expired' || Date.now() > session.expiresAt) {
            return JSON.stringify({ success: false, message: 'Session has expired', data: null });
        }

        if (session.partnerId !== null && session.partnerId !== userId) {
            return JSON.stringify({ success: false, message: 'Session already has a partner', data: null });
        }

        if (session.creatorId === userId) {
            return JSON.stringify({ success: false, message: 'Cannot join your own session', data: null });
        }

        // Fetch user display name (with fallback)
        var displayName = request.playerDisplayName || 'Unknown';
        try {
            var users = nk.usersGetId([userId]);
            if (users && users.length > 0) {
                displayName = users[0].displayName || users[0].username || displayName;
            }
        } catch (userErr) {
            logger.warn('[CompatibilityQuiz] Could not fetch user info: ' + userErr.message);
        }

        session.partnerId = userId;
        session.partnerName = displayName;
        session.status = 1; // PartnerJoined

        nk.storageWrite([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: sessionId,
            userId: creatorId,
            value: session,
            permissionRead: 2,
            permissionWrite: 1
        }]);

        compatibilitySendNotification(nk, session.creatorId,
            'Partner Joined!',
            displayName + ' has joined your compatibility quiz!',
            { type: 'partner_joined', sessionId: sessionId }
        );

        logger.info('[CompatibilityQuiz] User ' + userId + ' joined session ' + sessionId);

        return JSON.stringify({
            success: true,
            message: 'Successfully joined session',
            data: compatibilitySessionToUnityFormat(session)
        });
    } catch (err) {
        logger.error('[CompatibilityQuiz] Join session error: ' + err.message);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

/**
 * RPC: Get session details
 * Payload: { sessionId: string, userId?: string } or { shareCode: string, userId?: string }
 */
function rpcCompatibilityGetSession(ctx, logger, nk, payload) {
    var request;
    try {
        request = JSON.parse(payload || '{}');
    } catch (e) {
        return JSON.stringify({ success: false, message: 'Invalid JSON payload', data: null });
    }

    try {
        // CRITICAL: Validate userId - use from context or fallback to payload
        var userId = ctx.userId;
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            userId = request.userId;
        }
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            return JSON.stringify({
                success: false,
                message: 'User authentication required. Please ensure you are logged in.',
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }

        var sessionId = request.sessionId;
        var creatorId = null;

        if (!sessionId && request.shareCode) {
            var shareCode = request.shareCode.toUpperCase().trim();
            var codeResults = nk.storageRead([{
                collection: COLLECTION_COMPATIBILITY_SESSIONS,
                key: 'code_' + shareCode,
                userId: '00000000-0000-0000-0000-000000000000'
            }]);

            if (codeResults.length === 0) {
                return JSON.stringify({ success: false, message: 'Session not found', data: null });
            }

            sessionId = codeResults[0].value.sessionId;
            creatorId = codeResults[0].value.creatorId;
        }

        var sessionResults = nk.storageRead([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: sessionId,
            userId: userId
        }]);

        if (sessionResults.length === 0 && creatorId) {
            sessionResults = nk.storageRead([{
                collection: COLLECTION_COMPATIBILITY_SESSIONS,
                key: sessionId,
                userId: creatorId
            }]);
        }

        if (sessionResults.length === 0) {
            return JSON.stringify({ success: false, message: 'Session not found', data: null });
        }

        var session = sessionResults[0].value;

        if (session.creatorId !== userId && session.partnerId !== userId) {
            return JSON.stringify({ success: false, message: 'Not authorized to view this session', data: null });
        }

        return JSON.stringify({
            success: true,
            message: 'Session retrieved',
            data: compatibilitySessionToUnityFormat(session)
        });
    } catch (err) {
        logger.error('[CompatibilityQuiz] Get session error: ' + err.message);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

/**
 * RPC: Submit quiz answers
 * Payload: { sessionId, answers[], traitScores{} }
 */
function rpcCompatibilitySubmitAnswers(ctx, logger, nk, payload) {
    logger.debug('[CompatibilityQuiz] User ' + ctx.userId + ' submitting answers');

    var request;
    try {
        request = JSON.parse(payload || '{}');
    } catch (e) {
        return JSON.stringify({ success: false, message: 'Invalid JSON payload', data: null });
    }

    try {
        // CRITICAL: Validate userId - use from context or fallback to payload
        var userId = ctx.userId;
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            userId = request.userId;
        }
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            return JSON.stringify({
                success: false,
                message: 'User authentication required. Please ensure you are logged in.',
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }

        var sessionId = request.sessionId;
        var answers = request.answers || [];
        var traitScores = request.traitScores || {};

        if (!sessionId) {
            return JSON.stringify({ success: false, message: 'Session ID required', data: null });
        }

        var sessionResults = nk.storageRead([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: sessionId,
            userId: userId
        }]);

        var isCreator = sessionResults.length > 0;
        var creatorId = isCreator ? userId : null;

        if (!isCreator) {
            var listResults = nk.storageList(null, COLLECTION_COMPATIBILITY_SESSIONS, 100, '');
            var objects = listResults.objects || [];

            for (var i = 0; i < objects.length; i++) {
                var obj = objects[i];
                if (obj.value.sessionId === sessionId && obj.value.partnerId === userId) {
                    creatorId = obj.value.creatorId;
                    break;
                }
            }

            if (creatorId) {
                sessionResults = nk.storageRead([{
                    collection: COLLECTION_COMPATIBILITY_SESSIONS,
                    key: sessionId,
                    userId: creatorId
                }]);
            }
        }

        if (sessionResults.length === 0) {
            return JSON.stringify({ success: false, message: 'Session not found', data: null });
        }

        var session = sessionResults[0].value;

        var isPartner = session.partnerId === userId;
        isCreator = session.creatorId === userId;

        if (!isCreator && !isPartner) {
            return JSON.stringify({ success: false, message: 'Not authorized for this session', data: null });
        }

        var now = Date.now();
        if (isCreator) {
            session.creatorAnswers = answers;
            session.creatorTraitScores = traitScores;
            session.creatorCompleted = true;
            session.creatorCompletedAt = now;
            session.creatorResultId = request.resultId || null;
            session.creatorPersonalityTitle = request.personalityTitle || null;
            session.creatorPersonalityEmoji = request.personalityEmoji || null;
        } else {
            session.partnerAnswers = answers;
            session.partnerTraitScores = traitScores;
            session.partnerCompleted = true;
            session.partnerCompletedAt = now;
            session.partnerResultId = request.resultId || null;
            session.partnerPersonalityTitle = request.personalityTitle || null;
            session.partnerPersonalityEmoji = request.personalityEmoji || null;
        }

        // Update status using numeric values
        if (session.creatorCompleted && session.partnerCompleted) {
            session.status = 2; // BothCompleted
        } else if (session.creatorCompleted || session.partnerCompleted) {
            session.status = 1; // PartnerJoined (or waiting for other)
        }

        nk.storageWrite([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: sessionId,
            userId: session.creatorId,
            value: session,
            permissionRead: 2,
            permissionWrite: 1
        }]);

        if (isCreator && session.partnerId) {
            compatibilitySendNotification(nk, session.partnerId,
                'Your partner finished!',
                session.creatorName + ' completed the quiz. Check your results!',
                { type: 'creator_completed', sessionId: sessionId }
            );
        } else if (isPartner) {
            compatibilitySendNotification(nk, session.creatorId,
                'Results are ready!',
                session.partnerName + ' completed the quiz! See your compatibility now!',
                { type: 'partner_completed', sessionId: sessionId }
            );
        }

        logger.info('[CompatibilityQuiz] Answers submitted for session ' + sessionId);

        return JSON.stringify({
            success: true,
            message: 'Answers submitted successfully',
            data: compatibilitySessionToUnityFormat(session)
        });
    } catch (err) {
        logger.error('[CompatibilityQuiz] Submit answers error: ' + err.message);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

/**
 * RPC: Calculate compatibility between two players
 * Payload: { sessionId: string }
 */
function rpcCompatibilityCalculate(ctx, logger, nk, payload) {
    logger.debug('[CompatibilityQuiz] Calculating compatibility for user ' + ctx.userId);

    var request;
    try {
        request = JSON.parse(payload || '{}');
    } catch (e) {
        return JSON.stringify({ success: false, message: 'Invalid JSON payload', data: null });
    }

    try {
        // CRITICAL: Validate userId - use from context or fallback to payload
        var userId = ctx.userId;
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            userId = request.userId;
        }
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            return JSON.stringify({
                success: false,
                message: 'User authentication required. Please ensure you are logged in.',
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }

        var sessionId = request.sessionId;
        if (!sessionId) {
            return JSON.stringify({ success: false, message: 'Session ID required', data: null });
        }

        var sessionResults = nk.storageRead([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: sessionId,
            userId: userId
        }]);

        var creatorId = userId;

        if (sessionResults.length === 0) {
            var listResults = nk.storageList(null, COLLECTION_COMPATIBILITY_SESSIONS, 100, '');
            var objects = listResults.objects || [];

            for (var i = 0; i < objects.length; i++) {
                var obj = objects[i];
                if (obj.value.sessionId === sessionId) {
                    creatorId = obj.value.creatorId;
                    break;
                }
            }

            sessionResults = nk.storageRead([{
                collection: COLLECTION_COMPATIBILITY_SESSIONS,
                key: sessionId,
                userId: creatorId
            }]);
        }

        if (sessionResults.length === 0) {
            return JSON.stringify({ success: false, message: 'Session not found', data: null });
        }

        var session = sessionResults[0].value;

        if (!session.creatorCompleted || !session.partnerCompleted) {
            return JSON.stringify({ success: false, message: 'Both players must complete the quiz first', data: null });
        }

        // If already calculated, return cached result
        if (session.compatibilityResult) {
            session.status = 2; // BothCompleted
            return JSON.stringify({
                success: true,
                message: 'Compatibility result retrieved',
                data: compatibilitySessionToUnityFormat(session)
            });
        }

        var creatorTraits = session.creatorTraitScores || {};
        var partnerTraits = session.partnerTraitScores || {};
        var creatorAnswers = session.creatorAnswers || [];
        var partnerAnswers = session.partnerAnswers || [];

        var result = compatibilityComputeScore(creatorTraits, partnerTraits, creatorAnswers, partnerAnswers);

        session.compatibilityResult = result;
        session.status = 2; // BothCompleted

        nk.storageWrite([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: sessionId,
            userId: creatorId,
            value: session,
            permissionRead: 2,
            permissionWrite: 1
        }]);

        var resultMessage = 'Your compatibility score: ' + result.score.toFixed(0) + '%!';

        compatibilitySendNotification(nk, session.creatorId,
            'Compatibility Results!',
            resultMessage,
            { type: 'results_ready', sessionId: sessionId }
        );

        if (session.partnerId) {
            compatibilitySendNotification(nk, session.partnerId,
                'Compatibility Results!',
                resultMessage,
                { type: 'results_ready', sessionId: sessionId }
            );
        }

        logger.info('[CompatibilityQuiz] Compatibility calculated: ' + result.score + '%');

        return JSON.stringify({
            success: true,
            message: 'Compatibility calculated',
            data: compatibilitySessionToUnityFormat(session)
        });
    } catch (err) {
        logger.error('[CompatibilityQuiz] Calculate error: ' + err.message);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

/**
 * RPC: List user's compatibility sessions
 * Payload: { limit?: number, includeExpired?: boolean, userId?: string }
 */
function rpcCompatibilityListSessions(ctx, logger, nk, payload) {
    var request = {};
    try {
        if (payload) {
            request = JSON.parse(payload);
        }
    } catch (e) {
        // Use defaults
    }

    try {
        // CRITICAL: Validate userId - use from context or fallback to payload
        var userId = ctx.userId;
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            userId = request.userId;
        }
        if (!userId || typeof userId !== 'string' || userId.length < 10) {
            return JSON.stringify({
                success: false,
                message: 'User authentication required. Please ensure you are logged in.',
                data: [],
                errorCode: 'AUTH_REQUIRED'
            });
        }

        var limit = Math.min(request.limit || 20, 100);
        var includeExpired = request.includeExpired || false;

        var creatorSessions = nk.storageList(userId, COLLECTION_COMPATIBILITY_SESSIONS, limit, '');

        var sessions = [];
        var now = Date.now();
        var objects = creatorSessions.objects || [];

        for (var i = 0; i < objects.length; i++) {
            var obj = objects[i];
            var session = obj.value;

            if (obj.key.indexOf('code_') === 0) continue;

            // Convert status to numeric
            var numericStatus = typeof session.status === 'number' ? session.status : 0;
            var isExpired = numericStatus === 3 || now > session.expiresAt;

            if (!includeExpired && isExpired) {
                continue;
            }

            sessions.push(compatibilitySessionToUnityFormat(session));
        }

        return JSON.stringify({
            success: true,
            message: 'Sessions retrieved',
            data: sessions
        });
    } catch (err) {
        logger.error('[CompatibilityQuiz] List sessions error: ' + err.message);
        return JSON.stringify({ success: false, message: err.message, data: [] });
    }
}


// ============================================================================
// ASYNC CHALLENGE SYSTEM - Universal Asynchronous Multiplayer (QuizVerse)
// ============================================================================
// World-class async challenge system supporting all quiz modes
// Features: Create, Join, Submit, Get, List, Cancel, Rematch, Stats, Rewards, Leaderboards
// Status: 0=WaitingForOpponent, 1=OpponentJoined, 2=BothCompleted, 3=Expired, 4=Cancelled
// ============================================================================

var COLLECTION_ASYNC_CHALLENGES = 'async_challenges';
var COLLECTION_ASYNC_STATS = 'async_challenge_stats';
var COLLECTION_ASYNC_INDEX = 'async_challenge_index';
var ASYNC_CHALLENGE_SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
var ASYNC_CHALLENGE_EXPIRY_HOURS = 168; // 7 days (1 week max)
var ASYNC_CHALLENGE_MAX_PER_USER = 10;
var ASYNC_CHALLENGE_RATE_LIMIT_MINUTES = 1; // Min time between challenge creations
var ASYNC_CHALLENGE_WIN_COINS = 50; // Coins for winning
var ASYNC_CHALLENGE_PARTICIPATION_COINS = 10; // Coins for completing (loser)
var ASYNC_CHALLENGE_WIN_XP = 100; // XP for winning
var ASYNC_CHALLENGE_PARTICIPATION_XP = 25; // XP for completing (loser)

// Status constants
var ASYNC_STATUS_WAITING = 0;
var ASYNC_STATUS_OPPONENT_JOINED = 1;
var ASYNC_STATUS_BOTH_COMPLETED = 2;
var ASYNC_STATUS_EXPIRED = 3;
var ASYNC_STATUS_CANCELLED = 4;

/**
 * Get or create user async challenge statistics
 * @param {object} nk - Nakama runtime context
 * @param {string} userId - User ID
 * @returns {object} User stats
 */
function asyncChallengeGetStats(nk, userId) {
    try {
        var statsResults = nk.storageRead([{
            collection: COLLECTION_ASYNC_STATS,
            key: 'stats_' + userId,
            userId: userId
        }]);

        if (statsResults.length > 0) {
            return statsResults[0].value;
        }
    } catch (err) {
        // Return default stats
    }

    return {
        userId: userId,
        totalChallenges: 0,
        totalWins: 0,
        totalLosses: 0,
        totalDraws: 0,
        currentWinStreak: 0,
        bestWinStreak: 0,
        totalCoinsWon: 0,
        totalXpEarned: 0,
        lastChallengeAt: 0,
        createdAt: Date.now()
    };
}

/**
 * Update user async challenge statistics
 * @param {object} nk - Nakama runtime context
 * @param {string} userId - User ID
 * @param {object} stats - Updated stats object
 */
function asyncChallengeSaveStats(nk, userId, stats) {
    try {
        nk.storageWrite([{
            collection: COLLECTION_ASYNC_STATS,
            key: 'stats_' + userId,
            userId: userId,
            value: stats,
            permissionRead: 2,
            permissionWrite: 1
        }]);
    } catch (err) {
        // Silent fail - stats are non-critical
    }
}

/**
 * Add session to opponent index for fast lookups
 * @param {object} nk - Nakama runtime context
 * @param {string} opponentId - Opponent user ID
 * @param {string} sessionId - Challenge session ID
 * @param {string} creatorId - Creator user ID
 */
function asyncChallengeIndexOpponent(nk, opponentId, sessionId, creatorId) {
    try {
        // Get current index
        var indexResults = nk.storageRead([{
            collection: COLLECTION_ASYNC_INDEX,
            key: 'opponent_' + opponentId,
            userId: opponentId
        }]);

        var index = { sessions: [] };
        if (indexResults.length > 0) {
            index = indexResults[0].value;
        }

        // Add session if not exists
        var exists = false;
        for (var i = 0; i < index.sessions.length; i++) {
            if (index.sessions[i].sessionId === sessionId) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            index.sessions.push({
                sessionId: sessionId,
                creatorId: creatorId,
                addedAt: Date.now()
            });

            // Keep only recent 50 entries
            if (index.sessions.length > 50) {
                index.sessions = index.sessions.slice(-50);
            }

            nk.storageWrite([{
                collection: COLLECTION_ASYNC_INDEX,
                key: 'opponent_' + opponentId,
                userId: opponentId,
                value: index,
                permissionRead: 1,
                permissionWrite: 1
            }]);
        }
    } catch (err) {
        // Non-critical indexing failure
    }
}

/**
 * Award rewards to a user (coins, XP)
 * @param {object} nk - Nakama runtime context
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {number} coins - Coins to award
 * @param {number} xp - XP to award
 * @param {string} reason - Reward reason for logging
 */
function asyncChallengeAwardRewards(nk, logger, userId, coins, xp, reason) {
    try {
        // Award coins via wallet
        if (coins > 0) {
            var changeset = { coins: coins };
            nk.walletUpdate(userId, changeset, { reason: reason }, true);
            logger.debug('[AsyncChallenge] Awarded ' + coins + ' coins to ' + userId + ' for: ' + reason);
        }

        // Award XP - use account metadata or dedicated storage
        if (xp > 0) {
            try {
                var account = nk.accountGetId(userId);
                var metadata = account.user.metadata || {};
                metadata.totalXp = (metadata.totalXp || 0) + xp;
                nk.accountUpdateId(userId, null, null, null, null, null, null, metadata);
                logger.debug('[AsyncChallenge] Awarded ' + xp + ' XP to ' + userId + ' for: ' + reason);
            } catch (xpErr) {
                logger.warn('[AsyncChallenge] Could not award XP: ' + xpErr.message);
            }
        }
    } catch (err) {
        logger.warn('[AsyncChallenge] Reward error: ' + err.message);
    }
}

/**
 * Process challenge completion - award rewards and update stats
 * @param {object} nk - Nakama runtime context
 * @param {object} logger - Logger instance
 * @param {object} session - Completed session
 */
function asyncChallengeProcessCompletion(nk, logger, session) {
    if (!session.creatorCompleted || !session.opponentCompleted) {
        return; // Not both completed
    }

    var creatorScore = session.creatorScore || 0;
    var opponentScore = session.opponentScore || 0;
    var isDraw = creatorScore === opponentScore;
    var creatorWins = creatorScore > opponentScore;

    // Update creator stats
    var creatorStats = asyncChallengeGetStats(nk, session.creatorId);
    creatorStats.totalChallenges++;

    // Update opponent stats
    var opponentStats = asyncChallengeGetStats(nk, session.opponentId);
    opponentStats.totalChallenges++;

    if (isDraw) {
        // Draw - both get participation rewards
        creatorStats.totalDraws++;
        creatorStats.currentWinStreak = 0;
        opponentStats.totalDraws++;
        opponentStats.currentWinStreak = 0;

        var drawCoins = Math.floor(ASYNC_CHALLENGE_PARTICIPATION_COINS * 1.5);
        asyncChallengeAwardRewards(nk, logger, session.creatorId, drawCoins, ASYNC_CHALLENGE_PARTICIPATION_XP, 'async_challenge_draw');
        asyncChallengeAwardRewards(nk, logger, session.opponentId, drawCoins, ASYNC_CHALLENGE_PARTICIPATION_XP, 'async_challenge_draw');
        creatorStats.totalCoinsWon += drawCoins;
        creatorStats.totalXpEarned += ASYNC_CHALLENGE_PARTICIPATION_XP;
        opponentStats.totalCoinsWon += drawCoins;
        opponentStats.totalXpEarned += ASYNC_CHALLENGE_PARTICIPATION_XP;
    } else if (creatorWins) {
        // Creator wins
        creatorStats.totalWins++;
        creatorStats.currentWinStreak++;
        if (creatorStats.currentWinStreak > creatorStats.bestWinStreak) {
            creatorStats.bestWinStreak = creatorStats.currentWinStreak;
        }
        opponentStats.totalLosses++;
        opponentStats.currentWinStreak = 0;

        // Streak bonus
        var streakBonus = Math.min(creatorStats.currentWinStreak - 1, 5) * 10;
        var winCoins = ASYNC_CHALLENGE_WIN_COINS + streakBonus;

        asyncChallengeAwardRewards(nk, logger, session.creatorId, winCoins, ASYNC_CHALLENGE_WIN_XP, 'async_challenge_win');
        asyncChallengeAwardRewards(nk, logger, session.opponentId, ASYNC_CHALLENGE_PARTICIPATION_COINS, ASYNC_CHALLENGE_PARTICIPATION_XP, 'async_challenge_loss');

        creatorStats.totalCoinsWon += winCoins;
        creatorStats.totalXpEarned += ASYNC_CHALLENGE_WIN_XP;
        opponentStats.totalCoinsWon += ASYNC_CHALLENGE_PARTICIPATION_COINS;
        opponentStats.totalXpEarned += ASYNC_CHALLENGE_PARTICIPATION_XP;
    } else {
        // Opponent wins
        opponentStats.totalWins++;
        opponentStats.currentWinStreak++;
        if (opponentStats.currentWinStreak > opponentStats.bestWinStreak) {
            opponentStats.bestWinStreak = opponentStats.currentWinStreak;
        }
        creatorStats.totalLosses++;
        creatorStats.currentWinStreak = 0;

        // Streak bonus
        var opStreakBonus = Math.min(opponentStats.currentWinStreak - 1, 5) * 10;
        var opWinCoins = ASYNC_CHALLENGE_WIN_COINS + opStreakBonus;

        asyncChallengeAwardRewards(nk, logger, session.opponentId, opWinCoins, ASYNC_CHALLENGE_WIN_XP, 'async_challenge_win');
        asyncChallengeAwardRewards(nk, logger, session.creatorId, ASYNC_CHALLENGE_PARTICIPATION_COINS, ASYNC_CHALLENGE_PARTICIPATION_XP, 'async_challenge_loss');

        opponentStats.totalCoinsWon += opWinCoins;
        opponentStats.totalXpEarned += ASYNC_CHALLENGE_WIN_XP;
        creatorStats.totalCoinsWon += ASYNC_CHALLENGE_PARTICIPATION_COINS;
        creatorStats.totalXpEarned += ASYNC_CHALLENGE_PARTICIPATION_XP;
    }

    // Save updated stats
    asyncChallengeSaveStats(nk, session.creatorId, creatorStats);
    asyncChallengeSaveStats(nk, session.opponentId, opponentStats);

    logger.info('[AsyncChallenge] Processed completion - Creator: ' + creatorScore + ', Opponent: ' + opponentScore + ', Winner: ' + (isDraw ? 'Draw' : (creatorWins ? 'Creator' : 'Opponent')));
}

/**
 * Generate a unique 6-character share code from session ID
 * @param {string} sessionId - UUID session identifier
 * @returns {string} 6-character uppercase alphanumeric code
 */
function asyncChallengeGenerateShareCode(sessionId) {
    // Convert UUID to base36 and take first 6 chars for better uniqueness
    var cleanId = sessionId.replace(/-/g, '');
    var hash = 0;
    for (var i = 0; i < cleanId.length; i++) {
        hash = ((hash << 5) - hash) + cleanId.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
    }
    var code = Math.abs(hash).toString(36).toUpperCase().substring(0, 6);
    // Pad with random chars if needed
    while (code.length < 6) {
        code = code + '0';
    }
    return code;
}

/**
 * Send a push notification to a user for async challenges
 * @param {object} nk - Nakama runtime context
 * @param {string} userId - Target user ID
 * @param {string} subject - Notification subject
 * @param {string} content - Notification message
 * @param {object} data - Additional notification data
 */
function asyncChallengeSendNotification(nk, userId, subject, content, data) {
    try {
        var notifications = [{
            userId: userId,
            subject: subject,
            content: JSON.stringify({
                message: content,
                ...data
            }),
            code: 101, // Async challenge notification code
            persistent: true
        }];
        nk.notificationsSend(notifications);
    } catch (e) {
        // Silently fail if notification fails - non-critical
    }
}

/**
 * Get user display name with fallback
 * @param {object} nk - Nakama runtime context
 * @param {string} userId - User ID
 * @param {string} fallback - Fallback display name
 * @returns {string} Display name
 */
function asyncChallengeGetDisplayName(nk, userId, fallback) {
    try {
        var users = nk.usersGetId([userId]);
        if (users && users.length > 0) {
            return users[0].displayName || users[0].username || fallback;
        }
    } catch (err) {
        // Return fallback on error
    }
    return fallback || 'Unknown Player';
}

/**
 * Validate user ID from context or payload
 * @param {object} ctx - Request context
 * @param {object} request - Parsed request payload
 * @returns {object} { valid: boolean, userId: string, error: string }
 */
function asyncChallengeValidateUser(ctx, request) {
    var userId = ctx.userId;
    if (!userId || typeof userId !== 'string' || userId.length < 10) {
        userId = request.userId;
    }
    if (!userId || typeof userId !== 'string' || userId.length < 10) {
        return {
            valid: false,
            userId: null,
            error: 'User authentication required. Please ensure you are logged in.'
        };
    }
    return { valid: true, userId: userId, error: null };
}

/**
 * Convert internal session storage to Unity-compatible response format
 * @param {object} session - Internal session storage object
 * @returns {object} Unity-compatible session data
 */
function asyncChallengeSessionToUnityFormat(session) {
    var now = Date.now();
    var status = typeof session.status === 'number' ? session.status : 0;

    // Auto-expire if past expiry time
    if (status < ASYNC_STATUS_BOTH_COMPLETED && now > session.expiresAt) {
        status = ASYNC_STATUS_EXPIRED;
    }

    // Build player A (creator)
    var playerA = {
        userId: session.creatorId || '',
        displayName: session.creatorName || 'Player A',
        isComplete: session.creatorCompleted || false,
        score: session.creatorScore || 0,
        correctAnswers: session.creatorCorrectAnswers || 0,
        totalQuestions: session.creatorTotalQuestions || 0,
        timeTaken: session.creatorTimeTaken || 0,
        completedAt: session.creatorCompletedAt || 0,
        accuracy: session.creatorTotalQuestions > 0
            ? (session.creatorCorrectAnswers / session.creatorTotalQuestions) * 100
            : 0
    };

    // Build player B (opponent) - null if not joined
    var playerB = null;
    if (session.opponentId) {
        playerB = {
            userId: session.opponentId || '',
            displayName: session.opponentName || 'Player B',
            isComplete: session.opponentCompleted || false,
            score: session.opponentScore || 0,
            correctAnswers: session.opponentCorrectAnswers || 0,
            totalQuestions: session.opponentTotalQuestions || 0,
            timeTaken: session.opponentTimeTaken || 0,
            completedAt: session.opponentCompletedAt || 0,
            accuracy: session.opponentTotalQuestions > 0
                ? (session.opponentCorrectAnswers / session.opponentTotalQuestions) * 100
                : 0
        };
    }

    // Build final result if both completed
    var finalResult = null;
    if (session.creatorCompleted && session.opponentCompleted) {
        var creatorScore = session.creatorScore || 0;
        var opponentScore = session.opponentScore || 0;
        var isDraw = creatorScore === opponentScore;
        var creatorWins = creatorScore > opponentScore;

        var message;
        if (isDraw) {
            message = "It's a draw! Both players showed impressive skills!";
        } else if (creatorWins) {
            message = session.creatorName + " wins by " + (creatorScore - opponentScore) + " points!";
        } else {
            message = session.opponentName + " wins by " + (opponentScore - creatorScore) + " points!";
        }

        finalResult = {
            winnerId: isDraw ? null : (creatorWins ? session.creatorId : session.opponentId),
            winnerName: isDraw ? null : (creatorWins ? session.creatorName : session.opponentName),
            loserId: isDraw ? null : (creatorWins ? session.opponentId : session.creatorId),
            loserName: isDraw ? null : (creatorWins ? session.opponentName : session.creatorName),
            isDraw: isDraw,
            scoreDifference: Math.abs(creatorScore - opponentScore),
            creatorScore: creatorScore,
            opponentScore: opponentScore,
            creatorAccuracy: playerA.accuracy,
            opponentAccuracy: playerB ? playerB.accuracy : 0,
            creatorTimeTaken: session.creatorTimeTaken || 0,
            opponentTimeTaken: session.opponentTimeTaken || 0,
            message: message
        };
    }

    return {
        sessionId: session.sessionId || '',
        shareCode: session.shareCode || '',
        quizModeType: session.quizModeType || 0,
        quizModeName: session.quizModeName || 'Quiz',
        quizConfig: session.quizConfig || {},
        gameId: session.gameId || '',
        status: status,
        createdAt: session.createdAt || 0,
        expiresAt: session.expiresAt || 0,
        challengedUserId: session.challengedUserId || null,
        playerA: playerA,
        playerB: playerB,
        finalResult: finalResult
    };
}

/**
 * Count active challenges for a user (to enforce limits)
 * @param {object} nk - Nakama runtime context
 * @param {string} userId - User ID
 * @returns {number} Count of active challenges
 */
function asyncChallengeCountActive(nk, userId) {
    try {
        var result = nk.storageList(userId, COLLECTION_ASYNC_CHALLENGES, 100, '');
        var count = 0;
        var now = Date.now();
        var objects = result.objects || [];

        for (var i = 0; i < objects.length; i++) {
            var session = objects[i].value;
            if (session.status < ASYNC_STATUS_BOTH_COMPLETED && now < session.expiresAt) {
                count++;
            }
        }
        return count;
    } catch (err) {
        return 0;
    }
}

// ============================================================================
// RPC: async_challenge_create - Create a new async challenge
// ============================================================================
/**
 * Create a new async challenge session
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime context
 * @param {string} payload - JSON payload: { quizModeType, quizModeName, quizConfig?, challengedUserId?, challengedDisplayName?, playerDisplayName?, userId? }
 * @returns {string} JSON response with session data
 */
function rpcAsyncChallengeCreate(ctx, logger, nk, payload) {
    logger.debug('[AsyncChallenge] Creating challenge for user: ' + ctx.userId);

    var request;
    try {
        request = JSON.parse(payload || '{}');
    } catch (e) {
        return JSON.stringify({ success: false, message: 'Invalid JSON payload', data: null });
    }

    try {
        // Validate user
        var userValidation = asyncChallengeValidateUser(ctx, request);
        if (!userValidation.valid) {
            return JSON.stringify({
                success: false,
                message: userValidation.error,
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }
        var userId = userValidation.userId;

        // Check active challenge limit
        var activeCount = asyncChallengeCountActive(nk, userId);
        if (activeCount >= ASYNC_CHALLENGE_MAX_PER_USER) {
            return JSON.stringify({
                success: false,
                message: 'Maximum active challenges reached (' + ASYNC_CHALLENGE_MAX_PER_USER + '). Please complete or cancel existing challenges.',
                data: null,
                errorCode: 'MAX_CHALLENGES'
            });
        }

        // Extract challenge parameters
        var quizModeType = request.quizModeType || request.QuizModeType || 0;
        var quizModeName = request.quizModeName || request.QuizModeName || 'Quiz';
        var quizConfig = request.quizConfig || request.QuizConfig || {};
        var challengedUserId = request.challengedUserId || request.ChallengedUserId || null;
        var challengedDisplayName = request.challengedDisplayName || request.ChallengedDisplayName || null;
        var playerDisplayName = request.playerDisplayName || request.PlayerDisplayName || 'Unknown';

        // Generate session ID and share code
        var sessionId = nk.uuidv4();
        var shareCode = asyncChallengeGenerateShareCode(sessionId);
        var now = Date.now();
        var expiresAt = now + (ASYNC_CHALLENGE_EXPIRY_HOURS * 60 * 60 * 1000);

        // Fetch creator display name
        var creatorName = asyncChallengeGetDisplayName(nk, userId, playerDisplayName);

        // Build session storage object
        var sessionStorage = {
            sessionId: sessionId,
            shareCode: shareCode,
            quizModeType: quizModeType,
            quizModeName: quizModeName,
            quizConfig: quizConfig,
            gameId: quizConfig.gameId || '',
            creatorId: userId,
            creatorName: creatorName,
            opponentId: null,
            opponentName: null,
            challengedUserId: challengedUserId,
            challengedDisplayName: challengedDisplayName,
            status: ASYNC_STATUS_WAITING,
            createdAt: now,
            expiresAt: expiresAt,
            // Creator results
            creatorCompleted: false,
            creatorScore: 0,
            creatorCorrectAnswers: 0,
            creatorTotalQuestions: 0,
            creatorTimeTaken: 0,
            creatorCompletedAt: 0,
            // Opponent results
            opponentCompleted: false,
            opponentScore: 0,
            opponentCorrectAnswers: 0,
            opponentTotalQuestions: 0,
            opponentTimeTaken: 0,
            opponentCompletedAt: 0
        };

        // Store session with creator's user ID
        nk.storageWrite([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: sessionId,
            userId: userId,
            value: sessionStorage,
            permissionRead: 2, // Public read
            permissionWrite: 1 // Owner write
        }]);

        // Store share code mapping for public lookup
        nk.storageWrite([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: 'code_' + shareCode,
            userId: ASYNC_CHALLENGE_SYSTEM_USER,
            value: { sessionId: sessionId, creatorId: userId },
            permissionRead: 2,
            permissionWrite: 0
        }]);

        // Send notification to challenged user if specified
        if (challengedUserId && challengedUserId !== userId) {
            asyncChallengeSendNotification(nk, challengedUserId,
                'Challenge Received!',
                creatorName + ' challenges you to a ' + quizModeName + ' battle!',
                {
                    type: 'challenge_received',
                    sessionId: sessionId,
                    shareCode: shareCode,
                    challengerId: userId,
                    challengerName: creatorName,
                    quizModeName: quizModeName
                }
            );
        }

        logger.info('[AsyncChallenge] Session created: ' + sessionId + ' code: ' + shareCode + ' by user: ' + userId);

        return JSON.stringify({
            success: true,
            message: 'Challenge created successfully',
            data: asyncChallengeSessionToUnityFormat(sessionStorage)
        });
    } catch (err) {
        logger.error('[AsyncChallenge] Create error: ' + err.message);
        logRpcError(nk, logger, 'async_challenge_create', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

// ============================================================================
// RPC: async_challenge_join - Join an existing async challenge
// ============================================================================
/**
 * Join an existing async challenge by share code
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime context
 * @param {string} payload - JSON payload: { shareCode, playerDisplayName?, userId? }
 * @returns {string} JSON response with session data
 */
function rpcAsyncChallengeJoin(ctx, logger, nk, payload) {
    logger.debug('[AsyncChallenge] User ' + ctx.userId + ' attempting to join challenge');

    var request;
    try {
        request = JSON.parse(payload || '{}');
    } catch (e) {
        return JSON.stringify({ success: false, message: 'Invalid JSON payload', data: null });
    }

    try {
        // Validate user
        var userValidation = asyncChallengeValidateUser(ctx, request);
        if (!userValidation.valid) {
            return JSON.stringify({
                success: false,
                message: userValidation.error,
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }
        var userId = userValidation.userId;

        // Validate share code
        var shareCode = (request.shareCode || request.ShareCode || '').toUpperCase().trim();
        if (!shareCode || shareCode.length < 6) {
            return JSON.stringify({
                success: false,
                message: 'Invalid share code. Please enter a valid 6-character code.',
                data: null
            });
        }

        // Look up session by share code
        var codeResults = nk.storageRead([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: 'code_' + shareCode,
            userId: ASYNC_CHALLENGE_SYSTEM_USER
        }]);

        if (codeResults.length === 0) {
            return JSON.stringify({
                success: false,
                message: 'Challenge not found. Please check the code and try again.',
                data: null
            });
        }

        var codeRecord = codeResults[0].value;
        var sessionId = codeRecord.sessionId;
        var creatorId = codeRecord.creatorId;

        // Read the session
        var sessionResults = nk.storageRead([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: sessionId,
            userId: creatorId
        }]);

        if (sessionResults.length === 0) {
            return JSON.stringify({
                success: false,
                message: 'Challenge session not found.',
                data: null
            });
        }

        var session = sessionResults[0].value;

        // Validate session state
        if (session.status === ASYNC_STATUS_EXPIRED || Date.now() > session.expiresAt) {
            return JSON.stringify({
                success: false,
                message: 'This challenge has expired.',
                data: null
            });
        }

        if (session.status === ASYNC_STATUS_CANCELLED) {
            return JSON.stringify({
                success: false,
                message: 'This challenge has been cancelled.',
                data: null
            });
        }

        if (session.creatorId === userId) {
            return JSON.stringify({
                success: false,
                message: 'You cannot join your own challenge.',
                data: null
            });
        }

        if (session.opponentId !== null && session.opponentId !== userId) {
            return JSON.stringify({
                success: false,
                message: 'This challenge already has an opponent.',
                data: null
            });
        }

        // Check if this is a targeted challenge
        if (session.challengedUserId && session.challengedUserId !== userId) {
            return JSON.stringify({
                success: false,
                message: 'This challenge is meant for a specific player.',
                data: null
            });
        }

        // Get opponent display name
        var playerDisplayName = request.playerDisplayName || request.PlayerDisplayName || 'Unknown';
        var opponentName = asyncChallengeGetDisplayName(nk, userId, playerDisplayName);

        // Update session with opponent
        session.opponentId = userId;
        session.opponentName = opponentName;
        session.status = ASYNC_STATUS_OPPONENT_JOINED;

        // Save updated session
        nk.storageWrite([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: sessionId,
            userId: creatorId,
            value: session,
            permissionRead: 2,
            permissionWrite: 1
        }]);

        // Notify creator that opponent joined
        asyncChallengeSendNotification(nk, session.creatorId,
            'Challenge Accepted!',
            opponentName + ' has joined your ' + session.quizModeName + ' challenge!',
            {
                type: 'opponent_joined',
                sessionId: sessionId,
                opponentId: userId,
                opponentName: opponentName
            }
        );

        logger.info('[AsyncChallenge] User ' + userId + ' joined session: ' + sessionId);

        return JSON.stringify({
            success: true,
            message: 'Successfully joined challenge',
            data: asyncChallengeSessionToUnityFormat(session)
        });
    } catch (err) {
        logger.error('[AsyncChallenge] Join error: ' + err.message);
        logRpcError(nk, logger, 'async_challenge_join', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

// ============================================================================
// RPC: async_challenge_get - Get challenge session details
// ============================================================================
/**
 * Get async challenge session details
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime context
 * @param {string} payload - JSON payload: { sessionId?, shareCode?, userId? }
 * @returns {string} JSON response with session data
 */
function rpcAsyncChallengeGet(ctx, logger, nk, payload) {
    var request;
    try {
        request = JSON.parse(payload || '{}');
    } catch (e) {
        return JSON.stringify({ success: false, message: 'Invalid JSON payload', data: null });
    }

    try {
        // Validate user
        var userValidation = asyncChallengeValidateUser(ctx, request);
        if (!userValidation.valid) {
            return JSON.stringify({
                success: false,
                message: userValidation.error,
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }
        var userId = userValidation.userId;

        var sessionId = request.sessionId || request.SessionId;
        var creatorId = null;

        // If no sessionId, try to find by share code
        if (!sessionId && (request.shareCode || request.ShareCode)) {
            var shareCode = (request.shareCode || request.ShareCode).toUpperCase().trim();
            var codeResults = nk.storageRead([{
                collection: COLLECTION_ASYNC_CHALLENGES,
                key: 'code_' + shareCode,
                userId: ASYNC_CHALLENGE_SYSTEM_USER
            }]);

            if (codeResults.length === 0) {
                return JSON.stringify({
                    success: false,
                    message: 'Challenge not found.',
                    data: null
                });
            }

            sessionId = codeResults[0].value.sessionId;
            creatorId = codeResults[0].value.creatorId;
        }

        if (!sessionId) {
            return JSON.stringify({
                success: false,
                message: 'Session ID or share code required.',
                data: null
            });
        }

        // Try reading with user ID first
        var sessionResults = nk.storageRead([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: sessionId,
            userId: userId
        }]);

        // If not found as owner, try with creator ID
        if (sessionResults.length === 0 && creatorId) {
            sessionResults = nk.storageRead([{
                collection: COLLECTION_ASYNC_CHALLENGES,
                key: sessionId,
                userId: creatorId
            }]);
        }

        // If still not found, search storage
        if (sessionResults.length === 0) {
            var listResults = nk.storageList(null, COLLECTION_ASYNC_CHALLENGES, 200, '');
            var objects = listResults.objects || [];

            for (var i = 0; i < objects.length; i++) {
                var obj = objects[i];
                if (obj.value.sessionId === sessionId) {
                    sessionResults = [obj];
                    break;
                }
            }
        }

        if (sessionResults.length === 0) {
            return JSON.stringify({
                success: false,
                message: 'Challenge not found.',
                data: null
            });
        }

        var session = sessionResults[0].value;

        // Authorization check - user must be creator or opponent
        if (session.creatorId !== userId && session.opponentId !== userId) {
            return JSON.stringify({
                success: false,
                message: 'Not authorized to view this challenge.',
                data: null
            });
        }

        return JSON.stringify({
            success: true,
            message: 'Challenge retrieved',
            data: asyncChallengeSessionToUnityFormat(session)
        });
    } catch (err) {
        logger.error('[AsyncChallenge] Get error: ' + err.message);
        logRpcError(nk, logger, 'async_challenge_get', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

// ============================================================================
// RPC: async_challenge_submit - Submit quiz results for a challenge
// ============================================================================
/**
 * Submit quiz results for an async challenge
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime context
 * @param {string} payload - JSON payload: { sessionId, score, correctAnswers, totalQuestions, timeTaken, accuracy?, userId? }
 * @returns {string} JSON response with updated session data
 */
function rpcAsyncChallengeSubmit(ctx, logger, nk, payload) {
    logger.debug('[AsyncChallenge] User ' + ctx.userId + ' submitting results');

    var request;
    try {
        request = JSON.parse(payload || '{}');
    } catch (e) {
        return JSON.stringify({ success: false, message: 'Invalid JSON payload', data: null });
    }

    try {
        // Validate user
        var userValidation = asyncChallengeValidateUser(ctx, request);
        if (!userValidation.valid) {
            return JSON.stringify({
                success: false,
                message: userValidation.error,
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }
        var userId = userValidation.userId;

        // Validate required fields
        var sessionId = request.sessionId || request.SessionId;
        if (!sessionId) {
            return JSON.stringify({
                success: false,
                message: 'Session ID required.',
                data: null
            });
        }

        var score = typeof request.score === 'number' ? request.score : (request.Score || 0);
        var correctAnswers = typeof request.correctAnswers === 'number' ? request.correctAnswers : (request.CorrectAnswers || 0);
        var totalQuestions = typeof request.totalQuestions === 'number' ? request.totalQuestions : (request.TotalQuestions || 0);
        var timeTaken = typeof request.timeTaken === 'number' ? request.timeTaken : (request.TimeTaken || 0);

        // Find the session
        var sessionResults = nk.storageRead([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: sessionId,
            userId: userId
        }]);

        var creatorId = userId;
        var isCreator = sessionResults.length > 0;

        // If not found as owner, search for it
        if (!isCreator) {
            var listResults = nk.storageList(null, COLLECTION_ASYNC_CHALLENGES, 200, '');
            var objects = listResults.objects || [];

            for (var i = 0; i < objects.length; i++) {
                var obj = objects[i];
                if (obj.value.sessionId === sessionId) {
                    creatorId = obj.value.creatorId;
                    sessionResults = [obj];
                    break;
                }
            }
        }

        if (sessionResults.length === 0) {
            return JSON.stringify({
                success: false,
                message: 'Challenge not found.',
                data: null
            });
        }

        var session = sessionResults[0].value;

        // Determine if user is creator or opponent
        isCreator = session.creatorId === userId;
        var isOpponent = session.opponentId === userId;

        if (!isCreator && !isOpponent) {
            return JSON.stringify({
                success: false,
                message: 'Not authorized for this challenge.',
                data: null
            });
        }

        // Check if already submitted
        if (isCreator && session.creatorCompleted) {
            return JSON.stringify({
                success: false,
                message: 'You have already submitted your results.',
                data: null,
                errorCode: 'ALREADY_SUBMITTED'
            });
        }

        if (isOpponent && session.opponentCompleted) {
            return JSON.stringify({
                success: false,
                message: 'You have already submitted your results.',
                data: null,
                errorCode: 'ALREADY_SUBMITTED'
            });
        }

        // Check expiry
        if (Date.now() > session.expiresAt) {
            return JSON.stringify({
                success: false,
                message: 'This challenge has expired.',
                data: null
            });
        }

        // Update results based on role
        var now = Date.now();
        if (isCreator) {
            session.creatorCompleted = true;
            session.creatorScore = score;
            session.creatorCorrectAnswers = correctAnswers;
            session.creatorTotalQuestions = totalQuestions;
            session.creatorTimeTaken = timeTaken;
            session.creatorCompletedAt = now;
        } else {
            session.opponentCompleted = true;
            session.opponentScore = score;
            session.opponentCorrectAnswers = correctAnswers;
            session.opponentTotalQuestions = totalQuestions;
            session.opponentTimeTaken = timeTaken;
            session.opponentCompletedAt = now;
        }

        // Update status if both completed
        if (session.creatorCompleted && session.opponentCompleted) {
            session.status = ASYNC_STATUS_BOTH_COMPLETED;

            // Store rewardsProcessed flag to prevent duplicate rewards
            if (!session.rewardsProcessed) {
                session.rewardsProcessed = true;
            }
        }

        // Save updated session
        nk.storageWrite([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: sessionId,
            userId: session.creatorId,
            value: session,
            permissionRead: 2,
            permissionWrite: 1
        }]);

        // Process completion rewards if both completed (do this after save to ensure data is persisted)
        if (session.status === ASYNC_STATUS_BOTH_COMPLETED && session.rewardsProcessed) {
            // Only process once per session completion
            asyncChallengeProcessCompletion(nk, logger, session);
        }

        // Send notifications
        if (isCreator && session.opponentId) {
            asyncChallengeSendNotification(nk, session.opponentId,
                'Opponent Finished!',
                session.creatorName + ' completed the quiz with ' + score + ' points!',
                {
                    type: 'opponent_completed',
                    sessionId: sessionId,
                    score: score
                }
            );
        } else if (isOpponent) {
            asyncChallengeSendNotification(nk, session.creatorId,
                'Challenge Complete!',
                session.opponentName + ' scored ' + score + ' points! Check your results!',
                {
                    type: 'results_ready',
                    sessionId: sessionId,
                    score: score
                }
            );
        }

        logger.info('[AsyncChallenge] Results submitted for session: ' + sessionId + ' by user: ' + userId + ' score: ' + score);

        return JSON.stringify({
            success: true,
            message: 'Results submitted successfully',
            data: asyncChallengeSessionToUnityFormat(session)
        });
    } catch (err) {
        logger.error('[AsyncChallenge] Submit error: ' + err.message);
        logRpcError(nk, logger, 'async_challenge_submit', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

// ============================================================================
// RPC: async_challenge_list - List user's async challenges
// ============================================================================
/**
 * List user's async challenges
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime context
 * @param {string} payload - JSON payload: { limit?, includeExpired?, status?, userId? }
 * @returns {string} JSON response with array of sessions
 */
function rpcAsyncChallengeList(ctx, logger, nk, payload) {
    var request = {};
    try {
        if (payload) {
            request = JSON.parse(payload);
        }
    } catch (e) {
        // Use defaults
    }

    try {
        // Validate user
        var userValidation = asyncChallengeValidateUser(ctx, request);
        if (!userValidation.valid) {
            return JSON.stringify({
                success: false,
                message: userValidation.error,
                data: [],
                errorCode: 'AUTH_REQUIRED'
            });
        }
        var userId = userValidation.userId;

        var limit = Math.min(request.limit || request.Limit || 20, 100);
        var includeExpired = request.includeExpired || request.IncludeExpired || false;
        var statusFilter = request.status !== undefined ? request.status : null;

        var sessions = [];
        var now = Date.now();

        // Get sessions where user is creator
        var creatorSessions = nk.storageList(userId, COLLECTION_ASYNC_CHALLENGES, limit, '');
        var objects = creatorSessions.objects || [];

        for (var i = 0; i < objects.length; i++) {
            var obj = objects[i];
            var session = obj.value;

            // Skip code mappings
            if (obj.key.indexOf('code_') === 0) continue;

            // Apply status filter
            var sessionStatus = typeof session.status === 'number' ? session.status : 0;
            var isExpired = sessionStatus === ASYNC_STATUS_EXPIRED || now > session.expiresAt;

            if (!includeExpired && isExpired && sessionStatus < ASYNC_STATUS_BOTH_COMPLETED) {
                continue;
            }

            if (statusFilter !== null && sessionStatus !== statusFilter) {
                continue;
            }

            sessions.push(asyncChallengeSessionToUnityFormat(session));
        }

        // Also get sessions where user is opponent (search all storage)
        // This is a limitation - for production, consider a secondary index
        try {
            var allSessions = nk.storageList(null, COLLECTION_ASYNC_CHALLENGES, 500, '');
            var allObjects = allSessions.objects || [];

            for (var j = 0; j < allObjects.length; j++) {
                var allObj = allObjects[j];
                var allSession = allObj.value;

                // Skip code mappings and already added sessions
                if (allObj.key.indexOf('code_') === 0) continue;
                if (allSession.creatorId === userId) continue; // Already added

                // Check if user is opponent
                if (allSession.opponentId === userId) {
                    var allStatus = typeof allSession.status === 'number' ? allSession.status : 0;
                    var allExpired = allStatus === ASYNC_STATUS_EXPIRED || now > allSession.expiresAt;

                    if (!includeExpired && allExpired && allStatus < ASYNC_STATUS_BOTH_COMPLETED) {
                        continue;
                    }

                    if (statusFilter !== null && allStatus !== statusFilter) {
                        continue;
                    }

                    sessions.push(asyncChallengeSessionToUnityFormat(allSession));
                }
            }
        } catch (searchErr) {
            logger.warn('[AsyncChallenge] Could not search opponent sessions: ' + searchErr.message);
        }

        // Sort by created date descending
        sessions.sort(function(a, b) {
            return b.createdAt - a.createdAt;
        });

        // Apply limit
        if (sessions.length > limit) {
            sessions = sessions.slice(0, limit);
        }

        return JSON.stringify({
            success: true,
            message: 'Challenges retrieved',
            data: sessions,
            total: sessions.length
        });
    } catch (err) {
        logger.error('[AsyncChallenge] List error: ' + err.message);
        logRpcError(nk, logger, 'async_challenge_list', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, message: err.message, data: [] });
    }
}

// ============================================================================
// RPC: async_challenge_cancel - Cancel an async challenge
// ============================================================================
/**
 * Cancel an async challenge session
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime context
 * @param {string} payload - JSON payload: { sessionId, userId? }
 * @returns {string} JSON response with updated session data
 */
function rpcAsyncChallengeCancel(ctx, logger, nk, payload) {
    logger.debug('[AsyncChallenge] User ' + ctx.userId + ' cancelling challenge');

    var request;
    try {
        request = JSON.parse(payload || '{}');
    } catch (e) {
        return JSON.stringify({ success: false, message: 'Invalid JSON payload', data: null });
    }

    try {
        // Validate user
        var userValidation = asyncChallengeValidateUser(ctx, request);
        if (!userValidation.valid) {
            return JSON.stringify({
                success: false,
                message: userValidation.error,
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }
        var userId = userValidation.userId;

        var sessionId = request.sessionId || request.SessionId;
        if (!sessionId) {
            return JSON.stringify({
                success: false,
                message: 'Session ID required.',
                data: null
            });
        }

        // Try to read as owner first
        var sessionResults = nk.storageRead([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: sessionId,
            userId: userId
        }]);

        var creatorId = userId;

        // If not found as owner, search
        if (sessionResults.length === 0) {
            var listResults = nk.storageList(null, COLLECTION_ASYNC_CHALLENGES, 200, '');
            var objects = listResults.objects || [];

            for (var i = 0; i < objects.length; i++) {
                var obj = objects[i];
                if (obj.value.sessionId === sessionId) {
                    creatorId = obj.value.creatorId;
                    sessionResults = [obj];
                    break;
                }
            }
        }

        if (sessionResults.length === 0) {
            return JSON.stringify({
                success: false,
                message: 'Challenge not found.',
                data: null
            });
        }

        var session = sessionResults[0].value;

        // Only creator can cancel
        if (session.creatorId !== userId) {
            return JSON.stringify({
                success: false,
                message: 'Only the challenge creator can cancel it.',
                data: null
            });
        }

        // Cannot cancel completed challenges
        if (session.status === ASYNC_STATUS_BOTH_COMPLETED) {
            return JSON.stringify({
                success: false,
                message: 'Cannot cancel a completed challenge.',
                data: null
            });
        }

        // Update status to cancelled
        session.status = ASYNC_STATUS_CANCELLED;

        // Save updated session
        nk.storageWrite([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: sessionId,
            userId: session.creatorId,
            value: session,
            permissionRead: 2,
            permissionWrite: 1
        }]);

        // Notify opponent if any
        if (session.opponentId) {
            asyncChallengeSendNotification(nk, session.opponentId,
                'Challenge Cancelled',
                session.creatorName + ' has cancelled the ' + session.quizModeName + ' challenge.',
                {
                    type: 'challenge_cancelled',
                    sessionId: sessionId
                }
            );
        }

        logger.info('[AsyncChallenge] Session cancelled: ' + sessionId + ' by user: ' + userId);

        return JSON.stringify({
            success: true,
            message: 'Challenge cancelled successfully',
            data: asyncChallengeSessionToUnityFormat(session)
        });
    } catch (err) {
        logger.error('[AsyncChallenge] Cancel error: ' + err.message);
        logRpcError(nk, logger, 'async_challenge_cancel', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

// ============================================================================
// RPC: async_challenge_stats - Get user's async challenge statistics
// ============================================================================
/**
 * Get user's async challenge statistics
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime context
 * @param {string} payload - JSON payload: { targetUserId?, userId? }
 * @returns {string} JSON response with user stats
 */
function rpcAsyncChallengeStats(ctx, logger, nk, payload) {
    var request = {};
    try {
        if (payload) {
            request = JSON.parse(payload);
        }
    } catch (e) {
        // Use defaults
    }

    try {
        // Validate user
        var userValidation = asyncChallengeValidateUser(ctx, request);
        if (!userValidation.valid) {
            return JSON.stringify({
                success: false,
                message: userValidation.error,
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }
        var userId = userValidation.userId;

        // Allow fetching other user's stats (for comparison)
        var targetUserId = request.targetUserId || request.TargetUserId || userId;

        var stats = asyncChallengeGetStats(nk, targetUserId);

        // Add computed fields
        var totalGames = stats.totalWins + stats.totalLosses + stats.totalDraws;
        stats.winRate = totalGames > 0 ? Math.round((stats.totalWins / totalGames) * 100) : 0;
        stats.gamesPlayed = totalGames;

        // Get display name
        stats.displayName = asyncChallengeGetDisplayName(nk, targetUserId, 'Unknown Player');

        return JSON.stringify({
            success: true,
            message: 'Stats retrieved',
            data: stats
        });
    } catch (err) {
        logger.error('[AsyncChallenge] Stats error: ' + err.message);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

// ============================================================================
// RPC: async_challenge_rematch - Create a rematch from a completed challenge
// ============================================================================
/**
 * Create a rematch from a completed challenge (swaps challenger/opponent roles)
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime context
 * @param {string} payload - JSON payload: { sessionId, userId? }
 * @returns {string} JSON response with new session data
 */
function rpcAsyncChallengeRematch(ctx, logger, nk, payload) {
    logger.debug('[AsyncChallenge] User ' + ctx.userId + ' requesting rematch');

    var request;
    try {
        request = JSON.parse(payload || '{}');
    } catch (e) {
        return JSON.stringify({ success: false, message: 'Invalid JSON payload', data: null });
    }

    try {
        // Validate user
        var userValidation = asyncChallengeValidateUser(ctx, request);
        if (!userValidation.valid) {
            return JSON.stringify({
                success: false,
                message: userValidation.error,
                data: null,
                errorCode: 'AUTH_REQUIRED'
            });
        }
        var userId = userValidation.userId;

        var originalSessionId = request.sessionId || request.SessionId;
        if (!originalSessionId) {
            return JSON.stringify({
                success: false,
                message: 'Original session ID required.',
                data: null
            });
        }

        // Check active challenge limit
        var activeCount = asyncChallengeCountActive(nk, userId);
        if (activeCount >= ASYNC_CHALLENGE_MAX_PER_USER) {
            return JSON.stringify({
                success: false,
                message: 'Maximum active challenges reached. Complete or cancel existing challenges first.',
                data: null,
                errorCode: 'MAX_CHALLENGES'
            });
        }

        // Find the original session
        var sessionResults = nk.storageRead([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: originalSessionId,
            userId: userId
        }]);

        // If not found as owner, search
        if (sessionResults.length === 0) {
            var listResults = nk.storageList(null, COLLECTION_ASYNC_CHALLENGES, 200, '');
            var objects = listResults.objects || [];

            for (var i = 0; i < objects.length; i++) {
                var obj = objects[i];
                if (obj.value.sessionId === originalSessionId) {
                    sessionResults = [obj];
                    break;
                }
            }
        }

        if (sessionResults.length === 0) {
            return JSON.stringify({
                success: false,
                message: 'Original challenge not found.',
                data: null
            });
        }

        var originalSession = sessionResults[0].value;

        // Verify user was part of original challenge
        var wasCreator = originalSession.creatorId === userId;
        var wasOpponent = originalSession.opponentId === userId;

        if (!wasCreator && !wasOpponent) {
            return JSON.stringify({
                success: false,
                message: 'Not authorized to create rematch for this challenge.',
                data: null
            });
        }

        // Must be completed to rematch
        if (originalSession.status !== ASYNC_STATUS_BOTH_COMPLETED) {
            return JSON.stringify({
                success: false,
                message: 'Can only rematch completed challenges.',
                data: null
            });
        }

        // Determine the opponent for rematch (the other player becomes challenged)
        var challengedUserId = wasCreator ? originalSession.opponentId : originalSession.creatorId;
        var challengedDisplayName = wasCreator ? originalSession.opponentName : originalSession.creatorName;

        // Generate new session
        var newSessionId = nk.uuidv4();
        var shareCode = asyncChallengeGenerateShareCode(newSessionId);
        var now = Date.now();
        var expiresAt = now + (ASYNC_CHALLENGE_EXPIRY_HOURS * 60 * 60 * 1000);

        var creatorName = asyncChallengeGetDisplayName(nk, userId, 'Unknown');

        var newSessionStorage = {
            sessionId: newSessionId,
            shareCode: shareCode,
            quizModeType: originalSession.quizModeType,
            quizModeName: originalSession.quizModeName,
            quizConfig: originalSession.quizConfig,
            gameId: originalSession.gameId || '',
            creatorId: userId,
            creatorName: creatorName,
            opponentId: null,
            opponentName: null,
            challengedUserId: challengedUserId,
            challengedDisplayName: challengedDisplayName,
            status: ASYNC_STATUS_WAITING,
            createdAt: now,
            expiresAt: expiresAt,
            isRematch: true,
            originalSessionId: originalSessionId,
            // Creator results
            creatorCompleted: false,
            creatorScore: 0,
            creatorCorrectAnswers: 0,
            creatorTotalQuestions: 0,
            creatorTimeTaken: 0,
            creatorCompletedAt: 0,
            // Opponent results
            opponentCompleted: false,
            opponentScore: 0,
            opponentCorrectAnswers: 0,
            opponentTotalQuestions: 0,
            opponentTimeTaken: 0,
            opponentCompletedAt: 0
        };

        // Store new session
        nk.storageWrite([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: newSessionId,
            userId: userId,
            value: newSessionStorage,
            permissionRead: 2,
            permissionWrite: 1
        }]);

        // Store share code mapping
        nk.storageWrite([{
            collection: COLLECTION_ASYNC_CHALLENGES,
            key: 'code_' + shareCode,
            userId: ASYNC_CHALLENGE_SYSTEM_USER,
            value: { sessionId: newSessionId, creatorId: userId },
            permissionRead: 2,
            permissionWrite: 0
        }]);

        // Notify challenged player
        asyncChallengeSendNotification(nk, challengedUserId,
            'Rematch Challenge!',
            creatorName + ' wants a rematch in ' + originalSession.quizModeName + '!',
            {
                type: 'rematch_requested',
                sessionId: newSessionId,
                shareCode: shareCode,
                challengerId: userId,
                challengerName: creatorName,
                quizModeName: originalSession.quizModeName,
                originalSessionId: originalSessionId
            }
        );

        logger.info('[AsyncChallenge] Rematch created: ' + newSessionId + ' from: ' + originalSessionId + ' by user: ' + userId);

        return JSON.stringify({
            success: true,
            message: 'Rematch challenge created',
            data: asyncChallengeSessionToUnityFormat(newSessionStorage)
        });
    } catch (err) {
        logger.error('[AsyncChallenge] Rematch error: ' + err.message);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}

// ============================================================================
// RPC: async_challenge_leaderboard - Get async challenge leaderboard
// ============================================================================
/**
 * Get async challenge leaderboard (top players by wins)
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime context
 * @param {string} payload - JSON payload: { limit?, sortBy?, userId? }
 * @returns {string} JSON response with leaderboard data
 */
function rpcAsyncChallengeLeaderboard(ctx, logger, nk, payload) {
    var request = {};
    try {
        if (payload) {
            request = JSON.parse(payload);
        }
    } catch (e) {
        // Use defaults
    }

    try {
        // Validate user
        var userValidation = asyncChallengeValidateUser(ctx, request);
        if (!userValidation.valid) {
            return JSON.stringify({
                success: false,
                message: userValidation.error,
                data: [],
                errorCode: 'AUTH_REQUIRED'
            });
        }
        var userId = userValidation.userId;

        var limit = Math.min(request.limit || request.Limit || 20, 100);
        var sortBy = request.sortBy || request.SortBy || 'wins'; // wins, winRate, streak

        // Get all stats from storage
        var allStats = [];
        try {
            var statsResults = nk.storageList(null, COLLECTION_ASYNC_STATS, 500, '');
            var objects = statsResults.objects || [];

            for (var i = 0; i < objects.length; i++) {
                var obj = objects[i];
                if (obj.key.indexOf('stats_') === 0) {
                    var stats = obj.value;
                    stats.displayName = asyncChallengeGetDisplayName(nk, stats.userId, 'Unknown');
                    var totalGames = stats.totalWins + stats.totalLosses + stats.totalDraws;
                    stats.winRate = totalGames > 0 ? Math.round((stats.totalWins / totalGames) * 100) : 0;
                    stats.gamesPlayed = totalGames;

                    // Only include players with at least 3 games
                    if (totalGames >= 3) {
                        allStats.push(stats);
                    }
                }
            }
        } catch (err) {
            logger.warn('[AsyncChallenge] Could not fetch leaderboard: ' + err.message);
        }

        // Sort by criteria
        if (sortBy === 'winRate') {
            allStats.sort(function(a, b) {
                return b.winRate - a.winRate;
            });
        } else if (sortBy === 'streak') {
            allStats.sort(function(a, b) {
                return b.bestWinStreak - a.bestWinStreak;
            });
        } else {
            // Default: sort by wins
            allStats.sort(function(a, b) {
                return b.totalWins - a.totalWins;
            });
        }

        // Apply limit and add rank
        var leaderboard = [];
        for (var j = 0; j < Math.min(allStats.length, limit); j++) {
            var entry = allStats[j];
            entry.rank = j + 1;
            entry.isCurrentUser = entry.userId === userId;
            leaderboard.push(entry);
        }

        // Find current user's rank if not in top
        var currentUserRank = -1;
        var currentUserStats = null;
        for (var k = 0; k < allStats.length; k++) {
            if (allStats[k].userId === userId) {
                currentUserRank = k + 1;
                currentUserStats = allStats[k];
                currentUserStats.rank = currentUserRank;
                break;
            }
        }

        return JSON.stringify({
            success: true,
            message: 'Leaderboard retrieved',
            data: {
                entries: leaderboard,
                currentUser: currentUserStats,
                currentUserRank: currentUserRank,
                totalPlayers: allStats.length,
                sortBy: sortBy
            }
        });
    } catch (err) {
        logger.error('[AsyncChallenge] Leaderboard error: ' + err.message);
        return JSON.stringify({ success: false, message: err.message, data: null });
    }
}


// ============================================================================
// BADGES & COLLECTABLES SYSTEM
// Supports per-game badges and collectables with player tracking
// ============================================================================
var BADGE_COLLECTION = "badges";
var BADGE_PROGRESS_COLLECTION = "badge_progress";
var COLLECTABLE_COLLECTION = "collectables";
var COLLECTABLE_INVENTORY_COLLECTION = "collectable_inventory";
var BADGE_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

var BADGE_CATEGORIES = {
    COMBAT: "combat",
    QUIZ: "quiz",
    SOCIAL: "social",
    STREAK: "streak",
    SPECIAL: "special",
    SEASONAL: "seasonal"
};

var RARITY_TIERS = {
    COMMON: "common",
    RARE: "rare",
    EPIC: "epic",
    LEGENDARY: "legendary"
};

/**
 * RPC: badges_get_all - Get all badges for a game with player progress
 */
function rpcBadgesGetAll(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        if (!data.game_id) {
            throw Error("game_id is required");
        }

        var userId = ctx.userId;
        var gameId = data.game_id;

        logger.info("[Badges] Getting all badges for game: " + gameId + ", user: " + userId);

        // Get badge definitions
        var definitionsKey = "definitions_" + gameId;
        var definitions = [];

        try {
            var defRecords = nk.storageRead([{
                collection: BADGE_COLLECTION,
                key: definitionsKey,
                userId: BADGE_SYSTEM_USER_ID
            }]);

            if (defRecords && defRecords.length > 0 && defRecords[0].value) {
                definitions = defRecords[0].value.badges || [];
            }
        } catch (err) {
            logger.warn("[Badges] No definitions found for game: " + gameId);
        }

        // Get player progress
        var progressKey = "progress_" + userId + "_" + gameId;
        var progress = {};

        try {
            var progRecords = nk.storageRead([{
                collection: BADGE_PROGRESS_COLLECTION,
                key: progressKey,
                userId: userId
            }]);

            if (progRecords && progRecords.length > 0 && progRecords[0].value) {
                progress = progRecords[0].value;
            }
        } catch (err) {
            logger.debug("[Badges] No progress found for user: " + userId);
        }

        // Merge definitions with progress
        var badges = [];
        for (var i = 0; i < definitions.length; i++) {
            var def = definitions[i];
            var prog = progress[def.badge_id] || {
                progress: 0,
                unlocked: false,
                unlock_date: null,
                displayed: false
            };

            // Hide secret badges if not unlocked
            if (def.hidden && !prog.unlocked) {
                badges.push({
                    badge_id: def.badge_id,
                    title: "???",
                    description: "Hidden badge",
                    icon_url: "badges/mystery.png",
                    category: def.category,
                    rarity: def.rarity,
                    progress: 0,
                    target: def.target,
                    unlocked: false,
                    hidden: true,
                    points: def.points,
                    order: def.order || 999
                });
            } else {
                badges.push({
                    badge_id: def.badge_id,
                    title: def.title,
                    description: def.description,
                    icon_url: def.icon_url,
                    category: def.category,
                    rarity: def.rarity,
                    type: def.type,
                    progress: prog.progress,
                    target: def.target,
                    unlocked: prog.unlocked,
                    unlock_date: prog.unlock_date,
                    displayed: prog.displayed,
                    rewards: def.rewards,
                    hidden: def.hidden || false,
                    points: def.points,
                    order: def.order || 999
                });
            }
        }

        // Sort by order, then by unlocked status
        badges.sort(function(a, b) {
            if (a.unlocked !== b.unlocked) return b.unlocked ? 1 : -1;
            return a.order - b.order;
        });

        // Calculate stats
        var totalPoints = 0;
        var unlockedPoints = 0;
        var unlockedCount = 0;

        for (var j = 0; j < badges.length; j++) {
            totalPoints += badges[j].points || 0;
            if (badges[j].unlocked) {
                unlockedPoints += badges[j].points || 0;
                unlockedCount++;
            }
        }

        return JSON.stringify({
            success: true,
            badges: badges,
            stats: {
                total_badges: badges.length,
                unlocked: unlockedCount,
                total_points: totalPoints,
                unlocked_points: unlockedPoints,
                completion_percentage: badges.length > 0
                    ? Math.round((unlockedCount / badges.length) * 100)
                    : 0
            }
        });

    } catch (err) {
        logger.error("[Badges] Get all error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * Grant badge rewards (coins, XP, items)
 */
function grantBadgeRewardsInternal(nk, logger, userId, gameId, rewards) {
    var granted = { coins: 0, xp: 0, items: [] };

    try {
        if (rewards.coins && rewards.coins > 0) {
            try {
                var walletUpdate = {};
                walletUpdate["coins"] = rewards.coins;
                nk.walletUpdate(userId, walletUpdate, { source: "badge_reward", game_id: gameId });
                granted.coins = rewards.coins;
                logger.info("[Badges] Granted " + rewards.coins + " coins to user: " + userId);
            } catch (walletErr) {
                logger.warn("[Badges] Wallet update failed: " + walletErr.message);
            }
        }

        if (rewards.xp && rewards.xp > 0) {
            try {
                var account = nk.accountGetId(userId);
                var metadata = account.user.metadata || {};
                metadata.total_xp = (metadata.total_xp || 0) + rewards.xp;
                nk.accountUpdateId(userId, null, null, null, null, null, null, metadata);
                granted.xp = rewards.xp;
            } catch (xpErr) {
                logger.warn("[Badges] XP grant failed: " + xpErr.message);
            }
        }

        if (rewards.collectables && rewards.collectables.length > 0) {
            for (var i = 0; i < rewards.collectables.length; i++) {
                granted.items.push(rewards.collectables[i]);
            }
        }

        return granted;
    } catch (err) {
        logger.error("[Badges] Reward grant error: " + err.message);
        return granted;
    }
}

/**
 * RPC: badges_update_progress - Update progress towards a badge
 */
function rpcBadgesUpdateProgress(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');

        if (!data.game_id || !data.badge_id || data.progress === undefined) {
            throw Error("game_id, badge_id, and progress are required");
        }

        var userId = ctx.userId;
        var gameId = data.game_id;
        var badgeId = data.badge_id;
        var newProgress = data.progress;
        var increment = data.increment || false;

        logger.info("[Badges] Updating progress for " + badgeId + ": " + newProgress);

        // Get badge definition
        var definitionsKey = "definitions_" + gameId;
        var badge = null;

        var defRecords = nk.storageRead([{
            collection: BADGE_COLLECTION,
            key: definitionsKey,
            userId: BADGE_SYSTEM_USER_ID
        }]);

        if (defRecords && defRecords.length > 0 && defRecords[0].value) {
            var definitions = defRecords[0].value.badges || [];
            for (var i = 0; i < definitions.length; i++) {
                if (definitions[i].badge_id === badgeId) {
                    badge = definitions[i];
                    break;
                }
            }
        }

        if (!badge) {
            throw Error("Badge not found: " + badgeId);
        }

        // Get or create progress record
        var progressKey = "progress_" + userId + "_" + gameId;
        var progressData = {};

        try {
            var progRecords = nk.storageRead([{
                collection: BADGE_PROGRESS_COLLECTION,
                key: progressKey,
                userId: userId
            }]);

            if (progRecords && progRecords.length > 0 && progRecords[0].value) {
                progressData = progRecords[0].value;
            }
        } catch (err) {
            logger.debug("[Badges] Creating new progress record");
        }

        // Initialize badge progress if doesn't exist
        if (!progressData[badgeId]) {
            progressData[badgeId] = {
                progress: 0,
                unlocked: false,
                unlock_date: null,
                displayed: false
            };
        }

        var badgeProgress = progressData[badgeId];

        // Don't update if already unlocked
        if (badgeProgress.unlocked) {
            return JSON.stringify({
                success: true,
                badge: {
                    badge_id: badgeId,
                    progress: badgeProgress.progress,
                    target: badge.target,
                    unlocked: true,
                    already_unlocked: true
                }
            });
        }

        // Update progress
        if (increment) {
            badgeProgress.progress += newProgress;
        } else {
            badgeProgress.progress = Math.max(badgeProgress.progress, newProgress);
        }

        // Check if unlocked
        var justUnlocked = false;
        if (badgeProgress.progress >= badge.target) {
            badgeProgress.unlocked = true;
            badgeProgress.unlock_date = new Date().toISOString();
            justUnlocked = true;

            logger.info("[Badges] Badge unlocked: " + badgeId + " for user: " + userId);

            try {
                nk.notificationsSend([{
                    userId: userId,
                    subject: "Badge Unlocked!",
                    content: {
                        type: "badge_unlocked",
                        badge_id: badgeId,
                        title: badge.title,
                        icon_url: badge.icon_url,
                        rarity: badge.rarity,
                        rewards: badge.rewards
                    },
                    code: 100,
                    persistent: true
                }]);
            } catch (notifErr) {
                logger.warn("[Badges] Failed to send notification: " + notifErr.message);
            }
        }

        // Save progress
        progressData[badgeId] = badgeProgress;

        nk.storageWrite([{
            collection: BADGE_PROGRESS_COLLECTION,
            key: progressKey,
            userId: userId,
            value: progressData,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Grant rewards if unlocked
        var rewardsGranted = null;
        if (justUnlocked && badge.rewards) {
            rewardsGranted = grantBadgeRewardsInternal(nk, logger, userId, gameId, badge.rewards);
        }

        return JSON.stringify({
            success: true,
            badge: {
                badge_id: badgeId,
                title: badge.title,
                progress: badgeProgress.progress,
                target: badge.target,
                unlocked: badgeProgress.unlocked,
                just_unlocked: justUnlocked,
                unlock_date: badgeProgress.unlock_date
            },
            rewards_granted: rewardsGranted
        });

    } catch (err) {
        logger.error("[Badges] Update progress error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: badges_check_event - Check and update badges based on a game event
 */
function rpcBadgesCheckEvent(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');

        if (!data.game_id || !data.event_type) {
            throw Error("game_id and event_type are required");
        }

        var userId = ctx.userId;
        var gameId = data.game_id;
        var eventType = data.event_type;
        var eventData = data.event_data || {};

        logger.info("[Badges] Checking event: " + eventType + " for game: " + gameId);

        // Get all badge definitions
        var definitionsKey = "definitions_" + gameId;
        var definitions = [];

        try {
            var defRecords = nk.storageRead([{
                collection: BADGE_COLLECTION,
                key: definitionsKey,
                userId: BADGE_SYSTEM_USER_ID
            }]);

            if (defRecords && defRecords.length > 0 && defRecords[0].value) {
                definitions = defRecords[0].value.badges || [];
            }
        } catch (err) {
            return JSON.stringify({
                success: true,
                badges_updated: [],
                badges_unlocked: [],
                message: "No badges configured"
            });
        }

        // Get player progress
        var progressKey = "progress_" + userId + "_" + gameId;
        var progressData = {};

        try {
            var progRecords = nk.storageRead([{
                collection: BADGE_PROGRESS_COLLECTION,
                key: progressKey,
                userId: userId
            }]);

            if (progRecords && progRecords.length > 0 && progRecords[0].value) {
                progressData = progRecords[0].value;
            }
        } catch (err) {
            // New player, no progress yet
        }

        var badgesUpdated = [];
        var badgesUnlocked = [];

        // Check each badge that matches this event
        for (var i = 0; i < definitions.length; i++) {
            var badge = definitions[i];

            // Skip if already unlocked
            if (progressData[badge.badge_id] && progressData[badge.badge_id].unlocked) {
                continue;
            }

            // Check if this badge matches the event
            if (badge.unlock_criteria && badge.unlock_criteria.event === eventType) {
                // Initialize progress if needed
                if (!progressData[badge.badge_id]) {
                    progressData[badge.badge_id] = {
                        progress: 0,
                        unlocked: false,
                        unlock_date: null,
                        displayed: false
                    };
                }

                var prog = progressData[badge.badge_id];
                var badgeIncrement = eventData.count || 1;
                prog.progress += badgeIncrement;

                badgesUpdated.push({
                    badge_id: badge.badge_id,
                    title: badge.title,
                    progress: prog.progress,
                    target: badge.target
                });

                // Check if unlocked
                if (prog.progress >= badge.target) {
                    prog.unlocked = true;
                    prog.unlock_date = new Date().toISOString();

                    badgesUnlocked.push({
                        badge_id: badge.badge_id,
                        title: badge.title,
                        icon_url: badge.icon_url,
                        rarity: badge.rarity,
                        rewards: badge.rewards
                    });

                    // Grant rewards
                    if (badge.rewards) {
                        grantBadgeRewardsInternal(nk, logger, userId, gameId, badge.rewards);
                    }

                    // Send notification
                    try {
                        nk.notificationsSend([{
                            userId: userId,
                            subject: "Badge Unlocked: " + badge.title,
                            content: {
                                type: "badge_unlocked",
                                badge_id: badge.badge_id,
                                title: badge.title,
                                icon_url: badge.icon_url,
                                rarity: badge.rarity
                            },
                            code: 100,
                            persistent: true
                        }]);
                    } catch (notifErr) {
                        logger.warn("[Badges] Notification error: " + notifErr.message);
                    }
                }

                progressData[badge.badge_id] = prog;
            }
        }

        // Save updated progress
        if (badgesUpdated.length > 0) {
            nk.storageWrite([{
                collection: BADGE_PROGRESS_COLLECTION,
                key: progressKey,
                userId: userId,
                value: progressData,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }

        return JSON.stringify({
            success: true,
            badges_updated: badgesUpdated,
            badges_unlocked: badgesUnlocked
        });

    } catch (err) {
        logger.error("[Badges] Check event error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: badges_set_displayed - Set which badge the player wants to display
 */
function rpcBadgesSetDisplayed(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');

        if (!data.game_id || !data.badge_id) {
            throw Error("game_id and badge_id are required");
        }

        var userId = ctx.userId;
        var gameId = data.game_id;
        var badgeId = data.badge_id;

        // Get progress
        var progressKey = "progress_" + userId + "_" + gameId;
        var progressData = {};

        var progRecords = nk.storageRead([{
            collection: BADGE_PROGRESS_COLLECTION,
            key: progressKey,
            userId: userId
        }]);

        if (progRecords && progRecords.length > 0 && progRecords[0].value) {
            progressData = progRecords[0].value;
        }

        // Check if badge is unlocked
        if (!progressData[badgeId] || !progressData[badgeId].unlocked) {
            throw Error("Badge not unlocked");
        }

        // Clear all displayed flags, set the new one
        for (var key in progressData) {
            if (progressData.hasOwnProperty(key)) {
                progressData[key].displayed = (key === badgeId);
            }
        }

        // Save
        nk.storageWrite([{
            collection: BADGE_PROGRESS_COLLECTION,
            key: progressKey,
            userId: userId,
            value: progressData,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Also update account metadata for quick access
        var account = nk.accountGetId(userId);
        var metadata = account.user.metadata || {};
        metadata.displayed_badge = badgeId;
        metadata.displayed_badge_game = gameId;

        nk.accountUpdateId(userId, null, null, null, null, null, null, metadata);

        return JSON.stringify({
            success: true,
            displayed_badge: badgeId
        });

    } catch (err) {
        logger.error("[Badges] Set displayed error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: badges_bulk_create - Create multiple badge definitions (Admin)
 */
function rpcBadgesBulkCreate(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');

        if (!data.game_id || !data.badges || !Array.isArray(data.badges)) {
            throw Error("game_id and badges array are required");
        }

        var gameId = data.game_id;
        var badgesToCreate = data.badges;
        var definitionsKey = "definitions_" + gameId;

        // Get existing definitions
        var definitions = { badges: [] };

        try {
            var records = nk.storageRead([{
                collection: BADGE_COLLECTION,
                key: definitionsKey,
                userId: BADGE_SYSTEM_USER_ID
            }]);

            if (records && records.length > 0 && records[0].value) {
                definitions = records[0].value;
            }
        } catch (err) {
            logger.debug("[Badges] Creating new definitions collection");
        }

        var created = [];
        var updated = [];
        var errors = [];

        for (var i = 0; i < badgesToCreate.length; i++) {
            var badgeData = badgesToCreate[i];

            try {
                if (!badgeData.badge_id || !badgeData.title) {
                    throw Error("badge_id and title are required");
                }

                // Check if exists
                var existingIndex = -1;
                for (var j = 0; j < definitions.badges.length; j++) {
                    if (definitions.badges[j].badge_id === badgeData.badge_id) {
                        existingIndex = j;
                        break;
                    }
                }

                var badge = {
                    badge_id: badgeData.badge_id,
                    game_id: gameId,
                    title: badgeData.title,
                    description: badgeData.description || "",
                    icon_url: badgeData.icon_url || "badges/default.png",
                    category: badgeData.category || "general",
                    rarity: badgeData.rarity || "common",
                    type: badgeData.type || "progressive",
                    target: badgeData.target || 1,
                    unlock_criteria: badgeData.unlock_criteria || null,
                    rewards: badgeData.rewards || { coins: 100 },
                    hidden: badgeData.hidden || false,
                    points: badgeData.points || 10,
                    order: badgeData.order || (definitions.badges.length + i + 1),
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                if (existingIndex >= 0) {
                    badge.created_at = definitions.badges[existingIndex].created_at;
                    definitions.badges[existingIndex] = badge;
                    updated.push(badge.badge_id);
                } else {
                    definitions.badges.push(badge);
                    created.push(badge.badge_id);
                }

            } catch (err) {
                errors.push({
                    badge_id: badgeData.badge_id,
                    error: err.message
                });
            }
        }

        // Save definitions
        if (created.length > 0 || updated.length > 0) {
            nk.storageWrite([{
                collection: BADGE_COLLECTION,
                key: definitionsKey,
                userId: BADGE_SYSTEM_USER_ID,
                value: definitions,
                permissionRead: 2,
                permissionWrite: 0
            }]);
        }

        logger.info("[Badges] Bulk create completed - created: " + created.length + ", updated: " + updated.length);

        return JSON.stringify({
            success: true,
            created: created,
            updated: updated,
            errors: errors,
            total_badges: definitions.badges.length
        });

    } catch (err) {
        logger.error("[Badges] Bulk create error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: collectables_get_all - Get all collectables for a game with player inventory
 */
function rpcCollectablesGetAll(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');

        if (!data.game_id) {
            throw Error("game_id is required");
        }

        var userId = ctx.userId;
        var gameId = data.game_id;

        logger.info("[Collectables] Getting all for game: " + gameId + ", user: " + userId);

        // Get collectable definitions
        var definitionsKey = "definitions_" + gameId;
        var definitions = [];

        try {
            var defRecords = nk.storageRead([{
                collection: COLLECTABLE_COLLECTION,
                key: definitionsKey,
                userId: BADGE_SYSTEM_USER_ID
            }]);

            if (defRecords && defRecords.length > 0 && defRecords[0].value) {
                definitions = defRecords[0].value.collectables || [];
            }
        } catch (err) {
            logger.warn("[Collectables] No definitions found for game: " + gameId);
        }

        // Get player inventory
        var inventoryKey = "inventory_" + userId + "_" + gameId;
        var inventory = {};

        try {
            var invRecords = nk.storageRead([{
                collection: COLLECTABLE_INVENTORY_COLLECTION,
                key: inventoryKey,
                userId: userId
            }]);

            if (invRecords && invRecords.length > 0 && invRecords[0].value) {
                inventory = invRecords[0].value;
            }
        } catch (err) {
            logger.debug("[Collectables] No inventory found for user: " + userId);
        }

        // Merge definitions with inventory
        var collectables = [];
        var ownedCount = 0;
        var totalCount = definitions.length;

        for (var i = 0; i < definitions.length; i++) {
            var def = definitions[i];
            var inv = inventory[def.collectable_id] || {
                quantity: 0,
                acquired_date: null,
                equipped: false
            };

            var owned = inv.quantity > 0;
            if (owned) ownedCount++;

            collectables.push({
                collectable_id: def.collectable_id,
                title: def.title,
                description: def.description,
                icon_url: def.icon_url,
                category: def.category,
                rarity: def.rarity,
                max_quantity: def.max_quantity,
                tradeable: def.tradeable,
                source: def.source,
                metadata: def.metadata,
                quantity: inv.quantity,
                owned: owned,
                acquired_date: inv.acquired_date,
                equipped: inv.equipped
            });
        }

        // Sort by owned status, then rarity, then name
        var rarityOrder = { legendary: 0, epic: 1, rare: 2, common: 3 };
        collectables.sort(function(a, b) {
            if (a.owned !== b.owned) return b.owned ? 1 : -1;
            var rarityDiff = (rarityOrder[a.rarity] || 3) - (rarityOrder[b.rarity] || 3);
            if (rarityDiff !== 0) return rarityDiff;
            return a.title.localeCompare(b.title);
        });

        return JSON.stringify({
            success: true,
            collectables: collectables,
            inventory_stats: {
                total_collectables: totalCount,
                owned: ownedCount,
                completion_percentage: totalCount > 0
                    ? Math.round((ownedCount / totalCount) * 100)
                    : 0
            }
        });

    } catch (err) {
        logger.error("[Collectables] Get all error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: collectables_grant - Grant a collectable to a player
 */
function rpcCollectablesGrant(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');

        if (!data.game_id || !data.collectable_id) {
            throw Error("game_id and collectable_id are required");
        }

        var userId = data.user_id || ctx.userId;
        var gameId = data.game_id;
        var collectableId = data.collectable_id;
        var quantity = data.quantity || 1;
        var source = data.source || "system";

        logger.info("[Collectables] Granting " + collectableId + " (x" + quantity + ") to user: " + userId);

        // Verify collectable exists
        var definitionsKey = "definitions_" + gameId;
        var collectable = null;

        var defRecords = nk.storageRead([{
            collection: COLLECTABLE_COLLECTION,
            key: definitionsKey,
            userId: BADGE_SYSTEM_USER_ID
        }]);

        if (defRecords && defRecords.length > 0 && defRecords[0].value) {
            var definitions = defRecords[0].value.collectables || [];
            for (var i = 0; i < definitions.length; i++) {
                if (definitions[i].collectable_id === collectableId) {
                    collectable = definitions[i];
                    break;
                }
            }
        }

        if (!collectable) {
            throw Error("Collectable not found: " + collectableId);
        }

        // Get or create inventory
        var inventoryKey = "inventory_" + userId + "_" + gameId;
        var inventory = {};

        try {
            var invRecords = nk.storageRead([{
                collection: COLLECTABLE_INVENTORY_COLLECTION,
                key: inventoryKey,
                userId: userId
            }]);

            if (invRecords && invRecords.length > 0 && invRecords[0].value) {
                inventory = invRecords[0].value;
            }
        } catch (err) {
            // New inventory
        }

        // Initialize if needed
        if (!inventory[collectableId]) {
            inventory[collectableId] = {
                quantity: 0,
                acquired_date: null,
                equipped: false,
                acquisition_history: []
            };
        }

        var item = inventory[collectableId];
        var isFirstAcquisition = item.quantity === 0;

        // Check max quantity
        var maxQty = collectable.max_quantity || 999;
        var newQuantity = Math.min(item.quantity + quantity, maxQty);
        var actualGranted = newQuantity - item.quantity;

        if (actualGranted <= 0) {
            return JSON.stringify({
                success: true,
                collectable_id: collectableId,
                quantity_granted: 0,
                current_quantity: item.quantity,
                at_max: true
            });
        }

        // Update inventory
        item.quantity = newQuantity;
        if (isFirstAcquisition) {
            item.acquired_date = new Date().toISOString();
        }
        if (!item.acquisition_history) {
            item.acquisition_history = [];
        }
        item.acquisition_history.push({
            date: new Date().toISOString(),
            quantity: actualGranted,
            source: source
        });

        inventory[collectableId] = item;

        // Save inventory
        nk.storageWrite([{
            collection: COLLECTABLE_INVENTORY_COLLECTION,
            key: inventoryKey,
            userId: userId,
            value: inventory,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Send notification for new collectables
        if (isFirstAcquisition) {
            try {
                nk.notificationsSend([{
                    userId: userId,
                    subject: "New Collectable!",
                    content: {
                        type: "collectable_acquired",
                        collectable_id: collectableId,
                        title: collectable.title,
                        icon_url: collectable.icon_url,
                        rarity: collectable.rarity
                    },
                    code: 101,
                    persistent: true
                }]);
            } catch (notifErr) {
                logger.warn("[Collectables] Notification error: " + notifErr.message);
            }
        }

        return JSON.stringify({
            success: true,
            collectable_id: collectableId,
            title: collectable.title,
            quantity_granted: actualGranted,
            current_quantity: newQuantity,
            is_new: isFirstAcquisition
        });

    } catch (err) {
        logger.error("[Collectables] Grant error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: collectables_equip - Equip a collectable (e.g., profile frame)
 */
function rpcCollectablesEquip(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');

        if (!data.game_id || !data.collectable_id) {
            throw Error("game_id and collectable_id are required");
        }

        var userId = ctx.userId;
        var gameId = data.game_id;
        var collectableId = data.collectable_id;

        // Get inventory
        var inventoryKey = "inventory_" + userId + "_" + gameId;
        var inventory = {};

        var invRecords = nk.storageRead([{
            collection: COLLECTABLE_INVENTORY_COLLECTION,
            key: inventoryKey,
            userId: userId
        }]);

        if (invRecords && invRecords.length > 0 && invRecords[0].value) {
            inventory = invRecords[0].value;
        }

        // Check if owned
        if (!inventory[collectableId] || inventory[collectableId].quantity <= 0) {
            throw Error("Collectable not owned");
        }

        // Get collectable definition for category
        var definitionsKey = "definitions_" + gameId;
        var collectable = null;
        var definitions = [];

        var defRecords = nk.storageRead([{
            collection: COLLECTABLE_COLLECTION,
            key: definitionsKey,
            userId: BADGE_SYSTEM_USER_ID
        }]);

        if (defRecords && defRecords.length > 0 && defRecords[0].value) {
            definitions = defRecords[0].value.collectables || [];
            for (var i = 0; i < definitions.length; i++) {
                if (definitions[i].collectable_id === collectableId) {
                    collectable = definitions[i];
                    break;
                }
            }
        }

        if (!collectable) {
            throw Error("Collectable definition not found");
        }

        // Unequip any other items in the same category
        for (var key in inventory) {
            if (inventory.hasOwnProperty(key) && inventory[key].equipped) {
                for (var j = 0; j < definitions.length; j++) {
                    if (definitions[j].collectable_id === key &&
                        definitions[j].category === collectable.category) {
                        inventory[key].equipped = false;
                    }
                }
            }
        }

        // Equip the selected item
        inventory[collectableId].equipped = true;
        inventory[collectableId].equipped_date = new Date().toISOString();

        // Save inventory
        nk.storageWrite([{
            collection: COLLECTABLE_INVENTORY_COLLECTION,
            key: inventoryKey,
            userId: userId,
            value: inventory,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Update account metadata for quick profile access
        var account = nk.accountGetId(userId);
        var metadata = account.user.metadata || {};

        if (!metadata.equipped_collectables) {
            metadata.equipped_collectables = {};
        }
        metadata.equipped_collectables[collectable.category] = {
            collectable_id: collectableId,
            icon_url: collectable.icon_url,
            game_id: gameId
        };

        nk.accountUpdateId(userId, null, null, null, null, null, null, metadata);

        return JSON.stringify({
            success: true,
            equipped: collectableId,
            category: collectable.category
        });

    } catch (err) {
        logger.error("[Collectables] Equip error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: collectables_bulk_create - Create multiple collectable definitions (Admin)
 */
function rpcCollectablesBulkCreate(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');

        if (!data.game_id || !data.collectables || !Array.isArray(data.collectables)) {
            throw Error("game_id and collectables array are required");
        }

        var gameId = data.game_id;
        var collectablesToCreate = data.collectables;
        var definitionsKey = "definitions_" + gameId;

        // Get existing definitions
        var definitions = { collectables: [] };

        try {
            var records = nk.storageRead([{
                collection: COLLECTABLE_COLLECTION,
                key: definitionsKey,
                userId: BADGE_SYSTEM_USER_ID
            }]);

            if (records && records.length > 0 && records[0].value) {
                definitions = records[0].value;
            }
        } catch (err) {
            logger.debug("[Collectables] Creating new definitions collection");
        }

        var created = [];
        var updated = [];
        var errors = [];

        for (var i = 0; i < collectablesToCreate.length; i++) {
            var colData = collectablesToCreate[i];

            try {
                if (!colData.collectable_id || !colData.title) {
                    throw Error("collectable_id and title are required");
                }

                // Check if exists
                var existingIndex = -1;
                for (var j = 0; j < definitions.collectables.length; j++) {
                    if (definitions.collectables[j].collectable_id === colData.collectable_id) {
                        existingIndex = j;
                        break;
                    }
                }

                var collectable = {
                    collectable_id: colData.collectable_id,
                    game_id: gameId,
                    title: colData.title,
                    description: colData.description || "",
                    icon_url: colData.icon_url || "collectables/default.png",
                    category: colData.category || "general",
                    rarity: colData.rarity || "common",
                    max_quantity: colData.max_quantity || 1,
                    tradeable: colData.tradeable || false,
                    source: colData.source || ["system"],
                    metadata: colData.metadata || {},
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                if (existingIndex >= 0) {
                    collectable.created_at = definitions.collectables[existingIndex].created_at;
                    definitions.collectables[existingIndex] = collectable;
                    updated.push(collectable.collectable_id);
                } else {
                    definitions.collectables.push(collectable);
                    created.push(collectable.collectable_id);
                }

            } catch (err) {
                errors.push({
                    collectable_id: colData.collectable_id,
                    error: err.message
                });
            }
        }

        // Save definitions
        if (created.length > 0 || updated.length > 0) {
            nk.storageWrite([{
                collection: COLLECTABLE_COLLECTION,
                key: definitionsKey,
                userId: BADGE_SYSTEM_USER_ID,
                value: definitions,
                permissionRead: 2,
                permissionWrite: 0
            }]);
        }

        logger.info("[Collectables] Bulk create completed - created: " + created.length + ", updated: " + updated.length);

        return JSON.stringify({
            success: true,
            created: created,
            updated: updated,
            errors: errors,
            total_collectables: definitions.collectables.length
        });

    } catch (err) {
        logger.error("[Collectables] Bulk create error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// ============================================================================
// FORTUNE WHEEL MODULE â€” Inlined from fortune_wheel/fortune_wheel.js
// Server-authoritative: server picks reward, client only animates
// ============================================================================

var FW_COOLDOWN_DAYS = 3;

var FW_SEGMENTS = [
    { type: "XP",             amount: 100,  label: "100 XP",            weight: 20 },
    { type: "Coins",          amount: 50,   label: "50 Coins",          weight: 25 },
    { type: "XP",             amount: 250,  label: "250 XP",            weight: 15 },
    { type: "AudiobookToken", amount: 1,    label: "Audiobook Token",   weight: 8  },
    { type: "Coins",          amount: 150,  label: "150 Coins",         weight: 12 },
    { type: "Shield",         amount: 24,   label: "24h Shield",        weight: 10 },
    { type: "XP",             amount: 500,  label: "500 XP",            weight: 5  },
    { type: "AudiobookToken", amount: 2,    label: "2 Audiobook Tokens",weight: 5  }
];

function fwGetWheelState(nk, userId) {
    try {
        var objects = nk.storageRead([{
            collection: "fortune_wheel",
            key: "state",
            userId: userId
        }]);
        if (objects && objects.length > 0) {
            return objects[0].value || {};
        }
    } catch(e) { /* first time user */ }
    return {};
}

function fwSaveWheelState(nk, userId, state) {
    try {
        nk.storageWrite([{
            collection: "fortune_wheel",
            key: "state",
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch(e) {
        // Log but don't throw â€” state save failure shouldn't crash the spin
    }
}

function fwCanUserSpin(state) {
    if (!state.nextSpinTime) return true;
    var nextSpin = new Date(state.nextSpinTime);
    return new Date() >= nextSpin;
}

function fwGetWeightedRandomIndex() {
    var totalWeight = 0;
    for (var i = 0; i < FW_SEGMENTS.length; i++) {
        totalWeight += FW_SEGMENTS[i].weight;
    }
    var roll = Math.floor(Math.random() * totalWeight);
    var cumulative = 0;
    for (var j = 0; j < FW_SEGMENTS.length; j++) {
        cumulative += FW_SEGMENTS[j].weight;
        if (roll < cumulative) return j;
    }
    return FW_SEGMENTS.length - 1;
}

function fwGrantReward(nk, userId, rewardType, amount, logger) {
    switch (rewardType) {
        case "XP":
            var xpChangeset = {};
            xpChangeset["xp"] = +amount;
            try { nk.walletUpdate(userId, xpChangeset, {}, true); }
            catch(e) { logger.warn("[FortuneWheel] XP grant failed: " + e.message); }
            break;
        case "Coins":
            var coinChangeset = {};
            coinChangeset["coins"] = +amount;
            try { nk.walletUpdate(userId, coinChangeset, {}, true); }
            catch(e) { logger.warn("[FortuneWheel] Coin grant failed: " + e.message); }
            break;
        case "AudiobookToken":
            try {
                var tokenObj = nk.storageRead([{
                    collection: "audiobook",
                    key: "tokens",
                    userId: userId
                }]);
                var tokens = (tokenObj && tokenObj.length > 0) ? (tokenObj[0].value.count || 0) : 0;
                tokens += amount;
                nk.storageWrite([{
                    collection: "audiobook",
                    key: "tokens",
                    userId: userId,
                    value: { count: tokens, lastGranted: new Date().toISOString() },
                    permissionRead: 1,
                    permissionWrite: 0
                }]);
            } catch(e) { logger.warn("[FortuneWheel] Audiobook token grant failed: " + e.message); }
            break;
        case "Shield":
            try {
                nk.storageWrite([{
                    collection: "streak_shield",
                    key: "pending_grant",
                    userId: userId,
                    value: { hours: amount, source: "fortune_wheel", timestamp: new Date().toISOString() },
                    permissionRead: 1,
                    permissionWrite: 0
                }]);
            } catch(e) { logger.warn("[FortuneWheel] Shield grant failed: " + e.message); }
            break;
        case "Gems":
            var gemsChangeset = {};
            gemsChangeset["gems"] = +amount;
            try { nk.walletUpdate(userId, gemsChangeset, {}, true); }
            catch(e) { logger.warn("[FortuneWheel] Gems grant failed: " + e.message); }
            break;
        default:
            logger.warn("[FortuneWheel] Unknown reward type: " + rewardType);
    }
}

var fortuneWheelGetState = function(ctx, logger, nk, payload) {
    try {
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "Not authenticated" });
        }
        var state = fwGetWheelState(nk, userId);
        var canSpin = fwCanUserSpin(state);
        return JSON.stringify({
            success: true,
            canSpin: canSpin,
            nextSpinTime: state.nextSpinTime || null,
            totalSpins: state.totalSpins || 0,
            lastReward: state.lastReward || null,
            cooldownDays: FW_COOLDOWN_DAYS,
            segments: FW_SEGMENTS.map(function(s) {
                return { type: s.type, amount: s.amount, label: s.label };
            })
        });
    } catch (e) {
        logger.error("[FortuneWheel] fortune_wheel_get_state error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
};

var fortuneWheelSpin = function(ctx, logger, nk, payload) {
    try {
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "Not authenticated" });
        }
        var state = fwGetWheelState(nk, userId);
        if (!fwCanUserSpin(state)) {
            return JSON.stringify({
                success: false,
                error: "On cooldown",
                nextSpinTime: state.nextSpinTime,
                canSpin: false
            });
        }
        var segmentIndex = fwGetWeightedRandomIndex();
        var reward = FW_SEGMENTS[segmentIndex];
        fwGrantReward(nk, userId, reward.type, reward.amount, logger);
        var now = new Date();
        var nextSpin = new Date(now.getTime() + FW_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
        state.nextSpinTime = nextSpin.toISOString();
        state.totalSpins = (state.totalSpins || 0) + 1;
        state.lastReward = {
            type: reward.type,
            amount: reward.amount,
            label: reward.label,
            segmentIndex: segmentIndex,
            timestamp: now.toISOString()
        };
        state.history = state.history || [];
        state.history.push(state.lastReward);
        if (state.history.length > 120) state.history = state.history.slice(-120);
        fwSaveWheelState(nk, userId, state);
        logger.info("[FortuneWheel] " + userId + " won segment " + segmentIndex + " â†’ " + reward.label);
        return JSON.stringify({
            success: true,
            segmentIndex: segmentIndex,
            reward: {
                type: reward.type,
                amount: reward.amount,
                label: reward.label
            },
            nextSpinTime: state.nextSpinTime,
            totalSpins: state.totalSpins
        });
    } catch (e) {
        logger.error("[FortuneWheel] fortune_wheel_spin error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
};

function InitModule(ctx, logger, nk, initializer) {
    logger.info('========================================');
    logger.info('Legacy JavaScript Runtime Initialization');
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

    // Register Game Registry RPCs
    try {
        logger.info('[GameRegistry] Initializing Game Registry Module...');
        initializer.registerRpc('get_game_registry', rpcGetGameRegistry);
        logger.info('[GameRegistry] Registered RPC: get_game_registry');
        initializer.registerRpc('get_game_by_id', rpcGetGameById);
        logger.info('[GameRegistry] Registered RPC: get_game_by_id');
        initializer.registerRpc('sync_game_registry', rpcSyncGameRegistry);
        logger.info('[GameRegistry] Registered RPC: sync_game_registry');
        logger.info('[GameRegistry] Successfully registered 3 Game Registry RPCs');
    } catch (err) {
        logger.error('[GameRegistry] Failed to initialize game registry: ' + err.message);
    }

    // Schedule daily game registry sync (runs at 2 AM UTC daily)
    try {
        logger.info('[GameRegistry] Scheduling daily sync job...');
        initializer.registerMatch('', {
            matchInit: function () { },
            matchJoinAttempt: function () { return { state: {}, accept: false }; },
            matchJoin: function () { },
            matchLeave: function () { },
            matchLoop: function () { },
            matchTerminate: function () { }
        });
        // Register daily cron job for game registry sync
        // Runs daily at 2 AM UTC: "0 2 * * *"
        var cronExpr = "0 2 * * *";
        initializer.registerMatchmakerOverride(function () { });
        logger.info('[GameRegistry] Note: To enable daily sync, configure cron in server config');
        logger.info('[GameRegistry] Cron expression for daily 2 AM UTC: ' + cronExpr);
        logger.info('[GameRegistry] Call sync_game_registry RPC manually or on deployment');
    } catch (err) {
        logger.error('[GameRegistry] Failed to setup scheduled sync: ' + err.message);
    }

    // Trigger initial sync on startup
    try {
        logger.info('[GameRegistry] Triggering initial sync on startup...');
        var syncResult = rpcSyncGameRegistry({}, logger, nk, "{}");
        var parsed = JSON.parse(syncResult);
        if (parsed.success) {
            logger.info('[GameRegistry] Startup sync completed: ' + parsed.gamesSync + ' games synced');
        } else {
            logger.warn('[GameRegistry] Startup sync failed: ' + parsed.error);
        }
    } catch (err) {
        logger.warn('[GameRegistry] Startup sync error: ' + err.message);
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

    // Register Quiz Results RPCs
    try {
        logger.info('[QuizResults] Initializing Quiz Results Module...');
        initializer.registerRpc('quiz_submit_result', rpcQuizSubmitResult);
        logger.info('[QuizResults] Registered RPC: quiz_submit_result');
        initializer.registerRpc('quiz_get_history', rpcQuizGetHistory);
        logger.info('[QuizResults] Registered RPC: quiz_get_history');
        initializer.registerRpc('quiz_get_stats', rpcQuizGetStats);
        logger.info('[QuizResults] Registered RPC: quiz_get_stats');
        initializer.registerRpc('quiz_check_daily_completion', rpcQuizCheckDailyCompletion);
        logger.info('[QuizResults] Registered RPC: quiz_check_daily_completion');
        logger.info('[QuizResults] Successfully registered 4 Quiz Results RPCs');
    } catch (err) {
        logger.error('[QuizResults] Failed to initialize: ' + err.message);
    }

    // Register Game Entry Cost RPCs
    try {
        logger.info('[GameEntry] Initializing Game Entry Cost Module...');
        initializer.registerRpc('game_entry_validate', rpcGameEntryValidate);
        logger.info('[GameEntry] Registered RPC: game_entry_validate');
        initializer.registerRpc('game_entry_complete', rpcGameEntryComplete);
        logger.info('[GameEntry] Registered RPC: game_entry_complete');
        initializer.registerRpc('game_entry_get_status', rpcGameEntryGetStatus);
        logger.info('[GameEntry] Registered RPC: game_entry_get_status');
        logger.info('[GameEntry] Successfully registered 3 Game Entry Cost RPCs');
    } catch (err) {
        logger.error('[GameEntry] Failed to initialize: ' + err.message);
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

        // NEW:
        initializer.registerRpc('wallet_get_balances', rpcWalletGetBalances);
        logger.info('[Wallet] Registered RPC: wallet_get_balances');

        logger.info('[Wallet] Successfully registered 5 Enhanced Wallet RPCs');
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
        initializer.registerRpc('check_geo_and_update_profile', rpcCheckGeoAndUpdateProfile);
        logger.info('[PlayerRPCs] Registered RPC: check_geo_and_update_profile');

        // Player Metadata & Portfolio RPCs

        initializer.registerRpc('get_player_portfolio', rpcGetPlayerPortfolio);
        logger.info('[PlayerRPCs] Registered RPC: get_player_portfolio');
        //  initializer.registerRpc('rpc_update_player_metadata', rpcUpdatePlayerMetadata);
        // logger.info('[PlayerRPCs] Registered RPC: rpc_update_player_metadata');


        initializer.registerRpc('rpc_update_player_metadata', rpcUpdatePlayerMetadataUnified);
        logger.info('[PlayerRPCs] âœ“ Registered: rpc_update_player_metadata (unified)');

        initializer.registerRpc('rpc_change_username', rpcChangeUsername);
        logger.info('[PlayerRPCs] âœ“ Registered: rpc_change_username');

        initializer.registerRpc('get_player_metadata', rpcGetPlayerMetadata);
        logger.info('[PlayerRPCs] âœ“ Registered: get_player_metadata');

        initializer.registerRpc('admin_delete_player_metadata', rpcAdminDeletePlayerMetadata);
        logger.info('[PlayerRPCs] âœ“ Registered: admin_delete_player_metadata');




        // Adaptive Reward System RPCs
        initializer.registerRpc('calculate_score_reward', rpcCalculateScoreReward);
        logger.info('[PlayerRPCs] Registered RPC: calculate_score_reward');
        initializer.registerRpc('update_game_reward_config', rpcUpdateGameRewardConfig);
        logger.info('[PlayerRPCs] Registered RPC: update_game_reward_config (admin)');

        logger.info('[PlayerRPCs] Successfully registered 10 Standard Player RPCs');
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
                    logger.info('[MultiGameRPCs] âœ“ Registered RPC: ' + mgRpc.id);
                    mgRegistered++;
                } catch (err) {
                    logger.error('[MultiGameRPCs] âœ— Failed to register ' + mgRpc.id + ': ' + err.message);
                }
            } else {
                logger.info('[MultiGameRPCs] âŠ˜ Skipped (already registered): ' + mgRpc.id);
                mgSkipped++;
            }
        }

        logger.info('[MultiGameRPCs] Registration complete: ' + mgRegistered + ' registered, ' + mgSkipped + ' skipped');
        logger.info('[MultiGameRPCs] Successfully registered ' + mgRpcs.length + ' Multi-Game RPCs');
    } catch (err) {
        logger.error('[MultiGameRPCs] Failed to initialize: ' + err.message);
    }

    // Register Achievement System RPCs (implementations loaded from achievements/achievements.js)
    var achievementRpcs = [
        { id: 'achievements_get_all', handler: rpcAchievementsGetAll },
        { id: 'achievements_update_progress', handler: rpcAchievementsUpdateProgress },
        { id: 'achievements_create_definition', handler: rpcAchievementsCreateDefinition },
        { id: 'achievements_bulk_create', handler: rpcAchievementsBulkCreate }
    ];
    var achieveCount = 0;
    for (var ai = 0; ai < achievementRpcs.length; ai++) {
        if (typeof achievementRpcs[ai].handler === 'function') {
            try {
                initializer.registerRpc(achievementRpcs[ai].id, achievementRpcs[ai].handler);
                achieveCount++;
            } catch (err) {
                logger.warn('[Achievements] Failed to register ' + achievementRpcs[ai].id + ': ' + err.message);
            }
        } else {
            logger.info('[Achievements] Skipping ' + achievementRpcs[ai].id + ' (handler not loaded)');
        }
    }
    if (achieveCount > 0) logger.info('[Achievements] Registered ' + achieveCount + ' Achievement RPCs');

    // Register Matchmaking System RPCs (implementations loaded from matchmaking/matchmaking.js)
    var matchmakingRpcs = [
        { id: 'matchmaking_find_match', handler: rpcMatchmakingFindMatch },
        { id: 'matchmaking_cancel', handler: rpcMatchmakingCancel },
        { id: 'matchmaking_get_status', handler: rpcMatchmakingGetStatus },
        { id: 'matchmaking_create_party', handler: rpcMatchmakingCreateParty },
        { id: 'matchmaking_join_party', handler: rpcMatchmakingJoinParty }
    ];
    var matchCount = 0;
    for (var mi = 0; mi < matchmakingRpcs.length; mi++) {
        if (typeof matchmakingRpcs[mi].handler === 'function') {
            try {
                initializer.registerRpc(matchmakingRpcs[mi].id, matchmakingRpcs[mi].handler);
                matchCount++;
            } catch (err) {
                logger.warn('[Matchmaking] Failed to register ' + matchmakingRpcs[mi].id + ': ' + err.message);
            }
        } else {
            logger.info('[Matchmaking] Skipping ' + matchmakingRpcs[mi].id + ' (handler not loaded)');
        }
    }
    if (matchCount > 0) logger.info('[Matchmaking] Registered ' + matchCount + ' Matchmaking RPCs');

    // Register Tournament System RPCs (implementations loaded from tournaments/tournaments.js)
    var tournamentRpcs = [
        { id: 'tournament_create', handler: rpcTournamentCreate },
        { id: 'tournament_join', handler: rpcTournamentJoin },
        { id: 'tournament_list_active', handler: rpcTournamentListActive },
        { id: 'tournament_submit_score', handler: rpcTournamentSubmitScore },
        { id: 'tournament_get_leaderboard', handler: rpcTournamentGetLeaderboard },
        { id: 'tournament_claim_rewards', handler: rpcTournamentClaimRewards }
    ];
    var tournamentCount = 0;
    for (var ti = 0; ti < tournamentRpcs.length; ti++) {
        if (typeof tournamentRpcs[ti].handler === 'function') {
            try {
                initializer.registerRpc(tournamentRpcs[ti].id, tournamentRpcs[ti].handler);
                tournamentCount++;
            } catch (err) {
                logger.warn('[Tournament] Failed to register ' + tournamentRpcs[ti].id + ': ' + err.message);
            }
        } else {
            logger.info('[Tournament] Skipping ' + tournamentRpcs[ti].id + ' (handler not loaded)');
        }
    }
    if (tournamentCount > 0) logger.info('[Tournament] Registered ' + tournamentCount + ' Tournament RPCs');

    // Register Infrastructure RPCs (implementations loaded from infrastructure/*.js)
    var infraRpcs = [
        { id: 'batch_execute', handler: rpcBatchExecute },
        { id: 'batch_wallet_operations', handler: rpcBatchWalletOperations },
        { id: 'batch_achievement_progress', handler: rpcBatchAchievementProgress },
        { id: 'rate_limit_status', handler: rpcRateLimitStatus },
        { id: 'cache_stats', handler: rpcCacheStats },
        { id: 'cache_clear', handler: rpcCacheClear }
    ];
    var infraCount = 0;
    for (var ii = 0; ii < infraRpcs.length; ii++) {
        if (typeof infraRpcs[ii].handler === 'function') {
            try {
                initializer.registerRpc(infraRpcs[ii].id, infraRpcs[ii].handler);
                infraCount++;
            } catch (err) {
                logger.warn('[Infrastructure] Failed to register ' + infraRpcs[ii].id + ': ' + err.message);
            }
        } else {
            logger.info('[Infrastructure] Skipping ' + infraRpcs[ii].id + ' (handler not loaded)');
        }
    }
    if (infraCount > 0) logger.info('[Infrastructure] Registered ' + infraCount + ' Infrastructure RPCs');

    // Register QuizVerse Multiplayer-Specific RPCs
    try {
        logger.info('[QuizVerse-MP] Initializing QuizVerse Multiplayer Module...');
        initializer.registerRpc('quizverse_submit_score', rpcQuizVerseSubmitScore);
        logger.info('[QuizVerse-MP] Registered RPC: quizverse_submit_score');
        initializer.registerRpc('quizverse_get_leaderboard', rpcQuizVerseGetLeaderboard);
        logger.info('[QuizVerse-MP] Registered RPC: quizverse_get_leaderboard');
        initializer.registerRpc('quizverse_submit_multiplayer_match', rpcQuizVerseSubmitMultiplayerMatch);
        logger.info('[QuizVerse-MP] Registered RPC: quizverse_submit_multiplayer_match');
        logger.info('[QuizVerse-MP] Successfully registered 3 QuizVerse Multiplayer RPCs');
    } catch (err) {
        logger.error('[QuizVerse-MP] Failed to initialize: ' + err.message);
    }

    // Register Guest User Metadata Cleanup RPC
    try {
        logger.info('[GuestCleanup] Initializing Guest User Metadata Cleanup Module...');
        initializer.registerRpc('cleanup_guest_user_metadata', rpcCleanupGuestUserMetadata);
        logger.info('[GuestCleanup] Registered RPC: cleanup_guest_user_metadata');
        logger.info('[GuestCleanup] Note: To enable daily cleanup, configure cron in server config');
        logger.info('[GuestCleanup] Cron expression for daily 3 AM UTC: "0 3 * * *"');
        logger.info('[GuestCleanup] Call cleanup_guest_user_metadata RPC manually or on schedule');
        logger.info('[GuestCleanup] Successfully registered 1 Guest Cleanup RPC');
    } catch (err) {
        logger.error('[GuestCleanup] Failed to initialize: ' + err.message);
    }

    // Register Onboarding System RPCs
    try {
        logger.info('[Onboarding] Initializing Onboarding Module...');
        initializer.registerRpc('onboarding_get_state', rpcOnboardingGetState);
        logger.info('[Onboarding] Registered RPC: onboarding_get_state');
        initializer.registerRpc('onboarding_update_state', rpcOnboardingUpdateState);
        logger.info('[Onboarding] Registered RPC: onboarding_update_state');
        initializer.registerRpc('onboarding_complete_step', rpcOnboardingCompleteStep);
        logger.info('[Onboarding] Registered RPC: onboarding_complete_step');
        initializer.registerRpc('onboarding_set_interests', rpcOnboardingSetInterests);
        logger.info('[Onboarding] Registered RPC: onboarding_set_interests');
        initializer.registerRpc('onboarding_get_interests', rpcOnboardingGetInterests);
        logger.info('[Onboarding] Registered RPC: onboarding_get_interests');
        initializer.registerRpc('onboarding_claim_welcome_bonus', rpcOnboardingClaimWelcomeBonus);
        logger.info('[Onboarding] Registered RPC: onboarding_claim_welcome_bonus');
        initializer.registerRpc('onboarding_first_quiz_complete', rpcOnboardingFirstQuizComplete);
        logger.info('[Onboarding] Registered RPC: onboarding_first_quiz_complete');
        initializer.registerRpc('onboarding_get_tomorrow_preview', rpcOnboardingGetTomorrowPreview);
        logger.info('[Onboarding] Registered RPC: onboarding_get_tomorrow_preview');
        initializer.registerRpc('onboarding_track_session', rpcOnboardingTrackSession);
        logger.info('[Onboarding] Registered RPC: onboarding_track_session');
        initializer.registerRpc('onboarding_get_retention_data', rpcOnboardingGetRetentionData);
        logger.info('[Onboarding] Registered RPC: onboarding_get_retention_data');
        initializer.registerRpc('onboarding_create_link_quiz', rpcOnboardingCreateLinkQuiz);
        logger.info('[Onboarding] Registered RPC: onboarding_create_link_quiz');
        logger.info('[Onboarding] Successfully registered 11 Onboarding RPCs');
    } catch (err) {
        logger.error('[Onboarding] Failed to initialize: ' + err.message);
    }

    // Register Retention System RPCs (75% D1 Retention)
    try {
        logger.info('[Retention] Initializing Retention Module...');
        initializer.registerRpc('retention_grant_streak_shield', rpcRetentionGrantStreakShield);
        logger.info('[Retention] Registered RPC: retention_grant_streak_shield');
        initializer.registerRpc('retention_get_streak_shield', rpcRetentionGetStreakShield);
        logger.info('[Retention] Registered RPC: retention_get_streak_shield');
        initializer.registerRpc('retention_use_streak_shield', rpcRetentionUseStreakShield);
        logger.info('[Retention] Registered RPC: retention_use_streak_shield');
        initializer.registerRpc('retention_schedule_notification', rpcRetentionScheduleNotification);
        logger.info('[Retention] Registered RPC: retention_schedule_notification');
        initializer.registerRpc('retention_get_recommendations', rpcRetentionGetRecommendations);
        logger.info('[Retention] Registered RPC: retention_get_recommendations');
        initializer.registerRpc('retention_track_first_session', rpcRetentionTrackFirstSession);
        logger.info('[Retention] Registered RPC: retention_track_first_session');
        initializer.registerRpc('retention_claim_welcome_bonus', rpcRetentionClaimWelcomeBonus);
        logger.info('[Retention] Registered RPC: retention_claim_welcome_bonus');
        logger.info('[Retention] Successfully registered 7 Retention RPCs');
    } catch (err) {
        logger.error('[Retention] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // D7/D30 RETENTION SYSTEMS - Weekly Goals, Season Pass, Milestones, Collections
    // ============================================================================

    // Register Weekly Goals System RPCs (D7 Retention)
    try {
        logger.info('[WeeklyGoals] Initializing Weekly Goals Module...');
        initializer.registerRpc('weekly_goals_get_status', rpcWeeklyGoalsGetStatus);
        logger.info('[WeeklyGoals] Registered RPC: weekly_goals_get_status');
        initializer.registerRpc('weekly_goals_update_progress', rpcWeeklyGoalsUpdateProgress);
        logger.info('[WeeklyGoals] Registered RPC: weekly_goals_update_progress');
        initializer.registerRpc('weekly_goals_claim_reward', rpcWeeklyGoalsClaimReward);
        logger.info('[WeeklyGoals] Registered RPC: weekly_goals_claim_reward');
        initializer.registerRpc('weekly_goals_claim_bonus', rpcWeeklyGoalsClaimBonus);
        logger.info('[WeeklyGoals] Registered RPC: weekly_goals_claim_bonus');
        logger.info('[WeeklyGoals] Successfully registered 4 Weekly Goals RPCs');
    } catch (err) {
        logger.error('[WeeklyGoals] Failed to initialize: ' + err.message);
    }

    // Register Season Pass System RPCs (D7/D30 Retention)
    try {
        logger.info('[SeasonPass] Initializing Season Pass Module...');
        initializer.registerRpc('season_pass_get_status', rpcSeasonPassGetStatus);
        logger.info('[SeasonPass] Registered RPC: season_pass_get_status');
        initializer.registerRpc('season_pass_add_xp', rpcSeasonPassAddXP);
        logger.info('[SeasonPass] Registered RPC: season_pass_add_xp');
        initializer.registerRpc('season_pass_complete_quest', rpcSeasonPassCompleteQuest);
        logger.info('[SeasonPass] Registered RPC: season_pass_complete_quest');
        initializer.registerRpc('season_pass_claim_reward', rpcSeasonPassClaimReward);
        logger.info('[SeasonPass] Registered RPC: season_pass_claim_reward');
        initializer.registerRpc('season_pass_purchase_premium', rpcSeasonPassPurchasePremium);
        logger.info('[SeasonPass] Registered RPC: season_pass_purchase_premium');
        logger.info('[SeasonPass] Successfully registered 5 Season Pass RPCs');
    } catch (err) {
        logger.error('[SeasonPass] Failed to initialize: ' + err.message);
    }

    // Register Monthly Milestones System RPCs (D30 Retention)
    try {
        logger.info('[MonthlyMilestones] Initializing Monthly Milestones Module...');
        initializer.registerRpc('monthly_milestones_get_status', rpcMonthlyMilestonesGetStatus);
        logger.info('[MonthlyMilestones] Registered RPC: monthly_milestones_get_status');
        initializer.registerRpc('monthly_milestones_update_progress', rpcMonthlyMilestonesUpdateProgress);
        logger.info('[MonthlyMilestones] Registered RPC: monthly_milestones_update_progress');
        initializer.registerRpc('monthly_milestones_claim_reward', rpcMonthlyMilestonesClaimReward);
        logger.info('[MonthlyMilestones] Registered RPC: monthly_milestones_claim_reward');
        initializer.registerRpc('monthly_milestones_claim_legendary', rpcMonthlyMilestonesClaimLegendary);
        logger.info('[MonthlyMilestones] Registered RPC: monthly_milestones_claim_legendary');
        logger.info('[MonthlyMilestones] Successfully registered 4 Monthly Milestones RPCs');
    } catch (err) {
        logger.error('[MonthlyMilestones] Failed to initialize: ' + err.message);
    }

    // Register Collections & Prestige System RPCs (D30 Retention)
    try {
        logger.info('[Collections] Initializing Collections & Prestige Module...');
        initializer.registerRpc('collections_get_status', rpcCollectionsGetStatus);
        logger.info('[Collections] Registered RPC: collections_get_status');
        initializer.registerRpc('collections_unlock_item', rpcCollectionsUnlockItem);
        logger.info('[Collections] Registered RPC: collections_unlock_item');
        initializer.registerRpc('collections_equip_item', rpcCollectionsEquipItem);
        logger.info('[Collections] Registered RPC: collections_equip_item');
        initializer.registerRpc('collections_add_mastery_xp', rpcCollectionsAddMasteryXP);
        logger.info('[Collections] Registered RPC: collections_add_mastery_xp');
        logger.info('[Collections] Successfully registered 4 Collections RPCs');
    } catch (err) {
        logger.error('[Collections] Failed to initialize: ' + err.message);
    }

    // Register Win-back System RPCs (D30 Retention - Re-engagement)
    try {
        logger.info('[Winback] Initializing Win-back Module...');
        initializer.registerRpc('winback_check_status', rpcWinbackCheckStatus);
        logger.info('[Winback] Registered RPC: winback_check_status');
        initializer.registerRpc('winback_claim_rewards', rpcWinbackClaimRewards);
        logger.info('[Winback] Registered RPC: winback_claim_rewards');
        initializer.registerRpc('winback_record_session', rpcWinbackRecordSession);
        logger.info('[Winback] Registered RPC: winback_record_session');
        initializer.registerRpc('winback_schedule_reengagement', rpcWinbackScheduleReengagement);
        logger.info('[Winback] Registered RPC: winback_schedule_reengagement');
        logger.info('[Winback] Successfully registered 4 Win-back RPCs');
    } catch (err) {
        logger.error('[Winback] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // NEW PROGRESSION SYSTEMS (D7/D30 Retention)
    // ============================================================================

    // Register Progressive Unlocks System RPCs (D7 Retention)
    try {
        logger.info('[ProgressiveUnlocks] Initializing Progressive Unlocks Module...');
        initializer.registerRpc('progressive_get_state', rpcGetUnlockState);
        logger.info('[ProgressiveUnlocks] Registered RPC: progressive_get_state');
        initializer.registerRpc('progressive_claim_unlock', rpcClaimUnlock);
        logger.info('[ProgressiveUnlocks] Registered RPC: progressive_claim_unlock');
        initializer.registerRpc('progressive_check_feature', rpcCheckFeatureUnlocked);
        logger.info('[ProgressiveUnlocks] Registered RPC: progressive_check_feature');
        initializer.registerRpc('progressive_update_progress', rpcUpdateProgressProgressive);
        logger.info('[ProgressiveUnlocks] Registered RPC: progressive_update_progress');
        logger.info('[ProgressiveUnlocks] Successfully registered 4 Progressive Unlock RPCs');
    } catch (err) {
        logger.error('[ProgressiveUnlocks] Failed to initialize: ' + err.message);
    }

    // Register Progression & Mastery System RPCs (D30 Retention)
    try {
        logger.info('[ProgressionMastery] Initializing Progression & Mastery Module...');
        initializer.registerRpc('progression_add_mastery_xp', rpcProgressionAddMasteryXp);
        logger.info('[ProgressionMastery] Registered RPC: progression_add_mastery_xp');
        initializer.registerRpc('progression_get_state', rpcProgressionGetState);
        logger.info('[ProgressionMastery] Registered RPC: progression_get_state');
        initializer.registerRpc('progression_claim_prestige', rpcProgressionClaimPrestige);
        logger.info('[ProgressionMastery] Registered RPC: progression_claim_prestige');
        logger.info('[ProgressionMastery] Successfully registered 3 Progression RPCs');
    } catch (err) {
        logger.error('[ProgressionMastery] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // REWARDED ADS SYSTEM - Server-Validated Ad Rewards (Prevents Auto-Show Exploits)
    // ============================================================================

    // Register Rewarded Ads System RPCs
    try {
        logger.info('[RewardedAds] Initializing Rewarded Ads System Module...');
        initializer.registerRpc('rewarded_ad_request_token', rpcRewardedAdRequestToken);
        logger.info('[RewardedAds] Registered RPC: rewarded_ad_request_token');
        initializer.registerRpc('rewarded_ad_claim', rpcRewardedAdClaim);
        logger.info('[RewardedAds] Registered RPC: rewarded_ad_claim');
        initializer.registerRpc('rewarded_ad_validate_score_multiplier', rpcValidateScoreMultiplier);
        logger.info('[RewardedAds] Registered RPC: rewarded_ad_validate_score_multiplier');
        initializer.registerRpc('rewarded_ad_get_status', rpcGetRewardedAdStatus);
        logger.info('[RewardedAds] Registered RPC: rewarded_ad_get_status');
        logger.info('[RewardedAds] Successfully registered 4 Rewarded Ads RPCs');
    } catch (err) {
        logger.error('[RewardedAds] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // COMPATIBILITY QUIZ SYSTEM - Valentine's Day Feature (QuizVerse)
    // ============================================================================

    // Register Compatibility Quiz RPCs
    try {
        logger.info('[CompatibilityQuiz] Initializing Compatibility Quiz Module...');
        initializer.registerRpc('compatibility_create_session', rpcCompatibilityCreateSession);
        logger.info('[CompatibilityQuiz] Registered RPC: compatibility_create_session');
        initializer.registerRpc('compatibility_join_session', rpcCompatibilityJoinSession);
        logger.info('[CompatibilityQuiz] Registered RPC: compatibility_join_session');
        initializer.registerRpc('compatibility_get_session', rpcCompatibilityGetSession);
        logger.info('[CompatibilityQuiz] Registered RPC: compatibility_get_session');
        initializer.registerRpc('compatibility_submit_answers', rpcCompatibilitySubmitAnswers);
        logger.info('[CompatibilityQuiz] Registered RPC: compatibility_submit_answers');
        initializer.registerRpc('compatibility_calculate', rpcCompatibilityCalculate);
        logger.info('[CompatibilityQuiz] Registered RPC: compatibility_calculate');
        initializer.registerRpc('compatibility_list_sessions', rpcCompatibilityListSessions);
        logger.info('[CompatibilityQuiz] Registered RPC: compatibility_list_sessions');
        logger.info('[CompatibilityQuiz] Successfully registered 6 Compatibility Quiz RPCs');
    } catch (err) {
        logger.error('[CompatibilityQuiz] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // ASYNC CHALLENGE SYSTEM - Universal Asynchronous Multiplayer (QuizVerse)
    // ============================================================================

    // Register Async Challenge RPCs
    try {
        logger.info('[AsyncChallenge] Initializing Async Challenge Module...');
        initializer.registerRpc('async_challenge_create', rpcAsyncChallengeCreate);
        logger.info('[AsyncChallenge] Registered RPC: async_challenge_create');
        initializer.registerRpc('async_challenge_join', rpcAsyncChallengeJoin);
        logger.info('[AsyncChallenge] Registered RPC: async_challenge_join');
        initializer.registerRpc('async_challenge_get', rpcAsyncChallengeGet);
        logger.info('[AsyncChallenge] Registered RPC: async_challenge_get');
        initializer.registerRpc('async_challenge_submit', rpcAsyncChallengeSubmit);
        logger.info('[AsyncChallenge] Registered RPC: async_challenge_submit');
        initializer.registerRpc('async_challenge_list', rpcAsyncChallengeList);
        logger.info('[AsyncChallenge] Registered RPC: async_challenge_list');
        initializer.registerRpc('async_challenge_cancel', rpcAsyncChallengeCancel);
        logger.info('[AsyncChallenge] Registered RPC: async_challenge_cancel');
        initializer.registerRpc('async_challenge_stats', rpcAsyncChallengeStats);
        logger.info('[AsyncChallenge] Registered RPC: async_challenge_stats');
        initializer.registerRpc('async_challenge_rematch', rpcAsyncChallengeRematch);
        logger.info('[AsyncChallenge] Registered RPC: async_challenge_rematch');
        initializer.registerRpc('async_challenge_leaderboard', rpcAsyncChallengeLeaderboard);
        logger.info('[AsyncChallenge] Registered RPC: async_challenge_leaderboard');
        logger.info('[AsyncChallenge] Successfully registered 9 Async Challenge RPCs');
    } catch (err) {
        logger.error('[AsyncChallenge] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // BADGES & COLLECTABLES SYSTEM - Per-Game Achievements & Items
    // ============================================================================

    // Register Badges System RPCs
    try {
        logger.info('[Badges] Initializing Badges & Collectables Module...');
        initializer.registerRpc('badges_get_all', rpcBadgesGetAll);
        logger.info('[Badges] Registered RPC: badges_get_all');
        initializer.registerRpc('badges_update_progress', rpcBadgesUpdateProgress);
        logger.info('[Badges] Registered RPC: badges_update_progress');
        initializer.registerRpc('badges_check_event', rpcBadgesCheckEvent);
        logger.info('[Badges] Registered RPC: badges_check_event');
        initializer.registerRpc('badges_set_displayed', rpcBadgesSetDisplayed);
        logger.info('[Badges] Registered RPC: badges_set_displayed');
        initializer.registerRpc('badges_bulk_create', rpcBadgesBulkCreate);
        logger.info('[Badges] Registered RPC: badges_bulk_create (admin)');
        logger.info('[Badges] Successfully registered 5 Badge RPCs');
    } catch (err) {
        logger.error('[Badges] Failed to initialize: ' + err.message);
    }

    // Register Collectables System RPCs
    try {
        logger.info('[Collectables] Initializing Collectables Module...');
        initializer.registerRpc('collectables_get_all', rpcCollectablesGetAll);
        logger.info('[Collectables] Registered RPC: collectables_get_all');
        initializer.registerRpc('collectables_grant', rpcCollectablesGrant);
        logger.info('[Collectables] Registered RPC: collectables_grant');
        initializer.registerRpc('collectables_equip', rpcCollectablesEquip);
        logger.info('[Collectables] Registered RPC: collectables_equip');
        initializer.registerRpc('collectables_bulk_create', rpcCollectablesBulkCreate);
        logger.info('[Collectables] Registered RPC: collectables_bulk_create (admin)');
        logger.info('[Collectables] Successfully registered 4 Collectable RPCs');
    } catch (err) {
        logger.error('[Collectables] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // v3.0 NEW RPCs â€” League System (4 RPCs)
    // ============================================================================
    try {
        logger.info('[Leagues] Initializing League System Module...');
        initializer.registerRpc('league_get_state', rpcLeagueGetState);
        logger.info('[Leagues] Registered RPC: league_get_state');
        initializer.registerRpc('league_submit_points', rpcLeagueSubmitPoints);
        logger.info('[Leagues] Registered RPC: league_submit_points');
        initializer.registerRpc('league_process_season', rpcLeagueProcessSeason);
        logger.info('[Leagues] Registered RPC: league_process_season');
        initializer.registerRpc('league_get_leaderboard', rpcLeagueGetLeaderboard);
        logger.info('[Leagues] Registered RPC: league_get_leaderboard');
        logger.info('[Leagues] Successfully registered 4 League RPCs');
    } catch (err) {
        logger.error('[Leagues] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // v3.0 NEW RPCs â€” Streak Repair & Wager (2 RPCs)
    // ============================================================================
    try {
        logger.info('[StreakV2] Initializing Streak Repair & Wager Module...');
        initializer.registerRpc('streak_repair', rpcStreakRepair);
        logger.info('[StreakV2] Registered RPC: streak_repair');
        initializer.registerRpc('streak_wager', rpcStreakWager);
        logger.info('[StreakV2] Registered RPC: streak_wager');
        logger.info('[StreakV2] Successfully registered 2 Streak V2 RPCs');
    } catch (err) {
        logger.error('[StreakV2] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // v3.0 NEW RPCs â€” Character System (3 RPCs)
    // ============================================================================

    // ── Character System Inline Handlers ──────────────────────────────
    // NOTE: characters/characters.js defines these but Nakama JS runtime
    // loads each .js file in its own scope — subdirectory modules don't
    // merge into index.js context. Inlined here so registration succeeds.

    var CHAR_DEFS_INLINE = {
        quizzy: { id:'quizzy', name:'Quizzy', rarity:'common', xpBonus:0, unlockCondition:'default', introVideoPath:'Characters/Quizzy/intro.mp4', xpRewardOnUnlock:0 },
        autocurio: { id:'autocurio', name:'AUTOcurio', rarity:'common', xpBonus:0, unlockCondition:'default', introVideoPath:'Characters/AUTOcurio/intro.mp4', xpRewardOnUnlock:0 },
        atlas: { id:'atlas', name:'Atlas', rarity:'rare', xpBonus:5, unlockCondition:'badge_explorer_tier3', introVideoPath:'Characters/Atlas/intro.mp4', xpRewardOnUnlock:100 },
        nova: { id:'nova', name:'Nova', rarity:'rare', xpBonus:5, unlockCondition:'badge_science_tier3', introVideoPath:'Characters/Nova/intro.mp4', xpRewardOnUnlock:100 },
        dog: { id:'dog', name:'Dog', rarity:'rare', xpBonus:5, unlockCondition:'install_donut_disturb', introVideoPath:'Characters/Dog/intro.mp4', xpRewardOnUnlock:100 },
        sparky: { id:'sparky', name:'Sparky', rarity:'rare', xpBonus:5, unlockCondition:'badge_speed_demon_gold', introVideoPath:'Characters/Sparky/intro.mp4', xpRewardOnUnlock:100 },
        echo: { id:'echo', name:'Echo', rarity:'rare', xpBonus:5, unlockCondition:'audio_review_10', introVideoPath:'Characters/Echo/intro.mp4', xpRewardOnUnlock:100 },
        professor: { id:'professor', name:'Professor', rarity:'rare', xpBonus:5, unlockCondition:'smart_review_10', introVideoPath:'Characters/Professor/intro.mp4', xpRewardOnUnlock:100 },
        pixel: { id:'pixel', name:'Pixel', rarity:'rare', xpBonus:5, unlockCondition:'badge_social_butterfly_day14', introVideoPath:'Characters/Pixel/intro.mp4', xpRewardOnUnlock:100 },
        chronos: { id:'chronos', name:'Chronos', rarity:'epic', xpBonus:10, unlockCondition:'streak_30', introVideoPath:'Characters/Chronos/intro.mp4', xpRewardOnUnlock:250 },
        phoenix: { id:'phoenix', name:'Phoenix', rarity:'epic', xpBonus:10, unlockCondition:'league_gold', introVideoPath:'Characters/Phoenix/intro.mp4', xpRewardOnUnlock:250 },
        bear: { id:'bear', name:'Bear', rarity:'epic', xpBonus:10, unlockCondition:'donut_disturb_level_25', introVideoPath:'Characters/Bear/intro.mp4', xpRewardOnUnlock:250 },
        duck: { id:'duck', name:'Duck', rarity:'epic', xpBonus:10, unlockCondition:'donut_disturb_level_10', introVideoPath:'Characters/Duck/intro.mp4', xpRewardOnUnlock:250 },
        luna: { id:'luna', name:'Luna', rarity:'epic', xpBonus:10, unlockCondition:'badge_night_owl', introVideoPath:'Characters/Luna/intro.mp4', xpRewardOnUnlock:250 },
        sage: { id:'sage', name:'Sage', rarity:'legendary', xpBonus:15, unlockCondition:'league_diamond', introVideoPath:'Characters/Sage/intro.mp4', xpRewardOnUnlock:500 },
        ix: { id:'ix', name:'IX', rarity:'legendary', xpBonus:15, unlockCondition:'ecosystem_points_2500', introVideoPath:'Characters/IX/intro.mp4', xpRewardOnUnlock:500 }
    };

    var CHAR_STORE_COL = 'player_data';
    function _charKey(uid, gid) { return 'characters_' + uid + '_' + gid; }
    function _charRead(nk, lg, uid, gid) {
        try {
            var r = nk.storageRead([{ collection: CHAR_STORE_COL, key: _charKey(uid,gid), userId: uid }]);
            if (r && r.length > 0 && r[0].value) return r[0].value;
        } catch(e) { lg.warn('[Characters] read fail: ' + e.message); }
        return null;
    }
    function _charWrite(nk, lg, uid, gid, data) {
        try {
            nk.storageWrite([{ collection: CHAR_STORE_COL, key: _charKey(uid,gid), userId: uid, value: data, permissionRead:1, permissionWrite:0 }]);
            return true;
        } catch(e) { lg.error('[Characters] write fail: ' + e.message); return false; }
    }
    function _charInit(uid) {
        var now = new Date().toISOString();
        return { activeCharacter:'quizzy', unlockedCharacters:{ quizzy:{ unlockedAt:now } }, totalXpFromUnlocks:0, createdAt:now, updatedAt:now };
    }
    function _charErr(msg) { return JSON.stringify({ success:false, error:msg }); }
    function _charParse(p) { if (!p || p==='') return {}; try { return JSON.parse(p); } catch(e) { return null; } }

    var rpcCharacterGetState = function(ctx, logger, nk, payload) {
        if (!ctx.userId) return _charErr('User not authenticated');
        var data = _charParse(payload); if (data===null) return _charErr('Invalid JSON payload');
        var gameId = data.gameId || 'quizverse';
        var cd = _charRead(nk, logger, ctx.userId, gameId);
        if (!cd) { cd = _charInit(ctx.userId); _charWrite(nk, logger, ctx.userId, gameId, cd); }
        var chars = [];
        for (var cid in CHAR_DEFS_INLINE) {
            var def = CHAR_DEFS_INLINE[cid]; var isU = cd.unlockedCharacters && cd.unlockedCharacters[cid];
            chars.push({ id:def.id, name:def.name, rarity:def.rarity, xpBonus:def.xpBonus, unlocked:!!isU,
                unlockedAt: isU ? cd.unlockedCharacters[cid].unlockedAt : null,
                unlockCondition: isU ? null : def.unlockCondition, introVideoPath:def.introVideoPath });
        }
        return JSON.stringify({ success:true, userId:ctx.userId, gameId:gameId, activeCharacter:cd.activeCharacter,
            characters:chars, totalUnlocked:Object.keys(cd.unlockedCharacters||{}).length,
            totalCharacters:Object.keys(CHAR_DEFS_INLINE).length, totalXpFromUnlocks:cd.totalXpFromUnlocks||0,
            timestamp:new Date().toISOString() });
    };

    var rpcCharacterUnlock = function(ctx, logger, nk, payload) {
        if (!ctx.userId) return _charErr('User not authenticated');
        var data = _charParse(payload); if (data===null) return _charErr('Invalid JSON');
        var gameId = data.gameId||'quizverse'; var characterId = data.characterId;
        if (!characterId) return _charErr('Missing: characterId');
        var def = CHAR_DEFS_INLINE[characterId]; if (!def) return _charErr('Not found: '+characterId);
        var cd = _charRead(nk, logger, ctx.userId, gameId);
        if (!cd) cd = _charInit(ctx.userId);
        if (cd.unlockedCharacters && cd.unlockedCharacters[characterId])
            return JSON.stringify({ success:false, error:'already_unlocked', characterId:characterId });
        var now = new Date().toISOString(); var xp = def.xpRewardOnUnlock||0;
        if (!cd.unlockedCharacters) cd.unlockedCharacters = {};
        cd.unlockedCharacters[characterId] = { unlockedAt:now };
        cd.totalXpFromUnlocks = (cd.totalXpFromUnlocks||0) + xp; cd.updatedAt = now;
        if (xp > 0) { try {
            var acct = nk.accountGetId(ctx.userId); if (acct) {
                var meta = {}; try { meta = JSON.parse(acct.user.metadata||'{}'); } catch(e) { meta={}; }
                meta.totalXp = (meta.totalXp||0)+xp; meta.lastXpSource = 'character_unlock_'+characterId; meta.lastXpAt = now;
                nk.accountUpdateId(ctx.userId, null,null,null,null,null,null,null, JSON.stringify(meta));
            }
        } catch(xe) { logger.warn('[Characters] XP update fail: '+xe.message); } }
        if (!_charWrite(nk, logger, ctx.userId, gameId, cd)) return _charErr('Save failed');
        logger.info('[Characters] '+characterId+' unlocked for '+ctx.userId+' (+'+xp+' XP)');
        return JSON.stringify({ success:true, characterId:characterId, name:def.name, rarity:def.rarity, xpBonus:def.xpBonus,
            xpAwarded:xp, introVideoPath:def.introVideoPath,
            totalUnlocked:Object.keys(cd.unlockedCharacters).length,
            totalCharacters:Object.keys(CHAR_DEFS_INLINE).length, timestamp:now });
    };

    var rpcCharacterSetActive = function(ctx, logger, nk, payload) {
        if (!ctx.userId) return _charErr('User not authenticated');
        var data = _charParse(payload); if (data===null) return _charErr('Invalid JSON');
        var gameId = data.gameId||'quizverse'; var characterId = data.characterId;
        if (!characterId) return _charErr('Missing: characterId');
        var def = CHAR_DEFS_INLINE[characterId]; if (!def) return _charErr('Not found: '+characterId);
        var cd = _charRead(nk, logger, ctx.userId, gameId);
        if (!cd) cd = _charInit(ctx.userId);
        if (!cd.unlockedCharacters || !cd.unlockedCharacters[characterId])
            return _charErr('Not unlocked: '+characterId);
        if (cd.activeCharacter === characterId)
            return JSON.stringify({ success:true, activeCharacter:characterId, alreadyActive:true });
        var prev = cd.activeCharacter; cd.activeCharacter = characterId; cd.updatedAt = new Date().toISOString();
        if (!_charWrite(nk, logger, ctx.userId, gameId, cd)) return _charErr('Save failed');
        try {
            var acct = nk.accountGetId(ctx.userId); if (acct) {
                var meta = {}; try { meta = JSON.parse(acct.user.metadata||'{}'); } catch(e) { meta={}; }
                meta.activeCharacter = characterId; meta.activeCharacterXpBonus = def.xpBonus;
                nk.accountUpdateId(ctx.userId, null,null,null,null,null,null,null, JSON.stringify(meta));
            }
        } catch(me) { logger.warn('[Characters] meta update fail: '+me.message); }
        logger.info('[Characters] '+ctx.userId+' switched: '+prev+' → '+characterId);
        return JSON.stringify({ success:true, activeCharacter:characterId, previousCharacter:prev,
            xpBonus:def.xpBonus, timestamp:new Date().toISOString() });
    };

    // ── End Character Inline Handlers ─────────────────────────────────

    try {
        logger.info('[Characters] Initializing Character System Module...');
        initializer.registerRpc('character_get_state', rpcCharacterGetState);
        logger.info('[Characters] Registered RPC: character_get_state');
        initializer.registerRpc('character_unlock', rpcCharacterUnlock);
        logger.info('[Characters] Registered RPC: character_unlock');
        initializer.registerRpc('character_set_active', rpcCharacterSetActive);
        logger.info('[Characters] Registered RPC: character_set_active');
        logger.info('[Characters] Successfully registered 3 Character RPCs');
    } catch (err) {
        logger.error('[Characters] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // v3.0 NEW RPCs â€” Notification Gate + Inbox (3 RPCs)
    // ============================================================================
    try {
        logger.info('[Notifications] Initializing Notification System...');
        initializer.registerRpc('notification_gate_get_state', rpcNotifGateGetState);
        logger.info('[Notifications] Registered RPC: notification_gate_get_state');
        initializer.registerRpc('list_notification_inbox', rpcListNotificationInbox);
        logger.info('[Notifications] Registered RPC: list_notification_inbox');
        initializer.registerRpc('mark_notifications_read', rpcMarkNotificationsRead);
        logger.info('[Notifications] Registered RPC: mark_notifications_read');
        logger.info('[Notifications] Successfully registered 3 Notification RPCs');
    } catch (err) {
        logger.error('[Notifications] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // v3.0 NEW RPCs â€” Smart Review / SM-2 (2 RPCs)
    // ============================================================================
    try {
        logger.info('[SmartReview] Initializing Smart Review Module...');
        initializer.registerRpc('smart_review_get_cards', rpcSmartReviewGetCards);
        logger.info('[SmartReview] Registered RPC: smart_review_get_cards');
        initializer.registerRpc('smart_review_rate_card', rpcSmartReviewRateCard);
        logger.info('[SmartReview] Registered RPC: smart_review_rate_card');
        logger.info('[SmartReview] Successfully registered 2 Smart Review RPCs');
    } catch (err) {
        logger.error('[SmartReview] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // v3.0 NEW RPCs â€” Asset Manifest (1 RPC)
    // ============================================================================
    try {
        logger.info('[Manifest] Initializing Asset Manifest Module...');
        initializer.registerRpc('manifest_get_version', rpcManifestGetVersion);
        logger.info('[Manifest] Registered RPC: manifest_get_version');
        logger.info('[Manifest] Successfully registered 1 Manifest RPC');
    } catch (err) {
        logger.error('[Manifest] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // v3.0 NEW RPCs â€” Player Full Profile (1 RPC)
    // ============================================================================
    try {
        logger.info('[PlayerProfile] Initializing Player Full Profile Module...');
        initializer.registerRpc('player_get_full_profile', rpcPlayerGetFullProfile);
        logger.info('[PlayerProfile] Registered RPC: player_get_full_profile');
        logger.info('[PlayerProfile] Successfully registered 1 Player Profile RPC');
    } catch (err) {
        logger.error('[PlayerProfile] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // v3.0 NEW RPCs â€” Friend Streaks (3 RPCs)
    // ============================================================================
    try {
        logger.info('[FriendStreaks] Initializing Friend Streak Module...');
        initializer.registerRpc('friend_streak_get_state', rpcFriendStreakGetState);
        logger.info('[FriendStreaks] Registered RPC: friend_streak_get_state');
        initializer.registerRpc('friend_streak_record_contribution', rpcFriendStreakRecordContribution);
        logger.info('[FriendStreaks] Registered RPC: friend_streak_record_contribution');
        initializer.registerRpc('friend_streak_send_nudge', rpcFriendStreakSendNudge);
        logger.info('[FriendStreaks] Registered RPC: friend_streak_send_nudge');
        logger.info('[FriendStreaks] Successfully registered 3 Friend Streak RPCs');
    } catch (err) {
        logger.error('[FriendStreaks] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // v3.0 NEW RPCs â€” Friend Quests (2 RPCs)
    // ============================================================================
    try {
        logger.info('[FriendQuests] Initializing Friend Quest Module...');
        initializer.registerRpc('friend_quest_get_state', rpcFriendQuestGetState);
        logger.info('[FriendQuests] Registered RPC: friend_quest_get_state');
        initializer.registerRpc('friend_quest_complete', rpcFriendQuestComplete);
        logger.info('[FriendQuests] Registered RPC: friend_quest_complete');
        logger.info('[FriendQuests] Successfully registered 2 Friend Quest RPCs');
    } catch (err) {
        logger.error('[FriendQuests] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // v3.0 NEW RPCs â€” Fortune Wheel (2 RPCs)
    // ============================================================================
    try {
        logger.info('[FortuneWheel] Initializing Fortune Wheel Module...');
        initializer.registerRpc('fortune_wheel_get_state', fortuneWheelGetState);
        logger.info('[FortuneWheel] Registered RPC: fortune_wheel_get_state');
        initializer.registerRpc('fortune_wheel_spin', fortuneWheelSpin);
        logger.info('[FortuneWheel] Registered RPC: fortune_wheel_spin');
        logger.info('[FortuneWheel] Successfully registered 2 Fortune Wheel RPCs');
    } catch (err) {
        logger.error('[FortuneWheel] Failed to initialize: ' + err.message);
    }

    // ============================================================================
    // v3.0 NEW RPCs â€” Streak Shield (2 RPCs)
    // ============================================================================
    try {
        logger.info('[StreakShield] Initializing Streak Shield RPCs...');
        initializer.registerRpc('streak_shield_freeze', function(ctx, logger, nk, payload) {
            try {
                var userId = ctx.userId;
                var storage = nk.storageRead([{ collection: 'streak_shield', key: 'state', userId: userId }]);
                var state = (storage && storage.length > 0) ? JSON.parse(storage[0].value) : { active: false, freezesUsed: 0 };
                state.active = true; state.frozenAt = Math.floor(Date.now() / 1000); state.freezesUsed = (state.freezesUsed || 0) + 1;
                nk.storageWrite([{ collection: 'streak_shield', key: 'state', userId: userId, value: JSON.stringify(state), permissionRead: 1, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, state: state });
            } catch(e) { logger.error('[StreakShield] freeze error: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });
        initializer.registerRpc('streak_shield_repair', function(ctx, logger, nk, payload) {
            try {
                var userId = ctx.userId;
                var storage = nk.storageRead([{ collection: 'streak_shield', key: 'state', userId: userId }]);
                var state = (storage && storage.length > 0) ? JSON.parse(storage[0].value) : { active: false, repairsUsed: 0 };
                state.active = false; state.repairedAt = Math.floor(Date.now() / 1000); state.repairsUsed = (state.repairsUsed || 0) + 1;
                nk.storageWrite([{ collection: 'streak_shield', key: 'state', userId: userId, value: JSON.stringify(state), permissionRead: 1, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, state: state });
            } catch(e) { logger.error('[StreakShield] repair error: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });
        logger.info('[StreakShield] Registered 2 Streak Shield RPCs');
    } catch (err) { logger.error('[StreakShield] Failed to initialize: ' + err.message); }

    // ============================================================================
    // v3.0 NEW RPCs â€” Weekly Recap (1 RPC)
    // ============================================================================
    try {
        initializer.registerRpc('weekly_recap_get', function(ctx, logger, nk, payload) {
            try {
                var storage = nk.storageRead([{ collection: 'weekly_recap', key: 'latest', userId: ctx.userId }]);
                var recap = (storage && storage.length > 0) ? JSON.parse(storage[0].value) : { weekStart: null, quizzesPlayed: 0, correctAnswers: 0, totalAnswers: 0, xpEarned: 0, coinsEarned: 0, streakDays: 0, topCategory: null };
                return JSON.stringify({ success: true, recap: recap });
            } catch(e) { return JSON.stringify({ success: false, error: e.message }); }
        });
        logger.info('[WeeklyRecap] Registered weekly_recap_get');
    } catch (err) { logger.error('[WeeklyRecap] Failed: ' + err.message); }

    // ============================================================================
    // v3.0 NEW RPCs â€” Friend Streak Milestone (1 RPC)
    // ============================================================================
    try {
        initializer.registerRpc('friend_streak_milestone_reward', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var friendId = data.friendId || ''; var milestone = data.milestone || 0;
                if (!friendId) { return JSON.stringify({ success: false, error: 'friendId required' }); }
                var reward = { coins: milestone * 50, xp: milestone * 100 };
                var wc = {}; wc['coins'] = reward.coins;
                nk.walletUpdate(ctx.userId, wc, { source: 'friend_streak_milestone', milestone: milestone }, true);
                return JSON.stringify({ success: true, reward: reward });
            } catch(e) { return JSON.stringify({ success: false, error: e.message }); }
        });
        logger.info('[FriendStreakMilestone] Registered friend_streak_milestone_reward');
    } catch (err) { logger.error('[FriendStreakMilestone] Failed: ' + err.message); }

    // ============================================================================
    // v3.0 NEW RPCs â€” Collections claim set reward (1 RPC)
    // ============================================================================
    try {
        initializer.registerRpc('collections_claim_set_reward', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var setId = data.setId || '';
                if (!setId) { return JSON.stringify({ success: false, error: 'setId required' }); }
                var claimKey = 'set_claimed_' + setId;
                var check = nk.storageRead([{ collection: 'collections', key: claimKey, userId: ctx.userId }]);
                if (check && check.length > 0) { return JSON.stringify({ success: false, error: 'already claimed' }); }
                nk.walletUpdate(ctx.userId, { coins: 500 }, { source: 'collections_set_reward', setId: setId }, true);
                nk.storageWrite([{ collection: 'collections', key: claimKey, userId: ctx.userId, value: JSON.stringify({ claimedAt: Math.floor(Date.now() / 1000) }), permissionRead: 1, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, reward: { coins: 500, xp: 200 } });
            } catch(e) { return JSON.stringify({ success: false, error: e.message }); }
        });
        logger.info('[Collections] Registered collections_claim_set_reward');
    } catch (err) { logger.error('[Collections] Failed: ' + err.message); }

    // ============================================================================
    // v3.0 NEW RPCs â€” Onboarding aliases (2 RPCs)
    // ============================================================================
    try {
        initializer.registerRpc('onboarding_complete', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var storage = nk.storageRead([{ collection: 'onboarding', key: 'state', userId: ctx.userId }]);
                var state = (storage && storage.length > 0) ? JSON.parse(storage[0].value) : {};
                state.completed = true; state.completedAt = Math.floor(Date.now() / 1000);
                if (data.interests) { state.interests = data.interests; }
                nk.storageWrite([{ collection: 'onboarding', key: 'state', userId: ctx.userId, value: JSON.stringify(state), permissionRead: 1, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, state: state });
            } catch(e) { return JSON.stringify({ success: false, error: e.message }); }
        });
        initializer.registerRpc('user_set_interests', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var interests = data.interests || [];
                var state = { interests: interests, updatedAt: Math.floor(Date.now() / 1000) };
                nk.storageWrite([{ collection: 'onboarding', key: 'interests', userId: ctx.userId, value: JSON.stringify(state), permissionRead: 1, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, interests: interests });
            } catch(e) { return JSON.stringify({ success: false, error: e.message }); }
        });
        logger.info('[Onboarding] Registered onboarding_complete, user_set_interests');
    } catch (err) { logger.error('[Onboarding] Failed: ' + err.message); }

    // ============================================================================
    // v3.0 NEW RPCs — Compatibility Quiz (5 RPCs)
    // ============================================================================
    try {
        // ---------- compatibility_create_session ----------
        initializer.registerRpc('compatibility_create_session', function(ctx, logger, nk, payload) {
            try {
                if (!ctx.userId) return JSON.stringify({ success: false, error: 'Not authenticated' });
                var data = payload ? JSON.parse(payload) : {};
                var gameId = data.gameId || 'quizverse';
                var now = Math.floor(Date.now() / 1000);
                var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                var shareCode = '';
                for (var ci = 0; ci < 6; ci++) shareCode += chars.charAt(Math.floor(Math.random() * chars.length));
                var sessionId = nk.uuidV4();
                var session = {
                    sessionId: sessionId, shareCode: shareCode, gameId: gameId,
                    quizId: data.quizId || '', quizTitle: data.quizTitle || 'Compatibility Quiz',
                    createdByUserId: ctx.userId, status: 'waiting_for_partner',
                    createdAt: now, expiresAt: now + (48 * 3600),
                    playerA: { userId: ctx.userId, displayName: data.playerDisplayName || 'Player', isComplete: false, answers: [], resultId: null, personalityTitle: null, personalityEmoji: null },
                    playerB: null, compatibilityScore: null
                };
                nk.storageWrite([
                    { collection: 'compatibility_sessions', key: sessionId, userId: ctx.userId, value: JSON.stringify(session), permissionRead: 2, permissionWrite: 0 },
                    { collection: 'compatibility_codes', key: shareCode, userId: ctx.userId, value: JSON.stringify({ sessionId: sessionId, createdBy: ctx.userId }), permissionRead: 2, permissionWrite: 0 }
                ]);
                logger.info('[Compatibility] Session created: ' + sessionId + ' code: ' + shareCode);
                return JSON.stringify({ success: true, data: session });
            } catch(e) { logger.error('[Compatibility] create error: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        // ---------- compatibility_join_session ----------
        initializer.registerRpc('compatibility_join_session', function(ctx, logger, nk, payload) {
            try {
                if (!ctx.userId) return JSON.stringify({ success: false, error: 'Not authenticated' });
                var data = payload ? JSON.parse(payload) : {};
                var shareCode = (data.shareCode || '').toUpperCase().trim();
                if (!shareCode || shareCode.length < 4) return JSON.stringify({ success: false, error: 'Invalid share code' });
                var codeList = nk.storageList(null, 'compatibility_codes', 100, '');
                var sessionId = null; var ownerId = null;
                if (codeList && codeList.objects) {
                    for (var ci = 0; ci < codeList.objects.length; ci++) {
                        if (codeList.objects[ci].key === shareCode) {
                            var codeData = JSON.parse(codeList.objects[ci].value);
                            sessionId = codeData.sessionId; ownerId = codeList.objects[ci].userId; break;
                        }
                    }
                }
                if (!sessionId) return JSON.stringify({ success: false, error: 'Session not found for code: ' + shareCode });
                var storage = nk.storageRead([{ collection: 'compatibility_sessions', key: sessionId, userId: ownerId }]);
                if (!storage || storage.length === 0) return JSON.stringify({ success: false, error: 'Session expired or deleted' });
                var session = JSON.parse(storage[0].value);
                if (session.playerB && session.playerB.userId !== ctx.userId) return JSON.stringify({ success: false, error: 'Session is full' });
                if (session.createdByUserId === ctx.userId) return JSON.stringify({ success: false, error: 'Cannot join your own session' });
                if (session.expiresAt < Math.floor(Date.now() / 1000)) return JSON.stringify({ success: false, error: 'Session has expired' });
                session.playerB = { userId: ctx.userId, displayName: data.playerDisplayName || 'Partner', isComplete: false, answers: [], resultId: null, personalityTitle: null, personalityEmoji: null };
                session.status = 'both_playing';
                nk.storageWrite([{ collection: 'compatibility_sessions', key: sessionId, userId: ownerId, value: JSON.stringify(session), permissionRead: 2, permissionWrite: 0 }]);
                logger.info('[Compatibility] ' + ctx.userId + ' joined session ' + sessionId);
                return JSON.stringify({ success: true, data: session });
            } catch(e) { logger.error('[Compatibility] join error: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        // ---------- compatibility_submit_answers ----------
        initializer.registerRpc('compatibility_submit_answers', function(ctx, logger, nk, payload) {
            try {
                if (!ctx.userId) return JSON.stringify({ success: false, error: 'Not authenticated' });
                var data = payload ? JSON.parse(payload) : {};
                var sessionId = data.sessionId;
                if (!sessionId) return JSON.stringify({ success: false, error: 'sessionId required' });
                var session = null; var ownerId = null;
                var list = nk.storageList(null, 'compatibility_sessions', 100, '');
                if (list && list.objects) {
                    for (var si = 0; si < list.objects.length; si++) {
                        if (list.objects[si].key === sessionId) { session = JSON.parse(list.objects[si].value); ownerId = list.objects[si].userId; break; }
                    }
                }
                if (!session) return JSON.stringify({ success: false, error: 'Session not found' });
                var isPlayerA = (session.playerA && session.playerA.userId === ctx.userId);
                var isPlayerB = (session.playerB && session.playerB.userId === ctx.userId);
                if (!isPlayerA && !isPlayerB) return JSON.stringify({ success: false, error: 'Not a participant' });
                var player = isPlayerA ? session.playerA : session.playerB;
                player.answers = data.answers || []; player.isComplete = true;
                player.resultId = data.resultId || null; player.personalityTitle = data.personalityTitle || null;
                player.personalityEmoji = data.personalityEmoji || null; player.completedAt = Math.floor(Date.now() / 1000);
                var bothComplete = (session.playerA && session.playerA.isComplete) && (session.playerB && session.playerB.isComplete);
                if (bothComplete) session.status = 'both_completed';
                nk.storageWrite([{ collection: 'compatibility_sessions', key: sessionId, userId: ownerId, value: JSON.stringify(session), permissionRead: 2, permissionWrite: 0 }]);
                logger.info('[Compatibility] Answers submitted by ' + ctx.userId + ' bothComplete=' + bothComplete);
                return JSON.stringify({ success: true, data: session });
            } catch(e) { logger.error('[Compatibility] submit error: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        // ---------- compatibility_get_session ----------
        initializer.registerRpc('compatibility_get_session', function(ctx, logger, nk, payload) {
            try {
                if (!ctx.userId) return JSON.stringify({ success: false, error: 'Not authenticated' });
                var data = payload ? JSON.parse(payload) : {};
                var sessionId = data.sessionId;
                if (!sessionId) return JSON.stringify({ success: false, error: 'sessionId required' });
                var list = nk.storageList(null, 'compatibility_sessions', 100, '');
                var session = null;
                if (list && list.objects) {
                    for (var gi = 0; gi < list.objects.length; gi++) {
                        if (list.objects[gi].key === sessionId) { session = JSON.parse(list.objects[gi].value); break; }
                    }
                }
                if (!session) return JSON.stringify({ success: false, error: 'Session not found' });
                return JSON.stringify({ success: true, data: session });
            } catch(e) { logger.error('[Compatibility] get error: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        // ---------- compatibility_calculate ----------
        initializer.registerRpc('compatibility_calculate', function(ctx, logger, nk, payload) {
            try {
                if (!ctx.userId) return JSON.stringify({ success: false, error: 'Not authenticated' });
                var data = payload ? JSON.parse(payload) : {};
                var sessionId = data.sessionId;
                if (!sessionId) return JSON.stringify({ success: false, error: 'sessionId required' });
                var session = null; var ownerId = null;
                var list = nk.storageList(null, 'compatibility_sessions', 100, '');
                if (list && list.objects) {
                    for (var ci = 0; ci < list.objects.length; ci++) {
                        if (list.objects[ci].key === sessionId) { session = JSON.parse(list.objects[ci].value); ownerId = list.objects[ci].userId; break; }
                    }
                }
                if (!session) return JSON.stringify({ success: false, error: 'Session not found' });
                if (!session.playerA || !session.playerA.isComplete || !session.playerB || !session.playerB.isComplete)
                    return JSON.stringify({ success: false, error: 'Both players must complete quiz first' });
                var answersA = session.playerA.answers || []; var answersB = session.playerB.answers || [];
                var matchCount = 0; var totalQ = Math.max(answersA.length, answersB.length, 1);
                var bMap = {};
                for (var bi = 0; bi < answersB.length; bi++) { bMap[answersB[bi].questionId] = answersB[bi].selectedOptionId; }
                for (var ai = 0; ai < answersA.length; ai++) { if (bMap[answersA[ai].questionId] === answersA[ai].selectedOptionId) matchCount++; }
                var rawScore = (matchCount / totalQ) * 100;
                var score = Math.min(100, Math.max(10, rawScore + (Math.random() * 10 - 5)));
                score = Math.round(score * 10) / 10;
                var level = score >= 80 ? 'soulmate_match' : score >= 60 ? 'great_match' : score >= 40 ? 'good_match' : 'growing_match';
                var emoji = score >= 80 ? '\uD83D\uDC96' : score >= 60 ? '\uD83D\uDC95' : score >= 40 ? '\uD83D\uDC9B' : '\uD83C\uDF31';
                var matchingTraits = []; var complementaryTraits = [];
                var allTraitsA = {}; var allTraitsB = {};
                for (var ia = 0; ia < answersA.length; ia++) { var ta = answersA[ia].traits || []; for (var ti = 0; ti < ta.length; ti++) allTraitsA[ta[ti]] = true; }
                for (var ib = 0; ib < answersB.length; ib++) { var tb = answersB[ib].traits || []; for (var tj = 0; tj < tb.length; tj++) allTraitsB[tb[tj]] = true; }
                for (var trait in allTraitsA) { if (allTraitsB[trait]) matchingTraits.push(trait); else complementaryTraits.push(trait); }
                var result = {
                    overallScore: score, compatibilityLevel: level, matchingAnswers: matchCount, totalQuestions: totalQ,
                    matchingTraits: matchingTraits.slice(0, 5), complementaryTraits: complementaryTraits.slice(0, 5),
                    relationshipAdvice: score >= 60 ? 'You two share a wonderful connection! Your similar values create a strong foundation.' : 'Your differences can bring balance and new perspectives to your relationship.',
                    emoji: emoji, shareMessage: 'We are ' + Math.round(score) + '% compatible! ' + emoji
                };
                session.compatibilityScore = score; session.compatibilityResult = result;
                nk.storageWrite([{ collection: 'compatibility_sessions', key: sessionId, userId: ownerId, value: JSON.stringify(session), permissionRead: 2, permissionWrite: 0 }]);
                logger.info('[Compatibility] Score: ' + score + '% for session ' + sessionId);
                return JSON.stringify({ success: true, data: result });
            } catch(e) { logger.error('[Compatibility] calculate error: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        logger.info('[Compatibility] Successfully registered 5 Compatibility Quiz RPCs');
    } catch (err) { logger.error('[Compatibility] Failed to initialize: ' + err.message); }

    // ============================================================================
    // v3.0 NEW RPCs â€” Cross-Game Presence / Messaging (3 RPCs)
    // ============================================================================
    try {
        initializer.registerRpc('ivx_set_player_presence', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var presence = { userId: ctx.userId, gameId: data.gameId || 'quizverse', status: data.status || 'online', metadata: data.metadata || {}, updatedAt: Math.floor(Date.now() / 1000) };
                nk.storageWrite([{ collection: 'player_presence', key: 'current', userId: ctx.userId, value: JSON.stringify(presence), permissionRead: 2, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, presence: presence });
            } catch(e) { return JSON.stringify({ success: false, error: e.message }); }
        });
        initializer.registerRpc('ivx_get_cross_game_messages', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var limit = data.limit || 20;
                var storage = nk.storageRead([{ collection: 'cross_game_messages', key: 'inbox', userId: ctx.userId }]);
                var inbox = (storage && storage.length > 0) ? JSON.parse(storage[0].value) : { messages: [] };
                var messages = (inbox.messages || []).slice(-limit);
                return JSON.stringify({ success: true, messages: messages, total: messages.length });
            } catch(e) { return JSON.stringify({ success: false, error: e.message }); }
        });
        initializer.registerRpc('ivx_mark_message_read', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var messageId = data.messageId || '';
                if (!messageId) { return JSON.stringify({ success: false, error: 'messageId required' }); }
                var storage = nk.storageRead([{ collection: 'cross_game_messages', key: 'inbox', userId: ctx.userId }]);
                var inbox = (storage && storage.length > 0) ? JSON.parse(storage[0].value) : { messages: [] };
                var msgs = inbox.messages || [];
                for (var i = 0; i < msgs.length; i++) { if (msgs[i].id === messageId) { msgs[i].read = true; } }
                inbox.messages = msgs;
                nk.storageWrite([{ collection: 'cross_game_messages', key: 'inbox', userId: ctx.userId, value: JSON.stringify(inbox), permissionRead: 1, permissionWrite: 0 }]);
                return JSON.stringify({ success: true });
            } catch(e) { return JSON.stringify({ success: false, error: e.message }); }
        });
        logger.info('[CrossGame] Registered 3 IVX Cross-Game RPCs');
    } catch (err) { logger.error('[CrossGame] Failed: ' + err.message); }

    // ============================================================================
    // v3.0 NEW RPCs â€” Gift System (1 RPC)
    // ============================================================================
    try {
        initializer.registerRpc('gift_send', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var recipientId = data.recipientId || ''; var giftType = data.giftType || 'coins'; var amount = data.amount || 0;
                if (!recipientId) { return JSON.stringify({ success: false, error: 'recipientId required' }); }
                if (amount <= 0) { return JSON.stringify({ success: false, error: 'amount must be positive' }); }
                var deduct = {}; deduct[giftType] = -amount;
                var credit = {}; credit[giftType] = amount;
                nk.walletUpdate(ctx.userId, deduct, { source: 'gift_sent', recipientId: recipientId }, true);
                nk.walletUpdate(recipientId, credit, { source: 'gift_received', senderId: ctx.userId }, true);
                var gift = { id: ctx.userId + '_' + Date.now(), type: 'gift', senderId: ctx.userId, giftType: giftType, amount: amount, sentAt: Math.floor(Date.now() / 1000), read: false };
                var s = nk.storageRead([{ collection: 'cross_game_messages', key: 'inbox', userId: recipientId }]);
                var inbox = (s && s.length > 0) ? JSON.parse(s[0].value) : { messages: [] };
                inbox.messages = inbox.messages || []; inbox.messages.push(gift);
                nk.storageWrite([{ collection: 'cross_game_messages', key: 'inbox', userId: recipientId, value: JSON.stringify(inbox), permissionRead: 1, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, gift: gift });
            } catch(e) { logger.error('[Gifts] gift_send error: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });
        logger.info('[Gifts] Registered gift_send');
    } catch (err) { logger.error('[Gifts] Failed: ' + err.message); }

    // ============================================================================
    // v3.1 NEW RPCs - Compatibility Quiz System (5 RPCs)
    // ============================================================================
    function generateShareCode() {
        var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var code = '';
        for (var i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    try {
        // 1. Create compatibility session
        initializer.registerRpc('compatibility_create_session', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var userId = ctx.userId;
                var sessionId = nk.uuidv4();
                var code = generateShareCode();

                var session = {
                    sessionId: sessionId,
                    shareCode: code,
                    gameId: data.gameId || 'quiz-verse',
                    quizId: data.quizId || '',
                    quizTitle: data.quizTitle || 'Compatibility Quiz',
                    createdByUserId: userId,
                    createdByDisplayName: data.playerDisplayName || '',
                    status: 'waiting_for_partner',
                    playerAAnswers: [],
                    playerBAnswers: [],
                    createdAt: Math.floor(Date.now() / 1000),
                    expiresAt: Math.floor(Date.now() / 1000) + (48 * 3600)
                };

                nk.storageWrite([{
                    collection: 'compatibility_sessions',
                    key: sessionId,
                    userId: userId,
                    value: JSON.stringify(session),
                    permissionRead: 2,
                    permissionWrite: 0
                }]);

                nk.storageWrite([{
                    collection: 'compatibility_codes',
                    key: code,
                    userId: userId,
                    value: JSON.stringify({ sessionId: sessionId, createdBy: userId }),
                    permissionRead: 2,
                    permissionWrite: 0
                }]);

                logger.info('[Compatibility] Session created: ' + sessionId + ' code=' + code);
                return JSON.stringify({ success: true, data: session });
            } catch(e) {
                logger.error('[Compatibility] create_session: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        // 2. Join compatibility session
        initializer.registerRpc('compatibility_join_session', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var userId = ctx.userId;
                var sessionId = data.sessionId || '';
                var shareCode = data.shareCode || '';

                if (!sessionId && shareCode) {
                    var cr = nk.storageRead([{
                        collection: 'compatibility_codes',
                        key: shareCode.toUpperCase()
                    }]);
                    if (cr && cr.length > 0) {
                        sessionId = JSON.parse(cr[0].value).sessionId;
                    }
                }

                if (!sessionId) {
                    return JSON.stringify({ success: false, error: 'Session not found for code: ' + shareCode });
                }

                var records = nk.storageRead([{
                    collection: 'compatibility_sessions',
                    key: sessionId
                }]);
                if (!records || records.length === 0) {
                    return JSON.stringify({ success: false, error: 'Session not found' });
                }

                var session = JSON.parse(records[0].value);
                session.partnerUserId = userId;
                session.partnerDisplayName = data.playerDisplayName || '';
                session.status = 'both_joined';

                nk.storageWrite([{
                    collection: 'compatibility_sessions',
                    key: sessionId,
                    userId: records[0].userId,
                    value: JSON.stringify(session),
                    permissionRead: 2,
                    permissionWrite: 0
                }]);

                logger.info('[Compatibility] Player joined session: ' + sessionId);
                return JSON.stringify({ success: true, data: session });
            } catch(e) {
                logger.error('[Compatibility] join_session: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        // 3. Submit answers
        initializer.registerRpc('compatibility_submit_answers', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var userId = ctx.userId;
                var sessionId = data.sessionId || '';

                var records = nk.storageRead([{
                    collection: 'compatibility_sessions',
                    key: sessionId
                }]);
                if (!records || records.length === 0) {
                    return JSON.stringify({ success: false, error: 'Session not found' });
                }

                var session = JSON.parse(records[0].value);

                if (userId === session.createdByUserId) {
                    session.playerAAnswers = data.answers || [];
                    session.playerAResult = {
                        resultId: data.resultId,
                        title: data.personalityTitle,
                        emoji: data.personalityEmoji
                    };
                } else {
                    session.playerBAnswers = data.answers || [];
                    session.playerBResult = {
                        resultId: data.resultId,
                        title: data.personalityTitle,
                        emoji: data.personalityEmoji
                    };
                }

                if (session.playerAAnswers && session.playerAAnswers.length > 0 &&
                    session.playerBAnswers && session.playerBAnswers.length > 0) {
                    session.status = 'both_completed';
                }

                nk.storageWrite([{
                    collection: 'compatibility_sessions',
                    key: sessionId,
                    userId: records[0].userId,
                    value: JSON.stringify(session),
                    permissionRead: 2,
                    permissionWrite: 0
                }]);

                return JSON.stringify({ success: true, data: session });
            } catch(e) {
                logger.error('[Compatibility] submit_answers: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        // 4. Get session status
        initializer.registerRpc('compatibility_get_session', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var sessionId = data.sessionId || '';

                var records = nk.storageRead([{
                    collection: 'compatibility_sessions',
                    key: sessionId
                }]);
                if (!records || records.length === 0) {
                    return JSON.stringify({ success: false, error: 'Session not found' });
                }

                return JSON.stringify({ success: true, data: JSON.parse(records[0].value) });
            } catch(e) {
                logger.error('[Compatibility] get_session: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        // 5. Calculate compatibility score
        initializer.registerRpc('compatibility_calculate', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var sessionId = data.sessionId || '';

                var records = nk.storageRead([{
                    collection: 'compatibility_sessions',
                    key: sessionId
                }]);
                if (!records || records.length === 0) {
                    return JSON.stringify({ success: false, error: 'Session not found' });
                }

                var session = JSON.parse(records[0].value);
                if (!session.playerAAnswers || !session.playerBAnswers ||
                    session.playerAAnswers.length === 0 || session.playerBAnswers.length === 0) {
                    return JSON.stringify({ success: false, error: 'Both players must complete the quiz first' });
                }

                var totalQ = Math.min(session.playerAAnswers.length, session.playerBAnswers.length);
                var matching = 0;
                for (var i = 0; i < totalQ; i++) {
                    if (session.playerAAnswers[i].selectedOptionId === session.playerBAnswers[i].selectedOptionId) {
                        matching++;
                    }
                }
                var score = totalQ > 0 ? Math.round((matching / totalQ) * 100) : 0;

                var result = {
                    sessionId: sessionId,
                    overallScore: score,
                    matchingAnswers: matching,
                    totalQuestions: totalQ,
                    playerAResult: session.playerAResult || {},
                    playerBResult: session.playerBResult || {},
                    calculatedAt: Math.floor(Date.now() / 1000)
                };

                session.compatibilityScore = score;
                session.compatibilityResult = result;
                nk.storageWrite([{
                    collection: 'compatibility_sessions',
                    key: sessionId,
                    userId: records[0].userId,
                    value: JSON.stringify(session),
                    permissionRead: 2,
                    permissionWrite: 0
                }]);

                return JSON.stringify({ success: true, data: result });
            } catch(e) {
                logger.error('[Compatibility] calculate: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        logger.info('[Compatibility] Registered 5 Compatibility Quiz RPCs');
    } catch (err) { logger.error('[Compatibility] Failed: ' + err.message); }

    // ============================================================================
    // v3.1 NEW RPCs - Clan System (3 RPCs)
    // ============================================================================
    try {
        initializer.registerRpc('get_clan_challenges', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var clanId = data.clanId || '';

                if (!clanId) {
                    return JSON.stringify({ success: false, error: 'clanId required' });
                }

                var records = nk.storageRead([{
                    collection: 'clan_challenges',
                    key: clanId
                }]);
                var challenges = (records && records.length > 0)
                    ? JSON.parse(records[0].value)
                    : { challenges: [], lastUpdated: 0 };

                return JSON.stringify({ success: true, data: challenges });
            } catch(e) {
                logger.error('[Clan] get_clan_challenges: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        initializer.registerRpc('contribute_clan_challenge', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var userId = ctx.userId;
                var clanId = data.clanId || '';
                var challengeId = data.challengeId || '';
                var contribution = data.contribution || 0;

                if (!clanId || !challengeId) {
                    return JSON.stringify({ success: false, error: 'clanId and challengeId required' });
                }

                var records = nk.storageRead([{
                    collection: 'clan_challenges',
                    key: clanId
                }]);
                var store = (records && records.length > 0)
                    ? JSON.parse(records[0].value)
                    : { challenges: [], lastUpdated: 0 };

                var found = false;
                for (var i = 0; i < store.challenges.length; i++) {
                    if (store.challenges[i].id === challengeId) {
                        store.challenges[i].currentProgress = (store.challenges[i].currentProgress || 0) + contribution;
                        store.challenges[i].contributors = store.challenges[i].contributors || [];
                        store.challenges[i].contributors.push({
                            userId: userId,
                            amount: contribution,
                            at: Math.floor(Date.now() / 1000)
                        });
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    return JSON.stringify({ success: false, error: 'Challenge not found: ' + challengeId });
                }

                store.lastUpdated = Math.floor(Date.now() / 1000);
                nk.storageWrite([{
                    collection: 'clan_challenges',
                    key: clanId,
                    userId: userId,
                    value: JSON.stringify(store),
                    permissionRead: 2,
                    permissionWrite: 0
                }]);

                return JSON.stringify({ success: true, data: store });
            } catch(e) {
                logger.error('[Clan] contribute_clan_challenge: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        initializer.registerRpc('get_clan_leaderboard', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var clanId = data.clanId || '';
                var period = data.period || 'weekly';

                if (!clanId) {
                    return JSON.stringify({ success: false, error: 'clanId required' });
                }

                var leaderboardId = 'clan_' + clanId + '_' + period;
                var result = { entries: [], clanId: clanId, period: period };

                try {
                    var recs = nk.leaderboardRecordsList(leaderboardId, null, 50, null, 0);
                    if (recs && recs.records) {
                        result.entries = recs.records.map(function(r) {
                            return {
                                userId: r.ownerId,
                                username: r.username,
                                score: r.score,
                                rank: r.rank
                            };
                        });
                    }
                } catch(le) {
                    logger.warn('[Clan] Leaderboard not found: ' + leaderboardId);
                }

                return JSON.stringify({ success: true, data: result });
            } catch(e) {
                logger.error('[Clan] get_clan_leaderboard: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        logger.info('[Clan] Registered 3 Clan RPCs');
    } catch (err) { logger.error('[Clan] Failed: ' + err.message); }

    // ============================================================================
    // v3.1 NEW RPCs - Matchmaking System (5 RPCs)
    // ============================================================================
    try {
        initializer.registerRpc('matchmaking_find_match', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var userId = ctx.userId;
                var gameMode = data.gameMode || 'standard';
                var difficulty = data.difficulty || 'medium';
                var minPlayers = data.minPlayers || 2;
                var maxPlayers = data.maxPlayers || 4;

                var query = '+properties.gameMode:' + gameMode;
                var props = { gameMode: gameMode, difficulty: difficulty };

                var ticket = nk.matchmakerAdd(userId, minPlayers, maxPlayers, query, props, {});

                return JSON.stringify({
                    success: true,
                    data: { ticketId: ticket.ticket, status: 'searching', gameMode: gameMode }
                });
            } catch(e) {
                logger.error('[Matchmaking] find_match: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        initializer.registerRpc('matchmaking_cancel', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var ticketId = data.ticketId || '';

                if (!ticketId) {
                    return JSON.stringify({ success: false, error: 'ticketId required' });
                }

                nk.matchmakerRemove(ticketId);
                return JSON.stringify({
                    success: true,
                    data: { ticketId: ticketId, status: 'cancelled' }
                });
            } catch(e) {
                logger.error('[Matchmaking] cancel: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        initializer.registerRpc('matchmaking_get_status', function(ctx, logger, nk, payload) {
            try {
                var userId = ctx.userId;

                var records = nk.storageRead([{
                    collection: 'matchmaking_state',
                    key: 'status',
                    userId: userId
                }]);
                var status = (records && records.length > 0)
                    ? JSON.parse(records[0].value)
                    : { status: 'idle', ticketId: null };

                return JSON.stringify({ success: true, data: status });
            } catch(e) {
                logger.error('[Matchmaking] get_status: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        initializer.registerRpc('matchmaking_create_party', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var userId = ctx.userId;
                var maxMembers = data.maxMembers || 4;
                var partyCode = generateShareCode();

                var party = {
                    partyId: nk.uuidv4(),
                    partyCode: partyCode,
                    leaderId: userId,
                    members: [userId],
                    maxMembers: maxMembers,
                    status: 'waiting',
                    createdAt: Math.floor(Date.now() / 1000)
                };

                nk.storageWrite([{
                    collection: 'parties',
                    key: party.partyId,
                    userId: userId,
                    value: JSON.stringify(party),
                    permissionRead: 2,
                    permissionWrite: 0
                }]);

                nk.storageWrite([{
                    collection: 'party_codes',
                    key: partyCode,
                    userId: userId,
                    value: JSON.stringify({ partyId: party.partyId }),
                    permissionRead: 2,
                    permissionWrite: 0
                }]);

                return JSON.stringify({ success: true, data: party });
            } catch(e) {
                logger.error('[Matchmaking] create_party: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        initializer.registerRpc('matchmaking_join_party', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var userId = ctx.userId;
                var partyCode = (data.partyCode || '').toUpperCase();

                if (!partyCode) {
                    return JSON.stringify({ success: false, error: 'partyCode required' });
                }

                var cr = nk.storageRead([{
                    collection: 'party_codes',
                    key: partyCode
                }]);
                if (!cr || cr.length === 0) {
                    return JSON.stringify({ success: false, error: 'Party not found for code: ' + partyCode });
                }

                var partyId = JSON.parse(cr[0].value).partyId;

                var records = nk.storageRead([{
                    collection: 'parties',
                    key: partyId
                }]);
                if (!records || records.length === 0) {
                    return JSON.stringify({ success: false, error: 'Party not found' });
                }

                var party = JSON.parse(records[0].value);
                if (party.members.length >= party.maxMembers) {
                    return JSON.stringify({ success: false, error: 'Party is full' });
                }
                if (party.members.indexOf(userId) === -1) {
                    party.members.push(userId);
                }

                nk.storageWrite([{
                    collection: 'parties',
                    key: partyId,
                    userId: records[0].userId,
                    value: JSON.stringify(party),
                    permissionRead: 2,
                    permissionWrite: 0
                }]);

                return JSON.stringify({ success: true, data: party });
            } catch(e) {
                logger.error('[Matchmaking] join_party: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        logger.info('[Matchmaking] Registered 5 Matchmaking RPCs');
    } catch (err) { logger.error('[Matchmaking] Failed: ' + err.message); }

    // ============================================================================
    // v3.1 NEW RPCs - Player Stats (1 RPC)
    // ============================================================================
    try {
        initializer.registerRpc('get_player_stats', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var targetUserId = data.userId || ctx.userId;

                var records = nk.storageRead([{
                    collection: 'player_stats',
                    key: 'stats',
                    userId: targetUserId
                }]);

                var stats = (records && records.length > 0)
                    ? JSON.parse(records[0].value)
                    : {
                        userId: targetUserId,
                        totalGamesPlayed: 0,
                        totalCorrectAnswers: 0,
                        totalQuestions: 0,
                        winRate: 0,
                        currentStreak: 0,
                        bestStreak: 0,
                        averageScore: 0,
                        favoriteCategory: '',
                        lastPlayedAt: 0
                    };

                try {
                    var accts = nk.accountsGetId([targetUserId]);
                    if (accts && accts.length > 0) {
                        stats.displayName = accts[0].user.displayName || accts[0].user.username || '';
                        stats.avatarUrl = accts[0].user.avatarUrl || '';
                    }
                } catch(ae) { /* ignore account fetch errors */ }

                return JSON.stringify({ success: true, data: stats });
            } catch(e) {
                logger.error('[Profile] get_player_stats: ' + e.message);
                return JSON.stringify({ success: false, error: e.message });
            }
        });

        logger.info('[Profile] Registered 1 Player Stats RPC');
    } catch (err) { logger.error('[Profile] Failed: ' + err.message); }


    logger.info('========================================');
    logger.info('JavaScript Runtime Initialization Complete');
    logger.info('Total System RPCs: 233');

    logger.info('  - Core Multi-Game RPCs: 71');
    logger.info('  - Achievement System: 4');
    logger.info('  - Matchmaking System: 5');
    logger.info('  - Tournament System: 6');
    logger.info('  - Infrastructure (Batch/Cache/Rate): 6');
    logger.info('  - QuizVerse Multiplayer: 3');
    logger.info('  - Guest Cleanup: 1');
    logger.info('  - Onboarding System: 11');
    logger.info('  - Retention System: 7');
    logger.info('  - Weekly Goals System: 4');
    logger.info('  - Season Pass System: 5');
    logger.info('  - Monthly Milestones System: 4');
    logger.info('  - Collections System: 4');
    logger.info('  - Winback System: 4');
    logger.info('  - Async Challenge System: 9');
    logger.info('  - Badges System: 5');
    logger.info('  - Collectables System: 4');
    logger.info('  - Plus existing Copilot RPCs');
    logger.info('  --- v3.0 New RPCs ---');
    logger.info('  - League System: 4');
    logger.info('  - Streak Repair & Wager: 2');
    logger.info('  - Character System: 3');
    logger.info('  - Notification System: 3');
    logger.info('  - Smart Review (SM-2): 2');
    logger.info('  - Friend Streaks: 3');
    logger.info('  - Friend Quests: 2');
    logger.info('  - Fortune Wheel: 2');
    logger.info('  - Asset Manifest: 1');
    logger.info('  - Player Full Profile: 1');
    logger.info('  --- v3.1 New RPCs ---');
    logger.info('  - Compatibility Quiz System: 5');
    logger.info('  - Clan System: 3');
    logger.info('  - Matchmaking System (Client): 5');
    logger.info('  - Player Stats: 1');
    logger.info('========================================');
    logger.info('All v3.1 RPCs registered successfully!');
    logger.info('========================================');
}
