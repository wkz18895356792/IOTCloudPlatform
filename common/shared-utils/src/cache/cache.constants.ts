/**
 * 缓存常量配置
 *
 * 统一管理所有缓存相关的常量配置，包括：
 * - 缓存键前缀
 * - 缓存TTL配置
 * - 缓存键生成器
 */

/**
 * 缓存键前缀常量
 * 统一管理所有缓存键的命名规范
 */
export const CacheKeyPrefix = {
  // 用户相关
  USER: 'user',
  USER_PROFILE: 'user:profile',
  USER_SESSION: 'user:session',
  USER_PERMISSION: 'user:permission',

  // 设备相关
  DEVICE: 'device',
  DEVICE_INFO: 'device:info',
  DEVICE_ONLINE: 'device:online',
  DEVICE_STATE: 'device:state',
  DEVICE_SHADOW: 'device:shadow',
  DEVICE_PROVIDER: 'device:provider',

  // 协议相关
  PROTOCOL_MAPPING: 'protocol:mapping',
  PROTOCOL_CACHE: 'protocol:cache',

  // 产品相关
  PRODUCT: 'product',
  PRODUCT_CONFIG: 'product:config',

  // 证书相关
  CA_CERT: 'ca:cert',
  DEVICE_CERT: 'device:cert',

  // 会话相关
  MQTT_SESSION: 'mqtt:session',
  MQTT_ACL: 'mqtt:acl',

  // 任务相关
  BATCH_TASK: 'batch:task',
  DEVICE_DISCOVERY: 'device:discovery',

  // Token相关
  TOKEN_BLACKLIST: 'token:blacklist',

  // 限流相关
  RATE_LIMIT: 'rate_limit',

  // 验证码相关
  VERIFICATION_CODE: 'verify:code',

  // 文件相关
  FILE_METADATA: 'file:meta',
  FILE_SHARE: 'file:share',

  // 通知相关
  NOTIFICATION: 'notification',
} as const;

/**
 * 缓存TTL常量 (单位: 秒)
 */
export const CacheTTL = {
  // 短期缓存 (5分钟)
  SHORT: 300,

  // 中期缓存 (1小时)
  MEDIUM: 3600,

  // 长期缓存 (24小时)
  LONG: 86400,

  // 特殊用途
  DEVICE_ONLINE: 300,        // 设备在线状态: 5分钟
  DEVICE_STATE: 3600,         // 设备状态: 1小时
  USER_SESSION: 7200,         // 用户会话: 2小时
  DEVICE_DISCOVERY: 120,      // 设备发现: 2分钟
  DEVICE_PROVIDER: 3600,      // 设备Provider映射: 1小时
  PRODUCT_CONFIG: 3600,       // 产品配置: 1小时
  PROTOCOL_MAPPING: 86400,    // 协议映射: 24小时
  BATCH_TASK: 86400,          // 批量任务: 24小时
  TOKEN_BLACKLIST: 86400,     // Token黑名单: 24小时
  VERIFICATION_CODE: 300,     // 验证码: 5分钟
  RATE_LIMIT: 60,             // 限流: 1分钟
  FILE_METADATA: 3600,        // 文件元数据: 1小时
  FILE_SHARE: 2592000,        // 文件分享: 30天
  NOTIFICATION: 2592000,      // 通知: 30天
} as const;

/**
 * 缓存键生成器
 * 提供统一的缓存键生成方法，确保命名规范统一
 */
export class CacheKeyBuilder {
  /**
   * 生成用户缓存键
   */
  static user(userId: string): string {
    return `${CacheKeyPrefix.USER}:${userId}`;
  }

  /**
   * 生成用户资料缓存键
   */
  static userProfile(userId: string): string {
    return `${CacheKeyPrefix.USER_PROFILE}:${userId}`;
  }

  /**
   * 生成用户会话缓存键
   */
  static userSession(userId: string): string {
    return `${CacheKeyPrefix.USER_SESSION}:${userId}`;
  }

  /**
   * 生成设备缓存键
   */
  static device(deviceId: string): string {
    return `${CacheKeyPrefix.DEVICE}:${deviceId}`;
  }

  /**
   * 生成设备在线状态缓存键
   */
  static deviceOnline(deviceId: string): string {
    return `${CacheKeyPrefix.DEVICE_ONLINE}:${deviceId}`;
  }

  /**
   * 生成设备状态缓存键
   */
  static deviceState(deviceId: string): string {
    return `${CacheKeyPrefix.DEVICE_STATE}:${deviceId}`;
  }

  /**
   * 生成设备Provider映射缓存键
   */
  static deviceProvider(deviceId: string): string {
    return `${CacheKeyPrefix.DEVICE_PROVIDER}:${deviceId}`;
  }

  /**
   * 生成协议映射缓存键
   */
  static protocolMapping(sourceProtocol: string, targetProtocol: string): string {
    return `${CacheKeyPrefix.PROTOCOL_MAPPING}:${sourceProtocol}:${targetProtocol}`;
  }

  /**
   * 生成产品配置缓存键
   */
  static productConfig(productId: string): string {
    return `${CacheKeyPrefix.PRODUCT_CONFIG}:${productId}`;
  }

  /**
   * 生成批量任务缓存键
   */
  static batchTask(taskId: string): string {
    return `${CacheKeyPrefix.BATCH_TASK}:${taskId}`;
  }

  /**
   * 生成Token黑名单缓存键
   */
  static tokenBlacklist(tokenHash: string): string {
    return `${CacheKeyPrefix.TOKEN_BLACKLIST}:${tokenHash}`;
  }

  /**
   * 生成限流缓存键
   */
  static rateLimit(identifier: string): string {
    return `${CacheKeyPrefix.RATE_LIMIT}:${identifier}`;
  }

  /**
   * 生成验证码缓存键
   */
  static verificationCode(target: string, type: string): string {
    return `${CacheKeyPrefix.VERIFICATION_CODE}:${type}:${target}`;
  }

  /**
   * 生成文件元数据缓存键
   */
  static fileMetadata(filePath: string): string {
    return `${CacheKeyPrefix.FILE_METADATA}:${filePath}`;
  }

  /**
   * 生成文件分享缓存键
   */
  static fileShare(shareCode: string): string {
    return `${CacheKeyPrefix.FILE_SHARE}:${shareCode}`;
  }

  /**
   * 生成通知缓存键
   */
  static notification(notificationId: string): string {
    return `${CacheKeyPrefix.NOTIFICATION}:${notificationId}`;
  }

  /**
   * 生成模式匹配键 (用于 SCAN 命令)
   */
  static pattern(prefix: string): string {
    return `${prefix}:*`;
  }

  /**
   * 生成设备发现缓存键
   */
  static deviceDiscovery(taskId: string): string {
    return `${CacheKeyPrefix.DEVICE_DISCOVERY}:${taskId}`;
  }

  /**
   * 生成MQTT会话缓存键
   */
  static mqttSession(clientId: string): string {
    return `${CacheKeyPrefix.MQTT_SESSION}:${clientId}`;
  }

  /**
   * 生成MQTT ACL缓存键
   */
  static mqttAcl(clientId: string): string {
    return `${CacheKeyPrefix.MQTT_ACL}:${clientId}`;
  }
}
