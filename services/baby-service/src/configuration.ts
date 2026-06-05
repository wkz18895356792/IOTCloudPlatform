import { Configuration, IMidwayContainer, App } from '@midwayjs/core';
import { join } from 'path';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { VerifiedUserContextMiddleware } from '@baby-monitor/shared-utils';

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
 * 主配置类
 *
 * 负责Baby Service应用的配置和初始化
 * 包括：
 * - 引入必要的Midway组件（Koa、TypeORM、Swagger、Redis、Logger）
 * - 加载配置文件
 * - 应用启动时的初始化操作
 */
@Configuration({
  imports: [
    require('@midwayjs/koa'),      // Web框架
    require('@midwayjs/typeorm'),   // ORM框架
    require('@midwayjs/swagger'),   // API文档
    require('@midwayjs/redis'),     // 缓存
    require('@midwayjs/logger'),    // 日志
    require('@midwayjs/axios'),     // HTTP客户端（AI监控服务需要调用外部AI API）
    require('@baby-monitor/shared-utils'), // 共享工具类（CacheManager等）
  ],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration {
  @App()
  app!: any;

  /**
   * 应用启动完成后的回调
   * 在所有组件初始化完成后执行
   *
   * @param container - Midway IoC容器
   */
  async onReady(container: IMidwayContainer) {
    console.log('Baby Service started on port 6004');

    // 注册用户上下文中间件 - 验证签名后从 Headers 中提取用户信息
    this.app.useMiddleware(VerifiedUserContextMiddleware);
    console.log('[Configuration] VerifiedUserContextMiddleware registered');
  }
}
