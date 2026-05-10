/**
 * UserMgmt Sync — Best-effort propagation of player profile fields from Nakama
 * to the Intelliverse-X-UserManagement service (NestJS).
 *
 * Direction: Nakama RPC → UserMgmt PUT /api/user/user/profile
 *
 * Auth: Caller's Cognito access token (forwarded from Unity via the RPC payload
 * field `_cognito_jwt`). UserMgmt validates the JWT against Cognito, so Nakama
 * never needs UserMgmt admin credentials for this flow.
 *
 * Loop prevention: requests carry `X-Sync-Origin: nakama-rpc`. UserMgmt's
 * profile-update endpoint does not currently push back to Nakama, so this is
 * defence-in-depth — if a future change adds reverse sync, it can short-circuit
 * on this header.
 *
 * Failure model: best-effort. The Nakama write has already succeeded by the
 * time this is called, so we never throw. Errors are logged and surfaced in
 * the RPC response under `userMgmtSync` so Unity can decide whether to warn.
 *
 * Configuration: production defaults are hardcoded so the feature works
 * immediately after a CodeBuild deploy without any env-var wiring. Env vars
 * are optional overrides — once they're set, they win:
 *   USERMGMT_API_BASE_URL   override the hardcoded BASE_URL_DEFAULT
 *   USERMGMT_SYNC_ENABLED   "false" | "0" to disable; anything else (incl.
 *                           unset) keeps it enabled
 */
namespace LegacyUserMgmtSync {

  // ─── Production hardcoded defaults ──────────────────────────────────────────
  // These match Unity's IVXURLs.BaseUrl. Update both places if the public API
  // gateway hostname ever changes.
  var BASE_URL_DEFAULT = "https://api.intelli-verse-x.ai";
  var SYNC_ENABLED_DEFAULT = true;

  export interface SyncResult {
    enabled: boolean;
    skipped?: string;
    success?: boolean;
    statusCode?: number;
    error?: string;
    errorCode?: string;
    syncedFields?: string[];
  }

  /**
   * Maps Nakama profile fields → UserMgmt PUT /api/user/user/profile body.
   * Only fields that exist on the UserMgmt endpoint are forwarded.
   * UserMgmt-unknown fields (avatarUrl, bio, language, country, timezone)
   * are intentionally dropped; avatar uploads happen direct Unity → UserMgmt.
   */
  function buildBody(input: { [key: string]: any }): { [key: string]: any } {
    var body: { [key: string]: any } = {};
    if (input.userName !== undefined) body.userName = input.userName;
    if (input.firstName !== undefined) body.firstName = input.firstName;
    if (input.lastName !== undefined) body.lastName = input.lastName;
    if (input.age !== undefined) body.age = input.age;
    if (input.phoneNumber !== undefined) body.phoneNumber = input.phoneNumber;
    return body;
  }

  function readEnv(key: string): string {
    try {
      if (typeof process !== "undefined" && (process as any).env) {
        var v = (process as any).env[key];
        return typeof v === "string" ? v : "";
      }
    } catch (_) { /* goja sandbox: no process — fall through */ }
    return "";
  }

  function isEnabled(): boolean {
    var v = readEnv("USERMGMT_SYNC_ENABLED");
    if (v === "false" || v === "0") return false;     // explicit disable
    if (v === "true" || v === "1") return true;        // explicit enable
    return SYNC_ENABLED_DEFAULT;                       // unset → use default
  }

  function getBaseUrl(): string {
    var v = readEnv("USERMGMT_API_BASE_URL");
    return (v && v.length > 0 ? v : BASE_URL_DEFAULT).replace(/\/+$/, "");
  }

  /**
   * Forwards a profile update to UserMgmt. Synchronous, single attempt, ~10s
   * Nakama HTTP timeout. Caller MUST already have committed the Nakama write
   * before invoking this — there is no rollback.
   *
   * @param fields  Source fields (Nakama-shape). Pass only what changed.
   * @param jwt     Cognito access token from Unity (the same token Unity
   *                would use to call UserMgmt directly). Empty string → skip.
   */
  export function pushProfile(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    nakamaUserId: string,
    jwt: string,
    fields: { [key: string]: any }
  ): SyncResult {
    if (!isEnabled()) {
      return { enabled: false, skipped: "USERMGMT_SYNC_ENABLED=false" };
    }

    var baseUrl = getBaseUrl();

    if (!jwt) {
      // Old clients don't pass JWT — silently skip rather than failing the RPC.
      return { enabled: true, skipped: "no JWT" };
    }

    var body = buildBody(fields);
    var keys = Object.keys(body);
    if (keys.length === 0) {
      return { enabled: true, skipped: "no syncable fields" };
    }

    var url = baseUrl + "/api/user/user/profile";
    var headers: { [key: string]: string } = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + jwt,
      "X-Sync-Origin": "nakama-rpc"
    };

    var resp: nkruntime.HttpResponse;
    try {
      resp = nk.httpRequest(url, "put", headers, JSON.stringify(body));
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.warn("[UserMgmtSync] network error for " + nakamaUserId + ": " + msg);
      return { enabled: true, success: false, error: msg, errorCode: "NETWORK" };
    }

    if (resp.code >= 200 && resp.code < 300) {
      logger.info("[UserMgmtSync] OK " + resp.code + " for " + nakamaUserId + " fields=" + keys.join(","));
      return { enabled: true, success: true, statusCode: resp.code, syncedFields: keys };
    }

    var errCode = "HTTP_" + resp.code;
    if (resp.code === 401 || resp.code === 403) errCode = "UNAUTHORIZED";
    else if (resp.code === 400 || resp.code === 422) errCode = "VALIDATION";
    else if (resp.code === 409) errCode = "CONFLICT";
    else if (resp.code >= 500) errCode = "USERMGMT_5XX";

    var bodyPreview = (resp.body || "").substring(0, 256);
    logger.warn("[UserMgmtSync] " + errCode + " " + resp.code + " for " + nakamaUserId + ": " + bodyPreview);
    return { enabled: true, success: false, statusCode: resp.code, error: bodyPreview, errorCode: errCode };
  }
}
