# 婴儿监护云平台 API 文档

> 版本: v1.0.0
> 更新日期: 2026-03-26
> 基础URL: `https://api.babymonitor.com`

---

## 目录

- [概述](#概述)
- [认证方式](#认证方式)
- [通用规范](#通用规范)
  - [请求格式](#请求格式)
  - [响应格式](#响应格式)
  - [错误码](#错误码)
  - [分页参数](#分页参数)
- [API 接口](#api-接口)
  - [用户服务](#1-用户服务)
  - [设备服务](#2-设备服务)
  - [流媒体服务](#5-流媒体服务)
  - [宝宝服务](#3-宝宝服务)
  - [域管理服务](#4-域管理服务)
- [数据模型](#数据模型)
- [附录](#附录)

---

## 概述

本文档描述婴儿监护云平台提供给移动端 APP 的 API 接口规范。平台采用微服务架构，通过 API 网关统一对外提供服务。

### 服务架构

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│   Mobile    │────▶│  API 网关   │────▶│   微服务集群      │
│    APP      │     │  (Gateway)  │     │  - user-service  │
└─────────────┘     └─────────────┘     │  - device-service│
                                        │  - baby-service  │
                                        │  - admin-service │
                                        └──────────────────┘
```

---

## 认证方式

### Bearer Token 认证

所有 API 请求（除登录注册外）需要在请求头中携带 Token：

```http
Authorization: Bearer <access_token>
```

### Token 获取

用户登录成功后，服务器返回 `accessToken` 和 `refreshToken`：

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 7200
  },
  "message": "success"
}
```

### Token 刷新

当 `accessToken` 过期时，使用 `refreshToken` 获取新令牌：

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

---

## 通用规范

### 请求格式

- **Content-Type**: `application/json`
- **字符编码**: `UTF-8`
- **时间格式**: ISO 8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`)

### 响应格式

所有接口统一返回以下格式：

```typescript
interface ApiResponse<T> {
  code: number;        // 状态码 - 0表示成功，非0表示失败
  data?: T;            // 响应数据（成功时返回）
  message: string;     // 响应消息
  timestamp?: number;  // 响应时间戳（毫秒）
}
```

**成功响应示例：**

```json
{
  "code": 0,
  "data": { ... },
  "message": "success",
  "timestamp": 1708876800000
}
```

**失败响应示例：**

```json
{
  "code": 2001,
  "message": "用户名或密码错误",
  "timestamp": 1708876800000
}
```

### 错误码

| 错误码范围 | 类别 | 说明 |
|-----------|------|------|
| 0 | 成功 | 请求处理成功 |
| 1001 | 参数错误 | 请求参数不合法 |
| 1002 | 资源不存在 | 请求的资源不存在 |
| 1003 | 资源已存在 | 资源已存在，无法重复创建 |
| 1004 | 请求限流 | 请求频率超过限制 |
| 2001 | 认证失败 | 用户名或密码错误 |
| 2002 | Token过期 | AccessToken已过期 |
| 2003 | Token无效 | Token格式错误或已被撤销 |
| 2004 | 权限不足 | 无权访问该资源 |
| 3001 | 用户不存在 | 用户不存在 |
| 3002 | 用户已禁用 | 用户账号已被禁用 |
| 4001 | 设备不存在 | 设备不存在 |
| 4002 | 设备离线 | 设备当前离线 |
| 4003 | 设备未授权 | 设备未授权给当前用户 |
| 5001 | 宝宝不存在 | 宝宝档案不存在 |
| 5002 | 记录不存在 | 护理记录不存在 |
| 9001 | 服务器错误 | 服务器内部错误 |
| 9002 | 服务不可用 | 服务暂时不可用 |

### 分页参数

**请求参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| page | number | 否 | 1 | 当前页码（从1开始） |
| pageSize | number | 否 | 20 | 每页数量（最大100） |
| sortBy | string | 否 | createdAt | 排序字段 |
| sortOrder | string | 否 | desc | 排序方向：asc/desc |

**分页响应格式：**

```typescript
interface PaginatedData<T> {
  items: T[];         // 数据列表
  total: number;      // 总记录数
  page: number;       // 当前页码
  pageSize: number;   // 每页数量
  totalPages: number; // 总页数
}
```

**分页响应示例：**

```json
{
  "code": 0,
  "data": {
    "items": [...],
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  },
  "message": "success"
}
```

---

## API 接口

### 1. 用户服务

基础路径: `/api/app/users`

#### 1.1 用户注册

注册新的 APP 用户账号。

```http
POST /api/app/users/register
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| phone | string | 是 | 手机号码 |
| password | string | 是 | 密码（6-20位） |
| code | string | 是 | 短信验证码 |
| nickname | string | 否 | 昵称 |
| avatar | string | 否 | 头像URL |

**请求示例：**

```json
{
  "phone": "13800138000",
  "password": "password123",
  "code": "123456",
  "nickname": "宝宝妈妈"
}
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "id": "usr_abc123",
    "phone": "138****8000",
    "nickname": "宝宝妈妈",
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 7200
  },
  "message": "success"
}
```

---

#### 1.2 用户登录

```http
POST /api/auth/login
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| phone | string | 是 | 手机号码 |
| password | string | 是 | 密码 |
| deviceId | string | 否 | 设备ID |

**请求示例：**

```json
{
  "phone": "13800138000",
  "password": "password123",
  "deviceId": "device_001"
}
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 7200,
    "user": {
      "id": "usr_abc123",
      "phone": "138****8000",
      "nickname": "宝宝妈妈",
      "avatar": "https://..."
    }
  },
  "message": "success"
}
```

---

#### 1.3 获取当前用户信息

```http
GET /api/app/users/me
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "id": "usr_abc123",
    "phone": "138****8000",
    "email": "user@example.com",
    "nickname": "宝宝妈妈",
    "avatar": "https://...",
    "status": "active",
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
  "message": "success"
}
```

---

#### 1.4 更新用户信息

```http
PUT /api/app/users/me
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| nickname | string | 否 | 昵称 |
| avatar | string | 否 | 头像URL |
| email | string | 否 | 邮箱 |

**请求示例：**

```json
{
  "nickname": "新昵称",
  "avatar": "https://example.com/avatar.jpg"
}
```

---

#### 1.5 修改密码

```http
PUT /api/app/users/me/password
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| oldPassword | string | 是 | 原密码 |
| newPassword | string | 是 | 新密码（6-20位） |

---

#### 1.6 发送验证码

```http
POST /api/auth/sms-code
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| phone | string | 是 | 手机号码 |
| type | string | 是 | 类型：register/login/reset |

---

### 2. 设备服务

基础路径: `/api/devices`

#### 2.1 获取设备列表

获取当前用户授权的设备列表。

```http
GET /api/devices
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码 |
| pageSize | number | 否 | 每页数量 |
| type | string | 否 | 设备类型筛选 |
| status | string | 否 | 状态筛选：online/offline |

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "id": "dev_abc123",
        "serialNumber": "SN20260001",
        "name": "客厅摄像头",
        "productType": "CAMERA",
        "status": "ONLINE",
        "firmwareVersion": "1.0.5",
        "lastOnline": "2026-03-24T10:00:00.000Z",
        "createdAt": "2026-01-01T00:00:00.000Z"
      }
    ],
    "total": 3,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  },
  "message": "success"
}
```

---

#### 2.2 添加设备

绑定新设备到当前用户账号。

```http
POST /api/devices
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| serialNumber | string | 是 | 设备序列号 |
| name | string | 是 | 设备名称 |
| productId | string | 否 | 产品ID |

**请求示例：**

```json
{
  "serialNumber": "SN20260001",
  "name": "客厅摄像头"
}
```

---

#### 2.3 获取设备详情

```http
GET /api/devices/{deviceId}
```

**路径参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| deviceId | string | 设备ID |

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "id": "dev_abc123",
    "serialNumber": "SN20260001",
    "productId": "prod_camera_001",
    "productType": "CAMERA",
    "name": "客厅摄像头",
    "firmwareVersion": "1.0.5",
    "protocol": "PRIVATE",
    "status": "ONLINE",
    "ipAddress": "192.168.1.100",
    "lastOnline": "2026-03-24T10:00:00.000Z",
    "ownerId": "usr_abc123",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-03-24T10:00:00.000Z"
  },
  "message": "success"
}
```

---

#### 2.4 更新设备信息

```http
PUT /api/devices/{deviceId}
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 否 | 设备名称 |

---

#### 2.5 删除设备

解绑设备。

```http
DELETE /api/devices/{deviceId}
```

---

#### 2.6 获取设备状态

```http
GET /api/devices/{deviceId}/state
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "deviceId": "dev_abc123",
    "status": "ONLINE",
    "batteryLevel": 85,
    "signalStrength": -45,
    "temperature": 25.5,
    "humidity": 60,
    "lastHeartbeat": "2026-03-24T10:00:00.000Z"
  },
  "message": "success"
}
```

---

#### 2.7 发送设备命令

向设备发送控制命令。

```http
POST /api/devices/{deviceId}/command
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| command | string | 是 | 命令类型 |
| params | object | 否 | 命令参数 |

**请求示例：**

```json
{
  "command": "SET_MOTION_DETECTION",
  "params": {
    "enabled": true,
    "sensitivity": "high"
  }
}
```

**常用命令：**

| 命令 | 说明 | 参数 |
|------|------|------|
| REBOOT | 重启设备 | - |
| START_RECORD | 开始录制 | duration (秒) |
| STOP_RECORD | 停止录制 | - |
| SET_MOTION_DETECTION | 设置移动侦测 | enabled, sensitivity |
| PTZ_CONTROL | 云台控制 | direction, speed |
| SET_NIGHT_VISION | 设置夜视模式 | mode (auto/on/off) |

---

#### 2.8 检查设备在线状态

```http
GET /api/devices/{deviceId}/online
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "online": true,
    "lastOnline": "2026-03-24T10:00:00.000Z"
  },
  "message": "success"
}
```

---

### 5. 流媒体服务

基础路径: `/api/streams`

> 流媒体服务提供实时视频播放、云存储回放等功能。支持多种流媒体提供商（AWS KVS、腾讯云 IoT Video）。

#### 5.1 IoT Video SDK 鉴权

##### 5.1.1 获取 IoT Video SDK 鉴权信息

> 通过腾讯云 CreateAnonymousAccessToken API 获取鉴权信息，用于 APP 端使用 IoT Video X-P2P SDK 播放实时视频。
>
> **APP 端使用方式：**
> 1. 调用此接口获取 `accessId` 和 `accessToken`
> 2. 将 `accessId` 和 `accessToken` 传入 IoT Video SDK
> 3. SDK 使用这些凭证建立 P2P 连接，播放实时视频
>
> @see https://cloud.tencent.com/document/product/1131/49189

```http
GET /api/streams/iot-video/auth/{deviceId}
```

**路径参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| deviceId | string | 是 | 设备ID |

**查询参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| expireSeconds | number | 否 | 3600 | Token 有效期（秒），最大 86400（24小时） |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "accessId": "5f8a1b2c3d4e5f6a",
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expireTime": 1719331648,
    "deviceId": "dev_abc123",
    "productId": "ABC123",
    "deviceName": "camera_001"
  }
}
```

**响应字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| accessId | string | 终端用户在 IoT Video 平台的唯一标识 |
| accessToken | string | IoT Video 云服务器返回的访问令牌 |
| expireTime | number | Token 过期时间（Unix 时间戳，秒） |
| deviceId | string | 设备ID（系统内部标识） |
| productId | string | 腾讯云 IoT Video 产品ID |
| deviceName | string | 设备名称 |

**错误响应：**

```json
{
  "success": false,
  "error": {
    "code": "IOT_VIDEO_AUTH_ERROR",
    "message": "IoT Video provider not available"
  }
}
```

**APP 端使用示例（伪代码）：**

```typescript
// 1. 调用服务端接口获取鉴权信息
const response = await fetch('/api/streams/iot-video/auth/device-123');
const { data: authInfo } = await response.json();

// 2. 使用 IoT Video X-P2P SDK 初始化并播放实时视频
// 将 accessId 和 accessToken 传入 SDK
IoTVideoSDK.startP2P({
  accessId: authInfo.accessId,
  accessToken: authInfo.accessToken,
  productId: authInfo.productId,
  deviceName: authInfo.deviceName
});
```

---

##### 5.1.2 API 实现说明

服务端通过调用腾讯云 **CreateAnonymousAccessToken** API 获取鉴权信息：

**API 请求参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| Tid | string | 终端用户 ID，使用设备 ID |
| TtlMinutes | number | Token 有效期（分钟），最大 1440 |

**API 返回数据：**

| 字段 | 类型 | 说明 |
|------|------|------|
| AccessId | string | 终端用户在 IoT Video 平台的唯一标识 |
| AccessToken | string | IoT Video 云服务器返回的 Token |
| ExpireTime | number | Token 过期时间（Unix 时间戳，秒） |

**安全说明：**
- Token 由腾讯云 IoT Video 云服务生成，具有权威性
- Token 有过期时间，默认 1 小时，最长 24 小时
- SecretKey 仅保存在服务端，不会暴露给客户端
- APP 端使用 IoT Video X-P2P SDK 进行 P2P 连接，实现低延迟实时视频

---

#### 5.2 设备播放地址

##### 5.2.1 获取设备直接播放地址

> 用于设备已持续推流的场景，直接获取播放地址而无需创建 session。

```http
GET /api/streams/device/{deviceId}/playback
```

**路径参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| deviceId | string | 是 | 设备ID |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "hlsUrl": "https://xxx.iotvideo.tencentcs.com/live/xxx.m3u8",
    "rtmpUrl": "",
    "flvUrl": "",
    "webrtcUrl": "",
    "streamName": "ABC123/camera_001",
    "provider": "iot_video",
    "deviceId": "dev_abc123",
    "expiresAt": "2026-03-24T11:00:00.000Z",
    "isStreaming": true
  }
}
```

---

##### 5.2.2 检查设备推流状态

```http
GET /api/streams/device/{deviceId}/streaming-status
```

**响应示例：**

```json
{
  "success": true,
  "data": {
    "isStreaming": true,
    "deviceId": "dev_abc123"
  }
}
```

---

### 3. 宝宝服务

基础路径: `/api/babies`

#### 3.1 宝宝档案管理

##### 3.1.1 创建宝宝档案

```http
POST /api/babies
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 宝宝姓名 |
| gender | string | 是 | 性别：male/female |
| birthDate | string | 是 | 出生日期 (ISO 8601) |
| birthTime | string | 否 | 出生时间 (HH:mm) |
| weight | number | 否 | 出生体重(kg) |
| height | number | 否 | 出生身高(cm) |
| headCircumference | number | 否 | 头围(cm) |
| bloodType | string | 否 | 血型 |

**请求示例：**

```json
{
  "name": "小明",
  "gender": "male",
  "birthDate": "2025-06-15",
  "birthTime": "14:30",
  "weight": 3.5,
  "height": 50,
  "bloodType": "A"
}
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "id": "baby_abc123",
    "name": "小明",
    "gender": "male",
    "birthDate": "2025-06-15T00:00:00.000Z",
    "weight": 3.5,
    "height": 50,
    "status": "active",
    "createdAt": "2026-03-24T10:00:00.000Z"
  },
  "message": "success"
}
```

---

##### 3.1.2 获取宝宝列表

```http
GET /api/babies
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "id": "baby_abc123",
        "name": "小明",
        "gender": "male",
        "birthDate": "2025-06-15T00:00:00.000Z",
        "status": "active",
        "devices": [
          {
            "id": "dev_abc123",
            "name": "客厅摄像头",
            "type": "CAMERA"
          }
        ]
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  },
  "message": "success"
}
```

---

##### 3.1.3 获取宝宝详情

```http
GET /api/babies/{babyId}
```

---

##### 3.1.4 更新宝宝信息

```http
PUT /api/babies/{babyId}
```

---

##### 3.1.5 删除宝宝档案

```http
DELETE /api/babies/{babyId}
```

---

##### 3.1.6 关联设备

将设备与宝宝关联，用于监控。

```http
POST /api/babies/{babyId}/devices/{deviceId}
```

---

##### 3.1.7 取消关联设备

```http
DELETE /api/babies/{babyId}/devices/{deviceId}
```

---

#### 3.2 喂养记录

##### 3.2.1 开始喂奶

```http
POST /api/babies/{babyId}/feeding/start
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 是 | 喂养类型：breast/formula/solid |
| side | string | 否 | 乳房侧：left/right（母乳喂养时） |
| amount | number | 否 | 喂养量(ml)（配方奶时） |

**请求示例：**

```json
{
  "type": "breast",
  "side": "left"
}
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "logId": "log_feed_001",
    "type": "breast",
    "side": "left",
    "startTime": "2026-03-24T10:00:00.000Z",
    "status": "ongoing"
  },
  "message": "success"
}
```

---

##### 3.2.2 结束喂奶

```http
POST /api/babies/feeding/{logId}/end
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| amount | number | 否 | 实际喂养量(ml) |
| note | string | 否 | 备注 |

**请求示例：**

```json
{
  "amount": 120,
  "note": "宝宝吃得很香"
}
```

---

##### 3.2.3 获取喂奶记录

```http
GET /api/babies/{babyId}/feeding
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| startDate | string | 否 | 开始日期 |
| endDate | string | 否 | 结束日期 |
| page | number | 否 | 页码 |
| pageSize | number | 否 | 每页数量 |

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "id": "log_feed_001",
        "type": "breast",
        "side": "left",
        "startTime": "2026-03-24T10:00:00.000Z",
        "endTime": "2026-03-24T10:15:00.000Z",
        "duration": 900,
        "amount": 120,
        "note": "宝宝吃得很香"
      }
    ],
    "total": 15,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  },
  "message": "success"
}
```

---

##### 3.2.4 获取今日喂奶统计

```http
GET /api/babies/{babyId}/feeding/today
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "date": "2026-03-24",
    "totalCount": 5,
    "totalAmount": 650,
    "totalDuration": 4500,
    "breastCount": 3,
    "formulaCount": 2,
    "averageInterval": 7200,
    "records": [...]
  },
  "message": "success"
}
```

---

#### 3.3 睡眠记录

##### 3.3.1 开始睡眠记录

```http
POST /api/babies/{babyId}/sleep/start
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| location | string | 否 | 睡眠位置：crib/bed/stroller/car |
| note | string | 否 | 备注 |

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "logId": "log_sleep_001",
    "startTime": "2026-03-24T13:00:00.000Z",
    "location": "crib",
    "status": "ongoing"
  },
  "message": "success"
}
```

---

##### 3.3.2 结束睡眠记录

```http
POST /api/babies/sleep/{logId}/end
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| note | string | 否 | 备注 |

---

##### 3.3.3 获取睡眠记录

```http
GET /api/babies/{babyId}/sleep
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| startDate | string | 否 | 开始日期 |
| endDate | string | 否 | 结束日期 |
| page | number | 否 | 页码 |
| pageSize | number | 否 | 每页数量 |

---

##### 3.3.4 获取当前睡眠状态

```http
GET /api/babies/{babyId}/sleep/current
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "isSleeping": true,
    "logId": "log_sleep_001",
    "startTime": "2026-03-24T13:00:00.000Z",
    "duration": 3600,
    "location": "crib"
  },
  "message": "success"
}
```

---

##### 3.3.5 获取今日睡眠统计

```http
GET /api/babies/{babyId}/sleep/today
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "date": "2026-03-24",
    "totalDuration": 28800,
    "sessionCount": 3,
    "longestSession": 14400,
    "averageDuration": 9600,
    "currentStatus": "awake",
    "records": [...]
  },
  "message": "success"
}
```

---

#### 3.4 监控事件

##### 3.4.1 获取监控事件列表

```http
GET /api/babies/{babyId}/monitoring/events
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 否 | 事件类型 |
| acknowledged | boolean | 否 | 是否已确认 |
| startDate | string | 否 | 开始日期 |
| endDate | string | 否 | 结束日期 |
| page | number | 否 | 页码 |
| pageSize | number | 否 | 每页数量 |

**事件类型：**

| 类型 | 说明 |
|------|------|
| MOTION | 移动检测 |
| CRY | 哭声检测 |
| TEMPERATURE_HIGH | 温度过高 |
| TEMPERATURE_LOW | 温度过低 |
| NO_BREATHING | 呼吸异常 |
| FACE_COVERED | 面部遮挡 |
| DEVICE_OFFLINE | 设备离线 |

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "id": "evt_001",
        "type": "CRY",
        "severity": "high",
        "timestamp": "2026-03-24T14:30:00.000Z",
        "deviceId": "dev_abc123",
        "deviceName": "客厅摄像头",
        "acknowledged": false,
        "thumbnail": "https://...",
        "videoUrl": "https://..."
      }
    ],
    "total": 10,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  },
  "message": "success"
}
```

---

##### 3.4.2 获取未确认事件

```http
GET /api/babies/{babyId}/monitoring/events/unacknowledged
```

---

##### 3.4.3 确认事件

```http
POST /api/babies/monitoring/events/{eventId}/acknowledge
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| action | string | 否 | 处理动作：viewed/handled/ignored |
| note | string | 否 | 备注 |

---

#### 3.5 数据分析

##### 3.5.1 获取每日摘要

```http
GET /api/babies/{babyId}/analytics/daily
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| date | string | 否 | 日期，默认今天 |

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "date": "2026-03-24",
    "feeding": {
      "totalCount": 5,
      "totalAmount": 650,
      "breastCount": 3,
      "formulaCount": 2
    },
    "sleep": {
      "totalDuration": 28800,
      "sessionCount": 3,
      "quality": "good"
    },
    "growth": {
      "weight": 8.5,
      "height": 68
    },
    "events": {
      "total": 3,
      "cryCount": 2,
      "motionCount": 1
    }
  },
  "message": "success"
}
```

---

##### 3.5.2 获取周报

```http
GET /api/babies/{babyId}/analytics/weekly
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| endDate | string | 否 | 周结束日期，默认今天 |

---

##### 3.5.3 获取生长百分位

```http
GET /api/babies/{babyId}/analytics/growth/percentile
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "weight": {
      "value": 8.5,
      "percentile": 65,
      "status": "normal"
    },
    "height": {
      "value": 68,
      "percentile": 70,
      "status": "normal"
    },
    "headCircumference": {
      "value": 43,
      "percentile": 55,
      "status": "normal"
    }
  },
  "message": "success"
}
```

---

##### 3.5.4 获取生长趋势

```http
GET /api/babies/{babyId}/analytics/growth/trend
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| months | number | 否 | 月数，默认6 |

---

##### 3.5.5 分析喂养模式

```http
GET /api/babies/{babyId}/analytics/feeding/pattern
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "averageInterval": 7200,
    "preferredType": "breast",
    "peakHours": [6, 10, 14, 18, 22],
    "dailyAverage": 650,
    "weeklyTrend": "stable",
    "recommendations": [
      "建议保持每3小时喂养一次的节奏"
    ]
  },
  "message": "success"
}
```

---

##### 3.5.6 获取睡眠模式分析

```http
GET /api/babies/{babyId}/analytics/sleep/pattern
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "dailyAverage": 14.5,
    "nightSleep": 9,
    "daySleep": 5.5,
    "averageSessions": 4,
    "qualityScore": 85,
    "pattern": "regular",
    "recommendations": [
      "建议在晚上8点前开始睡前准备"
    ]
  },
  "message": "success"
}
```

---

### 4. 域管理服务

基础路径: `/api/domains`

> 域管理用于家庭/组织级别的用户和权限管理。

#### 4.1 创建域

```http
POST /api/domains
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 域名称 |
| code | string | 是 | 域编码（唯一） |
| description | string | 否 | 描述 |
| type | string | 否 | 类型：trial/standard/premium/enterprise |

---

#### 4.2 获取域列表

```http
GET /api/domains
```

---

#### 4.3 获取域详情

```http
GET /api/domains/{domainId}
```

---

#### 4.4 更新域信息

```http
PUT /api/domains/{domainId}
```

---

#### 4.5 删除域

```http
DELETE /api/domains/{domainId}
```

---

#### 4.6 添加用户到域

```http
POST /api/domains/{domainId}/users
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userId | string | 是 | 用户ID |
| role | string | 是 | 角色：owner/admin/member/guest |

---

#### 4.7 获取域用户列表

```http
GET /api/domains/{domainId}/users
```

---

#### 4.8 从域移除用户

```http
DELETE /api/domains/{domainId}/users/{userId}
```

---

#### 4.9 更新用户域角色

```http
PUT /api/domains/{domainId}/users/{userId}/role
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| role | string | 是 | 新角色 |

---

#### 4.10 获取域统计信息

```http
GET /api/domains/{domainId}/statistics
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "userCount": 5,
    "deviceCount": 3,
    "babyCount": 2,
    "storageUsed": 1024000000,
    "storageLimit": 10737418240
  },
  "message": "success"
}
```

---

## 数据模型

### 用户 (User)

```typescript
interface User {
  id: string;                    // 用户ID
  phone: string;                 // 手机号（脱敏）
  email?: string;                // 邮箱
  nickname?: string;             // 昵称
  avatar?: string;               // 头像URL
  status: 'active' | 'disabled'; // 状态
  createdAt: Date;               // 创建时间
  updatedAt: Date;               // 更新时间
}
```

### 设备 (Device)

```typescript
interface Device {
  id: string;                              // 设备ID
  serialNumber: string;                    // 序列号
  productId: string;                       // 产品ID
  productType: ProductType;                // 产品类型
  name: string;                            // 设备名称
  firmwareVersion: string;                 // 固件版本
  protocol: 'PRIVATE' | 'MATTER';          // 协议类型
  status: DeviceStatus;                    // 设备状态
  ipAddress?: string;                      // IP地址
  lastOnline?: Date;                       // 最后在线时间
  ownerId: string;                         // 所有者ID
  createdAt: Date;                         // 创建时间
  updatedAt: Date;                         // 更新时间
}

type ProductType =
  | 'CAMERA'    // 摄像头
  | 'SCREEN'    // 显示屏
  | 'SENSOR'    // 传感器
  | 'GATEWAY';  // 网关

type DeviceStatus =
  | 'ONLINE'       // 在线
  | 'OFFLINE'      // 离线
  | 'UNAUTHORIZED' // 未授权
  | 'UPDATING';    // 更新中
```

### 宝宝 (Baby)

```typescript
interface Baby {
  id: string;                       // 宝宝ID
  name: string;                     // 姓名
  gender: 'male' | 'female';        // 性别
  birthDate: Date;                  // 出生日期
  birthTime?: string;               // 出生时间
  weight?: number;                  // 体重(kg)
  height?: number;                  // 身高(cm)
  headCircumference?: number;       // 头围(cm)
  bloodType?: string;               // 血型
  status: 'active' | 'archived';    // 状态
  userId: string;                   // 用户ID
  createdAt: Date;                  // 创建时间
  updatedAt: Date;                  // 更新时间
}
```

### 喂养记录 (FeedingLog)

```typescript
interface FeedingLog {
  id: string;                       // 记录ID
  babyId: string;                   // 宝宝ID
  type: 'breast' | 'formula' | 'solid'; // 喂养类型
  side?: 'left' | 'right';          // 乳房侧
  startTime: Date;                  // 开始时间
  endTime?: Date;                   // 结束时间
  duration?: number;                // 时长(秒)
  amount?: number;                  // 喂养量(ml)
  note?: string;                    // 备注
  createdAt: Date;                  // 创建时间
}
```

### 睡眠记录 (SleepLog)

```typescript
interface SleepLog {
  id: string;                       // 记录ID
  babyId: string;                   // 宝宝ID
  startTime: Date;                  // 开始时间
  endTime?: Date;                   // 结束时间
  duration?: number;                // 时长(秒)
  location?: string;                // 睡眠位置
  quality?: 'good' | 'fair' | 'poor'; // 睡眠质量
  note?: string;                    // 备注
  createdAt: Date;                  // 创建时间
}
```

### 监控事件 (MonitoringEvent)

```typescript
interface MonitoringEvent {
  id: string;                       // 事件ID
  babyId: string;                   // 宝宝ID
  type: EventType;                  // 事件类型
  severity: 'low' | 'medium' | 'high'; // 严重程度
  timestamp: Date;                  // 事件时间
  deviceId: string;                 // 设备ID
  acknowledged: boolean;            // 是否已确认
  acknowledgedAt?: Date;            // 确认时间
  acknowledgedBy?: string;          // 确认人
  thumbnail?: string;               // 缩略图
  videoUrl?: string;                // 视频URL
  metadata?: Record<string, any>;   // 元数据
}

type EventType =
  | 'MOTION'            // 移动检测
  | 'CRY'               // 哭声检测
  | 'TEMPERATURE_HIGH'  // 温度过高
  | 'TEMPERATURE_LOW'   // 温度过低
  | 'NO_BREATHING'      // 呼吸异常
  | 'FACE_COVERED'      // 面部遮挡
  | 'DEVICE_OFFLINE';   // 设备离线
```

### 域 (Domain)

```typescript
interface Domain {
  id: string;                                    // 域ID
  code: string;                                  // 域编码
  name: string;                                  // 域名称
  description?: string;                          // 描述
  type: 'trial' | 'standard' | 'premium' | 'enterprise'; // 类型
  ownerId?: string;                              // 所有者ID
  userLimit?: number;                            // 用户数限制
  deviceLimit?: number;                          // 设备数限制
  storageLimit?: number;                         // 存储限制(字节)
  status: 'active' | 'suspended' | 'deleted';    // 状态
  createdAt: Date;                               // 创建时间
  updatedAt: Date;                               // 更新时间
}
```

---

## 附录

### A. 设备类型说明

| 类型 | 说明 | 功能 |
|------|------|------|
| CAMERA | 智能摄像头 | 视频监控、哭声检测、移动侦测 |
| SCREEN | 显示屏 | 实时查看、双向通话 |
| SENSOR | 环境传感器 | 温湿度监测、呼吸监测 |
| GATEWAY | 智能网关 | 设备接入、协议转换 |

### B. 常见问题

#### Q1: Token 过期如何处理？

当接口返回 `code: 2002` 时，表示 Token 已过期。请使用 `refreshToken` 调用刷新接口获取新的 `accessToken`。

#### Q2: 如何处理设备离线？

当设备状态为 `OFFLINE` 时，无法发送控制命令。请检查设备电源和网络连接。

#### Q3: 分页数据最大支持多少条？

`pageSize` 最大支持 100 条，超过将自动限制为 100。

### C. 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.1.0 | 2026-03-26 | 新增流媒体服务 API，支持 IoT Video SDK 签名 |
| v1.0.0 | 2026-03-24 | 初始版本 |

---

## 联系我们

- 技术支持邮箱: support@babymonitor.com
- API 问题反馈: api@babymonitor.com
