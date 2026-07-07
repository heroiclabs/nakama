// daily_reward_calendar.js - 30-Day Daily Reward Calendar View
// Extends the daily rewards system with a full calendar preview
// RPC: daily_reward_get_calendar

var CALENDAR_REWARD_CONFIGS = {
    "default": [
        { day: 1,  xp: 50,   tokens: 40,   name: "Welcome Back",         tier: "common",    icon: "coin_stack" },
        { day: 2,  xp: 75,   tokens: 50,   name: "Steady Start",         tier: "common",    icon: "coin_stack" },
        { day: 3,  xp: 100,  tokens: 65,   name: "Power-Up Day",         tier: "uncommon",  icon: "lightning" },
        { day: 4,  xp: 150,  tokens: 80,   name: "Momentum Builder",     tier: "common",    icon: "coin_stack" },
        { day: 5,  xp: 200,  tokens: 100,  name: "XP Boost",             tier: "uncommon",  icon: "star", multiplier: "2x XP" },
        { day: 6,  xp: 275,  tokens: 125,  name: "Almost There",         tier: "uncommon",  icon: "fire" },
        { day: 7,  xp: 400,  tokens: 200,  name: "Weekly Champion",      tier: "rare",      icon: "trophy",   bonus: "weekly_badge" },
        { day: 8,  xp: 60,   tokens: 45,   name: "Fresh Week",           tier: "common",    icon: "sunrise" },
        { day: 9,  xp: 90,   tokens: 55,   name: "Keeping It Up",        tier: "common",    icon: "thumbsup" },
        { day: 10, xp: 150,  tokens: 75,   name: "Double Digits",        tier: "uncommon",  icon: "sparkles" },
        { day: 11, xp: 175,  tokens: 90,   name: "Committed Player",     tier: "common",    icon: "muscle" },
        { day: 12, xp: 225,  tokens: 110,  name: "Power Surge",          tier: "uncommon",  icon: "lightning", multiplier: "2x XP" },
        { day: 13, xp: 300,  tokens: 140,  name: "Lucky 13",             tier: "uncommon",  icon: "clover" },
        { day: 14, xp: 500,  tokens: 250,  name: "Two-Week Legend",      tier: "rare",      icon: "crown",    bonus: "biweekly_chest" },
        { day: 15, xp: 75,   tokens: 50,   name: "Halfway Point",        tier: "common",    icon: "flag" },
        { day: 16, xp: 100,  tokens: 60,   name: "Steady Grinder",       tier: "common",    icon: "pickaxe" },
        { day: 17, xp: 175,  tokens: 85,   name: "Streak Fire",          tier: "uncommon",  icon: "fire" },
        { day: 18, xp: 200,  tokens: 100,  name: "Bonus Round",          tier: "uncommon",  icon: "gift" },
        { day: 19, xp: 250,  tokens: 120,  name: "XP Rush",              tier: "uncommon",  icon: "rocket",   multiplier: "3x XP" },
        { day: 20, xp: 350,  tokens: 160,  name: "Dedication Reward",    tier: "rare",      icon: "medal" },
        { day: 21, xp: 600,  tokens: 300,  name: "Three-Week Warrior",   tier: "epic",      icon: "shield",   bonus: "mystery_box" },
        { day: 22, xp: 100,  tokens: 65,   name: "Final Stretch",        tier: "common",    icon: "runner" },
        { day: 23, xp: 150,  tokens: 80,   name: "Almost Legendary",     tier: "common",    icon: "hourglass" },
        { day: 24, xp: 200,  tokens: 100,  name: "Power Player",         tier: "uncommon",  icon: "lightning" },
        { day: 25, xp: 275,  tokens: 130,  name: "Quarter Century",      tier: "uncommon",  icon: "sparkles" },
        { day: 26, xp: 350,  tokens: 150,  name: "XP Mega Boost",        tier: "rare",      icon: "rocket",   multiplier: "4x XP" },
        { day: 27, xp: 400,  tokens: 175,  name: "Penultimate Push",     tier: "rare",      icon: "fire" },
        { day: 28, xp: 500,  tokens: 200,  name: "Four-Week Hero",       tier: "epic",      icon: "crown",    bonus: "exclusive_avatar" },
        { day: 29, xp: 600,  tokens: 250,  name: "The Final Countdown",  tier: "epic",      icon: "alarm" },
        { day: 30, xp: 1000, tokens: 500,  name: "LEGENDARY REWARD",     tier: "legendary", icon: "dragon",   bonus: "legendary_chest", multiplier: "5x XP" }
    ]
};

/**
 * Get the full 30-day calendar config for a game, falling back to default.
 */
function getCalendarConfig(gameId) {
    return CALENDAR_REWARD_CONFIGS[gameId] || CALENDAR_REWARD_CONFIGS["default"];
}

/**
 * RPC: daily_reward_get_calendar (LEGACY-COMPATIBLE WRAPPER)
 *
 * DAILY PROGRESSION PLATFORM consolidation: this handler previously duplicated
 * streak resolution with TWO hand-rolled storage-key guesses (both wrong vs the
 * canonical utils.makeGameStorageKey layout) and its own claim-eligibility
 * check using LOCAL server timezone (setHours) instead of the platform's UTC
 * day window — so the calendar could disagree with daily_rewards_get_status
 * around midnight. It now delegates to the canonical state functions
 * (getStreakData / updateStreakStatus / canClaimToday in daily_rewards.js) and
 * the shared calendar builder (buildDailyRewardCalendarView in
 * daily_progress.js). Response shape unchanged for shipped clients.
 * New clients should use daily_progress_check instead.
 */
function rpcDailyRewardGetCalendar(ctx, logger, nk, payload) {
    logger.info('[DailyRewardCalendar] daily_reward_get_calendar called');

    try {
        if (!ctx.userId) {
            return JSON.stringify({ success: false, error: 'Authentication required' });
        }

        var data = JSON.parse(payload || '{}');
        var gameId = dpResolveGameId(data);
        var userId = ctx.userId;

        var streakData = getStreakData(nk, logger, userId, gameId);
        streakData = updateStreakStatus(nk, logger, userId, gameId, streakData);

        var claimCheck = canClaimToday(streakData);
        var currentStreak = streakData.currentStreak || 0;
        var view = buildDailyRewardCalendarView(gameId, currentStreak, claimCheck.canClaim);

        return JSON.stringify({
            success: true,
            user_id: userId,
            game_id: gameId,
            current_streak: currentStreak,
            total_claims: streakData.totalClaims || 0,
            can_claim_today: claimCheck.canClaim,
            calendar: view.calendar,
            milestones: view.milestones,
            totals: {
                total_tokens_30_days: view.totalTokens30,
                total_xp_30_days: view.totalXp30,
                claimed_tokens: 0,
                claimed_xp: 0
            },
            streak_status: currentStreak === 0 ? 'new' : (claimCheck.canClaim ? 'active' : 'claimed_today'),
            next_milestone: null
        });

    } catch (err) {
        logger.error('[DailyRewardCalendar] Error: ' + err.message);
        logRpcError(nk, logger, 'daily_reward_get_calendar', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// Registration (QVBF_51)
// ============================================================================
// This RPC was merged into index.js but NEVER registered — it was dead code.
// postbuild.js renames this InitModule -> __ModuleInit_N (never executes) and
// uses the literal registerRpc call below to wire __rpc_daily_reward_get_calendar
// into the master InitModule. See daily_rewards.js for the full mechanism.
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("daily_reward_get_calendar", rpcDailyRewardGetCalendar);
    logger.info("[DailyRewardCalendar] Module InitModule registered: 1 RPC");
}
