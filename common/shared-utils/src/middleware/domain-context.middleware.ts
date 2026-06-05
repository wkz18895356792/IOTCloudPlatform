import { Middleware } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { DomainContext } from '@baby-monitor/shared-types';

/**
 * 域上下文中间件
 * 从JWT Token中提取域信息并注入到请求上下文
 * 这是所有需要域隔离功能的服务都需要使用的中间件
 */
@Middleware()
export class DomainContextMiddleware {
  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      // 从认证中间件注入的用户信息中获取域信息
      const user = ctx.state.user;

      if (user && (user.domainId || user.role === 'SUPER_ADMIN')) {
        // 将域信息注入到上下文
        ctx.state.domain = {
          id: user.domainId || '',
          role: user.domainRole || user.role || 'DOMAIN_USER',
        } as DomainContext;

        if (ctx.logger) {
          ctx.logger.debug(`[DomainContext] 域上下文已注入: ${JSON.stringify(ctx.state.domain)}`);
        }
      }

      await next();
    };
  }
}

/**
 * 域管理员权限检查中间件类
 * 用于要求域管理员权限的API端点
 */
@Middleware()
export class RequireDomainAdminMiddleware {
  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      const user = ctx.state.user;
      const domain = ctx.state.domain;

      // 检查是否是超级管理员或域管理员
      const isAdmin = user?.role === 'SUPER_ADMIN' ||
                      user?.role === 'ADMIN' ||
                      domain?.role === 'SUPER_ADMIN' ||
                      domain?.role === 'DOMAIN_ADMIN';

      if (!isAdmin) {
        ctx.logger?.warn(`[RequireDomainAdmin] 权限拒绝: userId=${user?.userId}, role=${domain?.role}`);

        ctx.status = 403;
        ctx.body = {
          success: false,
          code: 'PERMISSION_DENIED',
          message: '需要域管理员权限',
        };
        return;
      }

      await next();
    };
  }
}

/**
 * 超级管理员权限检查中间件类
 * 用于要求超级管理员权限的API端点
 */
@Middleware()
export class RequireSuperAdminMiddleware {
  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      const user = ctx.state.user;
      const domain = ctx.state.domain;

      // 检查是否是超级管理员
      const isSuperAdmin = user?.role === 'SUPER_ADMIN' ||
                           domain?.role === 'SUPER_ADMIN';

      if (!isSuperAdmin) {
        ctx.logger?.warn(`[RequireSuperAdmin] 权限拒绝: userId=${user?.userId}, role=${domain?.role}`);

        ctx.status = 403;
        ctx.body = {
          success: false,
          code: 'PERMISSION_DENIED',
          message: '需要超级管理员权限',
        };
        return;
      }

      await next();
    };
  }
}

/**
 * 域成员检查中间件类
 * 确保用户是域的成员（非域外用户）
 */
@Middleware()
export class RequireDomainMemberMiddleware {
  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      const user = ctx.state.user;
      const domain = ctx.state.domain;

      // 超级管理员可以访问所有域
      if (user?.role === 'SUPER_ADMIN' || domain?.role === 'SUPER_ADMIN') {
        await next();
        return;
      }

      // 检查是否有域上下文
      if (!domain || !domain.id) {
        ctx.logger?.warn(`[RequireDomainMember] 域上下文缺失: userId=${user?.userId}`);

        ctx.status = 403;
        ctx.body = {
          success: false,
          code: 'DOMAIN_CONTEXT_MISSING',
          message: '域上下文缺失',
        };
        return;
      }

      await next();
    };
  }
}

// 工厂函数包装，用于保持API兼容性
export function RequireDomainAdmin() {
  return RequireDomainAdminMiddleware;
}

export function RequireSuperAdmin() {
  return RequireSuperAdminMiddleware;
}

export function RequireDomainMember() {
  return RequireDomainMemberMiddleware;
}
