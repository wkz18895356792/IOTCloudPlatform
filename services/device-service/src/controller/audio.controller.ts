import { Controller, Get, Post, Put, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { DeviceService } from '../service/device.service';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 安抚音乐信息
 */
interface SoothingMusic {
  id: string;
  name: string;
  duration: number;
  category: 'white_noise' | 'lullaby' | 'nature' | 'womb_sound';
  url: string;
}

/**
 * 对讲和安抚控制器
 *
 * 处理摄像头的对讲和安抚音乐相关API
 */
@ApiTags('对讲和安抚')
@Controller('/api/devices')
export class AudioController {
  @Inject()
  ctx!: Context;

  @Inject()
  deviceService!: DeviceService;

  // ==================== 对讲功能 ====================

  /**
   * 开始对讲
   *
   * @description 开启设备对讲功能，将客户端音频传输到设备
   */
  @Post('/:deviceId/talk/start')
  @ApiOperation({
    summary: '开始对讲',
    description: '开启设备对讲功能，准备发送音频',
  })
  @ApiResponse({
    status: 200,
    description: '对讲已开启',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', example: 'talk-session-123' },
            audioUrl: { type: 'string', example: 'rtc://device-123/talk/in' },
            sampleRate: { type: 'number', example: 16000, description: '采样率' },
            channels: { type: 'number', example: 1, description: '声道数' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '对讲参数',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        sampleRate: {
          type: 'number',
          description: '音频采样率',
          example: 16000,
          enum: [8000, 16000, 44100, 48000],
        },
        channels: {
          type: 'number',
          description: '声道数',
          example: 1,
          enum: [1, 2],
        },
        codec: {
          type: 'string',
          description: '音频编码格式',
          example: 'opus',
          enum: ['opus', 'aac', 'g711a', 'g711u'],
        },
      },
    },
  })
  async startTalk(@Param('deviceId') deviceId: string, @Body() body?: {
    sampleRate?: number;
    channels?: number;
    codec?: string;
  }) {
    try {
      const result = await this.deviceService.sendCommand(
        deviceId,
        'START_TALK' as any,
        {
          sampleRate: body?.sampleRate || 16000,
          channels: body?.channels || 1,
          codec: body?.codec || 'opus',
        } as any,
        10000
      );

      return successResponse({
        sessionId: `talk-${deviceId}-${Date.now()}`,
        audioUrl: `rtc://${deviceId}/talk/in`,
        sampleRate: body?.sampleRate || 16000,
        channels: body?.channels || 1,
      });
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 停止对讲
   *
   * @description 关闭设备对讲功能
   */
  @Post('/:deviceId/talk/stop')
  @ApiOperation({
    summary: '停止对讲',
    description: '关闭设备对讲功能',
  })
  @ApiResponse({
    status: 200,
    description: '对讲已关闭',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '对讲已关闭' },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '停止对讲请求',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '对讲会话ID', example: 'talk-session-123' },
      },
      required: ['sessionId'],
    },
  })
  async stopTalk(@Param('deviceId') deviceId: string, @Body() body: { sessionId: string }) {
    try {
      await this.deviceService.sendCommand(
        deviceId,
        'STOP_TALK' as any,
        { sessionId: body.sessionId } as any,
        5000
      );

      return successResponse(undefined, '对讲已关闭');
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 获取对讲状态
   *
   * @description 查询设备的对讲功能状态
   */
  @Get('/:deviceId/talk/status')
  @ApiOperation({
    summary: '获取对讲状态',
    description: '查询设备的对讲功能状态',
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
            enabled: { type: 'boolean', example: true, description: '是否开启对讲' },
            sessionId: { type: 'string', example: 'talk-session-123', description: '当前会话ID' },
            volume: { type: 'number', example: 80, description: '音量(0-100)' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getTalkStatus(@Param('deviceId') deviceId: string) {
    try {
      // 从设备状态中获取对讲状态
      // 这里暂时返回默认值，实际需要查询设备状态
      return successResponse({
        enabled: false,
        sessionId: null,
        volume: 80,
      });
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_NOT_FOUND, (error as Error).message);
    }
  }

  // ==================== 安抚音乐 ====================

  /**
   * 获取安抚音乐列表
   *
   * @description 获取设备支持的安抚音乐列表
   */
  @Get('/:deviceId/soothing/music')
  @ApiOperation({
    summary: '获取安抚音乐列表',
    description: '获取设备支持的安抚音乐列表',
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
            categories: {
              type: 'array',
              description: '音乐分类',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: 'white_noise' },
                  name: { type: 'string', example: '白噪音' },
                  musicList: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', example: 'music-1' },
                        name: { type: 'string', example: '雨声' },
                        duration: { type: 'number', example: 180000 },
                        url: { type: 'string', example: 'https://cdn.example.com/music/rain.mp3' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getSoothingMusic(@Param('deviceId') deviceId: string) {
    try {
      // 返回预设的安抚音乐列表
      // 实际应该从配置或数据库中获取
      const categories = [
        {
          id: 'white_noise',
          name: '白噪音',
          musicList: [
            { id: 'wn-1', name: '雨声', duration: 180000, category: 'white_noise', url: 'https://cdn.example.com/music/rain.mp3' },
            { id: 'wn-2', name: '风声', duration: 180000, category: 'white_noise', url: 'https://cdn.example.com/music/wind.mp3' },
            { id: 'wn-3', name: '海浪声', duration: 180000, category: 'white_noise', url: 'https://cdn.example.com/music/ocean.mp3' },
          ],
        },
        {
          id: 'lullaby',
          name: '摇篮曲',
          musicList: [
            { id: 'lb-1', name: '小星星', duration: 240000, category: 'lullaby', url: 'https://cdn.example.com/music/twinkle.mp3' },
            { id: 'lb-2', name: '摇篮曲', duration: 300000, category: 'lullaby', url: 'https://cdn.example.com/music/berceuse.mp3' },
          ],
        },
        {
          id: 'nature',
          name: '自然声音',
          musicList: [
            { id: 'nt-1', name: '森林', duration: 180000, category: 'nature', url: 'https://cdn.example.com/music/forest.mp3' },
            { id: 'nt-2', name: '溪流', duration: 180000, category: 'nature', url: 'https://cdn.example.com/music/stream.mp3' },
          ],
        },
        {
          id: 'womb_sound',
          name: '子宫音',
          musicList: [
            { id: 'ws-1', name: '心跳声', duration: 300000, category: 'womb_sound', url: 'https://cdn.example.com/music/heartbeat.mp3' },
          ],
        },
      ];

      return successResponse({ categories });
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_NOT_FOUND, (error as Error).message);
    }
  }

  /**
   * 播放安抚音乐
   *
   * @description 在设备上播放指定的安抚音乐
   */
  @Post('/:deviceId/soothing/play')
  @ApiOperation({
    summary: '播放安抚音乐',
    description: '在设备上播放指定的安抚音乐',
  })
  @ApiResponse({
    status: 200,
    description: '播放成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', example: 'music-session-123' },
            musicId: { type: 'string', example: 'wn-1' },
            volume: { type: 'number', example: 60 },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '播放参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        musicId: {
          type: 'string',
          description: '音乐ID',
          example: 'wn-1',
        },
        volume: {
          type: 'number',
          description: '音量(0-100)',
          example: 60,
          minimum: 0,
          maximum: 100,
        },
        duration: {
          type: 'number',
          description: '播放时长（毫秒），0表示循环播放',
          example: 0,
        },
      },
      required: ['musicId'],
    },
  })
  async playSoothingMusic(
    @Param('deviceId') deviceId: string,
    @Body() body: { musicId: string; volume?: number; duration?: number }
  ) {
    try {
      const volume = body.volume ?? 60;
      if (volume < 0 || volume > 100) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '音量必须在0-100之间');
      }

      const result = await this.deviceService.sendCommand(
        deviceId,
        'PLAY_MUSIC' as any,
        {
          musicId: body.musicId,
          volume,
          duration: body.duration ?? 0,
        } as any,
        10000
      );

      return successResponse({
        sessionId: `music-${deviceId}-${Date.now()}`,
        musicId: body.musicId,
        volume,
      });
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 停止安抚音乐
   *
   * @description 停止设备正在播放的安抚音乐
   */
  @Post('/:deviceId/soothing/stop')
  @ApiOperation({
    summary: '停止安抚音乐',
    description: '停止设备正在播放的安抚音乐',
  })
  @ApiResponse({
    status: 200,
    description: '停止成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '音乐已停止' },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async stopSoothingMusic(@Param('deviceId') deviceId: string) {
    try {
      await this.deviceService.sendCommand(
        deviceId,
        'STOP_MUSIC' as any,
        {} as any,
        5000
      );

      return successResponse(undefined, '音乐已停止');
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 设置音乐音量
   *
   * @description 调整设备安抚音乐的播放音量
   */
  @Put('/:deviceId/soothing/volume')
  @ApiOperation({
    summary: '设置音乐音量',
    description: '调整设备安抚音乐的播放音量',
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
            volume: { type: 'number', example: 70 },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '音量设置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        volume: {
          type: 'number',
          description: '音量(0-100)',
          example: 70,
          minimum: 0,
          maximum: 100,
        },
      },
      required: ['volume'],
    },
  })
  async setMusicVolume(@Param('deviceId') deviceId: string, @Body() body: { volume: number }) {
    try {
      if (body.volume < 0 || body.volume > 100) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '音量必须在0-100之间');
      }

      await this.deviceService.sendCommand(
        deviceId,
        'SET_MUSIC_VOLUME' as any,
        { volume: body.volume } as any,
        5000
      );

      return successResponse({ volume: body.volume });
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 设置自动播放安抚音乐
   *
   * @description 设置检测到哭声时自动播放安抚音乐的规则
   */
  @Put('/:deviceId/soothing/auto-play')
  @ApiOperation({
    summary: '设置自动播放安抚音乐',
    description: '设置检测到哭声时自动播放安抚音乐的规则',
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
            enabled: { type: 'boolean', example: true },
            musicId: { type: 'string', example: 'wn-1' },
            maxDuration: { type: 'number', example: 300000 },
            volume: { type: 'number', example: 50 },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '自动播放设置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: '是否启用自动播放',
          example: true,
        },
        musicId: {
          type: 'string',
          description: '默认音乐ID',
          example: 'wn-1',
        },
        maxDuration: {
          type: 'number',
          description: '最大播放时长（毫秒）',
          example: 300000,
        },
        volume: {
          type: 'number',
          description: '播放音量(0-100)',
          example: 50,
        },
      },
      required: ['enabled'],
    },
  })
  async setAutoPlaySoothing(
    @Param('deviceId') deviceId: string,
    @Body() body: {
      enabled: boolean;
      musicId?: string;
      maxDuration?: number;
      volume?: number;
    }
  ) {
    try {
      if (body.volume !== undefined && (body.volume < 0 || body.volume > 100)) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '音量必须在0-100之间');
      }

      await this.deviceService.sendCommand(
        deviceId,
        'SET_AUTO_PLAY' as any,
        {
          enabled: body.enabled,
          musicId: body.musicId,
          maxDuration: body.maxDuration ?? 300000,
          volume: body.volume ?? 50,
        } as any,
        5000
      );

      return successResponse({
        enabled: body.enabled,
        musicId: body.musicId,
        maxDuration: body.maxDuration ?? 300000,
        volume: body.volume ?? 50,
      });
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_COMMAND_FAILED, (error as Error).message);
    }
  }

  /**
   * 获取自动播放设置
   *
   * @description 查询设备的自动播放安抚音乐设置
   */
  @Get('/:deviceId/soothing/auto-play')
  @ApiOperation({
    summary: '获取自动播放设置',
    description: '查询设备的自动播放安抚音乐设置',
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
            enabled: { type: 'boolean', example: true },
            musicId: { type: 'string', example: 'wn-1' },
            maxDuration: { type: 'number', example: 300000 },
            volume: { type: 'number', example: 50 },
            playCount: { type: 'number', example: 15, description: '今日自动播放次数' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getAutoPlaySetting(@Param('deviceId') deviceId: string) {
    try {
      // 从设备配置中获取自动播放设置
      // 这里暂时返回默认值
      return successResponse({
        enabled: false,
        musicId: 'wn-1',
        maxDuration: 300000,
        volume: 50,
        playCount: 0,
      });
    } catch (error) {
      return errorResponse(ErrorCode.DEVICE_NOT_FOUND, (error as Error).message);
    }
  }
}
