import { Provide, Inject } from '@midwayjs/core';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * 批量操作类型
 */
export enum BatchOperationType {
  /** 固件升级 */
  FIRMWARE_UPDATE = 'firmware_update',
  /** 配置更新 */
  CONFIG_UPDATE = 'config_update',
  /** 重启设备 */
  REBOOT = 'reboot',
  /** 重置设备 */
  RESET = 'reset',
  /** 获取状态 */
  GET_STATUS = 'get_status',
  /** 执行命令 */
  EXECUTE_COMMAND = 'execute_command',
  /** 批量删除 */
  DELETE = 'delete',
  /** 批量部署 */
  DEPLOY = 'deploy',
  /** 自定义操作 */
  CUSTOM = 'custom',
}

/**
 * 批量操作状态
 */
export enum BatchOperationStatus {
  /** 等待执行 */
  PENDING = 'pending',
  /** 执行中 */
  RUNNING = 'running',
  /** 已完成 */
  COMPLETED = 'completed',
  /** 已失败 */
  FAILED = 'failed',
  /** 已取消 */
  CANCELLED = 'cancelled',
  /** 部分完成 */
  PARTIALLY_COMPLETED = 'partially_completed',
}

/**
 * 单个设备操作结果
 */
export interface DeviceOperationResult {
  /** 设备ID */
  deviceId: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 执行时间（毫秒） */
  duration: number;
  /** 结果数据 */
  data?: any;
  /** 执行时间戳 */
  executedAt: number;
}

/**
 * 批量操作任务
 */
export interface BatchOperationTask {
  /** 任务ID */
  id: string;
  /** 操作类型 */
  type: BatchOperationType;
  /** 操作状态 */
  status: BatchOperationStatus;
  /** 目标设备列表 */
  deviceIds: string[];
  /** 操作参数 */
  params: Record<string, any>;
  /** 创建时间 */
  createdAt: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 创建者 */
  createdBy: string;
  /** 总数 */
  total: number;
  /** 成功数 */
  successCount: number;
  /** 失败数 */
  failureCount: number;
  /** 执行进度 */
  progress: number;
  /** 操作结果 */
  results: DeviceOperationResult[];
  /** 错误信息 */
  error?: string;
  /** 并发数 */
  concurrency: number;
  /** 超时时间（毫秒） */
  timeout: number;
  /** 重试次数 */
  retryCount: number;
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 批量操作配置
 */
export interface BatchOperationConfig {
  /** 默认并发数 */
  defaultConcurrency: number;
  /** 最大并发数 */
  maxConcurrency: number;
  /** 默认超时（毫秒） */
  defaultTimeout: number;
  /** 最大超时（毫秒） */
  maxTimeout: number;
  /** 默认重试次数 */
  defaultRetryCount: number;
  /** 最大重试次数 */
  maxRetryCount: number;
  /** 操作结果保留时间（秒） */
  resultRetentionTime: number;
}

/**
 * 任务创建选项
 */
export interface TaskOptions {
  /** 并发数 */
  concurrency?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 重试次数 */
  retryCount?: number;
}

/**
 * 批量操作统计
 */
export interface BatchOperationStats {
  /** 总任务数 */
  totalTasks: number;
  /** 按状态统计 */
  byStatus: Record<BatchOperationStatus, number>;
  /** 按类型统计 */
  byType: Record<BatchOperationType, number>;
  /** 今日任务数 */
  todayTasks: number;
  /** 平均执行时间（毫秒） */
  avgExecutionTime: number;
  /** 成功率 */
  successRate: number;
}

/**
 * 批量设备操作服务
 * 提供批量设备操作的能力，支持并发控制、重试和进度跟踪
 */
@Provide()
export class BatchDeviceOperationsService {
  @Inject()
  redis!: RedisService;

  @Inject()
  logger!: ILogger;

  private readonly TASK_PREFIX = 'batch:operation:task:';
  private readonly QUEUE_PREFIX = 'batch:operation:queue:';
  private readonly STATS_KEY = 'batch:operation:stats';
  private readonly DEFAULT_RETENTION = 86400 * 7; // 7天

  private config: BatchOperationConfig = {
    defaultConcurrency: 10,
    maxConcurrency: 100,
    defaultTimeout: 30000,
    maxTimeout: 300000,
    defaultRetryCount: 3,
    maxRetryCount: 10,
    resultRetentionTime: this.DEFAULT_RETENTION,
  };

  // 操作处理器映射
  private operationHandlers: Map<BatchOperationType, (deviceId: string, params: any) => Promise<any>> = new Map();

  // 正在执行的任务
  private runningTasks: Set<string> = new Set();

  /**
   * 创建批量操作任务
   *
   * @param type 操作类型
   * @param deviceIds 设备ID列表
   * @param params 操作参数
   * @param createdBy 创建者
   * @param options 可选配置
   * @returns 任务ID
   */
  async createTask(
    type: BatchOperationType,
    deviceIds: string[],
    params: Record<string, any>,
    createdBy: string,
    options?: TaskOptions
  ): Promise<string> {
    const taskId = uuidv4();
    const now = Date.now();

    const task: BatchOperationTask = {
      id: taskId,
      type,
      status: BatchOperationStatus.PENDING,
      deviceIds,
      params,
      createdAt: now,
      createdBy,
      total: deviceIds.length,
      successCount: 0,
      failureCount: 0,
      progress: 0,
      results: [],
      concurrency: options?.concurrency || this.config.defaultConcurrency,
      timeout: options?.timeout || this.config.defaultTimeout,
      retryCount: options?.retryCount || this.config.defaultRetryCount,
    };

    // 限制并发数
    task.concurrency = Math.min(task.concurrency, this.config.maxConcurrency);
    task.timeout = Math.min(task.timeout, this.config.maxTimeout);
    task.retryCount = Math.min(task.retryCount, this.config.maxRetryCount);

    await this.saveTask(task);
    await this.addToQueue(taskId, type);

    this.logger.info(`[BatchOps] Created task ${taskId} for ${deviceIds.length} devices, type: ${type}`);
    return taskId;
  }

  /**
   * 执行批量操作任务
   *
   * @param taskId 任务ID
   */
  async executeTask(taskId: string): Promise<void> {
    if (this.runningTasks.has(taskId)) {
      this.logger.warn(`[BatchOps] Task ${taskId} is already running`);
      return;
    }

    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status !== BatchOperationStatus.PENDING) {
      this.logger.warn(`[BatchOps] Task ${taskId} is not in pending status`);
      return;
    }

    this.runningTasks.add(taskId);

    try {
      // 更新任务状态
      task.status = BatchOperationStatus.RUNNING;
      task.startedAt = Date.now();
      await this.saveTask(task);

      // 获取操作处理器
      const handler = this.operationHandlers.get(task.type);
      if (!handler) {
        throw new Error(`No handler registered for operation type: ${task.type}`);
      }

      // 执行批量操作
      await this.executeBatchOperation(task, handler);

      // 更新最终状态
      task.completedAt = Date.now();
      if (task.failureCount === 0) {
        task.status = BatchOperationStatus.COMPLETED;
      } else if (task.successCount === 0) {
        task.status = BatchOperationStatus.FAILED;
      } else {
        task.status = BatchOperationStatus.PARTIALLY_COMPLETED;
      }

      await this.saveTask(task);
      await this.removeFromQueue(taskId, task.type);

      this.logger.info(`[BatchOps] Task ${taskId} completed: ${task.successCount}/${task.total} succeeded`);
    } catch (error) {
      task.status = BatchOperationStatus.FAILED;
      task.error = (error as Error).message;
      task.completedAt = Date.now();
      await this.saveTask(task);
      await this.removeFromQueue(taskId, task.type);

      this.logger.error(`[BatchOps] Task ${taskId} failed:`, error);
    } finally {
      this.runningTasks.delete(taskId);
    }
  }

  /**
   * 取消批量操作任务
   *
   * @param taskId 任务ID
   */
  async cancelTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status === BatchOperationStatus.RUNNING) {
      task.status = BatchOperationStatus.CANCELLED;
      task.completedAt = Date.now();
      await this.saveTask(task);
      await this.removeFromQueue(taskId, task.type);

      this.logger.info(`[BatchOps] Task ${taskId} cancelled`);
    } else {
      this.logger.warn(`[BatchOps] Cannot cancel task ${taskId} with status ${task.status}`);
    }
  }

  /**
   * 获取任务详情
   *
   * @param taskId 任务ID
   * @returns 任务详情
   */
  async getTask(taskId: string): Promise<BatchOperationTask | null> {
    try {
      const key = `${this.TASK_PREFIX}${taskId}`;
      const data = await this.redis.get(key);

      if (data) {
        return JSON.parse(data) as BatchOperationTask;
      }

      return null;
    } catch (error) {
      this.logger.error('[BatchOps] Error getting task:', error);
      return null;
    }
  }

  /**
   * 获取任务列表
   *
   * @param status 可选的状态过滤
   * @param type 可选的类型过滤
   * @param limit 限制数量
   * @returns 任务列表
   */
  async getTasks(
    status?: BatchOperationStatus,
    type?: BatchOperationType,
    limit: number = 50
  ): Promise<BatchOperationTask[]> {
    try {
      const pattern = `${this.TASK_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      const tasks: BatchOperationTask[] = [];

      for (const key of keys.slice(0, limit)) {
        const data = await this.redis.get(key);
        if (data) {
          const task: BatchOperationTask = JSON.parse(data);
          if ((!status || task.status === status) && (!type || task.type === type)) {
            tasks.push(task);
          }
        }
      }

      // 按创建时间倒序排序
      tasks.sort((a, b) => b.createdAt - a.createdAt);

      return tasks;
    } catch (error) {
      this.logger.error('[BatchOps] Error getting tasks:', error);
      return [];
    }
  }

  /**
   * 获取任务进度
   *
   * @param taskId 任务ID
   * @returns 进度信息
   */
  async getTaskProgress(taskId: string): Promise<{
    taskId: string;
    status: BatchOperationStatus;
    total: number;
    successCount: number;
    failureCount: number;
    progress: number;
    estimatedTimeRemaining?: number;
  } | null> {
    const task = await this.getTask(taskId);
    if (!task) {
      return null;
    }

    const result: {
      taskId: string;
      status: BatchOperationStatus;
      total: number;
      successCount: number;
      failureCount: number;
      progress: number;
      estimatedTimeRemaining?: number;
    } = {
      taskId: task.id,
      status: task.status,
      total: task.total,
      successCount: task.successCount,
      failureCount: task.failureCount,
      progress: task.progress,
    };

    // 估算剩余时间
    if (task.status === BatchOperationStatus.RUNNING && task.startedAt) {
      const elapsed = Date.now() - task.startedAt;
      const completed = task.successCount + task.failureCount;
      if (completed > 0) {
        const avgTimePerDevice = elapsed / completed;
        const remaining = task.total - completed;
        result.estimatedTimeRemaining = Math.floor(avgTimePerDevice * remaining);
      }
    }

    return result;
  }

  /**
   * 注册操作处理器
   *
   * @param type 操作类型
   * @param handler 处理函数
   */
  registerHandler(type: BatchOperationType, handler: (deviceId: string, params: any) => Promise<any>): void {
    this.operationHandlers.set(type, handler);
    this.logger.info(`[BatchOps] Registered handler for ${type}`);
  }

  /**
   * 获取批量操作统计
   *
   * @returns 统计信息
   */
  async getStatistics(): Promise<BatchOperationStats> {
    try {
      const statsData = await this.redis.hgetall(this.STATS_KEY);

      const byStatus: Record<BatchOperationStatus, number> = {
        [BatchOperationStatus.PENDING]: parseInt(statsData.pending || '0', 10),
        [BatchOperationStatus.RUNNING]: parseInt(statsData.running || '0', 10),
        [BatchOperationStatus.COMPLETED]: parseInt(statsData.completed || '0', 10),
        [BatchOperationStatus.FAILED]: parseInt(statsData.failed || '0', 10),
        [BatchOperationStatus.CANCELLED]: parseInt(statsData.cancelled || '0', 10),
        [BatchOperationStatus.PARTIALLY_COMPLETED]: parseInt(statsData.partially_completed || '0', 10),
      };

      const byType: Record<BatchOperationType, number> = {
        [BatchOperationType.FIRMWARE_UPDATE]: parseInt(statsData.firmware_update || '0', 10),
        [BatchOperationType.CONFIG_UPDATE]: parseInt(statsData.config_update || '0', 10),
        [BatchOperationType.REBOOT]: parseInt(statsData.reboot || '0', 10),
        [BatchOperationType.RESET]: parseInt(statsData.reset || '0', 10),
        [BatchOperationType.GET_STATUS]: parseInt(statsData.get_status || '0', 10),
        [BatchOperationType.EXECUTE_COMMAND]: parseInt(statsData.execute_command || '0', 10),
        [BatchOperationType.DELETE]: parseInt(statsData.delete || '0', 10),
        [BatchOperationType.DEPLOY]: parseInt(statsData.deploy || '0', 10),
        [BatchOperationType.CUSTOM]: parseInt(statsData.custom || '0', 10),
      };

      const totalTasks = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
      const completedTasks = byStatus[BatchOperationStatus.COMPLETED] + byStatus[BatchOperationStatus.PARTIALLY_COMPLETED];
      const successRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

      return {
        totalTasks,
        byStatus,
        byType,
        todayTasks: parseInt(statsData.todayTasks || '0', 10),
        avgExecutionTime: parseFloat(statsData.avgExecutionTime || '0'),
        successRate: Math.round(successRate * 100) / 100,
      };
    } catch (error) {
      this.logger.error('[BatchOps] Error getting statistics:', error);
      return {
        totalTasks: 0,
        byStatus: {
          [BatchOperationStatus.PENDING]: 0,
          [BatchOperationStatus.RUNNING]: 0,
          [BatchOperationStatus.COMPLETED]: 0,
          [BatchOperationStatus.FAILED]: 0,
          [BatchOperationStatus.CANCELLED]: 0,
          [BatchOperationStatus.PARTIALLY_COMPLETED]: 0,
        },
        byType: {
          [BatchOperationType.FIRMWARE_UPDATE]: 0,
          [BatchOperationType.CONFIG_UPDATE]: 0,
          [BatchOperationType.REBOOT]: 0,
          [BatchOperationType.RESET]: 0,
          [BatchOperationType.GET_STATUS]: 0,
          [BatchOperationType.EXECUTE_COMMAND]: 0,
          [BatchOperationType.DELETE]: 0,
          [BatchOperationType.DEPLOY]: 0,
          [BatchOperationType.CUSTOM]: 0,
        },
        todayTasks: 0,
        avgExecutionTime: 0,
        successRate: 0,
      };
    }
  }

  /**
   * 清理过期的任务
   *
   * @returns 清理的任务数
   */
  async cleanupExpiredTasks(): Promise<number> {
    try {
      const pattern = `${this.TASK_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      const now = Date.now();
      let cleanedCount = 0;

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const task: BatchOperationTask = JSON.parse(data);
          // 删除已完成超过保留时间的任务
          if (task.completedAt && (now - task.completedAt) > this.config.resultRetentionTime * 1000) {
            await this.redis.del(key);
            cleanedCount++;
          }
        }
      }

      if (cleanedCount > 0) {
        this.logger.info(`[BatchOps] Cleaned up ${cleanedCount} expired tasks`);
      }

      return cleanedCount;
    } catch (error) {
      this.logger.error('[BatchOps] Error cleaning up tasks:', error);
      return 0;
    }
  }

  /**
   * 更新配置
   *
   * @param config 新配置
   */
  updateConfig(config: Partial<BatchOperationConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('[BatchOps] Config updated:', this.config);
  }

  /**
   * 获取配置
   */
  getConfig(): BatchOperationConfig {
    return { ...this.config };
  }

  /**
   * 执行批量操作
   */
  private async executeBatchOperation(
    task: BatchOperationTask,
    handler: (deviceId: string, params: any) => Promise<any>
  ): Promise<void> {
    const { deviceIds, params, concurrency } = task;
    const chunks = this.chunkArray(deviceIds, concurrency);

    for (const chunk of chunks) {
      // 检查是否已取消
      const currentTask = await this.getTask(task.id);
      if (currentTask?.status === BatchOperationStatus.CANCELLED) {
        break;
      }

      // 并发执行
      const promises = chunk.map(deviceId =>
        this.executeDeviceOperation(deviceId, handler, params, task)
      );

      await Promise.all(promises);

      // 更新进度
      task.progress = Math.floor(((task.successCount + task.failureCount) / task.total) * 100);
      await this.saveTask(task);
    }
  }

  /**
   * 执行单个设备操作
   */
  private async executeDeviceOperation(
    deviceId: string,
    handler: (deviceId: string, params: any) => Promise<any>,
    params: any,
    task: BatchOperationTask
  ): Promise<void> {
    const startTime = Date.now();
    let lastError: Error | null = null;
    let success = false;
    let result: any = null;

    // 重试逻辑
    for (let attempt = 0; attempt <= task.retryCount; attempt++) {
      try {
        // 超时控制
        result = await Promise.race([
          handler(deviceId, params),
          this.timeout(task.timeout),
        ]);

        success = true;
        break;
      } catch (error) {
        lastError = error as Error;
        if (attempt < task.retryCount) {
          await this.sleep(Math.pow(2, attempt) * 1000); // 指数退避
        }
      }
    }

    const duration = Date.now() - startTime;
    const operationResult: DeviceOperationResult = {
      deviceId,
      success,
      duration,
      executedAt: Date.now(),
    };

    if (success) {
      task.successCount++;
      operationResult.data = result;
    } else {
      task.failureCount++;
      operationResult.error = lastError?.message || 'Unknown error';
    }

    task.results.push(operationResult);
  }

  /**
   * 保存任务
   */
  private async saveTask(task: BatchOperationTask): Promise<void> {
    const key = `${this.TASK_PREFIX}${task.id}`;
    await this.redis.set(key, JSON.stringify(task), 'EX', this.config.resultRetentionTime);

    // 更新统计
    await this.updateStatistics(task);
  }

  /**
   * 添加到队列
   */
  private async addToQueue(taskId: string, type: BatchOperationType): Promise<void> {
    const queueKey = `${this.QUEUE_PREFIX}${type}`;
    await this.redis.rpush(queueKey, taskId);
    await this.redis.expire(queueKey, this.config.resultRetentionTime);
  }

  /**
   * 从队列移除
   */
  private async removeFromQueue(taskId: string, type: BatchOperationType): Promise<void> {
    const queueKey = `${this.QUEUE_PREFIX}${type}`;
    await this.redis.lrem(queueKey, 1, taskId);
  }

  /**
   * 更新统计信息
   */
  private async updateStatistics(task: BatchOperationTask): Promise<void> {
    // 更新状态统计
    await this.redis.hincrby(this.STATS_KEY, task.status, 1);

    // 更新类型统计
    await this.redis.hincrby(this.STATS_KEY, task.type, 1);

    // 更新今日任务数
    const today = new Date().toISOString().split('T')[0];
    const todayKey = `${this.STATS_KEY}:${today}`;
    const existing = await this.redis.exists(todayKey);
    await this.redis.hincrby(todayKey, 'count', 1);
    if (!existing) {
      await this.redis.expire(todayKey, 86400 * 2);
    }
  }

  /**
   * 分块数组
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 超时Promise
   */
  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timeout after ${ms}ms`)), ms);
    });
  }

  /**
   * 延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
