import { Configuration, IMidwayContainer, App } from '@midwayjs/core';
import { join } from 'path';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { SMSService } from './service/sms.service';
import { SeedService } from './service/seed.service';
import { VerifiedUserContextMiddleware } from '@baby-monitor/shared-utils';
import { DomainContextMiddleware } from '@baby-monitor/shared-utils';

// 加载 .env 文件（必须在任何其他导入之前）
const envPaths = [
  join(__dirname, '../../../.env'),  // 开发环境
  join(__dirname, '../../.env'),     // 生产环境
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

/**
 * 用户服务主配置类
 * 负责配置服务的导入、组件初始化和中间件注册
 */
@Configuration({
  // 导入所需的Midway组件
  imports: [
    require('@midwayjs/koa'),       // Koa Web框架（内置CORS支持）
    require('@midwayjs/typeorm'),   // TypeORM数据库ORM
    require('@midwayjs/jwt'),       // JWT令牌处理
    require('@midwayjs/swagger'),   // Swagger API文档
    require('@midwayjs/redis'),     // Redis缓存
    require('@midwayjs/logger'),    // 日志记录
    require('@baby-monitor/shared-utils'),
  ],
  // 导入配置文件目录
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration {
  // Midway应用实例
  @App()
  app!: any;

  /**
   * 应用就绪回调
   * 在所有组件初始化完成后执行，用于执行启动时的初始化逻辑
   *
   * @param container - Midway IoC容器，用于获取已注册的服务实例
   */
  async onReady(container: IMidwayContainer) {
    console.log('User Service started on port 6002');

    // 注册用户上下文中间件 - 从 API Gateway 传递的 Headers 中提取并验证签名的用户信息
    this.app.useMiddleware(VerifiedUserContextMiddleware);
    console.log('[Configuration] VerifiedUserContextMiddleware registered');

    // 触发SMSService的初始化，确保@Init()装饰器标记的方法被执行
    try {
      const smsService = await container.getAsync(SMSService);
      console.log('[Configuration] SMSService initialized:', !!smsService);
    } catch (error: any) {
      console.error('[Configuration] Failed to initialize SMSService:', error?.message || error);
    }

    // 触发SeedService的初始化，确保默认管理员账户被创建
    try {
      const seedService = await container.getAsync(SeedService);
      console.log('[Configuration] SeedService initialized:', !!seedService);
    } catch (error: any) {
      console.error('[Configuration] Failed to initialize SeedService:', error?.message || error);
    }
  }
}
