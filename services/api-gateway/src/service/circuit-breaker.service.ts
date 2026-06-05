/**
 * 熔断器服务
 *
 * 实现服务熔断模式，防止级联故障，提高系统弹性。
 * 当后端服务出现故障时，熔断器会快速失败，避免请求堆积。
 *
 * 熔断器状态：
 * - CLOSED（关闭）：正常状态，请求正常通过
 * - OPEN（打开）：熔断状态，请求快速失败
 * - HALF_OPEN（半开）：尝试恢复，允许少量请求通过验证服务是否恢复
 *
 * 主要功能：
 * - 服务注册与配置
 * - 熔断状态管理
 * - 调用结果记录
 * - 统计数据收集
 * - 手动控制（打开/关闭/重置）
 */
import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { CacheManager } from '@baby-monitor/shared-utils';

/**
 * 熔断器状态枚举
 */
export enum CircuitState {
  CLOSED = 'closed', // 关闭状态（正常，请求允许通过）
  OPEN = 'open', // 打开状态（熔断，请求快速失败）
  HALF_OPEN = 'half_open', // 半开状态（尝试恢复，允许少量请求）
}

/**
 * 熔断器配置
 */
export interface CircuitBreakerConfig {
  failureThreshold: number; // 失败阈值
  successThreshold: number; // 成功阈值（半开状态）
  timeout: number; // 熔断超时时间（毫秒）
  monitoringPeriod: number; // 监控周期（毫秒）
  halfOpenMaxCalls: number; // 半开状态最大调用次数
}

/**
 * 熔断器状态
 */
export interface CircuitBreakerStatus {
  service: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastStateChange: number;
  nextAttempt?: number;
}

/**
 * 服务调用结果
 */
export interface CallResult {
  success: boolean;
  duration: number;
  error?: string;
}

/**
 * 服务统计
 */
export interface ServiceStatistics {
  service: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageDuration: number;
  currentState: CircuitState;
  stateHistory: Array<{ state: CircuitState; changedAt: number }>;
}

/**
 * 熔断器服务类
 *
 * 采用单例模式，使用 Redis 存储熔断器状态和统计数据。
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class CircuitBreakerService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  // Redis key 前缀
  private readonly BREAKER_PREFIX = 'circuit:breaker:'; // 熔断器状态前缀
  private readonly STATS_PREFIX = 'circuit:stats:'; // 统计数据前缀
  private readonly HISTORY_PREFIX = 'circuit:history:'; // 状态历史前缀

  // 默认熔断器配置
  private readonly DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5, // 失败阈值：连续失败 5 次后打开熔断器
    successThreshold: 2, // 成功阈值：半开状态下连续成功 2 次后关闭熔断器
    timeout: 60000, // 超时时间：熔断器打开后 60 秒尝试恢复
    monitoringPeriod: 10000, // 监控周期：10 秒
    halfOpenMaxCalls: 3, // 半开状态最大调用次数
  };

  // 各服务的熔断器配置（内存缓存）
  private serviceConfigs = new Map<string, CircuitBreakerConfig>();

  /**
   * 注册服务到熔断器
   *
   * 为指定服务配置熔断器。可以自定义配置，未指定的参数使用默认值。
   *
   * @param service - 服务名称
   * @param config - 可选的熔断器配置，会与默认配置合并
   */
  registerService(service: string, config?: Partial<CircuitBreakerConfig>): void {
    // 合并配置：自定义配置覆盖默认配置
    const fullConfig = { ...this.DEFAULT_CONFIG, ...config };
    this.serviceConfigs.set(service, fullConfig);

    // 初始化熔断器状态
    this.initializeState(service);

    console.log(`[Circuit Breaker] Registered service: ${service}`);
  }

  /**
   * 初始化熔断器状态
   *
   * 在 Redis 中创建熔断器的初始状态（仅当不存在时）。
   * 初始状态为 CLOSED，失败和成功计数均为 0。
   *
   * @param service - 服务名称
   */
  private async initializeState(service: string): Promise<void> {
    const key = `${this.BREAKER_PREFIX}${service}`;
    const exists = await this.redis.exists(key);

    // 仅在熔断器不存在时初始化
    if (!exists) {
      const status: CircuitBreakerStatus = {
        service,
        state: CircuitState.CLOSED,
        failureCount: 0,
        successCount: 0,
        lastStateChange: Date.now(),
      };

      await this.redis.set(key, JSON.stringify(status));
    }
  }

  /**
   * 获取服务的熔断器配置
   *
   * 返回指定服务的配置，如果未配置则返回默认配置。
   *
   * @param service - 服务名称
   * @returns 熔断器配置
   */
  private getServiceConfig(service: string): CircuitBreakerConfig {
    return this.serviceConfigs.get(service) || this.DEFAULT_CONFIG;
  }

  /**
   * 获取熔断器当前状态
   *
   * 返回指定服务的熔断器状态信息。
   *
   * @param service - 服务名称
   * @returns 熔断器状态，服务未注册时返回 null
   */
  async getStatus(service: string): Promise<CircuitBreakerStatus | null> {
    const key = `${this.BREAKER_PREFIX}${service}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * 更新熔断器状态
   *
   * 保存状态到 Redis，并记录状态变更历史。
   * 历史记录最多保留 100 条。
   *
   * @param service - 服务名称
   * @param status - 要保存的熔断器状态
   */
  private async updateStatus(service: string, status: CircuitBreakerStatus): Promise<void> {
    const key = `${this.BREAKER_PREFIX}${service}`;
    await this.redis.set(key, JSON.stringify(status));

    // 记录状态变更历史（用于监控和分析）
    const historyKey = `${this.HISTORY_PREFIX}${service}`;
    const historyEntry = {
      state: status.state,
      changedAt: Date.now(),
    };
    await this.redis.lpush(historyKey, JSON.stringify(historyEntry));
    await this.redis.ltrim(historyKey, 0, 99); // 保留最近 100 条记录
  }

  /**
   * 检查是否可以调用服务
   *
   * 根据熔断器当前状态判断是否允许请求通过。
   * - CLOSED：允许
   * - OPEN：不允许（除非已超时，尝试切换到 HALF_OPEN）
   * - HALF_OPEN：允许（用于探测服务是否恢复）
   *
   * @param service - 服务名称
   * @returns 是否允许调用及拒绝原因
   */
  async canCall(service: string): Promise<{ allowed: boolean; reason?: string }> {
    const status = await this.getStatus(service);
    if (!status) {
      // 未注册的服务，允许调用
      return { allowed: true };
    }

    const config = this.getServiceConfig(service);
    const now = Date.now();

    switch (status.state) {
      case CircuitState.CLOSED:
        // 正常状态，允许调用
        return { allowed: true };

      case CircuitState.OPEN:
        // 熔断状态，检查是否已超时可以尝试恢复
        if (status.nextAttempt && now >= status.nextAttempt) {
          // 切换到半开状态，允许少量请求测试服务是否恢复
          status.state = CircuitState.HALF_OPEN;
          status.successCount = 0;
          status.lastStateChange = now;
          await this.updateStatus(service, status);

          console.log(`[Circuit Breaker] Service ${service} entered HALF_OPEN state`);
          return { allowed: true };
        }

        // 仍在熔断期，拒绝请求
        return {
          allowed: false,
          reason: `Circuit is OPEN for ${service}. Next attempt at ${new Date(status.nextAttempt!).toISOString()}`,
        };

      case CircuitState.HALF_OPEN:
        // 半开状态，允许调用（测试服务是否恢复）
        return { allowed: true };

      default:
        return { allowed: true };
    }
  }

  /**
   * 记录服务调用结果
   *
   * 根据调用结果更新熔断器状态。
   * 成功和失败会触发不同的状态转换逻辑。
   *
   * @param service - 服务名称
   * @param result - 调用结果（成功/失败、耗时、错误信息）
   */
  async recordCall(service: string, result: CallResult): Promise<void> {
    const status = await this.getStatus(service);
    if (!status) {
      return;
    }

    const config = this.getServiceConfig(service);

    // 更新统计数据
    await this.updateStatistics(service, result);

    // 根据结果处理
    if (result.success) {
      await this.recordSuccess(service, status, config);
    } else {
      await this.recordFailure(service, status, config);
    }
  }

  /**
   * 记录成功调用
   *
   * 处理成功调用的逻辑：
   * - 在 HALF_OPEN 状态下，连续成功达到阈值则恢复到 CLOSED
   * - 在其他状态仅更新计数
   *
   * @param service - 服务名称
   * @param status - 当前熔断器状态
   * @param config - 熔断器配置
   */
  private async recordSuccess(
    service: string,
    status: CircuitBreakerStatus,
    config: CircuitBreakerConfig
  ): Promise<void> {
    status.successCount++;

    // 在半开状态，如果成功次数达到阈值，判定服务已恢复
    if (status.state === CircuitState.HALF_OPEN && status.successCount >= config.successThreshold) {
      // 恢复到关闭状态（正常）
      status.state = CircuitState.CLOSED;
      status.failureCount = 0;
      status.successCount = 0;
      status.lastStateChange = Date.now();
      delete status.nextAttempt;

      await this.updateStatus(service, status);
      console.log(`[Circuit Breaker] Service ${service} recovered to CLOSED state`);
    } else {
      await this.updateStatus(service, status);
    }
  }

  /**
   * 记录失败调用
   *
   * 处理失败调用的逻辑：
   * - 在 CLOSED 状态下，连续失败达到阈值则打开熔断器
   * - 在 HALF_OPEN 状态下，任何失败都会立即回到 OPEN
   *
   * @param service - 服务名称
   * @param status - 当前熔断器状态
   * @param config - 熔断器配置
   */
  private async recordFailure(
    service: string,
    status: CircuitBreakerStatus,
    config: CircuitBreakerConfig
  ): Promise<void> {
    status.failureCount++;
    status.lastFailureTime = Date.now();

    // 在关闭状态，如果失败次数达到阈值，打开熔断器
    if (status.state === CircuitState.CLOSED && status.failureCount >= config.failureThreshold) {
      status.state = CircuitState.OPEN;
      status.nextAttempt = Date.now() + config.timeout;
      status.lastStateChange = Date.now();

      await this.updateStatus(service, status);
      console.warn(`[Circuit Breaker] Service ${service} opened due to ${status.failureCount} failures`);
    }
    // 在半开状态，任何失败都会立即重新打开熔断器
    else if (status.state === CircuitState.HALF_OPEN) {
      status.state = CircuitState.OPEN;
      status.nextAttempt = Date.now() + config.timeout;
      status.lastStateChange = Date.now();
      status.successCount = 0;

      await this.updateStatus(service, status);
      console.warn(`[Circuit Breaker] Service ${service} failed in HALF_OPEN state, back to OPEN`);
    } else {
      await this.updateStatus(service, status);
    }
  }

  /**
   * 更新服务统计数据
   *
   * 记录每次调用的统计数据，包括总调用数、成功/失败数、总耗时等。
   * 数据保留 24 小时。
   *
   * @param service - 服务名称
   * @param result - 调用结果
   */
  private async updateStatistics(service: string, result: CallResult): Promise<void> {
    const key = `${this.STATS_PREFIX}${service}`;

    // 获取现有统计数据，不存在则初始化
    const stats = await this.redis.get(key);
    const statistics = stats ? JSON.parse(stats) : { totalCalls: 0, successfulCalls: 0, failedCalls: 0, totalDuration: 0 };

    // 更新统计
    statistics.totalCalls++;
    statistics.totalDuration += result.duration;

    if (result.success) {
      statistics.successfulCalls++;
    } else {
      statistics.failedCalls++;
    }

    await this.redis.set(key, JSON.stringify(statistics));
    await this.redis.expire(key, 86400); // 24 小时过期
  }

  /**
   * 获取服务详细统计
   *
   * 返回服务的调用统计和熔断器状态历史。
   *
   * @param service - 服务名称
   * @returns 服务统计数据，未注册时返回 null
   */
  async getStatistics(service: string): Promise<ServiceStatistics | null> {
    const status = await this.getStatus(service);
    if (!status) {
      return null;
    }

    const statsKey = `${this.STATS_PREFIX}${service}`;
    const statsData = await this.redis.get(statsKey);
    const stats = statsData ? JSON.parse(statsData) : { totalCalls: 0, successfulCalls: 0, failedCalls: 0, totalDuration: 0 };

    // 获取最近 10 条状态历史记录
    const historyKey = `${this.HISTORY_PREFIX}${service}`;
    const historyList = await this.redis.lrange(historyKey, 0, 9);
    const stateHistory = historyList.map(h => JSON.parse(h));

    return {
      service,
      totalCalls: stats.totalCalls,
      successfulCalls: stats.successfulCalls,
      failedCalls: stats.failedCalls,
      averageDuration: stats.totalCalls > 0 ? stats.totalDuration / stats.totalCalls : 0,
      currentState: status.state,
      stateHistory,
    };
  }

  /**
   * 获取所有服务的熔断器状态
   *
   * 返回系统中所有已注册服务的熔断器当前状态。
   *
   * @returns 所有熔断器状态列表
   */
  async getAllStatuses(): Promise<CircuitBreakerStatus[]> {
    const keys = await this.cacheManager.keysByPattern(`${this.BREAKER_PREFIX}*`);
    const statuses: CircuitBreakerStatus[] = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        statuses.push(JSON.parse(data));
      }
    }

    return statuses;
  }

  /**
   * 重置熔断器
   *
   * 将熔断器恢复到初始状态（CLOSED），清零所有计数器。
   * 用于在服务恢复后或手动干预时重置熔断器。
   *
   * @param service - 服务名称
   * @returns 是否成功重置（false 表示服务不存在）
   */
  async reset(service: string): Promise<boolean> {
    const key = `${this.BREAKER_PREFIX}${service}`;
    const exists = await this.redis.exists(key);

    if (!exists) {
      return false;
    }

    // 重置为初始状态
    const status: CircuitBreakerStatus = {
      service,
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastStateChange: Date.now(),
    };

    await this.updateStatus(service, status);
    console.log(`[Circuit Breaker] Reset service ${service}`);

    return true;
  }

  /**
   * 手动打开熔断器
   *
   * 强制将熔断器切换到打开状态，停止所有对该服务的调用。
   * 用于主动维护或紧急情况。
   *
   * @param service - 服务名称
   * @returns 是否成功打开（false 表示服务不存在）
   */
  async open(service: string): Promise<boolean> {
    const status = await this.getStatus(service);
    if (!status) {
      return false;
    }

    status.state = CircuitState.OPEN;
    status.lastStateChange = Date.now();
    status.nextAttempt = Date.now() + this.getServiceConfig(service).timeout;

    await this.updateStatus(service, status);
    console.warn(`[Circuit Breaker] Manually opened service ${service}`);

    return true;
  }

  /**
   * 手动关闭熔断器
   *
   * 强制将熔断器切换到关闭状态，恢复对该服务的调用。
   * 用于服务恢复后快速恢复服务。
   *
   * @param service - 服务名称
   * @returns 是否成功关闭（false 表示服务不存在）
   */
  async close(service: string): Promise<boolean> {
    const status = await this.getStatus(service);
    if (!status) {
      return false;
    }

    status.state = CircuitState.CLOSED;
    status.failureCount = 0;
    status.successCount = 0;
    status.lastStateChange = Date.now();
    delete status.nextAttempt;

    await this.updateStatus(service, status);
    console.log(`[Circuit Breaker] Manually closed service ${service}`);

    return true;
  }

  /**
   * 获取全局统计信息
   *
   * 返回所有服务的汇总统计数据，包括各状态的熔断器数量、成功率等。
   *
   * @returns 全局统计数据
   */
  async getGlobalStatistics(): Promise<{
    totalServices: number;
    openServices: number;
    closedServices: number;
    halfOpenServices: number;
    totalCalls: number;
    totalFailures: number;
    averageSuccessRate: number;
  }> {
    const statuses = await this.getAllStatuses();

    let openServices = 0;
    let closedServices = 0;
    let halfOpenServices = 0;
    let totalCalls = 0;
    let totalFailures = 0;

    // 统计各状态的熔断器数量
    for (const status of statuses) {
      switch (status.state) {
        case CircuitState.OPEN:
          openServices++;
          break;
        case CircuitState.CLOSED:
          closedServices++;
          break;
        case CircuitState.HALF_OPEN:
          halfOpenServices++;
          break;
      }

      // 累加调用统计数据
      const stats = await this.getStatistics(status.service);
      if (stats) {
        totalCalls += stats.totalCalls;
        totalFailures += stats.failedCalls;
      }
    }

    // 计算平均成功率
    const successRate = totalCalls > 0 ? ((totalCalls - totalFailures) / totalCalls) * 100 : 100;

    return {
      totalServices: statuses.length,
      openServices,
      closedServices,
      halfOpenServices,
      totalCalls,
      totalFailures,
      averageSuccessRate: successRate,
    };
  }

  /**
   * 更新服务熔断器配置
   *
   * 动态更新指定服务的熔断器配置参数。
   *
   * @param service - 服务名称
   * @param config - 要更新的配置（部分更新）
   */
  updateConfig(service: string, config: Partial<CircuitBreakerConfig>): void {
    const existing = this.serviceConfigs.get(service);
    const updated = existing ? { ...existing, ...config } : { ...this.DEFAULT_CONFIG, ...config };

    this.serviceConfigs.set(service, updated);
    console.log(`[Circuit Breaker] Updated config for ${service}`, updated);
  }

  /**
   * 移除服务的熔断器
   *
   * 从熔断器管理中移除服务，删除所有相关的状态和统计数据。
   *
   * @param service - 服务名称
   * @returns 是否成功移除
   */
  async removeService(service: string): Promise<boolean> {
    const breakerKey = `${this.BREAKER_PREFIX}${service}`;
    const statsKey = `${this.STATS_PREFIX}${service}`;
    const historyKey = `${this.HISTORY_PREFIX}${service}`;

    // 删除所有相关的 Redis 数据
    await this.redis.del(breakerKey, statsKey, historyKey);
    this.serviceConfigs.delete(service);

    console.log(`[Circuit Breaker] Removed service ${service}`);
    return true;
  }
}
