#!/bin/bash

# Device Gateway Service 启动脚本

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查Node.js
check_node() {
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装"
        exit 1
    fi
    log_success "Node.js 版本: $(node -v)"
}

# 检查依赖
check_dependencies() {
    if [ ! -d "node_modules" ]; then
        log_info "安装依赖..."
        npm install
    fi
}

# 构建项目
build() {
    log_info "构建项目..."
    npm run build
    log_success "构建完成"
}

# 开发模式
dev() {
    log_info "启动开发模式..."
    npm run dev
}

# 生产模式
prod() {
    log_info "启动生产模式..."
    NODE_ENV=production npm start
}

# 测试
test() {
    log_info "运行测试..."
    node test.js
}

# 显示帮助
show_help() {
    echo "Device Gateway Service 启动脚本"
    echo ""
    echo "用法: ./start.sh [命令]"
    echo ""
    echo "命令:"
    echo "  dev     开发模式启动"
    echo "  build   构建项目"
    echo "  start   生产模式启动"
    echo "  test    运行测试"
    echo "  help    显示帮助"
    echo ""
}

# 主函数
main() {
    local command=${1:-dev}

    log_info "Device Gateway Service"
    echo ""

    check_node
    check_dependencies

    case $command in
        dev)
            dev
            ;;
        build)
            build
            ;;
        start)
            build
            prod
            ;;
        test)
            test
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "未知命令: $command"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
