/**
 * User Service - 类型定义
 * 用户服务相关的类型定义，包括用户信息、认证授权、验证码、会话管理等
 */

// ============ 用户角色 ============
/**
 * 用户角色枚举
 * 定义用户在系统中的权限级别
 */
export enum UserRole {
  /** 管理员 - 拥有系统所有权限 */
  ADMIN = 'admin',
  /** 普通用户 - 拥有基本操作权限 */
  USER = 'user',
  /** 访客 - 只有只读权限 */
  GUEST = 'guest',
}

/**
 * 用户状态枚举
 * 定义用户账户在系统中的状态
 */
export enum UserStatus {
  /** 活跃 - 账户正常可用 */
  ACTIVE = 'active',
  /** 未激活 - 账户创建后尚未激活 */
  INACTIVE = 'inactive',
  /** 已封禁 - 账户因违规被封禁 */
  BANNED = 'banned',
  /** 待激活 - 账号等待用户激活（如邮箱验证） */
  PENDING = 'pending',
  /** 已锁定 - 账户因多次登录失败等原因被锁定 */
  LOCKED = 'locked',
}

/**
 * 登录类型枚举
 * 定义支持的用户登录方式
 */
export enum LoginType {
  /** 密码登录 - 使用用户名/邮箱/手机号 + 密码 */
  PASSWORD = 'password',
  /** 短信验证码登录 - 使用手机号 + 短信验证码 */
  SMS_CODE = 'sms_code',
  /** 邮箱验证码登录 - 使用邮箱 + 邮箱验证码 */
  EMAIL_CODE = 'email_code',
  /** 第三方登录 - 使用微信、QQ等第三方账号 */
  THIRD_PARTY = 'third_party',
}

/**
 * 第三方登录提供商枚举
 * 定义支持的第三方登录平台
 */
export enum ThirdPartyProvider {
  /** 微信 */
  WECHAT = 'wechat',
  /** QQ */
  QQ = 'qq',
  /** 支付宝 */
  ALIPAY = 'alipay',
  /** 微博 */
  WEIBO = 'weibo',
  /** GitHub */
  GITHUB = 'github',
  /** Google */
  GOOGLE = 'google',
  /** Facebook */
  FACEBOOK = 'facebook',
  /** 钉钉 */
  DINGTALK = 'dingtalk',
  /** 飞书 */
  FEISHU = 'feishu',
  /** Apple */
  APPLE = 'apple',
}

/**
 * 用户信息
 * 定义系统用户的完整属性
 */
export interface User {
  /** 用户唯一标识ID */
  id: string;
  /** 用户名 - 唯一标识，用于登录 */
  username: string;
  /** 邮箱地址（可选） */
  email?: string;
  /** 手机号码（可选） */
  phone?: string;
  /** 密码哈希值 - 加密后的密码（可选，第三方登录用户可能没有） */
  passwordHash?: string;
  /** 昵称 - 用户显示名称（可选） */
  nickname?: string;
  /** 头像URL（可选） */
  avatar?: string;
  /** 性别（可选） */
  gender?: 'male' | 'female' | 'other';
  /** 出生日期（可选） */
  birthDate?: Date;
  /** 所在地区（可选） */
  location?: string;
  /** 个人简介（可选） */
  bio?: string;
  /** 用户角色 */
  role: UserRole;
  /** 用户状态 */
  status: UserStatus;
  /** 邮箱是否已验证 */
  emailVerified: boolean;
  /** 手机号是否已验证 */
  phoneVerified: boolean;
  /** 最后登录时间（可选） */
  lastLoginAt?: Date;
  /** 最后登录IP地址（可选） */
  lastLoginIp?: string;
  /** 账户创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

/**
 * 用户档案
 * 用户可编辑的个人资料信息
 */
export interface UserProfile {
  /** 关联的用户ID */
  userId: string;
  /** 昵称（可选） */
  nickname?: string;
  /** 头像URL（可选） */
  avatar?: string;
  /** 性别（可选） */
  gender?: 'male' | 'female' | 'other';
  /** 出生日期（可选） */
  birthDate?: Date;
  /** 所在地区（可选） */
  location?: string;
  /** 个人简介（可选） */
  bio?: string;
  /** 用户偏好设置（可选） */
  preferences?: {
    /** 语言设置 */
    language?: string;
    /** 时区设置 */
    timezone?: string;
    /** 通知设置 */
    notifications?: {
      /** 邮件通知开关 */
      email?: boolean;
      /** 短信通知开关 */
      sms?: boolean;
      /** 推送通知开关 */
      push?: boolean;
    };
  };
}

// ============ 认证相关 ============
/**
 * 登录请求
 * 用户登录时提交的请求参数
 */
export interface LoginRequest {
  /** 登录类型 */
  type: LoginType;
  /** 账号 - 用户名/邮箱/手机号 */
  account: string;
  /** 密码 - 密码登录时必填（可选） */
  password?: string;
  /** 验证码 - 验证码登录时必填（可选） */
  code?: string;
  /** 第三方登录数据 - 第三方登录时必填（可选） */
  thirdPartyData?: ThirdPartyAuthData;
}

/**
 * 第三方认证数据
 * 第三方登录时的认证信息
 */
export interface ThirdPartyAuthData {
  /** 第三方平台类型 */
  provider: ThirdPartyProvider;
  /** OpenID - 第三方平台的用户唯一标识（可选） */
  openId?: string;
  /** 访问令牌 - 用于调用第三方API（可选） */
  accessToken?: string;
  /** UnionID - 用于同一厂商多应用账号互通（可选） */
  unionId?: string;
  /** OAuth授权码 - 用于OAuth回调流程（可选） */
  code?: string;
  /** OAuth状态参数 - 防止CSRF攻击（可选） */
  state?: string;
}

/**
 * 注册请求
 * 用户注册时提交的请求参数
 */
export interface RegisterRequest {
  /** 用户名 - 必填，用于登录 */
  username: string;
  /** 邮箱地址（可选） */
  email?: string;
  /** 手机号码（可选） */
  phone?: string;
  /** 密码 - 必填 */
  password: string;
  /** 验证码 - 邮箱/手机注册时需要（可选） */
  code?: string;
  /** 邀请码 - 用于推荐奖励（可选） */
  referralCode?: string;
}

/**
 * 登录响应
 * 登录成功后返回的数据
 */
export interface LoginResponse {
  /** 用户信息 */
  user: User;
  /** 访问令牌 - 用于API认证 */
  accessToken: string;
  /** 刷新令牌 - 用于获取新的访问令牌 */
  refreshToken: string;
  /** 访问令牌过期时间 - 单位秒 */
  expiresIn: number;
}

/**
 * 刷新令牌响应
 * 使用刷新令牌获取新访问令牌的响应
 */
export interface RefreshTokenResponse {
  /** 新的访问令牌 */
  accessToken: string;
  /** 新的刷新令牌 */
  refreshToken: string;
  /** 访问令牌过期时间 - 单位秒 */
  expiresIn: number;
}

// ============ 验证码相关 ============
/**
 * 验证码类型枚举
 * 定义验证码的使用场景
 */
export enum VerificationCodeType {
  /** 注册验证码 - 用户注册时验证邮箱或手机 */
  REGISTER = 'register',
  /** 登录验证码 - 验证码登录时使用 */
  LOGIN = 'login',
  /** 重置密码验证码 - 找回密码时使用 */
  RESET_PASSWORD = 'reset_password',
  /** 绑定手机验证码 - 绑定手机号时使用 */
  BIND_PHONE = 'bind_phone',
  /** 绑定邮箱验证码 - 绑定邮箱时使用 */
  BIND_EMAIL = 'bind_email',
  /** 更换手机验证码 - 更换手机号时使用 */
  CHANGE_PHONE = 'change_phone',
  /** 更换邮箱验证码 - 更换邮箱时使用 */
  CHANGE_EMAIL = 'change_email',
}

/**
 * 验证码发送渠道枚举
 * 定义验证码的发送方式
 */
export enum VerificationCodeChannel {
  /** 短信渠道 */
  SMS = 'sms',
  /** 邮件渠道 */
  EMAIL = 'email',
}

/**
 * 验证码
 * 验证码记录的完整信息
 */
export interface VerificationCode {
  /** 验证码记录唯一ID */
  id: string;
  /** 验证码内容 */
  code: string;
  /** 验证码类型 */
  type: VerificationCodeType;
  /** 发送渠道 */
  channel: VerificationCodeChannel;
  /** 目标地址 - 手机号或邮箱地址 */
  target: string;
  /** 过期时间 */
  expiresAt: Date;
  /** 是否已使用 */
  used: boolean;
  /** 创建时间 */
  createdAt: Date;
}

// ============ 密码相关 ============
/**
 * 密码重置请求
 * 用户通过验证码重置密码
 */
export interface PasswordResetRequest {
  /** 账号 - 邮箱或手机号 */
  account: string;
  /** 验证码 */
  code: string;
  /** 新密码 */
  newPassword: string;
}

/**
 * 密码修改请求
 * 已登录用户修改密码
 */
export interface PasswordChangeRequest {
  /** 原密码 */
  oldPassword: string;
  /** 新密码 */
  newPassword: string;
}

// ============ 用户设备相关 ============
/**
 * 用户设备绑定关系
 * 记录用户与设备的绑定关系和权限
 */
export interface UserDevice {
  /** 绑定关系唯一ID */
  id: string;
  /** 用户ID */
  userId: string;
  /** 设备ID */
  deviceId: string;
  /** 设备自定义名称（可选） */
  deviceName?: string;
  /** 用户角色 - 定义用户对设备的操作权限 */
  role: 'owner' | 'admin' | 'viewer';
  /** 权限列表 - 具体的操作权限 */
  permissions: string[];
  /** 是否为共享设备 - 通过分享获得访问权 */
  isShared: boolean;
  /** 分享人ID - 设备所有者的用户ID（可选） */
  sharedBy?: string;
  /** 分享时间（可选） */
  sharedAt?: Date;
  /** 绑定时间 */
  createdAt: Date;
}

/**
 * 用户会话
 * 记录用户的登录会话信息，用于会话管理
 */
export interface UserSession {
  /** 会话唯一ID */
  id: string;
  /** 用户ID */
  userId: string;
  /** 设备类型 - 登录终端的类型 */
  deviceType: 'web' | 'ios' | 'android' | 'desktop';
  /** 设备信息 - 浏览器、操作系统版本等（可选） */
  deviceInfo?: string;
  /** IP地址 */
  ip: string;
  /** 地理位置 - 根据IP解析的地理位置（可选） */
  location?: string;
  /** 最后活跃时间 */
  lastActiveAt: Date;
  /** 会话创建时间 */
  createdAt: Date;
}

// ============ 第三方登录相关 ============
/**
 * 第三方账号绑定
 * 记录用户与第三方账号的绑定关系
 */
export interface ThirdPartyBinding {
  /** 绑定关系唯一ID */
  id: string;
  /** 用户ID */
  userId: string;
  /** 第三方平台类型 */
  provider: ThirdPartyProvider;
  /** 第三方平台OpenID */
  openId: string;
  /** 第三方平台UnionID - 用于多应用账号互通（可选） */
  unionId?: string;
  /** 第三方平台用户信息（可选） */
  userInfo?: Record<string, any>;
  /** 绑定时间 */
  bindAt: Date;
}

// ============ 操作日志相关 ============
/**
 * 用户操作类型枚举
 * 定义需要记录的用户操作
 */
export enum UserActionType {
  /** 注册 */
  REGISTER = 'register',
  /** 登录 */
  LOGIN = 'login',
  /** 登出 */
  LOGOUT = 'logout',
  /** 更新资料 */
  UPDATE_PROFILE = 'update_profile',
  /** 修改密码 */
  CHANGE_PASSWORD = 'change_password',
  /** 重置密码 */
  RESET_PASSWORD = 'reset_password',
  /** 绑定设备 */
  BIND_DEVICE = 'bind_device',
  /** 解绑设备 */
  UNBIND_DEVICE = 'unbind_device',
  /** 绑定第三方账号 */
  BIND_THIRD_PARTY = 'bind_third_party',
  /** 解绑第三方账号 */
  UNBIND_THIRD_PARTY = 'unbind_third_party',
  /** 删除账户 */
  DELETE_ACCOUNT = 'delete_account',
}

/**
 * 用户操作日志
 * 记录用户的重要操作行为，用于审计和安全追溯
 */
export interface UserActionLog {
  /** 日志唯一ID */
  id: string;
  /** 用户ID */
  userId: string;
  /** 操作类型 */
  action: UserActionType;
  /** 操作详情 - 额外的上下文信息（可选） */
  details?: Record<string, any>;
  /** 操作来源IP地址 */
  ip: string;
  /** 用户代理字符串 - 浏览器信息等（可选） */
  userAgent?: string;
  /** 操作时间 */
  createdAt: Date;
}

// ============ 家庭成员相关 ============
/**
 * 家庭成员
 * 记录用户在家庭组中的成员信息
 */
export interface FamilyMember {
  /** 成员记录唯一ID */
  id: string;
  /** 家庭组ID */
  familyId: string;
  /** 用户ID */
  userId: string;
  /** 成员角色 - 定义在家庭中的权限级别 */
  role: 'owner' | 'admin' | 'member';
  /** 权限列表 - 具体的操作权限 */
  permissions: string[];
  /** 邀请人ID - 发送邀请的用户ID（可选） */
  invitedBy?: string;
  /** 加入时间 */
  joinedAt: Date;
}

/**
 * 家庭邀请
 * 记录家庭组邀请信息
 */
export interface FamilyInvitation {
  /** 邀请记录唯一ID */
  id: string;
  /** 家庭组ID */
  familyId: string;
  /** 邀请码 - 用于接受邀请的唯一码 */
  inviteCode: string;
  /** 邀请人ID */
  inviterId: string;
  /** 被邀请人邮箱（可选） */
  inviteeEmail?: string;
  /** 被邀请人手机号（可选） */
  inviteePhone?: string;
  /** 邀请角色 - 被邀请人在家庭中的角色 */
  role: 'admin' | 'member';
  /** 邀请状态 */
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  /** 过期时间 */
  expiresAt: Date;
  /** 接受时间（可选） */
  acceptedAt?: Date;
  /** 创建时间 */
  createdAt: Date;
}

// ============ 用户偏好设置 ============
/**
 * 用户偏好设置
 * 存储用户的个性化设置
 */
export interface UserPreferences {
  /** 用户ID */
  userId: string;
  /** 通知设置 */
  notifications: {
    /** 邮件通知开关 */
    email: boolean;
    /** 短信通知开关 */
    sms: boolean;
    /** 推送通知开关 */
    push: boolean;
    /** 设备告警通知开关 */
    deviceAlert: boolean;
  };
  /** 语言设置 - 如 zh-CN、en-US */
  language: string;
  /** 时区设置 - 如 Asia/Shanghai */
  timezone: string;
  /** 主题设置 */
  theme: 'light' | 'dark' | 'auto';
  /** 隐私设置 */
  privacy: {
    /** 是否允许数据共享 */
    shareData: boolean;
    /** 是否允许数据分析 */
    allowAnalytics: boolean;
  };
}

// ============ 用户反馈 ============
/**
 * 用户反馈
 * 记录用户提交的意见反馈
 */
export interface UserFeedback {
  /** 反馈记录唯一ID */
  id: string;
  /** 提交反馈的用户ID */
  userId: string;
  /** 反馈类型 */
  type: 'bug' | 'feature' | 'complaint' | 'other';
  /** 反馈标题 */
  title: string;
  /** 反馈内容 */
  content: string;
  /** 附件列表 - 截图、日志文件等（可选） */
  attachments?: string[];
  /** 处理状态 */
  status: 'pending' | 'processing' | 'resolved' | 'closed';
  /** 官方回复（可选） */
  reply?: string;
  /** 提交时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

// ============ API响应 ============
/**
 * 认证响应
 * 认证相关接口的响应格式
 */
export interface AuthResponse {
  /** 请求是否成功 */
  success: boolean;
  /** 登录成功后的数据（可选） */
  data?: LoginResponse;
  /** 错误信息（可选） */
  error?: {
    /** 错误码 */
    code: string;
    /** 错误消息 */
    message: string;
  };
}

/**
 * 用户信息响应
 * 获取用户信息接口的响应格式
 */
export interface UserInfoResponse {
  /** 用户信息 - 不包含密码哈希 */
  user: Omit<User, 'passwordHash'>;
  /** 用户档案（可选） */
  profile?: UserProfile;
  /** 用户设备列表（可选） */
  devices?: UserDevice[];
  /** 用户会话列表（可选） */
  sessions?: UserSession[];
}
