import { Middleware, IMiddleware, Inject } from '@midwayjs/core';
import { NextFunction, Context } from '@midwayjs/koa';
import { ILogger } from '@midwayjs/logger';
import { PERMISSION_CONFIG, ROLE_PERMISSIONS, PUBLIC_PATHS, RESOURCE_CHECK_PATHS } from '../config/permission.config';
import { UserRole } from '@baby-monitor/shared-types';
import axios from 'axios';

/**
 * 用户信息接口
 */
interface UserInfo {
  userId: string;
  role: UserRole;
  username?: string;
}

/**
 * 权限检查中间件
 *
 * 实现基于角色的访问控制 (RBAC) 和资源级权限检查
 *
 * 主要功能：
 * - 检查用户是否拥有访问路径所需的角色权限
 * - 对特定资源（设备、家庭、宝宝）进行资源级权限验证
 * - 跳过公开路径的权限检查
 */
@Middleware()
export class PermissionMiddleware implements IMiddleware<Context, NextFunction> {
  @Inject()
  logger!: ILogger;

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const path = ctx.path;
      const method = ctx.method.toUpperCase();

      // 1. 检查是否为公开路径
      if (this.isPublicPath(path)) {
        await next();
        return;
      }

      // 2. 获取用户信息（由 AuthMiddleware 注入）
      const user = ctx.state.user as UserInfo;
      if (!user || !user.userId) {
        ctx.status = 401;
        ctx.body = {
          error: '未认证',
          code: 'UNAUTHORIZED',
        };
        return;
      }

      // 3. 检查权限
      const permissionCheckResult = await this.checkPermission(user, method, path, ctx);
      if (!permissionCheckResult.allowed) {
        ctx.status = 403;
        ctx.body = {
          error: '权限不足',
          code: 'FORBIDDEN',
          reason: permissionCheckResult.reason,
        };
        this.logger.warn(`[PermissionMiddleware] 权限拒绝: 用户=${user.username || user.userId}, 路径=${method} ${path}, 原因=${permissionCheckResult.reason}`);
        return;
      }

      await next();
    };
  }

  /**
   * 检查是否为公开路径
   */
  private isPublicPath(path: string): boolean {
    return PUBLIC_PATHS.some(publicPath => {
      if (publicPath.endsWith('*')) {
        return path.startsWith(publicPath.slice(0, -1));
      }
      return path === publicPath || path.startsWith(publicPath + '/');
    });
  }

  /**
   * 检查用户权限
   */
  private async checkPermission(
    user: UserInfo,
    method: string,
    path: string,
    ctx: Context
  ): Promise<{ allowed: boolean; reason?: string }> {
    // 1. 管理员拥有所有权限
    if (user.role === UserRole.ADMIN) {
      return { allowed: true };
    }

    // 2. 获取角色权限列表
    const rolePermissions = ROLE_PERMISSIONS[user.role] || [];

    // 3. 检查是否有通配符权限
    if (rolePermissions.includes('*')) {
      // 仍然需要检查资源级权限
      const resourceCheck = await this.checkResourcePermission(user, path, ctx);
      return resourceCheck;
    }

    // 4. 获取路径所需权限
    const requiredPermissions = this.getRequiredPermissions(method, path);

    // 5. 如果路径没有配置权限，默认允许（白名单模式）
    if (requiredPermissions.length === 0) {
      return { allowed: true };
    }

    // 6. 检查角色是否拥有所需权限
    const hasRolePermission = requiredPermissions.some(perm =>
      rolePermissions.includes(perm)
    );

    if (!hasRolePermission) {
      return {
        allowed: false,
        reason: `角色 ${user.role} 缺少权限: ${requiredPermissions.join(', ')}`,
      };
    }

    // 7. 检查资源级权限（设备、家庭等）
    const resourceCheck = await this.checkResourcePermission(user, path, ctx);
    return resourceCheck;
  }

  /**
   * 获取路径所需权限
   */
  private getRequiredPermissions(method: string, path: string): string[] {
    // 匹配精确路径
    if (PERMISSION_CONFIG[path]) {
      const config = PERMISSION_CONFIG[path];
      if ('ALL' in config) {
        return config.ALL;
      }
      return config[method] || [];
    }

    // 匹配动态路径（如 /api/devices/:id）
    for (const [route, config] of Object.entries(PERMISSION_CONFIG)) {
      if (this.matchRoute(route, path)) {
        if ('ALL' in config) {
          return config.ALL;
        }
        return config[method] || [];
      }
    }

    return []; // 未配置的路径默认不需要权限
  }

  /**
   * 匹配路由
   * 支持动态参数，如 /api/devices/:id
   */
  private matchRoute(route: string, path: string): boolean {
    const routeParts = route.split('/');
    const pathParts = path.split('/');

    if (routeParts.length !== pathParts.length) {
      return false;
    }

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        continue; // 动态参数匹配
      }
      if (routeParts[i] !== pathParts[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * 检查资源级权限
   * 检查用户是否有权限访问特定的资源（如设备、家庭、宝宝）
   */
  private async checkResourcePermission(
    user: UserInfo,
    path: string,
    ctx: Context
  ): Promise<{ allowed: boolean; reason?: string }> {
    // 跳过集合类路径（不需要检查特定资源权限）
    const collectionPaths = [
      '/api/devices/groups',
      '/api/devices/shares',
      '/api/devices/scenes',
      '/api/devices/viewable',
    ];
    if (collectionPaths.some(p => path.startsWith(p))) {
      return { allowed: true };
    }

    // 检查设备资源权限（排除集合路径后的设备特定路径）
    const deviceMatch = path.match(/^\/api\/devices\/([^/]+)(?:\/|$)/);
    if (deviceMatch) {
      const deviceId = deviceMatch[1];
      return await this.checkDevicePermission(user.userId, deviceId, ctx);
    }

    // 检查家庭资源权限
    const familyMatch = path.match(/^\/api\/families\/([^/]+)(?:\/|$)/);
    if (familyMatch) {
      const familyId = familyMatch[1];
      return await this.checkFamilyPermission(user.userId, familyId, ctx);
    }

    // 检查宝宝资源权限
    const babyMatch = path.match(/^\/api\/babies\/([^/]+)(?:\/|$)/);
    if (babyMatch) {
      const babyId = babyMatch[1];
      return await this.checkBabyPermission(user.userId, babyId, ctx);
    }

    return { allowed: true };
  }

  /**
   * 检查用户是否有设备权限
   */
  private async checkDevicePermission(
    userId: string,
    deviceId: string,
    ctx: Context
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      // 调用 device-service 检查用户是否有该设备的权限
      const deviceServiceUrl = this.getServiceUrl('device-service');
      if (!deviceServiceUrl) {
        this.logger.error('[PermissionMiddleware] device-service URL not found');
        return { allowed: false, reason: '设备服务不可用' };
      }

      const response = await axios({
        method: 'GET',
        url: `${deviceServiceUrl}/api/devices/${deviceId}/permissions/${userId}`,
        headers: {
          'X-Internal-Request': 'true', // 标记为内部请求
        },
        timeout: 5000, // 5秒超时
      });

      if (response.data?.hasPermission) {
        return { allowed: true };
      }

      return { allowed: false, reason: '您没有权限访问此设备' };
    } catch (error: any) {
      this.logger.error(`[PermissionMiddleware] 检查设备权限失败: ${error.message}`);
      // 如果检查失败，根据错误类型决定是否允许
      if (error.response?.status === 404) {
        // 设备不存在，返回 404 而不是 403
        return { allowed: false, reason: '设备不存在' };
      }
      // 其他错误，为安全起见默认拒绝
      return { allowed: false, reason: '权限检查失败' };
    }
  }

  /**
   * 检查用户是否有家庭权限
   */
  private async checkFamilyPermission(
    userId: string,
    familyId: string,
    ctx: Context
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      // 调用 user-service 检查用户是否是家庭成员
      const userServiceUrl = this.getServiceUrl('user-service');
      if (!userServiceUrl) {
        this.logger.error('[PermissionMiddleware] user-service URL not found');
        return { allowed: false, reason: '用户服务不可用' };
      }

      const response = await axios({
        method: 'GET',
        url: `${userServiceUrl}/api/families/${familyId}/members/${userId}`,
        headers: {
          'X-Internal-Request': 'true',
        },
        timeout: 5000,
      });

      if (response.status === 200) {
        return { allowed: true };
      }

      return { allowed: false, reason: '您不是该家庭的成员' };
    } catch (error: any) {
      this.logger.error(`[PermissionMiddleware] 检查家庭权限失败: ${error.message}`);
      if (error.response?.status === 404) {
        return { allowed: false, reason: '家庭不存在或您不是成员' };
      }
      return { allowed: false, reason: '权限检查失败' };
    }
  }

  /**
   * 检查用户是否有宝宝数据权限
   */
  private async checkBabyPermission(
    userId: string,
    babyId: string,
    ctx: Context
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      // 调用 baby-service 检查用户是否有权限访问该宝宝数据
      const babyServiceUrl = this.getServiceUrl('baby-service');
      if (!babyServiceUrl) {
        this.logger.error('[PermissionMiddleware] baby-service URL not found');
        return { allowed: false, reason: '宝宝服务不可用' };
      }

      const response = await axios({
        method: 'GET',
        url: `${babyServiceUrl}/api/babies/${babyId}/permissions/${userId}`,
        headers: {
          'X-Internal-Request': 'true',
        },
        timeout: 5000,
      });

      if (response.data?.hasPermission) {
        return { allowed: true };
      }

      return { allowed: false, reason: '您没有权限访问此宝宝的数据' };
    } catch (error: any) {
      this.logger.error(`[PermissionMiddleware] 检查宝宝权限失败: ${error.message}`);
      if (error.response?.status === 404) {
        return { allowed: false, reason: '宝宝记录不存在' };
      }
      return { allowed: false, reason: '权限检查失败' };
    }
  }

  /**
   * 获取服务 URL
   */
  private getServiceUrl(serviceName: string): string | null {
    // 从环境变量或配置中获取服务 URL
    const serviceUrls: Record<string, string> = {
      'device-service': process.env.DEVICE_SERVICE_URL || 'http://localhost:6003',
      'user-service': process.env.USER_SERVICE_URL || 'http://localhost:6002',
      'baby-service': process.env.BABY_SERVICE_URL || 'http://localhost:6008',
    };

    return serviceUrls[serviceName] || null;
  }
}
