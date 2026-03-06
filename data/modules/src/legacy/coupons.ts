namespace LegacyCoupons {

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
        var result = nk.storageRead([{ collection: "game_coupons", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
        if (result && result.length > 0 && result[0].value && result[0].value.coupons) records = result[0].value.coupons;
      } catch (_) {}

      var now = Date.now();
      var active: any[] = [];
      for (var i = 0; i < records.length; i++) {
        var c = records[i];
        if (c.status !== "active") continue;
        if (c.valid_from && new Date(c.valid_from).getTime() > now) continue;
        if (c.valid_until && new Date(c.valid_until).getTime() < now) continue;
        if (c.max_redemptions !== null && c.current_redemptions >= c.max_redemptions) continue;
        active.push(c);
      }

      return RpcHelpers.successResponse({ coupons: active, total: active.length });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message);
    }
  }

  function rpcRedeem(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var gameId = data.game_id;
      var couponId = data.coupon_id;
      if (!gameId || !couponId) return RpcHelpers.errorResponse("game_id and coupon_id required");

      var catalogRecs = nk.storageRead([{ collection: "game_coupons", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
      if (!catalogRecs || catalogRecs.length === 0) return RpcHelpers.errorResponse("No coupon catalog for this game");

      var coupons = catalogRecs[0].value.coupons || [];
      var coupon: any = null;
      var couponIdx = -1;
      for (var i = 0; i < coupons.length; i++) {
        if (coupons[i].id === couponId) { coupon = coupons[i]; couponIdx = i; break; }
      }
      if (!coupon) return RpcHelpers.errorResponse("Coupon not found");
      if (coupon.status !== "active") return RpcHelpers.errorResponse("Coupon not available");

      var now = Date.now();
      if (coupon.valid_from && new Date(coupon.valid_from).getTime() > now) return RpcHelpers.errorResponse("Coupon not yet available");
      if (coupon.valid_until && new Date(coupon.valid_until).getTime() < now) return RpcHelpers.errorResponse("Coupon has expired");
      if (coupon.max_redemptions !== null && coupon.current_redemptions >= coupon.max_redemptions) return RpcHelpers.errorResponse("Coupon fully redeemed");

      if (coupon.max_per_user > 0) {
        var redemptionKey = "redemptions:" + gameId + ":" + userId;
        var userRedemptions = safeRead(nk, "game_coupon_redemptions", redemptionKey, userId);
        var userCount = 0;
        if (userRedemptions && userRedemptions.redemptions) {
          for (var j = 0; j < userRedemptions.redemptions.length; j++) {
            if (userRedemptions.redemptions[j].coupon_id === couponId) userCount++;
          }
        }
        if (userCount >= coupon.max_per_user) return RpcHelpers.errorResponse("Maximum redemptions per user reached");
      }

      if (coupon.coin_cost > 0) {
        var currency = coupon.coin_currency || "coins";
        var debitChangeset: { [k: string]: number } = {};
        debitChangeset[currency] = -coupon.coin_cost;
        try {
          nk.walletUpdate(userId, debitChangeset, { reason: "game_coupon:" + couponId }, true);
        } catch (walletErr: any) {
          return RpcHelpers.errorResponse("Insufficient coins: " + walletErr.message);
        }
      }

      coupons[couponIdx].current_redemptions = (coupons[couponIdx].current_redemptions || 0) + 1;
      if (coupons[couponIdx].max_redemptions !== null && coupons[couponIdx].current_redemptions >= coupons[couponIdx].max_redemptions) {
        coupons[couponIdx].status = "exhausted";
      }
      nk.storageWrite([{
        collection: "game_coupons", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID,
        value: { coupons: coupons, updated_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
      }]);

      var redemptionRecord = {
        redemption_id: nk.uuidv4(), coupon_id: couponId, coupon_title: coupon.title,
        coupon_code: coupon.coupon_code, coin_cost: coupon.coin_cost,
        discount_type: coupon.discount_type, discount_value: coupon.discount_value,
        reward_payload: coupon.reward_payload, redeemed_at: new Date().toISOString()
      };

      var historyKey = "redemptions:" + gameId + ":" + userId;
      var existing = safeRead(nk, "game_coupon_redemptions", historyKey, userId);
      var allRedemptions = (existing && existing.redemptions) ? existing.redemptions : [];
      allRedemptions.push(redemptionRecord);
      nk.storageWrite([{
        collection: "game_coupon_redemptions", key: historyKey, userId: userId,
        value: { redemptions: allRedemptions, updated_at: new Date().toISOString() }, permissionRead: 1, permissionWrite: 0
      }]);

      return RpcHelpers.successResponse({ redemption: redemptionRecord, message: "Coupon redeemed successfully" });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message);
    }
  }

  function rpcSyncCatalog(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!data.game_id || !data.coupons) return RpcHelpers.errorResponse("game_id and coupons[] required");
      nk.storageWrite([{
        collection: "game_coupons", key: "catalog:" + data.game_id, userId: Constants.SYSTEM_USER_ID,
        value: { coupons: data.coupons, synced_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
      }]);
      return RpcHelpers.successResponse({ synced: data.coupons.length });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("game_coupon_list", rpcList);
    initializer.registerRpc("game_coupon_redeem", rpcRedeem);
    initializer.registerRpc("game_coupon_sync_catalog", rpcSyncCatalog);
  }
}
