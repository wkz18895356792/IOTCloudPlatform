import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { CacheManager } from '@baby-monitor/shared-utils';
import { JsonUtil } from '@baby-monitor/shared-utils';

/**
 * 设备连接信息
 */
export interface DeviceConnection {
  deviceId: string;
  clientId: string;
  connectedAt: number;
  lastHeartbeat: number;
  protocol: 'matter' | 'private';
  ipAddress?: string;
  firmwareVersion?: string;
}

/**
 * 设备会话信息
 */
export interface DeviceSession {
  deviceId: string;
  clientId: string;
  subscriptions: string[];
  lastActivity: number;
  willMessage?: {
    topic: string;
    payload: string;
    qos: 0 | 1 | 2;
  };
}

/**
 * 连接管理服务
 *
 * 负责跟踪和管理设备连接状态
 * 维护设备会话信息，检测设备离线
 *
 * 职责：
 * - 跟踪设备连接状态
 * - 管理设备会话
 * - 检测设备离线（心跳超时）
 * - 清理过期会话
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class ConnectionManagerService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  // Redis键前缀
  private readonly CONNECTION_PREFIX = 'gateway:connection:';
  private readonly SESSION_PREFIX = 'gateway:session:';
  private readonly DEVICE_SET = 'gateway:devices:online';
  private readonly HEARTBEAT_PREFIX = 'gateway:heartbeat:';

  // 配置
  private readonly HEARTBEAT_TIMEOUT = 300000; // 5分钟
  private readonly SESSION_TTL = 86400; // 24小时
  private readonly CLEANUP_INTERVAL = 3600000; // 1小时

  private cleanupTimer?: NodeJS.Timeout;

  /**
   * 注册设备连接
   *
   * @param connection 设备连接信息
   */
  async registerConnection(connection: DeviceConnection): Promise<void> {
    const key = `${this.CONNECTION_PREFIX}${connection.deviceId}`;
    const now = Date.now();

    const connectionData = {
      ...connection,
      connectedAt: connection.connectedAt || now,
      lastHeartbeat: now,
    };

    // 存储连接信息
    await this.redis.set(key, JsonUtil.stringify(connectionData));
    await this.redis.expire(key, this.SESSION_TTL);

    // 添加到在线设备集合
    await this.redis.sadd(this.DEVICE_SET, connection.deviceId);

    // 更新心跳时间
    await this.updateHeartbeat(connection.deviceId);

    this.logger.info(`[Connection Manager] Device connected: ${connection.deviceId}`);
  }

  /**
   * 更新设备心跳
   *
   * @param deviceId 设备ID
   */
  async updateHeartbeat(deviceId: string): Promise<void> {
    const key = `${this.HEARTBEAT_PREFIX}${deviceId}`;
    const now = Date.now();

    await this.redis.set(key, now.toString());
    await this.redis.expire(key, this.HEARTBEAT_TIMEOUT / 1000 + 60); // 额外60秒缓冲

    // 更新连接信息中的最后心跳时间
    const connectionKey = `${this.CONNECTION_PREFIX}${deviceId}`;
    const connectionData = await this.redis.get(connectionKey);
    if (connectionData) {
      const connection = JSON.parse(connectionData) as DeviceConnection;
      connection.lastHeartbeat = now;
      await this.redis.set(connectionKey, JsonUtil.stringify(connection));
      await this.redis.expire(connectionKey, this.SESSION_TTL);
    }
  }

  /**
   * 获取设备连接信息
   *
   * @param deviceId 设备ID
   */
  async getDeviceConnection(deviceId: string): Promise<DeviceConnection | null> {
    const key = `${this.CONNECTION_PREFIX}${deviceId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * 获取设备会话
   *
   * @param deviceId 设备ID
   */
  async getDeviceSession(deviceId: string): Promise<DeviceSession | null> {
    const key = `${this.SESSION_PREFIX}${deviceId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * 创建或更新设备会话
   *
   * @param session 设备会话信息
   */
  async saveDeviceSession(session: DeviceSession): Promise<void> {
    const key = `${this.SESSION_PREFIX}${session.deviceId}`;
    session.lastActivity = Date.now();

    await this.redis.set(key, JsonUtil.stringify(session));
    await this.redis.expire(key, this.SESSION_TTL);
  }

  /**
   * 移除设备连接
   *
   * @param deviceId 设备ID
   * @param reason 离线原因
   */
  async removeConnection(deviceId: string, reason: string = 'unknown'): Promise<void> {
    // 删除连接信息
    await this.redis.del(`${this.CONNECTION_PREFIX}${deviceId}`);

    // 删除会话信息
    await this.redis.del(`${this.SESSION_PREFIX}${deviceId}`);

    // 删除心跳
    await this.redis.del(`${this.HEARTBEAT_PREFIX}${deviceId}`);

    // 从在线设备集合移除
    await this.redis.srem(this.DEVICE_SET, deviceId);

    // 发布设备离线事件到 device-service
    await this.publishOfflineEvent(deviceId, reason);

    this.logger.info(`[Connection Manager] Device disconnected: ${deviceId}, reason: ${reason}`);
  }

  /**
   * 发布设备离线事件
   *
   * 通过 Redis Pub/Sub 通知 device-service 更新数据库中的设备状态
   *
   * @param deviceId 设备ID
   * @param reason 离线原因
   */
  private async publishOfflineEvent(deviceId: string, reason: string): Promise<void> {
    try {
      const event = JsonUtil.stringify({
        type: 'device.offline',
        data: {
          deviceId,
          timestamp: Date.now(),
          reason,
        },
      });
      await this.redis.publish('device:status:update', event);
    } catch (error) {
      this.logger.error(`[Connection Manager] Failed to publish offline event for ${deviceId}:`, error);
    }
  }

  /**
   * 检查设备是否在线
   *
   * @param deviceId 设备ID
   */
  async isDeviceOnline(deviceId: string): Promise<boolean> {
    const key = `${this.HEARTBEAT_PREFIX}${deviceId}`;
    const heartbeat = await this.redis.get(key);

    if (!heartbeat) {
      return false;
    }

    const lastHeartbeat = parseInt(heartbeat, 10);
    const now = Date.now();

    return now - lastHeartbeat < this.HEARTBEAT_TIMEOUT;
  }

  /**
   * 获取在线设备数量
   */
  getOnlineDeviceCount(): number {
    // 这个方法在内存中维护计数器更高效
    // 这里简化实现，实际应该用缓存
    return 0;
  }

  /**
   * 获取所有在线设备ID
   */
  async getOnlineDeviceIds(): Promise<string[]> {
    return await this.redis.smembers(this.DEVICE_SET);
  }

  /**
   * 启动清理任务
   * 定期清理过期连接和会话
   */
  async startCleanupTask(): Promise<void> {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(async () => {
      await this.cleanupExpiredConnections();
    }, this.CLEANUP_INTERVAL);

    this.logger.info('[Connection Manager] Cleanup task started');
  }

  /**
   * 停止清理任务
   */
  async stopCleanupTask(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
      this.logger.info('[Connection Manager] Cleanup task stopped');
    }
  }

  /**
   * 清理过期连接
   * 检查所有在线设备的心跳时间，移除超时设备
   */
  private async cleanupExpiredConnections(): Promise<void> {
    try {
      const onlineDevices = await this.getOnlineDeviceIds();
      const now = Date.now();
      let cleaned = 0;

      for (const deviceId of onlineDevices) {
        const connection = await this.getDeviceConnection(deviceId);

        if (!connection) {
          await this.removeConnection(deviceId, 'connection_not_found');
          cleaned++;
          continue;
        }

        // 检查心跳是否超时
        if (now - connection.lastHeartbeat > this.HEARTBEAT_TIMEOUT) {
          this.logger.warn(`[Connection Manager] Device heartbeat timeout: ${deviceId}`);
          await this.removeConnection(deviceId, 'heartbeat_timeout');
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.logger.info(`[Connection Manager] Cleaned up ${cleaned} expired connections`);
      }
    } catch (error) {
      this.logger.error('[Connection Manager] Error during cleanup:', error);
    }
  }

  /**
   * 获取连接统计信息
   */
  async getStatistics(): Promise<{
    onlineDevices: number;
    totalConnections: number;
    activeSessions: number;
  }> {
    const onlineDevices = await this.getOnlineDeviceIds();

    // 简化统计，实际可能需要更精确的计数
    return {
      onlineDevices: onlineDevices.length,
      totalConnections: onlineDevices.length,
      activeSessions: onlineDevices.length,
    };
  }
}
