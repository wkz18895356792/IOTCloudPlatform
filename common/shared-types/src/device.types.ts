/**
 * Device Service - 扩展类型定义
 * 包含设备分组、分享、场景自动化、定时任务、标签、位置、维保、统计、告警、固件管理和事件日志等相关类型
 */

// ============ 设备分组 ============
/**
 * 设备分组类型枚举
 * 定义设备的不同分组方式，便于用户管理和组织设备
 */
export enum DeviceGroupType {
  /** 房间分组 - 按物理位置（如客厅、卧室）分组 */
  ROOM = 'room',
  /** 自定义分组 - 用户自定义的任意分组方式 */
  CUSTOM = 'custom',
  /** 收藏分组 - 用户常用的设备收藏夹 */
  FAVORITE = 'favorite',
}

/**
 * 设备分组
 * 将多个设备组织在一起，便于批量管理和快速访问
 */
export interface DeviceGroup {
  /** 分组唯一标识ID */
  id: string;
  /** 所属用户ID */
  userId: string;
  /** 分组名称 */
  name: string;
  /** 分组类型 */
  type: DeviceGroupType;
  /** 分组图标（可选） */
  icon?: string;
  /** 分组颜色标识（可选） */
  color?: string;
  /** 显示顺序 */
  order: number;
  /** 分组内的设备ID列表 */
  deviceIds: string[];
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 设备分享 ============
/**
 * 设备分享权限枚举
 * 定义被分享用户对设备的操作权限级别
 */
export enum DeviceSharePermission {
  /** 只读 - 仅可查看设备状态，不可控制 */
  VIEW = 'view',
  /** 可控制 - 可查看状态并发送控制命令 */
  CONTROL = 'control',
  /** 可管理 - 可控制设备并管理分享权限 */
  MANAGE = 'manage',
  /** 所有者 - 设备所有者，拥有全部权限 */
  OWNER = 'owner',
}

/**
 * 设备分享记录
 * 记录设备在用户之间的分享关系和权限
 */
export interface DeviceShare {
  /** 分享记录唯一标识ID */
  id: string;
  /** 被分享的设备ID */
  deviceId: string;
  /** 分享发起人ID（设备所有者） */
  fromUserId: string;
  /** 分享接收人ID */
  toUserId: string;
  /** 分享的权限级别 */
  permission: DeviceSharePermission;
  /** 分享过期时间（可选），过期后权限自动失效 */
  expiresAt?: Date;
  /** 分享状态 */
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  /** 分享创建时间 */
  createdAt: Date;
  /** 接受时间 - 接收人接受分享的时间（可选） */
  acceptedAt?: Date;
}

// ============ 场景和自动化 ============
/**
 * 场景类型枚举
 * 定义场景的触发方式
 */
export enum SceneType {
  /** 手动场景 - 用户主动触发的场景 */
  MANUAL = 'manual',
  /** 自动化场景 - 由条件自动触发的场景 */
  AUTOMATION = 'automation',
  /** 定时场景 - 按时间计划执行的场景 */
  SCHEDULE = 'schedule',
  /** 触发场景 - 由特定事件触发的场景 */
  TRIGGER = 'trigger',
}

/**
 * 场景
 * 定义一组设备动作的集合，可手动执行或自动触发
 */
export interface Scene {
  /** 场景唯一标识ID */
  id: string;
  /** 所属用户ID */
  userId: string;
  /** 场景名称 */
  name: string;
  /** 场景图标（可选） */
  icon?: string;
  /** 场景类型 */
  type: SceneType;
  /** 是否启用 - 自动化场景需要启用后才会执行 */
  enabled: boolean;
  /** 触发条件列表 - 自动化场景的条件定义（可选） */
  conditions?: SceneCondition[];
  /** 执行动作列表 - 场景触发时要执行的设备操作 */
  actions: SceneAction[];
  /** 显示顺序 */
  order: number;
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

/**
 * 场景触发条件
 * 定义自动化场景的触发条件
 */
export interface SceneCondition {
  /** 条件类型 */
  type: 'time' | 'device_state' | 'device_attribute' | 'location' | 'weather';
  /** 关联的设备ID（设备相关条件时必填） */
  deviceId?: string;
  /** 设备属性名称（如 temperature、brightness 等） */
  property?: string;
  /** 属性值（用于比较的值） */
  attribute?: string;
  /** 比较操作符 - 支持新旧格式 */
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le' | 'in' | 'contains' | '==' | '!=' | '>' | '<' | '>=' | '<=';
  /** 比较值 */
  value: any;
  // ============ 时间条件特定字段 ============
  /** 具体时间 - 格式 HH:mm */
  time?: string;
  /** 小时 - 0-23 */
  hour?: number;
  /** 分钟 - 0-59 */
  minute?: number;
  /** 具体日期 - 格式 YYYY-MM-DD */
  date?: string;
  /** 星期几 - 0-6（0=周日，6=周六） */
  weekdays?: number[];
  /** Cron 表达式 - 用于复杂的定时规则 */
  cronExpression?: string;
  /** 是否重复执行 */
  repeat?: boolean;
  /** 时区 */
  timezone?: string;
  // ============ 位置条件特定字段 ============
  /** 位置名称或坐标 */
  location?: string;
}

/**
 * 场景执行动作
 * 定义场景中要对设备执行的具体操作
 */
export interface SceneAction {
  /** 目标设备ID */
  deviceId: string;
  /** 动作类型 - 如 setAttributes、execute、toggle 等 */
  action: string;
  /** 动作参数 - 键值对形式的参数列表 */
  params: Record<string, any>;
  /** 延迟执行时间 - 单位毫秒（可选） */
  delay?: number;
}

// ============ 定时任务 ============
/**
 * 设备定时任务
 * 定义按时间计划自动执行的设备操作
 */
export interface DeviceSchedule {
  /** 定时任务唯一标识ID */
  id: string;
  /** 所属用户ID */
  userId: string;
  /** 关联的设备ID */
  deviceId: string;
  /** 任务名称 */
  name: string;
  /** 是否启用 */
  enabled: boolean;
  /** Cron 表达式 - 定义定时规则（可选） */
  cronExpression?: string;
  /** 要执行的动作列表 */
  actions: SceneAction[];
  /** 时区（可选） */
  timezone?: string;
  /** 下次执行时间（可选） */
  nextRunAt?: Date;
  /** 上次执行时间（可选） */
  lastRunAt?: Date;
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 设备标签 ============
/**
 * 设备标签
 * 用于对设备进行分类和标记，便于筛选和搜索
 */
export interface DeviceTag {
  /** 标签唯一标识ID */
  id: string;
  /** 所属用户ID */
  userId: string;
  /** 标签名称 */
  name: string;
  /** 标签颜色（可选） */
  color?: string;
  /** 使用该标签的设备ID列表 */
  deviceIds: string[];
  /** 创建时间 */
  createdAt: Date;
}

// ============ 设备位置 ============
/**
 * 设备位置
 * 定义设备的物理位置信息，支持层级结构
 */
export interface DeviceLocation {
  /** 位置唯一标识ID */
  id: string;
  /** 所属用户ID */
  userId: string;
  /** 位置名称 */
  name: string;
  /** 位置类型 */
  type: 'room' | 'area' | 'building';
  /** 父位置ID - 支持层级结构，如楼栋 > 楼层 > 房间（可选） */
  parentLocationId?: string;
  /** 显示顺序 */
  order: number;
  /** 位置图标（可选） */
  icon?: string;
  /** 该位置下的设备ID列表 */
  deviceIds: string[];
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 维保记录 ============
/**
 * 维保类型枚举
 * 定义设备的维护保养操作类型
 */
export enum MaintenanceType {
  /** 例行保养 - 定期常规检查和保养 */
  ROUTINE = 'routine',
  /** 维修 - 设备故障修复 */
  REPAIR = 'repair',
  /** 更换 - 零部件或整机更换 */
  REPLACEMENT = 'replacement',
  /** 校准 - 设备精度校准 */
  CALIBRATION = 'calibration',
}

/**
 * 维保记录
 * 记录设备的维护保养历史
 */
export interface MaintenanceRecord {
  /** 维保记录唯一标识ID */
  id: string;
  /** 关联的设备ID */
  deviceId: string;
  /** 维保类型 */
  type: MaintenanceType;
  /** 维保标题 */
  title: string;
  /** 详细描述（可选） */
  description?: string;
  /** 维保费用（可选） */
  cost?: number;
  /** 执行时间（可选） */
  performedAt?: Date;
  /** 执行人（可选） */
  performedBy?: string;
  /** 下次维保计划时间（可选） */
  nextMaintenanceAt?: Date;
  /** 附件列表 - 如照片、文档等（可选） */
  attachments?: string[];
  /** 记录创建时间 */
  createdAt: Date;
}

// ============ 设备统计 ============
/**
 * 设备统计数据
 * 汇总设备的运行数据和性能指标
 */
export interface DeviceStatistics {
  /** 关联的设备ID */
  deviceId: string;
  /** 总运行时长 - 单位小时 */
  totalUptime: number;
  /** 在线率 - 百分比 */
  onlineRate: number;
  /** 平均响应时间 - 单位毫秒 */
  avgResponseTime: number;
  /** 命令执行次数 */
  commandCount: number;
  /** 错误次数 */
  errorCount: number;
  /** 上次维保时间（可选） */
  lastMaintenanceAt?: Date;
  /** 固件更新次数 */
  firmwareUpdateCount: number;
}

// ============ 设备告警 ============
/**
 * 设备告警级别枚举
 * 定义告警的严重程度
 */
export enum DeviceAlertLevel {
  /** 信息 - 一般性通知 */
  INFO = 'info',
  /** 警告 - 需要注意但不影响使用 */
  WARNING = 'warning',
  /** 错误 - 功能异常需要处理 */
  ERROR = 'error',
  /** 严重 - 紧急问题需要立即处理 */
  CRITICAL = 'critical',
}

/**
 * 设备告警
 * 记录设备产生的告警信息
 */
export interface DeviceAlert {
  /** 告警唯一标识ID */
  id: string;
  /** 关联的设备ID */
  deviceId: string;
  /** 告警类型 - 用于分类和筛选 */
  type: string;
  /** 告警级别 */
  level: DeviceAlertLevel;
  /** 告警标题 */
  title: string;
  /** 告警详细消息 */
  message: string;
  /** 告警附加数据（可选） */
  data?: Record<string, any>;
  /** 是否已确认 */
  acknowledged: boolean;
  /** 确认人ID（可选） */
  acknowledgedBy?: string;
  /** 确认时间（可选） */
  acknowledgedAt?: Date;
  /** 告警产生时间 */
  createdAt: Date;
}

// ============ 固件管理 ============
/**
 * 固件版本信息
 * 记录设备固件的版本信息和下载地址
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
  /** 固件文件下载URL */
  fileUrl: string;
  /** 文件大小 - 单位字节 */
  fileSize: number;
  /** 文件校验和 - 用于验证文件完整性 */
  checksum: string;
  /** 校验和类型 */
  checksumType: 'md5' | 'sha256';
  /** 是否强制更新 - 强制更新会自动推送并安装 */
  isForced: boolean;
  /** 是否为测试版本 - Beta版本通常不推送 */
  isBeta: boolean;
  /** 最低可升级版本 - 低于此版本的设备才能升级（可选） */
  minVersion?: string;
  /** 最高可升级版本 - 高于此版本的设备不能升级（可选） */
  maxVersion?: string;
  /** 上传时间 */
  uploadedAt: Date;
}

/**
 * OTA（Over-The-Air）升级任务
 * 记录设备固件升级的任务状态
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
  status: 'pending' | 'downloading' | 'installing' | 'completed' | 'failed' | 'rolled_back';
  /** 升级进度 - 0-100 */
  progress: number;
  /** 错误信息 - 失败时记录（可选） */
  error?: string;
  /** 升级开始时间（可选） */
  startedAt?: Date;
  /** 升级完成时间（可选） */
  completedAt?: Date;
  /** 创建人ID - 发起升级的用户（可选） */
  createdBy?: string;
  /** 任务创建时间 */
  createdAt: Date;
}

// ============ 设备事件日志 ============
/**
 * 设备事件类型枚举
 * 用于记录设备生命周期中的各类事件，便于追踪、审计和故障排查
 */
export enum DeviceEventType {
  /** 设备上线 - 设备连接到系统，变为可用状态 */
  ONLINE = 'online',
  /** 设备离线 - 设备断开连接，不可用 */
  OFFLINE = 'offline',
  /** 属性变更 - 设备属性值发生变化（如温度、亮度等） */
  PROPERTY_CHANGE = 'property_change',
  /** 状态变更 - 设备工作状态发生变化（如待机、工作中等） */
  STATUS_CHANGE = 'status_change',
  /** 错误事件 - 设备报告错误或异常 */
  ERROR = 'error',
  /** 维护事件 - 设备进行维护保养操作 */
  MAINTENANCE = 'maintenance',
  /** 固件更新 - 设备固件升级相关事件 */
  FIRMWARE_UPDATE = 'firmware_update',
  /** 分享变更 - 设备分享权限发生变化 */
  SHARED = 'shared',
  /** 场景执行 - 设备被场景/自动化触发执行 */
  SCENE_EXECUTED = 'scene_executed',
  /** 命令执行 - 向设备发送控制命令的事件 */
  COMMAND = 'command',
}

/**
 * 设备事件日志记录
 * 存储设备生命周期中的各类事件，用于审计追踪和问题排查
 */
export interface DeviceEvent {
  /** 事件唯一标识ID */
  id: string;
  /** 关联的设备ID */
  deviceId: string;
  /** 事件类型 */
  type: DeviceEventType;
  /** 事件详细数据 - 存储事件相关的具体信息，如变更前后的值、错误详情等 */
  data?: Record<string, any>;
  /** 触发用户ID - 如果事件是由用户操作触发（如命令、分享等），记录操作人 */
  userId?: string;
  /** 事件发生时间 */
  createdAt: Date;
}
