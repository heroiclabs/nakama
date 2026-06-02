namespace HiroBase {

  // ---- IAP Validation ----

  export type IAPStoreType = "apple" | "google" | "facebook" | "fake";

  interface IAPValidationRequest {
    receipt: string;
    storeType: IAPStoreType;
    productId: string;
    price?: number;
    currency?: string;
  }

  interface IAPValidationResult {
    valid: boolean;
    productId: string;
    transactionId?: string;
    storeType: IAPStoreType;
    error?: string;
  }

  interface UserPurchaseHistory {
    purchases: { transactionId: string; productId: string; storeType: string; validatedAt: number; price?: number }[];
  }

  var IAP_COLLECTION = "hiro_iap_purchases";
  var allowFakeReceipts = false;

  export function validateReceipt(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, request: IAPValidationRequest): IAPValidationResult {
    switch (request.storeType) {
      case "apple":
        return validateApple(nk, logger, userId, request);
      case "google":
        return validateGoogle(nk, logger, userId, request);
      case "facebook":
        return validateFacebook(nk, logger, userId, request);
      case "fake":
        if (!allowFakeReceipts) {
          return { valid: false, productId: request.productId, storeType: request.storeType, error: "Fake receipts disabled" };
        }
        return { valid: true, productId: request.productId, storeType: request.storeType, transactionId: "fake_" + nk.uuidv4() };
      default:
        return { valid: false, productId: request.productId, storeType: request.storeType, error: "Unknown store type" };
    }
  }

  function validateApple(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, request: IAPValidationRequest): IAPValidationResult {
    try {
      var validation = nk.purchaseValidateApple(userId, request.receipt);
      if (validation && validation.validatedPurchases && validation.validatedPurchases.length > 0) {
        var purchase = validation.validatedPurchases[0];
        recordPurchase(nk, userId, purchase.transactionId || nk.uuidv4(), request.productId, "apple", request.price);
        return { valid: true, productId: request.productId, storeType: "apple", transactionId: purchase.transactionId };
      }
      return { valid: false, productId: request.productId, storeType: "apple", error: "Validation failed" };
    } catch (e: any) {
      logger.warn("Apple IAP validation error: %s", e.message || String(e));
      return { valid: false, productId: request.productId, storeType: "apple", error: e.message || String(e) };
    }
  }

  function validateGoogle(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, request: IAPValidationRequest): IAPValidationResult {
    try {
      var validation = nk.purchaseValidateGoogle(userId, request.receipt);
      if (validation && validation.validatedPurchases && validation.validatedPurchases.length > 0) {
        var purchase = validation.validatedPurchases[0];
        recordPurchase(nk, userId, purchase.transactionId || nk.uuidv4(), request.productId, "google", request.price);
        return { valid: true, productId: request.productId, storeType: "google", transactionId: purchase.transactionId };
      }
      return { valid: false, productId: request.productId, storeType: "google", error: "Validation failed" };
    } catch (e: any) {
      logger.warn("Google IAP validation error: %s", e.message || String(e));
      return { valid: false, productId: request.productId, storeType: "google", error: e.message || String(e) };
    }
  }

  function validateFacebook(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, request: IAPValidationRequest): IAPValidationResult {
    try {
      var validation = nk.purchaseValidateFacebookInstant(userId, request.receipt);
      if (validation && validation.validatedPurchases && validation.validatedPurchases.length > 0) {
        var purchase = validation.validatedPurchases[0];
        recordPurchase(nk, userId, purchase.transactionId || nk.uuidv4(), request.productId, "facebook", request.price);
        return { valid: true, productId: request.productId, storeType: "facebook", transactionId: purchase.transactionId };
      }
      return { valid: false, productId: request.productId, storeType: "facebook", error: "Validation failed" };
    } catch (e: any) {
      logger.warn("Facebook IAP validation error: %s", e.message || String(e));
      return { valid: false, productId: request.productId, storeType: "facebook", error: e.message || String(e) };
    }
  }

  function recordPurchase(nk: nkruntime.Nakama, userId: string, transactionId: string, productId: string, storeType: string, price?: number): void {
    var history = Storage.readJson<UserPurchaseHistory>(nk, IAP_COLLECTION, "history", userId);
    if (!history) history = { purchases: [] };

    // Idempotency: never re-grant the same transaction. Fake receipts generate
    // uuid-based IDs so they are naturally unique per call, but real store
    // transactions must never be credited twice.
    if (transactionId && transactionId.indexOf("fake_") !== 0) {
      for (var i = 0; i < history.purchases.length; i++) {
        if (history.purchases[i].transactionId === transactionId) {
          return; // already recorded — skip to prevent double-grant
        }
      }
    }

    history.purchases.push({
      transactionId: transactionId,
      productId: productId,
      storeType: storeType,
      validatedAt: Math.floor(Date.now() / 1000),
      price: price
    });
    Storage.writeJson(nk, IAP_COLLECTION, "history", userId, history);
  }

  // ---- Default Username Generation ----

  export function generateDefaultUsername(nk: nkruntime.Nakama): string {
    var counter = Storage.readSystemJson<{ count: number }>(nk, Constants.HIRO_CONFIGS_COLLECTION, "username_counter");
    var count = (counter && counter.count) || 0;
    count++;
    Storage.writeSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "username_counter", { count: count });
    var padded = String(count);
    while (padded.length < 8) padded = "0" + padded;
    return "Player" + padded;
  }

  // ---- Store IAP Purchase ----

  function rpcIAPPurchase(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.receipt || !data.storeType || !data.productId) {
      return RpcHelpers.errorResponse("receipt, storeType, and productId required");
    }

    var result = validateReceipt(nk, logger, userId, {
      receipt: data.receipt,
      storeType: data.storeType as IAPStoreType,
      productId: data.productId,
      price: data.price,
      currency: data.currency
    });

    if (!result.valid) {
      return RpcHelpers.errorResponse("IAP validation failed: " + (result.error || "unknown"));
    }

    // ── Post-validation: write to qv_entitlements (v2 products) ──────────
    //
    // Subscription products (QV Pro, Pro+, L&P) bypass the Hiro store config
    // and write directly to the qv_entitlements collection so the Unity client
    // can read them via quizverse_get_entitlements.
    //
    // One-time non-subscription purchases (NoAds, PartyMode, Microphone,
    // Exam packs, Inventory slots) are written to qv_entitlements.one_time.
    //
    // Consumables (coins, AI voice) first try the Hiro store grant path below;
    // AI voice credits are also mirrored to qv_entitlements.consumables.
    var productId = data.productId as string;

    var isSubscriptionProduct = isSubscription(productId);
    var isConsumableProduct   = isConsumable(productId);

    if (isSubscriptionProduct) {
      // Delegate to QvEntitlements.grantSubscription via rc_sync shape
      try {
        var expiresAt: string | null = null;
        if (data.expiresAt) expiresAt = data.expiresAt as string;
        QvEntitlements.grantSubscription(nk, logger, userId, productId, data.storeType, expiresAt);
        logger.info("[IAP] Subscription entitlement written: userId=" + userId + " productId=" + productId);
      } catch (e: any) {
        logger.warn("[IAP] grantSubscription error: " + (e && e.message ? e.message : String(e)));
      }
      // Subscriptions don't go through HiroStore rewards
      EventBus.emit(nk, logger, ctx, EventBus.Events.STORE_PURCHASE, {
        userId: userId, offerId: productId, reward: null, iap: true, price: data.price
      });
      return RpcHelpers.successResponse({ valid: true, reward: null, transactionId: result.transactionId });
    }

    // Non-subscription: try Hiro store config for reward grant
    var storeConfig = HiroStore.getConfig(nk);
    var offer: Hiro.StoreOfferConfig | null = null;
    for (var sectionId in storeConfig.sections) {
      for (var offerId in storeConfig.sections[sectionId].items) {
        var item = storeConfig.sections[sectionId].items[offerId];
        if (item.cost && item.cost.iapProductId === productId) {
          offer = item;
          break;
        }
      }
      if (offer) break;
    }

    var reward: any = null;
    if (offer) {
      var resolved = RewardEngine.resolveReward(nk, offer.reward);
      RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
      reward = resolved;
    } else {
      // Product not in Hiro store config — handle v2 one-time / consumable products
      try {
        if (isConsumableProduct && productId.indexOf("aivoice") !== -1) {
          var qty = productId.indexOf(".50") !== -1 ? 50
                  : productId.indexOf(".10") !== -1 ? 10 : 5;
          QvEntitlements.grantConsumable(nk, logger, userId, productId, qty);
        } else if (!isConsumableProduct) {
          // One-time purchase (NoAds, PartyMode, Microphone, ExamPack, Slots)
          QvEntitlements.grantOneTime(nk, logger, userId, productId);
        }
      } catch (e: any) {
        logger.warn("[IAP] v2 grant error for " + productId + ": " + (e && e.message ? e.message : String(e)));
      }
    }

    EventBus.emit(nk, logger, ctx, EventBus.Events.STORE_PURCHASE, {
      userId: userId, offerId: productId, reward: reward, iap: true, price: data.price
    });

    return RpcHelpers.successResponse({ valid: true, reward: reward, transactionId: result.transactionId });
  }

  // ── Product type classifiers (replicated from Unity ShopProductConfig) ──

  function isSubscription(productId: string): boolean {
    if (!productId) return false;
    return productId.indexOf(".pro.") !== -1 ||
           productId.indexOf(".proplus.") !== -1 ||
           productId === "com.intelliverse.quizverse.aifortune";
  }

  function isConsumable(productId: string): boolean {
    if (!productId) return false;
    return productId.indexOf("coins.") !== -1 ||
           productId.indexOf("aivoice.") !== -1 ||
           productId.indexOf(".1week") !== -1 ||
           productId.indexOf(".3week") !== -1;
  }

  function rpcGetPurchaseHistory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var history = Storage.readJson<UserPurchaseHistory>(nk, IAP_COLLECTION, "history", userId);
    return RpcHelpers.successResponse({ purchases: (history && history.purchases) || [] });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_iap_validate", rpcIAPPurchase);
    initializer.registerRpc("hiro_iap_history", rpcGetPurchaseHistory);
  }
}
