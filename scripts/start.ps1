# Start the whole app (API + website) with ONE command, for this computer only.
#
#   start.bat                      (double-click it, or run it in a terminal)
#   scripts\stop.bat               (stops both)
#
# Backend  http://127.0.0.1:8000   (FastAPI)      log: backend.log / backend.err.log
# Website  http://127.0.0.1:3100   (Next.js)      log: frontend.log
#
# Nothing here is exposed to your network. MongoDB is started automatically if it is not running (see below);
# AI assist uses the provider chosen in Settings (Gemini, OpenAI or a local Ollama); it is optional.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

function Test-Port($port) { @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -gt 0 }
function Wait-Url($url, $seconds) {
    $end = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $end) {
        try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null; return $true } catch { Start-Sleep -Milliseconds 800 }
    }
    return $false
}

Write-Host ""
Write-Host "Reel Maker" -ForegroundColor Cyan

# --- MongoDB: start it when it is not running already ------------------------------------------------------------
# Looks for mongod in: $env:MONGOD_BIN, PATH, the portable copy in %USERPROFILE%\mongodb-portable, Program Files.
# Data folder: $env:MONGODB_DATA, else %USERPROFILE%\mongodb-portable\data (existing data is kept), else <repo>\mongo-data.
# It listens on 127.0.0.1 only. stop.bat leaves MongoDB running (other programs may use it; stopping it by force is unsafe).
function Find-Mongod {
    if ($env:MONGOD_BIN -and (Test-Path $env:MONGOD_BIN)) { return $env:MONGOD_BIN }
    $cmd = Get-Command mongod.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(Get-ChildItem -Path (Join-Path $env:USERPROFILE "mongodb-portable") -Filter mongod.exe -Recurse -Depth 4 -ErrorAction SilentlyContinue) +
                  @(Get-ChildItem -Path "C:\Program Files\MongoDB\Server" -Filter mongod.exe -Recurse -Depth 3 -ErrorAction SilentlyContinue)
    $found = $candidates | Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

if (-not (Test-Port 27017)) {
    $service = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne "Running") {
        try { Start-Service -Name "MongoDB" -ErrorAction Stop; Write-Host "Starting the MongoDB service..." } catch { $service = $null }
    }
    if (-not (Test-Port 27017) -and -not ($service -and $service.Status -eq "Running")) {
        $mongod = Find-Mongod
        if (-not $mongod) {
            Write-Host "MongoDB is not running and mongod.exe was not found. Install MongoDB, or set MONGOD_BIN to the full path of mongod.exe." -ForegroundColor Red
            exit 1
        }
        $portable = Join-Path $env:USERPROFILE "mongodb-portable"
        $dbPath = if ($env:MONGODB_DATA) { $env:MONGODB_DATA } elseif (Test-Path (Join-Path $portable "data")) { Join-Path $portable "data" } else { Join-Path $root "mongo-data" }
        New-Item -ItemType Directory -Force -Path $dbPath | Out-Null
        $mongoLog = Join-Path (Split-Path -Parent $dbPath) "mongod.log"
        Start-Process -FilePath $mongod -ArgumentList @("--dbpath", "`"$dbPath`"", "--bind_ip", "127.0.0.1", "--port", "27017", "--logpath", "`"$mongoLog`"", "--logappend") `
            -WindowStyle Hidden
        Write-Host "Starting MongoDB ($mongod)..."
    }
    $end = (Get-Date).AddSeconds(30)
    while (-not (Test-Port 27017) -and (Get-Date) -lt $end) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Port 27017)) {
        Write-Host "MongoDB did not start on port 27017 within 30 seconds. See its log (mongod.log next to the data folder)." -ForegroundColor Red
        exit 1
    }
    Write-Host "MongoDB is running." -ForegroundColor Green
} else {
    Write-Host "MongoDB already running on port 27017: keeping it." -ForegroundColor DarkGray
}

# --- what it needs -----------------------------------------------------------------------------------------------
$py = Join-Path $backend ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "The backend is not set up yet: $py is missing." -ForegroundColor Red
    Write-Host "  cd backend; python -m venv .venv; .venv\Scripts\pip install -r requirements.txt" -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Write-Host "The website is not set up yet: run  cd frontend; npm install  once." -ForegroundColor Red
    exit 1
}
# --- backend -----------------------------------------------------------------------------------------------------
if (Test-Port 8000) {
    Write-Host "API already running on port 8000: keeping it." -ForegroundColor DarkGray
} else {
    # --reload: a code change restarts the API by itself (a render running at that moment is stopped; generate it again)
    Start-Process -FilePath $py -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload", "--reload-dir", "app") `
        -WorkingDirectory $backend -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $root "backend.log") -RedirectStandardError (Join-Path $root "backend.err.log")
    Write-Host "Starting the API..."
}

# --- website -----------------------------------------------------------------------------------------------------
if (Test-Port 3100) {
    Write-Host "Website already running on port 3100: keeping it." -ForegroundColor DarkGray
} else {
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    Start-Process -FilePath $npm -ArgumentList @("run", "dev", "--", "-H", "127.0.0.1", "--port", "3100") `
        -WorkingDirectory $frontend -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $root "frontend.log") -RedirectStandardError (Join-Path $root "frontend.err.log")
    Write-Host "Starting the website..."
}

# --- wait until both answer, then open the browser ---------------------------------------------------------------
$apiOk = Wait-Url "http://127.0.0.1:8000/api/health" 60
$webOk = Wait-Url "http://127.0.0.1:3100" 90
if (-not $apiOk) { Write-Host "The API did not answer in time. See backend.err.log in $root" -ForegroundColor Red }
if (-not $webOk) { Write-Host "The website did not answer in time. See frontend.err.log in $root" -ForegroundColor Red }

# --- AI: ask the API which provider is really used (Settings -> AI provider wins over .env) and whether it answers --
if ($apiOk) {
    try {
        $ai = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/ai/config" -TimeoutSec 10
        foreach ($kind in @("text", "vision")) {
            $st = $ai.status.$kind
            if ($st -and -not $st.available) {
                $name = (Get-Culture).TextInfo.ToTitleCase([string]$st.provider)
                Write-Host "AI ($kind) uses $name, which is not available ($($st.detail)): the app works, but AI assist will say it is unavailable. Check Settings -> AI provider." -ForegroundColor Yellow
            }
        }
        if ($ai.status.text.available) {
            Write-Host "AI: $((Get-Culture).TextInfo.ToTitleCase([string]$ai.status.text.provider)) ($($ai.status.text.model))." -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "Could not read the AI settings from the API; AI assist may be unavailable." -ForegroundColor DarkGray
    }
}
if ($apiOk -and $webOk) {
    Write-Host ""
    Write-Host "Ready:  http://127.0.0.1:3100" -ForegroundColor Green
    Write-Host "Stop with:  scripts\stop.bat" -ForegroundColor DarkGray
    Start-Process "http://127.0.0.1:3100"
} else {
    exit 1
}
