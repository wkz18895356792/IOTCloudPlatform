/**
 * AWS 凭证配置
 *
 * 配置 AWS STS 临时凭证的获取参数。
 * 包含 KVS（流媒体）和 S3（存储）两种凭证配置。
 *
 * 凭证用于：
 * - 设备直接向 AWS Kinesis Video Streams 推流
 * - 设备或用户直接上传文件到 S3
 *
 * 安全说明：
 * - 使用 IAM Role ARN 通过 STS 获取临时凭证
 * - 凭证有时效性（默认 1 小时）
 * - 自动刷新机制（默认 35 分钟）
 */
import { CredentialsConfig } from '@baby-monitor/aws-credentials';

/**
 * 构建 IAM Role ARN
 *
 * 如果未提供完整的 ARN，则从环境变量 AWS_ACCOUNT_ID 和角色名构造。
 * IAM Role ARN 格式：arn:aws:iam::{ACCOUNT_ID}:role/{ROLE_NAME}
 */
function buildRoleArn(providedArn: string | undefined, defaultRoleName: string): string {
  if (providedArn) {
    return providedArn;
  }
  const accountId = process.env.AWS_ACCOUNT_ID;
  if (accountId) {
    // IAM Role ARN 格式: arn:aws:iam::{ACCOUNT_ID}:role/{ROLE_NAME}
    return `arn:aws:iam::${accountId}:role/${defaultRoleName}`;
  }
  return '';
}

/**
 * AWS KVS 流媒体推流凭证配置
 *
 * 使用场景：设备需要直接向 AWS Kinesis Video Streams 推流
 * 权限范围：仅限 KVS 相关操作
 */
export const kvsCredentialsConfig: CredentialsConfig = {
  // KVS 专用的 IAM Role ARN
  roleArn: buildRoleArn(process.env.AWS_KVS_ROLE_ARN, process.env.AWS_KVS_ROLE_NAME || process.env.AWS_DEVICE_ROLE_NAME || 'SageMakerInvokeOnlyRole'),
  // 会话名称，便于在 AWS CloudTrail 中追踪
  roleSessionName: 'baby-monitor-kvs-stream',
  // 凭证有效期：1小时（AWS STS 最大支持 12 小时，但建议较短）
  durationSeconds: 3600,
  // 刷新间隔：35分钟（在凭证过期前自动刷新）
  refreshInterval: 2100,
  // AWS 区域
  region: process.env.AWS_REGION || 'cn-north-1',
};

/**
 * AWS S3 文件上传凭证配置
 *
 * 使用场景：设备或用户需要上传文件到 S3
 * 权限范围：仅限 S3 上传相关操作
 */
export const s3CredentialsConfig: CredentialsConfig = {
  // S3 专用的 IAM Role ARN
  roleArn: buildRoleArn(process.env.AWS_S3_ROLE_ARN, process.env.AWS_S3_ROLE_NAME || process.env.AWS_DEVICE_ROLE_NAME || 'SageMakerInvokeOnlyRole'),
  // 会话名称，便于在 AWS CloudTrail 中追踪
  roleSessionName: 'baby-monitor-s3-upload',
  // 凭证有效期：1小时
  durationSeconds: 3600,
  // 刷新间隔：35分钟
  refreshInterval: 2100,
  // AWS 区域
  region: process.env.AWS_REGION || 'cn-north-1',
};
