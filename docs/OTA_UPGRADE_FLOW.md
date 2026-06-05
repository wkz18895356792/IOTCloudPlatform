# OTA 固件升级流程文档

## 一、整体架构

```
                         ┌──────────────────────────────────────────────────────────────┐
                         │                     云平台 (Cloud)                            │
                         │                                                              │
  ┌─────────┐            │  ┌──────────┐    ┌────────────────┐    ┌────────────────┐   │
  │ 管理员/App│───────────│─>│api-gateway│───>│ device-service │───>│ storage-service│   │
  └─────────┘  HTTP/HTTPS │  └──────────┘    │  (OTAService)  │    │   (S3/COS)     │   │
                            │                  └───────┬────────┘    └────────────────┘   │
                            │                          │ MQTT Pub                       │
                            │  ┌──────────────────┐    │    ┌──────────────────────┐    │
                            │  │  device-gateway   │<───┘    │     MySQL 数据库       │    │
                            │  │ (Message Router)  │         │  firmware_versions    │    │
                            │  └────────┬─────────┘         │  ota_tasks            │    │
                            │           │                    │  devices              │    │
                            │           │ MQTT Sub           └──────────────────────┘    │
                            └───────────┼────────────────────────────────────────────────┘
                                        │
                                   MQTT Broker
                                        │
                            ┌───────────┼───────────┐
                            │           │           │
                         ┌──┴──┐    ┌──┴──┐    ┌──┴──┐
                         │设备 A│    │设备 B│    │设备 C│
                         └─────┘    └─────┘    └─────┘
```

**涉及服务与文件：**

| 服务 | 核心文件 | 职责 |
|------|---------|------|
| api-gateway | `config/service-routes.config.ts` | 路由 `/api/firmware` 到 device-service |
| device-gateway | `service/core/gateway-core.service.ts` | MQTT 主题订阅、OTA 命令下发 |
| device-gateway | `service/core/message-router.service.ts` | 消息路由规则、主题到消息类型映射 |
| device-gateway | `types/mqtt-messages.ts` | MQTT 消息类型、接口、命令枚举定义 |
| device-service | `service/ota.service.ts` | OTA 核心业务逻辑（任务创建、进度跟踪、状态管理） |
| device-service | `controller/firmware.controller.ts` | REST API 端点（版本管理、任务管理、文件上传） |
| device-service | `subscriber/device-message.subscriber.ts` | 处理来自 gateway 转发的设备消息 |
| device-service | `service/firmware-signature.service.ts` | 固件签名验证与撤销管理 |
| storage-service | `provider/s3.provider.ts` / `cos.provider.ts` | 文件存储、预签名 URL 生成 |

---

## 二、完整流程节点

### 流程全景图

```
节点1        节点2            节点3           节点4            节点5
获取上传URL → 上传固件文件 → 确认上传创版本 → 创建OTA任务 → 下发下载命令
                                                              │
                                     节点12 ← 设备重注册 ← 节点11
                                        │                      │
                                   同步OTA任务              设备重启
                                        │                      │
                                        ↓                      │
                                     任务完成 ←────────────────┘

                     节点6            节点7             节点8          节点9
               设备下载固件 ──→ 设备上报进度 ──→ 下载完成 ──→ 下发安装命令
                                    (多次)            │              │
                                                      ↓              ↓
                                                节点10           节点10'
                                              设备安装固件      设备上报结果
                                                    │              │
                                                    ↓              ↓
                                                 成功/失败      成功→重启
                                                                失败→标记failed
```

---

### 节点 1：获取固件上传预签名 URL

**触发方**: 管理员/App

**入口**: `POST /api/firmware/upload-url`

**控制器**: [firmware.controller.ts:191-252](services/device-service/src/controller/firmware.controller.ts#L191-L252)

```typescript
// FirmwareController.getFirmwareUploadUrl()
```

**逻辑流程**:

1. 接收参数：`{ productId, version, fileSize, checksum, checksumType?, contentType? }`
2. 生成存储 key：`firmware/{productId}/{version}/{timestamp}-firmware.bin`
3. 通过 `ServiceClient.post('storage-service', '/api/storage/upload-url', ...)` 调用 storage-service 获取预签名 URL
4. 返回给客户端：`{ uploadUrl, key, expiresIn: 3600, checksum, checksumType }`

**请求示例**:
```json
{
  "productId": "PROD-camera-v2",
  "version": "2.1.0",
  "fileSize": 524288,
  "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "checksumType": "sha256"
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://bucket.s3.amazonaws.com/firmware/PROD-camera-v2/2.1.0/...?X-Amz-Expires=3600&...",
    "key": "firmware/PROD-camera-v2/2.1.0/1700000000000-firmware.bin",
    "expiresIn": 3600
  }
}
```

---

### 节点 2：上传固件文件到存储

**触发方**: 管理员/App（直传 S3/COS）

**入口**: `PUT {uploadUrl}`（预签名 URL，由客户端直接调用）

**逻辑流程**:

1. 客户端使用步骤 1 返回的 `uploadUrl`
2. 通过 `HTTP PUT` 直接将固件二进制文件上传到 S3/COS
3. 文件不经过 device-service，减轻服务端压力

**示例**:
```bash
curl -X PUT -T firmware-v2.1.0.bin \
  "https://bucket.s3.amazonaws.com/firmware/PROD-camera-v2/2.1.0/...?X-Amz-Expires=3600&..."
```

---

### 节点 3：确认上传并创建固件版本记录

**触发方**: 管理员/App

**入口**: `POST /api/firmware/versions/confirm`

**控制器**: [firmware.controller.ts:257-329](services/device-service/src/controller/firmware.controller.ts#L257-L329)

```typescript
// FirmwareController.confirmFirmwareUpload()
```

**逻辑流程**:

1. 接收参数：`{ productId, version, releaseNotes, fileKey, fileSize, checksum, checksumType?, isForced?, isBeta?, minVersion?, maxVersion? }`
2. 调用 `ServiceClient.get('storage-service', '/api/storage/url/{fileKey}')` 获取文件下载 URL
3. 调用 `OTAService.uploadFirmware()` 创建版本记录

**服务层**: [ota.service.ts:71-109](services/device-service/src/service/ota.service.ts#L71-L109)

```typescript
// OTAService.uploadFirmware()
```

**内部逻辑**:

| 步骤 | 说明 |
|------|------|
| 校验和格式验证 | SHA256 应为 64 位十六进制，MD5 应为 32 位十六进制 |
| 重复版本检查 | 同一产品不允许存在相同版本号的固件 |
| 创建实体记录 | 写入 `firmware_versions` 表 |

**数据库表**: `firmware_versions`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| productId | varchar(64) | 产品ID |
| version | varchar(32) | 版本号 |
| releaseNotes | text | 更新说明 |
| fileUrl | varchar(512) | 文件下载URL |
| fileSize | bigint | 文件大小 |
| checksum | varchar(128) | 校验和 |
| checksumType | enum(md5, sha256) | 校验和类型 |
| isForced | boolean | 是否强制升级 |
| isBeta | boolean | 是否测试版 |
| isActive | boolean | 是否启用 |
| versionName | varchar(64) | 版本名称 |
| minVersion | varchar(32) | 最低可升级版本 |
| maxVersion | varchar(32) | 最高可升级版本 |

---

### 节点 4：创建 OTA 升级任务

**触发方**: 管理员/App

**入口**: `POST /api/firmware/ota/tasks`

**控制器**: [firmware.controller.ts:336-386](services/device-service/src/controller/firmware.controller.ts#L336-L386)

```typescript
// FirmwareController.createOTATask()
```

**服务层**: [ota.service.ts:193-268](services/device-service/src/service/ota.service.ts#L193-L268)

```typescript
// OTAService.createOTATask()
```

**内部逻辑**:

```
1. 校验设备存在 ──→ 不存在则抛出 "Device not found"
2. 校验固件存在 ──→ 不存在则抛出 "Firmware not found"
3. 版本兼容性检查 ──→ device.firmwareVersion 须在 [minVersion, maxVersion] 范围内
4. 进行中任务检查 ──→ 不允许重复创建（pending/downloading/installing）
5. 固件撤销检查 ──→ 调用 FirmwareSignatureService.isRevoked()
6. 创建 OTATask 实体（status: pending, progress: 0）
7. 调用 notifyDeviceToDownload() 下发下载命令
```

**数据库表**: `ota_tasks`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 任务ID |
| deviceId | UUID | 设备ID |
| firmwareId | UUID | 固件版本ID |
| fromVersion | varchar(32) | 当前版本 |
| toVersion | varchar(32) | 目标版本 |
| status | enum | 任务状态（见下方状态机） |
| progress | int | 进度（0-100） |
| error | text | 错误信息 |
| startedAt | timestamp | 开始时间 |
| completedAt | timestamp | 完成时间 |
| createdBy | UUID | 创建者 |
| createdAt | timestamp | 创建时间 |

**任务状态机**:

```
                    ┌──────────┐
                    │ pending  │
                    └────┬─────┘
                         │ notifyDeviceToDownload()
                         ↓
                    ┌──────────┐
             ┌─────│downloading│─────┐
             │     └────┬─────┘     │
             │          │           │
        ota_pause       │    progress=100
             │          │           │
             ↓          │           ↓
        ┌────────┐      │    ┌──────────┐
        │ paused │──────┘    │installing│
        └────────┘ ota_resume└────┬─────┘
                                  │
                        ┌─────────┼─────────┐
                        ↓                   ↓
                   ┌──────────┐        ┌───────────┐
                   │completed │        │  failed   │
                   └──────────┘        └─────┬─────┘
                                            │
                                            ↓
                                      ┌────────────┐
                                      │rolled_back │
                                      └────────────┘
```

---

### 节点 5：下发 OTA 下载命令（云 → 设备）

**触发方**: OTAService 内部调用

**服务层**: [ota.service.ts:406-430](services/device-service/src/service/ota.service.ts#L406-L430)

```typescript
// OTAService.notifyDeviceToDownload()
```

**内部逻辑**:

1. 构造 MQTT 消息，`action: 'ota_download'`
2. 通过 `MqttService.publish()` 发布到 MQTT topic `devices/{deviceId}/command`
3. 更新任务状态为 `downloading`，进度设为 0

**MQTT 消息格式**:

Topic: `devices/{deviceId}/command`

```json
{
  "id": "uuid",
  "action": "ota_download",
  "taskId": "ota-task-uuid",
  "version": "2.1.0",
  "fileUrl": "https://bucket.s3.amazonaws.com/firmware/...",
  "fileSize": 524288,
  "checksum": "e3b0c44298fc1c14...",
  "isForced": false,
  "timestamp": 1700000000000
}
```

---

### 节点 6：设备下载固件（设备端）

**触发方**: 设备端

**逻辑**: 设备收到 `ota_download` 命令后：

1. 解析消息中的 `fileUrl`、`fileSize`、`checksum`
2. 通过 HTTP(S) 下载固件文件
3. 下载过程中定期上报进度（节点 7）
4. 下载完成后本地校验 `checksum`（MD5 或 SHA256）

---

### 节点 7：设备上报 OTA 进度（设备 → 云）

**触发方**: 设备端

**MQTT 主题**: `devices/{deviceId}/ota/progress`

**消息格式**:

```json
{
  "deviceId": "device-001",
  "taskId": "ota-task-uuid",
  "progress": 50,
  "status": "downloading",
  "timestamp": 1700000000000
}
```

**消息路由链路**:

```
设备 MQTT 发布
  → topic: devices/{deviceId}/ota/progress
  → device-gateway 订阅该主题
  → MessageRouterService.routeMessage() 匹配路由规则
  → getMessageTypeFromTopic() 返回 OTA_PROGRESS
  → GatewayCoreService.publishToService('device-service', message)
  → Redis Pub/Sub channel: service:device-service
```

**路由配置**: [message-router.service.ts](services/device-gateway/src/service/core/message-router.service.ts)

```typescript
{
  name: 'OTA Progress Report',
  topicPattern: /^devices\/([^/]+)\/ota\/progress$/,
  target: { type: 'service', destination: 'device-service' },
  enabled: true,
  priority: 85,
}
```

**订阅配置**: [gateway-core.service.ts](services/device-gateway/src/service/core/gateway-core.service.ts) topics 数组中包含 `'devices/+/ota/progress'`

---

### 节点 8：下载完成触发安装命令

**触发方**: OTAService 内部逻辑

**服务层**: [ota.service.ts:571-588](services/device-service/src/service/ota.service.ts#L571-L588)

```typescript
// OTAService.handleOTAPProgress()
```

**内部逻辑**:

```typescript
// 当下载进度上报到 100% 时，自动下发安装命令
if (status === 'downloading' && progress >= 100) {
  await this.notifyDeviceToInstall(taskId, task.deviceId);
}
```

---

### 节点 9：下发 OTA 安装命令（云 → 设备）

**触发方**: OTAService 内部调用

**服务层**: [ota.service.ts:464-479](services/device-service/src/service/ota.service.ts#L464-L479)

```typescript
// OTAService.notifyDeviceToInstall()
```

**MQTT 消息格式**:

Topic: `devices/{deviceId}/command`

```json
{
  "id": "uuid",
  "action": "ota_install",
  "taskId": "ota-task-uuid",
  "timestamp": 1700000000000
}
```

---

### 节点 10：设备安装固件 / 上报结果（设备端）

**触发方**: 设备端

**安装过程**:

1. 设备收到 `ota_install` 命令
2. 校验固件 checksum（与下载命令中携带的 checksum 比对）
3. 执行固件刷写
4. 上报安装进度（可多次，同节点 7 的路由链路）
5. 安装完成后上报结果

**结果上报 MQTT 主题**: `devices/{deviceId}/ota/result`

**成功消息**:
```json
{
  "deviceId": "device-001",
  "taskId": "ota-task-uuid",
  "success": true,
  "version": "2.1.0",
  "timestamp": 1700000000000
}
```

**失败消息**:
```json
{
  "deviceId": "device-001",
  "taskId": "ota-task-uuid",
  "success": false,
  "error": "Checksum verification failed",
  "timestamp": 1700000000000
}
```

**消息路由链路**: 与节点 7 相同，经由 device-gateway → Redis Pub/Sub → device-service subscriber

---

### 节点 10'：处理设备 OTA 结果上报

**入口**: subscriber 收到 `device.ota_result` 类型消息

**subscriber**: [device-message.subscriber.ts](services/device-service/src/subscriber/device-message.subscriber.ts)

```typescript
// DeviceMessageSubscriber.handleOTAResult()
```

**内部逻辑**:

```
handleOTAResult(data)
  → 提取 { deviceId, taskId, success, error }
  → otaService.handleOTAResult(taskId, success, error)
```

**服务层**: [ota.service.ts:597-616](services/device-service/src/service/ota.service.ts#L597-L616)

```typescript
// OTAService.handleOTAResult()
```

**分支处理**:

```
success = true:
  1. updateOTATaskProgress(taskId, 'completed', 100)
     → 更新 ota_tasks 表 status='completed', progress=100, completedAt=now
     → 更新 devices 表 firmwareVersion = task.toVersion
  2. notifyDeviceToReboot(taskId, deviceId)
     → MQTT 发布 action: 'reboot'

success = false:
  1. updateOTATaskProgress(taskId, 'failed', task.progress, error)
     → 更新 ota_tasks 表 status='failed', error=错误信息
     → 不更新设备固件版本
```

---

### 节点 11：设备重启

**触发方**: OTAService 下发 reboot 命令

**服务层**: [ota.service.ts:488-503](services/device-service/src/service/ota.service.ts#L488-L503)

**MQTT 消息格式**:

Topic: `devices/{deviceId}/command`

```json
{
  "id": "uuid",
  "action": "reboot",
  "taskId": "ota-task-uuid",
  "timestamp": 1700000000000
}
```

---

### 节点 12：设备重注册 + OTA 任务同步

**触发方**: 设备重启后自动注册

**MQTT 主题**: `devices/{deviceId}/register`

**注册消息**:
```json
{
  "deviceId": "device-001",
  "serialNumber": "SN-001",
  "firmwareVersion": "2.1.0",
  "productType": "camera",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "cloudProvider": 3
}
```

**subscriber**: [device-message.subscriber.ts](services/device-service/src/subscriber/device-message.subscriber.ts)

```typescript
// DeviceMessageSubscriber.handleDeviceRegister()
```

**内部逻辑**:

```
handleDeviceRegister(data)
  → 查找设备（已存在）
  → 更新设备信息：firmwareVersion, macAddress, status=ONLINE
  → 保存设备
  → 检测固件版本变化:
     if (firmwareVersion !== previousFirmwareVersion)
       → otaService.syncOTATasksOnReRegistration(deviceId, firmwareVersion)
```

**服务层**: [ota.service.ts:825-868](services/device-service/src/service/ota.service.ts#L825-L868)

```typescript
// OTAService.syncOTATasksOnReRegistration()
```

**同步逻辑**:

```
1. 查找该设备所有 pending/downloading/installing 状态的 OTA 任务
2. 遍历每个任务:
   if (task.toVersion === newFirmwareVersion)
     → 自动标记为 completed (progress=100, completedAt=now)
     → 作为云端已收到 success 结果的兜底确认
   else
     → 标记为 failed (error="版本不匹配")
```

---

## 三、备用上报路径（HTTP 回调）

除了 MQTT 上报链路外，设备也可以通过 HTTP API 直接上报进度和结果：

**入口**: `POST /api/firmware/ota/tasks/{taskId}/status`

**控制器**: [firmware.controller.ts:531-583](services/device-service/src/controller/firmware.controller.ts#L531-L583)

**请求体**:
```json
{
  "status": "downloading",
  "progress": 75,
  "error": null
}
```

**内部逻辑**: 直接调用 `OTAService.updateOTATaskProgress()`

---

## 四、辅助功能节点

### 4.1 检查固件更新

**入口**: `GET /api/firmware/devices/{deviceId}/check-update`

**服务层**: [ota.service.ts:149-181](services/device-service/src/service/ota.service.ts#L149-L181)

```typescript
// OTAService.checkUpdate()
```

**逻辑**: 查找设备的 `productId` → 获取该产品最新固件 → 比较版本号

**响应**:
```json
{
  "hasUpdate": true,
  "isForced": false,
  "firmware": {
    "id": "uuid",
    "version": "2.1.0",
    "releaseNotes": "修复已知问题",
    "fileSize": 524288,
    "checksum": "e3b0c442..."
  }
}
```

### 4.2 暂停 / 恢复 OTA 任务

**暂停**: [ota.service.ts:706-735](services/device-service/src/service/ota.service.ts#L706-L735)

```typescript
// OTAService.pauseOTATask()
// 条件：任务处于 downloading/installing 状态
// MQTT action: 'ota_pause'
```

**恢复**: [ota.service.ts:743-772](services/device-service/src/service/ota.service.ts#L743-L772)

```typescript
// OTAService.resumeOTATask()
// 条件：任务处于 paused 状态
// MQTT action: 'ota_resume'
```

### 4.3 取消 OTA 任务

**入口**: `POST /api/firmware/ota/tasks/{taskId}/cancel`

**服务层**: [ota.service.ts:346-359](services/device-service/src/service/ota.service.ts#L346-L359)

```typescript
// OTAService.cancelOTATask()
// 条件：任务未完成
// MQTT action: 'ota_cancel'
// 然后删除任务记录
```

### 4.4 批量升级

**服务层**: [ota.service.ts:369-396](services/device-service/src/service/ota.service.ts#L369-L396)

```typescript
// OTAService.createBatchOTATasks(productId, firmwareId, createdBy)
// 获取产品下所有设备 → 逐个调用 createOTATask()
```

### 4.5 旧任务清理

**服务层**: [ota.service.ts:802-816](services/device-service/src/service/ota.service.ts#L802-L816)

```typescript
// OTAService.cleanOldOTATasks(days = 30)
// 删除 30 天前的 completed/failed/rolled_back 任务
```

---

## 五、安全机制

### 5.1 固件校验和

- 上传时验证 checksum 格式（SHA256: 64 位十六进制，MD5: 32 位十六进制）
- 下载命令携带 checksum 下发给设备，设备端校验

### 5.2 固件签名验证

**服务层**: [firmware-signature.service.ts](services/device-service/src/service/firmware-signature.service.ts)

- 支持 RSA-SHA256、RSA-SHA512、ECDSA-SHA256、Ed25519 签名算法
- 创建 OTA 任务时检查固件是否已被撤销（`isRevoked()`）
- 支持证书管理和固件版本撤销

### 5.3 权限校验

- 创建 OTA 任务需要设备 owner 权限（`DeviceExtendedController` 中校验）
- API 网关层通过 JWT 认证中间件校验用户身份

---

## 六、API 端点汇总

| 方法 | 路径 | 说明 | 触发节点 |
|------|------|------|---------|
| `POST` | `/api/firmware/upload-url` | 获取预签名上传 URL | 节点 1 |
| `POST` | `/api/firmware/versions/confirm` | 确认上传并创建版本 | 节点 3 |
| `POST` | `/api/firmware/versions` | 直接创建固件版本（旧接口） | 节点 3 |
| `GET` | `/api/firmware/versions/:productId` | 获取固件版本列表 | - |
| `GET` | `/api/firmware/devices/:deviceId/check-update` | 检查更新 | 4.1 |
| `POST` | `/api/firmware/ota/tasks` | 创建 OTA 任务 | 节点 4 |
| `GET` | `/api/firmware/ota/tasks/:taskId` | 获取任务详情 | - |
| `GET` | `/api/firmware/devices/:deviceId/ota/tasks` | 获取设备任务列表（分页） | - |
| `POST` | `/api/firmware/ota/tasks/:taskId/cancel` | 取消任务 | 4.3 |
| `POST` | `/api/firmware/ota/tasks/:taskId/status` | 更新任务状态（HTTP 回调） | 节点 10' |

---

## 七、MQTT 主题汇总

### 云 → 设备（命令下发）

| Topic | action | 说明 | 源码位置 |
|-------|--------|------|---------|
| `devices/{deviceId}/command` | `ota_download` | 下发下载命令 | ota.service.ts:406 |
| `devices/{deviceId}/command` | `ota_install` | 下发安装命令 | ota.service.ts:464 |
| `devices/{deviceId}/command` | `ota_cancel` | 取消升级 | ota.service.ts:439 |
| `devices/{deviceId}/command` | `ota_pause` | 暂停升级 | ota.service.ts:718 |
| `devices/{deviceId}/command` | `ota_resume` | 恢复升级 | ota.service.ts:755 |
| `devices/{deviceId}/command` | `reboot` | 重启设备 | ota.service.ts:488 |

### 设备 → 云（状态上报）

| Topic | 消息类型 | 说明 | 路由目标 |
|-------|---------|------|---------|
| `devices/{deviceId}/ota/progress` | `device.ota_progress` | 上报下载/安装进度 | device-service |
| `devices/{deviceId}/ota/result` | `device.ota_result` | 上报升级结果 | device-service |

### Redis Pub/Sub 频道

| 频道 | 方向 | 说明 |
|------|------|------|
| `service:device-service` | gateway → device-service | 转发设备消息 |
| `service:device-gateway` | device-service → gateway | 下发设备命令 |
