import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { BabyLogService } from '../service/baby-log.service';
import {
  BabyLog,
  BabyLogEventType,
  BabyLogSource,
  CreateBabyLogRequest,
  UpdateBabyLogRequest,
  BabyLogQueryParams,
  successResponse,
  errorResponse,
  ErrorCode,
  PaginatedResponse,
} from '@baby-monitor/shared-types';

/**
 * 宝宝日志控制器
 *
 * 提供统一的宝宝日志管理 API，整合了喂养、睡眠、尿布、成长、健康、监控、里程碑等所有类型的日志
 */
@ApiTags('宝宝日志')
@Controller('/api/baby-logs')
export class BabyLogController {
  @Inject()
  ctx!: Context;

  @Inject()
  babyLogService!: BabyLogService;

  /**
   * 创建日志记录
   */
  @Post('/')
  @ApiOperation({ summary: '创建日志', description: '创建新的宝宝日志记录' })
  @ApiResponse({
    status: 200,
    description: '创建成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object', description: '创建的日志记录' },
      },
    },
  })
  @ApiBody({
    description: '日志数据',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        babyId: { type: 'string', description: '宝宝ID' },
        deviceId: { type: 'string', description: '设备ID（可选）' },
        eventId: { type: 'string', description: '事件唯一标识(UUID格式) - 防止重复记录（可选）' },
        eventType: {
          type: 'string',
          description: '事件类型',
          enum: Object.values(BabyLogEventType),
        },
        startTime: { type: 'string', format: 'date-time', description: '开始时间' },
        endTime: { type: 'string', format: 'date-time', description: '结束时间（可选）' },
        timezone: { type: 'string', description: '时区（可选）' },
        source: {
          type: 'string',
          enum: Object.values(BabyLogSource),
          description: '数据来源',
        },
        level: {
          type: 'string',
          enum: ['info', 'warning', 'alert', 'emergency'],
          description: '事件级别 - 主要用于监控事件（可选）',
        },
        videoPath: { type: 'string', description: 'S3视频文件存储路径（可选）' },
        videoTimestamp: { type: 'number', description: '事件在视频中的时间偏移量 - 单位秒（可选）' },
        thumbnailUrl: { type: 'string', description: '缩略图URL（可选）' },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: '算法识别置信度 - 取值范围 0-1（可选）' },
        note: { type: 'string', description: '备注（可选）' },
        metadata: { type: 'object', description: '附加信息（可选）' },
        recordedBy: { type: 'string', description: '记录人ID（可选）' },
      },
      required: ['babyId', 'eventType', 'startTime'],
    },
  })
  async createLog(@Body() data: CreateBabyLogRequest) {
    try {
      const log = await this.babyLogService.createLog(data);
      return successResponse(log);
    } catch (error: any) {
      this.ctx.logger.error('[BabyLogController] 创建日志失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '创建日志失败');
    }
  }

  /**
   * 批量创建日志记录
   */
  @Post('/batch')
  @ApiOperation({ summary: '批量创建日志', description: '批量创建宝宝日志记录' })
  @ApiResponse({
    status: 200,
    description: '创建成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: { type: 'object', description: '日志记录' },
        },
      },
    },
  })
  @ApiBody({
    description: '日志数据数组',
    required: true,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          babyId: { type: 'string', description: '宝宝ID' },
          deviceId: { type: 'string', description: '设备ID（可选）' },
          eventId: { type: 'string', description: '事件唯一标识(UUID格式) - 防止重复记录（可选）' },
          eventType: {
            type: 'string',
            description: '事件类型',
            enum: Object.values(BabyLogEventType),
          },
          startTime: { type: 'string', format: 'date-time', description: '开始时间' },
          endTime: { type: 'string', format: 'date-time', description: '结束时间（可选）' },
          timezone: { type: 'string', description: '时区（可选）' },
          source: {
            type: 'string',
            enum: Object.values(BabyLogSource),
            description: '数据来源',
          },
          level: {
            type: 'string',
            enum: ['info', 'warning', 'alert', 'emergency'],
            description: '事件级别 - 主要用于监控事件（可选）',
          },
          videoPath: { type: 'string', description: 'S3视频文件存储路径（可选）' },
          videoTimestamp: { type: 'number', description: '事件在视频中的时间偏移量 - 单位秒（可选）' },
          thumbnailUrl: { type: 'string', description: '缩略图URL（可选）' },
          confidence: { type: 'number', minimum: 0, maximum: 1, description: '算法识别置信度 - 取值范围 0-1（可选）' },
          note: { type: 'string', description: '备注（可选）' },
          metadata: { type: 'object', description: '附加信息（可选）' },
          recordedBy: { type: 'string', description: '记录人ID（可选）' },
        },
      },
    },
  })
  async createLogsBatch(@Body() logs: CreateBabyLogRequest[]) {
    try {
      const createdLogs = await this.babyLogService.createLogsBatch(logs);
      return successResponse(createdLogs);
    } catch (error: any) {
      this.ctx.logger.error('[BabyLogController] 批量创建日志失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '批量创建日志失败');
    }
  }

  /**
   * 获取日志详情
   */
  @Get('/:logId')
  @ApiOperation({ summary: '获取日志详情', description: '根据ID获取日志详情' })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object', description: '日志记录' },
      },
    },
  })
  @ApiResponse({ status: 404, description: '日志不存在' })
  @ApiParam({ name: 'logId', description: '日志ID' })
  async getLog(@Param('logId') logId: string) {
    const log = await this.babyLogService.getLog(logId);
    if (!log) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '日志不存在');
    }
    return successResponse(log);
  }

  /**
   * 查询日志列表
   */
  @Get('/')
  @ApiOperation({ summary: '查询日志列表', description: '根据条件分页查询日志列表' })
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
            items: { type: 'array', items: { type: 'object' } },
            total: { type: 'number' },
            page: { type: 'number' },
            pageSize: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiQuery({ name: 'babyId', description: '宝宝ID', required: true, example: 'baby-123' })
  @ApiQuery({
    name: 'eventTypes',
    description: '事件类型（可多个，用逗号分隔）',
    required: false,
    example: 'breast_feeding,bottle_feeding',
  })
  @ApiQuery({ name: 'startDate', description: '开始日期（ISO 8601格式）', required: false })
  @ApiQuery({ name: 'endDate', description: '结束日期（ISO 8601格式）', required: false })
  @ApiQuery({ name: 'source', description: '数据来源', required: false })
  @ApiQuery({ name: 'acknowledged', description: '是否已确认', required: false })
  @ApiQuery({ name: 'page', description: '页码', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', description: '每页数量', required: false, example: 20 })
  async getLogs(@Query() params: any) {
    try {
      const { babyId, eventTypes, startDate, endDate, source, acknowledged, page = 1, pageSize = 20 } = params;

      const queryParams: BabyLogQueryParams = {
        babyId,
        eventTypes: eventTypes ? eventTypes.split(',') as BabyLogEventType[] : undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        source: source as BabyLogSource,
        acknowledged: acknowledged === 'true' ? true : acknowledged === 'false' ? false : undefined,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
      };

      const result = await this.babyLogService.getLogs(queryParams);
      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[BabyLogController] 查询日志失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '查询日志失败');
    }
  }

  /**
   * 获取最新日志
   */
  @Get('/latest/:babyId')
  @ApiOperation({ summary: '获取最新日志', description: '获取宝宝最新的一条日志记录' })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object', description: '日志记录' },
      },
    },
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID' })
  @ApiQuery({ name: 'eventType', description: '事件类型（可选）', required: false })
  async getLatestLog(@Param('babyId') babyId: string, @Query('eventType') eventType?: string) {
    const log = await this.babyLogService.getLatestLog(
      babyId,
      eventType as BabyLogEventType
    );
    return successResponse(log);
  }

  /**
   * 更新日志记录
   */
  @Put('/:logId')
  @ApiOperation({ summary: '更新日志', description: '更新日志记录' })
  @ApiResponse({
    status: 200,
    description: '更新成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object', description: '更新后的日志记录' },
      },
    },
  })
  @ApiResponse({ status: 404, description: '日志不存在' })
  @ApiParam({ name: 'logId', description: '日志ID' })
  @ApiBody({
    description: '更新日志数据',
    required: false,
    schema: {
      type: 'object',
      properties: {
        endTime: { type: 'string', format: 'date-time', description: '事件结束时间（可选）' },
        note: { type: 'string', description: '备注（可选）' },
        metadata: { type: 'object', description: '附加信息（可选）' },
        acknowledged: { type: 'boolean', description: '是否已确认（可选）' },
      },
    },
  })
  async updateLog(@Param('logId') logId: string, @Body() data: UpdateBabyLogRequest) {
    const log = await this.babyLogService.updateLog(logId, data);
    if (!log) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '日志不存在');
    }
    return successResponse(log);
  }

  /**
   * 确认日志
   */
  @Post('/:logId/acknowledge')
  @ApiOperation({ summary: '确认日志', description: '确认日志记录（主要用于监控事件）' })
  @ApiResponse({
    status: 200,
    description: '确认成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object', description: '更新后的日志记录' },
      },
    },
  })
  @ApiResponse({ status: 404, description: '日志不存在或已确认' })
  @ApiParam({ name: 'logId', description: '日志ID' })
  @ApiBody({
    description: '确认请求',
    required: false,
    schema: {
      type: 'object',
      properties: {
        notes: { type: 'string', description: '备注信息' },
      },
    },
  })
  async acknowledgeLog(@Param('logId') logId: string, @Body() body: { notes?: string }) {
    const userId = this.ctx.state.user?.userId; // 从认证上下文获取用户ID

    if (!userId) {
      return errorResponse(ErrorCode.UNAUTHORIZED, '未认证');
    }

    const log = await this.babyLogService.acknowledgeLog(logId, userId, body?.notes);
    if (!log) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '日志不存在或已确认');
    }
    return successResponse(log);
  }

  /**
   * 批量确认日志
   */
  @Post('/acknowledge/batch')
  @ApiOperation({ summary: '批量确认日志', description: '批量确认多条日志记录' })
  @ApiResponse({
    status: 200,
    description: '确认成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            count: { type: 'number', description: '成功确认的日志数量' },
          },
        },
      },
    },
  })
  @ApiBody({
    description: '批量确认请求',
    required: true,
    schema: {
      type: 'object',
      properties: {
        logIds: {
          type: 'array',
          items: { type: 'string' },
          description: '日志ID数组',
        },
      },
      required: ['logIds'],
    },
  })
  async acknowledgeLogsBatch(@Body() body: { logIds: string[] }) {
    const userId = this.ctx.state.user?.userId;

    if (!userId) {
      return errorResponse(ErrorCode.UNAUTHORIZED, '未认证');
    }

    const count = await this.babyLogService.acknowledgeLogsBatch(body.logIds, userId);
    return successResponse({ count });
  }

  /**
   * 删除日志
   */
  @Del('/:logId')
  @ApiOperation({ summary: '删除日志', description: '删除指定的日志记录' })
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
            deleted: { type: 'boolean', description: '是否删除成功' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'logId', description: '日志ID' })
  async deleteLog(@Param('logId') logId: string) {
    const deleted = await this.babyLogService.deleteLog(logId);
    return successResponse({ deleted });
  }

  /**
   * 批量删除日志
   */
  @Del('/batch')
  @ApiOperation({ summary: '批量删除日志', description: '批量删除多条日志记录' })
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
            count: { type: 'number', description: '删除的日志数量' },
          },
        },
      },
    },
  })
  @ApiBody({
    description: '批量删除请求',
    required: true,
    schema: {
      type: 'object',
      properties: {
        logIds: {
          type: 'array',
          items: { type: 'string' },
          description: '日志ID数组',
        },
      },
      required: ['logIds'],
    },
  })
  async deleteLogsBatch(@Body() body: { logIds: string[] }) {
    const count = await this.babyLogService.deleteLogsBatch(body.logIds);
    return successResponse({ count });
  }

  /**
   * 获取日志统计
   */
  @Get('/stats/:babyId')
  @ApiOperation({ summary: '获取日志统计', description: '获取指定宝宝和日期范围的日志统计数据' })
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
            total: { type: 'number' },
            byType: { type: 'object' },
            bySource: { type: 'object' },
            acknowledged: { type: 'number' },
            unacknowledged: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID' })
  @ApiQuery({ name: 'startDate', description: '开始日期（ISO 8601格式）', required: true })
  @ApiQuery({ name: 'endDate', description: '结束日期（ISO 8601格式）', required: true })
  async getLogStats(
    @Param('babyId') babyId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string
  ) {
    const stats = await this.babyLogService.getLogStats(
      babyId,
      new Date(startDate),
      new Date(endDate)
    );
    return successResponse(stats);
  }

  /**
   * 获取日汇总
   */
  @Get('/summary/:babyId/daily')
  @ApiOperation({ summary: '获取日汇总', description: '获取指定日期的日志汇总数据' })
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
            date: { type: 'string' },
            feeding: { type: 'object' },
            sleep: { type: 'object' },
            diaper: { type: 'object' },
            monitoring: { type: 'object' },
            growth: { type: 'object' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID' })
  @ApiQuery({ name: 'date', description: '日期（ISO 8601格式）', required: true })
  async getDailySummary(@Param('babyId') babyId: string, @Query('date') date: string) {
    const summary = await this.babyLogService.getDailySummary(babyId, new Date(date));
    return successResponse(summary);
  }
}
