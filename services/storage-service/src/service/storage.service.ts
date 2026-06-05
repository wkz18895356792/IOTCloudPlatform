import { Provide, Inject, Config, Init, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { Readable } from 'stream';
import { IStorageProvider } from '../provider/storage-provider.interface';
import { S3StorageProvider } from '../provider/s3.provider';
import { COSStorageProvider } from '../provider/cos.provider';
import { MinIOStorageProvider } from '../provider/minio.provider';
import { StorageProviderType, StorageClass } from '@baby-monitor/shared-types';
import { IdGenerator, DeviceProviderResolver, CacheManager } from '@baby-monitor/shared-utils';

/**
 * 文件元数据
 */
export interface FileMetadata {
  key: string;
  url: string;
  size: number;
  etag: string;
  contentType: string;
  provider: StorageProviderType;
  storageClass: StorageClass;
  uploadedAt: Date;
  userId?: string;
  customMetadata?: Record<string, any>;
}

/**
 * 存储统计
 */
export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  byProvider: Record<string, { files: number; size: number }>;
  byStorageClass: Record<StorageClass, { files: number; size: number }>;
}

/**
 * 智能存储策略
 */
export interface StorageStrategy {
  // 根据文件大小选择存储类型
  getStorageClassForSize(size: number): StorageClass;
  // 根据访问频率选择存储类型
  getStorageClassForAccessCount(accessCount: number): StorageClass;
  // 根据文件类型选择存储类型
  getStorageClassForFileType(contentType: string): StorageClass;
  // 根据文件年龄选择存储类型
  getStorageClassForAge(uploadedAt: Date): StorageClass;
}

/**
 * 存储服务类
 * 提供统一的文件存储接口，支持多种存储提供商（AWS S3、腾讯云COS、MinIO）
 * 实现了智能存储策略接口，可根据文件特性自动选择最优存储类型
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class StorageService implements StorageStrategy {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Config('storage')
  storageConfig!: any;

  @Config('aws')
  awsConfig!: any;

  @Config('tencent')
  tencentConfig!: any;

  @Config('minio')
  minioConfig!: any;

  @Inject()
  deviceProviderResolver!: DeviceProviderResolver;

  @Inject()
  cacheManager!: CacheManager;

  // 存储提供者映射表，管理所有已注册的存储提供者
  private providers: Map<StorageProviderType, IStorageProvider> = new Map();
  // 默认的存储提供者，当未指定provider时使用
  private defaultProvider!: IStorageProvider;
  // Redis缓存键前缀，用于存储文件元数据
  private readonly METADATA_PREFIX = 'storage:metadata:';
  // 元数据缓存过期时间（秒），1小时后自动失效
  private readonly METADATA_TTL = 3600; // 1小时

  /**
   * 初始化存储服务
   * 在服务启动时自动调用，负责初始化所有存储提供者并设置默认提供者
   */
  @Init()
  async initialize(): Promise<void> {
    console.log('[Storage Service] Initializing...');

    // 初始化AWS S3存储提供者（仅在有凭证时）
    if (this.awsConfig?.accessKeyId && this.awsConfig?.secretAccessKey) {
      try {
        const s3Provider = new S3StorageProvider();
        await s3Provider.initialize(this.awsConfig, this.redis, this.logger);
        this.providers.set(StorageProviderType.AWS_S3, s3Provider);
        console.log('[Storage Service] AWS S3 provider initialized');
      } catch (error: any) {
        console.warn(`[Storage Service] AWS S3 initialization failed: ${error.message}`);
      }
    }

    // 初始化腾讯云COS存储提供者（仅在有凭证时）
    if (this.tencentConfig?.secretId && this.tencentConfig?.secretKey) {
      try {
        const cosProvider = new COSStorageProvider();
        await cosProvider.initialize(this.tencentConfig, this.redis, this.logger);
        this.providers.set(StorageProviderType.TENCENT_COS, cosProvider);
        console.log('[Storage Service] Tencent COS provider initialized');
      } catch (error: any) {
        console.warn(`[Storage Service] Tencent COS initialization failed: ${error.message}`);
      }
    }

    // 初始化MinIO本地存储提供者（始终尝试，作为默认本地存储）
    try {
      const minioProvider = new MinIOStorageProvider();
      await minioProvider.initialize(this.minioConfig, this.redis, this.logger);
      this.providers.set(StorageProviderType.MINIO, minioProvider);
      console.log('[Storage Service] MinIO provider initialized');
    } catch (error: any) {
      console.warn(`[Storage Service] MinIO initialization failed: ${error.message}`);
    }

    // 从配置文件获取默认存储提供者类型，未配置则使用MinIO
    const defaultType = this.storageConfig?.defaultProvider || StorageProviderType.MINIO;
    this.defaultProvider = this.providers.get(defaultType)!;

    if (!this.defaultProvider) {
      console.warn(`[Storage Service] No storage provider available. Configured default: ${defaultType}. Storage operations will fail, but read-only queries will work.`);
    }

    console.log('[Storage Service] Initialized with providers:', Array.from(this.providers.keys()), ', default:', defaultType);
  }

  /**
   * 获取存储提供者实例
   * @param providerType 存储提供者类型（可选），未指定则返回默认提供者
   * @returns 存储提供者实例
   * @throws 当指定的提供者不存在时抛出错误
   */
  getProvider(providerType?: StorageProviderType): IStorageProvider {
    // 如果指定了提供者类型，从映射表中获取；否则使用默认提供者
    const provider = providerType
      ? this.providers.get(providerType)
      : this.defaultProvider;

    // 验证提供者是否存在
    if (!provider) {
      throw new Error(`Storage provider ${providerType || 'default'} not found`);
    }

    return provider;
  }

  /**
   * 根据 file key 自动解析存储 provider
   * 解析优先级：显式传入 > 缓存元数据 > key 约定 > 默认 provider
   */
  private async resolveProviderForKey(key: string, explicit?: StorageProviderType): Promise<StorageProviderType> {
    if (explicit) return explicit;

    // 1. 尝试从缓存元数据获取
    const cached = await this.cacheManager.get<{ provider?: string }>(`${this.METADATA_PREFIX}${key}`);
    if (cached.hit && cached.data?.provider) {
      return cached.data.provider as StorageProviderType;
    }

    // 2. 尝试从 key 中提取 deviceId（约定格式: devices/{deviceId}/...）
    const deviceMatch = key.match(/^devices\/([^/]+)\//);
    if (deviceMatch) {
      try {
        return await this.deviceProviderResolver.resolveStorageProvider(deviceMatch[1]) as StorageProviderType;
      } catch {
        // 设备未找到，降级到默认
      }
    }

    // 3. 使用默认 provider
    return (this.storageConfig?.defaultProvider as StorageProviderType) || StorageProviderType.MINIO;
  }

  /**
   * 设置默认提供者
   */
  setDefaultProvider(providerType: StorageProviderType): void {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Storage provider ${providerType} not found`);
    }
    this.defaultProvider = provider;
    console.log(`[Storage Service] Default provider set to: ${providerType}`);
  }

  /**
   * 上传文件到存储服务
   * @param key 文件在存储中的唯一标识符
   * @param stream 文件数据流或Buffer
   * @param options 上传选项
   * @param options.provider 指定存储提供者，未指定则使用默认提供者
   * @param options.storageClass 存储类型（热存储/冷存储/归档），未指定则智能选择
   * @param options.metadata 自定义元数据，可包含contentType等信息
   * @param options.userId 用户ID，用于配额管理和访问记录
   * @returns 上传结果，包含文件URL、大小、ETag和使用的提供者
   */
  async upload(
    key: string,
    stream: Readable | Buffer,
    options?: {
      provider?: StorageProviderType;
      deviceId?: string;
      storageClass?: StorageClass;
      metadata?: Record<string, any>;
      userId?: string;
    }
  ): Promise<{ url: string; size: number; etag: string; provider: string }> {
    // 从选项中解构出提供者类型、元数据和用户ID
    const { provider: providerType, metadata, userId, deviceId } = options || {};

    // 获取存储提供者：显式 provider > deviceId 解析 > key 自动解析
    let resolvedProvider: StorageProviderType;
    if (providerType) {
      resolvedProvider = providerType;
    } else if (deviceId) {
      resolvedProvider = await this.deviceProviderResolver.resolveStorageProvider(deviceId) as StorageProviderType;
    } else {
      resolvedProvider = await this.resolveProviderForKey(key);
    }
    const storageProvider = this.getProvider(resolvedProvider);

    // 智能选择存储类型：如果未指定，根据文件类型自动选择最优存储类型
    const contentType = metadata?.contentType || this.detectContentType(key);
    let storageClass = options?.storageClass || this.getStorageClassForFileType(contentType);

    // 对不支持存储类型分级的 Provider（如 MinIO），降级为 HOT
    if (storageClass !== StorageClass.HOT && !this.providerSupportsStorageClass(resolvedProvider)) {
      storageClass = StorageClass.HOT;
    }

    // 构建上传元数据，包含内容类型和存储类型
    const uploadMetadata = {
      ...metadata,
      contentType,
      storageClass,
    };

    // 如果传入的是Buffer，转换为可读流
    const { Readable } = require('stream');
    let uploadStream: Readable;
    if (Buffer.isBuffer(stream)) {
      uploadStream = Readable.from(stream);
    } else {
      uploadStream = stream;
    }

    // 调用存储提供者执行上传操作
    const result = await storageProvider.upload(key, uploadStream, uploadMetadata);

    // 缓存文件元数据到Redis，避免频繁查询存储服务
    await this.cacheFileMetadata(key, {
      key,
      url: result.url,
      size: result.size,
      etag: result.etag,
      contentType,
      provider: storageProvider.getType() as StorageProviderType,
      storageClass,
      uploadedAt: new Date(),
      userId,
      customMetadata: metadata,
    });

    console.log(`[Storage Service] File uploaded: ${key}, size: ${result.size}, provider: ${storageProvider.getType()}`);

    return {
      url: result.url,
      size: result.size,
      etag: result.etag,
      provider: storageProvider.getType(),
    };
  }

  /**
   * 下载文件
   */
  async download(key: string, provider?: StorageProviderType): Promise<Readable> {
    const storageProvider = this.getProvider(await this.resolveProviderForKey(key, provider));
    return storageProvider.download(key);
  }

  /**
   * 删除文件
   */
  async delete(key: string, provider?: StorageProviderType): Promise<void> {
    const storageProvider = this.getProvider(await this.resolveProviderForKey(key, provider));
    await storageProvider.delete(key);
    await this.clearFileMetadata(key);
    console.log(`[Storage Service] File deleted: ${key}`);
  }

  /**
   * 批量删除文件
   * @param keys 要删除的文件key数组
   * @param provider 存储提供者类型（可选）
   * @returns 成功删除的文件数量
   */
  async deleteMultiple(keys: string[], provider?: StorageProviderType): Promise<number> {
    // 如果文件列表为空，直接返回
    if (keys.length === 0) return 0;

    const storageProvider = this.getProvider(await this.resolveProviderForKey(keys[0], provider));
    // 调用存储提供者批量删除接口
    await storageProvider.deleteMultiple(keys);

    // 清除每个文件的缓存元数据
    for (const key of keys) {
      await this.clearFileMetadata(key);
    }

    console.log(`[Storage Service] Deleted ${keys.length} files`);
    return keys.length;
  }

  /**
   * 获取文件URL
   */
  async getUrl(key: string, expiresIn: number = 3600, provider?: StorageProviderType): Promise<string> {
    // 先从缓存获取
    const cached = await this.getCachedFileMetadata(key);
    if (cached && cached.url) {
      return cached.url;
    }

    const storageProvider = this.getProvider(await this.resolveProviderForKey(key, provider));
    return storageProvider.getUrl(key, expiresIn);
  }

  /**
   * 生成预签名上传URL
   */
  async getPresignedUploadUrl(
    key: string,
    options?: {
      expiresIn?: number;
      contentType?: string;
      provider?: StorageProviderType;
    }
  ): Promise<string> {
    const { expiresIn = 3600, contentType, provider: providerType } = options || {};
    const storageProvider = this.getProvider(await this.resolveProviderForKey(key, providerType));
    return storageProvider.getPresignedUploadUrl(key, expiresIn, contentType);
  }

  /**
   * 生成分片上传的预签名URL
   */
  async getPresignedPartUploadUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number = 3600,
    provider?: StorageProviderType,
  ): Promise<string> {
    const storageProvider = this.getProvider(await this.resolveProviderForKey(key, provider));
    if (storageProvider.getPresignedPartUploadUrl) {
      return storageProvider.getPresignedPartUploadUrl(key, uploadId, partNumber, expiresIn);
    }
    throw new Error('当前存储提供商不支持分片预签名URL');
  }

  /**
   * 检查文件是否存在
   */
  async exists(key: string, provider?: StorageProviderType): Promise<boolean> {
    // 先检查缓存
    const cached = await this.getCachedFileMetadata(key);
    if (cached) return true;

    const storageProvider = this.getProvider(await this.resolveProviderForKey(key, provider));
    return storageProvider.exists(key);
  }

  /**
   * 获取文件元数据
   */
  async getMetadata(key: string, provider?: StorageProviderType): Promise<FileMetadata | null> {
    // 先从缓存获取
    const cached = await this.getCachedFileMetadata(key);
    if (cached) {
      return cached;
    }

    const storageProvider = this.getProvider(await this.resolveProviderForKey(key, provider));
    const metadata = await storageProvider.getMetadata(key);

    return {
      key,
      url: await storageProvider.getUrl(key),
      size: metadata.size,
      etag: metadata.etag,
      contentType: metadata.contentType,
      provider: storageProvider.getType() as StorageProviderType,
      storageClass: metadata.storageClass,
      uploadedAt: metadata.lastModified,
    };
  }

  /**
   * 列出文件
   */
  async list(
    prefix: string,
    options?: {
      maxKeys?: number;
      provider?: StorageProviderType;
      userId?: string;
    }
  ): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
    const { maxKeys, provider: providerType } = options || {};
    const storageProvider = this.getProvider(await this.resolveProviderForKey(prefix, providerType));
    return storageProvider.list(prefix, maxKeys);
  }

  /**
   * 复制文件
   */
  async copy(sourceKey: string, destKey: string, provider?: StorageProviderType): Promise<void> {
    const storageProvider = this.getProvider(await this.resolveProviderForKey(sourceKey, provider));
    await storageProvider.copy(sourceKey, destKey);

    // 更新缓存
    await this.clearFileMetadata(sourceKey);
    await this.clearFileMetadata(destKey);

    console.log(`[Storage Service] File copied: ${sourceKey} -> ${destKey}`);
  }

  /**
   * 移动文件
   */
  async move(sourceKey: string, destKey: string, provider?: StorageProviderType): Promise<void> {
    const storageProvider = this.getProvider(await this.resolveProviderForKey(sourceKey, provider));
    await storageProvider.move(sourceKey, destKey);

    // 更新缓存
    await this.clearFileMetadata(sourceKey);
    await this.clearFileMetadata(destKey);

    console.log(`[Storage Service] File moved: ${sourceKey} -> ${destKey}`);
  }

  /**
   * 分片上传
   */
  async createMultipartUpload(
    key: string,
    options?: {
      provider?: StorageProviderType;
      metadata?: Record<string, any>;
    }
  ): Promise<{ uploadId: string; key: string }> {
    const { provider: providerType, metadata } = options || {};
    const storageProvider = this.getProvider(await this.resolveProviderForKey(key, providerType));
    return storageProvider.createMultipartUpload(key, metadata);
  }

  async uploadPart(
    uploadId: string,
    key: string,
    partNumber: number,
    stream: Readable,
    provider?: StorageProviderType
  ): Promise<{ partNumber: number; etag: string }> {
    const storageProvider = this.getProvider(await this.resolveProviderForKey(key, provider));
    return storageProvider.uploadPart(uploadId, key, partNumber, stream);
  }

  async completeMultipartUpload(
    uploadId: string,
    key: string,
    parts: Array<{ partNumber: number; etag: string }>,
    provider?: StorageProviderType
  ): Promise<{ url: string; size: number; etag: string }> {
    const storageProvider = this.getProvider(await this.resolveProviderForKey(key, provider));
    const result = await storageProvider.completeMultipartUpload(uploadId, key, parts);

    return {
      url: result.url,
      size: result.size,
      etag: result.etag,
    };
  }

  async abortMultipartUpload(
    uploadId: string,
    key: string,
    provider?: StorageProviderType
  ): Promise<void> {
    const storageProvider = this.getProvider(await this.resolveProviderForKey(key, provider));
    await storageProvider.abortMultipartUpload(uploadId, key);
  }

  /**
   * 获取提供者状态
   */
  async getProvidersStatus(): Promise<Array<{ type: string; healthy: boolean; stats?: any }>> {
    const statuses = [];

    for (const [type, provider] of this.providers) {
      const healthy = await provider.healthCheck();
      const status: any = { type, healthy };

      // 尝试获取bucket统计
      try {
        if ('getBucketStats' in provider) {
          status.stats = await (provider as any).getBucketStats();
        }
      } catch (error) {
        // 忽略错误
      }

      statuses.push(status);
    }

    return statuses;
  }

  /**
   * 获取存储统计
   */
  async getStorageStats(): Promise<StorageStats> {
    const stats: StorageStats = {
      totalFiles: 0,
      totalSize: 0,
      byProvider: {},
      byStorageClass: {} as Record<string, { files: number; size: number }>,
    };

    for (const [type, provider] of this.providers) {
      try {
        if ('getBucketStats' in provider) {
          const providerStats = await (provider as any).getBucketStats();
          stats.byProvider[type] = {
            files: providerStats.fileCount,
            size: providerStats.totalSize,
          };
          stats.totalFiles += providerStats.fileCount;
          stats.totalSize += providerStats.totalSize;
        }
      } catch (error) {
        console.warn(`[Storage Service] Failed to get stats for ${type}:`, error);
      }
    }

    return stats;
  }

  /**
   * 检测文件内容类型
   */
  private detectContentType(filename: string): string {
    const mime = require('mime-types');
    return mime.lookup(filename) || 'application/octet-stream';
  }

  /**
   * 缓存文件元数据
   */
  private async cacheFileMetadata(key: string, metadata: FileMetadata): Promise<void> {
    const cacheKey = `${this.METADATA_PREFIX}${key}`;
    await this.redis.setex(cacheKey, this.METADATA_TTL, JSON.stringify(metadata));
  }

  /**
   * 获取缓存的文件元数据
   */
  private async getCachedFileMetadata(key: string): Promise<FileMetadata | null> {
    const cacheKey = `${this.METADATA_PREFIX}${key}`;
    const data = await this.redis.get(cacheKey);
    return data ? JSON.parse(data) : null;
  }

  /**
   * 清除文件元数据缓存
   */
  private async clearFileMetadata(key: string): Promise<void> {
    const cacheKey = `${this.METADATA_PREFIX}${key}`;
    await this.redis.del(cacheKey);
  }

  // ==================== StorageStrategy 实现 ====================
  // 以下方法实现智能存储策略接口，根据文件特性自动选择最优存储类型

  /**
   * 根据文件大小选择存储类型
   * @param size 文件大小（字节）
   * @returns 推荐的存储类型
   */
  getStorageClassForSize(size: number): StorageClass {
    // 大文件（>100MB）使用归档存储，降低成本
    if (size > 100 * 1024 * 1024) {
      return StorageClass.COLD;
    }
    // 中等文件（>10MB）使用低频存储
    if (size > 10 * 1024 * 1024) {
      return StorageClass.COLD;
    }
    // 小文件使用热存储，保证快速访问
    return StorageClass.HOT;
  }

  /**
   * 根据访问频率选择存储类型
   */
  getStorageClassForAccessCount(accessCount: number): StorageClass {
    // 访问次数少的文件使用归档存储
    if (accessCount < 5) {
      return StorageClass.COLD;
    }
    // 访问次数中等的文件使用低频存储
    if (accessCount < 50) {
      return StorageClass.COLD;
    }
    return StorageClass.HOT;
  }

  /**
   * 根据文件类型选择存储类型
   */
  getStorageClassForFileType(contentType: string): StorageClass {
    // 视频文件使用归档存储
    if (contentType.startsWith('video/')) {
      return StorageClass.COLD;
    }
    // 图片文件根据大小决定
    if (contentType.startsWith('image/')) {
      return StorageClass.HOT;
    }
    // 文档文件使用低频存储
    if (contentType.includes('pdf') || contentType.includes('document')) {
      return StorageClass.COLD;
    }
    return StorageClass.HOT;
  }

  /**
   * 根据文件年龄选择存储类型
   */
  getStorageClassForAge(uploadedAt: Date): StorageClass {
    const age = Date.now() - uploadedAt.getTime();
    const days = age / (1000 * 60 * 60 * 24);

    // 超过90天的文件使用归档存储
    if (days > 90) {
      return StorageClass.COLD;
    }
    // 超过30天的文件使用低频存储
    if (days > 30) {
      return StorageClass.COLD;
    }
    return StorageClass.HOT;
  }

  /**
   * 跨提供者复制文件
   */
  async copyAcrossProviders(
    key: string,
    sourceProvider: StorageProviderType,
    targetProvider: StorageProviderType
  ): Promise<void> {
    console.log(`[Storage Service] Copying ${key} from ${sourceProvider} to ${targetProvider}`);

    // 从源提供者下载
    const source = this.getProvider(sourceProvider);
    const stream = await source.download(key);

    // 上传到目标提供者
    const target = this.getProvider(targetProvider);
    await target.upload(key, stream);

    console.log(`[Storage Service] File copied across providers: ${key}`);
  }

  /**
   * 带故障转移的上传功能
   * 当首选提供者不可用时，自动尝试其他已初始化的存储提供者
   */
  async uploadWithFallback(
    key: string,
    stream: Readable,
    options?: {
      preferredProvider?: StorageProviderType;
      metadata?: Record<string, any>;
    }
  ): Promise<{ url: string; size: number; etag: string; provider: string }> {
    const { preferredProvider, metadata } = options || {};

    // 构建尝试顺序：首选 → 其他已初始化的 provider
    const tryOrder: StorageProviderType[] = [];
    if (preferredProvider) tryOrder.push(preferredProvider);
    for (const type of this.providers.keys()) {
      if (type !== preferredProvider) tryOrder.push(type);
    }

    for (const providerType of tryOrder) {
      try {
        const provider = this.providers.get(providerType);
        if (!provider) continue;
        const healthy = await provider.healthCheck();
        if (healthy) {
          const result = await this.upload(key, stream, { provider: providerType, metadata });
          // 确保 Redis 缓存中的 provider 字段与实际上传位置一致
          await this.cacheFileMetadata(key, {
            key,
            url: result.url,
            size: result.size,
            etag: result.etag,
            contentType: metadata?.contentType || 'application/octet-stream',
            provider: providerType,
            storageClass: StorageClass.HOT,
            uploadedAt: new Date(),
          });
          return result;
        }
      } catch (error) {
        console.warn(`[Storage Service] Provider ${providerType} failed, trying next`);
      }
    }

    throw new Error('No healthy storage provider available');
  }

  // ==================== Provider 能力查询 ====================

  /**
   * 不支持存储类型分级的 Provider 列表
   * MinIO 不区分 STANDARD/STANDARD_IA/GLACIER
   */
  private static readonly NO_STORAGE_CLASS_PROVIDERS: StorageProviderType[] = [
    StorageProviderType.MINIO,
  ];

  /**
   * 检查指定 Provider 是否支持非 HOT 存储类型（COLD/ARCHIVE）
   */
  private providerSupportsStorageClass(providerType: StorageProviderType): boolean {
    return !StorageService.NO_STORAGE_CLASS_PROVIDERS.includes(providerType);
  }
}
