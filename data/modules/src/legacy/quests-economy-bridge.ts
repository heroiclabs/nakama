namespace LegacyQuestsEconomyBridge {

  interface BridgeConfig {
    apiBaseUrl: string;
    webhookSecret?: string;
  }

  function getBridgeConfig(nk: nkruntime.Nakama): BridgeConfig {
    var config = Storage.readSystemJson<BridgeConfig>(nk, Constants.WALLETS_COLLECTION, "bridge_config");
    return config || { apiBaseUrl: "https://quests-economy-api.intelliversex.com" };
  }

  function apiCall(nk: nkruntime.Nakama, endpoint: string, data: any): any {
    var config = getBridgeConfig(nk);
    var url = config.apiBaseUrl + endpoint;
    if (config.webhookSecret) {
      return HttpClient.signedPost(nk, url, data, config.webhookSecret);
    }
    return HttpClient.postJson(nk, url, data);
  }

  // IntelliDraws RPCs
  function rpcIntelliDrawsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var result = apiCall(nk, "/intellidraws/list", { userId: userId });
      return RpcHelpers.successResponse(result);
    } catch (err: any) {
      return RpcHelpers.errorResponse("IntelliDraws list failed: " + err.message);
    }
  }

  function rpcIntelliDrawsWinners(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var result = apiCall(nk, "/intellidraws/winners", data);
      return RpcHelpers.successResponse(result);
    } catch (err: any) {
      return RpcHelpers.errorResponse("IntelliDraws winners failed: " + err.message);
    }
  }

  function rpcIntelliDrawsEnter(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      data.userId = userId;
      var result = apiCall(nk, "/intellidraws/enter", data);
      return RpcHelpers.successResponse(result);
    } catch (err: any) {
      return RpcHelpers.errorResponse("IntelliDraws enter failed: " + err.message);
    }
  }

  function rpcIntelliDrawsPast(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var result = apiCall(nk, "/intellidraws/past", data);
      return RpcHelpers.successResponse(result);
    } catch (err: any) {
      return RpcHelpers.errorResponse("IntelliDraws past failed: " + err.message);
    }
  }

  // Conversion ratio RPCs
  function rpcConversionRatioSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var result = apiCall(nk, "/conversion/ratio/set", data);
      return RpcHelpers.successResponse(result);
    } catch (err: any) {
      return RpcHelpers.errorResponse("Conversion ratio set failed: " + err.message);
    }
  }

  function rpcConversionRatioGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var result = apiCall(nk, "/conversion/ratio/get", data);
      return RpcHelpers.successResponse(result);
    } catch (err: any) {
      return RpcHelpers.errorResponse("Conversion ratio get failed: " + err.message);
    }
  }

  // Game-to-global conversion RPCs
  function rpcGameToGlobalConvert(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      data.userId = userId;
      var result = apiCall(nk, "/wallet/game-to-global", data);
      return RpcHelpers.successResponse(result);
    } catch (err: any) {
      return RpcHelpers.errorResponse("Game to global convert failed: " + err.message);
    }
  }

  function rpcGameToGlobalPreview(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var result = apiCall(nk, "/wallet/game-to-global/preview", data);
      return RpcHelpers.successResponse(result);
    } catch (err: any) {
      return RpcHelpers.errorResponse("Game to global preview failed: " + err.message);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("intellidraws_list", rpcIntelliDrawsList);
    initializer.registerRpc("intellidraws_winners", rpcIntelliDrawsWinners);
    initializer.registerRpc("intellidraws_enter", rpcIntelliDrawsEnter);
    initializer.registerRpc("intellidraws_past", rpcIntelliDrawsPast);
    initializer.registerRpc("game_to_global_convert", rpcGameToGlobalConvert);
    initializer.registerRpc("game_to_global_preview", rpcGameToGlobalPreview);
    initializer.registerRpc("conversion_ratio_set", rpcConversionRatioSet);
    initializer.registerRpc("conversion_ratio_get", rpcConversionRatioGet);
  }
}
