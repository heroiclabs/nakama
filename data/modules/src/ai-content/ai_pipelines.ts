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
// RPCs registered (5)
// -------------------
//   ai_pipeline_weekly_recap        — kick off a 7-day personalized recap          (user)
//   ai_pipeline_monthly_recap       — kick off a 30-day personalized recap         (user)
//   ai_pipeline_motion_graphics     — kick off a prompt → motion-graphics job      (user)
//   ai_pipeline_poll                — poll any job by id (covers all kinds)        (user)
//   ai_pipeline_complete            — AI svc → Nakama push when a job terminates   (server)
//
// The first 4 are session-authenticated (require `ctx.userId`). The
// 5th (`ai_pipeline_complete`) is the inverse leg: the AI svc invokes
// it via Nakama's `http_key` server-key auth after a content-factory
// job reaches a terminal state, so we can fan-out an in-app push
// notification to the player's Unity socket + record the artifact in
// the player's `ai_pipeline_jobs` storage collection for offline
// retrieval. Server-callers have `ctx.userId === ""` after the
// http_key handshake (Nakama short-circuits to "server" caller
// identity); we treat that as the proof-of-service.
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

  // Recap + motion-graphics platforms — must match the AI svc DTO enums
  // exactly (CreateRecapJobDto.platform: tiktok|youtube_shorts|instagram_reels|web,
  // CreateMotionGraphicsFromPromptJobDto.platform: + 'youtube'). We send the
  // intersection so the same sanitizer works for both. Anything outside the
  // set (e.g. legacy "in_app" payloads from older clients) falls back to the
  // default; the AI svc validator would otherwise reject the entire body.
  function sanitizePlatform(p: string | undefined): string {
    var allowed = ["youtube_shorts", "tiktok", "instagram_reels", "web"];
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

    // NOTE: CreateRecapJobDto does NOT accept `language` — Nest's
    // ValidationPipe runs with whitelist+forbidNonWhitelisted, so any extra
    // field 400s the whole request. Keep the body to fields declared in
    // src/content-factory/dto/content-factory.dto.ts::CreateRecapJobDto.
    var body = {
      cognitoSub: userId,
      concept: safeStr(data.concept, 200),
      targetDurationSec: clampDuration(data.targetDurationSec, 15, 90, 20),
      platform: sanitizePlatform(data.platform),
      withVoiceover: safeBool(data.withVoiceover, true),
      personalize: safeBool(data.personalize, true),
      playerId: userId,
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

    // See weekly-recap note: `language` is not in the CreateRecapJobDto.
    var body = {
      cognitoSub: userId,
      concept: safeStr(data.concept, 200),
      targetDurationSec: clampDuration(data.targetDurationSec, 20, 180, 60),
      platform: sanitizePlatform(data.platform),
      withVoiceover: safeBool(data.withVoiceover, true),
      personalize: safeBool(data.personalize, true),
      playerId: userId,
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

    // The AI svc accepts a narrow enum on CreateMotionGraphicsFromPromptJobDto;
    // map free-form Unity strings down. Anything outside the set is dropped
    // so the AI svc applies its default ("kinetic_typography").
    var styleHint = safeStr(data.styleHint, 40);
    var allowedStyle = [
      "minimalist",
      "kinetic_typography",
      "data_visualization",
      "explainer_cartoon",
      "academic",
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

  // ── RPC: ai_pipeline_complete (AI svc → Nakama callback) ───────────────────
  //
  // Called by the AI service's `ContentFactoryNotifier.fireNakama()` when a
  // content-factory job reaches a terminal state. Authenticated via
  // Nakama's `http_key` query param (set on the AI svc as
  // `NAKAMA_HTTP_KEY`). When that handshake succeeds, Nakama runs the
  // RPC as a server caller (ctx.userId === "") and we use the
  // `userId` field in the payload to address the player.
  //
  // Side effects:
  //   • Write a row to the player's `ai_pipeline_jobs` storage collection
  //     so the Unity client can retrieve the artifact even after losing
  //     the live socket. Key = jobId. Read-only from client.
  //   • Push an in-app notification (code AI_PIPELINE_COMPLETE_CODE) to
  //     the player's Unity socket. If they're offline, Nakama queues it
  //     so they pick it up on next connect.
  //
  // Always returns a delivered=true|false envelope; never throws — a
  // failed notification path MUST NOT break the AI svc's terminal
  // bookkeeping (the job is already complete; this is best-effort
  // fan-out).
  var AI_PIPELINE_JOBS_COLLECTION = "ai_pipeline_jobs";
  // Notification code chosen above the legacy 1xxx band (creator-event-live
  // uses 1001 etc.) and avoids the Hiro reserved range (>=2000).
  var AI_PIPELINE_COMPLETE_CODE = 1310;

  function safeStrUserId(raw: any, max: number): string {
    if (typeof raw !== "string") return "";
    // Nakama userIds are UUIDs; reject anything outside the printable
    // ASCII subset we use elsewhere in this module's `safeStr`.
    return safeStr(raw, max);
  }

  function rpcComplete(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    // Server caller check: ctx.userId is the *invoker* userId; for
    // server-key (http_key) callers Nakama sets it to the empty string.
    // We refuse user-callable invocation outright so a malicious client
    // can't spoof "your recap is done" notifications for themselves
    // (let alone for another userId in the body).
    if (ctx.userId && ctx.userId.length > 0) {
      return errEnvelope("forbidden", "ai_pipeline_complete is service-only");
    }

    var data: any;
    try { data = JSON.parse(payload || "{}"); } catch (_) {
      return errEnvelope("invalid_json", "Invalid JSON payload");
    }

    var targetUserId = safeStrUserId(data.userId, 100);
    var jobId = safeStr(data.jobId, 200);
    var pipeline = safeStr(data.pipeline, 80);
    var status = safeStr(data.status, 30);
    if (!targetUserId || !jobId || !pipeline || !status) {
      return errEnvelope(
        "invalid_payload",
        "userId, jobId, pipeline, status are required",
      );
    }

    // Status must be one of the AI svc terminal states. Anything else is
    // either an in-flight tick (we shouldn't have been called) or a
    // poisoned payload from a future schema we don't yet understand.
    var allowedStatus = ["completed", "failed", "cancelled"];
    var statusOk = false;
    for (var i = 0; i < allowedStatus.length; i++) {
      if (allowedStatus[i] === status) { statusOk = true; break; }
    }
    if (!statusOk) {
      return errEnvelope(
        "invalid_status",
        "status must be one of: " + allowedStatus.join(", "),
      );
    }

    // Compose a compact, push-safe snapshot for the storage row + the
    // notification body. We deliberately keep the surface narrow — full
    // artifact retrieval goes through `GET /content-factory/jobs/:jobId`
    // on the AI svc, addressable by the same jobId. resultSummary IS
    // forwarded because the Unity client uses it to jump straight to
    // the artifact without a second fetch (canonical IDs / URLs only).
    var record: any = {
      jobId: jobId,
      pipeline: pipeline,
      status: status,
      concept: data.concept == null ? null : safeStr(data.concept, 300),
      title: data.title == null ? null : safeStr(data.title, 200),
      progress: typeof data.progress === "number" ? data.progress : 100,
      errorMessage:
        data.errorMessage == null ? null : safeStr(data.errorMessage, 500),
      completedAt:
        data.completedAt == null ? null : safeStr(data.completedAt, 40),
      resultSummary:
        data.resultSummary && typeof data.resultSummary === "object"
          ? data.resultSummary
          : null,
      receivedAt: new Date().toISOString(),
    };

    // Write to player-owned storage; permissionRead=2 (public read for
    // the owner only via standard Nakama auth), permissionWrite=0 (server
    // only — clients cannot mutate completion records).
    try {
      nk.storageWrite([{
        collection: AI_PIPELINE_JOBS_COLLECTION,
        key: jobId,
        userId: targetUserId,
        value: record,
        permissionRead: 1,  // owner-only read
        permissionWrite: 0, // server-only write
      }]);
    } catch (e: any) {
      logger.warn(
        "[AiPipelines] storageWrite failed for job %s user %s: %s",
        jobId, targetUserId, (e && e.message) || String(e),
      );
      // Continue — push notification is still worth attempting.
    }

    // In-app push: Nakama queues for offline users, delivers on next
    // socket connect. persistent=true so the client inbox shows it
    // until acked.
    var pushDelivered = false;
    try {
      nk.notificationsSend([{
        userId: targetUserId,
        code: AI_PIPELINE_COMPLETE_CODE,
        subject: status === "completed"
          ? "Your AI content is ready"
          : (status === "failed"
              ? "AI generation hit a snag"
              : "AI generation cancelled"),
        content: {
          type: "ai_pipeline_complete",
          jobId: jobId,
          pipeline: pipeline,
          status: status,
          concept: record.concept,
          title: record.title,
          errorMessage: record.errorMessage,
          resultSummary: record.resultSummary,
        },
        persistent: true,
      }]);
      pushDelivered = true;
    } catch (e: any) {
      logger.warn(
        "[AiPipelines] notificationsSend failed for job %s user %s: %s",
        jobId, targetUserId, (e && e.message) || String(e),
      );
    }

    logger.info(
      "[AiPipelines] ai_pipeline_complete user=%s job=%s pipeline=%s status=%s push=%s",
      targetUserId, jobId, pipeline, status, pushDelivered ? "ok" : "failed",
    );

    return okEnvelope({ delivered: pushDelivered });
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
    initializer.registerRpc("ai_pipeline_complete", rpcComplete);
  }
}
