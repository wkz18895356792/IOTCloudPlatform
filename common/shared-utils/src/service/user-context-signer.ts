import { DeviceSignatureUtils } from '../crypto.utils';

/**
 * 用户上下文数据（从 API Gateway 传递给下游服务的用户身份信息）
 */
export interface UserContextData {
  userId: string;
  role: string;
  username: string;
  sessionId?: string;
  token?: string;
}

/**
 * 签名验证结果
 */
export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

/**
 * 签名版本前缀，便于将来升级签名格式
 */
const SIGN_VERSION = 'v1';

/**
 * 用户上下文签名工具
 *
 * 用于 API Gateway 对用户上下文进行 HMAC 签名，
 * 以及下游服务验证签名，防止 X-User-* Header 被伪造。
 */
export class UserContextSigner {
  /**
   * 对用户上下文数据签名
   *
   * @param context - 用户上下文
   * @param secret  - 签名密钥（USER_CONTEXT_SIGNING_SECRET）
   * @returns 签名和时间戳
   */
  static sign(
    context: UserContextData,
    secret: string
  ): { signature: string; timestamp: number } {
    const timestamp = Date.now();
    const payload = UserContextSigner.buildPayload(context, timestamp);
    const signature = DeviceSignatureUtils.computeSignature(payload, secret);
    return { signature, timestamp };
  }

  /**
   * 验证用户上下文签名
   *
   * @param context      - 用户上下文
   * @param timestamp    - 签名时的时间戳（毫秒）
   * @param signature    - 待验证的签名
   * @param secret       - 签名密钥
   * @param toleranceSec - 时间戳容忍偏差（秒），默认 300（5 分钟）
   * @returns 验证结果
   */
  static verify(
    context: UserContextData,
    timestamp: number,
    signature: string,
    secret: string,
    toleranceSec: number = 300
  ): VerifyResult {
    // 1. 检查时间戳
    if (!DeviceSignatureUtils.validateTimestamp(timestamp, toleranceSec)) {
      return { valid: false, reason: 'TIMESTAMP_EXPIRED' };
    }

    // 2. 重建 payload 并验证 HMAC
    const payload = UserContextSigner.buildPayload(context, timestamp);
    const isValid = DeviceSignatureUtils.verifySignature(payload, signature, secret);
    if (!isValid) {
      return { valid: false, reason: 'INVALID_SIGNATURE' };
    }

    return { valid: true };
  }

  /**
   * 构建签名 payload
   *
   * 格式: v1:<userId>:<role>:<username>:<sessionId>:<token>:<timestamp>
   * 所有字段用冒号分隔，undefined 字段用空字符串替代
   */
  private static buildPayload(context: UserContextData, timestamp: number): string {
    return [
      SIGN_VERSION,
      context.userId || '',
      context.role || '',
      context.username || '',
      context.sessionId || '',
      context.token || '',
      timestamp,
    ].join(':');
  }
}
