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
 * RPC: daily_reward_get_calendar
 * Returns the full 30-day reward calendar with claimed/unclaimed status per day.
 */
function rpcDailyRewardGetCalendar(ctx, logger, nk, payload) {
    logger.info('[DailyRewardCalendar] daily_reward_get_calendar called');

    try {
        if (!ctx.userId) {
            return JSON.stringify({ success: false, error: 'Authentication required' });
        }

        var data = JSON.parse(payload || '{}');
        var gameId = data.game_id || data.gameId || 'default';
        var userId = ctx.userId;

        // Get the player's current streak data from the daily_streaks collection
        var streakData = null;
        try {
            var streakKey = gameId + '_user_daily_streak_' + userId;
            var records = nk.storageRead([{
                collection: 'daily_streaks',
                key: streakKey,
                userId: userId
            }]);
            if (records && records.length > 0) {
                streakData = records[0].value;
            }
        } catch (e) {
            logger.warn('[DailyRewardCalendar] Could not read streak data: ' + e.message);
        }

        // Also try the alternate key pattern
        if (!streakData) {
            try {
                var altKey = 'user_daily_streak_' + userId + '_' + gameId;
                var altRecords = nk.storageRead([{
                    collection: 'daily_streaks',
                    key: altKey,
                    userId: userId
                }]);
                if (altRecords && altRecords.length > 0) {
                    streakData = altRecords[0].value;
                }
            } catch (e) { /* no streak yet */ }
        }

        var currentStreak = streakData ? (streakData.currentStreak || 0) : 0;
        var lastClaimTimestamp = streakData ? (streakData.lastClaimTimestamp || 0) : 0;
        var totalClaims = streakData ? (streakData.totalClaims || 0) : 0;

        // Check if they can claim today
        var canClaimToday = true;
        if (lastClaimTimestamp > 0) {
            var lastClaimDate = new Date(lastClaimTimestamp * 1000);
            var today = new Date();
            lastClaimDate.setHours(0, 0, 0, 0);
            today.setHours(0, 0, 0, 0);
            if (lastClaimDate.getTime() === today.getTime()) {
                canClaimToday = false;
            }
            // Check streak break (>48h)
            var nowUnix = Math.floor(Date.now() / 1000);
            if ((nowUnix - lastClaimTimestamp) > 48 * 3600) {
                currentStreak = 0;
            }
        }

        // Build 30-day calendar
        var config = getCalendarConfig(gameId);
        var calendar = [];
        var totalTokens = 0;
        var totalXp = 0;

        for (var day = 1; day <= 30; day++) {
            var dayConfig = null;
            for (var c = 0; c < config.length; c++) {
                if (config[c].day === day) {
                    dayConfig = config[c];
                    break;
                }
            }

            if (!dayConfig) {
                // Fallback: cycle week 1 rewards with scaling
                var weekDay = ((day - 1) % 7);
                dayConfig = config[weekDay] || config[0];
                var weekNum = Math.floor((day - 1) / 7) + 1;
                dayConfig = {
                    day: day,
                    xp: Math.round(dayConfig.xp * (1 + (weekNum - 1) * 0.15)),
                    tokens: Math.round(dayConfig.tokens * (1 + (weekNum - 1) * 0.15)),
                    name: dayConfig.name,
                    tier: dayConfig.tier,
                    icon: dayConfig.icon
                };
            }

            totalTokens += dayConfig.tokens || 0;
            totalXp += dayConfig.xp || 0;

            var status = 'locked';
            if (day <= currentStreak) {
                status = 'claimed';
            } else if (day === currentStreak + 1 && canClaimToday) {
                status = 'available';
            } else if (day === currentStreak + 1 && !canClaimToday) {
                status = 'claimed_today';
            }

            calendar.push({
                day: day,
                name: dayConfig.name,
                tier: dayConfig.tier || 'common',
                icon: dayConfig.icon || 'coin_stack',
                rewards: {
                    xp: dayConfig.xp || 0,
                    tokens: dayConfig.tokens || 0,
                    multiplier: dayConfig.multiplier || null,
                    bonus: dayConfig.bonus || null
                },
                status: status
            });
        }

        // Milestones summary
        var milestones = [];
        for (var m = 0; m < config.length; m++) {
            if (config[m].tier === 'rare' || config[m].tier === 'epic' || config[m].tier === 'legendary') {
                milestones.push({
                    day: config[m].day,
                    name: config[m].name,
                    tier: config[m].tier,
                    reached: config[m].day <= currentStreak
                });
            }
        }

        return JSON.stringify({
            success: true,
            user_id: userId,
            game_id: gameId,
            current_streak: currentStreak,
            total_claims: totalClaims,
            can_claim_today: canClaimToday,
            calendar: calendar,
            milestones: milestones,
            totals: {
                total_tokens_30_days: totalTokens,
                total_xp_30_days: totalXp,
                claimed_tokens: 0,
                claimed_xp: 0
            },
            streak_status: currentStreak === 0 ? 'new' : (canClaimToday ? 'active' : 'claimed_today'),
            next_milestone: null
        });

    } catch (err) {
        logger.error('[DailyRewardCalendar] Error: ' + err.message);
        logRpcError(nk, logger, 'daily_reward_get_calendar', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}
