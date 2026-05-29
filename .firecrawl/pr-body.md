## Summary

Fixes 3 Satori Debugger rejections observed on 2026-05-25/2026-05-22, root-caused from the 2026-05-28 19:42 UTC Grafana error spike.

### Issues fixed

| Event | Reason | Fix |
|---|---|---|
| `winback_eligible` | `INVALID_NAME` | Event not registered in Satori taxonomy — run `satori_register_taxonomy` RPC (ops task, see below) |
| `preiap_nudge_eligible` | `INVALID_NAME` | Same as above |
| `gameStarted` | `INVALID_ID` | `sdSelfCheck()` and `rpcSatoriDiag()` used the all-zeros UUID `00000000-...-0000` — Satori rejects this as an invalid identity. Fixed to use `...0001`, the non-zero system sentinel already used by `analytics_segments.js` |

### Additional fixes in this PR

- **Removed dead `SD_BATCH_BUFFER`** from `satori_direct.js`: The Goja VM pool resets module-level state on every RPC call, so the buffer never actually accumulated events between calls. Every event was already being sent as a single-item HTTP request. The dead accumulate/sweep/flush logic was removed — `sdEnqueueOrFlush` now calls `sdEventsPublish` directly, which is what was happening implicitly before.

- **`push.ts` flushPending `logger.error` → `logger.warn`**: Per-user storage read errors in `flushPendingRegistrations()` were emitting `level=error` on every 30-minute scheduler tick for each device with a pending push registration failure. These are per-user transient errors, not system-level failures — demoted to `warn` so they no longer count toward the Grafana error-volume threshold.

## Files changed

| File | Change |
|---|---|
| `data/modules/satori_direct/satori_direct.js` | Fix INVALID_ID in `sdSelfCheck` + `rpcSatoriDiag`; remove dead `SD_BATCH_BUFFER` |
| `data/modules/src/legacy/push.ts` | `logger.error` → `logger.warn` in flushPending outer catch |
| `data/modules/index.js` | Regenerated bundle (tsc + postbuild.js, 1025 RPCs, 0 errors) |

## Post-deploy ops task (required)

After deploying, run the taxonomy registration RPC once to register `winback_eligible`, `preiap_nudge_eligible`, and all other canonical events in Satori:

```
POST /v2/rpc/satori_register_taxonomy
Body: { "dashboard_secret": "<DASHBOARD_SECRET>" }
```

This is idempotent and safe to run at any time.

## Test plan

- [ ] `satori_diag` RPC returns `ok: true` with no INVALID_ID rejection in Satori Debugger
- [ ] Run `satori_register_taxonomy` — all events return success
- [ ] Run `satori_segments_winback` — eligible users fire `winback_eligible` events without 400 rejection
- [ ] Nakama logs show no `logger.error` from push scheduler for per-user storage errors
- [ ] No new TypeScript compile errors (build output: 1025 RPCs confirmed)
