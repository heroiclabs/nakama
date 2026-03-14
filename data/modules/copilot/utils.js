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

// Global utils object for sub-modules that previously imported via ES modules
var utils = {
    validatePayload: copilotValidatePayload,
    readRegistry: copilotReadRegistry,
    handleError: copilotHandleError,
    logInfo: copilotLogInfo,
    logWarn: copilotLogWarn,
    logError: copilotLogError
};
