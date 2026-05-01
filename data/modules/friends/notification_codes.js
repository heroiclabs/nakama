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
function sendFriendsNotification(nk, logger, subjectKey, userId, payload, senderId) {
    try {
        var rec = buildFriendsNotification(subjectKey, userId, payload, senderId);
        nk.notificationsSend([rec]);
        return true;
    } catch (err) {
        if (logger && logger.warn) {
            logger.warn('[FriendsNotif] Failed to send ' + subjectKey + ' to ' + userId + ': ' + err.message);
        }
        return false;
    }
}
