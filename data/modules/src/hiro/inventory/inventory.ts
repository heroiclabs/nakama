namespace HiroInventory {

  var DEFAULT_CONFIG: Hiro.InventoryConfig = { items: {} };

  export function getConfig(nk: nkruntime.Nakama): Hiro.InventoryConfig {
    return ConfigLoader.loadConfig<Hiro.InventoryConfig>(nk, "inventory", DEFAULT_CONFIG);
  }

  function getUserInventory(nk: nkruntime.Nakama, userId: string, gameId?: string): Hiro.UserInventory {
    var data = Storage.readJson<Hiro.UserInventory>(nk, Constants.HIRO_INVENTORY_COLLECTION, Constants.gameKey(gameId, "items"), userId);
    return data || { items: {} };
  }

  function saveUserInventory(nk: nkruntime.Nakama, userId: string, inv: Hiro.UserInventory, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_INVENTORY_COLLECTION, Constants.gameKey(gameId, "items"), userId, inv);
  }

  export function grantItem(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, itemId: string, count: number, stringProps?: { [key: string]: string }, numericProps?: { [key: string]: number }, gameId?: string): Hiro.InventoryItem {
    var config = getConfig(nk);
    var itemDef = config.items[itemId];
    var inv = getUserInventory(nk, userId, gameId);
    var now = Math.floor(Date.now() / 1000);

    var existing = inv.items[itemId];
    if (existing && itemDef && itemDef.stackable) {
      existing.count += count;
      if (itemDef.maxCount && existing.count > itemDef.maxCount) {
        existing.count = itemDef.maxCount;
      }
    } else {
      inv.items[itemId] = {
        id: itemId,
        count: count,
        acquiredAt: now,
        expiresAt: (itemDef && itemDef.durableSec) ? now + itemDef.durableSec : undefined,
        stringProperties: stringProps || {},
        numericProperties: numericProps || {}
      };
    }

    saveUserInventory(nk, userId, inv, gameId);

    EventBus.emit(nk, logger, ctx, EventBus.Events.ITEM_GRANTED, {
      userId: userId, itemId: itemId, count: count
    });

    return inv.items[itemId];
  }

  export function consumeItem(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, itemId: string, count: number, gameId?: string): boolean {
    var inv = getUserInventory(nk, userId, gameId);
    var item = inv.items[itemId];
    if (!item || item.count < count) {
      return false;
    }

    item.count -= count;
    if (item.count <= 0) {
      delete inv.items[itemId];
    }

    saveUserInventory(nk, userId, inv, gameId);

    EventBus.emit(nk, logger, ctx, EventBus.Events.ITEM_CONSUMED, {
      userId: userId, itemId: itemId, count: count
    });

    return true;
  }

  export function hasItem(nk: nkruntime.Nakama, userId: string, itemId: string, count: number, gameId?: string): boolean {
    var inv = getUserInventory(nk, userId, gameId);
    var item = inv.items[itemId];
    return !!item && item.count >= count;
  }

  function purgeExpired(inv: Hiro.UserInventory): Hiro.UserInventory {
    var now = Math.floor(Date.now() / 1000);
    for (var id in inv.items) {
      if (inv.items[id].expiresAt && inv.items[id].expiresAt! <= now) {
        delete inv.items[id];
      }
    }
    return inv;
  }

  // ---- RPCs ----

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId: string | undefined = data.gameId;
    var inv = getUserInventory(nk, userId, gameId);
    inv = purgeExpired(inv);
    saveUserInventory(nk, userId, inv, gameId);
    if (data.category) {
      var config = getConfig(nk);
      var filtered: { [id: string]: Hiro.InventoryItem } = {};
      for (var id in inv.items) {
        var def = config.items[id];
        if (def && def.category === data.category) {
          filtered[id] = inv.items[id];
        }
      }
      return RpcHelpers.successResponse({ items: filtered });
    }

    return RpcHelpers.successResponse({ items: inv.items });
  }

  function rpcGrant(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.itemId || !data.count) return RpcHelpers.errorResponse("itemId and count required");

    var item = grantItem(nk, logger, ctx, userId, data.itemId, data.count, data.stringProperties, data.numericProperties, data.gameId);
    return RpcHelpers.successResponse({ item: item });
  }

  function rpcConsume(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.itemId || !data.count) return RpcHelpers.errorResponse("itemId and count required");

    var ok = consumeItem(nk, logger, ctx, userId, data.itemId, data.count, data.gameId);
    if (!ok) return RpcHelpers.errorResponse("Insufficient items");
    return RpcHelpers.successResponse({ success: true });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_inventory_list", rpcList);
    initializer.registerRpc("hiro_inventory_grant", rpcGrant);
    initializer.registerRpc("hiro_inventory_consume", rpcConsume);
  }
}
