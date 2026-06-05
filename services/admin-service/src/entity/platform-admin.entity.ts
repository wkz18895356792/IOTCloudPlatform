import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 平台管理员角色枚举
 */
export enum PlatformAdminRole {
  /** 超级管理员 - 拥有所有权限 */
  SUPER_ADMIN = 'super_admin',
  /** 运营管理员 - 负责日常运营管理 */
  OPS_ADMIN = 'ops_admin',
  /** 只读管理员 - 只有查看权限 */
  READ_ONLY_ADMIN = 'read_only_admin',
}

/**
 * 平台管理员状态枚举
 */
export enum PlatformAdminStatus {
  /** 活跃 */
  ACTIVE = 'active',
  /** 禁用 */
  DISABLED = 'disabled',
  /** 锁定 */
  LOCKED = 'locked',
}

/**
 * 平台管理员实体
 * 用于管理平台的超级管理员、运营管理员等
 */
@Entity('platform_admins')
@Index(['email'], { unique: true })
@Index(['username'], { unique: true })
@Index(['status'])
export class PlatformAdmin {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, comment: '用户名' })
  username!: string;

  @Column({ type: 'varchar', length: 255, comment: '邮箱' })
  email!: string;

  @Column({ type: 'varchar', length: 255, comment: '密码哈希' })
  passwordHash!: string;

  @Column({
    type: 'enum',
    enum: PlatformAdminRole,
    default: PlatformAdminRole.READ_ONLY_ADMIN,
    comment: '管理员角色',
  })
  role!: PlatformAdminRole;

  @Column({
    type: 'enum',
    enum: PlatformAdminStatus,
    default: PlatformAdminStatus.ACTIVE,
    comment: '账户状态',
  })
  status!: PlatformAdminStatus;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '昵称' })
  nickname?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '头像URL' })
  avatar?: string;

  @Column({ type: 'json', nullable: true, comment: '权限列表' })
  permissions?: string[];

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后登录IP' })
  lastLoginIp?: string;

  @Column({ type: 'timestamp', nullable: true, comment: '最后登录时间' })
  lastLoginAt?: Date;

  @Column({ type: 'timestamp', nullable: true, comment: '密码重置令牌过期时间' })
  passwordResetTokenExpiresAt?: Date;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '备注' })
  remark?: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
