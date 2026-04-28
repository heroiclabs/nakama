namespace LegacyPush {

  interface PushTokenData {
    tokens: {
      token: string;
      platform: string;
      updatedAt: number;
      endpointArn?: string;
      provider?: string;
      providerRegisteredAt?: number;
      providerError?: string;
    }[];
  }

  var DEFAULT_PUSH_NOTIFICATION_CODE = 7001;

  function getPushTokens(nk: nkruntime.Nakama, userId: string): PushTokenData {
    var key = "token_" + userId;
    var data = Storage.readJson<PushTokenData>(nk, Constants.PUSH_TOKENS_COLLECTION, key, userId);
    return data || { tokens: [] };
  }

  function savePushTokens(nk: nkruntime.Nakama, userId: string, data: PushTokenData): void {
    var key = "token_" + userId;
    Storage.writeJson(nk, Constants.PUSH_TOKENS_COLLECTION, key, userId, data);
  }

  function env(ctx: nkruntime.Context, key: string): string {
    return (ctx.env && ctx.env[key]) || "";
  }

  function parseJsonSafe(raw: string): any {
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }

  function normalizePlatform(platform: string): string {
    var p = String(platform || "unknown").toLowerCase();
    if (p === "ios" || p === "apns" || p === "apple") return "ios";
    if (p === "android" || p === "fcm" || p === "gcm") return "android";
    if (p === "web") return "web";
    return p;
  }

  function registerProviderEndpoint(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, userId: string, token: string, platform: string, gameId: string): any {
    var registerUrl = env(ctx, "PUSH_REGISTER_URL") || env(ctx, "PUSH_LAMBDA_URL");
    if (!registerUrl) return { configured: false };

    try {
      var body = JSON.stringify({
        userId: userId,
        gameId: gameId || "quizverse",
        deviceToken: token,
        token: token,
        platform: normalizePlatform(platform)
      });
      var resp: any = nk.httpRequest(registerUrl, "post", { "Content-Type": "application/json" }, body, 10000);
      var parsed = parseJsonSafe(resp && resp.body ? resp.body : "");
      var responseBody = parsed && parsed.body && typeof parsed.body === "string" ? parseJsonSafe(parsed.body) : parsed;
      var code = resp && resp.code ? resp.code : 0;
      if (code >= 200 && code < 300 && responseBody && responseBody.success !== false) {
        return {
          configured: true,
          success: true,
          provider: "sns",
          endpointArn: responseBody.endpointArn || responseBody.EndpointArn,
          raw: responseBody
        };
      }
      return {
        configured: true,
        success: false,
        error: (responseBody && (responseBody.error || responseBody.message)) || ("Provider registration failed with HTTP " + code)
      };
    } catch (e: any) {
      logger.error("[LegacyPush] provider registration failed: %s", e.message || String(e));
      return { configured: true, success: false, error: e.message || String(e) };
    }
  }

  function sendProviderPush(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, endpoint: any, payload: any): any {
    var sendUrl = env(ctx, "PUSH_SEND_URL");
    if (!sendUrl) return { configured: false };
    if (!endpoint.endpointArn) return { configured: true, success: false, error: "endpointArn missing" };

    try {
      var body = JSON.stringify({
        endpointArn: endpoint.endpointArn,
        platform: normalizePlatform(endpoint.platform),
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        gameId: payload.gameId || "quizverse",
        eventType: payload.eventType || "push_event"
      });
      var resp: any = nk.httpRequest(sendUrl, "post", { "Content-Type": "application/json" }, body, 10000);
      var parsed = parseJsonSafe(resp && resp.body ? resp.body : "");
      var responseBody = parsed && parsed.body && typeof parsed.body === "string" ? parseJsonSafe(parsed.body) : parsed;
      var code = resp && resp.code ? resp.code : 0;
      if (code >= 200 && code < 300 && responseBody && responseBody.success !== false) {
        return { configured: true, success: true, messageId: responseBody.messageId, raw: responseBody };
      }
      return {
        configured: true,
        success: false,
        error: (responseBody && (responseBody.error || responseBody.message)) || ("Provider send failed with HTTP " + code)
      };
    } catch (e: any) {
      logger.error("[LegacyPush] provider send failed: %s", e.message || String(e));
      return { configured: true, success: false, error: e.message || String(e) };
    }
  }

  function rpcPushRegisterToken(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var token = data.token;
      var platform = data.platform || "unknown";
      var gameId = data.gameId || data.game_id || "quizverse";
      if (!token) return RpcHelpers.errorResponse("token required");
      var tokensData = getPushTokens(nk, userId);
      var now = Math.floor(Date.now() / 1000);
      var provider = registerProviderEndpoint(ctx, logger, nk, userId, token, platform, gameId);
      var existing = tokensData.tokens.find(function (t) { return t.token === token; });
      if (existing) {
        existing.platform = platform;
        existing.updatedAt = now;
        if (provider.endpointArn) existing.endpointArn = provider.endpointArn;
        if (provider.success) {
          existing.provider = provider.provider || "sns";
          existing.providerRegisteredAt = now;
          existing.providerError = undefined;
        } else if (provider.configured) {
          existing.providerError = provider.error || "Provider registration failed";
        }
      } else {
        tokensData.tokens.push({
          token: token,
          platform: platform,
          updatedAt: now,
          endpointArn: provider.endpointArn,
          provider: provider.success ? (provider.provider || "sns") : undefined,
          providerRegisteredAt: provider.success ? now : undefined,
          providerError: provider.configured && !provider.success ? (provider.error || "Provider registration failed") : undefined
        });
      }
      savePushTokens(nk, userId, tokensData);
      return RpcHelpers.successResponse({ success: true, provider: provider });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to register token");
    }
  }

  function rpcPushSendEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var targetUserId = data.userId || data.targetUserId;
      var subject = data.subject || data.eventType || "push_event";
      var content = data.content || {
        eventType: data.eventType || subject,
        title: data.title || subject,
        body: data.body || "",
        data: data.data || {}
      };
      var code = Number(data.code || DEFAULT_PUSH_NOTIFICATION_CODE);
      if (!targetUserId) return RpcHelpers.errorResponse("userId required");
      if (!code || code <= 0) code = DEFAULT_PUSH_NOTIFICATION_CODE;
      var title = content.title || subject;
      var body = content.body || "";
      var tokensData = getPushTokens(nk, targetUserId);
      var providerResults: any[] = [];
      for (var i = 0; i < tokensData.tokens.length; i++) {
        var t: any = tokensData.tokens[i];
        var providerResult = sendProviderPush(ctx, logger, nk, t, {
          title: title,
          body: body,
          data: content.data || {},
          gameId: data.gameId || data.game_id || "quizverse",
          eventType: data.eventType || subject
        });
        if (providerResult.configured) providerResults.push({
          platform: t.platform,
          endpointArn: t.endpointArn,
          success: providerResult.success === true,
          messageId: providerResult.messageId,
          error: providerResult.error
        });
      }
      nk.notificationsSend([{
        userId: targetUserId,
        subject: subject,
        content: content,
        code: code,
        persistent: data.persistent !== false
      }]);
      return RpcHelpers.successResponse({
        success: true,
        messageId: "nakama_notification_" + Date.now(),
        eventType: data.eventType || subject,
        recipientCount: 1,
        providerConfigured: providerResults.length > 0,
        providerResults: providerResults,
        sentAt: new Date().toISOString()
      });
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
        return {
          token: t.token,
          platform: t.platform,
          endpointArn: t.endpointArn,
          provider: t.provider,
          providerRegisteredAt: t.providerRegisteredAt,
          providerError: t.providerError
        };
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
