# 用户服务 - 登录及鉴权文档

## 目录
- [概述](#概述)
- [架构设计](#架构设计)
- [登录流程](#登录流程)
- [鉴权机制](#鉴权机制)
- [数据模型](#数据模型)
- [API 接口](#api-接口)
- [安全策略](#安全策略)
- [错误码](#错误码)

---

## 概述

用户服务（User Service）负责智能家居云平台的用户认证、授权和用户信息管理。服务基于 **Midway.js** 框架构建，提供多种登录方式和完善的会话管理机制。

### 核心特性
- 多种登录方式支持（密码/短信/邮箱/第三方）
- JWT 双 Token 认证机制
- 完整的会话管理
- 验证码服务集成（短信/邮箱）
- 用户状态管理
- 操作日志记录

---

## 架构设计

### 技术栈

| 技术 | 用途 |
|------|------|
| Midway.js | Web 框架 |
| TypeORM | ORM 数据访问 |
| MySQL | 关系型数据库 |
| Redis | 缓存/会话/验证码存储 |
| @midwayjs/jwt | JWT 认证 |
| @alicloud/pop-core | 阿里云短信服务 |
| nodemailer | 邮件发送 |

### 核心模块

```
user-service/
├── src/
│   ├── controller/
│   │   └── user.controller.ts    # 认证/用户控制器
│   ├── service/
│   │   ├── auth.service.ts        # 认证服务（核心）
│   │   ├── user.service.ts        # 用户服务
│   │   ├── sms.service.ts         # 短信/验证码服务
│   │   └── email.service.ts       # 邮件服务
│   ├── entity/
│   │   ├── user.entity.ts         # 用户实体
│   │   ├── user-session.entity.ts # 会话实体
│   │   ├── third-party-binding.entity.ts  # 第三方绑定
│   │   └── user-action-log.entity.ts      # 操作日志
│   ├── dto/
│   │   └── auth.dto.ts            # 认证相关 DTO
│   └── config/
│       └── config.default.ts      # 配置文件
```

---

## 登录流程

### 登录类型

系统支持以下 4 种登录方式：

```typescript
enum LoginType {
  PASSWORD = 'password',         // 密码登录
  SMS_CODE = 'sms_code',         // 短信验证码登录
  EMAIL_CODE = 'email_code',     // 邮箱验证码登录
  THIRD_PARTY = 'third_party',   // 第三方登录（微信/支付宝等）
}
```

### 1. 密码登录流程

```
┌─────────┐         ┌──────────────┐         ┌─────────┐
│  客户端  │         │  User Service │         │  数据库  │
└────┬────┘         └──────┬───────┘         └────┬────┘
     │                     │                      │
     │ POST /api/auth/login                    │
     │ {type, account, password}               │
     ├────────────────────>                    │
     │                     │                      │
     │                     │ 查询用户            │
     │                     ├─────────────────────>
     │                     │                      │
     │                     │ 返回用户信息          │
     │                     │<─────────────────────
     │                     │                      │
     │                     │ 验证密码哈希          │
     │                     │                      │
     │                     │ 检查用户状态          │
     │                     │                      │
     │                     │ 生成 JWT Token       │
     │                     │ 创建会话记录          │
     │                     │ 更新最后登录信息      │
     │                     │ 记录操作日志          │
     │                     │                      │
     │ {user, tokens}      │                      │
     │<────────────────────┘                      │
     │                                            │
```

**关键代码位置**: [auth.service.ts:319-338](src/service/auth.service.ts#L319-L338)

```typescript
private async loginWithPassword(account: string, password: string): Promise<User | null> {
  // 支持用户名/邮箱/手机号登录
  const user = await this.userRepository.findOne({
    where: [
      { username: account },
      { email: account },
      { phone: account },
    ],
  });

  if (!user || !user.passwordHash) {
    return null;
  }

  // SHA256 密码验证
  const isValid = PasswordUtil.verify(password, user.passwordHash);
  return isValid ? user : null;
}
```

### 2. 短信验证码登录流程

```
┌─────────┐         ┌──────────────┐         ┌─────────┐
│  客户端  │         │  User Service │         │ Redis   │
└────┬────┘         └──────┬───────┘         └────┬────┘
     │                     │                      │
     │ 1. POST /api/auth/send-code              │
     │    {target, type: 'login', channel}     │
     ├────────────────────>                     │
     │                     │ 生成6位验证码        │
     │                     │ 存储到Redis (5分钟)  │
     │                     ├────────────────────>
     │                     │                      │
     │                     │ 发送短信             │
     │                     │ (阿里云SMS)          │
     │<────────────────────┘                      │
     │                                            │
     │ 2. POST /api/auth/login                   │
     │    {type: 'sms_code', account, code}      │
     ├────────────────────>                     │
     │                     │ 验证验证码            │
     │                     ├────────────────────>
     │                     │                      │
     │                     │ 用户不存在则自动注册   │
     │                     │                      │
     │ {user, tokens}      │                      │
     │<────────────────────┘                      │
```

**关键特性**：
- 验证码有效期：5 分钟
- 发送频率限制：1 分钟内只能发送 1 次
- 用户不存在时自动创建账户
- 自动标记手机号为已验证

**关键代码位置**: [auth.service.ts:343-388](src/service/auth.service.ts#L343-L388)

### 3. 邮箱验证码登录流程

与短信验证码登录流程类似，支持通过邮箱验证码登录。

**关键代码位置**: [auth.service.ts:393-437](src/service/auth.service.ts#L393-L437)

### 4. 第三方登录流程

支持微信、支付宝、Apple、Google、Facebook 等第三方平台登录。

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  第三方平台   │     │  User Service │     │    数据库     │
└──────┬──────┘     └──────┬───────┘     └──────┬──────┘
       │                   │                      │
       │  OAuth授权        │                      │
       │<──────────────────                       │
       │                   │                      │
       │ 返回授权信息       │                      │
       ├──────────────────>                       │
       │                   │                      │
       │                   │ 查询第三方绑定表     │
       │                   ├────────────────────>
       │                   │                      │
       │                   │ 已绑定 -> 直接登录   │
       │                   │ 未绑定 -> 返回注册页 │
       │                   │                      │
```

**关键代码位置**: [auth.service.ts:442-459](src/service/auth.service.ts#L442-L459)

### 登录响应数据

```typescript
{
  code: 0,
  message: "登录成功",
  data: {
    user: {
      id: "uuid",
      username: "user_18895356792",
      phone: "18895356792",
      role: "user",
      status: "active",
      // ... 其他用户信息
    },
    accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    expiresIn: 7200,  // 2小时
    isNewUser: true   // 是否为新注册用户
  },
  timestamp: 1234567890
}
```

---

## 鉴权机制

### JWT 双 Token 机制

系统采用 **Access Token + Refresh Token** 双 Token 机制：

| Token 类型 | 有效期 | 用途 | 存储位置 |
|-----------|--------|------|---------|
| Access Token | 2 小时 | 访问受保护资源 | 客户端内存/localStorage |
| Refresh Token | 7 天 | 刷新 Access Token | 客户端安全存储 |

### Token 结构

**Access Token Payload**:
```typescript
{
  userId: string,      // 用户ID
  username: string,    // 用户名
  role: UserRole,      // 用户角色
  type: 'access',      // Token类型标识
  iat: number,         // 签发时间
  exp: number          // 过期时间
}
```

**Refresh Token Payload**:
```typescript
{
  userId: string,
  type: 'refresh',     // 刷新令牌标识
  iat: number,
  exp: number
}
```

### Token 生成

**关键代码位置**: [auth.service.ts:464-481](src/service/auth.service.ts#L464-L481)

```typescript
private async generateAccessToken(user: User): Promise<string> {
  return await this.jwt.sign({
    userId: user.id,
    username: user.username,
    role: user.role,
    type: 'access',
  });
}

private async generateRefreshToken(user: User): Promise<string> {
  return await this.jwt.sign({
    userId: user.id,
    type: 'refresh',
  });
}
```

### Token 使用流程

```
┌──────────┐                ┌──────────────┐
│  客户端   │                │ User Service │
└────┬─────┘                └──────┬───────┘
     │                             │
     │ 1. 登录获取 tokens           │
     ├────────────────────────────>│
     │<────────────────────────────┤
     │                             │
     │ 2. 携带 Access Token        │
     │ Authorization: Bearer {at}  │
     ├────────────────────────────>│
     │                             │ JWT中间件验证
     │                             │ ctx.state.user = decoded
     │                             │
     │ 3. Access Token 过期         │
     ├────────────────────────────>│
     │   401 Unauthorized           │
     │<────────────────────────────┤
     │                             │
     │ 4. 使用 Refresh Token 刷新   │
     │ POST /api/auth/refresh       │
     ├────────────────────────────>│
     │                             │
     │ 5. 获取新的 tokens           │
     │<────────────────────────────┤
```

### Token 刷新

**API 接口**: `POST /api/auth/refresh`

**请求体**:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**关键代码位置**: [auth.service.ts:256-298](src/service/auth.service.ts#L256-L298)

```typescript
async refreshAccessToken(refreshToken: string) {
  // 验证 refresh token
  const decoded = await this.jwt.verify(refreshToken);

  // 确保 token 类型为 refresh
  if (decoded.type !== 'refresh') {
    return { success: false, error: '无效的刷新令牌' };
  }

  // 获取用户信息并生成新 token
  const user = await this.userRepository.findOne({
    where: { id: decoded.userId }
  });

  if (!user || user.status !== UserStatus.ACTIVE) {
    return { success: false, error: '用户不存在或已被禁用' };
  }

  return {
    success: true,
    data: {
      accessToken: await this.generateAccessToken(user),
      refreshToken: await this.generateRefreshToken(user),
      expiresIn: 7200
    }
  };
}
```

### 受保护路由访问

Midway.js JWT 中间件自动验证 Token 并将解析后的用户信息存储到 `ctx.state.user`：

```typescript
// 控制器中使用
@Get('/me')
async getCurrentUser() {
  const userId = this.ctx.state.user.userId;
  const user = await this.userService.getUserFullInfo(userId);
  return successResponse(user);
}
```

**配置**: [config.default.ts:31-34](src/config/config.default.ts#L31-L34)

```typescript
jwt: {
  secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  expiresIn: '2h',
}
```

---

## 数据模型

### 用户表 (users)

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | uuid | 主键 |
| username | varchar(64) | 用户名（唯一） |
| email | varchar(128) | 邮箱（唯一，可空） |
| phone | varchar(20) | 手机号（唯一，可空） |
| passwordHash | varchar(256) | 密码哈希（SHA256） |
| nickname | varchar(64) | 昵称 |
| avatar | varchar(512) | 头像URL |
| gender | enum | 性别: male/female/other |
| birthDate | date | 出生日期 |
| location | varchar(256) | 位置 |
| bio | text | 个人简介 |
| role | enum | 角色: admin/user/guest |
| status | enum | 状态: active/inactive/banned/pending/locked |
| emailVerified | boolean | 邮箱是否已验证 |
| phoneVerified | boolean | 手机是否已验证 |
| lastLoginAt | timestamp | 最后登录时间 |
| lastLoginIp | varchar(64) | 最后登录IP |
| createdAt | timestamp | 创建时间 |
| updatedAt | timestamp | 更新时间 |

**实体定义**: [user.entity.ts](src/entity/user.entity.ts)

### 用户会话表 (user_sessions)

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | uuid | 主键 |
| userId | uuid | 用户ID |
| deviceType | enum | 设备类型: web/ios/android/desktop |
| deviceInfo | text | 设备信息（User-Agent） |
| ip | varchar(64) | IP地址 |
| location | varchar(256) | 地理位置 |
| lastActiveAt | timestamp | 最后活跃时间 |
| createdAt | timestamp | 创建时间 |

**实体定义**: [user-session.entity.ts](src/entity/user-session.entity.ts)

### 第三方绑定表 (third_party_bindings)

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | uuid | 主键 |
| userId | uuid | 用户ID |
| provider | enum | 第三方平台 |
| openId | varchar(128) | OpenID |
| unionId | varchar(128) | UnionID（可选） |
| userInfo | json | 第三方用户信息 |
| bindAt | timestamp | 绑定时间 |

**实体定义**: [third-party-binding.entity.ts](src/entity/third-party-binding.entity.ts)

### 用户操作日志表 (user_action_logs)

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | uuid | 主键 |
| userId | uuid | 用户ID |
| action | enum | 操作类型 |
| details | json | 操作详情 |
| ip | varchar(64) | IP地址 |
| userAgent | text | User-Agent |
| createdAt | timestamp | 创建时间 |

**实体定义**: [user-action-log.entity.ts](src/entity/user-action-log.entity.ts)

---

## API 接口

### 认证接口

#### 1. 用户登录
```
POST /api/auth/login
```

**请求体**:
```json
{
  "type": "password",
  "account": "18895356792",
  "password": "Test123456"
}
```

或短信验证码登录：
```json
{
  "type": "sms_code",
  "account": "18895356792",
  "code": "123456"
}
```

**响应**: 见[登录响应数据](#登录响应数据)

#### 2. 用户注册
```
POST /api/auth/register
```

**请求体**:
```json
{
  "username": "testuser",
  "email": "test@example.com",
  "phone": "18895356792",
  "password": "Test123456",
  "code": "123456",
  "referralCode": "INVITE123"
}
```

#### 3. 发送验证码
```
POST /api/auth/send-code
```

**请求体**:
```json
{
  "target": "18895356792",
  "type": "login",
  "channel": "sms"
}
```

**type 枚举值**: `register`, `login`, `reset_password`, `bind_phone`, `bind_email`, `change_phone`, `change_email`

**channel 枚举值**: `sms`, `email`

#### 4. 刷新 Token
```
POST /api/auth/refresh
```

**请求体**:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### 5. 重置密码
```
POST /api/auth/reset-password
```

**请求体**:
```json
{
  "account": "18895356792",
  "code": "123456",
  "newPassword": "NewPassword123"
}
```

#### 6. 登出
```
POST /api/auth/logout
```
需要 JWT 认证

### 用户信息接口

#### 1. 获取当前用户信息
```
GET /api/users/me
```
需要 JWT 认证

#### 2. 更新个人资料
```
PUT /api/users/me/profile
```

**请求体**:
```json
{
  "nickname": "张三",
  "gender": "male",
  "birthDate": "1990-01-01",
  "location": "北京市",
  "bio": "这是我的个人简介"
}
```

#### 3. 修改密码
```
PUT /api/users/me/password
```

**请求体**:
```json
{
  "oldPassword": "OldPassword123",
  "newPassword": "NewPassword123"
}
```

#### 4. 获取会话列表
```
GET /api/users/me/sessions
```

#### 5. 删除指定会话
```
DELETE /api/users/me/sessions/:sessionId
```

#### 6. 删除所有会话（异地登出）
```
DELETE /api/users/me/sessions
```

---

## 安全策略

### 密码安全
- **加密算法**: SHA256 哈希
- **密码强度**: 建议包含大小写字母、数字、特殊字符
- **位置**: [shared-utils/index.ts:39-52](../../common/shared-utils/src/index.ts#L39-L52)

```typescript
export class PasswordUtil {
  static hash(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  static verify(password: string, hash: string): boolean {
    return this.hash(password) === hash;
  }
}
```

### 验证码安全
- **长度**: 6 位数字
- **有效期**: 5 分钟
- **存储**: Redis
- **使用限制**: 一次性使用，验证后标记为已使用
- **频率限制**: 同一手机号/邮箱 1 分钟内只能发送 1 次

**位置**: [sms.service.ts:149-279](src/service/sms.service.ts#L149-L279)

### JWT 安全
- **签名算法**: HS256
- **密钥**: 通过环境变量 `JWT_SECRET` 配置
- **Token 过期**:
  - Access Token: 2 小时
  - Refresh Token: 7 天
- **TODO**: Token 黑名单机制（退出登录时使 Token 失效）

### 用户状态检查

登录时会检查用户状态，禁止以下状态用户登录：

| 状态 | 说明 |
|-----|------|
| BANNED | 账号被封禁 |
| LOCKED | 账号被锁定 |
| PENDING | 账号待激活 |

**位置**: [auth.service.ts:93-112](src/service/auth.service.ts#L93-L112)

### 会话管理
- 登录时创建会话记录
- 记录设备类型、IP、User-Agent
- 支持查看和删除指定会话
- 支持一键删除所有会话（异地登出）

### 操作日志
记录用户关键操作：
- REGISTER: 注册
- LOGIN: 登录
- LOGOUT: 登出
- UPDATE_PROFILE: 更新资料
- CHANGE_PASSWORD: 修改密码
- RESET_PASSWORD: 重置密码
- DELETE_ACCOUNT: 删除账户

---

## 错误码

### 认证授权相关 (2xxx)

| 错误码 | 说明 |
|-------|------|
| 2000 | UNAUTHORIZED - 未授权 |
| 2001 | TOKEN_INVALID - Token无效 |
| 2002 | TOKEN_EXPIRED - Token已过期 |
| 2003 | TOKEN_MISSING - Token缺失 |
| 2004 | LOGIN_FAILED - 登录失败 |
| 2005 | LOGIN_PASSWORD_ERROR - 用户名或密码错误 |
| 2006 | LOGIN_CODE_ERROR - 验证码错误 |
| 2007 | LOGIN_CODE_EXPIRED - 验证码已过期 |
| 2008 | REGISTER_FAILED - 注册失败 |
| 2009 | PERMISSION_DENIED - 权限不足 |
| 2010 | ACCOUNT_DISABLED - 账号已禁用 |
| 2011 | ACCOUNT_LOCKED - 账号被锁定 |
| 2012 | ACCOUNT_BANNED - 账号已被封禁 |
| 2013 | ACCOUNT_PENDING - 账号待激活 |
| 2014 | SESSION_EXPIRED - 会话已过期 |
| 2015 | REFRESH_TOKEN_INVALID - 刷新令牌无效 |
| 2016 | VERIFICATION_FAILED - 验证失败 |

### 用户相关 (3xxx)

| 错误码 | 说明 |
|-------|------|
| 3000 | USER_NOT_FOUND - 用户不存在 |
| 3002 | USERNAME_ALREADY_EXISTS - 用户名已存在 |
| 3003 | EMAIL_ALREADY_EXISTS - 邮箱已被注册 |
| 3004 | PHONE_ALREADY_EXISTS - 手机号已被注册 |
| 3005 | USERNAME_INVALID - 用户名格式错误 |
| 3006 | EMAIL_INVALID - 邮箱格式错误 |
| 3007 | PHONE_INVALID - 手机号格式错误 |
| 3008 | PASSWORD_TOO_WEAK - 密码强度不足 |
| 3009 | PASSWORD_SAME_AS_OLD - 新密码不能与旧密码相同 |
| 3010 | PASSWORD_INCORRECT - 密码错误 |
| 3013 | VERIFICATION_CODE_ERROR - 验证码错误 |
| 3014 | VERIFICATION_CODE_EXPIRED - 验证码已过期 |
| 3015 | VERIFICATION_CODE_SEND_FAILED - 验证码发送失败 |
| 3016 | VERIFICATION_CODE_SEND_TOO_FREQUENT - 验证码发送过于频繁 |

完整错误码定义: [common.types.ts](../../common/shared-types/src/common.types.ts)

---

## 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|-------|------|-------|
| JWT_SECRET | JWT 签名密钥 | your-secret-key-change-in-production |
| MYSQL_HOST | MySQL 主机 | localhost |
| MYSQL_PORT | MySQL 端口 | 3306 |
| MYSQL_USER | MySQL 用户名 | root |
| MYSQL_PASSWORD | MySQL 密码 | - |
| MYSQL_DATABASE | 数据库名 | babymonitor |
| REDIS_HOST | Redis 主机 | localhost |
| REDIS_PORT | Redis 端口 | 6379 |
| REDIS_PASSWORD | Redis 密码 | - |
| ALIYUN_ACCESS_KEY_ID | 阿里云 AccessKey ID | - |
| ALIYUN_ACCESS_KEY_SECRET | 阿里云 AccessKey Secret | - |
| ALIYUN_SMS_SIGN_NAME | 短信签名 | 智能家居 |

### 阿里云短信模板配置

```typescript
templates: {
  register: 'SMS_123456789',      // 注册验证码模板
  login: 'SMS_123456790',         // 登录验证码模板
  reset_password: 'SMS_123456791',// 重置密码模板
  bind_phone: 'SMS_123456792',    // 绑定手机模板
  change_phone: 'SMS_123456793',  // 更换手机模板
}
```

**位置**: [config.default.ts:64-80](src/config/config.default.ts#L64-L80)

---

## 最佳实践

### 客户端实现建议

1. **Token 存储**
   - Access Token: 存储在内存中（页面刷新后使用 Refresh Token 获取）
   - Refresh Token: 存储在 httpOnly Cookie 或安全存储中

2. **Token 刷新策略**
   - 在 Access Token 过期前 5 分钟自动刷新
   - 收到 401 响应时使用 Refresh Token 刷新
   - Refresh Token 也过期时跳转登录页

3. **多设备管理**
   - 登录后展示当前会话列表
   - 提供异地登出功能
   - 新设备登录时发送通知

4. **验证码处理**
   - 倒计时显示（60秒）
   - 输入框自动填充
   - 验证失败后清空输入框

### 安全建议

1. **生产环境**
   - 修改默认 JWT_SECRET 为强密钥
   - 启用 HTTPS
   - 实现 Token 黑名单机制
   - 添加登录失败次数限制

2. **密码策略**
   - 建议使用 bcrypt 替代 SHA256（加盐哈希）
   - 密码复杂度要求
   - 定期强制修改密码

3. **会话管理**
   - 限制同时在线设备数量
   - 异常登录检测
   - 敏感操作二次验证

---

## 文件索引

| 文件 | 描述 |
|-----|------|
| [auth.service.ts](src/service/auth.service.ts) | 认证服务核心逻辑 |
| [user.controller.ts](src/controller/user.controller.ts) | 认证/用户控制器 |
| [sms.service.ts](src/service/sms.service.ts) | 短信/验证码服务 |
| [user.entity.ts](src/entity/user.entity.ts) | 用户数据模型 |
| [auth.dto.ts](src/dto/auth.dto.ts) | 认证相关 DTO 定义 |
| [config.default.ts](src/config/config.default.ts) | 服务配置文件 |
| [configuration.ts](src/configuration.ts) | Midway 配置入口 |

---

*最后更新时间: 2025-02-08*
