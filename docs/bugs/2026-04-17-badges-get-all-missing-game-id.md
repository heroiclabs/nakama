# BUG: `badges_get_all` RPC errors with "game_id is required"

**Filed:** 2026-04-17
**Severity:** P3 (client contract / spammy errors in prod logs)
**Owner:** Badges module owner + client team
**Affects:** intelliverse-nakama prod, fires on every client call missing `game_id`

---

## Symptom

Repeated ERRORs in server logs:

```
[Badges] Get all error: game_id is required
```

These correspond to client RPC invocations of `badges_get_all` (and
related badge RPCs) where the request payload omits `game_id`.

## Root cause (compiled JS)

`data/modules/badges/badges.js` enforces the field at multiple entry
points, e.g. lines 54–55 and 619–620:

```js
if (!data.game_id) {
    throw Error("game_id is required");
}
```

The validation itself is correct — the badges system is per-game and
there is no sane fallback. The bug is on the **caller** side: at least
one client (or another server module forwarding to it) is sending
`badges_get_all` without `game_id`.

## What we need from each owner

### Badges module owner
1. Confirm the field is actually mandatory for *every* badge RPC, or
   define a default (e.g. read `game_id` from the user's current
   session metadata) so well-behaved clients don't have to pass it.
2. If mandatory, downgrade the log line from `error` to `warn` — this
   is a client contract violation, not a server fault, and it is
   currently polluting alerting dashboards.

   ```js
   logger.warn("[Badges] get_all called without game_id by user=" + ctx.userId);
   ```

### Client team
1. Audit every call site of `badges_get_all`, `badges_get_user`,
   `badges_claim`, etc. Ensure `game_id` is included in the payload.
2. The full list of guarded entry points is:
   `data/modules/badges/badges.js` lines 54, 619 (and any other
   `if (!data.game_id)` matches you see in the file).

## Reproduce

```bash
kubectl logs deploy/intelliverse-nakama -n aicart --tail=400 | grep -i 'Badges'
```

## Acceptance

- Server logs no longer contain `[Badges] Get all error: game_id is required`
  during steady-state traffic, **OR** the message has been demoted to `warn`
  with the offending `userId` included for client-side debugging.
