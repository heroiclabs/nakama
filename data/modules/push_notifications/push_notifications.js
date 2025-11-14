// push_notifications.js - Push Notification System (AWS SNS + Pinpoint + Lambda)
// Unity does NOT use AWS SDK - Unity only sends raw push tokens
// Nakama forwards to AWS Lambda Function URL for endpoint creation

import * as utils from "../copilot/utils.js";

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
        createdAt: utils.getCurrentTimestamp(),
        updatedAt: utils.getCurrentTimestamp()
    };
    
    return utils.writeStorage(nk, logger, collection, key, userId, data);
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
    utils.logInfo(logger, "RPC push_register_token called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId', 'platform', 'token']);
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
    
    var platform = data.platform;
    var token = data.token;
    
    // Validate platform
    if (!PLATFORM_TYPES[platform]) {
        return utils.handleError(ctx, null, "Invalid platform. Must be: ios, android, web, or windows");
    }
    
    utils.logInfo(logger, "Registering " + platform + " push token for user " + userId);
    
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
        utils.logError(logger, "Lambda request failed: " + err.message);
        return utils.handleError(ctx, err, "Failed to register push token with Lambda");
    }
    
    if (lambdaResponse.code !== 200 && lambdaResponse.code !== 201) {
        utils.logError(logger, "Lambda returned code " + lambdaResponse.code);
        return utils.handleError(ctx, null, "Lambda endpoint registration failed with code " + lambdaResponse.code);
    }
    
    var lambdaData;
    try {
        lambdaData = JSON.parse(lambdaResponse.body);
    } catch (err) {
        return utils.handleError(ctx, null, "Invalid Lambda response JSON");
    }
    
    if (!lambdaData.success || !lambdaData.snsEndpointArn) {
        return utils.handleError(ctx, null, "Lambda did not return endpoint ARN: " + (lambdaData.error || "Unknown error"));
    }
    
    var endpointArn = lambdaData.snsEndpointArn;
    
    // Store endpoint ARN
    if (!storeEndpointArn(nk, logger, userId, gameId, platform, endpointArn)) {
        return utils.handleError(ctx, null, "Failed to store endpoint ARN");
    }
    
    utils.logInfo(logger, "Successfully registered push endpoint: " + endpointArn);
    
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
    utils.logInfo(logger, "RPC push_send_event called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['targetUserId', 'gameId', 'eventType', 'title', 'body']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!utils.isValidUUID(gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var targetUserId = data.targetUserId;
    var eventType = data.eventType;
    var title = data.title;
    var body = data.body;
    var customData = data.data || {};
    
    utils.logInfo(logger, "Sending push notification to user " + targetUserId + " for event " + eventType);
    
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
                utils.logInfo(logger, "Push sent to " + endpoint.platform + " endpoint");
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
            utils.logWarn(logger, "Failed to send push to " + endpoint.platform + ": " + err.message);
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

// Export RPC functions (ES Module syntax)
export {
    rpcPushRegisterToken,
    rpcPushSendEvent,
    rpcPushGetEndpoints
};
