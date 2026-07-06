# dev.ps1 — One script: build, start, stop, test Nakama locally (Windows, no Docker).
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1
#   .\dev.ps1 start          # build + start (default)
#   .\dev.ps1 stop           # stop Nakama + Cockroach
#   .\dev.ps1 restart        # stop + build + start
#   .\dev.ps1 test           # smoke-test running server
#   .\dev.ps1 log            # follow Nakama logs (Ctrl+C to stop)
#   .\dev.ps1 log --last-30  # print last 30 lines and exit
#   .\dev.ps1 start -SkipBuild

param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'test', 'status', 'log')]
    [string]$Action = 'start',
    [switch]$SkipBuild,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
Set-Location $repoRoot

$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

$localDir    = Join-Path $repoRoot '.local'
$binDir      = Join-Path $localDir 'bin'
$dataDir     = Join-Path $localDir 'cockroach-data'
$modulesDir  = Join-Path $repoRoot 'data\modules'
$nakamaPid   = Join-Path $localDir 'nakama.pid'
$cockroachPid = Join-Path $localDir 'cockroach.pid'
$logOut      = Join-Path $localDir 'nakama.out.log'
$logErr      = Join-Path $localDir 'nakama.err.log'
$dbAddr      = 'root@127.0.0.1:26257'

function Write-Step([string]$Msg) { Write-Host "[*] $Msg" -ForegroundColor Cyan }
function Write-Ok([string]$Msg)   { Write-Host "[OK] $Msg" -ForegroundColor Green }
function Write-Fail([string]$Msg) { Write-Host "[FAIL] $Msg" -ForegroundColor Red; exit 1 }

function Test-Port([int]$Port) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect('127.0.0.1', $Port)
        $tcp.Close()
        return $true
    } catch { return $false }
}

function Stop-ByPidFile([string]$Path, [string]$Label) {
    if (-not (Test-Path $Path)) { return }
    $pidVal = Get-Content $Path -ErrorAction SilentlyContinue
    if ($pidVal -match '^\d+$') {
        $proc = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Step "Stopping $Label (PID $pidVal)..."
            Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
        }
    }
    Remove-Item $Path -Force -ErrorAction SilentlyContinue
}

function Stop-LocalStack {
    Write-Step 'Stopping local Nakama stack...'
    Stop-ByPidFile $nakamaPid 'Nakama'
    Stop-ByPidFile $cockroachPid 'CockroachDB'
    Get-Process -Name nakama, cockroach -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "*$($repoRoot -replace '\\', '\\')\.local\bin*" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Ok 'Stopped'
}

function Ensure-Cockroach {
    New-Item -ItemType Directory -Force -Path $binDir, $dataDir | Out-Null
    $cockroach = Join-Path $binDir 'cockroach.exe'
    if (Test-Path $cockroach) { return $cockroach }

    Write-Step 'Downloading CockroachDB v24.1...'
    $zip = Join-Path $localDir 'cockroach.zip'
    $url = 'https://binaries.cockroachdb.com/cockroach-v24.1.22.windows-6.2-amd64.zip'
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $localDir -Force
    $extracted = Get-ChildItem -Path $localDir -Recurse -Filter 'cockroach.exe' | Select-Object -First 1
    if (-not $extracted) { throw 'cockroach.exe not found in archive' }
    Copy-Item $extracted.FullName $cockroach -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    return $cockroach
}

function Ensure-Nakama {
    $nakama = Join-Path $binDir 'nakama.exe'
    if (Test-Path $nakama) { return $nakama }

    Write-Step 'Downloading Nakama v3.35.1...'
    $tgz = Join-Path $localDir 'nakama.tgz'
    $url = 'https://github.com/heroiclabs/nakama/releases/download/v3.35.1/nakama-3.35.1-windows-amd64.tar.gz'
    Invoke-WebRequest -Uri $url -OutFile $tgz -UseBasicParsing
    tar -xzf $tgz -C $localDir
    $extracted = Get-ChildItem -Path $localDir -Recurse -Filter 'nakama.exe' | Select-Object -First 1
    if (-not $extracted) { throw 'nakama.exe not found in archive' }
    Copy-Item $extracted.FullName $nakama -Force
    Remove-Item $tgz -Force -ErrorAction SilentlyContinue
    return $nakama
}

function Get-RuntimeEnvFlags {
    $envFile = Join-Path $repoRoot '.env'
    $keys = @(
        'GOOGLE_MAPS_API_KEY','LLM_PROVIDER','ANTHROPIC_API_KEY','OPENAI_API_KEY','XAI_API_KEY',
        'QUESTS_ECONOMY_API_URL','NAKAMA_WEBHOOK_SECRET','DEFAULT_GAME_ID',
        'APPODEAL_API_KEY','APPODEAL_USER_ID','APPODEAL_QUIZVERSE_APP_KEY',
        'UNITY_KEY_ID','UNITY_SECRET_KEY','UNITY_AUTH_HEADER','UNITY_QUIZVERSE_PROJECT_ID',
        'APPLE_KEY_ID','APPLE_ISSUER_ID','APPLE_PRIVATE_KEY','APPLE_QUIZVERSE_BUNDLE_ID',
        'ADMIN_USERNAME','ADMIN_PASSWORD_HASH','DASHBOARD_SECRET',
        'ROLLUP_ENABLED','EXTERNAL_POLLERS_ENABLED','DASHBOARD_PREFER_ROLLUPS','ANALYTICS_ENFORCE_SCHEMA',
        'SATORI_URL','SATORI_API_KEY_NAME','SATORI_API_KEY','SATORI_SIGNING_KEY','SATORI_HTTP_TIMEOUT_MS',
        'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION','AWS_S3_BUCKET','AWS_PRESIGNED_URL_EXPIRY','S3_BASE_URL',
        'GNEWS_API_KEY','CURRENTS_API_KEY','MEDIASTACK_API_KEY','NEWSAPI_API_KEY',
        'LASTFM_API_KEY','TMDB_API_KEY','NASA_API_KEY','REST_COUNTRIES_API_KEY','IVX_SYSTEM_USER_ID',
        'PUSH_REGISTER_URL','PUSH_SEND_URL','DEFAULT_FCM_PROJECT_ID',
        'SLACK_OPS_WEBHOOK_URL','DISCORD_QV_OPS_WEBHOOK_URL','DISCORD_NAKAMA_WEBHOOK_URL',
        'IVX_AI_SVC_BASE_URL','IVX_INSIGHTS_SHARED_SECRET','IVX_INSIGHTS_BUCKET_MS',
        'QUIZVERSE_N8N_BASE_URL','QUIZVERSE_ADMIN_API_TOKEN'
    )

    $fileVars = @{}
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') {
                $fileVars[$Matches[1]] = $Matches[2]
            }
        }
    }

    $flags = @()
    foreach ($k in $keys) {
        $v = [Environment]::GetEnvironmentVariable($k)
        if (-not $v -and $fileVars.ContainsKey($k)) { $v = $fileVars[$k] }
        if ($v -and $v -notmatch '^(PASTE_|your_)') {
            $flags += '--runtime.env'
            $flags += "${k}=$v"
        }
    }
    return $flags
}

function Build-Modules {
    Write-Step 'Building TypeScript modules...'
    Push-Location $modulesDir
    try {
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node not found — install Node.js' }
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm not found — install Node.js' }
        if (-not (Test-Path 'node_modules')) {
            Write-Step 'First run — npm install...'
            npm install
        }
        npm run build
        if (-not (Test-Path 'index.js')) { throw 'Build failed: data/modules/index.js missing' }
    } finally {
        Pop-Location
    }
    Write-Ok 'JS bundle ready: data/modules/index.js'
}

function Start-Cockroach([string]$cockroach) {
    if (Test-Port 26257) {
        Write-Ok 'CockroachDB already running on :26257'
        return
    }

    Write-Step 'Starting CockroachDB...'
    $crLog = Join-Path $localDir 'cockroach-start.log'
    $crErr = Join-Path $localDir 'cockroach.err.log'
    $proc = Start-Process -FilePath $cockroach -PassThru -WindowStyle Hidden `
        -ArgumentList @(
            'start-single-node', '--insecure',
            "--store=$dataDir",
            '--listen-addr=127.0.0.1:26257',
            '--http-addr=127.0.0.1:8088',
            '--advertise-addr=127.0.0.1:26257'
        ) `
        -RedirectStandardOutput $crLog -RedirectStandardError $crErr

    $proc.Id | Out-File -FilePath $cockroachPid -Encoding ascii -Force

    for ($i = 1; $i -le 45; $i++) {
        Start-Sleep -Seconds 2
        if (Test-Port 26257) {
            Write-Ok 'CockroachDB ready on :26257 (UI: http://127.0.0.1:8088)'
            return
        }
    }

    Write-Host 'CockroachDB failed to start. Last log lines:' -ForegroundColor Red
    if (Test-Path $crLog) { Get-Content $crLog -Tail 8 | ForEach-Object { Write-Host $_ } }
    if (Test-Path $crErr) { Get-Content $crErr -Tail 8 | ForEach-Object { Write-Host $_ } }
    Write-Host 'Tip: remove .local/cockroach-data if store is corrupted, or free port 8080.' -ForegroundColor Yellow
    throw 'CockroachDB failed to start on port 26257'
}

function Start-Nakama([string]$nakama) {
    if (Test-Port 7350) {
        Write-Step 'Nakama already on :7350 — restarting to load latest JS...'
        Stop-ByPidFile $nakamaPid 'Nakama'
        Get-Process -Name nakama -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    Write-Step 'Running migrations...'
    & $nakama migrate up --database.address $dbAddr
    if ($LASTEXITCODE -ne 0) { throw 'nakama migrate failed' }

    $runtimeFlags = Get-RuntimeEnvFlags
    Write-Step 'Starting Nakama...'

    $nakamaArgs = @(
        '--name', 'nakama1',
        '--database.address', $dbAddr,
        '--logger.level', 'INFO',
        '--session.token_expiry_sec', '43200',
        '--metrics.prometheus_port', '9100',
        '--runtime.path', $modulesDir
    ) + $runtimeFlags

    $proc = Start-Process -FilePath $nakama -PassThru -WindowStyle Hidden `
        -ArgumentList $nakamaArgs `
        -RedirectStandardOutput $logOut -RedirectStandardError $logErr

    $proc.Id | Out-File -FilePath $nakamaPid -Encoding ascii -Force

    for ($i = 1; $i -le 60; $i++) {
        Start-Sleep -Seconds 2
        try {
            $r = Invoke-WebRequest -Uri 'http://127.0.0.1:7350/' -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) {
                Write-Ok 'Nakama is up on http://localhost:7350'
                Write-Host ''
                Write-Host '  Console:  http://localhost:7351  (admin / password)'
                Write-Host '  HTTP API: http://localhost:7350'
                Write-Host "  Logs:     $logOut"
                Write-Host ''
                return
            }
        } catch {}
    }

    Write-Host 'Nakama may still be starting. Check logs:' -ForegroundColor Yellow
    Get-Content $logErr -Tail 20 -ErrorAction SilentlyContinue
    throw 'Nakama failed to become ready on port 7350'
}

function Start-LocalStack {
    if (-not $SkipBuild) { Build-Modules } else { Write-Step 'Skipping npm run build (-SkipBuild)' }

    $cockroach = Ensure-Cockroach
    $nakama    = Ensure-Nakama
    Start-Cockroach $cockroach
    Start-Nakama $nakama
}

function Test-LocalStack {
    Write-Step 'Smoke-testing local stack...'
    $failed = $false

    if (Test-Port 26257) { Write-Ok 'CockroachDB :26257' } else { Write-Fail 'CockroachDB not listening on :26257' }
    if (Test-Port 7350)  { Write-Ok 'Nakama HTTP :7350' } else { Write-Fail 'Nakama not listening on :7350' }

    try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:7350/' -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) { Write-Ok 'HTTP GET / returned 200' } else { Write-Fail "HTTP GET / returned $($r.StatusCode)" }
    } catch {
        Write-Fail "HTTP GET / failed: $($_.Exception.Message)"
    }

    $indexJs = Join-Path $modulesDir 'index.js'
    if (Test-Path $indexJs) {
        $rpcHit = Select-String -Path $indexJs -Pattern 'quizverse_get_questions' -Quiet
        if ($rpcHit) { Write-Ok 'quizverse_get_questions registered in index.js' }
        else { Write-Host '[FAIL] quizverse_get_questions not found in index.js' -ForegroundColor Red; $failed = $true }
    }

    if (Test-Path $logErr) {
        $goja = Select-String -Path $logErr -Pattern 'goja:|Failed to load JavaScript|Could not compile JavaScript' -ErrorAction SilentlyContinue
        if ($goja) {
            Write-Host '[FAIL] JS runtime errors in nakama.err.log:' -ForegroundColor Red
            $goja | Select-Object -First 3 | ForEach-Object { Write-Host "  $($_.Line)" }
            $failed = $true
        } else {
            Write-Ok 'No goja/compile errors in nakama.err.log'
        }
    }

    if ($failed) { exit 1 }
    Write-Ok 'All smoke tests passed'
}

function Show-Status {
    Write-Host 'Local stack status:'
    Write-Host "  CockroachDB :26257  $(if (Test-Port 26257) { 'UP' } else { 'DOWN' })"
    Write-Host "  Nakama      :7350   $(if (Test-Port 7350)  { 'UP' } else { 'DOWN' })"
    if (Test-Path $nakamaPid)   { Write-Host "  Nakama PID: $(Get-Content $nakamaPid)" }
    if (Test-Path $cockroachPid) { Write-Host "  Cockroach PID: $(Get-Content $cockroachPid)" }
}

function Parse-LogArgs {
    $last = 0
    $follow = $true
    $i = 0
    while ($i -lt $Rest.Count) {
        $arg = $Rest[$i]
        if ($arg -match '^--last-(\d+)$') {
            $last = [int]$Matches[1]
            $follow = $false
        } elseif ($arg -match '^--last=(\d+)$') {
            $last = [int]$Matches[1]
            $follow = $false
        } elseif ($arg -eq '-Last' -or $arg -eq '--last') {
            $i++
            if ($i -lt $Rest.Count -and $Rest[$i] -match '^\d+$') {
                $last = [int]$Rest[$i]
                $follow = $false
            } else {
                Write-Fail "Expected a number after $arg (e.g. .\dev.ps1 log --last-30)"
            }
        } elseif ($arg -match '^-Last(\d+)$') {
            $last = [int]$Matches[1]
            $follow = $false
        } else {
            Write-Fail "Unknown log option: $arg (use --last-30 or -Last 30)"
        }
        $i++
    }
    return @{ Last = $last; Follow = $follow }
}

function Write-LogTail([string]$Path, [string]$Label, [int]$Lines) {
    if (-not (Test-Path $Path)) {
        Write-Host "[$Label] (file not found: $Path)" -ForegroundColor DarkGray
        return
    }
    if ($Lines -gt 0) {
        Write-Host "--- $Label (last $Lines) ---" -ForegroundColor DarkCyan
        Get-Content -Path $Path -Tail $Lines -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
}

function Show-Logs {
    $opts = Parse-LogArgs
    $hasOut = Test-Path $logOut
    $hasErr = Test-Path $logErr

    if (-not $hasOut -and -not $hasErr) {
        Write-Fail "No log files yet. Start the server first: .\dev.ps1 start"
    }

    if ($opts.Follow) {
        Write-Step "Following Nakama logs (Ctrl+C to stop)"
        Write-Host "  out: $logOut"
        Write-Host "  err: $logErr"
        Write-Host ''
        if (-not $hasOut) {
            Write-Fail "Missing $logOut - is Nakama running?"
        }
        try {
            Get-Content -Path $logOut -Wait -Tail 0
        } catch {
            if ($_.Exception.Message -notmatch 'pipeline has been stopped') { throw }
        }
        return
    }

    $n = if ($opts.Last -gt 0) { $opts.Last } else { 30 }
    Write-LogTail $logOut 'nakama.out.log' $n
    Write-LogTail $logErr 'nakama.err.log' $n
}

switch ($Action) {
    'start'   { Start-LocalStack }
    'stop'    { Stop-LocalStack }
    'restart' { Stop-LocalStack; Start-LocalStack }
    'test'    { Test-LocalStack }
    'status'  { Show-Status }
    'log'     { Show-Logs }
}
