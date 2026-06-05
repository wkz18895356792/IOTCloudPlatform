# 智能家居设备物联云平台

基于 Midway.js 的微服务架构智能家居IoT云平台

## 系统架构

### 微服务拆分

```
baby-monitor-iot-platform/
├── services/
│   ├── api-gateway/           # API网关 - 统一入口，路由转发，认证鉴权 (6001)
│   ├── user-service/          # 用户服务 - 用户管理，权限控制 (6002)
│   ├── device-service/        # 设备管理服务 - 设备CRUD，状态管理，OTA升级 (6003)
│   ├── video-service/         # 视频服务 - 视频流管理，多云支持 (6004)
│   ├── storage-service/       # 存储服务 - 统一对象存储，多云支持 (6005)
│   ├── mqtt-gateway/          # MQTT网关 - 设备消息接入，消息路由 (6006) [Legacy]
│   ├── protocol-adapter/      # 协议适配器 - Matter 1.5协议与私有协议适配 (6007) [Legacy]
│   ├── baby-service/          # 婴儿看护服务 - 宝宝档案、喂养、睡眠、AI监控 (6008)
│   ├── admin-service/         # 管理服务 - 域管理、配额管理 (6009)
│   └── device-gateway/        # 统一设备网关 - 整合MQTT网关和协议适配器 (6010) [New]
├── common/                     # 公共模块
│   ├── shared-types/          # 共享类型定义
│   ├── shared-utils/          # 共享工具类（缓存、服务通信、中间件等）
│   ├── shared-constants/      # 共享常量
│   ├── shared-decorators/     # 共享装饰器
│   └── aws-credentials/       # AWS凭证配置
├── database/                   # 数据库相关
│   ├── migrations/            # 数据库迁移
│   └── *.sql                  # 数据库初始化脚本
├── k8s/                        # Kubernetes部署配置
├── deployment/                 # 部署相关文档
│   └── windows/               # Windows部署脚本
├── docs/                       # 项目文档
├── scripts/                    # 工具脚本
└── tools/                      # 开发工具
```

### 架构演进

**Device Gateway 统一设备网关服务**（新架构）

项目正在将 MQTT Gateway 和 Protocol Adapter 整合为统一的 Device Gateway 服务，提供：

- **统一的设备接入层**：整合 MQTT 消息网关和协议适配功能
- **协议转换**：Matter 1.5 协议与私有协议之间的双向转换
- **设备管理**：设备注册、认证、会话管理、ACL控制
- **消息路由**：智能消息路由和协议路由
- **服务发现**：支持服务间自动发现和通信

> 注：当前 mqtt-gateway (6006) 和 protocol-adapter (6007) 保留用于平滑迁移，迁移完成后将移除。

## 技术栈

### 核心技术
- **框架**: Midway.js (Node.js) - 企业级Node.js框架
- **数据库**: MySQL 8.0+ - 主数据存储
- **缓存**: Redis 7.0+ - 缓存、消息队列、会话存储
- **消息队列**: MQTT Broker (EMQX 5.4) - IoT设备通信
- **协议**: Matter 1.5, 私有协议 - 设备通信协议
- **流媒体**: AWS KVS, 腾讯云, WebRTC - 视频流服务
- **存储**: AWS S3, 腾讯云COS, MinIO - 对象存储

### 开发工具
- **容器化**: Docker, Docker Compose - 本地开发和部署
- **编排**: Kubernetes - 生产环境容器编排
- **构建工具**: Turborepo - Monorepo 构建系统
- **类型系统**: TypeScript 5.0+ - 类型安全

### 共享基础设施
- **统一缓存管理器** (CacheManager)
  - 自动序列化/反序列化
  - 缓存穿透保护
  - 支持多种数据结构（String, Hash, List, ZSet）
  - SCAN 命令避免阻塞

- **服务间通信客户端** (ServiceClient)
  - 统一的服务调用接口
  - 自动 API Key 认证
  - 请求重试和超时控制
  - 服务发现集成

- **通用中间件**
  - 域上下文中间件
  - 域权限控制中间件
  - 全局错误处理中间件

- **工具类库**
  - ID生成器（UUID、短ID、设备ID）
  - 密码工具（哈希、验证、强度校验）
  - 签名工具（HMAC-SHA256）
  - 日期/JSON/URL工具
  - 验证工具（邮箱、手机、IP、MAC）

## 核心功能

### 1. 设备管理
- 设备注册与认证
- 设备状态管理
- 设备远程控制
- OTA固件升级
- 设备分组管理
- 设备分享与邀请
- 设备生命周期管理

### 2. 统一设备网关（Device Gateway）- 新架构
- **MQTT连接管理**：设备MQTT连接的统一接入点
- **协议转换**：Matter 1.5 与私有协议的双向转换
- **设备认证**：统一的设备注册和认证流程
- **会话管理**：设备会话状态管理
- **ACL控制**：基于角色的访问控制列表
- **消息路由**：智能消息路由和协议路由
- **服务发现**：支持服务间自动发现和通信
- **设备发现**：自动发现网络中的Matter设备

### 3. 协议支持
- **私有协议**: 自定义的MQTT协议
- **Matter 1.5**: 支持标准Matter设备接入
  - mDNS 设备发现
  - BLE 配网
  - TCP/UDP 通信
  - 属性订阅和命令执行

### 3. 音视频流
- 实时视频流推拉
- 云录制与回放
- WebRTC实时通话
- 多云视频服务支持

### 4. 存储服务
- 统一对象存储接口
- 多云存储支持
- 自动故障转移
- 数据分层存储

### 5. 婴儿看护服务 (Baby Service)
- **宝宝档案管理**: 基本信息、设备关联、多宝宝支持
- **喂养记录**: 母乳/奶粉/辅食追踪、喂奶量统计
- **睡眠追踪**: 小睡/夜间睡眠记录、睡眠模式分析
- **成长记录**: 体重/身高/头围、WHO生长标准对比
- **健康事件**: 生病、用药、疫苗记录
- **里程碑记录**: 运动、语言、认知等发展里程碑
- **AI智能监控**: 哭声检测、人脸识别、移动检测、区域告警
- **数据分析**: 每日摘要、周报、喂养/睡眠模式分析
- **智能提醒**: 喂奶、换尿布、用药等定时提醒

### 6. 域管理服务 (Admin Service)
- **域管理**: 多租户域管理
- **配额管理**: 用户/设备/存储配额控制
- **权限管理**: 域级权限控制
- **试用管理**: 试用期管理

## 快速开始

### 环境要求
- Node.js >= 18.0.0
- MySQL >= 8.0
- Redis >= 7.0
- MQTT Broker (推荐 EMQX)
- Docker & Docker Compose (用于容器化部署)

### 本地开发

```bash
# 安装依赖
npm install

# 复制环境配置文件
cp .env.example .env

# 编辑 .env 文件，配置数据库、Redis等服务地址

# 初始化数据库
npm run db:migrate

# 启动所有服务
npm run dev

# 启动单个服务
npm run dev:api-gateway
npm run dev:user-service
npm run dev:device-service
npm run dev:baby-service
npm run dev:device-gateway  # 新架构统一设备网关
# ... 其他服务
```

### Docker 部署

```bash
# 复制环境配置文件
cp .env.example .env

# 编辑 .env 文件，设置生产环境配置

# 启动所有服务（包括基础设施）
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f [service-name]

# 停止服务
docker-compose down
```

### Kubernetes 部署

```bash
# 创建命名空间
kubectl apply -f k8s/namespace.yaml

# 部署基础设施
kubectl apply -f k8s/mysql.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/emqx.yaml
kubectl apply -f k8s/minio.yaml

# 部署微服务（需要先构建镜像）
# 参考 deployment/ 目录下的文档
```

## 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| API Gateway | 6001 | API网关 |
| User Service | 6002 | 用户服务 |
| Device Service | 6003 | 设备管理服务 |
| Video Service | 6004 | 视频服务 |
| Storage Service | 6005 | 存储服务 |
| MQTT Gateway | 6006 | MQTT网关 [Legacy] |
| Protocol Adapter | 6007 | 协议适配器 [Legacy] |
| Baby Service | 6008 | 婴儿看护服务 |
| Admin Service | 6009 | 管理服务 |
| **Device Gateway** | **6010** | **统一设备网关 [新架构]** |
| MySQL | 3306 | 数据库 |
| Redis | 6379 | 缓存 |
| EMQX MQTT | 1883 | MQTT Broker |
| EMQX Dashboard | 18083 | EMQX管理界面 |
| EMQX WebSocket | 8083 | MQTT WebSocket |
| MinIO API | 9000 | 对象存储API |
| MinIO Console | 9001 | MinIO管理界面 |

## API文档

各服务Swagger UI地址：
- API Gateway: http://localhost:6001/swagger-ui
- User Service: http://localhost:6002/swagger-ui
- Device Service: http://localhost:6003/swagger-ui
- Video Service: http://localhost:6004/swagger-ui
- Storage Service: http://localhost:6005/swagger-ui
- MQTT Gateway: http://localhost:6006/swagger-ui [Legacy]
- Protocol Adapter: http://localhost:6007/swagger-ui [Legacy]
- Baby Service: http://localhost:6008/swagger-ui
- Admin Service: http://localhost:6009/swagger-ui
- **Device Gateway**: http://localhost:6010/swagger-ui [新架构]

详细API文档请查看 [docs/](docs/) 目录

## 文档索引

### 核心文档
- [项目概述](docs/PROJECT_OVERVIEW.md) - 项目整体介绍
- [系统架构](docs/architecture.md) - 系统架构设计
- [快速开始](docs/getting-started.md) - 快速入门指南
- [部署指南](docs/deployment-guide.md) - 生产环境部署
- [Windows部署](docs/windows-deployment-guide.md) - Windows环境部署

### 服务文档
- [API网关](docs/api-gateway.md) - API网关服务详解
- [用户服务](docs/user-service.md) - 用户服务详解
- [设备服务API](docs/device-service-api.md) - 设备管理API文档
- [MQTT网关](docs/mqtt-gateway.md) - MQTT网关服务详解 [Legacy]
- [MQTT网关API](docs/mqtt-gateway-api.md) - MQTT网关API文档 [Legacy]
- [协议适配器](docs/protocol-adapter.md) - 协议适配服务详解 [Legacy]
- **[统一设备网关](docs/device-gateway.md)** - **Device Gateway服务详解 [新架构]**
- **[Device Gateway迁移指南](docs/device-gateway-migration.md)** - **架构整合迁移指南**
- [视频服务](docs/video-service.md) - 视频服务详解
- [存储服务](docs/storage-service.md) - 存储服务详解
- [婴儿看护服务](docs/baby-service.md) - 婴儿看护服务详解
- [管理服务](docs/admin-service.md) - 管理服务详解

### 设备认证
- [设备认证](docs/device-authentication.md) - 设备认证详解
- [设备认证实现](docs/device-auth-implementation-guide.md) - 设备认证实现指南
- [设备配置](docs/device-provisioning.md) - 设备配置指南

### 协议文档
- [Matter SDK集成](docs/matter-sdk-integration-guide.md) - Matter协议集成指南
- [私有协议与Matter协议](docs/私有协议与Matter协议设备通信详解.md) - 协议通信详解
- [系统通信架构](docs/系统通信架构详解.md) - 通信架构详解

### 其他文档
- [Swagger集成](docs/swagger-integration-guide.md) - Swagger API文档集成
- [测试运行指南](docs/test-run-guide.md) - 测试运行指南
- [微服务职责](docs/微服务职责详解.md) - 微服务职责划分

## 定制化服务

### User Service - 用户服务

用户认证、授权和信息管理服务，详见 [docs/user-service.md](docs/user-service.md)

**核心功能**:
- 多种登录方式（密码、短信、邮箱、第三方）
- 用户信息管理、头像上传
- 设备绑定与权限管理
- 会话管理、多设备登录
- 家庭成员管理
- 第三方登录（微信、支付宝、Apple、GitHub等）

**服务端口**: 6002

**API示例**:
```bash
# 登录
curl -X POST http://localhost:6002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "type": "password",
    "account": "user@example.com",
    "password": "password"
  }'

# 获取用户信息
curl http://localhost:6002/api/users/me \
  -H "Authorization: Bearer <token>"
```

### Baby Service - 婴儿看护服务

专门针对婴儿看护场景的定制化服务，详见 [docs/baby-service.md](docs/baby-service.md)

**核心功能**:
- 宝宝档案管理、喂养记录、睡眠追踪
- 成长记录、健康事件、里程碑追踪
- AI智能监控（哭声/人脸/移动检测）
- 数据分析（每日摘要、周报、模式分析）
- 智能提醒系统

**服务端口**: 6008

**API示例**:
```bash
# 创建宝宝档案
curl -X POST http://localhost:6008/api/babies \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "小宝贝",
    "gender": "male",
    "birthDate": "2024-01-01"
  }'

# 开始喂奶
curl -X POST http://localhost:6008/api/babies/baby-001/feeding/start \
  -H "Authorization: Bearer <token>" \
  -d '{"type": "breast_milk"}'

# 查看今日统计
curl http://localhost:6008/api/babies/baby-001/feeding/today \
  -H "Authorization: Bearer <token>"
```

### Admin Service - 管理服务

域管理和配额管理服务

**核心功能**:
- 域管理（多租户）
- 用户/设备/存储配额控制
- 域级权限管理
- 试用期管理

**服务端口**: 6009

## 开发指南

### 代码规范
项目使用 ESLint 和 Prettier 进行代码规范检查

```bash
# 运行代码检查
npm run lint

# 自动修复
npm run lint -- --fix
```

### 测试
```bash
# 运行所有测试
npm run test

# 运行单个服务测试
npm run test --workspace=@baby-monitor/user-service
```

### 构建
```bash
# 构建所有服务
npm run build

# 构建单个服务
npm run build --workspace=@baby-monitor/user-service
```

## 环境变量配置

主要环境变量说明（详见 `.env.example`）：

```bash
# 数据库配置
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_DATABASE=babymonitor
MYSQL_USER=babymonitor_user
MYSQL_PASSWORD=your_secure_password

# Redis配置
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your_secure_password

# MQTT配置
MQTT_HOST=emqx
MQTT_PORT=1883

# JWT配置
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=2h

# 存储配置
STORAGE_TYPE=minio
MINIO_ENDPOINT=minio:9000
```

## 默认管理员

系统首次启动时会自动创建默认管理员账户：

- 用户名: `admin`
- 邮箱: `admin@babymonitor.com`
- 密码: `ChangeThisPassword123!@#`

**⚠️ 生产环境请务必修改默认密码！**

## 常见问题

### 1. 服务启动失败
检查端口是否被占用：`netstat -an | grep <port>`

### 2. 数据库连接失败
确认MySQL服务已启动，检查 `.env` 中的数据库配置

### 3. Redis连接失败
确认Redis服务已启动，检查密码配置

### 4. MQTT连接失败
确认EMQX服务已启动，检查MQTT Broker地址

## 许可证

Copyright © 2024 Baby Monitor IoT Platform
