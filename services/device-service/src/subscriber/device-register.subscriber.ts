import { Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { JsonUtil } from '@baby-monitor/shared-utils';
import { BaseSubscriber, SubscriptionConfig } from '@baby-monitor/shared-utils';
import { Device, ProductType, DeviceProtocol, DeviceStatus } from '../entity/device.entity';
import {
  DeviceRegisterRequestMessage,
  DeviceRegisterResponseMessage,
  MqttErrorCode,
  IoTVideoTripleInfo,
} from '../types/registration.types';
import { CloudProvider } from '@baby-monitor/shared-types';
import Redis from 'ioredis';

/**
 * Redis请求频道
 */
const REQUEST_CHANNEL = 'device:register:request';

/**
 * Redis响应频道前缀
 */
const RESPONSE_CHANNEL_PREFIX = 'device:register:response:';

/**
 * 幂等性缓存键前缀
 */
const IDEMPOTENT_KEY_PREFIX = 'device:register:idempotent:';

/**
 * 幂等性缓存TTL（5分钟）
 */
const IDEMPOTENT_TTL = 300;

/**
 * 设备注册订阅器
 *
 * 监听设备注册请求并处理设备注册流程
 *
 * 订阅频道：
 * - device:register:request - 设备注册请求
 *
 * 响应频道：
 * - device:register:response:{correlationId} - 设备注册响应
 *
 * 主要功能：
 * - 处理设备自动注册请求
 * - 幂等性保证（防止重复注册）
 * - 通过Redis响应频道返回注册结果
 * - 设备类型映射和产品ID生成
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class DeviceRegisterSubscriber extends BaseSubscriber {
  // 设备数据仓储
  @InjectEntityModel(Device)
  deviceRepository!: Repository<Device>;

  /**
   * 获取Redis客户端（用于普通Redis操作，如get/set等）
   */
  private get redisClient(): Redis {
    return this.pool.getPublisher();
  }

  /**
   * 获取订阅配置
   *
   * @returns 订阅配置对象
   */
  getSubscriptionConfig(): SubscriptionConfig {
    return {
      channels: [REQUEST_CHANNEL],
    };
  }

  /**
   * 处理接收到的消息
   *
   * @param channel - 频道名称
   * @param message - 消息内容
   */
  async handleMessage(channel: string, message: string): Promise<void> {
    if (channel !== REQUEST_CHANNEL) {
      return;
    }

    await this.handleRegisterRequest(message);
  }

  /**
   * 处理设备注册请求
   *
   * @param messageStr - 注册请求消息JSON字符串
   *
   * 功能说明：
   * - 验证请求参数的完整性
   * - 检查幂等性缓存，防止重复注册
   * - 检查设备是否已存在
   * - 创建新设备或返回已存在设备信息
   * - 将结果发布到响应频道
   */
  async handleRegisterRequest(messageStr: string): Promise<void> {
    try {
      const request = JsonUtil.parse<DeviceRegisterRequestMessage>(messageStr);
      if (!request || !request.correlationId || !request.deviceId) {
        this.logger.error('[DeviceRegisterSubscriber] Invalid request message');
        return;
      }

      // 类型归一化：JSON 反序列化后数字可能变为字符串，统一转为数字类型
      if (request.type != null) request.type = Number(request.type) as any;
      if (request.cloudProvider != null) request.cloudProvider = Number(request.cloudProvider) as any;

      this.logger.info(
        `[DeviceRegisterSubscriber] Processing registration: correlationId=${request.correlationId}, deviceId=${request.deviceId}, type=${request.type}, cloudProvider=${request.cloudProvider}`
      );

      // 参数验证
      if (!request.type || !request.cloudProvider) {
        const errorResponse: DeviceRegisterResponseMessage = {
          correlationId: request.correlationId,
          code: MqttErrorCode.E_PARAMS,
          message: 'Missing required fields: type or cloudProvider',
          timestamp: Date.now(),
        };
        await this.publishResponse(request.correlationId, errorResponse);
        return;
      }

      // 幂等性检查
      const cachedResponse = await this.checkIdempotentCache(request.deviceId);
      if (cachedResponse) {
        cachedResponse.cached = true;
        await this.publishResponse(request.correlationId, cachedResponse);
        this.logger.debug(
          `[DeviceRegisterSubscriber] Cache hit for device: ${request.deviceId}, correlationId=${request.correlationId}`
        );
        return;
      }

      // 检查设备是否已存在
      const existingDevice = await this.deviceRepository.findOne({
        where: { serialNumber: request.deviceId },
      });

      let response: DeviceRegisterResponseMessage;

      if (existingDevice) {
        // 设备已存在
        response = {
          correlationId: request.correlationId,
          code: MqttErrorCode.E_OBJECT_EXISTS,
          message: 'Device already registered',
          deviceId: existingDevice.id,
          serialNumber: existingDevice.serialNumber,
          // 如果设备有 IoT Video 三元组信息，也返回
          tripleInfo: existingDevice.iotProductId
            ? {
                productId: existingDevice.iotProductId,
                deviceName: existingDevice.iotDeviceName,
                deviceSecret: existingDevice.iotDeviceSecret,
              }
            : undefined,
          timestamp: Date.now(),
        };

        this.logger.debug(
          `[DeviceRegisterSubscriber] Device already exists: ${request.deviceId}, correlationId=${request.correlationId}`
        );
      } else {
        // 创建新设备
        const { device: newDevice, tripleInfo } = await this.createDeviceInDatabase(request);
        response = {
          correlationId: request.correlationId,
          code: MqttErrorCode.OK,
          deviceId: newDevice.id,
          serialNumber: newDevice.serialNumber,
          tripleInfo,
          timestamp: Date.now(),
        };

        console.log(
          `[DeviceRegisterSubscriber] Device created: ${request.deviceId} -> ${newDevice.id}, correlationId=${request.correlationId}`
        );
      }

      // 缓存结果（幂等性）
      await this.cacheIdempotentResult(request.deviceId, response);

      // 发布响应
      await this.publishResponse(request.correlationId, response);
    } catch (error) {
      this.logger.error('[DeviceRegisterSubscriber] Error handling request:', error);
    }
  }

  /**
   * 检查幂等性缓存
   *
   * @param deviceId - 设备ID
   * @returns 缓存的响应对象，如果不存在则返回null
   * @private
   *
   * 功能说明：
   * - 防止设备重复注册
   * - 缓存有效期为5分钟
   */
  private async checkIdempotentCache(
    deviceId: string
  ): Promise<DeviceRegisterResponseMessage | null> {
    try {
      const key = `${IDEMPOTENT_KEY_PREFIX}${deviceId}`;
      const cached = await this.redisClient.get(key);
      return cached ? JsonUtil.parse<DeviceRegisterResponseMessage>(cached) : null;
    } catch (error) {
      this.logger.error('[DeviceRegisterSubscriber] Error checking idempotent cache:', error);
      return null;
    }
  }

  /**
   * 缓存幂等性结果
   *
   * @param deviceId - 设备ID
   * @param response - 响应对象
   * @private
   */
  private async cacheIdempotentResult(
    deviceId: string,
    response: DeviceRegisterResponseMessage
  ): Promise<void> {
    try {
      const key = `${IDEMPOTENT_KEY_PREFIX}${deviceId}`;
      await this.redisClient.set(key, JsonUtil.stringify(response), 'EX', IDEMPOTENT_TTL);
    } catch (error) {
      this.logger.error('[DeviceRegisterSubscriber] Error caching result:', error);
    }
  }

  /**
   * 在数据库中创建设备
   *
   * @param request - 注册请求对象
   * @returns 创建的设备对象和 IoT Video 三元组信息（如果有）
   * @private
   *
   * 功能说明：
   * - 根据设备类型映射到产品类型
   * - 生成产品ID和默认设备名称
   * - 设置设备初始状态为在线
   * - 根据云服务商创建对应的云资源
   */
  private async createDeviceInDatabase(
    request: DeviceRegisterRequestMessage
  ): Promise<{ device: Device; tripleInfo?: IoTVideoTripleInfo }> {
    // 映射设备类型：1=摄像头, 2=屏幕, 其他=传感器
    const productType =
      request.type === 1
        ? ProductType.CAMERA
        : request.type === 2
        ? ProductType.SCREEN
        : ProductType.SENSOR;

    // 生成产品ID
    const productId = `PROD-${request.type}`;

    // 创建设备实体
    const device = this.deviceRepository.create({
      serialNumber: request.deviceId,
      productId: productId,
      productType: productType,
      deviceType: request.deviceType,
      name: `Device ${request.deviceId.substring(0, 8)}`,
      firmwareVersion: '1.0.0',
      protocol: DeviceProtocol.PRIVATE,
      status: DeviceStatus.ONLINE,
      cloudProvider: request.cloudProvider,
      ownerId: request.userId || '00000000-0000-0000-0000-000000000000', // 默认系统用户
      lastOnline: new Date(),
    });

    const saved = await this.deviceRepository.save(device);
    const savedDevice = Array.isArray(saved) ? saved[0] : saved;

    let tripleInfo: IoTVideoTripleInfo | undefined;

    // 根据云服务商创建对应的云资源
    if (request.cloudProvider === CloudProvider.AWS) {
      // AWS: 创建 KVS Stream
      await this.ensureCloudResources(request.deviceId, request.cloudProvider);
    } else if (request.cloudProvider === CloudProvider.TENCENT) {
      // 腾讯云 IoT Video: 创建设备并获取三元组
      const cloudTripleInfo = await this.ensureCloudResources(request.deviceId, request.cloudProvider);
      if (cloudTripleInfo) {
        // 保存三元组信息到数据库
        savedDevice.iotProductId = cloudTripleInfo.productId;
        savedDevice.iotDeviceName = cloudTripleInfo.deviceName;
        savedDevice.iotDeviceSecret = cloudTripleInfo.deviceSecret;
        await this.deviceRepository.save(savedDevice);

        // 返回三元组信息
        tripleInfo = cloudTripleInfo;
      }
    }

    return { device: savedDevice, tripleInfo };
  }

  /**
   * 确保设备的云资源已创建
   * 使用 Redis Pub/Sub 与 video-service 通信
   *
   * @param deviceId - 设备ID
   * @param cloudProvider - 云服务商
   * @returns IoT Video 三元组信息（仅 cloudProvider=TENCENT 时返回）
   * @private
   */
  private async ensureCloudResources(
    deviceId: string,
    cloudProvider: CloudProvider
  ): Promise<IoTVideoTripleInfo | null> {
    try {
      const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const requestChannel = 'stream:create:request';
      const responseChannel = `stream:create:response:${correlationId}`;

      const providerName = cloudProvider === CloudProvider.AWS ? 'AWS KVS' : 'IoT Video';
      this.logger.info(
        `[DeviceRegisterSubscriber] Creating ${providerName} resources for device: ${deviceId}, correlationId: ${correlationId}`
      );

      // 使用 Promise 等待响应
      const response = await new Promise<any>((resolve, reject) => {
        // 设置超时
        const timer = setTimeout(() => {
          reject(new Error('Request timeout'));
        }, 30000);

        // 创建临时订阅者
        const Redis = require('ioredis');
        const redisOptions: any = {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        };
        if (process.env.REDIS_PASSWORD) {
          redisOptions.password = process.env.REDIS_PASSWORD;
        }
        const tempSubscriber = new Redis(redisOptions);

        // 先订阅响应频道
        tempSubscriber.subscribe(responseChannel, (err: Error | null) => {
          if (err) {
            clearTimeout(timer);
            tempSubscriber.disconnect();
            reject(new Error(`Subscribe error: ${err.message}`));
            return;
          }

          // 订阅成功后，发布请求
          const requestMessage = {
            correlationId,
            deviceId,
            cloudProvider,
            timestamp: Date.now(),
          };

          this.redisClient.publish(requestChannel, JSON.stringify(requestMessage));
        });

        // 监听响应
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

      if (response?.success) {
        const { streamName, created, tripleInfo } = response;

        if (cloudProvider === CloudProvider.TENCENT && tripleInfo) {
          // IoT Video: 返回三元组信息
          this.logger.info(
            `[DeviceRegisterSubscriber] IoT Video device ${created ? 'created' : 'exists'}: ${tripleInfo.deviceName} for device: ${deviceId}`
          );
          return {
            productId: tripleInfo.productId,
            deviceName: tripleInfo.deviceName,
            deviceSecret: tripleInfo.deviceSecret || tripleInfo.devicePsk,
          };
        } else {
          // AWS KVS
          this.logger.info(
            `[DeviceRegisterSubscriber] KVS stream ${created ? 'created' : 'exists'}: ${streamName} for device: ${deviceId}`
          );
        }
      } else {
        this.logger.warn(
          `[DeviceRegisterSubscriber] Failed to create ${providerName} resources for device ${deviceId}:`,
          response?.error
        );
      }
    } catch (error: any) {
      // 不阻止设备注册，只记录错误
      this.logger.error(
        `[DeviceRegisterSubscriber] Error creating cloud resources for device ${deviceId}:`,
        error.message
      );
    }

    return null;
  }

  /**
   * 发布响应到Redis
   *
   * @param correlationId - 关联ID（用于匹配请求和响应）
   * @param response - 响应对象
   * @private
   */
  private async publishResponse(
    correlationId: string,
    response: DeviceRegisterResponseMessage
  ): Promise<void> {
    try {
      const channel = `${RESPONSE_CHANNEL_PREFIX}${correlationId}`;
      await this.redisClient.publish(channel, JsonUtil.stringify(response));
      this.logger.debug(
        `[DeviceRegisterSubscriber] Published response: correlationId=${correlationId}, code=${response.code}`
      );
    } catch (error) {
      this.logger.error('[DeviceRegisterSubscriber] Error publishing response:', error);
    }
  }
}
