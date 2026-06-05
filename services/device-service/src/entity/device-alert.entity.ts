import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { DeviceAlertLevel } from '@baby-monitor/shared-types';

@Entity('device_alerts')
@Index(['deviceId'])
@Index(['level'])
@Index(['acknowledged'])
@Index(['createdAt'])
export class DeviceAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '设备ID' })
  deviceId!: string;

  @Column({ type: 'varchar', length: 64, comment: '告警类型' })
  type!: string;

  @Column({
    type: 'enum',
    enum: DeviceAlertLevel,
    comment: '告警级别',
  })
  level!: DeviceAlertLevel;

  @Column({ type: 'varchar', length: 256, comment: '告警标题' })
  title!: string;

  @Column({ type: 'text', comment: '告警消息' })
  message!: string;

  @Column({ type: 'json', nullable: true, comment: '告警附加数据' })
  data!: Record<string, any>;

  @Column({ type: 'boolean', default: false, comment: '是否已确认' })
  acknowledged!: boolean;

  @Column({ type: 'uuid', nullable: true, comment: '确认人ID' })
  acknowledgedBy!: string;

  @Column({ type: 'timestamp', nullable: true, comment: '确认时间' })
  acknowledgedAt!: Date;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
