/**
 * 请求日志服务
 *
 * 负责记录和存储 API 网关的所有请求和响应日志。
 * 提供日志查询、统计分析和监控功能。
 *
 * 主要功能：
 * - 请求/响应日志记录
 * - 错误日志追踪
 * - 日志查询和过滤
 * - 统计数据生成
 * - 敏感信息脱敏
 */
import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';

/**
 * 请求日志记录
 */
export interface RequestLog {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  query?: Record<string, any>;
  headers?: Record<string, string>;
  body?: any;
  ip?: string;
  userAgent?: string;
  userId?: string;
  requestId?: string;
}

/**
 * 响应日志记录
 */
export interface ResponseLog {
  statusCode: number;
  headers?: Record<string, string>;
  body?: any;
  duration: number; // 响应时间（毫秒）
  size?: number; // 响应大小（字节）
}

/**
 * 完整的访问日志
 */
export interface AccessLog extends RequestLog {
  statusCode?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: any;
  duration?: number;
  size?: number;
  error?: string;
  errorStack?: string;
}

/**
 * 日志统计
 */
export interface LogStatistics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  requestsPerSecond: number;
  topEndpoints: Array<{ path: string; count: number }>;
  topErrorPaths: Array<{ path: string; count: number }>;
}

/**
 * 日志查询条件
 */
export interface LogQuery {
  startTime?: number;
  endTime?: number;
  method?: string;
  path?: string;
  userId?: string;
  statusCode?: number;
  minDuration?: number;
  maxDuration?: number;
  limit?: number;
  offset?: number;
}

/**
 * 请求日志服务类
 *
 * 采用单例模式，使用 Redis 存储日志数据。
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class RequestLoggerService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  // Redis key 前缀
  private readonly LOG_PREFIX = 'gateway:log:'; // 日志前缀
  private readonly STATS_PREFIX = 'gateway:stats:'; // 统计前缀
  private readonly LOG_TTL = 86400 * 7; // 日志保留 7 天
  private readonly STATS_TTL = 3600; // 统计数据保留 1 小时

  /**
   * 允许记录完整请求/响应体的路径白名单
   * 默认情况下不记录请求体和响应体
   */
  private readonly BODY_LOG_WHITELIST = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/devices',
    '/api/babies',
  ];

  /**
   * 记录请求日志
   *
   * 记录传入请求的详细信息，包括方法、路径、头部、体等。
   * 自动脱敏敏感信息。
   *
   * @param request - 请求信息
   * @returns 日志 ID
   */
  async logRequest(request: Partial<RequestLog>): Promise<string> {
    // 生成唯一日志 ID
    const logId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const log: RequestLog = {
      id: logId,
      timestamp: Date.now(),
      method: request.method || 'GET',
      path: request.path || '/',
      query: request.query,
      headers: this.sanitizeHeaders(request.headers), // 脱敏敏感头部
      body: this.sanitizeBody(request.body, request.path), // 脱敏敏感字段
      ip: request.ip,
      userAgent: request.userAgent,
      userId: request.userId,
      requestId: request.requestId,
    };

    // 保存请求日志
    const key = `${this.LOG_PREFIX}request:${logId}`;
    await this.redis.set(key, JSON.stringify(log));
    await this.redis.expire(key, this.LOG_TTL);

    // 添加到索引以便查询
    await this.redis.sadd(`${this.LOG_PREFIX}index`, logId);
    await this.redis.set(`${this.LOG_PREFIX}mapping:${log.requestId || logId}`, logId);
    await this.redis.expire(`${this.LOG_PREFIX}mapping:${log.requestId || logId}`, this.LOG_TTL);

    // 更新统计
    await this.updateRequestStats(log);

    return logId;
  }

  /**
   * 记录响应日志
   *
   * 根据请求 ID 记录对应的响应信息。
   * 检测慢请求并发出警告。
   * 默认不记录响应体内容，除非在白名单中。
   *
   * @param requestId - 请求 ID
   * @param response - 响应信息
   * @param requestPath - 请求路径（用于白名单判断）
   */
  async logResponse(requestId: string, response: Partial<ResponseLog>, requestPath?: string): Promise<void> {
    // 查找请求 ID 对应的日志 ID
    const mappingKey = `${this.LOG_PREFIX}mapping:${requestId}`;
    const logId = await this.redis.get(mappingKey);

    if (!logId) {
      console.warn(`[Request Logger] No log found for requestId: ${requestId}`);
      return;
    }

    // 检查是否在白名单中
    const isWhitelisted = requestPath && this.BODY_LOG_WHITELIST.some(p => requestPath.startsWith(p));

    // 默认不记录响应体，除非在白名单中
    let sanitizedBody: any;
    if (isWhitelisted) {
      sanitizedBody = this.sanitizeBody(response.body, requestPath);
    } else if (response.body) {
      // 只记录响应体的类型和大小
      sanitizedBody = {
        _type: typeof response.body,
        _note: 'Response body not logged for security',
      };
    }

    const responseLog: ResponseLog = {
      statusCode: response.statusCode || 200,
      headers: response.headers,
      body: sanitizedBody,
      duration: response.duration || 0,
      size: response.size,
    };

    // 保存响应日志
    const key = `${this.LOG_PREFIX}response:${logId}`;
    await this.redis.set(key, JSON.stringify(responseLog));
    await this.redis.expire(key, this.LOG_TTL);

    // 更新统计
    await this.updateResponseStats(responseLog);

    // 记录慢请求（超过 3 秒）
    if (response.duration && response.duration > 3000) {
      console.warn(`[Request Logger] Slow request detected: ${requestId} - ${response.duration}ms`);
    }
  }

  /**
   * 记录错误日志
   *
   * 记录请求处理过程中的错误信息，包括错误消息和堆栈。
   *
   * @param requestId - 请求 ID
   * @param error - 错误对象
   */
  async logError(requestId: string, error: Error): Promise<void> {
    const mappingKey = `${this.LOG_PREFIX}mapping:${requestId}`;
    const logId = await this.redis.get(mappingKey);

    if (!logId) {
      return;
    }

    const key = `${this.LOG_PREFIX}error:${logId}`;
    const errorLog = {
      requestId,
      error: error.message,
      errorStack: error.stack,
      timestamp: Date.now(),
    };

    await this.redis.set(key, JSON.stringify(errorLog));
    await this.redis.expire(key, this.LOG_TTL);

    // 更新错误统计
    await this.updateErrorStats(requestId, error);
  }

  /**
   * 获取完整访问日志
   */
  async getAccessLog(logId: string): Promise<AccessLog | null> {
    const requestKey = `${this.LOG_PREFIX}request:${logId}`;
    const responseKey = `${this.LOG_PREFIX}response:${logId}`;
    const errorKey = `${this.LOG_PREFIX}error:${logId}`;

    const [requestData, responseData, errorData] = await Promise.all([
      this.redis.get(requestKey),
      this.redis.get(responseKey),
      this.redis.get(errorKey),
    ]);

    if (!requestData) {
      return null;
    }

    const request: RequestLog = JSON.parse(requestData);
    const response: ResponseLog = responseData ? JSON.parse(responseData) : {};
    const error = errorData ? JSON.parse(errorData) : {};

    return {
      ...request,
      ...response,
      ...error,
    };
  }

  /**
   * 查询日志
   */
  async queryLogs(query: LogQuery): Promise<AccessLog[]> {
    const logIds = await this.redis.smembers(`${this.LOG_PREFIX}index`);
    const logs: AccessLog[] = [];

    for (const logId of logIds) {
      const log = await this.getAccessLog(logId);
      if (!log) {
        continue;
      }

      // 过滤条件
      if (query.startTime && log.timestamp < query.startTime) {
        continue;
      }
      if (query.endTime && log.timestamp > query.endTime) {
        continue;
      }
      if (query.method && log.method !== query.method) {
        continue;
      }
      if (query.path && !log.path.includes(query.path)) {
        continue;
      }
      if (query.userId && log.userId !== query.userId) {
        continue;
      }
      if (query.statusCode && log.statusCode !== query.statusCode) {
        continue;
      }
      if (query.minDuration && log.duration !== undefined && log.duration < query.minDuration) {
        continue;
      }
      if (query.maxDuration && log.duration !== undefined && log.duration > query.maxDuration) {
        continue;
      }

      logs.push(log);
    }

    // 排序和分页
    logs.sort((a, b) => b.timestamp - a.timestamp);

    const offset = query.offset || 0;
    const limit = query.limit || 100;

    return logs.slice(offset, offset + limit);
  }

  /**
   * 获取日志统计
   */
  async getStatistics(period: 'hour' | 'day' | 'week' = 'hour'): Promise<LogStatistics> {
    const now = Date.now();
    let startTime: number;

    switch (period) {
      case 'hour':
        startTime = now - 3600000;
        break;
      case 'day':
        startTime = now - 86400000;
        break;
      case 'week':
        startTime = now - 604800000;
        break;
    }

    const logs = await this.queryLogs({ startTime, limit: 100000 });

    const stats: LogStatistics = {
      totalRequests: logs.length,
      successfulRequests: logs.filter(l => l.statusCode && l.statusCode >= 200 && l.statusCode < 400).length,
      failedRequests: logs.filter(l => l.statusCode && l.statusCode >= 400).length,
      averageResponseTime: logs.reduce((sum, l) => sum + (l.duration || 0), 0) / logs.length || 0,
      requestsPerSecond: logs.length / ((now - startTime) / 1000),
      topEndpoints: this.getTopEndpoints(logs),
      topErrorPaths: this.getTopErrorPaths(logs),
    };

    return stats;
  }

  /**
   * 获取实时请求统计
   */
  async getRealTimeStats(): Promise<{
    requests: number;
    errors: number;
    avgDuration: number;
    p50Duration: number;
    p95Duration: number;
    p99Duration: number;
  }> {
    const now = Date.now();
    const startTime = now - 60000; // 最近1分钟

    const logs = await this.queryLogs({ startTime, limit: 100000 });
    const durations = logs.map(l => l.duration || 0).sort((a, b) => a - b);

    return {
      requests: logs.length,
      errors: logs.filter(l => l.statusCode && l.statusCode >= 400).length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length || 0,
      p50Duration: durations[Math.floor(durations.length * 0.5)] || 0,
      p95Duration: durations[Math.floor(durations.length * 0.95)] || 0,
      p99Duration: durations[Math.floor(durations.length * 0.99)] || 0,
    };
  }

  /**
   * 获取用户活动日志
   */
  async getUserActivity(userId: string, limit: number = 100): Promise<AccessLog[]> {
    return this.queryLogs({ userId, limit });
  }

  /**
   * 获取慢请求
   */
  async getSlowRequests(minDuration: number = 3000, limit: number = 100): Promise<AccessLog[]> {
    return this.queryLogs({ minDuration, limit });
  }

  /**
   * 清理旧日志
   */
  async cleanupOldLogs(retentionDays: number = 7): Promise<number> {
    const cutoffTime = Date.now() - retentionDays * 86400000;
    const logIds = await this.redis.smembers(`${this.LOG_PREFIX}index`);
    let cleaned = 0;

    for (const logId of logIds) {
      const log = await this.getAccessLog(logId);
      if (log && log.timestamp < cutoffTime) {
        await this.redis.del(`${this.LOG_PREFIX}request:${logId}`);
        await this.redis.del(`${this.LOG_PREFIX}response:${logId}`);
        await this.redis.del(`${this.LOG_PREFIX}error:${logId}`);
        await this.redis.srem(`${this.LOG_PREFIX}index`, logId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[Request Logger] Cleaned up ${cleaned} old logs`);
    }

    return cleaned;
  }

  /**
   * 敏感请求头列表
   */
  private readonly SENSITIVE_HEADERS = [
    'authorization',
    'cookie',
    'x-api-key',
    'x-auth-token',
    'x-access-token',
    'x-refresh-token',
    'x-user-token',
    'x-session-id',
    'x-user-password',
    'proxy-authorization',
    'www-authenticate',
  ];

  /**
   * 敏感字段名列表
   */
  private readonly SENSITIVE_FIELDS = [
    'password',
    'passwd',
    'pwd',
    'token',
    'secret',
    'apiKey',
    'api_key',
    'apiSecret',
    'api_secret',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'privateKey',
    'private_key',
    'secretKey',
    'secret_key',
    'credential',
    'credentials',
    'sessionId',
    'session_id',
    'creditCard',
    'credit_card',
    'cardNumber',
    'card_number',
    'cvv',
    'ssn',
    'socialSecurity',
    'bankAccount',
    'bank_account',
    'idCard',
    'id_card',
    'phone',
    'mobile',
    'email',
    'address',
  ];

  /**
   * 清理请求头中的敏感信息
   *
   * 将 Authorization、Cookie 等敏感头部替换为占位符。
   *
   * @param headers - 原始请求头
   * @returns 脱敏后的请求头
   */
  private sanitizeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
    if (!headers) {
      return undefined;
    }

    const sanitized = { ...headers };

    for (const key of Object.keys(sanitized)) {
      if (this.SENSITIVE_HEADERS.includes(key.toLowerCase())) {
        // 对于 Authorization 头，保留类型信息
        if (key.toLowerCase() === 'authorization') {
          const value = sanitized[key];
          if (value && value.startsWith('Bearer ')) {
            sanitized[key] = 'Bearer ***REDACTED***';
          } else if (value && value.startsWith('Basic ')) {
            sanitized[key] = 'Basic ***REDACTED***';
          } else {
            sanitized[key] = '***REDACTED***';
          }
        } else {
          sanitized[key] = '***REDACTED***';
        }
      }
    }

    return sanitized;
  }

  /**
   * 清理请求体中的敏感信息
   *
   * 将 password、token、secret 等敏感字段替换为占位符。
   * 对于非白名单路径，只记录字段名，不记录值。
   *
   * @param body - 原始请求体
   * @param path - 请求路径（用于白名单判断）
   * @returns 脱敏后的请求体
   */
  private sanitizeBody(body?: any, path?: string): any {
    if (!body) {
      return undefined;
    }

    // 检查是否在白名单中
    const isWhitelisted = path && this.BODY_LOG_WHITELIST.some(p => path.startsWith(p));

    // 非白名单路径，不记录请求体内容
    if (!isWhitelisted) {
      if (typeof body === 'object') {
        return { _type: 'object', _note: 'Body content not logged for security' };
      }
      if (typeof body === 'string' && body.length > 100) {
        return { _type: 'string', _length: body.length, _note: 'Body content not logged for security' };
      }
    }

    // 尝试解析 JSON 字符串
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // 如果不是 JSON，检查是否包含敏感信息
        if (this.containsSensitiveData(body)) {
          return '***REDACTED***';
        }
        return body;
      }
    }

    // 处理对象类型
    if (typeof body === 'object') {
      if (Array.isArray(body)) {
        return body.map(item => this.sanitizeBody(item, path));
      }

      const sanitized: Record<string, any> = {};

      for (const key of Object.keys(body)) {
        const lowerKey = key.toLowerCase();

        // 检查字段名是否包含敏感关键词
        if (this.SENSITIVE_FIELDS.some(field => lowerKey.includes(field.toLowerCase()))) {
          sanitized[key] = '***REDACTED***';
        } else if (typeof body[key] === 'object' && body[key] !== null) {
          // 递归处理嵌套对象
          sanitized[key] = this.sanitizeBody(body[key], path);
        } else {
          sanitized[key] = body[key];
        }
      }

      return sanitized;
    }

    return body;
  }

  /**
   * 检查字符串是否包含敏感数据
   */
  private containsSensitiveData(text: string): boolean {
    const sensitivePatterns = [
      /password\s*[=:]\s*\S+/i,
      /token\s*[=:]\s*\S+/i,
      /secret\s*[=:]\s*\S+/i,
      /api[-_]?key\s*[=:]\s*\S+/i,
      /\b\d{16,19}\b/, // 信用卡号
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // 邮箱
    ];

    return sensitivePatterns.some(pattern => pattern.test(text));
  }

  /**
   * 更新请求统计数据
   *
   * 记录每个路径的请求计数。
   *
   * @param log - 请求日志
   */
  private async updateRequestStats(log: RequestLog): Promise<void> {
    const key = `${this.STATS_PREFIX}requests:${log.path}`;
    await this.redis.incr(key);
    await this.redis.expire(key, this.STATS_TTL);
  }

  /**
   * 更新响应统计数据
   *
   * 记录状态码分布和响应时间。
   *
   * @param response - 响应日志
   */
  private async updateResponseStats(response: ResponseLog): Promise<void> {
    // 统计状态码分布（2xx、3xx、4xx、5xx）
    const statusCode = Math.floor(response.statusCode / 100);
    const key = `${this.STATS_PREFIX}status:${statusCode}xx`;
    await this.redis.incr(key);
    await this.redis.expire(key, this.STATS_TTL);

    // 记录响应时间列表（用于计算百分位数）
    const durationKey = `${this.STATS_PREFIX}duration`;
    await this.redis.lpush(durationKey, response.duration.toString());
    await this.redis.ltrim(durationKey, 0, 9999); // 保留最近 10000 个
    await this.redis.expire(durationKey, this.STATS_TTL);
  }

  /**
   * 更新错误统计数据
   *
   * 记录每个路径的错误计数。
   *
   * @param requestId - 请求 ID
   * @param error - 错误对象
   */
  private async updateErrorStats(requestId: string, error: Error): Promise<void> {
    const mappingKey = `${this.LOG_PREFIX}mapping:${requestId}`;
    const logId = await this.redis.get(mappingKey);

    if (!logId) {
      return;
    }

    const requestKey = `${this.LOG_PREFIX}request:${logId}`;
    const requestData = await this.redis.get(requestKey);

    if (requestData) {
      const request: RequestLog = JSON.parse(requestData);
      const key = `${this.STATS_PREFIX}errors:${request.path}`;
      await this.redis.incr(key);
      await this.redis.expire(key, this.STATS_TTL);
    }
  }

  /**
   * 获取热门端点统计
   *
   * 统计访问量最高的端点，返回前 10 个。
   *
   * @param logs - 日志列表
   * @returns 热门端点列表（按访问量降序）
   */
  private getTopEndpoints(logs: AccessLog[]): Array<{ path: string; count: number }> {
    const pathCounts = new Map<string, number>();

    for (const log of logs) {
      pathCounts.set(log.path, (pathCounts.get(log.path) || 0) + 1);
    }

    return Array.from(pathCounts.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * 获取错误最多的路径
   *
   * 统计 4xx 和 5xx 错误最多的端点，返回前 10 个。
   *
   * @param logs - 日志列表
   * @returns 高错误路径列表（按错误数降序）
   */
  private getTopErrorPaths(logs: AccessLog[]): Array<{ path: string; count: number }> {
    const errorCounts = new Map<string, number>();

    for (const log of logs) {
      // 统计客户端错误（4xx）和服务端错误（5xx）
      if (log.statusCode !== undefined && log.statusCode >= 400) {
        errorCounts.set(log.path, (errorCounts.get(log.path) || 0) + 1);
      }
    }

    return Array.from(errorCounts.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }
}
