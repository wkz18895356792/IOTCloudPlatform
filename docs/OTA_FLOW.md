# OTA 固件升级流程

## 流程概览

```
管理员上传固件 → 管理员创建任务 → 系统下发命令 → 设备下载/安装/上报 → 系统更新状态 → 设备重启重注册
```

---

## 节点明细

### 1. 获取上传预签名 URL

| 项目 | 内容 |
|------|------|
| **操作人** | 管理员 / App |
| **操作** | `POST /api/firmware/upload-url` |
| **关键参数** | `productId`, `version`, `fileSize`, `checksum` |
| **返回** | `uploadUrl`（1小时有效）, `key`（存储路径） |
| **内部调用** | device-service → storage-service → COS/S3 预签名 |

### 2. 上传固件文件

| 项目 | 内容 |
|------|------|
| **操作人** | 管理员 / App |
| **操作** | `PUT {uploadUrl}` 直传到 COS/S3 |
| **说明** | 文件不经 device-service，客户端直接上传 |

### 3. 确认上传，创建版本记录

| 项目 | 内容 |
|------|------|
| **操作人** | 管理员 / App |
| **操作** | `POST /api/firmware/versions/confirm` |
| **关键参数** | `productId`, `version`, `fileKey`, `fileSize`, `checksum`, `releaseNotes` |
| **可选参数** | `isForced`, `isBeta`, `minVersion`, `maxVersion` |
| **内部处理** | 校验 checksum 格式 → 查重 → 写入 `firmware_versions` 表 |

### 4. 创建 OTA 升级任务

| 项目 | 内容 |
|------|------|
| **操作人** | 管理员 / App |
| **操作** | `POST /api/firmware/ota/tasks` |
| **关键参数** | `deviceId`, `firmwareId` |
| **内部处理** | 校验设备/固件存在 → 版本兼容性检查 → 查重（不允许重复进行中任务）→ 固件撤销检查 → 创建 `ota_tasks` 记录 → 自动下发下载命令 |

### 5. 下发下载命令（云 → 设备）

| 项目 | 内容 |
|------|------|
| **操作人** | 系统（OTAService） |
| **操作** | MQTT publish → `devices/{deviceId}/command` |
| **关键参数** | `action: "ota_download"`, `taskId`, `version`, `fileUrl`（实时生成预签名URL）, `fileSize`, `checksum` |
| **说明** | `fileUrl` 存储为 COS key，下发时实时调用 storage-service 生成预签名下载 URL |

### 6. 设备下载固件

| 项目 | 内容 |
|------|------|
| **操作人** | 设备 |
| **操作** | HTTP(S) GET `fileUrl` 下载固件文件 |
| **校验** | 下载完成后用 `checksum`（MD5/SHA256）校验文件完整性 |

### 7. 设备上报进度（可多次）（可选）

| 项目 | 内容 |
|------|------|
| **操作人** | 设备 |
| **操作** | MQTT publish → `devices/{deviceId}/ota/progress` |
| **关键参数** | `taskId`, `progress`（0-100）, `status`（downloading/installing） |
| **路由** | device-gateway → Redis `service:device-service` → subscriber → OTAService |

### 8. 系统下发安装命令（可选）

| 项目 | 内容 |
|------|------|
| **操作人** | 系统（OTAService，进度=100 时触发） |
| **操作** | MQTT publish → `devices/{deviceId}/command` |
| **关键参数** | `action: "ota_install"`, `taskId` |

### 9. 设备安装固件 + 上报结果

| 项目 | 内容 |
|------|------|
| **操作人** | 设备 |
| **操作** | MQTT publish → `devices/{deviceId}/ota/result` |
| **成功参数** | `taskId`, `success: true`, `version` |
| **失败参数** | `taskId`, `success: false`, `error` |

### 10. 系统处理结果

| 项目 | 内容 |
|------|------|
| **操作人** | 系统（OTAService） |
| **成功处理** | 任务标记 `completed` → 更新设备 `firmwareVersion` → 下发 `reboot` 命令 |
| **失败处理** | 任务标记 `failed`，记录错误信息 |

### 11. 设备重启（可选） + 重注册

| 项目 | 内容 |
|------|------|
| **操作人** | 设备 |
| **操作** | 重启后 MQTT publish → `devices/{deviceId}/register` |
| **关键参数** | `deviceId`, `firmwareVersion`（新版本号） |
| **系统处理** | 检测版本变化 → 同步 OTA 任务：版本匹配则标记 completed，不匹配则标记 failed |

---

## 辅助操作

| 操作 | 接口 / 命令 | 说明 |
|------|------------|------|
| 检查更新 | `GET /api/firmware/devices/{deviceId}/check-update` | 比较当前版本与最新版本 |
| 取消任务 | `POST /api/firmware/ota/tasks/{taskId}/cancel` | 下发 `ota_cancel`，删除任务 |
| 暂停任务 | OTAService 内部 | 下发 `ota_pause`（仅 downloading/installing 状态） |
| 恢复任务 | OTAService 内部 | 下发 `ota_resume`（仅 paused 状态） |
| HTTP 回调 | `POST /api/firmware/ota/tasks/{taskId}/status` | 备用上报路径，设备直接 HTTP 上报 |
| 批量升级 | OTAService 内部 | 按产品批量创建任务 |
| 任务清理 | OTAService 内部 | 清理 30 天前已完成/失败任务 |

---

## MQTT 主题一览

| 方向 | Topic | action / 消息类型 | 说明 |
|------|-------|-------------------|------|
| 云→设备 | `devices/{deviceId}/command` | `ota_download` | 下发下载命令 |
| 云→设备 | `devices/{deviceId}/command` | `ota_install` | 下发安装命令 |
| 云→设备 | `devices/{deviceId}/command` | `reboot` | 重启设备 |
| 云→设备 | `devices/{deviceId}/command` | `ota_cancel` | 取消升级 |
| 云→设备 | `devices/{deviceId}/command` | `ota_pause` | 暂停升级 |
| 云→设备 | `devices/{deviceId}/command` | `ota_resume` | 恢复升级 |
| 设备→云 | `devices/{deviceId}/ota/progress` | `device.ota_progress` | 上报进度 |
| 设备→云 | `devices/{deviceId}/ota/result` | `device.ota_result` | 上报结果 |

---

## 任务状态机

```
pending → downloading ⇄ paused → installing → completed
                                     ↓
                                   failed → rolled_back
```
