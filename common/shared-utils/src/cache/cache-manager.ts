/**
 * 统一缓存管理器
 *
 * 职责:
 * - 提供统一的缓存操作接口
 * - 自动处理序列化/反序列化
 * - 统一TTL管理
 * - 避免KEYS命令,使用SCAN
 * - 提供缓存穿透保护
 */
import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { JsonUtil } from '../index';
import { CacheTTL } from './cache.constants';

/**
 * 缓存操作结果
 */
export interface CacheResult<T> {
  hit: boolean;
  data?: T;
}

/**
 * 统一缓存管理器
 *
 * 提供类型安全的缓存操作，自动处理序列化和错误处理
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class CacheManager {
  @Inject()
  redis!: RedisService;

  @Inject()
  logger!: ILogger;

  /**
   * 获取缓存 (带自动反序列化)
   */
  async get<T>(key: string): Promise<CacheResult<T>> {
    try {
      const cached = await this.redis.get(key);
      if (cached) {
        const parsed = JsonUtil.parse<T>(cached);
        return {
          hit: true,
          data: parsed ?? undefined,
        };
      }
      return { hit: false };
    } catch (error) {
      this.logger.error(`[CacheManager] Get cache failed: ${key}`, error);
      return { hit: false };
    }
  }

  /**
   * 设置缓存 (带自动序列化)
   */
  async set(key: string, value: any, ttl?: number): Promise<boolean> {
    try {
      const serialized = JsonUtil.stringify(value);
      if (ttl) {
        await this.redis.setex(key, ttl, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
      return true;
    } catch (error) {
      this.logger.error(`[CacheManager] Set cache failed: ${key}`, error);
      return false;
    }
  }

  /**
   * 删除缓存
   */
  async del(key: string): Promise<boolean> {
    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      this.logger.error(`[CacheManager] Delete cache failed: ${key}`, error);
      return false;
    }
  }

  /**
   * 批量删除缓存 (使用 SCAN 避免阻塞)
   */
  async delByPattern(pattern: string): Promise<number> {
    let count = 0;
    try {
      let cursor = '0';
      do {
        const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        const keys: string[] = result[1];
        if (keys.length > 0) {
          count += keys.length;
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');

      this.logger.info(`[CacheManager] Deleted ${count} keys matching pattern: ${pattern}`);
      return count;
    } catch (error) {
      this.logger.error(`[CacheManager] Delete by pattern failed: ${pattern}`, error);
      return count;
    }
  }

  /**
   * 获取匹配模式的所有键 (使用 SCAN 避免阻塞)
   * 替代 KEYS 命令，避免在生产环境中阻塞 Redis
   *
   * @param pattern - 匹配模式 (如 "user:*", "device:online:*")
   * @param count - 每次SCAN返回的数量，默认100
   * @returns 匹配的键数组
   */
  async keysByPattern(pattern: string, count: number = 100): Promise<string[]> {
    const keys: string[] = [];
    try {
      let cursor = '0';
      do {
        const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', count);
        cursor = result[0];
        const matchedKeys: string[] = result[1];
        keys.push(...matchedKeys);
      } while (cursor !== '0');

      return keys;
    } catch (error) {
      this.logger.error(`[CacheManager] Keys by pattern failed: ${pattern}`, error);
      return keys;
    }
  }

  /**
   * 获取匹配模式的所有键值对 (使用 SCAN 避免阻塞)
   * 替代 KEYS + 批量GET 的组合操作
   *
   * @param pattern - 匹配模式
   * @returns 键值对数组
   */
  async getByPattern<T>(pattern: string): Promise<Array<{ key: string; value: T | null }>> {
    const keys = await this.keysByPattern(pattern);
    if (keys.length === 0) {
      return [];
    }

    try {
      const values = await this.redis.mget(...keys);
      return keys.map((key, index) => ({
        key,
        value: values[index] ? JsonUtil.parse<T>(values[index]!) : null,
      }));
    } catch (error) {
      this.logger.error(`[CacheManager] Get by pattern failed: ${pattern}`, error);
      return keys.map(key => ({ key, value: null }));
    }
  }

  /**
   * 检查缓存是否存在
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`[CacheManager] Check cache existence failed: ${key}`, error);
      return false;
    }
  }

  /**
   * 设置过期时间
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      await this.redis.expire(key, ttl);
      return true;
    } catch (error) {
      this.logger.error(`[CacheManager] Set expiry failed: ${key}`, error);
      return false;
    }
  }

  /**
   * 获取或设置缓存 (Cache-Aside 模式)
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached.hit && cached.data !== undefined) {
      return cached.data;
    }

    const data = await fetchFn();
    await this.set(key, data, ttl);
    return data;
  }

  /**
   * 原子性操作: 如果缓存不存在则设置
   */
  async setNX(key: string, value: any, ttl?: number): Promise<boolean> {
    try {
      const serialized = JsonUtil.stringify(value);
      const result = await this.redis.set(key, serialized, 'NX');
      if (result === 'OK' && ttl) {
        await this.redis.expire(key, ttl);
      }
      return result === 'OK';
    } catch (error) {
      this.logger.error(`[CacheManager] SetNX failed: ${key}`, error);
      return false;
    }
  }

  /**
   * 缓存穿透保护 (使用空值缓存)
   */
  async getWithNullProtection<T>(
    key: string,
    fetchFn: () => Promise<T | null>,
    ttl: number = CacheTTL.MEDIUM
  ): Promise<T | null> {
    const cached = await this.get<T | null>(key);
    if (cached.hit) {
      return cached.data ?? null;
    }

    const data = await fetchFn();
    if (data === null) {
      // 缓存空值,防止穿透
      await this.set(key, null, CacheTTL.SHORT);
    } else {
      await this.set(key, data, ttl);
    }

    return data;
  }

  /**
   * 批量获取缓存
   */
  async mget<T>(keys: string[]): Promise<Array<T | null>> {
    try {
      if (keys.length === 0) {
        return [];
      }
      const values = await this.redis.mget(...keys);
      return values.map(v => v ? JsonUtil.parse<T>(v) : null);
    } catch (error) {
      this.logger.error('[CacheManager] MGET failed', error);
      return keys.map(() => null);
    }
  }

  /**
   * 批量设置缓存
   */
  async mset(kvPairs: Record<string, any>, ttl?: number): Promise<boolean> {
    try {
      const pipeline = this.redis.pipeline();
      for (const [key, value] of Object.entries(kvPairs)) {
        const serialized = JsonUtil.stringify(value);
        if (ttl) {
          pipeline.setex(key, ttl, serialized);
        } else {
          pipeline.set(key, serialized);
        }
      }
      await pipeline.exec();
      return true;
    } catch (error) {
      this.logger.error('[CacheManager] MSET failed', error);
      return false;
    }
  }

  /**
   * 增加计数器
   */
  async incr(key: string, ttl?: number): Promise<number> {
    try {
      const result = await this.redis.incr(key);
      if (ttl && result === 1) {
        await this.redis.expire(key, ttl);
      }
      return result;
    } catch (error) {
      this.logger.error(`[CacheManager] INCR failed: ${key}`, error);
      return 0;
    }
  }

  /**
   * 减少计数器
   */
  async decr(key: string): Promise<number> {
    try {
      return await this.redis.decr(key);
    } catch (error) {
      this.logger.error(`[CacheManager] DECR failed: ${key}`, error);
      return 0;
    }
  }

  /**
   * 获取并设置 (原子操作)
   */
  async getSet(key: string, value: any): Promise<string | null> {
    try {
      const serialized = JsonUtil.stringify(value);
      return await this.redis.getset(key, serialized);
    } catch (error) {
      this.logger.error(`[CacheManager] GETSET failed: ${key}`, error);
      return null;
    }
  }

  /**
   * 获取缓存剩余TTL (秒)
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      this.logger.error(`[CacheManager] Get TTL failed: ${key}`, error);
      return -1;
    }
  }

  /**
   * 发布消息到频道
   */
  async publish(channel: string, message: any): Promise<number> {
    try {
      const serialized = JsonUtil.stringify(message);
      return await this.redis.publish(channel, serialized);
    } catch (error) {
      this.logger.error(`[CacheManager] Publish failed: ${channel}`, error);
      return 0;
    }
  }

  /**
   * 订阅频道
   */
  async subscribe(channel: string, handler: (message: any) => void): Promise<void> {
    try {
      const subscriber = await this.redis.subscribe(channel);
      (subscriber as any).on('message', (ch: string, message: string) => {
        if (ch === channel) {
          try {
            const data = JsonUtil.parse(message);
            handler(data);
          } catch (error) {
            this.logger.error(`[CacheManager] Parse message failed: ${channel}`, error);
          }
        }
      });
    } catch (error) {
      this.logger.error(`[CacheManager] Subscribe failed: ${channel}`, error);
    }
  }

  /**
   * 将值添加到列表
   */
  async lpush(key: string, ...values: any[]): Promise<number> {
    try {
      const serialized = values.map(v => JsonUtil.stringify(v));
      return await this.redis.lpush(key, ...serialized);
    } catch (error) {
      this.logger.error(`[CacheManager] LPUSH failed: ${key}`, error);
      return 0;
    }
  }

  /**
   * 从列表弹出值
   */
  async lpop(key: string): Promise<any> {
    try {
      const value = await this.redis.lpop(key);
      return value ? JsonUtil.parse(value) : null;
    } catch (error) {
      this.logger.error(`[CacheManager] LPOP failed: ${key}`, error);
      return null;
    }
  }

  /**
   * 获取列表长度
   */
  async llen(key: string): Promise<number> {
    try {
      return await this.redis.llen(key);
    } catch (error) {
      this.logger.error(`[CacheManager] LLEN failed: ${key}`, error);
      return 0;
    }
  }

  /**
   * 获取列表指定范围的元素
   */
  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    try {
      const values = await this.redis.lrange(key, start, stop);
      return values.map(v => JsonUtil.parse<T>(v)).filter(v => v !== null) as T[];
    } catch (error) {
      this.logger.error(`[CacheManager] LRANGE failed: ${key}`, error);
      return [];
    }
  }

  /**
   * 添加到有序集合
   */
  async zadd(key: string, score: number, member: any): Promise<number> {
    try {
      const serialized = JsonUtil.stringify(member);
      return await this.redis.zadd(key, score, serialized);
    } catch (error) {
      this.logger.error(`[CacheManager] ZADD failed: ${key}`, error);
      return 0;
    }
  }

  /**
   * 从有序集合移除
   */
  async zrem(key: string, ...members: any[]): Promise<number> {
    try {
      const serialized = members.map(m => JsonUtil.stringify(m));
      return await this.redis.zrem(key, ...serialized);
    } catch (error) {
      this.logger.error(`[CacheManager] ZREM failed: ${key}`, error);
      return 0;
    }
  }

  /**
   * 获取有序集合指定范围的元素
   */
  async zrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    try {
      const values = await this.redis.zrange(key, start, stop);
      return values.map(v => JsonUtil.parse<T>(v)).filter(v => v !== null) as T[];
    } catch (error) {
      this.logger.error(`[CacheManager] ZRANGE failed: ${key}`, error);
      return [];
    }
  }

  /**
   * 获取有序集合指定分数范围的元素
   */
  async zrangeByScore<T>(key: string, min: number, max: number): Promise<T[]> {
    try {
      const values = await this.redis.zrangebyscore(key, min, max);
      return values.map(v => JsonUtil.parse<T>(v)).filter(v => v !== null) as T[];
    } catch (error) {
      this.logger.error(`[CacheManager] ZRANGEBYSCORE failed: ${key}`, error);
      return [];
    }
  }

  /**
   * 清空所有缓存 (谨慎使用)
   */
  async flushAll(): Promise<boolean> {
    try {
      await this.redis.flushall();
      this.logger.warn('[CacheManager] Flushed all cache');
      return true;
    } catch (error) {
      this.logger.error('[CacheManager] Flush all failed', error);
      return false;
    }
  }

  /**
   * 清空当前数据库 (谨慎使用)
   */
  async flushDb(): Promise<boolean> {
    try {
      await this.redis.flushdb();
      this.logger.warn('[CacheManager] Flushed current database');
      return true;
    } catch (error) {
      this.logger.error('[CacheManager] Flush DB failed', error);
      return false;
    }
  }

  /**
   * 获取数据库信息
   */
  async info(section?: string): Promise<Record<string, any>> {
    try {
      const info = await this.redis.info(section || '');
      // 解析INFO命令的输出
      const result: Record<string, any> = {};
      const lines = info.split('\r\n');
      for (const line of lines) {
        if (line && !line.startsWith('#')) {
          const parts = line.split(':');
          if (parts.length === 2) {
            result[parts[0]] = parts[1];
          }
        }
      }
      return result;
    } catch (error) {
      this.logger.error('[CacheManager] Get info failed', error);
      return {};
    }
  }

  /**
   * 获取缓存大小 ( keys数量)
   */
  async dbSize(): Promise<number> {
    try {
      return await this.redis.dbsize();
    } catch (error) {
      this.logger.error('[CacheManager] Get DB size failed', error);
      return 0;
    }
  }

  /**
   * 设置哈希字段
   */
  async hset(key: string, field: string, value: any): Promise<boolean> {
    try {
      const serialized = JsonUtil.stringify(value);
      await this.redis.hset(key, field, serialized);
      return true;
    } catch (error) {
      this.logger.error(`[CacheManager] HSET failed: ${key}.${field}`, error);
      return false;
    }
  }

  /**
   * 获取哈希字段
   */
  async hget<T>(key: string, field: string): Promise<T | null> {
    try {
      const value = await this.redis.hget(key, field);
      return value ? JsonUtil.parse<T>(value) : null;
    } catch (error) {
      this.logger.error(`[CacheManager] HGET failed: ${key}.${field}`, error);
      return null;
    }
  }

  /**
   * 获取所有哈希字段
   */
  async hgetall<T>(key: string): Promise<Record<string, T>> {
    try {
      const hash = await this.redis.hgetall(key);
      const result: Record<string, T> = {};
      for (const [field, value] of Object.entries(hash)) {
        const parsed = JsonUtil.parse<T>(value);
        if (parsed !== null) {
          result[field] = parsed;
        }
      }
      return result;
    } catch (error) {
      this.logger.error(`[CacheManager] HGETALL failed: ${key}`, error);
      return {};
    }
  }

  /**
   * 删除哈希字段
   */
  async hdel(key: string, ...fields: string[]): Promise<number> {
    try {
      return await this.redis.hdel(key, ...fields);
    } catch (error) {
      this.logger.error(`[CacheManager] HDEL failed: ${key}`, error);
      return 0;
    }
  }

  /**
   * 检查哈希字段是否存在
   */
  async hexists(key: string, field: string): Promise<boolean> {
    try {
      const result = await this.redis.hexists(key, field);
      return result === 1;
    } catch (error) {
      this.logger.error(`[CacheManager] HEXISTS failed: ${key}.${field}`, error);
      return false;
    }
  }
}
