# 📊 QuizVerse Analytics System — Knowledge Transfer (KT)

**Version:** 1.0.0 | **Date:** 2026-06-01 | **Audience:** New Developers / Backend Engineers / Unity Client Engineers

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture & Data Flow](#2-architecture--data-flow)
3. [Event Ingestion Pipeline](#3-event-ingestion-pipeline)
4. [All Registered RPCs](#4-all-registered-rpcs)
5. [Storage Collections & Key Reference](#5-storage-collections--key-reference)
6. [Unity Client Side](#6-unity-client-side)
7. [Event Taxonomy (Canonical Event Names)](#7-event-taxonomy-canonical-event-names)
8. [Event Name Aliases (Legacy → Canonical)](#8-event-name-aliases-legacy--canonical)
9. [Nightly Rollup System](#9-nightly-rollup-system)
10. [Satori Fan-Out](#10-satori-fan-out)
11. [Segment & Live-Ops Integration](#11-segment--live-ops-integration)
12. [Game IDs](#12-game-ids)
13. [Privacy & PII Rules](#13-privacy--pii-rules)
14. [Admin & Ops](#14-admin--ops)
15. [Key Known Bugs / Gotchas](#15-key-known-bugs--gotchas)
16. [Quick-Start Checklist for New Devs](#16-quick-start-checklist-for-new-devs)

---

## 1. System Overview

The QuizVerse Analytics system is a **fully self-hosted event pipeline** built on Nakama's JavaScript runtime (Goja ES5 VM). It handles:

| Concern | Implementation |
|---|---|
| Event ingestion | `analytics_log_event` RPC (single + batch up to 200) |
| Real-time counters | `analytics_live_daily` (no rollup needed for same day) |
| Nightly aggregation | `analytics_rollup_run` cron — writes compact rollup docs |
| Player profiles | `game_player_analytics/{gameId}:{userId}` (GPA document) |
| 3rd-party fan-out | Heroic Labs Satori (direct HTTP, debounced per identity) |
| Live-ops segments | `satori_segments_*` RPCs driven by GPA data |
| Dashboard API | `analytics_dashboard`, `analytics_dashboard_summary`, and ~30 read RPCs |

**Source files root:** `data/modules/analytics/` (JS plain modules, each with its own `InitModule`).

---

## 2. Architecture & Data Flow

```
Unity Client
  │
  │  analytics_log_event RPC  (batch, up to 200 events per call)
  ▼
Nakama JS Runtime (Goja ES5)
  │
  ├── normalizeInboundEvent()
  │     ├── Resolve game-id slug → UUID (GAME_ID_SLUG_ALIASES)
  │     ├── Resolve event-name alias (EVENT_ALIASES)
  │     ├── eventNameSafety() — regex + injection guard
  │     ├── Inject dimensional fields (platform, country, os, locale, …)
  │     ├── schema v2 validation (warning-mode, never hard-reject v1)
  │     └── EventEnricher.enrich() — back-fills session context
  │
  ├── persistNormalizedEvent()
  │     ├── 1. analytics_events  (dash_* key — dashboard primary source)
  │     ├── 2. analytics_live_daily  (real-time counter, OCC-safe)
  │     ├── 3. game_player_analytics  (GPA per-player doc, gpaUpsertEvent)
  │     ├── 4. Satori fan-out  (sdEnqueueOrFlush — buffered, debounced 5s/50 events)
  │     ├── 5. analytics_user_first_seen  (atomic first-seen, DAU bump)
  │     └── 6. analytics_sessions  (session_start / session_end lifecycle)
  │
  └── abAutoRunIfNeeded()  — backfill state machine, piggybacks on ingest calls
```

**Rollup (nightly cron or auto-trigger):**

```
analytics_rollup_run
  ├── Scans analytics_events  (dash_* prefix)
  ├── Scans analytics_user_first_seen  (new users per cohort)
  ├── Writes analytics_rollup_daily  (rollup_{gameId}_{date})
  ├── Writes analytics_rollup_daily  (rollup_all_{date}  — cross-game)
  ├── Writes analytics_retention  (cohort_{gameId}_{date}  d1/d3/d7/d14/d30)
  ├── Writes analytics_funnel_daily  (funnel_{gameId}_{date})
  ├── Writes analytics_modes_daily  (modes_{gameId}_{date})
  ├── Writes analytics_dropoff_daily  (dropoff_{gameId}_{date})
  ├── Writes analytics_question_daily  (question_{gameId}_{date})
  ├── Writes analytics_offer_daily  (offer_{gameId}_{date})
  └── Bumps analytics_rollup_meta/platform_totals  (lifetime user count)
```

---

## 3. Event Ingestion Pipeline

### 3.1 Entry Point RPC

**RPC ID:** `analytics_log_event`  
**File:** `data/modules/analytics/analytics.js`

**Payload — single event:**
```json
{
  "gameId": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
  "eventName": "quiz_start",
  "eventData": {
    "quiz_mode": "SoloChallenge",
    "topic": "science"
  },
  "schema_version": 2,
  "client_event_id": "<uuid>",
  "event_time": "2026-06-01T10:23:00Z",
  "session_id": "<uuid>"
}
```

**Payload — batch (up to 200):**
```json
{
  "events": [
    { "gameId": "...", "eventName": "...", "eventData": {} },
    ...
  ]
}
```

**Response:**
```json
{
  "success": true,
  "accepted": 3,
  "rejected": 0,
  "alias_normalized": 1,
  "schema_v2_events": 3
}
```

### 3.2 Normalization Rules

| Rule | Detail |
|---|---|
| **Game ID slug resolution** | `"quizverse"` / `"quiz-verse"` / `"QuizVerse"` → `126bf539-...` |
| **Event alias expansion** | Legacy names mapped to canonical (see §8) |
| **eventName safety** | Only `[a-zA-Z0-9_-]{1,128}` accepted; injection chars rejected |
| **Timestamp trust window** | Client unix-ts accepted if within ±48h of server clock |
| **Batch limit** | Max 200 events per call |
| **System user guard** | `SYSTEM_USER` (`00000000-...`) writes skip analytics |

### 3.3 Dimensional Fields (Auto-Injected)

These fields are lifted from the top-level payload into `eventData` automatically, so downstream queries always have them:

`platform`, `app_version`, `device_model`, `device_tier`, `country`, `locale`, `os`, `os_version`, `unity_ver`, `install_source`, `consent_state`, `att_status`, `session_id`, `session_number`, `current_scene`, `quiz_mode`, `quiz_session_id`, `screen_id`, `privacy_tier`

### 3.4 Schema v2 Fields

Required (enforced when `ANALYTICS_ENFORCE_SCHEMA=true`):
- `schema_version: 2`
- `client_event_id` — client UUID for idempotent dedup
- `event_time` — client wall-clock ISO-8601 or unix-seconds

Recommended (warning-only):
- `session_id`, `quiz_session_id`, `screen_id`

---

## 4. All Registered RPCs

### 4.1 Core Ingestion & Dashboard

| RPC ID | File | Description |
|---|---|---|
| `analytics_log_event` | analytics.js | Main event ingestion (single / batch) |
| `analytics_dashboard` | analytics.js | DAU/WAU/MAU/trend (last N days or date range) |
| `analytics_dashboard_summary` | analytics.js | Single-date summary (live counter or rollup) |

### 4.2 Extended Analytics

| RPC ID | File | Description |
|---|---|---|
| `analytics_session_stats` | analytics_extended.js | Avg/median/P95 session duration, daily breakdown, peak hours |
| `analytics_quiz_performance` | analytics_extended.js | Quiz play/complete/abandon by mode, avg score |
| `analytics_funnel` | analytics_extended.js | Acquisition → activation → monetization funnel |
| `analytics_funnel_trend` | analytics_extended.js | Funnel conversion over time |
| `analytics_ai_features` | analytics_extended.js | AI feature usage counts (AI host, tutor, fortune, voice) |
| `analytics_feature_adoption` | analytics_extended.js | % of users who've used each feature |
| `analytics_economy_health` | analytics_extended.js | Wallet balance distribution, Gini, source/sink ratio |
| `analytics_monetization_detail` | analytics_extended.js | IAP revenue, ad revenue, paywall conversion |
| `analytics_platform_breakdown` | analytics_extended.js | Events by platform (iOS/Android/WebGL) |
| `analytics_home_heatmap` | analytics_extended.js | Home screen button tap frequency heatmap |
| `analytics_top_players` | analytics_extended.js | Top players by score / activity |
| `analytics_error_log` | analytics_extended.js | Client errors by RPC/category |
| `analytics_player_segments` | analytics_extended.js | Segments: new / returning / power / at-risk |
| `analytics_churn_risk` | analytics_extended.js | Churn risk score per user or cohort |
| `analytics_conversion_funnel` | analytics_extended.js | Paywall shown → IAP started → purchased funnel |
| `analytics_audience_breakdown` | analytics_extended.js | Country / device tier / install source breakdown |
| `analytics_retention_milestones` | analytics_extended.js | D1/D7/D30 milestone counts |

### 4.3 Rollup & Pre-Aggregation

| RPC ID | File | Description |
|---|---|---|
| `analytics_rollup_run` | analytics_rollup.js | Run nightly rollup for a date (admin-gated) |
| `analytics_run_rollup` | analytics_rollup.js | Alias for analytics_rollup_run |
| `analytics_rollup_backfill` | analytics_rollup.js | Backfill rollup for a date range (admin-gated) |
| `analytics_rollup_status` | analytics_rollup.js | Last rollup run status |
| `analytics_modes_daily_read` | analytics_rollup.js | Read pre-aggregated modes_daily doc |
| `analytics_dropoff_daily_read` | analytics_rollup.js | Read pre-aggregated dropoff_daily doc |
| `analytics_question_daily_read` | analytics_rollup.js | Read pre-aggregated question_daily doc |
| `analytics_offer_daily_read` | analytics_rollup.js | Read pre-aggregated offer_daily doc |

### 4.4 Admin

| RPC ID | File | Description |
|---|---|---|
| `analytics_creds_check` | analytics_admin.js | Verify admin credentials (bcrypt) |
| `admin_login` | analytics_admin.js | Mint Nakama session with admin role |
| `admin_diagnose_env` | analytics_admin.js | Check which env vars are present |
| `dashboard_events_timeline` | analytics_admin.js | Raw event timeline (no Satori) |
| `dashboard_storage_list` | analytics_admin.js | List any storage collection |

**Admin auth options:**
1. Bearer token from `admin_login` (userId starts with `admin:`)
2. `payload.dashboard_secret` == `ctx.env.DASHBOARD_SECRET`

### 4.5 Ops / Pipeline Health

| RPC ID | File | Description |
|---|---|---|
| `analytics_schema_check` | analytics_ops.js | Validate schema config |
| `analytics_backfill_events` | analytics_ops.js | Manually trigger backfill |
| `analytics_feature_flags` | analytics_ops.js | Read/write feature flags |
| `analytics_metrics` | analytics_ops.js | Today's accepted/rejected counters |
| `analytics_dau_alert_check` | analytics_ops.js | DAU drop alert check |
| `analytics_freshness_check` | analytics_hardening.js | Check if latest events are fresh |
| `analytics_health` | analytics_hardening.js | Full pipeline health check |
| `analytics_enforcement_status` | analytics_hardening.js | Schema enforcement mode status |
| `analytics_failed_events_recent` | analytics_hardening.js | View rejected event ring buffer |

### 4.6 Backfill State Machine

| RPC ID | File | Description |
|---|---|---|
| `analytics_backfill_dual` | analytics_backfill.js | Run one page of dual-backfill (GPA + rollup) |
| `analytics_auto_kick` | analytics_backfill.js | Start auto-drain backfill |
| `analytics_auto_status` | analytics_backfill.js | Current auto-drain status |
| `analytics_auto_reset` | analytics_backfill.js | Reset auto-drain state machine |

### 4.7 Player Profile

| RPC ID | File | Description |
|---|---|---|
| `analytics_get_player_profile` | analytics_player_profile.js | Full GPA doc for a player |
| `analytics_record_user_rollup` | analytics_player_profile.js | Write user-level rollup snapshot |
| `analytics_admin_player_search` | analytics_player_profile.js | Search players by username/email |
| `analytics_admin_player_full_profile` | analytics_player_profile.js | Admin: full profile with events + sessions |
| `analytics_player_knowledge_map` | analytics_player_profile.js | Per-topic correct/wrong counts per player |

### 4.8 Modes Analysis

| RPC ID | File | Description |
|---|---|---|
| `analytics_modes_breakdown` | analytics_modes.js | Per-mode KPI matrix (plays, completion, abandonment, avg score) |
| `analytics_modes_compare` | analytics_modes.js | Head-to-head comparison of two modes |
| `analytics_modes_transitions` | analytics_modes.js | Mode→mode transition matrix |
| `analytics_modes_retention` | analytics_modes.js | D1/D7/D30 retention sliced by first-played mode |

### 4.9 Drop-off & Churn

| RPC ID | File | Description |
|---|---|---|
| `analytics_dropoff_funnel` | analytics_dropoff.js | Churn signal counts (cold start, onboarding, quiz abandons) |
| `analytics_churn_signals` | analytics_dropoff.js | Per-user churn risk signals |
| `analytics_per_question_dropoff` | analytics_dropoff.js | Per-question abandonment histogram |
| `analytics_screen_exit_heatmap` | analytics_dropoff.js | Per-screen exit rate map |

### 4.10 Read Models (Intelligence)

| RPC ID | File | Description |
|---|---|---|
| `analytics_question_intelligence` | analytics_read_models.js | Per-question difficulty/accuracy trends |
| `analytics_offer_performance` | analytics_read_models.js | IAP offer conversion rates |
| `analytics_satori_audience_debug` | analytics_read_models.js | Satori audience membership debug |
| `analytics_player_timeline` | analytics_read_models.js | Full event timeline for a player |

### 4.11 Tracking Plan & Data Quality

| RPC ID | File | Description |
|---|---|---|
| `analytics_tracking_plan` | analytics_tracking_plan.js | Full schema v2 contract |
| `analytics_data_quality` | analytics_tracking_plan.js | Coverage gaps + v2 warning summary |

### 4.12 History (Long-Term)

| RPC ID | File | Description |
|---|---|---|
| `analytics_history_monthly_read` | analytics_history.js | Monthly aggregated KPIs |
| `analytics_history_yearly_read` | analytics_history.js | Yearly aggregated KPIs |
| `analytics_history_lifetime_read` | analytics_history.js | Lifetime platform totals |
| `analytics_history_browse` | analytics_history.js | Browse historical snapshots |
| `analytics_history_recompute` | analytics_history.js | Re-compute a historical window |
| `analytics_history_status` | analytics_history.js | Last history write status |

### 4.13 Retention Curves

| RPC ID | File | Description |
|---|---|---|
| `analytics_retention_curves` | analytics_retention_curves.js | D1/D3/D7/D14/D30 curves by cohort |

### 4.14 Recap Signals

| RPC ID | File | Description |
|---|---|---|
| `analytics_recap_signal_record` | recap_signals.js | Record a recap signal for a user |
| `analytics_recap_signals_read` | recap_signals.js | Read recap signals for a user |
| `analytics_recap_signals_stats` | recap_signals.js | Aggregate recap signal stats |

### 4.15 Satori Identity & Segments

| RPC ID | File | Description |
|---|---|---|
| `satori_identity_sync` | analytics_satori_identity.js | Compute 10 traits for one user → push to Satori |
| `satori_identity_batch` | analytics_satori_identity.js | Batch trait sync for N users (cron-friendly) |
| `satori_get_flags` | analytics_satori_identity.js | Fetch Satori feature flags for user |
| `satori_register_taxonomy` | analytics_segments.js | Warm-up all canonical events in Satori |
| `satori_segments_winback` | analytics_segments.js | Fire winback_eligible for inactive users (≥7d, ≥5 plays) |
| `satori_segments_preiap` | analytics_segments.js | Fire preiap_nudge_eligible (paywall seen, no purchase) |
| `satori_segments_run` | analytics_segments.js | Run both winback + pre-IAP in one call |
| `satori_segments_status` | analytics_segments.js | Last segment run summary |

### 4.16 Competitive Intel (Firecrawl)

| RPC ID | File | Description |
|---|---|---|
| `analytics_firecrawl_run` | analytics_firecrawl.js | Scrape competitor/store data |
| `analytics_firecrawl_intel` | analytics_firecrawl.js | Read scraped intel report |
| `analytics_firecrawl_status` | analytics_firecrawl.js | Last scrape job status |

### 4.17 Analytics v2 (Experimental — NOT yet registered as RPCs)

These functions exist in `analytics_v2.js` but are **not** currently registered via `registerRpc`. They are a parallel experimental implementation pending migration:

`rpcAnalyticsV2Dashboard`, `rpcAnalyticsV2RetentionCohort`, `rpcAnalyticsV2EngagementScore`, `rpcAnalyticsV2SessionStats`, `rpcAnalyticsV2Funnel`, `rpcAnalyticsV2EconomyHealth`, `rpcAnalyticsV2ErrorLog`, `rpcAnalyticsV2FeatureAdoption`, `rpcAnalyticsV2LogError`

---

## 5. Storage Collections & Key Reference

All writes under `SYSTEM_USER = "00000000-0000-0000-0000-000000000000"` unless noted.

### 5.1 Event Storage

| Collection | Key Pattern | Owner | Description |
|---|---|---|---|
| `analytics_events` | `dash_{gameId}_{YYYY-MM-DD}_{eventName}_{unixTs}_{rand6}` | SYSTEM_USER | Every accepted event. Primary source for dashboard rollup scanners. |
| `analytics_failed_events` | `fail_{YYYY-MM-DD}_{unixTs}_{rand6}` | SYSTEM_USER | Rejected event ring buffer (dashboard Pipeline tab). |

### 5.2 Engagement Counters

| Collection | Key Pattern | Owner | Description |
|---|---|---|---|
| `analytics_dau` | `dau_{gameId}_{YYYY-MM-DD}` | SYSTEM_USER | Per-game DAU list (uniqueUsers[]+count+newUsers) |
| `analytics_dau` | `dau_platform_{YYYY-MM-DD}` | SYSTEM_USER | Cross-game platform-wide DAU |
| `analytics_sessions` | `session_stats_{YYYY-MM-DD}` | SYSTEM_USER | Platform-wide session aggregates |
| `analytics_sessions` | `session_stats_{gameId}_{YYYY-MM-DD}` | SYSTEM_USER | Per-game session aggregates |
| `analytics_platform` | `platform_{gameId}_{YYYY-MM-DD}_{platform}` | SYSTEM_USER | Per-platform event count |
| `analytics_user_first_seen` | `first_{userId}_{gameId}` | SYSTEM_USER | Atomic first-seen marker (create-once with version:"*") |
| `analytics_live_daily` | `live_{gameId}_{YYYY-MM-DD}` | SYSTEM_USER | Real-time OCC counter (total, by_name, by_platform, by_country, revenue_usd, …) |
| `analytics_live_daily` | `live_all_{YYYY-MM-DD}` | SYSTEM_USER | Real-time cross-game aggregate |
| `analytics_metrics_counters` | `counter_{YYYY-MM-DD}` | SYSTEM_USER | events_accepted, events_rejected, log_calls, schema_v2_*, satori_* counters |

### 5.3 Rollup Docs (Written by Nightly Cron)

| Collection | Key Pattern | Owner | Description |
|---|---|---|---|
| `analytics_rollup_daily` | `rollup_{gameId}_{YYYY-MM-DD}` | SYSTEM_USER | Pre-aggregated daily KPIs per game |
| `analytics_rollup_daily` | `rollup_all_{YYYY-MM-DD}` | SYSTEM_USER | Pre-aggregated cross-game daily KPIs |
| `analytics_retention` | `cohort_{gameId}_{YYYY-MM-DD}` | SYSTEM_USER | D1/D3/D7/D14/D30 retention per cohort-date |
| `analytics_funnel_daily` | `funnel_{gameId}_{YYYY-MM-DD}` | SYSTEM_USER | Daily funnel step counts |
| `analytics_rollup_meta` | `last_success` | SYSTEM_USER | Rollup run bookkeeping |
| `analytics_rollup_meta` | `platform_totals` | SYSTEM_USER | total_users_lifetime (cumulative) |

### 5.4 Phase-4 Pre-Aggregated Tabs

| Collection | Key Pattern | Owner | Description |
|---|---|---|---|
| `analytics_modes_daily` | `modes_{gameId}_{YYYY-MM-DD}` | SYSTEM_USER | Per-quiz-mode KPIs (sessions, users, completes, abandons, revenue, ad-imps, avg score, top categories) |
| `analytics_dropoff_daily` | `dropoff_{gameId}_{YYYY-MM-DD}` | SYSTEM_USER | Churn signal counts + per-question abandonment histogram + per-screen exit rate |
| `analytics_question_daily` | `question_{gameId}_{YYYY-MM-DD}` | SYSTEM_USER | Per-question accuracy/difficulty/response time |
| `analytics_offer_daily` | `offer_{gameId}_{YYYY-MM-DD}` | SYSTEM_USER | IAP offer impression/conversion/revenue |

### 5.5 Player Profile (GPA)

| Collection | Key | Owner | Description |
|---|---|---|---|
| `game_player_analytics` | `{gameId}:{userId}` | `userId` | Full per-player per-game analytics doc |

**GPA document structure (top-level fields):**

```
v, user_id, game_id, display_name, avatar_url
platform, country, locale, device_tier, device_model, os_version, app_version
install_source, first_seen_utc, last_active_utc, days_since_install
lt_events, lt_sessions, lt_quiz_plays
fav_mode, fav_mode_n, mode_counts{}
events[]       (last 500 events)
sessions[]     (last 10 sessions)
crashes[]      (last 5 crashes)
eng {
  d1, d7, d30 (bool — retention milestones)
  streak, streak_max
  last_mode, last_score
  avg_accuracy, total_correct, total_answered
}
money {
  spend_usd, last_iap_utc, iap_count
  ad_views, ad_clicks, rewarded_ads
  reward_tier ("bronze"/"silver"/"gold")
  coins_earned, coins_spent
  paywall_shown_count, paywall_last_utc
  paywall_dismissed_count
  iap_started_count, iap_failed_count
}
consent, att_status, idem_key, updated_utc
```

### 5.6 Satori / Live-Ops

| Collection | Key | Owner | Description |
|---|---|---|---|
| `analytics_segments_state` | `{userId}` | SYSTEM_USER | Per-user segment cooldown (winback_last_sent_utc, preiap_last_sent_utc) |
| `analytics_segments_meta` | `last_run` | SYSTEM_USER | Last segment run summary |
| `external_analytics` | `apple_quizverse_latest` | SYSTEM_USER | App Store Connect snapshot |
| `external_analytics` | `play_quizverse_latest` | SYSTEM_USER | Google Play Console snapshot |

### 5.7 Admin

| Collection | Key | Owner | Description |
|---|---|---|---|
| `admin_users` | `session_{token}` | SYSTEM_USER | Admin session tokens (TTL: 12h) |

### 5.8 Error Tracking (v2)

| Collection | Key Pattern | Owner | Description |
|---|---|---|---|
| `analytics_error_events` | `error_{rpcName}_{unixTs}_{rand4}` | SYSTEM_USER | Structured error records (rpc_name, error_message, stack_trace, date) |

---

## 6. Unity Client Side

### 6.1 Entry Point

**Class:** `Trivia.Analytics.AnalyticsManager`  
**File:** `Assets/_QuizVerse/Scripts/Analytics/Core/AnalyticsManager.cs`  
**Assembly:** `Trivia.Analytics` (`Assets/_QuizVerse/Scripts/Analytics/Trivia.Analytics.asmdef`)  
**Execution Order:** `-800` (before all gameplay managers)  
**Lifecycle:** `DontDestroyOnLoad`, auto-bootstraps on scene load via `[RuntimeInitializeOnLoadMethod]`

### 6.2 Initialization

```csharp
// AnalyticsManager auto-sources Nakama client from IVXNManager:
IVXNManager.OnInitialized += () => {
    _nakamaClient = IVXNManager.Instance.Client;
    _session = IVXNManager.Instance.Session;
};
// gameId is pinned via:
IntelliVerseXConfig.QUIZVERSE_GAME_ID  // "126bf539-dae2-4bcf-964d-316c0fa1f92b"
```

**No manual initialization required.** Just call `AnalyticsManager.Instance.Track(...)` or any domain wrapper.

### 6.3 How Events Are Sent

1. **Domain wrapper** (e.g. `QuizAnalytics.TrackQuizStart()`) calls `AnalyticsManager.Instance.Track(eventName, eventData)`
2. `AnalyticsManager` calls `InjectGlobalContext()` — adds `platform`, `app_version`, `session_id`, `client_event_id`, `event_time`, `schema_version: 2`, `screen_id`, `privacy_tier` to every event automatically
3. Events go into an **offline queue** with dedup by `client_event_id`
4. A coroutine **batches** events and fires `analytics_log_event` RPC via Nakama
5. **Retry logic** handles transient failures; on final failure fires `nakama_rpc_error` event

### 6.4 Domain Wrapper Files

| File | Domain | Key Events |
|---|---|---|
| `Domain/QuizAnalytics.cs` | Quiz gameplay | quiz_start, quiz_complete, quiz_abandoned, question_answered, hint_used |
| `Domain/UserAnalytics.cs` | Auth / identity | login_started, login_success, registration_complete, onboarded |
| `Domain/MonetizationAnalytics.cs` | IAP / Ads | iap_clicked, iap_purchased, iap_failed, ad_shown, ad_completed, ad_revenue, paywall_shown |
| `Domain/EngagementAnalytics.cs` | Streaks / goals | streak_updated, streak_broken, goal_achieved, daily_reward_claimed |
| `Domain/UIBehaviorAnalytics.cs` | Navigation | screen_view, screen_left, popup_shown, button_clicked |
| `Domain/NotificationAnalytics.cs` | Push | notification events, push permission |
| `Domain/AIFeatureAnalytics.cs` | AI features | ai_host_session_started, ai_fortune_*, ai_chat_message_sent |
| `Domain/SocialAnalytics.cs` | Friends / Clans | friend_invite_sent, clan_joined, friend_battle_result |
| `Domain/EconomyAnalytics.cs` | Wallet / coins | coins_earned, coins_spent, balance_snapshot |
| `Domain/MultiplayerAnalytics.cs` | Multiplayer | mp_lobby_entered, mp_room_created, mp_game_started, mp_game_completed |
| `Domain/PerQuestionAnalytics.cs` | Per-question | question_answered_correct, question_answered_wrong, question_skipped |
| `Domain/CosmeticsAnalytics.cs` | Cosmetics | cosmetic_unlocked, cosmetic_equipped |
| `Domain/ProgressionAnalytics.cs` | XP / Badges | badge_earned, level_up, mastery_increased, xp_earned_event |
| `Domain/RetentionAnalytics.cs` | Retention | retention_d1, retention_d7, retention_d30 |
| `Monetization/Analytics/AdsAnalyticsBridge.cs` | Ad waterfall | ad_requested, ad_load_failed, ad_shown |
| `MultiPlayer/Unified/MultiplayerAnalyticsBridge.cs` | MP bridge | multiplayer analytics bridge |
| `Conversion/ConversionAnalytics.cs` | Conversion | paywall_converted, paywall_dismissed |
| `Analytics/ArcadeAnalytics.cs` | Arcade | arcade_game_launched |

### 6.5 Auto-Tagged Quiz Context

When `AnalyticsManager.BeginQuizSession(mode, category)` is called (at `QuizContainer.ActivateQuiz`), `InjectGlobalContext` automatically appends to **every subsequent event**:

| Field | Value |
|---|---|
| `quiz_mode` | `QuizModeType.ToString()` e.g. `SoloChallenge`, `LiveArena` |
| `play_category` | `PlayTypeCategory.ToString()` e.g. `Solo`, `SyncMultiplayer` |
| `quiz_session_id` | GUID per play-through (not the Nakama session) |

Cleared by `AnalyticsManager.EndQuizSession()` at deactivation.

### 6.6 Editor Tools

| File | Description |
|---|---|
| `Editor/AnalyticsE2ETestWindow.cs` | End-to-end test window for firing events manually |
| `Editor/AnalyticsDiagnosticWindow.cs` | Diagnostic window showing queue state, flush status |
| `Editor/AnalyticsIntegrationTests.cs` | Integration test suite |
| `Analytics/Validation/AnalyticsValidator.cs` | Pre-send payload validation |

---

## 7. Event Taxonomy (Canonical Event Names)

### Lifecycle / Session
`first_open`, `app_open`, `session_start`, `session_end`, `app_background`, `app_foreground`, `app_crashed`

### Auth / Onboarding
`login_started`, `login_success`, `login_failed`, `registration_complete`, `onboarded`  
`register_started`, `register_otp_requested`, `register_success`, `register_failed`  
`forgot_password_started`, `password_reset_success`  
`onboarding_started`, `onboarding_step`, `onboarding_complete`, `onboarding_abandoned`

### Quiz Gameplay
`quiz_start`, `quiz_complete`, `quiz_abandoned`  
`quiz_session_started`, `quiz_session_ended`  
`question_displayed`, `question_answered`, `answer_submitted`, `hint_used`  
`question_answered_correct`, `question_answered_wrong`, `question_skipped`  
`daily_quiz_started`, `daily_quiz_completed`, `daily_quiz_question_answered`

### Monetization
`iap_clicked`, `iap_purchased`, `iap_failed`  
`paywall_shown`, `paywall_converted`, `paywall_dismissed`  
`ad_requested`, `ad_shown`, `ad_completed`, `ad_skipped`, `ad_load_failed`, `ad_revenue`  
`store_opened`, `subscription_changed`

### Economy
`coins_earned`, `coins_spent`, `balance_snapshot`, `daily_reward_claimed`

### Engagement / Streak
`streak_updated`, `streak_broken`, `streak_milestone`, `streak_repaired`  
`streak_wager_placed`, `streak_wager_won`, `streak_wager_lost`  
`retention_d1`, `retention_d7`, `retention_d30`

### Navigation / UI
`screen_view`, `screen_left`, `button_clicked`, `popup_shown`, `popup_dismissed`  
`home_button_tapped`, `home_mode_tapped`, `home_viewed`  
`quiz_modes_screen_viewed`, `quiz_mode_card_tapped`, `quiz_mode_selected`

### AI Features
`ai_host_session_started`, `ai_host_turn_completed`, `ai_host_credits_consumed`  
`ai_voice_session_started`, `ai_voice_session_ended`, `ai_voice_paywall_shown`  
`ai_fortune_session_started`, `ai_fortune_result_viewed`  
`ai_chat_message_sent`, `ai_tutor_question_asked`, `ai_limit_reached`  
`ai_avatar_image_requested`, `ai_avatar_image_generated`

### Microphone / Voice Input
`mic_listening_started`, `mic_listening_stopped`, `mic_paywall_shown`  
`mic_trial_depleted`, `mic_permission_denied`, `mic_error`

### Social
`friend_invite_sent`, `friend_invite_accepted`, `friend_challenge_sent`  
`clan_joined`, `clan_left`, `clan_chat_sent`

### Multiplayer
`mp_lobby_entered`, `mp_room_created`, `mp_room_joined`, `mp_game_started`, `mp_game_completed`

### Progression
`badge_earned`, `level_up`, `xp_earned_event`, `mastery_increased`, `mastery_tier_reached`  
`league_joined`, `league_promoted`, `league_demoted`

### Errors / Quality
`error_logged`, `api_failure`, `auth_failure`, `nakama_rpc_error`  
`scene_load_time`, `fps_bucket`, `memory_warning`

### Canonical Funnel Steps (for rollup)
```
app_open → onboarded → login_success → session_start → quiz_start → quiz_complete → iap_clicked → iap_purchased
```

---

## 8. Event Name Aliases (Legacy → Canonical)

Applied at ingestion in `normalizeInboundEvent()` and at rollup scan time in `analytics_rollup.js`. Events stored with the CANONICAL name after normalization.

| Legacy (client emits) | Canonical (stored/queried) |
|---|---|
| `quiz_started` | `quiz_start` |
| `quiz_completed` | `quiz_complete` |
| `quiz_session_completed` | `quiz_complete` |
| `quiz_abandon` | `quiz_abandoned` |
| `purchase_completed` | `iap_purchased` |
| `purchase_started` | `iap_clicked` |
| `iap_completed` | `iap_purchased` |
| `iap_started` | `iap_clicked` |
| `iap_purchase_completed` | `iap_purchased` |
| `iap_purchase_started` | `iap_clicked` |
| `login_succeeded` | `login_success` |
| `onboarding_completed` | `onboarded` |
| `onboarding_complete` | `onboarded` |
| `registration_completed` | `registration_complete` |
| `paywall_viewed` | `paywall_shown` |
| `ad_failed` | `ad_load_failed` |
| `purchase_failed` | `iap_failed` |
| `ad_started` | `ad_shown` |

---

## 9. Nightly Rollup System

**Trigger:** `analytics_rollup_run` RPC — call with:
```json
{ "date": "2026-05-31", "dashboard_secret": "<secret>" }
```

**What it does in one pass:**
1. Scans `analytics_events` (prefix `dash_{gameId}_{date}_*`) — paginated
2. Counts funnel steps, mode breakdowns, error categories, IAP/ad revenue
3. Reads `analytics_user_first_seen` for new-user counts per cohort
4. Reads `analytics_dau` for DAU, WAU, MAU
5. Computes D1/D3/D7/D14/D30 retention for yesterday's cohort
6. Writes all output docs (see §5.3 and §5.4)
7. Bumps `platform_totals.total_users_lifetime`

**Auto-trigger:** `rpcAnalyticsDashboard` auto-triggers yesterday's rollup if absent (self-healing, wrapped in try/catch so it never blocks the dashboard response).

**Feature flag:** Set `ROLLUP_ENABLED=false` env var to disable all rollup RPCs (returns 503).

**Idempotent:** Re-running for the same date overwrites the rollup doc — no duplicates.

---

## 10. Satori Fan-Out

Every accepted event is forwarded to Heroic Labs Satori:

```
sdEnqueueOrFlush(userId, [satoriEvent])
  └── Batches in process memory
  └── Flushes at 50 events OR 5s idle (whichever first)
  └── Per-identity buffer — one batch per user
```

**On `session_start` / `first_open`:** `sdSendIdentityProperties()` fires once per process per identity to push the full identity property bag (platform, country, device_tier, install_source, cohort_label, etc.).

**PII scrubbing:** For events with `privacy_tier === 2`, the following fields are STRIPPED before Satori forwarding:
`display_name`, `username`, `email`, `phone`, `full_name`, `first_name`, `last_name`, `error_message`, `crash_log`, `stack_trace`, `ip_address`, `device_id`, `advertising_id`, `idfa`, `idfv`, `gaid`

**Fan-out failures NEVER abort ingestion** — `analytics_events` (in-house) is the durable source.

---

## 11. Segment & Live-Ops Integration

### 11.1 The 10 Satori Traits (synced by `satori_identity_sync`)

| Trait | Derivation |
|---|---|
| `skill_band` | `beginner` / `intermediate` / `expert` from avg_accuracy + total_answered |
| `favorite_mode` | Most-played mode from `gpa.fav_mode` |
| `favorite_topic` | Top mode_counts key (proxy) |
| `spend_tier` | `non_spender` / `low` / `mid` / `high` from iap_count + spend_usd |
| `ad_tolerance` | `low` / `medium` / `high` from ad_completions / (completions + skips) |
| `churn_risk` | `low` / `medium` / `high` from days since last_active_utc |
| `price_sensitivity` | `sensitive` / `moderate` / `low` from paywall_shown_count vs iap_count |
| `best_play_hour` | UTC hour of peak session activity (0–23) |
| `country_tier` | `t1` / `t2` / `t3` (T1 = US/UK/AU/CA/JP/KR/DE/FR/…) |
| `install_age_days` | Days since first_seen_utc (capped at 9999) |

### 11.2 Segment Rules

| Segment | Rule | Cooldown |
|---|---|---|
| `winback_eligible` | Inactive ≥ 7 days AND lifetime quiz plays ≥ 5 | 7 days |
| `preiap_nudge_eligible` | paywall_shown ≥ 1 AND iap_count === 0 | 3 days |

**State stored in:** `analytics_segments_state/{userId}` (per-user cooldown timestamps)

---

## 12. Game IDs

| Game | Slug Aliases | Canonical UUID |
|---|---|---|
| QuizVerse | `quizverse`, `quiz-verse`, `QuizVerse` | `126bf539-dae2-4bcf-964d-316c0fa1f92b` |
| LastToLive | `lasttolive`, `last-to-live`, `LastToLive` | `8f3b1c2a-5d6e-4f7a-9b8c-1d2e3f4a5b6c` |

**Unity constant:** `IntelliVerseXConfig.QUIZVERSE_GAME_ID`

**Rule:** Always resolve slugs to UUID before writing to storage. `resolveGameIdAlias(gameId)` in `analytics.js` is the single source of truth — all sub-modules delegate to it.

---

## 13. Privacy & PII Rules

| Privacy Tier | Value | Meaning |
|---|---|---|
| 0 | `unclassified` | Internal/technical — no external forwarding needed |
| 1 | `non_pii` | Safe for Satori and any external analytics sink |
| 2 | `pii_risk` | May contain free-text/user content — strip before 3rd-party |

**Auto-assignment:** `tpGetPrivacyTier(eventName)` from `analytics_tracking_plan.js` assigns tier when client doesn't provide one.

**PII field list for scrubbing:** `display_name, username, email, phone, full_name, first_name, last_name, error_message, crash_log, stack_trace, log_message, ip_address, device_id, advertising_id, idfa, idfv, gaid`

---

## 14. Admin & Ops

### Environment Variables

| Var | Purpose |
|---|---|
| `ADMIN_USERNAME` | Admin login username |
| `ADMIN_PASSWORD_HASH` | bcrypt hash for admin password |
| `ADMIN_PASSWORD` | Plaintext fallback (for local dev) |
| `DASHBOARD_SECRET` | Shared secret for cron/CI calls to admin-gated RPCs |
| `ANALYTICS_ENFORCE_SCHEMA` | `"true"` to hard-reject v2 events missing required fields |
| `DASHBOARD_PREFER_ROLLUPS` | `"false"` to force live-only read path |
| `ROLLUP_ENABLED` | `"false"` to disable all rollup RPCs |

### Dashboard Access

- **URL:** Custom analytics dashboard at `/analytics.html` (served by the Nakama HTTP port or reverse proxy)
- **Login:** `admin_login` RPC → bearer token OR `dashboard_secret` shared secret

### Ops Counters (today's `analytics_metrics_counters/counter_{date}`)

```
events_accepted, events_rejected, log_calls
alias_normalized
schema_v2_events, schema_v2_warnings
satori_publish_success, satori_publish_failure, satori_publish_dropped
satori_module_available (bool: Satori direct module loaded?)
```

---

## 15. Key Known Bugs / Gotchas

| # | Issue | Root Cause | Status |
|---|---|---|---|
| 1 | **SYSTEM_USER analytics gap** | `analytics_log_event` skips writes for `SYSTEM_USER` (server-side callers). Internal RPCs calling this won't see events on dashboard. | Known limitation — internal events use direct `nk.storageWrite` |
| 2 | **DAU key format was wrong** | Old code used `utils.getStartOfDay()` (unix-seconds) instead of ISO date string. Fixed 2026-05-27. All new writes use `new Date().toISOString().slice(0,10)`. | Fixed |
| 3 | **WAU/MAU capped at 7** when rollup hits | Rollup docs don't carry user lists — WAU became `Object.keys(wauSet).length` = 7 (day count). Fixed to use `Math.max(wauUnique, wauDailySum)`. | Fixed |
| 4 | **DAU array bloat** | Large `uniqueUsers[]` arrays could exceed Nakama storage doc size. Fixed: capped at `DAU_MAX_TRACKED_USERS = 10,000`. Beyond cap, uses `overflow_count` increment. | Fixed |
| 5 | **OCC race on live counters** | Concurrent `iap_purchased` + `ad_impression` for same gameId/day caused clobbering. Fixed: `_liveCountersUpsert` retries up to 2× with version-check. | Fixed |
| 6 | **GPA failure counted as rejection** | `gpaUpsertEvent` failure used to make the event appear "rejected" even though `analytics_events` write succeeded. Fixed: GPA failure is now a warning only. | Fixed |
| 7 | **Satori module status invisible** | Operators couldn't tell if Satori fan-out was active. Fixed: `bumpMetricsCounter` now sets `satori_module_available` flag. | Fixed |

---

## 16. Quick-Start Checklist for New Devs

### Backend

- [ ] Read `data/modules/analytics/analytics.js` — core ingestion + dashboard
- [ ] Read `data/modules/analytics/analytics_rollup.js` — nightly aggregation
- [ ] Read `data/modules/analytics/player_analytics_store.js` — GPA schema
- [ ] Run `analytics_health` RPC → check pipeline health
- [ ] Run `analytics_dashboard` RPC with `{"game_id":"quizverse","days":7}` → confirm data flows
- [ ] Run `analytics_metrics` RPC → see today's accepted/rejected counters

### Unity Client

- [ ] Read `Assets/_QuizVerse/Scripts/Analytics/Core/AnalyticsManager.cs` (top 200 lines)
- [ ] Read `Assets/_QuizVerse/Scripts/Analytics/Core/AnalyticsConstants.cs` — all event names
- [ ] Open `AnalyticsE2ETestWindow` in Unity Editor → fire a test event → verify it lands in dashboard
- [ ] Check `AnalyticsDebugOverlay.cs` for in-game debug overlay usage

### Common Pitfalls

1. **Never send raw slugs from new code** — always use `IntelliVerseXConfig.QUIZVERSE_GAME_ID` (UUID)
2. **Never fire analytics events as SYSTEM_USER** — they are silently dropped
3. **Use canonical event names** from `AnalyticsEvents.*` constants — not string literals
4. **Schema v2 fields** (`client_event_id`, `event_time`, `session_id`) are auto-injected by `AnalyticsManager.InjectGlobalContext` — don't set them manually per event
5. **Batch events** — the Unity client batches automatically; don't call the RPC directly per-event
6. **Storage key format is ISO date** (`YYYY-MM-DD`) — NEVER use unix-seconds as the date slot in analytics keys

---

*Generated by AI from live code on 2026-06-01. For corrections, update this file and ping the backend team.*
