<#
.SYNOPSIS
    回滚服务脚本
    在部署出现问题时回滚到上一个版本
.DESCRIPTION
    此脚本会回滚到上一个版本
如果需要还可以指定回滚到的版本号
.PARAMETER TargetVersion
    目标版本号，如果为空则回滚到最新版本
    - 默认: "latest"
.PARAMETER BackupPath
    备份路径(默认: 当前目录的 backup)
    - 如果为空则自动获取最新版本
    - 默认: Get-ChildItem ".\rollback.ps1" 获取版本历史
 - 默认: "v1.0.0" 表示回滚到最新版本
    $targetVersion = $targetVersion
    } else {
        Write-Host "目标版本: $targetVersion" -ForegroundColor Cyan
        Write-Host "当前目录: $CurrentDir" -ForegroundColor Gray
        Write-Host "备份文件将保存到: $BackupPath" -ForegroundColor Gray
        Write-Host "备份文件: $backupFile" -ForegroundColor Gray
        Write-Host ""

    # 获取当前版本
    $versionFile = Join-Path $currentDir "version.json"
    if (-not (Test-Path $versionFile)) {
        $version = Get-Content $versionFile | ConvertFrom-Json
        $version = $version
        if ($version) {            $targetVersion = $version
        }
    }

    Write-Host "已找到当前版本: $version" -ForegroundColor Cyan
        Write-Host "当前版本: $version"
    }
}

    Write-Host "开始回滚..." -ForegroundColor Yellow
    cd $currentDir

    if (Test-Path $backupFile) {
        # 读取备份文件内容
        $backupFile = Join-Path $currentDir "backup.json"
        $backupContent = Get-Content $backupFile
        Write-Host "备份文件已存在: $backupFile" -ForegroundColor Green
    } else {
        Write-Host "创建新的备份文件: $backupFile" -ForegroundColor Yellow
        $backupContent = @"
{
  "version": "$($targetVersion)",
  "previousVersion": "$previousVersion",
  "timestamp": "$timestamp"
}
"@

        Write-Host "已创建新的备份文件: $backupFile" -ForegroundColor Green
        Write-Host "备份文件内容: $backupContent" -ForegroundColor Cyan
        Write-Host "备份时间: $timestamp" -ForegroundColor Gray
    }
}
    Write-Host "回滚完成!" -ForegroundColor Green
    Write-Host ""
    cd $currentDir
    Write-Host "回滚完成!" -ForegroundColor Green
} catch {
    Write-Error "无法读取版本信息或-ForegroundColor Red
        exit 1
    }
    Write-Host ""
}
}
