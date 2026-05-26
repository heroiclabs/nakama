// ai_pipelines.ts
// ─────────────────────────────────────────────────────────────────────────────
// Nakama-side proxy RPCs for the AI service's content-factory endpoints.
//
// Architecture
// ────────────
//   Unity SDK ── Nakama RPC ── HTTP (HMAC) ── AI svc ── content-factory
//
// Why proxy through Nakama (vs. Unity → AI svc direct)?
//   • Single auth surface for Unity (Nakama session token only).
//   • Server-side rate limiting per `ctx.userId` — the SDK can't spoof.
//   • `cognitoSub` is stamped from the authenticated session — never
//     trusted from client payload, which means identity-proofing is
//     identical to all other Nakama-proxied AI calls
//     (personalization-rpc, cross-sell-rpc, etc.).
//   • Lets us add Nakama-side caching / coalescing later without
//     touching Unity.
//
// RPCs registered (4)
// -------------------
//   ai_pipeline_weekly_recap        — kick off a 7-day personalized recap
//   ai_pipeline_monthly_recap       — kick off a 30-day personalized recap
//   ai_pipeline_motion_graphics     — kick off a prompt → motion-graphics job
//   ai_pipeline_poll                — poll any job by id (covers all kinds)
//
// All 4 are session-authenticated (require `ctx.userId`) — there is no
// service-only path because Nakama is the *only* legitimate caller of
// the AI svc /content-factory/from-nakama/* routes.
//
// Forward shape (Nakama → AI svc)
// ────────────────────────────────
//   POST https://${IVX_AI_SVC_BASE_URL}/api/ai/content-factory/from-nakama/jobs/{kind}
//   Headers:
//     X-IVX-Service:   "nakama"
//     X-IVX-Timestamp: <unix-ms>
//     X-IVX-Signature: hex(hmac-sha256(secret, "${ts}:${path}:${body}"))
//     Content-Type:    application/json
//   Body:
//     { cognitoSub: ctx.userId, ...userPayload }
//
// The HmacAuthGuard on the AI svc validates the signature and pulls
// `cognitoSub` out of the body. Nakama is the source of truth for
// user identity.
//
// Cross-references
// ----------------
//   src/analytics/personalization-rpc.ts   — same HMAC pattern
//   src/analytics/cross-sell-rpc.ts        — same HMAC pattern
//   intelli-verse-x/Intelliverse-X-AI#273  — AI svc /from-nakama/* endpoints
//   intelli-verse-x/content-factory#34/35  — underlying pipelines

namespace AiPipelines {

  // ── Constants ──────────────────────────────────────────────────────────────
  var SERVICE_NAME = "nakama";
  // NOTE: IVX_AI_SVC_BASE_URL already terminates in `/api/ai` (matches every
  // other Nakama → AI-svc consumer: personalization-rpc, cross-sell-rpc,
  // privacy-rpc). Route paths here MUST NOT re-include `/api/ai` or the
  // upstream returns 404.
  var ROUTE_BASE = "/content-factory/from-nakama/jobs";
  var REQUEST_TIMEOUT_MS = 6500;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function aiSvcBase(ctx: nkruntime.Context, logger: nkruntime.Logger): string | null {
    var base = (ctx.env && ctx.env["IVX_AI_SVC_BASE_URL"]) || "";
    if (!base) {
      logger.warn("[AiPipelines] IVX_AI_SVC_BASE_URL unset");
      return null;
    }
    return base.replace(/\/$/, "");
  }

  function computeSignature(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    ts: string,
    path: string,
    body: string,
    logger: nkruntime.Logger,
  ): string {
    var secret = (ctx.env && ctx.env["IVX_INSIGHTS_SHARED_SECRET"]) || "";
    if (!secret) {
      logger.warn("[AiPipelines] IVX_INSIGHTS_SHARED_SECRET unset");
      return "";
    }
    var msg = ts + ":" + path + ":" + body;
    try {
      var raw = nk.hmacSha256Hash(msg, secret);
      return nk.base16Encode(raw, false).toLowerCase();
    } catch (e: any) {
      logger.warn("[AiPipelines] hmac failed: " + ((e && e.message) ? e.message : String(e)));
      return "";
    }
  }

  /**
   * Pull the path portion (everything from the first `/` after the host) out
   * of an absolute URL. We need this so the HMAC signature we send covers
   * exactly the same path the AI-svc HmacAuthGuard sees via `req.originalUrl`
   * — including any global prefix (`/api/ai`) baked into IVX_AI_SVC_BASE_URL.
   * Signing only the route suffix (e.g. `/content-factory/...`) without the
   * prefix yields "signature mismatch" on the receiver. Reference:
   * src/_lib/guards/hmac-auth.guard.ts.
   */
  function extractUrlPath(absUrl: string): string {
    // absUrl like "http://host:3000/api/ai" → return "/api/ai".
    // No regex with `://` since the postbuild's syntax-check has tripped on
    // raw `:`-glob patterns historically; this hand-rolled scan is trivial.
    var schemeIdx = absUrl.indexOf("://");
    if (schemeIdx === -1) return absUrl; // already a path
    var afterScheme = absUrl.substring(schemeIdx + 3);
    var slashIdx = afterScheme.indexOf("/");
    if (slashIdx === -1) return ""; // no path component
    return afterScheme.substring(slashIdx);
  }

  /**
   * Sign + POST a JSON payload to the AI service, returning the parsed body
   * or null on any transport-level failure. The HTTP code is included in
   * the result envelope so RPC handlers can distinguish 4xx (caller error)
   * from 5xx (transient).
   */
  function postSigned(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    path: string,
    payload: any,
  ): { code: number; body: any } | null {
    var base = aiSvcBase(ctx, logger);
    if (!base) return null;
    var bodyString = JSON.stringify(payload || {});
    var ts = String(Date.now());
    // Sign the FULL receiver-side path (`/api/ai` prefix + route) — see
    // extractUrlPath() above.
    var signedPath = extractUrlPath(base) + path;
    var sig = computeSignature(ctx, nk, ts, signedPath, bodyString, logger);
    try {
      var resp = nk.httpRequest(
        base + path,
        "post",
        {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-IVX-Service": SERVICE_NAME,
          "X-IVX-Timestamp": ts,
          "X-IVX-Signature": sig,
        },
        bodyString,
        REQUEST_TIMEOUT_MS,
      );
      if (!resp) return null;
      var parsed: any = null;
      try {
        parsed = JSON.parse(resp.body || "{}");
      } catch (_) {
        parsed = { _raw: resp.body || "" };
      }
      return { code: resp.code, body: parsed };
    } catch (e: any) {
      logger.warn("[AiPipelines] post " + path + " threw: " + ((e && e.message) ? e.message : String(e)));
      return null;
    }
  }

  function errEnvelope(code: string, message?: string): string {
    return JSON.stringify({
      ok: false,
      error: code,
      message: message || code,
    });
  }

  function okEnvelope(data: any): string {
    return JSON.stringify({
      ok: true,
      data: data || null,
    });
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  function sanitizePlatform(p: string | undefined): string {
    var allowed = ["youtube_shorts", "tiktok", "instagram_reels", "in_app"];
    if (!p) return "youtube_shorts";
    for (var i = 0; i < allowed.length; i++) {
      if (allowed[i] === p) return p;
    }
    return "youtube_shorts";
  }

  function clampDuration(v: any, min: number, max: number, fallback: number): number {
    var n = Number(v);
    if (isNaN(n) || !isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function safeBool(v: any, fallback: boolean): boolean {
    if (typeof v === "boolean") return v;
    if (v === "true" || v === 1) return true;
    if (v === "false" || v === 0) return false;
    return fallback;
  }

  function safeStr(v: any, max: number): string | undefined {
    if (typeof v !== "string") return undefined;
    var s = v.trim();
    if (!s) return undefined;
    return s.length > max ? s.substring(0, max) : s;
  }

  // ── RPC: ai_pipeline_weekly_recap ───────────────────────────────────────────

  function rpcWeeklyRecap(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var userId = ctx.userId || "";
    if (!userId) return errEnvelope("no_user", "Authentication required");

    var data: any;
    try { data = JSON.parse(payload || "{}"); } catch (_) {
      return errEnvelope("invalid_json", "Invalid JSON payload");
    }

    var body = {
      cognitoSub: userId,
      concept: safeStr(data.concept, 200),
      targetDurationSec: clampDuration(data.targetDurationSec, 10, 90, 20),
      platform: sanitizePlatform(data.platform),
      withVoiceover: safeBool(data.withVoiceover, true),
      personalize: safeBool(data.personalize, true),
      playerId: userId,
      language: safeStr(data.language, 8) || "en",
    };

    var resp = postSigned(ctx, nk, logger, ROUTE_BASE + "/weekly-recap", body);
    if (!resp) return errEnvelope("ai_svc_unreachable", "AI service unreachable");
    if (resp.code >= 400) {
      return errEnvelope("ai_svc_error_" + resp.code, JSON.stringify(resp.body));
    }
    return okEnvelope(resp.body);
  }

  // ── RPC: ai_pipeline_monthly_recap ──────────────────────────────────────────

  function rpcMonthlyRecap(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var userId = ctx.userId || "";
    if (!userId) return errEnvelope("no_user", "Authentication required");

    var data: any;
    try { data = JSON.parse(payload || "{}"); } catch (_) {
      return errEnvelope("invalid_json", "Invalid JSON payload");
    }

    var body = {
      cognitoSub: userId,
      concept: safeStr(data.concept, 200),
      targetDurationSec: clampDuration(data.targetDurationSec, 20, 180, 60),
      platform: sanitizePlatform(data.platform),
      withVoiceover: safeBool(data.withVoiceover, true),
      personalize: safeBool(data.personalize, true),
      playerId: userId,
      language: safeStr(data.language, 8) || "en",
    };

    var resp = postSigned(ctx, nk, logger, ROUTE_BASE + "/monthly-recap", body);
    if (!resp) return errEnvelope("ai_svc_unreachable", "AI service unreachable");
    if (resp.code >= 400) {
      return errEnvelope("ai_svc_error_" + resp.code, JSON.stringify(resp.body));
    }
    return okEnvelope(resp.body);
  }

  // ── RPC: ai_pipeline_motion_graphics ────────────────────────────────────────

  function rpcMotionGraphics(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var userId = ctx.userId || "";
    if (!userId) return errEnvelope("no_user", "Authentication required");

    var data: any;
    try { data = JSON.parse(payload || "{}"); } catch (_) {
      return errEnvelope("invalid_json", "Invalid JSON payload");
    }

    var prompt = safeStr(data.prompt, 2000);
    if (!prompt || prompt.length < 4) {
      return errEnvelope("invalid_prompt", "Prompt must be 4-2000 chars");
    }

    // The AI svc accepts a few values; map free-form Unity strings down.
    var styleHint = safeStr(data.styleHint, 40);
    var allowedStyle = [
      "kinetic_typography",
      "data_explainer",
      "product_demo",
      "social_cut",
      "tutorial",
    ];
    var styleHintFinal: string | undefined = undefined;
    if (styleHint) {
      for (var i = 0; i < allowedStyle.length; i++) {
        if (allowedStyle[i] === styleHint) {
          styleHintFinal = styleHint;
          break;
        }
      }
    }

    var aspect = safeStr(data.aspectRatio, 5);
    if (aspect !== "9:16" && aspect !== "16:9" && aspect !== "1:1") {
      aspect = "9:16";
    }

    var body: any = {
      cognitoSub: userId,
      prompt: prompt,
      platform: sanitizePlatform(data.platform),
      styleHint: styleHintFinal,
      targetDurationSec: clampDuration(data.targetDurationSec, 5, 120, 30),
      aspectRatio: aspect,
      withVoiceover: safeBool(data.withVoiceover, true),
      language: safeStr(data.language, 8) || "en",
      accentColorOverride: safeStr(data.accentColorOverride, 9),
    };

    var resp = postSigned(ctx, nk, logger, ROUTE_BASE + "/motion-graphics-from-prompt", body);
    if (!resp) return errEnvelope("ai_svc_unreachable", "AI service unreachable");
    if (resp.code >= 400) {
      return errEnvelope("ai_svc_error_" + resp.code, JSON.stringify(resp.body));
    }
    return okEnvelope(resp.body);
  }

  // ── RPC: ai_pipeline_poll ───────────────────────────────────────────────────

  function rpcPoll(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var userId = ctx.userId || "";
    if (!userId) return errEnvelope("no_user", "Authentication required");

    var data: any;
    try { data = JSON.parse(payload || "{}"); } catch (_) {
      return errEnvelope("invalid_json", "Invalid JSON payload");
    }

    var jobId = safeStr(data.jobId, 200);
    if (!jobId) return errEnvelope("invalid_job_id", "jobId required");

    var resp = postSigned(
      ctx, nk, logger,
      ROUTE_BASE + "/" + encodeURIComponent(jobId) + "/poll",
      { cognitoSub: userId },
    );
    if (!resp) return errEnvelope("ai_svc_unreachable", "AI service unreachable");
    if (resp.code === 404) return errEnvelope("not_found", "Job not found");
    if (resp.code >= 400) {
      return errEnvelope("ai_svc_error_" + resp.code, JSON.stringify(resp.body));
    }
    return okEnvelope(resp.body);
  }

  // ── Registration ───────────────────────────────────────────────────────────

  // Note: this register() takes ONLY `(initializer)` — that single-arg shape is
  // required by data/modules/postbuild.js so the `__rpc_*` globals populated by
  // `initializer.registerRpc(...)` are visible to the auto-generated InitModule
  // wrapper. A second parameter would silently disable auto-invoke and the
  // runtime would fail every dispatch with "JavaScript runtime function invalid".
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ai_pipeline_weekly_recap", rpcWeeklyRecap);
    initializer.registerRpc("ai_pipeline_monthly_recap", rpcMonthlyRecap);
    initializer.registerRpc("ai_pipeline_motion_graphics", rpcMotionGraphics);
    initializer.registerRpc("ai_pipeline_poll", rpcPoll);
  }
}
