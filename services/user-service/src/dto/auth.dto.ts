import { ApiProperty } from '@midwayjs/swagger';
import { LoginType } from '@baby-monitor/shared-types';

/**
 * 登录请求DTO
 */
export class LoginRequestDTO {
  @ApiProperty({ description: '登录类型', enum: LoginType, example: LoginType.PASSWORD })
  type!: LoginType;

  @ApiProperty({ description: '账号（用户名/邮箱/手机号）', example: '18895356792' })
  account!: string;

  @ApiProperty({ description: '密码（密码登录时必填）', example: 'Test123456', required: false })
  password?: string;

  @ApiProperty({ description: '验证码（验证码登录时必填）', example: '123456', required: false })
  code?: string;

  @ApiProperty({ description: '三方提供第商（type=oauth时必填）', example: '123456', required: false })
  oauthProvider?: string;

  @ApiProperty({ description: '第三方token（type=oauth时必填）', example: '123456', required: false })
  oauthToken?: string;
}

/**
 * 注册请求DTO
 */
export class RegisterRequestDTO {
  @ApiProperty({ description: '用户名', example: 'testuser' })
  username!: string;

  @ApiProperty({ description: '邮箱', example: 'test@example.com', required: false })
  email?: string;

  @ApiProperty({ description: '手机号', example: '18895356792', required: false })
  phone?: string;

  @ApiProperty({ description: '密码', example: 'Test123456' })
  password!: string;

  @ApiProperty({ description: '验证码（邮箱/手机注册时需要）', example: '123456', required: false })
  code?: string;

  @ApiProperty({ description: '邀请码', example: 'INVITE123', required: false })
  referralCode?: string;
}

/**
 * 刷新Token请求DTO
 */
export class RefreshTokenRequestDTO {
  @ApiProperty({ description: '刷新令牌', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken!: string;
}

/**
 * 发送验证码请求DTO
 */
export class SendCodeRequestDTO {
  @ApiProperty({ description: '目标（手机号或邮箱）', example: '18895356792' })
  target!: string;

  @ApiProperty({ description: '验证码类型', example: 'login', enum: ['register', 'login', 'reset_password', 'bind_phone', 'bind_email', 'change_phone', 'change_email'] })
  type!: string;

  @ApiProperty({ description: '发送渠道', example: 'sms', enum: ['sms', 'email'] })
  channel!: string;
}

/**
 * 发送密码重置邮件请求DTO
 */
export class SendResetEmailRequestDTO {
  @ApiProperty({ description: '邮箱地址', example: 'test@example.com' })
  email!: string;
}

/**
 * 重置密码请求DTO
 */
export class ResetPasswordRequestDTO {
  @ApiProperty({ description: '账号（邮箱或手机号）', example: '18895356792' })
  account!: string;

  @ApiProperty({ description: '验证码', example: '123456' })
  code!: string;

  @ApiProperty({ description: '新密码', example: 'NewPassword123' })
  newPassword!: string;
}

/**
 * 修改密码请求DTO
 */
export class ChangePasswordRequestDTO {
  @ApiProperty({ description: '旧密码', example: 'OldPassword123' })
  oldPassword!: string;

  @ApiProperty({ description: '新密码', example: 'NewPassword123' })
  newPassword!: string;
}

/**
 * 上传头像请求DTO
 */
export class UploadAvatarRequestDTO {
  @ApiProperty({ description: '头像URL', example: 'https://example.com/avatar.jpg' })
  avatarUrl!: string;
}

/**
 * 更新用户资料请求DTO
 */
export class UpdateProfileRequestDTO {
  @ApiProperty({ description: '昵称', example: '张三', required: false })
  nickname?: string;

  @ApiProperty({ description: '性别', example: 'male', enum: ['male', 'female', 'other'], required: false })
  gender?: 'male' | 'female' | 'other';

  @ApiProperty({ description: '出生日期', example: '1990-01-01', required: false })
  birthDate?: Date;

  @ApiProperty({ description: '位置', example: '北京市', required: false })
  location?: string;

  @ApiProperty({ description: '个人简介', example: '这是我的个人简介', required: false })
  bio?: string;
}

/**
 * 删除账户请求DTO
 */
export class DeleteAccountRequestDTO {
  @ApiProperty({ description: '确认密码', example: 'Test123456' })
  password!: string;
}

/**
 * 绑定设备请求DTO
 */
export class BindDeviceRequestDTO {
  @ApiProperty({ description: '设备名称', example: '客厅摄像头', required: false })
  deviceName?: string;

  @ApiProperty({ description: '用户角色', example: 'owner', enum: ['owner', 'admin', 'viewer'], required: false })
  role?: 'owner' | 'admin' | 'viewer';
}

/**
 * 提交反馈请求DTO
 */
export class SubmitFeedbackRequestDTO {
  @ApiProperty({ description: '反馈类型', example: 'bug', enum: ['bug', 'feature', 'complaint', 'other'] })
  type!: 'bug' | 'feature' | 'complaint' | 'other';

  @ApiProperty({ description: '标题', example: '发现一个Bug' })
  title!: string;

  @ApiProperty({ description: '内容', example: '详细描述问题...' })
  content!: string;

  @ApiProperty({ description: '附件URL列表', example: ['https://example.com/screenshot.jpg'], required: false })
  attachments?: string[];
}
