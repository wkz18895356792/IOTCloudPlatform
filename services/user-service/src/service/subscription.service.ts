import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { UserSubscription, SubscriptionOrder, SubscriptionPlan, SubscriptionStatus, OrderStatus, SubscriptionPlanType } from '../entity/subscription.entity';
import { IdGenerator } from '@baby-monitor/shared-utils';

/**
 * 订阅服务
 *
 * 处理订阅套餐、订单、支付等服务购买相关功能
 */
@Provide()
export class SubscriptionService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @InjectEntityModel(SubscriptionPlan)
  planRepository!: Repository<SubscriptionPlan>;

  @InjectEntityModel(UserSubscription)
  subscriptionRepository!: Repository<UserSubscription>;

  @InjectEntityModel(SubscriptionOrder)
  orderRepository!: Repository<SubscriptionOrder>;

  /**
   * 获取所有可用的套餐
   */
  async getAvailablePlans(): Promise<SubscriptionPlan[]> {
    return await this.planRepository.find({
      where: { isActive: true } as any,
      order: { sortOrder: 'ASC', price: 'ASC' } as any,
    });
  }

  /**
   * 获取套餐详情
   */
  async getPlan(planId: string): Promise<SubscriptionPlan | null> {
    return await this.planRepository.findOne({
      where: { planId, isActive: true } as any,
    });
  }

  /**
   * 获取用户当前订阅状态
   */
  async getUserSubscription(userId: string): Promise<{
    subscription: UserSubscription | null;
    plan: SubscriptionPlan | null;
    daysRemaining: number;
    isExpired: boolean;
  } | null> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { userId } as any,
      order: { createdAt: 'DESC' } as any,
    });

    if (!subscription) {
      return {
        subscription: null,
        plan: null,
        daysRemaining: 0,
        isExpired: false,
      };
    }

    const plan = await this.planRepository.findOne({
      where: { planId: subscription.planId } as any,
    });

    const now = new Date();
    const expiresAt = new Date(subscription.expiresAt);
    const daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const isExpired = subscription.status === SubscriptionStatus.EXPIRED || expiresAt < now;

    return {
      subscription,
      plan,
      daysRemaining,
      isExpired,
    };
  }

  /**
   * 创建购买订单
   */
  async createOrder(userId: string, planId: string): Promise<{
    success: boolean;
    order?: SubscriptionOrder;
    error?: string;
  }> {
    try {
      // 获取套餐信息
      const plan = await this.planRepository.findOne({
        where: { planId, isActive: true } as any,
      });

      if (!plan) {
        return {
          success: false,
          error: '套餐不存在或已下架',
        };
      }

      // 检查是否有未支付的订单
      const existingOrder = await this.orderRepository.findOne({
        where: {
          userId,
          planId,
          status: OrderStatus.PENDING,
        } as any,
      });

      if (existingOrder) {
        // 检查订单是否已过期（30分钟）
        const expiresAt = new Date(existingOrder.createdAt.getTime() + 30 * 60 * 1000);
        if (expiresAt > new Date()) {
          return {
            success: false,
            error: '有待支付的订单',
            order: existingOrder,
          };
        }
      }

      // 创建订单
      const order = this.orderRepository.create({
        id: IdGenerator.uuid(),
        orderNo: this.generateOrderNo(),
        userId,
        planId,
        amount: plan.price,
        status: OrderStatus.PENDING,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30分钟后过期
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const saved = await this.orderRepository.save(order);

      this.logger.info(`[Subscription] Created order ${saved.orderNo} for user ${userId}, plan ${planId}`);

      return {
        success: true,
        order: saved,
      };
    } catch (error) {
      this.logger.error('[Subscription] Create order error:', error);
      return {
        success: false,
        error: '创建订单失败',
      };
    }
  }

  /**
   * 支付订单
   */
  async payOrder(orderId: string, userId: string, paymentMethod: string, transactionId?: string): Promise<{
    success: boolean;
    subscription?: UserSubscription;
    error?: string;
  }> {
    try {
      const order = await this.orderRepository.findOne({
        where: { id: orderId, userId } as any,
      });

      if (!order) {
        return {
          success: false,
          error: '订单不存在',
        };
      }

      if (order.status !== OrderStatus.PENDING) {
        return {
          success: false,
          error: '订单状态不正确',
        };
      }

      // 检查订单是否过期
      if (order.expiresAt && order.expiresAt < new Date()) {
        order.status = OrderStatus.EXPIRED;
        await this.orderRepository.save(order);
        return {
          success: false,
          error: '订单已过期',
        };
      }

      // 获取套餐信息
      const plan = await this.planRepository.findOne({
        where: { planId: order.planId } as any,
      });

      if (!plan) {
        return {
          success: false,
          error: '套餐不存在',
        };
      }

      // 这里应该调用实际的支付接口进行支付
      // 暂时模拟支付成功

      // 更新订单状态
      order.status = OrderStatus.PAID;
      order.paidAmount = order.amount;
      order.paymentMethod = paymentMethod;
      order.transactionId = transactionId || `TXN_${Date.now()}`;
      order.paidAt = new Date();
      order.updatedAt = new Date();

      await this.orderRepository.save(order);

      // 创建或更新订阅
      const subscription = await this.activateSubscription(userId, order.planId);

      this.logger.info(`[Subscription] Order ${order.orderNo} paid, subscription activated for user ${userId}`);

      return {
        success: true,
        subscription,
      };
    } catch (error) {
      this.logger.error('[Subscription] Pay order error:', error);
      return {
        success: false,
        error: '支付失败',
      };
    }
  }

  /**
   * 激活订阅
   */
  async activateSubscription(userId: string, planId: string): Promise<UserSubscription> {
    const plan = await this.planRepository.findOne({
      where: { planId } as any,
    });

    if (!plan) {
      throw new Error('套餐不存在');
    }

    // 查找现有订阅
    let subscription = await this.subscriptionRepository.findOne({
      where: { userId } as any,
      order: { createdAt: 'DESC' } as any,
    });

    const now = new Date();
    const startedAt = subscription?.expiresAt && subscription.expiresAt > now ? subscription.expiresAt : now;
    const expiresAt = new Date(startedAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    if (subscription) {
      // 更新现有订阅
      subscription.planId = planId;
      subscription.status = SubscriptionStatus.ACTIVE;
      subscription.startedAt = startedAt;
      subscription.expiresAt = expiresAt;
      subscription.cancelledAt = null;
      subscription.updatedAt = now;

      subscription = await this.subscriptionRepository.save(subscription);
    } else {
      // 创建新订阅
      subscription = this.subscriptionRepository.create({
        id: IdGenerator.uuid(),
        userId,
        planId,
        status: SubscriptionStatus.ACTIVE,
        startedAt: now,
        expiresAt,
        autoRenew: false,
        createdAt: now,
        updatedAt: now,
      });

      subscription = await this.subscriptionRepository.save(subscription);
    }

    return subscription;
  }

  /**
   * 续费
   */
  async renewSubscription(userId: string): Promise<{
    success: boolean;
    subscription?: UserSubscription;
    error?: string;
  }> {
    try {
      const result = await this.getUserSubscription(userId);

      if (!result || !result.subscription || !result.plan) {
        return {
          success: false,
          error: '无有效订阅',
        };
      }

      // 检查是否已过期
      if (result.daysRemaining > 0 && result.subscription.status === SubscriptionStatus.ACTIVE) {
        return {
          success: false,
          error: '订阅尚未到期',
        };
      }

      // 创建续费订单
      const orderResult = await this.createOrder(userId, result.subscription.planId);

      if (!orderResult.success) {
        return orderResult;
      }

      // 支付续费订单（这里应该调用实际支付接口）
      const payResult = await this.payOrder(orderResult.order!.id, userId, 'renew');

      return payResult;
    } catch (error) {
      this.logger.error('[Subscription] Renew subscription error:', error);
      return {
        success: false,
        error: '续费失败',
      };
    }
  }

  /**
   * 取消订阅
   */
  async cancelSubscription(userId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const subscription = await this.subscriptionRepository.findOne({
        where: { userId } as any,
      });

      if (!subscription) {
        return {
          success: false,
          error: '订阅不存在',
        };
      }

      if (subscription.status !== SubscriptionStatus.ACTIVE) {
        return {
          success: false,
          error: '订阅状态不正确',
        };
      }

      subscription.status = SubscriptionStatus.CANCELLED;
      subscription.autoRenew = false;
      subscription.cancelledAt = new Date();
      subscription.updatedAt = new Date();

      await this.subscriptionRepository.save(subscription);

      this.logger.info(`[Subscription] User ${userId} cancelled subscription`);

      return { success: true };
    } catch (error) {
      this.logger.error('[Subscription] Cancel subscription error:', error);
      return {
        success: false,
        error: '取消订阅失败',
      };
    }
  }

  /**
   * 获取用户订单列表
   */
  async getUserOrders(userId: string, options?: {
    status?: OrderStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ list: SubscriptionOrder[]; total: number }> {
    const queryBuilder = this.orderRepository.createQueryBuilder('order')
      .where('order.userId = :userId', { userId });

    if (options?.status) {
      queryBuilder.andWhere('order.status = :status', { status: options.status });
    }

    const total = await queryBuilder.getCount();

    queryBuilder
      .orderBy('order.createdAt', 'DESC')
      .limit(options?.limit || 20)
      .offset(options?.offset || 0);

    const list = await queryBuilder.getMany();

    return { list, total };
  }

  /**
   * 清理过期订单
   */
  async cleanExpiredOrders(): Promise<number> {
    const result = await this.orderRepository
      .createQueryBuilder()
      .where({
        status: OrderStatus.PENDING,
        expiresAt: LessThan(new Date()),
      } as any)
      .getMany();

    if (result.length === 0) {
      return 0;
    }

    await this.orderRepository.remove(result);

    this.logger.info(`[Subscription] Cleaned ${result.length} expired orders`);

    return result.length;
  }

  /**
   * 检查并更新过期订阅
   */
  async checkExpiredSubscriptions(): Promise<number> {
    const result = await this.subscriptionRepository
      .createQueryBuilder()
      .where({
        status: SubscriptionStatus.ACTIVE,
        expiresAt: LessThan(new Date()),
      } as any)
      .getMany();

    if (result.length === 0) {
      return 0;
    }

    for (const subscription of result) {
      subscription.status = SubscriptionStatus.EXPIRED;
      subscription.updatedAt = new Date();
    }

    await this.subscriptionRepository.save(result);

    this.logger.info(`[Subscription] Marked ${result.length} subscriptions as expired`);

    return result.length;
  }

  /**
   * 获取服务权益信息
   */
  async getServiceBenefits(userId: string): Promise<{
    planName: string | null;
    benefits: {
      videoRecording: boolean;
      recordingDays: number;
      storageGb: number;
      aiNotifications: boolean;
    };
  }> {
    const result = await this.getUserSubscription(userId);

    if (!result || !result.plan || result.isExpired) {
      return {
        planName: null,
        benefits: {
          videoRecording: false,
          recordingDays: 0,
          storageGb: 0,
          aiNotifications: false,
        },
      };
    }

    return {
      planName: result.plan.name,
      benefits: {
        videoRecording: true,
        recordingDays: result.plan.recordingDays,
        storageGb: result.plan.storageGb,
        aiNotifications: result.plan.aiNotificationsEnabled,
      },
    };
  }

  /**
   * 生成订单号
   */
  private generateOrderNo(): string {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0') +
      now.getHours().toString().padStart(2, '0') +
      now.getMinutes().toString().padStart(2, '0') +
      now.getSeconds().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');

    return `ORD${timestamp}${random}`;
  }
}
