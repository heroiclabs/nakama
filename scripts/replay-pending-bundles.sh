#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# Manual replay of the InsightsAggregator DLQ (game_pending_bundles_dlq).
#
# Triggered by an on-call operator after a `:warning: DLQ-letter` Discord
# alert (qv-ops channel) when they don't want to wait until the next
# scheduled InsightsAggregator tick (every ~3h via AnalyticsAlerts) for
# the auto-drain path to recover.
#
# After the qv-insights-loop_2026-04-28 fix, the aggregator tick now
# auto-drains the DLQ on every run, so manual replay is rarely needed.
# This script exists for two cases:
#   1. The AI svc has been down for >1h and operators want to flush the
#      backlog as soon as it's healthy (don't wait for the next tick).
#   2. A bundle has been moved to `dead_bundles` after MAX_ATTEMPTS=8
#      and an engineer has fixed the root cause and wants to replay it
#      once before declaring it formally dropped.
#
# Auth: hits the Nakama HTTP RPC surface as the system user, gated by
# the Nakama HTTP key (read from k8s secret `nakama-secret`/`http_key`).
# That maps to the `(typeof ctx.userId === "string" && ctx.userId !== "")`
# guard inside `pending_bundles_drain` (see PendingBundles.rpcAdminDrain).
#
# Usage:
#   ./scripts/replay-pending-bundles.sh           # default — kube cluster
#   NAMESPACE=aicart ./scripts/replay-pending-bundles.sh
#   NAKAMA_HOST=https://nakama.intelliverse.app ./scripts/replay-pending-bundles.sh
# ──────────────────────────────────────────────────────────────────────────
set -eu

NAMESPACE="${NAMESPACE:-aicart}"
DEPLOYMENT="${DEPLOYMENT:-intelliverse-nakama}"
NAKAMA_HOST="${NAKAMA_HOST:-}"

fail() {
    echo "✗ $*" >&2
    exit 1
}
ok() { echo "✓ $*"; }
info() { echo "→ $*"; }

# Resolve Nakama HTTP key (server-to-server auth). Prefer env var when
# set so this script works outside a kube context (e.g. against a port-
# forwarded Nakama in dev). Otherwise pull from the k8s secret.
if [ -n "${NAKAMA_HTTP_KEY:-}" ]; then
    HTTP_KEY="$NAKAMA_HTTP_KEY"
    info "Using NAKAMA_HTTP_KEY from env"
else
    command -v kubectl >/dev/null 2>&1 || \
        fail "kubectl not found and NAKAMA_HTTP_KEY env var unset"
    HTTP_KEY=$(kubectl -n "$NAMESPACE" get secret nakama-secret \
        -o jsonpath='{.data.http_key}' 2>/dev/null | base64 -d || true)
    [ -n "$HTTP_KEY" ] || fail "could not read http_key from secret/nakama-secret in $NAMESPACE"
    ok "Resolved nakama HTTP key from secret/nakama-secret"
fi

# When no host is provided, exec the curl inside a Nakama pod so we
# don't need an Ingress route to /v2/rpc/.
if [ -z "$NAKAMA_HOST" ]; then
    POD=$(kubectl -n "$NAMESPACE" get pod \
        -l "app=$DEPLOYMENT" \
        -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
    [ -n "$POD" ] || fail "no $DEPLOYMENT pod found in $NAMESPACE"
    info "Replaying via pod $POD (intra-cluster localhost:7350)"
    OUT=$(kubectl -n "$NAMESPACE" exec "$POD" -- \
        curl -sS -X POST \
            -H "Content-Type: application/json" \
            "http://127.0.0.1:7350/v2/rpc/pending_bundles_drain?http_key=$HTTP_KEY" \
            -d '""')
else
    info "Replaying via $NAKAMA_HOST"
    OUT=$(curl -sS -X POST \
        -H "Content-Type: application/json" \
        "$NAKAMA_HOST/v2/rpc/pending_bundles_drain?http_key=$HTTP_KEY" \
        -d '""')
fi

# Nakama wraps RPC responses as `{"payload":"<stringified-json>"}`.
# Unwrap once so the operator sees the real `{drained,deadLetters}` shape.
PAYLOAD=$(echo "$OUT" | python3 -c \
    'import json,sys; d=json.load(sys.stdin); print(d.get("payload",""))' 2>/dev/null || echo "$OUT")
echo
echo "─── pending_bundles_drain result ──────────────────────────"
echo "$PAYLOAD"
echo "──────────────────────────────────────────────────────────"

# Best-effort: parse drained/deadLetters and exit non-zero if a real
# DLQ failure occurred so a CI / cron caller can detect "we replayed
# but some bundles still couldn't be delivered".
DEAD=$(echo "$PAYLOAD" | python3 -c \
    'import json,sys
try:
    p=json.loads(sys.stdin.read())
    d=p.get("data",{})
    print(int(d.get("deadLetters",0) or 0))
except Exception:
    print(0)' 2>/dev/null || echo 0)

if [ "${DEAD:-0}" != "0" ]; then
    echo "⚠ ${DEAD} bundle(s) moved to dead_bundles — investigate root cause" >&2
    exit 2
fi
ok "DLQ drain complete"
