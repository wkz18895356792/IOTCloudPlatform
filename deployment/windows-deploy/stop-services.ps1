# BabyMonitor Platform Service Stopper
# Stop all microservices

param(
    [string[]]$Services = @()
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BabyMonitor Service Stopper" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($Services.Count -gt 0) {
    Write-Host "Stopping services: $($Services -join ', ')" -ForegroundColor Yellow
    foreach ($service in $Services) {
        pm2 stop $service
    }
} else {
    Write-Host "Stopping all services..." -ForegroundColor Yellow
    pm2 stop all
}

Write-Host ""
pm2 status
Write-Host ""
Write-Host "Services stopped" -ForegroundColor Green
Write-Host ""
