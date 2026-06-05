# BabyMonitor Platform Dependency Installation Script
# Install production dependencies on the server

param(
    [string]$Registry = "https://registry.npmmirror.com"
)
$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BabyMonitor Dependency Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "[1/4] Checking Node.js environment..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "  - Node.js version: $nodeVersion" -ForegroundColor Green
    $versionParts = $nodeVersion.Substring(1).Split('.')
    $majorVersion = [int]$versionParts[0]
    if ($majorVersion -lt 18) {
        Write-Error "Node.js version must be >= 18, current: $nodeVersion"
        exit 1
    }
} catch {
    Write-Error "Node.js not found. Please install Node.js 18+ first"
    Write-Host "Download: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}
try {
    $npmVersion = npm --version
    Write-Host "  - npm version: $npmVersion" -ForegroundColor Green
} catch {
    Write-Error "npm not found"
    exit 1
}

# Check PM2
Write-Host "  - Checking PM2..." -ForegroundColor Gray
try {
    $pm2Version = pm2 --version 2>$null
    Write-Host "  - PM2 version: $pm2Version" -ForegroundColor Green
} catch {
    Write-Host "  - PM2 not found, installing..." -ForegroundColor Yellow
    npm install -g pm2 --registry=$Registry
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  - PM2 installed" -ForegroundColor Green
    } else {
        Write-Error "Failed to install PM2"
        exit 1
    }
}

Write-Host ""
# Install PM2 Windows startup
Write-Host "[2/4] Installing pm2-windows-startup..." -ForegroundColor Yellow
try {
    npm list -g pm2-windows-startup 2>$null
    Write-Host "  - pm2-windows-startup already installed" -ForegroundColor Green
} catch {
    Write-Host "  - pm2-windows-startup not found, installing..." -ForegroundColor Yellow
    npm install -g pm2-windows-startup --registry=$Registry
    pm2-startup install 2>$null
    Write-Host "  - PM2 Windows startup installed" -ForegroundColor Green
}

Write-Host ""
# Install common module dependencies
Write-Host "[3/4] Installing common module dependencies..." -ForegroundColor Yellow
$CommonModules = @("shared-types", "shared-utils", "aws-credentials")
$CommonPath = Join-Path $ScriptDir "common"

if (Test-Path $CommonPath) {
    foreach ($module in $CommonModules) {
        $modulePath = Join-Path $CommonPath $module
        if (Test-Path $modulePath) {
            Write-Host "  - Installing $module..." -ForegroundColor Gray
            Set-Location $modulePath
            if (Test-Path "node_modules") {
                Remove-Item -Path "node_modules" -Recurse -Force
            }
            npm install --omit=dev --registry=$Registry --loglevel=error 2>$null
            Write-Host "    - Done: $module" -ForegroundColor Green
        }
    }
}

Write-Host ""
# Install service dependencies
Write-Host "[4/4] Installing service dependencies..." -ForegroundColor Yellow
$Services = @(
    "api-gateway",
    "user-service",
    "device-service",
    "device-gateway",
    "baby-service",
    "video-service",
    "storage-service",
    "admin-service"
)
foreach ($service in $Services) {
    $servicePath = Join-Path $ScriptDir $service
    if (-not (Test-Path $servicePath)) {
        Write-Host "  Skipping $service (directory not found)" -ForegroundColor DarkYellow
        continue
    }
    Write-Host "  - Installing dependencies for $service..." -ForegroundColor Gray
    Set-Location $servicePath
    if (Test-Path "node_modules") {
        Remove-Item -Path "node_modules" -Recurse -Force
    }

    # Update package.json common module paths from file:../../common/ to file:../common/
    $pkgJsonPath = "package.json"
    if (Test-Path $pkgJsonPath) {
        $pkgJson = Get-Content $pkgJsonPath | ConvertFrom-Json
        $pathUpdated = $false
        if ($pkgJson.dependencies) {
            $deps = $pkgJson.dependencies.PSObject.Properties
            foreach ($dep in $deps) {
                if ($dep.Value -like "file:../../common/*") {
                    $moduleName = $dep.Value -replace "file:../../common/", ""
                    $dep.Value = "file:../common/$moduleName"
                    $pathUpdated = $true
                }
            }
            if ($pathUpdated) {
                $pkgJson | ConvertTo-Json -Depth 10 | Set-Content $pkgJsonPath
                Write-Host "    Updated common module paths" -ForegroundColor DarkGray
            }
        }
    }

    npm install --omit=dev --registry=$Registry --loglevel=error
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    Warning: $service dependency install may have issues" -ForegroundColor DarkYellow
    } else {
        Write-Host "    Done: $service" -ForegroundColor Green
    }
}
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Dependencies Installed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Copy .env.example to .env and configure environment variables" -ForegroundColor White
Write-Host "  2. Run .\start-services.ps1 to start all services" -ForegroundColor White
Write-Host ""
