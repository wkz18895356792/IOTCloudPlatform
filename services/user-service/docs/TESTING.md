# User Service 测试文档

## 目录
- [概述](#概述)
- [测试结构](#测试结构)
- [运行测试](#运行测试)
- [测试覆盖](#测试覆盖)
- [测试数据管理](#测试数据管理)
- [编写新测试](#编写新测试)

---

## 概述

本文档描述了用户服务（User Service）的测试策略、测试覆盖率和测试编写指南。

### 测试框架
- **Jest** - 测试运行器和断言库
- **@midwayjs/mock** - Midway.js 应用测试工具

### 测试类型
1. **单元测试** - 测试单个服务和类的功能
2. **集成测试** - 测试控制器和 API 接口

---

## 测试结构

```
test/
├── bootstrap.ts              # 测试应用启动配置
├── config/
│   └── config.unittest.ts    # 测试环境配置
├── helpers/
│   └── test-data.ts          # 测试辅助函数
├── service/
│   ├── auth.service.test.ts      # 认证服务测试
│   ├── user.service.test.ts      # 用户服务测试
│   ├── sms.service.test.ts       # 短信/验证码服务测试
│   └── email.service.test.ts     # 邮件服务测试
└── controller/
    ├── auth.controller.test.ts   # 认证控制器测试
    ├── user.controller.test.ts   # 用户控制器测试
    └── feedback.controller.test.ts # 反馈控制器测试
```

---

## 运行测试

### 运行所有测试
```bash
npm test
```

### 运行特定测试文件
```bash
npm test auth.service.test.ts
```

### 运行测试并生成覆盖率报告
```bash
npm test -- --coverage
```

### 运行测试并监听文件变化
```bash
npm test -- --watch
```

### 运行特定的测试套件
```bash
npm test -- --testNamePattern="应该成功使用密码登录"
```

---

## 测试覆盖

### AuthService（认证服务）

| 功能 | 测试覆盖 | 状态 |
|-----|---------|------|
| 密码登录 | ✅ | 完整 |
| 短信验证码登录 | ✅ | 完整 |
| 邮箱验证码登录 | ✅ | 完整 |
| 第三方登录 | ✅ | 新增 |
| 用户注册 | ✅ | 完整 |
| Token 刷新 | ✅ | 完整 |
| 密码重置 | ✅ | 完整 |
| 用户登出 | ✅ | 完整 |
| 用户状态检查 | ✅ | 新增 |
| Token 验证 | ✅ | 新增 |
| 设备信息处理 | ✅ | 新增 |
| IP 地址处理 | ✅ | 新增 |
| 边界条件测试 | ✅ | 新增 |

**测试文件**: [test/service/auth.service.test.ts](test/service/auth.service.test.ts)

### UserService（用户服务）

| 功能 | 测试覆盖 | 状态 |
|-----|---------|------|
| 创建用户 | ✅ | 新增 |
| 获取用户完整信息 | ✅ | 新增 |
| 更新用户信息 | ✅ | 新增 |
| 更新密码 | ✅ | 新增 |
| 更新用户状态 | ✅ | 新增 |
| 邮箱/手机验证 | ✅ | 新增 |
| 更新最后登录信息 | ✅ | 新增 |
| 删除用户 | ✅ | 新增 |
| 检查用户是否存在 | ✅ | 新增 |
| 用户列表查询 | ✅ | 新增 |

**测试文件**: [test/service/user.service.test.ts](test/service/user.service.test.ts)

### SMSService（验证码服务）

| 功能 | 测试覆盖 | 状态 |
|-----|---------|------|
| 发送短信验证码 | ✅ | 完整 |
| 发送邮箱验证码 | ✅ | 完整 |
| 验证码验证 | ✅ | 完整 |
| 验证码生成 | ✅ | 完整 |
| 发送频率限制 | ✅ | 完整 |
| 验证码有效期 | ✅ | 增强 |
| 验证码类型测试 | ✅ | 新增 |
| 验证码格式验证 | ✅ | 新增 |
| 边界条件测试 | ✅ | 新增 |

**测试文件**: [test/service/sms.service.test.ts](test/service/sms.service.test.ts)

### EmailService（邮件服务）

| 功能 | 测试覆盖 | 状态 |
|-----|---------|------|
| 发送验证码邮件 | ✅ | 新增 |
| 发送欢迎邮件 | ✅ | 新增 |
| 发送密码重置邮件 | ✅ | 新增 |
| 发送账户通知邮件 | ✅ | 新增 |
| 邮箱地址验证 | ✅ | 新增 |

**测试文件**: [test/service/email.service.test.ts](test/service/email.service.test.ts)

### AuthController（认证控制器）

| API 端点 | 测试覆盖 | 状态 |
|---------|---------|------|
| POST /api/auth/login | ✅ | 完整 |
| POST /api/auth/register | ✅ | 完整 |
| POST /api/auth/refresh | ✅ | 完整 |
| POST /api/auth/send-code | ✅ | 完整 |
| POST /api/auth/send-reset-email | ✅ | 完整 |
| POST /api/auth/reset-password | ✅ | 完整 |
| POST /api/auth/logout | ✅ | 完整 |

**测试文件**: [test/controller/auth.controller.test.ts](test/controller/auth.controller.test.ts)

### UserController（用户控制器）

| API 端点 | 测试覆盖 | 状态 |
|---------|---------|------|
| GET /api/users/me | ✅ | 完整 |
| PUT /api/users/me/profile | ✅ | 完整 |
| PUT /api/users/me/password | ✅ | 完整 |
| POST /api/users/me/avatar | ✅ | 完整 |
| DELETE /api/users/me | ✅ | 完整 |
| GET /api/users/me/devices | ✅ | 完整 |
| POST /api/users/me/devices/:id | ✅ | 完整 |
| DELETE /api/users/me/devices/:id | ✅ | 完整 |
| GET /api/users/me/sessions | ✅ | 完整 |
| DELETE /api/users/me/sessions/:id | ✅ | 完整 |
| DELETE /api/users/me/sessions | ✅ | 完整 |

**测试文件**: [test/controller/user.controller.test.ts](test/controller/user.controller.test.ts)

### FeedbackController（反馈控制器）

| API 端点 | 测试覆盖 | 状态 |
|---------|---------|------|
| POST /api/feedback | ✅ | 完整 |

**测试文件**: [test/controller/feedback.controller.test.ts](test/controller/feedback.controller.test.ts)

---

## 测试数据管理

### 测试辅助函数

[helpers/test-data.ts](helpers/test-data.ts) 提供了以下辅助函数：

#### 创建测试数据
```typescript
import {
  createTestUser,
  createDisabledTestUser,
  createBannedTestUser,
  createLockedTestUser,
  createPendingTestUser,
  createTestSession,
  createThirdPartyBinding,
} from './helpers/test-data';

// 创建普通测试用户
const user = await createTestUser(dataSource, {
  username: 'testuser',
  email: 'test@example.com',
  password: 'Test123456',
});

// 创建被禁用的用户
const disabledUser = await createDisabledTestUser(dataSource);

// 创建测试会话
const session = await createTestSession(dataSource, userId, {
  deviceType: 'web',
  ip: '127.0.0.1',
});
```

#### 清理测试数据
```typescript
import { cleanupTestData, cleanupTestUser } from './helpers/test-data';

// 清理所有测试数据
await cleanupTestData(dataSource);

// 清理特定用户数据
await cleanupTestUser(dataSource, userId);
```

#### 工具函数
```typescript
import { randomPhone, randomEmail, randomUsername, delay } from './helpers/test-data';

// 生成随机数据
const phone = randomPhone();      // 1xxxxxxxxx
const email = randomEmail();      // test_timestamp_random@example.com
const username = randomUsername(); // test_user_timestamp_random

// 延迟执行
await delay(1000); // 等待 1 秒
```

---

## 编写新测试

### 单元测试模板

```typescript
/**
 * ServiceName 单元测试
 * 测试服务功能描述
 */

import { createApp, close } from '@midwayjs/mock';
import { ServiceName } from '../../src/service/service-name';

describe('ServiceName', () => {
  let app: any;
  let serviceName: ServiceName;

  beforeAll(async () => {
    app = await createApp();
    serviceName = await app.getApplicationContext().getAsync(ServiceName);
  });

  afterAll(async () => {
    await close(app);
  });

  describe('methodName - 方法描述', () => {
    it('应该成功执行操作', async () => {
      const result = await serviceName.methodName({
        param1: 'value1',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('参数错误应该返回错误', async () => {
      const result = await serviceName.methodName({
        param1: 'invalid',
      });

      expect(result.success).toBe(false);
    });
  });
});
```

### 集成测试模板

```typescript
/**
 * ControllerName 测试
 * 测试控制器 API 接口
 */

import { createApp, close, createHttpRequest } from '@midwayjs/mock';
import { ErrorCode } from '@baby-monitor/shared-types';

describe('ControllerName', () => {
  let app: any;
  let accessToken: string;

  beforeAll(async () => {
    app = await createApp();

    // 登录获取 token
    const loginResponse = await createHttpRequest(app)
      .post('/api/auth/login')
      .send({
        type: 'password',
        account: 'test@example.com',
        password: 'Test123456',
      });

    if (loginResponse.body.code === ErrorCode.SUCCESS) {
      accessToken = loginResponse.body.data.accessToken;
    }
  });

  afterAll(async () => {
    await close(app);
  });

  describe('POST /api/endpoint - 接口描述', () => {
    it('应该成功处理请求', async () => {
      const response = await createHttpRequest(app)
        .post('/api/endpoint')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          param1: 'value1',
        });

      expect(response.status).toBe(200);
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
    });

    it('未登录用户应该返回未授权错误', async () => {
      const response = await createHttpRequest(app)
        .post('/api/endpoint')
        .send({
          param1: 'value1',
        });

      expect(response.status).toBe(401);
    });
  });
});
```

### 测试最佳实践

1. **测试命名**
   - 使用描述性的测试名称：`应该成功执行操作`
   - 使用 `应该...` 的格式描述期望行为

2. **测试隔离**
   - 每个测试应该独立运行
   - 使用 `beforeEach`/`afterEach` 清理数据
   - 使用随机数据避免测试间相互影响

3. **异步测试**
   - 正确使用 `async/await`
   - 等待异步操作完成后再断言

4. **断言清晰**
   - 使用明确的断言消息
   - 测试失败时提供有用的错误信息

5. **边界条件**
   - 测试正常情况
   - 测试边界条件
   - 测试异常情况

6. **Mock 外部依赖**
   - Mock 数据库操作（使用测试数据库）
   - Mock 第三方服务（短信、邮件等）
   - Mock 时间相关操作

---

## 测试环境配置

测试环境配置文件：[config/config.unittest.ts](config/config.unittest.ts)

```typescript
export default {
  jest: true,
  redis: {
    client: {
      port: 6379,
      host: '127.0.0.1',
      password: '',
      db: 1, // 使用独立的数据库
    },
  },
  mysql: {
    dataSource: {
      default: {
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'your-password',
        database: 'babymonitor',
        synchronize: false, // 自动同步表结构
        logging: false,    // 关闭 SQL 日志
      },
    },
  },
} as MidwayConfig;
```

### 环境变量

创建 `.env.test` 文件用于测试环境变量：

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your-password
MYSQL_DATABASE=babymonitor

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

JWT_SECRET=test-secret-key
```

---

## 持续集成

### GitHub Actions 示例

```yaml
name: Test User Service

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: test
          MYSQL_DATABASE: babymonitor
        ports:
          - 3306:3306

      redis:
        image: redis:7
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - run: npm ci
      - run: npm test -- --coverage
```

---

## 常见问题

### Q: 测试失败如何调试？
A:
1. 使用 `console.log` 输出调试信息
2. 使用 `--verbose` 参数运行测试
3. 使用 `--watch` 模式只运行相关测试

### Q: 如何 Mock 外部服务？
A: 使用 Jest 的 mock 功能：
```typescript
jest.mock('../../src/service/sms.service', () => ({
  SMSService: jest.fn().mockImplementation(() => ({
    sendCode: jest.fn().mockResolvedValue({ success: true }),
  })),
}));
```

### Q: 测试数据库如何清理？
A: 在 `afterAll` 或 `afterEach` 中调用清理函数：
```typescript
afterAll(async () => {
  await cleanupTestData(dataSource);
  await close(app);
});
```

---

*最后更新时间: 2025-02-08*
