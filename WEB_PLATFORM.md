# Nakama Web Platform Specification

> **Definitive engineering spec for the Admin Console + Player App.**
> Ships with every Nakama deployment. All screens, RPCs, architecture, and build order in one place.

---

## 1. What This Is

Two React single-page applications sharing a typed RPC client, deployed as a pnpm monorepo at `nakama/web/`:

| App | Port | Auth Mode | Purpose |
|-----|------|-----------|---------|
| **Admin Console** | 5173 | Server key (`defaultkey`) via HTTP Basic | LiveOps, economy tuning, player support, analytics |
| **Player App** | 5174 | Bearer token from Nakama auth | Player-facing game metagame, progression, social |

Both talk exclusively to Nakama's RPC gateway at `http://localhost:7350/v2/rpc/{id}`, plus Nakama HTTP API for account-level operations.

---

## 2. Deployment Context

From `docker-compose.yml`:

```
Nakama    3.35.0    :7349 (gRPC)  :7350 (HTTP/RPC)  :7351 (Console)  :9100 (Prometheus)
CockroachDB         :26257        :8080
Prometheus          :9090
```

Runtime modules: `./data/modules/index.js` — 442 RPCs across Hiro and Satori.

Server key: `defaultkey` (overridable via `--socket.server_key`).

---

## 3. Three-Layer Architecture

Every screen maps to one of three layers. Cross-layer screens are explicitly called out.

### Layer 1 — Nakama Core (Backend Infrastructure)

Auth, sockets, storage, wallet base, multiplayer, notifications, RPC gateway.

### Layer 2 — Hiro (Meta-Game Systems)

Quests, battle pass, streaks, inventory, rewards, events, progression, offers, economy, energy, challenges, achievements, tutorials, unlockables, auctions, incentives.

14 configurable subsystems: `economy`, `inventory`, `achievements`, `progression`, `energy`, `stats`, `streaks`, `event_leaderboards`, `store`, `challenges`, `tutorials`, `unlockables`, `auctions`, `incentives`.

### Layer 3 — Satori (LiveOps Intelligence)

Feature flags, segmentation, A/B testing, personalized offers, dynamic configs, campaign targeting, event rollout, audience-specific experiences.

6 subsystems: `audiences`, `flags`, `experiments`, `live_events`, `messages`, `metrics`.

### Cross-Layer Interactions

- **Home Dashboard**: Nakama (session, notifications) + Hiro (level, currencies, streaks) + Satori (banner personalization, module ordering)
- **Post-Match Results**: Nakama (match result) + Hiro (XP, quest/battle pass progress, rewards) + Satori (follow-up offer, recommended mode)
- **Store**: Nakama (wallet balance) + Hiro (catalog, purchase logic) + Satori (personalized sections, targeted pricing)
- **Events Hub**: Nakama (leaderboard engine) + Hiro (event milestones, reward calc) + Satori (event visibility by segment)

---

## 4. Tech Stack

| Concern | Choice |
|---------|--------|
| Build | Vite + React 18 + TypeScript |
| Styling | TailwindCSS v4 + shadcn/ui |
| Routing | React Router v6 (deep-linking from push/inbox) |
| Data | TanStack Query v5 (fetch, cache, optimistic mutations) |
| State | Zustand (auth, global stores) |
| Icons | Lucide React |
| Animation | Framer Motion (reward flows, transitions) |
| Charts | Recharts (admin analytics, player stats) |
| Code Editor | Monaco Editor (admin JSON config editing) |

---

## 5. Monorepo Structure

```
nakama/web/
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── packages/
│   ├── shared/              # RPC client, types, auth helpers, constants
│   │   └── src/
│   │       ├── rpc/
│   │       │   ├── client.ts        # Generic POST /v2/rpc/{id} wrapper
│   │       │   ├── nakama/          # Auth endpoints, console HTTP API, storage, wallet base
│   │       │   ├── hiro/            # 14 subsystem helpers
│   │       │   ├── satori/          # 6 subsystem helpers
│   │       │   └── types/           # Request/response types by layer
│   │       ├── hooks/
│   │       │   └── useRpc.ts        # TanStack Query wrapper
│   │       ├── auth/
│   │       │   ├── adminAuth.ts     # Server key auth store
│   │       │   └── playerAuth.ts    # Session token auth store
│   │       └── constants.ts
│   ├── admin/               # Admin/LiveOps Console (Vite SPA)
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── routes/
│   │       ├── components/
│   │       ├── pages/
│   │       └── layouts/
│   └── player/              # Player App (Vite SPA)
│       ├── vite.config.ts
│       └── src/
│           ├── App.tsx
│           ├── routes/
│           ├── components/
│           ├── pages/
│           └── layouts/
```

---

## 6. Shared RPC Client

Generic wrapper around `POST http://localhost:7350/v2/rpc/{id}`:

- **Server-key auth** (admin): HTTP Basic with `defaultkey`
- **Bearer-token auth** (player): Nakama auth endpoints returning session token
- Typed request/response per RPC group
- Error handling, retry, timeout

Player auth endpoints:
- `/v2/account/authenticate/device`
- `/v2/account/authenticate/email`
- `/v2/account/authenticate/custom` (social, extensible)

---

## 7. Admin Console

### 7.1 Navigation

Sidebar with collapsible groups:

```
Dashboard
─────────────────
Hiro Systems
  Config Editor
  Economy / Store
  Achievements
  Progression
  Energy
  Streaks
  Challenges
  Event Leaderboards
  Unlockables
  Auctions
  Tutorials
  Incentives
  Inventory
─────────────────
Satori LiveOps
  Config Editor (6 subsystems)
  Feature Flags
  Experiments (A/B)
  Live Events
  Audiences
  Messages / Campaigns
  Metrics
  Data Lake
  Taxonomy
  Webhooks
─────────────────
Content Config
  Offer Manager
  Quest / Mission Config
  Battle Pass Config
  Achievement / Badge Admin
  Leaderboard / Tournament Admin
─────────────────
Players
  Player Search / Inspector
  Account Management
  Mailbox / Grants
─────────────────
Operations
  Storage Browser
  Config Export/Import
  Match Inspector
  Server Logs
  Cache Management
  Retention / Winback
  Advanced Economy
─────────────────
Analytics
  Overview
  Cohort Retention
  Events Timeline
```

### 7.2 Screens — Nakama Layer

#### Dashboard (`/admin`)

| RPC / Endpoint | Purpose |
|---|---|
| `admin_health_check` | Server status |
| `cache_stats` | Cache hit rates |
| `rate_limit_status` | Rate limiter |
| `satori_metrics_prometheus` | Key metrics overlay |

Quick actions: create event, toggle flag, send message, grant rewards.

#### Account Management (`/admin/players/:userId/account`)

| RPC / Endpoint | Purpose |
|---|---|
| `DELETE /v2/console/account/:id` | Delete account |
| `POST /v2/console/account/:id/ban` | Ban account |
| `POST /v2/console/account/:id/unban` | Unban account |
| `admin_user_data_get` / `set` / `delete` | Metadata CRUD |

#### Match Inspector (`/admin/matches`)

| RPC / Endpoint | Purpose |
|---|---|
| `GET /v2/console/match` | List live matches |
| `GET /v2/console/match/:id` | Match details |

Live match table with player counts, labels, state.

#### Server Logs (`/admin/logs`)

Docker log tailing via server-side proxy (`docker logs nakama --tail 200 -f`). WebSocket or polling streamer. Filter by DEBUG/INFO/WARN/ERROR.

#### Storage Browser (`/admin/storage`)

| RPC / Endpoint | Purpose |
|---|---|
| `admin_storage_list` | Browse collections |
| `storage_read` / `storage_write` | View/edit objects |

### 7.3 Screens — Hiro Layer

#### Hiro Config Editor (`/admin/hiro/:system`)

| RPC / Endpoint | Purpose |
|---|---|
| `admin_config_get` | Read JSON config |
| `admin_config_set` | Write JSON config |
| `admin_cache_invalidate` | Post-save cache clear |

Monaco JSON editor with validation. Systems: economy, inventory, achievements, progression, energy, stats, streaks, event_leaderboards, store, challenges, tutorials, unlockables, auctions, incentives.

#### Player Inspector (`/admin/players/:userId?`)

| RPC / Endpoint | Purpose |
|---|---|
| `admin_user_search` | Search by username/ID |
| `admin_player_inspect` | Full profile dump |
| `admin_wallet_view` / `grant` / `reset` | Economy ops |
| `admin_inventory_grant` | Grant items |
| `admin_mailbox_send` | Send messages with rewards |
| `hiro_personalizer_preview` | Preview personalized config |
| `hiro_personalizer_set_override` | Per-user config override |
| `admin_events_timeline` | Player event history (Satori) |

#### Offer Management (`/admin/content/offers`)

Purpose-built offer creation UI. Fields: title, assets, contents, price, duration, purchase limits, audience, trigger conditions, placement (store/homepage/post-match/comeback/battle pass page). Preview card and detail panel.

RPCs: `admin_config_get("store")` / `admin_config_set("store")` for offer catalog, `satori_audiences_get_memberships` for targeting.

#### Quest / Mission Config (`/admin/content/quests`)

Visual quest builder. Fields: mission title, category, objective type, target amount, linked mode, reward payload, repeatability, time window, audience targeting. Preview quest card, detail panel, completion toast.

RPCs: `admin_config_get("challenges")` / `admin_config_set("challenges")`.

#### Battle Pass Config (`/admin/content/battlepass`)

Tier editor with drag-and-drop rewards. Sections: season settings, XP sources, tiers, free rewards, premium rewards, premium pricing, featured art, visibility rules. Simulated player preview.

RPCs: `admin_config_get("progression")` / `admin_config_set("progression")`.

#### Achievement / Badge Admin (`/admin/content/achievements`)

Manage definitions, badge display rules, grant achievements to players. RPCs: `admin_config_get("achievements")` / `admin_config_set("achievements")`, `admin_player_inspect` for grant operations.

#### Leaderboard / Tournament Admin (`/admin/content/leaderboards`)

Create, manage, reset leaderboards and tournaments. Reward bracket configuration. RPCs: `admin_config_get("event_leaderboards")` / `admin_config_set("event_leaderboards")`, Nakama HTTP API for tournament CRUD.

### 7.4 Screens — Satori Layer

#### Satori Config Editor (`/admin/satori/config`)

Monaco JSON editor for all 6 Satori subsystems:

| RPC / Endpoint | Purpose |
|---|---|
| `satori_config_get(system)` | Read Satori config |
| `satori_config_set(system)` | Write Satori config |

Systems: `audiences`, `flags`, `experiments`, `live_events`, `messages`, `metrics`.

#### Feature Flags (`/admin/satori/flags`)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_flags_get_all` | List all flags |
| `satori_flags_set` / `admin_flag_toggle` | Toggle/create |

Table: name, value, enabled, audience, rollout %, last modified.

#### Experiments / A/B Testing (`/admin/satori/experiments`)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_experiments_get` | List experiments |
| `satori_experiments_get_variant` | Check variant assignment |
| `admin_experiment_setup` | Create/update |

Variant editor with weight sliders, audience targeting. Metrics: retention, conversion, ARPPU, session length with confidence indicators.

#### Live Events (`/admin/satori/events`)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_live_events_list` | Event listing |
| `admin_live_event_schedule` | Create/edit |

Calendar/timeline view. Status controls: draft, scheduled, live, paused, ended, archived. Hiro event reward milestones cross-linked.

#### Audiences / Segmentation (`/admin/satori/audiences`)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_audiences_get_memberships` | View memberships |
| `satori_audiences_compute` | Compute audience |

Segment builder with rule composer: level, spend tier, activity recency, region, mode preference, event participation, battle pass ownership, churn risk, achievement state. Estimated reach preview.

#### Messages / Campaigns (`/admin/satori/messages`)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_messages_list` | List campaigns |
| `satori_messages_broadcast` | Broadcast |
| `admin_mailbox_send` | Player mailbox (Hiro) |

Compose form: title, message, CTA, deep-link, send window, audience, cooldown rules, rewards JSON.

#### Metrics / Analytics (`/admin/satori/metrics`)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_metrics_query` | Query metrics |
| `satori_metrics_define` | Define custom metrics |
| `satori_metrics_set_alert` | Alert thresholds |
| `satori_metrics_prometheus` | Prometheus export |

Recharts dashboards: DAU/MAU, retention, ARPU, event participation.

#### Data Lake (`/admin/satori/datalake`)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_datalake_config` | View config |
| `satori_datalake_upsert_target` | Add/update target |
| `satori_datalake_delete_target` | Remove target |
| `satori_datalake_set_enabled` | Toggle |
| `satori_datalake_set_retention` | Retention policy |
| `satori_datalake_manual_export` | Manual trigger |

Targets: BigQuery, Snowflake, Redshift, S3.

#### Taxonomy (`/admin/satori/taxonomy`)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_taxonomy_schemas` | List schemas |
| `satori_taxonomy_upsert` | Create/update |
| `satori_taxonomy_delete` | Delete |
| `satori_taxonomy_validate` | Validate event |
| `satori_taxonomy_strict_mode` | Strict mode toggle |

Event schema editor: required metadata, types, categories.

#### Webhooks (`/admin/satori/webhooks`)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_webhooks_list` | List |
| `satori_webhooks_upsert` | Create/update |
| `satori_webhooks_delete` | Delete |
| `satori_webhooks_test` | Test ping |

HMAC-SHA256 signed outbound webhooks.

### 7.5 Screens — Multi-Layer

#### Config Export/Import (`/admin/config`)

| RPC / Endpoint | Purpose |
|---|---|
| `admin_bulk_export` | Export all Hiro + Satori configs |
| `admin_bulk_import` | Import config bundle |
| `admin_cache_invalidate` | Clear caches |

#### Retention / Winback (`/admin/ops/retention`)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_identity_get` | Player identity/segments |
| `satori_audiences_compute` | Churn risk audience |
| `admin_live_event_schedule` | Re-engagement events |
| `satori_messages_broadcast` | Winback messages |
| `hiro_streaks_get` | Streak state |

Churn risk signals, re-engagement scheduling, winback status, streak shields.

#### Advanced Economy (`/admin/ops/economy`)

| RPC / Endpoint | Purpose |
|---|---|
| `admin_wallet_view` / `grant` / `reset` | Wallet ops |
| `hiro_store_list` / `hiro_store_purchase` | Store sim |
| `admin_inventory_grant` | Item grants |
| `admin_config_get("economy")` | Economy config |

Wallet transfers, IAP validation, reward buckets, economy audit views.

#### Analytics Overview (`/admin/analytics`)

Nakama: server health, active connections, match counts.
Hiro: economy flow (sources/sinks), reward claim rates.
Satori: `analytics_cohort_retention`, `analytics_arpu`, `admin_events_timeline`.
Recharts dashboards combining all three layers.

---

## 8. Player App

### 8.1 Navigation

Bottom tab bar (mobile-first responsive):

```
Home  |  Play  |  Events  |  Store  |  Profile
```

Secondary navigation via headers/tabs within screens.

### 8.2 Screens — Nakama Layer

#### Auth (`/auth`)

| RPC / Endpoint | Purpose |
|---|---|
| `/v2/account/authenticate/device` | Guest login |
| `/v2/account/authenticate/email` | Email login |
| `satori_identity_update_properties` | Tag auth method |
| `satori_event` | Track signup/login |

Guest flow fastest. Social extensible. Clear account-linking explanation.

#### Play Flow (`/play`)

| RPC / Endpoint | Purpose |
|---|---|
| `get_game_registry` | Available modes |
| `matchmaking_find_match` | Queue |
| `matchmaking_cancel` | Cancel |
| `matchmaking_get_status` | Status |
| `matchmaking_create_party` | Party |

Post-match results screen: XP earned, currencies, event points, battle pass XP, quest progress, leaderboard delta, rewards unlocked. Animated reward sequence.

Hiro hooks: `hiro_progression_add_xp`, `submit_score_and_sync`, quest/mission progress.
Satori hooks: personalized follow-up offer, recommended mode.

#### Leaderboards (`/leaderboards`)

| RPC / Endpoint | Purpose |
|---|---|
| `get_all_leaderboards` / `get_leaderboard` | Core leaderboards |
| `hiro_leaderboards_list` / `records` | Hiro event LBs |
| `get_friend_leaderboard` | Friends tab |
| `tournament_list_active` / `get_leaderboard` | Tournaments |

Tabs: global, friends, event, tournament.

#### Chat / Social (`/chat`)

| RPC / Endpoint | Purpose |
|---|---|
| Nakama realtime socket | WebSocket messaging |
| `friends_list` / `send_friend_invite` | Friends |
| `get_user_groups` / `create_game_group` | Groups/clans |

Friend DMs, group/clan chat, realtime messaging.

#### Notifications / Inbox (`/inbox`)

| RPC / Endpoint | Purpose |
|---|---|
| `get_notifications` / `mark_notifications_read` | System notifications |
| `hiro_mailbox_list` / `claim` / `claim_all` | Hiro mail |
| `satori_messages_list` / `read` / `delete` | Satori campaigns |

Filterable inbox with claim CTAs.

#### Profile (`/profile`)

| RPC / Endpoint | Purpose |
|---|---|
| `player_get_full_profile` | Account info |
| `get_player_metadata` | Metadata |
| `hiro_achievements_list` | Achievements |
| `hiro_stats_get` | Stats |
| `badges_get_all` / `set_displayed` | Badges |
| `character_get_state` / `set_active` | Character |
| `league_get_state` | League position |

#### Friends / Social (`/friends`)

| RPC / Endpoint | Purpose |
|---|---|
| `friends_list` / `send_friend_invite` / `accept_friend_invite` | Core social |
| `friends_challenge_user` / `friends_spectate` | Competitive social |
| `friend_streak_get_state` / `record_contribution` | Hiro social streaks |
| `friend_quest_get_state` / `complete` | Hiro social quests |
| `get_user_groups` / `create_game_group` | Groups/clans |

#### Settings (`/settings`)

Account management, notification preferences, linked accounts, privacy controls. Uses Nakama account endpoints and `satori_identity_update_properties` for preference tracking.

### 8.3 Screens — Hiro Layer

#### Onboarding (`/onboarding`)

| RPC / Endpoint | Purpose |
|---|---|
| `rpc_change_username` / `rpc_update_player_metadata` | Profile setup |
| `onboarding_get_state` / `update_state` / `complete_step` | Onboarding state |
| `onboarding_set_interests` / `claim_welcome_bonus` | Starter gift |
| `hiro_tutorials_get` / `advance` | Guided flow |

Multi-step wizard: username, avatar, preferences, starter gift, tutorial.

#### Daily Rewards / Streaks (`/daily`)

| RPC / Endpoint | Purpose |
|---|---|
| `daily_rewards_get_status` / `claim` | Daily rewards |
| `hiro_streaks_get` / `update` / `claim` | Streaks |
| `streak_shield_freeze` / `repair` | Recovery |

Calendar UI with animations, one-tap claim.

#### Quests / Missions (`/quests`)

| RPC / Endpoint | Purpose |
|---|---|
| `get_daily_missions` / `submit_mission_progress` / `claim_mission_reward` | Daily |
| `weekly_goals_get_status` / `update_progress` / `claim_reward` | Weekly |
| `monthly_milestones_get_status` / `update_progress` | Monthly |

Tabs: daily, weekly, monthly, event, seasonal.

#### Battle Pass (`/battlepass`)

| RPC / Endpoint | Purpose |
|---|---|
| `season_pass_get_status` / `add_xp` / `claim_reward` | Core battle pass |
| `season_pass_complete_quest` / `purchase_premium` | Premium flow |

Horizontal tier track with free/premium lanes. Satori: personalized premium upgrade pricing.

#### Store (`/store`)

| RPC / Endpoint | Purpose |
|---|---|
| `hiro_store_list` / `hiro_store_purchase` | Catalog + purchase |
| `game_coupon_list` / `redeem` | Coupons |
| `game_gift_card_list` / `purchase` | Gift cards |
| `satori_flags_get` | Layout variants |

Featured bundles, limited-time offers, currencies, cosmetics. Satori-personalized sections.

#### Inventory / Collections (`/inventory`)

| RPC / Endpoint | Purpose |
|---|---|
| `hiro_inventory_list` / `consume` | Inventory |
| `collectables_get_all` / `equip` | Collectables |
| `collections_get_status` / `unlock_item` / `equip_item` | Collections |

Tabs: currencies, consumables, cosmetics, collectables.

#### Events Hub (`/events`)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_live_events_list` | Active/upcoming events |
| `hiro_event_lb_list` / `submit` / `claim` | Event leaderboards |

Event cards with timers, progress, rewards. Detail: milestones, leaderboard, rules.

#### Energy System (`/energy`)

| RPC / Endpoint | Purpose |
|---|---|
| `hiro_energy_get` / `spend` / `grant` | Core energy |

Energy bar, cooldown timer, refill purchase, boost.

#### Challenges (`/challenges`)

| RPC / Endpoint | Purpose |
|---|---|
| `hiro_challenges_list` / `join` / `submit` / `claim` | Challenge lifecycle |

Competitive PvE/PvP objectives, timed competitions, rewards.

#### Teams / Guilds (`/teams`)

| RPC / Endpoint | Purpose |
|---|---|
| `get_user_groups` / `create_game_group` | Core groups |
| `get_clan_challenges` / `contribute_clan_challenge` | Clan challenges |
| `get_clan_leaderboard` | Clan leaderboard |

Team creation, management, clan challenges, clan LB.

#### Referral / Invite (`/referral`)

| RPC / Endpoint | Purpose |
|---|---|
| `referral_get_code` / `referral_apply` / `referral_get_rewards` | Referral system |

Referral code generation, sharing, reward tracking.

### 8.4 Screens — Satori Layer

#### Personalized UX (cross-cutting)

| RPC / Endpoint | Purpose |
|---|---|
| `satori_flags_get_all` | Feature toggles, gating, layout variants |
| `satori_experiments_get_variant` | A/B variant selection |
| `satori_identity_get` | Audience membership |

Dynamically reorder home modules, select banners, personalize offers, suppress fatigue.

### 8.5 Screens — Multi-Layer Composites

#### Splash / Session Check

- Nakama: validate stored session token
- Satori: `satori_flags_get_all` (remote config), `satori_identity_get` (identity)
- Hiro: `hiro_progression_get` / `hiro_streaks_get` (preload state)

#### Home Dashboard (`/`)

- Nakama: session, avatar, notifications badge
- Hiro: level (`hiro_progression_get`), currencies (`get_user_wallet`), streaks (`hiro_streaks_get`)
- Satori: hero banner (`satori_live_events_list`, `satori_flags_get`), module ordering, inbox badge
- Module grid: play, events, daily rewards, quests, battle pass, store, leaderboards, friends

---

## 9. Phase 4 — Extended Features

Built after all core screens are stable:

- Fortune Wheel: `fortune_wheel_get_state` / `spin`
- IntelliDraws: `intellidraws_list` / `enter` / `winners`
- Async Challenges: `async_challenge_*` RPCs
- Smart Review (spaced repetition): `smart_review_get_cards` / `rate_card`
- Compatibility Mode: `compatibility_*` RPCs
- Weekly Recap: `weekly_recap_get`
- Rewarded Ads: `rewarded_ad_*` RPCs
- Push Notifications: `push_register_token` / `push_send_event`
- Clan features: `get_clan_challenges` / `contribute_clan_challenge` / `get_clan_leaderboard`
- Fantasy League: `fantasy_*` RPCs
- Game-specific (QuizVerse / LastToLive): `quizverse_*` / `lasttolive_*` RPCs

---

## 10. Build Order — 9 Sprints, 43 Items

### Dependency Graph

```
Sprint 1: Skeleton ─┬─► Sprint 2: Admin Core ──► Sprint 4: Admin Satori ──► Sprint 6: Admin Content Config ──► Sprint 8: Admin Ops
                     │                                                                                                     │
                     └─► Sprint 3: Player Core ──► Sprint 5: Player Extended ──► Sprint 7: Player Social ──────────────────┴──► Sprint 9: Polish
```

Sprints 2-3 parallel. Sprints 4-5 parallel. Sprint 6 needs 4. Sprint 7 needs 5. Sprint 8 needs 6. Sprint 9 converges.

---

### Sprint 1 — Skeleton (both apps)

| # | Item | ID |
|---|------|----|
| 1 | Monorepo scaffold, shared deps, shared RPC client | `scaffold`, `rpc-client` |
| 2 | Admin: auth + layout + router skeleton | `admin-layout` |
| 3 | Player: auth + layout + router skeleton | `player-layout` |

### Sprint 2 — Admin Core

| # | Item | ID |
|---|------|----|
| 4 | Dashboard with health/metrics | `admin-dashboard` |
| 5 | Hiro Config Editor — Monaco JSON | `admin-hiro-config` |
| 6 | Player Inspector — search + profile + wallet + inventory + grants | `admin-player-inspector` |
| 7 | Feature Flags page | `admin-flags` |
| 8 | Live Events page | `admin-events` |

### Sprint 3 — Player Core

| # | Item | ID |
|---|------|----|
| 9 | Home dashboard with progression/currencies top bar | `player-home` |
| 10 | Daily Rewards / Streaks screen | `player-daily` |
| 11 | Store — list + purchase | `player-store` |
| 12 | Quests / Missions — daily + weekly | `player-quests` |
| 13 | Battle Pass — tier view + claim | `player-battlepass` |

### Sprint 4 — Admin Satori + Accounts

| # | Item | ID |
|---|------|----|
| 14 | Experiments / A/B testing | `admin-experiments` |
| 15 | Audiences / Segments | `admin-audiences` |
| 16 | Messages / Campaigns | `admin-messages` |
| 17 | Account Management — ban/unban/delete | `admin-accounts` |
| 18 | Storage Browser | `admin-storage` |
| 19 | Satori Config Editor — all 6 subsystems | `admin-satori-config` |

### Sprint 5 — Player Extended

| # | Item | ID |
|---|------|----|
| 20 | Events Hub + Event Detail | `player-events` |
| 21 | Leaderboards — global + friends + event + tournament | `player-leaderboards` |
| 22 | Inventory / Collections | `player-inventory` |
| 23 | Notifications / Inbox | `player-inbox` |
| 24 | Profile + Friends | `player-profile` |
| 25 | Energy System — energy bar, cooldown, refill | `player-energy` |
| 26 | Settings — account, notification prefs, linked accounts | `player-settings` |

### Sprint 6 — Admin Content Config

| # | Item | ID |
|---|------|----|
| 27 | Offer Management — creation UI, preview, placement, audience | `admin-offer-manager` |
| 28 | Quest / Mission Config — visual builder, mode linking, rewards | `admin-quest-config` |
| 29 | Battle Pass Config — tier editor, season settings, XP sources | `admin-battlepass-config` |
| 30 | Achievement / Badge Admin — definitions, display rules, grant | `admin-achievements` |
| 31 | Leaderboard / Tournament Admin — create, manage, reset, brackets | `admin-leaderboard-config` |

### Sprint 7 — Player Social + Competitive

| # | Item | ID |
|---|------|----|
| 32 | Challenges — PvE/PvP objectives, timed competitions | `player-challenges` |
| 33 | Chat / Social — friend DMs, group/clan chat, Nakama socket | `player-chat` |
| 34 | Teams / Guilds — creation, management, clan challenges, clan LB | `player-teams` |
| 35 | Referral / Invite — code, sharing, reward tracking | `player-referral` |

### Sprint 8 — Admin Ops + Analytics

| # | Item | ID |
|---|------|----|
| 36 | Match Inspector | `admin-matches` |
| 37 | Server Logs viewer | `admin-logs` |
| 38 | Config Export/Import | `admin-config-export` |
| 39 | Retention / Winback — churn risk, re-engagement, streak shields | `admin-retention` |
| 40 | Advanced Economy — wallet transfers, IAP validation, reward buckets, audit | `admin-advanced-economy` |
| 41 | Analytics — metrics, data lake, taxonomy, webhooks, cohort/ARPU | `admin-analytics` |

### Sprint 9 — Personalization + Polish

| # | Item | ID |
|---|------|----|
| 42 | Personalized UX layer — Satori-driven dynamic content | `player-personalization` |
| 43 | Phase 4 features as needed | — |

---

## 11. What Still Requires the Nakama Console / CLI

| Task | Where |
|------|-------|
| Runtime module deployment (updating `index.js`) | CLI / CI/CD pipeline |
| Database migrations | CLI (`nakama migrate up`) |
| Server restart / scaling | Docker Compose / K8s |
| Group/channel moderation (kick, ban from group) | Nakama Console (:7351) |

Everything else — economy tuning, LiveOps, player support, analytics, feature flags, experiments, events, campaigns, content config — is handled entirely from the custom Admin Console.

---

## 12. Environment Setup

```bash
# Prerequisites
node >= 20
pnpm >= 9

# Start Nakama stack
cd nakama && docker compose up -d

# Install and run web apps
cd web && pnpm install
pnpm --filter admin dev     # http://localhost:5173
pnpm --filter player dev    # http://localhost:5174
```

Environment variables (auto-detected from docker-compose defaults):

```
VITE_NAKAMA_HTTP=http://localhost:7350
VITE_NAKAMA_SERVER_KEY=defaultkey
VITE_NAKAMA_CONSOLE=http://localhost:7351
```

---

## 13. Design Principles

1. **Always surface value** — rewards, progress, timers, rank, claimable value visible at all times.
2. **Reduce decision friction** — one-tap path from quest to correct mode, event to entry, reward to checkout.
3. **Meta visible but not noisy** — progression always visible, gameplay never overwhelmed.
4. **Personalization feels helpful** — relevant offers, events, reminders; never manipulative.
5. **Every screen answers** — what can I do now? what do I earn? how long is it available? what should I do next?
6. **Deep-link everything** — every LiveOps surface deep-links from push, inbox, event CTA, quest CTA, store CTA.

---

## 14. RPC Documentation & Developer Reference

Three tiers of RPCs power this platform. Each tier maps to one of the architectural layers and has its own documentation set.

### 14.1 Documentation Map

| Doc | Path | Covers |
|-----|------|--------|
| **Complete RPC Reference** | `docs/COMPLETE_RPC_REFERENCE.md` | All 101 custom game RPCs — identity, wallet, leaderboard, social, chat, groups, daily systems, analytics, push. Full param/response docs + Unity C# examples. |
| **Client Integration Guide** | `docs/CLIENT_INTEGRATION_GUIDE.md` | End-to-end client integration: auth patterns, RPC reference organized by game phase, best practices, rate limiting, capability matrix, integration recipes, storage collections. |
| **Player RPC Documentation** | `docs/RPC_DOCUMENTATION.md` | Player-oriented RPC details — wallet operations, leaderboard functions, naming conventions, error handling. |
| **Game RPC Quick Reference** | `_archived_docs/game_guides/GAME_RPC_QUICK_REFERENCE.md` | Game-specific RPC cheat sheet — QuizVerse, LastToLive, and custom game RPCs with copy-paste payloads. |
| **Game Onboarding Guide** | `_archived_docs/game_guides/GAME_ONBOARDING_COMPLETE_GUIDE.md` | Step-by-step new-game onboarding: registration, identity setup, wallet creation, first match flow. |
| **Documentation Summary** | `docs/DOCUMENTATION_SUMMARY.md` | Index of all documentation created, implementation status, and learning path for new developers. |

### 14.2 RPCs by Architectural Layer

#### Layer 1 — Nakama Core (Custom Game RPCs)

These are the custom RPCs registered in `data/modules/index.js` for game-specific logic. They use `device_id` + `game_id` as primary identifiers.

**Key categories** (see `docs/COMPLETE_RPC_REFERENCE.md` for full details):

| Category | Example RPCs | Doc Section |
|----------|-------------|-------------|
| Identity & Auth | `create_or_sync_user`, `get_player_metadata` | §3 |
| Wallet | `create_player_wallet`, `get_wallet_balance`, `update_wallet_balance`, `wallet_transfer_between_game_wallets` | §3 |
| Leaderboards | `submit_leaderboard_score`, `get_leaderboard`, `get_all_leaderboards` | §5 |
| Social & Friends | `send_friend_invite`, `friends_list`, `friends_challenge` | §6 |
| Chat & Messaging | `send_group_chat_message`, `send_direct_message`, `send_chat_room_message` | §7 |
| Groups & Guilds | `create_game_group`, group wallet/XP RPCs | §8 |
| Daily Systems | `daily_rewards_claim`, `daily_missions_get`, `daily_missions_update_progress` | §9 |
| Analytics | `analytics_log_event` | §10 |
| Push Notifications | `send_push_notification` | §11 |
| Game-Specific | `quizverse_*`, `lasttolive_*` prefixed RPCs | §4 |

**GameID system**: Every RPC namespaces data by `game_id` (UUID for custom games, string name for legacy built-in games like `"quizverse"`). See `docs/COMPLETE_RPC_REFERENCE.md` §2 for the full explanation.

#### Layer 2 — Hiro Meta-game (14 Subsystems)

Hiro RPCs follow the pattern `hiro_{system}_{action}`. All are called via `POST /v2/rpc/hiro_{system}_{action}`.

| System | Key RPCs | What It Controls |
|--------|----------|-----------------|
| **economy** | `hiro_economy_grant`, `hiro_economy_purchase`, `hiro_economy_list` | Currencies, virtual goods, IAP validation |
| **inventory** | `hiro_inventory_list`, `hiro_inventory_grant`, `hiro_inventory_consume` | Items, equipment, consumables |
| **achievements** | `hiro_achievements_list`, `hiro_achievements_claim`, `hiro_achievements_update` | Badges, milestones, progress tracking |
| **progression** | `hiro_progression_get`, `hiro_progression_purchase` | Skill trees, level gates, unlock chains |
| **energy** | `hiro_energy_get`, `hiro_energy_spend` | Stamina, cooldowns, refills |
| **stats** | `hiro_stats_get`, `hiro_stats_update` | Player statistics, lifetime counters |
| **streaks** | `hiro_streaks_list`, `hiro_streaks_claim`, `hiro_streaks_update` | Daily login streaks, consecutive play |
| **event_leaderboards** | `hiro_event_leaderboards_list`, `hiro_event_leaderboards_submit`, `hiro_event_leaderboards_claim` | Time-limited competitive events |
| **store** | `hiro_store_list`, `hiro_store_purchase` | Offers, bundles, rotating shop |
| **challenges** | `hiro_challenges_list`, `hiro_challenges_claim` | PvE/PvP objectives, timed competitions |
| **tutorials** | `hiro_tutorials_get`, `hiro_tutorials_update` | Guided onboarding, step tracking |
| **unlockables** | `hiro_unlockables_list`, `hiro_unlockables_claim` | Time-gated reveals, random rewards |
| **auctions** | `hiro_auctions_list`, `hiro_auctions_bid`, `hiro_auctions_claim` | Player-to-player trading |
| **incentives** | `hiro_incentives_list`, `hiro_incentives_claim` | Daily goals, bonus rewards |

**Admin RPCs**: `admin_config_get` / `admin_config_set` read and write Hiro system configs as JSON.

#### Layer 3 — Satori LiveOps (6 Subsystems)

Satori RPCs follow the pattern `satori_{system}_{action}`.

| System | Key RPCs | What It Controls |
|--------|----------|-----------------|
| **flags** | `satori_flags_get_all`, `satori_flags_toggle` | Feature flags, kill switches, rollout % |
| **experiments** | `satori_experiments_get_all`, `satori_experiment_setup` | A/B tests, variant assignment, audience targeting |
| **live_events** | `satori_live_events_list`, `satori_live_event_schedule` | Scheduled events, timing, rewards, audiences |
| **audiences** | `satori_audiences_list`, `satori_audiences_compute` | Player segmentation, targeting rules |
| **messages** | `satori_messages_list`, `satori_message_broadcast` | Push campaigns, scheduled delivery, audience targeting |
| **metrics** | `satori_metrics_get`, `satori_metrics_set_alert` | Custom metrics, alerting thresholds, Prometheus |

**Additional Satori RPCs**: `satori_events_timeline` (player event history), `satori_identity_*` (player identity in Satori context).

### 14.3 RPCs by Game Phase

This table maps common game lifecycle phases to the RPCs a client needs at each stage. Use it as a quick lookup when building a new game or screen.

| Phase | Nakama Core RPCs | Hiro RPCs | Satori RPCs |
|-------|-----------------|-----------|-------------|
| **Install → First Launch** | `create_or_sync_user`, `create_player_wallet` | `hiro_tutorials_get` | `satori_flags_get_all`, `satori_experiments_get_all` |
| **Onboarding** | `get_player_metadata` | `hiro_tutorials_update`, `hiro_economy_grant` (starter gift) | `satori_audiences_compute` (segment new user) |
| **Home Screen Load** | `get_wallet_balance`, `friends_list` | `hiro_streaks_list`, `hiro_store_list`, `hiro_challenges_list`, `hiro_energy_get` | `satori_live_events_list`, `satori_flags_get_all` |
| **Daily Login** | — | `hiro_streaks_update`, `hiro_streaks_claim`, `hiro_incentives_list` | `satori_messages_list` |
| **Pre-Match** | matchmaker RPCs | `hiro_energy_spend` | `satori_flags_get_all` (mode gating) |
| **Post-Match** | `submit_leaderboard_score`, `analytics_log_event` | `hiro_achievements_update`, `hiro_progression_get`, `hiro_event_leaderboards_submit`, `hiro_challenges_claim` | — |
| **Store Visit** | — | `hiro_store_list`, `hiro_store_purchase`, `hiro_inventory_list` | `satori_flags_get_all` (offer visibility) |
| **Battle Pass** | — | `hiro_progression_get`, `hiro_progression_purchase` | `satori_experiments_get_all` (pricing test) |
| **Social** | `friends_list`, `send_friend_invite`, `send_direct_message`, `create_game_group` | — | — |
| **Re-engagement** | `send_push_notification` | `hiro_incentives_list` (comeback rewards) | `satori_message_broadcast`, `satori_audiences_compute` |

### 14.4 Auth Patterns for RPCs

| Context | Auth Method | Header / Param | Used By |
|---------|------------|----------------|---------|
| **Player App** | Bearer token | `Authorization: Bearer {session_token}` | All player-facing RPCs |
| **Admin Console** | Server key (HTTP Basic) | `Authorization: Basic base64(defaultkey:)` | Admin RPCs, config RPCs, player inspection |
| **Server-to-server** | HTTP key | `?http_key=defaulthttpkey` | MCP tools, webhooks, CI scripts |

### 14.5 Quick-Start: Adding a New Game

1. Register game → `get_game_registry` to confirm UUID
2. Auth → `AuthenticateDeviceAsync` with stable device ID
3. Identity → `create_or_sync_user` with `device_id` + `game_id`
4. Wallet → `create_player_wallet` with same params
5. Feature flags → `satori_flags_get_all` to gate features
6. Hiro init → `hiro_tutorials_get` + `hiro_energy_get` + `hiro_streaks_list`
7. Ready to play — call game-specific RPCs as needed

Full walkthrough: `_archived_docs/game_guides/GAME_ONBOARDING_COMPLETE_GUIDE.md`

### 14.6 Sharing This Reference

Include these docs in every deployment package:

```
nakama/
├── WEB_PLATFORM.md              ← This file (architecture + build plan)
├── docs/
│   ├── COMPLETE_RPC_REFERENCE.md ← Full RPC catalog (101 custom RPCs)
│   ├── CLIENT_INTEGRATION_GUIDE.md ← Client quick-start + recipes
│   ├── RPC_DOCUMENTATION.md      ← Player RPC deep-dive
│   └── DOCUMENTATION_SUMMARY.md  ← Doc index + learning path
└── _archived_docs/
    └── game_guides/
        ├── GAME_RPC_QUICK_REFERENCE.md ← Copy-paste RPC payloads
        └── GAME_ONBOARDING_COMPLETE_GUIDE.md ← New game setup
```

For game developers integrating a new title, share `CLIENT_INTEGRATION_GUIDE.md` first — it covers auth, game-phase RPCs, and recipes in a single read. For the web platform team building the Admin Console and Player App, this document (`WEB_PLATFORM.md`) is the primary reference.

---

*Last updated: 2026-04-05. Supersedes all prior plan files.*
