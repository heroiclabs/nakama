// leaderboard_friends.js - Friend-specific leaderboard features

// Import utils
import * as utils from './utils.js';

/**
 * RPC: create_all_leaderboards_with_friends
 * Creates parallel friend leaderboards for all games
 */
function createAllLeaderboardsWithFriends(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return utils.handleError(ctx, null, "Authentication required");
        }

        utils.logInfo(logger, "Creating friend leaderboards");

        const sort = "desc";
        const operator = "best";
        const resetSchedule = "0 0 * * 0"; // Weekly reset
        const created = [];
        const skipped = [];

        // Create global friends leaderboard
        const globalFriendsId = "leaderboard_friends_global";
        try {
            nk.leaderboardCreate(
                globalFriendsId,
                true,
                sort,
                operator,
                resetSchedule,
                { scope: "friends_global", desc: "Global Friends Leaderboard" }
            );
            created.push(globalFriendsId);
            utils.logInfo(logger, "Created global friends leaderboard");
        } catch (err) {
            utils.logInfo(logger, "Global friends leaderboard may already exist: " + err.message);
            skipped.push(globalFriendsId);
        }

        // Get all game leaderboards from registry
        const registry = utils.readRegistry(nk, logger);
        
        for (let i = 0; i < registry.length; i++) {
            const record = registry[i];
            if (record.scope === "game" && record.gameId) {
                const friendsLeaderboardId = "leaderboard_friends_" + record.gameId;
                try {
                    nk.leaderboardCreate(
                        friendsLeaderboardId,
                        true,
                        sort,
                        operator,
                        resetSchedule,
                        {
                            scope: "friends_game",
                            gameId: record.gameId,
                            desc: "Friends Leaderboard for game " + record.gameId
                        }
                    );
                    created.push(friendsLeaderboardId);
                    utils.logInfo(logger, "Created friends leaderboard: " + friendsLeaderboardId);
                } catch (err) {
                    utils.logInfo(logger, "Friends leaderboard may already exist: " + friendsLeaderboardId);
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
        utils.logError(logger, "Error in createAllLeaderboardsWithFriends: " + err.message);
        return utils.handleError(ctx, err, "An error occurred while creating friend leaderboards");
    }
}

/**
 * RPC: submit_score_with_friends_sync
 * Submits score to both regular and friend-specific leaderboards
 */
function submitScoreWithFriendsSync(ctx, logger, nk, payload) {
    const validatePayload = utils ? utils.validatePayload : function(p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? utils.logInfo : function(l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? utils.logError : function(l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? utils.handleError : function(c, e, m) { 
        return JSON.stringify({ success: false, error: m }); 
    };

    try {
        if (!ctx.userId) {
            return utils.handleError(ctx, null, "Authentication required");
        }

        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return utils.handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = utils.validatePayload(data, ['gameId', 'score']);
        if (!validation.valid) {
            return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(', '));
        }

        const gameId = data.gameId;
        const score = parseInt(data.score);
        
        if (isNaN(score)) {
            return utils.handleError(ctx, null, "Score must be a valid number");
        }

        const userId = ctx.userId;
        const username = ctx.username || userId;
        const submittedAt = new Date().toISOString();

        const metadata = {
            source: "submit_score_with_friends_sync",
            gameId: gameId,
            submittedAt: submittedAt
        };

        utils.logInfo(logger, "Submitting score with friends sync for user " + username);

        // Write to regular leaderboards
        const gameLeaderboardId = "leaderboard_" + gameId;
        const globalLeaderboardId = "leaderboard_global";
        const friendsGameLeaderboardId = "leaderboard_friends_" + gameId;
        const friendsGlobalLeaderboardId = "leaderboard_friends_global";

        const results = {
            regular: { game: false, global: false },
            friends: { game: false, global: false }
        };

        // Write to game leaderboard
        try {
            nk.leaderboardRecordWrite(gameLeaderboardId, userId, username, score, 0, metadata);
            results.regular.game = true;
            utils.logInfo(logger, "Score written to game leaderboard");
        } catch (err) {
            utils.logError(logger, "Failed to write to game leaderboard: " + err.message);
        }

        // Write to global leaderboard
        try {
            nk.leaderboardRecordWrite(globalLeaderboardId, userId, username, score, 0, metadata);
            results.regular.global = true;
            utils.logInfo(logger, "Score written to global leaderboard");
        } catch (err) {
            utils.logError(logger, "Failed to write to global leaderboard: " + err.message);
        }

        // Write to friends game leaderboard
        try {
            nk.leaderboardRecordWrite(friendsGameLeaderboardId, userId, username, score, 0, metadata);
            results.friends.game = true;
            utils.logInfo(logger, "Score written to friends game leaderboard");
        } catch (err) {
            utils.logError(logger, "Failed to write to friends game leaderboard: " + err.message);
        }

        // Write to friends global leaderboard
        try {
            nk.leaderboardRecordWrite(friendsGlobalLeaderboardId, userId, username, score, 0, metadata);
            results.friends.global = true;
            utils.logInfo(logger, "Score written to friends global leaderboard");
        } catch (err) {
            utils.logError(logger, "Failed to write to friends global leaderboard: " + err.message);
        }

        return JSON.stringify({
            success: true,
            gameId: gameId,
            score: score,
            results: results,
            submittedAt: submittedAt
        });

    } catch (err) {
        utils.logError(logger, "Error in submitScoreWithFriendsSync: " + err.message);
        return utils.handleError(ctx, err, "An error occurred while submitting score");
    }
}

/**
 * RPC: get_friend_leaderboard
 * Retrieves leaderboard filtered by friends
 */
function getFriendLeaderboard(ctx, logger, nk, payload) {
    const validatePayload = utils ? utils.validatePayload : function(p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const logInfo = utils ? utils.logInfo : function(l, m) { l.info("[Copilot] " + m); };
    const logError = utils ? utils.logError : function(l, m) { l.error("[Copilot] " + m); };
    const handleError = utils ? utils.handleError : function(c, e, m) { 
        return JSON.stringify({ success: false, error: m }); 
    };

    try {
        if (!ctx.userId) {
            return utils.handleError(ctx, null, "Authentication required");
        }

        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return utils.handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = utils.validatePayload(data, ['leaderboardId']);
        if (!validation.valid) {
            return utils.handleError(ctx, null, "Missing required field: leaderboardId");
        }

        const leaderboardId = data.leaderboardId;
        const limit = data.limit || 100;
        const userId = ctx.userId;

        utils.logInfo(logger, "Getting friend leaderboard for user " + userId);

        // Get user's friends list
        let friends = [];
        try {
            const friendsList = nk.friendsList(userId, limit, null, null);
            if (friendsList && friendsList.friends) {
                for (let i = 0; i < friendsList.friends.length; i++) {
                    const friend = friendsList.friends[i];
                    if (friend.user && friend.user.id) {
                        friends.push(friend.user.id);
                    }
                }
            }
            utils.logInfo(logger, "Found " + friends.length + " friends");
        } catch (err) {
            utils.logError(logger, "Failed to get friends list: " + err.message);
            return utils.handleError(ctx, err, "Failed to retrieve friends list");
        }

        // Include the user themselves
        friends.push(userId);

        // Query leaderboard for friends
        let records = [];
        try {
            const leaderboardRecords = nk.leaderboardRecordsList(leaderboardId, friends, limit, null, 0);
            if (leaderboardRecords && leaderboardRecords.records) {
                records = leaderboardRecords.records;
            }
            utils.logInfo(logger, "Retrieved " + records.length + " friend records");
        } catch (err) {
            utils.logError(logger, "Failed to query leaderboard: " + err.message);
            return utils.handleError(ctx, err, "Failed to retrieve leaderboard records");
        }

        return JSON.stringify({
            success: true,
            leaderboardId: leaderboardId,
            records: records,
            totalFriends: friends.length - 1 // Exclude self
        });

    } catch (err) {
        utils.logError(logger, "Error in getFriendLeaderboard: " + err.message);
        return utils.handleError(ctx, err, "An error occurred while retrieving friend leaderboard");
    }
}

// Register RPCs in InitModule context if available
var rpcCreateAllLeaderboardsWithFriends = createAllLeaderboardsWithFriends;
var rpcSubmitScoreWithFriendsSync = submitScoreWithFriendsSync;
var rpcGetFriendLeaderboard = getFriendLeaderboard;

// Export for module systems (ES Module syntax)
export {
    createAllLeaderboardsWithFriends,
    submitScoreWithFriendsSync,
    getFriendLeaderboard,
    rpcCreateAllLeaderboardsWithFriends,
    rpcSubmitScoreWithFriendsSync,
    rpcGetFriendLeaderboard
};
