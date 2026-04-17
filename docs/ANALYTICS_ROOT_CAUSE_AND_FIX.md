# Analytics Dashboard — Root Cause Analysis & World-Class Fix Plan

**Status:** Phase 1 + Phase 2 shipped. See [ANALYTICS_PHASE2_PLAN.md](./ANALYTICS_PHASE2_PLAN.md) for the scale-out / perf / ops delivery (rollup, cron, pollers, backfill, metrics).
**Scope:** `nakama.intelli-verse-x.ai/analytics.html` + QuizVerse Unity client + Nakama server modules.
**Author:** Intelliverse-X Platform Team.

---

## 0. TL;DR — Why every tab shows zero

Four independent defects, each individually capable of producing "no data":

| # | Defect | Effect | Fix |
|---|--------|--------|-----|
| **1** | Unity client calls `quizverse_log_event` but its `parseAndValidateGamePayload` only accepts `gameID` = literal string `"quizverse"` / `"lasttolive"`. Client sends a UUID. Every call throws `Unsupported gameID`. | Server has never received a single analytics event from production. All collections (`analytics_events`, `analytics_dau`, `analytics_sessions`) are empty → Overview / Sessions / Retention / Quiz / AI / Features / Funnel / Players / Platforms / Heatmap / Economy / Monetization all show zero. | Retire `quizverse_log_event`. Route client through `analytics_log_event` (universal, UUID-based, already wired to DAU + sessions aggregator). |
| **2** | Dashboard calls `admin_events_timeline` and `admin_storage_list`. Both server-side handlers start with `RpcHelpers.requireAdmin(ctx, nk)`, but the dashboard authenticates anonymously via `/v2/account/authenticate/device?create=true` — a regular device session with no admin claim. | Both endpoints return HTTP 500. Events + Storage tabs broken. | Add proper `admin_login` RPC (bcrypt). New `dashboard_events_timeline` / `dashboard_storage_list` RPCs that read from `analytics_events` (since we don't use paid Satori) and accept either an admin session or a `DASHBOARD_SECRET` shared-secret header. |
| **3** | `analytics_appodeal` RPC reads `ctx.env['APPODEAL_API_KEY']`. Keys exist in local `.env` and are forwarded by `docker-compose.yml`, **but the production container at `nakama.intelli-verse-x.ai` is either running from stale env or uses a different config path** (common symptom: `.env` updated without a `docker compose up -d --force-recreate`). | Appodeal tab shows "not configured" permanently. | Ship a new `admin_diagnose_env` RPC that returns which env vars are set/missing on the running container. Use it to verify prod before redeploy. |
| **4** | `IVXAnalyticsManager.GAME_ID` is hardcoded in C#: `126bf539-dae2-4bcf-964d-316c0fa1f92b`. The live `DEFAULT_GAME_ID` on prod is `f6f7fe36-03de-43b8-8b5d-1a1892da4eed`. Even after fix #1, per-game filters on the dashboard will mismatch. | `dau_<gameId>_<date>` keys never line up with what the dashboard queries for. | Load `gameId` from `IntelliVerseXConfig.asset` (already a ScriptableObject field), never hardcode. |

There are also secondary issues the Phase-2 work will close:

- Dashboard's `analytics_dashboard` does `storageRead` × 30 days + a full `storageList` scan on every request — unacceptable at scale. → nightly rollup job.
- No scheduled job pulls Appodeal / App Store Connect / UGS. → 6-hour cron poller.
- No bcrypt password helper in Goja runtime. → ship via Nakama built-in `nk.bcryptHash`/`nk.bcryptCompare`.
- `quizverse_track_session_start/_end` write to per-user collection, bypass DAU+session aggregator. → unify through `analytics_log_event` with `session_start`/`session_end` event names.

---

## 1. Evidence (line-level)

### 1.1 Client calls wrong RPC with wrong ID format

`Assets/_IntelliVerseXSDK/Analytics/IVXAnalyticsManager.cs`:

```32:32:games/quiz-verse/Assets/_IntelliVerseXSDK/Analytics/IVXAnalyticsManager.cs
private const string GAME_ID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";
```

```126:126:games/quiz-verse/Assets/_IntelliVerseXSDK/Analytics/IVXAnalyticsManager.cs
bool success = await RpcWithRetry("quizverse_log_event", jsonPayload);
```

Server-side validator:

```12103:12106:data/modules/legacy_runtime.js
var gameID = data.gameID;
if (!gameID || !["quizverse", "lasttolive"].includes(gameID)) {
    throw Error("Unsupported gameID: " + gameID);
}
```

### 1.2 Admin RPCs block dashboard auth

```464:467:data/modules/src/hiro/base/admin.ts
function rpcEventsTimeline(ctx, logger, nk, payload): string {
  RpcHelpers.requireAdmin(ctx, nk);
  var data = RpcHelpers.parseRpcPayload(payload);
  if (!data.userId) return RpcHelpers.errorResponse("userId required");
```

Dashboard auth flow (device session, no admin claim):

```1842:1848:web/analytics-dashboard/index.html
const response = await fetch(`${CONFIG.serverUrl}/v2/account/authenticate/device?create=true`, {
  method: 'POST',
  headers: { 'Authorization': 'Basic ' + btoa(CONFIG.serverKey + ':') },
  body: JSON.stringify({ id: deviceId })
});
```

### 1.3 The "right" RPC exists, client just doesn't call it

```188:329:data/modules/analytics/analytics.js
function rpcAnalyticsDashboard(ctx, logger, nk, payload) {
  ...
  var key = gameId === 'all' ? 'dau_platform_' + dateStr : 'dau_' + gameId + '_' + dateStr;
  var objs = nk.storageRead([{ collection: 'analytics_dau', key: key, userId: SYSTEM_USER }]);
```

And `rpcAnalyticsLogEvent` already writes to `analytics_events`, `analytics_dau`, and calls `trackSession()`. So redirecting the client is a single-line change — the rest "just works".

---

## 2. Target architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ UNITY CLIENT (QuizVerse)                                             │
│                                                                      │
│  QVAnalyticsService.Track("quiz_complete", props)                    │
│       │                                                              │
│       ├── UGS Analytics (unchanged, keep as secondary)               │
│       ├── Firebase (unchanged, optional)                             │
│       └── IVXAnalyticsManager.TrackEvent(...)                        │
│              │                                                       │
│              │ RPC → analytics_log_event                             │
│              │   payload: { gameId<UUID>, eventName, eventData }     │
│              │   offline-queued, retried, batched                    │
│              ▼                                                       │
└──────────────────────────────────────────────────────────────────────┘
                                   │ HTTPS Bearer (player session)
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ NAKAMA SERVER                                                        │
│                                                                      │
│  analytics_log_event  ─┬─►  analytics_events   (raw)                 │
│                        ├─►  analytics_dau      (per-day dedup)       │
│                        └─►  analytics_sessions (aggregator)          │
│                                                                      │
│  NEW: admin_login           → issues admin-tagged session            │
│  NEW: admin_diagnose_env    → env-var presence map                   │
│  NEW: dashboard_events_timeline  (admin-gated, from analytics_events)│
│  NEW: dashboard_storage_list     (admin-gated, any collection)       │
│                                                                      │
│  PHASE 2:                                                            │
│  CRON nightly    →  rollup raw → analytics_rollup/<game>/<date>      │
│  CRON 6-hour     →  pull Appodeal + ASC + UGS into external_analytics│
└──────────────────────────────────────────────────────────────────────┘
                                   │ HTTPS Bearer (admin session)
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DASHBOARD (nakama.intelli-verse-x.ai/analytics.html)                 │
│                                                                      │
│  On page load → POST /v2/rpc/admin_login  { user, pass }             │
│  Every tab → RPC with admin bearer                                   │
│  "Diagnose" tile → admin_diagnose_env  (shows env gaps at a glance)  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Phased delivery

### Phase 1 — Unblock (this PR)

- [x] Root-cause doc (this file).
- [ ] `data/modules/analytics_admin/analytics_admin.js` — `admin_login`, `admin_diagnose_env`, `dashboard_events_timeline`, `dashboard_storage_list`.
- [ ] `data/modules/analytics/analytics.js` — inject `platform`, `app_version`, normalize schema, batch support.
- [ ] `docker-compose.yml` + `.env.example` — add `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `DASHBOARD_SECRET`.
- [ ] `Assets/_IntelliVerseXSDK/Analytics/IVXAnalyticsManager.cs` — route via `analytics_log_event`, load `gameId` from config.
- [ ] `Assets/_IntelliVerseXSDK/Analytics/IVXAnalyticsEvents.cs` (new) — canonical event names & param keys.
- [ ] `Assets/_QuizVerse/Scripts/Analytics/Core/QVAnalyticsService.cs` — app lifecycle → `session_end`.
- [ ] `web/analytics-dashboard/index.html` — switch auth to `admin_login`, call `dashboard_*` RPCs, add diagnose tile.

**Deploy checklist for Phase 1:**

1. Generate a bcrypt hash for your admin password locally:
   ```bash
   htpasswd -bnBC 12 "" 'YourAdminPassword' | tr -d ':\n'
   # Example output: $2y$12$abc...  — use as ADMIN_PASSWORD_HASH
   ```
2. Set on prod host:
   ```bash
   # /srv/nakama/.env
   ADMIN_USERNAME=ivx-admin
   ADMIN_PASSWORD_HASH='$2y$12$...'
   DASHBOARD_SECRET=$(openssl rand -hex 32)
   ```
3. Rebuild + redeploy modules:
   ```bash
   cd /srv/nakama/data/modules && npm run build
   docker compose pull && docker compose up -d --force-recreate
   ```
4. Verify env reached runtime:
   ```bash
   curl -s -X POST "$URL/v2/rpc/admin_diagnose_env" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{}' | jq
   ```
5. From Unity: build + deploy client with updated `IVXAnalyticsManager.cs`. In editor, verify `[Analytics][Nakama] analytics_log_event OK eventName=session_start`.

### Phase 2 — World-class aggregation (next)

- [ ] Nightly cron `analytics_nightly_rollup` aggregates raw events → `analytics_rollup/<gameId>/<date>` with DAU/WAU/MAU/ARPU/retention pre-computed.
- [ ] 6-hour cron `analytics_external_poll` pulls Appodeal, App Store Connect, UGS Reports API.
- [ ] Rewrite `rpcAnalyticsDashboard` to prefer rollup reads (O(N) → O(1)).
- [ ] Funnel event contract + client wiring (`app_open`, `quiz_viewed`, `quiz_started`, `quiz_completed`, `paywall_viewed`, `iap_purchased`).
- [ ] Per-platform + per-region slicing on the dashboard.

### Phase 3 — Observability & polish

- [ ] Prometheus metrics per-RPC (histogram + counter) via `nk.metricsTimerRecord`.
- [ ] Dashboard: live WebSocket subscription for real-time DAU counter.
- [ ] BigQuery / S3 nightly export.
- [ ] Alerts: drops in DAU > 20 %, error-rate > 1 %, p95 RPC latency > 500 ms.

---

## 4. Canonical event taxonomy (Phase 1 minimum)

Derived from the dashboard RPCs that already expect these events:

| Event name | Required `eventData` fields | Fires on |
|---|---|---|
| `session_start` | `platform`, `app_version`, `device_model` | App open (post-auth). |
| `session_end` | `duration_seconds` | App pause > 30s, quit, logout. |
| `screen_view` | `screen_name`, `previous_screen`, `time_on_previous_ms` | Navigation. |
| `home_button_tap` | `source_screen` | Home button. (fuels Heatmap tab) |
| `quiz_start` | `quiz_id`, `category`, `difficulty`, `question_count` | Quiz start. |
| `quiz_complete` | `quiz_id`, `category`, `difficulty`, `score`, `total_questions`, `time_seconds` | Quiz finish. |
| `quiz_answer` | `quiz_id`, `question_id`, `is_correct`, `time_ms` | Per-question. |
| `ai_host_used` / `ai_fortune_teller_used` / `ai_*` | `feature_id`, `tokens_used?` | AI feature activation. |
| `paywall_viewed` | `paywall_id`, `source_screen` | Monetization funnel. |
| `iap_clicked` | `product_id`, `price_usd`, `source_screen` | IAP tap. |
| `iap_purchased` | `product_id`, `price_usd`, `currency`, `receipt_id` | IAP success. |
| `ad_impression` | `placement`, `ad_unit`, `revenue_usd?`, `network` | Ad shown. |
| `ad_clicked` | `placement`, `ad_unit`, `network` | Ad tapped. |
| `login_success` / `login_failed` | `method` (`device`, `email`, `google`, `apple`, `guest`) | Auth. |
| `error_logged` | `error_category`, `error_code`, `context` | Runtime errors. |

Every event auto-receives (injected by `IVXAnalyticsManager`):

- `user_id` — from Nakama session context (server-side).
- `session_id` — from `QVAnalyticsService._sessionId`.
- `game_id` — from `IntelliVerseXConfig.gameId`.
- `platform` — from `Application.platform`.
- `app_version` — from `Application.version`.
- `ts` — server timestamp.

---

## 5. Verification matrix

After Phase 1 ships and one real user completes a session, each dashboard tile must show data as follows:

| Tab | Should show | Verification RPC |
|---|---|---|
| Overview → DAU | 1+ | `analytics_dashboard` |
| Sessions → Avg | > 0s | `analytics_session_stats` |
| Quiz → Completions | ≥ 1 | `analytics_quiz_performance` |
| Events → timeline | rows | `dashboard_events_timeline` |
| Storage → analytics | rows | `dashboard_storage_list` |
| Appodeal | non-error OR "no data for range" | `analytics_appodeal` |
| Diagnose | all required env vars green | `admin_diagnose_env` |

---

## 6. Rollback

Phase 1 is purely additive server-side (new RPCs + extended validation) plus an RPC change on the client. To rollback:

1. Client: revert `IVXAnalyticsManager.cs` (tag `analytics-phase-1-client`). The old `quizverse_log_event` was broken anyway — rollback is safe.
2. Server: new RPCs have no external dependencies; leaving them registered is harmless. To disable, delete `data/modules/analytics_admin/analytics_admin.js` and rebuild.
3. Dashboard: revert `index.html` to restore device auth.

No schema migrations, no data loss risk.
