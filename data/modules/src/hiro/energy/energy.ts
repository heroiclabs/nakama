namespace HiroEnergy {

  var DEFAULT_CONFIG: Hiro.EnergyConfig = {
    energies: {
      lives: { name: "Lives", maxEnergy: 5, startCount: 5, regenTimeSec: 1800 }
    }
  };

  export function getConfig(nk: nkruntime.Nakama): Hiro.EnergyConfig {
    return ConfigLoader.loadConfig<Hiro.EnergyConfig>(nk, "energy", DEFAULT_CONFIG);
  }

  function getUserEnergy(nk: nkruntime.Nakama, userId: string, gameId?: string): Hiro.UserEnergy {
    var data = Storage.readJson<Hiro.UserEnergy>(nk, Constants.HIRO_ENERGY_COLLECTION, Constants.gameKey(gameId, "state"), userId);
    if (data) return data;

    var config = getConfig(nk);
    var energies: { [id: string]: Hiro.EnergyState } = {};
    var now = Math.floor(Date.now() / 1000);
    for (var id in config.energies) {
      var def = config.energies[id];
      energies[id] = {
        current: def.startCount,
        maxEnergy: def.maxEnergy,
        regenTimeSec: def.regenTimeSec,
        lastRegenAt: now
      };
    }
    return { energies: energies };
  }

  function saveUserEnergy(nk: nkruntime.Nakama, userId: string, state: Hiro.UserEnergy, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_ENERGY_COLLECTION, Constants.gameKey(gameId, "state"), userId, state);
  }

  function applyRegen(state: Hiro.EnergyState): Hiro.EnergyState {
    var now = Math.floor(Date.now() / 1000);
    if (state.current >= state.maxEnergy) {
      state.lastRegenAt = now;
      return state;
    }
    if (state.regenTimeSec <= 0) return state;

    var elapsed = now - state.lastRegenAt;
    var regenUnits = Math.floor(elapsed / state.regenTimeSec);

    // Purge expired modifiers
    if (state.modifiers) {
      state.modifiers = state.modifiers.filter(function(m: any) { return !m.expiresAt || m.expiresAt > now; });
      for (var mi = 0; mi < state.modifiers.length; mi++) {
        var mod = state.modifiers[mi];
        if (mod.id === "max_energy") {
          if (mod.operator === "add") state.maxEnergy += mod.value;
          else if (mod.operator === "multiply") state.maxEnergy = Math.floor(state.maxEnergy * mod.value);
        }
        if (mod.id === "regen_rate") {
          if (mod.operator === "add") state.regenTimeSec = Math.max(1, state.regenTimeSec - mod.value);
          else if (mod.operator === "multiply") state.regenTimeSec = Math.max(1, Math.floor(state.regenTimeSec / mod.value));
        }
      }
    }

    if (regenUnits > 0) {
      state.current = Math.min(state.current + regenUnits, state.maxEnergy);
      state.lastRegenAt = state.lastRegenAt + (regenUnits * state.regenTimeSec);
    }
    return state;
  }

  export function addEnergy(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, energyId: string, amount: number, gameId?: string): void {
    var state = getUserEnergy(nk, userId, gameId);
    var e = state.energies[energyId];
    if (!e) {
      var config = getConfig(nk);
      var def = config.energies[energyId];
      if (!def) return;
      e = {
        current: def.startCount,
        maxEnergy: def.maxEnergy,
        regenTimeSec: def.regenTimeSec,
        lastRegenAt: Math.floor(Date.now() / 1000)
      };
    }
    e = applyRegen(e);
    var maxOverfill = (e as any).maxOverfill || e.maxEnergy;
    e.current = Math.min(e.current + amount, maxOverfill);
    state.energies[energyId] = e;
    saveUserEnergy(nk, userId, state, gameId);

    EventBus.emit(nk, logger, ctx, EventBus.Events.ENERGY_REFILLED, {
      userId: userId, energyId: energyId, amount: amount, current: e.current
    });
  }

  export function spendEnergy(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, energyId: string, amount: number, gameId?: string): boolean {
    var state = getUserEnergy(nk, userId, gameId);
    var e = state.energies[energyId];
    if (!e) return false;

    e = applyRegen(e);
    if (e.current < amount) return false;

    e.current -= amount;
    state.energies[energyId] = e;
    saveUserEnergy(nk, userId, state, gameId);

    EventBus.emit(nk, logger, ctx, EventBus.Events.ENERGY_SPENT, {
      userId: userId, energyId: energyId, amount: amount, current: e.current
    });

    return true;
  }

  // ---- RPCs ----

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId: string | undefined = data.gameId;
    var state = getUserEnergy(nk, userId, gameId);
    var now = Math.floor(Date.now() / 1000);

    var result: any = {};
    for (var id in state.energies) {
      var e = applyRegen(state.energies[id]);
      var secsToNext = e.current >= e.maxEnergy ? 0 : e.regenTimeSec - (now - e.lastRegenAt);
      result[id] = {
        current: e.current,
        max: e.maxEnergy,
        regenTimeSec: e.regenTimeSec,
        secsToNextRegen: Math.max(0, secsToNext)
      };
    }

    saveUserEnergy(nk, userId, state, gameId);
    return RpcHelpers.successResponse({ energies: result });
  }

  function rpcSpend(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.energyId || !data.amount) return RpcHelpers.errorResponse("energyId and amount required");

    if (!spendEnergy(nk, logger, ctx, userId, data.energyId, data.amount, data.gameId)) {
      return RpcHelpers.errorResponse("Insufficient energy");
    }
    return RpcHelpers.successResponse({ success: true });
  }

  function rpcRefill(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.energyId) return RpcHelpers.errorResponse("energyId required");

    var config = getConfig(nk);
    var def = config.energies[data.energyId];
    if (!def) return RpcHelpers.errorResponse("Unknown energy type");

    addEnergy(nk, logger, ctx, userId, data.energyId, def.maxEnergy, data.gameId);
    return RpcHelpers.successResponse({ success: true });
  }

  function rpcAddModifier(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.energyId || !data.modifierId || !data.durationSec) {
      return RpcHelpers.errorResponse("energyId, modifierId, and durationSec required");
    }

    var state = getUserEnergy(nk, userId, data.gameId);
    var e = state.energies[data.energyId];
    if (!e) return RpcHelpers.errorResponse("Unknown energy type");

    if (!e.modifiers) e.modifiers = [];
    var now = Math.floor(Date.now() / 1000);
    e.modifiers.push({
      id: data.modifierId,
      operator: data.operator || "add",
      value: data.value || 0,
      durationSec: data.durationSec,
      expiresAt: now + data.durationSec
    });

    state.energies[data.energyId] = e;
    saveUserEnergy(nk, userId, state, data.gameId);
    return RpcHelpers.successResponse({ success: true, modifiers: e.modifiers });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_energy_get", rpcGet);
    initializer.registerRpc("hiro_energy_spend", rpcSpend);
    initializer.registerRpc("hiro_energy_refill", rpcRefill);
    initializer.registerRpc("hiro_energy_add_modifier", rpcAddModifier);
  }
}
