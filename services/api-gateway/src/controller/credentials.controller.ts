/**
 * AWS 凭证控制器
 *
 * 为设备和用户分发 AWS 临时访问凭证。
 * 凭证用于直接访问 AWS 资源（如 KVS 推流、S3 上传），减轻服务器负载。
 *
 * 主要功能：
 * - 获取 KVS 流媒体推流凭证
 * - 获取 S3 文件上传凭证
 * - 凭证状态查询和管理
 * - 凭证刷新和清理
 *
 * 安全说明：
 * - 凭证通过 AWS STS 服务生成
 * - 每个凭证有明确的时间限制（默认 1 小时）
 * - 建议客户端提前 5 分钟刷新凭证
 */
import { Controller, Get, Post, Inject, Config, Query } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@midwayjs/swagger';
import { AWSCredentialsManager, CredentialsStatus } from '@baby-monitor/aws-credentials';

/**
 * AWS 临时凭证控制器
 *
 * 提供设备推流（KVS）和文件上传（S3）所需的临时凭证
 */
@ApiTags('AWS Credentials')
@Controller('/api/v1/credentials')
export class CredentialsController {
  @Inject()
  private ctx!: Context;

  @Inject()
  private credentialsManager!: AWSCredentialsManager;

  @Config('aws')
  private awsConfig!: any;

  /**
   * 获取流媒体推流凭证（KVS）
   *
   * 设备使用此凭证直接向 AWS Kinesis Video Streams 推流
   */
  @Get('/stream')
  @ApiOperation({
    summary: '获取流媒体推流凭证',
    description: '返回 AWS KVS 临时凭证，用于设备推流。凭证有效期1小时，建议提前5分钟刷新。'
  })
  @ApiResponse({
    status: 200,
    description: '成功获取凭证',
    schema: {
      type: 'object',
      properties: {
        accessKeyId: { type: 'string', description: 'AWS 访问密钥 ID' },
        secretAccessKey: { type: 'string', description: 'AWS 秘密访问密钥' },
        sessionToken: { type: 'string', description: '会话令牌' },
        expiration: { type: 'string', description: '凭证过期时间（ISO 8601）' },
        region: { type: 'string', description: 'AWS 区域' },
        endpoint: { type: 'string', description: 'KVS 端点（可选）' },
        expiresIn: { type: 'number', description: '距过期的秒数' },
      },
    },
  })
  @ApiResponse({ status: 401, description: '未授权' })
  @ApiResponse({ status: 500, description: '获取凭证失败' })
  async getStreamCredentials(): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: string;
    region: string;
    endpoint?: string;
    expiresIn: number;
  }> {
    // 从上下文获取设备信息（由认证中间件注入）
    const deviceId = this.ctx.state.deviceId;
    const userId = this.ctx.state.userId;

    // 验证权限
    if (!deviceId && !userId) {
      this.ctx.throw(401, 'Unauthorized: No valid device or user context');
    }

    try {
      // 获取 KVS 凭证
      const credentials = await this.credentialsManager.getCredentials('kvs');
      console.log(`[Credentials] Retrieved KVS credentials for device: ${deviceId || userId}`);
      // 计算剩余有效时间
      const expiresIn = Math.floor((new Date(credentials.expiration).getTime() - Date.now()) / 1000);

      const response = {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        expiration: credentials.expiration.toISOString(),
        region: this.awsConfig?.region || process.env.AWS_REGION || 'cn-north-1',
        expiresIn,
      };

      // 如果有自定义 KVS endpoint，返回
      if (this.awsConfig?.kvs?.endpoint) {
        (response as any).endpoint = this.awsConfig.kvs.endpoint;
      }

      console.log(`[Credentials] Stream credentials issued for device: ${deviceId || userId}, expires in ${expiresIn}s`);

      return response;

    } catch (error: any) {
      console.error('[Credentials] Failed to get stream credentials:', error);
      this.ctx.throw(500, `Failed to get credentials: ${error.message}`);
    }
  }

  /**
   * 获取存储上传凭证（S3）
   *
   * 设备或用户使用此凭证直接上传文件到 AWS S3
   */
  @Get('/storage')
  @ApiOperation({
    summary: '获取存储上传凭证',
    description: '返回 AWS S3 临时凭证，用于文件上传。凭证有效期1小时，建议提前5分钟刷新。'
  })
  @ApiResponse({
    status: 200,
    description: '成功获取凭证',
    schema: {
      type: 'object',
      properties: {
        accessKeyId: { type: 'string', description: 'AWS 访问密钥 ID' },
        secretAccessKey: { type: 'string', description: 'AWS 秘密访问密钥' },
        sessionToken: { type: 'string', description: '会话令牌' },
        expiration: { type: 'string', description: '凭证过期时间（ISO 8601）' },
        region: { type: 'string', description: 'AWS 区域' },
        bucket: { type: 'string', description: 'S3 存储桶名称' },
        endpoint: { type: 'string', description: 'S3 端点' },
        uploadPrefix: { type: 'string', description: '上传路径前缀' },
        expiresIn: { type: 'number', description: '距过期的秒数' },
      },
    },
  })
  @ApiResponse({ status: 401, description: '未授权' })
  @ApiResponse({ status: 500, description: '获取凭证失败' })
  async getStorageCredentials(): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: string;
    region: string;
    bucket: string;
    endpoint: string;
    uploadPrefix: string;
    expiresIn: number;
  }> {
    // 从上下文获取设备信息
    const deviceId = this.ctx.state.deviceId;
    const userId = this.ctx.state.userId;

    if (!deviceId && !userId) {
      this.ctx.throw(401, 'Unauthorized: No valid device or user context');
    }

    try {
      // 获取 S3 凭证
      const credentials = await this.credentialsManager.getCredentials('s3');

      // 计算剩余有效时间
      const expiresIn = Math.floor((new Date(credentials.expiration).getTime() - Date.now()) / 1000);

      const region = this.awsConfig?.region || process.env.AWS_REGION || 'cn-north-1';
      const bucket = this.awsConfig?.s3?.bucket || process.env.AWS_S3_BUCKET || 'baby-monitor-files';

      // 构造 S3 endpoint
      const isChinaRegion = region.startsWith('cn-');
      const endpoint = isChinaRegion
        ? `https://${bucket}.s3.${region}.amazonaws.com.cn`
        : `https://${bucket}.s3.${region}.amazonaws.com`;

      // 生成上传路径前缀
      const uploadPrefix = deviceId
        ? `devices/${deviceId}/${new Date().toISOString().split('T')[0]}`
        : `users/${userId}/${new Date().toISOString().split('T')[0]}`;

      const response = {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        expiration: credentials.expiration.toISOString(),
        region,
        bucket,
        endpoint,
        uploadPrefix,
        expiresIn,
      };

      console.log(`[Credentials] Storage credentials issued for device: ${deviceId || userId}, expires in ${expiresIn}s`);

      return response;

    } catch (error: any) {
      console.error('[Credentials] Failed to get storage credentials:', error);
      this.ctx.throw(500, `Failed to get credentials: ${error.message}`);
    }
  }

  /**
   * 获取所有凭证状态（管理接口）
   */
  @Get('/status')
  @ApiOperation({
    summary: '获取凭证状态',
    description: '返回所有 AWS 临时凭证的当前状态，用于监控和调试。'
  })
  @ApiResponse({
    status: 200,
    description: '成功获取状态',
    schema: {
      type: 'object',
      properties: {
        credentials: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              cached: { type: 'boolean' },
              ttl: { type: 'number' },
              expiring: { type: 'boolean' },
            },
          },
        },
        healthy: { type: 'boolean' },
      },
    },
  })
  async getCredentialsStatus(): Promise<{
    credentials: CredentialsStatus[];
    healthy: boolean;
  }> {
    try {
      const credentials = await this.credentialsManager.getAllCredentialsStatus();
      const healthy = await this.credentialsManager.healthCheck();

      return {
        credentials,
        healthy,
      };

    } catch (error: any) {
      console.error('[Credentials] Failed to get credentials status:', error);
      this.ctx.throw(500, `Failed to get status: ${error.message}`);
    }
  }

  /**
   * 手动刷新凭证（管理接口）
   */
  @Post('/refresh')
  @ApiOperation({
    summary: '手动刷新凭证',
    description: '手动触发凭证刷新。通常不需要调用，系统会自动刷新。'
  })
  @ApiQuery({
    name: 'key',
    description: '凭证类型（kvs/s3），不指定则刷新所有',
    required: false,
  })
  @ApiResponse({ status: 200, description: '刷新成功' })
  @ApiResponse({ status: 400, description: '无效的凭证类型' })
  async refreshCredentials(@Query('key') key?: string): Promise<{
    success: boolean;
    message: string;
    refreshed?: string[];
  }> {
    try {
      if (key) {
        // 刷新单个凭证
        await this.credentialsManager.refreshCredentials(key);
        return {
          success: true,
          message: `Credentials refreshed for: ${key}`,
          refreshed: [key],
        };
      } else {
        // 刷新所有凭证
        await this.credentialsManager.refreshAllCredentials();
        return {
          success: true,
          message: 'All credentials refreshed',
          refreshed: ['all'],
        };
      }

    } catch (error: any) {
      console.error('[Credentials] Failed to refresh credentials:', error);
      this.ctx.throw(500, `Failed to refresh: ${error.message}`);
    }
  }

  /**
   * 清除凭证缓存（管理接口）
   */
  @Post('/clear')
  @ApiOperation({
    summary: '清除凭证缓存',
    description: '清除缓存的凭证，下次获取时会重新生成。'
  })
  @ApiQuery({
    name: 'key',
    description: '凭证类型（kvs/s3），不指定则清除所有',
    required: false,
  })
  @ApiResponse({ status: 200, description: '清除成功' })
  async clearCredentials(@Query('key') key?: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      if (key) {
        await this.credentialsManager.clearCredentials(key);
        return {
          success: true,
          message: `Cache cleared for: ${key}`,
        };
      } else {
        await this.credentialsManager.clearAllCredentials();
        return {
          success: true,
          message: 'All credential caches cleared',
        };
      }

    } catch (error: any) {
      console.error('[Credentials] Failed to clear credentials:', error);
      this.ctx.throw(500, `Failed to clear: ${error.message}`);
    }
  }

  /**
   * 健康检查
   */
  @Get('/health')
  @ApiOperation({
    summary: '凭证服务健康检查',
    description: '检查凭证管理服务是否正常运行。'
  })
  @ApiResponse({
    status: 200,
    description: '服务正常',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        timestamp: { type: 'string' },
      },
    },
  })
  async healthCheck(): Promise<{
    status: string;
    timestamp: string;
  }> {
    const healthy = await this.credentialsManager.healthCheck();

    return {
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
    };
  }
}
