/**
 * MQTT 模拟测试脚本
 *
 * 测试 OTA 命令下发 和 设备日志打捞 的完整 MQTT 收发流程
 *
 * 使用方式: node test-mqtt-flows.js
 */
const mqtt = require('mqtt');
const Redis = require('ioredis');

const MQTT_HOST = 'localhost';
const MQTT_PORT = 1883;
const DEVICE_ID = 'test-device-001';
const SERVICE_API_KEY = 'baby-monitor-service-api-key-dev-2024';

const TOPICS = {
  // 订阅
  command: `devices/${DEVICE_ID}/command`,
  logsUploadUrlResp: `devices/${DEVICE_ID}/logs/upload-url/response`,
  logsRegisterResp: `devices/${DEVICE_ID}/logs/register/response`,
  // 发布
  register: `devices/${DEVICE_ID}/register`,
  otaProgress: `devices/${DEVICE_ID}/ota/progress`,
  otaResult: `devices/${DEVICE_ID}/ota/result`,
  logUploadUrl: `devices/${DEVICE_ID}/logs/upload-url`,
  logRegister: `devices/${DEVICE_ID}/logs/register`,
  logCollectStatus: `devices/${DEVICE_ID}/logs/collect/status`,
};

let client;
let testResults = { passed: 0, failed: 0, total: 0 };

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(11, 23)}] [${tag}] ${msg}`);
}

function assert(condition, desc) {
  testResults.total++;
  if (condition) {
    testResults.passed++;
    log('PASS', desc);
  } else {
    testResults.failed++;
    log('FAIL', desc);
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function waitForMessage(topic, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('message', handler);
      reject(new Error(`Timeout waiting for message on ${topic}`));
    }, timeout);

    function handler(receivedTopic, payload) {
      if (receivedTopic === topic) {
        clearTimeout(timer);
        client.off('message', handler);
        try {
          resolve(JSON.parse(payload.toString()));
        } catch {
          resolve(payload.toString());
        }
      }
    }
    client.on('message', handler);
  });
}

async function connectMQTT() {
  return new Promise((resolve, reject) => {
    client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
      clientId: `test-device-${Date.now()}`,
      clean: true,
      connectTimeout: 5000,
    });
    client.on('connect', () => {
      log('MQTT', 'Connected to broker');
      resolve();
    });
    client.on('error', (err) => reject(err));
  });
}

// ==================== Test 0: 模拟设备认证 ====================
async function setupDeviceAuth() {
  log('TEST', '--- Test 0: Setup Device Auth (Redis mock) ---');
  const redis = new Redis({ host: 'localhost', port: 6379 });

  const authKey = `device:auth:${DEVICE_ID}`;
  const tokenKey = `device:token:${DEVICE_ID}`;

  const authInfo = {
    deviceId: DEVICE_ID,
    serialNumber: DEVICE_ID,
    productType: 'camera',
    firmwareVersion: '1.0.0',
    protocol: 'private',
  };

  const tokenData = {
    deviceId: DEVICE_ID,
    token: 'test-token-mock',
    expiresAt: Date.now() + 3600000,
    createdAt: Date.now(),
  };

  // 写入设备认证信息（模拟 gateway 认证后的缓存）
  await redis.set(authKey, JSON.stringify(authInfo), 'EX', 3600);
  await redis.set(tokenKey, JSON.stringify(tokenData), 'EX', 3600);

  // 同时标记设备在线
  await redis.set(`device:online:${DEVICE_ID}`, '1', 'EX', 300);
  await redis.sadd('devices:online', DEVICE_ID);

  redis.disconnect();
  log('INFO', `Device auth & online status set in Redis for ${DEVICE_ID}`);
}

// ==================== Test 1: 设备注册 ====================
async function testDeviceRegister() {
  log('TEST', '--- Test 1: Device Register ---');

  const message = {
    deviceId: DEVICE_ID,
    serialNumber: DEVICE_ID,
    productType: 'camera',
    deviceType: 'E73',
    firmwareVersion: '1.0.0',
    protocol: 'private',
    cloudProvider: 3,
    timestamp: Date.now(),
  };

  client.publish(TOPICS.register, JSON.stringify(message));
  log('PUB', `${TOPICS.register} → ${JSON.stringify(message)}`);

  // 等待注册完成（device-service 处理需要时间）
  await sleep(2000);
  log('INFO', 'Register message sent, waiting for processing...');
}

// ==================== Test 2: OTA 命令下发 ====================
async function testOTACommand() {
  log('TEST', '--- Test 2: OTA Command via Redis ---');

  // 设备订阅 command 主题
  await new Promise((resolve, reject) => {
    client.subscribe(TOPICS.command, { qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  log('SUB', `Subscribed to ${TOPICS.command}`);

  // 通过 Redis 向 device-gateway 发送 OTA 命令（模拟 device-service 行为）
  const redis = new Redis({ host: 'localhost', port: 6379 });

  const otaCommand = {
    type: 'gateway.send_ota_command',
    deviceId: DEVICE_ID,
    timestamp: Date.now(),
    action: 'ota_download',
    taskId: `test-ota-${Date.now()}`,
    payload: {
      version: '2.0.0',
      fileUrl: 'https://example.com/firmware/v2.0.0.bin',
      fileSize: 2097152,
      checksum: 'abc123def456',
      isForced: false,
    },
  };

  const msgPromise = waitForMessage(TOPICS.command, 15000);

  await redis.publish('service:device-gateway', JSON.stringify(otaCommand));
  log('REDIS', `Published OTA command to service:device-gateway`);

  try {
    const received = await msgPromise;
    log('MSG', `Received on ${TOPICS.command}: ${JSON.stringify(received)}`);

    assert(received.action === 'ota_download', 'OTA action is ota_download');
    assert(received.version === '2.0.0', 'OTA version is 2.0.0');
    assert(!!received.taskId, 'OTA taskId exists');
    assert(!!received.fileUrl, 'OTA fileUrl exists');
  } catch (e) {
    assert(false, `OTA command received: ${e.message}`);
  }

  // 模拟设备上报 OTA 进度
  const progressMsg = {
    deviceId: DEVICE_ID,
    taskId: otaCommand.taskId,
    progress: 50,
    status: 'downloading',
    timestamp: Date.now(),
  };
  client.publish(TOPICS.otaProgress, JSON.stringify(progressMsg));
  log('PUB', `OTA progress 50% → ${TOPICS.otaProgress}`);

  await sleep(1000);

  // 模拟设备上报 OTA 结果
  const resultMsg = {
    deviceId: DEVICE_ID,
    taskId: otaCommand.taskId,
    success: true,
    version: '2.0.0',
    timestamp: Date.now(),
  };
  client.publish(TOPICS.otaResult, JSON.stringify(resultMsg));
  log('PUB', `OTA result (success) → ${TOPICS.otaResult}`);

  await sleep(1000);
  redis.disconnect();
}

// ==================== Test 3: 设备主动日志上传 ====================
async function testDeviceInitiatedLogUpload() {
  log('TEST', '--- Test 3: Device-initiated Log Upload ---');

  // 订阅响应主题
  await new Promise((resolve, reject) => {
    client.subscribe([TOPICS.logsUploadUrlResp, TOPICS.logsRegisterResp], { qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  log('SUB', `Subscribed to ${TOPICS.logsUploadUrlResp}, ${TOPICS.logsRegisterResp}`);

  // 1. 设备请求日志上传URL
  const uploadUrlReq = {
    deviceId: DEVICE_ID,
    timestamp: Date.now(),
    requestId: `req-log-${Date.now()}`,
    estimatedSize: 1048576,
    logType: 'system',
    description: 'test crash log',
  };

  const uploadRespPromise = waitForMessage(TOPICS.logsUploadUrlResp, 15000);
  client.publish(TOPICS.logUploadUrl, JSON.stringify(uploadUrlReq));
  log('PUB', `Log upload-url request → ${TOPICS.logUploadUrl}`);

  try {
    const uploadResp = await uploadRespPromise;
    log('MSG', `Upload URL response: ${JSON.stringify(uploadResp)}`);

    assert(!!uploadResp.logId, 'Log upload response has logId');
    assert(!!uploadResp.fileKey, 'Log upload response has fileKey');
    assert(!!uploadResp.uploadUrl, 'Log upload response has uploadUrl');
    assert(uploadResp.fileKey.startsWith('logs/'), 'FileKey starts with logs/');
    assert(!!uploadResp.expiresAt, 'Log upload response has expiresAt');

    // 2. 模拟设备确认上传完成
    const registerReq = {
      deviceId: DEVICE_ID,
      timestamp: Date.now(),
      requestId: uploadUrlReq.requestId,
      logId: uploadResp.logId,
      fileKey: uploadResp.fileKey,
      fileSize: 1048576,
    };

    const registerRespPromise = waitForMessage(TOPICS.logsRegisterResp, 10000);
    client.publish(TOPICS.logRegister, JSON.stringify(registerReq));
    log('PUB', `Log register → ${TOPICS.logRegister}`);

    const registerResp = await registerRespPromise;
    log('MSG', `Register response: ${JSON.stringify(registerResp)}`);
    assert(registerResp.status === 'completed', 'Log register status is completed');
  } catch (e) {
    assert(false, `Log upload flow: ${e.message}`);
  }
}

// ==================== Test 4: 平台主动日志打捞 ====================
async function testPlatformInitiatedLogCollect() {
  log('TEST', '--- Test 4: Platform-initiated Log Collect ---');

  // 确保设备订阅了 command 主题（已订阅）
  // 设备订阅 collect/status 响应后上报

  // 1. 通过 device-service API 触发日志打捞
  const http = require('http');

  const triggerCollect = () => new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      logType: 'crash',
      description: 'platform triggered crash log collect',
    });

    const req = http.request({
      hostname: 'localhost',
      port: 6003,
      path: `/api/devices/${DEVICE_ID}/logs/collect`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP timeout')); });
    req.write(postData);
    req.end();
  });

  // 等待设备收到 collect_logs 命令
  const collectCmdPromise = waitForMessage(TOPICS.command, 15000);

  log('HTTP', `POST /api/devices/${DEVICE_ID}/logs/collect`);

  try {
    const apiResp = await triggerCollect();
    log('HTTP', `API Response: ${JSON.stringify(apiResp)}`);

    // 2. 设备收到 collect_logs 命令
    const collectCmd = await collectCmdPromise;
    log('MSG', `Collect command received: ${JSON.stringify(collectCmd)}`);

    assert(collectCmd.action === 'collect_logs', 'Command action is collect_logs');
    assert(!!collectCmd.taskId, 'Command has taskId');
    assert(!!collectCmd.uploadUrl, 'Command has uploadUrl');
    assert(!!collectCmd.fileKey, 'Command has fileKey');
    assert(collectCmd.fileKey.startsWith('logs/'), 'FileKey starts with logs/');

    // 3. 模拟设备上传完成，上报 collect status
    const statusMsg = {
      deviceId: DEVICE_ID,
      timestamp: Date.now(),
      taskId: collectCmd.taskId,
      status: 'completed',
      fileSize: 2048000,
    };
    client.publish(TOPICS.logCollectStatus, JSON.stringify(statusMsg));
    log('PUB', `Collect status (completed) → ${TOPICS.logCollectStatus}`);

    await sleep(2000);
    log('INFO', 'Collect status published, check device-service logs for processing');

  } catch (e) {
    assert(false, `Platform log collect flow: ${e.message}`);
  }
}

// ==================== Main ====================
async function main() {
  console.log('========================================');
  console.log(' MQTT Flow Test - OTA & Log Collection');
  console.log('========================================\n');

  try {
    // Connect
    await connectMQTT();

    // Test 1: Register
    await testDeviceRegister();

    // Test 0: Setup auth (after register so device exists in DB)
    await setupDeviceAuth();

    // Test 2: OTA
    await testOTACommand();

    // Test 3: Device-initiated log upload
    await testDeviceInitiatedLogUpload();

    // Test 4: Platform-initiated log collect
    await testPlatformInitiatedLogCollect();

  } catch (e) {
    log('ERROR', e.message);
  }

  // Summary
  console.log('\n========================================');
  console.log(' Test Results');
  console.log('========================================');
  console.log(`  Total:  ${testResults.total}`);
  console.log(`  Passed: ${testResults.passed}`);
  console.log(`  Failed: ${testResults.failed}`);
  console.log('========================================\n');

  client.end();
  process.exit(testResults.failed > 0 ? 1 : 0);
}

main();
