// multiplayer_locks.js — Multiplayer Account Lock System (QVVBS189)

var LOCK_COLLECTION = "multiplayer_locks";
var LOCK_KEY = "active_lock";
var LOCK_DURATION_SECONDS = 30; // Lock lease duration before heartbeat timeout

/**
 * RPC: Acquire Multiplayer Account Lock
 * Prevents another device from concurrently playing on this account
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with LockAcquireRequest
 * @returns {string} JSON response
 */
function rpcAcquireMultiplayerLock(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC rpc_acquire_multiplayer_lock called");

    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data;
    var validation = utils.validatePayload(data, ['deviceId', 'provider', 'mode', 'matchId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }

    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }

    var deviceId = data.deviceId;
    var now = utils.getUnixTimestamp(); // unix timestamp in seconds

    // Read existing lock from the storage engine
    var existingLock = utils.readStorage(nk, logger, LOCK_COLLECTION, LOCK_KEY, userId);

    // If an active lock exists and belongs to a different device, reject entry
    if (existingLock && existingLock.deviceId !== deviceId && existingLock.expiresAt > now) {
        utils.logWarn(logger, "Lock acquisition blocked: Account " + userId + " active on device " + existingLock.deviceId);
        return JSON.stringify({
            success: false,
            blocked: true,
            lockId: existingLock.lockId,
            activeDeviceId: existingLock.deviceId,
            provider: existingLock.provider,
            mode: existingLock.mode,
            message: "Account already active on another device."
        });
    }

    // Acquire or refresh the lock lease
    var lockId = nk.uuidv4();
    var expiresAt = now + LOCK_DURATION_SECONDS;

    var newLock = {
        deviceId: deviceId,
        lockId: lockId,
        expiresAt: expiresAt,
        provider: data.provider,
        mode: data.mode,
        matchId: data.matchId,
        updatedAt: utils.getCurrentTimestamp()
    };

    if (!utils.writeStorage(nk, logger, LOCK_COLLECTION, LOCK_KEY, userId, newLock)) {
        return utils.handleError(ctx, null, "Failed to save lock storage data");
    }

    utils.logInfo(logger, "Account " + userId + " acquired lock lease " + lockId + " on device " + deviceId);

    return JSON.stringify({
        success: true,
        blocked: false,
        lockId: lockId,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        message: "Lock acquired successfully"
    });
}

/**
 * RPC: Heartbeat Multiplayer Account Lock
 * Refreshes/extends the lock lease of the active device
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with LockHeartbeatRequest
 * @returns {string} JSON response
 */
function rpcHeartbeatMultiplayerLock(ctx, logger, nk, payload) {
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data;
    var validation = utils.validatePayload(data, ['deviceId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }

    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }

    var deviceId = data.deviceId;
    var now = utils.getUnixTimestamp();

    // Read current lock
    var currentLock = utils.readStorage(nk, logger, LOCK_COLLECTION, LOCK_KEY, userId);

    if (!currentLock) {
        return JSON.stringify({
            success: false,
            stillOwner: false,
            expired: true,
            message: "No active lock found for this account."
        });
    }

    // Verify requesting device still owns the lock
    if (currentLock.deviceId !== deviceId) {
        utils.logWarn(logger, "Heartbeat rejected: Device " + deviceId + " is not the owner of active lock for " + userId);
        return JSON.stringify({
            success: false,
            stillOwner: false,
            expired: false,
            message: "Lock is owned by another device."
        });
    }

    // Extend the lock expiration lease by another 30 seconds
    currentLock.expiresAt = now + LOCK_DURATION_SECONDS;
    currentLock.updatedAt = utils.getCurrentTimestamp();

    if (!utils.writeStorage(nk, logger, LOCK_COLLECTION, LOCK_KEY, userId, currentLock)) {
        return utils.handleError(ctx, null, "Failed to update heartbeat lease");
    }

    return JSON.stringify({
        success: true,
        stillOwner: true,
        expired: false,
        expiresAt: new Date(currentLock.expiresAt * 1000).toISOString(),
        message: "Heartbeat accepted"
    });
}

/**
 * RPC: Release Multiplayer Account Lock
 * Clears the active lock lease when leaving multiplayer
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with LockReleaseRequest
 * @returns {string} JSON response
 */
function rpcReleaseMultiplayerLock(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC rpc_release_multiplayer_lock called");

    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data;
    var validation = utils.validatePayload(data, ['deviceId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }

    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }

    var deviceId = data.deviceId;

    // Read current lock
    var currentLock = utils.readStorage(nk, logger, LOCK_COLLECTION, LOCK_KEY, userId);

    if (currentLock && currentLock.deviceId === deviceId) {
        try {
            // Delete the storage record
            nk.storageDelete([{ collection: LOCK_COLLECTION, key: LOCK_KEY, userId: userId }]);
            utils.logInfo(logger, "Lock released for user " + userId + " on device " + deviceId);
        } catch (err) {
            return utils.handleError(ctx, null, "Failed to delete lock storage: " + err.message);
        }
    }

    return JSON.stringify({
        success: true,
        message: "Lock released"
    });
}

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("rpc_acquire_multiplayer_lock", rpcAcquireMultiplayerLock);
    initializer.registerRpc("rpc_heartbeat_multiplayer_lock", rpcHeartbeatMultiplayerLock);
    initializer.registerRpc("rpc_release_multiplayer_lock", rpcReleaseMultiplayerLock);
    logger.info("[MultiplayerLock] Module InitModule registered: 3 RPCs");
}