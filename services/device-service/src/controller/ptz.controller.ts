import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { DeviceService } from '../service/device.service';
import { PTZDirection, PTZControlPayload, PTZPreset } from '@baby-monitor/shared-types';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 云台控制器
 *
 * 处理摄像头云台控制相关的API
 */
@ApiTags('云台控制')
@Controller('/api/devices')
export class PTZController {
  @Inject()
  ctx!: Context;

  @Inject()
  deviceService!: DeviceService;

  /**
   * 云台移动控制
   *
   * @description 控制云台向指定方向移动
   */
  @Post('/:deviceId/ptz/control')
  @ApiOperation({
    summary: '云台移动控制',
    description: '控制摄像头云台向指定方向移动',
  })
  @ApiResponse({
    status: 200,
    description: '控制成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            commandId: { type: 'string', example: 'cmd-123' },
            status: { type: 'string', example: 'sent' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '控制失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'DEVICE_COMMAND_FAILED' },
            message: { type: 'string', example: '设备命令执行失败' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '云台控制参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right', 'up_left', 'up_right', 'down_left', 'down_right', 'stop', 'goto_preset', 'set_preset'],
          description: '移动方向',
          example: 'up',
        },
        speed: {
          type: 'number',
          description: '移动速度 (1-100)',
          example: 50,
          minimum: 1,
          maximum: 100,
        },
        duration: {
          type: 'number',
          description: '持续时间（毫秒），连续移动时使用',
          example: 1000,
        },
        presetId: {
          type: 'number',
          description: '预设位置ID（用于 goto_preset 和 set_preset）',
          example: 1,
        },
        horizontal: {
          type: 'number',
          description: '水平角度（-180到180）',
          example: 45,
          minimum: -180,
          maximum: 180,
        },
        vertical: {
          type: 'number',
          description: '垂直角度（-90到90）',
          example: 30,
          minimum: -90,
          maximum: 90,
        },
        zoom: {
          type: 'number',
          description: '变焦倍数',
          example: 2,
        },
      },
      required: ['direction'],
    },
  })
  async controlPTZ(@Param('deviceId') deviceId: string, @Body() body: PTZControlPayload) {
    try {
      // 验证速度参数
      if (body.speed !== undefined && (body.speed < 1 || body.speed > 100)) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '速度参数必须在1-100之间');
      }

      // 验证水平角度
      if (body.horizontal !== undefined && (body.horizontal < -180 || body.horizontal > 180)) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '水平角度必须在-180到180之间');
      }

      // 验证垂直角度
      if (body.vertical !== undefined && (body.vertical < -90 || body.vertical > 90)) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '垂直角度必须在-90到90之间');
      }

      // 验证预设位置ID（对于需要预设位置的命令）
      if ((body.direction === PTZDirection.GOTO_PRESET || body.direction === PTZDirection.SET_PRESET)
          && body.presetId === undefined) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '预设位置ID不能为空');
      }

      const result = await this.deviceService.sendCommand(
        deviceId,
        'PTZ_CONTROL' as any,
        body as any,
        30000
      );

      return successResponse(result);
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 停止云台移动
   *
   * @description 停止云台的所有移动动作
   */
  @Post('/:deviceId/ptz/stop')
  @ApiOperation({
    summary: '停止云台移动',
    description: '停止云台的所有移动动作',
  })
  @ApiResponse({
    status: 200,
    description: '停止成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            commandId: { type: 'string', example: 'cmd-123' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async stopPTZ(@Param('deviceId') deviceId: string) {
    try {
      const result = await this.deviceService.sendCommand(
        deviceId,
        'PTZ_CONTROL' as any,
        { direction: PTZDirection.STOP } as any,
        5000
      );

      return successResponse(result);
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 获取云台当前位置
   *
   * @description 获取云台当前的水平角度、垂直角度和变焦倍数
   */
  @Get('/:deviceId/ptz/position')
  @ApiOperation({
    summary: '获取云台当前位置',
    description: '获取云台当前的位置信息',
  })
  @ApiResponse({
    status: 200,
    description: '查询成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            horizontal: { type: 'number', example: 45, description: '水平角度' },
            vertical: { type: 'number', example: 30, description: '垂直角度' },
            zoom: { type: 'number', example: 2, description: '变焦倍数' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getPTZPosition(@Param('deviceId') deviceId: string) {
    try {
      // 这里应该从设备状态中获取云台位置
      // 暂时返回一个模拟数据
      // 实际实现中需要从设备状态中查询
      return successResponse({
        horizontal: 0,
        vertical: 0,
        zoom: 1,
      });
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_NOT_FOUND, (error as Error).message);
    }
  }

  /**
   * 设置预设位置
   *
   * @description 将当前位置保存为预设位置
   */
  @Post('/:deviceId/ptz/presets')
  @ApiOperation({
    summary: '设置预设位置',
    description: '将当前云台位置保存为预设位置',
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
            presetId: { type: 'number', example: 1 },
            name: { type: 'string', example: '客厅' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '预设位置参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        presetId: {
          type: 'number',
          description: '预设位置ID（1-16）',
          example: 1,
          minimum: 1,
          maximum: 16,
        },
        name: {
          type: 'string',
          description: '预设位置名称',
          example: '客厅',
          maxLength: 32,
        },
      },
      required: ['presetId', 'name'],
    },
  })
  async setPreset(
    @Param('deviceId') deviceId: string,
    @Body() body: { presetId: number; name: string }
  ) {
    try {
      if (body.presetId < 1 || body.presetId > 16) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '预设位置ID必须在1-16之间');
      }

      const result = await this.deviceService.sendCommand(
        deviceId,
        'PTZ_CONTROL' as any,
        {
          direction: PTZDirection.SET_PRESET,
          presetId: body.presetId,
          name: body.name,
        } as any,
        5000
      );

      return successResponse({
        presetId: body.presetId,
        name: body.name,
      });
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 获取预设位置列表
   *
   * @description 获取设备所有已保存的预设位置
   */
  @Get('/:deviceId/ptz/presets')
  @ApiOperation({
    summary: '获取预设位置列表',
    description: '获取设备所有已保存的预设位置',
  })
  @ApiResponse({
    status: 200,
    description: '查询成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            presets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'number', example: 1 },
                  name: { type: 'string', example: '客厅' },
                  horizontal: { type: 'number', example: 45 },
                  vertical: { type: 'number', example: 30 },
                  zoom: { type: 'number', example: 2 },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getPresets(@Param('deviceId') deviceId: string) {
    try {
      // 这里应该从设备配置或数据库中获取预设位置列表
      // 暂时返回一个模拟数据
      // 实际实现中需要查询设备配置
      return successResponse({
        presets: [] as PTZPreset[],
      });
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_NOT_FOUND, (error as Error).message);
    }
  }

  /**
   * 删除预设位置
   *
   * @description 删除指定的预设位置
   */
  @Del('/:deviceId/ptz/presets/:presetId')
  @ApiOperation({
    summary: '删除预设位置',
    description: '删除指定的预设位置',
  })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '预设位置已删除' },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiParam({ name: 'presetId', description: '预设位置ID', example: '1' })
  async deletePreset(@Param('deviceId') deviceId: string, @Param('presetId') presetId: string) {
    try {
      const presetIdNum = parseInt(presetId);
      if (isNaN(presetIdNum) || presetIdNum < 1 || presetIdNum > 16) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '预设位置ID无效');
      }

      // 发送删除预设位置命令
      const result = await this.deviceService.sendCommand(
        deviceId,
        'PTZ_CONTROL' as any,
        {
          direction: 'delete_preset',
          presetId: presetIdNum,
        } as any,
        5000
      );

      return successResponse(undefined, '预设位置已删除');
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 跳转到预设位置
   *
   * @description 控制云台移动到指定的预设位置
   */
  @Post('/:deviceId/ptz/presets/:presetId/goto')
  @ApiOperation({
    summary: '跳转到预设位置',
    description: '控制云台移动到指定的预设位置',
  })
  @ApiResponse({
    status: 200,
    description: '跳转成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            commandId: { type: 'string', example: 'cmd-123' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiParam({ name: 'presetId', description: '预设位置ID', example: '1' })
  async gotoPreset(@Param('deviceId') deviceId: string, @Param('presetId') presetId: string) {
    try {
      const presetIdNum = parseInt(presetId);
      if (isNaN(presetIdNum) || presetIdNum < 1 || presetIdNum > 16) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '预设位置ID无效');
      }

      const result = await this.deviceService.sendCommand(
        deviceId,
        'PTZ_CONTROL' as any,
        {
          direction: PTZDirection.GOTO_PRESET,
          presetId: presetIdNum,
        } as any,
        30000
      );

      return successResponse(result);
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 云台自动巡航
   *
   * @description 启动或停止云台自动巡航功能
   */
  @Post('/:deviceId/ptz/cruise')
  @ApiOperation({
    summary: '云台自动巡航',
    description: '启动或停止云台自动巡航功能',
  })
  @ApiResponse({
    status: 200,
    description: '操作成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', example: true },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '巡航参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: '是否启用巡航',
          example: true,
        },
        mode: {
          type: 'string',
          enum: ['horizontal', 'vertical', 'preset'],
          description: '巡航模式',
          example: 'horizontal',
        },
        speed: {
          type: 'number',
          description: '巡航速度 (1-5)',
          example: 3,
          minimum: 1,
          maximum: 5,
        },
        presetIds: {
          type: 'array',
          items: { type: 'number' },
          description: '预设位置ID列表（preset模式使用）',
          example: [1, 2, 3],
        },
      },
      required: ['enabled'],
    },
  })
  async cruise(@Param('deviceId') deviceId: string, @Body() body: {
    enabled: boolean;
    mode?: 'horizontal' | 'vertical' | 'preset';
    speed?: number;
    presetIds?: number[];
  }) {
    try {
      const result = await this.deviceService.sendCommand(
        deviceId,
        'PTZ_CONTROL' as any,
        {
          direction: body.enabled ? 'cruise_start' : 'cruise_stop',
          mode: body.mode || 'horizontal',
          speed: body.speed || 3,
          presetIds: body.presetIds || [],
        } as any,
        5000
      );

      return successResponse({ enabled: body.enabled });
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }
}
