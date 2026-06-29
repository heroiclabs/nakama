# Runbook — Push Delivery Fix (close-out)

Companion to the code fixes on this branch. Covers everything required to take
push from "firing but almost nobody receives it" to fully healthy, including the
manual (non-code) steps and the verification queries that close each issue.

Headline before the fix: push was technically firing but ~96% of device sends
failed at FCM (`UNREGISTERED`), and Nakama's own scheduled engagement pushes
sent ~0/72h.

---

## Issue → fix matrix

| # | Issue | Severity | Fix location | Manual step? |
|---|-------|----------|--------------|--------------|
| 1 | 96% FCM `UNREGISTERED` — dead tokens never pruned | P1 | `lambda-functions/send-push/index.mjs` (DeleteEndpoint), `data/modules/src/legacy/push.ts` (prune token rows) | **Yes — IAM** |
| 2 | Scheduled engagement pushes ~0 sent | P1 | `data/modules/src/legacy/notification_scheduler.ts` (shared-storage cadence) | No |
| 3 | `ad_revenue_record` (+ `fortune_wheel_ad_spin`, `quizverse_web_ad_reward`) "function invalid" | P2 | `*/ad-revenue-event.ts`, `*/fortune-wheel-ad-spin.ts`, `*/web-ad-reward.ts`, `main.ts` | No |
| 4 | `storage_user_id_fkey` violations (self-amplifying) | P2 | `data/modules/src/legacy/push.ts` (`userExists` guard) | No |
| 5 | EventEnricher `varchar(128)` overflow (SQLSTATE 22001) | P2 | `data/modules/src/analytics/event-enricher.ts` | No |
| — | Stale CommonJS Lambda duplicates (`send-push/index.js`, `register-endpoint/index.js`) — the register one silently dropped `fcmProjectId` | cleanup | deleted in this PR | No |

---

## Deploy order

1. **send-push Lambda** — package `index.mjs` + `fcm-direct.mjs` (handler `index.handler`) and deploy. Apply the IAM step below first or in the same change.
2. **register-endpoint Lambda** — re-package from `index.mjs` (handler `index.handler`). The stale `index.js` is removed in this PR; make sure your deploy artifact contains only `index.mjs`. This guarantees `fcmProjectId` is stored in the SNS endpoint `CustomUserData` at registration.
3. **Nakama image** — `cd data/modules && npm run build` (already committed here), then build/push the Docker image and roll the deployment. The image regenerates `index.js` from the committed `build/index.js`, so no `tsc` runs in-image.

---

## Manual step 1 (REQUIRED) — IAM: `sns:DeleteEndpoint`

Dead-endpoint pruning is the single biggest delivery win, but the Lambda can only
delete endpoints if its execution role allows it. The call is wrapped in
try/catch and **fails safe** (logs a warning, no-ops) — so without this grant the
fix appears deployed but does nothing.

- Policy is codified at `lambda-functions/send-push/iam-policy.json`.
- Apply it to the send-push Lambda execution role (console, CLI, or your IaC).
  Minimum addition to the existing role:

```json
{ "Effect": "Allow", "Action": "sns:DeleteEndpoint", "Resource": "arn:aws:sns:us-east-1:970547373533:*" }
```

Verify the grant took effect:

```
# CloudWatch Logs Insights — /aws/lambda/send
fields @timestamp, @message
| filter @message like /Deleted dead SNS endpoint/
| stats count() by bin(1h)
```
If this stays at 0 while `UNREGISTERED` errors continue, the IAM grant is missing
or the role wasn't updated.

---

## Manual step 2 (VERIFY) — Firebase project match

If `UNREGISTERED` 404s do **not** fall after pruning + a token-refresh cycle, the
registering Firebase project ≠ the project the send Lambda authenticates as.

- The send Lambda authenticates per-endpoint using `CustomUserData.fcmProjectId`,
  falling back to the `DEFAULT_FCM_PROJECT_ID` env var.
- Confirm `DEFAULT_FCM_PROJECT_ID` (and the per-endpoint `fcmProjectId` the client
  passes to `push_register_token`) equals the project that minted the device
  tokens (observed live: `quiz-verse-4a475`).
- Confirm a Secrets Manager secret exists at
  `firebase/service-account/<projectId>` for every project in use.
- A project mismatch manifests as mass `UNREGISTERED` even with healthy OAuth.

This is config/data, not code — that's why it's a manual verification.

---

## Verification (24–48h after deploy)

**#1 — FCM pruning**
```
# /aws/lambda/send — UNREGISTERED should bend down day-over-day; 200 OK share should rise from ~4%
fields @timestamp
| filter @message like /errorCode/ or @message like /FCM delivered/
| parse @message /errorCode=(?<code>[A-Z_]+)/
| stats count() by bin(1d), code
```
- "Deleted dead SNS endpoint" count climbs, then `UNREGISTERED`/`404` falls.
- The repeating-token signature (`dCAH9-cYQjeM8B_pYtQR…` every 30 min) stops after its first delete.

**#2 — scheduler cadence**
```
kubectl logs -l app=intelliverse-nakama --since=2h | grep "Dispatched daily_quiz"
```
- `[NotifScheduler] Dispatched daily_quiz` appears ~every 30 min (was 8×/72h in bursts).
- `[Push] push_send_event DONE … sentToDevices=N/M` with N>0 during 03:30–07:30 UTC (09:00–13:00 IST).
- Inspect coordination row: storage `notif_scheduler / dispatch_state_v1` — per-task minute advances steadily.

**#3 — RPC registration**
- `JavaScript runtime function invalid.` for `__rpc_ad_revenue_record` → 0 (was 163, all 06-28).
- Call `ad_revenue_record`, `fortune_wheel_ad_spin`, `quizverse_web_ad_reward` repeatedly across sessions → consistent success (no VM-pool flakiness).

**#4 — FK violations**
- `storage_user_id_fkey` violation count trends to ~0 (was 60→48→96/day).
- Look for `[Push] flushPending: dropping pending userId=… no such account`; "remaining pending users" shrinks, not grows.

**#5 — EventEnricher**
- `recordCoverageGap failed … SQLSTATE 22001` disappears (was ×6).

---

## Rollback

- **Lambda:** redeploy the previous zip. The `sns:DeleteEndpoint` IAM grant is
  harmless to leave in place.
- **Nakama:** redeploy the previous image tag. The scheduler coordination row is
  self-healing — old code simply ignores `notif_scheduler/dispatch_state_v1`.

---

## Out of scope (flagged, not in this PR)

- `src/research/research.ts(721)` TS1250 (function declaration in a block) — part
  of separate in-progress work, not on this branch; clean up separately.
- Wiring a caller for the dormant content-factory pipeline-alert sender (the
  matching token-removal hygiene there is in content-factory PR #103).
