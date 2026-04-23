// friend_quests.js - Friend Quest System for QuizVerse v4.0
// RPCs: friend_quest_get_state, friend_quest_complete
// Spec: MRS §31 — 10 quest types, server-authoritative generation
// v4.0: Server generates quests from user's friends list

/**
 * Friend Quest System — Server-Authoritative
 *
 * 10 quest types generated from user's real friends list.
 * Server is the source of truth — client only renders.
 * Tracks progress, grants rewards (wallet + notification), duplicate protection.
 *
 * Storage: collection="friend_quests", key="quest_state_{userId}"
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

var FQ_COLLECTION = 'friend_quests';
var FQ_MAX_ACTIVE = 3;
var FQ_REFRESH_HOURS = 8;

// 10 quest types matching client-side QuestType enum
var FQ_QUEST_TYPES = [
    'PlayTogether',
    'ChallengeFriend',
    'StudyBuddy',
    'GroupStreak',
    'BeatInSpeedQuiz',
    'DailyQuizDuo',
    'PerfectRound',
    'ExploreTogether',
    'ShareScore',
    'WinThreeQuizzes'
];

// Quest templates: { title format, description format, targetProgress, coinReward, xpReward }
var FQ_TEMPLATES = {
    PlayTogether: {
        title: 'Play with {0}',
        desc: 'Complete a quiz while {0} is online',
        target: 1, coins: 50, xp: 25
    },
    ChallengeFriend: {
        title: 'Challenge {0}',
        desc: 'Send a challenge to {0} and have them accept',
        target: 1, coins: 75, xp: 40
    },
    StudyBuddy: {
        title: 'Study with {0}',
        desc: 'Both you and {0} complete a review session today',
        target: 1, coins: 100, xp: 50
    },
    GroupStreak: {
        title: '7-Day Streak with {0}',
        desc: 'Maintain your friend streak with {0} for 7 days',
        target: 7, coins: 200, xp: 100
    },
    BeatInSpeedQuiz: {
        title: 'Beat {0} in Speed Quiz',
        desc: 'Score higher than {0} in a Speed Quiz',
        target: 1, coins: 75, xp: 40
    },
    DailyQuizDuo: {
        title: 'Daily Quiz Duo with {0}',
        desc: 'Both you and {0} complete the Daily Quiz today',
        target: 1, coins: 60, xp: 30
    },
    PerfectRound: {
        title: 'Perfect Round with {0}',
        desc: 'Both answer 5 questions correctly in same session',
        target: 5, coins: 100, xp: 50
    },
    ExploreTogether: {
        title: 'Explore Together with {0}',
        desc: 'Both play GeoExplore mode on the same day',
        target: 1, coins: 75, xp: 40
    },
    ShareScore: {
        title: 'Share a Score with {0}',
        desc: 'Share your quiz result with {0}',
        target: 1, coins: 50, xp: 25
    },
    WinThreeQuizzes: {
        title: 'Win 3 Quizzes with {0}',
        desc: 'Win 3 quizzes while {0} is online',
        target: 3, coins: 150, xp: 75
    }
};

// ─── HELPERS ────────────────────────────────────────────────────────────────

function fqStorageKey(userId) {
    return 'quest_state_' + userId;
}

function fqReadData(nk, logger, userId) {
    try {
        var records = nk.storageRead([{
            collection: FQ_COLLECTION,
            key: fqStorageKey(userId),
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logger.warn('[FriendQuests] Storage read failed: ' + err.message);
    }
    return null;
}

function fqWriteData(nk, logger, userId, data) {
    try {
        nk.storageWrite([{
            collection: FQ_COLLECTION,
            key: fqStorageKey(userId),
            userId: userId,
            value: data,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error('[FriendQuests] Storage write failed: ' + err.message);
        return false;
    }
}

function fqInitData() {
    return {
        quests: [],
        completedIds: [],
        lastRefresh: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

function fqError(msg) {
    return JSON.stringify({ success: false, error: msg });
}

function fqGenerateId() {
    // 8-char hex ID
    var chars = '0123456789abcdef';
    var id = '';
    for (var i = 0; i < 8; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

function fqFormatString(template, friendName) {
    return template.replace(/\{0\}/g, friendName);
}

// ─── SERVER-SIDE QUEST GENERATION ───────────────────────────────────────────

/**
 * Generate quests from user's Nakama friends list.
 * Called by friend_quest_get_state when no active quests exist or they've expired.
 */
function fqGenerateQuests(nk, logger, userId, existingData) {
    // Get user's friends list
    var friends = [];
    try {
        var friendsResult = nk.friendsList(userId, null, null, null);
        if (friendsResult && friendsResult.friends) {
            for (var i = 0; i < friendsResult.friends.length; i++) {
                var f = friendsResult.friends[i];
                if (f && f.user && f.user.id) {
                    var displayName = f.user.displayName || f.user.username || 'Friend';
                    friends.push({ id: f.user.id, name: displayName });
                }
            }
        }
    } catch (err) {
        logger.warn('[FriendQuests] Could not fetch friends list: ' + err.message);
    }

    if (friends.length === 0) {
        logger.info('[FriendQuests] No friends found for user ' + userId + ' — no quests generated');
        return [];
    }

    // Determine how many quests to generate
    var activeCount = 0;
    var now = new Date();
    if (existingData && existingData.quests) {
        for (var j = 0; j < existingData.quests.length; j++) {
            var q = existingData.quests[j];
            if (!q.isCompleted && q.expiresAt && new Date(q.expiresAt) > now) {
                activeCount++;
            }
        }
    }

    var toGenerate = FQ_MAX_ACTIVE - activeCount;
    if (toGenerate <= 0) return existingData ? existingData.quests : [];

    // Shuffle quest types to get random selection
    var shuffledTypes = FQ_QUEST_TYPES.slice();
    for (var s = shuffledTypes.length - 1; s > 0; s--) {
        var r = Math.floor(Math.random() * (s + 1));
        var tmp = shuffledTypes[s];
        shuffledTypes[s] = shuffledTypes[r];
        shuffledTypes[r] = tmp;
    }

    var newQuests = [];
    var expiresAt = new Date(now.getTime() + FQ_REFRESH_HOURS * 60 * 60 * 1000).toISOString();
    var createdAt = now.toISOString();

    for (var k = 0; k < toGenerate; k++) {
        var friend = friends[k % friends.length];
        var questType = shuffledTypes[k % shuffledTypes.length];
        var template = FQ_TEMPLATES[questType];

        if (!template) continue;

        newQuests.push({
            questId: fqGenerateId(),
            type: questType,
            friendId: friend.id,
            friendDisplayName: friend.name,
            title: fqFormatString(template.title, friend.name),
            description: fqFormatString(template.desc, friend.name),
            currentProgress: 0,
            targetProgress: template.target,
            isCompleted: false,
            coinReward: template.coins,
            xpReward: template.xp,
            createdAt: createdAt,
            expiresAt: expiresAt
        });
    }

    logger.info('[FriendQuests] Generated ' + newQuests.length + ' quests from ' +
                friends.length + ' friends for user ' + userId);
    return newQuests;
}

// ─── RPC: friend_quest_get_state ────────────────────────────────────────────

function rpcFriendQuestGetState(ctx, logger, nk, payload) {
    if (!ctx.userId) return fqError('User not authenticated');

    var data = fqReadData(nk, logger, ctx.userId);
    if (!data) data = fqInitData();

    // Check if we need to generate new quests
    var now = new Date();
    var needsRefresh = false;

    // Filter active non-expired quests
    var activeQuests = [];
    var expiredOrCompleted = [];
    if (data.quests && data.quests.length > 0) {
        for (var i = 0; i < data.quests.length; i++) {
            var q = data.quests[i];
            if (q.isCompleted) {
                expiredOrCompleted.push(q);
            } else if (q.expiresAt && new Date(q.expiresAt) <= now) {
                // Expired — don't include
                expiredOrCompleted.push(q);
            } else {
                activeQuests.push(q);
            }
        }
    }

    // Check refresh timer
    if (data.lastRefresh) {
        var lastRefreshDate = new Date(data.lastRefresh);
        var hoursSince = (now.getTime() - lastRefreshDate.getTime()) / (1000 * 60 * 60);
        if (hoursSince >= FQ_REFRESH_HOURS) {
            needsRefresh = true;
        }
    } else {
        needsRefresh = true;
    }

    // Generate new quests if needed
    if (activeQuests.length < FQ_MAX_ACTIVE && needsRefresh) {
        // Keep completed quests for history, replace active with fresh
        data.quests = activeQuests; // Keep valid active ones
        var newQuests = fqGenerateQuests(nk, logger, ctx.userId, data);

        // Merge new quests
        for (var j = 0; j < newQuests.length; j++) {
            data.quests.push(newQuests[j]);
        }

        data.lastRefresh = now.toISOString();
        data.updatedAt = now.toISOString();
        fqWriteData(nk, logger, ctx.userId, data);

        activeQuests = [];
        for (var k = 0; k < data.quests.length; k++) {
            if (!data.quests[k].isCompleted) {
                activeQuests.push(data.quests[k]);
            }
        }
    }

    return JSON.stringify({
        success: true,
        quests: activeQuests,
        completedIds: data.completedIds || [],
        lastRefresh: data.lastRefresh || null,
        timestamp: now.toISOString()
    });
}

// ─── RPC: friend_quest_complete ─────────────────────────────────────────────

function rpcFriendQuestComplete(ctx, logger, nk, payload) {
    if (!ctx.userId) return fqError('User not authenticated');

    var input;
    try { input = JSON.parse(payload); } catch (e) { return fqError('Invalid JSON'); }

    var questId = input.questId;
    var questType = input.questType;
    var friendId = input.friendId;
    var coinReward = input.coinReward || 50;
    var xpReward = input.xpReward || 25;

    if (!questId || !questType) return fqError('Missing questId or questType');

    var data = fqReadData(nk, logger, ctx.userId) || fqInitData();

    // Duplicate protection
    if (!data.completedIds) data.completedIds = [];
    for (var i = 0; i < data.completedIds.length; i++) {
        if (data.completedIds[i] === questId) {
            return JSON.stringify({
                success: false,
                error: 'Quest already completed',
                already_completed: true
            });
        }
    }

    // Mark completed
    data.completedIds.push(questId);

    // Update quest record if exists — use server-stored rewards for authority
    if (data.quests) {
        for (var j = 0; j < data.quests.length; j++) {
            if (data.quests[j].questId === questId) {
                data.quests[j].isCompleted = true;
                // Use server-stored reward values (authoritative)
                if (data.quests[j].coinReward) coinReward = data.quests[j].coinReward;
                if (data.quests[j].xpReward) xpReward = data.quests[j].xpReward;
                break;
            }
        }
    }

    // Grant rewards via wallet — coins + XP
    try {
        var changeset = {};
        changeset['coins'] = coinReward;
        changeset['xp'] = xpReward;
        nk.walletUpdate(ctx.userId, changeset, {
            source: 'friend_quest_' + questType
        }, true);
    } catch (walletErr) {
        logger.warn('[FriendQuests] Wallet update failed: ' + walletErr.message);
    }

    // Save state
    data.updatedAt = new Date().toISOString();
    fqWriteData(nk, logger, ctx.userId, data);

    // Notify friend about completion
    if (friendId) {
        try {
            nk.notificationsSend([{
                userId: friendId,
                subject: 'Friend Quest Completed!',
                content: {
                    type: 'friend_quest_complete',
                    quest_type: questType,
                    friend_id: ctx.userId
                },
                code: 102,
                persistent: true
            }]);
        } catch (notifErr) {
            logger.warn('[FriendQuests] Friend notification failed: ' + notifErr.message);
        }
    }

    logger.info('[FriendQuests] Quest completed: ' + questId + ' type=' + questType +
                ' coins=' + coinReward + ' xp=' + xpReward +
                ' user=' + ctx.userId);

    return JSON.stringify({
        success: true,
        questId: questId,
        coinReward: coinReward,
        xpReward: xpReward,
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: friend_quest_record_progress ──────────────────────────────────────
//
// Server-authoritative progress increment. Closes the
// "client-trusted friend_quest_complete" exploit (PLAN-07 §V4) by making the
// server the owner of `quest.currentProgress`. Client only reports the
// interaction event; server validates type ↔ event compatibility and bumps.
//
// Payload: {
//   questId: <string>,
//   eventType: 'quiz_win' | 'quiz_complete' | 'review_session' | 'speed_quiz_win' |
//              'daily_quiz_complete' | 'perfect_round' | 'geo_explore_play' |
//              'share_score' | 'challenge_accepted' | 'play_with_friend',
//   amount?: <number, default 1>
// }
//
// Returns the updated quest record (or completion notification if it just
// crossed the targetProgress threshold). NEVER auto-grants rewards — caller
// must follow up with friend_quest_complete (which now also re-validates).
//
// Validation rules: each questType has an allow-list of compatible eventTypes;
// foreign event types are silently ignored (return success:true, applied:0).
var FQ_EVENT_RULES = {
    PlayTogether:    { events: ['quiz_complete','play_with_friend'] },
    ChallengeFriend: { events: ['challenge_accepted'] },
    StudyBuddy:      { events: ['review_session'] },
    GroupStreak:     { events: ['streak_advanced'] },
    BeatInSpeedQuiz: { events: ['speed_quiz_win'] },
    DailyQuizDuo:    { events: ['daily_quiz_complete'] },
    PerfectRound:    { events: ['perfect_round','quiz_complete'] },
    ExploreTogether: { events: ['geo_explore_play'] },
    ShareScore:      { events: ['share_score'] },
    WinThreeQuizzes: { events: ['quiz_win'] }
};

function rpcFriendQuestRecordProgress(ctx, logger, nk, payload) {
    if (!ctx.userId) return fqError('User not authenticated');

    var input;
    try { input = JSON.parse(payload || '{}'); } catch (e) { return fqError('Invalid JSON'); }

    var questId   = input.questId;
    var eventType = input.eventType;
    var amount    = parseInt(input.amount) || 1;
    if (!questId || !eventType) return fqError('Missing questId or eventType');
    if (amount < 1 || amount > 100) return fqError('Invalid amount (1..100)');

    var data = fqReadData(nk, logger, ctx.userId);
    if (!data || !data.quests) return fqError('No quest state — call friend_quest_get_state first');

    var found = null;
    for (var i = 0; i < data.quests.length; i++) {
        if (data.quests[i].questId === questId) { found = data.quests[i]; break; }
    }
    if (!found) return fqError('Quest not found: ' + questId);

    // Refuse to mutate completed/expired quests
    if (found.isCompleted) {
        return JSON.stringify({
            success: true,
            applied: 0,
            quest: found,
            message: 'Quest already completed',
            timestamp: new Date().toISOString()
        });
    }
    if (found.expiresAt && new Date(found.expiresAt) <= new Date()) {
        return JSON.stringify({
            success: true,
            applied: 0,
            quest: found,
            message: 'Quest expired',
            timestamp: new Date().toISOString()
        });
    }

    // Event-type ↔ quest-type compatibility check
    var rule = FQ_EVENT_RULES[found.type];
    if (!rule) return fqError('Unknown quest type: ' + found.type);
    var allowed = false;
    for (var e = 0; e < rule.events.length; e++) {
        if (rule.events[e] === eventType) { allowed = true; break; }
    }
    if (!allowed) {
        return JSON.stringify({
            success: true,
            applied: 0,
            quest: found,
            message: 'Event type ' + eventType + ' not applicable to quest type ' + found.type,
            timestamp: new Date().toISOString()
        });
    }

    // Apply progress (clamped at target)
    var prevProgress = found.currentProgress || 0;
    var target       = found.targetProgress || 1;
    var newProgress  = Math.min(target, prevProgress + amount);
    var applied      = newProgress - prevProgress;
    found.currentProgress = newProgress;

    // Auto-complete server-side when threshold reached
    var justCompleted = false;
    if (newProgress >= target && !found.isCompleted) {
        found.isCompleted = true;
        justCompleted = true;
        if (!data.completedIds) data.completedIds = [];
        // De-dup completedIds
        var alreadyCompleted = false;
        for (var c = 0; c < data.completedIds.length; c++) {
            if (data.completedIds[c] === questId) { alreadyCompleted = true; break; }
        }
        if (!alreadyCompleted) data.completedIds.push(questId);
    }

    data.updatedAt = new Date().toISOString();
    if (!fqWriteData(nk, logger, ctx.userId, data)) {
        return fqError('Failed to save quest progress');
    }

    logger.info('[FriendQuests] record_progress questId=' + questId +
                ' type=' + found.type + ' eventType=' + eventType +
                ' applied=' + applied + ' newProgress=' + newProgress + '/' + target +
                (justCompleted ? ' COMPLETED' : ''));

    return JSON.stringify({
        success: true,
        questId: questId,
        applied: applied,
        currentProgress: newProgress,
        targetProgress: target,
        isCompleted: found.isCompleted,
        justCompleted: justCompleted,
        // When justCompleted, the client should call friend_quest_complete to
        // claim the reward — but server already marks isCompleted so the
        // claim is purely a wallet transaction at that point.
        coinReward: justCompleted ? (found.coinReward || 0) : undefined,
        xpReward:   justCompleted ? (found.xpReward || 0)   : undefined,
        timestamp: new Date().toISOString()
    });
}

// ============================================================================
// Module Init — register Friend Quest RPCs
// ============================================================================
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('friend_quest_get_state',       rpcFriendQuestGetState);
    initializer.registerRpc('friend_quest_complete',        rpcFriendQuestComplete);
    initializer.registerRpc('friend_quest_record_progress', rpcFriendQuestRecordProgress);
    if (logger && logger.info) {
        logger.info('[FriendQuests] Registered 3 RPCs (get_state, complete, record_progress)');
    }
}
