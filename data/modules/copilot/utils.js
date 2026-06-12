// utils.js - Shared helper functions for copilot leaderboard modules
// ES5 compatible for Nakama goja runtime

function copilotValidatePayload(payload, fields) {
    var missing = [];
    for (var i = 0; i < fields.length; i++) {
        if (!payload.hasOwnProperty(fields[i]) || payload[fields[i]] === null || payload[fields[i]] === undefined) {
            missing.push(fields[i]);
        }
    }
    return {
        valid: missing.length === 0,
        missing: missing
    };
}

function copilotReadRegistry(nk, logger) {
    var collection = "leaderboards_registry";
    try {
        var records = nk.storageRead([{
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

function copilotHandleError(ctx, err, message) {
    return JSON.stringify({
        success: false,
        error: message
    });
}

function copilotLogInfo(logger, msg) {
    logger.info("[Copilot] " + msg);
}

function copilotLogWarn(logger, msg) {
    logger.warn("[Copilot] " + msg);
}

function copilotLogError(logger, msg) {
    logger.error("[Copilot] " + msg);
}

// Global utils object for sub-modules that previously imported via ES modules.
// Analytics, friends, wallet, quiz_results, push_notifications, daily_missions,
// daily_rewards modules call utils.<fn>() and expect the legacy_runtime.js
// helpers (safeJsonParse, isValidUUID, getUnixTimestamp, etc.) to be available
// here. Those helpers are function declarations in legacy_runtime.js and are
// hoisted globally, so referencing them at this point in the bundle is safe.
var utils = {
    // Copilot helpers (kept for leaderboard sub-modules)
    validatePayload: typeof copilotValidatePayload === 'function' ? copilotValidatePayload : null,
    readRegistry: typeof copilotReadRegistry === 'function' ? copilotReadRegistry : null,

    // Logging helpers — prefer legacy_runtime versions if present, otherwise copilot fallbacks
    handleError: typeof handleError === 'function' ? handleError : copilotHandleError,
    logInfo: typeof logInfo === 'function' ? logInfo : copilotLogInfo,
    logWarn: typeof logWarn === 'function' ? logWarn : copilotLogWarn,
    logWarning: typeof logWarn === 'function' ? logWarn : copilotLogWarn,
    logError: typeof logError === 'function' ? logError : copilotLogError,

    // Analytics / shared helpers from legacy_runtime.js (hoisted function decls)
    safeJsonParse: typeof safeJsonParse === 'function' ? safeJsonParse : null,
    isValidUUID: typeof isValidUUID === 'function' ? isValidUUID : null,
    getUnixTimestamp: typeof getUnixTimestamp === 'function' ? getUnixTimestamp : null,
    getCurrentTimestamp: typeof getCurrentTimestamp === 'function' ? getCurrentTimestamp : null,
    getStartOfDay: typeof getStartOfDay === 'function' ? getStartOfDay : null,
    // QVBF_51: daily_rewards.js calls utils.isWithinHours() in updateStreakStatus().
    // This key was missing, so the modern daily-rewards handlers threw at runtime.
    isWithinHours: typeof isWithinHours === 'function' ? isWithinHours : null,
    makeGameStorageKey: typeof makeGameStorageKey === 'function' ? makeGameStorageKey : null,
    readStorage: typeof readStorage === 'function' ? readStorage : null,
    writeStorage: typeof writeStorage === 'function' ? writeStorage : null
};
