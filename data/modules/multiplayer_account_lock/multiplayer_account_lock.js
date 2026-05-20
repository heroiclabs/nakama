/**
 * ============================================================================
 * multiplayer_account_lock.js — Server-Authoritative Multiplayer Account Lock
 * ============================================================================
 * QVVBS189: Prevents same account from playing multiplayer matches on multiple
 * devices simultaneously. Supports both Photon (sync) and Nakama (async) flows.
 * 
 * Lock Structure:
 * - Collection: "multiplayer_locks"
 * - Key: userId
 * - Atomic via version checks
 * - Expires via heartbeat timeout
 * ============================================================================
 */

var LOCK_COLLECTION = "multiplayer_locks";
var LOCK_TIMEOUT_SECONDS = 300; // 5 minutes without heartbeat = stale
var HEARTBEAT_INTERVAL_SECONDS = 30; // Expected heartbeat every 30s

/**
 * RPC: multiplayer_lock_acquire
 * Atomically acquire multiplayer lock for this account
 * 
 * Payload:
 * {
 *   sessionId: string,
 *   deviceId: string,
 *   provider: "Photon" | "Nakama" | "Mixed",
 *   mode: string,
 *   matchId: string (optional)
 * }
 * 
 * Returns:
 * {
 *   success: boolean,
 *   blocked: boolean,
 *   lockId: string,
 *   activeDeviceId: string (if blocked),
 *   provider: string (if blocked),
 *   mode: string (if blocked),
 *   expiresAt: string,
 *   message: string
 * }
 */
var rpcMultiplayerLockAcquire = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId;
        var sessionId = data.sessionId || ctx.sessionId;
        var deviceId = data.deviceId || "unknown";
        var provider = data.provider || "Unknown";
        var mode = data.mode || "Unknown";
        var matchId = data.matchId || null;
        
        if (!sessionId || !deviceId) {
            throw Error("sessionId and deviceId are required");
        }
        
        logger.info("[MP Lock] Acquire attempt: user=" + userId + ", session=" + sessionId + ", device=" + deviceId + ", provider=" + provider);
        
        var now = Date.now();
        var expiresAt = now + (LOCK_TIMEOUT_SECONDS * 1000);
        
        // Try to read existing lock
        var existingLock = null;
        var existingVersion = null;
        
        try {
            var records = nk.storageRead([{
                collection: LOCK_COLLECTION,
                key: userId,
                userId: userId
            }]);
            
            if (records && records.length > 0 && records[0].value) {
                existingLock = records[0].value;
                existingVersion = records[0].version;
            }
        } catch (readErr) {
            logger.warn("[MP Lock] No existing lock found for user: " + userId);
        }
        
        // Check if existing lock is valid
        if (existingLock) {
            var lockExpiresAt = existingLock.expiresAt || 0;
            var isExpired = now > lockExpiresAt;
            
            // If lock is expired, we can acquire
            if (isExpired) {
                logger.info("[MP Lock] Existing lock expired for user: " + userId + ", acquiring new lock");
            }
            // If lock belongs to same session/device, refresh it
            else if (existingLock.sessionId === sessionId && existingLock.deviceId === deviceId) {
                logger.info("[MP Lock] Refreshing existing lock for user: " + userId);
                
                var refreshedLock = {
                    userId: userId,
                    sessionId: sessionId,
                    deviceId: deviceId,
                    provider: provider,
                    mode: mode,
                    matchId: matchId,
                    lockCreatedAt: existingLock.lockCreatedAt || now,
                    lastHeartbeatAt: now,
                    expiresAt: expiresAt,
                    status: "Active"
                };
                
                // Update with version check
                nk.storageWrite([{
                    collection: LOCK_COLLECTION,
                    key: userId,
                    userId: userId,
                    value: refreshedLock,
                    version: existingVersion,
                    permissionRead: 1,
                    permissionWrite: 0
                }]);
                
                return JSON.stringify({
                    success: true,
                    blocked: false,
                    lockId: userId,
                    expiresAt: new Date(expiresAt).toISOString(),
                    message: "Lock refreshed"
                });
            }
            // Lock belongs to another session/device and is not expired
            else {
                logger.warn("[MP Lock] BLOCKED: user=" + userId + " already has active lock on device=" + existingLock.deviceId);
                
                return JSON.stringify({
                    success: false,
                    blocked: true,
                    lockId: userId,
                    activeDeviceId: existingLock.deviceId.substring(0, 8) + "***", // Masked for privacy
                    provider: existingLock.provider,
                    mode: existingLock.mode,
                    expiresAt: new Date(lockExpiresAt).toISOString(),
                    message: "This account is already playing a multiplayer match on another device."
                });
            }
        }
        
        // No existing lock or expired - create new lock atomically
        var newLock = {
            userId: userId,
            sessionId: sessionId,
            deviceId: deviceId,
            provider: provider,
            mode: mode,
            matchId: matchId,
            lockCreatedAt: now,
            lastHeartbeatAt: now,
            expiresAt: expiresAt,
            status: "Active"
        };
        
        // Write with version check to ensure atomicity
        // If another request wrote between our read and write, this will fail
        nk.storageWrite([{
            collection: LOCK_COLLECTION,
            key: userId,
            userId: userId,
            value: newLock,
            version: existingVersion || "*", // "*" = must not exist, version = must match
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[MP Lock] ACQUIRED: user=" + userId + ", session=" + sessionId + ", device=" + deviceId);
        
        return JSON.stringify({
            success: true,
            blocked: false,
            lockId: userId,
            expiresAt: new Date(expiresAt).toISOString(),
            message: "Multiplayer lock acquired successfully"
        });
        
    } catch (err) {
        logger.error("[MP Lock] Acquire error: " + err.message);
        
        // If write failed due to version conflict, another session won the race
        if (err.message && err.message.indexOf("version") >= 0) {
            return JSON.stringify({
                success: false,
                blocked: true,
                message: "Another device started multiplayer at the same time. Please try again."
            });
        }
        
        return JSON.stringify({
            success: false,
            blocked: false,
            error: err.message,
            message: "Failed to acquire multiplayer lock: " + err.message
        });
    }
};

/**
 * RPC: multiplayer_lock_release
 * Release multiplayer lock for this account
 * 
 * Payload:
 * {
 *   sessionId: string,
 *   deviceId: string,
 *   reason: string (optional)
 * }
 */
var rpcMultiplayerLockRelease = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId;
        var sessionId = data.sessionId || ctx.sessionId;
        var deviceId = data.deviceId || "unknown";
        var reason = data.reason || "manual_release";
        
        logger.info("[MP Lock] Release attempt: user=" + userId + ", session=" + sessionId + ", reason=" + reason);
        
        // Read existing lock
        var existingLock = null;
        var existingVersion = null;
        
        try {
            var records = nk.storageRead([{
                collection: LOCK_COLLECTION,
                key: userId,
                userId: userId
            }]);
            
            if (records && records.length > 0 && records[0].value) {
                existingLock = records[0].value;
                existingVersion = records[0].version;
            }
        } catch (readErr) {
            logger.info("[MP Lock] No lock found to release for user: " + userId);
            return JSON.stringify({
                success: true,
                message: "No active lock to release"
            });
        }
        
        if (!existingLock) {
            return JSON.stringify({
                success: true,
                message: "No active lock to release"
            });
        }
        
        // Security: Only allow releasing own session's lock
        if (existingLock.sessionId !== sessionId) {
            logger.warn("[MP Lock] SECURITY: user=" + userId + " tried to release lock owned by different session");
            return JSON.stringify({
                success: false,
                message: "Cannot release lock owned by another session"
            });
        }
        
        // Delete the lock
        nk.storageDelete([{
            collection: LOCK_COLLECTION,
            key: userId,
            userId: userId,
            version: existingVersion
        }]);
        
        logger.info("[MP Lock] RELEASED: user=" + userId + ", session=" + sessionId + ", reason=" + reason);
        
        return JSON.stringify({
            success: true,
            message: "Multiplayer lock released successfully"
        });
        
    } catch (err) {
        logger.error("[MP Lock] Release error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: multiplayer_lock_heartbeat
 * Update heartbeat timestamp to keep lock alive
 * 
 * Payload:
 * {
 *   sessionId: string,
 *   deviceId: string
 * }
 */
var rpcMultiplayerLockHeartbeat = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId;
        var sessionId = data.sessionId || ctx.sessionId;
        
        // Read existing lock
        var existingLock = null;
        var existingVersion = null;
        
        try {
            var records = nk.storageRead([{
                collection: LOCK_COLLECTION,
                key: userId,
                userId: userId
            }]);
            
            if (records && records.length > 0 && records[0].value) {
                existingLock = records[0].value;
                existingVersion = records[0].version;
            }
        } catch (readErr) {
            return JSON.stringify({
                success: false,
                stillOwner: false,
                expired: true,
                message: "No active lock found"
            });
        }
        
        if (!existingLock) {
            return JSON.stringify({
                success: false,
                stillOwner: false,
                expired: true,
                message: "No active lock found"
            });
        }
        
        // Check if lock belongs to this session
        if (existingLock.sessionId !== sessionId) {
            return JSON.stringify({
                success: false,
                stillOwner: false,
                expired: false,
                message: "Lock is owned by another session"
            });
        }
        
        // Update heartbeat
        var now = Date.now();
        var expiresAt = now + (LOCK_TIMEOUT_SECONDS * 1000);
        
        existingLock.lastHeartbeatAt = now;
        existingLock.expiresAt = expiresAt;
        
        nk.storageWrite([{
            collection: LOCK_COLLECTION,
            key: userId,
            userId: userId,
            value: existingLock,
            version: existingVersion,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        return JSON.stringify({
            success: true,
            stillOwner: true,
            expired: false,
            expiresAt: new Date(expiresAt).toISOString()
        });
        
    } catch (err) {
        logger.error("[MP Lock] Heartbeat error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: multiplayer_lock_check
 * Check if user has active multiplayer lock
 * 
 * Payload: (empty or { sessionId: string })
 */
var rpcMultiplayerLockCheck = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId;
        var sessionId = data.sessionId || ctx.sessionId;
        
        // Read existing lock
        var existingLock = null;
        
        try {
            var records = nk.storageRead([{
                collection: LOCK_COLLECTION,
                key: userId,
                userId: userId
            }]);
            
            if (records && records.length > 0 && records[0].value) {
                existingLock = records[0].value;
            }
        } catch (readErr) {
            return JSON.stringify({
                isLocked: false,
                isCurrentSessionOwner: false
            });
        }
        
        if (!existingLock) {
            return JSON.stringify({
                isLocked: false,
                isCurrentSessionOwner: false
            });
        }
        
        // Check if expired
        var now = Date.now();
        var isExpired = now > existingLock.expiresAt;
        
        if (isExpired) {
            return JSON.stringify({
                isLocked: false,
                isCurrentSessionOwner: false,
                wasExpired: true
            });
        }
        
        var isOwner = existingLock.sessionId === sessionId;
        
        return JSON.stringify({
            isLocked: true,
            isCurrentSessionOwner: isOwner,
            provider: existingLock.provider,
            mode: existingLock.mode,
            expiresAt: new Date(existingLock.expiresAt).toISOString()
        });
        
    } catch (err) {
        logger.error("[MP Lock] Check error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

// Export functions for InitModule registration
var __rpc_multiplayer_lock_acquire;
var __rpc_multiplayer_lock_release;
var __rpc_multiplayer_lock_heartbeat;
var __rpc_multiplayer_lock_check;
