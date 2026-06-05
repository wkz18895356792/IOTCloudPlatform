import { Provide, Inject } from '@midwayjs/core';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * 维护类型
 */
export enum MaintenanceType {
  /** 预防性维护 */
  PREVENTIVE = 'preventive',
  /** 纠正性维护 */
  CORRECTIVE = 'corrective',
  /** 升级维护 */
  UPGRADE = 'upgrade',
  /** 紧急维护 */
  EMERGENCY = 'emergency',
  /** 巡检维护 */
  INSPECTION = 'inspection',
}

/**
 * 维护状态
 */
export enum MaintenanceStatus {
  /** 已计划 */
  SCHEDULED = 'scheduled',
  /** 进行中 */
  IN_PROGRESS = 'in_progress',
  /** 已完成 */
  COMPLETED = 'completed',
  /** 已取消 */
  CANCELLED = 'cancelled',
  /** 已跳过 */
  SKIPPED = 'skipped',
  /** 已延期 */
  POSTPONED = 'postponed',
}

/**
 * 维护优先级
 */
export enum MaintenancePriority {
  /** 低优先级 */
  LOW = 'low',
  /** 中优先级 */
  MEDIUM = 'medium',
  /** 高优先级 */
  HIGH = 'high',
  /** 紧急 */
  CRITICAL = 'critical',
}

/**
 * 维护任务
 */
export interface MaintenanceTask {
  /** 任务ID */
  id: string;
  /** 任务名称 */
  name: string;
  /** 任务描述 */
  description?: string;
  /** 维护类型 */
  type: MaintenanceType;
  /** 维护状态 */
  status: MaintenanceStatus;
  /** 优先级 */
  priority: MaintenancePriority;
  /** 目标设备ID列表 */
  deviceIds: string[];
  /** 计划开始时间 */
  scheduledStart: number;
  /** 计划结束时间 */
  scheduledEnd: number;
  /** 实际开始时间 */
  actualStart?: number;
  /** 实际结束时间 */
  actualEnd?: number;
  /** 预计时长（分钟） */
  estimatedDuration: number;
  /** 实际时长（分钟） */
  actualDuration?: number;
  /** 创建者 */
  createdBy: string;
  /** 分配给 */
  assignedTo?: string;
  /** 维护步骤 */
  steps: MaintenanceStep[];
  /** 所需资源 */
  resources?: string[];
  /** 影响范围 */
  impact?: {
    /** 是否影响服务 */
    affectsService: boolean;
    /** 受影响的用户数 */
    affectedUsers?: number;
    /** 备用方案 */
    fallbackPlan?: string;
  };
  /** 相关票据/工单 */
  tickets?: string[];
  /** 标签 */
  tags?: string[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成百分比 */
  completionPercentage: number;
  /** 备注 */
  notes?: string;
}

/**
 * 维护步骤
 */
export interface MaintenanceStep {
  /** 步骤ID */
  id: string;
  /** 步骤名称 */
  name: string;
  /** 步骤描述 */
  description?: string;
  /** 执行命令/脚本 */
  command?: string;
  /** 预期结果 */
  expectedResult?: string;
  /** 是否完成 */
  completed: boolean;
  /** 完成时间 */
  completedAt?: number;
  /** 执行结果 */
  result?: {
    success: boolean;
    output?: string;
    error?: string;
  };
  /** 执行顺序 */
  order: number;
}

/**
 * 维护窗口
 */
export interface MaintenanceWindow {
  /** 窗口ID */
  id: string;
  /** 窗口名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime: number;
  /** 星期设置（0-6，0表示周日） */
  weekdays?: number[];
  /** 是否重复 */
  recurring: boolean;
  /** 重复规则（cron表达式） */
  recurrenceRule?: string;
  /** 窗口状态 */
  active: boolean;
}

/**
 * 维护统计
 */
export interface MaintenanceStatistics {
  /** 总任务数 */
  totalTasks: number;
  /** 按状态统计 */
  byStatus: Record<MaintenanceStatus, number>;
  /** 按类型统计 */
  byType: Record<MaintenanceType, number>;
  /** 按优先级统计 */
  byPriority: Record<MaintenancePriority, number>;
  /** 今日任务数 */
  todayTasks: number;
  /** 本周任务数 */
  weekTasks: number;
  /** 本月任务数 */
  monthTasks: number;
  /** 平均完成时间（分钟） */
  avgCompletionTime: number;
  /** 按时完成率 */
  onTimeCompletionRate: number;
}

/**
 * 设备维护管理服务
 * 管理设备的维护计划、执行和记录
 */
@Provide()
export class DeviceMaintenanceService {
  @Inject()
  redis!: RedisService;

  @Inject()
  logger!: ILogger;

  private readonly TASK_PREFIX = 'maintenance:task:';
  private readonly WINDOW_PREFIX = 'maintenance:window:';
  private readonly SCHEDULE_PREFIX = 'maintenance:schedule:';
  private readonly STATS_KEY = 'maintenance:stats';
  private readonly DEFAULT_TTL = 86400 * 365; // 1年

  /**
   * 创建维护任务
   *
   * @param task 任务信息
   * @returns 创建的任务
   */
  async createTask(task: Omit<MaintenanceTask, 'id' | 'createdAt' | 'updatedAt' | 'completionPercentage'>): Promise<MaintenanceTask> {
    const id = uuidv4();
    const now = Date.now();

    const newTask: MaintenanceTask = {
      id,
      ...task,
      createdAt: now,
      updatedAt: now,
      completionPercentage: 0,
    };

    await this.saveTask(newTask);
    await this.scheduleTask(newTask);
    await this.updateStatistics('created', task.type, task.priority);

    this.logger.info(`[DeviceMaintenance] Created maintenance task ${id}: ${task.name}`);
    return newTask;
  }

  /**
   * 更新维护任务
   *
   * @param taskId 任务ID
   * @param updates 更新内容
   * @returns 更新后的任务
   */
  async updateTask(taskId: string, updates: Partial<MaintenanceTask>): Promise<MaintenanceTask | null> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const updated: MaintenanceTask = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    };

    await this.saveTask(updated);

    this.logger.info(`[DeviceMaintenance] Updated task ${taskId}`);
    return updated;
  }

  /**
   * 开始执行维护任务
   *
   * @param taskId 任务ID
   * @param executedBy 执行人
   */
  async startTask(taskId: string, executedBy: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status !== MaintenanceStatus.SCHEDULED) {
      throw new Error(`Task ${taskId} is not in scheduled status`);
    }

    task.status = MaintenanceStatus.IN_PROGRESS;
    task.actualStart = Date.now();
    task.updatedAt = Date.now();

    await this.saveTask(task);
    await this.updateStatistics('started', task.type, task.priority);

    this.logger.info(`[DeviceMaintenance] Started task ${taskId}: ${task.name}`);
  }

  /**
   * 完成维护任务
   *
   * @param taskId 任务ID
   * @param notes 完成备注
   */
  async completeTask(taskId: string, notes?: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status !== MaintenanceStatus.IN_PROGRESS) {
      throw new Error(`Task ${taskId} is not in progress`);
    }

    const now = Date.now();
    task.status = MaintenanceStatus.COMPLETED;
    task.actualEnd = now;

    if (task.actualStart) {
      task.actualDuration = Math.floor((now - task.actualStart) / 60000); // 转换为分钟
    }

    task.completionPercentage = 100;
    task.notes = notes;
    task.updatedAt = now;

    await this.saveTask(task);
    await this.removeFromSchedule(taskId);
    await this.updateStatistics('completed', task.type, task.priority);

    this.logger.info(`[DeviceMaintenance] Completed task ${taskId}: ${task.name}`);
  }

  /**
   * 取消维护任务
   *
   * @param taskId 任务ID
   * @param reason 取消原因
   */
  async cancelTask(taskId: string, reason?: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = MaintenanceStatus.CANCELLED;
    task.notes = reason;
    task.updatedAt = Date.now();

    await this.saveTask(task);
    await this.removeFromSchedule(taskId);
    await this.updateStatistics('cancelled', task.type, task.priority);

    this.logger.info(`[DeviceMaintenance] Cancelled task ${taskId}: ${task.name}`);
  }

  /**
   * 延期维护任务
   *
   * @param taskId 任务ID
   * @param newScheduledStart 新的计划开始时间
   * @param newScheduledEnd 新的计划结束时间
   * @param reason 延期原因
   */
  async postponeTask(
    taskId: string,
    newScheduledStart: number,
    newScheduledEnd: number,
    reason?: string
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = MaintenanceStatus.POSTPONED;
    task.scheduledStart = newScheduledStart;
    task.scheduledEnd = newScheduledEnd;
    task.notes = reason;
    task.updatedAt = Date.now();

    await this.saveTask(task);
    await this.rescheduleTask(task);

    this.logger.info(`[DeviceMaintenance] Postponed task ${taskId}: ${task.name}`);
  }

  /**
   * 更新维护步骤
   *
   * @param taskId 任务ID
   * @param stepId 步骤ID
   * @param result 执行结果
   */
  async updateStep(
    taskId: string,
    stepId: string,
    result: { success: boolean; output?: string; error?: string }
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const step = task.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found in task ${taskId}`);
    }

    step.completed = true;
    step.completedAt = Date.now();
    step.result = result;

    // 更新完成百分比
    const completedSteps = task.steps.filter(s => s.completed).length;
    task.completionPercentage = Math.floor((completedSteps / task.steps.length) * 100);

    await this.saveTask(task);

    this.logger.debug(`[DeviceMaintenance] Updated step ${stepId} in task ${taskId}`);
  }

  /**
   * 获取维护任务
   *
   * @param taskId 任务ID
   * @returns 任务信息
   */
  async getTask(taskId: string): Promise<MaintenanceTask | null> {
    try {
      const key = `${this.TASK_PREFIX}${taskId}`;
      const data = await this.redis.get(key);

      if (data) {
        return JSON.parse(data) as MaintenanceTask;
      }

      return null;
    } catch (error) {
      this.logger.error('[DeviceMaintenance] Error getting task:', error);
      return null;
    }
  }

  /**
   * 获取设备的维护任务列表
   *
   * @param deviceId 设备ID
   * @param status 可选的状态过滤
   * @returns 任务列表
   */
  async getTasksByDevice(deviceId: string, status?: MaintenanceStatus): Promise<MaintenanceTask[]> {
    try {
      const pattern = `${this.TASK_PREFIX}*`;
      const keys = await this.redis.keys(pattern);

      const tasks: MaintenanceTask[] = [];

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const task: MaintenanceTask = JSON.parse(data);
          if (task.deviceIds.includes(deviceId) && (!status || task.status === status)) {
            tasks.push(task);
          }
        }
      }

      return tasks.sort((a, b) => b.scheduledStart - a.scheduledStart);
    } catch (error) {
      this.logger.error('[DeviceMaintenance] Error getting tasks by device:', error);
      return [];
    }
  }

  /**
   * 获取指定时间范围内的任务
   *
   * @param startTime 开始时间
   * @param endTime 结束时间
   * @param status 可选的状态过滤
   * @returns 任务列表
   */
  async getTasksByTimeRange(
    startTime: number,
    endTime: number,
    status?: MaintenanceStatus
  ): Promise<MaintenanceTask[]> {
    try {
      const pattern = `${this.TASK_PREFIX}*`;
      const keys = await this.redis.keys(pattern);

      const tasks: MaintenanceTask[] = [];

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const task: MaintenanceTask = JSON.parse(data);
          if (
            task.scheduledStart >= startTime &&
            task.scheduledStart <= endTime &&
            (!status || task.status === status)
          ) {
            tasks.push(task);
          }
        }
      }

      return tasks.sort((a, b) => a.scheduledStart - b.scheduledStart);
    } catch (error) {
      this.logger.error('[DeviceMaintenance] Error getting tasks by time range:', error);
      return [];
    }
  }

  /**
   * 获取即将到来的任务
   *
   * @param days 天数
   * @returns 任务列表
   */
  async getUpcomingTasks(days: number = 7): Promise<MaintenanceTask[]> {
    const now = Date.now();
    const endTime = now + (days * 24 * 60 * 60 * 1000);

    return await this.getTasksByTimeRange(now, endTime, MaintenanceStatus.SCHEDULED);
  }

  /**
   * 获取逾期未完成的任务
   *
   * @returns 任务列表
   */
  async getOverdueTasks(): Promise<MaintenanceTask[]> {
    try {
      const now = Date.now();
      const pattern = `${this.TASK_PREFIX}*`;
      const keys = await this.redis.keys(pattern);

      const overdueTasks: MaintenanceTask[] = [];

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const task: MaintenanceTask = JSON.parse(data);
          if (
            task.scheduledEnd < now &&
            (task.status === MaintenanceStatus.SCHEDULED || task.status === MaintenanceStatus.IN_PROGRESS)
          ) {
            overdueTasks.push(task);
          }
        }
      }

      return overdueTasks.sort((a, b) => a.scheduledEnd - b.scheduledEnd);
    } catch (error) {
      this.logger.error('[DeviceMaintenance] Error getting overdue tasks:', error);
      return [];
    }
  }

  /**
   * 创建维护窗口
   *
   * @param window 窗口信息
   * @returns 创建的窗口
   */
  async createWindow(window: Omit<MaintenanceWindow, 'id'>): Promise<MaintenanceWindow> {
    const id = uuidv4();
    const newWindow: MaintenanceWindow = { id, ...window };

    const key = `${this.WINDOW_PREFIX}${id}`;
    await this.redis.set(key, JSON.stringify(newWindow), 'EX', this.DEFAULT_TTL);

    this.logger.info(`[DeviceMaintenance] Created maintenance window ${id}: ${window.name}`);
    return newWindow;
  }

  /**
   * 获取维护窗口
   *
   * @param windowId 窗口ID
   * @returns 窗口信息
   */
  async getWindow(windowId: string): Promise<MaintenanceWindow | null> {
    try {
      const key = `${this.WINDOW_PREFIX}${windowId}`;
      const data = await this.redis.get(key);

      if (data) {
        return JSON.parse(data) as MaintenanceWindow;
      }

      return null;
    } catch (error) {
      this.logger.error('[DeviceMaintenance] Error getting window:', error);
      return null;
    }
  }

  /**
   * 获取所有活跃的维护窗口
   *
   * @returns 窗口列表
   */
  async getActiveWindows(): Promise<MaintenanceWindow[]> {
    try {
      const pattern = `${this.WINDOW_PREFIX}*`;
      const keys = await this.redis.keys(pattern);

      const windows: MaintenanceWindow[] = [];

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const window: MaintenanceWindow = JSON.parse(data);
          if (window.active) {
            windows.push(window);
          }
        }
      }

      return windows;
    } catch (error) {
      this.logger.error('[DeviceMaintenance] Error getting active windows:', error);
      return [];
    }
  }

  /**
   * 检查时间是否在维护窗口内
   *
   * @param timestamp 时间戳
   * @returns 是否在维护窗口内
   */
  async isInMaintenanceWindow(timestamp: number): Promise<boolean> {
    const windows = await this.getActiveWindows();
    const date = new Date(timestamp);
    const dayOfWeek = date.getDay();
    const hour = date.getHours();
    const minute = date.getMinutes();
    const currentTime = hour * 60 + minute;

    for (const window of windows) {
      // 检查星期
      if (window.weekdays && !window.weekdays.includes(dayOfWeek)) {
        continue;
      }

      // 检查时间范围
      const startTime = new Date(window.startTime);
      const endTime = new Date(window.endTime);
      const startMinutes = startTime.getHours() * 60 + startTime.getMinutes();
      const endMinutes = endTime.getHours() * 60 + endTime.getMinutes();

      if (currentTime >= startMinutes && currentTime <= endMinutes) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取维护统计
   *
   * @returns 统计信息
   */
  async getStatistics(): Promise<MaintenanceStatistics> {
    try {
      const statsData = await this.redis.hgetall(this.STATS_KEY);

      const byStatus: Record<MaintenanceStatus, number> = {
        [MaintenanceStatus.SCHEDULED]: parseInt(statsData.scheduled || '0', 10),
        [MaintenanceStatus.IN_PROGRESS]: parseInt(statsData.in_progress || '0', 10),
        [MaintenanceStatus.COMPLETED]: parseInt(statsData.completed || '0', 10),
        [MaintenanceStatus.CANCELLED]: parseInt(statsData.cancelled || '0', 10),
        [MaintenanceStatus.SKIPPED]: parseInt(statsData.skipped || '0', 10),
        [MaintenanceStatus.POSTPONED]: parseInt(statsData.postponed || '0', 10),
      };

      const byType: Record<MaintenanceType, number> = {
        [MaintenanceType.PREVENTIVE]: parseInt(statsData.preventive || '0', 10),
        [MaintenanceType.CORRECTIVE]: parseInt(statsData.corrective || '0', 10),
        [MaintenanceType.UPGRADE]: parseInt(statsData.upgrade || '0', 10),
        [MaintenanceType.EMERGENCY]: parseInt(statsData.emergency || '0', 10),
        [MaintenanceType.INSPECTION]: parseInt(statsData.inspection || '0', 10),
      };

      const byPriority: Record<MaintenancePriority, number> = {
        [MaintenancePriority.LOW]: parseInt(statsData.low || '0', 10),
        [MaintenancePriority.MEDIUM]: parseInt(statsData.medium || '0', 10),
        [MaintenancePriority.HIGH]: parseInt(statsData.high || '0', 10),
        [MaintenancePriority.CRITICAL]: parseInt(statsData.critical || '0', 10),
      };

      const totalTasks = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
      const avgCompletionTime = parseFloat(statsData.avgCompletionTime || '0');
      const onTimeCompletionRate = parseFloat(statsData.onTimeCompletionRate || '0');

      return {
        totalTasks,
        byStatus,
        byType,
        byPriority,
        todayTasks: parseInt(statsData.todayTasks || '0', 10),
        weekTasks: parseInt(statsData.weekTasks || '0', 10),
        monthTasks: parseInt(statsData.monthTasks || '0', 10),
        avgCompletionTime,
        onTimeCompletionRate,
      };
    } catch (error) {
      this.logger.error('[DeviceMaintenance] Error getting statistics:', error);
      return {
        totalTasks: 0,
        byStatus: {
          [MaintenanceStatus.SCHEDULED]: 0,
          [MaintenanceStatus.IN_PROGRESS]: 0,
          [MaintenanceStatus.COMPLETED]: 0,
          [MaintenanceStatus.CANCELLED]: 0,
          [MaintenanceStatus.SKIPPED]: 0,
          [MaintenanceStatus.POSTPONED]: 0,
        },
        byType: {
          [MaintenanceType.PREVENTIVE]: 0,
          [MaintenanceType.CORRECTIVE]: 0,
          [MaintenanceType.UPGRADE]: 0,
          [MaintenanceType.EMERGENCY]: 0,
          [MaintenanceType.INSPECTION]: 0,
        },
        byPriority: {
          [MaintenancePriority.LOW]: 0,
          [MaintenancePriority.MEDIUM]: 0,
          [MaintenancePriority.HIGH]: 0,
          [MaintenancePriority.CRITICAL]: 0,
        },
        todayTasks: 0,
        weekTasks: 0,
        monthTasks: 0,
        avgCompletionTime: 0,
        onTimeCompletionRate: 0,
      };
    }
  }

  /**
   * 保存任务
   */
  private async saveTask(task: MaintenanceTask): Promise<void> {
    const key = `${this.TASK_PREFIX}${task.id}`;
    await this.redis.set(key, JSON.stringify(task), 'EX', this.DEFAULT_TTL);
  }

  /**
   * 安排任务
   */
  private async scheduleTask(task: MaintenanceTask): Promise<void> {
    const score = task.scheduledStart;
    const scheduleKey = `${this.SCHEDULE_PREFIX}${task.priority}`;
    await this.redis.zadd(scheduleKey, score, task.id);
    await this.redis.expire(scheduleKey, this.DEFAULT_TTL);
  }

  /**
   * 重新安排任务
   */
  private async rescheduleTask(task: MaintenanceTask): Promise<void> {
    await this.removeFromSchedule(task.id);
    await this.scheduleTask(task);
  }

  /**
   * 从调度中移除
   */
  private async removeFromSchedule(taskId: string): Promise<void> {
    for (const priority of Object.values(MaintenancePriority)) {
      const scheduleKey = `${this.SCHEDULE_PREFIX}${priority}`;
      await this.redis.zrem(scheduleKey, taskId);
    }
  }

  /**
   * 更新统计信息
   */
  private async updateStatistics(
    action: 'created' | 'started' | 'completed' | 'cancelled',
    type: MaintenanceType,
    priority: MaintenancePriority
  ): Promise<void> {
    // 更新类型统计
    await this.redis.hincrby(this.STATS_KEY, type, 1);

    // 更新优先级统计
    await this.redis.hincrby(this.STATS_KEY, priority, 1);

    // 更新今日/本周/本月统计
    const now = new Date();
    const todayKey = `${this.STATS_KEY}:${now.toISOString().split('T')[0]}`;
    await this.redis.hincrby(todayKey, 'count', 1);
    await this.redis.expire(todayKey, 86400 * 7);
  }
}
