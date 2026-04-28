// Phase 0.5 (qv-insights-loop) — product_changelog_append RPC.
//
// Any service that ships a product change (release, server deploy, satori
// experiment flip, remote-config change, incident, content drop, economy
// tweak, marketing campaign) calls this RPC with a small structured
// payload. The Nakama runtime:
//
//   1. Validates the call (HMAC bearer header `x-ivx-svc-token`),
//   2. Mirrors the entry into a Nakama storage object (audit copy that
//      lives even if the AI svc is briefly unavailable), AND
//   3. Forwards it to the AI svc `POST /insights/changelog` endpoint
//      (HMAC-signed via shared secret) where it lands in
//      `game_product_changelog_v1` for the analyst to cite.
//
// Why route through Nakama at all? Single shared secret per service
// keeps the on-device clients out of the cred-rotation loop, and the
// Nakama storage mirror gives us a recovery path if the AI svc DLQ is
// ever drained without replay.
//
// On-call runbook: `docs/webhook-leak-response.md` covers HMAC rotation.

namespace QvProductChangelog {

  export var COLLECTION = "qv_product_changelog";

  export var ALLOWED_KINDS: string[] = [
    "release",
    "server",
    "experiment",
    "config",
    "incident",
    "content",
    "economy",
    "marketing",
  ];

  interface ChangelogPayload {
    game_id: string;
    kind: string;
    title: string;
    description?: string;
    payload?: { [k: string]: any };
    actor?: string;
    source_system: string;
    /** unix-ms epoch when the change took effect (NOT when it was logged) */
    ts_ms?: number;
  }

  function isAllowedKind(k: string): boolean {
    for (var i = 0; i < ALLOWED_KINDS.length; i++) {
      if (ALLOWED_KINDS[i] === k) return true;
    }
    return false;
  }

  function validateBearer(ctx: nkruntime.Context, logger: nkruntime.Logger): boolean {
    var expected = (ctx.env && ctx.env["IVX_PRODUCT_CHANGELOG_TOKEN"]) || "";
    if (!expected) {
      logger.warn("[QvProductChangelog] IVX_PRODUCT_CHANGELOG_TOKEN unset; rejecting all writes");
      return false;
    }
    var hdrs: any = (ctx as any).headers || {};
    var token = hdrs["x-ivx-svc-token"] || hdrs["X-Ivx-Svc-Token"] || "";
    if (typeof token !== "string" || !token) return false;
    // Constant-time-ish equality for short fixed-size tokens.
    if (token.length !== expected.length) return false;
    var diff = 0;
    for (var i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
    }
    return diff === 0;
  }

  function rpcAppend(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    if (!validateBearer(ctx, logger)) {
      return JSON.stringify({ ok: false, error: "unauthorized" });
    }
    var data: ChangelogPayload;
    try {
      data = JSON.parse(payload || "{}");
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: "invalid json" });
    }
    if (!data.game_id || !data.kind || !data.title || !data.source_system) {
      return JSON.stringify({
        ok: false,
        error: "missing required fields: game_id, kind, title, source_system",
      });
    }
    if (!isAllowedKind(data.kind)) {
      return JSON.stringify({
        ok: false,
        error: "kind '" + data.kind + "' not in allow-list",
      });
    }
    var tsMs = (typeof data.ts_ms === "number" && data.ts_ms > 0)
      ? data.ts_ms
      : Date.now();

    // Mirror to Nakama storage (system-owned, write-only). Acts as an
    // audit copy + replay source if the AI svc forward fails.
    var storageKey = pad(tsMs) + "_" + data.game_id + "_" + nk.uuidv4().slice(0, 8);
    try {
      nk.storageWrite([{
        collection: COLLECTION,
        key: storageKey,
        userId: "",
        value: data as any,
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (e: any) {
      logger.warn("[QvProductChangelog] storage mirror failed: " + ((e && e.message) ? e.message : String(e)));
    }

    // Best-effort forward to AI svc. Failures are logged but do NOT fail
    // the RPC — the storage mirror lets us replay later via a small
    // backfill script (Phase 6 DLQ drain).
    try {
      var aiBase = (ctx.env && ctx.env["IVX_AI_SVC_BASE_URL"]) || "";
      if (!aiBase) {
        logger.warn("[QvProductChangelog] IVX_AI_SVC_BASE_URL not set; skipping forward");
      } else {
        var url = aiBase.replace(/\/$/, "") + "/insights/changelog";
        var body = JSON.stringify(data);
        var ts = String(Date.now());
        var sig = computeHmac(ctx, nk, ts, "/insights/changelog", body, logger);
        nk.httpRequest(url, "post", {
          "Content-Type": "application/json",
          "X-IVX-Service": "nakama",
          "X-IVX-Timestamp": ts,
          "X-IVX-Signature": sig,
        }, body, 5000);
      }
    } catch (e: any) {
      logger.warn("[QvProductChangelog] AI svc forward failed: " + ((e && e.message) ? e.message : String(e)));
    }

    return JSON.stringify({ ok: true, storageKey: storageKey, ts_ms: tsMs });
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
      logger.warn("[QvProductChangelog] IVX_INSIGHTS_SHARED_SECRET unset; signature will be empty");
      return "";
    }
    var msg = ts + ":" + path + ":" + body;
    try {
      var raw = nk.hmacSha256Hash(msg, secret);
      // Lowercase hex matches what Node's crypto.createHmac(...).digest('hex')
      // produces, which is what the AI svc HmacAuthGuard verifies against.
      return nk.base16Encode(raw, false).toLowerCase();
    } catch (e: any) {
      logger.warn("[QvProductChangelog] hmac compute failed: " + ((e && e.message) ? e.message : String(e)));
      return "";
    }
  }

  function pad(n: number): string {
    var s = String(n);
    while (s.length < 16) s = "0" + s;
    return s;
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("product_changelog_append", rpcAppend);
  }
}
