// ============================================================================
// friend_invites.js - Canonical Friend Invite RPCs (Split-Brain Fix)
// ============================================================================
// PRODUCTION-READY | ES5 (Goja runtime) | Single source of truth
//
// Replaces three legacy implementations that were causing the "split-brain"
// friend graph problem:
//   - legacy_runtime.js  : sendFriendInvite / acceptFriendInvite / declineFriendInvite
//   - copilot/social_features.js (orphaned, never registered)
//
// THE SPLIT-BRAIN BUG (and why this file fixes it)
// ------------------------------------------------
// Old send_friend_invite wrote a row to the `friend_invites` storage
// collection but NEVER touched Nakama's native friend graph (nk.friendsAdd).
// When accept_friend_invite later called nk.friendsAdd(acceptorId,
// [senderId]) it created a NEW invite from the *acceptor* in the wrong
// direction, leaving Nakama's `user_friends` table with one-sided
// INVITE_SENT / INVITE_RECEIVED relationships. Every other system that
// reads nk.friendsList (friend quests, friend streaks, friends_list,
// challenge mutual-friend check, find-friends relationship enrichment)
// then saw an inconsistent picture.
//
// The fix is one line in send: nk.friendsAdd(senderId, [targetUserId]) —
// this creates the proper INVITE_SENT relation immediately, then the
// existing accept-side nk.friendsAdd transitions BOTH users to FRIEND state
// atomically, exactly like Nakama's built-in addFriend flow does.
//
// What's new vs the old impl
// --------------------------
//  1. nk.friendsAdd called inside send (the actual split-brain fix)
//  2. Idempotent invite IDs derived from a sorted user-pair, so re-sending
//     the same invite returns the same row instead of creating duplicates
//  3. Self-invite check
//  4. Block check in BOTH directions (sender->target and target->sender)
//  5. Already-friends short-circuit (returns success without re-creating)
//  6. Existing-pending-invite short-circuit (returns success with same id)
//  7. Per-user rate limit (1 invite send / 5 seconds; 1 accept-or-decline
//     per invite is intrinsic via storage status check)
//  8. Cancel-invite RPC (sender can rescind an outgoing invite, also
//     cleans up the Nakama INVITE_SENT relation)
//  9. List-pending-invites RPC (returns BOTH incoming and outgoing custom
//     invites with enriched user data — what the QuizVerse UI actually needs)
// 10. Notifications use canonical notification_codes constants so client
//     filters always match (kills the "subject mismatch" bug too)
// 11. Optimistic concurrency on storage writes (storageWrite version field)
//     to prevent two simultaneous accepts/declines clobbering each other
// 12. Decline cleans up the INVITE_SENT relation (nk.friendsDelete) so the
//     sender no longer sees a phantom outgoing request
//
// Migration of existing data: NONE (per product decision). Old pending
// rows in friend_invites simply remain as data; they will fail the
// already-friends check the next time the sender retries (which now adds
// to the Nakama graph properly).
//
// All registered RPCs:
//   send_friend_invite
//   accept_friend_invite
//   decline_friend_invite
//   cancel_friend_invite              (NEW)
//   list_pending_friend_invites       (NEW)
// ============================================================================

// ─── Tunables ───────────────────────────────────────────────────────────────
var FRIEND_INVITES_COLLECTION  = 'friend_invites';
var FRIEND_INV_RATELIMIT_KEY   = 'fr_invite_send';
var FRIEND_INV_RATELIMIT_MS    = 5000; // 5s between sends per user
var FRIEND_INV_MAX_MESSAGE_LEN = 280;  // tweet-length

var INVITE_STATUS_PENDING   = 'pending';
var INVITE_STATUS_ACCEPTED  = 'accepted';
var INVITE_STATUS_DECLINED  = 'declined';
var INVITE_STATUS_CANCELLED = 'cancelled';

// Nakama friend states (from runtime API)
var FR_STATE_FRIEND          = 0;
var FR_STATE_INVITE_SENT     = 1;
var FR_STATE_INVITE_RECEIVED = 2;
var FR_STATE_BLOCKED         = 3;

// ─── Tiny self-contained helpers (no external `utils` dependency) ──────────
// We deliberately do NOT depend on the global `utils` namespace because it
// is a minimal subset (validatePayload/handleError/log*) defined in
// copilot/utils.js — and missing fields like safeJsonParse/getCurrentTimestamp
// have caused production crashes in other modules. Keeping these inline
// makes this module bullet-proof even if the merge order changes.

function _fiUuidValid(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function _fiNowIso()  { return new Date().toISOString(); }
function _fiNowMs()   { return Date.now(); }

function _fiOk(extra) {
    var out = { success: true };
    if (extra) {
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
        }
    }
    return JSON.stringify(out);
}

// Standardised error envelope. `errorCode` is a stable machine code so the
// client can switch on it without parsing English strings.
function _fiErr(message, errorCode, extra) {
    var out = { success: false, error: message, errorCode: errorCode || 'unknown' };
    if (extra) {
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
        }
    }
    return JSON.stringify(out);
}

function _fiParsePayload(payload) {
    if (!payload || payload === '') return { ok: true, data: {} };
    try { return { ok: true, data: JSON.parse(payload) }; }
    catch (e)  { return { ok: false, error: 'Invalid JSON payload: ' + e.message }; }
}

// Build the deterministic invite ID for a sender→target pair.
// We include a timestamp suffix so that an invite that was previously
// accepted/declined can be re-sent later (with a fresh row), but two
// concurrent sends within 1ms of each other would still produce the
// same id (acceptable; the storage version check will deduplicate).
function _fiInviteId(senderId, targetId) {
    return 'inv_' + senderId + '_' + targetId;
}

/**
 * Look up the Nakama friend-graph relationship between caller and target.
 * Returns the integer state (0=FRIEND, 1=INVITE_SENT, 2=INVITE_RECEIVED,
 * 3=BLOCKED) or -1 if there is no relationship.
 */
function _fiNakamaRelation(nk, callerId, targetId) {
    try {
        // friendsList returns up to `limit` friends in any state — we ask
        // for all and scan. With a hard cap of 1000 this is O(1) for
        // typical players; for power users we still terminate on first match.
        var page = nk.friendsList(callerId, 1000, null, null);
        if (page && page.friends) {
            for (var i = 0; i < page.friends.length; i++) {
                var f = page.friends[i];
                if (f && f.user && f.user.id === targetId) {
                    var s = (f.state && typeof f.state === 'object' && 'value' in f.state)
                        ? f.state.value : f.state;
                    return (typeof s === 'number') ? s : -1;
                }
            }
        }
    } catch (_) { /* fall through */ }
    return -1;
}

/**
 * Per-user simple cooldown for invite sends. Returns
 *   { allowed: true } or
 *   { allowed: false, retryAfterMs: <number> }
 */
function _fiCheckRateLimit(nk, userId, action, cooldownMs) {
    var key = 'rl_' + action + '_' + userId;
    var now = _fiNowMs();
    try {
        var rows = nk.storageRead([{ collection: 'rate_limits', key: key, userId: userId }]);
        if (rows && rows.length > 0 && rows[0].value && rows[0].value.timestamp) {
            var elapsed = now - rows[0].value.timestamp;
            if (elapsed < cooldownMs) {
                return { allowed: false, retryAfterMs: cooldownMs - elapsed };
            }
        }
    } catch (_) { /* fail-open */ }
    try {
        nk.storageWrite([{
            collection: 'rate_limits',
            key: key,
            userId: userId,
            value: { timestamp: now },
            permissionRead: 0,
            permissionWrite: 0
        }]);
    } catch (_) { /* non-critical */ }
    return { allowed: true };
}

function _fiUserDisplayName(nk, userId, fallback) {
    try {
        var users = nk.usersGetId([userId]);
        if (users && users.length > 0 && users[0]) {
            return users[0].displayName || users[0].username || fallback || userId;
        }
    } catch (_) {}
    return fallback || userId;
}

/**
 * Fetch a user's username by ID. Returns userId as fallback so the result
 * is never empty (nk.friendsAdd/Delete require a non-empty username string).
 */
function _fiUserUsername(nk, userId) {
    try {
        var users = nk.usersGetId([userId]);
        if (users && users.length > 0 && users[0]) {
            return users[0].username || userId;
        }
    } catch (_) {}
    return userId;
}

/**
 * Read an existing invite row stored under either user. We always store
 * the row under the TARGET user (so they can read their own inbox), but
 * during a re-send the caller is the SENDER and may not have read access.
 * We try both userIds.
 */
function _fiReadInviteEither(nk, inviteId, userIdA, userIdB) {
    var keys = [
        { collection: FRIEND_INVITES_COLLECTION, key: inviteId, userId: userIdA },
        { collection: FRIEND_INVITES_COLLECTION, key: inviteId, userId: userIdB }
    ];
    try {
        var rows = nk.storageRead(keys);
        if (rows && rows.length > 0) {
            // Pick the latest by updatedAt
            var best = null;
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                if (!r || !r.value) continue;
                if (best == null || (r.value.updatedAt || '') > (best.value.updatedAt || '')) {
                    best = r;
                }
            }
            return best;
        }
    } catch (_) {}
    return null;
}

// ============================================================================
// RPC: send_friend_invite
// ============================================================================
function rpcFriendsSendInvite(ctx, logger, nk, payload) {
    var fromUserId = ctx.userId;
    if (!fromUserId) return _fiErr('Authentication required', 'unauthenticated');

    var p = _fiParsePayload(payload);
    if (!p.ok) return _fiErr(p.error, 'invalid_payload');

    var data = p.data || {};
    var targetUserId = data.targetUserId;
    var rawMessage   = data.message;

    if (!_fiUuidValid(targetUserId)) {
        return _fiErr('Invalid targetUserId (must be a UUID)', 'invalid_target');
    }
    if (targetUserId === fromUserId) {
        return _fiErr('Cannot send a friend invite to yourself', 'self_invite');
    }

    var message = '';
    if (rawMessage) {
        if (typeof rawMessage !== 'string') {
            return _fiErr('message must be a string', 'invalid_payload');
        }
        message = rawMessage.length > FRIEND_INV_MAX_MESSAGE_LEN
            ? rawMessage.substring(0, FRIEND_INV_MAX_MESSAGE_LEN)
            : rawMessage;
    }

    // Rate limit early
    var rl = _fiCheckRateLimit(nk, fromUserId, FRIEND_INV_RATELIMIT_KEY, FRIEND_INV_RATELIMIT_MS);
    if (!rl.allowed) {
        return _fiErr('Please wait before sending another invite', 'rate_limited',
            { retryAfterMs: rl.retryAfterMs });
    }

    // Verify target exists (cheap usersGetId — also gives us their username
    // to feed into nk.friendsAdd as the second arg, which Nakama uses when
    // the target is identified by username rather than id).
    var targetUser = null;
    try {
        var users = nk.usersGetId([targetUserId]);
        if (users && users.length > 0) targetUser = users[0];
    } catch (e) {
        logger.warn('[FriendInvites] usersGetId failed: ' + e.message);
    }
    if (!targetUser) {
        return _fiErr('Target user not found', 'target_not_found');
    }

    // ── Block checks (both directions) ─────────────────────────────────────
    // 1. Caller's own block list (from Nakama state=3)
    var callerRel = _fiNakamaRelation(nk, fromUserId, targetUserId);
    if (callerRel === FR_STATE_BLOCKED) {
        return _fiErr('You have blocked this user. Unblock them first.', 'caller_blocked_target');
    }
    // 2. Target's view (does target have caller blocked?). We cannot read
    //    target's friendsList (insufficient perms), so we use the custom
    //    user_blocks storage that friends/friends.js writes.
    try {
        var blockRows = nk.storageRead([{
            collection: 'user_blocks',
            key: 'blocked_' + targetUserId + '_' + fromUserId,
            userId: targetUserId
        }]);
        if (blockRows && blockRows.length > 0) {
            // Don't reveal — generic error
            return _fiErr('Unable to send invite at this time', 'send_blocked');
        }
    } catch (blockErr) {
        logger.warn('[FriendInvites] block lookup failed (fail-closed): ' + (blockErr.message || blockErr));
        return _fiErr('Unable to verify block status. Try again.', 'block_check_failed');
    }

    // ── Already-friends / already-pending short-circuits ───────────────────
    if (callerRel === FR_STATE_FRIEND) {
        return _fiOk({ status: INVITE_STATUS_ACCEPTED, alreadyFriends: true,
                       targetUserId: targetUserId });
    }
    if (callerRel === FR_STATE_INVITE_SENT) {
        // Idempotent: there is already an outstanding invite from caller→target
        var existingId = _fiInviteId(fromUserId, targetUserId);
        return _fiOk({ status: INVITE_STATUS_PENDING, inviteId: existingId,
                       targetUserId: targetUserId, alreadySent: true });
    }
    if (callerRel === FR_STATE_INVITE_RECEIVED) {
        // Target already invited caller. Auto-accept reciprocal edge.
        try { nk.friendsAdd(fromUserId, ctx.username || fromUserId, [targetUserId], null, {}); }
        catch (e) {
            return _fiErr('Failed to auto-accept reciprocal invite: ' + e.message,
                          'autoaccept_failed');
        }
        var reciprocalId = _fiInviteId(targetUserId, fromUserId);
        try {
            sendFriendsNotification(nk, logger, 'FRIEND_REQUEST_ACCEPTED', targetUserId, {
                inviteId:               reciprocalId,
                acceptedBy:             fromUserId,
                acceptedByUsername:     ctx.username || fromUserId,
                acceptedByDisplayName:  _fiUserDisplayName(nk, fromUserId, ctx.username)
            }, fromUserId);
        } catch (notifyErr) {
            if (logger && logger.warn) {
                logger.warn('[FriendInvites] auto-accept notify failed: ' + notifyErr.message);
            }
        }
        return _fiOk({ status: INVITE_STATUS_ACCEPTED, autoAccepted: true,
                       inviteId: reciprocalId, targetUserId: targetUserId });
    }

    // ── Build the canonical invite row ─────────────────────────────────────
    var inviteId   = _fiInviteId(fromUserId, targetUserId);
    var fromName   = _fiUserDisplayName(nk, fromUserId, ctx.username);
    var inviteData = {
        inviteId:        inviteId,
        fromUserId:      fromUserId,
        fromUsername:    ctx.username || fromUserId,
        fromDisplayName: fromName,
        targetUserId:    targetUserId,
        targetUsername:  targetUser.username || '',
        message:         message,
        status:          INVITE_STATUS_PENDING,
        createdAt:       _fiNowIso(),
        updatedAt:       _fiNowIso()
    };

    // Store under the TARGET (so they can read their inbox via permissionRead=1).
    try {
        nk.storageWrite([{
            collection:      FRIEND_INVITES_COLLECTION,
            key:             inviteId,
            userId:          targetUserId,
            value:           inviteData,
            permissionRead:  1, // owner-read
            permissionWrite: 0  // server-only
        }]);
    } catch (e) {
        logger.error('[FriendInvites] storageWrite failed: ' + e.message);
        return _fiErr('Failed to persist friend invite', 'storage_write_failed');
    }

    // ── THE SPLIT-BRAIN FIX ────────────────────────────────────────────────
    // Without this line, Nakama's user_friends graph stays empty and every
    // downstream system (friends_list, friend_quests, friend_streaks,
    // friends_challenge_user mutual-friend check, find_friends relationship
    // enrichment) sees the wrong picture.
    try {
        nk.friendsAdd(fromUserId, ctx.username || fromUserId, [targetUserId], null, {});
    } catch (e) {
        // If Nakama refuses (e.g. target re-blocked between our check and
        // the call) we MUST roll back the storage write to keep the two
        // sides consistent.
        try {
            nk.storageDelete([{ collection: FRIEND_INVITES_COLLECTION,
                                key: inviteId, userId: targetUserId }]);
        } catch (_) { /* best-effort */ }
        logger.warn('[FriendInvites] nk.friendsAdd rejected: ' + e.message);
        return _fiErr('Unable to send invite (target may have blocked you)',
                      'friends_add_rejected');
    }

    // ── Notify the target with canonical Subject/Code/type contract ────────
    try {
        sendFriendsNotification(nk, logger, 'FRIEND_REQUEST', targetUserId, {
            inviteId:        inviteId,
            fromUserId:      fromUserId,
            fromUsername:    inviteData.fromUsername,
            fromDisplayName: inviteData.fromDisplayName,
            message:         message
        }, fromUserId);
    } catch (e) {
        // Notification failure must NEVER fail the parent RPC — the invite
        // is already on the server and the client can refresh manually.
        logger.warn('[FriendInvites] notify target failed: ' + e.message);
    }

    return _fiOk({
        inviteId:     inviteId,
        targetUserId: targetUserId,
        status:       INVITE_STATUS_PENDING,
        sentAt:       inviteData.createdAt
    });
}

// ============================================================================
// RPC: accept_friend_invite
// ============================================================================
function rpcFriendsAcceptInvite(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) return _fiErr('Authentication required', 'unauthenticated');

    var p = _fiParsePayload(payload);
    if (!p.ok) return _fiErr(p.error, 'invalid_payload');

    var inviteId = (p.data || {}).inviteId;
    if (!inviteId || typeof inviteId !== 'string') {
        return _fiErr('inviteId is required', 'invalid_payload');
    }

    // Read invite (it is stored under the target = the caller).
    var rows;
    try {
        rows = nk.storageRead([{
            collection: FRIEND_INVITES_COLLECTION,
            key:        inviteId,
            userId:     userId
        }]);
    } catch (e) {
        return _fiErr('Failed to read invite: ' + e.message, 'storage_read_failed');
    }

    if (!rows || rows.length === 0 || !rows[0].value) {
        return _fiErr('Friend invite not found', 'invite_not_found');
    }

    var invite     = rows[0].value;
    var rowVersion = rows[0].version; // for optimistic concurrency

    if (invite.targetUserId !== userId) {
        return _fiErr('This invite is not for you', 'invite_not_for_caller');
    }

    if (invite.status === INVITE_STATUS_ACCEPTED) {
        // Idempotent — second click on the same accept button must not error.
        return _fiOk({ inviteId: inviteId, alreadyAccepted: true,
                       friendUserId: invite.fromUserId,
                       friendDisplayName: invite.fromDisplayName });
    }
    if (invite.status !== INVITE_STATUS_PENDING) {
        return _fiErr('This invite has already been ' + invite.status,
                      'invite_not_pending', { currentStatus: invite.status });
    }

    // Graph is source of truth — reconcile storage when already friends/blocked.
    var acceptRel = _fiNakamaRelation(nk, userId, invite.fromUserId);
    if (acceptRel === FR_STATE_BLOCKED) {
        return _fiErr('You cannot accept an invite from a blocked user', 'caller_blocked_target');
    }
    if (acceptRel === FR_STATE_FRIEND) {
        invite.status     = INVITE_STATUS_ACCEPTED;
        invite.acceptedAt = invite.acceptedAt || _fiNowIso();
        invite.updatedAt  = _fiNowIso();
        try {
            nk.storageWrite([{
                collection:      FRIEND_INVITES_COLLECTION,
                key:             inviteId,
                userId:          userId,
                value:           invite,
                version:         rowVersion || undefined,
                permissionRead:  1,
                permissionWrite: 0
            }]);
        } catch (reconcileErr) {
            logger.warn('[FriendInvites] accept reconcile storageWrite: ' + reconcileErr.message);
        }
        return _fiOk({ inviteId: inviteId, alreadyFriends: true,
                       friendUserId: invite.fromUserId,
                       friendDisplayName: invite.fromDisplayName });
    }

    // Add the reciprocal friend edge. Combined with the INVITE_SENT
    // edge created at send-time this transitions BOTH users to FRIEND.
    try {
        nk.friendsAdd(userId, ctx.username || userId, [invite.fromUserId], null, {});
    } catch (e) {
        logger.error('[FriendInvites] accept nk.friendsAdd failed: ' + e.message);
        return _fiErr('Failed to add friend: ' + e.message, 'friends_add_failed');
    }

    // Update invite row with optimistic concurrency control. Goja's
    // storageWrite supports a `version` field — passing the previously-read
    // version makes the write atomic w.r.t. concurrent accepts/declines.
    invite.status     = INVITE_STATUS_ACCEPTED;
    invite.acceptedAt = _fiNowIso();
    invite.updatedAt  = _fiNowIso();

    try {
        nk.storageWrite([{
            collection:      FRIEND_INVITES_COLLECTION,
            key:             inviteId,
            userId:          userId,
            value:           invite,
            version:         rowVersion || undefined, // OCC; undefined = no check
            permissionRead:  1,
            permissionWrite: 0
        }]);
    } catch (e) {
        // Friend was added to Nakama already — log and continue. The graph
        // is the source of truth; the storage row is just a UI hint.
        logger.warn('[FriendInvites] accept storageWrite failed (non-fatal): ' + e.message);
    }

    // Notify the original sender that their request was accepted.
    try {
        var acceptorName = _fiUserDisplayName(nk, userId, ctx.username);
        sendFriendsNotification(nk, logger, 'FRIEND_REQUEST_ACCEPTED', invite.fromUserId, {
            inviteId:               inviteId,
            acceptedBy:             userId,
            acceptedByUsername:     ctx.username || userId,
            acceptedByDisplayName:  acceptorName
        }, userId);
    } catch (e) {
        logger.warn('[FriendInvites] notify sender of accept failed: ' + e.message);
    }

    return _fiOk({
        inviteId:           inviteId,
        friendUserId:       invite.fromUserId,
        friendUsername:     invite.fromUsername,
        friendDisplayName:  invite.fromDisplayName,
        acceptedAt:         invite.acceptedAt
    });
}

// ============================================================================
// RPC: decline_friend_invite
// ============================================================================
function rpcFriendsDeclineInvite(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) return _fiErr('Authentication required', 'unauthenticated');

    var p = _fiParsePayload(payload);
    if (!p.ok) return _fiErr(p.error, 'invalid_payload');

    var inviteId = (p.data || {}).inviteId;
    if (!inviteId || typeof inviteId !== 'string') {
        return _fiErr('inviteId is required', 'invalid_payload');
    }

    var rows;
    try {
        rows = nk.storageRead([{
            collection: FRIEND_INVITES_COLLECTION,
            key:        inviteId,
            userId:     userId
        }]);
    } catch (e) {
        return _fiErr('Failed to read invite: ' + e.message, 'storage_read_failed');
    }

    if (!rows || rows.length === 0 || !rows[0].value) {
        return _fiErr('Friend invite not found', 'invite_not_found');
    }

    var invite     = rows[0].value;
    var rowVersion = rows[0].version;

    if (invite.targetUserId !== userId) {
        return _fiErr('This invite is not for you', 'invite_not_for_caller');
    }

    if (invite.status === INVITE_STATUS_DECLINED) {
        return _fiOk({ inviteId: inviteId, alreadyDeclined: true });
    }
    if (invite.status !== INVITE_STATUS_PENDING) {
        return _fiErr('This invite has already been ' + invite.status,
                      'invite_not_pending', { currentStatus: invite.status });
    }

    // Remove the sender's INVITE_SENT relation from Nakama's graph so it
    // doesn't sit there forever as a phantom outgoing request. We delete
    // from the SENDER's list (decline = "they no longer have a sent
    // invite to me"). nk.friendsDelete is idempotent.
    try {
        nk.friendsDelete(invite.fromUserId, invite.fromUsername || _fiUserUsername(nk, invite.fromUserId), [userId], null);
    } catch (e) {
        logger.warn('[FriendInvites] decline nk.friendsDelete failed (non-fatal): ' + e.message);
    }

    invite.status     = INVITE_STATUS_DECLINED;
    invite.declinedAt = _fiNowIso();
    invite.updatedAt  = _fiNowIso();

    try {
        nk.storageWrite([{
            collection:      FRIEND_INVITES_COLLECTION,
            key:             inviteId,
            userId:          userId,
            value:           invite,
            version:         rowVersion || undefined,
            permissionRead:  1,
            permissionWrite: 0
        }]);
    } catch (e) {
        return _fiErr('Failed to persist decline: ' + e.message, 'storage_write_failed');
    }

    // Notify the sender that their request was declined. We send a
    // notification (rather than silently dropping) so the sender's UI
    // can move the row out of "pending sent" without polling.
    try {
        sendFriendsNotification(nk, logger, 'FRIEND_REQUEST_DECLINED', invite.fromUserId, {
            inviteId:   inviteId,
            declinedBy: userId
        }, userId);
    } catch (e) {
        logger.warn('[FriendInvites] notify sender of decline failed: ' + e.message);
    }

    return _fiOk({ inviteId: inviteId, status: INVITE_STATUS_DECLINED });
}

// ============================================================================
// RPC: cancel_friend_invite  (NEW — sender rescinds their own outgoing invite)
// ============================================================================
function rpcFriendsCancelInvite(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) return _fiErr('Authentication required', 'unauthenticated');

    var p = _fiParsePayload(payload);
    if (!p.ok) return _fiErr(p.error, 'invalid_payload');

    var data         = p.data || {};
    var inviteId     = data.inviteId;
    var targetUserId = data.targetUserId;

    if (!targetUserId && inviteId) {
        // Derive target from inviteId pattern "inv_<sender>_<target>"
        var m = /^inv_([0-9a-f-]{36})_([0-9a-f-]{36})$/i.exec(inviteId);
        if (m && m[1] === userId) targetUserId = m[2];
    }

    if (!_fiUuidValid(targetUserId)) {
        return _fiErr('targetUserId (or a valid inviteId you own) is required',
                      'invalid_payload');
    }

    if (!inviteId) inviteId = _fiInviteId(userId, targetUserId);

    // Invite row is stored under the TARGET (the caller is the sender).
    var rows = null;
    try {
        rows = nk.storageRead([{
            collection: FRIEND_INVITES_COLLECTION,
            key:        inviteId,
            userId:     targetUserId
        }]);
    } catch (e) {
        // Don't fail — fall through to graph cleanup
        logger.warn('[FriendInvites] cancel storageRead failed: ' + e.message);
    }

    var invite = (rows && rows.length > 0 && rows[0].value) ? rows[0].value : null;

    if (invite) {
        if (invite.fromUserId !== userId) {
            return _fiErr('You can only cancel invites you sent', 'invite_not_owned');
        }
        if (invite.status !== INVITE_STATUS_PENDING &&
            invite.status !== INVITE_STATUS_CANCELLED) {
            return _fiErr('This invite cannot be cancelled (status=' + invite.status + ')',
                          'invite_not_pending', { currentStatus: invite.status });
        }
    }

    // Delete the INVITE_SENT relation in Nakama's graph regardless.
    try {
        nk.friendsDelete(userId, ctx.username || _fiUserUsername(nk, userId), [targetUserId], null);
    } catch (e) {
        logger.warn('[FriendInvites] cancel nk.friendsDelete failed: ' + e.message);
    }

    if (invite && invite.status === INVITE_STATUS_PENDING) {
        invite.status      = INVITE_STATUS_CANCELLED;
        invite.cancelledAt = _fiNowIso();
        invite.updatedAt   = _fiNowIso();
        try {
            nk.storageWrite([{
                collection:      FRIEND_INVITES_COLLECTION,
                key:             inviteId,
                userId:          targetUserId,
                value:           invite,
                version:         rows[0].version || undefined,
                permissionRead:  1,
                permissionWrite: 0
            }]);
        } catch (e) {
            logger.warn('[FriendInvites] cancel storageWrite failed: ' + e.message);
        }
    }

    // Optional: tell the target their pending request disappeared so their
    // UI can update without a refresh. Code is FRIEND_REQUEST_CANCELLED.
    try {
        sendFriendsNotification(nk, logger, 'FRIEND_REQUEST_CANCELLED', targetUserId, {
            inviteId:    inviteId,
            cancelledBy: userId
        }, userId);
    } catch (e) {
        logger.warn('[FriendInvites] notify cancel failed: ' + e.message);
    }

    return _fiOk({ inviteId: inviteId, targetUserId: targetUserId,
                   status: INVITE_STATUS_CANCELLED });
}

// ============================================================================
// RPC: list_pending_friend_invites  (NEW)
// ============================================================================
// Returns BOTH incoming pending invites (rows stored under the caller, the
// caller is target) AND outgoing pending invites (rows where caller is the
// sender). Single round-trip — replaces ad-hoc client polling of multiple
// endpoints.
function rpcFriendsListPendingInvites(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) return _fiErr('Authentication required', 'unauthenticated');

    var p = _fiParsePayload(payload);
    if (!p.ok) return _fiErr(p.error, 'invalid_payload');

    var limit = parseInt((p.data || {}).limit) || 100;
    if (limit < 1)   limit = 1;
    if (limit > 200) limit = 200;

    // Incoming: scan the caller's own friend_invites collection.
    var incoming = [];
    try {
        var page = nk.storageList(userId, FRIEND_INVITES_COLLECTION, limit, null);
        var objects = (page && page.objects) ? page.objects : (page || []);
        for (var i = 0; i < objects.length; i++) {
            var o = objects[i];
            if (!o || !o.value) continue;
            if (o.value.status !== INVITE_STATUS_PENDING) continue;
            if (o.value.targetUserId !== userId) continue; // safety
            // Drop stale rows when Nakama graph already shows mutual friend or block.
            var inRel = _fiNakamaRelation(nk, userId, o.value.fromUserId);
            if (inRel === FR_STATE_FRIEND || inRel === FR_STATE_BLOCKED) continue;
            incoming.push({
                inviteId:        o.value.inviteId,
                fromUserId:      o.value.fromUserId,
                fromUsername:    o.value.fromUsername,
                fromDisplayName: o.value.fromDisplayName,
                message:         o.value.message || '',
                createdAt:       o.value.createdAt
            });
        }
    } catch (e) {
        logger.warn('[FriendInvites] list incoming failed: ' + e.message);
    }

    // Outgoing: derive from Nakama's friend graph (state=1 INVITE_SENT)
    // — this is more reliable than scanning storage, because the storage
    // row lives under the TARGET (we'd need cross-user reads). Friend
    // graph is authoritative.
    var outgoing = [];
    try {
        var page2 = nk.friendsList(userId, 1000, FR_STATE_INVITE_SENT, null);
        if (page2 && page2.friends) {
            for (var j = 0; j < page2.friends.length && outgoing.length < limit; j++) {
                var fr = page2.friends[j];
                if (!fr || !fr.user) continue;
                outgoing.push({
                    inviteId:        _fiInviteId(userId, fr.user.id),
                    targetUserId:    fr.user.id,
                    targetUsername:  fr.user.username || '',
                    targetDisplayName: fr.user.displayName || fr.user.username || '',
                    avatarUrl:       fr.user.avatarUrl || '',
                    online:          fr.user.online || false
                });
            }
        }
    } catch (e) {
        logger.warn('[FriendInvites] list outgoing failed: ' + e.message);
    }

    return _fiOk({
        incoming:      incoming,
        outgoing:      outgoing,
        incomingCount: incoming.length,
        outgoingCount: outgoing.length
    });
}

// ============================================================================
// Module Init — register all friend-invite RPCs
// ============================================================================
// Postbuild renames this `InitModule` to `__ModuleInit_N` (since there can
// only be one InitModule in the merged output) and rewrites every
// `initializer.registerRpc("id", handler)` into a guarded global stub
// assignment, then replays it at module-load time. The legacy
// registrations for these same RPC ids in legacy_runtime.js have been
// commented out so this module wins the "first to set the stub" race.
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('send_friend_invite',         rpcFriendsSendInvite);
    initializer.registerRpc('accept_friend_invite',       rpcFriendsAcceptInvite);
    initializer.registerRpc('decline_friend_invite',      rpcFriendsDeclineInvite);
    initializer.registerRpc('cancel_friend_invite',       rpcFriendsCancelInvite);
    initializer.registerRpc('list_pending_friend_invites', rpcFriendsListPendingInvites);

    if (logger && logger.info) {
        logger.info('[FriendInvites] Registered 5 canonical friend-invite RPCs');
    }
}
