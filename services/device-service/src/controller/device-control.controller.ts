import { Controller, Post, Body, Param, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiBody } from '@midwayjs/swagger';
import { DeviceService } from '../service/device.service';
import { DeviceCommandType, successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 设备控制控制器
 *
 * 处理设备基础控制命令：恢复出厂设置、录制、静音、分辨率等
 */
@ApiTags('设备控制')
@Controller('/api/devices')
export class DeviceControlController {
  @Inject()
  ctx!: Context;

  @Inject()
  deviceService!: DeviceService;

  /**
   * 恢复出厂设置
   */
  @Post('/:deviceId/control/factory-reset')
  @ApiOperation({
    summary: '恢复出厂设置',
    description: '恢复设备到出厂设置状态，需确认操作',
  })
  @ApiResponse({
    status: 200,
    description: '命令发送成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object' },
        message: { type: 'string', example: '恢复出厂设置命令已发送' },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '确认参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean', description: '确认恢复出厂设置', example: true },
      },
      required: ['confirm'],
    },
  })
  async factoryReset(
    @Param('deviceId') deviceId: string,
    @Body() body: { confirm: boolean },
  ) {
    try {
      if (!body.confirm) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '请确认恢复出厂设置操作');
      }

      const result = await this.deviceService.sendCommand(
        deviceId,
        DeviceCommandType.FACTORY_RESET,
        { confirm: true },
        30000,
      );

      return successResponse(result, '恢复出厂设置命令已发送');
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  // ==================== 录制控制 ====================

  /**
   * 开始录制
   */
  @Post('/:deviceId/control/recording/start')
  @ApiOperation({
    summary: '开始录制',
    description: '开始设备录制',
  })
  @ApiResponse({
    status: 200,
    description: '录制已开始',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object' },
        message: { type: 'string', example: '录制已开始' },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '录制参数',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        duration: { type: 'number', description: '录制时长（秒）', example: 60 },
        resolution: { type: 'string', description: '录制分辨率', example: '1080p' },
      },
    },
  })
  async startRecording(
    @Param('deviceId') deviceId: string,
    @Body() body: { duration?: number; resolution?: string },
  ) {
    try {
      if (body.duration !== undefined && body.duration <= 0) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '录制时长必须大于0');
      }

      const result = await this.deviceService.sendCommand(
        deviceId,
        DeviceCommandType.START_RECORDING,
        {
          duration: body.duration,
          resolution: body.resolution,
        },
        10000,
      );

      return successResponse(result, '录制已开始');
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 停止录制
   */
  @Post('/:deviceId/control/recording/stop')
  @ApiOperation({
    summary: '停止录制',
    description: '停止设备录制',
  })
  @ApiResponse({
    status: 200,
    description: '录制已停止',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object' },
        message: { type: 'string', example: '录制已停止' },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async stopRecording(@Param('deviceId') deviceId: string) {
    try {
      const result = await this.deviceService.sendCommand(
        deviceId,
        DeviceCommandType.STOP_RECORDING,
        {},
        10000,
      );

      return successResponse(result, '录制已停止');
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  // ==================== 音频控制 ====================

  /**
   * 静音/取消静音
   */
  @Post('/:deviceId/control/mute')
  @ApiOperation({
    summary: '静音/取消静音',
    description: '控制设备麦克风静音状态',
  })
  @ApiResponse({
    status: 200,
    description: '操作成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object' },
        message: { type: 'string', example: '已静音' },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '静音参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        muted: { type: 'boolean', description: '是否静音', example: true },
      },
      required: ['muted'],
    },
  })
  async mute(
    @Param('deviceId') deviceId: string,
    @Body() body: { muted: boolean },
  ) {
    try {
      if (typeof body.muted !== 'boolean') {
        return errorResponse(ErrorCode.INVALID_PARAMS, 'muted参数必须为布尔值');
      }

      const result = await this.deviceService.sendCommand(
        deviceId,
        DeviceCommandType.MUTE,
        { muted: body.muted },
        5000,
      );

      return successResponse(result, body.muted ? '已静音' : '已取消静音');
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  // ==================== 视频控制 ====================

  /**
   * 开始推流
   */
  @Post('/:deviceId/control/stream/start')
  @ApiOperation({
    summary: '开始推流',
    description: '向设备发送开始推流命令',
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '推流参数',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        resolution: { type: 'string', description: '推流分辨率', example: '1080p' },
      },
    },
  })
  async startStream(
    @Param('deviceId') deviceId: string,
    @Body() body: { resolution?: string },
  ) {
    try {
      const result = await this.deviceService.sendCommand(
        deviceId,
        DeviceCommandType.START_STREAM,
        { resolution: body.resolution },
        15000,
      );
      return successResponse(result, '推流已开始');
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 停止推流
   */
  @Post('/:deviceId/control/stream/stop')
  @ApiOperation({
    summary: '停止推流',
    description: '向设备发送停止推流命令',
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async stopStream(@Param('deviceId') deviceId: string) {
    try {
      const result = await this.deviceService.sendCommand(
        deviceId,
        DeviceCommandType.STOP_STREAM,
        {},
        10000,
      );
      return successResponse(result, '推流已停止');
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 设置分辨率
   */
  @Post('/:deviceId/control/resolution')
  @ApiOperation({
    summary: '设置分辨率',
    description: '设置设备视频分辨率',
  })
  @ApiResponse({
    status: 200,
    description: '设置成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            resolution: { type: 'string', example: '1080p' },
          },
        },
        message: { type: 'string', example: '分辨率设置成功' },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '分辨率设置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        resolution: { type: 'string', description: '分辨率（如 720p, 1080p, 2K, 4K）', example: '1080p' },
      },
      required: ['resolution'],
    },
  })
  async setResolution(
    @Param('deviceId') deviceId: string,
    @Body() body: { resolution: string },
  ) {
    try {
      if (!body.resolution || typeof body.resolution !== 'string') {
        return errorResponse(ErrorCode.INVALID_PARAMS, '请提供有效的分辨率参数');
      }

      const result = await this.deviceService.sendCommand(
        deviceId,
        DeviceCommandType.SET_RESOLUTION,
        { resolution: body.resolution },
        10000,
      );

      return successResponse({ resolution: body.resolution }, '分辨率设置成功');
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }
}
