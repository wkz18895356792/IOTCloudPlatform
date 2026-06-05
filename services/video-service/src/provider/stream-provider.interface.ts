import { StreamConfig, StreamSession, RecordConfig, IoTVideoAuthInfo, CloudStorageEventsResult, CloudStorageRecordingsResult, CloudStorageDetail, VideoAntiLeechUrlInfo, CloudStorageThumbnailResult, CloudStorageThumbnailListResult } from '@baby-monitor/shared-types';

/**
 * 直接播放地址信息
 * 用于设备已持续推流的场景，直接获取播放地址而无需创建 session
 */
export interface DirectPlaybackInfo {
  /** HLS 播放地址 */
  hlsUrl: string;
  /** RTMP 播放地址 */
  rtmpUrl?: string;
  /** WebRTC 播放地址 */
  webrtcUrl?: string;
  /** FLV 播放地址 */
  flvUrl?: string;
  /** 流名称 */
  streamName: string;
  /** 提供者类型 */
  provider: string;
  /** 设备ID */
  deviceId: string;
  /** URL 过期时间 */
  expiresAt: Date;
  /** 是否正在推流 */
  isStreaming: boolean;
}

/**
 * 流媒体服务提供者接口
 */
export interface IStreamProvider {
  /**
   * 获取提供者类型
   */
  getType(): string;

  /**
   * 开始推流
   */
  startStream(deviceId: string, config: StreamConfig): Promise<StreamSession>;

  /**
   * 停止推流
   */
  stopStream(sessionId: string): Promise<void>;

  /**
   * 获取播放地址
   */
  getPlaybackUrl(sessionId: string, protocol: string): Promise<string>;

  /**
   * 直接获取设备播放地址
   *
   * 用于设备已持续推流的场景，直接获取播放地址而无需创建 session
   * 适用于 App 随时接入观看实时画面的场景
   *
   * @param deviceId - 设备ID
   * @returns 播放地址信息
   */
  getDirectPlaybackUrl?(deviceId: string): Promise<DirectPlaybackInfo>;

  /**
   * 检查设备是否正在推流
   *
   * @param deviceId - 设备ID
   * @returns 是否正在推流
   */
  isDeviceStreaming?(deviceId: string): Promise<boolean>;

  /**
   * 开始录制
   */
  startRecording(deviceId: string, config: RecordConfig): Promise<string>;

  /**
   * 停止录制
   */
  stopRecording(recordingId: string): Promise<void>;

  /**
   * 获取录制列表
   */
  getRecordings(deviceId: string, startTime?: Date, endTime?: Date): Promise<any[]>;

  /**
   * 健康检查
   */
  healthCheck(): Promise<boolean>;

  /**
   * 生成 IoT Video SDK 签名
   *
   * 用于 APP 端使用 IoT Video SDK 播放实时视频
   * 仅 IoT Video Provider 需要实现
   *
   * @param deviceId - 设备ID
   * @param userId - 用户ID（APP端用户标识）
   * @param expireSeconds - 签名有效期（秒）
   * @returns IoT Video SDK 鉴权信息
   */
  generateIoTVideoAuth?(
    deviceId: string,
    userId?: string,
    expireSeconds?: number,
    oldAccessToken?: string
  ): Promise<IoTVideoAuthInfo>;

  /**
   * 对原始云存储视频播放 URL 进行防盗链签名
   *
   * 通过 GenerateSignedVideoURL API 对传入的原始 URL 进行签名，生成防盗链 URL
   * 仅 IoT Video Provider 需要实现
   *
   * @param videoUrl - 原始云存储视频播放 URL
   * @param deviceId - 设备ID（可选，用于日志和返回信息）
   * @returns 防盗链视频URL信息
   */
  getVideoAntiLeechUrl?(videoUrl: string, deviceId?: string): Promise<VideoAntiLeechUrlInfo>;

  // ==================== 云存储（可选） ====================

  /**
   * 获取云存储事件列表
   *
   * @param deviceId - 设备ID
   * @param startTime - 开始时间（Unix 时间戳，秒）
   * @param endTime - 结束时间（Unix 时间戳，秒）
   * @param context - 翻页游标
   * @param size - 每页数量，默认 10
   */
  getCloudStorageEvents?(
    deviceId: string,
    startTime?: number,
    endTime?: number,
    context?: string,
    size?: number
  ): Promise<CloudStorageEventsResult>;

  /**
   * 获取云存录像列表
   *
   * @param deviceId - 设备ID
   * @param date - 查询日期（YYYY-MM-DD）
   * @param startTime - 开始时间（Unix 时间戳，秒）
   * @param endTime - 结束时间（Unix 时间戳，秒）
   */
  getCloudStorageRecordings?(
    deviceId: string,
    date?: string,
    startTime?: number,
    endTime?: number
  ): Promise<CloudStorageRecordingsResult>;

  /**
   * 获取云存储详情
   *
   * @param deviceId - 设备ID
   */
  getCloudStorageDetail?(deviceId: string): Promise<CloudStorageDetail>;

  /**
   * 开通云存储
   *
   * @param deviceId - 设备ID
   * @param packageId - 云存储套餐ID
   * @param override - 是否覆盖已有套餐
   */
  createCloudStorage?(deviceId: string, packageId?: string, override?: boolean): Promise<{ success: boolean; packageId: string; deviceId: string; orderId?: string; message?: string }>;

  /**
   * 重置云存储
   *
   * @param deviceId - 设备ID
   */
  resetCloudStorage?(deviceId: string): Promise<{ success: boolean; deviceId: string; message?: string }>;

  // ==================== 云存储缩略图（可选） ====================

  /**
   * 获取单个云存储缩略图访问地址
   *
   * @param deviceId - 设备ID
   * @param thumbnail - 缩略图文件名
   */
  getCloudStorageThumbnail?(deviceId: string, thumbnail: string): Promise<CloudStorageThumbnailResult>;

  /**
   * 批量获取云存储缩略图访问地址
   *
   * @param deviceId - 设备ID
   * @param thumbnails - 缩略图文件名列表
   */
  getCloudStorageThumbnailList?(deviceId: string, thumbnails: string[]): Promise<CloudStorageThumbnailListResult>;

  /**
   * 获取多个云存储缩略图访问地址（管道符分隔）
   *
   * @param deviceId - 设备ID
   * @param multiThumbnail - 多个缩略图文件名，以 | 分隔
   */
  getCloudStorageMultiThumbnail?(deviceId: string, multiThumbnail: string): Promise<CloudStorageThumbnailListResult>;
}
