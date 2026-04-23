// ============================================================================
// friends_extras.js — Social Pressure / Online Count / Battle / Invite-Reward
// ============================================================================
// PRODUCTION-READY | ES5 (Goja runtime)
//
// Houses 4 RPCs that PLAN-ENGAGEMENT_SYSTEM_07_FRIENDS_SOCIAL.md (V11/V17/V20)
// requires the server to expose:
//
//   friends_get_online_count
//       -> count of caller's mutual friends currently online (Nakama presence)
//
//   social_pressure_get_today_summary
//       -> aggregates "friends played today / friends ahead of me / streak at
//          risk" data into a single response so the client doesn't need to
//          stitch 4 separate reads.
//
//   friend_battle_create
//       -> server-mints a battleId/roomCode, persists the lobby record under
//          friend_battles/<battleId>, fans out invitations + push notifications
//          to each invited friend. Atomic: if any non-friend is invited the
//          whole call fails before any side-effect.
//
//   friend_invite_with_reward
//       -> sends a friend invite (Nakama friendsAdd) AND tags it with a
//          reward bundle that's claimable when the recipient accepts. The
//          claim happens in send_friend_invite/accept_friend_invite already;
//          this RPC is a thin wrapper that records the reward intent so the
//          accept-handler can grant it.
//
// SECURITY: every RPC requires an authenticated caller (ctx.userId set), and
// every "target" is verified as a confirmed mutual friend (Nakama state == 0)
// before any side-effect.
// ============================================================================

var FX_BATTLE_COLLECTION = 'friend_battles';
var FX_INVITE_REWARD_COL = 'friend_invite_rewards';
var FX_BATTLE_MAX_INVITES = 8;
var FX_BATTLE_MAX_DATA_BYTES = 4096;

// ─── Tiny self-contained helpers ────────────────────────────────────────────
// Same defensive pattern as friend_challenges.js — no `utils` dependency so
// load-order can't break this module.

function _fxUuidValid(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function _fxNowIso() { return new Date().toISOString(); }

function _fxOk(extra) {
    var out = { success: true };
    if (extra) {
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
        }
    }
    return JSON.stringify(out);
}

function _fxErr(message, errorCode, extra) {
    var out = { success: false, error: message, errorCode: errorCode || 'unknown' };
    if (extra) {
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
        }
    }
    return JSON.stringify(out);
}

function _fxParse(payload) {
    if (!payload || payload === '') return { ok: true, data: {} };
    try { return { ok: true, data: JSON.parse(payload) }; }
    catch (e)  { return { ok: false, error: 'Invalid JSON payload: ' + e.message }; }
}

function _fxMintBattleId(nk) {
    try {
        if (nk && typeof nk.uuidv4 === 'function') {
            return 'fbat_' + nk.uuidv4().replace(/-/g, '');
        }
    } catch (_) {}
    var hex = '0123456789abcdef';
    var rand = '';
    for (var i = 0; i < 24; i++) rand += hex.charAt(Math.floor(Math.random() * 16));
    return 'fbat_' + Date.now().toString(36) + '_' + rand;
}

// Returns array of confirmed-friend objects: [{ id, displayName, online }]
function _fxLoadFriends(nk) {
    var out = [];
    try {
        var page = nk.friendsList(null, 1000, 0, null); // state=0 (FRIEND)
        if (page && page.friends) {
            for (var i = 0; i < page.friends.length; i++) {
                var fr = page.friends[i];
                if (fr && fr.user && fr.user.id) {
                    out.push({
                        id:          fr.user.id,
                        displayName: fr.user.displayName || fr.user.username || 'Friend',
                        online:      !!fr.user.online
                    });
                }
            }
        }
    } catch (_) {}
    return out;
}

// ============================================================================
// RPC: friends_get_online_count
// ============================================================================
//
// Payload: {}  (no inputs)
// Response: {
//   success: true,
//   onlineCount: <int>,
//   totalFriends: <int>,
//   onlineFriendIds: [<UUID>...],   // capped at 50 for response-size sanity
//   timestamp: <iso>
// }
//
// Reads via nk.friendsList(state=0) which already includes the `online` flag
// from Nakama presence — no extra round-trip needed.
function rpcFriendsGetOnlineCount(ctx, logger, nk, payload) {
    if (!ctx.userId) return _fxErr('Authentication required', 'unauthenticated');

    var friends = [];
    try {
        var page = nk.friendsList(ctx.userId, 1000, 0, null);
        if (page && page.friends) friends = page.friends;
    } catch (e) {
        logger.warn('[FriendsExtras] friendsList failed: ' + e.message);
        return _fxErr('Failed to load friends list', 'friends_list_failed');
    }

    var onlineIds = [];
    for (var i = 0; i < friends.length; i++) {
        var fr = friends[i];
        if (fr && fr.user && fr.user.id && fr.user.online === true) {
            if (onlineIds.length < 50) onlineIds.push(fr.user.id);
        }
    }

    return _fxOk({
        onlineCount:     onlineIds.length,
        totalFriends:    friends.length,
        onlineFriendIds: onlineIds,
        timestamp:       _fxNowIso()
    });
}

// ============================================================================
// RPC: social_pressure_get_today_summary
// ============================================================================
//
// Single-shot aggregator for the "Social Pressure" home-screen card. Returns:
//   {
//     friendsPlayedToday:      <int>,    // friends with quiz_complete today
//     friendsPassedMe:         <int>,    // friends whose XP > my XP today
//     friendsAboveMeInLeague:  [{ id, displayName, points, tier }],
//     friendsStreakAtRisk:     [{ id, displayName, streakDays, hoursLeft }],
//     timestamp: <iso>
//   }
//
// Read-only — never mutates state. Best-effort: any sub-source that fails is
// returned as 0 / [] rather than failing the whole call.
function rpcSocialPressureGetTodaySummary(ctx, logger, nk, payload) {
    if (!ctx.userId) return _fxErr('Authentication required', 'unauthenticated');

    var friends = _fxLoadFriends(nk);
    var todayKey = _fxNowIso().slice(0, 10).replace(/-/g, '');

    // ── friendsPlayedToday + friendsPassedMe ──────────────────────────────
    // Reads friend's `daily_play_log/{userId}_{YYYYMMDD}` if present (set by
    // the existing daily_missions / quiz pipeline). Best-effort.
    var playedToday = 0;
    var passedMe = 0;
    var myXpToday = 0;

    try {
        var myLog = nk.storageRead([{
            collection: 'daily_play_log',
            key: ctx.userId + '_' + todayKey,
            userId: ctx.userId
        }]);
        if (myLog && myLog.length > 0 && myLog[0].value) {
            myXpToday = myLog[0].value.xpToday || 0;
        }
    } catch (_) {}

    for (var i = 0; i < friends.length; i++) {
        var fid = friends[i].id;
        try {
            var rows = nk.storageRead([{
                collection: 'daily_play_log',
                key: fid + '_' + todayKey,
                userId: fid
            }]);
            if (rows && rows.length > 0 && rows[0].value) {
                playedToday++;
                var fxp = rows[0].value.xpToday || 0;
                if (fxp > myXpToday) passedMe++;
            }
        } catch (_) { /* friend may have permission 0 — skip silently */ }
    }

    // ── friendsAboveMeInLeague ────────────────────────────────────────────
    // Reads friend's league record from the legacy leagues collection.
    var aboveInLeague = [];
    var myLeague = null;
    try {
        var myL = nk.storageRead([{
            collection: 'leagues_named',
            key: 'state_quizverse',
            userId: ctx.userId
        }]);
        if (myL && myL.length > 0 && myL[0].value) myLeague = myL[0].value;
    } catch (_) {}

    if (myLeague) {
        for (var j = 0; j < friends.length; j++) {
            var fr = friends[j];
            try {
                var fL = nk.storageRead([{
                    collection: 'leagues_named',
                    key: 'state_quizverse',
                    userId: fr.id
                }]);
                if (fL && fL.length > 0 && fL[0].value) {
                    var lv = fL[0].value;
                    if (lv.tier === myLeague.tier && (lv.points || 0) > (myLeague.points || 0)) {
                        aboveInLeague.push({
                            id:          fr.id,
                            displayName: fr.displayName,
                            points:      lv.points || 0,
                            tier:        lv.tier
                        });
                    }
                }
            } catch (_) {}
        }
        aboveInLeague.sort(function(a, b) { return b.points - a.points; });
        if (aboveInLeague.length > 10) aboveInLeague = aboveInLeague.slice(0, 10);
    }

    // ── friendsStreakAtRisk ───────────────────────────────────────────────
    // Reads MY friend_streaks record (where I am one party of the streak).
    // "At risk" = bilateral streak with <8 hours until break.
    var atRisk = [];
    try {
        var myStreaks = nk.storageRead([{
            collection: 'friend_streaks',
            key: 'streaks_' + ctx.userId,
            userId: ctx.userId
        }]);
        if (myStreaks && myStreaks.length > 0 && myStreaks[0].value &&
            myStreaks[0].value.streaks) {
            var streaks = myStreaks[0].value.streaks;
            var nowMs = Date.now();
            for (var fid2 in streaks) {
                if (!Object.prototype.hasOwnProperty.call(streaks, fid2)) continue;
                var s = streaks[fid2];
                if (!s || !s.lastInteractionAt) continue;
                var hoursSince = (nowMs - new Date(s.lastInteractionAt).getTime()) / 3600000;
                var hoursLeft = 48 - hoursSince;
                if (hoursLeft > 0 && hoursLeft < 8) {
                    atRisk.push({
                        id:          fid2,
                        displayName: s.friendDisplayName || '',
                        streakDays:  s.streakDays || 0,
                        hoursLeft:   Math.max(0, Math.round(hoursLeft))
                    });
                }
            }
            atRisk.sort(function(a, b) { return a.hoursLeft - b.hoursLeft; });
        }
    } catch (e) {
        logger.warn('[FriendsExtras] streak read failed: ' + e.message);
    }

    return _fxOk({
        friendsPlayedToday:     playedToday,
        friendsPassedMe:        passedMe,
        friendsAboveMeInLeague: aboveInLeague,
        friendsStreakAtRisk:    atRisk,
        totalFriends:           friends.length,
        timestamp:              _fxNowIso()
    });
}

// ============================================================================
// RPC: friend_battle_create
// ============================================================================
//
// Server-mints a friend battle / lobby and atomically:
//   1) verifies every invited friend is a confirmed mutual friend
//   2) persists the lobby record (friend_battles/<battleId>)
//   3) sends a Nakama notification to each invitee (code 110)
//
// Photon room creation is owned by the client; this RPC just guarantees the
// invite fan-out is consistent (nobody gets a notification for a battle that
// failed validation).
//
// Payload: {
//   mode:           <string, e.g. 'speed_quiz' | 'classic'>,
//   roomCode:       <string ≤ 64>,
//   invitedFriendIds: [<UUID>...],   // 1..FX_BATTLE_MAX_INVITES
//   metadata?:      <object ≤ 4 KB>
// }
function rpcFriendBattleCreate(ctx, logger, nk, payload) {
    if (!ctx.userId) return _fxErr('Authentication required', 'unauthenticated');

    var p = _fxParse(payload);
    if (!p.ok) return _fxErr(p.error, 'invalid_payload');

    var data = p.data || {};
    var mode = data.mode;
    var roomCode = data.roomCode;
    var invited = data.invitedFriendIds || [];
    var meta = data.metadata || {};

    if (!mode || typeof mode !== 'string' || mode.length > 64) {
        return _fxErr('mode is required (string ≤ 64)', 'invalid_payload');
    }
    if (!roomCode || typeof roomCode !== 'string' || roomCode.length > 64) {
        return _fxErr('roomCode is required (string ≤ 64)', 'invalid_payload');
    }
    if (!Array.isArray(invited) || invited.length === 0) {
        return _fxErr('invitedFriendIds must be non-empty array', 'invalid_payload');
    }
    if (invited.length > FX_BATTLE_MAX_INVITES) {
        return _fxErr('Too many invites (max ' + FX_BATTLE_MAX_INVITES + ')', 'too_many_invites');
    }
    var metaStr;
    try { metaStr = JSON.stringify(meta); }
    catch (e) { return _fxErr('metadata not serialisable: ' + e.message, 'invalid_payload'); }
    if (metaStr.length > FX_BATTLE_MAX_DATA_BYTES) {
        return _fxErr('metadata too large', 'data_too_large');
    }

    // Validate every invitee is a mutual friend BEFORE any side-effect
    var mutualFriends = {};
    var friends = _fxLoadFriends(nk);
    for (var i = 0; i < friends.length; i++) mutualFriends[friends[i].id] = friends[i];

    var rejected = [];
    for (var j = 0; j < invited.length; j++) {
        var inv = invited[j];
        if (!_fxUuidValid(inv)) {
            rejected.push({ id: inv, reason: 'invalid_uuid' });
        } else if (inv === ctx.userId) {
            rejected.push({ id: inv, reason: 'self_invite' });
        } else if (!mutualFriends[inv]) {
            rejected.push({ id: inv, reason: 'not_mutual_friend' });
        }
    }
    if (rejected.length > 0) {
        return _fxErr('Some invitees are not mutual friends', 'invitees_not_mutual',
                      { rejected: rejected });
    }

    var battleId = _fxMintBattleId(nk);
    var nowIso = _fxNowIso();
    var senderName = ctx.username || ctx.userId;

    var battleRecord = {
        battleId:     battleId,
        creatorId:    ctx.userId,
        creatorName:  senderName,
        mode:         mode,
        roomCode:     roomCode,
        status:       'pending',
        invitedIds:   invited,
        acceptedIds:  [],
        declinedIds:  [],
        metadata:     meta,
        createdAt:    nowIso,
        expiresAt:    new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 min
    };

    // Persist lobby (owner = creator, owner-readable)
    try {
        nk.storageWrite([{
            collection:      FX_BATTLE_COLLECTION,
            key:             battleId,
            userId:          ctx.userId,
            value:           battleRecord,
            permissionRead:  1,
            permissionWrite: 0
        }]);
    } catch (e) {
        logger.error('[FriendsExtras] battle persist failed: ' + e.message);
        return _fxErr('Failed to persist battle', 'storage_write_failed');
    }

    // Fan out notifications (best-effort — but battle record exists already)
    var notifs = [];
    for (var k = 0; k < invited.length; k++) {
        notifs.push({
            userId:     invited[k],
            subject:    senderName + ' invited you to a battle!',
            content: {
                type:        'friend_battle_invite',
                battleId:    battleId,
                fromUserId:  ctx.userId,
                fromName:    senderName,
                mode:        mode,
                roomCode:    roomCode,
                expiresAt:   battleRecord.expiresAt
            },
            code:       110,
            persistent: true,
            senderId:   ctx.userId
        });
    }
    try {
        if (notifs.length > 0) nk.notificationsSend(notifs);
    } catch (e) {
        logger.warn('[FriendsExtras] battle notify failed: ' + e.message);
    }

    return _fxOk({
        battleId:        battleId,
        roomCode:        roomCode,
        mode:            mode,
        invitedIds:      invited,
        invitedCount:    invited.length,
        expiresAt:       battleRecord.expiresAt,
        timestamp:       nowIso
    });
}

// ============================================================================
// RPC: friend_invite_with_reward
// ============================================================================
//
// Sends a friend invite (Nakama friendsAdd) AND records a reward bundle that
// will be granted to BOTH parties on accept. The actual grant happens in
// the existing accept_friend_invite handler — this RPC just stores the intent.
//
// Payload: {
//   targetUserId: <UUID>,
//   rewardBundle?: { coins?: int, gems?: int, xp?: int }   // capped server-side
// }
//
// Caps: coins ≤ 200, gems ≤ 10, xp ≤ 100 per invite (anti-griefing).
var FX_REWARD_CAP = { coins: 200, gems: 10, xp: 100 };

function rpcFriendInviteWithReward(ctx, logger, nk, payload) {
    if (!ctx.userId) return _fxErr('Authentication required', 'unauthenticated');

    var p = _fxParse(payload);
    if (!p.ok) return _fxErr(p.error, 'invalid_payload');

    var data = p.data || {};
    var target = data.targetUserId;
    if (!_fxUuidValid(target)) {
        return _fxErr('Invalid targetUserId (UUID required)', 'invalid_target');
    }
    if (target === ctx.userId) {
        return _fxErr('Cannot invite yourself', 'self_invite');
    }

    var raw = data.rewardBundle || {};
    var bundle = {
        coins: Math.min(FX_REWARD_CAP.coins, Math.max(0, parseInt(raw.coins) || 0)),
        gems:  Math.min(FX_REWARD_CAP.gems,  Math.max(0, parseInt(raw.gems)  || 0)),
        xp:    Math.min(FX_REWARD_CAP.xp,    Math.max(0, parseInt(raw.xp)    || 0))
    };

    // Send the friend request via Nakama's native graph
    try {
        nk.friendsAdd(ctx.userId, ctx.username || '', [target], null);
    } catch (e) {
        return _fxErr('friendsAdd failed: ' + e.message, 'friends_add_failed');
    }

    // Persist the reward intent under both parties so accept_friend_invite
    // (in src/legacy/friends.ts) can find and grant it.
    var nowIso = _fxNowIso();
    var rewardKey = 'invite_reward_' + ctx.userId + '_' + target;
    var rewardRecord = {
        senderId:       ctx.userId,
        recipientId:    target,
        rewardBundle:   bundle,
        status:         'pending',
        createdAt:      nowIso,
        expiresAt:      new Date(Date.now() + 7 * 86400000).toISOString() // 7 days
    };
    try {
        nk.storageWrite([
            {
                collection:      FX_INVITE_REWARD_COL,
                key:             rewardKey,
                userId:          ctx.userId,
                value:           rewardRecord,
                permissionRead:  0,
                permissionWrite: 0
            },
            {
                collection:      FX_INVITE_REWARD_COL,
                key:             rewardKey,
                userId:          target,
                value:           rewardRecord,
                permissionRead:  0,
                permissionWrite: 0
            }
        ]);
    } catch (e) {
        logger.warn('[FriendsExtras] invite-reward persist failed: ' + e.message);
        // Non-fatal — friend invite already went out
    }

    // Notify the recipient
    try {
        nk.notificationsSend([{
            userId:     target,
            subject:    'Friend Invite + Reward',
            content: {
                type:         'friend_invite_with_reward',
                fromUserId:   ctx.userId,
                fromName:     ctx.username || ctx.userId,
                rewardBundle: bundle
            },
            code:       111,
            persistent: true,
            senderId:   ctx.userId
        }]);
    } catch (e) {
        logger.warn('[FriendsExtras] invite notify failed: ' + e.message);
    }

    return _fxOk({
        targetUserId:   target,
        rewardBundle:   bundle,
        rewardKey:      rewardKey,
        expiresAt:      rewardRecord.expiresAt,
        timestamp:      nowIso
    });
}

// ============================================================================
// Module Init — register Friends Extras RPCs
// ============================================================================
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('friends_get_online_count',         rpcFriendsGetOnlineCount);
    initializer.registerRpc('social_pressure_get_today_summary', rpcSocialPressureGetTodaySummary);
    initializer.registerRpc('friend_battle_create',             rpcFriendBattleCreate);
    initializer.registerRpc('friend_invite_with_reward',        rpcFriendInviteWithReward);
    if (logger && logger.info) {
        logger.info('[FriendsExtras] Registered 4 RPCs (online_count, social_pressure, battle_create, invite_with_reward)');
    }
}
