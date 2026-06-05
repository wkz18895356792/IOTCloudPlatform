import { Controller, Get, Post, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiTags } from '@midwayjs/swagger';
import { RecordingService } from '../service/recording.service';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';
import { ServiceAuthMiddleware } from '../middleware/service-auth.middleware';

@ApiTags('录制管理')
@Controller('/api/storage/recordings', { middleware: [ServiceAuthMiddleware] })
export class RecordingController {
  @Inject() ctx!: Context;
  @Inject() recordingService!: RecordingService;

  /**
   * 摄像头请求上传URL（通过 device-gateway 调用）
   */
  @Post('/upload-url')
  async requestUploadUrl(@Body() body: any) {
    try {
      const result = await this.recordingService.requestUploadUrl(body);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] requestUploadUrl failed:', error);
      return errorResponse(ErrorCode.RECORDING_FAILED, error.message);
    }
  }

  /**
   * 摄像头发起分片上传（通过 device-gateway 调用）
   */
  @Post('/multipart/start')
  async startMultipart(@Body() body: any) {
    try {
      const result = await this.recordingService.requestMultipartStart(body);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] startMultipart failed:', error);
      return errorResponse(ErrorCode.RECORDING_MULTIPART_INVALID, error.message);
    }
  }

  /**
   * 摄像头完成分片上传（通过 device-gateway 调用）
   */
  @Post('/multipart/complete')
  async completeMultipart(@Body() body: any) {
    try {
      const result = await this.recordingService.completeMultipart(body);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] completeMultipart failed:', error);
      return errorResponse(ErrorCode.RECORDING_MULTIPART_INVALID, error.message);
    }
  }

  /**
   * 摄像头确认单次上传完成（通过 device-gateway 调用）
   */
  @Post('/register')
  async registerRecording(@Body() body: any) {
    try {
      const result = await this.recordingService.registerRecording(body);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] registerRecording failed:', error);
      return errorResponse(ErrorCode.RECORDING_FAILED, error.message);
    }
  }

  /**
   * 摄像头批量请求上传URL（连续录制场景，通过 device-gateway 调用）
   */
  @Post('/upload-url/batch')
  async requestBatchUploadUrls(@Body() body: any) {
    try {
      const result = await this.recordingService.requestBatchUploadUrls(body);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] requestBatchUploadUrls failed:', error);
      return errorResponse(ErrorCode.RECORDING_FAILED, error.message);
    }
  }

  /**
   * 摄像头批量确认上传完成（连续录制场景，通过 device-gateway 调用）
   */
  @Post('/register/batch')
  async batchRegisterRecordings(@Body() body: any) {
    try {
      const result = await this.recordingService.batchRegisterRecordings(body);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] batchRegisterRecordings failed:', error);
      return errorResponse(ErrorCode.RECORDING_FAILED, error.message);
    }
  }

  /**
   * APP: 获取设备录像列表
   */
  @Get('/device/:deviceId')
  async listRecordings(
    @Param('deviceId') deviceId: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    try {
      const recordings = await this.recordingService.listRecordings(deviceId, startTime, endTime);
      return successResponse(recordings);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] listRecordings failed:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * APP: 按天获取设备录像
   */
  @Get('/device/:deviceId/by-day')
  async getRecordingsByDay(
    @Param('deviceId') deviceId: string,
    @Query('date') date?: string,
  ) {
    try {
      const summaries = await this.recordingService.getRecordingsByDay(deviceId, date);
      return successResponse(summaries);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] getRecordingsByDay failed:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * APP: 获取录像播放地址
   */
  @Get('/:recordingId/playback')
  async getPlaybackUrl(
    @Param('recordingId') recordingId: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    try {
      const result = await this.recordingService.getPlaybackUrl(
        recordingId,
        expiresIn ? parseInt(expiresIn) : 3600,
      );
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] getPlaybackUrl failed:', error);
      return errorResponse(ErrorCode.RECORDING_NOT_FOUND, error.message);
    }
  }

  /**
   * 删除录像
   */
  @Del('/:recordingId')
  async deleteRecording(@Param('recordingId') recordingId: string) {
    try {
      await this.recordingService.deleteRecording(recordingId);
      return successResponse(null);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] deleteRecording failed:', error);
      return errorResponse(ErrorCode.RECORDING_NOT_FOUND, error.message);
    }
  }

  /**
   * APP: 获取设备录像时间轴
   *
   * 返回指定时间范围内的录像时间轴数据，包括：
   * - 按天分组的录像列表
   * - 时间断点检测
   * - 总时长和文件大小统计
   */
  @Get('/device/:deviceId/timeline')
  async getTimeline(
    @Param('deviceId') deviceId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('includeIncomplete') includeIncomplete?: string,
  ) {
    try {
      const timeline = await this.recordingService.getTimeline(
        deviceId,
        startDate,
        endDate,
        includeIncomplete === 'true',
      );
      return successResponse(timeline);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] getTimeline failed:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * APP: 获取连续录像片段
   *
   * 返回所有连续的录像片段（没有断点的录像序列）
   * 用于快速定位连续录制的时间段
   */
  @Get('/device/:deviceId/continuous')
  async getContinuousSegments(
    @Param('deviceId') deviceId: string,
    @Query('minDuration') minDuration?: string,
  ) {
    try {
      const segments = await this.recordingService.getContinuousSegments(
        deviceId,
        minDuration ? parseInt(minDuration) : 60,
      );
      return successResponse(segments);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] getContinuousSegments failed:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * APP: 获取断点统计信息
   *
   * 返回录像断点的统计分析，包括：
   * - 断点数量和总时长
   * - 录像覆盖率
   * - 断点时长分布
   */
  @Get('/device/:deviceId/gaps')
  async getGapStatistics(
    @Param('deviceId') deviceId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    try {
      const statistics = await this.recordingService.getGapStatistics(
        deviceId,
        startDate,
        endDate,
      );
      return successResponse(statistics);
    } catch (error: any) {
      this.ctx.logger.error('[Recording] getGapStatistics failed:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message);
    }
  }
}
