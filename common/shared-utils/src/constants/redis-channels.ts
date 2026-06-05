/**
 * Redis频道常量定义
 * 用于服务间消息通信，采用统一的命名规范
 *
 * 命名规范:
 * - device:{type}:{direction}:{deviceId} - 设备相关消息
 * - device:telemetry:{deviceId} - 设备遥测数据（存储用）
 * - service:{service-name} - 服务间通信
 */

// ==================== 设备状态相关频道 ====================
/**
 * 设备状态遥测数据
 * 用于存储设备上报的状态数据
 */
export const DEVICE_TELEMETRY_CHANNEL = (deviceId: string) =>
  `device:telemetry:${deviceId}`;

// ==================== 设备事件相关频道 ====================
/**
 * 设备事件上报
 * 设备上报事件（如：哭声检测、运动检测等）
 */
export const DEVICE_EVENT_CHANNEL = (deviceId: string) =>
  `device:event:${deviceId}`;

// ==================== 服务间通信频道 ====================
/**
 * 设备服务频道
 * 用于向设备服务发送通知
 */
export const DEVICE_SERVICE_CHANNEL = 'service:device-service';

/**
 * 控制服务频道
 * 用于向控制服务发送通知
 */
export const CONTROL_SERVICE_CHANNEL = 'service:control-service';

// ==================== 消息类型常量 ====================
/**
 * 设备服务消息类型
 */
export enum DeviceServiceMessageType {
  /** 设备状态请求 */
  DEVICE_STATUS_REQUEST = 'device.status.request',
  /** 设备配置请求 */
  DEVICE_CONFIG_REQUEST = 'device.config.request',
  /** 设备状态响应 */
  DEVICE_STATUS = 'device.status',
  /** 设备配置响应 */
  DEVICE_CONFIG_RESPONSE = 'device.config.response',
}

/**
 * 控制服务消息类型
 */
export enum ControlServiceMessageType {
  /** 设备控制请求 */
  DEVICE_CONTROL_REQUEST = 'device.control.request',
  /** 设备控制响应 */
  DEVICE_CONTROL_RESPONSE = 'device.control.response',
}
