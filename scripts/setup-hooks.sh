#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# One-time per-clone setup: wire up the safety nets that prevent another
# cbeacf6-style outage (broken JS bundle silently shipped to prod).
#
# Run once after `git clone`:
#     scripts/setup-hooks.sh
#
# What it installs:
#   • Custom git merge driver `regen-modules-index` referenced by
#     .gitattributes for data/modules/index.js (and build/index.js).
#     Re-runs `node postbuild.js` instead of trying to merge the 77 000-line
#     concatenated bundle line-by-line.
#   • Pre-commit hook that:
#       - blocks commits with `<<<<<<<` markers under data/modules/
#       - syntax-checks data/modules/index.js + legacy_runtime.js
#       - warns if .ts sources changed without a fresh rebuild.
# ──────────────────────────────────────────────────────────────────────────
set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "[setup-hooks] configuring merge driver 'regen-modules-index' …"
git config merge.regen-modules-index.name 'Regenerate data/modules/index.js via postbuild.js'
git config merge.regen-modules-index.driver 'scripts/git-merge-regen-index.sh %A'
git config merge.regen-modules-index.recursive 'binary'

HOOK_DIR=".git/hooks"
mkdir -p "$HOOK_DIR"

PRE_COMMIT="$HOOK_DIR/pre-commit"
if [ -e "$PRE_COMMIT" ] && ! grep -q 'pre-commit-modules-syntax' "$PRE_COMMIT" 2>/dev/null; then
    echo "[setup-hooks] backing up existing pre-commit hook → ${PRE_COMMIT}.bak"
    mv "$PRE_COMMIT" "${PRE_COMMIT}.bak"
fi

cat > "$PRE_COMMIT" <<'EOF'
#!/usr/bin/env bash
# Auto-installed by scripts/setup-hooks.sh. Calls the real hook script.
exec "$(git rev-parse --show-toplevel)/scripts/pre-commit-modules-syntax.sh" "$@"
EOF
chmod +x "$PRE_COMMIT"

chmod +x scripts/git-merge-regen-index.sh scripts/pre-commit-modules-syntax.sh

echo "[setup-hooks] OK"
echo "  merge driver:    git config merge.regen-modules-index.driver"
echo "  pre-commit hook: $PRE_COMMIT"
