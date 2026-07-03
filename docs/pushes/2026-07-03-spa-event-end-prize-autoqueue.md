# Push — Queue prize winners the moment a SPA live event ends (2026-07-03)

**Repos:** nakama (new RPC) + Quizverse-web-frontend (SPA hook)
**Branch:** master / main (direct push)
**Deploy:** CodePipelines `intelliverse-nakama` + `intelliverse-quiz-frontend`

## Problem

When a creator ended a live event from the SPA (`quizverse-live-events.html`),
`_evEnd()` only flipped `status: "ended"` with a direct storage write. Winners
(ranks 1–5 gift-card tiers) were never computed, so the admin **Live Event
Prizes** page stayed empty until a player self-claimed or someone ran
`admin_creator_events_backfill_prizes` manually. This bit us on 2026-07-02
(LiveX) and again on 2026-07-03 (all "Testing … July 3" events).

The server-side `creator_event_end` RPC does auto-queue winners, but it only
reads the system-owned `satori_creator_events` collection — SPA events live in
the creator-owned `live_events` collection, so that path never fires for them.

## Fix (two layers)

1. **Instant (event-driven)** — new Nakama RPC `creator_event_spa_end_queue`
   (`data/modules/src/satori/live-events/creator-event-live.ts`):
   - caller must own the `live_events` record (creator-only)
   - event must already be `ended`
   - runs the existing `computeAndQueueWinners` (rank by score desc /
     submit-time asc, queue `prize_fulfillments` rows for gift-card tiers,
     count XUT tiers separately) — idempotent per (event, user)

   The SPA's `_evEnd()` now calls this RPC right after its end-write, so
   ranks appear on the admin Live Event Prizes page immediately.

2. **Backstop (cron)** — `live-events-prize-backfill` CronJob
   (`intelli-verse-kube-infra/nakama/live-events-prize-backfill-cron.yaml`,
   applied to `aicart`, every 10 min) runs the full backfill for events that
   end without the hook (time-expired events, RPC failures, old events).

## Files

| Repo | Path | Change |
|---|---|---|
| nakama | `data/modules/src/satori/live-events/creator-event-live.ts` | `rpcSpaEndQueue` + registration |
| nakama | `data/modules/index.js` | regenerated bundle |
| Quizverse-web-frontend | `web/public/quizverse-live-events.html` | `_evEnd()` calls `creator_event_spa_end_queue` (non-fatal on error) |
| intelli-verse-kube-infra | `nakama/live-events-prize-backfill-cron.yaml` | 10-min backfill CronJob (shipped earlier same day) |

## Verification

1. Create a SPA live event with a gift-card prize pool, have 2+ players answer.
2. End the event from the creator dashboard.
3. Admin → Live Event Prizes shows pending rows for ranks 1..N within seconds
   (no backfill needed).
4. Re-ending / re-calling the RPC does not duplicate rows (skippedExisting).
