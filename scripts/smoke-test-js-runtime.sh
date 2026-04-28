#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# Smoke-test: did the Nakama JavaScript runtime actually load?
#
# This is the gate that would have caught the cbeacf6 outage at build time
# instead of in production. It can be invoked in two modes:
#
#   1. Image mode (CI / local sanity):
#        ./scripts/smoke-test-js-runtime.sh image <ECR_IMAGE_URI>
#      Boots the just-built image with an in-memory SQLite via Nakama's
#      stock --database flag pointing at a throwaway cockroachdb sidecar
#      Docker container, waits for /healthcheck, then asserts that:
#        a) the boot logs do NOT contain "Could not compile JavaScript module"
#        b) the boot logs do NOT contain "Failed to load JavaScript files"
#        c) `POST /v2/rpc/nakama_js_health` returns HTTP 200 with ok:true
#        d) `GET /v2/rpc/wallet_get_all` returns 401 / 200 (i.e. RPC
#           exists), NOT 404 "rpc id not found"
#
#   2. Cluster mode (deploy gate, used by buildspec.yml after
#      `kubectl set image`):
#        ./scripts/smoke-test-js-runtime.sh cluster <namespace> <deployment>
#      Waits for rollout, then runs (a)-(d) against an exec'd curl inside
#      a freshly-rolled pod (so we don't need an Ingress).
#
# Exit codes:
#   0 — JS runtime healthy.
#   1 — failed any assertion above. The buildspec uses this to trigger
#       `kubectl rollout undo` (EKS-2).
# ──────────────────────────────────────────────────────────────────────────
set -eu

MODE="${1:-}"

fail() {
    echo "✗ smoke-test FAILED: $*" >&2
    exit 1
}
ok() { echo "✓ $*"; }

assert_logs_clean() {
    local LOGS="$1"
    if echo "$LOGS" | grep -qF "Could not compile JavaScript module"; then
        fail "boot logs contain 'Could not compile JavaScript module' — JS bundle is broken"
    fi
    if echo "$LOGS" | grep -qF "Failed to load JavaScript files"; then
        fail "boot logs contain 'Failed to load JavaScript files' — JS runtime did not start"
    fi
    if echo "$LOGS" | grep -qF '"Found runtime modules","count":1'; then
        # Only the Go plugin loaded — JS bundle silently dropped.
        fail "boot logs show only 1 runtime module loaded (Go plugin only) — no JS modules registered"
    fi
    ok "boot logs free of JS-runtime compilation errors"
}

assert_health_rpc() {
    local URL="$1"
    local KEY="${2:-defaultkey}"
    local BODY
    # IMPORTANT: Nakama's HTTP RPC API expects the body to be a JSON-encoded
    # *string* (the RPC's `payload` parameter), not a JSON object. Sending
    # `{}` returns:
    #   {"error":"json: cannot unmarshal object into Go value of type string"}
    # which is what triggered a spurious auto-rollback in CodeBuild #193.
    # We send `""` (a JSON-encoded empty string) which Nakama unmarshals to
    # an empty payload string — which our nakama_js_health handler ignores.
    BODY=$(curl -fsS -X POST -H "Content-Type: application/json" \
                "${URL}/v2/rpc/nakama_js_health?http_key=${KEY}" \
                -d '""' 2>&1) || fail "nakama_js_health RPC returned non-200: $BODY"
    # Nakama wraps RPC return as {"payload":"<our-json-string-escaped>"}.
    # Our handler returns JSON-stringified {ok:true,...}, so in the wire
    # response the `ok:true` text is escaped → `\"ok\":true`. Match either.
    if ! echo "$BODY" | grep -qE '"ok":true|\\"ok\\":true'; then
        fail "nakama_js_health response missing ok:true — got: $BODY"
    fi
    ok "nakama_js_health RPC returned ok:true"
    echo "  body: $BODY"
}

assert_known_rpc_registered() {
    local URL="$1"
    local KEY="${2:-defaultkey}"
    local RPC_ID="${3:-wallet_get_all}"
    # Hit the RPC unauthenticated. Expected response:
    #   • 401 Unauthorized       → RPC exists but needs a session token (PASS)
    #   • 400 Bad Request        → RPC exists but rejected our payload (PASS)
    #   • 200 OK                 → RPC exists and ran (PASS)
    #   • 404 Not Found          → "rpc id not found" — JS bundle didn't register it (FAIL)
    # Same JSON-string body convention as above.
    local CODE
    CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
                -H "Content-Type: application/json" \
                "${URL}/v2/rpc/${RPC_ID}?http_key=${KEY}" -d '""' 2>&1) || true
    case "$CODE" in
        404) fail "$RPC_ID returned 404 — RPC not registered (JS bundle didn't load)" ;;
        200|400|401|403) ok "$RPC_ID is registered (HTTP $CODE)" ;;
        *)   echo "  ⚠ $RPC_ID unexpected HTTP $CODE — treating as registered" ;;
    esac
}

# ──────────────────────────────────────────────────────────────────────────
case "$MODE" in
    image)
        IMAGE="${2:?Usage: $0 image <docker-image-ref>}"
        echo "[smoke] Booting $IMAGE in throwaway compose stack…"
        STACK_DIR=$(mktemp -d)
        # Use postgres rather than cockroachdb because:
        #   (a) cockroachdb/cockroach:latest-v24.1 has no `curl`, so the
        #       depends_on healthcheck timed out in CodeBuild #193.
        #   (b) postgres:14-alpine ships pg_isready out of the box and is
        #       1/8th the size — faster CI.
        # Nakama supports both transparently; the only change is the
        # connection string format.
        cat > "$STACK_DIR/docker-compose.yml" <<EOF
services:
  postgres:
    # Pull from AWS public ECR mirror, not Docker Hub. CodeBuild hits
    # Docker Hub anonymously and trips the 100-pulls/6h rate limit
    # (build #195: "toomanyrequests: You have reached your unauthenticated
    # pull rate limit"). Same reason Dockerfile.production already uses
    # public.ecr.aws/docker/library/{node,debian,golang}.
    image: public.ecr.aws/docker/library/postgres:14-alpine
    environment:
      POSTGRES_USER: nakama
      POSTGRES_PASSWORD: nakama
      POSTGRES_DB: nakama
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nakama -d nakama"]
      interval: 2s
      retries: 30
  nakama:
    image: ${IMAGE}
    depends_on:
      postgres:
        condition: service_healthy
    entrypoint: ["/bin/sh","-ecx"]
    command:
      - |
        /nakama/nakama migrate up --database.address nakama:nakama@postgres:5432/nakama
        exec /nakama/nakama --database.address nakama:nakama@postgres:5432/nakama \
             --logger.level INFO \
             --runtime.path /nakama/data/modules \
             --runtime.http_key defaultkey
        # ↑ http_key is pinned to "defaultkey" because Nakama's actual
        # built-in default is "defaulthttpkey" (see Nakama source
        # server/runtime.go RuntimeConfigDefault). The smoke-test
        # asserts with KEY="defaultkey", so without this flag every
        # nakama_js_health POST returns HTTP 401 (CodeBuild #197).
    ports:
      - "57350:7350"
    healthcheck:
      test: ["CMD", "/nakama/nakama", "healthcheck"]
      interval: 5s
      retries: 30
EOF
        ( cd "$STACK_DIR" && docker compose up -d )
        trap '( cd "$STACK_DIR" && docker compose down -v ) >/dev/null 2>&1; rm -rf "$STACK_DIR"' EXIT

        echo "[smoke] Waiting for Nakama healthcheck…"
        for i in $(seq 1 60); do
            STATUS=$(docker inspect --format '{{.State.Health.Status}}' "$(cd "$STACK_DIR" && docker compose ps -q nakama)" 2>/dev/null || echo "?")
            [ "$STATUS" = "healthy" ] && break
            sleep 2
        done
        [ "$STATUS" = "healthy" ] || fail "Nakama never became healthy (status=$STATUS)"

        # Give the JS runtime a moment after the Go healthcheck turns green.
        # Nakama's /healthcheck (port 7349) responds as soon as the HTTP server
        # is up, but Goja (the JS engine) still needs a few seconds to finish
        # executing InitModule for large bundles (600+ RPCs). Without this sleep
        # the nakama_js_health probe lands too early and gets HTTP 404 even
        # though the runtime is healthy — a false-negative that aborts the build.
        # The cluster mode already has an equivalent sleep 5; mirror it here.
        echo "[smoke] Waiting 10 s for JS runtime InitModule to complete…"
        sleep 10

        LOGS=$( cd "$STACK_DIR" && docker compose logs nakama 2>&1 )
        assert_logs_clean "$LOGS"
        assert_health_rpc "http://127.0.0.1:57350" "defaultkey"
        assert_known_rpc_registered "http://127.0.0.1:57350" "defaultkey" "wallet_get_all"
        echo
        ok "image $IMAGE: JS runtime healthy"
        ;;

    cluster)
        NS="${2:?Usage: $0 cluster <namespace> <deployment>}"
        DEPLOY="${3:?Usage: $0 cluster <namespace> <deployment>}"
        echo "[smoke] Waiting for rollout of $DEPLOY in $NS…"
        kubectl rollout status "deployment/$DEPLOY" -n "$NS" --timeout=10m

        # Pick the newest pod (post-rollout).
        POD=$(kubectl get pods -n "$NS" -l "app=$DEPLOY" \
              --sort-by='.metadata.creationTimestamp' \
              -o jsonpath='{.items[-1:].metadata.name}')
        [ -n "$POD" ] || fail "could not find any pod for app=$DEPLOY in $NS"
        echo "[smoke] using pod $POD"

        # Give the JS runtime a moment after Ready (Goja init can take a few seconds).
        sleep 5

        LOGS=$(kubectl logs -n "$NS" "$POD" --tail=300)
        assert_logs_clean "$LOGS"

        # Resolve http_key from the in-cluster config secret.
        HTTP_KEY=$(kubectl get secret -n "$NS" nakama-secret \
                    -o jsonpath='{.data.config\.yaml}' 2>/dev/null \
                    | base64 -d 2>/dev/null \
                    | awk '/^[[:space:]]+http_key:/ {gsub(/"/,"",$2); print $2; exit}')
        [ -n "$HTTP_KEY" ] || HTTP_KEY="defaultkey"

        # Exec a curl inside the pod (no Ingress, no port-forward).
        # NOTE: payload is a JSON-encoded empty string (`""`), not an empty
        # object (`{}`). Nakama's HTTP RPC handler unmarshals the request body
        # into a Go *string*; passing `{}` returns HTTP 400
        # "json: cannot unmarshal object into Go value of type string"
        # which would trigger a spurious auto-rollback (CodeBuild #193).
        kubectl exec -n "$NS" "$POD" -- /bin/sh -c "
            set -eu
            CODE=\$(curl -s -o /tmp/h.json -w '%{http_code}' -X POST \
                  -H 'Content-Type: application/json' \
                  'http://127.0.0.1:7350/v2/rpc/nakama_js_health?http_key=${HTTP_KEY}' -d '\"\"')
            if [ \"\$CODE\" != '200' ]; then
                echo '✗ nakama_js_health returned HTTP '\"\$CODE\"
                cat /tmp/h.json
                exit 1
            fi
            # Nakama wraps the RPC payload as {\"payload\":\"<json-string>\"},
            # so the inner JSON's quotes are escaped on the wire — the file
            # literally contains the bytes:  \\\"ok\\\":true
            # (backslash, quote, o, k, backslash, quote, colon, t, r, u, e).
            # Match either the wire-escaped form or the unescaped form
            # (in case a future Nakama version returns the object directly).
            # Build #198 failed because the previous pattern only matched the
            # unescaped form.
            if ! grep -qE '\\\\\"ok\\\\\":[[:space:]]*true|\"ok\":[[:space:]]*true' /tmp/h.json; then
                echo '✗ ok:true missing in nakama_js_health response'
                cat /tmp/h.json
                exit 1
            fi
            echo '✓ nakama_js_health ok inside pod'
            cat /tmp/h.json
        " || fail "in-pod nakama_js_health probe failed"

        kubectl exec -n "$NS" "$POD" -- /bin/sh -c "
            # Same JSON-encoded-string body convention as nakama_js_health.
            # Sending '{}' to wallet_get_all returns HTTP 400 with
            # 'json: cannot unmarshal object into Go value of type string'
            # which is technically also fine for this probe (anything but
            # 404 means the RPC is registered) — but the mixed convention
            # was confusing in the previous build's logs.
            CODE=\$(curl -s -o /dev/null -w '%{http_code}' -X POST \
                  -H 'Content-Type: application/json' \
                  'http://127.0.0.1:7350/v2/rpc/wallet_get_all' -d '\"\"')
            case \"\$CODE\" in
                404) echo '✗ wallet_get_all 404 — bundle not loaded'; exit 1 ;;
                *) echo '✓ wallet_get_all registered (HTTP '\"\$CODE\"')' ;;
            esac
        " || fail "in-pod wallet_get_all probe failed"

        ok "cluster $NS/$DEPLOY: JS runtime healthy"
        ;;

    *)
        echo "Usage:" >&2
        echo "  $0 image    <docker-image-ref>" >&2
        echo "  $0 cluster  <namespace> <deployment>" >&2
        exit 2
        ;;
esac
