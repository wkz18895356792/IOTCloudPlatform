/**
 * API 网关管理控制器
 *
 * 提供网关配置、监控和管理的 REST API。
 * 包含速率限制、日志、熔断器、服务发现等功能的管理接口。
 *
 * 主要功能模块：
 * - 速率限制管理：添加/移除规则、查询统计、重置限制
 * - 日志管理：查询访问日志、获取统计、清理旧日志
 * - 熔断器管理：注册服务、查询状态、手动控制
 * - 服务发现管理：注册/注销服务、查询实例、路由管理
 * - 综合接口：获取网关整体状态和配置
 */
import { Controller, Get, Post, Put, Del, Patch, Param, Body, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';
import { RateLimitService } from '../service/rate-limit.service';
import { RequestLoggerService } from '../service/request-logger.service';
import { CircuitBreakerService } from '../service/circuit-breaker.service';
import { ServiceDiscoveryService } from '../service/service-discovery.service';

/**
 * API 网关管理控制器类
 *
 * 所有接口都位于 /api/gateway 路径下。
 * 部分管理接口可能需要管理员权限。
 */
@ApiTags('API Gateway')
@Controller('/api/gateway')
export class ApiGatewayController {
  @Inject()
  ctx!: Context;

  @Inject()
  rateLimitService!: RateLimitService;

  @Inject()
  requestLoggerService!: RequestLoggerService;

  @Inject()
  circuitBreakerService!: CircuitBreakerService;

  @Inject()
  serviceDiscoveryService!: ServiceDiscoveryService;

  // ==================== 速率限制管理 ====================
  // 速率限制规则管理接口，用于配置和查询 API 速率限制

  /**
   * 添加速率限制规则
   *
   * 为指定 URL 模式添加速率限制规则。
   * 规则按优先级排序，高优先级规则先匹配。
   */
  @ApiOperation({ summary: '添加速率限制规则', description: '为指定URL模式添加速率限制规则' })
  @ApiBody({
    description: '速率限制规则',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', example: '/api/devices/*', description: 'URL匹配模式' },
        windowMs: { type: 'number', example: 60000, description: '时间窗口（毫秒）' },
        maxRequests: { type: 'number', example: 100, description: '最大请求数' },
        priority: { type: 'number', example: 5, description: '优先级' }
      },
      required: ['pattern', 'windowMs', 'maxRequests']
    }
  })
  async addRateLimitRule(@Body() body: {
    pattern: string;
    windowMs: number;
    maxRequests: number;
    priority?: number;
  }) {
    this.rateLimitService.addRule({
      pattern: body.pattern,
      config: {
        windowMs: body.windowMs,
        maxRequests: body.maxRequests,
      },
      priority: body.priority,
    });

    return successResponse(null, 'Rate limit rule added');
  }

  /**
   * 移除速率限制规则
   */
  @Del('/ratelimit/rules/:pattern')
  @ApiOperation({ summary: '移除速率限制规则', description: '根据URL模式移除速率限制规则' })
  @ApiParam({ name: 'pattern', description: 'URL匹配模式', example: '/api/devices/*' })
  async removeRateLimitRule(@Param('pattern') pattern: string) {
    const removed = this.rateLimitService.removeRule(pattern);

    if (!removed) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '规则不存在');
    }

    return successResponse(null, 'Rule removed');
  }

  /**
   * 获取所有速率限制规则
   */
  @Get('/ratelimit/rules')
  @ApiOperation({ summary: '获取所有速率限制规则', description: '获取所有已配置的速率限制规则列表' })
  async getRateLimitRules() {
    const rules = this.rateLimitService.getRules();

    return successResponse(rules);
  }

  /**
   * 重置用户速率限制
   */
  @Post('/ratelimit/reset')
  async resetUserRateLimit(@Body() body: { identifier: string; endpoint: string }) {
    await this.rateLimitService.resetLimit(body.identifier, body.endpoint);

    return successResponse(null, 'Rate limit reset');
  }

  /**
   * 获取用户速率限制统计
   */
  @Get('/ratelimit/stats/:userId')
  async getUserRateLimitStats(@Param('userId') userId: string) {
    const stats = await this.rateLimitService.getUserStats(userId);

    return successResponse(stats);
  }

  /**
   * 获取全局速率限制统计
   */
  @Get('/ratelimit/stats')
  async getGlobalRateLimitStats() {
    const stats = await this.rateLimitService.getGlobalStats();

    return successResponse(stats);
  }

  /**
   * 批量设置速率限制
   */
  @Post('/ratelimit/batch')
  async batchSetRateLimits(@Body() body: {
    items: Array<{ identifier: string; endpoint: string; maxRequests: number; windowMs?: number }>;
  }) {
    await this.rateLimitService.setBatchLimits(body.items);

    return successResponse(null, `Set limits for ${body.items.length} items`);
  }

  // ==================== 日志管理 ====================
  // 请求日志查询和统计接口

  /**
   * 查询访问日志
   *
   * 根据多种条件查询访问日志，支持时间范围、方法、路径、用户等过滤。
   * 支持分页查询。
   */
  async queryAccessLogs(@Query() query: {
    startTime?: string;
    endTime?: string;
    method?: string;
    path?: string;
    userId?: string;
    statusCode?: string;
    minDuration?: string;
    maxDuration?: string;
    limit?: string;
    offset?: string;
  }) {
    const logs = await this.requestLoggerService.queryLogs({
      startTime: query.startTime ? parseInt(query.startTime) : undefined,
      endTime: query.endTime ? parseInt(query.endTime) : undefined,
      method: query.method,
      path: query.path,
      userId: query.userId,
      statusCode: query.statusCode ? parseInt(query.statusCode) : undefined,
      minDuration: query.minDuration ? parseInt(query.minDuration) : undefined,
      maxDuration: query.maxDuration ? parseInt(query.maxDuration) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });

    return successResponse(logs);
  }

  /**
   * 获取日志统计
   */
  @Get('/logs/statistics')
  async getLogStatistics(@Query('period') period: 'hour' | 'day' | 'week' = 'hour') {
    const stats = await this.requestLoggerService.getStatistics(period);

    return successResponse(stats);
  }

  /**
   * 获取实时统计
   */
  @Get('/logs/realtime')
  async getRealTimeStats() {
    const stats = await this.requestLoggerService.getRealTimeStats();

    return successResponse(stats);
  }

  /**
   * 获取用户活动日志
   */
  @Get('/logs/activity/:userId')
  async getUserActivity(@Param('userId') userId: string, @Query('limit') limit?: string) {
    const logs = await this.requestLoggerService.getUserActivity(userId, limit ? parseInt(limit) : 100);

    return successResponse(logs);
  }

  /**
   * 获取慢请求
   */
  @Get('/logs/slow')
  async getSlowRequests(@Query('minDuration') minDuration?: string) {
    const logs = await this.requestLoggerService.getSlowRequests(
      minDuration ? parseInt(minDuration) : 3000
    );

    return successResponse(logs);
  }

  /**
   * 清理旧日志
   */
  @Post('/logs/cleanup')
  async cleanupLogs(@Body() body: { retentionDays?: number }) {
    const cleaned = await this.requestLoggerService.cleanupOldLogs(body.retentionDays);

    return successResponse({ cleaned }, `Cleaned up ${cleaned} old logs`);
  }

  // ==================== 熔断器管理 ====================
  // 服务熔断器配置和状态管理接口

  /**
   * 注册熔断器服务
   *
   * 为指定服务配置熔断器，可自定义失败阈值、超时等参数。
   */
  async registerCircuitService(@Body() body: {
    service: string;
    failureThreshold?: number;
    successThreshold?: number;
    timeout?: number;
    monitoringPeriod?: number;
    halfOpenMaxCalls?: number;
  }) {
    this.circuitBreakerService.registerService(body.service, body);

    return successResponse(null, `Registered service: ${body.service}`);
  }

  /**
   * 获取熔断器状态
   */
  @Get('/circuit/status/:service')
  async getCircuitStatus(@Param('service') service: string) {
    const status = await this.circuitBreakerService.getStatus(service);

    if (!status) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '服务不存在');
    }

    return successResponse(status);
  }

  /**
   * 获取所有熔断器状态
   */
  @Get('/circuit/status')
  async getAllCircuitStatuses() {
    const statuses = await this.circuitBreakerService.getAllStatuses();

    return successResponse(statuses);
  }

  /**
   * 获取熔断器统计
   */
  @Get('/circuit/statistics/:service')
  async getCircuitStatistics(@Param('service') service: string) {
    const stats = await this.circuitBreakerService.getStatistics(service);

    if (!stats) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '服务不存在');
    }

    return successResponse(stats);
  }

  /**
   * 重置熔断器
   */
  @Post('/circuit/reset/:service')
  async resetCircuitBreaker(@Param('service') service: string) {
    const reset = await this.circuitBreakerService.reset(service);

    if (!reset) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '服务不存在');
    }

    return successResponse(null, `Reset circuit breaker for ${service}`);
  }

  /**
   * 手动打开熔断器
   */
  @Post('/circuit/open/:service')
  async openCircuitBreaker(@Param('service') service: string) {
    const opened = await this.circuitBreakerService.open(service);

    if (!opened) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '服务不存在');
    }

    return successResponse(null, `Opened circuit breaker for ${service}`);
  }

  /**
   * 手动关闭熔断器
   */
  @Post('/circuit/close/:service')
  async closeCircuitBreaker(@Param('service') service: string) {
    const closed = await this.circuitBreakerService.close(service);

    if (!closed) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '服务不存在');
    }

    return successResponse(null, `Closed circuit breaker for ${service}`);
  }

  /**
   * 更新熔断器配置
   */
  @Patch('/circuit/config/:service')
  async updateCircuitConfig(
    @Param('service') service: string,
    @Body() body: {
      failureThreshold?: number;
      successThreshold?: number;
      timeout?: number;
      monitoringPeriod?: number;
      halfOpenMaxCalls?: number;
    }
  ) {
    this.circuitBreakerService.updateConfig(service, body);

    return successResponse(null, `Updated config for ${service}`);
  }

  /**
   * 移除熔断器服务
   */
  @Del('/circuit/services/:service')
  async removeCircuitService(@Param('service') service: string) {
    const removed = await this.circuitBreakerService.removeService(service);

    return successResponse(null, `Removed service: ${service}`);
  }

  /**
   * 获取全局熔断器统计
   */
  @Get('/circuit/statistics')
  async getGlobalCircuitStatistics() {
    const stats = await this.circuitBreakerService.getGlobalStatistics();

    return successResponse(stats);
  }

  // ==================== 服务发现管理 ====================
  // 服务注册、发现和路由管理接口

  /**
   * 注册服务实例
   *
   * 将新的服务实例注册到服务发现中心。
   * 实例会定期发送心跳保持活跃状态。
   */
  async registerService(@Body() body: {
    name: string;
    host: string;
    port: number;
    protocol?: 'http' | 'https';
    healthCheckUrl?: string;
    metadata?: Record<string, any>;
    ttl?: number;
  }) {
    const instanceId = await this.serviceDiscoveryService.register(body);

    return successResponse({ instanceId }, `Registered service: ${body.name}`);
  }

  /**
   * 注销服务实例
   */
  @Del('/discovery/services/:instanceId')
  async deregisterService(@Param('instanceId') instanceId: string) {
    const deregistered = await this.serviceDiscoveryService.deregister(instanceId);

    if (!deregistered) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '实例不存在');
    }

    return successResponse(null, `Deregistered instance: ${instanceId}`);
  }

  /**
   * 服务心跳
   */
  @Post('/discovery/heartbeat/:instanceId')
  async heartbeat(@Param('instanceId') instanceId: string) {
    const success = await this.serviceDiscoveryService.heartbeat(instanceId);

    if (!success) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '实例不存在');
    }

    return successResponse(null, 'Heartbeat recorded');
  }

  /**
   * 发现服务
   */
  @Get('/discovery/services/:serviceName')
  async discoverService(@Param('serviceName') serviceName: string) {
    const instances = await this.serviceDiscoveryService.discover(serviceName);

    return successResponse(instances);
  }

  /**
   * 获取所有服务
   */
  @Get('/discovery/services')
  async getAllServices() {
    const services = await this.serviceDiscoveryService.getAllServices();

    return successResponse(services);
  }

  /**
   * 获取服务状态
   */
  @Get('/discovery/status/:serviceName')
  async getServiceStatus(@Param('serviceName') serviceName: string) {
    const status = await this.serviceDiscoveryService.getServiceStatus(serviceName);

    if (!status) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '服务不存在');
    }

    return successResponse(status);
  }

  /**
   * 获取服务URL
   */
  @Get('/discovery/url/:serviceName')
  async getServiceUrl(
    @Param('serviceName') serviceName: string,
    @Query('strategy') strategy?: 'round-robin' | 'random' | 'least-connections' | 'weighted'
  ) {
    const url = await this.serviceDiscoveryService.getServiceUrl(serviceName, strategy);

    if (!url) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '没有可用实例');
    }

    return successResponse({ url, serviceName });
  }

  /**
   * 更新实例元数据
   */
  @Patch('/discovery/metadata/:instanceId')
  async updateInstanceMetadata(
    @Param('instanceId') instanceId: string,
    @Body() body: { metadata: Record<string, any> }
  ) {
    const updated = await this.serviceDiscoveryService.updateInstanceMetadata(instanceId, body.metadata);

    if (!updated) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '实例不存在');
    }

    return successResponse(null, 'Metadata updated');
  }

  /**
   * 设置实例状态
   */
  @Patch('/discovery/status/:instanceId')
  async setInstanceStatus(
    @Param('instanceId') instanceId: string,
    @Body() body: { status: 'healthy' | 'unhealthy' | 'draining' }
  ) {
    const updated = await this.serviceDiscoveryService.setInstanceStatus(instanceId, body.status);

    if (!updated) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '实例不存在');
    }

    return successResponse(null, 'Status updated');
  }

  /**
   * 清理不健康实例
   */
  @Post('/discovery/cleanup')
  async cleanupUnhealthyInstances() {
    const cleaned = await this.serviceDiscoveryService.cleanupUnhealthyInstances();

    return successResponse({ cleaned }, `Cleaned up ${cleaned} unhealthy instances`);
  }

  /**
   * 创建服务路由
   */
  @Post('/discovery/routes')
  async createRoute(@Body() body: {
    path: string;
    serviceName: string;
    methods: string[];
    stripPath?: boolean;
    timeout?: number;
    retries?: number;
  }) {
    await this.serviceDiscoveryService.createRoute(body);

    return successResponse(null, `Created route: ${body.path}`);
  }

  /**
   * 删除服务路由
   */
  @Del('/discovery/routes/:path')
  async removeRoute(@Param('path') path: string) {
    const removed = await this.serviceDiscoveryService.removeRoute(path);

    if (!removed) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '路由不存在');
    }

    return successResponse(null, `Removed route: ${path}`);
  }

  /**
   * 获取所有路由
   */
  @Get('/discovery/routes')
  async getAllRoutes() {
    const routes = await this.serviceDiscoveryService.getAllRoutes();

    return successResponse(routes);
  }

  /**
   * 获取全局统计
   */
  @Get('/discovery/statistics')
  async getDiscoveryStatistics() {
    const stats = await this.serviceDiscoveryService.getGlobalStatistics();

    return successResponse(stats);
  }

  // ==================== 综合接口 ====================
  // 网关整体状态和配置查询接口

  /**
   * 获取网关整体状态
   *
   * 返回网关的运行状态、资源使用情况和各模块统计数据。
   * 包括运行时间、内存使用、速率限制、熔断器、服务发现等信息。
   */
  async getGatewayStatus() {
    const [rateLimitStats, circuitStats, discoveryStats, realtimeStats] = await Promise.all([
      this.rateLimitService.getGlobalStats(),
      this.circuitBreakerService.getGlobalStatistics(),
      this.serviceDiscoveryService.getGlobalStatistics(),
      this.requestLoggerService.getRealTimeStats(),
    ]);

    return successResponse({
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      rateLimit: rateLimitStats,
      circuitBreaker: circuitStats,
      serviceDiscovery: discoveryStats,
      realtime: realtimeStats,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 网关健康检查
   */
  @Get('/health')
  @ApiOperation({ summary: '网关健康检查' })
  @ApiResponse({
    status: 200,
    description: '网关健康状态',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        timestamp: { type: 'string', example: '2024-01-01T00:00:00.000Z' },
        services: {
          type: 'object',
          properties: {
            totalServices: { type: 'number' },
            openCircuits: { type: 'number' },
            healthyServices: { type: 'number' },
          },
        },
      },
    },
  })
  async healthCheck() {
    const statuses = await this.circuitBreakerService.getAllStatuses();

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        totalServices: statuses.length,
        openCircuits: statuses.filter(s => s.state === 'open').length,
        healthyServices: statuses.filter(s => s.state === 'closed').length,
      },
    };
  }

  /**
   * 获取配置
   */
  @Get('/config')
  async getGatewayConfig() {
    const [rateLimitRules, circuitStatuses, discoveryServices] = await Promise.all([
      this.rateLimitService.getRules(),
      this.circuitBreakerService.getAllStatuses(),
      this.serviceDiscoveryService.getAllServices(),
    ]);

    return successResponse({
      rateLimit: {
        rules: rateLimitRules,
      },
      circuitBreaker: {
        services: circuitStatuses,
      },
      serviceDiscovery: {
        services: discoveryServices,
      },
    });
  }
}
