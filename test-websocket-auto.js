/**
 * WebSocket 自动化测试脚本
 */

const { io } = require('socket.io-client');

const SERVER_URL = 'http://127.0.0.1:6010';
const DEVICE_ID = 'test-device-001';

console.log('='.repeat(60));
console.log('WebSocket 自动化测试');
console.log('='.repeat(60));

const socket = io(SERVER_URL, {
  transports: ['polling', 'websocket'],
  path: '/socket.io/',
});

let testStep = 0;
const tests = [
  '连接服务器',
  '接收欢迎消息',
  '订阅设备',
  '发送命令',
  '取消订阅',
];

function logTest(status, message) {
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '→';
  console.log(`[${icon}] ${message}`);
}

function showResults() {
  console.log('\n' + '='.repeat(60));
  console.log('测试结果:');
  tests.forEach((test, i) => {
    const status = i < testStep ? '✓' : '✗';
    console.log(`  ${status} ${test}`);
  });
  console.log('='.repeat(60));

  // 退出
  setTimeout(() => {
    socket.disconnect();
    process.exit(testStep >= 4 ? 0 : 1);
  }, 1000);
}

// 连接成功
socket.on('connect', () => {
  testStep = 1;
  logTest('pass', `连接成功 (Socket ID: ${socket.id})`);
});

// 欢迎消息
socket.on('connected', (data) => {
  testStep = 2;
  logTest('pass', '收到欢迎消息');
  console.log(JSON.stringify(data, null, 2));

  // 订阅设备
  logTest('info', '订阅设备...');
  socket.emit('subscribe:device', { deviceId: DEVICE_ID });
});

// 订阅成功
socket.on('subscribed', (data) => {
  testStep = 3;
  logTest('pass', `设备订阅成功: ${data.deviceId}`);

  // 发送命令
  logTest('info', '发送测试命令...');
  socket.emit('device:command', {
    deviceId: DEVICE_ID,
    command: { action: 'test', params: { value: true } }
  });
});

// 命令发送确认
socket.on('command:sent', (data) => {
  testStep = 4;
  logTest('pass', '命令发送成功');
  console.log(JSON.stringify(data, null, 2));

  // 取消订阅
  logTest('info', '取消订阅...');
  socket.emit('unsubscribe:device', { deviceId: DEVICE_ID });
});

// 取消订阅成功
socket.on('unsubscribed', (data) => {
  testStep = 5;
  logTest('pass', `取消订阅成功: ${data.deviceId}`);
  showResults();
});

// 设备消息
socket.on('device:message', (data) => {
  logTest('info', '收到设备消息:');
  console.log(JSON.stringify(data, null, 2));
});

// 错误处理
socket.on('command:error', (data) => {
  logTest('fail', '命令发送失败');
  console.log(JSON.stringify(data, null, 2));
  showResults();
});

socket.on('connect_error', (error) => {
  logTest('fail', `连接错误: ${error.message}`);
  showResults();
});

socket.on('disconnect', (reason) => {
  logTest('info', `连接断开: ${reason}`);
});

// 超时保护
setTimeout(() => {
  if (testStep < 5) {
    logTest('fail', '测试超时');
    showResults();
  }
}, 15000);
