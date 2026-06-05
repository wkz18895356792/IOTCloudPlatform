/**
 * API 网关默认配置
 *
 * 包含网关服务的基础配置，如端口、JWT、CORS、Redis 等。
 */
import { MidwayConfig } from '@midwayjs/core';
import { join } from 'path';
import { existsSync } from 'fs';

// ==================== 安全配置验证 ====================
// JWT 密钥验证（必须至少 64 位）
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 64) {
  throw new Error(
    'JWT_SECRET must be at least 64 characters long. ' +
    'Please generate a secure secret using: openssl rand -base64 48'
  );
}

// Session 密钥验证
const sessionKeys = process.env.SESSION_KEYS;
if (!sessionKeys || sessionKeys.length < 32) {
  throw new Error(
    'SESSION_KEYS must be at least 32 characters long. ' +
    'Please generate secure keys using: openssl rand -base64 32'
  );
}

export default {
  // 应用密钥（用于 session 加密等）
  keys: sessionKeys,

  // Koa 框架配置
  koa: {
    port: parseInt(process.env.API_GATEWAY_PORT || '6001'), // 服务监听端口
    globalPrefix: '', // 全局路由前缀
    // HTTPS/SSL 配置 — 设置 API_GATEWAY_SSL_ENABLED=true 启用
    // MidwayJS 自动通过 PathFileUtil 读取文件路径，无需手动 readFileSync
    ...(process.env.API_GATEWAY_SSL_ENABLED === 'true' &&
      process.env.API_GATEWAY_SSL_KEY_PATH &&
      process.env.API_GATEWAY_SSL_CERT_PATH &&
      existsSync(process.env.API_GATEWAY_SSL_KEY_PATH) &&
      existsSync(process.env.API_GATEWAY_SSL_CERT_PATH)
      ? {
          serverOptions: {
            key: process.env.API_GATEWAY_SSL_KEY_PATH,
            cert: process.env.API_GATEWAY_SSL_CERT_PATH,
            ...(process.env.API_GATEWAY_SSL_CA_PATH &&
              existsSync(process.env.API_GATEWAY_SSL_CA_PATH)
              ? { ca: process.env.API_GATEWAY_SSL_CA_PATH }
              : {}),
          },
        }
      : {}),
    bodyparser: {
      enable: true,
      encoding: 'utf8',
      formLimit: '100kb', // 表单数据大小限制
      jsonLimit: '10mb', // JSON 数据大小限制
      textLimit: '100kb', // 文本数据大小限制
      strict: true,
    },
  },

  // JWT 配置
  jwt: {
    secret: jwtSecret, // JWT 签名密钥（已验证长度）
    expiresIn: process.env.JWT_EXPIRE || '7d', // Token 有效期
  },

  // Swagger API 文档配置
  swagger: {
    title: 'API Gateway Service',
    description: '智能家居云平台 - API网关服务',
    version: '1.0.0',
    path: '/swagger-ui', // 文档访问路径
  },

  // CORS 跨域配置
  cors: {
    credentials: true, // 允许携带凭证
    origin: (ctx: any) => {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:3004,http://localhost:3005,http://localhost:5173,http://localhost:8080,http://localhost:8088,http://127.0.0.1:3000,http://127.0.0.1:3005,http://127.0.0.1:5173,http://127.0.0.1:8080,http://127.0.0.1:8088').split(',');
      const requestOrigin = ctx.get('Origin');
      // 验证请求来源是否在白名单中
      return allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
    },
  },

  // Redis 配置（用于缓存、会话、速率限制等）
  redis: {
    client: {
      port: parseInt(process.env.REDIS_PORT || '6379'),
      host: process.env.REDIS_HOST || 'localhost',
      ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
      db: parseInt(process.env.REDIS_DB || '0'),
    },
  },

  // ==================== 日志配置 ====================
  midwayLogger: {
    clients: {
      coreLogger: {
        level: 'all',
        fileLogName: 'api-gateway-core.log',
        dir: join(__dirname, '../../logs'),
      },
      appLogger: {
        level: 'all',
        fileLogName: 'api-gateway-app.log',
        dir: join(__dirname, '../../logs'),
      },
    },
  },
} as MidwayConfig;
