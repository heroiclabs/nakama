// daily_rewards.js - Daily Rewards & Streak System (Per gameId UUID)

/**
 * Reward configurations per gameId UUID
 * This can be extended or moved to storage for dynamic configuration
 */
/**
 * BALANCED DAILY REWARDS CONFIGURATION
 * 
 * Design Philosophy:
 * - Day 1: 40 coins = ~4 QuickPlay games (keeps them playing after free plays)
 * - Day 3: 65 coins = Can afford first Hint power-up (75) with Day 2 leftover (milestone!)
 * - Day 7: 200 coins = Big reward validates loyalty, can afford Extra Life (200)
 * - Weekly total: 660 coins (enough for ~6-8 sessions/day with free plays)
 * 
 * Key metrics:
 * - Creates "slightly short" feeling → drives ad watching & IAP
 * - Never leaves user completely stuck (can always play with free plays + Day 1)
 * - Milestone at Day 3 (first power-up affordable) creates mid-week retention hook
 * - Day 7 jackpot encourages full week completion (4x Day 1 reward)
 */
// QVBF_166: Each row now carries a `game` field (coins — the primary game
// currency displayed in the reward popup and granted to the wallet).
// `tokens` is kept for legacy compatibility but is NOT granted to the wallet.
// The client reads `reward.game` for the coin amount shown in the toast.
// RCA fix (client/server reward mismatch): `game` (the coins actually granted to
// the wallet) was a flat 50/day, contradicting BOTH the balanced-economy design
// doc above (Day 1: 40 … Day 7: 200, weekly total 660) AND the client's canonical
// display table (IVXDailyRewardsManager.DAILY_REWARD_COINS = 40,50,65,80,100,125,200).
// The popup promised the ramp while the wallet received 50. `game` now follows the
// documented ramp, so display == grant on every day.
var REWARD_CONFIGS = {
    // Default rewards for any game - BALANCED FOR ENGAGEMENT + MONETIZATION
    "default": [
        { day: 1, game: 40, xp: 50, tokens: 40, description: "Welcome Back!" },
        { day: 2, game: 50, xp: 75, tokens: 50, description: "Day 2 Reward" },
        { day: 3, game: 65, xp: 100, tokens: 65, description: "Power-Up Unlocked! 💪" },
        { day: 4, game: 80, xp: 150, tokens: 80, description: "Halfway There!" },
        { day: 5, game: 100, xp: 200, tokens: 100, multiplier: "2x XP", description: "Day 5 Bonus! 🔥" },
        { day: 6, game: 125, xp: 275, tokens: 125, description: "Almost There!" },
        { day: 7, game: 200, xp: 400, tokens: 200, nft: "weekly_badge", description: "🎉 Weekly Champion!" }
    ],

    // QuizVerse specific - CORRECT GAME ID
    "126bf539-dae2-4bcf-964d-316c0fa1f92b": [
        { day: 1, game: 40, xp: 50, tokens: 40, description: "Welcome Back!" },
        { day: 2, game: 50, xp: 75, tokens: 50, description: "Day 2 Reward" },
        { day: 3, game: 65, xp: 100, tokens: 65, description: "Power-Up Unlocked! 💪" },
        { day: 4, game: 80, xp: 150, tokens: 80, description: "Halfway There!" },
        { day: 5, game: 100, xp: 200, tokens: 100, multiplier: "2x XP", description: "Day 5 Bonus! 🔥" },
        { day: 6, game: 125, xp: 275, tokens: 125, description: "Almost There!" },
        { day: 7, game: 200, xp: 400, tokens: 200, nft: "weekly_badge", description: "🎉 Weekly Champion!" }
    ]
};

/**
 * UTC day helpers — daily rewards use UTC dates (matches claimHistory writes
 * and LegacyDailyRewards.getTodayDateString). Do not use utils.getStartOfDay
 * here; it uses local timezone.
 */
function pad2Utc(n) {
    return n < 10 ? "0" + n : String(n);
}

function getUtcDateStringFromUnix(ts) {
    var d = new Date(ts * 1000);
    return d.getUTCFullYear() + "-" + pad2Utc(d.getUTCMonth() + 1) + "-" + pad2Utc(d.getUTCDate());
}

function getTodayUtcDateString() {
    var d = new Date();
    return d.getUTCFullYear() + "-" + pad2Utc(d.getUTCMonth() + 1) + "-" + pad2Utc(d.getUTCDate());
}

function getUtcDayStartUnix(ts) {
    var d = new Date(ts * 1000);
    d.setUTCHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
}

function getUtcDayStartUnixFromDateString(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return 0;
    var parts = dateStr.split("-");
    if (parts.length !== 3) return 0;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return 0;
    return Math.floor(Date.UTC(y, m, d, 0, 0, 0, 0) / 1000);
}

function maxUtcDateString(a, b) {
    if (!a) return b || "";
    if (!b) return a || "";
    return a > b ? a : b;
}

/**
 * Reconcile lastClaimTimestamp against claimHistory and legacy daily_rewards
 * storage so eligibility checks use the true most-recent claim date.
 */
function reconcileStreakLastClaim(nk, logger, userId, gameId, data) {
    var effectiveDate = "";
    var changed = false;

    if (data.lastClaimTimestamp > 0) {
        effectiveDate = getUtcDateStringFromUnix(data.lastClaimTimestamp);
    }

    if (data.claimHistory && data.claimHistory.length > 0) {
        var lastHistory = data.claimHistory[data.claimHistory.length - 1];
        effectiveDate = maxUtcDateString(effectiveDate, lastHistory);
    }

    try {
        var tsStatus = utils.readStorage(nk, logger, "daily_rewards", "status_" + userId, userId);
        if (tsStatus) {
            if (tsStatus.lastClaimDate) {
                effectiveDate = maxUtcDateString(effectiveDate, tsStatus.lastClaimDate);
            }
            if (tsStatus.rewards && tsStatus.rewards.length) {
                for (var ri = 0; ri < tsStatus.rewards.length; ri++) {
                    if (tsStatus.rewards[ri] && tsStatus.rewards[ri].date) {
                        effectiveDate = maxUtcDateString(effectiveDate, tsStatus.rewards[ri].date);
                    }
                }
            }
        }
    } catch (reconcileErr) {
        utils.logWarn(logger, "[DailyRewards] Legacy reconcile skipped: " + reconcileErr.message);
    }

    if (effectiveDate) {
        var tsDate = data.lastClaimTimestamp > 0
            ? getUtcDateStringFromUnix(data.lastClaimTimestamp)
            : "";
        if (effectiveDate > tsDate) {
            data.lastClaimTimestamp = getUtcDayStartUnixFromDateString(effectiveDate);
            changed = true;
            utils.logInfo(logger, "[DailyRewards] Reconciled lastClaimTimestamp for " + userId +
                ": " + (tsDate || "none") + " -> " + effectiveDate);
        }
    }

    if (changed) {
        saveStreakData(nk, logger, userId, gameId, data);
    }

    return data;
}

/**
 * Get or create streak data for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @returns {object} Streak data
 */
function getStreakData(nk, logger, userId, gameId) {
    var collection = "daily_streaks";
    var key = utils.makeGameStorageKey("user_daily_streak", userId, gameId);
    
    var data = utils.readStorage(nk, logger, collection, key, userId);
    
    if (!data) {
        // Initialize new streak
        data = {
            userId: userId,
            gameId: gameId,
            currentStreak: 0,
            bestStreak: 0,
            lastClaimTimestamp: 0,
            totalClaims: 0,
            claimHistory: [],
            createdAt: utils.getCurrentTimestamp()
        };

        // QVBF_51 migration: while the TS LegacyDailyRewards handler was
        // (wrongly) serving daily_rewards_claim, it wrote streak state to
        // collection "daily_rewards", key "status_{userId}" as
        // { day, lastClaimDate: "YYYY-MM-DD", streak, rewards[] }.
        // Seed from that record once so those users don't lose their streak.
        try {
            var tsStatus = utils.readStorage(nk, logger, "daily_rewards", "status_" + userId, userId);
            if (tsStatus && tsStatus.streak > 0 && tsStatus.lastClaimDate) {
                var migratedDate = tsStatus.lastClaimDate;
                if (tsStatus.rewards && tsStatus.rewards.length) {
                    for (var mi = 0; mi < tsStatus.rewards.length; mi++) {
                        if (tsStatus.rewards[mi] && tsStatus.rewards[mi].date) {
                            migratedDate = maxUtcDateString(migratedDate, tsStatus.rewards[mi].date);
                        }
                    }
                }
                var migratedTs = getUtcDayStartUnixFromDateString(migratedDate);
                if (migratedTs > 0) {
                    data.currentStreak = tsStatus.streak;
                    data.bestStreak = tsStatus.streak;
                    data.lastClaimTimestamp = migratedTs;
                    data.totalClaims = (tsStatus.rewards && tsStatus.rewards.length) || tsStatus.streak;
                    if (tsStatus.rewards && tsStatus.rewards.length) {
                        for (var ri = 0; ri < tsStatus.rewards.length && ri < 90; ri++) {
                            if (tsStatus.rewards[ri] && tsStatus.rewards[ri].date) {
                                data.claimHistory.push(tsStatus.rewards[ri].date);
                            }
                        }
                    }
                    utils.logInfo(logger, "[DailyRewards] Migrated TS-legacy streak for " + userId + ": streak=" + tsStatus.streak);
                }
            }
        } catch (migErr) {
            utils.logWarn(logger, "[DailyRewards] TS-legacy migration skipped: " + migErr.message);
        }
    }

    // Backfill fields for records created before QVBF_51
    if (typeof data.bestStreak !== "number") data.bestStreak = data.currentStreak || 0;
    if (!data.claimHistory) data.claimHistory = [];

    data = reconcileStreakLastClaim(nk, logger, userId, gameId, data);

    return data;
}

/**
 * Save streak data
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {object} data - Streak data to save
 * @returns {boolean} Success status
 */
function saveStreakData(nk, logger, userId, gameId, data) {
    var collection = "daily_streaks";
    var key = utils.makeGameStorageKey("user_daily_streak", userId, gameId);
    return utils.writeStorage(nk, logger, collection, key, userId, data);
}

/**
 * OCC support (double-claim fix): raw read that also returns the storage object
 * version, so the claim path can do a CONDITIONAL write. utils.readStorage
 * discards the version, which forced blind writes — two concurrent
 * daily_rewards_claim calls (double-tap, two devices, client retry) both passed
 * canClaimToday and both granted the wallet.
 */
function readStreakRawWithVersion(nk, userId, gameId) {
    var key = utils.makeGameStorageKey("user_daily_streak", userId, gameId);
    var objects = nk.storageRead([{ collection: "daily_streaks", key: key, userId: userId }]);
    if (objects && objects.length > 0 && objects[0].value) {
        return { value: objects[0].value, version: objects[0].version };
    }
    // "*" = Nakama conditional create: write succeeds only if the key does not exist yet.
    return { value: null, version: "*" };
}

/**
 * Conditional write — succeeds only if the record still has the version we read.
 * Returns false on version conflict (a concurrent claim won the race).
 */
function saveStreakDataVersioned(nk, logger, userId, gameId, data, version) {
    var key = utils.makeGameStorageKey("user_daily_streak", userId, gameId);
    try {
        nk.storageWrite([{
            collection: "daily_streaks",
            key: key,
            userId: userId,
            value: data,
            version: version,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        utils.logWarn(logger, "[DailyRewards] Versioned write rejected for " + userId +
            " (concurrent claim?): " + err.message);
        return false;
    }
}

/**
 * Check if user can claim reward today
 * @param {object} streakData - Current streak data
 * @returns {object} { canClaim: boolean, reason: string }
 */
function canClaimToday(streakData) {
    var lastClaim = streakData.lastClaimTimestamp;

    // First claim ever
    if (lastClaim === 0) {
        return { canClaim: true, reason: "first_claim" };
    }

    var lastDate = getUtcDateStringFromUnix(lastClaim);
    var today = getTodayUtcDateString();

    if (lastDate === today) {
        return { canClaim: false, reason: "already_claimed_today" };
    }

    return { canClaim: true, reason: "eligible" };
}

/**
 * Update streak status based on time elapsed; persist when streak breaks.
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {object} streakData - Current streak data
 * @returns {object} Updated streak data
 */
function updateStreakStatus(nk, logger, userId, gameId, streakData) {
    var now = utils.getUnixTimestamp();
    var lastClaim = streakData.lastClaimTimestamp;
    
    // First claim
    if (lastClaim === 0) {
        return streakData;
    }
    
    // Check if more than 48 hours passed (streak broken)
    if (!utils.isWithinHours(lastClaim, now, 48)) {
        if (streakData.currentStreak !== 0) {
            streakData.currentStreak = 0;
            saveStreakData(nk, logger, userId, gameId, streakData);
        }
    }
    
    return streakData;
}

/**
 * Get reward configuration for current day
 * @param {string} gameId - Game ID
 * @param {number} day - Streak day (1-7)
 * @returns {object} Reward configuration
 */
function getRewardForDay(gameId, day) {
    var config = REWARD_CONFIGS[gameId] || REWARD_CONFIGS["default"];
    var rewardDay = ((day - 1) % 7) + 1; // Cycle through 1-7
    
    for (var i = 0; i < config.length; i++) {
        if (config[i].day === rewardDay) {
            return config[i];
        }
    }
    
    // Fallback to day 1 if not found
    return config[0];
}

/**
 * RPC: Get daily reward status
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 * @returns {string} JSON response
 */
function rpcDailyRewardsGetStatus(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC daily_rewards_get_status called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!utils.isValidUUID(gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    // Get current streak data
    var streakData = getStreakData(nk, logger, userId, gameId);
    streakData = updateStreakStatus(nk, logger, userId, gameId, streakData);
    
    // Check if can claim
    var claimCheck = canClaimToday(streakData);
    
    // Get next reward info
    var nextDay = streakData.currentStreak + 1;
    var nextReward = getRewardForDay(gameId, nextDay);
    
    // QVBF_166: field names must match C# DailyRewardStatus [JsonProperty] attributes.
    // C# model maps "streak" → currentStreak, "canClaim" → canClaimToday.
    // Keep legacy aliases alongside for any old clients still in the wild.
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        streak: streakData.currentStreak,          // canonical — C# [JsonProperty("streak")]
        currentStreak: streakData.currentStreak,   // legacy alias
        bestStreak: streakData.bestStreak || 0,    // QVBF_51: lifetime best for dashboard
        totalClaims: streakData.totalClaims,
        lastClaimTimestamp: streakData.lastClaimTimestamp,
        canClaim: claimCheck.canClaim,             // canonical — C# [JsonProperty("canClaim")]
        canClaimToday: claimCheck.canClaim,        // legacy alias
        claimReason: claimCheck.reason,
        nextReward: nextReward,
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Claim daily reward
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 * @returns {string} JSON response
 */
/**
 * DAILY PROGRESSION PLATFORM — single claim core.
 *
 * This is the ONLY implementation of "claim today's daily reward" in the entire
 * backend. Every claim RPC (canonical `daily_rewards_claim`, the consolidated
 * `daily_progress_claim`, and the legacy Arcade `quizverse_claim_daily_reward`)
 * MUST delegate here. Do not fork this logic.
 *
 * Returns:
 *   { ok: true,  streakData, reward, walletGranted }
 *   { ok: false, error, reason }
 */
function performDailyClaim(nk, logger, userId, gameId) {
    // Get current streak data (runs migration/reconcile side-effects up front so
    // the versioned read below sees a settled record).
    var streakData = getStreakData(nk, logger, userId, gameId);
    streakData = updateStreakStatus(nk, logger, userId, gameId, streakData);

    // Fast pre-check (cheap rejection before the OCC loop).
    var claimCheck = canClaimToday(streakData);
    if (!claimCheck.canClaim) {
        return { ok: false, error: "Cannot claim reward: " + claimCheck.reason, reason: claimCheck.reason };
    }

    // ── ATOMIC CLAIM (OCC / double-claim fix) ────────────────────────────────
    // The old path did read → check → walletUpdate → blind write. Two concurrent
    // claims (double-tap, second device, client retry after timeout) both passed
    // the check and BOTH granted coins. Now: re-read WITH the storage version,
    // re-verify eligibility on that exact snapshot, mutate, and commit with a
    // CONDITIONAL write. If a concurrent claim committed first, the write fails,
    // we re-read, see lastClaim == today, and reject with "already claimed" —
    // making retries idempotent and duplicate grants impossible.
    var reward = null;
    var committed = false;
    for (var attempt = 0; attempt < 2 && !committed; attempt++) {
        var raw = readStreakRawWithVersion(nk, userId, gameId);
        // Fall back to the settled copy when the record does not exist yet
        // (version "*" makes the write a conditional create).
        var claimState = raw.value || streakData;
        if (typeof claimState.bestStreak !== "number") claimState.bestStreak = claimState.currentStreak || 0;
        if (!claimState.claimHistory) claimState.claimHistory = [];

        var recheck = canClaimToday(claimState);
        if (!recheck.canClaim) {
            return { ok: false, error: "Cannot claim reward: " + recheck.reason, reason: recheck.reason };
        }

        // Reset streak when gap spans more than one UTC day or exceeds 48h grace
        // (matches LegacyDailyRewards dayDiff > 1 rule before increment).
        var lastClaimTs = claimState.lastClaimTimestamp || 0;
        if (lastClaimTs > 0) {
            var lastDate = getUtcDateStringFromUnix(lastClaimTs);
            var today = getTodayUtcDateString();
            var lastDayStart = getUtcDayStartUnixFromDateString(lastDate);
            var todayDayStart = getUtcDayStartUnixFromDateString(today);
            var dayDiff = Math.floor((todayDayStart - lastDayStart) / 86400);
            if (dayDiff > 1 || !utils.isWithinHours(lastClaimTs, utils.getUnixTimestamp(), 48)) {
                claimState.currentStreak = 0;
            }
        }

        // Update streak
        claimState.currentStreak = (claimState.currentStreak || 0) + 1;
        claimState.lastClaimTimestamp = utils.getUnixTimestamp();
        claimState.totalClaims = (claimState.totalClaims || 0) + 1;
        claimState.updatedAt = utils.getCurrentTimestamp();

        // QVBF_51: track lifetime best streak for the dashboard "Best Streak" card
        if (claimState.currentStreak > (claimState.bestStreak || 0)) {
            claimState.bestStreak = claimState.currentStreak;
        }

        // QVBF_51: append claim date (UTC YYYY-MM-DD) for the activity heatmap.
        // Capped at 90 entries (~3 months) to keep the storage record small.
        var claimDate = new Date(claimState.lastClaimTimestamp * 1000);
        var claimDateStr = claimDate.getUTCFullYear() + "-" +
            (claimDate.getUTCMonth() + 1 < 10 ? "0" : "") + (claimDate.getUTCMonth() + 1) + "-" +
            (claimDate.getUTCDate() < 10 ? "0" : "") + claimDate.getUTCDate();
        if (claimState.claimHistory[claimState.claimHistory.length - 1] !== claimDateStr) {
            claimState.claimHistory.push(claimDateStr);
            while (claimState.claimHistory.length > 90) {
                claimState.claimHistory.shift();
            }
        }

        reward = getRewardForDay(gameId, claimState.currentStreak);

        if (saveStreakDataVersioned(nk, logger, userId, gameId, claimState, raw.version)) {
            committed = true;
            streakData = claimState;
        }
        // On conflict: loop re-reads the fresh record; the recheck above then
        // returns "already_claimed_today" if the concurrent claim was today's.
    }

    if (!committed) {
        return { ok: false, error: "Failed to save streak data (concurrent update)", reason: "concurrent_update" };
    }

    // Log reward claim for transaction history
    var transactionKey = "transaction_log_" + userId + "_" + utils.getUnixTimestamp();
    var transactionData = {
        userId: userId,
        gameId: gameId,
        type: "daily_reward_claim",
        day: streakData.currentStreak,
        reward: reward,
        timestamp: utils.getCurrentTimestamp()
    };
    utils.writeStorage(nk, logger, "transaction_logs", transactionKey, userId, transactionData);

    utils.logInfo(logger, "User " + userId + " claimed day " + streakData.currentStreak + " reward for game " + gameId);

    // QVBF_166: Grant `game` (coins) to the wallet using the `game` currency key.
    // Previously mapped tokens→coins which was wrong when `game` and `tokens` differ.
    var walletChanges = {};
    if (reward.game) walletChanges.game = reward.game;
    if (reward.xp)   walletChanges.xp   = reward.xp;
    if (Object.keys(walletChanges).length > 0) {
        try {
            nk.walletUpdate(userId, walletChanges, { source: "daily_reward", day: streakData.currentStreak, gameId: gameId }, true);
            logger.info("[DailyRewards] Granted wallet: " + JSON.stringify(walletChanges) + " to " + userId);
        } catch (walletErr) {
            logger.error("[DailyRewards] Wallet grant failed: " + walletErr.message);
        }
    }

    return { ok: true, streakData: streakData, reward: reward, walletGranted: walletChanges };
}

/**
 * RPC: Claim daily reward (LEGACY-COMPATIBLE WRAPPER).
 * Thin shell over performDailyClaim — keeps the response shape shipped clients
 * expect. New clients should use `daily_progress_claim` (daily_progress.js),
 * which returns the full progression state in the same round-trip.
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 */
function rpcDailyRewardsClaim(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC daily_rewards_claim called");

    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }

    var gameId = data.gameId;
    if (!utils.isValidUUID(gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }

    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }

    var result = performDailyClaim(nk, logger, userId, gameId);
    if (!result.ok) {
        return JSON.stringify({
            success: false,
            error: result.error,
            canClaimToday: false
        });
    }

    // QVBF_166: emit both `streak`/`newStreak` so C# DailyRewardClaim
    // [JsonProperty("streak")] → newStreak deserializes the correct value.
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        streak: result.streakData.currentStreak,        // canonical — C# [JsonProperty("streak")] → newStreak
        newStreak: result.streakData.currentStreak,     // legacy alias
        currentStreak: result.streakData.currentStreak, // extra alias for safety
        bestStreak: result.streakData.bestStreak || 0,  // QVBF_51: lifetime best
        totalClaims: result.streakData.totalClaims,
        reward: result.reward,
        walletGranted: result.walletGranted,
        claimedAt: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Get claim history (QVBF_51 — feeds the Streak Dashboard activity
 * heatmap and Best Streak card).
 * @param {string} payload - JSON payload with { gameId: "uuid" }
 * @returns {string} JSON response with claimHistory (UTC YYYY-MM-DD, max 90)
 */
function rpcDailyRewardsGetHistory(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC daily_rewards_get_history called");

    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }

    var gameId = data.gameId;
    if (!utils.isValidUUID(gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }

    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }

    var streakData = getStreakData(nk, logger, userId, gameId);
    streakData = updateStreakStatus(nk, logger, userId, gameId, streakData);

    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        currentStreak: streakData.currentStreak,
        bestStreak: streakData.bestStreak || 0,
        totalClaims: streakData.totalClaims,
        claimHistory: streakData.claimHistory || [],
        timestamp: utils.getCurrentTimestamp()
    });
}

// ============================================================================
// Registration (QVBF_51)
// ============================================================================
// postbuild.js renames this `InitModule` -> `__ModuleInit_N` so it never
// executes directly. Its purpose is to expose literal registerRpc calls so
// postbuild can:
//   1) detect the RPC ids and create __rpc_* stub variables
//   2) rewrite each call into a guarded `__rpc_id = __rpc_id || handler`
//   3) replay those assignments at global scope BEFORE legacy fallbacks
//      (modules-first ordering), so THESE handlers win the stub race
//   4) emit `initializer.registerRpc("<id>", __rpc_<id>)` in the master InitModule
//
// Before this block existed, daily_rewards_get_status / daily_rewards_claim
// were silently served by the stale TS LegacyDailyRewards copy (wrong response
// envelope -> Unity always saw streak 0; root cause of QVBF_51).
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("daily_rewards_get_status", rpcDailyRewardsGetStatus);
    initializer.registerRpc("daily_rewards_claim", rpcDailyRewardsClaim);
    initializer.registerRpc("daily_rewards_get_history", rpcDailyRewardsGetHistory);
    logger.info("[DailyRewards] Module InitModule registered: 3 RPCs");
}
