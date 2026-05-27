// =============================================================================
// referrals.ts — Pre-enrollment referral leaderboard + settlement
//
// Plan ref: §1F. Each user gets a stable referral_code (8-char base36). When
// another user pre-enrolls with ?ref=<code>, we record the attribution.
// Top-100 referrers at public open time (Jul 1 2026 00:00 ET) split a fixed
// cash prize pool:
//   #1       → $500
//   #2-3     → $250 each
//   #4-10    → $100 each
//   #11-100  → $25 each
//
// Plus: referrer earns 10 BC per attributed pre-enrollment (referral_pre_enroll
// earn code, lifetime cap 200 via brain_coins ledger).
// =============================================================================

namespace Referrals {

  const CODE_COLLECTION = "referral_codes";       // per-user, key="me", value={code, created_at}
  const ATTRIBUTION_COLLECTION = "referrals";     // per-referrer, key="<referred_user_id>_<slug>"
  export const LEADERBOARD_ID = "preenroll_referrals";

  function nowSec(): number { return Math.floor(Date.now() / 1000); }

  function generateCode(): string {
    // 8-char base36 lowercase, low collision risk for 25K target enrolees
    var s = "";
    for (var i = 0; i < 8; i++) s += Math.floor(Math.random() * 36).toString(36);
    return s;
  }

  // Ensure caller has a referral code; mint one if absent.
  export function ensureCodeForUser(nk: nkruntime.Nakama, userId: string): string {
    try {
      var rows = nk.storageRead([{ collection: CODE_COLLECTION, key: "me", userId: userId }]);
      if (rows && rows.length > 0) {
        var v = rows[0].value as any;
        if (v && v.code) return "" + v.code;
      }
    } catch (_) { }
    var code = generateCode();
    nk.storageWrite([{
      collection: CODE_COLLECTION,
      key: "me",
      userId: userId,
      value: { code: code, created_at: nowSec() },
      permissionRead: 1,
      permissionWrite: 0,
    }]);
    // Also write a reverse index for resolving code → owner on /r/[code] hits.
    nk.storageWrite([{
      collection: CODE_COLLECTION,
      key: "by_code_" + code,
      userId: Constants.SYSTEM_USER_ID,
      value: { code: code, owner_user_id: userId, created_at: nowSec() },
      permissionRead: 2,
      permissionWrite: 0,
    }]);
    return code;
  }

  export function resolveCodeToOwner(nk: nkruntime.Nakama, code: string): string | null {
    try {
      var rows = nk.storageRead([{ collection: CODE_COLLECTION, key: "by_code_" + code, userId: Constants.SYSTEM_USER_ID }]);
      if (rows && rows.length > 0) {
        var v = rows[0].value as any;
        if (v && v.owner_user_id) return "" + v.owner_user_id;
      }
    } catch (_) { }
    return null;
  }

  // Record attribution + bump leaderboard. Called from tournament_pre_enroll
  // when `referred_by` (referral code) is supplied by the client.
  export function recordReferral(nk: nkruntime.Nakama, referralCode: string, referredUserId: string, tournamentSlug: string): void {
    var ownerId = resolveCodeToOwner(nk, referralCode);
    if (!ownerId) return;
    if (ownerId === referredUserId) return;  // can't refer yourself
    var key = referredUserId + "_" + tournamentSlug;
    // Idempotency: skip if attribution already exists
    try {
      var existing = nk.storageRead([{ collection: ATTRIBUTION_COLLECTION, key: key, userId: ownerId }]);
      if (existing && existing.length > 0) return;
    } catch (_) { }
    nk.storageWrite([{
      collection: ATTRIBUTION_COLLECTION,
      key: key,
      userId: ownerId,
      value: {
        referred_user_id: referredUserId,
        tournament_slug: tournamentSlug,
        recorded_at: nowSec(),
      },
      permissionRead: 1,
      permissionWrite: 0,
    }]);

    // Bump leaderboard
    try {
      nk.leaderboardCreate(LEADERBOARD_ID, false, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.INCREMENTAL, null, { type: "preenroll_referrals" }, true);
      var username = "";
      try {
        var acc = nk.accountsGetId([ownerId]);
        if (acc && acc.length > 0) username = "" + (acc[0].user.username || "");
      } catch (_) { }
      nk.leaderboardRecordWrite(LEADERBOARD_ID, ownerId, username, 1);
    } catch (_) { }

    // BC reward (10 BC, lifetime cap 200) — handled via brain_coins_earn
    // referral_pre_enroll code. We invoke the same code path inline because
    // there's no internal RPC dispatch in Goja.
    creditReferralBc(nk, ownerId, referredUserId, tournamentSlug);
  }

  // Inline equivalent of brain_coins_earn(code=referral_pre_enroll). 10 BC
  // per event, lifetime cap 200 (per the earn rule we added in brain_coins.ts).
  function creditReferralBc(nk: nkruntime.Nakama, ownerId: string, referredUserId: string, slug: string): void {
    var idemKey = "referral_pre_enroll_" + referredUserId + "_" + slug;
    var probeKey = "earn_log_idem_" + idemKey;
    try {
      var existing = nk.storageRead([{ collection: "brain_coins", key: probeKey, userId: ownerId }]);
      if (existing && existing.length > 0) return;
    } catch (_) { }
    // Lifetime cap check: count earn_log rows with code=referral_pre_enroll
    var count = 0;
    try {
      var cursor = "";
      var safety = 0;
      while (safety < 10) {
        safety++;
        var page = nk.storageList(ownerId, "brain_coins", 100, cursor);
        if (!page || !page.objects) break;
        for (var i = 0; i < page.objects.length; i++) {
          var v = page.objects[i].value as any;
          if (v && v.code === "referral_pre_enroll") count++;
        }
        if (!page.cursor) break;
        cursor = page.cursor;
      }
    } catch (_) { }
    if (count >= 200) return;  // lifetime cap

    var coins = 10;
    var walletRows = nk.storageRead([{ collection: "brain_coins", key: "wallet", userId: ownerId }]);
    var wallet: any = (walletRows && walletRows.length > 0) ? walletRows[0].value : { balance: 0, lifetime_earned: 0, lifetime_redeemed: 0 };
    wallet.balance = (wallet.balance | 0) + coins;
    wallet.lifetime_earned = (wallet.lifetime_earned | 0) + coins;
    wallet.updated_at = nowSec();
    nk.storageWrite([
      { collection: "brain_coins", key: "wallet", userId: ownerId, value: wallet, permissionRead: 1, permissionWrite: 0 },
      {
        collection: "brain_coins",
        key: probeKey,
        userId: ownerId,
        value: {
          code: "referral_pre_enroll",
          coins: coins,
          unix_ts: nowSec(),
          date: new Date().toISOString().slice(0, 10),
          source: "referral_attribution",
          idempotency_key: idemKey,
          referred_user_id: referredUserId,
          tournament_slug: slug,
        },
        permissionRead: 1,
        permissionWrite: 0,
      },
    ]);
  }

  export function getMySummary(nk: nkruntime.Nakama, userId: string): any {
    var code = ensureCodeForUser(nk, userId);
    // Count attributed referrals
    var count = 0;
    var recent: any[] = [];
    try {
      var cursor = "";
      var safety = 0;
      while (safety < 5) {
        safety++;
        var page = nk.storageList(userId, ATTRIBUTION_COLLECTION, 100, cursor);
        if (!page || !page.objects) break;
        for (var i = 0; i < page.objects.length; i++) {
          count++;
          if (recent.length < 10) recent.push(page.objects[i].value);
        }
        if (!page.cursor) break;
        cursor = page.cursor;
      }
    } catch (_) { }

    // Get rank from leaderboard
    var rank = -1;
    try {
      var lb = nk.leaderboardRecordsList(LEADERBOARD_ID, [userId], 1, undefined);
      if (lb.records && lb.records.length > 0) rank = lb.records[0].rank as any;
    } catch (_) { }

    return {
      referral_code: code,
      referral_url: "https://quizverse.world/r/" + code,
      attributed_count: count,
      leaderboard_rank: rank,
      recent: recent,
    };
  }

  // Service-only: settle top-100 cash prizes after pre-enrollment window closes.
  // Cash prizes go via a separate ops process (Tremendous), so this RPC just
  // freezes the leaderboard + writes a winners table to the settlement
  // collection for ops to consume.
  export function settleTopN(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): any {
    var top: any[] = [];
    try {
      var lb = nk.leaderboardRecordsList(LEADERBOARD_ID, [], 100, undefined);
      if (lb.records) top = lb.records;
    } catch (_) { }

    var winners: any[] = [];
    for (var i = 0; i < top.length; i++) {
      var rank = i + 1;
      var prizeUsd = 0;
      if (rank === 1) prizeUsd = TournamentEconomy.REFERRAL_TOP_1_USD;
      else if (rank <= 3) prizeUsd = TournamentEconomy.REFERRAL_TOP_2_3_USD;
      else if (rank <= 10) prizeUsd = TournamentEconomy.REFERRAL_TOP_4_10_USD;
      else if (rank <= 100) prizeUsd = TournamentEconomy.REFERRAL_TOP_11_100_USD;
      winners.push({
        rank: rank,
        user_id: top[i].ownerId,
        username: top[i].username || "",
        referral_count: top[i].score,
        prize_usd: prizeUsd,
      });
    }

    // Persist freeze (ops reads this)
    nk.storageWrite([{
      collection: "referral_settlement",
      key: "frozen_" + nowSec(),
      userId: Constants.SYSTEM_USER_ID,
      value: { winners: winners, frozen_at: nowSec() },
      permissionRead: 0,
      permissionWrite: 0,
    }]);

    logger.info("[Referrals] settled top-" + winners.length + " referrers");
    return { winners: winners };
  }
}
