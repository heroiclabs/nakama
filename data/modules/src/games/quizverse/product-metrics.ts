// =============================================================================
// src/games/quizverse/product-metrics.ts
// =============================================================================
// RPC: quizverse_product_metrics
//
// Path B data access — Nakama admin calls n8n WF-09 (/webhook/admin/metrics)
// server-side via nk.httpRequest. QuizVerse Next.js continues to call the same
// webhook directly; removing the QuizVerse UI later does not affect this RPC
// as long as WF-09 + the CRM ingest pipeline (WF-14 / WF-16) stay live.
//
// Env (must be in RUNTIME_ENV_KEYS + docker-compose environment:):
//   QUIZVERSE_N8N_BASE_URL      e.g. https://n8n.intelli-verse-x.ai
//   QUIZVERSE_ADMIN_API_TOKEN   Bearer token (n8n ADMIN_API_TOKEN)
//
// Payload: { slice?: string, days?: number }
//   slice — overview | funnel | retention | mode-mix | sponsors | experiments | timeseries
//   days  — used by timeseries (default 30)
// =============================================================================

namespace QuizVerseProductMetrics {

  var VALID_SLICES: { [key: string]: boolean } = {
    "overview": true,
    "funnel": true,
    "retention": true,
    "mode-mix": true,
    "sponsors": true,
    "experiments": true,
    "timeseries": true,
  };

  function env(ctx: nkruntime.Context, key: string): string {
    return (ctx.env && ctx.env[key]) || "";
  }

  function rpcProductMetrics(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    RpcHelpers.requireAdmin(ctx, nk);

    var req: any;
    try {
      req = RpcHelpers.parseRpcPayload(payload);
    } catch (err: any) {
      return RpcHelpers.errorResponse(err.message || "invalid payload", nkruntime.Codes.INVALID_ARGUMENT);
    }

    var slice = (req.slice && String(req.slice)) || "overview";
    if (!VALID_SLICES[slice]) {
      return RpcHelpers.errorResponse(
        "invalid slice — allowed: overview, funnel, retention, mode-mix, sponsors, experiments, timeseries",
        nkruntime.Codes.INVALID_ARGUMENT
      );
    }

    var days = (typeof req.days === "number") ? req.days : 30;
    if (days < 1 || days > 365) {
      days = 30;
    }

    var baseUrl = env(ctx, "QUIZVERSE_N8N_BASE_URL");
    var token = env(ctx, "QUIZVERSE_ADMIN_API_TOKEN");
    if (!baseUrl || !token) {
      return RpcHelpers.errorResponse(
        "product metrics not configured — set QUIZVERSE_N8N_BASE_URL and QUIZVERSE_ADMIN_API_TOKEN on Nakama",
        503
      );
    }

    baseUrl = baseUrl.replace(/\/$/, "");
    var url =
      baseUrl +
      "/webhook/admin/metrics?slice=" +
      encodeURIComponent(slice) +
      "&days=" +
      encodeURIComponent(String(days));

    try {
      var resp: any = nk.httpRequest(
        url,
        "get",
        { Authorization: "Bearer " + token, Accept: "application/json" },
        "",
        15000
      );

      if (resp.code < 200 || resp.code >= 300) {
        logger.warn(
          "[ProductMetrics] n8n HTTP " +
            resp.code +
            " slice=" +
            slice +
            " body=" +
            (resp.body || "").substring(0, 240)
        );
        return RpcHelpers.errorResponse("upstream metrics HTTP " + resp.code, resp.code);
      }

      var parsed = RpcHelpers.safeJsonParse(resp.body || "{}");
      if (!parsed.success) {
        return RpcHelpers.errorResponse("upstream returned invalid JSON", 502);
      }

      var body = parsed.data;
      var sliceData = body;
      var generatedAt: string | null = null;

      // WF-09 wraps payloads as { slice, generated_at, data: <payload> }.
      if (body && body.data !== undefined && body.slice) {
        sliceData = body.data;
        generatedAt = body.generated_at ? String(body.generated_at) : null;
      }

      return RpcHelpers.successResponse({
        slice: slice,
        generated_at: generatedAt,
        days: days,
        data: sliceData,
      });
    } catch (err: any) {
      var msg = err && err.message ? String(err.message) : String(err);
      logger.error("[ProductMetrics] transport error slice=" + slice + ": " + msg);
      RpcHelpers.logRpcError(nk, logger, "quizverse_product_metrics", msg, ctx.userId);
      return RpcHelpers.errorResponse("failed to fetch product metrics", 502);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_product_metrics", rpcProductMetrics);
  }
}
