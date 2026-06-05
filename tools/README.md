# 模拟设备使用指南

## 概述

本工具用于模拟 MQTT 设备，可以发送各种类型的消息到 Baby Monitor IoT 平台进行测试。

## 功能

| 功能 | 说明 |
|------|------|
| 设备注册 | 自动发送设备注册请求 |
| 设备认证 | 发送认证消息 |
| 心跳维持 | 定期发送心跳保持连接 |
| 状态上报 | 定期上报设备状态 |
| 事件上报 | 上报设备事件（哭声、移动等） |
| 控制响应 | 响应平台下发的控制命令 |
| 交互式命令 | 支持手动触发各种事件 |

## 安装

```bash
cd tools
npm install
```

## 使用方法

### 基本使用

```bash
# 使用默认设备ID（自动生成）
npm start

# 指定设备ID
npm start camera-001

# 使用快捷命令启动摄像头设备
npm run camera

# 使用快捷命令启动屏幕设备
npm run screen
```

### 环境变量配置

在项目根目录的 `.env` 文件中配置：

```bash
# MQTT Broker 配置
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=

# 设备签名密钥（用于认证）
DEVICE_SECRET=your_device_secret_key_change_this_in_production

# 关联用户ID
USER_ID=user-123
```

## 交互式命令

设备启动后，可以使用以下命令进行交互：

| 命令 | 说明 |
|------|------|
| `status` | 立即发送状态更新 |
| `event` | 发送测试事件 |
| `crying` | 发送哭声检测事件 |
| `motion` | 发送移动检测事件 |
| `person` | 发送人形检测事件 |
| `help` | 显示帮助信息 |
| `exit` | 退出程序 |

## 消息格式

### 设备注册

**主题**: `device/register/request`

```json
{
  "deviceId": "camera-001",
  "type": 1,
  "cloudProvider": 1,
  "userId": "user-123"
}
```

### 状态上报

**主题**: `device/status/response/{deviceId}`

```json
{
  "battery": 85,
  "network": -60,
  "temperature": 25.5,
  "humidity": 60,
  "timestamp": 1704067200000
}
```

### 事件上报

**主题**: `device/event/request/{deviceId}`

```json
{
  "type": 1,
  "details": "检测到婴儿哭声",
  "imageUrl": "https://example.com/image.jpg",
  "videoUrl": "https://example.com/video.mp4",
  "timestamp": 1704067200000
}
```

### 控制响应

**主题**: `device/control/response/{deviceId}`

```json
{
  "command": "reboot",
  "commandId": "cmd-1704067200000-001",
  "code": 0,
  "message": "Rebooting device",
  "timestamp": 1704067200000
}
```

## 支持的控制命令

| 命令 | 说明 | 参数 |
|------|------|------|
| `reboot` | 重启设备 | - |
| `start_record` | 开始录像 | `{ duration: 300 }` |
| `stop_record` | 停止录像 | - |
| `start_stream` | 开始直播 | - |
| `stop_stream` | 停止直播 | - |
| `mute` | 静音 | - |
| `unmute` | 取消静音 | - |
| `play_lullaby` | 播放音乐 | `{ musicId: 1 }` |
| `stop_lullaby` | 停止音乐 | - |
| `ptz` | 云台控制 | `{ direction, angle, speed }` |
| `resolution` | 设置分辨率 | `{ resolution: "1080p" }` |

## 事件类型

| 类型 | 名称 | 说明 |
|------|------|------|
| 1 | CRYING_DETECTED | 检测到哭声 |
| 2 | INTRUSION_DETECTED | 检测到区域入侵 |
| 3 | MOTION_DETECTED | 检测到物体移动 |
| 4 | PERSON_DETECTED | 检测到人形 |

## 运行示例

```bash
$ npm start camera-001
=======================================
  Baby Monitor - Mock MQTT Device
=======================================
Device ID: camera-001
Serial Number: camera-001
Type: 1 (1=Camera, 2=Screen)
MQTT Broker: localhost:1883
=======================================
[Device] Connecting to MQTT Broker: mqtt://localhost:1883
[Device] Connected to MQTT Broker
[Device] Subscribed to: device/register/response/camera-001
[Device] Subscribed to: device/status/request/camera-001
[Device] Subscribed to: device/config/request/camera-001
[Device] Subscribed to: device/control/request/camera-001
[Device] Subscribed to: device/credentials/response/camera-001
[Device] Sending register request: { deviceId: 'camera-001', type: 1, cloudProvider: 1, userId: 'user-123' }
[Device] Registration successful
[Device] Periodic tasks started

[Device] Interactive commands:
  - Type "status" to send status update
  - Type "event" to send random event
  - Type "help" for all commands
  - Type "exit" to quit

> crying
[Device] Sending event: { type: 1, details: 'Crying detected (manual)', imageUrl: 'https://example.com/crying.jpg', videoUrl: null, timestamp: 1704067200000 }
```

## 开发调试

### 查看 MQTT 消息

使用 MQTT 客户端工具（如 MQTTX）订阅以下主题查看消息：

```
device/#
devices/#
```

### 日志级别

修改 `.env` 文件中的日志级别：

```bash
LOG_LEVEL=debug
```

## 故障排除

### 无法连接到 MQTT Broker

1. 检查 MQTT Broker 是否运行
2. 验证 `.env` 文件中的 MQTT_HOST 和 MQTT_PORT 配置
3. 检查防火墙设置

### 设备注册失败

1. 确认 Device Service 正在运行
2. 检查 USER_ID 是否有效
3. 查看服务端日志

### 控制命令无响应

1. 确认设备已注册并在线
2. 检查命令格式是否正确
3. 查看设备日志

## 高级配置

### 修改设备类型

编辑 `mock-device.js` 文件中的 `config.device.type`：

```javascript
device: {
  type: 1, // 1-摄像头，2-屏幕
}
```

### 修改心跳间隔

```javascript
heartbeatInterval: 30000, // 毫秒
```

### 禁用随机事件

注释掉 `simulateRandomEvents()` 调用：

```javascript
// simulateRandomEvents();
```
