# Resume analytics_rollup_run until each date completes, then verify.
#
# DIRECT (needs prod HTTP key on Nakama URL):
#   $env:NAKAMA_HTTP_KEY="<prod-http-key>"
#   & .\scripts\run-rollup-and-verify.ps1 -Date "2026-06-26"
#
# VIA LOCAL ADMIN PROXY (recommended if direct 401s):
#   1. npm run serve  (port 8080) + npm run dev (port 3100)
#   2. Log in at http://localhost:3100/admin-dashboard/
#   3. DevTools -> Application -> Local Storage -> nakama-admin-session -> copy "token"
#   4. & .\scripts\run-rollup-and-verify.ps1 -Date "2026-06-26" -AdminProxyUrl "http://localhost:8080" -AdminToken "<token>"
#
# Reads DASHBOARD_SECRET from .env.

param(
  [string]$HttpKey = $env:NAKAMA_HTTP_KEY,
  [string]$BaseUrl = $env:NAKAMA_BASE_URL,
  [string]$AdminProxyUrl = $env:ADMIN_PROXY_URL,
  [string]$AdminToken = $env:ADMIN_TOKEN,
  [string]$Date = $env:ROLLUP_DATE,
  [int]$MaxAttempts = 300,
  [int]$RetryDelaySec = 2,
  [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env"

if (-not $HttpKey -and (Test-Path $envFile)) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*NAKAMA_HTTP_KEY=(.+)$') {
      $HttpKey = $matches[1].Trim()
      break
    }
  }
}
if ($HttpKey) { $HttpKey = $HttpKey.Trim() }

$secret = $null
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*DASHBOARD_SECRET=(.+)$') {
      $secret = $matches[1].Trim()
      break
    }
  }
}
if (-not $secret) {
  Write-Error "DASHBOARD_SECRET not found in $envFile"
}

$useProxy = ($AdminProxyUrl -and $AdminToken)
if (-not $useProxy -and -not $HttpKey) {
  Write-Error "Set NAKAMA_HTTP_KEY for direct mode, OR -AdminProxyUrl + -AdminToken (local admin proxy)"
}

$base = if ($BaseUrl) { $BaseUrl.TrimEnd('/') } else { "https://nakama-rest.intelli-verse-x.ai" }
$proxyBase = if ($AdminProxyUrl) { $AdminProxyUrl.TrimEnd('/') } else { $null }
if ($AdminToken) { $AdminToken = $AdminToken.Trim() }

$gameId = "126bf539-dae2-4bcf-964d-316c0fa1f92b"
$from = if ($Date) { $Date } elseif ($env:ROLLUP_FROM) { $env:ROLLUP_FROM } else { "2026-06-12" }
$to = if ($Date) { $Date } elseif ($env:ROLLUP_TO) { $env:ROLLUP_TO } else { "2026-06-27" }
$verifyDays = if ($env:VERIFY_DAYS) { [int]$env:VERIFY_DAYS } else { 31 }

function Invoke-NakamaRpc($rpcId, $payload) {
  $json = ($payload | ConvertTo-Json -Compress)
  if ($useProxy) {
    $url = "$proxyBase/admin-dashboard/api/rpc/$rpcId"
    $headers = @{
      Authorization = "Bearer $AdminToken"
      "Content-Type" = "application/json"
    }
    return Invoke-RestMethod -Uri $url -Method POST -Body $json -Headers $headers -TimeoutSec 300
  }

  $qb = [System.UriBuilder]::new("$base/v2/rpc/$rpcId")
  $qb.Query = "http_key=$([uri]::EscapeDataString($HttpKey))&unwrap=true"
  return Invoke-RestMethod -Uri $qb.Uri -Method POST -Body $json -ContentType "application/json" -TimeoutSec 300
}

function Invoke-RollupWithRetry($date) {
  $transient = 0
  while ($transient -lt 10) {
    try {
      return Invoke-NakamaRpc "analytics_rollup_run" @{ date = $date; dashboard_secret = $secret }
    } catch {
      $msg = $_.Exception.Message
      if ($msg -match '502|503|504|timed out|timeout') {
        $transient++
        Write-Warning ("[{0}] transient error (#{1}): {2} - retrying in {3}s" -f $date, $transient, $msg, $RetryDelaySec)
        Start-Sleep -Seconds $RetryDelaySec
        continue
      }
      throw
    }
  }
  throw "[$date] too many transient 502/timeout errors - checkpoint saved; re-run same command to resume"
}

function Test-NakamaAuth {
  Write-Host "Auth preflight..."
  if ($useProxy) {
  Write-Host "Mode: admin proxy $proxyBase"
    try {
      Invoke-NakamaRpc "admin_health_check" @{} | Out-Null
      Write-Host "Preflight OK (admin proxy)"
      return
    } catch {
      throw "Admin proxy auth failed. Log in again and copy a fresh token from localStorage (nakama-admin-session)."
    }
  }

  Write-Host "Mode: direct $base (HTTP key length $($HttpKey.Length))"
  try {
    Invoke-NakamaRpc "nakama_js_health" @{} | Out-Null
    Write-Host "Preflight OK (direct HTTP key)"
  } catch {
    throw "Direct Nakama auth failed (401). Use API Explorer HTTP key or switch to -AdminProxyUrl + -AdminToken."
  }
}

function Get-DateRange($start, $end) {
  $out = @()
  $d = [datetime]::ParseExact($start, "yyyy-MM-dd", $null)
  $endD = [datetime]::ParseExact($end, "yyyy-MM-dd", $null)
  while ($d -le $endD) {
    $out += $d.ToString("yyyy-MM-dd")
    $d = $d.AddDays(1)
  }
  return $out
}

function Complete-RollupForDate($date) {
  $attempt = 0
  $lastScanned = -1
  $stuckCount = 0
  $final = $null

  while ($attempt -lt $MaxAttempts) {
    $attempt++
    $started = Get-Date
    $resp = Invoke-RollupWithRetry $date
    $elapsed = [int]((Get-Date) - $started).TotalSeconds

    if ($resp.partial -eq $true) {
      $scanned = [int]($resp.events_scanned)
      $matched = if ($null -ne $resp.events_matched_so_far) { [int]$resp.events_matched_so_far } else { 0 }
      $stage = if ($resp.stage) { $resp.stage } else { "scan" }
      Write-Host ("[{0}] partial #{1} ({2} sec) stage={3} scanned={4} matched={5}" -f $date, $attempt, $elapsed, $stage, $scanned, $matched)

      if ($scanned -eq $lastScanned) {
        $stuckCount++
        if ($stuckCount -ge 5) {
          Write-Warning "[$date] scanned count unchanged for 5 attempts - still retrying"
        }
      } else {
        $stuckCount = 0
        $lastScanned = $scanned
      }

      Start-Sleep -Seconds $RetryDelaySec
      continue
    }

    $final = $resp
    Write-Host ("[{0}] COMPLETE in {1} attempts ({2} sec)" -f $date, $attempt, $elapsed)
    break
  }

  if (-not $final) {
    throw "[$date] gave up after $MaxAttempts partial passes - re-run to resume checkpoint"
  }

  return $final
}

Test-NakamaAuth
Write-Host "Rollup range: $from -> $to (max $MaxAttempts passes per date)"
$dates = Get-DateRange $from $to
$summary = @()

foreach ($date in $dates) {
  try {
    $final = Complete-RollupForDate $date
    $rev = $null
    if ($final.revenue) { $rev = $final.revenue.usd }
    elseif ($final.result -and $final.result.revenue) { $rev = $final.result.revenue.usd }
    Write-Host ("[{0}] games_written={1} revenue_usd={2}" -f $date, $final.games_written, $rev)
    $summary += [pscustomobject]@{ date = $date; revenue_usd = $rev; games_written = $final.games_written; ok = $true }
  } catch {
    Write-Warning $_.Exception.Message
    $summary += [pscustomobject]@{ date = $date; revenue_usd = $null; games_written = $null; ok = $false }
  }
}

Write-Host ""
Write-Host "=== Rollup summary ==="
$summary | Format-Table -AutoSize

if ($SkipVerify) { return }

Write-Host ""
Write-Host "=== analytics_revenue_verify ($verifyDays days, QuizVerse) ==="
$verify = Invoke-NakamaRpc "analytics_revenue_verify" @{
  days = $verifyDays
  game_id = $gameId
  dashboard_secret = $secret
}
$verify | ConvertTo-Json -Depth 8

Write-Host ""
Write-Host "=== satori_game_metrics spot check ==="
$metrics = Invoke-NakamaRpc "satori_game_metrics" @{ days = 31; game_id = $gameId }
foreach ($spot in @("2026-06-15", "2026-06-26")) {
  $row = $metrics.data.series | Where-Object { $_.date -eq $spot }
  if ($row) {
    Write-Host "$spot revenue=$($row.revenue) payers=$($row.payers)"
  } else {
    Write-Host "$spot not in series"
  }
}
