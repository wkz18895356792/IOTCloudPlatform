import { Controller, Get, Post, Del, Body, Param, Inject, Query } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiTags, ApiParam, ApiBody } from '@midwayjs/swagger';
import { StreamService } from '../service/stream.service';
import { StreamProviderType, successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 云平台管理控制器
 *
 * 处理云平台相关的 HTTP 请求，提供统一的 RESTful API 接口：
 * - 设备数据查询
 * - 云存储套餐开通/详情/重置
 * - 云存录像查询（全时录像 + 事件录像）
 * - 云存储缩略图获取
 * - 视频防盗链签名
 *
 * 所有端点根据 deviceId 自动解析设备所属云平台，无需客户端指定 provider
 */
@ApiTags('云平台管理')
@Controller('/api/videos')
export class StreamCloudStorageController {
  @Inject()
  ctx!: Context;

  @Inject()
  streamService!: StreamService;

  /**
   * 解析设备 provider 并返回，供内部使用
   */
  private async resolveProvider(deviceId: string): Promise<string> {
    return this.streamService.resolveProviderForDevice(deviceId);
  }

  // ==================== 云平台视频设备数据 API ====================

  /**
   * 获取设备属性数据
   */
  @Get('/device/:deviceId/data')
  @ApiOperation({ summary: '获取设备属性数据', description: '获取设备的物模型属性数据，自动识别云平台' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: '5ab82f743dd1' })
  async getDeviceData(@Param('deviceId') deviceId: string) {
    try {
      const data = await this.streamService.getStreamVideoDeviceData(deviceId);
      return successResponse(JSON.parse(data));
    } catch (error: any) {
      this.ctx.logger.error('[CloudStorage Controller] Failed to get device data:', error);
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, error.message || '获取设备数据失败');
    }
  }

  /**
   * 批量获取设备属性数据
   */
  @Post('/devices/data')
  @ApiOperation({ summary: '批量获取设备属性数据', description: '根据设备ID数组批量获取设备属性数据' })
  @ApiBody({
    description: '设备ID列表',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        deviceIds: { type: 'array', items: { type: 'string' }, description: '设备ID列表' },
      },
      required: ['deviceIds'],
    },
  })
  async getDevicesData(@Body() body: any) {
    try {
      const { deviceIds } = body;
      if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
        return errorResponse(ErrorCode.INVALID_PARAMS, 'deviceIds 必须为非空数组');
      }
      const data = await this.streamService.getIoTVideoDevicesData(deviceIds);
      return successResponse(data);
    } catch (error: any) {
      this.ctx.logger.error('[CloudStorage Controller] Failed to get devices data:', error);
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, error.message || '批量获取设备数据失败');
    }
  }

  // ==================== 云平台视频相关 API ====================

  /**
   * 获取视频防盗链播放地址
   */
  @Post('/anti-leech-url')
  @ApiOperation({ summary: '获取视频防盗链播放地址', description: '对原始云存储视频播放 URL 进行防盗链签名' })
  @ApiBody({
    description: '防盗链签名请求',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        videoUrl: { type: 'string', description: '原始云存储视频播放 URL' },
        deviceId: { type: 'string', description: '设备ID（可选，用于自动解析云平台）' },
      },
      required: ['videoUrl'],
    },
  })
  async getVideoAntiLeechUrl(@Body() body: any) {
    try {
      const { videoUrl } = body;
      const result = await this.streamService.getVideoAntiLeechUrl(videoUrl);
      return successResponse(result, '获取防盗链地址成功');
    } catch (error: any) {
      this.ctx.logger.error('[CloudStorage Controller] Failed to get anti-leech video URL:', error);
      return errorResponse(ErrorCode.THIRD_PARTY_SERVICE_ERROR, error.message || '获取防盗链地址失败');
    }
  }

  // ==================== 统一云存储 API（自动路由 provider） ====================

  /**
   * 开通设备云存储
   */
  @Post('/recordings')
  @ApiOperation({ summary: '开通设备云存储', description: '为指定设备开通云存储套餐，自动识别云平台' })
  @ApiBody({
    description: '云存储配置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: '设备ID', example: '5ab82f743dd1' },
        packageId: { type: 'string', description: '云存储套餐ID，默认 yc1m3d', example: 'yc1m3d' },
        override: { type: 'boolean', description: '是否覆盖已有套餐，默认 true', example: true },
      },
      required: ['deviceId'],
    },
  })
  async createCloudStorage(@Body() body: any) {
    try {
      const { deviceId, packageId = 'yc1m3d', override = true } = body || {};
      const providerType = await this.resolveProvider(deviceId) as StreamProviderType;
      const result = await this.streamService.createCloudStorage(deviceId, providerType, packageId, override);
      return successResponse(result, '云存储开通成功');
    } catch (error: any) {
      this.ctx.logger.error('[CloudStorage Controller] Failed to create cloud storage:', error);
      return errorResponse(ErrorCode.STORAGE_SERVICE_ERROR, error.message || '开通云存储失败');
    }
  }

  /**
   * 获取设备云存储详情
   */
  @Get('/recordings/:deviceId')
  @ApiOperation({ summary: '获取设备云存储详情', description: '获取指定设备的云存储状态和详情，自动识别云平台' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: '5ab82f743dd1' })
  async getCloudStorageDetail(@Param('deviceId') deviceId: string) {
    try {
      const providerType = await this.resolveProvider(deviceId) as StreamProviderType;
      const detail = await this.streamService.getCloudStorageDetail(deviceId, providerType);
      return successResponse(detail);
    } catch (error: any) {
      this.ctx.logger.error('[CloudStorage Controller] Failed to get cloud storage detail:', error);
      return errorResponse(ErrorCode.STORAGE_SERVICE_ERROR, error.message || '获取云存储详情失败');
    }
  }

  /**
   * 获取设备全时云存录像
   */
  @Get('/recordings/:deviceId/recordings')
  @ApiOperation({ summary: '获取设备全时云存录像', description: '获取指定设备的全时云存录像列表，自动识别云平台' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: '5ab82f743dd1' })
  async getCloudStorageRecordings(
    @Param('deviceId') deviceId: string,
    @Query('date') date?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    try {
      const providerType = await this.resolveProvider(deviceId) as StreamProviderType;
      const result = await this.streamService.getCloudStorageRecordings(
        deviceId,
        providerType,
        date,
        startTime ? parseInt(startTime, 10) : undefined,
        endTime ? parseInt(endTime, 10) : undefined,
      );
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[CloudStorage Controller] Failed to get cloud storage recordings:', error);
      return errorResponse(ErrorCode.STORAGE_SERVICE_ERROR, error.message || '获取云存录像失败');
    }
  }

  /**
   * 获取设备云存事件列表
   */
  @Get('/recordings/:deviceId/events')
  @ApiOperation({ summary: '获取设备云存事件列表', description: '获取指定设备的云存储事件录像列表，自动识别云平台' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: '5ab82f743dd1' })
  async getCloudStorageEvents(
    @Param('deviceId') deviceId: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('context') context?: string,
    @Query('size') size?: string,
  ) {
    try {
      const providerType = await this.resolveProvider(deviceId) as StreamProviderType;
      const result = await this.streamService.getCloudStorageEvents(
        deviceId,
        providerType,
        startTime ? parseInt(startTime, 10) : undefined,
        endTime ? parseInt(endTime, 10) : undefined,
        context || undefined,
        size ? parseInt(size, 10) : 10,
      );
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[CloudStorage Controller] Failed to get cloud storage events:', error);
      return errorResponse(ErrorCode.STORAGE_SERVICE_ERROR, error.message || '获取云存事件失败');
    }
  }

  /**
   * 重置设备云存储
   */
  @Del('/recordings/:deviceId')
  @ApiOperation({ summary: '重置设备云存储', description: '清除设备的云存储数据，自动识别云平台，此操作不可恢复' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: '5ab82f743dd1' })
  async resetCloudStorage(@Param('deviceId') deviceId: string) {
    try {
      const providerType = await this.resolveProvider(deviceId) as StreamProviderType;
      const result = await this.streamService.resetCloudStorage(deviceId, providerType);
      return successResponse(result, '云存储重置成功');
    } catch (error: any) {
      this.ctx.logger.error('[CloudStorage Controller] Failed to reset cloud storage:', error);
      return errorResponse(ErrorCode.STORAGE_SERVICE_ERROR, error.message || '重置云存储失败');
    }
  }

  // ==================== 云存储缩略图 API ====================

  /**
   * 获取单个云存储缩略图访问地址
   */
  @Get('/recordings/:deviceId/thumbnail')
  @ApiOperation({ summary: '获取单个云存储缩略图', description: '获取设备云存储缩略图的临时访问地址，自动识别云平台' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: '5ab82f743dd1' })
  async getCloudStorageThumbnail(
    @Param('deviceId') deviceId: string,
    @Query('thumbnail') thumbnail: string,
  ) {
    try {
      if (!thumbnail) {
        return errorResponse(ErrorCode.INVALID_PARAMS, 'thumbnail 参数必填');
      }
      const providerType = await this.resolveProvider(deviceId) as StreamProviderType;
      const provider = this.streamService['providers'].get(providerType);
      if (!provider?.getCloudStorageThumbnail) {
        return errorResponse(ErrorCode.STORAGE_SERVICE_ERROR, '当前设备类型不支持缩略图查询');
      }
      const result = await provider.getCloudStorageThumbnail(deviceId, thumbnail);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[CloudStorage Controller] Failed to get cloud storage thumbnail:', error);
      return errorResponse(ErrorCode.STORAGE_SERVICE_ERROR, error.message || '获取缩略图失败');
    }
  }

  /**
   * 批量获取云存储缩略图访问地址
   */
  @Post('/recordings/:deviceId/thumbnails')
  @ApiOperation({ summary: '批量获取云存储缩略图', description: '批量获取设备云存储缩略图的临时访问地址，自动识别云平台' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: '5ab82f743dd1' })
  @ApiBody({
    description: '缩略图文件名列表',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        thumbnails: { type: 'array', items: { type: 'string' }, description: '缩略图文件名列表' },
      },
      required: ['thumbnails'],
    },
  })
  async getCloudStorageThumbnailList(@Param('deviceId') deviceId: string, @Body() body: any) {
    try {
      const { thumbnails } = body;
      if (!Array.isArray(thumbnails) || thumbnails.length === 0) {
        return errorResponse(ErrorCode.INVALID_PARAMS, 'thumbnails 必须为非空数组');
      }
      const providerType = await this.resolveProvider(deviceId) as StreamProviderType;
      const provider = this.streamService['providers'].get(providerType);
      if (!provider?.getCloudStorageThumbnailList) {
        return errorResponse(ErrorCode.STORAGE_SERVICE_ERROR, '当前设备类型不支持批量缩略图查询');
      }
      const result = await provider.getCloudStorageThumbnailList(deviceId, thumbnails);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[CloudStorage Controller] Failed to get cloud storage thumbnail list:', error);
      return errorResponse(ErrorCode.STORAGE_SERVICE_ERROR, error.message || '批量获取缩略图失败');
    }
  }

  /**
   * 获取多个云存储缩略图访问地址（管道符分隔）
   */
  @Get('/recordings/:deviceId/multi-thumbnail')
  @ApiOperation({ summary: '获取多个云存储缩略图', description: '通过管道符分隔的缩略图文件名获取多个临时访问地址，自动识别云平台' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: '5ab82f743dd1' })
  async getCloudStorageMultiThumbnail(
    @Param('deviceId') deviceId: string,
    @Query('multiThumbnail') multiThumbnail: string,
  ) {
    try {
      if (!multiThumbnail) {
        return errorResponse(ErrorCode.INVALID_PARAMS, 'multiThumbnail 参数必填');
      }
      const providerType = await this.resolveProvider(deviceId) as StreamProviderType;
      const provider = this.streamService['providers'].get(providerType);
      if (!provider?.getCloudStorageMultiThumbnail) {
        return errorResponse(ErrorCode.STORAGE_SERVICE_ERROR, '当前设备类型不支持多缩略图查询');
      }
      const result = await provider.getCloudStorageMultiThumbnail(deviceId, multiThumbnail);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[CloudStorage Controller] Failed to get cloud storage multi thumbnail:', error);
      return errorResponse(ErrorCode.STORAGE_SERVICE_ERROR, error.message || '获取多个缩略图失败');
    }
  }
}
