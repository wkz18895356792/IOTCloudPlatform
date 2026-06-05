<#
.SYNOPSIS
    主部署脚本
    将构建好的发布包部署到服务器并执行初始配置

.DESCRIPTION
    此脚本会:
    1. 检查部署环境
    2. 解压发布包到临时目录
    3. 安装 PM2 (如果没有安装)
    4. 配置环境变量
    5. 启动所有服务
    6. 检查服务状态

.PARAMETER SkipEnvCheck
    跳过环境变量检查 (默认: $true)
.PARAMETER SkipStart
    跳过服务启动步骤(默认: $false)
.PARAMETER OnlyServices
    只启动指定服务(逗号分隔)。默认启动所有服务
.PARAMETER SkipInstallDeps
    跳过依赖安装步骤(默认: $false)
.EXAMPLE
    .\deploy.ps1
    .\deploy.ps1
    .\deploy.ps1 -SkipEnvCheck
    .\deploy.ps1 -SkipStart
    .\deploy.ps1 -SkipInstallDeps
    .\deploy.ps1 -OnlyServices "api-gateway", "user-service"
#>

param(
    [switch]$SkipEnvCheck = $true,
    [switch]$SkipStart = $false,
    [string[]]$OnlyServices = @(),
    [switch]$SkipInstallDeps = $false
)
