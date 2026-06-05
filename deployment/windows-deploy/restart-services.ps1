# BabyMonitor Platform Service Restarter
# Restart all microservices

param(
    [string[]]$Services = @()
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BabyMonitor Service Restarter" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($Services.Count -gt 0) {
    Write-Host "Restarting services: $($Services -join ', ')" -ForegroundColor Yellow
    foreach ($service in $Services) {
        pm2 restart $service
    }
} else {
    Write-Host "Restarting all services..." -ForegroundColor Yellow
    pm2 restart all
}

Write-Host ""
pm2 status
Write-Host ""
Write-Host "Services restarted" -ForegroundColor Green
Write-Host ""
