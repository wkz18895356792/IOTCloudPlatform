/**
 * 请求日志中间件
 *
 * 记录所有通过 API 网关的请求和响应信息。
 * 为每个请求生成唯一的 ID 用于追踪。
 *
 * 功能：
 * - 生成唯一请求 ID
 * - 记录请求详情（方法、路径、头部、体等）
 * - 记录响应详情（状态码、耗时、大小等）
 * - 记录错误信息和堆栈
 * - 自动脱敏敏感信息
 *
 * 响应头：
 * - X-Request-ID：请求唯一标识
 * - X-Response-Time：请求处理时间（毫秒）
 */
import { Middleware, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { RequestLoggerService } from '../service/request-logger.service';

@Middleware()
export class RequestLoggerMiddleware {
  @Inject()
  requestLoggerService!: RequestLoggerService;

  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      const startTime = Date.now();

      // 生成唯一的请求 ID（用于追踪和关联日志）
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      ctx.state.requestId = requestId; // 存储到上下文供其他中间件使用
      ctx.set('X-Request-ID', requestId); // 返回给客户端

      // 记录请求信息
      await this.requestLoggerService.logRequest({
        method: ctx.method,
        path: ctx.path,
        query: ctx.query,
        headers: ctx.headers as Record<string, string>,
        body: ctx.request.body,
        ip: ctx.ip,
        userAgent: ctx.get('User-Agent'),
        userId: ctx.state.user?.userId, // 从认证中间件获取用户信息
        requestId,
      });

      try {
        await next();

        // 记录响应信息
        const duration = Date.now() - startTime;
        await this.requestLoggerService.logResponse(requestId, {
          statusCode: ctx.status,
          headers: ctx.response.headers as Record<string, string>,
          body: ctx.body,
          duration,
          size: ctx.length,
        });

        // 在响应头中添加处理时间
        ctx.set('X-Response-Time', `${duration}ms`);
      } catch (error) {
        const duration = Date.now() - startTime;
        const err = error as Error;

        // 记录错误信息
        await this.requestLoggerService.logError(requestId, err);
        await this.requestLoggerService.logResponse(requestId, {
          statusCode: ctx.status || 500,
          duration,
        });

        // 重新抛出错误，让上层处理
        throw error;
      }
    };
  }
}
