# Push — Metrics page: derive event metrics from the real analytics pipeline (2026-07-05)

**Repo:** nakama · **Branch:** master (direct push) · **Deploy:** CodePipeline `intelliverse-nakama`

## Problem

Admin → Metrics showed 0 / "No data points yet" for every custom event-derived
metric (`weak_topic_accuracy_lift`, `quiz_completion_rate`, `qa_test_metric`,
`streak_rescue_return_rate`) while the `legacy_*` builtins had real data
(legacy_dau 18, legacy_events 1.7K).

## Root cause (deep dive)

Two disconnected analytics pipelines:

1. **Satori capture path** (`satori_event` / `satori_events_batch` →
   `satori_events` collection → `SatoriMetrics.processEvent`). Custom metrics
   count ONLY from here. In prod this path receives just web/QR external
   events (`experiment_assigned`, `experiment_converted`, `app_open`,
   `sponsor_click`, `qr.scan`) — verified via the debugger ring buffer and a
   10K-record scan of `satori_events`: zero quiz/question/session events.
   The `satori_metrics` state collection contained only the `alerts` key —
   no metric had ever accumulated a single bucket.

2. **Legacy analytics path** (`analytics_log_event` →
   `analytics_events` + `analytics_live_daily.by_name` counters). The Unity
   game reports ALL real telemetry here — today's counters show
   `question_answered: 11`, `media_question_completed: 58`,
   `session_start: 17`. This pipeline never calls
   `SatoriMetrics.processEvent`, so the custom metrics never tick.

The Unity client has a tri-route (`SatoriService.CaptureEvent` →
`satori_events_batch`) in the codebase, but prod pods show zero
`satori_events_batch` invocations in 48h — the client integration isn't
flushing in the shipped build.

## Fix

`data/modules/src/satori/metrics/metrics.ts` — same pattern as the
`legacy_*` builtins ("all Satori admin surfaces read through
LegacyAnalytics"):

- `satori_metrics_query`: when a count-aggregation metric has **no capture
  buckets**, its value is derived from today's
  `analytics_live_daily.by_name[eventName]` counter.
- `satori_metrics_series`: same condition → daily series from
  `LegacyAnalytics.readRange` (default 30 days), response gains a
  `basis: "capture" | "legacy_by_name"` field.
- Count aggregation only — `by_name` stores plain per-day counters, so
  sum/avg/min/max/unique can't be derived from it. If the capture path ever
  starts receiving these events, real capture buckets take precedence
  automatically.

## Expected after deploy

| Metric | Event | Value source |
|---|---|---|
| weak_topic_accuracy_lift (Question Answers / day) | question_answered | ~11 today |
| quiz_completion_rate + qa_test_metric | media_question_completed | ~58 today |
| streak_rescue_return_rate | session_start | ~17 today |

## Verification

1. Admin → Metrics: tiles show non-zero values, chart renders a 30-day series.
2. `satori_metrics_series` response `basis` = `legacy_by_name` for these metrics.
