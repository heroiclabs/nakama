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

// Clean up broken streaks
function fsPruneStreaks(data) {
    var pruned = [];
    for (var fid in data.streaks) {
        var s = data.streaks[fid];
        if (fsHoursSince(s.lastInteractionAt) > FS_STREAK_BREAK_HOURS) {
            pruned.push({ friendId: fid, days: s.streakDays });
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
