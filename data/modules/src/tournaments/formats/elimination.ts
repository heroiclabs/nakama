// =============================================================================
// formats/elimination.ts — Survivor-style elimination sprint format
//
// Plan ref: §1H N1. MrBeast-style: bottom 50% eliminated daily; final
// survivors split the pot equally; #1 of survivors gets a bragging-rights
// bonus from house.
//
// Eliminate cron runs on cfg.elimination_schedule.cut_times_utc; this
// module owns the cut algorithm (read leaderboard, bottom-N marked
// eliminated, notify, recompute).
//
// Settlement: only survivors (entry.eliminated_at is null) split the pot
// equally; final-survivor bonus is house-funded on top.
// =============================================================================

namespace TournamentFormatElimination {

  export interface ElimPayoutRow {
    user_id: string;
    rank: number;            // 1 for final winner; all survivors get the equal-split rank
    payout_bc: number;
    is_refund: boolean;
    is_final_winner: boolean;
    eliminated_round?: number;
  }

  // Determine which entries to eliminate in this round. Bottom `cut_pct`
  // of *currently surviving* entries (sorted by score ASC) are cut.
  export function selectEliminations(
    cfg: TournamentEconomy.TournamentConfig,
    currentSurvivors: { user_id: string; score: number; founder_member: boolean }[]
  ): string[] {
    if (!cfg.elimination_schedule) return [];
    var cutPct = cfg.elimination_schedule.cut_pct;
    // Sort ascending by score so we pick the lowest-N to eliminate.
    var sorted = currentSurvivors.slice().sort(function (a, b) { return a.score - b.score; });
    var cutCount = Math.floor(sorted.length * cutPct);
    if (cutCount < 1 && sorted.length > 1) cutCount = 1;  // always cut at least one if >1 survivor
    var out: string[] = [];
    for (var i = 0; i < cutCount; i++) out.push(sorted[i].user_id);
    return out;
  }

  // Final settlement: only survivors share the (post-rake) pot.
  // - Equal split across all survivors
  // - #1 survivor (highest score) gets an additional `final_survivor_bonus_bc`
  //   from the house (not from the pot)
  // - Refund for users who survived past `no_lose_survive_round`
  export function computeFinalPayouts(
    cfg: TournamentEconomy.TournamentConfig,
    potBc: number,
    allEntries: { user_id: string; score: number; founder_member: boolean; paid_via: string; bc_charged: number; eliminated_round?: number }[]
  ): ElimPayoutRow[] {
    var out: ElimPayoutRow[] = [];
    if (!cfg.elimination_schedule || allEntries.length === 0) return out;

    var survivors = allEntries.filter(function (e) { return !e.eliminated_round; });
    var rake = potBc * cfg.rake_pct;
    var payable = potBc - rake;

    if (survivors.length === 0) {
      // Pathological: everyone eliminated. House keeps rake; rest refunded
      // proportionally to paid entries.
      var paidEntries = allEntries.filter(function (e) { return e.paid_via === "balance"; });
      var totalPaid = 0;
      for (var p = 0; p < paidEntries.length; p++) totalPaid += paidEntries[p].bc_charged;
      if (totalPaid > 0) {
        for (var q = 0; q < paidEntries.length; q++) {
          var refund = Math.floor((paidEntries[q].bc_charged / totalPaid) * payable);
          out.push({
            user_id: paidEntries[q].user_id,
            rank: 0,
            payout_bc: refund,
            is_refund: true,
            is_final_winner: false,
          });
        }
      }
      return out;
    }

    // Survivors sorted by score DESC; #1 gets final_survivor_bonus.
    var rankedSurvivors = survivors.slice().sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return 0;
    });

    // Equal split logic
    var equalShare = Math.floor(payable / survivors.length);

    for (var i = 0; i < rankedSurvivors.length; i++) {
      var e = rankedSurvivors[i];
      var payout = equalShare;
      var isFinalWinner = false;
      if (i === 0) {
        // House-funded bonus to #1 survivor (does NOT come from pot)
        payout += cfg.elimination_schedule.final_survivor_bonus_bc;
        isFinalWinner = true;
      }
      // Founder bonus 2× on final winner's payout
      if (isFinalWinner && e.founder_member) {
        payout = payout * TournamentEconomy.FOUNDER_FIRST_WIN_MULTIPLIER;
      }
      out.push({
        user_id: e.user_id,
        rank: i + 1,
        payout_bc: Math.floor(payout),
        is_refund: false,
        is_final_winner: isFinalWinner,
      });
    }

    // No-Lose: refund for users who were eliminated AFTER no_lose_survive_round
    var surviveRound = cfg.amoe.no_lose_survive_round || 0;
    if (surviveRound > 0) {
      for (var r = 0; r < allEntries.length; r++) {
        var e2 = allEntries[r];
        if (!e2.eliminated_round) continue;          // already in survivor payout
        if (e2.eliminated_round < surviveRound) continue;  // didn't survive enough rounds
        if (e2.paid_via !== "balance") continue;     // AMOE doesn't refund
        out.push({
          user_id: e2.user_id,
          rank: 0,
          payout_bc: e2.bc_charged,
          is_refund: true,
          is_final_winner: false,
          eliminated_round: e2.eliminated_round,
        });
      }
    }

    return out;
  }
}
