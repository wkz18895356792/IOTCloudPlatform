import { CredentialsConfig } from '@baby-monitor/aws-credentials';

/**
 * 构建 IAM Role ARN
 *
 * 如果未提供完整的 roleArn，则从 AWS_ACCOUNT_ID 和 role name 构造
 *
 * @param providedArn - 提供的ARN（可能为空）
 * @param defaultRoleName - 默认角色名称
 * @returns 完整的IAM Role ARN
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
  roleArn: buildRoleArn(
    process.env.AWS_KVS_ROLE_ARN,
    process.env.AWS_KVS_ROLE_NAME || process.env.AWS_DEVICE_ROLE_NAME || 'SageMakerInvokeOnlyRole'
  ),
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
 * KVS 凭证策略（可选，用于进一步限制权限）
 *
 * 如果使用此策略，IAM Role 的权限将被进一步限制为仅能访问指定设备的流
 */
export const kvsRestrictedPolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: [
        'kinesisvideo:DescribeStream',      // 描述流
        'kinesisvideo:GetDataEndpoint',     // 获取数据端点
        'kinesisvideo:PutMedia',            // 推送媒体数据
        'kinesisvideo:GetHLSStreamingSessionURL', // 获取HLS播放URL
      ],
      // 仅允许访问指定前缀的流资源
      Resource: `arn:aws:kinesisvideo:${process.env.AWS_REGION || 'cn-north-1'}:${process.env.AWS_ACCOUNT_ID || '*'}:stream/device-*`,
    },
  ],
});

/**
 * 所有流媒体服务的凭证配置映射
 *
 * 可以通过服务名称获取对应的凭证配置
 */
export const streamCredentialsConfigs: Record<string, CredentialsConfig> = {
  kvs: kvsCredentialsConfig,  // AWS KVS凭证配置
};
