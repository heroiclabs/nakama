#!/usr/bin/env bash
# Deprecated wrapper — use ./dev.sh from repo root.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dev.sh" "$@"
