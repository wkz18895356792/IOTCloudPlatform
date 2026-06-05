/**
 * 支付网关服务
 *
 * 提供统一的支付接口，支持支付宝和微信支付
 *
 * 支持的支付方式：
 * - 支付宝：网页支付、APP支付、扫码支付
 * - 微信：JSAPI支付、APP支付、Native支付、H5支付
 *
 * 集成官方 SDK：
 * - alipay-sdk: 支付宝官方 SDK
 * - wechatpay-node-v3: 微信支付 V3 API SDK
 */
import { Provide, Inject, Config, Scope, ScopeEnum, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { CacheManager, IdGenerator, SignatureUtil } from '@baby-monitor/shared-utils';
import AlipaySdk from 'alipay-sdk';
import AlipayFormData from 'alipay-sdk/lib/form';
// @ts-ignore - wechatpay-node-v3 doesn't have proper type definitions
import WechatPay from 'wechatpay-node-v3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * 支付渠道
 */
export enum PaymentChannel {
  ALIPAY = 'alipay',
  WECHAT = 'wechat',
}

/**
 * 支付方式
 */
export enum PaymentMethod {
  // 支付宝
  ALIPAY_WEB = 'alipay_web', // 网页支付
  ALIPAY_APP = 'alipay_app', // APP支付
  ALIPAY_QR = 'alipay_qr', // 扫码支付
  ALIPAY_WAP = 'alipay_wap', // 移动端网页支付

  // 微信
  WECHAT_JSAPI = 'wechat_jsapi', // JSAPI支付（公众号）
  WECHAT_APP = 'wechat_app', // APP支付
  WECHAT_NATIVE = 'wechat_native', // Native支付（扫码）
  WECHAT_H5 = 'wechat_h5', // H5支付
}

/**
 * 支付状态
 */
export enum PaymentStatus {
  PENDING = 'pending', // 待支付
  PAYING = 'paying', // 支付中
  SUCCESS = 'success', // 支付成功
  FAILED = 'failed', // 支付失败
  CLOSED = 'closed', // 已关闭
  REFUNDED = 'refunded', // 已退款
  PARTIAL_REFUNDED = 'partial_refunded', // 部分退款
}

/**
 * 退款状态
 */
export enum RefundStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
  CLOSED = 'closed',
}

/**
 * 支付订单
 */
export interface PaymentOrder {
  orderId: string; // 系统订单号
  outTradeNo: string; // 商户订单号
  channel: PaymentChannel;
  method: PaymentMethod;
  amount: number; // 金额（分）
  currency: string;
  subject: string;
  body: string;
  status: PaymentStatus;
  userId: string;
  productId?: string;
  extra?: Record<string, any>;
  createdAt: Date;
  expiredAt: Date;
  paidAt?: Date;
  closedAt?: Date;
  transactionId?: string; // 第三方交易号
}

/**
 * 支付参数
 */
export interface PaymentParams {
  orderId: string;
  channel: PaymentChannel;
  method: PaymentMethod;
  amount: number;
  subject: string;
  body: string;
  userId: string;
  productId?: string;
  notifyUrl?: string;
  returnUrl?: string;
  extra?: Record<string, any>;
  // 微信支付特有
  openid?: string; // JSAPI 支付需要
  // 支付宝特有
  qrPayMode?: string;
}

/**
 * 支付结果
 */
export interface PaymentResult {
  success: boolean;
  orderId: string;
  outTradeNo: string;
  prepayId?: string; // 预支付ID
  qrCode?: string; // 二维码链接
  payUrl?: string; // 支付页面URL
  appPayload?: Record<string, any>; // APP支付参数
  jsapiParams?: Record<string, any>; // JSAPI支付参数
  expiredAt?: Date;
  error?: string;
}

/**
 * 退款参数
 */
export interface RefundParams {
  orderId: string;
  refundId: string;
  amount: number;
  reason: string;
  notifyUrl?: string;
}

/**
 * 退款结果
 */
export interface RefundResult {
  success: boolean;
  refundId: string;
  outRefundNo: string;
  transactionRefundId?: string; // 第三方退款单号
  status: RefundStatus;
  error?: string;
}

/**
 * 支付通知
 */
export interface PaymentNotify {
  orderId: string;
  outTradeNo: string;
  transactionId: string;
  amount: number;
  status: PaymentStatus;
  paidAt: Date;
  channel: PaymentChannel;
  rawData: Record<string, any>;
}

/**
 * 支付配置
 */
export interface PaymentConfig {
  alipay: {
    appId: string;
    privateKey: string;
    alipayPublicKey: string;
    gateway?: string;
    notifyUrl: string;
    returnUrl: string;
    sandbox?: boolean;
  };
  wechat: {
    appId: string;
    mchId: string;
    apiV3Key: string;
    serialNo: string;
    privateKey: string;
    notifyUrl: string;
    /** 可选：直接提供证书内容 */
    publicKey?: string;
    /** 可选：证书文件路径 */
    publicKeyPath?: string;
  };
}

/**
 * 支付网关服务
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class PaymentGatewayService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  @Config('payment')
  paymentConfig: PaymentConfig;

  private readonly ORDER_PREFIX = 'payment:order:';
  private readonly ORDER_TTL = 86400 * 30; // 30天

  // 支付宝 SDK 实例
  private alipaySdk: AlipaySdk | null = null;

  // 微信支付 SDK 实例
  // @ts-ignore
  private wechatPay: any = null;

  // 订单缓存
  private orders: Map<string, PaymentOrder> = new Map();

  @Init()
  async init(): Promise<void> {
    this.logger.info('[Payment Gateway] Initializing payment gateway service...');

    // 初始化支付宝 SDK
    if (this.paymentConfig?.alipay) {
      try {
        this.alipaySdk = new AlipaySdk({
          appId: this.paymentConfig.alipay.appId,
          privateKey: this.paymentConfig.alipay.privateKey,
          alipayPublicKey: this.paymentConfig.alipay.alipayPublicKey,
          gateway: this.paymentConfig.alipay.gateway ||
            (this.paymentConfig.alipay.sandbox
              ? 'https://openapi.alipaydev.com/gateway.do'
              : 'https://openapi.alipay.com/gateway.do'),
        });
        this.logger.info('[Payment Gateway] Alipay SDK initialized');
      } catch (error: any) {
        this.logger.error('[Payment Gateway] Failed to initialize Alipay SDK:', error);
      }
    }

    // 初始化微信支付 SDK
    if (this.paymentConfig?.wechat) {
      try {
        let publicKey = this.paymentConfig.wechat.publicKey;
        if (!publicKey && this.paymentConfig.wechat.publicKeyPath) {
          publicKey = fs.readFileSync(
            path.resolve(this.paymentConfig.wechat.publicKeyPath),
            'utf-8'
          );
        }

        // @ts-ignore - wechatpay-node-v3 types are incomplete
        this.wechatPay = new WechatPay({
          appid: this.paymentConfig.wechat.appId,
          mchid: this.paymentConfig.wechat.mchId,
          serial_no: this.paymentConfig.wechat.serialNo,
          privateKey: Buffer.from(this.paymentConfig.wechat.privateKey),
          publicKey: Buffer.from(publicKey || ''),
        });
        this.logger.info('[Payment Gateway] WeChat Pay SDK initialized');
      } catch (error: any) {
        this.logger.error('[Payment Gateway] Failed to initialize WeChat Pay SDK:', error);
      }
    }

    await this.loadPendingOrders();
    this.logger.info('[Payment Gateway] Payment gateway service initialized');
  }

  // ==================== 统一下单 ====================

  /**
   * 创建支付订单
   */
  async createPayment(params: PaymentParams): Promise<PaymentResult> {
    this.logger.info('[Payment Gateway] Creating payment order...', {
      orderId: params.orderId,
      channel: params.channel,
      method: params.method,
      amount: params.amount,
    });

    // 生成商户订单号
    const outTradeNo = this.generateOutTradeNo(params.channel);

    // 创建订单记录
    const order: PaymentOrder = {
      orderId: params.orderId,
      outTradeNo,
      channel: params.channel,
      method: params.method,
      amount: params.amount,
      currency: 'CNY',
      subject: params.subject,
      body: params.body,
      status: PaymentStatus.PENDING,
      userId: params.userId,
      productId: params.productId,
      extra: params.extra,
      createdAt: new Date(),
      expiredAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2小时过期
    };

    // 保存订单
    await this.saveOrder(order);

    // 根据渠道调用对应的支付接口
    let result: PaymentResult;

    switch (params.channel) {
      case PaymentChannel.ALIPAY:
        result = await this.createAlipayPayment(order, params);
        break;
      case PaymentChannel.WECHAT:
        result = await this.createWechatPayment(order, params);
        break;
      default:
        result = {
          success: false,
          orderId: order.orderId,
          outTradeNo: order.outTradeNo,
          error: 'Unsupported payment channel',
        };
    }

    return result;
  }

  /**
   * 查询支付状态
   */
  async queryPayment(orderId: string): Promise<PaymentOrder | null> {
    const order = await this.getOrder(orderId);
    if (!order) {
      return null;
    }

    // 如果订单还在待支付状态，查询第三方状态
    if (order.status === PaymentStatus.PENDING || order.status === PaymentStatus.PAYING) {
      const thirdPartyStatus = await this.queryThirdPartyStatus(order);

      if (thirdPartyStatus && thirdPartyStatus !== order.status) {
        order.status = thirdPartyStatus;
        if (thirdPartyStatus === PaymentStatus.SUCCESS) {
          order.paidAt = new Date();
        }
        await this.saveOrder(order);
      }
    }

    return order;
  }

  /**
   * 关闭订单
   */
  async closePayment(orderId: string): Promise<{ success: boolean; error?: string }> {
    const order = await this.getOrder(orderId);
    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    if (order.status !== PaymentStatus.PENDING) {
      return { success: false, error: 'Order cannot be closed' };
    }

    try {
      // 调用第三方关闭接口
      if (order.channel === PaymentChannel.ALIPAY) {
        await this.closeAlipayOrder(order);
      } else if (order.channel === PaymentChannel.WECHAT) {
        await this.closeWechatOrder(order);
      }

      order.status = PaymentStatus.CLOSED;
      order.closedAt = new Date();
      await this.saveOrder(order);

      return { success: true };
    } catch (error: any) {
      this.logger.error('[Payment Gateway] Failed to close order:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== 退款 ====================

  /**
   * 申请退款
   */
  async refund(params: RefundParams): Promise<RefundResult> {
    const order = await this.getOrder(params.orderId);
    if (!order) {
      return {
        success: false,
        refundId: params.refundId,
        outRefundNo: '',
        status: RefundStatus.FAILED,
        error: 'Order not found',
      };
    }

    if (order.status !== PaymentStatus.SUCCESS) {
      return {
        success: false,
        refundId: params.refundId,
        outRefundNo: '',
        status: RefundStatus.FAILED,
        error: 'Order cannot be refunded',
      };
    }

    const outRefundNo = this.generateRefundNo();

    try {
      let result: RefundResult;

      if (order.channel === PaymentChannel.ALIPAY) {
        result = await this.refundAlipay(order, params, outRefundNo);
      } else if (order.channel === PaymentChannel.WECHAT) {
        result = await this.refundWechat(order, params, outRefundNo);
      } else {
        result = {
          success: false,
          refundId: params.refundId,
          outRefundNo,
          status: RefundStatus.FAILED,
          error: 'Unsupported channel',
        };
      }

      if (result.success) {
        order.status = PaymentStatus.REFUNDED;
        await this.saveOrder(order);
      }

      return result;
    } catch (error: any) {
      this.logger.error('[Payment Gateway] Refund failed:', error);
      return {
        success: false,
        refundId: params.refundId,
        outRefundNo,
        status: RefundStatus.FAILED,
        error: error.message,
      };
    }
  }

  // ==================== 支付宝支付 (使用 alipay-sdk) ====================

  /**
   * 创建支付宝支付
   */
  private async createAlipayPayment(order: PaymentOrder, params: PaymentParams): Promise<PaymentResult> {
    if (!this.alipaySdk) {
      return {
        success: false,
        orderId: order.orderId,
        outTradeNo: order.outTradeNo,
        error: 'Alipay SDK not initialized',
      };
    }

    try {
      const notifyUrl = params.notifyUrl || this.paymentConfig?.alipay?.notifyUrl;
      const returnUrl = params.returnUrl || this.paymentConfig?.alipay?.returnUrl;

      switch (params.method) {
        case PaymentMethod.ALIPAY_WEB: {
          // 网页支付
          const formData = new AlipayFormData();
          formData.setMethod('get');
          formData.addField('returnUrl', returnUrl);
          formData.addField('notifyUrl', notifyUrl);
          formData.addField('bizContent', {
            out_trade_no: order.outTradeNo,
            product_code: 'FAST_INSTANT_TRADE_PAY',
            total_amount: (order.amount / 100).toFixed(2),
            subject: order.subject,
            body: order.body,
          });

          const result = await this.alipaySdk.exec('alipay.trade.page.pay', {}, { formData });
          const payUrl = typeof result === 'string' ? result : (result as any).body || '';
          return {
            success: true,
            orderId: order.orderId,
            outTradeNo: order.outTradeNo,
            payUrl,
            expiredAt: order.expiredAt,
          };
        }

        case PaymentMethod.ALIPAY_WAP: {
          // 移动端网页支付
          const formData = new AlipayFormData();
          formData.setMethod('get');
          formData.addField('returnUrl', returnUrl);
          formData.addField('notifyUrl', notifyUrl);
          formData.addField('bizContent', {
            out_trade_no: order.outTradeNo,
            product_code: 'QUICK_WAP_WAY',
            total_amount: (order.amount / 100).toFixed(2),
            subject: order.subject,
            body: order.body,
          });

          const result = await this.alipaySdk.exec('alipay.trade.wap.pay', {}, { formData });
          const payUrl = typeof result === 'string' ? result : (result as any).body || '';
          return {
            success: true,
            orderId: order.orderId,
            outTradeNo: order.outTradeNo,
            payUrl,
            expiredAt: order.expiredAt,
          };
        }

        case PaymentMethod.ALIPAY_APP: {
          // APP 支付
          const formData = new AlipayFormData();
          formData.setMethod('get');
          formData.addField('notifyUrl', notifyUrl);
          formData.addField('bizContent', {
            out_trade_no: order.outTradeNo,
            product_code: 'QUICK_MSECURITY_PAY',
            total_amount: (order.amount / 100).toFixed(2),
            subject: order.subject,
            body: order.body,
          });

          const result = await this.alipaySdk.exec('alipay.trade.app.pay', {}, { formData });
          const orderString = typeof result === 'string' ? result : (result as any).body || '';
          return {
            success: true,
            orderId: order.orderId,
            outTradeNo: order.outTradeNo,
            appPayload: { orderString },
            expiredAt: order.expiredAt,
          };
        }

        case PaymentMethod.ALIPAY_QR: {
          // 扫码支付
          const formData = new AlipayFormData();
          formData.setMethod('get');
          formData.addField('notifyUrl', notifyUrl);
          formData.addField('bizContent', {
            out_trade_no: order.outTradeNo,
            total_amount: (order.amount / 100).toFixed(2),
            subject: order.subject,
            body: order.body,
          });

          const result = await this.alipaySdk.exec('alipay.trade.precreate', {}, { formData });
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          const response = JSON.parse(resultStr);

          if (response.alipay_trade_precreate_response?.code === '10000') {
            return {
              success: true,
              orderId: order.orderId,
              outTradeNo: order.outTradeNo,
              qrCode: response.alipay_trade_precreate_response.qr_code,
              expiredAt: order.expiredAt,
            };
          } else {
            return {
              success: false,
              orderId: order.orderId,
              outTradeNo: order.outTradeNo,
              error: response.alipay_trade_precreate_response?.msg || 'Precreate failed',
            };
          }
        }

        default:
          return {
            success: false,
            orderId: order.orderId,
            outTradeNo: order.outTradeNo,
            error: 'Unsupported Alipay payment method',
          };
      }
    } catch (error: any) {
      this.logger.error('[Payment Gateway] Alipay payment failed:', error);
      return {
        success: false,
        orderId: order.orderId,
        outTradeNo: order.outTradeNo,
        error: error.message,
      };
    }
  }

  /**
   * 关闭支付宝订单
   */
  private async closeAlipayOrder(order: PaymentOrder): Promise<void> {
    if (!this.alipaySdk) {
      throw new Error('Alipay SDK not initialized');
    }

    const formData = new AlipayFormData();
    formData.addField('bizContent', {
      out_trade_no: order.outTradeNo,
    });

    const result = await this.alipaySdk.exec('alipay.trade.close', {}, { formData });
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const response = JSON.parse(resultStr);

    if (response.alipay_trade_close_response?.code !== '10000') {
      throw new Error(response.alipay_trade_close_response?.msg || 'Close order failed');
    }

    this.logger.info('[Payment Gateway] Alipay order closed:', order.outTradeNo);
  }

  /**
   * 支付宝退款
   */
  private async refundAlipay(
    order: PaymentOrder,
    params: RefundParams,
    outRefundNo: string
  ): Promise<RefundResult> {
    if (!this.alipaySdk) {
      return {
        success: false,
        refundId: params.refundId,
        outRefundNo,
        status: RefundStatus.FAILED,
        error: 'Alipay SDK not initialized',
      };
    }

    try {
      const formData = new AlipayFormData();
      formData.addField('bizContent', {
        out_trade_no: order.outTradeNo,
        refund_amount: (params.amount / 100).toFixed(2),
        refund_reason: params.reason,
        out_request_no: outRefundNo,
      });

      const result = await this.alipaySdk.exec('alipay.trade.refund', {}, { formData });
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      const response = JSON.parse(resultStr);

      if (response.alipay_trade_refund_response?.code === '10000') {
        return {
          success: true,
          refundId: params.refundId,
          outRefundNo,
          transactionRefundId: response.alipay_trade_refund_response.trade_no,
          status: RefundStatus.SUCCESS,
        };
      } else {
        return {
          success: false,
          refundId: params.refundId,
          outRefundNo,
          status: RefundStatus.FAILED,
          error: response.alipay_trade_refund_response?.msg || 'Refund failed',
        };
      }
    } catch (error: any) {
      this.logger.error('[Payment Gateway] Alipay refund failed:', error);
      return {
        success: false,
        refundId: params.refundId,
        outRefundNo,
        status: RefundStatus.FAILED,
        error: error.message,
      };
    }
  }

  /**
   * 查询支付宝订单状态
   */
  private async queryAlipayOrder(order: PaymentOrder): Promise<PaymentStatus | null> {
    if (!this.alipaySdk) {
      return null;
    }

    try {
      const formData = new AlipayFormData();
      formData.addField('bizContent', {
        out_trade_no: order.outTradeNo,
      });

      const result = await this.alipaySdk.exec('alipay.trade.query', {}, { formData });
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      const response = JSON.parse(resultStr);

      if (response.alipay_trade_query_response?.code === '10000') {
        const tradeStatus = response.alipay_trade_query_response.trade_status;
        switch (tradeStatus) {
          case 'TRADE_SUCCESS':
          case 'TRADE_FINISHED':
            return PaymentStatus.SUCCESS;
          case 'WAIT_BUYER_PAY':
            return PaymentStatus.PENDING;
          case 'TRADE_CLOSED':
            return PaymentStatus.CLOSED;
          default:
            return PaymentStatus.FAILED;
        }
      }

      return null;
    } catch (error: any) {
      this.logger.error('[Payment Gateway] Alipay query failed:', error);
      return null;
    }
  }

  // ==================== 微信支付 (使用 wechatpay-node-v3) ====================

  /**
   * 创建微信支付
   */
  private async createWechatPayment(order: PaymentOrder, params: PaymentParams): Promise<PaymentResult> {
    if (!this.wechatPay) {
      return {
        success: false,
        orderId: order.orderId,
        outTradeNo: order.outTradeNo,
        error: 'WeChat Pay SDK not initialized',
      };
    }

    try {
      const notifyUrl = params.notifyUrl || this.paymentConfig?.wechat?.notifyUrl;

      const baseParams = {
        appid: this.paymentConfig.wechat.appId,
        mchid: this.paymentConfig.wechat.mchId,
        description: order.subject,
        out_trade_no: order.outTradeNo,
        notify_url: notifyUrl,
        amount: {
          total: order.amount,
          currency: 'CNY',
        },
      };

      switch (params.method) {
        case PaymentMethod.WECHAT_NATIVE: {
          // Native 扫码支付
          const result = await this.wechatPay.native({
            ...baseParams,
          });

          return {
            success: true,
            orderId: order.orderId,
            outTradeNo: order.outTradeNo,
            prepayId: result.prepay_id,
            qrCode: result.code_url,
            expiredAt: order.expiredAt,
          };
        }

        case PaymentMethod.WECHAT_JSAPI: {
          // JSAPI 公众号支付
          if (!params.openid) {
            return {
              success: false,
              orderId: order.orderId,
              outTradeNo: order.outTradeNo,
              error: 'OpenID is required for JSAPI payment',
            };
          }

          const result = await this.wechatPay.jsapi({
            ...baseParams,
            payer: {
              openid: params.openid,
            },
          });

          const jsapiParams = this.buildWechatJsapiParams(result.prepay_id);

          return {
            success: true,
            orderId: order.orderId,
            outTradeNo: order.outTradeNo,
            prepayId: result.prepay_id,
            jsapiParams,
            expiredAt: order.expiredAt,
          };
        }

        case PaymentMethod.WECHAT_APP: {
          // APP 支付
          const result = await this.wechatPay.app({
            ...baseParams,
          });

          const appPayload = this.buildWechatAppParams(result.prepay_id);

          return {
            success: true,
            orderId: order.orderId,
            outTradeNo: order.outTradeNo,
            prepayId: result.prepay_id,
            appPayload,
            expiredAt: order.expiredAt,
          };
        }

        case PaymentMethod.WECHAT_H5: {
          // H5 支付
          const result = await this.wechatPay.h5({
            ...baseParams,
            scene_info: {
              payer_client_ip: '127.0.0.1',
              h5_info: {
                type: 'Wap',
              },
            },
          });

          return {
            success: true,
            orderId: order.orderId,
            outTradeNo: order.outTradeNo,
            prepayId: result.prepay_id,
            payUrl: result.h5_url,
            expiredAt: order.expiredAt,
          };
        }

        default:
          return {
            success: false,
            orderId: order.orderId,
            outTradeNo: order.outTradeNo,
            error: 'Unsupported WeChat payment method',
          };
      }
    } catch (error: any) {
      this.logger.error('[Payment Gateway] WeChat payment failed:', error);
      return {
        success: false,
        orderId: order.orderId,
        outTradeNo: order.outTradeNo,
        error: error.message,
      };
    }
  }

  /**
   * 构建微信 JSAPI 支付参数
   */
  private buildWechatJsapiParams(prepayId: string): Record<string, any> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const packageStr = `prepay_id=${prepayId}`;
    const appId = this.paymentConfig?.wechat?.appId || '';

    // 使用 V3 签名
    const message = `${appId}\n${timestamp}\n${nonceStr}\n${packageStr}\n`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    const paySign = sign.sign(this.paymentConfig?.wechat?.privateKey, 'base64');

    return {
      appId,
      timeStamp: timestamp,
      nonceStr,
      package: packageStr,
      signType: 'RSA',
      paySign,
    };
  }

  /**
   * 构建微信 APP 支付参数
   */
  private buildWechatAppParams(prepayId: string): Record<string, any> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const appId = this.paymentConfig?.wechat?.appId || '';
    const mchId = this.paymentConfig?.wechat?.mchId || '';

    // 使用 V3 签名
    const message = `${appId}\n${timestamp}\n${nonceStr}\n${prepayId}\n`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    const paySign = sign.sign(this.paymentConfig?.wechat?.privateKey, 'base64');

    return {
      appid: appId,
      partnerid: mchId,
      prepayid: prepayId,
      package: 'Sign=WXPay',
      noncestr: nonceStr,
      timestamp,
      sign: paySign,
    };
  }

  /**
   * 关闭微信订单
   */
  private async closeWechatOrder(order: PaymentOrder): Promise<void> {
    if (!this.wechatPay) {
      throw new Error('WeChat Pay SDK not initialized');
    }

    await this.wechatPay.close({
      out_trade_no: order.outTradeNo,
      mchid: this.paymentConfig?.wechat?.mchId,
    });

    this.logger.info('[Payment Gateway] WeChat order closed:', order.outTradeNo);
  }

  /**
   * 微信退款
   */
  private async refundWechat(
    order: PaymentOrder,
    params: RefundParams,
    outRefundNo: string
  ): Promise<RefundResult> {
    if (!this.wechatPay) {
      return {
        success: false,
        refundId: params.refundId,
        outRefundNo,
        status: RefundStatus.FAILED,
        error: 'WeChat Pay SDK not initialized',
      };
    }

    try {
      const result = await this.wechatPay.refunds({
        out_trade_no: order.outTradeNo,
        out_refund_no: outRefundNo,
        reason: params.reason,
        amount: {
          refund: params.amount,
          total: order.amount,
          currency: 'CNY',
        },
        notify_url: params.notifyUrl,
      });

      const status = result.status === 'SUCCESS' ? RefundStatus.SUCCESS :
        result.status === 'PROCESSING' ? RefundStatus.PROCESSING :
          RefundStatus.FAILED;

      return {
        success: status === RefundStatus.SUCCESS || status === RefundStatus.PROCESSING,
        refundId: params.refundId,
        outRefundNo,
        transactionRefundId: result.refund_id,
        status,
      };
    } catch (error: any) {
      this.logger.error('[Payment Gateway] WeChat refund failed:', error);
      return {
        success: false,
        refundId: params.refundId,
        outRefundNo,
        status: RefundStatus.FAILED,
        error: error.message,
      };
    }
  }

  /**
   * 查询微信订单状态
   */
  private async queryWechatOrder(order: PaymentOrder): Promise<PaymentStatus | null> {
    if (!this.wechatPay) {
      return null;
    }

    try {
      const result = await this.wechatPay.query({
        out_trade_no: order.outTradeNo,
        mchid: this.paymentConfig?.wechat?.mchId,
      });

      const tradeState = result.trade_state;
      switch (tradeState) {
        case 'SUCCESS':
          return PaymentStatus.SUCCESS;
        case 'NOTPAY':
        case 'USERPAYING':
          return PaymentStatus.PENDING;
        case 'CLOSED':
        case 'PAYERROR':
          return PaymentStatus.CLOSED;
        case 'REFUND':
          return PaymentStatus.REFUNDED;
        default:
          return PaymentStatus.PENDING;
      }
    } catch (error: any) {
      this.logger.error('[Payment Gateway] WeChat query failed:', error);
      return null;
    }
  }

  // ==================== 通知处理 ====================

  /**
   * 处理支付通知
   */
  async handlePaymentNotify(
    channel: PaymentChannel,
    rawData: Record<string, any>
  ): Promise<{ success: boolean; orderId?: string }> {
    this.logger.info('[Payment Gateway] Processing payment notify...', { channel });

    try {
      // 验证签名
      const signValid = await this.verifyNotifySign(channel, rawData);
      if (!signValid) {
        this.logger.error('[Payment Gateway] Invalid notify signature');
        return { success: false };
      }

      // 解析通知内容
      const notify = await this.parseNotify(channel, rawData);

      // 更新订单状态
      const order = await this.getOrderByOutTradeNo(notify.outTradeNo);
      if (!order) {
        this.logger.error('[Payment Gateway] Order not found for notify:', notify.outTradeNo);
        return { success: false };
      }

      if (notify.status === PaymentStatus.SUCCESS) {
        order.status = PaymentStatus.SUCCESS;
        order.paidAt = notify.paidAt;
        order.transactionId = notify.transactionId;
      } else if (notify.status === PaymentStatus.FAILED) {
        order.status = PaymentStatus.FAILED;
      }

      await this.saveOrder(order);

      // 触发订单回调
      await this.triggerOrderCallback(order);

      return { success: true, orderId: order.orderId };
    } catch (error: any) {
      this.logger.error('[Payment Gateway] Failed to process notify:', error);
      return { success: false };
    }
  }

  /**
   * 验证支付宝回调签名
   */
  async verifyAlipayNotifySign(data: Record<string, any>): Promise<boolean> {
    if (!this.alipaySdk) {
      return false;
    }

    try {
      // alipay-sdk 内置验签方法
      const sign = data.sign;
      const signType = data.sign_type || 'RSA2';
      delete data.sign;
      delete data.sign_type;

      const verify = crypto.createVerify('RSA-SHA256');
      const sortedParams = Object.keys(data)
        .sort()
        .map(key => `${key}=${data[key]}`)
        .join('&');
      verify.update(sortedParams);

      return verify.verify(this.paymentConfig?.alipay?.alipayPublicKey, sign, 'base64');
    } catch (error: any) {
      this.logger.error('[Payment Gateway] Alipay verify sign failed:', error);
      return false;
    }
  }

  /**
   * 验证微信回调签名
   */
  async verifyWechatNotifySign(
    timestamp: string,
    nonce: string,
    body: string,
    signature: string
  ): Promise<boolean> {
    if (!this.paymentConfig?.wechat?.publicKey) {
      return false;
    }

    try {
      const message = `${timestamp}\n${nonce}\n${body}\n`;
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(message);

      return verify.verify(this.paymentConfig.wechat.publicKey, signature, 'base64');
    } catch (error: any) {
      this.logger.error('[Payment Gateway] WeChat verify sign failed:', error);
      return false;
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 生成商户订单号
   */
  private generateOutTradeNo(channel: PaymentChannel): string {
    const prefix = channel === PaymentChannel.ALIPAY ? 'ALI' : 'WX';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  /**
   * 生成退款单号
   */
  private generateRefundNo(): string {
    return `RF${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }

  /**
   * 验证通知签名
   */
  private async verifyNotifySign(channel: PaymentChannel, data: Record<string, any>): Promise<boolean> {
    if (channel === PaymentChannel.ALIPAY) {
      return this.verifyAlipayNotifySign(data);
    } else {
      // 微信支付需要从 headers 中获取签名信息
      return true; // 实际需要验证
    }
  }

  /**
   * 解析通知内容
   */
  private async parseNotify(channel: PaymentChannel, data: Record<string, any>): Promise<PaymentNotify> {
    if (channel === PaymentChannel.ALIPAY) {
      return {
        orderId: '',
        outTradeNo: data.out_trade_no,
        transactionId: data.trade_no,
        amount: Math.round(parseFloat(data.total_amount) * 100),
        status: data.trade_status === 'TRADE_SUCCESS' ? PaymentStatus.SUCCESS : PaymentStatus.FAILED,
        paidAt: new Date(data.gmt_payment),
        channel,
        rawData: data,
      };
    } else {
      // 微信支付通知格式
      const resource = data.resource;
      return {
        orderId: '',
        outTradeNo: resource.out_trade_no,
        transactionId: resource.transaction_id,
        amount: resource.amount.total,
        status: resource.trade_state === 'SUCCESS' ? PaymentStatus.SUCCESS : PaymentStatus.FAILED,
        paidAt: new Date(resource.success_time),
        channel,
        rawData: data,
      };
    }
  }

  /**
   * 保存订单
   */
  private async saveOrder(order: PaymentOrder): Promise<void> {
    const key = `${this.ORDER_PREFIX}${order.orderId}`;
    await this.redis.set(key, JSON.stringify(order));
    await this.redis.expire(key, this.ORDER_TTL);
    this.orders.set(order.orderId, order);
  }

  /**
   * 获取订单
   */
  private async getOrder(orderId: string): Promise<PaymentOrder | null> {
    let order = this.orders.get(orderId);
    if (order) {
      return order;
    }

    const key = `${this.ORDER_PREFIX}${orderId}`;
    const data = await this.redis.get(key);
    if (data) {
      order = JSON.parse(data);
      if (order) {
        this.orders.set(orderId, order);
      }
      return order ?? null;
    }

    return null;
  }

  /**
   * 通过商户订单号获取订单
   */
  private async getOrderByOutTradeNo(outTradeNo: string): Promise<PaymentOrder | null> {
    // 遍历查找
    for (const order of this.orders.values()) {
      if (order.outTradeNo === outTradeNo) {
        return order;
      }
    }
    return null;
  }

  /**
   * 加载待处理的订单
   */
  private async loadPendingOrders(): Promise<void> {
    const keys = await this.redis.keys(`${this.ORDER_PREFIX}*`);
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const order = JSON.parse(data);
        if (order.status === PaymentStatus.PENDING || order.status === PaymentStatus.PAYING) {
          this.orders.set(order.orderId, order);
        }
      }
    }
    this.logger.info(`[Payment Gateway] Loaded ${this.orders.size} pending orders`);
  }

  /**
   * 查询第三方支付状态
   */
  private async queryThirdPartyStatus(order: PaymentOrder): Promise<PaymentStatus | null> {
    if (order.channel === PaymentChannel.ALIPAY) {
      return this.queryAlipayOrder(order);
    } else if (order.channel === PaymentChannel.WECHAT) {
      return this.queryWechatOrder(order);
    }
    return null;
  }

  /**
   * 触发订单回调
   */
  private async triggerOrderCallback(order: PaymentOrder): Promise<void> {
    this.logger.info('[Payment Gateway] Order callback triggered:', order.orderId);
    // 实际实现需要通知业务系统订单状态变更
  }
}
