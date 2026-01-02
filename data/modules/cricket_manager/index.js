/**
 * Cricket Manager Mode - Main Module Index
 * 
 * Game ID: 78244246-1e9e-4e0f-a8a2-7447d5b0284e
 * 
 * This module handles all Cricket Manager Mode functionality:
 * - Manager profiles and team management
 * - Match orders (playing XI, batting order, bowling plan, tactics)
 * - Match simulation (ball-by-ball)
 * - Season management (fixtures, standings)
 * - Training system
 * - Statistics tracking
 * 
 * Follows QuizVerse pattern for consistency
 */

const CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// Match simulator functions (inlined for Nakama compatibility)
function simulateBall(state, rng) {
    const batterEffective = calculateBatterSkill(state);
    const bowlerEffective = calculateBowlerSkill(state);
    const intentModifier = getIntentModifier(state.batIntent, state.bowlIntent);
    const phaseModifier = getPhaseModifier(state.over);
    const formModifier = getFormModifier(state.batter, state.bowler);
    const setBonus = getSetBonus(state.batterBallsFaced);
    const situationModifier = getSituationModifier(state);
    
    const probs = calculateProbabilities(
        batterEffective, bowlerEffective,
        intentModifier, phaseModifier, formModifier, setBonus, situationModifier,
        state.fieldSetting, state.bowlerStyle
    );
    
    const outcome = sampleOutcome(probs, rng);
    const commentary = generateCommentary(outcome, state, rng);
    const dismissalType = outcome === "wicket" ? determineDismissalType(state, rng) : null;
    
    return { outcome, runs: getRunsFromOutcome(outcome), isWicket: outcome === "wicket", dismissalType, commentary };
}

function calculateBatterSkill(state) {
    const b = state.batter;
    const baseSkill = (b.attributes.technique * 0.3 + b.attributes.power * 0.25 + b.attributes.temperament * 0.25 + b.attributes.strikeRate * 0.2) / 100;
    return baseSkill * getFormMultiplier(b.form) * (b.fitness / 100) + Math.min(b.experience / 100, 0.1);
}

function calculateBowlerSkill(state) {
    const b = state.bowler;
    const baseSkill = (b.attributes.accuracy * 0.35 + b.attributes.movement * 0.25 + b.attributes.variations * 0.25 + (100 - Math.abs(b.attributes.paceOrSpin - state.pitchSuitability)) * 0.15) / 100;
    return baseSkill * getFormMultiplier(b.form) * (b.fitness / 100) + Math.min(b.experience / 100, 0.1);
}

function getFormMultiplier(form) {
    const multipliers = { 4: 1.1, 3: 1.05, 2: 1.0, 1: 0.95, 0: 0.9 };
    return multipliers[form] || 1.0;
}

function getIntentModifier(batIntent, bowlIntent) {
    let mod = 1.0;
    if (batIntent === "attack") mod += 0.15; else if (batIntent === "aggressive") mod += 0.10; else if (batIntent === "defensive") mod -= 0.10;
    if (bowlIntent === "attack") mod += 0.05; else if (bowlIntent === "contain") mod -= 0.08;
    return mod;
}

function getPhaseModifier(over) { return over <= 6 ? 1.1 : over <= 15 ? 1.0 : 1.15; }
function getFormModifier(batter, bowler) { return (getFormMultiplier(batter.form) + getFormMultiplier(bowler.form)) / 2; }
function getSetBonus(ballsFaced) { return ballsFaced >= 50 ? 0.10 : ballsFaced >= 20 ? 0.05 : 0.0; }

function getSituationModifier(state) {
    let mod = 1.0;
    if (state.target > 0) {
        const currentRR = state.currentRuns / (state.overs + state.ball / 6);
        const requiredRR = state.target / (20 - state.overs - state.ball / 6);
        if (requiredRR > currentRR * 1.2) mod += 0.10; else if (requiredRR > currentRR * 1.1) mod += 0.05;
    }
    if (state.wickets >= 6) mod -= 0.05;
    return mod;
}

function calculateProbabilities(batterSkill, bowlerSkill, intentMod, phaseMod, formMod, setBonus, situationMod, fieldSetting, bowlerStyle) {
    const probs = { dot: 0.30, one: 0.25, two: 0.15, three: 0.05, four: 0.15, six: 0.05, wicket: 0.05 };
    const skillDiff = batterSkill - bowlerSkill;
    if (skillDiff > 0.2) { probs.four += 0.05; probs.six += 0.03; probs.wicket -= 0.03; probs.dot -= 0.05; }
    else if (skillDiff < -0.2) { probs.four -= 0.05; probs.six -= 0.03; probs.wicket += 0.05; probs.dot += 0.03; }
    probs.four *= (1.0 + intentMod * 0.3); probs.six *= (1.0 + intentMod * 0.4); probs.wicket *= (1.0 + intentMod * 0.2); probs.dot *= (1.0 - intentMod * 0.2);
    probs.four *= phaseMod; probs.six *= phaseMod; probs.wicket *= phaseMod;
    probs.four *= formMod; probs.six *= formMod; probs.wicket *= (2.0 - formMod);
    probs.wicket *= (1.0 - setBonus); probs.dot *= (1.0 - setBonus * 0.5);
    probs.four *= situationMod; probs.six *= situationMod; probs.wicket *= situationMod;
    if (fieldSetting === "attacking") { probs.wicket += 0.03; probs.four -= 0.02; }
    else if (fieldSetting === "defensive") { probs.wicket -= 0.02; probs.four -= 0.05; probs.six -= 0.03; probs.dot += 0.05; }
    const total = probs.dot + probs.one + probs.two + probs.three + probs.four + probs.six + probs.wicket;
    if (total > 0) Object.keys(probs).forEach(k => probs[k] /= total);
    Object.keys(probs).forEach(k => probs[k] = Math.max(0, probs[k]));
    return probs;
}

function sampleOutcome(probs, rng) {
    const roll = rng();
    let cum = 0;
    if (roll < (cum += probs.dot)) return "dot";
    if (roll < (cum += probs.one)) return "one";
    if (roll < (cum += probs.two)) return "two";
    if (roll < (cum += probs.three)) return "three";
    if (roll < (cum += probs.four)) return "four";
    if (roll < (cum += probs.six)) return "six";
    return "wicket";
}

function getRunsFromOutcome(outcome) {
    const runs = { one: 1, two: 2, three: 3, four: 4, six: 6 };
    return runs[outcome] || 0;
}

function determineDismissalType(state, rng) {
    const roll = rng();
    if (state.bowlerStyle === "pace") {
        if (roll < 0.40) return "caught";
        if (roll < 0.70) return "bowled";
        if (roll < 0.90) return "lbw";
        return "run_out";
    } else {
        if (roll < 0.35) return "caught";
        if (roll < 0.60) return "stumped";
        if (roll < 0.80) return "lbw";
        if (roll < 0.95) return "bowled";
        return "run_out";
    }
}

function generateCommentary(outcome, state, rng) {
    const comms = {
        dot: ["Dot ball, good length", "Defended back to the bowler", "No run, well bowled", "Dot ball, pressure building"],
        one: ["Single taken", "Quick single to keep the scoreboard ticking", "One run added", "Rotated the strike"],
        two: ["Two runs, good running between the wickets", "Couple of runs added", "Two runs, well placed"],
        four: ["FOUR! Beautiful shot to the boundary!", "FOUR! Through the covers!", "FOUR! Elegant drive to the fence!", "FOUR! Powerful shot finds the boundary!"],
        six: ["SIX! Massive hit into the stands!", "SIX! That's gone all the way!", "SIX! Clean strike, out of the ground!", "SIX! What a shot!"],
        wicket: ["OUT! Bowled! Clean bowled!", "OUT! Caught! That's a wicket!", "OUT! LBW! That's plumb!", "OUT! Stumped! Quick work by the keeper!", "OUT! Run out! Direct hit!", "OUT! Wicket falls!"]
    };
    const options = comms[outcome] || ["Ball played"];
    return options[Math.floor(rng() * options.length)];
}

// Collections
const COLLECTIONS = {
    // User Data
    MANAGER_PROFILES: "cricket_manager_profiles",
    USER_SQUADS: "cricket_user_squads",
    USER_STATS: "cricket_user_stats",
    
    // Match Data
    MATCHES: "cricket_matches",
    MATCH_ORDERS: "cricket_match_orders",
    MATCH_STATES: "cricket_match_states",
    MATCH_SCORECARDS: "cricket_match_scorecards",
    
    // Season Data
    SEASONS: "cricket_seasons",
    FIXTURES: "cricket_fixtures",
    STANDINGS: "cricket_standings",
    
    // Player Data
    PLAYERS: "cricket_players",
    PLAYER_STATS: "cricket_player_stats",
    PLAYER_FORM: "cricket_player_form",
    
    // Training
    TRAINING_PLANS: "cricket_training_plans",
    TRAINING_HISTORY: "cricket_training_history"
};

// Leaderboards
const LEADERBOARDS = {
    MANAGER_RANKINGS: "cricket_manager_rankings",
    SEASON_POINTS: "cricket_season_points",
    BATSMAN_RUNS: "cricket_batsman_runs",
    BOWLER_WICKETS: "cricket_bowler_wickets",
    TEAM_POINTS: "cricket_team_points"
};

/**
 * RPC: Create or sync manager profile
 * Initializes manager data in Nakama storage
 */
function rpcCreateOrSyncManager(context, logger, nk, payload) {
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
    
    const { username, device_id, game_id } = data;
    
    if (game_id !== CRICKET_GAME_ID) {
        throw new Error(`Invalid game ID. Expected: ${CRICKET_GAME_ID}`);
    }
    
    const now = Date.now();
    
    // Check if manager profile exists
    const existing = nk.storageRead([{
        collection: COLLECTIONS.MANAGER_PROFILES,
        key: "profile",
        userId: userId
    }]);
    
    let isNew = false;
    
    if (existing.length === 0) {
        // Create new manager profile
        isNew = true;
        
        const managerProfile = {
            userId: userId,
            username: username || "CricketManager",
            deviceId: device_id,
            gameId: game_id,
            createdAt: now,
            defaultTeamId: `team_${userId}`, // Default team (auto-created)
            teams: [`team_${userId}`], // List of team IDs owned by this manager
            matchesPlayed: 0,
            matchesWon: 0,
            matchesLost: 0,
            totalPoints: 0
        };
        
        nk.storageWrite([{
            collection: COLLECTIONS.MANAGER_PROFILES,
            key: "profile",
            userId: userId,
            value: managerProfile,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        // Create default team
        const defaultTeam = {
            teamId: managerProfile.defaultTeamId,
            name: `${username}'s Team`,
            logoUrl: null,
            squad: [],
            captainId: null,
            stats: {
                matchesPlayed: 0,
                matchesWon: 0,
                matchesLost: 0,
                points: 0,
                netRunRate: 0
            },
            budget: 100000,
            points: 0,
            netRunRate: 0,
            createdAt: now,
            managerId: userId
        };
        
        nk.storageWrite([{
            collection: COLLECTIONS.USER_SQUADS,
            key: managerProfile.defaultTeamId,
            userId: userId,
            value: defaultTeam,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info(`Created new Cricket Manager profile: ${userId}`);
    } else {
        // Update existing profile
        const profile = existing[0].value;
        profile.username = username || profile.username;
        profile.deviceId = device_id;
        profile.lastLogin = now;
        
        nk.storageWrite([{
            collection: COLLECTIONS.MANAGER_PROFILES,
            key: "profile",
            userId: userId,
            value: profile,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info(`Synced Cricket Manager profile: ${userId}`);
    }
    
    const profile = existing.length > 0 ? existing[0].value : nk.storageRead([{
        collection: COLLECTIONS.MANAGER_PROFILES,
        key: "profile",
        userId: userId
    }])[0].value;
    
    return JSON.stringify({
        success: true,
        created: isNew,
        username: profile.username,
        device_id: device_id,
        game_id: game_id,
        manager_id: userId,
        team_id: profile.defaultTeamId // Return default team ID for backward compatibility
    });
}

/**
 * RPC: Create new team
 * Allows manager to create additional teams with custom names
 */
function rpcCreateTeam(context, logger, nk, payload) {
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
    
    const { team_name, logo_url, initial_budget = 100000 } = data;
    
    if (!team_name || team_name.trim().length === 0) {
        throw new Error("Team name is required");
    }
    
    const now = Date.now();
    const teamId = `team_${userId}_${now}`; // Unique team ID
    
    // Get manager profile
    const profileData = nk.storageRead([{
        collection: COLLECTIONS.MANAGER_PROFILES,
        key: "profile",
        userId: userId
    }]);
    
    if (profileData.length === 0) {
        throw new Error("Manager profile not found. Create manager profile first.");
    }
    
    const profile = profileData[0].value;
    
    // Create new team
    const newTeam = {
        teamId: teamId,
        name: team_name,
        logoUrl: logo_url || null,
        squad: [],
        captainId: null,
        stats: {
            matchesPlayed: 0,
            matchesWon: 0,
            matchesLost: 0,
            points: 0,
            netRunRate: 0
        },
        budget: initial_budget,
        points: 0,
        netRunRate: 0,
        createdAt: now,
        managerId: userId
    };
    
    // Save team
    nk.storageWrite([{
        collection: COLLECTIONS.USER_SQUADS,
        key: teamId,
        userId: userId,
        value: newTeam,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    // Update manager profile to include new team
    if (!profile.teams) {
        profile.teams = [profile.defaultTeamId];
    }
    profile.teams.push(teamId);
    
    nk.storageWrite([{
        collection: COLLECTIONS.MANAGER_PROFILES,
        key: "profile",
        userId: userId,
        value: profile,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    logger.info(`Team created: ${team_name} (${teamId}) by ${userId}`);
    
    return JSON.stringify({
        success: true,
        team: newTeam
    });
}

/**
 * RPC: Get all teams for user
 */
function rpcGetUserTeams(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }
    
    // Get manager profile to get team list
    const profileData = nk.storageRead([{
        collection: COLLECTIONS.MANAGER_PROFILES,
        key: "profile",
        userId: userId
    }]);
    
    if (profileData.length === 0) {
        return JSON.stringify({
            success: true,
            teams: []
        });
    }
    
    const profile = profileData[0].value;
    const teamIds = profile.teams || [profile.defaultTeamId];
    
    // Get all teams
    const teams = [];
    for (const teamId of teamIds) {
        const teamData = nk.storageRead([{
            collection: COLLECTIONS.USER_SQUADS,
            key: teamId,
            userId: userId
        }]);
        
        if (teamData.length > 0) {
            teams.push(teamData[0].value);
        }
    }
    
    return JSON.stringify({
        success: true,
        teams: teams
    });
}

/**
 * RPC: Update team details
 */
function rpcUpdateTeam(context, logger, nk, payload) {
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
    
    const { team_id, team_name, logo_url, captain_id } = data;
    
    // Get team
    const teamData = nk.storageRead([{
        collection: COLLECTIONS.USER_SQUADS,
        key: team_id,
        userId: userId
    }]);
    
    if (teamData.length === 0) {
        throw new Error("Team not found");
    }
    
    const team = teamData[0].value;
    
    // Verify ownership
    if (team.managerId !== userId) {
        throw new Error("You don't have permission to update this team");
    }
    
    // Update fields
    if (team_name) team.name = team_name;
    if (logo_url !== undefined) team.logoUrl = logo_url;
    if (captain_id) team.captainId = captain_id;
    
    // Save updated team
    nk.storageWrite([{
        collection: COLLECTIONS.USER_SQUADS,
        key: team_id,
        userId: userId,
        value: team,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    logger.info(`Team updated: ${team_id} by ${userId}`);
    
    return JSON.stringify({
        success: true,
        team: team
    });
}

/**
 * RPC: Get squad
 * Returns team squad with player data
 */
function rpcGetSquad(context, logger, nk, payload) {
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
    
    const { team_id } = data;
    
    // Get team from storage (use team_id as key)
    const teamData = nk.storageRead([{
        collection: COLLECTIONS.USER_SQUADS,
        key: team_id || "squad", // Support legacy "squad" key for backward compatibility
        userId: userId
    }]);
    
    if (teamData.length === 0) {
        // Try to get default team
        const profileData = nk.storageRead([{
            collection: COLLECTIONS.MANAGER_PROFILES,
            key: "profile",
            userId: userId
        }]);
        
        if (profileData.length > 0 && profileData[0].value.defaultTeamId) {
            const defaultTeamId = profileData[0].value.defaultTeamId;
            const defaultTeamData = nk.storageRead([{
                collection: COLLECTIONS.USER_SQUADS,
                key: defaultTeamId,
                userId: userId
            }]);
            
            if (defaultTeamData.length > 0) {
                return JSON.stringify(defaultTeamData[0].value);
            }
        }
        
        // Return empty team
        return JSON.stringify({
            teamId: team_id || "team_unknown",
            name: "My Team",
            squad: [],
            stats: {
                matchesPlayed: 0,
                matchesWon: 0,
                matchesLost: 0,
                points: 0,
                netRunRate: 0
            }
        });
    }
    
    return JSON.stringify(teamData[0].value);
}

/**
 * RPC: Submit match orders
 * Saves playing XI, batting order, bowling plan, and tactics
 */
function rpcSubmitMatchOrders(context, logger, nk, payload) {
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
    
    const { match_id, team_id, playing_xi, batting_order, bowling_plan, tactics, captain_id, wicket_keeper_id } = data;
    
    // Validate orders
    if (!playing_xi || playing_xi.length !== 11) {
        throw new Error("Playing XI must have exactly 11 players");
    }
    
    if (!batting_order || batting_order.length !== 11) {
        throw new Error("Batting order must have 11 positions");
    }
    
    // Save match orders
    const matchOrders = {
        matchId: match_id,
        teamId: team_id,
        userId: userId,
        playingXI: playing_xi,
        battingOrder: batting_order,
        bowlingPlan: bowling_plan,
        tactics: tactics,
        captainId: captain_id,
        wicketKeeperId: wicket_keeper_id,
        submittedAt: Date.now()
    };
    
    nk.storageWrite([{
        collection: COLLECTIONS.MATCH_ORDERS,
        key: match_id,
        userId: userId,
        value: matchOrders,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    logger.info(`Match orders submitted: ${match_id} by ${userId}`);
    
    return JSON.stringify({
        success: true,
        match_id: match_id,
        orders_saved: true
    });
}

/**
 * RPC: Start match
 * Initializes match state and begins simulation
 */
function rpcStartMatch(context, logger, nk, payload) {
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
    
    const { match_id } = data;
    
    // Get match orders
    const ordersData = nk.storageRead([{
        collection: COLLECTIONS.MATCH_ORDERS,
        key: match_id,
        userId: userId
    }]);
    
    if (ordersData.length === 0) {
        throw new Error("Match orders not found. Submit orders first.");
    }
    
    // Initialize match state
    // This would be expanded to include actual match initialization logic
    const matchState = {
        matchId: match_id,
        status: "innings_1",
        innings1: {
            totalRuns: 0,
            wickets: 0,
            overs: 0,
            balls: 0,
            ballHistory: [],
            wickets: [],
            partnerships: []
        },
        innings2: null,
        startedAt: Date.now()
    };
    
    nk.storageWrite([{
        collection: COLLECTIONS.MATCH_STATES,
        key: match_id,
        userId: userId,
        value: matchState,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    logger.info(`Match started: ${match_id}`);
    
    return JSON.stringify({
        success: true,
        match_state: matchState
    });
}

/**
 * RPC: Simulate ball
 * Simulates next ball (or continues auto-play)
 * NOTE: Actual simulation logic would be implemented here or in a separate module
 */
function rpcSimulateBall(context, logger, nk, payload) {
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
    
    const { match_id, auto_play } = data;
    
    // Get match state
    const stateData = nk.storageRead([{
        collection: COLLECTIONS.MATCH_STATES,
        key: match_id,
        userId: userId
    }]);
    
    if (stateData.length === 0) {
        throw new Error("Match state not found. Start match first.");
    }
    
    const matchState = stateData[0].value;
    const ordersData = nk.storageRead([{
        collection: COLLECTIONS.MATCH_ORDERS,
        key: match_id,
        userId: userId
    }]);
    
    if (ordersData.length === 0) {
        throw new Error("Match orders not found");
    }
    
    const orders = ordersData[0].value;
    
    // Get current batsmen and bowler from match state
    const currentInnings = matchState.innings1;
    const ballNumber = (currentInnings.overs * 6) + currentInnings.balls + 1;
    const over = currentInnings.overs + 1;
    const ball = (currentInnings.balls % 6) + 1;
    
    // Get player data (simplified - would fetch from storage in production)
    const strikerId = orders.playingXI[0]; // Simplified
    const bowlerId = orders.bowlingPlan.preferredBowlers[0].bowler_id; // Simplified
    
    // Create ball state for simulator
    const ballState = {
        ballNumber: ballNumber,
        over: over,
        ball: ball,
        batter: { // Simplified - would fetch actual player data
            attributes: { technique: 70, power: 75, temperament: 65, strikeRate: 80 },
            form: 2,
            fitness: 90,
            experience: 50
        },
        bowler: {
            attributes: { accuracy: 75, movement: 70, variations: 65, paceOrSpin: 20 },
            form: 2,
            fitness: 85,
            experience: 45
        },
        batterId: strikerId,
        bowlerId: bowlerId,
        currentRuns: currentInnings.totalRuns,
        wickets: currentInnings.wickets,
        target: currentInnings.target || 0,
        batIntent: orders.tactics.bat_intent || "balanced",
        bowlIntent: orders.tactics.bowl_intent || "normal",
        fieldSetting: orders.tactics.field_preset || "balanced",
        bowlerStyle: "pace", // Simplified
        batterBallsFaced: ballNumber, // Simplified
        pitchSuitability: 50 // Simplified
    };
    
    // Create RNG for this match (deterministic)
    const matchSeed = matchState.seed || Date.now();
    let rngState = matchState.rngState || 0;
    const rng = () => {
        rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
        return (rngState / 0x7fffffff);
    };
    
    // Simulate ball
    const ballResult = simulateBall(ballState, rng);
    
    // Create ball event
    const ballEvent = {
        ballNumber: ballNumber,
        over: over,
        ball: ball,
        bowlerId: bowlerId,
        batterId: strikerId,
        outcome: ballResult.outcome,
        runs: ballResult.runs,
        isWicket: ballResult.isWicket,
        dismissalType: ballResult.dismissalType,
        commentary: ballResult.commentary,
        timestamp: Date.now()
    };
    
    // Update match state
    currentInnings.totalRuns += ballEvent.runs;
    if (ballEvent.isWicket) {
        currentInnings.wickets++;
    }
    currentInnings.balls++;
    if (currentInnings.balls >= 6) {
        currentInnings.overs++;
        currentInnings.balls = 0;
    }
    currentInnings.ballHistory.push(ballEvent);
    
    // Check if innings complete
    const matchComplete = currentInnings.overs >= 20 || currentInnings.wickets >= 10;
    if (matchComplete) {
        matchState.status = "innings_break";
    }
    
    // Update RNG state
    matchState.rngState = rngState;
    if (!matchState.seed) {
        matchState.seed = matchSeed;
    }
    
    nk.storageWrite([{
        collection: COLLECTIONS.MATCH_STATES,
        key: match_id,
        userId: userId,
        value: matchState,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    return JSON.stringify({
        success: true,
        ball_event: ballEvent,
        match_state: matchState,
        match_complete: matchComplete
    });
}

/**
 * RPC: Simulate over (6 balls)
 */
function rpcSimulateOver(context, logger, nk, payload) {
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
    
    const { match_id } = data;
    
    const stateData = nk.storageRead([{
        collection: COLLECTIONS.MATCH_STATES,
        key: match_id,
        userId: userId
    }]);
    
    if (stateData.length === 0) {
        throw new Error("Match state not found");
    }
    
    const matchState = stateData[0].value;
    const currentInnings = matchState.innings1;
    const ballsInOver = 6 - currentInnings.balls;
    
    // Simulate remaining balls in over
    for (let i = 0; i < ballsInOver; i++) {
        const ballPayload = JSON.stringify({ match_id: match_id, auto_play: false });
        const result = JSON.parse(rpcSimulateBall(context, logger, nk, ballPayload));
        if (result.match_complete) break;
    }
    
    // Get updated state
    const updatedState = JSON.parse(rpcGetMatchState(context, logger, nk, payload));
    return JSON.stringify(updatedState);
}

/**
 * RPC: Auto-play entire match
 */
function rpcAutoPlayMatch(context, logger, nk, payload) {
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
    
    const { match_id } = data;
    
    // Simulate until match complete
    let matchComplete = false;
    let maxBalls = 240; // 20 overs * 2 innings * 6 balls
    
    while (!matchComplete && maxBalls > 0) {
        const ballPayload = JSON.stringify({ match_id: match_id, auto_play: true });
        const result = JSON.parse(rpcSimulateBall(context, logger, nk, ballPayload));
        matchComplete = result.match_complete;
        maxBalls--;
    }
    
    // Get final state
    return rpcGetMatchState(context, logger, nk, payload);
}

/**
 * RPC: Get season
 */
function rpcGetSeason(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }
    
    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        data = {};
    }
    
    const { season_id } = data;
    
    // Get current season or specific season
    const seasonKey = season_id || "current";
    const seasonData = nk.storageRead([{
        collection: COLLECTIONS.SEASONS,
        key: seasonKey,
        userId: null // Global
    }]);
    
    if (seasonData.length === 0) {
        // Create default season if none exists
        const defaultSeason = {
            seasonId: "season_1",
            name: "IPL 2026",
            type: "league",
            startDate: Date.now(),
            endDate: Date.now() + (90 * 24 * 60 * 60 * 1000), // 90 days
            teams: [],
            fixtures: [],
            standings: { standings: [] }
        };
        
        nk.storageWrite([{
            collection: COLLECTIONS.SEASONS,
            key: seasonKey,
            userId: null,
            value: defaultSeason,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        return JSON.stringify({
            success: true,
            season: defaultSeason
        });
    }
    
    return JSON.stringify({
        success: true,
        season: seasonData[0].value
    });
}

/**
 * RPC: Get fixtures
 */
function rpcGetFixtures(context, logger, nk, payload) {
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
    
    const { season_id, team_id } = data;
    
    const fixtures = nk.storageList(null, COLLECTIONS.FIXTURES, 100, null);
    let filteredFixtures = (fixtures.objects || []).map(obj => obj.value);
    
    if (season_id) {
        filteredFixtures = filteredFixtures.filter(f => f.seasonId === season_id);
    }
    
    if (team_id) {
        filteredFixtures = filteredFixtures.filter(f => 
            f.teamAId === team_id || f.teamBId === team_id
        );
    }
    
    return JSON.stringify({
        success: true,
        fixtures: filteredFixtures
    });
}

/**
 * RPC: Get standings
 */
function rpcGetStandings(context, logger, nk, payload) {
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
    
    const { season_id } = data;
    
    const standingsData = nk.storageRead([{
        collection: COLLECTIONS.STANDINGS,
        key: season_id || "current",
        userId: null
    }]);
    
    if (standingsData.length === 0) {
        return JSON.stringify({
            success: true,
            standings: { standings: [] }
        });
    }
    
    return JSON.stringify({
        success: true,
        standings: standingsData[0].value
    });
}

/**
 * RPC: Allocate training
 */
function rpcAllocateTraining(context, logger, nk, payload) {
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
    
    const { player_id, focus, points } = data;
    
    // Get player data (simplified - would fetch from storage)
    // In production, would update player attributes based on training focus
    
    return JSON.stringify({
        success: true,
        player_id: player_id,
        updated_attributes: {
            technique: 70,
            power: 75,
            temperament: 65,
            strikeRate: 80
        }
    });
}

/**
 * RPC: Get training report
 */
function rpcGetTrainingReport(context, logger, nk, payload) {
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
    
    const { team_id } = data;
    
    // Get squad
    const squadData = nk.storageRead([{
        collection: COLLECTIONS.USER_SQUADS,
        key: "squad",
        userId: userId
    }]);
    
    const players = (squadData[0]?.value?.squad || []).map(player => ({
        playerId: player.playerId,
        name: player.name,
        trainingPointsAllocated: 0,
        attributes: player.attributes,
        form: player.form,
        fitness: player.fitness
    }));
    
    return JSON.stringify({
        success: true,
        players: players
    });
}

/**
 * RPC: Get player stats
 */
function rpcGetPlayerStats(context, logger, nk, payload) {
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
    
    const { player_id, season_id } = data;
    
    // Get player stats (simplified)
    const statsData = nk.storageRead([{
        collection: COLLECTIONS.PLAYER_STATS,
        key: player_id,
        userId: userId
    }]);
    
    if (statsData.length === 0) {
        return JSON.stringify({
            success: true,
            player: null,
            stats: {
                matches: 0,
                runs: 0,
                wickets: 0,
                average: 0,
                strikeRate: 0
            }
        });
    }
    
    return JSON.stringify({
        success: true,
        player: statsData[0].value.player,
        stats: statsData[0].value.stats
    });
}

/**
 * RPC: Get team stats
 */
function rpcGetTeamStats(context, logger, nk, payload) {
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
    
    const { team_id, season_id } = data;
    
    // Get squad stats
    const squadData = nk.storageRead([{
        collection: COLLECTIONS.USER_SQUADS,
        key: "squad",
        userId: userId
    }]);
    
    const stats = squadData[0]?.value?.stats || {
        matchesPlayed: 0,
        matchesWon: 0,
        matchesLost: 0,
        points: 0,
        netRunRate: 0
    };
    
    return JSON.stringify({
        success: true,
        stats: stats
    });
}

/**
 * RPC: Get match history
 */
function rpcGetMatchHistory(context, logger, nk, payload) {
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
    
    const { team_id, limit = 10 } = data;
    
    // Get completed matches
    const matches = nk.storageList(userId, COLLECTIONS.MATCH_STATES, limit, null);
    const matchHistory = (matches.objects || [])
        .map(obj => obj.value)
        .filter(m => m.status === "match_complete")
        .map(m => ({
            matchId: m.matchId,
            teamAId: m.teamAId,
            teamAName: m.teamAId,
            teamBId: m.teamBId,
            teamBName: m.teamBId,
            teamARuns: m.innings1?.totalRuns || 0,
            teamAWickets: m.innings1?.wickets || 0,
            teamBRuns: m.innings2?.totalRuns || 0,
            teamBWickets: m.innings2?.wickets || 0,
            winner: m.winner,
            matchTime: m.startedAt || Date.now()
        }))
        .slice(0, limit);
    
    return JSON.stringify({
        success: true,
        matches: matchHistory
    });
}

/**
 * RPC: Add player to squad
 */
function rpcAddPlayerToSquad(context, logger, nk, payload) {
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
    
    const { team_id, player } = data;
    
    if (!team_id || !player) {
        throw new Error("team_id and player are required");
    }
    
    // Get team
    const teamData = nk.storageRead([{
        collection: COLLECTIONS.USER_SQUADS,
        key: team_id,
        userId: userId
    }]);
    
    if (teamData.length === 0) {
        throw new Error("Team not found");
    }
    
    const team = teamData[0].value;
    
    // Verify ownership
    if (team.managerId !== userId) {
        throw new Error("You don't have permission to modify this team");
    }
    
    // Check squad size limit (max 25 players)
    if (team.squad && team.squad.length >= 25) {
        throw new Error("Squad is full (maximum 25 players)");
    }
    
    // Generate player ID if not provided
    if (!player.playerId) {
        player.playerId = `player_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Initialize stats if not provided
    if (!player.careerStats) {
        player.careerStats = {
            matches: 0, innings: 0, runs: 0, balls: 0, notOuts: 0,
            fours: 0, sixes: 0, average: 0, strikeRate: 0,
            fifties: 0, hundreds: 0, highestScore: 0,
            overs: 0, maidens: 0, runsConceded: 0, wickets: 0,
            economy: 0, bowlingAverage: 0, bowlingStrikeRate: 0,
            fourWickets: 0, fiveWickets: 0, bestBowling: 0
        };
    }
    
    if (!player.seasonStats) {
        player.seasonStats = player.careerStats;
    }
    
    // Add player to squad
    if (!team.squad) {
        team.squad = [];
    }
    
    team.squad.push(player);
    
    // Save updated team
    nk.storageWrite([{
        collection: COLLECTIONS.USER_SQUADS,
        key: team_id,
        userId: userId,
        value: team,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    logger.info(`Player added to squad: ${player.name} (${player.playerId}) in team ${team_id}`);
    
    return JSON.stringify({
        success: true,
        team: team
    });
}

/**
 * RPC: Remove player from squad
 */
function rpcRemovePlayerFromSquad(context, logger, nk, payload) {
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
    
    const { team_id, player_id } = data;
    
    if (!team_id || !player_id) {
        throw new Error("team_id and player_id are required");
    }
    
    // Get team
    const teamData = nk.storageRead([{
        collection: COLLECTIONS.USER_SQUADS,
        key: team_id,
        userId: userId
    }]);
    
    if (teamData.length === 0) {
        throw new Error("Team not found");
    }
    
    const team = teamData[0].value;
    
    // Verify ownership
    if (team.managerId !== userId) {
        throw new Error("You don't have permission to modify this team");
    }
    
    // Remove player from squad
    if (!team.squad) {
        team.squad = [];
    }
    
    const initialLength = team.squad.length;
    team.squad = team.squad.filter(p => p.playerId !== player_id);
    
    if (team.squad.length === initialLength) {
        throw new Error("Player not found in squad");
    }
    
    // If removed player was captain, clear captain
    if (team.captainId === player_id) {
        team.captainId = null;
    }
    
    // Save updated team
    nk.storageWrite([{
        collection: COLLECTIONS.USER_SQUADS,
        key: team_id,
        userId: userId,
        value: team,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    logger.info(`Player removed from squad: ${player_id} from team ${team_id}`);
    
    return JSON.stringify({
        success: true,
        team: team
    });
}

/**
 * RPC: Generate random players for a team
 */
function rpcGeneratePlayers(context, logger, nk, payload) {
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
    
    const { team_id, count = 15, min_skill = 40, max_skill = 80 } = data;
    
    if (!team_id) {
        throw new Error("team_id is required");
    }
    
    // Get team
    const teamData = nk.storageRead([{
        collection: COLLECTIONS.USER_SQUADS,
        key: team_id,
        userId: userId
    }]);
    
    if (teamData.length === 0) {
        throw new Error("Team not found");
    }
    
    const team = teamData[0].value;
    
    // Verify ownership
    if (team.managerId !== userId) {
        throw new Error("You don't have permission to modify this team");
    }
    
    // Check squad size limit
    const currentSquadSize = team.squad ? team.squad.length : 0;
    const remainingSlots = 25 - currentSquadSize;
    const playersToGenerate = Math.min(count, remainingSlots);
    
    if (playersToGenerate <= 0) {
        throw new Error("Squad is full (maximum 25 players)");
    }
    
    // Generate players
    const generatedPlayers = [];
    const firstNames = ["Rohit", "Virat", "MS", "KL", "Rishabh", "Hardik", "Ravindra", "Jasprit", "Mohammed", "Yuzvendra", "Shikhar", "Ajinkya", "Ravichandran", "Bhuvneshwar", "Ishan"];
    const lastNames = ["Sharma", "Kohli", "Dhoni", "Rahul", "Pant", "Pandya", "Jadeja", "Bumrah", "Shami", "Chahal", "Dhawan", "Rahane", "Ashwin", "Kumar", "Kishan"];
    const roles = ["BAT", "BOWL", "AR", "WK"];
    const battingHands = ["LEFT", "RIGHT"];
    const bowlingStyles = ["PACE", "SPIN"];
    
    for (let i = 0; i < playersToGenerate; i++) {
        const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
        const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
        const name = `${firstName} ${lastName}`;
        const role = roles[Math.floor(Math.random() * roles.length)];
        const battingHand = battingHands[Math.floor(Math.random() * battingHands.length)];
        const bowlingStyle = bowlingStyles[Math.floor(Math.random() * bowlingStyles.length)];
        const age = 20 + Math.floor(Math.random() * 15); // 20-35
        
        // Generate attributes based on role
        const baseSkill = min_skill + Math.floor(Math.random() * (max_skill - min_skill));
        
        const attributes = {
            // Batting attributes (higher for BAT, AR, WK)
            technique: role === "BAT" || role === "AR" || role === "WK" ? baseSkill + Math.floor(Math.random() * 20) : Math.floor(Math.random() * 60),
            power: role === "BAT" || role === "AR" ? baseSkill + Math.floor(Math.random() * 20) : Math.floor(Math.random() * 60),
            temperament: baseSkill + Math.floor(Math.random() * 20),
            strikeRate: role === "BAT" || role === "AR" ? baseSkill + Math.floor(Math.random() * 20) : Math.floor(Math.random() * 60),
            
            // Bowling attributes (higher for BOWL, AR)
            paceOrSpin: bowlingStyle === "PACE" ? Math.floor(Math.random() * 30) : 70 + Math.floor(Math.random() * 30),
            accuracy: role === "BOWL" || role === "AR" ? baseSkill + Math.floor(Math.random() * 20) : Math.floor(Math.random() * 60),
            movement: role === "BOWL" || role === "AR" ? baseSkill + Math.floor(Math.random() * 20) : Math.floor(Math.random() * 60),
            variations: role === "BOWL" || role === "AR" ? baseSkill + Math.floor(Math.random() * 20) : Math.floor(Math.random() * 60),
            
            // Fielding attributes
            catching: baseSkill + Math.floor(Math.random() * 20),
            throwing: baseSkill + Math.floor(Math.random() * 20),
            agility: baseSkill + Math.floor(Math.random() * 20),
            
            // Mental attributes
            composure: baseSkill + Math.floor(Math.random() * 20),
            leadership: Math.floor(Math.random() * 100)
        };
        
        // Clamp all attributes to 0-100
        Object.keys(attributes).forEach(key => {
            attributes[key] = Math.max(0, Math.min(100, attributes[key]));
        });
        
        const player = {
            playerId: `player_${userId}_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`,
            name: name,
            age: age,
            role: role,
            battingHand: battingHand,
            bowlingStyle: bowlingStyle,
            attributes: attributes,
            form: "Average",
            fitness: 80 + Math.floor(Math.random() * 20), // 80-100
            morale: 70 + Math.floor(Math.random() * 30), // 70-100
            experience: 0,
            potential: 60 + Math.floor(Math.random() * 40), // 60-100
            injuryProneness: Math.random() * 0.3, // 0-0.3
            careerStats: {
                matches: 0, innings: 0, runs: 0, balls: 0, notOuts: 0,
                fours: 0, sixes: 0, average: 0, strikeRate: 0,
                fifties: 0, hundreds: 0, highestScore: 0,
                overs: 0, maidens: 0, runsConceded: 0, wickets: 0,
                economy: 0, bowlingAverage: 0, bowlingStrikeRate: 0,
                fourWickets: 0, fiveWickets: 0, bestBowling: 0
            },
            seasonStats: {
                matches: 0, innings: 0, runs: 0, balls: 0, notOuts: 0,
                fours: 0, sixes: 0, average: 0, strikeRate: 0,
                fifties: 0, hundreds: 0, highestScore: 0,
                overs: 0, maidens: 0, runsConceded: 0, wickets: 0,
                economy: 0, bowlingAverage: 0, bowlingStrikeRate: 0,
                fourWickets: 0, fiveWickets: 0, bestBowling: 0
            }
        };
        
        generatedPlayers.push(player);
    }
    
    // Add players to squad
    if (!team.squad) {
        team.squad = [];
    }
    
    team.squad = team.squad.concat(generatedPlayers);
    
    // Save updated team
    nk.storageWrite([{
        collection: COLLECTIONS.USER_SQUADS,
        key: team_id,
        userId: userId,
        value: team,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    logger.info(`Generated ${generatedPlayers.length} players for team ${team_id}`);
    
    return JSON.stringify({
        success: true,
        players: generatedPlayers,
        team: team
    });
}

/**
 * RPC: Create custom player
 */
function rpcCreatePlayer(context, logger, nk, payload) {
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
    
    const { team_id, name, role, battingHand, bowlingStyle, age, attributes } = data;
    
    if (!team_id || !name || !role || !battingHand || !bowlingStyle || age === undefined) {
        throw new Error("team_id, name, role, battingHand, bowlingStyle, and age are required");
    }
    
    // Get team
    const teamData = nk.storageRead([{
        collection: COLLECTIONS.USER_SQUADS,
        key: team_id,
        userId: userId
    }]);
    
    if (teamData.length === 0) {
        throw new Error("Team not found");
    }
    
    const team = teamData[0].value;
    
    // Verify ownership
    if (team.managerId !== userId) {
        throw new Error("You don't have permission to modify this team");
    }
    
    // Check squad size limit
    if (team.squad && team.squad.length >= 25) {
        throw new Error("Squad is full (maximum 25 players)");
    }
    
    // Generate attributes if not provided
    let playerAttributes = attributes;
    if (!playerAttributes) {
        const baseSkill = 50; // Default skill level
        playerAttributes = {
            technique: role === "BAT" || role === "AR" || role === "WK" ? baseSkill : 30,
            power: role === "BAT" || role === "AR" ? baseSkill : 30,
            temperament: baseSkill,
            strikeRate: role === "BAT" || role === "AR" ? baseSkill : 30,
            paceOrSpin: bowlingStyle === "PACE" ? 20 : 80,
            accuracy: role === "BOWL" || role === "AR" ? baseSkill : 30,
            movement: role === "BOWL" || role === "AR" ? baseSkill : 30,
            variations: role === "BOWL" || role === "AR" ? baseSkill : 30,
            catching: baseSkill,
            throwing: baseSkill,
            agility: baseSkill,
            composure: baseSkill,
            leadership: 50
        };
    }
    
    const player = {
        playerId: `player_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: name,
        age: age,
        role: role,
        battingHand: battingHand,
        bowlingStyle: bowlingStyle,
        attributes: playerAttributes,
        form: "Average",
        fitness: 100,
        morale: 80,
        experience: 0,
        potential: 70,
        injuryProneness: 0.1,
        careerStats: {
            matches: 0, innings: 0, runs: 0, balls: 0, notOuts: 0,
            fours: 0, sixes: 0, average: 0, strikeRate: 0,
            fifties: 0, hundreds: 0, highestScore: 0,
            overs: 0, maidens: 0, runsConceded: 0, wickets: 0,
            economy: 0, bowlingAverage: 0, bowlingStrikeRate: 0,
            fourWickets: 0, fiveWickets: 0, bestBowling: 0
        },
        seasonStats: {
            matches: 0, innings: 0, runs: 0, balls: 0, notOuts: 0,
            fours: 0, sixes: 0, average: 0, strikeRate: 0,
            fifties: 0, hundreds: 0, highestScore: 0,
            overs: 0, maidens: 0, runsConceded: 0, wickets: 0,
            economy: 0, bowlingAverage: 0, bowlingStrikeRate: 0,
            fourWickets: 0, fiveWickets: 0, bestBowling: 0
        }
    };
    
    // Add player to squad
    if (!team.squad) {
        team.squad = [];
    }
    
    team.squad.push(player);
    
    // Save updated team
    nk.storageWrite([{
        collection: COLLECTIONS.USER_SQUADS,
        key: team_id,
        userId: userId,
        value: team,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    logger.info(`Created custom player: ${name} (${player.playerId}) in team ${team_id}`);
    
    return JSON.stringify({
        success: true,
        player: player,
        team: team
    });
}

/**
 * RPC: Get match state
 * Returns current match state and scorecard
 */
function rpcGetMatchState(context, logger, nk, payload) {
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
    
    const { match_id } = data;
    
    const stateData = nk.storageRead([{
        collection: COLLECTIONS.MATCH_STATES,
        key: match_id,
        userId: userId
    }]);
    
    if (stateData.length === 0) {
        throw new Error("Match state not found");
    }
    
    const matchState = stateData[0].value;
    
    // Generate scorecard from match state
    const scorecard = {
        teamId: matchState.teamId || "team_1",
        totalRuns: matchState.innings1.totalRuns,
        wickets: matchState.innings1.wickets,
        overs: matchState.innings1.overs + (matchState.innings1.balls / 6),
        batsmen: [],
        bowlers: [],
        extras: {
            wides: 0,
            noBalls: 0,
            byes: 0,
            legByes: 0,
            total: 0
        }
    };
    
    return JSON.stringify({
        success: true,
        match_state: matchState,
        scorecard: scorecard,
        ball_history: matchState.innings1.ballHistory || []
    });
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("🏏 Cricket Manager Mode Module loading...");
    logger.info(`Game ID: ${CRICKET_GAME_ID}`);
    
    // Register RPCs
    initializer.registerRpc("cricket_manager_create_or_sync_user", rpcCreateOrSyncManager);
    initializer.registerRpc("cricket_manager_create_team", rpcCreateTeam);
    initializer.registerRpc("cricket_manager_get_user_teams", rpcGetUserTeams);
    initializer.registerRpc("cricket_manager_update_team", rpcUpdateTeam);
    initializer.registerRpc("cricket_manager_get_squad", rpcGetSquad);
    initializer.registerRpc("cricket_manager_submit_match_orders", rpcSubmitMatchOrders);
    initializer.registerRpc("cricket_manager_start_match", rpcStartMatch);
    initializer.registerRpc("cricket_manager_simulate_ball", rpcSimulateBall);
    initializer.registerRpc("cricket_manager_simulate_over", rpcSimulateOver);
    initializer.registerRpc("cricket_manager_autoplay_match", rpcAutoPlayMatch);
    initializer.registerRpc("cricket_manager_get_match_state", rpcGetMatchState);
    initializer.registerRpc("cricket_manager_get_season", rpcGetSeason);
    initializer.registerRpc("cricket_manager_get_fixtures", rpcGetFixtures);
    initializer.registerRpc("cricket_manager_get_standings", rpcGetStandings);
    initializer.registerRpc("cricket_manager_allocate_training", rpcAllocateTraining);
    initializer.registerRpc("cricket_manager_get_training_report", rpcGetTrainingReport);
    initializer.registerRpc("cricket_manager_get_player_stats", rpcGetPlayerStats);
    initializer.registerRpc("cricket_manager_get_team_stats", rpcGetTeamStats);
    initializer.registerRpc("cricket_manager_get_match_history", rpcGetMatchHistory);
    initializer.registerRpc("cricket_manager_add_player_to_squad", rpcAddPlayerToSquad);
    initializer.registerRpc("cricket_manager_remove_player_from_squad", rpcRemovePlayerFromSquad);
    initializer.registerRpc("cricket_manager_generate_players", rpcGeneratePlayers);
    initializer.registerRpc("cricket_manager_create_player", rpcCreatePlayer);
    
    // Create leaderboards
    const leaderboardConfigs = [
        { id: LEADERBOARDS.MANAGER_RANKINGS, sortOrder: 1, operator: 2, resetSchedule: null },
        { id: LEADERBOARDS.SEASON_POINTS, sortOrder: 1, operator: 2, resetSchedule: null },
        { id: LEADERBOARDS.BATSMAN_RUNS, sortOrder: 1, operator: 2, resetSchedule: null },
        { id: LEADERBOARDS.BOWLER_WICKETS, sortOrder: 1, operator: 2, resetSchedule: null },
        { id: LEADERBOARDS.TEAM_POINTS, sortOrder: 1, operator: 2, resetSchedule: null }
    ];
    
    for (const config of leaderboardConfigs) {
        try {
            nk.leaderboardCreate(config.id, false, config.sortOrder, config.operator, config.resetSchedule, null);
            logger.info(`✅ Created leaderboard: ${config.id}`);
        } catch (e) {
            // Leaderboard already exists
        }
    }
    
    logger.info("✅ Cricket Manager Mode Module initialized successfully!");
    logger.info(`
╔═══════════════════════════════════════════════════════════════════════════╗
║              🏏 CRICKET MANAGER MODE NAKAMA MODULE 🏏                      ║
╠═══════════════════════════════════════════════════════════════════════════╣
║ Game ID: ${CRICKET_GAME_ID}                          ║
║                                                                           ║
║ RPC Endpoints:                                                            ║
║   ✅ cricket_manager_create_or_sync_user                                  ║
║   ✅ cricket_manager_create_team                                           ║
║   ✅ cricket_manager_get_user_teams                                         ║
║   ✅ cricket_manager_update_team                                            ║
║   ✅ cricket_manager_get_squad                                             ║
║   ✅ cricket_manager_submit_match_orders                                  ║
║   ✅ cricket_manager_start_match                                           ║
║   ✅ cricket_manager_simulate_ball                                         ║
║   ✅ cricket_manager_simulate_over                                         ║
║   ✅ cricket_manager_autoplay_match                                        ║
║   ✅ cricket_manager_get_match_state                                      ║
║   ✅ cricket_manager_get_season                                            ║
║   ✅ cricket_manager_get_fixtures                                          ║
║   ✅ cricket_manager_get_standings                                         ║
║   ✅ cricket_manager_allocate_training                                     ║
║   ✅ cricket_manager_get_training_report                                   ║
║   ✅ cricket_manager_get_player_stats                                      ║
║   ✅ cricket_manager_get_team_stats                                        ║
║   ✅ cricket_manager_get_match_history                                     ║
║   ✅ cricket_manager_add_player_to_squad                                  ║
║   ✅ cricket_manager_remove_player_from_squad                             ║
║   ✅ cricket_manager_generate_players                                      ║
║   ✅ cricket_manager_create_player                                         ║
║                                                                           ║
║ Leaderboards: 5                                                           ║
║ Collections: 10+                                                          ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);
}

!InitModule.toString().includes("InitModule") || InitModule;

