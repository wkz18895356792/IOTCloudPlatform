import { MidwayConfig } from '@midwayjs/core';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { join } from 'path';
import { existsSync } from 'fs';
import { EnvResolver } from '@baby-monitor/shared-utils';

// 加载 .env 文件（支持多种路径）
const envPaths = [
  path.resolve(__dirname, '../../../../.env'),  // 开发环境
  path.resolve(__dirname, '../../../.env'),      // 生产环境
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

export default {
  keys: '1700647148485',
  koa: {
    port: 6009,
    globalPrefix: '',
  },
  // 配置控制器扫描路径
  uploads: {
    dir: 'upload',
  },
  // CORS 跨域配置
  cors: {
    credentials: true,
    origin: (ctx: any) => {
      const allowedOrigins = EnvResolver.getList('ALLOWED_ORIGINS', ['http://localhost:3000', 'http://localhost:5173']);
      const requestOrigin = ctx.get('Origin');
      return allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
    },
  },
  // ==================== 日志配置 ====================
  midwayLogger: {
    clients: {
      coreLogger: {
        level: 'all',
        fileLogName: 'admin-service-core.log',
        dir: join(__dirname, '../../logs'),
      },
      appLogger: {
        level: 'all',
        fileLogName: 'admin-service-app.log',
        dir: join(__dirname, '../../logs'),
      },
    },
  },
  swagger: {
    title: 'Admin Service',
    description: '智能家居云平台 - 管理服务（域管理）',
    version: '1.0.0',
    path: '/swagger-ui',
    allowAll: true,
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
  // 域管理配置
  domain: {
    // 默认域配额
    defaultQuota: {
      userLimit: 100,      // 默认用户数量限制
      deviceLimit: 500,    // 默认设备数量限制
      storageLimit: 100,   // 默认存储空间限制（GB）
    },
    // 试用期限（天）
    trialPeriodDays: 30,
    // 权限缓存时间（秒）
    permissionCacheTTL: 300,
  },
} as MidwayConfig;
