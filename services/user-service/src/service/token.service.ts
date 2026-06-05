/**
 * 令牌服务
 *
 * 负责生成和管理 JWT 访问令牌和刷新令牌
 * 提供统一的令牌生成接口，供 AuthService、FaceIdService 等其他服务使用
 *
 * 主要功能：
 * - 生成访问令牌
 * - 生成刷新令牌
 * - 验证令牌
 * - 解析令牌
 */
import { Provide, Inject } from '@midwayjs/core';
import { JwtService } from '@midwayjs/jwt';
import { ILogger } from '@midwayjs/logger';
import { User } from '../entity/user.entity';
import { UserRole } from '@baby-monitor/shared-types';

/**
 * 令牌负载接口
 */
export interface TokenPayload {
  userId?: string;
  username?: string;
  role?: UserRole;
  type?: 'access' | 'refresh';
  [key: string]: any;
}

/**
 * 令牌对接口
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * 令牌服务类
 *
 * 提供统一的令牌生成和管理功能
 */
@Provide()
export class TokenService {
  @Inject()
  jwt!: JwtService;

  @Inject()
  logger!: ILogger;

  // 访问令牌过期时间：2小时（单位：秒）
  private readonly ACCESS_TOKEN_EXPIRES_IN = 7200;
  // 刷新令牌过期时间：7天（单位：秒）
  private readonly REFRESH_TOKEN_EXPIRES_IN = 604800;

  /**
   * 生成访问令牌
   * 创建用于API访问的JWT令牌
   *
   * @param user - 用户对象
   * @param additionalPayload - 额外的负载数据（可选）
   * @returns 访问令牌字符串
   */
  async generateAccessToken(user: User, additionalPayload?: Record<string, any>): Promise<string> {
    const payload: TokenPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      phone: (user as any).phone || undefined,
      type: 'access',
      ...additionalPayload,
    };

    this.logger.info(`[TokenService] Generating access token for user: ${user.id}`);
    return await this.jwt.sign(payload);
  }

  /**
   * 生成刷新令牌
   * 创建用于刷新访问令牌的JWT令牌
   *
   * @param user - 用户对象
   * @param additionalPayload - 额外的负载数据（可选）
   * @returns 刷新令牌字符串
   */
  async generateRefreshToken(user: User, additionalPayload?: Record<string, any>): Promise<string> {
    const payload: TokenPayload = {
      userId: user.id,
      type: 'refresh',
      ...additionalPayload,
    };

    this.logger.info(`[TokenService] Generating refresh token for user: ${user.id}`);
    return await this.jwt.sign(payload, { expiresIn: '7d' });
  }

  /**
   * 生成令牌对
   * 同时生成访问令牌和刷新令牌
   *
   * @param user - 用户对象
   * @param additionalPayload - 额外的负载数据（可选）
   * @returns 令牌对，包含访问令牌、刷新令牌和过期时间
   */
  async generateTokenPair(user: User, additionalPayload?: Record<string, any>): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(user, additionalPayload),
      this.generateRefreshToken(user, additionalPayload),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.ACCESS_TOKEN_EXPIRES_IN,
    };
  }

  /**
   * 验证令牌
   * 验证JWT令牌的有效性并解析负载
   *
   * @param token - JWT令牌字符串
   * @returns 令牌负载，验证失败返回null
   */
  async verifyToken(token: string): Promise<TokenPayload | null> {
    try {
      const decoded = await this.jwt.verify(token) as any;
      if (decoded && decoded.userId && decoded.type) {
        return decoded as TokenPayload;
      }
      return null;
    } catch (error) {
      this.logger.warn(`[TokenService] Token verification failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * 解码令牌
   * 解码JWT令牌（不验证签名）获取负载
   *
   * @param token - JWT令牌字符串
   * @returns 令牌负载，解码失败返回null
   */
  async decodeToken(token: string): Promise<TokenPayload | null> {
    try {
      const decoded = await this.jwt.decode(token) as any;
      if (decoded && decoded.userId && decoded.type) {
        return decoded as TokenPayload;
      }
      return null;
    } catch (error) {
      this.logger.warn(`[TokenService] Token decode failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * 检查令牌类型
   *
   * @param token - JWT令牌字符串
   * @param expectedType - 期望的令牌类型
   * @returns 是否匹配期望的类型
   */
  async checkTokenType(token: string, expectedType: 'access' | 'refresh'): Promise<boolean> {
    const payload = await this.decodeToken(token);
    return payload?.type === expectedType;
  }

  /**
   * 从令牌中获取用户ID
   *
   * @param token - JWT令牌字符串
   * @returns 用户ID，解析失败返回null
   */
  async getUserIdFromToken(token: string): Promise<string | null> {
    const payload = await this.decodeToken(token);
    return payload?.userId || null;
  }

  /**
   * 获取访问令牌过期时间
   *
   * @returns 访问令牌过期时间（秒）
   */
  getAccessTokenExpiresIn(): number {
    return this.ACCESS_TOKEN_EXPIRES_IN;
  }

  /**
   * 获取刷新令牌过期时间
   *
   * @returns 刷新令牌过期时间（秒）
   */
  getRefreshTokenExpiresIn(): number {
    return this.REFRESH_TOKEN_EXPIRES_IN;
  }

  /**
   * 生成自定义令牌
   * 用于生成带有自定义负载的令牌
   *
   * @param payload - 自定义负载数据
   * @param expiresIn - 过期时间（秒），默认使用访问令牌过期时间
   * @returns JWT令牌字符串
   */
  async generateCustomToken(payload: Record<string, any>, expiresIn?: number): Promise<string> {
    const defaultPayload: any = {
      type: 'access',
      ...payload,
    };

    if (expiresIn) {
      return await this.jwt.sign(defaultPayload, { expiresIn });
    }

    return await this.jwt.sign(defaultPayload);
  }

  /**
   * 刷新令牌对
   * 验证旧令牌并生成新的令牌对
   *
   * @param refreshToken - 刷新令牌
   * @param user - 用户对象（用于生成新令牌）
   * @param additionalPayload - 额外的负载数据（可选）
   * @returns 新的令牌对，验证失败返回null
   */
  async refreshTokens(
    refreshToken: string,
    user: User,
    additionalPayload?: Record<string, any>
  ): Promise<TokenPair | null> {
    // 验证刷新令牌
    const payload = await this.verifyToken(refreshToken);
    if (!payload || payload.type !== 'refresh' || payload.userId !== user.id) {
      this.logger.warn('[TokenService] Invalid refresh token');
      return null;
    }

    // 生成新的令牌对
    return this.generateTokenPair(user, additionalPayload);
  }

  /**
   * 从请求头中提取令牌
   * 从 Authorization 请求头中提取 Bearer 令牌
   *
   * @param authorization - Authorization 请求头的值
   * @returns JWT令牌字符串，未找到返回null
   */
  extractTokenFromHeader(authorization?: string): string | null {
    if (!authorization) {
      return null;
    }

    // 支持 "Bearer <token>" 格式
    const parts = authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      return parts[1];
    }

    // 直接返回令牌（兼容没有 Bearer 前缀的情况）
    return authorization;
  }
}
