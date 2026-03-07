namespace LegacyPush {

  interface PushTokenData {
    tokens: { token: string; platform: string; updatedAt: number }[];
  }

  function getPushTokens(nk: nkruntime.Nakama, userId: string): PushTokenData {
    var key = "token_" + userId;
    var data = Storage.readJson<PushTokenData>(nk, Constants.PUSH_TOKENS_COLLECTION, key, userId);
    return data || { tokens: [] };
  }

  function savePushTokens(nk: nkruntime.Nakama, userId: string, data: PushTokenData): void {
    var key = "token_" + userId;
    Storage.writeJson(nk, Constants.PUSH_TOKENS_COLLECTION, key, userId, data);
  }

  function rpcPushRegisterToken(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var token = data.token;
      var platform = data.platform || "unknown";
      if (!token) return RpcHelpers.errorResponse("token required");
      var tokensData = getPushTokens(nk, userId);
      var now = Math.floor(Date.now() / 1000);
      var existing = tokensData.tokens.find(function (t) { return t.token === token; });
      if (existing) {
        existing.platform = platform;
        existing.updatedAt = now;
      } else {
        tokensData.tokens.push({ token: token, platform: platform, updatedAt: now });
      }
      savePushTokens(nk, userId, tokensData);
      return RpcHelpers.successResponse({ success: true });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to register token");
    }
  }

  function rpcPushSendEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var targetUserId = data.userId || data.targetUserId;
      var subject = data.subject || "push_event";
      var content = data.content || {};
      if (!targetUserId) return RpcHelpers.errorResponse("userId required");
      nk.notificationsSend([{
        userId: targetUserId,
        subject: subject,
        content: content,
        code: data.code || 0,
        persistent: data.persistent !== false
      }]);
      return RpcHelpers.successResponse({ success: true });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to send event");
    }
  }

  function rpcPushGetEndpoints(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var targetUserId = data.userId || userId;
      var tokensData = getPushTokens(nk, targetUserId);
      var endpoints = tokensData.tokens.map(function (t) {
        return { token: t.token, platform: t.platform };
      });
      return RpcHelpers.successResponse({ endpoints: endpoints });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to get endpoints");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("push_register_token", rpcPushRegisterToken);
    initializer.registerRpc("push_send_event", rpcPushSendEvent);
    initializer.registerRpc("push_get_endpoints", rpcPushGetEndpoints);
  }
}
