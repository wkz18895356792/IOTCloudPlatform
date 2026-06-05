/**
 * 双因素认证控制器
 *
 * 提供 2FA 设置、验证、禁用的 API 端点
 */
import { Controller, Get, Post, Body, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiTags, ApiBody } from '@midwayjs/swagger';
import { TwoFactorAuthService } from '../service/auth/two-factor-auth.service';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

@ApiTags('2FA身份验证（暂不启用）')
@Controller('/api/2fa')
export class TwoFactorController {
  @Inject()
  ctx!: Context;

  @Inject()
  twoFactorAuthService!: TwoFactorAuthService;

  /**
   * 获取 2FA 状态
   */
  @Get('/status')
  @ApiOperation({ summary: '获取2FA状态', description: '获取当前用户的双因素认证状态' })
  async getStatus() {
    const userId = this.ctx.state.user?.userId;
    if (!userId) {
      return errorResponse(ErrorCode.UNAUTHORIZED);
    }

    const status = await this.twoFactorAuthService.getStatus(userId);
    return successResponse(status);
  }

  /**
   * 设置 TOTP
   */
  @Post('/setup/totp')
  @ApiOperation({ summary: '设置TOTP', description: '初始化基于时间的一次性密码认证' })
  @ApiBody({
    description: 'TOTP设置参数',
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: '用户邮箱' },
      },
      required: ['email'],
    },
  })
  async setupTOTP(@Body() body: { email: string }) {
    const userId = this.ctx.state.user?.userId;
    if (!userId) {
      return errorResponse(ErrorCode.UNAUTHORIZED);
    }

    const result = await this.twoFactorAuthService.setupTOTP(userId, body.email);

    if (!result.success) {
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, result.error || '设置TOTP失败');
    }

    return successResponse({
      qrCodeUrl: result.qrCodeUrl,
      manualEntryKey: result.manualEntryKey,
      backupCodes: result.backupCodes,
    }, 'TOTP设置成功');
  }

  /**
   * 设置 SMS
   */
  @Post('/setup/sms')
  @ApiOperation({ summary: '设置SMS验证', description: '初始化短信验证码认证' })
  @ApiBody({
    description: 'SMS设置参数',
    schema: {
      type: 'object',
      properties: {
        phoneNumber: { type: 'string', description: '手机号' },
      },
      required: ['phoneNumber'],
    },
  })
  async setupSMS(@Body() body: { phoneNumber: string }) {
    const userId = this.ctx.state.user?.userId;
    if (!userId) {
      return errorResponse(ErrorCode.UNAUTHORIZED);
    }

    const result = await this.twoFactorAuthService.setupSMS(userId, body.phoneNumber);

    if (!result.success) {
      return errorResponse(ErrorCode.VERIFICATION_CODE_SEND_FAILED, result.error || '设置SMS验证失败');
    }

    return successResponse(null, 'SMS验证设置成功');
  }

  /**
   * 发送验证码
   */
  @Post('/send-code')
  @ApiOperation({ summary: '发送验证码', description: '发送短信或邮箱验证码' })
  @ApiBody({
    description: '发送参数',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['sms', 'email'], description: '验证码类型' },
        email: { type: 'string', description: '邮箱地址（type=email时必填）' },
      },
    },
  })
  async sendCode(@Body() body: { type: 'sms' | 'email'; email?: string }) {
    const userId = this.ctx.state.user?.userId;
    if (!userId) {
      return errorResponse(ErrorCode.UNAUTHORIZED);
    }

    let result;
    if (body.type === 'sms') {
      result = await this.twoFactorAuthService.sendSMSCode(userId);
    } else if (body.type === 'email' && body.email) {
      result = await this.twoFactorAuthService.sendEmailCode(userId, body.email);
    } else {
      return errorResponse(ErrorCode.INVALID_PARAMS, '参数无效');
    }

    if (!result.success) {
      return errorResponse(ErrorCode.VERIFICATION_CODE_SEND_FAILED, result.error || '发送验证码失败');
    }

    return successResponse(null, '验证码已发送');
  }

  /**
   * 验证并启用 2FA
   */
  @Post('/enable')
  @ApiOperation({ summary: '验证并启用2FA', description: '验证代码后启用双因素认证' })
  @ApiBody({
    description: '验证参数',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '验证码' },
      },
      required: ['code'],
    },
  })
  async enable(@Body() body: { code: string }) {
    const userId = this.ctx.state.user?.userId;
    if (!userId) {
      return errorResponse(ErrorCode.UNAUTHORIZED);
    }

    const result = await this.twoFactorAuthService.verifyAndEnable(userId, body.code);

    if (!result.success) {
      return errorResponse(ErrorCode.VERIFICATION_CODE_ERROR, result.error || '验证失败');
    }

    return successResponse({
      remainingAttempts: result.remainingAttempts,
      lockedUntil: result.lockedUntil,
    }, '2FA已启用');
  }

  /**
   * 验证 2FA 代码
   */
  @Post('/verify')
  @ApiOperation({ summary: '验证2FA代码', description: '验证双因素认证代码' })
  @ApiBody({
    description: '验证参数',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '验证码或备用码' },
      },
      required: ['code'],
    },
  })
  async verify(@Body() body: { code: string }) {
    const userId = this.ctx.state.user?.userId;
    if (!userId) {
      return errorResponse(ErrorCode.UNAUTHORIZED);
    }

    const result = await this.twoFactorAuthService.verify(userId, body.code);

    if (!result.success) {
      return errorResponse(ErrorCode.VERIFICATION_CODE_ERROR, result.error || '验证失败');
    }

    return successResponse({
      remainingAttempts: result.remainingAttempts,
      lockedUntil: result.lockedUntil,
    });
  }

  /**
   * 禁用 2FA
   */
  @Post('/disable')
  @ApiOperation({ summary: '禁用2FA', description: '禁用双因素认证' })
  @ApiBody({
    description: '禁用参数',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '验证码' },
      },
      required: ['code'],
    },
  })
  async disable(@Body() body: { code: string }) {
    const userId = this.ctx.state.user?.userId;
    if (!userId) {
      return errorResponse(ErrorCode.UNAUTHORIZED);
    }

    const result = await this.twoFactorAuthService.disable(userId, body.code);

    if (!result.success) {
      return errorResponse(ErrorCode.VERIFICATION_CODE_ERROR, result.error || '禁用失败');
    }

    return successResponse(null, '2FA已禁用');
  }

  /**
   * 重新生成备用码
   */
  @Post('/backup-codes/regenerate')
  @ApiOperation({ summary: '重新生成备用码', description: '生成新的备用码' })
  async regenerateBackupCodes() {
    const userId = this.ctx.state.user?.userId;
    if (!userId) {
      return errorResponse(ErrorCode.UNAUTHORIZED);
    }

    const backupCodes = await this.twoFactorAuthService.regenerateBackupCodes(userId);

    if (!backupCodes) {
      return errorResponse(ErrorCode.OPERATION_NOT_SUPPORTED, '2FA未启用');
    }

    return successResponse({
      backupCodes,
      message: '请妥善保管这些备用码，每个备用码只能使用一次',
    }, '备用码已重新生成');
  }
}
