import {
  Provide,
  Inject,
  Init,
  Singleton,
} from '@midwayjs/core';
import { RedisService } from '@midwayjs/redis';
import {
  STSClient,
  AssumeRoleCommand,
  AssumeRoleCommandInput,
} from '@aws-sdk/client-sts';
import {
  AWSTemporaryCredentials,
  CredentialsConfig,
  CredentialsStatus,
  CredentialsRefreshEvent,
} from './types';

/**
 * AWS STS 临时凭证管理器
 *
 * 功能特性：
 * - 集中管理多个 AWS 服务的临时凭证
 * - Redis 缓存凭证，减少 STS API 调用
 * - 定时自动刷新，确保凭证持续有效
 * - 双缓冲机制，平滑切换凭证
 * - 支持凭证状态监控
 */
@Singleton()
export class AWSCredentialsManager {
  @Inject()
  private redis!: RedisService;

  private stsClient!: STSClient;
  private configs: Map<string, CredentialsConfig> = new Map();
  private refreshCallbacks: Array<(event: CredentialsRefreshEvent) => void> = [];

  /**
   * Redis 键前缀
   */
  private readonly KEY_PREFIX = 'sts:credentials:';

  /**
   * 默认 AWS 区域
   */
  private readonly DEFAULT_REGION = 'us-east-1';

  /**
   * 默认凭证有效期（1小时）
   */
  private readonly DEFAULT_DURATION = 3600;

  /**
   * 最小 TTL 阈值（秒），低于此值时触发提前刷新
   */
  private readonly MIN_TTL_THRESHOLD = 300;

  /**
   * 注册凭证配置
   * @param key 凭证唯一标识（如 'kvs', 's3'）
   * @param config 凭证配置
   */
  registerCredentials(key: string, config: CredentialsConfig): void {
    // 合并配置，设置默认值
    this.configs.set(key, {
      ...config,
      // 默认凭证有效期1小时
      durationSeconds: config.durationSeconds ?? this.DEFAULT_DURATION,
      // 默认刷新间隔为有效期的70%，提前刷新避免过期
      refreshInterval: config.refreshInterval ?? Math.floor(this.DEFAULT_DURATION * 0.7),
    });
  }

  /**
   * 批量注册凭证配置
   */
  registerAllCredentials(configs: Record<string, CredentialsConfig>): void {
    Object.entries(configs).forEach(([key, config]) => {
      this.registerCredentials(key, config);
    });
  }

  /**
   * 初始化凭证管理器
   */
  @Init()
  async initialize(): Promise<void> {
    // 获取AWS区域配置
    const region = process.env.AWS_REGION || this.DEFAULT_REGION;
    // 判断是否为中国区域，需要特殊配置endpoint
    const isChinaRegion = region.startsWith('cn-');

    // 构建STS客户端配置
    const stsConfig: ConstructorParameters<typeof STSClient>[0] = {
      region,
      // 最多重试3次
      maxAttempts: 3,
    };

    // AWS中国区需要使用特殊的endpoint
    if (isChinaRegion) {
      if (region === 'cn-north-1') {
        // 北京区域endpoint
        stsConfig.endpoint = 'https://sts.cn-north-1.amazonaws.com.cn';
      } else if (region === 'cn-northwest-1') {
        // 宁夏区域endpoint
        stsConfig.endpoint = 'https://sts.cn-northwest-1.amazonaws.com.cn';
      }
    }

    // 从环境变量获取长期凭证
    const credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    };

    // 如果配置了长期凭证，则使用它们
    if (credentials.accessKeyId && credentials.secretAccessKey) {
      stsConfig.credentials = credentials;
    }

    // 创建STS客户端实例
    this.stsClient = new STSClient(stsConfig);

    // 验证AWS长期凭证是否已配置
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.warn('[AWSCredentialsManager] AWS credentials not configured, temporary credentials will not work');
    }

    console.log(`[AWSCredentialsManager] Initialized with ${this.configs.size} credential config(s)`);
  }

  /**
   * 预热凭证（服务启动时调用）
   */
  async warmupCredentials(): Promise<void> {
    const keys = Array.from(this.configs.keys());
    await Promise.allSettled(
      keys.map(key => this.refreshCredentials(key))
    );
  }

  /**
   * 获取临时凭证
   * @param key 凭证标识
   * @returns AWS 临时凭证
   */
  async getCredentials(key: string): Promise<AWSTemporaryCredentials> {
    // 获取凭证配置
    const config = this.configs.get(key);
    if (!config) {
      throw new Error(`No credentials config found for: ${key}`);
    }

    const cacheKey = this.getCacheKey(key);

    // 尝试从Redis缓存获取凭证
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as AWSTemporaryCredentials;
      // JSON.parse 后 expiration 是字符串，需要转换为 Date 对象
      const credentials: AWSTemporaryCredentials = {
        ...parsed,
        expiration: new Date(parsed.expiration),
      };
      // 获取缓存剩余有效期
      const ttl = await this.redis.ttl(cacheKey);
      // 如果TTL大于阈值，直接返回缓存凭证
      if (ttl > this.MIN_TTL_THRESHOLD) {
        return credentials;
      }
      // 即将过期：异步刷新，但立即返回当前有效凭证（双缓冲机制）
      this.refreshCredentials(key).catch(err => {
        console.error(`[AWSCredentialsManager] Background refresh failed for ${key}:`, err);
      });
      return credentials;
    }

    // 缓存未命中或已过期，同步刷新凭证
    return await this.refreshCredentials(key);
  }

  /**
   * 获取凭证并转换为 AWS SDK v3 Credentials 对象
   */
  async getAWSCredentials(key: string): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration?: Date;
  }> {
    return await this.getCredentials(key);
  }

  /**
   * 刷新指定凭证
   * @param key 凭证标识
   * @returns 新的临时凭证
   */
  async refreshCredentials(key: string): Promise<AWSTemporaryCredentials> {
    // 获取凭证配置
    const config = this.configs.get(key);
    if (!config) {
      throw new Error(`No credentials config found for: ${key}`);
    }

    const startTime = Date.now();

    try {
      // 构建STS AssumeRole请求参数
      const params: AssumeRoleCommandInput = {
        RoleArn: config.roleArn,           // 要扮演的IAM角色ARN
        RoleSessionName: config.roleSessionName,  // 会话名称，用于审计
        DurationSeconds: config.durationSeconds,   // 临时凭证有效期
      };

      // 添加外部ID（跨账户访问时的安全验证）
      if (config.externalId) {
        params.ExternalId = config.externalId;
      }

      // 添加策略限制（进一步缩小临时凭证权限）
      if (config.policy) {
        params.Policy = config.policy;
      }

      // 调用STS AssumeRole获取临时凭证
      const command = new AssumeRoleCommand(params);
      const response = await this.stsClient.send(command);

      // 验证响应中是否包含凭证
      if (!response.Credentials) {
        throw new Error('STS response missing credentials');
      }

      // 提取临时凭证信息
      const credentials: AWSTemporaryCredentials = {
        accessKeyId: response.Credentials.AccessKeyId!,
        secretAccessKey: response.Credentials.SecretAccessKey!,
        sessionToken: response.Credentials.SessionToken!,
        expiration: response.Credentials.Expiration!,
      };

      // 将凭证缓存到Redis
      // TTL设置为刷新间隔的80%，确保缓存失效前会触发刷新
      const cacheKey = this.getCacheKey(key);
      const cacheTTL = Math.floor(config.refreshInterval * 0.8);
      await this.redis.setex(
        cacheKey,
        cacheTTL,
        JSON.stringify(credentials)
      );

      const elapsed = Date.now() - startTime;
      console.log('credentials', credentials);
      console.log(`[AWSCredentialsManager] Refreshed credentials for '${key}' in ${elapsed}ms, expires at ${credentials.expiration.toISOString()}`);

      // 触发刷新成功回调
      this.notifyRefresh({
        key,
        success: true,
        expiration: credentials.expiration,
        timestamp: new Date(),
      });

      return credentials;

    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[AWSCredentialsManager] Failed to refresh credentials for '${key}' after ${elapsed}ms:`, error);

      // 触发刷新失败回调
      this.notifyRefresh({
        key,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });

      throw error;
    }
  }

  /**
   * 批量刷新所有凭证
   */
  async refreshAllCredentials(): Promise<Map<string, AWSTemporaryCredentials>> {
    const results = new Map<string, AWSTemporaryCredentials>();
    const keys = Array.from(this.configs.keys());

    const settleResults = await Promise.allSettled(
      keys.map(async (key) => {
        const creds = await this.refreshCredentials(key);
        return { key, creds };
      })
    );

    settleResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.set(result.value.key, result.value.creds);
      } else {
        console.error(`[AWSCredentialsManager] Refresh failed for '${keys[index]}':`, result.reason);
      }
    });

    return results;
  }

  /**
   * 获取凭证状态
   */
  async getCredentialsStatus(key: string): Promise<CredentialsStatus> {
    const cacheKey = this.getCacheKey(key);
    const exists = await this.redis.exists(cacheKey);
    const ttl = await this.redis.ttl(cacheKey);

    return {
      key,
      cached: exists === 1,
      ttl: ttl >= 0 ? ttl : 0,
      expiring: ttl >= 0 && ttl < this.MIN_TTL_THRESHOLD,
    };
  }

  /**
   * 获取所有凭证状态
   */
  async getAllCredentialsStatus(): Promise<CredentialsStatus[]> {
    const keys = Array.from(this.configs.keys());
    return Promise.all(
      keys.map(key => this.getCredentialsStatus(key))
    );
  }

  /**
   * 检查凭证是否需要刷新
   */
  async needsRefresh(key: string): Promise<boolean> {
    const status = await this.getCredentialsStatus(key);
    return !status.cached || status.expiring;
  }

  /**
   * 清除凭证缓存
   */
  async clearCredentials(key: string): Promise<void> {
    const cacheKey = this.getCacheKey(key);
    await this.redis.del(cacheKey);
    console.log(`[AWSCredentialsManager] Cleared cache for '${key}'`);
  }

  /**
   * 清除所有凭证缓存
   */
  async clearAllCredentials(): Promise<void> {
    const keys = Array.from(this.configs.keys());
    await Promise.all(
      keys.map(key => this.clearCredentials(key))
    );
  }

  /**
   * 注册凭证刷新回调
   */
  onRefresh(callback: (event: CredentialsRefreshEvent) => void): void {
    this.refreshCallbacks.push(callback);
  }

  /**
   * 触发刷新回调
   */
  private notifyRefresh(event: CredentialsRefreshEvent): void {
    this.refreshCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error('[AWSCredentialsManager] Refresh callback error:', error);
      }
    });
  }

  /**
   * 获取 Redis 缓存键
   */
  private getCacheKey(key: string): string {
    return `${this.KEY_PREFIX}${key}`;
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      // 检查 Redis 连接
      await this.redis.ping();

      // 检查是否有凭证配置
      if (this.configs.size === 0) {
        return false;
      }

      // 检查至少一个凭证是否有效
      const statuses = await this.getAllCredentialsStatus();
      return statuses.some(s => s.cached);
    } catch {
      return false;
    }
  }
}
