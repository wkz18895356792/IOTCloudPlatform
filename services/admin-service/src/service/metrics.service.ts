import { Provide, Inject, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Domain } from '../entity/domain.entity';
import { DomainRole } from '../entity/domain-role.entity';
import { DomainAuditLog } from '../entity/domain-audit-log.entity';
import { CacheManager } from '@baby-monitor/shared-utils';
import * as os from 'os';
import pidusage from 'pidusage';

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  period: {
    startDate: string;
    endDate: string;
  };
  metrics: {
    requests: {
      total: number;
      success: number;
      error: number;
      avgResponseTime: number;
    };
    resources: {
      cpu: number;
      memory: number;
      disk: number;
      network: number;
    };
  };
}

/**
 * 实时统计数据
 */
export interface RealtimeStats {
  onlineUsers: number;
  activeDevices: number;
  requestsPerSecond: number;
  avgResponseTime: number;
  cpuUsage: number;
  memoryUsage: number;
  timestamp: Date;
}

/**
 * 时间序列数据点
 */
export interface TimeSeriesDataPoint {
  timestamp: string;
  value: number;
}

/**
 * Prometheus指标服务
 *
 * 负责收集和管理系统性能指标
 */
@Provide()
export class MetricsService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redisService!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  @InjectEntityModel(Domain)
  domainRepository!: Repository<Domain>;

  @InjectEntityModel(DomainRole)
  domainRoleRepository!: Repository<DomainRole>;

  @InjectEntityModel(DomainAuditLog)
  auditLogRepository!: Repository<DomainAuditLog>;

  // 指标缓存
  private metricsCache: Map<string, { data: any; expiry: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30秒缓存

  // 请求计数器
  private requestCounters: Map<string, number> = new Map();
  private requestTimings: Map<string, number[]> = new Map();

  @Init()
  async init() {
    this.logger.info('[MetricsService] Metrics service initialized');
    // 启动指标收集定时任务
    setInterval(() => this.collectMetrics(), 60000); // 每分钟收集一次
  }

  /**
   * 收集系统指标
   */
  async collectMetrics() {
    try {
      const metrics = {
        timestamp: Date.now(),
        system: await this.getSystemMetrics(),
        services: await this.getServiceMetrics(),
        business: await this.getBusinessMetrics(),
      };

      // 存储到Redis用于时间序列分析
      const key = `metrics:${Date.now()}`;
      await this.redisService.set(key, JSON.stringify(metrics), 'EX', 86400); // 保留24小时

      this.logger.debug('[MetricsService] Metrics collected');
    } catch (error: any) {
      this.logger.error('[MetricsService] Failed to collect metrics:', error);
    }
  }

  /**
   * 记录请求
   */
  recordRequest(service: string, endpoint: string, statusCode: number, responseTime: number) {
    const key = `${service}:${endpoint}`;

    // 更新计数器
    const currentCount = this.requestCounters.get(key) || 0;
    this.requestCounters.set(key, currentCount + 1);

    // 记录响应时间
    if (!this.requestTimings.has(key)) {
      this.requestTimings.set(key, []);
    }
    const timings = this.requestTimings.get(key)!;
    timings.push(responseTime);

    // 只保留最近1000个响应时间
    if (timings.length > 1000) {
      timings.shift();
    }

    // 定期持久化到Redis
    if (currentCount % 100 === 0) {
      this.persistRequestMetrics(key);
    }
  }

  /**
   * 持久化请求指标到Redis
   */
  private async persistRequestMetrics(key: string) {
    try {
      const timings = this.requestTimings.get(key) || [];
      const count = this.requestCounters.get(key) || 0;

      if (timings.length === 0) return;

      const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
      const min = Math.min(...timings);
      const max = Math.max(...timings);
      const p95 = this.percentile(timings, 95);

      const metrics = {
        key,
        count,
        avg,
        min,
        max,
        p95,
        timestamp: Date.now(),
      };

      await this.redisService.hset(`request_metrics:${key}`, metrics);
      await this.redisService.expire(`request_metrics:${key}`, 86400);
    } catch (error: any) {
      this.logger.error('[MetricsService] Failed to persist request metrics:', error);
    }
  }

  /**
   * 获取性能指标
   */
  async getPerformanceMetrics(startDate: string, endDate: string): Promise<PerformanceMetrics> {
    const cacheKey = `performance:${startDate}:${endDate}`;
    const cached = this.metricsCache.get(cacheKey);

    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    try {
      const start = new Date(startDate);
      const end = new Date(endDate);

      // 从Redis获取时间序列数据
      const keys = await this.cacheManager.keysByPattern('metrics:*');
      const metricsData = [];

      for (const key of keys) {
        const timestamp = parseInt(key.split(':')[1]);
        if (timestamp >= start.getTime() && timestamp <= end.getTime()) {
          const data = await this.redisService.get(key);
          if (data) {
            metricsData.push(JSON.parse(data));
          }
        }
      }

      // 聚合指标
      const metrics: PerformanceMetrics = {
        period: { startDate, endDate },
        metrics: {
          requests: {
            total: metricsData.reduce((sum: number, m: any) => sum + (m.requests?.total || 0), 0),
            success: metricsData.reduce((sum: number, m: any) => sum + (m.requests?.success || 0), 0),
            error: metricsData.reduce((sum: number, m: any) => sum + (m.requests?.error || 0), 0),
            avgResponseTime: this.calculateAverage(metricsData.map((m: any) => m.requests?.avgResponseTime || 0)),
          },
          resources: {
            cpu: this.calculateAverage(metricsData.map((m: any) => m.resources?.cpu || 0)),
            memory: this.calculateAverage(metricsData.map((m: any) => m.resources?.memory || 0)),
            disk: this.calculateAverage(metricsData.map((m: any) => m.resources?.disk || 0)),
            network: this.calculateAverage(metricsData.map((m: any) => m.resources?.network || 0)),
          },
        },
      };

      this.metricsCache.set(cacheKey, { data: metrics, expiry: Date.now() + this.CACHE_TTL });

      return metrics;
    } catch (error: any) {
      this.logger.error('[MetricsService] Failed to get performance metrics:', error);

      return {
        period: { startDate, endDate },
        metrics: {
          requests: { total: 0, success: 0, error: 0, avgResponseTime: 0 },
          resources: { cpu: 0, memory: 0, disk: 0, network: 0 },
        },
      };
    }
  }

  /**
   * 获取实时统计
   */
  async getRealtimeStats(): Promise<RealtimeStats> {
    try {
      const stats = await this.getSystemMetrics();
      const activeUsers = await this.getActiveUserCount();
      const requestMetrics = await this.getRequestStats();

      return {
        onlineUsers: activeUsers,
        activeDevices: await this.getActiveDeviceCount(),
        requestsPerSecond: requestMetrics.rps,
        avgResponseTime: requestMetrics.avgTime,
        cpuUsage: stats.cpu,
        memoryUsage: stats.memoryPercentage,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('[MetricsService] Failed to get realtime stats:', error);

      return {
        onlineUsers: 0,
        activeDevices: 0,
        requestsPerSecond: 0,
        avgResponseTime: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        timestamp: new Date(),
      };
    }
  }

  /**
   * 获取系统指标
   */
  private async getSystemMetrics(): Promise<{
    cpu: number;
    memory: number;
    memoryPercentage: number;
    disk: number;
    network: number;
  }> {
    try {
      const stats = await pidusage(process.pid);
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;

      return {
        cpu: stats.cpu || 0,
        memory: stats.memory || 0,
        memoryPercentage: (usedMem / totalMem) * 100,
        disk: 0, // 需要额外实现
        network: 0, // 需要额外实现
      };
    } catch (error) {
      return {
        cpu: 0,
        memory: 0,
        memoryPercentage: 0,
        disk: 0,
        network: 0,
      };
    }
  }

  /**
   * 获取服务指标
   */
  private async getServiceMetrics(): Promise<any> {
    // 这里可以从其他服务获取指标
    return {};
  }

  /**
   * 获取业务指标
   */
  private async getBusinessMetrics(): Promise<any> {
    const domainCount = await this.domainRepository.count();
    const userCount = (await this.domainRoleRepository.find()).length;

    return {
      domains: domainCount,
      users: userCount,
    };
  }

  /**
   * 获取活跃用户数
   */
  private async getActiveUserCount(): Promise<number> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      return await this.domainRoleRepository.count({
        where: {
          lastActiveAt: Between(fiveMinutesAgo, new Date()) as any,
        } as any,
      });
    } catch (error) {
      return 0;
    }
  }

  /**
   * 获取活跃设备数
   */
  private async getActiveDeviceCount(): Promise<number> {
    try {
      // 从Redis获取在线设备数
      const count = await this.redisService.get('devices:online:count');
      return parseInt(count || '0', 10);
    } catch (error) {
      return 0;
    }
  }

  /**
   * 获取请求统计
   */
  private async getRequestStats(): Promise<{ rps: number; avgTime: number }> {
    try {
      const total = Array.from(this.requestCounters.values()).reduce((a, b) => a + b, 0);
      const allTimings = Array.from(this.requestTimings.values()).flat();

      return {
        rps: Math.round(total / 60), // 简化计算
        avgTime: allTimings.length > 0
          ? allTimings.reduce((a, b) => a + b, 0) / allTimings.length
          : 0,
      };
    } catch (error) {
      return { rps: 0, avgTime: 0 };
    }
  }

  /**
   * 计算百分位数
   */
  private percentile(arr: number[], p: number): number {
    const sorted = arr.slice().sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }

  /**
   * 计算平均值
   */
  private calculateAverage(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * 获取趋势数据
   */
  async getTrendData(
    metric: 'users' | 'devices' | 'storage' | 'requests',
    startDate: string,
    endDate: string,
    groupBy: 'hour' | 'day' | 'week' = 'day'
  ): Promise<{ metric: string; dataPoints: TimeSeriesDataPoint[]; period: any }> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dataPoints: TimeSeriesDataPoint[] = [];

    const intervalMs = groupBy === 'hour' ? 3600000 : groupBy === 'day' ? 86400000 : 604800000;

    for (let current = start.getTime(); current <= end.getTime(); current += intervalMs) {
      const dateStr = new Date(current).toISOString().split('T')[0];
      const value = await this.getMetricAtTime(metric, current, intervalMs);

      dataPoints.push({
        timestamp: dateStr,
        value,
      });
    }

    return {
      metric,
      dataPoints,
      period: { startDate, endDate, groupBy },
    };
  }

  /**
   * 获取特定时间的指标值
   */
  private async getMetricAtTime(metric: string, timestamp: number, interval: number): Promise<number> {
    try {
      // 从Redis获取该时间段内的指标
      const keys = await this.cacheManager.keysByPattern(`metrics:*`);
      let value = 0;

      for (const key of keys) {
        const keyTime = parseInt(key.split(':')[1]);
        if (keyTime >= timestamp && keyTime < timestamp + interval) {
          const data = await this.redisService.get(key);
          if (data) {
            const parsed = JSON.parse(data);
            switch (metric) {
              case 'users':
                value += parsed.business?.users || 0;
                break;
              case 'devices':
                value += parsed.business?.devices || 0;
                break;
              case 'storage':
                value += parsed.business?.storage || 0;
                break;
              case 'requests':
                value += parsed.requests?.total || 0;
                break;
            }
          }
        }
      }

      return value;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 清理过期指标数据
   */
  async cleanupExpiredMetrics(): Promise<void> {
    try {
      const keys = await this.cacheManager.keysByPattern('metrics:*');
      const now = Date.now();
      const expiryTime = now - 86400000; // 24小时前

      for (const key of keys) {
        const timestamp = parseInt(key.split(':')[1]);
        if (timestamp < expiryTime) {
          await this.redisService.del(key);
        }
      }

      this.logger.info(`[MetricsService] Cleaned up ${keys.length} metric keys`);
    } catch (error: any) {
      this.logger.error('[MetricsService] Failed to cleanup metrics:', error);
    }
  }

  /**
   * 导出Prometheus格式的指标
   */
  async exportPrometheusMetrics(): Promise<string> {
    const realtime = await this.getRealtimeStats();
    const system = await this.getSystemMetrics();

    const metrics = [
      `# HELP admin_online_users Current online users`,
      `# TYPE admin_online_users gauge`,
      `admin_online_users ${realtime.onlineUsers}`,
      ``,
      `# HELP admin_active_devices Current active devices`,
      `# TYPE admin_active_devices gauge`,
      `admin_active_devices ${realtime.activeDevices}`,
      ``,
      `# HELP admin_requests_per_second Current requests per second`,
      `# TYPE admin_requests_per_second gauge`,
      `admin_requests_per_second ${realtime.requestsPerSecond}`,
      ``,
      `# HELP admin_avg_response_time Average response time in milliseconds`,
      `# TYPE admin_avg_response_time gauge`,
      `admin_avg_response_time ${realtime.avgResponseTime}`,
      ``,
      `# HELP admin_cpu_usage CPU usage percentage`,
      `# TYPE admin_cpu_usage gauge`,
      `admin_cpu_usage ${realtime.cpuUsage}`,
      ``,
      `# HELP admin_memory_usage Memory usage percentage`,
      `# TYPE admin_memory_usage gauge`,
      `admin_memory_usage ${realtime.memoryUsage}`,
    ];

    return metrics.join('\n');
  }
}
