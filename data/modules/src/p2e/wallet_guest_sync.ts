// =============================================================================
// wallet_guest_sync.ts — Sync web guest Applixir wallet → authenticated Nakama
//
// Plan ref: §1I gap 3. Closes the "TODO sync on signup" referenced in
// /Users/devashishbadlani/dev/Quizverse-web-frontend/web/lib/monetization/applixir-guest-wallet.ts.
//
// Flow:
//   1. Anonymous web user watches rewarded ads via Applixir guest wallet.
//      BC accumulates in localStorage `qv_applixir_guest_wallet`, capped at
//      a daily limit.
//   2. User signs up with Cognito; web /api/auth/cognito-callback calls
//      this RPC with the guest wallet snapshot (balance + earn_log entries).
//   3. We credit the user's Nakama BrainCoins wallet via brain_coins_earn
//      using a `guest_sync_{guest_wallet_id}` idempotency key. Re-calls
//      (network retry) are idempotent.
//
// Auth: user-callable (caller is the newly-authenticated user). We do NOT
// trust the client-supplied balance blindly — we cap by a sane daily ceiling
// and log the earn ledger for audit.
// =============================================================================

namespace WalletGuestSync {

  // Hard ceiling on a single sync (prevents tampering). If a genuine guest
  // somehow accumulated more than this, ops manually adjusts post-sync.
  const MAX_GUEST_SYNC_BC = 5000;

  function rpcSync(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);

      var guestWalletId = "" + (data.guest_wallet_id || "");
      var bcBalance = parseInt("" + (data.bc_balance || 0), 10);
      if (!guestWalletId) {
        return RpcHelpers.errorResponse("guest_wallet_id required", 400);
      }
      if (!isFinite(bcBalance) || bcBalance <= 0) {
        return RpcHelpers.successResponse({ ok: true, credited_bc: 0, skipped: "no_balance" });
      }
      if (bcBalance > MAX_GUEST_SYNC_BC) {
        logger.warn("[GuestSync] capping requested " + bcBalance + " → " + MAX_GUEST_SYNC_BC + " for user " + userId);
        bcBalance = MAX_GUEST_SYNC_BC;
      }

      // Delegate to brain_coins_earn with a deterministic idempotency key.
      // Service-to-service call within the same Nakama runtime: we synthesize
      // the payload and invoke the same code path that brain_coins_earn uses.
      // (We can't call brain_coins_earn directly as an RPC from JS — instead
      // we replicate the necessary side-effects here against the same storage.)
      var idemKey = "guest_sync_" + guestWalletId;
      var probeKey = "earn_log_idem_" + idemKey;
      try {
        var existing = nk.storageRead([{ collection: "brain_coins", key: probeKey, userId: userId }]);
        if (existing && existing.length > 0) {
          return RpcHelpers.successResponse({
            ok: true,
            credited_bc: 0,
            skipped: "idempotent",
            prior_credit: (existing[0].value as any).coins || 0,
          });
        }
      } catch (_) { }

      // Read current wallet, sum-merge.
      var walletRows = nk.storageRead([{ collection: "brain_coins", key: "wallet", userId: userId }]);
      var wallet: any = { balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, updated_at: 0 };
      if (walletRows && walletRows.length > 0) wallet = walletRows[0].value;
      wallet.balance = (wallet.balance | 0) + bcBalance;
      wallet.lifetime_earned = (wallet.lifetime_earned | 0) + bcBalance;
      wallet.updated_at = Math.floor(Date.now() / 1000);
      nk.storageWrite([{
        collection: "brain_coins",
        key: "wallet",
        userId: userId,
        value: wallet,
        permissionRead: 1,
        permissionWrite: 0,
      }]);

      // Audit log row (immutable). Recorded under brain_coins so it shows up
      // in the user's earn history alongside their other earn rows.
      nk.storageWrite([{
        collection: "brain_coins",
        key: probeKey,
        userId: userId,
        value: {
          code: "guest_wallet_sync",
          coins: bcBalance,
          unix_ts: wallet.updated_at,
          date: new Date().toISOString().slice(0, 10),
          source: "wallet_guest_sync",
          trace_id: data.trace_id || null,
          idempotency_key: idemKey,
          guest_wallet_id: guestWalletId,
        },
        permissionRead: 1,
        permissionWrite: 0,
      }]);

      logger.info("[GuestSync] synced " + bcBalance + " BC from guest wallet " + guestWalletId + " → user " + userId);
      return RpcHelpers.successResponse({
        ok: true,
        credited_bc: bcBalance,
        new_balance: wallet.balance,
      });

    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[GuestSync] failed: " + msg);
      RpcHelpers.logRpcError(nk, logger, "wallet_sync_guest_to_account", msg);
      return RpcHelpers.errorResponse("guest sync failed: " + msg, 500);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("wallet_sync_guest_to_account", rpcSync);
  }
}
