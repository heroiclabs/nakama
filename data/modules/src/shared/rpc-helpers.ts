namespace RpcHelpers {

  export function validatePayload(payload: any, fields: string[]): { valid: boolean; missing: string[] } {
    var missing: string[] = [];
    for (var i = 0; i < fields.length; i++) {
      if (!payload.hasOwnProperty(fields[i]) || payload[fields[i]] === null || payload[fields[i]] === undefined) {
        missing.push(fields[i]);
      }
    }
    return { valid: missing.length === 0, missing: missing };
  }

  export function safeJsonParse(payload: string): { success: boolean; data: any; error: string | null } {
    try {
      var data = JSON.parse(payload);
      return { success: true, data: data, error: null };
    } catch (err: any) {
      return { success: false, data: null, error: err.message || "Invalid JSON" };
    }
  }

  export function successResponse(data: any): string {
    return JSON.stringify({ success: true, data: data });
  }

  export function errorResponse(message: string, code?: number): string {
    return JSON.stringify({ success: false, error: message, code: code || 0 });
  }

  export function parseRpcPayload(payload: string): any {
    if (!payload || payload === "") {
      return {};
    }
    var result = safeJsonParse(payload);
    if (!result.success) {
      throw new Error("Invalid JSON payload: " + result.error);
    }
    return result.data;
  }

  export function gameId(data: any): string | undefined {
    var value = data && (data.gameId || data.game_id || data.appId || data.app_id);
    return value ? String(value) : undefined;
  }

  export function logRpcError(nk: nkruntime.Nakama, logger: nkruntime.Logger, rpcName: string, errorMessage: string, userId?: string, gameId?: string): void {
    try {
      var now = new Date();
      var key = "err_" + rpcName + "_" + (userId || "system") + "_" + Date.now();
      nk.storageWrite([{
        // Errors go into the dedicated error collection. Prior to 2026-04
        // this used Constants.ANALYTICS_COLLECTION, which happened to point
        // at "analytics_error_events" too — but only because the constant
        // was misconfigured. Now that ANALYTICS_COLLECTION correctly points
        // at "analytics_events", error logging must use the dedicated
        // ANALYTICS_ERRORS_COLLECTION constant explicitly.
        collection: Constants.ANALYTICS_ERRORS_COLLECTION,
        key: key,
        userId: Constants.SYSTEM_USER_ID,
        value: {
          rpc_name: rpcName,
          error_message: errorMessage,
          user_id: userId || null,
          game_id: gameId || null,
          timestamp: now.toISOString(),
          date: now.toISOString().slice(0, 10)
        },
        permissionRead: 0,
        permissionWrite: 0
      }]);
    } catch (_) {
      // Silently ignore logging failures
    }
  }

  export function requireUserId(ctx: nkruntime.Context): string {
    if (!ctx.userId) {
      // Sentinel marker so the withCleanAuthError wrapper can convert this
      // into a clean 401-style JSON response instead of leaking the Goja
      // stack trace to anonymous clients.
      throw new Error("AUTH_REQUIRED: User ID is required");
    }
    return ctx.userId;
  }

  /**
   * Higher-order wrapper that converts AUTH_REQUIRED errors thrown by
   * requireUserId() into a clean JSON response. Apply at the
   * `initializer.registerRpc(...)` callsite for every RPC that calls
   * requireUserId(), so anonymous callers get a proper "sign in required"
   * payload instead of a Goja stack trace + HTTP 500.
   *
   * Usage:
   *   initializer.registerRpc("tournament_enter",
   *     RpcHelpers.withCleanAuthError(rpcEnter));
   */
  export function withCleanAuthError(
    handler: (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string
  ): (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string {
    return function (ctx, logger, nk, payload) {
      try {
        return handler(ctx, logger, nk, payload);
      } catch (err: any) {
        var msg = (err && err.message) ? String(err.message) : "";
        if (msg.indexOf("AUTH_REQUIRED") >= 0 || msg.indexOf("User ID is required") >= 0) {
          return JSON.stringify({
            success: false,
            error: "sign in required",
            code: "unauthenticated",
            http_status: 401,
          });
        }
        throw err;
      }
    };
  }

  export function resolveUserId(ctx: nkruntime.Context, payload?: any): string {
    if (ctx.userId) {
      return ctx.userId;
    }
    if (payload && typeof payload.userId === "string" && payload.userId.length > 0) {
      return payload.userId;
    }
    throw new Error("User ID is required (provide via auth token or 'userId' field in payload)");
  }

  export function requireAdmin(ctx: nkruntime.Context, nk: nkruntime.Nakama): void {
    // Server-to-server calls via http_key have no userId — treat as trusted
    if (!ctx.userId) return;
    try {
      var accounts = nk.accountsGetId([ctx.userId]);
      if (accounts && accounts.length > 0) {
        var metadata = accounts[0].user.metadata;
        if (metadata && (metadata as any).admin === true) return;
      }
    } catch (_) {}
    throw new Error("Admin access required");
  }
}
