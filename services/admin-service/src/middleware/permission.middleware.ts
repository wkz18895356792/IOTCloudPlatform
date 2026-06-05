import { Middleware, Inject, httpError } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ILogger } from '@midwayjs/logger';

/**
 * 用户角色枚举
 */
export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  OPERATOR = 'operator',
  READONLY = 'readonly',
  USER = 'user',
}

/**
 * 权限类型枚举
 */
export enum Permission {
  // 域管理权限
  DOMAIN_CREATE = 'domain:create',
  DOMAIN_READ = 'domain:read',
  DOMAIN_UPDATE = 'domain:update',
  DOMAIN_DELETE = 'domain:delete',

  // 用户管理权限
  USER_CREATE = 'user:create',
  USER_READ = 'user:read',
  USER_UPDATE = 'user:update',
  USER_DELETE = 'user:delete',

  // 设备管理权限
  DEVICE_CREATE = 'device:create',
  DEVICE_READ = 'device:read',
  DEVICE_UPDATE = 'device:update',
  DEVICE_DELETE = 'device:delete',

  // 系统管理权限
  SYSTEM_CONFIG = 'system:config',
  SYSTEM_MONITOR = 'system:monitor',
  SYSTEM_LOG = 'system:log',

  // 告警管理权限
  ALERT_VIEW = 'alert:view',
  ALERT_MANAGE = 'alert:manage',

  // 统计分析权限
  STATISTICS_VIEW = 'statistics:view',
  STATISTICS_EXPORT = 'statistics:export',
}

/**
 * 角色权限映射
 */
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: Object.values(Permission), // 超级管理员拥有所有权限
  [UserRole.ADMIN]: [
    Permission.DOMAIN_CREATE, Permission.DOMAIN_READ, Permission.DOMAIN_UPDATE, Permission.DOMAIN_DELETE,
    Permission.USER_CREATE, Permission.USER_READ, Permission.USER_UPDATE, Permission.USER_DELETE,
    Permission.DEVICE_CREATE, Permission.DEVICE_READ, Permission.DEVICE_UPDATE, Permission.DEVICE_DELETE,
    Permission.SYSTEM_CONFIG, Permission.SYSTEM_MONITOR, Permission.SYSTEM_LOG,
    Permission.ALERT_VIEW, Permission.ALERT_MANAGE,
    Permission.STATISTICS_VIEW, Permission.STATISTICS_EXPORT,
  ],
  [UserRole.OPERATOR]: [
    Permission.DOMAIN_READ,
    Permission.USER_READ, Permission.USER_UPDATE,
    Permission.DEVICE_READ, Permission.DEVICE_UPDATE,
    Permission.SYSTEM_MONITOR, Permission.SYSTEM_LOG,
    Permission.ALERT_VIEW, Permission.ALERT_MANAGE,
    Permission.STATISTICS_VIEW,
  ],
  [UserRole.READONLY]: [
    Permission.DOMAIN_READ,
    Permission.USER_READ,
    Permission.DEVICE_READ,
    Permission.SYSTEM_MONITOR,
    Permission.ALERT_VIEW,
    Permission.STATISTICS_VIEW,
  ],
  [UserRole.USER]: [],
};

/**
 * 权限验证中间件
 *
 * 用于验证用户是否具有执行特定操作的权限
 * 需要配合 @RequirePermission 装饰器使用
 */
@Middleware()
export class PermissionMiddleware {
  @Inject()
  logger!: ILogger;

  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      // 获取请求所需的权限（从 ctx.state 获取）
      const requiredPermission = ctx.state.requiredPermission as Permission | undefined;
      const requiredRole = ctx.state.requiredRole as UserRole | undefined;
      const requireSuperAdmin = ctx.state.requireSuperAdmin as boolean | undefined;

      // 如果没有设置权限要求，直接放行
      if (!requiredPermission && !requiredRole && !requireSuperAdmin) {
        return await next();
      }

      // 获取用户上下文
      const user = ctx.state.user;

      if (!user || !user.userId) {
        throw new httpError.UnauthorizedError('未授权访问：请先登录');
      }

      const userRole = user.role as UserRole;

      // 检查超级管理员要求
      if (requireSuperAdmin && userRole !== UserRole.SUPER_ADMIN) {
        this.logger.warn(`[PermissionMiddleware] 非超级管理员尝试访问: ${user.userId} -> ${ctx.path}`);
        throw new httpError.ForbiddenError('权限不足：需要超级管理员权限');
      }

      // 检查角色要求
      if (requiredRole) {
        const roleHierarchy = [UserRole.READONLY, UserRole.OPERATOR, UserRole.ADMIN, UserRole.SUPER_ADMIN];
        const userRoleIndex = roleHierarchy.indexOf(userRole);
        const requiredRoleIndex = roleHierarchy.indexOf(requiredRole);

        if (userRoleIndex < requiredRoleIndex) {
          this.logger.warn(`[PermissionMiddleware] 角色权限不足: ${user.userId} (${userRole}) -> 需要 ${requiredRole}`);
          throw new httpError.ForbiddenError(`权限不足：需要 ${requiredRole} 或更高角色`);
        }
      }

      // 检查具体权限
      if (requiredPermission) {
        const permissions = ROLE_PERMISSIONS[userRole] || [];

        if (!permissions.includes(requiredPermission)) {
          this.logger.warn(`[PermissionMiddleware] 权限不足: ${user.userId} (${userRole}) -> 需要 ${requiredPermission}`);
          throw new httpError.ForbiddenError(`权限不足：缺少 ${requiredPermission} 权限`);
        }
      }

      // 验证通过，记录日志
      this.logger.debug(`[PermissionMiddleware] 权限验证通过: ${user.userId} (${userRole}) -> ${ctx.path}`);

      return await next();
    };
  }
}

/**
 * 权限要求装饰器工厂
 *
 * 使用方式：
 * ```typescript
 * @Get('/domains')
 * @RequirePermission(Permission.DOMAIN_READ)
 * async getDomains() { ... }
 * ```
 */
export function RequirePermission(permission: Permission): MethodDecorator {
  return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const ctx = args[0]?.ctx || args[0];
      if (ctx && ctx.state) {
        ctx.state.requiredPermission = permission;
      }
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * 角色要求装饰器工厂
 *
 * 使用方式：
 * ```typescript
 * @Get('/admin/users')
 * @RequireRole(UserRole.ADMIN)
 * async getUsers() { ... }
 * ```
 */
export function RequireRole(role: UserRole): MethodDecorator {
  return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const ctx = args[0]?.ctx || args[0];
      if (ctx && ctx.state) {
        ctx.state.requiredRole = role;
      }
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * 超级管理员要求装饰器
 *
 * 使用方式：
 * ```typescript
 * @Delete('/system/reset')
 * @RequireSuperAdmin()
 * async resetSystem() { ... }
 * ```
 */
export function RequireSuperAdmin(): MethodDecorator {
  return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const ctx = args[0]?.ctx || args[0];
      if (ctx && ctx.state) {
        ctx.state.requireSuperAdmin = true;
      }
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * 域管理员要求装饰器
 *
 * 验证用户是否是指定域的管理员
 */
export function RequireDomainAdmin(): MethodDecorator {
  return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const ctx = args[0]?.ctx || args[0];
      if (ctx && ctx.state) {
        ctx.state.requireDomainAdmin = true;
      }
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
