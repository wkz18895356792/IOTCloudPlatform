# 设备注册流程代码链路分析

## 流程概览

```
┌─────────────┐    MQTT     ┌──────────────────┐    Redis     ┌────────────────┐
│   设备端    │ ─────────> │  device-gateway  │ ───────────> │ device-service │
│             │            │                  │              │                │
│ Publish     │            │ 1. 接收消息      │              │ 4. 处理注册    │
│ register    │            │ 2. 路由匹配      │              │ 5. 创建设备    │
│             │            │ 3. 转发到服务    │              │ 6. 存储数据库  │
└─────────────┘            └──────────────────┘              └────────────────┘
     设备                         网关服务                          业务服务
```

---

## 详细代码链路

### Step 1: 设备发送 MQTT 注册消息

**主题**: `devices/{deviceId}/register`

**设备端代码**（示例）:
```javascript
// 设备端发送注册消息
const message = {
  deviceId: "DEV-abc123",
  serialNumber: "SN-12345",
  productType: "camera",
  firmwareVersion: "1.0.0",
  macAddress: "AA:BB:CC:DD:EE:FF",
  timestamp: Date.now()
};

mqttClient.publish(`devices/${deviceId}/register`, JSON.stringify(message), { qos: 1 });
```

---

### Step 2: device-gateway 接收消息

#### 2.1 GatewayCoreService - 初始化订阅

**文件**: [services/device-gateway/src/service/core/gateway-core.service.ts](services/device-gateway/src/service/core/gateway-core.service.ts)

**方法**: `setupMessageHandlers()` (第 71-112 行)

```typescript
private async setupMessageHandlers(): Promise<void> {
  const client = this.mqttClientService.getClient();

  // 订阅设备主题
  const topics = [
    // 设备生命周期
    'devices/+/register',  // ← 注册主题
    'devices/+/auth',
    'devices/+/heartbeat',
    // ... 其他主题
  ];

  for (const topic of topics) {
    client.subscribe(topic, { qos: 1 });
    this.logger.info(`[Device Gateway] Subscribed to topic: ${topic}`);
  }

  // 注册消息处理器
  client.on('message', async (topic: string, payload: Buffer) => {
    try {
      if (this.messageRouter) {
        await this.messageRouter.routeMessage(topic, payload);  // ← 转发到路由器
      }
    } catch (error) {
      this.logger.error(`[Device Gateway] Error routing message from ${topic}:`, error);
    }
  });
}
```

---

### Step 3: MessageRouterService - 路由消息

#### 3.1 路由规则匹配

**文件**: [services/device-gateway/src/service/core/message-router.service.ts](services/device-gateway/src/service/core/message-router.service.ts)

**方法**: `routeMessage()` (第 185-214 行)

```typescript
async routeMessage(topic: string, payload: Buffer): Promise<void> {
  try {
    // 解析消息内容
    let message: any;
    try {
      message = JsonUtil.parse(payload.toString());
    } catch {
      message = { raw: payload.toString() };
    }

    this.logger.debug(`[Message Router] Routing message from ${topic}`);

    // 匹配路由规则
    const matchedRoutes = this.matchRoutes(topic);  // ← 匹配路由

    if (matchedRoutes.length === 0) {
      this.logger.warn(`[Message Router] No route matched for topic: ${topic}`);
      return;
    }

    // 按优先级排序并处理
    matchedRoutes.sort((a, b) => b.priority - a.priority);

    for (const route of matchedRoutes) {
      await this.processRoute(route, topic, message);  // ← 处理路由
    }
  } catch (error) {
    this.logger.error(`[Message Router] Error routing message:`, error);
  }
}
```

#### 3.2 注册主题路由规则

**文件**: [services/device-gateway/src/service/core/message-router.service.ts](services/device-gateway/src/service/core/message-router.service.ts)

**位置**: `routes` 数组 (第 61-77 行)

```typescript
private routes: RouteRule[] = [
  // ==================== 设备生命周期 ====================
  // 设备注册消息
  {
    name: 'Device Register',
    topicPattern: /^devices\/([^/]+)\/register$/,  // ← 匹配 devices/xxx/register
    target: { type: 'service', destination: 'device-service' },  // ← 路由到 device-service
    enabled: true,
    priority: 100,  // ← 最高优先级
  },
  // 设备认证消息
  {
    name: 'Device Auth',
    topicPattern: /^devices\/([^/]+)\/auth$/,
    target: { type: 'service', destination: 'device-service' },
    enabled: true,
    priority: 100,
  },
  // ...
];
```

#### 3.3 处理路由并转发

**文件**: [services/device-gateway/src/service/core/message-router.service.ts](services/device-gateway/src/service/core/message-router.service.ts)

**方法**: `processRoute()` (第 232-258 行)

```typescript
private async processRoute(
  route: RouteRule,
  topic: string,
  message: any
): Promise<void> {
  const match = topic.match(route.topicPattern);
  if (!match) {
    return;
  }

  const deviceId = match[1];  // ← 从主题提取设备ID
  const targetDestination = route.target.destination.replace('$1', deviceId);

  switch (route.target.type) {
    case 'device':
      await this.handleDeviceMessage(deviceId, message);
      break;

    case 'service':
      await this.handleServiceMessage(route.target.destination, topic, message);  // ← 走这里
      break;

    case 'protocol':
      await this.handleProtocolMessage(deviceId, route.target.protocol!, message);
      break;
  }
}
```

#### 3.4 发送到 Redis 频道

**文件**: [services/device-gateway/src/service/core/message-router.service.ts](services/device-gateway/src/service/core/message-router.service.ts)

**方法**: `handleServiceMessage()` (第 295-319 行)

```typescript
private async handleServiceMessage(
  serviceName: string,
  topic: string,
  message: any
): Promise<void> {
  // 根据主题确定消息类型
  const messageType = this.getMessageTypeFromTopic(topic);  // ← 返回 'device.register'

  // 格式化为 device-service 期望的格式 {type, data}
  const enhancedMessage = {
    type: messageType,  // ← 'device.register'
    data: {
      ...message,
      _meta: {
        topic,
        timestamp: Date.now(),
        source: 'device-gateway',
      },
    },
  };

  if (this.gatewayCore) {
    await this.gatewayCore.publishToService(serviceName, enhancedMessage);  // ← 发送到 Redis
  }
}
```

#### 3.5 getMessageTypeFromTopic 映射

**文件**: [services/device-gateway/src/service/core/message-router.service.ts](services/device-gateway/src/service/core/message-router.service.ts)

**方法**: `getMessageTypeFromTopic()` (第 327-368 行)

```typescript
private getMessageTypeFromTopic(topic: string): string {
  // 设备注册
  if (topic.includes('/register')) {
    return 'device.register';  // ← 返回注册消息类型
  }
  // 设备认证
  if (topic.includes('/auth')) {
    return 'device.auth';
  }
  // ... 其他映射
}
```

#### 3.6 发布到 Redis

**文件**: [services/device-gateway/src/service/core/gateway-core.service.ts](services/device-gateway/src/service/core/gateway-core.service.ts)

**方法**: `publishToService()` (第 144-146 行)

```typescript
async publishToService(service: string, message: any): Promise<void> {
  await this.redis.publish(`service:${service}`, JsonUtil.stringify(message));
  // ← 发布到 Redis 频道: "service:device-service"
}
```

**Redis 频道**: `service:device-service`

**消息格式**:
```json
{
  "type": "device.register",
  "data": {
    "deviceId": "DEV-abc123",
    "serialNumber": "SN-12345",
    "productType": "camera",
    "firmwareVersion": "1.0.0",
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "timestamp": 1700000000000,
    "_meta": {
      "topic": "devices/DEV-abc123/register",
      "timestamp": 1700000000000,
      "source": "device-gateway"
    }
  }
}
```

---

### Step 4: device-service 接收消息

#### 4.1 订阅配置

**文件**: [services/device-service/src/subscriber/device-message.subscriber.ts](services/device-service/src/subscriber/device-message.subscriber.ts)

**方法**: `getSubscriptionConfig()` (第 50-55 行)

```typescript
getSubscriptionConfig(): SubscriptionConfig {
  return {
    channels: [DEVICE_SERVICE_CHANNEL],  // ← 'service:device-service'
    patterns: ['device:telemetry:*', 'device:event:*'],
  };
}
```

#### 4.2 消息分发

**文件**: [services/device-service/src/subscriber/device-message.subscriber.ts](services/device-service/src/subscriber/device-message.subscriber.ts)

**方法**: `handleMessage()` (第 60-82 行)

```typescript
async handleMessage(channel: string, message: string): Promise<void> {
  try {
    // 处理设备服务频道消息
    if (channel === DEVICE_SERVICE_CHANNEL) {
      await this.handleServiceMessage(message);  // ← 处理服务消息
      return;
    }
    // ...
  } catch (error) {
    this.logger.error(`[DeviceMessageSubscriber] Error handling message from ${channel}:`, error);
  }
}
```

#### 4.3 消息类型路由

**文件**: [services/device-service/src/subscriber/device-message.subscriber.ts](services/device-service/src/subscriber/device-message.subscriber.ts)

**方法**: `handleServiceMessage()` (第 161-203 行)

```typescript
private async handleServiceMessage(messageStr: string): Promise<void> {
  try {
    const message = JsonUtil.parse(messageStr);
    if (!message || !message.type || !message.data) {
      return;
    }

    const { type, data } = message;
    this.logger.debug(`[DeviceMessageSubscriber] Received service message: ${type}`);

    switch (type) {
      case 'device.register':
        // 处理设备注册
        await this.handleDeviceRegister(data);  // ← 调用注册处理方法
        break;

      case 'device.report':
        await this.handleDeviceReport(data);
        break;

      case 'device.status':
        await this.handleDeviceStatus(data);
        break;

      // ... 其他类型
    }
  } catch (error) {
    this.logger.error('[DeviceMessageSubscriber] Error handling service message:', error);
  }
}
```

---

### Step 5: 处理设备注册

#### 5.1 核心注册逻辑

**文件**: [services/device-service/src/subscriber/device-message.subscriber.ts](services/device-service/src/subscriber/device-message.subscriber.ts)

**方法**: `handleDeviceRegister()` (第 208-258 行)

```typescript
private async handleDeviceRegister(data: any): Promise<void> {
  const { deviceId, serialNumber, productType, firmwareVersion, _meta } = data;

  // 获取设备标识（优先使用 deviceId，其次 serialNumber）
  const deviceIdentifier = deviceId || serialNumber;
  if (!deviceIdentifier) {
    this.logger.warn('[DeviceMessageSubscriber] Device register message missing deviceId/serialNumber');
    return;
  }

  this.logger.info(`[DeviceMessageSubscriber] Processing device register: ${deviceIdentifier}`);

  // 检查设备是否已存在
  let device = await this.deviceRepository.findOne({
    where: { serialNumber: deviceIdentifier },
  });

  if (device) {
    // 设备已存在，更新信息
    device.firmwareVersion = firmwareVersion || device.firmwareVersion;
    device.status = DeviceStatus.ONLINE;
    device.lastOnline = new Date();

    await this.deviceRepository.save(device);
    this.logger.info(`[DeviceMessageSubscriber] Device updated: ${deviceIdentifier} -> ${device.id}`);
  } else {
    // 创建新设备
    const mappedProductType = this.mapProductType(productType);

    device = this.deviceRepository.create({
      serialNumber: deviceIdentifier,
      productId: `PROD-${productType || 'unknown'}`,
      productType: mappedProductType,
      name: `Device ${deviceIdentifier.substring(0, 8)}`,
      firmwareVersion: firmwareVersion || '1.0.0',
      protocol: DeviceProtocol.PRIVATE,
      status: DeviceStatus.ONLINE,
      ownerId: '00000000-0000-0000-0000-000000000000',  // 默认系统用户
      lastOnline: new Date(),
    });

    const saved = await this.deviceRepository.save(device);
    this.logger.info(`[DeviceMessageSubscriber] Device created: ${deviceIdentifier} -> ${saved.id}`);

    // 记录设备注册事件
    await this.saveDeviceEvent(saved.id, DeviceEventType.ONLINE, {
      reason: 'device_registered',
      timestamp: _meta?.timestamp || Date.now(),
    });
  }
}
```

---

## 代码链路总结

| 步骤 | 服务 | 文件 | 方法/函数 | 行号 |
|------|------|------|----------|------|
| 1 | 设备端 | - | mqtt.publish() | - |
| 2.1 | device-gateway | gateway-core.service.ts | `setupMessageHandlers()` | 71-112 |
| 2.2 | device-gateway | gateway-core.service.ts | `client.on('message')` | 103-111 |
| 3.1 | device-gateway | message-router.service.ts | `routeMessage()` | 185-214 |
| 3.2 | device-gateway | message-router.service.ts | `routes[]` 规则匹配 | 64-70 |
| 3.3 | device-gateway | message-router.service.ts | `processRoute()` | 232-258 |
| 3.4 | device-gateway | message-router.service.ts | `handleServiceMessage()` | 295-319 |
| 3.5 | device-gateway | message-router.service.ts | `getMessageTypeFromTopic()` | 327-368 |
| 3.6 | device-gateway | gateway-core.service.ts | `publishToService()` | 144-146 |
| 4.1 | device-service | device-message.subscriber.ts | `getSubscriptionConfig()` | 50-55 |
| 4.2 | device-service | device-message.subscriber.ts | `handleMessage()` | 60-82 |
| 4.3 | device-service | device-message.subscriber.ts | `handleServiceMessage()` | 161-203 |
| 5.1 | device-service | device-message.subscriber.ts | `handleDeviceRegister()` | 208-258 |

---

## 数据流图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              设备注册数据流                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  1. MQTT 消息                                                                   │
│  ┌──────────────────────────────────────────────────────────┐                   │
│  │ Topic: devices/DEV-abc123/register                       │                   │
│  │ Payload:                                                  │                   │
│  │ {                                                         │                   │
│  │   "deviceId": "DEV-abc123",                               │                   │
│  │   "serialNumber": "SN-12345",                             │                   │
│  │   "productType": "camera",                                │                   │
│  │   "firmwareVersion": "1.0.0",                             │                   │
│  │   "timestamp": 1700000000000                              │                   │
│  │ }                                                         │                   │
│  └──────────────────────────────────────────────────────────┘                   │
│                              │                                                  │
│                              ▼                                                  │
│  2. device-gateway (MessageRouter)                                              │
│  ┌──────────────────────────────────────────────────────────┐                   │
│  │ 路由规则匹配:                                             │                   │
│  │ - Pattern: /^devices\/([^/]+)\/register$/                │                   │
│  │ - Target: { type: 'service', destination: 'device-service' }              │
│  │ - Priority: 100                                           │                   │
│  │ - MessageType: 'device.register'                          │                   │
│  └──────────────────────────────────────────────────────────┘                   │
│                              │                                                  │
│                              ▼                                                  │
│  3. Redis Pub/Sub                                                               │
│  ┌──────────────────────────────────────────────────────────┐                   │
│  │ Channel: service:device-service                          │                   │
│  │ Message:                                                  │                   │
│  │ {                                                         │                   │
│  │   "type": "device.register",                              │                   │
│  │   "data": {                                               │                   │
│  │     "deviceId": "DEV-abc123",                             │                   │
│  │     "serialNumber": "SN-12345",                           │                   │
│  │     "productType": "camera",                              │                   │
│  │     "firmwareVersion": "1.0.0",                           │                   │
│  │     "timestamp": 1700000000000,                           │                   │
│  │     "_meta": {                                            │                   │
│  │       "topic": "devices/DEV-abc123/register",             │                   │
│  │       "timestamp": 1700000000000,                         │                   │
│  │       "source": "device-gateway"                          │                   │
│  │     }                                                     │                   │
│  │   }                                                       │                   │
│  │ }                                                         │                   │
│  └──────────────────────────────────────────────────────────┘                   │
│                              │                                                  │
│                              ▼                                                  │
│  4. device-service (DeviceMessageSubscriber)                                    │
│  ┌──────────────────────────────────────────────────────────┐                   │
│  │ handleServiceMessage() 解析 type: 'device.register'       │                   │
│  │     │                                                     │                   │
│  │     ▼                                                     │                   │
│  │ handleDeviceRegister() 处理注册                           │                   │
│  │     │                                                     │                   │
│  │     ├── 检查设备是否存在                                   │                   │
│  │     │                                                     │                   │
│  │     ├── 存在 → 更新设备信息                                │                   │
│  │     │                                                     │                   │
│  │     └── 不存在 → 创建新设备                                │                   │
│  │                                                           │                   │
│  └──────────────────────────────────────────────────────────┘                   │
│                              │                                                  │
│                              ▼                                                  │
│  5. 数据库存储                                                                   │
│  ┌──────────────────────────────────────────────────────────┐                   │
│  │ Device 表:                                                │                   │
│  │ - id: UUID                                                │                   │
│  │ - serialNumber: "DEV-abc123"                              │                   │
│  │ - productType: "camera"                                   │                   │
│  │ - status: "online"                                        │                   │
│  │ - firmwareVersion: "1.0.0"                                │                   │
│  │ - lastOnline: 2024-01-01 00:00:00                         │                   │
│  │                                                           │                   │
│  │ DeviceEvent 表:                                           │                   │
│  │ - deviceId: UUID                                          │                   │
│  │ - type: "online"                                          │                   │
│  │ - data: { reason: "device_registered" }                   │                   │
│  └──────────────────────────────────────────────────────────┘                   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 另一条注册路径：同步注册请求

除了上述的异步注册流程外，还有一个**同步注册**的路径，通过 `device:register:request` 频道：

### 文件位置
[services/device-service/src/subscriber/device-register.subscriber.ts](services/device-service/src/subscriber/device-register.subscriber.ts)

### 特点
- 使用 **correlationId** 关联请求和响应
- 支持**幂等性**（5分钟缓存）
- 通过 Redis 响应频道返回结果

### 流程
```
设备 → device-gateway → Redis (device:register:request) → DeviceRegisterSubscriber
                                                                   │
                                                                   ▼
                                                           创建/查询设备
                                                                   │
                                                                   ▼
                                              Redis (device:register:response:{correlationId})
                                                                   │
                                                                   ▼
                                                           device-gateway → 设备
```

---

## 关键配置

### Redis 频道常量
**文件**: [common/shared-utils/src/constants/redis-channels.ts](common/shared-utils/src/constants/redis-channels.ts)

```typescript
// 设备服务频道
export const DEVICE_SERVICE_CHANNEL = 'service:device-service';
```

### 订阅器基类
**文件**: [common/shared-utils/src/subscriber/base.subscriber.ts](common/shared-utils/src/subscriber/base.subscriber.ts)

所有订阅器继承自 `BaseSubscriber`，提供：
- Redis 连接池管理
- 自动订阅/取消订阅
- 消息分发机制
