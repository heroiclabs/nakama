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
// RPCs registered (19)
// --------------------
//   lt_score_predict                  service-only (auth) — § 3 of plan
//   lt_exam_countdown_get             service-only        — § 4 of plan
//   lt_exam_countdown_set             service-only        — § 4 of plan
//   lt_exam_countdown_clear           service-only        — § 4 of plan
//   lt_countdown_visit                service-only (gracefully degrades anon) — engaging-UI § 4.4
//   lt_study_log_log                  service-only        — engaging-UI § 4.5
//   lt_study_log_heatmap              service-only (gracefully degrades anon) — engaging-UI § 4.6
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
//   lt_learner_state_get              service-only (auth) — § 2.5 / § 3.13.1
//   lt_learner_insights_get           service-only (auth) — § 3.13.2
//   lt_learner_soft_cta_check         service-only (auth) — § 3.13.4
//
// No-exam fallback (§ 2.5 / § 3.13)
// --------------------------------
// Most QuizVerse visitors are not exam candidates — trivia browsers, parents,
// students without a declared target. Exam-prep terminology is a wall to them,
// not a draw. This module ships the learner-mindset surface so the same web
// route renders elegantly for both modes:
//   - lt_learner_state_get      → resolves which of the 4 modes (§ 2.5.1)
//                                 a user is in (deterministic, cached 6h)
//   - lt_learner_insights_get   → returns Learner-Insights payload — uses
//                                 ONLY learner-mode vocabulary from § 2.5.3
//                                 (no "predicted score", "AIR", "scaled
//                                 score", "grade boundary", "cutoff").
//   - lt_score_predict          → returns a graceful redirect when
//                                 exam_id is missing or sentinel
//                                 "learner_general" (§ 3.13.3) so the
//                                 route never errors on visitors without a
//                                 declared exam.
//   - lt_learner_soft_cta_check → 14-day soft exam-CTA gate (§ 3.13.4) —
//                                 only fires for users who meet the
//                                 engagement floor (≥10 quizzes/wk × 2 wks
//                                 AND ≥10 active days in last 14d) AND
//                                 have not been nudged in the prior 14 days.
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
//   collection: "qv_lt_school"             key: "current"     → UserSchoolRecord
//   collection: "qv_lt_countdown"          key: "doc"         → ExamCountdownDoc
//   collection: "qv_lt_gpa"                key: "current"     → GpaSnapshot
//   collection: "qv_lt_predictor_context"  key: "<exam_id>"   → PredictorContextBlock
//   collection: "qv_lt_school_pending"     key: "<provisional_id>" → freetext queue
//   collection: "qv_lt_learner_state_cache" key: "v1"         → LearnerStateCache (TTL 6h)
//   collection: "qv_lt_soft_cta_state"     key: "v1"          → { lastNudgeUnix }
//   collection: "qv_user_exam"             key: "declared"    → declared exam (Wave 4-5)
//   collection: "qv_user_quiz_history"     key: "30d_summary" → quiz aggregates (Wave 4-5)
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
  var COLLECTION_LEARNER_STATE_CACHE = "qv_lt_learner_state_cache";
  var COLLECTION_SOFT_CTA_STATE = "qv_lt_soft_cta_state";
  // Placeholder keys consumed in Phase A — Wave 4-5 subagent rewires these
  // against the live qv_u_<sub>_exam / qv_u_<sub>_quiz_history surfaces.
  var COLLECTION_USER_EXAM = "qv_user_exam";
  var COLLECTION_USER_QUIZ_HISTORY = "qv_user_quiz_history";
  var SKELETON_PHASE = "skeleton-A";

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

  // 6-hour cache for lt_learner_state_get (§ 3.13.1).
  var LEARNER_STATE_CACHE_TTL_SEC = 6 * 60 * 60;
  // 14-day soft exam-CTA cooldown (§ 3.13.4).
  var SOFT_CTA_COOLDOWN_SEC = 14 * 86400;

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

  // Play 2 — entitlement-aware quota (the "Phase D" promotion the identity
  // resolver anticipated). A paid OR trialing subscriber reading their
  // qv_entitlements subscription record is promoted free → pro, so the
  // card-required trial actually unlocks the higher chat cap. Fully additive:
  // if no record exists (or the id doesn't resolve), the caller stays "free".
  function entitlementActiveForOwner(nk: nkruntime.Nakama, ownerId: string): boolean {
    if (!ownerId) return false;
    try {
      var rows = nk.storageRead([{
        collection: "qv_entitlements",
        key: "subscriptions",
        userId: ownerId,
      }]);
      if (!rows || rows.length === 0 || !rows[0].value) return false;
      var v: any = rows[0].value;
      if (!v.tier) return false;
      var status = "" + (v.status || "");
      if (status !== "active" && status !== "trialing") return false;
      if (v.expiresAt) {
        var expMs = new Date(v.expiresAt).getTime();
        if (!isNaN(expMs) && expMs < Date.now()) return false;
      }
      return true;
    } catch (_e: any) {
      return false;
    }
  }

  function isProByEntitlement(nk: nkruntime.Nakama, userId: string): boolean {
    if (!userId) return false;
    // 1) Canonical path: the entitlement is written under the Nakama account id
    //    (rc_sync's app_user_id contract; the web SPA now bills against the
    //    Nakama account id via _nkUserId()).
    if (entitlementActiveForOwner(nk, userId)) return true;
    // 2) Reconciliation: older grants — and any client that still posts the
    //    device-auth id (the web USER_ID) — write the entitlement under a device
    //    id linked to this Nakama account rather than the account id. The web
    //    session is minted with authenticate/device, so that device id is on the
    //    account. Resolve the account's devices and check each so a trialing
    //    subscriber's higher chat cap unlocks regardless of which id was used.
    try {
      var account: any = nk.accountGetId(userId);
      var devices: any = account && account.devices ? account.devices : null;
      if (devices && devices.length) {
        for (var i = 0; i < devices.length; i++) {
          var did = devices[i] && devices[i].id ? "" + devices[i].id : "";
          if (did && did !== userId && entitlementActiveForOwner(nk, did)) return true;
        }
      }
    } catch (_e2: any) {
      // accountGetId failures fail safe → caller stays "free".
    }
    return false;
  }

  function promoteIdentityByEntitlement(nk: nkruntime.Nakama, ident: QuotaIdentity): QuotaIdentity {
    if (ident.tier === "free" && ident.sub && isProByEntitlement(nk, ident.sub)) {
      ident.tier = "pro";
    }
    return ident;
  }

  // ── No-exam fallback — pure logic helpers (§ 2.5 / § 3.13) ────────────────
  //
  // These are kept as pure functions (no nk / ctx / logger) so the
  // skeleton.test.ts micro-runner can exercise them without mocking the
  // Nakama runtime.

  export interface LearnerStateInputs {
    declared_intent: string | null;     // 'exam_prep' | 'learner' | 'parent' | null
    has_exam_declared: boolean;
    has_school_declared: boolean;
    quiz_count_last_30d: number;
  }

  export interface LearnerStateDerived {
    mode: string;                       // 'exam' | 'learner' | 'parent' | 'cold_start'
    has_history: boolean;
    copy_namespace: string;             // drives every i18n string lookup
    recommended_tool: string;
    display_name_for_user: string;
  }

  // § 3.13.1 deterministic state derivation. Same input → same mode.
  //
  //   if declared_intent == 'parent'                          → 'parent'
  //   else if declared_intent == 'exam_prep'
  //         OR has_exam_declared                              → 'exam'
  //   else if has_school_declared OR has_history              → 'learner'
  //   else                                                    → 'cold_start'
  //
  // `has_history` is `quiz_count_last_30d >= 5` (matches § 2.5.1 state D
  // threshold — "auth'd with <5 quizzes" stays cold-start).
  export function deriveLearnerMode(inputs: LearnerStateInputs): LearnerStateDerived {
    var declared = inputs.declared_intent || null;
    var hasHistory = (inputs.quiz_count_last_30d || 0) >= 5;
    var mode: string;

    if (declared === "parent") {
      mode = "parent";
    } else if (declared === "exam_prep" || inputs.has_exam_declared) {
      mode = "exam";
    } else if (inputs.has_school_declared || hasHistory) {
      mode = "learner";
    } else {
      mode = "cold_start";
    }

    var recommendedTool: string;
    var displayName: string;
    if (mode === "parent") {
      recommendedTool = "/tools/parent-dashboard";
      displayName = "parent";
    } else if (mode === "exam") {
      recommendedTool = "/tools/score-predictor";
      displayName = "exam candidate";
    } else if (mode === "learner") {
      recommendedTool = "/tools/learn";
      displayName = "learner";
    } else {
      recommendedTool = "/tools/learn";
      displayName = "new explorer";
    }

    return {
      mode: mode,
      has_history: hasHistory,
      copy_namespace: mode === "cold_start" ? "cold_start" : mode,
      recommended_tool: recommendedTool,
      display_name_for_user: displayName,
    };
  }

  // § 3.13.4 — 14-day soft exam-CTA gate. We only nudge a learner-mode user
  // toward an exam when they have demonstrably high engagement AND have not
  // been nudged within the cooldown window.
  //
  // Floor (per plan): ≥10 quizzes/week × 2 weeks  → 20 quizzes in 2w
  //                   AND ≥10 active days in last 14 days
  // Cooldown:         never nudge twice within 14 days
  //
  // Exposed as a pure function so the gateway / unit tests can call it
  // without an RPC round-trip.
  export function shouldShowSoftExamCta(
    metrics: { quizzes_played_last_2w: number; daysActive_last_2w: number },
    lastNudgeUnix: number | null
  ): boolean {
    if (!metrics) return false;
    if ((metrics.quizzes_played_last_2w || 0) < 20) return false;
    if ((metrics.daysActive_last_2w || 0) < 10) return false;
    if (lastNudgeUnix && (Date.now() / 1000 - lastNudgeUnix) < SOFT_CTA_COOLDOWN_SEC) return false;
    return true;
  }

  // § 3.13.2 — Learner Insights payload.
  //
  // Phase A: returns representative mock metrics (status='mock_data') so the
  // web route can render the full layout while Wave 4-5 wires real reads
  // against qv_u_<sub>_quiz_history. The CRITICAL Phase-A contract is the
  // no-exam-jargon guarantee — every string in this payload is restricted to
  // the learner-mode vocabulary from § 2.5.3. The lint test in
  // __tests__/skeleton.test.ts verifies (§ 3.13.6 A25).
  //
  // TODO(Wave 4-5): replace mock metrics with real engagement-data reads
  //   - quizzes_played / accuracy from qv_u_<sub>_quiz_history
  //   - streak data from qv_user_streaks
  //   - favorite_topics from existing topic-mastery derivation in user-model
  //   - peer_percentile_* from a nightly cohort aggregate
  export function buildLearnerInsightsResponse(args: {
    state: string;       // 'authed' | 'anon'
    mode: string;        // 'learner' | 'cold_start'
    locale: string;
  }): any {
    var coldStart = args.mode === "cold_start";

    var zeroMetrics: any = {
      quizzes_played: 0,
      total_questions: 0,
      correct_questions: 0,
      overall_accuracy: 0,
      accuracy_trend_30d: 0,
      longest_streak_days: 0,
      current_streak_days: 0,
      favorite_topics: [],
      weakest_topics: [],
      peer_percentile_overall: 0,
      peer_percentile_per_topic: {},
    };

    // Representative-but-mocked metrics — every string label uses
    // learner-mode vocabulary only. NO forbidden tokens (predicted score /
    // AIR / scaled score / grade boundary / cutoff / percentile rank).
    var mockMetrics: any = {
      quizzes_played: 12,
      total_questions: 144,
      correct_questions: 98,
      overall_accuracy: 0.68,
      accuracy_trend_30d: 0.04,
      longest_streak_days: 5,
      current_streak_days: 3,
      favorite_topics: [
        { topic_id: "history_world", topic_display: "World History", mastery_pct: 78 },
        { topic_id: "biology_cells", topic_display: "Cell Biology", mastery_pct: 72 },
        { topic_id: "math_algebra", topic_display: "Algebra", mastery_pct: 65 },
      ],
      weakest_topics: [
        { topic_id: "math_geometry", topic_display: "Geometry", mastery_pct: 41 },
        { topic_id: "physics_waves", topic_display: "Waves and Sound", mastery_pct: 38 },
        { topic_id: "chemistry_organic", topic_display: "Organic Chemistry", mastery_pct: 33 },
      ],
      peer_percentile_overall: 64,
      peer_percentile_per_topic: {
        "history_world": 81,
        "biology_cells": 73,
        "math_algebra": 58,
      },
    };

    var cta: any;
    if (coldStart) {
      // § 3.13.2 — cold-start CTA hard-coded per plan.
      cta = {
        kind: "try_a_topic",
        copy_key: "cta.cold_start.play_5_quizzes",
        target_route: "/tools/learn",
      };
    } else {
      cta = {
        kind: "try_a_topic",
        copy_key: "cta.learner.try_a_topic",
        target_route: "/tools/learn",
      };
    }

    return {
      ok: true,
      state: args.state,
      mode: coldStart ? "cold_start" : "learner",
      metrics: coldStart ? zeroMetrics : mockMetrics,
      cta: cta,
      // Explicit contract guarantee — see § 3.13.2 last bullet. The lint
      // test asserts this field is the literal boolean `false` in every
      // response.
      forbidden_copy: false,
      status: "mock_data",
      phase: "A",
      locale: args.locale,
      module_version: MODULE_VERSION,
      generated_unix: nowSec(),
    };
  }

  // Storage helpers for the learner-state RPCs. Wrapped in try/catch so a
  // missing storage object (the common case in Phase A — quiz history isn't
  // wired yet) degrades to "no data" rather than throwing.
  function readStorageBool(nk: nkruntime.Nakama, collection: string, key: string, userId: string): boolean {
    try {
      var rows = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
      return !!(rows && rows.length > 0 && rows[0].value);
    } catch (_e: any) {
      return false;
    }
  }

  function readQuizCount30d(nk: nkruntime.Nakama, userId: string): number {
    try {
      var rows = nk.storageRead([{
        collection: COLLECTION_USER_QUIZ_HISTORY,
        key: "30d_summary",
        userId: userId,
      }]);
      if (rows && rows.length > 0 && rows[0].value) {
        var v: any = rows[0].value;
        var n = parseInt("" + (v.quiz_count_last_30d || v.count || 0), 10);
        return isNaN(n) ? 0 : n;
      }
    } catch (_e: any) { /* no history yet */ }
    return 0;
  }

  function readCachedLearnerState(nk: nkruntime.Nakama, userId: string): any | null {
    try {
      var rows = nk.storageRead([{
        collection: COLLECTION_LEARNER_STATE_CACHE,
        key: "v1",
        userId: userId,
      }]);
      if (rows && rows.length > 0 && rows[0].value) {
        var v: any = rows[0].value;
        var cachedAt = parseInt("" + (v.cachedAt || 0), 10);
        if (!isNaN(cachedAt) && (nowSec() - cachedAt) < LEARNER_STATE_CACHE_TTL_SEC) {
          return v;
        }
      }
    } catch (_e: any) { /* cache miss */ }
    return null;
  }

  function writeCachedLearnerState(nk: nkruntime.Nakama, userId: string, value: any): void {
    try {
      var entry: any = { cachedAt: nowSec() };
      for (var k in value) {
        if (Object.prototype.hasOwnProperty.call(value, k)) entry[k] = value[k];
      }
      nk.storageWrite([{
        collection: COLLECTION_LEARNER_STATE_CACHE,
        key: "v1",
        userId: userId,
        value: entry,
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (_e: any) { /* best-effort cache; failure is non-fatal */ }
  }

  function readLastNudgeUnix(nk: nkruntime.Nakama, userId: string): number | null {
    try {
      var rows = nk.storageRead([{
        collection: COLLECTION_SOFT_CTA_STATE,
        key: "v1",
        userId: userId,
      }]);
      if (rows && rows.length > 0 && rows[0].value) {
        var v: any = rows[0].value;
        var ts = parseInt("" + (v.lastNudgeUnix || 0), 10);
        return isNaN(ts) || ts <= 0 ? null : ts;
      }
    } catch (_e: any) { /* never nudged */ }
    return null;
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
    // PLAN-EXAM_COUNTDOWN_ENGAGING_UI § 4.2 — new engagement fields.
    // All optional for backwards-compat with docs written before the upgrade.
    theme?: string;                              // "default" | "forest" | "cupcake" | "nord" | "retro"
    milestones_celebrated?: string[];            // ["sat:T-100", "sat:T-30", …] — dedupes milestone toasts
    last_visit_unix?: number;                    // streak rolling window anchor
    streak_days?: number;                        // consecutive-day visit count
    longest_streak_days?: number;                // bragging right (monotonically non-decreasing)
  }
  // Per-day study log entry — collection qv_lt_study_log / key=YYYY-MM-DD.
  interface StudyLogEntry {
    date_iso: string;
    minutes: number;                             // 0 = "no study" (still counts as a visit)
    exam_focus: string;                          // exam_id, or "general" when not specified
    logged_unix: number;
    channel: string;                             // "web" | "unity" | "voice"
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
          theme: v.theme || "default",
          milestones_celebrated: Array.isArray(v.milestones_celebrated) ? v.milestones_celebrated : [],
          last_visit_unix: v.last_visit_unix || 0,
          streak_days: v.streak_days || 0,
          longest_streak_days: v.longest_streak_days || 0,
        };
      }
    } catch (e: any) { /* fall through */ }
    return {
      entries: [], primary_exam_id: null, updated_unix: 0,
      theme: "default", milestones_celebrated: [],
      last_visit_unix: 0, streak_days: 0, longest_streak_days: 0,
    };
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
  // RPC: lt_score_predict
  //
  // Implementation: Wave 5 — IRT/percentile Bayes posterior over recent quiz
  // history. See plan § 3.
  //
  // No-exam fallback (§ 3.13.3) — when called without an exam_id or with the
  // sentinel "learner_general", we return a structured redirect payload
  // instead of erroring. The gateway respects this and silently invokes
  // lt_learner_insights_get; the visitor sees a Learner Insights card, not an
  // error. This is the contract that makes /tools/score-predictor degrade
  // gracefully for state-B/C/D users (§ 2.5.1).
  // ────────────────────────────────────────────────────────────────────────
  function rpcScorePredict(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var examId = "" + (data.exam_id || "");
      var locale = "" + (data.locale || "en");

      // § 3.13.3: no exam declared OR sentinel → redirect, never error.
      if (!examId || examId === "learner_general") {
        return RpcHelpers.successResponse({
          ok: true,
          redirect_to: "lt_learner_insights_get",
          reason: "no_exam_declared",
          suggested_action: "call lt_learner_insights_get for this user",
          locale: locale,
          module_version: MODULE_VERSION,
          generated_unix: nowSec(),
        });
      }

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
        // PLAN-EXAM_COUNTDOWN_ENGAGING_UI § 4.7
        theme: doc.theme || "default",
        milestones_celebrated: doc.milestones_celebrated || [],
        streak_days: doc.streak_days || 0,
        longest_streak_days: doc.longest_streak_days || 0,
        last_visit_unix: doc.last_visit_unix || 0,
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
      var themeIn = ("" + (data.theme || "")).toLowerCase();
      // PLAN-EXAM_COUNTDOWN_ENGAGING_UI § 4.2 — allow-list themes; ignore unknown.
      var allowedThemes = ["default", "forest", "cupcake", "nord", "retro"];
      var themeNext: string | null = null;
      for (var ti = 0; ti < allowedThemes.length; ti++) {
        if (themeIn === allowedThemes[ti]) { themeNext = themeIn; break; }
      }

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
      if (themeNext) doc.theme = themeNext;
      doc.updated_unix = nowSec();

      writeCountdownDoc(nk, auth.userId, doc);
      emitAnalytics(nk, logger, auth.userId, "lt_exam_countdown_set", {
        exam_id: examId, date_iso: dateIso, target_score: targetScore,
        theme: themeNext || doc.theme || "default",
      });

      return safeWrap({
        ok: true, status: "ok",
        entry: { exam_id: examId, exam_label: examLabel, date_iso: dateIso, timezone: timezone, target_score: targetScore },
        primary_exam_id: doc.primary_exam_id,
        entry_count: doc.entries.length,
        theme: doc.theme || "default",
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

  // ════════════════════════════════════════════════════════════════════════
  // RPCs: lt_countdown_visit, lt_study_log_log, lt_study_log_heatmap
  // PLAN-EXAM_COUNTDOWN_ENGAGING_UI § 4.4-4.6
  //
  // These wire up the engaging-UI upgrade: streak counter, "I studied today"
  // habit loop, and the 90-day heatmap. All three are auth-required (service
  // token OR Nakama session). Anonymous callers get a graceful 200 with empty
  // payload so the web component can render a sign-in nudge without throwing.
  // ════════════════════════════════════════════════════════════════════════

  var COLLECTION_STUDY_LOG = "qv_lt_study_log";
  var STREAK_GRACE_SECONDS = 48 * 3600;   // 2-day forgiveness window
  var STREAK_BUCKET_SECONDS = 24 * 3600;  // 1-day no-op window
  var MAX_HEATMAP_DAYS = 180;             // safety cap on storageList page
  var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function dateIsoForUnix(unix: number): string {
    var d = new Date(unix * 1000);
    var m = d.getUTCMonth() + 1;
    var dy = d.getUTCDate();
    return d.getUTCFullYear() + "-" + (m < 10 ? "0" + m : "" + m) + "-" + (dy < 10 ? "0" + dy : "" + dy);
  }

  // RPC: lt_countdown_visit — idempotent daily-touch (drives streak).
  function rpcCountdownVisit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) {
        // Anonymous: return a 200 with zeros so the web component doesn't error.
        return safeWrap({
          ok: true, status: "anonymous",
          streak_days: 0, longest_streak_days: 0,
          incremented: false, last_visit_unix: 0,
        });
      }

      var doc = readCountdownDoc(nk, auth.userId);
      var now = nowSec();
      var last = doc.last_visit_unix || 0;
      var gap = last > 0 ? (now - last) : Number.MAX_SAFE_INTEGER;

      var streak = doc.streak_days || 0;
      var longest = doc.longest_streak_days || 0;
      var incremented = false;

      if (last === 0) {
        // First visit ever — streak starts at 1.
        streak = 1;
        incremented = true;
      } else if (gap < STREAK_BUCKET_SECONDS) {
        // Already counted today — no-op.
        incremented = false;
      } else if (gap < STREAK_GRACE_SECONDS) {
        streak = streak + 1;
        incremented = true;
      } else {
        // Beyond grace window — streak resets but doesn't lose longest.
        streak = 1;
        incremented = true;
      }
      if (streak > longest) longest = streak;

      doc.streak_days = streak;
      doc.longest_streak_days = longest;
      if (incremented) doc.last_visit_unix = now;
      doc.updated_unix = now;
      writeCountdownDoc(nk, auth.userId, doc);

      emitAnalytics(nk, logger, auth.userId, "lt_countdown_visit", {
        streak_days: streak, longest_streak_days: longest, incremented: incremented,
      });

      return safeWrap({
        ok: true, status: "ok",
        streak_days: streak,
        longest_streak_days: longest,
        incremented: incremented,
        last_visit_unix: doc.last_visit_unix || now,
      });
    } catch (err: any) {
      logger.error("lt_countdown_visit failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // RPC: lt_study_log_log — upsert per (user, date).
  function rpcStudyLogLog(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var dateIso = "" + (data.date_iso || dateIsoForUnix(nowSec()));
      if (!ISO_DATE_RE.test(dateIso)) return RpcHelpers.errorResponse("date_iso must be YYYY-MM-DD", 400);

      var minutes = parseInt("" + (data.minutes || 0), 10);
      if (!(minutes >= 0)) minutes = 0;
      if (minutes > 1440) minutes = 1440;   // cap at one full day

      var examFocus = ("" + (data.exam_focus || "general")).toLowerCase().slice(0, 32);
      var channel = ("" + (data.channel || "web")).toLowerCase().slice(0, 16);
      if (channel !== "web" && channel !== "unity" && channel !== "voice") channel = "web";

      var entry: StudyLogEntry = {
        date_iso: dateIso,
        minutes: minutes,
        exam_focus: examFocus,
        logged_unix: nowSec(),
        channel: channel,
      };

      nk.storageWrite([{
        collection: COLLECTION_STUDY_LOG,
        key: dateIso,
        userId: auth.userId,
        value: entry,
        permissionRead: 0,
        permissionWrite: 0,
      }]);

      emitAnalytics(nk, logger, auth.userId, "lt_study_log_log", {
        date_iso: dateIso, minutes: minutes, exam_focus: examFocus, channel: channel,
      });

      return safeWrap({
        ok: true, status: "ok",
        date_iso: dateIso, minutes: minutes,
        exam_focus: examFocus, logged_unix: entry.logged_unix,
      });
    } catch (err: any) {
      logger.error("lt_study_log_log failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // RPC: lt_study_log_heatmap — last-N-day study log for heatmap render.
  function rpcStudyLogHeatmap(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) {
        return safeWrap({
          ok: true, status: "anonymous", days: [],
          total_minutes: 0, days_studied: 0, days_in_window: 0, consistency_pct: 0,
        });
      }

      var daysBack = parseInt("" + (data.days_back || 90), 10);
      if (!(daysBack >= 1)) daysBack = 90;
      if (daysBack > MAX_HEATMAP_DAYS) daysBack = MAX_HEATMAP_DAYS;

      // Pull the user's study-log rows; index page is sufficient (max ~180 docs).
      var byDate: { [k: string]: StudyLogEntry } = {};
      try {
        var listResult = nk.storageList(auth.userId, COLLECTION_STUDY_LOG, MAX_HEATMAP_DAYS, "");
        var rows = listResult && listResult.objects ? listResult.objects : [];
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (!r || !r.key || !r.value) continue;
          var v = r.value as StudyLogEntry;
          byDate["" + r.key] = {
            date_iso: "" + r.key,
            minutes: parseInt("" + (v.minutes || 0), 10) || 0,
            exam_focus: "" + (v.exam_focus || "general"),
            logged_unix: parseInt("" + (v.logged_unix || 0), 10) || 0,
            channel: "" + (v.channel || "web"),
          };
        }
      } catch (e: any) {
        logger.warn("[learner-toolbelt] study-log read failed for user " + auth.userId + ": " + (e && e.message ? e.message : String(e)));
      }

      // Build dense list newest→oldest covering exactly daysBack days.
      var now = nowSec();
      var days: any[] = [];
      var totalMinutes = 0;
      var daysStudied = 0;
      for (var d = 0; d < daysBack; d++) {
        var iso = dateIsoForUnix(now - d * 86400);
        var hit = byDate[iso];
        var minutesForDay = hit ? hit.minutes : 0;
        var studied = minutesForDay > 0;
        if (studied) daysStudied++;
        totalMinutes += minutesForDay;
        days.push({
          date_iso: iso,
          minutes: minutesForDay,
          studied: studied,
          exam_focus: hit ? hit.exam_focus : "",
        });
      }

      var consistencyPct = daysBack > 0 ? Math.round((daysStudied * 100) / daysBack) : 0;

      return safeWrap({
        ok: true, status: "ok",
        days: days,
        total_minutes: totalMinutes,
        days_studied: daysStudied,
        days_in_window: daysBack,
        consistency_pct: consistencyPct,
      });
    } catch (err: any) {
      logger.error("lt_study_log_heatmap failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Quizzy Clipper — clip capture surface
  // PLAN-QUIZZY_CLIPPER_BROWSER_EXTENSION.md §3.4
  //
  // 3 service-only RPCs back all three capture surfaces (MV3 extension,
  // email-forward inbox, web /notes page):
  //   lt_clip_save    — upsert a captured clip
  //   lt_clips_list   — paginated list with search + filters
  //   lt_clip_delete  — soft semantics (hard delete here; 90d retention cron
  //                     is a follow-up backend task per plan Week 4 D3)
  //
  // Storage: collection qv_lt_clips, key = clip_id, value = ClipRecord,
  // permissionRead/Write = 0 (server-only; owner reads via service token).
  //
  // Media note: snapshot/audio blobs are destined for the qv-clip-media-prod
  // S3 bucket with signed URLs (plan §3.4). The S3 signer is a Week-1 backend
  // follow-up; until it lands we inline small snapshots (<= CLIP_MAX_INLINE_MEDIA)
  // as a data URL thumb and flag larger ones media_pending so the contract
  // response stays stable.
  // ════════════════════════════════════════════════════════════════════════

  var COLLECTION_CLIPS = "qv_lt_clips";
  var CLIP_MAX_TITLE = 256;
  var CLIP_MAX_SELECTION = 8192;
  var CLIP_MAX_SNIPPET = 2048;
  var CLIP_MAX_TAGS = 12;
  var CLIP_MAX_TAG_LEN = 32;
  var CLIP_MAX_INLINE_MEDIA = 524288;     // 512KB inline cap (pre-S3)
  var CLIP_LIST_MAX_LIMIT = 100;
  var CLIP_LIST_DEFAULT_LIMIT = 50;
  var CLIP_SOFT_CAP_FREE = 500;           // plan Week 3 D3 — free tier soft cap
  var CLIP_EXAM_TAG_RE = /^[a-z0-9_]{1,32}$/;
  var CLIP_SOURCE_TYPES = ["web", "snapshot", "voice", "email"];

  interface ClipRecord {
    clip_id: string;
    source_type: string;
    url: string;
    title: string;
    selection_text: string;
    page_text_snippet: string;
    snapshot_thumb_url: string;       // inline data URL (<=512KB) or "" when media_pending / S3
    voice_transcript: string;
    voice_audio_url: string;
    exam_tag: string | null;
    tags: string[];
    ai_summary: string | null;        // null until the AI Notes pipeline fills it
    media_pending: boolean;
    created_at_unix: number;
  }

  function clipSanitizeTags(raw: any): string[] {
    if (!Array.isArray(raw)) return [];
    var out: string[] = [];
    for (var i = 0; i < raw.length && out.length < CLIP_MAX_TAGS; i++) {
      var tag = ("" + raw[i]).trim().toLowerCase().slice(0, CLIP_MAX_TAG_LEN);
      if (tag && out.indexOf(tag) < 0) out.push(tag);
    }
    return out;
  }

  function clipResolveExamTag(nk: nkruntime.Nakama, userId: string, supplied: any): string | null {
    var tag = ("" + (supplied || "")).trim().toLowerCase();
    if (tag) return CLIP_EXAM_TAG_RE.test(tag) ? tag : null;
    // Auto-tag from the user's primary exam countdown (plan §3.4).
    try {
      var doc = readCountdownDoc(nk, userId);
      if (doc.primary_exam_id && CLIP_EXAM_TAG_RE.test(doc.primary_exam_id)) {
        return doc.primary_exam_id;
      }
    } catch (_e: any) { /* no countdown — leave untagged */ }
    return null;
  }

  // Strip the heavy inline media field for list payloads so a page of 50 clips
  // stays small; the thumb is still referenced by clip detail / future S3 URL.
  function clipToListItem(c: ClipRecord): any {
    return {
      clip_id: c.clip_id,
      source_type: c.source_type,
      url: c.url,
      title: c.title,
      selection_text: c.selection_text,
      snapshot_thumb_url: c.snapshot_thumb_url,
      voice_transcript: c.voice_transcript,
      exam_tag: c.exam_tag,
      tags: c.tags,
      ai_summary: c.ai_summary,
      created_at_unix: c.created_at_unix,
    };
  }

  // RPC: lt_clip_save — capture one clip from any of the 3 surfaces.
  function rpcClipSave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var sourceType = ("" + (data.source_type || "web")).toLowerCase();
      if (CLIP_SOURCE_TYPES.indexOf(sourceType) < 0) {
        return RpcHelpers.errorResponse("invalid source_type", 400);
      }

      var url = ("" + (data.url || "")).slice(0, 2048);
      if ((sourceType === "web" || sourceType === "snapshot") && !url) {
        return RpcHelpers.errorResponse("url required for web/snapshot clips", 400);
      }
      // Defence-in-depth: never store a non-http(s) scheme as a clip URL.
      if (url && !/^https?:\/\//i.test(url)) {
        return RpcHelpers.errorResponse("url must be http(s)", 400);
      }

      // Inline snapshot media (pre-S3). Reject anything that isn't a data:image
      // and flag oversized blobs media_pending rather than failing the clip.
      var snapshotThumb = "";
      var mediaPending = false;
      var rawSnap = "" + (data.snapshot_data_url || "");
      if (rawSnap) {
        if (rawSnap.indexOf("data:image/") !== 0) {
          return RpcHelpers.errorResponse("snapshot_data_url must be a data:image", 400);
        }
        if (rawSnap.length <= CLIP_MAX_INLINE_MEDIA) snapshotThumb = rawSnap;
        else mediaPending = true;
      }

      var nowUnix = nowSec();
      var clipId = "clip_" + nowUnix.toString(36) + "_" + Math.random().toString(36).slice(2, 8);

      var record: ClipRecord = {
        clip_id: clipId,
        source_type: sourceType,
        url: url,
        title: ("" + (data.title || "")).slice(0, CLIP_MAX_TITLE),
        selection_text: ("" + (data.selection_text || "")).slice(0, CLIP_MAX_SELECTION),
        page_text_snippet: ("" + (data.page_text_snippet || "")).slice(0, CLIP_MAX_SNIPPET),
        snapshot_thumb_url: snapshotThumb,
        voice_transcript: ("" + (data.voice_transcript || "")).slice(0, CLIP_MAX_SELECTION),
        voice_audio_url: ("" + (data.voice_audio_url || "")).slice(0, 2048),
        exam_tag: clipResolveExamTag(nk, auth.userId, data.exam_tag),
        tags: clipSanitizeTags(data.tags),
        ai_summary: null,
        media_pending: mediaPending,
        created_at_unix: nowUnix,
      };

      nk.storageWrite([{
        collection: COLLECTION_CLIPS,
        key: clipId,
        userId: auth.userId,
        value: record,
        permissionRead: 0,
        permissionWrite: 0,
      }]);

      emitAnalytics(nk, logger, auth.userId, "clipper_clip_saved", {
        source_type: sourceType,
        has_selection: record.selection_text.length > 0,
        has_snapshot: snapshotThumb.length > 0 || mediaPending,
        has_voice: record.voice_transcript.length > 0 || record.voice_audio_url.length > 0,
        exam_tag: record.exam_tag || "none",
      });

      // ai_summary_queued mirrors the contract; the async AI Notes summarizer is
      // a Week-2 backend follow-up. We report queued=true only when there is
      // textual content worth summarizing.
      var queued = record.selection_text.length > 0 || record.page_text_snippet.length > 0 || record.voice_transcript.length > 0;

      return safeWrap({
        status: "ok",
        clip_id: clipId,
        created_at_unix: nowUnix,
        ai_summary_queued: queued,
        media_pending: mediaPending,
      });
    } catch (err: any) {
      logger.error("lt_clip_save failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // RPC: lt_clips_list — paginated list + search + source/exam filters.
  function rpcClipsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) {
        // Graceful anonymous response — web /notes renders a sign-in nudge.
        return safeWrap({ status: "anonymous", clips: [], next_cursor: null });
      }

      var limit = parseInt("" + (data.limit || CLIP_LIST_DEFAULT_LIMIT), 10);
      if (!(limit >= 1)) limit = CLIP_LIST_DEFAULT_LIMIT;
      if (limit > CLIP_LIST_MAX_LIMIT) limit = CLIP_LIST_MAX_LIMIT;

      var cursor = data.cursor ? "" + data.cursor : "";
      var filterSource = data.filter_source_type ? ("" + data.filter_source_type).toLowerCase() : "";
      var filterExam = data.filter_exam_tag ? ("" + data.filter_exam_tag).toLowerCase() : "";
      var search = data.search ? ("" + data.search).toLowerCase().trim() : "";

      var listResult = nk.storageList(auth.userId, COLLECTION_CLIPS, limit, cursor || undefined);
      var rows = listResult && listResult.objects ? listResult.objects : [];

      var clips: any[] = [];
      for (var i = 0; i < rows.length; i++) {
        var v = rows[i] && rows[i].value ? (rows[i].value as ClipRecord) : null;
        if (!v) continue;
        if (filterSource && v.source_type !== filterSource) continue;
        if (filterExam && (v.exam_tag || "") !== filterExam) continue;
        if (search) {
          var hay = ((v.title || "") + " " + (v.selection_text || "") + " " + (v.voice_transcript || "") + " " + (v.url || "")).toLowerCase();
          if (hay.indexOf(search) < 0) continue;
        }
        clips.push(clipToListItem(v));
      }

      // storageList returns ascending key order (clip_<base36-unix>) — present
      // newest-first within the page.
      clips.sort(function (a, b) { return b.created_at_unix - a.created_at_unix; });

      return safeWrap({
        status: "ok",
        clips: clips,
        next_cursor: (listResult && listResult.cursor) ? listResult.cursor : null,
      });
    } catch (err: any) {
      logger.error("lt_clips_list failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // RPC: lt_clip_delete — remove one clip owned by the caller.
  function rpcClipDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var clipId = "" + (data.clip_id || "");
      if (!clipId) return RpcHelpers.errorResponse("clip_id required", 400);

      var existed = false;
      try {
        var rows = nk.storageRead([{ collection: COLLECTION_CLIPS, key: clipId, userId: auth.userId }]);
        existed = !!(rows && rows.length > 0 && rows[0].value);
      } catch (_e: any) { /* treat as not_found */ }

      if (!existed) return safeWrap({ status: "not_found" });

      var ageDays = 0;
      try {
        var rec = rows && rows[0] ? (rows[0].value as ClipRecord) : null;
        if (rec && rec.created_at_unix) ageDays = Math.floor((nowSec() - rec.created_at_unix) / 86400);
      } catch (_e: any) { /* noop */ }

      nk.storageDelete([{ collection: COLLECTION_CLIPS, key: clipId, userId: auth.userId }]);
      emitAnalytics(nk, logger, auth.userId, "clipper_clip_deleted", { age_days: ageDays });

      return safeWrap({ status: "ok" });
    } catch (err: any) {
      logger.error("lt_clip_delete failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }
  // Silence unused-soft-cap warning until quota enforcement lands (plan Week 3 D3).
  void CLIP_SOFT_CAP_FREE;

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
  function rpcSchoolSearch(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var query = "" + (data.query || "");
      var country = ("" + (data.country_code || data.country || "")).toUpperCase();
      var locale = "" + (data.locale || "en");
      var institutionType = "" + (data.institution_type || data.institutionType || "");
      var limit = Math.min(Math.max(parseInt("" + (data.limit || 10), 10) || 10, 1), 50);
      if (query.length < 2) return RpcHelpers.errorResponse("query must be ≥2 chars", 400);

      // Phase B: query the real CockroachDB index first (ingest_schools.py loads
      // ~177k schools + global colleges). The in-memory fixture is merged in as a
      // no-regression fallback, so curated landmark institutions always resolve
      // and an empty/unavailable DB never breaks the tool.
      var dbHits = searchSchoolsDB(nk, query, country, limit, institutionType);
      var hits: SchoolSearchHit[];
      var source: string;
      if (dbHits.length > 0) {
        var fixtureHits = searchSchools(query, country, limit, institutionType);
        hits = mergeHits(dbHits, fixtureHits, limit);
        source = "db";
      } else {
        hits = searchSchools(query, country, limit, institutionType);
        source = "fixture";
      }

      return safeWrap({
        ok: true, status: hits.length > 0 ? "ok" : "no_results",
        query: query, country_code: country, locale: locale,
        institution_type: institutionType,
        source: source,
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
  function rpcSchoolGetDetail(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var schoolId = "" + (data.school_id || "");
      if (!schoolId) return RpcHelpers.errorResponse("school_id required", 400);
      var rec = getSchoolByIdAny(nk, schoolId);
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

      // Resolve verified-ness — DB + fixture hits are verified; freetext entries
      // remain provisional until ai-content reviews.
      var rec = getSchoolByIdAny(nk, schoolId);
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
      ident = promoteIdentityByEntitlement(nk, ident);

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

  // ── RPC: lt_learner_state_get ──────────────────────────────────────────────
  // § 3.13.1 — Single source of truth for "what mode is this user in?".
  // Called at every web route mount + every chat turn. Caches the result on
  // qv_lt_learner_state_cache for 6h so high-traffic pages don't re-derive
  // on every request.
  //
  // Wire shape:
  //   input  { service_token, user_id, declared_intent? }
  //   output { ok, mode, has_exam_declared, has_school_declared,
  //            quiz_count_last_30d, has_history, recommended_tool,
  //            display_name_for_user, copy_namespace, ... }
  export function rpcLearnerStateGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var declaredIntent: string | null = data.declared_intent ? "" + data.declared_intent : null;

      // Cache-hit short-circuit. Cache invalidation is purely TTL-based;
      // declared_intent changes flow through immediately because we KEY by
      // userId and rebuild on stale.
      var cached = readCachedLearnerState(nk, auth.userId);
      if (cached && (!declaredIntent || cached.declared_intent_at === declaredIntent)) {
        return RpcHelpers.successResponse({
          ok: true,
          mode: cached.mode,
          has_exam_declared: !!cached.has_exam_declared,
          has_school_declared: !!cached.has_school_declared,
          quiz_count_last_30d: cached.quiz_count_last_30d || 0,
          has_history: !!cached.has_history,
          recommended_tool: cached.recommended_tool,
          display_name_for_user: cached.display_name_for_user,
          copy_namespace: cached.copy_namespace,
          cached: true,
          cached_at: cached.cachedAt,
          module_version: MODULE_VERSION,
          generated_unix: nowSec(),
        });
      }

      // Storage probes — all best-effort, default to "no data".
      var hasExam = readStorageBool(nk, COLLECTION_USER_EXAM, "declared", auth.userId);
      var hasSchool = readStorageBool(nk, COLLECTION_SCHOOL, "current", auth.userId);
      var quizCount = readQuizCount30d(nk, auth.userId);

      var derived = deriveLearnerMode({
        declared_intent: declaredIntent,
        has_exam_declared: hasExam,
        has_school_declared: hasSchool,
        quiz_count_last_30d: quizCount,
      });

      var responseBody: any = {
        ok: true,
        mode: derived.mode,
        has_exam_declared: hasExam,
        has_school_declared: hasSchool,
        quiz_count_last_30d: quizCount,
        has_history: derived.has_history,
        recommended_tool: derived.recommended_tool,
        display_name_for_user: derived.display_name_for_user,
        copy_namespace: derived.copy_namespace,
        cached: false,
        declared_intent_at: declaredIntent,
        module_version: MODULE_VERSION,
        generated_unix: nowSec(),
      };

      writeCachedLearnerState(nk, auth.userId, responseBody);
      emitAnalytics(nk, logger, auth.userId, "lt_learner_state_get", {
        mode: derived.mode,
        has_exam: hasExam,
        has_school: hasSchool,
        quiz_count: quizCount,
      });
      return RpcHelpers.successResponse(responseBody);
    } catch (err: any) {
      logger.error("lt_learner_state_get failed: " + (err && err.message ? err.message : String(err)));
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
      ident = promoteIdentityByEntitlement(nk, ident);

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

  // ── RPC: lt_learner_insights_get ───────────────────────────────────────────
  // § 3.13.2 — Returns the Learner Insights payload. For Phase A we ship
  // representative mock metrics (status="mock_data") so the web route can
  // render the full layout; Wave 4-5 wires the real engagement-data reads.
  //
  // CRITICAL CONTRACT — no-exam-jargon guard:
  // Every string in the response MUST exclude exam-specific vocabulary
  // ("predicted score", "AIR", "scaled score", "grade boundary", "cutoff",
  // "percentile rank"). The lint test in __tests__/skeleton.test.ts
  // (§ 3.13.6 A25) scans the JSON recursively and fails the build if any
  // forbidden token appears. The response also carries an explicit
  // `forbidden_copy: false` field as the wire-level guarantee.
  export function rpcLearnerInsightsGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);
      var locale = "" + (data.locale || "en");

      // Resolve mode without re-running the full state derivation — we
      // accept either an explicit `mode` from the gateway (which has just
      // called lt_learner_state_get) or a quick local probe. For Phase A
      // the quick probe uses the same heuristic as deriveLearnerMode but
      // with degraded inputs (no declared_intent on this path — that's a
      // state_get concern, not an insights concern).
      var explicitMode = "" + (data.mode || "");
      var mode: string;
      if (explicitMode === "cold_start" || explicitMode === "learner") {
        mode = explicitMode;
      } else {
        var hasSchool = readStorageBool(nk, COLLECTION_SCHOOL, "current", auth.userId);
        var quizCount = readQuizCount30d(nk, auth.userId);
        var derived = deriveLearnerMode({
          declared_intent: null,
          has_exam_declared: false,
          has_school_declared: hasSchool,
          quiz_count_last_30d: quizCount,
        });
        // If the user is an exam candidate we still degrade to 'learner'
        // here — by construction insights_get is the no-exam surface, so
        // exam users who reach this RPC are by definition treated like a
        // learner for this turn (the gateway should have routed them to
        // lt_score_predict instead).
        mode = derived.mode === "exam" || derived.mode === "parent" ? "learner" : derived.mode;
      }

      var state = data.ip_hash && !data.user_id ? "anon" : "authed";

      var body = buildLearnerInsightsResponse({
        state: state,
        mode: mode,
        locale: locale,
      });

      emitAnalytics(nk, logger, auth.userId, "lt_learner_insights_get", {
        mode: mode,
        state: state,
        locale: locale,
      });

      return RpcHelpers.successResponse(body);
    } catch (err: any) {
      logger.error("lt_learner_insights_get failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: lt_learner_soft_cta_check ─────────────────────────────────────────
  // § 3.13.4 — 14-day soft exam-CTA gate. Called by the gateway before each
  // chat turn so it can decide whether to surface "you've been crushing
  // Grade 10 Math — heads up, your pattern often leads to SAT/AP/JEE".
  //
  // Returns the decision + suggested exams + the copy key to render. The
  // gateway is responsible for writing the lastNudgeUnix after the user
  // actually SEES the nudge (so denials of service don't burn the cooldown).
  export function rpcLearnerSoftCtaCheck(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      // For Phase A we accept metrics either inline (gateway already
      // computed them) or via a stub read against qv_user_quiz_history.
      // Wave 4-5 will collapse this to a single canonical read.
      var inlineMetrics = data.metrics || null;
      var metrics: { quizzes_played_last_2w: number; daysActive_last_2w: number };
      if (inlineMetrics) {
        metrics = {
          quizzes_played_last_2w: parseInt("" + (inlineMetrics.quizzes_played_last_2w || 0), 10) || 0,
          daysActive_last_2w: parseInt("" + (inlineMetrics.daysActive_last_2w || 0), 10) || 0,
        };
      } else {
        // Stub — Wave 4-5 wires the real 2-week aggregate.
        metrics = { quizzes_played_last_2w: 0, daysActive_last_2w: 0 };
      }

      var lastNudge = readLastNudgeUnix(nk, auth.userId);
      var shouldShow = shouldShowSoftExamCta(metrics, lastNudge);

      // Suggested exams — Phase A returns a small static list; Wave 4-5
      // derives them from the user's strongest topics + school board.
      var suggestedExams: string[] = shouldShow ? ["sat", "ap_calculus", "jee_main"] : [];

      return RpcHelpers.successResponse({
        ok: true,
        should_show: shouldShow,
        suggested_exams: suggestedExams,
        copy_key: "cta.learner.soft_exam_nudge",
        metrics_used: metrics,
        last_nudge_unix: lastNudge,
        cooldown_sec: SOFT_CTA_COOLDOWN_SEC,
        module_version: MODULE_VERSION,
        generated_unix: nowSec(),
      });
    } catch (err: any) {
      logger.error("lt_learner_soft_cta_check failed: " + (err && err.message ? err.message : String(err)));
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
    // PLAN-EXAM_COUNTDOWN_ENGAGING_UI § 4.4-4.6
    initializer.registerRpc("lt_countdown_visit", rpcCountdownVisit);
    initializer.registerRpc("lt_study_log_log", rpcStudyLogLog);
    initializer.registerRpc("lt_study_log_heatmap", rpcStudyLogHeatmap);
    initializer.registerRpc("lt_clip_save", rpcClipSave);
    initializer.registerRpc("lt_clips_list", rpcClipsList);
    initializer.registerRpc("lt_clip_delete", rpcClipDelete);
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
    initializer.registerRpc("lt_learner_state_get", rpcLearnerStateGet);
    initializer.registerRpc("lt_learner_insights_get", rpcLearnerInsightsGet);
    initializer.registerRpc("lt_learner_soft_cta_check", rpcLearnerSoftCtaCheck);
  }
}
