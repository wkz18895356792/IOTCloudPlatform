import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { LogStatus, LogTriggerType } from '@baby-monitor/shared-types';

/**
 * 设备日志元数据实体
 * 记录设备日志打捞/上传的索引信息
 */
@Entity('device_logs')
@Index(['deviceId', 'createdAt'])
@Index(['status'])
@Index(['taskId'])
export class DeviceLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128, comment: '设备ID' })
  @Index()
  deviceId!: string;

  @Column({ type: 'varchar', length: 512, comment: 'S3对象Key（服务端生成）' })
  fileKey!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '日志类型(system/crash/network/debug)' })
  logType!: string;

  @Column({
    type: 'enum',
    enum: LogStatus,
    default: LogStatus.PENDING,
    comment: '日志状态',
  })
  status!: LogStatus;

  @Column({ type: 'bigint', nullable: true, comment: '文件大小（字节）' })
  fileSize!: number;

  @Column({ type: 'varchar', length: 64, default: 'text/plain', comment: '文件内容类型' })
  contentType!: string;

  @Column({ type: 'varchar', length: 32, default: 'minio', comment: '存储提供商' })
  provider!: string;

  @Column({
    type: 'enum',
    enum: LogTriggerType,
    comment: '触发类型',
  })
  triggerType!: LogTriggerType;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '平台打捞任务ID' })
  taskId!: string | null;

  @Column({ type: 'text', nullable: true, comment: '描述信息' })
  description!: string | null;

  @Column({ type: 'text', nullable: true, comment: '错误信息' })
  error!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '域ID（多租户）' })
  domainId!: string;

  @CreateDateColumn({ comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ comment: '更新时间' })
  updatedAt!: Date;
}
