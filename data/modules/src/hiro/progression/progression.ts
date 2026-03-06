namespace HiroProgression {

  var DEFAULT_CONFIG: Hiro.ProgressionConfig = {
    levels: [
      { level: 1, xpRequired: 0 },
      { level: 2, xpRequired: 100 },
      { level: 3, xpRequired: 300 },
      { level: 4, xpRequired: 600 },
      { level: 5, xpRequired: 1000 }
    ],
    maxLevel: 100
  };

  export function getConfig(nk: nkruntime.Nakama): Hiro.ProgressionConfig {
    return ConfigLoader.loadConfig<Hiro.ProgressionConfig>(nk, "progression", DEFAULT_CONFIG);
  }

  export function getUserProgression(nk: nkruntime.Nakama, userId: string, gameId?: string): Hiro.UserProgression {
    var data = Storage.readJson<Hiro.UserProgression>(nk, Constants.HIRO_PROGRESSION_COLLECTION, Constants.gameKey(gameId, "state"), userId);
    return data || { xp: 0, level: 1, totalXpEarned: 0 };
  }

  function saveUserProgression(nk: nkruntime.Nakama, userId: string, data: Hiro.UserProgression, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_PROGRESSION_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
  }

  function getLevelForXp(config: Hiro.ProgressionConfig, xp: number): number {
    var level = 1;
    for (var i = 0; i < config.levels.length; i++) {
      if (xp >= config.levels[i].xpRequired) {
        level = config.levels[i].level;
      } else {
        break;
      }
    }
    return Math.min(level, config.maxLevel);
  }

  export function addXp(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, amount: number, gameId?: string): Hiro.UserProgression {
    var config = getConfig(nk);
    var state = getUserProgression(nk, userId, gameId);
    var oldLevel = state.level;

    state.xp += amount;
    state.totalXpEarned += amount;
    state.level = getLevelForXp(config, state.xp);

    EventBus.emit(nk, logger, ctx, EventBus.Events.XP_EARNED, {
      userId: userId, amount: amount, totalXp: state.xp, level: state.level
    });

    // Grant level-up rewards
    if (state.level > oldLevel) {
      for (var l = oldLevel + 1; l <= state.level; l++) {
        var levelConfig = config.levels.find(function (lc) { return lc.level === l; });
        if (levelConfig && levelConfig.reward) {
          var resolved = RewardEngine.resolveReward(nk, levelConfig.reward);
          RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", resolved);
        }

        EventBus.emit(nk, logger, ctx, EventBus.Events.LEVEL_UP, {
          userId: userId, newLevel: l, previousLevel: l - 1
        });
      }
    }

    saveUserProgression(nk, userId, state, gameId);
    return state;
  }

  export function getXpToNextLevel(nk: nkruntime.Nakama, userId: string, gameId?: string): { current: number; required: number; remaining: number } {
    var config = getConfig(nk);
    var state = getUserProgression(nk, userId, gameId);
    var nextLevel = config.levels.find(function (lc) { return lc.level === state.level + 1; });
    var required = nextLevel ? nextLevel.xpRequired : state.xp;
    return {
      current: state.xp,
      required: required,
      remaining: Math.max(0, required - state.xp)
    };
  }

  // ---- RPCs ----

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId: string | undefined = data.gameId;
    var state = getUserProgression(nk, userId, gameId);
    var xpInfo = getXpToNextLevel(nk, userId, gameId);
    return RpcHelpers.successResponse({ progression: state, nextLevel: xpInfo });
  }

  function rpcAddXp(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.amount || data.amount <= 0) return RpcHelpers.errorResponse("Positive amount required");

    var state = addXp(nk, logger, ctx, userId, data.amount, data.gameId);
    var xpInfo = getXpToNextLevel(nk, userId, data.gameId);
    return RpcHelpers.successResponse({ progression: state, nextLevel: xpInfo });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_progression_get", rpcGet);
    initializer.registerRpc("hiro_progression_add_xp", rpcAddXp);
  }
}
