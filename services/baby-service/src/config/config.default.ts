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

/**
 * Baby Service 默认配置
 *
 * 包含以下配置项：
 * - keys: 应用密钥，用于cookie签名等
 * - koa: Web服务器配置
 * - swagger: API文档配置
 * - typeorm: 数据库配置
 * - redis: 缓存配置
 */
export default {
  // 应用密钥
  keys: '1700647148485',

  // Koa Web服务器配置
  koa: {
    port: 6008, // 服务监听端口
  },

  // ==================== 日志配置 ====================
  midwayLogger: {
    clients: {
      coreLogger: {
        level: 'all',
        fileLogName: 'baby-service-core.log',
        dir: join(__dirname, '../../logs'),
      },
      appLogger: {
        level: 'all',
        fileLogName: 'baby-service-app.log',
        dir: join(__dirname, '../../logs'),
      },
    },
  },

  // Swagger API文档配置
  swagger: {
    title: 'Baby Service',                            // API文档标题
    description: '智能家居云平台 - 婴儿护理服务',      // API文档描述
    version: '1.0.0',                                  // API版本
    path: '/swagger-ui',                               // Swagger UI访问路径
  },

  // TypeORM数据库配置
  typeorm: {
    dataSource: {
      default: {
        type: 'mysql',                                 // 数据库类型
        host: EnvResolver.require('MYSQL_HOST'),       // 数据库主机（自动处理本地开发环境）
        port: EnvResolver.getNumber('MYSQL_PORT', 3306), // 数据库端口
        username: EnvResolver.require('MYSQL_USER'),   // 数据库用户名
        password: EnvResolver.require('MYSQL_PASSWORD'), // 数据库密码
        database: EnvResolver.require('MYSQL_DATABASE'), // 数据库名
        synchronize: false,                            // 是否自动同步数据库结构（生产环境建议关闭）
        logging: true,                                 // 是否启用SQL日志
        entities: ['**/entity/*.entity{.ts,.js}'],     // 实体文件路径模式
      },
    },
  },

  // Redis缓存配置
  redis: {
    client: {
      port: EnvResolver.getNumber('REDIS_PORT', 6379),  // Redis端口
      host: EnvResolver.require('REDIS_HOST'),          // Redis主机（自动处理本地开发环境）
      ...(EnvResolver.get('REDIS_PASSWORD', '') ? { password: EnvResolver.get('REDIS_PASSWORD', '') } : {}),   // Redis密码
      db: EnvResolver.getNumber('REDIS_DB', 0),         // Redis数据库编号
    },
  },
} as MidwayConfig;
