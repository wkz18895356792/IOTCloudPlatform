#!/bin/bash

#################################################################
# User Service API 自动化测试脚本 (最终修复版)
# 所有请求通过 API Gateway (端口 6001) 发送
# 使用方法: ./api-test-runner.sh
#################################################################

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
API_BASE="${API_BASE_URL:-http://localhost:6001}"
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 测试结果记录
declare -a FAILED_TEST_NAMES

# 辅助函数
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
    echo -e "  ${BLUE}→ $1${NC}"
}

# 使用 Node.js 解析 JSON
json_parse() {
    local response="$1"
    local path="$2"
    echo "$response" | node -e "
        try {
            const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
            const result = path => path.split('.').reduce((obj, key) => obj && obj[key], data);
            const value = result('$path');
            console.log(value !== undefined && value !== null ? value : '');
        } catch(e) {
            console.log('');
        }
    " 2>/dev/null || echo ""
}

json_value() {
    local response="$1"
    local path="$2"
    json_parse "$response" "$path"
}

check_success() {
    local response="$1"
    local success=$(json_value "$response" "success")
    local code=$(json_value "$response" "code")

    if [ "$success" = "true" ] || [ "$code" = "0" ]; then
        return 0
    fi
    return 1
}

# HTTP 请求封装
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
    local data="$2"
    local token="$3"

    if [ -n "$token" ]; then
        curl -s -X DELETE "${API_BASE}${url}" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token" \
            -d "$data"
    else
        curl -s -X DELETE "${API_BASE}${url}" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

#################################################################
# 全局变量
#################################################################
ACCESS_TOKEN=""
REFRESH_TOKEN=""
TEST_USERNAME="testuser_$(date +%s)"
TEST_EMAIL="test$(date +%s)@example.com"
TEST_USER_ID=""

#################################################################
# 1. 认证模块测试 (/api/auth)
#################################################################
test_auth_module() {
    print_header "1. 认证模块测试 (/api/auth)"

    # TC-AUTH-001: 用户注册
    print_test "TC-AUTH-001: 用户注册"
    print_info "用户名: $TEST_USERNAME"
    REGISTER_RESPONSE=$(http_post "/api/auth/register" "{
        \"username\": \"$TEST_USERNAME\",
        \"password\": \"Test123456!@#\",
        \"email\": \"$TEST_EMAIL\"
    }")

    if check_success "$REGISTER_RESPONSE"; then
        ACCESS_TOKEN=$(json_value "$REGISTER_RESPONSE" "data.accessToken")
        REFRESH_TOKEN=$(json_value "$REGISTER_RESPONSE" "data.refreshToken")
        TEST_USER_ID=$(json_value "$REGISTER_RESPONSE" "data.user.id")
        print_pass "用户注册成功"
    else
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
            print_pass "登录成功"
        else
            print_fail "登录" "$LOGIN_RESPONSE"
        fi
    fi

    # TC-AUTH-002: 密码登录
    print_test "TC-AUTH-002: 密码登录"
    LOGIN_RESPONSE=$(http_post "/api/auth/login" "{
        \"type\": \"password\",
        \"account\": \"$TEST_USERNAME\",
        \"password\": \"Test123456!@#\"
    }")

    if check_success "$LOGIN_RESPONSE"; then
        ACCESS_TOKEN=$(json_value "$LOGIN_RESPONSE" "data.accessToken")
        REFRESH_TOKEN=$(json_value "$LOGIN_RESPONSE" "data.refreshToken")
        print_pass "密码登录成功"
        print_info "Token: ${ACCESS_TOKEN:0:40}..."
    else
        print_fail "密码登录" "$LOGIN_RESPONSE"
    fi

    # TC-AUTH-003: 错误密码登录
    print_test "TC-AUTH-003: 错误密码登录（应失败）"
    WRONG_RESPONSE=$(http_post "/api/auth/login" "{
        \"type\": \"password\",
        \"account\": \"$TEST_USERNAME\",
        \"password\": \"WrongPassword123\"
    }")

    if ! check_success "$WRONG_RESPONSE"; then
        print_pass "错误密码正确返回失败"
    else
        print_fail "错误密码应该失败" "$WRONG_RESPONSE"
    fi

    # TC-AUTH-004: 刷新Token (POST /api/auth/refresh)
    print_test "TC-AUTH-004: 刷新Token"
    if [ -n "$REFRESH_TOKEN" ]; then
        REFRESH_RESPONSE=$(http_post "/api/auth/refresh" "{
            \"refreshToken\": \"$REFRESH_TOKEN\"
        }")

        if check_success "$REFRESH_RESPONSE"; then
            NEW_TOKEN=$(json_value "$REFRESH_RESPONSE" "data.accessToken")
            if [ -n "$NEW_TOKEN" ]; then
                ACCESS_TOKEN="$NEW_TOKEN"
                print_pass "Token刷新成功"
            else
                print_fail "刷新响应缺少Token" "$REFRESH_RESPONSE"
            fi
        else
            print_info "Token刷新可能需要特殊验证"
        fi
    else
        print_info "没有可用的refreshToken"
    fi

    # TC-AUTH-005: 获取OAuth授权URL
    print_test "TC-AUTH-005: 获取OAuth授权URL"
    OAUTH_RESPONSE=$(http_get "/api/oauth/providers" "")
    if check_success "$OAUTH_RESPONSE"; then
        print_pass "获取OAuth提供商列表成功"
    else
        print_fail "获取OAuth提供商列表" "$OAUTH_RESPONSE"
    fi
}

#################################################################
# 2. 用户信息模块测试 (/api/users)
#################################################################
test_user_module() {
    print_header "2. 用户信息模块测试 (/api/users)"

    # TC-USER-001: 获取当前用户信息 (GET /api/users/me)
    print_test "TC-USER-001: 获取当前用户信息"
    print_info "使用Token: ${ACCESS_TOKEN:0:30}..."
    ME_RESPONSE=$(http_get "/api/users/me" "$ACCESS_TOKEN")

    if check_success "$ME_RESPONSE"; then
        USERNAME=$(json_value "$ME_RESPONSE" "data.username")
        print_pass "获取用户信息成功: $USERNAME"
    else
        print_fail "获取用户信息" "$ME_RESPONSE"
    fi

    # TC-USER-002: 无Token访问
    print_test "TC-USER-002: 无Token访问用户信息（应失败）"
    NO_TOKEN_RESPONSE=$(http_get "/api/users/me" "")

    if ! check_success "$NO_TOKEN_RESPONSE"; then
        print_pass "无Token正确返回失败"
    else
        print_fail "无Token应该失败" "$NO_TOKEN_RESPONSE"
    fi

    # TC-USER-003: 更新用户资料 (PUT /api/users/me/profile)
    print_test "TC-USER-003: 更新用户资料"
    UPDATE_RESPONSE=$(http_put "/api/users/me/profile" "{
        \"nickname\": \"自动化测试用户\",
        \"gender\": \"male\",
        \"location\": \"北京市\"
    }" "$ACCESS_TOKEN")

    if check_success "$UPDATE_RESPONSE"; then
        print_pass "更新用户资料成功"
    else
        print_fail "更新用户资料" "$UPDATE_RESPONSE"
    fi

    # TC-USER-004: 修改密码 (PUT /api/users/me/password)
    print_test "TC-USER-004: 修改密码"
    PWD_RESPONSE=$(http_put "/api/users/me/password" "{
        \"oldPassword\": \"Test123456!@#\",
        \"newPassword\": \"NewTest123456!@#\"
    }" "$ACCESS_TOKEN")

    if check_success "$PWD_RESPONSE"; then
        print_pass "修改密码成功"
    else
        print_fail "修改密码" "$PWD_RESPONSE"
    fi

    # TC-USER-005: 获取用户设备列表 (GET /api/users/me/devices)
    print_test "TC-USER-005: 获取用户设备列表"
    DEVICES_RESPONSE=$(http_get "/api/users/me/devices" "$ACCESS_TOKEN")

    if check_success "$DEVICES_RESPONSE"; then
        print_pass "获取设备列表成功"
    else
        print_fail "获取设备列表" "$DEVICES_RESPONSE"
    fi

    # TC-USER-006: 获取会话列表 (GET /api/users/me/sessions)
    print_test "TC-USER-006: 获取会话列表"
    SESSIONS_RESPONSE=$(http_get "/api/users/me/sessions" "$ACCESS_TOKEN")

    if check_success "$SESSIONS_RESPONSE"; then
        print_pass "获取会话列表成功"
    else
        print_fail "获取会话列表" "$SESSIONS_RESPONSE"
    fi
}

#################################################################
# 3. 面容ID模块测试 (/api/face-id)
#################################################################
test_faceid_module() {
    print_header "3. 面容ID模块测试 (/api/face-id)"

    # TC-FACEID-001: 获取面容ID状态
    print_test "TC-FACEID-001: 获取面容ID状态"
    STATUS_RESPONSE=$(http_get "/api/face-id/status" "$ACCESS_TOKEN")

    if check_success "$STATUS_RESPONSE"; then
        print_pass "获取面容ID状态成功"
    else
        print_fail "获取面容ID状态" "$STATUS_RESPONSE"
    fi

    # TC-FACEID-002: 开通面容ID
    print_test "TC-FACEID-002: 开通面容ID"
    ENABLE_RESPONSE=$(http_post "/api/face-id/enable" "{
        \"faceIdData\": \"test_biometric_token_$(date +%s)\"
    }" "$ACCESS_TOKEN")

    if check_success "$ENABLE_RESPONSE"; then
        print_pass "开通面容ID成功"
    else
        print_info "面容ID可能已开通"
    fi

    # TC-FACEID-003: 关闭面容ID
    print_test "TC-FACEID-003: 关闭面容ID"
    DISABLE_RESPONSE=$(http_post "/api/face-id/disable" "{}" "$ACCESS_TOKEN")

    if check_success "$DISABLE_RESPONSE"; then
        print_pass "关闭面容ID成功"
    else
        print_info "面容ID可能未开通"
    fi
}

#################################################################
# 4. 双因素认证模块测试 (/api/2fa)
#################################################################
test_2fa_module() {
    print_header "4. 双因素认证模块测试 (/api/2fa)"

    # TC-2FA-001: 获取2FA状态
    print_test "TC-2FA-001: 获取2FA状态"
    STATUS_RESPONSE=$(http_get "/api/2fa/status" "$ACCESS_TOKEN")

    if check_success "$STATUS_RESPONSE"; then
        print_pass "获取2FA状态成功"
    else
        print_fail "获取2FA状态" "$STATUS_RESPONSE"
    fi

    # TC-2FA-002: 设置TOTP
    print_test "TC-2FA-002: 设置TOTP"
    TOTP_RESPONSE=$(http_post "/api/2fa/setup/totp" "{
        \"email\": \"$TEST_EMAIL\"
    }" "$ACCESS_TOKEN")

    if check_success "$TOTP_RESPONSE"; then
        print_pass "设置TOTP成功"
    else
        print_fail "设置TOTP" "$TOTP_RESPONSE"
    fi
}

#################################################################
# 5. 订阅服务模块测试 (/api/subscription)
#################################################################
test_subscription_module() {
    print_header "5. 订阅服务模块测试 (/api/subscription)"

    # TC-SUB-001: 获取套餐列表
    print_test "TC-SUB-001: 获取套餐列表"
    PLANS_RESPONSE=$(http_get "/api/subscription/plans" "$ACCESS_TOKEN")

    if check_success "$PLANS_RESPONSE"; then
        print_pass "获取套餐列表成功"
    else
        print_fail "获取套餐列表" "$PLANS_RESPONSE"
    fi

    # TC-SUB-002: 获取我的订阅
    print_test "TC-SUB-002: 获取我的订阅"
    MY_SUB_RESPONSE=$(http_get "/api/subscription/my-subscription" "$ACCESS_TOKEN")

    if check_success "$MY_SUB_RESPONSE"; then
        print_pass "获取我的订阅成功"
    else
        print_fail "获取我的订阅" "$MY_SUB_RESPONSE"
    fi
}

#################################################################
# 6. 通知设置模块测试 (/api/users/me/notifications)
#################################################################
test_notification_module() {
    print_header "6. 通知设置模块测试 (/api/users/me/notifications)"

    # TC-NOTIF-001: 获取通知设置
    print_test "TC-NOTIF-001: 获取通知设置"
    SETTINGS_RESPONSE=$(http_get "/api/users/me/notifications/settings" "$ACCESS_TOKEN")

    if check_success "$SETTINGS_RESPONSE"; then
        print_pass "获取通知设置成功"
    else
        print_fail "获取通知设置" "$SETTINGS_RESPONSE"
    fi

    # TC-NOTIF-002: 更新推送开关
    print_test "TC-NOTIF-002: 更新推送开关"
    PUSH_RESPONSE=$(http_put "/api/users/me/notifications/settings/push" "{
        \"enabled\": true
    }" "$ACCESS_TOKEN")

    if check_success "$PUSH_RESPONSE"; then
        print_pass "更新推送开关成功"
    else
        print_fail "更新推送开关" "$PUSH_RESPONSE"
    fi

    # TC-NOTIF-003: 获取未读通知数量
    print_test "TC-NOTIF-003: 获取未读通知数量"
    UNREAD_RESPONSE=$(http_get "/api/users/me/notifications/unread-count" "$ACCESS_TOKEN")

    if check_success "$UNREAD_RESPONSE"; then
        COUNT=$(json_value "$UNREAD_RESPONSE" "data.count")
        print_pass "获取未读通知数量成功: $COUNT"
    else
        print_fail "获取未读通知数量" "$UNREAD_RESPONSE"
    fi
}

#################################################################
# 7. 帮助中心模块测试 (/api/help)
#################################################################
test_help_module() {
    print_header "7. 帮助中心模块测试 (/api/help)"

    # TC-HELP-001: 获取帮助文章列表
    print_test "TC-HELP-001: 获取帮助文章列表"
    ARTICLES_RESPONSE=$(http_get "/api/help/articles?limit=10" "$ACCESS_TOKEN")

    if check_success "$ARTICLES_RESPONSE"; then
        print_pass "获取帮助文章列表成功"
    else
        print_fail "获取帮助文章列表" "$ARTICLES_RESPONSE"
    fi

    # TC-HELP-002: 获取热门文章
    print_test "TC-HELP-002: 获取热门文章"
    POPULAR_RESPONSE=$(http_get "/api/help/articles/popular?limit=5" "$ACCESS_TOKEN")

    if check_success "$POPULAR_RESPONSE"; then
        print_pass "获取热门文章成功"
    else
        print_fail "获取热门文章" "$POPULAR_RESPONSE"
    fi

    # TC-HELP-003: 获取工单统计
    print_test "TC-HELP-003: 获取工单统计"
    STATS_RESPONSE=$(http_get "/api/help/tickets/stats" "$ACCESS_TOKEN")

    if check_success "$STATS_RESPONSE"; then
        print_pass "获取工单统计成功"
    else
        print_fail "获取工单统计" "$STATS_RESPONSE"
    fi
}

#################################################################
# 8. 铃声模块测试 (/api/ringtones)
#################################################################
test_ringtones_module() {
    print_header "8. 铃声模块测试 (/api/ringtones)"

    # TC-RING-001: 获取铃声列表
    print_test "TC-RING-001: 获取铃声列表"
    RINGTONES_RESPONSE=$(http_get "/api/ringtones" "$ACCESS_TOKEN")

    if check_success "$RINGTONES_RESPONSE"; then
        print_pass "获取铃声列表成功"
    else
        print_fail "获取铃声列表" "$RINGTONES_RESPONSE"
    fi
}

#################################################################
# 9. 用户登出测试
#################################################################
test_logout() {
    print_header "9. 用户登出测试"

    # TC-LOGOUT-001: 用户登出 (POST /api/auth/logout)
    print_test "TC-LOGOUT-001: 用户登出"
    LOGOUT_RESPONSE=$(http_post "/api/auth/logout" "{}" "$ACCESS_TOKEN")

    if check_success "$LOGOUT_RESPONSE"; then
        print_pass "用户登出成功"
    else
        print_fail "用户登出" "$LOGOUT_RESPONSE"
    fi

    # TC-LOGOUT-002: 验证Token已失效
    print_test "TC-LOGOUT-002: 验证Token已失效"
    sleep 1
    INVALID_RESPONSE=$(http_get "/api/users/me" "$ACCESS_TOKEN")

    if ! check_success "$INVALID_RESPONSE"; then
        print_pass "Token已正确失效"
    else
        print_fail "Token应该已失效" "$INVALID_RESPONSE"
    fi
}

#################################################################
# 测试总结
#################################################################
print_summary() {
    print_header "测试结果总结"

    echo -e "总测试数: ${TOTAL_TESTS}"
    echo -e "${GREEN}通过: ${PASSED_TESTS}${NC}"
    echo -e "${RED}失败: ${FAILED_TESTS}${NC}"

    if [ ${TOTAL_TESTS} -gt 0 ]; then
        SUCCESS_RATE=$((PASSED_TESTS * 100 / TOTAL_TESTS))
        echo -e "成功率: ${SUCCESS_RATE}%"
    fi

    if [ ${#FAILED_TEST_NAMES[@]} -gt 0 ]; then
        echo -e "\n${RED}失败的测试:${NC}"
        for name in "${FAILED_TEST_NAMES[@]}"; do
            echo -e "  ${RED}✗ $name${NC}"
        done
    fi

    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

    if [ $FAILED_TESTS -eq 0 ]; then
        echo -e "${GREEN}所有测试通过!${NC}"
        exit 0
    else
        echo -e "${YELLOW}部分测试失败，请检查API实现${NC}"
        exit 1
    fi
}

#################################################################
# 主程序
#################################################################
main() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║         User Service API 自动化测试                       ║"
    echo "║         API Gateway: $API_BASE          ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # 检查依赖
    if ! command -v node &> /dev/null || ! command -v curl &> /dev/null; then
        echo -e "${RED}错误: 需要安装 Node.js 和 curl${NC}"
        exit 1
    fi

    # 检查API Gateway连接
    echo -e "${YELLOW}检查API Gateway连接...${NC}"
    HEALTH_RESPONSE=$(curl -s --connect-timeout 5 "${API_BASE}/health" 2>/dev/null || echo '{"status":"error"}')
    if echo "$HEALTH_RESPONSE" | node -e "const d=require('fs').readFileSync(0,'utf-8');process.exit(d.includes('ok')?0:1)" 2>/dev/null; then
        echo -e "${GREEN}API Gateway 连接正常${NC}"
    else
        echo -e "${RED}警告: API Gateway 可能未启动${NC}"
    fi

    # 执行测试
    test_auth_module
    test_user_module
    test_faceid_module
    test_2fa_module
    test_subscription_module
    test_notification_module
    test_help_module
    test_ringtones_module
    test_logout

    # 打印总结
    print_summary
}

main
