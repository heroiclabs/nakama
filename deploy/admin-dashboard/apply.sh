#!/usr/bin/env bash
# Deploy the hardened Nakama admin dashboard (React app + Node proxy)
# behind the existing Nakama ALB at:
#   https://nakama-rest.intelli-verse-x.ai/admin-dashboard/
#
# Usage:
#   bash deploy/admin-dashboard/apply.sh
#
# Safety:
#   - Refuses to run unless the current kube context targets the aicart
#     namespace ingress we expect.
#   - Verifies the rule index for nakama-rest.intelli-verse-x.ai BEFORE
#     applying the JSON patch, so we never accidentally inject the
#     /admin-dashboard path into a different host's rule.
#   - Idempotent: re-running is a no-op if the path already exists.

set -euo pipefail

NS="aicart"
INGRESS="intelliverse-user-frontend"
HOST="nakama-rest.intelli-verse-x.ai"
DASHBOARD_PATH="/admin-dashboard"
BACKEND_SVC="nakama-admin-dashboard"
BACKEND_PORT=80

# Resolve script dir so the script can be run from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\033[1;34m[admin-dashboard]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[admin-dashboard]\033[0m %s\n' "$*" >&2; }

# ── 0. Sanity checks ───────────────────────────────────────────────────────
command -v kubectl >/dev/null || { err "kubectl not on PATH"; exit 1; }
command -v jq      >/dev/null || { err "jq not on PATH";      exit 1; }

CTX="$(kubectl config current-context)"
log "Current kube context: ${CTX}"
if ! kubectl -n "${NS}" get ingress "${INGRESS}" >/dev/null 2>&1; then
  err "Ingress '${INGRESS}' not found in namespace '${NS}' under context '${CTX}'."
  err "Refusing to proceed — make sure you're pointed at the prod EKS cluster."
  exit 1
fi

# ── 1. Apply the ConfigMaps + Deployment + Service via kustomize ───────────
# --server-side avoids managed-field conflicts when the dashboard deployment is
# rolled by image automation between local manifest updates.
log "Applying kustomize bundle (Deployment, Service)…"
kubectl kustomize "${SCRIPT_DIR}" \
  | kubectl apply --server-side --force-conflicts -f -

log "Waiting for rollout of deploy/${BACKEND_SVC}…"
kubectl -n "${NS}" rollout status deploy/${BACKEND_SVC} --timeout=120s

# ── 2. Patch the ingress (only if the path isn't already there) ────────────
log "Inspecting ingress '${INGRESS}' for host '${HOST}'…"

# Get the index of the rule whose host matches HOST.
RULE_IDX="$(
  kubectl -n "${NS}" get ingress "${INGRESS}" -o json |
  jq --arg host "${HOST}" '
    .spec.rules
    | to_entries
    | map(select(.value.host == $host))
    | .[0].key // empty
  '
)"

if [[ -z "${RULE_IDX}" || "${RULE_IDX}" == "null" ]]; then
  err "Could not find a rule for host '${HOST}' in ingress '${INGRESS}'."
  err "Ingress hosts found:"
  kubectl -n "${NS}" get ingress "${INGRESS}" -o json |
    jq -r '.spec.rules[].host' >&2
  exit 1
fi
log "  → host '${HOST}' is rule index ${RULE_IDX}"

# Already patched? Skip.
ALREADY="$(
  kubectl -n "${NS}" get ingress "${INGRESS}" -o json |
  jq --argjson i "${RULE_IDX}" --arg p "${DASHBOARD_PATH}" '
    [.spec.rules[$i].http.paths[]?.path] | any(. == $p)
  '
)"
if [[ "${ALREADY}" == "true" ]]; then
  log "  → Path '${DASHBOARD_PATH}' already present on host '${HOST}'. Nothing to patch."
else
  log "  → Adding path '${DASHBOARD_PATH}' → svc/${BACKEND_SVC}:${BACKEND_PORT}"
  PATCH="$(
    jq -n --argjson i "${RULE_IDX}" \
          --arg     path "${DASHBOARD_PATH}" \
          --arg     svc  "${BACKEND_SVC}" \
          --argjson port "${BACKEND_PORT}" '
      [{
        op:    "add",
        path:  ("/spec/rules/" + ($i|tostring) + "/http/paths/0"),
        value: {
          path:     $path,
          pathType: "Prefix",
          backend:  { service: { name: $svc, port: { number: $port } } }
        }
      }]
    '
  )"
  kubectl -n "${NS}" patch ingress "${INGRESS}" --type=json --patch "${PATCH}"
fi

# ── 3. Smoke test ──────────────────────────────────────────────────────────
log "Cluster-side smoke test (port-forward through service)…"
PF_PORT=18099
kubectl -n "${NS}" port-forward svc/${BACKEND_SVC} ${PF_PORT}:80 >/dev/null 2>&1 &
PF_PID=$!
trap 'kill ${PF_PID} >/dev/null 2>&1 || true' EXIT
sleep 2
if curl -fsS "http://127.0.0.1:${PF_PORT}/healthz" >/dev/null; then
  log "  ✓ /healthz OK"
else
  err "  ✗ /healthz FAILED"
  exit 1
fi
if curl -fsS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:${PF_PORT}/admin-dashboard/" | grep -q '^200$'; then
  log "  ✓ /admin-dashboard/ returned 200"
else
  err "  ✗ /admin-dashboard/ did not return 200"
  exit 1
fi
kill ${PF_PID} >/dev/null 2>&1 || true
trap - EXIT

cat <<EOF

────────────────────────────────────────────────────────────────────
Dashboard deployed.

Internal:  svc/${BACKEND_SVC}.${NS}:80
Public:    https://${HOST}${DASHBOARD_PATH}/

Note: ALB sync usually takes 30-90s after the ingress patch.
You can watch propagation with:
    kubectl -n ${NS} describe ingress ${INGRESS} | grep -A2 "${HOST}"

────────────────────────────────────────────────────────────────────
EOF
