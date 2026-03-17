// friend_quests.js - Friend Quest System for QuizVerse v3.0
// RPCs: friend_quest_get_state, friend_quest_complete
// Spec: MRS §31 — 4 quest types

/**
 * Friend Quest System — Production-Ready
 *
 * 4 quest types: PlayTogether, ChallengeFriend, StudyBuddy, GroupStreak.
 * Tracks progress, grants rewards (wallet + notification), duplicate protection.
 *
 * Storage: collection="friend_quests", key="quest_state_{userId}"
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

var FQ_COLLECTION = 'friend_quests';

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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

function fqError(msg) {
    return JSON.stringify({ success: false, error: msg });
}

// ─── RPC: friend_quest_get_state ────────────────────────────────────────────

function rpcFriendQuestGetState(ctx, logger, nk, payload) {
    if (!ctx.userId) return fqError('User not authenticated');

    var data = fqReadData(nk, logger, ctx.userId);
    if (!data) data = fqInitData();

    return JSON.stringify({
        success: true,
        quests: data.quests || [],
        completedIds: data.completedIds || [],
        lastRefresh: data.updatedAt || null,
        timestamp: new Date().toISOString()
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

    // Update quest record if exists
    if (data.quests) {
        for (var j = 0; j < data.quests.length; j++) {
            if (data.quests[j].questId === questId) {
                data.quests[j].isCompleted = true;
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
                subject: 'Friend Quest Completed! 🎯',
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
