# Backend Hardening Notes (`data/modules/index.js`)

This document captures structural hardening invariants applied to the Nakama
runtime module. **Read this before editing `index.js`.** It is part of the
QuizVerse production-readiness pass and is referenced by Unity client code.

---

## 1. Duplicate function definitions

`index.js` is the merged output of multiple ES5 source files and contains
several functions defined more than once at the **top-level scope**.

In ES5, top-level `function fooName() { ... }` declarations are hoisted and the
**last definition wins** at runtime — the earlier ones are dead code and must
not be relied upon.

**Known duplicates and which one wins (file order — last entry is live):**

| Function                                | Defined at lines              | Winning copy |
| --------------------------------------- | ----------------------------- | ------------ |
| `ensureLeaderboardExists`               | 17618, 44383, 67013 (nested)  | **44383**    |
| `writeToAllLeaderboards`                | 17703, 44432, 67053 (nested)  | **44432**    |
| `rpcWalletGetAll`                       | 34494, 41015                  | **41015**    |
| `rpcWalletUpdateGlobal`                 | 34535, 41056                  | **41056**    |
| `rpcWalletUpdateGameWallet`             | 34605, 41130                  | **41130**    |
| `rpcWalletTransferBetweenGameWallets`   | 34707, 41238                  | **41238**    |
| `rpcWalletGetBalances`                  | 34794, 38542                  | **38542**    |
| `rpcAnalyticsDashboard`                 | 2235,  6233                   | **6233**     |
| `rpcAnalyticsSessionStats`              | 3293,  6502                   | **6502**     |
| `rpcAnalyticsFunnel`                    | 3507,  6591                   | **6591**     |
| `rpcAnalyticsEconomyHealth`             | 3765,  6710                   | **6710**     |
| `rpcAnalyticsErrorLog`                  | 4235,  6817                   | **6817**     |
| `rpcAnalyticsFeatureAdoption`           | 3687,  6900                   | **6900**     |
| `nowISO`                                | 10979, 12364                  | **12364**    |
| `generateShareCode`                     | 57683 (file scope), 60113 (nested in `__ModuleInit_*`) | **57683 wins for any module-init outside the inner closure; 60113 wins inside its closure** |

> The two `writeToAllLeaderboards` definitions at line 17703 and 67053 are
> **dead code paths** for the live runtime. The 67053 copy (LegacyLeaderboards
> namespace) is exercised by `legacy_submit_score` only. The 44432 copy is the
> one called by `rpcSubmitScoreAndSync` and other production score-write paths.

When making behavior changes to any of these functions:
1. Always patch the **winning copy** (or all copies if disambiguation is risky).
2. When adding new behavior, prefer adding it once and `// DEDUP-NOTE` comment
   the dead copies pointing to the winner.
3. Do **not** delete the dead copies in this hardening pass — that requires a
   separate, integration-tested cleanup PR because some closures may capture
   pre-redefinition versions.

---

## 2. Wallet RPC idempotency contract

The three wallet **mutating** RPCs accept an optional `request_id` (or
`requestId`) field in the payload. When supplied, the server uses it to
de-duplicate accidental retries (network jitter, double-clicks, app
backgrounding mid-flight on iOS).

| RPC                                       | Mutates? | Idempotent? |
| ----------------------------------------- | -------- | ----------- |
| `wallet_get_all`                          | No       | n/a         |
| `wallet_get_balances`                     | No       | n/a         |
| `wallet_update_global`                    | **Yes**  | **Yes** when `request_id` supplied |
| `wallet_update_game_wallet`               | **Yes**  | **Yes** when `request_id` supplied |
| `wallet_transfer_between_game_wallets`    | **Yes**  | **Yes** when `request_id` supplied |

**Storage:** cached responses live in collection `wallet_idempotency`, key
`wallet_req_<request_id>`, owned by the calling user. Records are evicted by
the cleanup task `walletIdempotencyCleanup` after `WALLET_IDEMPOTENCY_TTL_S`
seconds (default 600s = 10 minutes — long enough to cover network retries,
short enough to bound storage growth).

**Client contract:**
- The client **should** generate one `request_id` (UUIDv4 recommended) per
  user-intent (one purchase, one reward grant, one transfer).
- If the client retries (timeout, transient error, app resume) it **must**
  send the **same** `request_id`. The server replays the cached success
  response without mutating the wallet again.
- If the client omits `request_id`, the server falls back to non-idempotent
  behavior (legacy clients keep working, just without retry safety).

**Backwards compatibility:** legacy callers that omit the field are unaffected.

---

## 3. V3.0 / V3.1 fallback chain — Compatibility Quiz RPCs

The Compatibility Quiz feature is registered twice in the Nakama init pipeline.
Both versions register through a **first-wins** chain via the
`__rpc_compatibility_*` module-level slots:

```
// in __ModuleInit_<v3.0 block> at line ~60074:
__rpc_compatibility_create_session = __rpc_compatibility_create_session || rpcCompatibilityCreateSessionV30;
... (same pattern for join/submit/get/calculate)

// in __ModuleInit_<v3.1 block> at line ~60123:
__rpc_compatibility_create_session = __rpc_compatibility_create_session || rpcCompatibilityCreateSessionV31;
... (same pattern for join/submit/get/calculate)
```

Because the v3.0 block runs **first**, the v3.0 implementations win. The v3.1
implementations are **fallbacks** invoked only if the v3.0 init failed and left
`__rpc_compatibility_*` slots `undefined`.

**Why this matters:** the two implementations have **divergent storage shapes**:

| Field                 | V3.0 shape                                            | V3.1 shape                              |
| --------------------- | ----------------------------------------------------- | --------------------------------------- |
| Session players       | `playerA: {...}`, `playerB: {...}` nested objects     | `playerAAnswers: [...]`, `playerBAnswers: [...]` flat arrays |
| Result payload        | `relationshipAdvice`, `matchingTraits`, `emoji`, etc. | `playerAResult`, `playerBResult` only   |
| `nk.uuidV4()` vs `uuidv4()` | uses `nk.uuidV4()` (capital V)                  | uses `nk.uuidv4()` (lowercase v)        |

Sessions written by V3.0 **cannot be read by V3.1** code paths, and vice
versa. If you ever need to swap the winner, you **must** also write a
migration RPC that translates session shapes — otherwise existing in-flight
sessions will appear corrupted after the swap.

**Active version check at runtime:** the live registration is logged at
startup with the line:

```
[Compatibility] Successfully registered 5 Compatibility Quiz RPCs
```

(emitted by the v3.0 block). If you only see the v3.1 line
`[Compatibility] Registered 5 Compatibility Quiz RPCs` without the v3.0
"Successfully" line, then v3.0 init failed and v3.1 took over.

---

## 4. Silent-catch policy

Empty catch blocks (`} catch (_) {}`) are **prohibited** in the score
submission and wallet write paths. Use the form:

```js
try {
    nk.someCall();
} catch (e) {
    logger.warn('[Subsystem] short reason: ' + (e && e.message ? e.message : e));
}
```

Sites already converted in this hardening pass:
- `index.js:24315` — quizverse_global lookup in profile flow
- `index.js:24326` — quizverse_global re-read after backfill
- `index.js:67336` — username lookup before legacy submit-score
- `index.js:67391` — per-leaderboard user-record fetch in get_all_leaderboards

If you add a new score- or wallet-related call site, follow the same pattern —
silent failures here cause the Home rank/score card to silently render `--`
(QV_Bug_A8 root cause).

---

## 5. Hardening checklist for new RPCs

When adding a new RPC, especially a wallet- or score-mutating one:

- [ ] Function name does not collide with an existing top-level function
      (search `index.js` first).
- [ ] If it mutates server state, accept and honor `request_id` via
      `walletIdempotencyGuard` / `walletIdempotencyStore`.
- [ ] All `try/catch` blocks log the error via `logger.warn` or `logger.error`
      (never `} catch (_) {}`).
- [ ] If it reads/writes a user-scoped storage record, set
      `permissionRead: 1, permissionWrite: 0` (owner read, server-only write).
- [ ] Register via the `__rpc_<name> = __rpc_<name> || ...` first-wins
      pattern so subsequent module versions can layer fallbacks.
