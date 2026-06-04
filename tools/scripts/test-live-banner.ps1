# Smoke-test: seed a public creator live event and call quizverse_live_banner_check.
# Usage:
#   .\tools\scripts\test-live-banner.ps1
#   .\tools\scripts\test-live-banner.ps1 -BaseUrl "https://nakama-rest.intelli-verse-x.ai"
#   .\tools\scripts\test-live-banner.ps1 -Upcoming
#
# Prerequisites: Nakama running, modules built (npm run build in data/modules), nakama restarted.

param(
    [string]$BaseUrl = "http://localhost:7350",
    [string]$ServerKey = "defaultkey",
    [string]$GameId = "126bf539-dae2-4bcf-964d-316c0fa1f92b",
    [switch]$Upcoming,
    [switch]$SkipSeed
)

$ErrorActionPreference = "Stop"

function Get-BasicAuthHeader([string]$Key) {
    $bytes = [Text.Encoding]::ASCII.GetBytes("${Key}:")
    "Basic " + [Convert]::ToBase64String($bytes)
}

function Invoke-NakamaRpc {
    param(
        [string]$RpcId,
        [hashtable]$Body,
        [string]$Token
    )
    $json = ($Body | ConvertTo-Json -Compress -Depth 12)
    $headers = @{
        Authorization = if ($Token) { "Bearer $Token" } else { Get-BasicAuthHeader $ServerKey }
        "Content-Type"  = "application/json"
    }
    $uri = "$BaseUrl/v2/rpc/$RpcId"
    $resp = Invoke-RestMethod -Uri $uri -Method POST -Body $json -Headers $headers
    if ($resp.payload) {
        return $resp.payload | ConvertFrom-Json
    }
    return $resp
}

Write-Host "=== QuizVerse live banner backend test ===" -ForegroundColor Cyan
Write-Host "BaseUrl: $BaseUrl"

$deviceId = "banner-test-" + [guid]::NewGuid().ToString("N").Substring(0, 12)
Write-Host ""
Write-Host "[1] Authenticate device: $deviceId"
$auth = Invoke-RestMethod -Uri "$BaseUrl/v2/account/authenticate/device?create=true" `
    -Method POST `
    -Headers @{ Authorization = (Get-BasicAuthHeader $ServerKey); "Content-Type" = "application/json" } `
    -Body (@{ id = $deviceId } | ConvertTo-Json -Compress)
$token = $auth.token
if (-not $token) { throw "No session token returned from device auth." }
Write-Host "    OK - session token received."

$epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$now = [int]$epoch
$startAt = if ($Upcoming) { $now + 600 } else { $now - 60 }
$eventId = "banner-smoke-$now"

if (-not $SkipSeed) {
    Write-Host ""
    Write-Host "[2] Seed event via creator_live_event_publish (SYSTEM live_events)"
    $event = @{
        id               = $eventId
        title            = "Banner Smoke Test"
        description      = "Backend test - safe to delete"
        scheduledAt      = $startAt
        duration         = 30
        status           = "published"
        visibility       = "public"
        gameId           = $GameId
        participantCount = 1
        creatorId        = "banner-test-creator"
    }
    $pub = Invoke-NakamaRpc -RpcId "creator_live_event_publish" -Body @{ event = $event } -Token $token
    Write-Host "    Publish response:" ($pub | ConvertTo-Json -Compress)
} else {
    Write-Host ""
    Write-Host "[2] SkipSeed - using existing events only."
}

Write-Host ""
Write-Host "[3] Call quizverse_live_banner_check (force_refresh=true)"
$banner = Invoke-NakamaRpc -RpcId "quizverse_live_banner_check" -Body @{
    game_id       = $GameId
    force_refresh = $true
} -Token $token

$data = $banner.data
if (-not $data -and $null -ne $banner.show) { $data = $banner }

Write-Host ""
Write-Host "--- Banner RPC result ---"
($banner | ConvertTo-Json -Depth 6)

$ok = $false
if ($data -and $data.show -eq $true) {
    $ok = $true
    Write-Host ""
    Write-Host "PASS: show=true" -ForegroundColor Green
    Write-Host "  event_id   : $($data.event_id)"
    Write-Host "  event_type : $($data.event_type)"
    Write-Host "  title      : $($data.title)"
    Write-Host "  cta_text   : $($data.cta_text)"
    Write-Host "  starts_at  : $($data.starts_at)"
    Write-Host "  ends_at    : $($data.ends_at)"
    Write-Host "  badge      : $($data.badge)"
} else {
    Write-Host ""
    Write-Host "FAIL: show is not true - banner would stay hidden in Unity." -ForegroundColor Red
    Write-Host "Troubleshooting:"
    Write-Host "  - Restart Nakama after npm run build in data/modules"
    Write-Host "  - Event must be published, public, correct gameId"
    Write-Host "  - Live window: startAt <= now <= endAt (or upcoming within 30 min)"
    Write-Host "  - Active tournament overrides creator on the banner"
    Write-Host "  - Logs: docker compose logs nakama | Select-String LiveBanner"
}

Write-Host ""
Write-Host "[4] Tail Nakama logs for LiveBanner (if docker available)"
try {
    $compose = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "docker-compose.yml"
    docker compose -f $compose logs --tail 30 nakama 2>$null | Select-String "LiveBanner"
} catch {
    Write-Host "    (docker log tail skipped)"
}

if (-not $ok) { exit 1 }
exit 0
