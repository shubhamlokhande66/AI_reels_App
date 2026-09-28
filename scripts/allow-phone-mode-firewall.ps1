# Let your phone reach Reel Maker through the Windows firewall. Run ONCE, as Administrator:
#   right-click PowerShell -> "Run as administrator", then:
#   powershell -ExecutionPolicy Bypass -File scripts\allow-phone-mode-firewall.ps1
#
# What it does (it shows this and asks before changing anything):
#   1. Marks your CURRENT Wi-Fi/network as "Private" (Windows treats Public networks as untrusted and blocks
#      incoming connections). Only do this on a network you trust: your home Wi-Fi or your own phone's hotspot.
#   2. Adds ONE inbound rule that allows TCP ports 3100 (app) and 8000 (API) on Private networks only.
# It does not delete anything. To undo: Remove-NetFirewallRule -DisplayName "Reel Maker phone mode"
#   and switch the network back with Set-NetConnectionProfile -NetworkCategory Public.

$ErrorActionPreference = "Stop"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Write-Host "This needs Administrator rights. Close this window, open PowerShell with 'Run as administrator', and run it again." -ForegroundColor Red
    exit 1
}

$profiles = @(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' -and $_.NetworkCategory -eq 'Public' })
Write-Host ""
Write-Host "Current network(s):" -ForegroundColor Cyan
Get-NetConnectionProfile | ForEach-Object { Write-Host ("  {0}  [{1}]  on {2}" -f $_.Name, $_.NetworkCategory, $_.InterfaceAlias) }
Write-Host ""
if ($profiles.Count -gt 0) {
    Write-Host "Will switch to PRIVATE: $($profiles.Name -join ', ')" -ForegroundColor Yellow
}
Write-Host "Will add inbound allow rule 'Reel Maker phone mode' for TCP 3100, 8000 on Private networks." -ForegroundColor Yellow
$answer = Read-Host "Only proceed if you trust this network (home Wi-Fi or your own phone's hotspot). Continue? (y/N)"
if ($answer -notmatch '^(y|yes)$') { Write-Host "Nothing was changed."; exit 0 }

foreach ($p in $profiles) {
    Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Private
    Write-Host "  '$($p.Name)' is now Private." -ForegroundColor Green
}

if (-not (Get-NetFirewallRule -DisplayName "Reel Maker phone mode" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Reel Maker phone mode" -Direction Inbound -Protocol TCP -LocalPort 3100, 8000 -Profile Private -Action Allow | Out-Null
    Write-Host "  Firewall rule added." -ForegroundColor Green
} else {
    Write-Host "  Firewall rule already exists." -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Now run scripts\start-phone-mode.ps1 (if it is not running) and open the address on your phone." -ForegroundColor Cyan
