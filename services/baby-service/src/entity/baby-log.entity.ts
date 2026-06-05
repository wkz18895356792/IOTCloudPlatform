import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@midwayjs/swagger';
import { BabyLogEventType, BabyLogSource, BabyLogLevel } from '@baby-monitor/shared-types';

/**
 * 统一的宝宝日志实体
 * 整合了所有宝宝相关的事件记录，包括喂养、睡眠、尿布、成长、健康、监控、里程碑等
 *
 * 设计原则：
 * - 使用统一的 eventType 字段区分不同类型的事件
 * - 使用 metadata JSON 字段存储事件特定的附加信息
 * - 支持手动记录和算法自动检测两种数据来源
 * - 支持视频关联和置信度记录
 */
@Entity('baby_logs')
@Index(['babyId', 'startTime'])
@Index(['babyId', 'eventType'])
@Index(['deviceId'])
@Index(['createdAt'])
export class BabyLogEntity {
  @ApiProperty({ description: '日志唯一ID' })
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ApiProperty({ description: '宝宝ID' })
  @Column({ type: 'uuid', comment: '宝宝ID' })
  babyId!: string;

  @ApiPropertyOptional({ description: '关联设备ID（如监控摄像头、智能设备等）' })
  @Column({ type: 'uuid', nullable: true, comment: '关联设备ID' })
  deviceId!: string | null;

  @ApiProperty({ description: '事件唯一标识(UUID格式)，防止重复记录' })
  @Column({ type: 'varchar', length: 36, unique: true, comment: '事件唯一标识(UUID格式)' })
  eventId!: string;
  @ApiProperty({ description: '事件类型', enum: BabyLogEventType })
  @Column({
    type: 'enum',
    enum: Object.values(BabyLogEventType),
    comment: '事件类型',
  })
  eventType!: BabyLogEventType;

  @ApiProperty({ description: '事件开始时间' })
  @Column({ type: 'timestamp', comment: '事件开始时间' })
  startTime!: Date;

  @ApiPropertyOptional({ description: '事件结束时间（持续性事件需要记录）' })
  @Column({ type: 'timestamp', nullable: true, comment: '事件结束时间' })
  endTime!: Date | null;

  @ApiPropertyOptional({ description: '事件持续时长（秒）' })
  @Column({ type: 'int', nullable: true, comment: '事件持续时长(秒)' })
  duration!: number | null;

  @ApiPropertyOptional({ description: '事件发生所在时区（如 Asia/Shanghai）' })
  @Column({ type: 'varchar', length: 50, nullable: true, comment: '时区' })
  timezone!: string | null;

  @ApiProperty({ description: '数据来源', enum: BabyLogSource })
  @Column({
    type: 'enum',
    enum: BabyLogSource,
    default: BabyLogSource.MANUAL,
    comment: '数据来源：manual-手动、algorithm-算法、device-设备',
  })
  source!: BabyLogSource;

  @ApiPropertyOptional({ description: '事件级别（主要用于监控事件）', enum: BabyLogLevel })
  @Column({
    type: 'enum',
    enum: BabyLogLevel,
    nullable: true,
    comment: '事件级别',
  })
  level!: BabyLogLevel | null;

  @ApiPropertyOptional({ description: 'S3视频文件存储路径' })
  @Column({ type: 'varchar', length: 500, nullable: true, comment: 'S3视频文件存储路径' })
  videoPath!: string | null;

  @ApiPropertyOptional({ description: '事件在视频中的时间偏移量（秒），用于视频跳转定位' })
  @Column({ type: 'int', nullable: true, comment: '视频时间偏移量(秒)' })
  videoTimestamp!: number | null;

  @ApiPropertyOptional({ description: '缩略图URL' })
  @Column({ type: 'varchar', length: 512, nullable: true, comment: '缩略图URL' })
  thumbnailUrl!: string | null;

  @ApiPropertyOptional({ description: '算法识别置信度（0-1）' })
  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true, comment: '识别置信度(0-1)' })
  confidence!: number | null;

  @ApiPropertyOptional({ description: '用户备注信息' })
  @Column({ type: 'text', nullable: true, comment: '用户备注信息' })
  note!: string | null;

  @ApiPropertyOptional({ description: '事件附加信息（JSON格式），根据不同事件类型存储特定属性' })
  @Column({ type: 'json', nullable: true, comment: '事件附加信息(JSON格式)' })
  metadata!: Record<string, any> | null;

  @ApiPropertyOptional({ description: '是否已确认（用于监控事件）' })
  @Column({ type: 'boolean', default: false, comment: '是否已确认' })
  acknowledged!: boolean;

  @ApiPropertyOptional({ description: '确认人ID' })
  @Column({ type: 'uuid', nullable: true, comment: '确认人ID' })
  acknowledgedBy!: string | null;

  @ApiPropertyOptional({ description: '确认时间' })
  @Column({ type: 'timestamp', nullable: true, comment: '确认时间' })
  acknowledgedAt!: Date | null;

  @ApiPropertyOptional({ description: '记录人ID' })
  @Column({ type: 'uuid', nullable: true, comment: '记录人ID' })
  recordedBy!: string | null;

  @ApiProperty({ description: '记录创建时间' })
  @CreateDateColumn({ type: 'timestamp', comment: '记录创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '记录更新时间' })
  @UpdateDateColumn({ type: 'timestamp', comment: '记录更新时间' })
  updatedAt!: Date;
}
