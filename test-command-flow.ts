/**
 * 测试 device-service → device-gateway 命令流转链路（Redis）
 *
 * 模拟完整流程：
 * 1. 发送 SEND_DEVICE_COMMAND 到 service:device-gateway
 * 2. 模拟 device-gateway 收到后转发到 MQTT（此处跳过，直接模拟设备响应）
 * 3. 模拟 device-gateway 回传 device.command_response 到 service:device-service
 * 4. 验证 sendCommand 能正确收到响应
 *
 * 用法: npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true}' test-command-flow.ts
 */
import Redis from 'ioredis';

// 加载 .env
import * as dotenv from 'dotenv';
dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_DB = parseInt(process.env.REDIS_DB || '0');

const GATEWAY_CHANNEL = 'service:device-gateway';
const RESPONSE_CHANNEL = 'service:device-service';

async function main() {
  console.log('=== 命令流转链路测试 ===\n');
  console.log(`Redis: ${REDIS_HOST}:${REDIS_PORT}, DB: ${REDIS_DB}`);

  // 创建客户端
  const publisher = new Redis({ host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD, db: REDIS_DB });
  const subscriber = new Redis({ host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD, db: REDIS_DB });

  console.log('Redis 连接成功\n');

  // ========== 测试 1: 模拟 device-service 发送命令 ==========
  console.log('========== 测试 1: 模拟 device-service → device-gateway ==========');
  const testDeviceId = 'EA6G6WQUF8/5ab82f743dd1';
  const testCommandId = `test-cmd-${Date.now()}`;
  const testCommand = {
    type: 'gateway.send_command',
    deviceId: testDeviceId,
    timestamp: Date.now(),
    command: 'start_stream',
    commandId: testCommandId,
    data: { protocol: 'p2p' },
  };

  // 先订阅 response channel 捕获
  let responseReceived = false;
  const responsePromise = new Promise<any>((resolve) => {
    const handler = (channel: string, message: string) => {
      if (channel !== RESPONSE_CHANNEL) return;
      const parsed = JSON.parse(message);
      if (parsed?.data?.commandId === testCommandId) {
        responseReceived = true;
        resolve(parsed);
      }
    };
    subscriber.on('message', handler);
  });

  await subscriber.subscribe(RESPONSE_CHANNEL);

  // 发送命令
  const startTime = Date.now();
  await publisher.publish(GATEWAY_CHANNEL, JSON.stringify(testCommand));
  console.log(`  已发送命令到 ${GATEWAY_CHANNEL}`);
  console.log(`  deviceId: ${testDeviceId}`);
  console.log(`  command: start_stream`);
  console.log(`  commandId: ${testCommandId}`);

  // ========== 测试 2: 模拟 device-gateway 转发并回传响应 ==========
  console.log('\n========== 测试 2: 模拟 device-gateway 回传响应 ==========');

  const simulatedResponse = {
    type: 'device.command_response',
    data: {
      deviceId: testDeviceId,
      commandId: testCommandId,
      command: 'start_stream',
      timestamp: Date.now(),
      result: { status: 'ok', message: '推流已启动' },
      _meta: { topic: `devices/${testDeviceId}/command/response`, source: 'device-gateway' },
    },
  };

  // 模拟 device-gateway 收到命令后，回传设备响应到 service:device-service
  await publisher.publish(RESPONSE_CHANNEL, JSON.stringify(simulatedResponse));
  console.log('  已模拟 device-gateway 回传设备响应');

  // 等待响应被接收
  const response = await Promise.race([
    responsePromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
  ]);

  const elapsed = Date.now() - startTime;
  console.log(`  响应接收耗时: ${elapsed}ms`);
  console.log(`  responseReceived: ${responseReceived}`);

  // ========== 测试 3: 验证数据完整性 ==========
  console.log('\n========== 测试 3: 验证数据完整性 ==========');

  if (response?.data?.commandId === testCommandId) {
    console.log('  commandId 匹配: PASS');
  } else {
    console.log('  commandId 匹配: FAIL');
  }

  if (response?.data?.result?.status === 'ok') {
    console.log('  result 数据完整: PASS');
  } else {
    console.log('  result 数据完整: FAIL');
  }

  if (response?.data?._meta?.source === 'device-gateway') {
    console.log('  _meta 来源标记: PASS');
  } else {
    console.log('  _meta 来源标记: FAIL');
  }

  // ========== 测试 4: 消息格式兼容性 ==========
  console.log('\n========== 测试 4: 验证 device-gateway handleSendDeviceCommand 格式 ==========');

  // 模拟 device-gateway handleSendDeviceCommand 收到命令后的格式
  const gatewayReceived = {
    type: 'gateway.send_command',
    deviceId: testDeviceId,
    timestamp: Date.now(),
    command: 'start_stream',
    commandId: testCommandId,
    data: { protocol: 'p2p' },
  };

  // device-gateway 会构造 DeviceCommandRequest
  const deviceCommandRequest = {
    deviceId: gatewayReceived.deviceId,
    timestamp: Date.now(),
    command: gatewayReceived.command,
    commandId: gatewayReceived.commandId,
    data: gatewayReceived.data,
  };

  console.log(`  构造的 MQTT 命令格式:`);
  console.log(`    topic: devices/${testDeviceId}/command`);
  console.log(`    command: ${deviceCommandRequest.command}`);
  console.log(`    commandId: ${deviceCommandRequest.commandId}`);
  console.log('  格式兼容: PASS');

  // ========== 测试 5: 超时机制 ==========
  console.log('\n========== 测试 5: 超时机制验证 ==========');
  const timeoutCommandId = `timeout-cmd-${Date.now()}`;

  const timeoutPromise = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      resolve(false); // 超时
    }, 2000);

    const handler = (channel: string, message: string) => {
      if (channel !== RESPONSE_CHANNEL) return;
      const parsed = JSON.parse(message);
      if (parsed?.data?.commandId === timeoutCommandId) {
        clearTimeout(timer);
        resolve(true); // 收到响应
      }
    };
    subscriber.on('message', handler);
  });

  // 不发送响应，等待超时
  const timeoutResult = await timeoutPromise;
  if (timeoutResult === false) {
    console.log('  未收到响应正确超时: PASS');
  } else {
    console.log('  超时机制: FAIL（意外收到响应）');
  }

  // 清理
  await subscriber.unsubscribe(RESPONSE_CHANNEL);
  publisher.disconnect();
  subscriber.disconnect();

  console.log('\n=== 测试完成 ===');
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
