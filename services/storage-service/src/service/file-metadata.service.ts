import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { StorageProviderType, CacheManager } from '@baby-monitor/shared-utils';

/**
 * 文件元数据
 */
export interface FileMetadata {
  key: string;
  url: string;
  size: number;
  etag: string;
  contentType?: string;
  provider: StorageProviderType;
  storageClass?: string;
  uploadedAt: number;
  lastAccessedAt: number;
  accessCount: number;
  metadata?: Record<string, any>;
}

/**
 * 文件访问记录
 */
export interface FileAccessRecord {
  key: string;
  accessType: 'upload' | 'download' | 'view' | 'delete';
  accessedAt: number;
  accessedBy?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * 文件标签
 */
export interface FileTag {
  key: string;
  tag: string;
  value: string;
  createdAt: number;
}

/**
 * 文件元数据服务类
 * 负责管理文件的元数据、访问记录和标签
 * 使用Redis作为缓存存储，提高查询性能
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class FileMetadataService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  // Redis键前缀，用于不同类型的数据
  private readonly METADATA_PREFIX = 'file:metadata:';  // 文件元数据前缀
  private readonly ACCESS_PREFIX = 'file:access:';      // 访问记录前缀
  private readonly TAG_PREFIX = 'file:tag:';            // 文件标签前缀

  // 数据过期时间配置（秒）
  private readonly METADATA_TTL = 3600;    // 1小时 - 元数据缓存时间
  private readonly ACCESS_TTL = 86400 * 7; // 7天 - 访问记录保留时间
  private readonly TAG_TTL = 86400 * 30;   // 30天 - 标签保留时间

  /**
   * 缓存文件元数据
   */
  async cacheMetadata(key: string, metadata: FileMetadata): Promise<void> {
    const cacheKey = `${this.METADATA_PREFIX}${key}`;
    await this.redis.set(cacheKey, JSON.stringify(metadata));
    await this.redis.expire(cacheKey, this.METADATA_TTL);

    this.logger.debug(`[File Metadata] Cached metadata for ${key}`);
  }

  /**
   * 获取缓存的元数据
   */
  async getMetadata(key: string): Promise<FileMetadata | null> {
    const cacheKey = `${this.METADATA_PREFIX}${key}`;
    const data = await this.redis.get(cacheKey);

    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * 更新元数据
   */
  async updateMetadata(key: string, updates: Partial<FileMetadata>): Promise<void> {
    const metadata = await this.getMetadata(key);
    if (!metadata) {
      return;
    }

    const updatedMetadata = { ...metadata, ...updates };
    await this.cacheMetadata(key, updatedMetadata);
  }

  /**
   * 删除元数据
   */
  async deleteMetadata(key: string): Promise<void> {
    const cacheKey = `${this.METADATA_PREFIX}${key}`;
    await this.redis.del(cacheKey);
  }

  /**
   * 记录文件访问
   * 在Redis中存储每次文件访问的详细信息，并更新文件元数据的访问统计
   * @param key 文件key
   * @param accessType 访问类型（上传/下载/查看/删除）
   * @param accessedBy 访问者ID（可选）
   * @param ipAddress 访问者IP地址（可选）
   * @param userAgent 用户代理信息（可选）
   */
  async recordAccess(
    key: string,
    accessType: FileAccessRecord['accessType'],
    accessedBy?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    // 构建访问记录对象
    const record: FileAccessRecord = {
      key,
      accessType,
      accessedAt: Date.now(),
      accessedBy,
      ipAddress,
      userAgent,
    };

    // 将访问记录存储到Redis，key包含时间戳以便按时间排序
    const accessKey = `${this.ACCESS_PREFIX}${key}:${Date.now()}`;
    await this.redis.set(accessKey, JSON.stringify(record));
    await this.redis.expire(accessKey, this.ACCESS_TTL);

    // 更新文件元数据中的访问统计信息
    const metadata = await this.getMetadata(key);
    if (metadata) {
      metadata.lastAccessedAt = record.accessedAt;
      metadata.accessCount = (metadata.accessCount || 0) + 1;
      await this.cacheMetadata(key, metadata);
    }

    this.logger.debug(`[File Metadata] Recorded ${accessType} for ${key}`);
  }

  /**
   * 获取文件的访问记录
   * 按时间倒序返回访问历史，支持分页
   * @param key 文件key
   * @param limit 返回的记录数量限制，默认100条
   * @param offset 偏移量，用于分页，默认0
   * @returns 访问记录数组
   */
  async getAccessRecords(
    key: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<FileAccessRecord[]> {
    // 使用通配符模式查找该文件的所有访问记录
    const pattern = `${this.ACCESS_PREFIX}${key}:*`;
    const keys = await this.cacheManager.keysByPattern(pattern);

    // 按时间排序，最新的记录在前
    keys.sort().reverse();

    // 计算分页范围
    const start = offset;
    const end = Math.min(offset + limit - 1, keys.length - 1);
    const selectedKeys = keys.slice(start, end + 1);

    // 批量获取访问记录数据
    const records: FileAccessRecord[] = [];
    for (const cacheKey of selectedKeys) {
      const data = await this.redis.get(cacheKey);
      if (data) {
        records.push(JSON.parse(data));
      }
    }

    return records;
  }

  /**
   * 为文件添加标签
   * 标签可用于分类和搜索文件
   * @param key 文件key
   * @param tag 标签名称
   * @param value 标签值
   */
  async addTag(key: string, tag: string, value: string): Promise<void> {
    // 构建标签对象，包含创建时间戳
    const fileTag: FileTag = {
      key,
      tag,
      value,
      createdAt: Date.now(),
    };

    // 将标签存储到Redis
    const tagKey = `${this.TAG_PREFIX}${key}:${tag}`;
    await this.redis.set(tagKey, JSON.stringify(fileTag));
    await this.redis.expire(tagKey, this.TAG_TTL);

    // 将文件key添加到标签索引中，支持按标签反向搜索
    await this.redis.sadd(`tag:index:${tag}`, key);

    this.logger.debug(`[File Metadata] Added tag ${tag}=${value} to ${key}`);
  }

  /**
   * 获取文件标签
   */
  async getTags(key: string): Promise<Record<string, string>> {
    const pattern = `${this.TAG_PREFIX}${key}:*`;
    const keys = await this.cacheManager.keysByPattern(pattern);

    const tags: Record<string, string> = {};
    for (const cacheKey of keys) {
      const data = await this.redis.get(cacheKey);
      if (data) {
        const fileTag: FileTag = JSON.parse(data);
        tags[fileTag.tag] = fileTag.value;
      }
    }

    return tags;
  }

  /**
   * 删除文件标签
   */
  async removeTag(key: string, tag: string): Promise<void> {
    const tagKey = `${this.TAG_PREFIX}${key}:${tag}`;
    await this.redis.del(tagKey);
    await this.redis.srem(`tag:index:${tag}`, key);

    this.logger.debug(`[File Metadata] Removed tag ${tag} from ${key}`);
  }

  /**
   * 通过标签搜索文件
   */
  async searchByTag(tag: string, value?: string): Promise<string[]> {
    const keys = await this.redis.smembers(`tag:index:${tag}`);

    if (!value) {
      return keys;
    }

    // 过滤标签值
    const matchingKeys: string[] = [];
    for (const key of keys) {
      const tagKey = `${this.TAG_PREFIX}${key}:${tag}`;
      const data = await this.redis.get(tagKey);
      if (data) {
        const fileTag: FileTag = JSON.parse(data);
        if (fileTag.value === value) {
          matchingKeys.push(key);
        }
      }
    }

    return matchingKeys;
  }

  /**
   * 批量获取元数据
   */
  async batchGetMetadata(keys: string[]): Promise<FileMetadata[]> {
    const metadataList: FileMetadata[] = [];

    for (const key of keys) {
      const metadata = await this.getMetadata(key);
      if (metadata) {
        metadataList.push(metadata);
      }
    }

    return metadataList;
  }

  /**
   * 清理过期元数据
   */
  async cleanupExpiredMetadata(): Promise<number> {
    // Redis会自动清理过期的key
    // 这里可以添加额外的清理逻辑，比如清理未被访问的文件元数据
    return 0;
  }

  /**
   * 获取文件统计
   */
  async getFileStatistics(key: string): Promise<{
    uploadCount: number;
    downloadCount: number;
    viewCount: number;
    deleteCount: number;
    lastAccessedAt: number | null;
  }> {
    const records = await this.getAccessRecords(key, 1000);

    const stats = {
      uploadCount: 0,
      downloadCount: 0,
      viewCount: 0,
      deleteCount: 0,
      lastAccessedAt: null as number | null,
    };

    for (const record of records) {
      switch (record.accessType) {
        case 'upload':
          stats.uploadCount++;
          break;
        case 'download':
          stats.downloadCount++;
          break;
        case 'view':
          stats.viewCount++;
          break;
        case 'delete':
          stats.deleteCount++;
          break;
      }

      if (!stats.lastAccessedAt || record.accessedAt > stats.lastAccessedAt) {
        stats.lastAccessedAt = record.accessedAt;
      }
    }

    return stats;
  }
}
