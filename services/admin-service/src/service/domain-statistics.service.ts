/**
 * 域统计服务
 *
 * 提供域级别的统计和分析功能，包括：
 * - 设备统计
 * - 存储使用统计
 * - 用户活动统计
 * - API 调用统计
 * - 成本分析
 */
import { Provide, Inject } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { Domain } from '../entity/domain.entity';
import { DomainUser } from '../entity/domain-user.entity';

/**
 * 域统计数据
 */
export interface DomainStatistics {
  domainId: string;
  domainName: string;
  period: {
    start: Date;
    end: Date;
  };
  users: {
    total: number;
    active: number;
    new: number;
  };
  devices: {
    total: number;
    online: number;
    offline: number;
    byType: Record<string, number>;
  };
  storage: {
    totalUsed: number;
    totalLimit: number;
    usagePercent: number;
    byType: Record<string, number>;
  };
  api: {
    totalRequests: number;
    successRate: number;
    avgResponseTime: number;
    errorRate: number;
  };
  costs: {
    estimated: number;
    breakdown: {
      storage: number;
      bandwidth: number;
      apiCalls: number;
      other: number;
    };
  };
  alerts: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
}

/**
 * 时间粒度
 */
export enum TimeGranularity {
  HOURLY = 'hourly',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

@Provide()
export class DomainStatisticsService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @InjectEntityModel(Domain)
  domainRepository!: Repository<Domain>;

  @InjectEntityModel(DomainUser)
  domainUserRepository!: Repository<DomainUser>;

  // Redis key 前缀
  private readonly STATS_PREFIX = 'domain:stats:';
  private readonly STATS_CACHE_TTL = 3600; // 1小时缓存

  /**
   * 获取域统计数据
   */
  async getDomainStatistics(
    domainId: string,
    options: {
      startDate: Date;
      endDate: Date;
      granularity?: TimeGranularity;
    }
  ): Promise<DomainStatistics> {
    const cacheKey = `${this.STATS_PREFIX}${domainId}:${options.startDate.getTime()}:${options.endDate.getTime()}`;

    // 尝试从缓存获取
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // 计算统计数据
    const stats = await this.calculateStatistics(domainId, options);

    // 缓存结果
    await this.redis.set(cacheKey, JSON.stringify(stats), 'EX', this.STATS_CACHE_TTL);

    return stats;
  }

  /**
   * 计算统计数据
   */
  private async calculateStatistics(
    domainId: string,
    options: {
      startDate: Date;
      endDate: Date;
    }
  ): Promise<DomainStatistics> {
    // 获取域信息
    const domain = await this.domainRepository.findOne({
      where: { id: domainId } as any,
    });

    if (!domain) {
      throw new Error('Domain not found');
    }

    // 并行获取各项统计
    const [userStats, deviceStats, storageStats, apiStats, alertStats] = await Promise.all([
      this.getUserStats(domainId, options),
      this.getDeviceStats(domainId, options),
      this.getStorageStats(domainId, options),
      this.getAPIStats(domainId, options),
      this.getAlertStats(domainId, options),
    ]);

    return {
      domainId,
      domainName: domain.name,
      period: {
        start: options.startDate,
        end: options.endDate,
      },
      users: userStats,
      devices: deviceStats,
      storage: storageStats,
      api: apiStats,
      costs: {
        estimated: 0,
        breakdown: {
          storage: 0,
          bandwidth: 0,
          apiCalls: 0,
          other: 0,
        },
      },
      alerts: alertStats,
    };
  }

  /**
   * 获取用户统计
   */
  private async getUserStats(domainId: string, options: {
    startDate: Date;
    endDate: Date;
  }): Promise<{
    total: number;
    active: number;
    new: number;
  }> {
    // 总用户数
    const total = await this.domainUserRepository.count({
      where: { domainId } as any,
    });

    // 活跃用户（最近7天有登录）
    const activeThreshold = new Date();
    activeThreshold.setDate(activeThreshold.getDate() - 7);

    const active = await this.domainUserRepository.count({
      where: {
        domainId,
        lastLoginAt: { $gte: activeThreshold } as any,
      } as any,
    });

    // 新用户（在统计期间加入）
    const newUsers = await this.domainUserRepository.count({
      where: {
        domainId,
        createdAt: { $gte: options.startDate, $lte: options.endDate } as any,
      } as any,
    });

    return { total, active, new: newUsers };
  }

  /**
   * 获取设备统计
   */
  private async getDeviceStats(domainId: string, options: {
    startDate: Date;
    endDate: Date;
  }): Promise<{
    total: number;
    online: number;
    offline: number;
    byType: Record<string, number>;
  }> {
    // 从 Redis 获取设备在线状态
    const onlineKey = `domain:${domainId}:devices:online`;
    const online = await this.redis.scard(onlineKey);

    // 假设我们有设备数据
    // 这里需要根据实际的设备表查询
    const byType: Record<string, number> = {
      camera: 0,
      monitor: 0,
      sensor: 0,
    };

    // 从 Redis 获取设备总数
    const totalKey = `domain:${domainId}:devices:total`;
    const total = parseInt(await this.redis.get(totalKey) || '0', 10);

    const offline = total - online;

    return { total, online, offline: Math.max(0, offline), byType };
  }

  /**
   * 获取存储统计
   */
  private async getStorageStats(domainId: string, options: {
    startDate: Date;
    endDate: Date;
  }): Promise<{
    totalUsed: number;
    totalLimit: number;
    usagePercent: number;
    byType: Record<string, number>;
  }> {
    const storageKey = `domain:${domainId}:storage:used`;
    const used = parseInt(await this.redis.get(storageKey) || '0', 10);

    const limitKey = `domain:${domainId}:storage:limit`;
    const limit = parseInt(await this.redis.get(limitKey) || '107374182400', 10); // 默认100GB

    const usagePercent = (used / limit) * 100;

    const byType: Record<string, number> = {
      video: 0,
      image: 0,
      document: 0,
      other: 0,
    };

    return {
      totalUsed: used,
      totalLimit: limit,
      usagePercent,
      byType,
    };
  }

  /**
   * 获取 API 统计
   */
  private async getAPIStats(domainId: string, options: {
    startDate: Date;
    endDate: Date;
  }): Promise<{
    totalRequests: number;
    successRate: number;
    avgResponseTime: number;
    errorRate: number;
  }> {
    // 从 Redis 获取 API 统计
    const requestKey = `domain:${domainId}:api:requests`;
    const errorKey = `domain:${domainId}:api:errors`;
    const responseTimeKey = `domain:${domainId}:api:responseTime`;

    const totalRequests = parseInt(await this.redis.get(requestKey) || '0', 10);
    const errors = parseInt(await this.redis.get(errorKey) || '0', 10);
    const avgResponseTime = parseFloat(await this.redis.get(responseTimeKey) || '0');

    const successRate = totalRequests > 0 ? ((totalRequests - errors) / totalRequests) * 100 : 100;
    const errorRate = totalRequests > 0 ? (errors / totalRequests) * 100 : 0;

    return {
      totalRequests,
      successRate,
      avgResponseTime,
      errorRate,
    };
  }

  /**
   * 获取告警统计
   */
  private async getAlertStats(domainId: string, options: {
    startDate: Date;
    endDate: Date;
  }): Promise<{
    total: number;
    critical: number;
    warning: number;
    info: number;
  }> {
    const alertKey = `domain:${domainId}:alerts`;

    // 从 Redis 获取告警统计
    const total = parseInt(await this.redis.hget(alertKey, 'total') || '0', 10);
    const critical = parseInt(await this.redis.hget(alertKey, 'critical') || '0', 10);
    const warning = parseInt(await this.redis.hget(alertKey, 'warning') || '0', 10);
    const info = parseInt(await this.redis.hget(alertKey, 'info') || '0', 10);

    return { total, critical, warning, info };
  }

  /**
   * 获取所有域的概览统计
   */
  async getAllDomainsOverview(): Promise<Array<{
    domainId: string;
    domainName: string;
    userCount: number;
    deviceCount: number;
    storageUsed: number;
    storagePercent: number;
  }>> {
    const domains = await this.domainRepository.find();
    const overview = [];

    for (const domain of domains) {
      const userCount = await this.domainUserRepository.count({
        where: { domainId: domain.id } as any,
      });

      const storageKey = `domain:${domain.id}:storage:used`;
      const storageUsed = parseInt(await this.redis.get(storageKey) || '0', 10);

      const limitKey = `domain:${domain.id}:storage:limit`;
      const storageLimit = parseInt(await this.redis.get(limitKey) || '107374182400', 10);

      const totalKey = `domain:${domain.id}:devices:total`;
      const deviceCount = parseInt(await this.redis.get(totalKey) || '0', 10);

      overview.push({
        domainId: domain.id,
        domainName: domain.name,
        userCount,
        deviceCount,
        storageUsed,
        storagePercent: (storageUsed / storageLimit) * 100,
      });
    }

    return overview;
  }

  /**
   * 获取趋势数据
   */
  async getTrendData(
    domainId: string,
    metric: 'users' | 'devices' | 'storage' | 'api' | 'alerts',
    granularity: TimeGranularity,
    points: number = 30
  ): Promise<Array<{
    timestamp: Date;
    value: number;
  }>> {
    const data: Array<{ timestamp: Date; value: number }> = [];
    const now = Date.now();

    // 根据粒度确定时间间隔
    let interval: number;
    switch (granularity) {
      case TimeGranularity.HOURLY:
        interval = 3600 * 1000; // 1小时
        break;
      case TimeGranularity.DAILY:
        interval = 86400 * 1000; // 1天
        break;
      case TimeGranularity.WEEKLY:
        interval = 7 * 86400 * 1000; // 1周
        break;
      case TimeGranularity.MONTHLY:
        interval = 30 * 86400 * 1000; // 1月
        break;
      default:
        interval = 86400 * 1000;
    }

    // 生成时间序列数据
    for (let i = points - 1; i >= 0; i--) {
      const timestamp = new Date(now - i * interval);
      const value = await this.getMetricValue(domainId, metric, timestamp);
      data.push({ timestamp, value });
    }

    return data;
  }

  /**
   * 获取指定时间点的指标值
   */
  private async getMetricValue(domainId: string, metric: string, timestamp: Date): Promise<number> {
    // 这里应该从时序数据库或 Redis 获取历史数据
    // 简化实现，返回随机值用于演示
    return Math.floor(Math.random() * 100);
  }

  /**
   * 实时更新统计数据
   */
  async updateRealtimeStats(domainId: string, updates: {
    userCount?: number;
    deviceCount?: number;
    storageUsed?: number;
    apiRequests?: number;
    apiErrors?: number;
    alerts?: {
      critical?: number;
      warning?: number;
      info?: number;
    };
  }): Promise<void> {
    if (updates.apiRequests !== undefined) {
      const key = `domain:${domainId}:api:requests`;
      await this.redis.incrby(key, updates.apiRequests);
      await this.redis.expire(key, 86400 * 7); // 7天过期
    }

    if (updates.apiErrors !== undefined) {
      const key = `domain:${domainId}:api:errors`;
      await this.redis.incrby(key, updates.apiErrors);
      await this.redis.expire(key, 86400 * 7);
    }

    if (updates.alerts) {
      const key = `domain:${domainId}:alerts`;
      await this.redis.hincrby(key, 'total', 1);

      if (updates.alerts.critical) {
        await this.redis.hincrby(key, 'critical', updates.alerts.critical);
      }
      if (updates.alerts.warning) {
        await this.redis.hincrby(key, 'warning', updates.alerts.warning);
      }
      if (updates.alerts.info) {
        await this.redis.hincrby(key, 'info', updates.alerts.info);
      }

      await this.redis.expire(key, 86400 * 7);
    }
  }

  /**
   * 清除统计数据缓存
   */
  async clearStatsCache(domainId?: string): Promise<void> {
    const pattern = domainId
      ? `${this.STATS_PREFIX}${domainId}:*`
      : `${this.STATS_PREFIX}*`;

    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
