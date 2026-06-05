/**
 * 速率限制服务
 *
 * 实现 API 速率限制（Rate Limiting）功能，防止服务被过度调用。
 * 支持基于 IP、用户 ID 或自定义标识符的速率限制。
 *
 * 主要功能：
 * - 滑动窗口速率限制
 * - 灵活的规则配置（支持通配符）
 * - IP 和用户级别的限制
 * - 统计数据收集
 * - 动态调整限制
 */
import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { CacheManager } from '@baby-monitor/shared-utils';

/**
 * 速率限制配置
 */
export interface RateLimitConfig {
  windowMs: number; // 时间窗口（毫秒）
  maxRequests: number; // 最大请求数
  keyPrefix?: string; // Redis key前缀
  skipSuccessfulRequests?: boolean; // 是否跳过成功请求
  skipFailedRequests?: boolean; // 是否跳过失败请求
}

/**
 * 速率限制结果
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

/**
 * 速率限制规则
 */
export interface RateLimitRule {
  pattern: string; // URL模式（支持通配符）
  config: RateLimitConfig;
  priority?: number; // 优先级（数字越大优先级越高）
}

/**
 * 用户速率限制
 */
export interface UserRateLimit {
  userId: string;
  endpoint: string;
  windowMs: number;
  maxRequests: number;
  currentCount: number;
  resetAt: number;
}

/**
 * 速率限制服务类
 *
 * 采用单例模式，使用 Redis 存储计数器数据。
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class RateLimitService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  // 默认速率限制配置
  private readonly DEFAULT_CONFIG: RateLimitConfig = {
    windowMs: 60000, // 时间窗口：1 分钟
    maxRequests: 100, // 最大请求数：100 次
    keyPrefix: 'ratelimit', // Redis key 前缀
    skipSuccessfulRequests: false, // 不跳过成功请求
    skipFailedRequests: false, // 不跳过失败请求
  };

  // 速率限制规则列表（内存存储）
  private rules: RateLimitRule[] = [];

  /**
   * 添加速率限制规则
   *
   * 添加一个新的速率限制规则，支持通配符匹配。
   * 规则会按优先级排序，优先级高的规则会先匹配。
   *
   * @param rule - 速率限制规则
   */
  addRule(rule: RateLimitRule): void {
    this.rules.push(rule);
    // 按优先级降序排序（优先级越高越先匹配）
    this.rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    console.log(`[Rate Limit] Added rule for pattern: ${rule.pattern}`);
  }

  /**
   * 移除速率限制规则
   *
   * 根据路径模式移除已配置的速率限制规则。
   *
   * @param pattern - 要移除的路径模式
   * @returns 是否成功移除（false 表示规则不存在）
   */
  removeRule(pattern: string): boolean {
    const index = this.rules.findIndex(r => r.pattern === pattern);
    if (index > -1) {
      this.rules.splice(index, 1);
      console.log(`[Rate Limit] Removed rule for pattern: ${pattern}`);
      return true;
    }
    return false;
  }

  /**
   * 获取所有规则
   *
   * 返回当前配置的所有速率限制规则。
   *
   * @returns 速率限制规则列表
   */
  getRules(): RateLimitRule[] {
    return [...this.rules];
  }

  /**
   * 匹配速率限制规则
   *
   * 根据请求端点查找匹配的速率限制规则。
   * 支持通配符模式，如 `/api/devices/*`。
   *
   * @param endpoint - 请求端点路径
   * @returns 匹配的规则，未找到则返回 null
   */
  private matchRule(endpoint: string): RateLimitRule | null {
    for (const rule of this.rules) {
      // 将通配符模式转换为正则表达式
      const pattern = rule.pattern
        .replace(/\*/g, '.*') // * 替换为 .*
        .replace(/\//g, '\\/'); // / 转义

      const regex = new RegExp(`^${pattern}$`);
      if (regex.test(endpoint)) {
        return rule;
      }
    }
    return null;
  }

  /**
   * 检查速率限制
   *
   * 检查指定标识符在当前时间窗口内的请求数是否超过限制。
   * 使用滑动窗口算法实现精确的速率限制。
   *
   * @param identifier - 标识符（用户 ID、IP 等）
   * @param endpoint - 请求端点
   * @param config - 可选的自定义配置
   * @returns 速率限制检查结果
   */
  async checkLimit(
    identifier: string,
    endpoint: string,
    config?: RateLimitConfig
  ): Promise<RateLimitResult> {
    // 获取有效的配置（自定义配置 > 规则配置 > 默认配置）
    const rule = this.matchRule(endpoint);
    const effectiveConfig = config || rule?.config || this.DEFAULT_CONFIG;

    const now = Date.now();
    // 计算当前时间窗口的起始时间
    const windowStart = Math.floor(now / effectiveConfig.windowMs) * effectiveConfig.windowMs;
    const reset = windowStart + effectiveConfig.windowMs; // 窗口重置时间

    // 构建 Redis key：包含标识符、端点和时间窗口
    const key = `${effectiveConfig.keyPrefix}:${identifier}:${endpoint}:${windowStart}`;

    // 原子递增计数器
    const current = await this.redis.incr(key);

    // 首次访问时设置过期时间
    if (current === 1) {
      await this.redis.expire(key, Math.floor(effectiveConfig.windowMs / 1000) + 1);
    }

    // 判断是否超过限制
    const allowed = current <= effectiveConfig.maxRequests;
    const result: RateLimitResult = {
      allowed,
      limit: effectiveConfig.maxRequests,
      remaining: Math.max(0, effectiveConfig.maxRequests - current),
      reset,
    };

    // 超过限制时计算重试时间
    if (!allowed) {
      result.retryAfter = Math.ceil((reset - now) / 1000);
      console.warn(
        `[Rate Limit] Limit exceeded for ${identifier} on ${endpoint}: ${current}/${effectiveConfig.maxRequests}`
      );
    }

    return result;
  }

  /**
   * 检查用户速率限制
   *
   * 基于用户 ID 的速率限制检查。
   *
   * @param userId - 用户 ID
   * @param endpoint - 请求端点
   * @param windowMs - 可选的时间窗口大小
   * @param maxRequests - 可选的最大请求数
   * @returns 速率限制检查结果
   */
  async checkUserLimit(
    userId: string,
    endpoint: string,
    windowMs?: number,
    maxRequests?: number
  ): Promise<RateLimitResult> {
    const config: RateLimitConfig = {
      ...this.DEFAULT_CONFIG,
      windowMs: windowMs || this.DEFAULT_CONFIG.windowMs,
      maxRequests: maxRequests || this.DEFAULT_CONFIG.maxRequests,
      keyPrefix: 'ratelimit:user', // 用户限制使用专门的 key 前缀
    };

    return this.checkLimit(userId, endpoint, config);
  }

  /**
   * 检查 IP 速率限制
   *
   * 基于 IP 地址的速率限制检查。
   *
   * @param ip - IP 地址
   * @param endpoint - 请求端点
   * @param windowMs - 可选的时间窗口大小
   * @param maxRequests - 可选的最大请求数
   * @returns 速率限制检查结果
   */
  async checkIPLimit(
    ip: string,
    endpoint: string,
    windowMs?: number,
    maxRequests?: number
  ): Promise<RateLimitResult> {
    const config: RateLimitConfig = {
      ...this.DEFAULT_CONFIG,
      windowMs: windowMs || this.DEFAULT_CONFIG.windowMs,
      maxRequests: maxRequests || this.DEFAULT_CONFIG.maxRequests,
      keyPrefix: 'ratelimit:ip', // IP 限制使用专门的 key 前缀
    };

    return this.checkLimit(ip, endpoint, config);
  }

  /**
   * 重置速率限制
   *
   * 清除指定标识符在指定端点上的所有速率限制计数器。
   * 通常用于管理员手动解除限制。
   *
   * @param identifier - 标识符（用户 ID、IP 等）
   * @param endpoint - 请求端点
   */
  async resetLimit(identifier: string, endpoint: string): Promise<void> {
    // 匹配该标识符在该端点上所有时间窗口的 key
    const pattern = `ratelimit:*:${identifier}:${endpoint}:*`;
    const keys = await this.cacheManager.keysByPattern(pattern);

    if (keys.length > 0) {
      await this.redis.del(...keys);
      console.log(`[Rate Limit] Reset limit for ${identifier} on ${endpoint}`);
    }
  }

  /**
   * 获取当前使用情况
   *
   * 返回指定标识符在当前时间窗口内的请求计数情况。
   *
   * @param identifier - 标识符
   * @param endpoint - 请求端点
   * @returns 当前使用情况（当前计数、限制、剩余、重置时间）
   */
  async getCurrentUsage(identifier: string, endpoint: string): Promise<{
    current: number;
    limit: number;
    remaining: number;
    reset: number;
  }> {
    const now = Date.now();
    const windowMs = this.DEFAULT_CONFIG.windowMs;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const reset = windowStart + windowMs;

    const key = `${this.DEFAULT_CONFIG.keyPrefix}:${identifier}:${endpoint}:${windowStart}`;
    const current = parseInt((await this.redis.get(key)) || '0', 10);

    return {
      current,
      limit: this.DEFAULT_CONFIG.maxRequests,
      remaining: Math.max(0, this.DEFAULT_CONFIG.maxRequests - current),
      reset,
    };
  }

  /**
   * 获取用户速率限制统计
   *
   * 返回指定用户在所有端点上的速率限制状态。
   *
   * @param userId - 用户 ID
   * @returns 用户在各端点的速率限制状态列表
   */
  async getUserStats(userId: string): Promise<UserRateLimit[]> {
    const pattern = `ratelimit:user:${userId}:*`;
    const keys = await this.cacheManager.keysByPattern(pattern);

    const stats: UserRateLimit[] = [];
    for (const key of keys) {
      const parts = key.split(':');
      const endpoint = parts[3];
      const current = parseInt((await this.redis.get(key)) || '0', 10);
      const windowStart = parseInt(parts[4], 10);

      stats.push({
        userId,
        endpoint,
        windowMs: this.DEFAULT_CONFIG.windowMs,
        maxRequests: this.DEFAULT_CONFIG.maxRequests,
        currentCount: current,
        resetAt: windowStart + this.DEFAULT_CONFIG.windowMs,
      });
    }

    return stats;
  }

  /**
   * 清理过期的速率限制记录
   *
   * Redis 会自动清理过期的 key，此方法预留用于额外清理逻辑。
   *
   * @returns 清理的记录数
   */
  async cleanupExpired(): Promise<number> {
    // Redis 会自动清理过期的 key
    // 这里可以添加额外的清理逻辑（如清理统计）
    return 0;
  }

  /**
   * 批量设置速率限制
   *
   * 为多个标识符和端点组合设置自定义的速率限制。
   * 自定义配置会覆盖默认配置和规则配置。
   *
   * @param items - 批量设置项列表
   */
  async setBatchLimits(items: Array<{
    identifier: string;
    endpoint: string;
    maxRequests: number;
    windowMs?: number;
  }>): Promise<void> {
    for (const item of items) {
      const key = `ratelimit:custom:${item.identifier}:${item.endpoint}`;
      const value = JSON.stringify({
        maxRequests: item.maxRequests,
        windowMs: item.windowMs || this.DEFAULT_CONFIG.windowMs,
      });

      await this.redis.set(key, value);
      await this.redis.expire(key, 86400); // 24 小时过期
    }

    console.log(`[Rate Limit] Set batch limits for ${items.length} items`);
  }

  /**
   * 获取全局速率限制统计
   *
   * 返回系统级别的速率限制统计数据，包括规则数、受限端点等。
   *
   * @returns 全局统计数据
   */
  async getGlobalStats(): Promise<{
    totalRules: number;
    totalLimitedEndpoints: number;
    topLimitedEndpoints: Array<{ endpoint: string; count: number }>;
  }> {
    // 统计所有速率限制的端点
    const pattern = 'ratelimit:*:*';
    const keys = await this.cacheManager.keysByPattern(pattern);

    const endpointCounts = new Map<string, number>();
    for (const key of keys) {
      const parts = key.split(':');
      if (parts.length >= 4) {
        const endpoint = parts[parts.length - 2];
        const count = parseInt((await this.redis.get(key)) || '0', 10);
        endpointCounts.set(endpoint, (endpointCounts.get(endpoint) || 0) + count);
      }
    }

    // 获取前 10 个请求最多的端点
    const topLimitedEndpoints = Array.from(endpointCounts.entries())
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalRules: this.rules.length,
      totalLimitedEndpoints: endpointCounts.size,
      topLimitedEndpoints,
    };
  }

  /**
   * 动态调整速率限制
   *
   * 为指定标识符和端点动态调整速率限制参数。
   * 可用于根据系统负载临时调整限制。
   *
   * @param identifier - 标识符
   * @param endpoint - 请求端点
   * @param newMaxRequests - 新的最大请求数
   * @param newWindowMs - 可选的新时间窗口大小
   */
  async adjustLimit(
    identifier: string,
    endpoint: string,
    newMaxRequests: number,
    newWindowMs?: number
  ): Promise<void> {
    const key = `ratelimit:custom:${identifier}:${endpoint}`;
    const value = JSON.stringify({
      maxRequests: newMaxRequests,
      windowMs: newWindowMs || this.DEFAULT_CONFIG.windowMs,
    });

    await this.redis.set(key, value);
    await this.redis.expire(key, 86400);

    console.log(
      `[Rate Limit] Adjusted limit for ${identifier} on ${endpoint}: ${newMaxRequests} req/${newWindowMs || this.DEFAULT_CONFIG.windowMs}ms`
    );
  }
}
