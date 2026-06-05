/**
 * 统一错误处理工具类
 *
 * 提供标准化的错误类型和错误处理机制
 * 所有微服务应该使用这些错误类来确保一致的错误响应格式
 */

/**
 * 错误代码枚举
 */
export enum ErrorCode {
  // 通用错误 (1xxx)
  UNKNOWN = 1000,
  INVALID_REQUEST = 1001,
  INVALID_PARAMETER = 1002,
  RESOURCE_NOT_FOUND = 1003,
  RESOURCE_ALREADY_EXISTS = 1004,
  OPERATION_FAILED = 1005,
  SERVICE_UNAVAILABLE = 1006,
  RATE_LIMIT_EXCEEDED = 1007,

  // 认证错误 (2xxx)
  UNAUTHORIZED = 2000,
  TOKEN_EXPIRED = 2001,
  TOKEN_INVALID = 2002,
  INVALID_CREDENTIALS = 2003,
  ACCOUNT_DISABLED = 2004,
  ACCOUNT_LOCKED = 2005,
  SESSION_EXPIRED = 2006,
  TWO_FACTOR_REQUIRED = 2007,

  // 权限错误 (3xxx)
  FORBIDDEN = 3000,
  INSUFFICIENT_PERMISSIONS = 3001,
  DOMAIN_ACCESS_DENIED = 3002,
  RESOURCE_ACCESS_DENIED = 3003,

  // 用户相关错误 (4xxx)
  USER_NOT_FOUND = 4000,
  USER_ALREADY_EXISTS = 4001,
  EMAIL_ALREADY_VERIFIED = 4002,
  PHONE_ALREADY_VERIFIED = 4003,
  INVALID_VERIFICATION_CODE = 4004,
  PASSWORD_TOO_WEAK = 4005,
  PASSWORD_RECENTLY_USED = 4006,

  // 设备相关错误 (5xxx)
  DEVICE_NOT_FOUND = 5000,
  DEVICE_OFFLINE = 5001,
  DEVICE_ALREADY_REGISTERED = 5002,
  DEVICE_NOT_AUTHORIZED = 5003,
  DEVICE_FIRMWARE_UPDATE_FAILED = 5004,
  DEVICE_QUOTA_EXCEEDED = 5005,
  DEVICE_CERTIFICATE_INVALID = 5006,

  // 婴儿服务错误 (6xxx)
  BABY_NOT_FOUND = 6000,
  FEEDING_RECORD_NOT_FOUND = 6001,
  SLEEP_RECORD_NOT_FOUND = 6002,
  MONITORING_EVENT_NOT_FOUND = 6003,

  // 存储相关错误 (7xxx)
  FILE_NOT_FOUND = 7000,
  FILE_TOO_LARGE = 7001,
  INVALID_FILE_TYPE = 7002,
  STORAGE_QUOTA_EXCEEDED = 7003,
  UPLOAD_FAILED = 7004,

  // 域管理错误 (8xxx)
  DOMAIN_NOT_FOUND = 8000,
  DOMAIN_ALREADY_EXISTS = 8001,
  DOMAIN_QUOTA_EXCEEDED = 8002,
  DOMAIN_USER_LIMIT_EXCEEDED = 8003,
  DOMAIN_DEVICE_LIMIT_EXCEEDED = 8004,

  // 支付相关错误 (9xxx)
  PAYMENT_FAILED = 9000,
  SUBSCRIPTION_NOT_FOUND = 9001,
  SUBSCRIPTION_EXPIRED = 9002,
  SUBSCRIPTION_ALREADY_CANCELLED = 9003,
}

/**
 * 标准错误响应格式
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: any;
    requestId?: string;
    timestamp: string;
  };
}

/**
 * 基础应用错误类
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(message: string, code: ErrorCode = ErrorCode.UNKNOWN, statusCode: number = 500, details?: any) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // 确保原型链正确
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * 转换为标准错误响应格式
   */
  toResponse(requestId?: string): ErrorResponse {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

/**
 * 验证错误
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, ErrorCode.INVALID_PARAMETER, 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * 未授权错误
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', code: ErrorCode = ErrorCode.UNAUTHORIZED) {
    super(message, code, 401);
    this.name = 'UnauthorizedError';
  }
}

/**
 * 禁止访问错误
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', code: ErrorCode = ErrorCode.FORBIDDEN) {
    super(message, code, 403);
    this.name = 'ForbiddenError';
  }
}

/**
 * 资源未找到错误
 */
export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', code: ErrorCode = ErrorCode.RESOURCE_NOT_FOUND) {
    super(message, code, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * 冲突错误
 */
export class ConflictError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCode.RESOURCE_ALREADY_EXISTS) {
    super(message, code, 409);
    this.name = 'ConflictError';
  }
}

/**
 * 速率限制错误
 */
export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, ErrorCode.RATE_LIMIT_EXCEEDED, 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

/**
 * 服务不可用错误
 */
export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service unavailable', details?: any) {
    super(message, ErrorCode.SERVICE_UNAVAILABLE, 503, details);
    this.name = 'ServiceUnavailableError';
  }
}

/**
 * 设备错误
 */
export class DeviceError extends AppError {
  constructor(message: string, code: ErrorCode, statusCode: number = 400, details?: any) {
    super(message, code, statusCode, details);
    this.name = 'DeviceError';
  }
}

/**
 * 存储错误
 */
export class StorageError extends AppError {
  constructor(message: string, code: ErrorCode, statusCode: number = 400, details?: any) {
    super(message, code, statusCode, details);
    this.name = 'StorageError';
  }
}

/**
 * 域管理错误
 */
export class DomainError extends AppError {
  constructor(message: string, code: ErrorCode, statusCode: number = 400, details?: any) {
    super(message, code, statusCode, details);
    this.name = 'DomainError';
  }
}

/**
 * 错误处理工具函数
 */
export class ErrorUtil {
  /**
   * 判断是否为应用错误
   */
  static isAppError(error: any): error is AppError {
    return error instanceof AppError;
  }

  /**
   * 将任意错误转换为应用错误
   */
  static toAppError(error: any): AppError {
    if (ErrorUtil.isAppError(error)) {
      return error;
    }

    if (error instanceof Error) {
      return new AppError(
        error.message || 'An unexpected error occurred',
        ErrorCode.UNKNOWN,
        500,
        { stack: error.stack }
      );
    }

    return new AppError(
      'An unexpected error occurred',
      ErrorCode.UNKNOWN,
      500,
      { originalError: error }
    );
  }

  /**
   * 将错误转换为标准响应格式
   */
  static toErrorResponse(error: any, requestId?: string): ErrorResponse {
    const appError = ErrorUtil.toAppError(error);
    return appError.toResponse(requestId);
  }

  /**
   * 记录错误日志
   */
  static logError(logger: any, error: any, context?: string): void {
    const appError = ErrorUtil.toAppError(error);

    if (appError.statusCode >= 500) {
      logger.error(`[${context || 'App'}] ${appError.name}: ${appError.message}`, {
        code: appError.code,
        statusCode: appError.statusCode,
        details: appError.details,
        stack: appError.stack,
      });
    } else {
      logger.warn(`[${context || 'App'}] ${appError.name}: ${appError.message}`, {
        code: appError.code,
        statusCode: appError.statusCode,
      });
    }
  }

  /**
   * 从 HTTP 状态码创建错误
   */
  static fromStatusCode(statusCode: number, message?: string): AppError {
    switch (statusCode) {
      case 400:
        return new ValidationError(message || 'Invalid request');
      case 401:
        return new UnauthorizedError(message || 'Unauthorized');
      case 403:
        return new ForbiddenError(message || 'Forbidden');
      case 404:
        return new NotFoundError(message || 'Resource not found');
      case 409:
        return new ConflictError(message || 'Conflict');
      case 429:
        return new RateLimitError(message);
      case 503:
        return new ServiceUnavailableError(message);
      default:
        return new AppError(message || 'An error occurred', ErrorCode.UNKNOWN, statusCode);
    }
  }
}

/**
 * 异步函数包装器，自动捕获错误并转换为 AppError
 */
export function wrapAsync<T>(
  fn: () => Promise<T>,
  errorHandler?: (error: any) => AppError
): Promise<T> {
  return fn().catch(error => {
    if (errorHandler) {
      throw errorHandler(error);
    }
    throw ErrorUtil.toAppError(error);
  });
}
