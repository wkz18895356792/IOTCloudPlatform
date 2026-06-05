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
  "deviceId": "设备唯一标识",
  "serialNumber": "设备序列号",
  "productType": "产品类型(camera/screen/sensor)",
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
  "credentialTypes": ["kvs", "iot_video"]
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
devices/+/credentials/request
devices/+/credentials/response
matter/+/attribute
matter/+/command
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
