# amoon AI Baby MNT — APP API 完整文档

> **版本**: V1.9 | **网关**: `http://localhost:6001` | **认证**: Bearer Token (JWT)
> **日期**: 2026-06-02 | **接口总数**: 145

---

## 通用说明

### 网关

所有 APP 请求通过 API Gateway (6001) 统一入口。

```
Authorization: Bearer <accessToken>
```

### 统一响应

```json
{ "code": 0, "data": { ... }, "message": "操作成功", "timestamp": 1700000000000 }
```

| code | 含义 |
|------|------|
| 0 | 成功 |
| 1xxx | 通用错误 |
| 2xxx | 认证授权错误 |
| 4xxx | 设备相关错误 |
| 9xxx | 服务器内部错误 |

---

## 1. 登录注册

### 1.1 发送验证码

```http
POST /api/auth/send-code
```

**请求体** (SendCodeRequestDTO):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| target | string | ✅ | 手机号或邮箱 |
| type | string | ✅ | `register` / `login` / `reset_password` / `bind_phone` / `bind_email` / `change_phone` / `change_email` |
| channel | string | ✅ | `sms` / `email` |

**响应**:

```json
{ "code": 0, "message": "验证码已发送" }
```

---

### 1.2 登录

```http
POST /api/auth/login
```

**请求体** (LoginRequestDTO):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | ✅ | `password` / `sms_code` / `email_code` / `oauth` |
| account | string | ✅ | 用户名/邮箱/手机号 |
| password | string | type=password时必填 | 密码 |
| code | string | type=sms_code/email_code时必填 | 验证码 |
| oauthProvider | string | type=oauth时必填 | 第三方平台 |
| oauthToken | string | type=oauth时必填 | 第三方Token |

**响应**:

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG...",
    "expiresIn": 7200,
    "user": { "userId": "uuid", "username": "admin", "email": "admin@babymonitor.com", "phone": "138...", "avatar": "https://...", "role": "admin" }
  }
}
```

---

### 1.3 注册

```http
POST /api/auth/register
```

**请求体** (RegisterRequestDTO):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | ✅ | 用户名 |
| password | string | ✅ | 密码 |
| email | string | | 邮箱 |
| phone | string | | 手机号 |
| code | string | 邮箱/手机注册时必填 | 验证码 |
| referralCode | string | | 邀请码 |

**响应**:

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG...",
    "expiresIn": 7200,
    "user": { "userId": "uuid", "username": "newuser", "email": "...", "phone": "..." }
  }
}
```

---

### 1.4 刷新 Token

```http
POST /api/auth/refresh
```

**请求体** (RefreshTokenRequestDTO):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| refreshToken | string | ✅ | 登录时获得的刷新令牌 |

**响应**:

```json
{
  "code": 0,
  "data": { "accessToken": "eyJhbG...", "refreshToken": "eyJhbG...", "expiresIn": 7200 }
}
```

---

### 1.5 登出

```http
POST /api/auth/logout
```

无请求体。Token 立即失效。

---

### 1.6 发送密码重置邮件

```http
POST /api/auth/send-reset-email
```

**请求体** (SendResetEmailRequestDTO):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | ✅ | 邮箱地址 |

---

### 1.7 重置密码

```http
POST /api/auth/reset-password
```

**请求体** (ResetPasswordRequestDTO):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| account | string | ✅ | 用户名/邮箱/手机号 |
| code | string | ✅ | 验证码 |
| newPassword | string | ✅ | 新密码 |

---

## 2. 连接设备

### 2.1 添加设备（绑定）

```http
POST /api/devices
```

> 控制器: `DeviceController.createDevice` — `device.controller.ts:40`

**请求体** (@ApiBody required: `productType`, `deviceName`):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| productType | string | ✅ | `CAMERA` / `MONITOR` / `SENSOR` / `GATEWAY` |
| deviceName | string | ✅ | 设备名称 |
| serialNumber | string | | 序列号 |
| macAddress | string | | MAC 地址 |
| firmwareVersion | string | | 固件版本，默认 `1.0.0` |

**响应**:

```json
{
  "success": true,
  "data": {
    "deviceId": "uuid",
    "productType": "CAMERA",
    "deviceName": "婴儿摄像头",
    "serialNumber": "SN...",
    "status": "online"
  }
}
```

---

### 2.2 设备详情

```http
GET /api/devices/{deviceId}
```

### 2.3 开始推流

```http
POST /api/devices/{deviceId}/control/stream/start
```

**请求体**（可选）:

| 参数 | 类型 | 说明 |
|------|------|------|
| resolution | string | 推流分辨率 |

### 2.4 创建设备流资源

```http
POST /api/videos/device/{deviceId}/stream
```

**请求体**（可选）:

| 参数 | 类型 | 说明 |
|------|------|------|
| provider | string | 流媒体提供商 |

---

## 3. 摄像头主页

### 3.1 设备实时状态

```http
GET /api/devices/{deviceId}/state
```

**响应**:

```json
{
  "code": 0,
  "data": {
    "power": "on",
    "recording": false,
    "motionDetected": false,
    "temperature": 24.5,
    "humidity": 55.0
  }
}
```

### 3.2 设备在线状态

```http
GET /api/devices/{deviceId}/online
```

**响应**: `{ "code": 0, "data": { "online": true } }`

### 3.3 获取播放地址

```http
GET /api/videos/device/{deviceId}/playback
```

### 3.4 检查推流状态

```http
GET /api/videos/device/{deviceId}/streaming-status
```

### 3.5 开始录制

```http
POST /api/devices/{deviceId}/control/recording/start
```

**请求体**（可选）:

| 参数 | 类型 | 说明 |
|------|------|------|
| duration | number | 录制时长(秒) |
| resolution | string | 录制分辨率 |

### 3.6 停止录制

```http
POST /api/devices/{deviceId}/control/recording/stop
```

### 3.7 静音/取消静音

```http
POST /api/devices/{deviceId}/control/mute
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| muted | boolean | ✅ | true=静音 |

### 3.8 设置分辨率

```http
POST /api/devices/{deviceId}/control/resolution
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| resolution | string | ✅ | 如 `720p` / `1080p` / `2K` / `4K` |

### 3.9 开始对讲

```http
POST /api/devices/{deviceId}/talk/start
```

**请求体**（可选）:

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| sampleRate | number | 16000 | 采样率: 8000/16000/44100/48000 |
| channels | number | 1 | 声道数: 1/2 |
| codec | string | opus | 编码: opus/aac/g711a/g711u |

### 3.10 停止对讲

```http
POST /api/devices/{deviceId}/talk/stop
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| sessionId | string | ✅ | 对讲会话ID |

### 3.11 对讲状态

```http
GET /api/devices/{deviceId}/talk/status
```

**响应**: `{ "code": 0, "data": { "enabled": false, "sessionId": null, "volume": 80 } }`

### 3.12 安抚音乐列表

```http
GET /api/devices/{deviceId}/soothing/music
```

**响应**: `{ "code": 0, "data": { "categories": [...] } }` — 分类含 `white_noise`/`lullaby`/`nature`/`womb_sound`

### 3.13 播放安抚音乐

```http
POST /api/devices/{deviceId}/soothing/play
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| musicId | string | ✅ | 音乐ID |
| volume | number | 0-100 | 音量 |
| duration | number | 0=循环 | 播放时长(ms) |

### 3.14 停止安抚音乐

```http
POST /api/devices/{deviceId}/soothing/stop
```

### 3.15 设置音乐音量

```http
PUT /api/devices/{deviceId}/soothing/volume
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| volume | number | ✅ | 0-100 |

---

## 4. 全屏模式 PTZ

### 4.1 PTZ 方向控制

```http
POST /api/devices/{deviceId}/ptz/control
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| direction | string | ✅ | `up`/`down`/`left`/`right`/`up_left`/`up_right`/`down_left`/`down_right`/`stop`/`goto_preset`/`set_preset` |
| speed | number | 1-100 | 移动速度，默认50 |
| duration | number | | 持续时间(ms) |
| presetId | number | | 预置位ID(goto_preset/set_preset时) |
| horizontal | number | -180~180 | 水平角度 |
| vertical | number | -90~90 | 垂直角度 |
| zoom | number | | 变焦倍数 |

**响应**: `{ "code": 0, "data": { "commandId": "...", "status": "pending" } }`

### 4.2 PTZ 停止

```http
POST /api/devices/{deviceId}/ptz/stop
```

### 4.3 PTZ 位置查询

```http
GET /api/devices/{deviceId}/ptz/position
```

**响应**: `{ "code": 0, "data": { "horizontal": 0, "vertical": 45, "zoom": 1.0 } }`

### 4.4 保存预置位

```http
POST /api/devices/{deviceId}/ptz/presets
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| presetId | number | ✅ | 预置位ID (1-16) |
| name | string | ✅ | 名称(最长32字符) |

### 4.5 获取预置位列表

```http
GET /api/devices/{deviceId}/ptz/presets
```

### 4.6 删除预置位

```http
DELETE /api/devices/{deviceId}/ptz/presets/{presetId}
```

### 4.7 转到预置位

```http
POST /api/devices/{deviceId}/ptz/presets/{presetId}/goto
```

### 4.8 巡航控制

```http
POST /api/devices/{deviceId}/ptz/cruise
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| enabled | boolean | ✅ | 是否启用 |
| mode | string | | `horizontal`/`vertical`/`preset` |
| speed | number | 1-5 | 巡航速度 |
| presetIds | number[] | | preset模式的预置位列表 |

---

## 5. 通知列表

### 5.1 通知历史列表

```http
GET /api/users/me/notifications/history
```

**查询参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| type | string | 通知类型筛选 |
| deviceId | string | 设备筛选 |
| isRead | string | "true"/"false" |
| limit | number | 默认50 |
| offset | number | 默认0 |

**响应**:

```json
{
  "code": 0,
  "data": {
    "list": [{
      "id": "uuid", "type": "crying_detected", "title": "哭声检测",
      "body": "检测到宝宝哭声", "isRead": false, "isAcknowledged": false,
      "likeStatus": "none", "createdAt": "2024-01-01T00:00:00.000Z"
    }],
    "total": 100
  }
}
```

### 5.2 未读数量

```http
GET /api/users/me/notifications/unread-count
```

**响应**: `{ "code": 0, "data": { "count": 5 } }`

### 5.3 标记单条已读

```http
PUT /api/users/me/notifications/history/{notificationId}/read
```

### 5.4 全部已读

```http
PUT /api/users/me/notifications/history/read-all
```

### 5.5 确认通知

```http
PUT /api/users/me/notifications/history/{notificationId}/acknowledge
```

### 5.6 点赞

```http
POST /api/users/me/notifications/{notificationId}/like
```

切换行为：再次调用取消点赞。

**响应**: `{ "code": 0, "data": { "likeStatus": "liked"\|"none" } }`

### 5.7 踩

```http
POST /api/users/me/notifications/{notificationId}/dislike
```

切换行为：再次调用取消踩。

**响应**: `{ "code": 0, "data": { "likeStatus": "disliked"\|"none" } }`

### 5.8 提交哭声识别反馈

```http
POST /api/users/me/notifications/{notificationId}/feedback
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| feedbackType | string | ✅ | `hungry`/`hold`/`diaper`/`sleepy`/`gas` |
| feedbackText | string | | 补充说明，最长300字 |

### 5.9 删除单条通知

```http
DELETE /api/users/me/notifications/history/{notificationId}
```

软删除。

### 5.10 批量删除通知

```http
DELETE /api/users/me/notifications/history/batch
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| notificationIds | string[] | ✅ | 单次最多100条 |

### 5.11 清除全部通知

```http
DELETE /api/users/me/notifications/history
```

**查询参数**: `beforeDate` — 清空此日期之前的记录。

### 5.12 云存事件录像列表

```http
GET /api/videos/recordings/{deviceId}/events
```

**查询参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| startTime | string | 开始时间 |
| endTime | string | 结束时间 |

---

## 6. 通知管理

### 6.1 获取通知设置

```http
GET /api/users/me/notifications/settings
```

**响应**:

```json
{
  "code": 0,
  "data": {
    "pushEnabled": true, "dndStart": "22:00", "dndEnd": "08:00",
    "cryingDetectionEnabled": true, "cryingRecognitionEnabled": true,
    "temperatureAlertEnabled": true, "tempMin": 18.0, "tempMax": 28.0,
    "humidityAlertEnabled": true, "humidityMin": 30, "humidityMax": 70,
    "autoSoothingEnabled": false,
    "geofenceEnabled": false,
    "ringtoneId": "default", "ringtoneVolume": 80, "vibrationEnabled": true
  }
}
```

### 6.2 更新推送总开关

```http
PUT /api/users/me/notifications/settings/push
```

**请求体**: `{ "enabled": boolean }`

### 6.3 更新免打扰

```http
PUT /api/users/me/notifications/settings/dnd
```

**请求体**: `{ "dndStart": string\|null, "dndEnd": string\|null }`

### 6.4 更新哭声检测

```http
PUT /api/users/me/notifications/settings/crying
```

**请求体**: `{ "detectionEnabled": boolean, "recognitionEnabled": boolean, "cryingTypesMask": number }`

### 6.5 更新温湿度告警

```http
PUT /api/users/me/notifications/settings/temperature-humidity
```

**请求体**: `{ "tempAlertEnabled": boolean, "tempMin": number, "tempMax": number, "humidityAlertEnabled": boolean, "humidityMin": number, "humidityMax": number }`

### 6.6 更新自动安抚

```http
PUT /api/users/me/notifications/settings/auto-soothing
```

**请求体**: `{ "enabled": boolean, "musicId": string, "maxDuration": number }`

### 6.7 更新电子围栏

```http
PUT /api/users/me/notifications/settings/geofence
```

**请求体**: `{ "enabled": boolean, "radius": number }`

### 6.8 获取铃声列表

```http
GET /api/users/me/notifications/ringtones
```

### 6.9 更新铃声设置

```http
PUT /api/users/me/notifications/settings/ringtone
```

**请求体**: `{ "ringtoneId": string, "volume": number, "vibrationEnabled": boolean }`

---

## 7. 宝宝记

### 7.1 获取宝宝列表

```http
GET /api/babies
```

**查询参数**:

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| page | number | 1 | 页码 |
| pageSize | number | 20 | 每页数量 |

### 7.2 创建宝宝

```http
POST /api/babies
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ | 宝宝姓名 |
| gender | string | ✅ | `male` / `female` |
| birthDate | string | ✅ | 出生日期 (YYYY-MM-DD) |
| birthTime | string | | 出生时间 |
| weight | number | | 出生体重(g) |
| height | number | | 出生身高(cm) |
| headCircumference | number | | 出生头围(cm) |
| bloodType | string | | 血型 |

### 7.3 获取宝宝详情

```http
GET /api/babies/{babyId}
```

### 7.4 更新宝宝信息

```http
PUT /api/babies/{babyId}
```

**请求体**（全部可选）: `name`, `bloodType`, `allergies`

### 7.5 删除宝宝

```http
DELETE /api/babies/{babyId}
```

### 7.6 绑定设备

```http
POST /api/babies/{babyId}/devices/{deviceId}
```

### 7.7 解绑设备

```http
DELETE /api/babies/{babyId}/devices/{deviceId}
```

### 7.8 创建日志

```http
POST /api/baby-logs
```

**请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| babyId | string | ✅ | 宝宝ID |
| eventType | string | ✅ | `breast_feeding` / `bottle_feeding` / `sleep` / `diaper_change` / `roll_over` |
| startTime | string | ✅ | ISO 8601 |
| endTime | string | | 结束时间 |
| duration | number | | 持续时长(秒) |
| timezone | string | | 时区 |
| source | string | | `manual`(默认) / `algorithm` / `device` |
| level | string | | `info` / `warning` / `alert` / `emergency` |
| deviceId | string | | 设备ID |
| eventId | string | | 事件唯一ID(防重复) |
| note | string | | 备注 |
| amount | number | | 喂养量(ml) |
| confidence | number | | 置信度 0-1 |
| metadata | object | | 附加信息 |

### 7.9-7.19 日志CRUD/确认/统计/摘要

| # | 接口 | 方法 | 路径 |
|---|------|------|------|
| 63 | 批量创建 | POST | `/api/baby-logs/batch` |
| 64 | 日志列表 | GET | `/api/baby-logs?babyId=&eventTypes=&page=&pageSize=` |
| 65 | 日志详情 | GET | `/api/baby-logs/{logId}` |
| 66 | 更新日志 | PUT | `/api/baby-logs/{logId}` |
| 67 | 删除日志 | DELETE | `/api/baby-logs/{logId}` |
| 68 | 批量删除 | DELETE | `/api/baby-logs/batch` |
| 69 | 最新日志 | GET | `/api/baby-logs/latest/{babyId}` |
| 70 | 确认日志 | POST | `/api/baby-logs/{logId}/acknowledge` |
| 71 | 批量确认 | POST | `/api/baby-logs/acknowledge/batch` |
| 72 | 日志统计 | GET | `/api/baby-logs/stats/{babyId}?startDate=&endDate=` |
| 73 | 每日摘要 | GET | `/api/baby-logs/summary/{babyId}/daily?date=` |

---

## 8. 图表统计

| # | 接口 | 方法 | 路径 |
|---|------|------|------|
| 74 | 每日摘要 | GET | `/api/babies/{babyId}/analytics/daily?date=` |
| 75 | 周报 | GET | `/api/babies/{babyId}/analytics/weekly?weekStart=` |
| 76 | 喂养模式 | GET | `/api/babies/{babyId}/analytics/feeding/pattern?days=` |
| 77 | 睡眠模式 | GET | `/api/babies/{babyId}/analytics/sleep/pattern?days=` |
| 78 | 生长百分位 | GET | `/api/babies/{babyId}/analytics/growth/percentile` |
| 79 | 生长趋势 | GET | `/api/babies/{babyId}/analytics/growth/trend?type=&months=` |

---

## 9. 侧边栏与个人信息

### 9.1 设备列表

```http
GET /api/devices
```

**查询参数**: `page`, `pageSize`, `sortBy`, `sortOrder`

### 9.2 用户绑定设备

```http
GET /api/users/me/devices
```

### 9.3 更新设备名称

```http
PUT /api/devices/{deviceId}
```

**请求体**: `{ "deviceName": string, "location": string }`

### 9.4 获取用户信息

```http
GET /api/users/me
```

### 9.5 更新用户资料

```http
PUT /api/users/me/profile
```

**请求体** (UpdateProfileRequestDTO):

| 参数 | 类型 | 说明 |
|------|------|------|
| nickname | string | 昵称 |
| gender | string | `male` / `female` / `other` |
| birthDate | string | 生日 |
| location | string | 所在地 |
| bio | string | 个人简介 |

### 9.6 上传头像

```http
POST /api/users/me/avatar
```

**请求体** (UploadAvatarRequestDTO):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| avatarUrl | string | ✅ | 头像URL |

### 9.7 修改密码

```http
PUT /api/users/me/password
```

**请求体** (ChangePasswordRequestDTO):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| oldPassword | string | ✅ | 旧密码 |
| newPassword | string | ✅ | 新密码 |

### 9.8 删除账户

```http
DELETE /api/users/me
```

**请求体** (DeleteAccountRequestDTO):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| password | string | ✅ | 确认密码 |

---

## 10. 设备设置

| # | 接口 | 方法 | 路径 | 说明 |
|---|------|------|------|------|
| 92 | 发送设备命令 | POST | `/api/devices/{deviceId}/command` | Body: `{ type, payload, timeout }` |
| 93 | 设备健康报告 | GET | `/api/devices/{deviceId}/health-report` | |
| 94 | 设备统计 | GET | `/api/devices/{deviceId}/statistics` | |
| 95 | 恢复出厂 | POST | `/api/devices/{deviceId}/control/factory-reset` | Body: `{ confirm: true }` |
| 96 | 解绑设备 | DELETE | `/api/devices/{deviceId}` | |

---

## 11. 邀请观看

全部 13 个端点基于 DeviceAccessController，路径前缀 `/api/device-access`：

| # | 接口 | 方法 | 路径 |
|---|------|------|------|
| 97 | 邀请列表 | GET | `/api/device-access/{deviceId}/invitations` |
| 98 | 创建邀请 | POST | `/api/device-access/{deviceId}/invitations` |
| 99 | 验证码接受 | POST | `/api/device-access/invitations/accept-by-code` |
| 100 | 通过ID接受 | POST | `/api/device-access/invitations/{inviteId}/accept` |
| 101 | 拒绝邀请 | POST | `/api/device-access/invitations/{inviteId}/reject` |
| 102 | 删除邀请 | DELETE | `/api/device-access/invitations/{inviteId}` |
| 103 | 更新权限 | PUT | `/api/device-access/invitations/{inviteId}/permissions` |
| 104 | 可观看设备 | GET | `/api/device-access/devices` |
| 105 | 设备权限 | GET | `/api/device-access/{deviceId}/permissions` |
| 106 | 开始观看 | POST | `/api/device-access/{deviceId}/viewing/start` |
| 107 | 结束观看 | POST | `/api/device-access/{deviceId}/viewing/end` |
| 108 | 观看历史 | GET | `/api/device-access/{deviceId}/viewing/history` |
| 109 | 清除历史 | DELETE | `/api/device-access/{deviceId}/viewing/history` |

**创建邀请请求体**: `{ "phone": string, "permissions": { "view": bool, "control": bool, ... } }`
**验证码接受请求体**: `{ "phone": string, "code": string }`
**更新权限请求体**: `{ "permissions": { ... } }`

---

## 12. 帮助中心

| # | 接口 | 方法 | 路径 |
|---|------|------|------|
| 110 | 文章列表 | GET | `/api/help/articles?category=&language=&limit=&offset=` |
| 111 | 文章详情 | GET | `/api/help/articles/{articleId}` |
| 112 | 相关文章 | GET | `/api/help/articles/{articleId}/related` |
| 113 | 搜索 | GET | `/api/help/search?keyword=&language=` |
| 114 | 热门文章 | GET | `/api/help/articles/popular?limit=` |
| 115 | 文章反馈 | POST | `/api/help/articles/{articleId}/feedback` |
| 116 | 创建工单 | POST | `/api/help/tickets` |
| 117 | 工单列表 | GET | `/api/help/tickets?status=&limit=&offset=` |
| 118 | 工单详情 | GET | `/api/help/tickets/{ticketId}` |
| 119 | 更新工单 | PUT | `/api/help/tickets/{ticketId}` |
| 120 | 关闭工单 | POST | `/api/help/tickets/{ticketId}/close` |
| 121 | 意见反馈 | POST | `/api/feedback` |

**意见反馈请求体** (SubmitFeedbackRequestDTO):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | ✅ | `bug` / `feature` / `complaint` / `other` |
| title | string | ✅ | 标题 |
| content | string | ✅ | 内容 |
| attachments | string[] | | 附件URL |

**创建工单请求体**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | ✅ | 工单标题 |
| description | string | ✅ | 问题描述 |
| ticketType | string | ✅ | `technical`/`billing`/`feature`/`bug`/`other` |
| priority | string | | `low`/`medium`/`high`/`urgent` |
| deviceId | string | | 关联设备ID |
| attachments | string[] | | 附件URL |

---

## 13. 回看时光轴

| # | 接口 | 方法 | 路径 | 说明 |
|---|------|------|------|------|
| 122 | 云存事件录像 | GET | `/api/videos/recordings/{deviceId}/events?startTime=&endTime=` | |
| 123 | 全时云存 | GET | `/api/videos/recordings/{deviceId}/recordings?date=&startTime=&endTime=` | |
| 124 | 云存储详情 | GET | `/api/videos/recordings/{deviceId}` | |
| 125 | 开通云存储 | POST | `/api/videos/recordings` | Body: `{ deviceId, packageId?, override? }` |
| 132 | 云存缩略图 | GET | `/api/videos/recordings/{deviceId}/thumbnail?thumbnail=` | |
| 133 | 批量缩略图 | POST | `/api/videos/recordings/{deviceId}/thumbnails` | Body: `{ thumbnails: [] }` |
| 134 | 设备属性数据 | GET | `/api/videos/device/{deviceId}/data` | |

> #126-131 为 storage-service 内部端点（需 ServiceAuth），APP 应通过 video-service 代理调用。

---

## 14. 基础设施

| # | 接口 | 方法 | 路径 | 说明 |
|---|------|------|------|------|
| 135 | 文件上传 | POST | `/api/storage/upload` | multipart/form-data, 字段: file + path |
| 136 | 文件URL | GET | `/api/storage/url/{key}?expiresIn=` | |
| 137 | 检查文件 | GET | `/api/storage/exists/{key}` | |
| 138 | 删除文件 | DELETE | `/api/storage/{key}` | |
| 139 | 预签名上传URL | POST | `/api/storage/upload-url` | Body: `{ key, expiresIn?, contentType?, provider? }` |
| 140 | 分片创建 | POST | `/api/storage/multipart/create` | Body: `{ key, contentType?, provider? }` |
| 141 | 分片完成 | POST | `/api/storage/multipart/complete` | Body: `{ key, uploadId, parts }` |
| 144 | 防盗链URL | POST | `/api/videos/anti-leech-url` | Body: `{ videoUrl, deviceId? }` |
| 145 | 健康检查 | GET | `/health` | 无需认证 |

> #142-143 为 `/api/v1/credentials/*` 端点，使用内部服务认证，非用户 JWT。

---

## 附录: 错误码速查

| code | 说明 |
|------|------|
| 0 | 成功 |
| 1002 | 参数错误 |
| 1006 | 资源不存在 |
| 2001 | Token无效 |
| 2002 | Token过期 |
| 2004-2007 | 登录/密码/验证码错误 |
| 2009 | 权限不足 |
| 4003 | 设备离线 |
| 9000 | 服务器错误 |
