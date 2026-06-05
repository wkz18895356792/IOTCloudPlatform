/**
 * JWT 认证中间件
 *
 * 验证请求中的 JWT Token，提取用户信息并注入到请求上下文。
 * 支持 accessToken 和 refreshToken 两种类型。
 *
 * 功能：
 * - 验证 JWT Token 签名和有效期
 * - 检查 Token 是否在黑名单中
 * - 提取用户信息（userId、username、role）
 * - 跳过公开路径（登录、注册等）
 * - 统一的错误响应格式
 *
 * Token 来源：
 * - Authorization 请求头（格式：Bearer {token}）
 */
import { Middleware, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { JwtService } from '@midwayjs/jwt';
import { RedisService } from '@midwayjs/redis';
import { ErrorCode, errorResponse } from '@baby-monitor/shared-types';

/**
 * 认证中间件
 * 验证 JWT Token（accessToken 或 refreshToken）
 * Token 由 user-service 生成，包含以下字段：
 * - userId: 用户ID
 * - username: 用户名（仅 accessToken）
 * - role: 用户角色（仅 accessToken）
 * - type: 'access' | 'refresh'
 */
@Middleware()
export class AuthMiddleware {
  @Inject()
  jwt!: JwtService;

  @Inject()
  redisService!: RedisService;

  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      const path = ctx.path;

      // 公开路径 - 精确匹配（防止 /api/auth/login123 绕过 /api/auth/login）
      const publicExactPaths = [
        // 认证相关
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/send-code',
        '/api/auth/verify-code',
        '/api/auth/refresh',
        '/api/auth/reset-password',
        '/api/auth/check-username',
        '/api/auth/check-email',
        '/api/auth/check-phone',
        '/api/auth/providers',
        // OAuth
        '/api/oauth/providers',
        '/api/oauth/authorize',
        '/api/oauth/callback',
        // 订阅
        '/api/subscription/plans',
        // 帮助中心
        '/api/help/articles',
        '/api/help/search',
        '/api/help/categories',
        // 铃声
        '/api/ringtones',
        // 系统
        '/health',
      ];

      // 公开路径 - 前缀匹配（ genuinely 需要匹配子路径的接口）
      const publicPrefixPaths = [
        '/swagger-ui',
        '/api/seed',
        '/api/storage/webhooks',  // 云存储事件回调（S3/COS/OSS），通过 webhook token 认证而非 JWT
      ];

      // 精确匹配：路径完全一致，或 path + '/' 开头（允许带尾部斜杠的子路径）
      const isExactMatch = publicExactPaths.some(p => path === p || path.startsWith(p + '/'));
      // 前缀匹配：允许子路径
      const isPrefixMatch = publicPrefixPaths.some(p => path.startsWith(p));

      if (isExactMatch || isPrefixMatch) {
        await next();
        return;
      }

      // 内部服务调用 - 通过 X-Service-API-Key 认证，跳过 JWT 校验
      const serviceApiKey = ctx.get('X-Service-API-Key');
      const expectedApiKey = process.env.SERVICE_API_KEY;
      if (serviceApiKey && expectedApiKey && serviceApiKey === expectedApiKey) {
        await next();
        return;
      }

      // 验证 JWT Token
      // 从 Authorization 请求头获取 token（格式：Bearer {token}）
      const token = ctx.get('Authorization')?.replace('Bearer ', '');
      console.log('[AuthMiddleware] 验证Token:', token?.substring(0, 20) + '...');

      // Token 不存在
      if (!token) {
        ctx.status = 401;
        ctx.body = errorResponse(ErrorCode.TOKEN_MISSING);
        return;
      }

      try {
        // 验证 Token 并解析用户信息
        const decoded = await this.jwt.verify(token) as any;
        console.log('[AuthMiddleware] Token验证通过，用户信息:', {
          userId: decoded.userId,
          username: decoded.username,
          role: decoded.role,
          type: decoded.type,
        });

        // 检查 Token 是否在黑名单中
        const isBlacklisted = await this.isTokenBlacklisted(token);
        if (isBlacklisted) {
          console.log('[AuthMiddleware] Token已失效（在黑名单中）');
          ctx.status = 401;
          ctx.body = errorResponse(ErrorCode.TOKEN_INVALID, 'Token已失效');
          return;
        }

        // 将解码后的用户信息注入到上下文，供后续中间件和控制器使用
        ctx.state.user = decoded;

        // 将原始 Token 也注入到上下文，用于后续操作（如登出时加入黑名单）
        ctx.state.token = token;

        await next();
      } catch (error: any) {
        console.log('[AuthMiddleware] Token验证失败:', error.message);
        ctx.status = 401;
        ctx.body = errorResponse(ErrorCode.TOKEN_INVALID, 'Token无效或已过期');
      }
    };
  }

  /**
   * 检查 Token 是否在黑名单中
   *
   * @param token JWT Token
   * @returns 如果 Token 在黑名单中返回 true
   */
  private async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      // 使用 SHA256 哈希作为键，与 user-service 保持一致
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const key = `token:blacklist:${hash}`;
      const result = await this.redisService.get(key);
      return result !== null;
    } catch (error) {
      console.error('[AuthMiddleware] 检查Token黑名单失败:', error);
      // Redis 不可用时，为安全起见视为已拉黑（拒绝访问）
      // 避免已登出用户在 Redis 故障期间绕过黑名单
      return true;
    }
  }
}
