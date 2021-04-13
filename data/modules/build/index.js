"use strict";
var ClanNotificationCode;
(function (ClanNotificationCode) {
    ClanNotificationCode[ClanNotificationCode["Refresh"] = 2] = "Refresh";
    ClanNotificationCode[ClanNotificationCode["Delete"] = 3] = "Delete";
})(ClanNotificationCode || (ClanNotificationCode = {}));
var afterJoinGroupFn = function (ctx, logger, nk, data, request) {
    var _a;
    sendGroupNotification(nk, (_a = request.groupId, (_a !== null && _a !== void 0 ? _a : "")), ClanNotificationCode.Refresh, "New Member Joined!");
};
var afterKickGroupUsersFn = function (ctx, logger, nk, data, request) {
    var _a;
    sendGroupNotification(nk, (_a = request.groupId, (_a !== null && _a !== void 0 ? _a : "")), ClanNotificationCode.Refresh, "Member(s) Have Been Kicked!");
};
var afterLeaveGroupFn = function (ctx, logger, nk, data, request) {
    var _a;
    sendGroupNotification(nk, (_a = request.groupId, (_a !== null && _a !== void 0 ? _a : "")), ClanNotificationCode.Refresh, "Member Left!");
};
var afterPromoteGroupUsersFn = function (ctx, logger, nk, data, request) {
    var _a;
    sendGroupNotification(nk, (_a = request.groupId, (_a !== null && _a !== void 0 ? _a : "")), ClanNotificationCode.Refresh, "Member(s) Have Been Promoted!");
};
var beforeDeleteGroupFn = function (ctx, logger, nk, request) {
    var _a;
    var members = nk.groupUsersList(request.groupId, 100, 0);
    (_a = members.groupUsers) === null || _a === void 0 ? void 0 : _a.every(function (user) {
        var _a;
        if (user.user.userId == ctx.userId) {
            sendGroupNotification(nk, (_a = request.groupId, (_a !== null && _a !== void 0 ? _a : "")), ClanNotificationCode.Delete, "Clan Deleted!");
            return false;
        }
        return true;
    });
    return request;
};
function sendGroupNotification(nk, groupId, code, subject) {
    var _a, _b;
    var members = nk.groupUsersList(groupId, 100);
    var count = (_a = members.groupUsers, (_a !== null && _a !== void 0 ? _a : [])).length;
    if (count < 1) {
        return;
    }
    var notifications = new Array(count);
    (_b = members.groupUsers) === null || _b === void 0 ? void 0 : _b.forEach(function (user) {
        var n = {
            code: code,
            content: {},
            persistent: false,
            subject: subject,
            userId: user.user.userId,
        };
        notifications.push(n);
    });
    nk.notificationsSend(notifications);
}
var DeckPermissionRead = 2;
var DeckPermissionWrite = 0;
var DeckCollectionName = 'card_collection';
var DeckCollectionKey = 'user_cards';
var DefaultDeckCards = [
    {
        type: 1,
        level: 1,
    },
    {
        type: 1,
        level: 1,
    },
    {
        type: 2,
        level: 1,
    },
    {
        type: 2,
        level: 1,
    },
    {
        type: 3,
        level: 1,
    },
    {
        type: 4,
        level: 1,
    },
];
var DefaultStoredCards = [
    {
        type: 2,
        level: 1,
    },
    {
        type: 2,
        level: 1,
    },
    {
        type: 3,
        level: 1,
    },
    {
        type: 4,
        level: 1,
    },
];
var rpcSwapDeckCard = function (ctx, logger, nk, payload) {
    var request = JSON.parse(payload);
    var userCards = loadUserCards(nk, logger, ctx.userId);
    if (Object.keys(userCards.deckCards).indexOf(request.cardOutId) < 0) {
        throw Error('invalid out card');
    }
    if (Object.keys(userCards.storedCards).indexOf(request.cardInId) < 0) {
        throw Error('invalid in card');
    }
    var outCard = userCards.deckCards[request.cardOutId];
    var inCard = userCards.storedCards[request.cardInId];
    delete (userCards.deckCards[request.cardOutId]);
    delete (userCards.storedCards[request.cardInId]);
    userCards.deckCards[request.cardInId] = inCard;
    userCards.storedCards[request.cardOutId] = outCard;
    storeUserCards(nk, logger, ctx.userId, userCards);
    logger.debug("user '%s' deck card '%s' swapped with '%s'", ctx.userId);
    return JSON.stringify(userCards);
};
var rpcUpgradeCard = function (ctx, logger, nk, payload) {
    var request = JSON.parse(payload);
    var userCards = loadUserCards(nk, logger, ctx.userId);
    if (!userCards) {
        logger.error('user %s card collection not found', ctx.userId);
        throw Error('Internal server error');
    }
    var card = userCards.deckCards[request.id];
    if (card) {
        card.level += 1;
        userCards.deckCards[request.id] = card;
    }
    card = userCards.storedCards[request.id];
    if (card) {
        card.level += 1;
        userCards.storedCards[request.id] = card;
    }
    if (!card) {
        logger.error('invalid card');
        throw Error('invalid card');
    }
    try {
        storeUserCards(nk, logger, ctx.userId, userCards);
    }
    catch (error) {
        throw Error('Internal server error');
    }
    logger.debug('user %s card %s upgraded', ctx.userId, JSON.stringify(card));
    return JSON.stringify(card);
};
var rpcResetCardCollection = function (ctx, logger, nk, payload) {
    var collection = defaultCardCollection(nk, logger, ctx.userId);
    storeUserCards(nk, logger, ctx.userId, collection);
    logger.debug('user %s card collection has been reset', ctx.userId);
    return JSON.stringify(collection);
};
var rpcLoadUserCards = function (ctx, logger, nk, payload) {
    return JSON.stringify(loadUserCards(nk, logger, ctx.userId));
};
var rpcBuyRandomCard = function (ctx, logger, nk, payload) {
    var _a, _b;
    var type = Math.floor(Math.random() * 4) + 1;
    var userCards;
    try {
        userCards = loadUserCards(nk, logger, ctx.userId);
    }
    catch (error) {
        logger.error('error loading user cards: %s', error.message);
        throw Error('Internal server error');
    }
    var cardId = nk.uuidv4();
    var newCard = {
        type: type,
        level: 1,
    };
    userCards.storedCards[cardId] = newCard;
    try {
        nk.walletUpdate(ctx.userId, (_a = {}, _a[currencyKeyName] = -100, _a));
        storeUserCards(nk, logger, ctx.userId, userCards);
    }
    catch (error) {
        logger.error('error buying card: %s', error.message);
        throw error;
    }
    logger.debug('user %s successfully bought a new card', ctx.userId);
    return JSON.stringify((_b = {}, _b[cardId] = newCard, _b));
};
function loadUserCards(nk, logger, userId) {
    var storageReadReq = {
        key: DeckCollectionKey,
        collection: DeckCollectionName,
        userId: userId,
    };
    var objects;
    try {
        objects = nk.storageRead([storageReadReq]);
    }
    catch (error) {
        logger.error('storageRead error: %s', error.message);
        throw error;
    }
    if (objects.length === 0) {
        throw Error('user cards storage object not found');
    }
    var storedCardCollection = objects[0].value;
    return storedCardCollection;
}
function storeUserCards(nk, logger, userId, cards) {
    try {
        nk.storageWrite([
            {
                key: DeckCollectionKey,
                collection: DeckCollectionName,
                userId: userId,
                value: cards,
                permissionRead: DeckPermissionRead,
                permissionWrite: DeckPermissionWrite,
            }
        ]);
    }
    catch (error) {
        logger.error('storageWrite error: %s', error.message);
        throw error;
    }
}
function getRandomInt(min, max) {
    return min + Math.floor(Math.random() * Math.floor(max));
}
function defaultCardCollection(nk, logger, userId) {
    var deck = {};
    DefaultDeckCards.forEach(function (c) {
        deck[nk.uuidv4()] = c;
    });
    var stored = {};
    DefaultStoredCards.forEach(function (c) {
        stored[nk.uuidv4()] = c;
    });
    var cards = {
        deckCards: deck,
        storedCards: stored,
    };
    storeUserCards(nk, logger, userId, cards);
    return {
        deckCards: deck,
        storedCards: stored,
    };
}
var currencyKeyName = 'gems';
var rpcAddUserGems = function (ctx, logger, nk) {
    var walletUpdateResult = updateWallet(nk, ctx.userId, 100, {});
    var updateString = JSON.stringify(walletUpdateResult);
    logger.debug('Added 100 gems to user %s wallet: %s', ctx.userId, updateString);
    return updateString;
};
function updateWallet(nk, userId, amount, metadata) {
    var _a;
    var changeset = (_a = {},
        _a[currencyKeyName] = amount,
        _a);
    var result = nk.walletUpdate(userId, changeset, metadata, true);
    return result;
}
var dummyUserDeviceId = 'B1DA5988-FC6F-4B6F-8EA9-217DEEC3CDB6';
var dummyUserDeviceUsername = 'SuperPirate';
var globalLeaderboard = 'global';
var leaderboardIds = [
    globalLeaderboard,
];
var InitModule = function (ctx, logger, nk, initializer) {
    nk.authenticateDevice(dummyUserDeviceId, dummyUserDeviceUsername, true);
    var authoritative = false;
    var metadata = {};
    var scoreOperator = "best";
    var sortOrder = "desc";
    var resetSchedule = null;
    leaderboardIds.forEach(function (id) {
        nk.leaderboardCreate(id, authoritative, sortOrder, scoreOperator, resetSchedule, metadata);
        logger.info('leaderboard %q created', id);
    });
    initializer.registerAfterAuthenticateDevice(afterAuthenticateDeviceFn);
    initializer.registerAfterAuthenticateFacebook(afterAuthenticateFacebookFn);
    initializer.registerAfterJoinGroup(afterJoinGroupFn);
    initializer.registerAfterKickGroupUsers(afterKickGroupUsersFn);
    initializer.registerAfterLeaveGroup(afterLeaveGroupFn);
    initializer.registerAfterPromoteGroupUsers(afterPromoteGroupUsersFn);
    initializer.registerAfterAddFriends(afterAddFriendsFn);
    initializer.registerBeforeDeleteGroup(beforeDeleteGroupFn);
    initializer.registerRpc('search_username', rpcSearchUsernameFn);
    initializer.registerRpc('swap_deck_card', rpcSwapDeckCard);
    initializer.registerRpc('upgrade_card', rpcUpgradeCard);
    initializer.registerRpc('reset_card_collection', rpcResetCardCollection);
    initializer.registerRpc('add_user_gems', rpcAddUserGems);
    initializer.registerRpc('load_user_cards', rpcLoadUserCards);
    initializer.registerRpc('add_random_card', rpcBuyRandomCard);
    initializer.registerRpc('handle_match_end', rpcHandleMatchEnd);
    logger.warn('Pirate Panic TypeScript loaded.');
};
var afterAuthenticateDeviceFn = function (ctx, logger, nk, data, req) {
    afterAuthenticate(ctx, logger, nk, data);
};
var afterAuthenticateFacebookFn = function (ctx, logger, nk, data, req) {
    afterAuthenticate(ctx, logger, nk, data);
};
function afterAuthenticate(ctx, logger, nk, data) {
    logger.info('after auth called, created: %v', data.created);
    if (!data.created) {
        return;
    }
    var initialState = {
        'level': Math.floor(Math.random() * 100),
        'wins': Math.floor(Math.random() * 100),
        'gamesPlayed': Math.floor(Math.random() * 200),
    };
    var writeStats = {
        collection: 'stats',
        key: 'public',
        permissionRead: 2,
        permissionWrite: 0,
        value: initialState,
        userId: ctx.userId,
    };
    var writeAddFriendQuest = addFriendQuestInit(ctx.userId);
    var writeCards = {
        collection: DeckCollectionName,
        key: DeckCollectionKey,
        permissionRead: DeckPermissionRead,
        permissionWrite: DeckPermissionWrite,
        value: defaultCardCollection(nk, logger, ctx.userId),
        userId: ctx.userId,
    };
    try {
        nk.storageWrite([writeStats, writeAddFriendQuest, writeCards]);
    }
    catch (error) {
        logger.error('storageWrite error: %q', error);
        throw error;
    }
}
var rpcSearchUsernameFn = function (ctx, logger, nk, payload) {
    var input = JSON.parse(payload);
    var query = "\n    SELECT id, username FROM users WHERE username ILIKE concat($1, '%')\n    ";
    var result = nk.sqlQuery(query, [input.username]);
    return JSON.stringify(result);
};
var QuestsCollectionKey = 'quests';
var AddFriendQuestKey = 'add_friend';
var AddFriendQuestReward = 1000;
var AddFriendQuestNotificationCode = 1;
function addFriendQuestInit(userId) {
    return {
        collection: QuestsCollectionKey,
        key: AddFriendQuestKey,
        permissionRead: 1,
        permissionWrite: 0,
        value: { done: false },
        userId: userId,
    };
}
function getFriendQuest(nk, logger, userId) {
    var storageReadReq = {
        collection: QuestsCollectionKey,
        key: AddFriendQuestKey,
        userId: userId,
    };
    var objects;
    try {
        objects = nk.storageRead([storageReadReq]);
    }
    catch (error) {
        logger.error('storageRead error: %s', error.message);
        throw error;
    }
    if (objects.length === 0) {
        throw Error('user add_friend quest storage object not found');
    }
    return objects[0];
}
var afterAddFriendsFn = function (ctx, logger, nk, data, request) {
    var storedQuest = getFriendQuest(nk, logger, ctx.userId);
    var addFriendQuest = storedQuest.value;
    if (!addFriendQuest.done) {
        var quest = addFriendQuestInit(ctx.userId);
        quest.value.done = true;
        try {
            nk.storageWrite([quest]);
        }
        catch (error) {
            logger.error('storageWrite error: %q', error);
            throw error;
        }
        var subject = JSON.stringify('A new friend!');
        var content = { reward: AddFriendQuestReward };
        var code = AddFriendQuestNotificationCode;
        var senderId = null;
        var persistent = true;
        nk.notificationSend(ctx.userId, subject, content, code, senderId, persistent);
        logger.info('user %s completed add_friend quest!', ctx.userId);
    }
};
var winnerBonus = 10;
var towerDestroyedMultiplier = 5;
var speedBonus = 5;
var winReward = 180;
var loseReward = 110;
function calculateScore(isWinner, towersDestroyed, matchDuration) {
    var score = isWinner ? winnerBonus : 0;
    score += towersDestroyed * towerDestroyedMultiplier;
    var durationMin = Math.floor(matchDuration / 60);
    var timeScore = 0;
    if (isWinner) {
        timeScore = Math.max(1, speedBonus - durationMin);
    }
    else {
        timeScore = Math.max(1, Math.min(durationMin, speedBonus));
    }
    score += timeScore;
    return Math.round(score);
}
function rpcGetMatchScore(ctx, logger, nk, payload) {
    var matchId = JSON.parse(payload)['match_id'];
    if (!matchId) {
        throw Error('missing match_id from payload');
    }
    var items = nk.walletLedgerList(ctx.userId, 100);
    while (items.cursor) {
        items = nk.walletLedgerList(ctx.userId, 100, items.cursor);
    }
    var lastMatchReward = {};
    for (var _i = 0, _a = items.items; _i < _a.length; _i++) {
        var update = _a[_i];
        if (update.metadata.source === 'match_reward'
            && update.metadata.match_id === matchId) {
            lastMatchReward = update;
        }
    }
    return JSON.stringify(lastMatchReward);
}
var MatchEndPlacement;
(function (MatchEndPlacement) {
    MatchEndPlacement[MatchEndPlacement["Loser"] = 0] = "Loser";
    MatchEndPlacement[MatchEndPlacement["Winner"] = 1] = "Winner";
})(MatchEndPlacement || (MatchEndPlacement = {}));
var rpcHandleMatchEnd = function (ctx, logger, nk, payload) {
    if (!payload) {
        throw Error('no data found in rpc payload');
    }
    var request = JSON.parse(payload);
    var score = calculateScore(request.placement == MatchEndPlacement.Winner, request.towersDestroyed, request.time);
    var metadata = {
        source: 'match_reward',
        match_id: request.matchId,
    };
    updateWallet(nk, ctx.userId, score, metadata);
    nk.leaderboardRecordWrite(globalLeaderboard, ctx.userId, ctx.username, score);
    var response = {
        gems: request.placement == MatchEndPlacement.Winner ? winReward : loseReward,
        score: score
    };
    logger.debug('match %s ended', ctx.matchId);
    return JSON.stringify(response);
};
