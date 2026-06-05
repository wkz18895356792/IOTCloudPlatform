/**
 * AWS 凭证配置
 *
 * 配置 AWS STS 临时凭证的获取参数。
 *
 * 安全说明：
 * - 使用 IAM Role ARN 通过 STS 获取临时凭证
 * - 凭证有时效性（默认 1 小时）
 * - 自动刷新机制（默认 35 分钟）
 */
import { CredentialsConfig } from '@baby-monitor/aws-credentials';
import { join } from 'path';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';

// 在模块加载时立即加载 .env（确保环境变量可用）
const envPaths = [
  join(__dirname, '../../../.env'),  // 开发环境: src/config -> root .env
  join(__dirname, '../../../../.env'), // 备用路径
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

/**
 * 凭证配置键常量（用于获取凭证）
 */
export const KVS_CREDENTIALS_KEY = 'kvs';
export const S3_CREDENTIALS_KEY = 's3';

/**
 * 构建 IAM Role ARN
 *
 * 如果未提供完整的 ARN，则从环境变量 AWS_ACCOUNT_ID 和角色名构造。
 * IAM Role ARN 格式：arn:aws:iam::{ACCOUNT_ID}:role/{ROLE_NAME}
 */
export function buildRoleArn(providedArn: string | undefined, defaultRoleName: string): string {
  if (providedArn) {
    console.log(`[credentials.config] Using provided ARN for ${defaultRoleName}: ${providedArn}`);
    return providedArn;
  }
  const accountId = process.env.AWS_ACCOUNT_ID;
  if (accountId) {
    // IAM Role ARN 格式: arn:aws:iam::{ACCOUNT_ID}:role/{ROLE_NAME}
    const arn = `arn:aws:iam::${accountId}:role/${defaultRoleName}`;
    console.log(`[credentials.config] Built ARN for ${defaultRoleName} from account ID: ${arn}`);
    return arn;
  }
  console.log(`[credentials.config] WARNING: No ARN or account ID provided for ${defaultRoleName}, returning empty string`);
  return '';
}

/**
 * 创建 KVS 凭证配置（延迟创建，确保环境变量已加载）
 */
export function createKVSCredentialsConfig(): CredentialsConfig {
  return {
    roleArn: buildRoleArn(process.env.AWS_KVS_ROLE_ARN, process.env.AWS_KVS_ROLE_NAME || process.env.AWS_DEVICE_ROLE_NAME || 'SageMakerInvokeOnlyRole'),
    roleSessionName: 'baby-monitor-kvs-stream',
    durationSeconds: 3600,
    refreshInterval: 2100,
    region: process.env.AWS_REGION || 'cn-north-1',
  };
}

/**
 * 创建 S3 凭证配置（延迟创建，确保环境变量已加载）
 */
export function createS3CredentialsConfig(): CredentialsConfig {
  return {
    roleArn: buildRoleArn(process.env.AWS_S3_ROLE_ARN, process.env.AWS_S3_ROLE_NAME || process.env.AWS_DEVICE_ROLE_NAME || 'S3AccessRole'),
    roleSessionName: 'baby-monitor-s3-upload',
    durationSeconds: 3600,
    refreshInterval: 2100,
    region: process.env.AWS_REGION || 'cn-north-1',
  };
}
