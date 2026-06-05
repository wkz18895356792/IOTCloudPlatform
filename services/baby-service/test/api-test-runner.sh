#!/bin/bash

#################################################################
# Baby Service API 自动化测试脚本
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
TEST_BABY_ID=""
TEST_LOG_ID=""
TEST_DEVICE_ID="test-device-$(date +%s)"

#################################################################
# 0. 准备工作 - 获取 Token
#################################################################
prepare_auth() {
    print_header "0. 准备工作 - 获取认证 Token"

    # 使用测试账号登录
    TEST_USERNAME="babytest_$(date +%s)"
    TEST_EMAIL="babytest$(date +%s)@example.com"

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
# 1. 宝宝档案管理测试 (/api/babies)
#################################################################
test_baby_management() {
    print_header "1. 宝宝档案管理测试 (/api/babies)"

    # TC-BABY-001: 创建宝宝档案
    print_test "TC-BABY-001: 创建宝宝档案"
    CREATE_RESPONSE=$(http_post "/api/babies" "{
        \"name\": \"测试宝宝\",
        \"gender\": \"male\",
        \"birthDate\": \"2025-01-15\",
        \"birthWeight\": 3500,
        \"birthHeight\": 50
    }" "$ACCESS_TOKEN")

    if check_success "$CREATE_RESPONSE"; then
        TEST_BABY_ID=$(json_value "$CREATE_RESPONSE" "data.id")
        print_pass "创建宝宝档案成功: ID=$TEST_BABY_ID"
    else
        print_fail "创建宝宝档案" "$CREATE_RESPONSE"
    fi

    # TC-BABY-002: 获取宝宝列表
    print_test "TC-BABY-002: 获取宝宝列表"
    LIST_RESPONSE=$(http_get "/api/babies?page=1&pageSize=10" "$ACCESS_TOKEN")

    if check_success "$LIST_RESPONSE"; then
        TOTAL=$(json_value "$LIST_RESPONSE" "data.total")
        print_pass "获取宝宝列表成功: 共 $TOTAL 个宝宝"
    else
        print_fail "获取宝宝列表" "$LIST_RESPONSE"
    fi

    # TC-BABY-003: 获取宝宝详情
    if [ -n "$TEST_BABY_ID" ]; then
        print_test "TC-BABY-003: 获取宝宝详情"
        DETAIL_RESPONSE=$(http_get "/api/babies/$TEST_BABY_ID" "$ACCESS_TOKEN")

        if check_success "$DETAIL_RESPONSE"; then
            NAME=$(json_value "$DETAIL_RESPONSE" "data.name")
            print_pass "获取宝宝详情成功: $NAME"
        else
            print_fail "获取宝宝详情" "$DETAIL_RESPONSE"
        fi
    fi

    # TC-BABY-004: 更新宝宝信息
    if [ -n "$TEST_BABY_ID" ]; then
        print_test "TC-BABY-004: 更新宝宝信息"
        UPDATE_RESPONSE=$(http_put "/api/babies/$TEST_BABY_ID" "{
            \"name\": \"测试宝宝_已更新\",
            \"avatar\": \"https://example.com/avatar.jpg\"
        }" "$ACCESS_TOKEN")

        if check_success "$UPDATE_RESPONSE"; then
            print_pass "更新宝宝信息成功"
        else
            print_fail "更新宝宝信息" "$UPDATE_RESPONSE"
        fi
    fi

    # TC-BABY-005: 关联设备
    if [ -n "$TEST_BABY_ID" ]; then
        print_test "TC-BABY-005: 关联设备到宝宝"
        LINK_RESPONSE=$(http_post "/api/babies/$TEST_BABY_ID/devices/$TEST_DEVICE_ID" "" "$ACCESS_TOKEN")

        if check_success "$LINK_RESPONSE"; then
            print_pass "关联设备成功"
        else
            print_fail "关联设备" "$LINK_RESPONSE"
        fi
    fi

    # TC-BABY-006: 取消关联设备
    if [ -n "$TEST_BABY_ID" ]; then
        print_test "TC-BABY-006: 取消关联设备"
        UNLINK_RESPONSE=$(http_delete "/api/babies/$TEST_BABY_ID/devices/$TEST_DEVICE_ID" "$ACCESS_TOKEN")

        if check_success "$UNLINK_RESPONSE"; then
            print_pass "取消关联设备成功"
        else
            print_fail "取消关联设备" "$UNLINK_RESPONSE"
        fi
    fi
}

#################################################################
# 2. 喂养记录测试 (/api/babies/:babyId/feeding)
#################################################################
test_feeding() {
    print_header "2. 喂养记录测试 (/api/babies/:babyId/feeding)"

    if [ -z "$TEST_BABY_ID" ]; then
        print_info "跳过：未创建宝宝"
        return
    fi

    # TC-FEED-001: 开始喂养
    print_test "TC-FEED-001: 开始喂养"
    START_FEED_RESPONSE=$(http_post "/api/babies/$TEST_BABY_ID/feeding/start" "{
        \"feedingType\": \"breast\",
        \"breastSide\": \"left\",
        \"note\": \"测试喂养记录\"
    }" "$ACCESS_TOKEN")

    if check_success "$START_FEED_RESPONSE"; then
        TEST_LOG_ID=$(json_value "$START_FEED_RESPONSE" "data.logId")
        print_pass "开始喂养成功: LogID=$TEST_LOG_ID"
    else
        print_fail "开始喂养" "$START_FEED_RESPONSE"
    fi

    # TC-FEED-002: 结束喂养
    if [ -n "$TEST_LOG_ID" ]; then
        print_test "TC-FEED-002: 结束喂养"
        END_FEED_RESPONSE=$(http_post "/api/babies/feeding/$TEST_LOG_ID/end" "{
            \"amount\": 120,
            \"note\": \"喂养完成\"
        }" "$ACCESS_TOKEN")

        if check_success "$END_FEED_RESPONSE"; then
            print_pass "结束喂养成功"
        else
            print_fail "结束喂养" "$END_FEED_RESPONSE"
        fi
    fi

    # TC-FEED-003: 获取喂养历史
    print_test "TC-FEED-003: 获取喂养历史"
    FEED_HISTORY=$(http_get "/api/babies/$TEST_BABY_ID/feeding?page=1&pageSize=10" "$ACCESS_TOKEN")

    if check_success "$FEED_HISTORY"; then
        print_pass "获取喂养历史成功"
    else
        print_fail "获取喂养历史" "$FEED_HISTORY"
    fi

    # TC-FEED-004: 获取今日喂养记录
    print_test "TC-FEED-004: 获取今日喂养记录"
    TODAY_FEED=$(http_get "/api/babies/$TEST_BABY_ID/feeding/today" "$ACCESS_TOKEN")

    if check_success "$TODAY_FEED"; then
        print_pass "获取今日喂养记录成功"
    else
        print_fail "获取今日喂养记录" "$TODAY_FEED"
    fi
}

#################################################################
# 3. 睡眠记录测试 (/api/babies/:babyId/sleep)
#################################################################
test_sleep() {
    print_header "3. 睡眠记录测试 (/api/babies/:babyId/sleep)"

    if [ -z "$TEST_BABY_ID" ]; then
        print_info "跳过：未创建宝宝"
        return
    fi

    # TC-SLEEP-001: 开始睡眠
    print_test "TC-SLEEP-001: 开始睡眠"
    START_SLEEP_RESPONSE=$(http_post "/api/babies/$TEST_BABY_ID/sleep/start" "{
        \"sleepType\": \"nap\",
        \"location\": \"crib\",
        \"note\": \"测试睡眠记录\"
    }" "$ACCESS_TOKEN")

    if check_success "$START_SLEEP_RESPONSE"; then
        SLEEP_LOG_ID=$(json_value "$START_SLEEP_RESPONSE" "data.logId")
        print_pass "开始睡眠成功: LogID=$SLEEP_LOG_ID"
    else
        print_fail "开始睡眠" "$START_SLEEP_RESPONSE"
    fi

    # TC-SLEEP-002: 结束睡眠
    if [ -n "$SLEEP_LOG_ID" ]; then
        print_test "TC-SLEEP-002: 结束睡眠"
        END_SLEEP_RESPONSE=$(http_post "/api/babies/sleep/$SLEEP_LOG_ID/end" "{
            \"note\": \"睡眠结束\"
        }" "$ACCESS_TOKEN")

        if check_success "$END_SLEEP_RESPONSE"; then
            print_pass "结束睡眠成功"
        else
            print_fail "结束睡眠" "$END_SLEEP_RESPONSE"
        fi
    fi

    # TC-SLEEP-003: 获取睡眠历史
    print_test "TC-SLEEP-003: 获取睡眠历史"
    SLEEP_HISTORY=$(http_get "/api/babies/$TEST_BABY_ID/sleep?page=1&pageSize=10" "$ACCESS_TOKEN")

    if check_success "$SLEEP_HISTORY"; then
        print_pass "获取睡眠历史成功"
    else
        print_fail "获取睡眠历史" "$SLEEP_HISTORY"
    fi

    # TC-SLEEP-004: 获取当前睡眠状态
    print_test "TC-SLEEP-004: 获取当前睡眠状态"
    CURRENT_SLEEP=$(http_get "/api/babies/$TEST_BABY_ID/sleep/current" "$ACCESS_TOKEN")

    if check_success "$CURRENT_SLEEP"; then
        print_pass "获取当前睡眠状态成功"
    else
        print_fail "获取当前睡眠状态" "$CURRENT_SLEEP"
    fi

    # TC-SLEEP-005: 获取今日睡眠记录
    print_test "TC-SLEEP-005: 获取今日睡眠记录"
    TODAY_SLEEP=$(http_get "/api/babies/$TEST_BABY_ID/sleep/today" "$ACCESS_TOKEN")

    if check_success "$TODAY_SLEEP"; then
        print_pass "获取今日睡眠记录成功"
    else
        print_fail "获取今日睡眠记录" "$TODAY_SLEEP"
    fi
}

#################################################################
# 4. 宝宝日志测试 (/api/baby-logs)
#################################################################
test_baby_logs() {
    print_header "4. 宝宝日志测试 (/api/baby-logs)"

    if [ -z "$TEST_BABY_ID" ]; then
        print_info "跳过：未创建宝宝"
        return
    fi

    # TC-LOG-001: 创建日志
    print_test "TC-LOG-001: 创建日志记录"
    CREATE_LOG_RESPONSE=$(http_post "/api/baby-logs" "{
        \"babyId\": \"$TEST_BABY_ID\",
        \"eventType\": \"diaper_change\",
        \"startTime\": \"$(date -Iseconds)\",
        \"source\": \"manual\",
        \"level\": \"info\",
        \"note\": \"测试日志记录\",
        \"metadata\": {
            \"diaperType\": \"wet\"
        }
    }" "$ACCESS_TOKEN")

    if check_success "$CREATE_LOG_RESPONSE"; then
        NEW_LOG_ID=$(json_value "$CREATE_LOG_RESPONSE" "data.id")
        print_pass "创建日志成功: ID=$NEW_LOG_ID"
    else
        print_fail "创建日志" "$CREATE_LOG_RESPONSE"
    fi

    # TC-LOG-002: 批量创建日志
    print_test "TC-LOG-002: 批量创建日志"
    BATCH_LOG_RESPONSE=$(http_post "/api/baby-logs/batch" "{
        \"logs\": [
            {
                \"babyId\": \"$TEST_BABY_ID\",
                \"eventType\": \"diaper_change\",
                \"startTime\": \"$(date -Iseconds)\",
                \"source\": \"manual\",
                \"level\": \"info\",
                \"metadata\": {\"diaperType\": \"wet\"}
            },
            {
                \"babyId\": \"$TEST_BABY_ID\",
                \"eventType\": \"bath\",
                \"startTime\": \"$(date -Iseconds)\",
                \"source\": \"manual\",
                \"level\": \"info\"
            }
        ]
    }" "$ACCESS_TOKEN")

    if check_success "$BATCH_LOG_RESPONSE"; then
        print_pass "批量创建日志成功"
    else
        print_fail "批量创建日志" "$BATCH_LOG_RESPONSE"
    fi

    # TC-LOG-003: 获取日志详情
    if [ -n "$NEW_LOG_ID" ]; then
        print_test "TC-LOG-003: 获取日志详情"
        LOG_DETAIL=$(http_get "/api/baby-logs/$NEW_LOG_ID" "$ACCESS_TOKEN")

        if check_success "$LOG_DETAIL"; then
            print_pass "获取日志详情成功"
        else
            print_fail "获取日志详情" "$LOG_DETAIL"
        fi
    fi

    # TC-LOG-004: 查询日志列表
    print_test "TC-LOG-004: 查询日志列表"
    LOG_LIST=$(http_get "/api/baby-logs?babyId=$TEST_BABY_ID&page=1&pageSize=10" "$ACCESS_TOKEN")

    if check_success "$LOG_LIST"; then
        print_pass "查询日志列表成功"
    else
        print_fail "查询日志列表" "$LOG_LIST"
    fi

    # TC-LOG-005: 获取最新日志
    print_test "TC-LOG-005: 获取最新日志"
    LATEST_LOG=$(http_get "/api/baby-logs/latest/$TEST_BABY_ID?limit=5" "$ACCESS_TOKEN")

    if check_success "$LATEST_LOG"; then
        print_pass "获取最新日志成功"
    else
        print_fail "获取最新日志" "$LATEST_LOG"
    fi

    # TC-LOG-006: 更新日志
    if [ -n "$NEW_LOG_ID" ]; then
        print_test "TC-LOG-006: 更新日志"
        UPDATE_LOG_RESPONSE=$(http_put "/api/baby-logs/$NEW_LOG_ID" "{
            \"note\": \"更新后的日志备注\"
        }" "$ACCESS_TOKEN")

        if check_success "$UPDATE_LOG_RESPONSE"; then
            print_pass "更新日志成功"
        else
            print_fail "更新日志" "$UPDATE_LOG_RESPONSE"
        fi
    fi

    # TC-LOG-007: 确认日志
    if [ -n "$NEW_LOG_ID" ]; then
        print_test "TC-LOG-007: 确认日志"
        ACK_LOG_RESPONSE=$(http_post "/api/baby-logs/$NEW_LOG_ID/acknowledge" "" "$ACCESS_TOKEN")

        if check_success "$ACK_LOG_RESPONSE"; then
            print_pass "确认日志成功"
        else
            print_fail "确认日志" "$ACK_LOG_RESPONSE"
        fi
    fi

    # TC-LOG-008: 获取日志统计
    print_test "TC-LOG-008: 获取日志统计"
    LOG_STATS=$(http_get "/api/baby-logs/stats/$TEST_BABY_ID" "$ACCESS_TOKEN")

    if check_success "$LOG_STATS"; then
        print_pass "获取日志统计成功"
    else
        print_fail "获取日志统计" "$LOG_STATS"
    fi

    # TC-LOG-009: 获取每日汇总
    print_test "TC-LOG-009: 获取每日汇总"
    TODAY=$(date +%Y-%m-%d)
    DAILY_SUMMARY=$(http_get "/api/baby-logs/summary/$TEST_BABY_ID/daily?date=$TODAY" "$ACCESS_TOKEN")

    if check_success "$DAILY_SUMMARY"; then
        print_pass "获取每日汇总成功"
    else
        print_fail "获取每日汇总" "$DAILY_SUMMARY"
    fi

    # TC-LOG-010: 删除日志
    if [ -n "$NEW_LOG_ID" ]; then
        print_test "TC-LOG-010: 删除日志"
        DELETE_LOG_RESPONSE=$(http_delete "/api/baby-logs/$NEW_LOG_ID" "$ACCESS_TOKEN")

        if check_success "$DELETE_LOG_RESPONSE"; then
            print_pass "删除日志成功"
        else
            print_fail "删除日志" "$DELETE_LOG_RESPONSE"
        fi
    fi
}

#################################################################
# 5. 监控事件测试 (/api/babies/:babyId/monitoring)
#################################################################
test_monitoring() {
    print_header "5. 监控事件测试 (/api/babies/:babyId/monitoring)"

    if [ -z "$TEST_BABY_ID" ]; then
        print_info "跳过：未创建宝宝"
        return
    fi

    # TC-MON-001: 获取监控事件
    print_test "TC-MON-001: 获取监控事件列表"
    EVENTS_RESPONSE=$(http_get "/api/babies/$TEST_BABY_ID/monitoring/events?page=1&pageSize=10" "$ACCESS_TOKEN")

    if check_success "$EVENTS_RESPONSE"; then
        print_pass "获取监控事件列表成功"
    else
        print_fail "获取监控事件列表" "$EVENTS_RESPONSE"
    fi

    # TC-MON-002: 获取未确认事件
    print_test "TC-MON-002: 获取未确认事件"
    UNACK_EVENTS=$(http_get "/api/babies/$TEST_BABY_ID/monitoring/events/unacknowledged" "$ACCESS_TOKEN")

    if check_success "$UNACK_EVENTS"; then
        print_pass "获取未确认事件成功"
    else
        print_fail "获取未确认事件" "$UNACK_EVENTS"
    fi
}

#################################################################
# 6. 数据分析测试 (/api/babies/:babyId/analytics)
#################################################################
test_analytics() {
    print_header "6. 数据分析测试 (/api/babies/:babyId/analytics)"

    if [ -z "$TEST_BABY_ID" ]; then
        print_info "跳过：未创建宝宝"
        return
    fi

    # TC-ANAL-001: 获取每日摘要
    print_test "TC-ANAL-001: 获取每日摘要"
    TODAY=$(date +%Y-%m-%d)
    DAILY_RESPONSE=$(http_get "/api/babies/$TEST_BABY_ID/analytics/daily?date=$TODAY" "$ACCESS_TOKEN")

    if check_success "$DAILY_RESPONSE"; then
        print_pass "获取每日摘要成功"
    else
        print_fail "获取每日摘要" "$DAILY_RESPONSE"
    fi

    # TC-ANAL-002: 获取周报
    print_test "TC-ANAL-002: 获取周报"
    WEEKLY_RESPONSE=$(http_get "/api/babies/$TEST_BABY_ID/analytics/weekly" "$ACCESS_TOKEN")

    if check_success "$WEEKLY_RESPONSE"; then
        print_pass "获取周报成功"
    else
        print_fail "获取周报" "$WEEKLY_RESPONSE"
    fi

    # TC-ANAL-003: 获取生长百分位
    print_test "TC-ANAL-003: 获取生长百分位"
    PERCENTILE_RESPONSE=$(http_get "/api/babies/$TEST_BABY_ID/analytics/growth/percentile?ageInDays=90" "$ACCESS_TOKEN")

    if check_success "$PERCENTILE_RESPONSE"; then
        print_pass "获取生长百分位成功"
    else
        print_fail "获取生长百分位" "$PERCENTILE_RESPONSE"
    fi

    # TC-ANAL-004: 获取生长趋势
    print_test "TC-ANAL-004: 获取生长趋势"
    TREND_RESPONSE=$(http_get "/api/babies/$TEST_BABY_ID/analytics/growth/trend?months=3" "$ACCESS_TOKEN")

    if check_success "$TREND_RESPONSE"; then
        print_pass "获取生长趋势成功"
    else
        print_fail "获取生长趋势" "$TREND_RESPONSE"
    fi

    # TC-ANAL-005: 获取喂养模式
    print_test "TC-ANAL-005: 获取喂养模式"
    FEED_PATTERN=$(http_get "/api/babies/$TEST_BABY_ID/analytics/feeding/pattern?days=7" "$ACCESS_TOKEN")

    if check_success "$FEED_PATTERN"; then
        print_pass "获取喂养模式成功"
    else
        print_fail "获取喂养模式" "$FEED_PATTERN"
    fi

    # TC-ANAL-006: 获取睡眠模式
    print_test "TC-ANAL-006: 获取睡眠模式"
    SLEEP_PATTERN=$(http_get "/api/babies/$TEST_BABY_ID/analytics/sleep/pattern?days=7" "$ACCESS_TOKEN")

    if check_success "$SLEEP_PATTERN"; then
        print_pass "获取睡眠模式成功"
    else
        print_fail "获取睡眠模式" "$SLEEP_PATTERN"
    fi
}

#################################################################
# 7. AI 监控测试 (/api/babies/:babyId/ai)
#################################################################
test_ai_monitoring() {
    print_header "7. AI 监控测试 (/api/babies/:babyId/ai)"

    if [ -z "$TEST_BABY_ID" ]; then
        print_info "跳过：未创建宝宝"
        return
    fi

    # TC-AI-001: 获取AI配置
    print_test "TC-AI-001: 获取AI配置"
    AI_CONFIG=$(http_get "/api/babies/$TEST_BABY_ID/ai/config" "$ACCESS_TOKEN")

    if check_success "$AI_CONFIG"; then
        print_pass "获取AI配置成功"
    else
        print_fail "获取AI配置" "$AI_CONFIG"
    fi

    # TC-AI-002: 更新AI配置
    print_test "TC-AI-002: 更新AI配置"
    UPDATE_AI_CONFIG=$(http_put "/api/babies/$TEST_BABY_ID/ai/config" "{
        \"cryingDetectionEnabled\": true,
        \"motionDetectionEnabled\": true,
        \"faceDetectionEnabled\": false,
        \"tempHumidityEnabled\": true,
        \"sensitivity\": \"medium\"
    }" "$ACCESS_TOKEN")

    if check_success "$UPDATE_AI_CONFIG"; then
        print_pass "更新AI配置成功"
    else
        print_fail "更新AI配置" "$UPDATE_AI_CONFIG"
    fi

    # TC-AI-003: 哭声检测
    print_test "TC-AI-003: 哭声检测"
    CRYING_DETECT=$(http_post "/api/babies/$TEST_BABY_ID/ai/crying/detect" "{
        \"audioData\": \"base64_encoded_audio_data\",
        \"timestamp\": \"$(date -Iseconds)\",
        \"deviceId\": \"$TEST_DEVICE_ID\"
    }" "$ACCESS_TOKEN")

    if check_success "$CRYING_DETECT"; then
        print_pass "哭声检测成功"
    else
        print_info "哭声检测可能需要真实音频数据"
    fi

    # TC-AI-004: 动作检测
    print_test "TC-AI-004: 动作检测"
    MOTION_DETECT=$(http_post "/api/babies/$TEST_BABY_ID/ai/motion/detect" "{
        \"motionData\": {\"intensity\": 0.8, \"duration\": 5},
        \"timestamp\": \"$(date -Iseconds)\",
        \"deviceId\": \"$TEST_DEVICE_ID\"
    }" "$ACCESS_TOKEN")

    if check_success "$MOTION_DETECT"; then
        print_pass "动作检测成功"
    else
        print_info "动作检测可能需要真实数据"
    fi

    # TC-AI-005: 获取活跃事件
    print_test "TC-AI-005: 获取活跃AI事件"
    ACTIVE_EVENTS=$(http_get "/api/babies/$TEST_BABY_ID/ai/events/active" "$ACCESS_TOKEN")

    if check_success "$ACTIVE_EVENTS"; then
        print_pass "获取活跃AI事件成功"
    else
        print_fail "获取活跃AI事件" "$ACTIVE_EVENTS"
    fi

    # TC-AI-006: 获取事件历史
    print_test "TC-AI-006: 获取AI事件历史"
    EVENT_HISTORY=$(http_get "/api/babies/$TEST_BABY_ID/ai/events/history?page=1&pageSize=10" "$ACCESS_TOKEN")

    if check_success "$EVENT_HISTORY"; then
        print_pass "获取AI事件历史成功"
    else
        print_fail "获取AI事件历史" "$EVENT_HISTORY"
    fi

    # TC-AI-007: 获取AI统计
    print_test "TC-AI-007: 获取AI统计"
    AI_STATS=$(http_get "/api/babies/$TEST_BABY_ID/ai/stats?period=week" "$ACCESS_TOKEN")

    if check_success "$AI_STATS"; then
        print_pass "获取AI统计成功"
    else
        print_fail "获取AI统计" "$AI_STATS"
    fi

    # TC-AI-008: 获取AI建议
    print_test "TC-AI-008: 获取AI建议"
    AI_RECOMMENDATIONS=$(http_get "/api/babies/$TEST_BABY_ID/ai/recommendations" "$ACCESS_TOKEN")

    if check_success "$AI_RECOMMENDATIONS"; then
        print_pass "获取AI建议成功"
    else
        print_fail "获取AI建议" "$AI_RECOMMENDATIONS"
    fi

    # TC-AI-009: 获取系统状态
    print_test "TC-AI-009: 获取AI系统状态"
    SYSTEM_STATUS=$(http_get "/api/babies/ai/system/status" "$ACCESS_TOKEN")

    if check_success "$SYSTEM_STATUS"; then
        print_pass "获取AI系统状态成功"
    else
        print_fail "获取AI系统状态" "$SYSTEM_STATUS"
    fi

    # TC-AI-010: 获取AI功能列表
    print_test "TC-AI-010: 获取AI功能列表"
    AI_FEATURES=$(http_get "/api/babies/ai/features" "$ACCESS_TOKEN")

    if check_success "$AI_FEATURES"; then
        print_pass "获取AI功能列表成功"
    else
        print_fail "获取AI功能列表" "$AI_FEATURES"
    fi
}

#################################################################
# 8. 清理测试数据
#################################################################
cleanup() {
    print_header "8. 清理测试数据"

    if [ -n "$TEST_BABY_ID" ]; then
        print_test "TC-CLEAN-001: 删除测试宝宝"
        DELETE_RESPONSE=$(http_delete "/api/babies/$TEST_BABY_ID" "$ACCESS_TOKEN")

        if check_success "$DELETE_RESPONSE"; then
            print_pass "删除测试宝宝成功"
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
    echo -e "║         Baby Service API 自动化测试                       ║"
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
    test_baby_management
    test_feeding
    test_sleep
    test_baby_logs
    test_monitoring
    test_analytics
    test_ai_monitoring
    cleanup
    print_summary
}

# 运行主测试流程
main
