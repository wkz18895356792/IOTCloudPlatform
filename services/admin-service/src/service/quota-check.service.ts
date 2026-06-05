/**
 * 配额检查服务
 *
 * 实现多种配额的检查和管理：
 * - 设备配额
 * - 存储配额
 * - API 调用配额
 * - 消息配额
 * - 流量配额
 *
 * 功能：
 * - 实时配额检查
 * - 配额预警
 * - 超限处理
 * - 配额统计
 * - 自动恢复
 */
import { Provide, Inject, Init, Scope, ScopeEnum, Config } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { CacheManager, IdGenerator, JsonUtil } from '@baby-monitor/shared-utils';
import * as cron from 'node-cron';

/**
 * 配额类型
 */
export enum QuotaType {
  DEVICE = 'device',           // 设备数量
  STORAGE = 'storage',         // 存储空间
  API_CALL = 'api_call',       // API 调用次数
  MESSAGE = 'message',         // 消息数量
  BANDWIDTH = 'bandwidth',     // 流量
  USER = 'user',               // 用户数量
  DOMAIN = 'domain',           // 域名数量
}

/**
 * 配额状态
 */
export enum QuotaStatus {
  NORMAL = 'normal',           // 正常
  WARNING = 'warning',         // 预警
  EXCEEDED = 'exceeded',       // 超限
  SUSPENDED = 'suspended',     // 暂停
}

/**
 * 配额检查结果
 */
export interface QuotaCheckResult {
  allowed: boolean;
  quotaType: QuotaType;
  current: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  status: QuotaStatus;
  message?: string;
  resetAt?: Date;
}

/**
 * 配额配置
 */
export interface QuotaConfig {
  id: string;
  userId?: string;
  domainId?: string;
  quotaType: QuotaType;
  softLimit: number;           // 软限制（预警阈值）
  hardLimit: number;           // 硬限制
  period: 'daily' | 'weekly' | 'monthly' | 'total';
  currentUsage: number;
  status: QuotaStatus;
  resetAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 配额使用记录
 */
export interface QuotaUsageRecord {
  id: string;
  userId: string;
  quotaType: QuotaType;
  amount: number;
  action: 'increment' | 'decrement' | 'reset';
  beforeValue: number;
  afterValue: number;
  reason?: string;
  createdAt: Date;
}

/**
 * 配额超限事件
 */
export interface QuotaExceededEvent {
  userId: string;
  quotaType: QuotaType;
  current: number;
  limit: number;
  percentUsed: number;
  exceededAt: Date;
  action: 'warning' | 'blocked' | 'suspended';
}

/**
 * 配额检查服务
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class QuotaCheckService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  @Config('quota')
  quotaConfig: {
    warningThreshold: number;    // 预警阈值百分比
    checkInterval: number;       // 检查间隔（秒）
    autoRecover: boolean;        // 是否自动恢复
  };

  // Redis 键前缀
  private readonly QUOTA_PREFIX = 'quota:config:';
  private readonly USAGE_PREFIX = 'quota:usage:';
  private readonly LOCK_PREFIX = 'quota:lock:';
  private readonly EVENT_PREFIX = 'quota:event:';

  // 默认配置
  private readonly DEFAULT_WARNING_THRESHOLD = 80; // 80%
  private readonly TTL = 86400 * 30; // 30天

  // 配额限制默认值
  private readonly DEFAULT_LIMITS: Record<QuotaType, { soft: number; hard: number }> = {
    [QuotaType.DEVICE]: { soft: 50, hard: 100 },
    [QuotaType.STORAGE]: { soft: 5 * 1024 * 1024 * 1024, hard: 10 * 1024 * 1024 * 1024 }, // 5GB/10GB
    [QuotaType.API_CALL]: { soft: 5000, hard: 10000 },
    [QuotaType.MESSAGE]: { soft: 1000, hard: 2000 },
    [QuotaType.BANDWIDTH]: { soft: 10 * 1024 * 1024 * 1024, hard: 20 * 1024 * 1024 * 1024 }, // 10GB/20GB
    [QuotaType.USER]: { soft: 10, hard: 20 },
    [QuotaType.DOMAIN]: { soft: 3, hard: 5 },
  };

  // 定时任务
  private scheduledTasks: cron.ScheduledTask[] = [];

  @Init()
  async init(): Promise<void> {
    this.logger.info('[QuotaCheck] Service initializing...');

    // 启动定时检查任务
    this.startScheduledTasks();

    this.logger.info('[QuotaCheck] Service initialized');
  }

  // ==================== 配额检查 API ====================

  /**
   * 检查配额
   */
  async checkQuota(
    userId: string,
    quotaType: QuotaType,
    requestedAmount: number = 1
  ): Promise<QuotaCheckResult> {
    const config = await this.getQuotaConfig(userId, quotaType);
    const usage = await this.getCurrentUsage(userId, quotaType);
    const newUsage = usage + requestedAmount;

    const percentUsed = config.hardLimit > 0 ? (newUsage / config.hardLimit) * 100 : 0;
    const remaining = Math.max(0, config.hardLimit - usage);

    let status = QuotaStatus.NORMAL;
    let message: string | undefined;

    // 判断状态
    const warningThreshold = this.quotaConfig?.warningThreshold || this.DEFAULT_WARNING_THRESHOLD;

    if (newUsage >= config.hardLimit) {
      status = QuotaStatus.EXCEEDED;
      message = `配额已超限：当前使用 ${newUsage}，限制为 ${config.hardLimit}`;
    } else if (newUsage >= config.hardLimit * (warningThreshold / 100)) {
      status = QuotaStatus.WARNING;
      message = `配额即将用尽：已使用 ${percentUsed.toFixed(1)}%`;
    }

    const allowed = newUsage <= config.hardLimit;

    // 如果超限，触发事件
    if (!allowed) {
      await this.triggerExceededEvent(userId, quotaType, newUsage, config.hardLimit, 'blocked');
    } else if (status === QuotaStatus.WARNING) {
      await this.triggerExceededEvent(userId, quotaType, newUsage, config.hardLimit, 'warning');
    }

    return {
      allowed,
      quotaType,
      current: usage,
      limit: config.hardLimit,
      remaining,
      percentUsed,
      status,
      message,
      resetAt: config.resetAt,
    };
  }

  /**
   * 消费配额
   */
  async consumeQuota(
    userId: string,
    quotaType: QuotaType,
    amount: number = 1,
    reason?: string
  ): Promise<QuotaCheckResult> {
    // 先检查
    const checkResult = await this.checkQuota(userId, quotaType, amount);
    if (!checkResult.allowed) {
      return checkResult;
    }

    // 获取锁
    const lock = await this.acquireLock(userId, quotaType);
    if (!lock) {
      throw new Error('Failed to acquire quota lock');
    }

    try {
      const beforeValue = await this.getCurrentUsage(userId, quotaType);
      const afterValue = beforeValue + amount;

      // 更新使用量
      await this.updateUsage(userId, quotaType, afterValue);

      // 记录使用
      await this.recordUsage(userId, quotaType, amount, 'increment', beforeValue, afterValue, reason);

      // 更新结果
      checkResult.current = afterValue;
      checkResult.remaining = Math.max(0, checkResult.limit - afterValue);
      checkResult.percentUsed = checkResult.limit > 0 ? (afterValue / checkResult.limit) * 100 : 0;

      return checkResult;
    } finally {
      await this.releaseLock(userId, quotaType);
    }
  }

  /**
   * 释放配额
   */
  async releaseQuota(
    userId: string,
    quotaType: QuotaType,
    amount: number = 1,
    reason?: string
  ): Promise<void> {
    const lock = await this.acquireLock(userId, quotaType);
    if (!lock) {
      throw new Error('Failed to acquire quota lock');
    }

    try {
      const beforeValue = await this.getCurrentUsage(userId, quotaType);
      const afterValue = Math.max(0, beforeValue - amount);

      // 更新使用量
      await this.updateUsage(userId, quotaType, afterValue);

      // 记录使用
      await this.recordUsage(userId, quotaType, -amount, 'decrement', beforeValue, afterValue, reason);
    } finally {
      await this.releaseLock(userId, quotaType);
    }
  }

  /**
   * 重置配额
   */
  async resetQuota(userId: string, quotaType: QuotaType, reason?: string): Promise<void> {
    const beforeValue = await this.getCurrentUsage(userId, quotaType);

    // 重置使用量
    await this.updateUsage(userId, quotaType, 0);

    // 记录
    await this.recordUsage(userId, quotaType, 0, 'reset', beforeValue, 0, reason || 'Period reset');

    this.logger.info(`[QuotaCheck] Quota reset for ${userId}:${quotaType}`);
  }

  // ==================== 配额配置管理 ====================

  /**
   * 获取配额配置
   */
  async getQuotaConfig(userId: string, quotaType: QuotaType): Promise<QuotaConfig> {
    const key = `${this.QUOTA_PREFIX}${userId}:${quotaType}`;
    const data = await this.redis.get(key);

    if (data) {
      const config = JsonUtil.parse<QuotaConfig>(data);
      if (config) {
        return config;
      }
    }

    // 创建默认配置
    const defaultLimits = this.DEFAULT_LIMITS[quotaType];
    const config: QuotaConfig = {
      id: IdGenerator.uuid(),
      userId,
      quotaType,
      softLimit: defaultLimits.soft,
      hardLimit: defaultLimits.hard,
      period: 'monthly',
      currentUsage: 0,
      status: QuotaStatus.NORMAL,
      resetAt: this.calculateResetDate('monthly'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.saveQuotaConfig(config);
    return config;
  }

  /**
   * 设置配额配置
   */
  async setQuotaConfig(
    userId: string,
    quotaType: QuotaType,
    config: Partial<QuotaConfig>
  ): Promise<QuotaConfig> {
    const existing = await this.getQuotaConfig(userId, quotaType);

    const updated: QuotaConfig = {
      ...existing,
      ...config,
      userId,
      quotaType,
      updatedAt: new Date(),
    };

    await this.saveQuotaConfig(updated);
    return updated;
  }

  /**
   * 获取用户所有配额概览
   */
  async getUserQuotaOverview(userId: string): Promise<{
    quotas: Array<{
      type: QuotaType;
      config: QuotaConfig;
      usage: number;
      percentUsed: number;
      status: QuotaStatus;
    }>;
    hasExceeded: boolean;
    hasWarning: boolean;
  }> {
    const quotaTypes = Object.values(QuotaType);
    const quotas: any[] = [];
    let hasExceeded = false;
    let hasWarning = false;

    for (const type of quotaTypes) {
      const config = await this.getQuotaConfig(userId, type);
      const usage = await this.getCurrentUsage(userId, type);
      const percentUsed = config.hardLimit > 0 ? (usage / config.hardLimit) * 100 : 0;

      let status = QuotaStatus.NORMAL;
      if (usage >= config.hardLimit) {
        status = QuotaStatus.EXCEEDED;
        hasExceeded = true;
      } else if (usage >= config.softLimit) {
        status = QuotaStatus.WARNING;
        hasWarning = true;
      }

      quotas.push({
        type,
        config,
        usage,
        percentUsed,
        status,
      });
    }

    return { quotas, hasExceeded, hasWarning };
  }

  // ==================== 私有方法 ====================

  /**
   * 获取当前使用量
   */
  private async getCurrentUsage(userId: string, quotaType: QuotaType): Promise<number> {
    const key = `${this.USAGE_PREFIX}${userId}:${quotaType}`;
    const usage = await this.redis.get(key);
    return usage ? parseInt(usage, 10) : 0;
  }

  /**
   * 更新使用量
   */
  private async updateUsage(userId: string, quotaType: QuotaType, value: number): Promise<void> {
    const key = `${this.USAGE_PREFIX}${userId}:${quotaType}`;
    await this.redis.set(key, value.toString());
    await this.redis.expire(key, this.TTL);
  }

  /**
   * 保存配额配置
   */
  private async saveQuotaConfig(config: QuotaConfig): Promise<void> {
    const key = `${this.QUOTA_PREFIX}${config.userId}:${config.quotaType}`;
    await this.redis.set(key, JsonUtil.stringify(config));
    await this.redis.expire(key, this.TTL);
  }

  /**
   * 记录使用
   */
  private async recordUsage(
    userId: string,
    quotaType: QuotaType,
    amount: number,
    action: 'increment' | 'decrement' | 'reset',
    beforeValue: number,
    afterValue: number,
    reason?: string
  ): Promise<void> {
    const record: QuotaUsageRecord = {
      id: IdGenerator.uuid(),
      userId,
      quotaType,
      amount,
      action,
      beforeValue,
      afterValue,
      reason,
      createdAt: new Date(),
    };

    // 保存到 Redis 列表
    const key = `${this.USAGE_PREFIX}${userId}:${quotaType}:history`;
    await this.redis.rpush(key, JsonUtil.stringify(record));
    await this.redis.ltrim(key, -1000, -1); // 保留最近1000条
    await this.redis.expire(key, this.TTL);
  }

  /**
   * 触发超限事件
   */
  private async triggerExceededEvent(
    userId: string,
    quotaType: QuotaType,
    current: number,
    limit: number,
    action: 'warning' | 'blocked' | 'suspended'
  ): Promise<void> {
    const event: QuotaExceededEvent = {
      userId,
      quotaType,
      current,
      limit,
      percentUsed: limit > 0 ? (current / limit) * 100 : 0,
      exceededAt: new Date(),
      action,
    };

    // 保存事件
    const key = `${this.EVENT_PREFIX}${userId}:${quotaType}`;
    await this.redis.rpush(key, JsonUtil.stringify(event));
    await this.redis.ltrim(key, -100, -1); // 保留最近100条
    await this.redis.expire(key, this.TTL);

    // 发布到 Redis 频道
    await this.redis.publish('quota:exceeded', JsonUtil.stringify(event));

    // 添加到警告队列（供提醒服务处理）
    await this.redis.sadd('quota:warnings', JsonUtil.stringify({
      userId,
      quotaType,
      used: current,
      limit,
      exceeded: action === 'blocked',
    }));

    this.logger.warn(
      `[QuotaCheck] Quota ${action}: ${userId}:${quotaType}, used ${current}/${limit}`
    );
  }

  /**
   * 计算重置日期
   */
  private calculateResetDate(period: 'daily' | 'weekly' | 'monthly' | 'total'): Date {
    const now = new Date();

    switch (period) {
      case 'daily':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      case 'weekly':
        const dayOfWeek = now.getDay();
        const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSunday);
      case 'monthly':
        return new Date(now.getFullYear(), now.getMonth() + 1, 1);
      case 'total':
      default:
        return new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    }
  }

  /**
   * 获取分布式锁
   */
  private async acquireLock(userId: string, quotaType: QuotaType): Promise<boolean> {
    const key = `${this.LOCK_PREFIX}${userId}:${quotaType}`;
    const result = await this.redis.set(key, '1', 'PX', 5000, 'NX');
    return result === 'OK';
  }

  /**
   * 释放分布式锁
   */
  private async releaseLock(userId: string, quotaType: QuotaType): Promise<void> {
    const key = `${this.LOCK_PREFIX}${userId}:${quotaType}`;
    await this.redis.del(key);
  }

  // ==================== 定时任务 ====================

  /**
   * 启动定时任务
   */
  private startScheduledTasks(): void {
    // 每天凌晨重置日配额
    const dailyTask = cron.schedule('0 0 * * *', async () => {
      await this.resetPeriodQuotas('daily');
    }, { scheduled: true, timezone: 'Asia/Shanghai' });
    this.scheduledTasks.push(dailyTask);

    // 每周一凌晨重置周配额
    const weeklyTask = cron.schedule('0 0 * * 1', async () => {
      await this.resetPeriodQuotas('weekly');
    }, { scheduled: true, timezone: 'Asia/Shanghai' });
    this.scheduledTasks.push(weeklyTask);

    // 每月1日凌晨重置月配额
    const monthlyTask = cron.schedule('0 0 1 * *', async () => {
      await this.resetPeriodQuotas('monthly');
    }, { scheduled: true, timezone: 'Asia/Shanghai' });
    this.scheduledTasks.push(monthlyTask);

    // 每小时检查超限配额
    const checkTask = cron.schedule('0 * * * *', async () => {
      await this.checkAllQuotas();
    }, { scheduled: true, timezone: 'Asia/Shanghai' });
    this.scheduledTasks.push(checkTask);

    this.logger.info('[QuotaCheck] Scheduled tasks started');
  }

  /**
   * 重置周期配额
   */
  private async resetPeriodQuotas(period: 'daily' | 'weekly' | 'monthly'): Promise<void> {
    this.logger.info(`[QuotaCheck] Resetting ${period} quotas...`);

    // 获取所有配额配置键
    const keys = await this.redis.keys(`${this.QUOTA_PREFIX}*`);
    let resetCount = 0;

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (!data) continue;

      const config = JsonUtil.parse<QuotaConfig>(data);
      if (config && config.period === period) {
        await this.resetQuota(config.userId!, config.quotaType, `${period} reset`);
        resetCount++;
      }
    }

    this.logger.info(`[QuotaCheck] Reset ${resetCount} ${period} quotas`);
  }

  /**
   * 检查所有配额
   */
  private async checkAllQuotas(): Promise<void> {
    this.logger.debug('[QuotaCheck] Checking all quotas...');

    // 获取所有使用量键
    const keys = await this.redis.keys(`${this.USAGE_PREFIX}*:history`);
    const userQuotaSet = new Set<string>();

    for (const key of keys) {
      // 解析 userId:quotaType
      const match = key.match(/quota:usage:([^:]+):([^:]+):history/);
      if (match) {
        userQuotaSet.add(`${match[1]}:${match[2]}`);
      }
    }

    for (const userQuota of userQuotaSet) {
      const [userId, quotaTypeStr] = userQuota.split(':');
      const quotaType = quotaTypeStr as QuotaType;

      try {
        const config = await this.getQuotaConfig(userId, quotaType);
        const usage = await this.getCurrentUsage(userId, quotaType);

        // 检查是否超限
        if (usage >= config.hardLimit) {
          await this.triggerExceededEvent(userId, quotaType, usage, config.hardLimit, 'blocked');
        } else if (usage >= config.softLimit) {
          await this.triggerExceededEvent(userId, quotaType, usage, config.hardLimit, 'warning');
        }
      } catch (error: any) {
        this.logger.error(`[QuotaCheck] Error checking quota ${userQuota}:`, error);
      }
    }
  }

  /**
   * 获取配额使用历史
   */
  async getUsageHistory(
    userId: string,
    quotaType: QuotaType,
    limit: number = 100
  ): Promise<QuotaUsageRecord[]> {
    const key = `${this.USAGE_PREFIX}${userId}:${quotaType}:history`;
    const records = await this.redis.lrange(key, -limit, -1);

    return records.map(r => JsonUtil.parse<QuotaUsageRecord>(r)).filter((r): r is QuotaUsageRecord => r !== null).reverse();
  }

  /**
   * 获取超限事件历史
   */
  async getExceededEvents(
    userId: string,
    quotaType?: QuotaType,
    limit: number = 50
  ): Promise<QuotaExceededEvent[]> {
    if (quotaType) {
      const key = `${this.EVENT_PREFIX}${userId}:${quotaType}`;
      const events = await this.redis.lrange(key, -limit, -1);
      return events.map(e => JsonUtil.parse<QuotaExceededEvent>(e)).filter((e): e is QuotaExceededEvent => e !== null).reverse();
    } else {
      // 获取所有类型的超限事件
      const allEvents: QuotaExceededEvent[] = [];
      for (const type of Object.values(QuotaType)) {
        const key = `${this.EVENT_PREFIX}${userId}:${type}`;
        const events = await this.redis.lrange(key, -limit / 2, -1);
        allEvents.push(...events.map(e => JsonUtil.parse<QuotaExceededEvent>(e)).filter((e): e is QuotaExceededEvent => e !== null));
      }
      return allEvents.sort((a, b) => b.exceededAt.getTime() - a.exceededAt.getTime()).slice(0, limit);
    }
  }

  /**
   * 销毁服务
   */
  async destroy(): Promise<void> {
    for (const task of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks = [];
    this.logger.info('[QuotaCheck] Service destroyed');
  }
}
