# Purge sandbox/seeded IAP revenue from QuizVerse prod analytics storage.
# Requires DASHBOARD_SECRET in d:\nakama\.env (and NAKAMA_HTTP_KEY for direct mode).
#
# Usage:
#   cd d:\nakama
#   .\scripts\purge-sandbox-revenue.ps1
#   .\scripts\purge-sandbox-revenue.ps1 -Apply
#   .\scripts\purge-sandbox-revenue.ps1 -Apply -SkipEvents

param(
  [string]$HttpKey = $env:NAKAMA_HTTP_KEY,
  [string]$BaseUrl = $env:NAKAMA_BASE_URL,
  [string]$From = "2026-06-29",
  [string]$To = "2026-07-02",
  [switch]$Apply,
  [switch]$SkipEvents,
  [switch]$SkipRecompute
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env"

$secret = $null
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*DASHBOARD_SECRET=(.+)$') { $secret = $matches[1].Trim(); break }
    if (-not $HttpKey -and $line -match '^\s*NAKAMA_HTTP_KEY=(.+)$') { $HttpKey = $matches[1].Trim() }
  }
}
if (-not $secret) { Write-Error "DASHBOARD_SECRET not found in $envFile" }
if (-not $HttpKey) { Write-Error "NAKAMA_HTTP_KEY not set (env or .env)" }

$base = if ($BaseUrl) { $BaseUrl.TrimEnd('/') } else { "https://nakama-rest.intelli-verse-x.ai" }
$gameId = "126bf539-dae2-4bcf-964d-316c0fa1f92b"
$dryRun = -not $Apply

function Invoke-NakamaRpc($rpcId, $payload) {
  $json = ($payload | ConvertTo-Json -Compress -Depth 8)
  $qb = [System.UriBuilder]::new("$base/v2/rpc/$rpcId")
  $qb.Query = "http_key=$([uri]::EscapeDataString($HttpKey))&unwrap=true"
  return Invoke-RestMethod -Uri $qb.Uri -Method POST -Body $json -ContentType "application/json" -TimeoutSec 300
}

Write-Host "=== Before: satori_game_metrics (31d) ==="
$before = Invoke-NakamaRpc "satori_game_metrics" @{ days = 31; game_id = $gameId }
$badDays = @($before.series | Where-Object { [double]$_.revenue -gt 0.05 })
if ($badDays.Count -gt 0) {
  foreach ($row in $badDays) {
    Write-Host ("  {0}: USD {1} ({2} payers)" -f $row.date, $row.revenue, $row.payers)
  }
} else {
  Write-Host "  No inflated daily revenue rows."
}
Write-Host ("  31d total revenue: USD {0}" -f $before.totals.revenue)

if (-not $SkipEvents) {
  Write-Host ""
  Write-Host "=== analytics_events_purge (dry_run=$dryRun) ${From} .. ${To} ==="
  $cursor = $null
  do {
    $ep = @{
      game_id = $gameId
      from = $From
      to = $To
      dry_run = $dryRun
      dashboard_secret = $secret
    }
    if ($cursor) { $ep.cursor = $cursor }
    $resp = Invoke-NakamaRpc "analytics_events_purge" $ep
    Write-Host ($resp | ConvertTo-Json -Compress -Depth 6)
    $cursor = $resp.next_cursor
  } while ($cursor)
}

Write-Host ""
Write-Host "=== analytics_revenue_purge (dry_run=$dryRun) ${From} .. ${To} ==="
Write-Host "NOTE: live_daily zeroing requires updated analytics_rollup.js on prod Nakama."
$rp = Invoke-NakamaRpc "analytics_revenue_purge" @{
  game_id = $gameId
  from = $From
  to = $To
  dry_run = $dryRun
  reason = "Remove sandbox/seeded IAP revenue from admin dashboard"
  dashboard_secret = $secret
}
Write-Host ($rp | ConvertTo-Json -Compress -Depth 8)

if ($Apply -and -not $SkipRecompute) {
  Write-Host ""
  Write-Host "=== analytics_history_recompute ==="
  try {
    $rc = Invoke-NakamaRpc "analytics_history_recompute" @{
      game_id = $gameId
      from_year = 2026
      to_year = 2026
      dashboard_secret = $secret
    }
    Write-Host ($rc | ConvertTo-Json -Compress -Depth 4)
  } catch {
    Write-Warning "history_recompute may have timed out at HTTP layer; verify with lifetime read."
  }
}

Write-Host ""
Write-Host "=== After: satori_game_metrics (31d) ==="
$after = Invoke-NakamaRpc "satori_game_metrics" @{ days = 31; game_id = $gameId }
$badAfter = @($after.series | Where-Object { [double]$_.revenue -gt 0.05 })
if ($badAfter.Count -gt 0) {
  foreach ($row in $badAfter) {
    Write-Host ("  STILL {0}: USD {1}" -f $row.date, $row.revenue)
  }
} else {
  Write-Host "  OK - no daily revenue above 0.05 USD"
}
Write-Host ("  31d total revenue: USD {0}" -f $after.totals.revenue)

if (-not $Apply) {
  Write-Host ""
  Write-Host "Dry run complete. Re-run with -Apply to write."
}
