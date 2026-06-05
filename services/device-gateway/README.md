# Device Gateway Service

**统一的设备网关服务** - 整合 MQTT Gateway 和 Protocol Adapter 的功能

## 概述

Device Gateway 是智能家居云平台的统一设备接入网关，负责：

- **MQTT 消息路由**：处理设备上报和命令下发
- **协议转换**：支持 Matter 和私有协议之间的相互转换
- **设备认证**：处理设备注册和身份验证
- **连接管理**：跟踪设备在线状态和会话
- **WebSocket 桥接**：支持前端应用通过 WebSocket 与设备通信

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Device Gateway                          │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │   MQTT Client │  │   Message     │  │  Protocol    │  │
│  │   Service     │  │   Router      │  │  Converter   │  │
│  └───────────────┘  └───────────────┘  └──────────────┘  │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │  Connection   │  │  Device       │  │  WebSocket   │  │
│  │  Manager      │  │  Auth         │  │  Bridge      │  │
│  └───────────────┘  └───────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    ┌─────────┐         ┌──────────┐         ┌──────────┐
    │  EMQX   │         │  Redis   │         │ Device   │
    │  Broker │         │          │         │ Service  │
    └─────────┘         └──────────┘         └──────────┘
```

## 核心服务

### GatewayCoreService
网关核心服务，协调所有组件的工作。

### ConnectionManagerService
管理设备连接状态，跟踪在线设备。

### MessageRouterService
根据 MQTT 主题路由消息到对应的处理器。

### MqttClientService
管理与 MQTT Broker 的连接。

### ProtocolConverterService
处理 Matter 和私有协议之间的转换。

### DeviceAuthService
处理设备认证和令牌管理。

### DeviceRegistrationService
处理设备注册流程。

### WebsocketBridgeService
在 WebSocket 客户端和 MQTT 设备之间建立桥接。

## API 端点

### 健康检查
- `GET /health` - 健康检查
- `GET /ready` - 就绪检查
- `GET /status` - 服务状态详情
- `GET /metrics` - 监控指标

### 设备网关
- `GET /api/gateway/status` - 获取网关状态
- `GET /api/gateway/devices/online` - 获取在线设备列表
- `GET /api/gateway/device/:deviceId/connection` - 获取设备连接信息

### 设备认证
- `POST /api/gateway/device/auth` - 设备认证
- `POST /api/gateway/device/token/verify` - 验证设备令牌
- `POST /api/gateway/device/token/refresh` - 刷新设备令牌
- `POST /api/gateway/device/token/revoke` - 撤销设备令牌
- `GET /api/gateway/device/:deviceId/auth-status` - 获取设备认证状态

### 设备注册
- `POST /api/registration/register` - 设备注册
- `GET /api/registration/info/:deviceId` - 获取注册信息
- `POST /api/registration/complete/:deviceId` - 完成注册流程

### 协议转换
- `POST /api/gateway/protocol/convert/private-to-matter` - 私有协议转 Matter
- `POST /api/gateway/protocol/convert/matter-to-private` - Matter 转私有协议
- `POST /api/gateway/protocol/convert/command` - 转换设备命令

## MQTT 主题

### 订阅主题
- `devices/+/register` - 设备注册
- `devices/+/auth` - 设备认证
- `devices/+/heartbeat` - 设备心跳
- `devices/+/report` - 设备数据上报
- `devices/+/command/response` - 设备命令响应
- `devices/+/status` - 设备状态上报
- `matter/+/attribute` - Matter 属性上报
- `matter/+/command` - Matter 命令

### 发布主题
- `device/{type}/response/{deviceId}` - 设备响应

## WebSocket 事件

### 客户端发送
- `subscribe:device` - 订阅设备消息
- `unsubscribe:device` - 取消订阅设备
- `device:command` - 发送设备命令

### 服务端发送
- `connected` - 连接成功
- `subscribed` - 订阅成功
- `unsubscribed` - 取消订阅成功
- `command:sent` - 命令已发送
- `command:error` - 命令发送失败
- `device:message` - 设备消息

## 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `NODE_ENV` | 运行环境 | `production` |
| `MQTT_HOST` | MQTT Broker 地址 | `emqx` |
| `MQTT_PORT` | MQTT Broker 端口 | `1883` |
| `REDIS_HOST` | Redis 地址 | `redis` |
| `REDIS_PORT` | Redis 端口 | `6379` |
| `MYSQL_HOST` | MySQL 地址 | `mysql` |
| `MYSQL_PORT` | MySQL 端口 | `3306` |
| `DEVICE_SECRET` | 设备密钥 | - |
| `SERVICE_API_KEY` | 服务间 API 密钥 | - |

## 迁移指南

### 从 mqtt-gateway 迁移

1. **更新服务地址**
   ```typescript
   // 旧
   const mqttGatewayUrl = 'http://mqtt-gateway:6006';
   // 新
   const deviceGatewayUrl = 'http://device-gateway:6010';
   ```

2. **更新 MQTT 主题订阅**
   - 设备注册：保持不变
   - 设备认证：保持不变
   - 设备心跳：保持不变
   - 设备上报：保持不变

3. **更新 API 调用**
   ```typescript
   // 旧的 API 路径
   GET /api/gateway/status
   // 新的 API 路径（相同）
   GET /api/gateway/status
   ```

### 从 protocol-adapter 迁移

1. **协议转换 API**
   ```typescript
   // 旧
   POST /api/protocol/convert
   // 新
   POST /api/gateway/protocol/convert/private-to-matter
   POST /api/gateway/protocol/convert/matter-to-private
   ```

2. **设备注册**
   - 注册流程保持不变
   - API 路径从 `/api/adapter/register` 改为 `/api/registration/register`

## 开发

### 启动开发服务器
```bash
npm run dev
```

### 构建
```bash
npm run build
```

### 测试
```bash
npm run test
```

## Docker 部署

### 构建镜像
```bash
docker build -t device-gateway:latest .
```

### 运行容器
```bash
docker run -p 6010:6010 \
  -e MQTT_HOST=emqx \
  -e REDIS_HOST=redis \
  device-gateway:latest
```

## 监控

服务提供多个监控端点：

- `/health` - 健康检查
- `/metrics` - Prometheus 格式指标
- `/status` - 详细状态信息

## 故障排查

### 设备无法连接
1. 检查 MQTT Broker 连接状态：`GET /health`
2. 查看设备认证状态：`GET /api/gateway/device/:deviceId/auth-status`
3. 检查 Redis 连接

### 协议转换失败
1. 验证设备协议类型配置
2. 检查转换缓存状态
3. 查看服务日志

### WebSocket 断连
1. 检查网络连接
2. 验证设备订阅状态
3. 查看浏览器控制台错误
