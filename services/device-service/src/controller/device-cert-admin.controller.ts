import { Controller, Get, Post, Put, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { DeviceCertificateService, BatchGenerateRequest, CertificateGenerateResult } from '../service/device-certificate.service';
import { DeviceAuthService } from '../service/device-auth.service';
import { DeviceCertificate, CertificateType, CertificateStatus } from '../entity/device-certificate.entity';
import { ProductConfig, AuthMethod, ProductStatus } from '../entity/product-config.entity';
import { DeviceWhitelist, DeviceIdentifierType, WhitelistStatus } from '../entity/device-whitelist.entity';
import { UserDeviceQuota, QuotaStatus } from '../entity/user-device-quota.entity';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, Like, LessThan } from 'typeorm';
import { SqlSafeUtil } from '@baby-monitor/shared-utils';

/**
 * 批量生成证书请求 DTO
 */
export class BatchGenerateDTO implements BatchGenerateRequest {
  productId!: string;
  count!: number;
  certificateType!: CertificateType;
  keyVersion?: number;
  expiresIn?: number;
}

/**
 * 吊销证书请求 DTO
 */
export class RevokeCertificateDTO {
  reason!: string;
}

/**
 * 创建产品配置请求 DTO
 */
export class CreateProductConfigDTO {
  productId!: string;
  productName!: string;
  productType!: string;
  authMethod!: AuthMethod;
  maxDevicesPerUser?: number;
  maxTotalDevices?: number;
  requireFingerprint?: boolean;
  whitelistEnabled?: boolean;
  whitelistMode?: 'whitelist' | 'blacklist';
}

/**
 * 更新产品配置请求 DTO
 */
export class UpdateProductConfigDTO {
  productName?: string;
  authMethod?: AuthMethod;
  maxDevicesPerUser?: number;
  maxTotalDevices?: number;
  requireFingerprint?: boolean;
  whitelistEnabled?: boolean;
  whitelistMode?: 'whitelist' | 'blacklist';
  status?: ProductStatus;
}

/**
 * 添加白名单请求 DTO
 */
export class AddWhitelistDTO {
  productId!: string;
  deviceIdentifier!: string;
  identifierType!: DeviceIdentifierType;
  maxRegistrations?: number;
  validUntil?: Date;
  notes?: string;
}

/**
 * 设置用户配额请求 DTO
 */
export class SetUserQuotaDTO {
  quotaLimit!: number;
}

/**
 * 设备证书管理 API（管理端）
 *
 * 提供设备证书、产品配置、白名单和配额的管理功能
 */
@Controller('/api/admin/devices/certificates')
export class DeviceCertAdminController {
  @Inject()
  ctx!: Context;

  @Inject()
  deviceCertificateService!: DeviceCertificateService;

  @Inject()
  deviceAuthService!: DeviceAuthService;

  @InjectEntityModel(DeviceCertificate)
  deviceCertificateRepository!: Repository<DeviceCertificate>;

  @InjectEntityModel(ProductConfig)
  productConfigRepository!: Repository<ProductConfig>;

  @InjectEntityModel(DeviceWhitelist)
  deviceWhitelistRepository!: Repository<DeviceWhitelist>;

  @InjectEntityModel(UserDeviceQuota)
  userDeviceQuotaRepository!: Repository<UserDeviceQuota>;

  // ==================== 证书管理 ====================

  /**
   * 批量生成设备证书
   */
  @Post('/generate')
  async generateCertificates(@Body() dto: BatchGenerateDTO) {
    // 验证产品存在
    const product = await this.productConfigRepository.findOne({
      where: { productId: dto.productId },
    });

    if (!product) {
      return { code: -1, message: 'Product not found' };
    }

    // 生成证书
    const certificates = await this.deviceCertificateService.batchGenerateCertificates(dto);

    return {
      code: 0,
      message: 'Certificates generated successfully',
      data: {
        count: certificates.length,
        certificates,
      },
    };
  }

  /**
   * 查询设备证书
   */
  @Get('/')
  async getCertificates(
    @Query('deviceId') deviceId?: string,
    @Query('productId') productId?: string,
    @Query('certificateType') certificateType?: CertificateType,
    @Query('status') status?: CertificateStatus,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20
  ) {
    const where: any = {};

    if (deviceId) {
      where.deviceId = deviceId;
    }

    if (productId) {
      where.deviceId = Like(SqlSafeUtil.likePrefix(productId));
    }

    if (certificateType) {
      where.certificateType = certificateType;
    }

    if (status) {
      where.status = status;
    }

    const [certificates, total] = await this.deviceCertificateRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // 移除敏感信息
    const sanitized = certificates.map(cert => {
      const { deviceSecret, privateKeyEncrypted, ...rest } = cert;
      return rest;
    });

    return {
      code: 0,
      data: {
        list: sanitized,
        total,
        page,
        pageSize,
      },
    };
  }

  /**
   * 获取证书详情
   */
  @Get('/:certificateId')
  async getCertificate(@Param('certificateId') certificateId: string) {
    const certificate = await this.deviceCertificateRepository.findOne({
      where: { id: certificateId },
    });

    if (!certificate) {
      return { code: -1, message: 'Certificate not found' };
    }

    // 移除敏感信息
    const { deviceSecret, privateKeyEncrypted, ...rest } = certificate;

    return {
      code: 0,
      data: rest,
    };
  }

  /**
   * 吊销证书
   */
  @Post('/:certificateId/revoke')
  async revokeCertificate(
    @Param('certificateId') certificateId: string,
    @Body() dto: RevokeCertificateDTO
  ) {
    await this.deviceCertificateService.revokeCertificate(certificateId, dto.reason);

    return {
      code: 0,
      message: 'Certificate revoked successfully',
    };
  }

  /**
   * 批量吊销证书
   */
  @Post('/batch-revoke')
  async batchRevokeCertificates(
    @Body('certificateIds') certificateIds: string[],
    @Body('reason') reason: string
  ) {
    if (!certificateIds || certificateIds.length === 0) {
      return { code: -1, message: 'Certificate IDs required' };
    }

    await this.deviceCertificateService.batchRevokeCertificates(certificateIds, reason);

    return {
      code: 0,
      message: `Revoked ${certificateIds.length} certificates`,
    };
  }

  /**
   * 按设备ID吊销证书
   */
  @Post('/device/:deviceId/revoke')
  async revokeDeviceCertificates(
    @Param('deviceId') deviceId: string,
    @Body() dto: RevokeCertificateDTO
  ) {
    await this.deviceCertificateService.revokeDeviceCertificates(deviceId, dto.reason);

    return {
      code: 0,
      message: `All certificates for device ${deviceId} revoked`,
    };
  }

  /**
   * 获取证书统计
   */
  @Get('/stats/overview')
  async getCertificateStats(@Query('productId') productId?: string) {
    const stats = await this.deviceCertificateService.getCertificateStats(productId);

    return {
      code: 0,
      data: stats,
    };
  }

  // ==================== 产品配置管理 ====================

  /**
   * 创建产品配置
   */
  @Post('/products')
  async createProductConfig(@Body() dto: CreateProductConfigDTO) {
    // 检查是否已存在
    const existing = await this.productConfigRepository.findOne({
      where: { productId: dto.productId },
    });

    if (existing) {
      return { code: -1, message: 'Product already exists' };
    }

    // 生成产品密钥
    const productSecret = this.generateProductSecret();

    const config = this.productConfigRepository.create({
      productId: dto.productId,
      productName: dto.productName,
      productType: dto.productType as any,
      authMethod: dto.authMethod,
      productSecret,
      maxDevicesPerUser: dto.maxDevicesPerUser || 10,
      maxTotalDevices: dto.maxTotalDevices,
      requireFingerprint: dto.requireFingerprint || false,
      whitelistConfig: {
        enabled: dto.whitelistEnabled || false,
        mode: dto.whitelistMode || 'whitelist',
      },
      status: ProductStatus.ACTIVE,
    });

    await this.productConfigRepository.save(config);

    return {
      code: 0,
      message: 'Product config created',
      data: {
        productId: config.productId,
        productSecret, // 只在创建时返回
      },
    };
  }

  /**
   * 获取产品配置列表
   */
  @Get('/products')
  async getProductConfigs(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20
  ) {
    const [configs, total] = await this.productConfigRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // 移除敏感信息
    const sanitized = configs.map(config => {
      const { productSecret, ...rest } = config;
      return rest;
    });

    return {
      code: 0,
      data: {
        list: sanitized,
        total,
        page,
        pageSize,
      },
    };
  }

  /**
   * 获取产品配置详情
   */
  @Get('/products/:productId')
  async getProductConfig(@Param('productId') productId: string) {
    const config = await this.productConfigRepository.findOne({
      where: { productId },
    });

    if (!config) {
      return { code: -1, message: 'Product not found' };
    }

    // 移除敏感信息
    const { productSecret, ...rest } = config;

    return {
      code: 0,
      data: rest,
    };
  }

  /**
   * 更新产品配置
   */
  @Put('/products/:productId')
  async updateProductConfig(
    @Param('productId') productId: string,
    @Body() dto: UpdateProductConfigDTO
  ) {
    const config = await this.productConfigRepository.findOne({
      where: { productId },
    });

    if (!config) {
      return { code: -1, message: 'Product not found' };
    }

    // 更新配置
    if (dto.productName !== undefined) {
      config.productName = dto.productName;
    }

    if (dto.authMethod !== undefined) {
      config.authMethod = dto.authMethod;
    }

    if (dto.maxDevicesPerUser !== undefined) {
      config.maxDevicesPerUser = dto.maxDevicesPerUser;
    }

    if (dto.maxTotalDevices !== undefined) {
      config.maxTotalDevices = dto.maxTotalDevices;
    }

    if (dto.requireFingerprint !== undefined) {
      config.requireFingerprint = dto.requireFingerprint;
    }

    if (dto.whitelistEnabled !== undefined || dto.whitelistMode !== undefined) {
      config.whitelistConfig = {
        ...config.whitelistConfig,
        enabled: dto.whitelistEnabled ?? config.whitelistConfig?.enabled,
        mode: dto.whitelistMode ?? config.whitelistConfig?.mode ?? 'whitelist',
      };
    }

    if (dto.status !== undefined) {
      config.status = dto.status;
    }

    await this.productConfigRepository.save(config);

    return {
      code: 0,
      message: 'Product config updated',
    };
  }

  /**
   * 删除产品配置
   */
  @Post('/products/:productId/delete')
  async deleteProductConfig(@Param('productId') productId: string) {
    const result = await this.productConfigRepository.delete({
      productId,
    });

    if (result.affected === 0) {
      return { code: -1, message: 'Product not found' };
    }

    return {
      code: 0,
      message: 'Product config deleted',
    };
  }

  // ==================== 白名单管理 ====================

  /**
   * 添加白名单
   */
  @Post('/whitelist')
  async addToWhitelist(@Body() dto: AddWhitelistDTO) {
    const entry = this.deviceWhitelistRepository.create({
      productId: dto.productId,
      deviceIdentifier: dto.deviceIdentifier,
      identifierType: dto.identifierType,
      maxRegistrations: dto.maxRegistrations || 1,
      validUntil: dto.validUntil,
      notes: dto.notes,
      status: WhitelistStatus.ACTIVE,
    });

    await this.deviceWhitelistRepository.save(entry);

    return {
      code: 0,
      message: 'Added to whitelist',
      data: entry,
    };
  }

  /**
   * 获取白名单
   */
  @Get('/whitelist')
  async getWhitelist(
    @Query('productId') productId?: string,
    @Query('status') status?: WhitelistStatus,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20
  ) {
    const where: any = {};

    if (productId) {
      where.productId = productId;
    }

    if (status) {
      where.status = status;
    }

    const [entries, total] = await this.deviceWhitelistRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      code: 0,
      data: {
        list: entries,
        total,
        page,
        pageSize,
      },
    };
  }

  /**
   * 删除白名单条目
   */
  @Post('/whitelist/:entryId/delete')
  async removeFromWhitelist(@Param('entryId') entryId: string) {
    const result = await this.deviceWhitelistRepository.delete({
      id: entryId,
    });

    if (result.affected === 0) {
      return { code: -1, message: 'Whitelist entry not found' };
    }

    return {
      code: 0,
      message: 'Removed from whitelist',
    };
  }

  /**
   * 批量导入白名单
   */
  @Post('/whitelist/batch')
  async batchImportWhitelist(
    @Body('productId') productId: string,
    @Body('identifiers') identifiers: string[],
    @Body('identifierType') identifierType: DeviceIdentifierType,
    @Body('maxRegistrations') maxRegistrations: number = 1
  ) {
    const entries = identifiers.map(deviceIdentifier =>
      this.deviceWhitelistRepository.create({
        productId,
        deviceIdentifier,
        identifierType,
        maxRegistrations,
        status: WhitelistStatus.ACTIVE,
      })
    );

    await this.deviceWhitelistRepository.save(entries);

    return {
      code: 0,
      message: `Imported ${entries.length} whitelist entries`,
      data: {
        count: entries.length,
      },
    };
  }

  // ==================== 用户配额管理 ====================

  /**
   * 设置用户配额
   */
  @Post('/users/:userId/quotas')
  async setUserQuota(
    @Param('userId') userId: string,
    @Body() dto: SetUserQuotaDTO,
    @Query('productId') productId: string
  ) {
    // 检查产品存在
    const product = await this.productConfigRepository.findOne({
      where: { productId },
    });

    if (!product) {
      return { code: -1, message: 'Product not found' };
    }

    // 查找现有配额
    let quota = await this.userDeviceQuotaRepository.findOne({
      where: { userId, productId },
    });

    if (quota) {
      // 更新
      quota.quotaLimit = dto.quotaLimit;
      if (quota.quotaUsed > quota.quotaLimit) {
        quota.status = QuotaStatus.OVER_LIMIT;
      } else {
        quota.status = QuotaStatus.ACTIVE;
      }
      await this.userDeviceQuotaRepository.save(quota);
    } else {
      // 创建
      quota = this.userDeviceQuotaRepository.create({
        userId,
        productId,
        quotaLimit: dto.quotaLimit,
        quotaUsed: 0,
        totalRegistrations: 0,
        status: QuotaStatus.ACTIVE,
      });
      await this.userDeviceQuotaRepository.save(quota);
    }

    return {
      code: 0,
      message: 'User quota set',
      data: quota,
    };
  }

  /**
   * 获取用户配额
   */
  @Get('/users/:userId/quotas')
  async getUserQuotas(@Param('userId') userId: string) {
    const quotas = await this.userDeviceQuotaRepository.find({
      where: { userId },
    });

    return {
      code: 0,
      data: quotas,
    };
  }

  /**
   * 获取用户配额详情
   */
  @Get('/users/:userId/quotas/:productId')
  async getUserQuota(
    @Param('userId') userId: string,
    @Param('productId') productId: string
  ) {
    const quota = await this.userDeviceQuotaRepository.findOne({
      where: { userId, productId },
    });

    if (!quota) {
      return { code: -1, message: 'Quota not found' };
    }

    return {
      code: 0,
      data: quota,
    };
  }

  // ==================== 审计日志 ====================

  /**
   * 获取注册审计日志
   */
  @Get('/audit/registrations')
  async getRegistrationAudit(
    @Query('deviceId') deviceId?: string,
    @Query('result') result?: 'SUCCESS' | 'FAILURE',
    @Query('startDate') startDate?: Date,
    @Query('endDate') endDate?: Date,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 50
  ) {
    // TODO: 实现审计日志查询
    return {
      code: 0,
      data: {
        list: [],
        total: 0,
        page,
        pageSize,
      },
    };
  }

  // ==================== 辅助方法 ====================

  /**
   * 生成产品密钥
   */
  private generateProductSecret(): string {
    const crypto = require('crypto');
    return crypto.randomBytes(64).toString('hex');
  }
}
