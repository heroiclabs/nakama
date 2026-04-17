# Analytics — Phase 2 Plan (Scale & Polish)

**Status:** Phase 2 + Phase 3 shipped. All gaps (A-E) closed; Phase-3 follow-ups (Go Prometheus plugin, retention UI, chart virtualization) delivered.
**Scope:** Dashboard performance, scheduled external ingestion, data freshness guarantees, operator tooling, native metrics.
**Companion doc:** [`ANALYTICS_ROOT_CAUSE_AND_FIX.md`](./ANALYTICS_ROOT_CAUSE_AND_FIX.md) (Phase 1).

## Phase 3 (this change) — follow-ups closed

| Follow-up | Delivered by |
|-----------|--------------|
| Native Prometheus counters (JS can't register them) | `go-plugin/main.go` — Nakama Go plugin that hooks `analytics_log_event`, `analytics_rollup_run`, `external_poll_*` via `RegisterAfterRpc` and publishes `analytics_events_total{status}`, `analytics_rollup_runs_total{status}`, `analytics_poller_runs_total{provider,status}`, `analytics_*_age_seconds`, `analytics_events_today`, `analytics_rejected_today`. `go.mod` pins `nakama-common v1.44.0` + Go 1.25 (matches Nakama 3.35.0's ABI — mismatch = silent plugin load failure). Built by multi-stage `Dockerfile`; dev helper `scripts/build-plugin.{ps1,sh}` extracts `.so` to `data/modules/` without full image rebuild. `admin_diagnose_env` exposes a `nativeMetrics` probe so operators can tell from the dashboard whether the plugin loaded. |
| Retention cohort UI | `analytics_retention_curves/analytics_retention_curves.js` — new admin-gated RPC that reads `analytics_retention/cohort_<gameId>_<date>` docs, computes a cohort-size-weighted average curve, and returns per-cohort d1/d3/d7/d14/d30 retention %. Dashboard Retention tab renders: 6-KPI summary, average curve line chart, full cohort heatmap with color-coded cells (green→amber→red). Per-game only (server rejects `gameId="all"` by design). |
| Chart virtualization for >90d trends | `web/analytics-dashboard/index.html::createLineChart/createBarChart/createDoughnutChart` — added `chartSignature()` + `_kind`/`_signature` cache. Identical re-invocations are no-ops (tab switches without filter changes don't re-render). `decimateSeries()` stride-samples any series >120 points while preserving first/last labels. `mergeChartOptions()` deep-merges caller overrides so passing e.g. `{ scales: { y: { min: 0 } } }` no longer destroys x-axis styling. |
| Bootstrap data ("dashboard is empty on day 1") | `analytics_cron` sidecar now runs `analytics_rollup_backfill` for the last `BOOTSTRAP_BACKFILL_DAYS` (default 7) on every container start, plus an initial `external_poll_all`. Rollups are idempotent so re-boots are safe. Dashboard has history to read from within seconds of `docker compose up`. |
| One-click end-to-end verification | `web/analytics-dashboard/index.html::adminRunSmokeTest()` + Diagnose tab "✅ Run Smoke Test" button. Fires 7 RPCs in sequence (log_event → 2s wait → rollup_run → dashboard_summary → retention_curves → metrics → statuses) and prints a pass/fail summary with actionable hints ("event was rejected — check normalizeInboundEvent"; "events_today=0 — verify client is calling analytics_log_event"). |


---

## Shipped (this change)

| Gap | Delivered by |
|-----|--------------|
| A — dashboard perf | `analytics/analytics.js::rpcAnalyticsDashboard` now prefers `analytics_rollup_daily` per day (live fallback for today only). New `analytics_dashboard_summary` returns a one-shot rollup doc. |
| B — external pollers | `external_pollers/external_pollers.js` registers `external_poll_appodeal`, `external_poll_appstore`, `external_poll_ugs`, `external_poll_all`, `external_poll_status`. Rate-limited to 1/h per provider. |
| C — nightly rollup | `analytics_rollup/analytics_rollup.js` registers `analytics_rollup_run`, `analytics_rollup_backfill`, `analytics_rollup_status`. Writes daily DAU, sessions, revenue, funnel, retention cohorts, top events/screens. |
| C — scheduler | New `analytics_cron` sidecar in `docker-compose.yml` (curl image). Fires `analytics_rollup_run` once/day at `ROLLUP_HOUR_UTC` and `external_poll_all` every `POLL_INTERVAL_SECS` using `DASHBOARD_SECRET`. |
| D — backfill + schema | `analytics_ops/analytics_ops.js` registers `analytics_schema_check` (field-coverage report), `analytics_backfill_events` (legacy→canonical, dry-run by default), `analytics_feature_flags`. |
| E — observability | `analytics_ops::analytics_metrics` emits an RPC-scrapable counters snapshot. `analytics.js` maintains a per-day `analytics_metrics_counters` doc (events_accepted / events_rejected / log_calls). Dashboard Diagnose tab renders rollup + poller status side-by-side. |

Feature flags (default **on**, set to `false` to disable): `ROLLUP_ENABLED`, `EXTERNAL_POLLERS_ENABLED`, `DASHBOARD_PREFER_ROLLUPS`. All three are plumbed through `docker-compose.yml` → `--runtime.env`.

Auth: every new admin RPC honors both **admin session** (from `admin_login`) and **shared secret** (`payload.dashboard_secret === env.DASHBOARD_SECRET`) — the latter is what the cron sidecar uses.

---

## 0. What Phase 1 left on the table

Phase 1 solved correctness: the dashboard now has:
- A real event pipeline (`analytics_log_event` + Unity client rewired).
- Admin-gated RPCs (`admin_login`, `dashboard_events_timeline`, `dashboard_storage_list`, `admin_diagnose_env`).
- A diagnose tab that tells operators in one click whether env / modules / pipeline are healthy.

What it **did not** fix:

| # | Gap | Why it matters |
|---|-----|----------------|
| A | `analytics_dashboard` still aggregates by doing `storageRead` × N days + a full `storageList` scan on every request. | O(users × days) per dashboard page view. Fine at 100 DAU, unusable at 10k. |
| B | No scheduled job pulls Appodeal, App Store Connect, or Unity Gaming Services. Panels rely on a per-request live fetch that takes 2-8 s and rate-limits quickly. | Revenue tabs feel slow + flaky. |
| C | We have no nightly rollup. Historical series (DAU/WAU/MAU, funnel step-conversion, retention cohorts) are recomputed on every page view. | Duplicate cost per viewer; impossible to audit. |
| D | No backfill tooling. The moment we ship a new canonical event, old ones are stuck on old schemas and the dashboard quietly skips them. | Drift between client and server aggregators. |
| E | No SLO/alerting on the analytics pipeline itself. If `analytics_log_event` starts failing, operators learn from the dashboard showing zeros — hours later. | Silent regressions. |

Phase 2 closes all five.

---

## 1. Target architecture (end-state)

```
                          ┌───────────────────────────┐
Unity clients ──► RPC ──►│  analytics_log_event      │──► raw write
                          │  (normalize + fan-out)    │      │
                          └─────────┬─────────────────┘      │
                                    │                         ▼
                                    │                analytics_events (raw, TTL=90d)
                                    │                analytics_dau / analytics_sessions (live counters)
                                    │                analytics_platform (live breakdown)
                                    │
                                    │      ┌─────────────────────────────┐
                                    └────► │  Phase-2 nightly rollup cron │
                                           │  (01:00 UTC daily)           │
                                           └──────────────┬──────────────┘
                                                          ▼
                          ┌──────────────────────────────────────────────┐
                          │ analytics_rollup_daily / _weekly / _monthly  │
                          │ analytics_retention_cohort                   │
                          │ analytics_funnel_daily                       │
                          │ analytics_revenue_daily                      │
                          │ analytics_top_events / _top_screens          │
                          └──────────────┬───────────────────────────────┘
                                         ▼
                                  analytics_dashboard
                                  (pure reader, < 300 ms p95)

External:
    Appodeal API        ┐
    App Store Connect   ├── 6-hour cron poller ──► external_analytics/<provider>/<date>
    Unity (UGS)         ┘                                         │
                                                                  ▼
                                                     analytics_revenue_daily merge job
```

---

## 2. Deliverables (in order)

### Phase 2.1 — Nightly rollup cron (1 week, highest ROI)

**Module:** `data/modules/analytics_rollup/analytics_rollup.js`
**Registered RPCs:**
- `analytics_rollup_run(date?: "YYYY-MM-DD")` — admin-gated, idempotent daily rollup.
- `analytics_rollup_backfill(from: "YYYY-MM-DD", to: "YYYY-MM-DD")` — admin-gated backfill.

**Schedule:**
- Nakama Go-side registered as `InitializerRegisterMatchmakerMatched` equivalent — actually: Nakama JS runtime has no built-in cron. Use one of:
  - **Recommended:** Add a Go module `data/modules/cron/cron.go` that registers `initializer.RegisterBeforeRt` no-op, launches a goroutine with `time.Tick(24h)` that POSTs to `analytics_rollup_run` via the internal admin HTTP key. Survives restarts because Nakama restarts the process.
  - **Alternative (no Go code):** add a lightweight Docker sidecar (`curlimages/curl`) that `exec curl` hits the RPC on a cron schedule. Simpler, zero Go footprint, easy to change cadence.

**Output collections** (keyed by `YYYY-MM-DD` or `YYYY-Www` / `YYYY-MM`):
- `analytics_rollup_daily/<gameId>/<date>` → `{ dau, new_users, sessions, session_seconds_total, revenue_usd, iap_count, ad_impressions, quiz_complete, quiz_abandon, ... }`
- `analytics_retention_cohort/<gameId>/<cohortDate>` → `{ cohort_size, d1: n, d3: n, d7: n, d14: n, d30: n }`
- `analytics_funnel_daily/<gameId>/<date>` → `{ app_open: n, onboarded: n, login_success: n, quiz_start: n, quiz_complete: n, iap_clicked: n, iap_purchased: n }`
- `analytics_top_events/<gameId>/<date>` → `[{ event_name, count }]`
- `analytics_top_screens/<gameId>/<date>` → `[{ screen_name, views, avg_time_ms }]`

**Dashboard read path rewrite:** `analytics_dashboard`, `analytics_session_stats`, `analytics_funnel`, `analytics_ai_features` now **read the rollup tables first** and fall back to live scan only when a date is < 24 h old.

**Success metric:** p95 of `analytics_dashboard` drops from > 3 s to < 300 ms.

---

### Phase 2.2 — External provider pollers (1 week)

**Module:** `data/modules/external_pollers/external_pollers.js`
**Registered RPCs:**
- `external_poll_appodeal(date?)` — fetches yesterday's Appodeal revenue.
- `external_poll_appstore(date?)` — fetches App Store Connect sales report.
- `external_poll_ugs(date?)` — fetches Unity Gaming Services analytics.
- `external_poll_all(date?)` — convenience bundle.

**Output collection:** `external_analytics/<provider>/<gameId>/<date>` (normalized to a common shape: `{ revenue_usd, installs, impressions, clicks, fillRate, ecpm }`).

**Schedule:** Same cron plumbing as 2.1 but every **6 hours** (Appodeal refreshes slowly, App Store often has a 24 h lag).

**Dashboard tabs updated:**
- `analytics_appodeal` now reads from `external_analytics/appodeal/*` (NOT live).
- `analytics_apple_appstore` → same.
- `analytics_unity` → same.
- All three tabs get a "last synced" badge showing the poll timestamp.

**Rate-limit strategy:** every poller writes a `external_analytics_last_poll/<provider>` meta-doc that contains next-allowed-time; the cron skips if we polled in the last hour.

**Secrets:** already forwarded to JS runtime via Phase 1 `docker-compose.yml` `--runtime.env` fix (`APPODEAL_API_KEY`, `UNITY_KEY_ID`, `APPLE_PRIVATE_KEY`, etc.).

---

### Phase 2.3 — Dashboard perf rewrite (3 days)

Changes to `web/analytics-dashboard/index.html`:

1. **Prefer rollups.** All aggregate loaders call `analytics_dashboard` / `analytics_session_stats` which now return pre-rolled data. No more per-request scan.
2. **Incremental rendering.** Chart/KPI skeleton shown immediately; data streams in as each RPC resolves. No more "all or nothing" loading state.
3. **Cache per tab per refresh window.** `loadedTabs` already implements this at the first-click layer; extend to persist in `sessionStorage` with a 60-second TTL so refreshing the page doesn't re-hammer the server.
4. **Revenue tab lazy join.** Only join Appodeal/AppStore/UGS revenue into the chart on the Revenue tab; don't fetch them from Overview.
5. **Diagnose tab improvements:** add a "Sample an event" button that calls `analytics_log_event` with a synthetic admin event (tagged `admin_diag=true`) and then waits 3 s and re-reads the storage probe — confirms end-to-end write + read works.

---

### Phase 2.4 — Data-quality & backfill tooling (2 days)

- `analytics_backfill_events(from, to, dryRun)` — re-normalizes old events to the current canonical schema (`IVXAnalyticsEvents`). Only runs on `analytics_events`; does not touch rollups.
- `analytics_schema_check()` — scans a sample of recent events and reports field-coverage percentages (e.g. "92% of `iap_purchased` events have `price_usd`").
- Add a JSON schema file `docs/analytics-event-schemas/<event_name>.json` for every canonical event, and the client emits a CI check that fails the build if a TrackEvent call uses a field not in the schema.

---

### Phase 2.5 — SLO + alerting (1 day)

- Add Prometheus metrics in `analytics_log_event`:
  - `analytics_events_accepted_total{eventName}`
  - `analytics_events_rejected_total{reason}`
  - `analytics_events_latency_seconds_bucket`
- Scrape target is already exposed via `:9100` (see `metrics.prometheus_port 9100` in `docker-compose.yml`).
- Alert rules:
  - `rate(analytics_events_accepted_total[10m]) < 0.01` for 30 min → page on-call ("analytics pipeline silent").
  - `rate(analytics_events_rejected_total[10m]) > 0.1 * rate(analytics_events_accepted_total[10m])` → warn ("high rejection rate").
  - `absent_over_time(analytics_rollup_last_success[30h])` → page ("nightly rollup hasn't run").

---

## 3. Ordering & effort

| Phase | Est | Blocks | Critical? |
|-------|-----|--------|-----------|
| 2.1 Rollup cron + dashboard read path | 1 wk | Nothing | YES — unblocks scale |
| 2.2 External pollers | 1 wk | 2.1 rollup shape for revenue merge | YES — fixes Revenue tabs flakiness |
| 2.3 Dashboard perf rewrite | 3 d | 2.1 | Nice-to-have after 2.1 |
| 2.4 Backfill + schema | 2 d | 2.1 | Medium |
| 2.5 SLO + alerting | 1 d | Any of 2.1/2.2 | Medium — ship with 2.1 |

Total wall-clock: **≈ 3 weeks** for one engineer, less with parallelism on 2.2/2.3.

---

## 4. Decisions needed before Phase 2 starts

- [ ] Cron plumbing: **Go goroutine** vs **Docker sidecar**? Default recommendation: Docker sidecar (zero Go work).
- [ ] Rollup retention: keep daily rollups forever, weekly after 90 d, monthly after 1 y? (I recommend yes.)
- [ ] Backfill budget: do we rewrite `analytics_events` older than 30 d to the new schema, or leave them on the old one and only rollup forward? (I recommend the latter — cheaper, no risk.)
- [ ] External pollers: do we poll per-game or per-platform? (Current config has one Appodeal app key per game; poll per-game to keep revenue attribution clean.)
- [ ] Prometheus: do we already have a Prometheus server scraping `:9100` in prod? If not, this becomes part of 2.5.

---

## 5. Non-goals (explicit)

- No move off Goja. We're not porting analytics modules to Go.
- No move off Nakama storage. `analytics_events` stays the source of truth; rollups are derived, not primary.
- No third-party analytics lock-in (Mixpanel / Amplitude / PostHog). The platform owns its data end-to-end.
- No Satori. Confirmed with stakeholder: we don't have a Satori license; all "admin_events_timeline"-style reads must come from our own collections.

---

## 6. Verification after each sub-phase

Every sub-phase ships with:
1. A row added to the Diagnose tab's storage probe (e.g. `analytics_rollup_daily_sample_count`, `external_analytics_appodeal_last_sync`).
2. A script `scripts/verify-phase2-<N>.sh` that can be run by ops to confirm the new data is flowing.
3. A rollback switch: each new module is keyed by a feature flag in `docker-compose.yml` env so we can disable it without redeploy.
