// friends.js - Production-Ready Friend System
// Hardened: friendship verification, rate limiting, UUID validation, block enforcement

/**
 * UUID v4 format validation
 * @param {string} id - String to validate
 * @returns {boolean}
 */
function isValidFriendUUID(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Check if targetUserId is blocked by userId
 * @param {object} nk - Nakama runtime
 * @param {string} userId - Caller user ID
 * @param {string} targetUserId - Target to check
 * @returns {boolean} true if blocked
 */
function isUserBlocked(nk, userId, targetUserId) {
    try {
        // Check custom block storage
        var results = nk.storageRead([{
            collection: "user_blocks",
            key: "blocked_" + userId + "_" + targetUserId,
            userId: userId
        }]);
        if (results.length > 0) return true;

        // Also check Nakama built-in friends with state=3 (blocked)
        var friendsList = nk.friendsList(userId, 100, 3, null);
        if (friendsList && friendsList.friends) {
            for (var i = 0; i < friendsList.friends.length; i++) {
                if (friendsList.friends[i].user.id === targetUserId) return true;
            }
        }
    } catch (err) {
        // If we can't check, assume not blocked (fail open for reads)
    }
    return false;
}

/**
 * Check if two users are actually friends (state=0 mutual)
 * @param {object} nk - Nakama runtime
 * @param {string} userId - Caller
 * @param {string} targetUserId - Target
 * @returns {boolean}
 */
function areActualFriends(nk, userId, targetUserId) {
    try {
        var friendsList = nk.friendsList(userId, 1000, 0, null);
        if (friendsList && friendsList.friends) {
            for (var i = 0; i < friendsList.friends.length; i++) {
                if (friendsList.friends[i].user.id === targetUserId) return true;
            }
        }
    } catch (err) {
        // Fail closed — if we can't verify, deny
    }
    return false;
}

/**
 * Simple per-user rate limiter using storage
 * @param {object} nk - Nakama runtime
 * @param {string} userId - User to check
 * @param {string} action - Action key (e.g. "challenge")
 * @param {number} cooldownMs - Cooldown in milliseconds
 * @returns {object} { allowed: boolean, retryAfterMs: number }
 */
function checkRateLimit(nk, userId, action, cooldownMs) {
    var key = "ratelimit_" + action + "_" + userId;
    var now = Date.now();
    try {
        var results = nk.storageRead([{
            collection: "rate_limits",
            key: key,
            userId: userId
        }]);
        if (results.length > 0) {
            var lastCall = results[0].value.timestamp || 0;
            var elapsed = now - lastCall;
            if (elapsed < cooldownMs) {
                return { allowed: false, retryAfterMs: cooldownMs - elapsed };
            }
        }
    } catch (err) {
        // If rate limit check fails, allow the action
    }
    // Update timestamp
    try {
        nk.storageWrite([{
            collection: "rate_limits",
            key: key,
            userId: userId,
            value: { timestamp: now },
            permissionRead: 0,
            permissionWrite: 0
        }]);
    } catch (err) {
        // Non-critical
    }
    return { allowed: true, retryAfterMs: 0 };
}

/**
 * RPC: Block user
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { targetUserId: "uuid" }
 * @returns {string} JSON response
 */
function rpcFriendsBlock(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC friends_block called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['targetUserId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var targetUserId = data.targetUserId;

    // Validate UUID format
    if (!isValidFriendUUID(targetUserId)) {
        return utils.handleError(ctx, null, "Invalid targetUserId format");
    }

    // Cannot block yourself
    if (targetUserId === userId) {
        return utils.handleError(ctx, null, "Cannot block yourself");
    }
    
    // Store block relationship
    var collection = "user_blocks";
    var key = "blocked_" + userId + "_" + targetUserId;
    var blockData = {
        userId: userId,
        blockedUserId: targetUserId,
        blockedAt: utils.getCurrentTimestamp()
    };
    
    if (!utils.writeStorage(nk, logger, collection, key, userId, blockData)) {
        return utils.handleError(ctx, null, "Failed to block user");
    }
    
    // Remove from friends if exists (both directions)
    try {
        nk.friendsDelete(userId, [targetUserId]);
    } catch (err) {
        utils.logWarn(logger, "Could not remove friend relationship: " + err.message);
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
    utils.logInfo(logger, "RPC friends_unblock called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['targetUserId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var targetUserId = data.targetUserId;

    // Validate UUID format
    if (!isValidFriendUUID(targetUserId)) {
        return utils.handleError(ctx, null, "Invalid targetUserId format");
    }
    
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
        utils.logWarn(logger, "Failed to unblock user: " + err.message);
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        unblockedUserId: targetUserId,
        unblockedAt: utils.getCurrentTimestamp()
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
    utils.logInfo(logger, "RPC friends_remove called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['friendUserId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var friendUserId = data.friendUserId;

    // Validate UUID format
    if (!isValidFriendUUID(friendUserId)) {
        return utils.handleError(ctx, null, "Invalid friendUserId format");
    }
    
    try {
        nk.friendsDelete(userId, [friendUserId]);
    } catch (err) {
        return utils.handleError(ctx, err, "Failed to remove friend");
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        removedFriendUserId: friendUserId,
        removedAt: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: List friends
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with optional { limit: 100, cursor: "", stateFilter: null }
 * @returns {string} JSON response
 */
function rpcFriendsList(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC friends_list called");
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var limit = 100;
    var cursor = null;
    var stateFilter = null;
    if (payload) {
        var parsed = utils.safeJsonParse(payload);
        if (parsed.success) {
            if (parsed.data.limit) {
                limit = Math.min(Math.max(parseInt(parsed.data.limit) || 100, 1), 500);
            }
            if (parsed.data.cursor) {
                cursor = parsed.data.cursor;
            }
            if (parsed.data.stateFilter !== undefined && parsed.data.stateFilter !== null) {
                stateFilter = parseInt(parsed.data.stateFilter);
                if (isNaN(stateFilter) || stateFilter < 0 || stateFilter > 3) {
                    stateFilter = null;
                }
            }
        }
    }
    
    var friends = [];
    var nextCursor = null;
    try {
        var friendsList = nk.friendsList(userId, limit, stateFilter, cursor);
        nextCursor = friendsList.cursor || null;
        for (var i = 0; i < friendsList.friends.length; i++) {
            var friend = friendsList.friends[i];
            friends.push({
                userId: friend.user.id,
                username: friend.user.username,
                displayName: friend.user.displayName,
                avatarUrl: friend.user.avatarUrl || "",
                online: friend.user.online,
                state: friend.state
            });
        }
    } catch (err) {
        return utils.handleError(ctx, err, "Failed to list friends");
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        friends: friends,
        count: friends.length,
        cursor: nextCursor,
        timestamp: utils.getCurrentTimestamp()
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
    utils.logInfo(logger, "RPC friends_challenge_user called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['friendUserId', 'gameId']);
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
    
    var friendUserId = data.friendUserId;

    // Validate friendUserId UUID format
    if (!isValidFriendUUID(friendUserId)) {
        return utils.handleError(ctx, null, "Invalid friendUserId UUID format");
    }

    // Cannot challenge yourself
    if (friendUserId === userId) {
        return utils.handleError(ctx, null, "Cannot challenge yourself");
    }

    // Rate limit: 1 challenge per 30 seconds
    var rateCheck = checkRateLimit(nk, userId, "challenge", 30000);
    if (!rateCheck.allowed) {
        return JSON.stringify({
            success: false,
            error: "Please wait before sending another challenge",
            retryAfterMs: rateCheck.retryAfterMs
        });
    }

    // Verify they are actually friends (state=0 mutual)
    if (!areActualFriends(nk, userId, friendUserId)) {
        return utils.handleError(ctx, null, "You can only challenge mutual friends");
    }

    // Check if target has blocked the caller
    if (isUserBlocked(nk, friendUserId, userId)) {
        // Don't reveal the block — generic message
        return utils.handleError(ctx, null, "Unable to send challenge at this time");
    }

    // Validate challengeData size (max 4KB to prevent abuse)
    var challengeData = data.challengeData || {};
    var challengeDataStr = JSON.stringify(challengeData);
    if (challengeDataStr.length > 4096) {
        return utils.handleError(ctx, null, "Challenge data too large (max 4KB)");
    }

    // Get challenger's display name for notifications
    var challengerName = "A friend";
    try {
        var users = nk.usersGetId([userId]);
        if (users && users.length > 0) {
            challengerName = users[0].displayName || users[0].username || "A friend";
        }
    } catch (err) {
        utils.logWarn(logger, "Could not fetch challenger display name: " + err.message);
    }

    // Extract room code / share code from challengeData for auto-join
    var roomCode = challengeData.roomCode || challengeData.shareCode || "";
    var quizModeName = challengeData.quizModeName || challengeData.modeName || "Quiz";
    var isAsync = challengeData.isAsync !== undefined ? challengeData.isAsync : false;
    var expiresAt = challengeData.expiresAt || (Date.now() + 24 * 60 * 60 * 1000); // 24h default

    // Create challenge
    var challengeId = "challenge_" + userId + "_" + friendUserId + "_" + utils.getUnixTimestamp();
    var challenge = {
        challengeId: challengeId,
        fromUserId: userId,
        fromDisplayName: challengerName,
        toUserId: friendUserId,
        gameId: gameId,
        roomCode: roomCode,
        quizModeName: quizModeName,
        isAsync: isAsync,
        expiresAt: expiresAt,
        challengeData: challengeData,
        status: "pending",
        createdAt: utils.getCurrentTimestamp()
    };
    
    // Store challenge
    var collection = "challenges";
    if (!utils.writeStorage(nk, logger, collection, challengeId, userId, challenge)) {
        return utils.handleError(ctx, null, "Failed to create challenge");
    }

    // Notification content for in-app, push, and chat
    var notificationContent = {
        type: "friend_challenge",
        challengeId: challengeId,
        fromUserId: userId,
        fromDisplayName: challengerName,
        gameId: gameId,
        roomCode: roomCode,
        shareCode: roomCode,
        quizModeName: quizModeName,
        isAsync: isAsync,
        expiresAt: expiresAt
    };
    
    // 1. Send in-app notification to friend
    try {
        nk.notificationsSend([{
            userId: friendUserId,
            subject: "Friend Challenge",
            content: JSON.stringify(notificationContent),
            code: 100,
            persistent: true
        }]);
        utils.logInfo(logger, "In-app notification sent for challenge " + challengeId);
    } catch (err) {
        utils.logWarn(logger, "Failed to send challenge notification: " + err.message);
    }

    // 2. Send push notification (for when app is closed/background)
    try {
        sendChallengePushNotification(nk, logger, friendUserId, gameId, challengerName, quizModeName, challengeId, roomCode, isAsync);
    } catch (pushErr) {
        utils.logWarn(logger, "Push notification failed: " + pushErr.message);
    }

    // 3. Send challenge as chat message (so it appears in conversation)
    try {
        sendChallengeChatMessage(nk, logger, userId, friendUserId, challengerName, notificationContent);
    } catch (chatErr) {
        utils.logWarn(logger, "Chat message failed: " + chatErr.message);
    }
    
    return JSON.stringify({
        success: true,
        challengeId: challengeId,
        fromUserId: userId,
        fromDisplayName: challengerName,
        toUserId: friendUserId,
        gameId: gameId,
        roomCode: roomCode,
        quizModeName: quizModeName,
        isAsync: isAsync,
        status: "pending",
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * Send push notification for friend challenge
 * Calls the push notification Lambda endpoint
 */
function sendChallengePushNotification(nk, logger, targetUserId, gameId, challengerName, quizModeName, challengeId, roomCode, isAsync) {
    var LAMBDA_PUSH_URL = process.env.PUSH_SEND_URL || "https://your-lambda-url.lambda-url.region.on.aws/send-push";

    // Get all push endpoints for target user
    var endpoints = [];
    try {
        var records = nk.storageList(targetUserId, "push_endpoints", 100);
        for (var i = 0; i < records.length; i++) {
            var value = records[i].value;
            if (value.gameId === gameId) {
                endpoints.push(value);
            }
        }
    } catch (err) {
        utils.logWarn(logger, "Could not list push endpoints: " + err.message);
        return;
    }

    if (endpoints.length === 0) {
        utils.logInfo(logger, "No push endpoints for user " + targetUserId);
        return;
    }

    var challengeType = isAsync ? "Async Challenge" : "Live Challenge";
    var title = "🎮 " + challengerName + " challenged you!";
    var body = "Accept the " + quizModeName + " " + challengeType + " now!";

    for (var j = 0; j < endpoints.length; j++) {
        var endpoint = endpoints[j];

        var pushPayload = {
            endpointArn: endpoint.endpointArn,
            platform: endpoint.platform,
            title: title,
            body: body,
            data: {
                type: "friend_challenge",
                challengeId: challengeId,
                roomCode: roomCode,
                isAsync: isAsync,
                click_action: "OPEN_CHALLENGE"
            },
            gameId: gameId,
            eventType: "friend_challenge"
        };

        try {
            var response = nk.httpRequest(
                LAMBDA_PUSH_URL,
                "post",
                { "Content-Type": "application/json", "Accept": "application/json" },
                JSON.stringify(pushPayload)
            );
            if (response.code === 200 || response.code === 201) {
                utils.logInfo(logger, "Push sent to " + endpoint.platform + " for challenge " + challengeId);
            }
        } catch (pushErr) {
            utils.logWarn(logger, "Push to " + endpoint.platform + " failed: " + pushErr.message);
        }
    }
}

/**
 * Send challenge as a chat message so it appears in the conversation
 */
function sendChallengeChatMessage(nk, logger, senderId, receiverId, senderName, challengeData) {
    // Create or get DM channel between the two users
    var channelId = null;
    try {
        // Sort user IDs to create consistent channel ID
        var sortedIds = [senderId, receiverId].sort();
        channelId = "dm_" + sortedIds[0] + "_" + sortedIds[1];
    } catch (err) {
        utils.logWarn(logger, "Could not create channel ID: " + err.message);
        return;
    }

    // Build challenge message content
    var messageContent = {
        type: "friend_challenge",
        text: "🎮 " + senderName + " challenged you to " + challengeData.quizModeName + "!",
        challenge: {
            challengeId: challengeData.challengeId,
            roomCode: challengeData.roomCode,
            shareCode: challengeData.roomCode,
            quizModeName: challengeData.quizModeName,
            isAsync: challengeData.isAsync,
            fromUserId: challengeData.fromUserId,
            fromDisplayName: challengeData.fromDisplayName,
            expiresAt: challengeData.expiresAt,
            status: "pending"
        }
    };

    try {
        // Use channel message write to insert challenge as a special message
        nk.channelMessageSend(
            channelId,
            JSON.stringify(messageContent),
            senderId,
            senderName,
            true  // persistent
        );
        utils.logInfo(logger, "Challenge chat message sent to channel " + channelId);
    } catch (chatErr) {
        // Fallback: Write to storage-based chat if channel doesn't exist
        utils.logWarn(logger, "Channel message failed, using storage fallback: " + chatErr.message);
        
        // Store as pending chat message  
        var msgKey = "pending_chat_" + receiverId + "_" + Date.now();
        utils.writeStorage(nk, logger, "pending_chat_messages", msgKey, senderId, {
            senderId: senderId,
            senderName: senderName,
            receiverId: receiverId,
            content: messageContent,
            timestamp: utils.getCurrentTimestamp()
        });
    }
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
    utils.logInfo(logger, "RPC friends_spectate called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['friendUserId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var friendUserId = data.friendUserId;

    // Validate UUID format
    if (!isValidFriendUUID(friendUserId)) {
        return utils.handleError(ctx, null, "Invalid friendUserId format");
    }

    // Verify actually friends
    if (!areActualFriends(nk, userId, friendUserId)) {
        return utils.handleError(ctx, null, "You can only spectate friends");
    }
    
    // Try to find friend's active match via stream presences
    var matchId = null;
    try {
        // Use status follow to check online status
        var accounts = nk.usersGetId([friendUserId]);
        if (!accounts || accounts.length === 0 || !accounts[0].online) {
            return JSON.stringify({
                success: false,
                error: "Friend is not currently online"
            });
        }

        // Check if friend has a stored active match
        var matchResults = nk.storageRead([{
            collection: "active_matches",
            key: "current_match",
            userId: friendUserId
        }]);
        if (matchResults.length > 0 && matchResults[0].value.matchId) {
            matchId = matchResults[0].value.matchId;
        }
    } catch (err) {
        return utils.handleError(ctx, err, "Failed to get friend status");
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
        timestamp: utils.getCurrentTimestamp()
    });
}
