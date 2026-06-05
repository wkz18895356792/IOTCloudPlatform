import { Middleware, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ILogger } from '@midwayjs/logger';
import { ErrorCode, errorResponse } from '@baby-monitor/shared-types';

/**
 * 全局错误处理中间件
 * 统一捕获和处理应用中的所有错误
 *
 * 使用方式：
 * 1. 在 configuration.ts 中通过 app.useMiddleware() 注册
 * 2. 必须在所有其他中间件之后注册
 */
@Middleware()
export class GlobalErrorMiddleware {
  @Inject()
  logger!: ILogger;

  static getName(): string {
    return 'global-error';
  }

  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      try {
        await next();
      } catch (error: any) {
        // 记录错误日志
        const errorLog = {
          path: ctx.path,
          method: ctx.method,
          query: ctx.query,
          body: ctx.request.body,
          headers: this.sanitizeHeaders(ctx.headers),
          user: ctx.state.user?.userId || 'anonymous',
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: error.code,
          },
          timestamp: new Date().toISOString(),
        };

        this.logger.error('[GlobalError] Unhandled error:', JSON.stringify(errorLog, null, 2));

        // 根据错误类型确定响应
        const response = this.handleError(error);

        // 设置响应状态码
        ctx.status = this.getStatusCode(error);

        // 设置响应体
        ctx.body = response;
      }
    };
  }

  /**
   * 处理错误并生成响应
   */
  private handleError(error: any): any {
    // 自定义业务错误
    if (error.code && typeof error.code === 'number') {
      return errorResponse(error.code, error.message);
    }

    // HTTP 错误
    if (error.status || error.statusCode) {
      const statusCode = error.status || error.statusCode;
      const errorCode = this.httpStatusToErrorCode(statusCode);
      return errorResponse(errorCode, error.message);
    }

    // 验证错误
    if (error.name === 'ValidationError') {
      return errorResponse(ErrorCode.INVALID_PARAMS, error.message);
    }

    // 数据库错误
    if (error.name === 'QueryFailedError') {
      // 不暴露数据库详细信息给客户端
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '数据操作失败');
    }

    // JWT 错误
    if (error.name === 'JsonWebTokenError') {
      return errorResponse(ErrorCode.UNAUTHORIZED, '无效的认证令牌');
    }

    if (error.name === 'TokenExpiredError') {
      return errorResponse(ErrorCode.TOKEN_EXPIRED, '认证令牌已过期');
    }

    // 默认内部服务器错误
    return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '服务器内部错误');
  }

  /**
   * 将HTTP状态码转换为错误码
   */
  private httpStatusToErrorCode(statusCode: number) {
    switch (statusCode) {
      case 400:
        return ErrorCode.INVALID_REQUEST;
      case 401:
        return ErrorCode.UNAUTHORIZED;
      case 403:
        return ErrorCode.PERMISSION_DENIED;
      case 404:
        return ErrorCode.RESOURCE_NOT_FOUND;
      case 409:
        return ErrorCode.RESOURCE_CONFLICT;
      case 429:
        return ErrorCode.RATE_LIMIT_EXCEEDED;
      default:
        return ErrorCode.INTERNAL_SERVER_ERROR;
    }
  }

  /**
   * 获取HTTP状态码
   */
  private getStatusCode(error: any): number {
    if (error.status || error.statusCode) {
      return error.status || error.statusCode;
    }

    // 根据错误码映射HTTP状态码
    if (error.code) {
      switch (error.code) {
        case ErrorCode.UNAUTHORIZED:
        case ErrorCode.TOKEN_EXPIRED:
          return 401;
        case ErrorCode.PERMISSION_DENIED:
          return 403;
        case ErrorCode.RESOURCE_NOT_FOUND:
          return 404;
        case ErrorCode.RESOURCE_CONFLICT:
        case ErrorCode.RESOURCE_ALREADY_EXISTS:
          return 409;
        default:
          return 400;
      }
    }

    return 500;
  }

  /**
   * 清理敏感的请求头信息
   */
  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...headers };

    // 移除或脱敏敏感头信息
    const sensitiveHeaders = ['authorization', 'cookie', 'set-cookie'];
    for (const key of Object.keys(sanitized)) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '***REDACTED***';
      }
    }

    return sanitized;
  }
}

/**
 * 自定义错误类
 * 用于抛出带有特定错误码的业务错误
 */
export class AppError extends Error {
  constructor(
    public code: number,
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 验证错误类
 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(ErrorCode.INVALID_PARAMS, message, 400);
    this.name = 'ValidationError';
  }
}

/**
 * 未授权错误类
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = '未授权访问') {
    super(ErrorCode.UNAUTHORIZED, message, 401);
    this.name = 'UnauthorizedError';
  }
}

/**
 * 禁止访问错误类
 */
export class ForbiddenError extends AppError {
  constructor(message: string = '权限不足') {
    super(ErrorCode.PERMISSION_DENIED, message, 403);
    this.name = 'ForbiddenError';
  }
}

/**
 * 资源未找到错误类
 */
export class NotFoundError extends AppError {
  constructor(message: string = '资源不存在') {
    super(ErrorCode.RESOURCE_NOT_FOUND, message, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * 资源冲突错误类
 */
export class ConflictError extends AppError {
  constructor(message: string = '资源冲突') {
    super(ErrorCode.RESOURCE_CONFLICT, message, 409);
    this.name = 'ConflictError';
  }
}
