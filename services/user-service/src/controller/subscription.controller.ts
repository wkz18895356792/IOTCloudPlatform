import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { SubscriptionService } from '../service/subscription.service';
import { SubscriptionPlanType } from '../entity/subscription.entity';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 订阅服务控制器
 *
 * 处理订阅套餐购买、订单、续费等API
 */
@ApiTags('服务订阅（暂不启用）')
@Controller('/api/subscription')
export class SubscriptionController {
  @Inject()
  ctx!: Context;

  @Inject()
  subscriptionService!: SubscriptionService;

  // ==================== 套餐管理 ====================

  /**
   * 获取所有套餐
   */
  @Get('/plans')
  @ApiOperation({
    summary: '获取服务套餐',
    description: '获取所有可购买的订阅套餐',
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
            plans: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  planId: { type: 'string', example: 'monthly' },
                  name: { type: 'string', example: '月度套餐' },
                  type: { type: 'string', enum: ['monthly', 'quarterly', 'semi_annual', 'annual'], example: 'monthly' },
                  description: { type: 'string', example: '适合新手父母' },
                  price: { type: 'number', example: 9900, description: '价格（分）' },
                  originalPrice: { type: 'number', example: 19900, description: '原价（分）' },
                  durationDays: { type: 'number', example: 30, description: '有效期（天）' },
                  storageGb: { type: 'number', example: 30, description: '云存储空间（GB）' },
                  recordingDays: { type: 'number', example: 7, description: '视频回看天数' },
                  aiNotificationsEnabled: { type: 'boolean', example: true },
                  features: { type: 'array', items: { type: 'string' }, example: ['视频直播', '7天回看', 'AI通知'] },
                },
              },
            },
          },
        },
      },
    },
  })
  async getPlans() {
    const plans = await this.subscriptionService.getAvailablePlans();
    return successResponse({ plans });
  }

  /**
   * 获取套餐详情
   */
  @Get('/plans/:planId')
  @ApiOperation({
    summary: '获取套餐详情',
    description: '获取指定订阅套餐的详细信息',
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
            planId: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string' },
            description: { type: 'string' },
            price: { type: 'number' },
            originalPrice: { type: 'number' },
            durationDays: { type: 'number' },
            storageGb: { type: 'number' },
            recordingDays: { type: 'number' },
            aiNotificationsEnabled: { type: 'boolean' },
            features: { type: 'array' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '套餐不存在',
  })
  @ApiParam({ name: 'planId', description: '套餐ID', example: 'monthly' })
  async getPlan(@Param('planId') planId: string) {
    const plan = await this.subscriptionService.getPlan(planId);

    if (!plan) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '套餐不存在或已下架');
    }

    return successResponse(plan);
  }

  // ==================== 订单管理 ====================

  /**
   * 创建订单
   */
  @Post('/orders')
  @ApiOperation({
    summary: '创建购买订单',
    description: '创建订阅购买订单',
  })
  @ApiResponse({
    status: 200,
    description: '订单创建成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            orderNo: { type: 'string', example: 'ORD202401011200001234' },
            amount: { type: 'number', example: 9900, description: '订单金额（分）' },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '创建失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiBody({
    description: '购买请求',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        planId: {
          type: 'string',
          description: '套餐ID',
          example: 'monthly',
        },
      },
      required: ['planId'],
    },
  })
  async createOrder(@Body() body: { planId: string }) {
    const userId = this.ctx.state.user.userId;

    const result = await this.subscriptionService.createOrder(userId, body.planId);

    if (!result.success) {
      return errorResponse(
        result.error === '套餐不存在或已下架' ? ErrorCode.RESOURCE_NOT_FOUND : ErrorCode.INTERNAL_SERVER_ERROR,
        result.error
      );
    }

    return successResponse({
      orderNo: result.order!.orderNo,
      amount: result.order!.amount,
      expiresAt: result.order!.expiresAt,
    });
  }

  /**
   * 支付订单
   */
  @Post('/orders/:orderNo/pay')
  @ApiOperation({
    summary: '支付订单',
    description: '支付订阅订单',
  })
  @ApiResponse({
    status: 200,
    description: '支付成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            subscription: {
              type: 'object',
              properties: {
                planId: { type: 'string' },
                status: { type: 'string', example: 'active' },
                startedAt: { type: 'string', format: 'date-time' },
                expiresAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '支付失败',
  })
  @ApiParam({ name: 'orderNo', description: '订单号', example: 'ORD202401011200001234' })
  @ApiBody({
    description: '支付请求',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        paymentMethod: {
          type: 'string',
          description: '支付方式',
          example: 'wechat',
          enum: ['wechat', 'alipay', 'apple_pay'],
        },
        transactionId: {
          type: 'string',
          description: '第三方交易号',
          example: 'wx_123456',
        },
      },
      required: ['paymentMethod'],
    },
  })
  async payOrder(@Param('orderNo') orderNo: string, @Body() body: {
    paymentMethod: string;
    transactionId?: string;
  }) {
    const userId = this.ctx.state.user.userId;

    // 通过订单号查找订单ID
    const order = await this.subscriptionService.orderRepository.findOne({
      where: { orderNo } as any,
    });

    if (!order) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '订单不存在');
    }

    const result = await this.subscriptionService.payOrder(order.id, userId, body.paymentMethod, body.transactionId);

    if (!result.success) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, result.error || '支付失败');
    }

    return successResponse({
      subscription: result.subscription,
    });
  }

  /**
   * 获取用户订单列表
   */
  @Get('/orders')
  @ApiOperation({
    summary: '获取订单列表',
    description: '获取用户的订阅订单列表',
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
            orders: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  orderNo: { type: 'string' },
                  planId: { type: 'string' },
                  amount: { type: 'number' },
                  status: { type: 'string', enum: ['pending', 'paid', 'cancelled', 'refunded', 'expired'] },
                  paymentMethod: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' },
                  paidAt: { type: 'string', format: 'date-time', nullable: true },
                },
              },
            },
            total: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiQuery({ name: 'status', description: '订单状态筛选', required: false })
  @ApiQuery({ name: 'limit', description: '返回数量', required: false, example: 20 })
  @ApiQuery({ name: 'offset', description: '偏移量', required: false, example: 0 })
  async getOrders(@Query() query: any) {
    const userId = this.ctx.state.user.userId;
    const result = await this.subscriptionService.getUserOrders(userId, {
      status: query.status,
      limit: query.limit ? parseInt(query.limit) : 20,
      offset: query.offset ? parseInt(query.offset) : 0,
    });

    return successResponse({
      orders: result.list,
      total: result.total,
    });
  }

  // ==================== 订阅管理 ====================

  /**
   * 获取用户订阅状态
   */
  @Get('/my-subscription')
  @ApiOperation({
    summary: '获取我的订阅',
    description: '获取当前用户的订阅状态',
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
            subscription: {
              type: 'object',
              properties: {
                planId: { type: 'string' },
                status: { type: 'string', example: 'active' },
                startedAt: { type: 'string', format: 'date-time' },
                expiresAt: { type: 'string', format: 'date-time' },
                autoRenew: { type: 'boolean' },
              },
            },
            plan: {
              type: 'object',
              properties: {
                planId: { type: 'string' },
                name: { type: 'string' },
                price: { type: 'number' },
                durationDays: { type: 'number' },
                storageGb: { type: 'number' },
                recordingDays: { type: 'number' },
                aiNotificationsEnabled: { type: 'boolean' },
              },
            },
            daysRemaining: { type: 'number', example: 25 },
            isExpired: { type: 'boolean' },
          },
        },
      },
    },
  })
  async getMySubscription() {
    const userId = this.ctx.state.user.userId;
    const result = await this.subscriptionService.getUserSubscription(userId);

    return successResponse(result);
  }

  /**
   * 续费
   */
  @Post('/my-subscription/renew')
  @ApiOperation({
    summary: '续费订阅',
    description: '续费当前的订阅套餐',
  })
  @ApiResponse({
    status: 200,
    description: '续费成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            subscription: { type: 'object' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '续费失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  })
  async renewSubscription() {
    const userId = this.ctx.state.user.userId;
    const result = await this.subscriptionService.renewSubscription(userId);

    if (!result.success) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, result.error || '续费失败');
    }

    return successResponse({
      subscription: result.subscription,
    });
  }

  /**
   * 取消订阅
   */
  @Del('/my-subscription')
  @ApiOperation({
    summary: '取消订阅',
    description: '取消当前的订阅，服务到期后不再续费',
  })
  @ApiResponse({
    status: 200,
    description: '取消成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '订阅已取消' },
      },
    },
  })
  async cancelSubscription() {
    const userId = this.ctx.state.user.userId;
    const result = await this.subscriptionService.cancelSubscription(userId);

    if (!result.success) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, result.error || '取消订阅失败');
    }

    return successResponse(undefined, '订阅已取消');
  }

  /**
   * 获取服务权益
   */
  @Get('/benefits')
  @ApiOperation({
    summary: '获取服务权益',
    description: '获取当前订阅的服务权益信息',
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
            planName: { type: 'string', example: '月度套餐' },
            benefits: {
              type: 'object',
              properties: {
                videoRecording: { type: 'boolean', example: true },
                recordingDays: { type: 'number', example: 7 },
                storageGb: { type: 'number', example: 30 },
                aiNotifications: { type: 'boolean', example: true },
              },
            },
          },
        },
      },
    },
  })
  async getBenefits() {
    const userId = this.ctx.state.user.userId;
    const benefits = await this.subscriptionService.getServiceBenefits(userId);

    return successResponse(benefits);
  }
}
