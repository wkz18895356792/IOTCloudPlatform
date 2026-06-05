/**
 * 模拟设备 MQTT 客户端
 * 用于测试智能家居 IoT 云平台
 *
 * 使用正确的 MQTT 主题格式: device/{type}/{direction}/{deviceId}
 *
 * 功能：
 * - 设备注册
 * - 状态上报
 * - 事件上报
 * - 响应控制命令
 * - 响应配置查询
 *
 * 使用方法：
 * node mock-device.js [deviceId]
 */

const mqtt = require('mqtt');

// ==================== 配置 ====================
const config = {
  mqtt: {
    host: process.env.MQTT_HOST || 'localhost',
    port: process.env.MQTT_PORT || 1883,
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
  },
  device: {
    deviceId: process.argv[2] || `camera-${Date.now()}`,
    serialNumber: process.argv[2] || `SN${Date.now()}`,
    productType: process.env.PRODUCT_TYPE || 'camera', // camera, screen, sensor
    firmwareVersion: '1.0.0',
  },
  heartbeatInterval: 3000,  // 30秒
  statusInterval: 6000,      // 60秒
};

// ==================== 设备状态 ====================
const deviceState = {
  battery: 100,
  network: -50,
  temperature: 25.5,
  humidity: 60,
  isRecording: false,
  isStreaming: false,
  isMuted: false,
  isRegistered: false,
  isOnline: false,
};

// ==================== MQTT 客户端 ====================
let client = null;
let heartbeatTimer = null;
let statusTimer = null;

// ==================== 工具函数 ====================

function generateMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

function generateCommandId() {
  return `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== MQTT 连接 ====================

function connect() {
  const url = `mqtt://${config.mqtt.host}:${config.mqtt.port}`;
  console.log(`[Device] Connecting to MQTT Broker: ${url}`);

  const options = {
    clientId: `device-${config.device.deviceId}`,
    clean: true,
    connectTimeout: 30000,
    keepalive: 60,
    username: config.mqtt.username,
    password: config.mqtt.password,
  };

  client = mqtt.connect(url, options);

  client.on('connect', () => {
    console.log('[Device] Connected to MQTT Broker');
    subscribeToTopics();
    setTimeout(() => registerDevice(), 1000);
  });

  client.on('error', (err) => {
    console.error('[Device] MQTT error:', err.message);
  });

  client.on('close', () => {
    console.log('[Device] MQTT connection closed');
  });

  client.on('reconnect', () => {
    console.log('[Device] Reconnecting to MQTT Broker...');
  });

  client.on('message', (topic, message) => {
    handleMessage(topic, message);
  });
}

// ==================== 订阅主题 ====================

function subscribeToTopics() {
  const topics = [
    `device/control/request/${config.device.deviceId}`,
    `device/config/request/${config.device.deviceId}`,
    `device/register/response/${config.device.deviceId}`,
    `device/status/request/${config.device.deviceId}`,
  ];

  topics.forEach(topic => {
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (!err) {
        console.log(`[Device] Subscribed to: ${topic}`);
      }
    });
  });
}

// ==================== 发送消息 ====================

/**
 * 发布消息到 MQTT
 */
function publish(topic, payload) {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) {
        console.error(`[Device] Failed to publish to ${topic}:`, err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * 发送设备注册请求
 * 主题: device/register/request (广播)
 *
 * DeviceRegisterRequest 格式:
 * - deviceId: string
 * - type: number (1=CAMERA, 2=SCREEN)
 * - cloudProvider: number (1=AWS, 2=TENCENT)
 * - userId: string (可选)
 */
async function registerDevice() {
  const topic = 'device/register/request';

  // 将 productType 字符串转换为 type 数字
  const deviceTypeMap = {
    'camera': 1,
    'screen': 2,
    'sensor': 1, // 传感器归类为摄像头类型
  };

  const payload = {
    deviceId: config.device.deviceId,
    type: deviceTypeMap[config.device.productType] || 1,
    cloudProvider: 1, // 1=AWS, 2=TENCENT
    userId: process.env.USER_ID || undefined,
    timestamp: Date.now(),
  };

  console.log('[Device] Sending register request...');
  console.log(`[Device] Topic: ${topic}`);
  console.log(`[Device] Payload:`, JSON.stringify(payload, null, 2));

  await publish(topic, payload);
}

/**
 * 发送状态响应（响应平台查询或主动上报）
 * 主题: device/status/response/{deviceId}
 */
async function sendStatus() {
  const topic = `device/status/response/${config.device.deviceId}`;

  // 模拟状态变化
  deviceState.battery = Math.max(0, deviceState.battery - 0.05);
  deviceState.network = -60 + Math.floor(Math.random() * 30 - 15);
  deviceState.temperature = 22 + Math.random() * 8;
  deviceState.humidity = 50 + Math.floor(Math.random() * 30);

  const payload = {
    deviceId: config.device.deviceId,
    battery: Math.floor(deviceState.battery),
    network: deviceState.network,
    temperature: parseFloat(deviceState.temperature.toFixed(1)),
    humidity: deviceState.humidity,
    isRecording: deviceState.isRecording,
    isStreaming: deviceState.isStreaming,
    isMuted: deviceState.isMuted,
    timestamp: Date.now(),
  };

  console.log('[Device] Sending status...');
  console.log(`[Device] Topic: ${topic}`);
  console.log(`[Device] Payload:`, JSON.stringify(payload, null, 2));

  await publish(topic, payload);
}

/**
 * 发送事件上报
 * 主题: device/event/request/{deviceId}
 */
async function sendEvent(eventType, details, imageUrl = null, videoUrl = null) {
  const topic = `device/event/request/${config.device.deviceId}`;

  const payload = {
    deviceId: config.device.deviceId,
    type: eventType,
    details: details,
    imageUrl: imageUrl,
    videoUrl: videoUrl,
    timestamp: Date.now(),
  };

  console.log('[Device] Sending event...');
  console.log(`[Device] Topic: ${topic}`);
  console.log(`[Device] Event: ${eventType} - ${details}`);

  await publish(topic, payload);
}

/**
 * 响应配置查询
 * 主题: device/config/response/{deviceId}
 */
async function sendConfigResponse() {
  const topic = `device/config/response/${config.device.deviceId}`;

  const payload = {
    code: 0,
    deviceId: config.device.deviceId,
    config: {
      resolution: '1080p',
      frameRate: 30,
      nightVision: true,
      motionDetection: true,
      cryingDetection: true,
      audioEnabled: !deviceState.isMuted,
      twoWayAudio: true,
    },
    timestamp: Date.now(),
  };

  console.log('[Device] Sending config response');
  await publish(topic, payload);
}

/**
 * 响应控制命令
 * 主题: device/control/response/{deviceId}
 */
async function sendControlResponse(command, commandId, success = true, message = 'Success') {
  const topic = `device/control/response/${config.device.deviceId}`;

  const payload = {
    deviceId: config.device.deviceId,
    command: command,
    commandId: commandId,
    success: success,
    message: message,
    timestamp: Date.now(),
  };

  console.log(`[Device] Sending control response: ${command} - ${message}`);
  await publish(topic, payload);
}

// ==================== 处理接收到的消息 ====================

async function handleMessage(topic, message) {
  try {
    const data = JSON.parse(message.toString());
    console.log(`[Device] Received message on ${topic}`);

    // 处理注册响应
    if (topic === `device/register/response/${config.device.deviceId}`) {
      if (data.code === 0 || data.success === true || data.code === 102) {
        console.log('[Device] ✓ Registration successful!');
        console.log('[Device] Device is now online and registered');
        deviceState.isRegistered = true;
        deviceState.isOnline = true;
        startPeriodicTasks();
      } else {
        console.error('[Device] ✗ Registration failed:', data);
      }
    }

    // 处理状态查询请求
    else if (topic === `device/status/request/${config.device.deviceId}`) {
      await sendStatus();
    }

    // 处理配置查询请求
    else if (topic === `device/config/request/${config.device.deviceId}`) {
      await sendConfigResponse();
    }

    // 处理控制命令
    else if (topic === `device/control/request/${config.device.deviceId}`) {
      await handleControlCommand(data);
    }

  } catch (error) {
    console.error('[Device] Error handling message:', error);
  }
}

/**
 * 处理控制命令
 */
async function handleControlCommand(data) {
  const { command, commandId, params } = data;
  console.log(`[Device] Executing command: ${command}`);

  try {
    switch (command) {
      case 'reboot':
        await sendControlResponse(command, commandId, true, 'Rebooting');
        setTimeout(() => {
          console.log('[Device] Rebooting...');
          process.exit(0);
        }, 1000);
        break;

      case 'start_record':
        deviceState.isRecording = true;
        await sendControlResponse(command, commandId, true, 'Recording started');
        break;

      case 'stop_record':
        deviceState.isRecording = false;
        await sendControlResponse(command, commandId, true, 'Recording stopped');
        break;

      case 'start_stream':
        deviceState.isStreaming = true;
        await sendControlResponse(command, commandId, true, 'Streaming started');
        break;

      case 'stop_stream':
        deviceState.isStreaming = false;
        await sendControlResponse(command, commandId, true, 'Streaming stopped');
        break;

      case 'mute':
        deviceState.isMuted = true;
        await sendControlResponse(command, commandId, true, 'Device muted');
        break;

      case 'unmute':
        deviceState.isMuted = false;
        await sendControlResponse(command, commandId, true, 'Device unmuted');
        break;

      case 'play_lullaby':
        console.log('[Device] Playing lullaby:', params?.musicId);
        await sendControlResponse(command, commandId, true, 'Playing lullaby');
        break;

      case 'stop_lullaby':
        await sendControlResponse(command, commandId, true, 'Lullaby stopped');
        break;

      case 'ptz':
        console.log('[Device] PTZ operation:', params);
        await sendControlResponse(command, commandId, true, 'PTZ completed');
        break;

      case 'resolution':
        console.log('[Device] Setting resolution:', params?.resolution);
        await sendControlResponse(command, commandId, true, 'Resolution updated');
        break;

      case 'snapshot':
        console.log('[Device] Taking snapshot...');
        await sleep(500);
        await sendControlResponse(command, commandId, true, 'Snapshot taken', {
          imageUrl: `https://example.com/snapshots/${Date.now()}.jpg`,
        });
        break;

      default:
        await sendControlResponse(command, commandId, false, 'Unknown command');
    }
  } catch (error) {
    console.error('[Device] Error executing command:', error);
    await sendControlResponse(command, commandId, false, error.message);
  }
}

// ==================== 周期性任务 ====================

function startPeriodicTasks() {
  // 状态上报 - 每 6 秒上报一次
  if (!statusTimer) {
    statusTimer = setInterval(() => {
      sendStatus();
    }, config.statusInterval);
  }

  // 启动事件模拟
  simulateRandomEvents.start();

  console.log('[Device] Periodic tasks started (status: 6s, events: 15s)');
}

function stopPeriodicTasks() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }

  // 停止事件模拟
  simulateRandomEvents.stop();

  console.log('[Device] Periodic tasks stopped');
}

// ==================== 设备能力 ====================

function getCapabilities() {
  const capabilities = {
    camera: ['video', 'audio', 'motion_detection', 'crying_detection', 'night_vision', 'two_way_audio', 'ptz', 'snapshot'],
    screen: ['display', 'touch', 'audio'],
    sensor: ['temperature', 'humidity', 'motion'],
  };

  return capabilities[config.device.productType] || [];
}

// ==================== 模拟事件 ====================

function simulateRandomEvents() {
  const events = [
    { type: 1, name: 'Crying detected', eventType: 'crying_detected' },
    { type: 2, name: 'Motion detected', eventType: 'motion_detected' },
    { type: 3, name: 'Person detected', eventType: 'person_detected' },
  ];

  // 每 15 秒触发事件（30% 概率）
  let eventTimer = null;

  function startEvents() {
    if (eventTimer) return;

    eventTimer = setInterval(() => {
      if (deviceState.isOnline && deviceState.isRegistered && Math.random() > 0.7) {
        const event = events[Math.floor(Math.random() * events.length)];
        sendEvent(event.eventType, event.name);
      }
    }, 15000);

    console.log('[Device] Event simulation started (every 15s, 30% probability)');
  }

  function stopEvents() {
    if (eventTimer) {
      clearInterval(eventTimer);
      eventTimer = null;
      console.log('[Device] Event simulation stopped');
    }
  }

  // 暴露控制方法
  simulateRandomEvents.start = startEvents;
  simulateRandomEvents.stop = stopEvents;
}

// ==================== 优雅关闭 ====================

function gracefulShutdown() {
  console.log('[Device] Shutting down gracefully...');

  deviceState.isOnline = false;
  stopPeriodicTasks();

  if (client) {
    // 发送离线状态
    sendStatus().then(() => {
      client.end(false, () => {
        console.log('[Device] Disconnected from MQTT Broker');
        process.exit(0);
      });
    });

    setTimeout(() => {
      console.log('[Device] Force exit');
      process.exit(1);
    }, 5000);
  } else {
    process.exit(0);
  }
}

// ==================== 主程序 ====================

console.log('=======================================');
console.log('  Baby Monitor - Mock MQTT Device');
console.log('=======================================');
console.log(`Device ID:      ${config.device.deviceId}`);
console.log(`Serial Number:  ${config.device.serialNumber}`);
console.log(`Product Type:   ${config.device.productType}`);
console.log(`MQTT Broker:    ${config.mqtt.host}:${config.mqtt.port}`);
console.log('=======================================');
console.log('');
console.log('MQTT Topic Format: device/{type}/{direction}/{deviceId}');
console.log('  - device/register/request (broadcast)');
console.log('  - device/register/response/{id} (unicast)');
console.log('  - device/status/request/{id} (unicast)');
console.log('  - device/status/response/{id} (unicast)');
console.log('  - device/event/request/{id} (unicast)');
console.log('  - device/control/request/{id} (unicast)');
console.log('=======================================');
console.log('');

// 启动连接
connect();

// 初始化事件模拟函数（必须先调用以设置start/stop方法）
simulateRandomEvents();

// 信号处理
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// ==================== 交互式命令 ====================

console.log('[Device] Interactive commands:');
console.log('  status    - Send status update');
console.log('  state     - Show current device state');
console.log('  event     - Send test event');
console.log('  crying    - Send crying event');
console.log('  motion    - Send motion event');
console.log('  person    - Send person detection event');
console.log('  snapshot  - Take snapshot');
console.log('  events-on - Enable automatic event simulation');
console.log('  events-off - Disable automatic event simulation');
console.log('  help      - Show all commands');
console.log('  exit      - Exit the program');
console.log('');

process.stdin.setEncoding('utf8');
process.stdin.on('readable', () => {
  const chunk = process.stdin.read();
  if (chunk !== null) {
    const command = chunk.trim().toLowerCase();

    switch (command) {
      case 'status':
        sendStatus();
        break;

      case 'state':
        console.log('[Device] Current state:');
        console.log(`  Registered: ${deviceState.isRegistered}`);
        console.log(`  Online: ${deviceState.isOnline}`);
        console.log(`  Battery: ${Math.floor(deviceState.battery)}%`);
        console.log(`  Network: ${deviceState.network} dBm`);
        console.log(`  Temperature: ${deviceState.temperature.toFixed(1)}°C`);
        console.log(`  Humidity: ${deviceState.humidity}%`);
        console.log(`  Recording: ${deviceState.isRecording}`);
        console.log(`  Streaming: ${deviceState.isStreaming}`);
        console.log(`  Muted: ${deviceState.isMuted}`);
        break;

      case 'event':
        sendEvent('test_event', 'Manual test event from ' + config.device.deviceId);
        break;

      case 'crying':
        sendEvent('crying_detected', 'Crying detected (manual)');
        break;

      case 'motion':
        sendEvent('motion_detected', 'Motion detected (manual)');
        break;

      case 'person':
        sendEvent('person_detected', 'Person detected (manual)');
        break;

      case 'snapshot':
        // 模拟快照命令
        handleControlCommand({
          command: 'snapshot',
          commandId: generateCommandId(),
          params: {}
        });
        break;

      case 'events-on':
        if (deviceState.isRegistered) {
          simulateRandomEvents.start();
          console.log('[Device] Automatic event simulation enabled');
        } else {
          console.log('[Device] Device must be registered first');
        }
        break;

      case 'events-off':
        simulateRandomEvents.stop();
        console.log('[Device] Automatic event simulation disabled');
        break;

      case 'help':
        console.log('');
        console.log('Available commands:');
        console.log('  status      - Send status update to platform');
        console.log('  state       - Show current device state');
        console.log('  event       - Send test event');
        console.log('  crying      - Send crying detection event');
        console.log('  motion      - Send motion detection event');
        console.log('  person      - Send person detection event');
        console.log('  snapshot    - Take a snapshot');
        console.log('  events-on   - Enable automatic event simulation');
        console.log('  events-off  - Disable automatic event simulation');
        console.log('  help        - Show this help message');
        console.log('  exit        - Exit the program');
        console.log('');
        break;

      case 'exit':
      case 'quit':
        gracefulShutdown();
        break;

      case '':
        break;

      default:
        console.log(`[Device] Unknown command: ${command}. Type "help" for available commands.`);
    }
  }
});
