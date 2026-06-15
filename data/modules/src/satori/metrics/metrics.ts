namespace SatoriMetrics {

  function getMetricDefinitions(nk: nkruntime.Nakama, gameId?: string): { [id: string]: Satori.MetricDefinition } {
    var raw = ConfigLoader.loadSatoriConfigForGame<any>(nk, "metrics", gameId, {});
    return raw && raw.metrics ? raw.metrics : raw;
  }

  function getMetricState(nk: nkruntime.Nakama, metricId: string, gameId?: string): { buckets: { [bucketKey: string]: { value: number; count: number; uniqueUsers: string[] } } } {
    var data = Storage.readSystemJson<any>(nk, Constants.SATORI_METRICS_COLLECTION, Constants.gameKey(gameId, metricId));
    return data || { buckets: {} };
  }

  function saveMetricState(nk: nkruntime.Nakama, metricId: string, state: any, gameId?: string): void {
    Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, Constants.gameKey(gameId, metricId), state);
  }

  export function processEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, eventName: string, metadata: { [key: string]: string }): void {
    var gameId = metadata.gameId || metadata.game_id;
    var definitions = getMetricDefinitions(nk, gameId);
    for (var id in definitions) {
      var def = definitions[id];
      if (def.eventName !== eventName) continue;

      var state = getMetricState(nk, id, gameId);
      var now = Math.floor(Date.now() / 1000);
      var bucketKey = def.windowSec ? String(Math.floor(now / def.windowSec) * def.windowSec) : "all";

      if (!state.buckets[bucketKey]) {
        state.buckets[bucketKey] = { value: 0, count: 0, uniqueUsers: [] };
      }

      var bucket = state.buckets[bucketKey];
      var numericValue = 1;
      if (def.metadataField && metadata[def.metadataField]) {
        numericValue = parseFloat(metadata[def.metadataField]) || 1;
      }

      switch (def.aggregation) {
        case "count":
          bucket.value++;
          break;
        case "sum":
          bucket.value += numericValue;
          break;
        case "avg":
          bucket.value = ((bucket.value * bucket.count) + numericValue) / (bucket.count + 1);
          break;
        case "min":
          bucket.value = bucket.count === 0 ? numericValue : Math.min(bucket.value, numericValue);
          break;
        case "max":
          bucket.value = Math.max(bucket.value, numericValue);
          break;
        case "unique":
          if (bucket.uniqueUsers.indexOf(userId) < 0) {
            bucket.uniqueUsers.push(userId);
            bucket.value = bucket.uniqueUsers.length;
          }
          break;
      }
      bucket.count++;

      saveMetricState(nk, id, state, gameId);
      checkAlerts(nk, logger, id, bucket.value);
    }
  }

  interface MetricAlert {
    metricId: string;
    threshold: number;
    operator: "gt" | "lt" | "gte" | "lte";
    name: string;
    enabled: boolean;
  }

  function getAlerts(nk: nkruntime.Nakama): MetricAlert[] {
    var data = Storage.readSystemJson<{ alerts: MetricAlert[] }>(nk, Constants.SATORI_METRICS_COLLECTION, "alerts");
    return (data && data.alerts) || [];
  }

  function checkAlerts(nk: nkruntime.Nakama, logger: nkruntime.Logger, metricId: string, value: number): void {
    var alerts = getAlerts(nk);
    for (var i = 0; i < alerts.length; i++) {
      var alert = alerts[i];
      if (!alert.enabled || alert.metricId !== metricId) continue;
      var triggered = false;
      switch (alert.operator) {
        case "gt": triggered = value > alert.threshold; break;
        case "lt": triggered = value < alert.threshold; break;
        case "gte": triggered = value >= alert.threshold; break;
        case "lte": triggered = value <= alert.threshold; break;
      }
      if (triggered) {
        logger.warn("[MetricAlert] %s triggered: %s = %f (threshold: %f)", alert.name, metricId, value, alert.threshold);
        Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, "alert_triggered_" + alert.name, {
          alert: alert, value: value, triggeredAt: Math.floor(Date.now() / 1000)
        });
      }
    }
  }

  // ---- RPCs ----

  function rpcQuery(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = RpcHelpers.gameId(data);
    var definitions = getMetricDefinitions(nk, gameId);
    var results: Satori.MetricResult[] = [];
    var now = Math.floor(Date.now() / 1000);

    var metricIds = data.metricIds || Object.keys(definitions);
    for (var i = 0; i < metricIds.length; i++) {
      var metricId = metricIds[i];
      var state = getMetricState(nk, metricId, gameId);

      var latestBucket = "all";
      var latestTime = 0;
      for (var bk in state.buckets) {
        var bkTime = parseInt(bk) || 0;
        if (bkTime > latestTime) {
          latestTime = bkTime;
          latestBucket = bk;
        }
      }

      var bucket = state.buckets[latestBucket];
      results.push({
        metricId: metricId,
        value: bucket ? bucket.value : 0,
        computedAt: now
      });
    }

    return RpcHelpers.successResponse({ metrics: results });
  }

  function rpcDefine(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id || !data.name || !data.eventName || !data.aggregation) {
      return RpcHelpers.errorResponse("id, name, eventName, and aggregation required");
    }

    var gameId = RpcHelpers.gameId(data);
    var definitions = getMetricDefinitions(nk, gameId);
    definitions[data.id] = {
      id: data.id,
      name: data.name,
      eventName: data.eventName,
      metadataField: data.metadataField,
      aggregation: data.aggregation,
      windowSec: data.windowSec
    };

    ConfigLoader.saveSatoriConfigForGame(nk, "metrics", gameId, definitions);
    return RpcHelpers.successResponse({ metric: definitions[data.id] });
  }

  function rpcSetAlert(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var metricId = data.metricId || data.metric_id;
    if (!metricId || !data.name || data.threshold === undefined || !data.operator) {
      return RpcHelpers.errorResponse("metricId, name, threshold, and operator required");
    }
    var alerts = getAlerts(nk);
    var existing = false;
    for (var i = 0; i < alerts.length; i++) {
      if (alerts[i].name === data.name) {
        alerts[i] = { metricId: metricId, threshold: data.threshold, operator: data.operator, name: data.name, enabled: data.enabled !== false };
        existing = true;
        break;
      }
    }
    if (!existing) {
      alerts.push({ metricId: metricId, threshold: data.threshold, operator: data.operator, name: data.name, enabled: data.enabled !== false });
    }
    Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, "alerts", { alerts: alerts });
    return RpcHelpers.successResponse({ alerts: alerts });
  }

  // satori_metrics_series — bucketed time series for one metric (for charts).
  // Payload: { metricId, game_id?, limit? }
  function rpcSeries(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.metricId) return RpcHelpers.errorResponse("metricId required");
    var gameId = RpcHelpers.gameId(data);
    var limit = Math.min(Math.max(parseInt(data.limit, 10) || 100, 1), 500);

    var definitions = getMetricDefinitions(nk, gameId);
    var def = definitions[data.metricId];
    var state = getMetricState(nk, data.metricId, gameId);

    var points: { bucketSec: number; value: number; count: number }[] = [];
    for (var bk in state.buckets) {
      var bkSec = parseInt(bk, 10);
      points.push({
        bucketSec: isNaN(bkSec) ? 0 : bkSec,
        value: state.buckets[bk].value,
        count: state.buckets[bk].count
      });
    }
    points.sort(function (a, b) { return a.bucketSec - b.bucketSec; });
    if (points.length > limit) points = points.slice(points.length - limit);

    return RpcHelpers.successResponse({
      metricId: data.metricId,
      definition: def || null,
      windowed: !!(def && def.windowSec),
      points: points
    });
  }

  // satori_metrics_alerts — list configured alerts + last-triggered state.
  function rpcAlertsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    return RpcHelpers.successResponse({ alerts: getAlerts(nk) });
  }

  function rpcPrometheus(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = RpcHelpers.gameId(data);
    var definitions = getMetricDefinitions(nk, gameId);
    var lines: string[] = [];
    for (var id in definitions) {
      var state = getMetricState(nk, id, gameId);
      var latestValue = 0;
      var latestTime = 0;
      for (var bk in state.buckets) {
        var bkTime = parseInt(bk) || 0;
        if (bkTime >= latestTime) {
          latestTime = bkTime;
          latestValue = state.buckets[bk].value;
        }
      }
      var safeName = id.replace(/[^a-zA-Z0-9_]/g, "_");
      lines.push("# HELP " + safeName + " " + (definitions[id].name || id));
      lines.push("# TYPE " + safeName + " gauge");
      lines.push(safeName + " " + latestValue);
    }
    return RpcHelpers.successResponse({ text: lines.join("\n") });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_metrics_query", rpcQuery);
    initializer.registerRpc("satori_metrics_define", rpcDefine);
    initializer.registerRpc("satori_metrics_set_alert", rpcSetAlert);
    initializer.registerRpc("satori_metrics_prometheus", rpcPrometheus);
    initializer.registerRpc("satori_metrics_get", rpcQuery);
    initializer.registerRpc("satori_metrics_series", rpcSeries);
    initializer.registerRpc("satori_metrics_alerts", rpcAlertsList);
  }

  export function registerEventHandlers(): void {
    EventBus.on(EventBus.Events.CURRENCY_EARNED, function (nk, logger, ctx, data) {
      processEvent(nk, logger, data.userId, "currency_earned", { currency: data.currencyId, amount: String(data.amount) });
    });
    EventBus.on(EventBus.Events.CURRENCY_SPENT, function (nk, logger, ctx, data) {
      processEvent(nk, logger, data.userId, "currency_spent", { currency: data.currencyId, amount: String(data.amount) });
    });
    EventBus.on(EventBus.Events.STORE_PURCHASE, function (nk, logger, ctx, data) {
      processEvent(nk, logger, data.userId, "store_purchase", { offerId: data.offerId });
    });
    EventBus.on(EventBus.Events.GAME_COMPLETED, function (nk, logger, ctx, data) {
      processEvent(nk, logger, data.userId, "game_completed", { gameId: data.gameId });
    });
    EventBus.on(EventBus.Events.SESSION_START, function (nk, logger, ctx, data) {
      processEvent(nk, logger, data.userId, "session_start", {});
    });
  }
}
