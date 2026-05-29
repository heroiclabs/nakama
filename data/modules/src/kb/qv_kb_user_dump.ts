// qv_kb_user_dump.ts
// ─────────────────────────────────────────────────────────────────────────────
// QuizVerse — User KB inspection RPCs (Nakama wrapper around the BFF dump route)
//
// Why these exist
// ---------------
// The web team shipped `GET /api/v1/kb/user/{userId}/dump` on quizverse.world
// (see Quizverse-web-frontend/web/app/api/v1/kb/user/[userId]/dump/route.ts).
// That endpoint returns every doc the KB has recorded for a user, fanned out
// across all 11 `qv_u_<userId>_<kind>` memory-service collections. It's the
// single source of truth Unity needs to render the in-game Knowledge Graph
// view.
//
// Unity already talks to Nakama via the Nakama SDK and never speaks HTTPS
// directly to quizverse.world. To keep that pattern (and to make sure no
// client build ever ships the admin secret), we expose three thin RPCs here
// that the Unity client calls with its normal session token; Nakama then
// signs the outbound HTTPS call with the admin secret server-side and
// returns the response verbatim.
//
// RPCs registered (3)
// -------------------
//   qv_kb_user_dump      — full multi-kind dump for the calling user
//   qv_kb_user_summary   — light "what's in my KB?" call (no document text;
//                           returns just counts + collection ids — fast)
//   qv_kb_user_kind      — single-kind drill-down (for graph node expansion
//                           after the initial graph is rendered)
//
// Auth model
// ----------
// Each RPC accepts TWO equivalent paths:
//   (a) the caller IS the user — `ctx.userId` is set by Nakama auth middleware
//       and the RPC ALWAYS scopes the BFF call to `ctx.userId`. Payload
//       `user_id` is ignored in this path; clients cannot read someone else's
//       KB by tampering with the payload.
//   (b) the caller is a trusted service — payload `service_token` matches
//       `ctx.env["QV_KB_NAKAMA_SERVICE_TOKEN"]`, AND payload `user_id` is
//       supplied. Used by the gateway / cron / admin dashboards.
//
// http_key (server-to-server with empty ctx.userId) callers MUST use path (b).
//
// Upstream HTTP call
// ------------------
// Target URL is built from:
//   • `ctx.env["QV_KB_BFF_URL"]` — base URL, defaults to the in-cluster
//     service `http://intelliverse-quiz-frontend.aicart.svc.cluster.local:3000`
//     to avoid the public LB hop and stay inside the VPC.
//   • Path                       — `/api/v1/kb/user/{userId}/dump[?…]`
//
// Outbound auth header:
//   `Authorization: Bearer <ctx.env["QV_KB_ADMIN_SECRET"]>`
// (same shared secret already used by /api/kb/admin/secret-ingest; it is
// listed in nakama-secret.yaml -> runtime.env so the Goja runtime can see it.)
//
// Cross-references
// ----------------
//   Quizverse-web-frontend/web/app/api/v1/kb/user/[userId]/dump/route.ts  — BFF route
//   Quizverse-web-frontend/web/app/api/kb/ingest/[source]/route.ts        — USER_DOC_KINDS (write side)
//   content-factory/services/memory/api/routes/knowledge.py               — `/knowledge/list` upstream
//   intelli-verse-kube-infra/nakama/nakama-secret.yaml                    — runtime.env: must add
//                                                                            QV_KB_ADMIN_SECRET and
//                                                                            QV_KB_NAKAMA_SERVICE_TOKEN

namespace QvKbUserDump {

  // ── Constants ──────────────────────────────────────────────────────────────
  var DEFAULT_BFF_URL = "http://intelliverse-quiz-frontend.aicart.svc.cluster.local:3000";
  var DEFAULT_LIMIT_PER_KIND = 50;
  var MAX_LIMIT_PER_KIND = 100;
  var DEFAULT_TEXT_TRUNCATE_FOR_SUMMARY = 0;
  var UPSTREAM_TIMEOUT_MS = 10000;
  // Mirror of USER_DOC_KINDS in /api/kb/ingest/[source]/route.ts (KB v2 §5.3).
  var ALL_KINDS = [
    "weak", "attempts", "notes", "goals", "behavior",
    "diagnostic", "chat", "animations", "quests",
    "insights", "parent_summary"
  ];
  var USER_ID_REGEX = /^[A-Za-z0-9_-]{4,128}$/;
  var KIND_REGEX = /^[a-z_]{3,32}$/;

  // ── Env helpers ────────────────────────────────────────────────────────────
  function getBffUrl(ctx: nkruntime.Context): string {
    return "" + ((ctx.env && ctx.env["QV_KB_BFF_URL"]) || DEFAULT_BFF_URL);
  }

  function getAdminSecret(ctx: nkruntime.Context): string {
    return "" + ((ctx.env && ctx.env["QV_KB_ADMIN_SECRET"]) || "");
  }

  function getServiceToken(ctx: nkruntime.Context): string {
    return "" + ((ctx.env && ctx.env["QV_KB_NAKAMA_SERVICE_TOKEN"]) || "");
  }

  // Constant-time string compare (Goja has no `crypto.timingSafeEqual`).
  function constantTimeEq(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }

  // ── Caller resolution ──────────────────────────────────────────────────────
  // Returns the user id this RPC should query, or throws an Error which the
  // top-level handler converts into an `errorResponse`.
  //
  // Rules:
  //   - Always prefer ctx.userId when set (Unity Nakama session). Payload
  //     `user_id` is IGNORED in this path so a malicious client cannot dump
  //     another user's KB by tampering with the payload.
  //   - When ctx.userId is empty (http_key admin call from a backend), require
  //     `service_token` + `user_id` in the payload.
  function resolveTargetUser(ctx: nkruntime.Context, data: any): { userId: string; via: string } {
    var hdrUid = ctx.userId || "";
    if (hdrUid) {
      if (!USER_ID_REGEX.test(hdrUid)) throw new Error("invalid ctx.userId");
      return { userId: hdrUid, via: "self" };
    }
    var providedToken = "" + (data && data.service_token || "");
    var expectedToken = getServiceToken(ctx);
    if (!expectedToken || !providedToken || !constantTimeEq(providedToken, expectedToken)) {
      throw new Error("service_token required (no Nakama session present)");
    }
    var payloadUid = "" + (data && data.user_id || "");
    if (!payloadUid || !USER_ID_REGEX.test(payloadUid)) {
      throw new Error("user_id required and must match ^[A-Za-z0-9_-]{4,128}$");
    }
    return { userId: payloadUid, via: "service" };
  }

  // ── Query string builder ───────────────────────────────────────────────────
  // Validates and serialises the optional query parameters that the BFF
  // route accepts. We never trust the client payload verbatim — any field
  // we don't recognise is dropped, so a misbehaving client cannot smuggle
  // through extra parameters that bypass server-side defaults.
  function buildQuery(data: any): string {
    var parts: string[] = [];

    // kinds
    var rawKinds = data && data.kinds;
    var kindList: string[] = [];
    if (typeof rawKinds === "string" && rawKinds.length > 0) {
      var split = rawKinds.split(",");
      for (var i = 0; i < split.length; i++) {
        var k = (split[i] || "").trim().toLowerCase();
        if (KIND_REGEX.test(k) && ALL_KINDS.indexOf(k) >= 0) kindList.push(k);
      }
    } else if (Object.prototype.toString.call(rawKinds) === "[object Array]") {
      for (var j = 0; j < (rawKinds as any[]).length; j++) {
        var kk = ("" + (rawKinds as any[])[j]).trim().toLowerCase();
        if (KIND_REGEX.test(kk) && ALL_KINDS.indexOf(kk) >= 0) kindList.push(kk);
      }
    }
    if (kindList.length > 0) parts.push("kinds=" + encodeURIComponent(kindList.join(",")));

    // limit_per_kind
    var lp = parseInt("" + (data && data.limit_per_kind), 10);
    if (!isFinite(lp) || lp <= 0) lp = DEFAULT_LIMIT_PER_KIND;
    if (lp > MAX_LIMIT_PER_KIND) lp = MAX_LIMIT_PER_KIND;
    parts.push("limit_per_kind=" + lp);

    // order
    var order = ("" + (data && data.order || "desc")).toLowerCase();
    if (order !== "asc" && order !== "desc") order = "desc";
    parts.push("order=" + order);

    // include_text — default true at the BFF level; this RPC defaults to
    // false ONLY when the summary path is used (see callBff(... 'summary')).
    if (data && data.include_text === false) parts.push("include_text=false");
    else if (data && data.include_text === true) parts.push("include_text=true");

    // text_truncate
    var tt = parseInt("" + (data && data.text_truncate), 10);
    if (isFinite(tt) && tt > 0) parts.push("text_truncate=" + Math.min(tt, 20000));

    return parts.length > 0 ? "?" + parts.join("&") : "";
  }

  // ── BFF call ───────────────────────────────────────────────────────────────
  // Returns the parsed JSON body on success, or throws on transport / auth
  // failures. Caller is responsible for turning thrown errors into RPC error
  // responses.
  function callBff(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    userId: string,
    qs: string,
    mode: string,
  ): any {
    var adminSecret = getAdminSecret(ctx);
    if (!adminSecret) {
      throw new Error("QV_KB_ADMIN_SECRET not configured in Nakama runtime.env");
    }
    var url = getBffUrl(ctx).replace(/\/+$/, "")
            + "/api/v1/kb/user/" + encodeURIComponent(userId) + "/dump" + qs;
    var headers: { [k: string]: string } = {
      "Authorization": "Bearer " + adminSecret,
      "Accept": "application/json",
      "User-Agent": "nakama-qv-kb-rpc/1.0 (" + mode + ")",
    };
    var resp: any;
    try {
      resp = nk.httpRequest(url, "get", headers, "", UPSTREAM_TIMEOUT_MS);
    } catch (e: any) {
      logger.warn("[qv_kb_user_dump] httpRequest threw: " + (e && e.message ? e.message : String(e)));
      throw new Error("upstream_unreachable");
    }
    var code = (resp && resp.code) || 0;
    if (code < 200 || code >= 300) {
      logger.warn("[qv_kb_user_dump] BFF non-2xx code=" + code +
        " body=" + (resp && resp.body ? String(resp.body).slice(0, 300) : ""));
      // Surface a few specific upstream codes so the client can react.
      if (code === 400) throw new Error("upstream_bad_request");
      if (code === 401 || code === 403) throw new Error("upstream_auth_failed");
      if (code === 504) throw new Error("upstream_timeout");
      throw new Error("upstream_" + code);
    }
    try {
      return JSON.parse(resp.body || "{}");
    } catch (e: any) {
      throw new Error("upstream_invalid_json");
    }
  }

  // ── RPC: qv_kb_user_dump ──────────────────────────────────────────────────
  // Full dump. Forwards every documented query parameter to the BFF and
  // returns the BFF response under `data.dump`. Unity should call this with
  // `include_text: false` for the initial graph render and then call
  // `qv_kb_user_kind` to expand a single node's body on click.
  function rpcDump(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var who = resolveTargetUser(ctx, data);
      var qs = buildQuery(data);
      var t0 = Date.now();
      var body = callBff(ctx, logger, nk, who.userId, qs, "dump");
      var elapsed = Date.now() - t0;
      logger.info("[qv_kb_user_dump] ok user=" + who.userId + " via=" + who.via +
        " kinds=" + ((body && body.summary && body.summary.kinds_with_data) || []).join(",") +
        " total=" + (body && body.summary && body.summary.total_documents) +
        " elapsed_ms=" + elapsed);
      return RpcHelpers.successResponse({
        ok: true,
        auth_via: who.via,
        upstream_elapsed_ms: elapsed,
        dump: body,
      });
    } catch (err: any) {
      var msg = (err && err.message) || String(err);
      logger.warn("[qv_kb_user_dump] failed: " + msg);
      return RpcHelpers.errorResponse(msg, mapErrorCode(msg));
    }
  }

  // ── RPC: qv_kb_user_summary ───────────────────────────────────────────────
  // Light "is there anything in this user's KB?" call. Always forces
  // include_text=false and limit_per_kind=1 to keep payload size minimal —
  // the response is small enough to stick on every player session start.
  //
  // Returns:
  //   { ok, auth_via, summary: { total_documents, kinds_with_data,
  //                              kinds_empty, kinds_failed,
  //                              collection_ids: { <kind>: <coll_id>, … } } }
  function rpcSummary(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var who = resolveTargetUser(ctx, data);
      var qs = "?include_text=false&limit_per_kind=1";
      var t0 = Date.now();
      var body = callBff(ctx, logger, nk, who.userId, qs, "summary");
      var elapsed = Date.now() - t0;
      var collectionIds: { [k: string]: string } = {};
      if (body && Object.prototype.toString.call(body.collections) === "[object Array]") {
        for (var i = 0; i < body.collections.length; i++) {
          var c = body.collections[i] || {};
          if (c.kind && c.collection_id) collectionIds[c.kind] = c.collection_id;
        }
      }
      var summary = (body && body.summary) || { total_documents: 0, kinds_with_data: [], kinds_empty: [], kinds_failed: [] };
      var _ = DEFAULT_TEXT_TRUNCATE_FOR_SUMMARY; void _; // referenced to satisfy noUnusedLocals
      return RpcHelpers.successResponse({
        ok: true,
        auth_via: who.via,
        upstream_elapsed_ms: elapsed,
        user_id: who.userId,
        summary: {
          total_documents: summary.total_documents,
          kinds_with_data: summary.kinds_with_data,
          kinds_empty: summary.kinds_empty,
          kinds_failed: summary.kinds_failed,
          collection_ids: collectionIds,
        },
      });
    } catch (err: any) {
      var msg = (err && err.message) || String(err);
      logger.warn("[qv_kb_user_summary] failed: " + msg);
      return RpcHelpers.errorResponse(msg, mapErrorCode(msg));
    }
  }

  // ── RPC: qv_kb_user_kind ──────────────────────────────────────────────────
  // Single-kind drill-down for the "expand this graph node" interaction.
  //
  // Required payload:
  //   { kind: "chat" | "diagnostic" | "insights" | …,
  //     limit_per_kind?: number,   // default 50, max 100
  //     order?: "asc"|"desc",      // default desc
  //     text_truncate?: number,    // default 0 (full text)
  //     include_text?: boolean }    // default true
  //
  // Same auth model as dump/summary (self via ctx.userId OR service_token).
  function rpcKind(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var who = resolveTargetUser(ctx, data);
      var kind = ("" + (data && data.kind || "")).trim().toLowerCase();
      if (!kind || ALL_KINDS.indexOf(kind) < 0) {
        return RpcHelpers.errorResponse("kind required; one of " + ALL_KINDS.join(","), 400);
      }
      // Build a `kinds=<single>` query and reuse the dump's normaliser
      // for limit / order / text params.
      var subData: any = {
        kinds: kind,
        limit_per_kind: data && data.limit_per_kind,
        order: data && data.order,
        text_truncate: data && data.text_truncate,
      };
      // include_text defaults TRUE on this RPC (drill-down wants the body),
      // but honour an explicit false.
      if (data && data.include_text === false) subData.include_text = false;
      else subData.include_text = true;

      var qs = buildQuery(subData);
      var t0 = Date.now();
      var body = callBff(ctx, logger, nk, who.userId, qs, "kind=" + kind);
      var elapsed = Date.now() - t0;
      var collection: any = null;
      if (body && Object.prototype.toString.call(body.collections) === "[object Array]") {
        for (var i = 0; i < body.collections.length; i++) {
          if (body.collections[i] && body.collections[i].kind === kind) {
            collection = body.collections[i];
            break;
          }
        }
      }
      return RpcHelpers.successResponse({
        ok: true,
        auth_via: who.via,
        upstream_elapsed_ms: elapsed,
        user_id: who.userId,
        kind: kind,
        collection: collection || { kind: kind, collection_id: "qv_u_" + who.userId + "_" + kind, count: 0, documents: [] },
      });
    } catch (err: any) {
      var msg = (err && err.message) || String(err);
      logger.warn("[qv_kb_user_kind] failed: " + msg);
      return RpcHelpers.errorResponse(msg, mapErrorCode(msg));
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function mapErrorCode(msg: string): number {
    if (!msg) return 500;
    if (msg.indexOf("invalid") === 0 || msg.indexOf("user_id required") === 0 || msg.indexOf("kind required") === 0) return 400;
    if (msg.indexOf("service_token required") === 0) return 401;
    if (msg.indexOf("upstream_bad_request") === 0) return 400;
    if (msg.indexOf("upstream_auth_failed") === 0) return 401;
    if (msg.indexOf("upstream_timeout") === 0) return 504;
    if (msg.indexOf("upstream_unreachable") === 0) return 502;
    if (msg.indexOf("QV_KB_ADMIN_SECRET") === 0) return 503;
    return 500;
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("qv_kb_user_dump", rpcDump);
    initializer.registerRpc("qv_kb_user_summary", rpcSummary);
    initializer.registerRpc("qv_kb_user_kind", rpcKind);
  }
}
