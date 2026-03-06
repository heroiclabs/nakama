namespace SatoriDataLake {

  interface ExportTarget {
    id: string;
    type: "bigquery" | "snowflake" | "redshift" | "s3";
    enabled: boolean;
    config: { [key: string]: string };
    eventFilters?: string[];
    batchSize?: number;
    flushIntervalSec?: number;
  }

  interface DataLakeConfig {
    targets: ExportTarget[];
    retentionDays: number;
    enabledGlobally: boolean;
  }

  var DEFAULT_CONFIG: DataLakeConfig = {
    targets: [],
    retentionDays: 90,
    enabledGlobally: false
  };

  function getConfig(nk: nkruntime.Nakama): DataLakeConfig {
    return ConfigLoader.loadSatoriConfig<DataLakeConfig>(nk, "data_lake", DEFAULT_CONFIG);
  }

  function buildExportPayload(events: any[]): string {
    var lines: string[] = [];
    for (var i = 0; i < events.length; i++) {
      lines.push(JSON.stringify(events[i]));
    }
    return lines.join("\n");
  }

  export function exportBatch(nk: nkruntime.Nakama, logger: nkruntime.Logger, events: any[]): void {
    var config = getConfig(nk);
    if (!config.enabledGlobally || config.targets.length === 0 || events.length === 0) return;

    var payload = buildExportPayload(events);

    for (var i = 0; i < config.targets.length; i++) {
      var target = config.targets[i];
      if (!target.enabled) continue;

      try {
        switch (target.type) {
          case "s3":
            exportToS3(nk, logger, target, payload);
            break;
          case "bigquery":
            exportToBigQuery(nk, logger, target, events);
            break;
          case "snowflake":
            exportToSnowflake(nk, logger, target, events);
            break;
          case "redshift":
            exportToRedshift(nk, logger, target, events);
            break;
        }
      } catch (e: any) {
        logger.warn("[DataLake] Export to %s/%s failed: %s", target.type, target.id, e.message || String(e));
      }
    }
  }

  function exportToS3(nk: nkruntime.Nakama, logger: nkruntime.Logger, target: ExportTarget, payload: string): void {
    var bucket = target.config["bucket"];
    var region = target.config["region"] || "us-east-1";
    var prefix = target.config["prefix"] || "satori-events";
    var endpoint = target.config["endpoint"];

    if (!bucket || !endpoint) {
      logger.warn("[DataLake/S3] Missing bucket or endpoint config for target %s", target.id);
      return;
    }

    var dateStr = new Date().toISOString().slice(0, 10);
    var ts = Date.now();
    var key = prefix + "/" + dateStr + "/" + ts + ".jsonl";

    var url = endpoint + "/" + bucket + "/" + key;
    var headers: { [key: string]: string } = {
      "Content-Type": "application/x-ndjson"
    };
    if (target.config["apiKey"]) {
      headers["Authorization"] = "Bearer " + target.config["apiKey"];
    }

    nk.httpRequest(url, "put", headers, payload);
    logger.info("[DataLake/S3] Exported %d bytes to %s", payload.length, key);
  }

  function exportToBigQuery(nk: nkruntime.Nakama, logger: nkruntime.Logger, target: ExportTarget, events: any[]): void {
    var endpoint = target.config["endpoint"];
    if (!endpoint) {
      logger.warn("[DataLake/BigQuery] Missing endpoint for target %s", target.id);
      return;
    }

    var headers: { [key: string]: string } = {
      "Content-Type": "application/json"
    };
    if (target.config["apiKey"]) {
      headers["Authorization"] = "Bearer " + target.config["apiKey"];
    }

    var body = JSON.stringify({ rows: events.map(function (e) { return { json: e }; }) });
    nk.httpRequest(endpoint, "post", headers, body);
    logger.info("[DataLake/BigQuery] Exported %d events to %s", events.length, target.id);
  }

  function exportToSnowflake(nk: nkruntime.Nakama, logger: nkruntime.Logger, target: ExportTarget, events: any[]): void {
    var endpoint = target.config["endpoint"];
    if (!endpoint) {
      logger.warn("[DataLake/Snowflake] Missing endpoint for target %s", target.id);
      return;
    }

    var headers: { [key: string]: string } = {
      "Content-Type": "application/json"
    };
    if (target.config["token"]) {
      headers["Authorization"] = "Snowflake Token=\"" + target.config["token"] + "\"";
    }

    var body = JSON.stringify(events);
    nk.httpRequest(endpoint, "post", headers, body);
    logger.info("[DataLake/Snowflake] Exported %d events to %s", events.length, target.id);
  }

  function exportToRedshift(nk: nkruntime.Nakama, logger: nkruntime.Logger, target: ExportTarget, events: any[]): void {
    var endpoint = target.config["endpoint"];
    if (!endpoint) {
      logger.warn("[DataLake/Redshift] Missing endpoint for target %s", target.id);
      return;
    }

    var headers: { [key: string]: string } = {
      "Content-Type": "application/json"
    };
    if (target.config["apiKey"]) {
      headers["Authorization"] = "Bearer " + target.config["apiKey"];
    }

    var body = JSON.stringify({ records: events });
    nk.httpRequest(endpoint, "post", headers, body);
    logger.info("[DataLake/Redshift] Exported %d events to %s", events.length, target.id);
  }

  function rpcGetConfig(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var config = getConfig(nk);
    return RpcHelpers.successResponse(config);
  }

  function rpcUpsertTarget(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id || !data.type) return RpcHelpers.errorResponse("id and type required");

    var validTypes = ["bigquery", "snowflake", "redshift", "s3"];
    if (validTypes.indexOf(data.type) === -1) return RpcHelpers.errorResponse("type must be one of: " + validTypes.join(", "));

    var config = getConfig(nk);
    var idx = config.targets.findIndex(function (t) { return t.id === data.id; });

    var target: ExportTarget = {
      id: data.id,
      type: data.type,
      enabled: data.enabled !== false,
      config: data.config || {},
      eventFilters: data.eventFilters,
      batchSize: data.batchSize || 100,
      flushIntervalSec: data.flushIntervalSec || 300
    };

    if (idx >= 0) {
      config.targets[idx] = target;
    } else {
      config.targets.push(target);
    }

    ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
    return RpcHelpers.successResponse({ target: target });
  }

  function rpcDeleteTarget(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id) return RpcHelpers.errorResponse("id required");

    var config = getConfig(nk);
    config.targets = config.targets.filter(function (t) { return t.id !== data.id; });
    ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
    return RpcHelpers.successResponse({ deleted: data.id });
  }

  function rpcSetEnabled(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = getConfig(nk);
    config.enabledGlobally = !!data.enabled;
    ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
    return RpcHelpers.successResponse({ enabledGlobally: config.enabledGlobally });
  }

  function rpcSetRetention(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.days || data.days < 1) return RpcHelpers.errorResponse("days required (positive integer)");

    var config = getConfig(nk);
    config.retentionDays = data.days;
    ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
    return RpcHelpers.successResponse({ retentionDays: config.retentionDays });
  }

  function rpcManualExport(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);

    var events: any[] = [];
    var cursor = "";
    var limit = data.limit || 500;

    var result = nk.storageList(Constants.SYSTEM_USER_ID, Constants.SATORI_EVENTS_COLLECTION, limit > 100 ? 100 : limit, cursor);
    if (result.objects) {
      for (var i = 0; i < result.objects.length; i++) {
        events.push(result.objects[i].value);
      }
    }

    if (events.length > 0) {
      exportBatch(nk, logger, events);
    }

    return RpcHelpers.successResponse({ exportedCount: events.length });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_datalake_config", rpcGetConfig);
    initializer.registerRpc("satori_datalake_upsert_target", rpcUpsertTarget);
    initializer.registerRpc("satori_datalake_delete_target", rpcDeleteTarget);
    initializer.registerRpc("satori_datalake_set_enabled", rpcSetEnabled);
    initializer.registerRpc("satori_datalake_set_retention", rpcSetRetention);
    initializer.registerRpc("satori_datalake_manual_export", rpcManualExport);
  }
}
