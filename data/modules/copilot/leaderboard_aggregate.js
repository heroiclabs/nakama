// leaderboard_aggregate.js - Aggregate scores across all game leaderboards
// ES5 compatible for Nakama goja runtime

function rpcSubmitScoreWithAggregate(ctx, logger, nk, payload) {
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
        var individualScore = parseInt(data.score);

        if (isNaN(individualScore)) {
            return copilotHandleError(ctx, null, "Score must be a valid number");
        }

        var userId = ctx.userId;
        var username = ctx.username || userId;
        var submittedAt = new Date().toISOString();

        copilotLogInfo(logger, "Processing aggregate score for user " + username + " in game " + gameId);

        var gameLeaderboardId = "leaderboard_" + gameId;
        var metadata = {
            source: "submit_score_with_aggregate",
            gameId: gameId,
            submittedAt: submittedAt
        };

        try {
            nk.leaderboardRecordWrite(gameLeaderboardId, userId, username, individualScore, 0, metadata);
            copilotLogInfo(logger, "Individual score written to game leaderboard: " + gameLeaderboardId);
        } catch (err) {
            copilotLogError(logger, "Failed to write individual score: " + err.message);
            return copilotHandleError(ctx, err, "Failed to write score to game leaderboard");
        }

        var registry = copilotReadRegistry(nk, logger);
        var gameLeaderboards = [];

        for (var i = 0; i < registry.length; i++) {
            if (registry[i].scope === "game" && registry[i].leaderboardId) {
                gameLeaderboards.push(registry[i].leaderboardId);
            }
        }

        copilotLogInfo(logger, "Found " + gameLeaderboards.length + " game leaderboards in registry");

        var aggregateScore = 0;
        var processedBoards = 0;

        for (var j = 0; j < gameLeaderboards.length; j++) {
            var lbId = gameLeaderboards[j];
            try {
                var records = nk.leaderboardRecordsList(lbId, [userId], 1, null, 0);
                if (records && records.records && records.records.length > 0) {
                    var userScore = records.records[0].score;
                    aggregateScore += userScore;
                    processedBoards++;
                }
            } catch (err) {
                copilotLogInfo(logger, "Skipping leaderboard " + lbId + ": " + err.message);
            }
        }

        copilotLogInfo(logger, "Calculated aggregate score: " + aggregateScore + " from " + processedBoards + " leaderboards");

        var globalLeaderboardId = "leaderboard_global";
        var globalMetadata = {
            source: "submit_score_with_aggregate",
            aggregateScore: aggregateScore,
            individualScore: individualScore,
            gameId: gameId,
            submittedAt: submittedAt
        };

        try {
            nk.leaderboardRecordWrite(globalLeaderboardId, userId, username, aggregateScore, 0, globalMetadata);
            copilotLogInfo(logger, "Aggregate score written to global leaderboard");
        } catch (err) {
            copilotLogError(logger, "Failed to write aggregate score: " + err.message);
            return copilotHandleError(ctx, err, "Failed to write aggregate score to global leaderboard");
        }

        return JSON.stringify({
            success: true,
            gameId: gameId,
            individualScore: individualScore,
            aggregateScore: aggregateScore,
            leaderboardsProcessed: processedBoards
        });

    } catch (err) {
        copilotLogError(logger, "Unexpected error in rpcSubmitScoreWithAggregate: " + err.message);
        return copilotHandleError(ctx, err, "An error occurred while processing your request");
    }
}
