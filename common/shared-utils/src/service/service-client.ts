/**
 * 服务间通信客户端
 *
 * 提供微服务之间的安全HTTP通信能力，包括：
 * - 统一的服务调用接口
 * - 自动添加API Key认证
 * - 请求/响应拦截器
 * - 错误处理和重试
 * - 服务发现集成
 */

import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { HttpService } from '@midwayjs/axios';
import { Config } from '@midwayjs/core';

/**
 * 服务间通信配置
 */
export interface ServiceClientConfig {
  /** API密钥，用于服务间认证 */
  apiKey: string;
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试延迟（毫秒） */
  retryDelay?: number;
  /** 是否启用服务发现 */
  enableServiceDiscovery?: boolean;
}

/**
 * 服务响应
 */
export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
  message?: string;
}

/**
 * 服务间通信客户端
 *
 * 用于微服务之间的安全通信，支持服务发现、自动重试、错误处理等特性。
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class ServiceClient {
  @Inject()
  logger!: ILogger;

  @Inject()
  httpService!: HttpService;

  @Config('serviceClient')
  config!: ServiceClientConfig;

  /**
   * 向指定服务发送GET请求
   *
   * @param serviceName - 服务名称（如 'user-service', 'device-service'）
   * @param path - 请求路径（如 '/api/internal/users/123'）
   * @param params - 查询参数
   * @param options - 额外选项
   * @returns 服务响应数据
   */
  async get<T = any>(
    serviceName: string,
    path: string,
    params?: Record<string, any>,
    options?: {
      timeout?: number;
      headers?: Record<string, string>;
      retries?: number;
    }
  ): Promise<ServiceResponse<T>> {
    const url = await this.buildUrl(serviceName, path);
    const headers = this.buildHeaders(options?.headers);

    try {
      const response = await this.executeWithRetry<T>(
        () =>
          this.httpService.get(url, {
            params,
            headers,
            timeout: options?.timeout || this.config.timeout || 30000,
          }),
        options?.retries
      );

      return this.transformResponse(response);
    } catch (error: any) {
      this.logger.error(`[ServiceClient] GET ${serviceName}${path} failed:`, error.message);
      return {
        success: false,
        error: error.message,
        code: error.response?.status || 500,
      };
    }
  }

  /**
   * 向指定服务发送POST请求
   *
   * @param serviceName - 服务名称
   * @param path - 请求路径
   * @param data - 请求体数据
   * @param options - 额外选项
   * @returns 服务响应数据
   */
  async post<T = any>(
    serviceName: string,
    path: string,
    data?: any,
    options?: {
      timeout?: number;
      headers?: Record<string, string>;
      retries?: number;
    }
  ): Promise<ServiceResponse<T>> {
    const url = await this.buildUrl(serviceName, path);
    const headers = this.buildHeaders(options?.headers);

    try {
      const response = await this.executeWithRetry<T>(
        () =>
          this.httpService.post(url, data, {
            headers,
            timeout: options?.timeout || this.config.timeout || 30000,
          }),
        options?.retries
      );

      return this.transformResponse(response);
    } catch (error: any) {
      this.logger.error(`[ServiceClient] POST ${serviceName}${path} failed:`, error.message);
      return {
        success: false,
        error: error.message,
        code: error.response?.status || 500,
      };
    }
  }

  /**
   * 向指定服务发送PUT请求
   *
   * @param serviceName - 服务名称
   * @param path - 请求路径
   * @param data - 请求体数据
   * @param options - 额外选项
   * @returns 服务响应数据
   */
  async put<T = any>(
    serviceName: string,
    path: string,
    data?: any,
    options?: {
      timeout?: number;
      headers?: Record<string, string>;
      retries?: number;
    }
  ): Promise<ServiceResponse<T>> {
    const url = await this.buildUrl(serviceName, path);
    const headers = this.buildHeaders(options?.headers);

    try {
      const response = await this.executeWithRetry<T>(
        () =>
          this.httpService.put(url, data, {
            headers,
            timeout: options?.timeout || this.config.timeout || 30000,
          }),
        options?.retries
      );

      return this.transformResponse(response);
    } catch (error: any) {
      this.logger.error(`[ServiceClient] PUT ${serviceName}${path} failed:`, error.message);
      return {
        success: false,
        error: error.message,
        code: error.response?.status || 500,
      };
    }
  }

  /**
   * 向指定服务发送DELETE请求
   *
   * @param serviceName - 服务名称
   * @param path - 请求路径
   * @param options - 额外选项
   * @returns 服务响应数据
   */
  async delete<T = any>(
    serviceName: string,
    path: string,
    options?: {
      timeout?: number;
      headers?: Record<string, string>;
      retries?: number;
      data?: any;
    }
  ): Promise<ServiceResponse<T>> {
    const url = await this.buildUrl(serviceName, path);
    const headers = this.buildHeaders(options?.headers);

    try {
      const response = await this.executeWithRetry<T>(
        () =>
          this.httpService.delete(url, {
            headers,
            data: options?.data,
            timeout: options?.timeout || this.config.timeout || 30000,
          }),
        options?.retries
      );

      return this.transformResponse(response);
    } catch (error: any) {
      this.logger.error(`[ServiceClient] DELETE ${serviceName}${path} failed:`, error.message);
      return {
        success: false,
        error: error.message,
        code: error.response?.status || 500,
      };
    }
  }

  /**
   * 批量向多个服务发送请求
   *
   * @param requests - 请求数组
   * @returns 响应数组
   */
  async batch<T = any>(
    requests: Array<{
      serviceName: string;
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      path: string;
      data?: any;
      params?: Record<string, any>;
    }>
  ): Promise<ServiceResponse<T>[]> {
    const promises = requests.map((req) => {
      switch (req.method) {
        case 'GET':
          return this.get<T>(req.serviceName, req.path, req.params);
        case 'POST':
          return this.post<T>(req.serviceName, req.path, req.data);
        case 'PUT':
          return this.put<T>(req.serviceName, req.path, req.data);
        case 'DELETE':
          return this.delete<T>(req.serviceName, req.path, { data: req.data });
        default:
          return Promise.resolve({
            success: false,
            error: `Unknown method: ${req.method}`,
          });
      }
    });

    return Promise.all(promises);
  }

  /**
   * 构建完整的请求URL
   *
   * @private
   * @param serviceName - 服务名称
   * @param path - 请求路径
   * @returns 完整URL
   */
  private async buildUrl(serviceName: string, path: string): Promise<string> {
    // 如果启用了服务发现，从服务发现获取服务地址
    if (this.config.enableServiceDiscovery) {
      // TODO: 集成服务发现
      // const serviceUrl = await this.serviceDiscovery.getServiceUrl(serviceName);
      // return `${serviceUrl}${path}`;
    }

    // 从环境变量或配置中获取服务地址
    const serviceUrl = process.env[`${serviceName.toUpperCase().replace('-', '_')}_URL`];
    if (!serviceUrl) {
      throw new Error(`Service URL not configured for: ${serviceName}`);
    }

    // 确保路径以 / 开头
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${serviceUrl}${normalizedPath}`;
  }

  /**
   * 构建请求头
   *
   * @private
   * @param extraHeaders - 额外的请求头
   * @returns 请求头对象
   */
  private buildHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Service-API-Key': this.config.apiKey,
      'X-Request-ID': this.generateRequestId(),
      ...extraHeaders,
    };

    return headers;
  }

  /**
   * 生成请求ID
   *
   * @private
   * @returns 请求ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * 执行请求并支持重试
   *
   * @private
   * @param requestFn - 请求函数
   * @param retries - 重试次数
   * @returns 响应数据
   */
  private async executeWithRetry<T>(
    requestFn: () => Promise<any>,
    retries: number = this.config.maxRetries || 3
  ): Promise<any> {
    let lastError: any;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await requestFn();
      } catch (error: any) {
        lastError = error;

        // 如果是4xx错误（客户端错误），不重试
        if (error.response?.status >= 400 && error.response?.status < 500) {
          throw error;
        }

        // 如果还有重试次数，等待后重试
        if (attempt < retries) {
          const delay = this.config.retryDelay || 1000;
          await this.sleep(delay * (attempt + 1)); // 指数退避
          this.logger.warn(`[ServiceClient] Request failed, retrying (${attempt + 1}/${retries})...`);
        }
      }
    }

    throw lastError;
  }

  /**
   * 转换HTTP响应为服务响应
   *
   * @private
   * @param response - HTTP响应
   * @returns 服务响应
   */
  private transformResponse<T>(response: any): ServiceResponse<T> {
    // 如果响应已经是标准格式，直接返回
    if (response.data && typeof response.data === 'object') {
      if ('success' in response.data || 'data' in response.data) {
        return response.data as ServiceResponse<T>;
      }
    }

    // 否则包装为标准格式
    return {
      success: true,
      data: response.data as T,
    };
  }

  /**
   * 延迟执行
   *
   * @private
   * @param ms - 延迟毫秒数
   * @returns Promise
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
