# User Service API 测试用例设计

> 所有请求通过 API Gateway (端口 6001) 发送
> 基础 URL: `http://localhost:6001`

## 目录

1. [测试环境配置](#1-测试环境配置)
2. [认证模块测试](#2-认证模块测试)
3. [用户信息模块测试](#3-用户信息模块测试)
4. [第三方登录模块测试](#4-第三方登录模块测试)
5. [面容ID模块测试](#5-面容id模块测试)
6. [双因素认证模块测试](#6-双因素认证模块测试)
7. [订阅服务模块测试](#7-订阅服务模块测试)
8. [通知设置模块测试](#8-通知设置模块测试)
9. [帮助中心模块测试](#9-帮助中心模块测试)
10. [APP用户管理模块测试](#10-app用户管理模块测试)
11. [测试工具示例](#11-测试工具示例)

---

## 1. 测试环境配置

### 1.1 基础配置

```bash
# API Gateway 地址
export API_BASE_URL="http://localhost:6001"

# 测试账号
export TEST_USERNAME="testuser"
export TEST_PASSWORD="Test123456!@#"
export TEST_PHONE="18895356792"
export TEST_EMAIL="test@example.com"
```

### 1.2 Token 说明

| Token 状态 | 说明 |
|-----------|------|
| 无 Token | 公开接口（登录、注册、发送验证码等） |
| 需要 Token | 需要在 Header 中携带 `Authorization: Bearer <accessToken>` |
| Token 过期 | 返回 401 错误，需要使用 refreshToken 刷新 |

---

## 2. 认证模块测试

### 2.1 用户注册

#### TC-AUTH-001: 用户名密码注册（成功）
```http
POST ${API_BASE_URL}/api/auth/register
Content-Type: application/json

{
  "username": "testuser_001",
  "password": "Test123456!@#",
  "email": "test001@example.com"
}
```
**预期结果**: 200，返回用户信息和 Token

#### TC-AUTH-002: 手机号验证码注册（成功）
```http
POST ${API_BASE_URL}/api/auth/register
Content-Type: application/json

{
  "username": "phone_user_001",
  "phone": "13800138001",
  "password": "Test123456!@#",
  "code": "123456"
}
```
**预期结果**: 200，返回用户信息

#### TC-AUTH-003: 重复用户名注册（失败）
```http
POST ${API_BASE_URL}/api/auth/register
Content-Type: application/json

{
  "username": "existing_user",
  "password": "Test123456!@#"
}
```
**预期结果**: 409，用户名已存在

#### TC-AUTH-004: 密码强度不足（失败）
```http
POST ${API_BASE_URL}/api/auth/register
Content-Type: application/json

{
  "username": "weak_pwd_user",
  "password": "123456"
}
```
**预期结果**: 400，密码强度不足

---

### 2.2 用户登录

#### TC-AUTH-010: 密码登录（成功）
```http
POST ${API_BASE_URL}/api/auth/login
Content-Type: application/json

{
  "type": "password",
  "account": "testuser",
  "password": "Test123456!@#"
}
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "user": {
      "userId": "user-xxx",
      "username": "testuser",
      "nickname": "测试用户",
      "avatar": "https://..."
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 7200
  }
}
```

#### TC-AUTH-011: 短信验证码登录（成功）
```http
POST ${API_BASE_URL}/api/auth/login
Content-Type: application/json

{
  "type": "sms_code",
  "account": "18895356792",
  "code": "123456"
}
```
**预期结果**: 200，返回 Token

#### TC-AUTH-012: 邮箱验证码登录（成功）
```http
POST ${API_BASE_URL}/api/auth/login
Content-Type: application/json

{
  "type": "email_code",
  "account": "test@example.com",
  "code": "123456"
}
```
**预期结果**: 200，返回 Token

#### TC-AUTH-013: 错误密码登录（失败）
```http
POST ${API_BASE_URL}/api/auth/login
Content-Type: application/json

{
  "type": "password",
  "account": "testuser",
  "password": "WrongPassword123"
}
```
**预期结果**: 401，密码错误

#### TC-AUTH-014: 用户不存在（失败）
```http
POST ${API_BASE_URL}/api/auth/login
Content-Type: application/json

{
  "type": "password",
  "account": "nonexistent_user",
  "password": "Test123456!@#"
}
```
**预期结果**: 404，用户不存在

---

### 2.3 发送验证码

#### TC-AUTH-020: 发送短信验证码（成功）
```http
POST ${API_BASE_URL}/api/auth/send-code
Content-Type: application/json

{
  "target": "18895356792",
  "type": "login",
  "channel": "sms"
}
```
**预期结果**: 200，验证码已发送

#### TC-AUTH-021: 发送邮箱验证码（成功）
```http
POST ${API_BASE_URL}/api/auth/send-code
Content-Type: application/json

{
  "target": "test@example.com",
  "type": "register",
  "channel": "email"
}
```
**预期结果**: 200，验证码已发送

#### TC-AUTH-022: 无效手机号（失败）
```http
POST ${API_BASE_URL}/api/auth/send-code
Content-Type: application/json

{
  "target": "invalid_phone",
  "type": "login",
  "channel": "sms"
}
```
**预期结果**: 400，手机号格式错误

---

### 2.4 刷新Token

#### TC-AUTH-030: 刷新Token（成功）
```http
POST ${API_BASE_URL}/api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```
**预期结果**: 200，返回新的 accessToken 和 refreshToken

#### TC-AUTH-031: 无效refreshToken（失败）
```http
POST ${API_BASE_URL}/api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "invalid_token"
}
```
**预期结果**: 401，Token无效

---

### 2.5 密码重置

#### TC-AUTH-040: 发送密码重置邮件（成功）
```http
POST ${API_BASE_URL}/api/auth/send-reset-email
Content-Type: application/json

{
  "email": "test@example.com"
}
```
**预期结果**: 200，重置邮件已发送

#### TC-AUTH-041: 通过验证码重置密码（成功）
```http
POST ${API_BASE_URL}/api/auth/reset-password
Content-Type: application/json

{
  "account": "test@example.com",
  "code": "123456",
  "newPassword": "NewPassword123!@#"
}
```
**预期结果**: 200，密码重置成功

---

### 2.6 用户登出 🔒

> 🔒 需要携带 Token

#### TC-AUTH-050: 用户登出（成功）
```http
POST ${API_BASE_URL}/api/auth/logout
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{}
```
**预期结果**: 200，登出成功，Token 加入黑名单

#### TC-AUTH-051: 无Token登出（失败）
```http
POST ${API_BASE_URL}/api/auth/logout
Content-Type: application/json

{}
```
**预期结果**: 401，未授权

#### TC-AUTH-052: 使用已登出的Token（失败）
```http
POST ${API_BASE_URL}/api/auth/logout
Authorization: Bearer <已登出的Token>
Content-Type: application/json

{}
```
**预期结果**: 401，Token已失效

---

## 3. 用户信息模块测试

### 3.1 获取当前用户信息 🔒

#### TC-USER-001: 获取用户信息（成功）
```http
GET ${API_BASE_URL}/api/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "userId": "user-xxx",
    "username": "testuser",
    "email": "test@example.com",
    "phone": "188****6792",
    "nickname": "测试用户",
    "avatar": "https://...",
    "gender": "male",
    "birthDate": "1990-01-01",
    "location": "北京市",
    "bio": "个人简介",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### TC-USER-002: 无Token获取用户信息（失败）
```http
GET ${API_BASE_URL}/api/auth/me
```
**预期结果**: 401，未授权

#### TC-USER-003: Token过期（失败）
```http
GET ${API_BASE_URL}/api/auth/me
Authorization: Bearer <过期Token>
```
**预期结果**: 401，Token已过期

---

### 3.2 更新用户资料 🔒

#### TC-USER-010: 更新昵称（成功）
```http
PUT ${API_BASE_URL}/api/auth/me/profile
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "nickname": "新昵称"
}
```
**预期结果**: 200，更新成功

#### TC-USER-011: 更新多个字段（成功）
```http
PUT ${API_BASE_URL}/api/auth/me/profile
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "nickname": "新昵称",
  "gender": "male",
  "birthDate": "1990-01-01",
  "location": "上海市",
  "bio": "这是我的新简介"
}
```
**预期结果**: 200，更新成功

---

### 3.3 修改密码 🔒

#### TC-USER-020: 修改密码（成功）
```http
PUT ${API_BASE_URL}/api/auth/me/password
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "oldPassword": "OldPassword123!@#",
  "newPassword": "NewPassword123!@#"
}
```
**预期结果**: 200，密码修改成功

#### TC-USER-021: 旧密码错误（失败）
```http
PUT ${API_BASE_URL}/api/auth/me/password
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "oldPassword": "WrongOldPassword",
  "newPassword": "NewPassword123!@#"
}
```
**预期结果**: 401，旧密码错误

---

### 3.4 上传头像 🔒

#### TC-USER-030: 上传头像URL（成功）
```http
POST ${API_BASE_URL}/api/auth/me/avatar
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "avatarUrl": "https://example.com/avatar.jpg"
}
```
**预期结果**: 200，头像更新成功

---

### 3.5 删除账户 🔒

#### TC-USER-040: 删除账户（成功）
```http
DELETE ${API_BASE_URL}/api/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "password": "Test123456!@#"
}
```
**预期结果**: 200，账户已删除

#### TC-USER-041: 密码验证失败（失败）
```http
DELETE ${API_BASE_URL}/api/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "password": "WrongPassword"
}
```
**预期结果**: 401，密码错误

---

### 3.6 设备管理 🔒

#### TC-USER-050: 获取用户设备列表（成功）
```http
GET ${API_BASE_URL}/api/auth/me/devices
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200，返回设备列表

#### TC-USER-051: 绑定设备（成功）
```http
POST ${API_BASE_URL}/api/auth/me/devices/device-001
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "deviceName": "客厅摄像头",
  "role": "owner"
}
```
**预期结果**: 200，设备绑定成功

#### TC-USER-052: 解绑设备（成功）
```http
DELETE ${API_BASE_URL}/api/auth/me/devices/device-001
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200，设备已解绑

---

### 3.7 会话管理 🔒

#### TC-USER-060: 获取会话列表（成功）
```http
GET ${API_BASE_URL}/api/auth/me/sessions
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "session-001",
        "device": "iPhone 14",
        "ip": "192.168.1.1",
        "lastActive": "2024-01-01T12:00:00.000Z",
        "isCurrent": true
      }
    ]
  }
}
```

#### TC-USER-061: 删除指定会话（成功）
```http
DELETE ${API_BASE_URL}/api/auth/me/sessions/session-002
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200，会话已删除

#### TC-USER-062: 删除所有会话（成功）
```http
DELETE ${API_BASE_URL}/api/auth/me/sessions
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200，所有会话已删除

---

## 4. 第三方登录模块测试

### 4.1 获取授权URL

#### TC-OAUTH-001: 获取微信授权URL（成功）
```http
GET ${API_BASE_URL}/api/auth/authorize/wechat
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "authorizeUrl": "https://open.weixin.qq.com/connect/qrconnect?..."
  }
}
```

#### TC-OAUTH-002: 获取支持的第三方平台（成功）
```http
GET ${API_BASE_URL}/api/auth/providers
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "providers": ["wechat", "apple", "google"]
  }
}
```

---

### 4.2 绑定/解绑第三方账号 🔒

#### TC-OAUTH-010: 绑定微信账号（成功）
```http
POST ${API_BASE_URL}/api/auth/bind/wechat
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "code": "wechat_auth_code"
}
```
**预期结果**: 200，绑定成功

#### TC-OAUTH-011: 获取已绑定账号列表（成功）
```http
GET ${API_BASE_URL}/api/auth/bindings
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

#### TC-OAUTH-012: 解绑微信账号（成功）
```http
DELETE ${API_BASE_URL}/api/auth/bind/wechat
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200，解绑成功

---

## 5. 面容ID模块测试

### 5.1 获取面容ID状态 🔒

#### TC-FACEID-001: 获取面容ID状态（成功）
```http
GET ${API_BASE_URL}/api/face-id/status
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "enabled": false,
    "registeredAt": null,
    "deviceSupported": true
  }
}
```

---

### 5.2 开通/关闭面容ID 🔒

#### TC-FACEID-010: 开通面容ID（成功）
```http
POST ${API_BASE_URL}/api/face-id/enable
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "faceIdData": "biometric_token_from_client"
}
```
**预期结果**: 200，面容ID已开通

#### TC-FACEID-011: 重复开通面容ID（失败）
```http
POST ${API_BASE_URL}/api/face-id/enable
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "faceIdData": "biometric_token_from_client"
}
```
**预期结果**: 400，面容ID已开通

#### TC-FACEID-012: 关闭面容ID（成功）
```http
POST ${API_BASE_URL}/api/face-id/disable
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200，面容ID已关闭

---

### 5.3 验证面容ID 🔒

#### TC-FACEID-020: 验证面容ID登录（成功）
```http
POST ${API_BASE_URL}/api/face-id/verify
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "faceIdToken": "biometric_token_from_client"
}
```
**预期结果**: 200，返回新的 Token

#### TC-FACEID-021: 验证失败（失败）
```http
POST ${API_BASE_URL}/api/face-id/verify
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "faceIdToken": "invalid_token"
}
```
**预期结果**: 400，面容ID验证失败

---

### 5.4 更新面容ID数据 🔒

#### TC-FACEID-030: 更新面容ID数据（成功）
```http
PUT ${API_BASE_URL}/api/face-id/update
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "faceIdData": "new_biometric_token_from_client"
}
```
**预期结果**: 200，面容ID数据已更新

---

## 6. 双因素认证模块测试

### 6.1 获取2FA状态 🔒

#### TC-2FA-001: 获取2FA状态（成功）
```http
GET ${API_BASE_URL}/api/2fa/status
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "enabled": false,
    "type": null,
    "phoneNumber": null,
    "email": null
  }
}
```

---

### 6.2 设置2FA 🔒

#### TC-2FA-010: 设置TOTP（成功）
```http
POST ${API_BASE_URL}/api/2fa/setup/totp
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "email": "test@example.com"
}
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "qrCodeUrl": "otpauth://totp/...",
    "manualEntryKey": "ABCD-EFGH-IJKL",
    "backupCodes": ["code1", "code2", "code3"]
  }
}
```

#### TC-2FA-011: 设置SMS验证（成功）
```http
POST ${API_BASE_URL}/api/2fa/setup/sms
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "phoneNumber": "18895356792"
}
```
**预期结果**: 200

---

### 6.3 发送验证码 🔒

#### TC-2FA-020: 发送短信验证码（成功）
```http
POST ${API_BASE_URL}/api/2fa/send-code
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "type": "sms"
}
```
**预期结果**: 200

#### TC-2FA-021: 发送邮箱验证码（成功）
```http
POST ${API_BASE_URL}/api/2fa/send-code
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "type": "email",
  "email": "test@example.com"
}
```
**预期结果**: 200

---

### 6.4 验证和启用2FA 🔒

#### TC-2FA-030: 验证并启用2FA（成功）
```http
POST ${API_BASE_URL}/api/2fa/enable
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "code": "123456"
}
```
**预期结果**: 200，2FA已启用

#### TC-2FA-031: 验证码错误（失败）
```http
POST ${API_BASE_URL}/api/2fa/enable
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "code": "000000"
}
```
**预期结果**: 400，验证码错误

---

### 6.5 验证2FA代码 🔒

#### TC-2FA-040: 验证2FA代码（成功）
```http
POST ${API_BASE_URL}/api/2fa/verify
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "code": "123456"
}
```
**预期结果**: 200，验证成功

---

### 6.6 禁用2FA 🔒

#### TC-2FA-050: 禁用2FA（成功）
```http
POST ${API_BASE_URL}/api/2fa/disable
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "code": "123456"
}
```
**预期结果**: 200，2FA已禁用

---

### 6.7 备用码 🔒

#### TC-2FA-060: 重新生成备用码（成功）
```http
POST ${API_BASE_URL}/api/2fa/backup-codes/regenerate
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "backupCodes": ["backup1", "backup2", "backup3", ...]
  }
}
```

---

## 7. 订阅服务模块测试

### 7.1 套餐管理

#### TC-SUB-001: 获取所有套餐（成功）
```http
GET ${API_BASE_URL}/api/subscription/plans
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "plans": [
      {
        "planId": "monthly",
        "name": "月度套餐",
        "type": "monthly",
        "price": 9900,
        "durationDays": 30,
        "storageGb": 30,
        "recordingDays": 7
      }
    ]
  }
}
```

#### TC-SUB-002: 获取套餐详情（成功）
```http
GET ${API_BASE_URL}/api/subscription/plans/monthly
```
**预期结果**: 200

---

### 7.2 订单管理 🔒

#### TC-SUB-010: 创建订单（成功）
```http
POST ${API_BASE_URL}/api/subscription/orders
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "planId": "monthly"
}
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "orderNo": "ORD202401011200001234",
    "amount": 9900,
    "expiresAt": "2024-01-01T12:30:00.000Z"
  }
}
```

#### TC-SUB-011: 支付订单（成功）
```http
POST ${API_BASE_URL}/api/subscription/orders/ORD202401011200001234/pay
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "paymentMethod": "wechat",
  "transactionId": "wx_123456"
}
```
**预期结果**: 200，支付成功

#### TC-SUB-012: 获取订单列表（成功）
```http
GET ${API_BASE_URL}/api/subscription/orders?status=paid&limit=20&offset=0
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

---

### 7.3 订阅管理 🔒

#### TC-SUB-020: 获取我的订阅（成功）
```http
GET ${API_BASE_URL}/api/subscription/my-subscription
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200
```json
{
  "success": true,
  "data": {
    "subscription": {
      "planId": "monthly",
      "status": "active",
      "startedAt": "2024-01-01T00:00:00.000Z",
      "expiresAt": "2024-02-01T00:00:00.000Z",
      "autoRenew": true
    },
    "plan": {...},
    "daysRemaining": 25,
    "isExpired": false
  }
}
```

#### TC-SUB-021: 续费订阅（成功）
```http
POST ${API_BASE_URL}/api/subscription/my-subscription/renew
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

#### TC-SUB-022: 取消订阅（成功）
```http
DELETE ${API_BASE_URL}/api/subscription/my-subscription
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

#### TC-SUB-023: 获取服务权益（成功）
```http
GET ${API_BASE_URL}/api/subscription/benefits
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

---

## 8. 通知设置模块测试

### 8.1 获取通知设置 🔒

#### TC-NOTIF-001: 获取通知设置（成功）
```http
GET ${API_BASE_URL}/api/users/me/notifications/settings
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

---

### 8.2 推送设置 🔒

#### TC-NOTIF-010: 更新推送开关（成功）
```http
PUT ${API_BASE_URL}/api/users/me/notifications/settings/push
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "enabled": true
}
```
**预期结果**: 200

#### TC-NOTIF-011: 设置免打扰时间（成功）
```http
PUT ${API_BASE_URL}/api/users/me/notifications/settings/dnd
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "dndStart": "22:00",
  "dndEnd": "08:00"
}
```
**预期结果**: 200

---

### 8.3 哭声检测设置 🔒

#### TC-NOTIF-020: 更新哭声检测设置（成功）
```http
PUT ${API_BASE_URL}/api/users/me/notifications/settings/crying
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "detectionEnabled": true,
  "recognitionEnabled": true,
  "cryingTypesMask": 31
}
```
**预期结果**: 200

---

### 8.4 温湿度告警设置 🔒

#### TC-NOTIF-030: 更新温湿度告警设置（成功）
```http
PUT ${API_BASE_URL}/api/users/me/notifications/settings/temperature-humidity
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "tempAlertEnabled": true,
  "tempMin": 18,
  "tempMax": 28,
  "humidityAlertEnabled": true,
  "humidityMin": 30,
  "humidityMax": 70
}
```
**预期结果**: 200

#### TC-NOTIF-031: 温度参数无效（失败）
```http
PUT ${API_BASE_URL}/api/users/me/notifications/settings/temperature-humidity
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "tempMin": -10,
  "tempMax": 100
}
```
**预期结果**: 400，参数超出范围

---

### 8.5 自动安抚设置 🔒

#### TC-NOTIF-040: 更新自动安抚设置（成功）
```http
PUT ${API_BASE_URL}/api/users/me/notifications/settings/auto-soothing
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "enabled": true,
  "musicId": "wn-1",
  "maxDuration": 300000
}
```
**预期结果**: 200

---

### 8.6 电子围栏设置 🔒

#### TC-NOTIF-050: 更新电子围栏设置（成功）
```http
PUT ${API_BASE_URL}/api/users/me/notifications/settings/geofence
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "enabled": true,
  "radius": 100
}
```
**预期结果**: 200

---

### 8.7 铃声设置 🔒

#### TC-NOTIF-060: 获取铃声列表（成功）
```http
GET ${API_BASE_URL}/api/users/me/notifications/ringtones
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

#### TC-NOTIF-061: 更新铃声设置（成功）
```http
PUT ${API_BASE_URL}/api/users/me/notifications/settings/ringtone
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "ringtoneId": "gentle",
  "volume": 80,
  "vibrationEnabled": true
}
```
**预期结果**: 200

---

### 8.8 通知历史 🔒

#### TC-NOTIF-070: 获取通知历史（成功）
```http
GET ${API_BASE_URL}/api/users/me/notifications/history?limit=50&offset=0
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

#### TC-NOTIF-071: 获取未读数量（成功）
```http
GET ${API_BASE_URL}/api/users/me/notifications/unread-count
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

#### TC-NOTIF-072: 标记通知已读（成功）
```http
PUT ${API_BASE_URL}/api/users/me/notifications/history/notification-001/read
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

#### TC-NOTIF-073: 标记全部已读（成功）
```http
PUT ${API_BASE_URL}/api/users/me/notifications/history/read-all
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

#### TC-NOTIF-074: 清空通知历史（成功）
```http
DELETE ${API_BASE_URL}/api/users/me/notifications/history
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

---

## 9. 帮助中心模块测试

### 9.1 帮助文章

#### TC-HELP-001: 获取帮助文章列表（成功）
```http
GET ${API_BASE_URL}/api/help/articles?category=getting_started&limit=20
```
**预期结果**: 200

#### TC-HELP-002: 获取文章详情（成功）
```http
GET ${API_BASE_URL}/api/help/articles/article-001
```
**预期结果**: 200

#### TC-HELP-003: 搜索文章（成功）
```http
GET ${API_BASE_URL}/api/help/search?keyword=如何绑定设备
```
**预期结果**: 200

#### TC-HELP-004: 获取热门文章（成功）
```http
GET ${API_BASE_URL}/api/help/articles/popular?limit=10
```
**预期结果**: 200

#### TC-HELP-005: 记录文章反馈（成功）
```http
POST ${API_BASE_URL}/api/help/articles/article-001/feedback
Content-Type: application/json

{
  "feedbackType": "helpful"
}
```
**预期结果**: 200

---

### 9.2 技术支持工单 🔒

#### TC-HELP-010: 创建工单（成功）
```http
POST ${API_BASE_URL}/api/help/tickets
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "title": "设备无法连接",
  "description": "我的设备一直显示离线状态...",
  "ticketType": "technical",
  "priority": "high",
  "deviceId": "device-001"
}
```
**预期结果**: 200

#### TC-HELP-011: 获取我的工单列表（成功）
```http
GET ${API_BASE_URL}/api/help/tickets?status=open
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

#### TC-HELP-012: 获取工单详情（成功）
```http
GET ${API_BASE_URL}/api/help/tickets/ticket-001
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

#### TC-HELP-013: 关闭工单（成功）
```http
POST ${API_BASE_URL}/api/help/tickets/ticket-001/close
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
**预期结果**: 200

---

## 10. APP用户管理模块测试

### 10.1 用户注册

#### TC-APP-001: 注册APP用户（成功）
```http
POST ${API_BASE_URL}/api/app/users/register
Content-Type: application/json

{
  "username": "appuser001",
  "email": "appuser001@example.com",
  "phone": "13900139001",
  "password": "Test123456!@#",
  "nickname": "APP用户"
}
```
**预期结果**: 200

---

### 10.2 用户列表

#### TC-APP-010: 获取用户列表（成功）
```http
GET ${API_BASE_URL}/api/app/users?page=1&pageSize=20&keyword=test
```
**预期结果**: 200

#### TC-APP-011: 按角色筛选（成功）
```http
GET ${API_BASE_URL}/api/app/users?role=user&status=active
```
**预期结果**: 200

---

### 10.3 用户详情

#### TC-APP-020: 获取用户详情（成功）
```http
GET ${API_BASE_URL}/api/app/users/user-001
```
**预期结果**: 200

---

### 10.4 更新用户

#### TC-APP-030: 更新用户信息（成功）
```http
PUT ${API_BASE_URL}/api/app/users/user-001
Content-Type: application/json

{
  "nickname": "新昵称",
  "avatar": "https://example.com/avatar.jpg"
}
```
**预期结果**: 200

---

### 10.5 删除用户

#### TC-APP-040: 删除用户（成功）
```http
DELETE ${API_BASE_URL}/api/app/users/user-001
```
**预期结果**: 200

---

## 11. 测试工具示例

### 11.1 cURL 完整示例

```bash
#!/bin/bash

# 配置
API_BASE="http://localhost:6001"

# 1. 用户注册
echo "=== 用户注册 ==="
REGISTER_RESPONSE=$(curl -s -X POST "${API_BASE}/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser_'$(date +%s)'",
    "password": "Test123456!@#",
    "email": "test'$(date +%s)'@example.com"
  }')
echo "$REGISTER_RESPONSE" | jq .

# 提取 Token
ACCESS_TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.data.accessToken')
echo "Access Token: $ACCESS_TOKEN"

# 2. 获取用户信息（需要Token）
echo -e "\n=== 获取用户信息 ==="
curl -s -X GET "${API_BASE}/api/auth/me" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" | jq .

# 3. 更新用户资料（需要Token）
echo -e "\n=== 更新用户资料 ==="
curl -s -X PUT "${API_BASE}/api/auth/me/profile" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "nickname": "自动化测试用户",
    "gender": "male",
    "location": "北京市"
  }' | jq .

# 4. 登出（需要Token）
echo -e "\n=== 用户登出 ==="
curl -s -X POST "${API_BASE}/api/auth/logout" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" | jq .

# 5. 验证Token已失效
echo -e "\n=== 验证Token已失效 ==="
curl -s -X GET "${API_BASE}/api/auth/me" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" | jq .
```

### 11.2 Postman Collection 导入

```json
{
  "info": {
    "name": "User Service API Tests",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    { "key": "baseUrl", "value": "http://localhost:6001" },
    { "key": "accessToken", "value": "" }
  ],
  "item": [
    {
      "name": "Auth",
      "item": [
        {
          "name": "Login",
          "request": {
            "method": "POST",
            "header": [{ "key": "Content-Type", "value": "application/json" }],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"type\": \"password\",\n  \"account\": \"testuser\",\n  \"password\": \"Test123456!@#\"\n}"
            },
            "url": { "raw": "{{baseUrl}}/api/auth/login" }
          },
          "event": [
            {
              "listen": "test",
              "script": {
                "exec": [
                  "var jsonData = pm.response.json();",
                  "if (jsonData.success) {",
                  "  pm.collectionVariables.set('accessToken', jsonData.data.accessToken);",
                  "}"
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}
```

### 11.3 Jest 测试示例

```typescript
// user-service.test.ts
import axios from 'axios';

const API_BASE = 'http://localhost:6001';

describe('User Service API Tests', () => {
  let accessToken: string;
  let refreshToken: string;
  const testUser = {
    username: `testuser_${Date.now()}`,
    password: 'Test123456!@#',
    email: `test${Date.now()}@example.com`
  };

  describe('认证模块', () => {
    test('用户注册成功', async () => {
      const res = await axios.post(`${API_BASE}/api/auth/register`, testUser);
      expect(res.data.success).toBe(true);
      expect(res.data.data.accessToken).toBeDefined();
      accessToken = res.data.data.accessToken;
      refreshToken = res.data.data.refreshToken;
    });

    test('重复注册失败', async () => {
      try {
        await axios.post(`${API_BASE}/api/auth/register`, testUser);
        fail('Should throw error');
      } catch (error: any) {
        expect(error.response.status).toBe(409);
      }
    });

    test('获取用户信息 - 需要Token', async () => {
      const res = await axios.get(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      expect(res.data.success).toBe(true);
      expect(res.data.data.username).toBe(testUser.username);
    });

    test('无Token访问失败', async () => {
      try {
        await axios.get(`${API_BASE}/api/auth/me`);
        fail('Should throw error');
      } catch (error: any) {
        expect(error.response.status).toBe(401);
      }
    });

    test('刷新Token成功', async () => {
      const res = await axios.post(`${API_BASE}/api/auth/refresh`, {
        refreshToken
      });
      expect(res.data.success).toBe(true);
      expect(res.data.data.accessToken).toBeDefined();
      accessToken = res.data.data.accessToken;
    });

    test('用户登出成功', async () => {
      const res = await axios.post(`${API_BASE}/api/auth/logout`, {}, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      expect(res.data.success).toBe(true);
    });

    test('Token已失效', async () => {
      try {
        await axios.get(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        fail('Should throw error');
      } catch (error: any) {
        expect(error.response.status).toBe(401);
      }
    });
  });
});
```

---

## 附录

### A. 错误码对照表

| 错误码 | HTTP状态码 | 说明 |
|-------|----------|------|
| INVALID_PARAMS | 400 | 参数错误 |
| UNAUTHORIZED | 401 | 未授权/Token无效 |
| FORBIDDEN | 403 | 权限不足 |
| RESOURCE_NOT_FOUND | 404 | 资源不存在 |
| CONFLICT | 409 | 资源冲突 |
| RATE_LIMITED | 429 | 请求过于频繁 |
| INTERNAL_SERVER_ERROR | 500 | 服务器内部错误 |

### B. 测试数据准备

```sql
-- 插入测试用户
INSERT INTO user (id, username, email, phone, password_hash, status)
VALUES ('test-user-001', 'testuser', 'test@example.com', '18895356792', 'hashed_password', 'active');

-- 插入测试订阅套餐
INSERT INTO subscription_plan (id, name, type, price, duration_days)
VALUES ('monthly', '月度套餐', 'monthly', 9900, 30);
```

### C. Token 有效期

| Token 类型 | 有效期 | 说明 |
|-----------|-------|------|
| accessToken | 2小时 | 用于API请求认证 |
| refreshToken | 7天 | 用于刷新accessToken |
| 验证码 | 5分钟 | 短信/邮箱验证码 |
