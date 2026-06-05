/**
 * 统一短信服务提供商
 *
 * 支持阿里云和腾讯云短信服务，通过配置切换。
 * 所有短信发送统一走此服务，避免多处重复实现。
 */
import { Provide, Scope, ScopeEnum, Init, Config, Inject } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import RPCClient from '@alicloud/pop-core';

/**
 * 短信服务提供商类型
 */
export type SMSProviderType = 'aliyun' | 'tencent' | 'mock';

/**
 * 阿里云短信配置
 */
export interface AliyunSMSProviderConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  endpoint?: string;
  apiVersion?: string;
}

/**
 * 腾讯云短信配置
 */
export interface TencentSMSProviderConfig {
  secretId: string;
  secretKey: string;
  region?: string;
  smsSdkAppId: string;
  signName: string;
}

/**
 * 统一短信配置
 */
export interface SMSProviderConfig {
  provider?: SMSProviderType;
  aliyun?: AliyunSMSProviderConfig;
  tencent?: TencentSMSProviderConfig;
}

/**
 * 发送短信参数
 */
export interface SendSMSOptions {
  /** 手机号码 */
  phoneNumber: string;
  /** 短信签名（不传则使用默认配置） */
  signName?: string;
  /** 模板 Code（阿里云）或模板 ID（腾讯云） */
  templateCode: string;
  /** 模板参数 */
  templateParams: Record<string, string>;
}

/**
 * 发送短信结果
 */
export interface SendSMSResult {
  success: boolean;
  requestId?: string;
  message?: string;
}

/**
 * 统一短信服务
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class SMSProviderService {
  @Inject()
  logger!: ILogger;

  @Config('sms')
  smsConfig!: SMSProviderConfig;

  private aliyunClient?: any;
  private tencentClient?: any;
  private resolvedProvider: SMSProviderType = 'mock';

  @Init()
  async init(): Promise<void> {
    // 优先使用 Midway 配置，fallback 到环境变量
    const provider = this.smsConfig?.provider || process.env.SMS_PROVIDER || 'mock';
    this.resolvedProvider = provider as SMSProviderType;

    // 验证 provider 值
    if (!['aliyun', 'tencent', 'mock'].includes(this.resolvedProvider)) {
      this.logger.warn(`[SMSProvider] Unknown provider "${this.resolvedProvider}", falling back to mock`);
      this.resolvedProvider = 'mock';
    }

    this.logger.info(`[SMSProvider] Initializing SMS provider: ${this.resolvedProvider}`);

    if (this.resolvedProvider === 'aliyun') {
      this.initAliyun();
    } else if (this.resolvedProvider === 'tencent') {
      this.initTencent();
    }
  }

  /**
   * 发送短信
   */
  async send(options: SendSMSOptions): Promise<SendSMSResult> {
    if (this.resolvedProvider === 'mock') {
      this.logger.info(`[SMSProvider] [MOCK] Send to ${options.phoneNumber}: template=${options.templateCode}, params=${JSON.stringify(options.templateParams)}`);
      return { success: true, message: 'Mock mode' };
    }

    if (this.resolvedProvider === 'aliyun') {
      return this.sendViaAliyun(options);
    }

    if (this.resolvedProvider === 'tencent') {
      return this.sendViaTencent(options);
    }

    return { success: false, message: 'Unknown provider' };
  }

  /**
   * 获取当前 provider 类型
   */
  getProvider(): SMSProviderType {
    return this.resolvedProvider;
  }

  // ==================== 私有方法 ====================

  private initAliyun(): void {
    const cfg = this.smsConfig?.aliyun;
    const accessKeyId = cfg?.accessKeyId || process.env.ALIYUN_ACCESS_KEY_ID;
    const accessKeySecret = cfg?.accessKeySecret || process.env.ALIYUN_ACCESS_KEY_SECRET;

    if (!accessKeyId || !accessKeySecret) {
      this.logger.warn('[SMSProvider] Aliyun credentials not configured, falling back to mock');
      this.resolvedProvider = 'mock';
      return;
    }

    this.aliyunClient = new RPCClient({
      accessKeyId,
      accessKeySecret,
      endpoint: cfg?.endpoint || 'https://dysmsapi.aliyuncs.com',
      apiVersion: cfg?.apiVersion || '2017-05-25',
    });
    this.logger.info('[SMSProvider] Aliyun SMS client initialized');
  }

  private initTencent(): void {
    const cfg = this.smsConfig?.tencent;
    const secretId = cfg?.secretId || process.env.TENCENT_SMS_SECRET_ID;
    const secretKey = cfg?.secretKey || process.env.TENCENT_SMS_SECRET_KEY;

    if (!secretId || !secretKey) {
      this.logger.warn('[SMSProvider] Tencent credentials not configured, falling back to mock');
      this.resolvedProvider = 'mock';
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tencentcloud = require('tencentcloud-sdk-nodejs');
    const TencentSmsClient = tencentcloud.sms.v20210111.Client;

    this.tencentClient = new TencentSmsClient({
      credential: { secretId, secretKey },
      region: cfg?.region || process.env.TENCENT_SMS_REGION || 'ap-guangzhou',
      profile: {
        httpProfile: {
          endpoint: 'sms.tencentcloudapi.com',
        },
      },
    });
    this.logger.info('[SMSProvider] Tencent Cloud SMS client initialized');
  }

  private async sendViaAliyun(options: SendSMSOptions): Promise<SendSMSResult> {
    if (!this.aliyunClient) {
      return { success: false, message: 'Aliyun SMS client not initialized' };
    }

    const cfg = this.smsConfig?.aliyun;
    const signName = options.signName || cfg?.signName || process.env.ALIYUN_SMS_SIGN_NAME || '';

    try {
      const result = await this.aliyunClient.request('SendSms', {
        PhoneNumbers: options.phoneNumber,
        SignName: signName,
        TemplateCode: options.templateCode,
        TemplateParam: JSON.stringify(options.templateParams),
      }, { method: 'POST' }) as { Code: string; Message?: string; RequestId?: string };

      if (result.Code === 'OK') {
        return { success: true, requestId: result.RequestId };
      }

      return { success: false, requestId: result.RequestId, message: `${result.Code} - ${result.Message}` };
    } catch (error: any) {
      return { success: false, message: error.message || 'Aliyun SMS send failed' };
    }
  }

  private async sendViaTencent(options: SendSMSOptions): Promise<SendSMSResult> {
    if (!this.tencentClient) {
      return { success: false, message: 'Tencent SMS client not initialized' };
    }

    const cfg = this.smsConfig?.tencent;
    const smsSdkAppId = cfg?.smsSdkAppId || process.env.TENCENT_SMS_SDK_APP_ID || '';
    const signName = options.signName || cfg?.signName || process.env.TENCENT_SMS_SIGN_NAME || '';
    const phone = options.phoneNumber.startsWith('+') ? options.phoneNumber : `+86${options.phoneNumber}`;

    try {
      const resp = await this.tencentClient.SendSms({
        SmsSdkAppId: smsSdkAppId,
        SignName: signName,
        TemplateId: options.templateCode,
        TemplateParamSet: Object.values(options.templateParams),
        PhoneNumberSet: [phone],
      });

      const status = resp.SendStatusSet?.[0];
      if (status?.Code === 'Ok') {
        return { success: true, requestId: resp.RequestId };
      }

      return { success: false, requestId: resp.RequestId, message: `${status?.Code} - ${status?.Message}` };
    } catch (error: any) {
      return { success: false, message: error.message || 'Tencent SMS send failed' };
    }
  }
}
