import { Controller, Get, Post, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiTags } from '@midwayjs/swagger';
import { DeviceLogService } from '../service/device-log.service';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';
import { ServiceAuthMiddleware } from '../middleware/service-auth.middleware';

@ApiTags('设备日志管理')
@Controller('/api/storage/device-logs', { middleware: [ServiceAuthMiddleware] })
export class DeviceLogController {
  @Inject() ctx!: Context;
  @Inject() deviceLogService!: DeviceLogService;

  /**
   * 请求日志上传预签名URL（通过 device-gateway 调用）
   */
  @Post('/upload-url')
  async requestUploadUrl(@Body() body: any) {
    try {
      const result = await this.deviceLogService.requestUploadUrl(body);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[DeviceLog] requestUploadUrl failed:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * 确认日志上传完成（通过 device-gateway 调用）
   */
  @Post('/register')
  async registerUpload(@Body() body: any) {
    try {
      const result = await this.deviceLogService.registerUpload(body);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[DeviceLog] registerUpload failed:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * 获取设备日志列表
   */
  @Get('/device/:deviceId')
  async listLogs(
    @Param('deviceId') deviceId: string,
    @Query('logType') logType?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    try {
      const result = await this.deviceLogService.listLogs(deviceId, {
        logType,
        status: status as any,
        page: page ? parseInt(page) : 1,
        pageSize: pageSize ? parseInt(pageSize) : 20,
      });
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[DeviceLog] listLogs failed:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * 获取日志下载地址
   */
  @Get('/:logId/download')
  async getDownloadUrl(
    @Param('logId') logId: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    try {
      const result = await this.deviceLogService.getDownloadUrl(
        logId,
        expiresIn ? parseInt(expiresIn) : 3600,
      );
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[DeviceLog] getDownloadUrl failed:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * 删除日志
   */
  @Del('/:logId')
  async deleteLog(@Param('logId') logId: string) {
    try {
      await this.deviceLogService.deleteLog(logId);
      return successResponse(null);
    } catch (error: any) {
      this.ctx.logger.error('[DeviceLog] deleteLog failed:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * 更新日志打捞状态（通过 device-service 调用）
   */
  @Post('/collect/status')
  async updateCollectStatus(@Body() body: any) {
    try {
      await this.deviceLogService.updateCollectStatus(
        body.taskId,
        body.status,
        body.fileSize,
        body.error,
      );
      return successResponse(null);
    } catch (error: any) {
      this.ctx.logger.error('[DeviceLog] updateCollectStatus failed:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message);
    }
  }
}
