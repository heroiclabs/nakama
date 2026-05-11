# Admin Dashboard Production QA Sign-Off

Date: 2026-04-26

## Verdict

Production sign-off for the hardened `/admin-dashboard` operator console.

The critical security gap is closed: the public browser no longer receives Nakama HTTP/server keys, the app is login-gated, and proxy API routes reject unauthenticated requests. Core LiveOps reads/writes for QuizVerse fixtures were verified in production with `ivx_qa_` objects, including audience-targeted Satori message delivery into a player inbox.

## Deployment Evidence

| Component | Result |
| --- | --- |
| Nakama runtime | Rolled to immutable `970547373533.dkr.ecr.us-east-1.amazonaws.com/intelliverse-nakama:multigame-runtime-20260426-0019` |
| Admin dashboard proxy | Rolled to immutable `970547373533.dkr.ecr.us-east-1.amazonaws.com/nakama-admin-dashboard:multigame-dashboard-monaco-20260426-0108` |
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
| Multi-game scoped RPC regression | Pass for `global`, `quizverse`, and `ivx_qa_game_1777181147` |
| Admin browser secret scan | Pass |
| Production rollout | Pass |
| End-to-end dry run | Pass |
| No-cache runtime image rebuild | Pass; confirmed running pod includes `sameGameId` alias matching and metric zero-value fallback |
| Push notification readiness dry run | Android FCM/SNS provider handoff and Nakama inbox path pass; iOS APNs still needs Apple provider credentials and a real APNs token |
| Browser QA pass | Pass; login/session, dashboard health, LiveOps/admin RPC routes, analytics/Game Intelligence, account/storage/match pages, and legacy analytics route verified |

## Feature Matrix

| Capability | QA Status | Evidence |
| --- | --- | --- |
| Login gate | Pass | Public app loads; proxy RPCs reject missing bearer token with 401 |
| Role separation | Pass | Admin proxy classifies read, LiveOps write, and admin-write calls. Viewer/Analyst roles are read-only, LiveOps operator can write LiveOps surfaces, and only Admin can proxy Nakama console writes/admin-write operations. Current production `ivx-admin` login still issues the Admin role. |
| Admin health/dashboard overview | Pass | Browser QA now shows `Server is healthy` and `Server Status Online`. The previous `Server Status: unknown` came from `/healthcheck` returning HTTP 200 with an empty body; the UI now treats a successful empty healthcheck as reachable and labels the node as `Nakama REST healthcheck`. |
| Hiro config editor | Pass | `admin_config_get`/`admin_config_set` through proxy verified for `challenges` and `incentives` |
| Satori config editor | Pass | `satori_config_get`/`satori_config_set` through proxy verified |
| Multi-game Hiro/Satori scoping | Pass | Production smoke wrote isolated `quizverse:challenges`, `ivx_qa_game_1777181147:challenges`, `quizverse:flags`, and `ivx_qa_game_1777181147:flags` configs. Player-facing `hiro_challenges_list` and `satori_flags_get_all` returned only the selected game ID's QA fixtures, proving no cross-game contamination between QuizVerse and the additional QA game. |
| Feature flags | Pass | `ivx_qa_quizverse_flag` seeded via admin path and visible from player `satori_flags_get_all` |
| Live events | Pass | `ivx_qa_quizverse_event` seeded via admin path and visible from player `satori_live_events_list` |
| Experiments | Pass | `ivx_qa_quizverse_experiment` seeded via admin path and visible from player `satori_experiments_get_all` |
| Hiro challenges | Pass | `ivx_qa_quizverse_challenge` seeded and visible from player `hiro_challenges_list` |
| Hiro incentives | Pass | QA incentives config seeded and visible from player `hiro_incentives_list` |
| Satori messages admin list | Pass | `admin_satori_messages_list` through proxy returns HTTP 200 |
| Satori player message delivery | Pass | Production QA created an include-list audience for user `dd4e32dc-fb37-44a4-827c-a228eb9f96e5`, broadcast `ivx_qa_satori_msg_delivery_message_1777151989`, verified `delivered=1`, confirmed the inbox item via `satori_messages_list`, then deleted the inbox item and restored temporary config objects. |
| Repeat Satori delivery dry run | Pass | Production dry run delivered `ivx_qa_dryrun_msg_1777152246` to user `78d2990b-2592-4613-84e3-6e1de4d5d47b`, confirmed inbox item `b18df3ce-aedc-497e-9839-a95c19227433`, then deleted the inbox item and restored temporary config objects. |
| Accounts/players/storage/matches/logs/economy/retention pages | Pass | The broken `/v2/console/account` and `/v2/match` browser calls were replaced with admin/runtime RPC wrappers: `admin_accounts_list`, `admin_account_get`, `admin_account_ban`, `admin_account_unban`, `admin_account_delete`, `admin_matches_list`, `admin_storage_list`, and `admin_storage_write`. Production smoke returned HTTP 200 for account list, match list, and storage list; browser QA confirmed Accounts renders 20 results, Matches renders a clean empty state through `admin_matches_list`, Storage renders `hiro_configs` objects through `admin_storage_list`, and Players search no longer crashes on wrapped account rows. |
| Scoped admin player support tools | Pass | Production smoke created QA user `0c652cc4-e3a7-475e-820b-69e7d418c6d3`, then verified `admin_wallet_grant`, `admin_inventory_grant`, `admin_mailbox_send`, and `admin_player_inspect` with game ID `ivx_qa_game_1777181163`. Browser player lookup called `admin_account_get` with HTTP 200. |
| Analytics hub | Pass | Existing analytics tabs build and proxy calls succeed; Game Intelligence tab is wired to production `quizverse_game_intelligence_report` RPC and renders health, wins/problems, segment insights, risks, and ranked actions. |
| Analytics freshness/source diagnostics | Pass | Production `quizverse_game_intelligence_report` returns `analytics_diagnostics` with last event timestamp, source game IDs, sampled event count, and QuizVerse UUID-to-slug alias matching. Latest smoke found 618 QuizVerse samples under `126bf539-dae2-4bcf-964d-316c0fa1f92b`, correctly matched to selected `quizverse`, with status `old` because no newer events arrived. |
| Game Intelligence report | Pass | Production RPC smoke test returned `health_score=100`, configured flags/events/experiments/audiences/challenges/incentives, 618 analytics event storage samples, no runtime RPC errors in the sampled window, and one operational freshness risk for stale incoming analytics. |
| Standalone analytics | Pass | The standalone analytics dashboard is kept at `https://nakama.intelli-verse-x.ai/analytics.html`. The duplicate `/admin-dashboard/legacy-analytics/` route redirects to the canonical analytics page instead of serving a copied dashboard. |
| Hiro/Satori JSON validation | Pass | Hiro and Satori config editors validate JSON shape before save for critical systems, block invalid saves, and show operator-readable validation messages. |
| Monaco JSON editor workers | Pass | Browser QA initially found Monaco fallback errors on Hiro/Satori config pages. `src/main.tsx` now registers Vite-built Monaco editor and JSON workers; redeployed dashboard bundle loaded `editor.main-BSqQuhpY.js` and `json.worker-leyajbqV.js` with HTTP 200 and no new Monaco worker errors after reload. |
| Satori metrics seed/read path | Pass | `satori_config_get(metrics)` seeds QuizVerse metric definitions, and `satori_metrics_get` now returns zero-valued configured metrics before live buckets exist instead of an empty list. |
| Nakama push/inbox notifications | Pass | Production dry run created QA user `c94b42bf-8903-413f-a900-2f75343f4d32`, registered an Android token through `push_register_token`, confirmed `push_get_endpoints` returned that token, sent `qa_real_push_readiness` through `push_send_event`, and confirmed the event in `/v2/notification`. |
| Android FCM/SNS provider handoff | Pass | Deployed Lambda `ivx-push-provider-bridge` at `https://jlxolkky4a7ekzbrccfiu22o7i0uvizc.lambda-url.us-east-1.on.aws/`, wired `PUSH_REGISTER_URL`, `PUSH_LAMBDA_URL`, and `PUSH_SEND_URL` into Nakama runtime, registered a real-looking stored Android FCM token through `push_register_token`, received SNS endpoint ARN `arn:aws:sns:us-east-1:970547373533:endpoint/GCM/IntelliVerseX-Android/0ad8c54b-89d1-381c-b1d8-e8d0ac5a0fd5`, then `push_send_event` returned `providerConfigured=true` and provider message ID `019bcb73-3e44-5984-8721-a9147d005c79`. Nakama inbox item was also confirmed for QA user `4a0ea326-eb1d-4a49-8983-2644c3bf92c4`. Physical-device receipt still needs a human/device-side observation because SNS publish success proves provider acceptance, not visible notification display. |
| iOS APNs device push | Not signed off | AWS has Android/Web SNS platform apps only. No `.p8`, APNs cert, `SNS_PLATFORM_APP_ARN_IOS`, Kubernetes secret, or populated `push_token_ios` was found. The bridge supports iOS once an APNs SNS platform application ARN is supplied, but a true iOS sign-off still requires Apple APNs credentials and a real APNs device token from a physical iOS build. |

## Operational Guardrails

- Console HTTP proxy credentials are still supported for direct safe health/console reads, but Accounts, Players, Storage, and Matches no longer depend on missing/incorrect console REST endpoints for their primary browser flows.
- Destructive production account deletion, wallet reset, and storage delete are intentionally not part of routine sign-off. They are guarded in UI and should remain restricted to clearly labeled QA users only.
- `ivx_qa_` flag, event, experiment, challenge, and incentive fixtures remain intentionally available as reusable production QA fixtures.
- `ivx_qa_game_1777181147` and `ivx_qa_game_1777181163` are temporary additional-game QA scopes used for the 2026-04-26 multi-game regression. They can remain as harmless test fixtures or be removed from system storage during a later cleanup pass.
- Satori/Nakama inbox messages are the signed-off production messaging path. Android OS push via SNS is now provider-handoff-signed-off with a stored FCM token; iOS APNs still needs Apple credentials and an APNs device token.
- For real-device push sign-off, use an actual FCM registration token or APNs device token, not the Nakama device ID. The expected pass criteria are: token registration returns a provider endpoint ARN, `push_get_endpoints` shows that endpoint ARN, `push_send_event` returns a provider message ID, and the physical device receives the notification.
- Browser QA confirmed the previous console HTTP endpoint issues are resolved by admin/runtime RPC wrappers. Do not reintroduce direct browser calls to `/v2/console/account` or admin-authenticated calls to `/v2/match`.

## Sign-Off

Security-critical dashboard hardening: signed off.

Core QuizVerse LiveOps wiring: signed off.

Satori audience-targeted message delivery: signed off.

Admin dashboard edge-case hardening: signed off.

Admin dashboard multi-game production regression: signed off for global/default, QuizVerse, and one additional QA game ID.

Nakama inbox notification delivery: signed off.

Android FCM/SNS provider handoff: signed off.

Android physical-device visual receipt: pending manual device observation.

iOS APNs provider push: not signed off.
