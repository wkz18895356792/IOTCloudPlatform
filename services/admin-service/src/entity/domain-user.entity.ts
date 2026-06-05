import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 域用户角色枚举
 */
export enum DomainUserRole {
  /** 域管理员 - 拥有域内所有权限 */
  DOMAIN_ADMIN = 'domain_admin',
  /** 域成员 - 普通域成员 */
  DOMAIN_MEMBER = 'domain_member',
  /** 域访客 - 只有只读权限 */
  DOMAIN_GUEST = 'domain_guest',
}

/**
 * 域用户状态枚举
 */
export enum DomainUserStatus {
  /** 活跃 */
  ACTIVE = 'active',
  /** 待激活 */
  PENDING = 'pending',
  /** 禁用 */
  DISABLED = 'disabled',
  /** 已删除 */
  DELETED = 'deleted',
}

/**
 * 域用户实体
 * 用于域管理，每个域可以有多个域用户
 */
@Entity('domain_users')
@Index(['domainId', 'userId'], { unique: true })
@Index(['domainId'])
@Index(['userId'])
@Index(['email'])
@Index(['status'])
export class DomainUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36, comment: '域ID' })
  domainId!: string;

  @Column({ type: 'varchar', length: 36, comment: '关联的用户ID' })
  userId!: string;

  @Column({ type: 'varchar', length: 50, comment: '域内用户名' })
  username!: string;

  @Column({ type: 'varchar', length: 255, comment: '邮箱' })
  email!: string;

  @Column({ type: 'varchar', length: 20, nullable: true, comment: '手机号' })
  phone?: string;

  @Column({ type: 'varchar', length: 255, comment: '密码哈希' })
  passwordHash!: string;

  @Column({
    type: 'enum',
    enum: DomainUserRole,
    default: DomainUserRole.DOMAIN_MEMBER,
    comment: '域角色',
  })
  role!: DomainUserRole;

  @Column({
    type: 'enum',
    enum: DomainUserStatus,
    default: DomainUserStatus.PENDING,
    comment: '用户状态',
  })
  status!: DomainUserStatus;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '昵称' })
  nickname?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '头像URL' })
  avatar?: string;

  @Column({ type: 'json', nullable: true, comment: '扩展信息' })
  metadata?: Record<string, any>;

  @Column({ type: 'timestamp', nullable: true, comment: '最后登录时间' })
  lastLoginAt?: Date;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后登录IP' })
  lastLoginIp?: string;

  @Column({ type: 'boolean', default: false, comment: '邮箱是否已验证' })
  emailVerified?: boolean;

  @Column({ type: 'boolean', default: false, comment: '手机号是否已验证' })
  phoneVerified?: boolean;

  @Column({ type: 'timestamp', nullable: true, comment: '加入域的时间' })
  joinedAt?: Date;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
