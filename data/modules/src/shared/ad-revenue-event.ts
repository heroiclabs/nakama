// ad-revenue-event.ts
// PLAN-ADS-OPTIMIZATION-v2 §11: Server-side ad revenue recording RPC.
//
// The Unity client fires ILRD (Impression-Level Revenue Data) callbacks
// from the ad SDK. This RPC persists those events in Nakama storage so
// the backend can compute server-side ARPDAU per tier without relying
// solely on client analytics (Firebase/Satori).
//
// WHY SERVER-SIDE?
// - Client analytics can be delayed, sampled, or blocked by ad-blockers.
// - Server storage gives us ground-truth for A/B test evaluation.
// - Enables real-time tier ARPDAU dashboards via Nakama queries.

namespace AdRevenueEvent {

    const COLLECTION = "ad_revenue";
    const DAILY_KEY_PREFIX = "daily_";
    const LIFETIME_KEY = "lifetime";

    interface AdRevenuePayload {
        adType: string;           // "rewarded" | "interstitial" | "banner"
        placement: string;        // e.g. "post_quiz_loss", "wager_boost_50"
        network: string;          // e.g. "ironSource", "AdMob"
        revenueUsd: number;       // ILRD revenue in USD
        currency?: string;        // always "USD"
        sessionId?: string;       // client session for dedup
        timestamp?: number;       // client-side unix epoch (server validates)
    }

    interface DailyAggregate {
        date: string;             // "2026-04-28"
        totalRevenueUsd: number;
        impressions: number;
        byAdType: { [key: string]: { revenue: number; count: number } };
        byPlacement: { [key: string]: { revenue: number; count: number } };
        tier: string;
    }

    interface LifetimeAggregate {
        totalRevenueUsd: number;
        totalImpressions: number;
        firstEventAt: number;
        lastEventAt: number;
        tier: string;
    }

    /**
     * Get today's date key in UTC (YYYY-MM-DD).
     */
    function getTodayKey(): string {
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth() + 1;
        const d = now.getUTCDate();
        return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
    }

    /**
     * Read user's geo tier from the GeoTier cache.
     */
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

    /**
     * RPC: ad_revenue_record
     *
     * Records a single ILRD ad revenue event, updates daily + lifetime aggregates.
     * Called from AdsAnalyticsBridge.ReportAdRevenueToServer() on the Unity client.
     */
    export function rpcRecordAdRevenue(
        ctx: nkruntime.Context,
        logger: nkruntime.Logger,
        nk: nkruntime.Nakama,
        payload: string
    ): string {
        const userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "Authentication required" });
        }

        let data: AdRevenuePayload;
        try {
            data = JSON.parse(payload);
        } catch {
            return JSON.stringify({ success: false, error: "Invalid JSON payload" });
        }

        // Validate required fields
        if (!data.revenueUsd || data.revenueUsd <= 0) {
            return JSON.stringify({ success: false, error: "revenueUsd must be positive" });
        }
        if (!data.adType) {
            return JSON.stringify({ success: false, error: "adType is required" });
        }

        // Clamp revenue to a sane max to prevent abuse ($50 per impression is absurd)
        const revenueUsd = Math.min(data.revenueUsd, 50.0);
        const adType = data.adType || "unknown";
        const placement = data.placement || "unknown";
        const network = data.network || "unknown";
        const tier = getUserTier(nk, userId);
        const todayKey = getTodayKey();
        const now = Math.floor(Date.now() / 1000);

        // ── Update daily aggregate ──────────────────────────────────────
        const dailyStorageKey = DAILY_KEY_PREFIX + todayKey;
        let daily: DailyAggregate;

        try {
            const records = nk.storageRead([{
                collection: COLLECTION,
                key: dailyStorageKey,
                userId: userId
            }]);
            if (records && records.length > 0) {
                daily = records[0].value as DailyAggregate;
            } else {
                daily = {
                    date: todayKey,
                    totalRevenueUsd: 0,
                    impressions: 0,
                    byAdType: {},
                    byPlacement: {},
                    tier: tier
                };
            }
        } catch {
            daily = {
                date: todayKey,
                totalRevenueUsd: 0,
                impressions: 0,
                byAdType: {},
                byPlacement: {},
                tier: tier
            };
        }

        daily.totalRevenueUsd += revenueUsd;
        daily.impressions += 1;
        daily.tier = tier;

        if (!daily.byAdType[adType]) daily.byAdType[adType] = { revenue: 0, count: 0 };
        daily.byAdType[adType].revenue += revenueUsd;
        daily.byAdType[adType].count += 1;

        if (!daily.byPlacement[placement]) daily.byPlacement[placement] = { revenue: 0, count: 0 };
        daily.byPlacement[placement].revenue += revenueUsd;
        daily.byPlacement[placement].count += 1;

        // ── Update lifetime aggregate ───────────────────────────────────
        let lifetime: LifetimeAggregate;

        try {
            const records = nk.storageRead([{
                collection: COLLECTION,
                key: LIFETIME_KEY,
                userId: userId
            }]);
            if (records && records.length > 0) {
                lifetime = records[0].value as LifetimeAggregate;
            } else {
                lifetime = {
                    totalRevenueUsd: 0,
                    totalImpressions: 0,
                    firstEventAt: now,
                    lastEventAt: now,
                    tier: tier
                };
            }
        } catch {
            lifetime = {
                totalRevenueUsd: 0,
                totalImpressions: 0,
                firstEventAt: now,
                lastEventAt: now,
                tier: tier
            };
        }

        lifetime.totalRevenueUsd += revenueUsd;
        lifetime.totalImpressions += 1;
        lifetime.lastEventAt = now;
        lifetime.tier = tier;

        // ── Write both aggregates ───────────────────────────────────────
        try {
            nk.storageWrite([
                {
                    collection: COLLECTION,
                    key: dailyStorageKey,
                    userId: userId,
                    value: daily as unknown as { [key: string]: unknown },
                    permissionRead: 1,  // owner-read
                    permissionWrite: 0  // server-only write
                },
                {
                    collection: COLLECTION,
                    key: LIFETIME_KEY,
                    userId: userId,
                    value: lifetime as unknown as { [key: string]: unknown },
                    permissionRead: 1,
                    permissionWrite: 0
                }
            ]);
        } catch (err) {
            logger.error(`[AdRevenueEvent] Storage write failed for ${userId}: ${err}`);
            return JSON.stringify({ success: false, error: "Storage write failed" });
        }

        logger.info(`[AdRevenueEvent] Recorded $${revenueUsd.toFixed(4)} ${adType}/${placement} from ${network} for ${userId} (${tier})`);

        return JSON.stringify({
            success: true,
            tier: tier,
            dailyTotal: daily.totalRevenueUsd,
            dailyImpressions: daily.impressions,
            lifetimeTotal: lifetime.totalRevenueUsd
        });
    }

    /**
     * Register all RPCs in this module.
     */
    export function register(
        initializer: nkruntime.Initializer,
        logger: nkruntime.Logger
    ): void {
        initializer.registerRpc("ad_revenue_record", rpcRecordAdRevenue);
        logger.info("[AdRevenueEvent] ✓ Registered RPC: ad_revenue_record");
    }
}
