/**
 * 设备模拟器 - 批量设备测试
 *
 * 功能：
 * - 一次性注册 100 台设备
 * - 保持设备在线状态（心跳）
 * - 定期上报设备状态
 * - 定期上报随机设备事件
 *
 * 使用方法：
 * - 默认运行: npm run test:simulator
 * - 指定设备数: DEVICE_COUNT=500 npm run test:simulator
 */

import * as mqtt from 'mqtt';
import * as crypto from 'crypto';

// 配置
const CONFIG = {
  MQTT_HOST: process.env.MQTT_HOST || 'localhost',
  MQTT_PORT: parseInt(process.env.MQTT_PORT || '1883'),
  DEVICE_COUNT: parseInt(process.env.DEVICE_COUNT || '100'),
  HEARTBEAT_INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL || '30000'), // 30秒
  STATUS_INTERVAL: parseInt(process.env.STATUS_INTERVAL || '60000'), // 1分钟
  EVENT_INTERVAL: parseInt(process.env.EVENT_INTERVAL || '45000'), // 45秒
  CONNECTION_BATCH_SIZE: parseInt(process.env.CONNECTION_BATCH_SIZE || '10'),
  CONNECTION_BATCH_DELAY: parseInt(process.env.CONNECTION_BATCH_DELAY || '500'),
  PRODUCT_TYPES: ['camera', 'screen', 'sensor', 'gateway'] as const,
  PROTOCOLS: ['private', 'matter'] as const,
};

// 设备类型
type ProductType = typeof CONFIG.PRODUCT_TYPES[number];
type Protocol = typeof CONFIG.PROTOCOLS[number];

// 事件类型
const EVENT_TYPES = [
  'crying_detected',
  'motion_detected',
  'person_detected',
  'temperature_alert',
  'battery_low',
  'network_weak',
  'storage_full',
  'firmware_update_available',
  'sound_detected',
  'face_detected',
];

// 设备接口
interface SimulatedDevice {
  serialNumber: string;
  productType: ProductType;
  protocol: Protocol;
  firmwareVersion: string;
  macAddress: string;
  client: mqtt.MqttClient | null;
  connected: boolean;
  registered: boolean;
  lastHeartbeat: Date | null;
  lastStatus: Date | null;
  lastEvent: Date | null;
  state: DeviceState;
}

// 设备状态
interface DeviceState {
  batteryLevel: number;
  signalStrength: number;
  cpuUsage: number;
  memoryUsage: number;
  temperature: number;
  humidity: number;
  isRecording: boolean;
  motionDetected: boolean;
}

// 统计信息
interface Statistics {
  totalDevices: number;
  connectedDevices: number;
  registeredDevices: number;
  totalHeartbeats: number;
  totalStatusReports: number;
  totalEvents: number;
  errors: number;
  startTime: Date;
}

class DeviceSimulator {
  private devices: Map<string, SimulatedDevice> = new Map();
  private stats: Statistics = {
    totalDevices: 0,
    connectedDevices: 0,
    registeredDevices: 0,
    totalHeartbeats: 0,
    totalStatusReports: 0,
    totalEvents: 0,
    errors: 0,
    startTime: new Date(),
  };
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private eventTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * 生成随机 MAC 地址
   */
  private generateMacAddress(): string {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
    return `${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
  }

  /**
   * 生成随机设备状态
   */
  private generateRandomState(productType: ProductType): DeviceState {
    const baseState: DeviceState = {
      batteryLevel: Math.floor(Math.random() * 40) + 60, // 60-100
      signalStrength: Math.floor(Math.random() * 30) - 70, // -70 to -40 dBm
      cpuUsage: Math.floor(Math.random() * 40) + 10, // 10-50%
      memoryUsage: Math.floor(Math.random() * 30) + 30, // 30-60%
      temperature: Math.floor(Math.random() * 15) + 25, // 25-40°C
      humidity: Math.floor(Math.random() * 30) + 40, // 40-70%
      isRecording: false,
      motionDetected: false,
    };

    // 根据设备类型调整状态
    if (productType === 'camera') {
      baseState.isRecording = Math.random() > 0.3;
      baseState.motionDetected = Math.random() > 0.7;
      baseState.cpuUsage += 20; // 摄像头 CPU 使用率更高
    } else if (productType === 'sensor') {
      baseState.batteryLevel = Math.floor(Math.random() * 30) + 70; // 传感器更省电
    }

    return baseState;
  }

  /**
   * 创建模拟设备
   */
  private createDevice(index: number): SimulatedDevice {
    const productType = CONFIG.PRODUCT_TYPES[index % CONFIG.PRODUCT_TYPES.length];
    const protocol = CONFIG.PROTOCOLS[index % CONFIG.PROTOCOLS.length];
    const serialNumber = `SIM-${Date.now()}-${index.toString().padStart(4, '0')}`;

    return {
      serialNumber,
      productType,
      protocol,
      firmwareVersion: `1.${Math.floor(index / 20)}.${index % 20}`,
      macAddress: this.generateMacAddress(),
      client: null,
      connected: false,
      registered: false,
      lastHeartbeat: null,
      lastStatus: null,
      lastEvent: null,
      state: this.generateRandomState(productType),
    };
  }

  /**
   * 连接设备到 MQTT Broker
   */
  private connectDevice(device: SimulatedDevice): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const client = mqtt.connect(`mqtt://${CONFIG.MQTT_HOST}:${CONFIG.MQTT_PORT}`, {
          clientId: `sim-${device.serialNumber}`,
          clean: true,
          connectTimeout: 10000,
          keepalive: 60,
          reconnectPeriod: 5000, // 自动重连
        });

        client.on('connect', () => {
          device.connected = true;
          device.client = client;
          this.stats.connectedDevices++;
          this.log('debug', `Device ${device.serialNumber} connected`);
          resolve();
        });

        client.on('error', (err) => {
          this.stats.errors++;
          this.log('error', `Device ${device.serialNumber} error: ${err.message}`);
          if (!device.connected) {
            reject(err);
          }
        });

        client.on('close', () => {
          const wasConnected = device.connected;
          device.connected = false;
          if (wasConnected) {
            this.stats.connectedDevices--;
          }
          this.log('warn', `Device ${device.serialNumber} disconnected`);
        });

        client.on('reconnect', () => {
          this.log('info', `Device ${device.serialNumber} reconnecting...`);
        });

        // 设置连接超时
        setTimeout(() => {
          if (!device.connected) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 发送设备注册消息
   * 主题: devices/{deviceId}/register
   */
  private async registerDevice(device: SimulatedDevice): Promise<void> {
    if (!device.client || !device.connected) return;

    const topic = `devices/${device.serialNumber}/register`;
    const payload = {
      deviceId: device.serialNumber,
      serialNumber: device.serialNumber,
      productType: device.productType,
      protocol: device.protocol,
      firmwareVersion: device.firmwareVersion,
      macAddress: device.macAddress,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      device.client!.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) {
          this.stats.errors++;
          this.log('error', `Failed to register ${device.serialNumber}: ${err.message}`);
          reject(err);
        } else {
          device.registered = true;
          this.stats.registeredDevices++;
          this.log('debug', `Registered ${device.serialNumber}`);
          resolve();
        }
      });
    });
  }

  /**
   * 发送心跳
   * 主题: devices/{deviceId}/heartbeat
   */
  private sendHeartbeat(device: SimulatedDevice): void {
    if (!device.client || !device.connected) return;

    const topic = `devices/${device.serialNumber}/heartbeat`;
    const payload = {
      deviceId: device.serialNumber,
      type: 'heartbeat',
      timestamp: Date.now(),
      batteryLevel: device.state.batteryLevel,
      signalStrength: device.state.signalStrength,
      temperature: device.state.temperature,
    };

    device.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) {
        this.stats.errors++;
        this.log('error', `Heartbeat failed for ${device.serialNumber}`);
      } else {
        device.lastHeartbeat = new Date();
        this.stats.totalHeartbeats++;
      }
    });
  }

  /**
   * 发送设备状态
   * 主题: devices/{deviceId}/status
   */
  private sendStatus(device: SimulatedDevice): void {
    if (!device.client || !device.connected) return;

    // 更新状态（模拟变化）
    this.updateDeviceState(device);

    const topic = `devices/${device.serialNumber}/status`;
    const payload = {
      deviceId: device.serialNumber,
      type: 'status',
      status: 'online',
      timestamp: Date.now(),
      cpuUsage: device.state.cpuUsage,
      memoryUsage: device.state.memoryUsage,
      temperature: device.state.temperature,
      humidity: device.state.humidity,
      batteryLevel: device.state.batteryLevel,
      signalStrength: device.state.signalStrength,
      isRecording: device.state.isRecording,
      motionDetected: device.state.motionDetected,
    };

    device.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) {
        this.stats.errors++;
        this.log('error', `Status report failed for ${device.serialNumber}`);
      } else {
        device.lastStatus = new Date();
        this.stats.totalStatusReports++;
      }
    });
  }

  /**
   * 发送设备事件
   * 主题: devices/{deviceId}/event
   */
  private sendEvent(device: SimulatedDevice): void {
    if (!device.client || !device.connected) return;

    const eventType = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
    const topic = `devices/${device.serialNumber}/event`;
    const timestamp = Date.now();

    let payload: any = {
      deviceId: device.serialNumber,
      eventType,
      timestamp,
    };

    // 根据事件类型添加详情
    switch (eventType) {
      case 'crying_detected':
        payload.details = {
          confidence: +(Math.random() * 0.3 + 0.7).toFixed(2), // 0.7-1.0
          duration: Math.floor(Math.random() * 30) + 5, // 5-35 秒
          audioLevel: Math.floor(Math.random() * 30) + 60, // 60-90 dB
        };
        break;
      case 'motion_detected':
        payload.details = {
          zone: `zone_${Math.floor(Math.random() * 4) + 1}`,
          sensitivity: 'high',
          duration: Math.floor(Math.random() * 10) + 1,
        };
        payload.imageUrl = `https://storage.example.com/events/${device.serialNumber}/${timestamp}.jpg`;
        break;
      case 'person_detected':
        payload.details = {
          personCount: Math.floor(Math.random() * 3) + 1,
          recognized: Math.random() > 0.5,
          personId: Math.random() > 0.5 ? `person_${Math.floor(Math.random() * 10)}` : null,
        };
        break;
      case 'sound_detected':
        payload.details = {
          soundType: ['cry', 'laugh', 'talk', 'noise'][Math.floor(Math.random() * 4)],
          duration: Math.floor(Math.random() * 20) + 1,
          audioLevel: Math.floor(Math.random() * 40) + 40,
        };
        break;
      case 'face_detected':
        payload.details = {
          faceCount: Math.floor(Math.random() * 3) + 1,
          recognized: Math.random() > 0.4,
          faceId: Math.random() > 0.4 ? `face_${Math.floor(Math.random() * 10)}` : null,
        };
        break;
      case 'temperature_alert':
        payload.details = {
          currentTemp: device.state.temperature,
          threshold: 35,
          trend: Math.random() > 0.5 ? 'rising' : 'stable',
        };
        break;
      case 'battery_low':
        payload.details = {
          level: device.state.batteryLevel,
          estimatedMinutes: Math.floor(device.state.batteryLevel * 3),
        };
        break;
      case 'network_weak':
        payload.details = {
          signalStrength: device.state.signalStrength,
          packetLoss: Math.floor(Math.random() * 20) + 5,
        };
        break;
      case 'storage_full':
        payload.details = {
          usedPercent: Math.floor(Math.random() * 20) + 80,
          totalGB: 32,
        };
        break;
      case 'firmware_update_available':
        payload.details = {
          currentVersion: device.firmwareVersion,
          newVersion: '2.0.0',
          sizeMB: Math.floor(Math.random() * 50) + 20,
        };
        break;
      default:
        payload.details = { message: `Event: ${eventType}` };
    }

    device.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) {
        this.stats.errors++;
        this.log('error', `Event report failed for ${device.serialNumber}`);
      } else {
        device.lastEvent = new Date();
        this.stats.totalEvents++;
      }
    });
  }

  /**
   * 更新设备状态（模拟变化）
   */
  private updateDeviceState(device: SimulatedDevice): void {
    const state = device.state;

    // 电池缓慢下降
    state.batteryLevel = Math.max(5, state.batteryLevel - Math.random() * 2);

    // 信号强度波动
    state.signalStrength = Math.min(-30, Math.max(-90, state.signalStrength + (Math.random() * 10 - 5)));

    // CPU 和内存使用波动
    state.cpuUsage = Math.min(95, Math.max(5, state.cpuUsage + (Math.random() * 10 - 5)));
    state.memoryUsage = Math.min(95, Math.max(20, state.memoryUsage + (Math.random() * 6 - 3)));

    // 温度波动
    state.temperature = Math.min(45, Math.max(20, state.temperature + (Math.random() * 2 - 1)));

    // 湿度波动
    state.humidity = Math.min(80, Math.max(30, state.humidity + (Math.random() * 4 - 2)));

    // 摄像头特殊状态
    if (device.productType === 'camera') {
      state.isRecording = Math.random() > 0.2;
      state.motionDetected = Math.random() > 0.8;
    }
  }

  /**
   * 日志输出
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    // 只在 info 及以上级别输出，除非是 debug 模式
    if (level === 'debug' && process.env.DEBUG !== 'true') {
      return;
    }

    console.log(`${prefix} ${message}`);
  }

  /**
   * 打印统计信息
   */
  private printStats(): void {
    const uptime = Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║                    设备模拟器统计                          ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║ 运行时间:      ${(`${hours}h ${minutes}m ${seconds}s`).padEnd(40)}║`);
    console.log(`║ 总设备数:      ${this.stats.totalDevices.toString().padEnd(40)}║`);
    console.log(`║ 已连接:        ${this.stats.connectedDevices.toString().padEnd(40)}║`);
    console.log(`║ 已注册:        ${this.stats.registeredDevices.toString().padEnd(40)}║`);
    console.log(`║ 心跳总数:      ${this.stats.totalHeartbeats.toString().padEnd(40)}║`);
    console.log(`║ 状态上报总数:  ${this.stats.totalStatusReports.toString().padEnd(40)}║`);
    console.log(`║ 事件上报总数:  ${this.stats.totalEvents.toString().padEnd(40)}║`);
    console.log(`║ 错误数:        ${this.stats.errors.toString().padEnd(40)}║`);
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
  }

  /**
   * 启动定时任务
   */
  private startTimers(): void {
    // 心跳定时器
    this.heartbeatTimer = setInterval(() => {
      const connectedDevices = Array.from(this.devices.values()).filter(d => d.connected);
      for (const device of connectedDevices) {
        this.sendHeartbeat(device);
      }
    }, CONFIG.HEARTBEAT_INTERVAL);

    // 状态上报定时器
    this.statusTimer = setInterval(() => {
      // 每次随机选择 20% 的设备上报状态，避免同时上报
      const devices = Array.from(this.devices.values()).filter(d => d.connected);
      const reportCount = Math.ceil(devices.length * 0.2);
      const selectedDevices = this.shuffleArray(devices).slice(0, reportCount);

      for (const device of selectedDevices) {
        this.sendStatus(device);
      }
    }, CONFIG.STATUS_INTERVAL);

    // 事件上报定时器
    this.eventTimer = setInterval(() => {
      // 每次随机选择 5-10% 的设备上报事件
      const devices = Array.from(this.devices.values()).filter(d => d.connected);
      const reportCount = Math.ceil(devices.length * (0.05 + Math.random() * 0.05));
      const selectedDevices = this.shuffleArray(devices).slice(0, reportCount);

      for (const device of selectedDevices) {
        this.sendEvent(device);
      }
    }, CONFIG.EVENT_INTERVAL);

    // 统计信息定时器
    this.statsTimer = setInterval(() => {
      this.printStats();
    }, 60000); // 每分钟打印一次

    this.log('info', 'Timers started');
    this.log('info', `  - Heartbeat interval: ${CONFIG.HEARTBEAT_INTERVAL}ms`);
    this.log('info', `  - Status interval: ${CONFIG.STATUS_INTERVAL}ms`);
    this.log('info', `  - Event interval: ${CONFIG.EVENT_INTERVAL}ms`);
  }

  /**
   * 停止定时任务
   */
  private stopTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.eventTimer) clearInterval(this.eventTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);

    this.heartbeatTimer = null;
    this.statusTimer = null;
    this.eventTimer = null;
    this.statsTimer = null;
  }

  /**
   * 数组随机排序
   */
  private shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 启动模拟器
   */
  async start(): Promise<void> {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║                    设备模拟器启动                          ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║ MQTT Broker:   ${(`${CONFIG.MQTT_HOST}:${CONFIG.MQTT_PORT}`).padEnd(40)}║`);
    console.log(`║ 设备数量:      ${CONFIG.DEVICE_COUNT.toString().padEnd(40)}║`);
    console.log(`║ 心跳间隔:      ${(`${CONFIG.HEARTBEAT_INTERVAL}ms`).padEnd(40)}║`);
    console.log(`║ 状态间隔:      ${(`${CONFIG.STATUS_INTERVAL}ms`).padEnd(40)}║`);
    console.log(`║ 事件间隔:      ${(`${CONFIG.EVENT_INTERVAL}ms`).padEnd(40)}║`);
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    this.isRunning = true;

    // 创建设备
    this.log('info', `Creating ${CONFIG.DEVICE_COUNT} devices...`);
    for (let i = 0; i < CONFIG.DEVICE_COUNT; i++) {
      const device = this.createDevice(i);
      this.devices.set(device.serialNumber, device);
    }
    this.stats.totalDevices = this.devices.size;
    this.log('info', `Created ${this.devices.size} devices`);

    // 批量连接设备
    this.log('info', 'Connecting devices...');
    const deviceList = Array.from(this.devices.values());
    const batchCount = Math.ceil(deviceList.length / CONFIG.CONNECTION_BATCH_SIZE);

    for (let i = 0; i < deviceList.length; i += CONFIG.CONNECTION_BATCH_SIZE) {
      const batchIndex = Math.floor(i / CONFIG.CONNECTION_BATCH_SIZE) + 1;
      const batch = deviceList.slice(i, i + CONFIG.CONNECTION_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((device) => this.connectDevice(device))
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      this.log(
        'info',
        `Connection batch ${batchIndex}/${batchCount}: ${succeeded} connected, ${failed} failed`
      );

      // 批次间延迟，避免连接过载
      if (i + CONFIG.CONNECTION_BATCH_SIZE < deviceList.length) {
        await this.delay(CONFIG.CONNECTION_BATCH_DELAY);
      }
    }

    this.log('info', `Connected ${this.stats.connectedDevices}/${this.stats.totalDevices} devices`);

    // 批量注册设备
    this.log('info', 'Registering devices...');
    for (let i = 0; i < deviceList.length; i += CONFIG.CONNECTION_BATCH_SIZE) {
      const batchIndex = Math.floor(i / CONFIG.CONNECTION_BATCH_SIZE) + 1;
      const batch = deviceList.slice(i, i + CONFIG.CONNECTION_BATCH_SIZE).filter((d) => d.connected);
      const results = await Promise.allSettled(
        batch.map((device) => this.registerDevice(device))
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;

      this.log(
        'info',
        `Register batch ${batchIndex}/${batchCount}: ${succeeded}/${batch.length} registered`
      );

      if (i + CONFIG.CONNECTION_BATCH_SIZE < deviceList.length) {
        await this.delay(200);
      }
    }

    this.log('info', `Registered ${this.stats.registeredDevices} devices`);

    // 启动定时任务
    this.startTimers();

    // 立即发送第一批心跳和状态
    this.log('info', 'Sending initial heartbeats and status...');
    for (const device of this.devices.values()) {
      if (device.connected) {
        this.sendHeartbeat(device);
      }
    }

    // 延迟发送初始状态
    await this.delay(1000);
    const connectedDevices = Array.from(this.devices.values()).filter(d => d.connected);
    const initialStatusDevices = this.shuffleArray(connectedDevices).slice(0, Math.ceil(connectedDevices.length * 0.3));
    for (const device of initialStatusDevices) {
      this.sendStatus(device);
    }

    this.log('info', 'Simulator started successfully!');
    this.printStats();
  }

  /**
   * 停止模拟器
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.log('info', 'Stopping simulator...');
    this.isRunning = false;
    this.stopTimers();

    // 断开所有设备
    const disconnectPromises = Array.from(this.devices.values()).map((device) => {
      return new Promise<void>((resolve) => {
        if (device.client) {
          device.client.end(false, () => {
            device.connected = false;
            resolve();
          });
        } else {
          resolve();
        }
      });
    });

    await Promise.all(disconnectPromises);

    this.stats.connectedDevices = 0;
    this.log('info', 'Simulator stopped');
    this.printStats();
  }
}

// 主程序
async function main() {
  const simulator = new DeviceSimulator();

  // 处理退出信号
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down...');
    await simulator.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down...');
    await simulator.stop();
    process.exit(0);
  });

  // 处理未捕获的异常
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    simulator.stop().finally(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  try {
    await simulator.start();

    // 保持进程运行
    console.log('\nPress Ctrl+C to stop the simulator\n');
  } catch (error) {
    console.error('Failed to start simulator:', error);
    process.exit(1);
  }
}

main();
