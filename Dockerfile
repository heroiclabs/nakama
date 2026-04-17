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

# Copy go.mod AND the source files together before running `go mod tidy`.
#
# Why not copy go.mod alone first (for layer caching)? `go mod tidy` run in a
# directory with a go.mod but zero .go files interprets "nothing imports
# anything" literally and PRUNES every require line out of go.mod — you can
# see this in the AWS CodeBuild log as: `go: warning: "all" matched no
# packages`. The later `go build` then fails with
# `no required module provides package github.com/heroiclabs/nakama-common/runtime`.
# Local builds masked this because Docker's layer cache kept the old go.mod;
# `docker build --no-cache` (CI) exposed it.
#
# We intentionally don't commit a go.sum — `go mod tidy` regenerates it using
# the toolchain inside the pluginbuilder image, which guarantees the versions
# match what the Nakama plugin ABI expects. A committed go.sum would need to
# be regenerated with every nakama-common bump anyway.
COPY go-plugin/go.mod ./
COPY go-plugin/*.go ./
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

# ─── Stage 2 : assemble the runtime image ──────────────────
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

# Upstream entrypoint/cmd intact — docker-compose.yml overrides the entrypoint
# to inject --runtime.env flags, so nothing else changes.
