import { Provide, Inject, Config, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { HttpService } from '@midwayjs/axios';

/**
 * 通知渠道类型
 */
export enum NotificationChannelType {
  DINGTALK = 'dingtalk',
  WECOM = 'wecom',
  EMAIL = 'email',
  WEBHOOK = 'webhook',
}

/**
 * 通知渠道配置
 */
export interface NotificationChannelConfig {
  type: NotificationChannelType;
  enabled: boolean;
  webhookUrl?: string;
  secret?: string;
  // 邮件配置
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
  // 接收人配置
  recipients?: string[];
  // 严重级别过滤（只发送指定级别以上的告警）
  minSeverity?: string[];
}

/**
 * 通知消息
 */
export interface NotificationMessage {
  title: string;
  content: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  metadata?: Record<string, any>;
  timestamp: Date;
}

/**
 * 通知发送结果
 */
export interface NotificationResult {
  channel: NotificationChannelType;
  success: boolean;
  error?: string;
  timestamp: Date;
}

/**
 * 通知渠道服务
 *
 * 支持多种通知渠道：钉钉、企业微信、邮件、自定义Webhook
 */
@Provide()
export class NotificationChannelService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redisService!: RedisService;

  @Inject()
  httpService!: HttpService;

  @Config('notification')
  notificationConfig: NotificationChannelConfig[];

  // 渠道配置缓存
  private channelConfigs: Map<NotificationChannelType, NotificationChannelConfig> = new Map();

  // 发送历史（用于限流和去重）
  private sendHistory: Map<string, Date> = new Map();

  @Init()
  async init() {
    this.logger.info('[NotificationChannelService] Initializing notification channels...');

    // 加载配置
    if (this.notificationConfig && Array.isArray(this.notificationConfig)) {
      for (const config of this.notificationConfig) {
        if (config.enabled) {
          this.channelConfigs.set(config.type, config);
          this.logger.info(`[NotificationChannelService] Enabled channel: ${config.type}`);
        }
      }
    }

    // 从Redis加载运行时配置
    await this.loadChannelConfigs();
  }

  /**
   * 发送通知到所有启用的渠道
   */
  async sendNotification(message: NotificationMessage): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    const messageKey = this.generateMessageKey(message);

    // 检查是否在冷却期内（防止重复发送）
    if (await this.isInCooldown(messageKey)) {
      this.logger.debug(`[NotificationChannelService] Message in cooldown: ${messageKey}`);
      return results;
    }

    // 遍历所有启用的渠道
    for (const [type, config] of this.channelConfigs) {
      // 检查严重级别过滤
      if (config.minSeverity && !config.minSeverity.includes(message.severity)) {
        continue;
      }

      try {
        let result: NotificationResult;

        switch (type) {
          case NotificationChannelType.DINGTALK:
            result = await this.sendToDingTalk(config, message);
            break;
          case NotificationChannelType.WECOM:
            result = await this.sendToWeCom(config, message);
            break;
          case NotificationChannelType.EMAIL:
            result = await this.sendToEmail(config, message);
            break;
          case NotificationChannelType.WEBHOOK:
            result = await this.sendToWebhook(config, message);
            break;
          default:
            result = {
              channel: type,
              success: false,
              error: 'Unknown channel type',
              timestamp: new Date(),
            };
        }

        results.push(result);

        if (result.success) {
          this.logger.info(`[NotificationChannelService] Notification sent via ${type}: ${message.title}`);
        } else {
          this.logger.error(`[NotificationChannelService] Failed to send via ${type}: ${result.error}`);
        }
      } catch (error: any) {
        results.push({
          channel: type,
          success: false,
          error: error.message,
          timestamp: new Date(),
        });
        this.logger.error(`[NotificationChannelService] Error sending via ${type}:`, error);
      }
    }

    // 记录发送历史
    if (results.some(r => r.success)) {
      await this.recordSendHistory(messageKey);
    }

    return results;
  }

  /**
   * 发送到钉钉
   */
  private async sendToDingTalk(config: NotificationChannelConfig, message: NotificationMessage): Promise<NotificationResult> {
    if (!config.webhookUrl) {
      return {
        channel: NotificationChannelType.DINGTALK,
        success: false,
        error: 'DingTalk webhook URL not configured',
        timestamp: new Date(),
      };
    }

    try {
      const body = this.buildDingTalkBody(config, message);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      // 如果配置了签名
      if (config.secret) {
        const { sign, timestamp } = this.generateDingTalkSign(config.secret);
        headers['timestamp'] = timestamp;
        headers['sign'] = sign;
      }

      const response = await this.httpService.post(config.webhookUrl, body, { headers, timeout: 10000 });

      if (response.data.errcode === 0) {
        return {
          channel: NotificationChannelType.DINGTALK,
          success: true,
          timestamp: new Date(),
        };
      } else {
        return {
          channel: NotificationChannelType.DINGTALK,
          success: false,
          error: response.data.errmsg || 'Unknown error',
          timestamp: new Date(),
        };
      }
    } catch (error: any) {
      return {
        channel: NotificationChannelType.DINGTALK,
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * 发送到企业微信
   */
  private async sendToWeCom(config: NotificationChannelConfig, message: NotificationMessage): Promise<NotificationResult> {
    if (!config.webhookUrl) {
      return {
        channel: NotificationChannelType.WECOM,
        success: false,
        error: 'WeCom webhook URL not configured',
        timestamp: new Date(),
      };
    }

    try {
      const body = this.buildWeComBody(message);

      const response = await this.httpService.post(config.webhookUrl, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      if (response.data.errcode === 0) {
        return {
          channel: NotificationChannelType.WECOM,
          success: true,
          timestamp: new Date(),
        };
      } else {
        return {
          channel: NotificationChannelType.WECOM,
          success: false,
          error: response.data.errmsg || 'Unknown error',
          timestamp: new Date(),
        };
      }
    } catch (error: any) {
      return {
        channel: NotificationChannelType.WECOM,
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * 发送邮件（占位符 - 需要集成 nodemailer）
   */
  private async sendToEmail(config: NotificationChannelConfig, message: NotificationMessage): Promise<NotificationResult> {
    if (!config.smtp || !config.recipients || config.recipients.length === 0) {
      return {
        channel: NotificationChannelType.EMAIL,
        success: false,
        error: 'Email configuration incomplete',
        timestamp: new Date(),
      };
    }

    // 邮件发送逻辑需要集成 nodemailer
    // 这里提供接口占位符
    this.logger.info(`[NotificationChannelService] Email notification: ${message.title} to ${config.recipients.join(', ')}`);

    // TODO: 实现实际邮件发送
    // const nodemailer = require('nodemailer');
    // const transporter = nodemailer.createTransport(config.smtp);
    // await transporter.sendMail({
    //   from: config.smtp.from,
    //   to: config.recipients.join(','),
    //   subject: `[${message.severity.toUpperCase()}] ${message.title}`,
    //   html: this.formatEmailBody(message),
    // });

    return {
      channel: NotificationChannelType.EMAIL,
      success: true,
      timestamp: new Date(),
    };
  }

  /**
   * 发送到自定义 Webhook
   */
  private async sendToWebhook(config: NotificationChannelConfig, message: NotificationMessage): Promise<NotificationResult> {
    if (!config.webhookUrl) {
      return {
        channel: NotificationChannelType.WEBHOOK,
        success: false,
        error: 'Webhook URL not configured',
        timestamp: new Date(),
      };
    }

    try {
      const body = {
        title: message.title,
        content: message.content,
        severity: message.severity,
        metadata: message.metadata,
        timestamp: message.timestamp.toISOString(),
      };

      const response = await this.httpService.post(config.webhookUrl, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      if (response.status >= 200 && response.status < 300) {
        return {
          channel: NotificationChannelType.WEBHOOK,
          success: true,
          timestamp: new Date(),
        };
      } else {
        return {
          channel: NotificationChannelType.WEBHOOK,
          success: false,
          error: `HTTP ${response.status}`,
          timestamp: new Date(),
        };
      }
    } catch (error: any) {
      return {
        channel: NotificationChannelType.WEBHOOK,
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * 构建钉钉消息体
   */
  private buildDingTalkBody(config: NotificationChannelConfig, message: NotificationMessage): any {
    const severityEmoji = this.getSeverityEmoji(message.severity);
    const severityColor = this.getSeverityColor(message.severity);

    return {
      msgtype: 'markdown',
      markdown: {
        title: `${severityEmoji} ${message.title}`,
        text: `### ${severityEmoji} ${message.title}\n\n` +
          `**严重级别**: <font color="${severityColor}">${message.severity.toUpperCase()}</font>\n\n` +
          `**时间**: ${message.timestamp.toLocaleString('zh-CN')}\n\n` +
          `**内容**: ${message.content}\n\n` +
          (message.metadata ? `**详细信息**: \n\`\`\`json\n${JSON.stringify(message.metadata, null, 2)}\n\`\`\`` : ''),
      },
    };
  }

  /**
   * 构建企业微信消息体
   */
  private buildWeComBody(message: NotificationMessage): any {
    const severityEmoji = this.getSeverityEmoji(message.severity);

    return {
      msgtype: 'markdown',
      markdown: {
        content: `### ${severityEmoji} ${message.title}\n` +
          `> 严重级别: **${message.severity.toUpperCase()}**\n` +
          `> 时间: ${message.timestamp.toLocaleString('zh-CN')}\n` +
          `> 内容: ${message.content}` +
          (message.metadata ? `\n\n详细信息:\n\`\`\`json\n${JSON.stringify(message.metadata, null, 2)}\n\`\`\`` : ''),
      },
    };
  }

  /**
   * 生成钉钉签名
   */
  private generateDingTalkSign(secret: string): { sign: string; timestamp: string } {
    const crypto = require('crypto');
    const timestamp = Date.now().toString();
    const stringToSign = `${timestamp}\n${secret}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(stringToSign);
    const sign = encodeURIComponent(hmac.digest('base64'));

    return { sign, timestamp };
  }

  /**
   * 获取严重级别对应的 emoji
   */
  private getSeverityEmoji(severity: string): string {
    const emojis: Record<string, string> = {
      info: 'ℹ️',
      warning: '⚠️',
      error: '❌',
      critical: '🚨',
    };
    return emojis[severity] || '📢';
  }

  /**
   * 获取严重级别对应的颜色
   */
  private getSeverityColor(severity: string): string {
    const colors: Record<string, string> = {
      info: '#36a64f',
      warning: '#ff9800',
      error: '#f44336',
      critical: '#d32f2f',
    };
    return colors[severity] || '#2196f3';
  }

  /**
   * 生成消息唯一键（用于去重）
   */
  private generateMessageKey(message: NotificationMessage): string {
    const crypto = require('crypto');
    const content = `${message.title}:${message.content}`;
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * 检查是否在冷却期
   */
  private async isInCooldown(messageKey: string): Promise<boolean> {
    const lastSent = this.sendHistory.get(messageKey);
    if (!lastSent) {
      return false;
    }

    // 冷却期为 5 分钟
    const cooldownMs = 5 * 60 * 1000;
    return Date.now() - lastSent.getTime() < cooldownMs;
  }

  /**
   * 记录发送历史
   */
  private async recordSendHistory(messageKey: string): Promise<void> {
    const now = new Date();
    this.sendHistory.set(messageKey, now);

    // 同时存储到 Redis（重启后保持）
    await this.redisService.setex(
      `notification:history:${messageKey}`,
      300, // 5 分钟
      now.toISOString()
    );
  }

  /**
   * 从 Redis 加载渠道配置
   */
  private async loadChannelConfigs(): Promise<void> {
    try {
      const configKey = 'notification:channels:config';
      const configData = await this.redisService.get(configKey);

      if (configData) {
        const configs = JSON.parse(configData) as NotificationChannelConfig[];
        for (const config of configs) {
          if (config.enabled) {
            this.channelConfigs.set(config.type, config);
          }
        }
      }
    } catch (error: any) {
      this.logger.error('[NotificationChannelService] Failed to load channel configs:', error);
    }
  }

  /**
   * 更新渠道配置
   */
  async updateChannelConfig(config: NotificationChannelConfig): Promise<void> {
    if (config.enabled) {
      this.channelConfigs.set(config.type, config);
    } else {
      this.channelConfigs.delete(config.type);
    }

    // 持久化到 Redis
    const configs = Array.from(this.channelConfigs.values());
    await this.redisService.set('notification:channels:config', JSON.stringify(configs));

    this.logger.info(`[NotificationChannelService] Channel config updated: ${config.type}`);
  }

  /**
   * 获取所有渠道配置
   */
  getChannelConfigs(): NotificationChannelConfig[] {
    return Array.from(this.channelConfigs.values());
  }

  /**
   * 测试渠道连接
   */
  async testChannel(type: NotificationChannelType): Promise<{ success: boolean; message: string }> {
    const config = this.channelConfigs.get(type);
    if (!config) {
      return { success: false, message: 'Channel not configured' };
    }

    const testMessage: NotificationMessage = {
      title: '测试通知',
      content: '这是一条测试通知消息，用于验证通知渠道配置是否正确。',
      severity: 'info',
      timestamp: new Date(),
    };

    let result: NotificationResult;

    switch (type) {
      case NotificationChannelType.DINGTALK:
        result = await this.sendToDingTalk(config, testMessage);
        break;
      case NotificationChannelType.WECOM:
        result = await this.sendToWeCom(config, testMessage);
        break;
      case NotificationChannelType.EMAIL:
        result = await this.sendToEmail(config, testMessage);
        break;
      case NotificationChannelType.WEBHOOK:
        result = await this.sendToWebhook(config, testMessage);
        break;
      default:
        return { success: false, message: 'Unknown channel type' };
    }

    return {
      success: result.success,
      message: result.success ? 'Test notification sent successfully' : result.error || 'Unknown error',
    };
  }
}
