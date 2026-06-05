import { Provide, Inject, Scope, ScopeEnum, Init, Config } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import Redis from 'ioredis';
import { JsonUtil } from '@baby-monitor/shared-utils';
import { MqttClientService } from '../../service/mqtt/mqtt-client.service';
import { ConnectionManagerService } from '../../service/core/connection-manager.service';
import { MessageRouterService } from '../../service/core/message-router.service';
import {
  ServiceCommandType,
  ServiceCommand,
  SendCredentialsResponseCommand,
  SendDeviceCommandCommand,
  SendConfigResponseCommand,
  SendRegisterResponseCommand,
  SendOTACommandCommand,
  SendCollectLogsCommand,
  DeviceCredentialsResponse,
  DeviceCommandRequest,
  DeviceConfigResponse,
} from '../../types/mqtt-messages';

/**
 * 服务命令频道名称
 */
const SERVICE_COMMAND_CHANNEL = 'service:device-gateway';

/**
 * 设备网关核心服务
 *
 * 统一网关的核心，协调MQTT连接、协议处理和消息路由
 * 负责连接MQTT Broker并管理设备连接生命周期
 *
 * 职责：
 * - 管理MQTT Broker连接
 * - 协调消息路由和协议转换
 * - 管理设备连接状态
 * - 发布消息到设备和下游服务
 * - 接收并处理来自其他服务的下发命令
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class GatewayCoreService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  mqttClientService!: MqttClientService;

  @Inject()
  connectionManager!: ConnectionManagerService;

  @Inject()
  messageRouter?: MessageRouterService;

  @Config('redis.client')
  redisConfig: any;

  /**
   * 独立的 Redis 发布客户端
   * 用于发布消息到 Redis 频道（因为订阅模式的连接不能执行 publish 命令）
   */
  private redisPublisher!: Redis;

  /**
   * 独立的 Redis 订阅客户端
   * 用于订阅 Redis 频道（因为订阅模式的连接不能执行普通命令，如 smembers）
   */
  private redisSubscriber!: Redis;

  /**
   * 初始化网关
   * 连接MQTT Broker并设置消息处理器
   */
  @Init()
  async initialize(): Promise<void> {
    try {
      // 创建独立的 Redis 发布客户端（因为订阅模式的连接不能执行 publish 命令）
      this.redisPublisher = new Redis({
        host: this.redisConfig.host || 'localhost',
        port: this.redisConfig.port || 6379,
        password: this.redisConfig.password || undefined,
        db: this.redisConfig.db || 0,
        maxRetriesPerRequest: 3,
      });
      this.logger.info('[Device Gateway] Redis publisher client created');

      // 创建独立的 Redis 订阅客户端（因为订阅模式的连接不能执行普通命令，如 smembers）
      this.redisSubscriber = new Redis({
        host: this.redisConfig.host || 'localhost',
        port: this.redisConfig.port || 6379,
        password: this.redisConfig.password || undefined,
        db: this.redisConfig.db || 0,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          this.logger.warn(`[Device Gateway] Redis subscriber reconnecting in ${delay}ms (attempt ${times})`);
          return delay;
        },
      });
      this.logger.info('[Device Gateway] Redis subscriber client created');

      // 监控 Redis 订阅客户端连接状态
      this.setupRedisSubscriberEvents();

      // 设置循环依赖引用：将自己注入到 MessageRouterService
      if (this.messageRouter) {
        this.messageRouter.setGatewayCore(this);
      }

      // 尝试连接 MQTT，但不阻止服务启动
      await this.mqttClientService.connect().catch(err => {
        this.logger.warn('[Device Gateway] MQTT connection failed, service will start without MQTT:', err.message);
      });

      // 只有在 MQTT 连接成功时才设置消息处理器
      if (this.mqttClientService.isConnected()) {
        await this.setupMessageHandlers();
      }

      // 订阅服务命令频道（接收来自其他服务的下发命令）
      await this.setupServiceCommandSubscriber();

      // 启动清理任务
      await this.connectionManager.startCleanupTask();

      this.logger.info('[Device Gateway] Gateway initialized successfully');
    } catch (error) {
      this.logger.error('[Device Gateway] Failed to initialize:', error);
      // 不抛出错误，允许服务启动
    }
  }

  /**
   * 设置消息处理器
   * 订阅设备相关主题并注册处理函数
   */
  private async setupMessageHandlers(): Promise<void> {
    const client = this.mqttClientService.getClient();

    // 订阅设备主题（参考 MQTT_TOPICS.md）
    const topics = [
      // 设备生命周期
      'devices/+/register',
      'devices/+/auth',
      'devices/+/heartbeat',
      // 设备数据上报
      'devices/+/report',
      'devices/+/status',
      'devices/+/event',
      // 设备命令响应
      'devices/+/command/response',
      // 设备配置
      'devices/+/config',
      'devices/+/config/response',
      // 设备凭证
      'devices/+/credentials',
      'devices/+/credentials/response',
      // Matter 协议
      'matter/+/attribute',
      'matter/+/command',
      // 录制管理
      'devices/+/recording/upload-url',
      'devices/+/recording/upload-url/response',
      'devices/+/recording/multipart/start',
      'devices/+/recording/multipart/start/response',
      'devices/+/recording/multipart/complete',
      'devices/+/recording/multipart/complete/response',
      'devices/+/recording/register',
      'devices/+/recording/register/response',
      // 录制管理 - 批量
      'devices/+/recording/upload-url/batch',
      'devices/+/recording/register/batch',
      // OTA 固件升级
      'devices/+/ota/progress',
      'devices/+/ota/result',
      // 设备日志
      'devices/+/logs/upload-url',
      'devices/+/logs/register',
      'devices/+/logs/collect/status',
    ];

    for (const topic of topics) {
      client.subscribe(topic, { qos: 1 });
      this.logger.info(`[Device Gateway] Subscribed to topic: ${topic}`);
    }

    // 注册消息处理器
    client.on('message', async (topic: string, payload: Buffer) => {
      try {
        if (this.messageRouter) {
          await this.messageRouter.routeMessage(topic, payload);
        }
      } catch (error) {
        this.logger.error(`[Device Gateway] Error routing message from ${topic}:`, error);
      }
    });
  }

  /**
   * 发布消息到MQTT主题
   *
   * @param topic 目标主题
   * @param payload 消息内容
   * @param qos QoS级别
   */
  async publish(topic: string, payload: string, qos: 0 | 1 | 2 = 1): Promise<void> {
    return this.mqttClientService.publish(topic, payload, qos);
  }

  /**
   * 发布消息到设备
   * 主题格式: device/{messageType}/response/{deviceId}
   *
   * @param deviceId 设备ID
   * @param messageType 消息类型
   * @param payload 消息内容
   */
  async publishToDevice(deviceId: string, messageType: string, payload: string): Promise<void> {
    const topic = `device/${messageType}/response/${deviceId}`;
    return this.publish(topic, payload);
  }

  /**
   * 发布消息到下游服务（通过Redis Pub/Sub）
   *
   * @param service 目标服务名称
   * @param message 消息对象
   */
  async publishToService(service: string, message: any): Promise<void> {
    // 使用独立的 Redis 发布客户端（因为订阅模式的连接不能执行 publish 命令）
    await this.redisPublisher.publish(`service:${service}`, JsonUtil.stringify(message));
  }

  /**
   * 获取连接状态
   */
  isConnected(): boolean {
    return this.mqttClientService.isConnected();
  }

  /**
   * 获取在线设备数量
   */
  getOnlineDeviceCount(): number {
    return this.connectionManager.getOnlineDeviceCount();
  }

  /**
   * 获取设备连接信息
   *
   * @param deviceId 设备ID
   */
  getDeviceConnection(deviceId: string) {
    return this.connectionManager.getDeviceConnection(deviceId);
  }

  // ==================== Redis 订阅客户端连接监控 ====================

  /**
   * 设置 Redis 订阅客户端的连接事件监听
   * 用于监控连接状态变化，及时发现断线问题
   */
  private setupRedisSubscriberEvents(): void {
    if (!this.redisSubscriber) return;

    this.redisSubscriber.on('connect', () => {
      this.logger.info('[Device Gateway] Redis subscriber connected');
    });

    this.redisSubscriber.on('ready', () => {
      this.logger.info('[Device Gateway] Redis subscriber ready');
    });

    this.redisSubscriber.on('close', () => {
      this.logger.warn('[Device Gateway] Redis subscriber connection closed');
    });

    this.redisSubscriber.on('reconnecting', () => {
      this.logger.info('[Device Gateway] Redis subscriber reconnecting...');
    });

    this.redisSubscriber.on('error', (err: Error) => {
      this.logger.error(`[Device Gateway] Redis subscriber error: ${err.message}`);
    });

    this.redisSubscriber.on('end', () => {
      this.logger.warn('[Device Gateway] Redis subscriber connection ended permanently');
    });
  }

  // ==================== 服务命令订阅处理 ====================

  /**
   * 设置服务命令订阅器
   * 监听来自其他服务（如 device-service）的下发命令
   */
  private async setupServiceCommandSubscriber(): Promise<void> {
    try {
      // 订阅服务命令频道（使用独立客户端，避免阻塞共享 Redis 连接）
      await this.redisSubscriber.subscribe(SERVICE_COMMAND_CHANNEL);

      this.logger.info(`[Device Gateway] Subscribed to service command channel: ${SERVICE_COMMAND_CHANNEL}`);

      // 监听服务命令消息
      this.redisSubscriber.on('message', async (channel: string, message: string) => {
        if (channel !== SERVICE_COMMAND_CHANNEL) {
          return;
        }

        try {
          const parsed = JsonUtil.parse(message);
          if (!parsed || !parsed.type) {
            this.logger.warn('[Device Gateway] Invalid service command format');
            return;
          }

          await this.handleServiceCommand(parsed as ServiceCommand);
        } catch (error) {
          this.logger.error('[Device Gateway] Error handling service command:', error);
        }
      });

      // 重连后确保重新订阅（兜底机制，即使 ioredis 会自动重订阅也显式确认）
      this.redisSubscriber.on('ready', async () => {
        try {
          await this.redisSubscriber.subscribe(SERVICE_COMMAND_CHANNEL);
          this.logger.info(`[Device Gateway] Re-subscribed to service command channel after reconnection: ${SERVICE_COMMAND_CHANNEL}`);
        } catch (error) {
          this.logger.error('[Device Gateway] Failed to re-subscribe after reconnection:', error);
        }
      });
    } catch (error) {
      this.logger.error('[Device Gateway] Failed to setup service command subscriber:', error);
    }
  }

  /**
   * 处理服务命令
   *
   * @param command 服务命令
   */
  private async handleServiceCommand(command: ServiceCommand): Promise<void> {
    this.logger.debug(`[Device Gateway] Handling service command: ${command.type} for device: ${command.deviceId}`);

    switch (command.type) {
      case ServiceCommandType.SEND_CREDENTIALS_RESPONSE:
        await this.handleSendCredentialsResponse(command as SendCredentialsResponseCommand);
        break;

      case ServiceCommandType.SEND_DEVICE_COMMAND:
        await this.handleSendDeviceCommand(command as SendDeviceCommandCommand);
        break;

      case ServiceCommandType.SEND_CONFIG_RESPONSE:
        await this.handleSendConfigResponse(command as SendConfigResponseCommand);
        break;

      case ServiceCommandType.SEND_REGISTER_RESPONSE:
        await this.handleSendRegisterResponse(command as SendRegisterResponseCommand);
        break;

      case ServiceCommandType.SEND_OTA_COMMAND:
        await this.handleSendOTACommand(command as SendOTACommandCommand);
        break;

      case ServiceCommandType.SEND_COLLECT_LOGS_COMMAND:
        await this.handleSendCollectLogsCommand(command as SendCollectLogsCommand);
        break;

      default:
        this.logger.warn(`[Device Gateway] Unknown service command`);
    }
  }

  /**
   * 处理凭证响应下发命令
   */
  private async handleSendCredentialsResponse(command: SendCredentialsResponseCommand): Promise<void> {
    const { deviceId, requestId, credentials } = command;

    const response: DeviceCredentialsResponse = {
      deviceId,
      timestamp: Date.now(),
      requestId,
      credentials,
    };

    await this.publishCredentialsResponse(deviceId, response);
  }

  /**
   * 处理设备命令下发
   */
  private async handleSendDeviceCommand(command: SendDeviceCommandCommand): Promise<void> {
    const { deviceId, commandId, command: cmd, data } = command;

    const request: DeviceCommandRequest = {
      deviceId,
      timestamp: Date.now(),
      command: cmd,
      commandId,
      data,
    };

    await this.publishDeviceCommand(deviceId, request);
  }

  /**
   * 处理配置响应下发命令
   */
  private async handleSendConfigResponse(command: SendConfigResponseCommand): Promise<void> {
    const { deviceId, requestId, config } = command;

    const response: DeviceConfigResponse = {
      deviceId,
      timestamp: Date.now(),
      requestId,
      config,
    };

    await this.publishConfigResponse(deviceId, response);
  }

  /**
   * 处理注册响应下发命令
   */
  private async handleSendRegisterResponse(command: SendRegisterResponseCommand): Promise<void> {
    const { deviceId, code } = command;

    const response = {
      deviceId,
      timestamp: Date.now(),
      code,
    };

    await this.publishRegisterResponse(deviceId, response);
  }

  /**
   * 处理OTA升级命令下发
   */
  private async handleSendOTACommand(command: SendOTACommandCommand): Promise<void> {
    const { deviceId, action, taskId, payload } = command;

    const message = {
      id: `ota-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      action,
      taskId,
      timestamp: Date.now(),
      ...payload,
    };

    const topic = `devices/${deviceId}/command`;
    await this.publish(topic, JsonUtil.stringify(message), 1);
    this.logger.info(`[Device Gateway] Published OTA command "${action}" to device: ${deviceId}, task: ${taskId}`);
  }

  /**
   * 处理日志打捞命令下发
   */
  private async handleSendCollectLogsCommand(command: SendCollectLogsCommand): Promise<void> {
    const { deviceId, taskId, logType, uploadUrl, fileKey, expiresAt, description } = command;

    const message = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      action: 'collect_logs',
      taskId,
      uploadUrl,
      fileKey,
      logType,
      expiresAt,
      description,
      timestamp: Date.now(),
    };

    const topic = `devices/${deviceId}/command`;
    await this.publish(topic, JsonUtil.stringify(message), 1);
    this.logger.info(`[Device Gateway] Published collect_logs command to device: ${deviceId}, task: ${taskId}`);
  }

  // ==================== 设备消息下发方法 ====================

  /**
   * 发布凭证响应到设备
   * 主题格式: devices/{deviceId}/credentials/response
   *
   * @param deviceId 设备ID
   * @param response 凭证响应
   */
  async publishCredentialsResponse(deviceId: string, response: DeviceCredentialsResponse): Promise<void> {
    const topic = `devices/${deviceId}/credentials/response`;
    await this.publish(topic, JsonUtil.stringify(response), 1);
    this.logger.info(`[Device Gateway] Published credentials response to device: ${deviceId}`);
  }

  /**
   * 发布设备命令到设备
   * 主题格式: devices/{deviceId}/command
   *
   * @param deviceId 设备ID
   * @param request 命令请求
   */
  async publishDeviceCommand(deviceId: string, request: DeviceCommandRequest): Promise<void> {
    const topic = `devices/${deviceId}/command`;
    await this.publish(topic, JsonUtil.stringify(request), 1);
    this.logger.info(`[Device Gateway] Published command "${request.command}" to device: ${deviceId}`);
  }

  /**
   * 发布配置响应到设备
   * 主题格式: devices/{deviceId}/config/response
   *
   * @param deviceId 设备ID
   * @param response 配置响应
   */
  async publishConfigResponse(deviceId: string, response: DeviceConfigResponse): Promise<void> {
    const topic = `devices/${deviceId}/config/response`;
    await this.publish(topic, JsonUtil.stringify(response), 1);
    this.logger.info(`[Device Gateway] Published config response to device: ${deviceId}`);
  }

  /**
   * 发布注册响应到设备
   * 主题格式: devices/{deviceId}/register/response
   *
   * @param deviceId 设备ID
   * @param response 注册响应
   */
  async publishRegisterResponse(deviceId: string, response: { code: number; timestamp: number }): Promise<void> {
    const topic = `devices/${deviceId}/register/response`;
    await this.publish(topic, JsonUtil.stringify(response), 1);
    this.logger.info(`[Device Gateway] Published register response to device: ${deviceId}, code: ${response.code}`);
  }

  /**
   * 优雅关闭网关
   */
  async shutdown(): Promise<void> {
    this.logger.info('[Device Gateway] Shutting down gateway...');

    // 取消订阅服务命令频道并关闭订阅客户端
    if (this.redisSubscriber) {
      try {
        await this.redisSubscriber.unsubscribe(SERVICE_COMMAND_CHANNEL);
        await this.redisSubscriber.quit();
        this.logger.info('[Device Gateway] Redis subscriber client closed');
      } catch (error) {
        this.logger.warn('[Device Gateway] Failed to close redis subscriber:', error);
      }
    }

    // 关闭独立的 Redis 发布客户端
    if (this.redisPublisher) {
      try {
        await this.redisPublisher.quit();
        this.logger.info('[Device Gateway] Redis publisher client closed');
      } catch (error) {
        this.logger.warn('[Device Gateway] Failed to close redis publisher:', error);
      }
    }

    await this.connectionManager.stopCleanupTask();
    await this.mqttClientService.disconnect();

    this.logger.info('[Device Gateway] Gateway shutdown complete');
  }
}
