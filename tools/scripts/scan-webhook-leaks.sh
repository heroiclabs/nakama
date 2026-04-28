#!/usr/bin/env bash
#
# scan-webhook-leaks.sh
# ---------------------
# Phase 0 (qv-insights-loop) safety net. Greps the working tree for any
# Discord (or generic webhook) URL that has slipped into source-controlled
# files. Intended to be wired in two places:
#
#   1. Pre-commit hook (local), via:
#        ln -sf ../../tools/scripts/scan-webhook-leaks.sh .git/hooks/pre-commit
#
#   2. CI step in any repo that ships application code or k8s manifests.
#      Exit code 1 on detection causes the build to fail.
#
# Usage:
#   tools/scripts/scan-webhook-leaks.sh             # scan whole tree
#   tools/scripts/scan-webhook-leaks.sh --staged    # scan only staged files
#
# To allow-list a specific occurrence (e.g. an example/doc snippet), append
# the literal token  qv-allow-webhook  on the same line, OR add the file
# path to .webhook-leaks-allowlist.
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ALLOWLIST_FILE="$REPO_ROOT/.webhook-leaks-allowlist"
SCAN_STAGED=false
[[ "${1:-}" == "--staged" ]] && SCAN_STAGED=true

# Patterns that catch real webhooks. Intentionally NOT matching the literal
# host alone — only when followed by the API path that real webhooks use.
PATTERNS=(
  'discord(app)?\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+'
  'hooks\.slack\.com/services/[A-Z0-9]+/[A-Z0-9]+/[A-Za-z0-9_-]+'
  'outlook\.office\.com/webhook/[A-Za-z0-9-]+@[A-Za-z0-9-]+/IncomingWebhook/[A-Za-z0-9]+'
)
PATTERN_REGEX="$(IFS='|'; echo "${PATTERNS[*]}")"

# Exclude folders that don't ship code.
EXCLUDES=(
  --glob='!node_modules/**'
  --glob='!dist/**'
  --glob='!build/**'
  --glob='!.git/**'
  --glob='!**/package-lock.json'
  --glob='!**/yarn.lock'
  --glob='!**/pnpm-lock.yaml'
  --glob='!**/uv.lock'
)

if $SCAN_STAGED; then
  FILES=$(git diff --cached --name-only --diff-filter=ACM | tr '\n' ' ')
  [[ -z "$FILES" ]] && exit 0
  HITS=$(rg --no-heading --color=never -nP "$PATTERN_REGEX" $FILES 2>/dev/null || true)
else
  HITS=$(rg --no-heading --color=never -nP "$PATTERN_REGEX" "${EXCLUDES[@]}" "$REPO_ROOT" 2>/dev/null || true)
fi

[[ -z "$HITS" ]] && { echo "[scan-webhook-leaks] OK — no webhook URLs found"; exit 0; }

# Filter out allow-listed lines (inline marker) and allow-listed paths.
FILTERED=""
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  if grep -qF 'qv-allow-webhook' <<<"$line"; then continue; fi
  if [[ -f "$ALLOWLIST_FILE" ]]; then
    file_part="${line%%:*}"
    if grep -Fxq "$file_part" "$ALLOWLIST_FILE" 2>/dev/null; then continue; fi
  fi
  FILTERED+="$line"$'\n'
done <<<"$HITS"

if [[ -z "$FILTERED" ]]; then
  echo "[scan-webhook-leaks] OK — all hits are allow-listed"
  exit 0
fi

echo
echo "❌ [scan-webhook-leaks] Discord/Slack webhook URL found in source!"
echo "   Move it to a Kubernetes Secret + env var, then rotate the leaked URL."
echo "   See docs/webhook-leak-response.md."
echo
echo "$FILTERED"
exit 1
