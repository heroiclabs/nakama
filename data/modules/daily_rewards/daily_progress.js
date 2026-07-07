// daily_progress.js — DAILY PROGRESSION PLATFORM (consolidated surface)
//
// This module is the OFFICIAL client-facing surface for daily login rewards,
// login streaks, the streak dashboard, calendar, shield/freeze state, and any
// future daily-progression feature. It exposes exactly TWO production RPCs:
//
//   1. daily_progress_check — one request returns EVERYTHING the client needs:
//      streak, claim eligibility, countdown/next reset, next reward, 7-day
//      reward table, 30-day calendar + milestones, claim history, shield state,
//      server UTC time, and a payload version.
//
//   2. daily_progress_claim — validates, performs the ATOMIC/IDEMPOTENT claim
//      (delegating to performDailyClaim in daily_rewards.js — the single claim
//      core), and returns the SAME full state as check so the client never
//      needs a follow-up refresh RPC.
//
// SINGLE SOURCE OF TRUTH RULES:
//   - Streak storage:      daily_streaks / user_daily_streak (daily_rewards.js)
//   - Claim core:          performDailyClaim (daily_rewards.js) — OCC versioned
//   - Eligibility:         canClaimToday (daily_rewards.js) — UTC day window
//   - Reward table:        REWARD_CONFIGS (daily_rewards.js)
//   - Calendar config:     CALENDAR_REWARD_CONFIGS (daily_reward_calendar.js)
//   - Shield storage:      streak_shield / shield (legacy_runtime.js retention)
//
// The legacy RPCs (daily_rewards_get_status/claim/get_history,
// daily_reward_get_calendar, quizverse_claim_daily_reward) remain registered
// ONLY for already-shipped clients and all delegate to the same core functions.
// Do not add new callers to them.

var DAILY_PROGRESS_VERSION = 1;
var DP_QUIZVERSE_GAME_ID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";

/**
 * Accepts gameId under any historical alias (gameId / gameID / game_id) and
 * normalizes non-UUID slugs to the QuizVerse UUID so legacy Arcade payloads
 * ("quizverse") resolve to the SAME streak record as the main game.
 */
function dpResolveGameId(data) {
    var raw = (data && (data.gameId || data.gameID || data.game_id)) || "";
    if (raw && utils.isValidUUID(raw)) return raw;
    return DP_QUIZVERSE_GAME_ID;
}

/** Next UTC midnight (the daily reset) as ISO string + seconds remaining. */
function dpNextReset() {
    var d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    var resetUnix = Math.floor(d.getTime() / 1000);
    return {
        nextResetUtc: d.toISOString(),
        countdownSeconds: Math.max(0, resetUnix - Math.floor(Date.now() / 1000))
    };
}

/**
 * Read streak shield state (retention system, legacy_runtime.js storage:
 * collection "streak_shield", key "shield", ms-epoch expiryTime).
 * Fail-open to "no shield" — shield display must never break the check RPC.
 */
function dpReadShield(nk, logger, userId) {
    try {
        var rows = nk.storageRead([{ collection: "streak_shield", key: "shield", userId: userId }]);
        if (rows && rows.length > 0 && rows[0].value) {
            var s = rows[0].value;
            var nowMs = Date.now();
            var active = !!s.isActive && (s.expiryTime || 0) > nowMs;
            return {
                isActive: active,
                expiryUnix: active ? Math.floor(s.expiryTime / 1000) : 0,
                hoursRemaining: active ? Math.ceil((s.expiryTime - nowMs) / 3600000) : 0
            };
        }
    } catch (e) {
        utils.logWarn(logger, "[DailyProgress] Shield read skipped: " + e.message);
    }
    return { isActive: false, expiryUnix: 0, hoursRemaining: 0 };
}

/**
 * Build the 30-day calendar view + milestones from ALREADY-RESOLVED streak
 * state. Extracted from rpcDailyRewardGetCalendar so the legacy calendar RPC
 * and daily_progress_check share ONE implementation (the legacy copy also had
 * a local-timezone eligibility bug and hand-rolled storage keys — both gone:
 * callers now resolve state via the canonical getStreakData/canClaimToday).
 */
function buildDailyRewardCalendarView(gameId, currentStreak, canClaim) {
    var config = getCalendarConfig(gameId);
    var calendar = [];
    var milestones = [];
    var totalTokens = 0;
    var totalXp = 0;

    for (var day = 1; day <= 30; day++) {
        var dayConfig = null;
        for (var c = 0; c < config.length; c++) {
            if (config[c].day === day) { dayConfig = config[c]; break; }
        }
        if (!dayConfig) {
            var weekDay = ((day - 1) % 7);
            var base = config[weekDay] || config[0];
            var weekNum = Math.floor((day - 1) / 7) + 1;
            dayConfig = {
                day: day,
                xp: Math.round(base.xp * (1 + (weekNum - 1) * 0.15)),
                tokens: Math.round(base.tokens * (1 + (weekNum - 1) * 0.15)),
                name: base.name,
                tier: base.tier,
                icon: base.icon
            };
        }

        totalTokens += dayConfig.tokens || 0;
        totalXp += dayConfig.xp || 0;

        var status = 'locked';
        if (day <= currentStreak) {
            status = 'claimed';
        } else if (day === currentStreak + 1 && canClaim) {
            status = 'available';
        } else if (day === currentStreak + 1 && !canClaim) {
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

    return { calendar: calendar, milestones: milestones, totalTokens30: totalTokens, totalXp30: totalXp };
}

/**
 * Assemble the FULL daily-progression state — the single response body used by
 * both production RPCs. Flat legacy aliases (streak / currentStreak / canClaim
 * / canClaimToday / lastClaimTimestamp / totalClaims / nextReward /
 * claimHistory / bestStreak) are preserved so every shipped C# model
 * deserializes this payload without change.
 */
function buildDailyProgressState(nk, logger, userId, gameId) {
    var streakData = getStreakData(nk, logger, userId, gameId);
    streakData = updateStreakStatus(nk, logger, userId, gameId, streakData);

    var claimCheck = canClaimToday(streakData);
    var nextReward = getRewardForDay(gameId, streakData.currentStreak + 1);
    var rewardTable = REWARD_CONFIGS[gameId] || REWARD_CONFIGS["default"];
    var cal = buildDailyRewardCalendarView(gameId, streakData.currentStreak, claimCheck.canClaim);
    var shield = dpReadShield(nk, logger, userId);
    var reset = dpNextReset();

    return {
        // ── envelope ──
        v: DAILY_PROGRESS_VERSION,
        serverTimeUtc: new Date().toISOString(),
        serverUnix: Math.floor(Date.now() / 1000),
        userId: userId,
        gameId: gameId,

        // ── streak (flat legacy aliases kept) ──
        streak: streakData.currentStreak,
        currentStreak: streakData.currentStreak,
        bestStreak: streakData.bestStreak || 0,
        totalClaims: streakData.totalClaims || 0,
        lastClaimTimestamp: streakData.lastClaimTimestamp || 0,

        // ── claim eligibility ──
        canClaim: claimCheck.canClaim,
        canClaimToday: claimCheck.canClaim,
        claimReason: claimCheck.reason,
        nextResetUtc: reset.nextResetUtc,
        countdownSeconds: reset.countdownSeconds,

        // ── rewards ──
        nextReward: nextReward,
        rewardTable: rewardTable,

        // ── calendar / history ──
        calendar: cal.calendar,
        milestones: cal.milestones,
        claimHistory: streakData.claimHistory || [],

        // ── shield / freeze ──
        shield: shield
    };
}

/** Shared payload validation for both production RPCs. */
function dpValidate(ctx, payload) {
    var parsed = utils.safeJsonParse(payload || "{}");
    if (!parsed.success) return { error: "Invalid JSON payload" };
    if (!ctx.userId) return { error: "User not authenticated" };
    return { data: parsed.data || {}, userId: ctx.userId };
}

/**
 * RPC 1: daily_progress_check
 * One request → everything the client UI needs.
 * Payload: { gameId?: "uuid" } (defaults to QuizVerse)
 */
function rpcDailyProgressCheck(ctx, logger, nk, payload) {
    var v = dpValidate(ctx, payload);
    if (v.error) return JSON.stringify({ success: false, error: v.error });

    var gameId = dpResolveGameId(v.data);
    var state = buildDailyProgressState(nk, logger, v.userId, gameId);
    state.success = true;
    return JSON.stringify(state);
}

/**
 * RPC 2: daily_progress_claim
 * Atomic + idempotent claim (OCC versioned write via performDailyClaim), then
 * returns the FULL refreshed state — no follow-up RPC required. On rejection
 * the CURRENT full state is still included so the client can resync instantly.
 * Payload: { gameId?: "uuid" }
 */
function rpcDailyProgressClaim(ctx, logger, nk, payload) {
    var v = dpValidate(ctx, payload);
    if (v.error) return JSON.stringify({ success: false, error: v.error });

    var gameId = dpResolveGameId(v.data);
    var result = performDailyClaim(nk, logger, v.userId, gameId);

    var state = buildDailyProgressState(nk, logger, v.userId, gameId);

    if (!result.ok) {
        state.success = false;
        state.error = result.error;
        state.claimRejectedReason = result.reason;
        return JSON.stringify(state);
    }

    state.success = true;
    // Claim result block + flat legacy aliases used by the shipped
    // C# DailyRewardClaim model ([JsonProperty("streak")] → newStreak, reward).
    state.reward = result.reward;
    state.walletGranted = result.walletGranted;
    state.newStreak = result.streakData.currentStreak;
    state.claimedAt = utils.getCurrentTimestamp();
    return JSON.stringify(state);
}

// ============================================================================
// Registration — postbuild.js renames InitModule → __ModuleInit_N and wires the
// literal registerRpc calls into the master InitModule (see daily_rewards.js).
// ============================================================================
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("daily_progress_check", rpcDailyProgressCheck);
    initializer.registerRpc("daily_progress_claim", rpcDailyProgressClaim);
    logger.info("[DailyProgress] Platform registered: 2 RPCs (check, claim)");
}
