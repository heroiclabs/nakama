namespace HiroIncentives {

  var DEFAULT_CONFIG: Hiro.IncentivesConfig = {};

  export function getConfig(nk: nkruntime.Nakama): Hiro.IncentivesConfig {
    return ConfigLoader.loadConfig<Hiro.IncentivesConfig>(nk, "incentives", DEFAULT_CONFIG);
  }

  interface UserIncentiveState {
    referralCode?: string;
    referredBy?: string;
    referralsClaimed: string[];
    lastSeenAt: number;
    returnBonusClaimed: boolean;
  }

  function getUserState(nk: nkruntime.Nakama, userId: string, gameId?: string): UserIncentiveState {
    var data = Storage.readJson<UserIncentiveState>(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "incentives_" + userId), userId);
    return data || { referralsClaimed: [], lastSeenAt: 0, returnBonusClaimed: false };
  }

  function saveUserState(nk: nkruntime.Nakama, userId: string, data: UserIncentiveState, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "incentives_" + userId), userId, data);
  }

  function rpcGetReferralCode(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var state = getUserState(nk, userId, data.gameId);
    if (!state.referralCode) {
      state.referralCode = userId.substring(0, 8).toUpperCase();
      saveUserState(nk, userId, state, data.gameId);
    }
    return RpcHelpers.successResponse({ referralCode: state.referralCode });
  }

  function rpcApplyReferral(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.referralCode) return RpcHelpers.errorResponse("referralCode required");

    var state = getUserState(nk, userId, data.gameId);
    if (state.referredBy) return RpcHelpers.errorResponse("Already referred");

    var config = getConfig(nk);
    state.referredBy = data.referralCode;
    saveUserState(nk, userId, state, data.gameId);

    if (config.referralReward) {
      var resolved = RewardEngine.resolveReward(nk, config.referralReward);
      RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
    }

    if (config.referrerReward) {
      RewardEngine.grantToMailbox(nk, data.referralCode, "Referral Reward", config.referrerReward);
    }

    return RpcHelpers.successResponse({ success: true });
  }

  function rpcCheckReturnBonus(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = getConfig(nk);
    var state = getUserState(nk, userId, data.gameId);
    var now = Math.floor(Date.now() / 1000);

    var eligible = false;
    if (!state.returnBonusClaimed && state.lastSeenAt > 0 && config.returnBonusDays) {
      var daysSinceLastSeen = (now - state.lastSeenAt) / 86400;
      eligible = daysSinceLastSeen >= config.returnBonusDays;
    }

    state.lastSeenAt = now;
    saveUserState(nk, userId, state, data.gameId);

    if (eligible && config.returnBonus) {
      var resolved = RewardEngine.resolveReward(nk, config.returnBonus);
      RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
      state.returnBonusClaimed = true;
      saveUserState(nk, userId, state, data.gameId);
      return RpcHelpers.successResponse({ eligible: true, reward: resolved });
    }

    return RpcHelpers.successResponse({ eligible: eligible });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_incentives_referral_code", rpcGetReferralCode);
    initializer.registerRpc("hiro_incentives_apply_referral", rpcApplyReferral);
    initializer.registerRpc("hiro_incentives_return_bonus", rpcCheckReturnBonus);
  }
}
