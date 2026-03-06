namespace SatoriMetrics {

  function getMetricDefinitions(nk: nkruntime.Nakama): { [id: string]: Satori.MetricDefinition } {
    return ConfigLoader.loadSatoriConfig<{ [id: string]: Satori.MetricDefinition }>(nk, "metrics", {});
  }

  function getMetricState(nk: nkruntime.Nakama, metricId: string): { buckets: { [bucketKey: string]: { value: number; count: number; uniqueUsers: string[] } } } {
    var data = Storage.readSystemJson<any>(nk, Constants.SATORI_METRICS_COLLECTION, metricId);
    return data || { buckets: {} };
  }

  function saveMetricState(nk: nkruntime.Nakama, metricId: string, state: any): void {
    Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, metricId, state);
  }

  export function processEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, eventName: string, metadata: { [key: string]: string }): void {
    var definitions = getMetricDefinitions(nk);
    for (var id in definitions) {
      var def = definitions[id];
      if (def.eventName !== eventName) continue;

      var state = getMetricState(nk, id);
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

      saveMetricState(nk, id, state);
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
    var definitions = getMetricDefinitions(nk);
    var results: Satori.MetricResult[] = [];
    var now = Math.floor(Date.now() / 1000);

    var metricIds = data.metricIds || Object.keys(definitions);
    for (var i = 0; i < metricIds.length; i++) {
      var metricId = metricIds[i];
      var state = getMetricState(nk, metricId);

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
      if (bucket) {
        results.push({
          metricId: metricId,
          value: bucket.value,
          computedAt: now
        });
      }
    }

    return RpcHelpers.successResponse({ metrics: results });
  }

  function rpcDefine(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    // Admin RPC
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id || !data.name || !data.eventName || !data.aggregation) {
      return RpcHelpers.errorResponse("id, name, eventName, and aggregation required");
    }

    var definitions = getMetricDefinitions(nk);
    definitions[data.id] = {
      id: data.id,
      name: data.name,
      eventName: data.eventName,
      metadataField: data.metadataField,
      aggregation: data.aggregation,
      windowSec: data.windowSec
    };

    ConfigLoader.saveSatoriConfig(nk, "metrics", definitions);
    return RpcHelpers.successResponse({ metric: definitions[data.id] });
  }

  function rpcSetAlert(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.metricId || !data.name || data.threshold === undefined || !data.operator) {
      return RpcHelpers.errorResponse("metricId, name, threshold, and operator required");
    }
    var alerts = getAlerts(nk);
    var existing = false;
    for (var i = 0; i < alerts.length; i++) {
      if (alerts[i].name === data.name) {
        alerts[i] = { metricId: data.metricId, threshold: data.threshold, operator: data.operator, name: data.name, enabled: data.enabled !== false };
        existing = true;
        break;
      }
    }
    if (!existing) {
      alerts.push({ metricId: data.metricId, threshold: data.threshold, operator: data.operator, name: data.name, enabled: data.enabled !== false });
    }
    Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, "alerts", { alerts: alerts });
    return RpcHelpers.successResponse({ alerts: alerts });
  }

  function rpcPrometheus(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var definitions = getMetricDefinitions(nk);
    var lines: string[] = [];
    for (var id in definitions) {
      var state = getMetricState(nk, id);
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
    return lines.join("\n");
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_metrics_query", rpcQuery);
    initializer.registerRpc("satori_metrics_define", rpcDefine);
    initializer.registerRpc("satori_metrics_set_alert", rpcSetAlert);
    initializer.registerRpc("satori_metrics_prometheus", rpcPrometheus);
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
