import { Configuration, IMidwayContainer, App } from '@midwayjs/core';
import { join } from 'path';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { DeviceRegisterSubscriber } from './subscriber/device-register.subscriber';
import { DeviceMessageSubscriber } from './subscriber/device-message.subscriber';
import { DeviceStatusSubscriber } from './subscriber/device-status.subscriber';
import { DomainContextMiddleware, DomainDataFilterMiddleware, VerifiedUserContextMiddleware } from '@baby-monitor/shared-utils';
import { AWSCredentialsManager } from '@baby-monitor/aws-credentials';

// 加载 .env 文件（必须在任何其他导入之前）
console.log(`[Configuration] __dirname: ${__dirname}`);
console.log(`[Configuration] process.cwd(): ${process.cwd()}`);
console.log(`[Configuration] Current working directory: ${process.cwd()}`);

const envPaths = [
  join(__dirname, '../../../.env'),  // 开发环境: services/device-service/src -> .env
  join(__dirname, '../../.env'),     // 生产环境
  join(__dirname, '../../../../.env'), // 备用路径
];

let envLoaded = false;
for (const envPath of envPaths) {
  const fullPath = require('path').resolve(envPath);
  console.log(`[Configuration] Checking env path: ${fullPath}, exists: ${existsSync(fullPath)}`);
  if (existsSync(fullPath)) {
    console.log(`[Configuration] Loading .env from: ${fullPath}`);
    const result = dotenv.config({ path: fullPath });
    if (result.error) {
      console.error(`[Configuration] Error loading .env:`, result.error);
    } else {
      const keyCount = Object.keys(result.parsed || {}).length;
      console.log(`[Configuration] Successfully loaded ${keyCount} environment keys from .env`);
      // 打印几个关键环境变量用于验证
      console.log(`[Configuration] Sample env vars:`, {
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID?.substring(0, 10) + '...',
        AWS_REGION: process.env.AWS_REGION,
        MYSQL_HOST: process.env.MYSQL_HOST,
      });
      envLoaded = true;
    }
    break;
  }
}

if (!envLoaded) {
  console.warn(`[Configuration] WARNING: No .env file found! Checked paths:`, envPaths);
  console.warn(`[Configuration] AWS_KVS_ROLE_ARN will be empty!`);
} else {
  console.log(`[Configuration] .env loaded successfully, AWS_KVS_ROLE_ARN = ${process.env.AWS_KVS_ROLE_ARN}`);
}

@Configuration({
  imports: [
    require('@midwayjs/koa'),
    require('@midwayjs/typeorm'),
    require('@midwayjs/swagger'),
    require('@midwayjs/redis'),
    require('@midwayjs/logger'),
    require('@midwayjs/axios'),
    // 导入 shared-utils 以确保 RedisConnectionPool 被注册
    require('@baby-monitor/shared-utils'),
    // 导入 aws-credentials 以确保 AWSCredentialsManager 被注册
    require('@baby-monitor/aws-credentials'),
  ],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration {
  @App()
  app!: any;

  async onReady(container: IMidwayContainer) {
    console.log('Device Service started on port 6003');

    // 注册用户上下文中间件 - 验证签名后从 Headers 中提取用户信息
    this.app.useMiddleware(VerifiedUserContextMiddleware);
    console.log('[Configuration] VerifiedUserContextMiddleware registered');

    // 注册域上下文中间件
    this.app.useMiddleware(DomainContextMiddleware);
    console.log('[Configuration] DomainContextMiddleware registered');

    // 注册域数据过滤中间件 - 确保查询时只返回域内数据
    this.app.useMiddleware(DomainDataFilterMiddleware);
    console.log('[Configuration] DomainDataFilterMiddleware registered');

    // 注册 AWS 凭证配置（在 .env 加载后动态创建配置）
    const credentialsManager = await container.getAsync(AWSCredentialsManager);
    const { createKVSCredentialsConfig, createS3CredentialsConfig } = await import('./config/credentials.config');

    // 调用函数创建配置（此时环境变量已加载）
    const kvsCredentialsConfig = createKVSCredentialsConfig();
    const s3CredentialsConfig = createS3CredentialsConfig();

    credentialsManager.registerAllCredentials({
      kvs: kvsCredentialsConfig,
      s3: s3CredentialsConfig,
    });
    console.log('[Configuration] AWS credentials registered (KVS, S3)');

    // 预热 AWS 凭证（服务启动时提前获取临时凭证）
    try {
      await credentialsManager.warmupCredentials();
      console.log('[Configuration] AWS credentials warmed up successfully');
    } catch (error) {
      console.error('[Configuration] Failed to warmup AWS credentials:', error);
    }

    // 初始化所有订阅器（通过获取实例触发 @Init() 初始化）
    await container.getAsync(DeviceRegisterSubscriber);
    await container.getAsync(DeviceMessageSubscriber);
    await container.getAsync(DeviceStatusSubscriber);

    console.log('All subscribers initialized');
  }
}
