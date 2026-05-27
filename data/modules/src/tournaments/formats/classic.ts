// =============================================================================
// formats/classic.ts — Classic top-N pot-split tournament format
//
// Plan ref: §1H (multi-format engine), §2 (settlement). Classic format is
// the default: users submit pack results, accumulate score, top-N by score
// split the post-rake pot per CLASSIC_POT_SPLIT_TOP_N.
//
// Settlement algorithm:
//   1. Read all entries for tournament (via leaderboard records)
//   2. Sort by score DESC (ties: earliest submitted_at wins)
//   3. Apply rake: payable = pot × (1 - rake_pct)
//   4. Distribute per CLASSIC_POT_SPLIT_TOP_N
//   5. Founder Member bonus: 2× their first-win payout
//   6. No-Lose: top 50% of finishers get entry refunded (if amoe.no_lose_refund_finish_pct)
// =============================================================================

namespace TournamentFormatClassic {

  export interface ClassicPayoutRow {
    user_id: string;
    rank: number;
    payout_bc: number;
    is_refund: boolean;
    founder_bonus_applied: boolean;
  }

  export function computePayouts(
    cfg: TournamentEconomy.TournamentConfig,
    potBc: number,
    rankedEntries: { user_id: string; score: number; founder_member: boolean; paid_via: string; bc_charged: number }[]
  ): ClassicPayoutRow[] {
    var out: ClassicPayoutRow[] = [];
    if (rankedEntries.length === 0) return out;

    var rake = potBc * cfg.rake_pct;
    var payable = potBc - rake;

    var split = cfg.pot_split_top_n || TournamentEconomy.CLASSIC_POT_SPLIT_TOP_N;

    // Top-N pot split
    for (var i = 0; i < split.length && i < rankedEntries.length; i++) {
      var e = rankedEntries[i];
      var share = split[i].share;
      var payout = Math.floor(payable * share);
      var founderBonus = false;
      if (e.founder_member) {
        payout = payout * TournamentEconomy.FOUNDER_FIRST_WIN_MULTIPLIER;
        founderBonus = true;
      }
      out.push({
        user_id: e.user_id,
        rank: i + 1,
        payout_bc: Math.floor(payout),
        is_refund: false,
        founder_bonus_applied: founderBonus,
      });
    }

    // No-Lose Guarantee: top X% of finishers get their entry refunded.
    var refundCutoff = cfg.amoe.no_lose_refund_finish_pct || 0;
    if (refundCutoff > 0) {
      var cutoffRank = Math.floor(rankedEntries.length * refundCutoff);
      for (var j = split.length; j < cutoffRank && j < rankedEntries.length; j++) {
        var e2 = rankedEntries[j];
        // Don't refund AMOE/free entries (they didn't pay).
        if (e2.paid_via !== "balance") continue;
        out.push({
          user_id: e2.user_id,
          rank: j + 1,
          payout_bc: e2.bc_charged,
          is_refund: true,
          founder_bonus_applied: false,
        });
      }
    }

    return out;
  }
}
