import { MidwayConfig } from '@midwayjs/core';
import { join } from 'path';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { EnvResolver } from '@baby-monitor/shared-utils';

// 在配置文件加载时立即加载 .env（必须在 EnvResolver 使用之前）
const envPaths = [
  join(__dirname, '../../../../.env'),  // 开发环境: src/config -> root .env
  join(__dirname, '../../../.env'),    // 备用路径
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

export default {
  // use for cookie sign key, should change to your own and keep security
  keys: '1700647148485',
  koa: {
    port: 6003,
  },

  // ==================== 日志配置 ====================
  midwayLogger: {
    clients: {
      coreLogger: {
        level: 'all',
        fileLogName: 'device-service-core.log',
        dir: join(__dirname, '../../logs'),
      },
      appLogger: {
        level: 'all',
        fileLogName: 'device-service-app.log',
        dir: join(__dirname, '../../logs'),
      },
    },
  },

  swagger: {
    title: 'Device Service',
    description: '智能家居云平台 - 设备管理服务',
    version: '1.0.0',
    path: '/swagger-ui',
  },
  typeorm: {
    dataSource: {
      default: {
        type: 'mysql',
        host: EnvResolver.require('MYSQL_HOST'),
        port: EnvResolver.getNumber('MYSQL_PORT', 3306),
        username: EnvResolver.require('MYSQL_USER'),
        password: EnvResolver.require('MYSQL_PASSWORD'),
        database: EnvResolver.require('MYSQL_DATABASE'),
        synchronize: false,
        logging: true,
        entities: ['**/entity/*.entity{.ts,.js}'],
      },
    },
  },
  redis: {
    client: {
      port: EnvResolver.getNumber('REDIS_PORT', 6379),
      host: EnvResolver.require('REDIS_HOST'),
      ...(EnvResolver.get('REDIS_PASSWORD', '') ? { password: EnvResolver.get('REDIS_PASSWORD', '') } : {}),
      db: EnvResolver.getNumber('REDIS_DB', 0),
    },
  },
  serviceClient: {
    apiKey: EnvResolver.require('SERVICE_API_KEY'),
    timeout: EnvResolver.getNumber('SERVICE_TIMEOUT', 30000),
    maxRetries: EnvResolver.getNumber('SERVICE_MAX_RETRIES', 3),
    retryDelay: EnvResolver.getNumber('SERVICE_RETRY_DELAY', 1000),
    enableServiceDiscovery: EnvResolver.getBoolean('SERVICE_DISCOVERY_ENABLED', false),
  },
} as MidwayConfig;
