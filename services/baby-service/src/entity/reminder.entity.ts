import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ReminderType, ReminderFrequency } from '@baby-monitor/shared-types';

@Entity('reminders')
@Index(['babyId'])
@Index(['enabled'])
@Index(['nextTriggerAt'])
@Index(['babyId', 'nextTriggerAt'])
export class Reminder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '宝宝ID' })
  babyId!: string;

  @Column({
    type: 'enum',
    enum: ReminderType,
    comment: '提醒类型',
  })
  type!: ReminderType;

  @Column({ type: 'varchar', length: 256, comment: '标题' })
  title!: string;

  @Column({ type: 'text', nullable: true, comment: '描述' })
  description!: string;

  @Column({
    type: 'enum',
    enum: ReminderFrequency,
    comment: '提醒频率',
  })
  frequency!: ReminderFrequency;

  @Column({ type: 'int', nullable: true, comment: '间隔(分钟)' })
  interval!: number;

  @Column({ type: 'varchar', length: 8, nullable: true, comment: '计划时间 HH:mm' })
  scheduledTime!: string;

  @Column({ type: 'date', comment: '开始日期' })
  startDate!: Date;

  @Column({ type: 'date', nullable: true, comment: '结束日期' })
  endDate!: Date;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled!: boolean;

  @Column({ type: 'timestamp', nullable: true, comment: '上次触发时间' })
  lastTriggeredAt!: Date;

  @Column({ type: 'timestamp', nullable: true, comment: '下次触发时间' })
  nextTriggerAt!: Date;

  @Column({ type: 'json', nullable: true, comment: '设备列表' })
  devices!: string[];

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
