import { Provide, Inject, Config, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { Readable } from 'stream';
import COS from 'cos-nodejs-sdk-v5';
import * as mime from 'mime-types';
import { IStorageProvider, UploadResult, MultipartUpload, UploadPartResult } from './storage-provider.interface';
import { StorageClass, StorageProviderType } from '@baby-monitor/shared-types';
import { IdGenerator } from '@baby-monitor/shared-utils';

/**
 * 腾讯云 COS 存储提供者
 * 实现IStorageProvider接口，提供与腾讯云对象存储（COS）的交互能力
 * 支持对象存储、分片上传、预签名URL、存储类型转换等功能
 */
@Provide()
export class COSStorageProvider implements IStorageProvider {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Config('tencent')
  tencentConfig!: any;

  private cos!: any; // COS SDK实例
  private bucket!: string; // COS存储桶名称
  private region!: string; // COS区域

  // 缓存配置，用于减少COS API调用
  private metadataCache: Map<string, any> = new Map();
  private cacheTTL = 3600; // 1小时 - 缓存过期时间（秒）

  /**
   * 初始化COS存储提供者
   * @param config 腾讯云配置（由 StorageService 注入）
   * @param redisInstance Redis 服务实例
   * @param loggerInstance 日志实例
   */
  async initialize(config?: any, redisInstance?: any, loggerInstance?: any): Promise<void> {
    // 支持外部注入或使用 MidwayJS 自动注入
    const tencentConfig = config || this.tencentConfig;
    const redis = redisInstance || this.redis;
    const logger = loggerInstance;

    if (redis) {
      this.redis = redis;
    }
    if (logger) {
      this.logger = logger;
    }

    // 从配置中获取腾讯云凭证和bucket配置
    const { secretId, secretKey, cos } = tencentConfig;

    // 验证必要的凭证是否存在
    if (!secretId || !secretKey) {
      console.warn('[COS] Missing credentials, skipping initialization');
      return;
    }

    // 设置区域和bucket名称
    this.region = cos?.region || 'ap-guangzhou';
    this.bucket = cos?.bucket || 'baby-monitor-files';

    // 解析bucket名称，提取bucket名称和区域
    const bucketParts = this.bucket.split('-');
    const bucketName = bucketParts[0];
    const bucketRegion = bucketParts[bucketParts.length - 1];

    // 创建COS SDK实例
    this.cos = new COS({
      SecretId: secretId,
      SecretKey: secretKey,
    });

    // 验证bucket是否可访问
    await this.ensureBucketExists();

    console.log(`[COS] Storage provider initialized for region: ${this.region}, bucket: ${this.bucket}`);
  }

  /**
   * 确保bucket存在
   */
  private async ensureBucketExists(): Promise<void> {
    try {
      await this.headBucket();
      console.log(`[COS] Bucket exists: ${this.bucket}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        console.warn(`[COS] Bucket not found: ${this.bucket}`);
        // Bucket需要通过腾讯云控制台或API创建
        // 这里只记录警告，不自动创建
      }
    }
  }

  /**
   * 检查bucket是否存在
   */
  private async headBucket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.cos.headBucket(
        {
          Bucket: this.bucket,
          Region: this.region,
        },
        (err: any) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  getType(): string {
    return StorageProviderType.TENCENT_COS;
  }

  /**
   * 上传文件到COS
   * @param key 文件在COS中的唯一标识符
   * @param stream 文件数据流或Buffer
   * @param metadata 上传选项和元数据
   * @returns 上传结果，包含文件URL、大小和ETag
   */
  async upload(key: string, stream: Readable | Buffer, metadata?: Record<string, any>): Promise<UploadResult> {
    console.log(`[COS] Uploading file: ${key}`);

    return new Promise((resolve, reject) => {
      // 检测或使用指定的内容类型
      const contentType = metadata?.contentType || mime.lookup(key) || 'application/octet-stream';
      // 映射到COS的存储类型
      const storageClass = this.mapStorageClass(metadata?.storageClass || StorageClass.HOT);

      // 构建COS上传参数
      const params: COS.PutObjectParams = {
        Bucket: this.bucket,
        Region: this.region,
        Key: key,
        Body: stream,
        ContentType: contentType,
      };

      // 添加存储类型（如果不是标准存储）
      if (storageClass !== 'STANDARD') {
        (params as any).StorageClass = storageClass;
      }

      // 添加自定义元数据，COS使用x-cos-meta-前缀
      if (metadata?.customMetadata) {
        Object.keys(metadata.customMetadata).forEach(k => {
          params[`x-cos-meta-${k}`] = metadata.customMetadata[k];
        });
      }

      // 调用COS SDK执行上传
      this.cos.putObject(params, (err: any, data: any) => {
        if (err) {
          console.error(`[COS] Upload failed for ${key}:`, err);
          reject(err);
        } else {
          // 上传成功，清除缓存
          this.metadataCache.delete(key);
          this.redis.del(`cos:metadata:${this.bucket}:${key}`);

          console.log(`[COS] Upload successful: ${key}, ETag: ${data.ETag}`);

          // 返回上传结果
          resolve({
            key,
            url: `https://${this.bucket}.cos.${this.region}.myqcloud.com/${key}`,
            size: 0,
            etag: data.ETag || '',
          });
        }
      });
    });
  }

  /**
   * 下载文件
   */
  async download(key: string): Promise<Readable> {
    console.log(`[COS] Downloading file: ${key}`);

    return new Promise((resolve, reject) => {
      const params: COS.GetObjectParams = {
        Bucket: this.bucket,
        Region: this.region,
        Key: key,
      };

      this.cos.getObject(params, (err: any, data: any) => {
        if (err) {
          console.error(`[COS] Download failed for ${key}:`, err);
          reject(err);
        } else {
          // 记录访问
          this.recordAccess(key);
          resolve(data.Body as Readable);
        }
      });
    });
  }

  /**
   * 删除文件
   */
  async delete(key: string): Promise<void> {
    console.log(`[COS] Deleting file: ${key}`);

    return new Promise((resolve, reject) => {
      const params: COS.DeleteObjectParams = {
        Bucket: this.bucket,
        Region: this.region,
        Key: key,
      };

      this.cos.deleteObject(params, (err: any) => {
        if (err) {
          console.error(`[COS] Delete failed for ${key}:`, err);
          reject(err);
        } else {
          // 清除缓存
          this.metadataCache.delete(key);
          this.redis.del(`cos:metadata:${this.bucket}:${key}`);

          console.log(`[COS] Delete successful: ${key}`);
          resolve();
        }
      });
    });
  }

  /**
   * 批量删除文件
   */
  async deleteMultiple(keys: string[]): Promise<void> {
    console.log(`[COS] Deleting ${keys.length} files`);

    if (keys.length === 0) return;

    return new Promise((resolve, reject) => {
      const params: COS.DeleteMultipleObjectParams = {
        Bucket: this.bucket,
        Region: this.region,
        Objects: keys.map(key => ({ Key: key })),
      };

      this.cos.deleteMultipleObject(params, (err: any, data: any) => {
        if (err) {
          console.error('[COS] Batch delete failed:', err);
          reject(err);
        } else {
          console.log(`[COS] Deleted ${data.Deleted?.length || 0} files`);

          // 清除缓存
          for (const key of keys) {
            this.metadataCache.delete(key);
            this.redis.del(`cos:metadata:${this.bucket}:${key}`);
          }

          resolve();
        }
      });
    });
  }

  /**
   * 获取文件URL（预签名URL）
   */
  async getUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const params: any = {
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
      Expires: expiresIn,
      Method: 'GET',
    };

    return new Promise((resolve, reject) => {
      this.cos.getObjectUrl(params, (err: any, data: any) => {
        if (err) {
          // 返回公共URL
          resolve(this.getPublicUrl(key));
        } else {
          resolve(typeof data === 'string' ? data : data?.Url || String(data));
        }
      });
    });
  }

  /**
   * 获取公共URL
   */
  private getPublicUrl(key: string): string {
    return `https://${this.bucket}.cos.${this.region}.myqcloud.com/${key}`;
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
    const redisKey = `cos:metadata:${this.bucket}:${key}`;
    const redisCached = await this.redis.get(redisKey);
    if (redisCached) {
      const data = JSON.parse(redisCached);
      this.metadataCache.set(key, { timestamp: Date.now(), data });
      return data;
    }

    return new Promise((resolve, reject) => {
      const params: COS.HeadObjectParams = {
        Bucket: this.bucket,
        Region: this.region,
        Key: key,
      };

      this.cos.headObject(params, (err: any, data: any) => {
        if (err) {
          if (err.statusCode === 404) {
            reject(new Error(`File not found: ${key}`));
          } else {
            reject(err);
          }
        } else {
          const metadata = {
            size: parseInt(data.headers['content-length']) || 0,
            contentType: data.headers['content-type'] || '',
            etag: data.headers['etag']?.replace(/"/g, '') || '',
            lastModified: new Date(data.headers['last-modified'] || Date.now()),
            storageClass: this.reverseMapStorageClass(data.headers['x-cos-storage-class']),
          };

          // 缓存
          this.metadataCache.set(key, { timestamp: Date.now(), data: metadata });
          this.redis.setex(redisKey, this.cacheTTL, JSON.stringify(metadata));

          resolve(metadata);
        }
      });
    });
  }

  /**
   * 列出文件
   */
  async list(prefix: string, maxKeys: number = 1000): Promise<Array<{
    key: string;
    size: number;
    lastModified: Date;
  }>> {
    return new Promise((resolve, reject) => {
      const params: COS.GetBucketParams = {
        Bucket: this.bucket,
        Region: this.region,
        Prefix: prefix,
        MaxKeys: maxKeys,
      };

      this.cos.getBucket(params, (err: any, data: any) => {
        if (err) {
          console.error('[COS] List failed:', err);
          resolve([]);
        } else {
          const files = (data.Contents || []).map((obj: any) => ({
            key: obj.Key,
            size: obj.Size || 0,
            lastModified: new Date(obj.LastModified),
          }));
          resolve(files);
        }
      });
    });
  }

  /**
   * 复制文件
   */
  async copy(sourceKey: string, destKey: string): Promise<void> {
    console.log(`[COS] Copying file: ${sourceKey} -> ${destKey}`);

    return new Promise((resolve, reject) => {
      const params: any = {
        Bucket: this.bucket,
        Region: this.region,
        Key: destKey,
        CopySource: `${this.bucket}.cos.${this.region}.myqcloud.com/${sourceKey}`,
      };

      this.cos.putObjectCopy(params, (err: any) => {
        if (err) {
          console.error(`[COS] Copy failed: ${sourceKey} -> ${destKey}`, err);
          reject(err);
        } else {
          // 清除目标缓存
          this.metadataCache.delete(destKey);
          this.redis.del(`cos:metadata:${this.bucket}:${destKey}`);

          console.log(`[COS] Copy successful: ${sourceKey} -> ${destKey}`);
          resolve();
        }
      });
    });
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
    console.log(`[COS] Creating multipart upload: ${key}`);

    return new Promise((resolve, reject) => {
      const contentType = metadata?.contentType || mime.lookup(key) || 'application/octet-stream';
      const storageClass = this.mapStorageClass(metadata?.storageClass || StorageClass.HOT);

      const params: any = {
        Bucket: this.bucket,
        Region: this.region,
        Key: key,
      };

      if (contentType) {
        params.ContentType = contentType;
      }

      if (storageClass !== 'STANDARD') {
        params.StorageClass = storageClass;
      }

      this.cos.multipartInit(params, (err: any, data: any) => {
        if (err) {
          console.error(`[COS] Create multipart upload failed for ${key}:`, err);
          reject(err);
        } else {
          // 缓存uploadId
          this.redis.setex(
            `cos:multipart:${data.UploadId}`,
            86400,
            JSON.stringify({ key, uploadId: data.UploadId })
          );

          resolve({
            uploadId: data.UploadId,
            key,
          });
        }
      });
    });
  }

  /**
   * 上传分片
   */
  async uploadPart(uploadId: string, key: string, partNumber: number, stream: Readable | Buffer): Promise<UploadPartResult> {
    this.logger.debug(`[COS] Uploading part ${partNumber} for ${key}`);

    return new Promise((resolve, reject) => {
      const params: any = {
        Bucket: this.bucket,
        Region: this.region,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: stream,
      };

      this.cos.multipartUpload(params, (err: any, data: any) => {
        if (err) {
          console.error(`[COS] Upload part ${partNumber} failed for ${key}:`, err);
          reject(err);
        } else {
          resolve({
            partNumber,
            etag: data.ETag,
          });
        }
      });
    });
  }

  /**
   * 完成分片上传
   */
  async completeMultipartUpload(uploadId: string, key: string, parts: UploadPartResult[]): Promise<UploadResult> {
    console.log(`[COS] Completing multipart upload: ${key}`);

    return new Promise((resolve, reject) => {
      const params: any = {
        Bucket: this.bucket,
        Region: this.region,
        Key: key,
        UploadId: uploadId,
        Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })),
      };

      this.cos.multipartComplete(params, (err: any, data: any) => {
        if (err) {
          console.error(`[COS] Complete multipart upload failed for ${key}:`, err);
          reject(err);
        } else {
          // 清除缓存和uploadId
          this.metadataCache.delete(key);
          this.redis.del(`cos:multipart:${uploadId}`);
          this.redis.del(`cos:metadata:${this.bucket}:${key}`);

          console.log(`[COS] Multipart upload completed: ${key}, Location: ${data.Location}`);

          resolve({
            key,
            url: data.Location || this.getPublicUrl(key),
            size: 0,
            etag: data.ETag || '',
          });
        }
      });
    });
  }

  /**
   * 取消分片上传
   */
  async abortMultipartUpload(uploadId: string, key: string): Promise<void> {
    console.log(`[COS] Aborting multipart upload: ${key}`);

    return new Promise((resolve, reject) => {
      const params: any = {
        Bucket: this.bucket,
        Region: this.region,
        Key: key,
        UploadId: uploadId,
      };

      this.cos.multipartAbort(params, (err: any) => {
        if (err) {
          console.error(`[COS] Abort multipart upload failed for ${key}:`, err);
          reject(err);
        } else {
          this.redis.del(`cos:multipart:${uploadId}`);
          console.log(`[COS] Multipart upload aborted: ${key}`);
          resolve();
        }
      });
    });
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.headBucket();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 记录文件访问
   */
  private async recordAccess(key: string): Promise<void> {
    const accessKey = `cos:access:${this.bucket}:${key}`;
    await this.redis.incr(accessKey);
    await this.redis.expire(accessKey, 86400);
  }

  /**
   * 获取文件访问次数
   */
  async getAccessCount(key: string): Promise<number> {
    const accessKey = `cos:access:${this.bucket}:${key}`;
    const count = await this.redis.get(accessKey);
    return parseInt(count || '0');
  }

  /**
   * 将通用存储类型映射到COS特定的存储类型
   * @param storageClass 通用存储类型枚举
   * @returns COS存储类型字符串
   * @private
   */
  private mapStorageClass(storageClass: StorageClass): string {
    const mapping: Record<StorageClass, string> = {
      [StorageClass.HOT]: 'STANDARD',        // 热存储 -> 标准存储
      [StorageClass.COLD]: 'ARCHIVE',        // 冷存储 -> 归档存储
      [StorageClass.ARCHIVE]: 'DEEP_ARCHIVE', // 归档 -> 深度归档存储
    };
    return mapping[storageClass] || 'STANDARD';
  }

  /**
   * 将COS存储类型反向映射到通用存储类型
   * @param cosClass COS存储类型字符串
   * @returns 通用存储类型枚举
   * @private
   */
  private reverseMapStorageClass(cosClass?: string): StorageClass {
    if (!cosClass) return StorageClass.HOT;

    const mapping: Record<string, StorageClass> = {
      'STANDARD': StorageClass.HOT,          // 标准存储
      'STANDARD_IA': StorageClass.COLD,      // 低频存储
      'ARCHIVE': StorageClass.COLD,          // 归档存储
      'DEEP_ARCHIVE': StorageClass.ARCHIVE,  // 深度归档存储
    };
    return mapping[cosClass] || StorageClass.HOT;
  }

  /**
   * 生成预签名上传URL
   */
  async getPresignedUploadUrl(key: string, expiresIn: number = 3600, contentType?: string): Promise<string> {
    const params: any = {
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
      Expires: expiresIn,
      Method: 'PUT',
    };

    if (contentType) {
      params.ContentType = contentType;
    }

    return new Promise((resolve, reject) => {
      this.cos.getObjectUrl(params, (err: any, data: any) => {
        if (err) reject(err);
        else resolve(typeof data === 'string' ? data : data?.Url || String(data));
      });
    });
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
      this.cos.getObjectUrl(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Method: 'PUT',
          Expires: expiresIn,
          UploadId: uploadId,
          PartNumber: partNumber,
        },
        (err: any, data: any) => {
          if (err) reject(err);
          else resolve(typeof data === 'string' ? data : data?.Url || String(data));
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
    let fileCount = 0;
    let totalSize = 0;
    let marker = '';

    while (true) {
      const result = await this.listFiles(marker);
      if (!result.Contents || result.Contents.length === 0) break;

      fileCount += result.Contents.length;
      totalSize += result.Contents.reduce((sum: number, obj: any) => sum + (obj.Size || 0), 0);

      if (!result.IsTruncated) break;
      marker = result.NextMarker || '';
    }

    return { fileCount, totalSize };
  }

  /**
   * 列出文件（内部方法，支持分页）
   */
  private listFiles(marker: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const params: COS.GetBucketParams = {
        Bucket: this.bucket,
        Region: this.region,
        Marker: marker,
        MaxKeys: 1000,
      };

      this.cos.getBucket(params, (err: any, data: any) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }
}
