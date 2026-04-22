#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# Pre-commit hook: refuse to commit a broken JS bundle.
#
# Installed by scripts/setup-hooks.sh as .git/hooks/pre-commit.
#
# What it checks (in order, fail-fast):
#   1. No git merge conflict markers in any *.js under data/modules/.
#      The cbeacf6 outage shipped 63 unresolved markers because nothing
#      blocked the commit. This is the smallest, fastest gate.
#   2. `node -c data/modules/index.js`  — the merged bundle parses.
#   3. `node -c data/modules/legacy_runtime.js` — the legacy source parses.
#   4. If only sources changed (no rebuilt index.js staged), warn loudly
#      that `npm run build` should be run before pushing.
#
# Bypass with --no-verify, but please don't.
# ──────────────────────────────────────────────────────────────────────────
set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

STAGED_MOD_JS="$(git diff --cached --name-only --diff-filter=ACMR -- 'data/modules/**/*.js' 'data/modules/*.js' 2>/dev/null || true)"
STAGED_MOD_TS="$(git diff --cached --name-only --diff-filter=ACMR -- 'data/modules/src/**/*.ts' 2>/dev/null || true)"

if [ -z "$STAGED_MOD_JS" ] && [ -z "$STAGED_MOD_TS" ]; then
    exit 0
fi

# 1. Conflict-marker scan — covers ALL staged module files (not just index.js).
CONFLICTED=""
for f in $STAGED_MOD_JS; do
    if [ -f "$f" ] && grep -qE '^(<<<<<<< |=======$|>>>>>>> )' "$f"; then
        CONFLICTED="$CONFLICTED $f"
    fi
done
if [ -n "$CONFLICTED" ]; then
    echo "✗ pre-commit: unresolved git merge conflict markers in:" >&2
    for f in $CONFLICTED; do echo "    $f" >&2; done
    echo "  Resolve them, then re-stage. (cbeacf6 shipped this exact bug to prod.)" >&2
    exit 1
fi

# 2. Syntax check the merged bundle if it's staged or already on disk.
INDEX_JS="data/modules/index.js"
if [ -f "$INDEX_JS" ]; then
    if ! node -c "$INDEX_JS" 2>/tmp/precommit-syntax.err; then
        echo "✗ pre-commit: $INDEX_JS failed Node syntax check:" >&2
        sed 's/^/    /' /tmp/precommit-syntax.err >&2
        echo "  Run 'cd data/modules && node postbuild.js' to regenerate." >&2
        exit 1
    fi
fi

# 3. Syntax check legacy_runtime.js (postbuild concatenates it verbatim,
#    so a syntax error here propagates into index.js).
LEGACY_JS="data/modules/legacy_runtime.js"
if [ -f "$LEGACY_JS" ]; then
    if ! node -c "$LEGACY_JS" 2>/tmp/precommit-legacy.err; then
        echo "✗ pre-commit: $LEGACY_JS failed Node syntax check:" >&2
        sed 's/^/    /' /tmp/precommit-legacy.err >&2
        exit 1
    fi
fi

# 4. Source change without rebuilt bundle? Warn but don't block — the
#    Dockerfile.production stage will regenerate, and CI will fail loud
#    if the regenerated bundle differs from what's committed.
if [ -n "$STAGED_MOD_TS" ] && ! echo "$STAGED_MOD_JS" | grep -q "data/modules/index.js"; then
    echo "⚠ pre-commit: TypeScript sources changed but data/modules/index.js was not re-staged." >&2
    echo "  Recommend: cd data/modules && npm run build && git add index.js build/index.js" >&2
fi

exit 0
