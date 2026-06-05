/**
 * 服务路由配置
 *
 * 定义所有微服务的路由映射关系
 * 支持通过环境变量覆盖服务地址
 */

export interface ServiceRouteConfig {
  /** 服务名称 */
  name: string;
  /** 服务端口 */
  port: number;
  /** API路径前缀 */
  pathPrefixes: string[];
  /** 服务主机 (可通过环境变量覆盖) */
  host?: string;
  /** 是否需要认证 */
  requireAuth?: boolean;
  /** 服务描述 */
  description?: string;
}

/**
 * 所有微服务的路由配置
 */
export const serviceRoutesConfig: ServiceRouteConfig[] = [
  {
    name: 'user-service',
    port: 6002,
    pathPrefixes: [
      // 认证相关
      '/api/auth',
      '/api/oauth',
      // 用户管理
      '/api/users',
      '/api/app/users',
      '/api/admin/users',
      // 安全功能
      '/api/2fa',
      '/api/face-id',
      // 订阅服务
      '/api/subscription',
      // 通知设置
      '/api/ringtones',
      // 帮助与反馈
      '/api/feedback',
      '/api/help',
      // 设备访问管理（邀请、权限、观看记录）
      '/api/device-access',
      // 内部API
      '/api/internal/devices',
      '/api/seed',
    ],
    host: process.env.USER_SERVICE_HOST || 'localhost',
    requireAuth: false, // user-service 内部处理认证逻辑
    description: '用户认证和管理服务',
  },
  {
    name: 'device-service',
    port: 6003,
    pathPrefixes: [
      '/api/devices',
      '/api/device',
      '/api/firmware',
      '/api/v2/provisioning',
      '/api/admin/devices',
    ],
    host: process.env.DEVICE_SERVICE_HOST || 'localhost',
    requireAuth: true,
    description: '设备管理服务',
  },
  {
    name: 'video-service',
    port: 6004,
    pathPrefixes: ['/api/video-service', '/api/videos', '/api/video'],
    host: process.env.VIDEO_SERVICE_HOST || 'localhost',
    requireAuth: true,
    description: '视频服务',
  },
  {
    name: 'storage-service',
    port: 6005,
    pathPrefixes: ['/api/storage'],
    host: process.env.STORAGE_SERVICE_HOST || 'localhost',
    requireAuth: true,
    description: '文件存储服务',
  },
  {
    name: 'device-gateway',
    port: 6010,
    pathPrefixes: ['/api/gateway', '/api/device-gateway'],
    host: process.env.DEVICE_GATEWAY_HOST || 'localhost',
    requireAuth: true,
    description: '设备网关服务（整合MQTT网关和协议适配器）',
  },
  {
    name: 'baby-service',
    port: 6008,
    pathPrefixes: [
      '/api/babies',
      '/api/baby',
      '/api/baby-logs',
      '/api/monitoring',
      '/api/feeding',
      '/api/sleep',
      '/api/analytics',
    ],
    host: process.env.BABY_SERVICE_HOST || 'localhost',
    requireAuth: true,
    description: '婴儿护理服务',
  },
  {
    name: 'admin-service',
    port: 6009,
    pathPrefixes: ['/api/domains', '/api/admin/domains', '/api/admin/platform-admins', '/api/admin/statistics', '/api/admin/monitoring', '/api/admin/audit-logs'],
    host: process.env.ADMIN_SERVICE_HOST || 'localhost',
    requireAuth: true,
    description: '域管理服务',
  },
];

/**
 * 构建服务路由映射表
 * @returns 路径到服务URL的映射
 */
export function buildServiceRoutes(): Record<string, string> {
  const routes: Record<string, string> = {};

  for (const service of serviceRoutesConfig) {
    const serviceUrl = `http://${service.host}:${service.port}`;
    for (const prefix of service.pathPrefixes) {
      routes[prefix] = serviceUrl;
    }
  }

  return routes;
}

/**
 * 根据路径查找服务配置
 * @param path 请求路径
 * @returns 服务配置或undefined
 */
export function findServiceByPath(path: string): ServiceRouteConfig | undefined {
  for (const service of serviceRoutesConfig) {
    for (const prefix of service.pathPrefixes) {
      if (path.startsWith(prefix)) {
        return service;
      }
    }
  }
  return undefined;
}

/**
 * 获取服务URL
 * @param serviceName 服务名称
 * @returns 服务URL或undefined
 */
export function getServiceUrl(serviceName: string): string | undefined {
  const service = serviceRoutesConfig.find(s => s.name === serviceName);
  if (!service) {
    return undefined;
  }
  return `http://${service.host}:${service.port}`;
}

/**
 * 获取所有服务信息
 * @returns 所有服务配置
 */
export function getAllServices(): ServiceRouteConfig[] {
  return serviceRoutesConfig;
}
