// leaderboard_sync.js - Score synchronization between per-game and global leaderboards
// ES5 compatible for Nakama goja runtime

function rpcSubmitScoreSync(ctx, logger, nk, payload) {
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

        var metadata = {
            source: "submit_score_sync",
            gameId: gameId,
            submittedAt: submittedAt
        };

        var gameLeaderboardId = "leaderboard_" + gameId;
        var globalLeaderboardId = "leaderboard_global";

        copilotLogInfo(logger, "Submitting score: " + score + " for user " + username + " to game " + gameId);

        try {
            nk.leaderboardRecordWrite(gameLeaderboardId, userId, username, score, 0, metadata);
            copilotLogInfo(logger, "Score written to game leaderboard: " + gameLeaderboardId);
        } catch (err) {
            copilotLogError(logger, "Failed to write to game leaderboard: " + err.message);
            return copilotHandleError(ctx, err, "Failed to write score to game leaderboard");
        }

        try {
            nk.leaderboardRecordWrite(globalLeaderboardId, userId, username, score, 0, metadata);
            copilotLogInfo(logger, "Score written to global leaderboard: " + globalLeaderboardId);
        } catch (err) {
            copilotLogError(logger, "Failed to write to global leaderboard: " + err.message);
            return copilotHandleError(ctx, err, "Failed to write score to global leaderboard");
        }

        return JSON.stringify({
            success: true,
            gameId: gameId,
            score: score,
            userId: userId,
            submittedAt: submittedAt
        });

    } catch (err) {
        copilotLogError(logger, "Unexpected error in rpcSubmitScoreSync: " + err.message);
        return copilotHandleError(ctx, err, "An error occurred while processing your request");
    }
}
