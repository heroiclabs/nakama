namespace HiroStats {

  var DEFAULT_CONFIG: Hiro.StatsConfig = { stats: {} };

  export function getConfig(nk: nkruntime.Nakama): Hiro.StatsConfig {
    return ConfigLoader.loadConfig<Hiro.StatsConfig>(nk, "stats", DEFAULT_CONFIG);
  }

  function getUserStats(nk: nkruntime.Nakama, userId: string, gameId?: string): Hiro.UserStats {
    var data = Storage.readJson<Hiro.UserStats>(nk, Constants.HIRO_STATS_COLLECTION, Constants.gameKey(gameId, "values"), userId);
    if (data) return data;

    var config = getConfig(nk);
    var stats: { [id: string]: number } = {};
    for (var id in config.stats) {
      stats[id] = config.stats[id].defaultValue || 0;
    }
    return { stats: stats };
  }

  function saveUserStats(nk: nkruntime.Nakama, userId: string, data: Hiro.UserStats, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_STATS_COLLECTION, Constants.gameKey(gameId, "values"), userId, data);
  }

  export function updateStat(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, statId: string, value: number, gameId?: string): number {
    var config = getConfig(nk);
    var def = config.stats[statId];
    var userStats = getUserStats(nk, userId, gameId);
    var current = userStats.stats[statId] || 0;

    var aggregation = (def && def.aggregation) || "sum";
    switch (aggregation) {
      case "sum": current += value; break;
      case "max": current = Math.max(current, value); break;
      case "min": current = Math.min(current, value); break;
      case "latest": current = value; break;
    }

    if (def && def.maxValue !== undefined) {
      current = Math.min(current, def.maxValue);
    }

    userStats.stats[statId] = current;
    saveUserStats(nk, userId, userStats, gameId);

    EventBus.emit(nk, logger, ctx, EventBus.Events.STAT_UPDATED, {
      userId: userId, statId: statId, value: current, delta: value
    });

    return current;
  }

  export function getStat(nk: nkruntime.Nakama, userId: string, statId: string, gameId?: string): number {
    var userStats = getUserStats(nk, userId, gameId);
    return userStats.stats[statId] || 0;
  }

  // ---- RPCs ----

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId: string | undefined = data.gameId;
    var userStats = getUserStats(nk, userId, gameId);
    var config = getConfig(nk);

    if (data.publicOnly) {
      var publicStats: { [id: string]: number } = {};
      for (var id in userStats.stats) {
        if (config.stats[id] && config.stats[id].isPublic) {
          publicStats[id] = userStats.stats[id];
        }
      }
      return RpcHelpers.successResponse({ stats: publicStats });
    }

    return RpcHelpers.successResponse({ stats: userStats.stats });
  }

  function rpcUpdate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.statId) return RpcHelpers.errorResponse("statId required");

    var newVal = updateStat(nk, logger, ctx, userId, data.statId, data.value || 1, data.gameId);
    return RpcHelpers.successResponse({ statId: data.statId, value: newVal });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_stats_get", rpcGet);
    initializer.registerRpc("hiro_stats_update", rpcUpdate);
  }
}
