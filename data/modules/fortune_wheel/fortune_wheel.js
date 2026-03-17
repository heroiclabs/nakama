/**
 * fortune_wheel.js — Weekly Fortune Wheel Backend
 * RPCs: fortune_wheel_get_state, fortune_wheel_spin
 * 
 * Storage: fortune_wheel/state per user
 * Rewards: XP, Coins (wallet), AudiobookToken (storage), Shield (storage)
 */

var COOLDOWN_DAYS = 7;

// fortune_wheel_get_state — Get current wheel state
var fortuneWheelGetState = function(ctx, logger, nk, payload) {
    try {
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "Not authenticated" });
        }

        var state = getWheelState(nk, userId);

        return JSON.stringify({
            success: true,
            nextSpinTime: state.nextSpinTime || null,
            totalSpins: state.totalSpins || 0,
            lastReward: state.lastReward || null,
            canSpin: canUserSpin(state)
        });
    } catch (e) {
        logger.error("fortune_wheel_get_state error: " + e.message);
        return JSON.stringify({ success: false, error: e.message });
    }
};

// fortune_wheel_spin — Record a spin result and grant rewards
var fortuneWheelSpin = function(ctx, logger, nk, payload) {
    try {
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "Not authenticated" });
        }

        var state = getWheelState(nk, userId);

        // Cooldown check
        if (!canUserSpin(state)) {
            return JSON.stringify({
                success: false,
                error: "On cooldown",
                nextSpinTime: state.nextSpinTime
            });
        }

        var input = {};
        try { input = JSON.parse(payload); } catch(e) { /* empty ok */ }

        var rewardType = input.rewardType || "XP";
        var rewardAmount = input.rewardAmount || 0;
        var rewardLabel = input.rewardLabel || "";

        // Server-side validation: cap reward amounts to prevent exploitation
        var maxRewards = { "XP": 500, "Coins": 150, "AudiobookToken": 2, "Shield": 24 };
        var maxAllowed = maxRewards[rewardType] || 0;
        if (rewardAmount > maxAllowed || rewardAmount <= 0) {
            logger.warn("fortune_wheel_spin: Invalid reward " + rewardType + "=" + rewardAmount + " from " + userId + ", capping to " + maxAllowed);
            rewardAmount = Math.min(Math.max(rewardAmount, 1), maxAllowed);
        }

        // Grant rewards server-side
        grantReward(nk, userId, rewardType, rewardAmount, logger);

        // Update state
        var now = new Date();
        var nextSpin = new Date(now.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);

        state.nextSpinTime = nextSpin.toISOString();
        state.totalSpins = (state.totalSpins || 0) + 1;
        state.lastReward = {
            type: rewardType,
            amount: rewardAmount,
            label: rewardLabel,
            timestamp: now.toISOString()
        };
        state.history = state.history || [];
        state.history.push(state.lastReward);
        if (state.history.length > 52) state.history = state.history.slice(-52); // Keep 1 year

        saveWheelState(nk, userId, state);

        logger.info("fortune_wheel_spin: " + userId + " won " + rewardLabel);

        return JSON.stringify({
            success: true,
            reward: state.lastReward,
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

function grantReward(nk, userId, rewardType, amount, logger) {
    switch (rewardType) {
        case "XP":
            // Grant XP via wallet
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
            // Store tokens in user storage
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
            // Store shield grant for client-side pickup
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
