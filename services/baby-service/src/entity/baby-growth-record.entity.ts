/**
 * 宝宝成长记录实体
 *
 * 记录宝宝的生长数据，包括身高、体重、头围等指标
 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('baby_growth_records')
@Index(['babyId'])
@Index(['recordDate'])
export class BabyGrowthRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '宝宝ID' })
  babyId!: string;

  @Column({ type: 'date', comment: '记录日期' })
  recordDate!: Date;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, comment: '身高（厘米）' })
  height?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, comment: '体重（克）' })
  weight?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, comment: '头围（厘米）' })
  headCircumference?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, comment: '胸围（厘米）' })
  chestCircumference?: number;

  @Column({ type: 'int', nullable: true, comment: '年龄（月）' })
  ageInMonths?: number;

  @Column({ type: 'json', nullable: true, comment: '百分位数据' })
  percentiles?: {
    height?: number;  // 身高百分位
    weight?: number;  // 体重百分位
    headCircumference?: number; // 头围百分位
  };

  @Column({ type: 'text', nullable: true, comment: '备注' })
  notes?: string;

  @Column({ type: 'uuid', comment: '记录人ID' })
  recordedBy!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
