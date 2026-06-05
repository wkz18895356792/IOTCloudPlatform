import { Provide, Inject, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { IdGenerator } from '@baby-monitor/shared-utils';
import * as os from 'os';
import { NotificationChannelService, NotificationMessage } from './notification-channel.service';

/**
 * 告警严重程度
 */
export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * 告警状态
 */
export enum AlertStatus {
  ACTIVE = 'active',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
}

/**
 * 告警类型
 */
export enum AlertType {
  SERVICE_DOWN = 'service_down',
  HIGH_CPU = 'high_cpu',
  HIGH_MEMORY = 'high_memory',
  HIGH_DISK = 'high_disk',
  HIGH_RESPONSE_TIME = 'high_response_time',
  HIGH_ERROR_RATE = 'high_error_rate',
  DATABASE_CONNECTION = 'database_connection',
  REDIS_CONNECTION = 'redis_connection',
  STORAGE_QUOTA = 'storage_quota',
}

/**
 * 告警规则
 */
export interface AlertRule {
  id: string;
  name: string;
  type: AlertType;
  severity: AlertSeverity;
  enabled: boolean;
  threshold: number;
  duration: number; // 持续时间（毫秒）
  description: string;
}

/**
 * 告警
 */
export interface Alert {
  id: string;
  severity: AlertSeverity;
  type: string;
  title: string;
  message: string;
  service: string;
  status: AlertStatus;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  count: number; // 触发次数
}

/**
 * 告警统计
 */
export interface AlertStats {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
  bySeverity: Record<AlertSeverity, number>;
  byType: Record<string, number>;
}

/**
 * 告警服务
 *
 * 负责管理系统告警
 */
@Provide()
export class AlertService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redisService!: RedisService;

  @Inject()
  notificationChannelService!: NotificationChannelService;

  // 告警存储（生产环境应使用数据库）
  private alerts: Map<string, Alert> = new Map();

  // 告警规则
  private rules: Map<AlertType, AlertRule> = new Map();

  // 告警历史
  private alertHistory: Map<string, Date> = new Map();

  // 默认告警规则
  private readonly defaultRules: AlertRule[] = [
    {
      id: 'rule-service-down',
      name: '服务宕机告警',
      type: AlertType.SERVICE_DOWN,
      severity: AlertSeverity.CRITICAL,
      enabled: true,
      threshold: 0,
      duration: 30000, // 30秒
      description: '服务无法访问',
    },
    {
      id: 'rule-high-cpu',
      name: 'CPU使用率过高',
      type: AlertType.HIGH_CPU,
      severity: AlertSeverity.WARNING,
      enabled: true,
      threshold: 80,
      duration: 300000, // 5分钟
      description: 'CPU使用率超过80%',
    },
    {
      id: 'rule-high-memory',
      name: '内存使用率过高',
      type: AlertType.HIGH_MEMORY,
      severity: AlertSeverity.WARNING,
      enabled: true,
      threshold: 85,
      duration: 300000,
      description: '内存使用率超过85%',
    },
    {
      id: 'rule-high-response-time',
      name: '响应时间过长',
      type: AlertType.HIGH_RESPONSE_TIME,
      severity: AlertSeverity.ERROR,
      enabled: true,
      threshold: 5000,
      duration: 60000,
      description: '平均响应时间超过5秒',
    },
    {
      id: 'rule-database-connection',
      name: '数据库连接失败',
      type: AlertType.DATABASE_CONNECTION,
      severity: AlertSeverity.CRITICAL,
      enabled: true,
      threshold: 0,
      duration: 10000,
      description: '无法连接到数据库',
    },
    {
      id: 'rule-redis-connection',
      name: 'Redis连接失败',
      type: AlertType.REDIS_CONNECTION,
      severity: AlertSeverity.ERROR,
      enabled: true,
      threshold: 0,
      duration: 10000,
      description: '无法连接到Redis',
    },
  ];

  @Init()
  async init() {
    this.logger.info('[AlertService] Alert service initialized');

    // 加载默认规则
    for (const rule of this.defaultRules) {
      this.rules.set(rule.type, rule);
    }

    // 启动告警检查定时任务
    setInterval(() => this.checkAlerts(), 30000); // 每30秒检查一次

    // 启动告警清理任务
    setInterval(() => this.cleanupOldAlerts(), 3600000); // 每小时清理一次
  }

  /**
   * 创建告警
   */
  async createAlert(params: {
    type: AlertType;
    severity: AlertSeverity;
    title: string;
    message: string;
    service: string;
    metadata?: Record<string, any>;
  }): Promise<Alert> {
    const existingKey = `${params.type}:${params.service}`;
    const existing = this.alerts.get(existingKey);

    if (existing && existing.status === AlertStatus.ACTIVE) {
      // 更新现有告警
      existing.count++;
      existing.updatedAt = new Date();
      existing.metadata = { ...existing.metadata, ...params.metadata };
      this.alerts.set(existingKey, existing);

      await this.persistAlert(existing);
      return existing;
    }

    // 创建新告警
    const alert: Alert = {
      id: IdGenerator.uuid(),
      type: params.type,
      severity: params.severity,
      title: params.title,
      message: params.message,
      service: params.service,
      status: AlertStatus.ACTIVE,
      metadata: params.metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
      count: 1,
    };

    this.alerts.set(existingKey, alert);
    await this.persistAlert(alert);

    // 发送通知
    await this.sendNotification(alert);

    this.logger.warn(`[AlertService] New alert created: ${alert.title} - ${alert.message}`);

    return alert;
  }

  /**
   * 确认告警
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string, notes?: string): Promise<Alert | null> {
    const alert = this.findAlert(alertId);
    if (!alert) {
      return null;
    }

    alert.status = AlertStatus.ACKNOWLEDGED;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;
    alert.updatedAt = new Date();

    if (notes) {
      alert.metadata = { ...alert.metadata, acknowledgementNotes: notes };
    }

    await this.persistAlert(alert);

    this.logger.info(`[AlertService] Alert acknowledged: ${alertId} by ${acknowledgedBy}`);

    return alert;
  }

  /**
   * 解决告警
   */
  async resolveAlert(alertId: string, resolvedBy: string): Promise<Alert | null> {
    const alert = this.findAlert(alertId);
    if (!alert) {
      return null;
    }

    alert.status = AlertStatus.RESOLVED;
    alert.resolvedAt = new Date();
    alert.updatedAt = new Date();

    await this.persistAlert(alert);

    // 记录解决历史
    this.alertHistory.set(alertId, new Date());

    this.logger.info(`[AlertService] Alert resolved: ${alertId} by ${resolvedBy}`);

    return alert;
  }

  /**
   * 获取告警列表
   */
  async getAlerts(filter?: {
    severity?: AlertSeverity;
    status?: AlertStatus;
    service?: string;
    type?: AlertType;
    limit?: number;
  }): Promise<{ alerts: Alert[]; total: number }> {
    let alerts = Array.from(this.alerts.values());

    // 应用过滤条件
    if (filter?.severity) {
      alerts = alerts.filter(a => a.severity === filter.severity);
    }
    if (filter?.status) {
      alerts = alerts.filter(a => a.status === filter.status);
    }
    if (filter?.service) {
      alerts = alerts.filter(a => a.service === filter.service);
    }
    if (filter?.type) {
      alerts = alerts.filter(a => a.type === filter.type);
    }

    // 按创建时间倒序排序
    alerts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // 限制返回数量
    const total = alerts.length;
    if (filter?.limit && filter.limit < alerts.length) {
      alerts = alerts.slice(0, filter.limit);
    }

    return { alerts, total };
  }

  /**
   * 获取告警统计
   */
  async getAlertStats(): Promise<AlertStats> {
    const alerts = Array.from(this.alerts.values());

    const stats: AlertStats = {
      total: alerts.length,
      active: 0,
      acknowledged: 0,
      resolved: 0,
      bySeverity: {
        [AlertSeverity.INFO]: 0,
        [AlertSeverity.WARNING]: 0,
        [AlertSeverity.ERROR]: 0,
        [AlertSeverity.CRITICAL]: 0,
      },
      byType: {},
    };

    for (const alert of alerts) {
      // 状态统计
      if (alert.status === AlertStatus.ACTIVE) stats.active++;
      else if (alert.status === AlertStatus.ACKNOWLEDGED) stats.acknowledged++;
      else if (alert.status === AlertStatus.RESOLVED) stats.resolved++;

      // 严重程度统计
      stats.bySeverity[alert.severity]++;

      // 类型统计
      stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;
    }

    return stats;
  }

  /**
   * 获取告警规则
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 更新告警规则
   */
  async updateRule(ruleId: string, updates: Partial<AlertRule>): Promise<AlertRule | null> {
    const rule = Array.from(this.rules.values()).find(r => r.id === ruleId);
    if (!rule) {
      return null;
    }

    const updated = { ...rule, ...updates };
    this.rules.set(rule.type, updated);

    // 持久化规则到Redis
    await this.redisService.hset('alert:rules', ruleId, JSON.stringify(updated));

    return updated;
  }

  /**
   * 检查告警条件
   */
  private async checkAlerts() {
    this.logger.debug('[AlertService] Checking alert conditions...');

    try {
      // 获取系统指标
      const metrics = await this.getSystemMetrics();

      // 检查每个启用的规则
      for (const [type, rule] of this.rules) {
        if (!rule.enabled) continue;

        await this.checkRule(rule, metrics);
      }
    } catch (error: any) {
      this.logger.error('[AlertService] Error checking alerts:', error);
    }
  }

  /**
   * 检查单个规则
   */
  private async checkRule(rule: AlertRule, metrics: any) {
    const now = Date.now();
    const ruleKey = `rule:${rule.id}:lastTriggered`;
    const lastTriggered = await this.redisService.get(ruleKey);
    const lastTriggeredTime = lastTriggered ? parseInt(lastTriggered) : 0;

    // 检查是否在冷却期内
    if (now - lastTriggeredTime < rule.duration) {
      return;
    }

    let shouldAlert = false;
    let alertData: Record<string, any> = {};

    switch (rule.type) {
      case AlertType.HIGH_CPU:
        shouldAlert = metrics.cpu > rule.threshold;
        alertData = { cpu: metrics.cpu };
        break;

      case AlertType.HIGH_MEMORY:
        shouldAlert = metrics.memoryPercentage > rule.threshold;
        alertData = { memory: metrics.memoryPercentage };
        break;

      case AlertType.SERVICE_DOWN:
        // 服务宕机检查由健康检查服务处理
        break;

      case AlertType.DATABASE_CONNECTION:
        // 数据库连接检查由健康检查服务处理
        break;

      case AlertType.REDIS_CONNECTION:
        // Redis连接检查由健康检查服务处理
        break;

      case AlertType.HIGH_RESPONSE_TIME:
        shouldAlert = metrics.avgResponseTime > rule.threshold;
        alertData = { avgResponseTime: metrics.avgResponseTime };
        break;
    }

    if (shouldAlert) {
      await this.createAlert({
        type: rule.type,
        severity: rule.severity,
        title: rule.name,
        message: `${rule.description} - 当前值: ${JSON.stringify(alertData)}`,
        service: 'system',
        metadata: alertData,
      });

      // 更新最后触发时间
      await this.redisService.set(ruleKey, now.toString(), 'PX', rule.duration);
    }
  }

  /**
   * 获取系统指标
   */
  private async getSystemMetrics(): Promise<any> {
    try {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;

      return {
        cpu: os.loadavg()[0] * 100 / cpus.length,
        memoryPercentage: (usedMem / totalMem) * 100,
        avgResponseTime: 0, // 需要从其他服务获取
      };
    } catch (error) {
      return {
        cpu: 0,
        memoryPercentage: 0,
        avgResponseTime: 0,
      };
    }
  }

  /**
   * 查找告警
   */
  private findAlert(alertId: string): Alert | undefined {
    return Array.from(this.alerts.values()).find(a => a.id === alertId);
  }

  /**
   * 持久化告警
   */
  private async persistAlert(alert: Alert) {
    try {
      const key = `alert:${alert.id}`;
      await this.redisService.setex(key, 86400, JSON.stringify(alert)); // 保留24小时
    } catch (error: any) {
      this.logger.error('[AlertService] Failed to persist alert:', error);
    }
  }

  /**
   * 发送告警通知
   */
  private async sendNotification(alert: Alert) {
    try {
      // 构建通知消息
      const message: NotificationMessage = {
        title: alert.title,
        content: alert.message,
        severity: alert.severity as any,
        metadata: {
          alertId: alert.id,
          service: alert.service,
          type: alert.type,
          count: alert.count,
          ...alert.metadata,
        },
        timestamp: alert.createdAt,
      };

      // 通过通知渠道服务发送
      const results = await this.notificationChannelService.sendNotification(message);

      // 记录发送结果
      const successCount = results.filter(r => r.success).length;
      this.logger.info(
        `[AlertService] Notification sent for alert ${alert.id}: ` +
        `${successCount}/${results.length} channels succeeded`
      );

      // 如果所有渠道都失败，记录错误
      if (results.length > 0 && successCount === 0) {
        const errors = results.map(r => `${r.channel}: ${r.error}`).join('; ');
        this.logger.error(`[AlertService] All notification channels failed: ${errors}`);
      }
    } catch (error: any) {
      this.logger.error('[AlertService] Failed to send notification:', error);
    }
  }

  /**
   * 清理旧告警
   */
  private async cleanupOldAlerts() {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7天

    for (const [key, alert] of this.alerts) {
      const age = now - alert.createdAt.getTime();
      if (age > maxAge && alert.status === AlertStatus.RESOLVED) {
        this.alerts.delete(key);
      }
    }

    this.logger.info(`[AlertService] Cleaned up old alerts, remaining: ${this.alerts.size}`);
  }

  /**
   * 处理服务健康状态变化
   */
  async handleServiceHealthChange(serviceName: string, status: 'healthy' | 'degraded' | 'down') {
    if (status === 'down') {
      await this.createAlert({
        type: AlertType.SERVICE_DOWN,
        severity: AlertSeverity.CRITICAL,
        title: `服务宕机: ${serviceName}`,
        message: `服务 ${serviceName} 无法访问`,
        service: serviceName,
      });
    } else if (status === 'degraded') {
      await this.createAlert({
        type: AlertType.HIGH_RESPONSE_TIME,
        severity: AlertSeverity.WARNING,
        title: `服务降级: ${serviceName}`,
        message: `服务 ${serviceName} 响应缓慢或部分功能异常`,
        service: serviceName,
      });
    } else {
      // 服务恢复，自动解决相关告警
      for (const [key, alert] of this.alerts) {
        if (alert.service === serviceName && alert.status === AlertStatus.ACTIVE) {
          await this.resolveAlert(alert.id, 'system');
        }
      }
    }
  }

  /**
   * 批量创建告警
   */
  async createBatchAlerts(alerts: Array<{
    type: AlertType;
    severity: AlertSeverity;
    title: string;
    message: string;
    service: string;
    metadata?: Record<string, any>;
  }>): Promise<Alert[]> {
    const results: Alert[] = [];

    for (const alertParams of alerts) {
      const alert = await this.createAlert(alertParams);
      results.push(alert);
    }

    return results;
  }

  /**
   * 删除告警
   */
  async deleteAlert(alertId: string): Promise<boolean> {
    const alert = this.findAlert(alertId);
    if (!alert) {
      return false;
    }

    // 只允许删除已解决的告警
    if (alert.status !== AlertStatus.RESOLVED) {
      return false;
    }

    // 从内存中删除
    for (const [key, a] of this.alerts) {
      if (a.id === alertId) {
        this.alerts.delete(key);
        break;
      }
    }

    // 从Redis删除
    await this.redisService.del(`alert:${alertId}`);

    return true;
  }

  /**
   * 获取告警趋势
   */
  async getAlertTrend(days: number = 7): Promise<{
    dates: string[];
    counts: number[];
    bySeverity: Record<AlertSeverity, number[]>;
  }> {
    const dates: string[] = [];
    const counts: number[] = [];
    const bySeverity: Record<AlertSeverity, number[]> = {
      [AlertSeverity.INFO]: [],
      [AlertSeverity.WARNING]: [],
      [AlertSeverity.ERROR]: [],
      [AlertSeverity.CRITICAL]: [],
    };

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now - i * dayMs);
      const dateStr = date.toISOString().split('T')[0];
      dates.push(dateStr);

      const dayStart = new Date(date.setHours(0, 0, 0, 0)).getTime();
      const dayEnd = new Date(date.setHours(23, 59, 59, 999)).getTime();

      // 统计当天创建的告警
      const dayAlerts = Array.from(this.alerts.values()).filter(
        a => a.createdAt.getTime() >= dayStart && a.createdAt.getTime() <= dayEnd
      );

      counts.push(dayAlerts.length);

      // 按严重程度统计
      for (const severity of Object.values(AlertSeverity)) {
        const count = dayAlerts.filter(a => a.severity === severity).length;
        bySeverity[severity].push(count);
      }
    }

    return { dates, counts, bySeverity };
  }
}
