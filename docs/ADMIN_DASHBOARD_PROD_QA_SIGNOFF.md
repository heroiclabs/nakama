# Admin Dashboard Production QA Sign-Off

Date: 2026-04-25

## Verdict

Production sign-off for the hardened `/admin-dashboard` operator console.

The critical security gap is closed: the public browser no longer receives Nakama HTTP/server keys, the app is login-gated, and proxy API routes reject unauthenticated requests. Core LiveOps reads/writes for QuizVerse fixtures were verified in production with `ivx_qa_` objects, including audience-targeted Satori message delivery into a player inbox.

## Deployment Evidence

| Component | Result |
| --- | --- |
| Nakama runtime | Rolled to `970547373533.dkr.ecr.us-east-1.amazonaws.com/intelliverse-nakama:3.0.0-push-notification-dryrun-20260425` |
| Admin dashboard proxy | Rolled to immutable `970547373533.dkr.ecr.us-east-1.amazonaws.com/nakama-admin-dashboard:edge-hardening-20260425` |
| Public dashboard route | `GET /admin-dashboard/` returns HTTP 200 |
| Proxy auth guard | `POST /admin-dashboard/api/rpc/admin_health_check` without token returns HTTP 401 |
| Built asset secret scan | No matches for `defaulthttpkey`, `defaultkey`, `NAKAMA_HTTP_KEY`, `NAKAMA_SERVER_KEY`, or `DASHBOARD_SECRET` |
| Edge hardening dry run | Malformed static path returns HTTP 400; proxy RPC without token returns HTTP 401 |

## Build And Static Checks

| Check | Status |
| --- | --- |
| `npm run build` in `data/modules` | Pass |
| `pnpm --filter @nakama/admin build` in `web` | Pass |
| Recently edited file lints | Pass |
| Admin browser secret scan | Pass |
| Production rollout | Pass |
| End-to-end dry run | Pass |
| Push notification readiness dry run | Nakama inbox path passes; real FCM/APNs device delivery is not signed off |

## Feature Matrix

| Capability | QA Status | Evidence |
| --- | --- | --- |
| Login gate | Pass | Public app loads; proxy RPCs reject missing bearer token with 401 |
| Admin health/dashboard overview | Pass | `admin_health_check` through proxy returns HTTP 200 |
| Hiro config editor | Pass | `admin_config_get`/`admin_config_set` through proxy verified for `challenges` and `incentives` |
| Satori config editor | Pass | `satori_config_get`/`satori_config_set` through proxy verified |
| Feature flags | Pass | `ivx_qa_quizverse_flag` seeded via admin path and visible from player `satori_flags_get_all` |
| Live events | Pass | `ivx_qa_quizverse_event` seeded via admin path and visible from player `satori_live_events_list` |
| Experiments | Pass | `ivx_qa_quizverse_experiment` seeded via admin path and visible from player `satori_experiments_get_all` |
| Hiro challenges | Pass | `ivx_qa_quizverse_challenge` seeded and visible from player `hiro_challenges_list` |
| Hiro incentives | Pass | QA incentives config seeded and visible from player `hiro_incentives_list` |
| Satori messages admin list | Pass | `admin_satori_messages_list` through proxy returns HTTP 200 |
| Satori player message delivery | Pass | Production QA created an include-list audience for user `dd4e32dc-fb37-44a4-827c-a228eb9f96e5`, broadcast `ivx_qa_satori_msg_delivery_message_1777151989`, verified `delivered=1`, confirmed the inbox item via `satori_messages_list`, then deleted the inbox item and restored temporary config objects. |
| Repeat Satori delivery dry run | Pass | Production dry run delivered `ivx_qa_dryrun_msg_1777152246` to user `78d2990b-2592-4613-84e3-6e1de4d5d47b`, confirmed inbox item `b18df3ce-aedc-497e-9839-a95c19227433`, then deleted the inbox item and restored temporary config objects. |
| Accounts/players/storage/matches/logs/economy/retention pages | Pass | Shared HTTP client proxies console HTTP calls server-side. Safe reads and guarded operator flows are verified; destructive actions remain restricted by UI guardrails and QA-user-only policy. |
| Analytics hub | Pass | Existing analytics tabs build and proxy calls succeed; Game Intelligence tab is wired to production `quizverse_game_intelligence_report` RPC and renders health, wins/problems, segment insights, risks, and ranked actions. |
| Game Intelligence report | Pass | Production RPC smoke test returned `health_score=100`, configured flags/events/experiments/audiences/challenges/incentives, 618 analytics event storage samples, and no runtime RPC errors in the sampled window. |
| Legacy analytics | Pass | Still available under `/admin-dashboard/legacy-analytics/`; primary operator workflow is the authenticated React analytics UI. |
| Nakama push/inbox notifications | Pass | Production dry run created QA user `c94b42bf-8903-413f-a900-2f75343f4d32`, registered an Android token through `push_register_token`, confirmed `push_get_endpoints` returned that token, sent `qa_real_push_readiness` through `push_send_event`, and confirmed the event in `/v2/notification`. |
| Real FCM/APNs device push | Not signed off | QuizVerse has `FCMManager` and `PushNotifications.RegisterToken` wiring, but no `google-services.json` or `GoogleService-Info.plist` was present in the Unity project, the live Nakama deployment has no `PUSH_LAMBDA_URL`/`PUSH_SEND_URL` env values or push provider Kubernetes secret, and the active production `push_register_token` RPC stores raw tokens in Nakama storage rather than creating SNS endpoint ARNs. AWS SNS has Android/Web platform applications, but APNs was not present and current AWS permissions did not allow endpoint or Lambda Function URL inspection. |

## Operational Guardrails

- Console HTTP proxy credentials are optional in deployment; pages that rely on Nakama console HTTP APIs require the `nakama-console-secret` values to be present.
- Destructive production account deletion, wallet reset, and storage delete are intentionally not part of routine sign-off. They are guarded in UI and should remain restricted to clearly labeled QA users only.
- `ivx_qa_` flag, event, experiment, challenge, and incentive fixtures remain intentionally available as reusable production QA fixtures.
- Satori/Nakama inbox messages are the signed-off production messaging path. Real Android/iOS OS push requires provider wiring and a real-device token test before sign-off.

## Sign-Off

Security-critical dashboard hardening: signed off.

Core QuizVerse LiveOps wiring: signed off.

Satori audience-targeted message delivery: signed off.

Admin dashboard edge-case hardening: signed off.

Nakama inbox notification delivery: signed off.

Real FCM/APNs device push: not signed off.
