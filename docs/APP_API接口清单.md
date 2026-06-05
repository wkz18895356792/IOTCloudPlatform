# amoon AI baby MNT 国内版 APP - API 接口清单

> 来源：[产品功能逻辑-V1.9.md](产品功能逻辑-V1.9.md) + [界面操作逻辑-V1.9.md](界面操作逻辑-V1.9.md) + 源码 `api_paths.dart` + 各模块 `remote_ds`
> 后台架构：7 个微服务通过 API Gateway (6001) 统一入口
> 整理日期：2026-06-02

---

## 0. 微服务架构

| 服务 | 端口 | 路径前缀 | 职责 |
|------|------|----------|------|
| api-gateway | 6001 | `/` | 统一入口，路由分发 |
| user-service | 6002 | `/api/auth`, `/api/oauth`, `/api/users`, `/api/2fa`, `/api/subscription`, `/api/help`, `/api/feedback`, `/api/device-access`, `/api/ringtones` | 用户认证/管理/邀请/帮助 |
| device-service | 6003 | `/api/devices`, `/api/firmware` | 设备管理/控制/OTA |
| video-service | 6004 | `/api/videos` | 视频流/云存储 |
| storage-service | 6005 | `/api/storage` | 文件存储/录像管理 |
| baby-service | 6008 | `/api/babies`, `/api/baby-logs` | 宝宝管理/喂养记录/AI检测 |
| admin-service | 6009 | `/api/admin/*`, `/api/domains` | 后台管理（前端不调用） |

---

## 1. 登录注册（V1.9 §1-2）— user-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 1 | 发送验证码 | POST | `/api/auth/send-code` | 向手机号发送短信验证码，5分钟有效 | ✅ 已接入 |
| 2 | 登录 | POST | `/api/auth/login` | 手机号+验证码登录，新用户自动注册 | ✅ 已接入 |
| 3 | 注册 | POST | `/api/auth/register` | 手动注册（备用通道） | 已定义 |
| 4 | 刷新Token | POST | `/api/auth/refresh` | Token过期自动续期，拦截器自动调用 | ✅ 已接入 |
| 5 | 登出 | POST | `/api/auth/logout` | 退出当前会话 | ✅ 已接入 |

---

## 2. 面容 ID（V1.9 §2）

> 无后台 API，纯客户端能力：
> - `local_auth` 系统生物识别
> - `biometric_service.dart` 管理偏好存储（是否已弹过/是否跳过）
> - 设置页入口：`/sidebar/profile` 面容登录行

---

## 3. 连接设备（V1.9 §3）— device-service + video-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 6 | 添加设备(绑定) | POST | `/api/devices` | SN序列号 + 设备名绑定到用户 | ✅ 已接入 |
| 7 | 设备详情 | GET | `/api/devices/{deviceId}` | 获取设备完整信息 | 已定义 |
| 8 | 连接AP热点 | - | 系统WiFi API | 连接 `A100-XXXX` 无密码热点 | ⚠ 缺系统WiFi跳转 |
| 9 | 开始推流 | POST | `/api/devices/{id}/control/stream/start` | 配网成功后启动视频推流 | 已定义 |
| 10 | 创建设备流资源 | POST | `/api/videos/device/{id}/stream` | 创建KVS Stream资源 | 已定义 |

---

## 4. 摄像头主页（V1.9 §4）— device-service + video-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 11 | 设备实时状态 | GET | `/api/devices/{id}/state` | 温湿度、电量等实时数据 | 已定义 |
| 12 | 设备在线状态 | GET | `/api/devices/{id}/online` | 检查设备是否在线 | 已定义 |
| 13 | 获取播放地址 | GET | `/api/videos/device/{id}/playback` | HLS/RTMP/FLV 播放URL | ✅ 已接入 |
| 14 | 检查推流状态 | GET | `/api/videos/device/{id}/streaming-status` | 设备是否正在推流 | 已定义 |
| 15 | 开始录制 | POST | `/api/devices/{id}/control/recording/start` | APP端触发录像 | 已定义 |
| 16 | 停止录制 | POST | `/api/devices/{id}/control/recording/stop` | 停止录像并保存 | 已定义 |
| 17 | 静音/取消静音 | POST | `/api/devices/{id}/control/mute` | 麦克风静音切换 | 已定义 |
| 18 | 设置分辨率 | POST | `/api/devices/{id}/control/resolution` | HD(720P) / FHD(1080P) | 已定义 |
| 19 | 开始对讲 | POST | `/api/devices/{id}/talk/start` | 双向音频通信开始 | 已定义 |
| 20 | 停止对讲 | POST | `/api/devices/{id}/talk/stop` | 结束对讲会话 | 已定义 |
| 21 | 对讲状态 | GET | `/api/devices/{id}/talk/status` | 查询对讲会话状态 | 已定义 |
| 22 | 安抚音乐列表 | GET | `/api/devices/{id}/soothing/music` | 获取可用音频列表（名称/艺术家/时长） | 已定义 |
| 23 | 播放安抚音乐 | POST | `/api/devices/{id}/soothing/play` | 推送音频到摄像头播放 | 已定义 |
| 24 | 停止安抚音乐 | POST | `/api/devices/{id}/soothing/stop` | 停止摄像头音乐播放 | 已定义 |
| 25 | 设置音乐音量 | PUT | `/api/devices/{id}/soothing/volume` | 摄像头播放音量调节 | 已定义 |

---

## 5. 全屏模式（V1.9 §5）— device-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 26 | PTZ方向控制 | POST | `/api/devices/{id}/ptz/control` | 上/下/左/右，支持单击与长按 | 已定义 |
| 27 | PTZ停止 | POST | `/api/devices/{id}/ptz/stop` | 停止云台运动 | 已定义 |
| 28 | PTZ位置查询 | GET | `/api/devices/{id}/ptz/position` | 获取当前云台位置（极限限位） | 已定义 |
| 29 | 保存预置位 | POST | `/api/devices/{id}/ptz/presets` | 保存当前位置 | 已定义 |
| 30 | 获取预置位列表 | GET | `/api/devices/{id}/ptz/presets` | 所有预置位 | 已定义 |
| 31 | 删除预置位 | DELETE | `/api/devices/{id}/ptz/presets/{presetId}` | 删除预置位 | 已定义 |
| 32 | 转到预置位 | POST | `/api/devices/{id}/ptz/presets/{presetId}/goto` | 快速定位 | 已定义 |
| 33 | 巡航控制 | POST | `/api/devices/{id}/ptz/cruise` | 开始/停止自动巡航 | 已定义 |

> 全屏与竖屏的静音/分辨率/录像/对讲状态需双向实时同步，复用 §4 接口

---

## 6. 通知列表（V1.9 §6）— user-service + video-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 34 | 通知历史列表 | GET | `/api/users/me/notifications/history` | 分页获取通知，按日期分组倒序 | ✅ 已接入 |
| 35 | 未读数量 | GET | `/api/users/me/notifications/unread-count` | 角标数字 | 已定义 |
| 36 | 标记单条已读 | PUT | `/api/users/me/notifications/history/{id}/read` | 单条已读 | 已定义 |
| 37 | 全部已读 | PUT | `/api/users/me/notifications/history/read-all` | 一键全读 | 已定义 |
| 38 | 确认通知(已知晓) | PUT | `/api/users/me/notifications/history/{id}/acknowledge` | 已知晓 | 已定义 |
| 39 | 哭声结果【赞】 | POST | `/api/users/me/notifications/{id}/like` | 空心→黄色高亮，再点取消 | ✅ 已接入 |
| 40 | 哭声结果【踩】 | POST | `/api/users/me/notifications/{id}/dislike` | 空心→灰色+出现【识别反馈】入口 | ✅ 已接入 |
| 41 | 哭声识别反馈 | POST | `/api/users/me/notifications/{id}/feedback` | 手动选5种结果 + 300字反馈 | ✅ 已接入 |
| 42 | 删除单条通知 | DELETE | `/api/users/me/notifications/history/{id}` | 左滑删除 | ✅ 已接入 |
| 43 | 批量删除通知 | DELETE | `/api/users/me/notifications/history/batch` | 编辑态批量删除 | ✅ 已接入 |
| 44 | 清除通知历史 | DELETE | `/api/users/me/notifications/history` | 清空全部 | 已定义 |
| 45 | 云存事件录像列表 | GET | `/api/videos/recordings/{id}/events` | 点击通知跳转视频播放 | 已定义 |

---

## 7. 通知管理（V1.9 §13）— user-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 46 | 获取通知设置 | GET | `/api/users/me/notifications/settings` | 所有开关+参数一次性获取 | 已定义 |
| 47 | 更新推送总开关 | PUT | `/api/users/me/notifications/settings/push` | 接收消息通知（关→6项全关） | 已定义 |
| 48 | 更新免打扰 | PUT | `/api/users/me/notifications/settings/dnd` | 免打扰时段设置 | 已定义 |
| 49 | 更新哭声检测设置 | PUT | `/api/users/me/notifications/settings/crying` | 哭声通知开关 + 自动安抚开关 + 歌曲列表 | 已定义 |
| 50 | 更新温湿度告警 | PUT | `/api/users/me/notifications/settings/temperature-humidity` | 温度20-50℃阈值 / 湿度0-100%阈值 | 已定义 |
| 51 | 更新自动安抚设置 | PUT | `/api/users/me/notifications/settings/auto-soothing` | 自动安抚开关 | 已定义 |
| 52 | 更新电子围栏设置 | PUT | `/api/users/me/notifications/settings/geofence` | 移动通知开关 + 围栏坐标数据 | 已定义 |
| 53 | 获取铃声列表 | GET | `/api/users/me/notifications/ringtones` | 可选通知铃声列表（含本地文件） | 已定义 |
| 54 | 更新铃声设置 | PUT | `/api/users/me/notifications/settings/ringtone` | 选择铃声 + 音量 + 振动 | 已定义 |

> ⚠ 区域入侵、人形侦测两个子页的独立设置接口目前合并于AI检测配置（§8 #100）

---

## 8. 宝宝记（V1.9 §7）— baby-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 55 | 获取宝宝列表 | GET | `/api/babies` | 当前用户所有宝宝档案（分页） | ✅ 已接入 |
| 56 | 创建宝宝 | POST | `/api/babies` | 新建宝宝（姓名/性别/出生日期） | ✅ 已接入 |
| 57 | 获取宝宝详情 | GET | `/api/babies/{id}` | 单个宝宝完整信息 | 已定义 |
| 58 | 更新宝宝信息 | PUT | `/api/babies/{id}` | 编辑宝宝资料 | 已定义 |
| 59 | 删除宝宝 | DELETE | `/api/babies/{id}` | 删除档案（同步删宝宝记内容） | 已定义 |
| 60 | 绑定设备到宝宝 | POST | `/api/babies/{id}/devices/{deviceId}` | 设备-宝宝绑定 | 已定义 |
| 61 | 解绑设备 | DELETE | `/api/babies/{id}/devices/{deviceId}` | 解绑 | 已定义 |

### 8.1 宝宝日志（统一记录接口）

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 62 | 创建日志 | POST | `/api/baby-logs` | 通用：哺乳/瓶喂/睡眠/换尿布一次性补录 | ✅ 已接入 |
| 63 | 批量创建 | POST | `/api/baby-logs/batch` | 批量写入 | 已定义 |
| 64 | 获取日志列表 | GET | `/api/baby-logs?babyId=&eventTypes=` | 分页+事件类型筛选+日期筛选 | ✅ 已接入 |
| 65 | 获取日志详情 | GET | `/api/baby-logs/{id}` | 单条记录详情 | 已定义 |
| 66 | 更新日志 | PUT | `/api/baby-logs/{id}` | 编辑已有记录 | 已定义 |
| 67 | 删除日志 | DELETE | `/api/baby-logs/{id}` | 删除单条 | 已定义 |
| 68 | 批量删除 | DELETE | `/api/baby-logs/batch` | 批量删除 | 已定义 |
| 69 | 获取最新日志 | GET | `/api/baby-logs/latest/{babyId}` | 最近一条记录 | 已定义 |
| 70 | 确认日志 | POST | `/api/baby-logs/{id}/acknowledge` | 确认监控事件 | 已定义 |
| 71 | 批量确认 | POST | `/api/baby-logs/acknowledge/batch` | 批量确认 | 已定义 |
| 72 | 日志统计 | GET | `/api/baby-logs/stats/{babyId}` | 按天/周/月统计数据 | 已定义 |
| 73 | 每日摘要 | GET | `/api/baby-logs/summary/{babyId}/daily` | 当日汇总 | 已定义 |

---

## 9. 图表统计（V1.9 §8）— baby-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 74 | 每日摘要 | GET | `/api/babies/{id}/analytics/daily` | 喂养+睡眠+尿布日报 | 已定义 |
| 75 | 周报数据 | GET | `/api/babies/{id}/analytics/weekly` | 周汇总 | 已定义 |
| 76 | 喂养模式分析 | GET | `/api/babies/{id}/analytics/feeding/pattern` | 哺乳/瓶喂折线图数据 | 已定义 |
| 77 | 睡眠模式分析 | GET | `/api/babies/{id}/analytics/sleep/pattern` | 睡眠折线图数据 | 已定义 |
| 78 | 生长百分位 | GET | `/api/babies/{id}/analytics/growth/percentile` | 身高/体重/头围百分位参考 | 已定义 |
| 79 | 生长趋势曲线 | GET | `/api/babies/{id}/analytics/growth/trend` | 体重/身高历史趋势 | 已定义 |

---

## 10. 设备绑定（V1.9 §9）— baby-service + device-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 80 | 宝宝绑定设备 | POST | `/api/babies/{id}/devices/{deviceId}` | 绑定（覆盖旧绑定） | 已定义 |
| 81 | 宝宝解绑设备 | DELETE | `/api/babies/{id}/devices/{deviceId}` | 解绑 | 已定义 |
| 82 | 检查宝宝权限 | GET | `/api/babies/{id}/permissions/{userId}` | 校验用户对宝宝的操作权限 | 已定义 |

> **后端阻塞**：Device 实体缺 `boundBabyId` / `boundBabyName` 字段，导致 4 种绑定情况的前端提示无法完整实现

---

## 11. 侧边栏（V1.9 §10）— device-service + user-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 83 | 设备列表 | GET | `/api/devices` | 按添加时间排序的设备列表 | ✅ 已接入 |
| 84 | 用户绑定设备列表 | GET | `/api/users/me/devices` | 当前用户的设备（含权限） | 已定义 |
| 85 | 更新设备名称 | PUT | `/api/devices/{id}` | 修改设备名（实时更新侧边栏） | 已定义 |
| 86 | 服务有效期 | - | 客户端计算 | firstBindDate + 179天，第181天00:00失效 | 客户端计算 |

> 服务失效拦截弹窗 → `SystemNavigator.pop()` 退出APP

---

## 12. 个人信息（V1.9 §11）— user-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 87 | 获取用户信息 | GET | `/api/users/me` | 昵称 + 头像URL + 手机号 | ✅ 已接入 |
| 88 | 更新用户资料 | PUT | `/api/users/me/profile` | 修改昵称（限20字符） | 已定义 |
| 89 | 上传/更新头像 | POST | `/api/users/me/avatar` | 头像URL保存 | 已定义 |
| 90 | 修改密码 | PUT | `/api/users/me/password` | 旧密码 → 新密码 | 已定义 |
| 91 | 删除账户 | DELETE | `/api/users/me` | 注销账户 | 已定义 |

---

## 13. 设置（V1.9 §12）— device-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 92 | 发送设备命令 | POST | `/api/devices/{id}/command` | 电源指示灯开关 / 环形灯开关及亮度 / 夜视开关 | 已定义 |
| 93 | 获取设备健康报告 | GET | `/api/devices/{id}/health-report` | 故障自检：WiFi/视频云/温度传感器/湿度传感器 | 已定义 |
| 94 | 获取设备统计 | GET | `/api/devices/{id}/statistics` | 设备运行统计 | 已定义 |
| 95 | 恢复出厂设置 | POST | `/api/devices/{id}/control/factory-reset` | 恢复出厂 | 已定义 |
| 96 | 解绑设备 | DELETE | `/api/devices/{id}` | 解绑 + toast"设备已解绑" | ✅ 已接入 |

---

## 14. 添加设备（V1.9 §14）— 复用 §3 接口

> 接口同 #6-10，附加：
> - 设备命名规则 `amoon AI 婴儿摄像头 N`（N=1-99，超99显示99+）
> - 新设备 "new" 标识（切换后消失）
> - 解绑后其他设备序号不变

---

## 15. 邀请观看（V1.9 §15）— user-service /api/device-access

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 97 | 获取邀请列表 | GET | `/api/device-access/{deviceId}/invitations` | 已邀请用户列表（按时间倒序） | 已定义 |
| 98 | 创建邀请 | POST | `/api/device-access/{deviceId}/invitations` | 邀请手机号 + 9项主页权限 + 宝宝记/侧边栏权限 | 已定义 |
| 99 | 通过验证码接受 | POST | `/api/device-access/invitations/accept-by-code` | 被邀请者接收 | 已定义 |
| 100 | 通过ID接受邀请 | POST | `/api/device-access/invitations/{id}/accept` | 链接接受 | 已定义 |
| 101 | 拒绝邀请 | POST | `/api/device-access/invitations/{id}/reject` | 拒绝 | 已定义 |
| 102 | 删除邀请 | DELETE | `/api/device-access/invitations/{id}` | 删已邀请用户（二次确认） | 已定义 |
| 103 | 更新邀请权限 | PUT | `/api/device-access/invitations/{id}/permissions` | 编辑权限（不可改手机号） | 已定义 |
| 104 | 获取可观看设备 | GET | `/api/device-access/devices` | 被邀请者可看的设备列表 | 已定义 |
| 105 | 获取设备权限 | GET | `/api/device-access/{deviceId}/permissions` | 当前用户对该设备的操作权限 | 已定义 |
| 106 | 开始观看会话 | POST | `/api/device-access/{deviceId}/viewing/start` | 记录观看开始 | 已定义 |
| 107 | 结束观看会话 | POST | `/api/device-access/{deviceId}/viewing/end` | 记录观看结束 | 已定义 |
| 108 | 获取观看历史 | GET | `/api/device-access/{deviceId}/viewing/history` | 观看记录（按天分组，每30天自动清空） | 已定义 |
| 109 | 清除观看历史 | DELETE | `/api/device-access/{deviceId}/viewing/history` | 手动清空（二次确认） | 已定义 |

---

## 16. 帮助中心（V1.9 §16）— user-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 110 | 帮助文章列表 | GET | `/api/help/articles` | 分类FAQ列表（5-10个） | 已定义 |
| 111 | 帮助文章详情 | GET | `/api/help/articles/{id}` | 单篇FAQ详情 | 已定义 |
| 112 | 相关文章 | GET | `/api/help/articles/{id}/related` | 关联推荐 | 已定义 |
| 113 | 搜索帮助 | GET | `/api/help/search` | 关键词搜索 | 已定义 |
| 114 | 热门文章 | GET | `/api/help/articles/popular` | 热门FAQ | 已定义 |
| 115 | 文章反馈 | POST | `/api/help/articles/{id}/feedback` | 有帮助/无帮助 | 已定义 |
| 116 | 创建工单 | POST | `/api/help/tickets` | 提交工单 | 已定义 |
| 117 | 获取工单列表 | GET | `/api/help/tickets` | 我的工单 | 已定义 |
| 118 | 获取工单详情 | GET | `/api/help/tickets/{id}` | 工单详情 | 已定义 |
| 119 | 更新工单 | PUT | `/api/help/tickets/{id}` | 补充信息 | 已定义 |
| 120 | 关闭工单 | POST | `/api/help/tickets/{id}/close` | 关闭工单 | 已定义 |
| 121 | 提交意见反馈 | POST | `/api/feedback` | 问题内容 + 图片(最多4张) + 联系方式(11位) | 已定义 |

---

## 17. 回看时光轴（V1.9 §17）— video-service + storage-service

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 122 | 云存事件录像 | GET | `/api/videos/recordings/{id}/events` | 6类事件：哭声/围栏/人形/入侵/翻身/睡觉 回放视频列表 | 已定义 |
| 123 | 全时云存录像 | GET | `/api/videos/recordings/{id}/recordings` | 全天连续录像列表 | 已定义 |
| 124 | 云存储详情 | GET | `/api/videos/recordings/{id}` | 云存开通状态/套餐信息 | 已定义 |
| 125 | 开通云存储 | POST | `/api/videos/recordings` | 开通设备云存 | 已定义 |
| 126 | 录像回放URL | GET | `/api/storage/recordings/{id}/playback` | 获取录像播放地址 | 已定义 |
| 127 | 录像时间轴 | GET | `/api/storage/recordings/device/{id}/timeline` | 24h时间轴+间隙检测+时长统计 | 已定义 |
| 128 | 按天分组录像 | GET | `/api/storage/recordings/device/{id}/by-day` | 日期筛选 | 已定义 |
| 129 | 录像列表 | GET | `/api/storage/recordings/device/{id}` | 全部录像 | 已定义 |
| 130 | 连续录制片段 | GET | `/api/storage/recordings/device/{id}/continuous` | 连续片段 | 已定义 |
| 131 | 录像间隙统计 | GET | `/api/storage/recordings/device/{id}/gaps` | 覆盖率分析 | 已定义 |
| 132 | 云存缩略图 | GET | `/api/videos/recordings/{id}/thumbnail` | 单个缩略图 | 已定义 |
| 133 | 批量缩略图 | POST | `/api/videos/recordings/{id}/thumbnails` | 时间轴批量缩略图 | 已定义 |
| 134 | 设备属性数据 | GET | `/api/videos/device/{id}/data` | 云平台设备温度/湿度数据 | 已定义 |

---

## 18. 特殊情况（V1.9 §18）

> 无独立 API，依赖：
> - #12 设备在线状态轮询
> - `connectivity_plus` 网络状态监听
> - 客户端 Socket/WebSocket 推送通道（设备事件实时通知）

---

## 19. 通用/基础设施

| # | 接口 | 方法 | 路径 | 用途 | 状态 |
|---|------|------|------|------|------|
| 135 | 文件上传 | POST | `/api/storage/upload` | 头像/宝宝照片/反馈图片/截图 | 已定义 |
| 136 | 获取文件URL | GET | `/api/storage/url/{key}` | 访问已上传文件 | 已定义 |
| 137 | 检查文件存在 | GET | `/api/storage/exists/{key}` | 文件存在性检查 | 已定义 |
| 138 | 删除文件 | DELETE | `/api/storage/{key}` | 删除文件 | 已定义 |
| 139 | 预签名上传URL | POST | `/api/storage/upload-url` | OSS直传 | 已定义 |
| 140 | 分片上传-创建 | POST | `/api/storage/multipart/create` | 大文件分片上传 | 已定义 |
| 141 | 分片上传-完成 | POST | `/api/storage/multipart/complete` | 完成分片合并 | 已定义 |
| 142 | KVS流媒体凭证 | GET | `/api/v1/credentials/stream` | AWS KVS凭证（IoT播放器用） | 已定义 |
| 143 | S3上传凭证 | GET | `/api/v1/credentials/storage` | AWS S3凭证（录像上传用） | 已定义 |
| 144 | 防盗链播放地址 | POST | `/api/videos/anti-leech-url` | 视频防盗链签名URL | 已定义 |
| 145 | 网关健康检查 | GET | `/health` | 服务可用性 | 已定义 |

---

## 汇总

| 维度 | 数量 |
|------|------|
| V1.9 强相关接口总数 | **145** |
| 已定义路径 (ApiPaths) | 145（全覆盖） |
| 已接入前端 (remote_ds + repo_impl 调用) | ~85 |
| 已定义但未接入前端 | ~60 |
| **后端阻塞接口** | 6 |

### 后端阻塞项（外部依赖）

| # | 阻塞项 | 影响模块 | 优先级 |
|---|--------|----------|--------|
| 1 | `Device.boundBabyId` / `boundBabyName` 字段 | 设备绑定 §9（4种情况无法完整实现） | P1 |
| 2 | 验证码错误码区分（错误 vs 过期） | 登录 §1.3（toast文案无法区分） | P1 |
| 3 | 服务有效期共享逻辑（主用户+被邀请者） | 服务期 §10.3 | P1 |
| 4 | 视频云存储事件接口（6类事件回放） | 回看时光轴 §17 | P0 |
| 5 | 哭声识别反馈接口 | 通知 §6.2 | P0 |
| 6 | 铃声列表 / 故障自检 / 解绑 / 邀请 完整接口 | 通知管理 / 设置 / 邀请 | P1 |

### 前端未接入的 V1.9 关键接口（优先补齐）

| 优先级 | 接口 | 说明 |
|--------|------|------|
| P0 | #122 云存事件录像 | 回看时光轴核心数据源 |
| P0 | #128 按天分组录像 | 回看日期筛选依赖 |
| P0 | #127 录像时间轴 | 24h时间轴渲染数据 |
| P0 | #134 设备属性数据 | 实时温湿度精确数据源 |
| P1 | #46-54 通知设置系列 | 通知管理页 7 个子模块配置 |
| P1 | #74-79 图表统计系列 | 4 类折线图数据 |
| P1 | #92-93 设备命令+健康报告 | 故障自检 + 环形灯亮度调节 |
| P1 | #97-109 邀请观看全系列 | 权限设置 + 观看记录 |
| P2 | #13 获取播放地址 | 视频防盗链播放 |
| P2 | #26-33 PTZ 系列 | 全屏方向控制精准化 |
