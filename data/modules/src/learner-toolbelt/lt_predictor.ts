// lt_predictor.ts
// ─────────────────────────────────────────────────────────────────────────────
// LearnerToolbelt — Bayes fallback score predictor (Wave 5 — PLAN § 3.7).
//
// Phase A scope: L0 diagnostic ONLY (Bayesian beta-posterior over the user's
// recent quiz accuracy → mapped through a per-exam linear function). The
// IRT 2PL path (§ 3.6) requires offline calibration of per-item a/b params
// — that's a follow-up PR.
//
// Predictor tier per PLAN-EXAM_TAXONOMY_EXPANSION § 2.22:
//   < 8 quizzes  → status: "insufficient_data"
//   8 - 19       → predictor_tier: "l0_diagnostic", confidence band only
//   ≥ 20         → predictor_tier: "l1_profile",   point estimate + 90% CI
//
// Data source: legacy `quiz_results` collection (see src/legacy/quiz.ts).
// Each row is `result_<userId>_<unix>` with shape:
//   { score, totalQuestions, correctAnswers, category, timestamp }
// We filter by timestamp (last 60 days) and exam tag (`category` substring).
//
// Localised recommendation text per (exam, accuracy_band, locale) — keys
// owned by lt_i18n.ts (RPC owns translations per § 7.4 to keep clients
// in sync without per-platform string bundles).

namespace LearnerToolbelt {

  export interface ScorePredictRequest {
    exam_id: string;
    locale: string;
    recent_quiz_window_days: number;
  }

  export interface ScorePredictBucket {
    scaled_score: number | null;
    percentile: number | null;
    rank: number | null;
    grade: string | null;
    ci_low: number;
    ci_high: number;
  }

  export interface ScorePredictResult {
    ok: boolean;
    status: string;                  // "ok" | "insufficient_data" | "exam_not_supported"
    exam_id: string;
    predictor_tier: string;          // "l0_diagnostic" | "l1_profile"
    model_version: string;
    quizzes_used: number;
    quizzes_total_in_window: number;
    min_quizzes_for_high_confidence: number;
    accuracy_observed: number;       // 0..1
    posterior_mean: number;          // beta posterior mean
    predicted: ScorePredictBucket;
    recommendation_text: string;
    confidence_pct: number;
    generated_unix: number;
    ttl_seconds: number;
  }

  export interface QuizHistoryEntry {
    timestamp: number;
    correctAnswers: number;
    totalQuestions: number;
    category: string;
  }

  // ── Per-exam scaling functions ───────────────────────────────────────────
  // Each exam maps a [0..1] accuracy to its native score scale. We pass the
  // beta-posterior MEAN through `toNative`, and the 90% credible-interval
  // bounds through the same function to derive CI endpoints.
  interface ExamScaler {
    family: string;                                  // "scaled" | "percentile" | "grade"
    toNative: (accuracy: number) => number;
    label: (n: number) => string;
    nativeMin: number;
    nativeMax: number;
    aliases: string[];                               // category-tag matchers
  }

  function clampUnit(x: number): number {
    if (x < 0) return 0; if (x > 1) return 1; return x;
  }

  // SAT: 0.0 → 400, 1.0 → 1600.
  var SCALER_SAT: ExamScaler = {
    family: "scaled",
    toNative: function (a) { return Math.round(400 + clampUnit(a) * 1200); },
    label: function (n) { return "" + n; },
    nativeMin: 400, nativeMax: 1600,
    aliases: ["sat", "sat-math", "sat-rw", "sat_math", "sat_reading"],
  };

  // ACT: 0.0 → 1, 1.0 → 36.
  var SCALER_ACT: ExamScaler = {
    family: "scaled",
    toNative: function (a) { return Math.round(1 + clampUnit(a) * 35); },
    label: function (n) { return "" + n; },
    nativeMin: 1, nativeMax: 36,
    aliases: ["act", "act_math", "act_english"],
  };

  // JEE Main: accuracy → percentile (0..100), then % → approximate AIR.
  // AIR ≈ (1 - percentile/100) * 1.4M (NTA reports ~1.4M Session-1 candidates).
  var SCALER_JEE: ExamScaler = {
    family: "percentile",
    toNative: function (a) { return Math.round(clampUnit(a) * 10000) / 100; }, // percentile 0..100 (2dp)
    label: function (n) { return n.toFixed(2) + " percentile"; },
    nativeMin: 0, nativeMax: 100,
    aliases: ["jee_main", "jee", "jee_advanced"],
  };

  // AP: accuracy → grade 1..5 (continuous, rounded for label).
  var SCALER_AP: ExamScaler = {
    family: "grade",
    toNative: function (a) { return Math.round((1 + clampUnit(a) * 4) * 10) / 10; },
    label: function (n) { return n.toFixed(1); },
    nativeMin: 1, nativeMax: 5,
    aliases: ["ap", "ap_biology", "ap_calculus", "ap_chemistry", "ap_physics", "ap_us_history"],
  };

  // NEET: like JEE but with ~1.8M candidates and 720-mark scale.
  var SCALER_NEET: ExamScaler = {
    family: "scaled",
    toNative: function (a) { return Math.round(clampUnit(a) * 720); },
    label: function (n) { return "" + n + " / 720"; },
    nativeMin: 0, nativeMax: 720,
    aliases: ["neet", "neet_ug"],
  };

  // Generic / unknown exam: return raw percentile against in-cohort users.
  var SCALER_GENERIC: ExamScaler = {
    family: "percentile",
    toNative: function (a) { return Math.round(clampUnit(a) * 10000) / 100; },
    label: function (n) { return n.toFixed(1) + " percentile (QuizVerse cohort)"; },
    nativeMin: 0, nativeMax: 100,
    aliases: [],
  };

  function pickScaler(examId: string): ExamScaler {
    var id = ("" + (examId || "")).toLowerCase();
    if (SCALER_SAT.aliases.indexOf(id) >= 0) return SCALER_SAT;
    if (SCALER_ACT.aliases.indexOf(id) >= 0) return SCALER_ACT;
    if (SCALER_JEE.aliases.indexOf(id) >= 0) return SCALER_JEE;
    if (SCALER_AP.aliases.indexOf(id) >= 0 || id.indexOf("ap_") === 0) return SCALER_AP;
    if (SCALER_NEET.aliases.indexOf(id) >= 0) return SCALER_NEET;
    return SCALER_GENERIC;
  }

  // ── Beta-posterior approximation ─────────────────────────────────────────
  // α = correct + 1, β = incorrect + 1  (uniform prior).
  // Mean    = α / (α+β)
  // Variance= αβ / [(α+β)² (α+β+1)]
  // 90% CI approximated via Wilson-style ± 1.645 * sqrt(var). Good enough for
  // L0 diagnostic; the IRT path in the follow-up PR will use the proper
  // posterior quantiles.
  export function betaPosteriorBounds(correct: number, total: number): { mean: number; lo90: number; hi90: number } {
    var alpha = correct + 1;
    var beta = (total - correct) + 1;
    var sum = alpha + beta;
    var mean = alpha / sum;
    var variance = (alpha * beta) / (sum * sum * (sum + 1));
    var sd = Math.sqrt(variance);
    var z = 1.645;
    var lo = Math.max(0, mean - z * sd);
    var hi = Math.min(1, mean + z * sd);
    return { mean: mean, lo90: lo, hi90: hi };
  }

  // ── Quiz-history filter ──────────────────────────────────────────────────
  // examId is matched against the row's `category` string (substring, case-
  // insensitive). For the long-tail cases where category is "general" but the
  // user told us they're studying for SAT, we still count the row toward the
  // L0 diagnostic — better to ship one signal than zero, with confidence
  // appropriately tagged.
  export function filterHistoryForExam(rows: QuizHistoryEntry[], examId: string, windowDays: number, nowUnix: number): { matched: QuizHistoryEntry[]; total: number } {
    var cutoff = nowUnix - Math.max(1, windowDays) * 86400;
    var ex = ("" + (examId || "")).toLowerCase();
    var fam = pickScaler(examId);
    var matched: QuizHistoryEntry[] = [];
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r.timestamp || r.timestamp < cutoff) continue;
      total++;
      var cat = ("" + (r.category || "")).toLowerCase();
      if (cat.indexOf(ex) >= 0) {
        matched.push(r);
        continue;
      }
      // alias matching (e.g. examId="ap" → match "ap_biology")
      var aliasHit = false;
      for (var a = 0; a < fam.aliases.length; a++) {
        if (cat.indexOf(fam.aliases[a]) >= 0) { aliasHit = true; break; }
      }
      if (aliasHit) matched.push(r);
    }
    return { matched: matched, total: total };
  }

  // ── Bands → i18n key suffix ──────────────────────────────────────────────
  export function accuracyBand(accuracy: number): string {
    if (accuracy >= 0.75) return "high";
    if (accuracy >= 0.5) return "mid";
    return "low";
  }

  // ── Main predict entry ───────────────────────────────────────────────────
  // Returns the full ScorePredictResult given pre-fetched history rows. The
  // RPC handler does the storage read; this function is pure (testable).
  export function predictFromHistory(req: ScorePredictRequest, history: QuizHistoryEntry[], nowUnix: number): ScorePredictResult {
    var scaler = pickScaler(req.exam_id);
    var win = req.recent_quiz_window_days > 0 ? req.recent_quiz_window_days : 60;
    var filtered = filterHistoryForExam(history, req.exam_id, win, nowUnix);

    // Aggregate
    var totalCorrect = 0, totalQuestions = 0;
    for (var i = 0; i < filtered.matched.length; i++) {
      var r = filtered.matched[i];
      totalCorrect += Math.max(0, r.correctAnswers | 0);
      totalQuestions += Math.max(0, r.totalQuestions | 0);
    }

    if (filtered.matched.length < 8 || totalQuestions < 8) {
      return {
        ok: true,
        status: "insufficient_data",
        exam_id: req.exam_id,
        predictor_tier: "below_l0",
        model_version: "l0-bayes-v1",
        quizzes_used: filtered.matched.length,
        quizzes_total_in_window: filtered.total,
        min_quizzes_for_high_confidence: 20,
        accuracy_observed: 0,
        posterior_mean: 0,
        predicted: {
          scaled_score: null, percentile: null, rank: null, grade: null,
          ci_low: 0, ci_high: 0,
        },
        recommendation_text: i18nRecommendation(req.locale, req.exam_id, "insufficient_data"),
        confidence_pct: 0,
        generated_unix: nowUnix,
        ttl_seconds: 3600,
      };
    }

    var post = betaPosteriorBounds(totalCorrect, totalQuestions);
    var nativeMean = scaler.toNative(post.mean);
    var nativeLo = scaler.toNative(post.lo90);
    var nativeHi = scaler.toNative(post.hi90);
    var tier = filtered.matched.length >= 20 ? "l1_profile" : "l0_diagnostic";

    // Build the predicted bucket per family.
    var bucket: ScorePredictBucket = {
      scaled_score: null, percentile: null, rank: null, grade: null,
      ci_low: Math.min(nativeLo, nativeHi), ci_high: Math.max(nativeLo, nativeHi),
    };
    if (scaler.family === "scaled") {
      bucket.scaled_score = nativeMean;
    } else if (scaler.family === "percentile") {
      bucket.percentile = nativeMean;
      // Derived AIR for JEE-family
      if (scaler === SCALER_JEE) {
        bucket.rank = Math.max(1, Math.round((1 - nativeMean / 100) * 1400000));
      }
    } else if (scaler.family === "grade") {
      bucket.grade = scaler.label(nativeMean);
      bucket.scaled_score = nativeMean;
    }

    var band = accuracyBand(post.mean);
    var rec = i18nRecommendation(req.locale, req.exam_id, band);
    // Substitute the predicted-value placeholder if present.
    var predictedLabel = scaler.label(nativeMean);
    rec = rec.replace("{predicted}", predictedLabel).replace("{ci_low}", "" + bucket.ci_low).replace("{ci_high}", "" + bucket.ci_high);

    // Crude confidence: 100 - (CI half-width / native range) * 100, clamped.
    var range = Math.max(1, scaler.nativeMax - scaler.nativeMin);
    var halfWidth = Math.max(0, (bucket.ci_high - bucket.ci_low) / 2);
    var confidence = Math.max(10, Math.min(95, 100 - (halfWidth / range) * 200));

    return {
      ok: true,
      status: "ok",
      exam_id: req.exam_id,
      predictor_tier: tier,
      model_version: tier === "l1_profile" ? "l1-bayes-v1" : "l0-bayes-v1",
      quizzes_used: filtered.matched.length,
      quizzes_total_in_window: filtered.total,
      min_quizzes_for_high_confidence: 20,
      accuracy_observed: Math.round(post.mean * 10000) / 10000,
      posterior_mean: Math.round(post.mean * 10000) / 10000,
      predicted: bucket,
      recommendation_text: rec,
      confidence_pct: Math.round(confidence),
      generated_unix: nowUnix,
      ttl_seconds: 1800,
    };
  }

  // ── Per-exam uplift constant for the countdown formula (plan § 4.4) ──────
  // expected_uplift_per_quiz — see plan: 0.4 SAT-points, 0.1 percentile-JEE,
  // 0.05 percentile-other.
  export function expectedUpliftPerQuiz(examId: string): { unit: string; value: number } {
    var id = ("" + (examId || "")).toLowerCase();
    if (SCALER_SAT.aliases.indexOf(id) >= 0) return { unit: "sat_points", value: 0.4 };
    if (SCALER_JEE.aliases.indexOf(id) >= 0 || SCALER_NEET.aliases.indexOf(id) >= 0) {
      return { unit: "percentile", value: 0.1 };
    }
    return { unit: "percentile", value: 0.05 };
  }
}
