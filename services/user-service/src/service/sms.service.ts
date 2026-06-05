import { Provide, Inject, Config } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { SMSProviderService } from '@baby-monitor/shared-utils';
import { VerificationCodeType, VerificationCodeChannel } from '@baby-monitor/shared-types';

/**
 * 短信服务
 * 负责发送短信验证码和通知，委托 SMSProviderService 处理实际的短信发送
 */
@Provide()
export class SMSService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  smsProviderService!: SMSProviderService;

  // 模板映射配置
  @Config('smsTemplates')
  private smsTemplates!: Record<string, Record<VerificationCodeType, string>>;

  /**
   * 发送短信验证码
   */
  async sendVerificationCode(
    phone: string,
    code: string,
    type: VerificationCodeType
  ): Promise<void> {
    console.log(`[SMS Service] Sending verification code to ${phone}, type: ${type}`);

    const templateCode = this.getTemplateCode(type);
    if (!templateCode) {
      console.log(`[SMS Service] Mock mode - No template for type ${type}: ${this.getSMSTemplate(code, type)}`);
      return;
    }

    const result = await this.smsProviderService.send({
      phoneNumber: phone,
      templateCode,
      templateParams: { code },
    });

    if (!result.success) {
      this.logger.error(`[SMS Service] Send failed: ${result.message}`);
      throw new Error(result.message || 'SMS send failed');
    }

    console.log(`[SMS Service] Sent to ${phone}, requestId: ${result.requestId}`);
  }

  /**
   * 发送通知短信
   */
  async sendNotification(phone: string, message: string): Promise<void> {
    this.logger.info(`[SMS Service] Sending notification to ${phone}`);

    const templateCode = this.getTemplateCode('notification' as VerificationCodeType);
    if (!templateCode) {
      this.logger.warn('[SMS Service] No notification template configured, skipping');
      return;
    }

    const result = await this.smsProviderService.send({
      phoneNumber: phone,
      templateCode,
      templateParams: { message },
    });

    if (!result.success) {
      this.logger.error(`[SMS Service] Notification failed: ${result.message}`);
      throw new Error(result.message || 'SMS send failed');
    }
  }

  /**
   * 发送告警短信
   */
  async sendAlert(phone: string, alert: string): Promise<void> {
    this.logger.info(`[SMS Service] Sending alert to ${phone}`);

    const templateCode = this.getTemplateCode('alert' as VerificationCodeType);
    if (!templateCode) {
      this.logger.warn('[SMS Service] No alert template configured, skipping');
      return;
    }

    const result = await this.smsProviderService.send({
      phoneNumber: phone,
      templateCode,
      templateParams: { alert },
    });

    if (!result.success) {
      this.logger.error(`[SMS Service] Alert failed: ${result.message}`);
      throw new Error(result.message || 'SMS send failed');
    }
  }

  /**
   * 根据当前 provider 获取对应的模板 Code
   */
  private getTemplateCode(type: VerificationCodeType): string | undefined {
    const provider = this.smsProviderService.getProvider();
    return this.smsTemplates?.[provider]?.[type];
  }

  /**
   * 获取短信文本模板（mock 模式使用）
   */
  private getSMSTemplate(code: string, type: VerificationCodeType): string {
    const templates: Record<VerificationCodeType, string> = {
      [VerificationCodeType.REGISTER]: `【智能家居】您的注册验证码是${code}，5分钟内有效。`,
      [VerificationCodeType.LOGIN]: `【智能家居】您的登录验证码是${code}，5分钟内有效。`,
      [VerificationCodeType.RESET_PASSWORD]: `【智能家居】您的密码重置验证码是${code}，5分钟内有效。`,
      [VerificationCodeType.BIND_PHONE]: `【智能家居】您的绑定手机验证码是${code}，5分钟内有效。`,
      [VerificationCodeType.CHANGE_PHONE]: `【智能家居】您的更换手机验证码是${code}，5分钟内有效。`,
      [VerificationCodeType.BIND_EMAIL]: '',
      [VerificationCodeType.CHANGE_EMAIL]: '',
    };
    return templates[type];
  }
}

/**
 * 验证码服务
 * 负责验证码的生成、发送、验证和过期管理
 * 支持短信和邮箱两种发送渠道
 */
@Provide()
export class VerificationCodeService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  smsService!: SMSService;

  private readonly CODE_EXPIRY = 300;

  generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendCode(
    target: string,
    type: VerificationCodeType,
    channel: VerificationCodeChannel
  ): Promise<{ success: boolean; message?: string }> {
    const rateLimitKey = `verify:rate:${target}:${type}`;
    const lastSent = await this.redis.get(rateLimitKey);
    console.log(`[Verification Code] Rate limit check for ${target}, type: ${type}, lastSent: ${lastSent}`);

    if (lastSent) {
      return {
        success: false,
        message: '验证码发送过于频繁，请稍后再试',
      };
    }

    const code = this.generateCode();
    console.log(`[Verification Code] Generated code: ${code}`);
    const codeKey = `verify:code:${code}`;

    try {
      await this.redis.setex(codeKey, this.CODE_EXPIRY, JSON.stringify({
        code,
        type,
        target,
        used: false,
      }));

      if (channel === VerificationCodeChannel.SMS) {
        await this.smsService.sendVerificationCode(target, code, type);
      }

      await this.redis.setex(rateLimitKey, 60, '1');
      console.log(`[Verification Code] Sent to ${target}, type: ${type}`);

      return { success: true };
    } catch (error) {
      console.error('[Verification Code] Send failed:', error);
      return {
        success: false,
        message: '验证码发送失败，请稍后重试',
      };
    }
  }

  async verifyCode(
    code: string,
    type: VerificationCodeType,
    target: string
  ): Promise<boolean> {
    const codeKey = `verify:code:${code}`;
    const data = await this.redis.get(codeKey);
    console.log(`[Verification Code] Verifying code: ${code}, type: ${type}, target: ${target}, data: ${data}`);

    if (!data) return false;

    const parsedData = JSON.parse(data);

    if (parsedData.used) return false;
    if (parsedData.type !== type) return false;
    if (parsedData.target !== target) return false;
    if (parsedData.code !== code) return false;

    parsedData.used = true;
    await this.redis.setex(codeKey, this.CODE_EXPIRY, JSON.stringify(parsedData));

    return true;
  }

  async hasCode(code: string): Promise<boolean> {
    const codeKey = `verify:code:${code}`;
    return (await this.redis.exists(codeKey)) === 1;
  }
}
