import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { NotificationSettingsService } from '../service/notification-settings.service';
import { NotificationType } from '../entity/notification.entity';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 通知设置控制器
 *
 * 处理用户通知偏好设置相关的API
 */
@ApiTags('通知管理')
@Controller('/api/users/me/notifications')
export class NotificationSettingsController {
  @Inject()
  ctx!: Context;

  @Inject()
  notificationSettingsService!: NotificationSettingsService;

  // ==================== 通知总开关 ====================

  /**
   * 获取通知设置
   */
  @Get('/settings')
  @ApiOperation({
    summary: '获取通知设置',
    description: '获取用户的通知偏好设置',
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
            pushEnabled: { type: 'boolean', example: true },
            dndStart: { type: 'string', example: '22:00' },
            dndEnd: { type: 'string', example: '08:00' },
            cryingDetectionEnabled: { type: 'boolean', example: true },
            cryingRecognitionEnabled: { type: 'boolean', example: true },
            temperatureAlertEnabled: { type: 'boolean', example: true },
            tempMin: { type: 'number', example: 18 },
            tempMax: { type: 'number', example: 28 },
            humidityAlertEnabled: { type: 'boolean', example: true },
            humidityMin: { type: 'number', example: 30 },
            humidityMax: { type: 'number', example: 70 },
            autoSoothingEnabled: { type: 'boolean', example: false },
            geofenceEnabled: { type: 'boolean', example: false },
            ringtoneId: { type: 'string', example: 'default' },
            ringtoneVolume: { type: 'number', example: 80 },
            vibrationEnabled: { type: 'boolean', example: true },
          },
        },
      },
    },
  })
  async getSettings() {
    const userId = this.ctx.state.user.userId;
    const settings = await this.notificationSettingsService.getOrCreateSettings(userId);
    return successResponse(settings);
  }

  /**
   * 更新推送通知总开关
   */
  @Put('/settings/push')
  @ApiOperation({
    summary: '更新推送通知开关',
    description: '开启或关闭推送通知',
  })
  @ApiResponse({
    status: 200,
    description: '更新成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            pushEnabled: { type: 'boolean', example: true },
          },
        },
      },
    },
  })
  @ApiBody({
    description: '推送开关设置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', example: true },
      },
      required: ['enabled'],
    },
  })
  async updatePushEnabled(@Body() body: { enabled: boolean }) {
    const userId = this.ctx.state.user.userId;
    const settings = await this.notificationSettingsService.updatePushEnabled(userId, body.enabled);
    return successResponse({ pushEnabled: settings.pushEnabled });
  }

  /**
   * 更新免打扰时间段
   */
  @Put('/settings/dnd')
  @ApiOperation({
    summary: '设置免打扰时间段',
    description: '设置免打扰时间段，期间不接收推送通知',
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
            dndStart: { type: 'string', example: '22:00' },
            dndEnd: { type: 'string', example: '08:00' },
          },
        },
      },
    },
  })
  @ApiBody({
    description: '免打扰时间设置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        dndStart: { type: 'string', example: '22:00', description: '开始时间（HH:mm格式），null表示关闭' },
        dndEnd: { type: 'string', example: '08:00', description: '结束时间（HH:mm格式）' },
      },
    },
  })
  async updateDNDSettings(@Body() body: { dndStart?: string | null; dndEnd?: string | null }) {
    const userId = this.ctx.state.user.userId;
    const settings = await this.notificationSettingsService.updateDNDSettings(
      userId,
      body.dndStart || null,
      body.dndEnd || null
    );
    return successResponse({ dndStart: settings.dndStart, dndEnd: settings.dndEnd });
  }

  // ==================== 哭声检测通知 ====================

  /**
   * 更新哭声检测通知设置
   */
  @Put('/settings/crying')
  @ApiOperation({
    summary: '设置哭声检测通知',
    description: '设置哭声检测和哭声识别通知开关',
  })
  @ApiResponse({
    status: 200,
    description: '设置成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '设置已更新' },
      },
    },
  })
  @ApiBody({
    description: '哭声检测通知设置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        detectionEnabled: {
          type: 'boolean',
          description: '哭声检测通知开关',
          example: true,
        },
        recognitionEnabled: {
          type: 'boolean',
          description: '哭声识别通知开关',
          example: true,
        },
        cryingTypesMask: {
          type: 'number',
          description: '哭声类型位掩码（bit 0: 饿了, bit 1: 求抱抱, bit 2: 换尿布, bit 3: 困了, bit 4: 胀气）',
          example: 31,
        },
      },
    },
  })
  async updateCryingSettings(@Body() body: {
    detectionEnabled?: boolean;
    recognitionEnabled?: boolean;
    cryingTypesMask?: number;
  }) {
    const userId = this.ctx.state.user.userId;
    await this.notificationSettingsService.updateCryingSettings(
      userId,
      body.detectionEnabled,
      body.recognitionEnabled,
      body.cryingTypesMask
    );
    return successResponse(undefined, '设置已更新');
  }

  // ==================== 温湿度告警 ====================

  /**
   * 更新温湿度告警设置
   */
  @Put('/settings/temperature-humidity')
  @ApiOperation({
    summary: '设置温湿度告警',
    description: '设置温度和湿度异常告警的阈值',
  })
  @ApiResponse({
    status: 200,
    description: '设置成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '设置已更新' },
      },
    },
  })
  @ApiBody({
    description: '温湿度告警设置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        tempAlertEnabled: { type: 'boolean', example: true },
        tempMin: { type: 'number', example: 18, minimum: 0, maximum: 50 },
        tempMax: { type: 'number', example: 28, minimum: 0, maximum: 50 },
        humidityAlertEnabled: { type: 'boolean', example: true },
        humidityMin: { type: 'number', example: 30, minimum: 0, maximum: 100 },
        humidityMax: { type: 'number', example: 70, minimum: 0, maximum: 100 },
      },
    },
  })
  async updateTempHumiditySettings(@Body() body: {
    tempAlertEnabled?: boolean;
    tempMin?: number;
    tempMax?: number;
    humidityAlertEnabled?: boolean;
    humidityMin?: number;
    humidityMax?: number;
  }) {
    const userId = this.ctx.state.user.userId;

    // 参数校验
    if (body.tempMin !== undefined && (body.tempMin < 0 || body.tempMin > 50)) {
      return errorResponse(ErrorCode.INVALID_PARAMS, '温度下限必须在0-50之间');
    }
    if (body.tempMax !== undefined && (body.tempMax < 0 || body.tempMax > 50)) {
      return errorResponse(ErrorCode.INVALID_PARAMS, '温度上限必须在0-50之间');
    }
    if (body.humidityMin !== undefined && (body.humidityMin < 0 || body.humidityMin > 100)) {
      return errorResponse(ErrorCode.INVALID_PARAMS, '湿度下限必须在0-100之间');
    }
    if (body.humidityMax !== undefined && (body.humidityMax < 0 || body.humidityMax > 100)) {
      return errorResponse(ErrorCode.INVALID_PARAMS, '湿度上限必须在0-100之间');
    }

    await this.notificationSettingsService.updateTempHumiditySettings(
      userId,
      body.tempAlertEnabled,
      body.tempMin,
      body.tempMax,
      body.humidityAlertEnabled,
      body.humidityMin,
      body.humidityMax
    );

    return successResponse(undefined, '设置已更新');
  }

  // ==================== 自动安抚 ====================

  /**
   * 更新自动安抚设置
   */
  @Put('/settings/auto-soothing')
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
        message: { type: 'string', example: '设置已更新' },
      },
    },
  })
  @ApiBody({
    description: '自动安抚设置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', example: true },
        musicId: { type: 'string', example: 'wn-1' },
        maxDuration: { type: 'number', example: 300000 },
      },
      required: ['enabled'],
    },
  })
  async updateAutoSoothingSettings(@Body() body: {
    enabled: boolean;
    musicId?: string;
    maxDuration?: number;
  }) {
    const userId = this.ctx.state.user.userId;
    await this.notificationSettingsService.updateAutoSoothingSettings(
      userId,
      body.enabled,
      body.musicId,
      body.maxDuration
    );
    return successResponse(undefined, '设置已更新');
  }

  // ==================== 电子围栏 ====================

  /**
   * 更新电子围栏设置
   */
  @Put('/settings/geofence')
  @ApiOperation({
    summary: '设置电子围栏',
    description: '设置电子围栏告警开关和半径',
  })
  @ApiResponse({
    status: 200,
    description: '设置成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '设置已更新' },
      },
    },
  })
  @ApiBody({
    description: '电子围栏设置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', example: true },
        radius: { type: 'number', example: 100, minimum: 10, maximum: 1000 },
      },
      required: ['enabled'],
    },
  })
  async updateGeofenceSettings(@Body() body: {
    enabled: boolean;
    radius?: number;
  }) {
    const userId = this.ctx.state.user.userId;

    if (body.radius !== undefined && (body.radius < 10 || body.radius > 1000)) {
      return errorResponse(ErrorCode.INVALID_PARAMS, '围栏半径必须在10-1000米之间');
    }

    await this.notificationSettingsService.updateGeofenceSettings(
      userId,
      body.enabled,
      body.radius
    );

    return successResponse(undefined, '设置已更新');
  }

  // ==================== 通知铃声 ====================

  /**
   * 获取可用的通知铃声列表
   */
  @Get('/ringtones')
  @ApiOperation({
    summary: '获取通知铃声列表',
    description: '获取系统可用的通知铃声',
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
            ringtones: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: 'default' },
                  name: { type: 'string', example: '默认铃声' },
                  url: { type: 'string', example: 'https://cdn.example.com/ringtones/default.mp3' },
                  duration: { type: 'number', example: 2000 },
                },
              },
            },
          },
        },
      },
    },
  })
  async getRingtones() {
    // 返回预设的铃声列表
    const ringtones = [
      { id: 'default', name: '默认铃声', url: 'https://cdn.example.com/ringtones/default.mp3', duration: 2000 },
      { id: 'gentle', name: '柔和提示', url: 'https://cdn.example.com/ringtones/gentle.mp3', duration: 1500 },
      { id: 'alert', name: '紧急提醒', url: 'https://cdn.example.com/ringtones/alert.mp3', duration: 3000 },
      { id: 'lullaby', name: '摇篮曲', url: 'https://cdn.example.com/ringtones/lullaby.mp3', duration: 4000 },
    ];

    return successResponse({ ringtones });
  }

  /**
   * 更新通知铃声设置
   */
  @Put('/settings/ringtone')
  @ApiOperation({
    summary: '设置通知铃声',
    description: '设置通知铃声和音量',
  })
  @ApiResponse({
    status: 200,
    description: '设置成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '铃声已更新' },
      },
    },
  })
  @ApiBody({
    description: '铃声设置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        ringtoneId: { type: 'string', example: 'gentle' },
        volume: { type: 'number', example: 80, minimum: 0, maximum: 100 },
        vibrationEnabled: { type: 'boolean', example: true },
      },
    },
  })
  async updateRingtoneSettings(@Body() body: {
    ringtoneId?: string;
    volume?: number;
    vibrationEnabled?: boolean;
  }) {
    const userId = this.ctx.state.user.userId;

    if (body.volume !== undefined && (body.volume < 0 || body.volume > 100)) {
      return errorResponse(ErrorCode.INVALID_PARAMS, '音量必须在0-100之间');
    }

    await this.notificationSettingsService.updateRingtoneSettings(
      userId,
      body.ringtoneId,
      body.volume,
      body.vibrationEnabled
    );

    return successResponse(undefined, '铃声已更新');
  }

  // ==================== 通知历史 ====================

  /**
   * 获取通知历史
   */
  @Get('/history')
  @ApiOperation({
    summary: '获取通知历史',
    description: '获取用户的通知历史记录',
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
                  type: { type: 'string' },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  isRead: { type: 'boolean' },
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
  @ApiQuery({ name: 'type', description: '通知类型', required: false })
  @ApiQuery({ name: 'deviceId', description: '设备ID', required: false })
  @ApiQuery({ name: 'isRead', description: '是否已读', required: false })
  @ApiQuery({ name: 'limit', description: '返回数量', required: false, example: 50 })
  @ApiQuery({ name: 'offset', description: '偏移量', required: false, example: 0 })
  async getHistory(@Query() query: any) {
    const userId = this.ctx.state.user.userId;
    const result = await this.notificationSettingsService.getNotificationHistory(userId, {
      type: query.type,
      deviceId: query.deviceId,
      isRead: query.isRead !== undefined ? query.isRead === 'true' : undefined,
      limit: query.limit ? parseInt(query.limit) : 50,
      offset: query.offset ? parseInt(query.offset) : 0,
    });

    return successResponse(result);
  }

  /**
   * 获取未读通知数量
   */
  @Get('/unread-count')
  @ApiOperation({
    summary: '获取未读通知数量',
    description: '获取用户的未读通知数量',
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
            count: { type: 'number', example: 5 },
          },
        },
      },
    },
  })
  async getUnreadCount() {
    const userId = this.ctx.state.user.userId;
    const count = await this.notificationSettingsService.getUnreadCount(userId);
    return successResponse({ count });
  }

  /**
   * 标记通知为已读
   */
  @Put('/history/:notificationId/read')
  @ApiOperation({
    summary: '标记通知为已读',
    description: '将指定通知标记为已读',
  })
  @ApiResponse({
    status: 200,
    description: '标记成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '已标记为已读' },
      },
    },
  })
  @ApiParam({ name: 'notificationId', description: '通知ID', example: 'notification-123' })
  async markAsRead(@Param('notificationId') notificationId: string) {
    const userId = this.ctx.state.user.userId;
    await this.notificationSettingsService.markAsRead(notificationId, userId);
    return successResponse(undefined, '已标记为已读');
  }

  /**
   * 标记所有通知为已读
   */
  @Put('/history/read-all')
  @ApiOperation({
    summary: '标记所有通知为已读',
    description: '将所有未读通知标记为已读',
  })
  @ApiResponse({
    status: 200,
    description: '标记成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '已全部标记为已读' },
      },
    },
  })
  async markAllAsRead() {
    const userId = this.ctx.state.user.userId;
    await this.notificationSettingsService.markAllAsRead(userId);
    return successResponse(undefined, '已全部标记为已读');
  }

  /**
   * 确认通知
   */
  @Put('/history/:notificationId/acknowledge')
  @ApiOperation({
    summary: '确认通知',
    description: '确认已处理该通知',
  })
  @ApiResponse({
    status: 200,
    description: '确认成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '通知已确认' },
      },
    },
  })
  @ApiParam({ name: 'notificationId', description: '通知ID', example: 'notification-123' })
  async acknowledgeNotification(@Param('notificationId') notificationId: string) {
    const userId = this.ctx.state.user.userId;
    await this.notificationSettingsService.acknowledgeNotification(notificationId, userId);
    return successResponse(undefined, '通知已确认');
  }

  /**
   * 清空通知历史
   */
  @Del('/history')
  @ApiOperation({
    summary: '清空通知历史',
    description: '清空通知历史记录',
  })
  @ApiResponse({
    status: 200,
    description: '清空成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '通知历史已清空' },
      },
    },
  })
  @ApiQuery({ name: 'beforeDate', description: '清空指定日期之前的记录', required: false })
  async clearHistory(@Query() query: { beforeDate?: string }) {
    const userId = this.ctx.state.user.userId;
    const beforeDate = query.beforeDate ? new Date(query.beforeDate) : undefined;
    await this.notificationSettingsService.clearHistory(userId, beforeDate);
    return successResponse(undefined, '通知历史已清空');
  }

  // ==================== 哭声识别反馈 ====================

  /**
   * 点赞通知（哭声结果）
   */
  @Post('/:notificationId/like')
  @ApiOperation({
    summary: '点赞通知',
    description: '对通知进行点赞操作，再次调用取消点赞',
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
            likeStatus: { type: 'string', enum: ['liked', 'none'], example: 'liked' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'notificationId', description: '通知ID', example: 'notification-123' })
  async likeNotification(@Param('notificationId') notificationId: string) {
    const userId = this.ctx.state.user.userId;
    try {
      const result = await this.notificationSettingsService.likeNotification(notificationId, userId);
      return successResponse(result);
    } catch (err: any) {
      if (err.message === 'NOTIFICATION_NOT_FOUND') {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '通知不存在');
      }
      throw err;
    }
  }

  /**
   * 踩通知（哭声结果）
   */
  @Post('/:notificationId/dislike')
  @ApiOperation({
    summary: '踩通知',
    description: '对通知进行踩操作，再次调用取消踩',
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
            likeStatus: { type: 'string', enum: ['disliked', 'none'], example: 'disliked' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'notificationId', description: '通知ID', example: 'notification-123' })
  async dislikeNotification(@Param('notificationId') notificationId: string) {
    const userId = this.ctx.state.user.userId;
    try {
      const result = await this.notificationSettingsService.dislikeNotification(notificationId, userId);
      return successResponse(result);
    } catch (err: any) {
      if (err.message === 'NOTIFICATION_NOT_FOUND') {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '通知不存在');
      }
      throw err;
    }
  }

  /**
   * 提交哭声识别反馈
   */
  @Post('/:notificationId/feedback')
  @ApiOperation({
    summary: '提交哭声识别反馈',
    description: '手动选择哭声识别结果（5种类型）并可选填写300字反馈',
  })
  @ApiResponse({
    status: 200,
    description: '提交成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '反馈已提交' },
      },
    },
  })
  @ApiParam({ name: 'notificationId', description: '通知ID', example: 'notification-123' })
  @ApiBody({
    description: '识别反馈',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        feedbackType: {
          type: 'string',
          enum: ['hungry', 'hold', 'diaper', 'sleepy', 'gas'],
          description: '哭声类型：hungry=饿了, hold=求抱抱, diaper=换尿布, sleepy=困了, gas=胀气',
        },
        feedbackText: {
          type: 'string',
          maxLength: 300,
          description: '补充说明（可选，最长300字）',
        },
      },
      required: ['feedbackType'],
    },
  })
  async submitNotificationFeedback(
    @Param('notificationId') notificationId: string,
    @Body() body: { feedbackType: string; feedbackText?: string }
  ) {
    const userId = this.ctx.state.user.userId;

    const validTypes = ['hungry', 'hold', 'diaper', 'sleepy', 'gas'];
    if (!validTypes.includes(body.feedbackType)) {
      return errorResponse(ErrorCode.INVALID_PARAMS, '无效的哭声类型，可选值：hungry/hold/diaper/sleepy/gas');
    }
    if (body.feedbackText && body.feedbackText.length > 300) {
      return errorResponse(ErrorCode.INVALID_PARAMS, '反馈文本不能超过300字');
    }

    try {
      await this.notificationSettingsService.submitNotificationFeedback(
        notificationId, userId, body.feedbackType, body.feedbackText
      );
      return successResponse(undefined, '反馈已提交');
    } catch (err: any) {
      if (err.message === 'NOTIFICATION_NOT_FOUND') {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '通知不存在');
      }
      throw err;
    }
  }

  // ==================== 通知删除 ====================

  /**
   * 批量删除通知（软删除）
   * 必须定义在 :notificationId 之前，否则 batch 会被路径参数捕获
   */
  @Del('/history/batch')
  @ApiOperation({
    summary: '批量删除通知',
    description: '编辑态批量删除通知（软删除）',
  })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            deletedCount: { type: 'number', example: 5 },
          },
        },
      },
    },
  })
  @ApiBody({
    description: '要删除的通知ID列表',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        notificationIds: {
          type: 'array',
          items: { type: 'string' },
          description: '通知ID数组',
          example: ['notification-1', 'notification-2'],
        },
      },
      required: ['notificationIds'],
    },
  })
  async batchDeleteNotifications(@Body() body: { notificationIds: string[] }) {
    const userId = this.ctx.state.user.userId;

    if (!Array.isArray(body.notificationIds) || body.notificationIds.length === 0) {
      return errorResponse(ErrorCode.INVALID_PARAMS, '请提供要删除的通知ID列表');
    }
    if (body.notificationIds.length > 100) {
      return errorResponse(ErrorCode.INVALID_PARAMS, '单次最多删除100条通知');
    }

    const deletedCount = await this.notificationSettingsService.batchDeleteNotifications(
      body.notificationIds, userId
    );
    return successResponse({ deletedCount });
  }

  /**
   * 删除单条通知（软删除）
   */
  @Del('/history/:notificationId')
  @ApiOperation({
    summary: '删除单条通知',
    description: '左滑删除单条通知（软删除）',
  })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '通知已删除' },
      },
    },
  })
  @ApiParam({ name: 'notificationId', description: '通知ID', example: 'notification-123' })
  async deleteNotification(@Param('notificationId') notificationId: string) {
    const userId = this.ctx.state.user.userId;
    try {
      await this.notificationSettingsService.deleteNotification(notificationId, userId);
      return successResponse(undefined, '通知已删除');
    } catch (err: any) {
      if (err.message === 'NOTIFICATION_NOT_FOUND') {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '通知不存在');
      }
      throw err;
    }
  }
}
