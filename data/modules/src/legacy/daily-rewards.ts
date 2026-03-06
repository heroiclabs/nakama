namespace LegacyDailyRewards {

  interface DailyRewardStatus {
    day: number;
    lastClaimDate: string;
    streak: number;
    rewards: any[];
  }

  var CYCLE_DAYS = 7;

  function pad2(n: number): string {
    return n < 10 ? "0" + n : String(n);
  }

  function getTodayDateString(): string {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function getStatus(nk: nkruntime.Nakama, userId: string): DailyRewardStatus | null {
    return Storage.readJson<DailyRewardStatus>(nk, Constants.DAILY_REWARDS_COLLECTION, "status_" + userId, userId);
  }

  function saveStatus(nk: nkruntime.Nakama, userId: string, status: DailyRewardStatus): void {
    Storage.writeJson(nk, Constants.DAILY_REWARDS_COLLECTION, "status_" + userId, userId, status);
  }

  function rpcGetStatus(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var status = getStatus(nk, userId);
    var today = getTodayDateString();

    if (!status) {
      status = { day: 0, lastClaimDate: "", streak: 0, rewards: [] };
    }

    return RpcHelpers.successResponse({
      day: status.day,
      lastClaimDate: status.lastClaimDate,
      streak: status.streak,
      rewards: status.rewards,
      canClaim: status.lastClaimDate !== today
    });
  }

  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = data.gameId || "default";

    var status = getStatus(nk, userId);
    var today = getTodayDateString();

    if (!status) {
      status = { day: 0, lastClaimDate: "", streak: 0, rewards: [] };
    }

    if (status.lastClaimDate === today) {
      return RpcHelpers.errorResponse("Already claimed today");
    }

    var prevDate = status.lastClaimDate;
    var dayDiff = 1;

    if (prevDate) {
      var prev = new Date(prevDate);
      var curr = new Date(today);
      dayDiff = Math.floor((curr.getTime() - prev.getTime()) / 86400000);
    }

    if (dayDiff > 1) {
      status.streak = 0;
    } else if (dayDiff === 1) {
      status.streak = (status.streak || 0) + 1;
    }

    status.day = ((status.day || 0) % CYCLE_DAYS) + 1;
    status.lastClaimDate = today;

    var rewardConfig = status.day <= 7
      ? { game: 50 * status.day, tokens: 10 * status.day, xp: 5 * status.day }
      : { game: 100, tokens: 20, xp: 10 };

    if (rewardConfig.game && rewardConfig.game > 0) {
      WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "game", rewardConfig.game);
    }
    if (rewardConfig.tokens && rewardConfig.tokens > 0) {
      WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "tokens", rewardConfig.tokens);
    }
    if (rewardConfig.xp && rewardConfig.xp > 0) {
      WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "xp", rewardConfig.xp);
    }

    status.rewards = status.rewards || [];
    status.rewards.push({
      day: status.day,
      date: today,
      game: rewardConfig.game,
      tokens: rewardConfig.tokens,
      xp: rewardConfig.xp
    });

    saveStatus(nk, userId, status);

    try {
      var syncPayload = {
        userId: userId,
        day: status.day,
        streak: status.streak,
        lastClaimDate: today,
        rewards: rewardConfig
      };
      var syncUrl = data.syncUrl;
      if (syncUrl && typeof syncUrl === "string") {
        HttpClient.post(nk, syncUrl, JSON.stringify(syncPayload));
      }
    } catch (_) {}

    var rewardAmount = (rewardConfig.game || 0) + (rewardConfig.tokens || 0);
    if (rewardAmount > 0) {
      try {
        var questsApiUrl = (ctx.env && ctx.env["QUESTS_ECONOMY_API_URL"]) || "http://localhost:3001";
        var webhookSecret = (ctx.env && ctx.env["NAKAMA_WEBHOOK_SECRET"]) || "";
        var qeGameId = (ctx.env && ctx.env["DEFAULT_GAME_ID"]) || "f6f7fe36-03de-43b8-8b5d-1a1892da4eed";
        var syncBody = JSON.stringify({ amount: rewardAmount, sourceType: "daily_reward", sourceId: "daily:day_" + status.day, description: "Daily reward day " + status.day });
        var sigBytes = nk.hmacSha256Hash(webhookSecret, syncBody);
        var sig = nk.binaryToString(sigBytes);
        nk.httpRequest(
          questsApiUrl.replace(/\/$/, "") + "/game-bridge/s2s/wallet/earn", "post",
          { "Content-Type": "application/json", "X-Source": "nakama-rpc", "X-Webhook-Signature": sig, "X-User-Id": userId, "X-Game-Id": qeGameId },
          syncBody
        );
      } catch (_) {}
    }

    return RpcHelpers.successResponse({
      day: status.day,
      streak: status.streak,
      reward: rewardConfig
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("daily_rewards_get_status", rpcGetStatus);
    initializer.registerRpc("daily_rewards_claim", rpcClaim);
  }
}
