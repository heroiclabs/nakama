# Push Notification Fixes — July 2026

Index of the push-notification incident work done across 2026-07-01 → 2026-07-03.
One file per task, newest first.

| Date | Task | Status | PR |
|---|---|---|---|
| 2026-07-03 | [Co-owner day-marker fix + dedup & Discord reports for ALL crons](./2026-07-03-all-crons-dedup-and-reports.md) | Shipped | `fix/push-all-crons-dedup-reports` |
| 2026-07-03 | [Weekly quiz duplicate fix + weekly Discord report](./2026-07-03-weekly-quiz-duplicate-fix.md) | Merged + deployed | [#240](https://github.com/intelli-verse-x/nakama/pull/240) |
| 2026-07-03 | [India daily-quiz gap — content generation timing](./2026-07-03-india-daily-quiz-content-timing.md) | Open (AI service) | — |
| 2026-07-02 | [Cross-account device dedup for daily/premium crons](./2026-07-02-endpoint-dedup-daily-premium.md) | Merged + deployed | [#237](https://github.com/intelli-verse-x/nakama/pull/237) |
| 2026-07-01 | [Multi-pod dispatch race — CAS lock on shared scheduler](./2026-07-01-scheduler-cas-dispatch-lock.md) | Merged + deployed | — |

## System overview (for new readers)

- All scheduled pushes are driven by `data/modules/src/legacy/push.ts`
  (9 cron RPCs: daily_quiz, premium_daily_quiz, weekly_quiz, idle_winback,
  streak_warning, motivation, reminders, review_due, survey_invite).
- Cadence/coordination lives in `notification_scheduler.ts` — one shared
  storage row with optimistic-lock (CAS) decides which pod dispatches.
- Delivery goes Nakama → `send` Lambda → AWS SNS platform endpoint → FCM/APNs.
- Discord reporting is in `push-alerts.ts` (`PushAlerts.postCronReport`),
  posting to the `nakama-cron-reports` webhook.

## Dedup layers (all must hold to avoid duplicates)

1. **CAS dispatch lock** — only one pod fires a cron per period.
2. **Per-platform endpoint dedup** — a user with stale re-registered tokens
   gets pushed only on the newest endpoint per platform.
3. **In-run cross-account ARN dedup** — one physical phone registered under
   2+ accounts is pushed once per cron run (`runDedupArns`).
4. **Per-user day-markers** — `notif_send_markers` caps each event type to
   once per user per day; co-owner accounts of an already-pushed device also
   get marked (see 2026-07-03 all-crons doc).
