# Device Dedup + Discord Reporting for All Push Crons, and the Co-Owner Day-Marker Fix

**Date:** 2026-07-03 · **Branch:** `fix/push-all-crons-dedup-reports` · **Status:** pushed, PR pending merge

## Part 1 — Co-owner day-marker fix (the "20-minute duplicate")

### Symptom

After the in-run ARN dedup (#237/#240) was live, send logs on 2026-07-03
afternoon still showed **73 duplicate (endpoint, event) pairs** — but the two
sends were now ~20 minutes apart (`14:30` and `14:49 IST`), i.e. exactly one
30-minute cron period, no longer within the same run.

### Root cause

`sendLocalizedPushToUser` returned `false` when the in-run dedup filtered out
*all* of a user's devices (because the same phone was already pushed via a
different account earlier in the run). The cron treats `false` as "gated" and
**does not record the user's day-marker**. On the next run 20–30 min later,
that co-owner account had no marker, its device wasn't yet in the fresh
per-run dedup set → the same phone got pushed again. The in-run dedup merely
postponed the duplicate by one run.

### Fix

When the dedup filter leaves zero deliverable devices, return `true` so the
calling cron records the day-marker for that account. The device *has*
today's notification — that is the semantic the marker tracks.

```ts
// push.ts, sendLocalizedPushToUser
deliverable = unseen;
if (deliverable.length === 0) return true;   // was: return false
```

## Part 2 — Dedup + reporting parity for the remaining 6 crons

Audit of all 9 push types found the cross-account device dedup and Discord
reporting only covered daily/premium/weekly:

| Push type | Once/day cap | Local window | Device dedup | Discord report |
|---|---|---|---|---|
| daily_quiz | ✅ | 09–13 | ✅ (#237) | ✅ |
| premium_daily_quiz | ✅ | 17–21 | ✅ (#237) | ✅ |
| weekly_quiz | ✅ (#240) | 10–20 | ✅ (#240) | ✅ (#240) |
| idle_winback | ✅ | 11–19 | ✅ **this PR** | ✅ **this PR** |
| streak_warning | ✅ | 18–22 | ✅ **this PR** | ✅ **this PR** |
| motivation | ✅ 3-day throttle | 12–18 | ✅ **this PR** | ✅ **this PR** |
| reminders | ✅ per-reminder | user-set time | ✅ **this PR** | ✅ **this PR** |
| review_due | ✅ | 17–21 | ✅ **this PR** | ✅ **this PR** |
| survey_invite (manual) | ✅ per-campaign | quiet hours | ✅ **this PR** | n/a (returns stats to caller) |

Reporting rule for the low-volume crons: post the embed **only when the run
actually delivered** (`sent > 0` or duplicates suppressed). These crons fire
every 5–60 minutes; an all-gated zero-send embed each run would drown
`#nakama-cron-reports`.

## Files

- `data/modules/src/legacy/push.ts` — all changes
- `data/modules/index.js` (+ `build/`) — regenerated bundle

## Verification

- Bundle contains 9 `dedupArns: runDedupArns` send sites and report calls for
  all five newly-reporting crons.
- Post-deploy check (outstanding): no endpoint should appear twice for the
  same eventType in send-Lambda logs across an entire day.
