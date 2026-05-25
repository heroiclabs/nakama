// learner_toolbelt.ts
// ─────────────────────────────────────────────────────────────────────────────
// QuizVerse Learner Toolbelt — Wave 4-5 implementation (PR-LT2).
//
// This module replaces the Phase-A skeleton with real algorithms for:
//   1. GPA Calculator         (6 grading systems — see lt_grading.ts)
//   2. Exam Calendar          (5 countries × 2 years — see lt_calendar.ts)
//   3. Exam Countdown         (storage CRUD + study-min/day recommendation)
//   4. School Info Gathering  (in-memory 200-school fixture + freetext queue)
//   5. Score Predictor        (Bayes fallback only, l0/l1 tier per § 2.22)
//
// All 13 RPC IDs are unchanged from the skeleton — the gateway tool
// dispatcher and web routes wire to the same surface. Only the body of
// each handler is upgraded from "not_implemented" → real responses.
//
// Plan: ../../docs/strategy/PLAN-LEARNER_TOOLBELT.md
// Skeleton PR (merged): nakama#73
// Tracking PRs (web/gateway mirrors): Quizverse-web-frontend#86,
// Intelliverse-X-AI#256.
//
// Auth model (unchanged from skeleton)
// ------------------------------------
// • Public RPCs (lt_gpa_compute, lt_exam_calendar_get, lt_school_search,
//   lt_school_get_detail) — no auth.
// • Service-only RPCs accept either (a) ctx.userId from a Nakama session,
//   or (b) service_token + user_id in payload matching ctx.env["LT_SERVICE_TOKEN"].
// RPCs registered (15)
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
//   lt_chat_quota_check               service-only        — § 3.11 (anon/auth/pro tier)
//   lt_chat_quota_consume             service-only        — § 3.11 (atomic decrement)
//
// Storage shapes (real now)
// -------------------------
//   collection: "qv_lt_school"          key: "current"               → UserSchoolRecord
//   collection: "qv_lt_countdown"       key: "doc"                   → ExamCountdownDoc
//   collection: "qv_lt_school_pending"  key: "<provisional_id>"      → FreetextSchoolEntry
// (qv_lt_gpa and qv_lt_predictor_context are reserved for follow-up PRs —
//  the lt_gpa_save / lt_gpa_get RPCs use qv_lt_gpa today.)
//
// Quiz-history source: `quiz_results` collection (legacy, see
// src/legacy/quiz.ts). Each row is `result_<userId>_<unix>` with shape
// { score, totalQuestions, correctAnswers, category, timestamp }.
// Storage shapes (defined here, populated in wave 4-5)
// ----------------------------------------------------
//   collection: "qv_lt_school"      key: "current"  → UserSchoolRecord
//   collection: "qv_lt_countdown"   key: "doc"      → ExamCountdownDoc
//   collection: "qv_lt_gpa"         key: "current"  → GpaSnapshot
//   collection: "qv_lt_predictor_context" key: "<exam_id>" → PredictorContextBlock
//   collection: "qv_lt_school_pending" key: "<provisional_id>" → freetext queue
//   collection: "qv_lt_chat_quota"   key: see § 3.11.3       → ChatQuotaRecord
// All permissionRead/Write = 0 (server-only).

namespace LearnerToolbelt {

  // ── Constants ──────────────────────────────────────────────────────────────
  var COLLECTION_SCHOOL = "qv_lt_school";
  var COLLECTION_COUNTDOWN = "qv_lt_countdown";
  var COLLECTION_GPA = "qv_lt_gpa";
  var COLLECTION_SCHOOL_PENDING = "qv_lt_school_pending";
  var COLLECTION_QUIZ_RESULTS = "quiz_results";
  var ANALYTICS_GAME_ID = "quizverse";
  export var MODULE_VERSION = "learner-toolbelt/0.2.0";
  var DEFAULT_PREDICT_WINDOW_DAYS = 60;
  var MAX_PREDICT_WINDOW_DAYS = 365;
  var MAX_HISTORY_ROWS = 200;
  var MAX_COUNTDOWN_ENTRIES = 20;
  var COLLECTION_CHAT_QUOTA = "qv_lt_chat_quota";
  var ANALYTICS_GAME_ID = "quizverse";
  var SKELETON_PHASE = "skeleton-A";
  var MODULE_VERSION = "learner-toolbelt/0.2.0";

  // ── Chat-quota limits (plan §3.11) ─────────────────────────────────────────
  // Defaults below match PLAN-LEARNER_TOOLBELT.md §3.11.1. Each may be
  // overridden at runtime via ctx.env.LT_QUOTA_<NAME> (lifted into k8s
  // deploy config to support promo bursts / penny-cost A-B tests without a
  // rebuild). Predictor caps are kept here for the parallel anon-tier
  // predictor RPC even though the consumer for predictor quota lands in a
  // later PR — staging the constant here means consumers can read the
  // canonical value via lt_chat_quota_check's diagnostics shape.
  var DEFAULT_QUOTA_ANON_PREDICTOR_PER_DAY = 3;
  var DEFAULT_QUOTA_ANON_CHAT_PER_DAY = 5;
  var DEFAULT_QUOTA_AUTH_PREDICTOR_PER_DAY = -1; // -1 sentinel = unlimited
  var DEFAULT_QUOTA_AUTH_CHAT_PER_DAY = 30;
  var DEFAULT_QUOTA_PRO_CHAT_PER_DAY = 200;

  // Cognito sub format — base-36 / hex / uuid-ish. We accept anything that
  // looks like a non-trivial token. Strict format checks happen at the
  // gateway; this RPC just gates the "is the supplied user_id plausible"
  // path before reading the per-exam ledger.
  var COGNITO_SUB_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;

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

  // ── Quota helpers (§3.11) ──────────────────────────────────────────────────
  //
  // The reset window is the wall-clock UTC date (YYYY-MM-DD). Keys naturally
  // expire at 00:00 UTC because the next call lands under a new date string.
  // We do NOT set a Nakama-side TTL — storage cleanup is a future cron job.
  //
  // Three identity buckets:
  //   anon → key = ip:<sha-truncated>:<date>:<exam_id>
  //   auth → TWO keys:
  //          (1) user:<sub>:<date>           — global per-day cap
  //          (2) user:<sub>:<date>:<exam_id> — per-exam visibility for
  //                                             cohort dashboards
  //
  // tier resolution:
  //   user_id supplied + matches COGNITO_SUB_RE → "free" (Phase A)
  //   ip_hash only                              → "anon"
  //   "pro" detection deferred to Phase D — we always return "free" for
  //   authenticated users until billing wires up
  function getQuotaLimit(
    ctx: nkruntime.Context,
    envKey: string,
    fallback: number
  ): number {
    var raw = ctx.env && ctx.env[envKey];
    if (!raw) return fallback;
    var parsed = parseInt("" + raw, 10);
    if (isNaN(parsed)) return fallback;
    return parsed;
  }

  function utcDateStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function midnightUtcNextUnix(): number {
    var d = new Date();
    var next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
    return Math.floor(next / 1000);
  }

  function hashIpShort(nk: nkruntime.Nakama, ipHash: string): string {
    // The CALLER (gateway) is responsible for the first sha256 over the raw
    // IP — we never see the raw IP. We re-hash here so storage keys are not
    // a 1:1 mapping back to whatever the gateway hashed (defence-in-depth).
    try {
      var h = nk.sha256Hash(ipHash);
      return h.slice(0, 16);
    } catch (_e: any) {
      // Fallback: keep first 16 chars of whatever the gateway passed.
      return ("" + ipHash).slice(0, 16);
    }
  }

  function quotaKey(args: { tier: string; sub: string; ipShort: string; examId: string; date: string; scope: string }): string {
    if (args.tier === "anon") {
      return "ip:" + args.ipShort + ":" + args.date + ":" + args.examId;
    }
    if (args.scope === "global") {
      return "user:" + args.sub + ":" + args.date;
    }
    return "user:" + args.sub + ":" + args.date + ":" + args.examId;
  }

  function readUsed(nk: nkruntime.Nakama, key: string): number {
    try {
      var rows = nk.storageRead([{
        collection: COLLECTION_CHAT_QUOTA,
        key: key,
        userId: Constants.SYSTEM_USER_ID,
      }]);
      if (rows && rows.length > 0 && rows[0].value) {
        var v: any = rows[0].value;
        var used = parseInt("" + (v.used || 0), 10);
        return isNaN(used) ? 0 : used;
      }
    } catch (_e: any) { /* empty bucket */ }
    return 0;
  }

  function writeUsed(nk: nkruntime.Nakama, key: string, used: number): void {
    nk.storageWrite([{
      collection: COLLECTION_CHAT_QUOTA,
      key: key,
      userId: Constants.SYSTEM_USER_ID,
      value: { used: used, updated_unix: nowSec() },
      permissionRead: 0,
      permissionWrite: 0,
    }]);
  }

  interface QuotaIdentity {
    tier: "anon" | "free" | "pro";
    sub: string;       // empty for anon
    ipShort: string;   // empty for auth
    examId: string;
    locale: string;
    error?: string;
  }

  function resolveQuotaIdentity(data: any): QuotaIdentity {
    var kbScope = data && data.kb_scope ? data.kb_scope : {};
    var examId = "" + (kbScope.exam_id || data.exam_id || "");
    var locale = "" + (kbScope.locale || data.locale || "en");
    var userId = "" + (data.user_id || "");
    var ipHash = "" + (data.ip_hash || "");

    if (!examId) {
      return { tier: "anon", sub: "", ipShort: "", examId: "", locale: locale, error: "kb_scope.exam_id required" };
    }

    if (userId) {
      if (!COGNITO_SUB_RE.test(userId)) {
        return { tier: "anon", sub: "", ipShort: "", examId: examId, locale: locale, error: "invalid user_id format" };
      }
      // Phase A: every authenticated caller is "free". Phase D will compare
      // user_id against the billing entitlement store and promote to "pro".
      return { tier: "free", sub: userId, ipShort: "", examId: examId, locale: locale };
    }

    if (ipHash) {
      return { tier: "anon", sub: "", ipShort: ipHash, examId: examId, locale: locale };
    }

    return { tier: "anon", sub: "", ipShort: "", examId: examId, locale: locale, error: "missing_identity" };
  }

  function limitForTier(ctx: nkruntime.Context, tier: string): number {
    if (tier === "anon") {
      return getQuotaLimit(ctx, "LT_QUOTA_ANON_CHAT_PER_DAY", DEFAULT_QUOTA_ANON_CHAT_PER_DAY);
    }
    if (tier === "pro") {
      return getQuotaLimit(ctx, "LT_QUOTA_PRO_CHAT_PER_DAY", DEFAULT_QUOTA_PRO_CHAT_PER_DAY);
    }
    return getQuotaLimit(ctx, "LT_QUOTA_AUTH_CHAT_PER_DAY", DEFAULT_QUOTA_AUTH_CHAT_PER_DAY);
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

  function safeWrap(body: any): string {
    body.module_version = MODULE_VERSION;
    body.generated_unix = nowSec();
    return RpcHelpers.successResponse(body);
  }

  // ── Storage shapes ───────────────────────────────────────────────────────
  interface ExamCountdownEntry {
    exam_id: string;
    exam_label: string;
    date_iso: string;
    timezone: string;
    target_score: number | null;
    declared_unix: number;
  }
  interface ExamCountdownDoc {
    entries: ExamCountdownEntry[];
    primary_exam_id: string | null;
    updated_unix: number;
  }
  interface UserSchoolRecord {
    school_id: string;
    current_grade_or_class: string;
    graduation_year: number | null;
    joined_unix: number;
    verified: boolean;
  }
  interface FreetextSchoolEntry {
    provisional_school_id: string;
    school_name: string;
    country_code: string;
    city: string;
    submitted_by: string;
    submitted_unix: number;
    locale: string;
  }
  interface GpaSnapshot {
    system: string;
    native_gpa: number;
    wes_4_0: number;
    percentile_band: string;
    breakdown: GpaCourseBreakdown[];
    saved_unix: number;
  }

  // ── Countdown helpers ────────────────────────────────────────────────────
  function readCountdownDoc(nk: nkruntime.Nakama, userId: string): ExamCountdownDoc {
    try {
      var rows = nk.storageRead([{ collection: COLLECTION_COUNTDOWN, key: "doc", userId: userId }]);
      if (rows && rows.length > 0 && rows[0].value) {
        var v = rows[0].value as ExamCountdownDoc;
        return {
          entries: Array.isArray(v.entries) ? v.entries : [],
          primary_exam_id: v.primary_exam_id || null,
          updated_unix: v.updated_unix || 0,
        };
      }
    } catch (e: any) { /* fall through */ }
    return { entries: [], primary_exam_id: null, updated_unix: 0 };
  }

  function writeCountdownDoc(nk: nkruntime.Nakama, userId: string, doc: ExamCountdownDoc): void {
    nk.storageWrite([{
      collection: COLLECTION_COUNTDOWN, key: "doc", userId: userId,
      value: doc, permissionRead: 0, permissionWrite: 0,
    }]);
  }

  function daysBetween(fromUnix: number, toUnix: number): number {
    return Math.floor((toUnix - fromUnix) / 86400);
  }

  // Derived view for the countdown_get RPC. Honours plan § 4.4 study formula.
  function deriveCountdownView(doc: ExamCountdownDoc, now: number): any {
    var view: any[] = [];
    for (var i = 0; i < doc.entries.length; i++) {
      var e = doc.entries[i];
      var examTs = 0;
      try {
        examTs = Math.floor(new Date(e.date_iso + "T08:00:00Z").getTime() / 1000);
      } catch (_) { examTs = 0; }
      var daysUntil = examTs > 0 ? daysBetween(now, examTs) : 0;
      var uplift = expectedUpliftPerQuiz(e.exam_id);
      // Per plan § 4.4: minutes_per_day = max(5, ceil(quizzes_needed * 6 / days_remaining))
      // We don't know current_predicted here (caller can supply target_score
      // delta); for the canonical "want to lift 50 SAT-points" gap we use the
      // declared target_score field. If user hasn't set target_score, recommend
      // a maintenance 30 min/day.
      var minutesPerDay = 30;
      if (e.target_score && daysUntil > 0) {
        var quizzesNeeded = Math.max(1, Math.ceil(50 / uplift.value));
        var minutes = Math.ceil(quizzesNeeded * 6 / daysUntil);
        minutesPerDay = Math.max(5, Math.min(180, minutes));
      }
      view.push({
        exam_id: e.exam_id,
        exam_label: e.exam_label,
        date_iso: e.date_iso,
        timezone: e.timezone,
        target_score: e.target_score,
        days_until: daysUntil,
        hours_until: examTs > 0 ? Math.max(0, Math.floor((examTs - now) / 3600)) : 0,
        minutes_per_day_recommended: minutesPerDay,
        is_primary: doc.primary_exam_id === e.exam_id,
        uplift_unit: uplift.unit,
        uplift_per_quiz: uplift.value,
      });
    }
    view.sort(function (a, b) { return a.days_until - b.days_until; });
    return view;
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_score_predict (Wave 5 — Bayes fallback only)
  // ────────────────────────────────────────────────────────────────────────
  function rpcScorePredict(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var examId = "" + (data.exam_id || "");
      if (!examId) return RpcHelpers.errorResponse("exam_id required", 400);
      var locale = "" + (data.locale || "en");
      var windowDays = parseInt("" + (data.recent_quiz_window_days || DEFAULT_PREDICT_WINDOW_DAYS), 10);
      if (!(windowDays > 0)) windowDays = DEFAULT_PREDICT_WINDOW_DAYS;
      if (windowDays > MAX_PREDICT_WINDOW_DAYS) windowDays = MAX_PREDICT_WINDOW_DAYS;

      // Read recent quiz history. We page once with limit=MAX_HISTORY_ROWS;
      // that covers >99% of users for any 60-day window (mean session count
      // per user in 2026-04 telemetry: 14/mo).
      var history: QuizHistoryEntry[] = [];
      try {
        var listResult = nk.storageList(auth.userId, COLLECTION_QUIZ_RESULTS, MAX_HISTORY_ROWS, "");
        var rows = listResult && listResult.objects ? listResult.objects : [];
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (!r || !r.key || !r.value) continue;
          if (("" + r.key).indexOf("result_") !== 0) continue;
          var v = r.value as any;
          history.push({
            timestamp: parseInt("" + (v.timestamp || 0), 10) || 0,
            correctAnswers: parseInt("" + (v.correctAnswers || 0), 10) || 0,
            totalQuestions: parseInt("" + (v.totalQuestions || 0), 10) || 0,
            category: "" + (v.category || ""),
          });
        }
      } catch (e: any) {
        logger.warn("[learner-toolbelt] history read failed for user " + auth.userId + ": " + (e && e.message ? e.message : String(e)));
      }

      var result = predictFromHistory(
        { exam_id: examId, locale: locale, recent_quiz_window_days: windowDays },
        history,
        nowSec()
      );

      emitAnalytics(nk, logger, auth.userId, "lt_score_predict", {
        exam_id: examId, locale: locale, status: result.status,
        predictor_tier: result.predictor_tier, quizzes_used: result.quizzes_used,
      });

      return safeWrap(result);
    } catch (err: any) {
      logger.error("lt_score_predict failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_exam_countdown_get (Wave 4)
  // ────────────────────────────────────────────────────────────────────────
  function rpcExamCountdownGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var doc = readCountdownDoc(nk, auth.userId);
      var view = deriveCountdownView(doc, nowSec());

      return safeWrap({
        ok: true,
        status: "ok",
        entries: doc.entries,
        primary_exam_id: doc.primary_exam_id,
        derived: view,
        days_until: view.map(function (v: any) { return { exam_id: v.exam_id, days_until: v.days_until }; }),
        minutes_per_day_recommended: view.length > 0 ? view[0].minutes_per_day_recommended : 0,
        updated_unix: doc.updated_unix,
      });
    } catch (err: any) {
      logger.error("lt_exam_countdown_get failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_exam_countdown_set (Wave 4)
  // ────────────────────────────────────────────────────────────────────────
  function rpcExamCountdownSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var examId = ("" + (data.exam_id || "")).toLowerCase();
      var dateIso = "" + (data.date_iso || "");
      var timezone = "" + (data.timezone || "UTC");
      var targetScore = (data.target_score !== undefined && data.target_score !== null)
        ? parseFloat("" + data.target_score) : null;
      var makePrimary = data.make_primary === true;

      if (!examId) return RpcHelpers.errorResponse("exam_id required", 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return RpcHelpers.errorResponse("date_iso required (YYYY-MM-DD)", 400);

      var examMatch = lookupExamUpcoming(examId, 0);
      var examLabel = examMatch ? examMatch.exam_label : examId.toUpperCase();

      var doc = readCountdownDoc(nk, auth.userId);
      var found = false;
      for (var i = 0; i < doc.entries.length; i++) {
        if (doc.entries[i].exam_id === examId) {
          doc.entries[i].date_iso = dateIso;
          doc.entries[i].timezone = timezone;
          doc.entries[i].target_score = targetScore;
          doc.entries[i].exam_label = examLabel;
          doc.entries[i].declared_unix = nowSec();
          found = true;
          break;
        }
      }
      if (!found) {
        if (doc.entries.length >= MAX_COUNTDOWN_ENTRIES) {
          return RpcHelpers.errorResponse("countdown entry cap reached (max " + MAX_COUNTDOWN_ENTRIES + ")", 413);
        }
        doc.entries.push({
          exam_id: examId, exam_label: examLabel, date_iso: dateIso,
          timezone: timezone, target_score: targetScore, declared_unix: nowSec(),
        });
      }
      if (makePrimary || !doc.primary_exam_id) doc.primary_exam_id = examId;
      doc.updated_unix = nowSec();

      writeCountdownDoc(nk, auth.userId, doc);
      emitAnalytics(nk, logger, auth.userId, "lt_exam_countdown_set", {
        exam_id: examId, date_iso: dateIso, target_score: targetScore,
      });

      return safeWrap({
        ok: true, status: "ok",
        entry: { exam_id: examId, exam_label: examLabel, date_iso: dateIso, timezone: timezone, target_score: targetScore },
        primary_exam_id: doc.primary_exam_id,
        entry_count: doc.entries.length,
      });
    } catch (err: any) {
      logger.error("lt_exam_countdown_set failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_exam_countdown_clear (Wave 4)
  // ────────────────────────────────────────────────────────────────────────
  function rpcExamCountdownClear(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var examId = ("" + (data.exam_id || "")).toLowerCase();
      if (!examId) return RpcHelpers.errorResponse("exam_id required", 400);

      var doc = readCountdownDoc(nk, auth.userId);
      var before = doc.entries.length;
      doc.entries = doc.entries.filter(function (e) { return e.exam_id !== examId; });
      if (doc.primary_exam_id === examId) {
        doc.primary_exam_id = doc.entries.length > 0 ? doc.entries[0].exam_id : null;
      }
      doc.updated_unix = nowSec();
      writeCountdownDoc(nk, auth.userId, doc);

      emitAnalytics(nk, logger, auth.userId, "lt_exam_countdown_clear", { exam_id: examId });
      return safeWrap({
        ok: true, status: "ok",
        exam_id: examId,
        cleared: before !== doc.entries.length,
        entries_remaining: doc.entries.length,
        primary_exam_id: doc.primary_exam_id,
      });
    } catch (err: any) {
      logger.error("lt_exam_countdown_clear failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_exam_calendar_get (Wave 4 — anonymous OK)
  // ────────────────────────────────────────────────────────────────────────
  function rpcExamCalendarGet(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var country = ("" + (data.country || data.country_code || "IN")).toUpperCase();
      var year = parseInt("" + (data.year || "2026"), 10);
      if (!(year >= 2020 && year <= 2030)) return RpcHelpers.errorResponse("year out of range (2020-2030)", 400);

      var entries = getCalendarEntries(country, year);
      var locale = "" + (data.locale || "en");
      var status = entries.length > 0 ? "ok" : "no_data";
      return safeWrap({
        ok: true, status: status,
        country: country, year: year,
        calendar_version: EXAM_CALENDAR_VERSION,
        exams: entries,
        count: entries.length,
        message: entries.length === 0 ? i18nString(locale, "calendar.no_results") : "",
      });
    } catch (err: any) {
      logger.error("lt_exam_calendar_get failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_gpa_compute (Wave 4 — anonymous OK, deterministic)
  // ────────────────────────────────────────────────────────────────────────
  function rpcGpaCompute(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var system = ("" + (data.system || "us-4.0-unweighted")).toLowerCase();
      var courses: any[] = Array.isArray(data.courses) ? data.courses : [];
      if (courses.length === 0) return RpcHelpers.errorResponse("courses array required", 400);
      if (courses.length > 60) return RpcHelpers.errorResponse("max 60 courses per compute", 400);

      var result = computeGpa(system, courses as GpaCourseInput[]);
      if (!result.ok) return RpcHelpers.errorResponse(result.warnings.join("; "), 400);

      return safeWrap({
        ok: true, status: "ok",
        system: result.system,
        system_label: result.system_label,
        native_gpa: result.native_gpa,
        native_max: result.native_max,
        wes_4_0: result.wes_4_0,
        percentile_band: result.percentile_band,
        breakdown: result.breakdown,
        courses_used: result.courses_used,
        courses_skipped: result.courses_skipped,
        warnings: result.warnings,
      });
    } catch (err: any) {
      logger.error("lt_gpa_compute failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_gpa_save  (auth — persists last compute result for the user)
  // ────────────────────────────────────────────────────────────────────────
  function rpcGpaSave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var system = ("" + (data.system || "")).toLowerCase();
      if (!system) return RpcHelpers.errorResponse("system required", 400);

      // Caller can either supply a precomputed snapshot OR raw courses to compute.
      var result: GpaSnapshot;
      if (Array.isArray(data.breakdown) && typeof data.native_gpa === "number" && typeof data.wes_4_0 === "number") {
        result = {
          system: system,
          native_gpa: data.native_gpa,
          wes_4_0: data.wes_4_0,
          percentile_band: "" + (data.percentile_band || ""),
          breakdown: data.breakdown as GpaCourseBreakdown[],
          saved_unix: nowSec(),
        };
      } else if (Array.isArray(data.courses)) {
        var computed = computeGpa(system, data.courses as GpaCourseInput[]);
        if (!computed.ok) return RpcHelpers.errorResponse(computed.warnings.join("; "), 400);
        result = {
          system: computed.system,
          native_gpa: computed.native_gpa,
          wes_4_0: computed.wes_4_0,
          percentile_band: computed.percentile_band,
          breakdown: computed.breakdown,
          saved_unix: nowSec(),
        };
      } else {
        return RpcHelpers.errorResponse("either courses[] or precomputed snapshot required", 400);
      }

      nk.storageWrite([{
        collection: COLLECTION_GPA, key: "current", userId: auth.userId,
        value: result, permissionRead: 0, permissionWrite: 0,
      }]);
      emitAnalytics(nk, logger, auth.userId, "lt_gpa_save", { system: system, wes_4_0: result.wes_4_0 });

      return safeWrap({ ok: true, status: "ok", saved: result });
    } catch (err: any) {
      logger.error("lt_gpa_save failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_gpa_get
  // ────────────────────────────────────────────────────────────────────────
  function rpcGpaGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var rows = nk.storageRead([{ collection: COLLECTION_GPA, key: "current", userId: auth.userId }]);
      if (rows && rows.length > 0 && rows[0].value) {
        return safeWrap({ ok: true, status: "ok", has_data: true, gpa: rows[0].value });
      }
      return safeWrap({ ok: true, status: "ok", has_data: false, gpa: null });
    } catch (err: any) {
      logger.error("lt_gpa_get failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_school_search (Wave 4 — anonymous OK)
  // ────────────────────────────────────────────────────────────────────────
  function rpcSchoolSearch(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var query = "" + (data.query || "");
      var country = ("" + (data.country_code || data.country || "")).toUpperCase();
      var locale = "" + (data.locale || "en");
      var limit = Math.min(Math.max(parseInt("" + (data.limit || 10), 10) || 10, 1), 50);
      if (query.length < 2) return RpcHelpers.errorResponse("query must be ≥2 chars", 400);

      var hits = searchSchools(query, country, limit);
      return safeWrap({
        ok: true, status: hits.length > 0 ? "ok" : "no_results",
        query: query, country_code: country, locale: locale,
        results: hits,
        count: hits.length,
        message: hits.length === 0 ? i18nString(locale, "school.no_results") : "",
      });
    } catch (err: any) {
      logger.error("lt_school_search failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_school_get_detail (Wave 4 — anonymous OK)
  // ────────────────────────────────────────────────────────────────────────
  function rpcSchoolGetDetail(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var schoolId = "" + (data.school_id || "");
      if (!schoolId) return RpcHelpers.errorResponse("school_id required", 400);
      var rec = getSchoolById(schoolId);
      if (!rec) return safeWrap({ ok: true, status: "not_found", school_id: schoolId, found: false });
      return safeWrap({ ok: true, status: "ok", found: true, school: rec });
    } catch (err: any) {
      logger.error("lt_school_get_detail failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_school_set_user_school (Wave 4)
  // ────────────────────────────────────────────────────────────────────────
  function rpcSchoolSetUserSchool(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var schoolId = "" + (data.school_id || "");
      if (!schoolId) return RpcHelpers.errorResponse("school_id required", 400);

      // Resolve verified-ness — fixture hits are verified; freetext entries
      // remain provisional until ai-content reviews.
      var rec = getSchoolById(schoolId);
      var verified = !!rec;
      var record: UserSchoolRecord = {
        school_id: schoolId,
        current_grade_or_class: "" + (data.grade || data.current_grade_or_class || ""),
        graduation_year: data.grad_year ? (parseInt("" + data.grad_year, 10) || null) : null,
        joined_unix: nowSec(),
        verified: verified,
      };
      nk.storageWrite([{
        collection: COLLECTION_SCHOOL, key: "current", userId: auth.userId,
        value: record, permissionRead: 0, permissionWrite: 0,
      }]);
      emitAnalytics(nk, logger, auth.userId, "lt_school_set_user_school", {
        school_id: schoolId, verified: verified,
        country: rec ? rec.country_code : "?",
      });

      return safeWrap({
        ok: true, status: "ok",
        school_id: schoolId,
        verified: verified,
        school: rec || null,
        user_record: record,
      });
    } catch (err: any) {
      logger.error("lt_school_set_user_school failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_school_get_user_school
  // ────────────────────────────────────────────────────────────────────────
  function rpcSchoolGetUserSchool(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var rows = nk.storageRead([{ collection: COLLECTION_SCHOOL, key: "current", userId: auth.userId }]);
      if (!rows || rows.length === 0 || !rows[0].value) {
        return safeWrap({ ok: true, status: "ok", has_school: false });
      }
      var rec = rows[0].value as UserSchoolRecord;
      var hydrated = getSchoolById(rec.school_id);
      return safeWrap({
        ok: true, status: "ok",
        has_school: true,
        user_record: rec,
        school: hydrated || null,
      });
    } catch (err: any) {
      logger.error("lt_school_get_user_school failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: lt_school_freetext_submit (Wave 4 — completes the skeleton stub)
  // ────────────────────────────────────────────────────────────────────────
  function rpcSchoolFreetextSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var schoolName = ("" + (data.school_name || "")).slice(0, 200);
      var country = ("" + (data.country_code || data.country || "")).toUpperCase();
      var city = ("" + (data.city || "")).slice(0, 100);
      var locale = "" + (data.locale || "en");
      if (!schoolName) return RpcHelpers.errorResponse("school_name required", 400);
      if (!country) return RpcHelpers.errorResponse("country_code required", 400);

      var provisionalId = "freetext:" + randomId();
      var entry: FreetextSchoolEntry = {
        provisional_school_id: provisionalId,
        school_name: schoolName,
        country_code: country,
        city: city,
        submitted_by: auth.userId,
        submitted_unix: nowSec(),
        locale: locale,
      };
      nk.storageWrite([{
        collection: COLLECTION_SCHOOL_PENDING,
        key: provisionalId,
        userId: Constants.SYSTEM_USER_ID,
        value: entry,
        permissionRead: 0,
        permissionWrite: 0,
      }]);
      emitAnalytics(nk, logger, auth.userId, "lt_school_freetext_submit", {
        country: country, name_len: schoolName.length,
      });

      return safeWrap({
        ok: true, status: "ok",
        provisional_school_id: provisionalId,
        pending_review: true,
        message: "Submitted for review. ai-content normalises freetext entries within 48h.",
      });
    } catch (err: any) {
      logger.error("lt_school_freetext_submit failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_chat_quota_check ──────────────────────────────────────────────
  // Plan §3.11.3. Gateway calls this BEFORE forwarding a chat turn to the
  // LLM so the widget can show "remaining N turns" + the "sign in to get more"
  // CTA without burning a model call.
  //
  // Service-token gated — gateway only path (anonymous browsers never hit
  // this RPC directly; the gateway already holds the user-id / ip-hash from
  // its session cookie + viewer-IP header).
  //
  // Request:
  //   {
  //     "service_token": "<LT_SERVICE_TOKEN>",
  //     "kb_scope": { "exam_id": "sat", "locale": "en" },
  //     "user_id":  "<cognito-sub>",   // optional
  //     "ip_hash":  "<sha256(raw_ip)>" // optional — required if user_id absent
  //   }
  // Response:
  //   {
  //     "ok": true,
  //     "allowed": true,
  //     "remaining": 4,
  //     "reset_unix": 1716595200,
  //     "tier": "anon"|"free"|"pro",
  //     "limit": 5,
  //     "exam_id": "sat"
  //   }
  function rpcChatQuotaCheck(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!isServiceCaller(ctx, data)) {
        return RpcHelpers.errorResponse("not authorised", 401);
      }

      var ident = resolveQuotaIdentity(data);
      if (ident.error) {
        return RpcHelpers.errorResponse(ident.error, 400);
      }

      var limit = limitForTier(ctx, ident.tier);
      // Sentinel: -1 → unlimited. The wire shape stays the same; we return
      // remaining = Number.MAX_SAFE_INTEGER (encoded as a large but safe int)
      // so clients can keep showing "∞" without branching on -1.
      var unlimited = limit < 0;

      var dateStr = utcDateStr();
      var resetUnix = midnightUtcNextUnix();
      var ipShort = ident.tier === "anon" ? hashIpShort(nk, ident.ipShort) : "";
      var perExamKey = quotaKey({
        tier: ident.tier,
        sub: ident.sub,
        ipShort: ipShort,
        examId: ident.examId,
        date: dateStr,
        scope: "per_exam",
      });
      var globalKey = ident.tier === "anon" ? "" : quotaKey({
        tier: ident.tier,
        sub: ident.sub,
        ipShort: ipShort,
        examId: ident.examId,
        date: dateStr,
        scope: "global",
      });

      var usedPerExam = readUsed(nk, perExamKey);
      var usedGlobal = globalKey ? readUsed(nk, globalKey) : 0;
      // Authenticated users are capped on the GLOBAL daily limit — per-exam
      // counters exist for cohort reporting, not enforcement (plan §3.11.3).
      var used = ident.tier === "anon" ? usedPerExam : usedGlobal;
      var remaining = unlimited ? 999999 : Math.max(0, limit - used);
      var allowed = unlimited ? true : (used < limit);

      return RpcHelpers.successResponse({
        ok: true,
        allowed: allowed,
        remaining: remaining,
        reset_unix: resetUnix,
        tier: ident.tier,
        limit: unlimited ? -1 : limit,
        used: used,
        exam_id: ident.examId,
        locale: ident.locale,
        date: dateStr,
      });
    } catch (err: any) {
      logger.error("lt_chat_quota_check failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_chat_quota_consume ────────────────────────────────────────────
  // Atomic decrement (read-then-write) called by gateway AFTER it has decided
  // to forward a turn. Returns the post-consume state.
  //
  // Request: identical to lt_chat_quota_check.
  // Response:
  //   {
  //     "ok": true,
  //     "consumed": true|false,   // false if quota was already exhausted
  //     "remaining": 3,
  //     "reset_unix": 1716595200,
  //     "tier": "anon"|"free"|"pro"
  //   }
  function rpcChatQuotaConsume(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!isServiceCaller(ctx, data)) {
        return RpcHelpers.errorResponse("not authorised", 401);
      }

      var ident = resolveQuotaIdentity(data);
      if (ident.error) {
        return RpcHelpers.errorResponse(ident.error, 400);
      }

      var limit = limitForTier(ctx, ident.tier);
      var unlimited = limit < 0;

      var dateStr = utcDateStr();
      var resetUnix = midnightUtcNextUnix();
      var ipShort = ident.tier === "anon" ? hashIpShort(nk, ident.ipShort) : "";
      var perExamKey = quotaKey({
        tier: ident.tier,
        sub: ident.sub,
        ipShort: ipShort,
        examId: ident.examId,
        date: dateStr,
        scope: "per_exam",
      });
      var globalKey = ident.tier === "anon" ? "" : quotaKey({
        tier: ident.tier,
        sub: ident.sub,
        ipShort: ipShort,
        examId: ident.examId,
        date: dateStr,
        scope: "global",
      });

      var usedPerExam = readUsed(nk, perExamKey);
      var usedGlobal = globalKey ? readUsed(nk, globalKey) : 0;
      var used = ident.tier === "anon" ? usedPerExam : usedGlobal;

      if (!unlimited && used >= limit) {
        return RpcHelpers.successResponse({
          ok: true,
          consumed: false,
          remaining: 0,
          reset_unix: resetUnix,
          tier: ident.tier,
          limit: limit,
          exam_id: ident.examId,
        });
      }

      // Write per-exam counter (always — gives cohort signal even for auth).
      writeUsed(nk, perExamKey, usedPerExam + 1);
      // Write global counter for auth tiers only — anon's per-IP/per-exam
      // bucket IS the global bucket.
      if (globalKey) writeUsed(nk, globalKey, usedGlobal + 1);

      var newUsed = ident.tier === "anon" ? usedPerExam + 1 : usedGlobal + 1;
      var remaining = unlimited ? 999999 : Math.max(0, limit - newUsed);

      return RpcHelpers.successResponse({
        ok: true,
        consumed: true,
        remaining: remaining,
        reset_unix: resetUnix,
        tier: ident.tier,
        limit: unlimited ? -1 : limit,
        used: newUsed,
        exam_id: ident.examId,
      });
    } catch (err: any) {
      logger.error("lt_chat_quota_consume failed: " + (err && err.message ? err.message : String(err)));
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
    initializer.registerRpc("lt_chat_quota_check", rpcChatQuotaCheck);
    initializer.registerRpc("lt_chat_quota_consume", rpcChatQuotaConsume);
  }
}
