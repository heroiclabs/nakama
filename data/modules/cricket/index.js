/**
 * Cricket VR Mob - Main Module Index
 * 
 * Game ID: 78244246-1e9e-4e0f-a8a2-7447d5b0284e
 * 
 * This is the main entry point that loads all Cricket-specific modules:
 * 
 * 1. cricket_predictions.js   - Match predictions and leaderboards
 * 2. cricket_engagement.js    - Engagement tracking and rewards
 * 3. cricket_trivia.js        - AI-powered trivia system
 * 4. cricket_daily_challenges.js - Daily challenges and missions
 * 5. cricket_season_pass.js   - Season pass progression
 * 6. cricket_live_match.js    - Live match features and flash drops
 * 7. cricket_ai_integration.js - IntelliVerse-X AI integration
 * 8. cricket_retention.js     - Daily return triggers and psychological hooks
 * 9. cricket_economy.js       - Coin economy, IAP, and voice feature purchases
 * 
 * RPC Endpoints Summary:
 * 
 * PREDICTIONS:
 * - cricket_submit_prediction
 * - cricket_process_match_results
 * - cricket_get_user_predictions
 * - cricket_get_match_leaderboard
 * - cricket_get_tournament_leaderboard
 * 
 * ENGAGEMENT:
 * - cricket_track_engagement
 * - cricket_get_buildup_status
 * - cricket_claim_daily_login
 * - cricket_get_engagement_summary
 * - cricket_start_session
 * - cricket_end_session
 * 
 * TRIVIA:
 * - cricket_start_trivia
 * - cricket_submit_answer
 * - cricket_generate_ai_trivia
 * - cricket_get_trivia_leaderboard
 * - cricket_get_trivia_history
 * 
 * DAILY CHALLENGES:
 * - cricket_get_daily_challenges
 * - cricket_update_challenge_progress
 * - cricket_claim_challenge_reward
 * - cricket_get_challenge_history
 * - cricket_get_weekly_summary
 * 
 * SEASON PASS:
 * - cricket_get_season_pass
 * - cricket_add_season_xp
 * - cricket_claim_season_reward
 * - cricket_upgrade_to_premium
 * 
 * LIVE MATCH:
 * - cricket_load_schedules
 * - cricket_get_upcoming_matches
 * - cricket_get_match_details
 * - cricket_start_live_match
 * - cricket_update_ball_event
 * - cricket_trigger_strategic_timeout
 * - cricket_claim_flash_drop
 * - cricket_end_match
 * 
 * AI INTEGRATION:
 * - cricket_create_ai_note
 * - cricket_generate_quiz_from_note
 * - cricket_generate_match_trivia
 * - cricket_generate_player_trivia
 * - cricket_get_user_notes
 * - cricket_generate_debate
 */

var CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// Collection constants for reference
var COLLECTIONS = {
    // Predictions
    PREDICTIONS: "cricket_predictions",
    MATCH_RESULTS: "cricket_match_results",
    USER_STATS: "cricket_user_stats",
    
    // Engagement
    ENGAGEMENT: "cricket_engagement",
    DAILY_STREAKS: "cricket_daily_streaks",
    SESSION_DATA: "cricket_sessions",
    
    // Trivia
    TRIVIA_SESSIONS: "cricket_trivia_sessions",
    TRIVIA_QUESTIONS: "cricket_trivia_questions",
    TRIVIA_HISTORY: "cricket_trivia_history",
    
    // Daily Challenges
    DAILY_CHALLENGES: "cricket_daily_challenges",
    CHALLENGE_PROGRESS: "cricket_challenge_progress",
    CHALLENGE_HISTORY: "cricket_challenge_history",
    
    // Season Pass
    SEASON_PASS: "cricket_season_pass",
    XP_HISTORY: "cricket_xp_history",
    CLAIMED_REWARDS: "cricket_claimed_rewards",
    
    // Live Match
    SCHEDULES: "cricket_schedules",
    LIVE_MATCHES: "cricket_live_matches",
    FLASH_DROPS: "cricket_flash_drops",
    MATCH_EVENTS: "cricket_match_events",
    
    // AI Integration
    AI_NOTES: "cricket_ai_notes",
    AI_QUIZZES: "cricket_ai_quizzes",
    AI_CACHE: "cricket_ai_cache",
    
    // Inventory
    INVENTORY: "cricket_inventory",
    SHARDS: "cricket_shards"
};

// Leaderboard IDs
var LEADERBOARDS = {
    DAILY_TRIVIA: "cricket_daily_trivia",
    WEEKLY_TOURNAMENT: "cricket_weekly_tournament",
    WORLDCUP_2026: "cricket_worldcup_2026",
    IPL_2026: "cricket_ipl_2026",
    ALL_TIME: "cricket_all_time_master",
    PREDICTIONS_ACCURACY: "cricket_prediction_accuracy"
};

/**
 * RPC: Get game status
 * Returns overall game status and feature availability
 */
function rpcGetCricketGameStatus(context, logger, nk, payload) {
    const userId = context.userId;
    const now = Date.now();

    // Get current season
    const currentSeason = getCurrentSeason(now);

    // Get upcoming matches count
    let upcomingMatchesCount = 0;
    try {
        const schedules = nk.storageList(null, COLLECTIONS.SCHEDULES, 100, null);
        upcomingMatchesCount = (schedules.objects || []).filter(obj => {
            const matchTime = new Date(obj.value.matchTime).getTime();
            return matchTime > now;
        }).length;
    } catch (e) {
        // ignore
    }

    // Get user stats if authenticated
    let userStats = null;
    if (userId) {
        userStats = getUserGameStats(nk, userId);
    }

    return JSON.stringify({
        gameId: CRICKET_GAME_ID,
        status: "active",
        features: {
            predictions: true,
            trivia: true,
            dailyChallenges: true,
            seasonPass: true,
            liveMatch: true,
            aiIntegration: true
        },
        currentSeason,
        upcomingMatches: upcomingMatchesCount,
        userStats,
        serverTime: now,
        leaderboards: Object.keys(LEADERBOARDS),
        version: "1.0.0"
    });
}

/**
 * RPC: Initialize new user
 * Sets up all collections for a new Cricket player
 */
function rpcInitializeCricketUser(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    const now = Date.now();

    // Check if already initialized
    const existing = nk.storageRead([{
        collection: COLLECTIONS.USER_STATS,
        key: "stats",
        userId: userId
    }]);

    if (existing.length > 0) {
        return JSON.stringify({
            success: true,
            message: "User already initialized",
            isNew: false
        });
    }

    // Create initial user stats
    const initialStats = {
        createdAt: now,
        predictionsMade: 0,
        correctPredictions: 0,
        predictionStreak: 0,
        totalPredictionPoints: 0,
        triviaSessionsPlayed: 0,
        triviaQuestionsAnswered: 0,
        triviaCorrectAnswers: 0,
        totalTriviaScore: 0,
        dailyChallengesCompleted: 0,
        seasonPassLevel: 1,
        flashDropsClaimed: 0,
        totalCoinsEarned: 0
    };

    nk.storageWrite([{
        collection: COLLECTIONS.USER_STATS,
        key: "stats",
        userId: userId,
        value: initialStats,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    // Create initial engagement record
    nk.storageWrite([{
        collection: COLLECTIONS.ENGAGEMENT,
        key: "general",
        userId: userId,
        value: {
            totalScore: 0,
            events: [],
            completedActions: []
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);

    // Award welcome bonus
    try {
        nk.walletUpdate(userId, { coins: 100 }, { reason: "welcome_bonus" }, true);
    } catch (e) {
        logger.error(`Failed to award welcome bonus: ${e.message}`);
    }

    logger.info(`Initialized new Cricket user: ${userId}`);

    return JSON.stringify({
        success: true,
        message: "Welcome to Cricket VR Mob!",
        isNew: true,
        welcomeBonus: 100
    });
}

/**
 * RPC: Get user inventory
 */
function rpcGetUserInventory(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    const inventory = nk.storageList(userId, COLLECTIONS.INVENTORY, 100, null);
    const shards = nk.storageList(userId, COLLECTIONS.SHARDS, 100, null);

    const items = (inventory.objects || []).map(obj => obj.value);
    const shardItems = (shards.objects || []).map(obj => obj.value);

    // Get wallet
    let wallet = { coins: 0 };
    try {
        const account = nk.accountGetId(userId);
        wallet = account.wallet ? JSON.parse(account.wallet) : { coins: 0 };
    } catch (e) {
        // ignore
    }

    return JSON.stringify({
        wallet,
        items: {
            caps: items.filter(i => i.type === "cap"),
            jerseys: items.filter(i => i.type === "jersey"),
            avatars: items.filter(i => i.type === "avatar"),
            titles: items.filter(i => i.type === "title"),
            other: items.filter(i => !["cap", "jersey", "avatar", "title"].includes(i.type))
        },
        shards: shardItems,
        totalItems: items.length
    });
}

// Helper functions
function getCurrentSeason(now) {
    const seasons = {
        WORLDCUP_2026: {
            id: "worldcup_2026",
            name: "ICC T20 World Cup 2026",
            startDate: "2026-02-01",
            endDate: "2026-03-15",
            theme: "national_pride"
        },
        IPL_2026: {
            id: "ipl_2026",
            name: "IPL 2026",
            startDate: "2026-04-01",
            endDate: "2026-05-31",
            theme: "franchise_glory"
        }
    };

    for (const season of Object.values(seasons)) {
        const start = new Date(season.startDate).getTime();
        const end = new Date(season.endDate).getTime();
        
        if (now >= start && now <= end) {
            return {
                ...season,
                isActive: true,
                daysRemaining: Math.ceil((end - now) / (1000 * 60 * 60 * 24))
            };
        }
    }

    // Return World Cup as default for development
    return {
        ...seasons.WORLDCUP_2026,
        isActive: true,
        daysRemaining: 30
    };
}

function getUserGameStats(nk, userId) {
    const stats = nk.storageRead([{
        collection: COLLECTIONS.USER_STATS,
        key: "stats",
        userId: userId
    }]);

    if (stats.length === 0) {
        return null;
    }

    return stats[0].value;
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("🏏 Cricket VR Mob Main Module loading...");
    logger.info(`Game ID: ${CRICKET_GAME_ID}`);

    // Register main RPCs
    initializer.registerRpc("cricket_get_game_status", rpcGetCricketGameStatus);
    initializer.registerRpc("cricket_initialize_user", rpcInitializeCricketUser);
    initializer.registerRpc("cricket_get_inventory", rpcGetUserInventory);

    // Create leaderboards
    const leaderboardConfigs = [
        { id: LEADERBOARDS.DAILY_TRIVIA, sortOrder: 1, operator: 2, resetSchedule: "0 0 * * *" },
        { id: LEADERBOARDS.WEEKLY_TOURNAMENT, sortOrder: 1, operator: 2, resetSchedule: "0 0 * * 1" },
        { id: LEADERBOARDS.WORLDCUP_2026, sortOrder: 1, operator: 2, resetSchedule: null },
        { id: LEADERBOARDS.IPL_2026, sortOrder: 1, operator: 2, resetSchedule: null },
        { id: LEADERBOARDS.ALL_TIME, sortOrder: 1, operator: 2, resetSchedule: null }
    ];

    for (const config of leaderboardConfigs) {
        try {
            nk.leaderboardCreate(config.id, false, config.sortOrder, config.operator, config.resetSchedule, null);
            logger.info(`✅ Created leaderboard: ${config.id}`);
        } catch (e) {
            // Leaderboard already exists
        }
    }

    logger.info("✅ Cricket VR Mob Main Module initialized successfully!");
    logger.info(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                    🏏 CRICKET VR MOB NAKAMA MODULES 🏏                    ║
╠═══════════════════════════════════════════════════════════════════════════╣
║ Modules Loaded:                                                           ║
║   ✅ cricket_predictions.js   - Match predictions & leaderboards         ║
║   ✅ cricket_engagement.js    - Engagement tracking & rewards            ║
║   ✅ cricket_trivia.js        - AI-powered trivia system                 ║
║   ✅ cricket_daily_challenges.js - Daily challenges & missions           ║
║   ✅ cricket_season_pass.js   - Season pass progression                  ║
║   ✅ cricket_live_match.js    - Live match features & flash drops        ║
║   ✅ cricket_ai_integration.js - IntelliVerse-X AI integration           ║
║   ✅ cricket_retention.js     - Daily return triggers & psych hooks      ║
║   ✅ cricket_economy.js       - Coin economy, IAP & voice purchases      ║
║   ✅ index.js                 - Main module & initialization             ║
╠═══════════════════════════════════════════════════════════════════════════╣
║ Daily Return Triggers (Psychological Loop):                               ║
║   Day 1:  🔥 Login streak counter                                        ║
║   Day 3:  📉 Leaderboard decay warning                                   ║
║   Day 5:  ⚔️ Squad pressure notification                                 ║
║   Day 7:  🚀 2X Bonus Hour activation                                    ║
║   Day 14: ⬆️ Tier progression near-miss                                  ║
║   Day 30: 🏆 Monthly reset celebration                                   ║
╠═══════════════════════════════════════════════════════════════════════════╣
║ Total RPC Endpoints: 48+                                                  ║
║ Leaderboards: 5                                                           ║
║ Collections: 30+                                                          ║
╠═══════════════════════════════════════════════════════════════════════════╣
║ Economy & Voice RPCs:                                                      ║
║   • cricket_get_wallet         • cricket_spend_coins                      ║
║   • cricket_add_coins          • cricket_process_iap                      ║
║   • cricket_purchase_voice_access  • cricket_check_voice_access           ║
║   • cricket_get_transactions   • cricket_convert_guest                    ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);
}

!InitModule.toString().includes("InitModule") || InitModule;

