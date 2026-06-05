import { Provide, Scope, ScopeEnum, Inject, Init } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { JsonUtil, BaseSubscriber, SubscriptionConfig, DEVICE_TELEMETRY_CHANNEL, DEVICE_EVENT_CHANNEL, DEVICE_SERVICE_CHANNEL } from '@baby-monitor/shared-utils';
import { AWSCredentialsManager } from '@baby-monitor/aws-credentials';
import { DeviceState } from '../entity/device-state.entity';
import { DeviceAlert } from '../entity/device-alert.entity';
import { DeviceEvent } from '../entity/device-event.entity';
import { Device, DeviceStatus, DeviceProtocol, ProductType } from '../entity/device.entity';
import { PrivateProtocolMessage, PrivateProtocolAction, DeviceEventType, DeviceAlertLevel, CloudProvider } from '@baby-monitor/shared-types';
import { OTAService } from '../service/ota.service';
import { DeviceLogService } from '../service/device-log.service';
import { KVS_CREDENTIALS_KEY, S3_CREDENTIALS_KEY } from '../config/credentials.config';
import Redis from 'ioredis';

/**
 * 服务命令频道名称（用于向 device-gateway 发送命令）
 */
const SERVICE_COMMAND_CHANNEL = 'service:device-gateway';

/**
 * 服务命令类型
 */
const ServiceCommandType = {
  SEND_CREDENTIALS_RESPONSE: 'gateway.send_credentials_response',
  SEND_DEVICE_COMMAND: 'gateway.send_command',
  SEND_CONFIG_RESPONSE: 'gateway.send_config_response',
  SEND_REGISTER_RESPONSE: 'gateway.send_register_response',
} as const;

/**
 * 设备消息存储订阅器
 *
 * 监听 MQTT Gateway 转发的设备消息并存储到数据库
 *
 * 订阅频道：
 * - device:telemetry:* - 设备遥测数据（按设备ID）
 * - device:event:*      - 设备事件上报
 * - service:device-service - 设备服务消息
 *
 * 主要功能：
 * - 接收并处理设备遥测数据
 * - 存储设备状态到数据库
 * - 创建和管理设备告警
 * - 记录设备事件
 * - 处理设备上线/离线事件
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class DeviceMessageSubscriber extends BaseSubscriber {
  // 设备数据仓储
  @InjectEntityModel(Device)
  deviceRepository!: Repository<Device>;

  // 设备状态数据仓储
  @InjectEntityModel(DeviceState)
  deviceStateRepository!: Repository<DeviceState>;

  // 设备告警数据仓储
  @InjectEntityModel(DeviceAlert)
  deviceAlertRepository!: Repository<DeviceAlert>;

  // 设备事件数据仓储
  @InjectEntityModel(DeviceEvent)
  deviceEventRepository!: Repository<DeviceEvent>;

  // AWS 凭证管理器
  @Inject()
  awsCredentialsManager!: AWSCredentialsManager;

  // OTA升级服务
  @Inject()
  otaService!: OTAService;

  // 设备日志服务
  @Inject()
  deviceLogService!: DeviceLogService;

  /**
   * 获取订阅配置
   */
  getSubscriptionConfig(): SubscriptionConfig {
    return {
      channels: [DEVICE_SERVICE_CHANNEL],
      patterns: ['device:telemetry:*', 'device:event:*'],
    };
  }

  /**
   * 处理接收到的消息
   */
  async handleMessage(channel: string, message: string): Promise<void> {
    try {
      // 处理设备服务频道消息
      if (channel === DEVICE_SERVICE_CHANNEL) {
        await this.handleServiceMessage(message);
        return;
      }

      // 处理设备遥测数据
      if (channel.startsWith('device:telemetry:')) {
        await this.handleTelemetryMessage(channel, message);
        return;
      }

      // 处理设备事件
      if (channel.startsWith('device:event:')) {
        await this.handleEventMessage(channel, message);
        return;
      }
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Error handling message from ${channel}:`, error);
    }
  }

  /**
   * 处理设备遥测消息
   * 来自 device:telemetry:{deviceId} 频道
   */
  private async handleTelemetryMessage(channel: string, message: string): Promise<void> {
    try {
      const deviceId = channel.replace('device:telemetry:', '');
      const data = JsonUtil.parse(message);

      if (!data || !data.deviceId) {
        this.logger.error('[DeviceMessageSubscriber] Invalid telemetry message format');
        return;
      }

      this.logger.debug(`[DeviceMessageSubscriber] Received telemetry from ${deviceId}`);

      // 查找设备
      const device = await this.deviceRepository.findOne({
        where: { serialNumber: deviceId },
      });

      if (!device) {
        this.logger.warn(`[DeviceMessageSubscriber] Device not found: ${deviceId}`);
        return;
      }

      // 处理遥测数据类型
      if (data.type === 'status') {
        // 存储设备状态
        await this.saveDeviceState(device.id, data.data);
      }
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Error handling telemetry message:`, error);
    }
  }

  /**
   * 处理设备事件消息
   * 来自 device:event:{deviceId} 频道
   */
  private async handleEventMessage(channel: string, message: string): Promise<void> {
    try {
      const deviceId = channel.replace('device:event:', '');
      const data = JsonUtil.parse(message);

      if (!data || !data.deviceId) {
        this.logger.error('[DeviceMessageSubscriber] Invalid event message format');
        return;
      }

      this.logger.debug(`[DeviceMessageSubscriber] Received event from ${deviceId}, type: ${data.eventType}`);

      // 查找设备
      const device = await this.deviceRepository.findOne({
        where: { serialNumber: deviceId },
      });

      if (!device) {
        this.logger.warn(`[DeviceMessageSubscriber] Device not found: ${deviceId}`);
        return;
      }

      // 存储设备事件
      await this.saveDeviceEventFromMessage(device.id, data.eventType, {
        details: data.details,
        imageUrl: data.imageUrl,
        videoUrl: data.videoUrl,
        timestamp: data.timestamp,
      });
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Error handling event message:`, error);
    }
  }

  /**
   * 处理服务消息（来自 MQTT Gateway）
   */
  private async handleServiceMessage(messageStr: string): Promise<void> {
    try {
      const message = JsonUtil.parse(messageStr);
      if (!message || !message.type || !message.data) {
        return;
      }

      const { type, data } = message;
      this.logger.debug(`[DeviceMessageSubscriber] Received service message: ${type}`);

      switch (type) {
        case 'device.register':
          // 处理设备注册
          await this.handleDeviceRegister(data);
          break;

        case 'device.auth':
          // 处理设备认证
          await this.handleDeviceAuth(data);
          break;

        case 'device.report':
          // 处理设备上报数据
          await this.handleDeviceReport(data);
          break;

        case 'device.status':
          // 处理设备状态数据
          await this.handleDeviceStatus(data);
          break;

        case 'device.event':
          // 处理设备事件上报
          await this.handleDeviceEventMessage(data);
          break;

        case 'device.online':
          // 设备上线事件
          await this.handleDeviceOnline(data);
          break;

        case 'device.offline':
          // 设备离线事件
          await this.handleDeviceOffline(data);
          break;

        case 'device.command_response':
          // 处理设备命令响应
          await this.handleDeviceCommandResponse(data);
          break;

        case 'device.config_request':
          // 处理设备配置请求
          await this.handleDeviceConfigRequest(data);
          break;

        case 'device.config_response':
          // 处理设备配置响应
          await this.handleDeviceConfigResponse(data);
          break;

        case 'device.credentials_request':
          // 处理设备凭证请求
          await this.handleDeviceCredentialsRequest(data);
          break;

        case 'device.credentials_response':
          // 处理设备凭证响应
          await this.handleDeviceCredentialsResponse(data);
          break;

        case 'device.ota_progress':
          // 处理设备OTA进度上报
          await this.handleOTAProgress(data);
          break;

        case 'device.ota_result':
          // 处理设备OTA结果上报
          await this.handleOTAResult(data);
          break;

        case 'log.collect_status':
          // 处理设备日志打捞状态上报
          await this.handleLogCollectStatus(data);
          break;

        case 'matter.attribute':
          // 处理Matter属性上报
          await this.handleMatterAttribute(data);
          break;

        case 'matter.command':
          // 处理Matter命令
          await this.handleMatterCommand(data);
          break;

        default:
          this.logger.debug(`[DeviceMessageSubscriber] Unknown service message type: ${type}`);
      }
    } catch (error) {
      this.logger.error('[DeviceMessageSubscriber] Error handling service message:', error);
    }
  }

  /**
   * 处理设备注册
   */
  private async handleDeviceRegister(data: any): Promise<void> {
    const { deviceId, serialNumber, productType, deviceType, firmwareVersion, macAddress, protocol, cloudProvider, requestId, _meta } = data;

    // 获取设备标识（优先使用 deviceId，其次 serialNumber）
    const deviceIdentifier = deviceId || serialNumber;
    if (!deviceIdentifier) {
      this.logger.warn('[DeviceMessageSubscriber] Device register message missing deviceId/serialNumber');
      return;
    }

    this.logger.info(`[DeviceMessageSubscriber] Processing device register: ${deviceIdentifier}`);

    let registerCode = 0; // 默认成功
    let registerError = '';

    try {
      // 检查设备是否已存在
      let device = await this.deviceRepository.findOne({
        where: { serialNumber: deviceIdentifier },
      });

      if (device) {
        // 设备已存在，更新信息
        const previousFirmwareVersion = device.firmwareVersion;
        device.firmwareVersion = firmwareVersion || device.firmwareVersion;
        device.macAddress = macAddress || device.macAddress;
        device.deviceType = deviceType || device.deviceType;
        device.cloudProvider = cloudProvider ?? device.cloudProvider;
        if (protocol) {
          device.protocol = protocol as DeviceProtocol;
        }
        device.status = DeviceStatus.ONLINE;
        device.lastOnline = new Date();

        await this.deviceRepository.save(device);
        this.logger.info(`[DeviceMessageSubscriber] Device updated: ${deviceIdentifier} -> ${device.id}`);

        // 固件版本变化时同步OTA任务状态（设备升级重启后重注册）
        if (firmwareVersion && firmwareVersion !== previousFirmwareVersion) {
          try {
            await this.otaService.syncOTATasksOnReRegistration(deviceIdentifier, firmwareVersion);
          } catch (error) {
            this.logger.error(`[DeviceMessageSubscriber] Error syncing OTA tasks for ${deviceIdentifier}:`, error);
          }
        }
      } else {
        // 创建新设备
        const mappedProductType = this.mapProductType(productType);

        device = this.deviceRepository.create({
          serialNumber: deviceIdentifier,
          productId: `PROD-${productType || 'unknown'}`,
          productType: mappedProductType,
          deviceType: deviceType,
          name: `Device ${deviceIdentifier.substring(0, 8)}`,
          firmwareVersion: firmwareVersion || '1.0.0',
          macAddress: macAddress,
          cloudProvider: cloudProvider ?? 3, // 默认 RJI
          protocol: (protocol as DeviceProtocol) || DeviceProtocol.PRIVATE,
          status: DeviceStatus.ONLINE,
          ownerId: '00000000-0000-0000-0000-000000000000', // 默认系统用户
          lastOnline: new Date(),
        });

        const saved = await this.deviceRepository.save(device);
        this.logger.info(`[DeviceMessageSubscriber] Device created: ${deviceIdentifier} -> ${saved.id}`);

        // 创建云资源（KVS Stream 或 IoT Video 设备）
        const normalizedCloudProvider = Number(cloudProvider) || 3;
        if (normalizedCloudProvider === CloudProvider.AWS || normalizedCloudProvider === CloudProvider.TENCENT) {
          const tripleInfo = await this.ensureCloudResources(deviceIdentifier, normalizedCloudProvider);
          if (tripleInfo) {
            saved.iotProductId = tripleInfo.productId;
            saved.iotDeviceName = tripleInfo.deviceName;
            saved.iotDeviceSecret = tripleInfo.deviceSecret;
            await this.deviceRepository.save(saved);
            this.logger.info(`[DeviceMessageSubscriber] Cloud resource created for device: ${deviceIdentifier}`);
          }
        }

        // 记录设备注册事件
        await this.saveDeviceEvent(saved.id, DeviceEventType.ONLINE, {
          reason: 'device_registered',
          timestamp: _meta?.timestamp || Date.now(),
        });
      }
    } catch (error) {
      registerCode = -1;
      registerError = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[DeviceMessageSubscriber] Device registration failed: ${deviceIdentifier}`, error);
    }

    // 发送注册响应到 device-gateway
    await this.publishRegisterResponse(deviceIdentifier, registerCode);
  }

  /**
   * 发布注册响应到 device-gateway
   *
   * @param deviceId 设备ID
   * @param code 响应码 (0: 成功, -1: 失败)
   */
  private async publishRegisterResponse(
    deviceId: string,
    code: number
  ): Promise<void> {
    const command = {
      type: ServiceCommandType.SEND_REGISTER_RESPONSE,
      deviceId,
      timestamp: Date.now(),
      code,
    };

    await this.publish(SERVICE_COMMAND_CHANNEL, command);
    this.logger.debug(`[DeviceMessageSubscriber] Published register response command for device: ${deviceId}, code: ${code}`);
  }

  /**
   * 确保设备的云资源已创建
   * 通过 Redis Pub/Sub 与 video-service 通信
   */
  private async ensureCloudResources(
    deviceId: string,
    cloudProvider: CloudProvider
  ): Promise<{ productId: string; deviceName: string; deviceSecret: string } | null> {
    try {
      const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const requestChannel = 'stream:create:request';
      const responseChannel = `stream:create:response:${correlationId}`;

      this.logger.info(
        `[DeviceMessageSubscriber] Creating cloud resources for device: ${deviceId}, cloudProvider: ${cloudProvider}, correlationId: ${correlationId}`
      );

      const response = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Request timeout'));
        }, 30000);

        const redisOptions: any = {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        };
        if (process.env.REDIS_PASSWORD) {
          redisOptions.password = process.env.REDIS_PASSWORD;
        }
        const tempSubscriber = new Redis(redisOptions);

        tempSubscriber.subscribe(responseChannel, (err: any) => {
          if (err) {
            clearTimeout(timer);
            tempSubscriber.disconnect();
            reject(new Error(`Subscribe error: ${err.message}`));
            return;
          }

          this.pool.getPublisher().publish(requestChannel, JSON.stringify({
            correlationId,
            deviceId,
            cloudProvider,
            timestamp: Date.now(),
          }));
        });

        tempSubscriber.on('message', (channel: string, msg: string) => {
          if (channel === responseChannel) {
            clearTimeout(timer);
            tempSubscriber.disconnect();
            try {
              const resp = JSON.parse(msg);
              if (resp.correlationId === correlationId) {
                resolve(resp);
              }
            } catch (error) {
              reject(error);
            }
          }
        });
      });

      if (response?.success && cloudProvider === CloudProvider.TENCENT && response.tripleInfo) {
        this.logger.info(
          `[DeviceMessageSubscriber] IoT Video device created: ${response.tripleInfo.deviceName} for device: ${deviceId}`
        );
        return {
          productId: response.tripleInfo.productId,
          deviceName: response.tripleInfo.deviceName,
          deviceSecret: response.tripleInfo.deviceSecret || response.tripleInfo.devicePsk,
        };
      }

      this.logger.info(
        `[DeviceMessageSubscriber] Cloud resource result for device ${deviceId}: success=${response?.success}`
      );
    } catch (error: any) {
      this.logger.error(
        `[DeviceMessageSubscriber] Error creating cloud resources for device ${deviceId}:`,
        error.message
      );
    }

    return null;
  }

  /**
   * 处理设备认证
   */
  private async handleDeviceAuth(data: any): Promise<void> {
    const { deviceId, token, signature, _meta } = data;

    this.logger.info(`[DeviceMessageSubscriber] Processing device auth: ${deviceId}`);

    // 查找设备
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId },
    });

    if (!device) {
      this.logger.warn(`[DeviceMessageSubscriber] Device not found for auth: ${deviceId}`);
      return;
    }

    // 记录认证事件
    await this.saveDeviceEvent(device.id, DeviceEventType.STATUS_CHANGE, {
      action: 'device_auth',
      success: true,
      timestamp: _meta?.timestamp || Date.now(),
    });
  }

  /**
   * 处理设备事件消息
   */
  private async handleDeviceEventMessage(data: any): Promise<void> {
    const { deviceId, eventType, details, imageUrl, videoUrl, _meta } = data;

    this.logger.debug(`[DeviceMessageSubscriber] Processing device event: ${deviceId}, type: ${eventType}`);

    // 查找设备
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId },
    });

    if (!device) {
      this.logger.warn(`[DeviceMessageSubscriber] Device not found: ${deviceId}`);
      return;
    }

    // 存储设备事件
    await this.saveDeviceEventFromMessage(device.id, eventType, {
      details,
      imageUrl,
      videoUrl,
      timestamp: _meta?.timestamp || Date.now(),
    });
  }

  /**
   * 处理设备命令响应
   */
  private async handleDeviceCommandResponse(data: any): Promise<void> {
    const { deviceId, commandId, command, result, error, _meta } = data;

    this.logger.debug(`[DeviceMessageSubscriber] Processing command response: ${deviceId}, commandId: ${commandId}`);

    // 查找设备
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId },
    });

    if (!device) {
      this.logger.warn(`[DeviceMessageSubscriber] Device not found: ${deviceId}`);
      return;
    }

    // 记录命令响应事件
    await this.saveDeviceEvent(device.id, DeviceEventType.STATUS_CHANGE, {
      action: 'command_response',
      commandId,
      command,
      result,
      error,
      timestamp: _meta?.timestamp || Date.now(),
    });
  }

  /**
   * 处理设备配置请求
   */
  private async handleDeviceConfigRequest(data: any): Promise<void> {
    const { deviceId, requestId, configKeys, _meta } = data;

    this.logger.debug(`[DeviceMessageSubscriber] Processing config request: ${deviceId}, requestId: ${requestId}`);

    // 查找设备
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId },
    });

    if (!device) {
      this.logger.warn(`[DeviceMessageSubscriber] Device not found: ${deviceId}`);
      return;
    }

    // 记录配置请求事件
    await this.saveDeviceEvent(device.id, DeviceEventType.STATUS_CHANGE, {
      action: 'config_request',
      requestId,
      configKeys,
      timestamp: _meta?.timestamp || Date.now(),
    });
  }

  /**
   * 处理设备配置响应
   */
  private async handleDeviceConfigResponse(data: any): Promise<void> {
    const { deviceId, requestId, config, _meta } = data;

    this.logger.debug(`[DeviceMessageSubscriber] Processing config response: ${deviceId}, requestId: ${requestId}`);

    // 查找设备
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId },
    });

    if (!device) {
      this.logger.warn(`[DeviceMessageSubscriber] Device not found: ${deviceId}`);
      return;
    }

    // 记录配置响应事件
    await this.saveDeviceEvent(device.id, DeviceEventType.STATUS_CHANGE, {
      action: 'config_response',
      requestId,
      config,
      timestamp: _meta?.timestamp || Date.now(),
    });
  }

  /**
   * 处理设备凭证请求
   * 获取凭证并通过 device-gateway 下发给设备
   */
  private async handleDeviceCredentialsRequest(data: any): Promise<void> {
    const { deviceId, requestId, credentialTypes, _meta } = data;

    this.logger.info(`[DeviceMessageSubscriber] Processing credentials request: ${deviceId}, requestId: ${requestId}, types: ${credentialTypes?.join(',')}`);

    // 查找设备
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId },
    });

    if (!device) {
      this.logger.warn(`[DeviceMessageSubscriber] Device not found: ${deviceId}`);
      return;
    }

    // 记录凭证请求事件
    await this.saveDeviceEvent(device.id, DeviceEventType.STATUS_CHANGE, {
      action: 'credentials_request',
      requestId,
      credentialTypes,
      timestamp: _meta?.timestamp || Date.now(),
    });

    try {
      // 获取凭证
      const credentials = await this.getCredentials(device, credentialTypes || []);

      // 下发凭证响应到 device-gateway
      await this.publishCredentialsResponse(deviceId, requestId, credentials);

      this.logger.info(`[DeviceMessageSubscriber] Credentials response sent to device: ${deviceId}`);
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Failed to get/send credentials for ${deviceId}:`, error);

      // 记录错误事件
      await this.saveDeviceEvent(device.id, DeviceEventType.ERROR, {
        action: 'credentials_request_failed',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 获取设备凭证
   * 根据请求的凭证类型获取相应的凭证
   *
   * @param device 设备实体
   * @param credentialTypes 凭证类型列表
   */
  private async getCredentials(
    device: Device,
    credentialTypes: string[]
  ): Promise<Record<string, any>> {
    const credentials: Record<string, any> = {};

    for (const type of credentialTypes) {
      switch (type) {
        case 'kvs':
          // 获取 AWS KVS 临时凭证
          credentials.kvs = await this.getKVSCredentials(device);
          break;

        case 's3':
          // 获取 AWS S3 临时凭证
          credentials.s3 = await this.getS3Credentials(device);
          break;

        case 'mqtt':
          // 获取 MQTT 连接凭证
          credentials.mqtt = await this.getMQTTCredentials(device);
          break;

        case 'cloud':
          // 获取云服务凭证
          credentials.cloud = await this.getCloudCredentials(device);
          break;

        case 'iot_video':
          // 获取 IoT Video 三元组信息
          credentials.iot_video = this.getIoTVideoCredentials(device);
          break;

        default:
          this.logger.warn(`[DeviceMessageSubscriber] Unknown credential type: ${type}`);
      }
    }

    return credentials;
  }

  /**
   * 获取 AWS KVS 临时凭证
   * 使用 AWSCredentialsManager 获取真实的 AWS STS 临时凭证
   */
  private async getKVSCredentials(device: Device): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: number;
  }> {
    this.logger.debug(`[DeviceMessageSubscriber] Getting KVS credentials for device: ${device.serialNumber}`);

    try {
      // 使用 AWS 凭证管理器获取临时凭证
      const credentials = await this.awsCredentialsManager.getCredentials(KVS_CREDENTIALS_KEY);

      return {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        expiration: credentials.expiration.getTime(),
      };
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Failed to get KVS credentials:`, error);
      this.logger.error(`[DeviceMessageSubscriber] KVS credentials error details:`, {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : undefined,
        code: (error as any).code,
      });

      // 降级方案：使用环境变量中的长期凭证（仅用于开发/测试）
      const expiration = Date.now() + 3600 * 1000;
      this.logger.warn(`[DeviceMessageSubscriber] Falling back to long-term credentials for KVS`);
      return {
        accessKeyId: '',
        secretAccessKey: '',
        sessionToken: '',
        expiration,
      };
    }
  }

  /**
   * 获取 AWS S3 临时凭证
   * 使用 AWSCredentialsManager 获取真实的 AWS STS 临时凭证
   *
   * @param device 设备实体
   * @returns S3 临时凭证，包含访问密钥、密钥、会话令牌、过期时间和区域
   */
  private async getS3Credentials(device: Device): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: number;
    bucket?: string;
    folder?: string;
  }> {
    this.logger.debug(`[DeviceMessageSubscriber] Getting S3 credentials for device: ${device.serialNumber}`);

    try {
      // 使用 AWS 凭证管理器获取临时凭证
      const credentials = await this.awsCredentialsManager.getCredentials(S3_CREDENTIALS_KEY);

      return {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        expiration: credentials.expiration.getTime(),
        bucket: process.env.AWS_S3_RECORD_BUCKET,
        folder: process.env.AWS_S3_RECORD_FOLDER,
      };
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Failed to get S3 credentials:`, error);
      this.logger.error(`[DeviceMessageSubscriber] S3 credentials error details:`, {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : undefined,
        code: (error as any).code,
      });

      // 降级方案：使用环境变量中的长期凭证（仅用于开发/测试）
      const expiration = Date.now() + 3600 * 1000;
      this.logger.warn(`[DeviceMessageSubscriber] Falling back to long-term credentials for S3`);
      return {
        accessKeyId: '',
        secretAccessKey: '',
        sessionToken: '',
        expiration,
        bucket: process.env.AWS_S3_RECORD_BUCKET,
        folder: process.env.AWS_S3_RECORD_FOLDER,
      };
    }
  }

  /**
   * 获取 MQTT 连接凭证
   */
  private async getMQTTCredentials(device: Device): Promise<{
    broker: string;
    port: number;
    clientId: string;
  }> {
    this.logger.debug(`[DeviceMessageSubscriber] Getting MQTT credentials for device: ${device.serialNumber}`);

    return {
      broker: process.env.MQTT_BROKER_HOST || 'localhost',
      port: parseInt(process.env.MQTT_BROKER_PORT || '1883'),
      clientId: `device-${device.serialNumber}`,
    };
  }

  /**
   * 获取云服务凭证
   */
  private async getCloudCredentials(device: Device): Promise<{
    endpoint: string;
    tokenExpiry: number;
  }> {
    this.logger.debug(`[DeviceMessageSubscriber] Getting cloud credentials for device: ${device.serialNumber}`);

    return {
      endpoint: process.env.CLOUD_API_ENDPOINT || 'https://api.babymonitor.local',
      tokenExpiry: Date.now() + 24 * 3600 * 1000, // 24小时后过期
    };
  }

  /**
   * 获取 IoT Video 三元组信息
   * 返回设备在腾讯云 IoT Video 平台的身份标识
   *
   * @param device 设备实体
   * @returns IoT Video 三元组信息，如果设备未注册则返回 null
   */
  private getIoTVideoCredentials(device: Device): {
    productId: string;
    deviceName: string;
    deviceSecret: string;
  } | null {
    this.logger.debug(`[DeviceMessageSubscriber] Getting IoT Video credentials for device: ${device.serialNumber}`);

    // 检查设备是否有 IoT Video 三元组信息
    if (!device.iotProductId || !device.iotDeviceName || !device.iotDeviceSecret) {
      this.logger.warn(
        `[DeviceMessageSubscriber] Device ${device.serialNumber} has no IoT Video triple info registered`
      );
      return null;
    }

    return {
      productId: device.iotProductId,
      deviceName: device.iotDeviceName,
      deviceSecret: device.iotDeviceSecret,
    };
  }

  /**
   * 发布凭证响应到 device-gateway
   *
   * @param deviceId 设备ID
   * @param requestId 请求ID
   * @param credentials 凭证信息
   */
  private async publishCredentialsResponse(
    deviceId: string,
    requestId: string,
    credentials: Record<string, any>
  ): Promise<void> {
    const command = {
      type: ServiceCommandType.SEND_CREDENTIALS_RESPONSE,
      deviceId,
      timestamp: Date.now(),
      requestId,
      credentials,
    };

    await this.publish(SERVICE_COMMAND_CHANNEL, command);
    this.logger.debug(`[DeviceMessageSubscriber] Published credentials response command for device: ${deviceId}`);
  }

  /**
   * 处理设备凭证响应
   */
  private async handleDeviceCredentialsResponse(data: any): Promise<void> {
    const { deviceId, requestId, credentials, _meta } = data;

    this.logger.debug(`[DeviceMessageSubscriber] Processing credentials response: ${deviceId}, requestId: ${requestId}`);

    // 查找设备
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId },
    });

    if (!device) {
      this.logger.warn(`[DeviceMessageSubscriber] Device not found: ${deviceId}`);
      return;
    }

    // 记录凭证响应事件
    await this.saveDeviceEvent(device.id, DeviceEventType.STATUS_CHANGE, {
      action: 'credentials_response',
      requestId,
      credentialTypes: Object.keys(credentials || {}),
      timestamp: _meta?.timestamp || Date.now(),
    });
  }

  /**
   * 处理Matter属性上报
   */
  private async handleMatterAttribute(data: any): Promise<void> {
    const { nodeId, endpoint, cluster, attribute, value, timestamp } = data;

    this.logger.debug(`[DeviceMessageSubscriber] Processing Matter attribute: node ${nodeId}, endpoint ${endpoint}, cluster ${cluster}`);

    // Matter 节点ID 对应设备序列号
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: String(nodeId) },
    });

    if (!device) {
      this.logger.warn(`[DeviceMessageSubscriber] Matter device not found: ${nodeId}`);
      return;
    }

    // 存储Matter属性状态
    await this.saveDeviceState(device.id, {
      matter: {
        endpoint,
        cluster,
        attribute,
        value,
      },
      timestamp: timestamp || Date.now(),
    });
  }

  /**
   * 处理Matter命令
   */
  private async handleMatterCommand(data: any): Promise<void> {
    const { nodeId, endpoint, cluster, command, args, timestamp } = data;

    this.logger.debug(`[DeviceMessageSubscriber] Processing Matter command: node ${nodeId}, endpoint ${endpoint}, cluster ${cluster}`);

    // Matter 节点ID 对应设备序列号
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: String(nodeId) },
    });

    if (!device) {
      this.logger.warn(`[DeviceMessageSubscriber] Matter device not found: ${nodeId}`);
      return;
    }

    // 记录Matter命令事件
    await this.saveDeviceEvent(device.id, DeviceEventType.STATUS_CHANGE, {
      action: 'matter_command',
      endpoint,
      cluster,
      command,
      args,
      timestamp: timestamp || Date.now(),
    });
  }

  /**
   * 映射产品类型字符串到枚举
   */
  private mapProductType(productType: string | undefined): ProductType {
    if (!productType) return ProductType.SENSOR;

    const typeMap: Record<string, ProductType> = {
      'camera': ProductType.CAMERA,
      'CAMERA': ProductType.CAMERA,
      'screen': ProductType.SCREEN,
      'SCREEN': ProductType.SCREEN,
      'monitor': ProductType.SCREEN,
      'MONITOR': ProductType.SCREEN,
      'sensor': ProductType.SENSOR,
      'SENSOR': ProductType.SENSOR,
      'gateway': ProductType.GATEWAY,
      'GATEWAY': ProductType.GATEWAY,
    };

    return typeMap[productType] || ProductType.SENSOR;
  }

  /**
   * 处理设备上报
   */
  private async handleDeviceReport(data: any): Promise<void> {
    const { deviceId, report } = data;

    // 查找设备
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId },
    });

    if (!device) {
      this.logger.warn(`[DeviceMessageSubscriber] Device not found: ${deviceId}`);
      return;
    }

    // 处理上报数据
    if (report && report.data) {
      const reportData = report.data;

      // 如果是告警类型数据
      if (reportData.alarm) {
        await this.saveDeviceAlert(device.id, {
          type: reportData.alarm.type || 'alarm',
          level: this.mapAlarmLevel(reportData.alarm.level || 'info'),
          title: reportData.alarm.message || 'Device Alert',
          message: reportData.alarm.message || 'An alarm occurred',
          data: reportData,
        });
      }

      // 如果是事件类型数据
      if (reportData.event) {
        await this.saveDeviceEventFromMessage(device.id, reportData.event, reportData);
      }

      // 存储设备状态
      if (reportData.metrics) {
        await this.saveDeviceState(device.id, {
          battery: reportData.metrics.battery,
          network: reportData.metrics.network,
          temperature: reportData.metrics.temperature,
          humidity: reportData.metrics.humidity,
          ...reportData.metrics,
        });
      }
    }
  }

  /**
   * 处理设备状态数据
   */
  private async handleDeviceStatus(data: any): Promise<void> {
    const { deviceId, status } = data;

    // 查找设备
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId },
    });

    if (!device) {
      this.logger.warn(`[DeviceMessageSubscriber] Device not found: ${deviceId}`);
      return;
    }

    // 存储设备状态
    await this.saveDeviceState(device.id, {
      battery: status.battery,
      network: status.network,
      temperature: status.temperature,
      humidity: status.humidity,
      timestamp: status.timestamp,
      ...status,
    });
  }

  /**
   * 处理设备上线事件
   */
  private async handleDeviceOnline(data: any): Promise<void> {
    const { deviceId, reason } = data;

    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId },
    });

    if (device) {
      // 记录上线事件
      await this.saveDeviceEvent(device.id, DeviceEventType.ONLINE, {
        reason: reason || 'connection_established',
        timestamp: data.timestamp,
      });
    }
  }

  /**
   * 处理设备离线事件
   */
  private async handleDeviceOffline(data: any): Promise<void> {
    const { deviceId, reason } = data;

    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId },
    });

    if (device) {
      // 记录离线事件
      await this.saveDeviceEvent(device.id, DeviceEventType.OFFLINE, {
        reason: reason || 'connection_lost',
        timestamp: data.timestamp,
      });

      // 创建离线告警
      await this.saveDeviceAlert(device.id, {
        type: 'device_offline',
        level: DeviceAlertLevel.WARNING,
        title: 'Device Offline',
        message: `Device ${device.name} went offline`,
        data: { reason, timestamp: data.timestamp },
      });
    }
  }

  /**
   * 保存设备状态
   */
  private async saveDeviceState(deviceId: string, state: Record<string, any>): Promise<void> {
    try {
      const deviceState = this.deviceStateRepository.create({
        deviceId,
        state,
        reportedAt: new Date(),
      });

      await this.deviceStateRepository.save(deviceState);
      this.logger.debug(`[DeviceMessageSubscriber] Saved device state for ${deviceId}`);
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Error saving device state for ${deviceId}:`, error);
    }
  }

  /**
   * 保存设备告警
   */
  private async saveDeviceAlert(deviceId: string, alertData: any): Promise<void> {
    try {
      const alert = this.deviceAlertRepository.create({
        deviceId,
        type: alertData.type || 'unknown',
        level: alertData.level || DeviceAlertLevel.INFO,
        title: alertData.title || 'Device Alert',
        message: alertData.message || 'An alert occurred',
        data: alertData.data || alertData,
        acknowledged: false,
      });

      await this.deviceAlertRepository.save(alert);
      this.logger.debug(`[DeviceMessageSubscriber] Saved device alert for ${deviceId}: ${alert.type}`);
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Error saving device alert for ${deviceId}:`, error);
    }
  }

  /**
   * 保存设备事件
   */
  private async saveDeviceEvent(deviceId: string, eventType: DeviceEventType, eventData?: any): Promise<void> {
    try {
      const event = this.deviceEventRepository.create({
        deviceId,
        type: eventType,
        data: eventData || {},
        // 系统事件不设置 userId，数据库会使用 NULL 作为默认值
      });

      await this.deviceEventRepository.save(event);
      this.logger.debug(`[DeviceMessageSubscriber] Saved device event for ${deviceId}: ${eventType}`);
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Error saving device event for ${deviceId}:`, error);
    }
  }

  /**
   * 从消息保存设备事件
   */
  private async saveDeviceEventFromMessage(
    deviceId: string,
    eventType: string,
    eventData?: any
  ): Promise<void> {
    try {
      // 映射事件类型字符串到枚举
      const eventTypeMapping: Record<string, DeviceEventType> = {
        'crying_detected': DeviceEventType.STATUS_CHANGE,
        'motion_detected': DeviceEventType.STATUS_CHANGE,
        'person_detected': DeviceEventType.STATUS_CHANGE,
        'device_offline': DeviceEventType.OFFLINE,
        'device_online': DeviceEventType.ONLINE,
        'alarm': DeviceEventType.ERROR,
        'error': DeviceEventType.ERROR,
      };

      const mappedType = eventTypeMapping[eventType] || DeviceEventType.STATUS_CHANGE;

      await this.saveDeviceEvent(deviceId, mappedType, eventData);
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Error saving device event from message:`, error);
    }
  }

  /**
   * 映射告警级别
   */
  private mapAlarmLevel(level: string): DeviceAlertLevel {
    const levelMapping: Record<string, DeviceAlertLevel> = {
      'info': DeviceAlertLevel.INFO,
      'warning': DeviceAlertLevel.WARNING,
      'error': DeviceAlertLevel.ERROR,
      'critical': DeviceAlertLevel.CRITICAL,
    };

    return levelMapping[level.toLowerCase()] || DeviceAlertLevel.INFO;
  }

  /**
   * 处理OTA进度上报
   */
  private async handleOTAProgress(data: any): Promise<void> {
    const { deviceId, taskId, progress, status, _meta } = data;

    this.logger.info(`[DeviceMessageSubscriber] OTA progress: device=${deviceId}, task=${taskId}, progress=${progress}%, status=${status}`);

    try {
      await this.otaService.handleOTAPProgress(taskId, progress, status);
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Error handling OTA progress for task ${taskId}:`, error);
    }
  }

  /**
   * 处理OTA结果上报
   */
  private async handleOTAResult(data: any): Promise<void> {
    const { deviceId, taskId, success, error: otaError, version, _meta } = data;

    this.logger.info(`[DeviceMessageSubscriber] OTA result: device=${deviceId}, task=${taskId}, success=${success}`);

    try {
      await this.otaService.handleOTAResult(taskId, success, otaError);
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Error handling OTA result for task ${taskId}:`, error);
    }
  }

  /**
   * 处理设备日志打捞状态上报
   */
  private async handleLogCollectStatus(data: any): Promise<void> {
    const { deviceId, taskId, status, fileSize, error: logError } = data;

    this.logger.info(
      `[DeviceMessageSubscriber] Log collect status: device=${deviceId}, task=${taskId}, status=${status}`,
    );

    try {
      await this.deviceLogService.handleCollectStatus({
        deviceId,
        taskId,
        status,
        fileSize,
        error: logError,
      });
    } catch (error) {
      this.logger.error(`[DeviceMessageSubscriber] Error handling log collect status for task ${taskId}:`, error);
    }
  }
}
