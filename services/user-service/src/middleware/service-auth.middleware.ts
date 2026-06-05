/**
 * 服务间API认证中间件
 *
 * 用于保护内部API端点，确保只有合法的服务可以调用
 */

import { Middleware, IMiddleware, Config } from '@midwayjs/core';
import { NextFunction, Context } from '@midwayjs/koa';

/**
 * 服务API认证中间件
 *
 * 验证请求中的X-Service-API-Key头部，确保请求来自合法的服务
 */
@Middleware()
export class ServiceAuthMiddleware implements IMiddleware<Context, NextFunction> {
  @Config('serviceClient')
  serviceClientConfig: any;

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      // 获取API Key
      const apiKey = ctx.headers['x-service-api-key'] as string;

      // 验证API Key
      if (!apiKey || apiKey !== this.serviceClientConfig?.apiKey) {
        ctx.status = 401;
        ctx.body = {
          success: false,
          error: 'Unauthorized: Invalid API Key',
        };
        return;
      }

      // 记录服务间调用
      ctx.logger.info(`[ServiceAuth] API call from service: ${ctx.headers['x-service-name'] || 'unknown'}`);

      await next();
    };
  }
}
