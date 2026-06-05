/**
 * API 通用模型类型定义
 * 纯 TypeScript 类型，不依赖任何框架
 */

/**
 * 通用响应结构
 */
export interface ApiResponseDto<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  message?: string;
  total?: number;
}

/**
 * 分页请求参数
 */
export interface PaginationDto {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * 分页响应结构
 */
export interface PaginatedResponseDto<T = any> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 创建速率限制规则请求
 */
export interface CreateRateLimitRuleDto {
  pattern: string;
  windowMs: number;
  maxRequests: number;
  priority?: number;
}

/**
 * 重置速率限制请求
 */
export interface ResetRateLimitDto {
  identifier: string;
  endpoint: string;
}

/**
 * 注册服务请求
 */
export interface RegisterServiceDto {
  name: string;
  host: string;
  port: number;
  protocol?: 'http' | 'https';
  healthCheckUrl?: string;
  metadata?: Record<string, any>;
  ttl?: number;
}

/**
 * 注册熔断器服务请求
 */
export interface RegisterCircuitServiceDto {
  service: string;
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  monitoringPeriod?: number;
  halfOpenMaxCalls?: number;
}

/**
 * 查询日志请求
 */
export interface QueryLogsDto {
  startTime?: number;
  endTime?: number;
  method?: string;
  path?: string;
  userId?: string;
  statusCode?: number;
  minDuration?: number;
  maxDuration?: number;
  limit?: number;
  offset?: number;
}

/**
 * 用户登录请求
 */
export interface LoginRequestDto {
  account: string;
  password: string;
}

/**
 * 用户注册请求
 */
export interface RegisterRequestDto {
  username: string;
  email: string;
  password: string;
  verificationCode: string;
  codeType: 'email' | 'phone';
}

/**
 * 刷新Token请求
 */
export interface RefreshTokenDto {
  refreshToken: string;
}

/**
 * 修改密码请求
 */
export interface ChangePasswordDto {
  oldPassword: string;
  newPassword: string;
}

/**
 * 设备创建请求
 */
export interface CreateDeviceDto {
  serialNumber: string;
  name: string;
  productType: string;
  protocol: string;
  description?: string;
  location?: string;
}

/**
 * 设备命令请求
 */
export interface DeviceCommandDto {
  type: string;
  payload?: Record<string, any>;
  timeout?: number;
}

/**
 * 宝宝创建请求
 */
export interface CreateBabyDto {
  name: string;
  birthDate: string;
  gender: 'male' | 'female';
  height?: number;
  weight?: number;
  avatar?: string;
}

/**
 * 开始喂养请求
 */
export interface StartFeedingDto {
  type?: 'breast_milk' | 'formula' | 'solid_food';
}

/**
 * 结束喂养请求
 */
export interface EndFeedingDto {
  amount?: number;
  notes?: string;
}

/**
 * 开始睡眠请求
 */
export interface StartSleepDto {
  type?: 'nap' | 'night' | 'morning' | 'afternoon';
}

/**
 * 结束睡眠请求
 */
export interface EndSleepDto {
  quality?: 'excellent' | 'good' | 'fair' | 'poor';
  wokeUpTimes?: number;
  notes?: string;
}

/**
 * 开始推流请求
 */
export interface StartStreamDto {
  deviceId: string;
  config: {
    protocol?: 'hls' | 'rtmp' | 'webrtc';
    video?: {
      codec: string;
      bitrate: number;
      fps: number;
      resolution: string;
    };
    audio?: {
      codec: string;
      bitrate: number;
    };
  };
  provider?: string;
}

/**
 * 创建分享链接请求
 */
export interface CreateShareDto {
  fileId: string;
  createdBy: string;
  name: string;
  description?: string;
  permission: 'view' | 'download' | 'upload';
  expiresAt: number;
  password?: string;
  maxAccess?: number;
}

/**
 * 配置Matter设备请求
 */
export interface CommissionMatterDto {
  setupPayload: string;
  networkCredentials: {
    ssid: string;
    password: string;
  };
}

/**
 * 配置私有协议设备请求
 */
export interface CommissionPrivateDto {
  serialNumber: string;
  productType: string;
}
