// =============================================================================
// formats/index.ts — Format dispatcher
//
// Single entry point that picks the right format implementation based on
// cfg.format. Consumed by tournament_settle, the eliminate-round cron, and
// the leaderboard rendering layer.
// =============================================================================

namespace TournamentFormats {

  // Discriminated union of all payout row shapes (classic | elim | pick-n).
  // Settlement code maps these into a uniform `payout_bc + rank + is_refund`
  // payload for the brain_coins_earn call.
  export interface UnifiedPayoutRow {
    user_id: string;
    rank: number;
    payout_bc: number;
    is_refund: boolean;
    metadata?: any;
  }

  export interface SettlementResult {
    format: TournamentEconomy.TournamentFormat;
    rows: UnifiedPayoutRow[];
    pool_drained?: boolean;
    house_backstop_used_bc?: number;
  }

  export function settle(
    cfg: TournamentEconomy.TournamentConfig,
    potBc: number,
    entries: any[]
  ): SettlementResult {
    if (cfg.format === "classic") {
      var rows = TournamentFormatClassic.computePayouts(cfg, potBc, entries);
      return {
        format: "classic",
        rows: rows.map(function (r) {
          return {
            user_id: r.user_id,
            rank: r.rank,
            payout_bc: r.payout_bc,
            is_refund: r.is_refund,
            metadata: { founder_bonus_applied: r.founder_bonus_applied },
          };
        }),
      };
    }
    if (cfg.format === "elimination") {
      var elimRows = TournamentFormatElimination.computeFinalPayouts(cfg, potBc, entries);
      return {
        format: "elimination",
        rows: elimRows.map(function (r) {
          return {
            user_id: r.user_id,
            rank: r.rank,
            payout_bc: r.payout_bc,
            is_refund: r.is_refund,
            metadata: { is_final_winner: r.is_final_winner, eliminated_round: r.eliminated_round },
          };
        }),
      };
    }
    if (cfg.format === "pick_n") {
      var pn = TournamentFormatPickN.computePayouts(cfg, potBc, entries);
      return {
        format: "pick_n",
        rows: pn.payouts.map(function (r) {
          return {
            user_id: r.user_id,
            rank: r.rank,
            payout_bc: r.payout_bc,
            is_refund: r.is_refund,
            metadata: { grade: r.grade, multiplier_applied: r.multiplier_applied },
          };
        }),
        pool_drained: pn.pool_drained,
        house_backstop_used_bc: pn.house_backstop_used_bc,
      };
    }
    return { format: cfg.format, rows: [] };
  }
}
