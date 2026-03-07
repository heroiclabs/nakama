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

  export function logRpcError(nk: nkruntime.Nakama, logger: nkruntime.Logger, rpcName: string, errorMessage: string, userId?: string, gameId?: string): void {
    try {
      var now = new Date();
      var key = "err_" + rpcName + "_" + (userId || "system") + "_" + Date.now();
      nk.storageWrite([{
        collection: Constants.ANALYTICS_COLLECTION,
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
      throw new Error("User ID is required");
    }
    return ctx.userId;
  }

  export function requireAdmin(ctx: nkruntime.Context, nk: nkruntime.Nakama): void {
    if (!ctx.userId) throw new Error("Authentication required");
    try {
      var accounts = nk.accountsGetId([ctx.userId]);
      if (accounts && accounts.length > 0) {
        var metadata = accounts[0].user.metadata;
        if (metadata && (metadata as any).admin === true) return;
      }
    } catch (_) {}
    // For development, allow all authenticated users admin access
    // In production, uncomment the line below:
    // throw new Error("Admin access required");
  }
}
