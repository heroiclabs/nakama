// leaderboard_friends.js - Friend-specific leaderboard features
// ES5 compatible for Nakama goja runtime

function rpcCreateAllLeaderboardsWithFriends(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return copilotHandleError(ctx, null, "Authentication required");
        }

        copilotLogInfo(logger, "Creating friend leaderboards");

        var sort = "desc";
        var operator = "best";
        var resetSchedule = "0 0 * * 0";
        var created = [];
        var skipped = [];

        var globalFriendsId = "leaderboard_friends_global";
        try {
            nk.leaderboardCreate(
                globalFriendsId, true, sort, operator, resetSchedule,
                { scope: "friends_global", desc: "Global Friends Leaderboard" }
            );
            created.push(globalFriendsId);
        } catch (err) {
            skipped.push(globalFriendsId);
        }

        var registry = copilotReadRegistry(nk, logger);

        for (var i = 0; i < registry.length; i++) {
            var record = registry[i];
            if (record.scope === "game" && record.gameId) {
                var friendsLeaderboardId = "leaderboard_friends_" + record.gameId;
                try {
                    nk.leaderboardCreate(
                        friendsLeaderboardId, true, sort, operator, resetSchedule,
                        { scope: "friends_game", gameId: record.gameId }
                    );
                    created.push(friendsLeaderboardId);
                } catch (err) {
                    skipped.push(friendsLeaderboardId);
                }
            }
        }

        return JSON.stringify({
            success: true,
            created: created,
            skipped: skipped,
            totalProcessed: registry.length
        });

    } catch (err) {
        copilotLogError(logger, "Error in rpcCreateAllLeaderboardsWithFriends: " + err.message);
        return copilotHandleError(ctx, err, "An error occurred while creating friend leaderboards");
    }
}

function rpcSubmitScoreWithFriendsSync(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return copilotHandleError(ctx, null, "Authentication required");
        }

        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return copilotHandleError(ctx, err, "Invalid JSON payload");
        }

        var validation = copilotValidatePayload(data, ['gameId', 'score']);
        if (!validation.valid) {
            return copilotHandleError(ctx, null, "Missing required fields: " + validation.missing.join(', '));
        }

        var gameId = data.gameId;
        var score = parseInt(data.score);

        if (isNaN(score)) {
            return copilotHandleError(ctx, null, "Score must be a valid number");
        }

        var userId = ctx.userId;
        var username = ctx.username || userId;
        var submittedAt = new Date().toISOString();
        var metadata = { source: "submit_score_with_friends_sync", gameId: gameId, submittedAt: submittedAt };

        var gameLeaderboardId = "leaderboard_" + gameId;
        var globalLeaderboardId = "leaderboard_global";
        var friendsGameLeaderboardId = "leaderboard_friends_" + gameId;
        var friendsGlobalLeaderboardId = "leaderboard_friends_global";

        var results = { regular: { game: false, global: false }, friends: { game: false, global: false } };

        try { nk.leaderboardRecordWrite(gameLeaderboardId, userId, username, score, 0, metadata); results.regular.game = true; } catch (err) { copilotLogError(logger, "Failed game LB: " + err.message); }
        try { nk.leaderboardRecordWrite(globalLeaderboardId, userId, username, score, 0, metadata); results.regular.global = true; } catch (err) { copilotLogError(logger, "Failed global LB: " + err.message); }
        try { nk.leaderboardRecordWrite(friendsGameLeaderboardId, userId, username, score, 0, metadata); results.friends.game = true; } catch (err) { copilotLogError(logger, "Failed friends game LB: " + err.message); }
        try { nk.leaderboardRecordWrite(friendsGlobalLeaderboardId, userId, username, score, 0, metadata); results.friends.global = true; } catch (err) { copilotLogError(logger, "Failed friends global LB: " + err.message); }

        return JSON.stringify({ success: true, gameId: gameId, score: score, results: results, submittedAt: submittedAt });

    } catch (err) {
        copilotLogError(logger, "Error in rpcSubmitScoreWithFriendsSync: " + err.message);
        return copilotHandleError(ctx, err, "An error occurred while submitting score");
    }
}

function rpcGetFriendLeaderboard(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return copilotHandleError(ctx, null, "Authentication required");
        }

        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return copilotHandleError(ctx, err, "Invalid JSON payload");
        }

        var validation = copilotValidatePayload(data, ['leaderboardId']);
        if (!validation.valid) {
            return copilotHandleError(ctx, null, "Missing required field: leaderboardId");
        }

        var leaderboardId = data.leaderboardId;
        var limit = data.limit || 100;
        var userId = ctx.userId;

        var friends = [];
        try {
            var friendsList = nk.friendsList(userId, limit, null, null);
            if (friendsList && friendsList.friends) {
                for (var i = 0; i < friendsList.friends.length; i++) {
                    var friend = friendsList.friends[i];
                    if (friend.user && friend.user.id) {
                        friends.push(friend.user.id);
                    }
                }
            }
        } catch (err) {
            copilotLogError(logger, "Failed to get friends list: " + err.message);
            return copilotHandleError(ctx, err, "Failed to retrieve friends list");
        }

        friends.push(userId);

        var records = [];
        try {
            var leaderboardRecords = nk.leaderboardRecordsList(leaderboardId, friends, limit, null, 0);
            if (leaderboardRecords && leaderboardRecords.records) {
                records = leaderboardRecords.records;
            }
        } catch (err) {
            copilotLogError(logger, "Failed to query leaderboard: " + err.message);
            return copilotHandleError(ctx, err, "Failed to retrieve leaderboard records");
        }

        return JSON.stringify({
            success: true,
            leaderboardId: leaderboardId,
            records: records,
            totalFriends: friends.length - 1
        });

    } catch (err) {
        copilotLogError(logger, "Error in rpcGetFriendLeaderboard: " + err.message);
        return copilotHandleError(ctx, err, "An error occurred while retrieving friend leaderboard");
    }
}
