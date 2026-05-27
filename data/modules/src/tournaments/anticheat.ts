// =============================================================================
// anticheat.ts — Server-side cheat detection for tournament submits
//
// Plan ref: §1H per-format detectors + §3 anti-cheat baseline. Three classes:
//   1. Latency floor — answers faster than ANTICHEAT_LATENCY_FLOOR_MS (300ms)
//      are statistically impossible for humans → soft-DQ
//   2. Daily submit ceiling — > 200/day signals automation
//   3. Honeypot — server-side known-bad questions injected silently; if user
//      answers them correctly at > random rate, mark
//
// Soft-DQ flow: row marked status="soft_dq", score zeroed for leaderboard
// purposes, user shown a generic "review in progress" toast. No payout on
// settle. Hard appeals go through ops.
// =============================================================================

namespace TournamentAntiCheat {

  function nowSec(): number { return Math.floor(Date.now() / 1000); }
  function startOfTodayUnix(): number {
    var d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }

  export interface SubmitCheckInput {
    user_id: string;
    answers_count: number;
    duration_ms: number;
    latency_ms: number;
    correct: number;
    total: number;
    honeypot_correct?: number;
    honeypot_total?: number;
  }

  export interface CheckResult {
    pass: boolean;
    reasons: string[];
  }

  export function check(nk: nkruntime.Nakama, input: SubmitCheckInput): CheckResult {
    var reasons: string[] = [];

    // 1. Latency floor
    if (input.answers_count > 0 && input.duration_ms > 0) {
      var avgPerAnswerMs = input.duration_ms / input.answers_count;
      if (avgPerAnswerMs < TournamentEconomy.ANTICHEAT_LATENCY_FLOOR_MS) {
        reasons.push("latency_floor_violated:" + Math.floor(avgPerAnswerMs) + "ms_per_answer");
      }
    }

    // 2. Daily submit ceiling
    var todayUnix = startOfTodayUnix();
    var dailyCount = countTodaysSubmits(nk, input.user_id, todayUnix);
    if (dailyCount >= TournamentEconomy.ANTICHEAT_DAILY_SUBMIT_CEILING) {
      reasons.push("daily_submit_ceiling:" + dailyCount);
    }

    // 3. Honeypot — if honeypot questions were included, a too-good correctness
    //    rate is suspicious. Random expected = 0.25 (4-choice MCQ). > 0.6
    //    on a sample of 3+ is statistically suspicious.
    if (input.honeypot_total && input.honeypot_total >= 3) {
      var rate = (input.honeypot_correct || 0) / input.honeypot_total;
      if (rate > 0.6) {
        reasons.push("honeypot_rate:" + rate.toFixed(2));
      }
    }

    // 4. Impossible accuracy (legitimate high scores are fine, but 100% with
    //    sub-floor latency is essentially proof of automation).
    if (input.total > 0) {
      var accuracy = input.correct / input.total;
      if (accuracy === 1.0 && input.duration_ms > 0 && input.answers_count > 0) {
        var perAns = input.duration_ms / input.answers_count;
        if (perAns < 500) {
          reasons.push("impossible_accuracy_at_speed:" + accuracy + "_" + Math.floor(perAns));
        }
      }
    }

    return { pass: reasons.length === 0, reasons: reasons };
  }

  function countTodaysSubmits(nk: nkruntime.Nakama, userId: string, sinceUnix: number): number {
    var count = 0;
    try {
      var cursor = "";
      var safety = 0;
      while (safety < 5) {
        safety++;
        var page = nk.storageList(userId, "tournament_submits", 100, cursor);
        if (!page || !page.objects) break;
        for (var i = 0; i < page.objects.length; i++) {
          var v = page.objects[i].value as any;
          if (!v) continue;
          if (v.submitted_at && v.submitted_at >= sinceUnix) count++;
        }
        if (!page.cursor) break;
        cursor = page.cursor;
      }
    } catch (_) { }
    return count;
  }
}
