import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * 注册结果枚举
 */
export enum RegistrationResult {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

/**
 * 设备注册审计实体
 *
 * 记录所有设备注册尝试的详细信息，用于审计和异常检测
 */
@Entity('device_registration_audit')
@Index(['correlationId'])
@Index(['deviceId'])
@Index(['result'])
@Index(['createdAt'])
export class DeviceRegistrationAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128, comment: '关联ID' })
  correlationId!: string;

  // ==================== 设备信息 ====================

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '设备ID' })
  deviceId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '设备序列号' })
  deviceSerialNumber!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '产品ID' })
  productId!: string;

  // ==================== 认证信息 ====================

  @Column({ type: 'varchar', length: 32, nullable: true, comment: '认证方式' })
  authMethod!: string;

  @Column({ type: 'boolean', nullable: true, comment: '签名是否验证通过' })
  signatureVerified!: boolean;

  @Column({ type: 'boolean', nullable: true, comment: '证书是否验证通过' })
  certificateVerified!: boolean;

  @Column({ type: 'boolean', nullable: true, comment: '白名单是否检查' })
  whitelistChecked!: boolean;

  @Column({ type: 'boolean', nullable: true, comment: '设备指纹是否验证' })
  fingerprintVerified!: boolean;

  // ==================== 配额检查 ====================

  @Column({ type: 'boolean', nullable: true, comment: '配额是否检查' })
  quotaChecked!: boolean;

  @Column({ type: 'int', nullable: true, comment: '配额上限' })
  quotaLimit!: number;

  @Column({ type: 'int', nullable: true, comment: '检查前已使用配额' })
  quotaUsedBefore!: number;

  @Column({ type: 'int', nullable: true, comment: '检查后已使用配额' })
  quotaUsedAfter!: number;

  // ==================== 地理位置 ====================

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '客户端IP' })
  clientIp!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '客户端国家' })
  clientCountry!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '客户端地区' })
  clientRegion!: string;

  // ==================== 结果 ====================

  @Column({
    type: 'enum',
    enum: RegistrationResult,
    comment: '注册结果',
  })
  result!: RegistrationResult;

  @Column({ type: 'int', nullable: true, comment: '错误码' })
  errorCode!: number;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '错误信息' })
  errorMessage!: string;

  // ==================== 时间 ====================

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
