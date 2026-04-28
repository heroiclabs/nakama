// Phase 7 (qv-insights-loop) — privacy + consent forwarder RPCs.
//
// The Nakama orchestrator + Privacy team tooling call these RPCs to:
//   - cascade-erase a user's footprint from the AI svc (GDPR Art.17 / CCPA)
//   - update the AI svc's consent gate cache (COPPA / GDPR / CCPA)
//   - invalidate the consent cache when a user changes settings
//
// Why route through Nakama?
//   1. Same shared-secret HMAC chain as every other AI svc call —
//      the AI svc has ONE trust anchor (IVX_INSIGHTS_SHARED_SECRET).
//   2. Nakama owns the upstream consent record and underage flag.
//   3. Audit trail lives in the Nakama session; AI svc only sees the
//      derived gate decision.
//
// Behaviour:
//   privacy_erase_user      → /privacy/erase
//   privacy_erase_discord   → /privacy/erase-discord
//   consent_upsert          → /consent/upsert  (called on every consent flip)
//   consent_invalidate      → /consent/invalidate (drops the cache key)
//
// All four are admin-only — the SDK never invokes these directly. They
// are called by:
//   - Nakama-internal account-deletion handler (bound to the user's
//     /v2/account DELETE webhook)
//   - the consent-set Nakama RPC fired from the SDK whenever a user
//     toggles a privacy / personalization / marketing / push setting
//   - the Privacy team's admin tool for manual erasures.

namespace QvPrivacy {

  interface EraseUserRequest {
    game_id?: string;
    user_id?: string;
    reason?: string;
  }

  interface EraseDiscordRequest {
    discord_user_id?: string;
    reason?: string;
  }

  interface ConsentUpsertRequest {
    game_id?: string;
    user_id?: string;
    underage?: boolean;
    region?: string;
    analytics_consent?: boolean;
    personalization_consent?: boolean;
    marketing_consent?: boolean;
    push_consent?: boolean;
    set_at?: string;
    source?: string;
  }

  interface ConsentInvalidateRequest {
    game_id?: string;
    user_id?: string;
  }

  function aiSvcBase(ctx: nkruntime.Context, logger: nkruntime.Logger): string | null {
    var base = (ctx.env && ctx.env["IVX_AI_SVC_BASE_URL"]) || "";
    if (!base) {
      logger.warn("[QvPrivacy] IVX_AI_SVC_BASE_URL unset");
      return null;
    }
    return base.replace(/\/$/, "");
  }

  function computeHmac(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    ts: string,
    path: string,
    body: string,
    logger: nkruntime.Logger,
  ): string {
    var secret = (ctx.env && ctx.env["IVX_INSIGHTS_SHARED_SECRET"]) || "";
    if (!secret) {
      logger.warn("[QvPrivacy] IVX_INSIGHTS_SHARED_SECRET unset");
      return "";
    }
    var msg = ts + ":" + path + ":" + body;
    try {
      var raw = nk.hmacSha256Hash(msg, secret);
      return nk.base16Encode(raw, false).toLowerCase();
    } catch (e: any) {
      logger.warn("[QvPrivacy] hmac compute failed: " + ((e && e.message) ? e.message : String(e)));
      return "";
    }
  }

  function postJson(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    path: string,
    body: string,
  ): string | null {
    var base = aiSvcBase(ctx, logger);
    if (!base) return null;
    var ts = String(Date.now());
    var sig = computeHmac(ctx, nk, ts, path, body, logger);
    try {
      var resp = nk.httpRequest(base + path, "post", {
        "Content-Type": "application/json",
        "X-IVX-Service": "nakama",
        "X-IVX-Timestamp": ts,
        "X-IVX-Signature": sig,
      }, body, 4500);
      if (!resp || resp.code < 200 || resp.code >= 300) {
        logger.warn("[QvPrivacy] post " + path + " HTTP " + (resp ? resp.code : "no_resp"));
        return null;
      }
      return resp.body || "";
    } catch (e: any) {
      logger.warn("[QvPrivacy] post " + path + " threw: " + ((e && e.message) ? e.message : String(e)));
      return null;
    }
  }

  function rpcEraseUser(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var data: EraseUserRequest;
    try { data = JSON.parse(payload || "{}"); }
    catch (e: any) { return JSON.stringify({ ok: false, error: "invalid_json" }); }
    if (!data.game_id || !data.user_id) {
      return JSON.stringify({ ok: false, error: "missing_required_fields" });
    }
    var body = JSON.stringify({
      gameId: data.game_id,
      userId: data.user_id,
      reason: data.reason || "user_request",
    });
    var resp = postJson(ctx, nk, logger, "/privacy/erase", body);
    if (resp == null) return JSON.stringify({ ok: false, error: "ai_svc_unavailable" });
    return resp;
  }

  function rpcEraseDiscord(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var data: EraseDiscordRequest;
    try { data = JSON.parse(payload || "{}"); }
    catch (e: any) { return JSON.stringify({ ok: false, error: "invalid_json" }); }
    if (!data.discord_user_id) {
      return JSON.stringify({ ok: false, error: "missing_required_fields" });
    }
    var body = JSON.stringify({
      discordUserId: data.discord_user_id,
      reason: data.reason || "user_request",
    });
    var resp = postJson(ctx, nk, logger, "/privacy/erase-discord", body);
    if (resp == null) return JSON.stringify({ ok: false, error: "ai_svc_unavailable" });
    return resp;
  }

  function rpcConsentUpsert(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var data: ConsentUpsertRequest;
    try { data = JSON.parse(payload || "{}"); }
    catch (e: any) { return JSON.stringify({ ok: false, error: "invalid_json" }); }
    if (!data.game_id || !data.user_id) {
      return JSON.stringify({ ok: false, error: "missing_required_fields" });
    }
    var body = JSON.stringify({
      gameId: data.game_id,
      userId: data.user_id,
      underage: !!data.underage,
      region: data.region || "OTHER",
      analyticsConsent: !!data.analytics_consent,
      personalizationConsent: !!data.personalization_consent,
      marketingConsent: !!data.marketing_consent,
      pushConsent: !!data.push_consent,
      setAt: data.set_at || new Date().toISOString(),
      source: data.source || "settings",
    });
    var resp = postJson(ctx, nk, logger, "/consent/upsert", body);
    if (resp == null) return JSON.stringify({ ok: false, error: "ai_svc_unavailable" });
    return resp;
  }

  function rpcConsentInvalidate(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var data: ConsentInvalidateRequest;
    try { data = JSON.parse(payload || "{}"); }
    catch (e: any) { return JSON.stringify({ ok: false, error: "invalid_json" }); }
    if (!data.game_id || !data.user_id) {
      return JSON.stringify({ ok: false, error: "missing_required_fields" });
    }
    var body = JSON.stringify({
      gameId: data.game_id,
      userId: data.user_id,
    });
    var resp = postJson(ctx, nk, logger, "/consent/invalidate", body);
    if (resp == null) return JSON.stringify({ ok: false, error: "ai_svc_unavailable" });
    return resp;
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("privacy_erase_user", rpcEraseUser);
    initializer.registerRpc("privacy_erase_discord", rpcEraseDiscord);
    initializer.registerRpc("consent_upsert", rpcConsentUpsert);
    initializer.registerRpc("consent_invalidate", rpcConsentInvalidate);
  }
}
