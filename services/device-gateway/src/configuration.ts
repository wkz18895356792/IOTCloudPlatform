import { Configuration, IMidwayContainer } from '@midwayjs/core';
import { join } from 'path';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { GatewayCoreService } from './service/core/gateway-core.service';
import './service/core/log-gateway.service';

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
 * 设备网关服务配置
 *
 * 整合 MQTT Gateway 和 Protocol Adapter 的功能
 */
@Configuration({
  imports: [
    require('@midwayjs/koa'),
    require('@midwayjs/swagger'),
    require('@midwayjs/typeorm'),
    require('@midwayjs/redis'),
    require('@midwayjs/socketio'),
    require('@midwayjs/logger'),
    require('@midwayjs/axios'),       // HTTP客户端（ServiceClient依赖）
    require('@baby-monitor/shared-utils'), // 共享工具类（CacheManager等）
    require('@baby-monitor/aws-credentials'), // AWS 凭证管理
  ],
  importConfigs: [
    join(__dirname, './config'),
  ],
})
export class DeviceGatewayConfiguration {
  async onReady(container: IMidwayContainer) {
    // 显式初始化 GatewayCoreService（触发 MQTT 连接和 Redis 订阅）
    await container.getAsync(GatewayCoreService);

    console.log('[Device Gateway] Service started successfully');
    console.log('[Device Gateway] MQTT Gateway + Protocol Adapter = Unified Device Gateway');
  }

  async onStop() {
    console.log('[Device Gateway] Service stopped');
  }
}
