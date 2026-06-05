import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 订阅套餐类型
 */
export enum SubscriptionPlanType {
  /** 月度套餐 */
  MONTHLY = 'monthly',
  /** 季度套餐 */
  QUARTERLY = 'quarterly',
  /** 半年套餐 */
  SEMI_ANNUAL = 'semi_annual',
  /** 年度套餐 */
  ANNUAL = 'annual',
}

/**
 * 订阅状态
 */
export enum SubscriptionStatus {
  /** 正常 */
  ACTIVE = 'active',
  /** 过期 */
  EXPIRED = 'expired',
  /** 待支付 */
  PENDING = 'pending',
  /** 已取消 */
  CANCELLED = 'cancelled',
}

/**
 * 订单状态
 */
export enum OrderStatus {
  /** 待支付 */
  PENDING = 'pending',
  /** 已支付 */
  PAID = 'paid',
  /** 已取消 */
  CANCELLED = 'cancelled',
  /** 已退款 */
  REFUNDED = 'refunded',
  /** 已过期 */
  EXPIRED = 'expired',
}

/**
 * 订阅套餐实体
 *
 * 定义可购买的订阅套餐
 */
@Entity('subscription_plans')
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plan_id', type: 'varchar', length: 64, unique: true })
  planId: string;

  /**
   * 套餐名称
   */
  @Column({ name: 'name', type: 'varchar', length: 100 })
  name: string;

  /**
   * 套餐类型
   */
  @Column({
    name: 'type',
    type: 'enum',
    enum: SubscriptionPlanType,
  })
  type: SubscriptionPlanType;

  /**
   * 套餐描述
   */
  @Column({ name: 'description', type: 'text', nullable: true })
  description: string;

  /**
   * 价格（分）
   */
  @Column({ name: 'price', type: 'int' })
  price: number;

  /**
   * 原价（分），用于显示折扣
   */
  @Column({ name: 'original_price', type: 'int', nullable: true })
  originalPrice: number;

  /**
   * 套餐时长（天）
   */
  @Column({ name: 'duration_days', type: 'int' })
  durationDays: number;

  /**
   * 云存储空间（GB）
   */
  @Column({ name: 'storage_gb', type: 'int', default: 30 })
  storageGb: number;

  /**
   * 视频回看天数
   */
  @Column({ name: 'recording_days', type: 'int', default: 7 })
  recordingDays: number;

  /**
   * 是否包含AI通知
   */
  @Column({ name: 'ai_notifications_enabled', type: 'boolean', default: true })
  aiNotificationsEnabled: boolean;

  /**
   * 是否启用（是否可购买）
   */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * 排序顺序
   */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /**
   * 套餐特性列表（JSON）
   */
  @Column({ name: 'features', type: 'json', nullable: true })
  features: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

/**
 * 用户订阅实体
 *
 * 记录用户的订阅状态
 */
@Entity('user_subscriptions')
export class UserSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 64 })
  @Index()
  userId: string;

  @Column({ name: 'plan_id', type: 'varchar', length: 64 })
  planId: string;

  /**
   * 订阅状态
   */
  @Column({
    name: 'status',
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  /**
   * 订阅开始时间
   */
  @Column({ name: 'started_at', type: 'timestamp' })
  startedAt: Date;

  /**
   * 订阅结束时间
   */
  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  /**
   * 自动续费开关
   */
  @Column({ name: 'auto_renew', type: 'boolean', default: false })
  autoRenew: boolean;

  /**
   * 取消时间
   */
  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

/**
 * 订单实体
 *
 * 记录购买订阅的订单
 */
@Entity('subscription_orders')
export class SubscriptionOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_no', type: 'varchar', length: 64, unique: true })
  orderNo: string;

  @Column({ name: 'user_id', type: 'varchar', length: 64 })
  @Index()
  userId: string;

  @Column({ name: 'plan_id', type: 'varchar', length: 64 })
  planId: string;

  /**
   * 订单状态
   */
  @Column({
    name: 'status',
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  /**
   * 订单金额（分）
   */
  @Column({ name: 'amount', type: 'int' })
  amount: number;

  /**
   * 实际支付金额（分）
   */
  @Column({ name: 'paid_amount', type: 'int', nullable: true })
  paidAmount: number;

  /**
   * 支付方式
   */
  @Column({ name: 'payment_method', type: 'varchar', length: 50, nullable: true })
  paymentMethod: string;

  /**
   * 第三方交易号
   */
  @Column({ name: 'transaction_id', type: 'varchar', length: 128, nullable: true })
  transactionId: string;

  /**
   * 支付时间
   */
  @Column({ name: 'paid_at', type: 'timestamp', nullable: true })
  paidAt: Date;

  /**
   * 订单过期时间
   */
  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
