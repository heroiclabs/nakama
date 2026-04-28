# Nakama Admin Dashboard, LiveOps, and Analytics Guide

Last audited: 2026-04-25

## Multi-Game ID Support

The admin dashboard supports both global defaults and game-specific Hiro/Satori configuration. Use `global` to edit shared defaults, or enter a concrete game id such as `quizverse` to read/write a scoped config key like `quizverse:flags`, `quizverse:store`, or `quizverse:live_events`.

| Area | Multi-game behavior |
| --- | --- |
| Hiro Config | Game ID selector scopes all Hiro system JSON reads/writes. Empty game-specific config inherits global config until saved. |
| Satori Config | Game ID selector scopes audiences, flags, experiments, live events, messages, and metrics JSON reads/writes. Empty game-specific config inherits global config until saved. |
| Feature Flags | Game ID selector scopes list/toggle/create operations to the selected Satori `flags` config. |
| Audiences | Game ID selector scopes audience list reads to the selected Satori `audiences` config. |
| Live Events | Game ID selector scopes list/schedule/update operations to the selected Satori `live_events` config. |
| Experiments | Game ID selector scopes list/setup/update operations to the selected Satori `experiments` config. |
| Messages | Game ID selector scopes list/broadcast/schedule operations to the selected Satori `messages` config. |
| Offers | Game ID selector scopes Hiro `store` config reads/writes and Satori audience lookups. |
| Economy | Game ID selector scopes Hiro `economy` and `store` config reads. Wallet mutations include the selected game id for game-aware Hiro RPC handling. |
| Retention & Winback | Game ID selector scopes streak/incentive configs plus Satori audiences, messages, flags, and live events used by the page. |
| Achievements | Game ID selector scopes Hiro `achievements` config reads/writes and Satori audience lookups. |
| Quests | Game ID selector scopes Hiro `challenges` config reads/writes and Satori audience lookups. |
| Battle Pass | Game ID selector scopes Hiro `incentives` config reads/writes and Satori audience lookups. |
| Event Leaderboards | Game ID selector scopes Hiro `event_leaderboards` config reads/writes and Satori audience lookups. |
| Analytics Game Intelligence | Game ID selector scopes diagnostics and freshness checks to the selected expected game id. |

Remaining caveat: account, player, storage, match, and tournament pages are mostly Nakama-global by design. Tournament creation stores `metadata.gameId`, but listing is still a Nakama tournament category/time query, so operators should use game-specific tournament ids or metadata conventions when several games share the cluster.

This document explains how game developers and operators should use the hosted Nakama admin dashboard for QuizVerse and other IntelliVerseX games. It also records the current production audit findings, signed-off capabilities, and operational guardrails.

## URLs

| Purpose | URL |
| --- | --- |
| Main admin shell | `https://nakama-rest.intelli-verse-x.ai/admin-dashboard/` |
| Hiro config editor | `https://nakama-rest.intelli-verse-x.ai/admin-dashboard/hiro-config` |
| Satori config editor | `https://nakama-rest.intelli-verse-x.ai/admin-dashboard/satori-config` |
| Feature flags | `https://nakama-rest.intelli-verse-x.ai/admin-dashboard/flags` |
| Live events | `https://nakama-rest.intelli-verse-x.ai/admin-dashboard/events` |
| Experiments | `https://nakama-rest.intelli-verse-x.ai/admin-dashboard/experiments` |
| Audiences | `https://nakama-rest.intelli-verse-x.ai/admin-dashboard/audiences` |
| Messages | `https://nakama-rest.intelli-verse-x.ai/admin-dashboard/messages` |
| Analytics hub | `https://nakama-rest.intelli-verse-x.ai/admin-dashboard/analytics` |
| Legacy/custom analytics dashboard | `https://nakama-rest.intelli-verse-x.ai/admin-dashboard/legacy-analytics/` |
| Normal Nakama console | `https://nakama.intelli-verse-x.ai/` |
| Nakama REST API base | `https://nakama-rest.intelli-verse-x.ai/` |

## Current Deployment Shape

`/admin-dashboard` currently serves the React admin app from `web/packages/admin`. It is deployed as a Node static/proxy image on the `nakama-admin-dashboard` Kubernetes deployment.

The browser uses a login-gated admin session. Nakama HTTP key and optional console credentials stay server-side in the dashboard proxy.

The legacy one-file analytics dashboard from `web/analytics-dashboard/index.html` is still available, but it is now nested under `/admin-dashboard/legacy-analytics/` so the React admin app and the custom game analytics dashboard can coexist.

Source locations:

| Area | Source |
| --- | --- |
| React admin routes | `web/packages/admin/src/App.tsx` |
| Sidebar/navigation | `web/packages/admin/src/layouts/AdminLayout.tsx` |
| Hiro config screen | `web/packages/admin/src/pages/HiroConfigPage.tsx` |
| Satori config screen | `web/packages/admin/src/pages/SatoriConfigPage.tsx` |
| LiveOps screens | `web/packages/admin/src/pages/FlagsPage.tsx`, `EventsPage.tsx`, `ExperimentsPage.tsx`, `AudiencesPage.tsx`, `MessagesPage.tsx` |
| React analytics hub | `web/packages/admin/src/pages/AnalyticsPage.tsx` |
| Legacy analytics dashboard | `web/analytics-dashboard/index.html` |
| Shared RPC client | `web/packages/shared/src/rpc/client.ts` |
| Shared Hiro RPC helpers | `web/packages/shared/src/rpc/hiro/index.ts` |
| Shared Satori RPC helpers | `web/packages/shared/src/rpc/satori/index.ts` |
| Dashboard proxy | `web/packages/admin/server/admin-dashboard-server.mjs` |

## What Game Developers Can Do

### 1. Configure Hiro Systems

Use `Hiro Config` for backend-driven game systems:

| Hiro system | What developers configure |
| --- | --- |
| `economy` | Currency names, balances, reward/sink tuning |
| `inventory` | Item definitions and inventory rules |
| `achievements` | Achievement definitions and unlock criteria |
| `progression` | XP, levels, unlock pacing |
| `energy` | Energy budgets, regeneration, spend rules |
| `stats` | Player stat definitions |
| `streaks` | Daily streaks and claim rules |
| `event_leaderboards` | Time-limited leaderboard config |
| `store` | Store catalog, pricing, purchasable items |
| `challenges` | Quest/challenge definitions |
| `tutorials` | Tutorial step state/config |
| `unlockables` | Feature/item unlock rules |
| `auctions` | Auction configuration |
| `incentives` | Referrals, return bonuses, promotional rewards |

Typical workflow:

1. Open `/admin-dashboard/hiro-config`.
2. Pick the target Hiro system from the left system list.
3. Edit JSON in the Monaco editor.
4. Use `Format` to normalize JSON.
5. Use `Save` to write through `admin_config_set`.
6. Validate in game by calling the corresponding runtime RPC, such as `hiro_challenges_list`, `hiro_incentives_list`, or the relevant player-facing RPC.

Current QA result: `admin_config_get` and `admin_config_set` worked for `challenges` and `incentives`. QA fixtures `ivx_qa_quizverse_challenge` and incentive rewards were verified from player-facing RPCs.

### 2. Configure Satori Systems

Use `Satori Config` for personalization, segmentation, A/B tests, events, messages, and metrics.

| Satori system | What developers configure |
| --- | --- |
| `audiences` | Player segments and cohort rules |
| `flags` | Feature flag definitions and rollout rules |
| `experiments` | A/B test variants and allocation |
| `live_events` | Scheduled events, promos, and time-limited campaigns |
| `messages` | Push/in-app messaging templates and campaigns |
| `metrics` | Metric definitions and alert thresholds |

Typical workflow:

1. Open `/admin-dashboard/satori-config`.
2. Select the system: Audiences, Feature Flags, Experiments, Live Events, Messages, or Metrics.
3. Edit JSON and save.
4. Use the dedicated LiveOps pages for day-to-day operations after the JSON config is stable.

Current QA result: `satori_config_get` and `satori_config_set` worked. Feature flag, live event, and experiment QA fixtures were verified from player-facing RPCs.

### 3. Run LiveOps

Use the LiveOps group in the sidebar:

| Screen | Intended use | Current production status |
| --- | --- | --- |
| Feature Flags | View/toggle feature flags | Pass: admin-safe list RPC and player flag verification passed |
| Live Events | View/schedule time-limited events | Pass: admin-safe list RPC and player event verification passed |
| Experiments | Create/manage A/B experiments | Pass: admin-safe list RPC and player experiment verification passed |
| Audiences | View configured player segments | Pass: include-list audience targeting was verified with player inbox delivery |
| Messages | Broadcast/manage campaigns | Pass: admin-safe list and audience-targeted Satori inbox delivery were verified |

Recommended operator flow:

1. Use dedicated LiveOps pages for flags, events, and experiments.
2. Use `Satori Config` for advanced JSON edits and audience definitions.
3. Start every new campaign with an include-list QA audience or a small internal cohort.
4. After editing config, verify the game client or backend RPC reads the expected config.
5. Use `/admin-dashboard/analytics` and `quizverse_game_intelligence_report` to decide whether to expand, stop, or roll back.

## Most Impactful LiveOps Playbooks

Use these playbooks when an admin asks, "What should I do today to move QuizVerse metrics?" They are ordered by expected impact and safety. Run one or two focused interventions at a time so analytics can attribute changes.

### 1. Exam Cohort Weak-Area Challenge

Use this when analytics shows weak topics for an exam cohort, such as JEE Physics mechanics, NEET biology, or SAT vocabulary.

Impact goal: increase quiz completion, accuracy improvement, and repeat sessions for the target exam cohort.

Admin steps:

1. Open `/admin-dashboard/analytics` and review `Game Intelligence`, `Quiz`, and `Player Events`.
2. Identify one weak area, target exam, and audience. Example: `jee_mechanics_weak_area`.
3. Open `/admin-dashboard/satori-config` and create or update an `audiences` entry for that cohort.
4. Open `/admin-dashboard/hiro-config` and add a `challenges` entry with:
   - `id`: stable campaign ID, for example `jee_mechanics_boost_week_01`.
   - `game_id`: QuizVerse game ID or supported game ID.
   - `topic`: the weak area.
   - `reward`: modest coins, XP, streak protection, or avatar cosmetic.
   - `start_at` and `end_at`: short window, usually 3-7 days.
5. Open `/admin-dashboard/messages` and send a targeted in-app message to the QA include-list audience first.
6. Verify with `hiro_challenges_list` from a QA player, then expand the audience.

Success metrics:

- Challenge view rate.
- Challenge start and completion rate.
- Topic accuracy lift after 24-72 hours.
- D1/D3 return rate for targeted users.

Rollback:

- Disable or remove the challenge ID from `challenges`.
- Turn off related flags or messages.
- Leave the campaign ID documented so analytics history remains explainable.

### 2. Streak Rescue Campaign

Use this for users who had recent engagement but are at risk of breaking a streak.

Impact goal: improve D1/D3 retention and reduce streak loss.

Admin steps:

1. In `/admin-dashboard/analytics`, find churn-risk or recently inactive users.
2. In `/admin-dashboard/satori-config`, define an audience such as `streak_risk_24h`.
3. In `/admin-dashboard/messages`, create a short message:
   - Title: "Keep your streak alive"
   - Body: "One quick quiz today protects your progress."
   - Deep link or metadata: route to daily quiz or streak screen if the client supports it.
4. In `/admin-dashboard/hiro-config`, configure a small incentive such as streak shield, bonus XP, or coins.
5. Send first to QA include-list, verify inbox delivery, then send to the target audience.

Success metrics:

- Message delivery and open rate.
- Session start within 24 hours.
- Streak continuation rate.
- Reward claim rate.

Guardrail:

- Do not send more than one rescue message per user per day.
- Avoid broad "come back" spam; target only users with meaningful prior engagement.

### 3. Limited-Time Exam Sprint

Use this around exam dates, mock test weeks, weekends, and seasonal study windows.

Impact goal: create urgency and concentrate activity into high-value study sessions.

Admin steps:

1. Open `/admin-dashboard/events`.
2. Create a live event such as `jee_weekend_mock_sprint`.
3. Set schedule, exam type, topics, and reward metadata.
4. Open `/admin-dashboard/flags` and enable any matching UI surface, such as sprint banner or featured quiz rail.
5. Open `/admin-dashboard/messages` and notify the target audience.
6. Verify the event appears from `satori_live_events_list` for a QA player.

Success metrics:

- Event impression to quiz-start conversion.
- Event quiz completion rate.
- Average questions attempted per user.
- Retention next day after event participation.

Rollback:

- End the live event early or disable the matching feature flag.
- Send a correction message only if players saw wrong reward or timing information.

### 4. Safe Feature Rollout

Use this for new UI, new exam types, new AI tutor flows, monetization surfaces, or risky client changes.

Impact goal: ship improvements without exposing all players to regressions.

Admin steps:

1. Open `/admin-dashboard/flags`.
2. Create or toggle a flag with a clear ID, for example `quiz_ai_hint_v2_enabled`.
3. Start with an internal or 1-5% audience.
4. Open `/admin-dashboard/analytics` and monitor errors, quiz completion, session length, and conversion.
5. If healthy, increase rollout gradually.
6. If metrics regress, disable the flag immediately.

Success metrics:

- Error rate does not increase.
- Target behavior improves: hint usage, quiz completion, conversion, or retention.
- Support complaints do not increase.

Rollback:

- Toggle the feature flag off.
- Keep the flag ID stable so clients can recover without redeploying.

### 5. A/B Test Reward Tuning

Use this when you need to decide reward size, copy, pricing, or challenge difficulty.

Impact goal: make reward and UX decisions with data instead of opinion.

Admin steps:

1. Open `/admin-dashboard/experiments`.
2. Create an experiment with two or three variants, not more.
3. Assign a clear success metric, such as `quiz_completed`, `challenge_completed`, `reward_claimed`, or `session_start_next_day`.
4. Tie variants to Hiro challenge/incentive IDs or Satori flag values.
5. Run the test for a fixed window and avoid changing variants mid-test.
6. Use `/admin-dashboard/analytics` and MCP reports to decide the winner.

Success metrics:

- Statistically meaningful difference in the primary metric.
- No negative movement in retention, economy balance, or error rate.

Guardrail:

- Do not test multiple major changes in one experiment.
- Do not expose pricing or reward experiments to all users until QA validates economy impact.

### 6. Personalized In-App Message Campaign

Use this to guide users to the next best action: finish a quiz, review weak topics, try a challenge, claim a reward, or join an event.

Impact goal: improve activation, reactivation, and content discovery.

Admin steps:

1. Define a narrow audience in `/admin-dashboard/satori-config`.
2. Open `/admin-dashboard/messages`.
3. Create message copy with one clear action.
4. Include metadata that the client can route on, such as `screen=daily_quiz`, `topic=mechanics`, or `event_id=jee_weekend_mock_sprint`.
5. Send to QA include-list and confirm `satori_messages_list` shows the inbox item.
6. Send to the production audience only after QA confirms title, body, and routing metadata.

Success metrics:

- Inbox delivery count.
- Open or tap-through rate, where available.
- Target action completion within 24 hours.

Guardrail:

- Prefer in-app/Satori inbox messages for production LiveOps. OS push notification delivery requires separate FCM/APNs provider sign-off.

### 7. Economy Source/Sink Correction

Use this when analytics shows too much currency inflation, low reward claims, or weak monetization conversion.

Impact goal: keep rewards exciting without breaking the economy.

Admin steps:

1. Open `/admin-dashboard/analytics` and review Economy and Game Intelligence.
2. Open `/admin-dashboard/hiro-config`.
3. Adjust one source or sink at a time:
   - Challenge reward amount.
   - Streak reward.
   - Store pricing.
   - Energy cost or regeneration.
4. Save with a campaign note in the JSON metadata.
5. Monitor wallet distribution, reward claims, purchases, and churn.

Success metrics:

- Currency source/sink ratio stabilizes.
- Reward claim rate improves.
- Store conversion or meaningful spend improves without retention drop.

Rollback:

- Revert the specific config value.
- Avoid retroactively removing earned rewards unless fraud is involved.

### 8. New Exam Type Launch

Use this when adding a new preparation category such as UPSC, JEE Advanced, NEET PG, SAT, GRE, GMAT, or school-board exams.

Impact goal: launch a new exam lane with measurable activation and retention.

Admin steps:

1. Define the exam ID and taxonomy before changing LiveOps. Example: `exam_id=jee_advanced`.
2. Add or verify quiz content and analytics events include the same `exam_id`.
3. In `/admin-dashboard/satori-config`, create audiences:
   - `exam_jee_advanced_new`
   - `exam_jee_advanced_active`
   - `exam_jee_advanced_weak_area_<topic>`
4. In `/admin-dashboard/flags`, enable the exam lane for internal QA first.
5. In `/admin-dashboard/events`, schedule a launch event.
6. In `/admin-dashboard/hiro-config`, add starter challenges and incentives.
7. In `/admin-dashboard/messages`, send onboarding guidance to users who select that exam.

Success metrics:

- Exam selection rate.
- First quiz completion rate.
- Repeat quiz sessions in first 3 days.
- Weak-area improvement by topic.

Guardrail:

- Do not create exam-specific flags, audiences, and challenge IDs with inconsistent naming. Use the same `exam_id` across analytics, Satori, Hiro, and content.

### 9. Friend Challenge Re-Engagement

Use this when social or challenge analytics show users respond to competition.

Impact goal: increase social reactivation and session starts.

Admin steps:

1. Open `/admin-dashboard/analytics` and confirm friend/challenge participation is healthy.
2. Open `/admin-dashboard/hiro-config` and add a friend challenge incentive if needed.
3. Open `/admin-dashboard/messages` and target users who recently received or completed friend challenges.
4. Keep copy specific: "A friend challenged you in Physics. Beat their score today."
5. Verify delivery with QA users before expanding.

Success metrics:

- Challenge accept rate.
- Match/quiz starts from social entry points.
- Return sessions from invited users.

Guardrail:

- Avoid sending social copy unless there is real social context or a recent challenge event.

### 10. Broken Funnel Recovery

Use this when Game Intelligence or analytics shows a high drop-off, error spike, or failed RPC path.

Impact goal: reduce damage quickly while engineering investigates.

Admin steps:

1. Open `/admin-dashboard/analytics` and identify the failing screen, event, RPC, or cohort.
2. Open `/admin-dashboard/flags` and disable the risky surface if there is a flag.
3. Open `/admin-dashboard/messages` only if users need guidance or compensation.
4. Open `/admin-dashboard/hiro-config` to add a small make-good reward only for affected users.
5. Document the incident ID in message metadata and challenge/incentive metadata.

Success metrics:

- Error rate drops.
- Drop-off normalizes.
- Affected users return or claim compensation.

Guardrail:

- Prefer disabling a broken feature over rewarding users into a broken path.

## Admin Operating Rules

- Every campaign needs an owner, campaign ID, audience, start/end time, success metric, and rollback plan.
- Use `ivx_qa_` prefixes for reusable QA fixtures and do not delete them unless replacing them intentionally.
- Use QA include-list audiences before broad rollout.
- Avoid broad messages unless the target behavior is urgent and measurable.
- Keep copy short, exam-specific, and action-oriented.
- Change one major variable at a time so the analytics signal is interpretable.
- For production writes, capture before/after JSON in the ticket or release note because `admin_audit_events` records the write but not every business decision.
- For real OS push notifications, require FCM/APNs provider verification separately. Satori/Nakama inbox messages are currently the signed-off LiveOps messaging path.

## Messaging And Push Notification Sign-Off

There are three messaging layers. Do not treat them as the same capability.

| Layer | Current status | What is verified |
| --- | --- | --- |
| Satori player inbox messages | Signed off | Audience-targeted messages can be broadcast from `/admin-dashboard/messages` and verified through `satori_messages_list`. |
| Nakama notification inbox | Signed off | `push_register_token`, `push_get_endpoints`, and `push_send_event` work for Nakama inbox delivery. Latest dry run registered a QA Android token, sent `qa_real_push_readiness`, and confirmed it through `/v2/notification`. |
| Real Android/iOS OS push via FCM/APNs | Not signed off | QuizVerse client code has an `FCMManager` and Firebase messaging define, but production does not yet prove device delivery through FCM/APNs. |

What is wired in the game:

1. `FCMManager` initializes Firebase Messaging when `FIREBASE_MESSAGING_AVAILABLE` is present.
2. `FCMManager` listens for Firebase token events.
3. `HomeScreen` calls `FCMManager.Instance?.TryRegisterWithNakama()` after the Nakama session is ready.
4. `QuizVerse.SDK.PushNotifications.RegisterToken` calls `push_register_token`.
5. `QuizVerse.SDK.PushNotifications.SendEvent` calls `push_send_event`.

Why real device push is not signed off yet:

- No `google-services.json` or `GoogleService-Info.plist` was present in the QuizVerse Unity `Assets` tree during the audit.
- The live Nakama deployment had no `PUSH_LAMBDA_URL`, `PUSH_SEND_URL`, FCM, APNs, SNS, Pinpoint, Firebase, VAPID, or Google push environment variables.
- No push-provider Kubernetes secret was present in the `aicart` namespace.
- The active production `push_register_token` RPC stores raw tokens in Nakama storage and the active `push_send_event` writes a Nakama notification; it does not create SNS endpoint ARNs or call FCM/APNs.
- AWS SNS has Android/Web GCM platform applications, but APNs was not present in the accessible platform app list. Current AWS permissions did not allow endpoint or Lambda Function URL inspection.

Real-device sign-off checklist:

1. Add platform Firebase config assets to the Unity project for Android and iOS.
2. Build a QA Android/iOS app with `FIREBASE_MESSAGING_AVAILABLE`.
3. Launch on a physical device, grant notification permission, and capture the Firebase token plus Nakama user ID.
4. Wire Nakama production env to real provider URLs or replace the current storage-only push RPC with the SNS/FCM provider implementation.
5. Verify `push_register_token` creates or stores a provider endpoint ARN, not only a raw token.
6. Send `push_send_event` to the QA user and verify the notification appears in the OS notification tray while the app is backgrounded or closed.
7. Tap the notification and verify QuizVerse routes to the expected screen or inbox item.
8. Repeat for Android FCM and iOS APNs separately.

### 4. Use Analytics

Use `/admin-dashboard/analytics` for the React analytics hub:

| Tab | Purpose |
| --- | --- |
| Overview | Runtime health, high-level metrics, sampled users |
| Live Dashboard | Embeds the legacy/custom game analytics dashboard from `/legacy-analytics/` |
| Player Events | Looks up events for a specific user |
| Metrics & Alerts | Satori metrics and alert thresholds |
| Cohort Analysis | User cohort buckets |
| Data Lake / Webhooks | Data lake targets, webhook config, manual export/poller controls |

Use `/admin-dashboard/legacy-analytics/` for the custom game analytics dashboard:

| Area | Purpose |
| --- | --- |
| Overview | DAU/WAU/MAU, top games, top events |
| Sessions | Sessions by hour and duration |
| Retention | Retention milestones and cohorts |
| Revenue/Monetization | Revenue, ad performance, IAP products |
| Economy | Coin distribution and source/sink balance |
| Quiz | Quiz funnel, accuracy, topics, difficulty |
| AI | AI feature usage and adoption |
| Features | Feature adoption, screens, home buttons, popups |
| Funnel | Conversion funnel |
| Players | Top players by activity |
| Platforms/Audience | Platforms, OS, devices, countries, ATT/consent/locale |
| Errors | Errors by RPC |
| Events | Events timeline |
| Storage | Analytics storage browser |
| Diagnose | Runtime env/RPC/storage diagnostics |

Current audit result: the legacy dashboard loads at `/admin-dashboard/legacy-analytics/` and still has its own login overlay. Because it is embedded in the React analytics page, it may require a second login unless session storage already contains the legacy admin token.

### 5. Use MCP for Higher-Level Decisions

The UI is useful for operators, but the strongest analysis layer is MCP. Use these when asking "what is working and what is not":

| MCP tool | Use |
| --- | --- |
| `quizverse_game_intelligence_report` | Unified ranked report combining analytics, Hiro/Satori, retention, economy, funnels, knowledge gaps, and actions |
| `nakama_analytics_overview` | RPC scheduler/status/summary/top slow/top errors |
| `game_health_report` | Overall health score and benchmarks |
| `retention_analysis` | D1-D30 cohort retention |
| `experience_quality` | Error rate and session quality |
| `growth_opportunities` | Feature/funnel opportunities |
| `economy_audit` | Source/sink, Gini, whale concentration |
| `analyze_quiz_performance` | Per-player quiz strengths/weaknesses |
| `knowledge_gap_report` | Systemic weak categories across sampled users |

## Production Hardening Status

The critical/major items from the live audit have been addressed and deployed:

- React admin shell now requires `ivx-admin` login before rendering privileged pages.
- Browser assets no longer contain Nakama HTTP key, server key, dashboard secret, or console credentials.
- Admin RPC/HTTP calls go through `web/packages/admin/server/admin-dashboard-server.mjs`.
- Admin-safe Satori list RPCs exist for flags, live events, experiments, and messages.
- High-impact LiveOps writes now prompt for confirmation in the React UI.
- Admin write operations are logged to `admin_audit_events`.
- Monaco editor assets are bundled in the app build instead of loaded from a public CDN.

See `docs/ADMIN_DASHBOARD_PROD_QA_SIGNOFF.md` for the production QA matrix, deployment evidence, and residual risks.

## Historical Live Audit Findings

### Fixed: React Admin Had No Admin Login Gate

The React admin shell at `/admin-dashboard/` previously loaded directly without requiring the previous `ivx-admin` login. This is now fixed by the React login gate plus the server-side admin proxy.

Observed impact:

- Operators can open `/admin-dashboard/hiro-config`, `/satori-config`, `/flags`, `/events`, etc. without first passing the legacy admin login.
- The app uses server-key-style RPC access from the browser.
- The built JavaScript contains the production Nakama HTTP key through `VITE_NAKAMA_HTTP_KEY`.

Why this matters:

- This is acceptable for a private/internal network only.
- This is not safe for a public internet route.
- Anyone who can load the page can inspect bundled JS/network requests and reuse the HTTP key for any RPC that accepts `http_key`.

Recommended fix:

1. Put the React admin shell behind the same `admin_login` session gate as the legacy dashboard.
2. Stop embedding `VITE_NAKAMA_HTTP_KEY` in client JavaScript.
3. Add a small backend/admin proxy for privileged operations:
   - Browser sends admin bearer token.
   - Proxy validates token/role.
   - Proxy injects HTTP key server-side.
4. Gate write operations separately from read operations.

### Fixed: Privileged Write UI Was Exposed Client-Side

Screens expose buttons for `Save`, `Broadcast`, `Schedule Event`, `New Flag`, `New Experiment`, config import/export, and other admin actions. These now route through authenticated proxy calls and have confirmation prompts for high-impact actions.

Risk:

- If the RPC accepts `http_key`, the browser can perform the operation.
- There is no per-operator audit trail in the React shell.
- There is no confirmation/approval workflow for high-impact LiveOps changes.

Recommended fix:

- Require admin bearer auth for every admin write operation.
- Add audit logging for who changed what, old/new config diff, timestamp, and source IP.
- Add confirmation modals for destructive/high-blast-radius actions.
- Add dry-run/preview before saving large JSON config edits.

### Fixed: Several Satori List RPCs Failed For Admin Use

Original production RPC smoke test results:

| RPC | Status | Finding |
| --- | --- | --- |
| `satori_flags_get_all` | 500 | Fails with `User ID is required` |
| `satori_experiments_get_all` | 500 | Fails with `User ID is required` |
| `satori_messages_list` | 500 | Fails with `User ID is required` |
| `satori_live_events_list` | 500 | Fails with `User ID is required` |
| `satori_audiences_list` | 200 | Works |
| `satori_metrics_get` | 200 | Works, returned empty metrics |
| `satori_config_get` | 200 | Works for config editor |

Observed UI impact:

- `/flags` shows "Failed to load feature flags".
- `/experiments` shows "Failed to load experiments".
- `/messages` shows "Failed to load messages".
- `/events` can render an empty-looking page even though direct list RPC currently fails.

Root cause:

The UI is calling player-context Satori RPCs for admin screens. Those RPCs call `requireUserId`, but admin server-key calls do not provide a player user ID.

Recommended fix:

- Add admin-safe RPCs such as:
  - `admin_satori_flags_list`
  - `admin_satori_experiments_list`
  - `admin_satori_messages_list`
  - `admin_satori_live_events_list`
- Or update existing `satori_*` list RPCs to allow trusted admin/server-key calls and read from config/storage without player context.
- Update React pages to use admin-safe RPCs.

### Conditional: Mixed Auth Models Create Operator Confusion

There are currently two admin experiences:

1. React admin shell: login-gated route load through the admin proxy.
2. Legacy analytics dashboard: has an `ivx-admin` login overlay and admin session token.

Observed issue:

- `/analytics` embeds `/legacy-analytics/`, which may ask for a second login inside the iframe.
- Operators can see both the React analytics shell and the legacy dashboard controls, but authentication semantics differ.

Recommended fix:

- Use one admin auth model.
- Share admin session between React shell and legacy analytics or fully migrate legacy analytics into React.
- Remove duplicated login UX.

### Fixed: Some Infrastructure Pages Used Wrong Auth For Nakama HTTP APIs

Network audit showed `/v2/match?limit=100` returning 401 from React pages using server-key assumptions.

Likely affected screens:

- Matches
- Accounts
- Storage
- Some player/admin HTTP API screens

Why:

The shared RPC client supports `http_key` for `/v2/rpc`, but normal Nakama HTTP/console endpoints require different auth. Some pages mix those assumptions.

Recommended fix:

- Separate clients clearly:
  - Runtime RPC client via admin proxy.
  - Nakama console API client via server-side proxy/basic auth.
  - Player session client for player-context calls.
- Do not call privileged console HTTP APIs directly from browser.

### Fixed: CDN Dependency For Monaco Editor

The config editors previously loaded Monaco from `cdn.jsdelivr.net`. The admin build now bundles Monaco locally.

Observed network:

- `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/...`

Risk:

- Dashboard editor depends on public CDN availability.
- CSP/SRI controls are not obvious.
- Offline/internal admin use can fail.

Recommended fix:

- Bundle Monaco with the app build or pin with integrity and strict CSP.
- Add a local fallback.

### Medium: Empty Configs / Missing Seed Data

Audit observations:

- `admin_config_get` for `challenges` returned `{}`.
- `admin_config_get` for `incentives` returned `{}`.
- `satori_metrics_get` returned empty metrics.
- Analytics dashboard showed zero DAU/WAU/MAU for the selected QuizVerse game in the sampled window.

Potential interpretations:

- Real production data is not flowing for selected game/window.
- Seed/config has not been initialized.
- Analytics events are stored under a different game ID/alias.
- UI selected defaults do not match runtime data.

Recommended fix:

- Add environment/game selector diagnostics.
- Add "last event received" and "event source game IDs" indicators.
- Seed default Hiro/Satori configs for QuizVerse.
- Add a "data freshness" banner to analytics pages.

### Medium: Accessibility and UX Gaps

Observed issues:

- Sidebar has icon-only controls with minimal accessible names in some cases.
- Some pages show disabled Refresh buttons during load with no progress explanation.
- Error messages expose raw RPC names/status but not the operator action to resolve them.
- JSON editors need schema validation, not only formatting.

Recommended fix:

- Add screen-level help panels.
- Add JSON schema validation per Hiro/Satori system.
- Add "copy diagnostic details" on failures.
- Add clearer empty-state CTAs, such as "Open Satori Config Editor" or "Create default config".

## Recommended Production Hardening Plan

### Phase 1: Make It Safe

1. Restore login gate for the React admin shell.
2. Remove HTTP key from the browser bundle.
3. Add admin proxy/RPC gateway.
4. Add audit logs for all writes.
5. Add role separation:
   - Viewer
   - Analyst
   - LiveOps operator
   - Admin

Status: Implemented in the admin proxy. Viewer/Analyst roles can read dashboards and LiveOps state, LiveOps operators can perform LiveOps writes, and only Admin can proxy Nakama console writes/admin-write operations. The current production `ivx-admin` account is still issued as Admin.

### Phase 2: Make It Work End-to-End

1. Add admin-safe Satori list RPCs.
2. Update broken pages to call admin-safe RPCs.
3. Fix Nakama HTTP API pages that receive 401.
4. Seed default QuizVerse Hiro/Satori configs.
5. Add analytics data freshness checks.

### Phase 3: Make It Useful for Game Developers

1. Add guided workflows:
   - "Create a weekly challenge"
   - "Launch a feature flag"
   - "Create A/B experiment"
   - "Broadcast message"
   - "Create weak-topic practice event"
2. Add per-game templates for QuizVerse:
   - JEE weak-topic drill
   - Daily streak recovery
   - Weekend live quiz
   - Return-user bonus
   - Exam cohort segmentation
3. Add a "Game Intelligence" tab powered by `quizverse_game_intelligence_report`.
4. Show recommended actions next to the actual LiveOps controls.

## Developer Usage Playbooks

### Launch a QuizVerse Weak-Topic Event

1. Run `quizverse_game_intelligence_report`.
2. Identify `quiz_knowledge_gaps[0]`.
3. Open `/admin-dashboard/satori-config`.
4. Add or update a `live_events` config entry for the weak topic.
5. Open `/admin-dashboard/hiro-config`.
6. Add a matching `challenges` config entry with rewards.
7. Verify in game with `hiro_challenges_list`.
8. Monitor `/admin-dashboard/analytics` and `/legacy-analytics/`.

### Roll Out a New Feature

1. Define the flag in Satori config under `flags`.
2. Create an audience under `audiences`.
3. Start with a small rollout.
4. Monitor:
   - Analytics feature adoption
   - Errors by RPC
   - Retention and session length
5. Increase rollout only after error and retention checks pass.

### Broadcast a Campaign Message

1. Define audience segments.
2. Draft message in Satori messages config or Messages page after RPC fixes.
3. Include clear reward or event CTA.
4. Schedule for peak session hours from analytics.
5. Monitor event timeline and conversion funnel.

### Create a Challenge or Incentive

1. Open Hiro Config.
2. Select `challenges` or `incentives`.
3. Edit JSON config.
4. Save.
5. Call list RPC or launch game client to verify.
6. Watch analytics for adoption and completion.

## Open Gaps Checklist

- [x] React admin shell requires admin login before rendering.
- [x] HTTP key is removed from browser bundle.
- [x] Admin proxy validates bearer admin token server-side.
- [x] All LiveOps writes are audit logged.
- [x] Satori flags list page works without player user ID.
- [x] Satori experiments list page works without player user ID.
- [x] Satori messages page works without player user ID.
- [x] Satori live events page uses admin-safe list RPC.
- [x] Matches/accounts/storage pages route through the server-side proxy.
- [x] Legacy analytics shares React admin auth or is fully migrated.
- [x] Monaco is bundled or pinned with CSP/SRI.
- [x] Hiro/Satori JSON schemas validate configs before save.
- [x] QuizVerse default challenge/incentive/flag/event templates are seeded.
- [x] Analytics pages show data freshness and source game IDs.
- [x] `quizverse_game_intelligence_report` is exposed in UI as an actionable tab.
- [x] Satori audience-targeted player inbox delivery is fixed and re-QA signed off.

## Bottom Line

The dashboard is now hosted under `/admin-dashboard` as a login-gated React console backed by a server-side proxy. Security-critical production hardening, Satori player inbox delivery, seeded QuizVerse LiveOps templates, config schema validation, legacy analytics auth handoff, analytics freshness/source diagnostics, and Android FCM/SNS provider handoff are signed off.

Real device push status update: the Nakama runtime is provider-aware and production is wired to Lambda `ivx-push-provider-bridge` through `PUSH_REGISTER_URL`, `PUSH_LAMBDA_URL`, and `PUSH_SEND_URL`. Android registration now creates an SNS endpoint ARN and `push_send_event` returns a provider `messageId` for a stored FCM token. This signs off the Android provider handoff; physical notification display still needs someone holding the device to confirm receipt. A Nakama device ID is still not enough for OS push; the test needs the actual Firebase registration token or APNs device token from the physical device. iOS APNs remains pending because no Apple APNs key/cert, iOS SNS platform app ARN, or populated `push_token_ios` exists in production.

Browser QA status: core LiveOps, analytics, account, storage, player-search, match, and legacy analytics routes now pass in browser. The previous `/v2/console/account` 404 and `/v2/match` 401 gaps are fixed by admin/runtime RPC wrappers, and `/admin-dashboard/legacy-analytics/` now serves the legacy dashboard HTML instead of the React SPA fallback.
