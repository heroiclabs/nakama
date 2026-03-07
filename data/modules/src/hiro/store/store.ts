namespace HiroStore {

  var DEFAULT_CONFIG: Hiro.StoreConfig = { sections: {} };

  export function getConfig(nk: nkruntime.Nakama): Hiro.StoreConfig {
    return ConfigLoader.loadConfig<Hiro.StoreConfig>(nk, "store", DEFAULT_CONFIG);
  }

  interface UserPurchases {
    purchases: { [offerId: string]: { count: number; lastPurchaseAt: number } };
  }

  function getUserPurchases(nk: nkruntime.Nakama, userId: string, gameId?: string): UserPurchases {
    var data = Storage.readJson<UserPurchases>(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "store_purchases_" + userId), userId);
    return data || { purchases: {} };
  }

  function saveUserPurchases(nk: nkruntime.Nakama, userId: string, data: UserPurchases, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "store_purchases_" + userId), userId, data);
  }

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = getConfig(nk);
    var purchases = getUserPurchases(nk, userId, data.gameId);
    var now = Math.floor(Date.now() / 1000);

    var result: any = {};
    for (var sectionId in config.sections) {
      var section = config.sections[sectionId];
      var items: any[] = [];
      for (var offerId in section.items) {
        var offer = section.items[offerId];
        if (offer.availableAt && now < offer.availableAt) continue;
        if (offer.expiresAt && now > offer.expiresAt) continue;

        var purchaseCount = purchases.purchases[offerId] ? purchases.purchases[offerId].count : 0;
        var available = !offer.maxPurchases || purchaseCount < offer.maxPurchases;

        items.push({
          id: offerId,
          name: offer.name,
          description: offer.description,
          cost: offer.cost,
          available: available,
          purchaseCount: purchaseCount,
          maxPurchases: offer.maxPurchases,
          expiresAt: offer.expiresAt,
          additionalProperties: offer.additionalProperties
        });
      }
      result[sectionId] = { name: section.name, items: items };
    }

    return RpcHelpers.successResponse({ sections: result });
  }

  function rpcPurchase(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.offerId) return RpcHelpers.errorResponse("offerId required");

    var config = getConfig(nk);
    var offer: Hiro.StoreOfferConfig | null = null;
    for (var sectionId in config.sections) {
      if (config.sections[sectionId].items[data.offerId]) {
        offer = config.sections[sectionId].items[data.offerId];
        break;
      }
    }
    if (!offer) return RpcHelpers.errorResponse("Unknown offer");

    var now = Math.floor(Date.now() / 1000);
    if (offer.availableAt && now < offer.availableAt) return RpcHelpers.errorResponse("Offer not yet available");
    if (offer.expiresAt && now > offer.expiresAt) return RpcHelpers.errorResponse("Offer expired");

    var purchases = getUserPurchases(nk, userId, data.gameId);
    var purchaseCount = purchases.purchases[data.offerId] ? purchases.purchases[data.offerId].count : 0;
    if (offer.maxPurchases && purchaseCount >= offer.maxPurchases) return RpcHelpers.errorResponse("Max purchases reached");

    if (offer.cost && offer.cost.currencies) {
      for (var cid in offer.cost.currencies) {
        WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, offer.cost.currencies[cid]!);
      }
    }

    var resolved = RewardEngine.resolveReward(nk, offer.reward);
    RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);

    if (!purchases.purchases[data.offerId]) {
      purchases.purchases[data.offerId] = { count: 0, lastPurchaseAt: 0 };
    }
    purchases.purchases[data.offerId].count++;
    purchases.purchases[data.offerId].lastPurchaseAt = now;
    saveUserPurchases(nk, userId, purchases, data.gameId);

    EventBus.emit(nk, logger, ctx, EventBus.Events.STORE_PURCHASE, {
      userId: userId, offerId: data.offerId, reward: resolved
    });

    return RpcHelpers.successResponse({ reward: resolved });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_store_list", rpcList);
    initializer.registerRpc("hiro_store_purchase", rpcPurchase);
  }
}
