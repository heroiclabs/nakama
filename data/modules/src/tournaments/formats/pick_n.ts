// =============================================================================
// formats/pick_n.ts — PrizePicks-style multiplier-payout format
//
// Plan ref: §1H N2. Users pick N questions before the lock window closes;
// after window, payout = entry_fee × multiplier[grade] where grade is the
// fraction correct (e.g. 5/5 = 10×, 4/5 = 5×, 3/5 = 2×, below = 0×).
//
// Pot does NOT auto-split here — payouts come directly from the entry_fee
// pool. House provides a backstop if the pool runs dry (capped daily).
// Rake is collected at entry time (15% of entry_fee → house, 85% → pool).
// =============================================================================

namespace TournamentFormatPickN {

  export interface PickNPayoutRow {
    user_id: string;
    rank: number;             // ranked by grade then by speed
    payout_bc: number;
    is_refund: boolean;
    grade: string;            // "5/5", "4/5", etc.
    multiplier_applied: number;
  }

  export interface PickResult {
    user_id: string;
    correct: number;
    total: number;
    bc_charged: number;
    founder_member: boolean;
    submitted_at: number;
    paid_via: string;
  }

  function gradeKey(correct: number, total: number): string {
    return correct + "/" + total;
  }

  function lookupMultiplier(cfg: TournamentEconomy.TournamentConfig, correct: number, total: number): number {
    if (!cfg.pick_n_config) return 0;
    var key = gradeKey(correct, total);
    var m = cfg.pick_n_config.multipliers[key];
    if (typeof m === "number") return m;
    // Below threshold: catch-all
    var threshold = cfg.pick_n_config.multipliers["<" + Math.ceil(total / 2) + "/" + total];
    if (typeof threshold === "number") return threshold;
    return 0;
  }

  export function computePayouts(
    cfg: TournamentEconomy.TournamentConfig,
    potBc: number,                  // total pool (post-rake)
    results: PickResult[]
  ): { payouts: PickNPayoutRow[]; pool_drained: boolean; house_backstop_used_bc: number } {
    var payouts: PickNPayoutRow[] = [];
    if (!cfg.pick_n_config || results.length === 0) {
      return { payouts: payouts, pool_drained: false, house_backstop_used_bc: 0 };
    }
    var pool = potBc;
    var houseBackstop = TournamentEconomy.BC_PER_USD_USA * cfg.pick_n_config.house_backstop_usd_per_day;

    // Rank: by correct DESC, then by submitted_at ASC (earlier wins ties)
    var ranked = results.slice().sort(function (a, b) {
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.submitted_at - b.submitted_at;
    });

    var poolDrained = false;
    var backstopUsed = 0;

    for (var i = 0; i < ranked.length; i++) {
      var r = ranked[i];
      var mult = lookupMultiplier(cfg, r.correct, r.total);
      var payout = Math.floor(r.bc_charged * mult);
      // Founder bonus on top of multiplier
      if (r.founder_member && payout > 0) {
        payout = Math.floor(payout * TournamentEconomy.FOUNDER_FIRST_WIN_MULTIPLIER);
      }

      // Deduct from pool; if pool is dry, use house backstop until exhausted.
      if (payout > pool) {
        var fromPool = pool;
        var fromHouse = Math.min(houseBackstop - backstopUsed, payout - fromPool);
        backstopUsed += fromHouse;
        pool = 0;
        payout = fromPool + fromHouse;
        poolDrained = true;
      } else {
        pool -= payout;
      }

      payouts.push({
        user_id: r.user_id,
        rank: i + 1,
        payout_bc: payout,
        is_refund: false,
        grade: gradeKey(r.correct, r.total),
        multiplier_applied: mult,
      });
    }

    // No-Lose: refund users who hit at least the threshold but still got 0 payout
    // (e.g. multiplier table doesn't credit "3/5" but threshold says 3/5 should refund).
    var thresholdStr = cfg.amoe.no_lose_pick_threshold || "";
    if (thresholdStr) {
      var parts = thresholdStr.split("/");
      var minCorrect = parseInt(parts[0], 10);
      if (!isNaN(minCorrect)) {
        for (var k = 0; k < ranked.length; k++) {
          var r2 = ranked[k];
          if (r2.paid_via !== "balance") continue;
          // Find their payout row; if 0, refund.
          var paid = payouts[k] && payouts[k].payout_bc > 0;
          if (!paid && r2.correct >= minCorrect) {
            payouts.push({
              user_id: r2.user_id,
              rank: 0,
              payout_bc: r2.bc_charged,
              is_refund: true,
              grade: gradeKey(r2.correct, r2.total),
              multiplier_applied: 0,
            });
          }
        }
      }
    }

    return { payouts: payouts, pool_drained: poolDrained, house_backstop_used_bc: backstopUsed };
  }
}
