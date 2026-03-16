// retention_v2.js - Streak Repair & Wager System for QuizVerse v3.0
// Extends existing retention module with 2 new RPCs (does NOT modify existing retention RPCs)
// RPCs: streak_repair, streak_wager

/**
 * Streak Repair & Wager System — Production-Ready
 *
 * streak_repair: Pay gems to restore a broken streak (24h window, 3/month max)
 * streak_wager: Bet gems on maintaining your streak (Day 10+ unlock, up to 3x multiplier)
 *
 * Storage: collection="streak_data", key="{userId}_{gameId}"
 * Wallet: Uses nk.walletUpdate for atomic gem deduction/award
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

var STREAK_REPAIR_COST = 100;       // gems
var REPAIR_WINDOW_HOURS = 24;
var MAX_REPAIRS_PER_MONTH = 3;
var WAGER_MIN_STREAK_DAY = 10;
var WAGER_MAX_MULTIPLIER = 3.0;
var WAGER_MIN_AMOUNT = 10;
var WAGER_MAX_AMOUNT = 500;
var STREAK_STORAGE_COLLECTION = 'streak_data';

// ─── HELPERS ────────────────────────────────────────────────────────────────

function streakStorageKey(userId, gameId) {
    return userId + '_' + gameId;
}

function readStreakData(nk, logger, userId, gameId) {
    try {
        var records = nk.storageRead([{
            collection: STREAK_STORAGE_COLLECTION,
            key: streakStorageKey(userId, gameId),
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logger.warn('[StreakV2] Storage read failed: ' + err.message);
    }
    return null;
}

function writeStreakData(nk, logger, userId, gameId, data) {
    try {
        nk.storageWrite([{
            collection: STREAK_STORAGE_COLLECTION,
            key: streakStorageKey(userId, gameId),
            userId: userId,
            value: data,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error('[StreakV2] Storage write failed: ' + err.message);
        return false;
    }
}

function getCurrentMonthKey() {
    var now = new Date();
    return now.getFullYear() + '-' + (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1);
}

function validatePayloadV2(payload) {
    if (!payload || payload === '') return {};
    try {
        return JSON.parse(payload);
    } catch (err) {
        return null;
    }
}

function errorResponseV2(msg) {
    return JSON.stringify({ success: false, error: msg });
}

function generateWagerId() {
    return 'wager_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

// ─── RPC: streak_repair ─────────────────────────────────────────────────────

function rpcStreakRepair(ctx, logger, nk, payload) {
    if (!ctx.userId) return errorResponseV2('User not authenticated');

    var data = validatePayloadV2(payload);
    if (data === null) return errorResponseV2('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var streakData = readStreakData(nk, logger, ctx.userId, gameId);

    if (!streakData) {
        return errorResponseV2('No streak data found. Play a quiz first.');
    }

    // Check if streak is actually broken
    if (!streakData.isBroken) {
        return errorResponseV2('streak_not_broken');
    }

    // Check repair window (24h from break time)
    var brokenAt = new Date(streakData.brokenAt || 0);
    var now = new Date();
    var hoursSinceBroken = (now.getTime() - brokenAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceBroken > REPAIR_WINDOW_HOURS) {
        return errorResponseV2('repair_window_expired');
    }

    // Check monthly limit
    var monthKey = getCurrentMonthKey();
    if (!streakData.repairs) streakData.repairs = {};
    var repairsThisMonth = streakData.repairs[monthKey] || 0;

    if (repairsThisMonth >= MAX_REPAIRS_PER_MONTH) {
        return JSON.stringify({
            success: false,
            error: 'monthly_limit_reached',
            repairsUsedThisMonth: repairsThisMonth,
            maxRepairsPerMonth: MAX_REPAIRS_PER_MONTH,
            resetsAt: (new Date(now.getFullYear(), now.getMonth() + 1, 1)).toISOString()
        });
    }

    // Check wallet balance atomically
    var repairCost = STREAK_REPAIR_COST;
    try {
        // Deduct gems — nk.walletUpdate will fail if insufficient
        var walletResult = nk.walletUpdate(ctx.userId, { gems: -repairCost }, {
            reason: 'streak_repair',
            gameId: gameId,
            streakDay: streakData.currentDay || 0
        }, true);

        // Restore streak
        streakData.isBroken = false;
        streakData.brokenAt = null;
        streakData.repairs[monthKey] = repairsThisMonth + 1;
        streakData.totalRepairs = (streakData.totalRepairs || 0) + 1;
        streakData.lastRepairedAt = now.toISOString();
        streakData.updatedAt = now.toISOString();

        if (!writeStreakData(nk, logger, ctx.userId, gameId, streakData)) {
            // Rollback wallet if storage fails
            try {
                nk.walletUpdate(ctx.userId, { gems: repairCost }, { reason: 'streak_repair_rollback' }, false);
            } catch (rollbackErr) {
                logger.error('[StreakV2] CRITICAL: Rollback failed for ' + ctx.userId + ': ' + rollbackErr.message);
            }
            return errorResponseV2('Failed to save streak data');
        }

        logger.info('[StreakV2] Streak repaired for ' + ctx.userId + ', cost: ' + repairCost + ' gems');

        return JSON.stringify({
            success: true,
            repairCost: repairCost,
            newStreakDay: streakData.currentDay || 0,
            repairsUsedThisMonth: repairsThisMonth + 1,
            maxRepairsPerMonth: MAX_REPAIRS_PER_MONTH,
            repairWindowExpiresAt: new Date(brokenAt.getTime() + REPAIR_WINDOW_HOURS * 3600000).toISOString(),
            timestamp: now.toISOString()
        });

    } catch (walletErr) {
        // Wallet insufficient or other error
        if (walletErr.message && walletErr.message.indexOf('insufficient') !== -1) {
            // Get current balance for error response
            var balance = 0;
            try {
                var account = nk.accountGetId(ctx.userId);
                if (account && account.wallet) {
                    var wallet = JSON.parse(account.wallet);
                    balance = wallet.gems || 0;
                }
            } catch (e) { /* ignore */ }

            return JSON.stringify({
                success: false,
                error: 'insufficient_gems',
                cost: repairCost,
                balance: balance
            });
        }
        logger.error('[StreakV2] Wallet error: ' + walletErr.message);
        return errorResponseV2('Wallet operation failed');
    }
}

// ─── RPC: streak_wager ──────────────────────────────────────────────────────

function rpcStreakWager(ctx, logger, nk, payload) {
    if (!ctx.userId) return errorResponseV2('User not authenticated');

    var data = validatePayloadV2(payload);
    if (data === null) return errorResponseV2('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var action = data.action; // "place" or "resolve"

    if (action !== 'place' && action !== 'resolve') {
        return errorResponseV2('Invalid action. Must be "place" or "resolve".');
    }

    var streakData = readStreakData(nk, logger, ctx.userId, gameId);
    if (!streakData) {
        return errorResponseV2('No streak data found. Play a quiz first.');
    }

    var now = new Date();

    // ─── PLACE WAGER ────────────────────────────────────────────────────
    if (action === 'place') {
        var wagerAmount = parseInt(data.wagerAmount);
        var multiplier = parseFloat(data.multiplier) || 2.0;

        // Validate streak day requirement
        if ((streakData.currentDay || 0) < WAGER_MIN_STREAK_DAY) {
            return JSON.stringify({
                success: false,
                error: 'wager_locked_until_day_10',
                currentDay: streakData.currentDay || 0,
                requiredDay: WAGER_MIN_STREAK_DAY
            });
        }

        // Check for active wager
        if (streakData.activeWager && streakData.activeWager.status === 'active') {
            return JSON.stringify({
                success: false,
                error: 'wager_already_active',
                activeWager: {
                    wagerId: streakData.activeWager.wagerId,
                    amount: streakData.activeWager.amount,
                    multiplier: streakData.activeWager.multiplier,
                    expiresAt: streakData.activeWager.expiresAt
                }
            });
        }

        // Validate wager amount
        if (isNaN(wagerAmount) || wagerAmount < WAGER_MIN_AMOUNT) {
            return errorResponseV2('Minimum wager is ' + WAGER_MIN_AMOUNT + ' gems');
        }
        if (wagerAmount > WAGER_MAX_AMOUNT) {
            return errorResponseV2('Maximum wager is ' + WAGER_MAX_AMOUNT + ' gems');
        }

        // Clamp multiplier
        if (multiplier > WAGER_MAX_MULTIPLIER) multiplier = WAGER_MAX_MULTIPLIER;
        if (multiplier < 1.5) multiplier = 1.5;

        // Check if streak is broken
        if (streakData.isBroken) {
            return errorResponseV2('Cannot wager on a broken streak');
        }

        // Deduct gems
        try {
            nk.walletUpdate(ctx.userId, { gems: -wagerAmount }, {
                reason: 'streak_wager_place',
                gameId: gameId,
                streakDay: streakData.currentDay
            }, true);
        } catch (walletErr) {
            var balance = 0;
            try {
                var account = nk.accountGetId(ctx.userId);
                if (account && account.wallet) {
                    var w = JSON.parse(account.wallet);
                    balance = w.gems || 0;
                }
            } catch (e) { /* ignore */ }

            return JSON.stringify({
                success: false,
                error: 'insufficient_gems',
                cost: wagerAmount,
                balance: balance
            });
        }

        // Create wager
        var wagerId = generateWagerId();
        var tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 23, 59, 59));

        streakData.activeWager = {
            wagerId: wagerId,
            amount: wagerAmount,
            multiplier: multiplier,
            status: 'active',
            placedAt: now.toISOString(),
            expiresAt: tomorrow.toISOString(),
            streakDayAtPlacement: streakData.currentDay
        };
        streakData.updatedAt = now.toISOString();

        if (!writeStreakData(nk, logger, ctx.userId, gameId, streakData)) {
            // Rollback wallet
            try {
                nk.walletUpdate(ctx.userId, { gems: wagerAmount }, { reason: 'streak_wager_rollback' }, false);
            } catch (rollbackErr) {
                logger.error('[StreakV2] CRITICAL: Wager rollback failed for ' + ctx.userId);
            }
            return errorResponseV2('Failed to save wager');
        }

        logger.info('[StreakV2] Wager placed: ' + wagerId + ' by ' + ctx.userId + ' (' + wagerAmount + ' gems x' + multiplier + ')');

        return JSON.stringify({
            success: true,
            wagerId: wagerId,
            wagerAmount: wagerAmount,
            multiplier: multiplier,
            potentialWinnings: Math.round(wagerAmount * multiplier),
            expiresAt: tomorrow.toISOString(),
            gemsDeducted: wagerAmount,
            timestamp: now.toISOString()
        });
    }

    // ─── RESOLVE WAGER ──────────────────────────────────────────────────
    if (action === 'resolve') {
        if (!streakData.activeWager || streakData.activeWager.status !== 'active') {
            return errorResponseV2('No active wager to resolve');
        }

        var wager = streakData.activeWager;

        // Check if quiz completed today
        var lastQuizDate = streakData.lastQuizCompletedAt ? new Date(streakData.lastQuizCompletedAt) : null;
        var todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

        if (!lastQuizDate || lastQuizDate.getTime() < todayStart.getTime()) {
            return errorResponseV2('quiz_not_completed_today');
        }

        // Determine result: did user maintain streak?
        var streakMaintained = !streakData.isBroken && (streakData.currentDay || 0) > (wager.streakDayAtPlacement || 0);
        var result = streakMaintained ? 'won' : 'lost';
        var winnings = 0;

        if (result === 'won') {
            winnings = Math.round(wager.amount * wager.multiplier);
            try {
                nk.walletUpdate(ctx.userId, { gems: winnings }, {
                    reason: 'streak_wager_won',
                    wagerId: wager.wagerId,
                    multiplier: wager.multiplier
                }, false);
            } catch (walletErr) {
                logger.error('[StreakV2] Failed to award wager winnings: ' + walletErr.message);
                return errorResponseV2('Failed to award winnings');
            }
        }

        // Archive wager
        if (!streakData.wagerHistory) streakData.wagerHistory = [];
        var archivedWager = {
            wagerId: wager.wagerId,
            amount: wager.amount,
            multiplier: wager.multiplier,
            result: result,
            winnings: winnings,
            placedAt: wager.placedAt,
            resolvedAt: now.toISOString()
        };
        streakData.wagerHistory.push(archivedWager);

        // Keep only last 50 wagers in history
        if (streakData.wagerHistory.length > 50) {
            streakData.wagerHistory = streakData.wagerHistory.slice(-50);
        }

        streakData.activeWager = null;
        streakData.totalWagers = (streakData.totalWagers || 0) + 1;
        streakData.totalWagersWon = (streakData.totalWagersWon || 0) + (result === 'won' ? 1 : 0);
        streakData.updatedAt = now.toISOString();

        writeStreakData(nk, logger, ctx.userId, gameId, streakData);

        logger.info('[StreakV2] Wager resolved: ' + wager.wagerId + ' = ' + result +
                     (result === 'won' ? ' (+' + winnings + ' gems)' : ''));

        return JSON.stringify({
            success: true,
            wagerId: wager.wagerId,
            result: result,
            wagerAmount: wager.amount,
            multiplier: wager.multiplier,
            winnings: winnings,
            gemsAwarded: result === 'won' ? winnings : 0,
            totalWagers: streakData.totalWagers,
            totalWagersWon: streakData.totalWagersWon,
            timestamp: now.toISOString()
        });
    }
}
