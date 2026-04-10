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
    
    // Create challenge
    var challengeId = "challenge_" + userId + "_" + friendUserId + "_" + utils.getUnixTimestamp();
    var challenge = {
        challengeId: challengeId,
        fromUserId: userId,
        toUserId: friendUserId,
        gameId: gameId,
        challengeData: challengeData,
        status: "pending",
        createdAt: utils.getCurrentTimestamp()
    };
    
    // Store challenge
    var collection = "challenges";
    if (!utils.writeStorage(nk, logger, collection, challengeId, userId, challenge)) {
        return utils.handleError(ctx, null, "Failed to create challenge");
    }
    
    // Send notification to friend using batch API
    try {
        var notifications = [{
            userId: friendUserId,
            subject: "Friend Challenge",
            content: JSON.stringify({
                type: "friend_challenge",
                challengeId: challengeId,
                fromUserId: userId,
                gameId: gameId
            }),
            code: 100,
            persistent: true
        }];
        nk.notificationsSend(notifications);
    } catch (err) {
        utils.logWarn(logger, "Failed to send challenge notification: " + err.message);
    }
    
    return JSON.stringify({
        success: true,
        challengeId: challengeId,
        fromUserId: userId,
        toUserId: friendUserId,
        gameId: gameId,
        status: "pending",
        timestamp: utils.getCurrentTimestamp()
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
