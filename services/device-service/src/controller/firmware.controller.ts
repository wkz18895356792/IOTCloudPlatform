import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { FirmwareService } from '../service/firmware.service';
import { OTAService } from '../service/ota.service';
import { ServiceClient } from '@baby-monitor/shared-utils';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 固件管理控制器
 *
 * 处理设备固件版本管理和OTA升级相关API
 */
@ApiTags('固件管理')
@Controller('/api/firmware')
export class FirmwareController {
  @Inject()
  ctx!: Context;

  @Inject()
  firmwareService!: FirmwareService;

  @Inject()
  otaService!: OTAService;

  @Inject()
  serviceClient!: ServiceClient;

  // ==================== 固件版本管理 ====================

  /**
   * 创建固件版本
   */
  @Post('/versions')
  @ApiOperation({
    summary: '创建固件版本',
    description: '上传并创建新的固件版本（管理员功能）',
  })
  @ApiResponse({
    status: 200,
    description: '创建成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            version: { type: 'string' },
            productId: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiBody({
    description: '固件版本信息',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: '产品ID' },
        version: { type: 'string', description: '版本号（如1.2.3）' },
        versionName: { type: 'string', description: '版本名称' },
        isForced: { type: 'boolean', description: '是否强制升级' },
        fileUrl: { type: 'string', description: '固件文件URL' },
        fileSize: { type: 'number', description: '文件大小（字节）' },
        checksum: { type: 'string', description: '文件MD5校验和' },
        releaseNotes: { type: 'string', description: '版本更新说明' },
        minVersion: { type: 'string', description: '最低可升级版本' },
      },
      required: ['productId', 'version', 'fileUrl', 'fileSize', 'checksum'],
    },
  })
  async createFirmwareVersion(@Body() body: {
    productId: string;
    version: string;
    versionName?: string;
    isForced?: boolean;
    fileUrl: string;
    fileSize: number;
    checksum: string;
    releaseNotes?: string;
    minVersion?: string;
  }) {
    try {
      const firmware = await this.firmwareService.createFirmwareVersion(body);
      return successResponse(firmware);
    } catch (error: any) {
      this.ctx.logger.error('[FirmwareController] Create firmware version error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '创建固件版本失败');
    }
  }

  /**
   * 获取产品固件版本列表
   */
  @Get('/versions/:productId')
  @ApiOperation({
    summary: '获取固件版本列表',
    description: '获取指定产品的所有可用固件版本',
  })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              version: { type: 'string' },
              versionName: { type: 'string' },
              isForced: { type: 'boolean' },
              releaseNotes: { type: 'string' },
              releasedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'productId', description: '产品ID', example: 'product-123' })
  async getFirmwareVersions(@Param('productId') productId: string) {
    try {
      const versions = await this.firmwareService.getFirmwareVersions(productId);
      return successResponse(versions);
    } catch (error: any) {
      this.ctx.logger.error('[FirmwareController] Get firmware versions error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取固件版本失败');
    }
  }

  /**
   * 检查设备固件更新
   */
  @Get('/devices/:deviceId/check-update')
  @ApiOperation({
    summary: '检查固件更新',
    description: '检查设备是否有可用的固件更新',
  })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            hasUpdate: { type: 'boolean' },
            currentVersion: { type: 'string' },
            latestVersion: { type: 'string' },
            isForced: { type: 'boolean' },
            firmware: {
              type: 'object',
              properties: {
                version: { type: 'string' },
                releaseNotes: { type: 'string' },
                fileSize: { type: 'number' },
              },
            },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async checkFirmwareUpdate(@Param('deviceId') deviceId: string) {
    try {
      const result = await this.otaService.checkUpdate(deviceId);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[FirmwareController] Check firmware update error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '检查更新失败');
    }
  }

  // ==================== 固件文件上传 ====================

  /**
   * 获取固件上传预签名URL
   */
  @Post('/upload-url')
  @ApiOperation({
    summary: '获取固件上传预签名URL',
    description: '获取用于上传固件文件的预签名URL，文件通过该URL直接上传到存储服务（S3/COS）',
  })
  @ApiBody({
    description: '固件上传参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: '产品ID' },
        version: { type: 'string', description: '固件版本号' },
        fileSize: { type: 'number', description: '文件大小（字节）' },
        checksum: { type: 'string', description: '文件校验和' },
        checksumType: { type: 'string', enum: ['md5', 'sha256'], description: '校验和类型' },
        contentType: { type: 'string', description: '文件MIME类型' },
      },
      required: ['productId', 'version', 'fileSize', 'checksum'],
    },
  })
  async getFirmwareUploadUrl(@Body() body: {
    productId: string;
    version: string;
    fileSize: number;
    checksum: string;
    checksumType?: 'md5' | 'sha256';
    contentType?: string;
  }) {
    try {
      const key = `firmware/${body.productId}/${body.version}/${Date.now()}-firmware.bin`;

      const response = await this.serviceClient.post<{
        url: string;
        key: string;
      }>(
        'storage-service',
        '/api/storage/upload-url',
        {
          key,
          expiresIn: 3600,
          contentType: body.contentType || 'application/octet-stream',
        }
      );

      if (!response.success && response.code !== 0) {
        this.ctx.logger.error('[FirmwareController] ServiceClient response:', JSON.stringify(response));
        return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, `获取上传URL失败: ${response.error || response.message || 'unknown'}`);
      }

      // storage-service 返回 { code: 0, data: { url, key, ... } }
      // url 可能是字符串或对象（COS SDK 返回 { Url: "..." }）
      const rawUrl = response.data?.url as any;
      const uploadUrl = (rawUrl?.Url as string) || rawUrl;

      return successResponse({
        uploadUrl,
        key,
        expiresIn: 3600,
        checksum: body.checksum,
        checksumType: body.checksumType || 'sha256',
      });
    } catch (error: any) {
      this.ctx.logger.error('[FirmwareController] Get upload URL error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取上传URL失败');
    }
  }

  /**
   * 确认固件上传并创建版本记录
   */
  @Post('/versions/confirm')
  @ApiOperation({
    summary: '确认固件上传',
    description: '确认固件文件已上传到存储服务，验证文件并创建固件版本记录',
  })
  @ApiBody({
    description: '确认上传参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: '产品ID' },
        version: { type: 'string', description: '版本号' },
        releaseNotes: { type: 'string', description: '版本更新说明' },
        fileKey: { type: 'string', description: '存储文件Key' },
        fileSize: { type: 'number', description: '文件大小' },
        checksum: { type: 'string', description: '文件校验和' },
        checksumType: { type: 'string', enum: ['md5', 'sha256'], description: '校验和类型' },
        isForced: { type: 'boolean', description: '是否强制升级' },
        isBeta: { type: 'boolean', description: '是否测试版' },
        minVersion: { type: 'string', description: '最低可升级版本' },
        maxVersion: { type: 'string', description: '最高可升级版本' },
      },
      required: ['productId', 'version', 'releaseNotes', 'fileKey', 'fileSize', 'checksum'],
    },
  })
  async confirmFirmwareUpload(@Body() body: {
    productId: string;
    version: string;
    releaseNotes: string;
    fileKey: string;
    fileSize: number;
    checksum: string;
    checksumType?: 'md5' | 'sha256';
    isForced?: boolean;
    isBeta?: boolean;
    minVersion?: string;
    maxVersion?: string;
  }) {
    try {
      // 存储 COS 文件 key（不下发一次性预签名 URL，由 OTA 下发时实时生成）
      const fileUrl = body.fileKey;

      // 创建固件版本记录
      const firmware = await this.otaService.uploadFirmware({
        productId: body.productId,
        version: body.version,
        releaseNotes: body.releaseNotes,
        fileUrl,
        fileSize: body.fileSize,
        checksum: body.checksum,
        isForced: body.isForced,
        isBeta: body.isBeta,
        minVersion: body.minVersion,
        maxVersion: body.maxVersion,
      });

      return successResponse(firmware);
    } catch (error: any) {
      this.ctx.logger.error('[FirmwareController] Confirm upload error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '确认上传失败');
    }
  }

  // ==================== OTA升级任务 ====================

  /**
   * 创建OTA升级任务
   */
  @Post('/ota/tasks')
  @ApiOperation({
    summary: '创建OTA升级任务',
    description: '为设备创建固件升级任务',
  })
  @ApiResponse({
    status: 200,
    description: '创建成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            deviceId: { type: 'string' },
            fromVersion: { type: 'string' },
            toVersion: { type: 'string' },
            status: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiBody({
    description: '升级任务参数（deviceId 单设备，deviceIds 多设备，二选一）',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: '单个设备ID' },
        deviceIds: { type: 'array', items: { type: 'string' }, description: '多个设备ID列表' },
        firmwareId: { type: 'string', description: '固件ID' },
      },
      required: ['firmwareId'],
    },
  })
  async createOTATask(@Body() body: { deviceId?: string; deviceIds?: string[]; firmwareId: string }) {
    try {
      // 多设备模式
      if (body.deviceIds?.length) {
        const result = await this.otaService.createOTATasks(body.deviceIds, body.firmwareId);
        return successResponse(result);
      }

      // 单设备模式（向后兼容）
      if (body.deviceId) {
        const task = await this.otaService.createOTATask({
          deviceId: body.deviceId,
          firmwareId: body.firmwareId,
        });
        return successResponse(task);
      }

      return errorResponse(ErrorCode.INVALID_PARAMS, '请提供 deviceId 或 deviceIds');
    } catch (error: any) {
      this.ctx.logger.error('[FirmwareController] Create OTA task error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '创建升级任务失败');
    }
  }

  /**
   * 获取OTA任务详情
   */
  @Get('/ota/tasks/:taskId')
  @ApiOperation({
    summary: '获取OTA任务详情',
    description: '获取指定OTA升级任务的详细信息',
  })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            deviceId: { type: 'string' },
            fromVersion: { type: 'string' },
            toVersion: { type: 'string' },
            status: { type: 'string' },
            progress: { type: 'number' },
            createdAt: { type: 'string', format: 'date-time' },
            completedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'taskId', description: '任务ID' })
  async getOTATask(@Param('taskId') taskId: string) {
    try {
      const task = await this.otaService.getOTATask(taskId);

      if (!task) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '任务不存在');
      }

      return successResponse(task);
    } catch (error: any) {
      this.ctx.logger.error('[FirmwareController] Get OTA task error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取任务失败');
    }
  }

  /**
   * 获取设备的OTA任务列表
   */
  @Get('/devices/:deviceId/ota/tasks')
  @ApiOperation({
    summary: '获取设备OTA任务列表',
    description: '获取指定设备的OTA升级任务历史',
  })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            list: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  toVersion: { type: 'string' },
                  status: { type: 'string' },
                  progress: { type: 'number' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
            total: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiQuery({ name: 'limit', description: '返回数量', required: false, example: 20 })
  @ApiQuery({ name: 'offset', description: '偏移量', required: false, example: 0 })
  async getDeviceOTATasks(
    @Param('deviceId') deviceId: string,
    @Query() query: { limit?: string; offset?: string }
  ) {
    try {
      const result = await this.otaService.getDeviceOTATasksPaginated(
        deviceId,
        query.limit ? parseInt(query.limit) : 20,
        query.offset ? parseInt(query.offset) : 0
      );

      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[FirmwareController] Get device OTA tasks error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取任务列表失败');
    }
  }

  /**
   * 取消OTA任务
   */
  @Post('/ota/tasks/:taskId/cancel')
  @ApiOperation({
    summary: '取消OTA任务',
    description: '取消正在进行的OTA升级任务',
  })
  @ApiResponse({
    status: 200,
    description: '取消成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '任务已取消' },
      },
    },
  })
  @ApiParam({ name: 'taskId', description: '任务ID' })
  async cancelOTATask(@Param('taskId') taskId: string) {
    try {
      const result = await this.otaService.cancelOTATask(taskId);

      if (!result) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '任务不存在或已完成');
      }

      return successResponse(undefined, '任务已取消');
    } catch (error: any) {
      this.ctx.logger.error('[FirmwareController] Cancel OTA task error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '取消任务失败');
    }
  }

  /**
   * 更新OTA任务状态（设备回调）
   */
  @Post('/ota/tasks/:taskId/status')
  @ApiOperation({
    summary: '更新OTA任务状态',
    description: '更新OTA升级任务的进度和状态（由设备调用）',
  })
  @ApiResponse({
    status: 200,
    description: '更新成功',
  })
  @ApiParam({ name: 'taskId', description: '任务ID' })
  @ApiBody({
    description: '状态更新',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['downloading', 'installing', 'completed', 'failed'],
        },
        progress: { type: 'number', description: '进度（0-100）' },
        error: { type: 'string', description: '错误信息（失败时）' },
      },
      required: ['status', 'progress'],
    },
  })
  async updateOTATaskStatus(
    @Param('taskId') taskId: string,
    @Body() body: {
      status: 'downloading' | 'installing' | 'completed' | 'failed';
      progress: number;
      error?: string;
    }
  ) {
    try {
      const task = await this.otaService.updateOTATaskProgress(
        taskId,
        body.status,
        body.progress,
        body.error
      );

      if (!task) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '任务不存在');
      }

      return successResponse(task);
    } catch (error: any) {
      this.ctx.logger.error('[FirmwareController] Update OTA task status error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '更新状态失败');
    }
  }
}
