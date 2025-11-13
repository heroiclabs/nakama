// leaderboard_sync.js - Base score synchronization between per-game and global leaderboards

// Import utils if available
var utils;
try {
    utils = require('./utils');
} catch (e) {
    // Fallback if module system not available
    utils = null;
}

/**
 * RPC: submit_score_sync
 * Synchronizes score between per-game and global leaderboards
 */
function submitScoreSync(ctx, logger, nk, payload) {
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
        // Validate authentication
        if (!ctx.userId) {
            return handleError(ctx, null, "Authentication required");
        }

        // Parse and validate payload
        let data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return handleError(ctx, err, "Invalid JSON payload");
        }

        const validation = validatePayload(data, ['gameId', 'score']);
        if (!validation.valid) {
            return handleError(ctx, null, "Missing required fields: " + validation.missing.join(', '));
        }

        const gameId = data.gameId;
        const score = parseInt(data.score);
        
        if (isNaN(score)) {
            return handleError(ctx, null, "Score must be a valid number");
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

        logInfo(logger, "Submitting score: " + score + " for user " + username + " to game " + gameId);

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
            logInfo(logger, "Score written to game leaderboard: " + gameLeaderboardId);
        } catch (err) {
            logError(logger, "Failed to write to game leaderboard: " + err.message);
            return handleError(ctx, err, "Failed to write score to game leaderboard");
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
            logInfo(logger, "Score written to global leaderboard: " + globalLeaderboardId);
        } catch (err) {
            logError(logger, "Failed to write to global leaderboard: " + err.message);
            return handleError(ctx, err, "Failed to write score to global leaderboard");
        }

        return JSON.stringify({
            success: true,
            gameId: gameId,
            score: score,
            userId: userId,
            submittedAt: submittedAt
        });

    } catch (err) {
        logError(logger, "Unexpected error in submitScoreSync: " + err.message);
        return handleError(ctx, err, "An error occurred while processing your request");
    }
}

// Register RPC in InitModule context if available
var rpcSubmitScoreSync = submitScoreSync;

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        submitScoreSync: submitScoreSync,
        rpcSubmitScoreSync: rpcSubmitScoreSync
    };
}
