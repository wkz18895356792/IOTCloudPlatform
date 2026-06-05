import { Controller, Get, Post, Query, Param, Body, Inject, Logger } from '@midwayjs/core';
import { ApiOperation, ApiTags, ApiResponse, ApiQuery, ApiParam } from '@midwayjs/swagger';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';
import { HealthCheckService, ServiceHealth } from '../service/health-check.service';
import { MetricsService, RealtimeStats, PerformanceMetrics } from '../service/metrics.service';
import { AlertService, Alert, AlertSeverity, AlertStatus, AlertType } from '../service/alert.service';
import { SystemLogService, LogLevel, SystemLog, LogQuery } from '../service/system-log.service';

/**
 * 告警查询参数
 */
interface AlertQuery {
  severity?: AlertSeverity;
  status?: AlertStatus;
  service?: string;
  type?: AlertType;
  page?: number;
  pageSize?: number;
}

/**
 * 系统监控控制器
 *
 * 提供系统监控、健康检查、告警管理和日志查询功能
 */
@ApiTags('系统监控')
@Controller('/api/admin/monitoring')
export class MonitoringController {
  @Logger()
  logger: any;

  @Inject()
  healthCheckService!: HealthCheckService;

  @Inject()
  metricsService!: MetricsService;

  @Inject()
  alertService!: AlertService;

  @Inject()
  systemLogService!: SystemLogService;

  // ==================== 健康检查 ====================

  /**
   * 获取服务健康状态
   */
  @Get('/health')
  @ApiOperation({ summary: '获取服务健康状态', description: '获取所有微服务和基础设施的健康状态' })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              serviceName: { type: 'string' },
              status: { type: 'string', enum: ['healthy', 'degraded', 'down'] },
              uptime: { type: 'number' },
              lastCheck: { type: 'string', format: 'date-time' },
              responseTime: { type: 'number' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async getServiceHealth() {
    try {
      const services = await this.healthCheckService.checkAllServices();

      // 检查服务健康状态变化并创建告警
      for (const service of services) {
        if (service.status === 'down' || service.status === 'degraded') {
          await this.alertService.handleServiceHealthChange(service.serviceName, service.status);
        }
      }

      return successResponse(services);
    } catch (error: any) {
      this.logger?.error('[MonitoringController] Failed to get service health:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取服务健康状态失败');
    }
  }

  /**
   * 获取单个服务健康状态
   */
  @Get('/health/:serviceName')
  @ApiOperation({ summary: '获取单个服务健康状态', description: '获取指定服务的健康状态' })
  @ApiParam({ name: 'serviceName', description: '服务名称', example: 'api-gateway' })
  async getServiceHealthByName(@Param('serviceName') serviceName: string) {
    try {
      const service = await this.healthCheckService.checkServiceByName(serviceName);

      if (!service) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '服务不存在');
      }

      return successResponse(service);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取服务健康状态失败');
    }
  }

  /**
   * 获取系统资源使用情况
   */
  @Get('/system/resources')
  @ApiOperation({ summary: '获取系统资源使用情况', description: '获取CPU、内存、磁盘等系统资源使用情况' })
  async getSystemResources() {
    try {
      const metrics = await this.healthCheckService.getSystemMetrics();

      return successResponse(metrics);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取系统资源失败');
    }
  }

  // ==================== 性能指标 ====================

  /**
   * 获取性能指标
   */
  @Get('/metrics')
  @ApiOperation({ summary: '获取性能指标', description: '获取指定时间段的性能指标数据' })
  @ApiQuery({ name: 'startDate', description: '开始日期 (ISO 8601)', required: true, example: '2024-01-01' })
  @ApiQuery({ name: 'endDate', description: '结束日期 (ISO 8601)', required: true, example: '2024-01-31' })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            period: {
              type: 'object',
              properties: {
                startDate: { type: 'string' },
                endDate: { type: 'string' },
              },
            },
            metrics: {
              type: 'object',
              properties: {
                requests: {
                  type: 'object',
                  properties: {
                    total: { type: 'number' },
                    success: { type: 'number' },
                    error: { type: 'number' },
                    avgResponseTime: { type: 'number' },
                  },
                },
                resources: {
                  type: 'object',
                  properties: {
                    cpu: { type: 'number' },
                    memory: { type: 'number' },
                    disk: { type: 'number' },
                    network: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  async getPerformanceMetrics(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string
  ) {
    try {
      const metrics = await this.metricsService.getPerformanceMetrics(startDate, endDate);

      return successResponse(metrics);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取性能指标失败');
    }
  }

  /**
   * 获取实时统计数据
   */
  @Get('/metrics/realtime')
  @ApiOperation({ summary: '获取实时统计数据', description: '获取当前系统实时统计数据' })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            onlineUsers: { type: 'number' },
            activeDevices: { type: 'number' },
            requestsPerSecond: { type: 'number' },
            avgResponseTime: { type: 'number' },
            cpuUsage: { type: 'number' },
            memoryUsage: { type: 'number' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  async getRealtimeMetrics() {
    try {
      const stats = await this.metricsService.getRealtimeStats();

      return successResponse(stats);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取实时统计失败');
    }
  }

  /**
   * 获取趋势数据
   */
  @Get('/metrics/trend')
  @ApiOperation({ summary: '获取趋势数据', description: '获取指定指标的趋势数据' })
  @ApiQuery({ name: 'metric', description: '指标类型', enum: ['users', 'devices', 'storage', 'requests'], required: true })
  @ApiQuery({ name: 'startDate', description: '开始日期 (ISO 8601)', required: true })
  @ApiQuery({ name: 'endDate', description: '结束日期 (ISO 8601)', required: true })
  @ApiQuery({ name: 'groupBy', description: '分组方式', enum: ['hour', 'day', 'week'], required: false, example: 'day' })
  async getTrendData(
    @Query('metric') metric: 'users' | 'devices' | 'storage' | 'requests',
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('groupBy') groupBy: 'hour' | 'day' | 'week' = 'day'
  ) {
    try {
      const trend = await this.metricsService.getTrendData(metric, startDate, endDate, groupBy);

      return successResponse(trend);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取趋势数据失败');
    }
  }

  /**
   * 获取Prometheus格式的指标
   */
  @Get('/metrics/prometheus')
  @ApiOperation({ summary: '获取Prometheus格式指标', description: '导出Prometheus格式的监控指标' })
  async getPrometheusMetrics() {
    try {
      const metrics = await this.metricsService.exportPrometheusMetrics();

      // 直接返回文本格式的指标
      return metrics;
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '导出指标失败');
    }
  }

  // ==================== 告警管理 ====================

  /**
   * 获取告警列表
   */
  @Get('/alerts')
  @ApiOperation({ summary: '获取告警列表', description: '获取系统告警列表，支持过滤和分页' })
  @ApiQuery({ name: 'severity', description: '严重程度', enum: ['info', 'warning', 'error', 'critical'], required: false })
  @ApiQuery({ name: 'status', description: '状态', enum: ['active', 'acknowledged', 'resolved'], required: false })
  @ApiQuery({ name: 'service', description: '服务名称', required: false })
  @ApiQuery({ name: 'type', description: '告警类型', required: false })
  @ApiQuery({ name: 'page', description: '页码', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', description: '每页数量', required: false, example: 20 })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            alerts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  severity: { type: 'string' },
                  type: { type: 'string' },
                  title: { type: 'string' },
                  message: { type: 'string' },
                  service: { type: 'string' },
                  status: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' },
                  count: { type: 'number' },
                },
              },
            },
            total: { type: 'number' },
          },
        },
      },
    },
  })
  async getAlerts(@Query() query: AlertQuery) {
    try {
      const { alerts, total } = await this.alertService.getAlerts(query);

      return successResponse({ alerts, total });
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取告警列表失败');
    }
  }

  /**
   * 获取告警统计
   */
  @Get('/alerts/stats')
  @ApiOperation({ summary: '获取告警统计', description: '获取告警的统计数据' })
  async getAlertStats() {
    try {
      const stats = await this.alertService.getAlertStats();

      return successResponse(stats);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取告警统计失败');
    }
  }

  /**
   * 获取告警趋势
   */
  @Get('/alerts/trend')
  @ApiOperation({ summary: '获取告警趋势', description: '获取最近几天的告警趋势数据' })
  @ApiQuery({ name: 'days', description: '天数', required: false, example: 7 })
  async getAlertTrend(@Query('days') days: number = 7) {
    try {
      const trend = await this.alertService.getAlertTrend(days);

      return successResponse(trend);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取告警趋势失败');
    }
  }

  /**
   * 确认告警
   */
  @Post('/alerts/:alertId/acknowledge')
  @ApiOperation({ summary: '确认告警', description: '确认指定的告警，标记为已处理' })
  @ApiParam({ name: 'alertId', description: '告警ID', example: 'alert-123' })
  async acknowledgeAlert(
    @Param('alertId') alertId: string,
    @Body() body: { userId?: string; notes?: string }
  ) {
    try {
      const result = await this.alertService.acknowledgeAlert(
        alertId,
        body.userId || 'admin',
        body.notes
      );

      if (!result) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '告警不存在');
      }

      return successResponse(result, '告警已确认');
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '确认告警失败');
    }
  }

  /**
   * 解决告警
   */
  @Post('/alerts/:alertId/resolve')
  @ApiOperation({ summary: '解决告警', description: '解决指定的告警，标记为已解决' })
  @ApiParam({ name: 'alertId', description: '告警ID', example: 'alert-123' })
  async resolveAlert(
    @Param('alertId') alertId: string,
    @Body() body: { userId?: string }
  ) {
    try {
      const result = await this.alertService.resolveAlert(alertId, body.userId || 'admin');

      if (!result) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '告警不存在');
      }

      return successResponse(result, '告警已解决');
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '解决告警失败');
    }
  }

  /**
   * 获取告警规则
   */
  @Get('/alerts/rules')
  @ApiOperation({ summary: '获取告警规则', description: '获取所有告警规则' })
  async getAlertRules() {
    try {
      const rules = await this.alertService.getRules();

      return successResponse(rules);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取告警规则失败');
    }
  }

  /**
   * 更新告警规则
   */
  @Post('/alerts/rules/:ruleId')
  @ApiOperation({ summary: '更新告警规则', description: '更新指定的告警规则' })
  @ApiParam({ name: 'ruleId', description: '规则ID', example: 'rule-high-cpu' })
  async updateAlertRule(
    @Param('ruleId') ruleId: string,
    @Body() body: {
      enabled?: boolean;
      threshold?: number;
      duration?: number;
    }
  ) {
    try {
      const result = await this.alertService.updateRule(ruleId, body);

      if (!result) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '规则不存在');
      }

      return successResponse(result, '规则已更新');
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '更新规则失败');
    }
  }

  // ==================== 日志管理 ====================

  /**
   * 获取系统日志
   */
  @Get('/logs')
  @ApiOperation({ summary: '获取系统日志', description: '查询系统日志，支持多种过滤条件' })
  @ApiQuery({ name: 'service', description: '服务名称', required: false })
  @ApiQuery({ name: 'level', description: '日志级别', enum: ['debug', 'info', 'warn', 'error'], required: false })
  @ApiQuery({ name: 'startDate', description: '开始日期 (ISO 8601)', required: false })
  @ApiQuery({ name: 'endDate', description: '结束日期 (ISO 8601)', required: false })
  @ApiQuery({ name: 'keyword', description: '关键词搜索', required: false })
  @ApiQuery({ name: 'page', description: '页码', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', description: '每页数量', required: false, example: 20 })
  async getSystemLogs(@Query() query: LogQuery) {
    try {
      const result = await this.systemLogService.queryLogs(query);

      return successResponse(result);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取系统日志失败');
    }
  }

  /**
   * 获取日志统计
   */
  @Get('/logs/stats')
  @ApiOperation({ summary: '获取日志统计', description: '获取指定时间段的日志统计数据' })
  @ApiQuery({ name: 'startDate', description: '开始日期 (ISO 8601)', required: true })
  @ApiQuery({ name: 'endDate', description: '结束日期 (ISO 8601)', required: true })
  async getLogStats(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string
  ) {
    try {
      const stats = await this.systemLogService.getLogStats(
        new Date(startDate),
        new Date(endDate)
      );

      return successResponse(stats);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取日志统计失败');
    }
  }

  /**
   * 获取错误日志摘要
   */
  @Get('/logs/errors/summary')
  @ApiOperation({ summary: '获取错误日志摘要', description: '获取最近N小时的错误日志摘要' })
  @ApiQuery({ name: 'hours', description: '时间范围（小时）', required: false, example: 24 })
  async getErrorLogSummary(@Query('hours') hours: number = 24) {
    try {
      const summary = await this.systemLogService.getErrorLogSummary(hours);

      return successResponse(summary);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取错误摘要失败');
    }
  }

  /**
   * 获取日志详情
   */
  @Get('/logs/:logId')
  @ApiOperation({ summary: '获取日志详情', description: '获取指定日志的详细信息' })
  @ApiParam({ name: 'logId', description: '日志ID', example: 'log-123' })
  async getLogDetail(@Param('logId') logId: string) {
    try {
      const log = await this.systemLogService.getLogById(logId);

      if (!log) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '日志不存在');
      }

      return successResponse(log);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取日志详情失败');
    }
  }

  /**
   * 搜索日志
   */
  @Get('/logs/search')
  @ApiOperation({ summary: '搜索日志', description: '根据关键词搜索日志' })
  @ApiQuery({ name: 'keyword', description: '搜索关键词', required: true })
  @ApiQuery({ name: 'service', description: '服务名称', required: false })
  @ApiQuery({ name: 'level', description: '日志级别', enum: ['debug', 'info', 'warn', 'error'], required: false })
  @ApiQuery({ name: 'startDate', description: '开始日期 (ISO 8601)', required: false })
  @ApiQuery({ name: 'endDate', description: '结束日期 (ISO 8601)', required: false })
  async searchLogs(
    @Query('keyword') keyword: string,
    @Query('service') service?: string,
    @Query('level') level?: LogLevel,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    try {
      const logs = await this.systemLogService.searchLogs(keyword, {
        service,
        level,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      });

      return successResponse({ logs, total: logs.length });
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '搜索日志失败');
    }
  }

  /**
   * 导出日志
   */
  @Get('/logs/export')
  @ApiOperation({ summary: '导出日志', description: '导出日志到文件' })
  @ApiQuery({ name: 'format', description: '导出格式', enum: ['json', 'csv'], required: false, example: 'json' })
  @ApiQuery({ name: 'service', description: '服务名称', required: false })
  @ApiQuery({ name: 'level', description: '日志级别', enum: ['debug', 'info', 'warn', 'error'], required: false })
  @ApiQuery({ name: 'startDate', description: '开始日期 (ISO 8601)', required: false })
  @ApiQuery({ name: 'endDate', description: '结束日期 (ISO 8601)', required: false })
  async exportLogs(
    @Query('format') format: 'json' | 'csv' = 'json',
    @Query('service') service?: string,
    @Query('level') level?: LogLevel,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    try {
      const data = await this.systemLogService.exportLogs({
        service,
        level,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        page: 1,
        pageSize: 10000,
      }, format);

      return data;
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '导出日志失败');
    }
  }

  /**
   * 删除日志
   */
  @Post('/logs/delete')
  @ApiOperation({ summary: '删除日志', description: '批量删除指定的日志' })
  async deleteLogs(@Body() body: { logIds: string[] }) {
    try {
      const count = await this.systemLogService.deleteLogs(body.logIds);

      return successResponse({ count }, `已删除${count}条日志`);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '删除日志失败');
    }
  }
}
