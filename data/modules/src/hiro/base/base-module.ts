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
  var allowFakeReceipts = true;

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

    var storeConfig = HiroStore.getConfig(nk);
    var offer: Hiro.StoreOfferConfig | null = null;
    for (var sectionId in storeConfig.sections) {
      for (var offerId in storeConfig.sections[sectionId].items) {
        var item = storeConfig.sections[sectionId].items[offerId];
        if (item.cost && item.cost.iapProductId === data.productId) {
          offer = item;
          break;
        }
      }
      if (offer) break;
    }

    if (!offer) {
      return RpcHelpers.errorResponse("No store item found for product ID: " + data.productId);
    }

    var resolved = RewardEngine.resolveReward(nk, offer.reward);
    RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);

    EventBus.emit(nk, logger, ctx, EventBus.Events.STORE_PURCHASE, {
      userId: userId, offerId: data.productId, reward: resolved, iap: true, price: data.price
    });

    return RpcHelpers.successResponse({ valid: true, reward: resolved, transactionId: result.transactionId });
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
