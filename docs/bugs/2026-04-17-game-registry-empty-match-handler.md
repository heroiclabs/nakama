# BUG: GameRegistry "Failed to setup scheduled sync" on every server boot

**Filed:** 2026-04-17
**Severity:** P3 (non-fatal, log-spam, scheduled job never runs)
**Owner:** GameRegistry module owner
**Affects:** intelliverse-nakama prod, every restart

---

## Symptom

On every Nakama process start, the following ERROR appears in the server log:

```
[GameRegistry] Failed to setup scheduled sync:
  js match handler "matchInit" function for module "" global id could not be extracted: not found
```

Consequence: the daily game-registry sync job is never registered, so cached
game metadata drifts until someone manually invokes `sync_game_registry` RPC.

## Root cause (compiled JS)

`data/modules/legacy_runtime.js` (lines 23805–23821) calls

```js
initializer.registerMatch('', {
    matchInit: emptyMatchInit,
    matchJoinAttempt: emptyMatchJoinAttempt,
    matchJoin: emptyMatchJoin,
    matchLeave: emptyMatchLeave,
    matchLoop: emptyMatchLoop,
    matchTerminate: emptyMatchTerminate,
    matchSignal: emptyMatchSignal
});
```

The first argument to `registerMatch` is the **module name** that Nakama's
JS runtime uses to look up handler functions. An empty string causes
Nakama's AST walker to fail at boot ("global id could not be extracted"),
which throws and aborts the surrounding `try` block before the cron
expression is registered.

This same code is concatenated into the deployed `data/modules/index.js`
by `data/modules/postbuild.js`, which merges `legacy_runtime.js` with the
TypeScript output as a separate, hand-written bundle.

## Why the fix isn't already in place

`data/modules/src/legacy/game-registry.ts` (lines 79–83) — the *current*
TypeScript source — only registers RPCs and contains **no `registerMatch`
call and no scheduling code at all**:

```ts
export function register(initializer: nkruntime.Initializer): void {
  initializer.registerRpc("get_game_registry", rpcGetGameRegistry);
  initializer.registerRpc("get_game_by_id",   rpcGetGameById);
  initializer.registerRpc("sync_game_registry", rpcSyncGameRegistry);
}
```

So the buggy code lives **only** in `legacy_runtime.js`, which is treated
by `postbuild.js` as a separate legacy bundle and is never re-derived from
the `src/` tree. It is stale.

## Reproduce

```bash
kubectl logs deploy/intelliverse-nakama -n aicart --tail=400 | grep -i 'GameRegistry'
```

You will see the error within ~1s of pod start.

## Proposed fix (pick one)

### Option A — Delete the legacy code (preferred)

The TypeScript already replaces this functionality. Remove the entire
`registerMatch('', {...})` block from `data/modules/legacy_runtime.js`
(lines ~23805–23814) and the surrounding `try/catch` if it becomes empty.

If the daily sync is still wanted, add a proper `registerCron(...)` call
to `src/legacy/game-registry.ts` instead.

### Option B — Give the match handler a non-empty name

If the match-handler registration is intentional (e.g. it's a heartbeat
match), change the first arg from `''` to a valid identifier such as
`'game_registry_heartbeat'`, and ensure the corresponding global function
is exported.

## Acceptance

- `kubectl logs ... | grep 'GameRegistry'` shows no errors after restart
- Either the cron is registered (verify via console) OR the dead code
  is removed entirely
