namespace SatoriWebhooks {

  interface WebhookConfig {
    webhooks: WebhookDef[];
  }

  interface WebhookDef {
    id: string;
    url: string;
    events: string[];
    enabled: boolean;
    secret?: string;
    headers?: { [key: string]: string };
    retryCount?: number;
    timeoutMs?: number;
  }

  var DEFAULT_CONFIG: WebhookConfig = { webhooks: [] };

  function getConfig(nk: nkruntime.Nakama): WebhookConfig {
    return ConfigLoader.loadSatoriConfig<WebhookConfig>(nk, "webhooks", DEFAULT_CONFIG);
  }

  export function dispatch(nk: nkruntime.Nakama, logger: nkruntime.Logger, eventName: string, payload: any): void {
    var config = getConfig(nk);
    if (!config.webhooks || config.webhooks.length === 0) return;

    for (var i = 0; i < config.webhooks.length; i++) {
      var wh = config.webhooks[i];
      if (!wh.enabled) continue;
      if (wh.events.indexOf(eventName) === -1 && wh.events.indexOf("*") === -1) continue;

      try {
        var body = JSON.stringify({
          event: eventName,
          timestamp: Math.floor(Date.now() / 1000),
          data: payload
        });

        var headers: { [key: string]: string } = {
          "Content-Type": "application/json",
          "X-Webhook-Event": eventName
        };

        if (wh.secret) {
          var sigBytes = nk.hmacSha256Hash(wh.secret, body);
          headers["X-Webhook-Signature"] = nk.binaryToString(sigBytes);
        }

        if (wh.headers) {
          for (var h in wh.headers) {
            headers[h] = wh.headers[h];
          }
        }

        nk.httpRequest(wh.url, "post", headers, body);
      } catch (e: any) {
        logger.warn("[Webhooks] Failed to dispatch '%s' to %s: %s", eventName, wh.url, e.message || String(e));
      }
    }
  }

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var config = getConfig(nk);
    return RpcHelpers.successResponse({ webhooks: config.webhooks });
  }

  function rpcUpsert(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id || !data.url || !data.events) return RpcHelpers.errorResponse("id, url, and events[] required");

    var config = getConfig(nk);
    var existing = config.webhooks.findIndex(function (w) { return w.id === data.id; });

    var wh: WebhookDef = {
      id: data.id,
      url: data.url,
      events: data.events,
      enabled: data.enabled !== false,
      secret: data.secret,
      headers: data.headers,
      retryCount: data.retryCount || 0,
      timeoutMs: data.timeoutMs || 5000
    };

    if (existing >= 0) {
      config.webhooks[existing] = wh;
    } else {
      config.webhooks.push(wh);
    }

    ConfigLoader.saveSatoriConfig(nk, "webhooks", config);
    return RpcHelpers.successResponse({ webhook: wh });
  }

  function rpcDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id) return RpcHelpers.errorResponse("id required");

    var config = getConfig(nk);
    config.webhooks = config.webhooks.filter(function (w) { return w.id !== data.id; });
    ConfigLoader.saveSatoriConfig(nk, "webhooks", config);
    return RpcHelpers.successResponse({ deleted: data.id });
  }

  function rpcTest(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id) return RpcHelpers.errorResponse("id required");

    var config = getConfig(nk);
    var wh = config.webhooks.find(function (w) { return w.id === data.id; });
    if (!wh) return RpcHelpers.errorResponse("Webhook not found");

    try {
      dispatch(nk, logger, "test_ping", { message: "Test webhook dispatch", webhookId: data.id });
      return RpcHelpers.successResponse({ success: true, url: wh.url });
    } catch (e: any) {
      return RpcHelpers.errorResponse("Test failed: " + (e.message || String(e)));
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_webhooks_list", rpcList);
    initializer.registerRpc("satori_webhooks_upsert", rpcUpsert);
    initializer.registerRpc("satori_webhooks_delete", rpcDelete);
    initializer.registerRpc("satori_webhooks_test", rpcTest);
  }

  export function registerEventHandlers(): void {
    var events = [
      EventBus.Events.CURRENCY_EARNED, EventBus.Events.CURRENCY_SPENT,
      EventBus.Events.ITEM_GRANTED, EventBus.Events.ITEM_CONSUMED,
      EventBus.Events.ACHIEVEMENT_COMPLETED, EventBus.Events.ACHIEVEMENT_CLAIMED,
      EventBus.Events.LEVEL_UP, EventBus.Events.STORE_PURCHASE,
      EventBus.Events.GAME_STARTED, EventBus.Events.GAME_COMPLETED,
      EventBus.Events.SESSION_START, EventBus.Events.SESSION_END
    ];

    for (var i = 0; i < events.length; i++) {
      (function (eventName: string) {
        EventBus.on(eventName, function (nk, logger, _ctx, data) {
          dispatch(nk, logger, eventName, data);
        });
      })(events[i]);
    }
  }
}
