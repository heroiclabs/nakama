namespace LegacyGameRegistry {

  interface GameEntry {
    id: string;
    title: string;
    description?: string;
    category?: string;
    status?: string;
    iconUrl?: string;
    bannerUrl?: string;
    minPlayers?: number;
    maxPlayers?: number;
    createdAt?: string;
    updatedAt?: string;
  }

  interface GameRegistryData {
    games: GameEntry[];
    lastSyncAt?: string;
  }

  function getGameRegistry(nk: nkruntime.Nakama): GameRegistryData {
    var data = Storage.readSystemJson<GameRegistryData>(nk, Constants.GAME_REGISTRY_COLLECTION, "registry");
    return data || { games: [] };
  }

  function rpcGetGameRegistry(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var registry = getGameRegistry(nk);
    return RpcHelpers.successResponse({ games: registry.games, lastSyncAt: registry.lastSyncAt });
  }

  function rpcGetGameById(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.gameId) return RpcHelpers.errorResponse("gameId required");

    var registry = getGameRegistry(nk);
    var game = registry.games.find(function (g) { return g.id === data.gameId; });
    if (!game) return RpcHelpers.errorResponse("Game not found: " + data.gameId);

    return RpcHelpers.successResponse({ game: game });
  }

  function rpcSyncGameRegistry(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var apiUrl = data.apiUrl || "https://api.intelliversex.com/games";

      var response: any;
      try {
        response = HttpClient.get(nk, apiUrl);
      } catch (err: any) {
        logger.warn("[GameRegistry] API fetch failed, using existing data: " + err.message);
        var existing = getGameRegistry(nk);
        return RpcHelpers.successResponse({ success: true, gamesSync: existing.games.length, source: "cache" });
      }

      var games: GameEntry[] = [];
      if (response && response.code === 200 && response.body) {
        try {
          var parsed = JSON.parse(response.body);
          games = parsed.games || parsed.data || parsed || [];
        } catch (_) {
          games = [];
        }
      }

      var registry: GameRegistryData = {
        games: games,
        lastSyncAt: new Date().toISOString()
      };
      Storage.writeSystemJson(nk, Constants.GAME_REGISTRY_COLLECTION, "registry", registry);

      return RpcHelpers.successResponse({ success: true, gamesSync: games.length });
    } catch (err: any) {
      return RpcHelpers.errorResponse("Sync failed: " + err.message);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("get_game_registry", rpcGetGameRegistry);
    initializer.registerRpc("get_game_by_id", rpcGetGameById);
    initializer.registerRpc("sync_game_registry", rpcSyncGameRegistry);
  }
}
