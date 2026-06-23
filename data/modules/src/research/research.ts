// research.ts
// ─────────────────────────────────────────────────────────────────────────────
// QuizVerse Research & Validation instrument (grant-evidence pipeline).
//
// Purpose
// -------
// Generate the IRB-shaped evidence that SBIR / IES (and EB-1A traction) review
// panels look for and that consultants CANNOT manufacture for us:
//
//   1. Informed consent (COPPA/FERPA-aware: parental consent gate for minors)
//   2. A/B assignment      — "adaptive DeepTutor path" vs "static control quiz"
//   3. Pre/Post diagnostic — normalized learning gain (Hake's g) per topic
//   4. Surveys             — student / teacher / customer-interview / SUS / NPS
//   5. Waitlist            — "meaningful waitlist signups" metric
//   6. Aggregate export    — one call → the numbers that go in the proposal
//                            appendix (n, mean gain, effect size, SUS, NPS)
//
// Design notes
// ------------
// • Every RPC is ES5-safe (var / function) — Goja VM has no ES2015+.
// • Functions are top-level inside the namespace; registration is via
//   `Research.register(initializer)` with STRING-LITERAL registerRpc ids so
//   postbuild.js v2 hoists them (see nakama-rpc skill).
// • No module-level mutable state (Goja pools VMs — state resets per call).
// • Privacy by construction: aggregation rows are keyed by a one-way
//   participant_hash (sha256(participantId).slice(0,16)) — never the raw id.
// • Auth model (mirrors learner-toolbelt): a participant is resolved from
//     (a) ctx.userId (Nakama session), OR
//     (b) service_token + user_id   (gateway / web proxy, token ==
//         ctx.env["QV_RESEARCH_SERVICE_TOKEN"]), OR
//     (c) payload.participant_id    (anon browser UUID — marketing site /
//         pre-auth webview; still gives a stable id for the study).
//   The aggregate export RPC additionally requires admin (http_key
//   server-to-server) OR the service token.
//
// Storage shapes (all permissionRead/Write = 0 — server-only)
// -----------------------------------------------------------
//   qv_research_consent     key "<study_id>"                 userId=participant
//   qv_research_diag        key "<study_id>:<topic>:<phase>" userId=participant
//   qv_research_survey_done key "<study_id>:<survey_type>"   userId=participant (dedupe)
//   qv_research_metrics     key "gain_…" | "sus_…"           userId=SYSTEM  (export scan)
//   qv_research_survey      key "<survey_type>_…"            userId=SYSTEM  (export scan)
//   qv_research_waitlist    key "wl_…"                       userId=SYSTEM  (export scan)
//
// RPCs registered (6)
//   quizverse_research_consent            consent + returns A/B arm + hash
//   quizverse_research_assignment_get     deterministic A/B arm lookup
//   quizverse_research_diagnostic_submit  pre/post; computes normalized gain
//   quizverse_research_survey_submit      student/teacher/customer/sus (+NPS)
//   quizverse_research_waitlist_join      waitlist email capture
//   quizverse_research_export             admin/service-only aggregate

namespace Research {

  // ── Collections ────────────────────────────────────────────────────────────
  var COLLECTION_CONSENT = "qv_research_consent";
  var COLLECTION_DIAG = "qv_research_diag";
  var COLLECTION_SURVEY_DONE = "qv_research_survey_done";
  var COLLECTION_METRICS = "qv_research_metrics";   // SYSTEM mirror (aggregation)
  var COLLECTION_SURVEY = "qv_research_survey";      // SYSTEM mirror (aggregation)
  var COLLECTION_WAITLIST = "qv_research_waitlist";  // SYSTEM mirror (aggregation)

  export var MODULE_VERSION = "research/1.1.0";

  var ARM_ADAPTIVE = "adaptive";   // DeepTutor weak-area diagnostic + adaptive path
  var ARM_CONTROL = "control";     // static, non-adaptive quiz (comparison group)

  var DEFAULT_STUDY_ID = "qv_learning_outcomes_2026";
  var CONSENT_VERSION = "v1-2026";

  // Discriminates the IES concept-testing variant inside a `student` survey so
  // the export can isolate the exact population the IES reviewer asked for
  // (U.S. grade 11–12, SAT/ACT math, reacting to the Cognitive Mastery Engine
  // mock-ups). Stored by the web client under `answers.survey_variant`; MUST
  // stay in sync with CONCEPT_TEST_VARIANT in web/lib/research/client.ts.
  var CONCEPT_TEST_VARIANT = "concept_test_us_hs_math_2026";

  // Likert keys the concept-test survey collects (1..5). Surfaced as means in
  // the export's concept_test.likert_means for the dashboard + proposal table.
  var CONCEPT_LIKERT_KEYS = ["q_clear", "q_use", "q_better", "q_trust"];

  var VALID_SURVEY_TYPES: { [k: string]: boolean } = {
    student: true,
    teacher: true,
    customer_interview: true,
    sus: true,        // System Usability Scale (10 items → 0..100)
    parent: true,
  };

  // Personalized-path interventions a participant may have received between the
  // pre and post diagnostic. The whiteboard explainer-video engine (Simi /
  // Lamina Labs, surfaced via Hermes) and the Math Animator (Manim) are the
  // differentiating ones — the export attributes learning gain to "explainer
  // video on vs off" so the proposal can isolate the explainer effect, not just
  // the adaptive-arm effect.
  var VALID_INTERVENTIONS: { [k: string]: boolean } = {
    explainer_video: true,   // Simi / Lamina whiteboard explainer for the weak concept
    math_animator: true,     // DeepTutor Math Animator (Manim) for derivations
    adaptive_quiz: true,     // adaptive question path
    flashcards: true,        // spaced-repetition flashcards
    tutorbot: true,          // persistent-memory conversational tutor
    audiobook: true,         // concept audiobook
  };

  function normalizeInterventions(raw: any): string[] {
    var out: string[] = [];
    if (!raw || !raw.length) return out;
    for (var i = 0; i < raw.length; i++) {
      var key = ("" + raw[i]).toLowerCase().slice(0, 32);
      if (VALID_INTERVENTIONS[key] && out.indexOf(key) < 0) out.push(key);
    }
    return out;
  }

  function hasIntervention(list: any, name: string): boolean {
    if (!list || !list.length) return false;
    for (var i = 0; i < list.length; i++) {
      if (("" + list[i]) === name) return true;
    }
    return false;
  }

  var EXPORT_SCAN_PAGE = 100;   // storageList page size
  var EXPORT_SCAN_MAX = 5000;   // safety cap on rows scanned per collection

  // ── Small helpers ───────────────────────────────────────────────────────────
  function nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  function dateStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function randSuffix(): string {
    return Math.random().toString(36).slice(2, 8);
  }

  function isServiceCaller(ctx: nkruntime.Context, data: any): boolean {
    var token = data && data.service_token;
    if (!token) return false;
    var expected = "" + ((ctx.env && ctx.env["QV_RESEARCH_SERVICE_TOKEN"]) || "");
    return expected.length > 0 && token === expected;
  }

  // Resolve a stable participant id from session / service-token / anon UUID.
  function resolveParticipant(
    ctx: nkruntime.Context,
    data: any
  ): { id: string; source: string; error?: string; code?: number } {
    if (ctx.userId) {
      return { id: ctx.userId, source: "session" };
    }
    if (isServiceCaller(ctx, data)) {
      var u = "" + (data.user_id || data.participant_id || "");
      if (!u) return { id: "", source: "service", error: "user_id required for service caller", code: 400 };
      return { id: u, source: "service" };
    }
    // Anonymous browser path — accept a client-generated stable UUID.
    var anon = "" + (data.participant_id || data.anon_id || "");
    if (anon && anon.length >= 8 && anon.length <= 128) {
      return { id: anon, source: "anon" };
    }
    return { id: "", source: "none", error: "participant_id (or sign-in / service token) required", code: 401 };
  }

  function participantHash(nk: nkruntime.Nakama, participantId: string): string {
    try {
      return nk.sha256Hash(participantId).slice(0, 16);
    } catch (_e: any) {
      return ("" + participantId).slice(0, 16);
    }
  }

  // Deterministic 50/50 A/B arm from sha256(studyId + ":" + participantId).
  // Same participant always lands in the same arm for a given study.
  function assignArm(nk: nkruntime.Nakama, studyId: string, participantId: string): string {
    var h: string;
    try {
      h = nk.sha256Hash(studyId + ":" + participantId);
    } catch (_e: any) {
      h = "" + participantId;
    }
    var firstNibble = parseInt((h.charAt(0) || "0"), 16);
    if (isNaN(firstNibble)) firstNibble = 0;
    return (firstNibble % 2 === 0) ? ARM_ADAPTIVE : ARM_CONTROL;
  }

  // Standard System Usability Scale scoring. answers = 10 ints in [1..5].
  // Odd items (0-indexed even): contribution = v - 1.
  // Even items (0-indexed odd): contribution = 5 - v.
  // total * 2.5 → 0..100.
  function scoreSus(answers: any[]): number | null {
    if (!answers || answers.length !== 10) return null;
    var total = 0;
    for (var i = 0; i < 10; i++) {
      var v = parseInt("" + answers[i], 10);
      if (isNaN(v) || v < 1 || v > 5) return null;
      total += (i % 2 === 0) ? (v - 1) : (5 - v);
    }
    return Math.round(total * 2.5 * 10) / 10;   // one decimal place
  }

  // Hake's normalized gain g = (post - pre) / (100 - pre), scores as percent.
  function normalizedGain(prePct: number, postPct: number): number | null {
    if (prePct >= 100) return null;          // undefined when no headroom
    var g = (postPct - prePct) / (100 - prePct);
    return Math.round(g * 1000) / 1000;
  }

  function clampPct(n: any): number {
    var v = parseFloat("" + n);
    if (isNaN(v)) return 0;
    if (v < 0) return 0;
    if (v > 100) return 100;
    return Math.round(v * 100) / 100;
  }

  // Per-participant rows are owned by the SYSTEM user and keyed by the one-way
  // participant_hash. Anonymous browser participants (marketing site / pre-auth
  // webview) have no Nakama account, so owning rows by their UUID would violate
  // the storage→users foreign key. Hashing + SYSTEM ownership keeps the corpus
  // de-identified AND writable for session, service, and anon callers alike.
  function consentKey(studyId: string, pHash: string): string {
    return studyId + ":" + pHash;
  }

  function readConsent(nk: nkruntime.Nakama, participantId: string, studyId: string): any | null {
    try {
      var pHash = participantHash(nk, participantId);
      var rows = nk.storageRead([{ collection: COLLECTION_CONSENT, key: consentKey(studyId, pHash), userId: Constants.SYSTEM_USER_ID }]);
      if (rows && rows.length > 0 && rows[0].value) return rows[0].value;
    } catch (_e: any) { /* none */ }
    return null;
  }

  // COPPA/FERPA gate: a minor may only contribute data when parental consent
  // is on file. Returns null when OK, or an error envelope string when blocked.
  function consentGateError(consent: any): string | null {
    if (!consent) {
      return RpcHelpers.errorResponse("consent required before submitting study data", 403);
    }
    if (consent.is_minor === true && consent.parental_consent !== true) {
      return RpcHelpers.errorResponse("parental consent required for participants under 18", 403);
    }
    if (consent.granted !== true) {
      return RpcHelpers.errorResponse("active consent not on file", 403);
    }
    return null;
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: quizverse_research_consent
  //   { study_id?, role?, is_minor?, parental_consent?, consent_version?,
  //     granted?, locale?, participant_id?/user_id?, service_token? }
  //   → { participant_hash, arm, consent: {...} }
  // ────────────────────────────────────────────────────────────────────────
  function rpcConsent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var who = resolveParticipant(ctx, data);
      if (who.error) return RpcHelpers.errorResponse(who.error, who.code);

      var studyId = "" + (data.study_id || DEFAULT_STUDY_ID);
      var role = ("" + (data.role || "student")).toLowerCase();
      var isMinor = data.is_minor === true;
      var parentalConsent = data.parental_consent === true;
      var granted = data.granted !== false;   // default true (caller is opting in)
      var locale = "" + (data.locale || "en");

      // A minor cannot self-consent without parental sign-off.
      if (granted && isMinor && !parentalConsent) {
        return RpcHelpers.errorResponse("parental consent required for participants under 18", 403);
      }

      var arm = assignArm(nk, studyId, who.id);
      var pHash = participantHash(nk, who.id);

      var record = {
        study_id: studyId,
        role: role,
        is_minor: isMinor,
        parental_consent: parentalConsent,
        consent_version: "" + (data.consent_version || CONSENT_VERSION),
        granted: granted,
        arm: arm,
        participant_hash: pHash,
        source: who.source,
        locale: locale,
        granted_unix: nowSec(),
        date: dateStr(),
      };

      // SYSTEM-owned, keyed by participant_hash → idempotent (re-consent
      // overwrites, never duplicates) and scannable by the aggregate export.
      nk.storageWrite([{
        collection: COLLECTION_CONSENT,
        key: consentKey(studyId, pHash),
        userId: Constants.SYSTEM_USER_ID,
        value: record,
        permissionRead: 0,
        permissionWrite: 0,
      }]);

      return RpcHelpers.successResponse({
        ok: true,
        study_id: studyId,
        arm: arm,
        participant_hash: pHash,
        granted: granted,
        is_minor: isMinor,
        parental_consent: parentalConsent,
        consent_version: record.consent_version,
        module_version: MODULE_VERSION,
        generated_unix: nowSec(),
      });
    } catch (err: any) {
      logger.error("quizverse_research_consent failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: quizverse_research_assignment_get
  //   { study_id?, participant_id?/user_id?, service_token? }
  //   → { arm, has_consent }
  // ────────────────────────────────────────────────────────────────────────
  function rpcAssignmentGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var who = resolveParticipant(ctx, data);
      if (who.error) return RpcHelpers.errorResponse(who.error, who.code);

      var studyId = "" + (data.study_id || DEFAULT_STUDY_ID);
      var consent = readConsent(nk, who.id, studyId);
      // Prefer the arm persisted at consent time; else compute deterministically.
      var arm = (consent && consent.arm) ? consent.arm : assignArm(nk, studyId, who.id);

      return RpcHelpers.successResponse({
        ok: true,
        study_id: studyId,
        arm: arm,
        has_consent: !!(consent && consent.granted === true),
        participant_hash: participantHash(nk, who.id),
        module_version: MODULE_VERSION,
        generated_unix: nowSec(),
      });
    } catch (err: any) {
      logger.error("quizverse_research_assignment_get failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: quizverse_research_diagnostic_submit
  //   { study_id?, topic, phase: "pre"|"post", score_pct, items_total?,
  //     items_correct?, duration_sec?, participant_id?/user_id?, service_token? }
  //   On "post": reads the matching "pre", computes normalized gain, and writes
  //   a SYSTEM metrics-mirror row for aggregate export.
  //   → { recorded, phase, gain: { pre_pct, post_pct, normalized_gain } | null }
  // ────────────────────────────────────────────────────────────────────────
  function rpcDiagnosticSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var who = resolveParticipant(ctx, data);
      if (who.error) return RpcHelpers.errorResponse(who.error, who.code);

      var studyId = "" + (data.study_id || DEFAULT_STUDY_ID);
      var topic = ("" + (data.topic || "")).toLowerCase().slice(0, 64);
      var phase = ("" + (data.phase || "")).toLowerCase();
      if (!topic) return RpcHelpers.errorResponse("topic required", 400);
      if (phase !== "pre" && phase !== "post") return RpcHelpers.errorResponse("phase must be 'pre' or 'post'", 400);

      var consent = readConsent(nk, who.id, studyId);
      var gateErr = consentGateError(consent);
      if (gateErr) return gateErr;

      var scorePct = clampPct(data.score_pct);
      var itemsTotal = parseInt("" + (data.items_total || 0), 10) || 0;
      var itemsCorrect = parseInt("" + (data.items_correct || 0), 10) || 0;
      var durationSec = parseInt("" + (data.duration_sec || 0), 10) || 0;
      var arm = (consent && consent.arm) ? consent.arm : assignArm(nk, studyId, who.id);
      // Interventions the learner received before this (post) diagnostic — e.g.
      // the auto-generated explainer video for their weak concept.
      var interventions = normalizeInterventions(data.interventions);

      var record = {
        study_id: studyId,
        topic: topic,
        phase: phase,
        score_pct: scorePct,
        items_total: itemsTotal,
        items_correct: itemsCorrect,
        duration_sec: durationSec,
        arm: arm,
        interventions: interventions,
        submitted_unix: nowSec(),
        date: dateStr(),
      };

      var dHash = participantHash(nk, who.id);
      nk.storageWrite([{
        collection: COLLECTION_DIAG,
        key: studyId + ":" + topic + ":" + phase + ":" + dHash,
        userId: Constants.SYSTEM_USER_ID,
        value: record,
        permissionRead: 0,
        permissionWrite: 0,
      }]);

      var gainOut: any = null;
      if (phase === "post") {
        // Pair with the pre-diagnostic for this (study, topic, participant).
        var preRows: nkruntime.StorageObject[] = [];
        try {
          preRows = nk.storageRead([{
            collection: COLLECTION_DIAG,
            key: studyId + ":" + topic + ":pre:" + dHash,
            userId: Constants.SYSTEM_USER_ID,
          }]);
        } catch (_e: any) { preRows = []; }

        if (preRows && preRows.length > 0 && preRows[0].value) {
          var pre: any = preRows[0].value;
          var prePct = clampPct(pre.score_pct);
          var g = normalizedGain(prePct, scorePct);
          gainOut = {
            pre_pct: prePct,
            post_pct: scorePct,
            raw_gain_pct: Math.round((scorePct - prePct) * 100) / 100,
            normalized_gain: g,
          };

          // SYSTEM mirror row for the aggregate export (anonymized).
          var metricKey = "gain_" + studyId + "_" + nowSec() + "_" + randSuffix();
          nk.storageWrite([{
            collection: COLLECTION_METRICS,
            key: metricKey,
            userId: Constants.SYSTEM_USER_ID,
            value: {
              kind: "gain",
              study_id: studyId,
              topic: topic,
              arm: arm,
              interventions: interventions,
              pre_pct: prePct,
              post_pct: scorePct,
              raw_gain_pct: gainOut.raw_gain_pct,
              normalized_gain: g,
              participant_hash: participantHash(nk, who.id),
              date: dateStr(),
              unix: nowSec(),
            },
            permissionRead: 0,
            permissionWrite: 0,
          }]);
        }
      }

      return RpcHelpers.successResponse({
        ok: true,
        recorded: true,
        study_id: studyId,
        topic: topic,
        phase: phase,
        arm: arm,
        gain: gainOut,
        module_version: MODULE_VERSION,
        generated_unix: nowSec(),
      });
    } catch (err: any) {
      logger.error("quizverse_research_diagnostic_submit failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: quizverse_research_survey_submit
  //   { study_id?, survey_type, answers{} | answers[] (sus), nps?, comment?,
  //     wants_interview?, locale?, participant_id?/user_id?, service_token? }
  //   → { recorded, survey_type, sus_score? }
  // ────────────────────────────────────────────────────────────────────────
  function rpcSurveySubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var who = resolveParticipant(ctx, data);
      if (who.error) return RpcHelpers.errorResponse(who.error, who.code);

      var studyId = "" + (data.study_id || DEFAULT_STUDY_ID);
      var surveyType = ("" + (data.survey_type || "")).toLowerCase();
      if (!VALID_SURVEY_TYPES[surveyType]) {
        return RpcHelpers.errorResponse("survey_type must be one of student|teacher|parent|customer_interview|sus", 400);
      }

      // Consent gate applies to identified study surveys. Customer interviews
      // (which can be founders/admins or external partners) are exempt so
      // discovery interviews can be logged without a study consent record.
      if (surveyType !== "customer_interview") {
        var consent = readConsent(nk, who.id, studyId);
        var gateErr = consentGateError(consent);
        if (gateErr) return gateErr;
      }

      var pHash = participantHash(nk, who.id);
      var nps = (data.nps !== undefined && data.nps !== null) ? parseInt("" + data.nps, 10) : null;
      if (nps !== null && (isNaN(nps) || nps < 0 || nps > 10)) nps = null;

      var susScore: number | null = null;
      if (surveyType === "sus") {
        susScore = scoreSus(Array.isArray(data.answers) ? data.answers : []);
        if (susScore === null) {
          return RpcHelpers.errorResponse("sus survey requires answers[] of exactly 10 integers in [1..5]", 400);
        }
      }

      var surveyKey = surveyType + "_" + nowSec() + "_" + randSuffix();
      nk.storageWrite([{
        collection: COLLECTION_SURVEY,
        key: surveyKey,
        userId: Constants.SYSTEM_USER_ID,
        value: {
          kind: "survey",
          study_id: studyId,
          survey_type: surveyType,
          participant_hash: pHash,
          role: (data.role ? ("" + data.role).toLowerCase() : null),
          answers: data.answers || {},
          nps: nps,
          sus_score: susScore,
          comment: ("" + (data.comment || "")).slice(0, 2000),
          wants_interview: data.wants_interview === true,
          locale: "" + (data.locale || "en"),
          source: who.source,
          date: dateStr(),
          unix: nowSec(),
        },
        permissionRead: 0,
        permissionWrite: 0,
      }]);

      // SUS also lands in the metrics mirror so the export can average it
      // alongside learning gains without scanning the full survey corpus.
      if (susScore !== null) {
        nk.storageWrite([{
          collection: COLLECTION_METRICS,
          key: "sus_" + studyId + "_" + nowSec() + "_" + randSuffix(),
          userId: Constants.SYSTEM_USER_ID,
          value: {
            kind: "sus",
            study_id: studyId,
            sus_score: susScore,
            participant_hash: pHash,
            date: dateStr(),
            unix: nowSec(),
          },
          permissionRead: 0,
          permissionWrite: 0,
        }]);
      }

      // Per-participant dedupe marker (latest write wins; lets clients show
      // "already completed" without exposing the SYSTEM corpus).
      try {
        nk.storageWrite([{
          collection: COLLECTION_SURVEY_DONE,
          key: studyId + ":" + surveyType + ":" + pHash,
          userId: Constants.SYSTEM_USER_ID,
          value: { survey_type: surveyType, participant_hash: pHash, last_unix: nowSec() },
          permissionRead: 0,
          permissionWrite: 0,
        }]);
      } catch (_e: any) { /* non-fatal */ }

      return RpcHelpers.successResponse({
        ok: true,
        recorded: true,
        study_id: studyId,
        survey_type: surveyType,
        sus_score: susScore,
        wants_interview: data.wants_interview === true,
        module_version: MODULE_VERSION,
        generated_unix: nowSec(),
      });
    } catch (err: any) {
      logger.error("quizverse_research_survey_submit failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: quizverse_research_waitlist_join
  //   { email, source?, role?, locale?, study_id? }   (anonymous-OK)
  //   → { recorded }
  // ────────────────────────────────────────────────────────────────────────
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function rpcWaitlistJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var email = ("" + (data.email || "")).trim().toLowerCase().slice(0, 254);
      if (!EMAIL_RE.test(email)) return RpcHelpers.errorResponse("valid email required", 400);

      // Hash the email for the aggregate corpus; keep the plaintext only on a
      // dedicated row so a future export can dedupe by hash without scanning PII.
      var emailHash: string;
      try { emailHash = nk.sha256Hash(email).slice(0, 24); } catch (_e: any) { emailHash = email.slice(0, 24); }

      nk.storageWrite([{
        collection: COLLECTION_WAITLIST,
        key: "wl_" + emailHash,   // keyed by hash → idempotent (no duplicate signups)
        userId: Constants.SYSTEM_USER_ID,
        value: {
          kind: "waitlist",
          email: email,
          email_hash: emailHash,
          source: ("" + (data.source || "web")).slice(0, 64),
          role: ("" + (data.role || "")).toLowerCase().slice(0, 32),
          study_id: "" + (data.study_id || DEFAULT_STUDY_ID),
          locale: "" + (data.locale || "en"),
          date: dateStr(),
          unix: nowSec(),
        },
        permissionRead: 0,
        permissionWrite: 0,
      }]);

      return RpcHelpers.successResponse({
        ok: true,
        recorded: true,
        module_version: MODULE_VERSION,
        generated_unix: nowSec(),
      });
    } catch (err: any) {
      logger.error("quizverse_research_waitlist_join failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── Aggregation helpers (export) ────────────────────────────────────────────
  function scanSystemCollection(
    nk: nkruntime.Nakama,
    collection: string,
    onRow: (value: any) => void
  ): number {
    var cursor = "";
    var scanned = 0;
    for (var page = 0; page < (EXPORT_SCAN_MAX / EXPORT_SCAN_PAGE) + 1; page++) {
      var res: nkruntime.StorageObjectList;
      try {
        res = nk.storageList(Constants.SYSTEM_USER_ID, collection, EXPORT_SCAN_PAGE, cursor);
      } catch (_e: any) {
        break;
      }
      var objs = (res && res.objects) ? res.objects : [];
      for (var i = 0; i < objs.length; i++) {
        if (objs[i] && objs[i].value) {
          onRow(objs[i].value);
          scanned++;
          if (scanned >= EXPORT_SCAN_MAX) return scanned;
        }
      }
      cursor = (res && res.cursor) ? res.cursor : "";
      if (!cursor) break;
    }
    return scanned;
  }

  function mean(arr: number[]): number | null {
    if (!arr.length) return null;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return Math.round((s / arr.length) * 1000) / 1000;
  }

  function stddev(arr: number[], m: number | null): number | null {
    if (!arr.length || m === null) return null;
    var s = 0;
    for (var i = 0; i < arr.length; i++) { var d = arr[i] - m; s += d * d; }
    return Math.round(Math.sqrt(s / arr.length) * 1000) / 1000;
  }

  // Cohen's d (pooled SD) between two groups — the between-group effect size
  // reviewers look for. Returns null when either group is too small.
  function cohensDBetween(
    a: number[], b: number[],
    ma: number | null, mb: number | null,
    sa: number | null, sb: number | null
  ): number | null {
    if (ma === null || mb === null || a.length < 2 || b.length < 2) return null;
    var n1 = a.length, n2 = b.length;
    var s1 = sa || 0, s2 = sb || 0;
    var pooledVar = ((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / (n1 + n2 - 2);
    var pooledSd = Math.sqrt(pooledVar);
    if (pooledSd <= 0) return null;
    return Math.round(((ma - mb) / pooledSd) * 1000) / 1000;
  }

  // ────────────────────────────────────────────────────────────────────────
  // RPC: quizverse_research_export   (admin OR service-token gated)
  //   { study_id? }
  //   → grant-appendix aggregate: n, mean gain by arm, Cohen's d, SUS, NPS,
  //     survey counts, waitlist count.
  // ────────────────────────────────────────────────────────────────────────
  function rpcExport(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      // Gate: service token OR admin (http_key server-to-server passes requireAdmin).
      if (!isServiceCaller(ctx, data)) {
        try {
          RpcHelpers.requireAdmin(ctx, nk);
        } catch (_e: any) {
          return RpcHelpers.errorResponse("admin or service token required", 403);
        }
      }

      var studyId = "" + (data.study_id || DEFAULT_STUDY_ID);

      // Per-participant accumulator keyed by one-way participant_hash. Powers
      // the de-identified `participants[]` CSV the dashboard exports.
      var byHash: { [h: string]: any } = {};
      // Function expression (not a declaration) so tsc stays ES5-strict clean:
      // function declarations inside a block (this try{}) trip TS1250.
      var ensureRow = function (h: string): any {
        if (!h) h = "unknown";
        if (!byHash[h]) byHash[h] = { participant_hash: h };
        return byHash[h];
      };

      // --- consent rows (base participant rows: arm / role / locale + count) ---
      var consentCount = 0;
      scanSystemCollection(nk, COLLECTION_CONSENT, function (v: any) {
        if (!v || ("" + v.study_id) !== studyId) return;
        consentCount++;
        var rc = ensureRow("" + v.participant_hash);
        if (v.arm) rc.arm = v.arm;
        if (v.role) rc.role = v.role;
        if (v.locale) rc.locale = v.locale;
      });

      // --- learning-gain rows (by arm, and by explainer-video exposure) ---
      var adaptiveGains: number[] = [];
      var controlGains: number[] = [];
      var explainerGains: number[] = [];     // received the Simi/Lamina explainer video
      var noExplainerGains: number[] = [];   // did not
      var susScores: number[] = [];
      var gainRowCount = 0;
      scanSystemCollection(nk, COLLECTION_METRICS, function (v: any) {
        if (!v || ("" + v.study_id) !== studyId) return;
        if (v.kind === "gain" && v.normalized_gain !== null && v.normalized_gain !== undefined) {
          var g = parseFloat("" + v.normalized_gain);
          if (!isNaN(g)) {
            gainRowCount++;
            if (("" + v.arm) === ARM_CONTROL) controlGains.push(g);
            else adaptiveGains.push(g);
            if (hasIntervention(v.interventions, "explainer_video")) explainerGains.push(g);
            else noExplainerGains.push(g);
            var rg = ensureRow("" + v.participant_hash);
            if (v.arm) rg.arm = v.arm;
            if (v.pre_pct !== undefined) rg.pre_pct = v.pre_pct;
            if (v.post_pct !== undefined) rg.post_pct = v.post_pct;
            rg.normalized_gain = g;
            rg.interventions = v.interventions || [];
          }
        } else if (v.kind === "sus") {
          var s = parseFloat("" + v.sus_score);
          if (!isNaN(s)) {
            susScores.push(s);
            if (v.participant_hash) ensureRow("" + v.participant_hash).sus_score = s;
          }
        }
      });

      // --- surveys (counts by type, NPS, concept-test, per-participant merge) ---
      var surveyCounts: { [k: string]: number } = {};
      var npsScores: number[] = [];
      var interviewVolunteers = 0;
      var surveyTotal = 0;
      var ctN = 0;
      var ctOnTarget = 0;
      var ctLikert: { [k: string]: number[] } = {};
      for (var li = 0; li < CONCEPT_LIKERT_KEYS.length; li++) ctLikert[CONCEPT_LIKERT_KEYS[li]] = [];
      var ctMostUseful: { [k: string]: number } = {};
      var ctPmfVery = 0;
      var ctPmfTotal = 0;
      scanSystemCollection(nk, COLLECTION_SURVEY, function (v: any) {
        if (!v || ("" + v.study_id) !== studyId) return;
        surveyTotal++;
        var t = "" + (v.survey_type || "unknown");
        surveyCounts[t] = (surveyCounts[t] || 0) + 1;
        var a = v.answers || {};
        var r = ensureRow("" + v.participant_hash);
        if (v.role) r.role = v.role;
        if (v.locale) r.locale = v.locale;

        if (t === "customer_interview") {
          if (v.wants_interview === true) interviewVolunteers++;
          if (a.wants_pilot !== undefined && a.wants_pilot !== null) r.wants_pilot = a.wants_pilot === true;
          if (a.prize_entry !== undefined && a.prize_entry !== null) r.prize_entry = a.prize_entry === true;
          return;
        }

        // student / teacher / parent surveys
        if (v.nps !== null && v.nps !== undefined) {
          var n = parseInt("" + v.nps, 10);
          if (!isNaN(n)) { npsScores.push(n); r.nps = n; }
        }
        if (a.survey_variant) r.survey_variant = "" + a.survey_variant;
        if (a.country) r.country = "" + a.country;
        if (a.grade) r.grade = "" + a.grade;
        if (a.exam_target) r.exam_target = "" + a.exam_target;
        if (a.current_tool) r.current_tool = "" + a.current_tool;
        var cap = a.most_useful_capability || a.most_useful_modality;
        if (cap) r.most_useful_capability = "" + cap;
        if (a.after_wrong) r.after_wrong = a.after_wrong;
        if (a.pmf_disappointment) r.pmf_disappointment = "" + a.pmf_disappointment;
        if (a.who_pays) r.who_pays = "" + a.who_pays;

        if (("" + a.survey_variant) === CONCEPT_TEST_VARIANT) {
          ctN++;
          if (("" + a.country) === "us" && (("" + a.grade) === "g11" || ("" + a.grade) === "g12")) ctOnTarget++;
          for (var ki = 0; ki < CONCEPT_LIKERT_KEYS.length; ki++) {
            var lk = CONCEPT_LIKERT_KEYS[ki];
            var lv = parseFloat("" + a[lk]);
            if (!isNaN(lv)) ctLikert[lk].push(lv);
          }
          if (cap) ctMostUseful["" + cap] = (ctMostUseful["" + cap] || 0) + 1;
          if (a.pmf_disappointment) {
            ctPmfTotal++;
            if (("" + a.pmf_disappointment) === "very") ctPmfVery++;
          }
        }
      });

      // --- waitlist (unique by hash key) ---
      var waitlistCount = 0;
      scanSystemCollection(nk, COLLECTION_WAITLIST, function (v: any) {
        if (!v) return;
        if (("" + (v.study_id || DEFAULT_STUDY_ID)) === studyId || !v.study_id) waitlistCount++;
      });

      // --- derived stats (gains / effect sizes) ---
      var mAdaptive = mean(adaptiveGains);
      var mControl = mean(controlGains);
      var sdAdaptive = stddev(adaptiveGains, mAdaptive);
      var sdControl = stddev(controlGains, mControl);
      var cohensD = cohensDBetween(adaptiveGains, controlGains, mAdaptive, mControl, sdAdaptive, sdControl);

      var mExplainer = mean(explainerGains);
      var mNoExplainer = mean(noExplainerGains);
      var sdExplainer = stddev(explainerGains, mExplainer);
      var sdNoExplainer = stddev(noExplainerGains, mNoExplainer);
      var explainerD = cohensDBetween(explainerGains, noExplainerGains, mExplainer, mNoExplainer, sdExplainer, sdNoExplainer);

      // NPS = %promoters (9-10) - %detractors (0-6); passives 7-8.
      var npsValue: number | null = null;
      var promoters = 0, passives = 0, detractors = 0;
      for (var i = 0; i < npsScores.length; i++) {
        if (npsScores[i] >= 9) promoters++;
        else if (npsScores[i] >= 7) passives++;
        else detractors++;
      }
      if (npsScores.length > 0) npsValue = Math.round(((promoters - detractors) / npsScores.length) * 100);

      // concept-test likert means
      var ctLikertMeans: { [k: string]: number } = {};
      for (var mi = 0; mi < CONCEPT_LIKERT_KEYS.length; mi++) {
        var mk = CONCEPT_LIKERT_KEYS[mi];
        var mm = mean(ctLikert[mk]);
        if (mm !== null) ctLikertMeans[mk] = mm;
      }

      // Flatten participant rows (sorted for stable CSV output).
      var participants: any[] = [];
      var hashes = Object.keys(byHash);
      hashes.sort();
      for (var hi = 0; hi < hashes.length; hi++) participants.push(byHash[hashes[hi]]);

      var susMean = mean(susScores);
      var susSd = stddev(susScores, susMean);
      var adaptiveGroup = { n: adaptiveGains.length, mean_normalized_gain: mAdaptive, sd: sdAdaptive };
      var controlGroup = { n: controlGains.length, mean_normalized_gain: mControl, sd: sdControl };
      var explainerWith = { n: explainerGains.length, mean_normalized_gain: mExplainer, sd: sdExplainer };
      var explainerWithout = { n: noExplainerGains.length, mean_normalized_gain: mNoExplainer, sd: sdNoExplainer };

      return RpcHelpers.successResponse({
        ok: true,
        study_id: studyId,
        generated_at: new Date().toISOString(),
        generated_unix: nowSec(),
        generated_date: dateStr(),
        module_version: MODULE_VERSION,
        counts: {
          consents: consentCount,
          diagnostics: gainRowCount,
          surveys: surveyTotal,
          waitlist: waitlistCount,
          interview_volunteers: interviewVolunteers,
          prize_entrants: waitlistCount,
          student: surveyCounts["student"] || 0,
          teacher: surveyCounts["teacher"] || 0,
          parent: surveyCounts["parent"] || 0,
        },
        // Flat shape the dashboard + grant appendix read.
        learning_outcomes: {
          adaptive: adaptiveGroup,
          control: controlGroup,
          cohens_d: cohensD,
          explainer_video: {
            with: explainerWith,
            without: explainerWithout,
            cohens_d: explainerD,
            note: "Isolates the Simi/Lamina auto-generated explainer-video effect on learning gain (independent of the adaptive arm).",
          },
          // Legacy nested keys retained for backward compatibility.
          arms: { adaptive: adaptiveGroup, control: controlGroup },
          cohens_d_adaptive_vs_control: cohensD,
          interpretation_note: "normalized_gain is Hake's g = (post-pre)/(100-pre); Cohen's d>0.4 is a meaningful between-group effect.",
        },
        sus: { n: susScores.length, mean: susMean, sd: susSd },
        nps: { n: npsScores.length, score: npsValue, value: npsValue, promoters: promoters, passives: passives, detractors: detractors },
        concept_test: {
          n: ctN,
          us_grade_11_12: ctOnTarget,
          likert_means: ctLikertMeans,
          most_useful_modality: ctMostUseful,
          pmf_very_disappointed_pct: ctPmfTotal > 0 ? Math.round((100 * ctPmfVery / ctPmfTotal) * 10) / 10 : null,
        },
        // Legacy top-level blocks (kept so older consumers don't break).
        usability: {
          sus: { n: susScores.length, mean: susMean, sd: susSd },
          sus_benchmark_note: "SUS mean >68 is above the industry average; >80 is excellent.",
        },
        surveys: {
          counts_by_type: surveyCounts,
          nps: { n: npsScores.length, value: npsValue },
          interview_volunteers: interviewVolunteers,
        },
        waitlist: { signups: waitlistCount },
        participants: participants,
      });
    } catch (err: any) {
      logger.error("quizverse_research_export failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── Registration ────────────────────────────────────────────────────────────
  // STRING-LITERAL ids only (postbuild.js v2 hoists literal registerRpc calls).
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_research_consent", rpcConsent);
    initializer.registerRpc("quizverse_research_assignment_get", rpcAssignmentGet);
    initializer.registerRpc("quizverse_research_diagnostic_submit", rpcDiagnosticSubmit);
    initializer.registerRpc("quizverse_research_survey_submit", rpcSurveySubmit);
    initializer.registerRpc("quizverse_research_waitlist_join", rpcWaitlistJoin);
    initializer.registerRpc("quizverse_research_export", rpcExport);
  }
}
