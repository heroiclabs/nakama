// lms_bridge.ts
// ─────────────────────────────────────────────────────────────────────────────
// LMS Bridge — Nakama side of the LTI 1.3 / Canvas+Moodle integration.
// See docs/LMS_INTEGRATION_RESEARCH_AND_PLAN.md §5 (architecture), §8 (this
// module's plan) and §13 (standards charter).
//
// Division of labor (plan §5.2)
// -----------------------------
// • The WEB TIER (quizverse.world) owns the LTI endpoints: OIDC login/launch,
//   JWKS, deep-linking picker. It VERIFIES incoming RS256 id_tokens (Goja
//   cannot) and then calls these RPCs with the shared service token.
// • THIS MODULE owns identity mapping (LTI sub → Nakama user), resource-link
//   and platform registries, server-side grading against `quizverse_packs`,
//   the AGS grade queue, and the outbound RS256 client-credentials + score
//   POST (Goja CAN sign via nk.jwtGenerate).
//
// Design notes
// ------------
// • ES5-safe (var / function only) — Goja VM. Style mirrors research.ts.
// • No module-level mutable state (Goja VM pool resets between calls).
// • Registration via `LmsBridge.register(initializer)` from main.ts with
//   STRING-LITERAL registerRpc ids so postbuild.js v2 hoists them.
// • Auth model: every RPC requires payload.service_token ===
//   ctx.env['LMS_BRIDGE_SERVICE_TOKEN']. Admin/ops RPCs (platform_* and
//   grade_push) ALTERNATIVELY accept RpcHelpers.requireAdmin (http_key
//   server-to-server calls pass, as do admin-flagged accounts).
// • LTI private key: multiline PEM values break the docker-compose
//   entrypoint's space-separated --runtime.env flag builder, so the key is
//   stored base64-encoded on ONE line as LTI_TOOL_PRIVATE_KEY_B64 and decoded
//   here with nk.base64Decode + nk.binaryToString. A raw LTI_TOOL_PRIVATE_KEY
//   is honored as fallback if it ever becomes deliverable.
//
// Storage (all SYSTEM-owned, permissionRead/Write = 0 — plan §8.1)
// ----------------------------------------------------------------
//   lms_platforms       key <platform_id>          issuer/client_id/URLs/deployments/kind
//   lms_resource_links  key rl_<sha256 of platform:deployment:resource_link>  pack binding + line item
//   lms_user_links      key ul_<sha256 of platform:sub>                       sub → nakama user
//   lms_attempt_results key <rl key>:<sub hash>                               graded attempts + sync status
//   lms_grade_queue     key grade_<unix>_<rand>                               pending AGS score posts
//   lms_import_jobs     key imp_<unix>_<rand>                                 import fidelity reports
//
// RPCs registered (9)
//   lms_platform_upsert    admin/service: register a Canvas/Moodle platform
//   lms_platform_list      admin/service: list registered platforms
//   lms_platform_delete    admin/service: remove a platform
//   lms_launch_session     service: validated launch claims → user + session token
//   lms_deeplink_bind      service: bind pack_id (+scoreMaximum) to a resource link
//   lms_attempt_complete   service: grade answers vs quizverse_packs, queue AGS post
//   lms_grade_push         admin/service worker: drain queue → token → POST /scores
//   lms_import_pack        service: pre-parsed LMS questions → quizverse_packs + fidelity report
//   lms_link_status        service: binding + last grade-sync status for a resource link

namespace LmsBridge {

  // ── Collections ────────────────────────────────────────────────────────────
  var COLLECTION_PLATFORMS = "lms_platforms";
  var COLLECTION_RESOURCE_LINKS = "lms_resource_links";
  var COLLECTION_USER_LINKS = "lms_user_links";
  var COLLECTION_ATTEMPT_RESULTS = "lms_attempt_results";
  var COLLECTION_GRADE_QUEUE = "lms_grade_queue";
  var COLLECTION_IMPORT_JOBS = "lms_import_jobs";
  var COLLECTION_PACKS = "quizverse_packs";       // shared with QuizVersePackStore

  export var MODULE_VERSION = "lms-bridge/1.0.0";

  var ENV_SERVICE_TOKEN = "LMS_BRIDGE_SERVICE_TOKEN";
  var ENV_PRIVATE_KEY_B64 = "LTI_TOOL_PRIVATE_KEY_B64";
  var ENV_PRIVATE_KEY_RAW = "LTI_TOOL_PRIVATE_KEY";  // fallback (raw PEM)
  var ENV_KID = "LTI_TOOL_KID";

  var USER_AGENT = "QuizVerse-LMS-Bridge/1.0";
  var AGS_SCORE_SCOPE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";
  var CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
  var SCORE_CONTENT_TYPE = "application/vnd.ims.lis.v1.score+json";

  var MAX_GRADE_ATTEMPTS = 5;       // then status → dead
  var GRADE_PUSH_DEFAULT_BATCH = 5; // rows per worker invocation
  var GRADE_BACKOFF_BASE_SEC = 60;  // 60s * 2^(attempts-1), capped
  var GRADE_BACKOFF_CAP_SEC = 3600;
  var QUEUE_SCAN_PAGE = 100;
  var QUEUE_SCAN_MAX = 1000;
  var HTTP_TIMEOUT_MS = 10000;

  var VALID_KINDS: { [k: string]: boolean } = { canvas: true, moodle: true };

  // ── Small helpers ───────────────────────────────────────────────────────────
  function nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  function randSuffix(): string {
    return Math.random().toString(36).slice(2, 8);
  }

  function str(v: any): string {
    return (v === null || v === undefined) ? "" : ("" + v);
  }

  function errMsg(err: any): string {
    return (err && err.message) ? String(err.message) : String(err);
  }

  function isServiceCaller(ctx: nkruntime.Context, data: any): boolean {
    var token = data && data.service_token;
    if (!token) return false;
    var expected = str(ctx.env && ctx.env[ENV_SERVICE_TOKEN]);
    return expected.length > 0 && token === expected;
  }

  // Strict gate: service token only (launch / attempt / import / bind / status).
  function requireService(ctx: nkruntime.Context, data: any): string | null {
    if (isServiceCaller(ctx, data)) return null;
    return RpcHelpers.errorResponse("service token required", 403);
  }

  // Ops gate: service token OR admin (http_key server-to-server passes
  // requireAdmin — platform management + queue worker).
  function requireServiceOrAdmin(ctx: nkruntime.Context, nk: nkruntime.Nakama, data: any): string | null {
    if (isServiceCaller(ctx, data)) return null;
    try {
      RpcHelpers.requireAdmin(ctx, nk);
      return null;
    } catch (_e: any) {
      return RpcHelpers.errorResponse("admin or service token required", 403);
    }
  }

  function sha(nk: nkruntime.Nakama, input: string): string {
    try {
      return nk.sha256Hash(input);
    } catch (_e: any) {
      return input;
    }
  }

  function resourceLinkKey(nk: nkruntime.Nakama, platformId: string, deploymentId: string, resourceLinkId: string): string {
    return "rl_" + sha(nk, platformId + ":" + deploymentId + ":" + resourceLinkId).slice(0, 40);
  }

  function userLinkKey(nk: nkruntime.Nakama, platformId: string, sub: string): string {
    return "ul_" + sha(nk, platformId + ":" + sub).slice(0, 40);
  }

  function attemptResultKey(nk: nkruntime.Nakama, rlKey: string, sub: string): string {
    return rlKey + ":" + sha(nk, sub).slice(0, 16);
  }

  function readSys(nk: nkruntime.Nakama, collection: string, key: string): any {
    var rows: nkruntime.StorageObject[] = [];
    try {
      rows = nk.storageRead([{ collection: collection, key: key, userId: Constants.SYSTEM_USER_ID }]);
    } catch (_e: any) {
      rows = [];
    }
    if (rows && rows.length > 0 && rows[0].value) return rows[0].value;
    return null;
  }

  function writeSys(nk: nkruntime.Nakama, collection: string, key: string, value: any): void {
    nk.storageWrite([{
      collection: collection,
      key: key,
      userId: Constants.SYSTEM_USER_ID,
      value: value,
      permissionRead: 0,
      permissionWrite: 0
    }]);
  }

  function scanSys(nk: nkruntime.Nakama, collection: string, onRow: (key: string, value: any) => boolean | void): number {
    var cursor = "";
    var scanned = 0;
    for (var page = 0; page < (QUEUE_SCAN_MAX / QUEUE_SCAN_PAGE) + 1; page++) {
      var res: nkruntime.StorageObjectList;
      try {
        res = nk.storageList(Constants.SYSTEM_USER_ID, collection, QUEUE_SCAN_PAGE, cursor);
      } catch (_e: any) {
        break;
      }
      var objs = (res && res.objects) ? res.objects : [];
      for (var i = 0; i < objs.length; i++) {
        if (objs[i] && objs[i].value) {
          scanned++;
          var stop = onRow(objs[i].key, objs[i].value);
          if (stop === true || scanned >= QUEUE_SCAN_MAX) return scanned;
        }
      }
      cursor = str(res && res.cursor);
      if (!cursor || objs.length === 0) break;
    }
    return scanned;
  }

  // Resolve the RS256 signing key. Preferred: base64 single-line env var
  // (multiline PEM cannot survive the compose entrypoint's flag builder).
  function resolvePrivateKeyPem(ctx: nkruntime.Context, nk: nkruntime.Nakama): string {
    var b64 = str(ctx.env && ctx.env[ENV_PRIVATE_KEY_B64]);
    if (b64) {
      try {
        return nk.binaryToString(nk.base64Decode(b64));
      } catch (e: any) {
        throw new Error("LTI_TOOL_PRIVATE_KEY_B64 present but not decodable: " + errMsg(e));
      }
    }
    var raw = str(ctx.env && ctx.env[ENV_PRIVATE_KEY_RAW]);
    if (raw) return raw;
    throw new Error("no LTI tool private key configured (LTI_TOOL_PRIVATE_KEY_B64)");
  }

  // line_item_url may already carry query params (Moodle does this):
  // insert /scores BEFORE the query string per AGS spec.
  function scoresUrl(lineItemUrl: string): string {
    var qIdx = lineItemUrl.indexOf("?");
    if (qIdx < 0) return lineItemUrl + "/scores";
    return lineItemUrl.slice(0, qIdx) + "/scores" + lineItemUrl.slice(qIdx);
  }

  function formEncode(fields: { [k: string]: string }): string {
    var parts: string[] = [];
    for (var k in fields) {
      if (fields.hasOwnProperty(k)) {
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(fields[k]));
      }
    }
    return parts.join("&");
  }

  function round2(x: number): number {
    return Math.round(x * 100) / 100;
  }

  // ── Platform admin RPCs ─────────────────────────────────────────────────────
  // lms_platform_upsert
  //   { service_token?, platform_id, issuer, client_id, auth_url, token_url,
  //     jwks_url, deployment_ids[], kind: "canvas"|"moodle" }
  function rpcPlatformUpsert(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gateErr = requireServiceOrAdmin(ctx, nk, data);
      if (gateErr) return gateErr;

      var check = RpcHelpers.validatePayload(data, ["platform_id", "issuer", "client_id", "token_url", "kind"]);
      if (!check.valid) return RpcHelpers.errorResponse("missing fields: " + check.missing.join(", "), 400);

      var kind = str(data.kind).toLowerCase();
      if (!VALID_KINDS[kind]) return RpcHelpers.errorResponse("kind must be canvas|moodle", 400);

      var platformId = str(data.platform_id);
      if (!platformId || platformId.length > 128) return RpcHelpers.errorResponse("invalid platform_id", 400);

      var deployments: string[] = [];
      var rawDeps = data.deployment_ids;
      if (rawDeps && rawDeps.length) {
        for (var i = 0; i < rawDeps.length; i++) {
          var d = str(rawDeps[i]);
          if (d && deployments.indexOf(d) < 0) deployments.push(d);
        }
      }

      var existing = readSys(nk, COLLECTION_PLATFORMS, platformId) || {};
      var row = {
        platform_id: platformId,
        issuer: str(data.issuer),
        client_id: str(data.client_id),
        auth_url: str(data.auth_url || existing.auth_url),
        token_url: str(data.token_url),
        jwks_url: str(data.jwks_url || existing.jwks_url),
        deployment_ids: deployments.length > 0 ? deployments : (existing.deployment_ids || []),
        kind: kind,
        created_unix: existing.created_unix || nowSec(),
        updated_unix: nowSec()
      };
      writeSys(nk, COLLECTION_PLATFORMS, platformId, row);
      logger.info("[LmsBridge] platform upserted: %s (%s)", platformId, kind);
      return RpcHelpers.successResponse({ platform: row });
    } catch (err: any) {
      logger.error("lms_platform_upsert failed: " + errMsg(err));
      return RpcHelpers.errorResponse("internal error: " + errMsg(err), 500);
    }
  }

  // lms_platform_list — { service_token? }
  function rpcPlatformList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gateErr = requireServiceOrAdmin(ctx, nk, data);
      if (gateErr) return gateErr;

      var platforms: any[] = [];
      scanSys(nk, COLLECTION_PLATFORMS, function (_key: string, value: any) {
        platforms.push(value);
      });
      return RpcHelpers.successResponse({ count: platforms.length, platforms: platforms });
    } catch (err: any) {
      logger.error("lms_platform_list failed: " + errMsg(err));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // lms_platform_delete — { service_token?, platform_id }
  function rpcPlatformDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gateErr = requireServiceOrAdmin(ctx, nk, data);
      if (gateErr) return gateErr;

      var platformId = str(data.platform_id);
      if (!platformId) return RpcHelpers.errorResponse("platform_id required", 400);
      var existing = readSys(nk, COLLECTION_PLATFORMS, platformId);
      if (!existing) return RpcHelpers.errorResponse("platform not found: " + platformId, 404);

      nk.storageDelete([{ collection: COLLECTION_PLATFORMS, key: platformId, userId: Constants.SYSTEM_USER_ID }]);
      logger.info("[LmsBridge] platform deleted: %s", platformId);
      return RpcHelpers.successResponse({ deleted: platformId });
    } catch (err: any) {
      logger.error("lms_platform_delete failed: " + errMsg(err));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── Launch session ──────────────────────────────────────────────────────────
  // lms_launch_session (web tier posts VALIDATED launch claims — plan §8.2)
  //   { service_token, platform_id, deployment_id, sub, name?, email?, roles[],
  //     context{id,title}, resource_link{id,title}, line_item_url?, score_maximum? }
  //   → { user_id, session_token, expires_unix, pack_id|null, resource_link_key }
  function rpcLaunchSession(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gateErr = requireService(ctx, data);
      if (gateErr) return gateErr;

      var check = RpcHelpers.validatePayload(data, ["platform_id", "deployment_id", "sub", "resource_link"]);
      if (!check.valid) return RpcHelpers.errorResponse("missing fields: " + check.missing.join(", "), 400);

      var platformId = str(data.platform_id);
      var deploymentId = str(data.deployment_id);
      var sub = str(data.sub);
      var resourceLink = data.resource_link || {};
      var resourceLinkId = str(resourceLink.id);
      if (!sub) return RpcHelpers.errorResponse("sub required (anonymous launches are handled web-side as ungraded preview)", 400);
      if (!resourceLinkId) return RpcHelpers.errorResponse("resource_link.id required", 400);

      // Deployment allowlist (charter §13.4.10): unknown platform/deployment
      // pairs are rejected, never auto-provisioned.
      var platform = readSys(nk, COLLECTION_PLATFORMS, platformId);
      if (!platform) return RpcHelpers.errorResponse("unknown platform: " + platformId, 404);
      var deps: string[] = platform.deployment_ids || [];
      if (deps.indexOf(deploymentId) < 0) {
        return RpcHelpers.errorResponse("deployment not registered for platform: " + deploymentId, 403);
      }

      // Find-or-create the Nakama user. Custom-auth id = "lms:" + first 32 hex
      // of sha256(issuer|deployment|sub) → 36 chars, within Nakama's 6..128
      // custom-id budget, no spaces/control chars.
      var customId = "lms:" + sha(nk, str(platform.issuer) + "|" + deploymentId + "|" + sub).slice(0, 32);
      var auth = nk.authenticateCustom(customId, undefined, true);
      var userId = auth.userId;

      // Persist user link (privacy: only what the platform granted us).
      var ulKey = userLinkKey(nk, platformId, sub);
      var existingUl = readSys(nk, COLLECTION_USER_LINKS, ulKey) || {};
      writeSys(nk, COLLECTION_USER_LINKS, ulKey, {
        platform_id: platformId,
        sub: sub,
        user_id: userId,
        custom_id: customId,
        roles: data.roles || [],
        name: str(data.name || existingUl.name),
        email: str(data.email || existingUl.email),
        created_unix: existingUl.created_unix || nowSec(),
        updated_unix: nowSec()
      });

      // Persist / refresh the resource link row. A deep-link bind may already
      // exist (pack binding wins); the launch fills in the AGS line item.
      var rlKey = resourceLinkKey(nk, platformId, deploymentId, resourceLinkId);
      var existingRl = readSys(nk, COLLECTION_RESOURCE_LINKS, rlKey) || {};
      // Field-wise merge so a relaunch with a partial context claim (e.g. id
      // only) never blanks a previously stored title.
      var incomingCtx = data.context || {};
      var existingCtx = existingRl.context || {};
      var contextObj = {
        id: str(incomingCtx.id || existingCtx.id),
        title: str(incomingCtx.title || existingCtx.title)
      };
      var rlRow = {
        platform_id: platformId,
        deployment_id: deploymentId,
        resource_link_id: resourceLinkId,
        resource_link_title: str((resourceLink && resourceLink.title) || existingRl.resource_link_title),
        pack_id: str(existingRl.pack_id || ""),
        line_item_url: str(data.line_item_url || existingRl.line_item_url),
        score_maximum: (data.score_maximum !== undefined && data.score_maximum !== null)
          ? parseFloat("" + data.score_maximum)
          : (existingRl.score_maximum || null),
        context: { id: str(contextObj.id), title: str(contextObj.title) },
        last_sync: existingRl.last_sync || null,
        created_unix: existingRl.created_unix || nowSec(),
        updated_unix: nowSec()
      };
      writeSys(nk, COLLECTION_RESOURCE_LINKS, rlKey, rlRow);

      var tokenRes = nk.authenticateTokenGenerate(userId);
      logger.info("[LmsBridge] launch session for sub=%s → user=%s (rl=%s)", sub, userId, rlKey);
      return RpcHelpers.successResponse({
        user_id: userId,
        session_token: tokenRes.token,
        expires_unix: tokenRes.exp,
        pack_id: rlRow.pack_id || null,
        resource_link_key: rlKey
      });
    } catch (err: any) {
      logger.error("lms_launch_session failed: " + errMsg(err));
      return RpcHelpers.errorResponse("internal error: " + errMsg(err), 500);
    }
  }

  // ── Deep-link bind ──────────────────────────────────────────────────────────
  // lms_deeplink_bind — creates/updates the resource-link row (may run BEFORE
  // the first launch, at DeepLinkingResponse time).
  //   { service_token, platform_id, deployment_id, resource_link_id, pack_id,
  //     score_maximum?, line_item_url?, title?, context? }
  function rpcDeeplinkBind(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gateErr = requireService(ctx, data);
      if (gateErr) return gateErr;

      var check = RpcHelpers.validatePayload(data, ["platform_id", "deployment_id", "resource_link_id", "pack_id"]);
      if (!check.valid) return RpcHelpers.errorResponse("missing fields: " + check.missing.join(", "), 400);

      var platformId = str(data.platform_id);
      var packId = str(data.pack_id);

      var platform = readSys(nk, COLLECTION_PLATFORMS, platformId);
      if (!platform) return RpcHelpers.errorResponse("unknown platform: " + platformId, 404);

      // The pack must exist before a teacher can bind it to an assignment.
      var pack = readSys(nk, COLLECTION_PACKS, packId);
      if (!pack || !pack.questions || pack.questions.length === 0) {
        return RpcHelpers.errorResponse("pack not found: " + packId, 404);
      }

      var rlKey = resourceLinkKey(nk, platformId, str(data.deployment_id), str(data.resource_link_id));
      var existing = readSys(nk, COLLECTION_RESOURCE_LINKS, rlKey) || {};
      var contextObj = data.context || existing.context || {};
      var row = {
        platform_id: platformId,
        deployment_id: str(data.deployment_id),
        resource_link_id: str(data.resource_link_id),
        resource_link_title: str(data.title || existing.resource_link_title),
        pack_id: packId,
        line_item_url: str(data.line_item_url || existing.line_item_url),
        score_maximum: (data.score_maximum !== undefined && data.score_maximum !== null)
          ? parseFloat("" + data.score_maximum)
          : (existing.score_maximum || null),
        context: { id: str(contextObj.id), title: str(contextObj.title) },
        last_sync: existing.last_sync || null,
        created_unix: existing.created_unix || nowSec(),
        updated_unix: nowSec()
      };
      writeSys(nk, COLLECTION_RESOURCE_LINKS, rlKey, row);
      logger.info("[LmsBridge] deeplink bind: pack=%s → rl=%s", packId, rlKey);
      return RpcHelpers.successResponse({ resource_link_key: rlKey, binding: row });
    } catch (err: any) {
      logger.error("lms_deeplink_bind failed: " + errMsg(err));
      return RpcHelpers.errorResponse("internal error: " + errMsg(err), 500);
    }
  }

  // ── Attempt completion + grading ────────────────────────────────────────────
  // lms_attempt_complete — grade server-side against quizverse_packs, persist
  // the result, enqueue the AGS score post.
  //   { service_token, platform_id, deployment_id, resource_link_id, sub,
  //     pack_id, answers[{question_id, selected_index, latency_ms?}] }
  function rpcAttemptComplete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gateErr = requireService(ctx, data);
      if (gateErr) return gateErr;

      var check = RpcHelpers.validatePayload(data, ["platform_id", "deployment_id", "resource_link_id", "sub", "pack_id", "answers"]);
      if (!check.valid) return RpcHelpers.errorResponse("missing fields: " + check.missing.join(", "), 400);

      var platformId = str(data.platform_id);
      var deploymentId = str(data.deployment_id);
      var resourceLinkId = str(data.resource_link_id);
      var sub = str(data.sub);
      var packId = str(data.pack_id);
      var answers = data.answers || [];
      if (!answers.length) return RpcHelpers.errorResponse("answers must be a non-empty array", 400);

      var rlKey = resourceLinkKey(nk, platformId, deploymentId, resourceLinkId);
      var rl = readSys(nk, COLLECTION_RESOURCE_LINKS, rlKey);
      if (!rl) return RpcHelpers.errorResponse("resource link not found (bind or launch first): " + resourceLinkId, 404);
      if (rl.pack_id && rl.pack_id !== packId) {
        return RpcHelpers.errorResponse("pack_id mismatch: resource link is bound to " + rl.pack_id, 400);
      }

      var pack = readSys(nk, COLLECTION_PACKS, packId);
      if (!pack || !pack.questions || pack.questions.length === 0) {
        return RpcHelpers.errorResponse("pack not found: " + packId, 404);
      }

      // Index answers by question_id (last answer wins on duplicates).
      var answerByQ: { [qid: string]: any } = {};
      for (var a = 0; a < answers.length; a++) {
        var qid = str(answers[a] && answers[a].question_id);
        if (qid) answerByQ[qid] = answers[a];
      }

      // Grade over ALL pack questions — unanswered counts as wrong.
      var total = pack.questions.length;
      var correct = 0;
      var perQuestion: any[] = [];
      for (var i = 0; i < total; i++) {
        var q = pack.questions[i];
        var ans = answerByQ[str(q.question_id)];
        var selected = (ans && ans.selected_index !== undefined && ans.selected_index !== null)
          ? parseInt("" + ans.selected_index, 10) : -1;
        var isCorrect = (selected === q.correct_index);
        if (isCorrect) correct++;
        perQuestion.push({
          question_id: q.question_id,
          selected_index: selected,
          correct_index: q.correct_index,
          correct: isCorrect,
          latency_ms: (ans && ans.latency_ms !== undefined) ? ans.latency_ms : null
        });
      }

      var scoreMaximum = (rl.score_maximum !== undefined && rl.score_maximum !== null)
        ? parseFloat("" + rl.score_maximum) : 100;
      if (isNaN(scoreMaximum) || scoreMaximum <= 0) scoreMaximum = 100;
      var scoreGiven = round2((correct / total) * scoreMaximum);

      // Persist the graded attempt (keyed per resource link + sub).
      var resultKey = attemptResultKey(nk, rlKey, sub);
      var resultRow = {
        platform_id: platformId,
        resource_link_key: rlKey,
        sub: sub,
        pack_id: packId,
        correct: correct,
        total: total,
        score_given: scoreGiven,
        score_maximum: scoreMaximum,
        per_question: perQuestion,
        graded_unix: nowSec(),
        sync_status: "not_queued",
        sync_detail: null as any
      };

      // Enqueue the AGS post (only possible when a line item is known).
      var queueKey: string | null = null;
      var lineItemUrl = str(data.line_item_url || rl.line_item_url);
      if (lineItemUrl) {
        queueKey = "grade_" + nowSec() + "_" + randSuffix();
        writeSys(nk, COLLECTION_GRADE_QUEUE, queueKey, {
          platform_id: platformId,
          sub: sub,
          line_item_url: lineItemUrl,
          score_given: scoreGiven,
          score_maximum: scoreMaximum,
          resource_link_key: rlKey,
          result_key: resultKey,
          status: "pending",
          attempts: 0,
          next_retry_unix: 0,
          last_error: null as any,
          created_unix: nowSec(),
          updated_unix: nowSec()
        });
        resultRow.sync_status = "queued";
        resultRow.sync_detail = { queue_key: queueKey };
      }
      writeSys(nk, COLLECTION_ATTEMPT_RESULTS, resultKey, resultRow);

      logger.info("[LmsBridge] attempt graded: rl=%s sub=%s %s/%s → %s/%s (queued=%s)",
        rlKey, sub, str(correct), str(total), str(scoreGiven), str(scoreMaximum), queueKey ? "yes" : "no");
      return RpcHelpers.successResponse({
        score_given: scoreGiven,
        score_maximum: scoreMaximum,
        correct: correct,
        total: total,
        per_question: perQuestion,
        grade_queued: queueKey !== null,
        queue_key: queueKey,
        result_key: resultKey
      });
    } catch (err: any) {
      logger.error("lms_attempt_complete failed: " + errMsg(err));
      return RpcHelpers.errorResponse("internal error: " + errMsg(err), 500);
    }
  }

  // ── AGS grade push worker ───────────────────────────────────────────────────
  // One queue row → token endpoint (client_credentials + RS256 assertion) →
  // POST <line_item>/scores. Returns {ok, stage, detail}.
  function pushOneGrade(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, row: any): { ok: boolean; stage: string; detail: string } {
    var platform = readSys(nk, COLLECTION_PLATFORMS, str(row.platform_id));
    if (!platform) return { ok: false, stage: "platform", detail: "platform not found: " + str(row.platform_id) };

    var pem = resolvePrivateKeyPem(ctx, nk); // throws if unconfigured

    // RS256 client assertion (SEC §4.1.1). nk.jwtGenerate claims are FLAT
    // key → string|number|boolean, which covers iss/sub/aud/iat/exp/jti.
    var now = nowSec();
    var assertion = nk.jwtGenerate("RS256", pem, {
      iss: str(platform.client_id),
      sub: str(platform.client_id),
      aud: str(platform.token_url),
      iat: now,
      exp: now + 300,
      jti: nk.uuidv4()
    });

    var tokenBody = formEncode({
      grant_type: "client_credentials",
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: assertion,
      scope: AGS_SCORE_SCOPE
    });

    var tokenRes: nkruntime.HttpResponse;
    try {
      tokenRes = nk.httpRequest(str(platform.token_url), "post", {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT
      }, tokenBody, HTTP_TIMEOUT_MS);
    } catch (e: any) {
      return { ok: false, stage: "token", detail: "token request failed: " + errMsg(e) };
    }
    if (tokenRes.code < 200 || tokenRes.code >= 300) {
      return { ok: false, stage: "token", detail: "token endpoint HTTP " + tokenRes.code + ": " + str(tokenRes.body).slice(0, 200) };
    }

    var accessToken = "";
    try {
      var tokenJson = JSON.parse(tokenRes.body);
      accessToken = str(tokenJson.access_token);
    } catch (_e: any) { /* fall through */ }
    if (!accessToken) return { ok: false, stage: "token", detail: "no access_token in token response" };

    // AGS score POST (AGS §3.4). gradingProgress=FullyGraded — server-side
    // grading is final at enqueue time.
    var scorePayload = JSON.stringify({
      userId: str(row.sub),
      scoreGiven: row.score_given,
      scoreMaximum: row.score_maximum,
      timestamp: new Date().toISOString(),
      activityProgress: "Completed",
      gradingProgress: "FullyGraded"
    });

    var postUrl = scoresUrl(str(row.line_item_url));
    var scoreRes: nkruntime.HttpResponse;
    try {
      scoreRes = nk.httpRequest(postUrl, "post", {
        "Content-Type": SCORE_CONTENT_TYPE,
        "Authorization": "Bearer " + accessToken,
        "User-Agent": USER_AGENT
      }, scorePayload, HTTP_TIMEOUT_MS);
    } catch (e: any) {
      return { ok: false, stage: "score", detail: "score POST failed: " + errMsg(e) };
    }
    if (scoreRes.code < 200 || scoreRes.code >= 300) {
      return { ok: false, stage: "score", detail: "scores endpoint HTTP " + scoreRes.code + ": " + str(scoreRes.body).slice(0, 200) };
    }
    return { ok: true, stage: "done", detail: "HTTP " + scoreRes.code + " → " + postUrl };
  }

  function stampResultSync(nk: nkruntime.Nakama, resultKey: string, status: string, detail: any): void {
    if (!resultKey) return;
    var row = readSys(nk, COLLECTION_ATTEMPT_RESULTS, resultKey);
    if (!row) return;
    row.sync_status = status;
    row.sync_detail = detail;
    try { writeSys(nk, COLLECTION_ATTEMPT_RESULTS, resultKey, row); } catch (_e: any) { /* non-fatal */ }
  }

  // lms_grade_push — worker RPC (scheduler / web cron / manual ops).
  //   { service_token?, limit?, force? }
  //   force=true ignores next_retry_unix backoff (ops re-drive).
  // Sequential posting on purpose: Canvas throttling penalizes parallel calls
  // (plan §3.7); Moodle has no rate limiter but we stay polite.
  function rpcGradePush(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gateErr = requireServiceOrAdmin(ctx, nk, data);
      if (gateErr) return gateErr;

      var limit = parseInt("" + (data.limit || GRADE_PUSH_DEFAULT_BATCH), 10);
      if (isNaN(limit) || limit < 1) limit = GRADE_PUSH_DEFAULT_BATCH;
      if (limit > 25) limit = 25;
      var force = data.force === true;
      var now = nowSec();

      // Collect due pending rows (oldest first).
      var due: { key: string; value: any }[] = [];
      scanSys(nk, COLLECTION_GRADE_QUEUE, function (key: string, value: any) {
        if (value.status !== "pending") return;
        if (!force && value.next_retry_unix && value.next_retry_unix > now) return;
        due.push({ key: key, value: value });
      });
      due.sort(function (x, y) { return (x.value.created_unix || 0) - (y.value.created_unix || 0); });
      if (due.length > limit) due = due.slice(0, limit);

      var sent = 0, failed = 0, dead = 0;
      var details: any[] = [];
      for (var i = 0; i < due.length; i++) {
        var key = due[i].key;
        var row = due[i].value;
        var outcome: { ok: boolean; stage: string; detail: string };
        try {
          outcome = pushOneGrade(ctx, logger, nk, row);
        } catch (e: any) {
          outcome = { ok: false, stage: "internal", detail: errMsg(e) };
        }

        row.attempts = (row.attempts || 0) + 1;
        row.updated_unix = nowSec();
        if (outcome.ok) {
          row.status = "sent";
          row.sent_unix = nowSec();
          row.last_error = null;
          sent++;
          stampResultSync(nk, str(row.result_key), "synced", { unix: nowSec(), detail: outcome.detail });
        } else {
          row.last_error = outcome.stage + ": " + outcome.detail;
          if (row.attempts >= MAX_GRADE_ATTEMPTS) {
            row.status = "dead";
            dead++;
            stampResultSync(nk, str(row.result_key), "sync_dead", { unix: nowSec(), error: row.last_error });
          } else {
            var backoff = GRADE_BACKOFF_BASE_SEC * Math.pow(2, row.attempts - 1);
            if (backoff > GRADE_BACKOFF_CAP_SEC) backoff = GRADE_BACKOFF_CAP_SEC;
            row.next_retry_unix = nowSec() + backoff;
            failed++;
            stampResultSync(nk, str(row.result_key), "sync_retrying", { unix: nowSec(), error: row.last_error, next_retry_unix: row.next_retry_unix });
          }
        }
        writeSys(nk, COLLECTION_GRADE_QUEUE, key, row);
        details.push({ queue_key: key, ok: outcome.ok, stage: outcome.stage, detail: outcome.detail, attempts: row.attempts, status: row.status });
        logger.info("[LmsBridge] grade push %s: %s (%s)", key, outcome.ok ? "OK" : "FAIL", outcome.detail);
      }

      return RpcHelpers.successResponse({ processed: due.length, sent: sent, failed: failed, dead: dead, details: details });
    } catch (err: any) {
      logger.error("lms_grade_push failed: " + errMsg(err));
      return RpcHelpers.errorResponse("internal error: " + errMsg(err), 500);
    }
  }

  // ── Content import ──────────────────────────────────────────────────────────
  // lms_import_pack — pre-parsed (web tier owns XML) questions → quizverse_packs.
  //   { service_token, pack_id, title, questions[IQuestion-shape],
  //     source{platform, format, course_id?, quiz_id?} }
  // Every import produces a fidelity report (charter §13.2 — no silent loss).
  function rpcImportPack(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gateErr = requireService(ctx, data);
      if (gateErr) return gateErr;

      var check = RpcHelpers.validatePayload(data, ["pack_id", "title", "questions", "source"]);
      if (!check.valid) return RpcHelpers.errorResponse("missing fields: " + check.missing.join(", "), 400);

      var packId = str(data.pack_id);
      if (!packId || packId.length > 128) return RpcHelpers.errorResponse("invalid pack_id", 400);
      var rawQuestions = data.questions || [];
      if (!rawQuestions.length) return RpcHelpers.errorResponse("questions must be a non-empty array", 400);

      var imported: any[] = [];
      var skipped: { index: number; reason: string }[] = [];
      for (var i = 0; i < rawQuestions.length; i++) {
        var q = rawQuestions[i] || {};
        var text = str(q.text);
        var options = q.options || [];
        var correctIndex = parseInt("" + q.correct_index, 10);
        if (!text) { skipped.push({ index: i, reason: "empty question text" }); continue; }
        if (!options.length || options.length < 2) { skipped.push({ index: i, reason: "needs >= 2 options (got " + options.length + ")" }); continue; }
        if (isNaN(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
          skipped.push({ index: i, reason: "correct_index out of range: " + str(q.correct_index) });
          continue;
        }
        var opts: string[] = [];
        for (var o = 0; o < options.length; o++) opts.push(str(options[o]));
        var item: any = {
          question_id: str(q.question_id) || (packId + "_q" + (i + 1)),
          text: text,
          options: opts,
          correct_index: correctIndex
        };
        if (q.image_url) item.image_url = str(q.image_url);
        if (q.explanation) item.explanation = str(q.explanation);
        if (q.category) item.category = str(q.category);
        if (q.difficulty !== undefined && q.difficulty !== null) item.difficulty = q.difficulty;
        imported.push(item);
      }

      if (imported.length === 0) {
        return RpcHelpers.errorResponse("no importable questions (all " + rawQuestions.length + " skipped)", 400);
      }

      var source = data.source || {};
      var lmsSource = {
        platform: str(source.platform),
        format: str(source.format),
        course_id: str(source.course_id),
        quiz_id: str(source.quiz_id),
        imported_at: new Date().toISOString()
      };

      // Same shape + permissions as QuizVersePackStore.writePack (public read,
      // admin-only write). title/lms_source ride along as provenance.
      var pack = {
        pack_id: packId,
        title: str(data.title),
        questions: imported,
        revision: 1,
        lms_source: lmsSource
      };
      // System-owned like QuizVersePackStore.writePack. NB: the JS runtime
      // rejects userId:"" on writes — the zero UUID is the valid spelling of
      // "system user" here and matches how readPack resolves the row.
      nk.storageWrite([{
        collection: COLLECTION_PACKS,
        key: packId,
        userId: Constants.SYSTEM_USER_ID,
        value: pack as any,
        permissionRead: 2,
        permissionWrite: 0
      }]);

      var report = {
        pack_id: packId,
        title: str(data.title),
        imported_count: imported.length,
        skipped: skipped,
        total_received: rawQuestions.length,
        source: lmsSource
      };
      var jobKey = "imp_" + nowSec() + "_" + randSuffix();
      writeSys(nk, COLLECTION_IMPORT_JOBS, jobKey, {
        job_key: jobKey,
        status: "completed",
        report: report,
        created_unix: nowSec()
      });

      logger.info("[LmsBridge] pack imported: %s (%s ok / %s skipped)", packId, str(imported.length), str(skipped.length));
      return RpcHelpers.successResponse({ job_key: jobKey, report: report });
    } catch (err: any) {
      logger.error("lms_import_pack failed: " + errMsg(err));
      return RpcHelpers.errorResponse("internal error: " + errMsg(err), 500);
    }
  }

  // ── Link status ─────────────────────────────────────────────────────────────
  // lms_link_status — binding + last grade-sync status for the student/teacher UI.
  //   { service_token, platform_id, deployment_id, resource_link_id, sub? }
  function rpcLinkStatus(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gateErr = requireService(ctx, data);
      if (gateErr) return gateErr;

      var check = RpcHelpers.validatePayload(data, ["platform_id", "deployment_id", "resource_link_id"]);
      if (!check.valid) return RpcHelpers.errorResponse("missing fields: " + check.missing.join(", "), 400);

      var rlKey = resourceLinkKey(nk, str(data.platform_id), str(data.deployment_id), str(data.resource_link_id));
      var rl = readSys(nk, COLLECTION_RESOURCE_LINKS, rlKey);
      if (!rl) return RpcHelpers.errorResponse("resource link not found", 404);

      var result: any = null;
      var sub = str(data.sub);
      if (sub) {
        var full = readSys(nk, COLLECTION_ATTEMPT_RESULTS, attemptResultKey(nk, rlKey, sub));
        if (full) {
          // Trim per_question — the status chip only needs the sync state.
          result = {
            pack_id: full.pack_id,
            correct: full.correct,
            total: full.total,
            score_given: full.score_given,
            score_maximum: full.score_maximum,
            graded_unix: full.graded_unix,
            sync_status: full.sync_status,
            sync_detail: full.sync_detail
          };
        }
      }

      return RpcHelpers.successResponse({
        resource_link_key: rlKey,
        binding: {
          pack_id: rl.pack_id || null,
          line_item_url: rl.line_item_url || null,
          score_maximum: rl.score_maximum || null,
          context: rl.context || null,
          resource_link_title: rl.resource_link_title || null
        },
        result: result
      });
    } catch (err: any) {
      logger.error("lms_link_status failed: " + errMsg(err));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── Registration ────────────────────────────────────────────────────────────
  // STRING-LITERAL ids only (postbuild.js v2 hoists literal registerRpc calls).
  // Single-arg register() so postbuild's autoInvokeRegister re-runs it on every
  // pooled Goja VM.
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("lms_platform_upsert", rpcPlatformUpsert);
    initializer.registerRpc("lms_platform_list", rpcPlatformList);
    initializer.registerRpc("lms_platform_delete", rpcPlatformDelete);
    initializer.registerRpc("lms_launch_session", rpcLaunchSession);
    initializer.registerRpc("lms_deeplink_bind", rpcDeeplinkBind);
    initializer.registerRpc("lms_attempt_complete", rpcAttemptComplete);
    initializer.registerRpc("lms_grade_push", rpcGradePush);
    initializer.registerRpc("lms_import_pack", rpcImportPack);
    initializer.registerRpc("lms_link_status", rpcLinkStatus);
  }
}
