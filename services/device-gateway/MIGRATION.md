# Device Gateway 迁移指南

本文档说明如何从 mqtt-gateway 和 protocol-adapter 迁移到统一的 device-gateway 服务。

## 迁移概述

### 旧服务
- **mqtt-gateway** (端口 6006)：处理 MQTT 消息路由和设备连接
- **protocol-adapter** (端口 6007)：处理协议转换（Matter/私有协议）

### 新服务
- **device-gateway** (端口 6010)：整合上述两个服务的所有功能

## 迁移阶段

### 阶段 1：并行运行（当前状态）

新服务已部署，与旧服务并行运行：

```yaml
# docker-compose.yml
services:
  device-gateway:      # 新服务
    ports: ["6010:6010"]
  mqtt-gateway:        # 旧服务（保留）
    ports: ["6006:6006"]
  protocol-adapter:    # 旧服务（保留）
    ports: ["6007:6007"]
```

**配置更新：**
- ✅ docker-compose.yml 已添加 device-gateway
- ✅ .env.example 已添加 DEVICE_GATEWAY_URL

### 阶段 2：灰度切换

逐步将流量切换到新服务：

#### 2.1 更新 API Gateway

编辑 `services/api-gateway/src/config/config.default.ts`：

```typescript
// 添加新服务地址
export default {
  // ...
  deviceGateway: {
    url: process.env.DEVICE_GATEWAY_URL || 'http://device-gateway:6010',
  },
  // 保留旧服务地址以便回滚
  mqttGateway: {
    url: process.env.MQTT_GATEWAY_URL || 'http://mqtt-gateway:6006',
  },
  protocolAdapter: {
    url: process.env.PROTOCOL_ADAPTER_URL || 'http://protocol-adapter:6007',
  },
};
```

#### 2.2 添加功能开关

在 API Gateway 中添加功能开关控制流量切换：

```typescript
// services/api-gateway/src/middleware/route-switch.middleware.ts
export class RouteSwitchMiddleware {
  private readonly USE_DEVICE_GATEWAY = process.env.USE_DEVICE_GATEWAY === 'true';

  resolve() {
    return async (ctx, next) => {
      const deviceGatewayEnabled = this.USE_DEVICE_GATEWAY;

      // 根据开关选择服务
      ctx.deviceGatewayUrl = deviceGatewayEnabled
        ? ctx.app.getConfig('deviceGateway.url')
        : ctx.app.getConfig('mqttGateway.url');

      await next();
    };
  }
}
```

#### 2.3 小流量测试

1. 设置环境变量启用新服务：
   ```bash
   # .env
   USE_DEVICE_GATEWAY=true
   ```

2. 监控服务日志和指标：
   ```bash
   docker logs -f baby-monitor-device-gateway
   ```

3. 验证关键功能：
   - 设备注册
   - 设备认证
   - 消息路由
   - 协议转换
   - WebSocket 连接

### 阶段 3：全量切换

确认新服务稳定后，全量切换：

#### 3.1 更新所有服务调用

**Device Service 更新：**

```typescript
// services/device-service/src/config/config.default.ts
export default {
  // 将 MQTT_GATEWAY_URL 改为 DEVICE_GATEWAY_URL
  mqttGateway: {
    url: process.env.DEVICE_GATEWAY_URL || 'http://device-gateway:6010',
  },
};
```

**Baby Service 更新：**

```typescript
// services/baby-service/src/config/config.default.ts
export default {
  // 将 PROTOCOL_ADAPTER_URL 改为 DEVICE_GATEWAY_URL
  protocolAdapter: {
    url: process.env.DEVICE_GATEWAY_URL || 'http://device-gateway:6010',
  },
};
```

#### 3.2 更新前端配置

```typescript
// 前端配置
const config = {
  deviceGatewayUrl: process.env.DEVICE_GATEWAY_URL || 'http://localhost:6010',
  // WebSocket 连接
  websocketUrl: process.env.WEBSOCKET_URL || 'ws://localhost:6010',
};
```

### 阶段 4：清理旧服务

确认迁移成功后，清理旧服务：

#### 4.1 更新 docker-compose.yml

```yaml
# 移除旧服务
# mqtt-gateway: ...
# protocol-adapter: ...
```

#### 4.2 清理相关配置

```bash
# 移除旧的环境变量
# MQTT_GATEWAY_URL
# PROTOCOL_ADAPTER_URL
```

## API 映射表

### MQTT Gateway API 变更

| 旧 API (mqtt-gateway) | 新 API (device-gateway) |
|----------------------|-------------------------|
| `GET /api/gateway/status` | `GET /api/gateway/status` (相同) |
| `GET /api/gateway/devices` | `GET /api/gateway/devices/online` |
| `POST /api/gateway/publish` | `POST /api/gateway/publish` |

### Protocol Adapter API 变更

| 旧 API (protocol-adapter) | 新 API (device-gateway) |
|--------------------------|-------------------------|
| `POST /api/adapter/convert` | `POST /api/gateway/protocol/convert/{type}` |
| `POST /api/adapter/register` | `POST /api/registration/register` |
| `GET /api/adapter/devices` | `GET /api/gateway/devices/online` |

## MQTT 主题变更

所有 MQTT 主题保持不变，确保平滑迁移：

| 主题 | 说明 |
|------|------|
| `devices/+/register` | 设备注册 |
| `devices/+/auth` | 设备认证 |
| `devices/+/heartbeat` | 设备心跳 |
| `devices/+/report` | 设备上报 |
| `devices/+/status` | 设备状态 |
| `matter/+/attribute` | Matter 属性 |

## 回滚计划

如果迁移过程中出现问题，按以下步骤回滚：

1. **紧急回滚**（环境变量）
   ```bash
   # .env
   USE_DEVICE_GATEWAY=false
   ```

2. **配置回滚**（恢复旧配置）
   ```bash
   git checkout HEAD~1 services/api-gateway/src/config/config.default.ts
   ```

3. **服务回滚**（重启旧服务）
   ```bash
   docker-compose up -d mqtt-gateway protocol-adapter
   docker-compose stop device-gateway
   ```

## 验证清单

### 功能验证

- [ ] 设备注册流程正常
- [ ] 设备认证流程正常
- [ ] MQTT 消息路由正常
- [ ] 协议转换功能正常
- [ ] WebSocket 连接正常
- [ ] 设备心跳检测正常
- [ ] 在线设备列表准确

### 性能验证

- [ ] 服务响应时间 < 100ms
- [ ] 消息处理延迟 < 50ms
- [ ] 并发连接数符合预期
- [ ] 内存使用稳定

### 监控验证

- [ ] 健康检查端点正常
- [ ] 指标收集正常
- [ ] 日志输出正常
- [ ] 告警规则生效

## 常见问题

### Q: 如何验证新服务是否正常工作？

A: 访问健康检查端点：
```bash
curl http://localhost:6010/health
```

### Q: 设备需要重新注册吗？

A: 不需要。设备注册信息存储在数据库中，与网关实现无关。

### Q: 旧服务可以保留多久？

A: 建议在全量切换后保留 1-2 周，确认无问题后再移除。

### Q: 如何监控迁移进度？

A: 比较新旧服务的指标：
```bash
# 旧服务
curl http://localhost:6006/metrics

# 新服务
curl http://localhost:6010/metrics
```

## 联系方式

如有问题，请联系：
- 技术支持：tech-support@babymonitor.com
- 文档：https://docs.babymonitor.com/migration
