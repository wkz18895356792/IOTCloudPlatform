import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('device_states')
@Index(['deviceId'])
@Index(['reportedAt'])
export class DeviceState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '设备ID' })
  deviceId!: string;

  @Column({ type: 'json', comment: '设备状态数据' })
  state!: Record<string, any>;

  @CreateDateColumn({ type: 'timestamp', comment: '上报时间' })
  reportedAt!: Date;
}
