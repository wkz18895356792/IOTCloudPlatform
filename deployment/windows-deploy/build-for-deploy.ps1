# BabyMonitor Platform Build Script
# Build all microservices for production deployment

param(
    [string[]]$Services = @(),
    [switch]$SkipInstall = $false
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)

# All microservices
$AllServices = @(
    "api-gateway",
    "user-service",
    "device-service",
    "device-gateway",
    "baby-service",
    "video-service",
    "storage-service",
    "admin-service"
)

# Common modules
$CommonModules = @(
    "shared-types",
    "shared-utils",
    "aws-credentials"
)

# Filter services if specified
if ($Services.Count -gt 0) {
    $Services = $Services | Where-Object { $AllServices -contains $_ }
    if ($Services.Count -eq 0) {
        Write-Error "No valid services specified. Valid services: $($AllServices -join ', ')"
        exit 1
    }
} else {
    $Services = $AllServices
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BabyMonitor Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project Root: $ProjectRoot" -ForegroundColor Gray
Write-Host "Services: $($Services -join ', ')" -ForegroundColor Gray
Write-Host ""

Set-Location $ProjectRoot

# Step 1: Clean old build files
Write-Host "[1/5] Cleaning old build files..." -ForegroundColor Yellow
$ReleaseDir = Join-Path $ProjectRoot "release"
if (Test-Path $ReleaseDir) {
    Remove-Item -Path $ReleaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
Write-Host "  - Created release directory" -ForegroundColor Green

# Step 2: Install dependencies
if (-not $SkipInstall) {
    Write-Host "[2/5] Installing dependencies..." -ForegroundColor Yellow
    npm install --registry=https://registry.npmmirror.com
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install root dependencies"
        exit 1
    }

    # Build common modules
    Write-Host "  - Building common modules..." -ForegroundColor Gray
    foreach ($module in $CommonModules) {
        $modulePath = Join-Path $ProjectRoot "common\$module"
        if (Test-Path $modulePath) {
            Write-Host "    - Building $module..." -ForegroundColor Gray
            Set-Location $modulePath
            npm run build 2>$null
        }
    }
    Set-Location $ProjectRoot
    Write-Host "  - Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "[2/5] Skipping dependency installation" -ForegroundColor Yellow
}

# Step 3: Build all services
Write-Host "[3/5] Building microservices..." -ForegroundColor Yellow
$BuildErrors = @()

foreach ($service in $Services) {
    Write-Host "  - Building $service..." -ForegroundColor Gray
    $servicePath = Join-Path $ProjectRoot "services\$service"

    if (-not (Test-Path $servicePath)) {
        Write-Host "    Warning: Service directory not found, skipping" -ForegroundColor DarkYellow
        continue
    }

    Set-Location $servicePath
    $distPath = Join-Path $servicePath "dist"
    if (Test-Path $distPath) {
        Remove-Item -Path $distPath -Recurse -Force
    }

    npm run build 2>$null
    if ($LASTEXITCODE -ne 0) {
        $BuildErrors += $service
        Write-Host "    Error: $service build failed" -ForegroundColor Red
    } else {
        Write-Host "    Done: $service" -ForegroundColor Green
    }
}

Set-Location $ProjectRoot

if ($BuildErrors.Count -gt 0) {
    Write-Host ""
    Write-Host "Warning: Some services failed to build:" -ForegroundColor Red
    foreach ($err in $BuildErrors) {
        Write-Host "  - $err" -ForegroundColor Red
    }
}

# Step 4: Copy build artifacts to release directory
Write-Host "[4/5] Copying build artifacts..." -ForegroundColor Yellow

foreach ($service in $Services) {
    if ($BuildErrors -contains $service) { continue }

    $servicePath = Join-Path $ProjectRoot "services\$service"
    $distPath = Join-Path $servicePath "dist"
    $releaseServicePath = Join-Path $ReleaseDir $service

    if (-not (Test-Path $distPath)) {
        Write-Host "  Warning: $service dist not found, skipping" -ForegroundColor DarkYellow
        continue
    }

    New-Item -ItemType Directory -Path $releaseServicePath -Force | Out-Null
    Copy-Item -Path (Join-Path $servicePath "package.json") -Destination $releaseServicePath

    $lockFile = Join-Path $servicePath "package-lock.json"
    if (Test-Path $lockFile) {
        Copy-Item -Path $lockFile -Destination $releaseServicePath
    }

    Copy-Item -Path $distPath -Destination $releaseServicePath -Recurse

    # 复制 bootstrap.js 入口文件
    $bootstrapFile = Join-Path $servicePath "bootstrap.js"
    if (Test-Path $bootstrapFile) {
        Copy-Item -Path $bootstrapFile -Destination $releaseServicePath
        Write-Host "  - Copied $service (with bootstrap.js)" -ForegroundColor Green
    } else {
        Write-Host "  - Copied $service" -ForegroundColor Green
    }
}

# Copy common modules
Write-Host "  - Copying common modules..." -ForegroundColor Gray
$CommonReleasePath = Join-Path $ReleaseDir "common"
New-Item -ItemType Directory -Path $CommonReleasePath -Force | Out-Null

foreach ($module in $CommonModules) {
    $modulePath = Join-Path $ProjectRoot "common\$module"
    $moduleReleasePath = Join-Path $CommonReleasePath $module

    if (Test-Path $modulePath) {
        New-Item -ItemType Directory -Path $moduleReleasePath -Force | Out-Null
        Copy-Item -Path (Join-Path $modulePath "package.json") -Destination $moduleReleasePath

        $moduleDistPath = Join-Path $modulePath "dist"
        if (Test-Path $moduleDistPath) {
            Copy-Item -Path $moduleDistPath -Destination $moduleReleasePath -Recurse
        }

        $moduleSrcPath = Join-Path $modulePath "src"
        if (Test-Path $moduleSrcPath) {
            Copy-Item -Path $moduleSrcPath -Destination $moduleReleasePath -Recurse
        }

        Write-Host "    - Copied $module" -ForegroundColor Green
    }
}

# Step 5: Copy deployment config files
Write-Host "[5/5] Copying deployment configs..." -ForegroundColor Yellow

$pm2ConfigSrc = Join-Path $ScriptDir "ecosystem.config.js"
if (Test-Path $pm2ConfigSrc) {
    Copy-Item -Path $pm2ConfigSrc -Destination $ReleaseDir
    Write-Host "  - Copied ecosystem.config.js" -ForegroundColor Green
}

$deployScripts = @(
    "install-dependencies.ps1",
    "start-services.ps1",
    "stop-services.ps1",
    "restart-services.ps1",
    "status.ps1",
    "logs.ps1"
)

foreach ($script in $deployScripts) {
    $scriptPath = Join-Path $ScriptDir $script
    if (Test-Path $scriptPath) {
        Copy-Item -Path $scriptPath -Destination $ReleaseDir
        Write-Host "  - Copied $script" -ForegroundColor Green
    }
}

$envExampleSrc = Join-Path $ProjectRoot ".env.example"
if (Test-Path $envExampleSrc) {
    Copy-Item -Path $envExampleSrc -Destination (Join-Path $ReleaseDir ".env.example")
    Write-Host "  - Copied .env.example" -ForegroundColor Green
}

New-Item -ItemType Directory -Path (Join-Path $ReleaseDir "logs") -Force | Out-Null

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Output: $ReleaseDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Run .\package-release.ps1 to create deployment package" -ForegroundColor White
Write-Host "  2. Copy package to server" -ForegroundColor White
Write-Host "  3. Run install-dependencies.ps1 on server" -ForegroundColor White
Write-Host "  4. Configure .env file" -ForegroundColor White
Write-Host "  5. Run start-services.ps1 to start services" -ForegroundColor White
Write-Host ""

if ($BuildErrors.Count -gt 0) {
    exit 1
}
