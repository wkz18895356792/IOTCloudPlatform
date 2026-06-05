# AWS STS 临时凭证管理

## 概述

本项目使用 AWS STS (Security Token Service) 来生成临时凭证，供设备和应用程序安全地访问 AWS 资源（KVS 推流、S3 文件上传），无需暴露长期凭证。

## 架构

```
┌─────────────────┐     STS AssumeRole     ┌─────────────┐
│  Device Stream  │ ──────────────────────> │  AWS STS    │
└────────┬────────┘                        └──────┬──────┘
         │                                        │
         │ <───── Temporary Credentials ──────────┘
         │
         v
┌──────────────────────────────────────────────────────┐
│                   API Gateway                         │
│  GET /api/v1/credentials/stream  (KVS推流凭证)         │
│  GET /api/v1/credentials/storage (S3上传凭证)         │
└──────────────────────┬───────────────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────────────┐
│              Redis (凭证缓存层)                        │
│  Key: sts:credentials:kvs      TTL: 刷新间隔 * 0.8     │
│  Key: sts:credentials:s3       TTL: 刷新间隔 * 0.8     │
└──────────────────────┬───────────────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────────────┐
│           AWSCredentialsManager (凭证管理器)          │
│  - 定时刷新凭证                                       │
│  - 双缓冲机制确保平滑切换                              │
│  - 按需提供凭证                                        │
└──────────────────────────────────────────────────────┘
```

## 环境变量配置

在 `.env` 文件中配置以下变量：

```bash
# AWS 基础配置
AWS_REGION=cn-north-1
AWS_ACCESS_KEY_ID=your_long_term_access_key
AWS_SECRET_ACCESS_KEY=your_long_term_secret_key
AWS_ACCOUNT_ID=123456789012

# KVS 配置
AWS_KVS_ROLE_ARN=arn:aws:iam::123456789012:role/KVSStreamRole
AWS_KVS_ENDPOINT=https://kinesisvideo.cn-north-1.amazonaws.com.cn

# S3 配置
AWS_S3_ROLE_ARN=arn:aws:iam::123456789012:role/S3UploadRole
AWS_S3_BUCKET=baby-monitor-files
```

## IAM Role 配置

### KVS Stream Role 示例

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:root"
      },
      "Action": "sts:AssumeRole",
      "Condition": {}
    }
  ]
}
```

权限策略：
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kinesisvideo:DescribeStream",
        "kinesisvideo:GetDataEndpoint",
        "kinesisvideo:PutMedia",
        "kinesisvideo:GetHLSStreamingSessionURL"
      ],
      "Resource": "arn:aws:kinesisvideo:cn-north-1:123456789012:stream/device-*"
    }
  ]
}
```

### S3 Upload Role 示例

信任策略：
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:root"
      },
      "Action": "sts:AssumeRole",
      "Condition": {}
    }
  ]
}
```

权限策略：
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::baby-monitor-files/devices/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::baby-monitor-files",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["devices/*"]
        }
      }
    }
  ]
}
```

## API 接口

### 1. 获取流媒体推流凭证 (KVS)

```
GET /api/v1/credentials/stream
```

响应：
```json
{
  "accessKeyId": "ASIA...",
  "secretAccessKey": "...",
  "sessionToken": "...",
  "expiration": "2026-02-25T12:00:00Z",
  "region": "cn-north-1",
  "endpoint": "https://kinesisvideo.cn-north-1.amazonaws.com.cn",
  "expiresIn": 3600
}
```

### 2. 获取存储上传凭证 (S3)

```
GET /api/v1/credentials/storage
```

响应：
```json
{
  "accessKeyId": "ASIA...",
  "secretAccessKey": "...",
  "sessionToken": "...",
  "expiration": "2026-02-25T12:00:00Z",
  "region": "cn-north-1",
  "bucket": "baby-monitor-files",
  "endpoint": "https://baby-monitor-files.s3.cn-north-1.amazonaws.com.cn",
  "uploadPrefix": "devices/device-123/2026-02-25",
  "expiresIn": 3600
}
```

### 3. 获取凭证状态（管理接口）

```
GET /api/v1/credentials/status
```

### 4. 手动刷新凭证（管理接口）

```
POST /api/v1/credentials/refresh?key=kvs
```

## 设备端使用示例

### 推流到 KVS

```javascript
// 1. 获取临时凭证
const response = await fetch('/api/v1/credentials/stream');
const credentials = await response.json();

// 2. 使用凭证初始化 AWS SDK
const AWS = require('aws-sdk');
const kvsVideo = new AWS.KinesisVideo({
  region: credentials.region,
  endpoint: credentials.endpoint,
  accessKeyId: credentials.accessKeyId,
  secretAccessKey: credentials.secretAccessKey,
  sessionToken: credentials.sessionToken,
});

// 3. 开始推流...
```

### 上传文件到 S3

```javascript
// 1. 获取临时凭证
const response = await fetch('/api/v1/credentials/storage');
const credentials = await response.json();

// 2. 使用凭证上传
const s3 = new AWS.S3({
  region: credentials.region,
  accessKeyId: credentials.accessKeyId,
  secretAccessKey: credentials.secretAccessKey,
  sessionToken: credentials.sessionToken,
});

await s3.putObject({
  Bucket: credentials.bucket,
  Key: `${credentials.uploadPrefix}/video.mp4`,
  Body: fileData,
}).promise();
```

## 凭证刷新策略

| 配置项 | 值 | 说明 |
|--------|-----|------|
| durationSeconds | 3600 | 凭证有效期 1 小时 |
| refreshInterval | 2100 | 35 分钟后自动刷新 |
| cacheTTL | 1680 | Redis 缓存 28 分钟（刷新间隔的 80%） |
| minTTLThreshold | 300 | TTL < 5 分钟时触发提前刷新 |

## 监控与告警

建议监控以下指标：

1. **凭证刷新成功率** - 应该 > 99%
2. **凭证 TTL** - 应该始终 > 300 秒
3. **STS API 调用频率** - 每小时应 <= 2 次（正常缓存下）

## 故障处理

### 凭证获取失败

1. 检查环境变量是否正确配置
2. 检查 IAM Role 是否存在且有正确权限
3. 检查 AWS 访问密钥是否有 `sts:AssumeRole` 权限

### 凭证过期

设备端应该：
1. 在凭证过期前 5 分钟主动刷新
2. 如果收到 403/401 错误，立即刷新凭证
