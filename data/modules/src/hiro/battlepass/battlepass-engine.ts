namespace BattlePassEngine {

  // ─── Types ────────────────────────────────────────────────────────────────
  // Season shape matches what the admin dashboard BattlepassConfigPage saves
  // under hiro_configs "incentives" → { incentives: { <seasonId>: SeasonDef } }.

  interface TierDef {
    tier: number;
    points_required: number;
    // Dashboard stores free-form grants ({ currencies: {...} }) — normalised
    // to a full Hiro.Reward before granting.
    free_reward?: any;
    premium_reward?: any;
  }

  interface SeasonDef {
    id: string;
    name: string;
    type?: string;
    start_time_sec?: number;
    end_time_sec?: number;
    disabled?: boolean;
    tiers: TierDef[];
    audiences?: string[];
    metadata?: {
      xp_sources?: { [eventType: string]: number };
      premium_price?: { [currencyId: string]: number };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  interface PlayerSeasonState {
    seasonId: string;
    xp: number;
    premium: boolean;
    premiumUnlockedAt: number | null;
    claimedFree: number[];
    claimedPremium: number[];
    updatedAt: number;
  }

  interface PlayerState {
    seasons: { [seasonId: string]: PlayerSeasonState };
  }

  // ─── Storage ──────────────────────────────────────────────────────────────

  var STATE_COLLECTION = "battlepass_state";

  function stateKey(gameId: string, userId: string): string {
    return gameId + "_" + userId;
  }

  function loadPlayerState(nk: nkruntime.Nakama, userId: string, gameId: string): PlayerState {
    var rows: nkruntime.StorageObject[] = [];
    try {
      rows = nk.storageRead([{ collection: STATE_COLLECTION, key: stateKey(gameId, userId), userId: userId }]);
    } catch (_) {}
    if (rows && rows.length > 0 && rows[0].value) return rows[0].value as PlayerState;
    return { seasons: {} };
  }

  function savePlayerState(nk: nkruntime.Nakama, userId: string, gameId: string, state: PlayerState): void {
    nk.storageWrite([{
      collection: STATE_COLLECTION,
      key: stateKey(gameId, userId),
      userId: userId,
      value: state,
      permissionRead:  1 as nkruntime.ReadPermissionValues,
      permissionWrite: 0 as nkruntime.WritePermissionValues
    }]);
  }

  function getOrCreateSeasonState(state: PlayerState, seasonId: string): PlayerSeasonState {
    if (!state.seasons[seasonId]) {
      state.seasons[seasonId] = {
        seasonId: seasonId, xp: 0, premium: false, premiumUnlockedAt: null,
        claimedFree: [], claimedPremium: [], updatedAt: 0
      };
    }
    return state.seasons[seasonId];
  }

  // ─── Config ───────────────────────────────────────────────────────────────

  function loadSeasons(nk: nkruntime.Nakama, gameId: string): SeasonDef[] {
    var cfg = ConfigLoader.loadConfigForGame<any>(nk, "incentives", gameId, {});
    var map = (cfg && cfg.incentives) ? cfg.incentives : {};
    var out: SeasonDef[] = [];
    for (var key in map) {
      var s = map[key] as SeasonDef;
      if (!s || s.disabled) continue;
      // The incentives map can also hold non-battlepass campaign entries;
      // only entries with a tier ladder are seasons.
      if (!s.tiers || !s.tiers.length) continue;
      if (s.type && s.type !== "battle_pass" && s.type !== "season_pass" && s.type !== "event_pass") continue;
      if (!s.id) s.id = key;
      out.push(s);
    }
    return out;
  }

  function isSeasonActive(s: SeasonDef, now: number): boolean {
    if (s.start_time_sec && now < s.start_time_sec) return false;
    if (s.end_time_sec && now > s.end_time_sec) return false;
    return true;
  }

  function sortedTiers(s: SeasonDef): TierDef[] {
    return (s.tiers || []).slice().sort(function(a, b) { return a.points_required - b.points_required; });
  }

  function tierForXp(tiers: TierDef[], xp: number): number {
    var t = 0;
    for (var i = 0; i < tiers.length; i++) {
      if (xp >= tiers[i].points_required) t = tiers[i].tier;
    }
    return t;
  }

  // Dashboard reward JSON is a bare grant ({currencies:{...}}); wrap it so
  // RewardEngine sees a canonical Hiro.Reward. Full rewards pass through.
  function normalizeReward(reward: any): Hiro.Reward | null {
    if (!reward) return null;
    if (reward.guaranteed || reward.weighted) return reward as Hiro.Reward;
    return { guaranteed: reward } as Hiro.Reward;
  }

  function grantTierReward(
    nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context,
    userId: string, gameId: string, reward: any, seasonId: string, tier: number, track: string
  ): boolean {
    var normalized = normalizeReward(reward);
    if (!normalized) return false;
    try {
      var resolved = RewardEngine.resolveReward(nk, normalized);
      RewardEngine.grantReward(nk, logger, ctx, userId, gameId, resolved);
      logger.info("[BattlePass] Tier reward granted: season=%s tier=%d track=%s user=%s", seasonId, tier, track, userId);
      return true;
    } catch (e: any) {
      logger.error("[BattlePass] Tier reward grant failed: season=%s tier=%d err=%s", seasonId, tier, (e && e.message ? e.message : String(e)));
      return false;
    }
  }

  // ─── Core: XP accrual + tier auto-grant ───────────────────────────────────
  // Called from QuestEngine.processEventInternal so both the record_event RPC
  // and the EventBus analytics bridge feed battle pass XP automatically.

  export function processEvent(
    nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context,
    userId: string, gameId: string, eventType: string, value: number
  ): void {
    var now = Math.floor(Date.now() / 1000);
    var seasons = loadSeasons(nk, gameId);
    if (seasons.length === 0) return;

    var state: PlayerState | null = null;
    var stateModified = false;

    for (var i = 0; i < seasons.length; i++) {
      var season = seasons[i];
      if (!isSeasonActive(season, now)) continue;
      var xpSources = (season.metadata && season.metadata.xp_sources) || {};
      var xpGain = xpSources[eventType];
      if (!xpGain || xpGain <= 0) continue;

      if (!state) state = loadPlayerState(nk, userId, gameId);
      var ss = getOrCreateSeasonState(state, season.id);

      var tiers = sortedTiers(season);
      var prevXp = ss.xp;
      ss.xp = prevXp + xpGain;
      ss.updatedAt = now;
      stateModified = true;

      // Auto-grant every tier crossed by this XP gain.
      for (var t = 0; t < tiers.length; t++) {
        var tier = tiers[t];
        if (tier.points_required > prevXp && tier.points_required <= ss.xp) {
          if (tier.free_reward && ss.claimedFree.indexOf(tier.tier) === -1) {
            if (grantTierReward(nk, logger, ctx, userId, gameId, tier.free_reward, season.id, tier.tier, "free")) {
              ss.claimedFree.push(tier.tier);
            }
          }
          if (ss.premium && tier.premium_reward && ss.claimedPremium.indexOf(tier.tier) === -1) {
            if (grantTierReward(nk, logger, ctx, userId, gameId, tier.premium_reward, season.id, tier.tier, "premium")) {
              ss.claimedPremium.push(tier.tier);
            }
          }
          try {
            EventBus.emit(nk, logger, ctx, EventBus.Events.QUEST_STEP_COMPLETED, {
              userId: userId, questId: "battlepass:" + season.id, stepId: "tier_" + tier.tier
            });
          } catch (_) {}
        }
      }
    }

    if (state && stateModified) {
      savePlayerState(nk, userId, gameId, state);
    }
  }

  // ─── RPC: battlepass_get ──────────────────────────────────────────────────

  function rpcBattlePassGet(
    ctx: nkruntime.Context, logger: nkruntime.Logger,
    nk: nkruntime.Nakama, payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = RpcHelpers.gameId(data) || Constants.DEFAULT_GAME_ID;
    var now = Math.floor(Date.now() / 1000);

    var seasons = loadSeasons(nk, gameId);
    var state = loadPlayerState(nk, userId, gameId);

    var out: any[] = [];
    for (var i = 0; i < seasons.length; i++) {
      var season = seasons[i];
      var active = isSeasonActive(season, now);
      if (!active && !(data.includeInactive === true)) continue;
      var ss = state.seasons[season.id] || null;
      var tiers = sortedTiers(season);
      var xp = ss ? ss.xp : 0;
      out.push({
        id: season.id,
        name: season.name,
        active: active,
        startTimeSec: season.start_time_sec || null,
        endTimeSec: season.end_time_sec || null,
        premiumPrice: (season.metadata && season.metadata.premium_price) || null,
        xpSources: (season.metadata && season.metadata.xp_sources) || {},
        tiers: tiers.map(function(t) {
          return {
            tier: t.tier,
            pointsRequired: t.points_required,
            freeReward: t.free_reward || null,
            premiumReward: t.premium_reward || null,
            freeClaimed: !!(ss && ss.claimedFree.indexOf(t.tier) !== -1),
            premiumClaimed: !!(ss && ss.claimedPremium.indexOf(t.tier) !== -1)
          };
        }),
        player: {
          xp: xp,
          tier: tierForXp(tiers, xp),
          premium: !!(ss && ss.premium),
          premiumUnlockedAt: ss ? ss.premiumUnlockedAt : null
        }
      });
    }

    return RpcHelpers.successResponse({ seasons: out });
  }

  // ─── RPC: battlepass_record_event ────────────────────────────────────────
  // Direct XP path for apps that call RPCs instead of emitting analytics
  // events (mirrors quest_engine_record_event's trust model).

  function rpcBattlePassRecordEvent(
    ctx: nkruntime.Context, logger: nkruntime.Logger,
    nk: nkruntime.Nakama, payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = RpcHelpers.gameId(data) || Constants.DEFAULT_GAME_ID;
    var eventType = data.eventType as string;
    if (!eventType) return RpcHelpers.errorResponse("eventType is required");
    var value = (data.value !== undefined && data.value !== null) ? Number(data.value) : 0;

    processEvent(nk, logger, ctx, userId, gameId, eventType, value);

    // Return fresh state so clients can update the pass UI in one call.
    return rpcBattlePassGet(ctx, logger, nk, payload);
  }

  // ─── RPC: battlepass_unlock_premium ──────────────────────────────────────
  // Spends premium_price from the game wallet, flips premium on, and
  // retro-grants premium rewards for tiers the player already reached.

  function rpcBattlePassUnlockPremium(
    ctx: nkruntime.Context, logger: nkruntime.Logger,
    nk: nkruntime.Nakama, payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = RpcHelpers.gameId(data) || Constants.DEFAULT_GAME_ID;
    var seasonId = data.seasonId as string;
    if (!seasonId) return RpcHelpers.errorResponse("seasonId is required");

    var now = Math.floor(Date.now() / 1000);
    var seasons = loadSeasons(nk, gameId);
    var season: SeasonDef | null = null;
    for (var i = 0; i < seasons.length; i++) {
      if (seasons[i].id === seasonId) { season = seasons[i]; break; }
    }
    if (!season) return RpcHelpers.errorResponse("Unknown season: " + seasonId);
    if (!isSeasonActive(season, now)) return RpcHelpers.errorResponse("Season is not active");

    var state = loadPlayerState(nk, userId, gameId);
    var ss = getOrCreateSeasonState(state, seasonId);
    if (ss.premium) return RpcHelpers.errorResponse("Premium already unlocked");

    var price = (season.metadata && season.metadata.premium_price) || {};
    for (var cur in price) {
      if (price[cur] > 0) {
        try {
          WalletHelpers.spendCurrency(nk, logger, ctx, userId, gameId, cur, price[cur]);
        } catch (e: any) {
          return RpcHelpers.errorResponse((e && e.message ? e.message : "Insufficient balance"));
        }
      }
    }

    ss.premium = true;
    ss.premiumUnlockedAt = now;
    ss.updatedAt = now;

    // Retro-grant premium rewards for tiers already reached.
    var tiers = sortedTiers(season);
    var granted: number[] = [];
    for (var t = 0; t < tiers.length; t++) {
      var tier = tiers[t];
      if (tier.points_required <= ss.xp && tier.premium_reward && ss.claimedPremium.indexOf(tier.tier) === -1) {
        if (grantTierReward(nk, logger, ctx, userId, gameId, tier.premium_reward, seasonId, tier.tier, "premium-retro")) {
          ss.claimedPremium.push(tier.tier);
          granted.push(tier.tier);
        }
      }
    }

    savePlayerState(nk, userId, gameId, state);
    logger.info("[BattlePass] Premium unlocked: season=%s user=%s retroTiers=%d", seasonId, userId, granted.length);

    return RpcHelpers.successResponse({ unlocked: true, seasonId: seasonId, retroGrantedTiers: granted });
  }

  // ─── Register ─────────────────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("battlepass_get",            rpcBattlePassGet);
    initializer.registerRpc("battlepass_record_event",   rpcBattlePassRecordEvent);
    initializer.registerRpc("battlepass_unlock_premium", rpcBattlePassUnlockPremium);
  }
}
