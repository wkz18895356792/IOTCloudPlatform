#!/usr/bin/env node

/**
 * Device Gateway Service 测试脚本
 *
 * 用于验证服务的基本功能
 */

const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:6010';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testHealth() {
  log('\n测试健康检查端点...', 'blue');
  try {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();
    log(`✓ 健康检查通过: ${JSON.stringify(data)}`, 'green');
    return true;
  } catch (error) {
    log(`✗ 健康检查失败: ${error.message}`, 'red');
    return false;
  }
}

async function testReady() {
  log('\n测试就绪检查端点...', 'blue');
  try {
    const response = await fetch(`${BASE_URL}/ready`);
    const data = await response.json();
    log(`✓ 就绪检查通过: ${JSON.stringify(data)}`, 'green');
    return true;
  } catch (error) {
    log(`✗ 就绪检查失败: ${error.message}`, 'red');
    return false;
  }
}

async function testStatus() {
  log('\n测试状态端点...', 'blue');
  try {
    const response = await fetch(`${BASE_URL}/status`);
    const data = await response.json();
    log(`✓ 状态检查通过:`, 'green');
    log(`  - 服务: ${data.service}`, 'reset');
    log(`  - 版本: ${data.version}`, 'reset');
    log(`  - MQTT连接: ${data.mqtt.connected ? '已连接' : '未连接'}`, 'reset');
    log(`  - 在线设备: ${data.connections?.online || 0}`, 'reset');
    return true;
  } catch (error) {
    log(`✗ 状态检查失败: ${error.message}`, 'red');
    return false;
  }
}

async function testGatewayStatus() {
  log('\n测试网关状态端点...', 'blue');
  try {
    const response = await fetch(`${BASE_URL}/api/gateway/status`);
    const data = await response.json();
    log(`✓ 网关状态检查通过:`, 'green');
    log(`  - 已连接: ${data.connected}`, 'reset');
    return true;
  } catch (error) {
    log(`✗ 网关状态检查失败: ${error.message}`, 'red');
    return false;
  }
}

async function testMetrics() {
  log('\n测试指标端点...', 'blue');
  try {
    const response = await fetch(`${BASE_URL}/metrics`);
    const data = await response.json();
    log(`✓ 指标检查通过:`, 'green');
    log(`  - 在线设备: ${data.metrics?.devices?.online || 0}`, 'reset');
    log(`  - WebSocket连接: ${data.metrics?.websocket?.totalConnections || 0}`, 'reset');
    return true;
  } catch (error) {
    log(`✗ 指标检查失败: ${error.message}`, 'red');
    return false;
  }
}

async function runTests() {
  log('========================================', 'blue');
  log('  Device Gateway 服务测试', 'blue');
  log('========================================', 'blue');
  log(`测试地址: ${BASE_URL}`, 'yellow');

  const results = {
    health: await testHealth(),
    ready: await testReady(),
    status: await testStatus(),
    gatewayStatus: await testGatewayStatus(),
    metrics: await testMetrics(),
  };

  log('\n========================================', 'blue');
  log('  测试结果汇总', 'blue');
  log('========================================', 'blue');

  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;

  for (const [test, result] of Object.entries(results)) {
    const status = result ? '✓ 通过' : '✗ 失败';
    const color = result ? 'green' : 'red';
    log(`${status} - ${test}`, color);
  }

  log(`\n总计: ${passed}/${total} 通过`, passed === total ? 'green' : 'yellow');

  if (passed === total) {
    log('\n所有测试通过! ✓', 'green');
    process.exit(0);
  } else {
    log('\n部分测试失败! ✗', 'red');
    process.exit(1);
  }
}

// 兼容没有fetch的环境
if (typeof fetch === 'undefined') {
  global.fetch = async (url) => {
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            json: async () => JSON.parse(data),
            ok: res.statusCode >= 200 && res.statusCode < 300,
          });
        });
      }).on('error', reject);
    });
  };
}

runTests().catch(error => {
  log(`\n测试执行错误: ${error.message}`, 'red');
  process.exit(1);
});
