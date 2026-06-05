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
 * Video Service 默认配置
 *
 * 包含服务的所有配置项：
 * - 基础配置（端口、密钥）
 * - Swagger API文档配置
 * - Redis缓存配置
 * - AWS KVS配置
 * - 腾讯云配置
 * - WebRTC配置
 * - 转码配置
 * - 流媒体配置
 * - 录制配置
 * - 存储配置
 * - 会话管理配置
 * - 日志配置
 * - 监控配置
 */
export default {
  // ==================== 基础配置 ====================
  /** 应用密钥，用于cookie签名等 */
  keys: 'your-secret-key-here',
  /** Koa框架配置 */
  koa: {
    port: 6004,                          // 服务监听端口
  },

  // ==================== 日志配置 ====================
  midwayLogger: {
    clients: {
      coreLogger: {
        level: 'all',
        fileLogName: 'video-service-core.log',
        dir: join(__dirname, '../../logs'),
      },
      appLogger: {
        level: 'all',
        fileLogName: 'video-service-app.log',
        dir: join(__dirname, '../../logs'),
      },
    },
  },

  // ==================== Swagger配置 ====================
  swagger: {
    title: 'Video Service',             // API文档标题
    description: '智能家居云平台 - 视频服务', // API文档描述
    version: '1.0.0',                    // API版本
    path: '/swagger-ui',                 // Swagger UI访问路径
  },

  // ==================== Redis配置 ====================
  redis: {
    client: {
      port: EnvResolver.getNumber('REDIS_PORT', 6379),     // Redis端口
      host: EnvResolver.require('REDIS_HOST'),             // Redis主机（自动处理本地开发环境）
      ...(EnvResolver.get('REDIS_PASSWORD', '') ? { password: EnvResolver.get('REDIS_PASSWORD', '') } : {}),      // Redis密码
      db: EnvResolver.getNumber('REDIS_DB', 0),            // Redis数据库编号
    },
  },

  // ==================== AWS KVS配置 ====================
  aws: {
    // AWS 区域: 中国区为 cn-north-1 (北京) 或 cn-northwest-1 (宁夏)
    region: process.env.AWS_REGION || 'cn-north-1',
    // AWS 访问密钥
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    // 是否使用AWS中国区
    isChinaRegion: process.env.AWS_REGION?.startsWith('cn-') || true,
    // AWS KVS 配置
    kvs: {
      streamArn: process.env.AWS_KVS_STREAM_ARN || '',      // KVS流ARN
      endpoint: process.env.AWS_KVS_ENDPOINT || undefined,  // 自定义endpoint
      // 数据保留期（小时）
      retentionPeriod: parseInt(process.env.AWS_KVS_RETENTION || '24'), // 默认24小时
    },
    // 中国区特殊endpoint（如果需要自定义）
    endpoint: process.env.AWS_ENDPOINT || undefined,
  },

  // ==================== 腾讯云配置 ====================
  tencent: {
    secretId: process.env.TENCENT_CLOUD_SECRET_ID || '',           // 腾讯云访问密钥ID
    secretKey: process.env.TENCENT_CLOUD_SECRET_KEY || '',         // 腾讯云访问密钥Key
    region: process.env.TENCENT_CLOUD_REGION || 'ap-guangzhou',    // 腾讯云区域
    // 腾讯云点播配置
    vod: {
      subAppId: parseInt(process.env.TENCENT_VOD_SUB_APP_ID || '0'),                // 点播子应用ID
      storageRegion: process.env.TENCENT_VOD_STORAGE_REGION || 'ap-guangzhou',     // 存储区域
      className: process.env.TENCENT_VOD_CLASS_NAME || 'standard',                 // 存储分类
    },
    // 腾讯云物联网智能视频服务（消费版）配置
    iotVideo: {
      productId: process.env.TENCENT_IOT_VIDEO_PRODUCT_ID || '',           // IoT Video 产品ID
      devicePrefix: process.env.TENCENT_IOT_VIDEO_DEVICE_PREFIX || '',     // 设备ID前缀
      expireTime: parseInt(process.env.TENCENT_IOT_VIDEO_EXPIRE_TIME || '0'), // 流地址过期时间(秒)，0表示使用默认值
    },
  },

  // ==================== WebRTC配置 ====================
  webrtc: {
    enabled: true,                        // 是否启用WebRTC
    iceServers: [                         // ICE服务器列表（用于NAT穿透）
      { urls: 'stun:stun.l.google.com:19302' },  // Google公共STUN服务器
      {
        urls: 'turn:your-turn-server.com:3478',
        username: 'username',
        credential: 'password',
      },
    ],
    timeout: 30000,                       // 连接超时时间（毫秒）30秒
  },

  // ==================== 转码配置 ====================
  transcode: {
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',              // FFmpeg可执行文件路径
    outputDir: process.env.TRANSCODE_OUTPUT_DIR || '/tmp/transcodes', // 转码输出目录
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_TRANSCODES || '3'), // 最大并发转码数
    timeout: parseInt(process.env.TRANSCODE_TIMEOUT || '300000'),        // 转码超时时间（毫秒）
    defaultSettings: {                   // 默认转码参数
      videoCodec: 'h264',                // 视频编码
      audioCodec: 'aac',                 // 音频编码
      videoBitrate: 2000000,             // 视频码率 2Mbps
      audioBitrate: 128000,              // 音频码率 128kbps
      fps: 30,                           // 帧率
    },
  },

  // ==================== 流媒体配置 ====================
  streaming: {
    // HLS配置
    hls: {
      segmentDuration: 10,               // 分段时长（秒）
      segmentCount: 5,                   // 保留分段数
    },
    // RTMP配置
    rtmp: {
      enabled: true,                     // 是否启用RTMP
      port: 1935,                        // RTMP端口
    },
    // WebRTC配置
    webrtc: {
      enabled: true,                     // 是否启用WebRTC
      port: 8555,                        // WebRTC端口
    },
    // 默认协议
    defaultProtocol: 'hls',              // 默认播放协议
  },

  // ==================== 录制配置 ====================
  recording: {
    defaultStorageType: 'hot',           // 默认存储类型: hot（热存储）, cold（冷存储）
    outputDir: process.env.RECORDING_OUTPUT_DIR || '/tmp/recordings', // 录制输出目录
    maxDuration: 86400,                  // 最大录制时长（秒）24小时
    format: 'mp4',                       // 录制格式
    autoSplit: true,                     // 是否自动分割
    splitDuration: 3600,                 // 分割时长（秒）1小时
  },

  // ==================== 存储配置 ====================
  storage: {
    type: process.env.STORAGE_TYPE || 'minio',      // 存储类型: 'aws' | 'tencent' | 'minio'
    minio: {                              // MinIO对象存储配置
      endpoint: process.env.MINIO_ENDPOINT || 'localhost:9000',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
      bucket: process.env.MINIO_BUCKET || 'videos',
      useSSL: process.env.MINIO_USE_SSL === 'true',
    },
  },

  // ==================== 会话管理配置 ====================
  session: {
    timeout: 3600000,                    // 会话超时（毫秒）1小时
    heartbeatInterval: 30000,            // 心跳间隔（毫秒）30秒
    maxViewers: 100,                     // 单个会话最大观众数
  },

  // ==================== 服务间通信配置 ====================
  serviceClient: {
    apiKey: process.env.SERVICE_API_KEY || '',
    timeout: parseInt(process.env.SERVICE_CLIENT_TIMEOUT || '10000'),
    maxRetries: 2,
    retryDelay: 1000,
  },

  // ==================== 监控配置 ====================
  metrics: {
    enabled: true,                      // 是否启用监控
    collectInterval: 60000,             // 采集间隔（毫秒）1分钟
  },

} as MidwayConfig;
