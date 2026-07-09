// ---------------------------------------------------------------------------
//  entitlements.ts  —  quizverse_get_entitlements + quizverse_rc_sync
//
//  Collection: qv_entitlements
//   key "subscriptions" : { tier, expiresAt?, productId, store }
//   key "consumables"   : { aiVoiceCredits, explainerVideoCredits, explainerFreePreviewUsed, voiceSessionsUsed, boosterCredits }
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

// Provided by analytics.js (plain-JS module, merged into the global Goja
// scope by postbuild.js). Feeds the same durable, dashboard-safe pipeline
// every other event uses: writes a raw `dash_*` doc into `analytics_events`
// (read by the nightly analytics_rollup cron) AND updates today's
// `analytics_live_daily` counters (read by the live dashboard / analytics.html).
// `declare` is compile-time only — no code is emitted for it.
declare function persistNormalizedEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, ev: any): void;

namespace QvEntitlements {

  var COLLECTION = "qv_entitlements";
  var KEY_SUBS   = "subscriptions";
  var KEY_CONS   = "consumables";
  var KEY_ONE    = "one_time";

  // Dedup ledger for RevenueCat webhook revenue recording — RC explicitly
  // documents that webhook retries reuse the same `event.id` + timestamp
  // (https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields).
  // Without this guard, a retried webhook (e.g. after a slow/aborted response)
  // would double-count the same purchase in analytics_live_daily.revenue_usd.
  var RC_REVENUE_LEDGER_COLLECTION = "qv_rc_revenue_ledger";

  // NAKAMA_WEBHOOK_SECRET is set in docker-compose.yml environment + RUNTIME_ENV_KEYS.
  // RevenueCat webhook Authorization header must match this value.
  // If the env var is unset, signature checking is SKIPPED (dev-only behaviour).
  var WEBHOOK_SECRET_ENV_KEY = "NAKAMA_WEBHOOK_SECRET";

  // Product ID → tier mapping (must mirror RevenueCatProjectSetup.cs in Unity).
  // Works for App Store / Play Store product IDs, which are always
  // descriptive strings like "com.intelliverse.quizverse.pro.monthly".
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

  // RC entitlement lookup_key → internal tier mapping (RC Dashboard →
  // Entitlements → "identifier"). Web/Stripe products use opaque RevenueCat
  // product IDs (e.g. "prod_Ukdueh6ejXhPHb") that tierForProductId can never
  // match by substring, but every RC event — regardless of store — carries
  // entitlement_ids for whatever entitlement(s) the product grants. This is
  // the store-agnostic fallback so Stripe/web subscribers get the exact same
  // tier resolution as App Store/Play Store subscribers.
  function tierForEntitlementIds(entitlementIds: any): string | null {
    if (!entitlementIds || !entitlementIds.length) return null;
    for (var i = 0; i < entitlementIds.length; i++) {
      var id = String(entitlementIds[i] || "").toLowerCase();
      if (id === "pro_plus")         return "pro_plus";
      if (id === "pro")              return "pro";
      if (id === "linkplay_proplus") return "linkplay_proplus";
      if (id === "linkplay_pro")     return "linkplay_pro";
      if (id === "plus")             return "plus";
    }
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

  // ── RevenueCat revenue recording (Gap 1 fix) ────────────────────────────
  //
  //  RevenueCat is the single source of truth for IAP revenue — reconciled,
  //  sandbox-free. This writes the transaction's USD amount into the SAME
  //  live-dashboard + nightly-rollup pipeline every other event uses, so
  //  admin dashboard / analytics.html always match RevenueCat's own totals.
  //  Client-side `iap_purchased` events are no longer the source of truth
  //  (they remain informational only going forward).
  //
  //  Runs once per rc_sync call, BEFORE any entitlement-granting branch, so
  //  revenue is recorded uniformly regardless of whether the productId maps
  //  to a subscription tier, a consumable, or is unrecognized.
  function recordRcRevenueLive(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    targetUserId: string,
    event: any,
    eventType: string,
    productId: string,
    store: string
  ): void {
    try {
      // RC docs: `price` is the USD price of the transaction. Can be null/
      // unknown, 0 for free trials, or negative for refunds. We only record
      // strictly-positive, finite amounts — this mirrors the platform-wide
      // convention in analyticsExtractIapRevenueUsd/arExtractIapRevenueUsd
      // (both enforce rev > 0), so today's live number and tonight's rollup
      // number always agree. Refund/chargeback netting is a separate,
      // larger feature and is intentionally out of scope here.
      var priceUsd = Number(event && event.price);
      if (!isFinite(priceUsd) || priceUsd <= 0) return;

      // Sandbox purchases must never inflate the reconciled dashboard total.
      var env = String((event && event.environment) || "").toUpperCase();
      if (env === "SANDBOX") {
        logger.info("[QvEntitlements] rc_sync: skipping revenue for sandbox event id=" + (event && event.id));
        return;
      }

      if (!targetUserId) return;

      // Idempotency: RevenueCat retries webhooks reusing the same event.id.
      // Create-only write (version:"*") — if this id was already claimed,
      // storageWrite throws and we skip recording (already counted).
      var eventId = (event && event.id) || null;
      if (eventId) {
        try {
          nk.storageWrite([{
            collection: RC_REVENUE_LEDGER_COLLECTION,
            key: String(eventId),
            userId: Constants.SYSTEM_USER_ID,
            value: { eventId: eventId, userId: targetUserId, productId: productId, priceUsd: priceUsd, recordedAt: new Date().toISOString() },
            permissionRead: 0,
            permissionWrite: 0,
            version: "*"
          }]);
        } catch (dupErr: any) {
          logger.info("[QvEntitlements] rc_sync: duplicate RC event id=" + eventId + " — revenue already recorded, skipping");
          return;
        }
      } else {
        // No event.id (e.g. an older RC payload shape) — proceed without
        // dedup rather than silently dropping real revenue. Logged so it's
        // visible if this ever happens in production.
        logger.warn("[QvEntitlements] rc_sync: revenue event missing event.id, dedup skipped. productId=" + productId);
      }

      var gameId = (ctx.env && ctx.env["DEFAULT_GAME_ID"]) || "126bf539-dae2-4bcf-964d-316c0fa1f92b"; // QuizVerse prod UUID
      var nowSec = Math.floor(Date.now() / 1000);

      var ev = {
        userId:             targetUserId,
        gameId:             gameId,
        eventName:          "iap_purchased",
        originalEventName:  "iap_purchased",
        canonicalized:      false,
        eventData: {
          revenue_usd:   priceUsd,
          is_sandbox:    false,
          store:         store || (event && event.store) || "unknown",
          product_id:    productId,
          source:        "revenuecat_webhook",
          rc_event_type: eventType,
          rc_event_id:   eventId
        },
        platform:    null,
        sessionId:   null,
        timestamp:   new Date(nowSec * 1000).toISOString(),
        unixTimestamp: nowSec,
        schemaVersion: 1,
        clientEventId: eventId,
        eventTime:     null,
        quizSessionId: null,
        screenId:      null,
        privacyTier:   1,
        v2Warnings:    []
      };

      persistNormalizedEvent(nk, logger, ev);
      logger.info("[QvEntitlements] rc_sync: recorded $" + priceUsd.toFixed(2) + " revenue for user=" + targetUserId + " productId=" + productId + " event=" + eventType);
    } catch (e: any) {
      // Revenue recording must NEVER block entitlement granting.
      logger.warn("[QvEntitlements] rc_sync: recordRcRevenueLive failed (non-fatal): " + (e && e.message ? e.message : String(e)));
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

    // ── Gap 1 fix: record RevenueCat revenue BEFORE entitlement branching.
    // Runs for every recognized RC event regardless of subscription/consumable/
    // unknown productId routing below, so IAP revenue is never silently
    // dropped for products this RPC doesn't grant a tier for. Never throws
    // and never blocks entitlement granting (see try/catch inside).
    recordRcRevenueLive(ctx, logger, nk, targetUserId, event, eventType, productId, store);

    // ── Consumable path (AI Voice session credits) ───────────────────────
    // Triggered by web Stripe webhook (store = "web_stripe") or RC consumable
    // purchases.  productId pattern: *.aivoice.*  or  *.voice_pack.*
    var isExplainerVideo = productId.indexOf("videos_") !== -1 ||
                           productId.indexOf("price_qv_videos_") !== -1;
    if (isExplainerVideo) {
      var evQty: number = Number(event.quantity) || 0;
      if (evQty <= 0) {
        if (productId.indexOf("videos_20") !== -1 || productId.indexOf("price_qv_videos_20_") !== -1) evQty = 20;
        else if (productId.indexOf("videos_5") !== -1 || productId.indexOf("price_qv_videos_5_") !== -1) evQty = 5;
        else evQty = 1;
      }
      try {
        var granted = QvExplainerVideos.grantExplainerCredits(nk, logger, targetUserId, productId, evQty);
        return RpcHelpers.successResponse({ explainerVideoCredits: granted, granted: evQty, productId: productId });
      } catch (e: any) {
        logger.error("[QvEntitlements] rc_sync explainer write error: " + (e && e.message ? e.message : String(e)));
        return RpcHelpers.errorResponse("Failed to write explainer video entitlement");
      }
    }

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
    // Try the descriptive productId first (App Store / Play Store), then
    // fall back to RC's store-agnostic entitlement_ids (required for Stripe/
    // web, whose product IDs are opaque RC-generated strings).
    var tier = tierForProductId(productId) || tierForEntitlementIds(event.entitlement_ids);
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
                               productId.indexOf("starterpack") !== -1 ||
                               productId.indexOf("videos_") !== -1;
          if (isConsumableRc) {
            var qty = productId.indexOf("videos_20") !== -1 ? 20
                    : productId.indexOf("videos_5") !== -1 ? 5
                    : productId.indexOf(".50") !== -1 ? 50
                    : productId.indexOf(".10") !== -1 ? 10 : 1;
            if (productId.indexOf("videos_") !== -1) {
              QvExplainerVideos.grantExplainerCredits(nk, logger, targetUserId, productId, qty);
            } else {
              QvEntitlements.grantConsumable(nk, logger, targetUserId, productId, qty);
            }
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
      // Handle lifecycle events that should revoke access IMMEDIATELY.
      // Per RevenueCat's documented semantics (Trial/Renewal flows doc): CANCELLATION
      // only means "auto-renew turned off" — the user KEEPS access for the remainder
      // of the CURRENT paid/trial period. Only EXPIRATION (the period actually ending)
      // should revoke access. Treating CANCELLATION as an immediate revoke was cutting
      // off Pro/Pro+ trial users the moment they tapped "cancel" mid-trial, even though
      // RC/Apple/Google explicitly keep them entitled until expiresAt.
      var isImmediateRevoke = eventType === "EXPIRATION";
      // BILLING_ISSUE does NOT revoke — user keeps access during grace period
      var isActive  = eventType === "INITIAL_PURCHASE" ||
                      eventType === "RENEWAL"           ||
                      eventType === "UNCANCELLATION"    ||
                      eventType === "PRODUCT_CHANGE"    ||
                      eventType === "GRANT"             ||
                      eventType === "TEMPORARY_ENTITLEMENT_GRANT";
      var isCancellationNotice = eventType === "CANCELLATION";

      if (isImmediateRevoke) {
        Storage.writeJson(nk, COLLECTION, KEY_SUBS, targetUserId, {
          tier:      null,
          status:    "expired",
          productId: productId,
          store:     store,
          updatedAt: new Date().toISOString()
        });
        logger.info("[QvEntitlements] rc_sync: subscription revoked for user=" + targetUserId + " tier=" + tier + " event=" + eventType);
        return RpcHelpers.successResponse({ tier: tier, status: "expired", event: eventType });
      }

      if (isCancellationNotice) {
        // RC always includes expiration_at_ms on CANCELLATION — use it so the client
        // (and the expiry-enforcement safety net in rpcGetEntitlements) correctly cut
        // access at the real period end instead of right now.
        var cancelExpiresAt = resolveExpiry(event);
        Storage.writeJson(nk, COLLECTION, KEY_SUBS, targetUserId, {
          tier:      tier,
          status:    "cancelled",
          productId: productId,
          store:     store,
          expiresAt: cancelExpiresAt,
          updatedAt: new Date().toISOString()
        });
        logger.info("[QvEntitlements] rc_sync: cancellation noted (access continues until expiry) for user=" + targetUserId + " tier=" + tier + " expiresAt=" + (cancelExpiresAt || "lifetime"));
        return RpcHelpers.successResponse({ tier: tier, status: "cancelled", expiresAt: cancelExpiresAt, event: eventType });
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
      } else if (productId.indexOf("videos_") !== -1) {
        existing.explainerVideoCredits = (existing.explainerVideoCredits || 0) + quantity;
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
