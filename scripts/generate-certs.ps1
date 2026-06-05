#
# TLS 证书生成脚本 (Windows PowerShell)
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts/generate-certs.ps1
#
# 输出目录: certs/
#

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$CertsDir = Join-Path $ProjectRoot "certs"

New-Item -ItemType Directory -Force -Path $CertsDir | Out-Null

$CA_KEY = Join-Path $CertsDir "ca.key"
$CA_CERT = Join-Path $CertsDir "ca.crt"

# ==================== CA 根证书 ====================

if (-not (Test-Path $CA_KEY) -or -not (Test-Path $CA_CERT)) {
    Write-Host "[CA] Generating root CA certificate..."
    $env:MSYS_NO_PATHCONV = "1"
    openssl req -x509 -new -nodes `
        -newkey rsa:4096 `
        -keyout $CA_KEY `
        -out $CA_CERT `
        -days 3650 `
        -subj "//C=CN\ST=Beijing\L=Beijing\O=BabyMonitor\CN=BabyMonitor Root CA" `
        -addext "basicConstraints=critical,CA:TRUE,pathlen:2" `
        -addext "keyUsage=critical,keyCertSign,cRLSign"
    Remove-Item Env:\MSYS_NO_PATHCONV
    Write-Host "[CA] Root CA generated: $CA_CERT"
} else {
    Write-Host "[CA] Root CA already exists, skipping."
}

# ==================== 辅助函数 ====================

function Generate-ServerCert {
    param(
        [string]$Name,
        [string]$Domain
    )

    $Key = Join-Path $CertsDir "$Name.key"
    $Cert = Join-Path $CertsDir "$Name.crt"

    if (Test-Path $Cert) {
        Write-Host "[$Name] Certificate already exists, skipping. Delete $Cert to regenerate."
        return
    }

    Write-Host "[$Name] Generating server certificate for $Domain..."

    # 生成私钥
    openssl genrsa -out $Key 2048

    # 生成 CSR 并用 CA 签发
    $ExtFile = Join-Path $CertsDir "$Name.ext"
    @"
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:$Domain, DNS:localhost, IP:127.0.0.1
"@ | Set-Content -Path $ExtFile

    $env:MSYS_NO_PATHCONV = "1"
    openssl req -new `
        -key $Key `
        -out (Join-Path $CertsDir "$Name.csr") `
        -subj "//C=CN\ST=Beijing\L=Beijing\O=BabyMonitor\CN=$Domain"

    openssl x509 -req `
        -in (Join-Path $CertsDir "$Name.csr") `
        -CA $CA_CERT `
        -CAkey $CA_KEY `
        -CAcreateserial `
        -out $Cert `
        -days 365 `
        -extfile $ExtFile
    Remove-Item Env:\MSYS_NO_PATHCONV

    # 清理临时文件
    Remove-Item (Join-Path $CertsDir "$Name.csr") -ErrorAction SilentlyContinue
    Remove-Item $ExtFile -ErrorAction SilentlyContinue

    Write-Host "[$Name] Certificate generated: $Cert"
}

# ==================== API Gateway 证书 ====================

Generate-ServerCert -Name "api-gateway" -Domain "api.babymonitor.local"

# ==================== EMQX MQTT Broker 证书 ====================

Generate-ServerCert -Name "emqx" -Domain "emqx"

# ==================== 汇总 ====================

Write-Host ""
Write-Host "============================================"
Write-Host "  Certificates generated in: $CertsDir"
Write-Host "============================================"
Write-Host ""
Write-Host "Files:"
Get-ChildItem $CertsDir | Format-Table Name, Length, LastWriteTime
Write-Host ""
Write-Host "Usage (add to .env):"
Write-Host "  API_GATEWAY_SSL_ENABLED=true"
Write-Host "  API_GATEWAY_SSL_KEY_PATH=certs/api-gateway.key"
Write-Host "  API_GATEWAY_SSL_CERT_PATH=certs/api-gateway.crt"
Write-Host "  API_GATEWAY_SSL_CA_PATH=certs/ca.crt"
Write-Host ""
Write-Host "  MQTT_TLS_ENABLED=true"
Write-Host "  MQTT_TLS_CA_PATH=certs/ca.crt"
Write-Host "  EMQX_SSL_ENABLED=true"
