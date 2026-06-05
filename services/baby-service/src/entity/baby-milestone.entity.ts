/**
 * 宝宝里程碑实体
 *
 * 记录宝宝的发育里程碑，如第一次笑、第一次爬、第一次走等
 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('baby_milestones')
@Index(['babyId'])
@Index(['milestoneDate'])
@Index(['category'])
export class BabyMilestone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '宝宝ID' })
  babyId!: string;

  @Column({
    type: 'enum',
    enum: ['motor', 'language', 'cognitive', 'social', 'emotional', 'self_care', 'other'],
    comment: '里程碑类别'
  })
  category!: string;

  @Column({ type: 'date', comment: '达成日期' })
  milestoneDate!: Date;

  @Column({ type: 'varchar', length: 255, comment: '里程碑标题' })
  title!: string;

  @Column({ type: 'text', nullable: true, comment: '描述' })
  description?: string;

  @Column({ type: 'int', nullable: true, comment: '年龄（月）' })
  ageInMonths?: number;

  @Column({ type: 'boolean', default: false, comment: '是否提前达成' })
  isEarly!: boolean;

  @Column({ type: 'boolean', default: false, comment: '是否延迟达成' })
  isDelayed!: boolean;

  @Column({ type: 'text', nullable: true, comment: '备注' })
  notes?: string;

  @Column({ type: 'json', nullable: true, comment: '附件列表（图片、视频等）' })
  attachments?: Array<{
    url: string;
    type: 'image' | 'video';
    name: string;
  }>;

  @Column({ type: 'uuid', comment: '记录人ID' })
  recordedBy!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
