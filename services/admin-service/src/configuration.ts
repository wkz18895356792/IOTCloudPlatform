import { Configuration, IMidwayContainer, App } from '@midwayjs/core';
import { join } from 'path';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { DomainContextMiddleware, VerifiedUserContextMiddleware } from '@baby-monitor/shared-utils';
import { PermissionMiddleware } from './middleware/permission.middleware';

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
 * 管理服务主配置类
 * 负责域管理、域用户管理、域权限管理
 */
@Configuration({
  imports: [
    require('@midwayjs/koa'),       // Koa Web框架
    require('@midwayjs/typeorm'),   // TypeORM数据库ORM
    require('@midwayjs/swagger'),   // Swagger API文档
    require('@midwayjs/redis'),     // Redis缓存
    require('@midwayjs/logger'),    // 日志记录
    require('@midwayjs/validate'),  // 参数验证
    require('@midwayjs/axios'),     // HTTP客户端（用于服务间调用）
    require('@baby-monitor/shared-utils'),
    require('@baby-monitor/shared-types'),
  ],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration {
  @App()
  app!: any;

  async onReady(container: IMidwayContainer) {
    console.log('Admin Service started on port 6009');

    // 注册用户上下文中间件 - 验证签名后从 Headers 中提取用户信息
    this.app.useMiddleware(VerifiedUserContextMiddleware);
    console.log('[Configuration] VerifiedUserContextMiddleware registered');

    // 注册域上下文中间件
    this.app.useMiddleware(DomainContextMiddleware);
    console.log('[Configuration] DomainContextMiddleware registered');

    // 注册权限验证中间件
    this.app.useMiddleware(PermissionMiddleware);
    console.log('[Configuration] PermissionMiddleware registered');
  }
}
