/**
 * 速率限制中间件
 *
 * 对请求进行速率限制检查，防止 API 被过度调用。
 * 同时支持 IP 级别和用户级别的限制。
 *
 * 限制策略：
 * - IP 限制：每个 IP 地址独立计算
 * - 用户限制：每个用户 ID 独立计算
 * - 响应头：返回速率限制信息供客户端参考
 *
 * 超限时返回 429 状态码和重试时间。
 */
import { Middleware, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { RateLimitService } from '../service/rate-limit.service';

@Middleware()
export class RateLimitMiddleware {
  @Inject()
  rateLimitService!: RateLimitService;

  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      const { path, ip, state } = ctx;
      const method = ctx.method;

      // 获取用户标识（优先使用用户 ID，否则使用 IP）
      const userId = state.user?.userId || ip;

      // 检查 IP 级别的速率限制
      const ipResult = await this.rateLimitService.checkIPLimit(ip, path);

      // IP 限制超限
      if (!ipResult.allowed) {
        ctx.status = 429; // Too Many Requests
        ctx.body = {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests from this IP',
            retryAfter: ipResult.retryAfter,
          },
        };
        // 设置速率限制响应头
        ctx.set('X-RateLimit-Limit', ipResult.limit.toString());
        ctx.set('X-RateLimit-Remaining', ipResult.remaining.toString());
        ctx.set('X-RateLimit-Reset', ipResult.reset.toString());
        if (ipResult.retryAfter) {
          ctx.set('Retry-After', ipResult.retryAfter.toString());
        }
        return;
      }

      // 如果已认证，检查用户级别的速率限制
      if (state.user?.userId) {
        const userResult = await this.rateLimitService.checkUserLimit(state.user.userId, path);

        // 用户限制超限
        if (!userResult.allowed) {
          ctx.status = 429;
          ctx.body = {
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests from this user',
              retryAfter: userResult.retryAfter,
            },
          };
          ctx.set('X-RateLimit-Limit', userResult.limit.toString());
          ctx.set('X-RateLimit-Remaining', userResult.remaining.toString());
          ctx.set('X-RateLimit-Reset', userResult.reset.toString());
          if (userResult.retryAfter) {
            ctx.set('Retry-After', userResult.retryAfter.toString());
          }
          return;
        }

        // 使用用户限制信息设置响应头
        ctx.set('X-RateLimit-Limit', userResult.limit.toString());
        ctx.set('X-RateLimit-Remaining', userResult.remaining.toString());
        ctx.set('X-RateLimit-Reset', userResult.reset.toString());
      } else {
        // 使用 IP 限制信息设置响应头
        ctx.set('X-RateLimit-Limit', ipResult.limit.toString());
        ctx.set('X-RateLimit-Remaining', ipResult.remaining.toString());
        ctx.set('X-RateLimit-Reset', ipResult.reset.toString());
      }

      await next();
    };
  }
}
