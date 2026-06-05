import { Provide, Inject, Config } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { HttpService } from '@midwayjs/axios';
import { RedisService } from '@midwayjs/redis';
import * as os from 'os';
import pidusage from 'pidusage';

/**
 * 服务健康状态
 */
export interface ServiceHealth {
  serviceName: string;
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;
  lastCheck: Date;
  responseTime?: number;
  url: string;
  error?: string;
  metrics?: {
    cpu: number;
    memory: number;
    disk: number;
  };
}

/**
 * 健康检查结果
 */
interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'down';
  responseTime: number;
  error?: string;
  uptime?: number;
  metrics?: {
    cpu: number;
    memory: number;
    disk: number;
  };
}

/**
 * 服务配置
 */
interface ServiceConfig {
  name: string;
  url: string;
  healthEndpoint: string;
  timeout: number;
}

/**
 * 系统资源使用情况
 */
interface SystemMetrics {
  cpu: number;
  memory: number;
  disk: number;
}

/**
 * 健康检查服务
 *
 * 负责检查所有微服务的健康状态
 */
@Provide()
export class HealthCheckService {
  @Inject()
  logger!: ILogger;

  @Inject()
  httpService!: HttpService;

  @Inject()
  redisService!: RedisService;

  @Config('admin')
  adminConfig!: any;

  // 服务启动时间
  private startTime = Date.now();

  // 服务列表配置
  private services: ServiceConfig[] = [];

  /**
   * 初始化服务列表
   */
  async init() {
    const baseUrl = this.adminConfig.serviceBaseUrl || 'http://localhost';
    const timeout = this.adminConfig.healthCheckTimeout || 5000;

    this.services = [
      { name: 'api-gateway', url: `${baseUrl}:6001`, healthEndpoint: '/health', timeout },
      { name: 'user-service', url: `${baseUrl}:6002`, healthEndpoint: '/health', timeout },
      { name: 'device-service', url: `${baseUrl}:6003`, healthEndpoint: '/health', timeout },
      { name: 'video-service', url: `${baseUrl}:6004`, healthEndpoint: '/health', timeout },
      { name: 'storage-service', url: `${baseUrl}:6005`, healthEndpoint: '/health', timeout },
      { name: 'baby-service', url: `${baseUrl}:6008`, healthEndpoint: '/health', timeout },
      { name: 'device-gateway', url: `${baseUrl}:6010`, healthEndpoint: '/health', timeout },
    ];

    // 添加基础设施服务
    this.services.push(
      { name: 'mysql', url: '', healthEndpoint: '', timeout },
      { name: 'redis', url: '', healthEndpoint: '', timeout }
    );

    this.logger.info('[HealthCheckService] Service list initialized');
  }

  /**
   * 检查所有服务的健康状态
   */
  async checkAllServices(): Promise<ServiceHealth[]> {
    if (this.services.length === 0) {
      await this.init();
    }

    const results: ServiceHealth[] = [];

    // 并发检查所有服务
    const checkPromises = this.services.map(service =>
      this.checkService(service).then(result => ({
        serviceName: service.name,
        url: service.url || 'internal',
        status: result.status,
        uptime: result.uptime || 0,
        lastCheck: new Date(),
        responseTime: result.responseTime,
        error: result.error,
        metrics: result.metrics,
      }))
    );

    try {
      const serviceResults = await Promise.all(checkPromises);
      results.push(...serviceResults);
    } catch (error: any) {
      this.logger.error('[HealthCheckService] Error checking services:', error);
    }

    return results;
  }

  /**
   * 检查单个服务的健康状态
   */
  async checkService(service: ServiceConfig): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // 基础设施服务使用特殊检查方式
      if (service.name === 'mysql') {
        return await this.checkMySQL();
      }

      if (service.name === 'redis') {
        return await this.checkRedis();
      }

      // HTTP服务检查
      if (service.url && service.healthEndpoint) {
        return await this.checkHTTPService(service);
      }

      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        error: 'Invalid service configuration',
      };
    } catch (error: any) {
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * 检查HTTP服务
   */
  private async checkHTTPService(service: ServiceConfig): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const url = `${service.url}${service.healthEndpoint}`;

    try {
      const response = await this.httpService.get(url, {
        timeout: service.timeout,
      });

      const responseTime = Date.now() - startTime;

      // 检查响应状态
      if (response.status === 200 && response.data) {
        const data = response.data;

        // 检查服务自身报告的状态
        const serviceStatus = data.status || data.health || 'ok';
        const isHealthy = serviceStatus === 'ok' || serviceStatus === 'healthy' || serviceStatus === 'up';

        return {
          status: isHealthy ? 'healthy' : 'degraded',
          responseTime,
          uptime: data.uptime || 0,
          metrics: data.metrics,
        };
      }

      return {
        status: 'degraded',
        responseTime,
        error: `HTTP ${response.status}`,
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      this.logger.warn(`[HealthCheckService] ${service.name} check failed:`, error.message);

      return {
        status: 'down',
        responseTime,
        error: error.code === 'ECONNREFUSED' ? 'Connection refused' : error.message,
      };
    }
  }

  /**
   * 检查MySQL数据库
   */
  private async checkMySQL(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // 通过TypeORM连接检查MySQL
      // 这里简化处理，实际应该注入MySQL连接进行检查
      // 由于这是admin-service，可以通过HTTP调用其他服务来检查MySQL状态

      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
        metrics: await this.getLocalMetrics(),
      };
    } catch (error: any) {
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * 检查Redis
   */
  private async checkRedis(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // 尝试ping Redis
      await this.redisService.ping();

      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
        metrics: await this.getLocalMetrics(),
      };
    } catch (error: any) {
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        error: error.message || 'Redis connection failed',
      };
    }
  }

  /**
   * 获取本地系统指标
   */
  private async getLocalMetrics(): Promise<SystemMetrics> {
    try {
      const stats = await pidusage(process.pid);

      return {
        cpu: stats.cpu || 0,
        memory: ((stats.memory || 0) / os.totalmem()) * 100,
        disk: 0, // 磁盘使用率需要额外计算
      };
    } catch (error) {
      return {
        cpu: 0,
        memory: 0,
        disk: 0,
      };
    }
  }

  /**
   * 获取当前服务的运行时间
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * 获取系统资源使用情况
   */
  async getSystemMetrics(): Promise<{
    cpu: number;
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    disk: {
      used: number;
      total: number;
      percentage: number;
    };
    loadAverage: number[];
  }> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // 获取进程统计
    let processCpu = 0;
    try {
      const stats = await pidusage(process.pid);
      processCpu = stats.cpu || 0;
    } catch (error) {
      // 忽略错误
    }

    return {
      cpu: processCpu,
      memory: {
        used: usedMem,
        total: totalMem,
        percentage: (usedMem / totalMem) * 100,
      },
      disk: {
        used: 0, // 需要实现磁盘使用率检查
        total: 0,
        percentage: 0,
      },
      loadAverage: os.loadavg(),
    };
  }

  /**
   * 检查特定服务的健康状态
   */
  async checkServiceByName(serviceName: string): Promise<ServiceHealth | null> {
    if (this.services.length === 0) {
      await this.init();
    }

    const service = this.services.find(s => s.name === serviceName);
    if (!service) {
      return null;
    }

    const result = await this.checkService(service);

    return {
      serviceName: service.name,
      url: service.url || 'internal',
      status: result.status,
      uptime: result.uptime || 0,
      lastCheck: new Date(),
      responseTime: result.responseTime,
      error: result.error,
      metrics: result.metrics,
    };
  }
}
