namespace LegacyGiftCards {

  function safeRead(nk: nkruntime.Nakama, collection: string, key: string, userId: string): any {
    try {
      var recs = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
      if (recs && recs.length > 0) return recs[0].value;
    } catch (_) {}
    return null;
  }

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gameId = data.game_id;
      if (!gameId) return RpcHelpers.errorResponse("game_id required");

      var records: any[] = [];
      try {
        var result = nk.storageRead([{ collection: "game_gift_cards", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
        if (result && result.length > 0 && result[0].value && result[0].value.cards) records = result[0].value.cards;
      } catch (_) {}

      var now = Date.now();
      var active: any[] = [];
      for (var i = 0; i < records.length; i++) {
        var c = records[i];
        if (c.status !== "active") continue;
        if (c.valid_from && new Date(c.valid_from).getTime() > now) continue;
        if (c.valid_until && new Date(c.valid_until).getTime() < now) continue;
        if (c.stock_total !== null && c.stock_sold >= c.stock_total) continue;
        active.push(c);
      }

      return RpcHelpers.successResponse({ cards: active, total: active.length });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message);
    }
  }

  function rpcPurchase(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var gameId = data.game_id;
      var cardId = data.card_id;
      if (!gameId || !cardId) return RpcHelpers.errorResponse("game_id and card_id required");

      var catalogRecs = nk.storageRead([{ collection: "game_gift_cards", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
      if (!catalogRecs || catalogRecs.length === 0) return RpcHelpers.errorResponse("No gift card catalog for this game");

      var cards = catalogRecs[0].value.cards || [];
      var card: any = null;
      var cardIdx = -1;
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].id === cardId) { card = cards[i]; cardIdx = i; break; }
      }
      if (!card) return RpcHelpers.errorResponse("Gift card not found");
      if (card.status !== "active") return RpcHelpers.errorResponse("Gift card not available");

      var now = Date.now();
      if (card.valid_from && new Date(card.valid_from).getTime() > now) return RpcHelpers.errorResponse("Gift card not yet available");
      if (card.valid_until && new Date(card.valid_until).getTime() < now) return RpcHelpers.errorResponse("Gift card has expired");
      if (card.stock_total !== null && card.stock_sold >= card.stock_total) return RpcHelpers.errorResponse("Gift card sold out");

      if (card.max_per_user > 0) {
        var purchaseKey = "purchases:" + gameId + ":" + userId;
        var userPurchases = safeRead(nk, "game_gift_card_purchases", purchaseKey, userId);
        var userCount = 0;
        if (userPurchases && userPurchases.purchases) {
          for (var j = 0; j < userPurchases.purchases.length; j++) {
            if (userPurchases.purchases[j].card_id === cardId) userCount++;
          }
        }
        if (userCount >= card.max_per_user) return RpcHelpers.errorResponse("Maximum purchases per user reached");
      }

      var currency = card.coin_currency || "coins";
      var debitChangeset: { [k: string]: number } = {};
      debitChangeset[currency] = -card.coin_price;

      var walletResult: any;
      try {
        walletResult = nk.walletUpdate(userId, debitChangeset, { reason: "game_gift_card:" + cardId }, true);
      } catch (walletErr: any) {
        return RpcHelpers.errorResponse("Insufficient coins: " + walletErr.message);
      }

      cards[cardIdx].stock_sold = (cards[cardIdx].stock_sold || 0) + 1;
      if (cards[cardIdx].stock_total !== null && cards[cardIdx].stock_sold >= cards[cardIdx].stock_total) {
        cards[cardIdx].status = "sold_out";
      }
      nk.storageWrite([{
        collection: "game_gift_cards", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID,
        value: { cards: cards, updated_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
      }]);

      var purchaseRecord = {
        purchase_id: nk.uuidv4(), card_id: cardId, card_name: card.name,
        coin_price: card.coin_price, coin_currency: currency,
        reward_type: card.reward_type, reward_payload: card.reward_payload,
        purchased_at: new Date().toISOString()
      };

      var purchaseHistoryKey = "purchases:" + gameId + ":" + userId;
      var existing = safeRead(nk, "game_gift_card_purchases", purchaseHistoryKey, userId);
      var allPurchases = (existing && existing.purchases) ? existing.purchases : [];
      allPurchases.push(purchaseRecord);
      nk.storageWrite([{
        collection: "game_gift_card_purchases", key: purchaseHistoryKey, userId: userId,
        value: { purchases: allPurchases, updated_at: new Date().toISOString() }, permissionRead: 1, permissionWrite: 0
      }]);

      return RpcHelpers.successResponse({ purchase: purchaseRecord, new_wallet: walletResult || {}, message: "Gift card purchased successfully" });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message);
    }
  }

  function rpcSyncCatalog(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!data.game_id || !data.cards) return RpcHelpers.errorResponse("game_id and cards[] required");
      nk.storageWrite([{
        collection: "game_gift_cards", key: "catalog:" + data.game_id, userId: Constants.SYSTEM_USER_ID,
        value: { cards: data.cards, synced_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
      }]);
      return RpcHelpers.successResponse({ synced: data.cards.length });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message);
    }
  }

  function rpcGetPurchases(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!data.game_id) return RpcHelpers.errorResponse("game_id required");
      var purchaseKey = "purchases:" + data.game_id + ":" + userId;
      var existing = safeRead(nk, "game_gift_card_purchases", purchaseKey, userId);
      var purchases = (existing && existing.purchases) ? existing.purchases : [];
      return RpcHelpers.successResponse({ purchases: purchases, total: purchases.length });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("game_gift_card_list", rpcList);
    initializer.registerRpc("game_gift_card_purchase", rpcPurchase);
    initializer.registerRpc("game_gift_card_sync_catalog", rpcSyncCatalog);
    initializer.registerRpc("game_gift_card_get_purchases", rpcGetPurchases);
  }
}
