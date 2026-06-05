import { ApiProperty } from '@midwayjs/swagger';

/**
 * 通用成功响应结构
 */
export class ApiResponseDto<T = any> {
  @ApiProperty({ description: '是否成功', example: true })
  success!: boolean;

  @ApiProperty({ description: '响应消息', required: false })
  message?: string;

  @ApiProperty({ description: '响应数据', required: false })
  data?: T;
}

/**
 * 错误响应结构
 */
export class ErrorResponseDto {
  @ApiProperty({ description: '是否成功', example: false })
  success!: false;

  @ApiProperty({ description: '错误信息', required: false })
  error?: {
    code: string;
    message: string;
  };
}

/**
 * 用户信息
 */
export class UserInfoDto {
  @ApiProperty({ description: '用户ID', example: 'user-123' })
  userId!: string;

  @ApiProperty({ description: '用户名', example: 'john_doe' })
  username!: string;

  @ApiProperty({ description: '邮箱', example: 'john@example.com', required: false })
  email?: string;

  @ApiProperty({ description: '手机号', example: '+86138****1234', required: false })
  phone?: string;

  @ApiProperty({ description: '头像URL', example: 'https://example.com/avatar.jpg', required: false })
  avatar?: string;

  @ApiProperty({ description: '昵称', example: 'John', required: false })
  nickname?: string;

  @ApiProperty({ description: '角色', example: 'user', required: false })
  role?: string;
}

/**
 * 登录响应数据
 */
export class LoginResponseDataDto {
  @ApiProperty({ description: '用户信息', type: UserInfoDto })
  user!: UserInfoDto;

  @ApiProperty({ description: '访问令牌', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ description: '刷新令牌', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken!: string;

  @ApiProperty({ description: '过期时间（秒）', example: 7200 })
  expiresIn!: number;

  @ApiProperty({ description: '是否新用户', example: false, required: false })
  isNewUser?: boolean;
}

/**
 * 刷新Token响应数据
 */
export class RefreshTokenDataDto {
  @ApiProperty({ description: '新的访问令牌', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ description: '过期时间（秒）', example: 7200 })
  expiresIn!: number;
}

/**
 * 用户资料数据
 */
export class UserProfileDto {
  @ApiProperty({ description: '用户ID', example: 'user-123' })
  userId!: string;

  @ApiProperty({ description: '用户名', example: 'john_doe' })
  username!: string;

  @ApiProperty({ description: '昵称', required: false })
  nickname?: string;

  @ApiProperty({ description: '个人简介', required: false })
  bio?: string;

  @ApiProperty({ description: '性别', enum: ['male', 'female', 'other'], required: false })
  gender?: string;

  @ApiProperty({ description: '生日', required: false })
  birthdate?: string;

  @ApiProperty({ description: '所在地', required: false })
  location?: string;

  @ApiProperty({ description: '头像', required: false })
  avatar?: string;
}

/**
 * 用户设备
 */
export class UserDeviceDto {
  @ApiProperty({ description: '设备ID', example: 'device-123' })
  deviceId!: string;

  @ApiProperty({ description: '用户ID', example: 'user-123' })
  userId!: string;

  @ApiProperty({ description: '设备名称', example: '卧室摄像头' })
  deviceName!: string;

  @ApiProperty({ description: '用户角色', enum: ['owner', 'admin', 'member', 'guest'], example: 'owner' })
  role!: string;

  @ApiProperty({ description: '绑定时间', example: '2024-01-01T00:00:00.000Z' })
  createdAt!: string;
}

/**
 * 用户会话
 */
export class UserSessionDto {
  @ApiProperty({ description: '会话ID', example: 'session-123' })
  sessionId!: string;

  @ApiProperty({ description: '用户ID', example: 'user-123' })
  userId!: string;

  @ApiProperty({ description: '设备信息', example: 'Mozilla/5.0...' })
  userAgent!: string;

  @ApiProperty({ description: 'IP地址', example: '192.168.1.1' })
  ip!: string;

  @ApiProperty({ description: '登录时间', example: '2024-01-01T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ description: '最后活跃时间', example: '2024-01-01T01:00:00.000Z' })
  lastActiveAt!: string;
}

/**
 * 分页响应
 */
export class PaginatedResponseDto<T = any> {
  @ApiProperty({ description: '数据列表', type: 'array' })
  list!: T[];

  @ApiProperty({ description: '总数', example: 100 })
  total!: number;

  @ApiProperty({ description: '当前页', example: 1 })
  page!: number;

  @ApiProperty({ description: '每页数量', example: 20 })
  pageSize!: number;

  @ApiProperty({ description: '总页数', example: 5 })
  totalPages!: number;
}
