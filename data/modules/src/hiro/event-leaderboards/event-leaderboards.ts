namespace HiroEventLeaderboards {

  var DEFAULT_CONFIG: Hiro.EventLeaderboardConfig = { events: {} };

  export function getConfig(nk: nkruntime.Nakama): Hiro.EventLeaderboardConfig {
    return ConfigLoader.loadConfig<Hiro.EventLeaderboardConfig>(nk, "event_leaderboards", DEFAULT_CONFIG);
  }

  interface ActiveEvent {
    eventId: string;
    leaderboardId: string;
    startAt: number;
    endAt: number;
    cohortId?: string;
  }

  interface UserEventState {
    events: { [eventId: string]: { joined: boolean; cohortId: string; claimedAt?: number } };
  }

  function getUserEventState(nk: nkruntime.Nakama, userId: string, gameId?: string): UserEventState {
    var data = Storage.readJson<UserEventState>(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "event_lb_state_" + userId), userId);
    return data || { events: {} };
  }

  function saveUserEventState(nk: nkruntime.Nakama, userId: string, data: UserEventState, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "event_lb_state_" + userId), userId, data);
  }

  function getActiveEvents(nk: nkruntime.Nakama): ActiveEvent[] {
    var data = Storage.readSystemJson<{ events: ActiveEvent[] }>(nk, Constants.HIRO_CONFIGS_COLLECTION, "active_event_lbs");
    return (data && data.events) || [];
  }

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = getConfig(nk);
    var activeEvents = getActiveEvents(nk);
    var userState = getUserEventState(nk, userId, data.gameId);
    var now = Math.floor(Date.now() / 1000);

    var result: any[] = [];
    for (var i = 0; i < activeEvents.length; i++) {
      var ae = activeEvents[i];
      var def = config.events[ae.eventId];
      if (!def) continue;

      var status = now < ae.startAt ? "upcoming" : now > ae.endAt ? "ended" : "active";
      var us = userState.events[ae.eventId];

      result.push({
        eventId: ae.eventId,
        name: def.name,
        description: def.description,
        leaderboardId: ae.leaderboardId,
        startAt: ae.startAt,
        endAt: ae.endAt,
        status: status,
        joined: us ? us.joined : false,
        claimed: us ? !!us.claimedAt : false,
        tiers: def.tiers
      });
    }

    return RpcHelpers.successResponse({ events: result });
  }

  function rpcSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId || data.score === undefined) return RpcHelpers.errorResponse("eventId and score required");

    var config = getConfig(nk);
    var def = config.events[data.eventId];
    if (!def) return RpcHelpers.errorResponse("Unknown event");

    var activeEvents = getActiveEvents(nk);
    var ae = activeEvents.find(function (e) { return e.eventId === data.eventId; });
    if (!ae) return RpcHelpers.errorResponse("Event not active");

    var now = Math.floor(Date.now() / 1000);
    if (now < ae.startAt || now > ae.endAt) return RpcHelpers.errorResponse("Event not in active window");

    var userState = getUserEventState(nk, userId, data.gameId);
    if (!userState.events[data.eventId]) {
      userState.events[data.eventId] = { joined: true, cohortId: ae.cohortId || "default" };
    }
    userState.events[data.eventId].joined = true;
    saveUserEventState(nk, userId, userState, data.gameId);

    var operatorMap: { [key: string]: nkruntime.OverrideOperator } = { best: nkruntime.OverrideOperator.BEST, set: nkruntime.OverrideOperator.SET, incr: nkruntime.OverrideOperator.INCREMENTAL, decr: nkruntime.OverrideOperator.DECREMENTAL };
    var op = operatorMap[def.operator] || nkruntime.OverrideOperator.BEST;
    nk.leaderboardRecordWrite(ae.leaderboardId, userId, ctx.username || "", data.score, data.subscore || 0, data.metadata || {}, op);

    EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, {
      userId: userId, eventId: data.eventId, score: data.score
    });

    return RpcHelpers.successResponse({ success: true });
  }

  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var config = getConfig(nk);
    var def = config.events[data.eventId];
    if (!def) return RpcHelpers.errorResponse("Unknown event");

    var userState = getUserEventState(nk, userId, data.gameId);
    var us = userState.events[data.eventId];
    if (!us || !us.joined) return RpcHelpers.errorResponse("Not joined");
    if (us.claimedAt) return RpcHelpers.errorResponse("Already claimed");

    var activeEvents = getActiveEvents(nk);
    var ae = activeEvents.find(function (e) { return e.eventId === data.eventId; });
    if (!ae) return RpcHelpers.errorResponse("Event not found");

    var records = nk.leaderboardRecordsList(ae.leaderboardId, [userId], 1, undefined, 0);
    var rank = 0;
    if (records.records && records.records.length > 0) {
      rank = records.records[0].rank;
    }

    var reward: Hiro.ResolvedReward | null = null;
    for (var i = 0; i < def.tiers.length; i++) {
      var tier = def.tiers[i];
      if (rank >= tier.rankMin && rank <= tier.rankMax) {
        reward = RewardEngine.resolveReward(nk, tier.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
        break;
      }
    }

    us.claimedAt = Math.floor(Date.now() / 1000);
    saveUserEventState(nk, userId, userState, data.gameId);

    return RpcHelpers.successResponse({ rank: rank, reward: reward });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_event_lb_list", rpcList);
    initializer.registerRpc("hiro_event_lb_submit", rpcSubmit);
    initializer.registerRpc("hiro_event_lb_claim", rpcClaim);
  }
}
