// ============================================================================
// social_features.js — Social graph and notification features (DEPRECATED)
// ============================================================================
// ES5 compatible for Nakama goja runtime
//
// ⚠ THIS FILE IS DEAD CODE — DO NOT EDIT THE FUNCTIONS BELOW ⚠
//
// History
// -------
// This file once contained an alternative implementation of the friend-
// invite RPCs (rpcSendFriendInvite / rpcAcceptFriendInvite /
// rpcDeclineFriendInvite). They were never registered anywhere — neither
// `index.js` (the bundled entry point produced by postbuild.js) nor
// `legacy_runtime.js` ever called `initializer.registerRpc(...)` for any
// of these handlers. So they sat in the source tree for years as
// orphaned, untestable, and conflicting copies of the legacy_runtime
// implementations.
//
// Why we don't just delete the file
// ---------------------------------
// 1. Removing the file would break a developer who happens to grep for
//    `rpcSendFriendInvite` and expects to land on something authoritative.
//    The pointer comment below (and the disabled blocks) make the
//    redirection explicit and survive a quick search.
// 2. postbuild.js auto-discovers every `*.js` file under data/modules/
//    (excluding the obvious build artefacts). Deleting the file would
//    remove ~150 lines from the bundle but is otherwise functionally
//    indistinguishable from leaving the bodies commented out.
// 3. Future audits can compare the disabled bodies here with the live
//    implementations in `friends/friend_invites.js` to verify behaviour
//    parity.
//
// Where the LIVE implementations live now
// ---------------------------------------
//   send_friend_invite     →  data/modules/friends/friend_invites.js
//   accept_friend_invite   →  data/modules/friends/friend_invites.js
//   decline_friend_invite  →  data/modules/friends/friend_invites.js
//   cancel_friend_invite          (NEW)  →  friends/friend_invites.js
//   list_pending_friend_invites   (NEW)  →  friends/friend_invites.js
//
// The new module also fixes the "split-brain" friend-graph bug: the
// legacy send_friend_invite below NEVER called nk.friendsAdd(), leaving
// Nakama's native user_friends table permanently out-of-sync with the
// custom `friend_invites` storage rows. The new implementation calls
// nk.friendsAdd(senderId, [targetUserId]) on send so every downstream
// system that reads nk.friendsList sees a consistent picture.
//
// Notifications now use the canonical constants in
//   data/modules/friends/notification_codes.js
// (subject = stable machine id, code = canonical numeric filter,
//  content.type = backup machine id) instead of ad-hoc subjects like
// "Friend Request" / "Friend Request Accepted" that the client never
// matched.
//
// IF YOU NEED TO MODIFY FRIEND INVITE BEHAVIOUR — DO IT IN
//   data/modules/friends/friend_invites.js
// NOT HERE.
//
// rpcGetNotifications below is also dead in this file (never registered
// from here) but left untouched because it is a generic notification
// helper, not friends-specific, and may be revived later by a different
// subsystem. It is harmless: `function` declarations cost nothing at
// runtime if never called.
// ============================================================================

/* ─── BEGIN DISABLED CODE — see header above ────────────────────────────────
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
        try { nk.storageWrite([{ collection: "friend_invites", key: inviteId, userId: userId, value: inviteData, permissionRead: 1, permissionWrite: 0 }]); } catch (err) { }

        try {
            nk.notificationSend(inviteData.fromUserId, "Friend Request Accepted",
                { type: "friend_invite_accepted", acceptedBy: userId, acceptedByUsername: ctx.username || userId },
                2, userId, true);
        } catch (err) { }

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
        if (payload) { try { data = JSON.parse(payload); } catch (err) { } }

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
─── END DISABLED CODE ──────────────────────────────────────────────────── */
