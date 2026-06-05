/**
 * 域相关类型定义
 * 定义多租户域管理相关的类型
 */

/**
 * 域状态枚举
 */
export enum DomainStatus {
  /** 活跃 - 域正常使用中 */
  ACTIVE = 'active',
  /** 暂停 - 域被暂停使用 */
  SUSPENDED = 'suspended',
  /** 已删除 - 域已被删除（软删除） */
  DELETED = 'deleted',
}

/**
 * 域类型枚举
 */
export enum DomainType {
  /** 试用版 - 试用期域 */
  TRIAL = 'trial',
  /** 标准版 - 标准功能域 */
  STANDARD = 'standard',
  /** 高级版 - 高级功能域 */
  PREMIUM = 'premium',
  /** 企业版 - 企业级域 */
  ENTERPRISE = 'enterprise',
}

/**
 * 域角色级别枚举
 */
export enum DomainRoleLevel {
  /** 超级管理员 - 平台级管理员，拥有所有权限 */
  SUPER_ADMIN = 'super_admin',
  /** 域管理员 - 域内管理员，可管理域内资源和用户 */
  DOMAIN_ADMIN = 'domain_admin',
  /** 域普通用户 - 域内普通用户 */
  DOMAIN_USER = 'domain_user',
  /** 域访客 - 域内只读用户 */
  DOMAIN_GUEST = 'domain_guest',
}

/**
 * 域实体接口
 */
export interface Domain {
  /** 域唯一标识ID */
  id: string;
  /** 域编码（唯一标识） */
  code: string;
  /** 域名称 */
  name: string;
  /** 域描述 */
  description?: string;
  /** 域类型 */
  type: DomainType;
  /** 域状态 */
  status: DomainStatus;
  /** 域所有者用户ID */
  ownerId: string;
  /** 用户数量限制（0表示无限制） */
  userLimit: number;
  /** 设备数量限制（0表示无限制） */
  deviceLimit: number;
  /** 存储空间限制（GB，0表示无限制） */
  storageLimit: number;
  /** 试用到期时间 */
  trialExpiresAt?: Date;
  /** 订阅到期时间 */
  subscriptionExpiresAt?: Date;
  /** 域配置（JSON格式） */
  config?: Record<string, any>;
  /** 最后删除时间（软删除） */
  deletedAt?: Date;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/**
 * 域角色实体接口
 */
export interface DomainRole {
  /** 角色唯一标识ID */
  id: string;
  /** 域ID */
  domainId: string;
  /** 用户ID */
  userId: string;
  /** 域角色级别 */
  role: DomainRoleLevel;
  /** 自定义权限列表 */
  customPermissions?: string[];
  /** 角色过期时间 */
  expiresAt?: Date;
  /** 是否激活 */
  isActive: boolean;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/**
 * 权限资源类型枚举
 */
export enum PermissionResource {
  /** 用户资源 */
  USER = 'user',
  /** 设备资源 */
  DEVICE = 'device',
  /** 宝宝资源 */
  BABY = 'baby',
  /** 域资源 */
  DOMAIN = 'domain',
  /** 设置资源 */
  SETTINGS = 'settings',
  /** 分析资源 */
  ANALYTICS = 'analytics',
  /** 家庭资源 */
  FAMILY = 'family',
}

/**
 * 权限操作类型枚举
 */
export enum PermissionAction {
  /** 创建 */
  CREATE = 'create',
  /** 读取 */
  READ = 'read',
  /** 更新 */
  UPDATE = 'update',
  /** 删除 */
  DELETE = 'delete',
  /** 管理 */
  MANAGE = 'manage',
  /** 导出 */
  EXPORT = 'export',
  /** 导入 */
  IMPORT = 'import',
}

/**
 * 域权限实体接口
 */
export interface DomainPermission {
  /** 权限唯一标识ID */
  id: string;
  /** 域ID */
  domainId: string;
  /** 角色名称 */
  role: string;
  /** 资源类型 */
  resource: PermissionResource;
  /** 操作类型 */
  action: PermissionAction;
  /** 是否允许 */
  allowed: boolean;
  /** 权限描述 */
  description?: string;
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 审计操作类型枚举
 */
export enum AuditAction {
  /** 创建域 */
  DOMAIN_CREATE = 'domain_create',
  /** 更新域 */
  DOMAIN_UPDATE = 'domain_update',
  /** 删除域 */
  DOMAIN_DELETE = 'domain_delete',
  /** 暂停域 */
  DOMAIN_SUSPEND = 'domain_suspend',
  /** 激活域 */
  DOMAIN_ACTIVATE = 'domain_activate',
  /** 添加用户 */
  USER_ADD = 'user_add',
  /** 移除用户 */
  USER_REMOVE = 'user_remove',
  /** 更改用户角色 */
  USER_ROLE_CHANGE = 'user_role_change',
  /** 授予权限 */
  PERMISSION_GRANT = 'permission_grant',
  /** 撤销权限 */
  PERMISSION_REVOKE = 'permission_revoke',
  /** 更改设置 */
  SETTINGS_CHANGE = 'settings_change',
  /** 更改配额 */
  QUOTA_CHANGE = 'quota_change',
}

/**
 * 域审计日志实体接口
 */
export interface DomainAuditLog {
  /** 日志唯一标识ID */
  id: string;
  /** 域ID */
  domainId: string;
  /** 操作用户ID */
  userId: string;
  /** 用户名 */
  username: string;
  /** 操作类型 */
  action: AuditAction;
  /** 操作详情 */
  details: string;
  /** IP地址 */
  ip?: string;
  /** 用户代理 */
  userAgent?: string;
  /** 额外数据 */
  metadata?: Record<string, any>;
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 域上下文接口
 * 在请求上下文中传递的域信息
 */
export interface DomainContext {
  /** 域ID */
  id: string;
  /** 域角色 */
  role: string;
  /** 权限列表（可选） */
  permissions?: string[];
}

/**
 * 权限要求接口
 */
export interface PermissionRequirement {
  /** 资源类型 */
  resource: string;
  /** 操作类型 */
  action: string;
}

/**
 * 预定义角色权限配置
 */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  /** 超级管理员 - 所有权限 */
  [DomainRoleLevel.SUPER_ADMIN]: ['*'],

  /** 域管理员权限 */
  [DomainRoleLevel.DOMAIN_ADMIN]: [
    `${PermissionResource.USER}:${PermissionAction.MANAGE}`,
    `${PermissionResource.DEVICE}:${PermissionAction.MANAGE}`,
    `${PermissionResource.BABY}:${PermissionAction.MANAGE}`,
    `${PermissionResource.DOMAIN}:${PermissionAction.UPDATE}`,
    `${PermissionResource.SETTINGS}:${PermissionAction.MANAGE}`,
    `${PermissionResource.ANALYTICS}:${PermissionAction.READ}`,
  ],

  /** 域普通用户权限 */
  [DomainRoleLevel.DOMAIN_USER]: [
    `${PermissionResource.DEVICE}:${PermissionAction.CREATE}`,
    `${PermissionResource.DEVICE}:${PermissionAction.READ}`,
    `${PermissionResource.DEVICE}:${PermissionAction.UPDATE}`,
    `${PermissionResource.BABY}:${PermissionAction.CREATE}`,
    `${PermissionResource.BABY}:${PermissionAction.READ}`,
    `${PermissionResource.BABY}:${PermissionAction.UPDATE}`,
    `${PermissionResource.FAMILY}:${PermissionAction.READ}`,
  ],

  /** 域访客权限 */
  [DomainRoleLevel.DOMAIN_GUEST]: [
    `${PermissionResource.DEVICE}:${PermissionAction.READ}`,
    `${PermissionResource.BABY}:${PermissionAction.READ}`,
  ],
};

/**
 * 创建域请求DTO
 */
export interface CreateDomainDTO {
  /** 域编码（唯一标识） */
  code: string;
  /** 域名称 */
  name: string;
  /** 域描述 */
  description?: string;
  /** 域类型 */
  type?: DomainType;
  /** 域所有者ID */
  ownerId?: string;
  /** 用户数量限制 */
  userLimit?: number;
  /** 设备数量限制 */
  deviceLimit?: number;
  /** 存储空间限制（GB） */
  storageLimit?: number;
  /** 域配置 */
  config?: Record<string, any>;
}

/**
 * 更新域请求DTO
 */
export interface UpdateDomainDTO {
  /** 域名称 */
  name?: string;
  /** 域描述 */
  description?: string;
  /** 域类型 */
  type?: DomainType;
  /** 域状态 */
  status?: DomainStatus;
  /** 用户数量限制 */
  userLimit?: number;
  /** 设备数量限制 */
  deviceLimit?: number;
  /** 存储空间限制（GB） */
  storageLimit?: number;
  /** 域配置 */
  config?: Record<string, any>;
}

/**
 * 添加用户到域DTO
 */
export interface AddUserToDomainDTO {
  /** 用户ID */
  userId: string;
  /** 角色 */
  role: DomainRoleLevel;
  /** 自定义权限列表 */
  customPermissions?: string[];
}

/**
 * 域查询参数DTO
 */
export interface DomainQueryDTO {
  /** 按域编码查询 */
  code?: string;
  /** 按状态查询 */
  status?: DomainStatus;
  /** 按类型查询 */
  type?: DomainType;
  /** 页码 */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
}

/**
 * 域统计信息接口
 */
export interface DomainStatistics {
  /** 用户数量 */
  userCount: number;
  /** 设备数量 */
  deviceCount: number;
  /** 存储使用量（GB） */
  storageUsed: number;
}
