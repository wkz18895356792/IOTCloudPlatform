import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { User } from '../entity/user.entity';
import { UserStatus, UserRole } from '@baby-monitor/shared-types';
import { UserSession } from '../entity/user-session.entity';
import { ThirdPartyBinding } from '../entity/third-party-binding.entity';
import { UserActionLog } from '../entity/user-action-log.entity';
import { LoginRequest, LoginResponse, RegisterRequest, ThirdPartyAuthData, LoginType, ThirdPartyProvider, UserActionType } from '@baby-monitor/shared-types';
import { PasswordUtil, IdGenerator } from '@baby-monitor/shared-utils';
import { VerificationCodeService } from './sms.service';
import { OAuthService } from './oauth.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { TokenService } from './token.service';

/**
 * 用户认证服务
 * 负责处理用户登录、注册、登出、密码重置等认证相关操作
 * 支持多种登录方式：密码登录、短信验证码登录、邮箱验证码登录、第三方登录
 */
@Provide()
export class AuthService {
  // 日志记录器
  @Inject()
  logger!: ILogger;

  // 令牌服务
  @Inject()
  tokenService!: TokenService;

  // Redis缓存服务
  @Inject()
  redis!: RedisService;

  // 验证码服务
  @Inject()
  verificationCodeService!: VerificationCodeService;

  // 用户数据仓库
  @InjectEntityModel(User)
  userRepository!: Repository<User>;

  // 用户会话数据仓库
  @InjectEntityModel(UserSession)
  userSessionRepository!: Repository<UserSession>;

  // 第三方绑定数据仓库
  @InjectEntityModel(ThirdPartyBinding)
  thirdPartyBindingRepository!: Repository<ThirdPartyBinding>;

  // 用户操作日志数据仓库
  @InjectEntityModel(UserActionLog)
  userActionLogRepository!: Repository<UserActionLog>;

  // OAuth第三方登录服务
  @Inject()
  oauthService!: OAuthService;

  // Token黑名单服务
  @Inject()
  tokenBlacklistService!: TokenBlacklistService;

  // 访问令牌过期时间：2小时（单位：秒）
  private readonly ACCESS_TOKEN_EXPIRES_IN = 7200;
  // 刷新令牌过期时间：7天（单位：秒）
  private readonly REFRESH_TOKEN_EXPIRES_IN = 604800;

  // 获取访问令牌过期时间的 getter
  get accessTokenExpiresIn(): number {
    return this.tokenService.getAccessTokenExpiresIn();
  }

  // 获取刷新令牌过期时间的 getter
  get refreshTokenExpiresIn(): number {
    return this.tokenService.getRefreshTokenExpiresIn();
  }

  /**
   * 用户登录
   * 支持多种登录方式：密码登录、短信验证码登录、邮箱验证码登录、第三方登录
   *
   * @param request - 登录请求对象，包含登录类型和对应的凭证信息
   * @param ip - 客户端IP地址
   * @param userAgent - 客户端用户代理信息（可选）
   * @returns 登录结果，包含成功标志、用户数据、令牌和可能的错误信息
   */
  async login(
    request: LoginRequest,
    ip: string,
    userAgent?: string
  ): Promise<{ success: boolean; data?: LoginResponse & { isNewUser?: boolean }; error?: string }> {
    try {
      let user: User | null = null;
      let isNewUser = false;
      console.log('Login request:', request);
      console.log('request.type:', request.type);

      // 根据登录类型分发到不同的登录处理方法
      switch (request.type) {
        case LoginType.PASSWORD:
          // 密码登录
          user = await this.loginWithPassword(request.account, request.password!);
          break;

        case LoginType.SMS_CODE:
          // 短信验证码登录
          console.log('Attempting SMS code login with account:', request.account);
          const smsResult = await this.loginWithSMSCode(request.account, request.code!);
          user = smsResult.user;
          isNewUser = smsResult.isNewUser;
          break;

        case LoginType.EMAIL_CODE:
          // 邮箱验证码登录
          const emailResult = await this.loginWithEmailCode(request.account, request.code!);
          user = emailResult.user;
          isNewUser = emailResult.isNewUser;
          break;

        case LoginType.THIRD_PARTY:
          // 第三方登录
          user = await this.loginWithThirdParty(request.thirdPartyData!);
          break;
      }
      console.log('Login result user:', user);

      // 如果登录失败，返回错误信息
      if (!user) {
        return {
          success: false,
          error: '登录失败，用户名或密码错误',
        };
      }

      // 检查用户状态是否被封禁
      if (user.status === UserStatus.BANNED) {
        return {
          success: false,
          error: '账号已被封禁',
        };
      }

      // 检查用户状态是否被锁定
      if (user.status === UserStatus.LOCKED) {
        return {
          success: false,
          error: '账号已被锁定',
        };
      }

      // 检查用户状态是否待激活
      if (user.status === UserStatus.PENDING) {
        return {
          success: false,
          error: '账号待激活',
        };
      }

      // 生成访问令牌和刷新令牌
      const { accessToken, refreshToken } = await this.tokenService.generateTokenPair(user);

      // 创建用户会话记录
      await this.createSession(user.id, ip, userAgent);

      // 更新用户的最后登录时间和IP
      await this.updateLastLogin(user.id, ip);

      // 记录用户登录操作日志
      await this.logAction(user.id, UserActionType.LOGIN, { ip, userAgent, isNewUser });

      return {
        success: true,
        data: {
          user,
          accessToken,
          refreshToken,
          expiresIn: this.ACCESS_TOKEN_EXPIRES_IN,
          isNewUser,
        },
      };
    } catch (error) {
      console.error('[Auth Service] Login error:', error);
      console.log(error);
      return {
        success: false,
        error: '登录失败，请稍后重试',
      };
    }
  }

  /**
   * 用户注册
   * 创建新用户账户，支持用户名+密码注册，可选择绑定邮箱或手机号
   *
   * @param request - 注册请求对象，包含用户名、密码和可选的邮箱、手机号
   * @param ip - 客户端IP地址
   * @returns 注册结果，包含成功标志、用户数据、令牌和可能的错误信息
   */
  async register(
    request: RegisterRequest,
    ip: string
  ): Promise<{ success: boolean; data?: LoginResponse; error?: string }> {
    try {
      // 检查用户名是否已被注册
      const existingUser = await this.userRepository.findOne({
        where: { username: request.username } as any,
      });

      if (existingUser) {
        return {
          success: false,
          error: '用户名已存在',
        };
      }

      // 如果提供了邮箱，检查邮箱是否已被注册
      if (request.email) {
        const existingEmail = await this.userRepository.findOne({
          where: { email: request.email } as any,
        });

        if (existingEmail) {
          return {
            success: false,
            error: '邮箱已被注册',
          };
        }
      }

      // 如果提供了手机号，检查手机号是否已被注册
      if (request.phone) {
        const existingPhone = await this.userRepository.findOne({
          where: { phone: request.phone } as any,
        });

        if (existingPhone) {
          return {
            success: false,
            error: '手机号已被注册',
          };
        }
      }

      // 如果提供了邮箱和验证码，验证验证码的有效性
      if (request.email && request.code) {
        const isValid = await this.verificationCodeService.verifyCode(
          request.code,
          'register' as any,
          request.email
        );

        if (!isValid) {
          return {
            success: false,
            error: '验证码错误或已过期',
          };
        }
      }

      // 创建新用户记录
      const user = this.userRepository.create({
        id: IdGenerator.uuid(),
        username: request.username,
        email: request.email,
        phone: request.phone,
        passwordHash: PasswordUtil.hash(request.password),
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        emailVerified: false,
        phoneVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 保存用户到数据库
      await this.userRepository.save(user);

      // 记录用户注册操作日志
      await this.logAction(user.id, UserActionType.REGISTER, { ip });

      // 注册成功后自动登录，生成访问令牌和刷新令牌
      const { accessToken, refreshToken } = await this.tokenService.generateTokenPair(user);

      return {
        success: true,
        data: {
          user,
          accessToken,
          refreshToken,
          expiresIn: this.ACCESS_TOKEN_EXPIRES_IN,
        },
      };
    } catch (error) {
      console.error('[Auth Service] Register error:', error);
      return {
        success: false,
        error: '注册失败，请稍后重试',
      };
    }
  }

  /**
   * 刷新访问令牌
   * 使用刷新令牌获取新的访问令牌和刷新令牌
   *
   * @param refreshToken - 刷新令牌
   * @param oldAccessToken - 旧的访问令牌（可选），如果提供则加入黑名单
   * @returns 刷新结果，包含成功标志、新的令牌和可能的错误信息
   */
  async refreshAccessToken(
    refreshToken: string,
    oldAccessToken?: string
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      // 从令牌中获取用户ID
      const userId = await this.tokenService.getUserIdFromToken(refreshToken);
      if (!userId) {
        return {
          success: false,
          error: '无效的刷新令牌',
        };
      }

      // 检查刷新令牌是否在黑名单中（已被使用过）
      const isBlacklisted = await this.tokenBlacklistService.isBlacklisted(refreshToken);
      if (isBlacklisted) {
        return {
          success: false,
          error: '刷新令牌已被使用',
        };
      }

      // 确认令牌类型是刷新令牌
      const isRefreshToken = await this.tokenService.checkTokenType(refreshToken, 'refresh');
      if (!isRefreshToken) {
        return {
          success: false,
          error: '无效的刷新令牌',
        };
      }

      // 从数据库获取用户信息
      const user = await this.userRepository.findOne({
        where: { id: userId } as any,
      });

      // 验证用户是否存在且处于活跃状态
      if (!user || user.status !== UserStatus.ACTIVE) {
        return {
          success: false,
          error: '用户不存在或已被禁用',
        };
      }

      // 使用 TokenService 生成新的令牌对
      const tokenPair = await this.tokenService.refreshTokens(refreshToken, user);
      if (!tokenPair) {
        return {
          success: false,
          error: '刷新令牌无效或已过期',
        };
      }

      const { accessToken, refreshToken: newRefreshToken } = tokenPair;

      // 将旧的访问令牌加入黑名单（如果提供）
      if (oldAccessToken) {
        await this.tokenBlacklistService.addToBlacklist(
          oldAccessToken,
          'access',
          this.accessTokenExpiresIn,
          'token_refresh'
        );
        this.logger.info(`[AuthService] Old access token blacklisted during refresh for user ${user.id}`);
      }

      // 将旧的刷新令牌也加入黑名单（确保一次性使用）
      await this.tokenBlacklistService.addToBlacklist(
        refreshToken,
        'refresh',
        this.refreshTokenExpiresIn,
        'token_refresh'
      );

      return {
        success: true,
        data: {
          accessToken,
          refreshToken: newRefreshToken,
          expiresIn: this.accessTokenExpiresIn,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: '刷新令牌无效或已过期',
      };
    }
  }

  /**
   * 用户登出
   * 删除用户会话，将 Token 加入黑名单，并记录登出操作
   *
   * @param userId - 用户ID
   * @param sessionId - 会话ID（可选）
   * @param accessToken - 当前访问令牌（可选），如果提供则加入黑名单
   */
  async logout(userId: string, sessionId?: string, accessToken?: string): Promise<void> {
    // 删除指定的用户会话
    if (sessionId) {
      await this.userSessionRepository.delete({ id: sessionId } as any);
    }

    // 将当前访问令牌加入黑名单
    if (accessToken) {
      await this.tokenBlacklistService.addToBlacklist(
        accessToken,
        'access',
        this.ACCESS_TOKEN_EXPIRES_IN,
        'logout'
      );
      this.logger.info(`[AuthService] Access token blacklisted for user ${userId}`);
    }

    // 记录用户登出操作日志
    await this.logAction(userId, UserActionType.LOGOUT, { sessionId });
  }

  /**
   * 密码登录
   * 使用用户名/邮箱/手机号和密码进行登录验证
   *
   * @param account - 账号（可以是用户名、邮箱或手机号）
   * @param password - 密码
   * @returns 验证成功返回用户对象，失败返回null
   */
  private async loginWithPassword(account: string, password: string): Promise<User | null> {
    // 通过用户名、邮箱或手机号查找用户
    const user = await this.userRepository.findOne({
      where: [
        { username: account } as any,
        { email: account } as any,
        { phone: account } as any,
      ],
    });

    // 用户不存在或未设置密码
    if (!user || !user.passwordHash) {
      return null;
    }

    // 验证密码是否正确
    const isValid = PasswordUtil.verify(password, user.passwordHash);
    if (!isValid) {
      return null;
    }

    return user;
  }

  /**
   * 短信验证码登录
   * 使用手机号和短信验证码进行登录，如果用户不存在则自动创建
   *
   * @param phone - 手机号
   * @param code - 短信验证码
   * @returns 登录结果，包含用户对象和是否为新用户的标志
   */
  private async loginWithSMSCode(phone: string, code: string): Promise<{ user: User | null; isNewUser: boolean }> {
    // 验证短信验证码的有效性
    const isValid = await this.verificationCodeService.verifyCode(
      code,
      'login' as any,
      phone
    );
    console.log(`[SMS Login] Verifying code: ${code}, phone: ${phone}, isValid: ${isValid}`);

    // 验证码无效
    if (!isValid) {
      return { user: null, isNewUser: false };
    }

    // 通过手机号查找用户
    let user = await this.userRepository.findOne({
      where: { phone } as any,
    });
    console.log('Found user by phone:', user);

    // 如果用户不存在，自动创建新用户
    if (!user) {
      user = this.userRepository.create({
        id: IdGenerator.uuid(),
        username: `user_${phone}`,
        phone,
        phoneVerified: true,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log('Creating new user:', user);

      await this.userRepository.save(user);

      // 记录自动注册操作日志
      await this.logAction(user.id, UserActionType.REGISTER, { phone, method: 'sms_auto_register' });

      return { user, isNewUser: true };
    }

    // 如果用户手机号未验证，更新验证状态
    if (!user.phoneVerified) {
      user.phoneVerified = true;
      await this.userRepository.save(user);
    }

    return { user, isNewUser: false };
  }

  /**
   * 邮箱验证码登录
   * 使用邮箱和邮箱验证码进行登录，如果用户不存在则自动创建
   *
   * @param email - 邮箱地址
   * @param code - 邮箱验证码
   * @returns 登录结果，包含用户对象和是否为新用户的标志
   */
  private async loginWithEmailCode(email: string, code: string): Promise<{ user: User | null; isNewUser: boolean }> {
    // 验证邮箱验证码的有效性
    const isValid = await this.verificationCodeService.verifyCode(
      code,
      'login' as any,
      email
    );

    // 验证码无效
    if (!isValid) {
      return { user: null, isNewUser: false };
    }

    // 通过邮箱查找用户
    let user = await this.userRepository.findOne({
      where: { email } as any,
    });

    // 如果用户不存在，自动创建新用户
    if (!user) {
      user = this.userRepository.create({
        id: IdGenerator.uuid(),
        username: `user_${email.split('@')[0]}_${IdGenerator.shortId()}`,
        email,
        emailVerified: true,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await this.userRepository.save(user);

      // 记录自动注册操作日志
      await this.logAction(user.id, UserActionType.REGISTER, { email, method: 'email_auto_register' });

      return { user, isNewUser: true };
    }

    // 如果用户邮箱未验证，更新验证状态
    if (!user.emailVerified) {
      user.emailVerified = true;
      await this.userRepository.save(user);
    }

    return { user, isNewUser: false };
  }

  /**
   * 第三方登录
   * 通过第三方平台（如微信、QQ、GitHub等）进行登录
   *
   * @param authData - 第三方认证数据，包含提供商、授权码和状态参数
   * @returns 登录成功返回用户对象，失败返回null
   */
  private async loginWithThirdParty(authData: ThirdPartyAuthData): Promise<User | null> {
    // 使用OAuth服务处理第三方登录流程
    const result = await this.oauthService.handleCallback(
      authData.provider,
      authData.code || '',
      authData.state || ''
    );

    // 登录失败或未获取到用户信息
    if (!result.success || !result.user) {
      return null;
    }

    // 记录第三方登录操作日志
    await this.logAction(result.user.id, UserActionType.LOGIN, {
      method: 'third_party',
      provider: authData.provider,
      isNewUser: result.isNewUser,
    });

    return result.user;
  }

  /**
   * 创建用户会话
   * 在数据库中创建新的用户会话记录，记录设备信息和登录信息
   *
   * @param userId - 用户ID
   * @param ip - 客户端IP地址
   * @param userAgent - 客户端用户代理信息（可选）
   */
  private async createSession(userId: string, ip: string, userAgent?: string): Promise<void> {
    const session = this.userSessionRepository.create({
      id: IdGenerator.uuid(),
      userId,
      deviceType: this.detectDeviceType(userAgent),
      deviceInfo: userAgent,
      ip,
      lastActiveAt: new Date(),
      createdAt: new Date(),
    });

    await this.userSessionRepository.save(session);
  }

  /**
   * 检测设备类型
   * 根据用户代理字符串判断客户端设备类型
   *
   * @param userAgent - 用户代理字符串
   * @returns 设备类型：web、ios、android或desktop
   */
  private detectDeviceType(userAgent?: string): 'web' | 'ios' | 'android' | 'desktop' {
    // 未提供用户代理，默认为web
    if (!userAgent) {
      return 'web';
    }

    const ua = userAgent.toLowerCase();

    // 检测iOS设备（iPhone或iPad）
    if (ua.includes('iphone') || ua.includes('ipad')) {
      return 'ios';
    }

    // 检测Android设备
    if (ua.includes('android')) {
      return 'android';
    }

    // 检测移动设备或平板
    if (ua.includes('mobile') || ua.includes('tablet')) {
      return 'web';
    }

    // 默认为桌面设备
    return 'desktop';
  }

  /**
   * 更新最后登录信息
   * 更新用户的最后登录时间和IP地址
   *
   * @param userId - 用户ID
   * @param ip - 客户端IP地址
   */
  private async updateLastLogin(userId: string, ip: string): Promise<void> {
    await this.userRepository.update(userId, {
      lastLoginAt: new Date(),
      lastLoginIp: ip,
      updatedAt: new Date(),
    } as any);
  }

  /**
   * 记录用户操作日志
   * 将用户的操作行为记录到数据库，用于审计和分析
   *
   * @param userId - 用户ID
   * @param action - 操作类型
   * @param details - 操作详情（可选）
   * @param ip - 客户端IP地址（可选）
   * @param userAgent - 客户端用户代理（可选）
   */
  private async logAction(
    userId: string,
    action: UserActionType,
    details?: Record<string, any>,
    ip?: string,
    userAgent?: string
  ): Promise<void> {
    const log = this.userActionLogRepository.create({
      userId,
      action,
      details,
      ip,
      userAgent,
      createdAt: new Date(),
    } as any);

    await this.userActionLogRepository.save(log);
  }

  /**
   * 重置密码
   * 通过验证码验证用户身份后重置密码
   *
   * @param account - 账号（用户名/邮箱/手机号）
   * @param code - 验证码
   * @param newPassword - 新密码
   * @returns 重置结果，包含成功标志和可能的错误信息
   */
  async resetPassword(
    account: string,
    code: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 验证重置密码验证码的有效性
      const isValid = await this.verificationCodeService.verifyCode(
        code,
        'reset_password' as any,
        account
      );

      if (!isValid) {
        return {
          success: false,
          error: '验证码错误或已过期',
        };
      }

      // 通过用户名、邮箱或手机号查找用户
      const user = await this.userRepository.findOne({
        where: [
          { username: account } as any,
          { email: account } as any,
          { phone: account } as any,
        ],
      });

      // 用户不存在
      if (!user) {
        return {
          success: false,
          error: '用户不存在',
        };
      }

      // 更新用户密码
      user.passwordHash = PasswordUtil.hash(newPassword);
      user.updatedAt = new Date();
      await this.userRepository.save(user);

      // 记录密码重置操作日志
      await this.logAction(user.id, UserActionType.RESET_PASSWORD, { account });

      return { success: true };
    } catch (error) {
      console.error('[Auth Service] Reset password error:', error);
      return {
        success: false,
        error: '重置密码失败，请稍后重试',
      };
    }
  }
}
