#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# Custom git merge driver for data/modules/index.js (and build/index.js).
#
# Wired up in .gitattributes:
#     data/modules/index.js  merge=regen-modules-index
#
# Why this exists:
#   index.js is the merged output of `node postbuild.js`. Trying to merge
#   two 77 000-line concatenated bundles line-by-line will always succeed
#   the wrong way (the cbeacf6 outage shipped 63 unresolved `<<<<<<< HEAD`
#   markers straight into prod, and Nakama refused to compile the bundle).
#   A 3-way text merge of a build artefact is meaningless: the only
#   correct merge is "regenerate from source after both parents have been
#   merged in their respective source files".
#
# How git invokes this:
#   driver %O %A %B %P
#     %A = the path to the file in the working tree (the "ours" side
#          we're supposed to write the merged result back into)
#   We don't care about %O / %B — we discard both sides and rebuild.
#
# Exit codes (per gitattributes(5)):
#   0 = merge succeeded, %A now contains the result.
#   1 = conflict — git will then fall back to the default text driver
#       (which would show the user the underlying merge conflict; that's
#       fine because in that case the postbuild itself failed and the
#       human has to fix `legacy_runtime.js` / `src/**/*.ts` first).
# ──────────────────────────────────────────────────────────────────────────
set -eu

A="${1:-}"
if [ -z "$A" ]; then
    echo "[merge-regen-index] FATAL: no target file argument" >&2
    exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
MODULES_DIR="$REPO_ROOT/data/modules"

if [ ! -f "$MODULES_DIR/postbuild.js" ]; then
    echo "[merge-regen-index] FATAL: $MODULES_DIR/postbuild.js missing — falling back to text merge" >&2
    exit 1
fi

# Ensure tsc output exists (postbuild reads build/index.js). If the user
# hasn't run `npm run build` yet, do it now so this driver works on a
# fresh clone.
if [ ! -f "$MODULES_DIR/build/index.js" ]; then
    echo "[merge-regen-index] build/index.js missing — running 'npm run build' first" >&2
    ( cd "$MODULES_DIR" && npm install --no-audit --no-fund >/dev/null 2>&1 || true )
    ( cd "$MODULES_DIR" && npx tsc ) || {
        echo "[merge-regen-index] FATAL: tsc failed — please resolve TypeScript errors and re-merge" >&2
        exit 1
    }
fi

echo "[merge-regen-index] regenerating $A via postbuild.js …" >&2
( cd "$MODULES_DIR" && node postbuild.js >&2 ) || {
    echo "[merge-regen-index] FATAL: postbuild.js failed — falling back to text merge so you can resolve conflicts in legacy_runtime.js / src first" >&2
    exit 1
}

# postbuild.js writes to data/modules/index.js. The build/index.js path
# is its input, not its output, so for that file we rebuild it via tsc.
case "$A" in
    *data/modules/build/index.js)
        ( cd "$MODULES_DIR" && npx tsc ) || exit 1
        SRC="$MODULES_DIR/build/index.js"
        ;;
    *)
        SRC="$MODULES_DIR/index.js"
        ;;
esac

if [ ! -s "$SRC" ]; then
    echo "[merge-regen-index] FATAL: regenerated $SRC is empty" >&2
    exit 1
fi

cp "$SRC" "$A"

# Final syntax gate — same check the prod Dockerfile does. If postbuild
# produced unparseable JS (e.g. a bad legacy_runtime.js still has markers)
# refuse to claim the merge succeeded.
if ! node -c "$A" 2>/dev/null; then
    echo "[merge-regen-index] FATAL: regenerated $A failed Node syntax check" >&2
    exit 1
fi

echo "[merge-regen-index] OK — $A regenerated and syntax-checked" >&2
exit 0
