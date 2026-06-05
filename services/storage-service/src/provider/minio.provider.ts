import { Provide, Inject, Config, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { Readable } from 'stream';
import * as Minio from 'minio';
import * as mime from 'mime-types';
import { IStorageProvider, UploadResult, MultipartUpload, UploadPartResult } from './storage-provider.interface';
import { StorageClass, StorageProviderType } from '@baby-monitor/shared-types';
import { IdGenerator } from '@baby-monitor/shared-utils';

/**
 * MinIO 本地存储提供者
 * 实现IStorageProvider接口，提供与MinIO对象存储服务的交互能力
 * MinIO是兼容S3 API的开源对象存储，适合本地部署和私有云环境
 * 支持完整的S3功能，包括分片上传、生命周期管理、事件通知等
 */
@Provide()
export class MinIOStorageProvider implements IStorageProvider {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Config('minio')
  minioConfig!: any;

  private client!: Minio.Client;  // MinIO客户端实例
  private bucket!: string;        // MinIO存储桶名称
  private endPoint!: string;      // MinIO服务器地址
  private port!: number;          // MinIO服务器端口
  private useSSL!: boolean;       // 是否使用SSL/TLS加密

  // 缓存配置，用于减少MinIO API调用
  private metadataCache: Map<string, any> = new Map();
  private cacheTTL = 3600; // 1小时 - 缓存过期时间（秒）

  /**
   * 初始化MinIO存储提供者
   * @param config MinIO配置（由 StorageService 注入）
   * @param redisInstance Redis 服务实例
   * @param loggerInstance 日志实例
   */
  async initialize(config?: any, redisInstance?: any, loggerInstance?: any): Promise<void> {
    // 支持外部注入
    const minioConfig = config || this.minioConfig;
    if (redisInstance) this.redis = redisInstance;
    if (loggerInstance) this.logger = loggerInstance;

    // 从配置中获取MinIO连接参数，提供合理的默认值
    const {
      endpoint = 'localhost',                 // 服务器地址
      port = 9000,                            // API端口
      useSSL = false,                         // 是否启用HTTPS
      accessKey = 'minioadmin',               // 访问密钥
      secretKey = 'minioadmin',               // 密钥
      bucket = 'baby-monitor',                // 默认bucket名称
    } = minioConfig;

    // 保存配置到实例变量
    this.endPoint = endpoint;
    this.port = port;
    this.useSSL = useSSL;
    this.bucket = bucket;

    // 创建MinIO客户端实例
    this.client = new Minio.Client({
      endPoint: this.endPoint,
      port: this.port,
      useSSL: this.useSSL,
      accessKey: accessKey,
      secretKey: secretKey,
    });

    // 确保配置的bucket存在，不存在则自动创建
    await this.ensureBucketExists();

    console.log(`[MinIO] Storage provider initialized at ${this.useSSL ? 'https' : 'http'}://${this.endPoint}:${this.port}, bucket: ${this.bucket}`);
  }

  /**
   * 确保MinIO bucket存在
   * 如果bucket不存在则自动创建，并设置为公共读取权限
   * @private
   */
  private async ensureBucketExists(): Promise<void> {
    try {
      // 检查bucket是否已存在
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        // Bucket不存在，创建新bucket
        console.log(`[MinIO] Creating bucket: ${this.bucket}`);
        await this.client.makeBucket(this.bucket, 'us-east-1');
        console.log(`[MinIO] Bucket created: ${this.bucket}`);

        // 设置bucket策略为公共读取（仅用于开发环境，生产环境应根据需求配置）
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/*`],
            },
          ],
        };
        await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy));
      } else {
        console.log(`[MinIO] Bucket exists: ${this.bucket}`);
      }
    } catch (error: any) {
      console.error('[MinIO] Failed to ensure bucket exists:', error);
      throw error;
    }
  }

  getType(): string {
    return StorageProviderType.MINIO;
  }

  /**
   * 上传文件
   */
  async upload(key: string, stream: Readable | Buffer, metadata?: Record<string, any>): Promise<UploadResult> {
    console.log(`[MinIO] Uploading file: ${key}`);

    const contentType = metadata?.contentType || mime.lookup(key) || 'application/octet-stream';
    const metaData = {
      'Content-Type': contentType,
      ...(metadata?.customMetadata || {}),
    };

    try {
      const result = await this.client.putObject(
        this.bucket,
        key,
        stream,
        undefined, // size (让MinIO自动计算)
        metaData
      );

      // 清除缓存
      this.metadataCache.delete(key);
      await this.redis.del(`minio:metadata:${this.bucket}:${key}`);

      // etag is a property on result object
      const etag = typeof result === 'string' ? result : result.etag || '';
      console.log(`[MinIO] Upload successful: ${key}, ETag: ${etag}`);

      return {
        key,
        url: await this.getUrl(key, metadata?.expiresIn || 3600),
        size: 0,
        etag: etag,
      };
    } catch (error: any) {
      console.error(`[MinIO] Upload failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 下载文件
   */
  async download(key: string): Promise<Readable> {
    console.log(`[MinIO] Downloading file: ${key}`);

    try {
      const stream = await this.client.getObject(this.bucket, key);
      // 记录访问
      await this.recordAccess(key);
      return stream;
    } catch (error: any) {
      console.error(`[MinIO] Download failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 删除文件
   */
  async delete(key: string): Promise<void> {
    console.log(`[MinIO] Deleting file: ${key}`);

    try {
      await this.client.removeObject(this.bucket, key);

      // 清除缓存
      this.metadataCache.delete(key);
      await this.redis.del(`minio:metadata:${this.bucket}:${key}`);

      console.log(`[MinIO] Delete successful: ${key}`);
    } catch (error: any) {
      console.error(`[MinIO] Delete failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 批量删除文件
   */
  async deleteMultiple(keys: string[]): Promise<void> {
    console.log(`[MinIO] Deleting ${keys.length} files`);

    if (keys.length === 0) return;

    try {
      // MinIO没有批量删除API，需要逐个删除
      for (const key of keys) {
        await this.client.removeObject(this.bucket, key);
        this.metadataCache.delete(key);
        await this.redis.del(`minio:metadata:${this.bucket}:${key}`);
      }

      console.log(`[MinIO] Deleted ${keys.length} files`);
    } catch (error: any) {
      console.error('[MinIO] Batch delete failed:', error);
      throw error;
    }
  }

  /**
   * 获取文件URL（预签名URL）
   */
  async getUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      return await this.client.presignedGetObject(this.bucket, key, expiresIn);
    } catch (error) {
      // 返回公共URL
      return this.getPublicUrl(key);
    }
  }

  /**
   * 获取公共URL
   */
  private getPublicUrl(key: string): string {
    const protocol = this.useSSL ? 'https' : 'http';
    return `${protocol}://${this.endPoint}:${this.port}/${this.bucket}/${key}`;
  }

  /**
   * 检查文件是否存在
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.getMetadata(key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取文件元数据
   */
  async getMetadata(key: string): Promise<{
    size: number;
    contentType: string;
    etag: string;
    lastModified: Date;
    storageClass: StorageClass;
  }> {
    // 检查缓存
    const cached = this.metadataCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL * 1000) {
      return cached.data;
    }

    // 检查Redis缓存
    const redisKey = `minio:metadata:${this.bucket}:${key}`;
    const redisCached = await this.redis.get(redisKey);
    if (redisCached) {
      const data = JSON.parse(redisCached);
      this.metadataCache.set(key, { timestamp: Date.now(), data });
      return data;
    }

    try {
      const stat = await this.client.statObject(this.bucket, key);

      const metadata = {
        size: stat.size || 0,
        contentType: (stat as any).contentType || stat.metaData?.['Content-Type'] || '',
        etag: stat.etag || '',
        lastModified: stat.lastModified || new Date(),
        storageClass: StorageClass.HOT, // MinIO不区分存储类型
      };

      // 缓存
      this.metadataCache.set(key, { timestamp: Date.now(), data: metadata });
      await this.redis.setex(redisKey, this.cacheTTL, JSON.stringify(metadata));

      return metadata;
    } catch (error: any) {
      if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
        throw new Error(`File not found: ${key}`);
      }
      throw error;
    }
  }

  /**
   * 列出文件
   */
  async list(prefix: string, maxKeys: number = 1000): Promise<Array<{
    key: string;
    size: number;
    lastModified: Date;
  }>> {
    try {
      const stream = this.client.listObjects(this.bucket, prefix, true);
      const objects: any[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (obj) => {
          if (objects.length < maxKeys) {
            objects.push(obj);
          }
        });
        stream.on('error', (err) => {
          console.error('[MinIO] List failed:', err);
          resolve([]);
        });
        stream.on('end', () => {
          resolve(objects.map(obj => ({
            key: obj.name,
            size: obj.size || 0,
            lastModified: new Date(obj.lastModified),
          })));
        });
      });
    } catch (error: any) {
      console.error('[MinIO] List failed:', error);
      return [];
    }
  }

  /**
   * 复制文件
   */
  async copy(sourceKey: string, destKey: string): Promise<void> {
    console.log(`[MinIO] Copying file: ${sourceKey} -> ${destKey}`);

    try {
      // MinIO's copyObject requires CopyConditions object
      const conditions = new Minio.CopyConditions();
      await this.client.copyObject(this.bucket, destKey, `${this.bucket}/${sourceKey}`, conditions);

      // 清除目标缓存
      this.metadataCache.delete(destKey);
      await this.redis.del(`minio:metadata:${this.bucket}:${destKey}`);

      console.log(`[MinIO] Copy successful: ${sourceKey} -> ${destKey}`);
    } catch (error: any) {
      console.error(`[MinIO] Copy failed: ${sourceKey} -> ${destKey}`, error);
      throw error;
    }
  }

  /**
   * 移动文件
   */
  async move(sourceKey: string, destKey: string): Promise<void> {
    await this.copy(sourceKey, destKey);
    await this.delete(sourceKey);
  }

  /**
   * 创建分片上传
   */
  async createMultipartUpload(key: string, metadata?: Record<string, any>): Promise<MultipartUpload> {
    console.log(`[MinIO] Creating multipart upload: ${key}`);

    const contentType = metadata?.contentType || mime.lookup(key) || 'application/octet-stream';

    try {
      const uploadId = await this.client.initiateNewMultipartUpload(this.bucket, key, {
        'Content-Type': contentType,
        ...(metadata?.customMetadata || {}),
      });

      // 缓存uploadId
      await this.redis.setex(
        `minio:multipart:${uploadId}`,
        86400,
        JSON.stringify({ key, uploadId })
      );

      return {
        uploadId: uploadId,
        key,
      };
    } catch (error: any) {
      console.error(`[MinIO] Create multipart upload failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 上传分片
   */
  async uploadPart(uploadId: string, key: string, partNumber: number, stream: Readable | Buffer): Promise<UploadPartResult> {
    this.logger.debug(`[MinIO] Uploading part ${partNumber} for ${key}`);

    try {
      const result = await this.client.putObject(
        this.bucket,
        key,
        stream,
        undefined,
        { 'X-Amz-Multipart-Upload-Id': uploadId, 'X-Amz-Part-Number': partNumber.toString() }
      );

      // etag is a property on result object
      const etag = typeof result === 'string' ? result : result.etag || '';

      return {
        partNumber,
        etag: etag,
      };
    } catch (error: any) {
      console.error(`[MinIO] Upload part ${partNumber} failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 完成分片上传
   */
  async completeMultipartUpload(uploadId: string, key: string, parts: UploadPartResult[]): Promise<UploadResult> {
    console.log(`[MinIO] Completing multipart upload: ${key}`);

    try {
      // Use lower-level S3 complete multipart upload call
      const etag = await (this.client as any).completeMultipartUpload(
        this.bucket,
        key,
        uploadId,
        parts.map(p => ({ etag: p.etag, partNumber: p.partNumber }))
      );

      // 清除缓存和uploadId
      this.metadataCache.delete(key);
      await this.redis.del(`minio:multipart:${uploadId}`);
      await this.redis.del(`minio:metadata:${this.bucket}:${key}`);

      console.log(`[MinIO] Multipart upload completed: ${key}, ETag: ${etag}`);

      return {
        key,
        url: await this.getUrl(key),
        size: 0,
        etag: etag || '',
      };
    } catch (error: any) {
      console.error(`[MinIO] Complete multipart upload failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 取消分片上传
   */
  async abortMultipartUpload(uploadId: string, key: string): Promise<void> {
    console.log(`[MinIO] Aborting multipart upload: ${key}`);

    try {
      await this.client.abortMultipartUpload(this.bucket, key, uploadId);
      await this.redis.del(`minio:multipart:${uploadId}`);
      console.log(`[MinIO] Multipart upload aborted: ${key}`);
    } catch (error: any) {
      console.error(`[MinIO] Abort multipart upload failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.bucketExists(this.bucket);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 记录文件访问
   */
  private async recordAccess(key: string): Promise<void> {
    const accessKey = `minio:access:${this.bucket}:${key}`;
    await this.redis.incr(accessKey);
    await this.redis.expire(accessKey, 86400);
  }

  /**
   * 获取文件访问次数
   */
  async getAccessCount(key: string): Promise<number> {
    const accessKey = `minio:access:${this.bucket}:${key}`;
    const count = await this.redis.get(accessKey);
    return parseInt(count || '0');
  }

  /**
   * 生成预签名上传URL
   */
  async getPresignedUploadUrl(key: string, expiresIn: number = 3600, contentType?: string): Promise<string> {
    return await this.client.presignedPutObject(this.bucket, key, expiresIn);
  }

  /**
   * 生成分片上传的预签名URL
   */
  async getPresignedPartUploadUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number = 3600,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.presignedUrl(
        'PUT',
        this.bucket,
        key,
        expiresIn,
        { partNumber, uploadId },
        (err, url) => {
          if (err) reject(err);
          else resolve(url);
        },
      );
    });
  }

  /**
   * 获取bucket存储统计
   */
  async getBucketStats(): Promise<{
    fileCount: number;
    totalSize: number;
  }> {
    try {
      const stat = await new Promise<any>((resolve, reject) => {
        const stream = this.client.listObjects(this.bucket, '', true);
        const objects: any[] = [];
        let totalSize = 0;

        stream.on('data', (obj) => {
          objects.push(obj);
          totalSize += obj.size || 0;
        });
        stream.on('error', reject);
        stream.on('end', () => resolve({ count: objects.length, totalSize }));
      });

      return {
        fileCount: stat.count,
        totalSize: stat.totalSize,
      };
    } catch (error) {
      console.error('[MinIO] Get bucket stats failed:', error);
      return { fileCount: 0, totalSize: 0 };
    }
  }

  /**
   * 设置bucket策略
   */
  async setBucketPolicy(policy: any): Promise<void> {
    await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy));
  }

  /**
   * 获取bucket策略
   */
  async getBucketPolicy(): Promise<any> {
    const policy = await this.client.getBucketPolicy(this.bucket);
    return JSON.parse(policy);
  }

  /**
   * 设置bucket通知
   */
  async setBucketNotification(config: any): Promise<void> {
    await this.client.setBucketNotification(this.bucket, config);
  }

  /**
   * 监听bucket事件
   */
  listenBucketEvents(events: string[], callback: (event: any) => void): void {
    const listener = this.client.listenBucketNotification(
      this.bucket,
      '', // prefix
      '', // suffix
      events
    );

    listener.on('event', (event: any) => {
      console.log(`[MinIO] Bucket event:`, event);
      callback(event);
    });

    console.log(`[MinIO] Listening for events: ${events.join(', ')}`);
  }
}
