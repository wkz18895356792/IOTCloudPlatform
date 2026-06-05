import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 用户设置实体
 *
 * 存储用户的各项设置，包括面容ID登录、通知偏好等
 */
@Entity('user_settings')
export class UserSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 64 })
  @Index()
  userId: string;

  // ==================== 认证设置 ====================

  /**
   * 面容ID登录是否启用
   */
  @Column({ name: 'face_id_enabled', type: 'boolean', default: false })
  faceIdEnabled: boolean;

  /**
   * 面容ID绑定数据（加密存储的生物识别数据）
   */
  @Column({ name: 'face_id_data', type: 'text', nullable: true })
  faceIdData: string | null;

  /**
   * 面容ID注册时间
   */
  @Column({ name: 'face_id_registered_at', type: 'timestamp', nullable: true })
  faceIdRegisteredAt: Date | null;

  // ==================== 通知设置 ====================

  /**
   * 推送通知开关
   */
  @Column({ name: 'push_notifications_enabled', type: 'boolean', default: true })
  pushNotificationsEnabled: boolean;

  /**
   * 通知铃声设置
   */
  @Column({ name: 'notification_ringtone', type: 'varchar', length: 255, default: 'default' })
  notificationRingtone: string;

  /**
   * 是否启用震动
   */
  @Column({ name: 'notification_vibration_enabled', type: 'boolean', default: true })
  notificationVibrationEnabled: boolean;

  // ==================== 隐私设置 ====================

  /**
   * 是否允许被搜索
   */
  @Column({ name: 'discoverable', type: 'boolean', default: false })
  discoverable: boolean;

  /**
   * 在线状态可见性
   */
  @Column({ name: 'online_status_visibility', type: 'enum', enum: ['public', 'friends', 'private'], default: 'friends' })
  onlineStatusVisibility: 'public' | 'friends' | 'private';

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
