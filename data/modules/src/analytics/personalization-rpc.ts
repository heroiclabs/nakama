// Phase 4B (qv-insights-loop) — personalization_get + personalization_get_for_mode RPCs.
//
// SDK -> Nakama -> AI svc /personalization/*. The SDK never holds the
// HMAC shared secret; Nakama signs every forward and stamps the
// authenticated user id as the source of truth.
//
// Behaviour:
//   personalization_get          — returns the full per-user bundle:
//                                  smartNudge, todayFeed, pushSchedule,
//                                  per-mode addenda, plus a "stale" flag
//                                  the SDK can use to decide whether to
//                                  fall back to a baked default.
//   personalization_get_for_mode — returns ONLY the addendum for one
//                                  mode (ai_host / voice / fortune /
//                                  tutor / chat / classic). Cheaper to
//                                  fetch frequently from a per-mode
//                                  controller hot path.
//
// Cache strategy (server-side):
//   - The AI svc owns the 6h Redis cache. Nakama is fire-and-forget;
//     we don't double-cache here.
//   - On AI svc failure (HTTP non-2xx, network), we return a soft
//     "stale: true, addendum: null" envelope so the SDK code path can
//     gracefully no-op without a try/catch chain.

namespace QvPersonalization {

  var ALLOWED_MODES: string[] = [
    "ai_host",
    "voice",
    "fortune",
    "tutor",
    "chat",
    "classic",
  ];

  function aiSvcBase(ctx: nkruntime.Context, logger: nkruntime.Logger): string | null {
    var base = (ctx.env && ctx.env["IVX_AI_SVC_BASE_URL"]) || "";
    if (!base) {
      logger.warn("[QvPersonalization] IVX_AI_SVC_BASE_URL unset");
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
      logger.warn("[QvPersonalization] IVX_INSIGHTS_SHARED_SECRET unset");
      return "";
    }
    var msg = ts + ":" + path + ":" + body;
    try {
      var raw = nk.hmacSha256Hash(msg, secret);
      return nk.base16Encode(raw, false).toLowerCase();
    } catch (e: any) {
      logger.warn("[QvPersonalization] hmac failed: " + ((e && e.message) ? e.message : String(e)));
      return "";
    }
  }

  function getJson(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    path: string,
  ): { code: number; body: string } | null {
    var base = aiSvcBase(ctx, logger);
    if (!base) return null;
    var ts = String(Date.now());
    // For GET, body is empty string (HmacAuthGuard signs `ts:path:`).
    var sig = computeHmac(ctx, nk, ts, path, "", logger);
    try {
      var resp = nk.httpRequest(base + path, "get", {
        "Accept": "application/json",
        "X-IVX-Service": "nakama",
        "X-IVX-Timestamp": ts,
        "X-IVX-Signature": sig,
      }, "", 4500);
      if (!resp) return null;
      return { code: resp.code, body: resp.body || "" };
    } catch (e: any) {
      logger.warn("[QvPersonalization] get " + path + " threw: " + ((e && e.message) ? e.message : String(e)));
      return null;
    }
  }

  function rpcGet(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var data: { game_id?: string };
    try {
      data = JSON.parse(payload || "{}");
    } catch (e: any) {
      return JSON.stringify({ stale: true, error: "invalid_json" });
    }
    if (!data.game_id) {
      return JSON.stringify({ stale: true, error: "missing_game_id" });
    }
    var userId = ctx.userId || "";
    if (!userId) {
      return JSON.stringify({ stale: true, error: "no_user" });
    }
    var qs = "?game_id=" + encodeURIComponent(data.game_id) +
             "&user_id=" + encodeURIComponent(userId);
    var resp = getJson(ctx, nk, logger, "/personalization/get" + qs);
    if (!resp || resp.code < 200 || resp.code >= 300) {
      return JSON.stringify({ stale: true });
    }
    // Pass-through; the SDK handles the bundle shape directly.
    return resp.body;
  }

  function rpcGetForMode(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var data: { game_id?: string; mode?: string };
    try {
      data = JSON.parse(payload || "{}");
    } catch (e: any) {
      return JSON.stringify({ stale: true, error: "invalid_json" });
    }
    if (!data.game_id || !data.mode) {
      return JSON.stringify({ stale: true, error: "missing_required_fields" });
    }
    var mode = data.mode;
    var allowed = false;
    for (var i = 0; i < ALLOWED_MODES.length; i++) {
      if (ALLOWED_MODES[i] === mode) { allowed = true; break; }
    }
    if (!allowed) mode = "classic";
    var userId = ctx.userId || "";
    if (!userId) {
      return JSON.stringify({ stale: true, error: "no_user" });
    }
    var qs = "?game_id=" + encodeURIComponent(data.game_id) +
             "&user_id=" + encodeURIComponent(userId);
    var resp = getJson(ctx, nk, logger,
      "/personalization/get-for-mode/" + encodeURIComponent(mode) + qs);
    if (!resp || resp.code < 200 || resp.code >= 300) {
      return JSON.stringify({ stale: true, mode: mode, addendum: null });
    }
    return resp.body;
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("personalization_get", rpcGet);
    initializer.registerRpc("personalization_get_for_mode", rpcGetForMode);
  }
}
