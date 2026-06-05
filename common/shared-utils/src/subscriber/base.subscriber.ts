import { Provide, Scope, ScopeEnum, Init, Destroy, Inject } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisConnectionPool } from './redis-connection-pool';
import Redis from 'ioredis';

/**
 * 订阅配置
 */
export interface SubscriptionConfig {
  /**
   * 精确匹配的频道列表
   */
  channels: string[];

  /**
   * 模式匹配的频道列表（支持通配符 * 和 ?）
   */
  patterns?: string[];

  /**
   * 订阅 QoS（仅用于日志记录）
   */
  qos?: 0 | 1;
}

/**
 * 消息处理结果
 */
export type MessageHandleResult = void | Promise<void>;

/**
 * Redis Pub/Sub 订阅器基类
 *
 * 提供统一的订阅器基础设施，处理：
 * - Redis 连接管理（通过连接池）
 * - 频道订阅/取消订阅
 * - 消息分发
 * - 生命周期管理
 * - 错误处理
 *
 * 使用方式：
 * 1. 继承此类
 * 2. 实现 getSubscriptionConfig() 方法返回订阅配置
 * 3. 实现 handleMessage() 方法处理消息
 * 4. （可选）重写 handlePatternMessage() 处理模式匹配消息
 *
 * @example
 * ```typescript
 * @Provide()
 * @Scope(ScopeEnum.Singleton)
 * export class MySubscriber extends BaseSubscriber {
 *   getSubscriptionConfig(): SubscriptionConfig {
 *     return {
 *       channels: ['channel1', 'channel2'],
 *       patterns: ['news:*'],
 *     };
 *   }
 *
 *   handleMessage(channel: string, message: string): void {
 *     console.log(`Received from ${channel}: ${message}`);
 *   }
 * }
 * ```
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export abstract class BaseSubscriber {
  @Inject()
  protected logger!: ILogger;

  @Inject()
  protected pool!: RedisConnectionPool;

  /**
   * 订阅者客户端（从连接池获取）
   */
  protected subscriber?: Redis;

  /**
   * 发布者客户端（从连接池获取）
   */
  protected publisher?: Redis;

  /**
   * 是否已初始化
   */
  protected initialized = false;

  /**
   * 订阅配置缓存
   */
  private config?: SubscriptionConfig;

  /**
   * 消息处理器绑定
   */
  private messageHandler?: (channel: string, message: string | Buffer) => void;
  private pmessageHandler?: (pattern: string, channel: string, message: string | Buffer) => void;

  /**
   * 获取订阅配置（子类必须实现）
   */
  abstract getSubscriptionConfig(): SubscriptionConfig;

  /**
   * 处理接收到的消息（子类必须实现）
   *
   * @param channel 频道名称
   * @param message 消息内容（字符串）
   */
  abstract handleMessage(channel: string, message: string): MessageHandleResult;

  /**
   * 处理模式匹配的消息（可选实现）
   *
   * @param pattern 匹配的模式
   * @param channel 实际频道名称
   * @param message 消息内容
   */
  handlePatternMessage(pattern: string, channel: string, message: string): MessageHandleResult {
    // 默认行为：模式匹配消息也转发到普通消息处理器
    return this.handleMessage(channel, message);
  }

  /**
   * 初始化订阅器
   */
  @Init()
  async initialize(): Promise<void> {
    // 防止重复初始化
    if (this.initialized) {
      this.logger.warn(`[${this.constructor.name}] Already initialized, skipping`);
      return;
    }

    try {
      // 确保连接池已就绪（主动初始化连接池）
      const poolStatus = this.pool.getStatus();
      if (!poolStatus.initialized) {
        console.log(`[${this.constructor.name}] Initializing Redis connection pool...`);
        await this.pool.initialize();
      }

      // 从连接池获取订阅者和发布者连接
      // 订阅者连接：用于接收消息（专用连接，遵循Redis Pub/Sub规则）
      // 发布者连接：用于发送消息（可复用）
      this.subscriber = this.pool.getSubscriber();
      this.publisher = this.pool.getPublisher();

      // 获取子类提供的订阅配置
      this.config = this.getSubscriptionConfig();

      // 绑定消息处理器到当前实例（确保 this 上下文正确）
      this.messageHandler = this.onMessage.bind(this);
      this.pmessageHandler = this.onPMessage.bind(this);

      // 在订阅者连接上设置消息监听器
      this.subscriber.on('message', this.messageHandler);   // 精确频道匹配
      this.subscriber.on('pmessage', this.pmessageHandler); // 模式匹配

      // 执行频道订阅
      await this.subscribeToChannels();

      // 执行模式订阅
      await this.subscribeToPatterns();

      // 标记已初始化并增加订阅器计数
      this.initialized = true;
      this.pool.incrementSubscriberCount();

      console.log(`[${this.constructor.name}] Subscriber initialized`, {
        channels: this.config.channels,
        patterns: this.config.patterns || [],
      });

      // 通知子类初始化完成
      await this.onInitialized();
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] Failed to initialize:`, error);
      throw error;
    }
  }

  /**
   * 订阅精确频道
   */
  private async subscribeToChannels(): Promise<void> {
    if (!this.config || this.config.channels.length === 0) {
      return;
    }

    if (!this.subscriber) {
      throw new Error(`[${this.constructor.name}] Subscriber client not available`);
    }

    const channels = this.config.channels;
    await this.subscriber.subscribe(...channels);

    this.logger.debug(`[${this.constructor.name}] Subscribed to channels:`, channels);
  }

  /**
   * 订阅模式匹配频道
   */
  private async subscribeToPatterns(): Promise<void> {
    if (!this.config || !this.config.patterns || this.config.patterns.length === 0) {
      return;
    }

    if (!this.subscriber) {
      throw new Error(`[${this.constructor.name}] Subscriber client not available`);
    }

    const patterns = this.config.patterns;
    await this.subscriber.psubscribe(...patterns);

    this.logger.debug(`[${this.constructor.name}] Subscribed to patterns:`, patterns);
  }

  /**
   * 内部消息处理器（精确匹配）
   */
  private async onMessage(channel: string, message: string | Buffer): Promise<void> {
    try {
      const messageStr = message.toString();
      this.logger.debug(`[${this.constructor.name}] Received from ${channel}`, {
        message: messageStr.slice(0, 200),
      });

      await this.handleMessage(channel, messageStr);
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] Error handling message from ${channel}:`, error);
      await this.onMessageError(channel, message, error as Error);
    }
  }

  /**
   * 内部消息处理器（模式匹配）
   */
  private async onPMessage(pattern: string, channel: string, message: string | Buffer): Promise<void> {
    try {
      const messageStr = message.toString();
      this.logger.debug(`[${this.constructor.name}] Received pattern ${pattern} from ${channel}`, {
        message: messageStr.slice(0, 100),
      });

      await this.handlePatternMessage(pattern, channel, messageStr);
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] Error handling pattern message from ${channel}:`, error);
      await this.onMessageError(channel, message, error as Error);
    }
  }

  /**
   * 消息处理错误回调（子类可重写）
   *
   * @param channel 频道名称
   * @param message 原始消息
   * @param error 错误对象
   */
  async onMessageError(channel: string, message: string | Buffer, error: Error): Promise<void> {
    // 默认行为：仅记录日志
    this.logger.error(`[${this.constructor.name}] Message handler error for channel ${channel}:`, error);
  }

  /**
   * 初始化完成回调（子类可重写）
   */
  async onInitialized(): Promise<void> {
    // 默认空实现
  }

  /**
   * 销毁前回调（子类可重写）
   */
  async onDestroy(): Promise<void> {
    // 默认空实现
  }

  /**
   * 发布消息到指定频道
   *
   * @param channel 频道名称
   * @param message 消息内容
   */
  async publish(channel: string, message: string | object): Promise<void> {
    if (!this.publisher) {
      throw new Error(`[${this.constructor.name}] Publisher client not available`);
    }

    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    const subscriberCount = await this.publisher.publish(channel, messageStr);

    this.logger.debug(`[${this.constructor.name}] Published to ${channel} (subscribers: ${subscriberCount})`);
  }

  /**
   * 发布消息并等待响应（Request-Response 模式）
   *
   * @param requestChannel 请求频道
   * @param responseChannel 响应频道
   * @param message 请求消息
   * @param timeout 超时时间（毫秒）
   * @returns 响应消息
   */
  async request<T = any>(
    requestChannel: string,
    responseChannel: string,
    message: string | object,
    timeout = 5000
  ): Promise<T> {
    if (!this.publisher) {
      throw new Error(`[${this.constructor.name}] Publisher client not available`);
    }

    // 生成唯一关联ID，用于匹配请求和响应
    const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);

    return new Promise<T>((resolve, reject) => {
      // 设置超时定时器
      const timer = setTimeout(() => {
        this.publisher?.unsubscribe(responseChannel);
        reject(new Error(`[${this.constructor.name}] Request timeout`));
      }, timeout);

      // 创建临时订阅者来监听响应
      const redisOptions: any = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      };
      if (process.env.REDIS_PASSWORD) {
        redisOptions.password = process.env.REDIS_PASSWORD;
      }
      const responseSubscriber = new Redis(redisOptions);

      // 订阅响应频道
      responseSubscriber.subscribe(responseChannel);
      responseSubscriber.on('message', (channel, msg) => {
        if (channel === responseChannel) {
          clearTimeout(timer);
          responseSubscriber.disconnect();

          try {
            const response = JSON.parse(msg);
            // 验证关联ID匹配
            if (response.correlationId === correlationId) {
              resolve(response);
            }
          } catch (error) {
            reject(error);
          }
        }
      });

      // 发布请求消息（带上关联ID用于响应匹配）
      const requestWithId = JSON.stringify({
        correlationId,
        data: messageStr,
      });

      this.publisher?.publish(requestChannel, requestWithId);
    });
  }

  /**
   * 获取当前订阅的频道列表
   */
  getSubscribedChannels(): string[] {
    return this.config?.channels || [];
  }

  /**
   * 获取当前订阅的模式列表
   */
  getSubscribedPatterns(): string[] {
    return this.config?.patterns || [];
  }

  /**
   * 检查是否订阅了指定频道
   */
  isSubscribedTo(channel: string): boolean {
    if (!this.config) {
      return false;
    }

    // 精确匹配
    if (this.config.channels.includes(channel)) {
      return true;
    }

    // 模式匹配
    if (this.config.patterns) {
      for (const pattern of this.config.patterns) {
        if (this.matchPattern(pattern, channel)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 模式匹配
   */
  private matchPattern(pattern: string, channel: string): boolean {
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(channel);
  }

  /**
   * 销毁订阅器
   */
  @Destroy()
  async destroy(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      // 移除消息监听器，防止内存泄漏
      if (this.subscriber && this.messageHandler) {
        this.subscriber.off('message', this.messageHandler);
      }
      if (this.subscriber && this.pmessageHandler) {
        this.subscriber.off('pmessage', this.pmessageHandler);
      }

      // 通知子类执行清理逻辑
      await this.onDestroy();

      // 注意：这里不执行 unsubscribe 和关闭连接
      // 原因：
      // 1. 多个订阅器可能共享同一个连接
      // 2. 连接的生命周期由连接池统一管理
      // 3. 取消订阅会影响其他订阅器
      // 连接会在连接池关闭时统一清理

      // 减少订阅器计数，连接池据此判断是否可以关闭连接
      this.pool.decrementSubscriberCount();
      this.initialized = false;

      console.log(`[${this.constructor.name}] Subscriber destroyed`);
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] Error during destroy:`, error);
    }
  }

  /**
   * 获取订阅器状态
   */
  getStatus(): {
    initialized: boolean;
    channels: string[];
    patterns: string[];
  } {
    return {
      initialized: this.initialized,
      channels: this.config?.channels || [],
      patterns: this.config?.patterns || [],
    };
  }
}

/**
 * 订阅器元数据装饰器（可选）
 * 用于注册订阅器到管理器
 */
export function SubscriberMetadata(metadata: {
  name: string;
  description?: string;
  priority?: number;
}) {
  return function (target: new (...args: any[]) => BaseSubscriber) {
    target.prototype.__subscriberMetadata = metadata;
  };
}
