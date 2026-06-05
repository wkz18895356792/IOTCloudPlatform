import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ProductType } from './device.entity';

/**
 * 认证方式枚举
 */
export enum AuthMethod {
  HMAC = 'HMAC',
  X509 = 'X509',
  REG_CODE = 'REG_CODE',
  NONE = 'NONE',
}

/**
 * 产品状态枚举
 */
export enum ProductStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DISCONTINUED = 'discontinued',
}

/**
 * 白名单配置接口
 */
export interface WhitelistConfig {
  enabled: boolean;
  mode: 'whitelist' | 'blacklist';
  autoApprove?: boolean;
}

/**
 * 产品配置实体
 *
 * 用于定义产品的认证策略和配额限制
 */
@Entity('product_configs')
@Index(['productId'], { unique: true })
@Index(['status'])
export class ProductConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, comment: '产品ID' })
  productId!: string;

  @Column({ type: 'varchar', length: 128, comment: '产品名称' })
  productName!: string;

  @Column({
    type: 'enum',
    enum: ProductType,
    comment: '产品类型',
  })
  productType!: ProductType;

  // ==================== 认证配置 ====================

  @Column({
    type: 'enum',
    enum: AuthMethod,
    default: AuthMethod.HMAC,
    comment: '认证方式',
  })
  authMethod!: AuthMethod;

  @Column({ type: 'varchar', length: 256, nullable: true, comment: '产品级密钥' })
  productSecret!: string;

  // ==================== 配额配置 ====================

  @Column({ type: 'int', default: 10, comment: '每用户最大设备数' })
  maxDevicesPerUser!: number;

  @Column({ type: 'int', nullable: true, comment: '产品总设备数上限' })
  maxTotalDevices!: number;

  // ==================== 白名单配置 ====================

  @Column({ type: 'json', nullable: true, comment: '白名单配置' })
  whitelistConfig!: WhitelistConfig;

  // ==================== 设备指纹配置 ====================

  @Column({ type: 'boolean', default: false, comment: '是否要求设备指纹验证' })
  requireFingerprint!: boolean;

  @Column({
    type: 'enum',
    enum: ['SHA256', 'SHA512'],
    default: 'SHA256',
    nullable: true,
    comment: '指纹算法',
  })
  fingerprintAlgorithm!: 'SHA256' | 'SHA512';

  // ==================== 安全配置 ====================

  @Column({ type: 'boolean', default: true, comment: '是否启用时间戳验证' })
  enableTimestampValidation!: boolean;

  @Column({ type: 'int', default: 300, comment: '时间戳有效时间（秒）' })
  timestampTolerance!: number;

  @Column({ type: 'boolean', default: true, comment: '是否启用Nonce验证' })
  enableNonceValidation!: boolean;

  @Column({ type: 'int', default: 5, comment: '每小时最大注册次数' })
  rateLimitPerHour!: number;

  // ==================== 证书配置 ====================

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '关联域ID' })
  domainId!: string;

  @Column({ type: 'varchar', length: 2, default: 'CN', comment: '证书国家' })
  certificateCountry!: string;

  @Column({ type: 'varchar', length: 128, default: 'Beijing', comment: '证书省/州' })
  certificateState!: string;

  @Column({ type: 'varchar', length: 128, default: 'Beijing', comment: '证书城市' })
  certificateLocality!: string;

  @Column({ type: 'varchar', length: 256, default: 'BabyMonitor', comment: '证书组织' })
  certificateOrganization!: string;

  @Column({ type: 'varchar', length: 256, default: 'IoT Devices', comment: '证书单位' })
  certificateUnit!: string;

  @Column({ type: 'varchar', length: 256, default: 'noreply@babymonitor.com', comment: '证书邮箱' })
  certificateEmail!: string;

  // ==================== 状态 ====================

  @Column({
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.ACTIVE,
    comment: '产品状态',
  })
  status!: ProductStatus;

  // ==================== 审计 ====================

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '创建者' })
  createdBy!: string;
}
