# Quizverse — QR Studio Analytics Knowledge Base

**Status:** Live. All four "remaining gaps" closed and verified in production on 2026-04-22.
**Scope:** Every QR scan, landing-page view, and landing-page action that touches the **quizverse** game (or any other QR with `gameId="quizverse"`) — from the user's phone, through `dl.intelli-verse-x.ai`, into the qr-studio Postgres + S3 + Nakama Satori dashboards.
**Audience:** On-call, analytics owners, anyone who needs to triage "where did this scan go?" or "why is the city slice empty?".

---

## 0. TL;DR — single picture

```
                     ┌─────────────────────────────────────────────────────┐
                     │ Phone scans the QR PNG (encodes dl.intelli-verse-x  │
                     │   .ai/quizverse) → 302 to App Store / Play Store    │
                     │   / web fallback based on UA                        │
                     └────────────────────┬────────────────────────────────┘
                                          │
                              ┌───────────▼────────────┐
                              │ smartlink (Fastify)    │
                              │ services/smartlink     │
                              └─────┬──────────┬───────┘
            ┌──────────── geoip-lite│          │ recordScan() (pg INSERT)
            │ (country + city)      │          │
            ▼                       ▼          ▼
   ┌─────────────────────┐  ┌──────────────────┐  ┌─────────────────────────┐
   │ Nakama Satori RPC   │  │ qr-studio        │  │ qr-studio Postgres:     │
   │ satori_event_       │  │ landing pages    │  │ scans (ipCountry,       │
   │ external (qr.scan,  │  │ /l/quizverse     │  │ ipCity, ua*, platform,  │
   │ qr.landing_view,    │  │ → emits          │  │ utm*, gameId via JOIN)  │
   │ qr.landing_action)  │  │ qr.landing_*     │  │ + qr_codes counters     │
   │ via http_key, body  │  │ events itself    │  └──────────┬──────────────┘
   │ double-encoded      │  └─────────┬────────┘             │
   │ metadata.game_id =  │            │                      │
   │ "quizverse"         │            │                      ▼
   └──────────┬──────────┘            │           ┌────────────────────────┐
              │                       │           │ /v1/analytics/* (qr-   │
              ▼                       │           │ studio dashboard,      │
   ┌─────────────────────────┐        │           │ qrstudio.intelli-verse │
   │ Nakama Console          │        │           │ -x.ai) — overview,     │
   │   → Game: quizverse     │        │           │ countries, cities,     │
   │   → Satori → Events     │        │           │ devices, OS, browsers, │
   │   filtered by           │        │           │ referrers, utm, csv    │
   │   metadata.game_id      │        │           │ export                 │
   └─────────────────────────┘        │           └────────────────────────┘
                                      │
                                      ▼
                       ┌──────────────────────────────────┐
                       │ S3 cold storage (monthly         │
                       │ NDJSON, Hive partitions)         │
                       │ qr-studio-warehouse-export       │
                       │ CronJob: 0 2 1 * * UTC           │
                       └──────────────────────────────────┘
```

If any of the four legs (smartlink → Postgres, smartlink → Nakama, qr-studio → Postgres, qr-studio → S3) is broken, this doc tells you which logs to grep, which RPC to probe, and which migration / env-var to fix.

---

## 1. The quizverse QR — what it actually is

| Attribute | Value | Source |
|---|---|---|
| Slug | `quizverse` | `qr_codes.slug` in qr-studio Postgres |
| Tenant | `intelliverse` | `qr_codes.tenantId` → `tenants.slug` |
| Type | `app` | `qr_codes.type` |
| Kind | `dynamic` | `qr_codes.kind` (lets us mutate destination without re-printing) |
| `gameId` | `quizverse` | `qr_codes.gameId` — the **one column** that ties scans into Nakama Console |
| Public URL | `https://dl.intelli-verse-x.ai/quizverse` | Encoded in the PNG/SVG matrix |
| Landing | `https://qrstudio.intelli-verse-x.ai/l/quizverse` | Used when `qr_codes.landingPageId` is set + published |
| iOS target | `https://apps.apple.com/us/app/quizverse/id6752571885?uo=4` | `qr_codes.payloadJson.ios` |
| Android target | Play Store URL | `qr_codes.payloadJson.android` |
| Web fallback | quizverse landing page | `qr_codes.payloadJson.web` |
| PNG asset | `s3://intelli-verse-x-media/qr/<tenant>/<id>.png` | `qr_codes.imagePngS3Key` (presigned URL via dashboard) |
| SVG asset | `s3://intelli-verse-x-media/qr/<tenant>/<id>.svg` | `qr_codes.imageSvgS3Key` |

**`gameId` is the load-bearing field for this entire KB.** Every Satori event we emit copies it into `metadata.game_id`, and every Nakama Console game-scoped view filters by exactly that key. Forget to set `gameId` on a new QR and its scans will land in Postgres but disappear from the Nakama Console quizverse tile.

How to set `gameId` on a new QR (REST):

```bash
curl -X POST https://qrstudio.intelli-verse-x.ai/v1/qr-codes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"...","type":"app","slug":"...","gameId":"quizverse",...}'
```

Or backfill an existing QR by hand:

```sql
UPDATE qr_codes SET "gameId" = 'quizverse' WHERE slug = '<your-slug>';
```

---

## 2. Five flavours of analytics, where each one lives

| Flavour | What you see | Where the data lives | Who writes it |
|---|---|---|---|
| **Real-time scan counters** | "Total scans = 56" on the dashboard | `qr_codes.totalScans`, `qr_codes.uniqueScans` | smartlink `recordScan()` UPDATE |
| **Per-scan row** | Country, city, OS, browser, device, UTM, referrer | `scans` table (partitioned monthly) | smartlink `recordScan()` INSERT |
| **Per-event metric** | Time-series chart, slice-and-dice | Nakama `satori_events` collection + Console UI | smartlink + qr-studio via `satori_event_external` RPC |
| **Landing-page view + action** | `qr.landing_view`, `qr.landing_action` events | Nakama (Satori) + qr-studio Postgres | qr-studio `LandingPublicController` |
| **Cold storage / warehouse** | NDJSON in S3, queryable from Athena/BigQuery | `s3://intelli-verse-x-media/analytics/qr_scans/year=YYYY/month=MM/scans-YYYY-MM.ndjson` | `qr-studio-warehouse-export` CronJob |

---

## 3. Event taxonomy (Satori, on Nakama OSS)

Three event names, one per user-visible action:

| Event | When it fires | Required metadata | Optional metadata that matters |
|---|---|---|---|
| `qr.scan` | Every 302 served by smartlink | `qr_id`, `tenant_id`, `slug`, `qr_kind` | `game_id`, `country`, `city`, `region`, `device_type`, `os`, `browser`, `platform`, `utm_*`, `is_unique`, `is_bot` |
| `qr.landing_view` | Every render of `/l/<slug>` (when QR has a published landing page) | `qr_id`, `tenant_id`, `slug`, `landing_id`, `language` | `game_id`, `country`, `device_type`, `referrer_host` |
| `qr.landing_action` | Every CTA click on a landing page (form submit, link click, share, install button) | `qr_id`, `tenant_id`, `slug`, `landing_id`, `action_id` | `game_id`, `country`, `device_type` |

**Source of truth:** `services/qr-studio/src/common/analytics/satori-taxonomy.ts`. Anything that emits one of these three names MUST go through `AnalyticsService` so the metadata bag is built by `buildScanMetadata` / `buildLandingViewMetadata` / `buildLandingActionMetadata`. This keeps cardinality bounded and validates `game_id` shape.

Cross-reference: `content-factory/docs/qr-studio-analytics-taxonomy.md` is the long-form schema doc. This KB only covers the **quizverse-runbook** angle.

---

## 4. The Nakama plumbing — why it's `satori_event_external` and not `satori_event`

The first attempt to wire qr-studio + smartlink into Nakama Satori failed with HTTP 401 (and earlier silent 404s). Root cause and fix recap:

| Symptom | Root cause | Fix |
|---|---|---|
| smartlink logs `smartlink.satori.non_2xx` 404s for every scan | Code targeted `/v1/event` — that's the **Heroic Labs SaaS** Satori endpoint, not Nakama OSS. Nakama OSS has no `/v1/event`. | Switched to `/v2/rpc/satori_event_external?http_key=<KEY>` with the body **double-JSON-encoded** (Nakama RPC contract). |
| First Nakama RPC returned 401 even with `http_key` | Original `satori_event` RPC begins with `RpcHelpers.requireAuth(ctx)` — `http_key` calls have no user session, so auth fails. | New RPC `satori_event_external` accepts an `identity_id` in the payload and is intended for server-to-server `http_key` calls. |
| After deploy, Nakama crashed with `TypeError: expects 'userId' value to be a valid id` | Inherited `captureEvent` flow tried `appendToUserHistory(userId=identity_id)` — but `identity_id` is an arbitrary string (UID cookie hash), not a Nakama UUID, so the storage layer rejected it. | New `captureEventExternal()` writes events under `SYSTEM_USER_ID` and skips per-user history / SatoriIdentities. |

The **canonical wire shape** (memorise this — it's the #1 question on-call gets):

```
POST http://intelliverse-nakama.aicart.svc.cluster.local:7350
     /v2/rpc/satori_event_external?http_key=<NAKAMA_HTTP_KEY>
Content-Type: application/json

# Body is JSON.stringify(JSON.stringify({...})) — yes, double encoded.
"{\"name\":\"qr.scan\",\"identity_id\":\"<sha256(uid|tenant|salt)>\",\"timestamp\":1776890000000,\"properties\":{...},\"metadata\":{\"qr_id\":\"...\",\"tenant_id\":\"intelliverse\",\"slug\":\"quizverse\",\"qr_kind\":\"dynamic\",\"game_id\":\"quizverse\",...}}"
```

200 response shape: `{"payload":"{\"success\":true,\"data\":{\"success\":true,\"identity_id\":\"...\"}}"}`.

**Confirmed on-call probe** (paste this verbatim if anyone asks "is Satori up?"):

```bash
HTTP_KEY=$(kubectl get secret nakama-secret -n aicart -o jsonpath='{.data.http_key}' | base64 -d)
kubectl run nk-probe --rm -i --restart=Never --image=curlimages/curl:latest --quiet -- \
  -sS -w "\nHTTP=%{http_code}\n" -X POST \
  "http://intelliverse-nakama.aicart.svc.cluster.local:7350/v2/rpc/satori_event_external?http_key=${HTTP_KEY}" \
  -H "Content-Type: application/json" \
  --data-raw '"{\"name\":\"qr.scan\",\"identity_id\":\"oncall-probe\",\"timestamp\":1776890000000,\"properties\":{\"slug\":\"quizverse\"},\"metadata\":{\"qr_id\":\"oncall-probe\",\"tenant_id\":\"intelliverse\",\"slug\":\"quizverse\",\"qr_kind\":\"dynamic\",\"game_id\":\"quizverse\"}}"'
```

If you get HTTP 200 — Satori is healthy. If 4xx/5xx — see §7 "Troubleshooting".

---

## 5. Geo enrichment — how `ipCountry` and `ipCity` finally got populated

Before 2026-04-22, every public scan persisted `ipCountry=NULL` and `ipCity=NULL` because:

1. The redirector **only** read `cf-ipcountry`. We're behind an **AWS ALB**, not Cloudflare, so that header never exists in production.
2. `ipCity` had no header source at all.

The fix (`services/smartlink/src/lib/geoip.ts`) embeds **`geoip-lite`** — a pure-JS MaxMind / GeoLite2 lookup with the data baked into the npm package. Zero infra surface, no API key, no PVC.

Header precedence rules (codified in `pickCountry()`):

1. `cf-ipcountry` if present and not `XX` → wins (Cloudflare's geo DB is fresher).
2. Otherwise → MaxMind lookup against `req.ip` (Fastify's `trustProxy: true` already peels `X-Forwarded-For` from the ALB).
3. RFC1918 / loopback / IPv4-mapped IPv6 prefix all short-circuit to `null` — no garbage rows for in-cluster probes.

Verified post-deploy with synthetic public IPs:

| Test IP | Country resolved | City resolved |
|---|---|---|
| `8.8.8.8` (Google) | US | (anycast — no city) |
| `1.1.1.1` (Cloudflare) | AU | (anycast — no city) |
| `4.4.4.4` (Level3) | GB | Plymouth |
| `139.130.4.5` (Telstra) | AU | Gold Coast |
| `203.0.113.45` (TEST-NET) | (none — RFC5737) | (none) |

Anycast IPs intentionally lack a city in the embedded DB — real client IPs from real handsets always populate both columns.

Tests: `services/smartlink/test/geoip.test.ts` covers the precedence rules + RFC1918 short-circuit.

---

## 6. Warehouse export — monthly cold storage

**CronJob:** `qr-studio-warehouse-export` in namespace `qr-studio`, schedule `0 2 1 * *` UTC (02:00 on day 1 of every month).
**Output:** `s3://intelli-verse-x-media/analytics/qr_scans/year=YYYY/month=MM/scans-YYYY-MM.ndjson`
**Format:** NDJSON (Hive-style partitioning), one row per scan, schema mirrors `scans` table.
**Idempotent:** each run overwrites the same key; safe to re-trigger.

**Backfill recipe** (when on-call needs to ship an arbitrary month):

```bash
kubectl get cronjob qr-studio-warehouse-export -n qr-studio -o json | \
  jq '.spec.jobTemplate.spec.template.spec.containers[0].env |= map(if .name=="WAREHOUSE_MONTH" then .value="2026-02" else . end)' | \
  jq '{apiVersion:"batch/v1",kind:"Job",metadata:{name:"warehouse-backfill-202602",namespace:"qr-studio"},spec:.spec.jobTemplate.spec}' | \
  kubectl apply -f -
kubectl wait --for=condition=complete job/warehouse-backfill-202602 -n qr-studio --timeout=300s
kubectl logs -n qr-studio job/warehouse-backfill-202602 --tail=20
```

The exporter uses NestJS's `createApplicationContext` (not the HTTP server) and runs in the same image as the API, so any schema change the API knows about, the exporter knows about. No version skew.

**Rationale for 02:00 UTC on day 1** — captured in the YAML annotation on `intelli-verse-kube-infra/qr-studio/50-warehouse-cronjob.yaml` so it survives an operator change.

---

## 7. Troubleshooting — symptom → root cause → fix

| Symptom | Likely cause | First diagnostic | Fix |
|---|---|---|---|
| Nakama Console "quizverse → Satori → Events" tab empty for QR events | New QR was created without `gameId='quizverse'` | `SELECT slug, "gameId" FROM qr_codes WHERE "tenantId" = '<id>' ORDER BY "createdAt" DESC` | `UPDATE qr_codes SET "gameId"='quizverse' WHERE slug='<slug>'` |
| `/v1/analytics/cities` returns `[]` | Either no public scans yet or geoip-lite not deployed | `kubectl describe deploy/smartlink -n aicart | grep Image` — must contain `:geoip-*` or newer | Roll smartlink to image with geoip-lite (`970547373533.dkr.ecr.us-east-1.amazonaws.com/smartlink:latest`) |
| `/v1/analytics/countries` only shows in-cluster probes (cluster IPs) | `req.ip` returning the LB IP, not the client | Check Fastify config — `trustProxy: true` MUST be set in `services/smartlink/src/server.ts` | Add `trustProxy: true` to the Fastify constructor |
| smartlink logs flood with `smartlink.satori.non_2xx` | Wrong endpoint or wrong `http_key` | `kubectl get secret nakama-secret -n aicart -o jsonpath='{.data.http_key}' | base64 -d` and confirm it matches `qr-studio-secrets/nakama-server-key` | Sync the keys; or run the §4 probe to see the actual error body |
| Nakama logs `TypeError: expects 'userId' value to be a valid id` | Old version of the satori event RPCs is deployed | `kubectl logs -n aicart -l app=intelliverse-nakama | grep -i 'satori_event'` and confirm RPC is `satori_event_external`, not `satori_event` | Roll Nakama to the image that ships `nakama/data/modules/src/satori/event-capture/event-capture.ts` with `captureEventExternal` |
| `qr_codes.totalScans` doesn't increment on real scans | smartlink missing `DATABASE_URL` (falls back to `tenants.json` and skips Postgres write) | `kubectl exec deploy/smartlink -n aicart -- env | grep DATABASE_URL` | Add `DATABASE_URL` from `qr-studio-secrets/database-url` to `intelli-verse-kube-infra/smartlink/deploy.yaml` |
| `scans` table missing rows even though `totalScans` increments | `recordScan()` raised an error and was logged at `warn` (best-effort) | `kubectl logs -n aicart -l app=smartlink | grep smartlink.resolver.scan_insert_failed` | Read the wrapped Postgres error and fix the schema mismatch (most often a missing column on a new field) |
| Warehouse export job stuck in `Active` | Pod can't pull image, or DB connect timeout | `kubectl describe job/<name> -n qr-studio` | Same DB / ECR fixes as the API deployment |
| Landing page renders but no `qr.landing_view` event in Nakama | qr-studio API container missing `NAKAMA_HTTP_URL` or `NAKAMA_SERVER_KEY` | `kubectl exec deploy/qr-studio-api -n qr-studio -- env | grep NAKAMA` — both must be non-empty | Re-apply `intelli-verse-kube-infra/qr-studio/20-backend-config.yaml` and verify the secret |

---

## 8. Quick links — files, manifests, dashboards

### Code (source of truth)
- `nakama/data/modules/src/satori/event-capture/event-capture.ts` — `satori_event_external` RPC, `captureEventExternal()`
- `services/qr-studio/src/common/analytics/satori-taxonomy.ts` — event schema
- `services/qr-studio/src/common/analytics/satori.service.ts` — qr-studio Satori client (Nakama RPC)
- `services/qr-studio/src/common/analytics/analytics.service.ts` — `emitScan` / `emitLandingView` / `emitLandingAction`
- `services/qr-studio/src/landing/landing-public.controller.ts` — landing page event emit
- `services/qr-studio/src/scans/analytics-dashboard.controller.ts` — dashboard endpoints (`/v1/analytics/{overview,countries,cities,devices,os,browsers,referrers,utm,timeseries,export}`)
- `services/qr-studio/src/warehouse/warehouse-cli.ts` — CronJob entry-point
- `services/qr-studio/src/warehouse/warehouse-exporter.service.ts` — NDJSON export
- `services/smartlink/src/handlers/redirect.ts` — 302 + emit + persist
- `services/smartlink/src/lib/geoip.ts` — geoip-lite enrichment
- `services/smartlink/src/lib/qrResolver.ts` — Postgres slug resolver + `recordScan()`
- `services/smartlink/src/lib/satoriEmit.ts` — smartlink Satori client (Nakama RPC)

### Kubernetes manifests
- `intelli-verse-kube-infra/qr-studio/20-backend-config.yaml` — `NAKAMA_HTTP_URL`, `NAKAMA_SATORI_RPC`
- `intelli-verse-kube-infra/qr-studio/21-backend-deployment.yaml` — `NAKAMA_SERVER_KEY`, AWS keys, prisma-migrate init
- `intelli-verse-kube-infra/qr-studio/50-warehouse-cronjob.yaml` — monthly export
- `intelli-verse-kube-infra/smartlink/deploy.yaml` — smartlink deployment + `DATABASE_URL` + `NAKAMA_*` env

### Live URLs
- Public smartlink: https://dl.intelli-verse-x.ai/quizverse
- QR Studio dashboard: https://qrstudio.intelli-verse-x.ai
- Nakama Console: (in-cluster — port-forward `intelliverse-nakama:7351`)

### Long-form references
- Schema / payload contract: `content-factory/docs/qr-studio-analytics-taxonomy.md`
- Nakama analytics base layer: `nakama/docs/ANALYTICS_ROOT_CAUSE_AND_FIX.md`, `ANALYTICS_PHASE2_PLAN.md`
- Game-mode RPCs adjacent to QR analytics: `nakama/docs/QUIZ_DAILY_COMPLETION_RPC.md`, `RPC_DOCUMENTATION.md`

---

## 9. Closed gaps log (post-2026-04-22 review)

| # | Gap | Status | Closing change |
|---|---|---|---|
| 1 | `ipCity` always null | Closed | `services/smartlink/src/lib/geoip.ts` (geoip-lite) — content-factory commit `9532f646c` |
| 2 | `ipCountry` empty for ALB traffic | Closed | Same fix as #1 (geoip-lite covers country regardless of ALB header stripping) |
| 3 | No CronJob for warehouse export | Closed | `intelli-verse-kube-infra/qr-studio/50-warehouse-cronjob.yaml` + `services/qr-studio/src/warehouse/warehouse-cli.ts` — content-factory `9532f646c`, infra `fda94df` |
| 4 | Satori `qr.scan` POST returns 401 | Closed | Switched to `satori_event_external` RPC (nakama commit `b3f3894a`); also documented in §4 |
| 5 | `ga4_client_id` always null | Acknowledged accept-as-is | Landing pages already fire GA4 client-side via `gtag.js`; redirect path is server-side only and intentionally has no client-id binding |

If a new gap surfaces, append a row here with the closing commit SHA so this doc stays the single point of truth for "what's wired and what isn't".
