namespace HiroTutorials {

  var DEFAULT_CONFIG: Hiro.TutorialsConfig = { tutorials: {} };

  export function getConfig(nk: nkruntime.Nakama): Hiro.TutorialsConfig {
    return ConfigLoader.loadConfig<Hiro.TutorialsConfig>(nk, "tutorials", DEFAULT_CONFIG);
  }

  function getUserTutorials(nk: nkruntime.Nakama, userId: string, gameId?: string): Hiro.UserTutorials {
    var data = Storage.readJson<Hiro.UserTutorials>(nk, Constants.HIRO_TUTORIALS_COLLECTION, Constants.gameKey(gameId, "progress"), userId);
    return data || { tutorials: {} };
  }

  function saveUserTutorials(nk: nkruntime.Nakama, userId: string, data: Hiro.UserTutorials, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_TUTORIALS_COLLECTION, Constants.gameKey(gameId, "progress"), userId, data);
  }

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = getConfig(nk);
    var progress = getUserTutorials(nk, userId, data.gameId);

    var result: any = {};
    for (var id in config.tutorials) {
      var def = config.tutorials[id];
      var state = progress.tutorials[id] || { step: 0 };
      result[id] = {
        name: def.name,
        totalSteps: def.steps.length,
        currentStep: state.step,
        completed: !!state.completedAt,
        steps: def.steps.map(function (s, i) {
          return { id: s.id, name: s.name, completed: i < state.step };
        })
      };
    }

    return RpcHelpers.successResponse({ tutorials: result });
  }

  function rpcAdvance(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.tutorialId) return RpcHelpers.errorResponse("tutorialId required");

    var config = getConfig(nk);
    var def = config.tutorials[data.tutorialId];
    if (!def) return RpcHelpers.errorResponse("Unknown tutorial");

    var progress = getUserTutorials(nk, userId, data.gameId);
    var state = progress.tutorials[data.tutorialId] || { step: 0 };
    if (state.completedAt) return RpcHelpers.errorResponse("Tutorial already completed");

    if (state.step < def.steps.length) {
      var stepDef = def.steps[state.step];
      if (stepDef.reward) {
        var resolved = RewardEngine.resolveReward(nk, stepDef.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
      }
      state.step++;
    }

    if (state.step >= def.steps.length) {
      state.completedAt = Math.floor(Date.now() / 1000);
      if (def.reward) {
        var finalResolved = RewardEngine.resolveReward(nk, def.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", finalResolved);
      }
    }

    progress.tutorials[data.tutorialId] = state;
    saveUserTutorials(nk, userId, progress, data.gameId);

    return RpcHelpers.successResponse({ tutorial: state });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_tutorials_get", rpcGet);
    initializer.registerRpc("hiro_tutorials_advance", rpcAdvance);
  }
}
