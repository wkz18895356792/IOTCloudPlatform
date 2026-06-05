import { UserRole } from '@baby-monitor/shared-types';

/**
 * 权限配置
 * 定义路径与所需权限的映射关系
 */

/**
 * 路径权限配置
 * 路径 -> { HTTP方法 -> 所需权限数组 }
 */
export const PERMISSION_CONFIG: Record<string, Record<string, string[]> | { ALL: string[] }> = {
  // ==================== 设备相关 ====================
  '/api/devices': {
    GET: ['device:read'],
    POST: ['device:create'],
  },
  '/api/devices/:id': {
    GET: ['device:read'],
    PUT: ['device:update'],
    DELETE: ['device:delete'],
  },
  '/api/devices/:id/control': {
    POST: ['device:control'],
  },
  '/api/devices/:id/commands': {
    GET: ['device:read'],
  },
  '/api/devices/:id/state': {
    GET: ['device:read'],
  },

  // ==================== 用户相关 ====================
  '/api/users': {
    GET: ['user:read'],
    POST: ['user:create'],
  },
  '/api/users/:id': {
    GET: ['user:read'],
    PUT: ['user:update'],
    DELETE: ['user:delete'],
  },
  '/api/users/me': {
    GET: ['user:read'],
    PUT: ['user:update'],
  },

  // ==================== 家庭相关 ====================
  '/api/families': {
    GET: ['family:read'],
    POST: ['family:create'],
  },
  '/api/families/:id': {
    GET: ['family:read'],
    PUT: ['family:update'],
    DELETE: ['family:delete'],
  },
  '/api/families/:id/members': {
    GET: ['family:read'],
    POST: ['family:manage'],
  },
  '/api/families/:id/members/:memberId': {
    DELETE: ['family:manage'],
  },

  // ==================== 婴儿相关 ====================
  '/api/babies': {
    GET: ['baby:read'],
    POST: ['baby:create'],
  },
  '/api/babies/:id': {
    GET: ['baby:read'],
    PUT: ['baby:update'],
    DELETE: ['baby:delete'],
  },
  '/api/babies/:id/feedings': {
    GET: ['baby:read'],
    POST: ['baby:update'],
  },
  '/api/babies/:id/sleep': {
    GET: ['baby:read'],
    POST: ['baby:update'],
  },
  '/api/babies/:id/monitoring': {
    GET: ['baby:read'],
  },
  '/api/babies/:id/events': {
    GET: ['baby:read'],
  },

  // ==================== 存储相关 ====================
  '/api/storage/files': {
    GET: ['storage:read'],
    POST: ['storage:create'],
  },
  '/api/storage/files/:id': {
    GET: ['storage:read'],
    DELETE: ['storage:delete'],
  },
  '/api/storage/upload': {
    POST: ['storage:create'],
  },

  // ==================== 流媒体相关 ====================
  '/api/stream': {
    GET: ['stream:read'],
    POST: ['stream:create'],
  },
  '/api/stream/:id': {
    GET: ['stream:read'],
    DELETE: ['stream:delete'],
  },
  '/api/stream/:id/webrtc': {
    POST: ['stream:create'],
  },

  // ==================== 设备网关管理 ====================
  '/api/gateway': {
    GET: ['device:read'],
    POST: ['device:control'],
  },
  '/api/gateway/sessions': {
    GET: ['device:read'],
  },
  '/api/gateway/queue': {
    GET: ['device:read'],
  },

  // ==================== 管理功能（仅管理员） ====================
  '/api/admin': {
    ALL: ['admin:*'],
  },
  '/api/admin/users': {
    ALL: ['admin:*'],
  },
  '/api/admin/devices': {
    ALL: ['admin:*'],
  },
  '/api/admin/system': {
    ALL: ['admin:*'],
  },
};

/**
 * 角色权限映射
 * 定义每个角色拥有的权限列表
 */
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  /**
   * 管理员 - 拥有所有权限
   */
  [UserRole.ADMIN]: ['*'],

  /**
   * 普通用户 - 拥有基本操作权限
   */
  [UserRole.USER]: [
    // 设备权限
    'device:read',
    'device:create',
    'device:update',
    'device:control',
    'device:delete',

    // 用户权限
    'user:read',
    'user:update',

    // 家庭权限
    'family:read',
    'family:create',
    'family:update',
    'family:delete',
    'family:manage',

    // 婴儿权限
    'baby:read',
    'baby:create',
    'baby:update',
    'baby:delete',

    // 存储权限
    'storage:read',
    'storage:create',
    'storage:delete',

    // 流媒体权限
    'stream:read',
    'stream:create',
    'stream:delete',

    // MQTT 网关权限
    'mqtt:read',
  ],

  /**
   * 访客 - 只有只读权限
   */
  [UserRole.GUEST]: [
    // 只读权限
    'device:read',
    'user:read',
    'family:read',
    'baby:read',
    'storage:read',
    'stream:read',
    'mqtt:read',
  ],
};

/**
 * 公开路径（不需要认证和权限）
 */
export const PUBLIC_PATHS = [
  // 认证相关 - 公开
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/send-code',
  '/api/auth/verify-code',
  '/api/auth/refresh',
  '/api/auth/reset-password',
  '/api/auth/check-username',
  '/api/auth/check-email',
  '/api/auth/check-phone',
  '/api/auth/providers',
  // OAuth - 公开
  '/api/oauth/providers',
  '/api/oauth/authorize',
  '/api/oauth/callback',
  // 订阅服务 - 部分公开
  '/api/subscription/plans',
  // 帮助中心 - 公开
  '/api/help/articles',
  '/api/help/search',
  '/api/help/categories',
  // 铃声 - 公开
  '/api/ringtones',
  // 系统接口 - 公开
  '/health',
  '/health/',
  '/swagger',
  '/swagger-ui',
  '/swagger-ui/',
  // 开发/测试接口
  '/api/seed',
];

/**
 * 需要资源级权限检查的路径模式
 */
export const RESOURCE_CHECK_PATHS = {
  // 设备资源检查 - 检查用户是否有权限访问指定设备
  device: {
    pattern: /^\/api\/devices\/([^/]+)(?:\/|$)/,
    permissionPrefix: 'device',
  },
  // 家庭资源检查 - 检查用户是否是家庭成员
  family: {
    pattern: /^\/api\/families\/([^/]+)(?:\/|$)/,
    permissionPrefix: 'family',
  },
  // 婴儿资源检查 - 检查用户是否有权限访问指定宝宝数据
  baby: {
    pattern: /^\/api\/babies\/([^/]+)(?:\/|$)/,
    permissionPrefix: 'baby',
  },
};
