/**
 * 公共工具类
 */

// 导出 Midway 配置（必须首先导出）
export { SharedUtilsConfiguration } from './configuration';

// ============ 环境变量解析 ============
export { EnvResolver, requireEnv, getEnv, getServiceUrl } from './config/env-resolver';

// ============ 通用类型定义 ============
export * from './types/common.types';

import { sign, verify } from 'crypto';
import { createHash, createHmac, randomBytes } from 'crypto';

// ============ ID生成器 ============
export class IdGenerator {
  /**
   * 生成UUID v4
   */
  static uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * 生成短ID（8位）
   */
  static shortId(): string {
    return randomBytes(4).toString('hex');
  }

  /**
   * 生成设备ID
   */
  static deviceId(prefix: string = 'DEV'): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(4).toString('hex');
    return `${prefix}-${timestamp}-${random}`;
  }
}

// ============ 密码工具 ============
export class PasswordUtil {
  /**
   * 生成密码哈希
   */
  static hash(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  /**
   * 验证密码
   */
  static verify(password: string, hash: string): boolean {
    return this.hash(password) === hash;
  }

  /**
   * 验证密码强度
   * 要求：8-20位，包含大小写字母、数字和特殊字符
   */
  static validate(password: string): boolean {
    // 长度检查
    if (password.length < 8 || password.length > 20) {
      return false;
    }
    // 必须包含大小写字母、数字和特殊字符
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

    return hasUpperCase && hasLowerCase && hasNumber && hasSpecial;
  }

  /**
   * 生成随机密码
   */
  static generate(length: number = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const random = randomBytes(length);
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars[random[i] % chars.length];
    }
    return password;
  }
}

// ============ 签名工具 ============
export class SignatureUtil {
  /**
   * 生成HMAC-SHA256签名
   */
  static sign(data: string, secret: string): string {
    return createHmac('sha256', secret).update(data).digest('hex');
  }

  /**
   * 验证签名
   */
  static verify(data: string, signature: string, secret: string): boolean {
    return this.sign(data, secret) === signature;
  }

  /**
   * 生成设备签名（用于设备认证）
   */
  static signDevice(deviceId: string, timestamp: number, secret: string): string {
    const data = `${deviceId}:${timestamp}`;
    return this.sign(data, secret);
  }
}

// ============ 时间工具 ============
export class DateUtil {
  /**
   * 格式化日期
   */
  static format(date: Date, format: string = 'YYYY-MM-DD HH:mm:ss'): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds);
  }

  /**
   * 获取相对时间描述
   */
  static relative(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) {
      return this.format(date);
    } else if (days > 0) {
      return `${days}天前`;
    } else if (hours > 0) {
      return `${hours}小时前`;
    } else if (minutes > 0) {
      return `${minutes}分钟前`;
    } else {
      return '刚刚';
    }
  }

  /**
   * 检查是否过期
   */
  static isExpired(date: Date, ttl: number): boolean {
    const now = Date.now();
    return now - date.getTime() > ttl;
  }
}

// ============ JSON工具 ============
export class JsonUtil {
  /**
   * 安全解析JSON
   */
  static parse<T = any>(json: string, defaultValue?: T): T | null {
    try {
      return JSON.parse(json);
    } catch {
      return defaultValue ?? null;
    }
  }

  /**
   * 安全序列化JSON
   */
  static stringify(obj: any, pretty: boolean = false): string {
    try {
      return pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
    } catch {
      return '{}';
    }
  }

  /**
   * 深拷贝对象
   */
  static deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }
}

// ============ SQL 安全工具 ============
export class SqlSafeUtil {
  /**
   * 转义 SQL LIKE 通配符，防止用户输入中的 %、_、\ 被当作通配符
   * 用于所有包含用户输入的 LIKE 查询
   */
  static escapeLikeWildcards(input: string): string {
    return input.replace(/[%_\\]/g, '\\$&');
  }

  /**
   * 生成安全的 LIKE 前缀匹配值（如 "prefix%"）
   */
  static likePrefix(input: string): string {
    return `${SqlSafeUtil.escapeLikeWildcards(input)}%`;
  }

  /**
   * 生成安全的 LIKE 后缀匹配值（如 "%suffix"）
   */
  static likeSuffix(input: string): string {
    return `%${SqlSafeUtil.escapeLikeWildcards(input)}`;
  }

  /**
   * 生成安全的 LIKE 包含匹配值（如 "%contains%"）
   */
  static likeContains(input: string): string {
    return `%${SqlSafeUtil.escapeLikeWildcards(input)}%`;
  }
}

// ============ 验证工具 ============
export class ValidationUtil {
  /**
   * 验证邮箱
   */
  static isEmail(email: string): boolean {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  }

  /**
   * 验证手机号（中国大陆）
   */
  static isPhone(phone: string): boolean {
    const regex = /^1[3-9]\d{9}$/;
    return regex.test(phone);
  }

  /**
   * 验证IP地址
   */
  static isIP(ip: string): boolean {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(ip)) {
      const parts = ip.split('.');
      return parts.every((part) => parseInt(part) >= 0 && parseInt(part) <= 255);
    }
    return false;
  }

  /**
   * 验证MAC地址
   */
  static isMAC(mac: string): boolean {
    const regex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    return regex.test(mac);
  }
}

// ============ 延迟工具 ============
export class DelayUtil {
  /**
   * 延迟执行
   */
  static async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 带超时的Promise
   */
  static async withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    errorMessage: string = 'Operation timeout'
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(errorMessage)), timeout);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutHandle!);
    }
  }
}

// ============ 重试工具 ============
export class RetryUtil {
  /**
   * 重试执行
   */
  static async retry<T>(
    fn: () => Promise<T>,
    options: {
      maxAttempts?: number;
      delay?: number;
      backoff?: boolean;
      onRetry?: (attempt: number, error: Error) => void;
    } = {}
  ): Promise<T> {
    const {
      maxAttempts = 3,
      delay: baseDelay = 1000,
      backoff = true,
      onRetry,
    } = options;

    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxAttempts) {
          const delayMs = backoff ? baseDelay * Math.pow(2, attempt - 1) : baseDelay;
          onRetry?.(attempt, lastError);
          await DelayUtil.sleep(delayMs);
        }
      }
    }

    throw lastError!;
  }
}

// ============ 字节工具 ============
export class ByteUtil {
  /**
   * 格式化字节大小
   */
  static format(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * 解析字节大小
   */
  static parse(size: string): number {
    const units: Record<string, number> = {
      B: 1,
      KB: 1024,
      MB: 1024 ** 2,
      GB: 1024 ** 3,
      TB: 1024 ** 4,
    };

    const match = size.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)$/i);
    if (!match) {
      throw new Error(`Invalid size format: ${size}`);
    }

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    return value * (units[unit] || 1);
  }
}

// ============ URL工具 ============
export class UrlUtil {
  /**
   * 构建带参数的URL
   */
  static build(baseUrl: string, params: Record<string, any>): string {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
    return url.toString();
  }

  /**
   * 解析URL参数
   */
  static parseParams(url: string): Record<string, string> {
    const urlObj = new URL(url);
    const params: Record<string, string> = {};
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }
}

// ============ 订阅器模块 ============
export { RedisConnectionPool, RedisConnectionConfig } from './subscriber/redis-connection-pool';
export {
  BaseSubscriber,
  SubscriptionConfig,
  MessageHandleResult,
  SubscriberMetadata,
} from './subscriber/base.subscriber';

// ============ 加密工具 ============
export * from './crypto.utils';

// ============ Redis频道常量 ============
export {
  DEVICE_TELEMETRY_CHANNEL,
  DEVICE_EVENT_CHANNEL,
  DEVICE_SERVICE_CHANNEL,
  CONTROL_SERVICE_CHANNEL,
  DeviceServiceMessageType,
  ControlServiceMessageType,
} from './constants/redis-channels';

// ============ MQTT工具 ============
export class MqttUtil {
  /**
   * 构建设备主题
   */
  static buildDeviceTopic(deviceId: string, suffix: string): string {
    return `devices/${deviceId}/${suffix}`;
  }

  /**
   * 解析设备ID从主题
   */
  static parseDeviceId(topic: string): string | null {
    const match = topic.match(/^devices\/([^/]+)\//);
    return match ? match[1] : null;
  }

  /**
   * 通配符订阅
   */
  static wildcard(deviceId?: string): string {
    return deviceId ? `devices/${deviceId}/#` : 'devices/#';
  }
}

// ============ 域中间件 ============
export {
  DomainContextMiddleware,
  RequireDomainAdmin,
  RequireSuperAdmin,
  RequireDomainMember,
} from './middleware/domain-context.middleware';

export {
  DomainPermission,
  DomainDataFilterMiddleware,
  DomainQuotaCheck,
} from './middleware/domain-permission.middleware';

// ============ 全局错误处理中间件 ============
export {
  GlobalErrorMiddleware,
} from './middleware/global-error.middleware';

// ============ 已验证的用户上下文中间件 ============
export {
  VerifiedUserContextMiddleware,
} from './middleware/verified-user-context.middleware';

// ============ 用户上下文签名工具 ============
export {
  UserContextSigner,
  UserContextData,
  VerifyResult,
} from './service/user-context-signer';

// ============ 缓存模块 ============
export * from './cache';

// ============ 服务间通信 ============
export { ServiceClient, ServiceClientConfig, ServiceResponse } from './service/service-client';

// ============ 设备Provider解析 ============
export { DeviceProviderResolver } from './service/device-provider-resolver';

// ============ 通知服务 ============
export {
  NotificationService,
  NotificationPriority,
  NotificationChannel,
  NotificationType,
  NotificationMessage,
} from './service/notification.service';

// ============ 短信服务 ============
export {
  SMSProviderService,
  SMSProviderType,
  SMSProviderConfig,
  SendSMSOptions,
  SendSMSResult,
  AliyunSMSProviderConfig,
  TencentSMSProviderConfig,
} from './service/sms-provider.service';

// ============ 推送通知服务 ============
export {
  PushNotificationService,
  DevicePlatform,
  PushPriority,
  DeviceToken,
  PushMessage,
  PushResult,
} from './service/push-notification.service';

// ============ 统一错误处理 ============
export {
  ErrorCode,
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
  DeviceError,
  ErrorUtil,
  ErrorResponse,
  wrapAsync,
} from './errors';

// ============ 环境变量加载 ============
export { loadEnv } from './utils/env-loader';
