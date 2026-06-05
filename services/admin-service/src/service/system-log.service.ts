import { Provide, Inject, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { IdGenerator, CacheManager } from '@baby-monitor/shared-utils';

/**
 * 日志级别
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * 系统日志
 */
export interface SystemLog {
  id: string;
  level: LogLevel;
  service: string;
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  userId?: string;
  traceId?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * 日志查询参数
 */
export interface LogQuery {
  service?: string;
  level?: LogLevel;
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  traceId?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 日志统计
 */
export interface LogStats {
  total: number;
  byLevel: Record<LogLevel, number>;
  byService: Record<string, number>;
  timeRange: { start: Date; end: Date };
}

/**
 * 系统日志服务
 *
 * 负责收集、存储和查询系统日志
 */
@Provide()
export class SystemLogService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redisService!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  // 内存中的日志缓存（用于快速查询）
  private logCache: SystemLog[] = [];
  private readonly MAX_CACHE_SIZE = 10000;

  @Init()
  async init() {
    this.logger.info('[SystemLogService] System log service initialized');

    // 启动日志清理任务
    setInterval(() => this.cleanupOldLogs(), 3600000); // 每小时清理一次

    // 启动日志持久化任务
    setInterval(() => this.flushLogsToRedis(), 30000); // 每30秒持久化一次
  }

  /**
   * 记录日志
   */
  async log(params: {
    level: LogLevel;
    service: string;
    message: string;
    metadata?: Record<string, any>;
    userId?: string;
    traceId?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<SystemLog> {
    const log: SystemLog = {
      id: IdGenerator.uuid(),
      level: params.level,
      service: params.service,
      message: params.message,
      timestamp: new Date(),
      metadata: params.metadata,
      userId: params.userId,
      traceId: params.traceId,
      ip: params.ip,
      userAgent: params.userAgent,
    };

    // 添加到缓存
    this.logCache.push(log);

    // 如果缓存过大，触发持久化
    if (this.logCache.length >= this.MAX_CACHE_SIZE) {
      await this.flushLogsToRedis();
    }

    return log;
  }

  /**
   * 快捷方法：记录INFO级别日志
   */
  async info(service: string, message: string, metadata?: Record<string, any>): Promise<SystemLog> {
    return this.log({ level: LogLevel.INFO, service, message, metadata });
  }

  /**
   * 快捷方法：记录WARN级别日志
   */
  async warn(service: string, message: string, metadata?: Record<string, any>): Promise<SystemLog> {
    return this.log({ level: LogLevel.WARN, service, message, metadata });
  }

  /**
   * 快捷方法：记录ERROR级别日志
   */
  async error(service: string, message: string, metadata?: Record<string, any>): Promise<SystemLog> {
    return this.log({ level: LogLevel.ERROR, service, message, metadata });
  }

  /**
   * 快捷方法：记录DEBUG级别日志
   */
  async debug(service: string, message: string, metadata?: Record<string, any>): Promise<SystemLog> {
    return this.log({ level: LogLevel.DEBUG, service, message, metadata });
  }

  /**
   * 查询日志
   */
  async queryLogs(query: LogQuery): Promise<{
    logs: SystemLog[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const {
      service,
      level,
      startDate,
      endDate,
      userId,
      traceId,
      keyword,
      page = 1,
      pageSize = 20,
    } = query;

    try {
      // 从Redis获取日志
      const redisLogs = await this.getLogsFromRedis({
        service,
        level,
        startDate,
        endDate,
        userId,
        traceId,
        keyword,
      });

      // 合并内存中的日志
      const allLogs = [...this.logCache, ...redisLogs];

      // 应用过滤条件
      let filtered = allLogs;

      if (service) {
        filtered = filtered.filter(log => log.service === service);
      }

      if (level) {
        filtered = filtered.filter(log => log.level === level);
      }

      if (startDate) {
        filtered = filtered.filter(log => log.timestamp >= startDate);
      }

      if (endDate) {
        filtered = filtered.filter(log => log.timestamp <= endDate);
      }

      if (userId) {
        filtered = filtered.filter(log => log.userId === userId);
      }

      if (traceId) {
        filtered = filtered.filter(log => log.traceId === traceId);
      }

      if (keyword) {
        filtered = filtered.filter(log =>
          log.message.includes(keyword) || JSON.stringify(log.metadata)?.includes(keyword)
        );
      }

      // 按时间倒序排序
      filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // 分页
      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const logs = filtered.slice(start, start + pageSize);

      return { logs, total, page, pageSize };
    } catch (error: any) {
      this.logger.error('[SystemLogService] Failed to query logs:', error);

      // 降级：只查询内存中的日志
      return this.queryLogsFromCache(query);
    }
  }

  /**
   * 从缓存查询日志
   */
  private queryLogsFromCache(query: LogQuery): {
    logs: SystemLog[];
    total: number;
    page: number;
    pageSize: number;
  } {
    const {
      service,
      level,
      startDate,
      endDate,
      userId,
      traceId,
      keyword,
      page = 1,
      pageSize = 20,
    } = query;

    let filtered = [...this.logCache];

    if (service) {
      filtered = filtered.filter(log => log.service === service);
    }

    if (level) {
      filtered = filtered.filter(log => log.level === level);
    }

    if (startDate) {
      filtered = filtered.filter(log => log.timestamp >= startDate);
    }

    if (endDate) {
      filtered = filtered.filter(log => log.timestamp <= endDate);
    }

    if (userId) {
      filtered = filtered.filter(log => log.userId === userId);
    }

    if (traceId) {
      filtered = filtered.filter(log => log.traceId === traceId);
    }

    if (keyword) {
      filtered = filtered.filter(log =>
        log.message.includes(keyword) || JSON.stringify(log.metadata)?.includes(keyword)
      );
    }

    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const logs = filtered.slice(start, start + pageSize);

    return { logs, total, page, pageSize };
  }

  /**
   * 从Redis获取日志
   */
  private async getLogsFromRedis(filters: {
    service?: string;
    level?: LogLevel;
    startDate?: Date;
    endDate?: Date;
    userId?: string;
    traceId?: string;
    keyword?: string;
  }): Promise<SystemLog[]> {
    try {
      // 获取所有日志键
      const keys = await this.cacheManager.keysByPattern('system_log:*');

      if (keys.length === 0) {
        return [];
      }

      // 批量获取日志
      const logs = await this.redisService.mget(keys);

      return logs
        .filter((log): log is string => log !== null)
        .map(log => JSON.parse(log))
        .filter((log: SystemLog) => {
          if (filters.service && log.service !== filters.service) return false;
          if (filters.level && log.level !== filters.level) return false;
          if (filters.startDate && log.timestamp < filters.startDate) return false;
          if (filters.endDate && log.timestamp > filters.endDate) return false;
          if (filters.userId && log.userId !== filters.userId) return false;
          if (filters.traceId && log.traceId !== filters.traceId) return false;
          if (filters.keyword && !log.message.includes(filters.keyword)) return false;
          return true;
        });
    } catch (error: any) {
      this.logger.error('[SystemLogService] Failed to get logs from Redis:', error);
      return [];
    }
  }

  /**
   * 获取日志统计
   */
  async getLogStats(startDate: Date, endDate: Date): Promise<LogStats> {
    try {
      const result = await this.queryLogs({
        startDate,
        endDate,
        page: 1,
        pageSize: 100000, // 获取所有日志进行统计
      });

      const logs = result.logs;

      const stats: LogStats = {
        total: logs.length,
        byLevel: {
          [LogLevel.DEBUG]: 0,
          [LogLevel.INFO]: 0,
          [LogLevel.WARN]: 0,
          [LogLevel.ERROR]: 0,
        },
        byService: {},
        timeRange: { start: startDate, end: endDate },
      };

      // 统计各级别日志数量
      for (const log of logs) {
        stats.byLevel[log.level]++;
        stats.byService[log.service] = (stats.byService[log.service] || 0) + 1;
      }

      return stats;
    } catch (error: any) {
      this.logger.error('[SystemLogService] Failed to get log stats:', error);

      return {
        total: 0,
        byLevel: {
          [LogLevel.DEBUG]: 0,
          [LogLevel.INFO]: 0,
          [LogLevel.WARN]: 0,
          [LogLevel.ERROR]: 0,
        },
        byService: {},
        timeRange: { start: startDate, end: endDate },
      };
    }
  }

  /**
   * 删除日志
   */
  async deleteLogs(logIds: string[]): Promise<number> {
    let deleted = 0;

    for (const logId of logIds) {
      // 从缓存中删除
      const cacheIndex = this.logCache.findIndex(log => log.id === logId);
      if (cacheIndex !== -1) {
        this.logCache.splice(cacheIndex, 1);
        deleted++;
      }

      // 从Redis删除
      await this.redisService.del(`system_log:${logId}`);
    }

    return deleted;
  }

  /**
   * 清理旧日志
   */
  private async cleanupOldLogs() {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7天

    // 清理缓存中的旧日志
    this.logCache = this.logCache.filter(log => {
      const age = now - log.timestamp.getTime();
      return age < maxAge;
    });

    // 清理Redis中的旧日志
    try {
      const keys = await this.cacheManager.keysByPattern('system_log:*');

      for (const key of keys) {
        const logData = await this.redisService.get(key);
        if (logData) {
          const log: SystemLog = JSON.parse(logData);
          const age = now - log.timestamp.getTime();

          if (age > maxAge) {
            await this.redisService.del(key);
          }
        }
      }

      this.logger.info(`[SystemLogService] Cleaned up old logs, cache size: ${this.logCache.length}`);
    } catch (error: any) {
      this.logger.error('[SystemLogService] Failed to cleanup old logs:', error);
    }
  }

  /**
   * 将日志持久化到Redis
   */
  private async flushLogsToRedis() {
    if (this.logCache.length === 0) {
      return;
    }

    try {
      const pipeline = this.redisService.pipeline();

      for (const log of this.logCache) {
        const key = `system_log:${log.id}`;
        const ttl = 7 * 24 * 60 * 60; // 7天过期
        pipeline.setex(key, ttl, JSON.stringify(log));
      }

      await pipeline.exec();

      this.logger.debug(`[SystemLogService] Flushed ${this.logCache.length} logs to Redis`);

      // 清空缓存
      this.logCache = [];
    } catch (error: any) {
      this.logger.error('[SystemLogService] Failed to flush logs to Redis:', error);
    }
  }

  /**
   * 获取日志详情
   */
  async getLogById(logId: string): Promise<SystemLog | null> {
    // 先从缓存查找
    const cached = this.logCache.find(log => log.id === logId);
    if (cached) {
      return cached;
    }

    // 从Redis查找
    try {
      const logData = await this.redisService.get(`system_log:${logId}`);
      if (logData) {
        return JSON.parse(logData);
      }
    } catch (error: any) {
      this.logger.error('[SystemLogService] Failed to get log by id:', error);
    }

    return null;
  }

  /**
   * 按服务获取日志列表
   */
  async getLogsByService(service: string, limit: number = 100): Promise<SystemLog[]> {
    const result = await this.queryLogs({
      service,
      page: 1,
      pageSize: limit,
    });

    return result.logs;
  }

  /**
   * 按用户获取日志列表
   */
  async getLogsByUser(userId: string, limit: number = 100): Promise<SystemLog[]> {
    const result = await this.queryLogs({
      userId,
      page: 1,
      pageSize: limit,
    });

    return result.logs;
  }

  /**
   * 按追踪ID获取日志列表
   */
  async getLogsByTraceId(traceId: string): Promise<SystemLog[]> {
    const result = await this.queryLogs({
      traceId,
      page: 1,
      pageSize: 1000,
    });

    return result.logs;
  }

  /**
   * 导出日志
   */
  async exportLogs(query: LogQuery, format: 'json' | 'csv' = 'json'): Promise<string> {
    const { logs } = await this.queryLogs({
      ...query,
      page: 1,
      pageSize: 10000,
    });

    if (format === 'json') {
      return JSON.stringify(logs, null, 2);
    }

    // CSV格式
    const headers = ['id', 'timestamp', 'level', 'service', 'message', 'userId', 'traceId'];
    const rows = logs.map(log =>
      [
        log.id,
        log.timestamp.toISOString(),
        log.level,
        log.service,
        `"${log.message.replace(/"/g, '""')}"`,
        log.userId || '',
        log.traceId || '',
      ].join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * 获取错误日志摘要
   */
  async getErrorLogSummary(hours: number = 24): Promise<{
    total: number;
    topErrors: Array<{ message: string; count: number; lastOccurrence: Date }>;
    byService: Record<string, number>;
  }> {
    const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);
    const endDate = new Date();

    const { logs } = await this.queryLogs({
      level: LogLevel.ERROR,
      startDate,
      endDate,
      page: 1,
      pageSize: 10000,
    });

    const errorCounts = new Map<string, { count: number; lastOccurrence: Date }>();
    const byService: Record<string, number> = {};

    for (const log of logs) {
      // 按消息分组统计
      const key = log.message;
      const existing = errorCounts.get(key);

      if (existing) {
        existing.count++;
        if (log.timestamp > existing.lastOccurrence) {
          existing.lastOccurrence = log.timestamp;
        }
      } else {
        errorCounts.set(key, { count: 1, lastOccurrence: log.timestamp });
      }

      // 按服务统计
      byService[log.service] = (byService[log.service] || 0) + 1;
    }

    // 转换为数组并排序
    const topErrors = Array.from(errorCounts.entries())
      .map(([message, data]) => ({ message, count: data.count, lastOccurrence: data.lastOccurrence }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      total: logs.length,
      topErrors,
      byService,
    };
  }

  /**
   * 搜索日志
   */
  async searchLogs(keyword: string, filters?: {
    service?: string;
    level?: LogLevel;
    startDate?: Date;
    endDate?: Date;
  }): Promise<SystemLog[]> {
    const result = await this.queryLogs({
      ...filters,
      keyword,
      page: 1,
      pageSize: 1000,
    });

    return result.logs;
  }
}
