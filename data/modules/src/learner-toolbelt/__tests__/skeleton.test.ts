// __tests__/skeleton.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Self-contained micro test runner for the Learner Toolbelt no-exam fallback.
//
// We deliberately avoid Jest / Mocha so this file compiles cleanly against
// the production tsconfig.json (no test-runner deps in the runtime build).
// `LearnerToolbeltTests.runAll()` returns { passed, failed, errors } — wire
// it to a future npm-test script (or invoke from a Node REPL) when the team
// adopts a runner.
//
// Coverage (PR: feat/learner-toolbelt-no-exam-fallback):
//   1. deriveLearnerMode → each of the 4 modes (A/B/C/D from § 2.5.1)
//      against the 4 fixture user scenarios.
//   2. buildLearnerInsightsResponse → forbidden-string lint (§ 3.13.6 A25)
//      — recursively scans every string in the response for exam jargon
//      and fails if any token matches.
//   3. rpcScorePredict with no exam_id → returns the § 3.13.3 redirect
//      payload (not an error).
//   4. shouldShowSoftExamCta → false for <20 quizzes, <10 active days, or
//      a recent nudge (§ 3.13.4 engagement floor + 14d cooldown).

namespace LearnerToolbeltTests {

  // ── Micro test runner ─────────────────────────────────────────────────────

  interface TestCase {
    suite: string;
    name: string;
    fn: () => void;
  }

  var allTests: TestCase[] = [];
  var currentSuite: string = "(root)";

  function describe(suite: string, fn: () => void): void {
    var prev = currentSuite;
    currentSuite = suite;
    try { fn(); }
    finally { currentSuite = prev; }
  }

  function it(name: string, fn: () => void): void {
    allTests.push({ suite: currentSuite, name: name, fn: fn });
  }

  function fmt(v: any): string {
    try { return JSON.stringify(v); } catch (_e: any) { return String(v); }
  }

  function expectEq(actual: any, expected: any, msg?: string): void {
    if (actual !== expected) {
      throw new Error(
        (msg ? msg + " — " : "") +
        "expected " + fmt(expected) + " got " + fmt(actual)
      );
    }
  }

  function expectTrue(actual: any, msg?: string): void {
    if (actual !== true) {
      throw new Error((msg ? msg + " — " : "") + "expected true, got " + fmt(actual));
    }
  }

  function expectFalse(actual: any, msg?: string): void {
    if (actual !== false) {
      throw new Error((msg ? msg + " — " : "") + "expected false, got " + fmt(actual));
    }
  }

  // ── Forbidden-string lint (§ 3.13.6 A25) ──────────────────────────────────
  //
  // Recursively walks every string value in `obj` and fails if any matches
  // an exam-mode token (case-insensitive). This MUST mirror the gateway-side
  // lint that runs in CI on the Learner Insights response.
  //
  // Note on tokens: we match the user-facing prose only. Field-level keys
  // ("peer_percentile_overall", "peer_percentile_per_topic") are fine — they
  // are object KEYS, not user-facing strings. We restrict the scan to string
  // VALUES.
  var FORBIDDEN = /predicted score|\bAIR\b|scaled score|grade boundary|percentile rank|cutoff/i;

  function scanForbidden(node: any, path: string, hits: Array<{ path: string; value: string }>): void {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      if (FORBIDDEN.test(node)) {
        hits.push({ path: path, value: node });
      }
      return;
    }
    if (typeof node === "number" || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        scanForbidden(node[i], path + "[" + i + "]", hits);
      }
      return;
    }
    if (typeof node === "object") {
      for (var k in node) {
        if (Object.prototype.hasOwnProperty.call(node, k)) {
          scanForbidden(node[k], path === "" ? k : path + "." + k, hits);
        }
      }
    }
  }

  // ── Mock Nakama runtime ───────────────────────────────────────────────────
  //
  // Just enough surface for our RPCs to run. Each mock takes a `storage`
  // map and replays it for storageRead; storageWrite is captured for
  // verification but otherwise no-op.

  interface MockStorageEntry {
    collection: string;
    key: string;
    userId: string;
    value: any;
  }

  function makeMockNk(entries: MockStorageEntry[]): any {
    var writes: any[] = [];
    return {
      storageRead: function(reqs: any[]): any[] {
        var out: any[] = [];
        for (var i = 0; i < reqs.length; i++) {
          var r = reqs[i];
          var hit: any = null;
          for (var j = 0; j < entries.length; j++) {
            var e = entries[j];
            if (e.collection === r.collection && e.key === r.key && e.userId === r.userId) {
              hit = e; break;
            }
          }
          out.push(hit ? { collection: hit.collection, key: hit.key, userId: hit.userId, value: hit.value } : { value: null });
        }
        return out;
      },
      storageWrite: function(reqs: any[]): any[] {
        for (var i = 0; i < reqs.length; i++) writes.push(reqs[i]);
        return [];
      },
      sha256Hash: function(s: string): string { return "h_" + s; },
      _writes: writes,
    };
  }

  function makeMockCtx(opts?: { userId?: string; env?: any }): any {
    return {
      userId: opts && opts.userId ? opts.userId : "",
      env: opts && opts.env ? opts.env : { LT_SERVICE_TOKEN: "test_token" },
    };
  }

  function makeMockLogger(): any {
    return {
      info: function(_m: string): void { /* no-op */ },
      warn: function(_m: string): void { /* no-op */ },
      error: function(_m: string): void { /* no-op */ },
      debug: function(_m: string): void { /* no-op */ },
    };
  }

  // ── Tests: deriveLearnerMode (§ 3.13.1 / § 2.5.1) ─────────────────────────

  describe("deriveLearnerMode — 4 user states", function(): void {

    // State A: exam declared
    it("state A (exam_prep declared) → mode='exam'", function(): void {
      var d = LearnerToolbelt.deriveLearnerMode({
        declared_intent: "exam_prep",
        has_exam_declared: false,
        has_school_declared: false,
        quiz_count_last_30d: 0,
      });
      expectEq(d.mode, "exam");
      expectEq(d.copy_namespace, "exam");
      expectEq(d.recommended_tool, "/tools/score-predictor");
    });

    it("state A (qv_u_<sub>_exam present) → mode='exam'", function(): void {
      var d = LearnerToolbelt.deriveLearnerMode({
        declared_intent: null,
        has_exam_declared: true,
        has_school_declared: false,
        quiz_count_last_30d: 0,
      });
      expectEq(d.mode, "exam");
    });

    // State B: school declared, no exam
    it("state B (school declared, no exam) → mode='learner'", function(): void {
      var d = LearnerToolbelt.deriveLearnerMode({
        declared_intent: null,
        has_exam_declared: false,
        has_school_declared: true,
        quiz_count_last_30d: 0,
      });
      expectEq(d.mode, "learner");
      expectEq(d.copy_namespace, "learner");
      expectEq(d.recommended_tool, "/tools/learn");
    });

    // State C: authed but cold — actually maps to 'learner' once they have
    // 5+ quizzes (the 'cold' threshold per § 2.5.1).
    it("state C (auth'd, 5+ quizzes, no exam/school) → mode='learner'", function(): void {
      var d = LearnerToolbelt.deriveLearnerMode({
        declared_intent: null,
        has_exam_declared: false,
        has_school_declared: false,
        quiz_count_last_30d: 12,
      });
      expectEq(d.mode, "learner");
      expectTrue(d.has_history);
    });

    // State D: anonymous / zero-history
    it("state D (no auth, no history) → mode='cold_start'", function(): void {
      var d = LearnerToolbelt.deriveLearnerMode({
        declared_intent: null,
        has_exam_declared: false,
        has_school_declared: false,
        quiz_count_last_30d: 0,
      });
      expectEq(d.mode, "cold_start");
      expectEq(d.copy_namespace, "cold_start");
      expectFalse(d.has_history);
    });

    it("state D (auth'd with <5 quizzes) → mode='cold_start'", function(): void {
      var d = LearnerToolbelt.deriveLearnerMode({
        declared_intent: null,
        has_exam_declared: false,
        has_school_declared: false,
        quiz_count_last_30d: 3,
      });
      expectEq(d.mode, "cold_start");
    });

    // Parent intent always wins, regardless of other signals
    it("declared_intent='parent' overrides exam signal → mode='parent'", function(): void {
      var d = LearnerToolbelt.deriveLearnerMode({
        declared_intent: "parent",
        has_exam_declared: true,
        has_school_declared: true,
        quiz_count_last_30d: 99,
      });
      expectEq(d.mode, "parent");
      expectEq(d.recommended_tool, "/tools/parent-dashboard");
    });
  });

  describe("lt_learner_state_get — RPC integration", function(): void {

    it("returns mode='exam' when qv_user_exam.declared exists", function(): void {
      var nk = makeMockNk([
        { collection: "qv_user_exam", key: "declared", userId: "test-user-1", value: { exam_id: "sat" } },
      ]);
      var ctx = makeMockCtx({ userId: "test-user-1" });
      var raw = LearnerToolbelt.rpcLearnerStateGet(ctx, makeMockLogger(), nk, "{}");
      var resp = JSON.parse(raw);
      expectTrue(resp.success);
      expectEq(resp.data.mode, "exam");
      expectTrue(resp.data.has_exam_declared);
    });

    it("returns mode='learner' when qv_lt_school.current exists", function(): void {
      var nk = makeMockNk([
        { collection: "qv_lt_school", key: "current", userId: "test-user-2", value: { school_id: "nces:123" } },
      ]);
      var ctx = makeMockCtx({ userId: "test-user-2" });
      var raw = LearnerToolbelt.rpcLearnerStateGet(ctx, makeMockLogger(), nk, "{}");
      var resp = JSON.parse(raw);
      expectEq(resp.data.mode, "learner");
      expectTrue(resp.data.has_school_declared);
    });

    it("returns mode='cold_start' for a fresh user (no exam/school/history)", function(): void {
      var nk = makeMockNk([]);
      var ctx = makeMockCtx({ userId: "test-user-3" });
      var raw = LearnerToolbelt.rpcLearnerStateGet(ctx, makeMockLogger(), nk, "{}");
      var resp = JSON.parse(raw);
      expectEq(resp.data.mode, "cold_start");
      expectFalse(resp.data.has_history);
    });

    it("respects declared_intent='parent' from the payload", function(): void {
      var nk = makeMockNk([]);
      var ctx = makeMockCtx({ userId: "test-user-4" });
      var raw = LearnerToolbelt.rpcLearnerStateGet(ctx, makeMockLogger(), nk, '{"declared_intent":"parent"}');
      var resp = JSON.parse(raw);
      expectEq(resp.data.mode, "parent");
    });
  });

  // ── Tests: buildLearnerInsightsResponse (§ 3.13.6 A25 forbidden-string lint) ──

  describe("lt_learner_insights_get — forbidden-string lint", function(): void {

    it("learner-mode response contains zero forbidden exam tokens", function(): void {
      var resp = LearnerToolbelt.buildLearnerInsightsResponse({
        state: "authed",
        mode: "learner",
        locale: "en",
      });
      var hits: Array<{ path: string; value: string }> = [];
      scanForbidden(resp, "", hits);
      if (hits.length > 0) {
        throw new Error("forbidden tokens found: " + JSON.stringify(hits));
      }
      expectEq(hits.length, 0);
    });

    it("cold-start response contains zero forbidden exam tokens", function(): void {
      var resp = LearnerToolbelt.buildLearnerInsightsResponse({
        state: "anon",
        mode: "cold_start",
        locale: "en",
      });
      var hits: Array<{ path: string; value: string }> = [];
      scanForbidden(resp, "", hits);
      if (hits.length > 0) {
        throw new Error("forbidden tokens found: " + JSON.stringify(hits));
      }
      expectEq(hits.length, 0);
    });

    it("response always sets forbidden_copy: false (explicit contract guarantee)", function(): void {
      var a = LearnerToolbelt.buildLearnerInsightsResponse({ state: "authed", mode: "learner", locale: "en" });
      var b = LearnerToolbelt.buildLearnerInsightsResponse({ state: "anon", mode: "cold_start", locale: "en" });
      expectEq(a.forbidden_copy, false);
      expectEq(b.forbidden_copy, false);
    });

    it("cold-start CTA is hard-coded to play_5_quizzes per § 3.13.2", function(): void {
      var resp = LearnerToolbelt.buildLearnerInsightsResponse({ state: "anon", mode: "cold_start", locale: "en" });
      expectEq(resp.cta.kind, "try_a_topic");
      expectEq(resp.cta.copy_key, "cta.cold_start.play_5_quizzes");
      expectEq(resp.metrics.quizzes_played, 0);
    });

    it("learner mode returns mock metrics with non-zero quiz_count (Phase A)", function(): void {
      var resp = LearnerToolbelt.buildLearnerInsightsResponse({ state: "authed", mode: "learner", locale: "en" });
      expectTrue(resp.metrics.quizzes_played > 0);
      expectEq(resp.status, "mock_data");
      expectEq(resp.phase, "A");
    });

    // Sanity-check the lint itself — feeding it a known-bad string MUST trip it.
    it("lint correctly detects forbidden tokens (self-test)", function(): void {
      var bad = { headline: "Your predicted score is 1400", nested: { tip: "improve your AIR" } };
      var hits: Array<{ path: string; value: string }> = [];
      scanForbidden(bad, "", hits);
      expectEq(hits.length, 2);
    });
  });

  // ── Tests: lt_score_predict no-exam redirect (§ 3.13.3) ──────────────────

  describe("lt_score_predict — no-exam fallback", function(): void {

    it("missing exam_id → redirect to lt_learner_insights_get", function(): void {
      var ctx = makeMockCtx({ userId: "test-user-r1" });
      var nk = makeMockNk([]);
      var raw = LearnerToolbelt.rpcScorePredict(ctx, makeMockLogger(), nk, '{"locale":"en"}');
      var resp = JSON.parse(raw);
      expectTrue(resp.success);
      expectEq(resp.data.redirect_to, "lt_learner_insights_get");
      expectEq(resp.data.reason, "no_exam_declared");
    });

    it("exam_id='learner_general' → redirect to lt_learner_insights_get", function(): void {
      var ctx = makeMockCtx({ userId: "test-user-r2" });
      var nk = makeMockNk([]);
      var raw = LearnerToolbelt.rpcScorePredict(ctx, makeMockLogger(), nk, '{"exam_id":"learner_general","locale":"en"}');
      var resp = JSON.parse(raw);
      expectEq(resp.data.redirect_to, "lt_learner_insights_get");
    });

    it("valid exam_id → no redirect, normal stub response", function(): void {
      var ctx = makeMockCtx({ userId: "test-user-r3" });
      var nk = makeMockNk([]);
      var raw = LearnerToolbelt.rpcScorePredict(ctx, makeMockLogger(), nk, '{"exam_id":"sat","locale":"en"}');
      var resp = JSON.parse(raw);
      expectEq(resp.data.exam_id, "sat");
      expectEq(resp.data.redirect_to, undefined);
    });
  });

  // ── Tests: shouldShowSoftExamCta (§ 3.13.4) ──────────────────────────────

  describe("shouldShowSoftExamCta — 14-day engagement gate", function(): void {

    it("returns false for fewer than 20 quizzes in last 2w", function(): void {
      var r = LearnerToolbelt.shouldShowSoftExamCta(
        { quizzes_played_last_2w: 15, daysActive_last_2w: 14 },
        null
      );
      expectFalse(r);
    });

    it("returns false for fewer than 10 active days in last 2w", function(): void {
      var r = LearnerToolbelt.shouldShowSoftExamCta(
        { quizzes_played_last_2w: 30, daysActive_last_2w: 8 },
        null
      );
      expectFalse(r);
    });

    it("returns false when a nudge was shown within 14d", function(): void {
      var oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
      var r = LearnerToolbelt.shouldShowSoftExamCta(
        { quizzes_played_last_2w: 25, daysActive_last_2w: 12 },
        oneDayAgo
      );
      expectFalse(r);
    });

    it("returns true when all engagement gates pass and no recent nudge", function(): void {
      var r = LearnerToolbelt.shouldShowSoftExamCta(
        { quizzes_played_last_2w: 25, daysActive_last_2w: 12 },
        null
      );
      expectTrue(r);
    });

    it("returns true when last nudge is older than 14d (cooldown expired)", function(): void {
      var fifteenDaysAgo = Math.floor(Date.now() / 1000) - (15 * 86400);
      var r = LearnerToolbelt.shouldShowSoftExamCta(
        { quizzes_played_last_2w: 25, daysActive_last_2w: 12 },
        fifteenDaysAgo
      );
      expectTrue(r);
    });

    it("returns false at the exact floor (19 quizzes) — strict inequality", function(): void {
      var r = LearnerToolbelt.shouldShowSoftExamCta(
        { quizzes_played_last_2w: 19, daysActive_last_2w: 14 },
        null
      );
      expectFalse(r);
    });

    it("returns false at the exact floor (9 active days) — strict inequality", function(): void {
      var r = LearnerToolbelt.shouldShowSoftExamCta(
        { quizzes_played_last_2w: 25, daysActive_last_2w: 9 },
        null
      );
      expectFalse(r);
    });
  });

  // ── Runner entry ──────────────────────────────────────────────────────────

  export function runAll(): { passed: number; failed: number; errors: string[]; total: number } {
    var passed = 0;
    var errors: string[] = [];
    for (var i = 0; i < allTests.length; i++) {
      var t = allTests[i];
      try {
        t.fn();
        passed++;
      } catch (e: any) {
        var msg = e && e.message ? e.message : String(e);
        errors.push("[" + t.suite + "] " + t.name + " — " + msg);
      }
    }
    return { passed: passed, failed: errors.length, errors: errors, total: allTests.length };
  }
}
