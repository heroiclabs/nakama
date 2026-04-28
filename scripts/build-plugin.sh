#!/usr/bin/env bash
# build-plugin.sh — POSIX sibling of build-plugin.ps1.
# Builds the Go plugins and drops them into data/modules/ so the dev
# docker-compose stack picks them up via the volume mount.
#
# Plugins:
#   - analytics_metrics.so : Prometheus exporter
#   - realtime_tick.so     : RealtimeTickMatch (10–30Hz Go match handler)
#
# Usage (from nakama/ root):
#   ./scripts/build-plugin.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[build-plugin] Building Go plugins from $REPO_ROOT/data/modules/..."

BUILD_TAG="nakama-plugin-builder:local"
docker build \
    --target builder \
    --tag "$BUILD_TAG" \
    --file Dockerfile \
    .

TMP_CONTAINER="nakama-plugin-builder-extract-$RANDOM"
trap 'docker rm -f "$TMP_CONTAINER" >/dev/null 2>&1 || true' EXIT

docker create --name "$TMP_CONTAINER" "$BUILD_TAG" >/dev/null

DEST_DIR="$REPO_ROOT/data/modules"
mkdir -p "$DEST_DIR"

for plugin in analytics_metrics realtime_tick; do
    DEST_PATH="$DEST_DIR/$plugin.so"
    docker cp "$TMP_CONTAINER:/build/$plugin.so" "$DEST_PATH"
    echo "[build-plugin] ✓ $plugin.so → $DEST_PATH"
done

echo "[build-plugin] Restart Nakama to load the new plugins:"
echo "    docker compose restart nakama"
