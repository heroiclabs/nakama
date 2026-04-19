# syntax=docker/dockerfile:1.6
#
# Custom Nakama image that ships a Go plugin exposing native Prometheus
# metrics for the analytics pipeline. The base binary is unchanged — this
# image is interchangeable with `heroiclabs/nakama:3.35.0`.
#
# Why: Nakama's JS (Goja) runtime can't register Prometheus counters directly.
# This Go plugin registers native counters/gauges with the default Prometheus
# registry that Nakama already serves at :9100, so the metrics show up in
# our existing Prometheus scrape target with zero extra wiring.
#
# Two usage modes:
#
#   1. Full image (prod / CI):
#        docker compose build nakama && docker compose up
#      Compose uses `build: .` — the Dockerfile bakes the plugin AND all
#      JS modules into the image.
#
#   2. Plugin-only rebuild (dev):
#        scripts/build-plugin.ps1   (or .sh)
#      The helper runs the builder stage and copies `analytics_metrics.so`
#      to host `data/modules/`, so the volume-mounted compose stack picks
#      it up without rebuilding the full image.
#
# Plugin / runtime version MUST match. Nakama Go plugins are ABI-coupled to
# the exact runtime version; both stages use the 3.35.0 tag.

# ─── Stage 1 : build the Go plugin ─────────────────────────
FROM heroiclabs/nakama-pluginbuilder:3.35.0 AS builder

WORKDIR /build

# Copy the plugin source files. The dev compose stack uses the prebuilt
# heroiclabs/nakama:3.35.0 server image which is ABI-coupled to
# nakama-common v1.44.0, so we materialise a one-off go.mod here pinning
# that exact version (and pull every transitive dep from the proxy via
# `go mod tidy`). Production uses a different path — the same source
# files are picked up automatically by Dockerfile.production stage 3
# (`for dir in data/modules/*/`) and built against the parent module's
# vendor tree, which guarantees ABI parity with the from-source server.
COPY data/modules/analytics_metrics/*.go ./
RUN cat > go.mod <<'EOF'
module github.com/ivx/nakama-analytics-metrics

// Pinned to v1.44.0 because the dev compose server is heroiclabs/nakama:3.35.0
// which ships v1.44.0. Bump in lockstep with the pluginbuilder tag above.
go 1.25

require (
    github.com/heroiclabs/nakama-common v1.44.0
    github.com/prometheus/client_golang v1.20.5
)
EOF
RUN go mod tidy

# --trimpath        : reproducible builds, strips local paths
# --buildmode=plugin: produces a .so Nakama can load at startup
# CGO is required for Go plugins; nakama-pluginbuilder ships the toolchain.
RUN CGO_ENABLED=1 go build \
    --trimpath \
    --buildmode=plugin \
    -o /build/analytics_metrics.so \
    .

# Sanity: fail the build early if the .so wasn't produced. Prevents a silent
# "plugin missing at runtime" failure mode where Nakama boots without the plugin
# and we only notice because /metrics is empty.
RUN test -s /build/analytics_metrics.so || (echo "Plugin build produced no output" && exit 1)

# ─── Stage 2 : rebuild the JS runtime bundle ───────────────
#
# Every .js file under data/modules/ subfolders (analytics_admin, analytics,
# analytics_rollup, …) must be merged into data/modules/index.js by
# postbuild.js before Nakama can see it — Nakama's JS runtime only evaluates
# the top-level .js files and the AST walker only picks up registerRpc calls
# that live directly in InitModule's body. Without this stage, a developer
# who adds a new module but forgets to run `node postbuild.js` locally ships
# a stale bundle and every call to the new RPC returns HTTP 500
# ("function not found").
#
# postbuild.js has zero external deps — only Node builtins (fs, path) — so
# the minimal `node:20-alpine` image is all we need. Runs in ~1s.
FROM node:20-alpine AS jsbuilder

WORKDIR /data-modules
COPY data/modules /data-modules/

# postbuild.js expects build/index.js (TypeScript compile output) to already
# exist. That file is committed so this stage doesn't need `tsc`.
RUN test -s build/index.js || (echo "build/index.js missing — run 'npm run build' in data/modules before docker build" && exit 1)
RUN node postbuild.js
RUN node -c index.js || (echo "Regenerated index.js failed syntax check" && exit 1)

# ─── Stage 3 : assemble the runtime image ──────────────────
FROM registry.heroiclabs.com/heroiclabs/nakama:3.35.0

# Drop the built plugin into the runtime modules directory. Nakama discovers
# and loads all .so files from this directory automatically alongside JS
# modules.
COPY --from=builder /build/analytics_metrics.so /nakama/data/modules/analytics_metrics.so

# For full-image mode, also bake the JS modules + runtime so the image is
# self-contained without a host volume mount. The compose dev stack still
# mounts `./:/nakama/data` on top, which is fine — the mount shadows this
# COPY in dev and we rely on scripts/build-plugin to get the .so onto host.
COPY data /nakama/data

# Overlay the freshly regenerated bundle on top of whatever `COPY data`
# brought in, so Nakama boots with every subfolder module merged in —
# regardless of whether the committed data/modules/index.js is current.
COPY --from=jsbuilder /data-modules/index.js /nakama/data/data/modules/index.js

# Upstream entrypoint/cmd intact — docker-compose.yml overrides the entrypoint
# to inject --runtime.env flags, so nothing else changes.
