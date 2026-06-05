import { Provide, Inject, Init } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Context } from '@midwayjs/koa';
import { RedisService } from '@midwayjs/redis';
import Redis from 'ioredis';
import { Device, DeviceStatus, ProductType } from '../entity/device.entity';
import { DeviceState } from '../entity/device-state.entity';
import { GatewayCommandService } from './gateway-command.service';
import { IdGenerator, JsonUtil, DateUtil, CacheManager, CacheKeyBuilder, CacheTTL, ServiceClient } from '@baby-monitor/shared-utils';
import {
  DeviceCommandType,
  PaginatedResponse,
  PaginationParams,
} from '@baby-monitor/shared-types';

/**
 * 设备服务
 *
 * 提供设备管理相关功能，包括：
 * - 设备的增删改查操作
 * - 设备状态管理和查询
 * - 设备命令发送和响应处理
 * - 设备状态历史记录
 * - 设备缓存管理
 */
@Provide()
export class DeviceService {
  // 注入统一缓存管理器
  @Inject()
  cacheManager!: CacheManager;

  // 注入网关命令服务，通过 device-gateway 转发 MQTT
  @Inject()
  gatewayCommandService!: GatewayCommandService;

  // 注入服务间通信客户端
  @Inject()
  serviceClient!: ServiceClient;

  // 注入Redis服务（用于跨服务命令通信）
  @Inject()
  redisService!: RedisService;

  // 请求上下文，包含用户信息等
  @Inject()
  ctx!: Context;

  // 设备数据仓储，用于数据库操作
  @InjectEntityModel(Device)
  deviceRepository!: Repository<Device>;

  // 设备状态数据仓储，用于存储设备历史状态
  @InjectEntityModel(DeviceState)
  deviceStateRepository!: Repository<DeviceState>;

  /** Redis 服务命令频道 */
  private static readonly GATEWAY_CHANNEL = 'service:device-gateway';
  private static readonly RESPONSE_CHANNEL = 'service:device-service';

  /** 独立的 Redis 发布客户端（订阅模式连接不能执行 publish） */
  private redisPublisher!: Redis;

  /** 待响应的命令 Promise 映射 */
  private pendingCommands = new Map<string, { resolve: (value: any) => void; reject: (reason: any) => void; timer: NodeJS.Timeout }>();

  /**
   * 初始化 Redis 发布客户端和命令响应监听
   */
  @Init()
  async initCommandHandler(): Promise<void> {
    const redisConfig = (this.redisService as any).getOption?.('client') || {};
    const host = redisConfig.host || process.env.REDIS_HOST || 'localhost';
    const port = redisConfig.port || parseInt(process.env.REDIS_PORT || '6379');

    // 创建独立的 Redis 发布客户端
    this.redisPublisher = new Redis({
      host,
      port,
      password: redisConfig.password || process.env.REDIS_PASSWORD || undefined,
      db: redisConfig.db || parseInt(process.env.REDIS_DB || '0'),
      maxRetriesPerRequest: 3,
    });

    // 订阅命令响应频道
    const sub = new Redis({
      host,
      port,
      password: redisConfig.password || process.env.REDIS_PASSWORD || undefined,
      db: redisConfig.db || parseInt(process.env.REDIS_DB || '0'),
    });

    await sub.subscribe(DeviceService.RESPONSE_CHANNEL);

    sub.on('message', (channel: string, message: string) => {
      if (channel !== DeviceService.RESPONSE_CHANNEL) return;
      try {
        const parsed = JsonUtil.parse(message);
        if (parsed?.type === 'device.command_response' && parsed?.data?.commandId) {
          this.resolvePendingCommand(parsed.data.commandId, parsed.data);
        }
      } catch {
        // ignore parse errors
      }
    });

    this.ctx?.logger?.info?.('[DeviceService] Redis command handler initialized');
  }

  /**
   * 匹配并 resolve 待响应的命令
   */
  private resolvePendingCommand(commandId: string, data: any): void {
    const pending = this.pendingCommands.get(commandId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingCommands.delete(commandId);
      pending.resolve(data);
    }
  }

  /**
   * 创建设备
   *
   * @param data - 设备信息（包含产品类型、序列号、MAC地址等）
   * @returns 创建的设备对象
   *
   * 功能说明：
   * - 在数据库中创建新设备记录
   * - 将设备信息缓存到Redis以提高后续查询性能
   */
  async createDevice(data: Partial<Device>): Promise<Device> {
    // 创建设备实体对象
    const device = this.deviceRepository.create(data);
    // 保存到数据库
    await this.deviceRepository.save(device);
    // 缓存设备信息到Redis
    await this.cacheDevice(device);
    return device;
  }

  /**
   * 获取设备详情
   *
   * @param deviceId - 设备ID
   * @returns 设备对象，如果不存在则返回null
   *
   * 功能说明：
   * - 先从Redis缓存中查询设备信息
   * - 如果缓存未命中，则从数据库查询并更新缓存
   */
  async getDevice(deviceId: string): Promise<Device | null> {
    const cacheKey = CacheKeyBuilder.device(deviceId);

    // 使用统一缓存管理器
    return this.cacheManager.getOrSet(
      cacheKey,
      async () => {
        const device = await this.deviceRepository.findOne({ where: { serialNumber: deviceId } as any });
        return device;
      },
      CacheTTL.MEDIUM
    );
  }

  /**
   * 根据序列号获取设备
   *
   * @param serialNumber - 设备序列号
   * @returns 设备对象，如果不存在则返回null
   */
  async getDeviceBySerial(serialNumber: string): Promise<Device | null> {
    return this.deviceRepository.findOne({
      where: { serialNumber } as any,
    });
  }

  /**
   * 更新设备信息
   *
   * @param deviceId - 设备ID
   * @param updates - 要更新的字段（名称、位置等）
   * @returns 更新后的设备对象，如果设备不存在则返回null
   *
   * 功能说明：
   * - 更新数据库中的设备信息
   * - 清除Redis缓存以确保数据一致性
   * - 重新从数据库获取并返回最新的设备信息
   */
  async updateDevice(deviceId: string, updates: Partial<Device>): Promise<Device | null> {
    // 更新数据库记录
    await this.deviceRepository.update(deviceId, updates);
    // 清除缓存，强制下次从数据库读取最新数据
    await this.clearDeviceCache(deviceId);
    // 重新获取并返回设备信息（会自动缓存）
    return this.getDevice(deviceId);
  }

  /**
   * 删除设备
   *
   * @param deviceId - 设备ID
   * @returns 删除是否成功
   *
   * 功能说明：
   * - 从数据库中删除设备记录
   * - 同时清除Redis缓存
   */
  async deleteDevice(deviceId: string): Promise<boolean> {
    const result = await this.deviceRepository.delete(deviceId);
    // 清除设备缓存
    await this.clearDeviceCache(deviceId);
    // 判断是否有记录被删除
    return (result.affected ?? 0) > 0;
  }

  /**
   * 获取用户的设备列表
   *
   * @param userId - 用户ID
   * @param pagination - 分页参数（页码、每页数量、排序等）
   * @returns 分页的设备列表
   *
   * 功能说明：
   * - 查询指定用户拥有的所有设备
   * - 支持分页和排序
   * - 返回总数和分页信息
   */
  async getUserDevices(
    userId: string,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<Device & { role: string; sharedBy: string | null }>> {
    const { page, pageSize, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
    const deviceSelect = ['id', 'serialNumber', 'name', 'productType', 'productId', 'iotProductId', 'iotDeviceName', 'status', 'ipAddress', 'lastOnline', 'createdAt', 'updatedAt', 'ownerId'] as const;

    // 1. 通过 user-service 内部 API 获取用户绑定的设备列表（含 role 和 sharedBy）
    let userDeviceMap = new Map<string, { role: string; sharedBy: string | null }>();
    try {
      const response = await this.serviceClient.get<{ deviceIds: string[]; devices?: Array<{ deviceId: string; role: string; sharedBy?: string | null }> }>(
        'user-service',
        '/api/internal/devices/permissions/user',
        { userId },
      );
      if (response.success && response.data?.devices) {
        for (const ud of response.data.devices) {
          userDeviceMap.set(ud.deviceId, { role: ud.role, sharedBy: ud.sharedBy ?? null });
        }
      }
    } catch (err) {
      this.ctx.logger.warn(`[DeviceService] Failed to get user devices from user-service: ${(err as Error).message}`);
    }

    // 2. 补充自有设备（ownerId === userId）
    const ownedDevices = await this.deviceRepository.find({
      where: { ownerId: userId } as any,
      select: deviceSelect as any,
    });
    for (const d of ownedDevices) {
      if (!userDeviceMap.has(d.id)) {
        userDeviceMap.set(d.id, { role: 'owner', sharedBy: null });
      }
    }

    // 3. 查询所有相关设备详情
    const allDeviceIds = Array.from(userDeviceMap.keys());
    if (allDeviceIds.length === 0) {
      return { items: [], total: 0, page, pageSize, totalPages: 0 };
    }

    const [items, total] = await this.deviceRepository.findAndCount({
      where: { id: In(allDeviceIds) } as any,
      select: deviceSelect as any,
      order: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // 4. 附加 role 和 sharedBy
    const enrichedItems = items.map(d => {
      const info = userDeviceMap.get(d.id);
      return {
        ...d,
        role: info?.role ?? 'viewer',
        sharedBy: info?.sharedBy ?? null,
      };
    });

    return {
      items: enrichedItems,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 更新设备在线状态
   *
   * @param deviceId - 设备ID
   * @param status - 设备状态（在线/离线/错误）
   * @param ipAddress - 设备IP地址（可选）
   *
   * 功能说明：
   * - 更新数据库中的设备状态和最后在线时间
   * - 在Redis中维护在线状态缓存（用于快速查询）
   * - 通过MQTT发布设备状态变更事件
   */
  async updateDeviceStatus(deviceId: string, status: DeviceStatus, ipAddress?: string): Promise<void> {
    const updates: Partial<Device> = {
      status,
      lastOnline: new Date(),
    };

    // 如果提供了IP地址，一并更新
    if (ipAddress) {
      updates.ipAddress = ipAddress;
    }

    // 更新设备信息
    await this.updateDevice(deviceId, updates);

    // 更新在线状态缓存 - 使用统一缓存管理器
    const cacheKey = CacheKeyBuilder.deviceOnline(deviceId);
    if (status === DeviceStatus.ONLINE) {
      await this.cacheManager.set(cacheKey, '1', CacheTTL.DEVICE_ONLINE);
    } else {
      await this.cacheManager.del(cacheKey);
    }

    // 发布设备状态变更事件（通过 device-gateway 转发）
    await this.gatewayCommandService.sendDeviceCommand(deviceId, 'status_update', { status });
  }

  /**
   * 检查设备是否在线
   *
   * @param deviceId - 设备ID
   * @returns 设备是否在线
   *
   * 功能说明：
   * - 通过Redis缓存快速判断设备在线状态
   * - 在线状态缓存会在5分钟后过期，需要设备持续上报心跳
   */
  async isDeviceOnline(deviceId: string): Promise<boolean> {
    const cacheKey = CacheKeyBuilder.deviceOnline(deviceId);
    return await this.cacheManager.exists(cacheKey);
  }

  /**
   * 发送设备命令
   *
   * 通过 Redis 将命令发送到 device-gateway，由 device-gateway 转发到设备。
   * 设备响应由 device-gateway 回传 Redis，在此匹配 commandId 并返回结果。
   *
   * @param deviceId - 设备ID
   * @param type - 命令类型（开关、录制、拍照等）
   * @param payload - 命令参数
   * @param timeout - 超时时间（毫秒），默认30秒
   * @returns 设备响应数据
   */
  async sendCommand(
    deviceId: string,
    type: DeviceCommandType,
    payload: Record<string, any>,
    timeout: number = 30000
  ): Promise<any> {
    const commandId = IdGenerator.uuid();

    // 通过 Redis 发送命令到 device-gateway
    const command = {
      type: 'gateway.send_command',
      deviceId,
      timestamp: Date.now(),
      command: type,
      commandId,
      data: payload,
    };

    await this.redisPublisher.publish(
      DeviceService.GATEWAY_CHANNEL,
      JsonUtil.stringify(command)
    );

    // 等待 device-gateway 回传的设备响应
    return this.waitForCommandResponse(commandId, timeout);
  }

  /**
   * 等待命令响应
   *
   * @param commandId - 命令ID
   * @param timeout - 超时时间（毫秒）
   * @returns 设备响应数据
   * @private
   */
  private waitForCommandResponse(commandId: string, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new Error(`Command ${commandId} timeout`));
      }, timeout);

      this.pendingCommands.set(commandId, { resolve, reject, timer });
    });
  }

  /**
   * 保存设备状态
   *
   * @param deviceId - 设备ID
   * @param state - 设备状态数据（温度、湿度、电量等）
   *
   * 功能说明：
   * - 将设备状态保存到数据库历史记录
   * - 将最新状态缓存到Redis以提高查询速度
   */
  async saveDeviceState(deviceId: string, state: Record<string, any>): Promise<void> {
    const deviceState = this.deviceStateRepository.create({
      deviceId,
      state,
      reportedAt: new Date(),
    });
    // 保存到数据库
    await this.deviceStateRepository.save(deviceState);

    // 缓存最新状态到Redis
    const cacheKey = CacheKeyBuilder.deviceState(deviceId);
    await this.cacheManager.set(cacheKey, state, CacheTTL.DEVICE_STATE);
  }

  /**
   * 获取设备当前状态
   *
   * @param deviceId - 设备ID
   * @returns 设备状态对象，如果不存在则返回null
   *
   * 功能说明：
   * - 先从Redis缓存获取最新状态
   * - 缓存未命中则从数据库查询最新记录
   * - 查询结果会缓存到Redis
   */
  async getDeviceState(deviceId: string): Promise<Record<string, any> | null> {
    const cacheKey = CacheKeyBuilder.deviceState(deviceId);

    // 使用统一缓存管理器的 getOrSet 方法
    return this.cacheManager.getOrSet(
      cacheKey,
      async () => {
        const state = await this.deviceStateRepository.findOne({
          where: { deviceId } as any,
          order: { reportedAt: 'DESC' },
        });
        return state?.state ?? null;
      },
      CacheTTL.DEVICE_STATE
    );
  }

  /**
   * 获取设备历史状态
   *
   * @param deviceId - 设备ID
   * @param startTime - 开始时间
   * @param endTime - 结束时间
   * @returns 历史状态列表
   *
   * 功能说明：
   * - 查询指定时间范围内的设备状态历史记录
   * - 按时间升序排列
   */
  async getDeviceHistory(
    deviceId: string,
    startTime: Date,
    endTime: Date
  ): Promise<DeviceState[]> {
    return this.deviceStateRepository.find({
      where: {
        deviceId,
        reportedAt: Between(startTime, endTime),
      } as any,
      order: { reportedAt: 'ASC' },
    });
  }

  /**
   * 检查用户是否有设备权限
   *
   * @param deviceId - 设备ID
   * @param userId - 用户ID
   * @returns 权限检查结果
   */
  async checkUserPermission(
    deviceId: string,
    userId: string
  ): Promise<{ hasPermission: boolean; role?: 'owner' | 'admin' | 'viewer' }> {
    // 1. 查询设备是否存在
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId } as any,
    });

    if (!device) {
      return { hasPermission: false };
    }

    // 2. 如果用户是设备所有者，拥有所有权限
    if (device.ownerId === userId) {
      return { hasPermission: true, role: 'owner' };
    }

    // 3. 通过API调用user-service检查权限
    try {
      const response = await this.serviceClient.get<{ hasPermission: boolean; role?: 'owner' | 'admin' | 'viewer' }>(
        'user-service',
        `/api/internal/devices/permission`,
        { deviceId, userId }
      );

      if (response.success && response.data) {
        return response.data;
      }

      return { hasPermission: false };
    } catch (error) {
      // API调用失败时记录错误，并返回无权限
      this.ctx.logger.error(`[DeviceService] Failed to check permission via API:`, error);
      return { hasPermission: false };
    }
  }

  /**
   * 缓存设备信息
   *
   * @param device - 设备对象
   */
  private async cacheDevice(device: Device): Promise<void> {
    const cacheKey = CacheKeyBuilder.device(device.id);
    await this.cacheManager.set(cacheKey, device, CacheTTL.MEDIUM);
  }

  /**
   * 清除设备缓存
   *
   * @param deviceId - 设备ID
   */
  private async clearDeviceCache(deviceId: string): Promise<void> {
    const cacheKey = CacheKeyBuilder.device(deviceId);
    await this.cacheManager.del(cacheKey);
  }
}
