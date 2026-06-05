/**
 * Baby Service - 类型定义
 * 婴儿看护场景相关的类型定义，包括宝宝档案、喂养、睡眠、成长记录、健康事件、监控等
 */

// ============ 统一日志事件类型 ============
/**
 * 统一的宝宝日志事件类型枚举
 * 只保留核心的 5 种事件类型
 */
export enum BabyLogEventType {
  /** 母乳喂养 */
  BREAST_FEEDING = 'breast_feeding',
  /** 奶粉喂养 */
  BOTTLE_FEEDING = 'bottle_feeding',
  /** 睡眠 */
  SLEEP = 'sleep',
  /** 换尿布 */
  DIAPER_CHANGE = 'diaper_change',
  /** 翻身 */
  ROLL_OVER = 'roll_over',
}

/**
 * 日志数据来源枚举
 */
export enum BabyLogSource {
  /** 用户手动添加 */
  MANUAL = 'manual',
  /** 算法自动检测 */
  ALGORITHM = 'algorithm',
  /** 设备自动记录 */
  DEVICE = 'device',
}

/**
 * 监控事件级别枚举
 */
export enum BabyLogLevel {
  /** 信息 - 一般性通知 */
  INFO = 'info',
  /** 警告 - 需要关注 */
  WARNING = 'warning',
  /** 告警 - 需要及时处理 */
  ALERT = 'alert',
  /** 紧急 - 需要立即处理 */
  EMERGENCY = 'emergency',
}

/**
 * 统一的宝宝日志接口
 * 整合了所有类型的宝宝事件记录
 */
export interface BabyLog {
  /** 日志唯一ID */
  id: string;
  /** 宝宝ID */
  babyId: string;
  /** 关联设备ID（可选） - 如监控摄像头、智能设备等 */
  deviceId?: string;
  /** 事件唯一标识(UUID格式) - 防止重复记录 */
  eventId: string;
  /** 事件类型 */
  eventType: BabyLogEventType;
  /** 事件开始时间 */
  startTime: Date;
  /** 事件结束时间（可选） - 持续性事件需要记录 */
  endTime?: Date;
  /** 事件持续时长 - 单位秒（可选） */
  duration?: number;
  /** 事件发生所在时区（如 Asia/Shanghai） */
  timezone?: string;
  /** 数据来源 */
  source: BabyLogSource;
  /** 事件级别 - 主要用于监控事件 */
  level?: BabyLogLevel;
  /** S3视频文件存储路径（可选） */
  videoPath?: string;
  /** 事件在视频中的时间偏移量 - 单位秒，用于视频跳转定位（可选） */
  videoTimestamp?: number;
  /** 缩略图URL（可选） */
  thumbnailUrl?: string;
  /** 算法识别置信度 - 取值范围 0-1（可选） */
  confidence?: number;
  /** 用户备注信息（可选） */
  note?: string;
  /** 事件附加信息 - 根据不同事件类型存储特定属性（可选） */
  metadata?: Record<string, any>;
  /** 是否已确认 - 用于监控事件（可选） */
  acknowledged?: boolean;
  /** 确认人ID（可选） */
  acknowledgedBy?: string;
  /** 确认时间（可选） */
  acknowledgedAt?: Date;
  /** 记录人ID（可选） */
  recordedBy?: string;
  /** 记录创建时间 */
  createdAt: Date;
  /** 记录更新时间 */
  updatedAt: Date;
}

/**
 * 创建宝宝日志请求接口
 */
export interface CreateBabyLogRequest {
  /** 宝宝ID */
  babyId: string;
  /** 关联设备ID（可选） */
  deviceId?: string;
  /** 事件唯一标识(UUID格式) - 防止重复记录（可选） */
  eventId?: string;
  /** 事件类型 */
  eventType: BabyLogEventType;
  /** 事件开始时间 */
  startTime: Date | string;
  /** 事件结束时间（可选） */
  endTime?: Date | string;
  /** 时区（可选） */
  timezone?: string;
  /** 数据来源 */
  source?: BabyLogSource;
  /** 事件级别（可选） */
  level?: BabyLogLevel;
  /** 视频路径（可选） */
  videoPath?: string;
  /** 视频时间偏移（可选） */
  videoTimestamp?: number;
  /** 缩略图URL（可选） */
  thumbnailUrl?: string;
  /** 置信度（可选） */
  confidence?: number;
  /** 备注（可选） */
  note?: string;
  /** 附加信息（可选） */
  metadata?: Record<string, any>;
  /** 记录人ID（可选） */
  recordedBy?: string;
}

/**
 * 更新宝宝日志请求接口
 */
export interface UpdateBabyLogRequest {
  /** 事件结束时间（可选） */
  endTime?: Date | string;
  /** 备注（可选） */
  note?: string;
  /** 附加信息（可选） */
  metadata?: Record<string, any>;
  /** 是否已确认（可选） */
  acknowledged?: boolean;
}

/**
 * 宝宝日志查询参数接口
 */
export interface BabyLogQueryParams {
  /** 宝宝ID */
  babyId: string;
  /** 事件类型列表（可选） */
  eventTypes?: BabyLogEventType[];
  /** 开始日期（可选） */
  startDate?: Date;
  /** 结束日期（可选） */
  endDate?: Date;
  /** 数据来源（可选） */
  source?: BabyLogSource;
  /** 是否已确认（可选） */
  acknowledged?: boolean;
  /** 页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
}

// ============ 宝宝档案 ============
/**
 * 宝宝性别枚举
 */
export enum BabyGender {
  /** 男 */
  MALE = 'male',
  /** 女 */
  FEMALE = 'female',
}

/**
 * 宝宝状态枚举
 */
export enum BabyStatus {
  /** 活跃 - 正常使用中 */
  ACTIVE = 'active',
  /** 未激活 - 档案创建后未启用 */
  INACTIVE = 'inactive',
  /** 已归档 - 不再使用的旧档案 */
  ARCHIVED = 'archived',
}

/**
 * 宝宝档案
 * 记录宝宝的基本信息和档案
 */
export interface Baby {
  /** 宝宝唯一标识ID */
  id: string;
  /** 所属用户ID */
  userId: string;
  /** 宝宝昵称 */
  name: string;
  /** 性别 */
  gender: BabyGender;
  /** 出生日期 */
  birthDate: Date;
  /** 出生体重 - 单位克（可选） */
  birthWeight?: number;
  /** 出生身高 - 单位厘米（可选） */
  birthHeight?: number;
  /** 预产期 - 针对早产儿（可选） */
  dueDate?: Date;
  /** 头像URL（可选） */
  avatar?: string;
  /** 档案状态 */
  status: BabyStatus;
  /** 关联设备ID列表 - 如监控摄像头等（可选） */
  deviceIds?: string[];
  /** 档案创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 喂养记录 ============
/**
 * 喂养类型枚举
 */
export enum FeedingType {
  /** 母乳 */
  BREAST_MILK = 'breast_milk',
  /** 奶粉 */
  FORMULA = 'formula',
  /** 辅食 */
  SOLID_FOOD = 'solid_food',
  /** 混合喂养 */
  MIXED = 'mixed',
}

/**
 * 喂奶侧枚举
 * 用于母乳喂养记录
 */
export enum FeedingSide {
  /** 左侧 */
  LEFT = 'left',
  /** 右侧 */
  RIGHT = 'right',
  /** 双侧 */
  BOTH = 'both',
}

/**
 * 喂养记录
 */
export interface FeedingLog {
  /** 记录唯一ID */
  id: string;
  /** 宝宝ID */
  babyId: string;
  /** 喂养类型 */
  type: FeedingType;
  /** 开始时间 */
  startTime: Date;
  /** 结束时间（可选） */
  endTime?: Date;
  /** 喂养时长 - 单位分钟（可选） */
  duration?: number;
  /** 喂奶量 - 单位毫升（可选） */
  amount?: number;
  /** 喂奶侧 - 母乳喂养时使用（可选） */
  breastSide?: FeedingSide;
  /** 备注（可选） */
  notes?: string;
  /** 记录人ID */
  recordedBy: string;
  /** 记录设备ID - 如智能奶瓶（可选） */
  recordingDeviceId?: string;
  /** 记录创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 换尿布记录 ============
/**
 * 尿布类型枚举
 */
export enum DiaperType {
  /** 尿湿 */
  WET = 'wet',
  /** 便便 */
  DIRTY = 'dirty',
  /** 混合 - 尿湿且有便便 */
  MIXED = 'mixed',
  /** 干爽 - 检查时是干的 */
  DRY = 'dry',
}

/**
 * 换尿布记录
 */
export interface DiaperLog {
  /** 记录唯一ID */
  id: string;
  /** 宝宝ID */
  babyId: string;
  /** 尿布类型 */
  type: DiaperType;
  /** 换尿布时间 */
  time: Date;
  /** 颜色描述（可选） */
  color?: string;
  /** 质地描述（可选） */
  texture?: string;
  /** 备注（可选） */
  notes?: string;
  /** 记录人ID */
  recordedBy: string;
  /** 记录创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 睡眠记录 ============
/**
 * 睡眠类型枚举
 */
export enum SleepType {
  /** 小睡 - 白天短时间睡眠 */
  NAP = 'nap',
  /** 夜间睡眠 - 晚上长时间睡眠 */
  NIGHT = 'night',
}

/**
 * 睡眠记录
 */
export interface SleepLog {
  /** 记录唯一ID */
  id: string;
  /** 宝宝ID */
  babyId: string;
  /** 睡眠类型 */
  type: SleepType;
  /** 入睡时间 */
  startTime: Date;
  /** 醒来时间（可选） */
  endTime?: Date;
  /** 睡眠时长 - 单位分钟（可选） */
  duration?: number;
  /** 睡眠质量（可选） */
  quality?: 'excellent' | 'good' | 'fair' | 'poor';
  /** 夜醒次数 - 夜间睡眠时（可选） */
  wokeUpTimes?: number;
  /** 备注（可选） */
  notes?: string;
  /** 记录人ID */
  recordedBy: string;
  /** 记录创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 成长记录 ============
/**
 * 成长记录类型枚举
 */
export enum GrowthRecordType {
  /** 体重 */
  WEIGHT = 'weight',
  /** 身高 */
  HEIGHT = 'height',
  /** 头围 */
  HEAD_CIRCUMFERENCE = 'head_circumference',
  /** 体温 */
  TEMPERATURE = 'temperature',
}

/**
 * 成长记录
 */
export interface GrowthRecord {
  /** 记录唯一ID */
  id: string;
  /** 宝宝ID */
  babyId: string;
  /** 记录类型 */
  type: GrowthRecordType;
  /** 测量数值 */
  value: number;
  /** 数值单位 */
  unit: string;
  /** 记录日期 */
  recordDate: Date;
  /** 备注（可选） */
  notes?: string;
  /** 记录人ID */
  recordedBy: string;
  /** 测量设备ID - 如智能体重秤（可选） */
  deviceId?: string;
  /** 记录创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 健康事件 ============
/**
 * 健康事件类型枚举
 */
export enum HealthEventType {
  /** 发热 */
  FEVER = 'fever',
  /** 感冒 */
  COLD = 'cold',
  /** 呕吐 */
  VOMITING = 'vomiting',
  /** 腹泻 */
  DIARRHEA = 'diarrhea',
  /** 皮疹 */
  RASH = 'rash',
  /** 过敏 */
  ALLERGY = 'allergy',
  /** 用药 */
  MEDICATION = 'medication',
  /** 疫苗接种 */
  VACCINATION = 'vaccination',
  /** 体检 */
  CHECKUP = 'checkup',
  /** 其他 */
  OTHER = 'other',
}

/**
 * 健康事件严重程度
 */
export enum HealthEventSeverity {
  /** 轻微 */
  MILD = 'mild',
  /** 中等 */
  MODERATE = 'moderate',
  /** 严重 */
  SEVERE = 'severe',
}

/**
 * 健康事件记录
 */
export interface HealthEvent {
  /** 记录唯一ID */
  id: string;
  /** 宝宝ID */
  babyId: string;
  /** 事件类型 */
  type: HealthEventType;
  /** 严重程度（可选） */
  severity?: HealthEventSeverity;
  /** 事件描述 */
  description: string;
  /** 症状列表（可选） */
  symptoms?: string[];
  /** 开始日期 */
  startDate: Date;
  /** 结束日期（可选） */
  endDate?: Date;
  /** 用药信息（可选） */
  medication?: string;
  /** 备注（可选） */
  notes?: string;
  /** 记录人ID */
  recordedBy: string;
  /** 记录创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 里程碑 ============
/**
 * 里程碑类别枚举
 */
export enum MilestoneCategory {
  /** 运动能力 - 如抬头、翻身、坐、爬、走 */
  MOTOR = 'motor',
  /** 语言能力 - 如咿呀学语、叫爸爸妈妈 */
  LANGUAGE = 'language',
  /** 认知能力 - 如认识物体、记忆游戏 */
  COGNITIVE = 'cognitive',
  /** 社交能力 - 如笑、认生、互动 */
  SOCIAL = 'social',
  /** 生活自理 - 如自己吃饭、穿衣 */
  SELF_CARE = 'self_care',
}

/**
 * 里程碑状态枚举
 */
export enum MilestoneStatus {
  /** 未达成 */
  NOT_ACHIEVED = 'not_achieved',
  /** 进行中 - 正在学习尝试 */
  IN_PROGRESS = 'in_progress',
  /** 已达成 */
  ACHIEVED = 'achieved',
}

/**
 * 里程碑记录
 * 记录宝宝的成长发育里程碑
 */
export interface Milestone {
  /** 记录唯一ID */
  id: string;
  /** 宝宝ID */
  babyId: string;
  /** 里程碑类别 */
  category: MilestoneCategory;
  /** 标题 */
  title: string;
  /** 详细描述（可选） */
  description?: string;
  /** 预期达成年龄 - 单位月（可选） */
  expectedAge?: number;
  /** 实际达成时间（可选） */
  achievedAt?: Date;
  /** 实际达成年龄 - 单位月（可选） */
  achievedAge?: number;
  /** 达成状态 */
  status: MilestoneStatus;
  /** 照片URL列表（可选） */
  photos?: string[];
  /** 备注（可选） */
  notes?: string;
  /** 记录人ID */
  recordedBy: string;
  /** 记录创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 监控事件 ============
/**
 * 监控事件类型枚举
 * 设备检测到的各类监控事件
 */
export enum MonitoringEventType {
  /** 哭声检测 - 检测到宝宝哭声 */
  CRYING_DETECTED = 'crying_detected',
  /** 移动检测 - 检测到画面中有物体移动 */
  MOTION_DETECTED = 'motion_detected',
  /** 人脸检测 - 检测到画面中有人脸 */
  FACE_DETECTED = 'face_detected',
  /** 无人脸 - 长时间未检测到人脸 */
  NO_FACE_DETECTED = 'no_face_detected',
  /** 噪音检测 - 检测到异常噪音 */
  NOISE_DETECTED = 'noise_detected',
  /** 温度告警 - 环境温度异常 */
  TEMPERATURE_ALERT = 'temperature_alert',
  /** 湿度告警 - 环境湿度异常 */
  HUMIDITY_ALERT = 'humidity_alert',
  /** 离开区域 - 宝宝离开设定的安全区域 */
  AREA_LEFT = 'area_left',
  /** 睡眠状态变化 - 入睡或醒来 */
  SLEEP_STATE_CHANGE = 'sleep_state_change',
}

/**
 * 监控事件级别
 */
export enum MonitoringEventLevel {
  /** 信息 - 一般性通知 */
  INFO = 'info',
  /** 警告 - 需要关注 */
  WARNING = 'warning',
  /** 告警 - 需要及时处理 */
  ALERT = 'alert',
  /** 紧急 - 需要立即处理 */
  EMERGENCY = 'emergency',
}

/**
 * 监控事件
 * 监控设备检测到的事件记录
 */
export interface MonitoringEvent {
  /** 事件唯一ID */
  id: string;
  /** 宝宝ID */
  babyId: string;
  /** 监控设备ID */
  deviceId: string;
  /** 事件类型 */
  type: MonitoringEventType;
  /** 事件级别 */
  level: MonitoringEventLevel;
  /** 事件发生时间 */
  timestamp: Date;
  /** 事件相关数据 - 如检测置信度、具体数值等（可选） */
  data?: Record<string, any>;
  /** 事件截图缩略图URL（可选） */
  thumbnailUrl?: string;
  /** 事件视频URL（可选） */
  videoUrl?: string;
  /** 是否已确认 */
  acknowledged: boolean;
  /** 确认人ID（可选） */
  acknowledgedBy?: string;
  /** 确认时间（可选） */
  acknowledgedAt?: Date;
  /** 备注（可选） */
  notes?: string;
  /** 记录创建时间 */
  createdAt: Date;
}

// ============ 提醒和日程 ============
/**
 * 提醒类型枚举
 */
export enum ReminderType {
  /** 喂奶提醒 */
  FEEDING = 'feeding',
  /** 换尿布提醒 */
  DIAPER_CHANGE = 'diaper_change',
  /** 用药提醒 */
  MEDICATION = 'medication',
  /** 体检提醒 */
  CHECKUP = 'checkup',
  /** 疫苗提醒 */
  VACCINATION = 'vaccination',
  /** 自定义提醒 */
  CUSTOM = 'custom',
}

/**
 * 提醒频率枚举
 */
export enum ReminderFrequency {
  /** 一次性 */
  ONCE = 'once',
  /** 每天重复 */
  DAILY = 'daily',
  /** 间隔重复 - 按固定间隔 */
  INTERVAL = 'interval',
  /** 自定义规则 - 如每周一、三、五 */
  CUSTOM = 'custom',
}

/**
 * 提醒
 */
export interface Reminder {
  /** 提醒唯一ID */
  id: string;
  /** 宝宝ID */
  babyId: string;
  /** 提醒类型 */
  type: ReminderType;
  /** 提醒标题 */
  title: string;
  /** 详细描述（可选） */
  description?: string;
  /** 提醒频率 */
  frequency: ReminderFrequency;
  /** 间隔时间 - 单位分钟，适用于INTERVAL频率（可选） */
  interval?: number;
  /** 计划时间 - 格式 HH:mm（可选） */
  scheduledTime?: string;
  /** 开始日期 */
  startDate: Date;
  /** 结束日期（可选） */
  endDate?: Date;
  /** 是否启用 */
  enabled: boolean;
  /** 上次触发时间（可选） */
  lastTriggeredAt?: Date;
  /** 下次触发时间（可选） */
  nextTriggerAt?: Date;
  /** 提醒设备列表 - 推送通知的设备（可选） */
  devices?: string[];
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ 统计和分析 ============
/**
 * 日汇总
 * 宝宝一天的活动汇总
 */
export interface DailySummary {
  /** 宝宝ID */
  babyId: string;
  /** 汇总日期 */
  date: Date;
  /** 喂养次数 */
  feedingCount: number;
  /** 总喂奶量 - 单位毫升 */
  feedingAmount: number;
  /** 总睡眠时长 - 单位分钟 */
  sleepDuration: number;
  /** 换尿布次数 */
  diaperChangeCount: number;
  /** 湿尿布数量 */
  wetDiapers: number;
  /** 便便尿布数量 */
  dirtyDiapers: number;
  /** 成长数据（可选） */
  growth?: {
    /** 体重 */
    weight?: number;
    /** 身高 */
    height?: number;
  };
  /** 监控事件统计 */
  monitoringEvents: {
    /** 总事件数 */
    total: number;
    /** 按类型统计 */
    byType: Record<string, number>;
  };
}

/**
 * 周报
 * 宝宝一周的活动统计报告
 */
export interface WeeklyReport {
  /** 宝宝ID */
  babyId: string;
  /** 周开始日期 */
  weekStart: Date;
  /** 周结束日期 */
  weekEnd: Date;
  /** 每日汇总列表 */
  dailySummaries: DailySummary[];
  /** 趋势分析 */
  trends: {
    /** 喂养趋势 */
    feeding: {
      /** 平均喂奶量 */
      avgAmount: number;
      /** 平均喂养频率 */
      avgFrequency: number;
    };
    /** 睡眠趋势 */
    sleep: {
      /** 平均睡眠时长 */
      avgDuration: number;
      /** 平均小睡次数 */
      avgNaps: number;
    };
    /** 成长趋势（可选） */
    growth?: {
      /** 体重增长 */
      weightGain: number;
      /** 身高增长 */
      heightIncrease: number;
    };
  };
}

/**
 * 成长百分位
 * 用于对比宝宝发育情况与标准曲线
 */
export interface GrowthPercentile {
  /** 年龄 - 单位月 */
  ageMonths: number;
  /** 体重 - 第3百分位 */
  weightP3: number;
  /** 体重 - 第15百分位 */
  weightP15: number;
  /** 体重 - 第50百分位（中位数） */
  weightP50: number;
  /** 体重 - 第85百分位 */
  weightP85: number;
  /** 体重 - 第97百分位 */
  weightP97: number;
  /** 身高 - 第3百分位 */
  heightP3: number;
  /** 身高 - 第15百分位 */
  heightP15: number;
  /** 身高 - 第50百分位（中位数） */
  heightP50: number;
  /** 身高 - 第85百分位 */
  heightP85: number;
  /** 身高 - 第97百分位 */
  heightP97: number;
}

// ============ 看护人管理 ============
/**
 * 看护人
 * 记录宝宝的其他看护人信息
 */
export interface Caregiver {
  /** 记录唯一ID */
  id: string;
  /** 宝宝ID */
  babyId: string;
  /** 看护人用户ID */
  userId: string;
  /** 关系 - 如父亲、母亲、祖父母、保姆等 */
  relationship: string;
  /** 是否为主要看护人 */
  isPrimary: boolean;
  /** 权限列表 - 定义可执行的操作 */
  permissions: string[];
  /** 添加时间 */
  createdAt: Date;
}

// ============ 导出数据 ============
/**
 * 数据导出请求
 */
export interface ExportDataRequest {
  /** 宝宝ID */
  babyId: string;
  /** 起始日期 */
  startDate: Date;
  /** 结束日期 */
  endDate: Date;
  /** 包含的数据类型 */
  includeTypes: ('feeding' | 'diaper' | 'sleep' | 'growth' | 'health' | 'milestone')[];
  /** 导出格式 */
  format: 'pdf' | 'excel' | 'json';
}

/**
 * 数据导出结果
 */
export interface ExportDataResult {
  /** 下载链接 */
  downloadUrl: string;
  /** 链接过期时间 */
  expiresAt: Date;
}
