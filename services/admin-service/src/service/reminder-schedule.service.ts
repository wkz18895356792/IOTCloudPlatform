/**
 * 提醒定时任务服务
 *
 * 实现多种类型的定时提醒功能：
 * - 设备离线提醒
 * - 配额超限提醒
 * - 系统告警提醒
 * - 订阅到期提醒
 * - 自定义定时提醒
 *
 * 支持多种通知渠道：
 * - 邮件
 * - 短信
 * - 钉钉
 * - 企业微信
 * - Webhook
 */
import { Provide, Inject, Init, Scope, ScopeEnum, Config } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { NotificationChannelService, NotificationMessage } from './notification-channel.service';
import { IdGenerator, JsonUtil, CacheManager } from '@baby-monitor/shared-utils';
import * as cron from 'node-cron';

/**
 * 提醒类型
 */
export enum ReminderType {
  DEVICE_OFFLINE = 'device_offline',         // 设备离线
  QUOTA_WARNING = 'quota_warning',           // 配额预警
  QUOTA_EXCEEDED = 'quota_exceeded',         // 配额超限
  SUBSCRIPTION_EXPIRING = 'subscription_expiring', // 订阅即将到期
  SUBSCRIPTION_EXPIRED = 'subscription_expired',   // 订阅已到期
  SYSTEM_ALERT = 'system_alert',             // 系统告警
  SECURITY_ALERT = 'security_alert',         // 安全告警
  CUSTOM = 'custom',                         // 自定义提醒
}

/**
 * 提醒级别
 */
export enum ReminderLevel {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * 提醒状态
 */
export enum ReminderStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * 通知渠道
 */
export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  DINGTALK = 'dingtalk',
  WECHAT_WORK = 'wechat_work',
  WEBHOOK = 'webhook',
  PUSH = 'push',
}

/**
 * 提醒配置
 */
export interface ReminderConfig {
  id: string;
  userId: string;
  type: ReminderType;
  level: ReminderLevel;
  title: string;
  message: string;
  channels: NotificationChannel[];
  enabled: boolean;

  // 调度配置
  cronExpression?: string;           // 定时表达式
  scheduledTime?: Date;              // 指定时间
  recurring: boolean;                // 是否重复

  // 条件配置
  conditions?: {
    field: string;
    operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
    value: any;
  }[];

  // 模板变量
  templateVars?: Record<string, any>;

  // 冷却时间（秒）
  cooldownSeconds: number;

  // 重试配置
  maxRetries: number;
  retryInterval: number;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * 提醒记录
 */
export interface ReminderRecord {
  id: string;
  configId: string;
  userId: string;
  type: ReminderType;
  level: ReminderLevel;
  title: string;
  message: string;
  channels: NotificationChannel[];
  status: ReminderStatus;
  sentAt?: Date;
  failedAt?: Date;
  errorMessage?: string;
  retryCount: number;
  createdAt: Date;
}

/**
 * 提醒模板
 */
export interface ReminderTemplate {
  type: ReminderType;
  titleTemplate: string;
  messageTemplate: string;
  level: ReminderLevel;
  defaultChannels: NotificationChannel[];
  cooldownSeconds: number;
}

/**
 * 系统告警数据
 */
export interface AlertData {
  source: string;
  metric: string;
  currentValue: any;
  threshold: any;
  timestamp: number;
  details?: Record<string, any>;
}

// Entity: ReminderConfigEntity
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('reminder_configs')
@Index(['userId', 'type'])
@Index(['enabled'])
export class ReminderConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: ReminderType;

  @Column({ type: 'varchar', length: 16, default: ReminderLevel.INFO })
  level!: ReminderLevel;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'simple-json' })
  channels!: NotificationChannel[];

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  cronExpression?: string;

  @Column({ type: 'timestamp', nullable: true })
  scheduledTime?: Date;

  @Column({ type: 'boolean', default: false })
  recurring!: boolean;

  @Column({ type: 'simple-json', nullable: true })
  conditions?: any[];

  @Column({ type: 'simple-json', nullable: true })
  templateVars?: Record<string, any>;

  @Column({ type: 'int', default: 300 })
  cooldownSeconds!: number;

  @Column({ type: 'int', default: 3 })
  maxRetries!: number;

  @Column({ type: 'int', default: 60 })
  retryInterval!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

// Entity: ReminderRecordEntity
@Entity('reminder_records')
@Index(['userId', 'type', 'createdAt'])
@Index(['configId'])
export class ReminderRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  configId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: ReminderType;

  @Column({ type: 'varchar', length: 16 })
  level!: ReminderLevel;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'simple-json' })
  channels!: NotificationChannel[];

  @Column({ type: 'varchar', length: 16, default: ReminderStatus.PENDING })
  status!: ReminderStatus;

  @Column({ type: 'timestamp', nullable: true })
  sentAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  failedAt?: Date;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ type: 'int', default: 0 })
  retryCount!: number;

  @CreateDateColumn()
  createdAt!: Date;
}

/**
 * 提醒定时任务服务
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class ReminderScheduleService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  @Inject()
  notificationChannelService!: NotificationChannelService;

  @InjectEntityModel(ReminderConfigEntity)
  reminderConfigRepository!: Repository<ReminderConfigEntity>;

  @InjectEntityModel(ReminderRecordEntity)
  reminderRecordRepository!: Repository<ReminderRecordEntity>;

  // 定时任务映射
  private scheduledTasks: Map<string, cron.ScheduledTask> = new Map();

  // 冷却缓存
  private readonly COOLDOWN_PREFIX = 'reminder:cooldown:';
  private readonly LOCK_PREFIX = 'reminder:lock:';

  // 预定义模板
  private readonly templates: Map<ReminderType, ReminderTemplate> = new Map();

  @Config('reminder')
  reminderConfig: {
    defaultChannels: NotificationChannel[];
    maxRetries: number;
    retryInterval: number;
    cooldownSeconds: number;
  };

  @Init()
  async init(): Promise<void> {
    this.logger.info('[ReminderSchedule] Service initializing...');

    // 初始化模板
    this.initTemplates();

    // 加载已启用的定时提醒
    await this.loadScheduledReminders();

    // 启动系统检查任务
    this.startSystemCheckTasks();

    this.logger.info('[ReminderSchedule] Service initialized');
  }

  // ==================== 提醒配置管理 ====================

  /**
   * 创建提醒配置
   */
  async createReminder(userId: string, config: Partial<ReminderConfig>): Promise<ReminderConfigEntity> {
    // 验证 cron 表达式
    if (config.cronExpression && !cron.validate(config.cronExpression)) {
      throw new Error('Invalid cron expression');
    }

    const entity = this.reminderConfigRepository.create({
      id: IdGenerator.uuid(),
      userId,
      type: config.type || ReminderType.CUSTOM,
      level: config.level || ReminderLevel.INFO,
      title: config.title || '',
      message: config.message || '',
      channels: config.channels || this.reminderConfig?.defaultChannels || [NotificationChannel.EMAIL],
      enabled: config.enabled !== false,
      cronExpression: config.cronExpression,
      scheduledTime: config.scheduledTime,
      recurring: config.recurring || false,
      conditions: config.conditions,
      templateVars: config.templateVars,
      cooldownSeconds: config.cooldownSeconds || this.reminderConfig?.cooldownSeconds || 300,
      maxRetries: config.maxRetries || this.reminderConfig?.maxRetries || 3,
      retryInterval: config.retryInterval || this.reminderConfig?.retryInterval || 60,
    });

    const saved = await this.reminderConfigRepository.save(entity);

    // 如果启用且有定时表达式，启动调度
    if (saved.enabled && saved.cronExpression) {
      await this.scheduleReminder(saved);
    }

    this.logger.info(`[ReminderSchedule] Reminder created: ${saved.id}`);
    return saved;
  }

  /**
   * 获取用户提醒列表
   */
  async getUserReminders(userId: string, type?: ReminderType): Promise<ReminderConfigEntity[]> {
    const query = this.reminderConfigRepository.createQueryBuilder('reminder')
      .where('reminder.userId = :userId', { userId });

    if (type) {
      query.andWhere('reminder.type = :type', { type });
    }

    return query.orderBy('reminder.createdAt', 'DESC').getMany();
  }

  /**
   * 更新提醒配置
   */
  async updateReminder(userId: string, reminderId: string, updates: Partial<ReminderConfig>): Promise<ReminderConfigEntity | null> {
    const reminder = await this.reminderConfigRepository.findOne({
      where: { id: reminderId, userId } as any,
    });

    if (!reminder) {
      return null;
    }

    // 验证 cron 表达式
    if (updates.cronExpression && !cron.validate(updates.cronExpression)) {
      throw new Error('Invalid cron expression');
    }

    // 停止现有调度
    this.unscheduleReminder(reminderId);

    // 更新字段
    Object.assign(reminder, updates);
    const saved = await this.reminderConfigRepository.save(reminder);

    // 如果启用且有定时表达式，重新调度
    if (saved.enabled && saved.cronExpression) {
      await this.scheduleReminder(saved);
    }

    return saved;
  }

  /**
   * 删除提醒配置
   */
  async deleteReminder(userId: string, reminderId: string): Promise<boolean> {
    const reminder = await this.reminderConfigRepository.findOne({
      where: { id: reminderId, userId } as any,
    });

    if (!reminder) {
      return false;
    }

    // 停止调度
    this.unscheduleReminder(reminderId);

    // 删除配置
    await this.reminderConfigRepository.delete(reminderId);

    this.logger.info(`[ReminderSchedule] Reminder deleted: ${reminderId}`);
    return true;
  }

  /**
   * 启用/禁用提醒
   */
  async toggleReminder(userId: string, reminderId: string, enabled: boolean): Promise<ReminderConfigEntity | null> {
    const reminder = await this.reminderConfigRepository.findOne({
      where: { id: reminderId, userId } as any,
    });

    if (!reminder) {
      return null;
    }

    reminder.enabled = enabled;
    await this.reminderConfigRepository.save(reminder);

    if (enabled && reminder.cronExpression) {
      await this.scheduleReminder(reminder);
    } else {
      this.unscheduleReminder(reminderId);
    }

    return reminder;
  }

  // ==================== 发送提醒 ====================

  /**
   * 发送提醒
   */
  async sendReminder(
    userId: string,
    type: ReminderType,
    data: {
      title?: string;
      message?: string;
      level?: ReminderLevel;
      channels?: NotificationChannel[];
      templateVars?: Record<string, any>;
    }
  ): Promise<ReminderRecordEntity> {
    // 获取模板
    const template = this.templates.get(type);
    if (!template && !data.title && !data.message) {
      throw new Error(`No template found for type ${type} and no custom message provided`);
    }

    // 检查冷却
    const cooldownKey = `${this.COOLDOWN_PREFIX}${userId}:${type}`;
    const inCooldown = await this.redis.get(cooldownKey);
    if (inCooldown) {
      this.logger.debug(`[ReminderSchedule] Reminder in cooldown: ${userId}:${type}`);
      return null!;
    }

    // 渲染消息
    const title = this.renderTemplate(
      data.title || template?.titleTemplate || '',
      data.templateVars || {}
    );
    const message = this.renderTemplate(
      data.message || template?.messageTemplate || '',
      data.templateVars || {}
    );

    const channels = data.channels || template?.defaultChannels || [NotificationChannel.EMAIL];
    const level = data.level || template?.level || ReminderLevel.INFO;

    // 创建记录
    const record = this.reminderRecordRepository.create({
      id: IdGenerator.uuid(),
      configId: '',
      userId,
      type,
      level,
      title,
      message,
      channels,
      status: ReminderStatus.PENDING,
      retryCount: 0,
    });

    const savedRecord = await this.reminderRecordRepository.save(record);

    // 发送通知
    try {
      await this.sendNotification(userId, channels, {
        title,
        message,
        level,
        type,
        data: data.templateVars,
      });

      savedRecord.status = ReminderStatus.SENT;
      savedRecord.sentAt = new Date();
    } catch (error: any) {
      savedRecord.status = ReminderStatus.FAILED;
      savedRecord.failedAt = new Date();
      savedRecord.errorMessage = error.message;

      this.logger.error(`[ReminderSchedule] Failed to send reminder:`, error);
    }

    await this.reminderRecordRepository.save(savedRecord);

    // 设置冷却
    const cooldownSeconds = template?.cooldownSeconds || 300;
    await this.redis.setex(cooldownKey, cooldownSeconds, '1');

    return savedRecord;
  }

  /**
   * 发送通知
   */
  private async sendNotification(
    userId: string,
    channels: NotificationChannel[],
    notification: {
      title: string;
      message: string;
      level: ReminderLevel;
      type: ReminderType;
      data?: Record<string, any>;
    }
  ): Promise<void> {
    const notificationMessage: NotificationMessage = {
      title: notification.title,
      content: notification.message,
      severity: notification.level as 'info' | 'warning' | 'error' | 'critical',
      metadata: {
        type: notification.type,
        userId,
        ...notification.data,
      },
      timestamp: new Date(),
    };

    // 发送通知到所有配置的渠道
    const results = await this.notificationChannelService.sendNotification(notificationMessage);

    // 检查结果
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
      this.logger.warn(`[ReminderSchedule] Some channels failed: ${failures.length}/${results.length}`);
    }

    if (failures.length === results.length && results.length > 0) {
      throw new Error('All notification channels failed');
    }
  }

  // ==================== 系统检查任务 ====================

  /**
   * 启动系统检查任务
   */
  private startSystemCheckTasks(): void {
    // 每分钟检查设备离线
    this.scheduleSystemTask('device_offline_check', '* * * * *', async () => {
      await this.checkDeviceOffline();
    });

    // 每小时检查配额
    this.scheduleSystemTask('quota_check', '0 * * * *', async () => {
      await this.checkQuotaLimits();
    });

    // 每天检查订阅到期
    this.scheduleSystemTask('subscription_check', '0 9 * * *', async () => {
      await this.checkSubscriptionExpiry();
    });

    this.logger.info('[ReminderSchedule] System check tasks started');
  }

  /**
   * 检查设备离线
   */
  private async checkDeviceOffline(): Promise<void> {
    // 从 Redis 获取离线设备列表
    const offlineDevices = await this.redis.smembers('devices:offline:recent');

    for (const deviceData of offlineDevices) {
      try {
        const device = JSON.parse(deviceData);
        await this.sendReminder(device.ownerId, ReminderType.DEVICE_OFFLINE, {
          templateVars: {
            deviceName: device.name,
            deviceId: device.id,
            offlineTime: device.offlineAt,
          },
        });

        // 从列表移除已处理设备
        await this.redis.srem('devices:offline:recent', deviceData);
      } catch (error: any) {
        this.logger.error('[ReminderSchedule] Error processing offline device:', error);
      }
    }
  }

  /**
   * 检查配额限制
   */
  private async checkQuotaLimits(): Promise<void> {
    // 从 Redis 获取配额超限用户
    const quotaWarnings = await this.redis.smembers('quota:warnings');

    for (const warningData of quotaWarnings) {
      try {
        const warning = JSON.parse(warningData);

        const type = warning.exceeded
          ? ReminderType.QUOTA_EXCEEDED
          : ReminderType.QUOTA_WARNING;

        await this.sendReminder(warning.userId, type, {
          level: warning.exceeded ? ReminderLevel.ERROR : ReminderLevel.WARNING,
          templateVars: {
            quotaType: warning.quotaType,
            used: warning.used,
            limit: warning.limit,
            percent: Math.round((warning.used / warning.limit) * 100),
          },
        });

        // 从列表移除已处理警告
        await this.redis.srem('quota:warnings', warningData);
      } catch (error: any) {
        this.logger.error('[ReminderSchedule] Error processing quota warning:', error);
      }
    }
  }

  /**
   * 检查订阅到期
   */
  private async checkSubscriptionExpiry(): Promise<void> {
    // 从 Redis 获取即将到期的订阅
    const expiringSubscriptions = await this.redis.smembers('subscriptions:expiring');

    for (const subData of expiringSubscriptions) {
      try {
        const subscription = JSON.parse(subData);

        const type = subscription.expired
          ? ReminderType.SUBSCRIPTION_EXPIRED
          : ReminderType.SUBSCRIPTION_EXPIRING;

        await this.sendReminder(subscription.userId, type, {
          level: subscription.expired ? ReminderLevel.ERROR : ReminderLevel.WARNING,
          templateVars: {
            planName: subscription.planName,
            expireDate: subscription.expireDate,
            daysLeft: subscription.daysLeft,
          },
        });

        // 从列表移除已处理订阅
        await this.redis.srem('subscriptions:expiring', subData);
      } catch (error: any) {
        this.logger.error('[ReminderSchedule] Error processing subscription:', error);
      }
    }
  }

  // ==================== 调度管理 ====================

  /**
   * 加载已启用的定时提醒
   */
  private async loadScheduledReminders(): Promise<void> {
    const reminders = await this.reminderConfigRepository.find({
      where: { enabled: true } as any,
    });

    for (const reminder of reminders) {
      if (reminder.cronExpression) {
        await this.scheduleReminder(reminder);
      }
    }

    this.logger.info(`[ReminderSchedule] Loaded ${this.scheduledTasks.size} scheduled reminders`);
  }

  /**
   * 调度提醒
   */
  private async scheduleReminder(reminder: ReminderConfigEntity): Promise<void> {
    if (this.scheduledTasks.has(reminder.id)) {
      return;
    }

    try {
      const task = cron.schedule(
        reminder.cronExpression!,
        async () => {
          await this.executeReminder(reminder);
        },
        {
          scheduled: true,
          timezone: 'Asia/Shanghai',
        }
      );

      this.scheduledTasks.set(reminder.id, task);
      this.logger.info(`[ReminderSchedule] Scheduled reminder: ${reminder.id}`);
    } catch (error: any) {
      this.logger.error(`[ReminderSchedule] Failed to schedule reminder ${reminder.id}:`, error);
    }
  }

  /**
   * 取消调度
   */
  private unscheduleReminder(reminderId: string): void {
    const task = this.scheduledTasks.get(reminderId);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(reminderId);
      this.logger.info(`[ReminderSchedule] Unscheduled reminder: ${reminderId}`);
    }
  }

  /**
   * 执行提醒
   */
  private async executeReminder(reminder: ReminderConfigEntity): Promise<void> {
    try {
      await this.sendReminder(reminder.userId, reminder.type, {
        title: reminder.title,
        message: reminder.message,
        level: reminder.level,
        channels: reminder.channels,
        templateVars: reminder.templateVars,
      });

      // 如果不是重复任务，执行一次后禁用
      if (!reminder.recurring) {
        reminder.enabled = false;
        await this.reminderConfigRepository.save(reminder);
        this.unscheduleReminder(reminder.id);
      }
    } catch (error: any) {
      this.logger.error(`[ReminderSchedule] Failed to execute reminder ${reminder.id}:`, error);
    }
  }

  /**
   * 调度系统任务
   */
  private scheduleSystemTask(name: string, cronExpression: string, task: () => Promise<void>): void {
    cron.schedule(cronExpression, async () => {
      try {
        await task();
      } catch (error: any) {
        this.logger.error(`[ReminderSchedule] System task ${name} failed:`, error);
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai',
    });

    this.logger.info(`[ReminderSchedule] System task scheduled: ${name}`);
  }

  // ==================== 工具方法 ====================

  /**
   * 初始化模板
   */
  private initTemplates(): void {
    this.templates.set(ReminderType.DEVICE_OFFLINE, {
      type: ReminderType.DEVICE_OFFLINE,
      titleTemplate: '设备离线提醒',
      messageTemplate: '您的设备 {{deviceName}} 已于 {{offlineTime}} 离线，请检查设备状态。',
      level: ReminderLevel.WARNING,
      defaultChannels: [NotificationChannel.EMAIL, NotificationChannel.PUSH],
      cooldownSeconds: 3600, // 1小时
    });

    this.templates.set(ReminderType.QUOTA_WARNING, {
      type: ReminderType.QUOTA_WARNING,
      titleTemplate: '配额使用预警',
      messageTemplate: '您的{{quotaType}}配额已使用{{percent}}%（{{used}}/{{limit}}），请注意控制使用量。',
      level: ReminderLevel.WARNING,
      defaultChannels: [NotificationChannel.EMAIL],
      cooldownSeconds: 86400, // 1天
    });

    this.templates.set(ReminderType.QUOTA_EXCEEDED, {
      type: ReminderType.QUOTA_EXCEEDED,
      titleTemplate: '配额超限警告',
      messageTemplate: '您的{{quotaType}}配额已超限！当前使用{{used}}，限制为{{limit}}。部分功能可能受限。',
      level: ReminderLevel.ERROR,
      defaultChannels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
      cooldownSeconds: 3600, // 1小时
    });

    this.templates.set(ReminderType.SUBSCRIPTION_EXPIRING, {
      type: ReminderType.SUBSCRIPTION_EXPIRING,
      titleTemplate: '订阅即将到期',
      messageTemplate: '您的{{planName}}订阅将于{{expireDate}}到期，还剩{{daysLeft}}天，请及时续费。',
      level: ReminderLevel.WARNING,
      defaultChannels: [NotificationChannel.EMAIL, NotificationChannel.PUSH],
      cooldownSeconds: 86400, // 1天
    });

    this.templates.set(ReminderType.SUBSCRIPTION_EXPIRED, {
      type: ReminderType.SUBSCRIPTION_EXPIRED,
      titleTemplate: '订阅已到期',
      messageTemplate: '您的{{planName}}订阅已于{{expireDate}}到期，请续费以继续使用完整功能。',
      level: ReminderLevel.ERROR,
      defaultChannels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
      cooldownSeconds: 86400, // 1天
    });

    this.templates.set(ReminderType.SYSTEM_ALERT, {
      type: ReminderType.SYSTEM_ALERT,
      titleTemplate: '系统告警',
      messageTemplate: '{{alertMessage}}',
      level: ReminderLevel.ERROR,
      defaultChannels: [NotificationChannel.EMAIL, NotificationChannel.DINGTALK],
      cooldownSeconds: 300, // 5分钟
    });

    this.templates.set(ReminderType.SECURITY_ALERT, {
      type: ReminderType.SECURITY_ALERT,
      titleTemplate: '安全告警',
      messageTemplate: '检测到安全风险：{{alertMessage}}，请及时处理。',
      level: ReminderLevel.CRITICAL,
      defaultChannels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
      cooldownSeconds: 0, // 无冷却
    });
  }

  /**
   * 渲染模板
   */
  private renderTemplate(template: string, vars: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`;
    });
  }

  /**
   * 获取提醒历史
   */
  async getReminderHistory(
    userId: string,
    options?: {
      type?: ReminderType;
      status?: ReminderStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ records: ReminderRecordEntity[]; total: number }> {
    const query = this.reminderRecordRepository.createQueryBuilder('record')
      .where('record.userId = :userId', { userId });

    if (options?.type) {
      query.andWhere('record.type = :type', { type: options.type });
    }

    if (options?.status) {
      query.andWhere('record.status = :status', { status: options.status });
    }

    const total = await query.getCount();

    query.orderBy('record.createdAt', 'DESC')
      .limit(options?.limit || 50)
      .offset(options?.offset || 0);

    const records = await query.getMany();

    return { records, total };
  }

  /**
   * 手动触发提醒
   */
  async triggerReminder(
    userId: string,
    type: ReminderType,
    templateVars?: Record<string, any>
  ): Promise<ReminderRecordEntity> {
    return this.sendReminder(userId, type, {
      templateVars: templateVars || {},
    });
  }

  /**
   * 销毁服务
   */
  async destroy(): Promise<void> {
    for (const [_, task] of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks.clear();
    this.logger.info('[ReminderSchedule] Service destroyed');
  }
}
