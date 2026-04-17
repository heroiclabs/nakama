# build-plugin.ps1 — Build the analytics Go plugin and drop the .so into
# `data/modules/` so the dev docker-compose stack picks it up via the
# volume mount.
#
# Usage (from nakama/ root):
#   ./scripts/build-plugin.ps1
#
# What it does:
#   1. Builds ONLY the Dockerfile's `builder` stage (plugin .so only).
#   2. Extracts the .so to `data/modules/analytics_metrics.so` on host.
#   3. Triggers a reload by touching the file (compose restart picks it up).
#
# Keeps dev ergonomics: you don't have to rebuild the full Nakama image
# for plugin changes, and JS hot-reloading via the volume mount still works.

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path "$PSScriptRoot/..").Path
Set-Location $repoRoot

Write-Host "[build-plugin] Building analytics_metrics.so from $repoRoot/go-plugin/..." -ForegroundColor Cyan

# Use a deterministic tag so we can remove the container after extract.
$buildTag = "nakama-plugin-builder:local"
docker build `
    --target builder `
    --tag $buildTag `
    --file Dockerfile `
    . | Out-Host

if ($LASTEXITCODE -ne 0) {
    Write-Error "[build-plugin] docker build failed"
    exit 1
}

# Run a throwaway container to extract the .so, then remove it.
$tmpContainer = "nakama-plugin-builder-extract-$(Get-Random)"
try {
    docker create --name $tmpContainer $buildTag | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "docker create failed" }

    $destDir = Join-Path $repoRoot "data/modules"
    $destPath = Join-Path $destDir "analytics_metrics.so"

    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }

    docker cp "${tmpContainer}:/build/analytics_metrics.so" $destPath | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "docker cp failed" }

    Write-Host "[build-plugin] ✓ Plugin written to $destPath" -ForegroundColor Green
    Write-Host "[build-plugin] Restart Nakama to load the new plugin:" -ForegroundColor Yellow
    Write-Host "    docker compose restart nakama" -ForegroundColor Yellow
} finally {
    docker rm -f $tmpContainer 2>$null | Out-Null
}
