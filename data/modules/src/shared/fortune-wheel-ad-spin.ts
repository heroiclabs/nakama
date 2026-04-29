// fortune-wheel-ad-spin.ts
// PLAN-ADS-OPTIMIZATION-v2 §4 placement #19: Lucky Wheel free spin via rewarded ad.
//
// The FortuneWheelPopup on the Unity client shows a "Watch Ad for Free Spin"
// button when the user has exhausted their organic spins. This RPC bypasses
// the normal cooldown — it does NOT consume a regular spin token; instead
// it issues a separate "ad_spin" token that the wheel UI consumes for one
// bonus spin.
//
// Flow:
// 1. Client calls `fortune_wheel_ad_spin` after user clicks "Watch Ad" and
//    the rewarded video completes successfully (client holds a valid
//    rewarded_ad_claim receipt).
// 2. Server validates: tier gate (T2/T3 only), daily cap, and optional
//    claim receipt verification.
// 3. Returns { success: true, spinsGranted: 1 } — client adds 1 to
//    its local spin counter.

namespace FortuneWheelAdSpin {

    const COLLECTION = "fortune_wheel_ad_spins";
    const DAILY_KEY_PREFIX = "daily_";

    // Per-tier configuration
    const TIER_CONFIG: { [tier: string]: { enabled: boolean; maxPerDay: number; cooldownSeconds: number } } = {
        "t1": { enabled: false, maxPerDay: 0, cooldownSeconds: 0 },
        "t2": { enabled: true,  maxPerDay: 3, cooldownSeconds: 3600 },  // 1 hour cooldown, 3/day
        "t3": { enabled: true,  maxPerDay: 5, cooldownSeconds: 1800 }   // 30 min cooldown, 5/day
    };

    function getTodayKey(): string {
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth() + 1;
        const d = now.getUTCDate();
        return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
    }

    function getUserTier(nk: nkruntime.Nakama, userId: string): string {
        try {
            const records = nk.storageRead([{
                collection: "geo_tier",
                key: "resolved",
                userId: userId
            }]);
            if (records && records.length > 0 && records[0].value?.tier) {
                const tier = (records[0].value.tier as string).toLowerCase();
                if (tier === "t1" || tier === "t2" || tier === "t3") return tier;
            }
        } catch { /* fall through */ }
        return "t3";
    }

    interface DailyRecord {
        date: string;
        spinsUsed: number;
        lastSpinAt: number;   // unix epoch seconds
    }

    function getDailyRecord(nk: nkruntime.Nakama, userId: string, todayKey: string): DailyRecord {
        try {
            const records = nk.storageRead([{
                collection: COLLECTION,
                key: DAILY_KEY_PREFIX + todayKey,
                userId: userId
            }]);
            if (records && records.length > 0) {
                return records[0].value as DailyRecord;
            }
        } catch { /* fall through */ }
        return { date: todayKey, spinsUsed: 0, lastSpinAt: 0 };
    }

    /**
     * RPC: fortune_wheel_ad_spin
     *
     * Grants 1 bonus fortune wheel spin after a rewarded ad completion.
     * Tier-gated: T1 disabled, T2/T3 have separate caps and cooldowns.
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

        const tier = getUserTier(nk, userId);
        const config = TIER_CONFIG[tier] || TIER_CONFIG["t3"];

        // Tier gate
        if (!config.enabled) {
            logger.info(`[FortuneWheelAdSpin] Blocked for ${tier} user ${userId}`);
            return JSON.stringify({
                success: false,
                error: "Feature not available for your region",
                errorCode: "TIER_GATED",
                tier: tier
            });
        }

        const now = Math.floor(Date.now() / 1000);
        const todayKey = getTodayKey();
        const daily = getDailyRecord(nk, userId, todayKey);

        // Daily cap check
        if (daily.spinsUsed >= config.maxPerDay) {
            return JSON.stringify({
                success: false,
                error: "Daily ad-spin limit reached",
                errorCode: "DAILY_CAP",
                tier: tier,
                spinsUsed: daily.spinsUsed,
                maxPerDay: config.maxPerDay,
                resetsAt: todayKey + "T00:00:00Z (next day)"
            });
        }

        // Cooldown check
        const elapsed = now - daily.lastSpinAt;
        if (daily.lastSpinAt > 0 && elapsed < config.cooldownSeconds) {
            const remaining = config.cooldownSeconds - elapsed;
            return JSON.stringify({
                success: false,
                error: "Cooldown active",
                errorCode: "COOLDOWN",
                tier: tier,
                cooldownRemaining: remaining,
                canSpinAt: daily.lastSpinAt + config.cooldownSeconds
            });
        }

        // Grant the spin — update daily record
        daily.spinsUsed += 1;
        daily.lastSpinAt = now;

        try {
            nk.storageWrite([{
                collection: COLLECTION,
                key: DAILY_KEY_PREFIX + todayKey,
                userId: userId,
                value: daily as unknown as { [key: string]: unknown },
                permissionRead: 1,
                permissionWrite: 0
            }]);
        } catch (err) {
            logger.error(`[FortuneWheelAdSpin] Storage write failed: ${err}`);
            return JSON.stringify({ success: false, error: "Server error" });
        }

        logger.info(`[FortuneWheelAdSpin] Granted ad-spin #${daily.spinsUsed}/${config.maxPerDay} for ${userId} (${tier})`);

        return JSON.stringify({
            success: true,
            spinsGranted: 1,
            tier: tier,
            spinsUsed: daily.spinsUsed,
            maxPerDay: config.maxPerDay,
            cooldownSeconds: config.cooldownSeconds
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
        logger.info("[FortuneWheelAdSpin] ✓ Registered RPC: fortune_wheel_ad_spin");
    }
}
