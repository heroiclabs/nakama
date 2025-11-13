// index.js - Main entry point for Nakama 3.x JavaScript runtime

// Load Copilot Wallet Mapping modules
// @ts-ignore
var WalletUtils = require('./copilot/wallet_utils.js').WalletUtils;
// @ts-ignore
var WalletRegistry = require('./copilot/wallet_registry.js').WalletRegistry;
// @ts-ignore
var CognitoWalletMapper = require('./copilot/cognito_wallet_mapper.js').CognitoWalletMapper;

// Load new modules
// @ts-ignore
var DailyRewards = require('./daily_rewards/daily_rewards.js');
// @ts-ignore
var DailyMissions = require('./daily_missions/daily_missions.js');
// @ts-ignore
var Wallet = require('./wallet/wallet.js');
// @ts-ignore
var Analytics = require('./analytics/analytics.js');
// @ts-ignore
var Friends = require('./friends/friends.js');
// @ts-ignore
var LeaderboardsTimePeriod = require('./leaderboards_timeperiod.js');

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
    
    // Register Copilot Wallet Mapping RPCs
    try {
        logger.info('[Copilot] Initializing Wallet Mapping Module...');
        
        // Register RPC: get_user_wallet
        initializer.registerRpc('get_user_wallet', CognitoWalletMapper.getUserWallet);
        logger.info('[Copilot] Registered RPC: get_user_wallet');
        
        // Register RPC: link_wallet_to_game
        initializer.registerRpc('link_wallet_to_game', CognitoWalletMapper.linkWalletToGame);
        logger.info('[Copilot] Registered RPC: link_wallet_to_game');
        
        // Register RPC: get_wallet_registry
        initializer.registerRpc('get_wallet_registry', CognitoWalletMapper.getWalletRegistry);
        logger.info('[Copilot] Registered RPC: get_wallet_registry');
        
        logger.info('[Copilot] Successfully registered 3 wallet RPC functions');
    } catch (err) {
        logger.error('[Copilot] Failed to initialize wallet module: ' + err.message);
    }
    
    // Register Leaderboard RPCs
    initializer.registerRpc('create_all_leaderboards_persistent', createAllLeaderboardsPersistent);
    logger.info('[Leaderboards] Registered RPC: create_all_leaderboards_persistent');
    
    // Register Time-Period Leaderboard RPCs
    try {
        logger.info('[Leaderboards] Initializing Time-Period Leaderboard Module...');
        initializer.registerRpc('create_time_period_leaderboards', LeaderboardsTimePeriod.rpcCreateTimePeriodLeaderboards);
        logger.info('[Leaderboards] Registered RPC: create_time_period_leaderboards');
        initializer.registerRpc('submit_score_to_time_periods', LeaderboardsTimePeriod.rpcSubmitScoreToTimePeriods);
        logger.info('[Leaderboards] Registered RPC: submit_score_to_time_periods');
        initializer.registerRpc('get_time_period_leaderboard', LeaderboardsTimePeriod.rpcGetTimePeriodLeaderboard);
        logger.info('[Leaderboards] Registered RPC: get_time_period_leaderboard');
        logger.info('[Leaderboards] Successfully registered 3 Time-Period Leaderboard RPCs');
    } catch (err) {
        logger.error('[Leaderboards] Failed to initialize time-period leaderboards: ' + err.message);
    }
    
    // Register Daily Rewards RPCs
    try {
        logger.info('[DailyRewards] Initializing Daily Rewards Module...');
        initializer.registerRpc('daily_rewards_get_status', DailyRewards.rpcDailyRewardsGetStatus);
        logger.info('[DailyRewards] Registered RPC: daily_rewards_get_status');
        initializer.registerRpc('daily_rewards_claim', DailyRewards.rpcDailyRewardsClaim);
        logger.info('[DailyRewards] Registered RPC: daily_rewards_claim');
        logger.info('[DailyRewards] Successfully registered 2 Daily Rewards RPCs');
    } catch (err) {
        logger.error('[DailyRewards] Failed to initialize: ' + err.message);
    }
    
    // Register Daily Missions RPCs
    try {
        logger.info('[DailyMissions] Initializing Daily Missions Module...');
        initializer.registerRpc('get_daily_missions', DailyMissions.rpcGetDailyMissions);
        logger.info('[DailyMissions] Registered RPC: get_daily_missions');
        initializer.registerRpc('submit_mission_progress', DailyMissions.rpcSubmitMissionProgress);
        logger.info('[DailyMissions] Registered RPC: submit_mission_progress');
        initializer.registerRpc('claim_mission_reward', DailyMissions.rpcClaimMissionReward);
        logger.info('[DailyMissions] Registered RPC: claim_mission_reward');
        logger.info('[DailyMissions] Successfully registered 3 Daily Missions RPCs');
    } catch (err) {
        logger.error('[DailyMissions] Failed to initialize: ' + err.message);
    }
    
    // Register Enhanced Wallet RPCs
    try {
        logger.info('[Wallet] Initializing Enhanced Wallet Module...');
        initializer.registerRpc('wallet_get_all', Wallet.rpcWalletGetAll);
        logger.info('[Wallet] Registered RPC: wallet_get_all');
        initializer.registerRpc('wallet_update_global', Wallet.rpcWalletUpdateGlobal);
        logger.info('[Wallet] Registered RPC: wallet_update_global');
        initializer.registerRpc('wallet_update_game_wallet', Wallet.rpcWalletUpdateGameWallet);
        logger.info('[Wallet] Registered RPC: wallet_update_game_wallet');
        initializer.registerRpc('wallet_transfer_between_game_wallets', Wallet.rpcWalletTransferBetweenGameWallets);
        logger.info('[Wallet] Registered RPC: wallet_transfer_between_game_wallets');
        logger.info('[Wallet] Successfully registered 4 Enhanced Wallet RPCs');
    } catch (err) {
        logger.error('[Wallet] Failed to initialize: ' + err.message);
    }
    
    // Register Analytics RPCs
    try {
        logger.info('[Analytics] Initializing Analytics Module...');
        initializer.registerRpc('analytics_log_event', Analytics.rpcAnalyticsLogEvent);
        logger.info('[Analytics] Registered RPC: analytics_log_event');
        logger.info('[Analytics] Successfully registered 1 Analytics RPC');
    } catch (err) {
        logger.error('[Analytics] Failed to initialize: ' + err.message);
    }
    
    // Register Enhanced Friends RPCs
    try {
        logger.info('[Friends] Initializing Enhanced Friends Module...');
        initializer.registerRpc('friends_block', Friends.rpcFriendsBlock);
        logger.info('[Friends] Registered RPC: friends_block');
        initializer.registerRpc('friends_unblock', Friends.rpcFriendsUnblock);
        logger.info('[Friends] Registered RPC: friends_unblock');
        initializer.registerRpc('friends_remove', Friends.rpcFriendsRemove);
        logger.info('[Friends] Registered RPC: friends_remove');
        initializer.registerRpc('friends_list', Friends.rpcFriendsList);
        logger.info('[Friends] Registered RPC: friends_list');
        initializer.registerRpc('friends_challenge_user', Friends.rpcFriendsChallengeUser);
        logger.info('[Friends] Registered RPC: friends_challenge_user');
        initializer.registerRpc('friends_spectate', Friends.rpcFriendsSpectate);
        logger.info('[Friends] Registered RPC: friends_spectate');
        logger.info('[Friends] Successfully registered 6 Enhanced Friends RPCs');
    } catch (err) {
        logger.error('[Friends] Failed to initialize: ' + err.message);
    }
    
    // Load copilot modules
    try {
        var copilot = require("./copilot/index");
        copilot.initializeCopilotModules(ctx, logger, nk, initializer);
    } catch (err) {
        logger.error('Failed to load copilot modules: ' + err.message);
    }
    
    logger.info('========================================');
    logger.info('JavaScript Runtime Initialization Complete');
    logger.info('Total New System RPCs: 19 (2 Daily Rewards + 3 Daily Missions + 4 Wallet + 1 Analytics + 6 Friends + 3 Time-Period Leaderboards)');
    logger.info('Plus existing Copilot RPCs (Wallet Mapping + Leaderboards + Social)');
    logger.info('========================================');
}
