# Insights Loop Integration Guide

**Phase:** 2A → 2B (qv-insights-loop)
**Updated:** 2026-05-31
**Owner:** Backend Engineering

---

## What Is This?

The **qv-insights-loop** is the data pipeline that turns raw game telemetry in Nakama into AI-readable intelligence in the Intelliverse-X-AI service.

Every hour, Nakama's `InsightsAggregator` module:
1. Reads the last hour of RPC samples and analytics events stored in CockroachDB
2. Aggregates them by cohort (e.g., `whale_d30_returning` on `Android 14` playing `multiplayer`)
3. Packages each cohort's data into a compact `InsightBundle`
4. Signs it with HMAC-SHA256 and POSTs it to the AI service at `POST /insights/ingest`

The AI service persists the bundle, generates a vector embedding, and makes it available to the downstream RAG analyst (Phase 2B) for automated briefs, personalization, and cohort assignment.

---

## Architecture

```
Nakama (CockroachDB)                         Intelliverse-X-AI (NestJS + Postgres)
────────────────────────────────────         ──────────────────────────────────────
analytics_events        ──┐
analytics_rpc_samples   ──┤
                          │ InsightsAggregator (hourly)
                          ▼
                    Aggregate by cohort ──── sign with HMAC-SHA256
                                                        │
                                        POST /insights/ingest
                                    ───────────────────────────►
                                        Headers:
                                          X-IVX-Service:   nakama
                                          X-IVX-Timestamp: <unix-ms>
                                          X-IVX-Signature: <hex>
                                        Body: InsightBundle JSON
                                                        │
                                        HmacAuthGuard verifies:
                                          ✓ Timestamp within 5 min
                                          ✓ "nakama" service known
                                          ✓ Signature valid
                                                        │
                                        InsightsIngestService:
                                          → PII scrub
                                          → persist game_insight_v1
                                          → embed summary (pgvector)
                                                        │
                                    ◄───────────────────────────
                                        { insightId, duplicate }
                          │
                          ▼ on non-2xx / timeout
                    pending_bundles (DLQ)
                      ↳ retry with exponential backoff
                      ↳ after 8 attempts → dead_bundles
                      ↳ Discord alert fired
```

---

## The Two Required Env Vars

| Var | Service | Purpose |
|-----|---------|---------|
| `IVX_AI_SVC_BASE_URL` | **Nakama** | Base URL of the Intelliverse-X-AI NestJS server. Nakama appends `/insights/ingest` to form the POST target. If unset, the aggregator silently skips every tick (logs `ai_svc_url_unset`). |
| `IVX_INSIGHTS_SHARED_SECRET` | **Nakama** | Raw HMAC-SHA256 signing key. Nakama signs every bundle request with this and sends the hex digest in `X-IVX-Signature`. Must match the `nakama:` entry in the AI service's `IVX_INSIGHTS_SHARED_SECRETS`. |

Both are now in `RUNTIME_ENV_KEYS` in `docker-compose.yml` (added 2026-05-31) and will be forwarded to the JS runtime via `ctx.env['KEY']`. They must also be present in the `environment:` block of the same file (already added).

---

## Configuration — Exact Values to Set

### Step 1 — Generate a shared secret (run once)

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Example output: a3f9bc7e1d45c2...  (64 hex chars)
```

Save this value. You will use the **same string** in both services.

---

### Step 2 — Nakama `.env`

Add to `c:\Office\Backend\nakama\.env`:

```env
# ── Insights Loop (Phase 2A) ──────────────────────────────────────────
# Base URL of the Intelliverse-X-AI NestJS service.
#   Local dev:    http://localhost:5001
#   Docker (same compose network): http://intelliverse-ai:5001
#   Production:   https://ai.intelli-verse-x.ai
IVX_AI_SVC_BASE_URL=http://localhost:5001

# HMAC signing secret — must match "nakama:<this-value>" in AI svc .env.
IVX_INSIGHTS_SHARED_SECRET=<your-64-char-hex>

# Optional: override the 1-hour aggregation bucket size (milliseconds).
# Default: 3600000 (1h). Use 300000 (5m) for rapid dev/testing only.
# IVX_INSIGHTS_BUCKET_MS=3600000

# ── Discord ops alerts ────────────────────────────────────────────────
# Create two webhooks in your Discord server (Server Settings → Integrations → Webhooks)
DISCORD_QV_OPS_WEBHOOK_URL=https://discord.com/api/webhooks/<channel-id>/<token>
DISCORD_NAKAMA_WEBHOOK_URL=https://discord.com/api/webhooks/<channel-id>/<token>
```

---

### Step 3 — AI Service `.env`

Add to `c:\Office\Backend\Intelliverse-X-AI\.env`:

```env
# ── Insights Loop HMAC guard ──────────────────────────────────────────
# Multi-service secret map. Format: "service-name:raw-secret,..."
# The "nakama:" value MUST exactly match Nakama's IVX_INSIGHTS_SHARED_SECRET.
IVX_INSIGHTS_SHARED_SECRETS=nakama:<your-64-char-hex>

# Optional: replay window in ms (default 300000 = 5 min).
# Increase if your Nakama → AI svc network latency is unusually high.
IVX_INSIGHTS_HMAC_REPLAY_MS=300000

# Dev ONLY — bypasses signature check entirely. NEVER set in production.
# IVX_INSIGHTS_HMAC_DISABLED=1
```

---

### Step 4 — Restart Both Services

```powershell
# Nakama
cd c:\Office\Backend\nakama
docker compose restart nakama

# AI service (if running locally)
cd c:\Office\Backend\Intelliverse-X-AI
npm run start:dev
# or: docker compose restart intelliverse-ai
```

---

## Startup Verification

After restart, check Nakama logs:

```powershell
docker compose logs nakama | Select-String "InsightsAggregator"
```

**Expected (both vars set):**
```
[InsightsAggregator] init ai_svc=configured secret=configured bucket_ms=3600000
```

**If you see MISSING:**
```
[InsightsAggregator] init ai_svc=MISSING (IVX_AI_SVC_BASE_URL) secret=MISSING ...
```
→ The env var did not propagate into the JS runtime. Check that it is in BOTH the `environment:` block AND `RUNTIME_ENV_KEYS` in `docker-compose.yml`.

---

## How to Manually Trigger a Test Bundle

Use the Nakama Console API Explorer at `http://localhost:7351`:

1. Go to **API Explorer** → **Runtime functions**
2. Call `insights_aggregator_tick` (the ops debug RPC)
3. Check the response for `{ ran: true, bucketsProcessed: N, bundlesEmitted: N }`

Or via curl from the `analytics_cron` sidecar pattern:

```powershell
$SECRET = "your-dashboard-secret"
$BODY = '{"force":true}'
Invoke-WebRequest -Uri "http://localhost:7350/v2/rpc/insights_aggregator_tick" `
  -Method POST `
  -Headers @{ "Authorization" = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("defaultkey:")) } `
  -ContentType "application/json" `
  -Body $BODY
```

---

## Manual HMAC Test (Verify AI Svc Receives Bundles)

Run this to confirm the full handshake works before enabling the aggregator:

```javascript
// test-insights-handshake.js — run with: node test-insights-handshake.js
const crypto = require('crypto');
const https = require('http'); // change to https for production

const SECRET = process.env.IVX_INSIGHTS_SHARED_SECRET;
const AI_SVC = process.env.IVX_AI_SVC_BASE_URL || 'http://localhost:5001';

const bundle = {
  schemaVersion: 1,
  bucketStartMs: 0,
  bucketEndMs: 3600000,
  gameId: '126bf539-dae2-4bcf-964d-316c0fa1f92b', // QuizVerse game ID
  cohortLabel: 'test_handshake',
  quizMode: '_none',
  bucketStartIso: '1970-01-01T00:00:00.000Z',
  bucketEndIso: '1970-01-01T01:00:00.000Z',
  sourceCitation: 'storage://analytics_rpc_samples+analytics_events',
  bundleId: 'handshake-test-' + Date.now(),
  aggregate: {
    rpcCalls: 42, rpcSuccessRate: 0.98,
    rpcP50Ms: 45, rpcP90Ms: 120, rpcP99Ms: 350,
    topErrors: [], topEvents: [{ event: 'quiz_start', count: 20 }],
    topCards: [], osBreakdown: [{ key: 'Android', count: 30 }],
    appVersionBreakdown: [], countryBreakdown: [], tierBreakdown: [],
    distinctUsers: 15, distinctSessions: 18,
    llmTokensIn: 0, llmTokensOut: 0, llmCostUsd: 0, llmCalls: 0,
    partial: false,
  },
};

const body = JSON.stringify(bundle);
const ts = String(Date.now());
const path = '/insights/ingest';
const sig = crypto
  .createHmac('sha256', SECRET)
  .update(ts + ':' + path + ':' + body)
  .digest('hex');

const url = new URL(AI_SVC + path);
const req = https.request({
  hostname: url.hostname, port: url.port || 5001,
  path: url.pathname, method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-IVX-Service': 'nakama',
    'X-IVX-Timestamp': ts,
    'X-IVX-Signature': sig,
  },
}, res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
    if (res.statusCode === 200) console.log('✅ Handshake OK');
    else console.log('❌ Handshake FAILED');
  });
});
req.on('error', e => console.error('Request failed:', e.message));
req.write(body);
req.end();
```

```powershell
# Run it:
$env:IVX_INSIGHTS_SHARED_SECRET = "your-64-char-hex"
$env:IVX_AI_SVC_BASE_URL = "http://localhost:5001"
node test-insights-handshake.js
```

Expected output: `Status: 200` and `✅ Handshake OK`.

---

## What the AI Service Does With Bundles

| Step | What Happens |
|------|-------------|
| 1 | `HmacAuthGuard` verifies timestamp + signature. Rejects if >5 min old or sig mismatch. |
| 2 | `InsightsIngestService` checks idempotency on `bundleId` — duplicate bundles (DLQ replays) return 200 without re-writing. |
| 3 | Schema drift detector logs any unknown fields (additive — still ingests). |
| 4 | PII scrubber strips any Bearer tokens, emails, stack-trace fragments from the payload before persist. |
| 5 | Row persisted to `game_insight_v1` with `kind=bundle`. |
| 6 | Best-effort vector embedding of the auto-generated human-readable summary (stored in `pgvector` column). On embedding failure, row is still saved — the KB curator re-embeds in background. |
| 7 | Returns `{ insightId, duplicate, schemaVersion }`. |
| Downstream | The RAG analyst reads `kind=bundle` rows by time range + cohort label to generate briefs, predictions, and A/B experiment hypotheses. |

---

## Bundle Schema Reference

The `InsightBundle` JSON that Nakama POSTs looks like this:

```json
{
  "schemaVersion": 1,
  "bundleId": "126bf539_whale_d30_multiplayer_1748700000000",
  "gameId": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
  "cohortLabel": "whale_d30_returning",
  "quizMode": "multiplayer",
  "bucketStartMs": 1748700000000,
  "bucketEndMs":   1748703600000,
  "bucketStartIso": "2026-05-31T10:00:00.000Z",
  "bucketEndIso":   "2026-05-31T11:00:00.000Z",
  "sourceCitation": "storage://analytics_rpc_samples+analytics_events",
  "aggregate": {
    "rpcCalls": 1240,
    "rpcSuccessRate": 0.987,
    "rpcP50Ms": 48,
    "rpcP90Ms": 134,
    "rpcP99Ms": 412,
    "topErrors": [
      { "rpc": "quizverse_load_pack", "count": 8 },
      { "rpc": "quizverse_submit_answer", "count": 4 }
    ],
    "topEvents": [
      { "event": "quiz_start",    "count": 320 },
      { "event": "quiz_complete", "count": 298 }
    ],
    "topCards": [{ "card": "mythology_hard", "count": 140 }],
    "osBreakdown":      [{ "key": "Android", "count": 780 }],
    "appVersionBreakdown": [{ "key": "2.4.1", "count": 1100 }],
    "countryBreakdown": [{ "key": "IN", "count": 640 }],
    "tierBreakdown":    [{ "key": "mid", "count": 520 }],
    "distinctUsers": 214,
    "distinctSessions": 320,
    "llmTokensIn": 48200,
    "llmTokensOut": 12400,
    "llmCostUsd": 0.014,
    "llmCalls": 38,
    "partial": false,
    "topCrashPatterns": []
  }
}
```

---

## Failure Modes & Self-Healing

| Failure | What Happens |
|---------|-------------|
| AI svc unreachable / timeout | Bundle written to `pending_bundles` (DLQ). Next aggregator tick drains DLQ and retries — self-healing. |
| HMAC secret mismatch | AI svc returns 401. Nakama logs warn + writes to DLQ. Fix secret mismatch → next tick retries. |
| Unknown `gameId` | AI svc returns 4xx. Nakama writes to DLQ. |
| DB error on AI svc | AI svc returns 5xx. Nakama retries with exponential backoff (base 1 min, up to 8 attempts). |
| 8 failed attempts | Row moves to `dead_bundles` collection + Discord alert fires to `#qv-ops`. Requires manual replay via `insights_aggregator_tick` after root-cause fix. |
| `IVX_AI_SVC_BASE_URL` unset | Aggregator returns `reason: ai_svc_url_unset` every tick — silently a no-op. No DLQ writes. Fix → restart Nakama. |

---

## Related Files

| File | Purpose |
|------|---------|
| `data/modules/src/analytics/insights-aggregator.ts` | Nakama side — reads storage, aggregates, signs, POSTs |
| `data/modules/src/analytics/pending-bundles.ts` | DLQ — retry + dead-letter logic |
| `data/modules/src/analytics/event-enricher.ts` | Phase 1A — enriches raw events before they land in `analytics_events` |
| `docker-compose.yml` lines 57-59 | Env var forwarding to JS runtime |
| `src/insights/controllers/insights-ingest.controller.ts` | AI svc — HTTP endpoint |
| `src/insights/services/insights-ingest.service.ts` | AI svc — persist + embed |
| `src/_lib/guards/hmac-auth.guard.ts` | AI svc — HMAC verification |
| `docs/ANALYTICS_PHASE2_PLAN.md` | Original design document |
