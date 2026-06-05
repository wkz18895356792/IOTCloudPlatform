import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { BabyService } from '../service/baby.service';
import { BabyLogService } from '../service/baby-log.service';
import { MonitoringService } from '../service/monitoring.service';
import { AnalyticsService } from '../service/analytics.service';
import {
  BabyStatus,
  FeedingType,
  SleepType,
  PaginationParams,
  BabyLogEventType,
  BabyLogSource,
  successResponse,
  errorResponse,
  ErrorCode,
} from '@baby-monitor/shared-types';

/**
 * 婴儿护理控制器
 *
 * 提供宝宝护理管理的HTTP API接口
 * 处理以下功能模块：
 * - 宝宝档案管理：创建、查询、更新、删除宝宝档案
 * - 喂养记录：记录喂奶的开始和结束，查询喂养历史
 * - 睡眠记录：记录睡眠的开始和结束，查询睡眠历史
 * - 监控事件：查询监控事件，确认事件处理
 * - 数据分析：生成每日摘要、周报、生长分析等
 */
@ApiTags('宝宝管理')
@Controller('/api/babies')
export class BabyController {
  @Inject()
  ctx!: Context;

  @Inject()
  babyService!: BabyService;

  @Inject()
  babyLogService!: BabyLogService;

  @Inject()
  monitoringService!: MonitoringService;

  @Inject()
  analyticsService!: AnalyticsService;

  // ==================== 宝宝管理 ====================
  // 以下方法处理宝宝档案的CRUD操作

  /**
   * 创建宝宝档案
   * @description 为当前用户创建新的宝宝档案
   */
  @Post('/')
  @ApiOperation({ summary: '创建宝宝档案', description: '为当前用户创建新的宝宝档案' })
  @ApiResponse({
    status: 200,
    description: '创建成功，返回宝宝信息',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            babyId: { type: 'string', example: 'baby-123', description: '宝宝ID' },
            name: { type: 'string', example: '小明', description: '宝宝姓名' },
            gender: { type: 'string', enum: ['male', 'female'], example: 'male', description: '性别' },
            birthDate: { type: 'string', example: '2024-01-01', description: '出生日期' },
            birthTime: { type: 'string', example: '08:30', description: '出生时间' },
            weight: { type: 'number', example: 3.5, description: '出生体重（kg）' },
            height: { type: 'number', example: 50, description: '出生身高（cm）' },
            headCircumference: { type: 'number', example: 34, description: '头围（cm）' },
            bloodType: { type: 'string', example: 'A', description: '血型' },
            status: { type: 'string', enum: ['active', 'archived'], example: 'active', description: '状态' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '宝宝信息',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '宝宝姓名' },
        gender: { type: 'string', enum: ['male', 'female'], description: '性别' },
        birthDate: { type: 'string', format: 'date', description: '出生日期' },
        birthTime: { type: 'string', description: '出生时间' },
        weight: { type: 'number', description: '出生体重（kg）' },
        height: { type: 'number', description: '出生身高（cm）' },
        headCircumference: { type: 'number', description: '头围（cm）' },
        bloodType: { type: 'string', description: '血型' }
      },
      required: ['name', 'gender', 'birthDate']
    }
  })
  async createBaby(@Body() body: any) {
    // 从认证上下文中获取当前用户ID
    const userId = this.ctx.state.user.userId;
    // 调用服务层创建宝宝档案
    const baby = await this.babyService.createBaby(userId, body);
    return {
      success: true,
      data: baby,
    };
  }

  /**
   * 获取用户的宝宝列表
   * @description 获取当前用户的所有宝宝档案，支持分页
   */
  @Get('/')
  @ApiOperation({ summary: '获取宝宝列表', description: '获取当前用户的所有宝宝档案，支持分页' })
  @ApiResponse({
    status: 200,
    description: '宝宝列表',
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
                  babyId: { type: 'string', example: 'baby-123' },
                  name: { type: 'string', example: '小明' },
                  gender: { type: 'string', enum: ['male', 'female'], example: 'male' },
                  birthDate: { type: 'string', example: '2024-01-01' },
                  status: { type: 'string', enum: ['active', 'archived'], example: 'active' }
                }
              }
            },
            total: { type: 'number', example: 2 },
            page: { type: 'number', example: 1 },
            pageSize: { type: 'number', example: 20 }
          }
        }
      }
    }
  })
  @ApiQuery({ name: 'page', description: '页码', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', description: '每页数量', required: false, example: 20 })
  async getBabies(@Query() query: any) {
    // 从认证上下文中获取当前用户ID
    const userId = this.ctx.state.user.userId;
    // 构建分页参数对象
    const pagination: PaginationParams = {
      page: parseInt(query.page) || 1,
      pageSize: parseInt(query.pageSize) || 20,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };

    // 调用服务层查询宝宝列表
    const result = await this.babyService.getUserBabies(userId, pagination);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 获取宝宝详情
   * @description 获取指定宝宝的详细信息，包括年龄
   */
  @Get('/:babyId')
  @ApiOperation({ summary: '获取宝宝详情', description: '获取指定宝宝的详细信息，包括年龄' })
  @ApiResponse({
    status: 200,
    description: '宝宝详情',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            babyId: { type: 'string', example: 'baby-123' },
            name: { type: 'string', example: '小明' },
            gender: { type: 'string', enum: ['male', 'female'], example: 'male' },
            birthDate: { type: 'string', example: '2024-01-01' },
            age: {
              type: 'object',
              properties: {
                years: { type: 'number', example: 0 },
                months: { type: 'number', example: 6 },
                days: { type: 'number', example: 15 },
                display: { type: 'string', example: '6个月15天' }
              }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: '宝宝不存在',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'BABY_NOT_FOUND' },
            message: { type: 'string', example: '宝宝不存在' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  async getBaby(@Param('babyId') babyId: string) {
    // 调用服务层查询宝宝详情
    const baby = await this.babyService.getBaby(babyId);
    if (!baby) {
      return {
        success: false,
        error: { code: 'BABY_NOT_FOUND', message: 'Baby not found' },
      };
    }

    // 获取年龄信息并合并到返回数据中
    const age = await this.babyService.calculateAge(babyId);

    return {
      success: true,
      data: { ...baby, age },
    };
  }

  /**
   * 更新宝宝信息
   * @description 更新宝宝的基本信息
   */
  @Put('/:babyId')
  @ApiOperation({ summary: '更新宝宝信息', description: '更新宝宝的基本信息' })
  @ApiResponse({
    status: 200,
    description: '更新成功，返回宝宝信息',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            babyId: { type: 'string', example: 'baby-123' },
            name: { type: 'string', example: '小明' },
            gender: { type: 'string', enum: ['male', 'female'], example: 'male' },
            birthDate: { type: 'string', example: '2024-01-01' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiBody({
    description: '更新的宝宝信息',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '宝宝姓名' },
        bloodType: { type: 'string', description: '血型' },
        allergies: { type: 'array', items: { type: 'string' }, description: '过敏史' }
      }
    }
  })
  async updateBaby(@Param('babyId') babyId: string, @Body() body: any) {
    // 调用服务层更新宝宝信息
    const baby = await this.babyService.updateBaby(babyId, body);
    if (!baby) {
      return {
        success: false,
        error: { code: 'BABY_NOT_FOUND', message: 'Baby not found' },
      };
    }
    return {
      success: true,
      data: baby,
    };
  }

  /**
   * 检查用户对宝宝的权限
   * @description 检查指定用户是否有权限访问该宝宝的数据（供API Gateway调用）
   */
  @Get('/:babyId/permissions/:userId')
  @ApiOperation({ summary: '检查宝宝权限', description: '检查用户是否有权限访问该宝宝的数据' })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 'user-123' })
  async checkBabyPermission(@Param('babyId') babyId: string, @Param('userId') userId: string) {
    const baby = await this.babyService.getBaby(babyId);
    if (!baby) {
      return { hasPermission: false, reason: 'baby_not_found' };
    }

    // 检查宝宝是否属于该用户
    const hasPermission = baby.userId === userId;
    return { hasPermission };
  }

  /**
   * 删除宝宝
   * @description 删除指定的宝宝档案
   */
  @Del('/:babyId')
  @ApiOperation({ summary: '删除宝宝', description: '删除指定的宝宝档案' })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  async deleteBaby(@Param('babyId') babyId: string) {
    // 调用服务层执行软删除
    const success = await this.babyService.deleteBaby(babyId);
    return { success };
  }

  /**
   * 关联设备
   * @description 将监控设备关联到指定宝宝
   */
  @Post('/:babyId/devices/:deviceId')
  @ApiOperation({ summary: '关联设备', description: '将监控设备关联到指定宝宝' })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async linkDevice(@Param('babyId') babyId: string, @Param('deviceId') deviceId: string) {
    // 调用服务层关联设备到宝宝
    await this.babyService.linkDevice(babyId, deviceId);
    return successResponse(null, '设备关联成功');
  }

  /**
   * 取消关联设备
   * @description 取消宝宝与设备的关联
   */
  @Del('/:babyId/devices/:deviceId')
  @ApiOperation({ summary: '取消关联设备', description: '取消宝宝与设备的关联' })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async unlinkDevice(@Param('babyId') babyId: string, @Param('deviceId') deviceId: string) {
    // 调用服务层取消设备关联
    await this.babyService.unlinkDevice(babyId, deviceId);
    return successResponse(null, '设备已取消关联');
  }

  // ==================== 喂养记录 ====================
  // 以下方法处理喂养记录的创建、查询和统计

  /**
   * 开始喂奶
   * @description 开始一次新的喂奶记录
   */
  @Post('/:babyId/feeding/start')
  @ApiOperation({ summary: '开始喂奶', description: '开始一次新的喂奶记录' })
  @ApiResponse({
    status: 200,
    description: '喂养记录已创建',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'log-123', description: '记录ID' },
            babyId: { type: 'string', example: 'baby-123', description: '宝宝ID' },
            eventType: { type: 'string', enum: ['breast_feeding', 'bottle_feeding', 'solid_food', 'mixed_feeding'], example: 'breast_feeding', description: '喂养类型' },
            startTime: { type: 'string', example: '2024-01-01T08:00:00.000Z', description: '开始时间' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiBody({
    description: '喂养类型',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['breast_milk', 'formula', 'mixed'], description: '喂养类型' }
      }
    }
  })
  async startFeeding(@Param('babyId') babyId: string, @Body() body: any) {
    try {
      // 获取喂养类型，默认为母乳
      const { type = FeedingType.BREAST_MILK } = body;
      // 将旧的喂养类型映射到新的事件类型
      const eventTypeMap: Record<string, BabyLogEventType> = {
        [FeedingType.BREAST_MILK]: BabyLogEventType.BREAST_FEEDING,
        [FeedingType.FORMULA]: BabyLogEventType.BOTTLE_FEEDING,
        [FeedingType.MIXED]: BabyLogEventType.BOTTLE_FEEDING, // 混合喂养映射到瓶喂
        [FeedingType.SOLID_FOOD]: BabyLogEventType.BOTTLE_FEEDING, // 辅食映射到瓶喂
      };
      const eventType = eventTypeMap[type] || BabyLogEventType.BREAST_FEEDING;

      const log = await this.babyLogService.createLog({
        babyId,
        eventType,
        startTime: new Date().toISOString(),
        source: BabyLogSource.MANUAL,
        recordedBy: this.ctx.state.user.userId,
        metadata: { feedingType: type },
      });

      return successResponse(log);
    } catch (error: any) {
      this.ctx.logger.error('[BabyController] 开始喂奶失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '开始喂奶失败');
    }
  }

  /**
   * 结束喂奶
   * @description 结束当前的喂奶记录，记录奶量和备注
   */
  @Post('/feeding/:logId/end')
  @ApiOperation({ summary: '结束喂奶', description: '结束当前的喂奶记录，记录奶量和备注' })
  @ApiResponse({
    status: 200,
    description: '喂养记录已更新',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'log-123' },
            endTime: { type: 'string', example: '2024-01-01T08:30:00.000Z' },
            amount: { type: 'number', example: 120, description: '奶量（ml）' },
            duration: { type: 'number', example: 30, description: '时长（分钟）' },
            note: { type: 'string', description: '备注' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'logId', description: '喂养记录ID', example: 'log-123' })
  @ApiBody({
    description: '奶量和备注',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: '奶量（ml）' },
        notes: { type: 'string', description: '备注' }
      }
    }
  })
  async endFeeding(@Param('logId') logId: string, @Body() body: any) {
    try {
      // 从请求体中获取奶量和备注
      const { amount, notes } = body;
      // 更新日志记录
      const log = await this.babyLogService.updateLog(logId, {
        endTime: new Date().toISOString(),
        note: notes,
        metadata: { amount },
      });

      if (!log) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '记录不存在');
      }

      return successResponse(log);
    } catch (error: any) {
      this.ctx.logger.error('[BabyController] 结束喂奶失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '结束喂奶失败');
    }
  }

  /**
   * 获取喂奶记录
   * @description 获取指定宝宝的喂养记录，支持日期范围筛选
   */
  @Get('/:babyId/feeding')
  @ApiOperation({ summary: '获取喂奶记录', description: '获取指定宝宝的喂养记录，支持日期范围筛选' })
  @ApiResponse({
    status: 200,
    description: '喂养记录列表',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: 'log-123' },
                  eventType: { type: 'string', enum: ['breast_feeding', 'bottle_feeding', 'solid_food', 'mixed_feeding'], example: 'breast_feeding' },
                  startTime: { type: 'string', example: '2024-01-01T08:00:00.000Z' },
                  duration: { type: 'number', example: 30 }
                }
              }
            },
            total: { type: 'number', example: 10 },
            page: { type: 'number', example: 1 },
            pageSize: { type: 'number', example: 20 },
            totalPages: { type: 'number', example: 1 }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'page', description: '页码', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', description: '每页数量', required: false, example: 20 })
  @ApiQuery({ name: 'startDate', description: '开始日期', required: false })
  @ApiQuery({ name: 'endDate', description: '结束日期', required: false })
  async getFeedingLogs(@Param('babyId') babyId: string, @Query() query: any) {
    try {
      const result = await this.babyLogService.getLogs({
        babyId,
        eventTypes: [BabyLogEventType.BREAST_FEEDING, BabyLogEventType.BOTTLE_FEEDING],
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        page: parseInt(query.page) || 1,
        pageSize: parseInt(query.pageSize) || 20,
      });

      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[BabyController] 获取喂奶记录失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取喂奶记录失败');
    }
  }

  /**
   * 获取今日喂奶统计
   * @description 获取今日喂奶次数、总奶量等统计数据
   */
  @Get('/:babyId/feeding/today')
  @ApiOperation({ summary: '获取今日喂奶统计', description: '获取今日喂奶次数、总奶量等统计数据' })
  @ApiResponse({
    status: 200,
    description: '今日喂奶统计',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            date: { type: 'string', example: '2024-01-01', description: '日期' },
            count: { type: 'number', example: 8, description: '喂奶次数' },
            totalAmount: { type: 'number', example: 960, description: '总奶量（ml）' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  async getTodayFeedingStats(@Param('babyId') babyId: string) {
    try {
      const today = new Date();
      const summary = await this.babyLogService.getDailySummary(babyId, today);
      return successResponse({
        date: today.toISOString().split('T')[0],
        count: summary.feeding.count,
        totalAmount: summary.feeding.totalAmount,
      });
    } catch (error: any) {
      this.ctx.logger.error('[BabyController] 获取今日喂奶统计失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取今日喂奶统计失败');
    }
  }

  // ==================== 睡眠记录 ====================
  // 以下方法处理睡眠记录的创建、查询和统计

  /**
   * 开始睡眠
   * @description 开始记录宝宝睡眠
   */
  @Post('/:babyId/sleep/start')
  @ApiOperation({ summary: '开始睡眠', description: '开始记录宝宝睡眠' })
  @ApiResponse({
    status: 200,
    description: '睡眠记录已创建',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'log-123', description: '记录ID' },
            babyId: { type: 'string', example: 'baby-123', description: '宝宝ID' },
            eventType: { type: 'string', enum: ['sleep_nap', 'sleep_night'], example: 'sleep_nap', description: '睡眠类型' },
            startTime: { type: 'string', example: '2024-01-01T14:00:00.000Z', description: '开始时间' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiBody({
    description: '睡眠类型',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['nap', 'night'], description: '睡眠类型' }
      }
    }
  })
  async startSleep(@Param('babyId') babyId: string, @Body() body: any) {
    try {
      // 获取睡眠类型，默认为小睡
      const { type = SleepType.NAP } = body;
      // 将旧的睡眠类型映射到新的事件类型（现在只有 SLEEP 一种）
      const eventType = BabyLogEventType.SLEEP;

      const log = await this.babyLogService.createLog({
        babyId,
        eventType,
        startTime: new Date().toISOString(),
        source: BabyLogSource.MANUAL,
        recordedBy: this.ctx.state.user.userId,
        metadata: { sleepType: type },
      });

      return successResponse(log);
    } catch (error: any) {
      this.ctx.logger.error('[BabyController] 开始睡眠记录失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '开始睡眠记录失败');
    }
  }

  /**
   * 结束睡眠
   * @description 结束当前的睡眠记录，记录睡眠质量和备注
   */
  @Post('/sleep/:logId/end')
  @ApiOperation({ summary: '结束睡眠', description: '结束当前的睡眠记录，记录睡眠质量和备注' })
  @ApiResponse({
    status: 200,
    description: '睡眠记录已更新',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'log-123' },
            endTime: { type: 'string', example: '2024-01-01T16:00:00.000Z' },
            duration: { type: 'number', example: 120, description: '时长（分钟）' },
            note: { type: 'string', description: '备注' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'logId', description: '睡眠记录ID', example: 'log-123' })
  @ApiBody({
    description: '睡眠质量、醒来次数、备注',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        quality: { type: 'string', enum: ['excellent', 'good', 'fair', 'poor'], description: '睡眠质量' },
        wokeUpTimes: { type: 'number', description: '醒来次数' },
        notes: { type: 'string', description: '备注' }
      }
    }
  })
  async endSleep(@Param('logId') logId: string, @Body() body: any) {
    try {
      // 从请求体中获取睡眠质量、醒来次数和备注
      const { quality, wokeUpTimes, notes } = body;
      // 更新日志记录
      const log = await this.babyLogService.updateLog(logId, {
        endTime: new Date().toISOString(),
        note: notes,
        metadata: { quality, wokeUpTimes },
      });

      if (!log) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '记录不存在');
      }

      return successResponse(log);
    } catch (error: any) {
      this.ctx.logger.error('[BabyController] 结束睡眠记录失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '结束睡眠记录失败');
    }
  }

  /**
   * 获取睡眠记录
   * @description 获取指定宝宝的睡眠记录，支持日期范围筛选
   */
  @Get('/:babyId/sleep')
  @ApiOperation({ summary: '获取睡眠记录', description: '获取指定宝宝的睡眠记录，支持日期范围筛选' })
  @ApiResponse({
    status: 200,
    description: '睡眠记录列表',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: 'log-123' },
                  eventType: { type: 'string', enum: ['sleep_nap', 'sleep_night'], example: 'sleep_nap' },
                  startTime: { type: 'string', example: '2024-01-01T14:00:00.000Z' },
                  endTime: { type: 'string', example: '2024-01-01T16:00:00.000Z' },
                  duration: { type: 'number', example: 120 }
                }
              }
            },
            total: { type: 'number', example: 10 },
            page: { type: 'number', example: 1 },
            pageSize: { type: 'number', example: 20 },
            totalPages: { type: 'number', example: 1 }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'page', description: '页码', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', description: '每页数量', required: false, example: 20 })
  @ApiQuery({ name: 'startDate', description: '开始日期', required: false })
  @ApiQuery({ name: 'endDate', description: '结束日期', required: false })
  async getSleepLogs(@Param('babyId') babyId: string, @Query() query: any) {
    try {
      const result = await this.babyLogService.getLogs({
        babyId,
        eventTypes: [BabyLogEventType.SLEEP],
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        page: parseInt(query.page) || 1,
        pageSize: parseInt(query.pageSize) || 20,
      });

      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[BabyController] 获取睡眠记录失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取睡眠记录失败');
    }
  }

  /**
   * 获取当前睡眠状态
   * @description 获取宝宝当前的睡眠状态（如果正在睡眠中）
   */
  @Get('/:babyId/sleep/current')
  @ApiOperation({ summary: '获取当前睡眠状态', description: '获取宝宝当前的睡眠状态（如果正在睡眠中）' })
  @ApiResponse({
    status: 200,
    description: '当前睡眠状态',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'log-123', description: '记录ID' },
            eventType: { type: 'string', enum: ['sleep_nap', 'sleep_night'], example: 'sleep_nap', description: '睡眠类型' },
            startTime: { type: 'string', example: '2024-01-01T14:00:00.000Z', description: '开始时间' },
            currentDuration: { type: 'number', example: 45, description: '已持续时长（分钟）' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  async getCurrentSleep(@Param('babyId') babyId: string) {
    try {
      // 调用服务层获取最新的睡眠记录（没有结束时间的表示正在进行中）
      const log = await this.babyLogService.getLatestLog(babyId, BabyLogEventType.SLEEP);
      if (log && !log.endTime) {
        // 计算当前持续时长
        const currentDuration = Math.floor((Date.now() - new Date(log.startTime).getTime()) / 1000 / 60); // 分钟
        return successResponse({
          ...log,
          currentDuration,
        });
      }

      // 没有正在进行的睡眠
      return successResponse(null);
    } catch (error: any) {
      this.ctx.logger.error('[BabyController] 获取当前睡眠状态失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取当前睡眠状态失败');
    }
  }

  /**
   * 获取今日睡眠统计
   * @description 获取今日睡眠时长、次数等统计数据
   */
  @Get('/:babyId/sleep/today')
  @ApiOperation({ summary: '获取今日睡眠统计', description: '获取今日睡眠时长、次数等统计数据' })
  @ApiResponse({
    status: 200,
    description: '今日睡眠统计',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            date: { type: 'string', example: '2024-01-01', description: '日期' },
            totalSleepTime: { type: 'number', example: 480, description: '总睡眠时长（分钟）' },
            count: { type: 'number', example: 3, description: '睡眠次数' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  async getTodaySleepStats(@Param('babyId') babyId: string) {
    try {
      const today = new Date();
      const summary = await this.babyLogService.getDailySummary(babyId, today);
      return successResponse({
        date: today.toISOString().split('T')[0],
        totalSleepTime: summary.sleep.totalDuration,
        count: summary.sleep.count,
      });
    } catch (error: any) {
      this.ctx.logger.error('[BabyController] 获取今日睡眠统计失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取今日睡眠统计失败');
    }
  }

  // ==================== 监控事件 ====================
  // 以下方法处理监控事件的查询和确认

  /**
   * 获取监控事件
   * @description 获取宝宝的监控事件列表（哭声、移动、湿度、温度等）
   */
  @Get('/:babyId/monitoring/events')
  @ApiOperation({ summary: '获取监控事件', description: '获取宝宝的监控事件列表（哭声、移动、湿度、温度等）' })
  @ApiResponse({
    status: 200,
    description: '监控事件列表',
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
                  eventId: { type: 'string', example: 'event-123', description: '事件ID' },
                  eventType: { type: 'string', enum: ['crying', 'motion', 'temperature', 'humidity'], example: 'crying', description: '事件类型' },
                  timestamp: { type: 'string', example: '2024-01-01T08:00:00.000Z', description: '时间' },
                  acknowledged: { type: 'boolean', example: false, description: '是否已确认' }
                }
              }
            },
            total: { type: 'number', example: 50 },
            page: { type: 'number', example: 1 },
            pageSize: { type: 'number', example: 20 }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'page', description: '页码', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', description: '每页数量', required: false, example: 20 })
  @ApiQuery({ name: 'startDate', description: '开始日期', required: false })
  @ApiQuery({ name: 'endDate', description: '结束日期', required: false })
  @ApiQuery({ name: 'acknowledged', description: '是否已确认', required: false })
  async getMonitoringEvents(@Param('babyId') babyId: string, @Query() query: any) {
    // 构建分页参数
    const pagination: PaginationParams = {
      page: parseInt(query.page) || 1,
      pageSize: parseInt(query.pageSize) || 20,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };

    // 解析日期范围和确认状态参数
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;
    const acknowledged = query.acknowledged !== undefined ? query.acknowledged === 'true' : undefined;

    // 调用服务层查询监控事件
    const result = await this.monitoringService.getEvents(babyId, pagination, startDate, endDate, acknowledged);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 获取未确认的事件
   * @description 获取所有未确认的监控事件（用于通知提醒）
   */
  @Get('/:babyId/monitoring/events/unacknowledged')
  @ApiOperation({ summary: '获取未确认的事件', description: '获取所有未确认的监控事件（用于通知提醒）' })
  @ApiResponse({
    status: 200,
    description: '未确认的事件列表',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              eventId: { type: 'string', example: 'event-123' },
              eventType: { type: 'string', enum: ['crying', 'motion', 'temperature', 'humidity'], example: 'crying' },
              timestamp: { type: 'string', example: '2024-01-01T08:00:00.000Z' }
            }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  async getUnacknowledgedEvents(@Param('babyId') babyId: string) {
    // 调用服务层获取未确认的事件
    const events = await this.monitoringService.getUnacknowledgedEvents(babyId);
    return {
      success: true,
      data: events,
    };
  }

  /**
   * 确认事件
   * @description 确认指定的监控事件（标记为已处理）
   */
  @Post('/monitoring/events/:eventId/acknowledge')
  @ApiOperation({ summary: '确认事件', description: '确认指定的监控事件（标记为已处理）' })
  @ApiResponse({
    status: 200,
    description: '事件已确认',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            eventId: { type: 'string', example: 'event-123' },
            acknowledged: { type: 'boolean', example: true },
            acknowledgedBy: { type: 'string', example: 'user-123', description: '确认人ID' },
            acknowledgedAt: { type: 'string', example: '2024-01-01T08:05:00.000Z', description: '确认时间' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'eventId', description: '事件ID', example: 'event-123' })
  @ApiBody({
    description: '确认备注',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        notes: { type: 'string', description: '备注' }
      }
    }
  })
  async acknowledgeEvent(@Param('eventId') eventId: string, @Body() body: any) {
    // 从请求体中获取备注
    const { notes } = body;
    // 调用服务层确认事件，传入当前用户ID作为确认人
    const event = await this.monitoringService.acknowledgeEvent(eventId, this.ctx.state.user.userId, notes);
    return {
      success: true,
      data: event,
    };
  }

  // ==================== 数据分析 ====================
  // 以下方法处理数据分析和报告生成

  /**
   * 获取每日摘要
   * @description 获取指定日期的宝宝护理摘要（喂养、睡眠、监控等）
   */
  @Get('/:babyId/analytics/daily')
  @ApiOperation({ summary: '获取每日摘要', description: '获取指定日期的宝宝护理摘要（喂养、睡眠、监控等）' })
  @ApiResponse({
    status: 200,
    description: '每日摘要',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            date: { type: 'string', example: '2024-01-01' },
            feeding: {
              type: 'object',
              properties: {
                totalFeedings: { type: 'number', example: 8 },
                totalAmount: { type: 'number', example: 960 }
              }
            },
            sleep: {
              type: 'object',
              properties: {
                totalSleepTime: { type: 'number', example: 480 },
                napCount: { type: 'number', example: 3 }
              }
            },
            monitoring: {
              type: 'object',
              properties: {
                totalEvents: { type: 'number', example: 15 },
                cryingEvents: { type: 'number', example: 5 }
              }
            }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'date', description: '日期，默认今天', required: false })
  async getDailySummary(@Param('babyId') babyId: string, @Query() query: any) {
    // 解析日期参数，默认为今天
    const date = query.date ? new Date(query.date) : new Date();
    // 调用服务层生成每日摘要
    const summary = await this.analyticsService.generateDailySummary(babyId, date);
    return {
      success: true,
      data: summary,
    };
  }

  /**
   * 获取周报
   * @description 获取一周的护理数据汇总和分析
   */
  @Get('/:babyId/analytics/weekly')
  @ApiOperation({ summary: '获取周报', description: '获取一周的护理数据汇总和分析' })
  @ApiResponse({
    status: 200,
    description: '周报数据',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            weekStart: { type: 'string', example: '2024-01-01' },
            weekEnd: { type: 'string', example: '2024-01-07' },
            feedingSummary: {
              type: 'object',
              properties: {
                avgDailyFeedings: { type: 'number', example: 7.5 },
                avgDailyAmount: { type: 'number', example: 900 }
              }
            },
            sleepSummary: {
              type: 'object',
              properties: {
                avgDailySleepTime: { type: 'number', example: 500 },
                avgNapCount: { type: 'number', example: 2.5 }
              }
            }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'weekStart', description: '周开始日期，默认本周一', required: false })
  async getWeeklyReport(@Param('babyId') babyId: string, @Query() query: any) {
    // 解析周开始日期，默认为当前日期
    const weekStart = query.weekStart ? new Date(query.weekStart) : new Date();
    // 调用服务层生成周报
    const report = await this.analyticsService.generateWeeklyReport(babyId, weekStart);
    return {
      success: true,
      data: report,
    };
  }

  /**
   * 获取生长百分位
   * @description 根据宝宝年龄和性别，计算身高、体重、头围的生长百分位
   */
  @Get('/:babyId/analytics/growth/percentile')
  @ApiOperation({ summary: '获取生长百分位', description: '根据宝宝年龄和性别，计算身高、体重、头围的生长百分位' })
  @ApiResponse({
    status: 200,
    description: '生长百分位数据',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            weight: {
              type: 'object',
              properties: {
                value: { type: 'number', example: 8.5, description: '体重（kg）' },
                percentile: { type: 'number', example: 75, description: '百分位' },
                assessment: { type: 'string', example: '正常', description: '评估' }
              }
            },
            height: {
              type: 'object',
              properties: {
                value: { type: 'number', example: 70, description: '身高（cm）' },
                percentile: { type: 'number', example: 68 },
                assessment: { type: 'string', example: '正常' }
              }
            },
            headCircumference: {
              type: 'object',
              properties: {
                value: { type: 'number', example: 44, description: '头围（cm）' },
                percentile: { type: 'number', example: 72 },
                assessment: { type: 'string', example: '正常' }
              }
            }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  async getGrowthPercentile(@Param('babyId') babyId: string) {
    // 调用服务层计算生长百分位
    const percentile = await this.analyticsService.calculateGrowthPercentile(babyId);
    return {
      success: true,
      data: percentile,
    };
  }

  /**
   * 获取生长趋势
   * @description 获取宝宝体重、身高、头围的生长趋势曲线
   */
  @Get('/:babyId/analytics/growth/trend')
  @ApiOperation({ summary: '获取生长趋势', description: '获取宝宝体重、身高、头围的生长趋势曲线' })
  @ApiResponse({
    status: 200,
    description: '生长趋势数据',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            type: { type: 'string', example: 'weight', description: '数据类型' },
            period: { type: 'number', example: 12, description: '统计月数' },
            dataPoints: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string', example: '2024-01-01' },
                  value: { type: 'number', example: 8.5 },
                  age: { type: 'string', example: '6个月' }
                }
              }
            }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'type', description: '数据类型（weight/height/headCircumference），默认weight', required: false })
  @ApiQuery({ name: 'months', description: '统计月数，默认12', required: false })
  async getGrowthTrend(@Param('babyId') babyId: string, @Query() query: any) {
    // 获取数据类型和月数参数，设置默认值
    const { type = 'weight', months = 12 } = query;
    // 调用服务层获取生长趋势
    const trend = await this.analyticsService.getGrowthTrend(babyId, type, months);
    return {
      success: true,
      data: trend,
    };
  }

  /**
   * 分析喂养模式
   * @description 分析宝宝最近的喂养模式（频率、间隔、平均奶量等）
   */
  @Get('/:babyId/analytics/feeding/pattern')
  @ApiOperation({ summary: '分析喂养模式', description: '分析宝宝最近的喂养模式（频率、间隔、平均奶量等）' })
  @ApiResponse({
    status: 200,
    description: '喂养模式分析',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            period: { type: 'number', example: 7, description: '分析天数' },
            averageFeedingsPerDay: { type: 'number', example: 7.5, description: '平均每天喂养次数' },
            averageAmount: { type: 'number', example: 120, description: '平均奶量（ml）' },
            averageInterval: { type: 'number', example: 180, description: '平均间隔（分钟）' },
            peakFeedingHours: {
              type: 'array',
              items: { type: 'number' },
              example: [8, 12, 18],
              description: '高峰喂养时段'
            }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'days', description: '分析天数，默认7天', required: false })
  async analyzeFeedingPattern(@Param('babyId') babyId: string, @Query() query: any) {
    // 获取分析天数参数，默认7天
    const { days = 7 } = query;
    // 调用服务层分析喂养模式
    const pattern = await this.analyticsService.analyzeFeedingPattern(babyId, days);
    return {
      success: true,
      data: pattern,
    };
  }

  /**
   * 获取睡眠模式分析
   * @description 分析宝宝最近的睡眠模式（总时长、平均时长、作息规律等）
   */
  @Get('/:babyId/analytics/sleep/pattern')
  @ApiOperation({ summary: '获取睡眠模式分析', description: '分析宝宝最近的睡眠模式（总时长、平均时长、作息规律等）' })
  @ApiResponse({
    status: 200,
    description: '睡眠模式分析',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            period: { type: 'number', example: 7, description: '分析天数' },
            averageDailySleepTime: { type: 'number', example: 480, description: '平均每天睡眠时长（分钟）' },
            averageNapDuration: { type: 'number', example: 90, description: '平均小睡时长（分钟）' },
            averageNightSleepTime: { type: 'number', example: 390, description: '平均夜间睡眠时长（分钟）' },
            usualBedtime: { type: 'string', example: '20:00', description: '通常睡觉时间' },
            usualWakeTime: { type: 'string', example: '07:00', description: '通常起床时间' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'babyId', description: '宝宝ID', example: 'baby-123' })
  @ApiQuery({ name: 'days', description: '分析天数，默认7天', required: false })
  async analyzeSleepPattern(@Param('babyId') babyId: string, @Query() query: any) {
    try {
      // 获取分析天数参数，默认7天
      const { days = 7 } = query;
      // 计算日期范围
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // 获取日期范围内的所有睡眠日志
      const result = await this.babyLogService.getLogs({
        babyId,
        eventTypes: [BabyLogEventType.SLEEP],
        startDate,
        endDate,
        page: 1,
        pageSize: 1000, // 获取所有记录
      });

      // 计算统计数据 - 从 metadata 中读取睡眠类型区分小睡和夜间睡眠
      const napLogs = result.items.filter(log => log.metadata?.sleepType === 'nap' && log.duration);
      const nightLogs = result.items.filter(log => log.metadata?.sleepType === 'night' && log.duration);

      const totalNapDuration = napLogs.reduce((sum, log) => sum + (log.duration || 0), 0);
      const totalNightDuration = nightLogs.reduce((sum, log) => sum + (log.duration || 0), 0);
      const averageNapDuration = napLogs.length > 0 ? totalNapDuration / napLogs.length : 0;
      const averageNightSleepTime = nightLogs.length > 0 ? totalNightDuration / nightLogs.length : 0;
      const averageDailySleepTime = (totalNapDuration + totalNightDuration) / days;

      return successResponse({
        period: days,
        averageDailySleepTime,
        averageNapDuration,
        averageNightSleepTime,
        napCount: napLogs.length,
        nightCount: nightLogs.length,
      });
    } catch (error: any) {
      this.ctx.logger.error('[BabyController] 获取睡眠模式分析失败:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取睡眠模式分析失败');
    }
  }
}
