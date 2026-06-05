/**
 * 服务间API认证中间件
 *
 * 用于保护内部API端点，确保只有携带合法 Service API Key 的请求可以调用
 * Device Gateway 等内部服务通过 ServiceClient 调用时自动携带 X-Service-API-Key
 */

import { Middleware, IMiddleware, Config } from '@midwayjs/core';
import { NextFunction, Context } from '@midwayjs/koa';

@Middleware()
export class ServiceAuthMiddleware implements IMiddleware<Context, NextFunction> {
  @Config('serviceClient')
  serviceClientConfig: any;

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const apiKey = ctx.headers['x-service-api-key'] as string;

      if (!apiKey || apiKey !== this.serviceClientConfig?.apiKey) {
        ctx.status = 401;
        ctx.body = {
          code: 401,
          success: false,
          message: 'Unauthorized: Invalid or missing Service API Key',
        };
        return;
      }

      await next();
    };
  }
}
