// aahaa_validator.ts
// ─────────────────────────────────────────────────────────────────────────────
// Aahaa engine — the No-Hallucination Contract, server-side.
//
// This is the runtime twin of `lint-llm-output.ts` from
// CATALOG-DEDUCIBLE_INSIGHTS.md §7.4 + §12.2. Any surface that lets an LLM
// narrate over a Fact Pack (AI Host, AI Fortune Teller, AI Tutor) can POST its
// candidate text here BEFORE showing it to the user:
//
//   1. Every numeric claim in the text must appear in the fact pack (or be a
//      simple derivation: rounding, percent complement, ms→s conversion).
//   2. Emotion attribution ("you felt/laughed/are frustrated…") is rejected.
//   3. Word-count cap enforced (default 60).
//   4. Fortune Teller mode additionally:
//      · requires a non-deterministic phrase from the allowlist
//        ("suggests", "points to", "might", "could", "try", "for fun")
//      · rejects sensitive-inference terms (health/mood-disorder/money/...)
//      · rejects high-stakes advice verbs ("quit", "invest", "break up", ...)
//   5. On failure the caller gets `fallback_template` — a safe, fact-only
//      rendering it can show instead (never show the rejected text).

namespace AahaaValidator {

  var EMOTION_TOKENS = [
    "you felt", "you feel", "you're feeling", "you seemed", "you seem",
    "you laughed", "you cried", "you're proud", "you were proud",
    "you're frustrated", "you were frustrated", "you're sad", "you were sad",
    "you're angry", "you were angry", "you're excited", "you were excited",
    "you're happy", "you were happy", "you enjoyed", "you loved"
  ];

  var DETERMINISTIC_FUTURE = [
    "you will definitely", "this will happen", "you are destined", "it is certain",
    "you'll definitely", "guaranteed to"
  ];

  var FORTUNE_ALLOWLIST = ["suggest", "points to", "might", "could", "try", "for fun", "pattern"];

  var SENSITIVE_TERMS = [
    "depression", "anxiety", "diagnos", "therapy", "medicat", "illness", "disorder",
    "pregnan", "religion", "politic", "sexuality", "salary", "income", "debt",
    "divorce", "breakup", "break up", "medical"
  ];

  var ADVICE_VERBS = [
    "you should quit", "you should invest", "you should move", "take medicine",
    "stop taking", "you should leave", "you must buy", "you need to buy"
  ];

  export interface ValidationResult {
    pass: boolean;
    violations: string[];
    numeric_claims: string[];
    unmatched_numbers: string[];
    word_count: number;
    fallback_template: string;
  }

  // Flattens every number reachable in the facts object (plus cheap derived
  // forms) into a lookup set of canonical strings.
  function collectNumbers(obj: any, out: { [n: string]: boolean }, depth: number): void {
    if (depth > 6 || obj === null || obj === undefined) return;
    var t = typeof obj;
    if (t === "number") {
      if (!isFinite(obj)) return;
      addNumberForms(obj, out);
      return;
    }
    if (t === "string") {
      // Numbers embedded in stored strings (e.g. dates) count as citable.
      var m = obj.match(/\d+(\.\d+)?/g);
      if (m) for (var s = 0; s < m.length; s++) out[m[s]] = true;
      return;
    }
    if (t === "object") {
      if (Object.prototype.toString.call(obj) === "[object Array]") {
        for (var i = 0; i < obj.length; i++) collectNumbers(obj[i], out, depth + 1);
        // Array length is a countable fact ("3 topics").
        addNumberForms(obj.length, out);
      } else {
        var keys = Object.keys(obj);
        for (var k = 0; k < keys.length; k++) collectNumbers(obj[keys[k]], out, depth + 1);
      }
    }
  }

  function addNumberForms(n: number, out: { [n: string]: boolean }): void {
    out["" + n] = true;
    out["" + Math.round(n)] = true;
    out["" + Math.floor(n)] = true;
    out["" + Math.ceil(n)] = true;
    if (n >= 0 && n <= 100) out["" + (100 - Math.round(n))] = true;       // percent complement
    if (n >= 1000) {
      out["" + Math.round(n / 1000)] = true;                               // ms→s, k-rounding
      out["" + (Math.round(n / 100) / 10)] = true;                         // ms→s with 1 decimal
    }
    if (n > 0 && n < 1) out["" + Math.round(n * 100)] = true;              // ratio→pct
  }

  export function validate(text: string, facts: any, opts: any): ValidationResult {
    var violations: string[] = [];
    var surface = "" + ((opts && opts.surface) || "generic");
    var maxWords = (opts && opts.max_words) ? opts.max_words : 60;
    var lower = (" " + text + " ").toLowerCase();

    // 1 · Numeric claims must trace to the fact pack.
    var known: { [n: string]: boolean } = {};
    collectNumbers(facts, known, 0);
    // Small counting numbers in prose ("one of", "3-day") are allowed 0–10.
    for (var lo = 0; lo <= 10; lo++) known["" + lo] = true;

    var claims = text.match(/\d+(\.\d+)?/g) || [];
    var unmatched: string[] = [];
    for (var c = 0; c < claims.length; c++) {
      if (!known[claims[c]]) unmatched.push(claims[c]);
    }
    if (unmatched.length > 0) {
      violations.push("numeric claims not present in fact pack: " + unmatched.join(", "));
    }

    // 2 · No emotion attribution.
    for (var e = 0; e < EMOTION_TOKENS.length; e++) {
      if (lower.indexOf(EMOTION_TOKENS[e]) >= 0) {
        violations.push("emotion attribution: \"" + EMOTION_TOKENS[e] + "\"");
      }
    }

    // 3 · No deterministic future claims.
    for (var d = 0; d < DETERMINISTIC_FUTURE.length; d++) {
      if (lower.indexOf(DETERMINISTIC_FUTURE[d]) >= 0) {
        violations.push("deterministic future claim: \"" + DETERMINISTIC_FUTURE[d] + "\"");
      }
    }

    // 4 · Word count.
    var words = text.split(/\s+/);
    var wordCount = 0;
    for (var w = 0; w < words.length; w++) if (words[w].length > 0) wordCount++;
    if (wordCount > maxWords) violations.push("word count " + wordCount + " exceeds max " + maxWords);

    // 5 · Fortune Teller mode (soft-signal guardrails, §12.2).
    if (surface === "AIFortuneTeller" || surface === "aifortuneteller") {
      var hasAllow = false;
      for (var a = 0; a < FORTUNE_ALLOWLIST.length; a++) {
        if (lower.indexOf(FORTUNE_ALLOWLIST[a]) >= 0) { hasAllow = true; break; }
      }
      if (!hasAllow) violations.push("fortune output missing non-deterministic phrase (suggests/points to/might/could/try/for fun)");
      for (var st = 0; st < SENSITIVE_TERMS.length; st++) {
        if (lower.indexOf(SENSITIVE_TERMS[st]) >= 0) violations.push("sensitive inference term: \"" + SENSITIVE_TERMS[st] + "\"");
      }
      for (var av = 0; av < ADVICE_VERBS.length; av++) {
        if (lower.indexOf(ADVICE_VERBS[av]) >= 0) violations.push("high-stakes advice: \"" + ADVICE_VERBS[av] + "\"");
      }
      var signalCount = (facts && facts.recent && facts.recent.answered) ? 1 : 0;
      if (signalCount === 0) violations.push("fortune personalisation requires ≥1 behavioural signal in the fact pack");
    }

    // Safe deterministic fallback the caller can render verbatim on failure.
    var fallback = "You've answered {questions_answered} questions with {accuracy_pct}% accuracy. Keep going.";
    if (surface === "AIFortuneTeller" || surface === "aifortuneteller") {
      fallback = "The cards are quiet today — try a quiz and check back. For fun, based on your recent QuizVerse patterns.";
    }

    return {
      pass: violations.length === 0,
      violations: violations,
      numeric_claims: claims,
      unmatched_numbers: unmatched,
      word_count: wordCount,
      fallback_template: fallback
    };
  }
}
