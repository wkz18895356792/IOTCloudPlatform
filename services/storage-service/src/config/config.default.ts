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
 * Storage Service 默认配置
 * 包含所有子服务的配置项，包括存储提供商、配额、生命周期、分享等
 */
export default {
  // ==================== 基础配置 ====================
  keys: 'your-secret-key-here',  // Cookie加密密钥，生产环境应从环境变量读取
  koa: {
    port: 6005,                   // HTTP服务端口
  },

  // ==================== 日志配置 ====================
  midwayLogger: {
    clients: {
      coreLogger: {
        level: 'all',
        fileLogName: 'storage-service-core.log',
        dir: join(__dirname, '../../logs'),
      },
      appLogger: {
        level: 'all',
        fileLogName: 'storage-service-app.log',
        dir: join(__dirname, '../../logs'),
      },
    },
  },

  // ==================== Swagger配置 ====================
  // 自动生成API文档，访问地址：http://localhost:6005/swagger-ui
  swagger: {
    title: 'Storage Service',
    description: '智能家居云平台 - 存储服务',
    version: '1.0.0',
    path: '/swagger-ui',
  },

  // ==================== Redis配置 ====================
  redis: {
    client: {
      port: EnvResolver.getNumber('REDIS_PORT', 6379),
      host: EnvResolver.require('REDIS_HOST'),
      ...(EnvResolver.get('REDIS_PASSWORD', '') ? { password: EnvResolver.get('REDIS_PASSWORD', '') } : {}),
      db: EnvResolver.getNumber('REDIS_DB', 0),
    },
  },

  // ==================== AWS S3配置 ====================
  aws: {
    // AWS 区域配置
    // 中国区：cn-north-1 (北京) 或 cn-northwest-1 (宁夏)
    region: process.env.AWS_REGION || 'cn-north-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    // 是否使用AWS中国区（影响endpoint格式）
    isChinaRegion: process.env.AWS_REGION?.startsWith('cn-') || true,
    s3: {
      endpoint: process.env.AWS_S3_ENDPOINT,              // 自定义endpoint（可选）
      bucket: process.env.AWS_S3_BUCKET || '',
      forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
    },
    endpoint: process.env.AWS_ENDPOINT || undefined,
  },

  // ==================== 腾讯云COS配置 ====================
  tencent: {
    secretId: process.env.TENCENT_COS_SECRET_ID || '',
    secretKey: process.env.TENCENT_COS_SECRET_KEY || '',
    cos: {
      bucket: process.env.TENCENT_COS_BUCKET || '',
      region: process.env.TENCENT_COS_REGION || 'ap-guangzhou',
    },
  },

  // ==================== MinIO配置 ====================
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'localhost:9000',
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'baby-monitor',
  },

  // ==================== 存储配置 ====================
  storage: {
    // 默认存储提供商：minio、aws_s3、tencent_cos
    defaultProvider: process.env.STORAGE_TYPE || 'minio',

    // 上传配置
    upload: {
      maxFileSize: 5 * 1024 * 1024 * 1024,  // 单文件最大5GB
      chunkSize: 5 * 1024 * 1024,           // 分片大小5MB
      maxRetries: 3,                         // 失败重试次数
    },

    // 分片上传配置
    multipart: {
      threshold: 100 * 1024 * 1024,  // 超过100MB启用分片上传
      partSize: 5 * 1024 * 1024,     // 每个分片5MB
      maxParts: 1000,                 // 最多1000个分片
    },

    // 存储类型映射
    storageClass: {
      standard: 'STANDARD',           // 标准存储
      infrequentAccess: 'STANDARD_IA', // 低频存储
      archive: 'GLACIER',             // 归档存储
    },
  },

  // ==================== 配额配置 ====================
  quota: {
    // 全局配额限制（按存储提供商）
    global: {
      aws: {
        maxStorage: 1024 * 1024 * 1024 * 1024, // 1TB
        maxFiles: 1000000,                      // 100万文件
        maxFileSize: 5 * 1024 * 1024 * 1024,    // 5GB
      },
      tencent: {
        maxStorage: 1024 * 1024 * 1024 * 1024, // 1TB
        maxFiles: 1000000,
        maxFileSize: 5 * 1024 * 1024 * 1024,    // 5GB
      },
      minio: {
        maxStorage: 500 * 1024 * 1024 * 1024,  // 500GB
        maxFiles: 500000,                       // 50万文件
        maxFileSize: 2 * 1024 * 1024 * 1024,    // 2GB
      },
    },

    // 用户默认配额
    userDefault: {
      maxStorage: 10 * 1024 * 1024 * 1024,   // 10GB
      maxFiles: 10000,                        // 1万文件
      maxFileSize: 100 * 1024 * 1024,         // 100MB
    },
  },

  // ==================== 分享配置 ====================
  share: {
    defaultExpiresIn: 7 * 86400000,   // 默认过期时间：7天（毫秒）
    maxExpiresIn: 365 * 86400000,     // 最大过期时间：1年（毫秒）
    defaultMaxAccess: 1000,            // 默认访问次数限制
    maxMaxAccess: 100000,              // 最大访问次数限制
  },

  // ==================== 元数据配置 ====================
  metadata: {
    cacheTTL: 3600,         // 元数据缓存时间：1小时（秒）
    accessRetention: 604800, // 访问记录保留时间：7天（秒）
    tagRetention: 2592000,   // 标签保留时间：30天（秒）
  },

  // ==================== 数据库配置（录像元数据） ====================
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
        logging: false,
        entities: ['**/entity/*.entity{.ts,.js}'],
      },
    },
  },

  // ==================== 服务间通信配置 ====================
  serviceClient: {
    apiKey: EnvResolver.require('SERVICE_API_KEY'),
  },

  // ==================== Webhook 回调配置 ====================
  webhook: {
    token: process.env.WEBHOOK_TOKEN || '',
    enabled: process.env.WEBHOOK_ENABLED !== 'false',
    idempotencyTTL: 86400,                           // 幂等键 TTL（秒），默认24小时
  },

  // ==================== 录制配置 ====================
  recording: {
    presignedUrlTtl: 3600,                       // 预签名URL有效期（秒），默认1小时
    maxFileSize: 5 * 1024 * 1024 * 1024,         // 单个录制文件最大5GB
    defaultContentType: 'video/mp2t',             // 默认内容类型
    expiryCheckInterval: 300000,                 // 过期检查间隔（毫秒），默认5分钟
    multipartThreshold: 100 * 1024 * 1024,       // 分片阈值100MB
    retentionDays: 7,                            // 录像保留天数
  },

  // ==================== 设备日志配置 ====================
  deviceLog: {
    presignedUrlTtl: 3600,                       // 预签名URL有效期（秒），默认1小时
    maxFileSize: 10 * 1024 * 1024,               // 单个日志文件最大10MB
    defaultContentType: 'text/plain',             // 默认内容类型
    expiryCheckInterval: 300000,                 // 过期检查间隔（毫秒），默认5分钟
    retentionDays: 30,                           // 日志保留天数
  },

} as MidwayConfig;
