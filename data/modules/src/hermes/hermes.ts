// ---------------------------------------------------------------------------
//  hermes.ts — QuizVerse "Hermes" nightly learning-loop agent (Play 3)
//
//  Hermes is the server-side persistent agent that turns one-off study sessions
//  into a daily return loop. Every night a scheduler tick (driven by a k8s
//  CronJob calling quizverse_hermes_nightly_tick) walks the opt-in registry,
//  composes a per-learner "morning brief" from durable Nakama state (entitlement
//  + study-plan checklist + predictor), optionally enriches it via DeepTutor /
//  Simi, persists it, and pushes a deep-linked in-app notification so the learner
//  re-enters the next morning to a ready-made plan.
//
//  Collections
//    qv_hermes_brief     key "today"  (per-user)   — the latest generated brief
//    qv_hermes_registry  key "users"  (SYSTEM_USER) — opt-in set { [userId]: ts }
//
//  RPCs (all IDs are literal at registration — Goja AST-walker requirement)
//    quizverse_hermes_brief_get      user      → latest brief (auto opt-in)
//    quizverse_hermes_brief_generate user|svc  → (re)build + store brief
//    quizverse_hermes_parent_recap   user|svc  → parent-facing recap text
//    quizverse_hermes_nightly_tick   service   → batch driver (CronJob entry)
//
//  Env (must be listed in RUNTIME_ENV_KEYS in docker-compose / k8s to be visible
//  via ctx.env): HERMES_SERVICE_TOKEN, DEEPTUTOR_BASE_URL, DEEPTUTOR_SERVICE_TOKEN,
//  SIMI_BASE_URL, SIMI_API_KEY. Every external call is best-effort and degrades
//  to a deterministic local brief when the env var / dependency is absent.
//
//  Zero-defect notes: ES5 only (no arrow fns passed to registerRpc, no global
//  mutable state), no Node built-ins, build + restart required to load.
// ---------------------------------------------------------------------------

namespace Hermes {

  var COLLECTION_BRIEF    = "qv_hermes_brief";
  var KEY_BRIEF           = "today";
  var COLLECTION_REGISTRY = "qv_hermes_registry";
  var KEY_REGISTRY        = "users";

  var COLLECTION_ENTITLEMENTS = "qv_entitlements";
  var KEY_SUBS                = "subscriptions";

  // Deep link the SPA + native widgets understand (see index-tutorx-v2.html
  // _qvHandleDeepLink + QVWidgetBridge). hermes_brief opens the morning surface.
  var DEEPLINK_BRIEF = "tutorx://hermes/brief";

  // Batch cap per tick so one CronJob run can't monopolise a pod.
  var NIGHTLY_BATCH_LIMIT = 500;

  // ── small helpers ─────────────────────────────────────────────────────────
  function nowSec(): number { return Math.floor(Date.now() / 1000); }
  function utcDateStr(): string { return new Date().toISOString().slice(0, 10); }

  function envStr(ctx: nkruntime.Context, key: string): string {
    return "" + ((ctx.env && ctx.env[key]) || "");
  }

  function isServiceCaller(ctx: nkruntime.Context, payload: any): boolean {
    var token = payload && payload.service_token;
    if (!token) return false;
    var expected = envStr(ctx, "HERMES_SERVICE_TOKEN");
    return expected.length > 0 && token === expected;
  }

  // user session → ctx.userId; service caller → payload.user_id.
  function resolveUser(ctx: nkruntime.Context, data: any): { userId: string; error?: string; code?: number } {
    if (ctx.userId) return { userId: ctx.userId };
    if (!isServiceCaller(ctx, data)) return { userId: "", error: "not authorised", code: 401 };
    var u = "" + (data.user_id || "");
    if (!u) return { userId: "", error: "user_id required for service caller", code: 400 };
    return { userId: u };
  }

  // ── opt-in registry ─────────────────────────────────────────────────────────
  interface Registry { users: { [userId: string]: number }; }

  function readRegistry(nk: nkruntime.Nakama): Registry {
    try {
      var r = Storage.readSystemJson<Registry>(nk, COLLECTION_REGISTRY, KEY_REGISTRY);
      if (r && r.users && typeof r.users === "object") return r;
    } catch (_e: any) { /* fall through */ }
    return { users: {} };
  }

  function registerUser(nk: nkruntime.Nakama, userId: string): void {
    if (!userId) return;
    try {
      var reg = readRegistry(nk);
      reg.users[userId] = nowSec();
      Storage.writeSystemJson(nk, COLLECTION_REGISTRY, KEY_REGISTRY, reg);
    } catch (_e: any) { /* best-effort */ }
  }

  // ── entitlement read (tone: trial nudge vs. paid) ───────────────────────────
  function entitlementStatus(nk: nkruntime.Nakama, userId: string): string {
    try {
      var subs = Storage.readJson<any>(nk, COLLECTION_ENTITLEMENTS, KEY_SUBS, userId);
      if (!subs || !subs.tier) return "free";
      var status = "" + (subs.status || "");
      if (subs.expiresAt) {
        var expMs = new Date(subs.expiresAt).getTime();
        if (!isNaN(expMs) && expMs < Date.now()) return "expired";
      }
      if (status === "trialing") return "trialing";
      if (status === "active") return "active";
      return "free";
    } catch (_e: any) {
      return "free";
    }
  }

  // ── study-plan checklist progress (best-effort, defensive) ───────────────────
  // The plan content lives in DeepTutor; only the per-user checklist state is in
  // Nakama (tutorx_studyplan/<planId>). We scan the user's records and total the
  // ticked tasks so the brief can report "you finished N tasks" without coupling
  // to a specific planId we may not have at tick time.
  function planProgress(nk: nkruntime.Nakama, userId: string): { plans: number; doneTasks: number } {
    var plans = 0, doneTasks = 0;
    try {
      var res = nk.storageList(userId, "tutorx_studyplan", 50);
      var objs = (res && res.objects) || [];
      for (var i = 0; i < objs.length; i++) {
        var v: any = objs[i].value;
        if (v && v.done && typeof v.done === "object") {
          plans++;
          for (var k in v.done) {
            if (Object.prototype.hasOwnProperty.call(v.done, k) && v.done[k] === true) doneTasks++;
          }
        }
      }
    } catch (_e: any) { /* no plans yet */ }
    return { plans: plans, doneTasks: doneTasks };
  }

  // ── optional DeepTutor enrichment ────────────────────────────────────────────
  // Pulls a one-line "what to focus on next" from the learner's DeepTutor memory.
  // Returns "" on any failure so the brief always renders.
  function deepTutorFocus(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, userId: string): string {
    var base = envStr(ctx, "DEEPTUTOR_BASE_URL");
    if (!base) return "";
    try {
      var url = base.replace(/\/+$/, "") + "/api/v1/memory/next-focus";
      var headers: { [k: string]: string } = { "Content-Type": "application/json", "x-user-id": userId };
      var svc = envStr(ctx, "DEEPTUTOR_SERVICE_TOKEN");
      if (svc) headers["Authorization"] = "Bearer " + svc;
      var resp = nk.httpRequest(url, "post", headers, JSON.stringify({ user_id: userId }), 4000);
      if (resp && resp.code >= 200 && resp.code < 300 && resp.body) {
        var parsed: any = JSON.parse(resp.body);
        var f = "" + ((parsed && (parsed.focus || parsed.next_focus || parsed.summary)) || "");
        return f.slice(0, 240);
      }
    } catch (err: any) {
      logger.info("[Hermes] deepTutorFocus skipped: " + (err && err.message ? err.message : String(err)));
    }
    return "";
  }

  // ── brief composition ────────────────────────────────────────────────────────
  interface Brief {
    date: string;
    generated_unix: number;
    status: string;          // entitlement tone
    headline: string;
    focus: string;
    progress: { plans: number; doneTasks: number };
    cta: { label: string; deeplink: string };
    source: string;          // "deeptutor" | "local"
  }

  function composeBrief(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, userId: string): Brief {
    var status = entitlementStatus(nk, userId);
    var prog = planProgress(nk, userId);

    var focus = deepTutorFocus(ctx, logger, nk, userId);
    var source = focus ? "deeptutor" : "local";
    if (!focus) {
      focus = prog.doneTasks > 0
        ? "Pick up where you left off — you've cleared " + prog.doneTasks + " task" + (prog.doneTasks === 1 ? "" : "s") + ". One focused session keeps your streak alive."
        : "Start with a 10-minute focused session on your weakest topic — momentum beats marathon study.";
    }

    var headline: string;
    if (status === "trialing")      headline = "Your trial is working — here's today's win.";
    else if (status === "active")   headline = "Good morning. Today's plan is ready.";
    else if (status === "expired")  headline = "Your plan misses you. Pick up your prep where you left off.";
    else                            headline = "Good morning. Here's your fastest win for today.";

    var ctaLabel = (status === "active" || status === "trialing") ? "Open today's plan" : "Resume my prep";

    return {
      date: utcDateStr(),
      generated_unix: nowSec(),
      status: status,
      headline: headline,
      focus: focus,
      progress: prog,
      cta: { label: ctaLabel, deeplink: DEEPLINK_BRIEF },
      source: source,
    };
  }

  function readBrief(nk: nkruntime.Nakama, userId: string): Brief | null {
    try { return Storage.readJson<Brief>(nk, COLLECTION_BRIEF, KEY_BRIEF, userId); }
    catch (_e: any) { return null; }
  }

  function storeBrief(nk: nkruntime.Nakama, userId: string, brief: Brief): void {
    // permissionRead:1 → owner can read their own brief; server-only writes.
    Storage.writeJson(nk, COLLECTION_BRIEF, KEY_BRIEF, userId, brief,
      1 as nkruntime.ReadPermissionValues, 0 as nkruntime.WritePermissionValues);
  }

  // Deliver the morning brief. Native (Unity) users with a registered push token
  // get a real APNs/FCM push via LegacyPush.sendLocalizedPushToUser (which also
  // writes the in-app inbox copy and respects quiet hours). Web users — and any
  // user without a token or currently in quiet hours — fall back to an inbox-only
  // notification (code 1101) so the SPA morning-brief surface always has content.
  // The SPA reads the brief from storage (quizverse_hermes_brief_get), so the
  // notification code is only a delivery hint, not the surface's data source.
  function notifyBrief(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, brief: Brief): void {
    var data: any = { deeplink: brief.cta.deeplink, kind: "hermes_brief", date: brief.date };
    var pushed = false;
    try {
      // titleKey/bodyKey fall back to the literal string when absent from the
      // push string table, so the composed headline/focus reach the device as-is.
      pushed = LegacyPush.sendLocalizedPushToUser(
        ctx, logger, nk, userId, "hermes_brief", brief.headline, brief.focus, {},
        { data: data, gameId: "quizverse" }
      );
    } catch (err: any) {
      logger.warn("[Hermes] device push failed for user=" + userId + ": " + (err && err.message ? err.message : String(err)));
    }
    if (pushed) return;   // sendLocalizedPushToUser already wrote the inbox copy.
    try {
      nk.notificationsSend([{
        userId: userId,
        subject: brief.headline,
        content: { focus: brief.focus, deeplink: brief.cta.deeplink, kind: "hermes_brief", date: brief.date },
        code: 1101,
        persistent: true,
      }]);
    } catch (err: any) {
      logger.warn("[Hermes] notifyBrief inbox fallback failed for user=" + userId + ": " + (err && err.message ? err.message : String(err)));
    }
  }

  // ── RPC: quizverse_hermes_brief_get ───────────────────────────────────────────
  function rpcBriefGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    registerUser(nk, userId);   // reading the brief opts you into the nightly loop
    var brief = readBrief(nk, userId);
    if (!brief) {
      return RpcHelpers.successResponse({ has_brief: false, date: utcDateStr() });
    }
    return RpcHelpers.successResponse({ has_brief: true, brief: brief });
  }

  // ── RPC: quizverse_hermes_brief_generate ──────────────────────────────────────
  function rpcBriefGenerate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var auth = resolveUser(ctx, data);
    if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

    var brief = composeBrief(ctx, logger, nk, auth.userId);
    try { storeBrief(nk, auth.userId, brief); } catch (err: any) {
      logger.warn("[Hermes] storeBrief failed: " + (err && err.message ? err.message : String(err)));
    }
    registerUser(nk, auth.userId);

    // Service callers (the nightly tick) also get a push; self-serve callers do
    // not (they're already on the surface that triggered the regen).
    if (!ctx.userId && data.notify === true) notifyBrief(ctx, nk, logger, auth.userId, brief);

    return RpcHelpers.successResponse({ brief: brief });
  }

  // ── RPC: quizverse_hermes_parent_recap ────────────────────────────────────────
  function rpcParentRecap(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var auth = resolveUser(ctx, data);
    if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

    var brief = readBrief(nk, auth.userId) || composeBrief(ctx, logger, nk, auth.userId);
    var prog = brief.progress || { plans: 0, doneTasks: 0 };
    var statusLine =
      brief.status === "trialing" ? "On a Pro trial — full adaptive prep is unlocked."
      : brief.status === "active" ? "Pro plan active — full adaptive prep is unlocked."
      : "On the free plan — upgrade unlocks the full adaptive plan.";

    var recap =
      "This week your learner completed " + prog.doneTasks + " study task" + (prog.doneTasks === 1 ? "" : "s") +
      " across " + prog.plans + " plan" + (prog.plans === 1 ? "" : "s") + ". " +
      "Today's focus: " + brief.focus + " " + statusLine;

    return RpcHelpers.successResponse({
      recap: recap,
      status: brief.status,
      progress: prog,
      cta: { label: "See full progress", deeplink: "tutorx://parent/recap" },
      date: brief.date,
    });
  }

  // ── RPC: quizverse_hermes_nightly_tick (service-only batch driver) ─────────────
  function rpcNightlyTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!isServiceCaller(ctx, data)) {
      return RpcHelpers.errorResponse("not authorised", 401);
    }

    var reg = readRegistry(nk);
    var ids: string[] = [];
    for (var uid in reg.users) {
      if (Object.prototype.hasOwnProperty.call(reg.users, uid)) ids.push(uid);
    }

    var limit = NIGHTLY_BATCH_LIMIT;
    var generated = 0, notified = 0, failed = 0;
    var doNotify = data.notify !== false;   // default: send the morning push

    for (var i = 0; i < ids.length && i < limit; i++) {
      var userId = ids[i];
      try {
        var brief = composeBrief(ctx, logger, nk, userId);
        storeBrief(nk, userId, brief);
        generated++;
        if (doNotify) { notifyBrief(ctx, nk, logger, userId, brief); notified++; }
      } catch (err: any) {
        failed++;
        logger.warn("[Hermes] nightly tick failed for user=" + userId + ": " + (err && err.message ? err.message : String(err)));
      }
    }

    logger.info("[Hermes] nightly tick: registered=" + ids.length + " generated=" + generated + " notified=" + notified + " failed=" + failed);
    return RpcHelpers.successResponse({
      registered: ids.length,
      generated: generated,
      notified: notified,
      failed: failed,
      batch_limit: limit,
      date: utcDateStr(),
    });
  }

  // ── Registration ──────────────────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer): void {
    // withCleanAuthError wraps a handler once at registration time, but when
    // register() is auto-invoked at IIFE scope by the postbuild script,
    // RpcHelpers may not be initialised yet — it lives in a later IIFE and the
    // 'hermes' module sorts before 'shared' on Linux (case-sensitive readdir),
    // so an eager RpcHelpers.withCleanAuthError(...) here throws at startup and
    // takes down the entire JS runtime. Use a lazy wrapper (same pattern as
    // quests/quest_engine.ts) so the wrap is deferred to first-call time.
    type StrictRpc = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string;
    function auth(fn: nkruntime.RpcFunction): nkruntime.RpcFunction {
      var wrapped: StrictRpc | null = null;
      return function(ctx, logger, nk, payload): string {
        if (!wrapped) {
          const strictFn = fn as StrictRpc;
          wrapped = (typeof RpcHelpers !== "undefined" && RpcHelpers.withCleanAuthError)
            ? RpcHelpers.withCleanAuthError(strictFn)
            : strictFn;
        }
        return wrapped(ctx, logger, nk, payload);
      };
    }
    // IMPORTANT: literal RPC IDs — the Nakama Goja AST walker can NOT resolve
    // namespaced constants at registration time.
    initializer.registerRpc("quizverse_hermes_brief_get", auth(rpcBriefGet));
    initializer.registerRpc("quizverse_hermes_brief_generate", rpcBriefGenerate);
    initializer.registerRpc("quizverse_hermes_parent_recap", rpcParentRecap);
    initializer.registerRpc("quizverse_hermes_nightly_tick", rpcNightlyTick);
  }
}
