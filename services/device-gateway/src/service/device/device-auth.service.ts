import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { CacheManager } from '@baby-monitor/shared-utils';
import { JsonUtil } from '@baby-monitor/shared-utils';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * 设备认证信息
 */
export interface DeviceAuthInfo {
  deviceId: string;
  serialNumber: string;
  productType: string;
  firmwareVersion: string;
  protocol: 'matter' | 'private';
  publicKey?: string;
  certificate?: string;
}

/**
 * 设备令牌
 */
export interface DeviceToken {
  deviceId: string;
  token: string;
  expiresAt: number;
  createdAt: number;
}

/**
 * 设备认证请求
 */
export interface DeviceAuthRequest {
  deviceId: string;
  serialNumber: string;
  signature: string;
  timestamp: number;
  protocol: 'matter' | 'private';
}

/**
 * 设备认证响应
 */
export interface DeviceAuthResponse {
  success: boolean;
  token?: string;
  expiresAt?: number;
  error?: string;
}

/**
 * 设备认证服务
 *
 * 负责设备认证和授权
 * 支持基于签名和证书的认证方式
 *
 * 职责：
 * - 验证设备身份
 * - 生成和管理设备令牌
 * - 处理设备注册认证
 * - 维护设备认证状态
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class DeviceAuthService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  // Redis键前缀
  private readonly AUTH_PREFIX = 'device:auth:';
  private readonly TOKEN_PREFIX = 'device:token:';
  private readonly DEVICE_KEY_PREFIX = 'device:key:';
  private readonly NONCE_PREFIX = 'device:nonce:';

  // 配置
  private readonly TOKEN_EXPIRE = 86400; // 24小时
  private readonly NONCE_EXPIRE = 300; // 5分钟
  private readonly DEVICE_SECRET = process.env.DEVICE_SECRET || 'default-device-secret-key-change-in-production';

  /**
   * 验证设备认证请求
   *
   * @param authRequest 认证请求
   */
  async authenticateDevice(authRequest: DeviceAuthRequest): Promise<DeviceAuthResponse> {
    try {
      // 1. 验证时间戳（防重放攻击）
      const now = Date.now();
      const timeDiff = Math.abs(now - authRequest.timestamp);
      if (timeDiff > 60000) { // 1分钟容差
        return { success: false, error: 'Timestamp expired' };
      }

      // 2. 验证签名
      const isValid = await this.verifySignature(authRequest);
      if (!isValid) {
        this.logger.warn(`[Device Auth] Authentication failed for device: ${authRequest.deviceId}`);
        return { success: false, error: 'Invalid signature' };
      }

      // 3. 检查设备是否已注册
      const deviceInfo = await this.getDeviceInfo(authRequest.deviceId);
      if (!deviceInfo) {
        return { success: false, error: 'Device not registered' };
      }

      // 4. 生成访问令牌
      const token = await this.generateToken(authRequest.deviceId);

      // 5. 存储认证状态
      await this.storeAuthInfo(authRequest.deviceId, {
        ...authRequest,
        ...deviceInfo,
      });

      this.logger.info(`[Device Auth] Device authenticated: ${authRequest.deviceId}`);

      return {
        success: true,
        token,
        expiresAt: now + this.TOKEN_EXPIRE * 1000,
      };
    } catch (error) {
      this.logger.error('[Device Auth] Authentication error:', error);
      return { success: false, error: 'Authentication failed' };
    }
  }

  /**
   * 验证设备令牌
   *
   * @param deviceId 设备ID
   * @param token 访问令牌
   */
  async verifyToken(deviceId: string, token: string): Promise<boolean> {
    const key = `${this.TOKEN_PREFIX}${deviceId}`;
    const stored = await this.redis.get(key);

    if (!stored) {
      return false;
    }

    const tokenData = JSON.parse(stored) as DeviceToken;

    // 检查令牌是否过期
    if (Date.now() > tokenData.expiresAt) {
      await this.redis.del(key);
      return false;
    }

    return tokenData.token === token;
  }

  /**
   * 刷新设备令牌
   *
   * @param deviceId 设备ID
   */
  async refreshToken(deviceId: string): Promise<string | null> {
    // 验证旧令牌是否存在
    const key = `${this.TOKEN_PREFIX}${deviceId}`;
    const stored = await this.redis.get(key);

    if (!stored) {
      return null;
    }

    // 生成新令牌
    const newToken = await this.generateToken(deviceId);

    this.logger.info(`[Device Auth] Token refreshed for device: ${deviceId}`);

    return newToken;
  }

  /**
   * 撤销设备令牌
   *
   * @param deviceId 设备ID
   */
  async revokeToken(deviceId: string): Promise<void> {
    await this.redis.del(`${this.TOKEN_PREFIX}${deviceId}`);
    this.logger.info(`[Device Auth] Token revoked for device: ${deviceId}`);
  }

  /**
   * 注册设备密钥
   * 在设备首次注册时调用
   *
   * @param deviceId 设备ID
   * @param publicKey 公钥
   */
  async registerDeviceKey(deviceId: string, publicKey: string): Promise<void> {
    const key = `${this.DEVICE_KEY_PREFIX}${deviceId}`;
    await this.cacheManager.set(key, publicKey, 0); // 永不过期
    this.logger.info(`[Device Auth] Device key registered: ${deviceId}`);
  }

  /**
   * 生成认证随机数
   * 用于挑战-响应认证
   *
   * @param deviceId 设备ID
   */
  async generateNonce(deviceId: string): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    const key = `${this.NONCE_PREFIX}${nonce}`;
    await this.cacheManager.set(key, deviceId, this.NONCE_EXPIRE);
    return nonce;
  }

  /**
   * 验证并消耗随机数
   *
   * @param nonce 随机数
   * @param expectedDeviceId 期望的设备ID
   */
  async verifyNonce(nonce: string, expectedDeviceId: string): Promise<boolean> {
    const key = `${this.NONCE_PREFIX}${nonce}`;
    const cached = await this.cacheManager.get<string>(key);

    if (!cached.hit || cached.data !== expectedDeviceId) {
      return false;
    }

    // 消耗随机数（一次性使用）
    await this.cacheManager.del(key);

    return true;
  }

  /**
   * 验证签名
   *
   * @param authRequest 认证请求
   */
  private async verifySignature(authRequest: DeviceAuthRequest): Promise<boolean> {
    try {
      // 获取设备公钥
      const publicKey = await this.cacheManager.get<string>(`${this.DEVICE_KEY_PREFIX}${authRequest.deviceId}`);

      if (!publicKey) {
        // 如果没有公钥，使用设备密钥进行HMAC验证
        const expectedSignature = this.generateSignature(authRequest);
        return timingSafeEqual(Buffer.from(authRequest.signature), Buffer.from(expectedSignature));
      }

      // 使用公钥验证签名
      return this.verifySignatureWithPublicKey(authRequest, publicKey.data!);
    } catch (error) {
      this.logger.error('[Device Auth] Signature verification error:', error);
      return false;
    }
  }

  /**
   * 使用公钥验证签名
   *
   * @param authRequest 认证请求
   * @param publicKey PEM格式的公钥
   */
  private verifySignatureWithPublicKey(authRequest: DeviceAuthRequest, publicKey: string): boolean {
    try {
      const { createVerify } = require('crypto');

      // 构建待验证数据
      const data = `${authRequest.deviceId}:${authRequest.serialNumber}:${authRequest.timestamp}`;

      // 创建验证器
      const verify = createVerify('sha256');
      verify.update(data);
      verify.end(Buffer.from(authRequest.signature, 'base64'));

      // 验证签名
      const isValid = verify.verify(publicKey);

      if (!isValid) {
        this.logger.warn(`[Device Auth] Signature verification failed for device: ${authRequest.deviceId}`);
      }

      return isValid;
    } catch (error) {
      this.logger.error('[Device Auth] Public key verification error:', error);
      return false;
    }
  }

  /**
   * 生成签名
   * 使用共享密钥生成HMAC签名
   *
   * @param authRequest 认证请求
   */
  private generateSignature(authRequest: DeviceAuthRequest): string {
    const data = `${authRequest.deviceId}:${authRequest.serialNumber}:${authRequest.timestamp}`;
    const hmac = createHash('sha256');
    hmac.update(data + this.DEVICE_SECRET);
    return hmac.digest('hex');
  }

  /**
   * 生成令牌
   *
   * @param deviceId 设备ID
   */
  private async generateToken(deviceId: string): Promise<string> {
    const tokenData: DeviceToken = {
      deviceId,
      token: this.generateRandomToken(),
      expiresAt: Date.now() + this.TOKEN_EXPIRE * 1000,
      createdAt: Date.now(),
    };

    const key = `${this.TOKEN_PREFIX}${deviceId}`;
    await this.redis.set(key, JsonUtil.stringify(tokenData));
    await this.redis.expire(key, this.TOKEN_EXPIRE);

    return tokenData.token;
  }

  /**
   * 生成随机令牌
   */
  private generateRandomToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * 存储认证信息
   *
   * @param deviceId 设备ID
   * @param authInfo 认证信息
   */
  private async storeAuthInfo(deviceId: string, authInfo: DeviceAuthInfo): Promise<void> {
    const key = `${this.AUTH_PREFIX}${deviceId}`;
    await this.cacheManager.set(key, authInfo, this.TOKEN_EXPIRE);
  }

  /**
   * 获取设备信息
   *
   * @param deviceId 设备ID
   */
  private async getDeviceInfo(deviceId: string): Promise<DeviceAuthInfo | null> {
    // 这里应该从设备服务获取设备信息
    // 简化实现，返回基本设备信息
    return {
      deviceId,
      serialNumber: deviceId,
      productType: 'unknown',
      firmwareVersion: '1.0.0',
      protocol: 'private',
    };
  }

  /**
   * 获取设备认证状态
   *
   * @param deviceId 设备ID
   */
  async getDeviceAuthStatus(deviceId: string): Promise<{
    authenticated: boolean;
    tokenValid: boolean;
    expiresAt?: number;
  }> {
    const authKey = `${this.AUTH_PREFIX}${deviceId}`;
    const tokenKey = `${this.TOKEN_PREFIX}${deviceId}`;

    const authInfo = await this.cacheManager.get<DeviceAuthInfo>(authKey);
    const tokenData = await this.redis.get(tokenKey);

    if (!authInfo || !tokenData) {
      return { authenticated: false, tokenValid: false };
    }

    const token = JSON.parse(tokenData) as DeviceToken;
    const tokenValid = Date.now() < token.expiresAt;

    return {
      authenticated: true,
      tokenValid,
      expiresAt: token.expiresAt,
    };
  }
}
