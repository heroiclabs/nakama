/**
 * Cricket Live Match Module
 * 
 * Handles live match features:
 * - Match schedule management
 * - Live score updates (from JSON)
 * - Ball-by-ball tracking
 * - Flash drops during live matches
 * - Strategic timeout rewards
 * 
 * Game ID: 78244246-1e9e-4e0f-a8a2-7447d5b0284e
 */

const CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// Collections
const COLLECTIONS = {
    SCHEDULES: "cricket_schedules",
    LIVE_MATCHES: "cricket_live_matches",
    FLASH_DROPS: "cricket_flash_drops",
    MATCH_EVENTS: "cricket_match_events",
    USER_FLASH_CLAIMS: "cricket_user_flash_claims"
};

// Flash drop configuration
const FLASH_DROPS = {
    OVER_6: {
        id: "powerplay_end",
        name: "Powerplay Bonus",
        over: 6,
        reward: { type: "coins", amount: 50 },
        duration: 180000, // 3 minutes
        message: "Powerplay complete! Claim your bonus now!"
    },
    OVER_10: {
        id: "middle_overs",
        name: "Middle Overs Shard",
        over: 10,
        reward: { type: "jersey_shard", amount: 1 },
        duration: 180000,
        message: "Middle overs bonus! Claim your shard!"
    },
    OVER_15: {
        id: "death_overs_start",
        name: "Death Overs Cap",
        over: 15,
        reward: { type: "cap_shard", amount: 1 },
        duration: 180000,
        message: "Death overs starting! Special cap shard available!"
    },
    OVER_20: {
        id: "innings_end",
        name: "Innings Complete",
        over: 20,
        reward: { type: "coins", amount: 100 },
        duration: 300000, // 5 minutes
        message: "Innings complete! Claim your bonus!"
    },
    STRATEGIC_TIMEOUT: {
        id: "strategic_timeout",
        name: "Timeout Treasure",
        reward: { type: "mystery_box", amount: 1 },
        duration: 120000, // 2 minutes
        message: "Strategic timeout! Quick claim your treasure!"
    },
    WICKET: {
        id: "wicket_bonus",
        name: "Wicket Bonus",
        reward: { type: "coins", amount: 25 },
        duration: 60000, // 1 minute
        message: "Wicket! Quick claim your bonus!"
    },
    BOUNDARY_4: {
        id: "four_bonus",
        name: "Four Bonus",
        reward: { type: "coins", amount: 10 },
        duration: 30000, // 30 seconds
        message: "Four! Tap to claim!"
    },
    BOUNDARY_6: {
        id: "six_bonus",
        name: "Six Bonus",
        reward: { type: "coins", amount: 20 },
        duration: 30000,
        message: "Six! Tap to claim!"
    }
};

/**
 * RPC: Load match schedules
 * 
 * Loads schedules from JSON data into Nakama storage
 */
function rpcLoadSchedules(context, logger, nk, payload) {
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { tournamentId, matches } = data;

    if (!tournamentId || !matches || !Array.isArray(matches)) {
        throw new Error("tournamentId and matches array are required");
    }

    const writes = [];

    for (const match of matches) {
        const matchData = {
            matchId: match.matchId || `${tournamentId}_${match.team1}_${match.team2}_${match.date}`,
            tournamentId,
            team1: match.team1,
            team2: match.team2,
            matchTime: `${match.date}T${match.time || "14:00"}:00`,
            venue: match.venue,
            city: match.city,
            stage: match.stage || "group",
            group: match.group,
            description: match.description,
            featured: match.featured || false,
            megaMatch: match.megaMatch || false,
            status: "scheduled",
            createdAt: Date.now()
        };

        writes.push({
            collection: COLLECTIONS.SCHEDULES,
            key: matchData.matchId,
            userId: null,
            value: matchData,
            permissionRead: 2,
            permissionWrite: 0
        });
    }

    nk.storageWrite(writes);

    logger.info(`Loaded ${matches.length} matches for ${tournamentId}`);

    return JSON.stringify({
        success: true,
        tournamentId,
        matchesLoaded: matches.length
    });
}

/**
 * RPC: Get upcoming matches
 * 
 * Payload: {
 *   tournamentId: string (optional),
 *   days: number,
 *   limit: number
 * }
 */
function rpcGetUpcomingMatches(context, logger, nk, payload) {
    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        // ignore
    }

    const { tournamentId, days = 7, limit = 20 } = data;

    const now = Date.now();
    const cutoff = now + (days * 24 * 60 * 60 * 1000);

    // Query all schedules
    const schedules = nk.storageList(null, COLLECTIONS.SCHEDULES, 100, null);
    
    let matches = (schedules.objects || [])
        .map(obj => obj.value)
        .filter(match => {
            const matchTime = new Date(match.matchTime).getTime();
            const isUpcoming = matchTime > now && matchTime < cutoff;
            const matchesTournament = !tournamentId || match.tournamentId === tournamentId;
            return isUpcoming && matchesTournament;
        })
        .sort((a, b) => new Date(a.matchTime).getTime() - new Date(b.matchTime).getTime())
        .slice(0, limit);

    // Calculate time until each match
    matches = matches.map(match => ({
        ...match,
        hoursUntilMatch: Math.floor((new Date(match.matchTime).getTime() - now) / (1000 * 60 * 60)),
        minutesUntilMatch: Math.floor((new Date(match.matchTime).getTime() - now) / (1000 * 60))
    }));

    return JSON.stringify({
        matches,
        count: matches.length,
        timestamp: now
    });
}

/**
 * RPC: Get match details
 */
function rpcGetMatchDetails(context, logger, nk, payload) {
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { matchId } = data;

    if (!matchId) {
        throw new Error("matchId is required");
    }

    // Get schedule
    const schedules = nk.storageRead([{
        collection: COLLECTIONS.SCHEDULES,
        key: matchId,
        userId: null
    }]);

    if (schedules.length === 0) {
        return JSON.stringify({ success: false, message: "Match not found" });
    }

    const match = schedules[0].value;

    // Get live match data if exists
    const liveData = nk.storageRead([{
        collection: COLLECTIONS.LIVE_MATCHES,
        key: matchId,
        userId: null
    }]);

    const liveMatch = liveData.length > 0 ? liveData[0].value : null;

    // Get active flash drops
    const activeDrops = getActiveFlashDrops(nk, matchId);

    return JSON.stringify({
        success: true,
        match,
        liveData: liveMatch,
        activeFlashDrops: activeDrops,
        isLive: liveMatch?.status === "live"
    });
}

/**
 * RPC: Start live match
 * Called when a match goes live
 */
function rpcStartLiveMatch(context, logger, nk, payload) {
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { matchId, tossWinner, tossDecision } = data;

    if (!matchId) {
        throw new Error("matchId is required");
    }

    // Get match schedule
    const schedules = nk.storageRead([{
        collection: COLLECTIONS.SCHEDULES,
        key: matchId,
        userId: null
    }]);

    if (schedules.length === 0) {
        throw new Error("Match not found");
    }

    const match = schedules[0].value;

    // Create live match record
    const liveMatch = {
        matchId,
        team1: match.team1,
        team2: match.team2,
        status: "live",
        tossWinner,
        tossDecision,
        currentInnings: 1,
        battingTeam: tossDecision === "bat" ? tossWinner : (tossWinner === match.team1 ? match.team2 : match.team1),
        bowlingTeam: tossDecision === "bowl" ? tossWinner : (tossWinner === match.team1 ? match.team2 : match.team1),
        innings1: {
            runs: 0,
            wickets: 0,
            overs: 0,
            balls: 0,
            runRate: 0
        },
        innings2: null,
        startedAt: Date.now(),
        lastUpdateAt: Date.now()
    };

    nk.storageWrite([{
        collection: COLLECTIONS.LIVE_MATCHES,
        key: matchId,
        userId: null,
        value: liveMatch,
        permissionRead: 2,
        permissionWrite: 0
    }]);

    // Update schedule status
    match.status = "live";
    nk.storageWrite([{
        collection: COLLECTIONS.SCHEDULES,
        key: matchId,
        userId: null,
        value: match,
        permissionRead: 2,
        permissionWrite: 0
    }]);

    logger.info(`Match ${matchId} started: ${match.team1} vs ${match.team2}`);

    return JSON.stringify({
        success: true,
        matchId,
        status: "live",
        liveMatch
    });
}

/**
 * RPC: Update ball event
 * Called for each ball in a live match
 */
function rpcUpdateBallEvent(context, logger, nk, payload) {
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { matchId, innings, over, ball, runs, wicket, extras, batter, bowler, description } = data;

    if (!matchId || innings === undefined || over === undefined || ball === undefined) {
        throw new Error("matchId, innings, over, and ball are required");
    }

    // Get live match
    const liveData = nk.storageRead([{
        collection: COLLECTIONS.LIVE_MATCHES,
        key: matchId,
        userId: null
    }]);

    if (liveData.length === 0) {
        throw new Error("Live match not found");
    }

    const liveMatch = liveData[0].value;

    // Update innings data
    const inningsKey = `innings${innings}`;
    if (!liveMatch[inningsKey]) {
        liveMatch[inningsKey] = {
            runs: 0,
            wickets: 0,
            overs: 0,
            balls: 0,
            runRate: 0
        };
    }

    const inningsData = liveMatch[inningsKey];
    inningsData.runs += (runs || 0) + (extras?.total || 0);
    if (wicket) {
        inningsData.wickets++;
    }
    inningsData.balls++;
    if (inningsData.balls >= 6) {
        inningsData.overs++;
        inningsData.balls = 0;
    }
    
    const totalOvers = inningsData.overs + (inningsData.balls / 6);
    inningsData.runRate = totalOvers > 0 ? (inningsData.runs / totalOvers).toFixed(2) : 0;

    liveMatch.lastUpdateAt = Date.now();

    // Save updated match
    nk.storageWrite([{
        collection: COLLECTIONS.LIVE_MATCHES,
        key: matchId,
        userId: null,
        value: liveMatch,
        permissionRead: 2,
        permissionWrite: 0
    }]);

    // Store ball event
    const eventKey = `${matchId}_${innings}_${over}_${ball}`;
    nk.storageWrite([{
        collection: COLLECTIONS.MATCH_EVENTS,
        key: eventKey,
        userId: null,
        value: {
            matchId,
            innings,
            over,
            ball,
            runs,
            wicket,
            extras,
            batter,
            bowler,
            description,
            timestamp: Date.now()
        },
        permissionRead: 2,
        permissionWrite: 0
    }]);

    // Trigger flash drops based on events
    const triggeredDrops = [];

    // Check for over-based flash drops
    if (inningsData.balls === 0) { // Over just completed
        const overDrop = getOverBasedFlashDrop(inningsData.overs);
        if (overDrop) {
            triggerFlashDrop(nk, matchId, overDrop);
            triggeredDrops.push(overDrop);
        }
    }

    // Check for wicket flash drop
    if (wicket) {
        triggerFlashDrop(nk, matchId, FLASH_DROPS.WICKET);
        triggeredDrops.push(FLASH_DROPS.WICKET);
    }

    // Check for boundary flash drops
    if (runs === 4) {
        triggerFlashDrop(nk, matchId, FLASH_DROPS.BOUNDARY_4);
        triggeredDrops.push(FLASH_DROPS.BOUNDARY_4);
    } else if (runs === 6) {
        triggerFlashDrop(nk, matchId, FLASH_DROPS.BOUNDARY_6);
        triggeredDrops.push(FLASH_DROPS.BOUNDARY_6);
    }

    logger.info(`Ball event: ${matchId} - ${innings}.${over}.${ball}: ${runs} runs${wicket ? ' + wicket' : ''}`);

    return JSON.stringify({
        success: true,
        innings: inningsData,
        triggeredDrops: triggeredDrops.map(d => d.id)
    });
}

/**
 * RPC: Trigger strategic timeout
 */
function rpcTriggerStrategicTimeout(context, logger, nk, payload) {
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { matchId, team } = data;

    if (!matchId || !team) {
        throw new Error("matchId and team are required");
    }

    triggerFlashDrop(nk, matchId, FLASH_DROPS.STRATEGIC_TIMEOUT);

    logger.info(`Strategic timeout triggered for ${matchId} by ${team}`);

    return JSON.stringify({
        success: true,
        flashDrop: FLASH_DROPS.STRATEGIC_TIMEOUT
    });
}

/**
 * RPC: Claim flash drop
 */
function rpcClaimFlashDrop(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { matchId, dropId } = data;

    if (!matchId || !dropId) {
        throw new Error("matchId and dropId are required");
    }

    // Check if drop is still active
    const drops = nk.storageRead([{
        collection: COLLECTIONS.FLASH_DROPS,
        key: `${matchId}_${dropId}`,
        userId: null
    }]);

    if (drops.length === 0) {
        return JSON.stringify({ success: false, message: "Flash drop not found or expired" });
    }

    const drop = drops[0].value;

    if (Date.now() > drop.expiresAt) {
        return JSON.stringify({ success: false, message: "Flash drop expired" });
    }

    // Check if user already claimed
    const claims = nk.storageRead([{
        collection: COLLECTIONS.USER_FLASH_CLAIMS,
        key: `${userId}_${matchId}_${dropId}`,
        userId: userId
    }]);

    if (claims.length > 0) {
        return JSON.stringify({ success: false, message: "Already claimed this flash drop" });
    }

    // Award reward
    const reward = drop.reward;
    let awardedItem = null;

    switch (reward.type) {
        case 'coins':
            try {
                nk.walletUpdate(userId, { coins: reward.amount }, { reason: `flash_drop_${dropId}` }, true);
                awardedItem = { type: 'coins', amount: reward.amount };
            } catch (e) {
                logger.error(`Failed to award coins: ${e.message}`);
            }
            break;

        case 'jersey_shard':
        case 'cap_shard':
        case 'mystery_box':
            nk.storageWrite([{
                collection: 'cricket_inventory',
                key: `${reward.type}_${Date.now()}`,
                userId: userId,
                value: {
                    type: reward.type,
                    amount: reward.amount,
                    source: `flash_drop_${dropId}`,
                    matchId,
                    acquiredAt: Date.now()
                },
                permissionRead: 1,
                permissionWrite: 0
            }]);
            awardedItem = { type: reward.type, amount: reward.amount };
            break;
    }

    // Record claim
    nk.storageWrite([{
        collection: COLLECTIONS.USER_FLASH_CLAIMS,
        key: `${userId}_${matchId}_${dropId}`,
        userId: userId,
        value: {
            dropId,
            matchId,
            reward: awardedItem,
            claimedAt: Date.now()
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);

    // Update drop stats
    drop.claimCount = (drop.claimCount || 0) + 1;
    nk.storageWrite([{
        collection: COLLECTIONS.FLASH_DROPS,
        key: `${matchId}_${dropId}`,
        userId: null,
        value: drop,
        permissionRead: 2,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} claimed flash drop ${dropId} from match ${matchId}`);

    return JSON.stringify({
        success: true,
        dropId,
        reward: awardedItem
    });
}

/**
 * RPC: End match
 */
function rpcEndMatch(context, logger, nk, payload) {
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { matchId, winner, manOfTheMatch, summary } = data;

    if (!matchId || !winner) {
        throw new Error("matchId and winner are required");
    }

    // Get live match
    const liveData = nk.storageRead([{
        collection: COLLECTIONS.LIVE_MATCHES,
        key: matchId,
        userId: null
    }]);

    if (liveData.length === 0) {
        throw new Error("Live match not found");
    }

    const liveMatch = liveData[0].value;
    liveMatch.status = "completed";
    liveMatch.winner = winner;
    liveMatch.manOfTheMatch = manOfTheMatch;
    liveMatch.summary = summary;
    liveMatch.endedAt = Date.now();

    // Save final match state
    nk.storageWrite([{
        collection: COLLECTIONS.LIVE_MATCHES,
        key: matchId,
        userId: null,
        value: liveMatch,
        permissionRead: 2,
        permissionWrite: 0
    }]);

    // Update schedule
    const schedules = nk.storageRead([{
        collection: COLLECTIONS.SCHEDULES,
        key: matchId,
        userId: null
    }]);

    if (schedules.length > 0) {
        const match = schedules[0].value;
        match.status = "completed";
        match.winner = winner;
        
        nk.storageWrite([{
            collection: COLLECTIONS.SCHEDULES,
            key: matchId,
            userId: null,
            value: match,
            permissionRead: 2,
            permissionWrite: 0
        }]);
    }

    logger.info(`Match ${matchId} ended. Winner: ${winner}`);

    return JSON.stringify({
        success: true,
        matchId,
        winner,
        finalScore: {
            innings1: liveMatch.innings1,
            innings2: liveMatch.innings2
        }
    });
}

// Helper functions
function getOverBasedFlashDrop(over) {
    switch (over) {
        case 6: return FLASH_DROPS.OVER_6;
        case 10: return FLASH_DROPS.OVER_10;
        case 15: return FLASH_DROPS.OVER_15;
        case 20: return FLASH_DROPS.OVER_20;
        default: return null;
    }
}

function triggerFlashDrop(nk, matchId, dropConfig) {
    const now = Date.now();
    const drop = {
        id: dropConfig.id,
        matchId,
        name: dropConfig.name,
        reward: dropConfig.reward,
        message: dropConfig.message,
        triggeredAt: now,
        expiresAt: now + dropConfig.duration,
        claimCount: 0
    };

    nk.storageWrite([{
        collection: COLLECTIONS.FLASH_DROPS,
        key: `${matchId}_${dropConfig.id}`,
        userId: null,
        value: drop,
        permissionRead: 2,
        permissionWrite: 0
    }]);
}

function getActiveFlashDrops(nk, matchId) {
    const now = Date.now();
    const drops = nk.storageList(null, COLLECTIONS.FLASH_DROPS, 50, null);
    
    return (drops.objects || [])
        .map(obj => obj.value)
        .filter(drop => drop.matchId === matchId && drop.expiresAt > now)
        .map(drop => ({
            id: drop.id,
            name: drop.name,
            message: drop.message,
            reward: drop.reward,
            expiresIn: drop.expiresAt - now
        }));
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Cricket Live Match Module loaded");

    initializer.registerRpc("cricket_load_schedules", rpcLoadSchedules);
    initializer.registerRpc("cricket_get_upcoming_matches", rpcGetUpcomingMatches);
    initializer.registerRpc("cricket_get_match_details", rpcGetMatchDetails);
    initializer.registerRpc("cricket_start_live_match", rpcStartLiveMatch);
    initializer.registerRpc("cricket_update_ball_event", rpcUpdateBallEvent);
    initializer.registerRpc("cricket_trigger_strategic_timeout", rpcTriggerStrategicTimeout);
    initializer.registerRpc("cricket_claim_flash_drop", rpcClaimFlashDrop);
    initializer.registerRpc("cricket_end_match", rpcEndMatch);

    logger.info("Cricket Live Match Module initialized successfully");
}

!InitModule.toString().includes("InitModule") || InitModule;

