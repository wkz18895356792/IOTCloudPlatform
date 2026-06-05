/**
 * 共享类型定义
 * 导出各模块的公共类型定义，供全项目使用
 */

// ============ 通用类型 ============
export * from './common.types';
import { ErrorCode as CommonErrorCode } from './common.types';

// Re-export ErrorCode for convenience
export const ErrorCode = CommonErrorCode;

// ============ 用户相关 ============
export * from './user.types';

// ============ 设备相关 ============
export * from './device.types';

// ============ 宝宝相关 ============
export * from './baby.types';

// ============ 域相关 ============
export * from './domain.types';

// ============ 录像相关 ============
export * from './recording.types';

// ============ 日志相关 ============
export * from './log.types';

// ============ 用户角色 ============
/**
 * 用户角色枚举
 * 定义系统用户的三种权限级别
 */
export enum UserRole {
  /** 管理员 - 拥有系统所有权限 */
  ADMIN = 'admin',
  /** 普通用户 - 拥有基本操作权限 */
  USER = 'user',
  /** 访客 - 只有只读权限 */
  GUEST = 'guest',
}

/**
 * 用户基础信息
 * 定义用户账户的核心属性
 */
export interface User {
  /** 用户唯一标识ID */
  id: string;
  /** 用户名 */
  username: string;
  /** 邮箱地址 */
  email: string;
  /** 用户角色 */
  role: UserRole;
  /** 账户创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 产品类型 ============
/**
 * 产品类型枚举
 * 定义系统支持的所有设备产品类型
 */
export enum ProductType {
  /** 摄像头 - 用于视频监控的设备 */
  CAMERA = 'camera',
  /** 显示屏 - 用于显示视频的设备 */
  SCREEN = 'screen',
  /** 传感器 - 用于环境监测的设备 */
  SENSOR = 'sensor',
  /** 网关 - 用于连接子设备的中心设备 */
  GATEWAY = 'gateway',
  /** 灯光 - 智能照明设备 */
  LIGHT = 'light',
  /** 开关 - 智能开关设备 */
  SWITCH = 'switch',
  /** 温控器 - 温度控制设备 */
  THERMOSTAT = 'thermostat',
  /** 门锁 - 智能门锁设备 */
  LOCK = 'lock',
  /** 窗帘 - 智能窗帘设备 */
  BLINDS = 'blinds',
  /** 插座 - 智能插座设备 */
  PLUG = 'plug',
}

// ============ 云服务提供商 ============
/**
 * 云服务提供商枚举
 * 定义设备使用的云平台类型
 */
export enum CloudProvider {
  /** Amazon Web Services - Kinesis Video Streams */
  AWS = 1,
  /** 腾讯云 - IoT Video 消费版 */
  TENCENT = 2,
  /** RJI - 自建平台 */
  RJI = 3,
}

// ============ 设备协议 ============
/**
 * 设备通信协议枚举
 * 定义设备与云端通信使用的协议类型
 */
export enum DeviceProtocol {
  /** 私有协议 - 自定义的设备通信协议 */
  PRIVATE = 'private',
  /** Matter协议 - 通用智能家居互联标准 */
  MATTER = 'matter',
}

/**
 * 设备状态枚举
 * 定义设备在系统中的当前状态
 */
export enum DeviceStatus {
  /** 在线 - 设备已连接并正常工作 */
  ONLINE = 'online',
  /** 离线 - 设备未连接 */
  OFFLINE = 'offline',
  /** 未授权 - 设备未完成认证或被禁用 */
  UNAUTHORIZED = 'unauthorized',
  /** 升级中 - 设备正在进行固件升级 */
  UPDATING = 'updating',
}

/**
 * 设备基础信息
 * 定义系统中注册设备的完整属性
 */
export interface Device {
  /** 设备唯一标识ID */
  id: string;
  /** 设备序列号 - 厂商设置的唯一编号 */
  serialNumber: string;
  /** 产品ID - 关联的产品型号标识 */
  productId: string;
  /** 产品类型 */
  productType: ProductType;
  /** 设备名称 - 用户自定义的显示名称 */
  name: string;
  /** 固件版本 */
  firmwareVersion: string;
  /** 通信协议类型 */
  protocol: DeviceProtocol;
  /** 设备当前状态 */
  status: DeviceStatus;
  /** IP地址 - 设备当前的IP地址（可选） */
  ipAddress?: string;
  /** 最后上线时间（可选） */
  lastOnline?: Date;
  /** 设备所有者ID */
  ownerId: string;
  /** 设备注册时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

/**
 * 设备状态数据
 * 记录设备上报的状态信息
 */
export interface DeviceState {
  /** 设备ID */
  deviceId: string;
  /** 状态数据 - 键值对形式存储各种状态属性 */
  state: Record<string, any>;
  /** 状态上报时间 */
  reportedAt: Date;
}

/**
 * 设备能力
 * 描述设备支持的功能能力
 */
export interface DeviceCapability {
  /** 能力类型 - 如 video、audio、ptz 等 */
  type: string;
  /** 是否支持该能力 */
  supported: boolean;
  /** 能力版本 - 如协议版本等（可选） */
  version?: string;
}

// ============ MQTT相关 ============
/**
 * MQTT服务质量等级枚举
 * 定义消息传递的保障级别
 */
export enum MqttQoS {
  /** 最多一次 - 消息可能丢失，不保证送达 */
  AT_MOST_ONCE = 0,
  /** 至少一次 - 消息至少送达一次，可能重复 */
  AT_LEAST_ONCE = 1,
  /** 恰好一次 - 消息精确送达一次，不重复 */
  EXACTLY_ONCE = 2,
}

/**
 * MQTT消息
 * 定义通过MQTT协议传输的消息格式
 */
export interface MqttMessage {
  /** 消息主题 */
  topic: string;
  /** 消息内容 */
  payload: string;
  /** 服务质量等级 */
  qos: MqttQoS;
  /** 是否保留消息 - 保留最后一条消息供新订阅者获取（可选） */
  retain?: boolean;
  /** 消息ID - 用于消息确认和去重（可选） */
  messageId?: string;
  /** 消息时间戳（可选） */
  timestamp?: number;
}

// ============ 私有协议相关 ============
/**
 * 私有协议动作枚举
 * 定义私有协议支持的消息类型
 */
export enum PrivateProtocolAction {
  /** 设备注册 - 设备首次接入时的注册请求 */
  REGISTER = 'register',
  /** 设备认证 - 设备身份验证 */
  AUTH = 'auth',
  /** 心跳 - 设备保活信号 */
  HEARTBEAT = 'heartbeat',
  /** 状态上报 - 设备主动上报状态 */
  REPORT = 'report',
  /** 控制命令 - 云端向设备发送的控制指令 */
  COMMAND = 'command',
  /** 固件升级 - OTA升级相关命令 */
  UPGRADE = 'upgrade',
  /** 配置更新 - 设备配置参数更新 */
  CONFIG = 'config',
}

/**
 * 私有协议消息格式
 * 定义设备与云端通信的消息结构
 */
export interface PrivateProtocolMessage {
  /** 消息ID - 用于请求响应匹配 */
  msgId: string;
  /** 消息时间戳 */
  timestamp: number;
  /** 消息动作类型 */
  action: PrivateProtocolAction;
  /** 消息数据 - 具体的业务数据 */
  data: Record<string, any>;
}

/**
 * 设备注册数据
 * 设备注册时携带的信息
 */
export interface DeviceRegisterData {
  /** 设备序列号 */
  serialNumber: string;
  /** 产品类型 */
  productType: ProductType;
  /** 固件版本 */
  firmwareVersion: string;
  /** 设备能力列表 */
  capabilities: DeviceCapability[];
}

/**
 * 设备认证数据
 * 设备进行身份验证时的数据
 */
export interface DeviceAuthData {
  /** 设备ID */
  deviceId: string;
  /** 签名 - 用于验证设备身份 */
  signature: string;
  /** 时间戳 - 防止重放攻击 */
  timestamp: number;
}

/**
 * 设备遥测数据
 * 设备上报的运行数据
 */
export interface DeviceTelemetryData {
  /** 数据类型 */
  type: 'telemetry' | 'event' | 'alarm';
  /** 指标数据 - 数值型或字符串型指标（可选） */
  metrics?: Record<string, number | string>;
  /** 事件描述（可选） */
  event?: string;
  /** 告警信息（可选） */
  alarm?: {
    /** 告警类型 */
    type: string;
    /** 告警级别 */
    level: 'info' | 'warning' | 'error' | 'critical';
    /** 告警消息 */
    message: string;
  };
}

// ============ Matter协议相关 ============
/**
 * Matter设备信息
 * 描述Matter协议设备的属性
 */
export interface MatterDevice {
  /** 节点ID - Matter网络中的节点标识 */
  nodeId: number;
  /** 端点号 - 设备内部的功能单元标识 */
  endpoint: number;
  /** 设备类型 - Matter标准定义的设备类型 */
  deviceType: number;
  /** 厂商ID（可选） */
  vendorId?: number;
  /** 产品ID（可选） */
  productId?: number;
  /** 固件版本（可选） */
  firmwareVersion?: string;
  /** 设备名称（可选） */
  deviceName?: string;
  /** 设备ID - 系统内部标识（可选） */
  deviceId?: string;
  /** 支持的簇列表 - Matter协议的功能簇 */
  clusters: number[];
}

// ============ 流媒体相关 ============
/**
 * 流媒体协议枚举
 * 定义支持的流媒体传输协议
 */
export enum StreamProtocol {
  /** HLS - HTTP Live Streaming 协议 */
  HLS = 'hls',
  /** WebRTC - Web Real-Time Communication 协议 */
  WEBRTC = 'webrtc',
  /** RTMP - Real-Time Messaging Protocol */
  RTMP = 'rtmp',
  /** RTSP - Real-Time Streaming Protocol */
  RTSP = 'rtsp',
}

/**
 * 流媒体服务提供商类型
 * 定义支持的流媒体服务提供商
 */
export enum StreamProviderType {
  /** Amazon Kinesis Video Streams */
  AWS_KVS = 'aws_kvs',
  /** WebRTC 直接推流 */
  WEBRTC = 'webrtc',
  /** 腾讯云物联网智能视频服务（消费版） */
  IOT_VIDEO = 'iot_video',
}

/**
 * 流媒体配置
 * 定义视频流的编码和传输参数
 */
export interface StreamConfig {
  /** 流媒体协议 */
  protocol: StreamProtocol;
  /** 视频配置 */
  video: {
    /** 视频编码格式 */
    codec: 'h264' | 'h265' | 'vp8' | 'vp9';
    /** 分辨率 - 如 1920x1080 */
    resolution: string;
    /** 帧率 - 每秒帧数 */
    fps: number;
    /** 码率 - 单位 kbps */
    bitrate: number;
  };
  /** 音频配置（可选） */
  audio?: {
    /** 音频编码格式 */
    codec: 'aac' | 'opus';
    /** 采样率 - 单位 Hz */
    sampleRate: number;
    /** 声道数 */
    channels: number;
  };
}

/**
 * 流媒体会话
 * 记录一次视频流的会话信息
 */
export interface StreamSession {
  /** 会话唯一标识ID */
  id: string;
  /** 关联的设备ID */
  deviceId: string;
  /** 流媒体服务提供商 */
  provider: StreamProviderType;
  /** 流媒体配置 */
  config: StreamConfig;
  /** 会话状态 */
  status: 'starting' | 'streaming' | 'stopped' | 'error';
  /** 流媒体地址（可选） */
  streamUrl?: string;
  /** HLS播放地址（可选） */
  hlsUrl?: string;
  /** RTMP播放地址（可选） */
  rtmpUrl?: string;
  /** WebRTC播放地址（可选） */
  webrtcUrl?: string;
  /** FLV播放地址（可选） */
  flvUrl?: string;
  /** 流名称（可选） */
  streamName?: string;
  /** 会话创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
  /** 会话结束时间（可选） */
  stoppedAt?: Date;
}

/**
 * IoT Video SDK 鉴权信息
 * 用于 APP 端使用 IoT Video SDK 播放实时视频
 *
 * 通过 v20191126 的 CreateAppUsr + CreateUsrToken API 获取
 * @see https://cloud.tencent.com/document/product/1131/42370
 * @see https://cloud.tencent.com/document/product/1131/42371
 */
export interface IoTVideoAuthInfo {
  /** 终端用户在 IoT Video 平台的唯一标识（AccessId） */
  accessId: string;
  /** IoT Video 云服务器返回的访问令牌 */
  accessToken: string;
  /** Token 过期时间（Unix 时间戳，秒） */
  expireTime: number;
  /** 终端唯一 ID，用于区分同一用户的多个终端 */
  terminalId?: string;
  /** 厂商云标识用户的唯一 ID（CunionId） */
  cunionId?: string;
  /** 用户是否为新创建 */
  isNewUser?: boolean;
  /** 设备 ID - 系统内部标识 */
  deviceId: string;
  /** 产品 ID */
  productId: string;
  /** 设备名称 */
  deviceName: string;
}

/**
 * IoT Video 签名请求参数
 */
export interface IoTVideoAuthRequest {
  /** 设备ID */
  deviceId: string;
  /** 用户ID（可选，不传则自动生成） */
  userId?: string;
  /** 签名有效期（秒），默认 3600 */
  expireSeconds?: number;
}

/**
 * IoT Video 设备三元组信息
 * 设备在腾讯云 IoT Video 平台的身份标识
 */
export interface DeviceTripleInfo {
  /** 产品 ID */
  productId: string;
  /** 设备名称 */
  deviceName: string;
  /** 设备密钥（用于设备认证） */
  deviceSecret: string;
  /** 设备 PSK（预共享密钥，用于 TLS 连接） */
  devicePsk?: string;
  /** 系统内部设备 ID */
  deviceId: string;
  /** 创建时间 */
  createdAt: Date;
}

// ============ 云存储类型 ============

/**
 * 云存储事件
 * 云存触发的录像事件（如移动侦测、人形检测等）
 */
export interface CloudStorageEvent {
  /** 事件ID */
  eventId: string;
  /** 事件类型 */
  eventType: string;
  /** 开始时间（Unix 时间戳，秒） */
  startTime: number;
  /** 结束时间（Unix 时间戳，秒） */
  endTime: number;
  /** 缩略图地址 */
  thumbnailUrl: string;
  /** 录像播放地址 */
  videoUrl: string;
  /** 设备ID */
  deviceId: string;
}

/**
 * 云存储时间槽
 * 描述一段连续录像的起止时间
 */
export interface CloudStorageTimeSlot {
  /** 开始时间（Unix 时间戳，秒） */
  startTime: number;
  /** 结束时间（Unix 时间戳，秒） */
  endTime: number;
}

/**
 * 云存录像
 * 某一天的云存录像信息
 */
export interface CloudStorageRecording {
  /** 日期（YYYY-MM-DD） */
  date: string;
  /** 时间轴 */
  timeSlots: CloudStorageTimeSlot[];
  /** 播放地址 */
  videoUrl: string;
}

/**
 * 云存储详情
 * 设备云存储的状态和套餐信息
 */
export interface CloudStorageDetail {
  /** 云存储状态 */
  status: string;
  /** 套餐类型 */
  type?: string;
  /** 过期时间（Unix 时间戳，秒） */
  expireTime?: number;
  /** 循环覆盖周期（天） */
  shiftDuration?: number;
  /** 设备ID */
  deviceId: string;
}

/**
 * 云存储事件列表响应
 */
export interface CloudStorageEventsResult {
  /** 事件总数 */
  total: number;
  /** 事件列表 */
  events: CloudStorageEvent[];
  /** 是否已拉取完毕 */
  listover?: boolean;
  /** 翻页游标，用于下一次请求 */
  context?: string;
}

/**
 * 云存录像响应
 */
export interface CloudStorageRecordingsResult {
  /** 有数据的日期列表 */
  dates: string[];
  /** 录像列表 */
  recordings: CloudStorageRecording[];
}

/**
 * 缩略图 URL 信息
 */
export interface ThumbnailUrlInfo {
  /** 缩略图访问地址 */
  thumbnailUrl: string;
  /** 访问地址过期时间（Unix 时间戳，秒） */
  expireTime: number;
}

/**
 * 单个缩略图响应
 */
export interface CloudStorageThumbnailResult {
  /** 缩略图访问地址 */
  thumbnailUrl: string;
  /** 访问地址过期时间（Unix 时间戳，秒） */
  expireTime: number;
  /** 设备ID */
  deviceId: string;
}

/**
 * 批量缩略图响应
 */
export interface CloudStorageThumbnailListResult {
  /** 缩略图信息列表 */
  thumbnails: ThumbnailUrlInfo[];
  /** 设备ID */
  deviceId: string;
}

/**
 * 视频防盗链URL信息
 * 通过腾讯云 GenerateSignedVideoURL API 获取的签名播放地址
 */
export interface VideoAntiLeechUrlInfo {
  /** 防盗链播放地址（HLS） */
  videoUrl: string;
  /** URL 过期时间（Unix 时间戳，秒） */
  expireTime: number;
  /** 设备ID */
  deviceId: string;
  /** 请求时间（Unix 时间戳，秒） */
  requestTime: number;
}

/**
 * 录制配置
 * 定义视频录制的参数
 */
export interface RecordConfig {
  /** 录制格式 */
  format: 'mp4' | 'flv' | 'm3u8';
  /** 单个录制文件时长 - 单位秒（可选） */
  duration?: number;
  /** 存储类型 */
  storageType: 'hot' | 'cold' | 'archive';
}

// ============ 存储相关 ============
/**
 * 存储服务提供商类型
 * 定义支持的云存储服务
 */
export enum StorageProviderType {
  /** Amazon S3 */
  AWS_S3 = 'aws_s3',
  /** 腾讯云对象存储 */
  TENCENT_COS = 'tencent_cos',
  /** MinIO - 自建对象存储 */
  MINIO = 'minio',
}

/**
 * 存储类别
 * 定义数据的存储级别，影响访问速度和成本
 */
export enum StorageClass {
  /** 热存储 - 高频访问，低延迟 */
  HOT = 'hot',
  /** 冷存储 - 低频访问，成本较低 */
  COLD = 'cold',
  /** 归档存储 - 极少访问，成本最低，需要解冻 */
  ARCHIVE = 'archive',
}

/**
 * 存储配置
 * 对象存储服务的连接配置
 */
export interface StorageConfig {
  /** 存储服务提供商 */
  provider: StorageProviderType;
  /** 服务区域（可选） */
  region?: string;
  /** 存储桶名称 */
  bucket: string;
  /** 访问密钥ID */
  accessKey: string;
  /** 访问密钥 */
  secretKey: string;
  /** 自定义端点 - 用于私有化部署（可选） */
  endpoint?: string;
}

/**
 * 文件元数据
 * 存储中文件的描述信息
 */
export interface FileMetadata {
  /** 文件唯一键 - 存储路径 */
  key: string;
  /** 文件大小 - 单位字节 */
  size: number;
  /** 内容类型 - MIME类型 */
  contentType: string;
  /** 文件哈希值 - 用于校验 */
  etag: string;
  /** 存储类别 */
  storageClass: StorageClass;
  /** 文件创建时间 */
  createdAt: Date;
}

// ============ API响应 ============
/**
 * 通用API响应格式（成功响应）
 * 统一的接口响应结构
 */
export interface ApiResponse<T = any> {
  /** 请求是否成功 */
  success: boolean;
  /** 响应数据 - 成功时返回（可选） */
  data?: T;
  /** 错误信息 - 失败时返回（可选） */
  error?: {
    /** 错误码 */
    code: string;
    /** 错误消息 */
    message: string;
    /** 错误详情 - 额外的调试信息（可选） */
    details?: any;
  };
  /** 响应时间戳 */
  timestamp: number;
}

// successResponse and errorResponse are re-exported from common.types.ts

// ============ IdGenerator ============
/**
 * ID生成器
 * 用于生成各种唯一标识符
 */
export class IdGenerator {
  /**
   * 生成UUID v4格式的唯一标识符
   */
  static uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 生成短ID（适用于URL参数等场景）
   */
  static shortId(length = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

/**
 * 分页请求参数
 * 定义分页查询的通用参数
 */
export interface PaginationParams {
  /** 当前页码 - 从1开始 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 排序字段（可选） */
  sortBy?: string;
  /** 排序方向（可选） */
  sortOrder?: 'asc' | 'desc';
}

/**
 * 分页响应数据
 * 定义分页查询的响应结构
 */
export interface PaginatedResponse<T> {
  /** 数据列表 */
  items: T[];
  /** 总记录数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 总页数 */
  totalPages: number;
}

// ============ 设备命令 ============
/**
 * 设备命令类型枚举
 * 定义可向设备发送的控制命令类型
 */
export enum DeviceCommandType {
  /** 重启设备 */
  REBOOT = 'reboot',
  /** 固件升级 */
  UPGRADE = 'upgrade',
  /** 配置更新 */
  CONFIG = 'config',
  /** 开始推流 */
  START_STREAM = 'start_stream',
  /** 停止推流 */
  STOP_STREAM = 'stop_stream',
  /** 抓拍图片 */
  CAPTURE_IMAGE = 'capture_image',
  /** 云台控制 */
  PTZ_CONTROL = 'ptz',
  /** 恢复出厂设置 */
  FACTORY_RESET = 'factory_reset',
  /** 开始录制 */
  START_RECORDING = 'start_recording',
  /** 停止录制 */
  STOP_RECORDING = 'stop_recording',
  /** 静音/取消静音 */
  MUTE = 'mute',
  /** 设置分辨率 */
  SET_RESOLUTION = 'resolution',
}

// ============ 云台控制相关 ============
/**
 * 云台移动方向
 */
export enum PTZDirection {
  /** 向上 */
  UP = 'up',
  /** 向下 */
  DOWN = 'down',
  /** 向左 */
  LEFT = 'left',
  /** 向右 */
  RIGHT = 'right',
  /** 左上 */
  UP_LEFT = 'up_left',
  /** 右上 */
  UP_RIGHT = 'up_right',
  /** 左下 */
  DOWN_LEFT = 'down_left',
  /** 右下 */
  DOWN_RIGHT = 'down_right',
  /** 停止 */
  STOP = 'stop',
  /** 回到预设位置 */
  GOTO_PRESET = 'goto_preset',
  /** 设置预设位置 */
  SET_PRESET = 'set_preset',
}

/**
 * 云台控制命令参数
 */
export interface PTZControlPayload {
  /** 移动方向 */
  direction: PTZDirection;
  /** 移动速度 (1-100) */
  speed?: number;
  /** 持续时间（毫秒），连续移动时使用 */
  duration?: number;
  /** 预设位置ID（用于 goto_preset 和 set_preset） */
  presetId?: number;
  /** 水平角度（-180到180） */
  horizontal?: number;
  /** 垂直角度（-90到90） */
  vertical?: number;
  /** 变焦倍数 */
  zoom?: number;
}

/**
 * 云台预设位置
 */
export interface PTZPreset {
  /** 预设位置ID */
  id: number;
  /** 预设位置名称 */
  name: string;
  /** 水平角度 */
  horizontal: number;
  /** 垂直角度 */
  vertical: number;
  /** 变焦倍数 */
  zoom: number;
}

/**
 * 设备命令
 * 记录向设备发送的控制命令及其执行状态
 */
export interface DeviceCommand {
  /** 命令唯一标识ID */
  id: string;
  /** 目标设备ID */
  deviceId: string;
  /** 命令类型 */
  type: DeviceCommandType;
  /** 命令参数 - 具体的控制参数 */
  payload: Record<string, any>;
  /** 命令状态 */
  status: 'pending' | 'sent' | 'acknowledged' | 'timeout' | 'failed';
  /** 命令创建时间 */
  createdAt: Date;
  /** 命令执行时间（可选） */
  executedAt?: Date;
  /** 执行结果（可选） */
  result?: any;
}

// ============ OTA升级相关 ============
/**
 * 固件版本信息
 * 描述设备固件的版本详情
 */
export interface FirmwareVersion {
  /** 固件版本唯一标识ID */
  id: string;
  /** 关联的产品ID */
  productId: string;
  /** 版本号 - 如 1.2.3 */
  version: string;
  /** 版本更新说明 */
  releaseNotes: string;
  /** 固件文件下载地址 */
  fileUrl: string;
  /** 文件大小 - 单位字节 */
  fileSize: number;
  /** 文件校验和 - 用于验证文件完整性 */
  checksum: string;
  /** 是否强制升级 */
  isForced: boolean;
  /** 版本发布时间 */
  createdAt: Date;
}

/**
 * OTA升级任务
 * 记录设备固件升级的进度和状态
 */
export interface OTATask {
  /** 升级任务唯一标识ID */
  id: string;
  /** 目标设备ID */
  deviceId: string;
  /** 固件版本ID */
  firmwareId: string;
  /** 当前版本 */
  fromVersion: string;
  /** 目标版本 */
  toVersion: string;
  /** 升级状态 */
  status: 'pending' | 'downloading' | 'installing' | 'completed' | 'failed';
  /** 升级进度 - 0-100 */
  progress: number;
  /** 任务创建时间 */
  createdAt: Date;
  /** 完成时间（可选） */
  completedAt?: Date;
  /** 错误信息 - 失败时记录（可选） */
  error?: string;
}
