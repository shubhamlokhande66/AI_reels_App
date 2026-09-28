# Undo what allow-phone-mode-firewall.ps1 did. Run ONCE, as Administrator:
#   right-click PowerShell -> "Run as administrator", then:
#   cd C:\Shubham\ai-reel-maker
#   powershell -ExecutionPolicy Bypass -File scripts\undo-phone-mode-firewall.ps1
#
# It asks before every change:
#   1. removes the firewall rule "Reel Maker phone mode" (ports 3100 and 8000)
#   2. for each network that is currently Private, asks whether to set it back to Public.
#      Answer y only for a network that was Public before (for example the "iPhone" hotspot).
#      Answer n for networks you always kept Private (for example your home Wi-Fi).

$ErrorActionPreference = "Stop"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Write-Host "This needs Administrator rights. Close this window, open PowerShell with 'Run as administrator', and run it again." -ForegroundColor Red
    exit 1
}

# 1. the firewall rule
$rule = Get-NetFirewallRule -DisplayName "Reel Maker phone mode" -ErrorAction SilentlyContinue
if ($rule) {
    $a = Read-Host "Remove the firewall rule 'Reel Maker phone mode'? (y/N)"
    if ($a -match '^(y|yes)$') {
        $rule | Remove-NetFirewallRule
        Write-Host "  Rule removed." -ForegroundColor Green
    } else {
        Write-Host "  Rule kept."
    }
} else {
    Write-Host "The firewall rule is not there (already removed)." -ForegroundColor Green
}

# 2. the network type, one network at a time
$private = @(Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Private' })
if ($private.Count -eq 0) {
    Write-Host "No network is set to Private." -ForegroundColor Green
}
foreach ($p in $private) {
    $a = Read-Host "Set network '$($p.Name)' back to PUBLIC? (y/N)"
    if ($a -match '^(y|yes)$') {
        Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Public
        Write-Host "  '$($p.Name)' is Public again." -ForegroundColor Green
    } else {
        Write-Host "  '$($p.Name)' left as Private."
    }
}

Write-Host ""
Write-Host "Done. Check with:  Get-NetConnectionProfile" -ForegroundColor Cyan
