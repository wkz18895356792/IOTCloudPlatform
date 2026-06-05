import { Provide, Scope, ScopeEnum, Init, Destroy, Inject } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import Redis from 'ioredis';

/**
 * Redis 连接配置
 */
export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  /**
   * 订阅者连接的数据库编号（可选，默认与主连接相同）
   */
  subscriberDb?: number;
}

/**
 * Redis 连接池
 *
 * 提供统一的 Redis 连接管理，避免每个订阅器独立创建连接
 *
 * 特性：
 * - 单例模式，全局共享连接
 * - 分离订阅者和发布者连接（Redis 订阅模式下不能执行 publish 命令）
 * - 自动重连机制
 * - 连接状态监控
 * - 支持优雅关闭
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class RedisConnectionPool {
  @Inject()
  logger!: ILogger;

  /**
   * 订阅者客户端（仅用于订阅）
   */
  private subscriberClient?: Redis;

  /**
   * 发布者客户端（用于发布和普通操作）
   */
  private publisherClient?: Redis;

  /**
   * 连接配置
   */
  private config?: RedisConnectionConfig;

  /**
   * 是否已初始化
   */
  private initialized = false;

  /**
   * 订阅者数量统计
   */
  private subscriberCount = 0;

  /**
   * 是否正在关闭
   */
  private isClosing = false;

  /**
   * 初始化连接池
   */
  @Init()
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.config = this.loadConfig();
    await this.createConnections();
    this.initialized = true;
    console.log('[RedisConnectionPool] Connection pool initialized');
  }

  /**
   * 加载配置
   */
  private loadConfig(): RedisConnectionConfig {
    const password = process.env.REDIS_PASSWORD;
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      ...(password ? { password } : {}),
      db: parseInt(process.env.REDIS_DB || '0'),
    };
  }

  /**
   * 创建 Redis 连接
   */
  private async createConnections(): Promise<void> {
    if (!this.config) {
      throw new Error('[RedisConnectionPool] Config not loaded');
    }

    // 创建订阅者连接（专用连接，用于订阅消息）
    // Redis Pub/Sub 规则：订阅状态的连接不能执行其他命令
    this.subscriberClient = new Redis({
      host: this.config.host,
      port: this.config.port,
      password: this.config.password || undefined,
      // 支持使用不同的数据库
      db: this.config.subscriberDb ?? this.config.db,
      // 重试策略：指数退避，最多延迟2秒
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        this.logger.warn(`[RedisConnectionPool] Subscriber reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    // 创建发布者连接（用于发布消息和普通命令操作）
    this.publisherClient = new Redis({
      host: this.config.host,
      port: this.config.port,
      password: this.config.password || undefined,
      db: this.config.db,
      // 重试策略：指数退避，最多延迟2秒
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        this.logger.warn(`[RedisConnectionPool] Publisher reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    // 等待两个连接都就绪
    await Promise.all([
      this.waitForReady(this.subscriberClient, 'subscriber'),
      this.waitForReady(this.publisherClient, 'publisher'),
    ]);

    // 设置连接事件监听，用于监控连接状态
    this.setupEventListeners(this.subscriberClient, 'subscriber');
    this.setupEventListeners(this.publisherClient, 'publisher');

    console.log('[RedisConnectionPool] Redis connections established', {
      host: this.config.host,
      port: this.config.port,
      db: this.config.db,
    });
  }

  /**
   * 等待连接就绪
   */
  private async waitForReady(client: Redis, type: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`[RedisConnectionPool] ${type} connection timeout`));
      }, 10000);

      client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      client.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * 设置事件监听
   */
  private setupEventListeners(client: Redis, type: string): void {
    client.on('error', (err) => {
      this.logger.error(`[RedisConnectionPool] ${type} connection error:`, err);
    });

    client.on('close', () => {
      this.logger.warn(`[RedisConnectionPool] ${type} connection closed`);
    });

    client.on('reconnecting', () => {
      console.log(`[RedisConnectionPool] ${type} reconnecting...`);
    });

    client.on('connect', () => {
      console.log(`[RedisConnectionPool] ${type} connected`);
    });
  }

  /**
   * 获取订阅者客户端
   *
   * @throws 如果连接池未初始化
   */
  getSubscriber(): Redis {
    if (!this.subscriberClient) {
      throw new Error('[RedisConnectionPool] Subscriber client not initialized');
    }
    return this.subscriberClient;
  }

  /**
   * 获取发布者客户端
   *
   * @throws 如果连接池未初始化
   */
  getPublisher(): Redis {
    if (!this.publisherClient) {
      throw new Error('[RedisConnectionPool] Publisher client not initialized');
    }
    return this.publisherClient;
  }

  /**
   * 检查连接是否健康
   */
  async healthCheck(): Promise<boolean> {
    try {
      const [subscriberOk, publisherOk] = await Promise.all([
        this.subscriberClient?.ping().then(() => true).catch(() => false) ?? false,
        this.publisherClient?.ping().then(() => true).catch(() => false) ?? false,
      ]);
      return subscriberOk && publisherOk;
    } catch {
      return false;
    }
  }

  /**
   * 获取连接池状态
   */
  getStatus(): {
    initialized: boolean;
    subscriberConnected: boolean;
    publisherConnected: boolean;
    subscriberCount: number;
    isClosing: boolean;
  } {
    return {
      initialized: this.initialized,
      subscriberConnected: this.subscriberClient?.status === 'ready' || false,
      publisherConnected: this.publisherClient?.status === 'ready' || false,
      subscriberCount: this.subscriberCount,
      isClosing: this.isClosing,
    };
  }

  /**
   * 增加订阅者计数
   */
  incrementSubscriberCount(): void {
    this.subscriberCount++;
  }

  /**
   * 减少订阅者计数
   */
  decrementSubscriberCount(): void {
    if (this.subscriberCount > 0) {
      this.subscriberCount--;
    }
  }

  /**
   * 获取订阅者数量
   */
  getSubscriberCount(): number {
    return this.subscriberCount;
  }

  /**
   * 优雅关闭连接池
   */
  @Destroy()
  async destroy(): Promise<void> {
    // 防止重复关闭
    if (this.isClosing || !this.initialized) {
      return;
    }

    this.isClosing = true;
    console.log('[RedisConnectionPool] Closing connections...');

    try {
      // 先关闭订阅者连接
      // quit()：发送 QUIT 命令，等待服务器响应后关闭（优雅关闭）
      if (this.subscriberClient) {
        await this.subscriberClient.quit().catch((err) => {
          // 如果 quit() 失败，强制断开连接
          this.logger.warn('[RedisConnectionPool] Error closing subscriber:', err);
          this.subscriberClient?.disconnect();
        });
        this.subscriberClient = undefined;
      }

      // 再关闭发布者连接
      if (this.publisherClient) {
        await this.publisherClient.quit().catch((err) => {
          // 如果 quit() 失败，强制断开连接
          this.logger.warn('[RedisConnectionPool] Error closing publisher:', err);
          this.publisherClient?.disconnect();
        });
        this.publisherClient = undefined;
      }

      this.initialized = false;
      console.log('[RedisConnectionPool] Connections closed gracefully');
    } catch (error) {
      this.logger.error('[RedisConnectionPool] Error during shutdown:', error);
    }
  }

  /**
   * 强制断开所有连接（用于紧急关闭）
   */
  disconnect(): void {
    this.isClosing = true;
    this.subscriberClient?.disconnect();
    this.publisherClient?.disconnect();
    this.subscriberClient = undefined;
    this.publisherClient = undefined;
    this.initialized = false;
    this.logger.warn('[RedisConnectionPool] Connections force disconnected');
  }
}
