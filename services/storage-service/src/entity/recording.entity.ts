import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { RecordingStatus, UploadStrategy } from '@baby-monitor/shared-types';

/**
 * 录像元数据实体
 * 记录摄像头直存录像的索引信息
 */
@Entity('recordings')
@Index(['deviceId', 'startTime'])
@Index(['status'])
@Index(['createdAt'])
@Index(['planId', 'segmentIndex'])
export class Recording {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128, comment: '设备ID' })
  @Index()
  deviceId!: string;

  @Column({ type: 'varchar', length: 512, comment: 'S3对象Key（服务端生成）' })
  fileKey!: string;

  @Column({ type: 'datetime', comment: '录像开始时间' })
  startTime!: Date;

  @Column({ type: 'datetime', nullable: true, comment: '录像结束时间' })
  endTime?: Date;

  @Column({ type: 'int', nullable: true, comment: '录像时长（秒）' })
  duration?: number;

  @Column({ type: 'bigint', nullable: true, comment: '文件大小（字节）' })
  fileSize?: number;

  @Column({ type: 'varchar', length: 64, default: 'video/mp2t', comment: '文件内容类型' })
  contentType!: string;

  @Column({
    type: 'enum',
    enum: UploadStrategy,
    default: UploadStrategy.SINGLE_PUT,
    comment: '上传策略',
  })
  uploadStrategy!: UploadStrategy;

  @Column({
    type: 'enum',
    enum: RecordingStatus,
    default: RecordingStatus.PENDING,
    comment: '录像状态',
  })
  status!: RecordingStatus;

  @Column({ type: 'varchar', length: 32, default: 'minio', comment: '存储提供商' })
  provider!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '分片上传ID' })
  uploadId?: string;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '录制计划ID（连续录制时关联分段）' })
  planId?: string;

  @Column({ type: 'int', nullable: true, comment: '分段序号（连续录制时递增）' })
  segmentIndex?: number;

  @Column({ type: 'text', nullable: true, comment: '错误信息' })
  error?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '域ID（多租户）' })
  domainId?: string;

  @CreateDateColumn({ comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ comment: '更新时间' })
  updatedAt!: Date;
}
