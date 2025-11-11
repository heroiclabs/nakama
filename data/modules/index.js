// index.js - Main entry point for Nakama 3.x JavaScript runtime

// Define the RPC function first
function createAllLeaderboardsPersistent(ctx, logger, nk, payload) {
    const tokenUrl = "https://api.intelli-verse-x.ai/api/admin/oauth/token";
    const gamesUrl = "https://api.intelli-verse-x.ai/api/games/games/all";
    const client_id = "54clc0uaqvr1944qvkas63o0rb";
    const client_secret = "1eb7ooua6ft832nh8dpmi37mos4juqq27svaqvmkt5grc3b7e377";
    const sort = "desc";
    const operator = "best";
    const resetSchedule = "0 0 * * 0";
    const collection = "leaderboards_registry";

    // Fetch existing records
    let existingRecords = [];
    try {
        const records = nk.storageRead([{ 
            collection: collection, 
            key: "all_created", 
            userId: ctx.userId || "00000000-0000-0000-0000-000000000000" 
        }]);
        if (records && records.length > 0 && records[0].value) {
            existingRecords = records[0].value;
        }
    } catch (err) {
        logger.warn("Failed to read existing leaderboard records: " + err);
    }

    const existingIds = new Set(existingRecords.map(function(r) { return r.leaderboardId; }));
    const created = [];
    const skipped = [];

    // Step 1: Request token
    logger.info("Requesting IntelliVerse OAuth token...");
    let tokenResponse;
    try {
        tokenResponse = nk.httpRequest(tokenUrl, "post", {
            "accept": "application/json",
            "Content-Type": "application/json"
        }, JSON.stringify({
            client_id: client_id,
            client_secret: client_secret
        }));
    } catch (err) {
        return JSON.stringify({ success: false, error: "Token request failed: " + err.message });
    }

    if (tokenResponse.code !== 200 && tokenResponse.code !== 201) {
        return JSON.stringify({ 
            success: false, 
            error: "Token request failed with code " + tokenResponse.code 
        });
    }

    let tokenData;
    try {
        tokenData = JSON.parse(tokenResponse.body);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid token response JSON." });
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
        return JSON.stringify({ success: false, error: "No access_token in response." });
    }

    // Step 2: Fetch game list
    logger.info("Fetching onboarded game list...");
    let gameResponse;
    try {
        gameResponse = nk.httpRequest(gamesUrl, "get", {
            "accept": "application/json",
            "Authorization": "Bearer " + accessToken
        });
    } catch (err) {
        return JSON.stringify({ success: false, error: "Game fetch failed: " + err.message });
    }

    if (gameResponse.code !== 200) {
        return JSON.stringify({ 
            success: false, 
            error: "Game API responded with " + gameResponse.code 
        });
    }

    let games;
    try {
        const parsed = JSON.parse(gameResponse.body);
        games = parsed.data || [];
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid games JSON format." });
    }

    // Step 3: Create global leaderboard
    const globalId = "leaderboard_global";
    if (!existingIds.has(globalId)) {
        try {
            nk.leaderboardCreate(
                globalId, 
                true, 
                sort, 
                operator, 
                resetSchedule, 
                { scope: "global", desc: "Global Ecosystem Leaderboard" }
            );
            created.push(globalId);
            existingRecords.push({ 
                leaderboardId: globalId, 
                scope: "global", 
                createdAt: new Date().toISOString() 
            });
            logger.info("Created global leaderboard: " + globalId);
        } catch (err) {
            logger.warn("Failed to create global leaderboard: " + err.message);
            skipped.push(globalId);
        }
    } else {
        skipped.push(globalId);
    }

    // Step 4: Create per-game leaderboards
    logger.info("Processing " + games.length + " games for leaderboard creation...");
    for (let i = 0; i < games.length; i++) {
        const game = games[i];
        if (!game.id) continue;

        const leaderboardId = "leaderboard_" + game.id;
        if (existingIds.has(leaderboardId)) {
            skipped.push(leaderboardId);
            continue;
        }

        try {
            nk.leaderboardCreate(
                leaderboardId, 
                true, 
                sort, 
                operator, 
                resetSchedule, 
                {
                    desc: "Leaderboard for " + (game.gameTitle || "Untitled Game"),
                    gameId: game.id,
                    scope: "game"
                }
            );
            created.push(leaderboardId);
            existingRecords.push({
                leaderboardId: leaderboardId,
                gameId: game.id,
                scope: "game",
                createdAt: new Date().toISOString()
            });
            logger.info("Created leaderboard: " + leaderboardId);
        } catch (err) {
            logger.warn("Failed to create leaderboard " + leaderboardId + ": " + err.message);
            skipped.push(leaderboardId);
        }
    }

    // Step 5: Persist records
    try {
        nk.storageWrite([{
            collection: collection,
            key: "all_created",
            userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
            value: existingRecords,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        logger.info("Persisted " + existingRecords.length + " leaderboard records to storage");
    } catch (err) {
        logger.error("Failed to write leaderboard records: " + err.message);
    }

    return JSON.stringify({
        success: true,
        created: created,
        skipped: skipped,
        totalProcessed: games.length,
        storedRecords: existingRecords.length
    });
}

// InitModule function - called by Nakama on startup
function InitModule(ctx, logger, nk, initializer) {
    logger.info('========================================');
    logger.info('Starting JavaScript Runtime Initialization');
    logger.info('========================================');
    
    // Register RPC functions
    initializer.registerRpc('create_all_leaderboards_persistent', createAllLeaderboardsPersistent);
    logger.info('Successfully registered RPC: create_all_leaderboards_persistent');
    
    logger.info('========================================');
    logger.info('JavaScript Runtime Initialization Complete');
    logger.info('========================================');
}
