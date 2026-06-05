<#
.SYNOPSIS
    安装基础设施软件（MySQL, Redis, EMQX, Node.js 等)

.DESCRIPTION
    此脚本会安装和配置 BabyMonitor 平台所需的基础设施。
    包括:
    - MySQL 8.0
    - Redis 7
    - EMQX 5.4.0
    - Node.js 18 LTS

.PARAMETER InstallPath
    指定安装路径 (默认: C:\babymonitor)
    - 指定要安装的组件列表(默认: @("mysql", "redis", "emqx", "nodejs")

    - 如果未指定，则安装所有组件

.EXAMPLE
    .\install-infrastructure.ps1
    .\install-infrastructure.ps1 -InstallPath "C:\babymonitor"
    .\install-infrastructure.ps1 -Components @("mysql", "redis", "emqx", "nodejs")

#>

param(
    [string]$InstallPath,
    [string]$Components = @("mysql", "redis", "emqx", "nodejs")
)

