/**
 * 设备日志相关类型定义
 * 用于设备日志打捞功能
 */

// ============ 日志状态 ============

/**
 * 日志状态枚举
 */
export enum LogStatus {
  /** 已发预签名URL，等待上传 */
  PENDING = 'pending',
  /** 上传中 */
  UPLOADING = 'uploading',
  /** 上传完成 */
  COMPLETED = 'completed',
  /** 上传失败或超时 */
  FAILED = 'failed',
  /** 已过期 */
  EXPIRED = 'expired',
}

/**
 * 日志触发类型
 */
export enum LogTriggerType {
  /** 设备主动上报 */
  DEVICE_INITIATED = 'device_initiated',
  /** 平台主动打捞 */
  PLATFORM_INITIATED = 'platform_initiated',
}

/**
 * 日志类型
 */
export enum LogType {
  /** 系统日志 */
  SYSTEM = 'system',
  /** 崩溃日志 */
  CRASH = 'crash',
  /** 网络日志 */
  NETWORK = 'network',
  /** 调试日志 */
  DEBUG = 'debug',
}

// ============ 请求类型 ============

/**
 * 设备请求日志上传URL
 */
export interface LogUploadUrlRequest {
  /** 设备ID */
  deviceId: string;
  /** 请求唯一ID */
  requestId: string;
  /** 预估文件大小（字节） */
  estimatedSize?: number;
  /** 日志类型 */
  logType?: string;
  /** 描述信息 */
  description?: string;
}

/**
 * 确认日志上传完成
 */
export interface LogRegisterRequest {
  /** 设备ID */
  deviceId: string;
  /** 请求唯一ID */
  requestId: string;
  /** 服务端生成的日志ID */
  logId: string;
  /** 服务端生成的文件key */
  fileKey: string;
  /** 实际文件大小（字节） */
  fileSize: number;
}

// ============ 响应类型 ============

/**
 * 日志上传URL响应
 */
export interface LogUploadUrlResponse {
  /** 请求唯一ID */
  requestId: string;
  /** 服务端生成的日志ID */
  logId: string;
  /** 服务端生成的标准化文件路径 */
  fileKey: string;
  /** 预签名PUT URL */
  uploadUrl: string;
  /** URL过期时间（ISO string） */
  expiresAt: string;
}

/**
 * 日志注册完成响应
 */
export interface LogRegisterResponse {
  /** 请求唯一ID */
  requestId: string;
  /** 日志ID */
  logId: string;
  /** 最终状态 */
  status: LogStatus;
}

// ============ 平台主动打捞 ============

/**
 * 设备上报日志打捞结果
 */
export interface LogCollectStatusMessage {
  /** 设备ID */
  deviceId: string;
  /** 打捞任务ID */
  taskId: string;
  /** 状态 */
  status: 'uploading' | 'completed' | 'failed';
  /** 文件大小（字节） */
  fileSize?: number;
  /** 错误信息 */
  error?: string;
}
