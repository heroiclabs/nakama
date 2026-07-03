# Multi-Pod Dispatch Race — CAS Lock on the Shared Scheduler

**Date:** 2026-07-01 · **Status:** merged & deployed (verified via CloudWatch)

## Symptom

A user received ~10 identical "new daily quiz" notifications in a burst.
This happened shortly after the push-delivery overhaul (PRs #211/#212) was
deployed.

## Root cause

The notification scheduler coordinates cron cadence across Nakama pods
through a shared storage row (`notification_scheduler` dispatch state). The
merged code wrote that row **without optimistic concurrency control** — the
`prevVersion` guard was effectively disabled — so at a cadence boundary every
pod read "task due", every pod dispatched, and every pod then wrote the state
row. N pods → N identical cron executions → N pushes per user (bounded only
by pod count and day-marker write races).

## Fix

Restored compare-and-swap semantics in `writeSharedDispatch`
(`notification_scheduler.ts`): the writer passes the version it read; Nakama
rejects the write if another pod committed first. The losing pods treat the
rejected write as "someone else owns this period" and skip dispatch. The
match loop was refactored so the CAS winner is decided **before** any cron
handler runs.

## Verification

- Live CloudWatch tail across all pods: exactly one `dispatching daily_quiz`
  line per 30-min period after deploy (previously one per pod).
- Duplicates reported afterwards had a different root cause (multi-account
  devices — see `2026-07-02-endpoint-dedup-daily-premium.md`).

## Files

- `data/modules/src/legacy/notification_scheduler.ts`
- `data/modules/index.js` (+ `build/`) — regenerated bundle
