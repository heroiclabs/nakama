// leaderboard_sync.js - Base score synchronization between per-game and global leaderboards

// Import utils
import * as utils from './utils.js';

/**
 * RPC: submit_score_sync
 * Synchronizes score between per-game and global leaderboards
 */
function submitScoreSync(ctx, logger, nk, payload) {
    try {
        // Validate authentication
        if (!ctx.userId) {
            return utils.handleError(ctx, null, "Authentication required");
        }

        // Parse and validate payload
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

        // Create metadata
        const metadata = {
            source: "submit_score_sync",
            gameId: gameId,
            submittedAt: submittedAt
        };

        const gameLeaderboardId = "leaderboard_" + gameId;
        const globalLeaderboardId = "leaderboard_global";

        utils.logInfo(logger, "Submitting score: " + score + " for user " + username + " to game " + gameId);

        // Write to per-game leaderboard
        try {
            nk.leaderboardRecordWrite(
                gameLeaderboardId,
                userId,
                username,
                score,
                0, // subscore
                metadata
            );
            utils.logInfo(logger, "Score written to game leaderboard: " + gameLeaderboardId);
        } catch (err) {
            utils.logError(logger, "Failed to write to game leaderboard: " + err.message);
            return utils.handleError(ctx, err, "Failed to write score to game leaderboard");
        }

        // Write to global leaderboard
        try {
            nk.leaderboardRecordWrite(
                globalLeaderboardId,
                userId,
                username,
                score,
                0, // subscore
                metadata
            );
            utils.logInfo(logger, "Score written to global leaderboard: " + globalLeaderboardId);
        } catch (err) {
            utils.logError(logger, "Failed to write to global leaderboard: " + err.message);
            return utils.handleError(ctx, err, "Failed to write score to global leaderboard");
        }

        return JSON.stringify({
            success: true,
            gameId: gameId,
            score: score,
            userId: userId,
            submittedAt: submittedAt
        });

    } catch (err) {
        utils.logError(logger, "Unexpected error in submitScoreSync: " + err.message);
        return utils.handleError(ctx, err, "An error occurred while processing your request");
    }
}

// Register RPC in InitModule context if available
var rpcSubmitScoreSync = submitScoreSync;

// Export for module systems (ES Module syntax)
export {
    submitScoreSync,
    rpcSubmitScoreSync
};
