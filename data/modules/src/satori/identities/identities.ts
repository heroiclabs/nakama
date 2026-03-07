namespace SatoriIdentities {

  function getProperties(nk: nkruntime.Nakama, userId: string): Satori.IdentityProperties {
    var data = Storage.readJson<Satori.IdentityProperties>(nk, Constants.SATORI_IDENTITY_COLLECTION, "props", userId);
    return data || {
      defaultProperties: {},
      customProperties: {},
      computedProperties: {}
    };
  }

  function saveProperties(nk: nkruntime.Nakama, userId: string, props: Satori.IdentityProperties): void {
    Storage.writeJson(nk, Constants.SATORI_IDENTITY_COLLECTION, "props", userId, props);
  }

  export function onEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, event: Satori.CapturedEvent): void {
    try {
      var props = getProperties(nk, userId);
      var now = new Date().toISOString();

      if (!props.defaultProperties.first_seen) {
        props.defaultProperties.first_seen = now;
      }
      props.defaultProperties.last_seen = now;

      var sessionCount = parseInt(props.computedProperties.session_count || "0");
      if (event.name === "session_start") {
        props.computedProperties.session_count = String(sessionCount + 1);
      }

      var eventCount = parseInt(props.computedProperties["event_count_" + event.name] || "0");
      props.computedProperties["event_count_" + event.name] = String(eventCount + 1);

      var totalEvents = parseInt(props.computedProperties.total_events || "0");
      props.computedProperties.total_events = String(totalEvents + 1);

      if (event.name === "purchase" && event.metadata && event.metadata.amount) {
        var totalSpend = parseFloat(props.computedProperties.total_spend || "0");
        totalSpend += parseFloat(event.metadata.amount);
        props.computedProperties.total_spend = String(totalSpend);
      }

      saveProperties(nk, userId, props);
    } catch (err: any) {
      logger.warn("SatoriIdentities.onEvent error: %s", err.message || String(err));
    }
  }

  export function getProperty(nk: nkruntime.Nakama, userId: string, key: string): string | null {
    var props = getProperties(nk, userId);
    return props.defaultProperties[key] || props.customProperties[key] || props.computedProperties[key] || null;
  }

  export function getAllProperties(nk: nkruntime.Nakama, userId: string): Satori.IdentityProperties {
    return getProperties(nk, userId);
  }

  // ---- RPCs ----

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var props = getProperties(nk, userId);
    return RpcHelpers.successResponse({ properties: props });
  }

  function rpcUpdate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var props = getProperties(nk, userId);

    if (data.defaultProperties) {
      for (var k in data.defaultProperties) {
        props.defaultProperties[k] = data.defaultProperties[k];
      }
    }
    if (data.customProperties) {
      for (var ck in data.customProperties) {
        props.customProperties[ck] = data.customProperties[ck];
      }
    }

    saveProperties(nk, userId, props);
    return RpcHelpers.successResponse({ properties: props });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_identity_get", rpcGet);
    initializer.registerRpc("satori_identity_update_properties", rpcUpdate);
  }
}
