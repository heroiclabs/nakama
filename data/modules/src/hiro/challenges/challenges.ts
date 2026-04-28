namespace HiroChallenges {

  var DEFAULT_CONFIG: Hiro.ChallengesConfig = { challenges: {} };

  export function getConfig(nk: nkruntime.Nakama, gameId?: string): Hiro.ChallengesConfig {
    return ConfigLoader.loadConfigForGame<Hiro.ChallengesConfig>(nk, "challenges", gameId, DEFAULT_CONFIG);
  }

  interface ChallengeInstance {
    id: string;
    challengeId: string;
    creatorId: string;
    participants: { [userId: string]: { score: number; joinedAt: number } };
    leaderboardId: string;
    startAt: number;
    endAt: number;
    claimedBy: string[];
  }

  function getChallengeInstance(nk: nkruntime.Nakama, instanceId: string): ChallengeInstance | null {
    return Storage.readSystemJson<ChallengeInstance>(nk, Constants.HIRO_CHALLENGES_COLLECTION, instanceId);
  }

  function saveChallengeInstance(nk: nkruntime.Nakama, instance: ChallengeInstance): void {
    Storage.writeSystemJson(nk, Constants.HIRO_CHALLENGES_COLLECTION, instance.id, instance);
  }

  function rpcCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.challengeId) return RpcHelpers.errorResponse("challengeId required");

    var gameId = RpcHelpers.gameId(data);
    var config = getConfig(nk, gameId);
    var def = config.challenges[data.challengeId];
    if (!def) return RpcHelpers.errorResponse("Unknown challenge");

    if (def.entryCost && def.entryCost.currencies) {
      for (var cid in def.entryCost.currencies) {
        WalletHelpers.spendCurrency(nk, logger, ctx, userId, gameId || "default", cid, def.entryCost.currencies[cid]);
      }
    }

    var now = Math.floor(Date.now() / 1000);
    var instanceId = nk.uuidv4();
    var lbId = "challenge_" + instanceId;

    var sortOrder = def.sortOrder === "asc" ? nkruntime.SortOrder.ASCENDING : nkruntime.SortOrder.DESCENDING;
    var operatorMap: { [key: string]: nkruntime.Operator } = { best: nkruntime.Operator.BEST, set: nkruntime.Operator.SET, incr: nkruntime.Operator.INCREMENTAL };
    nk.leaderboardCreate(lbId, false, sortOrder, operatorMap[def.scoreOperator] || nkruntime.Operator.BEST);

    var instance: ChallengeInstance = {
      id: instanceId,
      challengeId: data.challengeId,
      creatorId: userId,
      participants: {},
      leaderboardId: lbId,
      startAt: now,
      endAt: now + def.durationSec,
      claimedBy: []
    };
    instance.participants[userId] = { score: 0, joinedAt: now };
    saveChallengeInstance(nk, instance);

    return RpcHelpers.successResponse({ challenge: instance });
  }

  function rpcJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.instanceId) return RpcHelpers.errorResponse("instanceId required");

    var instance = getChallengeInstance(nk, data.instanceId);
    if (!instance) return RpcHelpers.errorResponse("Challenge not found");

    var gameId = RpcHelpers.gameId(data);
    var config = getConfig(nk, gameId);
    var def = config.challenges[instance.challengeId];
    if (!def) return RpcHelpers.errorResponse("Challenge config not found");

    var participantCount = Object.keys(instance.participants).length;
    if (participantCount >= def.maxParticipants) return RpcHelpers.errorResponse("Challenge full");

    var now = Math.floor(Date.now() / 1000);
    if (now > instance.endAt) return RpcHelpers.errorResponse("Challenge ended");

    if (def.entryCost && def.entryCost.currencies) {
      for (var cid in def.entryCost.currencies) {
        WalletHelpers.spendCurrency(nk, logger, ctx, userId, gameId || "default", cid, def.entryCost.currencies[cid]);
      }
    }

    instance.participants[userId] = { score: 0, joinedAt: now };
    saveChallengeInstance(nk, instance);

    return RpcHelpers.successResponse({ challenge: instance });
  }

  function rpcSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.instanceId || data.score === undefined) return RpcHelpers.errorResponse("instanceId and score required");

    var instance = getChallengeInstance(nk, data.instanceId);
    if (!instance) return RpcHelpers.errorResponse("Challenge not found");
    if (!instance.participants[userId]) return RpcHelpers.errorResponse("Not a participant");

    var now = Math.floor(Date.now() / 1000);
    if (now > instance.endAt) return RpcHelpers.errorResponse("Challenge ended");

    nk.leaderboardRecordWrite(instance.leaderboardId, userId, ctx.username || "", data.score, 0, {}, nkruntime.OverrideOperator.BEST);
    instance.participants[userId].score = data.score;
    saveChallengeInstance(nk, instance);

    return RpcHelpers.successResponse({ success: true });
  }

  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.instanceId) return RpcHelpers.errorResponse("instanceId required");

    var instance = getChallengeInstance(nk, data.instanceId);
    if (!instance) return RpcHelpers.errorResponse("Challenge not found");
    if (instance.claimedBy.indexOf(userId) >= 0) return RpcHelpers.errorResponse("Already claimed");

    var gameId = RpcHelpers.gameId(data);
    var config = getConfig(nk, gameId);
    var def = config.challenges[instance.challengeId];
    if (!def) return RpcHelpers.errorResponse("Challenge config not found");

    var records = nk.leaderboardRecordsList(instance.leaderboardId, [userId], 1, undefined, 0);
    var rank = 0;
    if (records.records && records.records.length > 0) {
      rank = records.records[0].rank;
    }

    if (rank === 1 && def.reward) {
      var resolved = RewardEngine.resolveReward(nk, def.reward);
      RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", resolved);

      instance.claimedBy.push(userId);
      saveChallengeInstance(nk, instance);

      EventBus.emit(nk, logger, ctx, EventBus.Events.CHALLENGE_COMPLETED, {
        userId: userId, challengeId: instance.challengeId, rank: rank
      });

      return RpcHelpers.successResponse({ rank: rank, reward: resolved });
    }

    instance.claimedBy.push(userId);
    saveChallengeInstance(nk, instance);
    return RpcHelpers.successResponse({ rank: rank, reward: null });
  }

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = getConfig(nk, RpcHelpers.gameId(data));
    var defs = config.challenges || {};
    var list: any[] = [];
    for (var id in defs) {
      list.push({ id: id, definition: defs[id] });
    }

    var userId = ctx.userId;
    var userState: any = null;
    if (userId) {
      var now = Math.floor(Date.now() / 1000);
      var participating: any[] = [];
      var available: any[] = [];
      var completed: any[] = [];

      try {
        var instances = nk.storageList(Constants.SYSTEM_USER_ID, Constants.HIRO_CHALLENGES_COLLECTION, 100, "");
        if (instances && instances.objects) {
          for (var i = 0; i < instances.objects.length; i++) {
            var obj: any = instances.objects[i].value;
            if (!obj || !obj.id) continue;
            var participantCount = obj.participants ? Object.keys(obj.participants).length : 0;
            var isParticipant = obj.participants && obj.participants[userId];
            var hasClaimed = obj.claimedBy && obj.claimedBy.indexOf(userId) >= 0;
            var isExpired = now > obj.endAt;
            var def = defs[obj.challengeId];
            var maxParticipants = def ? def.maxParticipants : 0;

            var summary = {
              instanceId: obj.id,
              challengeId: obj.challengeId,
              creatorId: obj.creatorId,
              startAt: obj.startAt,
              endAt: obj.endAt,
              participantCount: participantCount,
              maxParticipants: maxParticipants,
              userScore: isParticipant ? obj.participants[userId].score : 0,
              claimed: hasClaimed,
              expired: isExpired
            };

            if (isParticipant) {
              if (hasClaimed || isExpired) {
                completed.push(summary);
              } else {
                participating.push(summary);
              }
            } else if (!isExpired && participantCount < maxParticipants) {
              available.push(summary);
            }
          }
        }
      } catch (e) {
        logger.warn("hiro_challenges_list: failed to enumerate instances: %s", String(e));
      }

      userState = {
        participating: participating,
        available: available,
        completed: completed
      };
    }

    return RpcHelpers.successResponse({ challenges: list, userState: userState });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_challenges_create", rpcCreate);
    initializer.registerRpc("hiro_challenges_join", rpcJoin);
    initializer.registerRpc("hiro_challenges_submit", rpcSubmit);
    initializer.registerRpc("hiro_challenges_claim", rpcClaim);
    initializer.registerRpc("hiro_challenges_list", rpcList);
  }
}
