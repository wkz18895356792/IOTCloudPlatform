/**
 * 录像相关类型定义
 * 用于摄像头录像直存 S3 方案
 */

// ============ 录像状态 ============

/**
 * 录像状态枚举
 */
export enum RecordingStatus {
  /** 已发预签名URL，等待上传 */
  PENDING = 'pending',
  /** 分片上传中 */
  UPLOADING = 'uploading',
  /** 上传完成 */
  COMPLETED = 'completed',
  /** 上传失败或超时 */
  FAILED = 'failed',
  /** 已删除 */
  DELETED = 'deleted',
}

/**
 * 上传策略枚举
 */
export enum UploadStrategy {
  /** 小文件单次PUT上传（<100MB） */
  SINGLE_PUT = 'single_put',
  /** 大文件分片上传（>=100MB） */
  MULTIPART = 'multipart',
}

// ============ 录像元数据 ============

/**
 * 录像元数据（对应DB recording 表）
 */
export interface RecordingMetadata {
  /** 录像唯一ID（UUID） */
  id: string;
  /** 设备ID */
  deviceId: string;
  /** S3 object key（服务端生成的标准化路径） */
  fileKey: string;
  /** 录像开始时间（ISO string） */
  startTime: string;
  /** 录像结束时间（ISO string） */
  endTime?: string;
  /** 录像时长（秒） */
  duration?: number;
  /** 文件大小（字节） */
  fileSize?: number;
  /** 文件内容类型 */
  contentType: string;
  /** 上传策略 */
  uploadStrategy: UploadStrategy;
  /** 录像状态 */
  status: RecordingStatus;
  /** 存储提供商 */
  provider: string;
  /** 分片上传ID（仅分片上传时有值） */
  uploadId?: string;
  /** 错误信息（失败时记录） */
  error?: string;
  /** 域ID（多租户） */
  domainId?: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

// ============ 请求类型 ============

/**
 * 摄像头请求上传URL
 */
export interface RecordingUploadUrlRequest {
  deviceId: string;
  requestId: string;
  /** 预估文件大小（字节） */
  estimatedSize?: number;
  /** 内容类型，如 video/mp2t */
  contentType?: string;
  /** 录像开始时间（ISO string） */
  startTime?: string;
}

/**
 * 摄像头请求分片上传
 */
export interface RecordingMultipartStartRequest {
  deviceId: string;
  requestId: string;
  /** 预估文件大小（字节） */
  estimatedSize: number;
  /** 计划分片数 */
  partCount: number;
  /** 内容类型 */
  contentType?: string;
  /** 录像开始时间 */
  startTime?: string;
}

/**
 * 摄像头完成分片上传
 */
export interface RecordingMultipartCompleteRequest {
  deviceId: string;
  requestId: string;
  /** 服务端生成的录像ID */
  recordingId: string;
  /** 服务端生成的上传ID */
  uploadId: string;
  /** 每个分片的ETag */
  parts: Array<{ partNumber: number; etag: string }>;
  /** 实际文件大小（字节） */
  fileSize: number;
  /** 录像结束时间 */
  endTime?: string;
}

/**
 * 摄像头确认单次上传完成
 */
export interface RecordingRegisterRequest {
  deviceId: string;
  requestId: string;
  /** 服务端生成的文件key */
  fileKey: string;
  /** 实际文件大小（字节） */
  fileSize: number;
  /** 录像结束时间 */
  endTime?: string;
}

// ============ 响应类型 ============

/**
 * 上传URL响应
 */
export interface RecordingUploadUrlResponse {
  deviceId: string;
  requestId: string;
  /** 服务端生成的录像ID */
  recordingId: string;
  /** 服务端生成的标准化S3 key */
  fileKey: string;
  /** 预签名PUT URL */
  uploadUrl: string;
  /** URL过期时间（ISO string） */
  expiresAt: string;
  /** 上传策略 */
  strategy: UploadStrategy;
}

/**
 * 分片上传开始响应
 */
export interface RecordingMultipartStartResponse {
  deviceId: string;
  requestId: string;
  /** 服务端生成的录像ID */
  recordingId: string;
  /** 服务端生成的标准化S3 key */
  fileKey: string;
  /** 分片上传ID */
  uploadId: string;
  /** 每个分片的预签名URL */
  partUrls: Array<{
    partNumber: number;
    uploadUrl: string;
  }>;
  /** URL过期时间（ISO string） */
  expiresAt: string;
}

/**
 * 录像完成响应
 */
export interface RecordingCompleteResponse {
  deviceId: string;
  requestId: string;
  /** 录像ID */
  recordingId: string;
  /** 最终状态 */
  status: RecordingStatus;
}

/**
 * 录像播放信息（APP端使用）
 */
export interface RecordingPlaybackInfo {
  recordingId: string;
  deviceId: string;
  /** 预签名GET播放URL */
  playbackUrl: string;
  /** URL过期时间 */
  expiresAt: string;
  /** 时长（秒） */
  duration?: number;
  /** 文件大小 */
  fileSize?: number;
  startTime: string;
  endTime?: string;
}

// ============ 查询类型 ============

/**
 * 录像时间槽
 */
export interface RecordingTimeSlot {
  startTime: string;
  endTime: string;
  recordingId: string;
}

/**
 * 按天分组的录像摘要
 */
export interface RecordingDaySummary {
  date: string;
  recordings: RecordingMetadata[];
  timeSlots: RecordingTimeSlot[];
}

// ============ 批量预分配类型 ============

/**
 * 批量请求上传URL（连续录制场景）
 * 设备一次性请求多个分段的 Presigned URL，本地按序消费
 */
export interface RecordingBatchUploadUrlRequest {
  deviceId: string;
  requestId: string;
  /** 录制计划ID，用于关联同一次连续录制的所有分段 */
  planId: string;
  /** 每段时长（秒），如 300 表示 5 分钟 */
  segmentDuration: number;
  /** 需要几个 URL */
  segmentCount: number;
  /** 起始段序号（从 0 开始） */
  startSegmentIndex: number;
  /** 第一段的开始时间（ISO string） */
  startTime: string;
  /** 内容类型 */
  contentType?: string;
}

/**
 * 批量上传URL响应中的单个分段
 */
export interface RecordingBatchSegmentInfo {
  /** 分段序号 */
  segmentIndex: number;
  /** 确定性文件Key: recordings/{deviceId}/{date}/{HH}/{mm}.{ext} */
  fileKey: string;
  /** 预签名 PUT URL */
  uploadUrl: string;
  /** 本段开始时间（ISO string） */
  startTime: string;
  /** URL 过期时间（ISO string） */
  expiresAt: string;
}

/**
 * 批量上传URL响应
 */
export interface RecordingBatchUploadUrlResponse {
  deviceId: string;
  requestId: string;
  planId: string;
  /** 所有分段的 URL 信息 */
  segments: RecordingBatchSegmentInfo[];
}

/**
 * 批量确认上传完成
 */
export interface RecordingBatchRegisterRequest {
  deviceId: string;
  requestId: string;
  planId: string;
  /** 已完成的分段列表 */
  completedSegments: Array<{
    segmentIndex: number;
    fileKey: string;
    fileSize: number;
    endTime?: string;
  }>;
}

/**
 * 批量确认响应
 */
export interface RecordingBatchRegisterResponse {
  deviceId: string;
  requestId: string;
  planId: string;
  /** 成功注册的分段数 */
  registeredCount: number;
  /** 失败的分段 */
  failedSegments: Array<{ segmentIndex: number; error: string }>;
}
