import { Provide, Inject, Autoload, Init } from '@midwayjs/core';
import { RedisService } from '@midwayjs/redis';
import { Namespace } from 'socket.io';
import * as nodemailer from 'nodemailer';
import { ILogger } from '@midwayjs/logger';
import { PushNotificationService, PushMessage } from './push-notification.service';
import { SMSProviderService } from './sms-provider.service';

/**
 * 通知优先级
 */
export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

/**
 * 通知渠道
 */
export enum NotificationChannel {
  WEBSOCKET = 'websocket',
  SMS = 'sms',
  EMAIL = 'email',
  PUSH = 'push',
  ALL = 'all',
}

/**
 * 通知类型
 */
export enum NotificationType {
  // 宝宝监控相关
  BABY_CRYING = 'baby_crying',
  BABY_MOTION = 'baby_motion',
  BABY_FACE = 'baby_face',
  TEMPERATURE_ALERT = 'temperature_alert',
  HUMIDITY_ALERT = 'humidity_alert',
  SLEEP_STATE_CHANGE = 'sleep_state_change',

  // 设备相关
  DEVICE_OFFLINE = 'device_offline',
  DEVICE_LOW_BATTERY = 'device_low_battery',
  DEVICE_FIRMWARE_UPDATE = 'device_firmware_update',
  DEVICE_ALERT = 'device_alert',

  // 系统相关
  SYSTEM_MAINTENANCE = 'system_maintenance',
  SECURITY_ALERT = 'security_alert',
  ACCOUNT_NOTICE = 'account_notice',
}

/**
 * 通知消息接口
 */
export interface NotificationMessage {
  id: string;
  type: NotificationType;
  title: string;
  content: string;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  data?: Record<string, any>;
  targetUsers?: string[];
  targetDomains?: string[];
  createdAt: Date;
  expireAt?: Date;
  read?: boolean;
}

/**
 * SMS 配置
 */
interface SmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  endpoint: string;
  apiVersion: string;
  templateCode: string;
}

/**
 * Email 配置
 */
interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  } | {
    user?: string;
    pass?: string;
  };
  from: string;
  fromName?: string;
}

/**
 * 通知服务配置
 */
interface NotificationConfig {
  sms?: SmsConfig;
  email?: EmailConfig;
  enabledChannels: NotificationChannel[];
  retentionDays: number;
  maxNotificationsPerUser: number;
}

/**
 * 统一通知服务
 *
 * 支持多渠道通知：WebSocket、SMS、Email、推送
 */
@Autoload()
@Provide()
export class NotificationService {
  @Inject()
  redis!: RedisService;

  @Inject()
  logger!: ILogger;

  @Inject()
  smsProviderService!: SMSProviderService;

  @Inject()
  pushNotificationService!: PushNotificationService;

  // @Inject('socketio:namespace')
  socketNamespace?: Namespace;

  private emailTransporter!: nodemailer.Transporter;
  private config!: NotificationConfig;

  @Init()
  async init() {
    this.config = this.loadConfig();

    // 初始化邮件传输器
    if (this.config.email) {
      this.emailTransporter = nodemailer.createTransport({
        host: this.config.email.host,
        port: this.config.email.port,
        secure: this.config.email.secure,
        auth: this.config.email.auth,
      });
      this.logger.info('[NotificationService] Email transporter initialized');
    }

    this.logger.info('[NotificationService] Notification service initialized');
  }

  /**
   * 加载配置
   */
  private loadConfig(): NotificationConfig {
    return {
      sms: process.env.ALIYUN_ACCESS_KEY_ID ? {
        accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
        accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET || '',
        signName: process.env.ALIYUN_SMS_SIGN_NAME || '智能家居',
        endpoint: 'https://dysmsapi.aliyuncs.com',
        apiVersion: '2017-05-25',
        templateCode: process.env.ALIYUN_SMS_TEMPLATE_INVITATION || process.env.ALIYUN_SMS_TEMPLATE_REGISTER || 'SMS_TEMPLATE',
      } : undefined,
      email: process.env.EMAIL_SMTP_HOST ? {
        host: process.env.EMAIL_SMTP_HOST,
        port: parseInt(process.env.EMAIL_SMTP_PORT || '587'),
        secure: process.env.EMAIL_SMTP_SECURE === 'true',
        auth: {
          user: process.env.EMAIL_SMTP_USER,
          pass: process.env.EMAIL_SMTP_PASS,
        },
        from: process.env.EMAIL_FROM || 'noreply@babymonitor.com',
        fromName: process.env.EMAIL_FROM_NAME || '宝宝监控系统',
      } : undefined,
      enabledChannels: (process.env.NOTIFICATION_CHANNELS?.split(',') || [
        'websocket',
        'email',
        ...(process.env.ALIYUN_ACCESS_KEY_ID ? ['sms'] : []),
      ]) as NotificationChannel[],
      retentionDays: parseInt(process.env.NOTIFICATION_RETENTION_DAYS || '30'),
      maxNotificationsPerUser: parseInt(process.env.MAX_NOTIFICATIONS_PER_USER || '100'),
    };
  }

  /**
   * 发送通知
   *
   * @param message - 通知消息
   * @returns 发送结果
   */
  async send(message: Omit<NotificationMessage, 'id' | 'createdAt'>): Promise<{ success: boolean; channels: string[]; errors?: string[] }> {
    const notification: NotificationMessage = {
      ...message,
      id: this.generateNotificationId(),
      createdAt: new Date(),
    };

    const channels = message.channels.includes(NotificationChannel.ALL)
      ? this.config.enabledChannels
      : message.channels.filter(c => this.config.enabledChannels.includes(c));

    const results: string[] = [];
    const errors: string[] = [];

    // 按优先级排序发送
    if (channels.includes(NotificationChannel.WEBSOCKET)) {
      await this.sendWebSocket(notification).catch(e => errors.push(`WebSocket: ${e.message}`));
      results.push('websocket');
    }

    if (channels.includes(NotificationChannel.SMS)) {
      await this.sendSMS(notification).catch(e => errors.push(`SMS: ${e.message}`));
      results.push('sms');
    }

    if (channels.includes(NotificationChannel.EMAIL)) {
      await this.sendEmail(notification).catch(e => errors.push(`Email: ${e.message}`));
      results.push('email');
    }

    if (channels.includes(NotificationChannel.PUSH)) {
      await this.sendPush(notification).catch(e => errors.push(`Push: ${e.message}`));
      results.push('push');
    }

    // 保存通知历史
    await this.saveNotificationHistory(notification);

    return {
      success: errors.length === 0,
      channels: results,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * 发送 WebSocket 通知
   */
  private async sendWebSocket(notification: NotificationMessage): Promise<void> {
    const rooms: string[] = [];

    if (notification.targetUsers) {
      notification.targetUsers.forEach(userId => {
        rooms.push(`user:${userId}`);
      });
    }

    if (notification.targetDomains) {
      notification.targetDomains.forEach(domainId => {
        rooms.push(`domain:${domainId}`);
      });
    }

    const payload = {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      content: notification.content,
      priority: notification.priority,
      data: notification.data,
      timestamp: notification.createdAt,
    };

    // 发送到 WebSocket（如果可用）
    if (this.socketNamespace) {
      try {
        // 发送到所有相关房间
        if (rooms.length > 0) {
          this.socketNamespace.to(rooms).emit('notification', payload);
        } else {
          this.socketNamespace.emit('notification', payload);
        }
      } catch (error) {
        this.logger.warn('[NotificationService] WebSocket send failed', error);
      }
    }

    // 同时发布到 Redis，支持跨实例推送
    await this.redis.publish('notifications:all', JSON.stringify({
      rooms,
      payload,
    }));
  }

  /**
   * 发送短信通知
   */
  /**
   * 判断是否为手机号（以+或数字开头，至少7位）
   */
  private isPhoneNumber(value: string): boolean {
    return /^\+?\d{7,15}$/.test(value);
  }

  private async sendSMS(notification: NotificationMessage): Promise<void> {
    if (!notification.targetUsers || notification.targetUsers.length === 0) {
      return;
    }

    // 区分直接传入的手机号和需要查询的 userId
    const phoneNumbers: string[] = [];
    const userIds: string[] = [];

    for (const target of notification.targetUsers) {
      if (this.isPhoneNumber(target)) {
        phoneNumbers.push(target);
      } else {
        userIds.push(target);
      }
    }

    // 对 userId 从 Redis 查手机号
    if (userIds.length > 0) {
      const lookedUp = await this.getUserPhoneNumbers(userIds);
      phoneNumbers.push(...lookedUp);
    }

    if (phoneNumbers.length === 0) {
      return;
    }

    // 委托统一短信服务发送
    const templateCode = process.env.ALIYUN_SMS_TEMPLATE_INVITATION
      || process.env.ALIYUN_SMS_TEMPLATE_REGISTER || 'SMS_TEMPLATE';

    for (const phone of phoneNumbers) {
      const result = await this.smsProviderService.send({
        phoneNumber: phone,
        templateCode,
        templateParams: notification.data || { code: notification.content },
      });
      if (!result.success) {
        this.logger.error(`[NotificationService] SMS send failed: ${result.message}`);
        throw new Error(result.message || 'SMS send failed');
      }
      this.logger.info(`[NotificationService] SMS sent to ${phone}, requestId: ${result.requestId}`);
    }
  }

  /**
   * 发送邮件通知
   */
  private async sendEmail(notification: NotificationMessage): Promise<void> {
    if (!this.emailTransporter || !this.config.email) {
      this.logger.warn('[NotificationService] Email not configured');
      return;
    }

    if (!notification.targetUsers || notification.targetUsers.length === 0) {
      return;
    }

    const emailAddresses = await this.getUserEmailAddresses(notification.targetUsers);
    if (emailAddresses.length === 0) {
      return;
    }

    const mailOptions = {
      from: `"${this.config.email.fromName}" <${this.config.email.from}>`,
      to: emailAddresses.join(','),
      subject: `[${this.getPriorityLabel(notification.priority)}] ${notification.title}`,
      html: this.generateEmailTemplate(notification),
    };

    try {
      await this.emailTransporter.sendMail(mailOptions);
      this.logger.info('[NotificationService] Email sent successfully', { notificationId: notification.id });
    } catch (error) {
      this.logger.error('[NotificationService] Email send failed', error);
      throw error;
    }
  }

  /**
   * 发送推送通知（移动端）
   */
  private async sendPush(notification: NotificationMessage): Promise<void> {
    if (!notification.targetUsers || notification.targetUsers.length === 0) {
      return;
    }

    // 转换为推送消息格式
    const pushMessage: PushMessage = {
      title: notification.title,
      body: notification.content,
      data: notification.data,
      sound: 'default',
      badge: 1,
      priority: notification.priority === NotificationPriority.URGENT
        ? 'high' as any
        : 'normal' as any,
    };

    // 发送到所有目标用户
    await this.pushNotificationService.sendToUsers(notification.targetUsers, pushMessage);
    this.logger.info('[NotificationService] Push notification sent', { notificationId: notification.id });
  }

  /**
   * 保存通知历史
   */
  private async saveNotificationHistory(notification: NotificationMessage): Promise<void> {
    const key = `notification:${notification.id}`;
    const ttl = this.config.retentionDays * 24 * 3600;

    await this.redis.setex(key, ttl, JSON.stringify({
      ...notification,
      createdAt: notification.createdAt.toISOString(),
      expireAt: notification.expireAt?.toISOString(),
    }));

    // 添加到用户通知列表
    if (notification.targetUsers) {
      for (const userId of notification.targetUsers) {
        const userKey = `user:${userId}:notifications`;
        await this.redis.zadd(userKey, Date.now(), notification.id);

        // 限制列表大小
        const count = await this.redis.zcard(userKey);
        if (count > this.config.maxNotificationsPerUser) {
          await this.redis.zremrangebyrank(userKey, 0, count - this.config.maxNotificationsPerUser);
        }

        await this.redis.expire(userKey, ttl);
      }
    }
  }

  /**
   * 获取用户通知列表
   */
  async getUserNotifications(userId: string, options: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<NotificationMessage[]> {
    const { unreadOnly = false, limit = 20, offset = 0 } = options;

    const userKey = `user:${userId}:notifications`;
    const notificationIds = await this.redis.zrevrange(userKey, offset, offset + limit - 1);

    if (notificationIds.length === 0) {
      return [];
    }

    const notifications: NotificationMessage[] = [];
    for (const id of notificationIds) {
      const data = await this.redis.get(`notification:${id}`);
      if (data) {
        const notification = JSON.parse(data) as NotificationMessage;
        notification.createdAt = new Date(notification.createdAt);
        if (notification.expireAt) {
          notification.expireAt = new Date(notification.expireAt);
        }

        if (!unreadOnly || !notification.read) {
          notifications.push(notification);
        }
      }
    }

    return notifications;
  }

  /**
   * 标记通知为已读
   */
  async markAsRead(userId: string, notificationId: string): Promise<void> {
    const key = `notification:${notificationId}`;
    const data = await this.redis.get(key);
    if (data) {
      const notification = JSON.parse(data) as NotificationMessage;
      notification.read = true;
      await this.redis.set(key, JSON.stringify(notification));
    }
  }

  /**
   * 标记所有通知为已读
   */
  async markAllAsRead(userId: string): Promise<void> {
    const userKey = `user:${userId}:notifications`;
    const notificationIds = await this.redis.zrange(userKey, 0, -1);

    for (const id of notificationIds) {
      await this.markAsRead(userId, id);
    }
  }

  /**
   * 删除通知
   */
  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    await this.redis.del(`notification:${notificationId}`);
    await this.redis.zrem(`user:${userId}:notifications`, notificationId);
  }

  /**
   * 清理过期通知
   */
  async cleanupExpiredNotifications(): Promise<number> {
    let deleted = 0;

    // 扫描所有通知键
    const keys = await this.redis.keys('notification:*');
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const notification = JSON.parse(data) as NotificationMessage;
        if (notification.expireAt && new Date(notification.expireAt) < new Date()) {
          await this.redis.del(key);
          deleted++;
        }
      }
    }

    return deleted;
  }

  /**
   * 获取用户手机号
   */
  private async getUserPhoneNumbers(userIds: string[]): Promise<string[]> {
    const phoneNumbers: string[] = [];

    for (const userId of userIds) {
      const phone = await this.redis.get(`user:${userId}:phone`);
      if (phone) {
        phoneNumbers.push(phone);
      }
    }

    return phoneNumbers;
  }

  /**
   * 获取用户邮箱
   */
  private async getUserEmailAddresses(userIds: string[]): Promise<string[]> {
    const emails: string[] = [];

    for (const userId of userIds) {
      const email = await this.redis.get(`user:${userId}:email`);
      if (email) {
        emails.push(email);
      }
    }

    return emails;
  }

  /**
   * 生成通知ID
   */
  private generateNotificationId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * 获取优先级标签
   */
  private getPriorityLabel(priority: NotificationPriority): string {
    const labels = {
      [NotificationPriority.LOW]: '信息',
      [NotificationPriority.NORMAL]: '通知',
      [NotificationPriority.HIGH]: '重要',
      [NotificationPriority.URGENT]: '紧急',
    };
    return labels[priority] || '通知';
  }

  /**
   * 生成邮件模板
   */
  private generateEmailTemplate(notification: NotificationMessage): string {
    const priorityColors = {
      [NotificationPriority.LOW]: '#6c757d',
      [NotificationPriority.NORMAL]: '#007bff',
      [NotificationPriority.HIGH]: '#fd7e14',
      [NotificationPriority.URGENT]: '#dc3545',
    };

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Microsoft YaHei', Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${priorityColors[notification.priority]}; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
    .content { background: #f8f9fa; padding: 20px; border-radius: 0 0 5px 5px; }
    .footer { margin-top: 20px; text-align: center; color: #6c757d; font-size: 12px; }
    .button { display: inline-block; padding: 10px 20px; background: ${priorityColors[notification.priority]}; color: white; text-decoration: none; border-radius: 5px; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${notification.title}</h2>
    </div>
    <div class="content">
      <p>${notification.content}</p>
      ${notification.data ? `<pre style="background: white; padding: 10px; border-radius: 5px; overflow: auto;">${JSON.stringify(notification.data, null, 2)}</pre>` : ''}
      <a href="https://babymonitor.com/notifications/${notification.id}" class="button">查看详情</a>
    </div>
    <div class="footer">
      <p>此邮件由系统自动发送，请勿回复。</p>
      <p>发送时间: ${notification.createdAt.toLocaleString('zh-CN')}</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * 批量发送通知
   */
  async sendBatch(messages: Array<Omit<NotificationMessage, 'id' | 'createdAt'>>): Promise<Array<{ success: boolean; notificationId?: string; error?: string }>> {
    const results = [];

    for (const message of messages) {
      try {
        const result = await this.send(message);
        results.push({
          success: result.success,
          notificationId: (message as any).id || '',
        });
      } catch (error) {
        results.push({
          success: false,
          error: (error as Error).message || String(error),
        });
      }
    }

    return results;
  }

  /**
   * 获取通知统计
   */
  async getNotificationStats(userId: string): Promise<{
    total: number;
    unread: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
  }> {
    const userKey = `user:${userId}:notifications`;
    const notificationIds = await this.redis.zrange(userKey, 0, -1);

    const stats = {
      total: notificationIds.length,
      unread: 0,
      byType: {} as Record<string, number>,
      byPriority: {} as Record<string, number>,
    };

    for (const id of notificationIds) {
      const data = await this.redis.get(`notification:${id}`);
      if (data) {
        const notification = JSON.parse(data) as NotificationMessage;

        if (!notification.read) {
          stats.unread++;
        }

        stats.byType[notification.type] = (stats.byType[notification.type] || 0) + 1;
        stats.byPriority[notification.priority] = (stats.byPriority[notification.priority] || 0) + 1;
      }
    }

    return stats;
  }
}
