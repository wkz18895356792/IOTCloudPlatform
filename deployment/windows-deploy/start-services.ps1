# BabyMonitor Platform Service Starter
# Start all microservices

param(
    [string[]]$Services = @()
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BabyMonitor Service Starter" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check .env file
$envFile = Join-Path $ScriptDir ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "Warning: .env file not found!" -ForegroundColor Red
    Write-Host "Please copy .env.example to .env and configure environment variables" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne "y") {
        exit 1
    }
}

# Load environment variables
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.*)$") {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim() -replace '^"|"$', ''
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
    Write-Host "Loaded .env environment variables" -ForegroundColor Green
}

Write-Host ""

# Start services
if ($Services.Count -gt 0) {
    Write-Host "Starting specified services: $($Services -join ', ')" -ForegroundColor Yellow
    foreach ($service in $Services) {
        pm2 start ecosystem.config.js --only $service
    }
} else {
    Write-Host "Starting all services..." -ForegroundColor Yellow
    pm2 start ecosystem.config.js
}

Write-Host ""
pm2 status

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Services Started!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Common commands:" -ForegroundColor Yellow
Write-Host "  pm2 status          - View service status" -ForegroundColor White
Write-Host "  pm2 logs            - View all logs" -ForegroundColor White
Write-Host "  pm2 logs api-gateway - View specific service log" -ForegroundColor White
Write-Host "  pm2 monit           - Monitor panel" -ForegroundColor White
Write-Host "  pm2 restart all     - Restart all services" -ForegroundColor White
Write-Host "  pm2 stop all        - Stop all services" -ForegroundColor White
Write-Host ""
Write-Host "Service ports:" -ForegroundColor Yellow
Write-Host "  api-gateway    : 6001" -ForegroundColor White
Write-Host "  user-service   : 6002" -ForegroundColor White
Write-Host "  device-service : 6003" -ForegroundColor White
Write-Host "  video-service : 6004" -ForegroundColor White
Write-Host "  storage-service: 6005" -ForegroundColor White
Write-Host "  baby-service   : 6008" -ForegroundColor White
Write-Host "  admin-service  : 6009" -ForegroundColor White
Write-Host "  device-gateway : 6010" -ForegroundColor White
Write-Host ""

# Save PM2 config for startup
Write-Host "Saving PM2 configuration for startup..." -ForegroundColor Yellow
pm2 save
Write-Host ""
