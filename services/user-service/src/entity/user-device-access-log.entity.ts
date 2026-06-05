import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * 用户设备访问日志实体
 *
 * 记录被邀请用户观看设备的会话历史，统一由 user-service 管理。
 */
@Entity('user_device_access_logs')
export class UserDeviceAccessLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id', type: 'varchar', length: 64 })
  @Index()
  deviceId: string;

  @Column({ name: 'user_id', type: 'varchar', length: 64 })
  @Index()
  userId: string;

  /** 观看开始时间 */
  @Column({ name: 'started_at', type: 'timestamp' })
  startedAt: Date;

  /** 观看结束时间 */
  @Column({ name: 'ended_at', type: 'timestamp', nullable: true })
  endedAt: Date;

  /** 观看时长（秒） */
  @Column({ name: 'duration', type: 'int', default: 0 })
  duration: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
