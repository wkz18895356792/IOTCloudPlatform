import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 证书类型枚举
 */
export enum CertificateType {
  HMAC = 'HMAC',
  X509 = 'X509',
  REG_CODE = 'REG_CODE',
}

/**
 * 证书状态枚举
 */
export enum CertificateStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
  PENDING = 'pending',
}

/**
 * 设备证书实体
 *
 * 用于存储设备的认证凭证，支持三种认证方式：
 * - HMAC: 基于签名的认证
 * - X509: 基于证书的认证
 * - REG_CODE: 基于注册码的认证
 */
@Entity('device_certificates')
@Index(['deviceId'])
@Index(['certFingerprint'])
@Index(['registrationCode'])
@Index(['status'])
export class DeviceCertificate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, comment: '设备ID' })
  deviceId!: string;

  @Column({
    type: 'enum',
    enum: CertificateType,
    comment: '证书类型',
  })
  certificateType!: CertificateType;

  // ==================== HMAC 密钥相关 ====================

  @Column({ type: 'varchar', length: 256, nullable: true, comment: '设备密钥（HMAC）' })
  deviceSecret!: string;

  @Column({ type: 'int', default: 1, nullable: true, comment: '密钥版本' })
  keyVersion!: number;

  // ==================== X509 证书相关 ====================

  @Column({ type: 'text', nullable: true, comment: '证书PEM格式' })
  certificatePem!: string;

  @Column({ type: 'text', nullable: true, comment: '加密的私钥' })
  privateKeyEncrypted!: string;

  @Column({ type: 'text', nullable: true, comment: 'CA证书链' })
  caChain!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '证书指纹' })
  certFingerprint!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '证书序列号' })
  certSerialNumber!: string;

  @Column({ type: 'timestamp', nullable: true, comment: '证书签发时间' })
  issuedAt!: Date;

  @Column({ type: 'timestamp', nullable: true, comment: '证书过期时间' })
  expiresAt!: Date;

  // ==================== 注册码相关 ====================

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '注册码' })
  registrationCode!: string;

  @Column({ type: 'json', nullable: true, comment: '注册码权限范围' })
  codeScopes!: Record<string, any>;

  @Column({ type: 'timestamp', nullable: true, comment: '注册码过期时间' })
  codeExpiresAt!: Date;

  @Column({ type: 'boolean', default: false, comment: '注册码是否已使用' })
  codeUsed!: boolean;

  // ==================== 状态与审计 ====================

  @Column({
    type: 'enum',
    enum: CertificateStatus,
    default: CertificateStatus.ACTIVE,
    comment: '证书状态',
  })
  status!: CertificateStatus;

  @Column({ type: 'varchar', length: 256, nullable: true, comment: '吊销原因' })
  revocationReason!: string;

  @Column({ type: 'timestamp', nullable: true, comment: '吊销时间' })
  revokedAt!: Date;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '创建者' })
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
