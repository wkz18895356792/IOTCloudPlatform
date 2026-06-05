import { CredentialsConfig } from '@baby-monitor/aws-credentials';

/**
 * AWS S3 文件上传凭证配置
 *
 * 使用场景：设备或用户需要直接上传文件到 S3（而不经过后端服务器）
 * 权限范围：仅限 S3 上传相关操作，遵循最小权限原则
 */
export const s3CredentialsConfig: CredentialsConfig = {
  // S3 专用的 IAM Role ARN，用于临时凭证授权
  roleArn: process.env.AWS_S3_ROLE_ARN || '',
  // 会话名称，便于在 AWS CloudTrail 日志中追踪操作来源
  roleSessionName: 'baby-monitor-s3-upload',
  // 凭证有效期：1小时（秒）
  durationSeconds: 3600,
  // 提前刷新间隔：35分钟（秒），在凭证过期前自动刷新
  refreshInterval: 2100,
  // AWS 区域
  region: process.env.AWS_REGION || 'cn-north-1',
};

/**
 * S3 限制性权限策略生成器
 *
 * 为特定设备生成最小权限策略，限制设备只能上传到自己的目录
 * @param deviceId 设备ID，用于限制只能访问特定前缀的路径
 * @returns JSON格式的IAM策略字符串
 */
export const s3RestrictedPolicy = (deviceId?: string) => JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      // 允许的操作：上传对象、分片上传相关操作
      Action: [
        's3:PutObject',                 // 上传对象
        's3:AbortMultipartUpload',       // 取消分片上传
        's3:ListMultipartUploadParts',   // 列出已上传的分片
        's3:PutObjectAcl',               // 设置对象ACL
      ],
      // 资源限制：只能访问指定设备的目录
      Resource: [
        `arn:aws:s3:::${process.env.AWS_S3_BUCKET || 'baby-monitor-files'}/${deviceId ? `devices/${deviceId}/*` : 'devices/*'}`,
      ],
    },
    {
      Effect: 'Allow',
      Action: ['s3:ListBucket'],         // 允许列出bucket内容
      Resource: `arn:aws:s3:::${process.env.AWS_S3_BUCKET || 'baby-monitor-files'}`,
      Condition: {
        StringLike: {
          // 限制只能列出特定前缀的对象
          's3:prefix': [deviceId ? `devices/${deviceId}/*` : 'devices/*'],
        },
      },
    },
  ],
});

/**
 * 所有存储服务的凭证配置映射表
 *
 * 可通过服务名称快速获取对应的凭证配置
 */
export const storageCredentialsConfigs: Record<string, CredentialsConfig> = {
  s3: s3CredentialsConfig,  // AWS S3 的凭证配置
  // 未来可添加其他存储提供商的凭证配置
  // cos: cosCredentialsConfig,
  // minio: minioCredentialsConfig,
};
