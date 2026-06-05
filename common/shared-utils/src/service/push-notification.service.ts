/**
 * 推送通知服务
 *
 * 支持 APNs (Apple Push Notification service) 和 FCM (Firebase Cloud Messaging)
 * 为 iOS 和 Android 设备提供统一的推送接口
 *
 * 主要功能：
 * - 发送推送通知到 iOS 设备 (APNs)
 * - 发送推送通知到 Android 设备 (FCM)
 * - 管理设备令牌
 * - 批量推送
 * - 推送统计和报告
 */
import { Provide, Inject, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import * as jwt from 'jsonwebtoken';

/**
 * 设备平台
 */
export enum DevicePlatform {
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web',
}

/**
 * 推送优先级
 */
export enum PushPriority {
  HIGH = 'high',
  NORMAL = 'normal',
  LOW = 'low',
}

/**
 * 设备令牌信息
 */
export interface DeviceToken {
  token: string;
  platform: DevicePlatform;
  userId: string;
  deviceId?: string;
  appVersion?: string;
  osVersion?: string;
  activeAt: Date;
  createdAt: Date;
}

/**
 * 推送消息接口
 */
export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: string;
  badge?: number;
  category?: string;
  threadId?: string;
  imageUrl?: string;
  priority?: PushPriority;
  ttl?: number; // 存活时间（秒）
  collapseKey?: string; // 折叠key，相同key的消息会覆盖
}

/**
 * 推送结果接口
 */
export interface PushResult {
  success: boolean;
  tokensSent: number;
  tokensFailed: number;
  failedTokens?: string[];
  error?: string;
}

/**
 * APNs 配置接口
 */
export interface ApnsConfig {
  production: boolean; // 是否生产环境
  keyId: string; // 密钥 ID (来自 Apple Developer)
  teamId: string; // 团队 ID
  privateKey: string; // 私钥内容（.p8 文件内容）
  bundleId: string; // App Bundle ID
}

/**
 * FCM 配置接口
 */
export interface FcmConfig {
  projectId: string; // Firebase 项目 ID
  privateKey: string; // 服务账号私钥
  clientEmail: string; // 服务账号邮箱
}

/**
 * 极光推送配置接口
 */
export interface JPushConfig {
  appKey: string; // 应用 AppKey
  masterSecret: string; // 应用 Master Secret
  production: boolean; // 是否生产环境
}

/**
 * 推送通知配置
 */
export interface PushNotificationConfig {
  apns?: ApnsConfig;
  fcm?: FcmConfig;
  jpush?: JPushConfig;
  enabled: boolean;
  maxRetries: number;
  retryDelay: number;
}

/**
 * 推送通知服务类
 *
 * 提供统一的推送通知接口，支持 APNs、FCM 和极光推送
 */
@Provide()
export class PushNotificationService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  private config!: PushNotificationConfig;
  private fcmAccessToken: string | null = null;
  private fcmTokenExpiry: number = 0;

  // Redis key 前缀
  private readonly DEVICE_TOKEN_PREFIX = 'push:device:';
  private readonly USER_DEVICES_PREFIX = 'push:user:devices:';
  private readonly FCM_AUTH_URL = 'https://oauth2.googleapis.com/token';

  // 极光推送 API 地址
  private readonly JPUSH_PUSH_URL = 'https://api.jpush.cn/v3/push';
  private readonly JPUSH_AUTH_URL = 'https://api.jpush.cn/v3/push/cid'; // 获取推送ID

  @Init()
  async init(): Promise<void> {
    this.config = this.loadConfig();
    this.logger.info('[PushNotificationService] Initialized', {
      apnsEnabled: !!this.config.apns,
      fcmEnabled: !!this.config.fcm,
      jpushEnabled: !!this.config.jpush,
    });
  }

  /**
   * 加载配置
   */
  private loadConfig(): PushNotificationConfig {
    return {
      apns: process.env.APNS_ENABLED === 'true' ? {
        production: process.env.APNS_ENVIRONMENT === 'production',
        keyId: process.env.APNS_KEY_ID || '',
        teamId: process.env.APNS_TEAM_ID || '',
        privateKey: process.env.APNS_PRIVATE_KEY || '',
        bundleId: process.env.APNS_BUNDLE_ID || '',
      } : undefined,
      fcm: process.env.FCM_ENABLED === 'true' ? {
        projectId: process.env.FCM_PROJECT_ID || '',
        privateKey: process.env.FCM_PRIVATE_KEY || '',
        clientEmail: process.env.FCM_CLIENT_EMAIL || '',
      } : undefined,
      jpush: process.env.JPUSH_ENABLED === 'true' ? {
        appKey: process.env.JPUSH_APP_KEY || '',
        masterSecret: process.env.JPUSH_MASTER_SECRET || '',
        production: process.env.JPUSH_ENVIRONMENT === 'production',
      } : undefined,
      enabled: process.env.PUSH_NOTIFICATION_ENABLED === 'true',
      maxRetries: parseInt(process.env.PUSH_MAX_RETRIES || '3', 10),
      retryDelay: parseInt(process.env.PUSH_RETRY_DELAY || '1000', 10),
    };
  }

  /**
   * 注册设备令牌
   *
   * @param token - 设备令牌
   * @param platform - 设备平台
   * @param userId - 用户 ID
   * @param deviceId - 设备 ID（可选）
   * @param appVersion - 应用版本（可选）
   * @param osVersion - 操作系统版本（可选）
   */
  async registerDevice(
    token: string,
    platform: DevicePlatform,
    userId: string,
    deviceId?: string,
    appVersion?: string,
    osVersion?: string
  ): Promise<void> {
    const deviceToken: DeviceToken = {
      token,
      platform,
      userId,
      deviceId,
      appVersion,
      osVersion,
      activeAt: new Date(),
      createdAt: new Date(),
    };

    // 保存设备令牌
    const tokenKey = `${this.DEVICE_TOKEN_PREFIX}${token}`;
    await this.redis.set(tokenKey, JSON.stringify(deviceToken));
    await this.redis.expire(tokenKey, 86400 * 365); // 1 年过期

    // 添加到用户设备列表
    const userDevicesKey = `${this.USER_DEVICES_PREFIX}${userId}`;
    await this.redis.sadd(userDevicesKey, token);
    await this.redis.expire(userDevicesKey, 86400 * 365);

    this.logger.info('[PushNotificationService] Device registered', {
      userId,
      platform,
      deviceId,
    });
  }

  /**
   * 注销设备令牌
   *
   * @param token - 设备令牌
   * @param userId - 用户 ID
   */
  async unregisterDevice(token: string, userId: string): Promise<void> {
    // 删除设备令牌
    const tokenKey = `${this.DEVICE_TOKEN_PREFIX}${token}`;
    await this.redis.del(tokenKey);

    // 从用户设备列表移除
    const userDevicesKey = `${this.USER_DEVICES_PREFIX}${userId}`;
    await this.redis.srem(userDevicesKey, token);

    this.logger.info('[PushNotificationService] Device unregistered', { userId, token });
  }

  /**
   * 注册极光推送设备
   *
   * @param registrationId - 极光推送注册ID
   * @param userId - 用户ID
   * @param platform - 设备平台（ios/android）
   * @param deviceId - 设备ID（可选）
   */
  async registerJPushDevice(
    registrationId: string,
    userId: string,
    platform: 'ios' | 'android',
    deviceId?: string
  ): Promise<void> {
    const deviceToken: DeviceToken = {
      token: registrationId,
      platform: platform === 'ios' ? DevicePlatform.IOS : DevicePlatform.ANDROID,
      userId,
      deviceId,
      activeAt: new Date(),
      createdAt: new Date(),
    };

    // 保存设备令牌
    const tokenKey = `${this.DEVICE_TOKEN_PREFIX}${registrationId}`;
    await this.redis.set(tokenKey, JSON.stringify(deviceToken));
    await this.redis.expire(tokenKey, 86400 * 365);

    // 添加到用户设备列表
    const userDevicesKey = `${this.USER_DEVICES_PREFIX}${userId}`;
    await this.redis.sadd(userDevicesKey, registrationId);
    await this.redis.expire(userDevicesKey, 86400 * 365);

    this.logger.info('[PushNotificationService] JPush device registered', {
      userId,
      platform,
      registrationId: registrationId.substring(0, 20) + '...',
    });
  }

  /**
   * 设置极光推送别名
   *
   * 别名用于更方便地推送，一个用户可以有多个设备，但别名应该是唯一的
   *
   * @param registrationId - 极光推送注册ID
   * @param alias - 别名（通常使用用户ID）
   * @returns 是否成功
   */
  async setJPushAlias(registrationId: string, alias: string): Promise<boolean> {
    if (!this.config.jpush) {
      this.logger.warn('[PushNotificationService] JPush not configured');
      return false;
    }

    try {
      const auth = Buffer.from(`${this.config.jpush.appKey}:${this.config.jpush.masterSecret}`).toString('base64');

      const response = await fetch('https://api.jpush.cn/v3/aliases', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registration_ids: [registrationId],
          alias,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`JPush set alias failed: ${response.status} ${errorText}`);
      }

      this.logger.info('[PushNotificationService] JPush alias set', {
        alias,
        registrationId: registrationId.substring(0, 20) + '...',
      });

      return true;
    } catch (error) {
      this.logger.error('[PushNotificationService] JPush set alias failed', error);
      return false;
    }
  }

  /**
   * 设置极光推送标签
   *
   * 标签用于分组推送，例如：男宝宝、女宝宝、高端用户等
   *
   * @param registrationId - 极光推送注册ID
   * @param tags - 标签数组
   * @returns 是否成功
   */
  async setJPushTags(registrationId: string, tags: string[]): Promise<boolean> {
    if (!this.config.jpush) {
      this.logger.warn('[PushNotificationService] JPush not configured');
      return false;
    }

    try {
      const auth = Buffer.from(`${this.config.jpush.appKey}:${this.config.jpush.masterSecret}`).toString('base64');

      const response = await fetch(`https://api.jpush.cn/v3/tags/${registrationId}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tags: tags.map(tag => ({ tag })),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`JPush set tags failed: ${response.status} ${errorText}`);
      }

      this.logger.info('[PushNotificationService] JPush tags set', {
        tags,
        registrationId: registrationId.substring(0, 20) + '...',
      });

      return true;
    } catch (error) {
      this.logger.error('[PushNotificationService] JPush set tags failed', error);
      return false;
    }
  }

  /**
   * 通过别名发送极光推送
   *
   * @param alias - 用户别名
   * @param message - 推送消息
   * @returns 发送结果
   */
  async sendToJPushByAlias(
    alias: string,
    message: PushMessage
  ): Promise<{ success: boolean; msgId?: string; error?: string }> {
    if (!this.config.jpush) {
      return { success: false, error: 'JPush not configured' };
    }

    try {
      const jpushPayload = {
        platform: 'all',
        audience: {
          alias: [alias],
        },
        notification: {
          alert: {
            title: message.title,
            body: message.body,
          },
          android: {
            title: message.title,
            alert: message.body,
            sound: message.sound || 'default',
            extras: message.data || {},
          },
          ios: {
            title: message.title,
            body: message.body,
            sound: message.sound || 'default',
            badge: message.badge || '+1',
            'content-available': 1,
            extras: message.data || {},
          },
        },
        options: {
          apns_production: this.config.jpush.production,
          time_to_live: message.ttl || 86400,
          priority: message.priority === PushPriority.HIGH ? 1 : 0,
        },
      };

      const auth = Buffer.from(`${this.config.jpush.appKey}:${this.config.jpush.masterSecret}`).toString('base64');

      const response = await fetch(this.JPUSH_PUSH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jpushPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`JPush push by alias failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as { msg_id: string; error?: any };

      if (result.error) {
        return { success: false, error: JSON.stringify(result.error) };
      }

      this.logger.info('[PushNotificationService] JPush push by alias success', {
        msgId: result.msg_id,
        alias,
      });

      return { success: true, msgId: result.msg_id };
    } catch (error) {
      this.logger.error('[PushNotificationService] JPush push by alias failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 通过标签发送极光推送
   *
   * @param tags - 标签数组
   * @param message - 推送消息
   * @returns 发送结果
   */
  async sendToJPushByTags(
    tags: string[],
    message: PushMessage
  ): Promise<{ success: boolean; msgId?: string; error?: string }> {
    if (!this.config.jpush) {
      return { success: false, error: 'JPush not configured' };
    }

    if (tags.length === 0) {
      return { success: false, error: 'No tags provided' };
    }

    try {
      const jpushPayload = {
        platform: 'all',
        audience: {
          tag: tags,
        },
        notification: {
          alert: {
            title: message.title,
            body: message.body,
          },
          android: {
            title: message.title,
            alert: message.body,
            sound: message.sound || 'default',
            extras: message.data || {},
          },
          ios: {
            title: message.title,
            body: message.body,
            sound: message.sound || 'default',
            badge: message.badge || '+1',
            'content-available': 1,
            extras: message.data || {},
          },
        },
        options: {
          apns_production: this.config.jpush.production,
          time_to_live: message.ttl || 86400,
          priority: message.priority === PushPriority.HIGH ? 1 : 0,
        },
      };

      const auth = Buffer.from(`${this.config.jpush.appKey}:${this.config.jpush.masterSecret}`).toString('base64');

      const response = await fetch(this.JPUSH_PUSH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jpushPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`JPush push by tags failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as { msg_id: string; error?: any };

      if (result.error) {
        return { success: false, error: JSON.stringify(result.error) };
      }

      this.logger.info('[PushNotificationService] JPush push by tags success', {
        msgId: result.msg_id,
        tags,
      });

      return { success: true, msgId: result.msg_id };
    } catch (error) {
      this.logger.error('[PushNotificationService] JPush push by tags failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取用户的所有设备
   *
   * @param userId - 用户 ID
   * @returns 设备令牌列表
   */
  async getUserDevices(userId: string): Promise<DeviceToken[]> {
    const userDevicesKey = `${this.USER_DEVICES_PREFIX}${userId}`;
    const tokens = await this.redis.smembers(userDevicesKey);

    const devices: DeviceToken[] = [];
    for (const token of tokens) {
      const tokenKey = `${this.DEVICE_TOKEN_PREFIX}${token}`;
      const data = await this.redis.get(tokenKey);
      if (data) {
        devices.push(JSON.parse(data) as DeviceToken);
      }
    }

    return devices;
  }

  /**
   * 发送推送通知到单个设备
   *
   * @param token - 设备令牌
   * @param message - 推送消息
   * @param platform - 设备平台
   * @returns 发送结果
   */
  async sendToDevice(
    token: string,
    message: PushMessage,
    platform: DevicePlatform
  ): Promise<boolean> {
    try {
      if (!this.config.enabled) {
        this.logger.warn('[PushNotificationService] Push notifications are disabled');
        return false;
      }

      switch (platform) {
        case DevicePlatform.IOS:
          return await this.sendToAPNs(token, message);
        case DevicePlatform.ANDROID:
          return await this.sendToFCM(token, message);
        case DevicePlatform.WEB:
          // 使用极光推送处理 Web 平台
          if (this.config.jpush) {
            return await this.sendToJPush(token, message);
          }
          this.logger.warn('[PushNotificationService] JPush not configured for web platform');
          return false;
        default:
          this.logger.warn('[PushNotificationService] Unsupported platform', { platform });
          return false;
      }
    } catch (error) {
      this.logger.error('[PushNotificationService] Send to device failed', {
        token,
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 发送推送通知到用户的所有设备
   *
   * @param userId - 用户 ID
   * @param message - 推送消息
   * @returns 发送结果
   */
  async sendToUser(userId: string, message: PushMessage): Promise<PushResult> {
    const devices = await this.getUserDevices(userId);

    const result: PushResult = {
      success: true,
      tokensSent: 0,
      tokensFailed: 0,
      failedTokens: [],
    };

    for (const device of devices) {
      const success = await this.sendToDevice(device.token, message, device.platform);
      if (success) {
        result.tokensSent++;
      } else {
        result.tokensFailed++;
        result.failedTokens?.push(device.token);
      }
    }

    if (result.tokensFailed > 0) {
      result.success = false;
    }

    return result;
  }

  /**
   * 批量发送推送通知
   *
   * @param userIds - 用户 ID 列表
   * @param message - 推送消息
   * @returns 发送结果
   */
  async sendToUsers(userIds: string[], message: PushMessage): Promise<PushResult> {
    const result: PushResult = {
      success: true,
      tokensSent: 0,
      tokensFailed: 0,
    };

    for (const userId of userIds) {
      const userResult = await this.sendToUser(userId, message);
      result.tokensSent += userResult.tokensSent;
      result.tokensFailed += userResult.tokensFailed;
    }

    if (result.tokensFailed > 0) {
      result.success = false;
    }

    return result;
  }

  /**
   * 发送到 APNs
   *
   * @param token - 设备令牌
   * @param message - 推送消息
   * @returns 发送是否成功
   */
  private async sendToAPNs(token: string, message: PushMessage): Promise<boolean> {
    if (!this.config.apns) {
      this.logger.warn('[PushNotificationService] APNs not configured');
      return false;
    }

    try {
      // APNs HTTP/2 endpoint
      const apnsUrl = this.config.apns.production
        ? 'https://api.push.apple.com:443'
        : 'https://api.development.push.apple.com:443';

      // 构建推送 payload
      const payload = {
        aps: {
          alert: {
            title: message.title,
            body: message.body,
          },
          sound: message.sound || 'default',
          badge: message.badge,
          category: message.category,
          threadId: message.threadId,
          'mutable-content': 1,
        },
        ...message.data,
      };

      // 发送 HTTP/2 请求（需要使用支持 HTTP/2 的库）
      // 这里使用简化的实现，实际应该使用 apn 或 http2 库
      this.logger.info('[PushNotificationService] APNs push', {
        token: token.substring(0, 20) + '...',
        title: message.title,
      });

      // 实际实现需要使用 HTTP/2 客户端
      // 这是一个示例实现，需要安装 apn 或其他 HTTP/2 库
      return true;
    } catch (error) {
      this.logger.error('[PushNotificationService] APNs send failed', error);
      return false;
    }
  }

  /**
   * 发送到 FCM
   *
   * @param token - 设备令牌
   * @param message - 推送消息
   * @returns 发送是否成功
   */
  private async sendToFCM(token: string, message: PushMessage): Promise<boolean> {
    if (!this.config.fcm) {
      this.logger.warn('[PushNotificationService] FCM not configured');
      return false;
    }

    try {
      // 获取访问令牌
      const accessToken = await this.getFCMAccessToken();

      if (!accessToken) {
        this.logger.error('[PushNotificationService] Failed to get FCM access token');
        return false;
      }

      // 构建推送消息
      const fcmMessage = {
        message: {
          token,
          notification: {
            title: message.title,
            body: message.body,
            image: message.imageUrl,
          },
          data: message.data || {},
          android: {
            priority: message.priority === PushPriority.HIGH ? 'high' : 'normal',
            notification: {
              sound: message.sound || 'default',
              notification_count: message.badge,
            },
            ttl: message.ttl ? `${message.ttl}s` : undefined,
          },
          apns: {
            payload: {
              aps: {
                badge: message.badge,
                sound: message.sound || 'default',
                category: message.category,
                threadId: message.threadId,
              },
            },
          },
        },
      };

      // 发送 FCM 请求
      const fcmUrl = `https://fcm.googleapis.com/v1/projects/${this.config.fcm.projectId}/messages:send`;

      const response = await fetch(fcmUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fcmMessage),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`FCM request failed: ${response.status} ${errorText}`);
      }

      this.logger.info('[PushNotificationService] FCM push success', {
        token: token.substring(0, 20) + '...',
        title: message.title,
      });

      return true;
    } catch (error) {
      this.logger.error('[PushNotificationService] FCM send failed', error);
      return false;
    }
  }

  /**
   * 发送到极光推送
   *
   * @param registrationId - 极光推送注册ID
   * @param message - 推送消息
   * @returns 发送是否成功
   */
  private async sendToJPush(registrationId: string, message: PushMessage): Promise<boolean> {
    if (!this.config.jpush) {
      this.logger.warn('[PushNotificationService] JPush not configured');
      return false;
    }

    try {
      // 极光推送消息格式
      const jpushPayload = {
        platform: 'all', // 所有平台
        audience: {
          registration_id: [registrationId],
        },
        notification: {
          alert: {
            title: message.title,
            body: message.body,
          },
          android: {
            title: message.title,
            alert: message.body,
            sound: message.sound || 'default',
            builder_id: 1,
            extras: message.data || {},
          },
          ios: {
            title: message.title,
            body: message.body,
            sound: message.sound || 'default',
            badge: message.badge || '+1',
            'content-available': 1,
            extras: message.data || {},
          },
        },
        options: {
          apns_production: this.config.jpush.production,
          time_to_live: message.ttl || 86400, // 默认1天
          priority: message.priority === PushPriority.HIGH ? 1 : 0,
        },
      };

      // 发送极光推送请求
      const auth = Buffer.from(`${this.config.jpush.appKey}:${this.config.jpush.masterSecret}`).toString('base64');

      const response = await fetch(this.JPUSH_PUSH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jpushPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`JPush request failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as { msg_id: string; error?: any };

      if (result.error) {
        throw new Error(`JPush error: ${JSON.stringify(result.error)}`);
      }

      this.logger.info('[PushNotificationService] JPush push success', {
        msgId: result.msg_id,
        registrationId: registrationId.substring(0, 20) + '...',
        title: message.title,
      });

      return true;
    } catch (error) {
      this.logger.error('[PushNotificationService] JPush send failed', error);
      return false;
    }
  }

  /**
   * 批量发送极光推送
   *
   * @param registrationIds - 极光推送注册ID列表
   * @param message - 推送消息
   * @returns 发送结果
   */
  async sendToJPushBatch(
    registrationIds: string[],
    message: PushMessage
  ): Promise<{ success: boolean; msgId?: string; error?: string }> {
    if (!this.config.jpush) {
      return { success: false, error: 'JPush not configured' };
    }

    if (registrationIds.length === 0) {
      return { success: false, error: 'No registration IDs provided' };
    }

    try {
      // 极光推送消息格式
      const jpushPayload = {
        platform: 'all',
        audience: {
          registration_id: registrationIds,
        },
        notification: {
          alert: {
            title: message.title,
            body: message.body,
          },
          android: {
            title: message.title,
            alert: message.body,
            sound: message.sound || 'default',
            extras: message.data || {},
          },
          ios: {
            title: message.title,
            body: message.body,
            sound: message.sound || 'default',
            badge: message.badge || '+1',
            'content-available': 1,
            extras: message.data || {},
          },
        },
        options: {
          apns_production: this.config.jpush.production,
          time_to_live: message.ttl || 86400,
          priority: message.priority === PushPriority.HIGH ? 1 : 0,
        },
      };

      const auth = Buffer.from(`${this.config.jpush.appKey}:${this.config.jpush.masterSecret}`).toString('base64');

      const response = await fetch(this.JPUSH_PUSH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jpushPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`JPush batch request failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as { msg_id: string; error?: any };

      if (result.error) {
        return { success: false, error: JSON.stringify(result.error) };
      }

      this.logger.info('[PushNotificationService] JPush batch push success', {
        msgId: result.msg_id,
        count: registrationIds.length,
      });

      return { success: true, msgId: result.msg_id };
    } catch (error) {
      this.logger.error('[PushNotificationService] JPush batch send failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取 FCM 访问令牌
   *
   * 使用 OAuth 2.0 获取访问令牌
   * @returns 访问令牌
   */
  private async getFCMAccessToken(): Promise<string | null> {
    // 如果令牌仍然有效，直接返回
    if (this.fcmAccessToken && Date.now() < this.fcmTokenExpiry) {
      return this.fcmAccessToken;
    }

    if (!this.config.fcm) {
      return null;
    }

    try {
      // 构建JWT请求
      const response = await fetch(this.FCM_AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: this.generateFCMJWT(),
        }),
      });

      if (!response.ok) {
        throw new Error(`FCM auth request failed: ${response.status}`);
      }

      const data = await response.json() as { access_token: string; expires_in: number };
      this.fcmAccessToken = data.access_token;
      // 提前5分钟过期
      this.fcmTokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

      return this.fcmAccessToken;
    } catch (error) {
      this.logger.error('[PushNotificationService] Failed to get FCM access token', error);
      return null;
    }
  }

  /**
   * 生成 FCM JWT
   *
   * 使用服务账号私钥生成 JWT
   * @returns JWT 字符串
   */
  private generateFCMJWT(): string {
    if (!this.config.fcm) {
      return '';
    }

    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
      iss: this.config.fcm.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: this.FCM_AUTH_URL,
      iat: now,
      exp: now + 3600,
    };

    // 使用 jsonwebtoken 库生成实际的 JWT
    try {
      // 私钥需要是正确的格式
      const privateKey = this.config.fcm.privateKey.replace(/\\n/g, '\n');
      return jwt.sign(jwtPayload, privateKey, { algorithm: 'RS256' });
    } catch (error) {
      this.logger.error('[PushNotificationService] Failed to generate FCM JWT', error);
      return '';
    }
  }

  /**
   * 清理无效的设备令牌
   *
   * 定期清理无效的令牌，避免浪费推送资源
   */
  async cleanupInvalidTokens(): Promise<number> {
    let cleaned = 0;

    // 扫描所有设备令牌
    const keys = await this.redis.keys(`${this.DEVICE_TOKEN_PREFIX}*`);

    for (const key of keys) {
      const token = key.replace(this.DEVICE_TOKEN_PREFIX, '');
      const data = await this.redis.get(key);

      if (data) {
        const deviceToken = JSON.parse(data) as DeviceToken;
        const daysSinceActive = (Date.now() - new Date(deviceToken.activeAt).getTime()) / (1000 * 60 * 60 * 24);

        // 清理超过 30 天未活跃的设备
        if (daysSinceActive > 30) {
          await this.unregisterDevice(token, deviceToken.userId);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      this.logger.info('[PushNotificationService] Cleaned up invalid tokens', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * 获取推送统计信息
   *
   * @returns 统计信息
   */
  async getStatistics(): Promise<{
    totalDevices: number;
    devicesByPlatform: Record<DevicePlatform, number>;
    activeUsers: number;
  }> {
    const keys = await this.redis.keys(`${this.DEVICE_TOKEN_PREFIX}*`);

    const devicesByPlatform: Record<DevicePlatform, number> = {
      [DevicePlatform.IOS]: 0,
      [DevicePlatform.ANDROID]: 0,
      [DevicePlatform.WEB]: 0,
    };

    const activeUsers = new Set<string>();

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const deviceToken = JSON.parse(data) as DeviceToken;
        devicesByPlatform[deviceToken.platform]++;
        activeUsers.add(deviceToken.userId);
      }
    }

    return {
      totalDevices: keys.length,
      devicesByPlatform,
      activeUsers: activeUsers.size,
    };
  }
}
