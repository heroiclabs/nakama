# Patch production IAP revenue on admin dashboard after analytics_revenue_purge.
# Updates analytics_rollup_daily + analytics_live_daily — ~10 seconds, no full rollup scan.
#
# Requires DASHBOARD_SECRET + NAKAMA_HTTP_KEY in d:\nakama\.env
#
# Dry run (default):
#   .\scripts\patch-prod-revenue.ps1 -Date "2026-07-03" -RevenueUsd 0.51 -IapCount 1
#
# Apply:
#   .\scripts\patch-prod-revenue.ps1 -Date "2026-07-03" -RevenueUsd 0.51 -IapCount 1 -Apply
#
# Deploy order: ship sandbox-filter Nakama modules FIRST, then run this script.

param(
  [string]$HttpKey = $env:NAKAMA_HTTP_KEY,
  [string]$BaseUrl = $env:NAKAMA_BASE_URL,
  [string]$Date = (Get-Date).ToString("yyyy-MM-dd"),
  [double]$RevenueUsd = 0.51,
  [int]$IapCount = 1,
  [string]$GameId = "126bf539-dae2-4bcf-964d-316c0fa1f92b",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env"
$SystemUser = "00000000-0000-0000-0000-000000000000"

$secret = $null
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if (-not $secret -and $line -match '^\s*DASHBOARD_SECRET=(.+)$') { $secret = $matches[1].Trim() }
    if (-not $HttpKey -and $line -match '^\s*NAKAMA_HTTP_KEY=(.+)$') { $HttpKey = $matches[1].Trim() }
    if (-not $BaseUrl -and $line -match '^\s*NAKAMA_BASE_URL=(.+)$') { $BaseUrl = $matches[1].Trim() }
  }
}
if (-not $secret) { Write-Error "DASHBOARD_SECRET not found in $envFile" }
if (-not $HttpKey) { Write-Error "NAKAMA_HTTP_KEY not set (env or .env)" }

$base = if ($BaseUrl) { $BaseUrl.TrimEnd('/') } else { "https://nakama-rest.intelli-verse-x.ai" }
$dryRun = -not $Apply
$revRounded = [math]::Round($RevenueUsd, 2)
$patchedAt = (Get-Date).ToUniversalTime().ToString("o")

function Invoke-NakamaRpc($rpcId, $payload, [string]$Token) {
  $json = ($payload | ConvertTo-Json -Compress -Depth 20)
  $qb = [System.UriBuilder]::new("$base/v2/rpc/$rpcId")
  $qb.Query = "http_key=$([uri]::EscapeDataString($HttpKey))&unwrap=true"
  $headers = @{ "Content-Type" = "application/json" }
  if ($Token) { $headers.Authorization = "Bearer $Token" }
  return Invoke-RestMethod -Uri $qb.Uri -Method POST -Body $json -Headers $headers -TimeoutSec 120
}

function Clone-JsonObject($obj) {
  if ($null -eq $obj) { return @{} }
  return ($obj | ConvertTo-Json -Depth 30 | ConvertFrom-Json)
}

function Get-StorageObject([string]$Collection, [string]$Key, [string]$Token) {
  $qb = [System.UriBuilder]::new("$base/v2/storage/$Collection/$Key")
  $qb.Query = "user_id=$([uri]::EscapeDataString($SystemUser))"
  $headers = @{ Authorization = "Bearer $Token" }
  try {
    $resp = Invoke-RestMethod -Uri $qb.Uri -Method GET -Headers $headers -TimeoutSec 60
    if ($resp -and $null -ne $resp.value) {
      return @{ found = $true; value = $resp.value; version = $resp.version }
    }
  } catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -eq 404) { return @{ found = $false; value = $null; version = $null } }
    throw
  }
  return @{ found = $false; value = $null; version = $null }
}

function Set-StorageObject([string]$Collection, [string]$Key, $Value, [string]$Token) {
  Invoke-NakamaRpc "admin_storage_write" @{
    collection = $Collection
    key = $Key
    userId = $SystemUser
    value = $Value
    version = "*"
  } $Token | Out-Null
}

function Patch-RollupDoc($existing) {
  $doc = Clone-JsonObject $existing
  if (-not $doc.gameId) { $doc | Add-Member -NotePropertyName gameId -NotePropertyValue $GameId -Force }
  if (-not $doc.date) { $doc | Add-Member -NotePropertyName date -NotePropertyValue $Date -Force }
  if (-not $doc.revenue) { $doc | Add-Member -NotePropertyName revenue -NotePropertyValue (@{}) -Force }
  $beforeUsd = 0.0
  $beforeIap = 0
  if ($doc.revenue.usd) { $beforeUsd = [double]$doc.revenue.usd }
  if ($doc.revenue.iap_count) { $beforeIap = [int]$doc.revenue.iap_count }
  $doc.revenue.usd = $revRounded
  $doc.revenue.iap_count = $IapCount
  $doc.revenue._patched = @{
    patched_at = $patchedAt
    before_usd = $beforeUsd
    before_iap_count = $beforeIap
    reason = "Restore production IAP revenue after purge (patch-prod-revenue.ps1)"
  }
  if ($doc.revenue.PSObject.Properties.Name -contains "_purged") {
    $doc.revenue.PSObject.Properties.Remove("_purged")
  }
  return @{ doc = $doc; before_usd = $beforeUsd; before_iap = $beforeIap }
}

function Patch-LiveDoc($existing) {
  $doc = Clone-JsonObject $existing
  $beforeUsd = 0.0
  if ($doc.revenue_usd) { $beforeUsd = [double]$doc.revenue_usd }
  if (-not $doc.by_name) { $doc | Add-Member -NotePropertyName by_name -NotePropertyValue (@{}) -Force }
  $doc.revenue_usd = $revRounded
  $doc.by_name.iap_purchased = $IapCount
  $doc | Add-Member -NotePropertyName revenue_patched -NotePropertyValue @{
    patched_at = $patchedAt
    before_usd = $beforeUsd
    reason = "Restore production IAP revenue after purge (patch-prod-revenue.ps1)"
  } -Force
  return @{ doc = $doc; before_usd = $beforeUsd }
}

Write-Host "=== patch-prod-revenue (dry_run=$dryRun) ==="
Write-Host "Date=$Date RevenueUsd=$revRounded IapCount=$IapCount GameId=$GameId"

Write-Host ""
Write-Host "Bootstrapping admin session..."
$boot = Invoke-NakamaRpc "admin_session_bootstrap" @{ dashboard_secret = $secret } $null
$token = $boot.token
if (-not $token) { Write-Error "admin_session_bootstrap did not return a token" }
Write-Host "Admin session OK"

$targets = @(
  @{ collection = "analytics_rollup_daily"; key = "rollup_${GameId}_$Date"; kind = "rollup" }
  @{ collection = "analytics_live_daily"; key = "live_${GameId}_$Date"; kind = "live" }
  @{ collection = "analytics_live_daily"; key = "live_all_$Date"; kind = "live" }
)

Write-Host ""
Write-Host "=== Before: satori_game_metrics ==="
$before = Invoke-NakamaRpc "satori_game_metrics" @{ days = 7; game_id = $GameId } $null
$dayBefore = $before.series | Where-Object { $_.date -eq $Date }
if ($dayBefore) {
  Write-Host ("  {0}: revenue={1} payers={2}" -f $dayBefore.date, $dayBefore.revenue, $dayBefore.payers)
} else {
  Write-Host "  $Date not in 7d series"
}

foreach ($t in $targets) {
  Write-Host ""
  Write-Host ("--- {0} / {1} ---" -f $t.collection, $t.key)
  $obj = Get-StorageObject $t.collection $t.key $token
  if (-not $obj.found) {
    Write-Host "  not found — will create minimal doc on apply"
    if ($t.kind -eq "rollup") { $patched = Patch-RollupDoc $null }
    else { $patched = Patch-LiveDoc $null }
  } else {
    $cur = if ($t.kind -eq "rollup") { $obj.value.revenue.usd } else { $obj.value.revenue_usd }
    Write-Host ("  before revenue={0}" -f $cur)
    if ($t.kind -eq "rollup") { $patched = Patch-RollupDoc $obj.value }
    else { $patched = Patch-LiveDoc $obj.value }
  }
  Write-Host ("  after  revenue={0} iap={1}" -f $revRounded, $IapCount)
  if (-not $dryRun) {
    Set-StorageObject $t.collection $t.key $patched.doc $token
    Write-Host "  WRITTEN"
  } else {
    Write-Host "  (dry run — not written)"
  }
}

if (-not $dryRun) {
  Write-Host ""
  Write-Host "=== After: satori_game_metrics ==="
  $after = Invoke-NakamaRpc "satori_game_metrics" @{ days = 7; game_id = $GameId } $null
  $dayAfter = $after.series | Where-Object { $_.date -eq $Date }
  if ($dayAfter) {
    Write-Host ("  {0}: revenue={1} payers={2}" -f $dayAfter.date, $dayAfter.revenue, $dayAfter.payers)
  }
  Write-Host ""
  Write-Host "Done. Hard-refresh admin Game Metrics tab."
} else {
  Write-Host ""
  Write-Host "Dry run complete. Re-run with -Apply to write (~10 seconds total)."
}
