/**
 * WebSocket 客户端测试脚本
 * 模拟 App 端连接 device-gateway WebSocket
 *
 * 使用方法: node test-websocket-client.js
 */

const { io } = require('socket.io-client');

// WebSocket 服务器地址
const SERVER_URL = 'http://127.0.0.1:6010';
const DEVICE_ID = 'test-device-001';

console.log('='.repeat(60));
console.log('WebSocket 客户端测试');
console.log('='.repeat(60));
console.log(`服务器: ${SERVER_URL}`);
console.log(`设备ID: ${DEVICE_ID}`);
console.log('='.repeat(60));

// 创建 Socket.IO 连接
const socket = io(SERVER_URL, {
  transports: ['polling', 'websocket'],  // 先 polling，再升级 websocket
  path: '/socket.io/',
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

// 连接成功
socket.on('connect', () => {
  console.log('\n[✓] WebSocket 连接成功');
  console.log(`    Socket ID: ${socket.id}`);
});

// 接收欢迎消息
socket.on('connected', (data) => {
  console.log('\n[✓] 收到欢迎消息:');
  console.log(JSON.stringify(data, null, 2));

  // 订阅设备
  console.log(`\n[→] 订阅设备: ${DEVICE_ID}`);
  socket.emit('subscribe:device', { deviceId: DEVICE_ID });
});

// 订阅成功
socket.on('subscribed', (data) => {
  console.log('\n[✓] 设备订阅成功:');
  console.log(JSON.stringify(data, null, 2));
});

// 取消订阅成功
socket.on('unsubscribed', (data) => {
  console.log('\n[✓] 取消订阅成功:');
  console.log(JSON.stringify(data, null, 2));
});

// 接收设备消息
socket.on('device:message', (data) => {
  console.log('\n[←] 收到设备消息:');
  console.log(JSON.stringify(data, null, 2));
});

// 命令发送确认
socket.on('command:sent', (data) => {
  console.log('\n[✓] 命令已发送:');
  console.log(JSON.stringify(data, null, 2));
});

// 命令发送失败
socket.on('command:error', (data) => {
  console.log('\n[✗] 命令发送失败:');
  console.log(JSON.stringify(data, null, 2));
});

// 连接错误
socket.on('connect_error', (error) => {
  console.log('\n[✗] 连接错误:', error.message);
});

// 断开连接
socket.on('disconnect', (reason) => {
  console.log('\n[!] 连接断开:', reason);
});

// 重连尝试
socket.on('reconnect_attempt', (attempt) => {
  console.log(`\n[↻] 重连尝试 #${attempt}`);
});

// 重连成功
socket.on('reconnect', (attempt) => {
  console.log(`\n[✓] 重连成功 (尝试 #${attempt})`);
});

// 交互式命令
console.log('\n可用命令 (在终端输入):');
console.log('  1 - 发送测试命令到设备');
console.log('  2 - 取消订阅设备');
console.log('  3 - 重新订阅设备');
console.log('  q - 退出');
console.log('');

// 从终端读取输入
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('line', (input) => {
  switch (input.trim()) {
    case '1':
      const command = {
        action: 'setPower',
        params: { power: true },
        timestamp: Date.now()
      };
      console.log(`\n[→] 发送命令到设备 ${DEVICE_ID}:`);
      console.log(JSON.stringify(command, null, 2));
      socket.emit('device:command', {
        deviceId: DEVICE_ID,
        command: command
      });
      break;

    case '2':
      console.log(`\n[→] 取消订阅设备: ${DEVICE_ID}`);
      socket.emit('unsubscribe:device', { deviceId: DEVICE_ID });
      break;

    case '3':
      console.log(`\n[→] 重新订阅设备: ${DEVICE_ID}`);
      socket.emit('subscribe:device', { deviceId: DEVICE_ID });
      break;

    case 'q':
    case 'quit':
    case 'exit':
      console.log('\n[!] 退出...');
      socket.disconnect();
      rl.close();
      process.exit(0);
      break;

    default:
      if (input.trim()) {
        console.log(`\n[?] 未知命令: ${input}`);
      }
  }
});

// 保持进程运行
process.on('SIGINT', () => {
  console.log('\n[!] 收到中断信号，退出...');
  socket.disconnect();
  process.exit(0);
});
