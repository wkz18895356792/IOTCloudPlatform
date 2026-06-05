import * as crypto from 'crypto';

/**
 * HMAC 签名算法
 */
export enum HMACAlgorithm {
  SHA256 = 'sha256',
  SHA384 = 'sha384',
  SHA512 = 'sha512',
}

/**
 * 设备签名验证工具类
 *
 * 提供设备认证所需的签名和验证功能
 */
export class DeviceSignatureUtils {
  /**
   * 计算 HMAC 签名
   *
   * @param data - 待签名的数据
   * @param secret - 密钥
   * @param algorithm - 签名算法，默认 SHA256
   * @returns 十六进制签名字符串
   */
  static computeSignature(
    data: string,
    secret: string,
    algorithm: HMACAlgorithm = HMACAlgorithm.SHA256
  ): string {
    return crypto.createHmac(algorithm, secret).update(data).digest('hex');
  }

  /**
   * 验证 HMAC 签名
   *
   * @param data - 原始数据
   * @param signature - 待验证的签名
   * @param secret - 密钥
   * @param algorithm - 签名算法，默认 SHA256
   * @returns 签名是否有效
   */
  static verifySignature(
    data: string,
    signature: string,
    secret: string,
    algorithm: HMACAlgorithm = HMACAlgorithm.SHA256
  ): boolean {
    const expectedSignature = this.computeSignature(data, secret, algorithm);
    // 使用常量时间比较防止时序攻击
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(signature, 'hex')
    );
  }

  /**
   * 构建设备签名数据
   *
   * 按照约定格式拼接设备注册数据
   *
   * @param deviceId - 设备ID
   * @param productId - 产品ID
   * @param timestamp - 时间戳
   * @param nonce - 随机数
   * @returns 拼接后的待签名数据
   */
  static buildSignatureData(
    deviceId: string,
    productId: string,
    timestamp: number,
    nonce: string
  ): string {
    return `${deviceId}${productId}${timestamp}${nonce}`;
  }

  /**
   * 生成随机 Nonce
   *
   * @param length - Nonce 长度（字节），默认 16
   * @returns Base64 编码的随机字符串
   */
  static generateNonce(length: number = 16): string {
    return crypto.randomBytes(length).toString('base64');
  }

  /**
   * 验证时间戳有效性
   *
   * @param timestamp - 待验证的时间戳（毫秒）
   * @param tolerance - 容忍时间差（秒），默认 300 秒（5分钟）
   * @returns 时间戳是否有效
   */
  static validateTimestamp(timestamp: number, tolerance: number = 300): boolean {
    const now = Date.now();
    const diff = Math.abs(now - timestamp);
    return diff <= tolerance * 1000;
  }

  /**
   * 计算设备指纹
   *
   * 基于设备硬件信息生成唯一指纹
   *
   * @param deviceId - 设备ID
   * @param macAddress - MAC地址
   * @param algorithm - 哈希算法，默认 SHA256
   * @returns 十六进制指纹字符串
   */
  static computeDeviceFingerprint(
    deviceId: string,
    macAddress: string,
    algorithm: 'SHA256' | 'SHA512' = 'SHA256'
  ): string {
    const data = `${deviceId}:${macAddress}`;
    return crypto.createHash(algorithm.toLowerCase()).update(data).digest('hex');
  }

  /**
   * 验证设备指纹
   *
   * @param deviceId - 设备ID
   * @param macAddress - MAC地址
   * @param expectedFingerprint - 期望的指纹
   * @param algorithm - 哈希算法，默认 SHA256
   * @returns 指纹是否匹配
   */
  static verifyDeviceFingerprint(
    deviceId: string,
    macAddress: string,
    expectedFingerprint: string,
    algorithm: 'SHA256' | 'SHA512' = 'SHA256'
  ): boolean {
    const actualFingerprint = this.computeDeviceFingerprint(deviceId, macAddress, algorithm);
    return actualFingerprint === expectedFingerprint;
  }

  /**
   * 生成设备密钥
   *
   * @param length - 密钥长度（字节），默认 32
   * @returns 十六进制密钥字符串
   */
  static generateDeviceSecret(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * 生成产品密钥
   *
   * @returns 十六进制密钥字符串
   */
  static generateProductSecret(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * 生成注册码
   *
   * 格式: XXXX-XXXX-XXXX
   *
   * @returns 注册码字符串
   */
  static generateRegistrationCode(): string {
    const segments: string[] = [];
    for (let i = 0; i < 3; i++) {
      const segment = crypto.randomBytes(2).toString('hex').toUpperCase();
      segments.push(segment);
    }
    return segments.join('-');
  }

  /**
   * 验证注册码格式
   *
   * @param code - 注册码
   * @returns 格式是否有效
   */
  static validateRegistrationCodeFormat(code: string): boolean {
    // 格式: XXXX-XXXX-XXXX (X 为十六进制字符)
    const regex = /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;
    return regex.test(code);
  }

  /**
   * 生成密钥对（用于 X.509 证书）
   *
   * @param keySize - 密钥大小，默认 2048
   * @returns 密钥对对象
   */
  static generateKeyPair(keySize: number = 2048): {
    publicKey: string;
    privateKey: string;
  } {
    const keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: keySize,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
    };
  }

  /**
   * 计算证书指纹
   *
   * @param certificatePem - PEM 格式证书
   * @returns 十六进制指纹字符串
   */
  static computeCertificateFingerprint(certificatePem: string): string {
    // Calculate fingerprint from the certificate PEM
    const cert = new crypto.X509Certificate(certificatePem);
    return cert.fingerprint.replace(/:/g, '').toLowerCase();
  }

  /**
   * AES 加密数据
   *
   * @param data - 待加密的数据
   * @param key - 加密密钥（32 字节）
   * @param iv - 初始化向量（16 字节），可选
   * @returns 加密后的数据（Base64）
   */
  static encryptAES(data: string, key: string, iv?: string): string {
    const keyBuffer = Buffer.from(key, 'hex');
    const ivBuffer = iv ? Buffer.from(iv, 'hex') : crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, ivBuffer);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();
    const result = ivBuffer.toString('hex') + encrypted + authTag.toString('hex');

    return Buffer.from(result, 'hex').toString('base64');
  }

  /**
   * AES 解密数据
   *
   * @param encryptedData - 加密的数据（Base64）
   * @param key - 解密密钥（32 字节）
   * @returns 解密后的原始数据
   */
  static decryptAES(encryptedData: string, key: string): string {
    const keyBuffer = Buffer.from(key, 'hex');
    const data = Buffer.from(encryptedData, 'base64').toString('hex');

    const iv = data.slice(0, 32);
    const encrypted = data.slice(32, -32);
    const authTag = data.slice(-32);

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      keyBuffer,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

/**
 * 认证错误码
 */
export enum AuthErrorCode {
  // 成功
  OK = 0,

  // 签名相关
  INVALID_SIGNATURE = -10,
  SIGNATURE_MISSING = -11,

  // 证书相关
  INVALID_CERTIFICATE = -12,
  CERTIFICATE_REVOKED = -13,
  CERTIFICATE_EXPIRED = -14,

  // 时间戳和 Nonce
  INVALID_NONCE = -15,
  NONCE_REUSED = -16,
  TIMESTAMP_INVALID = -17,

  // 白名单
  NOT_IN_WHITELIST = -18,
  IN_BLACKLIST = -19,

  // 设备指纹
  FINGERPRINT_MISMATCH = -20,

  // 配额
  QUOTA_EXCEEDED = -21,

  // 产品相关
  PRODUCT_NOT_FOUND = -22,
  PRODUCT_SUSPENDED = -23,

  // 限流
  RATE_LIMIT_EXCEEDED = -24,

  // 其他
  UNKNOWN_ERROR = -1,
  MISSING_PARAMS = -2,
}

/**
 * 认证错误码对应的常量名
 */
export const AuthErrorMessage: Record<AuthErrorCode, string> = {
  [AuthErrorCode.OK]: 'Success',

  [AuthErrorCode.INVALID_SIGNATURE]: 'Invalid signature',
  [AuthErrorCode.SIGNATURE_MISSING]: 'Signature missing',

  [AuthErrorCode.INVALID_CERTIFICATE]: 'Invalid certificate',
  [AuthErrorCode.CERTIFICATE_REVOKED]: 'Certificate revoked',
  [AuthErrorCode.CERTIFICATE_EXPIRED]: 'Certificate expired',

  [AuthErrorCode.INVALID_NONCE]: 'Invalid nonce',
  [AuthErrorCode.NONCE_REUSED]: 'Nonce already used',
  [AuthErrorCode.TIMESTAMP_INVALID]: 'Timestamp invalid',

  [AuthErrorCode.NOT_IN_WHITELIST]: 'Device not in whitelist',
  [AuthErrorCode.IN_BLACKLIST]: 'Device in blacklist',

  [AuthErrorCode.FINGERPRINT_MISMATCH]: 'Device fingerprint mismatch',

  [AuthErrorCode.QUOTA_EXCEEDED]: 'Quota exceeded',

  [AuthErrorCode.PRODUCT_NOT_FOUND]: 'Product not found',
  [AuthErrorCode.PRODUCT_SUSPENDED]: 'Product suspended',

  [AuthErrorCode.RATE_LIMIT_EXCEEDED]: 'Rate limit exceeded',

  [AuthErrorCode.UNKNOWN_ERROR]: 'Unknown error',
  [AuthErrorCode.MISSING_PARAMS]: 'Missing required parameters',
};
