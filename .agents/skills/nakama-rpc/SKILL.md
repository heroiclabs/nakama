---
name: nakama-rpc
description: Register, implement, and debug RPCs in the Nakama TypeScript/JS runtime.
version: "1.0"
---

## When to Use
Keywords: `rpc`, `registerRpc`, `register`, `endpoint`, `handler`, `ctx`, `payload`, `hook`, `before`, `after`, `initializer`

## Architecture — How RPCs Work in THIS Project

```
data/modules/src/**/*.ts   ← TypeScript source (author here)
    ↓  npm run build (tsc + postbuild.js)
data/modules/build/index.js ← compiled TS
    ↓  postbuild.js v2
data/modules/index.js       ← FINAL merged bundle (1018+ RPCs, NEVER hand-edit)
    ↓  Docker volume mount → /nakama/data/data/modules/index.js
Nakama goja VM              ← loads index.js at startup
```

## postbuild.js v2 — Critical Knowledge

`postbuild.js` works around Nakama's AST walker limitation:
- Nakama's `getRegisteredFnIdentifier` ONLY sees **direct** `registerRpc(...)` calls inside `InitModule` body
- postbuild.js scans all JS files, rewrites every `registerRpc("id", handler)` → `__rpc_<id> = handler`
- It generates a NEW `InitModule` wrapper with **direct** `registerRpc` calls for each `__rpc_*` var
- All JS modules in `data/modules/` (excluding `node_modules/`, `build/`, `src/`) are merged

## RPC Naming Convention

```typescript
// Pattern: __rpc_{game}_{action}  (set by postbuild, NOT by you)
// Your source registration:
initializer.registerRpc('quizverse_get_leaderboard', rpcGetLeaderboard);
// postbuild turns this into:
var __rpc_quizverse_get_leaderboard;
// then in the generated InitModule:
initializer.registerRpc('quizverse_get_leaderboard', __rpc_quizverse_get_leaderboard);
```

Prefix convention:
- `quizverse_*`   — QuizVerse game RPCs
- `lasttolive_*`  — Last To Live game RPCs
- `ai_pipeline_*` — AI pipeline RPCs
- `analytics_*`   — analytics/metrics RPCs
- No prefix       — shared platform RPCs

## Implementing an RPC (TypeScript)

```typescript
// In data/modules/src/<domain>/<domain>.ts

// Functions MUST be in global scope (not arrow functions assigned to vars)
function rpcMyAction(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  // Parse input
  if (!payload || payload === '') {
    throw new Error(JSON.stringify({ code: 3, message: 'payload required' }));
  }
  const req = JSON.parse(payload) as { userId: string };

  // Use ctx for caller identity
  const callerId = ctx.userId;       // authenticated user
  const gameId   = ctx.env['DEFAULT_GAME_ID'];  // env var via --runtime.env

  // Use nk for Nakama APIs
  const accounts = nk.usersGetId([req.userId]);
  return JSON.stringify({ found: accounts.length > 0 });
}

// Register in InitModule (postbuild will detect and wrap this)
function InitModule(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
): Error | void {
  initializer.registerRpc('quizverse_my_action', rpcMyAction);
}
```

## Before / After Hooks

```typescript
// Before hook: intercept & mutate request (or throw to reject)
const beforeAuthenticateCustom: nkruntime.BeforeHookFunction<nkruntime.AuthenticateCustomRequest> =
  (ctx, logger, nk, data) => {
    const pattern = /^cid-([0-9]{6})$/;
    if (!pattern.test(data.account.id)) {
      throw new Error(JSON.stringify({ code: 3, message: 'invalid id format' }));
    }
    return data; // must return mutated data
  };

// After hook: observe result, side-effects only, no return value
const afterAuthenticateCustom: nkruntime.AfterHookFunction<...> = (ctx, logger, nk, out, data) => {
  logger.info('auth completed for %s', ctx.userId);
};

// Register in InitModule
initializer.registerBeforeAuthenticateCustom(beforeAuthenticateCustom);
initializer.registerAfterAuthenticateCustom(afterAuthenticateCustom);
```

## Context Object (`ctx`) — Key Fields

| Field | Type | Notes |
|-------|------|-------|
| `ctx.userId` | string | caller's user ID (empty for server-to-server) |
| `ctx.username` | string | caller's username |
| `ctx.env` | Record<string,string> | vars passed via `--runtime.env KEY=VALUE` |
| `ctx.sessionId` | string | session token |
| `ctx.clientIp` | string | client IP |

## Error Codes (gRPC/Nakama standard)

| Code | Name | Use When |
|------|------|----------|
| 2 | UNKNOWN | unexpected server error |
| 3 | INVALID_ARGUMENT | bad payload/params |
| 5 | NOT_FOUND | resource doesn't exist |
| 7 | PERMISSION_DENIED | auth ok but not allowed |
| 16 | UNAUTHENTICATED | missing/invalid auth |

```typescript
// Always throw with JSON-encoded error body:
throw new Error(JSON.stringify({ code: 3, message: 'userId required' }));
```

## Hook Registration Quick-Ref

```typescript
initializer.registerRpc('rpc_id', rpcFunction);
initializer.registerBeforeAddFriends(beforeFn);
initializer.registerAfterAddFriends(afterFn);
initializer.registerMatchmakerMatched(matchmakerFn);
initializer.registerLeaderboardReset(leaderboardResetFn);
initializer.registerTournamentReset(tournamentResetFn);
initializer.registerTournamentEnd(tournamentEndFn);
initializer.registerShutdown(shutdownFn);
initializer.registerRtBefore(msgId, rtBeforeFn);
initializer.registerRtAfter(msgId, rtAfterFn);
```

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `RPC not found` | postbuild didn't detect it | Ensure registerRpc is a direct call inside InitModule, not wrapped in a helper |
| `TypeError: Object has no member` | nakama-runtime version mismatch | Check compatibility matrix; update `package.json` |
| `ctx.env['KEY'] is undefined` | var not in `--runtime.env` list | Add KEY to `RUNTIME_ENV_KEYS` block in `docker-compose.yml` entrypoint |
| `parse error` | payload not JSON | Always `JSON.parse(payload)` and guard empty string |
| Global variable used as state | goja VM pool resets context | Never store state in module-level vars; use Nakama storage |

## Context Files (load only if needed)
- All RPCs: `docs/COMPLETE_RPC_REFERENCE.md` (grep only — large)
- Module system: `data/modules/postbuild.js` (lines 1-80)
- Any domain module: `data/modules/<domain>/`
- Main bundle: `data/modules/index.js` (grep only — 10K+ lines)
