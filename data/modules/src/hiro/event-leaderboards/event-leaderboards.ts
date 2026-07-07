namespace HiroEventLeaderboards {

  var DEFAULT_CONFIG: Hiro.EventLeaderboardConfig = { events: {} };

  export function getConfig(nk: nkruntime.Nakama, gameId?: string): Hiro.EventLeaderboardConfig {
    return ConfigLoader.loadConfigForGame<Hiro.EventLeaderboardConfig>(nk, "event_leaderboards", gameId, DEFAULT_CONFIG);
  }

  /* ------------------------------------------------------------------ *
   * Config normalization
   *
   * Three schemas coexist in the `event_leaderboards` config doc:
   *  1. Admin console (LeaderboardsConfigPage): { event_leaderboards: { id: def } }
   *     with snake_case fields (rank_min, start_time_sec, reward.currencies/xp…)
   *  2. Original runtime: { events: { id: def } } with camelCase (rankMin, Hiro.Reward)
   *  3. Legacy bare doc: { leaderboards: {…} } — static defs, not timed events; ignored.
   * The runtime folds 1+2 into one normalized map so admin-created leaderboards
   * are what the game actually serves.
   * ------------------------------------------------------------------ */

  interface NormalizedTier {
    rankMin: number;
    rankMax: number;
    reward: Hiro.Reward;
  }

  interface NormalizedEvent {
    id: string;
    name: string;
    description?: string;
    operator: string;             // best | set | incr | decr
    sortOrder: string;            // asc | desc
    startAt: number;              // 0 = active since forever
    endAt: number;                // 0 = no end
    disabled: boolean;
    tiers: NormalizedTier[];
    resetSchedule?: string;
    metadata?: any;
  }

  function adminRewardToHiro(r: any): Hiro.Reward {
    if (!r) return {};
    var currencies: { [k: string]: number } = {};
    var hasCur = false;
    if (r.currencies) {
      for (var c in r.currencies) { currencies[c] = r.currencies[c]; hasCur = true; }
    }
    if (r.xp) { currencies["xp"] = (currencies["xp"] || 0) + r.xp; hasCur = true; }
    var items: { [id: string]: number } = {};
    var hasItems = false;
    if (r.items && r.items.length) {
      for (var i = 0; i < r.items.length; i++) {
        var it = r.items[i];
        if (it && it.id) { items[it.id] = it.count || 1; hasItems = true; }
      }
    }
    var grant: any = {};
    if (hasCur) grant.currencies = currencies;
    if (hasItems) grant.items = items;
    if (r.energies) grant.energies = r.energies;
    return { guaranteed: grant };
  }

  function normalizeAdminDef(id: string, def: any): NormalizedEvent {
    var tiers: NormalizedTier[] = [];
    var src = def.tiers || [];
    for (var i = 0; i < src.length; i++) {
      var t = src[i];
      tiers.push({
        rankMin: t.rank_min != null ? t.rank_min : (t.rankMin || 1),
        rankMax: t.rank_max != null ? t.rank_max : (t.rankMax || 1),
        // Admin tiers carry a flat reward object; runtime tiers already carry Hiro.Reward.
        reward: (t.reward && (t.reward.guaranteed || t.reward.weighted)) ? t.reward : adminRewardToHiro(t.reward),
      });
    }
    var startAt = def.start_time_sec || 0;
    var endAt = def.end_time_sec || 0;
    if (!endAt && startAt && def.duration_sec) endAt = startAt + def.duration_sec;
    return {
      id: id,
      name: def.name || id,
      description: def.description,
      operator: def.operator || "best",
      sortOrder: def.sort_order === 1 || def.sort_order === "ascending" ? "asc" : "desc",
      startAt: startAt,
      endAt: endAt,
      disabled: !!def.disabled,
      tiers: tiers,
      resetSchedule: def.reset_schedule || undefined,
      metadata: def.metadata,
    };
  }

  function normalizeRuntimeDef(id: string, def: any): NormalizedEvent {
    var tiers: NormalizedTier[] = [];
    var src = def.tiers || [];
    for (var i = 0; i < src.length; i++) {
      var t = src[i];
      tiers.push({ rankMin: t.rankMin || 1, rankMax: t.rankMax || 1, reward: t.reward || {} });
    }
    return {
      id: id,
      name: def.name || id,
      description: def.description,
      operator: def.operator || "best",
      sortOrder: def.sortOrder === "asc" ? "asc" : "desc",
      startAt: def.startAt || 0,
      endAt: def.endAt || (def.startAt && def.durationSec ? def.startAt + def.durationSec : 0),
      disabled: !!def.disabled,
      tiers: tiers,
      metadata: def.metadata,
    };
  }

  function getEvents(nk: nkruntime.Nakama, gameId?: string): { [id: string]: NormalizedEvent } {
    var raw: any = getConfig(nk, gameId);
    var out: { [id: string]: NormalizedEvent } = {};
    var id: string;
    if (raw && raw.events) {
      for (id in raw.events) out[id] = normalizeRuntimeDef(id, raw.events[id]);
    }
    // Admin console schema wins on id collision — it is the actively managed store.
    if (raw && raw.event_leaderboards) {
      for (id in raw.event_leaderboards) out[id] = normalizeAdminDef(id, raw.event_leaderboards[id]);
    }
    return out;
  }

  function eventStatus(def: NormalizedEvent, now: number): string {
    if (def.startAt && now < def.startAt) return "upcoming";
    if (def.endAt && now > def.endAt) return "ended";
    return "active";
  }

  /* ------------------------------------------------------------------ *
   * Leaderboard provisioning
   * ------------------------------------------------------------------ */

  function canonicalGameId(nk: nkruntime.Nakama, gameId: string | undefined): string | undefined {
    try {
      if (typeof LegacyGameRegistry !== "undefined" && LegacyGameRegistry.resolveCanonicalGameId) {
        return LegacyGameRegistry.resolveCanonicalGameId(nk, gameId);
      }
    } catch (_e) { /* fall through */ }
    return gameId;
  }

  export function eventLeaderboardId(nk: nkruntime.Nakama, gameId: string | undefined, eventId: string): string {
    var canonical = canonicalGameId(nk, gameId);
    return canonical ? "event_lb_" + canonical + "_" + eventId : "event_lb_" + eventId;
  }

  var ensuredLbs: { [id: string]: boolean } = {};

  function ensureLeaderboard(nk: nkruntime.Nakama, logger: nkruntime.Logger, lbId: string, def: NormalizedEvent): void {
    if (ensuredLbs[lbId]) return;
    var operatorMap: { [key: string]: nkruntime.Operator } = {
      best: nkruntime.Operator.BEST, set: nkruntime.Operator.SET,
      incr: nkruntime.Operator.INCREMENTAL, decr: "decrement" as any,
    };
    var sort = def.sortOrder === "asc" ? nkruntime.SortOrder.ASCENDING : nkruntime.SortOrder.DESCENDING;
    try {
      nk.leaderboardCreate(lbId, false, sort, operatorMap[def.operator] || nkruntime.Operator.BEST,
        def.resetSchedule || null, { eventId: def.id, source: "event_leaderboards" }, true);
      ensuredLbs[lbId] = true;
    } catch (e: any) {
      // Already-exists is fine; anything else will surface again on record write.
      ensuredLbs[lbId] = true;
      logger.debug("[EventLB] leaderboardCreate %s: %s", lbId, String(e && e.message ? e.message : e));
    }
  }

  /* ------------------------------------------------------------------ *
   * User state
   * ------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------ *
   * RPCs
   * ------------------------------------------------------------------ */

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = RpcHelpers.gameId(data);
    var events = getEvents(nk, gameId);
    var userState = getUserEventState(nk, userId, gameId);
    var now = Math.floor(Date.now() / 1000);

    var result: any[] = [];
    for (var id in events) {
      var def = events[id];
      if (def.disabled) continue;

      var us = userState.events[id];
      result.push({
        eventId: id,
        name: def.name,
        description: def.description,
        leaderboardId: eventLeaderboardId(nk, gameId, id),
        startAt: def.startAt,
        endAt: def.endAt,
        status: eventStatus(def, now),
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

    var gameId = RpcHelpers.gameId(data);
    var events = getEvents(nk, gameId);
    var def = events[data.eventId];
    if (!def) return RpcHelpers.errorResponse("Unknown event");
    if (def.disabled) return RpcHelpers.errorResponse("Event disabled");

    var now = Math.floor(Date.now() / 1000);
    if (eventStatus(def, now) !== "active") return RpcHelpers.errorResponse("Event not in active window");

    var lbId = eventLeaderboardId(nk, gameId, data.eventId);
    ensureLeaderboard(nk, logger, lbId, def);

    var userState = getUserEventState(nk, userId, gameId);
    if (!userState.events[data.eventId]) {
      userState.events[data.eventId] = { joined: true, cohortId: "default" };
    }
    userState.events[data.eventId].joined = true;
    saveUserEventState(nk, userId, userState, gameId);

    var operatorMap: { [key: string]: nkruntime.OverrideOperator } = { best: nkruntime.OverrideOperator.BEST, set: nkruntime.OverrideOperator.SET, incr: nkruntime.OverrideOperator.INCREMENTAL, decr: nkruntime.OverrideOperator.DECREMENTAL };
    var op = operatorMap[def.operator] || nkruntime.OverrideOperator.BEST;
    nk.leaderboardRecordWrite(lbId, userId, ctx.username || "", data.score, data.subscore || 0, data.metadata || {}, op);

    EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, {
      userId: userId, eventId: data.eventId, score: data.score
    });

    return RpcHelpers.successResponse({ success: true, leaderboardId: lbId });
  }

  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var gameId = RpcHelpers.gameId(data);
    var events = getEvents(nk, gameId);
    var def = events[data.eventId];
    if (!def) return RpcHelpers.errorResponse("Unknown event");

    var userState = getUserEventState(nk, userId, gameId);
    var us = userState.events[data.eventId];
    if (!us || !us.joined) return RpcHelpers.errorResponse("Not joined");
    if (us.claimedAt) return RpcHelpers.errorResponse("Already claimed");

    var lbId = eventLeaderboardId(nk, gameId, data.eventId);
    var records = nk.leaderboardRecordsList(lbId, [userId], 1, undefined, 0);
    var rank = 0;
    if (records.records && records.records.length > 0) {
      rank = records.records[0].rank;
    }

    var reward: Hiro.ResolvedReward | null = null;
    for (var i = 0; i < def.tiers.length; i++) {
      var tier = def.tiers[i];
      if (rank >= tier.rankMin && rank <= tier.rankMax) {
        reward = RewardEngine.resolveReward(nk, tier.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", reward);
        break;
      }
    }

    us.claimedAt = Math.floor(Date.now() / 1000);
    saveUserEventState(nk, userId, userState, gameId);

    return RpcHelpers.successResponse({ rank: rank, reward: reward });
  }

  function rpcGetRankings(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var gameId = RpcHelpers.gameId(data);
    var events = getEvents(nk, gameId);
    var def = events[data.eventId];
    if (!def) return RpcHelpers.errorResponse("Event not found");

    var lbId = eventLeaderboardId(nk, gameId, data.eventId);
    ensureLeaderboard(nk, logger, lbId, def);
    var limit = data.limit || 50;
    var cursor = data.cursor || undefined;

    var result = nk.leaderboardRecordsList(lbId, [], limit, cursor, 0);

    var rankings: any[] = [];
    if (result.records) {
      for (var i = 0; i < result.records.length; i++) {
        var r = result.records[i];
        rankings.push({
          rank: r.rank,
          userId: r.ownerId,
          username: r.username || "",
          score: r.score,
          subscore: r.subscore,
          metadata: r.metadata,
          updateTime: r.updateTime,
        });
      }
    }

    var callerRank: any = null;
    var userId = ctx.userId;
    if (userId) {
      var ownerRecords = nk.leaderboardRecordsList(lbId, [userId], 1, undefined, 0);
      if (ownerRecords.records && ownerRecords.records.length > 0) {
        var cr = ownerRecords.records[0];
        callerRank = {
          rank: cr.rank,
          userId: cr.ownerId,
          username: cr.username || "",
          score: cr.score,
          subscore: cr.subscore,
        };
      }
    }

    return RpcHelpers.successResponse({
      eventId: data.eventId,
      name: def.name,
      leaderboardId: lbId,
      rankings: rankings,
      nextCursor: result.nextCursor || "",
      prevCursor: result.prevCursor || "",
      callerRank: callerRank,
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_event_lb_list", rpcList);
    initializer.registerRpc("hiro_event_lb_submit", rpcSubmit);
    initializer.registerRpc("hiro_event_lb_claim", rpcClaim);
    initializer.registerRpc("hiro_event_lb_get", rpcGetRankings);
    initializer.registerRpc("hiro_event_leaderboards_list", rpcList);
    initializer.registerRpc("hiro_event_leaderboards_submit", rpcSubmit);
    initializer.registerRpc("hiro_event_leaderboards_claim", rpcClaim);
    initializer.registerRpc("hiro_event_leaderboards_get", rpcGetRankings);
  }
}
