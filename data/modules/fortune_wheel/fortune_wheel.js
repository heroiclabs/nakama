/**
 * fortune_wheel.js — Fortune Wheel Backend (every 3 days)
 * RPCs: fortune_wheel_get_state, fortune_wheel_spin
 * 
 * SERVER-AUTHORITATIVE: Server picks the random reward — client only animates.
 * Storage: fortune_wheel/state per user
 * Rewards: XP, Coins (wallet), AudiobookToken (storage), Shield (storage), Gems (wallet)
 */

var COOLDOWN_DAYS = 3;

// Wheel segments with probability weights — SERVER is source of truth
var SEGMENTS = [
    { type: "XP",             amount: 100,  label: "100 XP",            weight: 20 },
    { type: "Coins",          amount: 50,   label: "50 Coins",          weight: 25 },
    { type: "XP",             amount: 250,  label: "250 XP",            weight: 15 },
    { type: "AudiobookToken", amount: 1,    label: "Audiobook Token",   weight: 8  },
    { type: "Coins",          amount: 150,  label: "150 Coins",         weight: 12 },
    { type: "Shield",         amount: 24,   label: "24h Shield",        weight: 10 },
    { type: "XP",             amount: 500,  label: "500 XP",            weight: 5  },
    { type: "AudiobookToken", amount: 2,    label: "2 Audiobook Tokens",weight: 5  }
];

// ===== RPCs =====

// fortune_wheel_get_state — Get current wheel state + segments for client rendering
var fortuneWheelGetState = function(ctx, logger, nk, payload) {
    try {
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "Not authenticated" });
        }

        var state = getWheelState(nk, userId);
        var canSpin = canUserSpin(state);

        return JSON.stringify({
            success: true,
            canSpin: canSpin,
            nextSpinTime: state.nextSpinTime || null,
            totalSpins: state.totalSpins || 0,
            lastReward: state.lastReward || null,
            cooldownDays: COOLDOWN_DAYS,
            segments: SEGMENTS.map(function(s) {
                return { type: s.type, amount: s.amount, label: s.label };
            })
        });
    } catch (e) {
        logger.error("fortune_wheel_get_state error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
};

// fortune_wheel_spin — SERVER picks reward, grants it, returns result
var fortuneWheelSpin = function(ctx, logger, nk, payload) {
    try {
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "Not authenticated" });
        }

        var state = getWheelState(nk, userId);

        // Cooldown check — server-authoritative
        if (!canUserSpin(state)) {
            return JSON.stringify({
                success: false,
                error: "On cooldown",
                nextSpinTime: state.nextSpinTime,
                canSpin: false
            });
        }

        // SERVER picks the reward (weighted random) — client has NO say
        var segmentIndex = getWeightedRandomIndex();
        var reward = SEGMENTS[segmentIndex];

        // Grant rewards server-side
        grantReward(nk, userId, reward.type, reward.amount, logger);

        // Update state
        var now = new Date();
        var nextSpin = new Date(now.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);

        state.nextSpinTime = nextSpin.toISOString();
        state.totalSpins = (state.totalSpins || 0) + 1;
        state.lastReward = {
            type: reward.type,
            amount: reward.amount,
            label: reward.label,
            segmentIndex: segmentIndex,
            timestamp: now.toISOString()
        };
        state.history = state.history || [];
        state.history.push(state.lastReward);
        // Keep last 120 entries (~1 year at every-3-day spins)
        if (state.history.length > 120) state.history = state.history.slice(-120);

        saveWheelState(nk, userId, state);

        logger.info("fortune_wheel_spin: " + userId + " won segment " + segmentIndex + " → " + reward.label);

        return JSON.stringify({
            success: true,
            segmentIndex: segmentIndex,
            reward: {
                type: reward.type,
                amount: reward.amount,
                label: reward.label
            },
            nextSpinTime: state.nextSpinTime,
            totalSpins: state.totalSpins
        });
    } catch (e) {
        logger.error("fortune_wheel_spin error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
};

// ===== HELPERS =====

function getWheelState(nk, userId) {
    try {
        var objects = nk.storageRead([{
            collection: "fortune_wheel",
            key: "state",
            userId: userId
        }]);
        if (objects && objects.length > 0) {
            return objects[0].value || {};
        }
    } catch(e) { /* first time user */ }
    return {};
}

function saveWheelState(nk, userId, state) {
    try {
        nk.storageWrite([{
            collection: "fortune_wheel",
            key: "state",
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch(e) {
        // Log but don't throw — state save failure shouldn't crash the spin
        // The reward is already granted; next spin will recalculate cooldown
    }
}

function canUserSpin(state) {
    if (!state.nextSpinTime) return true;
    var nextSpin = new Date(state.nextSpinTime);
    return new Date() >= nextSpin;
}

/**
 * Server-side weighted random selection.
 * Mirrors client segment order so segmentIndex maps directly to UI slice.
 */
function getWeightedRandomIndex() {
    var totalWeight = 0;
    for (var i = 0; i < SEGMENTS.length; i++) {
        totalWeight += SEGMENTS[i].weight;
    }

    var roll = Math.floor(Math.random() * totalWeight);
    var cumulative = 0;

    for (var i = 0; i < SEGMENTS.length; i++) {
        cumulative += SEGMENTS[i].weight;
        if (roll < cumulative) return i;
    }
    return SEGMENTS.length - 1; // Fallback
}

function grantReward(nk, userId, rewardType, amount, logger) {
    switch (rewardType) {
        case "XP":
            var xpChangeset = {};
            xpChangeset["xp"] = +amount;
            try { nk.walletUpdate(userId, xpChangeset, {}, true); }
            catch(e) { logger.warn("XP grant failed: " + e.message); }
            break;

        case "Coins":
            var coinChangeset = {};
            coinChangeset["coins"] = +amount;
            try { nk.walletUpdate(userId, coinChangeset, {}, true); }
            catch(e) { logger.warn("Coin grant failed: " + e.message); }
            break;

        case "AudiobookToken":
            try {
                var tokenObj = nk.storageRead([{
                    collection: "audiobook",
                    key: "tokens",
                    userId: userId
                }]);
                var tokens = (tokenObj && tokenObj.length > 0) ? (tokenObj[0].value.count || 0) : 0;
                tokens += amount;
                nk.storageWrite([{
                    collection: "audiobook",
                    key: "tokens",
                    userId: userId,
                    value: { count: tokens, lastGranted: new Date().toISOString() },
                    permissionRead: 1,
                    permissionWrite: 0
                }]);
            } catch(e) { logger.warn("Audiobook token grant failed: " + e.message); }
            break;

        case "Shield":
            try {
                nk.storageWrite([{
                    collection: "streak_shield",
                    key: "pending_grant",
                    userId: userId,
                    value: { hours: amount, source: "fortune_wheel", timestamp: new Date().toISOString() },
                    permissionRead: 1,
                    permissionWrite: 0
                }]);
            } catch(e) { logger.warn("Shield grant failed: " + e.message); }
            break;

        default:
            logger.warn("Unknown reward type: " + rewardType);
    }
}
