/**
 * MQTT 消息类型定义
 * 基于 MQTT_TOPICS.md 文档
 */

// 从 shared-types 导入 CloudProvider
import { CloudProvider } from '@baby-monitor/shared-types';

// 重新导出供其他模块使用
export { CloudProvider };

// ==================== 枚举定义 ====================

/**
 * 协议类型
 */
export enum DeviceProtocol {
  PRIVATE = 'private',
  MATTER = 'matter',
}

/**
 * 产品类型
 */
export enum ProductType {
  CAMERA = 'camera',
  SCREEN = 'screen',
  SENSOR = 'sensor',
}

/**
 * 设备状态
 */
export enum DeviceStatusType {
  ONLINE = 'online',
  OFFLINE = 'offline',
  STANDBY = 'standby',
}

/**
 * 事件类型
 */
export enum EventType {
  CRY_DETECTED = 1,      // 检测到哭声
  REGION_INTRUSION = 2,  // 检测到区域入侵
  MOTION_DETECTED = 3,   // 检测到物体移动
  PERSON_DETECTED = 4,   // 检测到人形
}

/**
 * 凭证类型
 */
export enum CredentialType {
  KVS = 'kvs',
  MQTT = 'mqtt',
  CLOUD = 'cloud',
}

/**
 * 错误码
 */
export enum ErrorCode {
  OK = 0,
  E_UNKNOWN = -1,
  E_FORMAT = 1,
  E_REQUEST = 2,
  E_PARAMS = 3,
  E_SIGN = 4,
  E_UNAUTHORIZED = 5,
  E_FORBIDDEN = 6,
  E_NOT_FOUND = 7,
  E_TIMEOUT = 8,
  E_SERVICE_UNAVAILABLE = 9,
  E_OBJECT_NULL = 101,
  E_OBJECT_EXISTS = 102,
  E_OBJECT_ENABLE = 103,
  E_OBJECT_UNSUPPORTED = 104,
}

/**
 * QoS 级别
 */
export enum MqttQoS {
  AT_MOST_ONCE = 0,
  AT_LEAST_ONCE = 1,
  EXACTLY_ONCE = 2,
}

// ==================== 基础消息接口 ====================

/**
 * 基础消息结构
 */
export interface BaseMessage {
  deviceId: string;
  timestamp: number;
}

// ==================== 设备生命周期消息 ====================

/**
 * 设备注册请求
 * 主题: devices/{deviceId}/register
 */
export interface DeviceRegisterRequest extends BaseMessage {
  serialNumber: string;
  productType: ProductType | string;
  deviceType?: string;
  firmwareVersion: string;
  macAddress?: string;
  protocol: DeviceProtocol | string;
  userId?: string;
  cloudProvider: CloudProvider;
}

/**
 * 设备认证请求
 * 主题: devices/{deviceId}/auth
 */
export interface DeviceAuthRequest extends BaseMessage {
  token: string;
  signature?: string;
}

/**
 * 设备心跳消息
 * 主题: devices/{deviceId}/heartbeat
 */
export interface DeviceHeartbeatMessage extends BaseMessage {
  temperature?: number;
}

/**
 * 设备状态上报
 * 主题: devices/{deviceId}/status
 */
export interface DeviceStatusMessage extends BaseMessage {
  status: DeviceStatusType | string;
  battery?: number;
  network?: number;
  temperature?: number;
  humidity?: number;
}

/**
 * 设备数据上报
 * 主题: devices/{deviceId}/report
 */
export interface DeviceReportMessage extends BaseMessage {
  data: Record<string, any>;
}

/**
 * 设备事件上报
 * 主题: devices/{deviceId}/event
 */
export interface DeviceEventMessage extends BaseMessage {
  eventType: EventType | number;
  details?: string;
  imageUrl?: string;
  videoUrl?: string;
}

// ==================== 设备命令消息 ====================

/**
 * 设备命令请求
 * 主题: devices/{deviceId}/command
 */
export interface DeviceCommandRequest extends BaseMessage {
  command: string;
  commandId: string;
  data?: Record<string, any>;
}

/**
 * 设备命令响应
 * 主题: devices/{deviceId}/command/response
 */
export interface DeviceCommandResponse extends BaseMessage {
  commandId: string;
  command: string;
  result?: {
    message: string;
    [key: string]: any;
  };
  error?: string;
}

// ==================== 设备配置消息 ====================

/**
 * 设备配置请求
 * 主题: devices/{deviceId}/config
 */
export interface DeviceConfigRequest extends BaseMessage {
  requestId: string;
  configKeys?: string[];
}

/**
 * 设备配置响应
 * 主题: devices/{deviceId}/config/response
 */
export interface DeviceConfigResponse extends BaseMessage {
  requestId: string;
  config: {
    video?: {
      resolution?: string;
      fps?: number;
      bitrate?: number;
    };
    audio?: {
      enabled?: boolean;
      volume?: number;
    };
    network?: {
      wifiSsid?: string;
      signalStrength?: number;
    };
    [key: string]: any;
  };
}

// ==================== 设备凭证消息 ====================

/**
 * 设备凭证请求
 * 主题: devices/{deviceId}/credentials
 */
export interface DeviceCredentialsRequest extends BaseMessage {
  requestId: string;
  credentialTypes: CredentialType[] | string[];
}

/**
 * KVS 凭证
 */
export interface KVSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: number;
}

/**
 * 设备凭证响应
 * 主题: devices/{deviceId}/credentials/response
 */
export interface DeviceCredentialsResponse extends BaseMessage {
  requestId: string;
  credentials: {
    kvs?: KVSCredentials;
    mqtt?: {
      broker: string;
      port: number;
      clientId: string;
    };
    cloud?: {
      endpoint: string;
      tokenExpiry: number;
    };
  };
}

// ==================== Matter 协议消息 ====================

/**
 * Matter 集群类型
 */
export type MatterCluster =
  | 'OnOff'
  | 'LevelControl'
  | 'TemperatureMeasurement'
  | 'PressureMeasurement'
  | 'FlowMeasurement'
  | 'IlluminanceMeasurement'
  | 'TemperatureControl';

/**
 * Matter 属性上报
 * 主题: matter/{nodeId}/attribute
 */
export interface MatterAttributeMessage {
  nodeId: number;
  endpoint: number;
  cluster: MatterCluster | string;
  attribute: string;
  value: any;
  timestamp: number;
}

/**
 * Matter 命令
 * 主题: matter/{nodeId}/command
 */
export interface MatterCommandMessage {
  nodeId: number;
  endpoint: number;
  cluster: MatterCluster | string;
  command: string;
  args?: Record<string, any>;
  timestamp: number;
}

// ==================== 录制相关消息 ====================

/**
 * 摄像头请求上传URL
 * 主题: devices/{deviceId}/recording/upload-url
 */
export interface RecordingUploadUrlMqttRequest extends BaseMessage {
  requestId: string;
  estimatedSize?: number;
  contentType?: string;
  startTime?: string;
}

/**
 * 摄像头请求分片上传
 * 主题: devices/{deviceId}/recording/multipart/start
 */
export interface RecordingMultipartStartMqttRequest extends BaseMessage {
  requestId: string;
  estimatedSize: number;
  partCount: number;
  contentType?: string;
  startTime?: string;
}

/**
 * 摄像头完成分片上传
 * 主题: devices/{deviceId}/recording/multipart/complete
 */
export interface RecordingMultipartCompleteMqttRequest extends BaseMessage {
  requestId: string;
  recordingId: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
  fileSize: number;
  endTime?: string;
}

/**
 * 摄像头确认单次上传完成
 * 主题: devices/{deviceId}/recording/register
 */
export interface RecordingRegisterMqttRequest extends BaseMessage {
  requestId: string;
  fileKey: string;
  fileSize: number;
  endTime?: string;
}

// ==================== 批量录制消息 ====================

/**
 * 摄像头批量请求上传URL
 * 主题: devices/{deviceId}/recording/upload-url/batch
 */
export interface RecordingBatchUploadUrlMqttRequest extends BaseMessage {
  requestId: string;
  planId: string;
  segmentDuration: number;
  segmentCount: number;
  startSegmentIndex: number;
  startTime: string;
  contentType?: string;
}

/**
 * 摄像头批量确认上传完成
 * 主题: devices/{deviceId}/recording/register/batch
 */
export interface RecordingBatchRegisterMqttRequest extends BaseMessage {
  requestId: string;
  planId: string;
  completedSegments: Array<{
    segmentIndex: number;
    fileKey: string;
    fileSize: number;
    endTime?: string;
  }>;
}

// ==================== OTA 固件升级消息 ====================

/**
 * 设备OTA进度上报
 * 主题: devices/{deviceId}/ota/progress
 */
export interface OTAProgressMessage extends BaseMessage {
  taskId: string;
  progress: number;   // 0-100
  status: 'downloading' | 'installing';
}

/**
 * 设备OTA结果上报
 * 主题: devices/{deviceId}/ota/result
 */
export interface OTAResultMessage extends BaseMessage {
  taskId: string;
  success: boolean;
  error?: string;
  version?: string;
}

// ==================== 设备日志消息 ====================

/**
 * 设备请求日志上传URL
 * 主题: devices/{deviceId}/logs/upload-url
 */
export interface LogUploadUrlMqttRequest extends BaseMessage {
  requestId: string;
  estimatedSize?: number;
  logType?: string;
  description?: string;
}

/**
 * 设备确认日志上传完成
 * 主题: devices/{deviceId}/logs/register
 */
export interface LogRegisterMqttRequest extends BaseMessage {
  requestId: string;
  logId: string;
  fileKey: string;
  fileSize: number;
}

/**
 * 设备上报日志打捞结果
 * 主题: devices/{deviceId}/logs/collect/status
 */
export interface LogCollectStatusMqttMessage extends BaseMessage {
  taskId: string;
  status: 'uploading' | 'completed' | 'failed';
  fileSize?: number;
  error?: string;
}

// ==================== 网关转发消息格式 ====================

/**
 * 网关转发给 device-service 的消息格式
 */
export interface GatewayServiceMessage<T = any> {
  type: GatewayMessageType;
  data: T & {
    _meta: {
      topic: string;
      timestamp: number;
      source: 'device-gateway';
    };
  };
}

/**
 * 网关消息类型
 */
export enum GatewayMessageType {
  // 设备生命周期
  DEVICE_REGISTER = 'device.register',
  DEVICE_AUTH = 'device.auth',
  DEVICE_HEARTBEAT = 'device.heartbeat',
  DEVICE_ONLINE = 'device.online',
  DEVICE_OFFLINE = 'device.offline',

  // 设备数据上报
  DEVICE_STATUS = 'device.status',
  DEVICE_REPORT = 'device.report',
  DEVICE_EVENT = 'device.event',

  // 设备命令
  DEVICE_COMMAND_RESPONSE = 'device.command_response',

  // 设备配置
  DEVICE_CONFIG_REQUEST = 'device.config_request',
  DEVICE_CONFIG_RESPONSE = 'device.config_response',

  // 设备凭证
  DEVICE_CREDENTIALS_REQUEST = 'device.credentials_request',
  DEVICE_CREDENTIALS_RESPONSE = 'device.credentials_response',

  // Matter 协议
  MATTER_ATTRIBUTE = 'matter.attribute',
  MATTER_COMMAND = 'matter.command',

  // 录制管理
  RECORDING_UPLOAD_URL_REQUEST = 'recording.upload_url_request',
  RECORDING_MULTIPART_START_REQUEST = 'recording.multipart_start_request',
  RECORDING_MULTIPART_COMPLETE_REQUEST = 'recording.multipart_complete_request',
  RECORDING_REGISTER_REQUEST = 'recording.register_request',

  // 录制管理 - 批量
  RECORDING_BATCH_UPLOAD_URL_REQUEST = 'recording.batch_upload_url_request',
  RECORDING_BATCH_REGISTER_REQUEST = 'recording.batch_register_request',

  // OTA 固件升级
  OTA_PROGRESS = 'device.ota_progress',
  OTA_RESULT = 'device.ota_result',

  // 设备日志
  LOG_UPLOAD_URL_REQUEST = 'log.upload_url_request',
  LOG_REGISTER_REQUEST = 'log.register_request',
  LOG_COLLECT_STATUS = 'log.collect_status',
}

// ==================== 服务下发命令消息格式 ====================

/**
 * 服务下发到网关的命令类型
 */
export enum ServiceCommandType {
  // 设备命令
  SEND_DEVICE_COMMAND = 'gateway.send_command',

  // 凭证相关
  SEND_CREDENTIALS_RESPONSE = 'gateway.send_credentials_response',

  // 配置相关
  SEND_CONFIG_RESPONSE = 'gateway.send_config_response',

  // 注册响应
  SEND_REGISTER_RESPONSE = 'gateway.send_register_response',

  // 状态请求
  SEND_STATUS_REQUEST = 'gateway.send_status_request',

  // OTA 固件升级命令
  SEND_OTA_COMMAND = 'gateway.send_ota_command',

  // 日志打捞命令
  SEND_COLLECT_LOGS_COMMAND = 'gateway.send_collect_logs_command',
}

/**
 * 服务下发命令基础接口
 */
export interface ServiceCommandBase {
  type: ServiceCommandType;
  deviceId: string;
  timestamp: number;
}

/**
 * 下发设备凭证响应命令
 * device-service -> device-gateway
 */
export interface SendCredentialsResponseCommand extends ServiceCommandBase {
  type: ServiceCommandType.SEND_CREDENTIALS_RESPONSE;
  requestId: string;
  credentials: DeviceCredentialsResponse['credentials'];
}

/**
 * 下发设备命令
 * device-service -> device-gateway
 */
export interface SendDeviceCommandCommand extends ServiceCommandBase {
  type: ServiceCommandType.SEND_DEVICE_COMMAND;
  command: string;
  commandId: string;
  data?: Record<string, any>;
}

/**
 * 下发设备配置响应命令
 * device-service -> device-gateway
 */
export interface SendConfigResponseCommand extends ServiceCommandBase {
  type: ServiceCommandType.SEND_CONFIG_RESPONSE;
  requestId: string;
  config: DeviceConfigResponse['config'];
}

/**
 * 下发设备注册响应命令
 * device-service -> device-gateway
 */
export interface SendRegisterResponseCommand extends ServiceCommandBase {
  type: ServiceCommandType.SEND_REGISTER_RESPONSE;
  code: number; // 0: 成功, -1: 失败
}

/**
 * 下发OTA升级命令
 * device-service -> device-gateway
 */
export interface SendOTACommandCommand extends ServiceCommandBase {
  type: ServiceCommandType.SEND_OTA_COMMAND;
  action: 'ota_download' | 'ota_install' | 'ota_cancel' | 'ota_pause' | 'ota_resume' | 'reboot';
  taskId: string;
  payload?: Record<string, any>;
}

/**
 * 下发日志打捞命令
 * device-service -> device-gateway
 */
export interface SendCollectLogsCommand extends ServiceCommandBase {
  type: ServiceCommandType.SEND_COLLECT_LOGS_COMMAND;
  taskId: string;
  logType: string;
  uploadUrl: string;
  fileKey: string;
  expiresAt: string;
  description?: string;
}

/**
 * 服务命令联合类型
 */
export type ServiceCommand =
  | SendCredentialsResponseCommand
  | SendDeviceCommandCommand
  | SendConfigResponseCommand
  | SendRegisterResponseCommand
  | SendOTACommandCommand
  | SendCollectLogsCommand;

// ==================== 工具函数 ====================

/**
 * 生成命令ID
 */
export function generateCommandId(): string {
  return `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 生成请求ID
 */
export function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
