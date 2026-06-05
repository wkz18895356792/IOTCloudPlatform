import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { IdGenerator, CacheManager } from '@baby-monitor/shared-utils';

/**
 * 文件分享
 */
export interface FileShare {
  id: string;
  fileId: string;
  createdBy: string;
  name: string;
  description?: string;
  permission: 'view' | 'download' | 'upload';
  expiresAt: number;
  password?: string;
  maxAccess?: number;
  accessCount: number;
  createdAt: number;
}

/**
 * 分享访问记录
 */
export interface ShareAccess {
  shareId: string;
  accessedBy: string;
  accessedAt: number;
  ipAddress?: string;
}

/**
 * 文件分享服务类
 * 提供文件分享链接的创建、验证、访问控制等功能
 * 支持密码保护、访问次数限制和过期时间等安全特性
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class FileShareService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  // Redis键前缀配置
  private readonly SHARE_PREFIX = 'file:share:';         // 分享链接数据前缀
  private readonly ACCESS_PREFIX = 'file:share:access:'; // 访问记录前缀
  private readonly SHARE_SET = 'file:shares';            // 所有分享链接的集合

  // 分享链接的最大有效期（秒），30天
  private readonly SHARE_TTL = 86400 * 30; // 30天

  /**
   * 创建分享链接
   */
  async createShare(share: Omit<FileShare, 'id' | 'accessCount' | 'createdAt'>): Promise<string> {
    const shareId = IdGenerator.uuid();
    const now = Date.now();

    const newShare: FileShare = {
      ...share,
      id: shareId,
      accessCount: 0,
      createdAt: now,
    };

    const key = `${this.SHARE_PREFIX}${shareId}`;
    await this.redis.set(key, JSON.stringify(newShare));
    await this.redis.expireat(key, Math.floor(newShare.expiresAt / 1000));
    await this.redis.sadd(this.SHARE_SET, shareId);

    console.log(`[File Share] Created share ${shareId} for file ${share.fileId}`);
    return shareId;
  }

  /**
   * 获取分享
   */
  async getShare(shareId: string): Promise<FileShare | null> {
    const key = `${this.SHARE_PREFIX}${shareId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * 验证分享链接的访问权限
   * 检查链接是否存在、是否过期、密码是否正确、访问次数是否超限
   * @param shareId 分享链接ID
   * @param password 访问密码（如果分享设置了密码）
   * @returns 验证结果，包含是否有效、分享对象和拒绝原因
   */
  async validateAccess(shareId: string, password?: string): Promise<{
    valid: boolean;
    share?: FileShare;
    reason?: string;
  }> {
    // 从Redis获取分享链接信息
    const share = await this.getShare(shareId);

    // 检查分享链接是否存在
    if (!share) {
      return { valid: false, reason: 'Share not found' };
    }

    // 检查分享链接是否已过期
    if (Date.now() > share.expiresAt) {
      return { valid: false, reason: 'Share expired' };
    }

    // 验证访问密码（如果设置了密码）
    if (share.password && share.password !== password) {
      return { valid: false, reason: 'Invalid password' };
    }

    // 检查访问次数是否已达上限
    if (share.maxAccess && share.accessCount >= share.maxAccess) {
      return { valid: false, reason: 'Access limit exceeded' };
    }

    // 所有验证通过
    return { valid: true, share };
  }

  /**
   * 记录分享链接的访问
   * 增加访问计数并保存访问日志
   * @param shareId 分享链接ID
   * @param accessedBy 访问者标识（用户ID等）
   * @param ipAddress 访问者IP地址（可选）
   */
  async recordAccess(
    shareId: string,
    accessedBy: string,
    ipAddress?: string
  ): Promise<void> {
    // 更新分享链接的访问计数
    const share = await this.getShare(shareId);
    if (share) {
      share.accessCount++;
      const key = `${this.SHARE_PREFIX}${shareId}`;
      await this.redis.set(key, JSON.stringify(share));
      // 使用绝对过期时间而不是TTL，确保在分享过期时数据也过期
      await this.redis.expireat(key, Math.floor(share.expiresAt / 1000));
    }

    // 记录详细的访问日志
    const access: ShareAccess = {
      shareId,
      accessedBy,
      accessedAt: Date.now(),
      ipAddress,
    };

    // 存储访问日志，key包含时间戳以便按时间排序
    const accessKey = `${this.ACCESS_PREFIX}${shareId}:${Date.now()}`;
    await this.redis.set(accessKey, JSON.stringify(access));
    await this.redis.expire(accessKey, this.SHARE_TTL);

    this.logger.debug(`[File Share] Recorded access for share ${shareId}`);
  }

  /**
   * 撤销分享
   */
  async revokeShare(shareId: string): Promise<boolean> {
    const key = `${this.SHARE_PREFIX}${shareId}`;
    const result = await this.redis.del(key);
    await this.redis.srem(this.SHARE_SET, shareId);

    return result > 0;
  }

  /**
   * 获取用户的所有分享
   */
  async getUserShares(createdBy: string): Promise<FileShare[]> {
    const shareIds = await this.redis.smembers(this.SHARE_SET);
    const shares: FileShare[] = [];

    for (const shareId of shareIds) {
      const share = await this.getShare(shareId);
      if (share && share.createdBy === createdBy) {
        shares.push(share);
      }
    }

    return shares.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 更新分享
   */
  async updateShare(shareId: string, updates: Partial<FileShare>): Promise<boolean> {
    const share = await this.getShare(shareId);
    if (!share) {
      return false;
    }

    const updatedShare = { ...share, ...updates };
    const key = `${this.SHARE_PREFIX}${shareId}`;
    await this.redis.set(key, JSON.stringify(updatedShare));
    await this.redis.expireat(key, Math.floor(updatedShare.expiresAt / 1000));

    console.log(`[File Share] Updated share ${shareId}`);
    return true;
  }

  /**
   * 获取分享访问记录
   */
  async getShareAccess(shareId: string, limit: number = 100): Promise<ShareAccess[]> {
    const pattern = `${this.ACCESS_PREFIX}${shareId}:*`;
    const keys = await this.cacheManager.keysByPattern(pattern);

    keys.sort().reverse();
    const selectedKeys = keys.slice(0, limit);

    const accesses: ShareAccess[] = [];
    for (const key of selectedKeys) {
      const data = await this.redis.get(key);
      if (data) {
        accesses.push(JSON.parse(data));
      }
    }

    return accesses;
  }

  /**
   * 清理过期分享
   */
  async cleanupExpiredShares(): Promise<number> {
    const shareIds = await this.redis.smembers(this.SHARE_SET);
    const now = Date.now();
    let cleaned = 0;

    for (const shareId of shareIds) {
      const share = await this.getShare(shareId);
      if (share && now > share.expiresAt) {
        await this.revokeShare(shareId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[File Share] Cleaned up ${cleaned} expired shares`);
    }

    return cleaned;
  }
}
