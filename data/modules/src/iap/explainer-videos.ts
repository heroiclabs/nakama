// ---------------------------------------------------------------------------
//  explainer-videos.ts — quizverse_videos_status / consume / grant
//
//  Storage: qv_entitlements / consumables
//    explainerVideoCredits  — purchased pack balance
//    explainerFreePreviewUsed — one-time 30s preview consumed
// ---------------------------------------------------------------------------

namespace QvExplainerVideos {

  var COLLECTION = "qv_entitlements";
  var KEY_CONS   = "consumables";
  var FREE_PREVIEW_SECONDS = 30;

  var PACK_UNITS: { [productId: string]: number } = {
    "videos_1_v3_1":  1,
    "videos_5_v3_1":  5,
    "videos_20_v3_1": 20,
    // legacy v1 ids (still grant if RC sends them)
    "videos_1_v1":  1,
    "videos_5_v1":  5,
    "videos_20_v1": 20
  };

  function readCons(nk: nkruntime.Nakama, userId: string): any {
    return Storage.readJson<any>(nk, COLLECTION, KEY_CONS, userId) || {};
  }

  function writeCons(nk: nkruntime.Nakama, userId: string, cons: any): void {
    cons.updatedAt = new Date().toISOString();
    Storage.writeJson(nk, COLLECTION, KEY_CONS, userId, cons);
  }

  function unitsForProductId(productId: string): number {
    if (!productId) return 0;
    if (PACK_UNITS[productId]) return PACK_UNITS[productId];
    if (productId.indexOf("videos_20") !== -1) return 20;
    if (productId.indexOf("videos_5") !== -1) return 5;
    if (productId.indexOf("videos_1") !== -1) return 1;
    return 0;
  }

  function normalizeProductId(raw: string): string {
    if (!raw) return "";
    if (PACK_UNITS[raw]) return raw;
    // Stripe price id → RC product id
    if (raw.indexOf("price_qv_videos_1_") === 0) return "videos_1_v3_1";
    if (raw.indexOf("price_qv_videos_5_") === 0) return "videos_5_v3_1";
    if (raw.indexOf("price_qv_videos_20_") === 0) return "videos_20_v3_1";
    return raw;
  }

  function buildStatus(cons: any): any {
    var balance = Number(cons.explainerVideoCredits) || 0;
    var freePreviewUsed = !!cons.explainerFreePreviewUsed;
    var mode = balance > 0 ? "full" : (!freePreviewUsed ? "preview" : "blocked");
    return {
      balance: balance,
      freePreviewUsed: freePreviewUsed,
      freePreviewSeconds: FREE_PREVIEW_SECONDS,
      mode: mode,
      canGenerate: mode !== "blocked"
    };
  }

  function rpcVideosStatus(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    _payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    try {
      var cons = readCons(nk, userId);
      return RpcHelpers.successResponse(buildStatus(cons));
    } catch (e: any) {
      logger.warn("[QvExplainerVideos] status error: " + (e && e.message ? e.message : String(e)));
      return RpcHelpers.errorResponse("Failed to read explainer video status");
    }
  }

  function rpcVideosConsume(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data: any;
    try { data = RpcHelpers.parseRpcPayload(payload); }
    catch (e: any) { return RpcHelpers.errorResponse(e.message || "bad payload"); }

    var mode = (data.mode || data.consume_mode || "full") as string;
    if (mode !== "preview" && mode !== "full") {
      return RpcHelpers.errorResponse("mode must be preview or full");
    }

    try {
      var cons = readCons(nk, userId);
      var balance = Number(cons.explainerVideoCredits) || 0;
      var freePreviewUsed = !!cons.explainerFreePreviewUsed;

      if (mode === "full") {
        if (balance <= 0) {
          return RpcHelpers.errorResponse("no explainer video credits", 7);
        }
        cons.explainerVideoCredits = balance - 1;
        writeCons(nk, userId, cons);
        logger.info("[QvExplainerVideos] consume full user=" + userId + " balance=" + cons.explainerVideoCredits);
        return RpcHelpers.successResponse({
          consumed: true,
          consumeMode: "full",
          balance: cons.explainerVideoCredits,
          freePreviewUsed: !!cons.explainerFreePreviewUsed
        });
      }

      // preview — one-time only
      if (freePreviewUsed) {
        return RpcHelpers.errorResponse("free preview already used", 7);
      }
      cons.explainerFreePreviewUsed = true;
      writeCons(nk, userId, cons);
      logger.info("[QvExplainerVideos] consume preview user=" + userId);
      return RpcHelpers.successResponse({
        consumed: true,
        consumeMode: "preview",
        balance: Number(cons.explainerVideoCredits) || 0,
        freePreviewUsed: true,
        previewMaxSeconds: FREE_PREVIEW_SECONDS
      });
    } catch (e: any) {
      logger.warn("[QvExplainerVideos] consume error: " + (e && e.message ? e.message : String(e)));
      return RpcHelpers.errorResponse("Failed to consume explainer video credit");
    }
  }

  function rpcVideosGrant(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data: any;
    try { data = RpcHelpers.parseRpcPayload(payload); }
    catch (e: any) { return RpcHelpers.errorResponse(e.message || "bad payload"); }

    var productId = normalizeProductId(String(data.product_id || data.productId || ""));
    var units = Number(data.quantity) || unitsForProductId(productId);
    if (units <= 0) {
      return RpcHelpers.errorResponse("unknown explainer video product: " + productId);
    }

    try {
      var cons = readCons(nk, userId);
      var prev = Number(cons.explainerVideoCredits) || 0;
      cons.explainerVideoCredits = prev + units;
      writeCons(nk, userId, cons);
      logger.info("[QvExplainerVideos] grant user=" + userId + " product=" + productId + " +" + units + " now=" + cons.explainerVideoCredits);
      return RpcHelpers.successResponse({
        granted: units,
        productId: productId,
        balance: cons.explainerVideoCredits
      });
    } catch (e: any) {
      logger.warn("[QvExplainerVideos] grant error: " + (e && e.message ? e.message : String(e)));
      return RpcHelpers.errorResponse("Failed to grant explainer video credits");
    }
  }

  /** Called from entitlements rc_sync / grantConsumable. */
  export function grantExplainerCredits(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    productId: string,
    quantity: number
  ): number {
    var units = quantity > 0 ? quantity : unitsForProductId(normalizeProductId(productId));
    if (units <= 0) return 0;
    var cons = readCons(nk, userId);
    var prev = Number(cons.explainerVideoCredits) || 0;
    cons.explainerVideoCredits = prev + units;
    writeCons(nk, userId, cons);
    logger.info("[QvExplainerVideos] grantExplainerCredits user=" + userId + " +" + units + " now=" + cons.explainerVideoCredits);
    return units;
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_videos_status", rpcVideosStatus);
    initializer.registerRpc("quizverse_videos_consume", rpcVideosConsume);
    initializer.registerRpc("quizverse_videos_grant", rpcVideosGrant);
  }
}
