// learner_toolbelt.ts
// ─────────────────────────────────────────────────────────────────────────────
// QuizVerse Learner Toolbelt — Phase A skeleton (PR-LT1).
//
// Four learner tools every test-prep candidate uses BEFORE picking a study app:
//   1. Score Predictor       (SAT IRT · JEE/NEET percentile · AP composite · UK boundary · Bayes fallback)
//   2. Exam Countdown        (country-aware exam calendar + per-user study min/day)
//   3. GPA Calculator        (12 grading systems · WES-iGPA conversion)
//   4. School Info Gathering (NCES · UDISE+ · GIAS · INEP · free-text fallback)
//
// Plan: ../../docs/strategy/PLAN-LEARNER_TOOLBELT.md (mirrored from
//   intelliverse-x-games-platform-2/games/quiz-verse/Docs/plans/).
// Tracking PRs:
//   - intelli-verse-x/intelliverse-x-games-platform-2#207 (plan source of truth)
//   - intelli-verse-x/Quizverse-web-frontend#86 (web mirror)
//   - intelli-verse-x/Intelliverse-X-AI#256 (gateway mirror)
//
// This PR (skeleton): every RPC returns { ok: true, status: "not_implemented",
//   phase: "skeleton-A" } so the gateway can wire all 13 tool dispatchers in
//   parallel while the algorithms land in waves 4-5. Auth + body wire format
//   are real (mirror qv-agent's service-token pattern), so once any single
//   RPC's real logic lands the consumer-side wiring does not change.
//
// RPCs registered (13)
// --------------------
//   lt_score_predict                  service-only (auth) — § 3 of plan
//   lt_exam_countdown_get             service-only        — § 4 of plan
//   lt_exam_countdown_set             service-only        — § 4 of plan
//   lt_exam_countdown_clear           service-only        — § 4 of plan
//   lt_exam_calendar_get              public (anonymous OK)— § 4.5
//   lt_gpa_compute                    public               — § 5 stateless
//   lt_gpa_save                       service-only        — § 5
//   lt_gpa_get                        service-only        — § 5
//   lt_school_search                  public               — § 6
//   lt_school_get_detail              public               — § 6
//   lt_school_set_user_school         service-only        — § 6
//   lt_school_get_user_school         service-only        — § 6
//   lt_school_freetext_submit         service-only        — § 6
//
// Auth model
// ----------
// Mirrors src/qv-agent/qv_agent.ts:
//   (a) caller IS the user — ctx.userId from a Nakama session
//   (b) caller is the gateway — service_token in payload matches
//       ctx.env["LT_SERVICE_TOKEN"], AND user_id is supplied in payload
//
// Storage shapes (defined here, populated in wave 4-5)
// ----------------------------------------------------
//   collection: "qv_lt_school"      key: "current"  → UserSchoolRecord
//   collection: "qv_lt_countdown"   key: "doc"      → ExamCountdownDoc
//   collection: "qv_lt_gpa"         key: "current"  → GpaSnapshot
//   collection: "qv_lt_predictor_context" key: "<exam_id>" → PredictorContextBlock
//   collection: "qv_lt_school_pending" key: "<provisional_id>" → freetext queue
// All permissionRead/Write = 0 (server-only).

namespace LearnerToolbelt {

  // ── Constants ──────────────────────────────────────────────────────────────
  var COLLECTION_SCHOOL = "qv_lt_school";
  var COLLECTION_COUNTDOWN = "qv_lt_countdown";
  var COLLECTION_GPA = "qv_lt_gpa";
  var COLLECTION_PREDICTOR_CONTEXT = "qv_lt_predictor_context";
  var COLLECTION_SCHOOL_PENDING = "qv_lt_school_pending";
  var ANALYTICS_GAME_ID = "quizverse";
  var SKELETON_PHASE = "skeleton-A";
  var MODULE_VERSION = "learner-toolbelt/0.1.0";

  // ── Helpers ────────────────────────────────────────────────────────────────
  function nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  function randomId(): string {
    return Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function isServiceCaller(ctx: nkruntime.Context, payload: any): boolean {
    var token = payload && payload.service_token;
    if (!token) return false;
    var expected = "" + ((ctx.env && ctx.env["LT_SERVICE_TOKEN"]) || "");
    return expected.length > 0 && token === expected;
  }

  // Service callers (gateway / agent) supply { service_token, user_id }.
  // Direct Nakama-session callers (Unity client post-Phase-3, server-to-server
  // inside Nakama) have ctx.userId already populated. Either path is accepted.
  function resolveServiceUserId(
    ctx: nkruntime.Context,
    data: any
  ): { userId: string; error?: string; code?: number } {
    if (ctx.userId) {
      return { userId: ctx.userId };
    }
    if (!isServiceCaller(ctx, data)) {
      return { userId: "", error: "not authorised", code: 401 };
    }
    var u = "" + (data.user_id || "");
    if (!u) {
      return { userId: "", error: "user_id required for service caller", code: 400 };
    }
    return { userId: u };
  }

  // Stub envelope — same shape Wave 4-5 will return at status: "ok".
  // Front-ends (web routes, gateway ToolDispatcher) MUST be tolerant of
  // status: "not_implemented" so they can ship before the algos land.
  function stubResponse(rpcId: string, extra?: any): string {
    var body: any = {
      ok: true,
      status: "not_implemented",
      phase: SKELETON_PHASE,
      rpc: rpcId,
      module_version: MODULE_VERSION,
      generated_unix: nowSec(),
    };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
      }
    }
    return RpcHelpers.successResponse(body);
  }

  function emitAnalytics(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    eventName: string,
    properties: any
  ): void {
    try {
      var unixTs = nowSec();
      var dateStr = new Date().toISOString().slice(0, 10);
      var rand = Math.random().toString(36).slice(2, 8);
      var dashKey = "dash_" + ANALYTICS_GAME_ID + "_" + dateStr + "_" + eventName + "_" + unixTs + "_" + rand;
      nk.storageWrite([{
        collection: Constants.ANALYTICS_COLLECTION,
        key: dashKey,
        userId: Constants.SYSTEM_USER_ID,
        value: {
          eventName: eventName,
          gameId: ANALYTICS_GAME_ID,
          userId: userId,
          properties: properties,
          unixTimestamp: unixTs,
          date: dateStr,
        },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (e: any) {
      logger.warn("[learner-toolbelt] emitAnalytics failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  // ── RPC: lt_score_predict ──────────────────────────────────────────────────
  // Implementation: wave 5 (PR-LT5). See plan § 3.
  function rpcScorePredict(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);
      var examId = "" + (data.exam_id || "");
      if (!examId) return RpcHelpers.errorResponse("exam_id required", 400);
      var locale = "" + (data.locale || "en");
      emitAnalytics(nk, logger, auth.userId, "lt_score_predict_skeleton", { exam_id: examId, locale: locale });
      return stubResponse("lt_score_predict", { exam_id: examId, locale: locale, predictor_tier: "l0_diagnostic" });
    } catch (err: any) {
      logger.error("lt_score_predict failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_exam_countdown_get ─────────────────────────────────────────────
  // Implementation: wave 4 (PR-LT4). See plan § 4.
  function rpcExamCountdownGet(ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);
      return stubResponse("lt_exam_countdown_get", { entries: [], primary_exam_id: null });
    } catch (err: any) {
      logger.error("lt_exam_countdown_get failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_exam_countdown_set ─────────────────────────────────────────────
  function rpcExamCountdownSet(ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);
      var examId = "" + (data.exam_id || "");
      var dateIso = "" + (data.date_iso || "");
      if (!examId) return RpcHelpers.errorResponse("exam_id required", 400);
      if (!dateIso) return RpcHelpers.errorResponse("date_iso required (YYYY-MM-DD)", 400);
      return stubResponse("lt_exam_countdown_set", { exam_id: examId, date_iso: dateIso });
    } catch (err: any) {
      logger.error("lt_exam_countdown_set failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_exam_countdown_clear ───────────────────────────────────────────
  function rpcExamCountdownClear(ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);
      var examId = "" + (data.exam_id || "");
      if (!examId) return RpcHelpers.errorResponse("exam_id required", 400);
      return stubResponse("lt_exam_countdown_clear", { exam_id: examId, cleared: true });
    } catch (err: any) {
      logger.error("lt_exam_countdown_clear failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_exam_calendar_get ──────────────────────────────────────────────
  // Public — anonymous OK. Returns the per-country exam calendar.
  // Implementation: wave 3 (PR-LT3).
  function rpcExamCalendarGet(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var country = "" + (data.country || "IN");
      var year = parseInt("" + (data.year || "2026"), 10);
      return stubResponse("lt_exam_calendar_get", { country: country, year: year, exams: [] });
    } catch (err: any) {
      logger.error("lt_exam_calendar_get failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_gpa_compute ────────────────────────────────────────────────────
  // Public stateless calculator. Implementation: wave 3 (PR-LT3-web).
  function rpcGpaCompute(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var system = "" + (data.system || "us-4.0-unweighted");
      var courses: any[] = Array.isArray(data.courses) ? data.courses : [];
      if (courses.length === 0) return RpcHelpers.errorResponse("courses array required", 400);
      return stubResponse("lt_gpa_compute", {
        system: system,
        native_gpa: null,
        wes_4_0: null,
        course_count: courses.length,
      });
    } catch (err: any) {
      logger.error("lt_gpa_compute failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_gpa_save ───────────────────────────────────────────────────────
  function rpcGpaSave(ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);
      var system = "" + (data.system || "");
      if (!system) return RpcHelpers.errorResponse("system required", 400);
      return stubResponse("lt_gpa_save", { system: system });
    } catch (err: any) {
      logger.error("lt_gpa_save failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_gpa_get ────────────────────────────────────────────────────────
  function rpcGpaGet(ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);
      return stubResponse("lt_gpa_get", { has_data: false });
    } catch (err: any) {
      logger.error("lt_gpa_get failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_school_search ──────────────────────────────────────────────────
  // Public. Implementation: wave 3 (PR-LT3-web) after static-data ingest lands.
  function rpcSchoolSearch(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var query = "" + (data.query || "");
      var country = "" + (data.country_code || "IN");
      if (query.length < 2) return RpcHelpers.errorResponse("query must be ≥2 chars", 400);
      return stubResponse("lt_school_search", {
        query: query,
        country_code: country,
        results: [],
      });
    } catch (err: any) {
      logger.error("lt_school_search failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_school_get_detail ──────────────────────────────────────────────
  function rpcSchoolGetDetail(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var schoolId = "" + (data.school_id || "");
      if (!schoolId) return RpcHelpers.errorResponse("school_id required", 400);
      return stubResponse("lt_school_get_detail", { school_id: schoolId, found: false });
    } catch (err: any) {
      logger.error("lt_school_get_detail failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_school_set_user_school ─────────────────────────────────────────
  function rpcSchoolSetUserSchool(ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);
      var schoolId = "" + (data.school_id || "");
      if (!schoolId) return RpcHelpers.errorResponse("school_id required", 400);
      return stubResponse("lt_school_set_user_school", { school_id: schoolId });
    } catch (err: any) {
      logger.error("lt_school_set_user_school failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_school_get_user_school ─────────────────────────────────────────
  function rpcSchoolGetUserSchool(ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);
      return stubResponse("lt_school_get_user_school", { has_school: false });
    } catch (err: any) {
      logger.error("lt_school_get_user_school failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_school_freetext_submit ─────────────────────────────────────────
  // Creates a moderation-queue entry under qv_lt_school_pending. ai-content
  // batch-reviews daily.
  function rpcSchoolFreetextSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);
      var schoolName = "" + (data.school_name || "");
      var country = "" + (data.country_code || "");
      if (!schoolName) return RpcHelpers.errorResponse("school_name required", 400);
      if (!country) return RpcHelpers.errorResponse("country_code required", 400);
      var provisionalId = "freetext:" + randomId();
      return stubResponse("lt_school_freetext_submit", {
        provisional_school_id: provisionalId,
        pending_review: true,
      });
    } catch (err: any) {
      logger.error("lt_school_freetext_submit failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── Registration ───────────────────────────────────────────────────────────
  // Every registerRpc call uses a STRING-LITERAL id (per PHASE-ROADMAP lesson
  // #2: postbuild.js auto-hoists ONLY string-literal registerRpc calls).
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("lt_score_predict", rpcScorePredict);
    initializer.registerRpc("lt_exam_countdown_get", rpcExamCountdownGet);
    initializer.registerRpc("lt_exam_countdown_set", rpcExamCountdownSet);
    initializer.registerRpc("lt_exam_countdown_clear", rpcExamCountdownClear);
    initializer.registerRpc("lt_exam_calendar_get", rpcExamCalendarGet);
    initializer.registerRpc("lt_gpa_compute", rpcGpaCompute);
    initializer.registerRpc("lt_gpa_save", rpcGpaSave);
    initializer.registerRpc("lt_gpa_get", rpcGpaGet);
    initializer.registerRpc("lt_school_search", rpcSchoolSearch);
    initializer.registerRpc("lt_school_get_detail", rpcSchoolGetDetail);
    initializer.registerRpc("lt_school_set_user_school", rpcSchoolSetUserSchool);
    initializer.registerRpc("lt_school_get_user_school", rpcSchoolGetUserSchool);
    initializer.registerRpc("lt_school_freetext_submit", rpcSchoolFreetextSubmit);
  }
}
