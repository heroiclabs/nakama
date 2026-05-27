---
name: nakama-docker
description: Run, build, restart, and configure the Nakama Docker Compose stack for this project.
version: "1.0"
---

## When to Use
Keywords: `docker`, `compose`, `up`, `down`, `restart`, `build`, `logs`, `migrate`, `env`, `Dockerfile`, `container`, `plugin`, `cockroachdb`, `prometheus`

## Stack Architecture

```
docker-compose.yml
├── cockroachdb   → CockroachDB v24.1   ports: 26257, 8080
├── nakama        → ivx/nakama-analytics:3.35.0   ports: 7349, 7350, 7351, 9100
└── prometheus    → prom/prometheus   port: 9090
```

**Port map:**
| Port | Service | Purpose |
|------|---------|---------|
| 7349 | nakama | gRPC API |
| 7350 | nakama | HTTP API + WebSocket |
| 7351 | nakama | Console UI (admin:password) |
| 9100 | nakama | Prometheus metrics |
| 9090 | prometheus | Prometheus scrape UI |
| 26257 | cockroachdb | SQL |
| 8080 | cockroachdb | Admin UI |

## Essential Commands

```powershell
# Start the full stack
docker compose up -d

# Rebuild nakama image (after Dockerfile or Go plugin change)
docker compose build nakama
docker compose up -d --force-recreate nakama

# Restart nakama only (after data/modules/ JS change — volume-mounted)
docker compose restart nakama

# Stream logs
docker compose logs -f nakama
docker compose logs -f nakama --tail 100

# Stop everything
docker compose down

# Nuke DB (⚠ destroys all data)
docker compose down -v

# Run migrations manually
docker compose exec nakama /nakama/nakama migrate up --database.address root@cockroachdb:26257

# Open DB shell
docker compose exec cockroachdb ./cockroach sql --insecure
```

## Environment Variables

All env vars are declared in `docker-compose.yml` `environment:` block.
**CRITICAL**: Nakama's JS runtime only sees vars forwarded via `--runtime.env KEY=VALUE` CLI flags.
Setting a var in `environment:` alone does NOT make it available via `ctx.env['KEY']` in JS RPCs.

**To expose a new env var to JS RPCs:**
1. Add to `environment:` in `docker-compose.yml`
2. Add key name to `RUNTIME_ENV_KEYS` in the `entrypoint` block
3. Access in JS as `ctx.env['KEY_NAME']`

**Key env vars:**
| Variable | Purpose | Default |
|----------|---------|---------|
| `DEFAULT_GAME_ID` | QuizVerse game UUID | `126bf539-dae2-4bcf-964d-316c0fa1f92b` |
| `ANTHROPIC_API_KEY` | Claude LLM calls | — |
| `OPENAI_API_KEY` | GPT LLM calls | — |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` | Console auth | — |
| `DASHBOARD_SECRET` | Analytics admin auth | hardcoded fallback |
| `ROLLUP_ENABLED` | Analytics rollup feature flag | `true` |
| `NAKAMA_WEBHOOK_SECRET` | Incoming webhook HMAC | — |

**Local dev:** create `.env` in project root (gitignored), values auto-loaded by Compose:
```
ANTHROPIC_API_KEY=sk-ant-...
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<bcrypt hash>
```

## Dockerfile — Two-Stage Build

```
Stage 1 (builder): heroiclabs/nakama-pluginbuilder:3.35.0
  → builds analytics_metrics.so (Go plugin)

Stage 2 (final): heroiclabs/nakama:3.35.0
  → copies .so + all JS modules into /nakama/data/
```

**⚠ Plugin ABI rule:** Go plugin `.so` MUST be built against the exact same Nakama version (3.35.0).
Never mix plugin versions. If you see `plugin was built with a different version`, rebuild from scratch.

```powershell
# Full rebuild (use after Go plugin source changes):
docker compose build --no-cache nakama

# Dev fast path (plugin-only rebuild, no Docker):
./scripts/build-plugin.ps1
# → drops analytics_metrics.so into data/modules/ (picked up by volume mount)
```

## Volume Mount Behavior

```yaml
volumes:
  - ./:/nakama/data   # entire repo root → /nakama/data inside container
```

`data/modules/index.js` is volume-mounted live. After `npm run build` in `data/modules/`:
- **No restart needed** if only JS changed (nakama loads modules at startup, so restart IS needed)
- **`docker compose restart nakama`** to reload JS modules
- **Full `docker compose build`** only needed when Dockerfile, Go plugin source, or base image changes

## Healthchecks & Restart Policy

```yaml
# Both services use healthcheck + restart: unless-stopped
nakama healthcheck:
  test: ["/nakama/nakama", "healthcheck"]
  interval: 10s
  timeout: 5s
  retries: 5

cockroachdb healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/health?ready=1"]
  interval: 3s
  timeout: 3s
  retries: 5
```

Nakama only starts after cockroachdb is healthy (`depends_on: condition: service_healthy`).

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ctx.env['KEY'] is undefined` | var not in RUNTIME_ENV_KEYS | Add to entrypoint `RUNTIME_ENV_KEYS` list |
| `plugin was built with a different version` | .so ABI mismatch | `docker compose build --no-cache nakama` |
| `database connection refused` | cockroachdb not healthy yet | Wait for healthcheck; check `docker compose logs cockroachdb` |
| RPC changes not reflected | index.js not rebuilt | `cd data/modules && npm run build`, then `docker compose restart nakama` |
| `migrate: table already exists` | running migrate on initialized DB | Normal; migrate is idempotent, ignore |
| Port 7350 already in use | another nakama instance | `netstat -an | findstr 7350` then kill process |

## Prometheus Metrics

Nakama exposes metrics at `:9100/metrics`. Custom Go plugin adds analytics counters.
- Scrape target: `http://nakama:9100` (configured in `docker-compose.yml` prometheus section)
- Console: `http://localhost:9090` (Prometheus UI)
- Key metrics: `nakama_*` (native), `ivx_analytics_*` (custom plugin)

## Context Files (load only if needed)
- Compose config: `docker-compose.yml`
- Production image: `Dockerfile.production`
- Dev image: `Dockerfile`
- Env example: `.env.example`
- Plugin build script: `scripts/build-plugin.ps1`
