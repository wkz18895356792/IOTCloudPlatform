import { Middleware } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { PermissionRequirement, ROLE_PERMISSIONS, DomainContext, PermissionAction } from '@baby-monitor/shared-types';

/**
 * 域权限检查中间件类
 * 用于检查用户是否有特定资源的操作权限
 */
@Middleware()
export class DomainPermissionMiddleware {
  private requirement: PermissionRequirement;

  constructor(requirement: PermissionRequirement) {
    this.requirement = requirement;
  }

  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      const domain = ctx.state.domain as DomainContext;
      const user = ctx.state.user;

      // 超级管理员拥有所有权限
      if (domain?.role === 'SUPER_ADMIN' || user?.role === 'SUPER_ADMIN') {
        await next();
        return;
      }

      // 检查域上下文
      if (!domain || !domain.id) {
        ctx.logger?.warn(`[DomainPermission] 域上下文缺失`);
        ctx.status = 403;
        ctx.body = {
          success: false,
          code: 'DOMAIN_CONTEXT_MISSING',
          message: '域上下文缺失',
        };
        return;
      }

      // 检查权限
      const hasPermission = await this.checkPermission(
        ctx,
        domain.id,
        domain.role,
        this.requirement
      );

      if (!hasPermission) {
        ctx.logger?.warn(
          `[DomainPermission] 权限拒绝: userId=${user?.userId}, ` +
          `domainId=${domain.id}, role=${domain.role}, ` +
          `required=${this.requirement.resource}:${this.requirement.action}`
        );

        ctx.status = 403;
        ctx.body = {
          success: false,
          code: 'PERMISSION_DENIED',
          message: '权限不足',
        };
        return;
      }

      await next();
    };
  }

  /**
   * 检查用户权限
   */
  private async checkPermission(
    ctx: Context,
    domainId: string,
    role: string,
    requirement: PermissionRequirement
  ): Promise<boolean> {
    try {
      // 检查预定义角色权限
      const rolePermissions = ROLE_PERMISSIONS[role];
      if (rolePermissions) {
        // 检查是否有所有权限（*）
        if (rolePermissions.includes('*')) {
          return true;
        }

        // 检查是否有特定权限
        const requiredPermission = `${requirement.resource}:${requirement.action}`;
        if (rolePermissions.includes(requiredPermission)) {
          return true;
        }

        // 检查是否有资源的管理权限（管理权限包含所有操作）
        const managePermission = `${requirement.resource}:${PermissionAction.MANAGE}`;
        if (rolePermissions.includes(managePermission)) {
          return true;
        }
      }

      // 从Redis缓存中获取自定义权限
      try {
        const redisService: any = ctx.app.getApplicationContext().get('redisService');
        const cacheKey = `domain:permission:${domainId}:${role}`;
        const cachedPermissions = await redisService.get(cacheKey);

        if (cachedPermissions) {
          const permissions = JSON.parse(cachedPermissions);
          return permissions.some(
            (p: any) => (p.resource === requirement.resource || p.resource === '*') &&
                       (p.action === requirement.action || p.action === '*') &&
                       p.allowed === true
          );
        }
      } catch (redisError) {
        // Redis 获取失败，继续返回 false
        ctx.logger?.error('[DomainPermission] Redis 获取失败:', redisError);
      }

      return false;
    } catch (error) {
      ctx.logger?.error('[DomainPermission] 权限检查失败:', error);
      return false;
    }
  }
}

/**
 * 域权限检查中间件工厂
 * 用于检查用户是否有特定资源的操作权限
 *
 * @example
 * ```typescript
 * @Post()
 * @Middleware(DomainPermission({ resource: 'device', action: 'create' }))
 * async createDevice() { ... }
 * ```
 */
export function DomainPermission(requirement: PermissionRequirement) {
  return new DomainPermissionMiddleware(requirement);
}

/**
 * 域数据过滤中间件
 * 确保查询操作只返回域内的数据
 * 用于需要在查询层面进行数据隔离的场景
 */
@Middleware()
export class DomainDataFilterMiddleware {
  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      const domain = ctx.state.domain as DomainContext;
      const user = ctx.state.user;

      // 超级管理员可以查看所有数据
      if (domain?.role === 'SUPER_ADMIN' || user?.role === 'SUPER_ADMIN') {
        await next();
        return;
      }

      // 如果有域上下文，添加域ID过滤
      if (domain && domain.id) {
        // 对于GET请求，将域ID添加到查询参数
        if (ctx.method === 'GET') {
          ctx.query = ctx.query || {};
          ctx.query.domainId = domain.id;
        }

        ctx.logger?.debug(`[DomainDataFilter] 数据过滤已应用: domainId=${domain.id}`);
      }

      await next();
    };
  }
}

/**
 * 域配额检查中间件类
 * 检查域是否已达到配额限制（用户数、设备数等）
 */
@Middleware()
export class DomainQuotaCheckMiddleware {
  private quotaType: 'user' | 'device' | 'storage';

  constructor(quotaType: 'user' | 'device' | 'storage') {
    this.quotaType = quotaType;
  }

  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      const domain = ctx.state.domain as DomainContext;

      // 超级管理员不受配额限制
      if (domain?.role === 'SUPER_ADMIN') {
        await next();
        return;
      }

      // 检查域上下文
      if (!domain || !domain.id) {
        ctx.status = 403;
        ctx.body = {
          success: false,
          code: 'DOMAIN_CONTEXT_MISSING',
          message: '域上下文缺失',
        };
        return;
      }

      // 从缓存获取域配额信息
      try {
        const redisService: any = ctx.app.getApplicationContext().get('redisService');
        const cacheKey = `domain:quota:${domain.id}`;
        const quota = await redisService.get(cacheKey);

        if (quota) {
          const quotaData = JSON.parse(quota);
          const currentUsage = quotaData[`${this.quotaType}Count`] || 0;
          const limit = quotaData[`${this.quotaType}Limit`] || 0;

          // 检查是否超过配额（0表示无限制）
          if (limit > 0 && currentUsage >= limit) {
            ctx.logger?.warn(
              `[DomainQuotaCheck] 配额已满: domainId=${domain.id}, ` +
              `type=${this.quotaType}, current=${currentUsage}, limit=${limit}`
            );

            ctx.status = 403;
            ctx.body = {
              success: false,
              code: 'QUOTA_EXCEEDED',
              message: `${this.quotaType}配额已满，无法继续创建`,
            };
            return;
          }
        }
      } catch (error) {
        // 缓存未命中或Redis错误，允许通过（实际应该调用DomainService获取）
        ctx.logger?.warn(`[DomainQuotaCheck] 域配额信息未找到或Redis错误: domainId=${domain.id}`);
      }

      await next();
    };
  }
}

/**
 * 域配额检查中间件工厂
 * 检查域是否已达到配额限制（用户数、设备数等）
 *
 * @param quotaType 配额类型
 */
export function DomainQuotaCheck(quotaType: 'user' | 'device' | 'storage') {
  return new DomainQuotaCheckMiddleware(quotaType);
}
