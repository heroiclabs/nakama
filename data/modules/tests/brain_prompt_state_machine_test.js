#!/usr/bin/env node
// Pure deterministic tests for Quizverse Brain prompt selection/time gates.
// Kept dependency-free so it runs in CI without a live Nakama/Cockroach stack.

var passed = 0;
var failed = 0;

function assert(name, actual, expected) {
  if (actual === expected) {
    console.log("  ✓ " + name);
    passed++;
  } else {
    console.error("  ✗ " + name + " — expected " + JSON.stringify(expected) +
      " got " + JSON.stringify(actual));
    failed++;
  }
}

function safeString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function selectPrompt(data) {
  var trigger = safeString(data.trigger, 32).toLowerCase();
  var session = data.session && typeof data.session === "object" ? data.session : {};
  if (trigger === "app_home_open") {
    return { promptId: "weekly_recap", bucket: "weekly" };
  }
  if (trigger !== "post_quiz_results") return null;

  var maxWrong = Math.max(0, Math.min(1000, Number(session.max_consecutive_wrong || 0)));
  if (maxWrong >= 3) return { promptId: "wrong_streak", bucket: "daily" };

  var accuracy = Number(session.category_accuracy_pct);
  if (isFinite(accuracy) && accuracy >= 0 && accuracy < 60 && data.notes_eligible === true) {
    return { promptId: "post_quiz_weak", bucket: "daily" };
  }
  return null;
}

function isoWeek(nowMs) {
  var date = new Date(nowMs);
  var day = date.getUTCDay();
  var isoDay = day === 0 ? 7 : day;
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);
  var yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  var week = Math.ceil((((date.getTime() - yearStart) / 86400000) + 1) / 7);
  return date.getUTCFullYear() + "-W" + (week < 10 ? "0" : "") + week;
}

console.log("\n=== Brain prompt priority and eligibility ===");

(function () {
  var selected = selectPrompt({
    trigger: "post_quiz_results",
    notes_eligible: true,
    session: { max_consecutive_wrong: 4, category_accuracy_pct: 20 }
  });
  assert("wrong streak wins when both post-quiz rules qualify", selected.promptId, "wrong_streak");
})();

(function () {
  var selected = selectPrompt({
    trigger: "post_quiz_results",
    notes_eligible: true,
    session: { max_consecutive_wrong: 2, category_accuracy_pct: 59.99 }
  });
  assert("weak category qualifies below 60 with notes", selected.promptId, "post_quiz_weak");
})();

(function () {
  var selected = selectPrompt({
    trigger: "post_quiz_results",
    notes_eligible: false,
    session: { max_consecutive_wrong: 2, category_accuracy_pct: 10 }
  });
  assert("weak category is suppressed without relevant notes", selected, null);
})();

(function () {
  var selected = selectPrompt({
    trigger: "post_quiz_results",
    notes_eligible: true,
    session: { max_consecutive_wrong: 2, category_accuracy_pct: 60 }
  });
  assert("60 percent is not below threshold", selected, null);
})();

(function () {
  var selected = selectPrompt({ trigger: "app_home_open", session: {} });
  assert("home-open maps only to weekly recap", selected.promptId, "weekly_recap");
  assert("weekly recap uses separate weekly bucket", selected.bucket, "weekly");
})();

console.log("\n=== UTC/ISO week boundaries ===");

assert("2026-01-01 belongs to ISO week 1", isoWeek(Date.parse("2026-01-01T00:00:00Z")), "2026-W01");
assert("2026-12-31 belongs to ISO week 53", isoWeek(Date.parse("2026-12-31T23:59:59Z")), "2026-W53");
assert("2027-01-01 remains in 2026 week 53", isoWeek(Date.parse("2027-01-01T00:00:00Z")), "2026-W53");
assert("2027-01-04 starts 2027 week 1", isoWeek(Date.parse("2027-01-04T00:00:00Z")), "2027-W01");

console.log("\n=== Input hardening ===");

(function () {
  var selected = selectPrompt({
    trigger: "post_quiz_results",
    session: { max_consecutive_wrong: -99, category_accuracy_pct: "NaN" }
  });
  assert("invalid/negative input does not qualify", selected, null);
})();

(function () {
  var selected = selectPrompt({
    trigger: "post_quiz_results",
    session: { max_consecutive_wrong: 999999 }
  });
  assert("large wrong streak is safely clamped and qualifies", selected.promptId, "wrong_streak");
})();

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
