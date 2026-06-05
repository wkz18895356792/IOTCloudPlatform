import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('user_feedback')
@Index(['userId'])
@Index(['status'])
export class UserFeedback {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '用户ID' })
  userId!: string;

  @Column({
    type: 'enum',
    enum: ['bug', 'feature', 'complaint', 'other'],
    comment: '反馈类型',
  })
  type!: 'bug' | 'feature' | 'complaint' | 'other';

  @Column({ type: 'varchar', length: 256, comment: '反馈标题' })
  title!: string;

  @Column({ type: 'text', comment: '反馈内容' })
  content!: string;

  @Column({ type: 'json', nullable: true, comment: '附件列表' })
  attachments!: string[];

  @Column({
    type: 'enum',
    enum: ['pending', 'processing', 'resolved', 'closed'],
    default: 'pending',
    comment: '处理状态',
  })
  status!: 'pending' | 'processing' | 'resolved' | 'closed';

  @Column({ type: 'text', nullable: true, comment: '回复内容' })
  reply!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @Column({ type: 'timestamp', nullable: true, comment: '更新时间' })
  updatedAt!: Date;
}
