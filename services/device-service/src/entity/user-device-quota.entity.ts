import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 配额状态枚举
 */
export enum QuotaStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  OVER_LIMIT = 'over_limit',
}

/**
 * 用户设备配额实体
 *
 * 用于管理用户的设备配额
 */
@Entity('user_device_quotas')
@Index(['userId', 'productId'], { unique: true })
@Index(['status'])
export class UserDeviceQuota {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '用户ID' })
  userId!: string;

  @Column({ type: 'varchar', length: 64, comment: '产品ID' })
  productId!: string;

  // ==================== 配额 ====================

  @Column({ type: 'int', comment: '配额上限' })
  quotaLimit!: number;

  @Column({ type: 'int', default: 0, comment: '已使用配额' })
  quotaUsed!: number;

  // ==================== 统计 ====================

  @Column({ type: 'int', default: 0, comment: '总注册次数' })
  totalRegistrations!: number;

  @Column({ type: 'timestamp', nullable: true, comment: '最后注册时间' })
  lastRegisteredAt!: Date;

  // ==================== 状态 ====================

  @Column({
    type: 'enum',
    enum: QuotaStatus,
    default: QuotaStatus.ACTIVE,
    comment: '状态',
  })
  status!: QuotaStatus;

  // ==================== 审计 ====================

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
