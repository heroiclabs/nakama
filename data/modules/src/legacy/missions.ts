namespace LegacyMissions {

  interface Mission {
    id: string;
    type: string;
    description: string;
    target: number;
    progress: number;
    completed: boolean;
    claimed: boolean;
    reward: { game?: number; tokens?: number; xp?: number; [key: string]: number | undefined };
  }

  interface DailyMissionsData {
    missions: Mission[];
    date: string;
  }

  function pad2(n: number): string {
    return n < 10 ? "0" + n : String(n);
  }

  function getTodayDateString(): string {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function getDefaultMissions(): Mission[] {
    return [
      { id: "play_3", type: "play_games", description: "Play 3 games", target: 3, progress: 0, completed: false, claimed: false, reward: { game: 30 } },
      { id: "win_1", type: "win_games", description: "Win 1 game", target: 1, progress: 0, completed: false, claimed: false, reward: { tokens: 15 } },
      { id: "correct_10", type: "correct_answers", description: "Get 10 correct answers", target: 10, progress: 0, completed: false, claimed: false, reward: { xp: 25 } }
    ];
  }

  function getMissionsForUser(nk: nkruntime.Nakama, userId: string, date: string): DailyMissionsData {
    var key = "daily_" + userId + "_" + date;
    var data = Storage.readJson<DailyMissionsData>(nk, Constants.MISSIONS_COLLECTION, key, userId);
    if (!data || data.date !== date) {
      return { missions: getDefaultMissions(), date: date };
    }
    return data;
  }

  function saveMissions(nk: nkruntime.Nakama, userId: string, data: DailyMissionsData): void {
    var key = "daily_" + userId + "_" + data.date;
    Storage.writeJson(nk, Constants.MISSIONS_COLLECTION, key, userId, data);
  }

  function rpcGetDailyMissions(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var today = getTodayDateString();
    var data = getMissionsForUser(nk, userId, today);

    return RpcHelpers.successResponse({ missions: data.missions, date: data.date });
  }

  function rpcSubmitProgress(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.missionId || data.amount === undefined) {
      return RpcHelpers.errorResponse("missionId and amount required");
    }

    var today = getTodayDateString();
    var missionsData = getMissionsForUser(nk, userId, today);
    var mission = missionsData.missions.find(function (m) { return m.id === data.missionId; });

    if (!mission) {
      return RpcHelpers.errorResponse("Mission not found");
    }
    if (mission.completed && mission.claimed) {
      return RpcHelpers.successResponse({ mission: mission, alreadyComplete: true });
    }

    var amount = Math.max(0, Number(data.amount) || 0);

    if (mission.type === "play_games" || mission.type === "win_games" || mission.type === "correct_answers") {
      mission.progress = Math.min(mission.target, (mission.progress || 0) + amount);
      mission.completed = mission.progress >= mission.target;
    } else {
      mission.progress = Math.min(mission.target, (mission.progress || 0) + amount);
      mission.completed = mission.progress >= mission.target;
    }

    saveMissions(nk, userId, missionsData);

    return RpcHelpers.successResponse({ mission: mission });
  }

  function rpcClaimReward(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.missionId) return RpcHelpers.errorResponse("missionId required");

    var gameId = data.gameId || "default";
    var today = getTodayDateString();
    var missionsData = getMissionsForUser(nk, userId, today);
    var mission = missionsData.missions.find(function (m) { return m.id === data.missionId; });

    if (!mission) {
      return RpcHelpers.errorResponse("Mission not found");
    }
    if (!mission.completed) {
      return RpcHelpers.errorResponse("Mission not completed");
    }
    if (mission.claimed) {
      return RpcHelpers.errorResponse("Reward already claimed");
    }

    var reward = mission.reward || {};
    if (reward.game && reward.game > 0) {
      WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "game", reward.game);
    }
    if (reward.tokens && reward.tokens > 0) {
      WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "tokens", reward.tokens);
    }
    if (reward.xp && reward.xp > 0) {
      WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "xp", reward.xp);
    }

    mission.claimed = true;
    saveMissions(nk, userId, missionsData);

    try {
      var syncUrl = data.syncUrl;
      if (syncUrl && typeof syncUrl === "string") {
        HttpClient.post(nk, syncUrl, JSON.stringify({
          userId: userId,
          missionId: mission.id,
          reward: reward
        }));
      }
    } catch (_) {}

    var missionRewardTotal = (reward.game || 0) + (reward.tokens || 0);
    if (missionRewardTotal > 0) {
      try {
        var questsApiUrl = (ctx.env && ctx.env["QUESTS_ECONOMY_API_URL"]) || "http://localhost:3001";
        var webhookSecret = (ctx.env && ctx.env["NAKAMA_WEBHOOK_SECRET"]) || "";
        var qeGameId = (ctx.env && ctx.env["DEFAULT_GAME_ID"]) || "f6f7fe36-03de-43b8-8b5d-1a1892da4eed";
        var syncBody = JSON.stringify({ amount: missionRewardTotal, sourceType: "mission_reward", sourceId: "mission:" + mission.id, description: "Mission reward claimed" });
        var sigBytes = nk.hmacSha256Hash(webhookSecret, syncBody);
        var sig = nk.binaryToString(sigBytes);
        nk.httpRequest(
          questsApiUrl.replace(/\/$/, "") + "/game-bridge/s2s/wallet/earn", "post",
          { "Content-Type": "application/json", "X-Source": "nakama-rpc", "X-Webhook-Signature": sig, "X-User-Id": userId, "X-Game-Id": qeGameId },
          syncBody
        );
      } catch (_) {}
    }

    return RpcHelpers.successResponse({ mission: mission, reward: reward });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("get_daily_missions", rpcGetDailyMissions);
    initializer.registerRpc("submit_mission_progress", rpcSubmitProgress);
    initializer.registerRpc("claim_mission_reward", rpcClaimReward);
  }
}
