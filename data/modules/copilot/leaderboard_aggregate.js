// leaderboard_aggregate.js - Aggregate player scores across all game leaderboards

// Import utils if available
var utils;
try {
    utils = require('./utils');
} catch (e) {
    utils = null;
}

/**
 * RPC: submit_score_with_aggregate
 * Aggregates player scores across all game leaderboards to compute Global Power Rank
 */
function submitScoreWithAggregate(ctx, logger, nk, payload) {
    const validatePayload = utils ? utils.validatePayload : function(p, f) {
        var m = [];
        for (var i = 0; i < f.length; i++) {
            if (!p.hasOwnProperty(f[i]) || p[f[i]] === null || p[f[i]] === undefined) m.push(f[i]);
        }
        return { valid: m.length === 0, missing: m };
    };
    const readRegistry = utils ? utils.readRegistry : function(n, l) { return []; };
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
        const individualScore = parseInt(data.score);
        
        if (isNaN(individualScore)) {
            return handleError(ctx, null, "Score must be a valid number");
        }

        const userId = ctx.userId;
        const username = ctx.username || userId;
        const submittedAt = new Date().toISOString();

        logInfo(logger, "Processing aggregate score for user " + username + " in game " + gameId);

        // Write individual score to game leaderboard
        const gameLeaderboardId = "leaderboard_" + gameId;
        const metadata = {
            source: "submit_score_with_aggregate",
            gameId: gameId,
            submittedAt: submittedAt
        };

        try {
            nk.leaderboardRecordWrite(
                gameLeaderboardId,
                userId,
                username,
                individualScore,
                0,
                metadata
            );
            logInfo(logger, "Individual score written to game leaderboard: " + gameLeaderboardId);
        } catch (err) {
            logError(logger, "Failed to write individual score: " + err.message);
            return handleError(ctx, err, "Failed to write score to game leaderboard");
        }

        // Retrieve all game leaderboards from registry
        const registry = readRegistry(nk, logger);
        const gameLeaderboards = [];
        
        for (let i = 0; i < registry.length; i++) {
            if (registry[i].scope === "game" && registry[i].leaderboardId) {
                gameLeaderboards.push(registry[i].leaderboardId);
            }
        }

        logInfo(logger, "Found " + gameLeaderboards.length + " game leaderboards in registry");

        // Query all game leaderboards for this user's scores
        let aggregateScore = 0;
        let processedBoards = 0;

        for (let i = 0; i < gameLeaderboards.length; i++) {
            const leaderboardId = gameLeaderboards[i];
            try {
                const records = nk.leaderboardRecordsList(leaderboardId, [userId], 1, null, 0);
                if (records && records.records && records.records.length > 0) {
                    const userScore = records.records[0].score;
                    aggregateScore += userScore;
                    processedBoards++;
                    logInfo(logger, "Found score " + userScore + " in leaderboard " + leaderboardId);
                }
            } catch (err) {
                // Leaderboard might not exist, skip silently
                logInfo(logger, "Skipping leaderboard " + leaderboardId + ": " + err.message);
            }
        }

        logInfo(logger, "Calculated aggregate score: " + aggregateScore + " from " + processedBoards + " leaderboards");

        // Write aggregate score to global leaderboard
        const globalLeaderboardId = "leaderboard_global";
        const globalMetadata = {
            source: "submit_score_with_aggregate",
            aggregateScore: aggregateScore,
            individualScore: individualScore,
            gameId: gameId,
            submittedAt: submittedAt
        };

        try {
            nk.leaderboardRecordWrite(
                globalLeaderboardId,
                userId,
                username,
                aggregateScore,
                0,
                globalMetadata
            );
            logInfo(logger, "Aggregate score written to global leaderboard");
        } catch (err) {
            logError(logger, "Failed to write aggregate score: " + err.message);
            return handleError(ctx, err, "Failed to write aggregate score to global leaderboard");
        }

        return JSON.stringify({
            success: true,
            gameId: gameId,
            individualScore: individualScore,
            aggregateScore: aggregateScore,
            leaderboardsProcessed: processedBoards
        });

    } catch (err) {
        logError(logger, "Unexpected error in submitScoreWithAggregate: " + err.message);
        return handleError(ctx, err, "An error occurred while processing your request");
    }
}

// Register RPC in InitModule context if available
var rpcSubmitScoreWithAggregate = submitScoreWithAggregate;

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        submitScoreWithAggregate: submitScoreWithAggregate,
        rpcSubmitScoreWithAggregate: rpcSubmitScoreWithAggregate
    };
}
