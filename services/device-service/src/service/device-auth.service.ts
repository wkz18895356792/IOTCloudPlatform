import { Provide, Inject, Scope, ScopeEnum, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@midwayjs/redis';
import {
  DeviceSignatureUtils,
  HMACAlgorithm,
  AuthErrorCode,
  AuthErrorMessage,
} from '@baby-monitor/shared-utils';
import {
  DeviceCertificate,
  CertificateType,
  CertificateStatus,
} from '../entity/device-certificate.entity';
import { ProductConfig, AuthMethod, ProductStatus } from '../entity/product-config.entity';
import {
  DeviceWhitelist,
  DeviceIdentifierType,
  WhitelistStatus,
} from '../entity/device-whitelist.entity';
import {
  UserDeviceQuota,
  QuotaStatus,
} from '../entity/user-device-quota.entity';
import {
  DeviceRegistrationAudit,
  RegistrationResult,
} from '../entity/device-registration-audit.entity';

/**
 * 设备注册请求（增强版）
 */
export interface DeviceAuthRequest {
  deviceId: string;
  productId: string;
  productType: number;
  cloudProvider: number;
  timestamp: number;
  nonce: string;
  userId?: string;

  // 认证信息（至少提供一种）
  signature?: string;
  certChain?: string[];
  registrationCode?: string;

  // 设备指纹
  deviceFingerprint?: string;
  macAddress?: string;

  // 其他信息
  firmwareVersion?: string;
}

/**
 * 设备认证结果
 */
export interface DeviceAuthResult {
  success: boolean;
  code: AuthErrorCode;
  message: string;
  deviceId?: string;
  serialNumber?: string;
  warnings?: string[];
}

/**
 * 设备认证服务
 *
 * 负责设备注册前的合法性验证
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class DeviceAuthService {
  @Inject()
  logger!: ILogger;

  @InjectEntityModel(DeviceCertificate)
  deviceCertificateRepository!: Repository<DeviceCertificate>;

  @InjectEntityModel(ProductConfig)
  productConfigRepository!: Repository<ProductConfig>;

  @InjectEntityModel(DeviceWhitelist)
  deviceWhitelistRepository!: Repository<DeviceWhitelist>;

  @InjectEntityModel(UserDeviceQuota)
  userDeviceQuotaRepository!: Repository<UserDeviceQuota>;

  @InjectEntityModel(DeviceRegistrationAudit)
  auditRepository!: Repository<DeviceRegistrationAudit>;

  @Inject()
  redisService!: RedisService;

  /**
   * 获取 Redis 客户端
   */
  private get redis() {
    return this.redisService;
  }

  /**
   * 主入口：验证设备注册请求
   *
   * @param request - 设备认证请求
   * @param correlationId - 关联ID
   * @param clientIp - 客户端IP
   * @returns 认证结果
   */
  async authenticateDevice(
    request: DeviceAuthRequest,
    correlationId: string,
    clientIp?: string
  ): Promise<DeviceAuthResult> {
    const warnings: string[] = [];
    let auditData: Partial<DeviceRegistrationAudit> = {
      correlationId,
      deviceSerialNumber: request.deviceId,
      productId: request.productId,
      clientIp,
      result: RegistrationResult.FAILURE,
    };

    try {
      // 1. 获取产品配置
      const productConfig = await this.getProductConfig(request.productId);
      if (!productConfig) {
        auditData.errorCode = AuthErrorCode.PRODUCT_NOT_FOUND;
        auditData.errorMessage = AuthErrorMessage[AuthErrorCode.PRODUCT_NOT_FOUND];
        await this.createAuditLog(auditData);
        return {
          success: false,
          code: AuthErrorCode.PRODUCT_NOT_FOUND,
          message: AuthErrorMessage[AuthErrorCode.PRODUCT_NOT_FOUND],
        };
      }

      // 2. 检查产品状态
      if (productConfig.status !== ProductStatus.ACTIVE) {
        auditData.errorCode = AuthErrorCode.PRODUCT_SUSPENDED;
        auditData.errorMessage = AuthErrorMessage[AuthErrorCode.PRODUCT_SUSPENDED];
        await this.createAuditLog(auditData);
        return {
          success: false,
          code: AuthErrorCode.PRODUCT_SUSPENDED,
          message: AuthErrorMessage[AuthErrorCode.PRODUCT_SUSPENDED],
        };
      }

      // 3. 检查限流
      const rateLimitResult = await this.checkRateLimit(request.deviceId, productConfig.rateLimitPerHour);
      if (!rateLimitResult.allowed) {
        auditData.errorCode = AuthErrorCode.RATE_LIMIT_EXCEEDED;
        auditData.errorMessage = AuthErrorMessage[AuthErrorCode.RATE_LIMIT_EXCEEDED];
        await this.createAuditLog(auditData);
        return {
          success: false,
          code: AuthErrorCode.RATE_LIMIT_EXCEEDED,
          message: AuthErrorMessage[AuthErrorCode.RATE_LIMIT_EXCEEDED],
        };
      }

      // 4. 根据认证方式进行验证
      let authResult: DeviceAuthResult;

      switch (productConfig.authMethod) {
        case AuthMethod.HMAC:
          authResult = await this.authenticateByHMAC(request, productConfig);
          auditData.authMethod = 'HMAC';
          auditData.signatureVerified = authResult.success;
          break;

        case AuthMethod.X509:
          authResult = await this.authenticateByCertificate(request, productConfig);
          auditData.authMethod = 'X509';
          auditData.certificateVerified = authResult.success;
          break;

        case AuthMethod.REG_CODE:
          authResult = await this.authenticateByRegistrationCode(request, productConfig);
          auditData.authMethod = 'REG_CODE';
          auditData.signatureVerified = authResult.success;
          break;

        case AuthMethod.NONE:
          // 无需认证，直接通过
          authResult = { success: true, code: AuthErrorCode.OK, message: 'No authentication required' };
          auditData.authMethod = 'NONE';
          warnings.push('Authentication disabled for this product');
          break;

        default:
          authResult = {
            success: false,
            code: AuthErrorCode.UNKNOWN_ERROR,
            message: 'Unknown authentication method',
          };
      }

      if (!authResult.success) {
        auditData.errorCode = authResult.code;
        auditData.errorMessage = authResult.message;
        await this.createAuditLog(auditData);
        return authResult;
      }

      // 5. 检查白名单/黑名单
      const whitelistResult = await this.checkWhitelist(request.deviceId, productConfig);
      auditData.whitelistChecked = true;
      if (!whitelistResult.allowed) {
        auditData.errorCode = whitelistResult.code ?? AuthErrorCode.NOT_IN_WHITELIST;
        auditData.errorMessage = whitelistResult.message ?? 'Whitelist check failed';
        await this.createAuditLog(auditData);
        return {
          success: false,
          code: whitelistResult.code ?? AuthErrorCode.NOT_IN_WHITELIST,
          message: whitelistResult.message ?? 'Whitelist check failed',
        };
      }

      // 6. 验证设备指纹（如果启用）
      if (productConfig.requireFingerprint && request.macAddress) {
        const fingerprintResult = await this.verifyDeviceFingerprint(
          request.deviceId,
          request.macAddress,
          request.deviceFingerprint,
          productConfig.fingerprintAlgorithm
        );
        auditData.fingerprintVerified = true;
        if (!fingerprintResult.valid) {
          auditData.errorCode = AuthErrorCode.FINGERPRINT_MISMATCH;
          auditData.errorMessage = AuthErrorMessage[AuthErrorCode.FINGERPRINT_MISMATCH];
          await this.createAuditLog(auditData);
          return {
            success: false,
            code: AuthErrorCode.FINGERPRINT_MISMATCH,
            message: AuthErrorMessage[AuthErrorCode.FINGERPRINT_MISMATCH],
          };
        }
      }

      // 7. 检查用户配额
      if (request.userId) {
        const quotaResult = await this.checkUserQuota(request.userId, request.productId, productConfig);
        auditData.quotaChecked = true;
        auditData.quotaLimit = quotaResult.limit;
        auditData.quotaUsedBefore = quotaResult.used;
        if (!quotaResult.allowed) {
          auditData.errorCode = AuthErrorCode.QUOTA_EXCEEDED;
          auditData.errorMessage = AuthErrorMessage[AuthErrorCode.QUOTA_EXCEEDED];
          await this.createAuditLog(auditData);
          return {
            success: false,
            code: AuthErrorCode.QUOTA_EXCEEDED,
            message: AuthErrorMessage[AuthErrorCode.QUOTA_EXCEEDED],
          };
        }
        auditData.quotaUsedAfter = quotaResult.used + 1;
      }

      // 认证成功
      auditData.result = RegistrationResult.SUCCESS;
      auditData.deviceId = authResult.deviceId || request.deviceId;
      await this.createAuditLog(auditData);

      return {
        ...authResult,
        success: true,
        code: AuthErrorCode.OK,
        message: 'Authentication successful',
        warnings,
      };
    } catch (error) {
      this.logger.error('[DeviceAuthService] Authentication error:', error);
      auditData.errorCode = AuthErrorCode.UNKNOWN_ERROR;
      auditData.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.createAuditLog(auditData);
      return {
        success: false,
        code: AuthErrorCode.UNKNOWN_ERROR,
        message: AuthErrorMessage[AuthErrorCode.UNKNOWN_ERROR],
      };
    }
  }

  /**
   * 基于 HMAC 签名认证
   */
  private async authenticateByHMAC(
    request: DeviceAuthRequest,
    productConfig: ProductConfig
  ): Promise<DeviceAuthResult> {
    // 检查签名参数
    if (!request.signature) {
      return {
        success: false,
        code: AuthErrorCode.SIGNATURE_MISSING,
        message: AuthErrorMessage[AuthErrorCode.SIGNATURE_MISSING],
      };
    }

    // 验证时间戳
    if (productConfig.enableTimestampValidation) {
      const validTimestamp = DeviceSignatureUtils.validateTimestamp(
        request.timestamp,
        productConfig.timestampTolerance
      );
      if (!validTimestamp) {
        return {
          success: false,
          code: AuthErrorCode.TIMESTAMP_INVALID,
          message: AuthErrorMessage[AuthErrorCode.TIMESTAMP_INVALID],
        };
      }
    }

    // 验证 Nonce
    if (productConfig.enableNonceValidation) {
      const nonceValid = await this.validateNonce(request.nonce);
      if (!nonceValid) {
        return {
          success: false,
          code: AuthErrorCode.NONCE_REUSED,
          message: AuthErrorMessage[AuthErrorCode.NONCE_REUSED],
        };
      }
    }

    // 查找设备证书
    const certificate = await this.deviceCertificateRepository.findOne({
      where: {
        deviceId: request.deviceId,
        certificateType: CertificateType.HMAC,
        status: CertificateStatus.ACTIVE,
      },
    });

    if (!certificate) {
      return {
        success: false,
        code: AuthErrorCode.INVALID_CERTIFICATE,
        message: 'Device certificate not found or inactive',
      };
    }

    // 构建签名数据并验证
    const signatureData = DeviceSignatureUtils.buildSignatureData(
      request.deviceId,
      request.productId,
      request.timestamp,
      request.nonce
    );

    const signatureValid = DeviceSignatureUtils.verifySignature(
      signatureData,
      request.signature,
      certificate.deviceSecret
    );

    if (!signatureValid) {
      return {
        success: false,
        code: AuthErrorCode.INVALID_SIGNATURE,
        message: AuthErrorMessage[AuthErrorCode.INVALID_SIGNATURE],
      };
    }

    return {
      success: true,
      code: AuthErrorCode.OK,
      message: 'HMAC authentication successful',
      deviceId: certificate.deviceId,
      serialNumber: request.deviceId,
    };
  }

  /**
   * 基于 X.509 证书认证
   */
  private async authenticateByCertificate(
    request: DeviceAuthRequest,
    _productConfig: ProductConfig
  ): Promise<DeviceAuthResult> {
    if (!request.certChain || request.certChain.length === 0) {
      return {
        success: false,
        code: AuthErrorCode.INVALID_CERTIFICATE,
        message: 'Certificate chain missing',
      };
    }

    // 提取客户端证书
    const clientCert = request.certChain[0];
    const fingerprint = DeviceSignatureUtils.computeCertificateFingerprint(clientCert);

    // 查找证书记录
    const certificate = await this.deviceCertificateRepository.findOne({
      where: {
        certFingerprint: fingerprint,
        certificateType: CertificateType.X509,
      },
    });

    if (!certificate) {
      return {
        success: false,
        code: AuthErrorCode.INVALID_CERTIFICATE,
        message: 'Certificate not found in database',
      };
    }

    // 检查证书状态
    if (certificate.status === CertificateStatus.REVOKED) {
      return {
        success: false,
        code: AuthErrorCode.CERTIFICATE_REVOKED,
        message: AuthErrorMessage[AuthErrorCode.CERTIFICATE_REVOKED],
      };
    }

    if (certificate.status === CertificateStatus.EXPIRED) {
      return {
        success: false,
        code: AuthErrorCode.CERTIFICATE_EXPIRED,
        message: AuthErrorMessage[AuthErrorCode.CERTIFICATE_EXPIRED],
      };
    }

    // 检查过期时间
    if (certificate.expiresAt && certificate.expiresAt < new Date()) {
      return {
        success: false,
        code: AuthErrorCode.CERTIFICATE_EXPIRED,
        message: AuthErrorMessage[AuthErrorCode.CERTIFICATE_EXPIRED],
      };
    }

    return {
      success: true,
      code: AuthErrorCode.OK,
      message: 'Certificate authentication successful',
      deviceId: certificate.deviceId,
      serialNumber: request.deviceId,
    };
  }

  /**
   * 基于注册码认证
   */
  private async authenticateByRegistrationCode(
    request: DeviceAuthRequest,
    _productConfig: ProductConfig
  ): Promise<DeviceAuthResult> {
    if (!request.registrationCode) {
      return {
        success: false,
        code: AuthErrorCode.SIGNATURE_MISSING,
        message: 'Registration code missing',
      };
    }

    // 验证注册码格式
    const formatValid = DeviceSignatureUtils.validateRegistrationCodeFormat(request.registrationCode);
    if (!formatValid) {
      return {
        success: false,
        code: AuthErrorCode.INVALID_SIGNATURE,
        message: 'Invalid registration code format',
      };
    }

    // 查找注册码
    const certificate = await this.deviceCertificateRepository.findOne({
      where: {
        registrationCode: request.registrationCode,
        certificateType: CertificateType.REG_CODE,
      },
    });

    if (!certificate) {
      return {
        success: false,
        code: AuthErrorCode.INVALID_CERTIFICATE,
        message: 'Registration code not found',
      };
    }

    // 检查是否已使用
    if (certificate.codeUsed) {
      return {
        success: false,
        code: AuthErrorCode.CERTIFICATE_REVOKED,
        message: 'Registration code already used',
      };
    }

    // 检查过期时间
    if (certificate.codeExpiresAt && certificate.codeExpiresAt < new Date()) {
      return {
        success: false,
        code: AuthErrorCode.CERTIFICATE_EXPIRED,
        message: 'Registration code expired',
      };
    }

    return {
      success: true,
      code: AuthErrorCode.OK,
      message: 'Registration code valid',
      deviceId: certificate.deviceId,
      serialNumber: request.deviceId,
    };
  }

  /**
   * 获取产品配置
   */
  private async getProductConfig(productId: string): Promise<ProductConfig | null> {
    const cached = await this.redis.get(`product:config:${productId}`);
    if (cached) {
      return JSON.parse(cached);
    }

    const config = await this.productConfigRepository.findOne({
      where: { productId },
    });

    if (config) {
      // 缓存 1 小时
      await this.redis.set(`product:config:${productId}`, JSON.stringify(config), 'EX', 3600);
    }

    return config;
  }

  /**
   * 检查限流
   */
  private async checkRateLimit(deviceId: string, limitPerHour: number): Promise<{ allowed: boolean }> {
    const key = `device:rate:${deviceId}`;
    const current = await this.redis.incr(key);

    if (current === 1) {
      await this.redis.expire(key, 3600); // 1 小时过期
    }

    return {
      allowed: current <= limitPerHour,
    };
  }

  /**
   * 验证 Nonce 唯一性
   */
  private async validateNonce(nonce: string): Promise<boolean> {
    const key = `device:nonce:${nonce}`;
    const exists = await this.redis.exists(key);

    if (exists) {
      return false;
    }

    // 缓存 10 分钟
    await this.redis.set(key, '1', 'EX', 600);
    return true;
  }

  /**
   * 检查白名单/黑名单
   */
  private async checkWhitelist(
    deviceId: string,
    productConfig: ProductConfig
  ): Promise<{ allowed: boolean; code?: AuthErrorCode; message?: string }> {
    // 如果没有配置白名单，默认允许
    if (!productConfig.whitelistConfig || !productConfig.whitelistConfig.enabled) {
      return { allowed: true };
    }

    const whitelist = await this.deviceWhitelistRepository.findOne({
      where: {
        deviceIdentifier: deviceId,
        productId: productConfig.productId,
      },
    });

    if (!whitelist) {
      // 白名单模式：不在白名单 = 拒绝
      if (productConfig.whitelistConfig.mode === 'whitelist') {
        return {
          allowed: false,
          code: AuthErrorCode.NOT_IN_WHITELIST,
          message: AuthErrorMessage[AuthErrorCode.NOT_IN_WHITELIST],
        };
      }
      // 黑名单模式：不在黑名单 = 允许
      return { allowed: true };
    }

    // 检查白名单条目状态
    if (whitelist.status === WhitelistStatus.BLACKLISTED) {
      return {
        allowed: false,
        code: AuthErrorCode.IN_BLACKLIST,
        message: AuthErrorMessage[AuthErrorCode.IN_BLACKLIST],
      };
    }

    if (whitelist.status === WhitelistStatus.INACTIVE) {
      return {
        allowed: false,
        code: AuthErrorCode.NOT_IN_WHITELIST,
        message: 'Whitelist entry inactive',
      };
    }

    // 检查有效期
    const now = new Date();
    if (whitelist.validFrom && now < whitelist.validFrom) {
      return {
        allowed: false,
        code: AuthErrorCode.NOT_IN_WHITELIST,
        message: 'Whitelist entry not yet valid',
      };
    }

    if (whitelist.validUntil && now > whitelist.validUntil) {
      return {
        allowed: false,
        code: AuthErrorCode.NOT_IN_WHITELIST,
        message: 'Whitelist entry expired',
      };
    }

    // 检查注册次数限制
    if (whitelist.maxRegistrations > 0 && whitelist.registrationCount >= whitelist.maxRegistrations) {
      return {
        allowed: false,
        code: AuthErrorCode.QUOTA_EXCEEDED,
        message: 'Device registration limit exceeded',
      };
    }

    return { allowed: true };
  }

  /**
   * 验证设备指纹
   */
  private async verifyDeviceFingerprint(
    deviceId: string,
    macAddress: string,
    expectedFingerprint?: string,
    algorithm: 'SHA256' | 'SHA512' = 'SHA256'
  ): Promise<{ valid: boolean }> {
    if (!expectedFingerprint) {
      // 如果没有期望的指纹，这是首次注册，需要保存
      return { valid: true };
    }

    const actualFingerprint = DeviceSignatureUtils.computeDeviceFingerprint(
      deviceId,
      macAddress,
      algorithm
    );

    return {
      valid: actualFingerprint === expectedFingerprint,
    };
  }

  /**
   * 检查用户配额
   */
  private async checkUserQuota(
    userId: string,
    productId: string,
    productConfig: ProductConfig
  ): Promise<{ allowed: boolean; limit: number; used: number }> {
    const quota = await this.userDeviceQuotaRepository.findOne({
      where: { userId, productId },
    });

    const limit = productConfig.maxDevicesPerUser;
    const used = quota?.quotaUsed || 0;

    if (used >= limit) {
      return { allowed: false, limit, used };
    }

    return { allowed: true, limit, used };
  }

  /**
   * 创建审计日志
   */
  private async createAuditLog(data: Partial<DeviceRegistrationAudit>): Promise<void> {
    try {
      const audit = this.auditRepository.create(data as any);
      await this.auditRepository.save(audit);
    } catch (error) {
      this.logger.error('[DeviceAuthService] Failed to create audit log:', error);
    }
  }

  /**
   * 消费设备注册（更新配额和白名单计数）
   */
  async consumeDeviceRegistration(
    deviceId: string,
    productId: string,
    userId?: string
  ): Promise<void> {
    // 更新白名单计数
    await this.deviceWhitelistRepository
      .createQueryBuilder()
      .update()
      .set({ registrationCount: () => 'registrationCount + 1' })
      .where('deviceIdentifier = :deviceId', { deviceId })
      .andWhere('productId = :productId', { productId })
      .execute();

    // 更新用户配额
    if (userId) {
      const quota = await this.userDeviceQuotaRepository.findOne({
        where: { userId, productId },
      });

      if (quota) {
        await this.userDeviceQuotaRepository.update(
          { id: quota.id },
          {
            quotaUsed: quota.quotaUsed + 1,
            totalRegistrations: quota.totalRegistrations + 1,
            lastRegisteredAt: new Date(),
          }
        );
      } else {
        // 创建新的配额记录
        const newQuota = this.userDeviceQuotaRepository.create({
          userId,
          productId,
          quotaLimit: 10, // 默认值，应该从产品配置获取
          quotaUsed: 1,
          totalRegistrations: 1,
          lastRegisteredAt: new Date(),
        });
        await this.userDeviceQuotaRepository.save(newQuota);
      }
    }
  }
}
