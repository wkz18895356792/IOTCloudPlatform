/**
 * 设备注册相关类型定义
 *
 * 定义设备注册流程中MQTT Gateway与Device Service之间的通信消息格式
 * 通过Redis进行消息传递，支持注册请求的幂等性处理
 */

/**
 * MQTT协议错误码枚举
 * 与mqtt-gateway中的ErrorCode保持一致，确保错误码统一
 */
export enum MqttErrorCode {
  /** 未知错误 - 未预期的错误情况 */
  E_UNKNOWN = -1,
  /** 成功 - 操作正确执行 */
  OK = 0,
  /** 数据格式错误 - 消息格式不符合协议要求 */
  E_FORMAT = 1,
  /** 请求失败 - 请求处理失败 */
  E_REQUEST = 2,
  /** 参数错误 - 请求参数无效或缺失 */
  E_PARAMS = 3,
  /** 签名错误 - 消息签名验证失败 */
  E_SIGN = 4,
  /** 对象不存在 - 请求的资源对象不存在 */
  E_OBJECT_NULL = 101,
  /** 对象已存在 - 创建对象时唯一键冲突 */
  E_OBJECT_EXISTS = 102,
  /** 对象已被禁用 - 对象处于禁用状态 */
  E_OBJECT_ENABLE = 103,
  /** 对象不支持当前操作 - 对象类型不支持该操作 */
  E_OBJECT_UNSUPPORTED = 104,
  /** 请求超时 - 请求处理超时 */
  E_TIMEOUT = 408,
  /** 服务不可用 - 服务暂时无法处理请求 */
  E_SERVICE_UNAVAILABLE = 503,
}

import { CloudProvider } from '@baby-monitor/shared-types';

/**
 * 设备注册请求消息
 * MQTT Gateway收到设备注册请求后，通过Redis转发给Device Service处理
 */
export interface DeviceRegisterRequestMessage {
  /** 请求关联ID - 用于匹配请求和响应，实现异步通信 */
  correlationId: string;
  /** 设备ID - 设备的唯一标识，用作幂等键防止重复注册 */
  deviceId: string;
  /** 设备类型 - 1表示摄像头，2表示屏幕 */
  type: 1 | 2;
  /** 设备型号 - 如 E73 */
  deviceType?: string;
  /** 云服务商 */
  cloudProvider: CloudProvider;
  /** 用户ID - 设备已绑定的用户（可选） */
  userId?: string;
  /** 请求时间戳 - Unix时间戳 */
  timestamp: number;
}

/**
 * IoT Video 设备三元组信息
 * 设备在腾讯云 IoT Video 平台的身份标识
 */
export interface IoTVideoTripleInfo {
  /** 产品 ID */
  productId: string;
  /** 设备名称 */
  deviceName: string;
  /** 设备密钥 */
  deviceSecret: string;
}

/**
 * 设备注册响应消息
 * Device Service处理完注册请求后，通过Redis返回给MQTT Gateway
 */
export interface DeviceRegisterResponseMessage {
  /** 对应的请求关联ID - 与请求消息中的correlationId匹配 */
  correlationId: string;
  /** 响应状态码 */
  code: MqttErrorCode;
  /** 设备数据库ID - 注册成功后生成的数据库记录ID（可选） */
  deviceId?: string;
  /** 错误消息 - 注册失败时的错误描述（可选） */
  message?: string;
  /** 设备序列号 - 系统生成的序列号（可选） */
  serialNumber?: string;
  /** IoT Video 三元组信息 - 仅 cloudProvider=2 时返回（可选） */
  tripleInfo?: IoTVideoTripleInfo;
  /** 响应时间戳 - Unix时间戳 */
  timestamp: number;
  /** 是否来自缓存 - true表示返回的是缓存的响应，用于幂等性处理（可选） */
  cached?: boolean;
}

/**
 * 注册缓存条目
 * 存储在Redis中的设备注册响应缓存，用于实现幂等性
 * 当同一设备重复发送注册请求时，直接返回缓存结果
 */
export interface RegistrationCacheEntry {
  /** 缓存的响应消息 - 完整的注册响应数据 */
  response: DeviceRegisterResponseMessage;
  /** 缓存创建时间 - Unix时间戳，用于判断缓存是否过期 */
  createdAt: number;
}
