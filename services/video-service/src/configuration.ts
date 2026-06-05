import { Configuration, IMidwayContainer } from '@midwayjs/core';
import { join } from 'path';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { StreamService } from './service/stream.service';
import { StreamCreateSubscriber } from './subscriber/stream-create.subscriber';

// 在所有其他配置之前加载环境变量
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
 * 配置Video Service应用的组件和生命周期
 * - 导入必要的中间件（Koa、Swagger、Redis、Logger）
 * - 配置自动加载
 * - 应用启动时初始化视频服务
 */
@Configuration({
  imports: [
    require('@midwayjs/koa'),          // Koa Web框架
    require('@midwayjs/swagger'),      // API文档生成
    require('@midwayjs/redis'),        // Redis客户端
    require('@midwayjs/logger'),       // 日志服务
    require('@midwayjs/axios'),        // HTTP客户端（ServiceClient依赖）
    require('@midwayjs/ws'),           // WebSocket支持
    require('@baby-monitor/shared-utils'), // 共享工具类（CacheManager等）
  ],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration {
  /**
   * 应用就绪回调
   *
   * 当所有组件初始化完成后执行
   *
   * @param container - IoC容器
   */
  async onReady(container: IMidwayContainer) {
    // 获取 StreamService 实例
    const streamService = await container.getAsync(StreamService);

    // 获取 StreamCreateSubscriber 并注入 StreamService
    const streamCreateSubscriber = await container.getAsync(StreamCreateSubscriber);
    streamCreateSubscriber.setStreamService(streamService);

    console.log('Video Service started on port 6004');
  }
}
