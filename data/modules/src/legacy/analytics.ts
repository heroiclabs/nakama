namespace LegacyAnalytics {

  function rpcAnalyticsLogEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var eventName = data.name || data.eventName || "unknown";
      var properties = data.properties || data.data || {};
      var timestamp = Math.floor(Date.now() / 1000);
      var key = "evt_" + timestamp + "_" + userId + "_" + nk.uuidv4().slice(0, 8);
      var record = {
        eventName: eventName,
        userId: userId,
        properties: properties,
        timestamp: timestamp,
        date: new Date().toISOString().slice(0, 10)
      };
      nk.storageWrite([{
        collection: Constants.ANALYTICS_COLLECTION,
        key: key,
        userId: Constants.SYSTEM_USER_ID,
        value: record,
        permissionRead: 0,
        permissionWrite: 0
      }]);
      return RpcHelpers.successResponse({ success: true, key: key });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to log event");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("analytics_log_event", rpcAnalyticsLogEvent);
  }
}
