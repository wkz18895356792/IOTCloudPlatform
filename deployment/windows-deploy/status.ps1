# BabyMonitor Platform Status Checker
# View service status and health

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BabyMonitor Service Status" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "PM2 Process Status:" -ForegroundColor Yellow
pm2 status

Write-Host ""
Write-Host "Service Ports:" -ForegroundColor Yellow
Write-Host "  api-gateway    : http://localhost:6001" -ForegroundColor White
Write-Host "  user-service   : http://localhost:6002" -ForegroundColor White
Write-Host "  device-service : http://localhost:6003" -ForegroundColor White
Write-Host "  video-service : http://localhost:6004" -ForegroundColor White
Write-Host "  storage-service: http://localhost:6005" -ForegroundColor White
Write-Host "  baby-service   : http://localhost:6008" -ForegroundColor White
Write-Host "  admin-service  : http://localhost:6009" -ForegroundColor White
Write-Host "  device-gateway : http://localhost:6010" -ForegroundColor White
Write-Host ""

# Check health endpoints
Write-Host "Health Check:" -ForegroundColor Yellow
$services = @(
    @{Name="api-gateway"; Port=6001},
    @{Name="user-service"; Port=6002},
    @{Name="device-service"; Port=6003},
    @{Name="video-service"; Port=6004},
    @{Name="storage-service"; Port=6005},
    @{Name="baby-service"; Port=6008},
    @{Name="admin-service"; Port=6009},
    @{Name="device-gateway"; Port=6010}
)

foreach ($svc in $services) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$($svc.Port)/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Host "  $($svc.Name): OK" -ForegroundColor Green
        } else {
            Write-Host "  $($svc.Name): Error (HTTP $($response.StatusCode))" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  $($svc.Name): Cannot connect" -ForegroundColor Red
    }
}

Write-Host ""
