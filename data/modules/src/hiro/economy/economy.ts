namespace HiroEconomy {

  var DEFAULT_CONFIG: Hiro.EconomyConfig = {
    currencies: {
      game: { name: "Game Coins", initialAmount: 0 },
      tokens: { name: "Tokens", initialAmount: 0 },
      xp: { name: "Experience Points", initialAmount: 0 }
    },
    donations: {},
    storeItems: {}
  };

  export function getConfig(nk: nkruntime.Nakama): Hiro.EconomyConfig {
    return ConfigLoader.loadConfig<Hiro.EconomyConfig>(nk, "economy", DEFAULT_CONFIG);
  }

  // ---- Donation System ----

  interface UserDonation {
    id: string;
    donationId: string;
    requesterId: string;
    contributions: { [userId: string]: number };
    totalContributed: number;
    createdAt: number;
    expiresAt: number;
    claimedAt?: number;
  }

  interface UserDonations {
    outgoing: UserDonation[];
    incoming: { [requestId: string]: { donationId: string; requesterId: string } };
  }

  function getUserDonations(nk: nkruntime.Nakama, userId: string, gameId?: string): UserDonations {
    var data = Storage.readJson<UserDonations>(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "donations_" + userId), userId);
    return data || { outgoing: [], incoming: {} };
  }

  function saveUserDonations(nk: nkruntime.Nakama, userId: string, data: UserDonations, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "donations_" + userId), userId, data);
  }

  // ---- Rewarded Video Tracking ----

  interface RewardedVideoState {
    viewsToday: number;
    lastViewDate: string;
    totalViews: number;
  }

  function getRewardedVideoState(nk: nkruntime.Nakama, userId: string, gameId?: string): RewardedVideoState {
    var data = Storage.readJson<RewardedVideoState>(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "rewarded_video_" + userId), userId);
    return data || { viewsToday: 0, lastViewDate: "", totalViews: 0 };
  }

  // ---- RPCs ----

  export function rpcDonationRequest(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var donationId = data.donationId as string;
    if (!donationId) return RpcHelpers.errorResponse("donationId is required");

    var config = getConfig(nk);
    var donationDef = config.donations[donationId];
    if (!donationDef) return RpcHelpers.errorResponse("Unknown donation: " + donationId);

    var donations = getUserDonations(nk, userId, data.gameId);
    var now = Math.floor(Date.now() / 1000);

    var newDonation: UserDonation = {
      id: nk.uuidv4(),
      donationId: donationId,
      requesterId: userId,
      contributions: {},
      totalContributed: 0,
      createdAt: now,
      expiresAt: now + donationDef.durationSec
    };

    donations.outgoing.push(newDonation);
    saveUserDonations(nk, userId, donations, data.gameId);

    return RpcHelpers.successResponse(newDonation);
  }

  export function rpcDonationGive(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var targetUserId = data.userId as string;
    var donationId = data.donationId as string;
    if (!targetUserId || !donationId) return RpcHelpers.errorResponse("userId and donationId required");

    var config = getConfig(nk);
    var donationDef = config.donations[donationId];
    if (!donationDef) return RpcHelpers.errorResponse("Unknown donation: " + donationId);

    if (donationDef.cost && donationDef.cost.currencies) {
      for (var cid in donationDef.cost.currencies) {
        WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, donationDef.cost.currencies[cid]);
      }
    }

    var targetDonations = getUserDonations(nk, targetUserId, data.gameId);
    var now = Math.floor(Date.now() / 1000);

    for (var i = 0; i < targetDonations.outgoing.length; i++) {
      var d = targetDonations.outgoing[i];
      if (d.donationId === donationId && !d.claimedAt && d.expiresAt > now) {
        var userContrib = d.contributions[userId] || 0;
        if (donationDef.userContributionMaxCount && userContrib >= donationDef.userContributionMaxCount) {
          return RpcHelpers.errorResponse("Max contributions reached");
        }
        if (d.totalContributed >= donationDef.maxCount) {
          return RpcHelpers.errorResponse("Donation is full");
        }
        d.contributions[userId] = userContrib + 1;
        d.totalContributed++;
        break;
      }
    }

    saveUserDonations(nk, targetUserId, targetDonations, data.gameId);

    if (donationDef.senderReward) {
      var senderResolved = RewardEngine.resolveReward(nk, donationDef.senderReward);
      RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", senderResolved);
    }

    return RpcHelpers.successResponse({ success: true });
  }

  export function rpcDonationClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var donationIds = data.donationIds as string[];
    if (!donationIds || donationIds.length === 0) return RpcHelpers.errorResponse("donationIds required");

    var config = getConfig(nk);
    var donations = getUserDonations(nk, userId, data.gameId);
    var now = Math.floor(Date.now() / 1000);
    var claimed: string[] = [];

    for (var i = 0; i < donations.outgoing.length; i++) {
      var d = donations.outgoing[i];
      if (donationIds.indexOf(d.donationId) >= 0 && !d.claimedAt && d.totalContributed > 0) {
        d.claimedAt = now;
        var donationDef = config.donations[d.donationId];
        if (donationDef && donationDef.reward) {
          var resolved = RewardEngine.resolveReward(nk, donationDef.reward);
          RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        }
        claimed.push(d.donationId);
      }
    }

    saveUserDonations(nk, userId, donations, data.gameId);
    return RpcHelpers.successResponse({ claimed: claimed });
  }

  export function rpcRewardedVideoComplete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var state = getRewardedVideoState(nk, userId, data.gameId);
    var today = new Date().toISOString().slice(0, 10);

    if (state.lastViewDate !== today) {
      state.viewsToday = 0;
      state.lastViewDate = today;
    }
    state.viewsToday++;
    state.totalViews++;

    Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(data.gameId, "rewarded_video_" + userId), userId, state);

    if (data.reward) {
      var resolved = RewardEngine.resolveReward(nk, data.reward);
      RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
      return RpcHelpers.successResponse({ reward: resolved, state: state });
    }

    return RpcHelpers.successResponse({ state: state });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_economy_donation_request", rpcDonationRequest);
    initializer.registerRpc("hiro_economy_donation_give", rpcDonationGive);
    initializer.registerRpc("hiro_economy_donation_claim", rpcDonationClaim);
    initializer.registerRpc("hiro_economy_rewarded_video", rpcRewardedVideoComplete);
  }
}
