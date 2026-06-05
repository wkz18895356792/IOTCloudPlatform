import { Rule, RuleType } from '@midwayjs/validate';

/**
 * 开通面容ID登录请求DTO
 */
export class EnableFaceIdRequestDTO {
  @Rule(RuleType.string().required())
  faceIdData!: string;
}

/**
 * 验证面容ID登录请求DTO
 */
export class VerifyFaceIdRequestDTO {
  @Rule(RuleType.string().required())
  faceIdToken!: string;
}

/**
 * 更新面容ID数据请求DTO
 */
export class UpdateFaceIdDataRequestDTO {
  @Rule(RuleType.string().required())
  faceIdData!: string;
}

/**
 * 面容ID状态响应DTO
 */
export interface FaceIdStatusResponse {
  enabled: boolean;
  registeredAt: Date | null;
  deviceSupported: boolean;
}
