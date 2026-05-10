# Nakama Analytics + Satori — DevOps Runbook

**Audience:** engineer with `kubectl` access to `ai-cart-auto-cluster` /
namespace `aicart`.

**Status (2026-05-10, v2):** **No infra changes are required for the analytics
fix.** The Satori credentials, admin login, and dashboard secret are all
hardcoded into the JS runtime bundle as of the latest commit. Once the
`intelliverse-nakama` image rolls out via CodeBuild, both dashboards work.

This runbook now covers two things:

1. [Standard rollout monitoring](#1-standard-rollout-monitoring) — what to watch when the next image lands.
2. [Optional cluster patch](#2-optional-switch-to-env-driven-credentials) — for future-you if you ever want credentials to live in a k8s Secret instead of the image (rotation without rebuilds).

If everything is green, stop after section 1.

---

## 1. Standard rollout monitoring

The application code changed; nothing in the cluster has to. The pipeline is
the usual `git push origin main` → CodeBuild → `kubectl set image`.

```bash
aws eks update-kubeconfig --region us-east-1 --name ai-cart-auto-cluster

# Watch the rollout (CodeBuild has already kicked it off).
kubectl -n aicart rollout status deployment/intelliverse-nakama --timeout=5m

# Watch startup logs for the new modules to register.
kubectl -n aicart logs -f deployment/intelliverse-nakama \
  | rg -i 'satori_direct|satori_compat|analytics_backfill|admin'
```

**Pass criteria** — all three lines must appear within 30 s of the new pod
becoming Ready:

```
[satori_direct]      module loaded — RPC satori_diag registered, base url=https://quizverse-satori-dev-8bf5...
[satori_compat]      module loaded — 5 RPCs registered
[analytics_backfill] module loaded — RPC analytics_backfill_dual registered
```

**Smoke test from outside the cluster:**

```bash
# 1. Health
curl -fsS https://nakama.intelli-verse-x.ai/healthcheck

# 2. Satori connectivity (publishes one event, returns the HTTP code).
curl -s -X POST \
  "https://nakama-rest.intelli-verse-x.ai/v2/rpc/satori_diag?http_key=defaultkey" \
  -H 'Content-Type: application/json' -d '{"payload":"{}"}' \
  | jq '.payload | fromjson'
# Expected: { success: true, code: 200, ... }

# 3. Dashboard
open https://nakama.intelli-verse-x.ai/analytics.html
# Login with credentials shared by the requester (out-of-band).
# Should render with charts populated by analytics_log_event traffic.
```

If `satori_diag` returns `code: 200` and `analytics.html` accepts the login,
the deploy is done.

### Rollback (only if needed)

```bash
# Roll back to the previous ReplicaSet.
kubectl -n aicart rollout undo deployment/intelliverse-nakama
kubectl -n aicart rollout status deployment/intelliverse-nakama --timeout=5m
```

The previous image still works for everything except Satori (it has no
`satori_direct` module) and the broken dashboard (which was already broken
before the change). Rolling back puts you back to that state — no data loss.

---

## 2. Optional: switch to env-driven credentials

**Skip this entire section unless** you specifically want to rotate Satori
credentials without rebuilding the Nakama image, or you want admin/dashboard
credentials to live in a k8s Secret rather than embedded in source.

When the cluster supplies these env vars, the JS code reads them and skips its
hardcoded fallbacks. So you can ramp up cluster-side without any code change —
just patch the Secret + Deployment, restart pods, and the new values take
effect immediately.

### 2.1 Discover the env-var injection pattern

```bash
kubectl -n aicart get deployment intelliverse-nakama -o yaml \
  | yq '.spec.template.spec.containers[0] | {env: .env, envFrom: .envFrom, args: .args}'
```

You'll see one of two patterns:

- **Pattern A** — inline `env:` array, each item has `valueFrom: secretKeyRef:`. Adding a new var = appending an `env:` entry.
- **Pattern B** — `envFrom: - secretRef: { name: <secret> }`. Adding a new var = adding the key to that Secret. No Deployment patch needed.

```bash
# Find the Secret name(s) Nakama mounts.
kubectl -n aicart get secrets | rg -i 'nakama|intelliverse|satori|admin'
```

The rest of this section assumes the Secret is `nakama-secrets` — substitute the real one.

### 2.2 Patch the Secret with all 8 keys

Get the actual values from `data/modules/satori_direct/satori_direct.js`
(constants `SD_URL` / `SD_API_KEY_NAME` / `SD_API_KEY` / `SD_SIGNING_KEY`) and
`data/modules/analytics_admin/analytics_admin.js` (constants `AA_FALLBACK_*`).
Or rotate them while you're at it — once the Secret is the source of truth,
the hardcoded constants don't matter.

```bash
SECRET_NAME=nakama-secrets
kubectl -n aicart patch secret "$SECRET_NAME" --type=merge -p "$(cat <<'EOF'
stringData:
  SATORI_URL: "https://quizverse-satori-dev-8bf5.us-east1-b.satoricloud.io"
  SATORI_API_KEY_NAME: "SATORIAPIKEY"
  SATORI_API_KEY: "<from satori_direct.js or rotated>"
  SATORI_SIGNING_KEY: "<from satori_direct.js or rotated>"
  SATORI_HTTP_TIMEOUT_MS: "2000"
  ADMIN_USERNAME: "ivx-admin"
  ADMIN_PASSWORD_HASH: "<from analytics_admin.js or rotated bcrypt hash>"
  DASHBOARD_SECRET: "<from analytics_admin.js or rotated 64 hex chars>"
EOF
)"

# Verify the keys exist (without dumping values).
kubectl -n aicart get secret "$SECRET_NAME" -o json \
  | jq -r '.data | keys[]' | rg -i 'SATORI|ADMIN|DASHBOARD'
```

### 2.3 Pattern A only: add inline env stanzas

(Skip if you're on Pattern B — `envFrom: secretRef` already imports them all.)

```bash
kubectl -n aicart patch deployment intelliverse-nakama --type=json -p "$(cat <<'EOF'
[
  {"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"SATORI_URL","valueFrom":{"secretKeyRef":{"name":"nakama-secrets","key":"SATORI_URL"}}}},
  {"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"SATORI_API_KEY_NAME","valueFrom":{"secretKeyRef":{"name":"nakama-secrets","key":"SATORI_API_KEY_NAME"}}}},
  {"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"SATORI_API_KEY","valueFrom":{"secretKeyRef":{"name":"nakama-secrets","key":"SATORI_API_KEY"}}}},
  {"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"SATORI_SIGNING_KEY","valueFrom":{"secretKeyRef":{"name":"nakama-secrets","key":"SATORI_SIGNING_KEY"}}}},
  {"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"SATORI_HTTP_TIMEOUT_MS","valueFrom":{"secretKeyRef":{"name":"nakama-secrets","key":"SATORI_HTTP_TIMEOUT_MS"}}}},
  {"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"ADMIN_USERNAME","valueFrom":{"secretKeyRef":{"name":"nakama-secrets","key":"ADMIN_USERNAME"}}}},
  {"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"ADMIN_PASSWORD_HASH","valueFrom":{"secretKeyRef":{"name":"nakama-secrets","key":"ADMIN_PASSWORD_HASH"}}}},
  {"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"DASHBOARD_SECRET","valueFrom":{"secretKeyRef":{"name":"nakama-secrets","key":"DASHBOARD_SECRET"}}}}
]
EOF
)"
```

### 2.4 Ensure the JS runtime sees the env vars

Nakama only forwards env vars to the JS runtime when they're listed in
`--runtime.env <KEY>` flags on the container. Check the current `args:`:

```bash
kubectl -n aicart get deployment intelliverse-nakama \
  -o jsonpath='{.spec.template.spec.containers[0].args}' | tr ',' '\n' | rg runtime.env
```

If `SATORI_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `DASHBOARD_SECRET`,
etc. aren't listed, append them:

```bash
kubectl -n aicart patch deployment intelliverse-nakama --type=json -p '[
  {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--runtime.env"},{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"SATORI_URL=$(SATORI_URL)"},
  {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--runtime.env"},{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"SATORI_API_KEY_NAME=$(SATORI_API_KEY_NAME)"},
  {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--runtime.env"},{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"SATORI_API_KEY=$(SATORI_API_KEY)"},
  {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--runtime.env"},{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"SATORI_SIGNING_KEY=$(SATORI_SIGNING_KEY)"},
  {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--runtime.env"},{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"SATORI_HTTP_TIMEOUT_MS=$(SATORI_HTTP_TIMEOUT_MS)"},
  {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--runtime.env"},{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"ADMIN_USERNAME=$(ADMIN_USERNAME)"},
  {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--runtime.env"},{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"ADMIN_PASSWORD_HASH=$(ADMIN_PASSWORD_HASH)"},
  {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--runtime.env"},{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"DASHBOARD_SECRET=$(DASHBOARD_SECRET)"}
]'
```

> **Do NOT** add `--satori.url` / `--satori.api_key` / `--satori.signing_key`
> CLI flags. The current code does NOT use `nk.getSatori()` — those flags are
> ignored, and adding all four with mismatched values would cause Nakama to
> fatal at startup (`server/config.go:1512`). Stick to `--runtime.env`.

### 2.5 Restart and verify

```bash
kubectl -n aicart rollout restart deployment/intelliverse-nakama
kubectl -n aicart rollout status deployment/intelliverse-nakama --timeout=5m

# Verify env-driven credentials override the hardcoded fallbacks:
curl -s -X POST \
  "https://nakama-rest.intelli-verse-x.ai/v2/rpc/satori_diag?http_key=defaultkey" \
  -H 'Content-Type: application/json' -d '{"payload":"{}"}' \
  | jq '.payload | fromjson'
# Expected: { success: true, code: 200, api_key_name: "SATORIAPIKEY", api_key_present: true, signing_key_present: true }
# If you rotated the API key in 2.2, that rotation is now live without an image rebuild.
```

### Rollback for section 2

```bash
# Removes the env vars from the Deployment but leaves the Secret in place
# (harmless — unused Secret keys cost nothing).
kubectl -n aicart rollout undo deployment/intelliverse-nakama
```

The hardcoded fallbacks in the image take over and analytics keep working.

---

## Reference: code locations for the credentials

| Credential               | Hardcoded constant in source                                  |
|--------------------------|---------------------------------------------------------------|
| `SATORI_URL`             | `data/modules/satori_direct/satori_direct.js` → `SD_URL`      |
| `SATORI_API_KEY_NAME`    | `data/modules/satori_direct/satori_direct.js` → `SD_API_KEY_NAME` |
| `SATORI_API_KEY`         | `data/modules/satori_direct/satori_direct.js` → `SD_API_KEY`  |
| `SATORI_SIGNING_KEY`     | `data/modules/satori_direct/satori_direct.js` → `SD_SIGNING_KEY` |
| `SATORI_HTTP_TIMEOUT_MS` | `data/modules/satori_direct/satori_direct.js` → `SD_TIMEOUT_MS` |
| `ADMIN_USERNAME`         | `data/modules/analytics_admin/analytics_admin.js` → `AA_FALLBACK_ADMIN_USERNAME` |
| `ADMIN_PASSWORD_HASH`    | `data/modules/analytics_admin/analytics_admin.js` → `AA_FALLBACK_ADMIN_PASSWORD_HASH` |
| `DASHBOARD_SECRET`       | `data/modules/analytics_admin/analytics_admin.js` → `AA_FALLBACK_DASHBOARD_SECRET` |

If you set the same key as a cluster env var, the env value wins.
