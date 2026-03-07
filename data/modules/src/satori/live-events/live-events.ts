namespace SatoriLiveEvents {

  function getEventDefinitions(nk: nkruntime.Nakama): { [id: string]: Satori.LiveEventDefinition } {
    return ConfigLoader.loadSatoriConfig<{ [id: string]: Satori.LiveEventDefinition }>(nk, "live_events", {});
  }

  function getUserLiveEventStates(nk: nkruntime.Nakama, userId: string): { [eventId: string]: Satori.UserLiveEventState } {
    var data = Storage.readJson<{ events: { [eventId: string]: Satori.UserLiveEventState } }>(nk, Constants.SATORI_CONFIGS_COLLECTION, "live_event_state_" + userId, userId);
    return (data && data.events) || {};
  }

  function saveUserLiveEventStates(nk: nkruntime.Nakama, userId: string, states: { [eventId: string]: Satori.UserLiveEventState }): void {
    Storage.writeJson(nk, Constants.SATORI_CONFIGS_COLLECTION, "live_event_state_" + userId, userId, { events: states });
  }

  function getEventStatus(def: any): Satori.LiveEventStatus {
    var now = Math.floor(Date.now() / 1000);
    var startAt = def.startAt;
    var endAt = def.endAt;

    if (def.recurrenceCron && def.recurrenceIntervalSec) {
      var runState = computeRecurrence(def);
      startAt = runState.currentStart;
      endAt = runState.currentEnd;
    }

    if (now < startAt) return "upcoming";
    if (now > endAt) return "ended";
    return "active";
  }

  function computeRecurrence(def: any): { currentStart: number; currentEnd: number } {
    var now = Math.floor(Date.now() / 1000);
    var interval = def.recurrenceIntervalSec || 86400;
    var duration = def.endAt - def.startAt;
    var elapsed = now - def.startAt;
    if (elapsed < 0) return { currentStart: def.startAt, currentEnd: def.endAt };

    var cycleIndex = Math.floor(elapsed / interval);
    var currentStart = def.startAt + (cycleIndex * interval);
    return { currentStart: currentStart, currentEnd: currentStart + duration };
  }

  // ---- RPCs ----

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var events = getEventDefinitions(nk);
    var userStates = getUserLiveEventStates(nk, userId);

    var result: any[] = [];
    for (var id in events) {
      var def = events[id] as any;
      if (def.audienceId && !SatoriAudiences.isInAudience(nk, userId, def.audienceId)) continue;

      var status = getEventStatus(def);
      if (data.names && data.names.indexOf(def.name) < 0) continue;

      var userState = userStates[id];
      var effectiveStart = def.startAt;
      var effectiveEnd = def.endAt;

      if (def.recurrenceCron && def.recurrenceIntervalSec) {
        var run = computeRecurrence(def);
        effectiveStart = run.currentStart;
        effectiveEnd = run.currentEnd;
      }

      result.push({
        id: id,
        name: def.name,
        description: def.description,
        category: def.category || "",
        startAt: effectiveStart,
        endAt: effectiveEnd,
        status: status,
        config: def.config,
        joined: userState ? !!userState.joinedAt : false,
        claimed: userState ? !!userState.claimedAt : false,
        hasReward: !!def.reward,
        sticky: !!def.sticky,
        requiresJoin: !!def.requiresJoin,
        flagOverrides: def.flagOverrides
      });
    }

    return RpcHelpers.successResponse({ events: result });
  }

  function rpcJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var events = getEventDefinitions(nk);
    var def = events[data.eventId] as any;
    if (!def) return RpcHelpers.errorResponse("Event not found");

    var status = getEventStatus(def);
    if (status !== "active") return RpcHelpers.errorResponse("Event is not active");

    var userStates = getUserLiveEventStates(nk, userId);
    if (!userStates[data.eventId]) {
      userStates[data.eventId] = { eventId: data.eventId };
    }
    userStates[data.eventId].joinedAt = Math.floor(Date.now() / 1000);
    saveUserLiveEventStates(nk, userId, userStates);

    if (def.onJoinMessageId) {
      var msgDefs = ConfigLoader.loadSatoriConfig<{ [id: string]: Satori.MessageDefinition }>(nk, "messages", {});
      if (msgDefs[def.onJoinMessageId]) {
        SatoriMessages.deliverMessage(nk, userId, msgDefs[def.onJoinMessageId]);
      }
    }

    return RpcHelpers.successResponse({ success: true });
  }

  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var events = getEventDefinitions(nk);
    var def = events[data.eventId] as any;
    if (!def) return RpcHelpers.errorResponse("Event not found");

    var userStates = getUserLiveEventStates(nk, userId);
    var state = userStates[data.eventId];
    if (def.requiresJoin && (!state || !state.joinedAt)) return RpcHelpers.errorResponse("Not joined");
    if (state && state.claimedAt) return RpcHelpers.errorResponse("Already claimed");

    if (!state) {
      state = { eventId: data.eventId };
      userStates[data.eventId] = state;
    }

    var reward: Hiro.ResolvedReward | null = null;
    if (def.reward) {
      reward = RewardEngine.resolveReward(nk, def.reward);
      RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
    }

    state.claimedAt = Math.floor(Date.now() / 1000);
    saveUserLiveEventStates(nk, userId, userStates);

    return RpcHelpers.successResponse({ reward: reward });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_live_events_list", rpcList);
    initializer.registerRpc("satori_live_events_join", rpcJoin);
    initializer.registerRpc("satori_live_events_claim", rpcClaim);
  }
}
