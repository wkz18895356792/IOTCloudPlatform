import { Provide, Inject, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import * as forge from 'node-forge';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * 证书用途
 */
export enum KeyUsage {
  DIGITAL_SIGNATURE = 'digitalSignature',
  NON_REPUDIATION = 'nonRepudiation',
  KEY_ENCIPHERMENT = 'keyEncipherment',
  DATA_ENCIPHERMENT = 'dataEncipherment',
  KEY_AGREEMENT = 'keyAgreement',
  KEY_CERT_SIGN = 'keyCertSign',
  CRL_SIGN = 'cRLSign',
  ENCIPHER_ONLY = 'encipherOnly',
  DECIPHER_ONLY = 'decipherOnly',
}

/**
 * 扩展密钥用途
 */
export enum ExtendedKeyUsage {
  SERVER_AUTH = 'serverAuth',
  CLIENT_AUTH = 'clientAuth',
  CODE_SIGNING = 'codeSigning',
  EMAIL_PROTECTION = 'emailProtection',
  TIME_STAMPING = 'timeStamping',
  OCSP_SIGNING = 'ocspSigning',
}

/**
 * 证书状态
 */
export enum CertificateStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
  PENDING = 'pending',
}

/**
 * CA 配置
 */
export interface CAConfig {
  name: string;
  country: string;
  organization: string;
  commonName: string;
  keySize: number;
  validityDays: number;
  pathLen: number; // CA 路径长度限制
}

/**
 * 证书签发请求
 */
export interface CertificateSigningRequest {
  deviceId: string;
  productId: string;
  domainId?: string;
  subject: {
    country: string;
    state?: string;
    locality?: string;
    organization: string;
    organizationalUnit?: string;
    commonName: string;
    emailAddress?: string;
  };
  keyUsage: KeyUsage[];
  extendedKeyUsage?: ExtendedKeyUsage[];
  validityDays?: number;
}

/**
 * 签发的证书
 */
export interface IssuedCertificate {
  certificatePem: string;
  privateKeyPem: string;
  certificateDer: string;
  fingerprint: string;
  serialNumber: string;
  issuer: string;
  subject: string;
  validFrom: Date;
  validTo: Date;
  keyUsage: KeyUsage[];
  extendedKeyUsage: ExtendedKeyUsage[];
}

/**
 * 证书吊销列表 (CRL)
 */
export interface CertificateRevocationList {
  issuer: string;
  thisUpdate: Date;
  nextUpdate: Date;
  revokedCertificates: Array<{
    serialNumber: string;
    revocationDate: Date;
    reason?: string;
  }>;
}

/**
 * CA 证书服务
 *
 * 提供完整的 PKI 证书签发功能，包括：
 * - CA 根证书生成和管理
 * - 中间 CA 证书签发
 * - 设备证书签发
 * - 证书吊销和 CRL 生成
 * - OCSP 响应器支持
 */
@Provide()
export class CACertificateService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  private caKeyPair: forge.pki.KeyPair | null = null;
  private caCertificate: forge.pki.Certificate | null = null;
  private caConfig: CAConfig;
  private readonly CA_KEY_PATH = '/tmp/ca/key.pem';
  private readonly CA_CERT_PATH = '/tmp/ca/cert.pem';
  private readonly STORAGE_PREFIX = 'ca:cert:';

  @Init()
  async init() {
    this.caConfig = {
      name: process.env.CA_NAME || 'BabyMonitor Root CA',
      country: process.env.CA_COUNTRY || 'CN',
      organization: process.env.CA_ORG || 'BabyMonitor',
      commonName: process.env.CA_COMMON_NAME || 'BabyMonitor Root CA',
      keySize: parseInt(process.env.CA_KEY_SIZE || '4096'),
      validityDays: parseInt(process.env.CA_VALIDITY_DAYS || '3650'), // 10 years
      pathLen: parseInt(process.env.CA_PATH_LEN || '2'),
    };

    // 确保 CA 目录存在
    await fs.mkdir(path.dirname(this.CA_KEY_PATH), { recursive: true });
    await fs.mkdir(path.dirname(this.CA_CERT_PATH), { recursive: true });

    // 加载或创建 CA 证书
    await this.loadOrCreateCA();

    this.logger.info('[CACertificateService] CA Certificate Service initialized');
  }

  /**
   * 加载或创建 CA 根证书
   */
  private async loadOrCreateCA(): Promise<void> {
    try {
      // 尝试从文件加载
      const keyData = await fs.readFile(this.CA_KEY_PATH, 'utf-8');
      const certData = await fs.readFile(this.CA_CERT_PATH, 'utf-8');

      this.caKeyPair = {
        privateKey: forge.pki.privateKeyFromPem(keyData),
        publicKey: forge.pki.publicKeyFromPem(keyData),
      };

      this.caCertificate = forge.pki.certificateFromPem(certData);

      this.logger.info('[CACertificateService] CA certificate loaded from file');
      return;
    } catch (error) {
      // 文件不存在，创建新的 CA
      this.logger.info('[CACertificateService] Creating new CA certificate');
      await this.createCA();
    }
  }

  /**
   * 创建新的 CA 根证书
   */
  private async createCA(): Promise<void> {
    // 生成密钥对
    this.caKeyPair = forge.pki.rsa.generateKeyPair({
      bits: this.caConfig.keySize,
      workers: -1, // 使用所有可用 CPU 核心
    });

    // 创建证书
    const cert = forge.pki.createCertificate();
    cert.publicKey = this.caKeyPair.publicKey;
    cert.serialNumber = this.generateSerialNumber();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setDate(
      cert.validity.notBefore.getDate() + this.caConfig.validityDays
    );

    // 设置证书属性
    const attrs = [
      { name: 'countryName', value: this.caConfig.country },
      { name: 'organizationName', value: this.caConfig.organization },
      { shortName: 'CN', value: this.caConfig.commonName },
    ];

    cert.setSubject(attrs);
    cert.setIssuer(attrs); // 自签名

    // 添加扩展
    cert.setExtensions([
      {
        name: 'basicConstraints',
        cA: true,
        pathLenConstraint: this.caConfig.pathLen,
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        cRLSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true,
      },
      {
        name: 'extKeyUsage',
        serverAuth: true,
        clientAuth: true,
        codeSigning: true,
        emailProtection: true,
        timeStamping: true,
      },
      {
        name: 'subjectKeyIdentifier',
      },
      {
        name: 'authorityKeyIdentifier',
      },
    ]);

    // 自签名
    cert.sign(this.caKeyPair.privateKey as forge.pki.rsa.PrivateKey, forge.md.sha256.create());
    this.caCertificate = cert;

    // 保存到文件
    await this.saveCAToFile();

    // 缓存到 Redis
    await this.cacheCAInfo();

    this.logger.info('[CACertificateService] CA certificate created successfully');
  }

  /**
   * 签发设备证书
   */
  async signDeviceCertificate(csr: CertificateSigningRequest): Promise<IssuedCertificate> {
    if (!this.caKeyPair || !this.caCertificate) {
      throw new Error('CA not initialized');
    }

    // 生成设备密钥对
    const deviceKeyPair = forge.pki.rsa.generateKeyPair({
      bits: 2048,
      workers: -1,
    });

    // 创建证书
    const cert = forge.pki.createCertificate();
    cert.publicKey = deviceKeyPair.publicKey;
    cert.serialNumber = this.generateSerialNumber();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setDate(
      cert.validity.notBefore.getDate() + (csr.validityDays || 365)
    );

    // 设置主题
    const subjectAttrs = [
      { name: 'countryName', value: csr.subject.country },
      { name: 'stateOrProvinceName', value: csr.subject.state },
      { name: 'localityName', value: csr.subject.locality },
      { name: 'organizationName', value: csr.subject.organization },
      { name: 'organizationalUnitName', value: csr.subject.organizationalUnit },
      { shortName: 'CN', value: csr.subject.commonName },
      { name: 'emailAddress', value: csr.subject.emailAddress },
    ].filter(attr => attr.value !== undefined);

    cert.setSubject(subjectAttrs);
    cert.setIssuer(this.caCertificate.subject.attributes);

    // 添加自定义扩展
    const extensions = [
      {
        name: 'basicConstraints',
        cA: false,
      },
      {
        name: 'keyUsage',
        ...this.buildKeyUsage(csr.keyUsage),
      },
      {
        name: 'extKeyUsage',
        ...this.buildExtendedKeyUsage(csr.extendedKeyUsage || []),
      },
      {
        name: 'subjectKeyIdentifier',
      },
      {
        name: 'authorityKeyIdentifier',
      },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 1, value: csr.deviceId }, // deviceId
          { type: 2, value: csr.subject.commonName }, // DNS
          { type: 7, ip: csr.deviceId }, // IP (作为备用)
        ],
      },
      {
        name: 'customExtension',
        extnId: '1.3.6.1.4.1.99999.1', // 私有扩展 OID
        value: this.createCustomExtension({
          deviceId: csr.deviceId,
          productId: csr.productId,
          domainId: csr.domainId,
        }),
      },
    ];

    cert.setExtensions(extensions);

    // 使用 CA 签名
    cert.sign(this.caKeyPair.privateKey as forge.pki.rsa.PrivateKey, forge.md.sha256.create());

    // 转换为 PEM
    const certificatePem = forge.pki.certificateToPem(cert);
    const privateKeyPem = forge.pki.privateKeyToPem(deviceKeyPair.privateKey);
    const certificateDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();

    // 计算指纹
    const fingerprint = this.calculateFingerprint(certificateDer);

    const issuedCert: IssuedCertificate = {
      certificatePem,
      privateKeyPem,
      certificateDer,
      fingerprint,
      serialNumber: cert.serialNumber,
      issuer: this.caCertificate.subject.attributes
        .map(attr => `${attr.shortName || attr.name}=${attr.value}`)
        .join(', '),
      subject: subjectAttrs
        .map(attr => `${attr.shortName || attr.name}=${attr.value}`)
        .join(', '),
      validFrom: cert.validity.notBefore,
      validTo: cert.validity.notAfter,
      keyUsage: csr.keyUsage,
      extendedKeyUsage: csr.extendedKeyUsage || [],
    };

    // 保存到 Redis
    await this.saveIssuedCertificate(csr.deviceId, issuedCert);

    this.logger.info('[CACertificateService] Device certificate signed', {
      deviceId: csr.deviceId,
      serialNumber: cert.serialNumber,
    });

    return issuedCert;
  }

  /**
   * 创建中间 CA 证书
   */
  async createIntermediateCA(
    name: string,
    validityDays: number = 1825 // 5 years
  ): Promise<IssuedCertificate> {
    if (!this.caKeyPair || !this.caCertificate) {
      throw new Error('CA not initialized');
    }

    // 生成中间 CA 密钥对
    const intermediateKeyPair = forge.pki.rsa.generateKeyPair({
      bits: 4096,
      workers: -1,
    });

    // 创建证书
    const cert = forge.pki.createCertificate();
    cert.publicKey = intermediateKeyPair.publicKey;
    cert.serialNumber = this.generateSerialNumber();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + validityDays);

    // 设置主题
    const attrs = [
      { name: 'countryName', value: this.caConfig.country },
      { name: 'organizationName', value: this.caConfig.organization },
      { name: 'organizationalUnitName', value: name },
      { shortName: 'CN', value: `${name} Intermediate CA` },
    ];

    cert.setSubject(attrs);
    cert.setIssuer(this.caCertificate.subject.attributes);

    // 添加扩展
    cert.setExtensions([
      {
        name: 'basicConstraints',
        cA: true,
        pathLenConstraint: this.caConfig.pathLen - 1,
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        cRLSign: true,
        digitalSignature: true,
      },
      {
        name: 'subjectKeyIdentifier',
      },
      {
        name: 'authorityKeyIdentifier',
      },
    ]);

    // 使用根 CA 签名
    cert.sign(this.caKeyPair.privateKey as forge.pki.rsa.PrivateKey, forge.md.sha256.create());

    const certificatePem = forge.pki.certificateToPem(cert);
    const privateKeyPem = forge.pki.privateKeyToPem(intermediateKeyPair.privateKey);
    const certificateDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();

    return {
      certificatePem,
      privateKeyPem,
      certificateDer,
      fingerprint: this.calculateFingerprint(certificateDer),
      serialNumber: cert.serialNumber,
      issuer: this.caCertificate.subject.attributes
        .map(attr => `${attr.shortName || attr.name}=${attr.value}`)
        .join(', '),
      subject: attrs.map(attr => `${attr.shortName || attr.name}=${attr.value}`).join(', '),
      validFrom: cert.validity.notBefore,
      validTo: cert.validity.notAfter,
      keyUsage: [KeyUsage.KEY_CERT_SIGN, KeyUsage.CRL_SIGN, KeyUsage.DIGITAL_SIGNATURE],
      extendedKeyUsage: [],
    };
  }

  /**
   * 吊销证书
   */
  async revokeCertificate(
    serialNumber: string,
    reason: string = 'unspecified'
  ): Promise<void> {
    const key = `${this.STORAGE_PREFIX}${serialNumber}`;
    const certData = await this.redis.get(key);

    if (!certData) {
      throw new Error(`Certificate ${serialNumber} not found`);
    }

    const cert = JSON.parse(certData);
    cert.status = CertificateStatus.REVOKED;
    cert.revokedAt = new Date();
    cert.revocationReason = reason;

    await this.redis.set(key, JSON.stringify(cert));

    // 添加到吊销列表
    await this.addToCRL(serialNumber, reason);

    this.logger.info('[CACertificateService] Certificate revoked', { serialNumber, reason });
  }

  /**
   * 生成证书吊销列表 (CRL)
   */
  async generateCRL(): Promise<string> {
    if (!this.caKeyPair || !this.caCertificate) {
      throw new Error('CA not initialized');
    }

    // 获取所有吊销的证书
    const revokedCerts = await this.getRevokedCertificates();

    // 生成简单的 CRL 格式 (JSON格式，实际生产环境应使用标准ASN.1格式)
    const crlData: CertificateRevocationList = {
      issuer: this.caCertificate.subject.attributes
        .map(attr => `${attr.shortName || attr.name}=${attr.value}`)
        .join(', '),
      thisUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7天后
      revokedCertificates: revokedCerts.map(cert => ({
        serialNumber: cert.serialNumber,
        revocationDate: cert.revocationDate,
        reason: cert.reason,
      })),
    };

    const crlJson = JSON.stringify(crlData, null, 2);

    this.logger.info('[CACertificateService] CRL generated', {
      revokedCount: revokedCerts.length,
    });

    // 返回 PEM 格式的 JSON 数据（简化实现）
    const base64Crl = Buffer.from(crlJson).toString('base64');
    return `-----BEGIN CRL-----\n${base64Crl.match(/.{1,64}/g)?.join('\n') || ''}\n-----END CRL-----`;
  }

  /**
   * 验证证书
   */
  async verifyCertificate(certificatePem: string): Promise<{
    valid: boolean;
    error?: string;
    revoked?: boolean;
    expired?: boolean;
  }> {
    try {
      if (!this.caCertificate) {
        return { valid: false, error: 'CA not initialized' };
      }

      const cert = forge.pki.certificateFromPem(certificatePem);
      const now = new Date();

      // 检查有效期
      if (cert.validity.notBefore > now) {
        return { valid: false, error: 'Certificate not yet valid' };
      }

      if (cert.validity.notAfter < now) {
        return { valid: false, expired: true, error: 'Certificate expired' };
      }

      // 检查吊销状态
      const key = `${this.STORAGE_PREFIX}${cert.serialNumber}`;
      const certData = await this.redis.get(key);

      if (certData) {
        const cert = JSON.parse(certData);
        if (cert.status === CertificateStatus.REVOKED) {
          return { valid: false, revoked: true, error: 'Certificate revoked' };
        }
      }

      // 验证签名
      const caStore = forge.pki.createCaStore([this.caCertificate]);
      try {
        forge.pki.verifyCertificateChain(caStore, [cert]);
      } catch (error) {
        return { valid: false, error: 'Certificate signature verification failed' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: (error as Error).message };
    }
  }

  /**
   * 获取 CA 证书
   */
  getCACertificate(): string {
    if (!this.caCertificate) {
      throw new Error('CA not initialized');
    }
    return forge.pki.certificateToPem(this.caCertificate);
  }

  /**
   * 获取 CA 信息
   */
  getCAInfo(): {
    subject: string;
    issuer: string;
    validFrom: Date;
    validTo: Date;
    serialNumber: string;
    fingerprint: string;
  } {
    if (!this.caCertificate) {
      throw new Error('CA not initialized');
    }

    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(this.caCertificate)).getBytes();

    return {
      subject: this.caCertificate.subject.attributes
        .map(attr => `${attr.shortName || attr.name}=${attr.value}`)
        .join(', '),
      issuer: this.caCertificate.issuer.attributes
        .map(attr => `${attr.shortName || attr.name}=${attr.value}`)
        .join(', '),
      validFrom: this.caCertificate.validity.notBefore,
      validTo: this.caCertificate.validity.notAfter,
      serialNumber: this.caCertificate.serialNumber,
      fingerprint: this.calculateFingerprint(der),
    };
  }

  /**
   * 保存 CA 到文件
   */
  private async saveCAToFile(): Promise<void> {
    if (!this.caKeyPair || !this.caCertificate) {
      throw new Error('CA not initialized');
    }

    const privateKeyPem = forge.pki.privateKeyToPem(this.caKeyPair.privateKey);
    const certificatePem = forge.pki.certificateToPem(this.caCertificate);

    await fs.writeFile(this.CA_KEY_PATH, privateKeyPem, { mode: 0o600 });
    await fs.writeFile(this.CA_CERT_PATH, certificatePem);
  }

  /**
   * 缓存 CA 信息到 Redis
   */
  private async cacheCAInfo(): Promise<void> {
    const caInfo = this.getCAInfo();
    await this.redis.set('ca:info', JSON.stringify(caInfo));
  }

  /**
   * 保存签发的证书
   */
  private async saveIssuedCertificate(
    deviceId: string,
    cert: IssuedCertificate
  ): Promise<void> {
    const key = `${this.STORAGE_PREFIX}${cert.serialNumber}`;
    const data = {
      deviceId,
      ...cert,
      status: CertificateStatus.ACTIVE,
      issuedAt: new Date(),
    };

    // 设置过期时间为证书有效期 + 30天
    const ttl = Math.floor((cert.validTo.getTime() - Date.now()) / 1000) + 30 * 24 * 3600;
    await this.redis.set(key, JSON.stringify(data), 'EX', ttl);

    // 按设备 ID 索引
    await this.redis.sadd(`ca:device:${deviceId}`, cert.serialNumber);
  }

  /**
   * 添加到 CRL
   */
  private async addToCRL(serialNumber: string, reason: string): Promise<void> {
    const crlKey = 'ca:crl';
    const entry = {
      serialNumber,
      revocationDate: new Date(),
      reason,
    };

    await this.redis.hset(crlKey, serialNumber, JSON.stringify(entry));
  }

  /**
   * 获取吊销的证书列表
   */
  private async getRevokedCertificates(): Promise<Array<{
    serialNumber: string;
    revocationDate: Date;
    reason?: string;
  }>> {
    const crlData = await this.redis.hgetall('ca:crl');
    const revoked = [];

    for (const serialNumber in crlData) {
      const entry = JSON.parse(crlData[serialNumber]);
      revoked.push({
        serialNumber,
        revocationDate: new Date(entry.revocationDate),
        reason: entry.reason,
      });
    }

    return revoked;
  }

  /**
   * 生成序列号
   */
  private generateSerialNumber(): string {
    // 使用时间戳和随机数生成唯一的序列号
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `${timestamp}${random}`.toUpperCase();
  }

  /**
   * 计算证书指纹
   */
  private calculateFingerprint(der: string): string {
    const md = forge.md.sha256.create();
    md.update(der, 'raw');
    const digest = md.digest().data.toUpperCase();
    const matches = digest.match(/.{2}/g);
    return matches ? matches.join(':') : digest;
  }

  /**
   * 构建密钥用途
   */
  private buildKeyUsage(usages: KeyUsage[]): any {
    const usage: any = {};
    for (const u of usages) {
      usage[u] = true;
    }
    return usage;
  }

  /**
   * 构建扩展密钥用途
   */
  private buildExtendedKeyUsage(usages: ExtendedKeyUsage[]): any {
    const usage: any = {};
    for (const u of usages) {
      usage[u] = true;
    }
    return usage;
  }

  /**
   * 创建自定义扩展
   */
  private createCustomExtension(data: Record<string, any>): string {
    const jsonStr = JSON.stringify(data);
    return forge.util.bytesToHex(jsonStr);
  }

  /**
   * 生成证书请求签名 (CSR)
   */
  async generateCSR(params: {
    deviceId: string;
    subject: CertificateSigningRequest['subject'];
    keySize?: number;
  }): Promise<{
    csrPem: string;
    privateKeyPem: string;
  }> {
    // 生成密钥对
    const keyPair = forge.pki.rsa.generateKeyPair({
      bits: params.keySize || 2048,
      workers: -1,
    });

    // 创建 CSR
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keyPair.publicKey;
    csr.setSubject([
      { name: 'countryName', value: params.subject.country },
      { name: 'stateOrProvinceName', value: params.subject.state },
      { name: 'localityName', value: params.subject.locality },
      { name: 'organizationName', value: params.subject.organization },
      { name: 'organizationalUnitName', value: params.subject.organizationalUnit },
      { shortName: 'CN', value: params.subject.commonName },
    ].filter(attr => attr.value !== undefined));

    // 添加自定义属性
    csr.setAttributes([
      {
        name: 'extensionRequest',
        extensions: [
          {
            name: 'subjectAltName',
            altNames: [
              { type: 1, value: params.deviceId },
            ],
          },
        ],
      },
    ]);

    // 签名 CSR
    csr.sign(keyPair.privateKey, forge.md.sha256.create());

    return {
      csrPem: forge.pki.certificationRequestToPem(csr),
      privateKeyPem: forge.pki.privateKeyToPem(keyPair.privateKey),
    };
  }
}
