import { Provide, Inject } from '@midwayjs/core';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';

/**
 * 设备生命周期状态
 */
export enum DeviceLifecycleState {
  /** 已预配 - 设备已创建但未激活 */
  PROVISIONED = 'provisioned',
  /** 已激活 - 设备已激活并连接 */
  ACTIVATED = 'activated',
  /** 在线 - 设备正常在线工作 */
  ONLINE = 'online',
  /** 离线 - 设备暂时离线 */
  OFFLINE = 'offline',
  /** 维护中 - 设备处于维护模式 */
  MAINTENANCE = 'maintenance',
  /** 已弃用 - 设备已弃用，将被替换 */
  DEPRECATED = 'deprecated',
  /** 已退役 - 设备已退役，不再使用 */
  RETIRED = 'retired',
  /** 已删除 - 设备已从系统中删除 */
  DELETED = 'deleted',
}

/**
 * 状态转换事件
 */
export interface StateTransitionEvent {
  /** 事件ID */
  id: string;
  /** 设备ID */
  deviceId: string;
  /** 源状态 */
  fromState: DeviceLifecycleState;
  /** 目标状态 */
  toState: DeviceLifecycleState;
  /** 转换时间 */
  timestamp: number;
  /** 转换原因 */
  reason: string;
  /** 操作人 */
  operator?: string;
  /** 额外数据 */
  metadata?: Record<string, any>;
}

/**
 * 设备生命周期状态
 */
export interface DeviceLifecycleStatus {
  /** 设备ID */
  deviceId: string;
  /** 当前状态 */
  currentState: DeviceLifecycleState;
  /** 状态进入时间 */
  stateEnteredAt: number;
  /** 在当前状态的时长（毫秒） */
  stateDuration: number;
  /** 状态历史 */
  stateHistory: StateTransitionEvent[];
  /** 最后活动时间 */
  lastActivityAt: number;
  /** 在线总时长（毫秒） */
  totalOnlineTime: number;
  /** 离线总时长（毫秒） */
  totalOfflineTime: number;
  /** 激活时间 */
  activatedAt?: number;
  /** 预计退役时间 */
  expectedRetirementAt?: number;
}

/**
 * 生命周期统计
 */
export interface LifecycleStatistics {
  /** 总设备数 */
  totalDevices: number;
  /** 按状态统计 */
  byState: Record<DeviceLifecycleState, number>;
  /** 平均在线时长（小时） */
  avgOnlineTime: number;
  /** 平均离线时长（小时） */
  avgOfflineTime: number;
  /** 今日激活数量 */
  todayActivations: number;
  /** 今日退役数量 */
  todayRetirements: number;
}

/**
 * 状态转换规则
 */
interface TransitionRule {
  /** 允许的源状态 */
  fromStates: DeviceLifecycleState[];
  /** 目标状态 */
  toState: DeviceLifecycleState;
  /** 是否需要确认 */
  requiresConfirmation: boolean;
  /** 是否自动转换 */
  automatic: boolean;
  /** 转换条件检查 */
  condition?: (current: DeviceLifecycleStatus) => boolean;
}

/**
 * 设备生命周期管理服务
 * 管理设备从创建到退役的完整生命周期
 */
@Provide()
export class DeviceLifecycleService {
  @Inject()
  redis!: RedisService;

  @Inject()
  logger!: ILogger;

  private readonly STATUS_PREFIX = 'device:lifecycle:status:';
  private readonly HISTORY_PREFIX = 'device:lifecycle:history:';
  private readonly STATS_KEY = 'device:lifecycle:stats';
  private readonly DEFAULT_TTL = 86400 * 30; // 30天

  // 状态转换规则
  private transitionRules: Map<string, TransitionRule> = new Map();

  constructor() {
    this.initializeTransitionRules();
  }

  /**
   * 初始化设备生命周期
   *
   * @param deviceId 设备ID
   * @param initialState 初始状态
   * @returns 是否成功
   */
  async initialize(deviceId: string, initialState: DeviceLifecycleState = DeviceLifecycleState.PROVISIONED): Promise<boolean> {
    try {
      const existing = await this.getStatus(deviceId);
      if (existing) {
        this.logger.warn(`[DeviceLifecycle] Device ${deviceId} already initialized`);
        return false;
      }

      const now = Date.now();
      const status: DeviceLifecycleStatus = {
        deviceId,
        currentState: initialState,
        stateEnteredAt: now,
        stateDuration: 0,
        stateHistory: [],
        lastActivityAt: now,
        totalOnlineTime: 0,
        totalOfflineTime: 0,
      };

      await this.saveStatus(deviceId, status);

      // 记录初始状态
      await this.recordTransition(deviceId, null, initialState, 'Device initialized');

      // 更新统计
      await this.incrementStateCount(initialState);

      this.logger.info(`[DeviceLifecycle] Initialized device ${deviceId} with state ${initialState}`);
      return true;
    } catch (error) {
      this.logger.error('[DeviceLifecycle] Error initializing device:', error);
      return false;
    }
  }

  /**
   * 转换设备状态
   *
   * @param deviceId 设备ID
   * @param targetState 目标状态
   * @param reason 转换原因
   * @param operator 操作人
   * @returns 是否成功
   */
  async transitionState(
    deviceId: string,
    targetState: DeviceLifecycleState,
    reason: string,
    operator?: string
  ): Promise<boolean> {
    try {
      const status = await this.getStatus(deviceId);
      if (!status) {
        this.logger.error(`[DeviceLifecycle] Device ${deviceId} not found`);
        return false;
      }

      const currentState = status.currentState;

      // 检查是否已经是目标状态
      if (currentState === targetState) {
        this.logger.debug(`[DeviceLifecycle] Device ${deviceId} already in state ${targetState}`);
        return true;
      }

      // 验证状态转换是否允许
      const rule = this.getTransitionRule(currentState, targetState);
      if (!rule) {
        this.logger.error(`[DeviceLifecycle] Invalid transition from ${currentState} to ${targetState}`);
        return false;
      }

      // 检查转换条件
      if (rule.condition && !rule.condition(status)) {
        this.logger.error(`[DeviceLifecycle] Transition condition not met for device ${deviceId}`);
        return false;
      }

      const now = Date.now();

      // 更新状态时长统计
      await this.updateStateDuration(status, now);

      // 转换状态
      const previousState = status.currentState;
      status.currentState = targetState;
      status.stateEnteredAt = now;
      status.stateDuration = 0;

      // 特殊状态处理
      if (targetState === DeviceLifecycleState.ACTIVATED && !status.activatedAt) {
        status.activatedAt = now;
      }

      await this.saveStatus(deviceId, status);

      // 记录转换
      await this.recordTransition(deviceId, previousState, targetState, reason, operator);

      // 更新统计
      await this.updateStateCounts(previousState, targetState);

      this.logger.info(`[DeviceLifecycle] Device ${deviceId} transitioned from ${previousState} to ${targetState}: ${reason}`);
      return true;
    } catch (error) {
      this.logger.error('[DeviceLifecycle] Error transitioning state:', error);
      return false;
    }
  }

  /**
   * 更新设备活动时间
   *
   * @param deviceId 设备ID
   */
  async updateActivity(deviceId: string): Promise<void> {
    try {
      const status = await this.getStatus(deviceId);
      if (!status) {
        return;
      }

      const now = Date.now();
      status.lastActivityAt = now;

      // 如果设备是离线状态，自动转为在线
      if (status.currentState === DeviceLifecycleState.OFFLINE) {
        await this.transitionState(deviceId, DeviceLifecycleState.ONLINE, 'Device came back online');
      }

      await this.saveStatus(deviceId, status);
    } catch (error) {
      this.logger.error('[DeviceLifecycle] Error updating activity:', error);
    }
  }

  /**
   * 检查设备是否在线
   *
   * @param deviceId 设备ID
   * @param timeout 超时时间（秒）
   * @returns 是否在线
   */
  async isOnline(deviceId: string, timeout: number = 300): Promise<boolean> {
    try {
      const status = await this.getStatus(deviceId);
      if (!status) {
        return false;
      }

      if (status.currentState === DeviceLifecycleState.ONLINE) {
        return true;
      }

      // 检查最后活动时间
      const now = Date.now();
      const timeSinceLastActivity = (now - status.lastActivityAt) / 1000;
      return timeSinceLastActivity < timeout;
    } catch (error) {
      this.logger.error('[DeviceLifecycle] Error checking online status:', error);
      return false;
    }
  }

  /**
   * 获取设备生命周期状态
   *
   * @param deviceId 设备ID
   * @returns 生命周期状态
   */
  async getStatus(deviceId: string): Promise<DeviceLifecycleStatus | null> {
    try {
      const key = `${this.STATUS_PREFIX}${deviceId}`;
      const data = await this.redis.get(key);

      if (data) {
        const status: DeviceLifecycleStatus = JSON.parse(data);
        // 更新状态时长
        const now = Date.now();
        status.stateDuration = now - status.stateEnteredAt;
        return status;
      }

      return null;
    } catch (error) {
      this.logger.error('[DeviceLifecycle] Error getting status:', error);
      return null;
    }
  }

  /**
   * 获取设备状态历史
   *
   * @param deviceId 设备ID
   * @param limit 限制数量
   * @returns 状态历史
   */
  async getStateHistory(deviceId: string, limit: number = 50): Promise<StateTransitionEvent[]> {
    try {
      const key = `${this.HISTORY_PREFIX}${deviceId}`;
      const events = await this.redis.lrange(key, 0, limit - 1);

      return events.map(event => JSON.parse(event) as StateTransitionEvent);
    } catch (error) {
      this.logger.error('[DeviceLifecycle] Error getting state history:', error);
      return [];
    }
  }

  /**
   * 批量获取设备状态
   *
   * @param deviceIds 设备ID列表
   * @returns 设备状态映射
   */
  async getStatusBatch(deviceIds: string[]): Promise<Map<string, DeviceLifecycleStatus>> {
    const statusMap = new Map<string, DeviceLifecycleStatus>();

    for (const deviceId of deviceIds) {
      const status = await this.getStatus(deviceId);
      if (status) {
        statusMap.set(deviceId, status);
      }
    }

    return statusMap;
  }

  /**
   * 获取生命周期统计
   *
   * @returns 统计信息
   */
  async getStatistics(): Promise<LifecycleStatistics> {
    try {
      const statsData = await this.redis.hgetall(this.STATS_KEY);

      const byState: Record<DeviceLifecycleState, number> = {
        [DeviceLifecycleState.PROVISIONED]: parseInt(statsData.provisioned || '0', 10),
        [DeviceLifecycleState.ACTIVATED]: parseInt(statsData.activated || '0', 10),
        [DeviceLifecycleState.ONLINE]: parseInt(statsData.online || '0', 10),
        [DeviceLifecycleState.OFFLINE]: parseInt(statsData.offline || '0', 10),
        [DeviceLifecycleState.MAINTENANCE]: parseInt(statsData.maintenance || '0', 10),
        [DeviceLifecycleState.DEPRECATED]: parseInt(statsData.deprecated || '0', 10),
        [DeviceLifecycleState.RETIRED]: parseInt(statsData.retired || '0', 10),
        [DeviceLifecycleState.DELETED]: parseInt(statsData.deleted || '0', 10),
      };

      const totalDevices = Object.values(byState).reduce((sum, count) => sum + count, 0);

      return {
        totalDevices,
        byState,
        avgOnlineTime: parseFloat(statsData.avgOnlineTime || '0'),
        avgOfflineTime: parseFloat(statsData.avgOfflineTime || '0'),
        todayActivations: parseInt(statsData.todayActivations || '0', 10),
        todayRetirements: parseInt(statsData.todayRetirements || '0', 10),
      };
    } catch (error) {
      this.logger.error('[DeviceLifecycle] Error getting statistics:', error);
      return {
        totalDevices: 0,
        byState: {
          [DeviceLifecycleState.PROVISIONED]: 0,
          [DeviceLifecycleState.ACTIVATED]: 0,
          [DeviceLifecycleState.ONLINE]: 0,
          [DeviceLifecycleState.OFFLINE]: 0,
          [DeviceLifecycleState.MAINTENANCE]: 0,
          [DeviceLifecycleState.DEPRECATED]: 0,
          [DeviceLifecycleState.RETIRED]: 0,
          [DeviceLifecycleState.DELETED]: 0,
        },
        avgOnlineTime: 0,
        avgOfflineTime: 0,
        todayActivations: 0,
        todayRetirements: 0,
      };
    }
  }

  /**
   * 查询指定状态的设备
   *
   * @param state 状态
   * @returns 设备ID列表
   */
  async getDevicesByState(state: DeviceLifecycleState): Promise<string[]> {
    try {
      const pattern = `${this.STATUS_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      const deviceIds: string[] = [];

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const status: DeviceLifecycleStatus = JSON.parse(data);
          if (status.currentState === state) {
            deviceIds.push(status.deviceId);
          }
        }
      }

      return deviceIds;
    } catch (error) {
      this.logger.error('[DeviceLifecycle] Error getting devices by state:', error);
      return [];
    }
  }

  /**
   * 设置预计退役时间
   *
   * @param deviceId 设备ID
   * @param retirementDate 退役日期
   */
  async setExpectedRetirement(deviceId: string, retirementDate: Date): Promise<void> {
    try {
      const status = await this.getStatus(deviceId);
      if (!status) {
        throw new Error(`Device ${deviceId} not found`);
      }

      status.expectedRetirementAt = retirementDate.getTime();
      await this.saveStatus(deviceId, status);

      this.logger.info(`[DeviceLifecycle] Set expected retirement for device ${deviceId}: ${retirementDate.toISOString()}`);
    } catch (error) {
      this.logger.error('[DeviceLifecycle] Error setting expected retirement:', error);
      throw error;
    }
  }

  /**
   * 获取即将退役的设备
   *
   * @param days 天数
   * @returns 设备列表
   */
  async getUpcomingRetirements(days: number = 30): Promise<Array<{
    deviceId: string;
    expectedRetirementAt: Date;
    currentState: DeviceLifecycleState;
  }>> {
    try {
      const pattern = `${this.STATUS_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      const now = Date.now();
      const cutoffTime = now + (days * 24 * 60 * 60 * 1000);
      const upcomingRetirements: Array<{
        deviceId: string;
        expectedRetirementAt: Date;
        currentState: DeviceLifecycleState;
      }> = [];

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const status: DeviceLifecycleStatus = JSON.parse(data);
          if (status.expectedRetirementAt && status.expectedRetirementAt > now && status.expectedRetirementAt <= cutoffTime) {
            upcomingRetirements.push({
              deviceId: status.deviceId,
              expectedRetirementAt: new Date(status.expectedRetirementAt),
              currentState: status.currentState,
            });
          }
        }
      }

      // 按退役时间排序
      upcomingRetirements.sort((a, b) => a.expectedRetirementAt.getTime() - b.expectedRetirementAt.getTime());

      return upcomingRetirements;
    } catch (error) {
      this.logger.error('[DeviceLifecycle] Error getting upcoming retirements:', error);
      return [];
    }
  }

  /**
   * 删除设备生命周期记录
   *
   * @param deviceId 设备ID
   */
  async delete(deviceId: string): Promise<void> {
    try {
      const statusKey = `${this.STATUS_PREFIX}${deviceId}`;
      const historyKey = `${this.HISTORY_PREFIX}${deviceId}`;

      await this.redis.del(statusKey, historyKey);

      this.logger.info(`[DeviceLifecycle] Deleted lifecycle record for device ${deviceId}`);
    } catch (error) {
      this.logger.error('[DeviceLifecycle] Error deleting device:', error);
    }
  }

  /**
   * 批量转换设备状态
   *
   * @param deviceIds 设备ID列表
   * @param targetState 目标状态
   * @param reason 转换原因
   * @param operator 操作人
   * @returns 成功转换的数量
   */
  async transitionBatch(
    deviceIds: string[],
    targetState: DeviceLifecycleState,
    reason: string,
    operator?: string
  ): Promise<number> {
    let successCount = 0;

    for (const deviceId of deviceIds) {
      const success = await this.transitionState(deviceId, targetState, reason, operator);
      if (success) {
        successCount++;
      }
    }

    this.logger.info(`[DeviceLifecycle] Batch transition: ${successCount}/${deviceIds.length} devices to ${targetState}`);
    return successCount;
  }

  /**
   * 初始化状态转换规则
   */
  private initializeTransitionRules(): void {
    // PROVISIONED -> ACTIVATED
    this.addTransitionRule({
      fromStates: [DeviceLifecycleState.PROVISIONED],
      toState: DeviceLifecycleState.ACTIVATED,
      requiresConfirmation: false,
      automatic: false,
    });

    // ACTIVATED -> ONLINE
    this.addTransitionRule({
      fromStates: [DeviceLifecycleState.ACTIVATED],
      toState: DeviceLifecycleState.ONLINE,
      requiresConfirmation: false,
      automatic: true,
    });

    // ONLINE <-> OFFLINE
    this.addTransitionRule({
      fromStates: [DeviceLifecycleState.ONLINE],
      toState: DeviceLifecycleState.OFFLINE,
      requiresConfirmation: false,
      automatic: true,
      condition: (status) => {
        const timeout = 5 * 60 * 1000; // 5分钟
        return Date.now() - status.lastActivityAt > timeout;
      },
    });

    this.addTransitionRule({
      fromStates: [DeviceLifecycleState.OFFLINE],
      toState: DeviceLifecycleState.ONLINE,
      requiresConfirmation: false,
      automatic: true,
    });

    // Any -> MAINTENANCE
    this.addTransitionRule({
      fromStates: [
        DeviceLifecycleState.ONLINE,
        DeviceLifecycleState.OFFLINE,
        DeviceLifecycleState.DEPRECATED,
      ],
      toState: DeviceLifecycleState.MAINTENANCE,
      requiresConfirmation: true,
      automatic: false,
    });

    // MAINTENANCE -> ONLINE
    this.addTransitionRule({
      fromStates: [DeviceLifecycleState.MAINTENANCE],
      toState: DeviceLifecycleState.ONLINE,
      requiresConfirmation: true,
      automatic: false,
    });

    // ONLINE/OFFLINE -> DEPRECATED
    this.addTransitionRule({
      fromStates: [DeviceLifecycleState.ONLINE, DeviceLifecycleState.OFFLINE],
      toState: DeviceLifecycleState.DEPRECATED,
      requiresConfirmation: true,
      automatic: false,
    });

    // Any -> RETIRED
    this.addTransitionRule({
      fromStates: [
        DeviceLifecycleState.ONLINE,
        DeviceLifecycleState.OFFLINE,
        DeviceLifecycleState.MAINTENANCE,
        DeviceLifecycleState.DEPRECATED,
      ],
      toState: DeviceLifecycleState.RETIRED,
      requiresConfirmation: true,
      automatic: false,
    });

    // RETIRED -> DELETED
    this.addTransitionRule({
      fromStates: [DeviceLifecycleState.RETIRED],
      toState: DeviceLifecycleState.DELETED,
      requiresConfirmation: true,
      automatic: false,
    });
  }

  /**
   * 添加状态转换规则
   */
  private addTransitionRule(rule: TransitionRule): void {
    const key = `${rule.fromStates.join(',')}:${rule.toState}`;
    this.transitionRules.set(key, rule);
  }

  /**
   * 获取状态转换规则
   */
  private getTransitionRule(fromState: DeviceLifecycleState, toState: DeviceLifecycleState): TransitionRule | null {
    // 直接匹配
    let key = `${fromState}:${toState}`;
    if (this.transitionRules.has(key)) {
      return this.transitionRules.get(key)!;
    }

    // 通配符匹配
    for (const [ruleKey, rule] of this.transitionRules.entries()) {
      if (rule.toState === toState && rule.fromStates.includes(fromState)) {
        return rule;
      }
    }

    return null;
  }

  /**
   * 保存设备状态
   */
  private async saveStatus(deviceId: string, status: DeviceLifecycleStatus): Promise<void> {
    const key = `${this.STATUS_PREFIX}${deviceId}`;
    await this.redis.set(key, JSON.stringify(status), 'EX', this.DEFAULT_TTL);
  }

  /**
   * 记录状态转换
   */
  private async recordTransition(
    deviceId: string,
    fromState: DeviceLifecycleState | null,
    toState: DeviceLifecycleState,
    reason: string,
    operator?: string
  ): Promise<void> {
    const event: StateTransitionEvent = {
      id: `${deviceId}:${Date.now()}`,
      deviceId,
      fromState: fromState || DeviceLifecycleState.PROVISIONED,
      toState,
      timestamp: Date.now(),
      reason,
      operator,
    };

    const key = `${this.HISTORY_PREFIX}${deviceId}`;
    await this.redis.lpush(key, JSON.stringify(event));

    // 限制历史记录长度
    await this.redis.ltrim(key, 0, 99);
    await this.redis.expire(key, this.DEFAULT_TTL);
  }

  /**
   * 更新状态时长统计
   */
  private async updateStateDuration(status: DeviceLifecycleStatus, now: number): Promise<void> {
    const duration = now - status.stateEnteredAt;

    switch (status.currentState) {
      case DeviceLifecycleState.ONLINE:
      case DeviceLifecycleState.ACTIVATED:
        status.totalOnlineTime += duration;
        break;
      case DeviceLifecycleState.OFFLINE:
        status.totalOfflineTime += duration;
        break;
    }
  }

  /**
   * 增加状态计数
   */
  private async incrementStateCount(state: DeviceLifecycleState): Promise<void> {
    await this.redis.hincrby(this.STATS_KEY, state, 1);
  }

  /**
   * 更新状态计数
   */
  private async updateStateCounts(fromState: DeviceLifecycleState, toState: DeviceLifecycleState): Promise<void> {
    await this.redis.hincrby(this.STATS_KEY, fromState, -1);
    await this.redis.hincrby(this.STATS_KEY, toState, 1);

    // 更新今日统计
    const today = new Date().toISOString().split('T')[0];
    if (toState === DeviceLifecycleState.ACTIVATED) {
      await this.redis.hincrby(`${this.STATS_KEY}:${today}`, 'activations', 1);
    } else if (toState === DeviceLifecycleState.RETIRED) {
      await this.redis.hincrby(`${this.STATS_KEY}:${today}`, 'retirements', 1);
    }
  }
}
