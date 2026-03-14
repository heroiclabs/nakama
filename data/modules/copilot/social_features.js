// social_features.js - Social graph and notification features
// ES5 compatible for Nakama goja runtime

function rpcSendFriendInvite(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return copilotHandleError(ctx, null, "Authentication required");
        }

        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return copilotHandleError(ctx, err, "Invalid JSON payload");
        }

        var validation = copilotValidatePayload(data, ['targetUserId']);
        if (!validation.valid) {
            return copilotHandleError(ctx, null, "Missing required field: targetUserId");
        }

        var fromUserId = ctx.userId;
        var fromUsername = ctx.username || fromUserId;
        var targetUserId = data.targetUserId;
        var message = data.message || "You have a new friend request";
        var inviteId = fromUserId + "_" + targetUserId + "_" + Date.now();

        var inviteData = {
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
        } catch (err) {
            return copilotHandleError(ctx, err, "Failed to store friend invite");
        }

        try {
            nk.notificationSend(targetUserId, "Friend Request",
                { type: "friend_invite", inviteId: inviteId, fromUserId: fromUserId, fromUsername: fromUsername, message: message },
                1, fromUserId, true);
        } catch (err) {
            copilotLogWarn(logger, "Failed to send notification: " + err.message);
        }

        return JSON.stringify({ success: true, inviteId: inviteId, targetUserId: targetUserId, status: "sent" });

    } catch (err) {
        return copilotHandleError(ctx, err, "An error occurred while sending friend invite");
    }
}

function rpcAcceptFriendInvite(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return copilotHandleError(ctx, null, "Authentication required");
        }

        var data;
        try { data = JSON.parse(payload); } catch (err) { return copilotHandleError(ctx, err, "Invalid JSON payload"); }

        var validation = copilotValidatePayload(data, ['inviteId']);
        if (!validation.valid) {
            return copilotHandleError(ctx, null, "Missing required field: inviteId");
        }

        var userId = ctx.userId;
        var inviteId = data.inviteId;
        var inviteData;

        try {
            var records = nk.storageRead([{ collection: "friend_invites", key: inviteId, userId: userId }]);
            if (!records || records.length === 0) return copilotHandleError(ctx, null, "Friend invite not found");
            inviteData = records[0].value;
        } catch (err) {
            return copilotHandleError(ctx, err, "Failed to retrieve friend invite");
        }

        if (inviteData.targetUserId !== userId) return copilotHandleError(ctx, null, "This invite is not for you");
        if (inviteData.status !== "pending") return copilotHandleError(ctx, null, "This invite has already been processed");

        try {
            nk.friendsAdd(userId, [inviteData.fromUserId], [inviteData.fromUsername]);
        } catch (err) {
            return copilotHandleError(ctx, err, "Failed to add friend");
        }

        inviteData.status = "accepted";
        inviteData.acceptedAt = new Date().toISOString();
        try { nk.storageWrite([{ collection: "friend_invites", key: inviteId, userId: userId, value: inviteData, permissionRead: 1, permissionWrite: 0 }]); } catch (err) { /* non-fatal */ }

        try {
            nk.notificationSend(inviteData.fromUserId, "Friend Request Accepted",
                { type: "friend_invite_accepted", acceptedBy: userId, acceptedByUsername: ctx.username || userId },
                2, userId, true);
        } catch (err) { /* non-fatal */ }

        return JSON.stringify({ success: true, inviteId: inviteId, friendUserId: inviteData.fromUserId, friendUsername: inviteData.fromUsername });

    } catch (err) {
        return copilotHandleError(ctx, err, "An error occurred while accepting friend invite");
    }
}

function rpcDeclineFriendInvite(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) return copilotHandleError(ctx, null, "Authentication required");

        var data;
        try { data = JSON.parse(payload); } catch (err) { return copilotHandleError(ctx, err, "Invalid JSON payload"); }

        var validation = copilotValidatePayload(data, ['inviteId']);
        if (!validation.valid) return copilotHandleError(ctx, null, "Missing required field: inviteId");

        var userId = ctx.userId;
        var inviteId = data.inviteId;
        var inviteData;

        try {
            var records = nk.storageRead([{ collection: "friend_invites", key: inviteId, userId: userId }]);
            if (!records || records.length === 0) return copilotHandleError(ctx, null, "Friend invite not found");
            inviteData = records[0].value;
        } catch (err) {
            return copilotHandleError(ctx, err, "Failed to retrieve friend invite");
        }

        if (inviteData.targetUserId !== userId) return copilotHandleError(ctx, null, "This invite is not for you");
        if (inviteData.status !== "pending") return copilotHandleError(ctx, null, "This invite has already been processed");

        inviteData.status = "declined";
        inviteData.declinedAt = new Date().toISOString();

        try {
            nk.storageWrite([{ collection: "friend_invites", key: inviteId, userId: userId, value: inviteData, permissionRead: 1, permissionWrite: 0 }]);
        } catch (err) {
            return copilotHandleError(ctx, err, "Failed to decline friend invite");
        }

        return JSON.stringify({ success: true, inviteId: inviteId, status: "declined" });

    } catch (err) {
        return copilotHandleError(ctx, err, "An error occurred while declining friend invite");
    }
}

function rpcGetNotifications(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) return copilotHandleError(ctx, null, "Authentication required");

        var data = {};
        if (payload) { try { data = JSON.parse(payload); } catch (err) { /* use defaults */ } }

        var userId = ctx.userId;
        var limit = data.limit || 100;
        var notifications = [];

        try {
            var result = nk.notificationsList(userId, limit, null);
            if (result && result.notifications) notifications = result.notifications;
        } catch (err) {
            return copilotHandleError(ctx, err, "Failed to retrieve notifications");
        }

        return JSON.stringify({ success: true, notifications: notifications, count: notifications.length });

    } catch (err) {
        return copilotHandleError(ctx, err, "An error occurred while retrieving notifications");
    }
}
