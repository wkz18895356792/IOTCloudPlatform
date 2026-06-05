/**
 * 熔断器中间件
 *
 * 在请求处理前检查服务熔断器状态，在请求处理后记录调用结果。
 * 防止对故障服务的持续调用，实现快速失败。
 *
 * 工作流程：
 * 1. 从请求路径提取目标服务名
 * 2. 检查熔断器状态，决定是否允许调用
 * 3. 执行请求并记录结果
 * 4. 根据结果更新熔断器状态
 */
import { Middleware, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { CircuitBreakerService } from '../service/circuit-breaker.service';

@Middleware()
export class CircuitBreakerMiddleware {
  @Inject()
  circuitBreakerService!: CircuitBreakerService;

  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      const path = ctx.path;

      // 从请求路径提取目标服务名
      const serviceName = this.extractServiceName(path);

      // 未匹配到任何服务，直接放行
      if (!serviceName) {
        await next();
        return;
      }

      // 检查熔断器是否允许调用
      const canCall = await this.circuitBreakerService.canCall(serviceName);

      // 熔断器已打开，拒绝请求
      if (!canCall.allowed) {
        ctx.status = 503; // Service Unavailable
        ctx.body = {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service is temporarily unavailable',
            reason: canCall.reason,
          },
        };
        return;
      }

      // 记录请求开始时间
      const startTime = Date.now();
      let success = true;
      let error: Error | undefined;

      try {
        await next();
      } catch (err) {
        success = false;
        error = err as Error;
        throw err; // 重新抛出错误，让上层处理
      } finally {
        // 无论成功失败，都记录调用结果
        const duration = Date.now() - startTime;
        await this.circuitBreakerService.recordCall(serviceName, {
          success: success && ctx.status < 500, // 5xx 错误视为失败
          duration,
          error: error?.message,
        });
      }
    };
  }

  /**
   * 从请求路径提取服务名
   *
   * 根据 API 路径模式映射到对应的服务名。
   * 例如：/api/devices/* -> device-service
   *
   * @param path - 请求路径
   * @returns 服务名，无法映射则返回 null
   */
  private extractServiceName(path: string): string | null {
    // 分割路径并过滤空字符串
    const pathParts = path.split('/').filter(Boolean);

    // 检查是否是 API 路径
    if (pathParts[0] === 'api' && pathParts.length > 1) {
      const resource = pathParts[1]; // 资源名（如 devices、streams）

      // 资源名到服务名的映射表
      const serviceMap: Record<string, string> = {
        devices: 'device-service',
        device: 'device-service',
        streams: 'video-service',
        stream: 'video-service',
        storage: 'storage-service',
        users: 'user-service',
        user: 'user-service',
        notifications: 'notification-service',
        notification: 'notification-service',
        gateway: 'device-gateway',
      };

      return serviceMap[resource] || `${resource}-service`;
    }

    return null;
  }
}
