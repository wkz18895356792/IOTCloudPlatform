import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('ota_tasks')
@Index(['deviceId'])
@Index(['status'])
@Index(['createdAt'])
export class OTATask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '设备ID' })
  deviceId!: string;

  @Column({ type: 'uuid', comment: '固件ID' })
  firmwareId!: string;

  @Column({ type: 'varchar', length: 32, comment: '当前版本' })
  fromVersion!: string;

  @Column({ type: 'varchar', length: 32, comment: '目标版本' })
  toVersion!: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'paused', 'downloading', 'installing', 'completed', 'failed', 'rolled_back'],
    comment: '升级状态',
  })
  status!: 'pending' | 'paused' | 'downloading' | 'installing' | 'completed' | 'failed' | 'rolled_back';

  @Column({ type: 'int', default: 0, comment: '升级进度' })
  progress!: number;

  @Column({ type: 'text', nullable: true, comment: '错误信息' })
  error!: string;

  @Column({ type: 'timestamp', nullable: true, comment: '开始时间' })
  startedAt!: Date;

  @Column({ type: 'timestamp', nullable: true, comment: '完成时间' })
  completedAt!: Date;

  @Column({ type: 'uuid', nullable: true, comment: '创建者用户ID' })
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
