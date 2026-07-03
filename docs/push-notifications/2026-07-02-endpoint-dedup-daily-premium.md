# Cross-Account Device Dedup for Daily/Premium Crons + Honest Cron Reports

**Date:** 2026-07-02 · **PR:** [#237](https://github.com/intelli-verse-x/nakama/pull/237) · **Status:** merged & deployed

## Symptom

Users reported "2 times daily quiz, 2 times premium quiz" — duplicates
persisted even after the multi-pod CAS dispatch fix was live and verified.

## Root cause

Send-log audit for 2026-07-02 found **96 SNS endpoint ARNs registered under
multiple user accounts** (~174 duplicate deliveries/day). One physical phone
plays as a guest, then logs in — the same FCM token/endpoint is re-registered
under the new account. Per-user day-markers cannot see this: each account is
"sent once", but the phone hears about it twice.

## Fix

In-run **endpoint-ARN dedup**: each cron run carries one shared set
(`runDedupArns`) through every `sendLocalizedPushToUser` call. An ARN that was
already pushed this run is skipped for later users; a `skippedDevices` counter
(`runDedupStats`) feeds the Discord report.

```ts
// push.ts — inside sendLocalizedPushToUser (opts.dedupArns supplied by crons)
if (darn && opts.dedupArns[darn]) { opts.dedupStats.skippedDevices++; continue; }
```

Wired into `rpcNotifCronDailyQuiz` and `rpcNotifCronPremiumDailyQuiz`.
(Weekly + remaining crons were covered in the follow-ups on 2026-07-03.)

## Discord report improvements (same PR)

- "Zero sends despite quiz present" no longer raises a false alarm when every
  scanned user is simply outside their local send window — it now says sends
  resume when windows open.
- New health line: `🔁 N duplicate device deliveries suppressed (same phone
  under multiple accounts)`.
- Quiet-hours gate label now states the real windows (daily 09–13 / premium
  17–21 local).

## Files

- `data/modules/src/legacy/push.ts`
- `data/modules/src/legacy/push-alerts.ts` (`CronStats.dedupedDevices`, embed)
- `data/modules/index.js` (+ `build/`) — regenerated bundle

## Known follow-up (fixed 2026-07-03)

Returning `false` for fully-deduped users skipped their day-marker, letting
the *next* run re-send to the same phone via the co-owner account. See
`2026-07-03-all-crons-dedup-and-reports.md`.
