#!/usr/bin/env bash
# Wrapper — on Windows runs dev.ps1; on Unix use Docker path or install Ubuntu WSL.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*)
    exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ROOT/dev.ps1" "$@"
    ;;
  *)
    echo "On Linux/macOS/WSL Ubuntu, use: ./dev.sh via docker (see dev.ps1 for Windows native)."
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      cd "$ROOT/data/modules" && npm install && npm run build
      cd "$ROOT" && docker compose up -d && docker compose restart nakama
      echo "Nakama: http://localhost:7350"
    else
      echo "Install Docker or run on Windows: powershell -File dev.ps1" >&2
      exit 1
    fi
    ;;
esac
