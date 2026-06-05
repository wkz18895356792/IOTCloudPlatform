import { Provide, Inject, Config, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { Readable } from 'stream';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  RestoreObjectCommand,
  type BucketLocationConstraint,
  type StorageClass as S3StorageClass,
  type MetadataDirective,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as mime from 'mime-types';
import { IStorageProvider, UploadResult, MultipartUpload, UploadPartResult } from './storage-provider.interface';
import { StorageClass, StorageProviderType } from '@baby-monitor/shared-types';
import { IdGenerator } from '@baby-monitor/shared-utils';

/**
 * AWS S3 存储提供者
 * 实现IStorageProvider接口，提供与AWS S3云存储服务的交互能力
 * 支持AWS中国区（北京 cn-north-1 和宁夏 cn-northwest-1）
 * 使用AWS SDK v3，支持对象存储、分片上传、预签名URL等功能
 */
@Provide()
export class S3StorageProvider implements IStorageProvider {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Config('aws')
  awsConfig!: any;

  private s3!: S3Client;              // AWS S3客户端实例
  private bucket!: string;            // S3存储桶名称
  private region!: string;            // AWS区域
  private isChinaRegion!: boolean;    // 是否为AWS中国区

  // 缓存配置，用于减少S3 API调用次数
  private metadataCache: Map<string, any> = new Map();  // 内存缓存
  private cacheTTL = 3600; // 1小时 - 缓存过期时间（秒）

  /**
   * 初始化S3存储提供者
   * @param config AWS配置（由 StorageService 注入）
   * @param redisInstance Redis 服务实例
   * @param loggerInstance 日志实例
   */
  async initialize(config?: any, redisInstance?: any, loggerInstance?: any): Promise<void> {
    // 支持外部注入
    const awsConfig = config || this.awsConfig;
    if (redisInstance) this.redis = redisInstance;
    if (loggerInstance) this.logger = loggerInstance;

    // 从配置中解构出各项参数
    const { region, accessKeyId, secretAccessKey, isChinaRegion, s3, endpoint } = awsConfig;

    // 设置区域，默认使用中国北京区
    this.region = region || 'cn-north-1';
    this.isChinaRegion = isChinaRegion !== false;
    this.bucket = s3?.bucket || 'baby-monitor-files';

    // 构建AWS S3客户端配置对象（v3版本）
    const s3Config: ConstructorParameters<typeof S3Client>[0] = {
      region: this.region,
      maxAttempts: 3, // 失败时最多重试3次
    };

    // 设置AWS访问凭证
    if (accessKeyId && secretAccessKey) {
      s3Config.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }

    // 配置AWS中国区的特殊endpoint
    if (this.isChinaRegion || this.region?.startsWith('cn-')) {
      // 中国区使用amazonaws.com.cn域名
      if (!endpoint) {
        if (this.region === 'cn-north-1') {
          s3Config.endpoint = `https://s3.cn-north-1.amazonaws.com.cn`;
        } else if (this.region === 'cn-northwest-1') {
          s3Config.endpoint = `https://s3.cn-northwest-1.amazonaws.com.cn`;
        }
      } else {
        s3Config.endpoint = endpoint;
      }
    }

    // 如果配置了自定义endpoint（如MinIO兼容模式）
    if (endpoint) {
      s3Config.endpoint = endpoint;
      // v3 SDK使用forcePathStyle代替s3ForcePathStyle
      s3Config.forcePathStyle = true;
    }

    // 创建S3客户端实例
    this.s3 = new S3Client(s3Config);

    // 确保配置的bucket存在，不存在则自动创建
    await this.ensureBucketExists();

    console.log(`[S3] Storage provider initialized for region: ${this.region}, bucket: ${this.bucket}`);
  }

  /**
   * 确保S3 bucket存在
   * 如果bucket不存在则尝试自动创建
   * @private
   */
  private async ensureBucketExists(): Promise<void> {
    try {
      // 尝试获取bucket信息，验证bucket是否存在
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      console.log(`[S3] Bucket exists: ${this.bucket}`);
    } catch (error: any) {
      // 判断错误是否为bucket不存在
      if (error.name === 'NotFound' || error.name === 'NoSuchBucket' || error.$metadata?.httpStatusCode === 404) {
        console.warn(`[S3] Bucket not found: ${this.bucket}, attempting to create...`);
        try {
          // 创建新bucket
          await this.s3.send(new CreateBucketCommand({
            Bucket: this.bucket,
            // 中国区需要指定LocationConstraint
            CreateBucketConfiguration: this.region.startsWith('cn-')
              ? { LocationConstraint: this.region as BucketLocationConstraint }
              : undefined,
          }));
          console.log(`[S3] Bucket created: ${this.bucket}`);
        } catch (createError: any) {
          // 忽略bucket已存在的错误
          if (createError.name !== 'BucketAlreadyExists' && createError.name !== 'BucketAlreadyOwnedByYou') {
            console.error(`[S3] Failed to create bucket:`, createError);
            throw createError;
          }
        }
      } else {
        console.error('[S3] Failed to check bucket:', error);
        throw error;
      }
    }
  }

  getType(): string {
    return StorageProviderType.AWS_S3;
  }

  /**
   * 上传文件
   */
  async upload(key: string, stream: Readable, metadata?: Record<string, any>): Promise<UploadResult> {
    console.log(`[S3] Uploading file: ${key}`);

    const contentType = metadata?.contentType || mime.lookup(key) || 'application/octet-stream';
    const storageClass = metadata?.storageClass || StorageClass.HOT;

    const params = {
      Bucket: this.bucket,
      Key: key,
      Body: stream,
      ContentType: contentType,
      Metadata: metadata?.customMetadata || {},
      StorageClass: this.mapStorageClass(storageClass) as S3StorageClass,
    };

    // 添加ACL（如果配置了）
    if (metadata?.acl) {
      (params as any).ACL = metadata.acl;
    }

    try {
      const result = await this.s3.send(new PutObjectCommand(params));

      // 清除缓存
      this.metadataCache.delete(key);
      await this.redis.del(`s3:metadata:${this.bucket}:${key}`);

      console.log(`[S3] Upload successful: ${key}, ETag: ${result.ETag}`);

      return {
        key,
        url: await this.getUrl(key, metadata?.expiresIn || 3600),
        size: stream.readableLength || 0,
        etag: result.ETag || '',
      };
    } catch (error: any) {
      console.error(`[S3] Upload failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 下载文件
   */
  async download(key: string): Promise<Readable> {
    console.log(`[S3] Downloading file: ${key}`);

    const params = {
      Bucket: this.bucket,
      Key: key,
    };

    try {
      const result = await this.s3.send(new GetObjectCommand(params));
      // 记录访问
      await this.recordAccess(key);
      return result.Body as Readable;
    } catch (error: any) {
      console.error(`[S3] Download failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 删除文件
   */
  async delete(key: string): Promise<void> {
    console.log(`[S3] Deleting file: ${key}`);

    const params = {
      Bucket: this.bucket,
      Key: key,
    };

    try {
      await this.s3.send(new DeleteObjectCommand(params));

      // 清除缓存
      this.metadataCache.delete(key);
      await this.redis.del(`s3:metadata:${this.bucket}:${key}`);

      console.log(`[S3] Delete successful: ${key}`);
    } catch (error: any) {
      console.error(`[S3] Delete failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 批量删除文件
   * S3的单次批量删除请求最多支持1000个对象，超出时会自动分批处理
   * @param keys 要删除的文件key数组
   */
  async deleteMultiple(keys: string[]): Promise<void> {
    console.log(`[S3] Deleting ${keys.length} files`);

    // 如果文件列表为空，直接返回
    if (keys.length === 0) return;

    // S3批量删除API限制为每次最多1000个对象，需要分批处理
    const chunks = [];
    for (let i = 0; i < keys.length; i += 1000) {
      chunks.push(keys.slice(i, i + 1000));
    }

    // 逐批执行删除操作
    for (const chunk of chunks) {
      const params = {
        Bucket: this.bucket,
        Delete: {
          Objects: chunk.map(key => ({ Key: key })),
          Quiet: false, // 设置为false以获取详细的删除结果
        },
      };

      try {
        const result = await this.s3.send(new DeleteObjectsCommand(params));
        console.log(`[S3] Deleted ${result.Deleted?.length || 0} files`);

        // 清除每个已删除文件的缓存
        for (const key of chunk) {
          this.metadataCache.delete(key);
          await this.redis.del(`s3:metadata:${this.bucket}:${key}`);
        }
      } catch (error: any) {
        console.error('[S3] Batch delete failed:', error);
        throw error;
      }
    }
  }

  /**
   * 获取文件URL（预签名URL）
   */
  async getUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      return await getSignedUrl(this.s3, command, { expiresIn });
    } catch (error: any) {
      // 返回公共URL
      return this.getPublicUrl(key);
    }
  }

  /**
   * 获取公共URL
   */
  private getPublicUrl(key: string): string {
    if (this.isChinaRegion || this.region?.startsWith('cn-')) {
      // 中国区URL格式
      return `https://${this.bucket}.s3.${this.region}.amazonaws.com.cn/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
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
    const redisKey = `s3:metadata:${this.bucket}:${key}`;
    const redisCached = await this.redis.get(redisKey);
    if (redisCached) {
      const data = JSON.parse(redisCached);
      this.metadataCache.set(key, { timestamp: Date.now(), data });
      return data;
    }

    const params = {
      Bucket: this.bucket,
      Key: key,
    };

    try {
      const result = await this.s3.send(new HeadObjectCommand(params));

      const metadata = {
        size: result.ContentLength || 0,
        contentType: result.ContentType || '',
        etag: result.ETag?.replace(/"/g, '') || '',
        lastModified: result.LastModified || new Date(),
        storageClass: this.reverseMapStorageClass(result.StorageClass),
      };

      // 缓存
      this.metadataCache.set(key, { timestamp: Date.now(), data: metadata });
      await this.redis.setex(redisKey, this.cacheTTL, JSON.stringify(metadata));

      return metadata;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
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
    const params = {
      Bucket: this.bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
    };

    try {
      const result = await this.s3.send(new ListObjectsV2Command(params));

      return (result.Contents || []).map(obj => ({
        key: obj.Key!,
        size: obj.Size || 0,
        lastModified: obj.LastModified || new Date(),
      }));
    } catch (error: any) {
      console.error('[S3] List failed:', error);
      return [];
    }
  }

  /**
   * 复制文件
   */
  async copy(sourceKey: string, destKey: string): Promise<void> {
    console.log(`[S3] Copying file: ${sourceKey} -> ${destKey}`);

    const params = {
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${sourceKey}`,
      Key: destKey,
    };

    try {
      await this.s3.send(new CopyObjectCommand(params));

      // 清除目标缓存
      this.metadataCache.delete(destKey);
      await this.redis.del(`s3:metadata:${this.bucket}:${destKey}`);

      console.log(`[S3] Copy successful: ${sourceKey} -> ${destKey}`);
    } catch (error: any) {
      console.error(`[S3] Copy failed: ${sourceKey} -> ${destKey}`, error);
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
    console.log(`[S3] Creating multipart upload: ${key}`);

    const contentType = metadata?.contentType || mime.lookup(key) || 'application/octet-stream';
    const storageClass = metadata?.storageClass || StorageClass.HOT;

    const params = {
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      Metadata: metadata?.customMetadata || {},
      StorageClass: this.mapStorageClass(storageClass) as S3StorageClass,
    };

    try {
      const result = await this.s3.send(new CreateMultipartUploadCommand(params));

      // 缓存uploadId
      await this.redis.setex(
        `s3:multipart:${result.UploadId}`,
        86400, // 24小时
        JSON.stringify({ key, uploadId: result.UploadId })
      );

      return {
        uploadId: result.UploadId!,
        key,
      };
    } catch (error: any) {
      console.error(`[S3] Create multipart upload failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 上传分片
   */
  async uploadPart(uploadId: string, key: string, partNumber: number, stream: Readable): Promise<UploadPartResult> {
    this.logger.debug(`[S3] Uploading part ${partNumber} for ${key}`);

    const params = {
      Bucket: this.bucket,
      Key: key,
      PartNumber: partNumber,
      UploadId: uploadId,
      Body: stream,
    };

    try {
      const result = await this.s3.send(new UploadPartCommand(params));

      return {
        partNumber,
        etag: result.ETag?.replace(/"/g, '') || '',
      };
    } catch (error: any) {
      console.error(`[S3] Upload part ${partNumber} failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 完成分片上传
   */
  async completeMultipartUpload(uploadId: string, key: string, parts: UploadPartResult[]): Promise<UploadResult> {
    console.log(`[S3] Completing multipart upload: ${key}`);

    const params = {
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    };

    try {
      const result = await this.s3.send(new CompleteMultipartUploadCommand(params));

      // 清除缓存和uploadId
      this.metadataCache.delete(key);
      await this.redis.del(`s3:multipart:${uploadId}`);
      await this.redis.del(`s3:metadata:${this.bucket}:${key}`);

      console.log(`[S3] Multipart upload completed: ${key}, Location: ${result.Location}`);

      return {
        key,
        url: result.Location || await this.getUrl(key),
        size: 0, // 需要额外获取
        etag: result.ETag?.replace(/"/g, '') || '',
      };
    } catch (error: any) {
      console.error(`[S3] Complete multipart upload failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 取消分片上传
   */
  async abortMultipartUpload(uploadId: string, key: string): Promise<void> {
    console.log(`[S3] Aborting multipart upload: ${key}`);

    const params = {
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
    };

    try {
      await this.s3.send(new AbortMultipartUploadCommand(params));
      await this.redis.del(`s3:multipart:${uploadId}`);
      console.log(`[S3] Multipart upload aborted: ${key}`);
    } catch (error: any) {
      console.error(`[S3] Abort multipart upload failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 记录文件访问
   */
  private async recordAccess(key: string): Promise<void> {
    const accessKey = `s3:access:${this.bucket}:${key}`;
    await this.redis.incr(accessKey);
    await this.redis.expire(accessKey, 86400); // 24小时
  }

  /**
   * 获取文件访问次数
   */
  async getAccessCount(key: string): Promise<number> {
    const accessKey = `s3:access:${this.bucket}:${key}`;
    const count = await this.redis.get(accessKey);
    return parseInt(count || '0');
  }

  /**
   * 设置存储类型
   */
  async setStorageClass(key: string, storageClass: StorageClass): Promise<void> {
    const params = {
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${key}`,
      Key: key,
      StorageClass: this.mapStorageClass(storageClass) as S3StorageClass,
      MetadataDirective: 'REPLACE' as MetadataDirective,
    };

    await this.s3.send(new CopyObjectCommand(params));
    this.metadataCache.delete(key);
  }

  /**
   * 映射存储类型
   */
  private mapStorageClass(storageClass: StorageClass): string {
    const mapping: Record<StorageClass, string> = {
      [StorageClass.HOT]: 'STANDARD',
      [StorageClass.COLD]: 'GLACIER',
      [StorageClass.ARCHIVE]: 'DEEP_ARCHIVE',
    };
    return mapping[storageClass] || 'STANDARD';
  }

  /**
   * 反向映射存储类型
   */
  private reverseMapStorageClass(s3Class?: string): StorageClass {
    if (!s3Class) return StorageClass.HOT;

    const mapping: Record<string, StorageClass> = {
      'STANDARD': StorageClass.HOT,
      'STANDARD_IA': StorageClass.COLD,
      'ONEZONE_IA': StorageClass.COLD,
      'INTELLIGENT_TIERING': StorageClass.HOT,
      'GLACIER': StorageClass.COLD,
      'DEEP_ARCHIVE': StorageClass.ARCHIVE,
    };
    return mapping[s3Class] || StorageClass.HOT;
  }

  /**
   * 生成预签名上传URL
   */
  async getPresignedUploadUrl(key: string, expiresIn: number = 3600, contentType?: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return await getSignedUrl(this.s3, command, { expiresIn });
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
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return await getSignedUrl(this.s3, command, { expiresIn });
  }

  /**
   * 获取bucket存储统计
   */
  async getBucketStats(): Promise<{
    fileCount: number;
    totalSize: number;
  }> {
    let fileCount = 0;
    let totalSize = 0;
    let continuationToken: string | undefined;

    do {
      const params = {
        Bucket: this.bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      };

      const result = await this.s3.send(new ListObjectsV2Command(params));

      if (result.Contents) {
        fileCount += result.Contents.length;
        totalSize += result.Contents.reduce((sum, obj) => sum + (obj.Size || 0), 0);
      }

      continuationToken = result.NextContinuationToken;
    } while (continuationToken);

    return { fileCount, totalSize };
  }

  /**
   * 恢复归档文件
   */
  async restoreArchive(key: string, tier: 'Expedited' | 'Standard' | 'Bulk' = 'Standard'): Promise<void> {
    const params = {
      Bucket: this.bucket,
      Key: key,
      RestoreRequest: {
        Days: 1, // 临时恢复1天
        GlacierJobParameters: {
          Tier: tier,
        },
      },
    };

    await this.s3.send(new RestoreObjectCommand(params));
    console.log(`[S3] Archive restoration initiated for ${key}`);
  }
}
