// ============================================================================
// notification_codes.js - Canonical Friends Notification Constants
// ============================================================================
// PRODUCTION-READY | ES5 (Goja runtime) | Single source of truth
//
// Why this file exists
// --------------------
// Before this file the server sent notifications with arbitrary `Subject`
// strings (e.g. "Friend Request") and ad-hoc numeric `Code` values, while the
// Unity client filtered with a different machine-id convention
// (e.g. subject == "friend_request"). The two never matched, so real-time
// invite / accept / decline popups were silently dropped.
//
// Going forward, EVERY friend-related notification MUST be sent using these
// constants and EVERY client listener MUST filter primarily by `Code`
// (cheapest, most stable) and fall back to `Subject` (machine id) for
// compatibility with notifications already sitting in inboxes.
//
// Contract
// --------
//   notification.Subject  = NotifSubject.<X>   ← stable machine id, lower_snake_case
//   notification.Code     = NotifCode.<X>      ← canonical numeric filter
//   notification.Content  = JSON-serialised object including a "type" field
//                           equal to NotifSubject.<X>  (backup filter)
//
// Numeric ranges (do NOT reuse — collisions break client filtering):
//   1   – 99   reserved for ORIGINAL friend invite/decline (legacy compat)
//   100 – 104  friend challenge lifecycle (request/accept/decline/cancel/expire)
//   105 – 199  reserved for additional friend social actions (spectate=105 first)
//   200 – 299  reserved for future friend social events
//   300 – 399  reserved for friend quests
//   400 – 499  reserved for friend streaks
//
// IMPORTANT: codes 1 and 2 are kept identical to the legacy values so that
// any notification already persisted in user inboxes still matches the
// new client filter. NEVER change those two without a coordinated client
// release that handles both old and new values.
// ============================================================================

var NotifCode = {
    // Friend invite lifecycle (1-9 reserved, codes 1-3 are legacy-compatible)
    FRIEND_REQUEST:           1,   // Was used by old send_friend_invite
    FRIEND_REQUEST_ACCEPTED:  2,   // Was used by old accept_friend_invite
    FRIEND_REQUEST_DECLINED:  3,
    FRIEND_REQUEST_CANCELLED: 4,
    FRIEND_REMOVED:           5,
    FRIEND_BLOCKED:           6,

    // Friend challenges (100-199)
    FRIEND_CHALLENGE_RECEIVED: 100, // Was used by friends_challenge_user
    FRIEND_CHALLENGE_ACCEPTED: 101,
    FRIEND_CHALLENGE_DECLINED: 102,
    FRIEND_CHALLENGE_CANCELLED: 103,
    FRIEND_CHALLENGE_EXPIRED:  104,

    // Friend spectate (105) - hardened friends_spectate RPC
    FRIEND_SPECTATE_REQUEST:   105
};

// Subject strings are STABLE MACHINE IDs (lower_snake_case). They are
// intentionally NOT human-readable display strings — display titles must
// be built on the client (so they can be localised) or read from
// notification.Content.title.
var NotifSubject = {
    FRIEND_REQUEST:           'friend_request',
    FRIEND_REQUEST_ACCEPTED:  'friend_request_accepted',
    FRIEND_REQUEST_DECLINED:  'friend_request_declined',
    FRIEND_REQUEST_CANCELLED: 'friend_request_cancelled',
    FRIEND_REMOVED:           'friend_removed',
    FRIEND_BLOCKED:           'friend_blocked',

    FRIEND_CHALLENGE_RECEIVED:  'friend_challenge',
    FRIEND_CHALLENGE_ACCEPTED:  'friend_challenge_accepted',
    FRIEND_CHALLENGE_DECLINED:  'friend_challenge_declined',
    FRIEND_CHALLENGE_CANCELLED: 'friend_challenge_cancelled',
    FRIEND_CHALLENGE_EXPIRED:   'friend_challenge_expired',

    FRIEND_SPECTATE_REQUEST:    'friend_spectate_request'
};

// Default human-readable titles. Clients SHOULD build their own localised
// titles, but if they do not, the server can fall back to these strings
// in notification.Content.title.
var NotifTitle = {
    FRIEND_REQUEST:           'Friend Request',
    FRIEND_REQUEST_ACCEPTED:  'Friend Request Accepted',
    FRIEND_REQUEST_DECLINED:  'Friend Request Declined',
    FRIEND_REQUEST_CANCELLED: 'Friend Request Cancelled',
    FRIEND_REMOVED:           'Friend Removed',
    FRIEND_BLOCKED:           'You Were Blocked',

    FRIEND_CHALLENGE_RECEIVED:  'Friend Challenge',
    FRIEND_CHALLENGE_ACCEPTED:  'Challenge Accepted',
    FRIEND_CHALLENGE_DECLINED:  'Challenge Declined',
    FRIEND_CHALLENGE_CANCELLED: 'Challenge Cancelled',
    FRIEND_CHALLENGE_EXPIRED:   'Challenge Expired',

    FRIEND_SPECTATE_REQUEST:    'Spectate Request'
};

/**
 * Build a fully-formed notification record with the canonical contract.
 * @param {string} subjectKey - One of NotifSubject keys (e.g. "FRIEND_REQUEST")
 * @param {string} userId - Recipient userId
 * @param {object} payload - Caller-supplied payload merged into Content
 * @param {string|null} senderId - Optional sender userId (Nakama notification field)
 * @returns {object} A record suitable for nk.notificationsSend([...])
 */
var FRIEND_INBOX_COLLECTION = 'notification_inbox';

/**
 * Normalise friend notification payload into string-keyed data for inbox + push.
 * Always includes inviteId when present so Unity can accept/decline without a lookup.
 */
function friendNotifDataFromPayload(payload, senderId) {
    var p = payload || {};
    var data = {};
    if (p.inviteId) data.inviteId = String(p.inviteId);
    if (p.fromUserId) data.fromUserId = String(p.fromUserId);
    if (p.targetUserId) data.targetUserId = String(p.targetUserId);
    if (p.fromUsername) data.fromUsername = String(p.fromUsername);
    if (p.fromDisplayName) data.fromDisplayName = String(p.fromDisplayName);
    if (p.acceptedBy) data.acceptedBy = String(p.acceptedBy);
    if (p.acceptedByDisplayName) data.acceptedByDisplayName = String(p.acceptedByDisplayName);
    if (p.declinedBy) data.declinedBy = String(p.declinedBy);
    if (p.cancelledBy) data.cancelledBy = String(p.cancelledBy);
    if (p.removedByUserId) data.removedByUserId = String(p.removedByUserId);
    if (p.friendUserId) data.friendUserId = String(p.friendUserId);
    if (senderId) data.senderId = String(senderId);
    return data;
}

/**
 * Mirror friend notifications into notification_inbox so list_notification_inbox
 * and FCM resume paths see the same inviteId-rich payload as nk.notificationsSend.
 */
function mirrorFriendsNotificationToInbox(nk, logger, subjectKey, userId, payload, senderId) {
    if (!NotifSubject.hasOwnProperty(subjectKey)) return;
    try {
        var subject = NotifSubject[subjectKey];
        var title = NotifTitle[subjectKey];
        var data = friendNotifDataFromPayload(payload, senderId);
        var inboxId = 'inbox_' + (data.inviteId || (subject + '_' + Date.now()));
        nk.storageWrite([{
            collection:      FRIEND_INBOX_COLLECTION,
            key:             inboxId,
            userId:          userId,
            value: {
                notification_id: inboxId,
                title:           title,
                body:            '',
                event_type:      subject,
                data:            data,
                template_id:     '',
                priority:        8,
                channel:         'both',
                is_read:         false,
                sent_at:         Date.now(),
                created_at:      Date.now()
            },
            permissionRead:  1,
            permissionWrite: 0
        }]);
    } catch (err) {
        if (logger && logger.warn) {
            logger.warn('[FriendsNotif] mirrorFriendsNotificationToInbox failed: ' + err.message);
        }
    }
}

/**
 * Best-effort FCM/APNS bridge for friend lifecycle.
 *
 * ⚠️ FIXED 2026-07-06 (live bug, sibling of B-006): this bridge previously
 * guarded on `typeof sendLocalizedPushToUser !== 'function'` — but push.ts
 * compiles that function INSIDE the LegacyPush namespace; no bare global
 * ever exists. The guard was therefore always true and this bridge has
 * silently NO-OPed since it shipped: accept/challenge pushes never reached
 * any device. Now calls LegacyPush.sendLocalizedPushToUser with a real ctx
 * (required — the helper reads ctx.env for the push endpoint URL).
 *
 * Delivery matrix follows the architecture doc §9.3:
 *   FRIEND_REQUEST            → NO push here — friend_invites.js sends its
 *                               own richer direct push at send time; pushing
 *                               here too would double-notify the target.
 *   FRIEND_REQUEST_ACCEPTED   → NO push here — same reason: friend_invites.js
 *                               accept path sends its own direct
 *                               friend_accepted_* push with inviteId data.
 *   FRIEND_CHALLENGE_RECEIVED → push (friend_challenge_* keys) — challenges
 *                               have NO direct push anywhere; the bridge owns them.
 *   FRIEND_CHALLENGE_ACCEPTED → push (challenge_accepted_* keys) — same.
 *   declined / cancelled / removed / expired / spectate → in-app tiers only.
 *
 * No-op when push module is not loaded. Never throws.
 */
function sendFriendsPushBridge(ctx, nk, logger, subjectKey, userId, payload, senderId) {
    if (typeof LegacyPush === 'undefined' || !LegacyPush.sendLocalizedPushToUser) return;
    if (!ctx) return; // helper dereferences ctx.env — never call without a real ctx
    var p = payload || {};
    var data = friendNotifDataFromPayload(payload, senderId);
    data.screen = 'friends';

    try {
        if (subjectKey === 'FRIEND_CHALLENGE_RECEIVED') {
            var chName = p.fromDisplayName || p.fromUsername || 'Someone';
            var chMode = (p.challengeData && (p.challengeData.modeName || p.challengeData.mode)) || p.gameId || 'a quiz battle';
            LegacyPush.sendLocalizedPushToUser(ctx, logger, nk, userId,
                'friend_challenge',
                'friend_challenge_title', 'friend_challenge_body', { name: chName, mode: chMode },
                { skipQuietHours: true, skipInAppNotification: true, data: data });
        } else if (subjectKey === 'FRIEND_CHALLENGE_ACCEPTED') {
            var accByName = p.acceptedByDisplayName || p.acceptedByUsername || 'Someone';
            LegacyPush.sendLocalizedPushToUser(ctx, logger, nk, userId,
                'friend_challenge_accepted',
                'challenge_accepted_title', 'challenge_accepted_body', { name: accByName },
                { skipQuietHours: true, skipInAppNotification: true, data: data });
        }
        // All other subjects: in-app inbox + socket only (doc §9.3).
    } catch (err) {
        if (logger && logger.warn) {
            logger.warn('[FriendsNotif] sendFriendsPushBridge failed: ' + err.message);
        }
    }
}

function buildFriendsNotification(subjectKey, userId, payload, senderId) {
    if (!NotifSubject.hasOwnProperty(subjectKey)) {
        throw new Error('buildFriendsNotification: unknown subjectKey "' + subjectKey + '"');
    }

    var subject = NotifSubject[subjectKey];
    var code    = NotifCode[subjectKey];
    var title   = NotifTitle[subjectKey];

    var content = payload || {};
    // Always inject "type" as a machine-id backup filter for older clients
    // that still look at notification.Content.type instead of Code.
    content.type  = subject;
    content.title = content.title || title;
    content.code  = code;

    return {
        userId:     userId,
        subject:    subject,
        content:    content,
        code:       code,
        sender:     senderId || null,
        persistent: true
    };
}

/**
 * Convenience wrapper that sends a single friends-system notification.
 * Catches and logs failure (notifications must never break the parent RPC).
 */
function sendFriendsNotification(ctx, nk, logger, subjectKey, userId, payload, senderId) {
    // Signature change 2026-07-06: ctx added as first param so the push
    // bridge can reach ctx.env (see sendFriendsPushBridge fix above). All
    // call sites in friend_invites.js / friend_challenges.js updated.
    // B-006 fix (2026-07-06): tier isolation. Previously all three delivery
    // tiers shared ONE try/catch, so nk.notificationsSend (Tier 1, realtime
    // socket) throwing silently skipped the durable inbox mirror (Tier 2)
    // AND the device push (Tier 3). Per the architecture doc §9.4: Tier 2 is
    // the durable record and runs FIRST; Tiers 1 and 3 are best-effort and
    // each isolated so no tier's failure can mask another's.
    var rec = null;
    try {
        rec = buildFriendsNotification(subjectKey, userId, payload, senderId);
    } catch (err) {
        if (logger && logger.warn) {
            logger.warn('[FriendsNotif] build failed for ' + subjectKey + ': ' + err.message);
        }
        return false;
    }

    // Tier 2 — durable inbox mirror (internally try/caught, never throws)
    mirrorFriendsNotificationToInbox(nk, logger, subjectKey, userId, payload, senderId);

    // Tier 1 — realtime socket + Nakama persistent notification (isolated)
    var socketOk = false;
    try {
        nk.notificationsSend([rec]);
        socketOk = true;
    } catch (err) {
        if (logger && logger.warn) {
            logger.warn('[FriendsNotif] socket send failed for ' + subjectKey + ' to ' + userId + ' (non-fatal): ' + err.message);
        }
    }

    // Tier 3 — device push via FCM/APNS bridge (internally try/caught)
    sendFriendsPushBridge(ctx, nk, logger, subjectKey, userId, payload, senderId);

    return socketOk;
}
