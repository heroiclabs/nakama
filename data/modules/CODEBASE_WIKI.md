# IntelliVerse-X Nakama Module Codebase — Comprehensive Wiki

> **Version**: 2.0  |  **Last updated**: 2026-06  |  **Runtime**: Nakama 3.x (Goja/JS + TypeScript build pipeline)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Layout](#2-repository-layout)
3. [Build Pipeline](#3-build-pipeline)
4. [Startup Sequence — InitModule](#4-startup-sequence--initmodule)
5. [Shared Utilities](#5-shared-utilities)
   - 5.1 Constants
   - 5.2 Storage
   - 5.3 EventBus
   - 5.4 RpcHelpers
   - 5.5 Health Probe
6. [Legacy Layer](#6-legacy-layer)
7. [Multiplayer Kernel (MpKernel)](#7-multiplayer-kernel-mpkernel)
8. [QuizVerse Plugin](#8-quizverse-plugin)
9. [QuizVerse Migration (Nakama-Only v2)](#9-quizverse-migration-nakama-only-v2)
10. [Hiro Systems](#10-hiro-systems)
11. [Satori Systems](#11-satori-systems)
12. [AI / Insights Layer](#12-ai--insights-layer)
13. [Social / Friends](#13-social--friends)
14. [Economy & Rewards](#14-economy--rewards)
15. [Tournaments & P2E](#15-tournaments--p2e)
16. [TutorX](#16-tutorx)
17. [Fantasy Cricket](#17-fantasy-cricket)
18. [Cricket Game](#18-cricket-game)
19. [Admin Console](#19-admin-console)
20. [Library v2.4.0](#20-library-v240)
21. [Geo / Ads](#21-geo--ads)
22. [Analytics & Telemetry](#22-analytics--telemetry)
23. [Privacy & Consent](#23-privacy--consent)
24. [Cross-Cutting Patterns](#24-cross-cutting-patterns)
25. [Environment Variables Reference](#25-environment-variables-reference)
26. [Storage Collections Reference](#26-storage-collections-reference)
27. [Full RPC Index](#27-full-rpc-index)

---

## 1. Project Overview

IntelliVerse-X is a multi-game, AI-assisted educational gaming platform built on Nakama (Heroic Labs). The module codebase is the **server-authoritative runtime** that handles:

- User authentication bridging (Nakama accounts + Cognito)
- Wallet / currency / economy management
- Leaderboards and scoring
- Daily rewards and streaks
- Real-time multiplayer (QuizVerse synchronous-turn engine)
- AI integrations (question gen, personalization, cross-sell, KB enrichment)
- Tournaments and P2E reward settlement
- Social graph (friends, groups, messaging)
- Analytics, telemetry, crash reporting, and insights aggregation
- Fantasy Cricket and Cricket Director game modules
- TutorX progress tracking
- Privacy / GDPR / COPPA consent enforcement

The runtime is written in **TypeScript** (compiled via tsc), loaded into Nakama's embedded Goja JS VM alongside a legacy_runtime.js file that provides backward-compatible RPC implementations.

---

## 2. Repository Layout

Sources are under src/, compiled to a single index.js bundle by tsc:

| Path | Purpose |
|------|---------|
| src/main.ts | Boot sequencer — InitModule |
| src/shared/ | Constants, Storage helpers, EventBus, RpcHelpers, Health probe |
| src/legacy/ | Backward-compatible V1 RPCs (wallet, leaderboards, quiz, friends...) |
| src/mp-kernel/ | Multiplayer match kernel + SyncTurnMatch engine |
| src/quiz-verse/ | QuizVerse game plugin, Migration, LiveBanner, Entitlements |
| src/hiro/ | Hiro game-services wrappers (Economy, Inventory, Achievements...) |
| src/satori/ | Satori analytics / experimentation wrappers |
| src/friends/ | intelliverse_find_friends + friends_list / list_blocked_users |
| src/ai-content/ | AI content-factory pipeline RPCs |
| src/insights/ | InsightsAggregator + PendingBundles DLQ |
| src/qv-agent/ | qv_agent_* RPCs (AI gateway tool surface) |
| src/kb/ | Knowledge-base user-dump RPCs |
| src/learner-toolbelt/ | lt_* RPCs (score predictor, GPA, exam countdown) |
| src/conv-capture/ | conv_message_capture / conv_my_list / conv_user_purge |
| src/user-model/ | user_model_get / signal_ingest / consent_set |
| src/brain-coins/ | brain_coins_* P2E ledger RPCs |
| src/wallet-guest-sync/ | wallet_sync_guest_to_account |
| src/account-merge/ | account_merge_ghost_to_cognito |
| src/tournaments/ | 25 tournament RPCs + cron handlers |
| src/tutorx/ | tutorx_xp_* / streak_touch / quest_claim / studyplan_* |
| src/fantasy/ | FantasyTeam / Transfer / Scoring / League |
| src/cricket/ | CricketAuction / CricketDirector |
| src/admin/ | AdminConsole RPCs |
| src/library/ | LibraryCountdownPlugin + N8nPackStatePlugin |
| src/geo/ | GeoTier country_tier_get |
| src/ads/ | AdRevenueEvent / FortuneWheelAdSpin / WebAdReward |
| src/identity/ | IdentityResolver (identity_resolve / link / unlink / list_mine) |
| src/wow-moments/ | WowMoments (wow_moments_select / react / state_get) |
| src/quest-engine/ | QuestEngine (quest_engine_get / record_event / claim_reward) |
| src/product-changelog/ | product_changelog_append |
| src/avatar-comparison/ | analytics_avatar_comparison |
| src/cross-sell/ | xsell_pick / xsell_record |
| src/personalization/ | personalization_get / get_for_mode |
| src/privacy/ | privacy_erase_user / consent_upsert / consent_invalidate |
| src/crash-handler/ | crash_log_append |
| index.js | Legacy JS runtime (LegacyInitModule) |
| legacy_runtime.js | Older JS RPCs bridged via proxy initializer |
| postbuild.js | Injects __TS_OWNED_RPCS + autoInvokeRegister after tsc |

---

## 3. Build Pipeline

1. **tsc** compiles `src/` (TypeScript, strict, ES2019, CommonJS) into a single bundle evaluated by Nakama Goja VM.
2. **postbuild.js** runs after tsc:
   - Scans the compiled output for every `initializer.registerRpc("...", ...)` call.
   - Injects the `__TS_OWNED_RPCS` map so the legacy bridge skips already-registered RPC IDs.
   - Injects `autoInvokeRegister()` calls so each plugin self-registers on every pooled Goja VM.
3. **legacy_runtime.js / index.js** — loaded separately; `LegacyInitModule` skips RPCs present in `__TS_OWNED_RPCS`.

Full build: `tsc && node postbuild.js`

---

## 4. Startup Sequence (`InitModule`)

`src/main.ts:InitModule` is called once by Nakama at boot. Registration order:

1. **JsRuntimeHealth** — `nakama_js_health` RPC (k8s liveness/readiness probe).
2. **AnalyticsAlerts** — instruments every subsequent `registerRpc` with timing/error sampling.
3. **MpKernelModule.mount** — multiplayer match templates + `mp_create_match`, `mp_read_match_result`, `mp_list_templates`.
4. **QuizVersePlugin.register** — all `quizverse_*` RPCs.
5. **QuizVerseMigration.register** — 22 Nakama-only v2 RPCs.
6. **QuizVerseLiveBanner.register** — `quizverse_live_banner_check`.
7. **QvEntitlements.register** — `quizverse_get_entitlements`, `quizverse_rc_sync`.
8. **Legacy modules** — wallet, leaderboards, game-registry, daily-rewards, quiz, game-entry, analytics, product-changelog, avatar-comparison, insights-aggregator, pending-bundles, crash-handler, cross-sell, personalization, privacy, ai-pipelines, friends, find-friends, friends-list, groups, push, notif-scheduler, player, chat, quests-economy-bridge, multi-game, storage, analytics-retention, gift-cards, coupons.
9. **QuestEngine.register** — 5 RPCs (get / record_event / claim_reward / admin_save_config / admin_get_config).
10. **Hiro subsystems** — Economy, Inventory, Achievements, Progression, Energy, Stats, EventLeaderboards, Streaks, Store, Challenges, Teams, Tutorials, Unlockables, Auctions, Incentives, Mailbox, RewardBucket, CreatorEventRewards, Personalizers, Base, Leaderboards.
11. **Satori subsystems** — EventCapture, Identities, then inline: IdentityResolver, WowMoments, QvAgent, QvKbUserDump, LearnerToolbelt, KbEnrichment, ConvCapture, UserModel, BrainCoins, WalletGuestSync, AccountMerge, Tournaments (+crons), Audiences, FeatureFlags, Experiments, LiveEvents, CreatorEvents, VideoFeed, Messages, Metrics, Webhooks, Taxonomy, DataLake.
12. **GeoTier, AdRevenueEvent, FortuneWheelAdSpin, WebAdReward**.
13. **TutorXProgress, TutorXStudyPlan**.
14. **Fantasy Cricket** — FantasyTeam, FantasyTransfer, FantasyScoring, FantasyLeague.
15. **Cricket** — CricketAuction, CricketDirector.
16. **AdminConsole**.
17. **Library** — LibraryCountdownPlugin, N8nPackStatePlugin.
18. **EventBus wiring** — HiroAchievements, SatoriMetrics, HiroRewardBucket, SatoriWebhooks handlers.
19. **LegacyInitModule bridge** — calls legacy index.js RPCs, skipping those in `__TS_OWNED_RPCS`.

Each step is wrapped in `try/catch`; a failure in one module does not abort the rest.

---

## 5. RPC Catalogue

All RPCs are Nakama server-to-server or authenticated-client RPCs. Service RPCs require `service_token` in the payload matching the `BRAIN_COINS_SERVICE_TOKEN` or `TOURNAMENT_SERVICE_TOKEN` env var.

### 5.1 Health & Infrastructure
| RPC | Module | Auth |
|-----|--------|------|
| `nakama_js_health` | `JsRuntimeHealth` | HTTP key or session |
| `analytics_alert_tick` | `AnalyticsAlerts` | Service token |
| `storage_write` / `storage_read` / `storage_delete` / `storage_list` | `Storage` namespace | Session |

### 5.2 Multiplayer Kernel
| RPC | Description |
|-----|-------------|
| `mp_create_match` | Create a match of any registered template |
| `mp_read_match_result` | Fetch persisted result for a completed match |
| `mp_list_templates` | List all registered template IDs |

### 5.3 QuizVerse
| RPC | Description |
|-----|-------------|
| `quizverse_create_match` | Thin wrapper over `mp_create_match` for QuizVerse game |
| `quizverse_load_pack` | Fetch a question pack by pack_id |
| `quizverse_list_packs` | List available question packs |
| `quizverse_live_banner_check` | Check if the live-banner CTA should be shown |
| `quizverse_get_entitlements` | Get user subscription entitlements |
| `quizverse_rc_sync` | Sync Remote Config flags to user profile |
| `quizverse_web_ad_reward` | Grant reward after web ad view |

### 5.4 Tournaments (23 RPCs)
#### User-callable
`tournament_list`, `tournament_get`, `tournament_pre_enroll`, `tournament_enter`, `tournament_submit_pack_result`, `tournament_submit_picks`, `tournament_status_get`, `tournament_leaderboard_top`, `tournament_leaderboard_around_me`, `tournament_leaderboard_friends`, `tournament_leaderboard_country`, `tournament_leaderboard_tier_league`, `tournament_leaderboard_activity_feed`, `tournament_claim_cert`, `tournament_content_get_pack`, `tournament_video_get_url`, `tournament_learning_check_submit`, `tournament_referral_get_mine`
#### Service-callable
`tournament_admin_create`, `tournament_content_request_generation`, `tournament_settle`, `tournament_eliminate_round`, `tournament_referral_settle_topN`

### 5.5 Brain Coins (P2E)
| RPC | Auth | Description |
|-----|------|-------------|
| `brain_coins_balance_get` | Session | Get wallet balance + lifetime earn |
| `brain_coins_earn` | Service token | Credit coins (code + optional variable amount) |
| `brain_coins_redemption_create` | Session | Start a Tremendous redemption |
| `brain_coins_redemption_settle` | Service token | Called by /mint API once gift card is minted |
| `brain_coins_earn_log_get` | Session | Paged earn history |

### 5.6 Quests
`quest_get`, `quest_record_event`, `quest_claim_reward`, `quest_admin_save_config`, `quest_admin_get_config`

### 5.7 TutorX
`tutorx_xp_get`, `tutorx_xp_add`, `tutorx_streak_touch`, `tutorx_quest_claim`, `tutorx_studyplan_get`, `tutorx_studyplan_toggle`

### 5.8 Library
`library_countdown_subscribe`, `library_countdown_get`, `n8n_pack_state_get`, `n8n_pack_state_set`

### 5.9 Fantasy Cricket
`fantasy_team_create`, `fantasy_team_get`, `fantasy_team_update`, `fantasy_transfer_apply`, `fantasy_transfer_history`, `fantasy_scoring_compute`, `fantasy_scoring_get`, `fantasy_league_create`, `fantasy_league_get`, `fantasy_league_leaderboard`

### 5.10 Geo / Ads
`country_tier_get`, `ad_revenue_record`, `fortune_wheel_ad_spin`

### 5.11 Identity & Account
`identity_resolve`, `account_merge`

### 5.12 Analytics & Insights
`event_enricher_flush`, `insights_aggregator_query`, `avatar_comparison_get`, `qv_kb_user_dump`

### 5.13 Admin Console
`admin_*` — admin console RPCs (admin auth required)

### 5.14 Satori Bridge RPCs
`satori_audiences_*`, `satori_feature_flags_*`, `satori_experiments_*`, `satori_live_events_*`, `satori_creator_events_*`, `satori_video_feed_*`, `satori_messages_*`, `satori_metrics_*`, `satori_webhooks_*`, `satori_taxonomy_*`, `satori_data_lake_*`

---

## 6. Storage Schema (Nakama Collections)

All storage keys use `(collection, key, userId)` tuples. `SYSTEM_USER_ID = 00000000-0000-0000-0000-000000000000` for system-owned records.

| Collection | Key pattern | Owner | Description |
|-----------|-------------|-------|-------------|
| `brain_coins` | `wallet` | user | Balance + lifetime earn counter |
| `brain_coins` | `earn_log_<unix>_<rand>` | user | Immutable earn event log |
| `brain_coins` | `redemption_<id>` | user | Redemption state machine |
| `tournaments` | `meta_<slug>` | system | Tournament metadata + status |
| `tournaments` | `entry_<slug>_<userId>` | user | Enrollment + score record |
| `tournaments` | `leaderboard_<slug>` | system | Cached leaderboard snapshot |
| `quests` | `quest_state_<questId>` | user | Step progress + claimed flag |
| `quests` | `quest_config` | system | Admin-editable quest definitions |
| `tutorx_progress` | `xp` | user | XP total + level + streak state |
| `tutorx_studyplan` | `plan_<planId>` | user | Checklist completion bitmask |
| `library` | `countdown_<examId>` | user | Exam countdown subscription |
| `n8n_pack_state` | `<packId>` | system | n8n format-agent completion gate |
| `analytics_rpc_samples` | `<rpcName>_<ts>` | system | RPC timing/error samples |
| `analytics_state` | `last_posted_3h` | system | 3h summary last-posted timestamp |
| `analytics_locks` | `slot_lock` | system | Leader-election lock for summaries |
| `geo_tier` | `ip_country_cache_<ip>` | system | IP-to-country cache |
| `ad_revenue` | `event_<ts>_<rand>` | user | Ad revenue event log |
| `fortune_wheel` | `ad_spin_<date>` | user | Daily ad-spin state |
| `web_ad_reward` | `reward_<date>` | user | Daily web ad reward state |
| `kb_enrichment` | `entry_<kbId>` | system | Knowledge-base enrichment metadata |
| `user_model` | `profile` | user | ML feature vector for personalization |
| `wow_moments` | `<momentId>` | user | WoW-moment engagement state |

---

## 7. EventBus

`src/shared/event-bus.ts` provides a synchronous, in-process pub/sub bus for cross-module side effects. Handlers run in the same Goja VM call — errors are caught per-handler so one bad handler cannot abort the emit chain.

### Well-known event names
```
currency_spent / currency_earned
item_granted / item_consumed
achievement_progress / achievement_completed / achievement_claimed
level_up / xp_earned
energy_spent / energy_refilled
stat_updated
streak_updated / streak_broken
store_purchase
score_submitted
challenge_completed
reward_granted
game_started / game_completed
session_start / session_end
event_created / event_published / event_ended / event_cancelled
quiz_completed
prize_fulfillment_requested
quest_step_completed / quest_completed
```

### Wired handlers (registered in `InitModule`)
| Emitter | Event | Handler |
|---------|-------|---------|
| Hiro Economy | `currency_earned`, `store_purchase` | `HiroAchievements` (progress unlocks) |
| Hiro Economy | `currency_spent`, `currency_earned` | `SatoriMetrics` (funnel tracking) |
| Hiro Store | `reward_granted` | `HiroRewardBucket` |
| QuestEngine | `quest_completed` | `SatoriWebhooks` (n8n trigger) |

---

## 8. Shared Utilities

### 8.1 `Storage` namespace (`src/shared/storage.ts`)
Thin wrappers over `nk.storageRead/Write/Delete/List`:
- `readJson<T>` / `writeJson` — per-user records (read:1, write:1).
- `readSystemJson<T>` / `writeSystemJson` — system-owned records (read:2 public, write:0 no-user).
- `readMultiple` / `writeMultiple` — batch reads/writes.
- `listUserRecords` — paged list of a user's records in a collection.
- Also exposes `rpc_storage_write`, `rpc_storage_read`, `rpc_storage_delete`, `rpc_storage_list` RPCs for client-side game state.

### 8.2 `RpcHelpers` namespace (`src/shared/rpc-helpers.ts`)
- `requireUserId(ctx)` — throws `UNAUTHENTICATED` if no user session.
- `parsePayload<T>(payload)` — JSON.parse with structured error.
- `requireServiceToken(ctx, payload, envKey)` — validates service_token against env var.
- `okResponse(data)` / `errorResponse(msg, code)` — canonical JSON response builders.

### 8.3 `RateLimiter` namespace (`src/shared/rate-limit.ts`)
Token-bucket rate limiter backed by Nakama storage (optimistic locking). Used by high-traffic RPCs like `brain_coins_earn` and `fortune_wheel_ad_spin`.

### 8.4 `ConfigLoader` (`src/shared/config-loader.ts`)
Reads typed config from Nakama env vars or storage (system record), with JSON schema validation. Used by tournament, geo-tier, and ad-revenue modules.

### 8.5 `EventBus` — see §7.

---

## 9. Multiplayer Kernel Templates

All templates are registered in `MpKernelModule.mount` and implement the `nkruntime.MatchHandler` interface. Opcode ranges are reserved per-template and are stable across deploys.

| Template ID | Namespace | Opcode range | Description |
|-------------|-----------|--------------|-------------|
| `sync-turn-v1` | `MpKernelSyncTurn` | 0x4000-0x4FFF | Server-authoritative timer + per-turn question generator hook. Used for QuizVerse 1v1/battle. |
| `async-turn-v1` | `MpKernelAsyncTurn` | 0x5000-0x5FFF | Fire-and-forget: players submit at own pace; server resolves when all submitted or timer expires. |
| `realtime-tick-v1` | `MpKernelRealtimeTick` | 0x6000-0x6FFF | Fixed Hz server tick, intended for avatar replication and AR. |
| `lobby-handoff-v1` | `MpKernelLobbyHandoff` | 0x7000-0x7FFF | Lobby gathers players, then hands off to another template. |
| `tournament-v1` | `MpKernelTournament` | 0x8000-0x8FFF | Bracket coordinator (single-elim default): spawns leg matches, polls results, advances rounds. |
| `live-event-v1` | `MpKernelLiveEvent` | 0x9000-0x9FFF | Spectator broadcast room for live tournaments. |
| `persistent-party-v1` | `MpKernelPersistentParty` | 0xA000-0xAFFF | Party lobby that persists across game sessions (social hub). |
| `mixed-reality-anchor-v1` | `MpKernelMrAnchor` | 0xB000-0xBFFF | MR spatial anchor sync for AR quiz experiences. |
| `conversational-party-v1` | `MpKernelConversationalParty` | 0xC000-0xCFFF | Voice-first party room, integrates `MpKernelVoice`. |
| `avatar-replication-v1` | registered by Avatar game plugin | — | Avatar state replication for social presence. |

### SyncTurnMatch lifecycle
```
PreGame  →  (all players ready or timeout)  →  Turn[1..N]  →  PostGame
  Turn: TURN_START → input_window_ms → TURN_INPUT_CLOSED → TURN_RESOLVED → SCORE_UPDATE
  Final turn: TURN_RESOLVED → MATCH_ENDED → persist MatchResultEnvelope
```
Game plugins extend via `IGenerator`: `initBlob(initParams)` + `nextTurn(context)` — return `null` to end the match.

### Voice integration
`MpKernelVoice` mints short-lived bearer tokens (TTL=60s) against the configured provider (LiveKit, Agora, Twilio, Dolby). Audio bytes never transit the kernel — the token grants the client direct provider access. Provider is selected by env var `VOICE_PROVIDER` (default: LiveKit). Spatial, PTT, and broadcast modes are supported.

---

## 10. Tournament Lifecycle

Tournaments follow a state machine stored in `tournaments / meta_<slug>`:

```
DRAFT  →  PRE_ENROLL  →  OPEN  →  ACTIVE  →  SETTLING  →  SETTLED
                                             → CANCELLED
```
| Phase | Trigger | Actions |
|-------|---------|---------|
| `PRE_ENROLL` | Admin create | Referral links go live; `tournament_pre_enroll` allowed |
| `OPEN` | `public_open_time` elapsed (opportunistic cron) | `tournament_enter` allowed; BC entrance fee charged |
| `ACTIVE` | First submit OR `start_iso` | Leaderboard accepting scores |
| `SETTLING` | `end_iso` elapsed | `settle()` triggered |
| `SETTLED` | Settlement complete | Brain Coins paid to top-N; entry rows rank-stamped |
| `CANCELLED` | `< min_players` at deadline or admin cancel | Entrance fee refunded |

**Cron delivery**: `TournamentCrons.opportunisticTick` runs at most once per 60s globally (deduped via storage version lock). Called automatically from `tournament_list` and `tournament_get` RPCs so lifecycle advances without an external scheduler.
**Elimination format**: elimination cut rounds are scheduled in `cfg.elimination_rounds` list (each has a `cut_time_iso`). At each cut, bottom-50% entries get `status=ELIMINATED`; only non-eliminated entries score in the final round.

### Anti-cheat (`TournamentAntiCheat.check`)
Run on every `tournament_submit_pack_result` call. Four checks:
1. **Latency floor** — avg ms/answer < 300ms → `soft_dq`.
2. **Daily submit ceiling** — > 200 submits/day → `soft_dq`.
3. **Honeypot rate** — server-injected known-bad questions; >60% correct on 3+ honeypots → `soft_dq`.
4. **Impossible accuracy at speed** — 100% correct with <500ms/answer → `soft_dq`.
Soft-DQ: score zeroed for leaderboard, entry status=`soft_dq`, no payout on settle. Hard appeal goes through ops.

### Settlement engine (`TournamentSettlement.settle`)
1. Read tournament meta + config.
2. Pull top 10k leaderboard entries (paged sweep for larger tournaments).
3. Dispatch to format engine (`classic / elimination / pick_n`) for per-user payout rows.
4. For each winner: `BrainCoins.earn(code='tournament_win', coins=<amount>)` — idempotent on `(slug, userId)`.
5. Write rank + payout back to each entry row; update meta status → `SETTLED`.
6. Notify settled users via Nakama notification.

---

## 11. Analytics Pipeline

### 11.1 AnalyticsAlerts (RPC instrumentation)
`AnalyticsAlerts.init(initializer)` monkey-patches `initializer.registerRpc` to wrap every subsequent handler in a timing+error sampler. Samples are buffered in-memory (up to 50 per replica, flushed every 30s) then written to `analytics_rpc_samples` in Nakama storage. Every 3h, a leader-elected replica posts a Discord webhook with:
- Top-5 slowest RPCs (P50/P95/P99 latency).
- Top-5 most-errored RPCs (error rate %).
- Per-group call counts (quizverse_* / tournament_* / brain_coins_* / mp_* / etc.).
- Total RPC calls + error rate for the slot.

External cron can also trigger a forced flush via `analytics_alert_tick` RPC.

### 11.2 EventEnricher (`src/analytics/event-enricher.ts`)
Enriches raw Satori event payloads with server-side attributes (country, tier, experiment assignments) before forwarding to the data lake. Registered as a Nakama before-hook on `event` API calls.

### 11.3 InsightsAggregator (`src/analytics/insights-aggregator.ts`)
Aggregates stored event samples into per-game daily/weekly KPI snapshots. Exposed via `insights_aggregator_query` RPC. Used by the admin console dashboard.

### 11.4 AvatarComparison (`src/analytics/avatar-comparison-rpc.ts`)
A/B comparison analytics for avatar customization choices. Returns cohort size + metric deltas between avatar variants.


---

## 12. Developer Runbook

### 12.1 Adding a new RPC
1. Create (or extend) a namespace file in `src/<domain>/`.
2. In the namespace, add a function `function rpc<Name>(ctx, logger, nk, payload): string { ... }`.
3. In `register(initializer)`, call `initializer.registerRpc("literal_id_string", rpc<Name>)` — **the ID must be a string literal** (not a variable), or postbuild.js and Nakama Goja cannot extract the function key.
4. Mount the module in `src/main.ts` `InitModule` in the correct order (after AnalyticsAlerts.init so it gets instrumented).
5. Run `tsc && node postbuild.js`. Confirm the new ID appears in `__TS_OWNED_RPCS` in the compiled output.
6. Check `nakama_js_health` RPC count incremented by 1 in the CI smoke test.

### 12.2 Adding a Multiplayer template
1. Implement `nkruntime.MatchHandler` in `src/multiplayer-kernel/templates/<name>-match.ts`.
2. Reserve an opcode range (document in the template file header).
3. Call `MpKernelModule.registerTemplateId(id)` and `initializer.registerMatch(id, { ... })` inside `MpKernelModule.mount`.
4. Add the ID to `MpKernelModule.TEMPLATE_IDS`.

### 12.3 Adding a Brain Coins earn code
1. Add the code + `EarnRule` to `BrainCoins.EARN_RULES` in `src/p2e/brain_coins.ts`.
2. If the amount is variable (not `coinsPerEvent`), add the code to `VARIABLE_AMOUNT_CODES`.
3. Redeploy. No migration needed — new codes are gated by the rules map.

### 12.4 Adding a Tournament format
1. Create `src/tournaments/formats/<name>.ts` implementing the format interface.
2. Register it in `src/tournaments/formats/index.ts`.
3. Add the format key to `TournamentEconomy.LAUNCH_SLATE` entries as needed.

### 12.5 Local development
```bash
# Install deps
npm install
# Build (TypeScript → JS bundle + postbuild injection)
npm run build         # alias for: tsc && node postbuild.js
# Watch mode
npm run watch
# Tests (Nakama-stub environment)
npm test
# Start local Nakama stack (Docker Compose)
docker-compose up -d
```

Nakama hot-reload: the docker-compose volume-mounts `data/modules/` so editing the compiled JS triggers a Goja reload without a full container restart (flag `--runtime.js_entrypoint_prefix`). Use `npm run watch` to keep the build live.

### 12.6 Environment variables
| Variable | Used by | Notes |
|----------|---------|-------|
| `BRAIN_COINS_SERVICE_TOKEN` | BrainCoins, Tournaments | Service→service auth for earn/settle RPCs |
| `TOURNAMENT_SERVICE_TOKEN` | TournamentRpcs | Same value accepted for tournament admin RPCs |
| `DISCORD_NAKAMA_WEBHOOK_URL` | AnalyticsAlerts | 3h summary + error alert destination |
| `VOICE_PROVIDER` | MpKernelVoice | `livekit` (default) / `agora` / `twilio` / `dolby` / `none` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` / `LIVEKIT_URL` | voice-providers/livekit | LiveKit server credentials |
| `CONTENT_FACTORY_URL` | ContentFactoryClient | AI question generation service endpoint |
| `CONTENT_FACTORY_SERVICE_TOKEN` | ContentFactoryClient | Auth for CF requests |
| `HTTP_KEY` | Health probe, CI smoke test | Nakama HTTP key for server-to-server calls |
| `N8N_WEBHOOK_URL` | SatoriWebhooks | n8n automation webhook |
| `TREMENDOUS_API_KEY` | BrainCoins redemption (web API) | Gift card minting — used by web server, not Nakama |

---

_End of CODEBASE_WIKI.md_

