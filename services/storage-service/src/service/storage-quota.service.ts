import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { StorageProviderType } from '@baby-monitor/shared-types';
import { CacheManager } from '@baby-monitor/shared-utils';

/**
 * 配额设置
 */
export interface QuotaSettings {
  userId?: string; // 用户ID，为空则表示全局配额
  provider: StorageProviderType;
  maxStorage: number; // 最大存储空间（字节）
  maxFiles: number; // 最大文件数
  maxFileSize: number; // 单个文件最大大小（字节）
  bandwidthLimit?: number; // 带宽限制（字节/秒）
}

/**
 * 存储使用情况
 */
export interface StorageUsage {
  userId?: string;
  provider: StorageProviderType;
  usedStorage: number;
  fileCount: number;
  lastUpdated: number;
}

/**
 * 存储统计
 */
export interface StorageStatistics {
  totalStorage: number;
  usedStorage: number;
  availableStorage: number;
  fileCount: number;
  uploadCount: number;
  downloadCount: number;
  totalBandwidth: number;
  averageFileSize: number;
}

/**
 * 存储趋势数据
 */
export interface StorageTrend {
  date: string;
  storage: number;
  files: number;
  uploads: number;
  downloads: number;
}

/**
 * 存储配额服务类
 * 负责管理用户和全局的存储配额、使用量统计和趋势分析
 * 支持按用户和按存储提供商设置不同的配额限制
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class StorageQuotaService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  // Redis键前缀配置
  private readonly QUOTA_PREFIX = 'storage:quota:';   // 配额数据前缀
  private readonly USAGE_PREFIX = 'storage:usage:';   // 使用量数据前缀
  private readonly STATS_PREFIX = 'storage:stats:';   // 统计数据前缀
  private readonly TREND_PREFIX = 'storage:trend:';   // 趋势数据前缀
  private readonly TTL = 86400; // 1天 - 默认数据过期时间

  /**
   * 设置存储配额
   * 可以为特定用户或全局设置配额限制
   * @param settings 配额设置对象
   */
  async setQuota(settings: QuotaSettings): Promise<void> {
    // 根据是否指定userId决定是用户配额还是全局配额
    const key = settings.userId
      ? `${this.QUOTA_PREFIX}user:${settings.userId}`    // 用户配额
      : `${this.QUOTA_PREFIX}global:${settings.provider}`; // 全局配额

    // 将配额设置存储到Redis
    await this.redis.set(key, JSON.stringify(settings));
    // 配额设置长期有效，30天后过期
    await this.redis.expire(key, this.TTL * 30); // 30天

    console.log(`[Storage Quota] Set quota for ${settings.userId || settings.provider}`);
  }

  /**
   * 获取配额
   */
  async getQuota(userId?: string, provider?: StorageProviderType): Promise<QuotaSettings | null> {
    // 优先获取用户配额
    if (userId) {
      const userKey = `${this.QUOTA_PREFIX}user:${userId}`;
      const data = await this.redis.get(userKey);
      if (data) {
        return JSON.parse(data);
      }
    }

    // 获取全局配额
    if (provider) {
      const globalKey = `${this.QUOTA_PREFIX}global:${provider}`;
      const data = await this.redis.get(globalKey);
      if (data) {
        return JSON.parse(data);
      }
    }

    return null;
  }

  /**
   * 检查是否允许上传文件
   * 验证存储空间、文件数量和单文件大小是否超出配额限制
   * @param userId 用户ID（undefined表示检查全局配额）
   * @param provider 存储提供商类型
   * @param fileSize 要上传的文件大小（字节）
   * @returns 检查结果，包含是否允许、拒绝原因、当前使用量和配额设置
   */
  async checkQuota(
    userId: string | undefined,
    provider: StorageProviderType,
    fileSize: number
  ): Promise<{
    allowed: boolean;
    reason?: string;
    usage?: StorageUsage;
    quota?: QuotaSettings;
  }> {
    // 获取配额设置和当前使用量
    const quota = await this.getQuota(userId, provider);
    const usage = await this.getUsage(userId, provider);

    // 如果没有设置配额限制，默认允许
    if (!quota) {
      return { allowed: true };
    }

    // 检查1: 存储空间是否超出限制
    if (quota.maxStorage > 0 && usage.usedStorage + fileSize > quota.maxStorage) {
      return {
        allowed: false,
        reason: 'storage_exceeded',
        usage,
        quota,
      };
    }

    // 检查2: 文件数量是否超出限制
    if (quota.maxFiles > 0 && usage.fileCount >= quota.maxFiles) {
      return {
        allowed: false,
        reason: 'file_count_exceeded',
        usage,
        quota,
      };
    }

    // 检查3: 单个文件大小是否超出限制
    if (quota.maxFileSize > 0 && fileSize > quota.maxFileSize) {
      return {
        allowed: false,
        reason: 'file_size_exceeded',
        usage,
        quota,
      };
    }

    // 所有检查通过
    return { allowed: true, usage, quota };
  }

  /**
   * 更新存储使用量
   * 在文件上传或删除时调用，用于实时跟踪存储使用情况
   * @param userId 用户ID（undefined表示更新全局使用量）
   * @param provider 存储提供商类型
   * @param deltaStorage 存储变化量（正数表示增加，负数表示减少）
   * @param deltaFiles 文件数量变化量
   */
  async updateUsage(
    userId: string | undefined,
    provider: StorageProviderType,
    deltaStorage: number,
    deltaFiles: number
  ): Promise<void> {
    // 构建使用量数据的Redis key
    const key = userId
      ? `${this.USAGE_PREFIX}user:${userId}:${provider}`
      : `${this.USAGE_PREFIX}global:${provider}`;

    // 获取当前使用量
    const usage = await this.getCurrentUsage(key);

    // 更新使用量统计
    usage.usedStorage += deltaStorage;
    usage.fileCount += deltaFiles;
    usage.lastUpdated = Date.now();

    // 保存更新后的使用量
    await this.redis.set(key, JSON.stringify(usage));
    await this.redis.expire(key, this.TTL);

    // 根据操作类型更新全局统计
    if (deltaStorage > 0) {
      // 上传操作：增加上传计数和总存储量
      await this.incrementStats(provider, 'uploadCount', 1);
      await this.incrementStats(provider, 'totalStorage', deltaStorage);
    } else {
      // 下载操作：增加下载计数
      await this.incrementStats(provider, 'downloadCount', 1);
    }
  }

  /**
   * 获取使用量
   */
  async getUsage(userId: string | undefined, provider: StorageProviderType): Promise<StorageUsage> {
    const key = userId
      ? `${this.USAGE_PREFIX}user:${userId}:${provider}`
      : `${this.USAGE_PREFIX}global:${provider}`;

    return await this.getCurrentUsage(key);
  }

  /**
   * 获取当前使用量
   */
  private async getCurrentUsage(key: string): Promise<StorageUsage> {
    const data = await this.redis.get(key);

    if (data) {
      return JSON.parse(data);
    }

    // 初始化使用量
    const usage: StorageUsage = {
      provider: StorageProviderType.MINIO, // 默认
      usedStorage: 0,
      fileCount: 0,
      lastUpdated: Date.now(),
    };

    await this.redis.set(key, JSON.stringify(usage));
    await this.redis.expire(key, this.TTL);

    return usage;
  }

  /**
   * 获取存储统计
   */
  async getStatistics(provider: StorageProviderType): Promise<StorageStatistics> {
    const key = `${this.STATS_PREFIX}${provider}`;
    const data = await this.redis.get(key);

    if (data) {
      return JSON.parse(data);
    }

    // 初始化统计
    const stats: StorageStatistics = {
      totalStorage: 0,
      usedStorage: 0,
      availableStorage: 0,
      fileCount: 0,
      uploadCount: 0,
      downloadCount: 0,
      totalBandwidth: 0,
      averageFileSize: 0,
    };

    await this.redis.set(key, JSON.stringify(stats));
    await this.redis.expire(key, this.TTL);

    return stats;
  }

  /**
   * 更新统计
   */
  async updateStatistics(
    provider: StorageProviderType,
    updates: Partial<StorageStatistics>
  ): Promise<void> {
    const key = `${this.STATS_PREFIX}${provider}`;
    const stats = await this.getStatistics(provider);

    const updatedStats = { ...stats, ...updates };
    await this.redis.set(key, JSON.stringify(updatedStats));
    await this.redis.expire(key, this.TTL);
  }

  /**
   * 增加统计计数
   */
  private async incrementStats(
    provider: StorageProviderType,
    field: keyof StorageStatistics,
    value: number
  ): Promise<void> {
    const stats = await this.getStatistics(provider);
    const currentValue = (stats[field] as number) || 0;
    const updates = { [field]: currentValue + value };

    await this.updateStatistics(provider, updates);
  }

  /**
   * 记录存储趋势
   */
  async recordTrend(
    provider: StorageProviderType,
    storage: number,
    files: number,
    uploads: number,
    downloads: number
  ): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const key = `${this.TREND_PREFIX}${provider}:${today}`;

    const trend: StorageTrend = {
      date: today,
      storage,
      files,
      uploads,
      downloads,
    };

    await this.redis.set(key, JSON.stringify(trend));
    await this.redis.expire(key, this.TTL * 365); // 保留1年

    this.logger.debug(`[Storage Quota] Recorded trend for ${provider} on ${today}`);
  }

  /**
   * 获取存储趋势
   */
  async getTrend(
    provider: StorageProviderType,
    days: number = 30
  ): Promise<StorageTrend[]> {
    const trends: StorageTrend[] = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const key = `${this.TREND_PREFIX}${provider}:${dateStr}`;
      const data = await this.redis.get(key);

      if (data) {
        trends.push(JSON.parse(data));
      } else {
        // 填充缺失的数据
        trends.push({
          date: dateStr,
          storage: 0,
          files: 0,
          uploads: 0,
          downloads: 0,
        });
      }
    }

    return trends.reverse();
  }

  /**
   * 获取用户存储概览
   */
  async getUserOverview(userId: string): Promise<{
    providers: Array<{
      provider: StorageProviderType;
      usage: StorageUsage;
      quota?: QuotaSettings;
      usagePercent?: number;
    }>;
    totalStorage: number;
    totalFiles: number;
  }> {
    const providers = [StorageProviderType.AWS_S3, StorageProviderType.TENCENT_COS, StorageProviderType.MINIO];
    const overview: {
      providers: Array<{
        provider: StorageProviderType;
        usage: StorageUsage;
        quota?: QuotaSettings;
        usagePercent?: number;
      }>;
      totalStorage: number;
      totalFiles: number;
    } = {
      providers: [],
      totalStorage: 0,
      totalFiles: 0,
    };

    for (const provider of providers) {
      const usage = await this.getUsage(userId, provider);
      const quota = await this.getQuota(userId, provider);

      let usagePercent: number | undefined;
      if (quota && quota.maxStorage > 0) {
        usagePercent = (usage.usedStorage / quota.maxStorage) * 100;
      }

      overview.providers.push({
        provider,
        usage,
        quota: quota || undefined,
        usagePercent,
      });

      overview.totalStorage += usage.usedStorage;
      overview.totalFiles += usage.fileCount;
    }

    return overview;
  }

  /**
   * 重置使用量
   */
  async resetUsage(userId: string | undefined, provider: StorageProviderType): Promise<void> {
    const key = userId
      ? `${this.USAGE_PREFIX}user:${userId}:${provider}`
      : `${this.USAGE_PREFIX}global:${provider}`;

    await this.redis.del(key);

    console.log(`[Storage Quota] Reset usage for ${userId || provider}`);
  }

  /**
   * 计算存储大小
   */
  formatBytes(bytes: number): string {
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
   * 清理旧趋势数据
   */
  async cleanupOldTrends(retentionDays: number = 365): Promise<number> {
    const keys = await this.cacheManager.keysByPattern(`${this.TREND_PREFIX}*`);
    const now = Date.now();
    let cleaned = 0;

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const trend: StorageTrend = JSON.parse(data);
        const trendDate = new Date(trend.date);
        const ageMs = now - trendDate.getTime();
        const ageDays = ageMs / (86400 * 1000);

        if (ageDays > retentionDays) {
          await this.redis.del(key);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[Storage Quota] Cleaned up ${cleaned} old trend records`);
    }

    return cleaned;
  }
}
