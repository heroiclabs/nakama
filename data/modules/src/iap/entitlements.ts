// ---------------------------------------------------------------------------
//  entitlements.ts  —  quizverse_get_entitlements + quizverse_rc_sync
//
//  Collection: qv_entitlements
//   key "subscriptions" : { tier, expiresAt?, productId, store }
//   key "consumables"   : { aiVoiceCredits, voiceSessionsUsed, boosterCredits }
//   key "one_time"      : { noAds, partyMode, microphone, inventorySlots,
//                           examPacks[], starterPackGrantCount }
//
//  RPCs exposed:
//   quizverse_get_entitlements  – client reads its own entitlement snapshot
//   quizverse_rc_sync           – RevenueCat S2S webhook → write entitlement
//                                 Works in two modes:
//                                   • Server mode (http_key, no session):
//                                       event.app_user_id MUST be present
//                                   • Client mode (user session):
//                                       ctx.userId used, event.app_user_id
//                                       validated if provided
// ---------------------------------------------------------------------------

namespace QvEntitlements {

  var COLLECTION = "qv_entitlements";
  var KEY_SUBS   = "subscriptions";
  var KEY_CONS   = "consumables";
  var KEY_ONE    = "one_time";

  // NAKAMA_WEBHOOK_SECRET is set in docker-compose.yml environment + RUNTIME_ENV_KEYS.
  // RevenueCat webhook Authorization header must match this value.
  // If the env var is unset, signature checking is SKIPPED (dev-only behaviour).
  var WEBHOOK_SECRET_ENV_KEY = "NAKAMA_WEBHOOK_SECRET";

  // Product ID → tier mapping (must mirror RevenueCatProjectSetup.cs in Unity)
  function tierForProductId(productId: string): string | null {
    if (!productId) return null;
    if (productId.indexOf("quizverse.proplus") !== -1) return "pro_plus";
    if (productId.indexOf("quizverse.pro")     !== -1) return "pro";
    if (productId.indexOf("linkplay.proplus")  !== -1) return "linkplay_proplus";
    if (productId.indexOf("linkplay.pro")      !== -1) return "linkplay_pro";
    if (productId.indexOf("voyage.yearly")     !== -1) return "voyage_yearly";
    if (productId.indexOf("voyage.monthly")    !== -1) return "voyage_monthly";
    if (productId.indexOf("voyage")            !== -1) return "voyage_monthly";
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
      var subs    = Storage.readJson<any>(nk, COLLECTION, KEY_SUBS, userId) || {};
      var cons    = Storage.readJson<any>(nk, COLLECTION, KEY_CONS, userId) || {};
      var oneTime = Storage.readJson<any>(nk, COLLECTION, KEY_ONE, userId) || {};

      // Server-side expiry enforcement: if the stored subscription has a non-null
      // expiresAt that is already in the past, clear it on the fly so the client
      // never reads a stale active subscription. The RC webhook should have fired
      // a CANCELLATION/EXPIRATION event, but this is a safety net.
      if (subs && subs.tier && subs.expiresAt) {
        var nowMs = Date.now();
        var expMs = new Date(subs.expiresAt).getTime();
        if (!isNaN(expMs) && expMs < nowMs) {
          logger.info("[QvEntitlements] expiry enforcement: clearing expired subscription tier=" + subs.tier +
                      " expiresAt=" + subs.expiresAt + " for user=" + userId);
          subs = { tier: null, status: "expired", productId: subs.productId, store: subs.store,
                   expiresAt: subs.expiresAt, updatedAt: new Date().toISOString() };
          Storage.writeJson(nk, COLLECTION, KEY_SUBS, userId, subs);
        }
      }

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
  //
  //  Dual-mode design:
  //    Server mode (RevenueCat webhook via http_key): ctx.userId is empty.
  //      event.app_user_id MUST be present and is used as the target user.
  //      Authorization header must match NAKAMA_WEBHOOK_SECRET env var (if set).
  //    Client mode (Unity SDK call with user session): ctx.userId is set.
  //      event.app_user_id is validated against ctx.userId if provided.

  function rpcRCSync(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var data  = RpcHelpers.parseRpcPayload(payload);
    var event = data.event || data;

    // ── Mode detection ──────────────────────────────────────────────────
    // ctx.userId is empty when called via http_key (server/webhook mode).
    var isServerMode = !ctx.userId;

    if (isServerMode) {
      // Webhook signature check: RevenueCat sends the Authorization header
      // set to whatever value you configured in the webhook dashboard.
      // Nakama passes HTTP headers to RPCs via ctx.env only for httpKey RPCs
      // when using registerRpc — we use the shared NAKAMA_WEBHOOK_SECRET
      // embedded in the URL query or validated by matching env var against
      // the Authorization field in the request body meta (RC sends it as
      // a top-level "authorization" key in newer webhook versions).
      var secret = ctx.env[WEBHOOK_SECRET_ENV_KEY] || "";
      if (secret) {
        // RevenueCat v2+ webhooks include an "authorization" field at the
        // top level of the JSON body (same value as the Authorization header
        // you configured in RevenueCat dashboard).
        var authField: string = data.authorization || data.Authorization || "";
        if (authField !== secret) {
          logger.warn("[QvEntitlements] rc_sync: webhook authorization mismatch — request rejected");
          return RpcHelpers.errorResponse("unauthorized");
        }
      }
      // In server mode, app_user_id from the event is the Nakama user ID
      if (!event.app_user_id) {
        logger.warn("[QvEntitlements] rc_sync: server-mode call missing app_user_id");
        return RpcHelpers.errorResponse("app_user_id required in server mode");
      }
    }

    var callerUserId: string = ctx.userId || "";
    var productId: string    = event.product_id || event.productId || "";
    var store: string        = event.store || "unknown";
    var eventType: string    = event.type || "GRANT";
    var targetUserId: string = event.app_user_id || callerUserId;

    // SECURITY (client mode): if app_user_id is provided, it MUST match the
    // authenticated user to prevent privilege escalation via forged payloads.
    if (!isServerMode && event.app_user_id && event.app_user_id !== callerUserId) {
      logger.warn("[QvEntitlements] rc_sync user mismatch: caller=" + callerUserId + " event=" + event.app_user_id);
      return RpcHelpers.errorResponse("user id mismatch");
    }

    if (!productId) {
      return RpcHelpers.errorResponse("productId required");
    }

    // ── Consumable path (AI Voice session credits) ───────────────────────
    // Triggered by web Stripe webhook (store = "web_stripe") or RC consumable
    // purchases.  productId pattern: *.aivoice.*  or  *.voice_pack.*
    var isAiVoice = productId.indexOf("aivoice") !== -1 || productId.indexOf("voice_pack") !== -1;
    if (isAiVoice) {
      var quantity: number = Number(event.quantity) || 0;
      if (quantity <= 0) {
        // Fallback: derive from productId suffix (e.g. "…aivoice.10")
        var parts = productId.split(".");
        var last  = Number(parts[parts.length - 1]);
        quantity  = isNaN(last) ? 0 : last;
      }
      if (quantity <= 0) {
        logger.warn("[QvEntitlements] rc_sync: aivoice grant with quantity=0, skipping. productId=" + productId);
        return RpcHelpers.successResponse({ ignored: true, reason: "aivoice quantity=0" });
      }
      try {
        var existing = Storage.readJson<any>(nk, COLLECTION, KEY_CONS, targetUserId) || {};
        var prev: number = Number(existing.aiVoiceCredits) || 0;
        existing.aiVoiceCredits = prev + quantity;
        existing.updatedAt = new Date().toISOString();
        Storage.writeJson(nk, COLLECTION, KEY_CONS, targetUserId, existing);
        logger.info("[QvEntitlements] rc_sync: aiVoiceCredits+" + quantity + " for user=" + targetUserId + " (prev=" + prev + " now=" + existing.aiVoiceCredits + ")");
        return RpcHelpers.successResponse({ aiVoiceCredits: existing.aiVoiceCredits, granted: quantity });
      } catch (e: any) {
        logger.error("[QvEntitlements] rc_sync aivoice write error: " + (e && e.message ? e.message : String(e)));
        return RpcHelpers.errorResponse("Failed to write consumable entitlement");
      }
    }

    // ── Subscription path ────────────────────────────────────────────────
    var tier = tierForProductId(productId);
    if (!tier) {
      // Not a subscription — handle consumables / one-time products when RC sends
      // a GRANT or TEMPORARY_ENTITLEMENT_GRANT event (promotional grants, support
      // restorations, etc.). Regular purchases always come through hiro_iap_validate;
      // this path is a safety net for RC-initiated grants only.
      var isRcGrant = eventType === "GRANT" || eventType === "TEMPORARY_ENTITLEMENT_GRANT";
      if (isRcGrant && productId) {
        try {
          var isConsumableRc = productId.indexOf("aivoice") !== -1 ||
                               productId.indexOf("boosterpack") !== -1 ||
                               productId.indexOf("starterpack") !== -1;
          if (isConsumableRc) {
            var qty = productId.indexOf(".50") !== -1 ? 50
                    : productId.indexOf(".10") !== -1 ? 10 : 1;
            QvEntitlements.grantConsumable(nk, logger, targetUserId, productId, qty);
            logger.info("[QvEntitlements] rc_sync: RC GRANT consumable productId=" + productId + " qty=" + qty + " user=" + targetUserId);
          } else {
            QvEntitlements.grantOneTime(nk, logger, targetUserId, productId);
            logger.info("[QvEntitlements] rc_sync: RC GRANT one-time productId=" + productId + " user=" + targetUserId);
          }
          return RpcHelpers.successResponse({ granted: true, productId: productId, event: eventType });
        } catch (e: any) {
          logger.warn("[QvEntitlements] rc_sync: non-subscription grant error: " + (e && e.message ? e.message : String(e)));
        }
      }
      logger.info("[QvEntitlements] rc_sync: no tier for productId=" + productId + " (consumable or unknown). Ignoring.");
      return RpcHelpers.successResponse({ ignored: true, reason: "not a subscription product" });
    }

    try {
      // Handle lifecycle events that should revoke access
      var isRevoked = eventType === "CANCELLATION" || eventType === "EXPIRATION";
      // BILLING_ISSUE does NOT revoke — user keeps access during grace period
      var isActive  = eventType === "INITIAL_PURCHASE" ||
                      eventType === "RENEWAL"           ||
                      eventType === "UNCANCELLATION"    ||
                      eventType === "PRODUCT_CHANGE"    ||
                      eventType === "GRANT"             ||
                      eventType === "TEMPORARY_ENTITLEMENT_GRANT";

      if (isRevoked) {
        Storage.writeJson(nk, COLLECTION, KEY_SUBS, targetUserId, {
          tier:      null,
          status:    "cancelled",
          productId: productId,
          store:     store,
          updatedAt: new Date().toISOString()
        });
        logger.info("[QvEntitlements] rc_sync: subscription revoked for user=" + targetUserId + " tier=" + tier + " event=" + eventType);
        return RpcHelpers.successResponse({ tier: tier, status: "cancelled", event: eventType });
      }

      if (!isActive) {
        logger.info("[QvEntitlements] rc_sync: ignoring event=" + eventType + " for user=" + targetUserId);
        return RpcHelpers.successResponse({ ignored: true, reason: "non-actionable event: " + eventType });
      }

      var expiresAt = resolveExpiry(event);
      // Play 2 — opt-out trial. Stripe (or RC) flags a trial via period_type /
      // an explicit trial bool. A trialing subscription still UNLOCKS (non-null
      // tier) but is tagged "trialing" so analytics + the parent recap can tell
      // a converting trial from a paid subscriber.
      var isTrial = !!(event && (event.period_type === "trial" || event.period_type === "TRIAL" ||
                                 event.trial === true || event.is_trial === true));
      var subRecord = {
        tier:      tier,
        status:    isTrial ? "trialing" : "active",
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

      logger.info("[QvEntitlements] rc_sync: subscription " + (isTrial ? "trial-granted" : "granted") + " for user=" + targetUserId + " tier=" + tier + " expiresAt=" + (expiresAt || "lifetime"));
      return RpcHelpers.successResponse({ tier: tier, status: isTrial ? "trialing" : "active", expiresAt: expiresAt });

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
  //  Grants AI voice credits, booster credits, etc.
  //
  //  Product routing (by productId substring):
  //    aivoice            → aiVoiceCredits += quantity
  //    boosterpack        → boosterCredits += quantity (each pack = 1 credit)
  //    starterpack.v2     → grants are handled in Unity IAP (coins via Nakama
  //                         wallet RPC, Pro trial locally). No server-side
  //                         consumable record needed beyond journaling in wallet.
  //                         Flagged here as starterPackGranted=true for audit.

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
      } else if (productId.indexOf("boosterpack") !== -1) {
        existing.boosterCredits = (existing.boosterCredits || 0) + quantity;
      } else if (productId.indexOf("starterpack") !== -1) {
        // Coins and Pro trial are wallet-journaled in Unity IAP; mark as granted
        // here for server-side audit / duplicate prevention.
        existing.starterPackGrantCount = (existing.starterPackGrantCount || 0) + 1;
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
