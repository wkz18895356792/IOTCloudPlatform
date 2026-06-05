/**
 * 通用类型定义
 * 包含API响应结构、错误码等通用类型
 */

// ============ 统一API响应结构 ============

/**
 * 标准API响应
 * 所有API接口的统一响应格式
 * code: 0 表示成功，其他值表示失败
 */
export interface ApiResponse<T = any> {
  /** 响应状态码 - 0表示成功，非0表示失败 */
  code: number;
  /** 响应数据 - 成功时返回的数据（可选） */
  data?: T;
  /** 响应消息 - 操作结果的描述信息 */
  message: string;
  /** 响应时间戳 - 服务器响应时间（可选） */
  timestamp?: number;
}

/**
 * 分页请求参数
 * 用于分页查询的通用参数结构
 */
export interface PaginationParams {
  /** 当前页码 - 从1开始计数 */
  page: number;
  /** 每页数量 - 单页返回的记录数 */
  pageSize: number;
  /** 排序字段 - 用于排序的属性名（可选） */
  sortBy?: string;
  /** 排序方向 - asc升序或desc降序（可选） */
  sortOrder?: 'asc' | 'desc';
}

/**
 * 分页数据结构
 * 分页查询返回的数据容器
 */
export interface PaginatedData<T> {
  /** 数据列表 - 当前页的数据项 */
  items: T[];
  /** 总记录数 - 符合条件的全部记录数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 总页数 - 根据总记录数和每页数量计算得出 */
  totalPages: number;
}

/**
 * 分页响应
 * 组合了标准响应格式和分页数据的类型
 */
export type PaginatedResponse<T> = ApiResponse<PaginatedData<T>>;

// ============ 标准错误码 ============

/**
 * 错误码枚举
 * 统一定义系统中所有可能的错误类型
 *
 * 错误码分类规则：
 * 0: 成功
 * 1xxx: 通用错误 - 参数、资源、限流等
 * 2xxx: 认证授权错误 - 登录、Token、权限等
 * 3xxx: 用户相关错误 - 用户信息、验证码等
 * 4xxx: 设备相关错误 - 设备管理、控制等
 * 5xxx: 宝宝相关错误 - 宝宝档案、记录等
 * 9xxx: 服务器错误 - 后端服务异常
 */
export enum ErrorCode {
  // ============ 成功 ============
  /** 操作成功 */
  SUCCESS = 0,

  // ============ 通用错误 (1xxx) ============
  /** 未知错误 - 未预期的错误情况 */
  UNKNOWN_ERROR = 1000,
  /** 无效的请求 - HTTP请求格式或方法错误 */
  INVALID_REQUEST = 1001,
  /** 参数错误 - 请求参数不符合规则 */
  INVALID_PARAMS = 1002,
  /** 缺少必要参数 - 必填参数未提供 */
  MISSING_REQUIRED_PARAMS = 1003,
  /** 请求过于频繁 - 触发接口限流 */
  RATE_LIMIT_EXCEEDED = 1004,
  /** 操作过于频繁 - 触发业务操作频率限制 */
  OPERATION_TOO_FREQUENT = 1005,
  /** 资源不存在 - 请求的资源未找到 */
  RESOURCE_NOT_FOUND = 1006,
  /** 资源已存在 - 创建资源时唯一键冲突 */
  RESOURCE_ALREADY_EXISTS = 1007,
  /** 资源冲突 - 资源状态不允许当前操作 */
  RESOURCE_CONFLICT = 1008,
  /** 格式错误 - 数据格式不符合要求 */
  INVALID_FORMAT = 1009,
  /** 文件过大 - 上传文件超过大小限制 */
  FILE_TOO_LARGE = 1010,
  /** 不支持的文件类型 - 文件格式不在白名单内 */
  FILE_TYPE_NOT_ALLOWED = 1011,
  /** 操作超时 - 请求处理时间过长 */
  OPERATION_TIMEOUT = 1012,
  /** 不支持的操作 - 当前功能未实现或已禁用 */
  OPERATION_NOT_SUPPORTED = 1013,

  // ============ 认证授权错误 (2xxx) ============
  /** 未授权 - 未提供有效的身份凭证 */
  UNAUTHORIZED = 2000,
  /** Token无效 - JWT Token格式错误或已被篡改 */
  TOKEN_INVALID = 2001,
  /** Token已过期 - JWT Token超过有效期 */
  TOKEN_EXPIRED = 2002,
  /** Token缺失 - 请求头未携带Token */
  TOKEN_MISSING = 2003,
  /** 登录失败 - 综合登录失败错误 */
  LOGIN_FAILED = 2004,
  /** 用户名或密码错误 - 密码登录凭证错误 */
  LOGIN_PASSWORD_ERROR = 2005,
  /** 验证码错误 - 验证码登录时验证码错误 */
  LOGIN_CODE_ERROR = 2006,
  /** 验证码已过期 - 验证码超过有效期 */
  LOGIN_CODE_EXPIRED = 2007,
  /** 注册失败 - 综合注册失败错误 */
  REGISTER_FAILED = 2008,
  /** 权限不足 - 当前用户无权执行该操作 */
  PERMISSION_DENIED = 2009,
  /** 账号已禁用 - 账号被管理员禁用 */
  ACCOUNT_DISABLED = 2010,
  /** 账号已锁定 - 多次登录失败导致账号锁定 */
  ACCOUNT_LOCKED = 2011,
  /** 账号已被封禁 - 账号因违规被封禁 */
  ACCOUNT_BANNED = 2012,
  /** 账号待激活 - 账号注册后尚未激活 */
  ACCOUNT_PENDING = 2013,
  /** 会话已过期 - 用户会话超时 */
  SESSION_EXPIRED = 2014,
  /** 刷新令牌无效 - Refresh Token无效或已过期 */
  REFRESH_TOKEN_INVALID = 2015,
  /** 验证失败 - 签名或其他验证失败 */
  VERIFICATION_FAILED = 2016,
  /** 不支持的登录方式 - 第三方登录提供商不支持 */
  UNSUPPORTED_PROVIDER = 2017,
  /** 第三方登录回调失败 - OAuth回调处理失败 */
  OAUTH_CALLBACK_FAILED = 2018,
  /** 账号解绑失败 - 第三方账号解绑失败 */
  UNBIND_FAILED = 2019,

  // ============ 用户相关错误 (3xxx) ============
  /** 用户不存在 - 指定用户ID的用户不存在 */
  USER_NOT_FOUND = 3000,
  /** 用户已存在 - 用户ID冲突 */
  USER_ALREADY_EXISTS = 3001,
  /** 用户名已存在 - 用户名重复 */
  USERNAME_ALREADY_EXISTS = 3002,
  /** 邮箱已被注册 - 邮箱已被其他账号使用 */
  EMAIL_ALREADY_EXISTS = 3003,
  /** 手机号已被注册 - 手机号已被其他账号使用 */
  PHONE_ALREADY_EXISTS = 3004,
  /** 用户名格式错误 - 用户名不符合命名规则 */
  USERNAME_INVALID = 3005,
  /** 邮箱格式错误 - 邮箱地址格式不正确 */
  EMAIL_INVALID = 3006,
  /** 手机号格式错误 - 手机号格式不正确 */
  PHONE_INVALID = 3007,
  /** 密码强度不足 - 密码不符合安全要求 */
  PASSWORD_TOO_WEAK = 3008,
  /** 新密码不能与旧密码相同 - 修改密码时新密码与旧密码重复 */
  PASSWORD_SAME_AS_OLD = 3009,
  /** 密码错误 - 当前密码不正确 */
  PASSWORD_INCORRECT = 3010,
  /** 邮箱未验证 - 邮箱地址尚未通过验证 */
  EMAIL_NOT_VERIFIED = 3011,
  /** 手机号未验证 - 手机号尚未通过验证 */
  PHONE_NOT_VERIFIED = 3012,
  /** 验证码错误 - 输入的验证码不正确 */
  VERIFICATION_CODE_ERROR = 3013,
  /** 验证码已过期 - 验证码超过有效期 */
  VERIFICATION_CODE_EXPIRED = 3014,
  /** 验证码发送失败 - 短信或邮件服务异常 */
  VERIFICATION_CODE_SEND_FAILED = 3015,
  /** 验证码发送过于频繁 - 短信发送频率超限 */
  VERIFICATION_CODE_SEND_TOO_FREQUENT = 3016,
  /** 个人资料更新失败 - 用户信息保存失败 */
  PROFILE_UPDATE_FAILED = 3017,
  /** 头像上传失败 - 头像文件上传或处理失败 */
  AVATAR_UPLOAD_FAILED = 3018,
  /** 设备绑定失败 - 用户与设备绑定关系创建失败 */
  DEVICE_BIND_FAILED = 3019,
  /** 设备已绑定 - 设备已与其他用户绑定 */
  DEVICE_ALREADY_BOUND = 3020,
  /** 设备未绑定 - 用户未绑定该设备 */
  DEVICE_NOT_BOUND = 3021,
  /** 第三方账号绑定失败 - 第三方账号绑定过程失败 */
  THIRD_PARTY_BIND_FAILED = 3022,
  /** 第三方账号已绑定 - 该第三方账号已绑定其他用户 */
  THIRD_PARTY_ALREADY_BOUND = 3023,
  /** 邀请码无效 - 邀请码格式错误或不存在 */
  INVITE_CODE_INVALID = 3024,
  /** 邀请码已过期 - 邀请码超过有效期或使用次数上限 */
  INVITE_CODE_EXPIRED = 3025,
  /** 家庭成员数量已达上限 - 家庭组人数超过限制 */
  FAMILY_MEMBER_LIMIT_EXCEEDED = 3026,
  /** 面容ID登录已开通 - 面容ID登录功能已启用 */
  FACE_ID_ALREADY_ENABLED = 3027,
  /** 面容ID登录未开通 - 面容ID登录功能未启用 */
  FACE_ID_NOT_ENABLED = 3028,
  /** 面容ID验证失败 - 面容识别验证未通过 */
  FACE_ID_VERIFY_FAILED = 3029,
  /** 设备不支持面容ID - 设备不支持生物识别功能 */
  FACE_ID_NOT_SUPPORTED = 3030,

  // ============ 设备相关错误 (4xxx) ============
  /** 设备不存在 - 指定设备ID不存在 */
  DEVICE_NOT_FOUND = 4000,
  /** 设备离线 - 设备未连接到网络 */
  DEVICE_OFFLINE = 4001,
  /** 设备未授权 - 设备认证失败或被禁用 */
  DEVICE_UNAUTHORIZED = 4002,
  /** 设备忙碌 - 设备正在执行其他任务 */
  DEVICE_BUSY = 4003,
  /** 设备固件版本过低 - 设备需要升级才能正常使用 */
  DEVICE_FIRMWARE_OUTDATED = 4004,
  /** 设备正在更新 - 设备正在进行固件升级 */
  DEVICE_UPDATING = 4005,
  /** 设备命令执行失败 - 控制命令执行异常 */
  DEVICE_COMMAND_FAILED = 4006,
  /** 设备命令执行超时 - 控制命令无响应 */
  DEVICE_COMMAND_TIMEOUT = 4007,
  /** 用户未绑定该设备 - 用户无权控制该设备 */
  DEVICE_NOT_BOUND_BY_USER = 4008,
  /** 设备已注册 - 设备序列号已被注册 */
  DEVICE_ALREADY_REGISTERED = 4009,
  /** 设备注册失败 - 设备首次接入注册失败 */
  DEVICE_REGISTER_FAILED = 4010,
  /** 设备升级失败 - 固件升级过程失败 */
  DEVICE_UPGRADE_FAILED = 4011,
  /** 已是最新版本 - 没有可升级的新版本 */
  DEVICE_UPGRADE_NO_NEW_VERSION = 4012,
  /** 启动流失败 - 视频流启动失败 */
  STREAM_START_FAILED = 4013,
  /** 流已启动 - 视频流已经在运行中 */
  STREAM_ALREADY_STARTED = 4014,
  /** 流未启动 - 没有活跃的视频流 */
  STREAM_NOT_STARTED = 4015,
  /** 录制失败 - 视频录制失败 */
  RECORDING_FAILED = 4016,
  /** 存储空间不足 - 云存储配额已用完 */
  STORAGE_QUOTA_EXCEEDED = 4017,
  /** 录制未找到 - 指定录制ID不存在 */
  RECORDING_NOT_FOUND = 4018,
  /** 录制上传已过期 - 预签名URL已过期 */
  RECORDING_UPLOAD_EXPIRED = 4019,
  /** 录制分片上传无效 - 分片信息不匹配 */
  RECORDING_MULTIPART_INVALID = 4020,

  // ============ 宝宝相关错误 (5xxx) ============
  /** 宝宝信息不存在 - 指定宝宝ID不存在 */
  BABY_NOT_FOUND = 5000,
  /** 宝宝信息已存在 - 同一家庭中宝宝档案已存在 */
  BABY_PROFILE_EXISTS = 5001,
  /** 宝宝记录不存在 - 指定记录ID不存在 */
  BABY_RECORD_NOT_FOUND = 5002,
  /** 成长记录创建失败 - 身高体重等记录保存失败 */
  GROWTH_RECORD_CREATE_FAILED = 5003,
  /** 健康记录创建失败 - 生病就医等记录保存失败 */
  HEALTH_RECORD_CREATE_FAILED = 5004,
  /** 喂养记录创建失败 - 喂奶等记录保存失败 */
  FEEDING_RECORD_CREATE_FAILED = 5005,
  /** 睡眠记录创建失败 - 睡眠记录保存失败 */
  SLEEP_RECORD_CREATE_FAILED = 5006,
  /** 换尿布记录创建失败 - 尿布记录保存失败 */
  DIAPER_RECORD_CREATE_FAILED = 5007,
  /** 疫苗记录创建失败 - 疫苗接种记录保存失败 */
  VACCINE_RECORD_CREATE_FAILED = 5008,

  // ============ 服务器错误 (9xxx) ============
  /** 服务器内部错误 - 未预期的后端异常 */
  INTERNAL_SERVER_ERROR = 9000,
  /** 数据库错误 - 数据库操作异常 */
  DATABASE_ERROR = 9001,
  /** 缓存错误 - Redis操作异常 */
  REDIS_ERROR = 9002,
  /** 消息队列错误 - MQTT服务异常 */
  MQTT_ERROR = 9003,
  /** 短信服务错误 - 短信发送服务异常 */
  SMS_SERVICE_ERROR = 9004,
  /** 邮件服务错误 - 邮件发送服务异常 */
  EMAIL_SERVICE_ERROR = 9005,
  /** 存储服务错误 - 对象存储服务异常 */
  STORAGE_SERVICE_ERROR = 9006,
  /** 第三方服务错误 - 外部API调用失败 */
  THIRD_PARTY_SERVICE_ERROR = 9007,
  /** 配置错误 - 服务器配置异常 */
  CONFIGURATION_ERROR = 9008,
}

// ============ 错误信息映射 ============

/**
 * 错误码对应的默认中文错误信息
 * 提供用户友好的错误描述
 */
export const ErrorMessages: Record<ErrorCode, string> = {
  // 成功
  [ErrorCode.SUCCESS]: '操作成功',

  // 通用错误
  [ErrorCode.UNKNOWN_ERROR]: '未知错误',
  [ErrorCode.INVALID_REQUEST]: '无效的请求',
  [ErrorCode.INVALID_PARAMS]: '参数错误',
  [ErrorCode.MISSING_REQUIRED_PARAMS]: '缺少必要参数',
  [ErrorCode.RATE_LIMIT_EXCEEDED]: '请求过于频繁，请稍后再试',
  [ErrorCode.OPERATION_TOO_FREQUENT]: '操作过于频繁，请稍后再试',
  [ErrorCode.RESOURCE_NOT_FOUND]: '资源不存在',
  [ErrorCode.RESOURCE_ALREADY_EXISTS]: '资源已存在',
  [ErrorCode.RESOURCE_CONFLICT]: '资源冲突',
  [ErrorCode.INVALID_FORMAT]: '格式错误',
  [ErrorCode.FILE_TOO_LARGE]: '文件过大',
  [ErrorCode.FILE_TYPE_NOT_ALLOWED]: '不支持的文件类型',
  [ErrorCode.OPERATION_TIMEOUT]: '操作超时',
  [ErrorCode.OPERATION_NOT_SUPPORTED]: '不支持的操作',

  // 认证授权错误
  [ErrorCode.UNAUTHORIZED]: '未授权，请先登录',
  [ErrorCode.TOKEN_INVALID]: 'Token无效',
  [ErrorCode.TOKEN_EXPIRED]: 'Token已过期',
  [ErrorCode.TOKEN_MISSING]: 'Token缺失',
  [ErrorCode.LOGIN_FAILED]: '登录失败',
  [ErrorCode.LOGIN_PASSWORD_ERROR]: '用户名或密码错误',
  [ErrorCode.LOGIN_CODE_ERROR]: '验证码错误',
  [ErrorCode.LOGIN_CODE_EXPIRED]: '验证码已过期',
  [ErrorCode.REGISTER_FAILED]: '注册失败',
  [ErrorCode.PERMISSION_DENIED]: '权限不足',
  [ErrorCode.ACCOUNT_DISABLED]: '账号已禁用',
  [ErrorCode.ACCOUNT_LOCKED]: '账号已锁定',
  [ErrorCode.ACCOUNT_BANNED]: '账号已被封禁',
  [ErrorCode.ACCOUNT_PENDING]: '账号待激活',
  [ErrorCode.SESSION_EXPIRED]: '会话已过期',
  [ErrorCode.REFRESH_TOKEN_INVALID]: '刷新令牌无效',
  [ErrorCode.VERIFICATION_FAILED]: '验证失败',
  [ErrorCode.UNSUPPORTED_PROVIDER]: '不支持的登录方式',
  [ErrorCode.OAUTH_CALLBACK_FAILED]: '第三方登录回调失败',
  [ErrorCode.UNBIND_FAILED]: '账号解绑失败',

  // 用户相关错误
  [ErrorCode.USER_NOT_FOUND]: '用户不存在',
  [ErrorCode.USER_ALREADY_EXISTS]: '用户已存在',
  [ErrorCode.USERNAME_ALREADY_EXISTS]: '用户名已存在',
  [ErrorCode.EMAIL_ALREADY_EXISTS]: '邮箱已被注册',
  [ErrorCode.PHONE_ALREADY_EXISTS]: '手机号已被注册',
  [ErrorCode.USERNAME_INVALID]: '用户名格式错误',
  [ErrorCode.EMAIL_INVALID]: '邮箱格式错误',
  [ErrorCode.PHONE_INVALID]: '手机号格式错误',
  [ErrorCode.PASSWORD_TOO_WEAK]: '密码强度不足',
  [ErrorCode.PASSWORD_SAME_AS_OLD]: '新密码不能与旧密码相同',
  [ErrorCode.PASSWORD_INCORRECT]: '密码错误',
  [ErrorCode.EMAIL_NOT_VERIFIED]: '邮箱未验证',
  [ErrorCode.PHONE_NOT_VERIFIED]: '手机号未验证',
  [ErrorCode.VERIFICATION_CODE_ERROR]: '验证码错误',
  [ErrorCode.VERIFICATION_CODE_EXPIRED]: '验证码已过期',
  [ErrorCode.VERIFICATION_CODE_SEND_FAILED]: '验证码发送失败',
  [ErrorCode.VERIFICATION_CODE_SEND_TOO_FREQUENT]: '验证码发送过于频繁',
  [ErrorCode.PROFILE_UPDATE_FAILED]: '个人资料更新失败',
  [ErrorCode.AVATAR_UPLOAD_FAILED]: '头像上传失败',
  [ErrorCode.DEVICE_BIND_FAILED]: '设备绑定失败',
  [ErrorCode.DEVICE_ALREADY_BOUND]: '设备已绑定',
  [ErrorCode.DEVICE_NOT_BOUND]: '设备未绑定',
  [ErrorCode.THIRD_PARTY_BIND_FAILED]: '第三方账号绑定失败',
  [ErrorCode.THIRD_PARTY_ALREADY_BOUND]: '第三方账号已绑定',
  [ErrorCode.INVITE_CODE_INVALID]: '邀请码无效',
  [ErrorCode.INVITE_CODE_EXPIRED]: '邀请码已过期',
  [ErrorCode.FAMILY_MEMBER_LIMIT_EXCEEDED]: '家庭成员数量已达上限',
  [ErrorCode.FACE_ID_ALREADY_ENABLED]: '面容ID登录已开通',
  [ErrorCode.FACE_ID_NOT_ENABLED]: '面容ID登录未开通',
  [ErrorCode.FACE_ID_VERIFY_FAILED]: '面容ID验证失败',
  [ErrorCode.FACE_ID_NOT_SUPPORTED]: '设备不支持面容ID功能',

  // 设备相关错误
  [ErrorCode.DEVICE_NOT_FOUND]: '设备不存在',
  [ErrorCode.DEVICE_OFFLINE]: '设备离线',
  [ErrorCode.DEVICE_UNAUTHORIZED]: '设备未授权',
  [ErrorCode.DEVICE_BUSY]: '设备忙碌',
  [ErrorCode.DEVICE_FIRMWARE_OUTDATED]: '设备固件版本过低',
  [ErrorCode.DEVICE_UPDATING]: '设备正在更新',
  [ErrorCode.DEVICE_COMMAND_FAILED]: '设备命令执行失败',
  [ErrorCode.DEVICE_COMMAND_TIMEOUT]: '设备命令执行超时',
  [ErrorCode.DEVICE_NOT_BOUND_BY_USER]: '用户未绑定该设备',
  [ErrorCode.DEVICE_ALREADY_REGISTERED]: '设备已注册',
  [ErrorCode.DEVICE_REGISTER_FAILED]: '设备注册失败',
  [ErrorCode.DEVICE_UPGRADE_FAILED]: '设备升级失败',
  [ErrorCode.DEVICE_UPGRADE_NO_NEW_VERSION]: '已是最新版本',
  [ErrorCode.STREAM_START_FAILED]: '启动流失败',
  [ErrorCode.STREAM_ALREADY_STARTED]: '流已启动',
  [ErrorCode.STREAM_NOT_STARTED]: '流未启动',
  [ErrorCode.RECORDING_FAILED]: '录制失败',
  [ErrorCode.STORAGE_QUOTA_EXCEEDED]: '存储空间不足',
  [ErrorCode.RECORDING_NOT_FOUND]: '录像不存在',
  [ErrorCode.RECORDING_UPLOAD_EXPIRED]: '录像上传已过期',
  [ErrorCode.RECORDING_MULTIPART_INVALID]: '录像分片上传无效',

  // 宝宝相关错误
  [ErrorCode.BABY_NOT_FOUND]: '宝宝信息不存在',
  [ErrorCode.BABY_PROFILE_EXISTS]: '宝宝信息已存在',
  [ErrorCode.BABY_RECORD_NOT_FOUND]: '宝宝记录不存在',
  [ErrorCode.GROWTH_RECORD_CREATE_FAILED]: '成长记录创建失败',
  [ErrorCode.HEALTH_RECORD_CREATE_FAILED]: '健康记录创建失败',
  [ErrorCode.FEEDING_RECORD_CREATE_FAILED]: '喂养记录创建失败',
  [ErrorCode.SLEEP_RECORD_CREATE_FAILED]: '睡眠记录创建失败',
  [ErrorCode.DIAPER_RECORD_CREATE_FAILED]: '换尿布记录创建失败',
  [ErrorCode.VACCINE_RECORD_CREATE_FAILED]: '疫苗记录创建失败',

  // 服务器错误
  [ErrorCode.INTERNAL_SERVER_ERROR]: '服务器内部错误',
  [ErrorCode.DATABASE_ERROR]: '数据库错误',
  [ErrorCode.REDIS_ERROR]: '缓存错误',
  [ErrorCode.MQTT_ERROR]: '消息队列错误',
  [ErrorCode.SMS_SERVICE_ERROR]: '短信服务错误',
  [ErrorCode.EMAIL_SERVICE_ERROR]: '邮件服务错误',
  [ErrorCode.STORAGE_SERVICE_ERROR]: '存储服务错误',
  [ErrorCode.THIRD_PARTY_SERVICE_ERROR]: '第三方服务错误',
  [ErrorCode.CONFIGURATION_ERROR]: '配置错误',
};

/**
 * 获取错误信息
 * 根据错误码获取对应的错误描述，支持自定义消息
 *
 * @param code - 错误码
 * @param customMessage - 自定义错误信息（可选），如果提供则优先返回
 * @returns 错误信息字符串
 */
export function getErrorMessage(code: ErrorCode, customMessage?: string): string {
  return customMessage || ErrorMessages[code] || ErrorMessages[ErrorCode.UNKNOWN_ERROR];
}

// ============ MQTT协议错误码 ============

/**
 * MQTT协议专用错误码
 * 用于设备与MQTT Gateway之间的通信
 * 与网关设备保持一致的错误码定义
 */
export enum MqttErrorCode {
  /** 未知错误 - 未预期的错误情况 */
  E_UNKNOWN = -1,
  /** 成功 - 操作正确执行 */
  OK = 0,
  /** 数据格式错误 - 消息格式不符合协议要求 */
  E_FORMAT = 1,
  /** 请求失败 - 请求处理失败 */
  E_REQUEST = 2,
  /** 参数错误 - 请求参数无效或缺失 */
  E_PARAMS = 3,
  /** 签名错误 - 消息签名验证失败 */
  E_SIGN = 4,
  /** 对象不存在 - 请求的资源对象不存在 */
  E_OBJECT_NULL = 101,
  /** 对象已存在 - 创建对象时唯一键冲突 */
  E_OBJECT_EXISTS = 102,
  /** 对象已被禁用 - 对象处于禁用状态 */
  E_OBJECT_ENABLE = 103,
  /** 对象不支持当前操作 - 对象类型不支持该操作 */
  E_OBJECT_UNSUPPORTED = 104,
  /** 请求超时 - 请求处理超时 */
  E_TIMEOUT = 408,
  /** 服务不可用 - 服务暂时无法处理请求 */
  E_SERVICE_UNAVAILABLE = 503,
}

/**
 * 创建成功响应
 * 构造一个成功的API响应对象
 *
 * @param data - 响应数据（可选）
 * @param message - 响应消息，默认为"操作成功"
 * @returns API响应对象
 */
export function successResponse<T>(data?: T, message = '操作成功'): ApiResponse<T> {
  return {
    code: ErrorCode.SUCCESS,
    data,
    message,
    timestamp: Date.now(),
  };
}

/**
 * 创建错误响应
 * 构造一个失败的API响应对象
 *
 * @param code - 错误码
 * @param message - 自定义错误信息（可选），不提供则使用默认错误信息
 * @returns API响应对象
 */
export function errorResponse(code: ErrorCode, message?: string): ApiResponse {
  return {
    code,
    message: getErrorMessage(code, message),
    timestamp: Date.now(),
  };
}
