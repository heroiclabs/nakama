# 2026-07-07 — Economy page: admin wallet grant/deduct fixed

**Commit:** `c4e45007` · **Pipelines:** `intelliverse-nakama` + `nakama-admin-dashboard-pipeline` (both Succeeded)

## Problem

1. **Economy → Wallets tab Grant/Deduct was completely broken.** The buttons
   called `hiro_economy_grant`, which the runtime bundle aliases to the
   **inventory** grant RPC. That RPC expects `{itemId, count}` (not
   `{currencies}`), and targets the *calling* user via `requireUserId(ctx)` —
   through the admin server-key proxy there is no user, so every click failed
   with `AUTH_REQUIRED: User ID is required`.
2. **Players page grant was also broken.** It sends `user_id` (snake_case) but
   `admin_wallet_grant` only accepted `data.userId` → "userId and currencies
   required" on every grant.
3. **Grants were invisible in the console.** `admin_wallet_grant` writes the
   legacy storage wallet (`wallets/wallet`), but Economy/Players pages display
   the **native Nakama wallet** from console accounts — so even a successful
   grant looked like a no-op.

## Fix

**Backend (`data/modules/src/hiro/base/admin.ts`):**
- `admin_wallet_view/grant/reset` now accept both `userId` and `user_id`.
- A `quizverse` game scope (any alias/UUID) folds to the bare legacy wallet via
  `ConfigLoader.isLegacyBareKeyOwner`, matching where the QuizVerse game reads.
- Bare-scope grants are mirrored into the **native Nakama wallet**
  (`nk.walletUpdate`) so the console reflects them; response includes
  `nativeUpdated` / `nativeError`.

**Frontend (`web/packages/admin/src/pages/EconomyPage.tsx`):**
- Grant and Deduct mutations now call `admin_wallet_grant` with
  `{userId, currencies, game_id}` instead of `hiro_economy_grant`.

## Prod verification (all green)

| Test | Result |
|---|---|
| `admin_wallet_grant` with `user_id` (snake) +25 coins | success, `nativeUpdated: true` |
| Grant scoped to QuizVerse UUID +10 coins | folded to bare wallet, native mirrored |
| Native wallet (`GET /v2/account`) | reflects both grants |
| Deduct via negative grant −5 coins | success, native mirrored |

## Verified-working Economy page flows (no changes needed)

- Overview/Wallets read: console `listAccounts` (native wallets, platform-wide by design).
- Economy config + Store config: `admin_config_get` game-scoped, inheritance flags correct.
- Transactions tab: per-user `iap_receipts` / `purchase_history` storage reads.
- Audit tab: session-local by design (documented in-page).
