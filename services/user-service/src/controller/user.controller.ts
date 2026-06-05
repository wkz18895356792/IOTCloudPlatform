import { Controller, Get, Post, Put, Del, Body, Param, Inject, Query } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { AuthService } from '../service/auth.service';
import { UserService } from '../service/user.service';
import { VerificationCodeService } from '../service/sms.service';
import { EmailService } from '../service/email.service';
import { OAuthService } from '../service/oauth.service';
import { TokenService } from '../service/token.service';
import {
  ErrorCode,
  successResponse,
  errorResponse,
  ThirdPartyProvider,
} from '@baby-monitor/shared-types';
import {
  LoginRequestDTO,
  RegisterRequestDTO,
  RefreshTokenRequestDTO,
  SendCodeRequestDTO,
  SendResetEmailRequestDTO,
  ResetPasswordRequestDTO,
  ChangePasswordRequestDTO,
  UploadAvatarRequestDTO,
  UpdateProfileRequestDTO,
  DeleteAccountRequestDTO,
  BindDeviceRequestDTO,
  SubmitFeedbackRequestDTO,
} from '../dto/auth.dto';

/**
 * 认证控制器
 * 处理用户登录、注册、登出、验证码发送、密码重置等认证相关操作
 * 提供RESTful API接口供前端调用
 */
@ApiTags('认证')
@Controller('/api/auth')
export class AuthController {
  // Midway上下文对象，包含请求和响应信息
  @Inject()
  ctx!: Context;

  // 认证服务，处理登录、注册等核心业务逻辑
  @Inject()
  authService!: AuthService;

  // 令牌服务，处理JWT令牌生成和验证
  @Inject()
  tokenService!: TokenService;

  // 验证码服务，处理验证码的生成和验证
  @Inject()
  verificationCodeService!: VerificationCodeService;

  // 邮件服务，处理各类邮件的发送
  @Inject()
  emailService!: EmailService;

  /**
   * 用户登录
   * 支持密码登录、短信验证码登录、邮箱验证码登录、第三方登录
   */
  @Post('/login')
  @ApiOperation({ summary: '用户登录', description: '支持密码登录、短信验证码登录、邮箱验证码登录、第三方登录' })
  @ApiResponse({
    status: 200,
    description: '登录成功，返回用户信息和token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '登录成功' },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                userId: { type: 'string', example: 'user-123' },
                username: { type: 'string', example: 'john_doe' },
                email: { type: 'string', example: 'john@example.com' },
                phone: { type: 'string', example: '+86138****1234' },
                avatar: { type: 'string', example: 'https://example.com/avatar.jpg' }
              }
            },
            accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            expiresIn: { type: 'number', example: 7200, description: '过期时间（秒）' }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: '登录失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'LOGIN_FAILED' },
            message: { type: 'string', example: '用户名或密码错误' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '登录请求参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['password', 'sms_code', 'email_code', 'oauth'], description: '登录类型' },
        account: { type: 'string', description: '账号（用户名/邮箱/手机号）' },
        password: { type: 'string', description: '密码（type=password时必填）' },
        code: { type: 'string', description: '验证码（type=sms_code/email_code时必填）' },
        oauthProvider: { type: 'string', description: '三方提供第商（type=oauth时必填）' },
        oauthToken: { type: 'string', description: '第三方token（type=oauth时必填）' },
      },
      required: ['type', 'account']
    }
  })
  async login(@Body() body: LoginRequestDTO) {
    // 获取客户端IP地址和用户代理信息
    const ip = this.ctx.ip;
    const userAgent = this.ctx.get('User-Agent');

    // 调用认证服务处理登录逻辑
    const result = await this.authService.login(body as any, ip, userAgent);

    // 登录失败，根据错误信息返回相应的错误码
    if (!result.success) {
      let code = ErrorCode.LOGIN_FAILED;
      if (result.error?.includes('用户名或密码')) {
        code = ErrorCode.LOGIN_PASSWORD_ERROR;
      } else if (result.error?.includes('验证码')) {
        code = ErrorCode.LOGIN_CODE_ERROR;
      } else if (result.error?.includes('被封禁')) {
        code = ErrorCode.ACCOUNT_BANNED;
      } else if (result.error?.includes('锁定')) {
        code = ErrorCode.ACCOUNT_LOCKED;
      } else if (result.error?.includes('待激活')) {
        code = ErrorCode.ACCOUNT_PENDING;
      }
      return errorResponse(code, result.error);
    }

    // 登录成功，返回用户信息和令牌
    return successResponse(result.data, result.data?.isNewUser ? '登录成功，欢迎新用户' : '登录成功');
  }

  /**
   * 用户注册
   * 创建新用户账户，支持用户名+密码、邮箱+验证码、手机+验证码注册
   */
  @Post('/register')
  @ApiOperation({ summary: '用户注册', description: '创建新用户账户，支持用户名+密码、邮箱+验证码、手机+验证码注册' })
  @ApiResponse({
    status: 200,
    description: '注册成功，自动登录并返回token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '注册成功' },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                userId: { type: 'string', example: 'user-123' },
                username: { type: 'string', example: 'john_doe' },
                email: { type: 'string', example: 'john@example.com' },
                phone: { type: 'string', example: '+86138****1234' }
              }
            },
            accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            expiresIn: { type: 'number', example: 7200 }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '注册失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'USERNAME_ALREADY_EXISTS' },
            message: { type: 'string', example: '用户名已存在' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '注册请求参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: '用户名' },
        password: { type: 'string', description: '密码' },
        email: { type: 'string', description: '邮箱（可选）' },
        phone: { type: 'string', description: '手机号（可选）' },
        code: { type: 'string', description: '验证码（email或phone注册时必填）' },
      },
      required: ['username', 'password']
    }
  })
  async register(@Body() body: RegisterRequestDTO) {
    // 获取客户端IP地址
    const ip = this.ctx.ip;

    // 调用认证服务处理注册逻辑
    const result = await this.authService.register(body as any, ip);

    // 注册失败，根据错误类型返回相应的错误码
    if (!result.success) {
      let code = ErrorCode.REGISTER_FAILED;
      if (result.error?.includes('用户名已存在')) {
        code = ErrorCode.USERNAME_ALREADY_EXISTS;
      } else if (result.error?.includes('邮箱已被注册')) {
        code = ErrorCode.EMAIL_ALREADY_EXISTS;
      } else if (result.error?.includes('手机号已被注册')) {
        code = ErrorCode.PHONE_ALREADY_EXISTS;
      } else if (result.error?.includes('验证码')) {
        code = ErrorCode.VERIFICATION_CODE_ERROR;
      }
      return errorResponse(code, result.error);
    }

    // 注册成功，如果用户提供了邮箱，发送欢迎邮件
    if (result.data?.user.email) {
      await this.emailService.sendWelcomeEmail(result.data.user.email, result.data.user.username);
    }

    return successResponse(result.data, '注册成功');
  }

  /**
   * 刷新Token
   * 使用refreshToken获取新的accessToken
   */
  @Post('/refresh')
  @ApiOperation({ summary: '刷新Token', description: '使用refreshToken获取新的accessToken' })
  @ApiResponse({
    status: 200,
    description: '刷新成功，返回新的accessToken和refreshToken',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '刷新成功' },
        data: {
          type: 'object',
          properties: {
            accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            expiresIn: { type: 'number', example: 7200, description: '过期时间（秒）' }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'refreshToken无效或已过期',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'REFRESH_TOKEN_INVALID' },
            message: { type: 'string', example: 'refreshToken无效或已过期' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '刷新token请求',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        refreshToken: { type: 'string', description: '刷新token' },
        accessToken: { type: 'string', description: '当前访问token（可选），提供后将加入黑名单）' }
      },
      required: ['refreshToken']
    }
  })
  async refresh(@Body() body: RefreshTokenRequestDTO & { accessToken?: string }) {
    const result = await this.authService.refreshAccessToken(body.refreshToken, body.accessToken);

    if (!result.success) {
      return errorResponse(ErrorCode.REFRESH_TOKEN_INVALID, result.error);
    }

    return successResponse(result.data, '刷新成功');
  }

  /**
   * 发送验证码
   * 发送短信或邮箱验证码，用于登录、注册、重置密码等场景
   */
  @Post('/send-code')
  @ApiOperation({ summary: '发送验证码', description: '发送短信或邮箱验证码，用于登录、注册、重置密码等场景' })
  @ApiResponse({
    status: 200,
    description: '验证码已发送',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '验证码已发送' }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '发送失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'VERIFICATION_CODE_SEND_FAILED' },
            message: { type: 'string', example: '验证码发送失败' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '发送验证码请求',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '目标（手机号或邮箱）' },
        type: { type: 'string', enum: ['register', 'login', 'reset_password', 'bind_phone', 'change_phone'], description: '验证码类型' },
        channel: { type: 'string', enum: ['sms', 'email'], description: '发送渠道' },
      },
      required: ['target', 'type', 'channel']
    }
  })
  async sendCode(@Body() body: SendCodeRequestDTO) {
    const result = await this.verificationCodeService.sendCode(
      body.target,
      body.type as any,
      body.channel as any
    );

    if (!result.success) {
      return errorResponse(ErrorCode.VERIFICATION_CODE_SEND_FAILED, result.message);
    }

    return successResponse(undefined, '验证码已发送');
  }

  /**
   * 发送密码重置邮件
   * 向用户邮箱发送密码重置链接
   */
  @Post('/send-reset-email')
  @ApiOperation({ summary: '发送密码重置邮件', description: '向用户邮箱发送密码重置链接' })
  @ApiResponse({
    status: 200,
    description: '邮件已发送',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '密码重置邮件已发送' }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '发送失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'EMAIL_SEND_FAILED' },
            message: { type: 'string', example: '邮件发送失败' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '邮箱地址',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email', description: '邮箱地址' }
      },
      required: ['email']
    }
  })
  async sendResetEmail(@Body() body: SendResetEmailRequestDTO) {
    const resetToken = Date.now().toString(36) + Math.random().toString(36);
    const resetLink = `${process.env.APP_URL}/reset-password?token=${resetToken}`;

    await this.emailService.sendPasswordResetEmail(body.email, resetLink);

    return successResponse(undefined, '密码重置邮件已发送');
  }

  /**
   * 重置密码
   * 通过验证码重置用户密码
   */
  @Post('/reset-password')
  @ApiOperation({ summary: '重置密码', description: '通过验证码重置用户密码' })
  @ApiResponse({
    status: 200,
    description: '密码重置成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '密码重置成功' }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '重置失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'VERIFICATION_CODE_ERROR' },
            message: { type: 'string', example: '验证码错误或已过期' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '重置密码请求',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: '账号（用户名/邮箱/手机号）' },
        code: { type: 'string', description: '验证码' },
        newPassword: { type: 'string', description: '新密码' }
      },
      required: ['account', 'code', 'newPassword']
    }
  })
  async resetPassword(@Body() body: ResetPasswordRequestDTO) {
    const result = await this.authService.resetPassword(
      body.account,
      body.code,
      body.newPassword
    );

    if (!result.success) {
      return errorResponse(ErrorCode.VERIFICATION_CODE_ERROR, result.error);
    }

    return successResponse(undefined, '密码重置成功');
  }

  /**
   * 登出
   * 退出当前登录会话
   */
  @Post('/logout')
  @ApiOperation({ summary: '登出', description: '退出当前登录会话' })
  @ApiResponse({
    status: 200,
    description: '登出成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '登出成功' }
      }
    }
  })
  async logout() {
    const userId = this.ctx.state.user.userId;
    const sessionId = this.ctx.state.user.sessionId;
    const token = this.ctx.state.user.token; // 从上下文获取当前 Token

    await this.authService.logout(userId, sessionId, token);

    return successResponse(undefined, '登出成功');
  }
}

/**
 * OAuth第三方登录控制器
 * 处理第三方登录、账号绑定、解绑等操作
 * 支持微信、QQ、支付宝、GitHub等多个第三方平台
 */
@ApiTags('OAuth第三方登录')
@Controller('/api/oauth')
export class OAuthController {
  // Midway上下文对象
  @Inject()
  ctx!: Context;

  // 认证服务
  @Inject()
  authService!: AuthService;

  // 令牌服务
  @Inject()
  tokenService!: TokenService;

  // OAuth服务，处理第三方登录逻辑
  @Inject()
  oauthService!: OAuthService;

  // 用户服务
  @Inject()
  userService!: UserService;

  /**
   * 获取第三方登录授权URL
   */
  @Get('/authorize/:provider')
  @ApiOperation({ summary: '获取第三方登录授权URL', description: '获取指定第三方平台的登录授权URL' })
  @ApiResponse({
    status: 200,
    description: '授权URL生成成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '授权URL生成成功' },
        data: {
          type: 'object',
          properties: {
            authUrl: { type: 'string', example: 'https://open.weixin.qq.com/connect/oauth2/authorize?...' },
            state: { type: 'string', example: 'abc123...' },
            provider: { type: 'string', example: 'wechat' }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '平台不支持或未启用',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'UNSUPPORTED_PROVIDER' },
            message: { type: 'string', example: '该登录平台不支持或未启用' }
          }
        }
      }
    }
  })
  @ApiParam({
    name: 'provider',
    description: '第三方平台',
    enum: ['wechat', 'qq', 'alipay', 'weibo', 'github', 'google', 'facebook', 'dingtalk', 'feishu', 'apple'],
    example: 'wechat'
  })
  @ApiQuery({ name: 'redirectUri', description: '自定义回调地址（可选）', required: false })
  @ApiQuery({ name: 'state', description: '自定义state参数（可选，用于防止CSRF攻击）', required: false })
  async getAuthorizeUrl(
    @Param('provider') provider: ThirdPartyProvider,
    @Query('redirectUri') redirectUri?: string,
    @Query('state') state?: string
  ) {
    const result = await this.oauthService.generateAuthUrl(provider, redirectUri, state);

    if (!result.success) {
      return errorResponse(ErrorCode.UNSUPPORTED_PROVIDER, result.error);
    }

    return successResponse({ authUrl: result.authUrl, state: result.state }, '授权URL生成成功');
  }

  /**
   * 处理OAuth回调
   */
  @Get('/callback/:provider')
  @ApiOperation({ summary: 'OAuth回调处理', description: '处理第三方登录回调，完成登录流程' })
  @ApiResponse({
    status: 200,
    description: '登录成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '登录成功' },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                userId: { type: 'string', example: 'user-123' },
                username: { type: 'string', example: 'wechat_user_abc' },
                nickname: { type: 'string', example: '微信用户' },
                avatar: { type: 'string', example: 'https://example.com/avatar.jpg' }
              }
            },
            accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            expiresIn: { type: 'number', example: 7200 },
            isNewUser: { type: 'boolean', example: true }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'OAuth回调处理失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'OAUTH_CALLBACK_FAILED' },
            message: { type: 'string', example: 'OAuth回调处理失败' }
          }
        }
      }
    }
  })
  @ApiParam({
    name: 'provider',
    description: '第三方平台',
    enum: ['wechat', 'qq', 'alipay', 'weibo', 'github', 'google', 'facebook', 'dingtalk', 'feishu', 'apple'],
    example: 'wechat'
  })
  @ApiQuery({ name: 'code', description: '授权码', required: true })
  @ApiQuery({ name: 'state', description: '状态参数', required: true })
  async handleCallback(
    @Param('provider') provider: ThirdPartyProvider,
    @Query('code') code: string,
    @Query('state') state: string
  ) {
    const ip = this.ctx.ip;
    const userAgent = this.ctx.get('User-Agent');

    // 使用OAuth服务处理回调
    const oauthResult = await this.oauthService.handleCallback(provider, code, state);

    if (!oauthResult.success || !oauthResult.user) {
      return errorResponse(ErrorCode.OAUTH_CALLBACK_FAILED, oauthResult.error || '第三方登录失败');
    }

    // 生成Token
    const { accessToken, refreshToken } = await this.tokenService.generateTokenPair(oauthResult.user);

    // 创建会话
    await this.authService['createSession'](oauthResult.user.id, ip, userAgent);

    // 更新最后登录信息
    await this.authService['updateLastLogin'](oauthResult.user.id, ip);

    return successResponse({
      user: oauthResult.user,
      accessToken,
      refreshToken,
      expiresIn: 7200,
      isNewUser: oauthResult.isNewUser,
    }, oauthResult.isNewUser ? '登录成功，欢迎新用户' : '登录成功');
  }

  /**
   * 绑定第三方账号
   */
  @Post('/bind/:provider')
  @ApiOperation({ summary: '绑定第三方账号', description: '将第三方账号绑定到当前用户账户' })
  @ApiResponse({
    status: 200,
    description: '绑定成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '账号绑定成功' },
        data: {
          type: 'object',
          properties: {
            provider: { type: 'string', example: 'wechat' },
            openId: { type: 'string', example: 'o1234567890abcdef' },
            bindAt: { type: 'string', example: '2024-01-01T00:00:00.000Z' }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '绑定失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'BIND_FAILED' },
            message: { type: 'string', example: '账号绑定失败' }
          }
        }
      }
    }
  })
  @ApiParam({
    name: 'provider',
    description: '第三方平台',
    enum: ['wechat', 'qq', 'alipay', 'weibo', 'github', 'google', 'facebook', 'dingtalk', 'feishu', 'apple'],
    example: 'wechat'
  })
  @ApiBody({
    description: '绑定参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '授权码' },
        state: { type: 'string', description: '状态参数' }
      },
      required: ['code', 'state']
    }
  })
  async bindAccount(
    @Param('provider') provider: ThirdPartyProvider,
    @Body() body: { code: string; state: string }
  ) {
    const userId = this.ctx.state.user.userId;

    const result = await this.oauthService.bindAccount(userId, provider, body.code, body.state);

    if (!result.success) {
      return errorResponse(ErrorCode.THIRD_PARTY_BIND_FAILED, result.error);
    }

    return successResponse(result.binding, '账号绑定成功');
  }

  /**
   * 解绑第三方账号
   */
  @Del('/bind/:provider')
  @ApiOperation({ summary: '解绑第三方账号', description: '解绑当前用户的第三方账号' })
  @ApiResponse({
    status: 200,
    description: '解绑成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '账号解绑成功' }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '解绑失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'UNBIND_FAILED' },
            message: { type: 'string', example: '账号解绑失败' }
          }
        }
      }
    }
  })
  @ApiParam({
    name: 'provider',
    description: '第三方平台',
    enum: ['wechat', 'qq', 'alipay', 'weibo', 'github', 'google', 'facebook', 'dingtalk', 'feishu', 'apple'],
    example: 'wechat'
  })
  async unbindAccount(@Param('provider') provider: ThirdPartyProvider) {
    const userId = this.ctx.state.user.userId;

    const result = await this.oauthService.unbindAccount(userId, provider);

    if (!result.success) {
      return errorResponse(ErrorCode.UNBIND_FAILED, result.error);
    }

    return successResponse(undefined, '账号解绑成功');
  }

  /**
   * 获取已绑定的第三方账号列表
   */
  @Get('/bindings')
  @ApiOperation({ summary: '获取已绑定的第三方账号', description: '获取当前用户已绑定的所有第三方账号' })
  @ApiResponse({
    status: 200,
    description: '绑定列表',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '获取成功' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'binding-123' },
              userId: { type: 'string', example: 'user-123' },
              provider: { type: 'string', example: 'wechat' },
              openId: { type: 'string', example: 'o1234567890abcdef' },
              userInfo: {
                type: 'object',
                properties: {
                  nickname: { type: 'string', example: '微信用户' },
                  avatar: { type: 'string', example: 'https://example.com/avatar.jpg' }
                }
              },
              bindAt: { type: 'string', example: '2024-01-01T00:00:00.000Z' }
            }
          }
        }
      }
    }
  })
  async getBindings() {
    const userId = this.ctx.state.user.userId;
    const bindings = await this.oauthService.getUserBindings(userId);

    return successResponse(bindings, '获取成功');
  }

  /**
   * 获取支持的第三方平台列表
   */
  @Get('/providers')
  @ApiOperation({ summary: '获取支持的第三方平台', description: '获取所有支持的第三方登录平台列表' })
  @ApiResponse({
    status: 200,
    description: '平台列表',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '获取成功' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              provider: { type: 'string', example: 'wechat' },
              name: { type: 'string', example: '微信' },
              enabled: { type: 'boolean', example: true }
            }
          }
        }
      }
    }
  })
  async getProviders() {
    const providers = this.oauthService.getSupportedProviders();

    return successResponse(providers, '获取成功');
  }

  /**
   * 刷新第三方访问令牌
   */
  @Post('/refresh/:provider')
  @ApiOperation({ summary: '刷新第三方访问令牌', description: '刷新指定平台的访问令牌' })
  @ApiResponse({
    status: 200,
    description: '刷新成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '令牌刷新成功' },
        data: {
          type: 'object',
          properties: {
            accessToken: { type: 'string', example: 'new_access_token' },
            expiresIn: { type: 'number', example: 7200 }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '刷新失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'REFRESH_TOKEN_FAILED' },
            message: { type: 'string', example: '令牌刷新失败' }
          }
        }
      }
    }
  })
  @ApiParam({
    name: 'provider',
    description: '第三方平台',
    enum: ['wechat', 'qq', 'alipay', 'weibo', 'github', 'google', 'facebook', 'dingtalk', 'feishu', 'apple'],
    example: 'wechat'
  })
  @ApiBody({
    description: '刷新令牌参数',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        refreshToken: { type: 'string', description: '第三方平台的刷新令牌' }
      },
      required: ['refreshToken']
    }
  })
  async refreshAccessToken(
    @Param('provider') provider: ThirdPartyProvider,
    @Body() body: { refreshToken: string }
  ) {
    const result = await this.oauthService.refreshAccessToken(provider, body.refreshToken);

    if (!result.success) {
      return errorResponse(ErrorCode.REFRESH_TOKEN_INVALID, result.error);
    }

    return successResponse({
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    }, '令牌刷新成功');
  }
}

/**
 * 用户控制器
 * 处理用户信息查询、资料更新、设备绑定、会话管理等用户相关操作
 */
@ApiTags('用户')
@Controller('/api/users')
export class UserController {
  // Midway上下文对象
  @Inject()
  ctx!: Context;

  // 用户服务，处理用户相关业务逻辑
  @Inject()
  userService!: UserService;

  /**
   * 获取当前用户信息
   * 获取当前登录用户的完整信息，包括个人资料、设置等
   */
  @Get('/me')
  @ApiOperation({ summary: '获取当前用户信息', description: '获取当前登录用户的完整信息，包括个人资料、设置等' })
  @ApiResponse({
    status: 200,
    description: '用户信息',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '获取成功' },
        data: {
          type: 'object',
          properties: {
            userId: { type: 'string', example: 'user-123' },
            username: { type: 'string', example: 'john_doe' },
            email: { type: 'string', example: 'john@example.com' },
            phone: { type: 'string', example: '+86138****1234' },
            nickname: { type: 'string', example: 'John' },
            avatar: { type: 'string', example: 'https://example.com/avatar.jpg' },
            bio: { type: 'string', example: 'Software developer' },
            gender: { type: 'string', enum: ['male', 'female', 'other'], example: 'male' },
            birthdate: { type: 'string', example: '1990-01-01' },
            location: { type: 'string', example: 'Beijing, China' }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: '用户不存在',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'USER_NOT_FOUND' },
            message: { type: 'string', example: '用户不存在' }
          }
        }
      }
    }
  })
  async getCurrentUser() {
    try {
      const userId = this.ctx.state.user.userId;
      const user = await this.userService.getUserFullInfo(userId);

      if (!user) {
        return errorResponse(ErrorCode.USER_NOT_FOUND);
      }

      return successResponse(user);
    } catch (error) {
      console.error('获取当前用户信息失败:', error);
      return errorResponse(ErrorCode.UNKNOWN_ERROR);
    }
  }

  /**
   * 更新用户资料
   * 更新当前用户的个人资料信息
   */
  @Put('/me/profile')
  @ApiOperation({ summary: '更新用户资料', description: '更新当前用户的个人资料信息' })
  @ApiResponse({
    status: 200,
    description: '更新成功，返回新的资料',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '个人资料更新成功' },
        data: {
          type: 'object',
          properties: {
            nickname: { type: 'string', example: 'John' },
            bio: { type: 'string', example: 'Software developer' },
            gender: { type: 'string', enum: ['male', 'female', 'other'], example: 'male' },
            birthdate: { type: 'string', example: '1990-01-01' },
            location: { type: 'string', example: 'Beijing, China' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '更新资料请求',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        nickname: { type: 'string', description: '昵称' },
        bio: { type: 'string', description: '个人简介' },
        gender: { type: 'string', enum: ['male', 'female', 'other'], description: '性别' },
        birthdate: { type: 'string', format: 'date', description: '生日' },
        location: { type: 'string', description: '所在地' },
      }
    }
  })
  async updateProfile(@Body() body: UpdateProfileRequestDTO) {
    const userId = this.ctx.state.user.userId;
    const profile = await this.userService.updateProfile(userId, body as any);

    return successResponse(profile, '个人资料更新成功');
  }

  /**
   * 修改密码
   * 修改当前用户的登录密码
   */
  @Put('/me/password')
  @ApiOperation({ summary: '修改密码', description: '修改当前用户的登录密码' })
  @ApiResponse({
    status: 200,
    description: '密码修改成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '密码修改成功' }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '修改失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'PASSWORD_INCORRECT' },
            message: { type: 'string', example: '旧密码错误' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '修改密码请求',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        oldPassword: { type: 'string', description: '旧密码' },
        newPassword: { type: 'string', description: '新密码' }
      },
      required: ['oldPassword', 'newPassword']
    }
  })
  async changePassword(@Body() body: ChangePasswordRequestDTO) {
    const userId = this.ctx.state.user.userId;
    const result = await this.userService.changePassword(userId, body.oldPassword, body.newPassword);

    if (!result.success) {
      let code = ErrorCode.PASSWORD_INCORRECT;
      if (result.error?.includes('与旧密码相同')) {
        code = ErrorCode.PASSWORD_SAME_AS_OLD;
      }
      return errorResponse(code, result.error);
    }

    return successResponse(undefined, '密码修改成功');
  }

  /**
   * 上传头像
   * 更新当前用户的头像URL
   */
  @Post('/me/avatar')
  @ApiOperation({ summary: '上传头像', description: '更新当前用户的头像URL' })
  @ApiResponse({
    status: 200,
    description: '头像上传成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '头像上传成功' },
        data: {
          type: 'object',
          properties: {
            avatarUrl: { type: 'string', example: 'https://example.com/avatar.jpg' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '头像URL',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        avatarUrl: { type: 'string', format: 'uri', description: '头像URL' }
      },
      required: ['avatarUrl']
    }
  })
  async uploadAvatar(@Body() body: UploadAvatarRequestDTO) {
    const userId = this.ctx.state.user.userId;
    const avatarUrl = await this.userService.uploadAvatar(userId, body.avatarUrl);

    return successResponse({ avatarUrl }, '头像上传成功');
  }

  /**
   * 删除账户
   * 删除当前用户的账户及其所有数据
   */
  @Del('/me')
  @ApiOperation({ summary: '删除账户', description: '删除当前用户的账户及其所有数据' })
  @ApiResponse({
    status: 200,
    description: '账户已删除',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '账户已删除' }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '删除失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'PASSWORD_INCORRECT' },
            message: { type: 'string', example: '密码错误' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '删除账户请求（需要密码验证）',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        password: { type: 'string', description: '密码' }
      },
      required: ['password']
    }
  })
  async deleteAccount(@Body() body: DeleteAccountRequestDTO) {
    const userId = this.ctx.state.user.userId;
    const result = await this.userService.deleteAccount(userId, body.password);

    if (!result.success) {
      return errorResponse(ErrorCode.PASSWORD_INCORRECT, result.error);
    }

    return successResponse(undefined, '账户已删除');
  }

  /**
   * 获取用户设备列表
   * 获取当前用户绑定的所有设备
   */
  @Get('/me/devices')
  @ApiOperation({ summary: '获取用户设备列表', description: '获取当前用户绑定的所有设备' })
  @ApiResponse({
    status: 200,
    description: '设备列表',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '获取成功' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              deviceId: { type: 'string', example: 'device-123' },
              userId: { type: 'string', example: 'user-123' },
              deviceName: { type: 'string', example: '卧室摄像头' },
              role: { type: 'string', enum: ['owner', 'admin', 'member', 'guest'], example: 'owner' },
              createdAt: { type: 'string', example: '2024-01-01T00:00:00.000Z' }
            }
          }
        }
      }
    }
  })
  async getDevices() {
    const userId = this.ctx.state.user.userId;
    const devices = await this.userService.getUserDevices(userId);

    return successResponse(devices);
  }

  /**
   * 绑定设备
   * 绑定一个设备到当前用户账户
   */
  @Post('/me/devices/:deviceId')
  @ApiOperation({ summary: '绑定设备', description: '绑定一个设备到当前用户账户' })
  @ApiResponse({
    status: 200,
    description: '设备绑定成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '设备绑定成功' },
        data: {
          type: 'object',
          properties: {
            deviceId: { type: 'string', example: 'device-123' },
            userId: { type: 'string', example: 'user-123' },
            deviceName: { type: 'string', example: '卧室摄像头' },
            role: { type: 'string', enum: ['owner', 'admin', 'member', 'guest'], example: 'owner' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '绑定设备请求',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        deviceName: { type: 'string', description: '设备名称' },
        role: { type: 'string', enum: ['owner', 'admin', 'member', 'guest'], description: '用户角色' }
      }
    }
  })
  async bindDevice(@Param('deviceId') deviceId: string, @Body() body: BindDeviceRequestDTO) {
    const userId = this.ctx.state.user.userId;
    const userDevice = await this.userService.bindDevice(
      userId,
      deviceId,
      body.deviceName,
      body.role
    );

    return successResponse(userDevice, '设备绑定成功');
  }

  /**
   * 解绑设备
   * 解绑当前用户的某个设备
   */
  @Del('/me/devices/:deviceId')
  @ApiOperation({ summary: '解绑设备', description: '解绑当前用户的某个设备' })
  @ApiResponse({
    status: 200,
    description: '设备解绑成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '设备解绑成功' }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: '设备未绑定',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'DEVICE_NOT_BOUND' },
            message: { type: 'string', example: '设备未绑定' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async unbindDevice(@Param('deviceId') deviceId: string) {
    const userId = this.ctx.state.user.userId;
    const success = await this.userService.unbindDevice(userId, deviceId);

    if (!success) {
      return errorResponse(ErrorCode.DEVICE_NOT_BOUND);
    }

    return successResponse(undefined, '设备解绑成功');
  }

  /**
   * 获取会话列表
   * 获取当前用户的所有活跃会话
   */
  @Get('/me/sessions')
  @ApiOperation({ summary: '获取会话列表', description: '获取当前用户的所有活跃会话' })
  @ApiResponse({
    status: 200,
    description: '会话列表',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '获取成功' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', example: 'session-123' },
              userId: { type: 'string', example: 'user-123' },
              userAgent: { type: 'string', example: 'Mozilla/5.0...' },
              ip: { type: 'string', example: '192.168.1.1' },
              createdAt: { type: 'string', example: '2024-01-01T00:00:00.000Z' },
              lastActiveAt: { type: 'string', example: '2024-01-01T01:00:00.000Z' }
            }
          }
        }
      }
    }
  })
  async getSessions() {
    const userId = this.ctx.state.user.userId;
    const sessions = await this.userService.getUserSessions(userId);

    return successResponse(sessions);
  }

  /**
   * 删除会话
   * 删除指定的会话（强制登出）
   */
  @Del('/me/sessions/:sessionId')
  @ApiOperation({ summary: '删除会话', description: '删除指定的会话（强制登出）' })
  @ApiResponse({
    status: 200,
    description: '会话已删除',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '会话已删除' }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: '会话不存在',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'RESOURCE_NOT_FOUND' },
            message: { type: 'string', example: '会话不存在' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'sessionId', description: '会话ID', example: 'session-123' })
  async deleteSession(@Param('sessionId') sessionId: string) {
    const userId = this.ctx.state.user.userId;
    const success = await this.userService.deleteSession(sessionId, userId);

    if (!success) {
      return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '会话不存在');
    }

    return successResponse(undefined, '会话已删除');
  }

  /**
   * 删除所有会话
   * 删除当前用户的所有会话（强制所有设备登出）
   */
  @Del('/me/sessions')
  @ApiOperation({ summary: '删除所有会话', description: '删除当前用户的所有会话（强制所有设备登出）' })
  @ApiResponse({
    status: 200,
    description: '所有会话已删除',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '所有设备已登出' }
      }
    }
  })
  async deleteAllSessions() {
    const userId = this.ctx.state.user.userId;
    await this.userService.deleteAllSessions(userId);

    return successResponse(undefined, '所有设备已登出');
  }
}

/**
 * 用户反馈控制器
 * 处理用户反馈、意见建议的提交
 */
@ApiTags('用户反馈')
@Controller('/api/feedback')
export class FeedbackController {
  // Midway上下文对象
  @Inject()
  ctx!: Context;

  /**
   * 提交反馈
   * 提交用户反馈或意见
   */
  @Post('/')
  @ApiOperation({ summary: '提交反馈', description: '提交用户反馈或意见' })
  @ApiResponse({
    status: 200,
    description: '反馈已提交',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '反馈已提交' },
        data: {
          type: 'object',
          properties: {
            message: { type: 'string', example: '反馈已提交' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '反馈内容',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['bug', 'feature', 'improvement', 'other'], description: '反馈类型' },
        content: { type: 'string', description: '反馈内容' },
        contact: { type: 'string', description: '联系方式（可选）' }
      },
      required: ['type', 'content']
    }
  })
  async submit(@Body() body: SubmitFeedbackRequestDTO) {
    return successResponse({ message: '反馈已提交' }, '反馈已提交');
  }
}
