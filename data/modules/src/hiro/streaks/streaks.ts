namespace HiroStreaks {

  var DEFAULT_CONFIG: Hiro.StreaksConfig = { streaks: {} };

  export function getConfig(nk: nkruntime.Nakama): Hiro.StreaksConfig {
    return ConfigLoader.loadConfig<Hiro.StreaksConfig>(nk, "streaks", DEFAULT_CONFIG);
  }

  function getUserStreaks(nk: nkruntime.Nakama, userId: string, gameId?: string): Hiro.UserStreaks {
    var data = Storage.readJson<Hiro.UserStreaks>(nk, Constants.HIRO_STREAKS_COLLECTION, Constants.gameKey(gameId, "state"), userId);
    return data || { streaks: {} };
  }

  function saveUserStreaks(nk: nkruntime.Nakama, userId: string, data: Hiro.UserStreaks, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_STREAKS_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
  }

  export function updateStreak(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, streakId: string, gameId?: string): Hiro.UserStreakState {
    var config = getConfig(nk);
    var def = config.streaks[streakId];
    if (!def) throw new Error("Unknown streak: " + streakId);

    var streaks = getUserStreaks(nk, userId, gameId);
    var state = streaks.streaks[streakId];
    var now = Math.floor(Date.now() / 1000);

    if (!state) {
      state = { count: 0, lastUpdateAt: 0, claimedMilestones: [] };
    }

    var elapsed = now - state.lastUpdateAt;
    var gracePeriod = def.gracePeriodSec || 0;

    if (state.lastUpdateAt > 0 && elapsed > def.resetIntervalSec + gracePeriod) {
      EventBus.emit(nk, logger, ctx, EventBus.Events.STREAK_BROKEN, {
        userId: userId, streakId: streakId, count: state.count
      });
      state.count = 0;
      state.claimedMilestones = [];
    }

    if (elapsed >= def.resetIntervalSec || state.lastUpdateAt === 0) {
      state.count++;
      state.lastUpdateAt = now;

      EventBus.emit(nk, logger, ctx, EventBus.Events.STREAK_UPDATED, {
        userId: userId, streakId: streakId, count: state.count
      });
    }

    streaks.streaks[streakId] = state;
    saveUserStreaks(nk, userId, streaks, gameId);
    return state;
  }

  // ---- RPCs ----

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId: string | undefined = data.gameId;
    var config = getConfig(nk);
    var streaks = getUserStreaks(nk, userId, gameId);

    var result: any = {};
    for (var id in config.streaks) {
      var def = config.streaks[id];
      var state = streaks.streaks[id] || { count: 0, lastUpdateAt: 0, claimedMilestones: [] };
      var milestones: any[] = [];
      for (var count in def.milestones) {
        milestones.push({
          count: parseInt(count),
          claimed: state.claimedMilestones.indexOf(count) >= 0,
          reachable: state.count >= parseInt(count)
        });
      }
      result[id] = { name: def.name, count: state.count, lastUpdateAt: state.lastUpdateAt, milestones: milestones };
    }

    return RpcHelpers.successResponse({ streaks: result });
  }

  function rpcUpdate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.streakId) return RpcHelpers.errorResponse("streakId required");

    var state = updateStreak(nk, logger, ctx, userId, data.streakId, data.gameId);
    return RpcHelpers.successResponse({ streak: state });
  }

  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.streakId || !data.milestone) return RpcHelpers.errorResponse("streakId and milestone required");

    var config = getConfig(nk);
    var def = config.streaks[data.streakId];
    if (!def) return RpcHelpers.errorResponse("Unknown streak");

    var milestone = String(data.milestone);
    var reward = def.milestones[milestone];
    if (!reward) return RpcHelpers.errorResponse("Unknown milestone");

    var streaks = getUserStreaks(nk, userId, data.gameId);
    var state = streaks.streaks[data.streakId];
    if (!state || state.count < parseInt(milestone)) return RpcHelpers.errorResponse("Milestone not reached");
    if (state.claimedMilestones.indexOf(milestone) >= 0) return RpcHelpers.errorResponse("Already claimed");

    var resolved = RewardEngine.resolveReward(nk, reward);
    RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);

    state.claimedMilestones.push(milestone);
    streaks.streaks[data.streakId] = state;
    saveUserStreaks(nk, userId, streaks, data.gameId);

    return RpcHelpers.successResponse({ reward: resolved });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_streaks_get", rpcGet);
    initializer.registerRpc("hiro_streaks_update", rpcUpdate);
    initializer.registerRpc("hiro_streaks_claim", rpcClaim);
  }
}
