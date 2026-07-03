# India Daily-Quiz Gap — Content Generation Lands After the Send Window

**Date:** 2026-07-03 · **Status:** OPEN — fix belongs to the Intelliverse-X-AI service, not Nakama

## Symptom

India users repeatedly report no daily-quiz push, while Discord cron reports
show `Sent 0 — quiz file missing in S3` all morning. This is **not** a push
bug: the pushes are correctly gated because there is nothing to announce.

## Timeline (2026-07-03, IST)

| Time | Event |
|---|---|
| 08:00 | AI service queues `generate-daily-quiz` Bull job (job 18) |
| 08:00–12:00 | Job hangs at progress 5 and hits the 55-min timeout **twice** (vLLM pods churning / cold-start; LiteLLM virtual-key 401 on one fallback path) |
| 11:30 | Second job (19) queued |
| 13:00 | India send window (09:00–13:00 local) **closes** |
| 13:06 | `dailyquiz-2026-07-03.json` finally lands in S3 — 6 minutes too late |
| 13:23+ | Premium per-language files land (evening premium window unaffected) |

On 2026-07-02 the file landed 09:43 IST — India got barely 3 hours of its
4-hour window. The schedule has no slack: any generation retry pushes the
file past 13:00 IST and India misses the whole day.

## Why USA is unaffected

The USA morning window (09:00–13:00 local ≈ 18:30–22:30 IST) opens ~9 hours
after the generation job starts, so even a slow day delivers in time.

## Recommended fix (AI service / scheduler-owner)

1. **Move the daily generation trigger from 08:00 IST to 05:30–06:00 IST**
   so two full retry cycles still finish before 09:00 IST.
2. Optional hardening:
   - Alert (Discord) when the job's first attempt fails — today the failure
     was silent until users complained.
   - Investigate the recurring 55-min timeouts: vLLM cold-start warm-up
     exhaustion and a LiteLLM proxy 401 (`Invalid proxy server token`) were
     both observed in `intelliverse-ai` pod logs on 2026-07-03.

## Where the pieces live

- Generation: `Intelliverse-X-AI` → `src/quiz/processors/daily-quiz-job.processor.ts`
  (Bull queue `daily-quiz-generation`, 55-min timeout, 3 attempts)
- Trigger: HTTP call to the quiz controller (external scheduler, ~08:00 IST)
- Output: `s3://intelli-verse-x-media/quiz-verse/daily/dailyquiz-<date>.json`
  (+ `dailyquiz-prem-<lang>-<date>.json`)
- Consumer: Nakama `rpcNotifCronDailyQuiz` reads the file every 30 min and
  fans out to users inside their local 09:00–13:00 window.
