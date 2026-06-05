/**
 * API 网关主配置类
 *
 * 负责应用的初始化和启动配置。
 * 在应用启动时执行以下操作：
 * - 加载环境变量
 * - 注册速率限制规则
 * - 注册熔断器服务
 * - 配置 AWS 凭证管理器
 * - 预热凭证
 */
import { Configuration, IMidwayContainer } from '@midwayjs/core';
import { join } from 'path';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { RateLimitService } from './service/rate-limit.service';
import { CircuitBreakerService } from './service/circuit-breaker.service';
import { AWSCredentialsManager } from '@baby-monitor/aws-credentials';

// 加载环境变量（必须在任何其他导入之前）
// 尝试多个可能的 .env 路径
const envPaths = [
  join(__dirname, '../../../.env'),  // 开发环境: services/api-gateway/dist -> .env
  join(__dirname, '../../.env'),     // 生产环境: api-gateway/dist -> .env
  join(__dirname, '../../../../.env'), // 备用路径
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

@Configuration({
  imports: [
    require('@midwayjs/koa'), // Koa Web 框架
    require('@midwayjs/jwt'), // JWT 认证
    require('@midwayjs/swagger'), // API 文档
    require('@midwayjs/validate'), // 参数验证
    require('@midwayjs/redis'), // Redis 客户端
    require('@midwayjs/logger'), // 日志服务
    require('@baby-monitor/aws-credentials'), // AWS 凭证管理
    require('@baby-monitor/shared-utils'), // 共享工具类（CacheManager等）
  ],
  importConfigs: [join(__dirname, './config')], // 导入配置目录
})
export class MainConfiguration {
  /**
   * 应用就绪回调
   *
   * 在应用启动完成后执行，用于初始化各种服务和配置。
   *
   * @param container - 依赖注入容器
   */
  async onReady(container: IMidwayContainer) {
    // 动态导入凭证配置（确保在 dotenv.config() 之后）
    const { kvsCredentialsConfig, s3CredentialsConfig } = await import('./config/credentials.config');

    // 获取服务实例
    const rateLimitService = await container.getAsync(RateLimitService);
    const circuitBreakerService = await container.getAsync(CircuitBreakerService);
    const credentialsManager = await container.getAsync(AWSCredentialsManager);

    // 设置默认速率限制规则
    rateLimitService.addRule({
      pattern: '/api/auth/*', // 认证接口限制更严格
      config: { windowMs: 60000, maxRequests: 10 },
      priority: 10,
    });

    // 注册默认熔断器服务（为所有微服务注册熔断器）
    const services = [
      'device-service', // 设备服务
      'video-service', // 视频服务
      'storage-service', // 存储服务
      'user-service', // 用户服务
      'admin-service', // 域管理服务
      'baby-service', // 婴儿护理服务
      'notification-service', // 通知服务
      'device-gateway', // 设备网关（整合 MQTT 网关和协议适配器）
    ];

    for (const service of services) {
      circuitBreakerService.registerService(service);
    }

    // 注册 AWS 凭证配置（KVS 和 S3）
    credentialsManager.registerAllCredentials({
      kvs: kvsCredentialsConfig,
      s3: s3CredentialsConfig,
    });

    // 预热凭证（提前获取临时凭证，避免首次请求延迟）
    await credentialsManager.warmupCredentials();

    console.log('API Gateway started on port 6001');
    console.log(`Registered ${services.length} services for circuit breaking`);
    console.log('AWS STS credentials manager initialized');
  }
}
