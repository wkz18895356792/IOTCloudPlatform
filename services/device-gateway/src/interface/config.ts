/**
 * MQTT配置接口
 */
export interface IMqttConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  options?: {
    clientId?: string;
    clean?: boolean;
    connectTimeout?: number;
    keepalive?: number;
    reconnectPeriod?: number;
    rejectUnauthorized?: boolean;
  };
  qos?: {
    default?: number;
    max?: number;
  };
  subscriptions?: Array<{
    topic: string;
    qos: number;
  }>;
  ws?: {
    enabled?: boolean;
    port?: number;
    path?: string;
  };
  tls?: {
    enabled?: boolean;
    caPath?: string;
    keyPath?: string;
    certPath?: string;
  };
}

/**
 * Matter协议配置接口
 */
export interface IMatterConfig {
  enabled: boolean;
  sdk?: {
    version?: string;
    mdns?: {
      enabled?: boolean;
      interface?: string;
    };
    udp?: {
      port?: number;
      timeout?: number;
      maxRetries?: number;
    };
    tcp?: {
      port?: number;
      timeout?: number;
      maxRetries?: number;
    };
  };
  controller?: {
    port?: number;
    udpPort?: number;
  };
  discovery?: {
    enabled?: boolean;
    timeout?: number;
    interval?: number;
    serviceTypes?: string[];
  };
  commissioning?: {
    timeout?: number;
    maxRetries?: number;
    wifiConfigTimeout?: number;
    networkConnectionWait?: number;
    commissioningModeTimeout?: number;
  };
  crypto?: {
    aesKeySize?: number;
    aesBlockSize?: number;
    nonceSize?: number;
  };
  subscription?: {
    defaultMinInterval?: number;
    defaultMaxInterval?: number;
    subscriptionTimeout?: number;
  };
}

/**
 * 私有协议配置接口
 */
export interface IPrivateProtocolConfig {
  version: string;
  signatureAlgorithm: string;
  messageTimeout: number;
  supportedProductTypes: string[];
}

/**
 * 协议转换配置接口
 */
export interface IConverterConfig {
  cache?: {
    enabled?: boolean;
    ttl?: number;
  };
  batch?: {
    maxBatchSize?: number;
    timeout?: number;
  };
}

/**
 * 设备发现配置接口
 */
export interface IDiscoveryConfig {
  interval: number;
  timeout: number;
  cacheTTL: number;
  autoRefresh: boolean;
}

/**
 * 协议路由配置接口
 */
export interface IRouterConfig {
  defaultRoutes: Array<{
    name: string;
    sourceProtocol?: string;
    targetProtocol?: string;
    topicPattern: string;
    enabled: boolean;
    priority: number;
  }>;
  processing?: {
    maxQueueSize?: number;
    maxConcurrency?: number;
    timeout?: number;
  };
}

/**
 * ACL配置接口
 */
export interface IAclConfig {
  rateLimit?: {
    maxMessages?: number;
    windowMs?: number;
    maxConnections?: number;
  };
  defaultPermissions?: {
    user?: number;
    device?: number;
  };
}
