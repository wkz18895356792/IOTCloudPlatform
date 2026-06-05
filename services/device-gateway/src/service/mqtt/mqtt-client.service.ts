import { Provide, Inject, Scope, ScopeEnum, Config } from '@midwayjs/core';
import * as mqtt from 'mqtt';
import * as fs from 'fs';
import * as tls from 'tls';
import { ILogger } from '@midwayjs/logger';

/**
 * MQTT客户端服务
 *
 * 管理与MQTT Broker的连接
 * 提供发布/订阅功能
 *
 * 职责：
 * - 建立和维护MQTT连接
 * - 处理连接状态变化
 * - 提供消息发布接口
 * - 管理主题订阅
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class MqttClientService {
  @Inject()
  logger!: ILogger;

  @Config('mqtt')
  mqttConfig: any;

  private client!: mqtt.MqttClient;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  /**
   * 连接到MQTT Broker
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: mqtt.IClientOptions = {
        clientId: this.mqttConfig.options?.clientId || `device-gateway-${process.pid}`,
        clean: this.mqttConfig.options?.clean ?? true,
        connectTimeout: this.mqttConfig.options?.connectTimeout || 4000,
        keepalive: this.mqttConfig.options?.keepalive || 60,
        reconnectPeriod: this.mqttConfig.options?.reconnectPeriod || 1000,
        rejectUnauthorized: this.mqttConfig.options?.rejectUnauthorized ?? false,
      };

      // 添加认证
      if (this.mqttConfig.username) {
        options.username = this.mqttConfig.username;
      }
      if (this.mqttConfig.password) {
        options.password = this.mqttConfig.password;
      }

      // TLS 配置
      const tlsConfig = this.mqttConfig.tls || {};
      const useTls = tlsConfig.enabled === true;

      if (useTls) {
        if (tlsConfig.caPath) {
          options.ca = [fs.readFileSync(tlsConfig.caPath)];
        }
        if (tlsConfig.keyPath) {
          options.key = fs.readFileSync(tlsConfig.keyPath);
        }
        if (tlsConfig.certPath) {
          options.cert = fs.readFileSync(tlsConfig.certPath);
        }
        options.rejectUnauthorized = tlsConfig.rejectUnauthorized ?? false;
      }

      const protocol = useTls ? 'mqtts' : 'mqtt';
      const url = `${protocol}://${this.mqttConfig.host}:${this.mqttConfig.port}`;

      this.client = mqtt.connect(url, options);

      this.client.on('connect', () => {
        this.logger.info('[MQTT Client] Connected to broker');
        this.connected = true;
        this.reconnectAttempts = 0;
        resolve();
      });

      this.client.on('error', (err) => {
        this.logger.error('[MQTT Client] Connection error:', err);
        this.connected = false;
        reject(err);
      });

      this.client.on('close', () => {
        this.logger.warn('[MQTT Client] Connection closed');
        this.connected = false;
      });

      this.client.on('reconnect', () => {
        this.reconnectAttempts++;
        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
          this.logger.info(`[MQTT Client] Reconnecting... (attempt ${this.reconnectAttempts})`);
        } else {
          this.logger.error('[MQTT Client] Max reconnect attempts reached');
          this.client.end();
        }
      });

      this.client.on('offline', () => {
        this.logger.warn('[MQTT Client] Client offline');
        this.connected = false;
      });

      // 设置错误处理
      this.client.on('packetsend', (packet) => {
        // 调试日志
        if (packet.cmd === 'publish') {
          this.logger.debug(`[MQTT Client] Publishing to ${(packet as any).topic}`);
        }
      });
    });
  }

  /**
   * 发布消息
   *
   * @param topic 主题
   * @param payload 消息内容
   * @param qos QoS级别
   */
  async publish(topic: string, payload: string, qos: 0 | 1 | 2 = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(topic, payload, { qos }, (err) => {
        if (err) {
          this.logger.error(`[MQTT Client] Failed to publish to ${topic}:`, err);
          reject(err);
        } else {
          this.logger.debug(`[MQTT Client] Published to ${topic}`);
          resolve();
        }
      });
    });
  }

  /**
   * 订阅主题
   *
   * @param topic 主题
   * @param qos QoS级别
   */
  async subscribe(topic: string, qos: 0 | 1 | 2 = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.subscribe(topic, { qos }, (err) => {
        if (err) {
          this.logger.error(`[MQTT Client] Failed to subscribe to ${topic}:`, err);
          reject(err);
        } else {
          this.logger.info(`[MQTT Client] Subscribed to ${topic}`);
          resolve();
        }
      });
    });
  }

  /**
   * 取消订阅主题
   *
   * @param topic 主题
   */
  async unsubscribe(topic: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.unsubscribe(topic, (err) => {
        if (err) {
          this.logger.error(`[MQTT Client] Failed to unsubscribe from ${topic}:`, err);
          reject(err);
        } else {
          this.logger.info(`[MQTT Client] Unsubscribed from ${topic}`);
          resolve();
        }
      });
    });
  }

  /**
   * 获取MQTT客户端实例
   */
  getClient(): mqtt.MqttClient {
    return this.client;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected && this.client && !this.client.disconnecting;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.client) {
        this.client.end(false, {}, () => {
          this.logger.info('[MQTT Client] Disconnected from broker');
          this.connected = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
