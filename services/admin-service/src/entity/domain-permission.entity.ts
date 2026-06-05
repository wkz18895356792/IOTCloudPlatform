import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * 权限资源类型枚举
 */
export enum PermissionResource {
  USER = 'user',
  DEVICE = 'device',
  BABY = 'baby',
  DOMAIN = 'domain',
  SETTINGS = 'settings',
  ANALYTICS = 'analytics',
  FAMILY = 'family',
}

/**
 * 权限操作类型枚举
 */
export enum PermissionAction {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  MANAGE = 'manage',
  EXPORT = 'export',
  IMPORT = 'import',
}

/**
 * 域权限实体
 * 定义不同角色对资源的访问权限
 */
@Entity('domain_permissions')
@Index(['domainId'])
@Index(['role'])
export class DomainPermission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36, comment: '域ID' })
  domainId!: string;

  @Column({ type: 'varchar', length: 64, comment: '角色名称' })
  role!: string;

  @Column({
    type: 'enum',
    enum: PermissionResource,
    comment: '资源类型',
  })
  resource!: PermissionResource;

  @Column({
    type: 'enum',
    enum: PermissionAction,
    comment: '操作类型',
  })
  action!: PermissionAction;

  @Column({ type: 'boolean', default: true, comment: '是否允许' })
  allowed!: boolean;

  @Column({ type: 'text', nullable: true, comment: '权限描述' })
  description!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
