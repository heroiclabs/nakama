#!/usr/bin/env bash
# build-plugin.sh — POSIX sibling of build-plugin.ps1.
# Builds the Go plugin and drops analytics_metrics.so into data/modules/
# so the dev docker-compose stack picks it up via the volume mount.
#
# Usage (from nakama/ root):
#   ./scripts/build-plugin.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[build-plugin] Building analytics_metrics.so from $REPO_ROOT/go-plugin/..."

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
DEST_PATH="$DEST_DIR/analytics_metrics.so"
mkdir -p "$DEST_DIR"

docker cp "$TMP_CONTAINER:/build/analytics_metrics.so" "$DEST_PATH"

echo "[build-plugin] ✓ Plugin written to $DEST_PATH"
echo "[build-plugin] Restart Nakama to load the new plugin:"
echo "    docker compose restart nakama"
