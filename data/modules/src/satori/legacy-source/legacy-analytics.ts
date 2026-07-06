// ---------------------------------------------------------------------------
// LegacyAnalytics — shared reader over the legacy analytics pipeline's durable
// per-day aggregate docs. This is the SAME data that powers
// nakama.intelli-verse-x.ai/analytics.htm and is fed by `analytics_log_event`
// (the real game telemetry sink, ~13K events/day), NOT the sparse Satori
// `satori_events` capture ring.
//
// Two collections, both owned by SYSTEM_USER, written live on every accepted
// event and never deleted by the rollup (rollup only clears its own meta /
// checkpoint docs), so historical days remain readable:
//
//   analytics_dau         key: dau_platform_<date> | dau_<gameId>_<date>
//                         value: { count, uniqueUsers[], newUsers, overflow_count }
//   analytics_live_daily  key: live_all_<date>      | live_<gameId>_<date>
//                         value: { total, by_name{}, by_country{}, by_platform{},
//                                  revenue_usd, ad_revenue_usd, session_count,
//                                  coins_earned, coins_spent, last_event_at }
//
// Money (revenue / purchases) is read from a THIRD collection when available:
//
//   analytics_rollup_daily key: rollup_all_<date>   | rollup_<gameId>_<date>
//                         value: { revenue: { usd, iap_count, ad_revenue_usd, … } }
//
// This is the purge-aware source the standalone analytics.htm reads via
// analytics_arpu. We prefer it over analytics_live_daily.revenue_usd, which is
// a live counter the revenue-purge RPC never resets (so seeded/test IAP
// revenue lingers there and inflates the console). Falls back to live_daily for
// days not yet rolled up (e.g. today).
//
// All Satori admin surfaces (dashboard, game-metrics, timeline, funnels,
// retention) read through here so they show real game data instead of the
// near-empty capture ring. Pure helper namespace — registers no RPCs and is
// only ever called at request time (no module-eval ordering dependency).
// ---------------------------------------------------------------------------
namespace LegacyAnalytics {

  var DAU_COLLECTION = "analytics_dau";
  var LIVE_COLLECTION = "analytics_live_daily";
  // Authoritative per-day money source — the SAME rollup the standalone
  // analytics.htm reads via analytics_arpu. `analytics_live_daily` is a live
  // real-time counter that the revenue-purge RPC does NOT touch, so seeded/test
  // IAP revenue lingers there and inflates the dashboard. The rollup is
  // purge-aware, so we prefer its revenue/iap_count whenever a rollup doc
  // exists for the day (today, pre-rollup, still falls back to live_daily).
  var ROLLUP_COLLECTION = "analytics_rollup_daily";

  export interface Day {
    date: string;
    dau: number;
    newUsers: number;
    uniqueUsers: string[];
    events: number;
    sessions: number;
    sessionSeconds: number; // total session length (sec) across the day
    revenue: number;    // iap_purchased + ad_revenue, USD
    purchases: number;  // iap_purchased count — used as a payer proxy
    byName: { [name: string]: number };
    byCountry: { [country: string]: number };
    byCity: { [city: string]: number };
    byPlatform: { [platform: string]: number };
    byAppVersion: { [version: string]: number };
    lastEventAt: number;
  }

  export function dateStrOf(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  // "all" / "global" / empty all map to the platform-wide aggregate keys.
  function isPlatform(gameId?: string): boolean {
    return !gameId || gameId === "all" || gameId === "global";
  }

  function dauKeyOf(dateStr: string, gameId?: string): string {
    return isPlatform(gameId) ? "dau_platform_" + dateStr : "dau_" + gameId + "_" + dateStr;
  }

  function liveKeyOf(dateStr: string, gameId?: string): string {
    return isPlatform(gameId) ? "live_all_" + dateStr : "live_" + gameId + "_" + dateStr;
  }

  function rollupKeyOf(dateStr: string, gameId?: string): string {
    return isPlatform(gameId) ? "rollup_all_" + dateStr : "rollup_" + gameId + "_" + dateStr;
  }

  function emptyDay(dateStr: string): Day {
    return {
      date: dateStr, dau: 0, newUsers: 0, uniqueUsers: [], events: 0, sessions: 0,
      sessionSeconds: 0, revenue: 0, purchases: 0, byName: {}, byCountry: {}, byCity: {}, byPlatform: {}, byAppVersion: {}, lastEventAt: 0
    };
  }

  // Read the analytics_dau + analytics_live_daily aggregate docs for one date.
  // gameId "all" / undefined maps to the platform-wide aggregate keys.
  // A game-scoped request ONLY reads its own scoped key — it never falls back
  // to the platform-wide aggregate. A missing scoped doc means that game had
  // no activity that day, so we correctly return zeros/empty rather than
  // showing another game's (or the whole platform's) numbers under this
  // game's name.
  export function readDay(nk: nkruntime.Nakama, dateStr: string, gameId?: string): Day {
    var sys = Constants.SYSTEM_USER_ID;
    var out = emptyDay(dateStr);
    var rollupRevenue = -1; // <0 = no rollup doc for this day
    var rollupPurchases = 0;
    var reads: nkruntime.StorageReadRequest[] = [
      { collection: DAU_COLLECTION, key: dauKeyOf(dateStr, gameId), userId: sys },
      { collection: LIVE_COLLECTION, key: liveKeyOf(dateStr, gameId), userId: sys },
      { collection: ROLLUP_COLLECTION, key: rollupKeyOf(dateStr, gameId), userId: sys }
    ];
    try {
      var rawRecs = nk.storageRead(reads);
      // Index records by key (inline to avoid ES5 block-function error).
      var byKey: { [k: string]: any } = {};
      for (var ri = 0; ri < rawRecs.length; ri++) {
        if (rawRecs[ri] && rawRecs[ri].value) byKey[rawRecs[ri].key] = rawRecs[ri];
      }
      var dauRec    = byKey[dauKeyOf(dateStr, gameId)]    || null;
      var liveRec   = byKey[liveKeyOf(dateStr, gameId)]   || null;
      var rollupRec = byKey[rollupKeyOf(dateStr, gameId)] || null;
      var recs: any[] = [];
      if (dauRec)    recs.push(dauRec);
      if (liveRec)   recs.push(liveRec);
      if (rollupRec) recs.push(rollupRec);
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (!r || !r.value) continue;
        if (r.collection === ROLLUP_COLLECTION) {
          // Capture the purge-aware money figures; applied after the loop so we
          // never depend on storageRead result ordering.
          var rl = r.value as any;
          var rev = rl.revenue || {};
          rollupRevenue = (parseFloat(rev.usd) || 0) + (parseFloat(rev.ad_revenue_usd) || 0);
          rollupPurchases = parseInt(rev.iap_count, 10) || 0;
        } else if (r.collection === DAU_COLLECTION) {
          var dv = r.value as any;
          var list = Array.isArray(dv.uniqueUsers) ? dv.uniqueUsers : (Array.isArray(dv.users) ? dv.users : []);
          out.uniqueUsers = list;
          out.dau = (parseInt(dv.count, 10) || 0) || list.length || 0;
          out.newUsers = parseInt(dv.newUsers, 10) || 0;
        } else if (r.collection === LIVE_COLLECTION) {
          var lv = r.value as any;
          out.events = parseInt(lv.total, 10) || 0;
          out.byName = lv.by_name || {};
          out.byCountry = lv.by_country || {};
          out.byCity = lv.by_city || {};
          out.byPlatform = lv.by_platform || {};
          out.byAppVersion = lv.by_app_version || {};
          out.revenue = (parseFloat(lv.revenue_usd) || 0) + (parseFloat(lv.ad_revenue_usd) || 0);
          out.sessionSeconds = parseFloat(lv.session_seconds) || 0;
          out.lastEventAt = parseInt(lv.last_event_at, 10) || 0;
          out.sessions = parseInt(lv.session_count, 10) ||
            out.byName.session_end || out.byName.session_start || 0;
          out.purchases = out.byName.iap_purchased || out.byName.iap_purchase || 0;
        }
      }
      // Prefer the rollup's purge-aware money figures over the live counter.
      if (rollupRevenue >= 0) {
        out.revenue = rollupRevenue;
        out.purchases = rollupPurchases;
      }
    } catch (e) { /* missing day → zeros */ }
    return out;
  }

  // Read a contiguous range of days [days-1 .. 0] back from `nowMs`, oldest first.
  export function readRange(nk: nkruntime.Nakama, nowMs: number, days: number, gameId?: string): Day[] {
    var out: Day[] = [];
    for (var d = days - 1; d >= 0; d--) {
      out.push(readDay(nk, dateStrOf(nowMs - d * 86400000), gameId));
    }
    return out;
  }
}
