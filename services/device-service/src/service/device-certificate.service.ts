import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, In } from 'typeorm';
import * as cron from 'node-cron';
import {
  DeviceSignatureUtils,
  SqlSafeUtil,
} from '@baby-monitor/shared-utils';
import {
  DeviceCertificate,
  CertificateType,
  CertificateStatus,
} from '../entity/device-certificate.entity';
import { ProductConfig } from '../entity/product-config.entity';
import { CACertificateService, KeyUsage, ExtendedKeyUsage } from './ca-certificate.service';

/**
 * 批量生成证书请求
 */
export interface BatchGenerateRequest {
  productId: string;
  count: number;
  certificateType: CertificateType;
  keyVersion?: number;
  expiresIn?: number; // 证书有效期（天）
}

/**
 * 证书生成结果
 */
export interface CertificateGenerateResult {
  deviceId: string;
  secret?: string;
  certificate?: string;
  privateKey?: string;
  registrationCode?: string;
}

/**
 * 设备证书管理服务
 *
 * 负责设备证书的生成、管理和吊销
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class DeviceCertificateService {
  @Inject()
  logger!: ILogger;

  @InjectEntityModel(DeviceCertificate)
  deviceCertificateRepository!: Repository<DeviceCertificate>;

  @InjectEntityModel(ProductConfig)
  productConfigRepository!: Repository<ProductConfig>;

  @Inject()
  caCertificateService!: CACertificateService;

  /**
   * 批量生成设备证书
   *
   * @param request - 生成请求
   * @returns 生成的证书列表
   */
  async batchGenerateCertificates(
    request: BatchGenerateRequest
  ): Promise<CertificateGenerateResult[]> {
    const results: CertificateGenerateResult[] = [];
    const now = new Date();

    for (let i = 0; i < request.count; i++) {
      const deviceId = this.generateDeviceId(request.productId, i);

      let certificate: Partial<DeviceCertificate>;

      switch (request.certificateType) {
        case CertificateType.HMAC:
          certificate = await this.generateHMACCertificate(
            deviceId,
            request.productId,
            request.keyVersion || 1
          );
          results.push({
            deviceId,
            secret: certificate.deviceSecret,
          });
          break;

        case CertificateType.X509:
          certificate = await this.generateX509Certificate(
            deviceId,
            request.productId,
            request.expiresIn
          );
          results.push({
            deviceId,
            certificate: certificate.certificatePem,
            privateKey: certificate.privateKeyEncrypted,
          });
          break;

        case CertificateType.REG_CODE:
          certificate = await this.generateRegistrationCode(
            deviceId,
            request.productId,
            request.expiresIn
          );
          results.push({
            deviceId,
            registrationCode: certificate.registrationCode,
          });
          break;
      }

      // 保存到数据库
      await this.deviceCertificateRepository.save(certificate);
    }

    this.logger.info(
      `[DeviceCertificateService] Generated ${request.count} ${request.certificateType} certificates for product ${request.productId}`
    );

    return results;
  }

  /**
   * 生成单个 HMAC 证书
   */
  private async generateHMACCertificate(
    deviceId: string,
    productId: string,
    keyVersion: number
  ): Promise<Partial<DeviceCertificate>> {
    const deviceSecret = DeviceSignatureUtils.generateDeviceSecret();

    return {
      id: this.generateUUID(),
      deviceId,
      certificateType: CertificateType.HMAC,
      deviceSecret,
      keyVersion,
      status: CertificateStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * 生成 X.509 证书
   *
   * 使用 CA 服务签发真实的 X.509 证书
   */
  private async generateX509Certificate(
    deviceId: string,
    productId: string,
    expiresIn: number = 365
  ): Promise<Partial<DeviceCertificate>> {
    // 获取产品配置
    const productConfig = await this.productConfigRepository.findOne({
      where: { productId: productId as any }
    });

    // 使用 CA 服务签发证书
    const issuedCert = await this.caCertificateService.signDeviceCertificate({
      deviceId,
      productId,
      domainId: productConfig?.domainId,
      subject: {
        country: productConfig?.certificateCountry || 'CN',
        state: productConfig?.certificateState || 'Beijing',
        locality: productConfig?.certificateLocality || 'Beijing',
        organization: productConfig?.certificateOrganization || 'BabyMonitor',
        organizationalUnit: productConfig?.certificateUnit || 'IoT Devices',
        commonName: deviceId,
        emailAddress: productConfig?.certificateEmail || `noreply@babymonitor.com`,
      },
      keyUsage: [
        KeyUsage.DIGITAL_SIGNATURE,
        KeyUsage.KEY_ENCIPHERMENT,
      ],
      extendedKeyUsage: [
        ExtendedKeyUsage.CLIENT_AUTH,
        ExtendedKeyUsage.SERVER_AUTH,
      ],
      validityDays: expiresIn,
    });

    // 加密私钥（使用设备ID作为密码）
    const privateKeyEncrypted = DeviceSignatureUtils.encryptAES(
      issuedCert.privateKeyPem,
      deviceId.substring(0, 32).padEnd(64, '0')
    );

    const now = new Date();
    const expiresAt = issuedCert.validTo;

    return {
      id: this.generateUUID(),
      deviceId,
      certificateType: CertificateType.X509,
      certificatePem: issuedCert.certificatePem,
      privateKeyEncrypted,
      certFingerprint: issuedCert.fingerprint,
      certSerialNumber: issuedCert.serialNumber,
      issuedAt: issuedCert.validFrom,
      expiresAt,
      status: CertificateStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 生成注册码
   */
  private async generateRegistrationCode(
    deviceId: string,
    productId: string,
    expiresIn: number = 30
  ): Promise<Partial<DeviceCertificate>> {
    const registrationCode = DeviceSignatureUtils.generateRegistrationCode();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresIn * 24 * 60 * 60 * 1000);

    return {
      id: this.generateUUID(),
      deviceId,
      certificateType: CertificateType.REG_CODE,
      registrationCode,
      codeScopes: {
        productId,
        allowedUsers: [],
      },
      codeExpiresAt: expiresAt,
      codeUsed: false,
      status: CertificateStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * 吊销证书
   *
   * @param certificateId - 证书ID
   * @param reason - 吊销原因
   */
  async revokeCertificate(certificateId: string, reason: string): Promise<void> {
    await this.deviceCertificateRepository.update(
      { id: certificateId },
      {
        status: CertificateStatus.REVOKED,
        revocationReason: reason,
        revokedAt: new Date(),
      }
    );

    this.logger.info(
      `[DeviceCertificateService] Certificate ${certificateId} revoked: ${reason}`
    );
  }

  /**
   * 批量吊销证书
   *
   * @param certificateIds - 证书ID列表
   * @param reason - 吊销原因
   */
  async batchRevokeCertificates(
    certificateIds: string[],
    reason: string
  ): Promise<void> {
    await this.deviceCertificateRepository.update(
      { id: In(certificateIds) },
      {
        status: CertificateStatus.REVOKED,
        revocationReason: reason,
        revokedAt: new Date(),
      }
    );

    this.logger.info(
      `[DeviceCertificateService] Batch revoked ${certificateIds.length} certificates: ${reason}`
    );
  }

  /**
   * 按设备ID吊销证书
   *
   * @param deviceId - 设备ID
   * @param reason - 吊销原因
   */
  async revokeDeviceCertificates(deviceId: string, reason: string): Promise<void> {
    await this.deviceCertificateRepository.update(
      { deviceId },
      {
        status: CertificateStatus.REVOKED,
        revocationReason: reason,
        revokedAt: new Date(),
      }
    );

    this.logger.info(
      `[DeviceCertificateService] All certificates for device ${deviceId} revoked: ${reason}`
    );
  }

  /**
   * 获取设备的有效证书
   *
   * @param deviceId - 设备ID
   * @param certificateType - 证书类型（可选）
   * @returns 证书列表
   */
  async getDeviceCertificates(
    deviceId: string,
    certificateType?: CertificateType
  ): Promise<DeviceCertificate[]> {
    const where: any = {
      deviceId,
      status: CertificateStatus.ACTIVE,
    };

    if (certificateType) {
      where.certificateType = certificateType;
    }

    return await this.deviceCertificateRepository.find({ where });
  }

  /**
   * 标记过期证书
   *
   * 定时任务：检查并标记过期的证书
   */
  private cronTask!: cron.ScheduledTask;

  /**
   * 启动定时任务
   */
  async startScheduledTasks(): Promise<void> {
    // 每小时执行一次
    this.cronTask = cron.schedule('0 * * * *', async () => {
      await this.markExpiredCertificates();
    });
    this.logger.info('[DeviceCertificateService] Scheduled tasks started');
  }

  /**
   * 停止定时任务
   */
  stopScheduledTasks(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.logger.info('[DeviceCertificateService] Scheduled tasks stopped');
    }
  }

  async markExpiredCertificates(): Promise<void> {
    const { LessThan } = await import('typeorm');
    const now = new Date();

    // 标记过期的 X.509 证书
    const x509Result = await this.deviceCertificateRepository.update(
      {
        certificateType: CertificateType.X509,
        status: CertificateStatus.ACTIVE,
        expiresAt: LessThan(now) as any,
      },
      { status: CertificateStatus.EXPIRED }
    );

    // 标记过期的注册码
    const regCodeResult = await this.deviceCertificateRepository.update(
      {
        certificateType: CertificateType.REG_CODE,
        status: CertificateStatus.ACTIVE,
        codeExpiresAt: LessThan(now) as any,
      },
      { status: CertificateStatus.EXPIRED }
    );

    this.logger.debug(
      `[DeviceCertificateService] Marked expired certificates: ${x509Result.affected || 0} X.509, ${regCodeResult.affected || 0} registration codes`
    );
  }

  /**
   * 导出证书（用于备份）
   *
   * @param productId - 产品ID
   * @returns 证书列表（不包含敏感信息）
   */
  async exportCertificates(productId: string): Promise<Partial<DeviceCertificate>[]> {
    const { Like } = await import('typeorm');
    const certificates = await this.deviceCertificateRepository.find({
      where: { deviceId: Like(SqlSafeUtil.likePrefix(productId)) },
    });

    // 移除敏感信息
    return certificates.map(cert => {
      const { deviceSecret, privateKeyEncrypted, ...rest } = cert;
      return rest;
    });
  }

  /**
   * 获取证书统计信息
   *
   * @param productId - 产品ID（可选）
   * @returns 统计信息
   */
  async getCertificateStats(productId?: string): Promise<{
    total: number;
    byType: Record<CertificateType, number>;
    byStatus: Record<CertificateStatus, number>;
  }> {
    const where: any = {};
    if (productId) {
      const { Like } = await import('typeorm');
      where.deviceId = Like(SqlSafeUtil.likePrefix(productId));
    }

    const certificates = await this.deviceCertificateRepository.find({ where });

    const byType: Record<CertificateType, number> = {
      [CertificateType.HMAC]: 0,
      [CertificateType.X509]: 0,
      [CertificateType.REG_CODE]: 0,
    };

    const byStatus: Record<CertificateStatus, number> = {
      [CertificateStatus.ACTIVE]: 0,
      [CertificateStatus.REVOKED]: 0,
      [CertificateStatus.EXPIRED]: 0,
      [CertificateStatus.PENDING]: 0,
    };

    for (const cert of certificates) {
      byType[cert.certificateType]++;
      byStatus[cert.status]++;
    }

    return {
      total: certificates.length,
      byType,
      byStatus,
    };
  }

  /**
   * 生成设备ID
   */
  private generateDeviceId(productId: string, index: number): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `${productId}-${timestamp}-${random}-${index}`;
  }

  /**
   * 生成 UUID
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
