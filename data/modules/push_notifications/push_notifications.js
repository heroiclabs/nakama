// push_notifications.js - Push Notification System (AWS SNS + Pinpoint + Lambda)
// Unity does NOT use AWS SDK - Unity only sends raw push tokens
// Nakama forwards to AWS Lambda Function URL for endpoint creation

/**
 * Lambda Function URL for push endpoint registration
 * This should be configured in your environment
 */
var LAMBDA_FUNCTION_URL = process.env.PUSH_LAMBDA_URL || "https://your-lambda-url.lambda-url.region.on.aws/register-endpoint";

/**
 * Lambda Function URL for sending push notifications
 */
var LAMBDA_PUSH_URL = process.env.PUSH_SEND_URL || "https://your-lambda-url.lambda-url.region.on.aws/send-push";

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
 * Store endpoint ARN for user device.
 * Records a registeredAt timestamp so stale tokens (270d+ Android, 60d+ iOS)
 * can be detected and cleaned up on the next re-registration attempt.
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {string} platform - Platform type (ios, android, web, windows)
 * @param {string} endpointArn - SNS endpoint ARN
 * @param {string} [deviceToken] - Raw device token (optional, stored for freshness checks)
 * @returns {boolean} Success status
 */
function storeEndpointArn(nk, logger, userId, gameId, platform, endpointArn, deviceToken) {
    var collection = "push_endpoints";
    var key = "push_endpoint_" + userId + "_" + gameId + "_" + platform;
    var now = utils.getCurrentTimestamp();

    // Read existing record to preserve createdAt across token refreshes
    var existing = utils.readStorage(nk, logger, collection, key, userId);
    var createdAt = (existing && existing.createdAt) ? existing.createdAt : now;

    var data = {
        userId: userId,
        gameId: gameId,
        platform: platform,
        endpointArn: endpointArn,
        deviceToken: deviceToken || "",   // store raw token for freshness audit
        createdAt: createdAt,
        updatedAt: now,
        registeredAt: now                 // FCM best-practice: timestamp every registration
    };
    
    return utils.writeStorage(nk, logger, collection, key, userId, data);
}

/**
 * Remove a stale/invalid endpoint ARN from Nakama storage.
 * Called when FCM/SNS signals that the token is unregistered or disabled.
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {string} platform - Platform type
 */
function removeEndpointArn(nk, logger, userId, gameId, platform) {
    var collection = "push_endpoints";
    var key = "push_endpoint_" + userId + "_" + gameId + "_" + platform;
    try {
        nk.storageDelete([{ collection: collection, key: key, userId: userId }]);
        utils.logInfo(logger, "[push] Removed stale endpoint for user=" + userId + " platform=" + platform);
    } catch (err) {
        utils.logWarn(logger, "[push] Failed to remove stale endpoint: " + err.message);
    }
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
    return utils.readStorage(nk, logger, collection, key, userId);
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
        utils.logWarn(logger, "Failed to list endpoints: " + err.message);
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
    utils.logInfo(logger, "[push_register_token] ════ START ════════════════════════════════════════");
    utils.logInfo(logger, "[push_register_token] rawPayloadLen=" + (payload ? payload.length : 0));

    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        utils.logError(logger, "[push_register_token] FAIL — JSON parse error on payload: " + payload);
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId', 'platform', 'token']);
    if (!validation.valid) {
        utils.logError(logger, "[push_register_token] FAIL — missing fields: " + validation.missing.join(", "));
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!utils.isValidUUID(gameId)) {
        utils.logError(logger, "[push_register_token] FAIL — invalid gameId: " + gameId);
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        utils.logError(logger, "[push_register_token] FAIL — ctx.userId is empty (user not authenticated)");
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var platform = data.platform;
    var token = data.token;

    // Deep token diagnostics — helps distinguish FCM tokens from native APNs hex tokens
    var tokenLen = token ? token.length : 0;
    var tokenPrefix = token ? token.substring(0, Math.min(30, tokenLen)) : "(null)";
    var tokenSuffix = token && tokenLen > 30 ? token.substring(tokenLen - 10) : "";
    var looksLikeApns = token && /^[0-9a-fA-F]+$/.test(token) && (tokenLen === 64 || tokenLen === 160);
    var looksLikeFcm  = token && (token.indexOf(":") !== -1 || tokenLen > 100);
    utils.logInfo(logger, "[push_register_token] userId=" + userId + " | platform=" + platform +
        " | tokenLen=" + tokenLen + " | tokenPrefix=" + tokenPrefix + "..." + tokenSuffix +
        " | looksLikeApns=" + looksLikeApns + " | looksLikeFcm=" + looksLikeFcm);

    // Validate platform
    if (!PLATFORM_TYPES[platform]) {
        utils.logError(logger, "[push_register_token] FAIL — unknown platform='" + platform + "'. Valid: " + Object.keys(PLATFORM_TYPES).join(", "));
        return utils.handleError(ctx, null, "Invalid platform. Must be: ios, android, web, or windows");
    }

    utils.logInfo(logger, "[push_register_token] platformType=" + PLATFORM_TYPES[platform] +
        " | lambdaUrl=" + LAMBDA_FUNCTION_URL);

    // Forward fcmProjectId if the client sent it — required by send-push Lambda for FCM HTTP v1
    var fcmProjectId = data.fcmProjectId || "";
    if (!fcmProjectId) {
        utils.logWarn(logger, "[push_register_token] ⚠ fcmProjectId is EMPTY in client payload. " +
            "FCM sends to this endpoint will fail at the Lambda layer. " +
            "Fix: pass FirebaseApp.DefaultInstance.Options.ProjectId from FCMManager (see FCMManager.SetupFirebaseMessaging).");
    } else {
        utils.logInfo(logger, "[push_register_token] fcmProjectId='" + fcmProjectId + "' ✓");
    }

    // Call Lambda to create SNS endpoint
    var lambdaPayload = {
        userId: userId,
        gameId: gameId,
        platform: platform,
        platformType: PLATFORM_TYPES[platform],
        deviceToken: token,
        fcmProjectId: fcmProjectId
    };
    
    var lambdaResponse;
    try {
        utils.logInfo(logger, "[push_register_token] → calling Lambda register-endpoint...");
        lambdaResponse = nk.httpRequest(
            LAMBDA_FUNCTION_URL,
            "post",
            {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            JSON.stringify(lambdaPayload)
        );
        utils.logInfo(logger, "[push_register_token] ← Lambda responded | httpCode=" + lambdaResponse.code +
            " | bodyLen=" + (lambdaResponse.body ? lambdaResponse.body.length : 0));
    } catch (err) {
        utils.logError(logger, "[push_register_token] FAIL — Lambda HTTP call threw: " + err.message +
            " | url=" + LAMBDA_FUNCTION_URL + " | Is the Lambda URL reachable from Nakama?");
        return utils.handleError(ctx, err, "Failed to register push token with Lambda");
    }
    
    if (lambdaResponse.code !== 200 && lambdaResponse.code !== 201) {
        utils.logError(logger, "[push_register_token] FAIL — Lambda non-2xx: httpCode=" + lambdaResponse.code +
            " | body=" + lambdaResponse.body);
        return utils.handleError(ctx, null, "Lambda endpoint registration failed with code " + lambdaResponse.code);
    }
    
    var lambdaData;
    try {
        lambdaData = JSON.parse(lambdaResponse.body);
        utils.logInfo(logger, "[push_register_token] Lambda body parsed — success=" + lambdaData.success +
            " | effectiveFormat=" + (lambdaData.effectiveFormat || "?") +
            " | routedTo=" + (lambdaData.routedTo || "?") +
            " | endpointArn=" + (lambdaData.endpointArn || lambdaData.snsEndpointArn || "(missing)"));
    } catch (err) {
        utils.logError(logger, "[push_register_token] FAIL — cannot parse Lambda JSON: " + lambdaResponse.body);
        return utils.handleError(ctx, null, "Invalid Lambda response JSON");
    }

    // Lambda uses "endpointArn" (some versions use "snsEndpointArn") — normalise here.
    var endpointArn = lambdaData.endpointArn || lambdaData.snsEndpointArn || "";

    if (!lambdaData.success || !endpointArn) {
        var rawError = lambdaData.error
            || (lambdaData.provider && lambdaData.provider.error)
            || "";

        utils.logWarn(logger, "[push_register_token] Lambda returned success=false or no ARN | error='" + rawError +
            "' | Attempting SNS duplicate-endpoint ARN extraction...");

        var arnPattern = /arn:aws:sns:[a-z0-9\-]+:\d+:endpoint\/[A-Za-z0-9\-_\/]+/;
        var arnMatch = rawError.match(arnPattern);

        if (arnMatch && rawError.indexOf("already exists") !== -1) {
            endpointArn = arnMatch[0];
            utils.logInfo(logger, "[push_register_token] SNS duplicate endpoint recovered — reusing ARN: " + endpointArn);
        } else {
            utils.logError(logger, "[push_register_token] FAIL — no usable ARN. error='" + rawError + "'" +
                " | Possible causes: (1) SNS Platform App ARN wrong in Lambda env vars" +
                " (2) iOS: APNs .p8 key not uploaded in SNS Platform App" +
                " (3) Android: FCM server key not uploaded in SNS GCM Platform App" +
                " (4) Token format mismatch (FCM token sent to APNS platform app)");
            return utils.handleError(ctx, null, "Lambda did not return endpoint ARN: " + (rawError || "Unknown error"));
        }
    }

    // Validate ARN shape before storing
    if (endpointArn.indexOf("arn:aws:sns:") !== 0) {
        utils.logError(logger, "[push_register_token] FAIL — endpointArn looks wrong: " + endpointArn +
            " | Expected format: arn:aws:sns:{region}:{accountId}:endpoint/{type}/{appName}/{uuid}");
        return utils.handleError(ctx, null, "Malformed endpoint ARN from Lambda");
    }
    var arnSegment = endpointArn.split(":endpoint/")[1] || "";
    utils.logInfo(logger, "[push_register_token] ARN platform segment: " + (arnSegment.split("/")[0] || "?") +
        " | Full ARN: " + endpointArn);

    // Store endpoint ARN — also persists the raw token and a registeredAt timestamp
    if (!storeEndpointArn(nk, logger, userId, gameId, platform, endpointArn, token)) {
        utils.logError(logger, "[push_register_token] FAIL — Nakama storageWrite rejected. Check Nakama DB permissions.");
        return utils.handleError(ctx, null, "Failed to store endpoint ARN");
    }
    
    utils.logInfo(logger, "[push_register_token] *** SUCCESS *** userId=" + userId +
        " | platform=" + platform + " | ARN=" + endpointArn + " | tokenLen=" + tokenLen);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        platform: platform,
        endpointArn: endpointArn,
        registeredAt: utils.getCurrentTimestamp()
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
    utils.logInfo(logger, "[push_send_event] ════ START ══════════════════════════════════════════");

    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        utils.logError(logger, "[push_send_event] FAIL — JSON parse error on payload: " + payload);
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    // Accept both "targetUserId" (server→server) and "userId" (Unity client SDK).
    data.targetUserId = data.targetUserId || data.userId;
    var validation = utils.validatePayload(data, ['targetUserId', 'gameId', 'eventType', 'title', 'body']);
    if (!validation.valid) {
        utils.logError(logger, "[push_send_event] FAIL — missing fields: " + validation.missing.join(", "));
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!utils.isValidUUID(gameId)) {
        utils.logError(logger, "[push_send_event] FAIL — invalid gameId: " + gameId);
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var targetUserId = data.targetUserId;
    var eventType = data.eventType;
    var title = data.title;
    var body = data.body;
    var customData = data.data || {};

    utils.logInfo(logger, "[push_send_event] targetUserId=" + targetUserId +
        " | eventType=" + eventType + " | title='" + title + "'" +
        " | callerUserId=" + (ctx.userId || "system") +
        " | lambdaUrl=" + LAMBDA_PUSH_URL);
    
    // Get all endpoints for target user
    var endpoints = getAllEndpointArns(nk, logger, targetUserId, gameId);

    utils.logInfo(logger, "[push_send_event] endpoints found=" + endpoints.length +
        " | gameId=" + gameId);

    if (endpoints.length === 0) {
        utils.logWarn(logger, "[push_send_event] NO endpoints registered for user=" + targetUserId +
            " | gameId=" + gameId +
            " | Cause: user never launched app, Firebase token never received, or push_register_token never called." +
            " | Check FCMManager logs on client side for [FCM:Token] and [FCM:Register] entries.");
        return JSON.stringify({
            success: false,
            error: "No registered push endpoints for user"
        });
    }

    for (var j = 0; j < endpoints.length; j++) {
        var ep = endpoints[j];
        utils.logInfo(logger, "[push_send_event] endpoint[" + j + "] platform=" + ep.platform +
            " | arn=" + (ep.endpointArn || "(missing)") +
            " | registeredAt=" + (ep.registeredAt || "unknown") +
            " | tokenLen=" + (ep.deviceToken ? ep.deviceToken.length : "?"));
    }
    
    var sentCount = 0;
    var errors = [];
    
    // Send to each endpoint
    for (var i = 0; i < endpoints.length; i++) {
        var endpoint = endpoints[i];

        utils.logInfo(logger, "[push_send_event] → sending to endpoint[" + i + "] platform=" + endpoint.platform +
            " | arn=" + endpoint.endpointArn);
        
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

            utils.logInfo(logger, "[push_send_event] ← Lambda responded | platform=" + endpoint.platform +
                " | httpCode=" + lambdaResponse.code +
                " | body=" + lambdaResponse.body);
            
            if (lambdaResponse.code === 200 || lambdaResponse.code === 201) {
                sentCount++;
                utils.logInfo(logger, "[push_send_event] ✓ DELIVERED platform=" + endpoint.platform +
                    " | arn=" + endpoint.endpointArn);
            } else {
                // Parse Lambda error body to detect unregistered / disabled tokens.
                // FCM returns UNREGISTERED / INVALID_ARGUMENT / NOT_FOUND for dead Android tokens.
                // SNS returns EndpointDisabledException for disabled iOS APNS endpoints.
                // In both cases we remove the stale endpoint from storage so future sends
                // don't keep hitting the same dead ARN.
                var lambdaBody = {};
                try { lambdaBody = JSON.parse(lambdaResponse.body); } catch (_) {}

                var deadTokenCodes = ["UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND",
                                      "ENDPOINT_DISABLED", "ENDPOINT_TOKEN_MISSING"];
                var isDeadToken = lambdaBody.shouldRemoveToken === true
                    || (lambdaBody.code && deadTokenCodes.indexOf(lambdaBody.code) !== -1)
                    || lambdaResponse.code === 410; // HTTP 410 Gone = unregistered

                if (isDeadToken) {
                    utils.logWarn(logger, "[push_send_event] ✗ DEAD TOKEN platform=" + endpoint.platform +
                        " | httpCode=" + lambdaResponse.code +
                        " | code=" + (lambdaBody.code || "?") +
                        " | shouldRemoveToken=" + lambdaBody.shouldRemoveToken +
                        " | error='" + (lambdaBody.error || "") + "'" +
                        " | arn=" + endpoint.endpointArn +
                        " | ACTION: removing from Nakama storage. Re-register on next app launch.");
                    removeEndpointArn(nk, logger, targetUserId, gameId, endpoint.platform);
                    errors.push({
                        platform: endpoint.platform,
                        error: "Dead token — endpoint removed: " + (lambdaBody.error || lambdaBody.code || "unknown"),
                        code: lambdaBody.code || "DEAD_TOKEN",
                        endpointRemoved: true
                    });
                } else {
                    utils.logError(logger, "[push_send_event] ✗ FAILED platform=" + endpoint.platform +
                        " | httpCode=" + lambdaResponse.code +
                        " | code=" + (lambdaBody.code || "?") +
                        " | error='" + (lambdaBody.error || "") + "'" +
                        " | provider=" + (lambdaBody.provider || "?") +
                        " | arn=" + endpoint.endpointArn +
                        " | Possible causes: Lambda timeout, SNS quota, bad ARN, network issue");
                    errors.push({
                        platform: endpoint.platform,
                        error: "Lambda returned code " + lambdaResponse.code + ": " + (lambdaBody.error || "")
                    });
                }
            }
        } catch (err) {
            utils.logError(logger, "[push_send_event] ✗ EXCEPTION platform=" + endpoint.platform +
                " | err=" + err.message +
                " | arn=" + endpoint.endpointArn +
                " | Cause: Lambda URL unreachable, Nakama outbound HTTP blocked, or timeout");
            errors.push({
                platform: endpoint.platform,
                error: err.message
            });
        }
    }

    var summary = "[push_send_event] ════ DONE" +
        " | sentCount=" + sentCount + "/" + endpoints.length +
        " | eventType=" + eventType +
        " | targetUserId=" + targetUserId +
        " | errors=" + errors.length;
    if (errors.length > 0) {
        utils.logWarn(logger, summary + " | errorDetails=" + JSON.stringify(errors));
    } else {
        utils.logInfo(logger, summary);
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
        timestamp: utils.getCurrentTimestamp()
    };
    
    var logKey = "push_log_" + targetUserId + "_" + utils.getUnixTimestamp();
    utils.writeStorage(nk, logger, "push_notification_logs", logKey, targetUserId, notificationLog);
    
    return JSON.stringify({
        success: sentCount > 0,
        targetUserId: targetUserId,
        gameId: gameId,
        eventType: eventType,
        sentCount: sentCount,
        totalEndpoints: endpoints.length,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: utils.getCurrentTimestamp()
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
    utils.logInfo(logger, "RPC push_get_endpoints called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!utils.isValidUUID(gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var endpoints = getAllEndpointArns(nk, logger, userId, gameId);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        endpoints: endpoints,
        count: endpoints.length,
        timestamp: utils.getCurrentTimestamp()
    });
}
