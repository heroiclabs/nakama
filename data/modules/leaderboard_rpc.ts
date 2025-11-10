// Copyright 2025 The Nakama Authors
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

interface LeaderboardRecord {
    leaderboardId: string;
    gameId?: string;
    scope: string;
    createdAt: string;
}

let InitModule: nkruntime.InitModule = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
    initializer.registerRpc("create_all_leaderboards_persistent", createAllLeaderboardsPersistent);
    logger.info("Leaderboard RPC registered successfully.");
};

function createAllLeaderboardsPersistent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    const tokenUrl = "https://api.intelli-verse-x.ai/api/admin/oauth/token";
    const gamesUrl = "https://gaming.intelli-verse-x.ai/api/games/games/all";

    const client_id = "54clc0uaqvr1944qvkas63o0rb";
    const client_secret = "1eb7ooua6ft832nh8dpmi37mos4juqq27svaqvmkt5grc3b7e377";

    const sort = "desc";
    const operator = "best";
    const resetSchedule = "0 0 * * 0"; // Weekly reset
    const collection = "leaderboards_registry";

    // Fetch existing records to skip duplicates
    let existingRecords: LeaderboardRecord[] = [];
    try {
        const records = nk.storageRead([{ collection, key: "all_created", userId: ctx.userId || "system" }]);
        if (records && records.length > 0 && records[0].value) {
            existingRecords = records[0].value as LeaderboardRecord[];
        }
    } catch (err) {
        logger.warn(`Failed to read existing leaderboard records: ${err}`);
    }

    const existingIds = new Set(existingRecords.map(r => r.leaderboardId));
    const created: string[] = [];
    const skipped: string[] = [];

    // Step 1: Request token
    logger.info("Requesting IntelliVerse OAuth token...");
    let tokenResponse;
    try {
        tokenResponse = nk.httpRequest(tokenUrl, "post", {
            "accept": "application/json",
            "Content-Type": "application/json"
        }, JSON.stringify({
            client_id,
            client_secret
        }));
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ success: false, error: `Token request failed: ${errorMsg}` });
    }

    if (tokenResponse.code !== 200) {
        return JSON.stringify({ success: false, error: `Token request failed with code ${tokenResponse.code}` });
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
            "Authorization": `Bearer ${accessToken}`
        });
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ success: false, error: `Game fetch failed: ${errorMsg}` });
    }

    if (gameResponse.code !== 200) {
        return JSON.stringify({ success: false, error: `Game API responded with ${gameResponse.code}` });
    }

    let games;
    try {
        const parsed = JSON.parse(gameResponse.body);
        games = parsed.data || [];
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid games JSON format." });
    }

    // Step 3: Create global leaderboard if missing
    const globalId = "leaderboard_global";
    if (!existingIds.has(globalId)) {
        try {
            nk.leaderboardCreate(globalId, true, sort, operator, resetSchedule, { scope: "global", desc: "Global Ecosystem Leaderboard" });
            created.push(globalId);
            existingRecords.push({ leaderboardId: globalId, scope: "global", createdAt: new Date().toISOString() });
        } catch (err) {
            skipped.push(globalId);
        }
    } else {
        skipped.push(globalId);
    }

    // Step 4: Create per-game leaderboards
    logger.info(`Processing ${games.length} games for leaderboard creation...`);
    for (const game of games) {
        if (!game.id) continue;
        const leaderboardId = `leaderboard_${game.id}`;
        if (existingIds.has(leaderboardId)) {
            skipped.push(leaderboardId);
            continue;
        }
        try {
            nk.leaderboardCreate(leaderboardId, true, sort, operator, resetSchedule, {
                desc: `Leaderboard for ${game.gameTitle || "Untitled Game"}`,
                gameId: game.id,
                scope: "game"
            });
            created.push(leaderboardId);
            existingRecords.push({
                leaderboardId,
                gameId: game.id,
                scope: "game",
                createdAt: new Date().toISOString()
            });
        } catch (err) {
            skipped.push(leaderboardId);
        }
    }

    // Step 5: Persist record of created leaderboards
    try {
        nk.storageWrite([{
            collection,
            key: "all_created",
            userId: ctx.userId || "system",
            value: existingRecords,
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to write leaderboard records: ${errorMsg}`);
    }

    return JSON.stringify({
        success: true,
        created,
        skipped,
        totalProcessed: games.length,
        storedRecords: existingRecords.length
    });
}


