import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { createVerify, createSign, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * 签名算法类型
 */
export enum SignatureAlgorithm {
  /** RSA with SHA256 */
  RSA_SHA256 = 'RSA-SHA256',
  /** RSA with SHA512 */
  RSA_SHA512 = 'RSA-SHA512',
  /** ECDSA with SHA256 */
  ECDSA_SHA256 = 'ECDSA-SHA256',
  /** Ed25519 */
  ED25519 = 'ED25519',
}

/**
 * 固件签名验证结果
 */
export interface SignatureVerificationResult {
  /** 是否验证通过 */
  valid: boolean;
  /** 验证详情 */
  details: {
    /** 签名算法 */
    algorithm: SignatureAlgorithm;
    /** 签名者 */
    signer?: string;
    /** 签名时间 */
    signedAt?: Date;
    /** 证书有效期 */
    certValidFrom?: Date;
    certValidTo?: Date;
    /** 固件哈希 */
    firmwareHash: string;
    /** 期望的哈希 */
    expectedHash?: string;
    /** 验证错误信息 */
    error?: string;
  };
}

/**
 * 固件元数据
 */
export interface FirmwareMetadata {
  /** 固件版本 */
  version: string;
  /** 固件类型 */
  type: string;
  /** 设备型号 */
  deviceModel: string;
  /** 最小硬件版本 */
  minHardwareVersion?: string;
  /** 最大硬件版本 */
  maxHardwareVersion?: string;
  /** 发布时间 */
  releasedAt: Date;
  /** 构建时间 */
  buildTime?: Date;
  /** Git commit */
  gitCommit?: string;
  /** 变更日志 */
  changelog?: string;
  /** 文件大小 */
  fileSize: number;
  /** 文件哈希（SHA256） */
  fileHash: string;
}

/**
 * 签名证书信息
 */
export interface SignatureCertificate {
  /** 证书ID */
  id: string;
  /** 签名者名称 */
  signerName: string;
  /** 公钥 */
  publicKey: string;
  /** 签名算法 */
  algorithm: SignatureAlgorithm;
  /** 有效期开始 */
  validFrom: Date;
  /** 有效期结束 */
  validTo: Date;
  /** 是否为CA证书 */
  isCA: boolean;
  /** 状态 */
  status: 'active' | 'revoked' | 'expired';
}

/**
 * 固件包信息
 */
export interface FirmwarePackage {
  /** 固件数据 */
  data: Buffer;
  /** 签名数据 */
  signature: Buffer;
  /** 元数据 */
  metadata: FirmwareMetadata;
  /** 证书链 */
  certificateChain?: string[];
}

/**
 * 固件签名验证服务
 * 验证固件包的数字签名，确保固件完整性和来源可信
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class FirmwareSignatureService {
  @Inject()
  redis!: RedisService;

  @Inject()
  logger!: ILogger;

  private readonly CERT_PREFIX = 'firmware:cert:';
  private readonly REVOKED_PREFIX = 'firmware:revoked:';
  private readonly TRUSTED_STORE_KEY = 'firmware:trusted';
  private readonly DEFAULT_TTL = 86400; // 24小时

  // 内存缓存的证书
  private certificateCache: Map<string, SignatureCertificate> = new Map();

  /**
   * 验证固件签名
   *
   * @param firmware 固件包
   * @returns 验证结果
   */
  async verifyFirmware(firmware: FirmwarePackage): Promise<SignatureVerificationResult> {
    try {
      // 计算固件哈希
      const firmwareHash = this.calculateHash(firmware.data);

      // 验证元数据中的哈希
      if (firmware.metadata.fileHash && firmware.metadata.fileHash !== firmwareHash) {
        return {
          valid: false,
          details: {
            algorithm: SignatureAlgorithm.RSA_SHA256,
            firmwareHash,
            expectedHash: firmware.metadata.fileHash,
            error: 'Firmware hash mismatch',
          },
        };
      }

      // 如果没有签名，只验证哈希
      if (!firmware.signature || firmware.signature.length === 0) {
        return {
          valid: firmwareHash === firmware.metadata.fileHash,
          details: {
            algorithm: SignatureAlgorithm.RSA_SHA256,
            firmwareHash,
            expectedHash: firmware.metadata.fileHash,
          },
        };
      }

      // 获取签名证书
      const certificate = await this.getCertificate(firmware.metadata.type);

      if (!certificate) {
        return {
          valid: false,
          details: {
            algorithm: SignatureAlgorithm.RSA_SHA256,
            firmwareHash,
            error: 'No valid certificate found for firmware type',
          },
        };
      }

      // 检查证书状态
      if (certificate.status !== 'active') {
        return {
          valid: false,
          details: {
            algorithm: certificate.algorithm,
            firmwareHash,
            error: `Certificate status is ${certificate.status}`,
          },
        };
      }

      // 检查证书有效期
      const now = new Date();
      if (now < certificate.validFrom || now > certificate.validTo) {
        return {
          valid: false,
          details: {
            algorithm: certificate.algorithm,
            firmwareHash,
            certValidFrom: certificate.validFrom,
            certValidTo: certificate.validTo,
            error: 'Certificate is not valid at this time',
          },
        };
      }

      // 验证数字签名
      const signatureValid = this.verifySignature(
        firmware.data,
        firmware.signature,
        certificate.publicKey,
        certificate.algorithm
      );

      if (!signatureValid) {
        return {
          valid: false,
          details: {
            algorithm: certificate.algorithm,
            firmwareHash,
            signer: certificate.signerName,
            error: 'Signature verification failed',
          },
        };
      }

      // 检查是否在吊销列表中
      const isRevoked = await this.isRevoked(firmware.metadata.version, firmware.metadata.deviceModel);
      if (isRevoked) {
        return {
          valid: false,
          details: {
            algorithm: certificate.algorithm,
            firmwareHash,
            signer: certificate.signerName,
            error: 'Firmware version has been revoked',
          },
        };
      }

      return {
        valid: true,
        details: {
          algorithm: certificate.algorithm,
          signer: certificate.signerName,
          signedAt: firmware.metadata.releasedAt,
          certValidFrom: certificate.validFrom,
          certValidTo: certificate.validTo,
          firmwareHash,
        },
      };
    } catch (error) {
      this.logger.error('[FirmwareSignature] Error verifying firmware:', error);
      return {
        valid: false,
        details: {
          algorithm: SignatureAlgorithm.RSA_SHA256,
          firmwareHash: '',
          error: (error as Error).message,
        },
      };
    }
  }

  /**
   * 验证固件哈希
   *
   * @param firmwareData 固件数据
   * @param expectedHash 期望的哈希值
   * @returns 是否匹配
   */
  async verifyHash(firmwareData: Buffer, expectedHash: string): Promise<boolean> {
    const actualHash = this.calculateHash(firmwareData);
    return actualHash === expectedHash;
  }

  /**
   * 为固件生成签名
   *
   * @param firmwareData 固件数据
   * @param privateKey 私钥（PEM格式）
   * @param algorithm 签名算法
   * @returns 签名数据
   */
  async signFirmware(
    firmwareData: Buffer,
    privateKey: string,
    algorithm: SignatureAlgorithm = SignatureAlgorithm.RSA_SHA256
  ): Promise<Buffer> {
    try {
      const hashAlgorithm = this.getHashAlgorithm(algorithm);
      const sign = createSign(hashAlgorithm);
      sign.update(firmwareData);
      sign.end();

      const signature = sign.sign({
        key: privateKey,
        format: 'pem',
      });

      return signature;
    } catch (error) {
      this.logger.error('[FirmwareSignature] Error signing firmware:', error);
      throw new Error(`Failed to sign firmware: ${(error as Error).message}`);
    }
  }

  /**
   * 注册签名证书
   *
   * @param certificate 证书信息
   */
  async registerCertificate(certificate: Omit<SignatureCertificate, 'id'>): Promise<string> {
    const id = this.generateCertId(certificate.signerName, certificate.algorithm);
    const fullCert: SignatureCertificate = {
      id,
      ...certificate,
    };

    const key = `${this.CERT_PREFIX}${id}`;
    await this.redis.set(key, JSON.stringify(fullCert), 'EX', this.DEFAULT_TTL);

    // 添加到可信存储
    await this.redis.sadd(this.TRUSTED_STORE_KEY, id);

    // 更新内存缓存
    this.certificateCache.set(id, fullCert);

    this.logger.info(`[FirmwareSignature] Registered certificate: ${id}`);
    return id;
  }

  /**
   * 撤销固件版本
   *
   * @param version 固件版本
   * @param deviceModel 设备型号
   * @param reason 撤销原因
   */
  async revokeFirmware(version: string, deviceModel: string, reason: string): Promise<void> {
    const key = `${this.REVOKED_PREFIX}${deviceModel}:${version}`;
    const data = {
      version,
      deviceModel,
      reason,
      revokedAt: new Date(),
    };

    await this.redis.set(key, JSON.stringify(data), 'EX', 365 * this.DEFAULT_TTL); // 1年
    this.logger.warn(`[FirmwareSignature] Revoked firmware ${version} for ${deviceModel}: ${reason}`);
  }

  /**
   * 检查固件是否已被撤销
   *
   * @param version 固件版本
   * @param deviceModel 设备型号
   * @returns 是否已撤销
   */
  async isRevoked(version: string, deviceModel: string): Promise<boolean> {
    const key = `${this.REVOKED_PREFIX}${deviceModel}:${version}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * 撤销证书
   *
   * @param certId 证书ID
   */
  async revokeCertificate(certId: string): Promise<void> {
    const cert = await this.getCertificateById(certId);
    if (!cert) {
      throw new Error(`Certificate ${certId} not found`);
    }

    cert.status = 'revoked';
    const key = `${this.CERT_PREFIX}${certId}`;
    await this.redis.set(key, JSON.stringify(cert), 'EX', this.DEFAULT_TTL);

    // 从可信存储移除
    await this.redis.srem(this.TRUSTED_STORE_KEY, certId);

    // 更新内存缓存
    this.certificateCache.set(certId, cert);

    this.logger.warn(`[FirmwareSignature] Revoked certificate: ${certId}`);
  }

  /**
   * 获取固件类型的证书
   *
   * @param firmwareType 固件类型
   * @returns 证书信息
   */
  async getCertificate(firmwareType: string): Promise<SignatureCertificate | null> {
    try {
      // 尝试获取该类型的专用证书
      const key = `${this.CERT_PREFIX}type:${firmwareType}`;
      const data = await this.redis.get(key);

      if (data) {
        return JSON.parse(data) as SignatureCertificate;
      }

      // 获取默认证书
      const defaultKey = `${this.CERT_PREFIX}default`;
      const defaultData = await this.redis.get(defaultKey);

      if (defaultData) {
        return JSON.parse(defaultData) as SignatureCertificate;
      }

      return null;
    } catch (error) {
      this.logger.error('[FirmwareSignature] Error getting certificate:', error);
      return null;
    }
  }

  /**
   * 根据ID获取证书
   *
   * @param certId 证书ID
   * @returns 证书信息
   */
  async getCertificateById(certId: string): Promise<SignatureCertificate | null> {
    try {
      const key = `${this.CERT_PREFIX}${certId}`;
      const data = await this.redis.get(key);

      if (data) {
        return JSON.parse(data) as SignatureCertificate;
      }

      return null;
    } catch (error) {
      this.logger.error('[FirmwareSignature] Error getting certificate by ID:', error);
      return null;
    }
  }

  /**
   * 获取所有已撤销的固件
   *
   * @param deviceModel 可选的设备型号过滤
   * @returns 撤销的固件列表
   */
  async getRevokedFirmwares(deviceModel?: string): Promise<Array<{
    version: string;
    deviceModel: string;
    reason: string;
    revokedAt: Date;
  }>> {
    try {
      const pattern = deviceModel
        ? `${this.REVOKED_PREFIX}${deviceModel}:*`
        : `${this.REVOKED_PREFIX}*`;

      const keys = await this.redis.keys(pattern);
      const revokedFirmwares: Array<{
        version: string;
        deviceModel: string;
        reason: string;
        revokedAt: Date;
      }> = [];

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          revokedFirmwares.push(JSON.parse(data));
        }
      }

      return revokedFirmwares;
    } catch (error) {
      this.logger.error('[FirmwareSignature] Error getting revoked firmwares:', error);
      return [];
    }
  }

  /**
   * 批量验证固件
   *
   * @param firmwares 固件包列表
   * @returns 验证结果列表
   */
  async verifyBatch(firmwares: FirmwarePackage[]): Promise<SignatureVerificationResult[]> {
    const results: SignatureVerificationResult[] = [];

    for (const firmware of firmwares) {
      const result = await this.verifyFirmware(firmware);
      results.push(result);
    }

    return results;
  }

  /**
   * 清理过期的撤销记录
   *
   * @returns 清理的数量
   */
  async cleanupRevokedList(): Promise<number> {
    try {
      const pattern = `${this.REVOKED_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      let cleanedCount = 0;

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const revoked = JSON.parse(data);
          const revokedAt = new Date(revoked.revokedAt);
          const daysSinceRevoked = (Date.now() - revokedAt.getTime()) / (1000 * 60 * 60 * 24);

          // 1年后自动清理撤销记录
          if (daysSinceRevoked > 365) {
            await this.redis.del(key);
            cleanedCount++;
          }
        }
      }

      if (cleanedCount > 0) {
        this.logger.info(`[FirmwareSignature] Cleaned up ${cleanedCount} expired revocation records`);
      }

      return cleanedCount;
    } catch (error) {
      this.logger.error('[FirmwareSignature] Error cleaning up revoked list:', error);
      return 0;
    }
  }

  /**
   * 从文件加载公钥
   *
   * @param publicKeyPath 公钥文件路径
   * @returns 公钥内容
   */
  loadPublicKeyFromFile(publicKeyPath: string): string {
    try {
      const fullPath = resolve(publicKeyPath);
      return readFileSync(fullPath, 'utf-8');
    } catch (error) {
      this.logger.error('[FirmwareSignature] Error loading public key:', error);
      throw new Error(`Failed to load public key: ${(error as Error).message}`);
    }
  }

  /**
   * 验证数字签名
   *
   * @param data 原始数据
   * @param signature 签名
   * @param publicKey 公钥
   * @param algorithm 签名算法
   * @returns 是否有效
   */
  private verifySignature(
    data: Buffer,
    signature: Buffer,
    publicKey: string,
    algorithm: SignatureAlgorithm
  ): boolean {
    try {
      const hashAlgorithm = this.getHashAlgorithm(algorithm);
      const verify = createVerify(hashAlgorithm);
      verify.update(data);
      verify.end();

      return verify.verify(
        {
          key: publicKey,
          format: 'pem',
        },
        signature
      );
    } catch (error) {
      this.logger.error('[FirmwareSignature] Error verifying signature:', error);
      return false;
    }
  }

  /**
   * 计算数据哈希
   *
   * @param data 数据
   * @returns SHA256哈希值（十六进制）
   */
  private calculateHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * 获取哈希算法名称
   *
   * @param signatureAlgorithm 签名算法
   * @returns 哈希算法名称
   */
  private getHashAlgorithm(signatureAlgorithm: SignatureAlgorithm): string {
    switch (signatureAlgorithm) {
      case SignatureAlgorithm.RSA_SHA256:
      case SignatureAlgorithm.ECDSA_SHA256:
        return 'sha256';
      case SignatureAlgorithm.RSA_SHA512:
        return 'sha512';
      case SignatureAlgorithm.ED25519:
        return 'sha512';
      default:
        return 'sha256';
    }
  }

  /**
   * 生成证书ID
   *
   * @param signerName 签名者名称
   * @param algorithm 签名算法
   * @returns 证书ID
   */
  private generateCertId(signerName: string, algorithm: SignatureAlgorithm): string {
    const hash = createHash('sha256')
      .update(`${signerName}:${algorithm}:${Date.now()}`)
      .digest('hex');
    return hash.substring(0, 16);
  }
}
