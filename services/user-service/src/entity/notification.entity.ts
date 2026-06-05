import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 通知类型枚举
 */
export enum NotificationType {
  /** 哭声检测 */
  CRYING_DETECTED = 'crying_detected',
  /** 哭声识别 - 饿了 */
  CRYING_HUNGRY = 'crying_hungry',
  /** 哭声识别 - 求抱抱 */
  CRYING_HOLD = 'crying_hold',
  /** 哭声识别 - 换尿布 */
  CRYING_DIAPER = 'crying_diaper',
  /** 哭声识别 - 困了 */
  CRYING_SLEEPY = 'crying_sleepy',
  /** 哭声识别 - 胀气 */
  CRYING_GAS = 'crying_gas',
  /** 温度异常 */
  TEMPERATURE_ALERT = 'temperature_alert',
  /** 湿度异常 */
  HUMIDITY_ALERT = 'humidity_alert',
  /** 电子围栏 */
  GEOFENCE_ALERT = 'geofence_alert',
  /** 区域入侵 */
  AREA_INTRUSION = 'area_intrusion',
  /** 人形侦测 */
  HUMAN_DETECTED = 'human_detected',
  /** 设备离线 */
  DEVICE_OFFLINE = 'device_offline',
  /** 设备低电量 */
  LOW_BATTERY = 'low_battery',
  /** 系统通知 */
  SYSTEM_NOTIFICATION = 'system_notification',
}

/**
 * 用户通知设置实体
 *
 * 存储用户的通知偏好配置
 */
@Entity('user_notification_settings')
export class UserNotificationSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 64 })
  @Index()
  userId: string;

  // ==================== 总开关 ====================

  /**
   * 推送通知总开关
   */
  @Column({ name: 'push_enabled', type: 'boolean', default: true })
  pushEnabled: boolean;

  /**
   * 免打扰开始时间（HH:mm格式）
   */
  @Column({ name: 'dnd_start', type: 'varchar', length: 5, nullable: true })
  dndStart: string | null;

  /**
   * 免打扰结束时间（HH:mm格式）
   */
  @Column({ name: 'dnd_end', type: 'varchar', length: 5, nullable: true })
  dndEnd: string | null;

  // ==================== 哭声检测通知 ====================

  /**
   * 哭声检测通知开关
   */
  @Column({ name: 'crying_detection_enabled', type: 'boolean', default: true })
  cryingDetectionEnabled: boolean;

  /**
   * 哭声识别通知开关
   */
  @Column({ name: 'crying_recognition_enabled', type: 'boolean', default: true })
  cryingRecognitionEnabled: boolean;

  /**
   * 哭声识别分类通知（位掩码）
   * bit 0: 饿了, bit 1: 求抱抱, bit 2: 换尿布, bit 3: 困了, bit 4: 胀气
   */
  @Column({ name: 'crying_types_mask', type: 'int', default: 31 })
  cryingTypesMask: number;

  // ==================== 温湿度告警 ====================

  /**
   * 温度告警开关
   */
  @Column({ name: 'temperature_alert_enabled', type: 'boolean', default: true })
  temperatureAlertEnabled: boolean;

  /**
   * 温度下限（摄氏度）
   */
  @Column({ name: 'temp_min', type: 'decimal', precision: 4, scale: 1, default: 18 })
  tempMin: number;

  /**
   * 温度上限（摄氏度）
   */
  @Column({ name: 'temp_max', type: 'decimal', precision: 4, scale: 1, default: 28 })
  tempMax: number;

  /**
   * 湿度告警开关
   */
  @Column({ name: 'humidity_alert_enabled', type: 'boolean', default: true })
  humidityAlertEnabled: boolean;

  /**
   * 湿度下限（百分比）
   */
  @Column({ name: 'humidity_min', type: 'int', default: 30 })
  humidityMin: number;

  /**
   * 湿度上限（百分比）
   */
  @Column({ name: 'humidity_max', type: 'int', default: 70 })
  humidityMax: number;

  // ==================== 安抚设置 ====================

  /**
   * 自动播放安抚音乐开关
   */
  @Column({ name: 'auto_soothing_enabled', type: 'boolean', default: false })
  autoSoothingEnabled: boolean;

  /**
   * 自动播放音乐ID
   */
  @Column({ name: 'auto_soothing_music_id', type: 'varchar', length: 64, nullable: true })
  autoSoothingMusicId: string;

  /**
   * 自动播放最大时长（毫秒）
   */
  @Column({ name: 'auto_soothing_max_duration', type: 'int', default: 300000 })
  autoSoothingMaxDuration: number;

  // ==================== 电子围栏 ====================

  /**
   * 电子围栏通知开关
   */
  @Column({ name: 'geofence_enabled', type: 'boolean', default: false })
  geofenceEnabled: boolean;

  /**
   * 围栏半径（米）
   */
  @Column({ name: 'geofence_radius', type: 'int', default: 100 })
  geofenceRadius: number;

  // ==================== 通知铃声 ====================

  /**
   * 通知铃声ID
   */
  @Column({ name: 'ringtone_id', type: 'varchar', length: 64, default: 'default' })
  ringtoneId: string;

  /**
   * 铃声音量 (0-100)
   */
  @Column({ name: 'ringtone_volume', type: 'int', default: 80 })
  ringtoneVolume: number;

  /**
   * 是否启用震动
   */
  @Column({ name: 'vibration_enabled', type: 'boolean', default: true })
  vibrationEnabled: boolean;

  // ==================== 其他设置 ====================

  /**
   * JSON格式的额外设置
   */
  @Column({ name: 'extra_settings', type: 'json', nullable: true })
  extraSettings: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

/**
 * 通知记录实体
 *
 * 记录发送给用户的通知历史
 */
@Entity('notification_history')
export class NotificationHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 64 })
  @Index()
  userId: string;

  @Column({ name: 'device_id', type: 'varchar', length: 64 })
  @Index()
  deviceId: string;

  @Column({ name: 'baby_id', type: 'varchar', length: 64, nullable: true })
  babyId: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: NotificationType,
  })
  @Index()
  type: NotificationType;

  /**
   * 通知标题
   */
  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  /**
   * 通知内容
   */
  @Column({ name: 'body', type: 'text' })
  body: string;

  /**
   * 通知数据（JSON）
   */
  @Column({ name: 'data', type: 'json', nullable: true })
  data: Record<string, any>;

  /**
   * 是否已读
   */
  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  /**
   * 是否已确认
   */
  @Column({ name: 'is_acknowledged', type: 'boolean', default: false })
  isAcknowledged: boolean;

  /**
   * 用户反馈状态：none=无, liked=赞, disliked=踩
   */
  @Column({ name: 'like_status', type: 'enum', enum: ['none', 'liked', 'disliked'], default: 'none' })
  likeStatus: 'none' | 'liked' | 'disliked';

  /**
   * 哭声识别反馈类型（hungry/hold/diaper/sleepy/gas）
   */
  @Column({ name: 'feedback_type', type: 'varchar', length: 50, nullable: true })
  feedbackType: string;

  /**
   * 用户自定义反馈文本（最长300字）
   */
  @Column({ name: 'feedback_text', type: 'varchar', length: 300, nullable: true })
  feedbackText: string;

  /**
   * 软删除标记
   */
  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;

  /**
   * 推送状态
   */
  @Column({ name: 'push_status', type: 'enum', enum: ['pending', 'sent', 'failed'], default: 'pending' })
  pushStatus: 'pending' | 'sent' | 'failed';

  /**
   * 通知触发时间
   */
  @Column({ name: 'triggered_at', type: 'timestamp' })
  triggeredAt: Date;

  /**
   * 通知发送时间
   */
  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
