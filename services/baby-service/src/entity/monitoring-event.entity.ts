import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { MonitoringEventType, MonitoringEventLevel } from '@baby-monitor/shared-types';

@Entity('monitoring_events')
@Index(['babyId'])
@Index(['deviceId'])
@Index(['timestamp'])
@Index(['babyId', 'timestamp'])
@Index(['acknowledged'])
export class MonitoringEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '宝宝ID' })
  babyId!: string;

  @Column({ type: 'uuid', comment: '设备ID' })
  deviceId!: string;

  @Column({
    type: 'enum',
    enum: MonitoringEventType,
    comment: '监控事件类型',
  })
  type!: MonitoringEventType;

  @Column({
    type: 'enum',
    enum: MonitoringEventLevel,
    comment: '事件级别',
  })
  level!: MonitoringEventLevel;

  @Column({ type: 'timestamp', comment: '时间戳' })
  timestamp!: Date;

  @Column({ type: 'json', nullable: true, comment: '事件数据' })
  data!: Record<string, any>;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '缩略图URL' })
  thumbnailUrl!: string;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '视频URL' })
  videoUrl!: string;

  @Column({ type: 'boolean', default: false, comment: '是否已确认' })
  acknowledged!: boolean;

  @Column({ type: 'uuid', nullable: true, comment: '确认人ID' })
  acknowledgedBy!: string;

  @Column({ type: 'timestamp', nullable: true, comment: '确认时间' })
  acknowledgedAt!: Date;

  @Column({ type: 'text', nullable: true, comment: '备注' })
  notes!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
