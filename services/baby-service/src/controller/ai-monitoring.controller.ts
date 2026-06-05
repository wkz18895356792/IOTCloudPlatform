import { Controller, Post, Get, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import {
  successResponse,
  errorResponse,
  ErrorCode,
} from '@baby-monitor/shared-types';
import {
  AIMonitoringService,
  AIEventType,
  AIEventPriority,
  AIEventStatus,
  AIEvent,
  AIDetectionConfig,
  VideoFrame,
  AudioData,
} from '../service/ai-monitoring.service';

/**
 * AI 监控控制器
 *
 * 提供婴儿AI监控功能的所有API接口
 */
@ApiTags('AI监控')
@Controller('/api/babies')
export class AIMonitoringController {
  @Inject()
  ctx!: Context;

  @Inject()
  aiMonitoringService!: AIMonitoringService;

  // ==================== 配置管理 ====================

  /**
   * 获取AI检测配置
   */
  @Get('/:babyId/ai/config')
  @ApiOperation({
    summary: '获取AI检测配置',
    description: '获取指定宝宝的AI检测配置',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  async getAIConfig(@Param('babyId') babyId: string) {
    try {
      const config = await this.aiMonitoringService.getDetectionConfig(babyId);

      return successResponse(config);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取配置失败');
    }
  }

  /**
   * 设置AI检测配置
   */
  @Put('/:babyId/ai/config')
  @ApiOperation({
    summary: '设置AI检测配置',
    description: '更新指定宝宝的AI检测配置',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiBody({
    description: 'AI检测配置',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        cryingDetection: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            sensitivity: { type: 'number', minimum: 0, maximum: 100 },
            minDuration: { type: 'number' },
            audioThreshold: { type: 'number' },
            quietPeriod: { type: 'number' },
          },
        },
        motionDetection: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            sensitivity: { type: 'number', minimum: 0, maximum: 100 },
            minMotionArea: { type: 'number' },
            noMotionTimeout: { type: 'number' },
            detectionZones: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  zoneId: { type: 'string' },
                  name: { type: 'string' },
                  coordinates: {
                    type: 'object',
                    properties: {
                      x: { type: 'number' },
                      y: { type: 'number' },
                      width: { type: 'number' },
                      height: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
        faceDetection: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            confidenceThreshold: { type: 'number', minimum: 0, maximum: 100 },
            recognizeFaces: { type: 'boolean' },
            maxFaces: { type: 'number' },
          },
        },
        tempHumidityDetection: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            tempHigh: { type: 'number' },
            tempLow: { type: 'number' },
            humidityHigh: { type: 'number' },
            humidityLow: { type: 'number' },
            anomalyDetection: { type: 'boolean' },
          },
        },
        sleepPositionDetection: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            unsafePositions: {
              type: 'array',
              items: { type: 'string' },
            },
            positionChangeAlert: { type: 'boolean' },
          },
        },
        breathingDetection: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            normalRange: {
              type: 'object',
              properties: {
                min: { type: 'number' },
                max: { type: 'number' },
              },
            },
            apneaThreshold: { type: 'number' },
          },
        },
      },
    },
  })
  async setAIConfig(@Param('babyId') babyId: string, @Body() config: AIDetectionConfig) {
    try {
      await this.aiMonitoringService.setDetectionConfig(babyId, config);

      return successResponse(undefined, '配置已更新');
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '更新配置失败');
    }
  }

  // ==================== 哭声检测 ====================

  /**
   * 检测哭声
   */
  @Post('/:babyId/ai/crying/detect')
  @ApiOperation({
    summary: '检测哭声',
    description: '分析音频数据，检测是否有哭声',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiBody({
    description: '音频数据',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        audioId: { type: 'string' },
        audioUrl: { type: 'string' },
        audioBase64: { type: 'string' },
        duration: { type: 'number' },
        sampleRate: { type: 'number' },
      },
      required: ['deviceId'],
    },
  })
  async detectCrying(@Param('babyId') babyId: string, @Body() audioData: AudioData) {
    try {
      const config = await this.aiMonitoringService.getDetectionConfig(babyId);
      const results = await this.aiMonitoringService.detectCrying(
        babyId,
        audioData.deviceId,
        audioData,
        config?.cryingDetection
      );

      return successResponse({ results });
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '检测失败');
    }
  }

  // ==================== 移动检测 ====================

  /**
   * 检测移动
   */
  @Post('/:babyId/ai/motion/detect')
  @ApiOperation({
    summary: '检测移动',
    description: '分析视频帧，检测是否有移动',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiBody({
    description: '视频帧数据',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        frameId: { type: 'string' },
        imageUrl: { type: 'string' },
        imageBase64: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['deviceId'],
    },
  })
  async detectMotion(@Param('babyId') babyId: string, @Body() frame: VideoFrame) {
    try {
      const config = await this.aiMonitoringService.getDetectionConfig(babyId);
      const results = await this.aiMonitoringService.detectMotion(
        babyId,
        frame.deviceId,
        frame,
        config?.motionDetection
      );

      // 更新最后移动时间
      if (results.some(r => r.eventType === AIEventType.MOTION_DETECTED)) {
        await this.aiMonitoringService.updateLastMotionTime(babyId, frame.deviceId);
      }

      return successResponse({ results });
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '检测失败');
    }
  }

  // ==================== 人脸检测 ====================

  /**
   * 检测人脸
   */
  @Post('/:babyId/ai/faces/detect')
  @ApiOperation({
    summary: '检测人脸',
    description: '分析视频帧，检测人脸',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiBody({
    description: '视频帧数据',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        frameId: { type: 'string' },
        imageUrl: { type: 'string' },
        imageBase64: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['deviceId'],
    },
  })
  async detectFaces(@Param('babyId') babyId: string, @Body() frame: VideoFrame) {
    try {
      const config = await this.aiMonitoringService.getDetectionConfig(babyId);
      const results = await this.aiMonitoringService.detectFaces(
        babyId,
        frame.deviceId,
        frame,
        config?.faceDetection
      );

      return successResponse({ results });
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '检测失败');
    }
  }

  /**
   * 注册人脸
   */
  @Post('/:babyId/ai/faces/register')
  @ApiOperation({
    summary: '注册人脸',
    description: '注册宝宝的人脸用于识别',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiBody({
    description: '人脸注册数据',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        frameId: { type: 'string' },
        imageUrl: { type: 'string' },
        faceName: { type: 'string' },
      },
      required: ['deviceId', 'faceName'],
    },
  })
  async registerFace(@Param('babyId') babyId: string, @Body() body: {
    deviceId: string;
    frameId?: string;
    imageUrl?: string;
    imageBase64?: string;
    faceName: string;
  }) {
    try {
      const result = await this.aiMonitoringService.registerFace(
        babyId,
        body.deviceId,
        {
          frameId: body.frameId,
          imageUrl: body.imageUrl,
          imageBase64: body.imageBase64,
          faceName: body.faceName,
        }
      );

      if (!result.success) {
        return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, result.error || '注册失败');
      }

      return successResponse({
        faceId: result.faceId,
        confidence: result.confidence,
      }, '人脸已注册');
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '注册失败');
    }
  }

  // ==================== 温湿度检测 ====================

  /**
   * 检测温湿度异常
   */
  @Post('/:babyId/ai/temphumidity/check')
  @ApiOperation({
    summary: '检测温湿度',
    description: '检测温度和湿度是否异常',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiBody({
    description: '温湿度数据',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        temperature: { type: 'number' },
        humidity: { type: 'number' },
      },
      required: ['deviceId', 'temperature', 'humidity'],
    },
  })
  async detectTempHumidity(
    @Param('babyId') babyId: string,
    @Body() body: {
      deviceId: string;
      temperature: number;
      humidity: number;
    }
  ) {
    try {
      const config = await this.aiMonitoringService.getDetectionConfig(babyId);
      const results = await this.aiMonitoringService.detectTempHumidityAnomaly(
        babyId,
        body.deviceId,
        body.temperature,
        body.humidity,
        config?.tempHumidityDetection
      );

      // 更新基线数据
      if (config?.tempHumidityDetection?.enabled) {
        await this.aiMonitoringService.updateBaselineData(
          babyId,
          body.deviceId,
          'temperature',
          body.temperature
        );
        await this.aiMonitoringService.updateBaselineData(
          babyId,
          body.deviceId,
          'humidity',
          body.humidity
        );
      }

      return successResponse({ results });
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '检测失败');
    }
  }

  // ==================== AI事件管理 ====================

  /**
   * 获取活跃的AI事件
   */
  @Get('/:babyId/ai/events/active')
  @ApiOperation({
    summary: '获取活跃事件',
    description: '获取当前活跃（未解决）的AI事件',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  async getActiveEvents(@Param('babyId') babyId: string) {
    try {
      const events = await this.aiMonitoringService.getActiveEvents(babyId);

      return successResponse({ events });
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取事件失败');
    }
  }

  /**
   * 获取事件历史
   */
  @Get('/:babyId/ai/events/history')
  @ApiOperation({
    summary: '获取事件历史',
    description: '获取指定时间段的AI事件历史',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'startDate', description: '开始日期 (ISO 8601)', required: true })
  @ApiQuery({ name: 'endDate', description: '结束日期 (ISO 8601)', required: true })
  @ApiQuery({ name: 'eventType', description: '事件类型', required: false })
  async getEventHistory(
    @Param('babyId') babyId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('eventType') eventType?: AIEventType
  ) {
    try {
      const events = await this.aiMonitoringService.getEventHistory(
        babyId,
        new Date(startDate),
        new Date(endDate),
        eventType
      );

      return successResponse({ events });
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取历史失败');
    }
  }

  /**
   * 确认AI事件
   */
  @Post('/ai/events/:eventId/acknowledge')
  @ApiOperation({
    summary: '确认事件',
    description: '确认指定的AI事件，标记为已处理',
  })
  @ApiParam({ name: 'eventId', description: '事件ID', example: 'event-123' })
  async acknowledgeAIEvent(
    @Param('eventId') eventId: string,
    @Body() body: { userId?: string }
  ) {
    try {
      const userId = body.userId || this.ctx.state.user?.userId || 'admin';
      const event = await this.aiMonitoringService.acknowledgeAIEvent(eventId, userId);

      if (!event) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '事件不存在');
      }

      return successResponse(event, '事件已确认');
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '确认失败');
    }
  }

  /**
   * 解决AI事件
   */
  @Post('/ai/events/:eventId/resolve')
  @ApiOperation({
    summary: '解决事件',
    description: '解决指定的AI事件，标记为已处理',
  })
  @ApiParam({ name: 'eventId', description: '事件ID', example: 'event-123' })
  async resolveAIEvent(
    @Param('eventId') eventId: string,
    @Body() body: { userId?: string }
  ) {
    try {
      const userId = body.userId || this.ctx.state.user?.userId || 'admin';
      const event = await this.aiMonitoringService.resolveAIEvent(eventId, userId);

      if (!event) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '事件不存在');
      }

      return successResponse(event, '事件已解决');
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '解决失败');
    }
  }

  // ==================== AI分析报告 ====================

  /**
   * 获取AI分析报告
   */
  @Get('/:babyId/ai/analytics/report')
  @ApiOperation({
    summary: '获取AI分析报告',
    description: '获取宝宝的AI监控分析报告',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'startDate', description: '开始日期 (ISO 8601)', required: true })
  @ApiQuery({ name: 'endDate', description: '结束日期 (ISO 8601)', required: true })
  async getAIAnalyticsReport(
    @Param('babyId') babyId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string
  ) {
    try {
      // 获取事件历史
      const events = await this.aiMonitoringService.getEventHistory(
        babyId,
        new Date(startDate),
        new Date(endDate)
      );

      // 生成分析报告
      const report = this.generateAIReport(events);

      return successResponse(report);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '生成报告失败');
    }
  }

  /**
   * 生成AI分析报告
   */
  private generateAIReport(events: AIEvent[]): {
    period: { startDate: Date; endDate: Date };
    summary: {
      totalEvents: number;
      eventsByType: Record<string, number>;
      eventsByPriority: Record<string, number>;
      resolvedCount: number;
      avgResponseTime: number;
    };
    recommendations: string[];
  } {
    // 按类型统计事件
    const eventsByType = new Map<AIEventType, number>();
    const eventsByPriority = new Map<AIEventPriority, number>();

    for (const event of events) {
      eventsByType.set(event.eventType, (eventsByType.get(event.eventType) || 0) + 1);
      eventsByPriority.set(event.priority, (eventsByPriority.get(event.priority) || 0) + 1);
    }

    // 计算平均响应时间
    const resolvedEvents = events.filter(e => e.status === AIEventStatus.RESOLVED);
    const avgResponseTime = resolvedEvents.length > 0
      ? resolvedEvents.reduce((sum, e) => sum + (e.duration || 0), 0) / resolvedEvents.length
      : 0;

    // 生成建议
    const recommendations = this.generateRecommendations(eventsByType, eventsByPriority);

    return {
      period: {
        startDate: events.length > 0 ? events[events.length - 1].timestamp : new Date(),
        endDate: events.length > 0 ? events[0].timestamp : new Date(),
      },
      summary: {
        totalEvents: events.length,
        eventsByType: Object.fromEntries(eventsByType),
        eventsByPriority: Object.fromEntries(eventsByPriority),
        resolvedCount: resolvedEvents.length,
        avgResponseTime,
      },
      recommendations,
    };
  }

  /**
   * 生成建议
   */
  private generateRecommendations(
    eventsByType: Map<AIEventType, number>,
    eventsByPriority: Map<AIEventPriority, number>
  ): string[] {
    const recommendations: string[] = [];

    // 根据事件类型生成建议
    const cryingCount = eventsByType.get(AIEventType.CRYING_DETECTED) || 0;
    if (cryingCount > 10) {
      recommendations.push('检测到频繁哭闹，建议检查宝宝的身体状况或环境舒适度');
    }

    const motionCount = eventsByType.get(AIEventType.MOTION_DETECTED) || 0;
    if (motionCount > 50) {
      recommendations.push('宝宝夜间活动频繁，建议检查睡眠环境');
    }

    const noMotionCount = eventsByType.get(AIEventType.NO_MOTION) || 0;
    if (noMotionCount > 5) {
      recommendations.push('检测到长时间无移动，建议检查宝宝状况');
    }

    const tempHighCount = eventsByType.get(AIEventType.TEMP_HIGH) || 0;
    if (tempHighCount > 5) {
      recommendations.push('检测到多次高温，建议调节室温或减少衣物');
    }

    const unsafePositionCount = eventsByType.get(AIEventType.UNSAFE_POSITION) || 0;
    if (unsafePositionCount > 3) {
      recommendations.push('检测到不安全睡姿，建议调整睡姿');
    }

    // 根据事件优先级生成建议
    const criticalCount = eventsByPriority.get(AIEventPriority.CRITICAL) || 0;
    if (criticalCount > 0) {
      recommendations.push('检测到紧急事件，请立即关注宝宝状况');
    }

    const highCount = eventsByPriority.get(AIEventPriority.HIGH) || 0;
    if (highCount > 5) {
      recommendations.push('高优先级事件较多，建议检查监控设置');
    }

    if (recommendations.length === 0) {
      recommendations.push('AI监控正常，请继续保持关注');
    }

    return recommendations;
  }

  // ==================== AI统计 ====================

  /**
   * 获取AI统计数据
   */
  @Get('/:babyId/ai/stats')
  @ApiOperation({
    summary: '获取AI统计',
    description: '获取AI监控的统计数据',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'period', description: '统计周期', enum: ['day', 'week', 'month'], required: false, example: 'week' })
  async getAIStats(
    @Param('babyId') babyId: string,
    @Query('period') period: 'day' | 'week' | 'month' = 'week'
  ) {
    try {
      const endDate = new Date();
      const startDate = new Date();

      switch (period) {
        case 'day':
          startDate.setDate(startDate.getDate() - 1);
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
      }

      const events = await this.aiMonitoringService.getEventHistory(
        babyId,
        startDate,
        endDate
      );

      // 计算统计数据
      const stats = {
        period: { period, startDate, endDate },
        totalEvents: events.length,
        byType: this.countByType(events),
        byPriority: this.countByPriority(events),
        averageResponseTime: this.calculateAvgResponseTime(events),
        topDevices: this.getTopDevices(events),
        hourlyDistribution: this.getHourlyDistribution(events),
      };

      return successResponse(stats);
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取统计失败');
    }
  }

  /**
   * 按类型计数
   */
  private countByType(events: AIEvent[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const event of events) {
      counts[event.eventType] = (counts[event.eventType] || 0) + 1;
    }

    return counts;
  }

  /**
   * 按优先级计数
   */
  private countByPriority(events: AIEvent[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const event of events) {
      counts[event.priority] = (counts[event.priority] || 0) + 1;
    }

    return counts;
  }

  /**
   * 计算平均响应时间
   */
  private calculateAvgResponseTime(events: AIEvent[]): number {
    const resolvedEvents = events.filter(e => e.status === AIEventStatus.RESOLVED && e.duration);

    if (resolvedEvents.length === 0) return 0;

    const total = resolvedEvents.reduce((sum, e) => sum + (e.duration || 0), 0);
    return total / resolvedEvents.length;
  }

  /**
   * 获取事件最多的设备
   */
  private getTopDevices(events: AIEvent[]): Array<{ deviceId: string; count: number }> {
    const deviceCounts = new Map<string, number>();

    for (const event of events) {
      deviceCounts.set(event.deviceId, (deviceCounts.get(event.deviceId) || 0) + 1);
    }

    return Array.from(deviceCounts.entries())
      .map(([deviceId, count]) => ({ deviceId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * 获取小时分布
   */
  private getHourlyDistribution(events: AIEvent[]): number[] {
    const distribution = new Array(24).fill(0);

    for (const event of events) {
      const hour = event.timestamp.getHours();
      distribution[hour]++;
    }

    return distribution;
  }

  // ==================== 批量操作 ====================

  /**
   * 批量检测
   */
  @Post('/:babyId/ai/batch/detect')
  @ApiOperation({
    summary: '批量AI检测',
    description: '对多个音频和视频帧进行AI检测',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiBody({
    description: '批量检测数据',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        audioSamples: {
          type: 'array',
          items: { type: 'object' },
        },
        videoFrames: {
          type: 'array',
          items: { type: 'object' },
        },
        tempHumidityReadings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              deviceId: { type: 'string' },
              temperature: { type: 'number' },
              humidity: { type: 'number' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  async batchDetect(@Param('babyId') babyId: string, @Body() body: {
    audioSamples?: AudioData[];
    videoFrames?: VideoFrame[];
    tempHumidityReadings?: Array<{
      deviceId: string;
      temperature: number;
      humidity: number;
      timestamp: string;
    }>;
  }) {
    try {
      const config = await this.aiMonitoringService.getDetectionConfig(babyId);
      const allResults: any[] = [];

      // 检测哭声
      if (body.audioSamples && config?.cryingDetection?.enabled) {
        for (const audio of body.audioSamples) {
          const results = await this.aiMonitoringService.detectCrying(
            babyId,
            audio.deviceId,
            audio,
            config.cryingDetection
          );
          allResults.push(...results);
        }
      }

      // 检测移动
      if (body.videoFrames && config?.motionDetection?.enabled) {
        for (const frame of body.videoFrames) {
          const results = await this.aiMonitoringService.detectMotion(
            babyId,
            frame.deviceId,
            frame,
            config.motionDetection
          );
          allResults.push(...results);
        }
      }

      // 检测人脸
      if (body.videoFrames && config?.faceDetection?.enabled) {
        for (const frame of body.videoFrames) {
          const results = await this.aiMonitoringService.detectFaces(
            babyId,
            frame.deviceId,
            frame,
            config.faceDetection
          );
          allResults.push(...results);
        }
      }

      // 检测温湿度
      if (body.tempHumidityReadings && config?.tempHumidityDetection?.enabled) {
        for (const reading of body.tempHumidityReadings) {
          const results = await this.aiMonitoringService.detectTempHumidityAnomaly(
            babyId,
            reading.deviceId,
            reading.temperature,
            reading.humidity,
            config.tempHumidityDetection
          );
          allResults.push(...results);
        }
      }

      return successResponse({
        totalResults: allResults.length,
        results: allResults,
      });
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '批量检测失败');
    }
  }

  // ==================== 设置和建议 ====================

  /**
   * 获取AI设置建议
   */
  @Get('/:babyId/ai/recommendations')
  @ApiOperation({
    summary: '获取AI设置建议',
    description: '根据宝宝年龄和季节等获取AI监控设置建议',
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'ageMonths', description: '宝宝年龄（月）', required: false })
  async getAIRecommendations(@Param('babyId') babyId: string, @Query('ageMonths') ageMonths?: number) {
    try {
      // 获取当前配置
      const currentConfig = await this.aiMonitoringService.getDetectionConfig(babyId);

      // 根据年龄生成建议
      const recommendations = {
        ageRange: this.getAgeRange(ageMonths),
        suggestedConfig: this.getSuggestedConfig(ageMonths),
        explanations: this.getExplanation(ageMonths),
      };

      return successResponse({
        currentConfig,
        recommendations,
      });
    } catch (error: any) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取建议失败');
    }
  }

  /**
   * 获取年龄范围
   */
  private getAgeRange(ageMonths?: number): string {
    if (!ageMonths) return '未知';

    if (ageMonths < 6) {
      return '新生儿期 (0-6个月)';
    } else if (ageMonths < 12) {
      return '婴儿期 (6-12个月)';
    } else if (ageMonths < 36) {
      return '幼儿期 (1-3岁)';
    } else {
      return '学龄前期 (3-6岁)';
    }
  }

  /**
   * 获取建议配置
   */
  private getSuggestedConfig(ageMonths?: number): Partial<AIDetectionConfig> {
    if (!ageMonths) {
      return {};
    }

    const baseConfig: Partial<AIDetectionConfig> = {
      cryingDetection: {
        enabled: true,
        sensitivity: ageMonths < 6 ? 80 : 70,
        minDuration: ageMonths < 6 ? 3 : 5,
        audioThreshold: ageMonths < 6 ? 40 : 50,
        quietPeriod: 10,
      },
      motionDetection: {
        enabled: true,
        sensitivity: ageMonths < 12 ? 60 : 50,
        minMotionArea: ageMonths < 12 ? 50 : 100,
        noMotionTimeout: ageMonths < 6 ? 600 : 300, // 10分钟或5分钟
      },
      tempHumidityDetection: {
        enabled: true,
        tempHigh: ageMonths < 6 ? 37.5 : 37,
        tempLow: ageMonths < 6 ? 36 : 36,
        humidityHigh: 70,
        humidityLow: 30,
        anomalyDetection: true,
      },
      faceDetection: {
        enabled: false, // 默认关闭
        confidenceThreshold: 80,
        recognizeFaces: false,
        maxFaces: 3,
        faceRegistration: {
          enabled: false,
          knownFaces: new Map<string, string>(),
        },
      },
      sleepPositionDetection: {
        enabled: ageMonths < 12, // 1岁以下启用
        unsafePositions: ['stomach'],
        positionChangeAlert: true,
      },
      breathingDetection: {
        enabled: ageMonths < 12, // 1岁以下启用
        normalRange: {
          min: ageMonths < 6 ? 30 : 25,
          max: ageMonths < 6 ? 60 : 50,
        },
        apneaThreshold: 20,
      },
    };

    return baseConfig;
  }

  /**
   * 获取配置说明
   */
  private getExplanation(ageMonths?: number): string[] {
    const explanations: string[] = [];

    if (!ageMonths) {
      explanations.push('请先设置宝宝的年龄以获得个性化建议');
      return explanations;
    }

    explanations.push(`宝宝年龄：${ageMonths}个月`);

    if (ageMonths < 6) {
      explanations.push('新生儿期特点：睡眠时间长，需要特别关注体温和呼吸');
      explanations.push('建议：启用哭声、移动、温湿度、睡姿和呼吸检测');
    } else if (ageMonths < 12) {
      explanations.push('婴儿期特点：开始探索，活动量增加');
      explanations.push('建议：重点关注哭声检测和移动监控');
    } else {
      explanations.push('幼儿期特点：活动量较大，好奇心强');
      explanations.push('建议：重点监控安全和区域活动');
    }

    return explanations;
  }

  // ==================== 系统状态 ====================

  /**
   * 获取AI服务状态
   */
  @Get('/ai/system/status')
  @ApiOperation({
    summary: '获取AI服务状态',
    description: '获取AI监控服务的系统状态',
  })
  async getSystemStatus() {
    const status = {
      service: 'AI Monitoring Service',
      status: 'running',
      version: '1.0.0',
      features: {
        cryingDetection: true,
        motionDetection: true,
        faceDetection: true,
        tempHumidityDetection: true,
        sleepPositionDetection: false,
        breathingDetection: false,
      },
      providers: {
        aws: 'enabled',
        tencent: 'available',
        ali: 'available',
        customML: 'available',
      },
    };

    return successResponse(status);
  }

  /**
   * 获取支持的AI功能
   */
  @Get('/ai/features')
  @ApiOperation({
    summary: '获取支持的AI功能',
    description: '获取所有支持的AI监控功能列表',
  })
  async getSupportedFeatures() {
    const features = [
      {
        id: 'crying_detection',
        name: '哭声检测',
        description: '通过音频分析检测宝宝哭声',
        enabled: true,
        icon: '🔊',
        category: 'audio',
      },
      {
        id: 'motion_detection',
        name: '移动检测',
        description: '通过视频分析检测宝宝移动',
        enabled: true,
        icon: '📹',
        category: 'video',
      },
      {
        id: 'face_detection',
        name: '人脸检测',
        description: '检测视频中的人脸',
        enabled: true,
        icon: '👶',
        category: 'video',
      },
      {
        id: 'face_recognition',
        name: '人脸识别',
        description: '识别已注册的人脸',
        enabled: false,
        icon: '👤',
        category: 'video',
      },
      {
        id: 'temp_humidity_detection',
        name: '温湿度检测',
        description: '检测温度和湿度异常',
        enabled: true,
        icon: '🌡️',
        category: 'sensor',
      },
      {
        id: 'sleep_position_detection',
        name: '睡姿检测',
        description: '检测不安全的睡眠姿势',
        enabled: false,
        icon: '🛏️',
        category: 'video',
      },
      {
        id: 'breathing_detection',
        name: '呼吸检测',
        description: '检测呼吸异常或暂停',
        enabled: false,
        icon: '😤',
        category: 'video',
      },
      ];

    return successResponse({ features });
  }
}
