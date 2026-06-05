/**
 * 服务网关控制器
 *
 * 作为 API 网关的核心组件，负责将客户端请求路由到后端微服务。
 * 实现统一的入口点，处理认证、转发、错误处理等。
 *
 * 主要功能：
 * - 请求路由和转发
 * - 用户信息传递
 * - 错误统一处理
 * - 健康检查
 */
import { Controller, Get, Post, Put, Del, Options, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import axios from 'axios';
import { buildServiceRoutes, getAllServices } from '../config/service-routes.config';
import { ErrorCode, errorResponse } from '@baby-monitor/shared-types';
import { UserContextSigner } from '@baby-monitor/shared-utils';

/**
 * 服务网关控制器
 *
 * 代理所有内部服务的请求，实现请求路由和转发功能。
 */
@Controller('/api')
export class ServiceGateway {
  @Inject()
  ctx!: Context;

  // 服务路由映射表：路径前缀 -> 目标服务 URL
  private readonly serviceRoutes: Record<string, string> = buildServiceRoutes();

  /**
   * 代理 OPTIONS 请求（CORS 预检）
   *
   * 处理 CORS 预检请求，返回适当的 CORS 头
   */
  @Options('*')
  async proxyOptions() {
    const ctx = this.ctx;
    const origin = ctx.get('Origin');

    // 设置 CORS 响应头
    ctx.set('Access-Control-Allow-Origin', origin || '*');
    ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Domain-ID, X-User-ID');
    ctx.set('Access-Control-Allow-Credentials', 'true');
    ctx.set('Access-Control-Max-Age', '86400');

    ctx.status = 200;
    return '';
  }

  /**
   * 代理 GET 请求
   *
   * 处理所有 GET 方法的服务请求，转发到目标服务。
   */
  @Get('*', { middleware: ['authMiddleware', 'permissionMiddleware'] })
  async proxyGet() {
    return this.proxyRequest('GET');
  }

  /**
   * 代理 POST 请求
   *
   * 处理所有 POST 方法的服务请求，转发到目标服务。
   */
  @Post('*', { middleware: ['authMiddleware', 'permissionMiddleware'] })
  async proxyPost() {
    return this.proxyRequest('POST');
  }

  /**
   * 代理 PUT 请求
   *
   * 处理所有 PUT 方法的服务请求，转发到目标服务。
   */
  @Put('*', { middleware: ['authMiddleware', 'permissionMiddleware'] })
  async proxyPut() {
    return this.proxyRequest('PUT');
  }

  /**
   * 代理 DELETE 请求
   *
   * 处理所有 DELETE 方法的服务请求，转发到目标服务。
   */
  @Del('*', { middleware: ['authMiddleware', 'permissionMiddleware'] })
  async proxyDelete() {
    return this.proxyRequest('DELETE');
  }

  /**
   * 代理请求到目标服务
   *
   * 根据请求路径查找目标服务，并转发请求。
   * 传递用户信息和必要的请求头。
   *
   * @param method - HTTP 方法
   * @returns 目标服务的响应数据
   */
  private async proxyRequest(method: string) {
    const { path, query } = this.ctx;
    const body = this.ctx.request.body; // 获取请求体

    // 查找目标服务 URL
    const targetUrl = this.findTargetService(path);

    // 未找到目标服务
    if (!targetUrl) {
      this.ctx.status = 404;
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, `No service found for path: ${path}`);
    }
    console.log(`[ServiceGateway] 转发请求 ${method} ${path} 到 ${targetUrl}`);
    console.log('Request body:', body);
    console.log('Content-Type:', this.ctx.get('Content-Type'));

    try {
      // 构建转发请求头
      const userId = this.ctx.state.user?.userId || '';
      const userRole = this.ctx.state.user?.role || '';
      const username = this.ctx.state.user?.username || '';
      const token = this.ctx.state.token || '';

      const headers: Record<string, string> = {
        'Authorization': this.ctx.get('Authorization'),
        // 传递用户信息（由 auth.middleware 解析并注入到 ctx.state）
        'X-User-ID': userId,
        'X-User-Role': userRole,
        'X-User-Username': username,
        // 传递原始 Token，用于下游服务在登出时加入黑名单
        'X-User-Token': token,
      };

      // 对用户上下文签名，防止下游服务的 X-User-* Header 被伪造
      const signingSecret = process.env.USER_CONTEXT_SIGNING_SECRET;
      if (signingSecret && userId) {
        const { signature, timestamp } = UserContextSigner.sign(
          { userId, role: userRole, username, token },
          signingSecret
        );
        headers['X-User-Context-Signature'] = signature;
        headers['X-User-Context-Timestamp'] = String(timestamp);
      }

      // 仅当 Content-Type 存在时才设置
      const contentType = this.ctx.get('Content-Type');
      if (contentType) {
        headers['Content-Type'] = contentType;
      }

      // 发起 HTTP 请求转发
      const response = await axios({
        method,
        url: targetUrl + path,
        params: query, // 传递查询参数
        data: body, // 传递请求体
        headers,
        timeout: 30000, // 30 秒超时
      });

      // 添加 CORS 响应头
      this.addCorsHeaders();

      return response.data;
    } catch (error) {
      const err = error as any;
      this.ctx.status = err.response?.status || 500;

      // 添加 CORS 响应头（错误响应也需要）
      this.addCorsHeaders();

      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, err.message || 'Service error');
    }
  }

  /**
   * 添加 CORS 响应头
   */
  private addCorsHeaders() {
    const ctx = this.ctx;
    const origin = ctx.get('Origin');

    // 允许的源列表
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:5173,http://localhost:8080,http://localhost:8088,http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:8080').split(',');

    // 验证并设置 CORS 头
    if (origin && allowedOrigins.includes(origin)) {
      ctx.set('Access-Control-Allow-Origin', origin);
    } else if (!origin) {
      ctx.set('Access-Control-Allow-Origin', allowedOrigins[0]);
    } else {
      ctx.set('Access-Control-Allow-Origin', allowedOrigins[0]);
    }

    ctx.set('Access-Control-Allow-Credentials', 'true');
    ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Domain-ID, X-User-ID');
  }

  /**
   * 查找目标服务 URL
   *
   * 根据请求路径匹配服务路由配置，返回目标服务的 URL。
   * 使用前缀匹配，返回第一个匹配的路由。
   *
   * @param path - 请求路径
   * @returns 目标服务 URL，未找到返回 null
   */
  private findTargetService(path: string): string | null {
    for (const [route, serviceUrl] of Object.entries(this.serviceRoutes)) {
      if (path.startsWith(route)) {
        return serviceUrl;
      }
    }
    return null;
  }
}

/**
 * 健康检查控制器
 *
 * 提供网关和后端服务的健康状态检查接口。
 */
@Controller('/health')
export class HealthController {
  @Inject()
  ctx!: Context;

  /**
   * 基础健康检查
   *
   * 返回网关自身状态和后端服务状态概览。
   */
  @Get('/')
  async health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        apiGateway: 'healthy',
        userService: 'unknown', // 用户服务端口 6002
        deviceService: 'unknown', // 设备服务端口 6003
        videoService: 'unknown', // 视频服务端口 6004
        storageService: 'unknown', // 存储服务端口 6005
        mqttGateway: 'unknown', // MQTT 网关端口 6006
        protocolAdapter: 'unknown', // 协议适配器端口 6007
        babyService: 'unknown', // 婴儿服务端口 6008
      },
    };
  }

  /**
   * 获取所有服务路由信息
   *
   * 返回已配置的所有服务及其路由映射信息。
   */
  @Get('/routes')
  async routes() {
    const allServices = getAllServices();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: allServices.map(service => ({
        name: service.name,
        description: service.description,
        port: service.port,
        host: service.host,
        pathPrefixes: service.pathPrefixes,
        requireAuth: service.requireAuth,
      })),
    };
  }
}
