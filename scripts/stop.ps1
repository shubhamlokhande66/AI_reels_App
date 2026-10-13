# Stop the app (port 3100) started by start.bat.

foreach ($port in 3100) {
    $pids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($pids.Count -eq 0) { Write-Host "Port ${port}: nothing running." -ForegroundColor DarkGray; continue }
    foreach ($id in $pids) {
        # /T also ends the child processes (npm starts node)
        & taskkill /PID $id /T /F | Out-Null
        Write-Host "Port ${port}: stopped (process $id)." -ForegroundColor Green
    }
}
