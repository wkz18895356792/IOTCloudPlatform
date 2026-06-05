<#
.SYNOPSIS
    安装 Node.js 迁换环境

.DESCRIPTION
    此脚本会下载并安装 Node.js 18 LTS

.PARAMETER Version
    指定 Node.js 版本 (默认: 18.19.0)

    - 可以指定具体版本如 "18.17.0" 或 "-x64"
.PARAMETER Arch
    指定架构 (默认: x64)
    - 可以指定安装路径(默认: "C:\Program Files\nodejs")

.EXAMPLE
    .\install-nodejs.ps1
    .\install-nodejs.ps1 -Version "18.20.0"
    .\install-nodejs.ps1 -Arch "x64" -InstallPath "C:\nodejs18"
    .\install-nodejs.ps1 -InstallPath "D:\nodejs" -Version "18.17.0"
#>

param(
    [string]$Version = "18.19.0",
    [string]$Arch = "x64",
    [string]$InstallPath = "C:\nodejs18"
)

