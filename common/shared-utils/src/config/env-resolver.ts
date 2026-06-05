/**
 * 环境变量解析工具
 *
 * 统一处理不同环境下的环境变量配置
 * - Docker 环境：使用容器名称（redis, mysql, emqx）
 * - 本地开发环境：自动转换为 localhost
 * - 生产环境：要求明确配置
 *
 * 使用方式：
 * ```typescript
 * import { EnvResolver } from '@baby-monitor/shared-utils';
 *
 * // 必需配置（缺失时会抛出错误）
 * const redisHost = EnvResolver.require('REDIS_HOST');
 *
 * // 可选配置（带默认值）
 * const redisPort = EnvResolver.get('REDIS_PORT', '6379');
 *
 * // 数值转换
 * const timeout = EnvResolver.getNumber('TIMEOUT', 5000);
 *
 * // 布尔值转换
 * const debug = EnvResolver.getBoolean('DEBUG', false);
 * ```
 */

/**
 * 配置解析选项
 */
export interface ResolverOptions {
  /** 是否允许空值 */
  allowEmpty?: boolean;
  /** 是否在本地开发环境自动转换 Docker 主机名 */
  autoResolveLocalhost?: boolean;
  /** 默认值 */
  defaultValue?: string;
}

/**
 * 环境变量解析器
 */
export class EnvResolver {
  /** Docker 容器名称到 localhost 的映射 */
  private static readonly DOCKER_HOST_MAP: Record<string, string> = {
    redis: 'localhost',
    mysql: 'localhost',
    emqx: 'localhost',
    minio: 'localhost',
    'user-service': 'localhost',
    'device-service': 'localhost',
    'baby-service': 'localhost',
    'video-service': 'localhost',
    'storage-service': 'localhost',
    'admin-service': 'localhost',
    'device-gateway': 'localhost',
    'api-gateway': 'localhost',
  };

  /** 需要本地解析的端口映射 */
  private static readonly LOCAL_PORT_MAP: Record<string, number> = {
    'user-service': 6002,
    'device-service': 6003,
    'video-service': 6004,
    'storage-service': 6005,
    'baby-service': 6008,
    'admin-service': 6009,
    'device-gateway': 6010,
    'api-gateway': 6001,
  };

  /**
   * 检查是否为本地开发环境
   */
  private static isLocalDevelopment(): boolean {
    return process.env.NODE_ENV !== 'production';
  }

  /**
   * 解析主机名（自动处理本地开发环境）
   */
  private static resolveHostname(value: string): string {
    if (!this.isLocalDevelopment()) {
      return value;
    }

    // 如果是 Docker 容器名称，转换为 localhost
    if (this.DOCKER_HOST_MAP[value]) {
      return this.DOCKER_HOST_MAP[value];
    }

    return value;
  }

  /**
   * 获取必需的环境变量（缺失时抛出错误）
   */
  static require(key: string, options?: ResolverOptions): string {
    const value = process.env[key];

    if (value === undefined) {
      throw new Error(
        `Required environment variable "${key}" is not defined. ` +
        `Please set it in your .env file or environment.`
      );
    }

    if (value === '' && !options?.allowEmpty) {
      throw new Error(
        `Required environment variable "${key}" cannot be empty. ` +
        `Please provide a valid value.`
      );
    }

    return options?.autoResolveLocalhost !== false
      ? this.resolveHostname(value)
      : value;
  }

  /**
   * 获取可选的环境变量（支持默认值）
   */
  static get(key: string, defaultValue?: string): string | undefined {
    const value = process.env[key];

    if (value === undefined) {
      return defaultValue;
    }

    if (value === '') {
      return defaultValue;
    }

    return this.resolveHostname(value);
  }

  /**
   * 获取数值类型的环境变量
   */
  static getNumber(key: string, defaultValue: number = 0): number {
    const value = this.get(key);
    if (value === undefined) {
      return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      throw new Error(
        `Environment variable "${key}" must be a valid number. Got: "${value}"`
      );
    }
    return parsed;
  }

  /**
   * 获取布尔类型的环境变量
   */
  static getBoolean(key: string, defaultValue: boolean = false): boolean {
    const value = this.get(key);
    if (value === undefined) {
      return defaultValue;
    }
    return value === 'true' || value === '1' || value === 'yes';
  }

  /**
   * 获取浮点数类型的环境变量
   */
  static getFloat(key: string, defaultValue: number = 0): number {
    const value = this.get(key);
    if (value === undefined) {
      return defaultValue;
    }
    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
      throw new Error(
        `Environment variable "${key}" must be a valid number. Got: "${value}"`
      );
    }
    return parsed;
  }

  /**
   * 获取列表类型的环境变量（逗号分隔）
   */
  static getList(key: string, defaultValue: string[] = []): string[] {
    const value = this.get(key);
    if (value === undefined || value === '') {
      return defaultValue;
    }
    return value.split(',').map(v => v.trim()).filter(v => v.length > 0);
  }

  /**
   * 获取 URL 类型的环境变量
   */
  static getUrl(key: string, defaultValue?: string): URL {
    const value = this.get(key, defaultValue);
    if (!value) {
      throw new Error(`Required URL environment variable "${key}" is not defined.`);
    }
    try {
      return new URL(value);
    } catch (error) {
      throw new Error(
        `Environment variable "${key}" must be a valid URL. Got: "${value}"`
      );
    }
  }

  /**
   * 解析服务 URL
   * 从环境变量获取服务地址，支持本地开发环境的端口转换
   */
  static getServiceUrl(serviceName: string, defaultPort?: number): string {
    // 尝试从环境变量获取
    const envKey = `${serviceName.toUpperCase().replace('-', '_')}_URL`;
    const url = this.get(envKey);

    if (url) {
      return url;
    }

    // 本地开发环境：使用 localhost + 默认端口
    if (this.isLocalDevelopment() && defaultPort) {
      return `http://localhost:${defaultPort}`;
    }

    throw new Error(
      `Service URL for "${serviceName}" is not configured. ` +
      `Please set ${envKey} environment variable.`
    );
  }

  /**
   * 获取数据库配置
   */
  static getDatabaseConfig(service: string = 'default') {
    return {
      type: 'mysql',
      host: this.require(`${service.toUpperCase()}_MYSQL_HOST`.replace('DEFAULT_', 'MYSQL_')),
      port: this.getNumber(`${service.toUpperCase()}_MYSQL_PORT`.replace('DEFAULT_', 'MYSQL_'), 3306),
      username: this.require(`${service.toUpperCase()}_MYSQL_USER`.replace('DEFAULT_', 'MYSQL_')),
      password: this.require(`${service.toUpperCase()}_MYSQL_PASSWORD`.replace('DEFAULT_', 'MYSQL_')),
      database: this.require(`${service.toUpperCase()}_MYSQL_DATABASE`.replace('DEFAULT_', 'MYSQL_')),
    };
  }

  /**
   * 获取 Redis 配置
   */
  static getRedisConfig(service: string = 'default') {
    return {
      port: this.getNumber(`${service.toUpperCase()}_REDIS_PORT`.replace('DEFAULT_', 'REDIS_'), 6379),
      host: this.require(`${service.toUpperCase()}_REDIS_HOST`.replace('DEFAULT_', 'REDIS_')),
      password: this.get(`${service.toUpperCase()}_REDIS_PASSWORD`.replace('DEFAULT_', 'REDIS_'), ''),
      db: this.getNumber(`${service.toUpperCase()}_REDIS_DB`.replace('DEFAULT_', 'REDIS_'), 0),
    };
  }

  /**
   * 验证密钥长度（用于 JWT、Session 等敏感配置）
   */
  static validateSecretLength(key: string, minLength: number): string {
    const value = this.require(key);

    if (value.length < minLength) {
      throw new Error(
        `"${key}" must be at least ${minLength} characters long. ` +
        `Current length: ${value.length}. ` +
        `Please generate a secure secret using: openssl rand -base64 ${Math.ceil(minLength * 3 / 4)}`
      );
    }

    return value;
  }

  /**
   * 批量验证必需的环境变量
   */
  static validateRequired(keys: string[]): void {
    const missing: string[] = [];

    for (const key of keys) {
      const value = process.env[key];
      if (value === undefined || value === '') {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables:\n  - ${missing.join('\n  - ')}\n` +
        `Please check your .env file or environment configuration.`
      );
    }
  }

  /**
   * 获取所有配置（用于调试）
   */
  static debugInfo(): Record<string, string | undefined> {
    const keys = Object.keys(process.env)
      .filter(key => !key.includes('SECRET') && !key.includes('PASSWORD') && !key.includes('KEY'))
      .sort();

    const info: Record<string, string | undefined> = {};
    for (const key of keys) {
      info[key] = process.env[key];
    }
    return info;
  }
}

/**
 * 快捷方法：获取必需配置
 */
export function requireEnv(key: string, options?: ResolverOptions): string {
  return EnvResolver.require(key, options);
}

/**
 * 快捷方法：获取可选配置
 */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return EnvResolver.get(key, defaultValue);
}

/**
 * 快捷方法：获取服务 URL
 */
export function getServiceUrl(serviceName: string, defaultPort?: number): string {
  return EnvResolver.getServiceUrl(serviceName, defaultPort);
}
