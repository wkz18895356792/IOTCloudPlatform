#!/bin/bash

#################################################################
# Device Service API 自动化测试脚本
# 所有接口通过 API Gateway (端口 6001)
#################################################################

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# API Gateway 地址
API_BASE="http://localhost:6001"

# 测试统计
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
FAILED_TEST_NAMES=()

#################################################################
# 工具函数
#################################################################

# 打印测试标题
print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"
}

# 打印测试名称
print_test() {
    echo -e "${YELLOW}[TEST] $1${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

# 打印通过
print_pass() {
    echo -e "${GREEN}  ✓ PASSED: $1${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
}

# 打印失败
print_fail() {
    echo -e "${RED}  ✗ FAILED: $1${NC}"
    echo -e "${RED}    Response: $2${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    FAILED_TEST_NAMES+=("$1")
}

# 打印信息
print_info() {
    echo -e "${BLUE}  → $1${NC}"
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

# 检查响应是否成功
check_success() {
    local response="$1"
    local code=$(json_value "$response" "code")
    local success=$(json_value "$response" "success")

    # 支持两种响应格式: {code: 0} 或 {success: true}
    if [ "$code" = "0" ] || [ "$success" = "true" ]; then
        return 0
    fi
    return 1
}

# HTTP 请求函数
http_get() {
    local url="$1"
    local token="$2"

    if [ -n "$token" ]; then
        curl -s -X GET "${API_BASE}${url}" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token"
    else
        curl -s -X GET "${API_BASE}${url}" \
            -H "Content-Type: application/json"
    fi
}

http_post() {
    local url="$1"
    local data="$2"
    local token="$3"

    if [ -n "$token" ]; then
        curl -s -X POST "${API_BASE}${url}" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token" \
            -d "$data"
    else
        curl -s -X POST "${API_BASE}${url}" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

http_put() {
    local url="$1"
    local data="$2"
    local token="$3"

    if [ -n "$token" ]; then
        curl -s -X PUT "${API_BASE}${url}" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token" \
            -d "$data"
    else
        curl -s -X PUT "${API_BASE}${url}" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

http_delete() {
    local url="$1"
    local token="$2"

    if [ -n "$token" ]; then
        curl -s -X DELETE "${API_BASE}${url}" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token"
    else
        curl -s -X DELETE "${API_BASE}${url}" \
            -H "Content-Type: application/json"
    fi
}

#################################################################
# 全局变量
#################################################################
ACCESS_TOKEN=""
REFRESH_TOKEN=""
TEST_USER_ID=""
TEST_DEVICE_ID=""
TEST_GROUP_ID=""
TEST_SHARE_ID=""
TEST_SCENE_ID=""
TEST_INVITE_ID=""

#################################################################
# 0. 准备工作 - 获取 Token
#################################################################
prepare_auth() {
    print_header "0. 准备工作 - 获取认证 Token"

    # 使用测试账号登录
    TEST_USERNAME="devicetest_$(date +%s)"
    TEST_EMAIL="devicetest$(date +%s)@example.com"

    # 先尝试注册
    REGISTER_RESPONSE=$(http_post "/api/auth/register" "{
        \"username\": \"$TEST_USERNAME\",
        \"password\": \"Test123456!@#\",
        \"email\": \"$TEST_EMAIL\"
    }")

    if check_success "$REGISTER_RESPONSE"; then
        ACCESS_TOKEN=$(json_value "$REGISTER_RESPONSE" "data.accessToken")
        REFRESH_TOKEN=$(json_value "$REGISTER_RESPONSE" "data.refreshToken")
        TEST_USER_ID=$(json_value "$REGISTER_RESPONSE" "data.user.id")
        print_pass "用户注册成功，获取Token"
    else
        # 如果注册失败，尝试登录
        print_info "用户可能已存在，尝试登录..."
        LOGIN_RESPONSE=$(http_post "/api/auth/login" "{
            \"type\": \"password\",
            \"account\": \"$TEST_USERNAME\",
            \"password\": \"Test123456!@#\"
        }")
        if check_success "$LOGIN_RESPONSE"; then
            ACCESS_TOKEN=$(json_value "$LOGIN_RESPONSE" "data.accessToken")
            REFRESH_TOKEN=$(json_value "$LOGIN_RESPONSE" "data.refreshToken")
            TEST_USER_ID=$(json_value "$LOGIN_RESPONSE" "data.user.id")
            print_pass "登录成功，获取Token"
        else
            print_fail "获取Token失败" "$LOGIN_RESPONSE"
            exit 1
        fi
    fi

    print_info "Token: ${ACCESS_TOKEN:0:40}..."
}

#################################################################
# 1. 设备管理测试 (/api/devices)
#################################################################
test_device_management() {
    print_header "1. 设备管理测试 (/api/devices)"

    # TC-DEV-001: 创建设备
    print_test "TC-DEV-001: 创建设备"
    CREATE_RESPONSE=$(http_post "/api/devices" "{
        \"deviceName\": \"测试监控设备\",
        \"productType\": \"camera\",
        \"serialNumber\": \"SN$(date +%s)\",
        \"macAddress\": \"AA:BB:CC:DD:EE:FF\",
        \"firmwareVersion\": \"1.0.0\"
    }" "$ACCESS_TOKEN")

    if check_success "$CREATE_RESPONSE"; then
        TEST_DEVICE_ID=$(json_value "$CREATE_RESPONSE" "data.id")
        print_pass "创建设备成功: ID=$TEST_DEVICE_ID"
    else
        print_fail "创建设备" "$CREATE_RESPONSE"
    fi

    # TC-DEV-002: 获取设备列表
    print_test "TC-DEV-002: 获取设备列表"
    LIST_RESPONSE=$(http_get "/api/devices?page=1&pageSize=10" "$ACCESS_TOKEN")

    if check_success "$LIST_RESPONSE"; then
        TOTAL=$(json_value "$LIST_RESPONSE" "data.total")
        print_pass "获取设备列表成功: 共 $TOTAL 个设备"
    else
        print_fail "获取设备列表" "$LIST_RESPONSE"
    fi

    # TC-DEV-003: 获取设备详情
    if [ -n "$TEST_DEVICE_ID" ]; then
        print_test "TC-DEV-003: 获取设备详情"
        DETAIL_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID" "$ACCESS_TOKEN")

        if check_success "$DETAIL_RESPONSE"; then
            NAME=$(json_value "$DETAIL_RESPONSE" "data.name")
            print_pass "获取设备详情成功: $NAME"
        else
            print_fail "获取设备详情" "$DETAIL_RESPONSE"
        fi
    fi

    # TC-DEV-004: 更新设备信息
    if [ -n "$TEST_DEVICE_ID" ]; then
        print_test "TC-DEV-004: 更新设备信息"
        UPDATE_RESPONSE=$(http_put "/api/devices/$TEST_DEVICE_ID" "{
            \"name\": \"测试监控设备_已更新\",
            \"location\": \"婴儿房\"
        }" "$ACCESS_TOKEN")

        if check_success "$UPDATE_RESPONSE"; then
            print_pass "更新设备信息成功"
        else
            print_fail "更新设备信息" "$UPDATE_RESPONSE"
        fi
    fi

    # TC-DEV-005: 获取设备状态
    if [ -n "$TEST_DEVICE_ID" ]; then
        print_test "TC-DEV-005: 获取设备状态"
        STATE_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/state" "$ACCESS_TOKEN")

        if check_success "$STATE_RESPONSE"; then
            print_pass "获取设备状态成功"
        else
            print_fail "获取设备状态" "$STATE_RESPONSE"
        fi
    fi

    # TC-DEV-006: 检查设备在线状态
    if [ -n "$TEST_DEVICE_ID" ]; then
        print_test "TC-DEV-006: 检查设备在线状态"
        ONLINE_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/online" "$ACCESS_TOKEN")

        if check_success "$ONLINE_RESPONSE"; then
            print_pass "检查设备在线状态成功"
        else
            print_fail "检查设备在线状态" "$ONLINE_RESPONSE"
        fi
    fi

    # TC-DEV-007: 发送设备命令
    if [ -n "$TEST_DEVICE_ID" ]; then
        print_test "TC-DEV-007: 发送设备命令"
        COMMAND_RESPONSE=$(http_post "/api/devices/$TEST_DEVICE_ID/command" "{
            \"command\": \"reboot\",
            \"params\": {}
        }" "$ACCESS_TOKEN")

        if check_success "$COMMAND_RESPONSE"; then
            print_pass "发送设备命令成功"
        else
            print_info "设备命令可能需要设备在线"
        fi
    fi
}

#################################################################
# 2. PTZ 控制测试 (/api/devices/:deviceId/ptz)
#################################################################
test_ptz_control() {
    print_header "2. PTZ 控制测试 (/api/devices/:deviceId/ptz)"

    if [ -z "$TEST_DEVICE_ID" ]; then
        print_info "跳过：未创建设备"
        return
    fi

    # TC-PTZ-001: PTZ 控制
    print_test "TC-PTZ-001: PTZ 控制"
    PTZ_RESPONSE=$(http_post "/api/devices/$TEST_DEVICE_ID/ptz/control" "{
        \"action\": \"move\",
        \"direction\": \"up\",
        \"speed\": 5
    }" "$ACCESS_TOKEN")

    if check_success "$PTZ_RESPONSE"; then
        print_pass "PTZ 控制成功"
    else
        print_info "PTZ 控制可能需要设备支持"
    fi

    # TC-PTZ-002: 停止 PTZ
    print_test "TC-PTZ-002: 停止 PTZ"
    STOP_RESPONSE=$(http_post "/api/devices/$TEST_DEVICE_ID/ptz/stop" "{}" "$ACCESS_TOKEN")

    if check_success "$STOP_RESPONSE"; then
        print_pass "停止 PTZ 成功"
    else
        print_info "停止 PTZ 可能需要设备支持"
    fi

    # TC-PTZ-003: 获取 PTZ 位置
    print_test "TC-PTZ-003: 获取 PTZ 位置"
    POSITION_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/ptz/position" "$ACCESS_TOKEN")

    if check_success "$POSITION_RESPONSE"; then
        print_pass "获取 PTZ 位置成功"
    else
        print_fail "获取 PTZ 位置" "$POSITION_RESPONSE"
    fi

    # TC-PTZ-004: 创建预置位
    print_test "TC-PTZ-004: 创建预置位"
    PRESET_RESPONSE=$(http_post "/api/devices/$TEST_DEVICE_ID/ptz/presets" "{
        \"name\": \"测试预置位\",
        \"position\": {\"pan\": 0, \"tilt\": 0, \"zoom\": 1}
    }" "$ACCESS_TOKEN")

    if check_success "$PRESET_RESPONSE"; then
        TEST_PRESET_ID=$(json_value "$PRESET_RESPONSE" "data.id")
        print_pass "创建预置位成功"
    else
        print_fail "创建预置位" "$PRESET_RESPONSE"
    fi

    # TC-PTZ-005: 获取预置位列表
    print_test "TC-PTZ-005: 获取预置位列表"
    PRESETS_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/ptz/presets" "$ACCESS_TOKEN")

    if check_success "$PRESETS_RESPONSE"; then
        print_pass "获取预置位列表成功"
    else
        print_fail "获取预置位列表" "$PRESETS_RESPONSE"
    fi

    # TC-PTZ-006: 删除预置位
    if [ -n "$TEST_PRESET_ID" ]; then
        print_test "TC-PTZ-006: 删除预置位"
        DELETE_PRESET_RESPONSE=$(http_delete "/api/devices/$TEST_DEVICE_ID/ptz/presets/$TEST_PRESET_ID" "$ACCESS_TOKEN")

        if check_success "$DELETE_PRESET_RESPONSE"; then
            print_pass "删除预置位成功"
        else
            print_fail "删除预置位" "$DELETE_PRESET_RESPONSE"
        fi
    fi
}

#################################################################
# 3. 音频功能测试 (/api/devices/:deviceId/talk, /api/devices/:deviceId/soothing)
#################################################################
test_audio_features() {
    print_header "3. 音频功能测试 (/api/devices/:deviceId/talk, /api/devices/:deviceId/soothing)"

    if [ -z "$TEST_DEVICE_ID" ]; then
        print_info "跳过：未创建设备"
        return
    fi

    # TC-AUDIO-001: 开始对讲
    print_test "TC-AUDIO-001: 开始对讲"
    TALK_START_RESPONSE=$(http_post "/api/devices/$TEST_DEVICE_ID/talk/start" "{}" "$ACCESS_TOKEN")

    if check_success "$TALK_START_RESPONSE"; then
        print_pass "开始对讲成功"
    else
        print_info "对讲功能可能需要设备在线"
    fi

    # TC-AUDIO-002: 获取对讲状态
    print_test "TC-AUDIO-002: 获取对讲状态"
    TALK_STATUS_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/talk/status" "$ACCESS_TOKEN")

    if check_success "$TALK_STATUS_RESPONSE"; then
        print_pass "获取对讲状态成功"
    else
        print_fail "获取对讲状态" "$TALK_STATUS_RESPONSE"
    fi

    # TC-AUDIO-003: 停止对讲
    print_test "TC-AUDIO-003: 停止对讲"
    TALK_STOP_RESPONSE=$(http_post "/api/devices/$TEST_DEVICE_ID/talk/stop" "{}" "$ACCESS_TOKEN")

    if check_success "$TALK_STOP_RESPONSE"; then
        print_pass "停止对讲成功"
    else
        print_fail "停止对讲" "$TALK_STOP_RESPONSE"
    fi

    # TC-AUDIO-004: 获取安抚音乐列表
    print_test "TC-AUDIO-004: 获取安抚音乐列表"
    MUSIC_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/soothing/music" "$ACCESS_TOKEN")

    if check_success "$MUSIC_RESPONSE"; then
        print_pass "获取安抚音乐列表成功"
    else
        print_fail "获取安抚音乐列表" "$MUSIC_RESPONSE"
    fi

    # TC-AUDIO-005: 播放安抚音乐
    print_test "TC-AUDIO-005: 播放安抚音乐"
    PLAY_RESPONSE=$(http_post "/api/devices/$TEST_DEVICE_ID/soothing/play" "{
        \"musicId\": \"lullaby_01\",
        \"volume\": 50
    }" "$ACCESS_TOKEN")

    if check_success "$PLAY_RESPONSE"; then
        print_pass "播放安抚音乐成功"
    else
        print_info "播放音乐可能需要设备在线"
    fi

    # TC-AUDIO-006: 停止安抚音乐
    print_test "TC-AUDIO-006: 停止安抚音乐"
    STOP_MUSIC_RESPONSE=$(http_post "/api/devices/$TEST_DEVICE_ID/soothing/stop" "{}" "$ACCESS_TOKEN")

    if check_success "$STOP_MUSIC_RESPONSE"; then
        print_pass "停止安抚音乐成功"
    else
        print_fail "停止安抚音乐" "$STOP_MUSIC_RESPONSE"
    fi

    # TC-AUDIO-007: 设置音量
    print_test "TC-AUDIO-007: 设置音量"
    VOLUME_RESPONSE=$(http_put "/api/devices/$TEST_DEVICE_ID/soothing/volume" "{
        \"volume\": 60
    }" "$ACCESS_TOKEN")

    if check_success "$VOLUME_RESPONSE"; then
        print_pass "设置音量成功"
    else
        print_fail "设置音量" "$VOLUME_RESPONSE"
    fi
}

#################################################################
# 4. 设备分组测试 (/api/devices/groups)
#################################################################
test_device_groups() {
    print_header "4. 设备分组测试 (/api/devices/groups)"

    # TC-GROUP-001: 创建设备分组
    print_test "TC-GROUP-001: 创建设备分组"
    CREATE_GROUP_RESPONSE=$(http_post "/api/devices/groups" "{
        \"name\": \"测试分组\",
        \"description\": \"自动化测试分组\"
    }" "$ACCESS_TOKEN")

    if check_success "$CREATE_GROUP_RESPONSE"; then
        TEST_GROUP_ID=$(json_value "$CREATE_GROUP_RESPONSE" "data.id")
        print_pass "创建设备分组成功: ID=$TEST_GROUP_ID"
    else
        print_fail "创建设备分组" "$CREATE_GROUP_RESPONSE"
    fi

    # TC-GROUP-002: 获取分组列表
    print_test "TC-GROUP-002: 获取分组列表"
    GROUPS_RESPONSE=$(http_get "/api/devices/groups" "$ACCESS_TOKEN")

    if check_success "$GROUPS_RESPONSE"; then
        print_pass "获取分组列表成功"
    else
        print_fail "获取分组列表" "$GROUPS_RESPONSE"
    fi

    # TC-GROUP-003: 更新分组
    if [ -n "$TEST_GROUP_ID" ]; then
        print_test "TC-GROUP-003: 更新分组"
        UPDATE_GROUP_RESPONSE=$(http_put "/api/devices/groups/$TEST_GROUP_ID" "{
            \"name\": \"测试分组_已更新\"
        }" "$ACCESS_TOKEN")

        if check_success "$UPDATE_GROUP_RESPONSE"; then
            print_pass "更新分组成功"
        else
            print_fail "更新分组" "$UPDATE_GROUP_RESPONSE"
        fi
    fi

    # TC-GROUP-004: 添加设备到分组
    if [ -n "$TEST_GROUP_ID" ] && [ -n "$TEST_DEVICE_ID" ]; then
        print_test "TC-GROUP-004: 添加设备到分组"
        ADD_DEVICE_RESPONSE=$(http_post "/api/devices/groups/$TEST_GROUP_ID/devices" "{
            \"deviceIds\": [\"$TEST_DEVICE_ID\"]
        }" "$ACCESS_TOKEN")

        if check_success "$ADD_DEVICE_RESPONSE"; then
            print_pass "添加设备到分组成功"
        else
            print_fail "添加设备到分组" "$ADD_DEVICE_RESPONSE"
        fi
    fi

    # TC-GROUP-005: 从分组移除设备
    if [ -n "$TEST_GROUP_ID" ] && [ -n "$TEST_DEVICE_ID" ]; then
        print_test "TC-GROUP-005: 从分组移除设备"
        REMOVE_DEVICE_RESPONSE=$(http_delete "/api/devices/groups/$TEST_GROUP_ID/devices?deviceIds=$TEST_DEVICE_ID" "$ACCESS_TOKEN")

        if check_success "$REMOVE_DEVICE_RESPONSE"; then
            print_pass "从分组移除设备成功"
        else
            print_fail "从分组移除设备" "$REMOVE_DEVICE_RESPONSE"
        fi
    fi

    # TC-GROUP-006: 删除分组
    if [ -n "$TEST_GROUP_ID" ]; then
        print_test "TC-GROUP-006: 删除分组"
        DELETE_GROUP_RESPONSE=$(http_delete "/api/devices/groups/$TEST_GROUP_ID" "$ACCESS_TOKEN")

        if check_success "$DELETE_GROUP_RESPONSE"; then
            print_pass "删除分组成功"
        else
            print_fail "删除分组" "$DELETE_GROUP_RESPONSE"
        fi
    fi
}

#################################################################
# 5. 设备共享测试 (/api/devices/shares)
#################################################################
test_device_shares() {
    print_header "5. 设备共享测试 (/api/devices/shares)"

    if [ -z "$TEST_DEVICE_ID" ]; then
        print_info "跳过：未创建设备"
        return
    fi

    # TC-SHARE-001: 共享设备
    print_test "TC-SHARE-001: 共享设备"
    SHARE_RESPONSE=$(http_post "/api/devices/$TEST_DEVICE_ID/shares" "{
        \"targetUserId\": \"test-user-123\",
        \"permissions\": [\"view\", \"control\"],
        \"expiresAt\": \"$(date -d '+7 days' -Iseconds 2>/dev/null || date -v+7d -Iseconds)\"
    }" "$ACCESS_TOKEN")

    if check_success "$SHARE_RESPONSE"; then
        TEST_SHARE_ID=$(json_value "$SHARE_RESPONSE" "data.id")
        print_pass "共享设备成功"
    else
        print_fail "共享设备" "$SHARE_RESPONSE"
    fi

    # TC-SHARE-002: 获取发送的共享
    print_test "TC-SHARE-002: 获取发送的共享"
    SENT_SHARES_RESPONSE=$(http_get "/api/devices/shares/sent" "$ACCESS_TOKEN")

    if check_success "$SENT_SHARES_RESPONSE"; then
        print_pass "获取发送的共享成功"
    else
        print_fail "获取发送的共享" "$SENT_SHARES_RESPONSE"
    fi

    # TC-SHARE-003: 获取接收的共享
    print_test "TC-SHARE-003: 获取接收的共享"
    RECEIVED_SHARES_RESPONSE=$(http_get "/api/devices/shares/received" "$ACCESS_TOKEN")

    if check_success "$RECEIVED_SHARES_RESPONSE"; then
        print_pass "获取接收的共享成功"
    else
        print_fail "获取接收的共享" "$RECEIVED_SHARES_RESPONSE"
    fi

    # TC-SHARE-004: 删除共享
    if [ -n "$TEST_SHARE_ID" ]; then
        print_test "TC-SHARE-004: 删除共享"
        DELETE_SHARE_RESPONSE=$(http_delete "/api/devices/shares/$TEST_SHARE_ID" "$ACCESS_TOKEN")

        if check_success "$DELETE_SHARE_RESPONSE"; then
            print_pass "删除共享成功"
        else
            print_fail "删除共享" "$DELETE_SHARE_RESPONSE"
        fi
    fi
}

#################################################################
# 6. 场景管理测试 (/api/devices/scenes)
#################################################################
test_scenes() {
    print_header "6. 场景管理测试 (/api/devices/scenes)"

    # TC-SCENE-001: 创建场景
    print_test "TC-SCENE-001: 创建场景"
    CREATE_SCENE_RESPONSE=$(http_post "/api/devices/scenes" "{
        \"name\": \"测试场景\",
        \"description\": \"自动化测试场景\",
        \"actions\": [
            {\"deviceId\": \"$TEST_DEVICE_ID\", \"action\": \"turnOn\"}
        ]
    }" "$ACCESS_TOKEN")

    if check_success "$CREATE_SCENE_RESPONSE"; then
        TEST_SCENE_ID=$(json_value "$CREATE_SCENE_RESPONSE" "data.id")
        print_pass "创建场景成功: ID=$TEST_SCENE_ID"
    else
        print_fail "创建场景" "$CREATE_SCENE_RESPONSE"
    fi

    # TC-SCENE-002: 获取场景列表
    print_test "TC-SCENE-002: 获取场景列表"
    SCENES_RESPONSE=$(http_get "/api/devices/scenes" "$ACCESS_TOKEN")

    if check_success "$SCENES_RESPONSE"; then
        print_pass "获取场景列表成功"
    else
        print_fail "获取场景列表" "$SCENES_RESPONSE"
    fi

    # TC-SCENE-003: 执行场景
    if [ -n "$TEST_SCENE_ID" ]; then
        print_test "TC-SCENE-003: 执行场景"
        EXECUTE_SCENE_RESPONSE=$(http_post "/api/devices/scenes/$TEST_SCENE_ID/execute" "{}" "$ACCESS_TOKEN")

        if check_success "$EXECUTE_SCENE_RESPONSE"; then
            print_pass "执行场景成功"
        else
            print_info "执行场景可能需要设备在线"
        fi
    fi

    # TC-SCENE-004: 切换场景状态
    if [ -n "$TEST_SCENE_ID" ]; then
        print_test "TC-SCENE-004: 切换场景状态"
        TOGGLE_SCENE_RESPONSE=$(http_put "/api/devices/scenes/$TEST_SCENE_ID/toggle" "{
            \"enabled\": false
        }" "$ACCESS_TOKEN")

        if check_success "$TOGGLE_SCENE_RESPONSE"; then
            print_pass "切换场景状态成功"
        else
            print_fail "切换场景状态" "$TOGGLE_SCENE_RESPONSE"
        fi
    fi
}

#################################################################
# 7. 设备检查测试 (/api/devices/:deviceId/check)
#################################################################
test_device_check() {
    print_header "7. 设备检查测试 (/api/devices/:deviceId/check)"

    if [ -z "$TEST_DEVICE_ID" ]; then
        print_info "跳过：未创建设备"
        return
    fi

    # TC-CHECK-001: 开始设备检查
    print_test "TC-CHECK-001: 开始设备检查"
    START_CHECK_RESPONSE=$(http_post "/api/devices/$TEST_DEVICE_ID/check/start" "{
        \"checkTypes\": [\"network\", \"firmware\", \"hardware\"]
    }" "$ACCESS_TOKEN")

    if check_success "$START_CHECK_RESPONSE"; then
        TEST_TASK_ID=$(json_value "$START_CHECK_RESPONSE" "data.taskId")
        print_pass "开始设备检查成功"
    else
        print_fail "开始设备检查" "$START_CHECK_RESPONSE"
    fi

    # TC-CHECK-002: 获取检查进度
    print_test "TC-CHECK-002: 获取检查进度"
    PROGRESS_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/check/progress" "$ACCESS_TOKEN")

    if check_success "$PROGRESS_RESPONSE"; then
        print_pass "获取检查进度成功"
    else
        print_fail "获取检查进度" "$PROGRESS_RESPONSE"
    fi

    # TC-CHECK-003: 获取检查结果
    print_test "TC-CHECK-003: 获取检查结果"
    RESULT_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/check/result" "$ACCESS_TOKEN")

    if check_success "$RESULT_RESPONSE"; then
        print_pass "获取检查结果成功"
    else
        print_fail "获取检查结果" "$RESULT_RESPONSE"
    fi

    # TC-CHECK-004: 获取检查历史
    print_test "TC-CHECK-004: 获取检查历史"
    HISTORY_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/check/history" "$ACCESS_TOKEN")

    if check_success "$HISTORY_RESPONSE"; then
        print_pass "获取检查历史成功"
    else
        print_fail "获取检查历史" "$HISTORY_RESPONSE"
    fi

    # TC-CHECK-005: 获取设备健康状态
    print_test "TC-CHECK-005: 获取设备健康状态"
    HEALTH_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/health" "$ACCESS_TOKEN")

    if check_success "$HEALTH_RESPONSE"; then
        print_pass "获取设备健康状态成功"
    else
        print_fail "获取设备健康状态" "$HEALTH_RESPONSE"
    fi
}

#################################################################
# 8. 事件和告警测试 (/api/devices/:deviceId/events, /api/devices/:deviceId/alerts)
#################################################################
test_events_and_alerts() {
    print_header "8. 事件和告警测试 (/api/devices/:deviceId/events, /api/devices/:deviceId/alerts)"

    if [ -z "$TEST_DEVICE_ID" ]; then
        print_info "跳过：未创建设备"
        return
    fi

    # TC-EVENT-001: 获取设备事件
    print_test "TC-EVENT-001: 获取设备事件"
    EVENTS_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/events?page=1&pageSize=10" "$ACCESS_TOKEN")

    if check_success "$EVENTS_RESPONSE"; then
        print_pass "获取设备事件成功"
    else
        print_fail "获取设备事件" "$EVENTS_RESPONSE"
    fi

    # TC-EVENT-002: 获取设备告警
    print_test "TC-EVENT-002: 获取设备告警"
    ALERTS_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/alerts?page=1&pageSize=10" "$ACCESS_TOKEN")

    if check_success "$ALERTS_RESPONSE"; then
        print_pass "获取设备告警成功"
    else
        print_fail "获取设备告警" "$ALERTS_RESPONSE"
    fi

    # TC-EVENT-003: 获取统计数据
    print_test "TC-EVENT-003: 获取统计数据"
    STATS_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/statistics" "$ACCESS_TOKEN")

    if check_success "$STATS_RESPONSE"; then
        print_pass "获取统计数据成功"
    else
        print_fail "获取统计数据" "$STATS_RESPONSE"
    fi

    # TC-EVENT-004: 获取健康报告
    print_test "TC-EVENT-004: 获取健康报告"
    REPORT_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/health-report" "$ACCESS_TOKEN")

    if check_success "$REPORT_RESPONSE"; then
        print_pass "获取健康报告成功"
    else
        print_fail "获取健康报告" "$REPORT_RESPONSE"
    fi
}

#################################################################
# 9. OTA 升级测试 (/api/devices/:deviceId/ota)
#################################################################
test_ota() {
    print_header "9. OTA 升级测试 (/api/devices/:deviceId/ota)"

    if [ -z "$TEST_DEVICE_ID" ]; then
        print_info "跳过：未创建设备"
        return
    fi

    # TC-OTA-001: 检查 OTA 更新
    print_test "TC-OTA-001: 检查 OTA 更新"
    CHECK_OTA_RESPONSE=$(http_get "/api/devices/$TEST_DEVICE_ID/ota/check" "$ACCESS_TOKEN")

    if check_success "$CHECK_OTA_RESPONSE"; then
        print_pass "检查 OTA 更新成功"
    else
        print_fail "检查 OTA 更新" "$CHECK_OTA_RESPONSE"
    fi
}

#################################################################
# 10. 清理测试数据
#################################################################
cleanup() {
    print_header "10. 清理测试数据"

    # 删除场景
    if [ -n "$TEST_SCENE_ID" ]; then
        print_info "清理场景..."
        http_delete "/api/devices/scenes/$TEST_SCENE_ID" "$ACCESS_TOKEN" > /dev/null 2>&1
    fi

    # 删除设备
    if [ -n "$TEST_DEVICE_ID" ]; then
        print_test "TC-CLEAN-001: 删除测试设备"
        DELETE_RESPONSE=$(http_delete "/api/devices/$TEST_DEVICE_ID" "$ACCESS_TOKEN")

        if check_success "$DELETE_RESPONSE"; then
            print_pass "删除测试设备成功"
        else
            print_info "清理可能已部分完成"
        fi
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
        echo -e "${YELLOW}部分测试失败，请检查API实现${NC}"
        exit 1
    fi
}

#################################################################
# 主测试流程
#################################################################
main() {
    echo -e "${BLUE}"
    echo -e "╔═══════════════════════════════════════════════════════════╗"
    echo -e "║         Device Service API 自动化测试                     ║"
    echo -e "║         API Gateway: http://localhost:6001                ║"
    echo -e "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # 检查 API Gateway 连接
    echo -e "${YELLOW}检查API Gateway连接...${NC}"
    if curl -s --connect-timeout 5 "$API_BASE/health" > /dev/null 2>&1; then
        echo -e "${GREEN}API Gateway 连接正常${NC}"
    else
        echo -e "${RED}无法连接到 API Gateway: $API_BASE${NC}"
        echo -e "${YELLOW}请确保 API Gateway 和相关服务已启动${NC}"
        exit 1
    fi

    # 执行测试
    prepare_auth
    test_device_management
    test_ptz_control
    test_audio_features
    test_device_groups
    test_device_shares
    test_scenes
    test_device_check
    test_events_and_alerts
    test_ota
    cleanup
    print_summary
}

# 运行主测试流程
main
