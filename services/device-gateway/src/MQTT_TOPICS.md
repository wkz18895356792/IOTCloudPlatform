# MQTT主题设计文档

## 概述
本文档定义了 Device Gateway 与设备之间通过MQTT协议通信所使用的所有主题及其用途。Device Gateway 作为统一网关，支持多种协议（私有协议、Matter协议）的设备接入。

MQTT协议作为设备与服务间的主要通信方式，提供了轻量级、低带宽、低功耗的实时通信能力。

## 主题格式说明

### 新格式 (推荐)
```
devices/{deviceId}/{action}
matter/{nodeId}/{actionType}
```

## 设备生命周期主题

### 1. 设备注册
- **主题**: `devices/{deviceId}/register`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识，当前直接使用设备序列号",
  "serialNumber": "设备序列号",
  "productType": "产品类型(camera/screen/sensor/lock)",
  "deviceType": "设备型号(E73)",
  "firmwareVersion": "固件版本",
  "macAddress": "MAC地址(可选)",
  "protocol": "协议类型(private/matter)",
  "cloudProvider": "云服务提供商(1：aws/2：tencent/3: rji)",
  "timestamp": 1700000000000
}
```

### 1.1 设备注册响应
- **主题**: `devices/{deviceId}/register/response`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "code": 0,
  "timestamp": 1700000000000
}
```
- **code 说明**:
  - `0`: 注册成功
  - `-1`: 注册失败

### 2. 设备认证
- **主题**: `devices/{deviceId}/auth`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "token": "设备认证令牌",
  "signature": "签名(可选)",
  "timestamp": 1700000000000
}
```

### 3. 设备心跳
- **主题**: `devices/{deviceId}/heartbeat`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "timestamp": 1700000000000,
  "temperature": 35
}
```

---

## 设备数据上报主题

### 1. 设备状态上报
- **主题**: `devices/{deviceId}/status`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "status": "online/offline/standby",
  "timestamp": 1700000000000,
  "battery": 85,
  "network": 50,
  "temperature": 35,
  "humidity": 90,
}
```

### 2. 设备数据上报(预留)
- **主题**: `devices/{deviceId}/report`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "timestamp": 1700000000000,
  "data": {
    "temperature": 25.5,
    "humidity": 60,
    "airQuality": "good"
  }
}
```

### 3. 设备事件上报
- **主题**: `devices/{deviceId}/event`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "eventType": "事件类型：1-检测到哭声，2-检测到区域入侵，3-检测到物体移动，4-检测到人形",
  "timestamp": 1700000000000,
  "details": "事件详情",
  "imageUrl": "事件图片URL(可选)",
  "videoUrl": "事件视频URL(可选)",
}
```

---

## 设备命令主题

### 1. 设备命令 (服务下发)
- **主题**: `devices/{deviceId}/command`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "command": "命令类型",
  "commandId": "命令唯一ID",
  "timestamp": 1700000000000,
  "data": {
    // 命令参数
  }
}
```

### 2. 设备命令响应
- **主题**: `devices/{deviceId}/command/response`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "commandId": "命令唯一ID",
  "command": "命令类型",
  "timestamp": 1700000000000,
  "result": {
    "message": "执行结果描述"
  },
  "error": "错误信息(可选)"
}
```

---

## 设备配置主题（预留）

### 1. 设备配置请求
- **主题**: `devices/{deviceId}/config`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "timestamp": 1700000000000,
  "requestId": "请求唯一ID",
  "configKeys": ["video", "audio", "network"]
}
```

### 2. 设备配置响应
- **主题**: `devices/{deviceId}/config/response`
- **方向**: 服务 → 设备 或 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "timestamp": 1700000000000,
  "requestId": "请求唯一ID",
  "config": {
    "video": {
      "resolution": "1080p",
      "fps": 30,
      "bitrate": 4000
    },
    "audio": {
      "enabled": true,
      "volume": 80
    },
    "network": {
      "wifiSsid": "BabyMonitor_5G",
      "signalStrength": -45
    }
  }
}
```

---

## 设备凭证主题

### 1. 设备凭证请求
- **主题**: `devices/{deviceId}/credentials`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "timestamp": 1700000000000,
  "requestId": "请求唯一ID",
  "credentialTypes": ["kvs", "s3", "iot_video"]
}
```

### 2. 设备凭证响应
- **主题**: `devices/{deviceId}/credentials/response`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "设备唯一标识",
  "timestamp": 1700000000000,
  "requestId": "请求唯一ID",
  "credentials": {
    "kvs": {
      "accessKeyId": "临时访问密钥ID",
      "secretAccessKey": "临时秘密访问密钥",
      "sessionToken": "会话令牌",
      "expiration": "凭证过期时间"
    },
    "s3": {
      "accessKeyId": "临时访问密钥ID",
      "secretAccessKey": "临时秘密访问密钥",
      "sessionToken": "会话令牌",
      "expiration": "凭证过期时间",
      "bucket": "S3桶名",
      "folder": "录像存储目标文件夹，recordings"
    },
    "iot_video": {
      "productId": "产品ID",
      "deviceName": "1A2B3C4D5E6F", // SN
      "deviceSecret": "xxxxxx"    // 核心密钥
    }
  }
}
```

---

## Matter 协议主题

### 1. Matter 属性上报
- **主题**: `matter/{nodeId}/attribute`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "nodeId": 12345,
  "endpoint": 1,
  "cluster": "OnOff/LevelControl/TemperatureMeasurement",
  "attribute": "OnOff/CurrentLevel/MeasuredValue",
  "value": true,
  "timestamp": 1700000000000
}
```

### 2. Matter 命令
- **主题**: `matter/{nodeId}/command`
- **方向**: 服务 → 设备 或 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "nodeId": 12345,
  "endpoint": 1,
  "cluster": "OnOff/LevelControl",
  "command": "On/Off/Toggle/MoveToLevel",
  "args": {
    // 命令参数
  },
  "timestamp": 1700000000000
}
```

### Matter 集群 (Cluster) 列表

| 集群ID | 集群名称 | 描述 |
|--------|----------|------|
| 0x0006 | OnOff | 开关控制 |
| 0x0008 | LevelControl | 亮度/级别控制 |
| 0x0302 | TemperatureMeasurement | 温度测量 |
| 0x0304 | PressureMeasurement | 压力测量 |
| 0x0305 | FlowMeasurement | 流量测量 |
| 0x0400 | IlluminanceMeasurement | 光照测量 |
| 0x0402 | TemperatureControl | 温度控制 |

---

## 录像直存主题（摄像头直存 S3/MinIO/COS）

摄像头通过以下主题与 Device Gateway 交互，实现录像文件直存对象存储。视频流**不经过 Node.js 服务**，Node.js 仅负责生成预签名 URL、索引管理和权限控制。

### 设计原则

| 原则 | 说明 |
|------|------|
| 设备直存 | 视频文件通过 HTTP PUT 直传对象存储，不占服务器带宽/存储/性能 |
| NodeJS 只做大脑 | 负责鉴权、文件名规范、索引、过期清理 |
| S3 只做仓库 | 纯存储，7天自动清理 |
| 摄像文件名服务端生成 | 摄像文件名由服务端统一规范，格式：`recordings/{deviceId}/{YYYY-MM-DD}/{YYYYMMDDHHmmss_NNN}.{ext}` |
| 安全第一 | 摄像文件名服务端生成，摄像头不存储任何永久密钥 |

### 文件名规范

```
recordings/{deviceId}/{YYYY-MM-DD}/{YYYYMMDDHHmmss_NNN}.{ext}
```

- `deviceId` — 设备ID，按设备隔离
- `YYYY-MM-DD` — 按天分目录，便于 prefix 查询和批量清理
- `YYYYMMDDHHmmss` — 精确到秒的时间戳
- `NNN` — 3位随机序号，防止同一秒 key 冲突
- `ext` — 根据 contentType 自动检测（`video/mp2t`→`.ts`, `video/mp4`→`.mp4`）

示例：`recordings/cam_abc123/2026-04-02/20260402143000_042.ts`

### 1. 请求上传URL（小文件 < 100MB）
- **主题**: `devices/{deviceId}/recording/upload-url`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **说明**: 摄像头请求一个预签名 PUT URL，服务端生成标准化文件名，返回可直接用于 HTTP PUT 的临时 URL（默认1小时有效）
- **消息格式**:
```json
{
  "deviceId": "cam_abc123",
  "timestamp": 1700000000000,
  "requestId": "req-1700000000000-abc",
  "estimatedSize": 52428800,
  "contentType": "video/mp2t",
  "startTime": "2026-04-02T14:30:00Z"
}
```

#### 1.1 上传URL响应
- **主题**: `devices/{deviceId}/recording/upload-url/response`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "cam_abc123",
  "requestId": "req-1700000000000-abc",
  "recordingId": "uuid-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "fileKey": "recordings/cam_abc123/2026-04-02/20260402143000_042.ts",
  "uploadUrl": "https://s3.example.com/bucket/recordings/...?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...&X-Amz-Date=...&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=...",
  "expiresAt": "2026-04-02T15:30:00Z",
  "strategy": "single_put"
}
```
- **字段说明**:
  - `recordingId` — 录像唯一ID，后续注册完成时需要回传
  - `fileKey` — 服务端生成的标准化文件路径，摄像头仅用于标识
  - `uploadUrl` — 预签名 PUT URL，摄像头直接 HTTP PUT 上传视频数据
  - `expiresAt` — URL 过期时间，过期后上传将被 S3 拒绝
  - `strategy` — 上传策略：`single_put`（小文件）或 `multipart`（大文件>=100MB）

### 2. 请求分片上传（大文件 >= 100MB）
- **主题**: `devices/{deviceId}/recording/multipart/start`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **说明**: 大文件分片上传，设备先获取 uploadId 和每个分片的预签名 URL
- **消息格式**:
```json
{
  "deviceId": "cam_abc123",
  "timestamp": 1700000000000,
  "requestId": "req-1700000000000-abc",
  "estimatedSize": 536870912,
  "partCount": 10,
  "contentType": "video/mp2t",
  "startTime": "2026-04-02T14:30:00Z"
}
```

#### 2.1 分片上传响应
- **主题**: `devices/{deviceId}/recording/multipart/start/response`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "cam_abc123",
  "requestId": "req-1700000000000-abc",
  "recordingId": "uuid-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "fileKey": "recordings/cam_abc123/2026-04-02/20260402143000_042.ts",
  "uploadId": "abcdef123456",
  "partUrls": [
    { "partNumber": 1, "uploadUrl": "https://s3...?partNumber=1&uploadId=..." },
    { "partNumber": 2, "uploadUrl": "https://s3...?partNumber=2&uploadId=..." },
    { "partNumber": 3, "uploadUrl": "https://s3...?partNumber=3&uploadId=..." }
  ],
  "expiresAt": "2026-04-02T15:30:00Z"
}
```

### 3. 完成分片上传
- **主题**: `devices/{deviceId}/recording/multipart/complete`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **说明**: 所有分片上传完成后，设备上报各分片的 ETag，服务端合并分片
- **消息格式**:
```json
{
  "deviceId": "cam_abc123",
  "timestamp": 1700000000000,
  "requestId": "req-1700000000000-abc",
  "recordingId": "uuid-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "uploadId": "abcdef123456",
  "parts": [
    { "partNumber": 1, "etag": "\"etag_of_part_1\"" },
    { "partNumber": 2, "etag": "\"etag_of_part_2\"" },
    { "partNumber": 3, "etag": "\"etag_of_part_3\"" }
  ],
  "fileSize": 536870912,
  "endTime": "2026-04-02T15:00:00Z"
}
```

#### 3.1 分片上传完成响应
- **主题**: `devices/{deviceId}/recording/multipart/complete/response`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "cam_abc123",
  "requestId": "req-1700000000000-abc",
  "recordingId": "uuid-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "completed"
}
```

### 4. 确认上传完成（单次PUT）
- **主题**: `devices/{deviceId}/recording/register`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **说明**: 小文件单次 PUT 上传完成后，设备上报文件信息，服务端标记录像为已完成
- **消息格式**:
```json
{
  "deviceId": "cam_abc123",
  "timestamp": 1700000000000,
  "requestId": "req-1700000000000-abc",
  "fileKey": "recordings/cam_abc123/2026-04-02/20260402143000_042.ts",
  "fileSize": 52428800,
  "endTime": "2026-04-02T15:00:00Z"
}
```

#### 4.1 上传完成响应
- **主题**: `devices/{deviceId}/recording/register/response`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **消息格式**:
```json
{
  "deviceId": "cam_abc123",
  "requestId": "req-1700000000-abc",
  "recordingId": "uuid-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "completed"
}
```

### 错误响应格式

以上所有响应主题在请求失败时均返回：
```json
{
  "success": false,
  "requestId": "req-1700000000-abc",
  "error": "错误描述信息"
}
```

### 录像上传完整时序

```
┌─────────┐          ┌──────────────┐          ┌───────────────┐          ┌──────────┐
│ Camera  │          │Device Gateway│          │Storage Service│          │  S3/MinIO│
└────┬────┘          └──────┬───────┘          └──────┬────────┘          └────┬─────┘
     │                      │                       │                       │
     │  1. PUBLISH         │                       │                       │
     │  devices/{id}/       │  2. HTTP POST          │                       │
     │  recording/         │  /recordings/upload-url  │                       │
     │  upload-url         │                       │                       │
     │ ──────────────────> │ ──────────────────────> │                       │
     │                      │                       │  3. generateFileKey()   │
     │                      │                       │  4. getPresignedUrl()  │
     │                      │                       │  5. INSERT DB(PENDING) │
     │                      │  6. response          │                       │
     │                      │ <────────────────────── │                       │
     │  7. SUBSCRIBE        │                       │                       │
     │  devices/{id}/       │                       │                       │
     │  recording/         │                       │                       │
     │  upload-url/        │                       │                       │
     │  response          │                       │                       │
     │ <────────────────── │                       │                       │
     │                      │                       │                       │
     │  8. HTTP PUT        │                       │                       │
     │  (video data)       │                       │                       │
     │ ─────────────────────────────────────────────────────────────────────────>│
     │                      │                       │                       │
     │  9. PUBLISH         │                       │                       │
     │  devices/{id}/       │  10. HTTP POST         │                       │
     │  recording/         │  /recordings/register  │                       │
     │  register           │                       │                       │
     │ ──────────────────> │ ──────────────────────> │                       │
     │                      │                       │  11. UPDATE DB         │
     │                      │  (PENDING→COMPLETED)   │                       │
     │                      │  12. response         │                       │
     │                      │ <────────────────────── │                       │
     │  13. SUBSCRIBE       │                       │                       │
     │  devices/{id}/       │                       │                       │
     │  recording/         │                       │                       │
     │  register/response  │                       │                       │
     │ <────────────────── │                       │                       │
```

---

## OTA 固件升级主题

### 设计原则

| 原则 | 说明 |
|------|------|
| 命令统一用 `action` 字段 | 所有 OTA 命令通过 `devices/{deviceId}/command` 主题下发，使用 `action` 字段区分命令类型 |
| 进度/结果独立主题 | 设备上报进度和结果使用专用主题，与服务端 command 主题分离 |
| 预签名 URL 实时生成 | 固件下载 URL 在创建 OTA 任务时实时从 storage-service 获取，不存储一次性 URL |

### 状态流转

```
                    ┌──────────┐
                    │  pending  │
                    └─────┬────┘
                          │ ota_download
                    ┌─────▼────┐
              ┌─────│downloading│─────┐
              │     └──────────┘     │
        (进度上报)              (下载完成)
              │                     │
              │              ┌──────▼──────┐
              │              │ installing  │
              │              └──────┬──────┘
              │                     │ (安装完成)
              │         ┌───────────┼───────────┐
              │         │           │           │
              │    ┌────▼───┐ ┌────▼───┐ ┌────▼───┐
              │    │completed│ │ failed │ │ paused │
              │    └────────┘ └────────┘ └───┬────┘
              │                                │ (恢复)
              │                    ┌───────────┘
              │                    │
              │              ┌─────▼────┐
              └──────────────│cancelled │
                             └──────────┘
```

### 1. 下发固件下载命令
- **主题**: `devices/{deviceId}/command`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **说明**: OTA 任务创建时，服务端实时从 storage-service 获取固件文件的预签名下载 URL，通过此命令下发给设备。`fileUrl` 为临时预签名 URL（默认1小时有效），设备应在有效期内发起下载。
- **消息格式**:
```json
{
  "id": "uuid-xxxx-xxxx",
  "action": "ota_download",
  "taskId": "ota-task-uuid",
  "version": "2.0.0",
  "fileUrl": "https://bucket.cos.ap-guangzhou.myqcloud.com/firmware/...?q-sign-algorithm=sha1&...",
  "fileSize": 2097152,
  "checksum": "a1b2c3d4e5f6...（SHA256 哈希值）",
  "isForced": false,
  "timestamp": 1700000000000
}
```
- **字段说明**:
  - `id` — 命令唯一 ID
  - `action` — 命令类型：`ota_download`
  - `taskId` — OTA 任务 ID，设备上报进度和结果时需回传
  - `version` — 目标固件版本号
  - `fileUrl` — 固件文件预签名下载 URL（COS/S3/MinIO），有时效性
  - `fileSize` — 文件大小（字节），设备可用于进度计算
  - `checksum` — 文件校验和（SHA256），设备下载完成后校验文件完整性
  - `isForced` — 是否强制升级（`true` 时设备必须执行，不可延迟）

### 2. 下发固件安装命令
- **主题**: `devices/{deviceId}/command`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **说明**: 设备上报下载完成（进度100%）后，服务端自动下发安装命令。设备收到后执行固件安装。
- **消息格式**:
```json
{
  "id": "uuid-xxxx-xxxx",
  "action": "ota_install",
  "taskId": "ota-task-uuid",
  "timestamp": 1700000000000
}
```

### 3. 上报 OTA 进度
- **主题**: `devices/{deviceId}/ota/progress`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **说明**: 设备在下载和安装过程中定期上报进度。当下载进度达到100%时，服务端自动下发 `ota_install` 命令。
- **消息格式**:
```json
{
  "deviceId": "cam_abc123",
  "taskId": "ota-task-uuid",
  "progress": 50,
  "status": "downloading",
  "timestamp": 1700000000000
}
```
- **字段说明**:
  - `taskId` — 对应的 OTA 任务 ID
  - `progress` — 进度百分比（0-100）
  - `status` — 当前阶段：`downloading`（下载中）或 `installing`（安装中）

### 4. 上报 OTA 结果
- **主题**: `devices/{deviceId}/ota/result`
- **方向**: 设备 → 服务
- **QoS级别**: 1 (至少一次传递)
- **说明**: 设备上报固件升级最终结果。升级成功后服务端自动更新设备固件版本号并下发重启命令。
- **消息格式（成功）**:
```json
{
  "deviceId": "cam_abc123",
  "taskId": "ota-task-uuid",
  "success": true,
  "version": "2.0.0",
  "timestamp": 1700000000000
}
```
- **消息格式（失败）**:
```json
{
  "deviceId": "cam_abc123",
  "taskId": "ota-task-uuid",
  "success": false,
  "error": "Network timeout during download",
  "timestamp": 1700000000000
}
```
- **字段说明**:
  - `success` — 升级是否成功
  - `version` — 升级后的固件版本（成功时）
  - `error` — 失败原因描述（失败时）

### 5. 下发取消升级命令
- **主题**: `devices/{deviceId}/command`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **说明**: 管理员取消 OTA 任务时下发，设备停止下载/安装。
- **消息格式**:
```json
{
  "id": "uuid-xxxx-xxxx",
  "action": "ota_cancel",
  "taskId": "ota-task-uuid",
  "timestamp": 1700000000000
}
```

### 6. 下发暂停升级命令
- **主题**: `devices/{deviceId}/command`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **说明**: 暂停当前正在进行的下载或安装。
- **消息格式**:
```json
{
  "id": "uuid-xxxx-xxxx",
  "action": "ota_pause",
  "taskId": "ota-task-uuid",
  "timestamp": 1700000000000
}
```

### 7. 下发恢复升级命令
- **主题**: `devices/{deviceId}/command`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **说明**: 恢复已暂停的升级任务。
- **消息格式**:
```json
{
  "id": "uuid-xxxx-xxxx",
  "action": "ota_resume",
  "taskId": "ota-task-uuid",
  "timestamp": 1700000000000
}
```

### 8. 下发重启命令（升级完成后）
- **主题**: `devices/{deviceId}/command`
- **方向**: 服务 → 设备
- **QoS级别**: 1 (至少一次传递)
- **说明**: 固件安装成功后，服务端自动下发重启命令使新固件生效。设备重启后重新注册时，服务端通过固件版本号自动完成 OTA 任务。
- **消息格式**:
```json
{
  "id": "uuid-xxxx-xxxx",
  "action": "reboot",
  "taskId": "ota-task-uuid",
  "timestamp": 1700000000000
}
```

### OTA 升级完整时序

```
┌─────────┐          ┌──────────────┐          ┌───────────────┐          ┌──────────┐
│  Device │          │Device Gateway│          │ Device Service │          │  COS/S3  │
└────┬────┘          └──────┬───────┘          └──────┬────────┘          └────┬─────┘
     │                      │                       │                       │
     │                      │  1. 创建OTA任务        │                       │
     │                      │  2. 获取预签名下载URL    │                       │
     │                      │ <───────────────────── │ ─────────────────────>│
     │                      │                       │                       │
     │  3. PUBLISH          │                       │                       │
     │  devices/{id}/       │                       │                       │
     │  command             │  4. 路由到 device-     │                       │
     │  {action:            │     service            │                       │
     │   ota_download}      │                       │                       │
     │ <────────────────── │                       │                       │
     │                      │                       │                       │
     │  5. HTTP GET         │                       │                       │
     │  (下载固件文件)       │                       │                       │
     │ ──────────────────────────────────────────────────────────────────────>│
     │                      │                       │                       │
     │  6. PUBLISH          │                       │                       │
     │  devices/{id}/       │  7. 路由到 device-     │                       │
     │  ota/progress        │     service            │                       │
     │ ──────────────────> │ ─────────────────────> │                       │
     │                      │                       │                       │
     │  ...(重复进度上报)... │                       │                       │
     │                      │                       │                       │
     │  8. PUBLISH          │                       │                       │
     │  devices/{id}/       │  9. 路由到 device-     │                       │
     │  ota/progress        │     service            │                       │
     │  (progress:100)      │                       │ 10. 自动下发安装命令    │
     │ ──────────────────> │ ─────────────────────> │                       │
     │                      │                       │                       │
     │ 11. PUBLISH          │                       │                       │
     │  devices/{id}/       │  12. 路由到 device-    │                       │
     │  command             │     service            │                       │
     │  {action:            │                       │                       │
     │   ota_install}       │                       │                       │
     │ <────────────────── │ <───────────────────── │                       │
     │                      │                       │                       │
     │ 13. PUBLISH          │                       │                       │
     │  devices/{id}/       │  14. 路由到 device-    │                       │
     │  ota/result          │     service            │                       │
     │  {success:true}      │                       │ 15. 更新设备版本       │
     │ ──────────────────> │ ─────────────────────> │     下发重启命令       │
     │                      │                       │                       │
     │ 16. PUBLISH          │                       │                       │
     │  devices/{id}/       │                       │                       │
     │  command             │                       │                       │
     │  {action:reboot}     │                       │                       │
     │ <────────────────── │ <───────────────────── │                       │
     │                      │                       │                       │
     │ 17. PUBLISH          │                       │                       │
     │  devices/{id}/       │  18. 设备重注册        │                       │
     │  register            │  19. 自动完成OTA任务    │                       │
     │  (firmwareVersion:   │                       │                       │
     │   "2.0.0")           │                       │                       │
     │ ──────────────────> │ ─────────────────────> │                       │
```

---

## 设备日志主题

### 设计原则

| 原则 | 说明 |
|------|------|
| 复用 command 主题 | 平台主动打捞通过 `devices/{deviceId}/command` 下发，action=`collect_logs` |
| 设备可主动上报 | 设备通过独立日志主题请求预签名URL，自主上传日志 |
| 直存对象存储 | 日志文件通过 HTTP PUT 直传对象存储，不经过 Node.js 服务 |
| 文件名服务端生成 | 日志文件名由服务端统一规范，格式：`logs/{deviceId}/{YYYY-MM-DD}/{timestamp}.log` |

### 文件名规范

```
logs/{deviceId}/{YYYY-MM-DD}/{YYYYMMDDHHMMSSmss}.log
```

- `deviceId` — 设备ID，按设备隔离
- `YYYY-MM-DD` — 按天分目录
- `YYYYMMDDHHMMSSmss` — 精确到毫秒的时间戳

示例：`logs/cam_abc123/2026-05-26/20260526143000123.log`

### 1. 设备请求日志上传URL（设备主动）
- **主题**: `devices/{deviceId}/logs/upload-url`
- **方向**: 设备 → 服务
- **QoS级别**: 1
- **消息格式**:
```json
{
  "deviceId": "cam_abc123",
  "timestamp": 1700000000000,
  "requestId": "req-xxx",
  "estimatedSize": 5242880,
  "logType": "system",
  "description": "crash log"
}
```

#### 1.1 上传URL响应
- **主题**: `devices/{deviceId}/logs/upload-url/response`
- **方向**: 服务 → 设备
- **消息格式**:
```json
{
  "requestId": "req-xxx",
  "logId": "uuid-xxxx",
  "fileKey": "logs/cam_abc123/2026-05-26/20260526143000123.log",
  "uploadUrl": "https://s3...presigned...",
  "expiresAt": "2026-05-26T15:30:00Z"
}
```

### 2. 确认日志上传完成（设备主动）
- **主题**: `devices/{deviceId}/logs/register`
- **方向**: 设备 → 服务
- **消息格式**:
```json
{
  "deviceId": "cam_abc123",
  "timestamp": 1700000000000,
  "requestId": "req-xxx",
  "logId": "uuid-xxxx",
  "fileKey": "logs/cam_abc123/2026-05-26/20260526143000123.log",
  "fileSize": 5242880
}
```

#### 2.1 注册响应
- **主题**: `devices/{deviceId}/logs/register/response`
- **方向**: 服务 → 设备
- **消息格式**:
```json
{
  "requestId": "req-xxx",
  "logId": "uuid-xxxx",
  "status": "completed"
}
```

### 3. 平台下发日志打捞命令
- **主题**: `devices/{deviceId}/command`（复用已有命令主题）
- **方向**: 服务 → 设备
- **说明**: 平台调用 `POST /api/devices/{deviceId}/logs/collect` 后，服务端自动获取预签名URL并通过此命令下发给设备
- **消息格式**:
```json
{
  "id": "log-xxx",
  "action": "collect_logs",
  "taskId": "log-task-uuid",
  "uploadUrl": "https://s3...presigned...",
  "fileKey": "logs/cam_abc123/2026-05-26/20260526143000123.log",
  "logType": "system",
  "expiresAt": "2026-05-26T15:30:00Z",
  "description": "crash log",
  "timestamp": 1700000000000
}
```

### 4. 设备上报日志打捞结果（平台主动）
- **主题**: `devices/{deviceId}/logs/collect/status`
- **方向**: 设备 → 服务
- **消息格式（成功）**:
```json
{
  "deviceId": "cam_abc123",
  "timestamp": 1700000000000,
  "taskId": "log-task-uuid",
  "status": "completed",
  "fileSize": 5242880
}
```
- **消息格式（失败）**:
```json
{
  "deviceId": "cam_abc123",
  "timestamp": 1700000000000,
  "taskId": "log-task-uuid",
  "status": "failed",
  "error": "upload timeout"
}
```

### 日志上传完整时序

#### 设备主动上报
```
┌─────────┐          ┌──────────────┐          ┌───────────────┐          ┌──────────┐
│  Device │          │Device Gateway│          │Storage Service│          │  S3/MinIO│
└────┬────┘          └──────┬───────┘          └──────┬────────┘          └────┬─────┘
     │  1. PUBLISH          │                       │                       │
     │  logs/upload-url     │  2. HTTP POST          │                       │
     │ ──────────────────> │  /device-logs/          │                       │
     │                      │  upload-url            │                       │
     │                      │ ─────────────────────> │                       │
     │                      │  3. 生成预签名URL        │                       │
     │                      │ <───────────────────── │                       │
     │  4. SUBSCRIBE        │                       │                       │
     │  logs/upload-url/    │                       │                       │
     │  response            │                       │                       │
     │ <────────────────── │                       │                       │
     │                      │                       │                       │
     │  5. HTTP PUT (log)   │                       │                       │
     │ ──────────────────────────────────────────────────────────────────────>│
     │                      │                       │                       │
     │  6. PUBLISH          │  7. HTTP POST          │                       │
     │  logs/register       │  /device-logs/         │                       │
     │ ──────────────────> │  register              │                       │
     │                      │ ─────────────────────> │                       │
     │                      │  8. 更新状态COMPLETED   │                       │
     │  9. SUBSCRIBE        │ <───────────────────── │                       │
     │  logs/register/      │                       │                       │
     │  response            │                       │                       │
     │ <────────────────── │                       │                       │
```

#### 平台主动打捞
```
┌─────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────┐
│  Device │     │Device Gateway│     │ Device Service │     │  S3/MinIO│
└────┬────┘     └──────┬───────┘     └──────┬────────┘     └────┬─────┘
     │                 │                    │                    │
     │                 │  1. POST /logs/     │                    │
     │                 │  collect            │                    │
     │                 │ <────────────────── │                    │
     │                 │  2. 获取预签名URL     │                    │
     │                 │ ──────────────────>Storage Service       │
     │                 │ <───────────────── │                    │
     │                 │                    │                    │
     │  3. PUBLISH     │                    │                    │
     │  command        │                    │                    │
     │  (collect_logs) │                    │                    │
     │ <──────────────│                    │                    │
     │                 │                    │                    │
     │  4. HTTP PUT    │                    │                    │
     │  (log data)     │                    │                    │
     │ ──────────────────────────────────────────────────────────>│
     │                 │                    │                    │
     │  5. PUBLISH     │  6. 路由到          │                    │
     │  logs/collect/  │  device-service    │                    │
     │  status         │                    │                    │
     │ ──────────────>│ ──────────────────>│                    │
     │                 │                    │  7. 更新日志记录     │
```

---

## 常用控制命令

### 1. 重启设备
```json
{
  "command": "reboot",
  "data": {
    "delay": 5
  },
  "commandId": "cmd-1700000000000"
}
```

### 2. 恢复出厂设置
```json
{
  "command": "factory_reset",
  "data": {
    "confirm": true
  },
  "commandId": "cmd-1700000000000"
}
```

### 3. 开始录像
```json
{
  "command": "start_recording",
  "data": {
    "duration": 60,
    "resolution": "1080p"
  },
  "commandId": "cmd-1700000000000"
}
```

### 4. 停止录像
```json
{
  "command": "stop_recording",
  "data": {},
  "commandId": "cmd-1700000000000"
}
```

### 5. 静音/取消静音
```json
{
  "command": "mute",
  "data": {
    "muted": true
  },
  "commandId": "cmd-1700000000000"
}
```

### 6. 播放音乐
```json
{
  "command": "play_lullaby",
  "data": {
    "musicId": 1,
    "volume": 50
  },
  "commandId": "cmd-1700000000000"
}
```

### 7. 云台控制
```json
{
  "command": "ptz",
  "data": {
    "direction": "left",
    "angle": 120,
    "speed": 2
  },
  "commandId": "cmd-1700000000000"
}
```

### 8. 设置分辨率
```json
{
  "command": "resolution",
  "data": {
    "resolution": "1080p"
  },
  "commandId": "cmd-1700000000000"
}
```

### 9. 固件升级
> **注意**: OTA 固件升级已迁移至统一的 `action` 命令格式，详见上方「OTA 固件升级主题」章节。以下旧格式仅作向后兼容保留。
```json
{
  "command": "upgrade",
  "data": {
    "version": "1.2.3",
    "fileUrl": "https://ota.example.com/firmware/v1.2.3.bin",
    "fileSize": 1024000,
    "md5": "abc123..."
  },
  "commandId": "cmd-1700000000000"
}
```

### 10. 配置更新
```json
{
  "command": "config",
  "data": {
    "video": {
      "resolution": "1080p",
      "fps": 30,
      "bitrate": 4000
    },
    "audio": {
      "enabled": true,
      "volume": 80
    },
    "network": {
      "wifiSsid": "BabyMonitor_5G"
    }
  },
  "commandId": "cmd-1700000000000"
}
```

### 11. 开始推流
```json
{
  "command": "start_stream",
  "data": {
    "resolution": "1080p",
    "fps": 30,
    "bitrate": 4000
  },
  "commandId": "cmd-1700000000000"
}
```

### 12. 停止推流
```json
{
  "command": "stop_stream",
  "data": {},
  "commandId": "cmd-1700000000000"
}
```

### 13. 抓拍图片
```json
{
  "command": "capture_image",
  "data": {
    "resolution": "1080p"
  },
  "commandId": "cmd-1700000000000"
}
```

---

## 错误码

```json
E_UNKNOWN: -1,           // 未知错误
OK: 0,                    // 成功
E_FORMAT: 1,              // 数据格式错误
E_REQUEST: 2,             // 请求失败
E_PARAMS: 3,              // 参数错误
E_SIGN: 4,                // 签名错误
E_UNAUTHORIZED: 5,        // 未授权
E_FORBIDDEN: 6,           // 禁止访问
E_NOT_FOUND: 7,           // 资源不存在
E_TIMEOUT: 8,             // 超时
E_SERVICE_UNAVAILABLE: 9, // 服务不可用
E_OBJECT_NULL: 101,       // 对象不存在
E_OBJECT_EXISTS: 102,     // 对象已存在
E_OBJECT_ENABLE: 103,     // 对象已被禁用
E_OBJECT_UNSUPPORTED: 104 // 对象不支持当前操作
```

---

## 协议类型

```typescript
enum DeviceProtocol {
  PRIVATE = 'private',  // 私有协议
  MATTER = 'matter'     // Matter 协议
}
```

---

## 订阅主题列表

Device Gateway 启动时订阅以下主题模式：

```
devices/+/register
devices/+/auth
devices/+/heartbeat
devices/+/report
devices/+/status
devices/+/event
devices/+/command/response
devices/+/config/request
devices/+/config/response
devices/+/credentials
devices/+/credentials/response
matter/+/attribute
matter/+/command
devices/+/recording/upload-url
devices/+/recording/upload-url/response
devices/+/recording/multipart/start
devices/+/recording/multipart/start/response
devices/+/recording/multipart/complete
devices/+/recording/multipart/complete/response
devices/+/recording/register
devices/+/recording/register/response
// OTA 固件升级
devices/+/ota/progress
devices/+/ota/result
// 设备日志
devices/+/logs/upload-url
devices/+/logs/register
devices/+/logs/collect/status
```

---

## 消息流转说明

1. **设备上线流程**:
   - 设备发送注册消息到 `devices/{deviceId}/register`
   - 网关转发到 device-service 进行设备创建
   - 设备发送认证消息到 `devices/{deviceId}/auth`
   - 认证成功后设备开始定期发送心跳到 `devices/{deviceId}/heartbeat`

2. **数据上报流程**:
   - 设备定期上报状态到 `devices/{deviceId}/status`
   - 设备上报传感器数据到 `devices/{deviceId}/report`
   - 设备上报事件(如哭声检测)到 `devices/{deviceId}/event`

3. **命令执行流程**:
   - 服务下发命令到 `devices/{deviceId}/command`
   - 设备执行命令后响应到 `devices/{deviceId}/command/response`

4. **Matter 设备流程**:
   - Matter 设备通过 `matter/{nodeId}/attribute` 上报属性变化
   - 服务通过 `matter/{nodeId}/command` 下发控制命令

5. **录像直存流程（摄像头直存 S3/MinIO/COS）**:
   - 摄像头请求上传URL：`devices/{deviceId}/recording/upload-url` → 响应：`devices/{deviceId}/recording/upload-url/response`
   - 大文件分片上传：`devices/{deviceId}/recording/multipart/start` → 响应：`devices/{deviceId}/recording/multipart/start/response`
   - 分片上传完成：`devices/{deviceId}/recording/multipart/complete` → 响应：`devices/{deviceId}/recording/multipart/complete/response`
   - 单次上传完成确认：`devices/{deviceId}/recording/register` → 响应：`devices/{deviceId}/recording/register/response`
   - 视频文件由摄像头通过 HTTP PUT 直传对象存储，**不经过 Node.js 服务**

 6. **OTA 固件升级流程**:
   - 管理员创建 OTA 任务 → 服务端实时获取固件预签名下载 URL → 下发 `ota_download` 命令到 `devices/{deviceId}/command`
   - 设备下载固件，定期上报进度到 `devices/{deviceId}/ota/progress`
   - 下载完成后服务端自动下发 `ota_install` 命令
   - 设备安装完成后上报结果到 `devices/{deviceId}/ota/result`
   - 升级成功后服务端更新设备版本并下发 `reboot` 命令
   - 设备重启后重新注册，服务端自动完成 OTA 任务
