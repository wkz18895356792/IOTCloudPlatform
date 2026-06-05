import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, OneToMany } from 'typeorm';
import { UserStatus, UserRole } from '@baby-monitor/shared-types';
import { UserDevice } from './user-device.entity';

@Entity('users')
@Index(['username'], { unique: true })
@Index(['email'], { unique: true })
@Index(['phone'], { unique: true })
@Index(['status'])
@Index(['domainId'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, comment: '用户名' })
  username!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '邮箱' })
  email!: string;

  @Column({ type: 'varchar', length: 20, nullable: true, comment: '手机号' })
  phone!: string;

  @Column({ type: 'varchar', length: 256, nullable: true, comment: '密码哈希' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '昵称' })
  nickname!: string;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '头像URL' })
  avatar!: string;

  @Column({
    type: 'enum',
    enum: ['male', 'female', 'other'],
    nullable: true,
    comment: '性别',
  })
  gender!: 'male' | 'female' | 'other';

  @Column({ type: 'date', nullable: true, comment: '出生日期' })
  birthDate!: Date;

  @Column({ type: 'varchar', length: 256, nullable: true, comment: '所在地' })
  location!: string;

  @Column({ type: 'text', nullable: true, comment: '个人简介' })
  bio!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
    comment: '用户角色',
  })
  role!: UserRole;

  @Column({ type: 'varchar', length: 36, nullable: true, comment: '所属域ID' })
  domainId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '域角色' })
  domainRole!: string;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
    comment: '用户状态',
  })
  status!: UserStatus;

  @Column({ type: 'boolean', default: false, comment: '邮箱是否已验证' })
  emailVerified!: boolean;

  @Column({ type: 'boolean', default: false, comment: '手机是否已验证' })
  phoneVerified!: boolean;

  @Column({ type: 'timestamp', nullable: true, comment: '最后登录时间' })
  lastLoginAt!: Date;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后登录IP' })
  lastLoginIp!: string;

  /**
   * User's devices (relationship to user_devices table)
   * Loaded eagerly when needed for device management operations
   */
  @OneToMany(() => UserDevice, (userDevice) => userDevice.user, { cascade: true })
  userDevices?: UserDevice[];

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
