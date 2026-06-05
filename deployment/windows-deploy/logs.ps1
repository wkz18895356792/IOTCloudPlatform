# BabyMonitor Platform Log Viewer
# View service logs

param(
    [string]$Service = "",
    [int]$Lines = 100
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BabyMonitor Service Logs" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($Service) {
    Write-Host "Viewing logs for: $Service (last $Lines lines)" -ForegroundColor Yellow
    pm2 logs $Service --lines $Lines
} else {
    Write-Host "Viewing all service logs (last $Lines lines)" -ForegroundColor Yellow
    Write-Host "Press Ctrl+C to exit" -ForegroundColor Gray
    Write-Host ""
    pm2 logs --lines $Lines
}
