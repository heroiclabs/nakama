// friend_streaks.js - Bilateral Friend Streak System for QuizVerse v3.0
// RPCs: friend_streak_get_state, friend_streak_record_contribution, friend_streak_send_nudge
// Spec: MRS §29-§31 — Snapchat-style bilateral daily streaks

/**
 * Friend Streak System — Production-Ready
 *
 * Tracks bilateral daily streaks between friends (both must play each day).
 * Max 5 concurrent streaks per player. Unlocks at Day 14.
 * Nudge system: 3 nudges/day with 4h cooldown per friend.
 *
 * Storage: collection="friend_streaks", key="streaks_{userId}"
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

var FS_COLLECTION = 'friend_streaks';
var FS_MAX_CONCURRENT = 5;
var FS_NUDGES_PER_DAY = 3;
var FS_NUDGE_COOLDOWN_HOURS = 4;
var FS_STREAK_BREAK_HOURS = 48; // 2 days without bilateral contribution = broken

// ─── HELPERS ────────────────────────────────────────────────────────────────

function fsStorageKey(userId) {
    return 'streaks_' + userId;
}

function fsReadData(nk, logger, userId) {
    try {
        var records = nk.storageRead([{
            collection: FS_COLLECTION,
            key: fsStorageKey(userId),
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logger.warn('[FriendStreaks] Storage read failed: ' + err.message);
    }
    return null;
}

function fsWriteData(nk, logger, userId, data) {
    try {
        nk.storageWrite([{
            collection: FS_COLLECTION,
            key: fsStorageKey(userId),
            userId: userId,
            value: data,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error('[FriendStreaks] Storage write failed: ' + err.message);
        return false;
    }
}

function fsInitData() {
    return {
        streaks: {},
        nudgesSentToday: 0,
        nudgeDateKey: '',
        lastNudgeTimes: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

function fsError(msg) {
    return JSON.stringify({ success: false, error: msg });
}

function fsTodayKey() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function fsHoursSince(isoDate) {
    if (!isoDate) return 9999;
    return (Date.now() - new Date(isoDate).getTime()) / 3600000;
}

// Clean up broken streaks. When a streak is broken we also persist a
// rolling "broken log" entry under collection=friend_streaks key=broken_log_{userId}
// so the player's UI can later surface "you lost a 30-day streak with X" even
// if they weren't online when the prune happened (V23 in PLAN-07).
var FS_BROKEN_LOG_MAX = 50;

function fsAppendBrokenLog(nk, logger, userId, brokenList) {
    if (!brokenList || brokenList.length === 0) return;
    try {
        var existing = [];
        try {
            var rows = nk.storageRead([{
                collection: FS_COLLECTION,
                key: 'broken_log_' + userId,
                userId: userId
            }]);
            if (rows && rows.length > 0 && rows[0].value && rows[0].value.entries) {
                existing = rows[0].value.entries;
            }
        } catch (_) {}

        var now = new Date().toISOString();
        for (var i = 0; i < brokenList.length; i++) {
            var b = brokenList[i];
            existing.unshift({
                friendId:  b.friendId,
                streakDays: b.days || 0,
                brokenAt:  now,
                repaired:  false
            });
        }
        if (existing.length > FS_BROKEN_LOG_MAX) {
            existing = existing.slice(0, FS_BROKEN_LOG_MAX);
        }

        nk.storageWrite([{
            collection: FS_COLLECTION,
            key: 'broken_log_' + userId,
            userId: userId,
            value: { entries: existing, updatedAt: now },
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (err) {
        if (logger && logger.warn) logger.warn('[FriendStreaks] broken-log persist failed: ' + err.message);
    }
}

function fsPruneStreaks(data) {
    var pruned = [];
    for (var fid in data.streaks) {
        var s = data.streaks[fid];
        if (fsHoursSince(s.lastInteractionAt) > FS_STREAK_BREAK_HOURS) {
            pruned.push({ friendId: fid, days: s.streakDays, friendDisplayName: s.friendDisplayName || '' });
            delete data.streaks[fid];
        }
    }
    return pruned;
}

// Reset daily nudge counter if new day
function fsRefreshNudges(data) {
    var today = fsTodayKey();
    if (data.nudgeDateKey !== today) {
        data.nudgesSentToday = 0;
        data.nudgeDateKey = today;
        data.lastNudgeTimes = {};
    }
}

// ─── RPC: friend_streak_get_state ───────────────────────────────────────────

function rpcFriendStreakGetState(ctx, logger, nk, payload) {
    if (!ctx.userId) return fsError('User not authenticated');

    var data = fsReadData(nk, logger, ctx.userId);
    if (!data) data = fsInitData();

    // Prune broken streaks
    var broken = fsPruneStreaks(data);
    fsRefreshNudges(data);

    if (broken.length > 0) {
        fsWriteData(nk, logger, ctx.userId, data);
        fsAppendBrokenLog(nk, logger, ctx.userId, broken);
    }

    // Build response
    var streakList = [];
    for (var fid in data.streaks) {
        var s = data.streaks[fid];
        var hoursLeft = FS_STREAK_BREAK_HOURS - fsHoursSince(s.lastInteractionAt);
        streakList.push({
            friendId: fid,
            friendDisplayName: s.friendDisplayName || '',
            streakDays: s.streakDays || 0,
            myContributionToday: s.myContributionToday || false,
            friendContributionToday: s.friendContributionToday || false,
            isAtRisk: hoursLeft < 4 && hoursLeft > 0,
            hoursUntilBreak: Math.max(0, Math.round(hoursLeft)),
            startedAt: s.startedAt || null
        });
    }

    return JSON.stringify({
        success: true,
        streaks: streakList,
        totalActive: streakList.length,
        maxStreaks: FS_MAX_CONCURRENT,
        nudgesRemaining: Math.max(0, FS_NUDGES_PER_DAY - (data.nudgesSentToday || 0)),
        brokenStreaks: broken,
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: friend_streak_record_contribution ─────────────────────────────────

function rpcFriendStreakRecordContribution(ctx, logger, nk, payload) {
    if (!ctx.userId) return fsError('User not authenticated');

    var input;
    try { input = JSON.parse(payload); } catch (e) { return fsError('Invalid JSON'); }

    var friendId = input.friendId;
    if (!friendId) return fsError('Missing friendId');

    // --- My data ---
    var myData = fsReadData(nk, logger, ctx.userId) || fsInitData();
    fsPruneStreaks(myData);

    // Auto-create streak if not exists (within limits)
    if (!myData.streaks[friendId]) {
        if (Object.keys(myData.streaks).length >= FS_MAX_CONCURRENT) {
            return fsError('Max concurrent streaks reached (' + FS_MAX_CONCURRENT + ')');
        }
        myData.streaks[friendId] = {
            friendDisplayName: input.friendDisplayName || '',
            streakDays: 0,
            myContributionToday: false,
            friendContributionToday: false,
            lastInteractionAt: new Date().toISOString(),
            startedAt: new Date().toISOString()
        };
    }

    var myStreak = myData.streaks[friendId];
    myStreak.myContributionToday = true;
    myStreak.lastInteractionAt = new Date().toISOString();

    // --- Friend's data (mirror the contribution) ---
    var friendData = fsReadData(nk, logger, friendId) || fsInitData();
    fsPruneStreaks(friendData);

    if (!friendData.streaks[ctx.userId]) {
        if (Object.keys(friendData.streaks).length >= FS_MAX_CONCURRENT) {
            logger.warn('[FriendStreaks] Friend ' + friendId + ' at max streaks, cannot mirror');
        } else {
            friendData.streaks[ctx.userId] = {
                friendDisplayName: input.myDisplayName || '',
                streakDays: 0,
                myContributionToday: false,
                friendContributionToday: false,
                lastInteractionAt: new Date().toISOString(),
                startedAt: new Date().toISOString()
            };
        }
    }

    if (friendData.streaks[ctx.userId]) {
        friendData.streaks[ctx.userId].friendContributionToday = true;
        friendData.streaks[ctx.userId].lastInteractionAt = new Date().toISOString();

        // Check bilateral completion on friend side
        if (friendData.streaks[ctx.userId].myContributionToday &&
            friendData.streaks[ctx.userId].friendContributionToday) {
            friendData.streaks[ctx.userId].streakDays =
                (friendData.streaks[ctx.userId].streakDays || 0) + 1;
            friendData.streaks[ctx.userId].myContributionToday = false;
            friendData.streaks[ctx.userId].friendContributionToday = false;
        }
        friendData.updatedAt = new Date().toISOString();
        fsWriteData(nk, logger, friendId, friendData);
    }

    // Check bilateral completion on my side
    var advanced = false;
    if (myStreak.myContributionToday && myStreak.friendContributionToday) {
        myStreak.streakDays = (myStreak.streakDays || 0) + 1;
        myStreak.myContributionToday = false;
        myStreak.friendContributionToday = false;
        advanced = true;
    }

    myData.updatedAt = new Date().toISOString();
    if (!fsWriteData(nk, logger, ctx.userId, myData)) {
        return fsError('Failed to save streak data');
    }

    logger.info('[FriendStreaks] ' + ctx.userId + ' contributed to streak with ' +
                friendId + (advanced ? ' — ADVANCED to day ' + myStreak.streakDays : ''));

    return JSON.stringify({
        success: true,
        friendId: friendId,
        streakDays: myStreak.streakDays,
        advanced: advanced,
        myContributionToday: myStreak.myContributionToday,
        friendContributionToday: myStreak.friendContributionToday,
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: friend_streak_send_nudge ──────────────────────────────────────────

function rpcFriendStreakSendNudge(ctx, logger, nk, payload) {
    if (!ctx.userId) return fsError('User not authenticated');

    var input;
    try { input = JSON.parse(payload); } catch (e) { return fsError('Invalid JSON'); }

    var friendId = input.friendId;
    if (!friendId) return fsError('Missing friendId');

    var data = fsReadData(nk, logger, ctx.userId) || fsInitData();
    fsRefreshNudges(data);

    // Check daily limit
    if ((data.nudgesSentToday || 0) >= FS_NUDGES_PER_DAY) {
        return fsError('Daily nudge limit reached (' + FS_NUDGES_PER_DAY + ')');
    }

    // Check cooldown per friend
    var lastNudge = data.lastNudgeTimes ? data.lastNudgeTimes[friendId] : null;
    if (lastNudge && fsHoursSince(lastNudge) < FS_NUDGE_COOLDOWN_HOURS) {
        var remaining = Math.ceil(FS_NUDGE_COOLDOWN_HOURS - fsHoursSince(lastNudge));
        return fsError('Nudge cooldown: ' + remaining + 'h remaining');
    }

    // Send notification to friend
    try {
        nk.notificationsSend([{
            userId: friendId,
            subject: 'Streak Nudge! 🔥',
            content: {
                type: 'friend_streak_nudge',
                senderId: ctx.userId,
                senderName: input.myDisplayName || 'A friend'
            },
            code: 101, // Custom notification code for streak nudges
            persistent: true
        }]);
    } catch (err) {
        logger.warn('[FriendStreaks] Failed to send nudge notification: ' + err.message);
        // Continue anyway — nudge is counted even if notification fails
    }

    // Update nudge state
    data.nudgesSentToday = (data.nudgesSentToday || 0) + 1;
    if (!data.lastNudgeTimes) data.lastNudgeTimes = {};
    data.lastNudgeTimes[friendId] = new Date().toISOString();
    data.updatedAt = new Date().toISOString();

    fsWriteData(nk, logger, ctx.userId, data);

    var remaining = FS_NUDGES_PER_DAY - data.nudgesSentToday;
    logger.info('[FriendStreaks] Nudge sent from ' + ctx.userId + ' to ' + friendId +
                '. Remaining: ' + remaining);

    return JSON.stringify({
        success: true,
        friendId: friendId,
        nudgesRemaining: remaining,
        cooldownHours: FS_NUDGE_COOLDOWN_HOURS,
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: friend_streak_get_broken_log ──────────────────────────────────────
//
// Returns the rolling log of streaks that broke while the player was offline,
// so the client can show a "you lost a 30-day streak with X" banner. Also
// runs a fresh prune so the log is always up to date at read time.

function rpcFriendStreakGetBrokenLog(ctx, logger, nk, payload) {
    if (!ctx.userId) return fsError('User not authenticated');

    var input = {};
    if (payload && payload !== '') {
        try { input = JSON.parse(payload); } catch (e) { /* ignore — empty filter */ }
    }
    var limit = parseInt(input.limit) || 20;
    if (limit < 1)  limit = 1;
    if (limit > FS_BROKEN_LOG_MAX) limit = FS_BROKEN_LOG_MAX;
    var includeRepaired = input.includeRepaired === true;

    // Fresh prune so the log is always current at read time
    var data = fsReadData(nk, logger, ctx.userId) || fsInitData();
    var fresh = fsPruneStreaks(data);
    if (fresh.length > 0) {
        fsWriteData(nk, logger, ctx.userId, data);
        fsAppendBrokenLog(nk, logger, ctx.userId, fresh);
    }

    var entries = [];
    try {
        var rows = nk.storageRead([{
            collection: FS_COLLECTION,
            key: 'broken_log_' + ctx.userId,
            userId: ctx.userId
        }]);
        if (rows && rows.length > 0 && rows[0].value && rows[0].value.entries) {
            entries = rows[0].value.entries;
        }
    } catch (err) {
        logger.warn('[FriendStreaks] broken-log read failed: ' + err.message);
    }

    if (!includeRepaired) {
        var filtered = [];
        for (var i = 0; i < entries.length; i++) {
            if (!entries[i].repaired) filtered.push(entries[i]);
        }
        entries = filtered;
    }
    if (entries.length > limit) entries = entries.slice(0, limit);

    return JSON.stringify({
        success: true,
        entries: entries,
        totalEntries: entries.length,
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: friend_streak_repair ──────────────────────────────────────────────
//
// Spend a "Streak Saver" (gem cost) to restore a broken bilateral streak.
// Server-authoritative: validates the broken-log entry exists, debits the
// wallet, restores the streak with its previous day count, marks the entry
// repaired, and notifies the friend so their state can mirror.
//
// Schema: { friendId: <UUID>, idempotencyKey?: <string> }

var FS_REPAIR_GEM_COST = 50;

function rpcFriendStreakRepair(ctx, logger, nk, payload) {
    if (!ctx.userId) return fsError('User not authenticated');

    var input;
    try { input = JSON.parse(payload || '{}'); } catch (e) { return fsError('Invalid JSON'); }

    var friendId = input.friendId;
    if (!friendId) return fsError('Missing friendId');
    var idempotencyKey = input.idempotencyKey || ('fs_repair_' + friendId + '_' + Date.now());

    // Idempotency check — refuse double-spend on the same key
    try {
        var idemRows = nk.storageRead([{
            collection: FS_COLLECTION,
            key: 'repair_idem_' + ctx.userId + '_' + idempotencyKey,
            userId: ctx.userId
        }]);
        if (idemRows && idemRows.length > 0 && idemRows[0].value) {
            return JSON.stringify({
                success: true,
                idempotent: true,
                friendId: friendId,
                streakDays: idemRows[0].value.restoredDays || 0,
                timestamp: new Date().toISOString()
            });
        }
    } catch (_) { /* fall-through */ }

    // Find the broken-log entry for this friend (most recent unrepaired)
    var brokenEntry = null;
    var brokenLog = null;
    try {
        var rows = nk.storageRead([{
            collection: FS_COLLECTION,
            key: 'broken_log_' + ctx.userId,
            userId: ctx.userId
        }]);
        if (rows && rows.length > 0 && rows[0].value && rows[0].value.entries) {
            brokenLog = rows[0].value;
            for (var i = 0; i < brokenLog.entries.length; i++) {
                if (brokenLog.entries[i].friendId === friendId && !brokenLog.entries[i].repaired) {
                    brokenEntry = brokenLog.entries[i];
                    break;
                }
            }
        }
    } catch (err) {
        logger.warn('[FriendStreaks] repair read broken-log failed: ' + err.message);
    }

    if (!brokenEntry) {
        return fsError('No broken streak found for friend ' + friendId);
    }

    // Repair window: only repair if the streak broke within last 7 days
    var brokenAtMs = new Date(brokenEntry.brokenAt).getTime();
    if ((Date.now() - brokenAtMs) > (7 * 86400000)) {
        return fsError('Streak broken more than 7 days ago — too late to repair');
    }

    // Debit gems
    try {
        nk.walletUpdate(ctx.userId, { gems: -FS_REPAIR_GEM_COST }, {
            source: 'friend_streak_repair',
            friendId: friendId,
            idempotencyKey: idempotencyKey
        }, true);
    } catch (walletErr) {
        return fsError('Insufficient gems: ' + walletErr.message);
    }

    // Restore the streak on caller's side
    var data = fsReadData(nk, logger, ctx.userId) || fsInitData();
    if (Object.keys(data.streaks).length >= FS_MAX_CONCURRENT) {
        // Refund gems
        try {
            nk.walletUpdate(ctx.userId, { gems: FS_REPAIR_GEM_COST }, {
                source: 'friend_streak_repair_refund',
                friendId: friendId
            }, true);
        } catch (_) {}
        return fsError('Max concurrent streaks reached — cannot restore');
    }
    data.streaks[friendId] = {
        friendDisplayName: brokenEntry.friendDisplayName || '',
        streakDays: brokenEntry.streakDays || 0,
        myContributionToday: false,
        friendContributionToday: false,
        lastInteractionAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        repairedAt: new Date().toISOString()
    };
    data.updatedAt = new Date().toISOString();
    fsWriteData(nk, logger, ctx.userId, data);

    // Mark broken-log entry as repaired
    try {
        if (brokenLog && brokenLog.entries) {
            for (var j = 0; j < brokenLog.entries.length; j++) {
                if (brokenLog.entries[j] === brokenEntry) {
                    brokenLog.entries[j].repaired = true;
                    brokenLog.entries[j].repairedAt = new Date().toISOString();
                    break;
                }
            }
            nk.storageWrite([{
                collection: FS_COLLECTION,
                key: 'broken_log_' + ctx.userId,
                userId: ctx.userId,
                value: brokenLog,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }
    } catch (err) {
        logger.warn('[FriendStreaks] repair mark-log failed: ' + err.message);
    }

    // Persist idempotency record (24h TTL via Nakama isn't supported in JS
    // runtime, so we just persist forever — keys are scoped per-user and small)
    try {
        nk.storageWrite([{
            collection: FS_COLLECTION,
            key: 'repair_idem_' + ctx.userId + '_' + idempotencyKey,
            userId: ctx.userId,
            value: {
                friendId: friendId,
                restoredDays: brokenEntry.streakDays || 0,
                gemCost: FS_REPAIR_GEM_COST,
                repairedAt: new Date().toISOString()
            },
            permissionRead: 0,
            permissionWrite: 0
        }]);
    } catch (_) {}

    // Notify the friend
    try {
        nk.notificationsSend([{
            userId: friendId,
            subject: 'Streak Restored! 🔥',
            content: {
                type: 'friend_streak_repaired',
                fromUserId: ctx.userId,
                streakDays: brokenEntry.streakDays || 0
            },
            code: 102,
            persistent: true
        }]);
    } catch (err) {
        logger.warn('[FriendStreaks] repair notify failed: ' + err.message);
    }

    logger.info('[FriendStreaks] Repaired streak ' + ctx.userId + ' ↔ ' + friendId +
                ' restoredDays=' + (brokenEntry.streakDays || 0) + ' gemCost=' + FS_REPAIR_GEM_COST);

    return JSON.stringify({
        success: true,
        friendId: friendId,
        streakDays: brokenEntry.streakDays || 0,
        gemCost: FS_REPAIR_GEM_COST,
        idempotencyKey: idempotencyKey,
        timestamp: new Date().toISOString()
    });
}

// ============================================================================
// Module Init — register Friend Streak RPCs
// ============================================================================
// Registers all 5 friend-streak RPCs. Existing 3 (get_state, record_contribution,
// send_nudge) are also registered by legacy_runtime.js; postbuild's `||` guard
// + module-first concat order means our handler wins.
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('friend_streak_get_state',           rpcFriendStreakGetState);
    initializer.registerRpc('friend_streak_record_contribution', rpcFriendStreakRecordContribution);
    initializer.registerRpc('friend_streak_send_nudge',          rpcFriendStreakSendNudge);
    initializer.registerRpc('friend_streak_get_broken_log',      rpcFriendStreakGetBrokenLog);
    initializer.registerRpc('friend_streak_repair',              rpcFriendStreakRepair);
    if (logger && logger.info) {
        logger.info('[FriendStreaks] Registered 5 RPCs (get_state, record_contribution, send_nudge, get_broken_log, repair)');
    }
}
