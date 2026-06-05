import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { DeviceEventType } from '@baby-monitor/shared-types';

@Entity('device_events')
@Index(['deviceId'])
@Index(['type'])
@Index(['createdAt'])
export class DeviceEvent {
  @PrimaryGeneratedColumn({ unsigned: true, comment: '事件ID' })
  id!: number;

  @Column({ type: 'uuid', comment: '设备ID' })
  deviceId!: string;

  @Column({
    type: 'enum',
    enum: DeviceEventType,
    comment: '事件类型',
  })
  type!: DeviceEventType;

  @Column({ type: 'json', nullable: true, comment: '事件数据' })
  data!: Record<string, any>;

  @Column({ type: 'uuid', nullable: true, comment: '关联用户ID' })
  userId!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
