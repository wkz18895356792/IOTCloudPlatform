# BabyMonitor 平台架构分析报告

> 完整的系统架构分析，涵盖微服务架构、通信机制、数据流向和关键实现

---

## 一、项目整体架构概览

### 1.1 技术栈

| 层级 | 技术选型 |
|------|----------|
| **后端框架** | Midway.js 3.x (NestJS-like) + TypeScript |
| **数据库** | MySQL 8.0 + TypeORM |
| **缓存/消息** | Redis 7 |
| **MQTT Broker** | EMQX 5.4.0 |
| **对象存储** | MinIO / AWS S3 / 腾讯云 COS |
| **流媒体** | WebRTC / AWS KVS / 腾讯云 IoT Video |
| **构建工具** | Turbo (Monorepo) |

### 1.2 微服务架构图

```
                                    ┌─────────────────────────────────────────────────────────────┐
                                    │                     App 客户端                              │
                                    │              (iOS / Android / Web)                         │
                                    └─────────────────────────────────────────────────────────────┘
                                                  │ HTTPS / WebSocket
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                        API Gateway (6001)                                         │
│  • JWT认证 / 限流 / 熔断 / 请求日志                                                               │
│  • 路由转发 / 负载均衡                                                                            │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                  │
            ┌─────────────────────────────────────┼─────────────────────────────────────┐
            │                                     │                                     │
            ▼                                     ▼                                     ▼
┌───────────────────┐               ┌───────────────────┐               ┌───────────────────┐
│   User Service    │               │  Device Service   │               │   Baby Service    │
│     (6002)        │               │     (6003)        │               │     (6008)        │
│                   │               │                   │               │                   │
│ • 用户注册/登录   │               │ • 设备CRUD        │               │ • 婴儿档案管理    │
│ • JWT令牌管理     │               │ • 设备状态        │               │ • 喂养记录        │
│ • 设备绑定关系    │               │ • 固件升级        │               │ • 睡眠监测        │
│ • OAuth第三方登录 │               │ • 设备命令        │               │ • 哭声检测        │
└───────────────────┘               └───────────────────┘               └───────────────────┘
            │                                     │                                     │
            │                                     │                                     │
            │               ┌─────────────────────────────────────┐                     │
            │               │         Device Gateway (6010)       │                     │
            │               │                                     │                     │
            │               │  • MQTT连接管理                     │                     │
            │               │  • 消息路由/协议转换                 │                     │
            │               │  • 设备认证/心跳管理                 │                     │
            │               │  • 离线消息缓存                     │                     │
            │               └─────────────────────────────────────┘                     │
            │                                     │                                     │
            ▼                                     ▼                                     ▼
┌───────────────────┐               ┌───────────────────┐               ┌───────────────────┐
│  Video Service    │               │   EMQX Broker     │               │  Storage Service  │
│     (6004)        │               │   (1883/8083)     │               │     (6005)        │
│                   │               │                   │               │                   │
│ • WebRTC信令      │               │  MQTT协议         │               │ • 文件上传/下载   │
│ • 流媒体转码      │◄──────────────│  WebSocket桥接    │───────────────►│ • MinIO/S3/COS    │
│ • 录制管理        │               │                   │               │ • 配额管理        │
│ • 多Provider支持  │               └───────────────────┘               └───────────────────┘
│ • IoT Video SDK签名│                                                        │
└───────────────────┘                         │
            │                                 │
            └─────────────────────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │  Admin Service    │
                    │     (6009)        │
                    │                   │
                    │ • 域管理          │
                    │ • 平台管理员      │
                    │ • 统计/审计       │
                    └───────────────────┘
```

### 1.3 微服务详细职责

| 服务 | 端口 | 核心职责 | 数据存储 |
|------|------|----------|----------|
| **api-gateway** | 6001 | 统一入口、JWT认证、限流熔断、路由转发 | Redis (限流/会话) |
| **user-service** | 6002 | 用户注册登录、设备绑定关系、OAuth、权限管理 | MySQL + Redis |
| **device-service** | 6003 | 设备CRUD、状态管理、OTA升级、设备分组 | MySQL + Redis |
| **device-gateway** | 6010 | MQTT连接、消息路由、协议转换、设备认证 | Redis + MySQL |
| **video-service** | 6004 | WebRTC信令、流媒体转码、录制管理、IoT Video SDK签名 | Redis |
| **storage-service** | 6005 | 文件上传下载、多云存储、配额管理 | Redis + MinIO/S3/COS |
| **baby-service** | 6008 | 婴儿档案、喂养记录、睡眠追踪、AI监控 | MySQL + Redis |
| **admin-service** | 6009 | 域管理、平台管理、统计审计 | MySQL + Redis |

---

## 二、App用户与设备绑定流程

### 2.1 绑定流程图

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                              App 用户绑定设备流程                                       │
└───────────────────────────────────────────────────────────────────────────────────────┘

App                    API Gateway              User Service            Device Service
 │                          │                         │                        │
 │  1. 扫码/输入设备SN      │                         │                        │
 │ ──────────────────────►  │                         │                        │
 │                          │  2. POST /api/users/devices/bind                 │
 │                          │ ───────────────────────►│                        │
 │                          │                         │                        │
 │                          │                         │  3. 验证用户权限       │
 │                          │                         │ ──────────────────────►│
 │                          │                         │                        │
 │                          │                         │  4. 查询设备是否存在   │
 │                          │                         │ ◄───────────────────── │
 │                          │                         │                        │
 │                          │                         │  5. 创建绑定关系       │
 │                          │                         │ (UserDevice表)         │
 │                          │                         │ ──────────────────────►│
 │                          │                         │                        │
 │                          │                         │  6. 更新设备ownerId    │
 │                          │                         │ ◄───────────────────── │
 │                          │                         │                        │
 │                          │  7. 返回绑定成功        │                        │
 │                          │ ◄───────────────────────│                        │
 │ ◄──────────────────────  │                         │                        │
```

### 2.2 核心代码实现

**用户服务 - 设备绑定** (`services/user-service/src/service/user.service.ts`)

```typescript
async bindDevice(
  userId: string,
  deviceId: string,
  deviceName?: string,
  role: 'owner' | 'admin' | 'viewer' = 'owner'
): Promise<UserDevice> {
  const userDevice = this.userDeviceRepository.create({
    userId,
    deviceId,
    deviceName,
    role,
    permissions: this.getDefaultPermissions(role),
    isShared: false,
  });
  await this.userDeviceRepository.save(userDevice);
  return userDevice;
}
```

### 2.3 数据库表结构

**UserDevice 表** - 用户设备绑定关系

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| userId | string | 用户ID (外键) |
| deviceId | string | 设备ID (外键) |
| deviceName | string | 设备别名 |
| role | enum | 角色: owner/admin/viewer |
| permissions | json | 权限列表 |
| isShared | boolean | 是否为分享绑定 |

### 2.4 权限体系

| 角色 | 权限 |
|------|------|
| **owner** | 全部权限: 查看、控制、配置、分享、删除 |
| **admin** | 查看、控制、配置 |
| **viewer** | 仅查看实时画面 |

---

## 三、App与服务通信方式

### 3.1 通信协议

```
┌─────────────────────────────────────────────────────────────────┐
│                    App 与服务通信架构                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────┐    HTTPS/REST     ┌────────────────┐
│             │ ──────────────────►│                │
│  iOS/Android│                   │  API Gateway   │
│    App      │ ◄──────────────────│    (6001)      │
│             │    JSON Response   │                │
└─────────────┘                    └────────────────┘
       │                                    │
       │ WebSocket                          │ HTTP
       │ (实时事件)                          │
       ▼                                    ▼
┌─────────────┐                    ┌────────────────┐
│  WebSocket  │                    │  Microservices │
│  桥接服务   │                    │                │
└─────────────┘                    └────────────────┘
```

### 3.2 API 路由配置

**API Gateway 路由映射** (`services/api-gateway/src/config/service-routes.config.ts`)

| 路径前缀 | 目标服务 | 说明 |
|----------|----------|------|
| `/api/auth`, `/api/oauth` | user-service:6002 | 认证授权 |
| `/api/users`, `/api/app/users` | user-service:6002 | 用户管理 |
| `/api/devices` | device-service:6003 | 设备管理 |
| `/api/videos` | video-service:6004 | 视频 |
| `/api/storage` | storage-service:6005 | 文件存储 |
| `/api/babies` | baby-service:6008 | 婴儿护理 |
| `/api/gateway` | device-gateway:6010 | 设备网关 |

| `/api/domains` | admin-service:6009 | 域管理 |

### 3.3 认证机制

**JWT Token 结构**:

```typescript
interface JwtPayload {
  userId: string;        // 用户ID
  username: string;      // 用户名
  email?: string;        // 邮箱
  role: UserRole;        // 角色: admin/user/guest
  sessionId: string;     // 会话ID
  domainId?: string;     // 域ID (多租户)
  iat: number;          // 签发时间
  exp: number;          // 过期时间
}
```

**Token 生命周期**:

```
                        ┌──────────────────────────────────┐
                        │        accessToken (7天)         │
                        └──────────────────────────────────┘
                                       │
                                       │ 过期
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                               refreshToken (长期有效)                                 │
│                                                                                          │
│  POST /api/auth/refresh                                                              │
│  Body: { refreshToken: "xxx" }                                                          │
│  Response: { accessToken: "新token", expiresIn: 604800 }                            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 WebSocket 事件协议

**设备网关 WebSocket** (`services/device-gateway/src/controller/websocket.controller.ts`)

```typescript
// 客户端 → 服务端 事件
'subscribe:device'    // 订阅设备消息
'unsubscribe:device'  // 取消订阅
'device:command'      // 发送设备命令
'ping'                // 心跳

```

```typescript
// 服务端 → 客户端 事件
'connected'           // 连接成功
'device:message'      // 设备消息推送
'device:status'       // 设备状态变更
'device:event'        // 设备事件告警
'pong'                // 心跳响应
'error'               // 错误消息
```

---

## 四、设备与服务通信方式

### 4.1 MQTT 通信架构

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                              设备 MQTT 通信架构                                        │
└───────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐                 ┌────────────────┐                 ┌────────────────┐
│   摄像头    │                 │                │                 │                │
│   设备      │ ──── MQTT ────► │   EMQX Broker  │ ◄─── MQTT ────► │    device gateway    │
│             │    1883         │                │                 │   (6010)       │
└─────────────┘                 └────────────────┘                 └────────────────┘
                                       │
                                       │ WebSocket (8083)
                                       ▼
                              ┌────────────────┐
                              │   App 客户端   │
                              │  (实时预览)    │
                              └────────────────┘
```

### 4.2 MQTT 主题设计

**主题命名规范** (`services/device-gateway/src/types/mqtt-messages.ts`)

| 主题模式 | 方向 | 用途 |
|----------|------|------|
| `devices/{deviceId}/register` | 设备→服务器 | 设备注册 |
| `devices/{deviceId}/heartbeat` | 设备→服务器 | 心跳上报 |
| `devices/{deviceId}/status` | 设备→服务器 | 状态上报 |
| `devices/{deviceId}/event` | 设备→服务器 | 事件告警 |
| `devices/{deviceId}/command` | 服务器→设备 | 下发命令 |
| `devices/{deviceId}/config` | 双向 | 配置同步 |
| `devices/{deviceId}/credentials` | 双向 | 凭证请求 |

### 4.3 设备注册流程

```
设备                  EMQX                  Device Gateway              Device Service
 │                     │                         │                          │
 │  1. 连接MQTT        │                         │                          │
 │ ───────────────────►│                         │                          │
 │                     │                         │                          │
 │  2. 发布注册消息    │                         │                          │
 │   devices/{id}/register                       │                          │
 │ ───────────────────►│  3. 转发消息            │                          │
 │                     │ ───────────────────────►│                          │
 │                     │                         │  4. 验证设备信息         │
 │                     │                         │ ─────────────────────────►│
 │                     │                         │                          │
 │                     │                         │  5. 创建设备记录         │
 │                     │                         │ ◄─────────────────────────│
 │                     │                         │                          │
 │                     │  6. 返回注册结果        │                          │
 │                     │ ◄───────────────────────│                          │
 │ ◄───────────────────│                         │                          │
 │  7. 订阅命令主题    │                         │                          │
 │ ───────────────────►│                         │                          │
```

### 4.4 连接管理机制

| 机制 | 配置 | 说明 |
|------|------|------|
| **心跳超时** | 5分钟 | 超过5分钟无心跳判定离线 |
| **自动重连** | 最多10次 | 指数退避重试 |
| **会话TTL** | 24小时 | Redis存储连接信息 |
| **消息去重** | Redis Set | 防止重复处理 |

---

## 五、服务间通信机制

### 5.1 通信方式对比

| 方式 | 实现技术 | 使用场景 | 特点 |
|------|----------|----------|------|
| **HTTP REST** | @midwayjs/axios | 同步请求、服务调用 | 简单直接、支持重试 |
| **Redis Pub/Sub** | Redis 订阅/发布 | 异步事件、设备消息 | 解耦、实时性好 |
| **MQTT** | EMQX Broker | 设备通信 | 轻量、低功耗 |
| **WebSocket** | Socket.IO | App实时推送 | 双向通信 |

### 5.2 ServiceClient 实现

**服务间HTTP调用工具** (`common/shared-utils/src/service/service-client.ts`)

```typescript
@Provide()
@Scope(ScopeEnum.Singleton)
export class ServiceClient {
  // 统一的服务调用接口
  async get<T>(serviceName: string, path: string): Promise<ServiceResponse<T>>
  async post<T>(serviceName: string, path: string, data?: any): Promise<ServiceResponse<T>>

  // 特性：
  // 1. 自动添加 X-Service-API-Key 认证头
  // 2. 指数退避重试机制
  // 3. 统一错误处理
  // 4. 请求ID追踪
}
```

### 5.3 Redis Pub/Sub 消息模式

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                         Redis Pub/Sub 消息模式                                         │
└───────────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────────┐
                              │   Redis Broker      │
                              │                     │
                              │  频道列表:          │
                              │  • device:status:*  │
                              │  • device:event:*   │
                              │  • service:device-* │
                              └──────────┬──────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        │                  Pub/Sub       │       Pub/Sub                  │
        ▼                                ▼                                ▼
┌───────────────────┐          ┌───────────────────┐          ┌───────────────────┐
│ Device Service    │          │  User Service     │          │  Baby Service     │
│                   │          │                   │          │                   │
│ 订阅:             │          │ 订阅:             │          │ 订阅:             │
│ • device:status:* │          │ • user:device:*   │          │ • baby:event:*    │
│ • device:event:*  │          │                   │          │                   │
└───────────────────┘          └───────────────────┘          └───────────────────┘
```

### 5.4 服务发现机制

**当前实现** (基于环境变量):

```bash
# .env 配置
USER_SERVICE_URL=http://user-service:6002
DEVICE_SERVICE_URL=http://device-service:6003
VIDEO_SERVICE_URL=http://video-service:6004
STORAGE_SERVICE_URL=http://storage-service:6005
BABY_SERVICE_URL=http://baby-service:6008
ADMIN_SERVICE_URL=http://admin-service:6009
DEVICE_GATEWAY_URL=http://device-gateway:6010
```

---

## 六、实时音视频播放功能

### 6.1 流媒体架构

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                              实时音视频架构                                            │
└───────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐                    ┌────────────────┐                    ┌─────────────┐
│   摄像头    │   WebRTC/RTSP      │  Video Service │   WebRTC/HLS      │  App 客户端 │
│   设备      │ ──────────────────►│    (6004)      │ ──────────────────►│  (播放器)   │
│             │   推流             │                │   拉流             │             │
└─────────────┘                    └────────────────┘                    └─────────────┘
                                          │
                                          │ 多Provider支持
                                          │
                    ┌──────────┬──────────┼──────────┐
                    ▼          ▼          ▼          ▼
           ┌────────────┐ ┌────────────┐ ┌────────────────┐
           │  AWS KVS   │ │  WebRTC    │ │  腾讯云        │
           │  (云录制)  │ │   P2P      │ │  IoT Video     │
           │            │ │  (点对点)  │ │  (消费版)      │
           └────────────┘ └────────────┘ └────────────────┘
```

### 6.2 流媒体提供者

**StreamService 多Provider设计** (`services/video-service/src/service/stream.service.ts`)

```typescript
export class StreamService {
  private providers: Map<string, IStreamProvider> = new Map();
  private currentProvider: IStreamProvider;

  async initialize() {
    // AWS KVS 提供者
    const awsProvider = new AWSKVSProvider();
    await awsProvider.initialize();
    this.providers.set(StreamProviderType.AWS_KVS, awsProvider);

    // 腾讯云 IoT Video 提供者 (消费版)
    const iotVideoProvider = new TencentIoTVideoProvider();
    await iotVideoProvider.initialize();
    this.providers.set(StreamProviderType.IOT_VIDEO, iotVideoProvider);

    // WebRTC 提供者
    const webrtcProvider = new WebRTCStreamProvider();
    await webrtcProvider.initialize();
    this.providers.set(StreamProviderType.WEBRTC, webrtcProvider);
  }

  // 健康检查和故障转移
  async startStream(deviceId, config) {
    if (!await provider.healthCheck()) {
      // 自动切换到备用Provider
      for (const [type, p] of this.providers) {
        if (await p.healthCheck()) {
          return p.startStream(deviceId, config);
        }
      }
    }
  }
}
```

### 6.2.1 流媒体提供者对比

| Provider | 类型标识 | 协议支持 | 延迟 | 适用场景 |
|----------|----------|----------|------|----------|
| **AWS KVS** | `aws_kvs` | HLS/RTMP | 2-5s | AWS生态、云录制 |
| **腾讯云 IoT Video** | `iot_video` | HLS/FLV/RTMP/RTSP | 2-5s | IoT设备、设备管理集成、GB28181 |
| **WebRTC P2P** | `webrtc` | WebRTC | <1s | 实时通话、低延迟 |

### 6.2.2 腾讯云 IoT Video（消费版）

**架构特点**：

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                         腾讯云 IoT Video（消费版）架构                                  │
└───────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐   P2P/设备直连    ┌────────────────────┐
│   摄像头    │ ◄────────────────►│      App 客户端     │
│   设备      │    实时视频流      │   (实时观看)        │
└─────────────┘                   └────────────────────┘
      │
      │ 设备推流到云端
      ▼
┌────────────────────┐              ┌────────────────────┐
│   腾讯云 IoT Video  │              │  TencentIoTVideo   │
│      云存储         │──────────────│     Provider       │
│                    │              │                    │
│ • 视频云存储        │              │ • 云存储回放        │
│ • 时间轴管理        │              │ • 设备状态检查      │
└────────────────────┘              └──────────┬─────────┘
                                               │
                    ┌───────────────────────────┴───────────────────────────┐
                    │                                                       │
                    ▼                                                       ▼
         ┌────────────────────┐                                 ┌────────────────────┐
         │    App / Web       │                                 │   云存储回放        │
         │  播放历史录像       │                                 │   (HLS)            │
         └────────────────────┘                                 └────────────────────┘
```

**消费版 vs 行业版区别**：

| 特性 | 消费版 | 行业版 |
|------|--------|--------|
| **实时视频** | P2P/设备直连，不经过服务器 | 服务器管理流 URL |
| **云存储** | ✅ 支持 | ✅ 支持 |
| **播放地址 API** | `DescribeCloudStorageTime` | `DescribeChannelStreamURL` |
| **设备管理** | 与 IoT 平台集成 | 与 IoT 平台集成 |
| **适用场景** | 婴儿监视器、家用摄像头 | 专业监控、GB28181 |

**核心实现** (`services/video-service/src/provider/tencent-iot-video.provider.ts`)：

```typescript
@Provide()
export class TencentIoTVideoProvider implements IStreamProvider {
  private client: IotVideoClient;

  async initialize(): Promise<void> {
    // 消费版使用 iotvideo.tencentcloudapi.com
    this.client = new IotVideoClient({
      credential: { secretId, secretKey },
      region,
      profile: {
        httpProfile: { endpoint: 'iotvideo.tencentcloudapi.com' }
      }
    });
  }

  async startStream(deviceId: string, config: StreamConfig): Promise<StreamSession> {
    const { productId, deviceName } = this.parseDeviceId(deviceId);
    const today = new Date().toISOString().split('T')[0];

    // 消费版使用 DescribeCloudStorageTime 获取云存储视频
    const result = await this.client.DescribeCloudStorageTime({
      ProductId: productId,
      DeviceName: deviceName,
      Date: today,
      StartTime: Math.floor((Date.now() - 3600000) / 1000),
      EndTime: Math.floor(Date.now() / 1000),
    });

    return {
      id: sessionId,
      deviceId,
      provider: StreamProviderType.IOT_VIDEO,
      hlsUrl: result.Data?.VideoURL || '',
      status: result.Data?.VideoURL ? 'streaming' : 'stopped',
      // ...
    };
  }

  async getDirectPlaybackUrl(deviceId: string): Promise<DirectPlaybackInfo> {
    // 返回云存储播放地址
    const result = await this.client.DescribeCloudStorageTime({...});
    return {
      hlsUrl: result.Data?.VideoURL || '',
      isStreaming: !!result.Data?.VideoURL,
      // ...
    };
  }
}
```

**配置项** (`services/video-service/src/config/config.default.ts`)：

```typescript
tencent: {
  secretId: process.env.TENCENT_CLOUD_SECRET_ID,
  secretKey: process.env.TENCENT_CLOUD_SECRET_KEY,
  region: process.env.TENCENT_CLOUD_REGION || 'ap-guangzhou',

  // IoT Video 消费版配置
  iotVideo: {
    productId: process.env.TENCENT_IOT_VIDEO_PRODUCT_ID,      // 产品ID
    devicePrefix: process.env.TENCENT_IOT_VIDEO_DEVICE_PREFIX, // 设备ID前缀
    expireTime: parseInt(process.env.TENCENT_IOT_VIDEO_EXPIRE_TIME || '3600'), // URL过期时间(秒)
  },
}
```

**环境变量**：

```env
TENCENT_IOT_VIDEO_PRODUCT_ID=your_product_id
TENCENT_IOT_VIDEO_DEVICE_PREFIX=your_prefix
TENCENT_IOT_VIDEO_EXPIRE_TIME=0
```

### 6.3 WebRTC 信令流程

```
App                    Video Service                     设备
 │                          │                              │
 │  1. 创建WebRTC会话       │                              │
 │ ────────────────────────►│                              │
 │                          │  2. 生成sessionId            │
 │ ◄────────────────────────│    返回signalingUrl          │
 │                          │                              │
 │  3. 发送SDP Offer        │                              │
 │ ────────────────────────►│                              │
 │                          │  4. 转发Offer给设备          │
 │                          │ ─────────────────────────────►│
 │                          │                              │
 │                          │  5. 设备返回SDP Answer       │
 │                          │ ◄─────────────────────────────│
 │  6. 接收SDP Answer       │                              │
 │ ◄────────────────────────│                              │
 │                          │                              │
 │  7. 交换ICE Candidates   │                              │
 │ ◄───────────────────────►│◄────────────────────────────►│
 │                          │                              │
 │  8. P2P连接建立          │                              │
 │ ◄══════════════════════════════════════════════════════►│
 │        音视频数据流       │                              │
```

### 6.4 WebRTC API 端点

**StreamController** (`services/video-service/src/controller/stream.controller.ts`)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/videos/webrtc/sessions` | POST | 创建WebRTC会话 |
| `/api/videos/webrtc/sessions/:sessionId/offer` | POST | 发送SDP Offer |
| `/api/videos/webrtc/sessions/:sessionId/answer` | POST | 发送SDP Answer |
| `/api/videos/webrtc/sessions/:sessionId/ice-candidates` | POST | 添加ICE候选 |
| `/api/videos/webrtc/sessions/:sessionId/stats` | GET | 获取连接统计 |
| `/api/videos/webrtc/sessions/:sessionId` | DELETE | 挂断会话 |

### 6.5 设备播放地址 API 端点

**通用播放地址获取** - 支持多种 Provider

| 端点 | 方法 | 说明 |
|------|------|------|
| `GET /api/videos/device/:deviceId/playback` | GET | 获取设备直接播放地址 |
| `GET /api/videos/device/:deviceId/streaming-status` | GET | 检查设备推流状态 |
| `POST /api/videos/device/:deviceId/stream` | POST | 创建设备流资源 |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `provider` | string | 否 | 流媒体提供者: `iot_video`/`aws_kvs`/`webrtc`，默认 `iot_video` |

**使用示例**：

```bash
# 使用 IoT Video 获取播放地址（默认）
curl -X GET "https://api.example.com/api/videos/device/device123/playback" \
  -H "Authorization: Bearer {token}"

# 指定使用 AWS KVS
curl -X GET "https://api.example.com/api/videos/device/device123/playback?provider=aws_kvs" \
  -H "Authorization: Bearer {token}"

# 检查设备是否正在推流
curl -X GET "https://api.example.com/api/videos/device/device123/streaming-status?provider=iot_video" \
  -H "Authorization: Bearer {token}"
```

### 6.5 IoT Video 观看设备音视频流程（消费版）

**重要说明**：消费版 IoT Video 的实时视频通过 P2P 或设备直连方式实现，不经过服务器中转。
云服务仅提供云存储视频回放功能。

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                    IoT Video 消费版 - 云存储视频回放流程                                  │
└───────────────────────────────────────────────────────────────────────────────────────┘

┌──────────┐     1. 请求云存储播放地址   ┌─────────────────┐
│   App    │ ──────────────────────► │  Video Service  │
│          │  GET /api/videos/       │   (后端服务)     │
│          │  device/{deviceId}/      │                 │
│          │  playback?provider=      │                 │
│          │  iot_video               │                 │
└────┬─────┘                          └────────┬────────┘
     │                                         │
     │                                         │ 2. 调用 IoT Video API
     │                                         │    DescribeCloudStorageTime
     │                                         ▼
     │                              ┌─────────────────────┐
     │                              │  腾讯云 IoT Video    │
     │                              │  API                 │
     │                              │  iotvideo.           │
     │                              │  tencentcloudapi.com │
     │                              └──────────┬──────────┘
     │                                         │
     │                                         │ 3. 返回云存储数据
     │                                         │   - VideoURL (HLS)
     │                                         │   - TimeList (时间轴)
     │                                         ▼
     │                              ┌─────────────────────┐
     │                              │  Video Service      │
     │                              │  返回 DirectPlayback │
     │                              │  Info               │
     │                              └──────────┬──────────┘
     │                                         │
     │  4. 返回播放地址                         │
     │  { hlsUrl, isStreaming,                │
     │    expiresAt, timeSlots }              │
     ◄─────────────────────────────────────────┘
     │
     │  5. 使用播放器加载 HLS URL
     │     播放云存储视频
     ▼
┌──────────┐
│  播放器   │  ◄─── 播放云存储 HLS 视频
└──────────┘
```

**实时视频说明**：
- 消费版实时视频需要通过 P2P 或设备直连方式实现
- App 直接连接设备获取实时画面，不经过云端服务器
- 云服务仅提供设备管理、云存储、消息推送等功能

**API 调用示例**：

```http
GET /api/videos/device/{deviceId}/playback?provider=iot_video
Authorization: Bearer {token}
```

**响应示例**：

```json
{
  "success": true,
  "data": {
    "hlsUrl": "https://play-video.cloud.tencent.com/xxx.m3u8",
    "rtmpUrl": "",
    "flvUrl": "",
    "webrtcUrl": "",
    "streamName": "prefix_device123",
    "provider": "iot_video",
    "deviceId": "device123",
    "expiresAt": "2024-01-01T01:00:00.000Z",
    "isStreaming": true
  }
}
```

### 6.6 IoT Video SDK 鉴权流程（APP 端实时视频）

**架构说明**：APP 端集成腾讯云 IoT Video X-P2P SDK，通过服务端调用腾讯云 CreateAnonymousAccessToken API 获取鉴权信息，然后建立 P2P 连接播放实时视频。

@see https://cloud.tencent.com/document/product/1131/49189

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                    IoT Video 消费版 - APP 端实时视频播放流程                              │
└───────────────────────────────────────────────────────────────────────────────────────┘

┌──────────┐     1. 请求 SDK 鉴权信息     ┌─────────────────┐
│   App    │ ──────────────────────► │  Video Service  │
│          │  GET /api/videos/       │   (后端服务)     │
│          │  iot-video/auth/         │                 │
│          │  {deviceId}              │                 │
└────┬─────┘                          └────────┬────────┘
     │                                         │
     │                                         │ 2. 调用腾讯云 API
     │                                         │    CreateAnonymousAccessToken
     │                                         │    - Tid: deviceId
     │                                         │    - TtlMinutes: 60
     │                                         │
     │  3. 返回鉴权信息                         │
     │  { accessId, accessToken,              │
     │    expireTime, productId,              │
     │    deviceName, deviceId }              │
     ◄─────────────────────────────────────────┘
     │
     │  4. 使用 IoT Video SDK 初始化
     │     IotVideoPlayer().startLivePlay({
     │       accessId, accessToken,
     │       productId, deviceName
     │     })
     ▼
┌──────────┐     5. P2P 直连            ┌─────────────────┐
│ IoT Video│ ◄────────────────────────► │     摄像头      │
│ X-P2P SDK│     实时音视频流            │     设备        │
└──────────┘                            └─────────────────┘
```

**API 调用示例**：

```http
GET /api/videos/iot-video/auth/{deviceId}?expireSeconds=3600
Authorization: Bearer {token}
```

**响应示例**：

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

**服务端实现（调用腾讯云 API）**：

```typescript
// 调用腾讯云 CreateAnonymousAccessToken API
const result = await iotVideoClient.CreateAnonymousAccessToken({
  Tid: deviceId,           // 终端用户 ID
  TtlMinutes: 60,          // Token 有效期（分钟），最大 1440
});

// 返回: AccessId, AccessToken, ExpireTime
```

**APP 端集成示例**：

```typescript
// 1. 获取鉴权信息
const response = await fetch('/api/videos/iot-video/auth/device-123');
const { data: auth } = await response.json();

// 2. 初始化 IoT Video X-P2P SDK
IoTVideoSDK.startP2P({
  accessId: auth.accessId,
  accessToken: auth.accessToken,
  productId: auth.productId,
  deviceName: auth.deviceName
});
```

**相关文件**：

| 文件 | 说明 |
|------|------|
| `services/video-service/src/provider/tencent-iot-video.provider.ts` | IoT Video Provider，调用 CreateAnonymousAccessToken API |
| `services/video-service/src/service/stream.service.ts` | 流服务，包含 `generateIoTVideoAuth` 方法 |
| `services/video-service/src/controller/stream.controller.ts` | API 控制器，暴露 `/iot-video/auth/:deviceId` 接口 |
| `common/shared-types/src/index.ts` | `IoTVideoAuthInfo` 类型定义 |

### 6.7 拉流协议对比

| 协议 | 延迟 | 兼容性 | 适用场景 |
|------|------|--------|----------|
| **WebRTC** | <1s | 中 | 实时通话、低延迟监控 |
| **FLV** | 1-3s | 中 | 直播、中等延迟 |
| **HLS** | 3-10s | 高 | 回放、高兼容性场景 |

---

## 七、数据存储架构

### 7.1 数据库架构

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                              数据库架构                                                │
└───────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    MySQL 8.0                                             │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  user-service 表:                        │  device-service 表:                          │
│  • users (用户)                          │  • devices (设备)                            │
│  • user_profiles (用户资料)              │  • device_groups (设备分组)                  │
│  • user_devices (用户设备绑定)           │  • device_events (设备事件)                  │
│  • user_sessions (用户会话)              │  • firmware (固件)                           │
│  • third_party_bindings (第三方绑定)     │  • device_certificates (设备证书)            │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  baby-service 表:                        │  admin-service 表:                           │
│  • babies (婴儿档案)                     │  • domains (域)                              │
│  • feeding_logs (喂养记录)               │  • platform_admins (平台管理员)              │
│  • sleep_logs (睡眠记录)                 │  • audit_logs (审计日志)                     │
│  • baby_growth_records (成长记录)        │                                              │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    Redis 7.0                                             │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  缓存:                                   │  消息队列:                                    │
│  • user:{id} (用户信息缓存)              │  • mqtt:queue:{messageId} (消息队列)          │
│  • device:{id} (设备信息缓存)            │  • priority:queue:{deviceId} (优先级队列)     │
│  • session:{token} (会话缓存)            │  • mqtt:offline:{deviceId} (离线消息)         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  设备状态:                               │  Pub/Sub频道:                                 │
│  • gateway:connection:{deviceId}         │  • device:status (设备状态变更)               │
│  • heartbeat:state:{deviceId}            │  • device:event (设备事件)                    │
│  • mqtt:dedup:{messageId} (消息去重)     │  • device:register (设备注册)                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 八、协议支持

### 8.1 协议架构

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                              协议支持架构                                              │
└───────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────┐         ┌─────────────────────────────────────┐
│           私有协议                   │         │          Matter 1.5 协议            │
│  (自研设备: Camera, Monitor, Sensor) │         │  (标准智能家居设备)                  │
└──────────────────┬──────────────────┘         └──────────────────┬──────────────────┘
                   │                                               │
                   │                                               │
                   ▼                                               ▼
         ┌─────────────────────────────────────────────────────────────────┐
         │                    Protocol Converter                           │
         │                        (协议转换器)                              │
         │                                                                 │
         │  • 私有协议 → 统一消息格式                                       │
         │  • Matter协议 → 统一消息格式                                     │
         │  • 格式兼容性处理                                               │
         └─────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
                              ┌───────────────────────┐
                              │     统一消息格式       │
                              │  (Unified Message)    │
                              └───────────────────────┘
```

---

## 九、完整通信链路总结

### 9.1 核心通信链路汇总

| 场景 | 通信路径 | 协议 |
|------|----------|------|
| **App登录** | App → API Gateway → User Service | HTTPS/REST |
| **App绑定设备** | App → API Gateway → User Service ↔ Device Service | HTTPS/REST |
| **设备上线** | 设备 → EMQX → Device Gateway → Redis → Device Service | MQTT |
| **设备数据上报** | 设备 → EMQX → Device Gateway → Redis → Device Service → MySQL | MQTT |
| **实时视频** | 设备 → Video Service → App | WebRTC |
| **实时事件** | 设备 → EMQX → Device Gateway → WebSocket → App | MQTT+WS |

### 9.2 关键文件索引

| 模块 | 关键文件 | 职责 |
|------|----------|------|
| **API网关路由** | `services/api-gateway/src/config/service-routes.config.ts` | 路由配置 |
| **用户认证** | `services/api-gateway/src/middleware/auth.middleware.ts` | JWT验证 |
| **设备绑定** | `services/user-service/src/service/user.service.ts` | 绑定逻辑 |
| **MQTT主题** | `services/device-gateway/src/types/mqtt-messages.ts` | 消息定义 |
| **设备网关** | `services/device-gateway/src/service/core/gateway-core.service.ts` | 网关核心 |
| **视频服务** | `services/video-service/src/service/stream.service.ts` | 视频服务核心 |
| **AWS KVS** | `services/video-service/src/provider/aws-kvs.provider.ts` | AWS KVS实现 |
| **腾讯云 IoT Video** | `services/video-service/src/provider/tencent-iot-video.provider.ts` | IoT Video实现 |
| **WebRTC** | `services/video-service/src/provider/webrtc.provider.ts` | WebRTC实现 |
| **视频服务配置** | `services/video-service/src/config/config.default.ts` | 视频服务配置 |
| **服务间通信** | `common/shared-utils/src/service/service-client.ts` | HTTP调用 |
| **共享类型** | `common/shared-types/src/index.ts` | 类型定义 |

---

## 十、技术亮点

1. ✅ **微服务架构** - 职责清晰、独立部署
2. ✅ **多协议支持** - MQTT/WebSocket/HTTP/WebRTC
3. ✅ **多云部署** - AWS/腾讯云/MinIO
4. ✅ **类型安全** - 全链路TypeScript
5. ✅ **容器化** - 完整Docker支持
6. ✅ **故障转移** - 流媒体多Provider自动切换
7. ✅ **消息可靠** - 重试机制、消息去重、离线缓存
8. ✅ **多流媒体Provider** - AWS KVS / 腾讯云 IoT Video / WebRTC
9. ✅ **IoT 设备集成** - 支持 GB28181/ONVIF 协议的摄像头设备

---

*文档更新时间: 2026-03-26*
