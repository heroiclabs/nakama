# Nakama RPC Deduplication Plan (v2 — Reviewed & Hardened)

> **Total Registered RPCs: 187**  
> **Duplicate/Overlapping: ~84**  
> **Target after consolidation: ~103 RPCs (45% reduction)**  
> **Date: 2026-03-14**  
> **Status: APPROVED ✅**

---

## Executive Summary

This plan identifies 8 duplication clusters containing ~84 redundant RPCs that can be safely consolidated. The plan also addresses 6 critical architectural gaps found during review that must be solved alongside deduplication for true production-readiness.

> [!IMPORTANT]
> **Code-verified finding**: In `multigame_rpcs.js`, every LastToLive RPC is literally a one-line redirect to the QuizVerse equivalent (e.g., `lasttoliveUpdateUserProfile` → `return quizverseUpdateUserProfile(ctx, logger, nk, payload)`). The generic `parseAndValidateGamePayload()` function already exists and validates `gameID`/`gameUUID`. This means **Cluster 1 is essentially zero-risk** — the architecture is already there.

---

## 🚨 Critical Gaps Found During Review

These MUST be addressed alongside deduplication, or we produce a clean but still fragile codebase.

### Gap 1: No Standard Response Envelope

**Current state**: Every RPC returns its own format. Some return `{ success, data }`, others return `{ success, error }`, others return raw objects.

**Fix**: Define ONE response envelope function:

```javascript
// response.js — Standard response helper
function successResponse(data, meta) {
    return JSON.stringify({
        success: true,
        data: data || {},
        meta: meta || {},   // Optional: execution_time_ms, cached, etc.
        error: null
    });
}

function errorResponse(code, message, details) {
    return JSON.stringify({
        success: false,
        data: null,
        meta: {},
        error: {
            code: code,         // e.g., "WALLET_INSUFFICIENT_FUNDS"
            message: message,   // Human-readable
            details: details    // Optional debug info (stripped in prod)
        }
    });
}
```

**Impact**: Unity client only needs ONE deserialization model per RPC — `NakamaResponse<T>`.

---

### Gap 2: No Error Code System

**Current state**: Errors are plain strings (`"Amount must be a positive number"`). Unity client can't programmatically react to specific errors.

**Fix**: Define error code constants:

```javascript
var ErrorCodes = {
    // Auth
    INVALID_SESSION:     "AUTH_INVALID_SESSION",
    
    // Wallet
    INSUFFICIENT_FUNDS:  "WALLET_INSUFFICIENT_FUNDS",
    INVALID_AMOUNT:      "WALLET_INVALID_AMOUNT",
    WALLET_NOT_FOUND:    "WALLET_NOT_FOUND",
    
    // Game
    INVALID_GAME_ID:     "GAME_INVALID_ID",
    GAME_NOT_REGISTERED: "GAME_NOT_REGISTERED",
    
    // General
    INVALID_PAYLOAD:     "INVALID_PAYLOAD",
    MISSING_FIELD:       "MISSING_REQUIRED_FIELD",
    RATE_LIMITED:        "RATE_LIMITED",
    INTERNAL_ERROR:      "INTERNAL_ERROR"
};
```

**Impact**: Unity client can do `if (response.error.code == "WALLET_INSUFFICIENT_FUNDS") ShowBuyCoinsDialog();`

---

### Gap 3: No Middleware Pipeline

**Current state**: Rate limiting (`infrastructure/rate_limiting.js`) and caching (`infrastructure/caching.js`) exist but are **NOT applied to any RPC**. They're dead code.

**Fix**: Create a `wrapRPC` middleware function and apply it during registration:

```javascript
function wrapRPC(handler, options) {
    return function(ctx, logger, nk, payload) {
        // 1. Rate limit check
        if (options.rateLimit) {
            var limit = checkRateLimit(ctx.userId, options.name, options.rateLimit.max, options.rateLimit.window);
            if (!limit.allowed) return errorResponse("RATE_LIMITED", "Try again in " + limit.retry_after + "s");
        }
        
        // 2. Cache check (reads only)
        if (options.cache && options.cache.read) {
            var cached = cacheGet(options.cache.keyFn(ctx, payload));
            if (cached) return cached;
        }
        
        // 3. GameID validation (if required)
        if (options.requireGameId) {
            var data = JSON.parse(payload || "{}");
            if (!data.gameId && !data.gameID && !data.gameUUID) {
                return errorResponse("MISSING_REQUIRED_FIELD", "gameId is required");
            }
        }
        
        // 4. Execute handler
        var result = handler(ctx, logger, nk, payload);
        
        // 5. Cache write (if successful)
        if (options.cache && options.cache.write) {
            var parsed = JSON.parse(result);
            if (parsed.success) cacheSet(options.cache.keyFn(ctx, payload), result, options.cache.ttl);
        }
        
        return result;
    };
}

// Usage:
initializer.registerRpc("wallet_get", wrapRPC(rpcWalletGet, {
    name: "wallet_get",
    rateLimit: { max: 200, window: 60 },
    cache: { read: true, write: true, ttl: 30, keyFn: CacheKeyGenerators.userGameKey },
    requireGameId: true
}));
```

**Impact**: Rate limiting and caching actually work. Currently zero RPCs use them.

---

### Gap 4: Game Registry Validation Missing

**Current state**: `parseAndValidateGamePayload()` only validates format (is it "quizverse", "lasttolive", or a UUID?). It does NOT check if the `gameUUID` is actually registered in the game registry.

**Fix**: Add game registry lookup in the validation:

```javascript
function validateGameExists(nk, gameId) {
    // Check game registry storage
    try {
        var records = nk.storageRead([{
            collection: "game_registry",
            key: gameId,
            userId: "00000000-0000-0000-0000-000000000000"  // system
        }]);
        return records && records.length > 0;
    } catch (e) {
        return false;
    }
}
```

**Impact**: Prevents data corruption from typos or unauthorized games sending data.

---

### Gap 5: Storage Key Collision Risk

**Current state**: Storage keys are `gameID + "_" + type` (e.g., `quizverse_wallets`). If a game is named `quiz_verse`, the collection becomes `quiz_verse_wallets` — safe. But if a game is named `quizverse_wallets`, it collides.

**Fix**: Use a separator that can't appear in gameIDs: `gameID + "::" + type` or hash the gameID.

**Impact**: Zero risk — change is internal and transparent. But do it BEFORE accepting arbitrary game UUIDs.

---

### Gap 6: No Deprecation Header in Old RPC Responses

**Current state**: Old RPCs will silently work forever. No way to know when all clients have migrated.

**Fix**: Old wrapper RPCs should inject a deprecation notice:

```javascript
function deprecatedWrapper(newHandler, oldName, newName) {
    return function(ctx, logger, nk, payload) {
        logger.warn("[DEPRECATED] " + oldName + " → use " + newName + " instead. User: " + ctx.userId);
        var result = JSON.parse(newHandler(ctx, logger, nk, payload));
        result._deprecated = true;
        result._migration = "Use '" + newName + "' instead of '" + oldName + "'";
        return JSON.stringify(result);
    };
}

// Registration:
initializer.registerRpc("quizverse_grant_currency", 
    deprecatedWrapper(rpcGameGrantCurrency, "quizverse_grant_currency", "game_grant_currency"));
```

**Impact**: Unity client logs show deprecation warnings. Can track migration progress by grep-ing logs for `[DEPRECATED]`.

---

## Cluster 1: Per-Game Copy-Paste RPCs (54 → 14 generic)

**Problem**: QuizVerse and LastToLive have **identical** RPCs with different prefixes. Adding a 3rd game = copy-pasting 27 more RPCs.

**Code evidence** (`multigame_rpcs.js` line 158-161):
```javascript
function lasttoliveUpdateUserProfile(context, logger, nk, payload) {
    // Reuse the same logic as QuizVerse
    return quizverseUpdateUserProfile(context, logger, nk, payload);
}
```

> All 14 LastToLive handlers are identical one-liner redirects. This confirms **100% duplication**.

### 27 Duplicate Pairs

| # | QuizVerse RPC | LastToLive RPC |
|---|---------------|----------------|
| 1 | `quizverse_update_user_profile` | `lasttolive_update_user_profile` |
| 2 | `quizverse_grant_currency` | `lasttolive_grant_currency` |
| 3 | `quizverse_spend_currency` | `lasttolive_spend_currency` |
| 4 | `quizverse_validate_purchase` | `lasttolive_validate_purchase` |
| 5 | `quizverse_list_inventory` | `lasttolive_list_inventory` |
| 6 | `quizverse_grant_item` | `lasttolive_grant_item` |
| 7 | `quizverse_consume_item` | `lasttolive_consume_item` |
| 8 | `quizverse_submit_score` | `lasttolive_submit_score` |
| 9 | `quizverse_get_leaderboard` | `lasttolive_get_leaderboard` |
| 10 | `quizverse_join_or_create_match` | `lasttolive_join_or_create_match` |
| 11 | `quizverse_claim_daily_reward` | `lasttolive_claim_daily_reward` |
| 12 | `quizverse_find_friends` | `lasttolive_find_friends` |
| 13 | `quizverse_save_player_data` | `lasttolive_save_player_data` |
| 14 | `quizverse_load_player_data` | `lasttolive_load_player_data` |
| 15 | `quizverse_get_item_catalog` | `lasttolive_get_item_catalog` |
| 16 | `quizverse_search_items` | `lasttolive_search_items` |
| 17 | `quizverse_refresh_server_cache` | `lasttolive_refresh_server_cache` |
| 18 | `quizverse_guild_create` | `lasttolive_guild_create` |
| 19 | `quizverse_guild_join` | `lasttolive_guild_join` |
| 20 | `quizverse_guild_leave` | `lasttolive_guild_leave` |
| 21 | `quizverse_guild_list` | `lasttolive_guild_list` |
| 22 | `quizverse_send_channel_message` | `lasttolive_send_channel_message` |
| 23 | `quizverse_log_event` | `lasttolive_log_event` |
| 24 | `quizverse_track_session_start` | `lasttolive_track_session_start` |
| 25 | `quizverse_track_session_end` | `lasttolive_track_session_end` |
| 26 | `quizverse_get_server_config` | `lasttolive_get_server_config` |
| 27 | `quizverse_admin_grant_item` | `lasttolive_admin_grant_item` |

### Merge Strategy

```
Phase 1: Create 14 generic RPCs (game_* prefix)
         They accept { gameId: "..." } — the generic parseAndValidateGamePayload() already does this!
         
Phase 2: Old RPCs → deprecatedWrapper() pointing to new generic ones
         Zero breaking change — clients don't notice

Phase 3: Update Unity SDK (IVXNakamaRPC.cs) to call generic RPCs

Phase 4: Remove old wrappers after 2 release cycles
```

> **Saves: 40 RPCs (54 → 14)**

---

## Cluster 2: Wallet Systems (22 → 8 unified)

**Problem**: 5 separate wallet modules with overlapping functionality.

| System | RPCs | Source |
|--------|------|--------|
| Copilot Wallet | `get_user_wallet`, `link_wallet_to_game`, `get_wallet_registry` | index.js |
| Enhanced Wallet | `wallet_get_all`, `wallet_update_global`, `wallet_update_game_wallet`, `wallet_transfer_between_game_wallets`, `wallet_get_balances` | wallet/wallet.js |
| Player Wallet | `create_player_wallet`, `update_wallet_balance`, `get_wallet_balance` | index.js |
| Per-Game Wallet | `*_grant_currency`, `*_spend_currency` (×2 games) | multigame_rpcs.js |
| Global Economy | `global_wallet_*` (8 RPCs) | quests_economy_bridge.js |

### Unified API (8 RPCs)

| Unified RPC | Replaces | Notes |
|-------------|----------|-------|
| `wallet_get` | 5 get RPCs | `{ gameId?, scope: "game\|global\|all" }` |
| `wallet_update` | 5 update RPCs | `{ gameId, currency, amount, op: "add\|subtract" }` |
| `wallet_transfer` | 2 transfer RPCs | `{ fromGameId, toGameId, currency, amount }` |
| `wallet_create` | 2 create RPCs | `{ gameId }` — idempotent |
| `wallet_history` | 1 history RPC | `{ gameId?, limit, cursor }` |
| `wallet_registry` | 1 registry RPC | `{ userId }` |
| `wallet_conversion_config` | 2 config RPCs | `{ action: "get\|set", config }` |
| `wallet_preview_convert` | 1 preview RPC | `{ fromGameId, toGameId, amount }` |

> **Saves: 14 RPCs**

---

## Cluster 3: Score Submission (8 → 2)

| Current RPC | Overlaps With |
|-------------|---------------|
| `submit_score_and_sync` | `submit_leaderboard_score`, `submit_score_sync` |
| `submit_score_with_aggregate` | `submit_score_and_sync` + stats |
| `submit_score_with_friends_sync` | `submit_score_and_sync` + friend board |
| `submit_score_to_time_periods` | `submit_score_and_sync` + time period |
| `quizverse_submit_score` (×2) | `submit_leaderboard_score` |
| `tournament_submit_score` | separate but similar pattern |

### Unified API (2 RPCs)

| Unified RPC | Payload |
|-------------|---------|
| `score_submit` | `{ gameId, score, leaderboardId?, flags: { sync, aggregate, friends, timePeriods, tournamentId } }` |
| `leaderboard_get` | `{ gameId, type: "global\|friends\|time_period", period?, limit?, cursor? }` |

> **Saves: 6 RPCs**

---

## Cluster 4: Profile / Metadata (6 → 2)

| Current RPC | Overlaps With |
|-------------|---------------|
| `rpc_update_player_metadata` | `quizverse_update_user_profile`, `check_geo_and_update_profile`, `rpc_change_username` |
| `get_player_metadata` | `get_player_portfolio` |

### Unified API

| Unified RPC | Payload |
|-------------|---------|
| `player_update` | `{ gameId?, metadata?, username?, geoCheck?: true }` |
| `player_get` | `{ gameId?, includePortfolio?: true }` |

> **Saves: 4 RPCs**

---

## Cluster 5: Challenge Systems (16 → 9)

Keep the **Async Challenge** system (9 RPCs) as the canonical one. Redirect:

| Redirect From | Redirect To |
|---------------|-------------|
| `friends_challenge_user` | `async_challenge_create` with `{ type: "friend" }` |
| `cross_game_challenge` | `async_challenge_create` with `{ type: "cross_game" }` |
| `daily_duo_create` | `async_challenge_create` with `{ type: "daily_duo" }` |
| `challenge_accept` | `async_challenge_join` |
| `challenge_decline` | `async_challenge_cancel` |
| `challenge_list` | `async_challenge_list` |
| `get_rivalry` / `daily_duo_status` | `async_challenge_stats` with `{ type }` filter |

> **Saves: 7 RPCs**

---

## Cluster 6: Daily Rewards / Welcome (6 → 2)

| Redirect From | Redirect To |
|---------------|-------------|
| `quizverse_claim_daily_reward` (×2 games) | `daily_rewards_claim` with `{ gameId }` |
| `retention_claim_welcome_bonus` | `welcome_bonus_claim` |
| `onboarding_claim_welcome_bonus` | `welcome_bonus_claim` |

> **Saves: 4 RPCs**

---

## Cluster 7: Analytics / Sessions (9 → 2)

| Redirect From | Redirect To |
|---------------|-------------|
| `quizverse_log_event`, `lasttolive_log_event` | `analytics_event` with `{ gameId }` |
| `*_track_session_start`, `*_track_session_end` | `analytics_session` with `{ gameId, action }` |
| `onboarding_track_session` | `analytics_session` with `{ type: "onboarding" }` |
| `winback_record_session` | `analytics_session` with `{ type: "winback" }` |

> **Saves: 7 RPCs**

---

## Cluster 8: Mastery / XP (3 → 1)

| Redirect From | Redirect To |
|---------------|-------------|
| `collections_add_mastery_xp` | `progression_add_xp` with `{ target: "collections" }` |
| `season_pass_add_xp` | `progression_add_xp` with `{ target: "season_pass" }` |
| `progression_add_mastery_xp` | `progression_add_xp` with `{ target: "mastery" }` |

> **Saves: 2 RPCs**

---

## Final Summary

| Cluster | Before | After | Saved |
|---------|--------|-------|-------|
| 1. Per-Game Copy-Paste | 54 | 14 | **40** |
| 2. Wallet Systems | 22 | 8 | **14** |
| 3. Score Submission | 8 | 2 | **6** |
| 4. Profile/Metadata | 6 | 2 | **4** |
| 5. Challenge Systems | 16 | 9 | **7** |
| 6. Daily Rewards | 6 | 2 | **4** |
| 7. Analytics/Sessions | 9 | 2 | **7** |
| 8. Mastery/XP | 3 | 1 | **2** |
| **TOTAL** | **124** | **40** | **84** |

> **Final RPC count: 187 - 84 = 103 RPCs**  
> **Reduction: 45%**

---

## Implementation Priority (Risk-Ordered)

| Phase | What | Risk | Effort | Prerequisite |
|-------|------|------|--------|-------------|
| **Phase 0** | Build infrastructure: `response.js`, `errorCodes.js`, `wrapRPC()`, `deprecatedWrapper()` | None | 1 day | None |
| **Phase 1** | Cluster 1 (Per-Game) + Cluster 7 (Analytics) | **Zero** — code already redirects | 1 day | Phase 0 |
| **Phase 2** | Cluster 4 (Profile) + Cluster 6 (Daily) + Cluster 8 (XP) | Low | 1 day | Phase 0 |
| **Phase 3** | Cluster 3 (Scores/Leaderboards) | Low | 2 days | Phase 0 |
| **Phase 4** | Cluster 5 (Challenges) | Medium | 2 days | Phase 0 |
| **Phase 5** | Cluster 2 (Wallets) — most complex | Medium | 3 days | Phase 0, testing |
| **Phase 6** | Remove deprecated wrappers | None | 1 day | After 2 releases |

---

## Safe Migration Checklist (Per Cluster)

```
[ ] 1. Create new generic RPC handler
[ ] 2. Write unit test for new handler
[ ] 3. Register new RPC in InitModule
[ ] 4. Convert old RPCs to deprecatedWrapper() → new handler
[ ] 5. Deploy to staging
[ ] 6. Test old RPCs still work (backward compat)
[ ] 7. Test new RPCs work
[ ] 8. Deploy to production
[ ] 9. Update Unity SDK (IVXNakamaRPC.cs) to call new RPCs
[ ] 10. Monitor old RPC traffic via [DEPRECATED] log grep
[ ] 11. Remove old wrappers when traffic = 0
```

> [!CAUTION]
> **Never skip step 4.** Old RPCs must redirect to new ones — never delete them outright. The Unity client may still have cached binaries calling old RPC names.

---

## Unity SDK Changes Required

After server-side merge, update `IVXNakamaRPC.cs`:

```csharp
// BEFORE: game-specific RPC names scattered everywhere
await client.RpcAsync(session, "quizverse_grant_currency", json);

// AFTER: generic RPC with gameId in payload
await client.RpcAsync(session, "game_grant_currency", json);
// Where json includes: { "gameId": "quizverse", "amount": 100 }
```

The `GameIdPayload` class in `IVXNakamaRPC.cs` already has the `gameId` field — so Unity-side changes are minimal (just update RPC name strings).

---

## Non-Goals (Explicitly Out of Scope)

- ❌ Changing the Nakama Go server core (`server/` directory)
- ❌ Changing the database schema
- ❌ Modifying any RPCs that are NOT duplicated (unique RPCs stay as-is)
- ❌ Changing the Docker infrastructure
- ❌ Adding new features — this is purely consolidation
