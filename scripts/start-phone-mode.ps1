# Start Reel Maker so a phone on the SAME Wi-Fi can open it and upload its videos.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-phone-mode.ps1
#
# Read this first: the app has no login. While phone mode is running, anyone on your Wi-Fi who knows the address can
# use it. Use it on your home network, not on a public or shared one. Close both windows to switch it off.
#
# It does not change your firewall. If the phone cannot connect, Windows is probably blocking it: allow Node.js and
# Python on PRIVATE networks when Windows asks (or run, as administrator:
#   New-NetFirewallRule -DisplayName "Reel Maker phone mode" -Direction Inbound -Protocol TCP -LocalPort 3100,8000 -Profile Private -Action Allow )

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -ExpandProperty IPAddress)
if ($ips.Count -eq 0) {
    Write-Host "No private network address found. Connect this computer to your Wi-Fi first." -ForegroundColor Red
    exit 1
}
$ip = $ips[0]

# Windows blocks incoming connections on networks it calls "Public": the phone would never get through.
$pub = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' -and $_.IPv4Connectivity -ne 'Disconnected' })
if ($pub.Count -gt 0) {
    Write-Host "Heads up: this network is set to PUBLIC in Windows ($($pub.Name -join ', ')), which blocks your phone." -ForegroundColor Yellow
    Write-Host "  Fix once (as Administrator): powershell -ExecutionPolicy Bypass -File scripts\allow-phone-mode-firewall.ps1" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host ""
Write-Host "Phone mode" -ForegroundColor Cyan
Write-Host "  On your phone (same Wi-Fi), open:  http://${ip}:3100" -ForegroundColor Green
if ($ips.Count -gt 1) { Write-Host "  (other addresses of this computer: $($ips[1..($ips.Count - 1)] -join ', '))" }
Write-Host "  No login exists: only use this on a network you trust." -ForegroundColor Yellow
Write-Host ""

# Per port: a server already listening on the NETWORK (0.0.0.0 or ::) is reused. One listening on this computer only
# (127.0.0.1) would answer first and hide phone mode, so that one has to be closed.
function Get-PortState($port) {
    $l = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
    if ($l.Count -eq 0) { return "free" }
    if (@($l | Where-Object { $_.LocalAddress -in @("0.0.0.0", "::") }).Count -gt 0) { return "network" }
    return "local-only"
}
$api = Get-PortState 8000
$web = Get-PortState 3100
if ($api -eq "local-only" -or $web -eq "local-only") {
    Write-Host "An older copy of the app is running for this computer only (port 8000 or 3100), and would hide phone mode." -ForegroundColor Red
    Write-Host "Close it (Ctrl+C in the terminal that runs it), then run this script again." -ForegroundColor Red
    exit 1
}

if ($api -eq "network") {
    Write-Host "API on port 8000 is already running for the network: keeping it." -ForegroundColor DarkGray
} else {
    # Backend: listen on the network and accept pages opened from private addresses.
    $backend = Join-Path $root "backend"
    $py = Join-Path $backend ".venv\Scripts\python.exe"
    $env:CORS_ALLOW_LAN = "true"
    Start-Process -FilePath $py -WorkingDirectory $backend -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"
    Write-Host "Started the API window (port 8000)."
}

if ($web -eq "network") {
    Write-Host "App on port 3100 is already running for the network: keeping it." -ForegroundColor DarkGray
} else {
    # Frontend: listen on the network too.
    $frontend = Join-Path $root "frontend"
    Start-Process -FilePath "npm.cmd" -WorkingDirectory $frontend -ArgumentList "run", "dev:lan"
    Write-Host "Started the app window (port 3100)."
}

Write-Host "Wait ~15 seconds, then open the address above on your phone."
