import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { UserActionType } from '@baby-monitor/shared-types';

@Entity('user_action_logs')
@Index(['userId'])
@Index(['userId', 'createdAt'])
@Index(['action'])
export class UserActionLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid', comment: '用户ID' })
  userId!: string;

  @Column({
    type: 'enum',
    enum: UserActionType,
    comment: '操作类型',
  })
  action!: UserActionType;

  @Column({ type: 'json', nullable: true, comment: '操作详情' })
  details!: Record<string, any>;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'IP地址' })
  ip!: string;

  @Column({ type: 'text', nullable: true, comment: '用户代理' })
  userAgent!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
