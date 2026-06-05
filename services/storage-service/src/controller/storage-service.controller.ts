import { Controller, Get, Post, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { StorageService } from '../service/storage.service';
import { FileMetadataService } from '../service/file-metadata.service';
import { StorageQuotaService } from '../service/storage-quota.service';
import { FileShareService } from '../service/file-share.service';
import { StorageProviderType, successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 存储服务控制器
 * 提供RESTful API接口，处理文件上传下载、分片上传、元数据管理、
 * 生命周期管理、配额管理、文件分享等操作
 * 所有接口都使用/api/storage作为基础路径
 */
@ApiTags('存储服务')
@Controller('/api/storage')
export class StorageServiceController {
  @Inject()
  ctx!: Context;  // Koa上下文对象，包含请求和响应信息

  // 注入各个服务依赖
  @Inject()
  storageService!: StorageService;         // 核心存储服务

  @Inject()
  metadataService!: FileMetadataService;   // 元数据管理服务

  @Inject()
  quotaService!: StorageQuotaService;      // 配额管理服务

  @Inject()
  shareService!: FileShareService;         // 文件分享服务

  // ==================== 文件操作 ====================
  // 以下接口提供基础的文件CRUD操作

  /**
   * 上传文件
   * @description 上传文件到存储服务，支持多种存储提供商
   */
  @Post('/upload')
  @ApiOperation({ summary: '上传文件', description: '上传文件到存储服务，支持多种存储提供商' })
  @ApiBody({
    description: '文件上传配置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '文件key' },
        stream: { type: 'object', description: '文件流' },
        options: {
          type: 'object',
          properties: {
            provider: { type: 'string', enum: ['minio', 's3', 'aliyun', 'local'], description: '存储提供商' },
            userId: { type: 'string', description: '用户ID' },
            metadata: { type: 'object', description: '文件元数据' }
          }
        }
      },
      required: ['key', 'stream']
    }
  })
  async upload(@Body() body: {
    key: string;
    stream: any;
    options?: {
      provider?: StorageProviderType;
      userId?: string;
      metadata?: Record<string, any>;
    };
  }) {
    // 步骤1：检查用户配额（如果提供了用户ID）
    if (body.options?.userId) {
      const quotaCheck = await this.quotaService.checkQuota(
        body.options.userId,
        body.options.provider || StorageProviderType.MINIO,
        0 // 实际文件大小应该从stream中获取，这里暂时传0
      );

      // 如果配额检查未通过，返回403错误
      if (!quotaCheck.allowed) {
        this.ctx.status = 403;
        return errorResponse(ErrorCode.STORAGE_QUOTA_EXCEEDED, quotaCheck.reason);
      }
    }

    // 步骤2：调用存储服务执行上传
    const result = await this.storageService.upload(body.key, body.stream, body.options);

    // 步骤3：记录上传操作到元数据服务
    if (body.options?.userId) {
      await this.metadataService.recordAccess(body.key, 'upload', body.options.userId);
    }

    return successResponse(result);
  }

  /**
   * 获取文件URL
   * @description 获取文件的访问URL，支持生成带过期时间的临时链接
   */
  @Get('/url/:key')
  @ApiOperation({ summary: '获取文件URL', description: '获取文件的访问URL，支持生成带过期时间的临时链接' })
  @ApiParam({ name: 'key', description: '文件key', example: 'videos/recording-123.mp4' })
  @ApiQuery({ name: 'expiresIn', description: '过期时间（秒）', required: false })
  @ApiQuery({ name: 'provider', description: '存储提供商', required: false })
  async getUrl(
    @Param('key') key: string,
    @Query('expiresIn') expiresIn?: string,
    @Query('provider') provider?: StorageProviderType
  ) {
    const url = await this.storageService.getUrl(
      key,
      expiresIn ? parseInt(expiresIn) : undefined,
      provider
    );

    return successResponse({ url });
  }

  /**
   * 检查文件是否存在
   * @description 检查指定key的文件是否存在
   */
  @Get('/exists/:key')
  @ApiOperation({ summary: '检查文件是否存在', description: '检查指定key的文件是否存在' })
  @ApiParam({ name: 'key', description: '文件key', example: 'videos/recording-123.mp4' })
  @ApiQuery({ name: 'provider', description: '存储提供商', required: false })
  async exists(
    @Param('key') key: string,
    @Query('provider') provider?: StorageProviderType
  ) {
    const exists = await this.storageService.exists(key, provider);

    return successResponse({ exists });
  }

  /**
   * 删除文件
   * @description 删除指定key的文件及其元数据
   */
  @Del('/:key')
  @ApiOperation({ summary: '删除文件', description: '删除指定key的文件及其元数据' })
  @ApiParam({ name: 'key', description: '文件key', example: 'videos/recording-123.mp4' })
  @ApiBody({
    description: '删除选项',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['minio', 's3', 'aliyun', 'local'], description: '存储提供商' },
        userId: { type: 'string', description: '用户ID' }
      }
    }
  })
  async delete(
    @Param('key') key: string,
    @Body() body: { provider?: StorageProviderType; userId?: string }
  ) {
    // 调用存储服务删除文件
    await this.storageService.delete(key, body.provider);

    // 记录删除操作到元数据服务（如果提供了用户ID）
    if (body.userId) {
      await this.metadataService.recordAccess(key, 'delete', body.userId);
    }

    // 删除文件的元数据缓存
    await this.metadataService.deleteMetadata(key);

    return successResponse(null);
  }

  /**
   * 复制文件
   * @description 复制文件到新的位置
   */
  @Post('/copy')
  @ApiOperation({ summary: '复制文件', description: '复制文件到新的位置' })
  @ApiBody({
    description: '复制配置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        sourceKey: { type: 'string', description: '源文件key' },
        destKey: { type: 'string', description: '目标文件key' },
        provider: { type: 'string', enum: ['minio', 's3', 'aliyun', 'local'], description: '存储提供商' }
      },
      required: ['sourceKey', 'destKey']
    }
  })
  async copy(@Body() body: {
    sourceKey: string;
    destKey: string;
    provider?: StorageProviderType;
  }) {
    await this.storageService.copy(body.sourceKey, body.destKey, body.provider);

    return successResponse(null);
  }

  /**
   * 移动文件
   * @description 移动文件到新的位置
   */
  @Post('/move')
  @ApiOperation({ summary: '移动文件', description: '移动文件到新的位置' })
  @ApiBody({
    description: '移动配置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        sourceKey: { type: 'string', description: '源文件key' },
        destKey: { type: 'string', description: '目标文件key' },
        provider: { type: 'string', enum: ['minio', 's3', 'aliyun', 'local'], description: '存储提供商' }
      },
      required: ['sourceKey', 'destKey']
    }
  })
  async move(@Body() body: {
    sourceKey: string;
    destKey: string;
    provider?: StorageProviderType;
  }) {
    await this.storageService.move(body.sourceKey, body.destKey, body.provider);

    return successResponse(null);
  }

  /**
   * 列出文件
   * @description 列出指定前缀的所有文件
   */
  @Get('/list')
  @ApiOperation({ summary: '列出文件', description: '列出指定前缀的所有文件' })
  @ApiQuery({ name: 'prefix', description: '文件前缀', required: false })
  @ApiQuery({ name: 'maxKeys', description: '最大返回数量', required: false })
  @ApiQuery({ name: 'provider', description: '存储提供商', required: false })
  async list(@Query() query: {
    prefix?: string;
    maxKeys?: string;
    provider?: StorageProviderType;
  }) {
    const files = await this.storageService.list(
      query.prefix || '',
      {
        maxKeys: query.maxKeys ? parseInt(query.maxKeys) : undefined,
        provider: query.provider,
      }
    );

    return successResponse(files);
  }

  // ==================== 分片上传 ====================

  /**
   * 创建分片上传
   * @description 初始化一个分片上传任务
   */
  @Post('/multipart/create')
  @ApiOperation({ summary: '创建分片上传', description: '初始化一个分片上传任务' })
  @ApiBody({
    description: '分片上传配置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '文件key' },
        provider: { type: 'string', enum: ['minio', 's3', 'aliyun', 'local'], description: '存储提供商' },
        metadata: { type: 'object', description: '文件元数据' }
      },
      required: ['key']
    }
  })
  async createMultipartUpload(@Body() body: {
    key: string;
    provider?: StorageProviderType;
    metadata?: Record<string, any>;
  }) {
    const result = await this.storageService.createMultipartUpload(
      body.key,
      {
        provider: body.provider,
        metadata: body.metadata,
      }
    );

    return successResponse(result);
  }

  /**
   * 上传分片
   * @description 上传单个分片
   */
  @Post('/multipart/upload')
  @ApiOperation({ summary: '上传分片', description: '上传单个分片' })
  @ApiBody({
    description: '分片信息',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        uploadId: { type: 'string', description: '上传任务ID' },
        key: { type: 'string', description: '文件key' },
        partNumber: { type: 'number', description: '分片编号' },
        stream: { type: 'object', description: '分片数据流' },
        provider: { type: 'string', enum: ['minio', 's3', 'aliyun', 'local'], description: '存储提供商' }
      },
      required: ['uploadId', 'key', 'partNumber', 'stream']
    }
  })
  async uploadPart(@Body() body: {
    uploadId: string;
    key: string;
    partNumber: number;
    stream: any;
    provider?: StorageProviderType;
  }) {
    const result = await this.storageService.uploadPart(
      body.uploadId,
      body.key,
      body.partNumber,
      body.stream,
      body.provider
    );

    return successResponse(result);
  }

  /**
   * 完成分片上传
   * @description 合并所有分片，完成上传
   */
  @Post('/multipart/complete')
  @ApiOperation({ summary: '完成分片上传', description: '合并所有分片，完成上传' })
  @ApiBody({
    description: '完成配置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        uploadId: { type: 'string', description: '上传任务ID' },
        key: { type: 'string', description: '文件key' },
        parts: {
          type: 'array',
          description: '分片列表',
          items: {
            type: 'object',
            properties: {
              partNumber: { type: 'number' },
              etag: { type: 'string' }
            }
          }
        },
        provider: { type: 'string', enum: ['minio', 's3', 'aliyun', 'local'], description: '存储提供商' }
      },
      required: ['uploadId', 'key', 'parts']
    }
  })
  async completeMultipartUpload(@Body() body: {
    uploadId: string;
    key: string;
    parts: Array<{ partNumber: number; etag: string }>;
    provider?: StorageProviderType;
  }) {
    const result = await this.storageService.completeMultipartUpload(
      body.uploadId,
      body.key,
      body.parts,
      body.provider
    );

    return successResponse(result);
  }

  /**
   * 取消分片上传
   * @description 取消分片上传任务，删除已上传的分片
   */
  @Del('/multipart/:uploadId')
  @ApiOperation({ summary: '取消分片上传', description: '取消分片上传任务，删除已上传的分片' })
  @ApiParam({ name: 'uploadId', description: '上传任务ID', example: 'upload-123' })
  @ApiBody({
    description: '取消配置',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '文件key' },
        provider: { type: 'string', enum: ['minio', 's3', 'aliyun', 'local'], description: '存储提供商' }
      }
    }
  })
  async abortMultipartUpload(
    @Param('uploadId') uploadId: string,
    @Body() body: { key: string; provider?: StorageProviderType }
  ) {
    await this.storageService.abortMultipartUpload(uploadId, body.key, body.provider);

    return successResponse(null);
  }

  // ==================== 元数据管理 ====================

  /**
   * 获取文件元数据
   * @description 获取文件的详细元数据信息
   */
  @Get('/metadata/:key')
  @ApiOperation({ summary: '获取文件元数据', description: '获取文件的详细元数据信息' })
  @ApiParam({ name: 'key', description: '文件key', example: 'videos/recording-123.mp4' })
  async getMetadata(@Param('key') key: string) {
    const metadata = await this.storageService.getMetadata(key);

    return successResponse(metadata);
  }

  /**
   * 获取文件访问记录
   * @description 获取文件的访问历史记录
   */
  @Get('/access/:key')
  @ApiOperation({ summary: '获取文件访问记录', description: '获取文件的访问历史记录' })
  @ApiParam({ name: 'key', description: '文件key', example: 'videos/recording-123.mp4' })
  @ApiQuery({ name: 'limit', description: '返回数量限制', required: false })
  @ApiQuery({ name: 'offset', description: '偏移量', required: false })
  async getAccessRecords(
    @Param('key') key: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const records = await this.metadataService.getAccessRecords(
      key,
      limit ? parseInt(limit) : 100,
      offset ? parseInt(offset) : 0
    );

    return successResponse(records.map(r => ({
      ...r,
      accessedAt: new Date(r.accessedAt).toISOString(),
    })));
  }

  /**
   * 添加文件标签
   * @description 为文件添加自定义标签
   */
  @Post('/tags/:key')
  @ApiOperation({ summary: '添加文件标签', description: '为文件添加自定义标签' })
  @ApiParam({ name: 'key', description: '文件key', example: 'videos/recording-123.mp4' })
  @ApiBody({
    description: '标签信息',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: '标签名' },
        value: { type: 'string', description: '标签值' }
      },
      required: ['tag', 'value']
    }
  })
  async addTag(@Param('key') key: string, @Body() body: { tag: string; value: string }) {
    await this.metadataService.addTag(key, body.tag, body.value);

    return successResponse(null);
  }

  /**
   * 获取文件标签
   * @description 获取文件的所有标签
   */
  @Get('/tags/:key')
  @ApiOperation({ summary: '获取文件标签', description: '获取文件的所有标签' })
  @ApiParam({ name: 'key', description: '文件key', example: 'videos/recording-123.mp4' })
  async getTags(@Param('key') key: string) {
    const tags = await this.metadataService.getTags(key);

    return successResponse(tags);
  }

  /**
   * 删除文件标签
   * @description 删除文件的指定标签
   */
  @Del('/tags/:key/:tag')
  @ApiOperation({ summary: '删除文件标签', description: '删除文件的指定标签' })
  @ApiParam({ name: 'key', description: '文件key', example: 'videos/recording-123.mp4' })
  @ApiParam({ name: 'tag', description: '标签名', example: 'category' })
  async removeTag(@Param('key') key: string, @Param('tag') tag: string) {
    await this.metadataService.removeTag(key, tag);

    return successResponse(null);
  }

  /**
   * 通过标签搜索
   * @description 根据标签搜索文件
   */
  @Get('/tags/search/:tag')
  @ApiOperation({ summary: '通过标签搜索', description: '根据标签搜索文件' })
  @ApiParam({ name: 'tag', description: '标签名', example: 'category' })
  @ApiQuery({ name: 'value', description: '标签值', required: false })
  async searchByTag(@Param('tag') tag: string, @Query('value') value?: string) {
    const keys = await this.metadataService.searchByTag(tag, value);

    return successResponse(keys);
  }

  // ==================== 配额管理 ====================

  /**
   * 设置配额
   * @description 为用户或存储提供商设置配额限制
   */
  @Post('/quota')
  @ApiOperation({ summary: '设置配额', description: '为用户或存储提供商设置配额限制' })
  @ApiBody({
    description: '配额配置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: '用户ID' },
        provider: { type: 'string', enum: ['minio', 's3', 'aliyun', 'local'], description: '存储提供商' },
        maxStorage: { type: 'number', description: '最大存储空间（字节）' },
        maxFiles: { type: 'number', description: '最大文件数' },
        maxFileSize: { type: 'number', description: '单个文件最大大小（字节）' }
      },
      required: ['provider', 'maxStorage', 'maxFiles']
    }
  })
  async setQuota(@Body() body: {
    userId?: string;
    provider: StorageProviderType;
    maxStorage: number;
    maxFiles: number;
    maxFileSize: number;
  }) {
    await this.quotaService.setQuota(body);

    return successResponse(null);
  }

  /**
   * 获取配额
   * @description 获取用户或存储提供商的配额使用情况
   */
  @Get('/quota')
  @ApiOperation({ summary: '获取配额', description: '获取用户或存储提供商的配额使用情况' })
  @ApiQuery({ name: 'userId', description: '用户ID', required: false })
  @ApiQuery({ name: 'provider', description: '存储提供商', required: false })
  async getQuota(@Query() query: { userId?: string; provider?: StorageProviderType }) {
    const provider = query.provider ?? StorageProviderType.MINIO;
    const quota = await this.quotaService.getQuota(query.userId, provider);
    const usage = await this.quotaService.getUsage(query.userId, provider);

    return successResponse({
      quota,
      usage,
      usagePercent: quota && quota.maxStorage > 0
        ? ((usage.usedStorage / quota.maxStorage) * 100).toFixed(2)
        : null,
    });
  }

  /**
   * 获取服务状态
   * @description 获取存储服务的整体状态信息
   */
  @Get('/status')
  @ApiOperation({ summary: '获取服务状态', description: '获取存储服务的整体状态信息' })
  @ApiResponse({
    status: 200,
    description: '服务状态',
    schema: {
      type: 'object',
      properties: {
        uptime: { type: 'number', description: '运行时间（秒）' },
        memory: { type: 'object', description: '内存使用情况' },
        providers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              provider: { type: 'string' },
              status: { type: 'string', enum: ['online', 'offline', 'error'] }
            }
          }
        },
        lifecycle: { type: 'object', description: '生命周期统计' }
      }
    }
  })
  async getStatus() {
    const providersStatus = await this.storageService.getProvidersStatus();

    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      providers: providersStatus,
    };
  }

  /**
   * 健康检查
   * @description 存储服务健康检查接口
   */
  @Get('/health')
  @ApiOperation({ summary: '健康检查', description: '存储服务健康检查接口' })
  @ApiResponse({
    status: 200,
    description: '健康状态',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        timestamp: { type: 'string', example: '2024-01-01T00:00:00.000Z' }
      }
    }
  })
  async healthCheck() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  }

  // ==================== 文件分享 ====================

  /**
   * 创建分享链接
   * @description 创建文件分享链接，支持密码保护和过期时间
   */
  @Post('/shares')
  @ApiOperation({ summary: '创建分享链接', description: '创建文件分享链接，支持密码保护和过期时间' })
  @ApiBody({
    description: '分享配置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: '文件ID' },
        createdBy: { type: 'string', description: '创建者用户ID' },
        name: { type: 'string', description: '分享名称' },
        description: { type: 'string', description: '分享描述' },
        permission: { type: 'string', enum: ['view', 'download', 'upload'], description: '权限' },
        expiresAt: { type: 'number', description: '过期时间（时间戳）' },
        password: { type: 'string', description: '访问密码' },
        maxAccess: { type: 'number', description: '最大访问次数' }
      },
      required: ['fileId', 'createdBy', 'name', 'permission', 'expiresAt']
    }
  })
  async createShare(@Body() body: {
    fileId: string;
    createdBy: string;
    name: string;
    description?: string;
    permission: 'view' | 'download' | 'upload';
    expiresAt: number;
    password?: string;
    maxAccess?: number;
  }) {
    const shareId = await this.shareService.createShare(body);

    return successResponse({ shareId, shareUrl: `/share/${shareId}` });
  }

  /**
   * 撤销分享
   * @description 撤销指定的分享链接
   */
  @Del('/shares/:shareId')
  @ApiOperation({ summary: '撤销分享', description: '撤销指定的分享链接' })
  @ApiParam({ name: 'shareId', description: '分享ID', example: 'share-123' })
  async revokeShare(@Param('shareId') shareId: string) {
    const revoked = await this.shareService.revokeShare(shareId);

    if (!revoked) {
      this.ctx.status = 404;
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '分享不存在');
    }

    return successResponse(null);
  }

  // ==================== 存储提供者管理 ====================

  /**
   * 切换默认存储提供者
   * @description 切换默认的存储服务提供商
   */
  @Post('/providers/switch')
  @ApiOperation({ summary: '切换存储提供者', description: '切换默认的存储服务提供商' })
  @ApiBody({
    description: '存储提供者',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['aws_s3', 'tencent_cos', 'minio'], description: '存储提供商' }
      },
      required: ['provider']
    }
  })
  async switchProvider(@Body() body: { provider: StorageProviderType }) {
    this.storageService.setDefaultProvider(body.provider);

    return successResponse(null);
  }

  /**
   * 获取存储统计
   * @description 获取所有存储提供商的统计信息
   */
  @Get('/statistics')
  @ApiOperation({ summary: '获取存储统计', description: '获取所有存储提供商的统计信息' })
  async getStorageStatistics() {
    const stats = await this.storageService.getStorageStats();

    return successResponse(stats);
  }

  /**
   * 获取预签名上传URL
   * @description 生成用于客户端直接上传的预签名URL
   */
  @Post('/upload-url')
  @ApiOperation({ summary: '获取预签名上传URL', description: '生成用于客户端直接上传的预签名URL' })
  @ApiBody({
    description: '预签名URL配置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '文件key' },
        expiresIn: { type: 'number', description: '过期时间（秒）' },
        contentType: { type: 'string', description: '文件内容类型' },
        provider: { type: 'string', enum: ['aws_s3', 'tencent_cos', 'minio'], description: '存储提供商' }
      },
      required: ['key']
    }
  })
  async getPresignedUploadUrl(@Body() body: {
    key: string;
    expiresIn?: number;
    contentType?: string;
    provider?: StorageProviderType;
  }) {
    const url = await this.storageService.getPresignedUploadUrl(
      body.key,
      {
        expiresIn: body.expiresIn,
        contentType: body.contentType,
        provider: body.provider,
      }
    );

    return successResponse({
      url,
      key: body.key,
      expiresAt: new Date(Date.now() + (body.expiresIn || 3600) * 1000).toISOString(),
    });
  }
}
