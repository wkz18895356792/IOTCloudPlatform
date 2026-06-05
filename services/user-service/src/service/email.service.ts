import { Provide, Inject, Init } from '@midwayjs/core';
import { createTransport, Transporter } from 'nodemailer';
import { ILogger } from '@midwayjs/logger';

/**
 * 邮件服务
 * 负责发送各类邮件：验证码邮件、欢迎邮件、密码重置邮件等
 * 使用nodemailer库进行邮件发送
 */
@Provide()
export class EmailService {
  // 日志记录器
  @Inject()
  logger!: ILogger;

  // nodemailer传输器实例
  private transporter!: Transporter;

  /**
   * 初始化邮件服务
   * 配置SMTP服务器连接参数
   */
  @Init()
  async initialize(): Promise<void> {
    // 从环境变量读取配置
    const emailHost = process.env.EMAIL_HOST || 'smtp.gmail.com';
    const emailPort = parseInt(process.env.EMAIL_PORT || '587');
    const emailUser = process.env.EMAIL_USER || '';
    const emailPassword = process.env.EMAIL_PASSWORD || '';

    // 配置 SMTP 传输器（仅创建实例，不验证连接）
    this.transporter = createTransport({
      host: emailHost,
      port: emailPort,
      secure: emailPort === 465,
      auth: emailUser && emailPassword
        ? { user: emailUser, pass: emailPassword }
        : undefined,
      tls: {
        rejectUnauthorized: process.env.NODE_ENV !== 'production',
      },
    });

    if (!emailUser || !emailPassword) {
      this.logger.warn('[Email Service] Email credentials not configured, service will be in mock mode');
    } else {
      this.logger.info('[Email Service] Initialized (connection will be verified on first send)');
    }
  }

  /**
   * 发送验证码邮件
   * 向用户邮箱发送验证码，用于注册、登录、密码重置等场景
   *
   * @param email - 收件人邮箱地址
   * @param code - 验证码
   * @param type - 验证码类型（register/login/reset_password等）
   */
  async sendVerificationCode(email: string, code: string, type: string): Promise<void> {
    // 获取邮件主题和HTML模板
    const subject = this.getEmailSubject(type);
    const html = this.getVerificationEmailTemplate(code, type);

    // 发送邮件
    await this.transporter.sendMail({
      from: `"智能家居" <${process.env.EMAIL_USER}>`,  // 发件人
      to: email,                                       // 收件人
      subject,                                        // 邮件主题
      html,                                           // 邮件HTML内容
    });

    console.log(`[Email Service] Verification code sent to ${email}`);
  }

  /**
   * 发送欢迎邮件
   * 向新注册的用户发送欢迎邮件，引导用户开始使用平台
   *
   * @param email - 收件人邮箱地址
   * @param username - 用户名
   */
  async sendWelcomeEmail(email: string, username: string): Promise<void> {
    // 构建欢迎邮件HTML模板
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>欢迎加入智能家居</h1>
          </div>
          <div class="content">
            <p>亲爱的 <strong>${username}</strong>：</p>
            <p>欢迎您注册智能家居平台！您的账户已成功创建。</p>
            <p>现在您可以开始添加设备、设置自动化场景，享受智能生活。</p>
            <a href="${process.env.APP_URL}/devices" class="button">开始使用</a>
            <p>如果您有任何问题，请随时联系我们的客服。</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} 智能家居. All rights reserved.</p>
            <p>此邮件由系统自动发送，请勿直接回复</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.transporter.sendMail({
      from: `"智能家居" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '欢迎加入智能家居',
      html,
    });
  }

  /**
   * 发送密码重置邮件
   * 向用户发送包含密码重置链接的邮件
   *
   * @param email - 收件人邮箱地址
   * @param resetLink - 密码重置链接
   */
  async sendPasswordResetEmail(email: string, resetLink: string): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
          .button { display: inline-block; padding: 12px 24px; background: #dc3545; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>密码重置请求</h2>
          <p>我们收到了您的密码重置请求。如果这是您发起的，请点击下面的按钮重置密码：</p>
          <a href="${resetLink}" class="button">重置密码</a>
          <div class="warning">
            <strong>注意：</strong>此链接将在30分钟后过期。如果您没有发起此请求，请忽略此邮件。
          </div>
          <p>或者，您也可以复制以下链接到浏览器：</p>
          <p style="word-break: break-all; color: #666;">${resetLink}</p>
        </div>
      </body>
      </html>
    `;

    await this.transporter.sendMail({
      from: `"智能家居" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '密码重置',
      html,
    });
  }

  /**
   * 获取邮件主题
   * 根据验证码类型返回对应的邮件主题
   *
   * @param type - 验证码类型
   * @returns 邮件主题字符串
   */
  private getEmailSubject(type: string): string {
    const subjects: Record<string, string> = {
      register: '注册验证码',
      login: '登录验证码',
      reset_password: '密码重置验证码',
      bind_email: '绑定邮箱验证码',
      change_email: '更换邮箱验证码',
    };
    return subjects[type] || '验证码';
  }

  /**
   * 获取验证码邮件模板
   * 生成包含验证码的HTML邮件模板
   *
   * @param code - 验证码
   * @param type - 验证码类型
   * @returns HTML格式的邮件内容
   */
  private getVerificationEmailTemplate(code: string, type: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .code-box { background: #f0f0f0; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; border-radius: 8px; }
          .warning { color: #dc3545; font-size: 14px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>您的验证码</h2>
          <p>您正在进行${this.getEmailSubject(type)}操作，验证码如下：</p>
          <div class="code-box">${code}</div>
          <p>验证码有效期为<strong>5分钟</strong>，请尽快完成验证。</p>
          <p class="warning">如果这不是您本人操作，请忽略此邮件。</p>
        </div>
      </body>
      </html>
    `;
  }
}
