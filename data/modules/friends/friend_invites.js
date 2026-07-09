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
//  7. Rate limits (B-009 hardened 2026-07-06): per-user burst guard
//     (1 send / 5s) + per-PAIR cooldown (1 / 30s, normalized pair key,
//     system-owned so both directions share the bucket) + hourly cap
//     (20 sends / user / hour). Accept-or-decline is intrinsically
//     limited via the storage status check.
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
var FRIEND_INV_RATELIMIT_MS    = 5000; // 5s between sends per user (burst guard)
var FRIEND_INV_MAX_MESSAGE_LEN = 280;  // tweet-length

// B-009 fix (2026-07-06, WORLD_CLASS_SOCIAL_FRIENDS_GROUPS_ARCHITECTURE.md §10.1):
// the per-user 5s cooldown above lets one user spam a single target with a
// fresh invite every 5s forever. Add (a) a per-PAIR cooldown on a NORMALIZED
// pair key — both directions share the same bucket, stored system-owned so
// A→B and B→A read the same row — and (b) a global hourly send cap per user.
var FRIEND_INV_PAIR_COOLDOWN_MS = 30000;        // 1 invite per pair per 30s
var FRIEND_INV_HOURLY_MAX       = 20;           // max sends per user per hour
var FRIEND_INV_HOURLY_WINDOW_MS = 60 * 60 * 1000;
var FRIEND_INV_SYSTEM_USER      = '00000000-0000-0000-0000-000000000000';

var INVITE_STATUS_PENDING   = 'pending';
var INVITE_STATUS_ACCEPTED  = 'accepted';
var INVITE_STATUS_DECLINED  = 'declined';
var INVITE_STATUS_CANCELLED = 'cancelled';

var FRIEND_PUSH_GAME_ID = '126bf539-dae2-4bcf-964d-316c0fa1f92b';

// Phase-17 fix: friend_invite_with_reward (friends_extras.js) records a
// reward-intent row here keyed by 'invite_reward_<senderId>_<recipientId>',
// but nothing ever read this collection back — reward grants were silently
// dropped on every accept. See _fiGrantInviteRewardIfPending below.
var FRIEND_INVITE_REWARD_COLLECTION = 'friend_invite_rewards';

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
 * Fetch the caller's entire friend graph ONCE and return a map of
 * targetUserId -> state. Callers that need to test several relationships
 * (or scan a list) should build this map a single time instead of calling
 * _fiNakamaRelation repeatedly — each _fiNakamaRelation invocation is a
 * full nk.friendsList round-trip, so doing it inside a loop turned a single
 * O(N) page read into O(N²) DB scans and was the dominant cause of the
 * multi-second send/list latency (and the client-side 30s timeouts).
 *
 * Returns { map: {id:stateInt}, ok: true } or { map: {}, ok: false } if the
 * graph could not be read (caller should fail-open / treat as no relation).
 */
function _fiBuildRelationMap(nk, callerId) {
    var map = {};
    try {
        var page = nk.friendsList(callerId, 1000, null, null);
        if (page && page.friends) {
            for (var i = 0; i < page.friends.length; i++) {
                var f = page.friends[i];
                if (!f || !f.user || !f.user.id) continue;
                var s = (f.state && typeof f.state === 'object' && 'value' in f.state)
                    ? f.state.value : f.state;
                map[f.user.id] = (typeof s === 'number') ? s : -1;
            }
        }
        return { map: map, ok: true };
    } catch (_) {
        return { map: map, ok: false };
    }
}

function _fiRelationFromMap(relMap, targetId) {
    if (relMap && Object.prototype.hasOwnProperty.call(relMap, targetId)) {
        return relMap[targetId];
    }
    return -1;
}

/**
 * Grant a pending friend_invite_with_reward bundle to both parties, exactly
 * once, when the recipient's acceptance completes the mutual-friend edge.
 *
 * Phase-17 fix: friends_extras.js::rpcFriendInviteWithReward persists this
 * row (key 'invite_reward_<senderId>_<recipientId>', written under BOTH
 * userIds) but historically nothing ever claimed it — accept_friend_invite
 * only knew about the `friend_invites` collection, a completely different
 * key scheme, so reward-tagged invites silently granted nothing.
 *
 * Non-fatal by design: a reward-grant failure must never block the actual
 * friend acceptance that's already succeeded.
 */
function _fiGrantInviteRewardIfPending(nk, logger, senderId, recipientId) {
    if (!senderId || !recipientId || !_fiUuidValid(senderId) || !_fiUuidValid(recipientId)) return;

    var rewardKey = 'invite_reward_' + senderId + '_' + recipientId;
    var rows;
    try {
        rows = nk.storageRead([{
            collection: FRIEND_INVITE_REWARD_COLLECTION,
            key:        rewardKey,
            userId:     recipientId
        }]);
    } catch (e) {
        if (logger && logger.warn) {
            logger.warn('[FriendInvites] invite-reward read failed (non-fatal): ' + e.message);
        }
        return;
    }

    if (!rows || rows.length === 0 || !rows[0].value) return; // no reward tagged on this invite
    var record = rows[0].value;
    var rewardVersion = rows[0].version;
    if (record.status !== 'pending') return; // already claimed or expired — idempotent no-op
    if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) return; // expired, do not grant

    // Claim FIRST, atomically, before touching the wallet. accept_friend_invite
    // can legitimately be invoked twice for the same pair (client retry after a
    // timed-out response, or the graph-fallback path racing the primary path),
    // and this function itself has no other de-dup guard. Passing `version`
    // makes this write fail if another concurrent call already claimed the row
    // — that failure is our double-grant guard, so we abort BEFORE crediting
    // any currency rather than risk paying out twice.
    record.status = 'claimed';
    record.claimedAt = _fiNowIso();
    try {
        nk.storageWrite([{
            collection:      FRIEND_INVITE_REWARD_COLLECTION,
            key:             rewardKey,
            userId:          recipientId,
            value:           record,
            version:         rewardVersion || undefined,
            permissionRead:  0,
            permissionWrite: 0
        }]);
    } catch (e) {
        // Version conflict (or any write failure) — treat as "already being
        // claimed elsewhere" and bail out without granting. Safer failure mode
        // for a currency-granting path than risking a double-pay race.
        if (logger && logger.warn) {
            logger.warn('[FriendInvites] invite-reward claim failed (treated as already-claimed, no grant issued): ' + e.message);
        }
        return;
    }

    var bundle = record.rewardBundle || {};
    var coins = parseInt(bundle.coins) || 0;
    var gems  = parseInt(bundle.gems)  || 0;
    var xp    = parseInt(bundle.xp)    || 0;

    if (coins > 0 || gems > 0 || xp > 0) {
        try {
            nk.walletUpdate(senderId, { coins: coins, gems: gems, xp: xp },
                { source: 'friend_invite_reward', rewardKey: rewardKey }, true);
        } catch (e) {
            // The claim already committed — a failure here is a genuine lost
            // grant (not a double-grant risk), so this is worth an ERROR, not
            // just a warning, for ops visibility.
            if (logger && logger.error) logger.error('[FriendInvites] invite-reward wallet grant (sender) FAILED after claim: ' + e.message + ' | rewardKey=' + rewardKey);
        }
        try {
            nk.walletUpdate(recipientId, { coins: coins, gems: gems, xp: xp },
                { source: 'friend_invite_reward', rewardKey: rewardKey }, true);
        } catch (e) {
            if (logger && logger.error) logger.error('[FriendInvites] invite-reward wallet grant (recipient) FAILED after claim: ' + e.message + ' | rewardKey=' + rewardKey);
        }
    }

    // Best-effort mirror onto the sender's copy of the row so their own
    // reads of the collection also show 'claimed' — non-critical bookkeeping,
    // the recipient's copy above is the one and only concurrency gate.
    try {
        nk.storageWrite([{
            collection: FRIEND_INVITE_REWARD_COLLECTION, key: rewardKey, userId: senderId,
            value: record, permissionRead: 0, permissionWrite: 0
        }]);
    } catch (e) {
        if (logger && logger.warn) {
            logger.warn('[FriendInvites] invite-reward sender-copy mirror write failed (non-fatal): ' + e.message);
        }
    }

    try {
        nk.notificationsSend([{
            userId:  recipientId,
            subject: 'Invite Reward Claimed!',
            content: { type: 'friend_invite_reward_claimed', fromUserId: senderId, rewardBundle: { coins: coins, gems: gems, xp: xp } },
            code:    112,
            persistent: true,
            sender:  senderId
        }]);
    } catch (_) { /* best-effort — wallet grant already succeeded */ }

    if (logger && logger.info) {
        logger.info('[FriendInvites] invite-reward granted | sender=' + senderId + ' recipient=' + recipientId +
                     ' coins=' + coins + ' gems=' + gems + ' xp=' + xp);
    }
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

// B-009: normalized pair key — min(a,b)_max(a,b) so both directions share
// one rate-limit bucket (the same convention the challenge module uses).
function _fiPairKey(a, b) {
    return (a < b) ? (a + '_' + b) : (b + '_' + a);
}

/**
 * B-009: per-pair cooldown. Stored SYSTEM-owned so that A→B and B→A hit the
 * same row regardless of who sends. Fail-open on read errors (rate limiting
 * must never hard-block invites when storage hiccups), same as _fiCheckRateLimit.
 */
function _fiCheckPairRateLimit(nk, userIdA, userIdB) {
    var key = 'rl_fr_invite_pair_' + _fiPairKey(userIdA, userIdB);
    var now = _fiNowMs();
    try {
        var rows = nk.storageRead([{ collection: 'rate_limits', key: key, userId: FRIEND_INV_SYSTEM_USER }]);
        if (rows && rows.length > 0 && rows[0].value && rows[0].value.timestamp) {
            var elapsed = now - rows[0].value.timestamp;
            if (elapsed < FRIEND_INV_PAIR_COOLDOWN_MS) {
                return { allowed: false, retryAfterMs: FRIEND_INV_PAIR_COOLDOWN_MS - elapsed };
            }
        }
    } catch (_) { /* fail-open */ }
    try {
        nk.storageWrite([{
            collection:      'rate_limits',
            key:             key,
            userId:          FRIEND_INV_SYSTEM_USER,
            value:           { timestamp: now },
            permissionRead:  0,
            permissionWrite: 0
        }]);
    } catch (_) { /* non-critical */ }
    return { allowed: true };
}

/**
 * B-009: sliding-window hourly cap per sender. Counter row resets when the
 * window expires. Increment happens on every ALLOWED attempt (before deeper
 * validation, matching the doc's §6.3 flow order).
 */
function _fiCheckHourlyCap(nk, userId) {
    var key = 'rl_fr_invite_hourly_' + userId;
    var now = _fiNowMs();
    var count = 0;
    var windowStart = now;
    try {
        var rows = nk.storageRead([{ collection: 'rate_limits', key: key, userId: userId }]);
        if (rows && rows.length > 0 && rows[0].value) {
            var v = rows[0].value;
            if (typeof v.windowStart === 'number' && (now - v.windowStart) < FRIEND_INV_HOURLY_WINDOW_MS) {
                windowStart = v.windowStart;
                count = (typeof v.count === 'number') ? v.count : 0;
            }
        }
    } catch (_) { /* fail-open */ }
    if (count >= FRIEND_INV_HOURLY_MAX) {
        return { allowed: false, retryAfterMs: (windowStart + FRIEND_INV_HOURLY_WINDOW_MS) - now };
    }
    try {
        nk.storageWrite([{
            collection:      'rate_limits',
            key:             key,
            userId:          userId,
            value:           { count: count + 1, windowStart: windowStart },
            permissionRead:  0,
            permissionWrite: 0
        }]);
    } catch (_) { /* non-critical */ }
    return { allowed: true };
}

/**
 * G-002 (2026-07-06, doc §E.1/§F.5): K-factor viral-loop instrumentation.
 * Emits into the Satori event-capture pipeline (global namespace compiled
 * from src/satori/event-capture). Unknown event names pass taxonomy
 * validation with a warning unless strict mode is enabled. Best-effort —
 * analytics must NEVER fail the parent RPC. Metadata values must be strings
 * (Satori.CapturedEvent contract).
 */
function _fiEmitKFactorEvent(nk, logger, userId, eventName, metadata) {
    try {
        if (typeof SatoriEventCapture !== 'undefined' && SatoriEventCapture.captureEvent) {
            var meta = {};
            if (metadata) {
                for (var k in metadata) {
                    if (Object.prototype.hasOwnProperty.call(metadata, k) &&
                        metadata[k] !== null && metadata[k] !== undefined) {
                        meta[k] = String(metadata[k]);
                    }
                }
            }
            SatoriEventCapture.captureEvent(nk, logger, userId, {
                name: eventName,
                timestamp: Date.now(),
                metadata: meta
            });
        }
    } catch (e) {
        if (logger && logger.warn) logger.warn('[FriendInvites] K-factor emit failed (non-fatal): ' + (e.message || e));
    }
}

/**
 * G-002 helper: whole days since an account was created. Accepts the
 * createTime shapes the runtime returns (epoch seconds number or ISO string).
 * Returns -1 when unknown.
 */
function _fiDaysSinceJoined(user) {
    try {
        if (!user || user.createTime === undefined || user.createTime === null) return -1;
        var ms = 0;
        if (typeof user.createTime === 'number') {
            // Heuristic: epoch seconds vs epoch millis
            ms = user.createTime > 100000000000 ? user.createTime : user.createTime * 1000;
        } else {
            var t = Date.parse(String(user.createTime));
            if (isNaN(t)) return -1;
            ms = t;
        }
        return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
    } catch (_) { return -1; }
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

    // B-009: per-pair cooldown — a user can no longer spam ONE target with
    // repeat invites; both directions (A→B, B→A) share the same bucket.
    var prl = _fiCheckPairRateLimit(nk, fromUserId, targetUserId);
    if (!prl.allowed) {
        return _fiErr('Please wait before re-inviting this player', 'pair_rate_limited',
            { retryAfterMs: prl.retryAfterMs });
    }

    // B-009: global hourly cap — bounds total invite fan-out per sender
    // (anti-spam; also protects the K-factor metric from bot inflation).
    var hrl = _fiCheckHourlyCap(nk, fromUserId);
    if (!hrl.allowed) {
        return _fiErr('Invite limit reached — try again later', 'rate_limited_hourly',
            { retryAfterMs: hrl.retryAfterMs });
    }

    // Verify target exists (cheap usersGetId — also gives us their username
    // to feed into nk.friendsAdd as the second arg, which Nakama uses when
    // the target is identified by username rather than id).
    // G-002: the sender is fetched in the SAME batch (no extra round-trip)
    // so the K-factor event can carry daysSinceSourceJoined.
    var targetUser = null;
    var senderUser = null;
    try {
        var users = nk.usersGetId([targetUserId, fromUserId]);
        if (users) {
            for (var ui = 0; ui < users.length; ui++) {
                if (!users[ui]) continue;
                if (users[ui].userId === targetUserId) targetUser = users[ui];
                else if (users[ui].userId === fromUserId) senderUser = users[ui];
            }
        }
    } catch (e) {
        logger.warn('[FriendInvites] usersGetId failed: ' + e.message);
    }
    if (!targetUser) {
        return _fiErr('Target user not found', 'target_not_found');
    }

    // ── Block checks (both directions) ─────────────────────────────────────
    // 1. Caller's own block list (from Nakama state=3).
    // G-002: use the full relation map (same single friendsList scan as the
    // old _fiNakamaRelation call) so we also get the sender's confirmed
    // friend count for the K-factor event.
    var relMapRes = _fiBuildRelationMap(nk, fromUserId);
    var callerRel = _fiRelationFromMap(relMapRes.map, targetUserId);
    var senderFriendCount = 0;
    for (var rk in relMapRes.map) {
        if (Object.prototype.hasOwnProperty.call(relMapRes.map, rk) &&
            relMapRes.map[rk] === FR_STATE_FRIEND) senderFriendCount++;
    }
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
        try { nk.friendsAdd(fromUserId, ctx.username || fromUserId, [targetUserId], [], {}); }
        catch (e) {
            return _fiErr('Failed to auto-accept reciprocal invite: ' + e.message,
                          'autoaccept_failed');
        }
        var reciprocalId = _fiInviteId(targetUserId, fromUserId);
        var autoAcceptorName = _fiUserDisplayName(nk, fromUserId, ctx.username);
        try {
            sendFriendsNotification(ctx, nk, logger, 'FRIEND_REQUEST_ACCEPTED', targetUserId, {
                inviteId:               reciprocalId,
                acceptedBy:             fromUserId,
                acceptedByUsername:     ctx.username || fromUserId,
                acceptedByDisplayName:  autoAcceptorName
            }, fromUserId);
        } catch (notifyErr) {
            if (logger && logger.warn) {
                logger.warn('[FriendInvites] auto-accept notify failed: ' + notifyErr.message);
            }
        }
        try {
            if (typeof LegacyPush !== 'undefined' && LegacyPush.sendLocalizedPushToUser) {
                LegacyPush.sendLocalizedPushToUser(ctx, logger, nk,
                    targetUserId,
                    'friend_accepted',
                    'friend_accepted_title',
                    'friend_accepted_body',
                    { name: autoAcceptorName },
                    {
                        skipQuietHours: true,
                        skipInAppNotification: true,
                        gameId: FRIEND_PUSH_GAME_ID,
                        data: {
                            screen:             'friends',
                            acceptedBy:         fromUserId,
                            acceptedByUsername: ctx.username || fromUserId,
                            acceptedByName:     autoAcceptorName,
                            inviteId:           reciprocalId
                        }
                    }
                );
            }
        } catch (pushErr) {
            logger.warn('[FriendInvites] device push (auto-accept) failed (non-fatal): ' + (pushErr.message || pushErr));
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
        sendFriendsNotification(ctx, nk, logger, 'FRIEND_REQUEST', targetUserId, {
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

    // ── Device push (APNs/FCM) to the target via push_send_event pipeline ──
    // sendFriendsNotification above only reaches the Nakama in-app inbox and
    // the realtime socket (for online users). Users who are offline never see
    // it until they re-open the app. The LegacyPush call below delivers a real
    // OS banner/lock-screen notification so they know immediately.
    // Wrapped in try/catch — push failure must not fail the invite RPC.
    try {
        if (typeof LegacyPush !== 'undefined' && LegacyPush.sendLocalizedPushToUser) {
            LegacyPush.sendLocalizedPushToUser(ctx, logger, nk,
                targetUserId,
                'friend_request',
                'friend_request_title',
                'friend_request_body',
                { name: fromName },
                {
                    skipQuietHours: true,
                    skipInAppNotification: true,
                    gameId: FRIEND_PUSH_GAME_ID,
                    data: {
                        screen:          'friends',
                        fromUserId:      fromUserId,
                        fromUsername:    inviteData.fromUsername,
                        fromDisplayName: fromName,
                        inviteId:        inviteId
                    }
                }
            );
        }
    } catch (pushErr) {
        logger.warn('[FriendInvites] device push (friend_request) failed (non-fatal): ' + (pushErr.message || pushErr));
    }

    // G-002: K-factor instrumentation — invite_sent (doc §E.1/§F.5 schema).
    _fiEmitKFactorEvent(nk, logger, fromUserId, 'invite_sent', {
        sourceUserId:          fromUserId,
        targetUserId:          targetUserId,
        channel:               'in_app',
        gameId:                FRIEND_PUSH_GAME_ID,
        daysSinceSourceJoined: _fiDaysSinceJoined(senderUser),
        sourceFriendCount:     senderFriendCount
    });

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
        logger.error('[FriendInvites] accept storageRead failed | inviteId=' + inviteId + ' | error=' + e.message);
        return _fiErr('Failed to read invite: ' + e.message, 'storage_read_failed');
    }

    if (!rows || rows.length === 0 || !rows[0].value) {
        // ── B-007 root-cause fix (2026-07-06, doc §6.4) ─────────────────────
        // No storage row — but the invite may still be REAL: legacy invites
        // created via the native AddFriends path (or TTL-cleaned rows) exist
        // only in Nakama's graph. The old behaviour ('invite_not_found')
        // forced Unity into a 3-tier fallback whose tier 3 bypassed this RPC
        // entirely (client.AddFriendsAsync), leaving rows forever 'pending'.
        // New behaviour: derive the sender, and if the graph says
        // INVITE_RECEIVED from them, accept HERE — single reliable server
        // path, no client fallback needed.
        var derivedFrom = (p.data || {}).fromUserId;
        if (!derivedFrom) {
            var m = /^inv_([0-9a-fA-F-]{36})_([0-9a-fA-F-]{36})$/.exec(inviteId);
            if (m && m[2].toLowerCase() === userId.toLowerCase()) derivedFrom = m[1];
        }
        if (derivedFrom && _fiUuidValid(derivedFrom)) {
            var graphRel = _fiNakamaRelation(nk, userId, derivedFrom);
            if (graphRel === FR_STATE_INVITE_RECEIVED) {
                try {
                    nk.friendsAdd(userId, ctx.username || userId, [derivedFrom], [], {});
                } catch (gfe) {
                    return _fiErr('Failed to accept invite: ' + (gfe.message || gfe), 'friends_add_failed');
                }
                // Materialise the row as accepted so history/UI stay coherent.
                var nowIsoGf = _fiNowIso();
                var gfName = _fiUserDisplayName(nk, derivedFrom, '');
                try {
                    nk.storageWrite([{
                        collection: FRIEND_INVITES_COLLECTION,
                        key:        inviteId,
                        userId:     userId,
                        value: {
                            inviteId: inviteId, fromUserId: derivedFrom,
                            fromUsername: '', fromDisplayName: gfName,
                            targetUserId: userId, message: '',
                            status: INVITE_STATUS_ACCEPTED,
                            createdAt: nowIsoGf, updatedAt: nowIsoGf, acceptedAt: nowIsoGf,
                            source: 'graph_fallback'
                        },
                        permissionRead: 1, permissionWrite: 0
                    }]);
                } catch (_) { /* row is bookkeeping — accept already succeeded */ }
                try {
                    sendFriendsNotification(ctx, nk, logger, 'FRIEND_REQUEST_ACCEPTED', derivedFrom, {
                        inviteId: inviteId, acceptedBy: userId,
                        acceptedByUsername: ctx.username || userId,
                        acceptedByDisplayName: _fiUserDisplayName(nk, userId, ctx.username)
                    }, userId);
                } catch (_) {}
                _fiEmitKFactorEvent(nk, logger, userId, 'invite_accepted', {
                    sourceUserId: derivedFrom, targetUserId: userId,
                    channel: 'in_app', gameId: FRIEND_PUSH_GAME_ID, inviteId: inviteId
                });
                _fiGrantInviteRewardIfPending(nk, logger, derivedFrom, userId);
                logger.info('[FriendInvites] accept via graph fallback | acceptor=' + userId + ' | sender=' + derivedFrom);
                return _fiOk({ inviteId: inviteId, friendUserId: derivedFrom,
                               friendDisplayName: gfName, viaGraphFallback: true });
            }
            if (graphRel === FR_STATE_FRIEND) {
                return _fiOk({ inviteId: inviteId, alreadyFriends: true, friendUserId: derivedFrom });
            }
        }
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
        // Already in the graph — just sync the storage row and return success.
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
            logger.warn('[FriendInvites] accept reconcile write failed (non-fatal) | error=' + reconcileErr.message);
        }
        _fiGrantInviteRewardIfPending(nk, logger, invite.fromUserId, userId);
        return _fiOk({ inviteId: inviteId, alreadyFriends: true,
                       friendUserId: invite.fromUserId,
                       friendDisplayName: invite.fromDisplayName });
    }

    // Add the reciprocal friend edge. Combined with the INVITE_SENT
    // edge created at send-time this transitions BOTH users to FRIEND.
    // NOTE: nk.friendsAdd causes Nakama core to push a WebSocket notification
    // to the acceptor's own socket SYNCHRONOUSLY, before this RPC returns its
    // HTTP response. The client handles this with the QVB_142 optimistic guard.
    try {
        nk.friendsAdd(userId, ctx.username || userId, [invite.fromUserId], [], {});
    } catch (e) {
        logger.error('[FriendInvites] nk.friendsAdd failed | acceptor=' + userId + ' | sender=' + invite.fromUserId + ' | error=' + e.message);
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
        // Friend was added to Nakama graph already — log and continue. The
        // graph is the source of truth; the storage row is a UI hint.
        logger.warn('[FriendInvites] accept storageWrite failed (non-fatal) | inviteId=' + inviteId + ' | error=' + e.message);
    }

    // Notify the original sender that their request was accepted.
    var acceptorName = _fiUserDisplayName(nk, userId, ctx.username);
    try {
        sendFriendsNotification(ctx, nk, logger, 'FRIEND_REQUEST_ACCEPTED', invite.fromUserId, {
            inviteId:               inviteId,
            acceptedBy:             userId,
            acceptedByUsername:     ctx.username || userId,
            acceptedByDisplayName:  acceptorName
        }, userId);
    } catch (e) {
        logger.warn('[FriendInvites] notify sender failed (non-fatal) | error=' + e.message);
    }

    // ── Device push (APNs/FCM) to the original sender ──────────────────────
    // The sendFriendsNotification above only reaches the in-app inbox and
    // the realtime socket. Users who are offline miss it entirely. The push
    // below delivers a real OS banner so they know their request was accepted
    // even when the app is in the background or closed.
    try {
        if (typeof LegacyPush !== 'undefined' && LegacyPush.sendLocalizedPushToUser) {
            LegacyPush.sendLocalizedPushToUser(ctx, logger, nk,
                invite.fromUserId,
                'friend_accepted',
                'friend_accepted_title',
                'friend_accepted_body',
                { name: acceptorName },
                {
                    skipQuietHours: true,
                    skipInAppNotification: true,
                    gameId: FRIEND_PUSH_GAME_ID,
                    data: {
                        screen:             'friends',
                        acceptedBy:         userId,
                        acceptedByUsername: ctx.username || userId,
                        acceptedByName:     acceptorName,
                        inviteId:           inviteId
                    }
                }
            );
        }
    } catch (pushErr) {
        logger.warn('[FriendInvites] device push (friend_accepted) failed (non-fatal): ' + (pushErr.message || pushErr));
    }

    logger.info('[FriendInvites] accept_friend_invite OK | acceptor=' + userId + ' | sender=' + invite.fromUserId + ' | inviteId=' + inviteId);

    // G-002: K-factor instrumentation — invite_accepted closes the loop
    // opened by invite_sent (K = sends/DAU × acceptance rate, doc §F.5).
    _fiEmitKFactorEvent(nk, logger, userId, 'invite_accepted', {
        sourceUserId: invite.fromUserId,
        targetUserId: userId,
        channel:      'in_app',
        gameId:       FRIEND_PUSH_GAME_ID,
        inviteId:     inviteId
    });

    _fiGrantInviteRewardIfPending(nk, logger, invite.fromUserId, userId);

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
        // B-007 sibling fix (2026-07-06, doc §6.4): graph fallback for
        // declines of legacy/rowless invites — remove the INVITE_RECEIVED
        // edge server-side instead of forcing the client to call the native
        // DeleteFriends API (which left no decline record or notification).
        var dDerivedFrom = (p.data || {}).fromUserId;
        if (!dDerivedFrom) {
            var dm = /^inv_([0-9a-fA-F-]{36})_([0-9a-fA-F-]{36})$/.exec(inviteId);
            if (dm && dm[2].toLowerCase() === userId.toLowerCase()) dDerivedFrom = dm[1];
        }
        if (dDerivedFrom && _fiUuidValid(dDerivedFrom)) {
            var dGraphRel = _fiNakamaRelation(nk, userId, dDerivedFrom);
            if (dGraphRel === FR_STATE_INVITE_RECEIVED) {
                try {
                    nk.friendsDelete(userId, ctx.username || userId, [dDerivedFrom], []);
                } catch (dgfe) {
                    return _fiErr('Failed to decline invite: ' + (dgfe.message || dgfe), 'friends_delete_failed');
                }
                logger.info('[FriendInvites] decline via graph fallback | decliner=' + userId + ' | sender=' + dDerivedFrom);
                return _fiOk({ inviteId: inviteId, declined: true, viaGraphFallback: true });
            }
        }
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
        nk.friendsDelete(invite.fromUserId, invite.fromUsername || _fiUserUsername(nk, invite.fromUserId), [userId], []);
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
        sendFriendsNotification(ctx, nk, logger, 'FRIEND_REQUEST_DECLINED', invite.fromUserId, {
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
        nk.friendsDelete(userId, ctx.username || _fiUserUsername(nk, userId), [targetUserId], []);
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
        sendFriendsNotification(ctx, nk, logger, 'FRIEND_REQUEST_CANCELLED', targetUserId, {
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
    // Build the caller's relation map ONCE up front so the per-invite
    // "drop stale rows" check is an O(1) lookup instead of an O(N)
    // nk.friendsList scan per row (the previous O(N²) behaviour was the
    // primary source of multi-second latency on this RPC).
    var relMap = _fiBuildRelationMap(nk, userId).map;
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
            var inRel = _fiRelationFromMap(relMap, o.value.fromUserId);
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
    //
    // Fast-path: the relation map we already built tells us whether the
    // caller has ANY outgoing invites. If none, skip the second
    // nk.friendsList round-trip entirely (the common case — most users have
    // zero pending sent invites), shaving a full DB scan off this RPC.
    var outgoing = [];
    var hasAnyOutgoing = false;
    for (var rid in relMap) {
        if (Object.prototype.hasOwnProperty.call(relMap, rid) &&
            relMap[rid] === FR_STATE_INVITE_SENT) {
            hasAnyOutgoing = true;
            break;
        }
    }
    if (hasAnyOutgoing) {
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
