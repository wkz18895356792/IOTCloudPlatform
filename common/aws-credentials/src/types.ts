/**
 * AWS凭证服务 - 类型定义
 *
 * 提供AWS临时凭证管理功能，支持STS Assume Role获取临时访问凭证
 * 自动管理凭证的刷新和缓存，确保服务始终拥有有效的AWS访问权限
 */

/**
 * AWS临时凭证
 * 通过STS Assume Role获取的临时访问凭证
 */
export interface AWSTemporaryCredentials {
  /** AWS访问密钥ID - 用于标识凭证 */
  accessKeyId: string;
  /** AWS秘密访问密钥 - 用于签名请求 */
  secretAccessKey: string;
  /** 会话令牌 - 与临时凭证配合使用 */
  sessionToken: string;
  /** 凭证过期时间 - 超期后需要重新获取 */
  expiration: Date;
}

/**
 * AWS凭证配置
 * 配置STS Assume Role的参数，用于获取临时凭证
 */
export interface CredentialsConfig {
  /** IAM角色ARN - 要扮演的角色资源名称 */
  roleArn: string;
  /** 角色会话名称 - 用于标识会话，便于审计追踪 */
  roleSessionName: string;
  /** 凭证有效期 - 单位秒，范围900-43200（15分钟到12小时） */
  durationSeconds: number;
  /** 刷新间隔 - 单位秒，建议设置为durationSeconds的70%，提前刷新避免过期 */
  refreshInterval: number;
  /** AWS区域 - 如 us-east-1、cn-north-1（可选） */
  region?: string;
  /** 外部ID - 用于跨账户访问时的额外安全验证（可选） */
  externalId?: string;
  /** 策略文档 - JSON格式的权限策略，进一步限制临时凭证的权限（可选） */
  policy?: string;
}

/**
 * 凭证状态
 * 描述当前缓存凭证的状态信息
 */
export interface CredentialsStatus {
  /** 凭证键 - 用于标识和检索特定凭证 */
  key: string;
  /** 是否已缓存 - true表示凭证已存在于缓存中 */
  cached: boolean;
  /** 剩余有效时间 - 单位秒，表示凭证还有多久过期 */
  ttl: number;
  /** 是否即将过期 - true表示TTL小于5分钟，需要尽快刷新 */
  expiring: boolean;
}

/**
 * 凭证刷新事件
 * 记录凭证刷新操作的结果
 */
export interface CredentialsRefreshEvent {
  /** 凭证键 - 被刷新的凭证标识 */
  key: string;
  /** 刷新是否成功 - true表示刷新成功获得新凭证 */
  success: boolean;
  /** 新凭证过期时间 - 刷新成功后记录（可选） */
  expiration?: Date;
  /** 错误信息 - 刷新失败时记录错误原因（可选） */
  error?: string;
  /** 事件时间戳 - 记录刷新操作发生的时间 */
  timestamp: Date;
}
