// social_features.js - Social graph and notification features

// Import utils
import * as utils from './utils.js';

/**
 * RPC: send_friend_invite
 * Sends a friend invite to another user
 */
function sendFriendInvite(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return utils.handleError(ctx, null, "Authentication required");
        }

        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return utils.handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = utils.validatePayload(data, ['targetUserId']);
        if (!validation.valid) {
            return utils.handleError(ctx, null, "Missing required field: targetUserId");
        }

        const fromUserId = ctx.userId;
        const fromUsername = ctx.username || fromUserId;
        const targetUserId = data.targetUserId;
        const message = data.message || "You have a new friend request";

        utils.logInfo(logger, "User " + fromUsername + " sending friend invite to " + targetUserId);

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
            utils.logInfo(logger, "Friend invite stored: " + inviteId);
        } catch (err) {
            utils.logError(logger, "Failed to store friend invite: " + err.message);
            return utils.handleError(ctx, err, "Failed to store friend invite");
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
            utils.logInfo(logger, "Notification sent to " + targetUserId);
        } catch (err) {
            utils.logError(logger, "Failed to send notification: " + err.message);
            // Don't fail the whole operation if notification fails
        }

        return JSON.stringify({
            success: true,
            inviteId: inviteId,
            targetUserId: targetUserId,
            status: "sent"
        });

    } catch (err) {
        utils.logError(logger, "Error in sendFriendInvite: " + err.message);
        return utils.handleError(ctx, err, "An error occurred while sending friend invite");
    }
}

/**
 * RPC: accept_friend_invite
 * Accepts a friend invite
 */
function acceptFriendInvite(ctx, logger, nk, payload) {
    const validatePayload = utils ? utils.validatePayload : function(p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? utils.logInfo : function(l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? utils.logError : function(l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? utils.handleError : function(c, e, m) { 
        return JSON.stringify({ success: false, error: m }); 
    };

    try {
        if (!ctx.userId) {
            return utils.handleError(ctx, null, "Authentication required");
        }

        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return utils.handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = utils.validatePayload(data, ['inviteId']);
        if (!validation.valid) {
            return utils.handleError(ctx, null, "Missing required field: inviteId");
        }

        const userId = ctx.userId;
        const inviteId = data.inviteId;

        utils.logInfo(logger, "User " + userId + " accepting friend invite " + inviteId);

        // Read invite from storage
        let inviteData;
        try {
            const records = nk.storageRead([{
                collection: "friend_invites",
                key: inviteId,
                userId: userId
            }]);
            
            if (!records || records.length === 0) {
                return utils.handleError(ctx, null, "Friend invite not found");
            }
            
            inviteData = records[0].value;
        } catch (err) {
            utils.logError(logger, "Failed to read invite: " + err.message);
            return utils.handleError(ctx, err, "Failed to retrieve friend invite");
        }

        // Verify invite is for this user and is pending
        if (inviteData.targetUserId !== userId) {
            return utils.handleError(ctx, null, "This invite is not for you");
        }

        if (inviteData.status !== "pending") {
            return utils.handleError(ctx, null, "This invite has already been processed");
        }

        // Add friend using Nakama's built-in friend system
        try {
            nk.friendsAdd(userId, [inviteData.fromUserId], [inviteData.fromUsername]);
            utils.logInfo(logger, "Friend added: " + inviteData.fromUserId);
        } catch (err) {
            utils.logError(logger, "Failed to add friend: " + err.message);
            return utils.handleError(ctx, err, "Failed to add friend");
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
            utils.logError(logger, "Failed to update invite status: " + err.message);
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
            utils.logError(logger, "Failed to send notification to sender: " + err.message);
        }

        return JSON.stringify({
            success: true,
            inviteId: inviteId,
            friendUserId: inviteData.fromUserId,
            friendUsername: inviteData.fromUsername
        });

    } catch (err) {
        utils.logError(logger, "Error in acceptFriendInvite: " + err.message);
        return utils.handleError(ctx, err, "An error occurred while accepting friend invite");
    }
}

/**
 * RPC: decline_friend_invite
 * Declines a friend invite
 */
function declineFriendInvite(ctx, logger, nk, payload) {
    const validatePayload = utils ? utils.validatePayload : function(p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? utils.logInfo : function(l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? utils.logError : function(l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? utils.handleError : function(c, e, m) { 
        return JSON.stringify({ success: false, error: m }); 
    };

    try {
        if (!ctx.userId) {
            return utils.handleError(ctx, null, "Authentication required");
        }

        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return utils.handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = utils.validatePayload(data, ['inviteId']);
        if (!validation.valid) {
            return utils.handleError(ctx, null, "Missing required field: inviteId");
        }

        const userId = ctx.userId;
        const inviteId = data.inviteId;

        utils.logInfo(logger, "User " + userId + " declining friend invite " + inviteId);

        // Read invite from storage
        let inviteData;
        try {
            const records = nk.storageRead([{
                collection: "friend_invites",
                key: inviteId,
                userId: userId
            }]);
            
            if (!records || records.length === 0) {
                return utils.handleError(ctx, null, "Friend invite not found");
            }
            
            inviteData = records[0].value;
        } catch (err) {
            utils.logError(logger, "Failed to read invite: " + err.message);
            return utils.handleError(ctx, err, "Failed to retrieve friend invite");
        }

        // Verify invite is for this user and is pending
        if (inviteData.targetUserId !== userId) {
            return utils.handleError(ctx, null, "This invite is not for you");
        }

        if (inviteData.status !== "pending") {
            return utils.handleError(ctx, null, "This invite has already been processed");
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
            utils.logInfo(logger, "Friend invite declined: " + inviteId);
        } catch (err) {
            utils.logError(logger, "Failed to update invite status: " + err.message);
            return utils.handleError(ctx, err, "Failed to decline friend invite");
        }

        return JSON.stringify({
            success: true,
            inviteId: inviteId,
            status: "declined"
        });

    } catch (err) {
        utils.logError(logger, "Error in declineFriendInvite: " + err.message);
        return utils.handleError(ctx, err, "An error occurred while declining friend invite");
    }
}

/**
 * RPC: get_notifications
 * Retrieves notifications for the user
 */
function getNotifications(ctx, logger, nk, payload) {
    const logInfo = utils ? utils.logInfo : function(l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? utils.logError : function(l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? utils.handleError : function(c, e, m) { 
        return JSON.stringify({ success: false, error: m }); 
    };

    try {
        if (!ctx.userId) {
            return utils.handleError(ctx, null, "Authentication required");
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

        utils.logInfo(logger, "Getting notifications for user " + userId);

        // Get notifications using Nakama's built-in system
        let notifications = [];
        try {
            const result = nk.notificationsList(userId, limit, null);
            if (result && result.notifications) {
                notifications = result.notifications;
            }
            utils.logInfo(logger, "Retrieved " + notifications.length + " notifications");
        } catch (err) {
            utils.logError(logger, "Failed to retrieve notifications: " + err.message);
            return utils.handleError(ctx, err, "Failed to retrieve notifications");
        }

        return JSON.stringify({
            success: true,
            notifications: notifications,
            count: notifications.length
        });

    } catch (err) {
        utils.logError(logger, "Error in getNotifications: " + err.message);
        return utils.handleError(ctx, err, "An error occurred while retrieving notifications");
    }
}

// Register RPCs in InitModule context if available
var rpcSendFriendInvite = sendFriendInvite;
var rpcAcceptFriendInvite = acceptFriendInvite;
var rpcDeclineFriendInvite = declineFriendInvite;
var rpcGetNotifications = getNotifications;

// Export for module systems (ES Module syntax)
export {
    sendFriendInvite,
    acceptFriendInvite,
    declineFriendInvite,
    getNotifications,
    rpcSendFriendInvite,
    rpcAcceptFriendInvite,
    rpcDeclineFriendInvite,
    rpcGetNotifications
};
