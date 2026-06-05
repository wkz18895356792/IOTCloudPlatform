/**
 * 宝宝健康事件实体
 *
 * 记录宝宝的健康事件，包括生病、体检、疫苗接种等
 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('baby_health_events')
@Index(['babyId'])
@Index(['eventType'])
@Index(['eventDate'])
export class BabyHealthEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '宝宝ID' })
  babyId!: string;

  @Column({
    type: 'enum',
    enum: ['illness', 'checkup', 'vaccination', 'injury', 'medication', 'allergy', 'other'],
    comment: '事件类型'
  })
  eventType!: string;

  @Column({ type: 'date', comment: '事件日期' })
  eventDate!: Date;

  @Column({ type: 'varchar', length: 255, comment: '事件标题' })
  title!: string;

  @Column({ type: 'text', nullable: true, comment: '事件描述' })
  description?: string;

  @Column({ type: 'json', nullable: true, comment: '事件详情' })
  details?: {
    // 生病相关
    symptoms?: string[];
    temperature?: number;
    diagnosis?: string;
    treatment?: string;

    // 体检相关
    height?: number;
    weight?: number;
    headCircumference?: number;
    development?: string;

    // 疫苗接种相关
    vaccineName?: string;
    vaccineType?: string;
    batchNumber?: string;
    vaccinationSite?: string;
    nextDoseDate?: Date;

    // 用药相关
    medicationName?: string;
    dosage?: string;
    frequency?: string;
    startDate?: Date;
    endDate?: Date;

    // 过敏相关
    allergen?: string;
    severity?: 'mild' | 'moderate' | 'severe';
    reaction?: string;
  };

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '医院/诊所名称' })
  hospital?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '医生姓名' })
  doctor?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, comment: '费用' })
  cost?: number;

  @Column({ type: 'json', nullable: true, comment: '附件列表（图片、报告等）' })
  attachments?: Array<{
    url: string;
    type: 'image' | 'document' | 'report';
    name: string;
  }>;

  @Column({ type: 'boolean', default: false, comment: '是否需要跟进' })
  requiresFollowUp!: boolean;

  @Column({ type: 'date', nullable: true, comment: '跟进日期' })
  followUpDate?: Date;

  @Column({ type: 'uuid', comment: '记录人ID' })
  recordedBy!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
