// ---------------------------------------------------------------------------
//  entitlements.ts  —  quizverse_get_entitlements + quizverse_rc_sync
//
//  Collection: qv_entitlements
//   key "subscriptions" : { tier, expiresAt?, productId, store }
//   key "consumables"   : { aiVoiceCredits, voiceSessionsUsed }
//   key "one_time"      : { noAds, partyMode, microphone, inventorySlots,
//                           examPacks[] }
//
//  RPCs exposed:
//   quizverse_get_entitlements  – client reads its own entitlement snapshot
//   quizverse_rc_sync           – RevenueCat S2S webhook → write entitlement
// ---------------------------------------------------------------------------

namespace QvEntitlements {

  var COLLECTION = "qv_entitlements";
  var KEY_SUBS   = "subscriptions";
  var KEY_CONS   = "consumables";
  var KEY_ONE    = "one_time";

  // Product ID → tier mapping (must mirror RevenueCatProjectSetup.cs in Unity)
  function tierForProductId(productId: string): string | null {
    if (!productId) return null;
    if (productId.indexOf("quizverse.proplus") !== -1) return "pro_plus";
    if (productId.indexOf("quizverse.pro")     !== -1) return "pro";
    if (productId.indexOf("linkplay.proplus")  !== -1) return "linkplay_proplus";
    if (productId.indexOf("linkplay.pro")      !== -1) return "linkplay_pro";
    if (productId === "com.intelliverse.quizverse.aifortune") return "pro"; // legacy
    return null;
  }

  // Resolve subscription expiry from RC event data (ISO-8601 or null for lifetime)
  function resolveExpiry(data: any): string | null {
    // RC webhook events: data.event_timestamp_ms + data.period_type
    // For "lifetime" products, there is no expiry.
    if (data && data.expiration_at_ms) {
      var d = new Date(data.expiration_at_ms);
      return d.toISOString();
    }
    if (data && data.expires_date) {
      return data.expires_date;
    }
    return null; // lifetime
  }

  // ── quizverse_get_entitlements ──────────────────────────────────────────

  function rpcGetEntitlements(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);

    try {
      var subs   = Storage.readJson<any>(nk, COLLECTION, KEY_SUBS, userId) || {};
      var cons   = Storage.readJson<any>(nk, COLLECTION, KEY_CONS, userId) || {};
      var oneTime = Storage.readJson<any>(nk, COLLECTION, KEY_ONE, userId) || {};

      return RpcHelpers.successResponse({
        subscriptions: subs,
        consumables:   cons,
        one_time:      oneTime
      });
    } catch (e: any) {
      logger.warn("[QvEntitlements] get error: " + (e && e.message ? e.message : String(e)));
      return RpcHelpers.errorResponse("Failed to read entitlements");
    }
  }

  // ── quizverse_rc_sync ───────────────────────────────────────────────────
  //
  //  Called by the RevenueCat S2S webhook (POST) or manually from the
  //  Unity client after a purchase is confirmed. Payload matches the
  //  RevenueCat webhook v3 event envelope shape (subset we need):
  //    {
  //      "api_version": "1.0",
  //      "event": {
  //        "type":            "INITIAL_PURCHASE" | "RENEWAL" | "CANCELLATION" | ...,
  //        "app_user_id":     "<nakama user id>",
  //        "product_id":      "com.intelliverse.quizverse.pro.monthly",
  //        "store":           "APP_STORE" | "PLAY_STORE",
  //        "expiration_at_ms": 1735689600000,   // null for lifetime
  //        "expires_date":    "2025-12-31T23:59:59Z"  // ISO, optional
  //      }
  //    }
  //
  //  Unity client sends a simplified shape:
  //    {
  //      "productId": "...",
  //      "store":     "apple" | "google",
  //      "transactionId": "..."
  //    }
  //  In this case ctx.userId is the Nakama user, so app_user_id is optional.

  function rpcRCSync(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data   = RpcHelpers.parseRpcPayload(payload);

    // Unwrap RC webhook envelope if present
    var event = data.event || data;
    var productId: string = event.product_id || event.productId || "";
    var store: string     = event.store || "unknown";
    var eventType: string = event.type || "GRANT";
    var targetUserId: string = event.app_user_id || userId;

    // SECURITY: if app_user_id is provided, it MUST match the calling user's
    // Nakama ID (the identity glue layer). Reject mismatches to prevent
    // privilege escalation via forged webhook payloads.
    if (event.app_user_id && event.app_user_id !== userId) {
      logger.warn("[QvEntitlements] rc_sync user mismatch: caller=" + userId + " event=" + event.app_user_id);
      return RpcHelpers.errorResponse("user id mismatch");
    }

    if (!productId) {
      return RpcHelpers.errorResponse("productId required");
    }

    var tier = tierForProductId(productId);
    if (!tier) {
      logger.info("[QvEntitlements] rc_sync: no tier for productId=" + productId + " (consumable or unknown). Ignoring.");
      return RpcHelpers.successResponse({ ignored: true, reason: "not a subscription product" });
    }

    try {
      var isCancelled = eventType === "CANCELLATION" || eventType === "EXPIRATION";

      if (isCancelled) {
        // Remove the subscription record
        Storage.writeJson(nk, COLLECTION, KEY_SUBS, targetUserId, {
          tier:      null,
          status:    "cancelled",
          productId: productId,
          store:     store,
          updatedAt: new Date().toISOString()
        });
        logger.info("[QvEntitlements] rc_sync: subscription cancelled for user=" + targetUserId + " tier=" + tier);
        return RpcHelpers.successResponse({ tier: tier, status: "cancelled" });
      }

      var expiresAt = resolveExpiry(event);
      var subRecord = {
        tier:      tier,
        status:    "active",
        productId: productId,
        store:     store,
        expiresAt: expiresAt,
        updatedAt: new Date().toISOString()
      };

      Storage.writeJson(nk, COLLECTION, KEY_SUBS, targetUserId, subRecord);

      // For Pro+ tier, also grant Link & Play Pro+ automatically (per sign-off doc §3)
      if (tier === "pro_plus") {
        var existing = Storage.readJson<any>(nk, COLLECTION, KEY_ONE, targetUserId) || {};
        existing.linkplayProPlus = true;
        Storage.writeJson(nk, COLLECTION, KEY_ONE, targetUserId, existing);
      }

      logger.info("[QvEntitlements] rc_sync: subscription granted for user=" + targetUserId + " tier=" + tier + " expiresAt=" + (expiresAt || "lifetime"));
      return RpcHelpers.successResponse({ tier: tier, status: "active", expiresAt: expiresAt });

    } catch (e: any) {
      logger.error("[QvEntitlements] rc_sync write error: " + (e && e.message ? e.message : String(e)));
      return RpcHelpers.errorResponse("Failed to write entitlement");
    }
  }

  // ── grantSubscription ───────────────────────────────────────────────────
  //  Internal helper — called from hiro_iap_validate after a subscription
  //  receipt is confirmed valid. Writes to qv_entitlements.subscriptions.

  export function grantSubscription(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    productId: string,
    store: string,
    expiresAt: string | null
  ): void {
    var tier = tierForProductId(productId);
    if (!tier) {
      logger.warn("[QvEntitlements] grantSubscription: no tier for productId=" + productId);
      return;
    }
    var subRecord = {
      tier:      tier,
      status:    "active",
      productId: productId,
      store:     store,
      expiresAt: expiresAt,
      updatedAt: new Date().toISOString()
    };
    Storage.writeJson(nk, COLLECTION, KEY_SUBS, userId, subRecord);

    // Pro+ also includes L&P Pro+
    if (tier === "pro_plus") {
      var existing = Storage.readJson<any>(nk, COLLECTION, KEY_ONE, userId) || {};
      existing.linkplayProPlus = true;
      Storage.writeJson(nk, COLLECTION, KEY_ONE, userId, existing);
    }
    logger.info("[QvEntitlements] grantSubscription: user=" + userId + " tier=" + tier + " expiresAt=" + (expiresAt || "lifetime"));
  }

  // ── quizverse_grant_consumable ──────────────────────────────────────────
  //  Internal helper — called from hiro_iap_validate after consumable purchase.
  //  Grants AI voice credits or inventory slots.

  export function grantConsumable(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    productId: string,
    quantity: number
  ): void {
    try {
      var existing = Storage.readJson<any>(nk, COLLECTION, KEY_CONS, userId) || {};
      if (productId.indexOf("aivoice") !== -1) {
        existing.aiVoiceCredits = (existing.aiVoiceCredits || 0) + quantity;
      }
      Storage.writeJson(nk, COLLECTION, KEY_CONS, userId, existing);
    } catch (e: any) {
      logger.warn("[QvEntitlements] grantConsumable error: " + (e && e.message ? e.message : String(e)));
    }
  }

  // ── quizverse_grant_one_time ────────────────────────────────────────────
  //  Internal helper — called from hiro_iap_validate after one-time purchase
  //  (NoAds, PartyMode, Microphone, Exam packs, Inventory slots).

  export function grantOneTime(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    productId: string
  ): void {
    try {
      var existing = Storage.readJson<any>(nk, COLLECTION, KEY_ONE, userId) || {};
      if (productId.indexOf("noads") !== -1)       existing.noAds = true;
      if (productId.indexOf("partymode") !== -1)   existing.partyMode = true;
      if (productId.indexOf("microphone") !== -1)  existing.microphone = true;
      if (productId.indexOf("slots") !== -1) {
        var add = productId.indexOf(".50") !== -1 ? 50
                : productId.indexOf(".200") !== -1 ? 200 : 0;
        if (add > 0) existing.inventorySlots = (existing.inventorySlots || 0) + add;
        if (productId.indexOf("unlimited") !== -1) existing.inventorySlotsUnlimited = true;
      }
      if (productId.indexOf("exampack") !== -1) {
        if (!existing.examPacks) existing.examPacks = [];
        var examCode = productId.replace("com.intelliverse.quizverse.exampack.", "");
        if (existing.examPacks.indexOf(examCode) === -1) existing.examPacks.push(examCode);
      }
      Storage.writeJson(nk, COLLECTION, KEY_ONE, userId, existing);
    } catch (e: any) {
      logger.warn("[QvEntitlements] grantOneTime error: " + (e && e.message ? e.message : String(e)));
    }
  }

  // ── Register ─────────────────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    // IMPORTANT: literal strings required — Nakama Goja AST walker can NOT
    // resolve namespaced constants at registration time.
    initializer.registerRpc("quizverse_get_entitlements", rpcGetEntitlements);
    initializer.registerRpc("quizverse_rc_sync", rpcRCSync);
  }
}
