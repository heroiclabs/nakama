namespace LegacyAnalyticsRetention {

  function readAggStorage(nk: nkruntime.Nakama, collection: string, key: string): any {
    try {
      var recs = nk.storageRead([{ collection: collection, key: key, userId: Constants.SYSTEM_USER_ID }]);
      if (recs && recs.length > 0) return recs[0].value;
    } catch (_) {}
    return null;
  }

  function writeAggStorage(nk: nkruntime.Nakama, collection: string, key: string, value: any): void {
    nk.storageWrite([{
      collection: collection, key: key, userId: Constants.SYSTEM_USER_ID,
      value: value, permissionRead: 0, permissionWrite: 0
    }]);
  }

  function rpcCohortRetention(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = data.gameId || null;
    var daysBack = parseInt(data.daysBack, 10) || 60;
    var now = Date.now();
    var cohorts: any[] = [];

    for (var d = 0; d < daysBack; d++) {
      var cohortDay = new Date(now - d * 86400000);
      var cohortKey = cohortDay.toISOString().split("T")[0];
      var dauKey = gameId ? "dau_" + gameId + "_" + cohortKey : "dau_platform_" + cohortKey;
      var dauData = readAggStorage(nk, "analytics_dau", dauKey);
      if (dauData && dauData.uniqueUsers) {
        cohorts.push({ date: cohortKey, dau: dauData.uniqueUsers.length || 0, newUsers: dauData.newUsers || 0 });
      }
    }

    var retentionData = readAggStorage(nk, "analytics_retention_agg", "retention_counters") || {};
    var total = retentionData.totalSignups || 0;

    return RpcHelpers.successResponse({
      cohorts: cohorts,
      retention: {
        totalSignups: total,
        d1Returns: retentionData.d1Returns || 0,
        d7Returns: retentionData.d7Returns || 0,
        d30Returns: retentionData.d30Returns || 0,
        d1Rate: total > 0 ? ((retentionData.d1Returns || 0) / total * 100).toFixed(1) + "%" : "0%",
        d7Rate: total > 0 ? ((retentionData.d7Returns || 0) / total * 100).toFixed(1) + "%" : "0%",
        d30Rate: total > 0 ? ((retentionData.d30Returns || 0) / total * 100).toFixed(1) + "%" : "0%"
      },
      gameId: gameId, daysBack: daysBack
    });
  }

  function rpcTrackRetentionEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var eventType = data.eventType || "session";

    var counters = readAggStorage(nk, "analytics_retention_agg", "retention_counters") || {
      totalSignups: 0, d1Returns: 0, d7Returns: 0, d30Returns: 0
    };

    if (eventType === "signup") counters.totalSignups = (counters.totalSignups || 0) + 1;
    else if (eventType === "d1_return") counters.d1Returns = (counters.d1Returns || 0) + 1;
    else if (eventType === "d7_return") counters.d7Returns = (counters.d7Returns || 0) + 1;
    else if (eventType === "d30_return") counters.d30Returns = (counters.d30Returns || 0) + 1;

    writeAggStorage(nk, "analytics_retention_agg", "retention_counters", counters);

    var today = new Date().toISOString().split("T")[0];
    var platformDauKey = "dau_platform_" + today;
    var platformDau = readAggStorage(nk, "analytics_dau", platformDauKey) || { uniqueUsers: [], count: 0, newUsers: 0 };
    if (platformDau.uniqueUsers.indexOf(userId) === -1) {
      platformDau.uniqueUsers.push(userId);
      platformDau.count = platformDau.uniqueUsers.length;
      if (eventType === "signup") platformDau.newUsers = (platformDau.newUsers || 0) + 1;
      writeAggStorage(nk, "analytics_dau", platformDauKey, platformDau);
    }

    return RpcHelpers.successResponse({ eventType: eventType });
  }

  function rpcArpu(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var period = data.period || "30d";
    var gameId = data.gameId || null;
    var daysBack = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    var now = Date.now();

    var totalRevenue = 0;
    var totalPurchases = 0;
    var uniquePayingUsers: string[] = [];
    var totalActiveUsers = 0;

    for (var d = 0; d < daysBack; d++) {
      var dayStr = new Date(now - d * 86400000).toISOString().split("T")[0];
      var revData = readAggStorage(nk, "analytics_revenue", "revenue_" + dayStr);
      if (revData) {
        totalRevenue += revData.totalAmount || 0;
        totalPurchases += revData.purchaseCount || 0;
        if (revData.payingUsers) {
          for (var i = 0; i < revData.payingUsers.length; i++) {
            if (uniquePayingUsers.indexOf(revData.payingUsers[i]) === -1) uniquePayingUsers.push(revData.payingUsers[i]);
          }
        }
      }
      var dauKey = gameId ? "dau_" + gameId + "_" + dayStr : "dau_platform_" + dayStr;
      var dauData = readAggStorage(nk, "analytics_dau", dauKey);
      if (dauData && dauData.count) totalActiveUsers += dauData.count;
    }

    var avgDau = daysBack > 0 ? Math.round(totalActiveUsers / daysBack) : 0;
    var arpu = avgDau > 0 ? (totalRevenue / avgDau).toFixed(2) : "0.00";
    var arppu = uniquePayingUsers.length > 0 ? (totalRevenue / uniquePayingUsers.length).toFixed(2) : "0.00";

    return RpcHelpers.successResponse({
      period: period, daysBack: daysBack, totalRevenue: totalRevenue,
      totalPurchases: totalPurchases, uniquePayingUsers: uniquePayingUsers.length,
      avgDau: avgDau, arpu: parseFloat(arpu), arppu: parseFloat(arppu),
      conversionRate: avgDau > 0 ? ((uniquePayingUsers.length / avgDau) * 100).toFixed(2) + "%" : "0%",
      gameId: gameId
    });
  }

  function rpcTrackRevenue(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var amount = parseFloat(data.amount) || 0;
    var currency = data.currency || "USD";
    var productId = data.productId || "unknown";

    if (amount <= 0) return RpcHelpers.errorResponse("amount must be > 0");

    var today = new Date().toISOString().split("T")[0];
    var revenueKey = "revenue_" + today;
    var revData = readAggStorage(nk, "analytics_revenue", revenueKey) || {
      totalAmount: 0, purchaseCount: 0, payingUsers: [], transactions: []
    };

    revData.totalAmount = (revData.totalAmount || 0) + amount;
    revData.purchaseCount = (revData.purchaseCount || 0) + 1;
    if (revData.payingUsers.indexOf(userId) === -1) revData.payingUsers.push(userId);
    revData.transactions = revData.transactions || [];
    revData.transactions.push({
      userId: userId, amount: amount, currency: currency, productId: productId,
      timestamp: new Date().toISOString()
    });

    writeAggStorage(nk, "analytics_revenue", revenueKey, revData);

    return RpcHelpers.successResponse({
      tracked: { userId: userId, amount: amount, currency: currency, productId: productId }
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("analytics_cohort_retention", rpcCohortRetention);
    initializer.registerRpc("analytics_track_retention_event", rpcTrackRetentionEvent);
    initializer.registerRpc("analytics_arpu", rpcArpu);
    initializer.registerRpc("analytics_track_revenue", rpcTrackRevenue);
  }
}
