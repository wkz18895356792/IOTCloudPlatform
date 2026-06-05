import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * 审计操作类型枚举
 */
export enum AuditAction {
  DOMAIN_CREATE = 'domain_create',
  DOMAIN_UPDATE = 'domain_update',
  DOMAIN_DELETE = 'domain_delete',
  DOMAIN_SUSPEND = 'domain_suspend',
  DOMAIN_ACTIVATE = 'domain_activate',
  USER_ADD = 'user_add',
  USER_REMOVE = 'user_remove',
  USER_ROLE_CHANGE = 'user_role_change',
  PERMISSION_GRANT = 'permission_grant',
  PERMISSION_REVOKE = 'permission_revoke',
  SETTINGS_CHANGE = 'settings_change',
  QUOTA_CHANGE = 'quota_change',
}

/**
 * 域审计日志实体
 * 记录域相关的重要操作
 */
@Entity('domain_audit_logs')
@Index(['domainId'])
@Index(['userId'])
@Index(['action'])
@Index(['createdAt'])
export class DomainAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36, comment: '域ID' })
  domainId!: string;

  @Column({ type: 'varchar', length: 36, comment: '操作用户ID' })
  userId!: string;

  @Column({ type: 'varchar', length: 128, comment: '用户名' })
  username!: string;

  @Column({
    type: 'enum',
    enum: AuditAction,
    comment: '操作类型',
  })
  action!: AuditAction;

  @Column({ type: 'text', comment: '操作详情' })
  details!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'IP地址' })
  ip!: string;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '用户代理' })
  userAgent!: string;

  @Column({ type: 'json', nullable: true, comment: '额外数据' })
  metadata!: Record<string, any>;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
