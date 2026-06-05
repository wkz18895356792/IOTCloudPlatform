# API Gateway 路由配置文档

## 概述

API Gateway 是所有客户端请求的统一入口，运行在端口 **6001**。

## 微服务端口映射

| 服务名称 | 端口 | 描述 |
|---------|------|------|
| API Gateway | 6001 | API 网关（统一入口） |
| User Service | 6002 | 用户认证和管理服务 |
| Device Service | 6003 | 设备管理服务 |
| Video Service | 6004 | 视频服务 |
| Storage Service | 6005 | 文件存储服务 |
| MQTT Gateway | 6006 | MQTT 网关服务 |
| Protocol Adapter | 6007 | 协议适配服务 |
| Baby Service | 6008 | 婴儿护理服务 |

## API 路由映射

### 1. 用户服务 (Port 6002)

**基础路径**: `http://localhost:6001/api/auth`, `http://localhost:6001/api/users`

#### 认证相关 (`/api/auth`)
- `POST /api/auth/login` - 用户登录
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/refresh` - 刷新 Token
- `POST /api/auth/send-code` - 发送验证码
- `POST /api/auth/send-reset-email` - 发送密码重置邮件
- `POST /api/auth/reset-password` - 重置密码
- `POST /api/auth/logout` - 登出

#### 面容ID登录 (`/api/face-id`)
- `GET /api/face-id/status` - 获取面容ID登录状态
- `POST /api/face-id/enable` - 开通面容ID登录
- `POST /api/face-id/disable` - 关闭面容ID登录
- `POST /api/face-id/verify` - 验证面容ID登录
- `PUT /api/face-id/update` - 更新面容ID数据

#### 用户管理 (`/api/users`)
- `GET /api/users/me` - 获取当前用户信息
- `PUT /api/users/me/profile` - 更新用户资料
- `PUT /api/users/me/password` - 修改密码
- `POST /api/users/me/avatar` - 上传头像
- `DELETE /api/users/me` - 删除账户
- `GET /api/users/me/devices` - 获取用户设备列表
- `POST /api/users/me/devices/:deviceId` - 绑定设备
- `DELETE /api/users/me/devices/:deviceId` - 解绑设备
- `GET /api/users/me/sessions` - 获取会话列表
- `DELETE /api/users/me/sessions/:sessionId` - 删除会话
- `DELETE /api/users/me/sessions` - 删除所有会话

#### 通知管理 (`/api/users/me/notifications`)
- `GET /api/users/me/notifications/settings` - 获取通知设置
- `PUT /api/users/me/notifications/settings/push` - 更新推送通知开关
- `PUT /api/users/me/notifications/settings/dnd` - 设置免打扰时间段
- `PUT /api/users/me/notifications/settings/crying` - 设置哭声检测通知
- `PUT /api/users/me/notifications/settings/temperature-humidity` - 设置温湿度告警
- `PUT /api/users/me/notifications/settings/auto-soothing` - 设置自动播放安抚音乐
- `PUT /api/users/me/notifications/settings/geofence` - 设置电子围栏
- `GET /api/users/me/notifications/ringtones` - 获取通知铃声列表
- `PUT /api/users/me/notifications/settings/ringtone` - 设置通知铃声
- `GET /api/users/me/notifications/history` - 获取通知历史
- `GET /api/users/me/notifications/unread-count` - 获取未读通知数量
- `PUT /api/users/me/notifications/history/:notificationId/read` - 标记通知为已读
- `PUT /api/users/me/notifications/history/read-all` - 标记所有通知为已读
- `PUT /api/users/me/notifications/history/:notificationId/acknowledge` - 确认通知
- `DELETE /api/users/me/notifications/history` - 清空通知历史

#### 服务订阅 (`/api/subscription`)
- `GET /api/subscription/plans` - 获取所有套餐
- `GET /api/subscription/plans/:planId` - 获取套餐详情
- `POST /api/subscription/orders` - 创建购买订单
- `POST /api/subscription/orders/:orderNo/pay` - 支付订单
- `GET /api/subscription/orders` - 获取订单列表
- `GET /api/subscription/my-subscription` - 获取我的订阅状态
- `POST /api/subscription/my-subscription/renew` - 续费订阅
- `DELETE /api/subscription/my-subscription` - 取消订阅
- `GET /api/subscription/benefits` - 获取服务权益

#### 通知铃声管理 (`/api/ringtones`)
- `GET /api/ringtones` - 获取铃声列表
- `GET /api/ringtones/search` - 搜索铃声
- `GET /api/ringtones/:ringtoneId` - 获取铃声详情
- `POST /api/ringtones/custom` - 上传自定义铃声
- `PUT /api/ringtones/custom/:ringtoneId` - 更新铃声信息
- `DELETE /api/ringtones/custom/:ringtoneId` - 删除自定义铃声
- `GET /api/ringtones/custom/stats` - 获取自定义铃声统计
- `POST /api/ringtones/:ringtoneId/play` - 记录铃声播放

#### 帮助中心 (`/api/help`)
- `GET /api/help/articles` - 获取帮助文章列表
- `GET /api/help/articles/:articleId` - 获取文章详情
- `GET /api/help/articles/:articleId/related` - 获取相关文章
- `GET /api/help/search` - 搜索帮助文章
- `GET /api/help/articles/popular` - 获取热门文章
- `POST /api/help/articles/:articleId/feedback` - 记录文章反馈
- `POST /api/help/tickets` - 创建技术支持工单
- `GET /api/help/tickets` - 获取我的工单
- `GET /api/help/tickets/:ticketId` - 获取工单详情
- `PUT /api/help/tickets/:ticketId` - 更新工单
- `POST /api/help/tickets/:ticketId/close` - 关闭工单
- `GET /api/help/tickets/stats` - 获取工单统计

### 2. 设备服务 (Port 6003)

**基础路径**: `http://localhost:6001/api/devices`

#### 设备管理
- `POST /api/devices` - 创建设备
- `GET /api/devices` - 获取设备列表
- `GET /api/devices/:deviceId` - 获取设备详情
- `PUT /api/devices/:deviceId` - 更新设备信息
- `DELETE /api/devices/:deviceId` - 删除设备
- `GET /api/devices/:deviceId/state` - 获取设备状态
- `POST /api/devices/:deviceId/command` - 发送设备命令
- `GET /api/devices/:deviceId/online` - 检查设备在线状态

#### 设备配网 (`/api/devices`)
- `POST /api/devices/discovery/bluetooth` - 开始蓝牙设备搜索
- `POST /api/devices/discovery/bluetooth/stop` - 停止蓝牙设备搜索
- `POST /api/devices/bluetooth/connect` - 连接蓝牙设备
- `POST /api/devices/bluetooth/disconnect` - 断开蓝牙设备
- `POST /api/devices/:deviceId/wifi/scan` - 扫描WiFi网络
- `POST /api/devices/:deviceId/wifi/config` - 配置设备WiFi
- `GET /api/devices/:deviceId/wifi/status` - 获取设备WiFi状态
- `POST /api/devices/wifi/current` - 保存手机当前WiFi信息
- `GET /api/devices/provisioning/:taskId/result` - 获取配网任务结果
- `GET /api/devices/provisioning/:taskId/progress` - 获取配网任务进度
- `POST /api/devices/provisioning/:taskId/cancel` - 取消配网任务

#### 云台控制 (`/api/devices`)
- `POST /api/devices/:deviceId/ptz/control` - 云台移动控制
- `POST /api/devices/:deviceId/ptz/stop` - 停止云台移动
- `GET /api/devices/:deviceId/ptz/position` - 获取云台当前位置
- `POST /api/devices/:deviceId/ptz/presets` - 设置预设位置
- `GET /api/devices/:deviceId/ptz/presets` - 获取预设位置列表
- `DELETE /api/devices/:deviceId/ptz/presets/:presetId` - 删除预设位置
- `POST /api/devices/:deviceId/ptz/presets/:presetId/goto` - 跳转到预设位置
- `POST /api/devices/:deviceId/ptz/cruise` - 云台自动巡航

#### 对讲和安抚 (`/api/devices`)
- `POST /api/devices/:deviceId/talk/start` - 开始对讲
- `POST /api/devices/:deviceId/talk/stop` - 停止对讲
- `GET /api/devices/:deviceId/talk/status` - 获取对讲状态
- `GET /api/devices/:deviceId/soothing/music` - 获取安抚音乐列表
- `POST /api/devices/:deviceId/soothing/play` - 播放安抚音乐
- `POST /api/devices/:deviceId/soothing/stop` - 停止安抚音乐
- `PUT /api/devices/:deviceId/soothing/volume` - 设置音乐音量
- `PUT /api/devices/:deviceId/soothing/auto-play` - 设置自动播放安抚音乐
- `GET /api/devices/:deviceId/soothing/auto-play` - 获取自动播放设置

#### 设备邀请 (`/api/devices`)
- `GET /api/devices/:deviceId/invites` - 获取设备邀请列表
- `POST /api/devices/:deviceId/invites` - 创建设备观看邀请
- `POST /api/devices/invites/:inviteId/accept` - 接受设备观看邀请
- `POST /api/devices/invites/:inviteId/reject` - 拒绝设备观看邀请
- `DELETE /api/devices/invites/:inviteId` - 删除设备观看邀请
- `PUT /api/devices/invites/:inviteId/permissions` - 更新邀请权限
- `GET /api/devices/viewable` - 获取可观看的设备列表
- `GET /api/devices/:deviceId/permissions` - 获取设备权限
- `POST /api/devices/:deviceId/viewing/start` - 开始观看
- `POST /api/devices/:deviceId/viewing/end` - 结束观看
- `GET /api/devices/:deviceId/viewing/history` - 获取观看历史
- `DELETE /api/devices/:deviceId/viewing/history` - 清空观看历史

#### 视频回看 (`/api/devices`)
- `GET /api/devices/:deviceId/recordings` - 获取7天视频列表
- `GET /api/devices/:deviceId/recordings/daily` - 按日期获取视频
- `GET /api/devices/recordings/:recordingId/url` - 获取视频播放地址
- `GET /api/devices/:deviceId/timeline` - 获取时光轴事件
- `GET /api/devices/:deviceId/timeline/summary` - 获取时光轴摘要
- `GET /api/devices/:deviceId/timeline/key-events` - 获取关键事件列表

#### 设备自检 (`/api/devices`)
- `POST /api/devices/:deviceId/check/start` - 启动设备自检
- `GET /api/devices/:deviceId/check/progress` - 获取自检进度
- `GET /api/devices/:deviceId/check/result` - 获取自检结果
- `GET /api/devices/:deviceId/check/history` - 获取自检历史
- `GET /api/devices/:deviceId/health` - 获取设备健康状态

#### 固件管理 (`/api/firmware`)
- `POST /api/firmware/versions` - 创建固件版本
- `GET /api/firmware/versions/:productId` - 获取产品固件版本列表
- `GET /api/firmware/devices/:deviceId/check-update` - 检查固件更新
- `POST /api/firmware/ota/tasks` - 创建OTA升级任务
- `GET /api/firmware/ota/tasks/:taskId` - 获取OTA任务详情
- `GET /api/firmware/devices/:deviceId/ota/tasks` - 获取设备OTA任务列表
- `POST /api/firmware/ota/tasks/:taskId/cancel` - 取消OTA任务
- `POST /api/firmware/ota/tasks/:taskId/status` - 更新OTA任务状态

### 3. 视频服务 (Port 6004)

**基础路径**: `http://localhost:6001/api/videos`, `http://localhost:6001/api/video-service`

#### 流管理 (`/api/videos`)
- `POST /api/videos` - 开始推流
- `DELETE /api/videos/:sessionId` - 停止推流
- `GET /api/videos/:sessionId/url` - 获取播放地址
- `GET /api/videos/device/:deviceId` - 获取设备流列表

#### 视频服务管理 (`/api/video-service`)
- `GET /api/video-service/sessions` - 获取会话列表
- `GET /api/video-service/sessions/:sessionId` - 获取会话详情
- `GET /api/video-service/sessions/active` - 获取活动会话
- `GET /api/video-service/recordings` - 获取录制列表
- `GET /api/video-service/recordings/:recordingId` - 获取录制详情
- `GET /api/video-service/recordings/:recordingId/play` - 播放视频
- `POST /api/video-service/transcodes` - 创建转码任务
- `GET /api/video-service/webrtc/sessions` - 获取 WebRTC 会话列表

### 4. 存储服务 (Port 6005)

**基础路径**: `http://localhost:6001/api/storage`

#### 文件操作
- `POST /api/storage/upload` - 上传文件
- `GET /api/storage/url/:key` - 获取文件 URL
- `GET /api/storage/exists/:key` - 检查文件是否存在
- `DELETE /api/storage/:key` - 删除文件
- `POST /api/storage/copy` - 复制文件
- `POST /api/storage/move` - 移动文件
- `GET /api/storage/list` - 列出文件

#### 分片上传
- `POST /api/storage/multipart/create` - 创建分片上传
- `POST /api/storage/multipart/upload` - 上传分片
- `POST /api/storage/multipart/complete` - 完成分片上传
- `DELETE /api/storage/multipart/:uploadId` - 取消分片上传

#### 元数据管理
- `GET /api/storage/metadata/:key` - 获取文件元数据
- `GET /api/storage/access/:key` - 获取文件访问记录
- `POST /api/storage/tags/:key` - 添加文件标签
- `GET /api/storage/tags/:key` - 获取文件标签

#### 配额管理
- `POST /api/storage/quota` - 设置配额
- `GET /api/storage/quota` - 获取配额
- `GET /api/storage/statistics/:provider` - 获取存储统计
- `GET /api/storage/trend/:provider` - 获取存储趋势
- `GET /api/storage/overview/:userId` - 获取用户存储概览

#### 文件分享
- `POST /api/storage/shares` - 创建分享链接
- `POST /api/storage/shares/:shareId/validate` - 验证分享访问
- `GET /api/storage/shares` - 获取用户分享
- `DELETE /api/storage/shares/:shareId` - 撤销分享

### 5. MQTT 网关 (Port 6006)

**基础路径**: `http://localhost:6001/api/mqtt-gateway`

#### 统计和状态
- `GET /api/mqtt-gateway/statistics` - 获取网关整体统计

#### 会话管理
- `GET /api/mqtt-gateway/sessions` - 获取所有会话列表
- `GET /api/mqtt-gateway/sessions/:deviceId` - 获取会话详情
- `GET /api/mqtt-gateway/sessions/:deviceId/subscriptions` - 获取会话订阅
- `DELETE /api/mqtt-gateway/sessions/:deviceId` - 踢出会话

#### 消息队列管理
- `GET /api/mqtt-gateway/queue/statistics` - 获取队列统计
- `GET /api/mqtt-gateway/queue/devices/:deviceId` - 获取设备消息队列
- `GET /api/mqtt-gateway/queue/devices/:deviceId/dead-letters` - 获取设备死信队列
- `POST /api/mqtt-gateway/queue/dead-letters/:dlqId/retry` - 重试死信队列消息
- `DELETE /api/mqtt-gateway/queue/devices/:deviceId` - 清空设备消息队列

#### ACL 管理
- `POST /api/mqtt-gateway/acl/rules` - 创建 ACL 规则
- `GET /api/mqtt-gateway/acl/rules` - 获取所有 ACL 规则
- `DELETE /api/mqtt-gateway/acl/rules/:type/:id/:ruleId` - 删除 ACL 规则
- `POST /api/mqtt-gateway/acl/check` - 检查权限

### 6. 协议适配服务 (Port 6007)

**基础路径**: `http://localhost:6001/api/protocol-adapter`

#### 协议转换
- `POST /api/protocol-adapter/converter/private-to-matter` - 私有协议转 Matter
- `POST /api/protocol-adapter/converter/matter-to-private` - Matter 转私有协议
- `POST /api/protocol-adapter/converter/convert-command` - 转换命令
- `POST /api/protocol-adapter/converter/batch-convert` - 批量转换设备状态
- `POST /api/protocol-adapter/converter/mapping` - 创建协议映射
- `GET /api/protocol-adapter/converter/mapping/:deviceId` - 获取协议映射

#### 设备发现
- `POST /api/protocol-adapter/discovery/start` - 开始设备发现
- `GET /api/protocol-adapter/discovery/devices` - 获取发现的设备
- `GET /api/protocol-adapter/discovery/devices/:deviceId` - 获取设备详情
- `GET /api/protocol-adapter/discovery/statistics` - 获取发现统计
- `POST /api/protocol-adapter/discovery/refresh` - 刷新设备列表

#### 设备配网
- `POST /api/protocol-adapter/commissioning/matter` - 配网 Matter 设备
- `POST /api/protocol-adapter/commissioning/private` - 配网私有协议设备
- `GET /api/protocol-adapter/commissioning/tasks/:taskId` - 获取配网任务
- `GET /api/protocol-adapter/commissioning/tasks` - 获取所有配网任务
- `DELETE /api/protocol-adapter/commissioning/tasks/:taskId` - 取消配网任务

#### 协议路由
- `POST /api/protocol-adapter/router/routes` - 创建路由规则
- `GET /api/protocol-adapter/router/routes` - 获取所有路由规则
- `GET /api/protocol-adapter/router/routes/:routeId` - 获取路由规则
- `PUT /api/protocol-adapter/router/routes/:routeId` - 更新路由规则
- `DELETE /api/protocol-adapter/router/routes/:routeId` - 删除路由规则
- `POST /api/protocol-adapter/router/process` - 处理消息

### 7. 婴儿护理服务 (Port 6008)

**基础路径**: `http://localhost:6001/api/babies`

#### 宝宝管理
- `POST /api/babies` - 创建宝宝档案
- `GET /api/babies` - 获取用户的宝宝列表
- `GET /api/babies/:babyId` - 获取宝宝详情
- `PUT /api/babies/:babyId` - 更新宝宝信息
- `DELETE /api/babies/:babyId` - 删除宝宝
- `POST /api/babies/:babyId/devices/:deviceId` - 关联设备
- `DELETE /api/babies/:babyId/devices/:deviceId` - 取消关联设备

#### 喂养记录
- `POST /api/babies/:babyId/feeding/start` - 开始喂奶
- `POST /api/feeding/:logId/end` - 结束喂奶
- `GET /api/babies/:babyId/feeding` - 获取喂奶记录
- `GET /api/babies/:babyId/feeding/today` - 获取今日喂奶统计

#### 睡眠记录
- `POST /api/babies/:babyId/sleep/start` - 开始睡眠
- `POST /api/sleep/:logId/end` - 结束睡眠
- `GET /api/babies/:babyId/sleep` - 获取睡眠记录
- `GET /api/babies/:babyId/sleep/current` - 获取当前睡眠状态
- `GET /api/babies/:babyId/sleep/today` - 获取今日睡眠统计

#### 换尿布记录 (`/api/babies`)
- `POST /api/babies/:babyId/diapers` - 记录换尿布
- `POST /api/babies/:babyId/diapers/batch` - 批量记录换尿布
- `GET /api/babies/:babyId/diapers` - 获取换尿布记录列表
- `GET /api/babies/:babyId/diapers/stats` - 获取换尿布统计
- `GET /api/babies/:babyId/diapers/latest` - 获取最近一次换尿布记录
- `PUT /api/babies/diapers/:logId` - 更新换尿布记录
- `DELETE /api/babies/diapers/:logId` - 删除换尿布记录

#### 监控事件
- `GET /api/babies/:babyId/monitoring/events` - 获取监控事件
- `GET /api/babies/:babyId/monitoring/events/unacknowledged` - 获取未确认的事件
- `POST /api/monitoring/events/:eventId/acknowledge` - 确认事件

#### 数据分析
- `GET /api/babies/:babyId/analytics/daily` - 获取每日摘要
- `GET /api/babies/:babyId/analytics/weekly` - 获取周报
- `GET /api/babies/:babyId/analytics/growth/percentile` - 获取生长百分位
- `GET /api/babies/:babyId/analytics/growth/trend` - 获取生长趋势
- `GET /api/babies/:babyId/analytics/feeding/pattern` - 分析喂养模式
- `GET /api/babies/:babyId/analytics/sleep/pattern` - 获取睡眠模式分析

## 网关管理端点

### 健康检查和状态
- `GET /health` - 健康检查
- `GET /health/routes` - 获取所有服务路由信息

### 速率限制管理
- `POST /api/gateway/ratelimit/rules` - 添加速率限制规则
- `DELETE /api/gateway/ratelimit/rules/:pattern` - 移除速率限制规则
- `GET /api/gateway/ratelimit/rules` - 获取所有速率限制规则
- `GET /api/gateway/ratelimit/stats` - 获取全局速率限制统计

### 熔断器管理
- `POST /api/gateway/circuit/services` - 注册熔断器服务
- `GET /api/gateway/circuit/status/:service` - 获取熔断器状态
- `GET /api/gateway/circuit/status` - 获取所有熔断器状态
- `POST /api/gateway/circuit/reset/:service` - 重置熔断器

### 服务发现管理
- `POST /api/gateway/discovery/services` - 注册服务实例
- `GET /api/gateway/discovery/services` - 获取所有服务
- `GET /api/gateway/discovery/services/:serviceName` - 发现服务
- `POST /api/gateway/discovery/routes` - 创建服务路由
- `GET /api/gateway/discovery/routes` - 获取所有路由

## 认证机制

所有 API 请求（除了 `/api/auth/login` 和 `/api/auth/register`）都需要在 Header 中携带 JWT Token：

```
Authorization: Bearer <your-jwt-token>
```

## 环境变量配置

可以通过以下环境变量覆盖服务主机地址：

- `USER_SERVICE_HOST` - 用户服务主机（默认: localhost）
- `DEVICE_SERVICE_HOST` - 设备服务主机（默认: localhost）
- `VIDEO_SERVICE_HOST` - 视频服务主机（默认: localhost）
- `STORAGE_SERVICE_HOST` - 存储服务主机（默认: localhost）
- `MQTT_GATEWAY_HOST` - MQTT 网关主机（默认: localhost）
- `PROTOCOL_ADAPTER_HOST` - 协议适配服务主机（默认: localhost）
- `BABY_SERVICE_HOST` - 婴儿护理服务主机（默认: localhost）

## 使用示例

### 1. 登录获取 Token

```bash
curl -X POST http://localhost:6001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "password"}'
```

### 2. 使用 Token 访问设备列表

```bash
curl -X GET http://localhost:6001/api/devices \
  -H "Authorization: Bearer <your-jwt-token>"
```

### 3. 创建宝宝档案

```bash
curl -X POST http://localhost:6001/api/babies \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "宝宝", "birthDate": "2024-01-01", "gender": "male"}'
```

### 4. 上传文件

```bash
curl -X POST http://localhost:6001/api/storage/upload \
  -H "Authorization: Bearer <your-jwt-token>" \
  -F "file=@/path/to/file.jpg" \
  -F "key=uploads/file.jpg"
```

### 5. 开始推流

```bash
curl -X POST http://localhost:6001/api/videos \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "device-001", "config": {"protocol": "hls"}}'
```

## 查看所有路由

```bash
curl -X GET http://localhost:6001/health/routes
```

这将返回所有可用的服务路由信息，包括服务名称、端口、路径前缀等。
