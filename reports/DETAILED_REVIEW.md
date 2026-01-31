# Detailed Review & Improvement Suggestions

**Date:** January 31, 2026  
**Reviewer Role:** Senior Backend Engineer / Technical Architect  
**Scope:** Reports in `/reports/` + Runtime modules in `/data/modules/`

---

## Part 1: Report-Level Review

### 1.1 ARCHITECTURE_OVERVIEW.md

**Current State:** Provides a useful high-level explanation of request flow and Nakama concepts.

**Issues:**
- Diagram syntax is plain text, not rendered as actual diagrams.
- Claims "123+ RPCs" but the code registers **175+ RPCs** — inconsistency.
- Does not explain the relationship between the monolithic `index.js` and the individual module files in subdirectories.
- Does not clarify that individual module files (e.g., `wallet/wallet.js`) use ES module syntax but are **not loaded at runtime** — all code is consolidated into `index.js`.

**Recommendations:**
1. Update RPC count to match actual registration count (175+).
2. Add a section explaining the consolidation pattern: individual files exist for development but are merged into `index.js` for runtime.
3. Add a warning that individual module files are not independently loadable due to Nakama's current runtime behavior.
4. Consider Mermaid or ASCII diagrams that render properly in GitHub/VS Code.

---

### 1.2 ARCHITECTURE_REVIEW.md

**Current State:** Correctly identifies monolithic coupling and missing observability.

**Issues:**
- Claims "configuration coupling" but does not show concrete examples.
- Does not quantify technical debt (e.g., "18,785 lines in one file").
- Does not mention that `infrastructure/caching.js` and `infrastructure/rate_limiting.js` exist but are **not wired** to any RPC.

**Recommendations:**
1. Add specific line counts and file references.
2. Explicitly list which infrastructure utilities exist but are unused.
3. Add a risk matrix (likelihood × impact) for each identified weakness.

---

### 1.3 IMPROVEMENT_PLAN.md

**Current State:** Provides a phased approach with reasonable timelines.

**Issues:**
- Phase 1 proposes splitting `index.js` into modules, but does not acknowledge that individual module files already exist and are not used at runtime.
- Phase 3 proposes observability, but does not specify which metrics to add or which logging format to use.
- Phase 4 proposes caching, but does not acknowledge that a caching module already exists.

**Recommendations:**
1. Reframe Phase 1: the goal is to **activate** the existing modular files, not create new ones.
2. Add specific deliverables for each phase (e.g., "Add Prometheus histogram for RPC latency").
3. Add dependencies between phases (e.g., Phase 3 depends on Phase 1 for correlation ID propagation).

---

### 1.4 ARCHITECTURE_PROPOSAL.md

**Current State:** Proposes a clean folder structure and naming conventions.

**Issues:**
- Proposes a folder structure that **already partially exists** (`wallet/wallet.js`, `analytics/analytics.js`, etc.) but does not acknowledge this.
- Does not explain how to unify the existing modules with the proposed structure.
- Does not address the Nakama runtime constraint: Nakama's JS runtime does not support ES module imports at runtime; all code must be bundled.

**Recommendations:**
1. Audit existing module files and map them to the proposed structure.
2. Add a build step proposal: use a bundler (Rollup, esbuild) to produce a single runtime module from modular source files.
3. Clarify that the "core" utilities already exist in `copilot/utils.js`.

---

### 1.5 PRODUCTION_READINESS_GUIDE.md

**Current State:** Lists correct production requirements.

**Issues:**
- Claims "every storage object has schemaVersion" — this is **not enforced** in code.
- Claims "all RPCs return a consistent envelope" — this is **not consistent** (some return `success`, some return `data` directly).
- Does not mention rate limiting or caching, which are critical for production.

**Recommendations:**
1. Add a "Current Compliance" column to each requirement.
2. Add rate limiting, caching, and idempotency requirements.
3. Add specific schema version examples and migration patterns.

---

### 1.6 GAME_BACKEND_BEST_PRACTICES.md

**Current State:** Correct advice for Unity developers.

**Issues:**
- Generic advice, not tied to this specific codebase.
- Does not show examples of how this codebase implements (or fails to implement) each practice.

**Recommendations:**
1. Add code snippets from this repo as positive or negative examples.
2. Add a checklist for Unity developers to verify their integrations.

---

### 1.7 LEARNING_ROADMAP.md

**Current State:** Good high-level learning path.

**Issues:**
- Does not tie phases to specific resources (books, courses, repos).
- Does not mention Nakama-specific learning (e.g., runtime API docs).

**Recommendations:**
1. Add recommended resources for each phase.
2. Add a Nakama-specific learning section (official docs, example projects).
3. Add mentorship and code review checkpoints.

---

## Part 2: Code-Level Review

### 2.1 Monolithic Runtime (`data/modules/index.js`)

**Current State:** 18,785 lines of JavaScript containing all RPC implementations.

**Critical Issues:**

1. **No separation of concerns.** All domains (wallet, friends, leaderboards, analytics, etc.) are in one file.
2. **Duplicated utility functions.** Helper functions are defined at multiple points in the file.
3. **No unit tests.** No test coverage for any RPC.
4. **Mixed coding styles.** Some functions use `var`, some use `const`. Some use arrow functions, some do not.
5. **Error handling is inconsistent.** Some functions return `{ success: false, error: ... }`, others throw errors, others return `utils.handleError(...)`.

**Recommendations:**

1. **Short-term:** Add a TypeScript or ESLint config to enforce consistent style.
2. **Medium-term:** Extract domains into separate source files and use a bundler to produce `index.js`.
3. **Long-term:** Add unit tests using a mock `nk` object.

---

### 2.2 Infrastructure Utilities (Unused)

**Files:**
- `infrastructure/caching.js` — 236 lines
- `infrastructure/rate_limiting.js` — 176 lines

**Current State:** These files define `withCache` and `withRateLimit` wrapper functions, but **no RPC uses them**.

**Evidence:**

In `index.js`, RPCs are registered directly:
```javascript
initializer.registerRpc('wallet_get_all', rpcWalletGetAll);
```

The correct pattern would be:
```javascript
initializer.registerRpc('wallet_get_all', withRateLimit(rpcWalletGetAll, 'wallet_get_all', 100, 60));
```

But this pattern is **never used** in the codebase.

**Recommendations:**

1. Apply `withRateLimit` to all write operations (wallet, rewards, score submission).
2. Apply `withCache` to all read operations (leaderboards, profiles).
3. Document the applied limits in the API documentation.

---

### 2.3 Wallet System

**Files:**
- `wallet/wallet.js` — 461 lines (uses ES module syntax)
- Wallet logic is also duplicated in `index.js`

**Critical Issues:**

1. **ES module syntax:** `wallet/wallet.js` uses `import * as utils from "../copilot/utils.js";` — this will **not work** in Nakama's runtime, which does not support ES modules.
2. **Duplicate logic:** Wallet functions are defined both in `wallet/wallet.js` and in `index.js`.
3. **No idempotency:** `rpcWalletUpdateGlobal` will add currency every time it is called, even if the same request is sent twice.

**Recommendations:**

1. Remove ES module syntax from all module files or use a bundler.
2. Add idempotency keys to wallet update requests.
3. Consolidate wallet logic into a single source of truth.

---

### 2.4 Daily Rewards System

**Files:**
- `daily_rewards/daily_rewards.js` — 307 lines (uses ES module syntax)

**Issues:**

1. **ES module syntax** — will not work at runtime.
2. **Streak broken at 48 hours** — hardcoded logic, not configurable per game.
3. **No idempotency** — `rpcDailyRewardsClaim` can be called multiple times in edge cases (e.g., client retry with network failure).

**Recommendations:**

1. Add a `claimIdempotencyKey` to prevent double claims.
2. Make streak reset threshold configurable per game.
3. Add logging with correlation IDs.

---

### 2.5 Leaderboards

**Files:**
- `leaderboards_timeperiod.js` — 932 lines

**Issues:**

1. External API credentials (client_id, client_secret) are **hardcoded** in the source.
2. No retry logic for external API calls.
3. No caching of game registry data.

**Recommendations:**

1. Move credentials to environment variables.
2. Add retry logic with exponential backoff.
3. Cache game registry for 1 hour to reduce external API calls.

---

### 2.6 Analytics

**Files:**
- `analytics/analytics.js` — 157 lines (uses ES module syntax)

**Issues:**

1. DAU tracking writes to system user storage (`00000000-0000-0000-0000-000000000000`), which works but is not scalable for high-concurrency writes.
2. Session tracking has a race condition: if two session_start events arrive, only the last one is recorded.

**Recommendations:**

1. Use atomic increments or a dedicated analytics table for DAU.
2. Add locking or idempotency for session tracking.

---

### 2.7 Friends System

**Files:**
- `friends/friends.js` — 357 lines (uses ES module syntax)

**Issues:**

1. Block list is stored in custom storage, not using Nakama's built-in block state.
2. Spectate RPC is incomplete (code is cut off in the file).

**Recommendations:**

1. Consider using Nakama's built-in friend states for blocking.
2. Complete the spectate RPC or remove it.

---

### 2.8 Achievements

**Files:**
- `achievements/achievements.js` — 559 lines

**Issues:**

1. Uses `const` which is ES6 — should be fine but inconsistent with `var` usage elsewhere.
2. Achievement definitions are stored in system user storage, which is correct.
3. No notification is sent when an achievement is unlocked.

**Recommendations:**

1. Add notification on achievement unlock.
2. Standardize on `const`/`let` or `var` across all files.

---

## Part 3: Best-Practice Recommendations

### 3.1 Error Handling

**Current Pattern:**
```javascript
return utils.handleError(ctx, null, "User not authenticated");
```

**Recommended Pattern:**
```javascript
return JSON.stringify({
    success: false,
    error: {
        code: "AUTH_REQUIRED",
        message: "User not authenticated",
        traceId: ctx.traceId || generateTraceId()
    },
    timestamp: new Date().toISOString()
});
```

---

### 3.2 Logging

**Current Pattern:**
```javascript
logger.info("[Wallet] User " + userId + " updated wallet");
```

**Recommended Pattern:**
```javascript
logger.info(JSON.stringify({
    event: "wallet_updated",
    userId: userId,
    traceId: ctx.traceId,
    gameId: gameId,
    currency: currency,
    amount: amount,
    operation: operation
}));
```

---

### 3.3 Idempotency

**Current Pattern:** None.

**Recommended Pattern:**
```javascript
// Client sends: { idempotencyKey: "abc123", ... }
// Server checks:
var existingResult = nk.storageRead([{
    collection: "idempotency_keys",
    key: data.idempotencyKey,
    userId: userId
}]);
if (existingResult.length > 0) {
    return JSON.stringify(existingResult[0].value); // Return cached result
}
// ... perform operation ...
// Store result with idempotency key
nk.storageWrite([{
    collection: "idempotency_keys",
    key: data.idempotencyKey,
    userId: userId,
    value: result,
    permissionRead: 1,
    permissionWrite: 0
}]);
```

---

### 3.4 Schema Versioning

**Current Pattern:** None.

**Recommended Pattern:**
```javascript
var walletData = {
    schemaVersion: 2,
    userId: userId,
    currencies: { ... },
    // ...
};

// On read:
if (walletData.schemaVersion < 2) {
    walletData = migrateWalletV1toV2(walletData);
}
```

---

## Conclusion

The reports are directionally correct but overstate the current implementation maturity. The code has significant gaps in observability, idempotency, and module integration. The infrastructure utilities exist but are not used. The biggest risk is the monolithic `index.js` file, which will become increasingly difficult to maintain.

Immediate priorities:
1. Wire rate limiting and caching to critical RPCs.
2. Add idempotency to wallet and reward operations.
3. Standardize error handling and logging.
4. Add unit tests for critical paths.
