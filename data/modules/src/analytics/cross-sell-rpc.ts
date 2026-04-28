// Phase 4 Cross-Sell Engine (qv-insights-loop) — xsell_pick + xsell_record RPCs.
//
// SDK -> Nakama -> AI svc. The SDK never holds the HMAC shared secret;
// Nakama signs every forward with IVX_INSIGHTS_SHARED_SECRET and
// stamps the calling user id (sha-1 hash) as the user_id_hash so the
// delivery cap is enforceable server-side.
//
// Why route through Nakama instead of letting the SDK call the AI svc
// directly?
//   1. Single shared secret (rotation in one place).
//   2. The Nakama session id is the trust anchor for the user_id_hash;
//      otherwise the SDK could spoof and bypass the per-user cap.
//   3. Server-side schema validation rejects junk payloads at the edge.
//
// Behaviour:
//   xsell_pick   — proxy to POST /insights/xsell/pick. Returns
//                  {pick: null} on any error so the SDK's UI never
//                  renders garbage.
//   xsell_record — proxy to POST /insights/xsell/record. Returns
//                  {ok: true|false}. Caller fire-and-forget.

namespace QvCrossSell {

  interface PickRequest {
    game_id?: string;
    surface?: string;
    cohort_label?: string;
    quiz_mode?: string;
    features?: { [k: string]: any };
  }

  interface RecordRequest {
    game_id?: string;
    offer_id?: string;
    surface?: string;
    kind?: string;
  }

  function sha1Hex(nk: nkruntime.Nakama, s: string): string {
    if (!s) return "";
    try {
      // Nakama exposes sha256; we don't have sha1 — use sha256 truncated
      // to 40 hex chars for a stable, non-reversible user-id-hash. The
      // AI svc treats this as opaque so the algorithm choice is local.
      var raw = nk.sha256Hash(s);
      return nk.base16Encode(raw, false).toLowerCase().substr(0, 40);
    } catch (e: any) {
      return "";
    }
  }

  function aiSvcBase(ctx: nkruntime.Context, logger: nkruntime.Logger): string | null {
    var base = (ctx.env && ctx.env["IVX_AI_SVC_BASE_URL"]) || "";
    if (!base) {
      logger.warn("[QvCrossSell] IVX_AI_SVC_BASE_URL unset; call will be skipped");
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
      logger.warn("[QvCrossSell] IVX_INSIGHTS_SHARED_SECRET unset; signature empty");
      return "";
    }
    var msg = ts + ":" + path + ":" + body;
    try {
      var raw = nk.hmacSha256Hash(msg, secret);
      return nk.base16Encode(raw, false).toLowerCase();
    } catch (e: any) {
      logger.warn("[QvCrossSell] hmac compute failed: " + ((e && e.message) ? e.message : String(e)));
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
        logger.warn("[QvCrossSell] post " + path + " HTTP " + (resp ? resp.code : "no_resp"));
        return null;
      }
      return resp.body || "";
    } catch (e: any) {
      logger.warn("[QvCrossSell] post " + path + " threw: " + ((e && e.message) ? e.message : String(e)));
      return null;
    }
  }

  function rpcPick(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var data: PickRequest;
    try {
      data = JSON.parse(payload || "{}");
    } catch (e: any) {
      return JSON.stringify({ pick: null, error: "invalid_json" });
    }
    if (!data.game_id || !data.surface) {
      return JSON.stringify({ pick: null, error: "missing_required_fields" });
    }
    var userIdHash = sha1Hex(nk, ctx.userId || "");
    if (!userIdHash) {
      return JSON.stringify({ pick: null, error: "no_user" });
    }
    var body = JSON.stringify({
      gameId: data.game_id,
      userIdHash: userIdHash,
      surface: data.surface,
      cohortLabel: data.cohort_label || null,
      quizMode: data.quiz_mode || null,
      features: data.features || {},
    });
    var resp = postJson(ctx, nk, logger, "/insights/xsell/pick", body);
    if (resp == null) return JSON.stringify({ pick: null });
    // Pass-through — controller already returns {pick: ...}
    return resp;
  }

  function rpcRecord(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var data: RecordRequest;
    try {
      data = JSON.parse(payload || "{}");
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: "invalid_json" });
    }
    if (!data.offer_id || !data.kind || !data.game_id) {
      return JSON.stringify({ ok: false, error: "missing_required_fields" });
    }
    if (data.kind !== "impression" && data.kind !== "engagement") {
      // Conversions are server-confirmed via the billing webhook only.
      return JSON.stringify({ ok: false, error: "invalid_kind" });
    }
    var userIdHash = sha1Hex(nk, ctx.userId || "");
    var body = JSON.stringify({
      gameId: data.game_id,
      userIdHash: userIdHash,
      surface: data.surface,
      offerId: data.offer_id,
      kind: data.kind,
    });
    var resp = postJson(ctx, nk, logger, "/insights/xsell/record", body);
    if (resp == null) return JSON.stringify({ ok: false });
    return resp;
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("xsell_pick", rpcPick);
    initializer.registerRpc("xsell_record", rpcRecord);
  }
}
