import { Readable } from 'stream';
import { StorageClass } from '@baby-monitor/shared-types';

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  etag: string;
}

export interface MultipartUpload {
  uploadId: string;
  key: string;
}

export interface UploadPartResult {
  partNumber: number;
  etag: string;
}

/**
 * 存储服务提供者接口
 */
export interface IStorageProvider {
  /**
   * 获取提供者类型
   */
  getType(): string;

  /**
   * 上传文件
   */
  upload(key: string, stream: Readable, metadata?: Record<string, any>): Promise<UploadResult>;

  /**
   * 下载文件
   */
  download(key: string): Promise<Readable>;

  /**
   * 删除文件
   */
  delete(key: string): Promise<void>;

  /**
   * 批量删除文件
   */
  deleteMultiple(keys: string[]): Promise<void>;

  /**
   * 获取文件URL
   */
  getUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * 检查文件是否存在
   */
  exists(key: string): Promise<boolean>;

  /**
   * 获取文件元数据
   */
  getMetadata(key: string): Promise<{
    size: number;
    contentType: string;
    etag: string;
    lastModified: Date;
    storageClass: StorageClass;
  }>;

  /**
   * 列出文件
   */
  list(prefix: string, maxKeys?: number): Promise<Array<{
    key: string;
    size: number;
    lastModified: Date;
  }>>;

  /**
   * 复制文件
   */
  copy(sourceKey: string, destKey: string): Promise<void>;

  /**
   * 移动文件
   */
  move(sourceKey: string, destKey: string): Promise<void>;

  /**
   * 创建分片上传
   */
  createMultipartUpload(key: string, metadata?: Record<string, any>): Promise<MultipartUpload>;

  /**
   * 上传分片
   */
  uploadPart(uploadId: string, key: string, partNumber: number, stream: Readable): Promise<UploadPartResult>;

  /**
   * 完成分片上传
   */
  completeMultipartUpload(uploadId: string, key: string, parts: UploadPartResult[]): Promise<UploadResult>;

  /**
   * 取消分片上传
   */
  abortMultipartUpload(uploadId: string, key: string): Promise<void>;

  /**
   * 健康检查
   */
  healthCheck(): Promise<boolean>;

  /**
   * 生成预签名上传URL
   * 用于摄像头直存场景，设备直接 PUT 上传到对象存储
   */
  getPresignedUploadUrl(key: string, expiresIn: number, contentType?: string): Promise<string>;

  /**
   * 生成分片上传的预签名URL（可选方法）
   * 用于摄像头直存分片上传场景
   */
  getPresignedPartUploadUrl?(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number,
  ): Promise<string>;
}
