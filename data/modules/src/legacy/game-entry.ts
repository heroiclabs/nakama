namespace LegacyGameEntry {

  var GAME_ENTRY_COLLECTION = "game_entry";

  interface GameEntryState {
    userId: string;
    gameId: string;
    currencyId: string;
    amount: number;
    status: "validated" | "completed" | "refunded";
    validatedAt: number;
    completedAt?: number;
  }

  function getEntryKey(userId: string, gameId: string): string {
    return "entry_" + userId + "_" + gameId;
  }

  function getEntry(nk: nkruntime.Nakama, userId: string, gameId: string): GameEntryState | null {
    var key = getEntryKey(userId, gameId);
    return Storage.readJson<GameEntryState>(nk, GAME_ENTRY_COLLECTION, key, userId);
  }

  function saveEntry(nk: nkruntime.Nakama, userId: string, entry: GameEntryState): void {
    var key = getEntryKey(entry.userId, entry.gameId);
    Storage.writeJson(nk, GAME_ENTRY_COLLECTION, key, userId, entry);
  }

  function rpcGameEntryValidate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var gameId = data.gameId || "default";
      var currencyId = data.currencyId || "game";
      var amount = typeof data.amount === "number" ? data.amount : parseInt(String(data.amount || 0), 10);
      if (amount <= 0) return RpcHelpers.errorResponse("amount must be positive");
      if (!WalletHelpers.hasCurrency(nk, userId, gameId, currencyId, amount)) {
        return RpcHelpers.errorResponse("Insufficient " + currencyId);
      }
      WalletHelpers.spendCurrency(nk, logger, ctx, userId, gameId, currencyId, amount);
      var now = Math.floor(Date.now() / 1000);
      var entry: GameEntryState = {
        userId: userId,
        gameId: gameId,
        currencyId: currencyId,
        amount: amount,
        status: "validated",
        validatedAt: now
      };
      saveEntry(nk, userId, entry);
      return RpcHelpers.successResponse({ valid: true, entry: entry });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Validation failed");
    }
  }

  function rpcGameEntryComplete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var gameId = data.gameId || "default";
      var success = data.success !== false;
      var entry = getEntry(nk, userId, gameId);
      if (!entry) return RpcHelpers.errorResponse("No active entry found");
      if (entry.status !== "validated") return RpcHelpers.errorResponse("Entry already completed");
      var now = Math.floor(Date.now() / 1000);
      if (!success) {
        WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, entry.currencyId, entry.amount);
        entry.status = "refunded";
      } else {
        entry.status = "completed";
      }
      entry.completedAt = now;
      saveEntry(nk, userId, entry);
      return RpcHelpers.successResponse({ entry: entry });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Completion failed");
    }
  }

  function rpcGameEntryGetStatus(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var gameId = data.gameId || "default";
      var entry = getEntry(nk, userId, gameId);
      return RpcHelpers.successResponse({ entry: entry || null });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to get status");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("game_entry_validate", rpcGameEntryValidate);
    initializer.registerRpc("game_entry_complete", rpcGameEntryComplete);
    initializer.registerRpc("game_entry_get_status", rpcGameEntryGetStatus);
  }
}
