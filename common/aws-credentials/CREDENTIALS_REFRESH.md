# AWS 临时凭证刷新机制详解

## 概述

`AWSCredentialsManager` 是一个 AWS STS 临时凭证管理器，用于集中管理多个 AWS 服务的临时凭证。它通过 Redis 缓存凭证、自动刷新、双缓冲机制等特性，确保凭证持续有效且服务无中断。

---

## 一、核心刷新机制

### 1.1 双缓冲机制

```
┌─────────────────────────────────────────────────────────────────┐
│                      凭证获取流程                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  getCredentials(key) 被调用                                     │
│           │                                                      │
│           ▼                                                      │
│  检查 Redis 缓存                                                │
│           │                                                      │
│     ┌─────┴─────┐                                              │
│     │           │                                              │
│  缓存命中   缓存未命中                                         │
│     │           │                                              │
│     ▼           ▼                                              │
│  检查 TTL    同步刷新                                          │
│     │           │                                              │
│     ├─ TTL > 300秒 ───> 直接返回缓存凭证                        │
│     │                                                          │
│     ├─ TTL ≤ 300秒 ───> 异步刷新 + 返回旧凭证                  │
│     │                     (双缓冲)                               │
│     │                     │                                      │
│     │                     ├─ 后台启动刷新                        │
│     │                     ├─ 立即返回当前有效凭证                 │
│     │                     └─ 下次请求时使用新凭证                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 关键代码逻辑

```typescript
async getCredentials(key: string): Promise<AWSTemporaryCredentials> {
  const config = this.configs.get(key);
  const cacheKey = this.getCacheKey(key);

  // 尝试从 Redis 获取缓存
  const cached = await this.redis.get(cacheKey);
  
  if (cached) {
    const parsed = JSON.parse(cached);
    const ttl = await this.redis.ttl(cacheKey);
    
    if (ttl > this.MIN_TTL_THRESHOLD) {
      // 凭证仍然"新鲜"，直接返回
      return parsed;
    }
    
    // 即将过期：异步刷新，但立即返回当前有效凭证（双缓冲）
    this.refreshCredentials(key).catch(err => {
      console.error(`Background refresh failed for ${key}:`, err);
    });
    return parsed;
  }

  // 缓存未命中或已过期，同步刷新
  return await this.refreshCredentials(key);
}
```

---

## 二、关键时间阈值

### 2.1 阈值定义

```typescript
// 最小 TTL 阈值（秒）
MIN_TTL_THRESHOLD = 300  // 5分钟

// 默认凭证有效期（秒）
DEFAULT_DURATION = 3600  // 1小时

// 默认刷新间隔（秒）
refreshInterval = durationSeconds * 0.7  // 2520秒（42分钟）
```

### 2.2 TTL 与刷新行为

| TTL 值 | 行为 | 用户体验 | 说明 |
|--------|------|----------|------|
| TTL > 300秒 | 直接返回缓存凭证 | 无延迟 | 凭证仍然"新鲜" |
| 0 < TTL ≤ 300秒 | 异步刷新 + 返回旧凭证 | 无延迟 | 凭证即将过期，但仍有效 |
| TTL = -1 (不存在) | 同步刷新 | 有延迟（~100-200ms） | 缓存已过期 |

---

## 三、缓存 TTL 策略

### 3.1 时间线图

```
0分                    28分              42分              60分
│                      │                 │                 │
├──────────────────────┴─────────────────┴─────────────────┤
│                      │                 │                 │
│  凭证有效期开始     │                 │                 │
│                      │                 │                 │
│  ←────── Redis 缓存 TTL ────→        │                 │
│      (33.6分钟，2016秒)              │                 │
│                                        │                 │
│                      ←─── 提前刷新窗口 ──→│                 │
│                          (最后5分钟)    │                 │
│                                           │                 │
│  ←─────────── 凭证有效期（60分钟）──────────→│
│                                           │                 │
│                                           ←─ TTL ≤ 300秒 ─→│
│                                           触发异步刷新      │
│                                                             │
│                                                        凭证过期
```

### 3.2 TTL 计算公式

```typescript
// AWS STS 凭证有效期（由 AWS 返回）
durationSeconds = 3600  // 60分钟

// 服务端配置的刷新间隔
refreshInterval = 2100  // 35分钟（可配置）

// Redis 缓存 TTL（自动计算）
cacheTTL = Math.floor(refreshInterval * 0.8)
        = Math.floor(2100 * 0.8)
        = 1680 秒
        ≈ 28 分钟
```

---

## 四、刷新触发时机

### 4.1 三种刷新场景

#### 场景 1：缓存命中，TTL > 300秒

```typescript
// 正常情况，凭证仍然"新鲜"
const cached = await redis.get('sts:credentials:kvs');
const ttl = await redis.ttl('sts:credentials:kvs');  // 例如：1800秒

if (ttl > 300) {
  return cachedCredentials;  // 直接返回，无任何操作
}
```

#### 场景 2：缓存命中，0 < TTL ≤ 300秒

```typescript
// 凭证即将过期，触发双缓冲机制
const ttl = await redis.ttl('sts:credentials:kvs');  // 例如：120秒

if (ttl <= 300 && ttl > 0) {
  // 启动后台异步刷新（不阻塞当前请求）
  refreshCredentials('kvs').catch(err => {
    console.error('Background refresh failed:', err);
  });
  
  // 立即返回当前仍然有效的凭证
  return cachedCredentials;  // 用户体验：无延迟
}
```

#### 场景 3：缓存未命中或已过期

```typescript
// 缓存不存在或 TTL = -1
const cached = await redis.get('sts:credentials:kvs');  // null

if (!cached) {
  // 同步等待刷新完成
  return await refreshCredentials('kvs');  // 用户体验：有延迟
}
```

### 4.2 刷新决策树

```
┌─────────────────────────────────────────────┐
│         缓存是否存在？                      │
└────────────────┬────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
       是                 否
        │                 │
        ▼                 ▼
┌───────────────┐   同步刷新
│ TTL > 300秒？  │
└───────┬───────┘
        │
   ┌────┴────┐
   │         │
  是         否
   │         │
   ▼         ▼
直接返回  ┌───────────────┐
         │ 异步刷新 +     │
         │ 返回旧凭证     │
         └───────────────┘
```

---

## 五、完整刷新流程

### 5.1 同步刷新流程

```typescript
async refreshCredentials(key: string): Promise<AWSTemporaryCredentials> {
  const config = this.configs.get(key);
  
  // 步骤 1: 构建 STS AssumeRole 请求
  const params = {
    RoleArn: config.roleArn,
    RoleSessionName: config.roleSessionName,
    DurationSeconds: config.durationSeconds,  // 通常为 3600 秒
  };
  
  // 步骤 2: 调用 AWS STS API
  const command = new AssumeRoleCommand(params);
  const response = await this.stsClient.send(command);
  
  // 步骤 3: 提取临时凭证
  const credentials = {
    accessKeyId: response.Credentials.AccessKeyId!,
    secretAccessKey: response.Credentials.SecretAccessKey!,
    sessionToken: response.Credentials.SessionToken!,
    expiration: response.Credentials.Expiration!,
  };
  
  // 步骤 4: 缓存到 Redis
  const cacheTTL = Math.floor(config.refreshInterval * 0.8);
  await this.redis.setex(cacheKey, cacheTTL, JSON.stringify(credentials));
  
  // 步骤 5: 触发回调通知
  this.notifyRefresh({
    key,
    success: true,
    expiration: credentials.expiration,
    timestamp: new Date(),
  });
  
  return credentials;
}
```

### 5.2 错误处理

```typescript
try {
  // 尝试刷新凭证
  const credentials = await this.refreshCredentials(key);
  return credentials;
} catch (error) {
  // 触发失败回调
  this.notifyRefresh({
    key,
    success: false,
    error: error.message,
    timestamp: new Date(),
  });
  
  throw error;  // 重新抛出异常
}
```

---

## 六、配置参数

### 6.1 CredentialsConfig 接口

```typescript
interface CredentialsConfig {
  // IAM Role ARN（必需）
  roleArn: string;
  
  // 会话名称，用于 CloudTrail 审计（必需）
  roleSessionName: string;
  
  // 临时凭证有效期（秒），默认 3600（1小时）
  durationSeconds?: number;
  
  // 刷新间隔（秒），默认 durationSeconds * 0.7
  refreshInterval?: number;
  
  // AWS 区域（可选）
  region?: string;
  
  // 外部 ID（可选，跨账户访问时使用）
  externalId?: string;
  
  // 内联策略（可选，进一步缩小权限）
  policy?: string;
}
```

### 6.2 配置示例

```typescript
// KVS 凭证配置
export const kvsCredentialsConfig: CredentialsConfig = {
  roleArn: 'arn:aws-cn:iam::558633873267:role/BabyMonitorForKVS',
  roleSessionName: 'baby-monitor-kvs-stream',
  durationSeconds: 3600,     // AWS 凭证 1 小时有效期
  refreshInterval: 2100,     // 35 分钟刷新一次
  region: 'cn-north-1',
};

// S3 凭证配置
export const s3CredentialsConfig: CredentialsConfig = {
  roleArn: 'arn:aws-cn:iam::558633873267:role/BabyMonitorForS3',
  roleSessionName: 'baby-monitor-s3-upload',
  durationSeconds: 3600,
  refreshInterval: 2100,
  region: 'cn-north-1',
};
```

---

## 七、监控与调试

### 7.1 凭证状态查询

```typescript
// 获取单个凭证状态
const status = await credentialsManager.getCredentialsStatus('kvs');
// 返回：
// {
//   key: 'kvs',
//   cached: true,           // 是否已缓存
//   ttl: 1520,              // 剩余 TTL（秒）
//   expiring: false         // 是否即将过期（ttl < 300）
// }

// 检查是否需要刷新
const needsRefresh = await credentialsManager.needsRefresh('kvs');
// 返回：true 或 false

// 获取所有凭证状态
const allStatus = await credentialsManager.getAllCredentialsStatus();
// 返回：Array<CredentialsStatus>
```

### 7.2 事件回调

```typescript
// 注册刷新事件监听
credentialsManager.onRefresh((event: CredentialsRefreshEvent) => {
  if (event.success) {
    console.log(`[Refresh Success] ${event.key} expires at ${event.expiration}`);
  } else {
    console.error(`[Refresh Failed] ${event.key}: ${event.error}`);
    // 可以在这里实现：
    // - 发送告警通知
    // - 记录监控指标
    // - 触发降级逻辑
  }
});
```

### 7.3 健康检查

```typescript
// 健康检查接口
const isHealthy = await credentialsManager.healthCheck();
// 检查项：
// 1. Redis 连接是否正常
// 2. 是否有凭证配置
// 3. 至少一个凭证是否已缓存
```

---

## 八、最佳实践

### 8.1 服务端

```typescript
// 在服务启动时预热凭证
async onReady(container: IMidwayContainer) {
  const credentialsManager = await container.getAsync(AWSCredentialsManager);
  
  // 注册凭证配置
  credentialsManager.registerAllCredentials({
    kvs: kvsCredentialsConfig,
    s3: s3CredentialsConfig,
  });
  
  // 预热凭证（可选，推荐）
  await credentialsManager.warmupCredentials();
  console.log('[Configuration] AWS credentials warmed up');
}

// 监听刷新事件
credentialsManager.onRefresh((event) => {
  if (!event.success) {
    // 刷新失败告警
    alertManager.send({
      level: 'warning',
      message: `AWS credentials refresh failed for ${event.key}`,
      error: event.error,
    });
  }
});
```

### 8.2 设备端

```typescript
class DeviceCredentialsManager {
  private credentials: Map<string, STSCredentials> = new Map();
  
  async ensureCredentials(service: string): Promise<STSCredentials> {
    const creds = this.credentials.get(service);
    
    // 检查是否需要刷新
    const refreshBefore = creds?.expiration.getTime() - 5 * 60 * 1000;
    
    if (!creds || Date.now() > refreshBefore) {
      // 提前 5 分钟刷新
      this.credentials.set(service, await this.requestNewCredentials(service));
    }
    
    return this.credentials.get(service);
  }
  
  private async requestNewCredentials(service: string): Promise<STSCredentials> {
    const response = await mqttClient.request('device.credentials_request', {
      deviceId: this.deviceId,
      credentialTypes: [service],
      requestId: generateId()
    });
    
    return response.credentials[service];
  }
}
```

### 8.3 IAM Role 配置建议

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws-cn:iam::558633873267:user/amoonAI"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "baby-monitor-production"
        },
        "IpAddress": {
          "aws:SourceIp": [
            "设备IP地址/32"
          ]
        }
      }
    }
  ]
}
```

**安全建议：**
- ✅ 使用 `ExternalId` 防止混淆代理人问题
- ✅ 限制源 IP 地址（如果设备 IP 固定）
- ✅ 设置最长会话持续时间限制
- ✅ 启用 CloudTrail 审计日志

---

## 九、故障处理

### 9.1 刷新失败处理

```typescript
// 服务端降级策略
try {
  const credentials = await this.awsCredentialsManager.getCredentials('s3');
} catch (error) {
  this.logger.error('[Device Service] Failed to get S3 credentials:', error);
  
  // 降级方案：使用长期凭证（仅开发/测试环境）
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    sessionToken: '',
    expiration: Date.now() + 3600 * 1000,
    bucket: process.env.AWS_S3_RECORD_BUCKET,
    prefix: process.env.AWS_S3_RECORD_FOLDER,
  };
}
```

### 9.2 设备端凭证过期处理

```typescript
try {
  await uploadToS3(data);
} catch (error) {
  if (error.code === 'ExpiredToken') {
    // 凭证过期，主动刷新
    await this.credentialsManager.refresh('s3');
    // 重试上传
    await uploadToS3(data);
  } else {
    throw error;
  }
}
```

---

## 十、常见问题

### Q1: 为什么 Redis 缓存 TTL 不是 3600 秒（1小时）？

**A:** 为了确保在缓存失效时，凭证仍然有效。Redis 缓存 TTL 设置为 `refreshInterval * 0.8`，确保在下次刷新前缓存仍然有效。

### Q2: 如果刷新失败怎么办？

**A:** 
1. 后台异步刷新失败不会影响当前请求（旧凭证仍然有效）
2. 同步刷新失败会抛出异常，需要业务层处理
3. 可以通过 `onRefresh` 回调监听失败事件并告警

### Q3: MIN_TTL_THRESHOLD 为什么是 300 秒？

**A:** 5分钟的缓冲窗口可以：
- 容忍网络延迟
- 容忍 STS API 暂时不可用
- 给予重试时间
- 确保在凭证真正过期前完成刷新

### Q4: 是否可以调整刷新间隔？

**A:** 可以。在 `CredentialsConfig` 中配置 `refreshInterval` 参数：
- 减小间隔：更频繁刷新，更安全，但更多 STS API 调用
- 增大间隔：减少 API 调用，但缓冲时间变短

---

## 十一、性能指标

### 11.1 预期性能

| 操作 | 预期延迟 | 说明 |
|------|----------|------|
| 缓存命中（TTL > 300s） | < 1ms | 仅 Redis GET |
| 缓存命中（TTL ≤ 300s） | < 1ms | 异步刷新不阻塞 |
| 缓存未命中 | 100-300ms | 同步调用 STS API |
| STS AssumeRole API | 100-250ms | 取决于网络和 AWS 区域 |

### 11.2 资源消耗

| 资源 | 消耗量 | 说明 |
|------|--------|------|
| Redis 内存 | ~1KB/凭证 | 仅缓存凭证元数据 |
| STS API 调用 | ~2-3次/小时/凭证 | 取决于刷新间隔 |
| 网络带宽 | < 1KB/次 | 仅传输凭证数据 |

---

## 十二、架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    AWS Credentials Manager                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    getCredentials(key)                      │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                        │
│            ┌────────────┴────────────┐                        │
│            │                         │                        │
│            ▼                         ▼                        │
│     ┌──────────┐            ┌──────────────┐                │
│     │ Redis    │            │ STS Client   │                │
│     │ Cache     │            │             │                │
│     └─────┬────┘            └──────┬───────┘                │
│           │                        │                         │
│           │                        │                         │
│      缓存命中                   调用 AWS STS                   │
│      (TTL检查)                  AssumeRole                   │
│           │                        │                         │
│           └────────────┬───────────┘                         │
│                        │                                     │
│                        ▼                                     │
│              ┌─────────────────────┐                        │
│              │  临时凭证返回      │                        │
│              │  accessKeyId        │                        │
│              │  secretAccessKey    │                        │
│              │  sessionToken       │                        │
│              │  expiration        │                        │
│              └─────────────────────┘                        │
│                                                                  │
│  回调通知：onRefresh(event: { success, expiration, error })    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 版本信息

- **文档版本**: v1.0.0
- **最后更新**: 2026-04-13
- **适用版本**: @baby-monitor/aws-credentials v1.0.0+

---

## 相关文档

- [AWS STS AssumeRole 文档](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [README.md](./README.md) - 项目概览
