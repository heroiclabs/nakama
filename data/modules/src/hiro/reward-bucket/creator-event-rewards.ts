namespace HiroCreatorEventRewards {

  interface CreatorBucketTier {
    tier: string;
    percentage: number;
    maxWinners: number;
    nftBadgeId?: string;
    xutPerWinner: number;
    totalPool: number;
    reward: Hiro.Reward;
  }

  interface CreatorBucketDefinition {
    eventId: string;
    name: string;
    prizePool: number;
    tiers: CreatorBucketTier[];
    createdAt: number;
  }

  var BUCKET_COLLECTION = "hiro_creator_event_rewards";
  var BUCKET_PREFIX = "creator_event_";
  var TIER_ORDER = ["platinum", "gold", "silver", "bronze", "participation"];

  function getBucketDefinition(nk: nkruntime.Nakama, eventId: string): CreatorBucketDefinition | null {
    return Storage.readSystemJson<CreatorBucketDefinition>(nk, BUCKET_COLLECTION, BUCKET_PREFIX + eventId);
  }

  function saveBucketDefinition(nk: nkruntime.Nakama, def: CreatorBucketDefinition): void {
    Storage.writeSystemJson(nk, BUCKET_COLLECTION, BUCKET_PREFIX + def.eventId, def);
  }

  export function createBucketForEvent(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    eventId: string,
    prizes: { tier: string; percentage: number; maxWinners: number; nftBadgeId?: string }[],
    prizePool: number
  ): void {
    var tiers: CreatorBucketTier[] = [];

    for (var to = 0; to < TIER_ORDER.length; to++) {
      for (var pi = 0; pi < prizes.length; pi++) {
        if (prizes[pi].tier !== TIER_ORDER[to]) continue;

        var prize = prizes[pi];
        var tierPoolAmount = Math.floor((prizePool * prize.percentage) / 100);
        var perWinnerAmount = prize.maxWinners > 0 ? Math.floor(tierPoolAmount / prize.maxWinners) : 0;

        var reward: Hiro.Reward = {};
        var grant: Hiro.RewardGrant = {};
        var hasGrant = false;

        if (perWinnerAmount > 0) {
          grant.currencies = { xut: perWinnerAmount };
          hasGrant = true;
        }
        if (prize.nftBadgeId) {
          grant.items = {};
          grant.items[prize.nftBadgeId] = { min: 1 };
          hasGrant = true;
        }
        if (hasGrant) {
          reward.guaranteed = grant;
        }

        tiers.push({
          tier: prize.tier,
          percentage: prize.percentage,
          maxWinners: prize.maxWinners,
          nftBadgeId: prize.nftBadgeId,
          xutPerWinner: perWinnerAmount,
          totalPool: tierPoolAmount,
          reward: reward,
        });
      }
    }

    var def: CreatorBucketDefinition = {
      eventId: eventId,
      name: "Creator Event: " + eventId,
      prizePool: prizePool,
      tiers: tiers,
      createdAt: Math.floor(Date.now() / 1000),
    };

    saveBucketDefinition(nk, def);
    logger.info("[CreatorEventRewards] Created reward bucket for event %s with %d tiers, pool=%d", eventId, tiers.length, prizePool);
  }

  export function getTierReward(nk: nkruntime.Nakama, eventId: string, tierName: string): Hiro.Reward | null {
    var def = getBucketDefinition(nk, eventId);
    if (!def) return null;

    for (var i = 0; i < def.tiers.length; i++) {
      if (def.tiers[i].tier === tierName) {
        return def.tiers[i].reward;
      }
    }
    return null;
  }

  // ---- RPCs ----

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var def = getBucketDefinition(nk, data.eventId);
    if (!def) return RpcHelpers.errorResponse("Reward bucket not found for event");

    var tiersResponse: any[] = [];
    for (var i = 0; i < def.tiers.length; i++) {
      var tier = def.tiers[i];
      tiersResponse.push({
        tier: tier.tier,
        percentage: tier.percentage,
        maxWinners: tier.maxWinners,
        nftBadgeId: tier.nftBadgeId || "",
        xutPerWinner: tier.xutPerWinner,
        totalPool: tier.totalPool,
      });
    }

    return RpcHelpers.successResponse({
      eventId: def.eventId,
      name: def.name,
      prizePool: def.prizePool,
      tiers: tiersResponse,
      createdAt: def.createdAt,
    });
  }

  function rpcCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var validation = RpcHelpers.validatePayload(data, ["eventId", "prizes", "prizePool"]);
    if (!validation.valid) return RpcHelpers.errorResponse("Missing: " + validation.missing.join(", "));

    createBucketForEvent(nk, logger, data.eventId, data.prizes, data.prizePool);

    return RpcHelpers.successResponse({
      success: true,
      bucketId: BUCKET_PREFIX + data.eventId,
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("creator_event_rewards_get", rpcGet);
    initializer.registerRpc("creator_event_rewards_create", rpcCreate);
  }
}
