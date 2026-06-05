/**
 * API 网关配置
 *
 * 定义网关的中间件、路由、服务发现、熔断器、速率限制等配置。
 *
 * 配置模块：
 * - 中间件配置：定义全局中间件和执行顺序
 * - 路由配置：控制器扫描路径
 * - 服务发现配置：预定义服务和服务路由
 * - 熔断器配置：默认阈值和特定服务配置
 * - 速率限制配置：全局规则和路径特定规则
 * - 请求日志配置：日志保留和脱敏设置
 * - JWT 配置：Token 签名和过期时间
 * - 代理配置：转发超时、重试等
 * - 健康检查配置：检查间隔和阈值
 * - 监控配置：指标收集间隔和类型
 */
import { Context } from '@midwayjs/koa';
import { AuthMiddleware } from '../middleware/auth.middleware';
import { RequestLoggerMiddleware } from '../middleware/request-logger.middleware';
import { CircuitBreakerMiddleware } from '../middleware/circuit-breaker.middleware';

// ==================== 安全配置验证 ====================
// JWT 密钥验证（必须至少 64 位）
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 64) {
  throw new Error(
    'JWT_SECRET must be at least 64 characters long. ' +
    'Please generate a secure secret using: openssl rand -base64 48'
  );
}

export default {
  // ==================== 核心配置 ====================

  // 跨域配置
  cors: {
    credentials: true,
    origin: (ctx: Context) => {
      const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'http://localhost:3003',
        'http://localhost:3004',
        'http://localhost:3005',
        'http://localhost:5173',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3005',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:8080',
        'http://127.0.0.1:8088',
      ];
      const requestOrigin = ctx.get('Origin');
      return allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
    },
  },

  // ==================== 中间件配置 ====================

  // 全局中间件
  middleware: [
    // 抓取错误中间件（必须第一个）
    'formatMiddleware',
    // 请求日志中间件
    RequestLoggerMiddleware,
    // JWT认证中间件 - 验证Token并设置ctx.state.user
    AuthMiddleware,
    // 熔断器中间件
    CircuitBreakerMiddleware,
  ],

  // ==================== 路由配置 ====================

  // 路由扫描
  router: {
    // 扫描controller目录
    controllerDir: [
      'controller',
      'gateway',
    ],
  },

  // ==================== 服务发现配置 ====================

  serviceDiscovery: {
    // 服务注册TTL（秒）
    defaultTTL: 30,

    // 心跳超时（毫秒）
    heartbeatTimeout: 60000,

    // 选择策略
    selectionStrategy: 'round-robin', // round-robin | random | least-connections | weighted

    // 预定义服务
    predefinedServices: {
      'user-service': {
        url: 'http://localhost:6002',
        healthCheckUrl: '/health',
      },
      'device-service': {
        url: 'http://localhost:6003',
        healthCheckUrl: '/health',
      },
      'video-service': {
        url: 'http://localhost:6004',
        healthCheckUrl: '/health',
      },
      'storage-service': {
        url: 'http://localhost:6005',
        healthCheckUrl: '/health',
      },
      'baby-service': {
        url: 'http://localhost:6008',
        healthCheckUrl: '/health',
      },
      'admin-service': {
        url: 'http://localhost:6009',
        healthCheckUrl: '/health',
      },
      'device-gateway': {
        url: 'http://localhost:6010',
        healthCheckUrl: '/health',
      },
    },

    // 服务路由
    routes: [
      {
        path: '/api/devices/*',
        serviceName: 'device-service',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        stripPath: false,
        timeout: 30000,
        retries: 3,
      },
      {
        path: '/api/videos/*',
        serviceName: 'video-service',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        stripPath: false,
        timeout: 30000,
        retries: 2,
      },
      {
        path: '/api/storage/*',
        serviceName: 'storage-service',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        stripPath: false,
        timeout: 60000,
        retries: 3,
      },
      {
        path: '/api/users/*',
        serviceName: 'user-service',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        stripPath: false,
        timeout: 30000,
        retries: 3,
      },
    ],
  },

  // ==================== 熔断器配置 ====================

  circuitBreaker: {
    // 默认配置
    defaultConfig: {
      failureThreshold: 5, // 失败阈值
      successThreshold: 2, // 成功阈值（半开状态）
      timeout: 60000, // 熔断超时时间（毫秒）
      monitoringPeriod: 10000, // 监控周期（毫秒）
      halfOpenMaxCalls: 3, // 半开状态最大调用次数
    },

    // 特定服务配置
    serviceConfigs: {
      'device-service': {
        failureThreshold: 5,
        timeout: 30000,
      },
      'video-service': {
        failureThreshold: 3,
        timeout: 60000,
      },
      'storage-service': {
        failureThreshold: 5,
        timeout: 60000,
      },
    },
  },

  // ==================== 速率限制配置 ====================

  rateLimit: {
    // 全局默认配置
    defaultConfig: {
      windowMs: 60000, // 1分钟
      maxRequests: 100,
    },

    // IP限制配置
    ipConfig: {
      windowMs: 60000,
      maxRequests: 200,
    },

    // 用户限制配置
    userConfig: {
      windowMs: 60000,
      maxRequests: 100,
    },

    // 特定路径规则
    rules: [
      {
        pattern: '/api/auth/*',
        windowMs: 60000,
        maxRequests: 10, // 认证接口严格限制
        priority: 10,
      },
      {
        pattern: '/api/gateway/*',
        windowMs: 60000,
        maxRequests: 50, // 管理接口限制
        priority: 9,
      },
      {
        pattern: '/api/videos/*',
        windowMs: 60000,
        maxRequests: 200, // 流媒体接口允许更多
        priority: 5,
      },
      {
        pattern: '/api/storage/*',
        windowMs: 60000,
        maxRequests: 150,
        priority: 5,
      },
    ],

    // 白名单路径
    whitelist: [
      '/health',
      '/api/health',
      '/api/gateway/health',
    ],
  },

  // ==================== 请求日志配置 ====================

  requestLogger: {
    // 日志保留天数
    retentionDays: 7,

    // 是否记录请求体
    logBody: true,

    // 是否记录响应体
    logResponseBody: false,

    // 是否记录查询参数
    logQuery: true,

    // 慢请求阈值（毫秒）
    slowRequestThreshold: 3000,

    // 敏感字段（脱敏）
    sensitiveFields: [
      'password',
      'token',
      'secret',
      'apiKey',
      'authorization',
    ],
  },

  // ==================== JWT配置 ====================

  jwt: {
    secret: jwtSecret, // JWT 签名密钥（已验证长度）
    expire: process.env.JWT_EXPIRE || '7d',
  },

  // ==================== 代理配置 ====================

  proxy: {
    // 默认超时时间（毫秒）
    timeout: 30000,

    // 默认重试次数
    retries: 3,

    // 连接池大小
    maxSockets: 100,

    // 保持活跃
    keepAlive: true,

    // 保持活跃超时（毫秒）
    keepAliveTimeout: 60000,

    // 请求头转发
    forwardHeaders: [
      'Authorization',
      'Content-Type',
      'User-Agent',
      'X-Request-ID',
      'X-Forwarded-For',
      'X-Real-IP',
    ],

    // 响应头转发
    forwardResponseHeaders: [
      'Content-Type',
      'Cache-Control',
      'ETag',
      'Last-Modified',
    ],
  },

  // ==================== 健康检查配置 ====================

  healthCheck: {
    // 检查间隔（毫秒）
    interval: 30000,

    // 超时时间（毫秒）
    timeout: 5000,

    // 失败阈值
    unhealthyThreshold: 3,

    // 恢复阈值
    healthyThreshold: 2,
  },

  // ==================== 监控配置 ====================

  monitoring: {
    // 是否启用监控
    enabled: true,

    // 指标收集间隔（毫秒）
    collectInterval: 60000,

    // 监控指标
    metrics: [
      'requests_total',
      'requests_duration',
      'requests_by_path',
      'requests_by_status',
      'circuit_breaker_state',
      'service_instances',
      'rate_limit_hits',
    ],
  },
};
