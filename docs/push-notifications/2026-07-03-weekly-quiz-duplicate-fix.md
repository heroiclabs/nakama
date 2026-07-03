# Weekly Quiz Duplicate Fix + Weekly Discord Report

**Date:** 2026-07-03 · **PR:** [#240](https://github.com/intelli-verse-x/nakama/pull/240) · **Status:** merged & deployed (verified in pods 14:10 IST)

## Symptom

Users received 2–4 identical `weekly_quiz` pushes in one morning.
Send-Lambda logs for 2026-07-03 showed **79 endpoints** hit multiple times,
timestamped exactly one hourly cron run apart: `07:51, 08:51, 10:51, 11:51 IST`.

## Root cause

The weekly cron's per-day "already sent" marker key embedded the names of the
quiz types that changed **in that specific run**:

```ts
// BEFORE (push.ts, rpcNotifCronWeeklyQuiz)
var dayMarkerKey = "weekly_quiz_" + changedTypes.join("_");
```

Weekly quiz types (fortune, emoji, prediction, health, personal_finance) are
detected as changed at **different** hourly runs — S3 content for each type
lands at different times. So:

- 07:51 run detects `fortune` changed → marker `weekly_quiz_fortune` → push
- 08:51 run detects `emoji` changed → marker `weekly_quiz_emoji` → **no marker
  match** → pushes the *same users again*
- …repeat for every type that changes that day.

The notification copy is generic ("weekly quiz updated"), so users saw
identical notifications.

A second, smaller source: the same physical phone registered under multiple
accounts (guest + logged-in) received one push per account — the weekly cron
was not covered by the cross-account ARN dedup added for daily/premium in #237.

## Fix

1. Fixed day-marker key — max **one weekly push per user per day**, regardless
   of how many types change or across how many runs:

```ts
// AFTER
var dayMarkerKey = "weekly_quiz";
```

2. Threaded the shared `runDedupArns` / `runDedupStats` set into the weekly
   cron's `sendLocalizedPushToUser` calls (same mechanism as daily/premium).

3. **Weekly cron now posts a Discord report** ("📚 Weekly Quiz" embed with
   sent/gated/locale breakdown + suppressed-duplicate count). Before this it
   posted nothing — on days when daily-quiz content was late, the channel
   showed only "Sent 0" reports while weekly pushes were actually going out,
   which looked like a discrepancy. Reports post only on runs that detected
   content changes (the cron fires hourly; no-op runs stay silent).

## Files

- `data/modules/src/legacy/push.ts` — marker key, dedup wiring, report call
- `data/modules/index.js` (+ `build/`) — regenerated bundle

## Verification

- Bundle greps confirmed old key gone / new key present.
- Post-deploy pod check: `kubectl exec … grep 'cronName: "weekly_quiz"' /nakama/data/modules/index.js` → present.
