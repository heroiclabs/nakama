// =============================================================================
// account_merge.ts — Ghost Nakama user → Cognito user merge
//
// Plan ref: §1I gap 2. Closes the long-standing TODO at
// identity_resolver.ts:397-401 ("when the human later signs up via Cognito,
// the cognito_wallet_mapper bootstrap should merge the ghost record into the
// real cognito_sub").
//
// When called:
//   - Web visitor pre-enrolls anonymously → mints ghost Nakama user (userId=G)
//   - Later, same human signs up with Google → Cognito mints sub=C, Nakama
//     bootstraps a separate user with customId=C
//   - This RPC transfers Brain Coins, tournament entries, Founder badges,
//     and referral attribution from G → C, then archives G.
//
// Auth: service-only (only triggered by the post-signup callback). Caller
// must supply both ghost_user_id and cognito_user_id; we look up the ghost's
// state, port it over to cognito, and write an audit row.
//
// Idempotency: storage key `merge_idem_{ghost}_{cognito}` ensures duplicate
// calls (network retry on signup callback) return the cached result.
// =============================================================================

namespace AccountMerge {

  const MERGE_LOG_COLLECTION = "account_merge_log";

  function isServiceCaller(ctx: nkruntime.Context, payload: any): boolean {
    var token = payload && payload.service_token;
    if (!token) return false;
    // Accept any of the platform service tokens. TOURNAMENT_SERVICE_TOKEN is the
    // one actually provisioned in runtime.env today (the web cognito-callback /
    // login flow sends it), so the ghost→cognito merge can authenticate without
    // a dedicated ACCOUNT_MERGE_SERVICE_TOKEN being added to Nakama config.
    var e = ctx.env || ({} as { [k: string]: string });
    var candidates = [
      "" + (e["ACCOUNT_MERGE_SERVICE_TOKEN"] || ""),
      "" + (e["BRAIN_COINS_SERVICE_TOKEN"] || ""),
      "" + (e["TOURNAMENT_SERVICE_TOKEN"] || ""),
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].length > 0 && token === candidates[i]) return true;
    }
    return false;
  }

  function nowSec(): number { return Math.floor(Date.now() / 1000); }

  // Read brain_coins wallet for a user
  function readBcWallet(nk: nkruntime.Nakama, userId: string): { balance: number; lifetime_earned: number; lifetime_redeemed: number } {
    try {
      var rows = nk.storageRead([{ collection: "brain_coins", key: "wallet", userId: userId }]);
      if (rows && rows.length > 0) {
        var v = rows[0].value as any;
        return {
          balance: v.balance | 0,
          lifetime_earned: v.lifetime_earned | 0,
          lifetime_redeemed: v.lifetime_redeemed | 0,
        };
      }
    } catch (_) { }
    return { balance: 0, lifetime_earned: 0, lifetime_redeemed: 0 };
  }

  // Write brain_coins wallet (sum-merge — never overwrite cognito's existing balance)
  function mergeBcWallet(nk: nkruntime.Nakama, fromUserId: string, toUserId: string): number {
    var src = readBcWallet(nk, fromUserId);
    if (src.balance === 0 && src.lifetime_earned === 0) return 0;
    var dst = readBcWallet(nk, toUserId);
    var merged = {
      balance: dst.balance + src.balance,
      lifetime_earned: dst.lifetime_earned + src.lifetime_earned,
      lifetime_redeemed: dst.lifetime_redeemed + src.lifetime_redeemed,
      updated_at: nowSec(),
    };
    nk.storageWrite([{
      collection: "brain_coins",
      key: "wallet",
      userId: toUserId,
      value: merged,
      permissionRead: 1,
      permissionWrite: 0,
    }]);
    // Zero out the ghost wallet so a second merge doesn't double-credit.
    nk.storageWrite([{
      collection: "brain_coins",
      key: "wallet",
      userId: fromUserId,
      value: { balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, updated_at: nowSec(), merged_to: toUserId },
      permissionRead: 1,
      permissionWrite: 0,
    }]);
    return src.balance;
  }

  // Port all storage objects in a collection from one user to another.
  // We do NOT delete the source rows (privacy/audit retention) — we add a
  // "merged_to" sentinel; readers prefer the destination user's rows.
  function portCollection(nk: nkruntime.Nakama, collection: string, fromUserId: string, toUserId: string): number {
    var ported = 0;
    var cursor = "";
    var safety = 0;
    while (safety < 20) {
      safety++;
      var page = nk.storageList(fromUserId, collection, 100, cursor);
      if (!page || !page.objects) break;
      for (var i = 0; i < page.objects.length; i++) {
        var o = page.objects[i];
        try {
          // Write to destination (won't overwrite if dest already has it; we
          // use storageRead first to skip duplicates on retry).
          var existing = nk.storageRead([{ collection: collection, key: o.key, userId: toUserId }]);
          if (existing && existing.length > 0) continue;
          nk.storageWrite([{
            collection: collection,
            key: o.key,
            userId: toUserId,
            value: o.value,
            permissionRead: 1,
            permissionWrite: 0,
          }]);
          ported++;
        } catch (_) {
          // best-effort port — continue
        }
      }
      if (!page.cursor) break;
      cursor = page.cursor;
    }
    return ported;
  }

  // ── RPC: account_merge_ghost_to_cognito ────────────────────────────────────
  function rpcMerge(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!isServiceCaller(ctx, data)) {
        return RpcHelpers.errorResponse("not authorised — account_merge is service-only", 401);
      }
      var ghostUserId = "" + (data.ghost_user_id || "");
      var cognitoUserId = "" + (data.cognito_user_id || "");
      if (!ghostUserId || !cognitoUserId) {
        return RpcHelpers.errorResponse("ghost_user_id + cognito_user_id required", 400);
      }
      if (ghostUserId === cognitoUserId) {
        return RpcHelpers.errorResponse("ghost and cognito user_id are identical — nothing to merge", 400);
      }

      // Idempotency: if we've already merged this pair, return cached result.
      var idemKey = "merge_idem_" + ghostUserId + "_" + cognitoUserId;
      try {
        var prior = nk.storageRead([{ collection: MERGE_LOG_COLLECTION, key: idemKey, userId: Constants.SYSTEM_USER_ID }]);
        if (prior && prior.length > 0) {
          return RpcHelpers.successResponse({
            ok: true,
            idempotent: true,
            prior_merge: prior[0].value,
          });
        }
      } catch (_) { }

      // Port collections — Brain Coins (sum-merged), tournament entries, pre-enroll
      // records, referrals, and certificates.
      var bcCredited = mergeBcWallet(nk, ghostUserId, cognitoUserId);
      var entries = portCollection(nk, "tournament_entries", ghostUserId, cognitoUserId);
      var preEnroll = portCollection(nk, "tournament_pre_enroll", ghostUserId, cognitoUserId);
      var referrals = portCollection(nk, "referrals", ghostUserId, cognitoUserId);
      var certs = portCollection(nk, "tournament_certs", ghostUserId, cognitoUserId);
      var bcLogs = portCollection(nk, "brain_coins", ghostUserId, cognitoUserId);  // earn_log_* rows

      // Audit log row
      var summary = {
        ghost_user_id: ghostUserId,
        cognito_user_id: cognitoUserId,
        merged_at: nowSec(),
        transferred: {
          bc: bcCredited,
          tournament_entries: entries,
          pre_enrollments: preEnroll,
          referrals: referrals,
          certificates: certs,
          bc_log_rows: bcLogs,
        },
      };
      nk.storageWrite([{
        collection: MERGE_LOG_COLLECTION,
        key: idemKey,
        userId: Constants.SYSTEM_USER_ID,
        value: summary,
        permissionRead: 0,
        permissionWrite: 0,
      }]);

      // Mark ghost user's account metadata as merged (so subsequent ghost
      // operations refuse to continue).
      try {
        nk.accountUpdateId(ghostUserId, undefined, undefined, undefined, undefined, undefined, undefined,
          { is_ghost: true, merged_to: cognitoUserId, merged_at: nowSec() });
      } catch (e) {
        logger.warn("[AccountMerge] could not update ghost metadata: " + (e as any).message);
      }

      logger.info("[AccountMerge] merged ghost " + ghostUserId + " → cognito " + cognitoUserId + " (bc=" + bcCredited + ", entries=" + entries + ")");
      return RpcHelpers.successResponse({ ok: true, idempotent: false, transferred: summary.transferred });

    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[AccountMerge] failed: " + msg);
      RpcHelpers.logRpcError(nk, logger, "account_merge_ghost_to_cognito", msg);
      return RpcHelpers.errorResponse("account_merge failed: " + msg, 500);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("account_merge_ghost_to_cognito", rpcMerge);
  }
}
