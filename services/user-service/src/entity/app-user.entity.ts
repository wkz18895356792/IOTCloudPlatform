import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * APP用户角色枚举
 */
export enum AppUserRole {
  /** 普通用户 */
  USER = 'user',
  /** 高级用户（付费会员） */
  PREMIUM_USER = 'premium_user',
}

/**
 * APP用户状态枚举
 */
export enum AppUserStatus {
  /** 活跃 */
  ACTIVE = 'active',
  /** 未激活 */
  INACTIVE = 'inactive',
  /** 已冻结 */
  FROZEN = 'frozen',
  /** 已注销 */
  DELETED = 'deleted',
}

/**
 * APP用户实体
 * 用于婴儿监护APP的普通用户
 */
@Entity('app_users')
@Index(['email'])
@Index(['phone'])
@Index(['status'])
export class AppUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, comment: '用户名' })
  username!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '邮箱' })
  email?: string;

  @Column({ type: 'varchar', length: 20, nullable: true, comment: '手机号' })
  phone?: string;

  @Column({ type: 'varchar', length: 255, comment: '密码哈希' })
  passwordHash!: string;

  @Column({
    type: 'enum',
    enum: AppUserRole,
    default: AppUserRole.USER,
    comment: '用户角色',
  })
  role!: AppUserRole;

  @Column({
    type: 'enum',
    enum: AppUserStatus,
    default: AppUserStatus.INACTIVE,
    comment: '用户状态',
  })
  status!: AppUserStatus;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '昵称' })
  nickname?: string;

  @Column({ type: 'varchar', length: 10, nullable: true, comment: '性别: male/female/other' })
  gender?: string;

  @Column({ type: 'date', nullable: true, comment: '生日' })
  birthDate?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '头像URL' })
  avatar?: string;

  @Column({ type: 'text', nullable: true, comment: '个人简介' })
  bio?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '所在地' })
  location?: string;

  // 婴儿相关信息
  @Column({ type: 'varchar', length: 36, nullable: true, comment: '主要关联的婴儿ID' })
  primaryBabyId?: string;

  @Column({ type: 'json', nullable: true, comment: '婴儿信息列表' })
  babies?: Array<{
    id: string;
    name: string;
    nickname?: string;
    birthDate: Date;
    gender?: string;
    relation: string; // father/mother/grandparent/other
  }>;

  // 设备绑定信息
  @Column({ type: 'json', nullable: true, comment: '绑定的设备列表' })
  devices?: Array<{
    deviceId: string;
    deviceName: string;
    deviceType: string;
    bindingTime: Date;
  }>;

  // 第三方账号绑定
  @Column({ type: 'json', nullable: true, comment: '第三方登录信息' })
  thirdPartyBindings?: {
    wechat?: { openid: string; unionid?: string };
    qq?: { openid: string };
    apple?: { sub: string; email?: string };
  };

  // 订阅信息
  @Column({ type: 'json', nullable: true, comment: '订阅信息' })
  subscription?: {
    plan: 'free' | 'premium' | 'enterprise';
    startDate?: Date;
    endDate?: Date;
    autoRenew: boolean;
  };

  // 通知设置
  @Column({ type: 'json', nullable: true, comment: '通知设置' })
  notificationSettings?: {
    email: boolean;
    sms: boolean;
    push: boolean;
    cryingAlert: boolean;
    movementAlert: boolean;
    feedingReminder: boolean;
    diaperChangeReminder: boolean;
  };

  @Column({ type: 'boolean', default: false, comment: '邮箱是否已验证' })
  emailVerified?: boolean;

  @Column({ type: 'boolean', default: false, comment: '手机号是否已验证' })
  phoneVerified?: boolean;

  @Column({ type: 'timestamp', nullable: true, comment: '最后登录时间' })
  lastLoginAt?: Date;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后登录IP' })
  lastLoginIp?: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
