namespace SatoriEventCapture {

  function appendToUserHistory(nk: nkruntime.Nakama, userId: string, event: Satori.CapturedEvent): void {
    var history = Storage.readJson<{ events: any[] }>(nk, Constants.SATORI_EVENTS_COLLECTION, "history", userId);
    if (!history) history = { events: [] };
    history.events.push({
      name: event.name,
      timestamp: event.timestamp,
      metadata: event.metadata || {}
    });
    if (history.events.length > 500) {
      history.events = history.events.slice(history.events.length - 500);
    }
    Storage.writeJson(nk, Constants.SATORI_EVENTS_COLLECTION, "history", userId, history);
  }

  export function captureEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, event: Satori.CapturedEvent): void {
    var validation = SatoriTaxonomy.validateEvent(nk, event);
    if (!validation.valid) {
      logger.warn("[EventCapture] Rejected event '%s': %s", event.name, validation.errors.join("; "));
      return;
    }

    var dateStr = new Date(event.timestamp).toISOString().slice(0, 10);
    var key = "ev_" + dateStr + "_" + userId + "_" + Date.now();
    var record = {
      userId: userId,
      name: event.name,
      timestamp: event.timestamp,
      metadata: event.metadata || {},
      date: dateStr
    };

    nk.storageWrite([{
      collection: Constants.SATORI_EVENTS_COLLECTION,
      key: key,
      userId: Constants.SYSTEM_USER_ID,
      value: record,
      permissionRead: 0 as nkruntime.ReadPermissionValues,
      permissionWrite: 0 as nkruntime.WritePermissionValues
    }]);

    appendToUserHistory(nk, userId, event);
    SatoriIdentities.onEvent(nk, logger, userId, event);
    SatoriMetrics.processEvent(nk, logger, userId, event.name, event.metadata || {});
    SatoriWebhooks.dispatch(nk, logger, "event:" + event.name, record);
    SatoriDataLake.exportBatch(nk, logger, [record]);
  }

  export function captureEvents(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, events: Satori.CapturedEvent[]): void {
    var writes: nkruntime.StorageWriteRequest[] = [];
    var validEvents: Satori.CapturedEvent[] = [];
    var exportRecords: any[] = [];

    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      var validation = SatoriTaxonomy.validateEvent(nk, event);
      if (!validation.valid) {
        continue;
      }
      validEvents.push(event);

      var dateStr = new Date(event.timestamp).toISOString().slice(0, 10);
      var key = "ev_" + dateStr + "_" + userId + "_" + (Date.now() + i);
      var record = {
        userId: userId,
        name: event.name,
        timestamp: event.timestamp,
        metadata: event.metadata || {},
        date: dateStr
      };
      exportRecords.push(record);

      writes.push({
        collection: Constants.SATORI_EVENTS_COLLECTION,
        key: key,
        userId: Constants.SYSTEM_USER_ID,
        value: record,
        permissionRead: 0 as nkruntime.ReadPermissionValues,
        permissionWrite: 0 as nkruntime.WritePermissionValues
      });
    }
    if (writes.length > 0) {
      Storage.writeMultiple(nk, writes);
    }
    for (var j = 0; j < validEvents.length; j++) {
      appendToUserHistory(nk, userId, validEvents[j]);
      SatoriIdentities.onEvent(nk, logger, userId, validEvents[j]);
      SatoriMetrics.processEvent(nk, logger, userId, validEvents[j].name, validEvents[j].metadata || {});
      SatoriWebhooks.dispatch(nk, logger, "event:" + validEvents[j].name, exportRecords[j]);
    }
    if (exportRecords.length > 0) {
      SatoriDataLake.exportBatch(nk, logger, exportRecords);
    }
  }

  // ---- RPCs ----

  function rpcEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("Event name required");

    var event: Satori.CapturedEvent = {
      name: data.name,
      timestamp: data.timestamp || Date.now(),
      metadata: data.metadata
    };
    captureEvent(nk, logger, userId, event);
    return RpcHelpers.successResponse({ success: true });
  }

  function rpcEventsBatch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.events || !Array.isArray(data.events)) return RpcHelpers.errorResponse("events array required");

    var events: Satori.CapturedEvent[] = [];
    for (var i = 0; i < data.events.length; i++) {
      var e = data.events[i];
      if (!e.name) continue;
      events.push({
        name: e.name,
        timestamp: e.timestamp || Date.now(),
        metadata: e.metadata
      });
    }

    captureEvents(nk, logger, userId, events);
    return RpcHelpers.successResponse({ captured: events.length });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_event", rpcEvent);
    initializer.registerRpc("satori_events_batch", rpcEventsBatch);
  }
}
