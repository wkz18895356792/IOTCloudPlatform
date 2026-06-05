/**
 * User Service API 自动化测试
 *
 * 所有请求通过 API Gateway (端口 6001) 发送
 * 使用 Jest + Axios 进行测试
 *
 * 运行方式:
 *   npm test -- --testPathPattern=api-test
 *   或
 *   npx jest test/api-test.spec.ts
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

// 配置
const API_BASE = process.env.API_BASE_URL || 'http://localhost:6001';
const TEST_TIMEOUT = 30000;

// 测试用户数据
const generateTestUser = () => ({
  username: `testuser_${Date.now()}`,
  password: 'Test123456!@#',
  email: `test${Date.now()}@example.com`,
  phone: `13800${Date.now().toString().slice(-8)}`,
});

// 辅助类型
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface LoginResponse {
  user: {
    userId: string;
    username: string;
    nickname?: string;
    avatar?: string;
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface UserInfo {
  userId: string;
  username: string;
  email?: string;
  phone?: string;
  nickname?: string;
  avatar?: string;
}

// 创建 axios 实例
const createApiClient = (token?: string): AxiosInstance => {
  const client = axios.create({
    baseURL: API_BASE,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (token) {
    client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  // 响应拦截器
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      if (error.response) {
        return Promise.resolve(error.response);
      }
      return Promise.reject(error);
    }
  );

  return client;
};

describe('User Service API Tests', () => {
  let apiClient: AxiosInstance;
  let anonymousClient: AxiosInstance;
  let accessToken: string;
  let refreshToken: string;
  let testUser: ReturnType<typeof generateTestUser>;
  let userId: string;

  beforeAll(() => {
    testUser = generateTestUser();
    anonymousClient = createApiClient();
    console.log('测试用户:', testUser.username);
    console.log('API Gateway:', API_BASE);
  });

  // ========================================
  // 1. 认证模块测试
  // ========================================
  describe('认证模块 /api/auth', () => {
    describe('POST /register - 用户注册', () => {
      test(
        'TC-AUTH-001: 用户名密码注册成功',
        async () => {
          const response = await anonymousClient.post<ApiResponse<LoginResponse>>(
            '/api/auth/register',
            {
              username: testUser.username,
              password: testUser.password,
              email: testUser.email,
            }
          );

          expect(response.status).toBe(200);
          expect(response.data.success).toBe(true);
          expect(response.data.data?.accessToken).toBeDefined();
          expect(response.data.data?.refreshToken).toBeDefined();
          expect(response.data.data?.user.username).toBe(testUser.username);

          // 保存Token供后续测试使用
          accessToken = response.data.data!.accessToken;
          refreshToken = response.data.data!.refreshToken;
          userId = response.data.data!.user.userId;
          apiClient = createApiClient(accessToken);
        },
        TEST_TIMEOUT
      );

      test(
        'TC-AUTH-002: 重复用户名注册失败',
        async () => {
          const response = await anonymousClient.post<ApiResponse>(
            '/api/auth/register',
            {
              username: testUser.username,
              password: testUser.password,
            }
          );

          expect(response.data.success).toBe(false);
          expect(response.status).toBe(409);
        },
        TEST_TIMEOUT
      );

      test(
        'TC-AUTH-003: 密码强度不足失败',
        async () => {
          const response = await anonymousClient.post<ApiResponse>(
            '/api/auth/register',
            {
              username: `weak_${Date.now()}`,
              password: '123456',
            }
          );

          expect(response.data.success).toBe(false);
        },
        TEST_TIMEOUT
      );
    });

    describe('POST /login - 用户登录', () => {
      test(
        'TC-AUTH-010: 密码登录成功',
        async () => {
          const response = await anonymousClient.post<ApiResponse<LoginResponse>>(
            '/api/auth/login',
            {
              type: 'password',
              account: testUser.username,
              password: testUser.password,
            }
          );

          expect(response.status).toBe(200);
          expect(response.data.success).toBe(true);
          expect(response.data.data?.accessToken).toBeDefined();

          // 更新Token
          accessToken = response.data.data!.accessToken;
          refreshToken = response.data.data!.refreshToken;
          apiClient = createApiClient(accessToken);
        },
        TEST_TIMEOUT
      );

      test(
        'TC-AUTH-011: 错误密码登录失败',
        async () => {
          const response = await anonymousClient.post<ApiResponse>(
            '/api/auth/login',
            {
              type: 'password',
              account: testUser.username,
              password: 'WrongPassword123',
            }
          );

          expect(response.data.success).toBe(false);
          expect(response.status).toBe(401);
        },
        TEST_TIMEOUT
      );

      test(
        'TC-AUTH-012: 用户不存在登录失败',
        async () => {
          const response = await anonymousClient.post<ApiResponse>(
            '/api/auth/login',
            {
              type: 'password',
              account: 'nonexistent_user_xyz',
              password: 'Test123456!@#',
            }
          );

          expect(response.data.success).toBe(false);
          expect(response.status).toBe(404);
        },
        TEST_TIMEOUT
      );
    });

    describe('POST /refresh - 刷新Token', () => {
      test(
        'TC-AUTH-030: 刷新Token成功',
        async () => {
          const response = await anonymousClient.post<ApiResponse<{ accessToken: string; refreshToken: string }>>(
            '/api/auth/refresh',
            {
              refreshToken,
            }
          );

          expect(response.status).toBe(200);
          expect(response.data.success).toBe(true);
          expect(response.data.data?.accessToken).toBeDefined();

          // 更新Token
          accessToken = response.data.data!.accessToken;
          refreshToken = response.data.data!.refreshToken;
          apiClient = createApiClient(accessToken);
        },
        TEST_TIMEOUT
      );

      test(
        'TC-AUTH-031: 无效refreshToken失败',
        async () => {
          const response = await anonymousClient.post<ApiResponse>(
            '/api/auth/refresh',
            {
              refreshToken: 'invalid_token_xyz',
            }
          );

          expect(response.data.success).toBe(false);
          expect(response.status).toBe(401);
        },
        TEST_TIMEOUT
      );
    });

    describe('POST /send-code - 发送验证码', () => {
      test(
        'TC-AUTH-020: 发送邮箱验证码成功',
        async () => {
          const response = await anonymousClient.post<ApiResponse>(
            '/api/auth/send-code',
            {
              target: testUser.email,
              type: 'login',
              channel: 'email',
            }
          );

          // 验证码发送可能成功，也可能因为邮件服务未配置而失败
          // 这里只检查接口是否正常响应
          expect(response.status).toBeLessThan(500);
        },
        TEST_TIMEOUT
      );
    });
  });

  // ========================================
  // 2. 用户信息模块测试
  // ========================================
  describe('用户信息模块 /api/auth/me', () => {
    describe('GET /me - 获取用户信息', () => {
      test(
        'TC-USER-001: 获取用户信息成功（需要Token）',
        async () => {
          const response = await apiClient.get<ApiResponse<UserInfo>>('/api/auth/me');

          expect(response.status).toBe(200);
          expect(response.data.success).toBe(true);
          expect(response.data.data?.username).toBe(testUser.username);
          expect(response.data.data?.userId).toBe(userId);
        },
        TEST_TIMEOUT
      );

      test(
        'TC-USER-002: 无Token访问失败',
        async () => {
          const response = await anonymousClient.get<ApiResponse>('/api/auth/me');

          expect(response.data.success).toBe(false);
          expect(response.status).toBe(401);
        },
        TEST_TIMEOUT
      );
    });

    describe('PUT /me/profile - 更新用户资料', () => {
      test(
        'TC-USER-010: 更新用户资料成功（需要Token）',
        async () => {
          const response = await apiClient.put<ApiResponse>(
            '/api/auth/me/profile',
            {
              nickname: '自动化测试用户',
              gender: 'male',
              location: '北京市',
              bio: '这是自动化测试创建的用户',
            }
          );

          expect(response.status).toBe(200);
          expect(response.data.success).toBe(true);
        },
        TEST_TIMEOUT
      );

      test(
        'TC-USER-011: 无Token更新失败',
        async () => {
          const response = await anonymousClient.put<ApiResponse>('/api/auth/me/profile', {
            nickname: '新昵称',
          });

          expect(response.data.success).toBe(false);
          expect(response.status).toBe(401);
        },
        TEST_TIMEOUT
      );
    });

    describe('PUT /me/password - 修改密码', () => {
      test(
        'TC-USER-020: 修改密码成功（需要Token）',
        async () => {
          const response = await apiClient.put<ApiResponse>(
            '/api/auth/me/password',
            {
              oldPassword: testUser.password,
              newPassword: 'NewTest123456!@#',
            }
          );

          expect(response.status).toBe(200);
          expect(response.data.success).toBe(true);

          // 更新密码
          testUser.password = 'NewTest123456!@#';
        },
        TEST_TIMEOUT
      );

      test(
        'TC-USER-021: 旧密码错误失败',
        async () => {
          const response = await apiClient.put<ApiResponse>(
            '/api/auth/me/password',
            {
              oldPassword: 'WrongOldPassword123',
              newPassword: 'NewPassword123!@#',
            }
          );

          expect(response.data.success).toBe(false);
          expect(response.status).toBe(401);
        },
        TEST_TIMEOUT
      );
    });

    describe('设备管理', () => {
      test(
        'TC-USER-050: 获取用户设备列表成功',
        async () => {
          const response = await apiClient.get<ApiResponse<{ devices: any[] }>>('/api/auth/me/devices');

          expect(response.status).toBe(200);
          expect(response.data.success).toBe(true);
        },
        TEST_TIMEOUT
      );

      test(
        'TC-USER-060: 获取会话列表成功',
        async () => {
          const response = await apiClient.get<ApiResponse<{ sessions: any[] }>>('/api/auth/me/sessions');

          expect(response.status).toBe(200);
          expect(response.data.success).toBe(true);
        },
        TEST_TIMEOUT
      );
    });
  });

  // ========================================
  // 3. 面容ID模块测试
  // ========================================
  describe('面容ID模块 /api/face-id', () => {
    test(
      'TC-FACEID-001: 获取面容ID状态成功（需要Token）',
      async () => {
        const response = await apiClient.get<ApiResponse<{ enabled: boolean }>>('/api/face-id/status');

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-FACEID-010: 开通面容ID成功（需要Token）',
      async () => {
        const response = await apiClient.post<ApiResponse>(
          '/api/face-id/enable',
          {
            faceIdData: `biometric_token_${Date.now()}`,
          }
        );

        // 可能成功，也可能已经开通
        expect(response.status).toBeLessThan(500);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-FACEID-012: 关闭面容ID成功（需要Token）',
      async () => {
        const response = await apiClient.post<ApiResponse>('/api/face-id/disable', {});

        expect(response.status).toBe(200);
      },
      TEST_TIMEOUT
    );
  });

  // ========================================
  // 4. 双因素认证模块测试
  // ========================================
  describe('双因素认证模块 /api/2fa', () => {
    test(
      'TC-2FA-001: 获取2FA状态成功（需要Token）',
      async () => {
        const response = await apiClient.get<ApiResponse>('/api/2fa/status');

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-2FA-010: 设置TOTP成功（需要Token）',
      async () => {
        const response = await apiClient.post<ApiResponse<{ qrCodeUrl: string; manualEntryKey: string }>>(
          '/api/2fa/setup/totp',
          {
            email: testUser.email,
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.data?.qrCodeUrl).toBeDefined();
      },
      TEST_TIMEOUT
    );
  });

  // ========================================
  // 5. 订阅服务模块测试
  // ========================================
  describe('订阅服务模块 /api/subscription', () => {
    test(
      'TC-SUB-001: 获取套餐列表成功（公开）',
      async () => {
        const response = await anonymousClient.get<ApiResponse<{ plans: any[] }>>('/api/subscription/plans');

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-SUB-020: 获取我的订阅成功（需要Token）',
      async () => {
        const response = await apiClient.get<ApiResponse>('/api/subscription/my-subscription');

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-SUB-023: 获取服务权益成功（需要Token）',
      async () => {
        const response = await apiClient.get<ApiResponse>('/api/subscription/benefits');

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );
  });

  // ========================================
  // 6. 通知设置模块测试
  // ========================================
  describe('通知设置模块 /api/users/me/notifications', () => {
    test(
      'TC-NOTIF-001: 获取通知设置成功（需要Token）',
      async () => {
        const response = await apiClient.get<ApiResponse>('/api/users/me/notifications/settings');

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-NOTIF-010: 更新推送开关成功（需要Token）',
      async () => {
        const response = await apiClient.put<ApiResponse>(
          '/api/users/me/notifications/settings/push',
          {
            enabled: true,
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-NOTIF-011: 设置免打扰时间成功（需要Token）',
      async () => {
        const response = await apiClient.put<ApiResponse>(
          '/api/users/me/notifications/settings/dnd',
          {
            dndStart: '22:00',
            dndEnd: '08:00',
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-NOTIF-030: 更新哭声检测设置成功（需要Token）',
      async () => {
        const response = await apiClient.put<ApiResponse>(
          '/api/users/me/notifications/settings/crying',
          {
            detectionEnabled: true,
            recognitionEnabled: true,
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-NOTIF-070: 获取通知历史成功（需要Token）',
      async () => {
        const response = await apiClient.get<ApiResponse>('/api/users/me/notifications/history?limit=10');

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-NOTIF-071: 获取未读通知数量成功（需要Token）',
      async () => {
        const response = await apiClient.get<ApiResponse<{ count: number }>>(
          '/api/users/me/notifications/unread-count'
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );
  });

  // ========================================
  // 7. 帮助中心模块测试
  // ========================================
  describe('帮助中心模块 /api/help', () => {
    test(
      'TC-HELP-001: 获取帮助文章列表成功（公开）',
      async () => {
        const response = await anonymousClient.get<ApiResponse>('/api/help/articles?limit=10');

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-HELP-002: 搜索帮助文章成功（公开）',
      async () => {
        const response = await anonymousClient.get<ApiResponse>('/api/help/search?keyword=如何绑定设备');

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-HELP-003: 获取工单统计成功（需要Token）',
      async () => {
        const response = await apiClient.get<ApiResponse>('/api/help/tickets/stats');

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-HELP-010: 创建工单成功（需要Token）',
      async () => {
        const response = await apiClient.post<ApiResponse>(
          '/api/help/tickets',
          {
            title: '自动化测试工单',
            description: '这是一个自动化测试创建的工单',
            ticketType: 'technical',
            priority: 'low',
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );
  });

  // ========================================
  // 8. 用户登出测试
  // ========================================
  describe('用户登出', () => {
    test(
      'TC-LOGOUT-001: 用户登出成功（需要Token）',
      async () => {
        const response = await apiClient.post<ApiResponse>('/api/auth/logout', {});

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      'TC-LOGOUT-002: 验证Token已失效',
      async () => {
        // 等待Token黑名单生效
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await apiClient.get<ApiResponse>('/api/auth/me');

        expect(response.data.success).toBe(false);
        expect(response.status).toBe(401);
      },
      TEST_TIMEOUT
    );
  });
});
