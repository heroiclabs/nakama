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

  function arpuResolveGameId(gameId: any): any {
    if (!gameId || gameId === "all" || gameId === "*") return null;
    var raw = String(gameId);
    var lower = raw.toLowerCase();
    if (lower === "quizverse" || lower === "quiz-verse") return "126bf539-dae2-4bcf-964d-316c0fa1f92b";
    if (lower === "lasttolive" || lower === "last-to-live") return "8f3b1c2a-5d6e-4f7a-9b8c-1d2e3f4a5b6c";
    return raw;
  }

  function arpuReadRollup(nk: nkruntime.Nakama, gameId: any, dayStr: string): any {
    return readAggStorage(nk, "analytics_rollup_daily", "rollup_" + (gameId || "all") + "_" + dayStr);
  }

  function arpuReadLiveCounters(nk: nkruntime.Nakama, gameId: any, dayStr: string, todayStr: string): any {
    if (dayStr !== todayStr) return null;
    try {
      var key = "live_" + (gameId || "all") + "_" + dayStr;
      var recs = nk.storageRead([{
        collection: "analytics_live_daily",
        key: key,
        userId: Constants.SYSTEM_USER_ID
      }]);
      return (recs && recs.length > 0) ? recs[0].value : null;
    } catch (_) {
      return null;
    }
  }

  function arpuEventData(ev: any): any {
    return (ev && (ev.eventData || ev.properties || ev.data)) || {};
  }

  function arpuEventName(ev: any): string {
    if (!ev) return "";
    return String(ev.eventName || ev.event || ev.name || "").toLowerCase();
  }

  function arpuIsoDate(value: any): string {
    if (!value) return "";
    var parsed = new Date(value);
    if (isNaN(parsed.getTime())) return "";
    return parsed.toISOString().split("T")[0];
  }

  function arpuTimestampDate(ev: any): string {
    var d = arpuEventData(ev);
    var raw = ev.timestamp || ev.created_at || ev.createdAt || ev.time || d.timestamp || d.created_at || d.createdAt || d.time || "";
    if (!raw) return "";
    if (typeof raw === "number") {
      var seconds = raw > 10000000000 ? Math.floor(raw / 1000) : Math.floor(raw);
      return new Date(seconds * 1000).toISOString().split("T")[0];
    }
    var asNumber = parseFloat(raw);
    if (isFinite(asNumber) && String(raw).match(/^\d+(\.\d+)?$/)) {
      var nSeconds = asNumber > 10000000000 ? Math.floor(asNumber / 1000) : Math.floor(asNumber);
      return new Date(nSeconds * 1000).toISOString().split("T")[0];
    }
    return arpuIsoDate(raw);
  }

  function arpuDateFromKey(key: string): string {
    if (!key) return "";
    var parts = key.split("_");
    for (var i = 0; i < parts.length; i++) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(parts[i])) return parts[i];
    }
    return "";
  }

  function arpuExtractGameIdFromKey(key: string): any {
    if (!key) return null;
    var parts = key.split("_");
    if (parts.length < 2) return null;
    if (parts[0] === "dash" && parts.length >= 5) {
      return /^\d{4}-\d{2}-\d{2}$/.test(parts[2]) ? parts[1] : null;
    }
    if (parts[0] === "event" && parts.length >= 5) return parts[2];
    if (parts.length >= 4) return parts[0];
    return null;
  }

  function arpuEventDate(ev: any, key: string): string {
    var d = arpuEventData(ev);
    return arpuIsoDate(ev.date || d.date || d.event_date || d.eventDate) ||
      arpuTimestampDate(ev) ||
      arpuDateFromKey(key);
  }

  function arpuEventGameId(ev: any, key: string): any {
    var d = arpuEventData(ev);
    return arpuResolveGameId(ev.gameId || ev.game_id || ev.gameID || d.gameId || d.game_id || d.gameID || arpuExtractGameIdFromKey(key));
  }

  function arpuRevenueAmount(d: any): number {
    var fields = ["price_usd", "priceUsd", "revenue_usd", "revenueUsd", "amount_usd", "amountUsd", "price", "amount", "value"];
    for (var i = 0; i < fields.length; i++) {
      var v = parseFloat(d[fields[i]]);
      if (isFinite(v) && v > 0) return v;
    }
    return 0;
  }

  function arpuIsPurchaseEvent(name: string): boolean {
    return name === "iap_purchased" ||
      name === "purchase_completed" ||
      name === "iap_completed" ||
      name === "iap_purchase" ||
      name === "product_purchased" ||
      name === "store_purchase";
  }

  function arpuScanRevenueEvents(
    nk: nkruntime.Nakama,
    gameId: any,
    daysBack: number,
    now: number,
    cutoffDate?: string,
    endDate?: string
  ): any {
    var cutoff = cutoffDate || new Date(now - (daysBack - 1) * 86400000).toISOString().split("T")[0];
    var end = endDate || "";
    var out: any = { revenue: 0, purchases: 0, payingUsers: {}, activeUsers: {} };
    var cursor: any = null;
    var pages = 0;

    try {
      do {
        var page: any = nk.storageList(Constants.SYSTEM_USER_ID, "analytics_events", 100, cursor);
        if (!page || !page.objects) break;

        for (var i = 0; i < page.objects.length; i++) {
          var obj = page.objects[i];
          var value = obj.value || {};
          var eventDate = arpuEventDate(value, obj.key);
          if (!eventDate || eventDate < cutoff) continue;
          if (end && eventDate > end) continue;
          var eventGameId = arpuEventGameId(value, obj.key);
          if (gameId && eventGameId !== gameId) continue;

          var d = arpuEventData(value);
          var uid = value.userId || value.user_id || d.userId || d.user_id || "";
          if (uid) out.activeUsers[uid] = true;

          var name = arpuEventName(value);
          if (!arpuIsPurchaseEvent(name)) continue;
          out.purchases++;
          out.revenue += arpuRevenueAmount(d);
          if (uid) out.payingUsers[uid] = true;
        }

        cursor = page.cursor || null;
        pages++;
      } while (cursor && pages < 20);
    } catch (_) {}

    return out;
  }

  function rpcArpu(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var period = data.period || "30d";
    var gameId = arpuResolveGameId(data.gameId || data.game_id || null);
    var now = Date.now();
    var todayStr = new Date(now).toISOString().split("T")[0];
    var rangeFrom: string | null = null;
    var rangeTo: string | null = null;
    var dateList: string[] = [];
    var daysBack = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    var parsedDays = parseInt(data.days, 10);
    if (isFinite(parsedDays) && parsedDays > 0 && parsedDays <= 365) daysBack = parsedDays;

    if (data.from_date && /^\d{4}-\d{2}-\d{2}$/.test(data.from_date)) {
      rangeFrom = data.from_date;
      rangeTo = (data.to_date && /^\d{4}-\d{2}-\d{2}$/.test(data.to_date)) ? data.to_date : todayStr;
      var fromMs = new Date(rangeFrom + "T00:00:00Z").getTime();
      var toMs = new Date(rangeTo + "T00:00:00Z").getTime();
      if (toMs < fromMs) {
        var swap = rangeTo;
        rangeTo = rangeFrom;
        rangeFrom = swap;
        fromMs = new Date(rangeFrom + "T00:00:00Z").getTime();
        toMs = new Date(rangeTo + "T00:00:00Z").getTime();
      }
      for (var ms = fromMs; ms <= toMs; ms += 86400000) {
        dateList.push(new Date(ms).toISOString().split("T")[0]);
      }
      daysBack = dateList.length;
      period = daysBack + "d";
    } else {
      for (var d = 0; d < daysBack; d++) {
        dateList.push(new Date(now - d * 86400000).toISOString().split("T")[0]);
      }
    }

    var totalRevenue = 0;
    var totalPurchases = 0;
    var uniquePayingUsers: string[] = [];
    var uniquePayingUserMap: any = {};
    var dauSum = 0;
    var dauDaysWithData = 0;
    var rollupDays = 0;
    var legacyRevenueDays = 0;

    for (var di = 0; di < dateList.length; di++) {
      var dayStr = dateList[di];
      var dayDau = 0;
      var rollup = arpuReadRollup(nk, gameId, dayStr);
      if (rollup) {
        var r = rollup.revenue || {};
        totalRevenue += parseFloat(r.usd || r.iap_revenue_usd || 0) || 0;
        totalPurchases += parseInt(r.iap_count || r.purchaseCount || 0, 10) || 0;
        if (typeof rollup.dau === "number") dayDau = rollup.dau;
        rollupDays++;
      } else {
        var revData = readAggStorage(nk, "analytics_revenue", "revenue_" + dayStr);
        if (revData) {
          totalRevenue += parseFloat(revData.totalAmount || 0) || 0;
          totalPurchases += parseInt(revData.purchaseCount || 0, 10) || 0;
          if (revData.payingUsers) {
            for (var i = 0; i < revData.payingUsers.length; i++) {
              uniquePayingUserMap[revData.payingUsers[i]] = true;
            }
          }
          legacyRevenueDays++;
        }
        var dauKey = gameId ? "dau_" + gameId + "_" + dayStr : "dau_platform_" + dayStr;
        var dauData = readAggStorage(nk, "analytics_dau", dauKey);
        if (dauData) {
          dayDau = parseInt(dauData.count, 10) || 0;
          if (!dayDau && dauData.uniqueUsers && dauData.uniqueUsers.length) {
            dayDau = dauData.uniqueUsers.length;
          }
        }
      }
      // Same-day live counters when rollup is cold (common for "today").
      if (!rollup) {
        var liveDoc = arpuReadLiveCounters(nk, gameId, dayStr, todayStr);
        if (liveDoc) {
          var liveRev = parseFloat(liveDoc.revenue_usd || 0) || 0;
          var liveIap = parseInt(liveDoc.iap_count || liveDoc.purchase_count || 0, 10) || 0;
          if (liveRev > 0) totalRevenue += liveRev;
          if (liveIap > 0) totalPurchases += liveIap;
        }
      }
      if (dayDau > 0) {
        dauSum += dayDau;
        dauDaysWithData++;
      }
    }

    var scanned = arpuScanRevenueEvents(
      nk, gameId, daysBack, now,
      rangeFrom || dateList[dateList.length - 1],
      rangeTo || todayStr
    );
    for (var payer in scanned.payingUsers) {
      if (scanned.payingUsers.hasOwnProperty(payer)) uniquePayingUserMap[payer] = true;
    }
    for (var p in uniquePayingUserMap) {
      if (uniquePayingUserMap.hasOwnProperty(p)) uniquePayingUsers.push(p);
    }

    if (totalPurchases === 0 && scanned.purchases > 0) totalPurchases = scanned.purchases;
    if (totalRevenue === 0 && scanned.revenue > 0) totalRevenue = scanned.revenue;

    var scannedActiveUsers = Object.keys(scanned.activeUsers).length;
    if (dauDaysWithData === 0 && scannedActiveUsers > 0) {
      dauSum = scannedActiveUsers;
      dauDaysWithData = 1;
    }

    var avgDau = dauDaysWithData > 0 ? Math.round((dauSum / dauDaysWithData) * 100) / 100 : 0;
    var arpu = avgDau > 0 ? (totalRevenue / avgDau).toFixed(2) : "0.00";
    var arppu = uniquePayingUsers.length > 0 ? (totalRevenue / uniquePayingUsers.length).toFixed(2) : "0.00";
    var conversionBase = scannedActiveUsers > 0 ? scannedActiveUsers : Math.round(dauSum);

    return RpcHelpers.successResponse({
      period: period, daysBack: daysBack, totalRevenue: totalRevenue,
      totalPurchases: totalPurchases, uniquePayingUsers: uniquePayingUsers.length,
      avgDau: avgDau, arpu: parseFloat(arpu), arppu: parseFloat(arppu),
      conversionRate: conversionBase > 0 ? ((uniquePayingUsers.length / conversionBase) * 100).toFixed(2) + "%" : "0%",
      gameId: gameId,
      range_from: rangeFrom,
      range_to: rangeTo,
      meta: {
        rollupDays: rollupDays,
        legacyRevenueDays: legacyRevenueDays,
        eventPurchases: scanned.purchases,
        eventActiveUsers: scannedActiveUsers
      }
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
