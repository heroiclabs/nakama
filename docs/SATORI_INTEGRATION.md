# Heroic Labs Satori + In-House Dashboard Integration

**Updated:** 2026-05-10 (v3 — hardcoded ALWAYS wins, env IGNORED for critical keys)  •  **Owner:** Backend / Analytics

> **v3 patch note (2026-05-10 evening):** Hardcoded constants for `ADMIN_USERNAME`,
> `ADMIN_PASSWORD`, `ADMIN_PASSWORD_HASH`, `DASHBOARD_SECRET`, and the five
> `SATORI_*` keys are now **force-overrides** — `ctx.env` is IGNORED for them.
> v2 was env-first → fallback-to-hardcoded, which silently broke when the prod
> cluster had stale `ADMIN_*` / `SATORI_*` env vars set. New diagnostic RPC
> `analytics_creds_check` returns fingerprints of the values the running pod is
> actually using.
>
> **v3.1 patch note (same session):** The dashboard frontend hardcoded
> `serverKey: 'defaultkey'`, but prod Nakama runs with `--runtime.http_key`
> sourced from k8s Secret `nakama-secret/http_key` (a non-default value). The
> mismatch caused Nakama's HTTP layer to return `401 "HTTP key invalid"` before
> our `admin_login` JS even ran — the dashboard rendered that as a generic
> "Invalid credentials" toast, making it look like a bad password. **Fix:**
> CodeBuild's `pre_build` phase now reads the real http_key from the secret
> and sed-replaces the placeholder in `web/analytics-dashboard/index.html`
> before docker build. The Dockerfile then overlays the patched file onto
> `console/ui/dist/analytics.html` (which `//go:embed`'s into the binary), so
> the served dashboard always uses the cluster's actual key — automatically,
> with zero kubectl on the developer's side.

This is the runbook for getting analytics flowing to **both** dashboards:

- **In-house** &nbsp;`https://nakama.intelli-verse-x.ai/analytics.html`
- **Satori cloud** &nbsp;`https://quizverse-satori-dev-8bf5.us-east1-b.satoricloud.io/dashboard`

## TL;DR

Everything is wired. Just `git push origin main` → CodeBuild rolls out → live
events flow to both dashboards AND historical data auto-backfills in the
background. **No DevOps cluster patching, no curl loops.**

```
                 +------------------+    persistNormalizedEvent
Unity client --> | analytics_log_   | -- dash_* keys ---> in-house dashboard
                 | event RPC        | -- sdEventsPublish > Satori cloud
                 |                  | -- abAutoRunIfNeeded ┐
                 +------------------+                       │  (debounced 5s tick)
                                                            ▼
Admin opens dashboard ──► admin_login ──► abAutoRunIfNeeded ┘
                                                            │
                                                            ▼
       ┌─────────────────────────────────────────────────────────────────┐
       │  abAutoRunTick: state machine in analytics_backfill_auto/state  │
       │  init → identity → events_replay → dau_synthetic → rollup → done│
       └─────────────────────────────────────────────────────────────────┘
                       (one page per tick, ≈500ms-1s, idempotent)
```

Events take ONE path (`analytics_log_event` → fan-out). The Unity
`SatoriService.CaptureEvent` calls hit a no-op shim on the server so they don't
double-publish. Satori is reached via a pure-JS HTTP client (`satori_direct.js`)
with hardcoded URL + API key + signing key — no Nakama CLI flags, no k8s Secret.

The historical backfill (which used to need manual curl loops in three modes)
is now auto-driven: every `analytics_log_event` and `admin_login` call
piggybacks ONE debounced tick of the state machine. Phases run in order, each
tick processes one page (≈50 docs), and after a few hours of normal traffic
the backfill self-completes. Status: `analytics_auto_status` RPC.

## What changed (2026-05-10, v2)

Two-phase roll-out. The earlier version (committed earlier today) wired Satori
through `nk.getSatori()` with credentials supplied via `--satori.*` CLI flags
and a k8s Secret, requiring DevOps to patch the Deployment. The v2 path replaces
that with a pure-JS direct-HTTP client whose credentials are hardcoded in source.
**Trade-off:** anyone with read access to this repo or to the ECR image can
extract the Satori credentials. Accepted by the project owner; mitigation is
key rotation when needed (see "Rotating credentials" below).

| File | Purpose |
|------|---------|
| `data/modules/satori_direct/satori_direct.js` (new) | Pure-JS Satori HTTP client. Hardcodes URL / API key name / API key / signing key. Mints session JWTs locally via `nk.jwtGenerate`. Exposes `sdEventsPublish`, `sdPropertiesGet`, `sdPropertiesUpdate`, `sdFlagsList` and an `satori_diag` RPC. |
| `data/modules/analytics/analytics.js` | `persistNormalizedEvent` calls `sdEventsPublish` (was `nk.getSatori().eventsPublish`). |
| `data/modules/analytics_backfill/analytics_backfill.js` | All three modes (identity / events_replay / dau_synthetic) call `sd*` helpers (were `nk.getSatori()...`). **Adds an auto-drain state machine** (`abAutoRunIfNeeded` + `analytics_auto_kick` / `analytics_auto_status` / `analytics_auto_reset` RPCs) that ticks one page per piggyback call, walks `init → identity → events_replay → dau_synthetic → rollup → done`, and self-completes without operator action. |
| `data/modules/analytics/analytics.js` | `rpcAnalyticsLogEvent` calls `abAutoRunIfNeeded` after each ingest — every Unity event call drives one debounced tick. |
| `data/modules/analytics_admin/analytics_admin.js` | `rpcAdminLogin` also calls `abAutoRunIfNeeded` — opening the dashboard kicks the state machine. |
| `data/modules/analytics_rollup/analytics_rollup.js` | `arEnv("DASHBOARD_SECRET")` falls back to the same hardcoded constant as `aaEnv` so the auto-drain's synthetic admin gate (which calls `rpcAnalyticsRollupBackfill` internally) passes without a cluster-side env var. |
| `data/modules/satori_compat/satori_compat.js` | Identity / flags forwarders use `sdPropertiesGet` / `sdPropertiesUpdate` / `sdFlagsList`. Events RPCs are still no-ops to prevent double-publishing. |
| `data/modules/analytics_admin/analytics_admin.js` | `aaEnv()` falls back to **hardcoded constants** for `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, and `DASHBOARD_SECRET` when `ctx.env` doesn't supply them. Other env vars unaffected. |
| `Dockerfile.production` | Stage 2 overlays `web/analytics-dashboard/index.html` onto `console/ui/dist/analytics.html` BEFORE `go build` so the embedded asset is the modern admin-authed dashboard. |
| `docker-compose.yml` | Removed the `--satori.*` CLI-flag forwarding (the JS direct-HTTP path doesn't use it). `SATORI_*` env vars are still forwarded to the JS runtime as `--runtime.env` overrides. |

## How it works

`nk.getSatori()` is a Go-side client that needs `--satori.url`,
`--satori.api_key_name`, `--satori.api_key`, and `--satori.signing_key` CLI flags
or Nakama refuses to start. Those flags must come from a k8s Secret + Deployment
patch that we no longer require — instead, `satori_direct.js`:

1. **Hardcodes** the four Satori values as JS constants (with `ctx.env` fallback
   if anyone ever wants to override at the cluster level).
2. Mints session JWTs in JS via `nk.jwtGenerate("HS256", SIGNING_KEY, claims)` —
   exactly the algorithm `internal/satori/satori.go::generateToken` uses.
3. Calls Satori REST endpoints directly via `nk.httpRequest`:
   - `POST /v1/event` — Bearer JWT, body `{events: [{name, timestamp (RFC3339), metadata, ...}]}`
   - `GET  /v1/properties` — Bearer JWT
   - `PUT  /v1/properties` — Bearer JWT, body `{default?, custom?, recompute?}`
   - `GET  /v1/flag` — Bearer JWT

`satori_direct.sdResolve(ctx, key, fallback)` returns the hardcoded constant
**directly** for the five `SATORI_*` keys (`SATORI_URL`, `SATORI_API_KEY_NAME`,
`SATORI_API_KEY`, `SATORI_SIGNING_KEY`, `SATORI_HTTP_TIMEOUT_MS`) — `ctx.env` is
ignored for them. Same for `aaEnv` (admin keys + secret) and `arEnv`
(`DASHBOARD_SECRET`). To rotate any of these values: edit the constant in source
and ship a new image. There is no env-var override path; that's intentional —
the env-first behaviour bit us in v2 when prod had stale values from a long-gone
deployment that silently shadowed the new constants and broke login + Satori
auth. If you absolutely need an env-driven path again, edit `aaEnv` / `sdResolve`
/ `arEnv` and remove the early-return blocks marked "Hardcoded-FIRST".

## Phase-1: deploy

```bash
cd /c/Office/Backend/nakama
git status                 # confirm clean
git push origin main       # CodeBuild → kubectl set image → rollout
```

That's it. The image bundle includes all Satori credentials, the modern
dashboard HTML, the admin user, and the dashboard secret.

While the rollout completes:

```bash
kubectl -n aicart rollout status deployment/intelliverse-nakama --timeout=5m
kubectl -n aicart logs -f deployment/intelliverse-nakama \
  | rg -i 'satori_direct|analytics_backfill|satori_compat'
```

**Expected log lines** on first boot:

```
[satori_direct] module loaded — RPC satori_diag registered, base url=https://quizverse-satori-dev-8bf5.us-east1-b.satoricloud.io
[satori_compat] module loaded — 5 RPCs registered
[analytics_backfill] module loaded — RPC analytics_backfill_dual registered
```

## Phase-2: smoke test

### Login to the in-house dashboard

```
URL:      https://nakama.intelli-verse-x.ai/analytics.html
Username: ivx-admin
Password: <stored separately — see scripts/generate-admin-creds.mjs output>
```

The plaintext password is **not** in this repo. It was printed once when
`scripts/generate-admin-creds.mjs` ran. If you've lost it, rerun the script —
it generates a new password, hash, and dashboard secret, then writes them to
`.env`. Update the constants in `analytics_admin.js` (search for
`AA_FALLBACK_*`) and ship a new image.

### Verify Satori connectivity

```bash
# satori_diag RPC publishes one test event and returns the HTTP response.
# No auth gate (intentional — single ignored event is cheaper than a 401 round-trip).
curl -X POST \
  "https://nakama-rest.intelli-verse-x.ai/v2/rpc/satori_diag?http_key=$HTTP_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"payload":"{}"}'

# Expected:
# { "payload":"{\"success\":true,\"code\":200,\"body\":\"\",\"url\":\"https://quizverse-satori-dev-8bf5.../v1/event\",\"api_key_name\":\"SATORIAPIKEY\",\"api_key_present\":true,\"signing_key_present\":true}" }
#
# success=false + code=401  → SATORI_API_KEY rejected. Rotate or fix the constant.
# success=false + code=403  → JWT rejected. SATORI_SIGNING_KEY mismatch.
# success=false + code=0    → DNS / network failure to Satori host.
```

### End-to-end event flow

```bash
# Authenticate as admin to mint a session token
ADMIN_TOKEN=$(curl -s -X POST \
  "https://nakama-rest.intelli-verse-x.ai/v2/rpc/admin_login?http_key=$HTTP_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"payload":"{\"username\":\"ivx-admin\",\"password\":\"<plaintext>\"}"}' \
  | jq -r '.payload | fromjson | .token')

# Send a test event via analytics_log_event (this is what Unity does)
curl -X POST \
  "https://nakama-rest.intelli-verse-x.ai/v2/rpc/analytics_log_event" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"payload":"{\"gameId\":\"<DEFAULT_GAME_ID>\",\"eventName\":\"smoke_test\",\"eventData\":{\"source\":\"runbook\"}}"}'
# Expect: { "success": true, "accepted": 1, "rejected": 0 }

# Verify in-house dashboard: login → events timeline → look for smoke_test
# Verify Satori cloud:        Events → Live → filter name=smoke_test
```

## Phase-2.5: diagnose "Invalid credentials" / "no Satori data"

If you push, the build succeeds, but login still says invalid OR Satori still
shows zero events, run these in order. Each is no-auth (or self-mints a token)
so they work even when login is broken.

### Step 0 — find the real prod http_key (needed for every step below)

The prod cluster's `--runtime.http_key` is NOT `defaultkey` — Nakama 401s every
no-auth RPC otherwise. Read it once and export to your shell:

```bash
# Requires kubectl access to the aicart namespace.
HTTP_KEY=$(kubectl -n aicart get secret nakama-secret \
  -o jsonpath='{.data.http_key}' | base64 -d)
echo "key fingerprint: $(printf '%s' "$HTTP_KEY" | head -c 4)…(len=$(printf '%s' "$HTTP_KEY" | wc -c))"
```

If you don't have kubectl: tail the latest CodeBuild logs — the `pre_build`
phase prints the same fingerprint right after "http_key fingerprint=…".
Use that to sanity-check the value you have.

All curl commands below use `?http_key=$HTTP_KEY`.

### Step 1 — confirm the new image is actually running

```bash
# kubectl path (if you have kubeconfig)
kubectl -n aicart get deployment intelliverse-nakama \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
# Expected: image tag matches the latest commit SHA you pushed.

# HTTP path (no kubectl needed) — every pod tags health response with build sha
curl -s "https://nakama-rest.intelli-verse-x.ai/v2/rpc/nakama_js_health?http_key=$HTTP_KEY" \
  -H 'Content-Type: application/json' -d '""' | jq
# Expected: { "payload": "{\"ok\":true,\"build\":\"<sha>\",...}" }
# If sha is OLD → CodeBuild patched ECR but kubectl set image hasn't restarted
# the pods yet (or the rollout is paused). Check the AWS CodeBuild logs and
# the Deployment's lastUpdateTime.
```

### Step 2 — confirm what credentials the pod is using (no auth needed)

```bash
curl -s "https://nakama-rest.intelli-verse-x.ai/v2/rpc/analytics_creds_check?http_key=$HTTP_KEY" \
  -H 'Content-Type: application/json' -d '""' | jq -r '.payload | fromjson'
```

Expected response (fingerprints only, never the full secret):

```json
{
  "admin_username": "ivx-admin",
  "admin_password_hash_fp":  { "set": true, "len": 60, "first4": "$2b$", "last4": "KTqS" },
  "admin_password_plain_fp": { "set": true, "len": 16, "first4": "bLxI", "last4": "5kAK" },
  "dashboard_secret_fp":     { "set": true, "len": 64, "first4": "2074", "last4": "d34c8" },
  "cluster_env_set": {
    "ADMIN_USERNAME": false,
    "ADMIN_PASSWORD_HASH": false,
    "ADMIN_PASSWORD": false,
    "DASHBOARD_SECRET": false,
    "SATORI_URL": false,
    "SATORI_API_KEY": false,
    "SATORI_SIGNING_KEY": false
  },
  "admin_creds_source": "hardcoded"
}
```

What to check:

- `admin_username` should be `ivx-admin`. If it's anything else → the wrong
  bundle is loaded; old code is running. Verify Step 1.
- `admin_password_plain_fp.first4 + last4` should match the password you're
  typing (`bLxI…5kAK`). If they don't match, your typed password is wrong, not
  the server's. Re-type carefully — copy/paste from the runbook.
- `cluster_env_set.*` flags being `true` is now harmless (env is ignored), but
  they tell you the cluster Secret WAS patched at some point — clean it up
  later for hygiene.

### Step 3 — confirm Satori is actually reachable + auth works

```bash
curl -s "https://nakama-rest.intelli-verse-x.ai/v2/rpc/satori_diag?http_key=$HTTP_KEY" \
  -H 'Content-Type: application/json' -d '""' | jq -r '.payload | fromjson'
```

Expected:

```json
{
  "success": true,
  "code": 200,
  "url": "https://quizverse-satori-dev-8bf5.us-east1-b.satoricloud.io/v1/event",
  "api_key_name": "SATORIAPIKEY",
  "api_key_present": true,
  "signing_key_present": true,
  "body": ""
}
```

If `success=false`:

| `code` | Meaning | Fix |
|--------|---------|-----|
| `401`  | API key rejected | Rotate `SD_API_KEY` constant in `satori_direct.js`, regenerate via `node postbuild.js`, re-push. |
| `403`  | JWT rejected (signing key wrong) | Rotate `SD_SIGNING_KEY` constant. |
| `400`  | Bad request body | Bundle mismatch — confirm Step 1. |
| `0`    | Network / DNS to Satori host failed | Check egress rules + DNS. |

### Step 4 — confirm backfill is progressing

```bash
curl -s "https://nakama-rest.intelli-verse-x.ai/v2/rpc/analytics_auto_status?http_key=$HTTP_KEY" \
  -H 'Content-Type: application/json' -d '""' | jq -r '.payload | fromjson'
```

Expected over time:

- First call: `{ phase: "init", ... }` or `{ phase: "identity", cursor: "...", stats: { processed: N } }`
- After ~10 minutes of normal traffic: phase advances to `events_replay` then
  `dau_synthetic` then `rollup`.
- Final: `{ phase: "done", ... }` — backfill complete; nothing more to do.

If `phase` doesn't advance for 30+ minutes:

```bash
# Force a tick (bypasses the 5-min "done" debounce)
curl -s "https://nakama-rest.intelli-verse-x.ai/v2/rpc/analytics_auto_kick?http_key=$HTTP_KEY" \
  -H 'Content-Type: application/json' -d '""' | jq -r '.payload | fromjson'
```

### Step 5 — if all the above are green but the dashboard still rejects login

Almost certainly your browser cached the old `analytics.html`. Hard-reload
(Ctrl+Shift+R) on the dashboard URL or open it in an incognito window. The
embedded asset changed in v2 (new `Dockerfile.production` overlay copies the
modern dashboard over the legacy one before `go build`).

## Phase-3: historical backfill (now automatic)

After the v2 patch, historical backfill self-drives via a state machine in
`analytics_backfill.js` (see "Auto-drain state machine" section header in that
file). You don't have to do anything — the moment Unity starts hitting
`analytics_log_event` after deploy, or the moment an admin opens
`/analytics.html`, the state machine ticks.

### What runs automatically

Each piggyback tick processes ONE page (≈50 docs, ≈500 ms-1 s) of the
**current phase**. Phases run in order, then stay at `done`:

| # | Phase            | What it does | Source |
|---|------------------|--------------|--------|
| 1 | `init`           | Derives the rollup date range from oldest `analytics_dau` key (capped at 180 days back). | `analytics_dau` collection |
| 2 | `identity`       | Pushes user profiles (platform, country, locale, lt_events…) to Satori `propertiesUpdate`. | `game_player_analytics` |
| 3 | `events_replay`  | Replays up to 500 events/user into BOTH targets: `dash_*` keys in `analytics_events` (in-house) and Satori `eventsPublish`. | `game_player_analytics.events[]` |
| 4 | `dau_synthetic`  | Writes one `dau_synthetic` event per `gameId+date` to Satori so the DAU chart shows historical shape. | `analytics_dau` |
| 5 | `rollup`         | Calls `rpcAnalyticsRollupBackfill` for each 30-day chunk in the derived range to populate `analytics_rollup_*` (powers in-house aggregate charts). | newly-replayed `analytics_events` |
| 6 | `done`           | No-op forever, unless `analytics_auto_reset` is called. | n/a |

Debounce: 5 seconds between ticks. So at typical traffic (10–20
`analytics_log_event` calls/min) the state machine takes ≈2 minutes per 1000
docs of work. A 50K-doc backfill drains in ≈80 minutes of background work.

### Monitor the auto-drain

The `analytics_auto_status` RPC is read-only and unauthenticated:

```bash
curl -s -X POST \
  "https://nakama-rest.intelli-verse-x.ai/v2/rpc/analytics_auto_status?http_key=$HTTP_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"payload":"{}"}' \
  | jq '.payload | fromjson'

# Sample response (after 10 min of post-deploy traffic):
# {
#   "success": true,
#   "initialized": true,
#   "phase": "events_replay",
#   "progress_pct": 50,
#   "ticks": 23,
#   "started_at": 1715354400,
#   "last_tick_at": 1715354520,
#   "cursor": "<storage cursor of next page>",
#   "rollup_window": { "from": "2025-12-15", "cursor": "2025-12-15", "to": "2026-05-10" },
#   "stats": {
#     "identity":      { "users": 487, "satori_calls": 487 },
#     "events_replay": { "users": 92, "events_pushed": 14600, "dash_writes": 14600, "satori_calls": 92 },
#     "dau_synthetic": { "days": 0, "satori_calls": 0 },
#     "rollup":        { "dates_done": 0, "dates_failed": 0 }
#   },
#   "errors": []
# }
```

Watch progress:

```bash
while : ; do
  curl -s -X POST "https://nakama-rest.intelli-verse-x.ai/v2/rpc/analytics_auto_status?http_key=$HTTP_KEY" \
    -H 'Content-Type: application/json' -d '{"payload":"{}"}' \
    | jq -r '.payload | fromjson | "\(.phase) \(.progress_pct)% ticks=\(.ticks) cursor=\(.cursor)"'
  sleep 10
done
# When you see `done 100%`, both dashboards are fully populated.
```

### Force a tick (rare — debugging only)

If the dashboard hasn't been opened and there's no analytics traffic yet
(e.g. fresh staging deploy), you can prod the state machine manually:

```bash
curl -X POST \
  "https://nakama-rest.intelli-verse-x.ai/v2/rpc/analytics_auto_kick?http_key=$HTTP_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"payload":"{\"force\":true}"}' \
  | jq '.payload | fromjson'
# {"success": true, "state_phase": "identity", "processed": 50, "ticks": 1, ...}
# Run in a loop with `force: true` to drain rapidly without waiting for traffic.
```

### Reset (rare — re-replay history)

If you need to restart the state machine from scratch (e.g. after fixing a
bug in `events_replay`), call `analytics_auto_reset`. It's admin-gated:

```bash
DASHBOARD_SECRET="<AA_FALLBACK_DASHBOARD_SECRET from analytics_admin.js>"
curl -X POST \
  "https://nakama-rest.intelli-verse-x.ai/v2/rpc/analytics_auto_reset?http_key=$HTTP_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"payload\":\"{\\\"dashboard_secret\\\":\\\"$DASHBOARD_SECRET\\\"}\"}"
# Next piggyback re-runs init → identity → … from scratch.
```

> **Limitation:** the per-user buffer in `game_player_analytics.events[]` is
> capped at 500 events. Older events were overwritten as new ones arrived
> (by design in `player_analytics_store.js`). For events older than the 500-
> event buffer, only the `dau_synthetic` and `rollup` phases reconstruct
> chart-level history — the per-event timeline can't go back further.

### Manual mode (still available if you want it)

The original `analytics_backfill_dual` RPC remains registered for cases where
you want full operator control over pacing, page sizes, or running individual
modes. Payload accepts `mode: "identity" | "events_replay" | "dau_synthetic"`,
`cursor`, `limit`, `to_satori`, `to_dashboard`, `dry_run` — see the inline
comments in `data/modules/analytics_backfill/analytics_backfill.js` for the
full schema.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|-------------------|
| `satori_diag` returns `code: 401` | `SATORI_API_KEY` constant in `satori_direct.js` is wrong or revoked. Check Satori console → API Keys. |
| `satori_diag` returns `code: 403` | JWT rejected — `SATORI_SIGNING_KEY` constant in `satori_direct.js` doesn't match Satori's record for that API key name. |
| `satori_diag` returns `code: 0` | DNS / network. Confirm the pod can reach `quizverse-satori-dev-8bf5.us-east1-b.satoricloud.io:443` — usually a NetworkPolicy / egress rule. |
| `/analytics.html` is empty | (a) The legacy embedded HTML is still served — confirm CodeBuild ran with the `Dockerfile.production` overlay. (b) `admin_login` returns 503 — the JS-runtime fallback constants didn't load (check startup logs for `[analytics_admin] module loaded`). |
| `admin_login` returns 401 | Wrong password. Plaintext was printed by `scripts/generate-admin-creds.mjs` — re-run it to mint a new one and update `AA_FALLBACK_*` constants. |
| Backfill RPC returns `unauthorized` | `dashboard_secret` payload field doesn't match `AA_FALLBACK_DASHBOARD_SECRET`. They MUST match exactly (64 hex chars). |
| `analytics_auto_status` shows `phase: events_replay` for hours, no progress | Either no traffic is hitting `analytics_log_event` (admin login also kicks it; or call `analytics_auto_kick` with `force: true` from a curl loop), or page is stuck on a poison doc — check `errors` array in the status response. |
| Satori dashboard still empty after `events_replay` finishes | Check `nakama` logs for `[satori_direct] eventsPublish` HTTP errors. 401 = wrong API key, 429 = rate limit (lower `AB_AUTO_PAGE_SIZE`, ship a new image). |
| In-house dashboard charts empty after `rollup` finishes | The `rollup_window` in `analytics_auto_status` may be too narrow. Reset state (`analytics_auto_reset`) — `init` re-derives the window. |
| Unity client logs `RPC satori_event not found` | `satori_compat` module didn't load. Look for `[satori_compat] module loaded — 5 RPCs registered` in startup logs. |

## Rotating credentials

When you need to rotate Satori or admin credentials:

### Satori (URL / API key / signing key)

1. Issue a new API key + signing key in the Satori console.
2. Open `data/modules/satori_direct/satori_direct.js`, edit the four constants
   at the top: `SD_URL`, `SD_API_KEY_NAME`, `SD_API_KEY`, `SD_SIGNING_KEY`.
3. `git commit && git push` → CodeBuild rolls out.
4. Once healthy, revoke the old API key in Satori.

### Admin password

```bash
cd /c/Office/Backend/nakama
node scripts/generate-admin-creds.mjs
# Prints: new plaintext password (save in your password manager)
# Updates: .env with new ADMIN_USERNAME, ADMIN_PASSWORD_HASH, DASHBOARD_SECRET
```

Then copy the three new values into `analytics_admin.js`'s `AA_FALLBACK_*`
constants and `git push`.

## Optional: switch to env-var-driven credentials

If you'd rather rotate credentials without rebuilding the image (DevOps does a
`kubectl patch secret`), set the same key names as cluster env vars and they
take precedence over the hardcoded constants. Both `satori_direct.sdResolve`
and `analytics_admin.aaEnv` read `ctx.env` first.

Steps for DevOps if you want to go this route:

```bash
SECRET_NAME=nakama-secrets   # ← whatever Secret the Deployment mounts
kubectl -n aicart patch secret "$SECRET_NAME" --type=merge -p "$(cat <<'EOF'
stringData:
  SATORI_URL: "https://quizverse-satori-dev-8bf5.us-east1-b.satoricloud.io"
  SATORI_API_KEY_NAME: "SATORIAPIKEY"
  SATORI_API_KEY: "<rotated key>"
  SATORI_SIGNING_KEY: "<rotated signing key>"
  SATORI_HTTP_TIMEOUT_MS: "2000"
  ADMIN_USERNAME: "ivx-admin"
  ADMIN_PASSWORD_HASH: "<bcrypt hash of new password>"
  DASHBOARD_SECRET: "<64 hex chars>"
EOF
)"
kubectl -n aicart rollout restart deployment/intelliverse-nakama
```

You also need to ensure the Deployment forwards these env vars to the JS
runtime. Look for `--runtime.env` in the container's `args` — if `ADMIN_USERNAME`,
`SATORI_URL`, etc. aren't listed, append them via a `kubectl patch deployment`.
The local `docker-compose.yml` `RUNTIME_ENV_KEYS` block is the canonical list of
what the JS modules expect.

## Architectural notes

### Why dual-write inside `persistNormalizedEvent` and not a separate cron?

A cron job would buffer events and replay them on a tick. That trades higher
end-to-end latency (event → Satori delay) for slightly lower request-time
latency. The current design publishes synchronously so live-ops can react in
real time (Satori experiments / flags), at the cost of adding up to
`SATORI_HTTP_TIMEOUT_MS` (2000 ms) to each `analytics_log_event` call. The
Unity client batches 20 events per call so the worst-case 2-second tail is
invisible to gameplay. If Satori has a sustained outage, the try/catch keeps
in-house analytics flowing.

### Why no-op the `satori_event` Unity RPCs?

Unity's `AnalyticsManager.Track()` triple-routes every event: Firebase +
`analytics_log_event` + `satori_event`. Forwarding both Nakama paths to Satori
would double every event in the cloud — inflated DAU charts and 2× billing.
The no-op shim acks the satori_event call without forwarding, so events take
exactly one path: `analytics_log_event` → `persistNormalizedEvent` → fan-out.
Identity properties and feature flags, which don't flow through events, ARE
forwarded by `satori_compat`.

### Why `satori_direct.js` instead of `nk.getSatori()`?

`nk.getSatori()` requires `--satori.url`, `--satori.api_key_name`, etc. CLI
flags. Nakama refuses to start if `--satori.url` is set without
`--satori.signing_key` (`server/config.go:1512` is a `logger.Fatal`). Those
flags must be added to the k8s Deployment manifest, which is owned by DevOps
and not in this repo. Every credential rotation, every config change, would
be a cross-team round-trip.

`satori_direct.js` skips that entirely. Credentials live in the JS bundle —
to rotate, edit the constants and ship an image. DevOps stays out of the loop.

The trade-off: anyone with read access to the ECR image (or the git history
of this repo) can extract the credentials. For a `dev` Satori project that's
acceptable. For `production` Satori, consider switching to the env-var path
in the appendix above so credentials live in a k8s Secret rather than the
image.

### Why is the modern dashboard overlay in `Dockerfile.production` and not just committed to `console/ui/dist/`?

`console/ui/dist/analytics.html` was generated by an older dashboard build and
contains different code. Replacing it in-place would conflict with whatever
process maintains that file. The Dockerfile overlay keeps both files
intact in the repo and applies the swap only at image-build time.
