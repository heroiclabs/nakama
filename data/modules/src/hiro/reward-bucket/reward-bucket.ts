namespace HiroRewardBucket {

  interface RewardBucketConfig {
    buckets: { [id: string]: BucketDefinition };
  }

  interface BucketDefinition {
    name: string;
    description?: string;
    maxProgress: number;
    unlockCost?: Hiro.CurrencyAmount;
    tiers: BucketTier[];
    resetOnUnlock: boolean;
    additionalProperties?: { [key: string]: string };
  }

  interface BucketTier {
    progressRequired: number;
    reward: Hiro.Reward;
  }

  interface UserBucketState {
    progress: number;
    unlockedTiers: number[];
    lastUnlockedAt?: number;
    totalUnlocks: number;
  }

  interface UserBuckets {
    buckets: { [id: string]: UserBucketState };
  }

  var BUCKET_COLLECTION = "hiro_reward_buckets";

  var DEFAULT_CONFIG: RewardBucketConfig = { buckets: {} };

  function getConfig(nk: nkruntime.Nakama): RewardBucketConfig {
    return ConfigLoader.loadConfig<RewardBucketConfig>(nk, "reward_buckets", DEFAULT_CONFIG);
  }

  function getUserBuckets(nk: nkruntime.Nakama, userId: string, gameId?: string): UserBuckets {
    var data = Storage.readJson<UserBuckets>(nk, BUCKET_COLLECTION, Constants.gameKey(gameId, "state"), userId);
    return data || { buckets: {} };
  }

  function saveUserBuckets(nk: nkruntime.Nakama, userId: string, data: UserBuckets, gameId?: string): void {
    Storage.writeJson(nk, BUCKET_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
  }

  export function addProgress(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, bucketId: string, amount: number, gameId?: string): void {
    var config = getConfig(nk);
    var def = config.buckets[bucketId];
    if (!def) return;

    var userBuckets = getUserBuckets(nk, userId, gameId);
    if (!userBuckets.buckets[bucketId]) {
      userBuckets.buckets[bucketId] = { progress: 0, unlockedTiers: [], totalUnlocks: 0 };
    }
    var state = userBuckets.buckets[bucketId];
    state.progress = Math.min(state.progress + amount, def.maxProgress);
    saveUserBuckets(nk, userId, userBuckets, gameId);
  }

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = getConfig(nk);
    var userBuckets = getUserBuckets(nk, userId, data.gameId);

    var result: any[] = [];
    for (var id in config.buckets) {
      var def = config.buckets[id];
      var state = userBuckets.buckets[id] || { progress: 0, unlockedTiers: [], totalUnlocks: 0 };

      var tiers: any[] = [];
      for (var i = 0; i < def.tiers.length; i++) {
        tiers.push({
          index: i,
          progressRequired: def.tiers[i].progressRequired,
          unlocked: state.unlockedTiers.indexOf(i) >= 0,
          reachable: state.progress >= def.tiers[i].progressRequired
        });
      }

      result.push({
        id: id,
        name: def.name,
        description: def.description,
        progress: state.progress,
        maxProgress: def.maxProgress,
        tiers: tiers,
        unlockCost: def.unlockCost,
        totalUnlocks: state.totalUnlocks,
        additionalProperties: def.additionalProperties
      });
    }

    return RpcHelpers.successResponse({ buckets: result });
  }

  function rpcProgress(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.bucketId || !data.amount) return RpcHelpers.errorResponse("bucketId and amount required");

    addProgress(nk, logger, ctx, userId, data.bucketId, data.amount, data.gameId);
    return RpcHelpers.successResponse({ success: true });
  }

  function rpcUnlock(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.bucketId) return RpcHelpers.errorResponse("bucketId required");
    var tierIndex = data.tierIndex !== undefined ? data.tierIndex : -1;

    var config = getConfig(nk);
    var def = config.buckets[data.bucketId];
    if (!def) return RpcHelpers.errorResponse("Unknown bucket");

    var userBuckets = getUserBuckets(nk, userId, data.gameId);
    var state = userBuckets.buckets[data.bucketId];
    if (!state) return RpcHelpers.errorResponse("No progress in this bucket");

    if (tierIndex < 0 || tierIndex >= def.tiers.length) return RpcHelpers.errorResponse("Invalid tier index");
    if (state.unlockedTiers.indexOf(tierIndex) >= 0) return RpcHelpers.errorResponse("Tier already unlocked");
    if (state.progress < def.tiers[tierIndex].progressRequired) return RpcHelpers.errorResponse("Insufficient progress");

    if (def.unlockCost) {
      for (var cid in def.unlockCost) {
        WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, def.unlockCost[cid]);
      }
    }

    var resolved = RewardEngine.resolveReward(nk, def.tiers[tierIndex].reward);
    RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);

    state.unlockedTiers.push(tierIndex);
    state.lastUnlockedAt = Math.floor(Date.now() / 1000);
    state.totalUnlocks++;

    if (def.resetOnUnlock && state.unlockedTiers.length >= def.tiers.length) {
      state.progress = 0;
      state.unlockedTiers = [];
    }

    saveUserBuckets(nk, userId, userBuckets, data.gameId);
    return RpcHelpers.successResponse({ reward: resolved, state: state });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_reward_bucket_get", rpcGet);
    initializer.registerRpc("hiro_reward_bucket_progress", rpcProgress);
    initializer.registerRpc("hiro_reward_bucket_unlock", rpcUnlock);
  }

  export function registerEventHandlers(): void {
    EventBus.on(EventBus.Events.GAME_COMPLETED, function(nk, logger, ctx, data) {
      var config = getConfig(nk);
      for (var id in config.buckets) {
        addProgress(nk, logger, ctx, data.userId, id, 1);
      }
    });
    EventBus.on(EventBus.Events.STORE_PURCHASE, function(nk, logger, ctx, data) {
      var config = getConfig(nk);
      for (var id in config.buckets) {
        addProgress(nk, logger, ctx, data.userId, id, 5);
      }
    });
  }
}
