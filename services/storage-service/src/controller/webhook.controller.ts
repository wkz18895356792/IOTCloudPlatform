import { Controller, Post, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiTags } from '@midwayjs/swagger';
import { WebhookService } from '../service/webhook.service';
import { isSNSSubscriptionConfirmation, getSNSSubscribeURL } from '../util/webhook-event-parser';

/**
 * 云存储事件回调控制器
 *
 * 接收 AWS S3 / 腾讯云 COS / 阿里云 OSS 的对象创建事件通知，
 * 不使用 ServiceAuthMiddleware（云厂商无法提供内部 API Key），
 * 改用 webhook token 查询参数认证
 */
@ApiTags('Webhook')
@Controller('/api/storage/webhooks')
export class WebhookController {
  @Inject() ctx!: Context;
  @Inject() webhookService!: WebhookService;

  /**
   * 统一回调入口：自动识别云厂商
   *
   * POST /api/storage/webhooks/events?token=xxx
   */
  @Post('/events')
  async handleStorageEvent(@Query('token') token: string) {
    // 验证 token
    if (!this.webhookService.validateToken(token)) {
      this.ctx.status = 401;
      this.ctx.body = { success: false, message: 'Invalid webhook token' };
      return;
    }

    return this.processRequest();
  }

  /**
   * 指定厂商回调入口
   *
   * POST /api/storage/webhooks/events/aws_s3?token=xxx
   * POST /api/storage/webhooks/events/tencent_cos?token=xxx
   * POST /api/storage/webhooks/events/aliyun_oss?token=xxx
   */
  @Post('/events/:provider')
  async handleProviderEvent(
    @Param('provider') provider: string,
    @Query('token') token: string,
  ) {
    // 验证 token
    if (!this.webhookService.validateToken(token)) {
      this.ctx.status = 401;
      this.ctx.body = { success: false, message: 'Invalid webhook token' };
      return;
    }

    return this.processRequest(provider);
  }

  /**
   * 通用请求处理逻辑
   */
  private async processRequest(provider?: string) {
    const body = this.ctx.request.body;

    // 处理 SNS 订阅确认
    if (isSNSSubscriptionConfirmation(body)) {
      const subscribeURL = getSNSSubscribeURL(body);
      if (subscribeURL) {
        this.ctx.logger.info(`[Webhook] SNS SubscriptionConfirmation, confirming: ${subscribeURL}`);
        try {
          // 访问 SubscribeURL 完成订阅确认
          const https = require('https');
          const http = require('http');
          const client = subscribeURL.startsWith('https') ? https : http;
          client.get(subscribeURL);
        } catch (err) {
          this.ctx.logger.error('[Webhook] Failed to confirm SNS subscription:', err);
        }
      }
      this.ctx.body = { success: true };
      return;
    }

    // 解析事件
    const headers = this.ctx.headers as Record<string, string>;
    const events = this.webhookService.parseEvents(body, headers, provider);

    if (events.length === 0) {
      this.ctx.logger.info('[Webhook] No events parsed from request');
      this.ctx.body = { success: true, message: 'No events to process' };
      return;
    }

    // 逐个处理事件
    for (const event of events) {
      try {
        await this.webhookService.processStorageEvent(event);
      } catch (error: any) {
        this.ctx.logger.error(
          `[Webhook] Failed to process event: ${event.fileKey} from ${event.provider}`,
          error,
        );
        // DB 错误时返回 500，让云厂商重试
        this.ctx.status = 500;
        this.ctx.body = { success: false, message: 'Processing failed' };
        return;
      }
    }

    this.ctx.body = { success: true, processed: events.length };
  }
}
