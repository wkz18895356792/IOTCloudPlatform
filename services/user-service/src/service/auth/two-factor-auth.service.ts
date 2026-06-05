/**
 * 双因素认证服务 (2FA)
 *
 * 支持三种认证方式：
 * 1. SMS OTP - 短信验证码
 * 2. TOTP - 基于时间的一次性密码 (如 Google Authenticator)
 * 3. Email OTP - 邮箱验证码 (nodemailer)
 *
 * 短信发送委托统一 SMSProviderService 处理
 */
import { Provide, Inject, Config, Scope, ScopeEnum, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { CacheManager, IdGenerator, SMSProviderService } from '@baby-monitor/shared-utils';
import nodemailer, { Transporter } from 'nodemailer';
import crypto from 'crypto';

/**
 * 2FA 类型
 */
export enum TwoFactorType {
  SMS = 'sms',
  TOTP = 'totp',
  EMAIL = 'email',
}

/**
 * 2FA 状态
 */
export enum TwoFactorStatus {
  DISABLED = 'disabled',
  PENDING = 'pending', // 待验证
  ENABLED = 'enabled',
}

/**
 * 2FA 配置
 */
export interface TwoFactorConfig {
  userId: string;
  type: TwoFactorType;
  status: TwoFactorStatus;
  secret?: string; // TOTP 密钥
  backupCodes?: string[]; // 备用码
  phoneNumber?: string; // 手机号 (SMS)
  email?: string; // 邮箱
  enabledAt?: Date;
  lastUsedAt?: Date;
  failedAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * TOTP 设置结果
 */
export interface TOTPSetupResult {
  success: boolean;
  secret?: string;
  qrCodeUrl?: string;
  manualEntryKey?: string;
  backupCodes?: string[];
  error?: string;
}

/**
 * 验证结果
 */
export interface VerificationResult {
  success: boolean;
  remainingAttempts?: number;
  lockedUntil?: Date;
  error?: string;
}

/**
 * 短信验证码配置
 */
interface SMSConfig {
  provider: 'aliyun' | 'tencent' | 'mock';
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
  expireSeconds: number;
  /** 阿里云 endpoint */
  endpoint?: string;
  /** 腾讯云配置 */
  tencent?: {
    secretId: string;
    secretKey: string;
    region: string;
    smsSdkAppId: string;
  };
}

/**
 * 邮件配置
 */
interface EmailConfig {
  provider: 'smtp' | 'mock';
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
  expireSeconds: number;
}

/**
 * TOTP 配置
 */
interface TOTPConfig {
  issuer: string;
  digits: number;
  period: number;
  window: number; // 时间窗口（前后允许的周期数）
}

/**
 * 2FA 服务配置
 */
interface TwoFactorServiceConfig {
  sms: SMSConfig;
  email: EmailConfig;
  totp: TOTPConfig;
  maxAttempts: number;
  lockoutDuration: number; // 锁定时间（秒）
  codeLength: number;
}

/**
 * 双因素认证服务
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class TwoFactorAuthService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  @Config('twoFactor')
  config: TwoFactorServiceConfig;

  @Inject()
  smsProviderService!: SMSProviderService;

  private readonly CONFIG_PREFIX = '2fa:config:';
  private readonly CODE_PREFIX = '2fa:code:';
  private readonly ATTEMPTS_PREFIX = '2fa:attempts:';
  private readonly LOCKOUT_PREFIX = '2fa:lockout:';

  private readonly CODE_TTL = 300; // 5分钟
  private readonly CONFIG_TTL = 86400 * 365; // 1年

  // nodemailer 实例
  private emailTransporter: Transporter | null = null;

  @Init()
  async init(): Promise<void> {
    this.logger.info('[2FA] Initializing two-factor auth service...');

    // 初始化 nodemailer
    if (this.config?.email?.provider === 'smtp' && this.config?.email?.host) {
      try {
        this.emailTransporter = nodemailer.createTransport({
          host: this.config.email.host,
          port: this.config.email.port,
          secure: this.config.email.secure,
          auth: {
            user: this.config.email.auth.user,
            pass: this.config.email.auth.pass,
          },
        });
        this.logger.info('[2FA] Nodemailer initialized');
      } catch (error: any) {
        this.logger.error('[2FA] Failed to initialize nodemailer:', error);
      }
    }

    this.logger.info('[2FA] Two-factor auth service initialized');
  }

  /**
   * 初始化 TOTP 设置
   *
   * 生成密钥和二维码 URL
   */
  async setupTOTP(userId: string, email: string): Promise<TOTPSetupResult> {
    this.logger.info('[2FA] Setting up TOTP for user:', userId);

    try {
      // 检查是否已启用
      const existingConfig = await this.getConfig(userId);
      if (existingConfig && existingConfig.status === TwoFactorStatus.ENABLED) {
        return {
          success: false,
          error: '2FA is already enabled. Disable it first to set up again.',
        };
      }

      // 生成密钥
      const secret = this.generateTOTPSecret();

      // 生成备用码
      const backupCodes = this.generateBackupCodes();

      // 生成二维码 URL
      const issuer = this.config?.totp?.issuer || 'BabyMonitor';
      const accountName = email;
      const otpauthUrl = this.buildOTPAuthUrl(issuer, accountName, secret);

      // 保存待验证的配置
      const newConfig: TwoFactorConfig = {
        userId,
        type: TwoFactorType.TOTP,
        status: TwoFactorStatus.PENDING,
        secret,
        backupCodes,
        email,
        failedAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.saveConfig(userId, newConfig);

      return {
        success: true,
        secret,
        qrCodeUrl: otpauthUrl,
        manualEntryKey: this.formatSecretForDisplay(secret),
        backupCodes,
      };
    } catch (error: any) {
      this.logger.error('[2FA] Failed to setup TOTP:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 初始化 SMS 设置
   */
  async setupSMS(userId: string, phoneNumber: string): Promise<{ success: boolean; error?: string }> {
    this.logger.info('[2FA] Setting up SMS for user:', userId);

    try {
      // 检查是否已启用
      const existingConfig = await this.getConfig(userId);
      if (existingConfig && existingConfig.status === TwoFactorStatus.ENABLED) {
        return {
          success: false,
          error: '2FA is already enabled. Disable it first to set up again.',
        };
      }

      // 验证手机号格式
      if (!this.validatePhoneNumber(phoneNumber)) {
        return {
          success: false,
          error: 'Invalid phone number format',
        };
      }

      // 保存待验证的配置
      const newConfig: TwoFactorConfig = {
        userId,
        type: TwoFactorType.SMS,
        status: TwoFactorStatus.PENDING,
        phoneNumber,
        backupCodes: this.generateBackupCodes(),
        failedAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.saveConfig(userId, newConfig);

      // 发送验证码
      const sendResult = await this.sendSMSCode(userId, phoneNumber);
      if (!sendResult.success) {
        return {
          success: false,
          error: sendResult.error,
        };
      }

      return { success: true };
    } catch (error: any) {
      this.logger.error('[2FA] Failed to setup SMS:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 验证并启用 2FA
   */
  async verifyAndEnable(userId: string, code: string): Promise<VerificationResult> {
    this.logger.info('[2FA] Verifying and enabling 2FA for user:', userId);

    const config = await this.getConfig(userId);
    if (!config) {
      return { success: false, error: '2FA not set up' };
    }

    if (config.status !== TwoFactorStatus.PENDING) {
      return { success: false, error: '2FA is not in pending state' };
    }

    // 检查是否被锁定
    const lockout = await this.getLockout(userId);
    if (lockout) {
      return {
        success: false,
        lockedUntil: lockout,
        error: 'Account is temporarily locked',
      };
    }

    // 验证码验证
    let valid = false;
    if (config.type === TwoFactorType.TOTP) {
      valid = this.verifyTOTP(config.secret!, code);
    } else if (config.type === TwoFactorType.SMS) {
      valid = await this.verifySMSCode(userId, code);
    }

    if (!valid) {
      // 记录失败尝试
      const attempts = await this.recordFailedAttempt(userId);
      const remaining = this.config?.maxAttempts || 5;

      if (attempts >= remaining) {
        await this.lockAccount(userId);
        return {
          success: false,
          remainingAttempts: 0,
          error: 'Too many failed attempts. Account locked.',
        };
      }

      return {
        success: false,
        remainingAttempts: remaining - attempts,
        error: 'Invalid verification code',
      };
    }

    // 启用 2FA
    config.status = TwoFactorStatus.ENABLED;
    config.enabledAt = new Date();
    config.updatedAt = new Date();
    await this.saveConfig(userId, config);

    // 清除失败尝试记录
    await this.clearFailedAttempts(userId);

    this.logger.info('[2FA] 2FA enabled successfully for user:', userId);

    return { success: true };
  }

  /**
   * 禁用 2FA
   */
  async disable(userId: string, code: string): Promise<VerificationResult> {
    this.logger.info('[2FA] Disabling 2FA for user:', userId);

    const config = await this.getConfig(userId);
    if (!config || config.status !== TwoFactorStatus.ENABLED) {
      return { success: false, error: '2FA is not enabled' };
    }

    // 验证码验证
    const result = await this.verify(userId, code);
    if (!result.success) {
      return result;
    }

    // 禁用 2FA
    config.status = TwoFactorStatus.DISABLED;
    config.secret = undefined;
    config.updatedAt = new Date();
    await this.saveConfig(userId, config);

    this.logger.info('[2FA] 2FA disabled for user:', userId);

    return { success: true };
  }

  /**
   * 验证 2FA 代码
   */
  async verify(userId: string, code: string): Promise<VerificationResult> {
    const config = await this.getConfig(userId);
    if (!config || config.status !== TwoFactorStatus.ENABLED) {
      return { success: false, error: '2FA is not enabled' };
    }

    // 检查是否被锁定
    const lockout = await this.getLockout(userId);
    if (lockout) {
      return {
        success: false,
        lockedUntil: lockout,
        error: 'Account is temporarily locked',
      };
    }

    // 检查是否为备用码
    if (config.backupCodes && config.backupCodes.includes(code)) {
      // 移除已使用的备用码
      config.backupCodes = config.backupCodes.filter(c => c !== code);
      config.lastUsedAt = new Date();
      await this.saveConfig(userId, config);
      await this.clearFailedAttempts(userId);
      return { success: true };
    }

    // 验证码验证
    let valid = false;
    if (config.type === TwoFactorType.TOTP) {
      valid = this.verifyTOTP(config.secret!, code);
    } else if (config.type === TwoFactorType.SMS) {
      valid = await this.verifySMSCode(userId, code);
    } else if (config.type === TwoFactorType.EMAIL) {
      valid = await this.verifyEmailCode(userId, code);
    }

    if (!valid) {
      const attempts = await this.recordFailedAttempt(userId);
      const remaining = (this.config?.maxAttempts || 5) - attempts;

      if (remaining <= 0) {
        await this.lockAccount(userId);
        return {
          success: false,
          remainingAttempts: 0,
          error: 'Too many failed attempts. Account locked.',
        };
      }

      return {
        success: false,
        remainingAttempts: remaining,
        error: 'Invalid verification code',
      };
    }

    // 更新最后使用时间
    config.lastUsedAt = new Date();
    await this.saveConfig(userId, config);

    // 清除失败尝试记录
    await this.clearFailedAttempts(userId);

    return { success: true };
  }

  /**
   * 发送验证码 (SMS)
   */
  async sendSMSCode(userId: string, phoneNumber?: string): Promise<{ success: boolean; error?: string }> {
    const config = await this.getConfig(userId);
    const phone = phoneNumber || config?.phoneNumber;

    if (!phone) {
      return { success: false, error: 'Phone number not found' };
    }

    // 生成验证码
    const code = this.generateNumericCode(this.config?.codeLength || 6);

    // 保存验证码
    const key = `${this.CODE_PREFIX}sms:${userId}`;
    await this.redis.setex(key, this.config?.sms?.expireSeconds || this.CODE_TTL, code);

    // 发送短信
    try {
      await this.sendSMS(phone, code);
      this.logger.info('[2FA] SMS code sent to:', phone);
      return { success: true };
    } catch (error: any) {
      this.logger.error('[2FA] Failed to send SMS:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 发送验证码 (Email)
   */
  async sendEmailCode(userId: string, email: string): Promise<{ success: boolean; error?: string }> {
    // 生成验证码
    const code = this.generateNumericCode(this.config?.codeLength || 6);

    // 保存验证码
    const key = `${this.CODE_PREFIX}email:${userId}`;
    await this.redis.setex(key, this.config?.email?.expireSeconds || this.CODE_TTL, code);

    // 发送邮件
    try {
      const provider = this.config?.email?.provider || 'mock';

      if (provider === 'mock') {
        // 模拟发送
        this.logger.info(`[2FA] [MOCK] Email code sent to ${email}: code=${code}`);
        return { success: true };
      }

      if (provider === 'smtp') {
        if (!this.emailTransporter) {
          throw new Error('Email transporter not initialized');
        }

        const mailOptions = {
          from: this.config?.email?.from || 'noreply@example.com',
          to: email,
          subject: '您的验证码 - BabyMonitor',
          text: `您的验证码是：${code}，有效期5分钟，请勿泄露给他人。`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">BabyMonitor 验证码</h2>
              <p style="font-size: 16px;">您的验证码是：</p>
              <p style="font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 8px;">${code}</p>
              <p style="color: #666; font-size: 14px;">验证码有效期5分钟，请勿泄露给他人。</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="color: #999; font-size: 12px;">此邮件由系统自动发送，请勿回复。</p>
            </div>
          `,
        };

        const info = await this.emailTransporter.sendMail(mailOptions);
        this.logger.info(`[2FA] Email sent to ${email}, messageId: ${info.messageId}`);
      }

      return { success: true };
    } catch (error: any) {
      this.logger.error('[2FA] Failed to send email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取 2FA 配置
   */
  async getConfig(userId: string): Promise<TwoFactorConfig | null> {
    const key = `${this.CONFIG_PREFIX}${userId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * 获取 2FA 状态
   */
  async getStatus(userId: string): Promise<{
    enabled: boolean;
    type?: TwoFactorType;
    pending: boolean;
    phoneNumber?: string;
    email?: string;
  }> {
    const config = await this.getConfig(userId);

    if (!config) {
      return { enabled: false, pending: false };
    }

    return {
      enabled: config.status === TwoFactorStatus.ENABLED,
      type: config.type,
      pending: config.status === TwoFactorStatus.PENDING,
      phoneNumber: config.phoneNumber ? this.maskPhoneNumber(config.phoneNumber) : undefined,
      email: config.email,
    };
  }

  /**
   * 生成新的备用码
   */
  async regenerateBackupCodes(userId: string): Promise<string[] | null> {
    const config = await this.getConfig(userId);
    if (!config || config.status !== TwoFactorStatus.ENABLED) {
      return null;
    }

    const backupCodes = this.generateBackupCodes();
    config.backupCodes = backupCodes;
    config.updatedAt = new Date();
    await this.saveConfig(userId, config);

    return backupCodes;
  }

  // ==================== 私有方法 ====================

  /**
   * 生成 TOTP 密钥
   */
  private generateTOTPSecret(): string {
    // 生成 20 字节（160 位）的密钥
    const buffer = crypto.randomBytes(20);
    return buffer.toString('base64').replace(/=/g, '');
  }

  /**
   * 构建 OTP Auth URL
   */
  private buildOTPAuthUrl(issuer: string, accountName: string, secret: string): string {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(accountName);
    return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${this.config?.totp?.digits || 6}&period=${this.config?.totp?.period || 30}`;
  }

  /**
   * 格式化密钥用于手动输入
   */
  private formatSecretForDisplay(secret: string): string {
    // 每 4 个字符添加一个空格
    return secret.match(/.{1,4}/g)?.join(' ') || secret;
  }

  /**
   * 生成备用码
   */
  private generateBackupCodes(count: number = 8): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      codes.push(this.generateNumericCode(8));
    }
    return codes;
  }

  /**
   * 生成数字验证码
   */
  private generateNumericCode(length: number): string {
    let code = '';
    for (let i = 0; i < length; i++) {
      code += Math.floor(Math.random() * 10).toString();
    }
    return code;
  }

  /**
   * 验证 TOTP 码
   */
  private verifyTOTP(secret: string, code: string): boolean {
    try {
      const decodedSecret = Buffer.from(secret, 'base64');
      const counter = Math.floor(Date.now() / 1000 / (this.config?.totp?.period || 30));
      const window = this.config?.totp?.window || 1;
      const digits = this.config?.totp?.digits || 6;

      // 检查时间窗口内的所有可能值
      for (let i = -window; i <= window; i++) {
        const expectedCode = this.generateTOTPCode(decodedSecret, counter + i, digits);
        if (this.safeCompare(code, expectedCode)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error('[2FA] TOTP verification error:', error);
      return false;
    }
  }

  /**
   * 生成 TOTP 码
   */
  private generateTOTPCode(secret: Buffer, counter: number, digits: number): string {
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(BigInt(counter), 0);

    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(buffer);
    const hmacResult = hmac.digest();

    const offset = hmacResult[hmacResult.length - 1] & 0x0f;
    const binary = ((hmacResult[offset] & 0x7f) << 24) |
      ((hmacResult[offset + 1] & 0xff) << 16) |
      ((hmacResult[offset + 2] & 0xff) << 8) |
      (hmacResult[offset + 3] & 0xff);

    const otp = binary % Math.pow(10, digits);
    return otp.toString().padStart(digits, '0');
  }

  /**
   * 安全比较字符串
   */
  private safeCompare(a: string, b: string): boolean {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  /**
   * 验证 SMS 验证码
   */
  private async verifySMSCode(userId: string, code: string): Promise<boolean> {
    const key = `${this.CODE_PREFIX}sms:${userId}`;
    const storedCode = await this.redis.get(key);

    if (!storedCode) {
      return false;
    }

    // 验证后删除验证码
    await this.redis.del(key);

    return storedCode === code;
  }

  /**
   * 验证 Email 验证码
   */
  private async verifyEmailCode(userId: string, code: string): Promise<boolean> {
    const key = `${this.CODE_PREFIX}email:${userId}`;
    const storedCode = await this.redis.get(key);

    if (!storedCode) {
      return false;
    }

    await this.redis.del(key);
    return storedCode === code;
  }

  /**
   * 发送短信 (委托统一 SMSProviderService)
   */
  private async sendSMS(phoneNumber: string, code: string): Promise<void> {
    const result = await this.smsProviderService.send({
      phoneNumber,
      templateCode: this.config?.sms?.templateCode || '',
      templateParams: { code },
    });

    if (!result.success) {
      throw new Error(result.message || 'SMS send failed');
    }

    this.logger.info(`[2FA] SMS sent to ${phoneNumber}, requestId: ${result.requestId}`);
  }

  /**
   * 验证手机号格式
   */
  private validatePhoneNumber(phoneNumber: string): boolean {
    // 中国大陆手机号
    const regex = /^1[3-9]\d{9}$/;
    return regex.test(phoneNumber);
  }

  /**
   * 掩码手机号
   */
  private maskPhoneNumber(phoneNumber: string): string {
    if (phoneNumber.length < 7) {
      return phoneNumber;
    }
    return phoneNumber.substring(0, 3) + '****' + phoneNumber.substring(phoneNumber.length - 4);
  }

  /**
   * 保存配置
   */
  private async saveConfig(userId: string, config: TwoFactorConfig): Promise<void> {
    const key = `${this.CONFIG_PREFIX}${userId}`;
    await this.redis.set(key, JSON.stringify(config));
    await this.redis.expire(key, this.CONFIG_TTL);
  }

  /**
   * 记录失败尝试
   */
  private async recordFailedAttempt(userId: string): Promise<number> {
    const key = `${this.ATTEMPTS_PREFIX}${userId}`;
    const attempts = await this.redis.incr(key);
    await this.redis.expire(key, 3600); // 1小时过期
    return attempts;
  }

  /**
   * 清除失败尝试记录
   */
  private async clearFailedAttempts(userId: string): Promise<void> {
    const key = `${this.ATTEMPTS_PREFIX}${userId}`;
    await this.redis.del(key);
  }

  /**
   * 锁定账户
   */
  private async lockAccount(userId: string): Promise<void> {
    const key = `${this.LOCKOUT_PREFIX}${userId}`;
    const duration = this.config?.lockoutDuration || 1800; // 默认30分钟
    await this.redis.setex(key, duration, '1');
    this.logger.warn(`[2FA] Account locked for user ${userId} for ${duration} seconds`);
  }

  /**
   * 获取锁定状态
   */
  private async getLockout(userId: string): Promise<Date | null> {
    const key = `${this.LOCKOUT_PREFIX}${userId}`;
    const ttl = await this.redis.ttl(key);

    if (ttl > 0) {
      return new Date(Date.now() + ttl * 1000);
    }

    return null;
  }
}
