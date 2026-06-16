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
// All Satori admin surfaces (dashboard, game-metrics, timeline, funnels,
// retention) read through here so they show real game data instead of the
// near-empty capture ring. Pure helper namespace — registers no RPCs and is
// only ever called at request time (no module-eval ordering dependency).
// ---------------------------------------------------------------------------
namespace LegacyAnalytics {

  var DAU_COLLECTION = "analytics_dau";
  var LIVE_COLLECTION = "analytics_live_daily";

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

  function emptyDay(dateStr: string): Day {
    return {
      date: dateStr, dau: 0, newUsers: 0, uniqueUsers: [], events: 0, sessions: 0,
      sessionSeconds: 0, revenue: 0, purchases: 0, byName: {}, byCountry: {}, byCity: {}, byPlatform: {}, lastEventAt: 0
    };
  }

  // Read the analytics_dau + analytics_live_daily aggregate docs for one date.
  // gameId "all" / undefined maps to the platform-wide aggregate keys.
  export function readDay(nk: nkruntime.Nakama, dateStr: string, gameId?: string): Day {
    var sys = Constants.SYSTEM_USER_ID;
    var out = emptyDay(dateStr);
    try {
      var recs = nk.storageRead([
        { collection: DAU_COLLECTION, key: dauKeyOf(dateStr, gameId), userId: sys },
        { collection: LIVE_COLLECTION, key: liveKeyOf(dateStr, gameId), userId: sys }
      ]);
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (!r || !r.value) continue;
        if (r.collection === DAU_COLLECTION) {
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
          out.revenue = (parseFloat(lv.revenue_usd) || 0) + (parseFloat(lv.ad_revenue_usd) || 0);
          out.sessionSeconds = parseFloat(lv.session_seconds) || 0;
          out.lastEventAt = parseInt(lv.last_event_at, 10) || 0;
          out.sessions = parseInt(lv.session_count, 10) ||
            out.byName.session_end || out.byName.session_start || 0;
          out.purchases = out.byName.iap_purchased || out.byName.iap_purchase || 0;
        }
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
