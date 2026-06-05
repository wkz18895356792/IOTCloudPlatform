# BabyMonitor Platform Service Updater
# Update a single service without downtime

param(
    [Parameter(Mandatory=$true)]
    [string]$Service,

    [string]$SourcePath = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

 $ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BabyMonitor Service Updater" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Validate service name
$ValidServices = @(
    "api-gateway",
    "user-service",
    "device-service",
    "device-gateway",
    "baby-service",
    "video-service",
    "storage-service",
    "admin-service"
)

if ($ValidServices -notcontains $Service) {
    Write-Error "Invalid service name: $Service"
    Write-Host "Valid services: $($ValidServices -join ', ')" -ForegroundColor Yellow
    exit 1
}

 Write-Host "Updating service: $Service" -ForegroundColor Yellow
Write-Host ""

# Check if service is running
$pm2List = pm2 jlist 2>$null | ConvertFrom-Json
$runningService = $pm2List | Where-Object { $_.name -eq $Service }

if (-not $runningService) {
    Write-Host "Warning: Service $Service is not running" -ForegroundColor Yellow
}

# Determine source path
if ([string]::IsNullOrEmpty($SourcePath)) {
    $releasePath = Join-Path (Split-Path -Parent $ScriptDir) "release\$Service"
    if (-not (Test-Path $releasePath)) {
        Write-Error "Source not found: $releasePath"
        Write-Host "Please run build-for-deploy.ps1 first" -ForegroundColor Yellow
        exit 1
    }
    $SourcePath = $releasePath
}

if (-not (Test-Path $SourcePath)) {
    Write-Error "Source path does not exist: $SourcePath"
    exit 1
}

# Target path
$targetPath = Join-Path $ScriptDir $Service
Write-Host "Source: $SourcePath" -ForegroundColor Gray
Write-Host "Target: $targetPath" -ForegroundColor Gray
Write-Host ""

# Stop service
if ($runningService) {
    Write-Host "[1/4] Stopping service..." -ForegroundColor Yellow
    pm2 stop $Service
    Write-Host "  - Service stopped" -ForegroundColor Green
}

 # Backup current version
Write-Host "[2/4] Backing up current version..." -ForegroundColor Yellow
$backupPath = "$targetPath.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
if (Test-Path $targetPath) {
    Move-Item -Path $targetPath -Destination $backupPath
    Write-Host "  - Backup saved to: $backupPath" -ForegroundColor Green
}

 # Copy new version
Write-Host "[3/4] Copying new version..." -ForegroundColor Yellow
Copy-Item -Path $SourcePath -Destination $targetPath -Recurse
 Write-Host "  - Copy complete" -ForegroundColor Green

# Install dependencies if needed
if (-not (Test-Path (Join-Path $targetPath "node_modules"))) {
    Write-Host "  - Installing dependencies..." -ForegroundColor Gray
    Set-Location $targetPath
    npm install --omit=dev --registry=https://registry.npmmirror.com --loglevel=error 2>$null
    Set-Location $ScriptDir
    Write-Host "  - Dependencies installed" -ForegroundColor Green
}
 # Start service
Write-Host "[4/4] Starting service..." -ForegroundColor Yellow
pm2 start ecosystem.config.js --only $Service
Write-Host "  - Service started" -ForegroundColor Green

Write-Host ""
pm2 status

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Service Update Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "To rollback, copy $backupPath back to $targetPath" -ForegroundColor Gray
Write-Host ""
