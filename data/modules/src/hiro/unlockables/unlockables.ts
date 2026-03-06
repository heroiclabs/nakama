namespace HiroUnlockables {

  var DEFAULT_CONFIG: Hiro.UnlockablesConfig = { unlockables: {} };

  export function getConfig(nk: nkruntime.Nakama): Hiro.UnlockablesConfig {
    return ConfigLoader.loadConfig<Hiro.UnlockablesConfig>(nk, "unlockables", DEFAULT_CONFIG);
  }

  interface UserUnlockableState {
    activeSlots: { [slotId: string]: { unlockableId: string; startedAt: number; completesAt: number; claimedAt?: number } };
    totalSlots: number;
  }

  function getUserState(nk: nkruntime.Nakama, userId: string, gameId?: string): UserUnlockableState {
    var data = Storage.readJson<UserUnlockableState>(nk, Constants.HIRO_UNLOCKABLES_COLLECTION, Constants.gameKey(gameId, "state"), userId);
    return data || { activeSlots: {}, totalSlots: 1 };
  }

  function saveUserState(nk: nkruntime.Nakama, userId: string, data: UserUnlockableState, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_UNLOCKABLES_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
  }

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var state = getUserState(nk, userId, data.gameId);
    var config = getConfig(nk);
    var now = Math.floor(Date.now() / 1000);

    var slots: any[] = [];
    for (var slotId in state.activeSlots) {
      var slot = state.activeSlots[slotId];
      slots.push({
        slotId: slotId,
        unlockableId: slot.unlockableId,
        startedAt: slot.startedAt,
        completesAt: slot.completesAt,
        ready: now >= slot.completesAt,
        claimed: !!slot.claimedAt
      });
    }

    return RpcHelpers.successResponse({ slots: slots, totalSlots: state.totalSlots, availableUnlockables: Object.keys(config.unlockables) });
  }

  function rpcStart(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.unlockableId) return RpcHelpers.errorResponse("unlockableId required");

    var config = getConfig(nk);
    var def = config.unlockables[data.unlockableId];
    if (!def) return RpcHelpers.errorResponse("Unknown unlockable");

    var state = getUserState(nk, userId, data.gameId);
    var activeCount = Object.keys(state.activeSlots).length;
    if (activeCount >= state.totalSlots) return RpcHelpers.errorResponse("No free slots");

    var now = Math.floor(Date.now() / 1000);
    var slotId = nk.uuidv4();
    state.activeSlots[slotId] = {
      unlockableId: data.unlockableId,
      startedAt: now,
      completesAt: now + def.waitTimeSec
    };
    saveUserState(nk, userId, state, data.gameId);

    return RpcHelpers.successResponse({ slotId: slotId });
  }

  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.slotId) return RpcHelpers.errorResponse("slotId required");

    var state = getUserState(nk, userId, data.gameId);
    var slot = state.activeSlots[data.slotId];
    if (!slot) return RpcHelpers.errorResponse("Slot not found");
    if (slot.claimedAt) return RpcHelpers.errorResponse("Already claimed");

    var now = Math.floor(Date.now() / 1000);
    if (now < slot.completesAt) return RpcHelpers.errorResponse("Not ready yet");

    var config = getConfig(nk);
    var def = config.unlockables[slot.unlockableId];
    var reward: Hiro.ResolvedReward | null = null;
    if (def && def.reward) {
      reward = RewardEngine.resolveReward(nk, def.reward);
      RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
    }

    slot.claimedAt = now;
    delete state.activeSlots[data.slotId];
    saveUserState(nk, userId, state, data.gameId);

    return RpcHelpers.successResponse({ reward: reward });
  }

  function rpcBuySlot(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.unlockableId) return RpcHelpers.errorResponse("unlockableId required");

    var config = getConfig(nk);
    var def = config.unlockables[data.unlockableId];
    if (!def) return RpcHelpers.errorResponse("Unknown unlockable");

    var state = getUserState(nk, userId, data.gameId);
    if (state.totalSlots >= (def.maxSlots || 4)) return RpcHelpers.errorResponse("Max slots reached");

    if (def.slotCost && def.slotCost.currencies) {
      for (var cid in def.slotCost.currencies) {
        WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, def.slotCost.currencies[cid]);
      }
    }

    state.totalSlots++;
    saveUserState(nk, userId, state, data.gameId);

    return RpcHelpers.successResponse({ totalSlots: state.totalSlots });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_unlockables_get", rpcGet);
    initializer.registerRpc("hiro_unlockables_start", rpcStart);
    initializer.registerRpc("hiro_unlockables_claim", rpcClaim);
    initializer.registerRpc("hiro_unlockables_buy_slot", rpcBuySlot);
  }
}
