import { Provide, Inject, Config, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { createHmac, randomBytes } from 'crypto';
import axios, { AxiosInstance } from 'axios';
import { IdGenerator } from '@baby-monitor/shared-utils';
import { ThirdPartyProvider, UserRole, UserStatus } from '@baby-monitor/shared-types';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entity/user.entity';
import { ThirdPartyBinding } from '../entity/third-party-binding.entity';

/**
 * OAuth配置
 * 定义第三方OAuth认证所需的配置参数
 */
export interface OAuthConfig {
  clientId: string;              // 客户端ID
  clientSecret: string;          // 客户端密钥
  redirectUri: string;           // 回调地址
  scope?: string[];              // 授权范围
  authUrl: string;               // 授权URL
  tokenUrl: string;              // 令牌URL
  userInfoUrl: string;           // 用户信息URL
  enabled: boolean;              // 是否启用
}

/**
 * OAuth令牌响应
 * 第三方平台返回的访问令牌响应结构
 */
export interface OAuthTokenResponse {
  access_token: string;          // 访问令牌
  refresh_token?: string;        // 刷新令牌
  expires_in?: number;           // 过期时间（秒）
  token_type?: string;           // 令牌类型
  openid?: string;               // 开放ID（微信）
  unionid?: string;              // 统一ID（微信）
  user_id?: string;              // 用户ID（支付宝）
}

/**
 * OAuth用户信息
 * 从第三方平台获取的用户信息结构
 */
export interface OAuthUserInfo {
  id: string;                    // 用户ID
  unionId?: string;              // 统一ID
  nickname?: string;             // 昵称
  avatar?: string;               // 头像URL
  email?: string;                // 邮箱
  phone?: string;                // 手机号
  gender?: 'male' | 'female' | 'unknown';  // 性别
  country?: string;              // 国家
  province?: string;             // 省份
  city?: string;                 // 城市
  raw?: Record<string, any>;     // 原始数据
}

/**
 * 第三方登录结果
 * 第三方登录操作的结果
 */
export interface ThirdPartyLoginResult {
  success: boolean;              // 是否成功
  user?: User;                   // 用户对象
  isNewUser?: boolean;           // 是否为新用户
  binding?: ThirdPartyBinding;   // 绑定信息
  error?: string;                // 错误信息
}

/**
 * OAuth状态信息
 * 用于防止CSRF攻击的状态参数
 */
export interface OAuthState {
  state: string;                 // 状态字符串
  provider: ThirdPartyProvider;  // 第三方平台
  redirectUri?: string;          // 回调地址
  createdAt: number;             // 创建时间戳
  nonce?: string;                // 随机数
}

/**
 * 第三方OAuth登录服务
 * 支持多种第三方登录平台：微信、QQ、支付宝、微博、GitHub、Google、Facebook、钉钉、飞书、Apple等
 */
@Provide()
export class OAuthService {
  // 日志记录器
  @Inject()
  logger!: ILogger;

  // Redis缓存服务
  @Inject()
  redis!: RedisService;

  // OAuth配置
  @Config('oauth')
  oauthConfig!: Record<string, OAuthConfig>;

  // 用户数据仓库
  @InjectEntityModel(User)
  userRepository!: Repository<User>;

  // 第三方绑定数据仓库
  @InjectEntityModel(ThirdPartyBinding)
  thirdPartyBindingRepository!: Repository<ThirdPartyBinding>;

  // Axios HTTP客户端实例
  private axiosInstance!: AxiosInstance;
  // Redis中state键的前缀
  private readonly STATE_PREFIX = 'oauth:state:';
  // State过期时间：10分钟（单位：秒）
  private readonly STATE_TTL = 600;
  // Redis中code键的前缀
  private readonly CODE_PREFIX = 'oauth:code:';
  // Code过期时间：5分钟（单位：秒）
  private readonly CODE_TTL = 300;

  // 支持的第三方平台列表
  private readonly SUPPORTED_PROVIDERS = [
    ThirdPartyProvider.WECHAT,    // 微信
    ThirdPartyProvider.QQ,        // QQ
    ThirdPartyProvider.ALIPAY,    // 支付宝
    ThirdPartyProvider.WEIBO,     // 微博
    ThirdPartyProvider.GITHUB,    // GitHub
    ThirdPartyProvider.GOOGLE,    // Google
    ThirdPartyProvider.FACEBOOK,  // Facebook
    ThirdPartyProvider.DINGTALK,  // 钉钉
    ThirdPartyProvider.FEISHU,    // 飞书
    ThirdPartyProvider.APPLE,     // Apple
  ];

  @Init()
  async initialize(): Promise<void> {
    console.log('[OAuth Service] Initializing OAuth service...');

    // 创建配置好的axios实例，用于发送HTTP请求
    this.axiosInstance = axios.create({
      timeout: 10000,  // 10秒超时
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    console.log('[OAuth Service] OAuth service initialized');
  }

  /**
   * 生成OAuth授权URL
   * 为指定的第三方平台生成授权URL，用户访问此URL后将被重定向到第三方登录页面
   *
   * @param provider - 第三方平台
   * @param redirectUri - 自定义回调地址（可选）
   * @param state - 自定义state参数（可选，用于防止CSRF攻击）
   * @returns 包含成功标志、授权URL、state参数和可能的错误信息
   */
  async generateAuthUrl(
    provider: ThirdPartyProvider,
    redirectUri?: string,
    state?: string
  ): Promise<{ success: boolean; authUrl?: string; state?: string; error?: string }> {
    try {
      // 获取平台的OAuth配置
      const config = this.getConfig(provider);
      if (!config || !config.enabled) {
        return { success: false, error: `Unsupported or disabled provider: ${provider}` };
      }

      // 生成state参数用于防止CSRF攻击
      const oauthState = state || this.generateState();
      const stateData: OAuthState = {
        state: oauthState,
        provider,
        redirectUri,
        createdAt: Date.now(),
        nonce: randomBytes(16).toString('hex'),  // 随机数用于增强安全性
      };

      // 将state数据保存到Redis，设置过期时间
      await this.redis.set(
        `${this.STATE_PREFIX}${oauthState}`,
        JSON.stringify(stateData),
        'EX',
        this.STATE_TTL
      );

      // 根据不同平台构建对应的授权URL
      const authUrl = this.buildAuthUrl(provider, config, oauthState, redirectUri);

      return {
        success: true,
        authUrl,
        state: oauthState,
      };
    } catch (error: any) {
      console.error('[OAuth Service] Generate auth URL error:', error);
      return {
        success: false,
        error: error.message || 'Failed to generate authorization URL',
      };
    }
  }

  /**
   * 处理OAuth回调
   * 处理第三方平台返回的授权码，完成登录流程
   *
   * @param provider - 第三方平台
   * @param code - 授权码
   * @param state - 状态参数
   * @returns 第三方登录结果
   */
  async handleCallback(
    provider: ThirdPartyProvider,
    code: string,
    state: string
  ): Promise<ThirdPartyLoginResult> {
    try {
      // 验证state参数的有效性
      const stateData = await this.validateState(state, provider);
      if (!stateData) {
        return { success: false, error: 'Invalid or expired state' };
      }

      // 使用授权码获取访问令牌
      const tokenResponse = await this.getAccessToken(provider, code, stateData.redirectUri);
      if (!tokenResponse) {
        return { success: false, error: 'Failed to get access token' };
      }

      // 使用访问令牌获取用户信息
      const userInfo = await this.getUserInfo(provider, tokenResponse);
      if (!userInfo) {
        return { success: false, error: 'Failed to get user info' };
      }

      // 查找已绑定用户或创建新用户
      return await this.findOrCreateUser(provider, userInfo, tokenResponse);
    } catch (error: any) {
      console.error('[OAuth Service] Handle callback error:', error);
      return {
        success: false,
        error: error.message || 'OAuth callback processing failed',
      };
    }
  }

  /**
   * 绑定第三方账号
   * 将第三方账号绑定到当前登录的用户账户
   *
   * @param userId - 用户ID
   * @param provider - 第三方平台
   * @param authCode - 授权码
   * @param state - 状态参数
   * @returns 绑定结果，包含成功标志、绑定记录和可能的错误信息
   */
  async bindAccount(
    userId: string,
    provider: ThirdPartyProvider,
    authCode: string,
    state: string
  ): Promise<{ success: boolean; binding?: ThirdPartyBinding; error?: string }> {
    try {
      // 验证state参数
      const stateData = await this.validateState(state, provider);
      if (!stateData) {
        return { success: false, error: 'Invalid or expired state' };
      }

      // 检查用户是否已绑定该平台
      const existingBinding = await this.thirdPartyBindingRepository.findOne({
        where: { userId, provider } as any,
      });

      if (existingBinding) {
        return { success: false, error: 'Account already bound to this provider' };
      }

      // 获取访问令牌
      const tokenResponse = await this.getAccessToken(provider, authCode, stateData.redirectUri);
      if (!tokenResponse) {
        return { success: false, error: 'Failed to get access token' };
      }

      // 获取第三方平台用户信息
      const userInfo = await this.getUserInfo(provider, tokenResponse);
      if (!userInfo) {
        return { success: false, error: 'Failed to get user info' };
      }

      // 检查该第三方账号是否已被其他用户绑定
      const otherBinding = await this.thirdPartyBindingRepository.findOne({
        where: { provider, openId: userInfo.id } as any,
      });

      if (otherBinding) {
        return { success: false, error: 'This third-party account is already bound to another user' };
      }

      // 创建新的绑定记录
      const binding = this.thirdPartyBindingRepository.create({
        id: IdGenerator.uuid(),
        userId,
        provider,
        openId: userInfo.id,
        unionId: userInfo.unionId,
        userInfo: {
          nickname: userInfo.nickname,
          avatar: userInfo.avatar,
          gender: userInfo.gender,
        },
        bindAt: new Date(),
      });

      await this.thirdPartyBindingRepository.save(binding);

      return { success: true, binding };
    } catch (error: any) {
      console.error('[OAuth Service] Bind account error:', error);
      return {
        success: false,
        error: error.message || 'Failed to bind account',
      };
    }
  }

  /**
   * 解绑第三方账号
   * 将第三方账号从用户账户中解绑
   *
   * @param userId - 用户ID
   * @param provider - 第三方平台
   * @returns 解绑结果，包含成功标志和可能的错误信息
   */
  async unbindAccount(
    userId: string,
    provider: ThirdPartyProvider
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 查找绑定记录
      const binding = await this.thirdPartyBindingRepository.findOne({
        where: { userId, provider } as any,
      });

      if (!binding) {
        return { success: false, error: 'Binding not found' };
      }

      // 删除绑定记录
      await this.thirdPartyBindingRepository.remove(binding);

      return { success: true };
    } catch (error: any) {
      console.error('[OAuth Service] Unbind account error:', error);
      return {
        success: false,
        error: error.message || 'Failed to unbind account',
      };
    }
  }

  /**
   * 获取用户已绑定的第三方账号列表
   *
   * @param userId - 用户ID
   * @returns 第三方账号绑定列表
   */
  async getUserBindings(userId: string): Promise<ThirdPartyBinding[]> {
    return await this.thirdPartyBindingRepository.find({
      where: { userId } as any,
      order: { bindAt: 'DESC' } as any,
    });
  }

  /**
   * 刷新访问令牌
   * 使用刷新令牌获取新的访问令牌（部分平台支持）
   *
   * @param provider - 第三方平台
   * @param refreshToken - 刷新令牌
   * @returns 刷新结果，包含成功标志、新访问令牌和可能的错误信息
   */
  async refreshAccessToken(
    provider: ThirdPartyProvider,
    refreshToken: string
  ): Promise<{ success: boolean; accessToken?: string; expiresIn?: number; error?: string }> {
    try {
      const config = this.getConfig(provider);
      if (!config) {
        return { success: false, error: 'Invalid provider' };
      }

      // 根据不同平台调用对应的刷新令牌方法
      switch (provider) {
        case ThirdPartyProvider.WECHAT:
          return await this.refreshWeChatToken(config, refreshToken);
        case ThirdPartyProvider.QQ:
          return await this.refreshQQToken(config, refreshToken);
        case ThirdPartyProvider.GITHUB:
        case ThirdPartyProvider.GOOGLE:
        case ThirdPartyProvider.FACEBOOK:
          return await this.refreshOAuth2Token(config, refreshToken);
        default:
          return { success: false, error: 'Token refresh not supported for this provider' };
      }
    } catch (error: any) {
      console.error('[OAuth Service] Refresh token error:', error);
      return {
        success: false,
        error: error.message || 'Failed to refresh token',
      };
    }
  }

  /**
   * 获取支持的第三方平台列表
   * 返回所有支持的第三方登录平台及其启用状态
   *
   * @returns 平台列表，包含平台标识、名称和启用状态
   */
  getSupportedProviders(): Array<{ provider: string; name: string; enabled: boolean }> {
    return this.SUPPORTED_PROVIDERS.map(provider => {
      const config = this.oauthConfig[provider];
      return {
        provider,
        name: this.getProviderName(provider),
        enabled: config?.enabled || false,
      };
    });
  }

  // ==================== 私有方法 ====================

  /**
   * 获取平台配置
   * 根据平台标识获取对应的OAuth配置
   *
   * @param provider - 第三方平台
   * @returns OAuth配置对象，不存在时返回undefined
   */
  private getConfig(provider: ThirdPartyProvider): OAuthConfig | undefined {
    return this.oauthConfig[provider];
  }

  /**
   * 获取平台名称
   * 获取平台的中文显示名称
   *
   * @param provider - 第三方平台
   * @returns 平台中文名称
   */
  private getProviderName(provider: ThirdPartyProvider): string {
    const names: Record<ThirdPartyProvider, string> = {
      [ThirdPartyProvider.WECHAT]: '微信',
      [ThirdPartyProvider.QQ]: 'QQ',
      [ThirdPartyProvider.ALIPAY]: '支付宝',
      [ThirdPartyProvider.WEIBO]: '微博',
      [ThirdPartyProvider.GITHUB]: 'GitHub',
      [ThirdPartyProvider.GOOGLE]: 'Google',
      [ThirdPartyProvider.FACEBOOK]: 'Facebook',
      [ThirdPartyProvider.DINGTALK]: '钉钉',
      [ThirdPartyProvider.FEISHU]: '飞书',
      [ThirdPartyProvider.APPLE]: 'Apple',
    };
    return names[provider] || provider;
  }

  /**
   * 生成state参数
   * 生成随机字符串用于防止CSRF攻击
   *
   * @returns 随机生成的state字符串
   */
  private generateState(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * 构建授权URL
   * 根据不同平台的规范构建OAuth授权URL
   *
   * @param provider - 第三方平台
   * @param config - OAuth配置
   * @param state - 状态参数
   * @param redirectUri - 回调地址（可选）
   * @returns 完整的授权URL
   */
  private buildAuthUrl(
    provider: ThirdPartyProvider,
    config: OAuthConfig,
    state: string,
    redirectUri?: string
  ): string {
    const finalRedirectUri = redirectUri || config.redirectUri;

    switch (provider) {
      case ThirdPartyProvider.WECHAT:
        // 微信网页授权
        return `${config.authUrl}?appid=${config.clientId}&redirect_uri=${encodeURIComponent(finalRedirectUri)}&response_type=code&scope=${config.scope?.join(',') || 'snsapi_userinfo'}&state=${state}#wechat_redirect`;

      case ThirdPartyProvider.QQ:
        // QQ互联
        return `${config.authUrl}?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(finalRedirectUri)}&response_type=code&scope=${config.scope?.join(',') || 'get_user_info'}&state=${state}`;

      case ThirdPartyProvider.ALIPAY:
        // 支付宝
        return `${config.authUrl}?app_id=${config.clientId}&scope=${config.scope?.join(',') || 'auth_user'}&redirect_uri=${encodeURIComponent(finalRedirectUri)}&response_type=code&state=${state}`;

      case ThirdPartyProvider.WEIBO:
        // 微博
        return `${config.authUrl}?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(finalRedirectUri)}&response_type=code&scope=${config.scope?.join(',') || 'email'}&state=${state}`;

      case ThirdPartyProvider.GITHUB:
      case ThirdPartyProvider.GOOGLE:
      case ThirdPartyProvider.FACEBOOK:
        // OAuth 2.0 标准流程
        return `${config.authUrl}?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(finalRedirectUri)}&response_type=code&scope=${config.scope?.join(' ') || 'openid profile email'}&state=${state}`;

      case ThirdPartyProvider.DINGTALK:
        // 钉钉
        return `${config.authUrl}?appid=${config.clientId}&redirect_uri=${encodeURIComponent(finalRedirectUri)}&response_type=code&scope=${config.scope?.join(' ') || 'openid corpid'}&state=${state}`;

      case ThirdPartyProvider.FEISHU:
        // 飞书
        return `${config.authUrl}?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(finalRedirectUri)}&response_type=code&scope=${config.scope?.join(' ') || 'email phone'}&state=${state}`;

      case ThirdPartyProvider.APPLE:
        // Apple Sign In
        return `${config.authUrl}?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(finalRedirectUri)}&response_type=code&scope=${config.scope?.join(' ') || 'name email'}&state=${state}&response_mode=form_post`;

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * 验证state
   * 验证state参数的有效性，防止CSRF攻击
   *
   * @param state - 状态字符串
   * @param provider - 第三方平台
   * @returns state数据对象，验证失败时返回null
   */
  private async validateState(state: string, provider: ThirdPartyProvider): Promise<OAuthState | null> {
    const data = await this.redis.get(`${this.STATE_PREFIX}${state}`);
    if (!data) {
      return null;
    }

    const stateData: OAuthState = JSON.parse(data);

    // 验证平台是否匹配
    if (stateData.provider !== provider) {
      return null;
    }

    // 删除已使用的state，防止重放攻击
    await this.redis.del(`${this.STATE_PREFIX}${state}`);

    return stateData;
  }

  /**
   * 获取访问令牌
   * 使用授权码从第三方平台获取访问令牌
   *
   * @param provider - 第三方平台
   * @param code - 授权码
   * @param redirectUri - 回调地址（可选）
   * @returns 令牌响应对象，失败时返回null
   */
  private async getAccessToken(
    provider: ThirdPartyProvider,
    code: string,
    redirectUri?: string
  ): Promise<OAuthTokenResponse | null> {
    const config = this.getConfig(provider);
    if (!config) {
      return null;
    }

    try {
      switch (provider) {
        case ThirdPartyProvider.WECHAT:
          return await this.getWeChatToken(config, code, redirectUri);
        case ThirdPartyProvider.QQ:
          return await this.getQQToken(config, code, redirectUri);
        case ThirdPartyProvider.ALIPAY:
          return await this.getAlipayToken(config, code, redirectUri);
        case ThirdPartyProvider.WEIBO:
        case ThirdPartyProvider.GITHUB:
        case ThirdPartyProvider.GOOGLE:
        case ThirdPartyProvider.FACEBOOK:
        case ThirdPartyProvider.DINGTALK:
        case ThirdPartyProvider.FEISHU:
          return await this.getOAuth2Token(config, code, provider, redirectUri);
        default:
          return null;
      }
    } catch (error) {
      console.error(`[OAuth Service] Get access token error for ${provider}:`, error);
      return null;
    }
  }

  /**
   * 获取微信访问令牌
   *
   * @param config - OAuth配置
   * @param code - 授权码
   * @param redirectUri - 回调地址
   * @returns 令牌响应对象
   */
  private async getWeChatToken(
    config: OAuthConfig,
    code: string,
    redirectUri?: string
  ): Promise<OAuthTokenResponse | null> {
    const url = `${config.tokenUrl}?appid=${config.clientId}&secret=${config.clientSecret}&code=${code}&grant_type=authorization_code`;

    const response = await this.axiosInstance.get(url);
    const data = response.data;

    if (data.errcode) {
      throw new Error(`WeChat OAuth error: ${data.errcode} - ${data.errmsg}`);
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      openid: data.openid,
      unionid: data.unionid,
    };
  }

  /**
   * 获取QQ访问令牌
   *
   * @param config - OAuth配置
   * @param code - 授权码
   * @param redirectUri - 回调地址
   * @returns 令牌响应对象
   */
  private async getQQToken(
    config: OAuthConfig,
    code: string,
    redirectUri?: string
  ): Promise<OAuthTokenResponse | null> {
    const url = `${config.tokenUrl}?client_id=${config.clientId}&client_secret=${config.clientSecret}&code=${code}&redirect_uri=${encodeURIComponent(redirectUri || config.redirectUri)}&grant_type=authorization_code`;

    const response = await this.axiosInstance.get(url, {
      headers: { 'Accept': 'text/plain' },
    });

    // QQ返回的是URL编码的字符串格式
    const params = new URLSearchParams(response.data);
    const accessToken = params.get('access_token');

    if (!accessToken) {
      throw new Error('QQ OAuth error: Failed to get access token');
    }

    // 获取openid（需要额外调用API）
    const openIdUrl = `https://graph.qq.com/oauth2.0/me?access_token=${accessToken}`;
    const openIdResponse = await this.axiosInstance.get(openIdUrl, {
      headers: { 'Accept': 'text/plain' },
    });

    // QQ返回的是callback({client_id:"xxx",openid:"xxx"})格式
    const openIdMatch = openIdResponse.data.match(/"openid"\s*:\s*"([^"]+)"/);
    const openId = openIdMatch ? openIdMatch[1] : null;

    return {
      access_token: accessToken,
      expires_in: parseInt(params.get('expires_in') || '7776000', 10),
      openid: openId,
    };
  }

  /**
   * 获取支付宝访问令牌
   *
   * @param config - OAuth配置
   * @param code - 授权码
   * @param redirectUri - 回调地址
   * @returns 令牌响应对象
   */
  private async getAlipayToken(
    config: OAuthConfig,
    code: string,
    redirectUri?: string
  ): Promise<OAuthTokenResponse | null> {
    // 支付宝使用RSA签名
    const url = config.tokenUrl;
    const params = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri || config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    };

    const response = await this.axiosInstance.post(url, params);
    const data = response.data;

    if (data.error) {
      throw new Error(`Alipay OAuth error: ${data.error} - ${data.error_description}`);
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      user_id: data.user_id,
    };
  }

  /**
   * 获取标准OAuth2.0访问令牌
   * 适用于GitHub、Google、Facebook等遵循OAuth2.0标准的平台
   *
   * @param config - OAuth配置
   * @param code - 授权码
   * @param provider - 第三方平台
   * @param redirectUri - 回调地址
   * @returns 令牌响应对象
   */
  private async getOAuth2Token(
    config: OAuthConfig,
    code: string,
    provider: ThirdPartyProvider,
    redirectUri?: string
  ): Promise<OAuthTokenResponse | null> {
    const url = config.tokenUrl;
    const params: Record<string, string> = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
    };

    // GitHub和Google需要指定redirect_uri
    if (provider === ThirdPartyProvider.GITHUB || provider === ThirdPartyProvider.GOOGLE) {
      params.redirect_uri = redirectUri || config.redirectUri;
    }

    const response = await this.axiosInstance.post(url, null, { params });
    const data = response.data;

    if (data.error) {
      throw new Error(`${provider} OAuth error: ${data.error} - ${data.error_description}`);
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
    };
  }

  /**
   * 获取用户信息
   */
  private async getUserInfo(
    provider: ThirdPartyProvider,
    tokenResponse: OAuthTokenResponse
  ): Promise<OAuthUserInfo | null> {
    const config = this.getConfig(provider);
    if (!config) {
      return null;
    }

    try {
      switch (provider) {
        case ThirdPartyProvider.WECHAT:
          return await this.getWeChatUserInfo(config, tokenResponse);
        case ThirdPartyProvider.QQ:
          return await this.getQQUserInfo(config, tokenResponse);
        case ThirdPartyProvider.ALIPAY:
          return await this.getAlipayUserInfo(config, tokenResponse);
        case ThirdPartyProvider.WEIBO:
          return await this.getWeiboUserInfo(config, tokenResponse);
        case ThirdPartyProvider.GITHUB:
          return await this.getGitHubUserInfo(config, tokenResponse);
        case ThirdPartyProvider.GOOGLE:
          return await this.getGoogleUserInfo(config, tokenResponse);
        case ThirdPartyProvider.FACEBOOK:
          return await this.getFacebookUserInfo(config, tokenResponse);
        case ThirdPartyProvider.DINGTALK:
          return await this.getDingTalkUserInfo(config, tokenResponse);
        case ThirdPartyProvider.FEISHU:
          return await this.getFeishuUserInfo(config, tokenResponse);
        case ThirdPartyProvider.APPLE:
          return await this.getAppleUserInfo(config, tokenResponse);
        default:
          return null;
      }
    } catch (error) {
      console.error(`[OAuth Service] Get user info error for ${provider}:`, error);
      return null;
    }
  }

  /**
   * 获取微信用户信息
   */
  private async getWeChatUserInfo(
    config: OAuthConfig,
    tokenResponse: OAuthTokenResponse
  ): Promise<OAuthUserInfo | null> {
    const url = `${config.userInfoUrl}?access_token=${tokenResponse.access_token}&openid=${tokenResponse.openid}&lang=zh_CN`;

    const response = await this.axiosInstance.get(url);
    const data = response.data;

    if (data.errcode) {
      throw new Error(`WeChat user info error: ${data.errcode} - ${data.errmsg}`);
    }

    return {
      id: tokenResponse.openid!,
      unionId: tokenResponse.unionid,
      nickname: data.nickname,
      avatar: data.headimgurl,
      gender: data.sex === 1 ? 'male' : data.sex === 2 ? 'female' : 'unknown',
      country: data.country,
      province: data.province,
      city: data.city,
      raw: data,
    };
  }

  /**
   * 获取QQ用户信息
   */
  private async getQQUserInfo(
    config: OAuthConfig,
    tokenResponse: OAuthTokenResponse
  ): Promise<OAuthUserInfo | null> {
    const url = `${config.userInfoUrl}?access_token=${tokenResponse.access_token}&oauth_consumer_key=${config.clientId}&openid=${tokenResponse.openid}`;

    const response = await this.axiosInstance.get(url);
    const data = response.data;

    if (data.ret !== 0) {
      throw new Error(`QQ user info error: ${data.ret} - ${data.msg}`);
    }

    return {
      id: tokenResponse.openid!,
      nickname: data.nickname,
      avatar: data.figureurl_qq_2 || data.figureurl_qq_1,
      gender: data.gender === '男' ? 'male' : data.gender === '女' ? 'female' : 'unknown',
      raw: data,
    };
  }

  /**
   * 获取支付宝用户信息
   */
  private async getAlipayUserInfo(
    config: OAuthConfig,
    tokenResponse: OAuthTokenResponse
  ): Promise<OAuthUserInfo | null> {
    const url = config.userInfoUrl;
    const params = {
      auth_token: tokenResponse.access_token,
    };

    const response = await this.axiosInstance.post(url, null, { params });
    const data = response.data;

    return {
      id: (tokenResponse as any).user_id,
      nickname: data.nick_name,
      avatar: data.avatar,
      gender: 'unknown',
      raw: data,
    };
  }

  /**
   * 获取微博用户信息
   */
  private async getWeiboUserInfo(
    config: OAuthConfig,
    tokenResponse: OAuthTokenResponse
  ): Promise<OAuthUserInfo | null> {
    const url = `${config.userInfoUrl}?access_token=${tokenResponse.access_token}&uid=${tokenResponse.openid}`;

    const response = await this.axiosInstance.get(url);
    const data = response.data;

    return {
      id: data.idstr,
      nickname: data.screen_name,
      avatar: data.avatar_large,
      gender: data.gender === 'm' ? 'male' : data.gender === 'f' ? 'female' : 'unknown',
      raw: data,
    };
  }

  /**
   * 获取GitHub用户信息
   */
  private async getGitHubUserInfo(
    config: OAuthConfig,
    tokenResponse: OAuthTokenResponse
  ): Promise<OAuthUserInfo | null> {
    const response = await this.axiosInstance.get(config.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${tokenResponse.access_token}`,
      },
    });
    const data = response.data;

    return {
      id: data.id.toString(),
      nickname: data.login,
      avatar: data.avatar_url,
      email: data.email,
      raw: data,
    };
  }

  /**
   * 获取Google用户信息
   */
  private async getGoogleUserInfo(
    config: OAuthConfig,
    tokenResponse: OAuthTokenResponse
  ): Promise<OAuthUserInfo | null> {
    const response = await this.axiosInstance.get(config.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${tokenResponse.access_token}`,
      },
    });
    const data = response.data;

    return {
      id: data.sub,
      email: data.email,
      nickname: data.name,
      avatar: data.picture,
      raw: data,
    };
  }

  /**
   * 获取Facebook用户信息
   */
  private async getFacebookUserInfo(
    config: OAuthConfig,
    tokenResponse: OAuthTokenResponse
  ): Promise<OAuthUserInfo | null> {
    const url = `${config.userInfoUrl}?fields=id,name,email,picture`;
    const response = await this.axiosInstance.get(url, {
      headers: {
        Authorization: `Bearer ${tokenResponse.access_token}`,
      },
    });
    const data = response.data;

    return {
      id: data.id,
      nickname: data.name,
      email: data.email,
      avatar: data.picture?.data?.url,
      raw: data,
    };
  }

  /**
   * 获取钉钉用户信息
   */
  private async getDingTalkUserInfo(
    config: OAuthConfig,
    tokenResponse: OAuthTokenResponse
  ): Promise<OAuthUserInfo | null> {
    const response = await this.axiosInstance.get(config.userInfoUrl, {
      headers: {
        'x-acs-dingtalk-access-token': tokenResponse.access_token,
      },
    });
    const data = response.data;

    return {
      id: data.unionId || data.openId,
      nickname: data.nick,
      avatar: data.avatarUrl,
      email: data.email,
      phone: data.mobile,
      raw: data,
    };
  }

  /**
   * 获取飞书用户信息
   */
  private async getFeishuUserInfo(
    config: OAuthConfig,
    tokenResponse: OAuthTokenResponse
  ): Promise<OAuthUserInfo | null> {
    const response = await this.axiosInstance.get(config.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${tokenResponse.access_token}`,
      },
    });
    const data = response.data;

    return {
      id: data.open_id,
      nickname: data.name,
      avatar: data.avatar_url,
      email: data.email,
      phone: data.mobile,
      raw: data,
    };
  }

  /**
   * 获取Apple用户信息
   */
  private async getAppleUserInfo(
    config: OAuthConfig,
    tokenResponse: OAuthTokenResponse
  ): Promise<OAuthUserInfo | null> {
    const response = await this.axiosInstance.get(config.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${tokenResponse.access_token}`,
      },
    });
    const data = response.data;

    return {
      id: data.sub,
      email: data.email,
      nickname: data.name?.firstName && data.name?.lastName
        ? `${data.name.firstName} ${data.name.lastName}`
        : undefined,
      raw: data,
    };
  }

  /**
   * 查找或创建用户
   * 根据第三方用户信息查找已绑定的用户，如果不存在则创建新用户
   *
   * @param provider - 第三方平台
   * @param userInfo - OAuth用户信息
   * @param tokenResponse - 令牌响应
   * @returns 第三方登录结果
   */
  private async findOrCreateUser(
    provider: ThirdPartyProvider,
    userInfo: OAuthUserInfo,
    tokenResponse: OAuthTokenResponse
  ): Promise<ThirdPartyLoginResult> {
    try {
      // 查找是否存在绑定记录
      const binding = await this.thirdPartyBindingRepository.findOne({
        where: {
          provider,
          openId: userInfo.id,
        } as any,
      });

      if (binding) {
        // 找到绑定记录，获取对应的用户
        const user = await this.userRepository.findOne({
          where: { id: binding.userId } as any,
        });

        if (user) {
          // 更新绑定的用户信息（昵称、头像等可能发生变化）
          binding.userInfo = {
            nickname: userInfo.nickname,
            avatar: userInfo.avatar,
            gender: userInfo.gender,
          };
          await this.thirdPartyBindingRepository.save(binding);

          return {
            success: true,
            user,
            isNewUser: false,
            binding,
          };
        }
      }

      // 未找到绑定记录，创建新用户
      const user = this.userRepository.create({
        id: IdGenerator.uuid(),
        username: `${provider}_${userInfo.id}`,
        nickname: userInfo.nickname || `${provider}用户`,
        avatar: userInfo.avatar,
        email: userInfo.email,
        phone: userInfo.phone,
        emailVerified: !!userInfo.email,
        phoneVerified: !!userInfo.phone,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        passwordHash: '',
        gender: undefined,
        birthDate: undefined,
        location: '',
        bio: '',
        lastLoginAt: undefined,
        lastLoginIp: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await this.userRepository.save(user);

      // 创建新的绑定记录
      const newBinding = this.thirdPartyBindingRepository.create({
        id: IdGenerator.uuid(),
        userId: user.id,
        provider,
        openId: userInfo.id,
        unionId: userInfo.unionId,
        userInfo: {
          nickname: userInfo.nickname,
          avatar: userInfo.avatar,
          gender: userInfo.gender,
        },
        bindAt: new Date(),
      });

      await this.thirdPartyBindingRepository.save(newBinding);

      return {
        success: true,
        user,
        isNewUser: true,
        binding: newBinding,
      };
    } catch (error) {
      console.error('[OAuth Service] Find or create user error:', error);
      return {
        success: false,
        error: 'Failed to find or create user',
      };
    }
  }

  /**
   * 刷新微信令牌
   * 使用刷新令牌获取新的微信访问令牌
   *
   * @param config - OAuth配置
   * @param refreshToken - 刷新令牌
   * @returns 刷新结果
   */
  private async refreshWeChatToken(
    config: OAuthConfig,
    refreshToken: string
  ): Promise<{ success: boolean; accessToken?: string; expiresIn?: number; error?: string }> {
    try {
      const url = `${config.tokenUrl}?appid=${config.clientId}&grant_type=refresh_token&refresh_token=${refreshToken}`;

      const response = await this.axiosInstance.get(url);
      const data = response.data;

      if (data.errcode) {
        return { success: false, error: `WeChat refresh error: ${data.errcode}` };
      }

      return {
        success: true,
        accessToken: data.access_token,
        expiresIn: data.expires_in,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 刷新QQ令牌
   * 使用刷新令牌获取新的QQ访问令牌（暂未实现）
   *
   * @param config - OAuth配置
   * @param refreshToken - 刷新令牌
   * @returns 刷新结果
   */
  private async refreshQQToken(
    config: OAuthConfig,
    refreshToken: string
  ): Promise<{ success: boolean; accessToken?: string; expiresIn?: number; error?: string }> {
    // QQ的refresh token实现比较复杂，这里简化处理
    return { success: false, error: 'QQ token refresh not implemented' };
  }

  /**
   * 刷新OAuth2.0标准令牌
   * 使用刷新令牌获取新的访问令牌（适用于GitHub、Google、Facebook等）
   *
   * @param config - OAuth配置
   * @param refreshToken - 刷新令牌
   * @returns 刷新结果
   */
  private async refreshOAuth2Token(
    config: OAuthConfig,
    refreshToken: string
  ): Promise<{ success: boolean; accessToken?: string; expiresIn?: number; error?: string }> {
    try {
      const url = config.tokenUrl;
      const params = {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      };

      const response = await this.axiosInstance.post(url, null, { params });
      const data = response.data;

      if (data.error) {
        return { success: false, error: data.error };
      }

      return {
        success: true,
        accessToken: data.access_token,
        expiresIn: data.expires_in,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
