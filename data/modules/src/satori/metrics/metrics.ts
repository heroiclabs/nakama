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

  // ---- Built-in metrics (real game telemetry from the analytics pipeline) ----
  //
  // Config-defined metrics rely on the sparse Satori capture path. These
  // built-ins are always present and read from LegacyAnalytics (analytics_dau /
  // analytics_live_daily), so the Metrics surface shows real DAU/revenue/etc.
  // even before any custom metric is defined. IDs are prefixed `legacy_`.

  interface BuiltinMetric { id: string; name: string; field: string; aggregation: string; }

  var BUILTIN_METRICS: BuiltinMetric[] = [
    { id: "legacy_dau",       name: "Daily Active Users",  field: "dau",       aggregation: "unique" },
    { id: "legacy_events",    name: "Events / day",        field: "events",    aggregation: "count" },
    { id: "legacy_revenue",   name: "Revenue / day (USD)", field: "revenue",   aggregation: "sum" },
    { id: "legacy_sessions",  name: "Sessions / day",      field: "sessions",  aggregation: "count" },
    { id: "legacy_payers",    name: "Payers / day",        field: "purchases", aggregation: "count" },
    { id: "legacy_new_users", name: "New users / day",     field: "newUsers",  aggregation: "sum" }
  ];

  function findBuiltin(id: string): BuiltinMetric | null {
    for (var i = 0; i < BUILTIN_METRICS.length; i++) {
      if (BUILTIN_METRICS[i].id === id) return BUILTIN_METRICS[i];
    }
    return null;
  }

  // Fallback source for config-defined metrics: the legacy analytics pipeline.
  //
  // Game clients report telemetry via analytics_log_event (which feeds
  // analytics_live_daily.by_name per-day counters) — NOT via the satori_event
  // capture path that SatoriMetrics.processEvent listens on. So a metric
  // defined on a real gameplay event (question_answered,
  // media_question_completed, session_start, …) never accumulates capture
  // state and sits at 0 forever, even though the event fires hundreds of
  // times a day. When the capture path has no buckets for a count metric we
  // read the same per-day counters the legacy_* builtins use. Count only:
  // by_name stores plain counters, so sum/avg/min/max/unique can't be derived.
  function canDeriveFromLegacy(def: Satori.MetricDefinition | undefined): boolean {
    return !!(def && def.eventName && def.aggregation === "count");
  }

  function legacyCountForDay(day: LegacyAnalytics.Day, eventName: string): number {
    return (day.byName && day.byName[eventName]) || 0;
  }

  function builtinValue(day: LegacyAnalytics.Day, field: string): number {
    switch (field) {
      case "dau": return day.dau;
      case "events": return day.events;
      case "revenue": return Math.round(day.revenue * 100) / 100;
      case "sessions": return day.sessions;
      case "purchases": return day.purchases;
      case "newUsers": return day.newUsers;
    }
    return 0;
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
      checkAlerts(nk, logger, id, bucket.value, gameId);
    }
  }

  interface MetricAlert {
    metricId: string;
    threshold: number;
    operator: "gt" | "lt" | "gte" | "lte";
    name: string;
    enabled: boolean;
  }

  function getAlerts(nk: nkruntime.Nakama, gameId?: string): MetricAlert[] {
    var key = Constants.gameKey(gameId, "alerts");
    var data = Storage.readSystemJson<{ alerts: MetricAlert[] }>(nk, Constants.SATORI_METRICS_COLLECTION, key);
    return (data && data.alerts) || [];
  }

  function checkAlerts(nk: nkruntime.Nakama, logger: nkruntime.Logger, metricId: string, value: number, gameId?: string): void {
    var alerts = getAlerts(nk, gameId);
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

    var todayForFallback: LegacyAnalytics.Day | null = null;

    var metricIds = data.metricIds || Object.keys(definitions);
    for (var i = 0; i < metricIds.length; i++) {
      var metricId = metricIds[i];
      var state = getMetricState(nk, metricId, gameId);

      var latestBucket = "all";
      var latestTime = 0;
      var hasBuckets = false;
      for (var bk in state.buckets) {
        hasBuckets = true;
        var bkTime = parseInt(bk) || 0;
        if (bkTime > latestTime) {
          latestTime = bkTime;
          latestBucket = bk;
        }
      }

      var bucket = state.buckets[latestBucket];
      var value = bucket ? bucket.value : 0;

      // No capture-path state → derive today's value from the legacy
      // analytics per-day event counters (the pipeline the game actually
      // reports through).
      var defn = definitions[metricId];
      if (!hasBuckets && canDeriveFromLegacy(defn)) {
        if (!todayForFallback) {
          todayForFallback = LegacyAnalytics.readDay(nk, LegacyAnalytics.dateStrOf(Date.now()), gameId);
        }
        value = legacyCountForDay(todayForFallback, defn.eventName);
      }

      results.push({
        metricId: metricId,
        value: value,
        computedAt: now
      });
    }

    // Append built-in legacy-backed metrics (today's value) unless the caller
    // asked for a specific subset of config metrics.
    if (!data.metricIds) {
      var today = LegacyAnalytics.readDay(nk, LegacyAnalytics.dateStrOf(Date.now()), gameId);
      for (var b = 0; b < BUILTIN_METRICS.length; b++) {
        results.push({
          metricId: BUILTIN_METRICS[b].id,
          value: builtinValue(today, BUILTIN_METRICS[b].field),
          computedAt: now
        });
      }
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
    var gameId = RpcHelpers.gameId(data);
    var alerts = getAlerts(nk, gameId);
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
    var alertKey = Constants.gameKey(gameId, "alerts");
    Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, alertKey, { alerts: alerts });
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

    // Built-in legacy metric → daily series from the analytics pipeline.
    var builtin = findBuiltin(data.metricId);
    if (builtin) {
      var nowMs = Date.now();
      var seriesDays = Math.min(Math.max(parseInt(data.days, 10) || 30, 3), 60);
      var rangeDays = LegacyAnalytics.readRange(nk, nowMs, seriesDays, gameId);
      var legacyPoints: { bucketSec: number; value: number; count: number }[] = [];
      for (var rd = 0; rd < rangeDays.length; rd++) {
        var ld = rangeDays[rd];
        legacyPoints.push({
          bucketSec: Math.floor(new Date(ld.date + "T00:00:00Z").getTime() / 1000),
          value: builtinValue(ld, builtin.field),
          count: 1
        });
      }
      return RpcHelpers.successResponse({
        metricId: data.metricId,
        definition: { id: builtin.id, name: builtin.name, eventName: builtin.field, aggregation: builtin.aggregation, windowSec: 86400 },
        windowed: true,
        points: legacyPoints
      });
    }

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

    // No capture-path buckets → derive a daily series from the legacy
    // analytics per-day event counters (same source as the legacy_* builtins).
    var basis = "capture";
    if (points.length === 0 && canDeriveFromLegacy(def)) {
      basis = "legacy_by_name";
      var fbDays = Math.min(Math.max(parseInt(data.days, 10) || 30, 3), 60);
      var fbRange = LegacyAnalytics.readRange(nk, Date.now(), fbDays, gameId);
      for (var fd = 0; fd < fbRange.length; fd++) {
        var cnt = legacyCountForDay(fbRange[fd], def.eventName);
        points.push({
          bucketSec: Math.floor(new Date(fbRange[fd].date + "T00:00:00Z").getTime() / 1000),
          value: cnt,
          count: cnt
        });
      }
    }

    return RpcHelpers.successResponse({
      metricId: data.metricId,
      definition: def || null,
      windowed: !!(def && def.windowSec) || basis === "legacy_by_name",
      basis: basis,
      points: points
    });
  }

  // satori_metrics_alerts — list configured alerts + last-triggered state.
  function rpcAlertsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    return RpcHelpers.successResponse({ alerts: getAlerts(nk, RpcHelpers.gameId(data)) });
  }

  function rpcDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id) return RpcHelpers.errorResponse("id required");
    var gameId = RpcHelpers.gameId(data);
    var definitions = getMetricDefinitions(nk, gameId);
    if (!definitions[data.id]) return RpcHelpers.errorResponse("Metric not found: " + data.id);
    delete definitions[data.id];
    ConfigLoader.saveSatoriConfigForGame(nk, "metrics", gameId, definitions);
    // Also clear state bucket to free storage
    try {
      Storage.deleteRecord(nk, Constants.SATORI_METRICS_COLLECTION, Constants.gameKey(gameId, data.id), Constants.SYSTEM_USER_ID);
    } catch (_) { /* ok if not present */ }
    return RpcHelpers.successResponse({ deleted: data.id });
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
    initializer.registerRpc("satori_metrics_delete", rpcDelete);
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
