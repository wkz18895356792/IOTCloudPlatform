import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 设备标识类型枚举
 */
export enum DeviceIdentifierType {
  SERIAL_NUMBER = 'SERIAL_NUMBER',
  MAC_ADDRESS = 'MAC_ADDRESS',
  CERT_FINGERPRINT = 'CERT_FINGERPRINT',
}

/**
 * 白名单状态枚举
 */
export enum WhitelistStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BLACKLISTED = 'blacklisted',
}

/**
 * 设备白名单实体
 *
 * 用于控制哪些设备可以注册到平台
 */
@Entity('device_whitelist')
@Index(['productId', 'deviceIdentifier'])
@Index(['status'])
export class DeviceWhitelist {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, comment: '产品ID' })
  productId!: string;

  @Column({ type: 'varchar', length: 128, comment: '设备标识' })
  deviceIdentifier!: string;

  @Column({
    type: 'enum',
    enum: DeviceIdentifierType,
    comment: '标识类型',
  })
  identifierType!: DeviceIdentifierType;

  // ==================== 限制条件 ====================

  @Column({ type: 'int', default: 1, comment: '最大注册次数' })
  maxRegistrations!: number;

  @Column({ type: 'int', default: 0, comment: '已注册次数' })
  registrationCount!: number;

  // ==================== 有效期 ====================

  @Column({ type: 'timestamp', nullable: true, comment: '生效开始时间' })
  validFrom!: Date;

  @Column({ type: 'timestamp', nullable: true, comment: '生效结束时间' })
  validUntil!: Date;

  // ==================== 扩展信息 ====================

  @Column({ type: 'json', nullable: true, comment: '扩展信息' })
  metadata!: Record<string, any>;

  @Column({ type: 'text', nullable: true, comment: '备注' })
  notes!: string;

  // ==================== 状态 ====================

  @Column({
    type: 'enum',
    enum: WhitelistStatus,
    default: WhitelistStatus.ACTIVE,
    comment: '状态',
  })
  status!: WhitelistStatus;

  // ==================== 审计 ====================

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '创建者' })
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
