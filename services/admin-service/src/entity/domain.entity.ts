import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 域状态枚举
 */
export enum DomainStatus {
  ACTIVE = 'active',           // 活跃
  SUSPENDED = 'suspended',     // 暂停
  DELETED = 'deleted',         // 已删除
}

/**
 * 域类型枚举
 */
export enum DomainType {
  TRIAL = 'trial',             // 试用版
  STANDARD = 'standard',       // 标准版
  PREMIUM = 'premium',         // 高级版
  ENTERPRISE = 'enterprise',   // 企业版
}

/**
 * 域实体
 * 表示一个独立的租户域
 */
@Entity('domains')
@Index(['code'], { unique: true })
@Index(['ownerId'])
@Index(['status'])
export class Domain {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, comment: '域编码（唯一标识）' })
  code!: string;

  @Column({ type: 'varchar', length: 128, comment: '域名称' })
  name!: string;

  @Column({ type: 'text', nullable: true, comment: '域描述' })
  description!: string;

  @Column({ type: 'enum', enum: DomainType, default: DomainType.TRIAL, comment: '域类型' })
  type!: DomainType;

  @Column({
    type: 'enum',
    enum: DomainStatus,
    default: DomainStatus.ACTIVE,
    comment: '域状态',
  })
  status!: DomainStatus;

  @Column({ name: 'ownerId', type: 'varchar', length: 36, comment: '域所有者用户ID' })
  ownerId!: string;

  @Column({ name: 'userLimit', type: 'int', default: 100, comment: '用户数量限制（0表示无限制）' })
  userLimit!: number;

  @Column({ name: 'deviceLimit', type: 'int', default: 500, comment: '设备数量限制（0表示无限制）' })
  deviceLimit!: number;

  @Column({ type: 'int', default: 100, comment: '存储空间限制（GB，0表示无限制）' })
  storageLimit!: number;

  @Column({ name: 'trialExpiresAt', type: 'timestamp', nullable: true, comment: '试用到期时间' })
  trialExpiresAt!: Date;

  @Column({ name: 'subscriptionExpiresAt', type: 'timestamp', nullable: true, comment: '订阅到期时间' })
  subscriptionExpiresAt!: Date;

  @Column({ type: 'json', nullable: true, comment: '域配置（JSON格式）' })
  config!: Record<string, any>;

  @Column({ name: 'deletedAt', type: 'timestamp', nullable: true, comment: '最后删除时间（软删除）' })
  deletedAt!: Date;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
