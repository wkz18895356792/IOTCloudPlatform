import { Controller, Get, Post, Del, Body, Param, Inject, Query } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiTags, ApiParam, ApiBody } from '@midwayjs/swagger';
import { StreamService } from '../service/stream.service';
import { StreamConfig, RecordConfig, StreamProviderType, StreamProtocol, successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 流媒体控制器
 *
 * 处理流媒体相关的HTTP请求，提供RESTful API接口：
 * - 推流管理（开始、停止、获取播放地址）
 * - 录制管理（开始、停止、获取录制列表）
 * - 提供者管理（状态查询、切换）
 */
@ApiTags('流媒体管理')
@Controller('/api/videos')
export class StreamStreamingController {
  @Inject()
  ctx!: Context;

  @Inject()
  streamService!: StreamService;

  // /**
  //  * 开始推流
  //  * @description 为指定设备启动视频推流，支持多种协议和配置
  //  */
  // @Post('/')
  // @ApiOperation({ summary: '开始推流', description: '为指定设备启动视频推流，支持多种协议和配置' })
  // @ApiBody({
  //   description: '推流配置',
  //   required: true,
  //   type: 'object',
  //   schema: {
  //     type: 'object',
  //     properties: {
  //       deviceId: { type: 'string', description: '设备ID' },
  //       provider: { type: 'string', enum: ['aws_kvs', 'tencent', 'webrtc', 'local'], description: '流媒体提供者 (AWS KVS/腾讯云/WebRTC/本地)' },
  //       config: {
  //         type: 'object',
  //         properties: {
  //           protocol: { type: 'string', enum: ['hls', 'flv', 'rtmp', 'webrtc'], description: '流协议' },
  //           video: {
  //             type: 'object',
  //             properties: {
  //               codec: { type: 'string', example: 'h264', description: '视频编码' },
  //               bitrate: { type: 'number', example: 2000, description: '码率（kbps）' },
  //               fps: { type: 'number', example: 30, description: '帧率' },
  //               resolution: { type: 'string', example: '1920x1080', description: '分辨率' }
  //             }
  //           },
  //           audio: {
  //             type: 'object',
  //             properties: {
  //               codec: { type: 'string', example: 'aac', description: '音频编码' },
  //               bitrate: { type: 'number', example: 128, description: '音频码率（kbps）' },
  //               sampleRate: { type: 'number', example: 44100, description: '采样率（Hz）' }
  //             }
  //           }
  //         }
  //       }
  //     },
  //     required: ['deviceId']
  //   }
  // })
  // async startStream(@Body() body: any) {
  //   const { deviceId, config } = body;

  //   const streamConfig: StreamConfig = {
  //     protocol: config.protocol || StreamProtocol.HLS,
  //     video: config.video,
  //     audio: config.audio,
  //   };

  //   try {
  //     const session = await this.streamService.startStream(deviceId, streamConfig);
  //     return successResponse(session, '推流已启动');
  //   } catch (error: any) {
  //     this.ctx.logger.error('[Stream Controller] Failed to start stream:', error);
  //     return errorResponse(ErrorCode.STREAM_START_FAILED, error.message || '推流启动失败');
  //   }
  // }

  // /**
  //  * 停止推流
  //  * @description 停止指定的推流会话
  //  */
  // @Del('/:sessionId')
  // @ApiOperation({ summary: '停止推流', description: '停止指定的推流会话' })
  // @ApiParam({ name: 'sessionId', description: '推流会话ID', example: 'stream-123' })
  // async stopStream(@Param('sessionId') sessionId: string) {
  //   await this.streamService.stopStream(sessionId);
  //   return successResponse(null, '推流已停止');
  // }

  /**
   * 获取播放地址
   * @description 获取指定推流会话的播放地址（HLS/FLV/RTMP等）
   */
  @Get('/:sessionId/url')
  @ApiOperation({ summary: '获取播放地址', description: '获取指定推流会话的播放地址（HLS/FLV/RTMP等）' })
  @ApiParam({ name: 'sessionId', description: '推流会话ID', example: 'stream-123' })
  async getPlaybackUrl(@Param('sessionId') sessionId: string, @Query('protocol') protocol?: string) {
    const url = await this.streamService.getPlaybackUrl(sessionId, protocol || 'hls');
    return successResponse({ url }, '获取播放地址成功');
  }

  /**
   * 获取设备直接播放地址
   * @description 用于设备已持续推流的场景，直接获取播放地址而无需创建 session，适用于 App 随时接入观看实时画面
   */
  @Get('/device/:deviceId/playback')
  @ApiOperation({ summary: '获取设备直接播放地址', description: '用于设备已持续推流的场景，直接获取播放地址而无需创建 session' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getDevicePlaybackUrl(@Param('deviceId') deviceId: string) {
    try {
      const playbackInfo = await this.streamService.getDevicePlaybackUrl(deviceId);
      return successResponse(playbackInfo, '获取播放地址成功');
    } catch (error: any) {
      this.ctx.logger.error('[Stream Controller] Failed to get playback URL:', error);
      return errorResponse(ErrorCode.STREAM_NOT_STARTED, error.message || '获取播放地址失败');
    }
  }

  /**
   * 检查设备是否正在推流
   * @description 检查指定设备当前是否有活跃的推流
   */
  @Get('/device/:deviceId/streaming-status')
  @ApiOperation({ summary: '检查设备推流状态', description: '检查指定设备当前是否有活跃的推流' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async checkDeviceStreaming(@Param('deviceId') deviceId: string) {
    const isStreaming = await this.streamService.isDeviceStreaming(deviceId);
    return successResponse({ isStreaming, deviceId });
  }

  /**
   * 确保设备流资源已创建
   * @description 为设备预先创建流媒体资源（如 AWS KVS Stream），用于设备注册时调用
   */
  @Post('/device/:deviceId/stream')
  @ApiOperation({ summary: '创建设备流资源', description: '为设备预先创建流媒体资源（如 AWS KVS Stream）' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '提供者类型（可选，自动根据设备解析）',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {}
    }
  })
  async ensureDeviceStream(@Param('deviceId') deviceId: string, @Body() body: any) {
    const result = await this.streamService.ensureDeviceStream(deviceId, body?.provider);
    return successResponse({ ...result, deviceId }, '流资源创建成功');
  }

  /**
   * 获取设备流列表
   * @description 获取指定设备的所有活跃推流会话
   */
  @Get('/device/:deviceId')
  @ApiOperation({ summary: '获取设备流列表', description: '获取指定设备的所有活跃推流会话' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getDeviceStreams(@Param('deviceId') deviceId: string) {
    const streams = await this.streamService.getDeviceStreams(deviceId);
    return successResponse(streams);
  }

  /**
   * 开始录制
   * @description 开始录制指定设备的视频流
   */
  @Post('/live/recordings')
  @ApiOperation({ summary: '开始录制', description: '开始录制指定设备的视频流' })
  @ApiBody({
    description: '录制配置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: '设备ID' },
        provider: { type: 'string', enum: ['aws_kvs', 'tencent', 'webrtc', 'local'], description: '流媒体提供者 (AWS KVS/腾讯云/WebRTC/本地)' },
        config: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['mp4', 'flv', 'mkv'], description: '录制格式' },
            duration: { type: 'number', description: '录制时长（秒），0表示持续录制' },
            storageType: { type: 'string', enum: ['hot', 'cold'], description: '存储类型' }
          }
        }
      },
      required: ['deviceId']
    }
  })
  async startRecording(@Body() body: any) {
    const { deviceId, config } = body;

    const recordConfig: RecordConfig = {
      format: config.format || 'mp4',
      duration: config.duration,
      storageType: config.storageType || 'hot',
    };

    try {
      const recordingId = await this.streamService.startRecording(deviceId, recordConfig);
      return successResponse({ recordingId }, '录制已开始');
    } catch (error: any) {
      this.ctx.logger.error('[Stream Controller] Failed to start recording:', error);
      return errorResponse(ErrorCode.RECORDING_FAILED, error.message || '录制启动失败');
    }
  }

  /**
   * 停止录制
   * @description 停止指定的录制任务
   */
  @Del('/live/recordings/:recordingId')
  @ApiOperation({ summary: '停止录制', description: '停止指定的录制任务' })
  @ApiParam({ name: 'recordingId', description: '录制ID', example: 'recording-123' })
  async stopRecording(@Param('recordingId') recordingId: string, @Body() body: any) {
    await this.streamService.stopRecording(recordingId, body?.provider);
    return successResponse(null, '录制已停止');
  }

  /**
   * 获取录制列表
   * @description 获取指定设备的录制记录，支持时间范围筛选
   */
  @Get('/live/recordings/:deviceId')
  @ApiOperation({ summary: '获取录制列表', description: '获取指定设备的录制记录，支持时间范围筛选' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getRecordings(@Param('deviceId') deviceId: string, @Query('startTime') startTime?: string, @Query('endTime') endTime?: string) {
    const recordings = await this.streamService.getRecordings(
      deviceId,
      startTime ? new Date(startTime) : undefined,
      endTime ? new Date(endTime) : undefined
    );
    return successResponse(recordings);
  }

  /**
   * 获取提供者状态
   * @description 获取所有流媒体提供者的状态信息
   */
  @Get('/providers/status')
  @ApiOperation({ summary: '获取提供者状态', description: '获取所有流媒体提供者的状态信息' })
  async getProvidersStatus() {
    const status = await this.streamService.getProvidersStatus();
    return successResponse(status);
  }

  /**
   * 切换提供者
   * @description 切换默认的流媒体提供者
   */
  @Post('/providers/switch')
  @ApiOperation({ summary: '切换提供者', description: '切换默认的流媒体提供者' })
  @ApiBody({
    description: '提供者类型',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['local', 'srs', 'antmedia'], description: '提供者类型' }
      },
      required: ['provider']
    }
  })
  async switchProvider(@Body() body: any) {
    const { provider } = body;
    this.streamService.setProvider(provider as StreamProviderType);
    return successResponse(null, '切换提供者成功');
  }
}
