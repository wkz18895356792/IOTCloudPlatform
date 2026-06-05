import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Domain } from './domain.entity';

/**
 * 域角色级别枚举
 */
export enum DomainRoleLevel {
  SUPER_ADMIN = 'super_admin',     // 超级管理员（平台级）
  DOMAIN_ADMIN = 'domain_admin',   // 域管理员
  DOMAIN_USER = 'domain_user',     // 域普通用户
  DOMAIN_GUEST = 'domain_guest',   // 域访客
}

/**
 * 域角色实体
 * 定义用户在域中的角色和权限
 */
@Entity('domain_roles')
@Index(['domainId'])
@Index(['userId'])
@Index(['domainId', 'userId'], { unique: true })
export class DomainRole {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'domainId', type: 'varchar', length: 36, comment: '域ID' })
  domainId!: string;

  @Column({ name: 'userId', type: 'varchar', length: 36, comment: '用户ID' })
  userId!: string;

  @Column({
    type: 'enum',
    enum: DomainRoleLevel,
    default: DomainRoleLevel.DOMAIN_USER,
    comment: '域角色级别',
  })
  role!: DomainRoleLevel;

  @Column({ name: 'customPermissions', type: 'json', nullable: true, comment: '自定义权限列表' })
  customPermissions!: string[];

  @Column({ name: 'expiresAt', type: 'timestamp', nullable: true, comment: '角色过期时间' })
  expiresAt!: Date;

  @Column({ name: 'isActive', type: 'boolean', default: true, comment: '是否激活' })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;

  // 关联关系
  @ManyToOne(() => Domain)
  @JoinColumn({ name: 'domainId' })
  domain!: Domain;
}
