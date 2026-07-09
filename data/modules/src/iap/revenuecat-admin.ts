// =============================================================================
// RPC: admin_revenuecat_dashboard
//
// Server-side proxy to RevenueCat Charts API v2 for the admin dashboard.
// IAP / subscription revenue is sourced ONLY from RevenueCat (production
// charts) — not from Nakama analytics_live_daily (unreliable / sandbox noise).
//
// Required env (RUNTIME_ENV_KEYS):
//   REVENUECAT_SECRET_API_KEY  — RevenueCat project secret key (sk_…)
//   REVENUECAT_PROJECT_ID      — defaults to QuizVerse proj0d38847e
// =============================================================================

namespace QuizVerseRevenueCatAdmin {

  var RC_API_BASE = "https://api.revenuecat.com/v2";
  var DEFAULT_PROJECT_ID = "proj0d38847e";
  var MEASURE_REVENUE = 0;
  var MEASURE_TRANSACTIONS = 1;

  function env(ctx: nkruntime.Context, key: string): string {
    return (ctx.env && ctx.env[key]) || "";
  }

  function isoDateUtc(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  function addDaysUtc(d: Date, days: number): Date {
    var copy = new Date(d.getTime());
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
  }

  function rcGet(
    nk: nkruntime.Nakama,
    path: string,
    apiKey: string
  ): { ok: boolean; status: number; body: any; error: string } {
    try {
      var resp: any = nk.httpRequest(
        RC_API_BASE + path,
        "get",
        {
          Accept: "application/json",
          Authorization: "Bearer " + apiKey,
        },
        "",
        20000
      );
      var status = resp.code || 0;
      var parsed = RpcHelpers.safeJsonParse(resp.body || "{}");
      if (status < 200 || status >= 300) {
        var errMsg = parsed.success && parsed.data && parsed.data.message
          ? String(parsed.data.message)
          : (resp.body || "").substring(0, 240);
        return { ok: false, status: status, body: null, error: errMsg || ("HTTP " + status) };
      }
      if (!parsed.success) {
        return { ok: false, status: 502, body: null, error: "invalid JSON from RevenueCat" };
      }
      return { ok: true, status: status, body: parsed.data, error: "" };
    } catch (err: any) {
      var em = err && err.message ? String(err.message) : String(err);
      return { ok: false, status: 502, body: null, error: em };
    }
  }

  function metricValue(metrics: any[], id: string): number {
    if (!metrics || !metrics.length) return 0;
    for (var i = 0; i < metrics.length; i++) {
      var m = metrics[i];
      if (m && String(m.id || "") === id) {
        var v = m.value;
        if (typeof v === "number" && !isNaN(v)) return v;
        var n = parseFloat(String(v));
        return isNaN(n) ? 0 : n;
      }
    }
    return 0;
  }

  function parseDailyRevenue(chart: any): {
    daily: Array<{ date: string; revenue: number; transactions: number }>;
    totalRevenue: number;
    totalTransactions: number;
  } {
    var dailyMap: { [date: string]: { revenue: number; transactions: number } } = {};
    var values = chart && chart.values ? chart.values : [];
    var i: number;
    for (i = 0; i < values.length; i++) {
      var row = values[i];
      if (!row || row.incomplete) continue;
      var cohort = row.cohort;
      if (typeof cohort !== "number") continue;
      var date = isoDateUtc(new Date(cohort * 1000));
      if (!dailyMap[date]) {
        dailyMap[date] = { revenue: 0, transactions: 0 };
      }
      var measure = row.measure;
      var val = typeof row.value === "number" ? row.value : parseFloat(String(row.value || 0));
      if (isNaN(val)) val = 0;
      if (measure === MEASURE_REVENUE) {
        dailyMap[date].revenue += val;
      } else if (measure === MEASURE_TRANSACTIONS) {
        dailyMap[date].transactions += val;
      }
    }

    var dates = Object.keys(dailyMap).sort();
    var daily: Array<{ date: string; revenue: number; transactions: number }> = [];
    var totalRevenue = 0;
    var totalTransactions = 0;
    for (i = 0; i < dates.length; i++) {
      var d = dates[i];
      var pt = dailyMap[d];
      daily.push({ date: d, revenue: pt.revenue, transactions: pt.transactions });
      totalRevenue += pt.revenue;
      totalTransactions += pt.transactions;
    }

    if (chart && chart.summary && chart.summary.total) {
      var sr = chart.summary.total.Revenue;
      var st = chart.summary.total.Transactions;
      if (typeof sr === "number" && !isNaN(sr)) totalRevenue = sr;
      if (typeof st === "number" && !isNaN(st)) totalTransactions = st;
    }

    return { daily: daily, totalRevenue: totalRevenue, totalTransactions: totalTransactions };
  }

  function rpcAdminRevenueCatDashboard(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    RpcHelpers.requireAdmin(ctx, nk);

    var req: any;
    try {
      req = RpcHelpers.parseRpcPayload(payload);
    } catch (err: any) {
      return RpcHelpers.errorResponse(err.message || "invalid payload", nkruntime.Codes.INVALID_ARGUMENT);
    }

    var apiKey = env(ctx, "REVENUECAT_SECRET_API_KEY");
    if (!apiKey) {
      return RpcHelpers.errorResponse(
        "RevenueCat not configured — set REVENUECAT_SECRET_API_KEY on Nakama",
        503
      );
    }

    var projectId = env(ctx, "REVENUECAT_PROJECT_ID") || DEFAULT_PROJECT_ID;
    var days = 30;
    if (req && req.days !== undefined && req.days !== null) {
      var d = parseInt(String(req.days), 10);
      if (!isNaN(d) && d >= 7 && d <= 90) days = d;
    }

    var end = new Date();
    var start = addDaysUtc(end, -(days - 1));
    var startStr = isoDateUtc(start);
    var endStr = isoDateUtc(end);
    var currency = "USD";

    var overviewPath =
      "/projects/" +
      encodeURIComponent(projectId) +
      "/metrics/overview?currency=" +
      currency;

    var chartPath =
      "/projects/" +
      encodeURIComponent(projectId) +
      "/charts/revenue?currency=" +
      currency +
      "&start_date=" +
      startStr +
      "&end_date=" +
      endStr +
      "&resolution=0";

    var overviewResp = rcGet(nk, overviewPath, apiKey);
    if (!overviewResp.ok) {
      logger.warn("[RevenueCatAdmin] overview failed: " + overviewResp.error);
      return RpcHelpers.errorResponse(
        "RevenueCat overview failed: " + overviewResp.error,
        overviewResp.status || 502
      );
    }

    var chartResp = rcGet(nk, chartPath, apiKey);
    if (!chartResp.ok) {
      logger.warn("[RevenueCatAdmin] chart failed: " + chartResp.error);
      return RpcHelpers.errorResponse(
        "RevenueCat revenue chart failed: " + chartResp.error,
        chartResp.status || 502
      );
    }

    var metrics = overviewResp.body && overviewResp.body.metrics ? overviewResp.body.metrics : [];
    var parsed = parseDailyRevenue(chartResp.body);

    return RpcHelpers.successResponse({
      source: "revenuecat",
      currency: currency,
      projectId: projectId,
      days: days,
      dateRange: { start: startStr, end: endStr },
      overview: {
        mrr: metricValue(metrics, "mrr"),
        revenue28d: metricValue(metrics, "revenue"),
        activeSubscriptions: metricValue(metrics, "active_subscriptions"),
        activeTrials: metricValue(metrics, "active_trials"),
      },
      daily: parsed.daily,
      totals: {
        revenue: parsed.totalRevenue,
        transactions: Math.round(parsed.totalTransactions),
      },
      adRevenue: {
        status: "pending",
        message:
          "Ad revenue integration pending — Unity Appodeal must report impressions and earnings to Nakama analytics before this panel can show live data.",
      },
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("admin_revenuecat_dashboard", rpcAdminRevenueCatDashboard);
  }
}
