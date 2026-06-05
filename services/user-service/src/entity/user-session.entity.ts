import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('user_sessions')
@Index(['userId'])
@Index(['userId', 'lastActiveAt'])
export class UserSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '用户ID' })
  userId!: string;

  @Column({
    type: 'enum',
    enum: ['web', 'ios', 'android', 'desktop'],
    comment: '设备类型',
  })
  deviceType!: 'web' | 'ios' | 'android' | 'desktop';

  @Column({ type: 'text', nullable: true, comment: '设备信息' })
  deviceInfo!: string;

  @Column({ type: 'varchar', length: 64, comment: 'IP地址' })
  ip!: string;

  @Column({ type: 'varchar', length: 256, nullable: true, comment: '所在地' })
  location!: string;

  @Column({ type: 'timestamp', comment: '最后活跃时间' })
  lastActiveAt!: Date;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
