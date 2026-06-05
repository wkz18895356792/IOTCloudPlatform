import { Configuration, IMidwayContainer } from '@midwayjs/core';

/**
 * Shared Utils Midway 配置
 *
 * 此配置类将 shared-utils 中的组件（如 CacheManager、NotificationService）
 * 注册到 Midway 容器中，使其可以被其他服务注入使用
 */
@Configuration({
  imports: [
    require('@midwayjs/axios'),  // HTTP客户端（ServiceClient依赖）
    require('@midwayjs/ws'),     // WebSocket 支持（通知服务需要）
  ],
  importConfigs: [],
})
export class SharedUtilsConfiguration {
  async onReady(container: IMidwayContainer) {
    // Midway 会自动扫描 @Provide() 装饰的类
    // 这里可以添加初始化逻辑
  }
}
