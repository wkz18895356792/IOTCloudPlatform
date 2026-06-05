import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';

/**
 * Token 黑名单服务
 *
 * 提供 Token 黑名单管理功能，用于在用户登出或 Token 刷新时主动失效 Token
 *
 * 主要功能：
 * - 将 Token 加入 Redis 黑名单
 * - 检查 Token 是否在黑名单中
 * - 批量将 Token 加入黑名单
 * - 清理过期的黑名单条目（通过 Redis TTL 自动处理）
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class TokenBlacklistService {
  @Inject()
  redis!: RedisService;

  @Inject()
  logger!: ILogger;

  /** Redis 黑名单键前缀 */
  private readonly BLACKLIST_PREFIX = 'token:blacklist:';
  /** Access Token 默认黑名单 TTL（秒）- 与 Access Token 有效期一致 */
  private readonly ACCESS_TOKEN_TTL = 7200; // 2小时
  /** Refresh Token 默认黑名单 TTL（秒）- 与 Refresh Token 有效期一致 */
  private readonly REFRESH_TOKEN_TTL = 604800; // 7天

  /**
   * 将 Token 加入黑名单
   *
   * @param token JWT Token
   * @param tokenType Token 类型 ('access' | 'refresh')
   * @param expiresIn 过期时间（秒），如果不指定则使用默认值
   * @param reason 加入黑名单的原因（可选）
   */
  async addToBlacklist(
    token: string,
    tokenType: 'access' | 'refresh' = 'access',
    expiresIn?: number,
    reason?: string
  ): Promise<void> {
    const key = this.getTokenKey(token);
    const ttl = expiresIn || (tokenType === 'access' ? this.ACCESS_TOKEN_TTL : this.REFRESH_TOKEN_TTL);

    const blacklistData = {
      blacklistedAt: Date.now(),
      reason: reason || 'logout',
      tokenType,
    };

    await this.redis.setex(key, ttl, JSON.stringify(blacklistData));
    this.logger.info(`[TokenBlacklist] Token added to blacklist: ${token.substring(0, 20)}... (${tokenType})`);
  }

  /**
   * 检查 Token 是否在黑名单中
   *
   * @param token JWT Token
   * @returns 如果 Token 在黑名单中返回 true，否则返回 false
   */
  async isBlacklisted(token: string): Promise<boolean> {
    const key = this.getTokenKey(token);
    const result = await this.redis.get(key);
    return result !== null;
  }

  /**
   * 批量将 Token 加入黑名单
   *
   * @param tokens Token 数组
   * @param tokenType Token 类型
   */
  async addToBlacklistBatch(
    tokens: string[],
    tokenType: 'access' | 'refresh' = 'access'
  ): Promise<void> {
    if (tokens.length === 0) {
      return;
    }

    const ttl = tokenType === 'access' ? this.ACCESS_TOKEN_TTL : this.REFRESH_TOKEN_TTL;
    const pipeline = this.redis.pipeline();

    for (const token of tokens) {
      const key = this.getTokenKey(token);
      const blacklistData = {
        blacklistedAt: Date.now(),
        reason: 'batch_blacklist',
        tokenType,
      };
      pipeline.setex(key, ttl, JSON.stringify(blacklistData));
    }

    await pipeline.exec();
    this.logger.info(`[TokenBlacklist] Batch added ${tokens.length} tokens to blacklist (${tokenType})`);
  }

  /**
   * 将用户的所有 Token 加入黑名单
   *
   * 用于强制用户重新登录的场景（如密码重置、账号封禁等）
   *
   * @param userId 用户ID
   * @param reason 加入黑名单的原因
   */
  async blacklistAllUserTokens(userId: string, reason: string = 'security'): Promise<void> {
    // 这里需要一个机制来跟踪用户的所有活跃 Token
    // 简化实现：使用一个用户级别的黑名单标记
    const key = `token:blacklist:user:${userId}`;
    const ttl = this.REFRESH_TOKEN_TTL; // 使用最长的 TTL

    await this.redis.setex(key, ttl, JSON.stringify({
      blacklistedAt: Date.now(),
      reason,
      allTokens: true,
    }));

    this.logger.warn(`[TokenBlacklist] All tokens for user ${userId} have been blacklisted (${reason})`);
  }

  /**
   * 检查用户的所有 Token 是否被列入黑名单
   *
   * @param userId 用户ID
   * @returns 如果用户的所有 Token 被列入黑名单返回 true
   */
  async isUserBlacklisted(userId: string): Promise<boolean> {
    const key = `token:blacklist:user:${userId}`;
    return await this.redis.get(key) !== null;
  }

  /**
   * 获取 Token 黑名单信息
   *
   * @param token JWT Token
   * @returns 黑名单信息，如果 Token 不在黑名单中返回 null
   */
  async getBlacklistInfo(token: string): Promise<{
    blacklistedAt: number;
    reason: string;
    tokenType: string;
  } | null> {
    const key = this.getTokenKey(token);
    const result = await this.redis.get(key);

    if (!result) {
      return null;
    }

    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }

  /**
   * 从 Token 生成 Redis 键
   *
   * 使用 Token 的完整字符串的哈希作为 key 的一部分
   * 这样可以确保唯一性，避免不同 Token 之间的碰撞
   *
   * @param token JWT Token
   * @returns Redis 键
   * @private
   */
  private getTokenKey(token: string): string {
    // 使用完整 token 的哈希值作为键，避免 JWT header 碰撞
    // JWT header 通常相同（如 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9），
    // 所以不能只使用前 32 个字符
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return `${this.BLACKLIST_PREFIX}${hash}`;
  }

  /**
   * 清理 Token 黑名单
   *
   * 注意：通常不需要手动调用，Redis TTL 会自动清理过期数据
   *
   * @param token JWT Token
   */
  async removeFromBlacklist(token: string): Promise<void> {
    const key = this.getTokenKey(token);
    await this.redis.del(key);
    this.logger.info(`[TokenBlacklist] Token removed from blacklist: ${token.substring(0, 20)}...`);
  }

  /**
   * 获取黑名单统计信息
   *
   * @returns 黑名单统计数据
   */
  async getBlacklistStats(): Promise<{
    totalBlacklisted: number;
    accessTokenCount: number;
    refreshTokenCount: number;
    userBlacklistCount: number;
  }> {
    // 注意：SCAN 命令在大数据量下可能有性能问题
    // 生产环境建议使用专门的统计服务
    const accessTokens = await this.scanKeys(`${this.BLACKLIST_PREFIX}*`);
    const userBlacklists = await this.scanKeys(`token:blacklist:user:*`);

    // 简单统计（实际可能需要更精确的分类统计）
    return {
      totalBlacklisted: accessTokens.length + userBlacklists.length,
      accessTokenCount: accessTokens.length, // 简化统计，未区分 access/refresh
      refreshTokenCount: 0,
      userBlacklistCount: userBlacklists.length,
    };
  }

  /**
   * 扫描匹配模式的 Redis 键
   *
   * @param pattern 键模式
   * @returns 匹配的键列表
   * @private
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
      cursor = result[0];
      const batchKeys = result[1];
      if (Array.isArray(batchKeys)) {
        keys.push(...batchKeys);
      }
    } while (cursor !== '0');

    return keys;
  }
}
