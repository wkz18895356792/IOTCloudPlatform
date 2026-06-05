# BabyMonitor Platform Package Script
# Create deployment package

param(
    [string]$Version = "",
    [switch]$IncludeNodeModules = $false
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$ReleaseDir = Join-Path $ProjectRoot "release"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BabyMonitor Package Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check release directory
if (-not (Test-Path $ReleaseDir)) {
    Write-Error "Release directory not found. Please run build-for-deploy.ps1 first"
    exit 1
}

# Get version
if ([string]::IsNullOrEmpty($Version)) {
    $packageJson = Get-Content (Join-Path $ProjectRoot "package.json") | ConvertFrom-Json
    $Version = $packageJson.version
}
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$PackageName = "babymonitor-release-v$Version-$Timestamp"

Write-Host "Version: $Version" -ForegroundColor Gray
Write-Host "Package: $PackageName" -ForegroundColor Gray
Write-Host ""

# Step 1: Install production dependencies using workspaces
if ($IncludeNodeModules) {
    Write-Host "[1/3] Installing production dependencies..." -ForegroundColor Yellow
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
    $CommonModules = @("shared-types", "shared-utils", "aws-credentials")

    # Update package.json paths for all services
    Write-Host "  Updating package.json paths..." -ForegroundColor Gray
    foreach ($service in $Services) {
        $servicePath = Join-Path $ReleaseDir $service
        if (-not (Test-Path $servicePath)) {
            continue
        }
        $pkgJsonPath = Join-Path $servicePath "package.json"
        if (Test-Path $pkgJsonPath) {
            $pkgJson = Get-Content $pkgJsonPath | ConvertFrom-Json
            $updated = $false
            if ($pkgJson.dependencies) {
                $deps = $pkgJson.dependencies.PSObject.Properties
                foreach ($dep in $deps) {
                    if ($dep.Value -like "file:../../common/*") {
                        $moduleName = $dep.Value -replace "file:../../common/", ""
                        $dep.Value = "file:../common/$moduleName"
                        $updated = $true
                    }
                }
            }
            if ($updated) {
                $pkgJson | ConvertTo-Json -Depth 10 | Set-Content $pkgJsonPath
            }
        }
    }

    # Update common module package.json paths
    Write-Host "  Updating common module paths..." -ForegroundColor Gray
    $sharedUtilsPath = Join-Path $ReleaseDir "common\shared-utils\package.json"
    if (Test-Path $sharedUtilsPath) {
        $pkgJson = Get-Content $sharedUtilsPath | ConvertFrom-Json
        if ($pkgJson.dependencies -and $pkgJson.dependencies."@baby-monitor/shared-types") {
            $pkgJson.dependencies."@baby-monitor/shared-types" = "file:../shared-types"
            $pkgJson | ConvertTo-Json -Depth 10 | Set-Content $sharedUtilsPath
            Write-Host "    - Fixed shared-utils -> shared-types path" -ForegroundColor Green
        }
    }

    # Create root package.json with workspaces
    Write-Host "  Creating workspace configuration..." -ForegroundColor Gray
    $workspacePackage = @{
        name = "babymonitor-release"
        version = $Version
        private = $true
        workspaces = @(
            "api-gateway",
            "user-service",
            "device-service",
            "device-gateway",
            "baby-service",
            "video-service",
            "storage-service",
            "admin-service",
            "common/*"
        )
    }
    $workspacePackage | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $ReleaseDir "package.json")
    Write-Host "    - Created workspace package.json" -ForegroundColor Green

    # Clean existing node_modules
    Write-Host "  Cleaning existing node_modules..." -ForegroundColor Gray
    foreach ($service in $Services) {
        $nmPath = Join-Path $ReleaseDir "$service\node_modules"
        if (Test-Path $nmPath) {
            Remove-Item -Path $nmPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    foreach ($module in $CommonModules) {
        $nmPath = Join-Path $ReleaseDir "common\$module\node_modules"
        if (Test-Path $nmPath) {
            Remove-Item -Path $nmPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    $rootNmPath = Join-Path $ReleaseDir "node_modules"
    if (Test-Path $rootNmPath) {
        Remove-Item -Path $rootNmPath -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Install all dependencies at once using workspaces
    Write-Host "  Installing all dependencies via workspaces..." -ForegroundColor Gray
    Set-Location $ReleaseDir
    npm install --omit=dev --registry=https://registry.npmmirror.com
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    Warning: npm install may have issues" -ForegroundColor DarkYellow
    } else {
        Write-Host "    - All dependencies installed" -ForegroundColor Green
    }

    Set-Location $ReleaseDir
} else {
    Write-Host "[1/3] Skipping dependency installation" -ForegroundColor Yellow

    # Clean up any existing node_modules to avoid long path issues
    Write-Host "  Cleaning up node_modules..." -ForegroundColor Gray
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
        $nmPath = Join-Path $ReleaseDir "$service\node_modules"
        if (Test-Path $nmPath) {
            Write-Host "    Removing $service/node_modules..." -ForegroundColor DarkGray
            Remove-Item -Path $nmPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    # Clean common modules
    $CommonModules = @("shared-types", "shared-utils", "aws-credentials")
    foreach ($module in $CommonModules) {
        $nmPath = Join-Path $ReleaseDir "common\$module\node_modules"
        if (Test-Path $nmPath) {
            Remove-Item -Path $nmPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "  - node_modules cleaned" -ForegroundColor Green
}

# Step 2: Create package directory
Write-Host "[2/3] Creating package..." -ForegroundColor Yellow
$PackageDir = Join-Path $ProjectRoot "dist-packages\$PackageName"
if (Test-Path $PackageDir) {
    Remove-Item -Path $PackageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null

# Copy all files using robocopy (handles long paths)
Write-Host "  - Copying files..." -ForegroundColor Gray
robocopy $ReleaseDir $PackageDir /E /NFL /NDL /NJH /NJS /nc /ns /np 2>$null
if ($LASTEXITCODE -gt 7) {
    Write-Error "Failed to copy files"
    exit 1
}
Write-Host "  - Files copied" -ForegroundColor Green

# Create version info
$versionInfo = @{
    version = $Version
    buildTime = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    services = @(
        "api-gateway",
        "user-service",
        "device-service",
        "device-gateway",
        "baby-service",
        "video-service",
        "storage-service",
        "admin-service"
    )
}
$versionInfo | ConvertTo-Json | Set-Content (Join-Path $PackageDir "version.json")
Write-Host "  - Package directory created" -ForegroundColor Green

# Step 3: Create zip archive
Write-Host "[3/3] Creating zip archive..." -ForegroundColor Yellow
$ZipPath = "$PackageDir.zip"

# Try 7-Zip first (handles long paths)
$7zipPaths = @(
    "C:\Program Files\7-Zip\7z.exe",
    "C:\Program Files (x86)\7-Zip\7z.exe",
    (Get-Command 7z -ErrorAction SilentlyContinue).Source
)
$7zip = $7zipPaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($7zip) {
    Write-Host "  - Using 7-Zip..." -ForegroundColor Gray
    & $7zip a -tzip "$ZipPath" "$PackageDir\*" -mx=5 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  - 7-Zip compression complete" -ForegroundColor Green
    } else {
        Write-Host "  - 7-Zip failed, trying PowerShell..." -ForegroundColor Yellow
        $7zip = $null
    }
}

if (-not $7zip -or $LASTEXITCODE -ne 0) {
    # Use PowerShell Compress-Archive
    try {
        Compress-Archive -Path "$PackageDir\*" -DestinationPath $ZipPath -CompressionLevel Optimal -Force
        Write-Host "  - PowerShell compression complete" -ForegroundColor Green
    } catch {
        Write-Error "Failed to create zip archive: $_"
        Write-Host "Tip: Install 7-Zip to handle long file paths" -ForegroundColor Yellow
        Write-Host "Download: https://www.7-zip.org/" -ForegroundColor Yellow
        exit 1
    }
}

if (Test-Path $ZipPath) {
    $ZipSize = (Get-Item $ZipPath).Length / 1MB
    Write-Host "  - Created: $([math]::Round($ZipSize, 2)) MB" -ForegroundColor Green
} else {
    Write-Error "Failed to create zip archive"
    exit 1
}
 Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Package Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Package location: $ZipPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Copy $ZipPath to server" -ForegroundColor White
Write-Host "  2. Extract to deployment directory (e.g., C:\babymonitor)" -ForegroundColor White
 Write-Host "  3. Copy .env.example to .env and configure" -ForegroundColor White
Write-Host "  4. Run install-dependencies.ps1" -ForegroundColor White
Write-Host "  5. Run start-services.ps1" -ForegroundColor White
Write-Host ""
