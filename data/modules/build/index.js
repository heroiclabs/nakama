"use strict";
// Copyright 2020 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
var rpcIdRewards = 'rewards_js';
var rpcIdFindMatch = 'find_match_js';
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc(rpcIdRewards, rpcReward);
    initializer.registerRpc(rpcIdFindMatch, rpcFindMatch);
    initializer.registerMatch(moduleName, {
        matchInit: matchInit,
        matchJoinAttempt: matchJoinAttempt,
        matchJoin: matchJoin,
        matchLeave: matchLeave,
        matchLoop: matchLoop,
        matchTerminate: matchTerminate,
    });
    logger.info('JavaScript logic loaded.');
}
// Copyright 2020 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
function rpcReward(context, logger, nk, payload) {
    if (!context.userId) {
        throw Error('No user ID in context');
    }
    if (payload) {
        throw Error('no input allowed');
    }
    var objectId = {
        collection: 'reward',
        key: 'daily',
        userId: context.userId,
    };
    var objects;
    try {
        objects = nk.storageRead([objectId]);
    }
    catch (error) {
        logger.error('storageRead error: %s', error);
        throw error;
    }
    var dailyReward = {
        lastClaimUnix: 0,
    };
    objects.forEach(function (object) {
        if (object.key == 'daily') {
            dailyReward = object.value;
        }
    });
    var resp = {
        coinsReceived: 0,
    };
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    // If last claimed is before the new day grant a new reward!
    if (dailyReward.lastClaimUnix < msecToSec(d.getTime())) {
        resp.coinsReceived = 500;
        // Update player wallet.
        var changeset = {
            coins: resp.coinsReceived,
        };
        try {
            nk.walletUpdate(context.userId, changeset, {}, false);
        }
        catch (error) {
            logger.error('walletUpdate error: %q', error);
            throw error;
        }
        var notification = {
            code: 1001,
            content: changeset,
            persistent: true,
            subject: "You've received your daily reward!",
            userId: context.userId,
        };
        try {
            nk.notificationsSend([notification]);
        }
        catch (error) {
            logger.error('notificationsSend error: %q', error);
            throw error;
        }
        dailyReward.lastClaimUnix = msecToSec(Date.now());
        var write = {
            collection: 'reward',
            key: 'daily',
            permissionRead: 1,
            permissionWrite: 0,
            value: dailyReward,
            userId: context.userId,
        };
        if (objects.length > 0) {
            write.version = objects[0].version;
        }
        try {
            nk.storageWrite([write]);
        }
        catch (error) {
            logger.error('storageWrite error: %q', error);
            throw error;
        }
    }
    var result = JSON.stringify(resp);
    logger.debug('rpcReward resp: %q', result);
    return result;
}
function msecToSec(n) {
    return Math.floor(n / 1000);
}
var Mark;
(function (Mark) {
    Mark[Mark["X"] = 0] = "X";
    Mark[Mark["O"] = 1] = "O";
    Mark[Mark["UNDEFINED"] = 2] = "UNDEFINED";
})(Mark || (Mark = {}));
// The complete set of opcodes used for communication between clients and server.
var OpCode;
(function (OpCode) {
    // New game round starting.
    OpCode[OpCode["START"] = 1] = "START";
    // Update to the state of an ongoing round.
    OpCode[OpCode["UPDATE"] = 2] = "UPDATE";
    // A game round has just completed.
    OpCode[OpCode["DONE"] = 3] = "DONE";
    // A move the player wishes to make and sends to the server.
    OpCode[OpCode["MOVE"] = 4] = "MOVE";
    // Move was rejected.
    OpCode[OpCode["REJECTED"] = 5] = "REJECTED";
})(OpCode || (OpCode = {}));
// Copyright 2020 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
var moduleName = "tic-tac-toe_js";
var tickRate = 5;
var maxEmptySec = 30;
var delaybetweenGamesSec = 5;
var turnTimeFastSec = 10;
var turnTimeNormalSec = 20;
var winningPositions = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
];
var matchInit = function (ctx, logger, nk, params) {
    var fast = !!params['fast'];
    var label = {
        open: 1,
        fast: 0,
    };
    if (fast) {
        label.fast = 1;
    }
    var state = {
        label: label,
        emptyTicks: 0,
        presences: {},
        joinsInProgress: 0,
        playing: false,
        board: [],
        marks: {},
        mark: Mark.UNDEFINED,
        deadlineRemainingTicks: 0,
        winner: null,
        winnerPositions: null,
        nextGameRemainingTicks: 0,
    };
    return {
        state: state,
        tickRate: tickRate,
        label: JSON.stringify(label),
    };
};
var matchJoinAttempt = function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
    var s = state;
    // Check if it's a user attempting to rejoin after a disconnect.
    if (presence.userId in s.presences) {
        if (s.presences[presence.userId] === undefined) {
            // User rejoining after a disconnect.
            s.joinsInProgress++;
            return {
                state: s,
                accept: false,
            };
        }
        else {
            // User attempting to join from 2 different devices at the same time.
            return {
                state: s,
                accept: false,
                rejectMessage: 'already joined',
            };
        }
    }
    // Check if match is full.
    if (Object.keys(s.presences).length + s.joinsInProgress >= 2) {
        return {
            state: s,
            accept: false,
            rejectMessage: 'match full',
        };
    }
    // New player attempting to connect.
    s.joinsInProgress++;
    return {
        state: s,
        accept: true,
    };
};
var matchJoin = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    var s = state;
    var t = msecToSec(Date.now());
    for (var _i = 0, presences_1 = presences; _i < presences_1.length; _i++) {
        var presence = presences_1[_i];
        s.emptyTicks = 0;
        s.presences[presence.userId] = presence;
        s.joinsInProgress--;
        // Check if we must send a message to this user to update them on the current game state.
        if (s.playing) {
            // There's a game still currently in progress, the player is re-joining after a disconnect. Give them a state update.
            var update = {
                board: s.board,
                mark: s.mark,
                deadline: t + Math.floor(s.deadlineRemainingTicks / tickRate),
            };
            // Send a message to the user that just joined.
            dispatcher.broadcastMessage(OpCode.UPDATE, JSON.stringify(update));
        }
        else if (s.board.length !== 0 && Object.keys(s.marks).length !== 0 && s.marks[presence.userId]) {
            logger.debug('player %s rejoined game', presence.userId);
            // There's no game in progress but we still have a completed game that the user was part of.
            // They likely disconnected before the game ended, and have since forfeited because they took too long to return.
            var done = {
                board: s.board,
                winner: s.winner,
                winnerPositions: s.winnerPositions,
                nextGameStart: t + Math.floor(s.nextGameRemainingTicks / tickRate)
            };
            // Send a message to the user that just joined.
            dispatcher.broadcastMessage(OpCode.DONE, JSON.stringify(done));
        }
    }
    var label = s.label;
    // Check if match was open to new players, but should now be closed.
    if (Object.keys(s.presences).length >= 2 && s.label.open != 0) {
        s.label.open = 0;
        var labelJSON = JSON.stringify(s.label);
        dispatcher.matchLabelUpdate(labelJSON);
    }
    return { state: s };
};
var matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    var s = state;
    for (var _i = 0, presences_2 = presences; _i < presences_2.length; _i++) {
        var presence = presences_2[_i];
        logger.info("Player: %s left match: %s.", presence.userId, ctx.matchId);
        delete s.presences[presence.userId];
    }
    return { state: s };
};
var matchLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
    var _a;
    var s = state;
    logger.debug('Running match loop. Tick: %d', tick);
    if (Object.keys(s.presences).length + s.joinsInProgress === 0) {
        s.emptyTicks++;
        if (s.emptyTicks >= maxEmptySec * tickRate) {
            // Match has been empty for too long, close it.
            logger.info('closing idle match');
            return null;
        }
    }
    s.board.push('test');
    var t = msecToSec(Date.now());
    // If there's no game in progress check if we can (and should) start one!
    if (!s.playing) {
        // Between games any disconnected users are purged, there's no in-progress game for them to return to anyway.
        for (var userID in s.presences) {
            if (s.presences[userID] === null) {
                delete s.presences[userID];
            }
        }
        // Check if we need to update the label so the match now advertises itself as open to join.
        if (Object.keys(s.presences).length < 2 && s.label.open != 1) {
            s.label.open = 1;
            var labelJSON = JSON.stringify(s.label);
            dispatcher.matchLabelUpdate(labelJSON);
        }
        // Check if we have enough players to start a game.
        if (Object.keys(s.presences).length < 2) {
            return { state: s };
        }
        // Check if enough time has passed since the last game.
        if (s.nextGameRemainingTicks > 0) {
            s.nextGameRemainingTicks--;
            return { state: s };
        }
        // We can start a game! Set up the game state and assign the marks to each player.
        s.playing = true;
        s.board = new Array(9);
        s.marks = {};
        var marks_1 = [Mark.X, Mark.O];
        Object.keys(s.presences).forEach(function (userId) {
            var _a;
            s.marks[userId] = (_a = marks_1.shift(), (_a !== null && _a !== void 0 ? _a : null));
        });
        s.mark = Mark.X;
        s.winner = null;
        s.winnerPositions = null;
        s.deadlineRemainingTicks = calculateDeadlineTicks(s.label);
        s.nextGameRemainingTicks = 0;
        // Notify the players a new game has started.
        var msg = {
            board: s.board,
            marks: s.marks,
            mark: s.mark,
            deadline: t + Math.floor(s.deadlineRemainingTicks / tickRate),
        };
        dispatcher.broadcastMessage(OpCode.START, JSON.stringify(msg));
        return { state: s };
    }
    // There's a game in progress. Check for input, update match state, and send messages to clients.
    for (var _i = 0, messages_1 = messages; _i < messages_1.length; _i++) {
        var message = messages_1[_i];
        switch (message.opCode) {
            case OpCode.MOVE:
                logger.debug('Received move message from user: %v', s.marks);
                var mark = (_a = s.marks[message.sender.userId], (_a !== null && _a !== void 0 ? _a : null));
                if (mark === null || s.mark != mark) {
                    // It is not this player's turn.
                    dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
                    continue;
                }
                var msg = {};
                try {
                    msg = JSON.parse(message.data);
                }
                catch (error) {
                    // Client sent bad data.
                    dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
                    logger.debug('Bad data received: %v', error);
                    continue;
                }
                if (s.board[msg.position]) {
                    // Client sent a position outside the board, or one that has already been played.
                    dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
                    continue;
                }
                // Update the game state.
                s.board[msg.position] = mark;
                s.mark = mark === Mark.O ? Mark.X : Mark.O;
                s.deadlineRemainingTicks = calculateDeadlineTicks(s.label);
                // Check if game is over through a winning move.
                var _b = winCheck(s.board, mark), winner = _b[0], winningPos = _b[1];
                if (winner) {
                    s.winner = mark;
                    s.winnerPositions = winningPos;
                    s.playing = false;
                    s.deadlineRemainingTicks = 0;
                    s.nextGameRemainingTicks = delaybetweenGamesSec * tickRate;
                }
                // Check if game is over because no more moves are possible.
                var tie = s.board.every(function (v) { return v !== null; });
                if (tie) {
                    // Update state to reflect the tie, and schedule the next game.
                    s.playing = false;
                    s.deadlineRemainingTicks = 0;
                    s.nextGameRemainingTicks = delaybetweenGamesSec * tickRate;
                }
                var opCode = void 0;
                var outgoingMsg = void 0;
                if (s.playing) {
                    opCode = OpCode.UPDATE;
                    var msg_1 = {
                        board: s.board,
                        mark: s.mark,
                        deadline: t + Math.floor(s.deadlineRemainingTicks / tickRate),
                    };
                    outgoingMsg = msg_1;
                }
                else {
                    opCode = OpCode.DONE;
                    var msg_2 = {
                        board: s.board,
                        winner: s.winner,
                        winnerPositions: s.winnerPositions,
                        nextGameStart: t + Math.floor(s.nextGameRemainingTicks / tickRate),
                    };
                    outgoingMsg = msg_2;
                }
                dispatcher.broadcastMessage(opCode, JSON.stringify(outgoingMsg));
                break;
            default:
                // No other opcodes are expected from the client, so automatically treat it as an error.
                dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
                logger.error('Unexpected opcode received: %d', message.opCode);
        }
    }
    // Keep track of the time remaining for the player to submit their move. Idle players forfeit.
    if (s.playing) {
        s.deadlineRemainingTicks--;
        if (s.deadlineRemainingTicks <= 0) {
            // The player has run out of time to submit their move.
            s.playing = false;
            s.winner = s.mark === Mark.O ? Mark.X : Mark.O;
            s.deadlineRemainingTicks = 0;
            s.nextGameRemainingTicks = delaybetweenGamesSec * tickRate;
            var msg = {
                board: s.board,
                winner: s.winner,
                nextGameStart: t + Math.floor(s.nextGameRemainingTicks / tickRate),
                winnerPositions: null,
            };
            dispatcher.broadcastMessage(OpCode.DONE, JSON.stringify(msg));
        }
    }
    return { state: s };
};
var matchTerminate = function (ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
    return { state: state };
};
function calculateDeadlineTicks(l) {
    if (l.fast === 1) {
        return turnTimeFastSec * tickRate;
    }
    else {
        return turnTimeNormalSec * tickRate;
    }
}
function winCheck(board, mark) {
    for (var _i = 0, winningPositions_1 = winningPositions; _i < winningPositions_1.length; _i++) {
        var wp = winningPositions_1[_i];
        if (board[wp[0]] === mark &&
            board[wp[1]] === mark &&
            board[wp[2]] === mark) {
            return [true, wp];
        }
    }
    return [false, null];
}
// Copyright 2020 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
var rpcFindMatch = function (ctx, logger, nk, payload) {
    if (!ctx.userId) {
        throw Error('No user ID in context');
    }
    if (!payload) {
        throw Error('Expects payload.');
    }
    var request = {};
    try {
        request = JSON.parse(payload);
    }
    catch (error) {
        logger.error('Error parsing json message: %q', error);
        throw error;
    }
    var matches;
    try {
        var query = "+label.open:1 +label.fast:" + (request.fast ? 1 : 0);
        matches = nk.matchList(10, true, null, null, 1, query);
    }
    catch (error) {
        logger.error('Error listing matches: %v', error);
        throw error;
    }
    var matchIds = [];
    if (matches.length > 0) {
        // There are one or more ongoing matches the user could join.
        matchIds = matches.map(function (m) { return m.matchId; });
    }
    else {
        // No available matches found, create a new one.
        try {
            matchIds.push(nk.matchCreate(moduleName, { fast: request.fast }));
        }
        catch (error) {
            logger.error('Error creating match: %v', error);
            throw error;
        }
    }
    var res = { matchIds: matchIds };
    return JSON.stringify(res);
};
