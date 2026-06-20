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

    // Skip-cooldown: spend coins to clear the 3-day organic-spin cooldown.
    // MUST match Unity FortuneWheelService.SKIP_COOLDOWN_COST.
    const SKIP_COOLDOWN_COST = 50;
    const SKIP_COOLDOWN_CURRENCY = "coins";

    // Must match SEGMENTS in fortune_wheel.js exactly
    const SEGMENTS = [
        { type: "Coins",            amount: 5,  label: "5 Coins",               weight: 20 },
    { type: "Coins",            amount: 1,   label: "1 Coins",              weight: 25 },
    { type: "Coins",            amount: 15,  label: "15 Coins",             weight: 15 },
    { type: "Coins",            amount: 20,    label: "20 Coins",           weight: 8  },
    { type: "Coins",            amount: 25,  label: "25 Coins",             weight: 12 },
    { type: "Coins",            amount: 50,   label: "50 Coins",            weight: 10 },
    { type: "Coins",            amount: 10,  label: "10 Coins",             weight: 5  },
    { type: "Coins",            amount: 35,    label: "35 Coins Coins",     weight: 5  }
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

    // Persist the organic wheel state. Mirrors fwSaveWheelState in legacy_runtime.js
    // (collection "fortune_wheel", key "state", owner read-only / server write-only).
    function saveWheelState(nk: nkruntime.Nakama, userId: string, state: WheelState): void {
        nk.storageWrite([{
            collection: "fortune_wheel",
            key: "state",
            userId: userId,
            value: state as unknown as { [key: string]: unknown },
            permissionRead: 1,
            permissionWrite: 0
        }]);
    }

    // Mirrors fwCanUserSpin: no nextSpinTime, or the cooldown has elapsed.
    function canUserSpin(state: WheelState): boolean {
        if (!state.nextSpinTime) return true;
        return new Date() >= new Date(state.nextSpinTime);
    }

    // Read the authoritative coin balance from the Nakama account wallet.
    // Fortune-wheel coins are granted via nk.walletUpdate({ coins }), so the
    // balance lives on account.wallet.coins (not the per-game storage wallet).
    function getCoinBalance(nk: nkruntime.Nakama, userId: string): number {
        try {
            const account = nk.accountGetId(userId);
            const wallet = (account && account.wallet) || {};
            const coins = wallet[SKIP_COOLDOWN_CURRENCY];
            return typeof coins === "number" && isFinite(coins) ? coins : 0;
        } catch {
            return 0;
        }
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
     * RPC: fortune_wheel_skip_cooldown
     *
     * Server-authoritative cooldown skip: spend SKIP_COOLDOWN_COST coins to clear the
     * 3-day organic-spin cooldown so the user can spin immediately.
     *
     * Order of operations (fail-safe — never deducts coins on a failed skip):
     *   1. Auth check
     *   2. Validate the user is actually ON cooldown      → not_on_cooldown
     *   3. Validate balance >= cost                       → insufficient_coins
     *   4. Deduct coins atomically (walletUpdate)         → authoritative balance from `previous`
     *   5. Clear the organic cooldown (nextSpinTime=null) — only AFTER the debit succeeds
     *
     * Returns SkipCooldownResponse (see Unity FortuneWheelService.SkipCooldownResponse):
     *   { success, error?, errorCode?, coinsSpent, coinBalance, canSpin, nextSpinTime }
     */
    export function rpcFortuneWheelSkipCooldown(
        ctx: nkruntime.Context,
        logger: nkruntime.Logger,
        nk: nkruntime.Nakama,
        _payload: string
    ): string {
        const userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required",
                coinsSpent: 0,
                coinBalance: 0,
                canSpin: false,
                nextSpinTime: null
            });
        }

        // 1. Read current organic wheel state.
        const state = getWheelState(nk, userId);

        // 2. Must actually be on cooldown — no point charging otherwise.
        if (canUserSpin(state)) {
            return JSON.stringify({
                success: false,
                error: "Not on cooldown — you can already spin",
                errorCode: "not_on_cooldown",
                coinsSpent: 0,
                coinBalance: getCoinBalance(nk, userId),
                canSpin: true,
                nextSpinTime: state.nextSpinTime || null
            });
        }

        // 3. Validate balance BEFORE any debit.
        const balanceBefore = getCoinBalance(nk, userId);
        if (balanceBefore < SKIP_COOLDOWN_COST) {
            return JSON.stringify({
                success: false,
                error: "Not enough coins to skip the cooldown",
                errorCode: "insufficient_coins",
                coinsSpent: 0,
                coinBalance: balanceBefore,
                canSpin: false,
                nextSpinTime: state.nextSpinTime || null
            });
        }

        // 4. Deduct atomically. walletUpdate is authoritative and rejects negative balances.
        let balanceAfter = balanceBefore - SKIP_COOLDOWN_COST;
        try {
            const result = nk.walletUpdate(
                userId,
                { [SKIP_COOLDOWN_CURRENCY]: -SKIP_COOLDOWN_COST },
                { source: "fortune_wheel_skip_cooldown", cost: SKIP_COOLDOWN_COST, ts: new Date().toISOString() },
                true
            );
            // Prefer the server-reported post-debit balance when available.
            if (result && result.updated && typeof result.updated[SKIP_COOLDOWN_CURRENCY] === "number") {
                balanceAfter = result.updated[SKIP_COOLDOWN_CURRENCY];
            }
        } catch (err) {
            // Most common cause: a concurrent spend dropped the balance below cost.
            logger.warn(`[FortuneWheelSkipCooldown] coin debit failed for ${userId}: ${err}`);
            return JSON.stringify({
                success: false,
                error: "Not enough coins to skip the cooldown",
                errorCode: "insufficient_coins",
                coinsSpent: 0,
                coinBalance: getCoinBalance(nk, userId),
                canSpin: false,
                nextSpinTime: state.nextSpinTime || null
            });
        }

        // 5. Clear the organic cooldown — only after the debit succeeded.
        state.nextSpinTime = undefined;
        try {
            saveWheelState(nk, userId, state);
        } catch (err) {
            // Debit already happened; refund to keep the player whole, then fail.
            logger.error(`[FortuneWheelSkipCooldown] state write failed for ${userId}, refunding: ${err}`);
            try {
                nk.walletUpdate(
                    userId,
                    { [SKIP_COOLDOWN_CURRENCY]: +SKIP_COOLDOWN_COST },
                    { source: "fortune_wheel_skip_cooldown_refund", reason: "state_write_failed" },
                    true
                );
            } catch (refundErr) {
                logger.error(`[FortuneWheelSkipCooldown] refund ALSO failed for ${userId}: ${refundErr}`);
            }
            return JSON.stringify({
                success: false,
                error: "Server error — cooldown not cleared (coins refunded)",
                errorCode: "server_error",
                coinsSpent: 0,
                coinBalance: getCoinBalance(nk, userId),
                canSpin: false,
                nextSpinTime: state.nextSpinTime || null
            });
        }

        logger.info(`[FortuneWheelSkipCooldown] ${userId} skipped cooldown for ${SKIP_COOLDOWN_COST} coins (balance ${balanceBefore} → ${balanceAfter})`);

        return JSON.stringify({
            success: true,
            coinsSpent: SKIP_COOLDOWN_COST,
            coinBalance: balanceAfter,
            canSpin: true,
            nextSpinTime: null
        });
    }

    /**
     * Register all RPCs in this module.
     *
     * QVBF_218 fix: this MUST take ONLY `(initializer)`. postbuild.js auto-invokes
     * single-arg register() functions at IIFE/module scope, which sets the
     * `__rpc_fortune_wheel_*` globals on EVERY pooled Goja VM. With the previous
     * `(initializer, logger)` signature postbuild skipped auto-invoke, so the
     * globals were only set on the first VM (where InitModule runs) and were
     * `undefined` on the VMs that actually serve traffic — making
     * fortune_wheel_skip_cooldown / fortune_wheel_ad_spin time out with retries.
     * Do NOT add a second parameter here.
     */
    export function register(
        initializer: nkruntime.Initializer
    ): void {
        initializer.registerRpc("fortune_wheel_ad_spin", rpcFortuneWheelAdSpin);
        initializer.registerRpc("fortune_wheel_skip_cooldown", rpcFortuneWheelSkipCooldown);
    }
}
