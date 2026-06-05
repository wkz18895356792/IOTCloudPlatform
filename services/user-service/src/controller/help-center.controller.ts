import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { HelpCenterService } from '../service/help-center.service';
import { HelpCategory } from '../entity/help-center.entity';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 帮助中心控制器
 *
 * 处理帮助文章、FAQ和技术支持工单相关API
 */
@ApiTags('帮助中心')
@Controller('/api/help')
export class HelpCenterController {
  @Inject()
  ctx!: Context;

  @Inject()
  helpCenterService!: HelpCenterService;

  // ==================== 帮助文章 ====================

  /**
   * 获取帮助文章列表
   */
  @Get('/articles')
  @ApiOperation({
    summary: '获取帮助文章列表',
    description: '获取帮助中心的文章列表',
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
                  title: { type: 'string' },
                  summary: { type: 'string' },
                  category: { type: 'string' },
                  viewCount: { type: 'number' },
                  isPinned: { type: 'boolean' },
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
  @ApiQuery({ name: 'category', description: '文章分类', required: false })
  @ApiQuery({ name: 'language', description: '语言代码', required: false, example: 'zh-CN' })
  @ApiQuery({ name: 'limit', description: '返回数量', required: false, example: 20 })
  @ApiQuery({ name: 'offset', description: '偏移量', required: false, example: 0 })
  async getArticles(@Query() query: {
    category?: HelpCategory;
    language?: string;
    limit?: string;
    offset?: string;
  }) {
    try {
      const result = await this.helpCenterService.getArticles({
        category: query.category,
        language: query.language || 'zh-CN',
        limit: query.limit ? parseInt(query.limit) : undefined,
        offset: query.offset ? parseInt(query.offset) : undefined,
      });

      return successResponse(result);
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Get articles error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取文章列表失败');
    }
  }

  /**
   * 获取文章详情
   */
  @Get('/articles/:articleId')
  @ApiOperation({
    summary: '获取文章详情',
    description: '获取指定帮助文章的详细内容',
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
            id: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            content: { type: 'string' },
            category: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            viewCount: { type: 'number' },
            helpfulCount: { type: 'number' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'articleId', description: '文章ID' })
  async getArticle(@Param('articleId') articleId: string) {
    try {
      const article = await this.helpCenterService.getArticle(articleId);

      if (!article) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '文章不存在');
      }

      return successResponse(article);
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Get article error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取文章详情失败');
    }
  }

  /**
   * 获取相关文章
   */
  @Get('/articles/:articleId/related')
  @ApiOperation({
    summary: '获取相关文章',
    description: '获取与指定文章相关的其他文章',
  })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              summary: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'articleId', description: '文章ID' })
  async getRelatedArticles(@Param('articleId') articleId: string) {
    try {
      const articles = await this.helpCenterService.getRelatedArticles(articleId);
      return successResponse(articles);
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Get related articles error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取相关文章失败');
    }
  }

  /**
   * 搜索文章
   */
  @Get('/search')
  @ApiOperation({
    summary: '搜索帮助文章',
    description: '根据关键词搜索帮助文章',
  })
  @ApiResponse({
    status: 200,
    description: '搜索成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              summary: { type: 'string' },
              category: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiQuery({ name: 'keyword', description: '搜索关键词', required: true })
  @ApiQuery({ name: 'language', description: '语言代码', required: false, example: 'zh-CN' })
  async searchArticles(@Query() query: { keyword: string; language?: string }) {
    try {
      const articles = await this.helpCenterService.searchArticles(
        query.keyword,
        query.language || 'zh-CN'
      );
      return successResponse(articles);
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Search articles error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '搜索失败');
    }
  }

  /**
   * 获取热门文章
   */
  @Get('/articles/popular')
  @ApiOperation({
    summary: '获取热门文章',
    description: '获取浏览量最高的热门帮助文章',
  })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              viewCount: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiQuery({ name: 'limit', description: '返回数量', required: false, example: 10 })
  async getPopularArticles(@Query('limit') limit?: string) {
    try {
      const articles = await this.helpCenterService.getPopularArticles(
        limit ? parseInt(limit) : 10
      );
      return successResponse(articles);
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Get popular articles error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取热门文章失败');
    }
  }

  /**
   * 记录文章反馈
   */
  @Post('/articles/:articleId/feedback')
  @ApiOperation({
    summary: '记录文章反馈',
    description: '记录用户对帮助文章的反馈',
  })
  @ApiResponse({
    status: 200,
    description: '反馈成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '感谢您的反馈' },
      },
    },
  })
  @ApiParam({ name: 'articleId', description: '文章ID' })
  @ApiBody({
    description: '反馈信息',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        feedbackType: {
          type: 'string',
          enum: ['helpful', 'not_helpful', 'contact_us'],
          description: '反馈类型',
        },
        content: { type: 'string', description: '反馈内容（可选）' },
      },
      required: ['feedbackType'],
    },
  })
  async recordFeedback(
    @Param('articleId') articleId: string,
    @Body() body: {
      feedbackType: 'helpful' | 'not_helpful' | 'contact_us';
      content?: string;
    }
  ) {
    try {
      const userId = this.ctx.state.user?.userId || null;

      await this.helpCenterService.recordFeedback(
        articleId,
        userId,
        body.feedbackType,
        body.content
      );

      return successResponse(undefined, '感谢您的反馈');
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Record feedback error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '记录反馈失败');
    }
  }

  // ==================== 技术支持工单 ====================

  /**
   * 创建工单
   */
  @Post('/tickets')
  @ApiOperation({
    summary: '创建技术支持工单',
    description: '提交技术支持工单',
  })
  @ApiResponse({
    status: 200,
    description: '创建成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            ticketNumber: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiBody({
    description: '工单信息',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '工单标题' },
        description: { type: 'string', description: '问题描述' },
        ticketType: {
          type: 'string',
          enum: ['technical', 'billing', 'feature', 'bug', 'other'],
          description: '工单类型',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: '优先级',
        },
        deviceId: { type: 'string', description: '相关设备ID（可选）' },
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: '附件URL列表（可选）',
        },
      },
      required: ['title', 'description', 'ticketType'],
    },
  })
  async createTicket(@Body() body: {
    title: string;
    description: string;
    ticketType: 'technical' | 'billing' | 'feature' | 'bug' | 'other';
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    deviceId?: string;
    attachments?: string[];
  }) {
    try {
      const userId = this.ctx.state.user?.userId;

      const ticket = await this.helpCenterService.createTicket(userId, body);

      return successResponse({
        ...ticket,
        ticketNumber: `TKT${Date.now()}${ticket.id.slice(-4)}`,
      });
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Create ticket error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '创建工单失败');
    }
  }

  /**
   * 获取用户工单列表
   */
  @Get('/tickets')
  @ApiOperation({
    summary: '获取我的工单',
    description: '获取当前用户的技术支持工单列表',
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
                  ticketNumber: { type: 'string' },
                  title: { type: 'string' },
                  status: { type: 'string' },
                  ticketType: { type: 'string' },
                  priority: { type: 'string' },
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
  @ApiQuery({ name: 'status', description: '工单状态筛选', required: false })
  @ApiQuery({ name: 'limit', description: '返回数量', required: false, example: 20 })
  @ApiQuery({ name: 'offset', description: '偏移量', required: false, example: 0 })
  async getTickets(@Query() query: {
    status?: string;
    limit?: string;
    offset?: string;
  }) {
    try {
      const userId = this.ctx.state.user?.userId;

      const result = await this.helpCenterService.getUserTickets(userId, {
        status: query.status,
        limit: query.limit ? parseInt(query.limit) : undefined,
        offset: query.offset ? parseInt(query.offset) : undefined,
      });

      // 添加工单编号
      const list = result.list.map(ticket => ({
        ...ticket,
        ticketNumber: `TKT${ticket.createdAt.getTime()}${ticket.id.slice(-4)}`,
      }));

      return successResponse({ ...result, list });
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Get tickets error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取工单列表失败');
    }
  }

  /**
   * 获取工单详情
   */
  @Get('/tickets/:ticketId')
  @ApiOperation({
    summary: '获取工单详情',
    description: '获取指定工单的详细信息',
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
            id: { type: 'string' },
            ticketNumber: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string' },
            ticketType: { type: 'string' },
            priority: { type: 'string' },
            resolution: { type: 'string' },
            attachments: { type: 'array' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'ticketId', description: '工单ID' })
  async getTicket(@Param('ticketId') ticketId: string) {
    try {
      const userId = this.ctx.state.user?.userId;
      const ticket = await this.helpCenterService.getTicket(ticketId, userId);

      if (!ticket) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '工单不存在');
      }

      return successResponse({
        ...ticket,
        ticketNumber: `TKT${ticket.createdAt.getTime()}${ticket.id.slice(-4)}`,
      });
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Get ticket error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取工单详情失败');
    }
  }

  /**
   * 更新工单
   */
  @Put('/tickets/:ticketId')
  @ApiOperation({
    summary: '更新工单',
    description: '更新工单的描述或附件',
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
            id: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'ticketId', description: '工单ID' })
  @ApiBody({
    description: '更新数据',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: '问题描述' },
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: '附件URL列表',
        },
      },
    },
  })
  async updateTicket(
    @Param('ticketId') ticketId: string,
    @Body() body: {
      description?: string;
      attachments?: string[];
    }
  ) {
    try {
      const userId = this.ctx.state.user?.userId;
      const ticket = await this.helpCenterService.updateTicket(
        ticketId,
        userId,
        body
      );

      if (!ticket) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '工单不存在');
      }

      return successResponse(ticket);
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Update ticket error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '更新工单失败');
    }
  }

  /**
   * 关闭工单
   */
  @Post('/tickets/:ticketId/close')
  @ApiOperation({
    summary: '关闭工单',
    description: '关闭指定的技术支持工单',
  })
  @ApiResponse({
    status: 200,
    description: '关闭成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '工单已关闭' },
      },
    },
  })
  @ApiParam({ name: 'ticketId', description: '工单ID' })
  async closeTicket(@Param('ticketId') ticketId: string) {
    try {
      const userId = this.ctx.state.user?.userId;
      const closed = await this.helpCenterService.closeTicket(ticketId, userId);

      if (!closed) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '工单不存在');
      }

      return successResponse(undefined, '工单已关闭');
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Close ticket error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '关闭工单失败');
    }
  }

  /**
   * 获取工单统计
   */
  @Get('/tickets/stats')
  @ApiOperation({
    summary: '获取工单统计',
    description: '获取用户工单的统计信息',
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
            total: { type: 'number' },
            open: { type: 'number' },
            inProgress: { type: 'number' },
            pending: { type: 'number' },
            resolved: { type: 'number' },
            closed: { type: 'number' },
          },
        },
      },
    },
  })
  async getTicketStats() {
    try {
      const userId = this.ctx.state.user?.userId;
      const stats = await this.helpCenterService.getTicketStats(userId);
      return successResponse(stats);
    } catch (error: any) {
      this.ctx.logger.error('[HelpCenterController] Get ticket stats error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, error.message || '获取统计失败');
    }
  }
}
