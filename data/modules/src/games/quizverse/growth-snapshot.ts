// =============================================================================
// RPC: quizverse_growth_snapshot
//
// Path B — server-side fetch of n8n growth webhooks (GSC, GA4, Beehiiv, Users).
// Same endpoints QuizVerse /admin/metrics uses; Nakama does not depend on Next.js.
//
// Payload: { source: "gsc" | "ga4" | "newsletter" | "users" }
// =============================================================================

namespace QuizVerseGrowthSnapshot {

  var VALID_SOURCES: { [key: string]: boolean } = {
    gsc: true,
    ga4: true,
    newsletter: true,
    users: true,
  };

  var WEBHOOK_PATHS: { [key: string]: string } = {
    gsc: "/webhook/qv-gsc-snapshot",
    ga4: "/webhook/qv-ga4-snapshot",
    newsletter: "/webhook/qv-newsletter-snapshot",
    users: "/webhook/qv-users-snapshot",
  };

  function env(ctx: nkruntime.Context, key: string): string {
    return (ctx.env && ctx.env[key]) || "";
  }

  function rpcGrowthSnapshot(
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

    var source = (req.source && String(req.source)) || "";
    if (!VALID_SOURCES[source]) {
      return RpcHelpers.errorResponse(
        "invalid source — allowed: gsc, ga4, newsletter, users",
        nkruntime.Codes.INVALID_ARGUMENT
      );
    }

    var baseUrl = env(ctx, "QUIZVERSE_N8N_BASE_URL");
    var token = env(ctx, "QUIZVERSE_ADMIN_API_TOKEN");
    if (!baseUrl || !token) {
      return RpcHelpers.errorResponse(
        "growth snapshots not configured — set QUIZVERSE_N8N_BASE_URL and QUIZVERSE_ADMIN_API_TOKEN on Nakama",
        503
      );
    }

    baseUrl = baseUrl.replace(/\/$/, "");
    var path = WEBHOOK_PATHS[source];
    var url =
      baseUrl +
      path +
      "?token=" +
      encodeURIComponent(token);

    try {
      var resp: any = nk.httpRequest(
        url,
        "get",
        { Accept: "application/json" },
        "",
        20000
      );

      if (resp.code < 200 || resp.code >= 300) {
        logger.warn(
          "[GrowthSnapshot] n8n HTTP " +
            resp.code +
            " source=" +
            source +
            " body=" +
            (resp.body || "").substring(0, 240)
        );
        return RpcHelpers.errorResponse("upstream growth HTTP " + resp.code, resp.code);
      }

      var parsed = RpcHelpers.safeJsonParse(resp.body || "{}");
      if (!parsed.success) {
        return RpcHelpers.errorResponse("upstream returned invalid JSON", 502);
      }

      var body = parsed.data;
      return RpcHelpers.successResponse({
        source: source,
        ok: !!(body && body.ok),
        snapshot: body && body.snapshot !== undefined ? body.snapshot : null,
        error: body && body.error ? String(body.error) : null,
      });
    } catch (err: any) {
      var msg = err && err.message ? String(err.message) : String(err);
      logger.error("[GrowthSnapshot] transport error source=" + source + ": " + msg);
      RpcHelpers.logRpcError(nk, logger, "quizverse_growth_snapshot", msg, ctx.userId);
      return RpcHelpers.errorResponse("failed to fetch growth snapshot", 502);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_growth_snapshot", rpcGrowthSnapshot);
  }
}
