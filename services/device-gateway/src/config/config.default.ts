import { MidwayConfig } from '@midwayjs/core';
import { join } from 'path';
import { EnvResolver } from '@baby-monitor/shared-utils';

/**
 * Device Gateway Service 默认配置
 *
 * 统一的设备网关服务，整合了 MQTT Gateway 和 Protocol Adapter 的功能
 * - MQTT 连接管理和消息路由
 * - 协议转换（Matter、私有协议）
 * - 设备注册和认证
 * - 会话管理和 ACL
 */
export default {
  // ==================== 基础配置 ====================
  keys: EnvResolver.require('SESSION_KEYS'),

  koa: {
    port: 6010,                                    // 统一设备网关端口
  },

  // ==================== Swagger配置 ====================
  swagger: {
    title: 'Device Gateway Service',
    description: '智能家居云平台 - 统一设备网关服务（整合MQTT网关和协议适配）',
    version: '2.0.0',
    path: '/swagger-ui',
  },

  // ==================== MQTT配置 ====================
  mqtt: {
    // MQTT Broker连接配置
    host: EnvResolver.require('MQTT_HOST'),
    port: EnvResolver.getNumber('MQTT_PORT', 1883),
    username: EnvResolver.get('MQTT_USERNAME', ''),
    password: EnvResolver.get('MQTT_PASSWORD', ''),

    // 连接选项
    options: {
      clientId: process.env.MQTT_CLIENT_ID || 'device-gateway',
      clean: process.env.MQTT_CLEAN !== 'false',
      connectTimeout: parseInt(process.env.MQTT_CONNECT_TIMEOUT || '4000'),
      keepalive: parseInt(process.env.MQTT_KEEPALIVE || '60'),
      reconnectPeriod: parseInt(process.env.MQTT_RECONNECT_PERIOD || '1000'),
      rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED === 'true',
    },

    // QoS配置
    qos: {
      default: parseInt(process.env.MQTT_QOS || '1'),
      max: 2,
    },

    // 订阅主题配置
    subscriptions: [
      // 设备生命周期
      { topic: 'devices/+/register', qos: 1 },
      { topic: 'devices/+/auth', qos: 1 },
      { topic: 'devices/+/heartbeat', qos: 1 },
      // 设备数据上报
      { topic: 'devices/+/report', qos: 1 },
      { topic: 'devices/+/status', qos: 1 },
      { topic: 'devices/+/event', qos: 1 },
      // 设备命令响应
      { topic: 'devices/+/command/response', qos: 1 },
      // 设备配置（从 mqtt-gateway 迁移）
      { topic: 'devices/+/config/request', qos: 1 },
      { topic: 'devices/+/config/response', qos: 1 },
      // 设备凭证（从 mqtt-gateway 迁移）
      { topic: 'devices/+/credentials/request', qos: 1 },
      { topic: 'devices/+/credentials/response', qos: 1 },
      // Matter 协议
      { topic: 'matter/+/attribute', qos: 1 },
      { topic: 'matter/+/command', qos: 1 },
    ],

    // WebSocket配置（用于WebSocket-MQTT桥接）
    ws: {
      enabled: process.env.MQTT_WS_ENABLED === 'true',
      port: parseInt(process.env.MQTT_WS_PORT || '8083'),
      path: process.env.MQTT_WS_PATH || '/mqtt',
    },

    // TLS配置
    tls: {
      enabled: process.env.MQTT_TLS_ENABLED === 'true',
      caPath: process.env.MQTT_TLS_CA_PATH || '',
      keyPath: process.env.MQTT_TLS_KEY_PATH || '',
      certPath: process.env.MQTT_TLS_CERT_PATH || '',
      rejectUnauthorized: process.env.MQTT_TLS_REJECT_UNAUTHORIZED === 'true',
    },
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

  // ==================== TypeORM配置 ====================
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
        timezone: '+08:00',
        charset: 'utf8mb4',
        extra: {
          connectionLimit: 10,
        },
      },
    },
  },

  // ==================== WebSocket配置 ====================
  socketIo: {
    path: '/socket.io/',
    cors: {
      origin: '*',
      credentials: true,
    },
    maxHttpBufferSize: 1e6,
    pingTimeout: 60000,
    pingInterval: 25000,
    maxDisconnectionDuration: 120000,
  },

  // ==================== 会话配置 ====================
  session: {
    ttl: 86400,                                   // 会话过期时间（秒），24小时
    heartbeatTimeout: 300000,                     // 心跳超时（毫秒），5分钟
    cleanupInterval: 3600000,                     // 清理间隔（毫秒），1小时
  },

  // ==================== 消息队列配置 ====================
  messageQueue: {
    ttl: 86400,                                   // 队列消息过期时间（秒）
    deadLetterTtl: 604800,                        // 死信消息过期时间（秒）
    deliveredTtl: 3600,                           // 已投递消息保留时间（秒）
    maxAttempts: 3,                               // 最大重试次数
    retryBaseDelay: 1000,                         // 重试基础延迟（毫秒）
    retryMaxDelay: 60000,                         // 重试最大延迟（毫秒）
  },

  // ==================== ACL配置 ====================
  acl: {
    // 默认速率限制
    rateLimit: {
      maxMessages: 100,                           // 每分钟最大消息数
      windowMs: 60000,                            // 时间窗口（毫秒）
      maxConnections: 5,                          // 最大并发连接数
    },
    // 权限默认值
    defaultPermissions: {
      user: 15,                                   // READ | WRITE | SUBSCRIBE | PUBLISH
      device: 10,                                 // READ | PUBLISH
    },
  },

  // ==================== Matter协议配置 ====================
  matter: {
    enabled: true,

    // Matter SDK配置
    sdk: {
      version: '1.5',

      // mDNS配置
      mdns: {
        enabled: true,
        interface: undefined,
      },

      // UDP配置
      udp: {
        port: 5540,
        timeout: 5000,
        maxRetries: 3,
      },

      // TCP配置
      tcp: {
        port: 5540,
        timeout: 10000,
        maxRetries: 3,
      },
    },

    // Matter控制器配置
    controller: {
      port: 5580,
      udpPort: 5580,
    },

    // 设备发现配置
    discovery: {
      enabled: true,
      timeout: 30000,
      interval: 60000,
      serviceTypes: [
        '_matter._tcp',
        '_matterc._udp',
      ],
    },

    // 配网配置
    commissioning: {
      timeout: 300000,                            // 配网超时（5分钟）
      maxRetries: 3,
      wifiConfigTimeout: 60000,
      networkConnectionWait: 60000,
      commissioningModeTimeout: 600000,
    },

    // 加密配置
    crypto: {
      aesKeySize: 16,
      aesBlockSize: 16,
      nonceSize: 13,
    },

    // 订阅配置
    subscription: {
      defaultMinInterval: 1,
      defaultMaxInterval: 60,
      subscriptionTimeout: 3600,
    },
  },

  // ==================== 私有协议配置 ====================
  privateProtocol: {
    version: '1.0',
    signatureAlgorithm: 'sha256',
    messageTimeout: 300000,                       // 消息超时（5分钟）
    supportedProductTypes: [
      'camera',
      'screen',
      'sensor',
      'gateway',
      'light',
      'switch',
      'thermostat',
      'lock',
      'plug',
    ],
  },

  // ==================== 协议转换配置 ====================
  converter: {
    cache: {
      enabled: true,
      ttl: 3600,                                  // 缓存过期时间（1小时）
    },
    batch: {
      maxBatchSize: 100,
      timeout: 10000,
    },
  },

  // ==================== 设备发现配置 ====================
  discovery: {
    interval: 300000,                             // 发现间隔（5分钟）
    timeout: 30000,                               // 发现超时（30秒）
    cacheTTL: 3600,                               // 缓存过期时间（1小时）
    autoRefresh: true,
  },

  // ==================== 协议路由配置 ====================
  router: {
    defaultRoutes: [
      {
        name: 'Private to MQTT',
        sourceProtocol: 'private',
        topicPattern: 'devices/+/report',
        enabled: true,
        priority: 100,
      },
      {
        name: 'Matter to Private',
        sourceProtocol: 'matter',
        targetProtocol: 'private',
        topicPattern: 'matter/+/attribute',
        enabled: true,
        priority: 100,
      },
    ],
    processing: {
      maxQueueSize: 1000,
      maxConcurrency: 100,
      timeout: 5000,
    },
  },

  // ==================== 设备认证配置 ====================
  device: {
    secret: EnvResolver.require('DEVICE_SECRET'),
    tokenExpire: 86400,                           // 设备token过期时间（秒）
  },

  // ==================== 服务间通信配置 ====================
  serviceClient: {
    apiKey: EnvResolver.require('SERVICE_API_KEY'),
    timeout: EnvResolver.getNumber('SERVICE_TIMEOUT', 30000),
    maxRetries: EnvResolver.getNumber('SERVICE_MAX_RETRIES', 3),
    retryDelay: EnvResolver.getNumber('SERVICE_RETRY_DELAY', 1000),
    enableServiceDiscovery: EnvResolver.getBoolean('SERVICE_DISCOVERY_ENABLED', false),
  },

  // ==================== 日志配置 ====================
  midwayLogger: {
    clients: {
      coreLogger: {
        level: 'all',
        fileLogName: 'device-gateway-core.log',
        dir: join(__dirname, '../../logs'),
      },
      appLogger: {
        level: 'all',
        fileLogName: 'device-gateway-app.log',
        dir: join(__dirname, '../../logs'),
      },
    },
  },

  // ==================== 监控配置 ====================
  metrics: {
    enabled: true,
    collectInterval: 60000,
  },

} as MidwayConfig;
