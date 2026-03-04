# Code Gap & Improvement Guide

**Date:** January 31, 2026  
**Purpose:** For new developers, reviewers, and auditors  
**Scope:** Gap analysis between reports and actual code implementation

---

## How to Use This Guide

This document maps **documented features** to **actual implementation status**. Use it to understand:
- What is fully working and production-ready
- What is partially implemented and needs completion
- What is documented but not implemented
- What exists in code but is not used

---

## Quick Reference: Implementation Status Legend

| Status | Meaning |
|--------|---------|
| ✅ **Implemented** | Fully working, tested in production-like conditions |
| ⚠️ **Partial** | Core logic exists but missing safety/observability features |
| ❌ **Not Implemented** | Documented but code does not exist or is non-functional |
| 🔸 **Exists but Unused** | Code exists but is not wired to any RPC |

---

## Section 1: Core Systems

### 1.1 Authentication & Sessions

| Feature | Status | Code Location | Notes |
|---------|--------|---------------|-------|
| Device authentication | ✅ | `server/api_authenticate.go` | Built-in Nakama |
| Custom authentication | ✅ | `server/api_authenticate.go` | Built-in Nakama |
| Session validation | ✅ | `server/api_rpc.go#L48-100` | Token + HTTP key supported |
| Cognito integration | ⚠️ | `index.js` `rpc_update_player_metadata` | Stores Cognito ID but no token validation |

**Gap:** Cognito token validation is not performed server-side. The server trusts client-provided `cognito_user_id`.

**Recommended Fix:** Add Cognito JWT verification using AWS Cognito public keys.

---

### 1.2 Player Metadata

| Feature | Status | Code Location | Notes |
|---------|--------|---------------|-------|
| Store player metadata | ✅ | `index.js#L260-560` | Comprehensive metadata storage |
| Geolocation storage | ✅ | `index.js#L660-720` | Lat/long and geo fields |
| Device fingerprinting | ✅ | `index.js#L500-520` | Platform, device model, etc. |
| Game history tracking | ✅ | `index.js#L830-880` | Games array with play counts |
| Schema versioning | ❌ | Not implemented | Reports claim versioning exists |

**Gap:** No `schemaVersion` field in stored metadata. No migration logic.

**Why It Matters:** Without versioning, schema changes will corrupt existing data or require manual migration.

**Recommended Fix:**
```javascript
// Add to metadata object:
merged.schemaVersion = 1;

// On read:
if (stored.schemaVersion < CURRENT_SCHEMA_VERSION) {
    stored = runMigrations(stored);
}
```

---

### 1.3 Wallet System

| Feature | Status | Code Location | Notes |
|---------|--------|---------------|-------|
| Global wallet | ✅ | `index.js` `rpcWalletGetAll`, `rpcWalletUpdateGlobal` | XUT, XP currencies |
| Per-game wallet | ✅ | `index.js` `rpcWalletUpdateGameWallet` | Tokens, XP per game |
| Transaction logging | ✅ | `wallet/wallet.js#L98-107` | Logs to `transaction_logs` |
| Idempotency | ❌ | Not implemented | Double-request = double-grant |
| Rate limiting | 🔸 | `infrastructure/rate_limiting.js` | Exists but not wired |

**Gap:** Wallet updates are not idempotent. A client retry can double-grant currency.

**Why It Matters:** This is a critical exploit vector. Attackers can abuse retries to duplicate currency.

**Recommended Fix:**
```javascript
// Client sends: { idempotencyKey: "uuid", currency: "xut", amount: 100, ... }
// Server:
var existing = nk.storageRead([{
    collection: "idempotency",
    key: data.idempotencyKey,
    userId: userId
}]);
if (existing.length > 0) {
    return JSON.stringify(existing[0].value); // Return cached result
}
// ... perform wallet update ...
nk.storageWrite([{
    collection: "idempotency",
    key: data.idempotencyKey,
    userId: userId,
    value: response,
    permissionRead: 1,
    permissionWrite: 0
}]);
```

---

### 1.4 Leaderboards

| Feature | Status | Code Location | Notes |
|---------|--------|---------------|-------|
| Time-period leaderboards | ✅ | `leaderboards_timeperiod.js#L35-170` | Daily, weekly, monthly, alltime |
| Game-specific leaderboards | ✅ | `leaderboards_timeperiod.js#L35-100` | Per gameId UUID |
| Global leaderboards | ✅ | `leaderboards_timeperiod.js#L112-170` | Cross-game ranking |
| Score submission | ✅ | `index.js` `rpcSubmitScoreToTimePeriods` | Writes to all periods |
| Caching | 🔸 | `infrastructure/caching.js` | Exists but not wired |

**Gap:** Leaderboard reads are not cached. Every request hits the database.

**Why It Matters:** Leaderboard reads are among the most frequent RPCs. Uncached reads will overload the database under load.

**Recommended Fix:**
```javascript
// In index.js, wrap the RPC:
var cachedGetLeaderboard = withCache(
    rpcGetTimePeriodLeaderboard,
    'get_time_period_leaderboard',
    60, // 60 second cache
    function(ctx, payload) {
        var data = JSON.parse(payload);
        return "leaderboard_" + data.gameId + "_" + data.period;
    }
);
initializer.registerRpc('get_time_period_leaderboard', cachedGetLeaderboard);
```

---

### 1.5 Daily Rewards

| Feature | Status | Code Location | Notes |
|---------|--------|---------------|-------|
| Streak tracking | ✅ | `daily_rewards/daily_rewards.js#L56-90` | Per user per game |
| Reward configuration | ✅ | `daily_rewards/daily_rewards.js#L6-50` | 7-day cycle with tokens/XP |
| Claim validation | ✅ | `daily_rewards/daily_rewards.js#L92-130` | Checks 24h window |
| Streak reset threshold | ⚠️ | `daily_rewards/daily_rewards.js#L115-120` | Hardcoded 48 hours |
| Idempotent claims | ❌ | Not implemented | Double-claim possible in edge cases |

**Gap:** Streak reset is hardcoded to 48 hours. Should be configurable per game.

**Gap:** Claims are not idempotent. A network retry could double-claim.

**Recommended Fix:**
1. Add `streakResetHours` to game config.
2. Store `lastClaimIdempotencyKey` and reject duplicates.

---

### 1.6 Daily Missions

| Feature | Status | Code Location | Notes |
|---------|--------|---------------|-------|
| Mission definitions | ✅ | `index.js` `rpcGetDailyMissions` | Per game |
| Progress tracking | ✅ | `index.js` `rpcSubmitMissionProgress` | Incremental updates |
| Reward claiming | ✅ | `index.js` `rpcClaimMissionReward` | Grants tokens |
| Mission reset | ⚠️ | `index.js` | Daily reset but no cron job |

**Gap:** Missions reset is checked at read time, not via scheduled job. This works but is inefficient.

---

## Section 2: Social Systems

### 2.1 Friends

| Feature | Status | Code Location | Notes |
|---------|--------|---------------|-------|
| Add friend | ✅ | Built-in Nakama | `nk.friendsAdd()` |
| Remove friend | ✅ | `friends/friends.js#L105-140` | Wraps Nakama |
| Block user | ⚠️ | `friends/friends.js#L13-55` | Custom storage, not Nakama state |
| Unblock user | ⚠️ | `friends/friends.js#L62-100` | Custom storage |
| List friends | ✅ | `friends/friends.js#L147-195` | Wraps Nakama |
| Challenge friend | ✅ | `friends/friends.js#L202-265` | Creates challenge in storage |
| Spectate friend | ❌ | `friends/friends.js#L275-300` | Code is incomplete |

**Gap:** Block/unblock uses custom storage instead of Nakama's built-in friend state (state=3 = blocked).

**Gap:** Spectate RPC is incomplete — function body is cut off.

**Recommended Fix:**
1. Use `nk.friendsAdd(userId, targetId, "", "")` with state=3 for blocking.
2. Complete or remove spectate RPC.

---

### 2.2 Groups

| Feature | Status | Code Location | Notes |
|---------|--------|---------------|-------|
| Create group | ✅ | `index.js` `rpcCreateGameGroup` | Wraps Nakama |
| Group XP | ✅ | `index.js` `rpcUpdateGroupXP` | Custom storage |
| Group wallet | ✅ | `index.js` `rpcGetGroupWallet`, `rpcUpdateGroupWallet` | Custom storage |
| List user groups | ✅ | `index.js` `rpcGetUserGroups` | Wraps Nakama |
| Group chat | ⚠️ | Nakama built-in | Not wrapped with custom RPC |

**Gap:** Group wallet is stored in custom storage, not in Nakama's group metadata. This creates two sources of truth.

---

## Section 3: Infrastructure

### 3.1 Caching

| Feature | Status | Code Location | Notes |
|---------|--------|---------------|-------|
| Cache get/set/delete | 🔸 | `infrastructure/caching.js#L6-60` | In-memory, TTL-based |
| Cache wrapper (`withCache`) | 🔸 | `infrastructure/caching.js#L90-120` | Decorator pattern |
| Applied to RPCs | ❌ | Not applied | No RPC uses the cache |

**Why It Matters:** Caching code exists but provides no benefit because it is not used.

**Recommended Fix:**
```javascript
// In InitModule:
var cachedProfileGet = withCache(rpcGetPlayerPortfolio, 'get_player_portfolio', 300, ...);
initializer.registerRpc('get_player_portfolio', cachedProfileGet);
```

---

### 3.2 Rate Limiting

| Feature | Status | Code Location | Notes |
|---------|--------|---------------|-------|
| Rate limit check | 🔸 | `infrastructure/rate_limiting.js#L11-50` | Sliding window |
| Rate limit wrapper (`withRateLimit`) | 🔸 | `infrastructure/rate_limiting.js#L55-85` | Decorator pattern |
| Applied to RPCs | ❌ | Not applied | No RPC uses rate limiting |

**Why It Matters:** Rate limiting code exists but provides no protection because it is not used.

**Recommended Fix:**
```javascript
// In InitModule:
var limitedWalletUpdate = withRateLimit(rpcWalletUpdateGlobal, 'wallet_update_global', 30, 60);
initializer.registerRpc('wallet_update_global', limitedWalletUpdate);
```

---

### 3.3 Observability

| Feature | Status | Code Location | Notes |
|---------|--------|---------------|-------|
| Structured logging | ❌ | Not implemented | Logs are unstructured strings |
| Correlation IDs | ❌ | Not implemented | No traceId in RPCs |
| Metrics | ❌ | Not implemented | No runtime-level metrics |
| Error codes | ⚠️ | Partial | Some RPCs use error codes, most do not |

**Why It Matters:** Without observability, debugging production issues is guesswork.

**Recommended Fix:**
```javascript
// At start of every RPC:
var traceId = generateShortUUID();
logger.info(JSON.stringify({
    event: "rpc_start",
    rpc: "wallet_update_global",
    traceId: traceId,
    userId: ctx.userId
}));
// Pass traceId to all sub-functions
// At end:
logger.info(JSON.stringify({
    event: "rpc_end",
    rpc: "wallet_update_global",
    traceId: traceId,
    durationMs: Date.now() - startTime,
    success: true
}));
```

---

## Section 4: Module Organization

### 4.1 ES Module Files (Non-Functional)

The following files use ES module syntax (`import`/`export`) and **cannot be loaded by Nakama's runtime**:

| File | Status | Notes |
|------|--------|-------|
| `wallet/wallet.js` | ❌ Non-functional | Uses `import * as utils from ...` |
| `daily_rewards/daily_rewards.js` | ❌ Non-functional | Uses `import * as utils from ...` |
| `friends/friends.js` | ❌ Non-functional | Uses `import * as utils from ...` |
| `analytics/analytics.js` | ❌ Non-functional | Uses `import * as utils from ...` |
| `achievements/achievements.js` | ⚠️ Partially functional | Uses `const` but no imports |

**Why It Matters:** These files appear to be the modular structure the reports describe, but they are **not used at runtime**. All logic is duplicated in `index.js`.

**Recommended Fix:**
1. Remove ES module syntax from individual files.
2. Use a bundler (esbuild, Rollup) to combine modules into a single `index.js`.
3. Or consolidate into `index.js` and delete the unused files.

---

### 4.2 External Credentials

| Credential | Status | Code Location | Notes |
|------------|--------|---------------|-------|
| OAuth client_id | ❌ Hardcoded | `leaderboards_timeperiod.js#L185-186` | Security risk |
| OAuth client_secret | ❌ Hardcoded | `leaderboards_timeperiod.js#L187` | Security risk |
| Google Maps API key | ⚠️ In docker-compose | `docker-compose.yml#L35` | Should be in secrets manager |

**Why It Matters:** Hardcoded secrets can be leaked via source control or logs.

**Recommended Fix:**
```javascript
// Use environment variables:
var client_id = nk.env["INTELLIVERSE_CLIENT_ID"];
var client_secret = nk.env["INTELLIVERSE_CLIENT_SECRET"];
```

---

## Section 5: Summary Matrix

| Domain | Implementation | Idempotency | Rate Limiting | Caching | Observability |
|--------|----------------|-------------|---------------|---------|---------------|
| Auth | ✅ | N/A | ❌ | N/A | ⚠️ |
| Wallet | ✅ | ❌ | ❌ | ❌ | ⚠️ |
| Leaderboards | ✅ | N/A | ❌ | ❌ | ⚠️ |
| Daily Rewards | ✅ | ❌ | ❌ | ❌ | ⚠️ |
| Daily Missions | ✅ | ❌ | ❌ | ❌ | ⚠️ |
| Friends | ⚠️ | N/A | ❌ | ❌ | ⚠️ |
| Groups | ✅ | ❌ | ❌ | ❌ | ⚠️ |
| Analytics | ✅ | ❌ | ❌ | ❌ | ⚠️ |
| Achievements | ✅ | ❌ | ❌ | ❌ | ⚠️ |
| Push Notifications | ✅ | ❌ | ❌ | ❌ | ⚠️ |

---

## Section 6: Priority Action Items

### P0 — Do Immediately

1. **Wire rate limiting** to `wallet_update_global`, `wallet_update_game_wallet`, `daily_rewards_claim`, `claim_mission_reward`.
2. **Add idempotency** to all currency-modifying operations.
3. **Move secrets** to environment variables.

### P1 — Do This Sprint

4. **Add correlation IDs** to all RPCs.
5. **Standardize error responses** with error codes.
6. **Apply caching** to `get_time_period_leaderboard`, `get_player_portfolio`, `achievements_get_all`.

### P2 — Do This Month

7. **Add schema versioning** to all storage objects.
8. **Consolidate or remove** unused ES module files.
9. **Complete or remove** incomplete RPCs (spectate).

### P3 — Do This Quarter

10. **Add unit tests** for wallet, rewards, leaderboards.
11. **Add Prometheus metrics** for RPC latency and error rate.
12. **Add structured logging** with JSON format.

---

## Conclusion

This guide provides an accurate picture of what the codebase actually implements. Use it to prioritize work and avoid assuming features work simply because they are documented.

**Key Takeaway:** The infrastructure utilities (caching, rate limiting) exist but are not used. Applying them is the highest-impact, lowest-effort improvement available.

---

*This document should be updated whenever significant implementation changes are made.*
