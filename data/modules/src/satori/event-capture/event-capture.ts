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

    var preCount = events.length;
    captureEvents(nk, logger, userId, events);
    return RpcHelpers.successResponse({ captured: preCount, submitted: data.events.length });
  }

  // ---------------------------------------------------------------------------
  // External / server-to-server event capture
  // ---------------------------------------------------------------------------
  //
  // The standard `satori_event` RPC requires an authenticated userId on the
  // ctx. That works when a game client calls it (the client has a session
  // token), but it breaks the server-to-server use case: the QR Studio
  // smartlink redirector and the qr-studio NestJS backend don't have a
  // user session — they need to publish events using only the Nakama
  // `http_key` (Basic auth on the URL query string).
  //
  // `satori_event_external` accepts the same `{name, timestamp, metadata,
  // properties}` payload but additionally carries an `identity_id` field
  // (the synthetic Satori identity the publisher computed locally — for QR
  // Studio that's a SHA-256 of the UID cookie + tenant salt). The event is
  // written against that identity ID instead of `ctx.userId`. Validation
  // still runs through `SatoriTaxonomy.validateEvent`, so any QR-side
  // schema mismatch is rejected at ingest with the same fidelity as the
  // game-client path.
  //
  // The RPC also does NOT require authentication — it's intentionally
  // open to http_key callers (and only http_key callers, since Nakama
  // refuses HTTP RPC invocations without either a session token or a
  // matching http_key). Misuse vector: someone with the http_key can
  // forge events with arbitrary identity_id. That's the same trust
  // boundary as the game-client path; treat the http_key like a
  // shared secret.
  //
  // Storage layout matches `captureEvent` / `captureEvents`: events land
  // in the `satori_events` collection under SYSTEM_USER, plus a
  // per-identity rolling history under the identity_id. Downstream
  // (metrics, webhooks, data lake) gets the same fan-out so the QR
  // events show up in the Nakama console alongside game events without
  // any further plumbing.
  // ---------------------------------------------------------------------------
  // captureEventExternal — same fan-out as captureEvent but does NOT touch
  // per-user storage (Nakama requires storage userId to be a valid Nakama
  // user UUID; external publishers only have a synthetic identity_id like a
  // SHA-256 of a UID cookie). Per-identity history is therefore stored under
  // SYSTEM_USER with the identity_id baked into the key, matching the layout
  // of the per-event records below.
  //
  // Fan-out parity with captureEvent:
  //   - Validation via SatoriTaxonomy.validateEvent
  //   - Event row written to SYSTEM_USER in `satori_events` collection
  //   - SatoriMetrics.processEvent (counters, alerts, prometheus)
  //   - SatoriWebhooks.dispatch (downstream fan-out)
  //   - SatoriDataLake.exportBatch (S3 NDJSON warehouse)
  // What we skip (and why):
  //   - appendToUserHistory: requires nk.storageRead(userId) — would fail
  //   - SatoriIdentities.onEvent: also keys storage by userId
  // The skipped paths are nice-to-have for game clients, but the data still
  // exists per-event in `satori_events` keyed by identity_id, so metrics
  // dashboards and the data lake can rebuild per-identity views from there.
  function captureEventExternal(nk: nkruntime.Nakama, logger: nkruntime.Logger, identityId: string, event: Satori.CapturedEvent): boolean {
    var validation = SatoriTaxonomy.validateEvent(nk, event);
    if (!validation.valid) {
      logger.warn("[EventCaptureExternal] Rejected event '%s' (identity=%s): %s",
        event.name, identityId, validation.errors.join("; "));
      return false;
    }

    var dateStr = new Date(event.timestamp).toISOString().slice(0, 10);
    var key = "ev_ext_" + dateStr + "_" + identityId + "_" + Date.now();
    var record = {
      identityId: identityId,
      name: event.name,
      timestamp: event.timestamp,
      metadata: event.metadata || {},
      date: dateStr,
      external: true
    };

    nk.storageWrite([{
      collection: Constants.SATORI_EVENTS_COLLECTION,
      key: key,
      userId: Constants.SYSTEM_USER_ID,
      value: record,
      permissionRead: 0 as nkruntime.ReadPermissionValues,
      permissionWrite: 0 as nkruntime.WritePermissionValues
    }]);

    SatoriMetrics.processEvent(nk, logger, identityId, event.name, event.metadata || {});
    SatoriWebhooks.dispatch(nk, logger, "event:" + event.name, record);
    SatoriDataLake.exportBatch(nk, logger, [record]);
    return true;
  }

  function rpcEventExternal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("Event name required");

    var identityId = (data.identity_id || data.identityId || "").toString();
    if (!identityId) {
      identityId = "anon-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now();
    }

    var event: Satori.CapturedEvent = {
      name: data.name,
      timestamp: data.timestamp || Date.now(),
      metadata: data.metadata || {}
    };

    var captured = captureEventExternal(nk, logger, identityId, event);
    return RpcHelpers.successResponse({ success: captured, identity_id: identityId });
  }

  function rpcEventsBatchExternal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.events || !Array.isArray(data.events)) return RpcHelpers.errorResponse("events array required");

    var identityId = (data.identity_id || data.identityId || "").toString();
    if (!identityId) {
      identityId = "anon-batch-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now();
    }

    var capturedCount = 0;
    for (var i = 0; i < data.events.length; i++) {
      var e = data.events[i];
      if (!e.name) continue;
      var event: Satori.CapturedEvent = {
        name: e.name,
        timestamp: e.timestamp || Date.now(),
        metadata: e.metadata || {}
      };
      if (captureEventExternal(nk, logger, identityId, event)) capturedCount++;
    }
    return RpcHelpers.successResponse({ captured: capturedCount, submitted: data.events.length, identity_id: identityId });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_event", rpcEvent);
    initializer.registerRpc("satori_events_batch", rpcEventsBatch);
    initializer.registerRpc("satori_event_external", rpcEventExternal);
    initializer.registerRpc("satori_events_batch_external", rpcEventsBatchExternal);
  }
}
