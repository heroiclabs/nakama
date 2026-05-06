// fortune-wheel-ad-spin.ts — V2
// Fortune Wheel ad-spin: server-authoritative spin + reward grant after rewarded ad.
//
// V2 CHANGES (breaking from V1):
//   - Removed tier-gating (T1/T2/T3) — all players: max 3 ad spins per cycle
//   - Switched from daily tracking to per-cycle tracking (cycle = 3-day organic cooldown)
//   - Server now picks the reward (weighted random) and grants it atomically
//   - Returns segmentIndex + reward (same shape as fortune_wheel_spin)
//   - Validates organic spin was done first (can't ad-spin without organic)
//   - Validates cycle hasn't expired (no ad-spins after 3-day cooldown ends)
//   - 3-hour cooldown between ad spins (10800 seconds)
//
// Flow:
//   1. Client watches rewarded ad → calls fortune_wheel_ad_spin
//   2. Server validates: organic done, cycle active, cap not hit, cooldown elapsed
//   3. Server picks weighted random segment, grants reward
//   4. Returns { success: true, segmentIndex, reward } — client animates

namespace FortuneWheelAdSpin {

    const COLLECTION = "fortune_wheel_ad_spins";
    const CYCLE_KEY = "cycle_state";
    const AD_SPINS_MAX = 3;
    const AD_COOLDOWN_SECONDS = 10800; // 3 hours

    // Must match SEGMENTS in fortune_wheel.js exactly
    const SEGMENTS = [
        { type: "XP",             amount: 100,  label: "100 XP",            weight: 20 },
        { type: "Coins",          amount: 50,   label: "50 Coins",          weight: 25 },
        { type: "XP",             amount: 250,  label: "250 XP",            weight: 15 },
        { type: "AudiobookToken", amount: 1,    label: "Audiobook Token",   weight: 8  },
        { type: "Coins",          amount: 150,  label: "150 Coins",         weight: 12 },
        { type: "Shield",         amount: 24,   label: "24h Shield",        weight: 10 },
        { type: "XP",             amount: 500,  label: "500 XP",            weight: 5  },
        { type: "AudiobookToken", amount: 2,    label: "2 Audiobook Tokens",weight: 5  }
    ];

    interface CycleState {
        spinsUsed: number;
        lastSpinAt: number;   // unix epoch seconds
        cycleStart: string;   // ISO string — when the organic spin happened
    }

    interface WheelState {
        nextSpinTime?: string;
        organicSpinDone?: boolean;
        totalSpins?: number;
        lastReward?: unknown;
        history?: unknown[];
        _version?: string;
    }

    function getCycleState(nk: nkruntime.Nakama, userId: string): CycleState {
        try {
            const records = nk.storageRead([{
                collection: COLLECTION,
                key: CYCLE_KEY,
                userId: userId
            }]);
            if (records && records.length > 0) {
                return records[0].value as CycleState;
            }
        } catch { /* fall through */ }
        return { spinsUsed: 0, lastSpinAt: 0, cycleStart: "" };
    }

    function saveCycleState(nk: nkruntime.Nakama, userId: string, state: CycleState): void {
        nk.storageWrite([{
            collection: COLLECTION,
            key: CYCLE_KEY,
            userId: userId,
            value: state as unknown as { [key: string]: unknown },
            permissionRead: 1,
            permissionWrite: 0
        }]);
    }

    function getWheelState(nk: nkruntime.Nakama, userId: string): WheelState {
        try {
            const records = nk.storageRead([{
                collection: "fortune_wheel",
                key: "state",
                userId: userId
            }]);
            if (records && records.length > 0) {
                return records[0].value as WheelState || {};
            }
        } catch { /* fall through */ }
        return {};
    }

    function getWeightedRandomIndex(): number {
        let totalWeight = 0;
        for (let i = 0; i < SEGMENTS.length; i++) {
            totalWeight += SEGMENTS[i].weight;
        }
        const roll = Math.floor(Math.random() * totalWeight);
        let cumulative = 0;
        for (let i = 0; i < SEGMENTS.length; i++) {
            cumulative += SEGMENTS[i].weight;
            if (roll < cumulative) return i;
        }
        return SEGMENTS.length - 1;
    }

    function grantReward(
        nk: nkruntime.Nakama,
        userId: string,
        rewardType: string,
        amount: number,
        logger: nkruntime.Logger
    ): void {
        switch (rewardType) {
            case "XP": {
                const changeset: { [key: string]: number } = { xp: +amount };
                try { nk.walletUpdate(userId, changeset, {}, true); }
                catch (e) { logger.warn("[FortuneWheelAdSpin] XP grant failed: " + e); }
                break;
            }
            case "Coins": {
                const changeset: { [key: string]: number } = { coins: +amount };
                try { nk.walletUpdate(userId, changeset, {}, true); }
                catch (e) { logger.warn("[FortuneWheelAdSpin] Coin grant failed: " + e); }
                break;
            }
            case "AudiobookToken": {
                try {
                    const tokenObj = nk.storageRead([{
                        collection: "audiobook",
                        key: "tokens",
                        userId: userId
                    }]);
                    let tokens = (tokenObj && tokenObj.length > 0)
                        ? ((tokenObj[0].value as { count?: number }).count || 0)
                        : 0;
                    tokens += amount;
                    nk.storageWrite([{
                        collection: "audiobook",
                        key: "tokens",
                        userId: userId,
                        value: { count: tokens, lastGranted: new Date().toISOString() },
                        permissionRead: 1,
                        permissionWrite: 0
                    }]);
                } catch (e) { logger.warn("[FortuneWheelAdSpin] AudiobookToken grant failed: " + e); }
                break;
            }
            case "Shield": {
                try {
                    nk.storageWrite([{
                        collection: "streak_shield",
                        key: "pending_grant",
                        userId: userId,
                        value: { hours: amount, source: "fortune_wheel_ad", timestamp: new Date().toISOString() },
                        permissionRead: 1,
                        permissionWrite: 0
                    }]);
                } catch (e) { logger.warn("[FortuneWheelAdSpin] Shield grant failed: " + e); }
                break;
            }
            default:
                logger.warn("[FortuneWheelAdSpin] Unknown reward type: " + rewardType);
        }
    }

    /**
     * RPC: fortune_wheel_ad_spin (V2)
     *
     * Server-authoritative ad-spin: validates state, picks reward, grants atomically.
     * No tier-gating. All players: max 3 ad spins per 3-day cycle, 3hr gap.
     */
    export function rpcFortuneWheelAdSpin(
        ctx: nkruntime.Context,
        logger: nkruntime.Logger,
        nk: nkruntime.Nakama,
        payload: string
    ): string {
        const userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "Authentication required" });
        }

        // 1. Read organic wheel state — must have done organic spin first
        const wheelState = getWheelState(nk, userId);

        if (!wheelState.organicSpinDone) {
            return JSON.stringify({
                success: false,
                error: "Organic spin required first",
                errorCode: "ORGANIC_NOT_DONE"
            });
        }

        // 2. Verify cycle is still active (cooldown hasn't expired yet)
        if (wheelState.nextSpinTime) {
            const cycleEnd = new Date(wheelState.nextSpinTime);
            if (new Date() >= cycleEnd) {
                // Cycle expired — organic spin resets, ad spins reset too
                return JSON.stringify({
                    success: false,
                    error: "Cycle expired. New organic spin available.",
                    errorCode: "CYCLE_EXPIRED",
                    canSpin: true
                });
            }
        }

        // 3. Read cycle ad-spin state
        const now = Math.floor(Date.now() / 1000);
        let cycle = getCycleState(nk, userId);

        // If cycle state is from a previous cycle, reset it
        if (cycle.cycleStart && wheelState.nextSpinTime) {
            // cycleStart should match the current organic spin cycle
            // If the stored cycleStart is before the current organic spin time minus COOLDOWN,
            // it's stale and we reset.
            const currentCycleStart = new Date(
                new Date(wheelState.nextSpinTime).getTime() - (3 * 24 * 60 * 60 * 1000)
            ).toISOString();
            if (cycle.cycleStart < currentCycleStart) {
                cycle = { spinsUsed: 0, lastSpinAt: 0, cycleStart: currentCycleStart };
            }
        }

        // 4. Check ad spin cap
        if (cycle.spinsUsed >= AD_SPINS_MAX) {
            return JSON.stringify({
                success: false,
                error: "All ad spins used for this cycle",
                errorCode: "AD_CAP_REACHED",
                spinsUsed: cycle.spinsUsed,
                adSpinsMax: AD_SPINS_MAX
            });
        }

        // 5. Check 3-hour cooldown between ad spins
        if (cycle.lastSpinAt > 0) {
            const elapsed = now - cycle.lastSpinAt;
            if (elapsed < AD_COOLDOWN_SECONDS) {
                const remaining = AD_COOLDOWN_SECONDS - elapsed;
                return JSON.stringify({
                    success: false,
                    error: "Ad spin cooldown active",
                    errorCode: "AD_COOLDOWN",
                    cooldownRemaining: remaining,
                    canSpinAt: cycle.lastSpinAt + AD_COOLDOWN_SECONDS
                });
            }
        }

        // 6. SERVER picks the reward (weighted random)
        const segmentIndex = getWeightedRandomIndex();
        const reward = SEGMENTS[segmentIndex];

        // 7. Update cycle state
        cycle.spinsUsed += 1;
        cycle.lastSpinAt = now;
        if (!cycle.cycleStart && wheelState.nextSpinTime) {
            cycle.cycleStart = new Date(
                new Date(wheelState.nextSpinTime).getTime() - (3 * 24 * 60 * 60 * 1000)
            ).toISOString();
        }

        try {
            saveCycleState(nk, userId, cycle);
        } catch (err) {
            logger.error(`[FortuneWheelAdSpin] Cycle state write failed: ${err}`);
            return JSON.stringify({ success: false, error: "Server error" });
        }

        // 8. Grant reward atomically
        grantReward(nk, userId, reward.type, reward.amount, logger);

        logger.info(`[FortuneWheelAdSpin] V2 ad-spin #${cycle.spinsUsed}/${AD_SPINS_MAX} for ${userId} → segment ${segmentIndex} (${reward.label})`);

        // 9. Return same shape as fortune_wheel_spin for consistent client handling
        return JSON.stringify({
            success: true,
            segmentIndex: segmentIndex,
            reward: {
                type: reward.type,
                amount: reward.amount,
                label: reward.label
            },
            spinsUsed: cycle.spinsUsed,
            adSpinsMax: AD_SPINS_MAX,
            adCooldownSeconds: AD_COOLDOWN_SECONDS,
            nextAdSpinTime: cycle.lastSpinAt + AD_COOLDOWN_SECONDS
        });
    }

    /**
     * Register all RPCs in this module.
     */
    export function register(
        initializer: nkruntime.Initializer,
        logger: nkruntime.Logger
    ): void {
        initializer.registerRpc("fortune_wheel_ad_spin", rpcFortuneWheelAdSpin);
        logger.info("[FortuneWheelAdSpin] ✓ Registered RPC: fortune_wheel_ad_spin (V2)");
    }
}
