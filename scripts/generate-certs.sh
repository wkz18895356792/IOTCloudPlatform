#!/bin/bash
#
# TLS 证书生成脚本
#
# 为开发和内部环境生成自签名 TLS 证书：
#   - CA 根证书
#   - API Gateway 服务器证书
#   - EMQX MQTT Broker 服务器证书
#
# 用法:
#   bash scripts/generate-certs.sh
#
# 输出目录: certs/
#
# 生产环境请替换为正式 CA 签发的证书。

set -euo pipefail

# Windows Git Bash 下禁用路径转换（/C=CN 不被转为 C:\Git\C=CN）
export MSYS_NO_PATHCONV=1

CERTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$CERTS_DIR"

CA_KEY="$CERTS_DIR/ca.key"
CA_CERT="$CERTS_DIR/ca.crt"

# ==================== CA 根证书 ====================

if [ ! -f "$CA_KEY" ] || [ ! -f "$CA_CERT" ]; then
  echo "[CA] Generating root CA certificate..."
  openssl req -x509 -new -nodes \
    -newkey rsa:4096 \
    -keyout "$CA_KEY" \
    -out "$CA_CERT" \
    -days 3650 \
    -subj "/C=CN/ST=Beijing/L=Beijing/O=BabyMonitor/CN=BabyMonitor Root CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:2" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  echo "[CA] Root CA generated: $CA_CERT"
else
  echo "[CA] Root CA already exists, skipping."
fi

# ==================== 辅助函数 ====================

generate_server_cert() {
  local name=$1
  local domain=$2
  local key="$CERTS_DIR/${name}.key"
  local csr="$CERTS_DIR/${name}.csr"
  local cert="$CERTS_DIR/${name}.crt"

  if [ -f "$cert" ]; then
    echo "[$name] Certificate already exists, skipping. Delete $cert to regenerate."
    return 0
  fi

  echo "[$name] Generating server certificate for $domain..."

  # 生成私钥
  openssl genrsa -out "$key" 2048

  # 生成 CSR（含 SAN）
  openssl req -new \
    -key "$key" \
    -out "$csr" \
    -subj "/C=CN/ST=Beijing/L=Beijing/O=BabyMonitor/CN=$domain" \
    -addext "subjectAltName=DNS:$domain,DNS:localhost,IP:127.0.0.1"

  # 用 CA 签发
  openssl x509 -req \
    -in "$csr" \
    -CA "$CA_CERT" \
    -CAkey "$CA_KEY" \
    -CAcreateserial \
    -out "$cert" \
    -days 365 \
    -extfile <(cat <<EOF
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:$domain, DNS:localhost, IP:127.0.0.1
EOF
)

  # 清理 CSR
  rm -f "$csr"

  echo "[$name] Certificate generated: $cert"
}

# ==================== API Gateway 证书 ====================

generate_server_cert "api-gateway" "api.babymonitor.local"

# ==================== EMQX MQTT Broker 证书 ====================

generate_server_cert "emqx" "emqx"

# ==================== 汇总 ====================

echo ""
echo "============================================"
echo "  Certificates generated in: $CERTS_DIR"
echo "============================================"
echo ""
echo "Files:"
ls -la "$CERTS_DIR"
echo ""
echo "Usage:"
echo "  API Gateway SSL:"
echo "    API_GATEWAY_SSL_ENABLED=true"
echo "    API_GATEWAY_SSL_KEY_PATH=$CERTS_DIR/api-gateway.key"
echo "    API_GATEWAY_SSL_CERT_PATH=$CERTS_DIR/api-gateway.crt"
echo "    API_GATEWAY_SSL_CA_PATH=$CERTS_DIR/ca.crt"
echo ""
echo "  MQTT TLS:"
echo "    MQTT_TLS_ENABLED=true"
echo "    MQTT_TLS_CA_PATH=$CERTS_DIR/ca.crt"
echo "    MQTT_TLS_KEY_PATH=$CERTS_DIR/emqx.key"
echo "    MQTT_TLS_CERT_PATH=$CERTS_DIR/emqx.crt"
echo "    MQTT_TLS_REJECT_UNAUTHORIZED=false"
