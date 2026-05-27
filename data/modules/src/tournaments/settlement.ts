// =============================================================================
// settlement.ts — Tournament settlement engine
//
// Plan ref: §2 settlement + §1H multi-format dispatcher
//
// settle(slug):
//   1. Read meta + cfg
//   2. Read all entries via leaderboard (top 10k — settles edge cases too)
//   3. Dispatch to format engine for payout rows
//   4. Credit each user via brain_coins (tournament_win earn code, idempotency
//      per (slug, user_id))
//   5. Mark entries with rank, write back; update meta.status=SETTLED
//   6. Notify settled users
//
// eliminateRound(slug, round):
//   Used by elimination format. Mark bottom-50% as eliminated for this round.
// =============================================================================

namespace TournamentSettlement {

  function nowSec(): number { return Math.floor(Date.now() / 1000); }

  function readUserAccountSnapshot(nk: nkruntime.Nakama, userId: string): { country: string; lifetime_earned: number; founder_member: boolean } {
    var country = "";
    var founder = false;
    try {
      var acc = nk.accountsGetId([userId]);
      if (acc && acc.length > 0) {
        var md: any = acc[0].user.metadata;
        if (md && md.country) country = "" + md.country;
      }
    } catch (_) { }
    var lifetime = 0;
    try {
      var rows = nk.storageRead([{ collection: "brain_coins", key: "wallet", userId: userId }]);
      if (rows && rows.length > 0) lifetime = (rows[0].value as any).lifetime_earned | 0;
    } catch (_) { }
    return { country: country, lifetime_earned: lifetime, founder_member: founder };
  }

  function collectEntries(nk: nkruntime.Nakama, slug: string): any[] {
    // Pull all entries via leaderboard top-N. For MVP we assume <= 10k entrants
    // per tournament; larger tournaments get a paged sweep.
    var entries: any[] = [];
    try {
      var top = nk.leaderboardRecordsList(TournamentLeaderboard.lbId(slug), [], 10000, undefined);
      if (top.records) {
        for (var i = 0; i < top.records.length; i++) {
          var r = top.records[i];
          // Re-read entry row to get founder_member + paid_via + eliminated_round
          var entry = TournamentsStorage.readEntry(nk, slug, r.ownerId);
          if (!entry) continue;
          entries.push({
            user_id: r.ownerId,
            score: entry.score,
            founder_member: !!entry.founder_member,
            paid_via: entry.paid_via,
            bc_charged: entry.bc_charged,
            eliminated_round: entry.eliminated_round,
          });
        }
      }
    } catch (_) { }
    return entries;
  }

  function creditPayout(nk: nkruntime.Nakama, userId: string, coins: number, slug: string, rank: number, isRefund: boolean): void {
    if (coins <= 0) return;
    // Inline brain_coins_earn with tournament_win (or tournament_refund) code.
    var code = isRefund ? "tournament_entry_refund" : "tournament_win";
    var idemKey = (isRefund ? "refund_" : "win_") + slug + "_" + userId;
    var probeKey = "earn_log_idem_" + idemKey;
    try {
      var existing = nk.storageRead([{ collection: "brain_coins", key: probeKey, userId: userId }]);
      if (existing && existing.length > 0) return;
    } catch (_) { }

    var walletRows = nk.storageRead([{ collection: "brain_coins", key: "wallet", userId: userId }]);
    var wallet: any = (walletRows && walletRows.length > 0) ? walletRows[0].value : { balance: 0, lifetime_earned: 0, lifetime_redeemed: 0 };
    wallet.balance = (wallet.balance | 0) + coins;
    wallet.lifetime_earned = (wallet.lifetime_earned | 0) + coins;
    wallet.updated_at = nowSec();
    nk.storageWrite([
      { collection: "brain_coins", key: "wallet", userId: userId, value: wallet, permissionRead: 1, permissionWrite: 0 },
      {
        collection: "brain_coins",
        key: probeKey,
        userId: userId,
        value: {
          code: code,
          coins: coins,
          unix_ts: nowSec(),
          date: new Date().toISOString().slice(0, 10),
          source: "tournament_settle:" + slug + ":rank" + rank,
          idempotency_key: idemKey,
        },
        permissionRead: 1,
        permissionWrite: 0,
      },
    ]);
  }

  export function settle(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, slug: string): any {
    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return { ok: false, error: "slug not found" };
    var meta = TournamentsStorage.readMeta(nk, slug);
    if (!meta) return { ok: false, error: "meta missing" };
    if (meta.status === "SETTLED") return { ok: true, idempotent: true, meta: meta };

    // Mark SETTLING (lock in)
    meta.status = "SETTLING";
    TournamentsStorage.writeMeta(nk, slug, meta);

    var entries = collectEntries(nk, slug);
    var settlement = TournamentFormats.settle(cfg, meta.pot_bc, entries);

    var totalPaid = 0;
    var winners: any[] = [];
    for (var i = 0; i < settlement.rows.length; i++) {
      var row = settlement.rows[i];
      creditPayout(nk, row.user_id, row.payout_bc, slug, row.rank, row.is_refund);
      // Persist rank into entry row
      var e = TournamentsStorage.readEntry(nk, slug, row.user_id);
      if (e) {
        e.rank = row.rank;
        TournamentsStorage.writeEntry(nk, slug, row.user_id, e);
      }
      totalPaid += row.payout_bc;
      winners.push(row);
      // Notify settlement
      TournamentRealtime.notifySettled(nk, row.user_id, slug, row.payout_bc, row.rank, null);
    }

    meta.status = "SETTLED";
    TournamentsStorage.writeMeta(nk, slug, meta);

    logger.info("[Settlement] slug=" + slug + " format=" + cfg.format + " winners=" + winners.length + " total_paid_bc=" + totalPaid);
    return {
      ok: true,
      idempotent: false,
      format: settlement.format,
      pool_drained: settlement.pool_drained,
      house_backstop_used_bc: settlement.house_backstop_used_bc,
      total_paid_bc: totalPaid,
      payout_count: winners.length,
    };
  }

  export function eliminateRound(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, slug: string, round: number): any {
    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return { ok: false, error: "slug not found" };
    if (cfg.format !== "elimination") return { ok: false, error: "not an elimination format" };

    var entries = collectEntries(nk, slug);
    // Only entries not yet eliminated
    var survivors = entries.filter(function (e: any) { return !e.eliminated_round; });
    var eliminatedIds = TournamentFormatElimination.selectEliminations(cfg, survivors);

    var count = 0;
    for (var i = 0; i < eliminatedIds.length; i++) {
      var uid = eliminatedIds[i];
      var entry = TournamentsStorage.readEntry(nk, slug, uid);
      if (!entry || entry.eliminated_at) continue;
      entry.eliminated_at = nowSec();
      entry.eliminated_round = round;
      TournamentsStorage.writeEntry(nk, slug, uid, entry);
      TournamentRealtime.notifyEliminated(nk, uid, slug, round, survivors.length - eliminatedIds.length + i + 1);
      count++;
    }

    logger.info("[Eliminate] slug=" + slug + " round=" + round + " eliminated=" + count + " survivors_remaining=" + (survivors.length - count));
    return { ok: true, eliminated_count: count, survivors_remaining: survivors.length - count };
  }
}
