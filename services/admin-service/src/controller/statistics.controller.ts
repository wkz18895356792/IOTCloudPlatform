import { Controller, Get, Query, Inject, Config } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiTags, ApiQuery } from '@midwayjs/swagger';
import { HttpService } from '@midwayjs/axios';
import { DomainService } from '../service/domain.service';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Domain } from '../entity/domain.entity';
import { DomainRole } from '../entity/domain-role.entity';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 时间序列数据点
 */
interface TimeSeriesDataPoint {
  date: string;
  value: number;
}

/**
 * 资源排行项
 */
interface RankingItem {
  id: string;
  name: string;
  value: number;
  rank?: number;
}

/**
 * 统计分析控制器
 *
 * 提供全局统计、跨域统计、趋势数据和资源排行功能
 */
@ApiTags('统计分析')
@Controller('/api/admin/statistics')
export class StatisticsController {
  @Inject()
  ctx!: Context;

  @Inject()
  httpService!: HttpService;

  @InjectEntityModel(Domain)
  domainRepository!: Repository<Domain>;

  @InjectEntityModel(DomainRole)
  domainRoleRepository!: Repository<DomainRole>;

  @Inject()
  domainService!: DomainService;

  @Config('admin')
  adminConfig!: any;

  // 服务地址配置
  private serviceUrls: Record<string, string> = {};

  /**
   * 初始化服务地址
   */
  private getServiceUrl(serviceName: string): string {
    if (!this.serviceUrls[serviceName]) {
      const baseUrl = this.adminConfig.serviceBaseUrl || 'http://localhost';
      const portMap: Record<string, number> = {
        'device-service': 6003,
        'storage-service': 6005,
        'video-service': 6004,
        'baby-service': 6008,
        'user-service': 6002,
      };

      const port = portMap[serviceName];
      if (port) {
        this.serviceUrls[serviceName] = `${baseUrl}:${port}`;
      }
    }

    return this.serviceUrls[serviceName];
  }

  /**
   * 安全地调用其他服务的API
   */
  private async callServiceAPI(
    serviceName: string,
    endpoint: string,
    fallbackValue: any = 0
  ): Promise<any> {
    try {
      const url = this.getServiceUrl(serviceName);
      if (!url) {
        return fallbackValue;
      }

      const response = await this.httpService.get(`${url}${endpoint}`, {
        timeout: 5000,
      });

      if (response.data?.success && response.data?.data !== undefined) {
        return response.data.data;
      }

      return fallbackValue;
    } catch (error: any) {
      this.ctx.logger?.warn(`[StatisticsController] Failed to call ${serviceName}${endpoint}:`, error.message);
      return fallbackValue;
    }
  }

  /**
   * 获取全局统计信息
   */
  @Get('/global')
  @ApiOperation({ summary: '获取全局统计信息', description: '获取整个平台的全局统计数据' })
  async getGlobalStatistics() {
    try {
      // 域总数
      const totalDomains = await this.domainRepository.count();

      // 活跃域数
      const activeDomains = await this.domainRepository.count({
        where: { status: 'active' as any },
      });

      // 用户总数（去重）
      const domainRoles = await this.domainRoleRepository.find();
      const uniqueUsers = new Set(domainRoles.map((dr) => dr.userId));
      const totalUsers = uniqueUsers.size;

      // 活跃用户数
      const activeUsers = await this.domainRoleRepository.count({
        where: { isActive: true },
      });

      // 调用device-service获取设备统计
      const deviceStats = await this.callServiceAPI('device-service', '/api/stats/summary', {
        total: 0,
        active: 0,
      });
      const totalDevices = deviceStats.total || 0;
      const activeDevices = deviceStats.active || 0;

      // 调用storage-service获取存储统计
      const storageStats = await this.callServiceAPI('storage-service', '/api/storage/quota/global', {
        totalUsed: 0,
        totalCapacity: 0,
      });
      const totalStorageUsed = storageStats.totalUsed || 0;

      // 调用baby-service获取宝宝统计
      const babyStats = await this.callServiceAPI('baby-service', '/api/babies/stats', {
        total: 0,
      });
      const totalBabies = babyStats.total || 0;

      return successResponse({
        totalDomains,
        totalUsers,
        totalDevices,
        totalBabies,
        totalStorageUsed,
        activeDomains,
        activeUsers,
        activeDevices,
      });
    } catch (error: any) {
      this.ctx.logger?.error('[StatisticsController] Get global statistics error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取统计信息失败');
    }
  }

  /**
   * 获取跨域统计
   */
  @Get('/cross-domain')
  @ApiOperation({
    summary: '获取跨域统计',
    description: '获取所有域的统计数据，用于比较和分析'
  })
  @ApiQuery({ name: 'startDate', description: '开始日期 (ISO 8601)', required: false })
  @ApiQuery({ name: 'endDate', description: '结束日期 (ISO 8601)', required: false })
  async getCrossDomainStatistics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    try {
      const domains = await this.domainRepository.find({
        where: { status: 'active' as any },
        order: { createdAt: 'DESC' },
      });

      const statistics = await Promise.all(
        domains.map(async (domain) => {
          const stats = await this.domainService.getDomainStatistics(domain.id);

          return {
            domainId: domain.id,
            domainName: domain.name,
            domainCode: domain.code,
            userCount: stats.data?.userCount || 0,
            deviceCount: stats.data?.deviceCount || 0,
            storageUsed: stats.data?.storageUsed || 0,
            type: domain.type,
            status: domain.status,
            createdAt: domain.createdAt,
          };
        })
      );

      return successResponse(statistics);
    } catch (error: any) {
      this.ctx.logger?.error('[StatisticsController] Get cross-domain statistics error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取跨域统计失败');
    }
  }

  /**
   * 获取趋势数据
   */
  @Get('/trends')
  @ApiOperation({
    summary: '获取趋势数据',
    description: '获取指定指标在一段时间内的趋势变化'
  })
  @ApiQuery({ name: 'metric', description: '指标类型', enum: ['users', 'devices', 'storage', 'requests'], required: true })
  @ApiQuery({ name: 'startDate', description: '开始日期 (ISO 8601)', required: true })
  @ApiQuery({ name: 'endDate', description: '结束日期 (ISO 8601)', required: true })
  @ApiQuery({ name: 'groupBy', description: '分组方式', enum: ['day', 'week', 'month'], required: false, example: 'day' })
  async getTrendData(
    @Query('metric') metric: 'users' | 'devices' | 'storage' | 'requests',
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('groupBy') groupBy: 'day' | 'week' | 'month' = 'day'
  ) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const dataPoints: TimeSeriesDataPoint[] = [];

      // 生成时间序列
      const current = new Date(start);
      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];

        let value = 0;

        // 根据指标类型获取数据
        switch (metric) {
          case 'users':
            value = await this.getUserCountAtDate(current);
            break;
          case 'devices':
            value = await this.getDeviceCountAtDate(current);
            break;
          case 'storage':
            value = await this.getStorageUsageAtDate(current);
            break;
          case 'requests':
            value = await this.getRequestCountAtDate(current);
            break;
        }

        dataPoints.push({ date: dateStr, value });

        // 根据分组增加日期
        if (groupBy === 'day') {
          current.setDate(current.getDate() + 1);
        } else if (groupBy === 'week') {
          current.setDate(current.getDate() + 7);
        } else if (groupBy === 'month') {
          current.setMonth(current.getMonth() + 1);
        }
      }

      return successResponse({
        metric,
        dataPoints,
        period: { startDate, endDate, groupBy },
      });
    } catch (error: any) {
      this.ctx.logger?.error('[StatisticsController] Get trend data error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取趋势数据失败');
    }
  }

  /**
   * 获取资源排行
   */
  @Get('/ranking')
  @ApiOperation({
    summary: '获取资源排行',
    description: '获取域、用户或设备的资源使用排行榜'
  })
  @ApiQuery({ name: 'type', description: '排行类型', enum: ['domain', 'user', 'device'], required: true })
  @ApiQuery({ name: 'metric', description: '排行指标', enum: ['users', 'devices', 'storage', 'requests'], required: true })
  @ApiQuery({ name: 'limit', description: '返回数量', required: false, example: 10 })
  async getResourceRanking(
    @Query('type') type: 'domain' | 'user' | 'device',
    @Query('metric') metric: 'users' | 'devices' | 'storage' | 'requests',
    @Query('limit') limit: number = 10
  ) {
    try {
      let rankings: RankingItem[] = [];

      if (type === 'domain') {
        rankings = await this.getDomainRanking(metric, limit);
      } else if (type === 'user') {
        rankings = await this.getUserRanking(metric, limit);
      } else if (type === 'device') {
        rankings = await this.getDeviceRanking(metric, limit);
      }

      // 添加排名
      rankings = rankings.map((item, index) => ({
        ...item,
        rank: index + 1,
      }));

      return successResponse(rankings);
    } catch (error: any) {
      this.ctx.logger?.error('[StatisticsController] Get resource ranking error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取资源排行失败');
    }
  }

  /**
   * 获取实时监控数据
   */
  @Get('/realtime')
  @ApiOperation({
    summary: '获取实时监控数据',
    description: '获取当前系统的实时监控数据'
  })
  async getRealtimeStatistics() {
    try {
      // 活跃用户数
      const activeUsers = await this.domainRoleRepository.count({
        where: { isActive: true },
      });

      // 调用device-service获取活跃设备数
      const deviceStats = await this.callServiceAPI('device-service', '/api/devices/active/count', 0);
      const activeDevices = deviceStats || 0;

      // 调用各服务获取实时指标
      const requestStats = await this.callServiceAPI('api-gateway', '/api/metrics/realtime', {
        requestsPerSecond: 0,
        avgResponseTime: 0,
      });

      const systemStats = await this.callServiceAPI('admin-service', '/api/admin/monitoring/system/resources', {
        cpuUsage: 0,
        memoryUsage: 0,
      });

      return successResponse({
        onlineUsers: activeUsers,
        activeDevices,
        requestsPerSecond: requestStats.requestsPerSecond || 0,
        avgResponseTime: requestStats.avgResponseTime || 0,
        cpuUsage: systemStats.cpuUsage || 0,
        memoryUsage: systemStats.memoryUsage || 0,
        timestamp: new Date(),
      });
    } catch (error: any) {
      this.ctx.logger?.error('[StatisticsController] Get realtime statistics error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取实时监控数据失败');
    }
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 获取指定日期的用户数量
   */
  private async getUserCountAtDate(date: Date): Promise<number> {
    try {
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const count = await this.domainRoleRepository.count({
        where: {
          createdAt: Between(date, endOfDay) as any,
        } as any,
      });

      return count;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 获取指定日期的设备数量
   */
  private async getDeviceCountAtDate(date: Date): Promise<number> {
    const dateStr = date.toISOString().split('T')[0];
    const stats = await this.callServiceAPI('device-service', `/api/stats/devices/${dateStr}`, 0);
    return stats || 0;
  }

  /**
   * 获取指定日期的存储使用量
   */
  private async getStorageUsageAtDate(date: Date): Promise<number> {
    const dateStr = date.toISOString().split('T')[0];
    const stats = await this.callServiceAPI('storage-service', `/api/stats/usage/${dateStr}`, 0);
    return stats || 0;
  }

  /**
   * 获取指定日期的请求数量
   */
  private async getRequestCountAtDate(date: Date): Promise<number> {
    const dateStr = date.toISOString().split('T')[0];
    const stats = await this.callServiceAPI('api-gateway', `/api/stats/requests/${dateStr}`, 0);
    return stats || 0;
  }

  /**
   * 获取域排行
   */
  private async getDomainRanking(metric: string, limit: number): Promise<RankingItem[]> {
    const domains = await this.domainRepository.find({
      where: { status: 'active' as any },
      order: { createdAt: 'DESC' },
      take: limit * 2, // 获取更多用于排序
    });

    const rankings = await Promise.all(
      domains.map(async (domain) => {
        const stats = await this.domainService.getDomainStatistics(domain.id);
        let value = 0;

        switch (metric) {
          case 'users':
            value = stats.data?.userCount || 0;
            break;
          case 'devices':
            value = stats.data?.deviceCount || 0;
            break;
          case 'storage':
            value = stats.data?.storageUsed || 0;
            break;
          case 'requests':
            value = stats.data?.requestCount || 0;
            break;
        }

        return {
          id: domain.id,
          name: domain.name,
          value,
        };
      })
    );

    // 排序并限制数量
    rankings.sort((a, b) => b.value - a.value);
    return rankings.slice(0, limit);
  }

  /**
   * 获取用户排行
   */
  private async getUserRanking(metric: string, limit: number): Promise<RankingItem[]> {
    // 根据不同指标获取用户排行
    switch (metric) {
      case 'devices':
        const deviceUsers = await this.callServiceAPI('device-service', '/api/stats/users/devices', []);
        return deviceUsers.slice(0, limit).map((u: any) => ({
          id: u.userId,
          name: u.username || u.userId,
          value: u.deviceCount,
        }));

      case 'storage':
        const storageUsers = await this.callServiceAPI('storage-service', '/api/stats/users/storage', []);
        return storageUsers.slice(0, limit).map((u: any) => ({
          id: u.userId,
          name: u.username || u.userId,
          value: u.storageUsed,
        }));

      default:
        return [];
    }
  }

  /**
   * 获取设备排行
   */
  private async getDeviceRanking(metric: string, limit: number): Promise<RankingItem[]> {
    switch (metric) {
      case 'requests':
        const devices = await this.callServiceAPI('device-service', '/api/stats/devices/requests', []);
        return devices.slice(0, limit).map((d: any) => ({
          id: d.deviceId,
          name: d.deviceName || d.deviceId,
          value: d.requestCount,
        }));

      case 'storage':
        const storageDevices = await this.callServiceAPI('storage-service', '/api/stats/devices/storage', []);
        return storageDevices.slice(0, limit).map((d: any) => ({
          id: d.deviceId,
          name: d.deviceName || d.deviceId,
          value: d.storageUsed,
        }));

      default:
        return [];
    }
  }

  /**
   * 获取域对比数据
   */
  @Get('/domains/compare')
  @ApiOperation({
    summary: '获取域对比数据',
    description: '对比多个域的统计数据'
  })
  @ApiQuery({ name: 'domainIds', description: '域ID列表，逗号分隔', required: true })
  async compareDomains(@Query('domainIds') domainIds: string) {
    try {
      const ids = domainIds.split(',').map(id => id.trim());
      const comparisons = await Promise.all(
        ids.map(async (domainId) => {
          const stats = await this.domainService.getDomainStatistics(domainId);
          const domain = await this.domainRepository.findOne({
            where: { id: domainId } as any,
          });

          return {
            domainId,
            domainName: domain?.name || domainId,
            ...stats.data,
          };
        })
      );

      return successResponse(comparisons);
    } catch (error: any) {
      this.ctx.logger?.error('[StatisticsController] Compare domains error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取域对比数据失败');
    }
  }

  /**
   * 获取自定义统计报表
   */
  @Get('/report/custom')
  @ApiOperation({
    summary: '获取自定义统计报表',
    description: '根据指定维度生成自定义统计报表'
  })
  @ApiQuery({ name: 'dimensions', description: '统计维度，逗号分隔', required: true, example: 'domain,service,time' })
  @ApiQuery({ name: 'metrics', description: '统计指标，逗号分隔', required: true, example: 'users,devices,storage' })
  @ApiQuery({ name: 'startDate', description: '开始日期 (ISO 8601)', required: true })
  @ApiQuery({ name: 'endDate', description: '结束日期 (ISO 8601)', required: true })
  async getCustomReport(
    @Query('dimensions') dimensions: string,
    @Query('metrics') metrics: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string
  ) {
    try {
      const dims = dimensions.split(',');
      const mets = metrics.split(',');

      // 这里可以实现更复杂的报表生成逻辑
      const report: {
        dimensions: string[];
        metrics: string[];
        period: { startDate: string; endDate: string };
        data: Array<{ dimension: string; metric: string; value: number }>;
      } = {
        dimensions: dims,
        metrics: mets,
        period: { startDate, endDate },
        data: [],
      };

      // 根据维度和指标收集数据
      for (const dim of dims) {
        for (const met of mets) {
          const value = await this.getMetricByDimension(dim, met, startDate, endDate);
          report.data.push({
            dimension: dim,
            metric: met,
            value,
          });
        }
      }

      return successResponse(report);
    } catch (error: any) {
      this.ctx.logger?.error('[StatisticsController] Get custom report error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取自定义报表失败');
    }
  }

  /**
   * 根据维度获取指标值
   */
  private async getMetricByDimension(
    dimension: string,
    metric: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    try {
      // 调用相应服务获取数据
      const service = this.getServiceForMetric(metric);
      const endpoint = `/api/stats/${dimension}/${metric}`;

      const result = await this.callServiceAPI(
        service,
        endpoint,
        0
      );

      return result || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 获取指标对应的服务
   */
  private getServiceForMetric(metric: string): string {
    const serviceMap: Record<string, string> = {
      'users': 'user-service',
      'devices': 'device-service',
      'storage': 'storage-service',
      'requests': 'api-gateway',
    };

    return serviceMap[metric] || 'admin-service';
  }
}
