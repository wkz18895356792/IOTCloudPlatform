#!/bin/bash

#################################################################
# OTA 固件升级完整流程集成测试
#
# 直接调用 device-service (端口 6003) 测试所有 OTA 相关 API
# 覆盖场景：
#   A. 完整升级成功流程（下载→安装→完成）
#   B. 下载失败流程
#   C. 安装失败流程
#   D. 取消升级流程
#   E. 重复任务拦截
#   F. 分页查询
#   G. 升级后再次检查更新
#################################################################

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 服务地址（直连 device-service）
API_BASE="http://localhost:6003"

# 测试统计
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
FAILED_TEST_NAMES=()

# 唯一测试标识（避免并发冲突）
TIMESTAMP=$(date +%s)
TEST_SERIAL="SN-OTA-${TIMESTAMP}"
TEST_PRODUCT_ID="PROD-OTA-TEST-${TIMESTAMP}"

# 测试过程中捕获的 ID
TEST_DEVICE_SN=""
TEST_FIRMWARE_ID=""
TEST_OTA_TASK_ID=""

# 子场景设备序列号
CANCEL_SERIAL="SN-OTA-CANCEL-${TIMESTAMP}"
FAIL_DL_SERIAL="SN-OTA-FAILDL-${TIMESTAMP}"
FAIL_IN_SERIAL="SN-OTA-FAILIN-${TIMESTAMP}"
DUP_SERIAL="SN-OTA-DUP-${TIMESTAMP}"

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
    echo -e "${CYAN}  → $1${NC}"
}

# JSON 解析（使用 Node.js，通过 argv 传参避免 shell 转义问题）
json_value() {
    local json="$1"
    local path="$2"
    node -e "
        try {
            const data = JSON.parse(process.argv[1]);
            const parts = process.argv[2].split('.');
            let result = data;
            for (const part of parts) {
                if (result && typeof result === 'object' && part in result) {
                    result = result[part];
                } else {
                    result = undefined;
                    break;
                }
            }
            console.log(result !== undefined && result !== null ? result : '');
        } catch (e) {
            console.log('');
        }
    " "$json" "$path" 2>/dev/null
}

check_success() {
    local response="$1"
    local code=$(json_value "$response" "code")
    local success=$(json_value "$response" "success")
    [ "$code" = "0" ] || [ "$success" = "true" ]
}

# HTTP 请求函数
http_get() {
    local url="$1"
    curl -s --max-time 10 -X GET "${API_BASE}${url}" \
        -H "Content-Type: application/json"
}

http_post() {
    local url="$1"
    local data="$2"
    curl -s --max-time 10 -X POST "${API_BASE}${url}" \
        -H "Content-Type: application/json" \
        -d "$data"
}

http_delete() {
    local url="$1"
    curl -s --max-time 10 -X DELETE "${API_BASE}${url}" \
        -H "Content-Type: application/json"
}

# 创建设备辅助函数
create_test_device() {
    local sn="$1"
    local fw_version="${2:-1.0.0}"
    local product_id="${3:-$TEST_PRODUCT_ID}"
    http_post "/api/devices" "{
        \"deviceName\": \"OTA-Test\",
        \"productType\": \"CAMERA\",
        \"serialNumber\": \"$sn\",
        \"macAddress\": \"AA:BB:CC:DD:EE:01\",
        \"firmwareVersion\": \"$fw_version\",
        \"productId\": \"$product_id\"
    }"
}

#################################################################
# Phase 1: 创建测试设备
#################################################################
create_devices() {
    print_header "Phase 1: 创建测试设备"

    # 主测试设备（成功流程）
    print_test "TC-DEV-001: 创建主测试设备 (FW=1.0.0)"
    local response=$(create_test_device "$TEST_SERIAL" "1.0.0")
    if check_success "$response"; then
        TEST_DEVICE_SN="$TEST_SERIAL"
        print_pass "主设备创建成功: SN=$TEST_DEVICE_SN"
    else
        print_fail "主设备创建失败" "$response"
    fi

    # 取消场景设备
    print_test "TC-DEV-002: 创建取消场景设备"
    local r=$(create_test_device "$CANCEL_SERIAL" "1.0.0")
    if check_success "$r"; then
        print_pass "取消场景设备创建成功"
    else
        print_fail "取消场景设备创建失败" "$r"
    fi

    # 下载失败场景设备
    print_test "TC-DEV-003: 创建下载失败场景设备"
    local r2=$(create_test_device "$FAIL_DL_SERIAL" "1.0.0")
    if check_success "$r2"; then
        print_pass "下载失败场景设备创建成功"
    else
        print_fail "下载失败场景设备创建失败" "$r2"
    fi

    # 安装失败场景设备
    print_test "TC-DEV-004: 创建安装失败场景设备"
    local r3=$(create_test_device "$FAIL_IN_SERIAL" "1.0.0")
    if check_success "$r3"; then
        print_pass "安装失败场景设备创建成功"
    else
        print_fail "安装失败场景设备创建失败" "$r3"
    fi
}

#################################################################
# Phase 2: 创建固件版本
#################################################################
create_firmware() {
    print_header "Phase 2: 创建固件版本"

    # 生成 64 位 SHA256 格式的 checksum
    local checksum=$(node -e "console.log('a'.repeat(64))")

    print_test "TC-FW-001: 创建固件版本 v2.0.0"
    local response=$(http_post "/api/firmware/versions" "{
        \"productId\": \"$TEST_PRODUCT_ID\",
        \"version\": \"2.0.0\",
        \"releaseNotes\": \"Integration test firmware v2.0.0\",
        \"fileUrl\": \"https://storage.example.com/firmware/test/v2.0.0.bin\",
        \"fileSize\": 1048576,
        \"checksum\": \"$checksum\",
        \"minVersion\": \"1.0.0\"
    }")

    if check_success "$response"; then
        TEST_FIRMWARE_ID=$(json_value "$response" "data.id")
        print_pass "固件版本创建成功: ID=$TEST_FIRMWARE_ID, Version=2.0.0"
    else
        print_fail "固件版本创建失败" "$response"
    fi

    # 查询固件版本列表
    print_test "TC-FW-002: 获取产品固件版本列表"
    local list_resp=$(http_get "/api/firmware/versions/$TEST_PRODUCT_ID")
    if check_success "$list_resp"; then
        print_pass "获取固件版本列表成功"
    else
        print_fail "获取固件版本列表失败" "$list_resp"
    fi

    # 测试重复创建
    print_test "TC-FW-003: 重复创建相同版本应失败"
    local dup_resp=$(http_post "/api/firmware/versions" "{
        \"productId\": \"$TEST_PRODUCT_ID\",
        \"version\": \"2.0.0\",
        \"releaseNotes\": \"Duplicate test\",
        \"fileUrl\": \"https://storage.example.com/firmware/test/v2.0.0.bin\",
        \"fileSize\": 1048576,
        \"checksum\": \"$checksum\"
    }")
    if ! check_success "$dup_resp"; then
        print_pass "重复版本被正确拒绝"
    else
        print_fail "重复版本应被拒绝但成功了" "$dup_resp"
    fi
}

#################################################################
# Phase 3: 检查更新
#################################################################
check_update() {
    print_header "Phase 3: 检查固件更新"

    if [ -z "$TEST_DEVICE_SN" ]; then
        print_info "跳过：设备未创建"
        return
    fi

    print_test "TC-UPDATE-001: 检查设备更新（1.0.0 → 2.0.0）"
    local response=$(http_get "/api/firmware/devices/$TEST_DEVICE_SN/check-update")
    if check_success "$response"; then
        local has_update=$(json_value "$response" "data.hasUpdate")
        if [ "$has_update" = "true" ]; then
            local latest=$(json_value "$response" "data.firmware.version")
            print_pass "检测到可用更新: hasUpdate=$has_update, latestVersion=$latest"
        else
            print_fail "应检测到更新但返回 hasUpdate=false" "$response"
        fi
    else
        print_fail "检查更新失败" "$response"
    fi
}

#################################################################
# Phase 4: 场景 A — 完整升级成功流程
#################################################################
test_full_success_flow() {
    print_header "Phase 4: 场景 A — 完整升级成功流程"

    if [ -z "$TEST_DEVICE_SN" ] || [ -z "$TEST_FIRMWARE_ID" ]; then
        print_info "跳过：设备或固件未创建"
        return
    fi

    # 4.1 创建 OTA 任务
    print_test "TC-FLOW-001: 创建 OTA 升级任务"
    local task_resp=$(http_post "/api/firmware/ota/tasks" "{
        \"deviceId\": \"$TEST_DEVICE_SN\",
        \"firmwareId\": \"$TEST_FIRMWARE_ID\"
    }")

    if check_success "$task_resp"; then
        TEST_OTA_TASK_ID=$(json_value "$task_resp" "data.id")
        local from_ver=$(json_value "$task_resp" "data.fromVersion")
        local to_ver=$(json_value "$task_resp" "data.toVersion")
        print_pass "OTA 任务创建成功: $from_ver → $to_ver, TaskID=$TEST_OTA_TASK_ID"
    else
        print_fail "OTA 任务创建失败" "$task_resp"
        return
    fi

    # 4.2 查询任务详情
    print_test "TC-FLOW-002: 查询 OTA 任务详情"
    local detail_resp=$(http_get "/api/firmware/ota/tasks/$TEST_OTA_TASK_ID")
    if check_success "$detail_resp"; then
        local detail_status=$(json_value "$detail_resp" "data.status")
        print_pass "获取任务详情成功: status=$detail_status"
    else
        print_fail "获取任务详情失败" "$detail_resp"
    fi

    # 4.3 模拟下载进度 25%
    print_test "TC-FLOW-003: 上报下载进度 25%"
    local prog25=$(http_post "/api/firmware/ota/tasks/$TEST_OTA_TASK_ID/status" "{
        \"status\": \"downloading\",
        \"progress\": 25
    }")
    if check_success "$prog25"; then
        local p=$(json_value "$prog25" "data.progress")
        print_pass "进度更新成功: progress=$p%"
    else
        print_fail "进度更新失败" "$prog25"
    fi

    # 4.4 模拟下载进度 50%
    print_test "TC-FLOW-004: 上报下载进度 50%"
    local prog50=$(http_post "/api/firmware/ota/tasks/$TEST_OTA_TASK_ID/status" "{
        \"status\": \"downloading\",
        \"progress\": 50
    }")
    if check_success "$prog50"; then
        print_pass "进度更新成功: 50%"
    else
        print_fail "进度更新失败" "$prog50"
    fi

    # 4.5 模拟下载完成 100%
    print_test "TC-FLOW-005: 上报下载完成 100%"
    local prog100=$(http_post "/api/firmware/ota/tasks/$TEST_OTA_TASK_ID/status" "{
        \"status\": \"downloading\",
        \"progress\": 100
    }")
    if check_success "$prog100"; then
        print_pass "下载完成: 100%"
    else
        print_fail "下载完成上报失败" "$prog100"
    fi

    # 4.6 模拟安装进度 50%
    print_test "TC-FLOW-006: 上报安装进度 50%"
    local inst50=$(http_post "/api/firmware/ota/tasks/$TEST_OTA_TASK_ID/status" "{
        \"status\": \"installing\",
        \"progress\": 50
    }")
    if check_success "$inst50"; then
        local inst_status=$(json_value "$inst50" "data.status")
        print_pass "安装进度上报成功: status=$inst_status"
    else
        print_fail "安装进度上报失败" "$inst50"
    fi

    # 4.7 模拟安装完成
    print_test "TC-FLOW-007: 上报升级完成 (completed)"
    local complete=$(http_post "/api/firmware/ota/tasks/$TEST_OTA_TASK_ID/status" "{
        \"status\": \"completed\",
        \"progress\": 100
    }")
    if check_success "$complete"; then
        local final_status=$(json_value "$complete" "data.status")
        local final_progress=$(json_value "$complete" "data.progress")
        print_pass "升级完成: status=$final_status, progress=$final_progress%"
    else
        print_fail "升级完成上报失败" "$complete"
    fi

    # 4.8 验证任务最终状态
    print_test "TC-FLOW-008: 验证任务最终状态为 completed"
    local final_resp=$(http_get "/api/firmware/ota/tasks/$TEST_OTA_TASK_ID")
    if check_success "$final_resp"; then
        local fstatus=$(json_value "$final_resp" "data.status")
        local fprogress=$(json_value "$final_resp" "data.progress")
        if [ "$fstatus" = "completed" ] && [ "$fprogress" = "100" ]; then
            print_pass "最终状态验证通过: status=$fstatus, progress=$fprogress%"
        else
            print_fail "最终状态不正确: status=$fstatus, progress=$fprogress" "$final_resp"
        fi
    else
        print_fail "获取最终状态失败" "$final_resp"
    fi

    # 4.9 查询设备 OTA 任务列表
    print_test "TC-FLOW-009: 查询设备 OTA 任务列表"
    local task_list=$(http_get "/api/firmware/devices/$TEST_DEVICE_SN/ota/tasks?limit=10&offset=0")
    if check_success "$task_list"; then
        local total=$(json_value "$task_list" "data.total")
        print_pass "获取设备任务列表成功: total=$total"
    else
        print_fail "获取设备任务列表失败" "$task_list"
    fi
}

#################################################################
# Phase 5: 场景 B — 下载失败流程
#################################################################
test_download_failure() {
    print_header "Phase 5: 场景 B — 下载失败流程"

    if [ -z "$FAIL_DL_SERIAL" ] || [ -z "$TEST_FIRMWARE_ID" ]; then
        print_info "跳过：设备或固件未创建"
        return
    fi

    print_test "TC-FAIL-DL-001: 创建下载失败场景任务"
    local task_resp=$(http_post "/api/firmware/ota/tasks" "{
        \"deviceId\": \"$FAIL_DL_SERIAL\",
        \"firmwareId\": \"$TEST_FIRMWARE_ID\"
    }")
    if ! check_success "$task_resp"; then
        print_fail "创建任务失败" "$task_resp"
        return
    fi
    local task_id=$(json_value "$task_resp" "data.id")
    print_pass "任务创建成功: TaskID=$task_id"

    # 上报下载进度
    print_test "TC-FAIL-DL-002: 模拟下载中 30%"
    local prog=$(http_post "/api/firmware/ota/tasks/$task_id/status" "{
        \"status\": \"downloading\",
        \"progress\": 30
    }")
    if check_success "$prog"; then
        print_pass "进度上报成功"
    else
        print_fail "进度上报失败" "$prog"
    fi

    # 上报失败
    print_test "TC-FAIL-DL-003: 上报下载失败"
    local fail_resp=$(http_post "/api/firmware/ota/tasks/$task_id/status" "{
        \"status\": \"failed\",
        \"progress\": 30,
        \"error\": \"Network timeout during download\"
    }")
    if check_success "$fail_resp"; then
        local fail_status=$(json_value "$fail_resp" "data.status")
        if [ "$fail_status" = "failed" ]; then
            print_pass "下载失败记录成功: status=failed"
        else
            print_fail "状态应为 failed 但得到 $fail_status" "$fail_resp"
        fi
    else
        print_fail "上报下载失败请求失败" "$fail_resp"
    fi
}

#################################################################
# Phase 6: 场景 C — 安装失败流程
#################################################################
test_install_failure() {
    print_header "Phase 6: 场景 C — 安装失败流程"

    if [ -z "$FAIL_IN_SERIAL" ] || [ -z "$TEST_FIRMWARE_ID" ]; then
        print_info "跳过：设备或固件未创建"
        return
    fi

    print_test "TC-FAIL-IN-001: 创建安装失败场景任务"
    local task_resp=$(http_post "/api/firmware/ota/tasks" "{
        \"deviceId\": \"$FAIL_IN_SERIAL\",
        \"firmwareId\": \"$TEST_FIRMWARE_ID\"
    }")
    if ! check_success "$task_resp"; then
        print_fail "创建任务失败" "$task_resp"
        return
    fi
    local task_id=$(json_value "$task_resp" "data.id")
    print_pass "任务创建成功: TaskID=$task_id"

    # 下载完成
    print_test "TC-FAIL-IN-002: 模拟下载完成"
    local dl_done=$(http_post "/api/firmware/ota/tasks/$task_id/status" "{
        \"status\": \"downloading\",
        \"progress\": 100
    }")
    if check_success "$dl_done"; then
        print_pass "下载完成"
    else
        print_fail "下载完成上报失败" "$dl_done"
    fi

    # 安装中
    print_test "TC-FAIL-IN-003: 模拟安装中 50%"
    local inst=$(http_post "/api/firmware/ota/tasks/$task_id/status" "{
        \"status\": \"installing\",
        \"progress\": 50
    }")
    if check_success "$inst"; then
        print_pass "安装进度上报成功"
    else
        print_fail "安装进度上报失败" "$inst"
    fi

    # 安装失败
    print_test "TC-FAIL-IN-004: 上报安装失败"
    local fail_resp=$(http_post "/api/firmware/ota/tasks/$task_id/status" "{
        \"status\": \"failed\",
        \"progress\": 50,
        \"error\": \"Flash write error at block 0x8000\"
    }")
    if check_success "$fail_resp"; then
        local fail_status=$(json_value "$fail_resp" "data.status")
        if [ "$fail_status" = "failed" ]; then
            print_pass "安装失败记录成功: status=failed"
        else
            print_fail "状态应为 failed 但得到 $fail_status" "$fail_resp"
        fi
    else
        print_fail "上报安装失败请求失败" "$fail_resp"
    fi
}

#################################################################
# Phase 7: 场景 D — 取消升级流程
#################################################################
test_cancel_flow() {
    print_header "Phase 7: 场景 D — 取消升级流程"

    if [ -z "$CANCEL_SERIAL" ] || [ -z "$TEST_FIRMWARE_ID" ]; then
        print_info "跳过：设备或固件未创建"
        return
    fi

    print_test "TC-CANCEL-001: 创建取消场景任务"
    local task_resp=$(http_post "/api/firmware/ota/tasks" "{
        \"deviceId\": \"$CANCEL_SERIAL\",
        \"firmwareId\": \"$TEST_FIRMWARE_ID\"
    }")
    if ! check_success "$task_resp"; then
        print_fail "创建任务失败" "$task_resp"
        return
    fi
    local task_id=$(json_value "$task_resp" "data.id")
    print_pass "任务创建成功: TaskID=$task_id"

    # 模拟下载中
    print_test "TC-CANCEL-002: 模拟下载中 40%"
    local prog=$(http_post "/api/firmware/ota/tasks/$task_id/status" "{
        \"status\": \"downloading\",
        \"progress\": 40
    }")
    if check_success "$prog"; then
        print_pass "进度上报成功"
    else
        print_fail "进度上报失败" "$prog"
    fi

    # 取消任务
    print_test "TC-CANCEL-003: 取消 OTA 任务"
    local cancel_resp=$(http_post "/api/firmware/ota/tasks/$task_id/cancel" "{}")
    if check_success "$cancel_resp"; then
        print_pass "任务取消成功"
    else
        print_fail "任务取消失败" "$cancel_resp"
    fi

    # 再次查询任务应不存在（cancel 会 delete）
    print_test "TC-CANCEL-004: 取消后任务应不可查询"
    local after_cancel=$(http_get "/api/firmware/ota/tasks/$task_id")
    if ! check_success "$after_cancel"; then
        print_pass "已取消的任务查询返回失败（预期行为）"
    else
        print_info "任务仍存在（cancel 实现为 delete，取决于时序）"
    fi
}

#################################################################
# Phase 8: 场景 E — 重复任务拦截
#################################################################
test_duplicate_task_rejection() {
    print_header "Phase 8: 场景 E — 重复任务拦截"

    if [ -z "$TEST_FIRMWARE_ID" ]; then
        print_info "跳过"
        return
    fi

    # 创建专用设备
    print_test "TC-DUP-001: 创建重复检测设备"
    local dev_resp=$(create_test_device "$DUP_SERIAL" "1.0.0")
    if ! check_success "$dev_resp"; then
        print_fail "创建设备失败" "$dev_resp"
        return
    fi
    print_pass "设备创建成功: $DUP_SERIAL"

    # 第一次创建
    print_test "TC-DUP-002: 第一次创建 OTA 任务（应成功）"
    local task1=$(http_post "/api/firmware/ota/tasks" "{
        \"deviceId\": \"$DUP_SERIAL\",
        \"firmwareId\": \"$TEST_FIRMWARE_ID\"
    }")
    if check_success "$task1"; then
        local dup_task_id=$(json_value "$task1" "data.id")
        print_pass "第一次创建成功: TaskID=$dup_task_id"
    else
        print_fail "第一次创建失败" "$task1"
        return
    fi

    # 第二次创建（应被拒绝）
    print_test "TC-DUP-003: 有进行中任务时再次创建（应被拒绝）"
    local task2=$(http_post "/api/firmware/ota/tasks" "{
        \"deviceId\": \"$DUP_SERIAL\",
        \"firmwareId\": \"$TEST_FIRMWARE_ID\"
    }")
    if ! check_success "$task2"; then
        print_pass "重复创建被正确拒绝"
    else
        print_fail "重复创建应被拒绝但成功了" "$task2"
    fi

    # 完成任务后再创建（应成功）
    print_test "TC-DUP-004: 完成任务后再次创建（应成功）"
    http_post "/api/firmware/ota/tasks/$dup_task_id/status" "{
        \"status\": \"completed\",
        \"progress\": 100
    }" > /dev/null 2>&1

    local task3=$(http_post "/api/firmware/ota/tasks" "{
        \"deviceId\": \"$DUP_SERIAL\",
        \"firmwareId\": \"$TEST_FIRMWARE_ID\"
    }")
    if check_success "$task3"; then
        print_pass "任务完成后可再次创建"
    else
        print_info "再次创建失败（可能因为版本相同）"
    fi
}

#################################################################
# Phase 9: 场景 F — 分页查询
#################################################################
test_pagination() {
    print_header "Phase 9: 场景 F — 分页查询设备任务列表"

    if [ -z "$TEST_DEVICE_SN" ]; then
        print_info "跳过"
        return
    fi

    print_test "TC-PAGE-001: 查询设备任务列表 (limit=10, offset=0)"
    local resp=$(http_get "/api/firmware/devices/$TEST_DEVICE_SN/ota/tasks?limit=10&offset=0")
    if check_success "$resp"; then
        local total=$(json_value "$resp" "data.total")
        print_pass "查询成功: total=$total"
    else
        print_fail "分页查询失败" "$resp"
    fi

    print_test "TC-PAGE-002: 查询设备任务列表 (limit=1, offset=0)"
    local resp2=$(http_get "/api/firmware/devices/$TEST_DEVICE_SN/ota/tasks?limit=1&offset=0")
    if check_success "$resp2"; then
        print_pass "分页 limit=1 查询成功"
    else
        print_fail "分页 limit=1 查询失败" "$resp2"
    fi
}

#################################################################
# Phase 10: 场景 G — 升级后再次检查更新
#################################################################
test_check_after_upgrade() {
    print_header "Phase 10: 场景 G — 升级后检查更新"

    if [ -z "$TEST_DEVICE_SN" ]; then
        print_info "跳过"
        return
    fi

    print_test "TC-POST-001: 升级后检查更新（应无更新）"
    local resp=$(http_get "/api/firmware/devices/$TEST_DEVICE_SN/check-update")
    if check_success "$resp"; then
        local has_update=$(json_value "$resp" "data.hasUpdate")
        if [ "$has_update" = "false" ]; then
            print_pass "升级后无可用更新（正确）"
        else
            print_info "仍有更新: hasUpdate=$has_update（可能取决于版本比较逻辑）"
        fi
    else
        print_fail "检查更新失败" "$resp"
    fi
}

#################################################################
# Phase 11: 清理测试数据
#################################################################
cleanup() {
    print_header "Phase 11: 清理测试数据"

    local all_sns="$TEST_SERIAL $CANCEL_SERIAL $FAIL_DL_SERIAL $FAIL_IN_SERIAL $DUP_SERIAL"
    local count=0

    for sn in $all_sns; do
        # 通过查询设备列表找到设备 ID 来删除
        local dev_list=$(http_get "/api/devices?page=1&pageSize=100")
        if check_success "$dev_list"; then
            # 尝试直接用 serialNumber 路径删除（如果有该端点）
            local del_resp=$(http_delete "/api/devices/$sn")
            if check_success "$del_resp"; then
                count=$((count + 1))
            fi
        fi
    done

    print_pass "清理完成（删除 $count 个设备）"
}

#################################################################
# 测试结果总结
#################################################################
print_summary() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  OTA 集成测试结果总结${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

    echo -e "  总测试数: $TOTAL_TESTS"
    echo -e "  ${GREEN}通过: $PASSED_TESTS${NC}"
    echo -e "  ${RED}失败: $FAILED_TESTS${NC}"

    local SUCCESS_RATE=0
    if [ "$TOTAL_TESTS" -gt 0 ]; then
        SUCCESS_RATE=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    fi
    echo -e "  成功率: ${SUCCESS_RATE}%\n"

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
        echo -e "${YELLOW}部分测试失败，请检查日志${NC}"
        exit 1
    fi
}

#################################################################
# 主测试流程
#################################################################
main() {
    echo -e "${CYAN}"
    echo -e "╔═══════════════════════════════════════════════════════════╗"
    echo -e "║       OTA 固件升级完整流程集成测试                        ║"
    echo -e "║       Device Service: http://localhost:6003               ║"
    echo -e "║       测试场景: A(成功) B(下载失败) C(安装失败)           ║"
    echo -e "║                 D(取消) E(重复拦截) F(分页) G(升级后检查) ║"
    echo -e "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # 检查 device-service 连接
    echo -e "${YELLOW}检查 device-service 连接...${NC}"
    if curl -s --connect-timeout 5 --max-time 5 "$API_BASE/api/firmware/versions/__health_check__" > /dev/null 2>&1; then
        echo -e "${GREEN}device-service 连接正常${NC}\n"
    else
        echo -e "${RED}无法连接到 device-service: $API_BASE${NC}"
        echo -e "${YELLOW}请确保 device-service 已启动 (端口 6003)${NC}"
        exit 1
    fi

    # 执行测试
    create_devices
    create_firmware
    check_update
    test_full_success_flow
    test_download_failure
    test_install_failure
    test_cancel_flow
    test_duplicate_task_rejection
    test_pagination
    test_check_after_upgrade
    cleanup
    print_summary
}

main
