import { Configuration, IMidwayContainer } from '@midwayjs/core';
import { join } from 'path';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';

// 在所有其他配置之前加载环境变量文件
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
 * 定义Storage Service的模块依赖和配置文件路径
 */
@Configuration({
  // 导入所需的Midway.js组件模块
  imports: [
    require('@midwayjs/koa'),      // Koa Web框架
    require('@midwayjs/swagger'),   // Swagger API文档生成
    require('@midwayjs/redis'),    // Redis缓存服务
    require('@midwayjs/typeorm'),  // 数据库ORM（录像元数据）
    require('@midwayjs/logger'),   // 日志服务
    require('@midwayjs/axios'),    // HTTP客户端（ServiceClient依赖）
    require('@baby-monitor/shared-utils'), // 共享工具类（CacheManager等）
  ],
  // 指定配置文件目录
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration {
  /**
   * 应用启动完成后的回调
   * 在所有组件初始化完成后执行
   * @param container IoC容器实例
   */
  async onReady(container: IMidwayContainer) {
    console.log('Storage Service started on port 6006');
  }
}
