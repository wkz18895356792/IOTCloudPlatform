import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { CacheManager } from '@baby-monitor/shared-utils';
import { ServiceClient } from '@baby-monitor/shared-utils';
import { JsonUtil } from '@baby-monitor/shared-utils';

/**
 * 设备注册请求
 */
export interface DeviceRegistrationRequest {
  serialNumber: string;
  productType: string;
  deviceType?: string;
  firmwareVersion: string;
  protocol: 'matter' | 'private';
  capabilities?: string[];
  metadata?: Record<string, any>;
}

/**
 * 设备注册响应
 */
export interface DeviceRegistrationResponse {
  success: boolean;
  deviceId?: string;
  tempToken?: string;
  expiresAt?: number;
  error?: string;
}

/**
 * 设备注册服务
 *
 * 负责处理设备注册流程
 * 协调设备服务进行设备信息的创建和存储
 *
 * 职责：
 * - 处理设备注册请求
 * - 生成临时设备ID和令牌
 * - 调用设备服务创建设备记录
 * - 管理注册状态
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class DeviceRegistrationService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  @Inject()
  serviceClient!: ServiceClient;

  // Redis键前缀
  private readonly REGISTRATION_PREFIX = 'gateway:registration:';
  private readonly PENDING_PREFIX = 'gateway:pending:';

  // 配置
  private readonly TEMP_TOKEN_EXPIRE = 3600; // 1小时
  private readonly REGISTRATION_TTL = 86400; // 24小时

  /**
   * 处理设备注册请求
   *
   * @param request 注册请求
   */
  async handleRegistration(request: DeviceRegistrationRequest): Promise<DeviceRegistrationResponse> {
    try {
      this.logger.info(`[Device Registration] Processing registration for: ${request.serialNumber}`);

      // 1. 验证请求参数
      const validation = this.validateRequest(request);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // 2. 检查设备是否已注册
      const existingDevice = await this.checkExistingDevice(request.serialNumber);
      if (existingDevice) {
        this.logger.warn(`[Device Registration] Device already registered: ${request.serialNumber}`);
        return {
          success: false,
          error: 'Device already registered',
          deviceId: existingDevice.deviceId,
        };
      }

      // 3. 生成临时设备ID和令牌
      const tempDeviceId = this.generateTempDeviceId();
      const tempToken = this.generateTempToken();

      // 4. 存储待处理的注册信息
      await this.storePendingRegistration(tempDeviceId, request);

      // 5. 调用设备服务创建设备记录
      const deviceRecord = await this.createDeviceRecord(tempDeviceId, request);

      if (!deviceRecord) {
        return { success: false, error: 'Failed to create device record' };
      }

      // 6. 存储注册信息
      await this.storeRegistration(tempDeviceId, request, deviceRecord.deviceId);

      this.logger.info(`[Device Registration] Device registered: ${deviceRecord.deviceId}`);

      return {
        success: true,
        deviceId: deviceRecord.deviceId,
        tempToken,
        expiresAt: Date.now() + this.TEMP_TOKEN_EXPIRE * 1000,
      };
    } catch (error) {
      this.logger.error('[Device Registration] Registration error:', error);
      return { success: false, error: 'Registration failed' };
    }
  }

  /**
   * 验证注册请求
   */
  private validateRequest(request: DeviceRegistrationRequest): {
    valid: boolean;
    error?: string;
  } {
    if (!request.serialNumber || request.serialNumber.trim().length === 0) {
      return { valid: false, error: 'Serial number is required' };
    }

    if (!request.productType || request.productType.trim().length === 0) {
      return { valid: false, error: 'Product type is required' };
    }

    if (!request.protocol || !['matter', 'private'].includes(request.protocol)) {
      return { valid: false, error: 'Invalid protocol type' };
    }

    return { valid: true };
  }

  /**
   * 检查设备是否已注册
   */
  private async checkExistingDevice(serialNumber: string): Promise<{
    deviceId: string;
  } | null> {
    try {
      const response = await this.serviceClient.get<{ deviceId: string }>(
        'device-service',
        `/api/internal/devices/by-serial/${serialNumber}`
      );

      if (response && response.data && response.data.deviceId) {
        return { deviceId: response.data.deviceId };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 生成临时设备ID
   */
  private generateTempDeviceId(): string {
    return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * 生成临时令牌
   */
  private generateTempToken(): string {
    return Buffer.from(`${Date.now()}_${Math.random()}`).toString('base64');
  }

  /**
   * 存储待处理的注册信息
   */
  private async storePendingRegistration(
    tempId: string,
    request: DeviceRegistrationRequest
  ): Promise<void> {
    const key = `${this.PENDING_PREFIX}${tempId}`;
    await this.cacheManager.set(key, request, this.TEMP_TOKEN_EXPIRE);
  }

  /**
   * 创建设备记录
   */
  private async createDeviceRecord(
    tempId: string,
    request: DeviceRegistrationRequest
  ): Promise<{ deviceId: string } | null> {
    try {
      const response = await this.serviceClient.post<{ deviceId: string }>(
        'device-service',
        '/api/internal/devices/register',
        {
          serialNumber: request.serialNumber,
          productType: request.productType,
          deviceType: request.deviceType,
          firmwareVersion: request.firmwareVersion,
          protocol: request.protocol,
          capabilities: request.capabilities || [],
          metadata: request.metadata || {},
        }
      );

      if (response && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      this.logger.error('[Device Registration] Failed to create device record:', error);
      return null;
    }
  }

  /**
   * 存储注册信息
   */
  private async storeRegistration(
    tempId: string,
    request: DeviceRegistrationRequest,
    actualDeviceId: string
  ): Promise<void> {
    const key = `${this.REGISTRATION_PREFIX}${actualDeviceId}`;
    const registrationData = {
      ...request,
      tempId,
      actualDeviceId,
      registeredAt: Date.now(),
    };

    await this.cacheManager.set(key, registrationData, this.REGISTRATION_TTL);
  }

  /**
   * 获取设备注册信息
   */
  async getRegistrationInfo(deviceId: string): Promise<{
    request: DeviceRegistrationRequest;
    registeredAt: number;
  } | null> {
    const key = `${this.REGISTRATION_PREFIX}${deviceId}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    return JsonUtil.parse(data);
  }

  /**
   * 获取待处理的注册信息
   */
  async getPendingRegistration(tempId: string): Promise<DeviceRegistrationRequest | null> {
    const key = `${this.PENDING_PREFIX}${tempId}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    return JsonUtil.parse(data);
  }

  /**
   * 完成注册流程
   * 当设备完成认证后调用
   */
  async completeRegistration(deviceId: string): Promise<void> {
    // 清理待处理的注册信息
    const registration = await this.getRegistrationInfo(deviceId);
    if (registration && registration.request) {
      const tempId = (registration as any).tempId;
      if (tempId) {
        await this.cacheManager.del(`${this.PENDING_PREFIX}${tempId}`);
      }
    }

    this.logger.info(`[Device Registration] Registration completed: ${deviceId}`);
  }

  /**
   * 获取注册统计
   */
  async getStatistics(): Promise<{
    total: number;
    pending: number;
    completed: number;
  }> {
    // 简化实现，实际应该使用更精确的计数
    return {
      total: 0,
      pending: 0,
      completed: 0,
    };
  }
}
