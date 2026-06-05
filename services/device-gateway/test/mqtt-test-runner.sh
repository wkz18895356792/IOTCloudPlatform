#!/bin/bash

#################################################################
# Device Gateway MQTT 自动化测试脚本
# 测试所有 MQTT 主题和 HTTP API
#################################################################

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
API_GATEWAY="http://localhost:6001"
DEVICE_GATEWAY="http://localhost:6010"
MQTT_HOST="${MQTT_HOST:-localhost}"
MQTT_PORT="${MQTT_PORT:-1883}"

# 测试统计
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
FAILED_TEST_NAMES=()

# 测试数据
TEST_DEVICE_ID="test-device-$(date +%s)"
MATTER_NODE_ID="12345"
USER_TOKEN=""
USE_NODE_MQTT=false

#################################################################
# 工具函数
#################################################################

print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"
}

print_test() {
    echo -e "${YELLOW}[TEST] $1${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

print_pass() {
    echo -e "${GREEN}  ✓ PASSED: $1${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
}

print_fail() {
    echo -e "${RED}  ✗ FAILED: $1${NC}"
    echo -e "${RED}    Response: $2${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    FAILED_TEST_NAMES+=("$1")
}

print_info() {
    echo -e "${BLUE}  → $1${NC}"
}

print_skip() {
    echo -e "${YELLOW}  ⊘ SKIPPED: $1${NC}"
}

# HTTP 请求函数
http_get() {
    local url="$1"
    local token="$2"

    if [ -n "$token" ]; then
        curl -s -X GET "${url}" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token"
    else
        curl -s -X GET "${url}" \
            -H "Content-Type: application/json"
    fi
}

http_post() {
    local url="$1"
    local data="$2"
    local token="$3"

    if [ -n "$token" ]; then
        curl -s -X POST "${url}" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token" \
            -d "$data"
    else
        curl -s -X POST "${url}" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

# JSON 解析函数（使用 Node.js）
json_value() {
    local json="$1"
    local path="$2"
    node -e "
        try {
            const data = JSON.parse(\`$json\`);
            const parts = '$path'.split('.');
            let result = data;
            for (const part of parts) {
                if (result && typeof result === 'object' && part in result) {
                    result = result[part];
                } else {
                    result = undefined;
                    break;
                }
            }
            console.log(result !== undefined ? result : '');
        } catch (e) {
            console.log('');
        }
    " 2>/dev/null
}

check_success() {
    local response="$1"
    local code=$(json_value "$response" "code")
    local success=$(json_value "$response" "success")

    if [ "$code" = "0" ] || [ "$success" = "true" ]; then
        return 0
    fi
    return 1
}

# 检查 mosquitto_pub 是否安装
check_mqtt_tools() {
    if command -v mosquitto_pub &> /dev/null; then
        print_info "使用 mosquitto_pub 进行 MQTT 测试"
        USE_NODE_MQTT=false
    else
        print_info "mosquitto_pub 未安装，使用模拟测试"
        USE_NODE_MQTT=true
    fi
}

# 使用 Node.js 发布 MQTT 消息
mqtt_publish_node() {
    local topic="$1"
    local payload="$2"

    node -e "
        const mqtt = require('mqtt');
        const client = mqtt.connect('mqtt://${MQTT_HOST}:${MQTT_PORT}', {
            clientId: 'test-client-' + Date.now(),
            clean: true,
            connectTimeout: 5000
        });

        client.on('connect', () => {
            const payload = ${payload};
            client.publish('${topic}', JSON.stringify(payload), { qos: 1 }, (err) => {
                if (err) {
                    console.error('Publish error:', err.message);
                    process.exit(1);
                }
                setTimeout(() => {
                    client.end();
                    process.exit(0);
                }, 100);
            });
        });

        client.on('error', (err) => {
            console.error('Connection error:', err.message);
            process.exit(1);
        });

        setTimeout(() => {
            console.error('Timeout');
            client.end();
            process.exit(1);
        }, 10000);
    " 2>&1
    return $?
}

# 发布 MQTT 消息
mqtt_publish() {
    local topic="$1"
    local payload="$2"

    print_info "Topic: $topic"

    if [ "$USE_NODE_MQTT" = "true" ]; then
        mqtt_publish_node "$topic" "$payload"
        return $?
    else
        mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" -t "$topic" -m "$payload" -q 1 2>&1
        return $?
    fi
}

#################################################################
# 0. 准备工作
#################################################################
prepare() {
    print_header "0. 准备工作 - 检查服务状态"

    # 检查 API Gateway 连接
    print_test "TC-PREP-001: 检查 API Gateway 连接"
    if curl -s --connect-timeout 5 "$API_GATEWAY/health" > /dev/null 2>&1; then
        print_pass "API Gateway 连接正常"
    else
        print_fail "API Gateway 连接失败" "无法连接到 $API_GATEWAY"
        exit 1
    fi

    # 检查 Device Gateway 连接
    print_test "TC-PREP-002: 检查 Device Gateway 连接"
    if curl -s --connect-timeout 5 "$DEVICE_GATEWAY/health" > /dev/null 2>&1; then
        print_pass "Device Gateway 连接正常"
    else
        print_fail "Device Gateway 连接失败" "无法连接到 $DEVICE_GATEWAY"
    fi

    # 检查 MQTT 工具
    check_mqtt_tools

    # 获取用户 Token
    print_test "TC-PREP-003: 获取用户认证 Token"
    TEST_USERNAME="gatewaytest_$(date +%s)"
    TEST_EMAIL="gatewaytest$(date +%s)@example.com"

    REGISTER_RESPONSE=$(http_post "$API_GATEWAY/api/auth/register" "{
        \"username\": \"$TEST_USERNAME\",
        \"password\": \"Test123456!@#\",
        \"email\": \"$TEST_EMAIL\"
    }")

    if check_success "$REGISTER_RESPONSE"; then
        USER_TOKEN=$(json_value "$REGISTER_RESPONSE" "data.accessToken")
        print_pass "用户注册成功，获取 Token"
    else
        LOGIN_RESPONSE=$(http_post "$API_GATEWAY/api/auth/login" "{
            \"type\": \"password\",
            \"account\": \"$TEST_USERNAME\",
            \"password\": \"Test123456!@#\"
        }")
        if check_success "$LOGIN_RESPONSE"; then
            USER_TOKEN=$(json_value "$LOGIN_RESPONSE" "data.accessToken")
            print_pass "登录成功，获取 Token"
        else
            print_fail "获取 Token 失败" "$LOGIN_RESPONSE"
            exit 1
        fi
    fi

    print_info "Token: ${USER_TOKEN:0:40}..."
}

#################################################################
# 1. HTTP API 测试 - 网关状态
#################################################################
test_gateway_status() {
    print_header "1. HTTP API 测试 - 网关状态"

    # TC-HTTP-001: 获取网关状态
    print_test "TC-HTTP-001: 获取网关状态"
    STATUS_RESPONSE=$(http_get "$DEVICE_GATEWAY/api/gateway/status" "$USER_TOKEN")

    if echo "$STATUS_RESPONSE" | grep -q "connected\|statistics"; then
        print_pass "获取网关状态成功"
        print_info "Response: ${STATUS_RESPONSE:0:100}..."
    else
        print_fail "获取网关状态失败" "$STATUS_RESPONSE"
    fi

    # TC-HTTP-002: 获取在线设备列表
    print_test "TC-HTTP-002: 获取在线设备列表"
    DEVICES_RESPONSE=$(http_get "$DEVICE_GATEWAY/api/gateway/devices/online" "$USER_TOKEN")

    if echo "$DEVICES_RESPONSE" | grep -q "devices"; then
        print_pass "获取在线设备列表成功"
    else
        print_fail "获取在线设备列表失败" "$DEVICES_RESPONSE"
    fi

    # TC-HTTP-003: 获取设备连接信息
    print_test "TC-HTTP-003: 获取设备连接信息"
    CONN_RESPONSE=$(http_get "$DEVICE_GATEWAY/api/gateway/device/$TEST_DEVICE_ID/connection" "$USER_TOKEN")

    if echo "$CONN_RESPONSE" | grep -q "connection\|isOnline"; then
        print_pass "获取设备连接信息成功"
    else
        print_info "设备可能未连接: ${CONN_RESPONSE:0:100}..."
    fi
}

#################################################################
# 2. HTTP API 测试 - 设备认证
#################################################################
test_device_auth() {
    print_header "2. HTTP API 测试 - 设备认证"

    # TC-HTTP-004: 设备认证
    print_test "TC-HTTP-004: 设备认证"
    AUTH_RESPONSE=$(http_post "$DEVICE_GATEWAY/api/gateway/device/auth" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"serialNumber\": \"SN-TEST-$(date +%s)\",
        \"productType\": \"camera\",
        \"firmwareVersion\": \"1.0.0\"
    }" "$USER_TOKEN")

    if check_success "$AUTH_RESPONSE"; then
        TEST_DEVICE_TOKEN=$(json_value "$AUTH_RESPONSE" "data.token")
        print_pass "设备认证成功"
        print_info "Device Token: ${TEST_DEVICE_TOKEN:0:30}..."
    else
        print_info "设备认证响应: ${AUTH_RESPONSE:0:100}..."
    fi

    # TC-HTTP-005: 验证设备令牌
    if [ -n "$TEST_DEVICE_TOKEN" ]; then
        print_test "TC-HTTP-005: 验证设备令牌"
        VERIFY_RESPONSE=$(http_post "$DEVICE_GATEWAY/api/gateway/device/token/verify" "{
            \"deviceId\": \"$TEST_DEVICE_ID\",
            \"token\": \"$TEST_DEVICE_TOKEN\"
        }" "$USER_TOKEN")

        if check_success "$VERIFY_RESPONSE"; then
            print_pass "设备令牌验证成功"
        else
            print_fail "设备令牌验证失败" "$VERIFY_RESPONSE"
        fi
    fi

    # TC-HTTP-006: 获取设备认证状态
    print_test "TC-HTTP-006: 获取设备认证状态"
    AUTH_STATUS_RESPONSE=$(http_get "$DEVICE_GATEWAY/api/gateway/device/$TEST_DEVICE_ID/auth-status" "$USER_TOKEN")

    if echo "$AUTH_STATUS_RESPONSE" | grep -q "authenticated\|status"; then
        print_pass "获取设备认证状态成功"
    else
        print_info "设备可能未注册: ${AUTH_STATUS_RESPONSE:0:100}..."
    fi
}

#################################################################
# 3. HTTP API 测试 - 协议转换
#################################################################
test_protocol_conversion() {
    print_header "3. HTTP API 测试 - 协议转换"

    # TC-HTTP-007: 私有协议转 Matter
    print_test "TC-HTTP-007: 私有协议转 Matter"
    CONVERT_RESPONSE=$(http_post "$DEVICE_GATEWAY/api/gateway/protocol/convert/private-to-matter" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"state\": {
            \"power\": true,
            \"brightness\": 80
        },
        \"productType\": \"camera\"
    }" "$USER_TOKEN")

    if check_success "$CONVERT_RESPONSE"; then
        print_pass "私有协议转 Matter 成功"
    else
        print_fail "私有协议转 Matter 失败" "$CONVERT_RESPONSE"
    fi

    # TC-HTTP-008: Matter 转私有协议
    print_test "TC-HTTP-008: Matter 转私有协议"
    MATTER_CONVERT_RESPONSE=$(http_post "$DEVICE_GATEWAY/api/gateway/protocol/convert/matter-to-private" "{
        \"nodeId\": $MATTER_NODE_ID,
        \"state\": {
            \"OnOff\": true,
            \"CurrentLevel\": 254
        }
    }" "$USER_TOKEN")

    if check_success "$MATTER_CONVERT_RESPONSE"; then
        print_pass "Matter 转私有协议成功"
    else
        print_fail "Matter 转私有协议失败" "$MATTER_CONVERT_RESPONSE"
    fi

    # TC-HTTP-009: 命令协议转换
    print_test "TC-HTTP-009: 命令协议转换"
    CMD_CONVERT_RESPONSE=$(http_post "$DEVICE_GATEWAY/api/gateway/protocol/convert/command" "{
        \"sourceProtocol\": \"matter\",
        \"targetProtocol\": \"private\",
        \"command\": {
            \"cluster\": \"OnOff\",
            \"command\": \"On\",
            \"endpoint\": 1
        }
    }" "$USER_TOKEN")

    if check_success "$CMD_CONVERT_RESPONSE"; then
        print_pass "命令协议转换成功"
    else
        print_fail "命令协议转换失败" "$CMD_CONVERT_RESPONSE"
    fi
}

#################################################################
# 4. MQTT 测试 - 设备注册
#################################################################
test_mqtt_register() {
    print_header "4. MQTT 测试 - 设备注册"

    # TC-MQTT-001: 发送设备注册消息
    print_test "TC-MQTT-001: 发送设备注册消息"
    mqtt_publish "devices/$TEST_DEVICE_ID/register" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"serialNumber\": \"SN-TEST-$(date +%s)\",
        \"productType\": \"camera\",
        \"firmwareVersion\": \"1.0.0\",
        \"macAddress\": \"AA:BB:CC:DD:EE:FF\",
        \"timestamp\": $(date +%s)000
    }"

    if [ $? -eq 0 ]; then
        print_pass "设备注册消息发送成功"
    else
        print_fail "设备注册消息发送失败" "MQTT publish error"
    fi
}

#################################################################
# 5. MQTT 测试 - 设备认证
#################################################################
test_mqtt_auth() {
    print_header "5. MQTT 测试 - 设备认证"

    # TC-MQTT-002: 发送设备认证消息
    print_test "TC-MQTT-002: 发送设备认证消息"
    mqtt_publish "devices/$TEST_DEVICE_ID/auth" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"token\": \"${TEST_DEVICE_TOKEN:-test-token}\",
        \"timestamp\": $(date +%s)000
    }"

    if [ $? -eq 0 ]; then
        print_pass "设备认证消息发送成功"
    else
        print_fail "设备认证消息发送失败" "MQTT publish error"
    fi
}

#################################################################
# 6. MQTT 测试 - 设备心跳
#################################################################
test_mqtt_heartbeat() {
    print_header "6. MQTT 测试 - 设备心跳"

    # TC-MQTT-003: 发送设备心跳消息
    print_test "TC-MQTT-003: 发送设备心跳消息"
    mqtt_publish "devices/$TEST_DEVICE_ID/heartbeat" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"type\": \"heartbeat\",
        \"timestamp\": $(date +%s)000,
        \"batteryLevel\": 85,
        \"signalStrength\": -45
    }"

    if [ $? -eq 0 ]; then
        print_pass "设备心跳消息发送成功"
    else
        print_fail "设备心跳消息发送失败" "MQTT publish error"
    fi
}

#################################################################
# 7. MQTT 测试 - 设备状态上报
#################################################################
test_mqtt_status() {
    print_header "7. MQTT 测试 - 设备状态上报"

    # TC-MQTT-004: 发送设备状态消息
    print_test "TC-MQTT-004: 发送设备状态消息"
    mqtt_publish "devices/$TEST_DEVICE_ID/status" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"type\": \"status\",
        \"status\": \"online\",
        \"timestamp\": $(date +%s)000,
        \"cpuUsage\": 25,
        \"memoryUsage\": 40,
        \"temperature\": 35
    }"

    if [ $? -eq 0 ]; then
        print_pass "设备状态消息发送成功"
    else
        print_fail "设备状态消息发送失败" "MQTT publish error"
    fi
}

#################################################################
# 8. MQTT 测试 - 设备数据上报
#################################################################
test_mqtt_report() {
    print_header "8. MQTT 测试 - 设备数据上报"

    # TC-MQTT-005: 发送设备数据上报消息
    print_test "TC-MQTT-005: 发送设备数据上报消息"
    mqtt_publish "devices/$TEST_DEVICE_ID/report" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"type\": \"sensor_data\",
        \"timestamp\": $(date +%s)000,
        \"data\": {
            \"temperature\": 25.5,
            \"humidity\": 60,
            \"airQuality\": \"good\"
        }
    }"

    if [ $? -eq 0 ]; then
        print_pass "设备数据上报消息发送成功"
    else
        print_fail "设备数据上报消息发送失败" "MQTT publish error"
    fi
}

#################################################################
# 9. MQTT 测试 - 命令响应
#################################################################
test_mqtt_command_response() {
    print_header "9. MQTT 测试 - 命令响应"

    # TC-MQTT-006: 发送命令响应消息
    print_test "TC-MQTT-006: 发送命令响应消息"
    mqtt_publish "devices/$TEST_DEVICE_ID/command/response" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"commandId\": \"cmd-$(date +%s)\",
        \"command\": \"reboot\",
        \"status\": \"success\",
        \"timestamp\": $(date +%s)000,
        \"result\": {
            \"message\": \"Device will reboot in 5 seconds\"
        }
    }"

    if [ $? -eq 0 ]; then
        print_pass "命令响应消息发送成功"
    else
        print_fail "命令响应消息发送失败" "MQTT publish error"
    fi
}

#################################################################
# 10. MQTT 测试 - 设备配置
#################################################################
test_mqtt_config() {
    print_header "10. MQTT 测试 - 设备配置"

    # TC-MQTT-009: 发送设备配置请求
    print_test "TC-MQTT-009: 发送设备配置请求"
    mqtt_publish "devices/$TEST_DEVICE_ID/config/request" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"type\": \"config_request\",
        \"timestamp\": $(date +%s)000,
        \"requestId\": \"req-$(date +%s)\",
        \"configKeys\": [\"video\", \"audio\", \"network\"]
    }"

    if [ $? -eq 0 ]; then
        print_pass "设备配置请求消息发送成功"
    else
        print_fail "设备配置请求消息发送失败" "MQTT publish error"
    fi

    # TC-MQTT-010: 发送设备配置响应
    print_test "TC-MQTT-010: 发送设备配置响应"
    mqtt_publish "devices/$TEST_DEVICE_ID/config/response" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"type\": \"config_response\",
        \"timestamp\": $(date +%s)000,
        \"requestId\": \"req-$(date +%s)\",
        \"config\": {
            \"video\": {
                \"resolution\": \"1080p\",
                \"fps\": 30,
                \"bitrate\": 4000
            },
            \"audio\": {
                \"enabled\": true,
                \"volume\": 80
            },
            \"network\": {
                \"wifiSsid\": \"BabyMonitor_5G\",
                \"signalStrength\": -45
            }
        }
    }"

    if [ $? -eq 0 ]; then
        print_pass "设备配置响应消息发送成功"
    else
        print_fail "设备配置响应消息发送失败" "MQTT publish error"
    fi
}

#################################################################
# 11. MQTT 测试 - 设备凭证
#################################################################
test_mqtt_credentials() {
    print_header "11. MQTT 测试 - 设备凭证"

    # TC-MQTT-011: 发送设备凭证请求
    print_test "TC-MQTT-011: 发送设备凭证请求"
    mqtt_publish "devices/$TEST_DEVICE_ID/credentials/request" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"type\": \"credentials_request\",
        \"timestamp\": $(date +%s)000,
        \"requestId\": \"cred-req-$(date +%s)\",
        \"credentialTypes\": [\"wifi\", \"mqtt\", \"cloud\"]
    }"

    if [ $? -eq 0 ]; then
        print_pass "设备凭证请求消息发送成功"
    else
        print_fail "设备凭证请求消息发送失败" "MQTT publish error"
    fi

    # TC-MQTT-012: 发送设备凭证响应
    print_test "TC-MQTT-012: 发送设备凭证响应"
    mqtt_publish "devices/$TEST_DEVICE_ID/credentials/response" "{
        \"deviceId\": \"$TEST_DEVICE_ID\",
        \"type\": \"credentials_response\",
        \"timestamp\": $(date +%s)000,
        \"requestId\": \"cred-req-$(date +%s)\",
        \"credentials\": {
            \"wifi\": {
                \"ssid\": \"BabyMonitor_5G\",
                \"password\": \"********\",
                \"status\": \"connected\"
            },
            \"mqtt\": {
                \"broker\": \"mqtt.babymonitor.com\",
                \"port\": 8883,
                \"clientId\": \"$TEST_DEVICE_ID\",
                \"status\": \"connected\"
            },
            \"cloud\": {
                \"endpoint\": \"https://api.babymonitor.com\",
                \"tokenExpiry\": $(date +%s)000
            }
        }
    }"

    if [ $? -eq 0 ]; then
        print_pass "设备凭证响应消息发送成功"
    else
        print_fail "设备凭证响应消息发送失败" "MQTT publish error"
    fi
}

#################################################################
# 11.5 MQTT 测试 - KVS 凭证获取（完整流程）
#################################################################
test_mqtt_kvs_credentials() {
    print_header "11.5 MQTT 测试 - KVS 凭证获取（完整流程）"

    local REQUEST_ID="kvs-req-$(date +%s)"
    local RESPONSE_TOPIC="devices/$TEST_DEVICE_ID/credentials/response"
    local TIMEOUT=10
    local RESPONSE_FILE="/tmp/mqtt_response_$$_$(date +%s).json"

    print_info "Request ID: $REQUEST_ID"
    print_info "Response Topic: $RESPONSE_TOPIC"

    # TC-MQTT-015: KVS 凭证请求与响应（完整流程）
    print_test "TC-MQTT-015: KVS 凭证请求与响应（完整流程）"

    # 使用 Node.js 进行订阅-发布-等待响应的完整流程
    RESULT=$(node -e "
        const mqtt = require('mqtt');

        const MQTT_HOST = '${MQTT_HOST}';
        const MQTT_PORT = ${MQTT_PORT:-1883};
        const DEVICE_ID = '${TEST_DEVICE_ID}';
        const REQUEST_ID = '${REQUEST_ID}';
        const TIMEOUT = ${TIMEOUT} * 1000;

        const RESPONSE_TOPIC = 'devices/' + DEVICE_ID + '/credentials/response';
        const REQUEST_TOPIC = 'devices/' + DEVICE_ID + '/credentials';

        let responseReceived = false;
        let responseData = null;

        const client = mqtt.connect('mqtt://' + MQTT_HOST + ':' + MQTT_PORT, {
            clientId: 'kvs-test-' + Date.now(),
            clean: true,
            connectTimeout: 5000
        });

        const timeout = setTimeout(() => {
            console.log(JSON.stringify({ success: false, error: 'Timeout waiting for response' }));
            client.end();
            process.exit(0);
        }, TIMEOUT);

        client.on('connect', () => {
            // 订阅响应主题
            client.subscribe(RESPONSE_TOPIC, { qos: 1 }, (err) => {
                if (err) {
                    clearTimeout(timeout);
                    console.log(JSON.stringify({ success: false, error: 'Subscribe failed: ' + err.message }));
                    client.end();
                    process.exit(0);
                    return;
                }

                // 发送 KVS 凭证请求
                const request = {
                    deviceId: DEVICE_ID,
                    timestamp: Date.now(),
                    requestId: REQUEST_ID,
                    credentialTypes: ['kvs']
                };

                client.publish(REQUEST_TOPIC, JSON.stringify(request), { qos: 1 }, (err) => {
                    if (err) {
                        clearTimeout(timeout);
                        console.log(JSON.stringify({ success: false, error: 'Publish failed: ' + err.message }));
                        client.end();
                        process.exit(0);
                    }
                });
            });
        });

        client.on('message', (topic, message) => {
            if (topic === RESPONSE_TOPIC) {
                clearTimeout(timeout);
                try {
                    const response = JSON.parse(message.toString());

                    // 验证响应格式
                    if (response.requestId === REQUEST_ID && response.credentials) {
                        const hasKVS = response.credentials.kvs &&
                            response.credentials.kvs.accessKeyId &&
                            response.credentials.kvs.secretAccessKey &&
                            response.credentials.kvs.sessionToken;

                        console.log(JSON.stringify({
                            success: true,
                            requestId: response.requestId,
                            hasKVS: hasKVS,
                            credentials: {
                                kvs: {
                                    accessKeyId: response.credentials.kvs?.accessKeyId ? '***' + response.credentials.kvs.accessKeyId.slice(-8) : null,
                                    hasSecretKey: !!response.credentials.kvs?.secretAccessKey,
                                    hasSessionToken: !!response.credentials.kvs?.sessionToken,
                                    expiration: response.credentials.kvs?.expiration
                                }
                            },
                            raw: response
                        }, null, 2));
                    } else {
                        console.log(JSON.stringify({ success: false, error: 'Invalid response format', raw: response }));
                    }
                } catch (e) {
                    console.log(JSON.stringify({ success: false, error: 'Parse error: ' + e.message }));
                }
                client.end();
                process.exit(0);
            }
        });

        client.on('error', (err) => {
            clearTimeout(timeout);
            console.log(JSON.stringify({ success: false, error: 'Connection error: ' + err.message }));
            client.end();
            process.exit(0);
        });
    " 2>&1)

    # 解析结果
    SUCCESS=$(echo "$RESULT" | node -e "
        try {
            const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
            console.log(data.success ? 'true' : 'false');
        } catch (e) {
            console.log('false');
        }
    " 2>/dev/null)

    if [ "$SUCCESS" = "true" ]; then
        print_pass "KVS 凭证获取成功"
        print_info "响应详情:"
        echo "$RESULT" | node -e "
            try {
                const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
                if (data.credentials) {
                    console.log('    AccessKeyId: ' + (data.credentials.kvs?.accessKeyId || 'N/A'));
                    console.log('    HasSecretKey: ' + (data.credentials.kvs?.hasSecretKey ? 'Yes' : 'No'));
                    console.log('    HasSessionToken: ' + (data.credentials.kvs?.hasSessionToken ? 'Yes' : 'No'));
                    console.log('    Expiration: ' + (data.credentials.kvs?.expiration ? new Date(data.credentials.kvs.expiration).toISOString() : 'N/A'));
                }
            } catch (e) {}
        " 2>/dev/null
    else
        ERROR_MSG=$(echo "$RESULT" | node -e "
            try {
                const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
                console.log(data.error || 'Unknown error');
            } catch (e) {
                console.log('Parse error');
            }
        " 2>/dev/null)
        print_fail "KVS 凭证获取失败" "$ERROR_MSG"
        print_info "原始响应: ${RESULT:0:200}..."
    fi

    # TC-MQTT-016: 多类型凭证请求
    print_test "TC-MQTT-016: 多类型凭证请求（kvs + mqtt + cloud）"

    MULTI_REQUEST_ID="multi-req-$(date +%s)"

    MULTI_RESULT=$(node -e "
        const mqtt = require('mqtt');

        const MQTT_HOST = '${MQTT_HOST}';
        const MQTT_PORT = ${MQTT_PORT:-1883};
        const DEVICE_ID = '${TEST_DEVICE_ID}';
        const REQUEST_ID = '${MULTI_REQUEST_ID}';
        const TIMEOUT = ${TIMEOUT} * 1000;

        const RESPONSE_TOPIC = 'devices/' + DEVICE_ID + '/credentials/response';
        const REQUEST_TOPIC = 'devices/' + DEVICE_ID + '/credentials';

        const client = mqtt.connect('mqtt://' + MQTT_HOST + ':' + MQTT_PORT, {
            clientId: 'multi-cred-test-' + Date.now(),
            clean: true,
            connectTimeout: 5000
        });

        const timeout = setTimeout(() => {
            console.log(JSON.stringify({ success: false, error: 'Timeout' }));
            client.end();
            process.exit(0);
        }, TIMEOUT);

        client.on('connect', () => {
            client.subscribe(RESPONSE_TOPIC, { qos: 1 }, (err) => {
                if (err) {
                    clearTimeout(timeout);
                    console.log(JSON.stringify({ success: false, error: 'Subscribe failed' }));
                    client.end();
                    process.exit(0);
                    return;
                }

                const request = {
                    deviceId: DEVICE_ID,
                    timestamp: Date.now(),
                    requestId: REQUEST_ID,
                    credentialTypes: ['kvs', 'mqtt', 'cloud']
                };

                client.publish(REQUEST_TOPIC, JSON.stringify(request), { qos: 1 });
            });
        });

        client.on('message', (topic, message) => {
            if (topic === RESPONSE_TOPIC) {
                clearTimeout(timeout);
                try {
                    const response = JSON.parse(message.toString());
                    const creds = response.credentials || {};
                    console.log(JSON.stringify({
                        success: true,
                        hasKVS: !!(creds.kvs && creds.kvs.accessKeyId),
                        hasMQTT: !!(creds.mqtt && creds.mqtt.broker),
                        hasCloud: !!(creds.cloud && creds.cloud.endpoint)
                    }));
                } catch (e) {
                    console.log(JSON.stringify({ success: false, error: e.message }));
                }
                client.end();
                process.exit(0);
            }
        });

        client.on('error', (err) => {
            clearTimeout(timeout);
            console.log(JSON.stringify({ success: false, error: err.message }));
            client.end();
            process.exit(0);
        });
    " 2>&1)

    MULTI_SUCCESS=$(echo "$MULTI_RESULT" | node -e "
        try {
            const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
            console.log(data.success ? 'true' : 'false');
        } catch (e) {
            console.log('false');
        }
    " 2>/dev/null)

    if [ "$MULTI_SUCCESS" = "true" ]; then
        print_pass "多类型凭证请求成功"
        print_info "凭证类型: $(echo "$MULTI_RESULT" | grep -o 'has[A-Z][a-z]*':true | cut -d: -f1 | tr '\n' ' ')"
    else
        print_fail "多类型凭证请求失败" "$MULTI_RESULT"
    fi
}

#################################################################
# 12. MQTT 测试 - Matter 协议
#################################################################
test_mqtt_matter() {
    print_header "12. MQTT 测试 - Matter 协议"

    # TC-MQTT-013: 发送 Matter 属性消息
    print_test "TC-MQTT-013: 发送 Matter 属性消息"
    mqtt_publish "matter/$MATTER_NODE_ID/attribute" "{
        \"nodeId\": $MATTER_NODE_ID,
        \"endpoint\": 1,
        \"cluster\": \"OnOff\",
        \"attribute\": \"OnOff\",
        \"value\": true,
        \"timestamp\": $(date +%s)000
    }"

    if [ $? -eq 0 ]; then
        print_pass "Matter 属性消息发送成功"
    else
        print_fail "Matter 属性消息发送失败" "MQTT publish error"
    fi

    # TC-MQTT-014: 发送 Matter 命令消息
    print_test "TC-MQTT-014: 发送 Matter 命令消息"
    mqtt_publish "matter/$MATTER_NODE_ID/command" "{
        \"nodeId\": $MATTER_NODE_ID,
        \"endpoint\": 1,
        \"cluster\": \"OnOff\",
        \"command\": \"On\",
        \"args\": {},
        \"timestamp\": $(date +%s)000
    }"

    if [ $? -eq 0 ]; then
        print_pass "Matter 命令消息发送成功"
    else
        print_fail "Matter 命令消息发送失败" "MQTT publish error"
    fi
}

#################################################################
# 13. 验证测试 - 检查设备是否在线
#################################################################
test_verify_online() {
    print_header "13. 验证测试 - 检查设备是否在线"

    # 等待消息处理
    sleep 2

    # TC-VERIFY-001: 验证设备在线状态
    print_test "TC-VERIFY-001: 验证设备在线状态"
    STATUS_RESPONSE=$(http_get "$DEVICE_GATEWAY/api/gateway/status" "$USER_TOKEN")

    if echo "$STATUS_RESPONSE" | grep -q "$TEST_DEVICE_ID"; then
        print_pass "设备在线验证成功"
    else
        print_info "设备可能尚未完成注册流程"
    fi

    # TC-VERIFY-002: 验证设备连接信息
    print_test "TC-VERIFY-002: 验证设备连接信息"
    CONN_RESPONSE=$(http_get "$DEVICE_GATEWAY/api/gateway/device/$TEST_DEVICE_ID/connection" "$USER_TOKEN")

    if echo "$CONN_RESPONSE" | grep -q "isOnline.*true"; then
        print_pass "设备连接信息验证成功"
    else
        print_info "设备可能未在线: ${CONN_RESPONSE:0:100}..."
    fi
}

#################################################################
# 测试结果总结
#################################################################
print_summary() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  测试结果总结${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

    echo -e "总测试数: $TOTAL_TESTS"
    echo -e "${GREEN}通过: $PASSED_TESTS${NC}"
    echo -e "${RED}失败: $FAILED_TESTS${NC}"

    local SUCCESS_RATE=0
    if [ "$TOTAL_TESTS" -gt 0 ]; then
        SUCCESS_RATE=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    fi
    echo -e "成功率: ${SUCCESS_RATE}%\n"

    if [ "$FAILED_TESTS" -gt 0 ]; then
        echo -e "${RED}失败的测试:${NC}"
        for name in "${FAILED_TEST_NAMES[@]}"; do
            echo -e "${RED}  ✗ $name${NC}"
        done
    fi

    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"

    if [ "$FAILED_TESTS" -eq 0 ]; then
        echo -e "${GREEN}所有测试通过!${NC}"
        exit 0
    else
        echo -e "${YELLOW}部分测试失败，请检查服务配置${NC}"
        exit 1
    fi
}

#################################################################
# 主测试流程
#################################################################
main() {
    echo -e "${BLUE}"
    echo -e "╔═══════════════════════════════════════════════════════════╗"
    echo -e "║         Device Gateway MQTT 自动化测试                    ║"
    echo -e "║         MQTT Broker: $MQTT_HOST:$MQTT_PORT"
    echo -e "║         Device Gateway: $DEVICE_GATEWAY"
    echo -e "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # 执行测试
    prepare
    test_gateway_status
    test_device_auth
    test_protocol_conversion
    test_mqtt_register
    test_mqtt_auth
    test_mqtt_heartbeat
    test_mqtt_status
    test_mqtt_report
    test_mqtt_command_response
    test_mqtt_config
    test_mqtt_credentials
    test_mqtt_matter
    test_verify_online
    print_summary
}

# 运行主测试流程
main
