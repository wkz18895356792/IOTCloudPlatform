/**
 * 日志打捞命令下发测试（完整链路）
 *
 * 通过 device-service HTTP API 触发日志打捞，验证完整链路：
 * HTTP API -> device-service -> storage-service(预签名URL) -> Redis Pub/Sub -> device-gateway -> MQTT -> 设备
 *
 * 使用方式: node test-log-collect.js
 */
const mqtt = require('mqtt');
const http = require('http');

const MQTT_HOST = 'localhost';
const MQTT_PORT = 1883;
const DEVICE_ID = 'E73-140000082u';
const DEVICE_SERVICE_PORT = 6003;
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIyY2ZhNDgzNS05ZTRhLTRlN2QtOTM4Yi04MzVmOTM5MzcyMzQiLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwidHlwZSI6ImFjY2VzcyIsImlhdCI6MTc4MDAzNzM3MCwiZXhwIjoxNzgwMDQ0NTcwfQ.baeWj8HKf-kFBWY0b1rxlir7wPf6rp7_fZn4mSBV_eU';

const TOPICS = {
  command: `devices/${DEVICE_ID}/command`,
  commandResponse: `devices/${DEVICE_ID}/command/response`,
  logCollectStatus: `devices/${DEVICE_ID}/logs/collect/status`,
};

let mqttClient;

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(11, 23)}] [${tag}] ${msg}`);
}

function waitForMessage(topic, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mqttClient.off('message', handler);
      reject(new Error(`Timeout waiting for message on ${topic}`));
    }, timeout);

    function handler(receivedTopic, payload) {
      if (receivedTopic === topic) {
        clearTimeout(timer);
        mqttClient.off('message', handler);
        try {
          resolve(JSON.parse(payload.toString()));
        } catch {
          resolve(payload.toString());
        }
      }
    }
    mqttClient.on('message', handler);
  });
}

async function connectMQTT() {
  return new Promise((resolve, reject) => {
    mqttClient = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
      clientId: `device-${DEVICE_ID}-${Date.now()}`,
      clean: true,
      connectTimeout: 5000,
    });
    mqttClient.on('connect', () => {
      log('MQTT', 'Connected to broker');
      resolve();
    });
    mqttClient.on('error', (err) => reject(err));
  });
}

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: DEVICE_SERVICE_PORT,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${TOKEN}`,
      },
      timeout: 15000,
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
}

async function main() {
  console.log('========================================');
  console.log(' 日志打捞完整链路测试');
  console.log(` 目标设备: ${DEVICE_ID}`);
  console.log('========================================\n');

  try {
    // 1. 连接 MQTT，模拟设备订阅 command 主题
    await connectMQTT();

    await new Promise((resolve, reject) => {
      mqttClient.subscribe(TOPICS.command, { qos: 1 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    log('SUB', `订阅 ${TOPICS.command}`);

    // 2. 先监听 MQTT，再调 HTTP API
    const msgPromise = waitForMessage(TOPICS.command, 20000);

    // 3. 调用 device-service API 触发日志打捞
    //    完整链路: HTTP -> device-service -> storage-service(预签名URL) -> Redis -> device-gateway -> MQTT
    log('HTTP', `POST /api/devices/${DEVICE_ID}/logs/collect`);
    const apiResp = await httpPost(`/api/devices/${DEVICE_ID}/logs/collect`, {
      logType: 'crash',
      description: '平台主动日志打捞测试',
    });
    log('HTTP', `API 响应: ${JSON.stringify(apiResp, null, 2)}`);

    // 4. 等待设备通过 MQTT 收到 collect_logs 命令
    log('WAIT', '等待设备通过 MQTT 收到命令...');
    const received = await msgPromise;
    log('MSG', `设备收到命令: ${JSON.stringify(received, null, 2)}`);

    // 验证命令字段
    console.log('\n--- 验证结果 ---');
    let pass = 0, fail = 0;

    if (received.action === 'collect_logs') { log('PASS', '✓ action = collect_logs'); pass++; }
    else { log('FAIL', `✗ action = ${received.action}`); fail++; }

    if (received.taskId) { log('PASS', `✓ taskId: ${received.taskId}`); pass++; }
    else { log('FAIL', '✗ taskId 缺失'); fail++; }

    if (received.uploadUrl && received.uploadUrl.startsWith('https://')) {
      log('PASS', `✓ uploadUrl (实时预签名): ${received.uploadUrl.substring(0, 80)}...`);
      pass++;
    } else { log('FAIL', '✗ uploadUrl 缺失或无效'); fail++; }

    if (received.fileKey) { log('PASS', `✓ fileKey: ${received.fileKey}`); pass++; }
    else { log('FAIL', '✗ fileKey 缺失'); fail++; }

    if (received.logType) { log('PASS', `✓ logType: ${received.logType}`); pass++; }
    else { log('FAIL', '✗ logType 缺失'); fail++; }

    if (received.expiresAt) { log('PASS', `✓ expiresAt: ${received.expiresAt}`); pass++; }
    else { log('FAIL', '✗ expiresAt 缺失'); fail++; }

    // 5. 模拟设备上报打捞状态
    const statusMsg = {
      deviceId: DEVICE_ID,
      timestamp: Date.now(),
      taskId: received.taskId,
      status: 'completed',
      fileSize: 2048000,
    };
    mqttClient.publish(TOPICS.logCollectStatus, JSON.stringify(statusMsg));
    log('PUB', `模拟设备上报打捞状态 (completed) → ${TOPICS.logCollectStatus}`);

    // 6. 模拟设备发送命令响应
    const cmdResponse = {
      deviceId: DEVICE_ID,
      timestamp: Date.now(),
      commandId: received.id,
      command: 'collect_logs',
      result: { message: 'Log collection started' },
    };
    mqttClient.publish(TOPICS.commandResponse, JSON.stringify(cmdResponse));
    log('PUB', `模拟设备发送命令响应 → ${TOPICS.commandResponse}`);

    console.log('\n========================================');
    console.log(` 验证通过: ${pass}  失败: ${fail}`);
    console.log('========================================\n');

  } catch (e) {
    log('ERROR', e.message);
    log('INFO', '请确认 device-service、storage-service、device-gateway 均在运行');
  }

  if (mqttClient) mqttClient.end();
  process.exit(0);
}

main();
