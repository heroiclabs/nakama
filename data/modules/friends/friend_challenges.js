// ============================================================================
// friend_challenges.js - Canonical Friend Challenge Lifecycle RPCs
// ============================================================================
// PRODUCTION-READY | ES5 (Goja runtime) | Single source of truth
//
// Replaces the legacy single-shot `friends_challenge_user` stub (which was
// effectively broken at the network boundary because it required `gameId`
// to be a UUID, but the Unity client sends `async_<guid>` / `sync_<guid>`
// strings).  This module:
//
//  1. SERVER-AUTHORITATIVE challengeId  (`fchg_<32 chars>`, server-minted)
//  2. STRICT mutual-friend gate         (Nakama state == 0 only)
//  3. Bi-directional block check        (sender->target AND target->sender)
//  4. STRICT rate limit                 (1 per (sender,target) per 30 s
//                                        + 20 per sender per minute global,
//                                        sliding window)
//  5. Persists FULL lifecycle           (pending → accepted | declined |
//                                        cancelled | expired)
//  6. Auto-expiry at READ time          (lazy sweep — no scheduled job needed)
//  7. Per-game expiry policy            (async = 24 h, sync = 5 min,
//                                        default = 1 h; client may override
//                                        via challengeData.isAsync)
//  8. challengeData size cap            (4 KB JSON)
//  9. Idempotent state transitions      (double-tap accept/decline/cancel
//                                        returns success without erroring)
// 10. Notifications use canonical       (NotifCode 100/101/102/103 +
//     Subject/Code from notification_codes.js so the Unity
//     `IVXFriendsManager.HandleNotification` filter actually matches)
// 11. Storage layout
//        friend_challenges/<id>          (owner = recipient,  perm 1/0)
//        friend_challenges_outbox/<id>   (owner = sender,     perm 1/0)
//     Two writes per state change, but lets BOTH parties query their own
//     side without cross-user storage reads.
//
// Registered RPCs:
//   send_friend_challenge              ← canonical
//   friends_challenge_user             ← legacy alias (clients may still call this)
//   accept_friend_challenge
//   decline_friend_challenge
//   cancel_friend_challenge
//   list_pending_friend_challenges
//
// SIDE-EFFECTS (re-uses helpers from friends/friends.js when present):
//   sendChallengePushNotification(nk, logger, ...) — push notification fan-out
//   sendChallengeChatMessage(nk, logger, ...)      — DM channel insertion
// Both calls are wrapped in try/catch and `typeof === 'function'` guards
// so this module remains functional even if friends.js is removed.
// ============================================================================

// ─── Tunables ───────────────────────────────────────────────────────────────
var FC_COLLECTION         = 'friend_challenges';        // canonical, owner = recipient
var FC_OUTBOX             = 'friend_challenges_outbox'; // index, owner = sender
var FC_RL_PAIR_KEY        = 'fchg_pair';
var FC_RL_PAIR_MS         = 30000; // 30 s between sends to the same target
var FC_RL_GLOBAL_KEY      = 'fchg_global';
var FC_RL_GLOBAL_WINDOW_MS = 60000; // sliding window
var FC_RL_GLOBAL_MAX      = 20;     // 20 sends / min / sender
var FC_MAX_DATA_BYTES     = 4096;
var FC_MAX_REASON_LEN     = 280;
var FC_MAX_GAMEID_LEN     = 128;

// Status enum
var FC_STATUS_PENDING   = 'pending';
var FC_STATUS_ACCEPTED  = 'accepted';
var FC_STATUS_DECLINED  = 'declined';
var FC_STATUS_CANCELLED = 'cancelled';
var FC_STATUS_EXPIRED   = 'expired';

// Nakama friend states (from runtime API)
var FCF_STATE_FRIEND  = 0;
var FCF_STATE_BLOCKED = 3;

// ─── Tiny self-contained helpers (no external `utils` dependency) ──────────
// Same philosophy as friend_invites.js: bullet-proof regardless of merge order.

function _fcUuidValid(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function _fcNowIso() { return new Date().toISOString(); }
function _fcNowMs()  { return Date.now(); }

function _fcOk(extra) {
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
function _fcErr(message, errorCode, extra) {
    var out = { success: false, error: message, errorCode: errorCode || 'unknown' };
    if (extra) {
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
        }
    }
    return JSON.stringify(out);
}

function _fcParsePayload(payload) {
    if (!payload || payload === '') return { ok: true, data: {} };
    try { return { ok: true, data: JSON.parse(payload) }; }
    catch (e)  { return { ok: false, error: 'Invalid JSON payload: ' + e.message }; }
}

// Mint a server-authoritative challengeId.
//
// Prefers `nk.uuidv4()` (cryptographically random, available in Nakama JS
// runtime) and falls back to a timestamp + 24 random hex chars composite
// for environments where the API may have moved/renamed in a future runtime.
function _fcMintChallengeId(nk) {
    try {
        if (nk && typeof nk.uuidv4 === 'function') {
            return 'fchg_' + nk.uuidv4().replace(/-/g, '');
        }
    } catch (_) { /* fall through */ }
    var hex = '0123456789abcdef';
    var rand = '';
    for (var i = 0; i < 24; i++) {
        rand += hex.charAt(Math.floor(Math.random() * 16));
    }
    return 'fchg_' + Date.now().toString(36) + '_' + rand;
}

// Per-game expiry policy.  Returns seconds.
//   isAsync == true  → 24 h
//   isAsync == false → 5  min
//   gameId contains 'async' → 24 h
//   gameId contains 'sync'  → 5  min
//   default                  → 1  h
function _fcExpirySecondsForGame(gameId, isAsync) {
    if (isAsync === true)  return 24 * 3600;
    if (isAsync === false) return 5 * 60;
    if (typeof gameId === 'string') {
        var g = gameId.toLowerCase();
        if (g.indexOf('async') !== -1) return 24 * 3600;
        if (g.indexOf('sync')  !== -1) return 5 * 60;
    }
    return 3600;
}

// STRICT mutual-friend check using Nakama's native friend graph.
// Returns true ONLY for state == 0 (FRIEND).  Pending invites do NOT count.
function _fcAreFriends(nk, callerId, targetId) {
    try {
        // friendsList(userId, limit, state, cursor) — state == 0 limits the page
        // to confirmed friends only, which is materially cheaper than fetching
        // every relationship and filtering.
        var page = nk.friendsList(callerId, 1000, FCF_STATE_FRIEND, null);
        if (page && page.friends) {
            for (var i = 0; i < page.friends.length; i++) {
                var fr = page.friends[i];
                if (fr && fr.user && fr.user.id === targetId) return true;
            }
        }
    } catch (_) { /* fail-closed (deny on lookup error) */ }
    return false;
}

// One-direction block check via the legacy `user_blocks` storage collection
// that friends/friends.js populates.  Caller passes the BLOCKER first.
function _fcIsBlockedBy(nk, blockerUserId, blockedUserId) {
    try {
        var rows = nk.storageRead([{
            collection: 'user_blocks',
            key:        'blocked_' + blockerUserId + '_' + blockedUserId,
            userId:     blockerUserId
        }]);
        return !!(rows && rows.length > 0 && rows[0] && rows[0].value);
    } catch (_) { return false; /* fail-open on lookup error */ }
}

// Pair-level rate limit: at most 1 challenge from sender→target per 30 s.
// Also serves as natural double-submit protection.
function _fcCheckPairRateLimit(nk, senderId, targetId) {
    var key = FC_RL_PAIR_KEY + '_' + senderId + '_' + targetId;
    var now = _fcNowMs();
    try {
        var rows = nk.storageRead([{ collection: 'rate_limits', key: key, userId: senderId }]);
        if (rows && rows.length > 0 && rows[0].value && rows[0].value.timestamp) {
            var elapsed = now - rows[0].value.timestamp;
            if (elapsed < FC_RL_PAIR_MS) {
                return { allowed: false, retryAfterMs: FC_RL_PAIR_MS - elapsed };
            }
        }
    } catch (_) { /* fail-open */ }
    try {
        nk.storageWrite([{
            collection:      'rate_limits',
            key:             key,
            userId:          senderId,
            value:           { timestamp: now },
            permissionRead:  0, // server-only
            permissionWrite: 0
        }]);
    } catch (_) { /* non-critical */ }
    return { allowed: true };
}

// Global rate limit: at most 20 challenges per sender per 60 s window.
// Implemented as a sliding-window timestamp ring stored under the user.
function _fcCheckGlobalRateLimit(nk, senderId) {
    var key = FC_RL_GLOBAL_KEY + '_' + senderId;
    var now = _fcNowMs();
    var stamps = [];
    try {
        var rows = nk.storageRead([{ collection: 'rate_limits', key: key, userId: senderId }]);
        if (rows && rows.length > 0 && rows[0].value && rows[0].value.stamps) {
            stamps = rows[0].value.stamps;
        }
    } catch (_) { /* fail-open */ }
    var fresh = [];
    for (var i = 0; i < stamps.length; i++) {
        if ((now - stamps[i]) < FC_RL_GLOBAL_WINDOW_MS) fresh.push(stamps[i]);
    }
    if (fresh.length >= FC_RL_GLOBAL_MAX) {
        // Oldest stamp determines when the next slot frees up
        return { allowed: false, retryAfterMs: FC_RL_GLOBAL_WINDOW_MS - (now - fresh[0]) };
    }
    fresh.push(now);
    try {
        nk.storageWrite([{
            collection:      'rate_limits',
            key:             key,
            userId:          senderId,
            value:           { stamps: fresh },
            permissionRead:  0,
            permissionWrite: 0
        }]);
    } catch (_) { /* non-critical */ }
    return { allowed: true };
}

function _fcDisplayName(nk, userId, fallback) {
    try {
        var users = nk.usersGetId([userId]);
        if (users && users.length > 0 && users[0]) {
            return users[0].displayName || users[0].username || fallback || userId;
        }
    } catch (_) {}
    return fallback || userId;
}

function _fcReadChallenge(nk, challengeId, recipientId) {
    try {
        var rows = nk.storageRead([{
            collection: FC_COLLECTION, key: challengeId, userId: recipientId
        }]);
        if (rows && rows.length > 0 && rows[0].value) {
            return { value: rows[0].value, version: rows[0].version };
        }
    } catch (_) {}
    return null;
}

function _fcReadOutbox(nk, challengeId, senderId) {
    try {
        var rows = nk.storageRead([{
            collection: FC_OUTBOX, key: challengeId, userId: senderId
        }]);
        if (rows && rows.length > 0 && rows[0].value) {
            return { value: rows[0].value, version: rows[0].version };
        }
    } catch (_) {}
    return null;
}

function _fcWriteChallenge(nk, challenge, recipientId, version) {
    var rec = {
        collection:      FC_COLLECTION,
        key:             challenge.challengeId,
        userId:          recipientId,
        value:           challenge,
        permissionRead:  1,  // owner-readable
        permissionWrite: 0   // server-only
    };
    if (version) rec.version = version;
    nk.storageWrite([rec]);
}

function _fcWriteOutbox(nk, challenge, senderId, version) {
    // Mini index — keeps the sender's outbox small even if challengeData is big.
    var quizMode = '';
    if (challenge.challengeData) {
        quizMode = challenge.challengeData.modeName ||
                   challenge.challengeData.quizModeName || '';
    }
    var index = {
        challengeId:       challenge.challengeId,
        targetUserId:      challenge.toUserId,
        targetDisplayName: challenge.toDisplayName || '',
        gameId:            challenge.gameId,
        quizModeName:      quizMode,
        roomCode:          challenge.roomCode || '',
        shareCode:         challenge.shareCode || '',
        isAsync:           !!challenge.isAsync,
        status:            challenge.status,
        createdAt:         challenge.createdAt,
        expiresAt:         challenge.expiresAt,
        statusUpdatedAt:   challenge.updatedAt
    };
    var rec = {
        collection:      FC_OUTBOX,
        key:             challenge.challengeId,
        userId:          senderId,
        value:           index,
        permissionRead:  1,
        permissionWrite: 0
    };
    if (version) rec.version = version;
    nk.storageWrite([rec]);
}

// ============================================================================
// RPC: send_friend_challenge
// ============================================================================
// Replaces friends_challenge_user.  Both names are registered (legacy alias).
//
// Payload:
//   {
//     friendUserId: <UUID>,             // recipient
//     gameId:       <string, ≤128 chars>, // ANY string — we no longer require UUID
//     challengeData: {                   // ≤ 4 KB JSON
//       isAsync?:   boolean,
//       roomCode?:  string,
//       shareCode?: string,
//       modeName?:  string,
//       ...
//     },
//     correlationId?: <string>           // optimistic-UI hint, echoed back
//   }
//
// Response (success):
//   {
//     success: true,
//     challengeId, fromUserId, toUserId, gameId, status, roomCode, shareCode,
//     isAsync, expiresAt, timestamp, correlationId
//   }
//
// Response (failure): { success: false, error, errorCode, ... }
function rpcSendFriendChallenge(ctx, logger, nk, payload) {
    var senderId = ctx.userId;
    if (!senderId) return _fcErr('Authentication required', 'unauthenticated');

    var p = _fcParsePayload(payload);
    if (!p.ok) return _fcErr(p.error, 'invalid_payload');

    var data                = p.data || {};
    var targetUserId        = data.friendUserId || data.targetUserId;
    var gameId              = data.gameId;
    var rawData             = data.challengeData || {};
    var clientCorrelationId = data.correlationId || null;

    // ── Input validation ───────────────────────────────────────────────────
    if (!_fcUuidValid(targetUserId)) {
        return _fcErr('Invalid friendUserId (must be a UUID)', 'invalid_target');
    }
    if (targetUserId === senderId) {
        return _fcErr('Cannot challenge yourself', 'self_challenge');
    }
    if (!gameId || typeof gameId !== 'string') {
        return _fcErr('gameId is required (string)', 'invalid_payload');
    }
    if (gameId.length > FC_MAX_GAMEID_LEN) {
        return _fcErr('gameId is too long (max ' + FC_MAX_GAMEID_LEN + ')', 'invalid_payload');
    }
    if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) {
        return _fcErr('challengeData must be an object', 'invalid_payload');
    }
    var dataStr;
    try { dataStr = JSON.stringify(rawData); }
    catch (e) { return _fcErr('challengeData not serialisable: ' + e.message, 'invalid_payload'); }
    if (dataStr.length > FC_MAX_DATA_BYTES) {
        return _fcErr('challengeData too large (max ' + FC_MAX_DATA_BYTES + ' bytes)',
                      'data_too_large');
    }
    if (clientCorrelationId !== null &&
        (typeof clientCorrelationId !== 'string' || clientCorrelationId.length > 128)) {
        return _fcErr('correlationId must be a string ≤ 128 chars', 'invalid_payload');
    }

    // ── Mutual-friend gate (STRICT) ────────────────────────────────────────
    if (!_fcAreFriends(nk, senderId, targetUserId)) {
        return _fcErr('You can only challenge mutual friends', 'not_mutual_friends');
    }

    // ── Block checks (both directions) ─────────────────────────────────────
    if (_fcIsBlockedBy(nk, senderId, targetUserId)) {
        return _fcErr('You have blocked this user. Unblock them first.',
                      'caller_blocked_target');
    }
    if (_fcIsBlockedBy(nk, targetUserId, senderId)) {
        // Don't reveal — generic error
        return _fcErr('Unable to send challenge at this time', 'send_blocked');
    }

    // ── Rate limits (STRICT — pair AND global) ─────────────────────────────
    var pairRl = _fcCheckPairRateLimit(nk, senderId, targetUserId);
    if (!pairRl.allowed) {
        return _fcErr('Slow down — you challenged this friend recently',
                      'pair_rate_limited', { retryAfterMs: pairRl.retryAfterMs });
    }
    var globRl = _fcCheckGlobalRateLimit(nk, senderId);
    if (!globRl.allowed) {
        return _fcErr('Too many challenges in a short time',
                      'global_rate_limited', { retryAfterMs: globRl.retryAfterMs });
    }

    // ── Build canonical challenge record ───────────────────────────────────
    var nowMs    = _fcNowMs();
    var nowIso   = _fcNowIso();
    var isAsync  = (rawData.isAsync === true);
    var expirySec  = _fcExpirySecondsForGame(gameId, rawData.isAsync);
    var expiresMs  = nowMs + (expirySec * 1000);

    var challengeId  = _fcMintChallengeId(nk);
    var senderName   = _fcDisplayName(nk, senderId, ctx.username);
    var targetName   = _fcDisplayName(nk, targetUserId, '');

    var challenge = {
        challengeId:      challengeId,
        fromUserId:       senderId,
        fromUsername:     ctx.username || senderId,
        fromDisplayName:  senderName,
        toUserId:         targetUserId,
        toDisplayName:    targetName,
        gameId:           gameId,
        challengeData:    rawData,
        roomCode:         rawData.roomCode || rawData.shareCode || '',
        shareCode:        rawData.shareCode || rawData.roomCode || '',
        isAsync:          isAsync,
        status:           FC_STATUS_PENDING,
        createdAt:        nowIso,
        updatedAt:        nowIso,
        expiresAt:        new Date(expiresMs).toISOString(),
        expiresAtMs:      expiresMs,
        correlationId:    clientCorrelationId
    };

    // Canonical persist (under recipient — owner-readable for accept/decline)
    try {
        _fcWriteChallenge(nk, challenge, targetUserId, null);
    } catch (e) {
        logger.error('[FriendChallenges] storageWrite recipient failed: ' + e.message);
        return _fcErr('Failed to persist challenge', 'storage_write_failed');
    }

    // Outbox index persist (under sender — owner-readable for cancel/list)
    try {
        _fcWriteOutbox(nk, challenge, senderId, null);
    } catch (e) {
        // Non-fatal — sender just won't see this in their outgoing list until
        // the next successful write.  Canonical row is still authoritative.
        logger.warn('[FriendChallenges] outbox write failed (non-fatal): ' + e.message);
    }

    // ── Notify recipient (canonical Subject/Code contract) ─────────────────
    try {
        sendFriendsNotification(nk, logger, 'FRIEND_CHALLENGE_RECEIVED', targetUserId, {
            challengeId:     challengeId,
            fromUserId:      senderId,
            fromUsername:    ctx.username || senderId,
            fromDisplayName: senderName,
            gameId:          gameId,
            roomCode:        challenge.roomCode,
            shareCode:       challenge.shareCode,
            quizModeName:    (rawData.modeName || rawData.quizModeName || ''),
            isAsync:         isAsync,
            expiresAt:       challenge.expiresAt
        }, senderId);
    } catch (e) {
        logger.warn('[FriendChallenges] notify recipient failed: ' + e.message);
    }

    // ── Push notification (best-effort; helper lives in friends.js) ────────
    try {
        if (typeof sendChallengePushNotification === 'function') {
            sendChallengePushNotification(nk, logger, targetUserId, gameId, senderName,
                (rawData.modeName || rawData.quizModeName || 'Quiz'), challengeId,
                challenge.roomCode, isAsync);
        }
    } catch (e) {
        logger.warn('[FriendChallenges] push notification failed: ' + e.message);
    }

    // ── DM chat message (best-effort; helper lives in friends.js) ──────────
    try {
        if (typeof sendChallengeChatMessage === 'function') {
            sendChallengeChatMessage(nk, logger, senderId, targetUserId, senderName, {
                type:            'friend_challenge',
                challengeId:     challengeId,
                fromUserId:      senderId,
                fromDisplayName: senderName,
                gameId:          gameId,
                roomCode:        challenge.roomCode,
                shareCode:       challenge.shareCode,
                quizModeName:    (rawData.modeName || rawData.quizModeName || 'Quiz'),
                isAsync:         isAsync,
                expiresAt:       challenge.expiresAt
            });
        }
    } catch (e) {
        logger.warn('[FriendChallenges] chat insert failed: ' + e.message);
    }

    return _fcOk({
        challengeId:    challengeId,
        fromUserId:     senderId,
        toUserId:       targetUserId,
        gameId:         gameId,
        status:         FC_STATUS_PENDING,
        roomCode:       challenge.roomCode,
        shareCode:      challenge.shareCode,
        isAsync:        isAsync,
        expiresAt:      challenge.expiresAt,
        timestamp:      nowIso,
        correlationId:  clientCorrelationId
    });
}

// ============================================================================
// RPC: accept_friend_challenge
// ============================================================================
// Payload: { challengeId: <string> }
// Idempotent — second-tap accept returns success.
function rpcAcceptFriendChallenge(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) return _fcErr('Authentication required', 'unauthenticated');

    var p = _fcParsePayload(payload);
    if (!p.ok) return _fcErr(p.error, 'invalid_payload');

    var challengeId = (p.data || {}).challengeId;
    if (!challengeId || typeof challengeId !== 'string') {
        return _fcErr('challengeId is required', 'invalid_payload');
    }

    var read = _fcReadChallenge(nk, challengeId, userId);
    if (!read) return _fcErr('Challenge not found', 'challenge_not_found');

    var challenge = read.value;
    if (challenge.toUserId !== userId) {
        return _fcErr('This challenge is not for you', 'challenge_not_for_caller');
    }

    // Idempotent — second-tap "Accept" must not throw
    if (challenge.status === FC_STATUS_ACCEPTED) {
        return _fcOk({
            challengeId:     challengeId,
            alreadyAccepted: true,
            fromUserId:      challenge.fromUserId,
            fromDisplayName: challenge.fromDisplayName,
            gameId:          challenge.gameId,
            roomCode:        challenge.roomCode,
            shareCode:       challenge.shareCode,
            isAsync:         challenge.isAsync
        });
    }
    if (challenge.status !== FC_STATUS_PENDING) {
        return _fcErr('This challenge has already been ' + challenge.status,
                      'challenge_not_pending', { currentStatus: challenge.status });
    }

    // Lazy expiry sweep
    if (challenge.expiresAtMs && challenge.expiresAtMs < _fcNowMs()) {
        challenge.status    = FC_STATUS_EXPIRED;
        challenge.updatedAt = _fcNowIso();
        try { _fcWriteChallenge(nk, challenge, userId, read.version); } catch (_) {}
        return _fcErr('This challenge has expired', 'challenge_expired',
                      { currentStatus: FC_STATUS_EXPIRED });
    }

    // ── Transition to ACCEPTED with optimistic concurrency ─────────────────
    challenge.status     = FC_STATUS_ACCEPTED;
    challenge.acceptedAt = _fcNowIso();
    challenge.updatedAt  = _fcNowIso();

    try {
        _fcWriteChallenge(nk, challenge, userId, read.version);
    } catch (e) {
        return _fcErr('Failed to persist accept: ' + e.message, 'storage_write_failed');
    }

    // Sync sender's outbox index so their UI reflects the new status
    try {
        _fcWriteOutbox(nk, challenge, challenge.fromUserId, null);
    } catch (e) {
        logger.warn('[FriendChallenges] accept outbox sync failed: ' + e.message);
    }

    // Notify the sender
    try {
        sendFriendsNotification(nk, logger, 'FRIEND_CHALLENGE_ACCEPTED', challenge.fromUserId, {
            challengeId:           challengeId,
            acceptedBy:            userId,
            acceptedByDisplayName: _fcDisplayName(nk, userId, ctx.username),
            gameId:                challenge.gameId,
            roomCode:              challenge.roomCode,
            shareCode:             challenge.shareCode,
            isAsync:               challenge.isAsync
        }, userId);
    } catch (e) {
        logger.warn('[FriendChallenges] notify accept failed: ' + e.message);
    }

    return _fcOk({
        challengeId:     challengeId,
        status:          FC_STATUS_ACCEPTED,
        fromUserId:      challenge.fromUserId,
        fromDisplayName: challenge.fromDisplayName,
        gameId:          challenge.gameId,
        roomCode:        challenge.roomCode,
        shareCode:       challenge.shareCode,
        isAsync:         challenge.isAsync,
        acceptedAt:      challenge.acceptedAt
    });
}

// ============================================================================
// RPC: decline_friend_challenge
// ============================================================================
// Payload: { challengeId: <string>, reason?: <string ≤ 280> }
// Idempotent.
function rpcDeclineFriendChallenge(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) return _fcErr('Authentication required', 'unauthenticated');

    var p = _fcParsePayload(payload);
    if (!p.ok) return _fcErr(p.error, 'invalid_payload');

    var data        = p.data || {};
    var challengeId = data.challengeId;
    var reason      = data.reason || '';
    if (!challengeId || typeof challengeId !== 'string') {
        return _fcErr('challengeId is required', 'invalid_payload');
    }
    if (typeof reason !== 'string') reason = '';
    if (reason.length > FC_MAX_REASON_LEN) {
        reason = reason.substring(0, FC_MAX_REASON_LEN);
    }

    var read = _fcReadChallenge(nk, challengeId, userId);
    if (!read) return _fcErr('Challenge not found', 'challenge_not_found');

    var challenge = read.value;
    if (challenge.toUserId !== userId) {
        return _fcErr('This challenge is not for you', 'challenge_not_for_caller');
    }
    if (challenge.status === FC_STATUS_DECLINED) {
        return _fcOk({ challengeId: challengeId, alreadyDeclined: true });
    }
    if (challenge.status !== FC_STATUS_PENDING) {
        return _fcErr('This challenge has already been ' + challenge.status,
                      'challenge_not_pending', { currentStatus: challenge.status });
    }

    challenge.status        = FC_STATUS_DECLINED;
    challenge.declinedAt    = _fcNowIso();
    challenge.updatedAt     = _fcNowIso();
    if (reason) challenge.declineReason = reason;

    try {
        _fcWriteChallenge(nk, challenge, userId, read.version);
    } catch (e) {
        return _fcErr('Failed to persist decline: ' + e.message, 'storage_write_failed');
    }

    try {
        _fcWriteOutbox(nk, challenge, challenge.fromUserId, null);
    } catch (e) {
        logger.warn('[FriendChallenges] decline outbox sync failed: ' + e.message);
    }

    try {
        sendFriendsNotification(nk, logger, 'FRIEND_CHALLENGE_DECLINED', challenge.fromUserId, {
            challengeId: challengeId,
            declinedBy:  userId,
            reason:      reason
        }, userId);
    } catch (e) {
        logger.warn('[FriendChallenges] notify decline failed: ' + e.message);
    }

    return _fcOk({
        challengeId: challengeId,
        status:      FC_STATUS_DECLINED,
        declinedAt:  challenge.declinedAt
    });
}

// ============================================================================
// RPC: cancel_friend_challenge  (sender rescinds their own outgoing challenge)
// ============================================================================
// Payload: { challengeId: <string> }
// Idempotent.
function rpcCancelFriendChallenge(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) return _fcErr('Authentication required', 'unauthenticated');

    var p = _fcParsePayload(payload);
    if (!p.ok) return _fcErr(p.error, 'invalid_payload');

    var challengeId = (p.data || {}).challengeId;
    if (!challengeId || typeof challengeId !== 'string') {
        return _fcErr('challengeId is required', 'invalid_payload');
    }

    // Outbox under the sender is the only thing the caller can read directly.
    var outbox = _fcReadOutbox(nk, challengeId, userId);
    if (!outbox) {
        return _fcErr('Challenge not found in your outbox', 'challenge_not_found');
    }

    var indexRec    = outbox.value;
    var recipientId = indexRec.targetUserId;
    if (!recipientId) {
        return _fcErr('Outbox record corrupt (missing targetUserId)', 'outbox_invalid');
    }

    var read = _fcReadChallenge(nk, challengeId, recipientId);
    if (!read) {
        // Canonical record gone — clean up outbox and return idempotent success.
        try {
            nk.storageDelete([{
                collection: FC_OUTBOX, key: challengeId, userId: userId
            }]);
        } catch (_) {}
        return _fcOk({ challengeId: challengeId, status: FC_STATUS_CANCELLED,
                       alreadyGone: true });
    }

    var challenge = read.value;
    if (challenge.fromUserId !== userId) {
        return _fcErr('You can only cancel challenges you sent', 'challenge_not_owned');
    }
    if (challenge.status === FC_STATUS_CANCELLED) {
        return _fcOk({ challengeId: challengeId, alreadyCancelled: true });
    }
    if (challenge.status !== FC_STATUS_PENDING) {
        return _fcErr('Cannot cancel a ' + challenge.status + ' challenge',
                      'challenge_not_pending', { currentStatus: challenge.status });
    }

    challenge.status      = FC_STATUS_CANCELLED;
    challenge.cancelledAt = _fcNowIso();
    challenge.updatedAt   = _fcNowIso();

    try {
        _fcWriteChallenge(nk, challenge, recipientId, read.version);
    } catch (e) {
        return _fcErr('Failed to persist cancel: ' + e.message, 'storage_write_failed');
    }

    try {
        _fcWriteOutbox(nk, challenge, userId, outbox.version);
    } catch (e) {
        logger.warn('[FriendChallenges] cancel outbox sync failed: ' + e.message);
    }

    try {
        sendFriendsNotification(nk, logger, 'FRIEND_CHALLENGE_CANCELLED', recipientId, {
            challengeId: challengeId,
            cancelledBy: userId
        }, userId);
    } catch (e) {
        logger.warn('[FriendChallenges] notify cancel failed: ' + e.message);
    }

    return _fcOk({
        challengeId: challengeId,
        status:      FC_STATUS_CANCELLED,
        cancelledAt: challenge.cancelledAt
    });
}

// ============================================================================
// RPC: list_pending_friend_challenges
// ============================================================================
// Payload: { limit?: int (1..100, default 50), includeExpired?: bool }
// Returns BOTH incoming and outgoing pending challenges for the caller.
//
// As a side effect, performs LAZY expiry sweep: any pending row whose
// expiresAtMs < now is transitioned to `expired` (and persisted) before
// being returned.  This eliminates the need for a scheduled sweeper job.
function rpcListPendingFriendChallenges(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) return _fcErr('Authentication required', 'unauthenticated');

    var p = _fcParsePayload(payload);
    if (!p.ok) return _fcErr(p.error, 'invalid_payload');

    var data           = p.data || {};
    var limit          = parseInt(data.limit) || 50;
    var includeExpired = data.includeExpired === true;
    if (limit < 1)   limit = 1;
    if (limit > 100) limit = 100;

    var nowMs = _fcNowMs();

    // ── Incoming: scan friend_challenges owned by caller ───────────────────
    var incoming = [];
    try {
        var page = nk.storageList(userId, FC_COLLECTION, limit, null);
        var objects = (page && page.objects) ? page.objects : (page || []);
        for (var i = 0; i < objects.length; i++) {
            var o = objects[i];
            if (!o || !o.value) continue;
            var c = o.value;
            if (c.toUserId !== userId) continue; // safety

            // Lazy expiry sweep
            if (c.status === FC_STATUS_PENDING && c.expiresAtMs && c.expiresAtMs < nowMs) {
                c.status    = FC_STATUS_EXPIRED;
                c.updatedAt = _fcNowIso();
                try { _fcWriteChallenge(nk, c, userId, o.version); } catch (_) {}
                // Also fire an EXPIRED notification to the SENDER so their
                // outbox UI clears without polling.
                try {
                    sendFriendsNotification(nk, logger, 'FRIEND_CHALLENGE_EXPIRED',
                        c.fromUserId, {
                            challengeId: c.challengeId,
                            expiredFor:  userId
                        }, userId);
                } catch (_) {}
            }

            if (c.status !== FC_STATUS_PENDING && !includeExpired) continue;

            incoming.push({
                challengeId:     c.challengeId,
                fromUserId:      c.fromUserId,
                fromUsername:    c.fromUsername,
                fromDisplayName: c.fromDisplayName,
                gameId:          c.gameId,
                roomCode:        c.roomCode || '',
                shareCode:       c.shareCode || '',
                isAsync:         !!c.isAsync,
                quizModeName:    (c.challengeData &&
                                  (c.challengeData.modeName || c.challengeData.quizModeName)) || '',
                status:          c.status,
                createdAt:       c.createdAt,
                expiresAt:       c.expiresAt
            });
        }
    } catch (e) {
        logger.warn('[FriendChallenges] list incoming failed: ' + e.message);
    }

    // ── Outgoing: scan caller's outbox index ───────────────────────────────
    var outgoing = [];
    try {
        var page2 = nk.storageList(userId, FC_OUTBOX, limit, null);
        var objects2 = (page2 && page2.objects) ? page2.objects : (page2 || []);
        for (var j = 0; j < objects2.length; j++) {
            var o2 = objects2[j];
            if (!o2 || !o2.value) continue;
            var ix = o2.value;

            // Refresh from canonical (recipient may have accepted/declined since
            // our index was last written).
            var canonical = _fcReadChallenge(nk, ix.challengeId, ix.targetUserId);
            var status      = ix.status;
            var expiresAtMs = ix.expiresAt ? new Date(ix.expiresAt).getTime() : 0;
            if (canonical) {
                status      = canonical.value.status;
                expiresAtMs = canonical.value.expiresAtMs || expiresAtMs;
                // Heal index if drifted (cheap write)
                if (status !== ix.status) {
                    ix.status          = status;
                    ix.statusUpdatedAt = canonical.value.updatedAt;
                    try {
                        nk.storageWrite([{
                            collection:      FC_OUTBOX,
                            key:             ix.challengeId,
                            userId:          userId,
                            value:           ix,
                            version:         o2.version,
                            permissionRead:  1,
                            permissionWrite: 0
                        }]);
                    } catch (_) {}
                }
            }
            if (status === FC_STATUS_PENDING && expiresAtMs && expiresAtMs < nowMs) {
                status = FC_STATUS_EXPIRED;
            }
            if (status !== FC_STATUS_PENDING && !includeExpired) continue;

            outgoing.push({
                challengeId:       ix.challengeId,
                targetUserId:      ix.targetUserId,
                targetDisplayName: ix.targetDisplayName,
                gameId:            ix.gameId,
                quizModeName:      ix.quizModeName || '',
                roomCode:          ix.roomCode || '',
                shareCode:         ix.shareCode || '',
                isAsync:           !!ix.isAsync,
                status:            status,
                createdAt:         ix.createdAt,
                expiresAt:         ix.expiresAt
            });
        }
    } catch (e) {
        logger.warn('[FriendChallenges] list outgoing failed: ' + e.message);
    }

    return _fcOk({
        incoming:      incoming,
        outgoing:      outgoing,
        incomingCount: incoming.length,
        outgoingCount: outgoing.length
    });
}

// ============================================================================
// RPC: friends_spectate  (hardened in-place; replaces legacy stub)
// ============================================================================
// Payload: { friendUserId: <UUID> }
//
// Responds with the friend's active matchId (if any) AND fires a
// FRIEND_SPECTATE_REQUEST notification (code 105) to the friend so their
// client can confirm/deny via the spectate-popup UI.  This is the hardened
// replacement for the legacy `rpcFriendsSpectate` in friends/friends.js
// (which is no longer registered — see legacy_runtime.js for the removal).
//
// What changed vs legacy:
//   - Strict mutual-friend gate (state == 0) [was: same]
//   - Explicit reverse-direction block check (target-blocked-caller)
//   - Per-pair rate limit (1 request per 30 s) — same key-space as challenge
//   - Notifies the FRIEND with canonical code/subject (was: silent)
//   - Idempotent — no storage write, just a read + notify
function rpcFriendsSpectate(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) return _fcErr('Authentication required', 'unauthenticated');

    var p = _fcParsePayload(payload);
    if (!p.ok) return _fcErr(p.error, 'invalid_payload');

    var data         = p.data || {};
    var friendUserId = data.friendUserId || data.targetUserId;

    if (!_fcUuidValid(friendUserId)) {
        return _fcErr('Invalid friendUserId (must be a UUID)', 'invalid_target');
    }
    if (friendUserId === userId) {
        return _fcErr('Cannot spectate yourself', 'self_spectate');
    }

    // Mutual-friend gate
    if (!_fcAreFriends(nk, userId, friendUserId)) {
        return _fcErr('You can only spectate mutual friends', 'not_mutual_friends');
    }

    // Block checks (both directions)
    if (_fcIsBlockedBy(nk, userId, friendUserId)) {
        return _fcErr('You have blocked this user', 'caller_blocked_target');
    }
    if (_fcIsBlockedBy(nk, friendUserId, userId)) {
        return _fcErr('Unable to spectate this friend', 'spectate_blocked');
    }

    // Per-pair rate limit (re-uses the same 30 s key-space as challenges so
    // that a sender can't bypass the challenge cooldown by spamming spectate
    // requests).
    var pairRl = _fcCheckPairRateLimit(nk, userId, friendUserId);
    if (!pairRl.allowed) {
        return _fcErr('Slow down — you spectated this friend recently',
                      'pair_rate_limited', { retryAfterMs: pairRl.retryAfterMs });
    }

    // Look up friend's active match (best-effort)
    var matchId = null;
    var online  = false;
    try {
        var accounts = nk.usersGetId([friendUserId]);
        if (accounts && accounts.length > 0 && accounts[0]) {
            online = !!accounts[0].online;
        }
    } catch (e) {
        logger.warn('[FriendChallenges] usersGetId failed in spectate: ' + e.message);
    }

    try {
        var matchRows = nk.storageRead([{
            collection: 'active_matches',
            key:        'current_match',
            userId:     friendUserId
        }]);
        if (matchRows && matchRows.length > 0 && matchRows[0].value &&
            matchRows[0].value.matchId) {
            matchId = matchRows[0].value.matchId;
        }
    } catch (e) {
        logger.warn('[FriendChallenges] active_matches read failed: ' + e.message);
    }

    // Notify the friend that someone wants to spectate (canonical code 105)
    try {
        var requesterName = _fcDisplayName(nk, userId, ctx.username);
        sendFriendsNotification(nk, logger, 'FRIEND_SPECTATE_REQUEST', friendUserId, {
            fromUserId:      userId,
            fromUsername:    ctx.username || userId,
            fromDisplayName: requesterName,
            matchId:         matchId || ''
        }, userId);
    } catch (e) {
        logger.warn('[FriendChallenges] notify spectate request failed: ' + e.message);
    }

    return _fcOk({
        userId:        userId,
        friendUserId:  friendUserId,
        matchId:       matchId || '',
        online:        online,
        spectateReady: !!matchId,
        timestamp:     _fcNowIso()
    });
}

// ============================================================================
// Module Init — register all friend-challenge RPCs (+ legacy alias)
// ============================================================================
// postbuild.js renames this `InitModule` to `__ModuleInit_N` (only one
// InitModule allowed in the merged output) and rewrites every
// `initializer.registerRpc("id", handler)` into
// `__rpc_id = __rpc_id || handler` (guarded — first declaration wins) which
// is then replayed at global scope on every Goja VM.
//
// IMPORTANT: legacy_runtime.js's `friends_challenge_user` registration must
// stay removed / commented so it doesn't compete with our handler.
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('send_friend_challenge',          rpcSendFriendChallenge);
    initializer.registerRpc('friends_challenge_user',         rpcSendFriendChallenge); // legacy alias
    initializer.registerRpc('accept_friend_challenge',        rpcAcceptFriendChallenge);
    initializer.registerRpc('decline_friend_challenge',       rpcDeclineFriendChallenge);
    initializer.registerRpc('cancel_friend_challenge',        rpcCancelFriendChallenge);
    initializer.registerRpc('list_pending_friend_challenges', rpcListPendingFriendChallenges);
    initializer.registerRpc('friends_spectate',               rpcFriendsSpectate); // hardened replacement

    if (logger && logger.info) {
        logger.info('[FriendChallenges] Registered 7 RPCs (send + alias + 4 lifecycle + spectate)');
    }
}
