import { MidwayConfig } from '@midwayjs/core';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { join } from 'path';
import { existsSync } from 'fs';
import { VerificationCodeType } from '@baby-monitor/shared-types';

// 加载项目根目录的 .env 文件（支持多种路径）
const envPaths = [
  path.resolve(__dirname, '../../../../.env'),  // 开发环境
  path.resolve(__dirname, '../../../.env'),      // 生产环境 dist/config -> .env
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}
// 本地开发环境：覆盖 Docker 环境变量
if (process.env.NODE_ENV !== 'production') {
  process.env.REDIS_HOST = process.env.REDIS_HOST === 'redis' ? 'localhost' : process.env.REDIS_HOST;
  process.env.MQTT_HOST = process.env.MQTT_HOST === 'emqx' ? 'localhost' : process.env.MQTT_HOST;
}

// ==================== 安全配置验证 ====================
// JWT 密钥验证（必须至少 64 位）
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 64) {
  throw new Error(
    'JWT_SECRET must be at least 64 characters long. ' +
    'Please generate a secure secret using: openssl rand -base64 48'
  );
}

// Session 密钥验证
const sessionKeys = process.env.SESSION_KEYS;
if (!sessionKeys || sessionKeys.length < 32) {
  throw new Error(
    'SESSION_KEYS must be at least 32 characters long. ' +
    'Please generate secure keys using: openssl rand -base64 32'
  );
}

export default {
  keys: sessionKeys,
  koa: {
    port: 6002,
  },
  // CORS 跨域配置
  cors: {
    credentials: true,
    origin: (ctx: any) => {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173').split(',');
      const requestOrigin = ctx.get('Origin');
      return allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
    },
  },
  midwayLogger: {
    clients: {
      coreLogger: {
        level: 'all',
        fileLogName: 'user-service-core.log',
        dir: join(__dirname, '../../logs'),
      },
      appLogger: {
        level: 'all',
        fileLogName: 'user-service-app.log',
        dir: join(__dirname, '../../logs'),
      },
    },
  },
  jwt: {
    secret: jwtSecret, // JWT 签名密钥（已验证长度）
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
  },
  swagger: {
    title: 'User Service',
    description: '智能家居云平台 - 用户服务',
    version: '1.0.0',
    path: '/swagger-ui',
    allowAll: true, // 允许所有路由
  },
  typeorm: {
    dataSource: {
      default: {
        type: 'mysql',
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        username: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'babymonitor',
        synchronize: true,
        logging: true,
        entities: ['**/entity/*.entity{.ts,.js}'],
      },
    },
  },
  redis: {
    client: {
      port: parseInt(process.env.REDIS_PORT || '6379'),
      host: process.env.REDIS_HOST || 'localhost',
      ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
      db: parseInt(process.env.REDIS_DB || '0'),
    },
  },
  // ==================== 统一短信服务配置 ====================
  sms: {
    provider: (process.env.SMS_PROVIDER || 'aliyun') as 'aliyun' | 'tencent',
    aliyun: {
      accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET || '',
      signName: process.env.ALIYUN_SMS_SIGN_NAME || '智能家居',
      endpoint: 'https://dysmsapi.aliyuncs.com',
      apiVersion: '2017-05-25',
    },
    tencent: {
      secretId: process.env.TENCENT_SMS_SECRET_ID || '',
      secretKey: process.env.TENCENT_SMS_SECRET_KEY || '',
      region: process.env.TENCENT_SMS_REGION || 'ap-guangzhou',
      smsSdkAppId: process.env.TENCENT_SMS_SDK_APP_ID || '',
      signName: process.env.TENCENT_SMS_SIGN_NAME || '智能家居',
    },
  },
  // 短信模板映射（SMSService 使用，根据 provider 选取对应模板）
  smsTemplates: {
    aliyun: {
      [VerificationCodeType.REGISTER]: process.env.ALIYUN_SMS_TEMPLATE_REGISTER || 'SMS_123456789',
      [VerificationCodeType.LOGIN]: process.env.ALIYUN_SMS_TEMPLATE_LOGIN || 'SMS_123456790',
      [VerificationCodeType.RESET_PASSWORD]: process.env.ALIYUN_SMS_TEMPLATE_RESET_PASSWORD || 'SMS_123456791',
      [VerificationCodeType.BIND_PHONE]: process.env.ALIYUN_SMS_TEMPLATE_BIND_PHONE || 'SMS_123456792',
      [VerificationCodeType.CHANGE_PHONE]: process.env.ALIYUN_SMS_TEMPLATE_CHANGE_PHONE || 'SMS_123456793',
    },
    tencent: {
      [VerificationCodeType.REGISTER]: process.env.TENCENT_SMS_TEMPLATE_REGISTER || '',
      [VerificationCodeType.LOGIN]: process.env.TENCENT_SMS_TEMPLATE_LOGIN || '',
      [VerificationCodeType.RESET_PASSWORD]: process.env.TENCENT_SMS_TEMPLATE_RESET_PASSWORD || '',
      [VerificationCodeType.BIND_PHONE]: process.env.TENCENT_SMS_TEMPLATE_BIND_PHONE || '',
      [VerificationCodeType.CHANGE_PHONE]: process.env.TENCENT_SMS_TEMPLATE_CHANGE_PHONE || '',
    },
  },
  // ==================== OAuth第三方登录配置 ====================
  oauth: {
    // 微信登录配置
    wechat: {
      enabled: process.env.OAUTH_WECHAT_ENABLED === 'true',
      clientId: process.env.OAUTH_WECHAT_APP_ID || '',
      clientSecret: process.env.OAUTH_WECHAT_APP_SECRET || '',
      redirectUri: process.env.OAUTH_WECHAT_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/wechat',
      scope: ['snsapi_userinfo'],
      authUrl: 'https://open.weixin.qq.com/connect/oauth2/authorize',
      tokenUrl: 'https://api.weixin.qq.com/sns/oauth2/access_token',
      userInfoUrl: 'https://api.weixin.qq.com/sns/userinfo',
    },
    // 微信开放平台（用于获取unionid）
    wechatOpen: {
      enabled: process.env.OAUTH_WECHAT_OPEN_ENABLED === 'true',
      clientId: process.env.OAUTH_WECHAT_OPEN_APP_ID || '',
      clientSecret: process.env.OAUTH_WECHAT_OPEN_APP_SECRET || '',
      redirectUri: process.env.OAUTH_WECHAT_OPEN_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/wechat',
      scope: ['snsapi_login'],
      authUrl: 'https://open.weixin.qq.com/connect/qrconnect',
      tokenUrl: 'https://api.weixin.qq.com/sns/oauth2/access_token',
      userInfoUrl: 'https://api.weixin.qq.com/sns/userinfo',
    },
    // 企业微信登录配置
    wechatWork: {
      enabled: process.env.OAUTH_WECHAT_WORK_ENABLED === 'true',
      clientId: process.env.OAUTH_WECHAT_WORK_CORP_ID || '',
      clientSecret: process.env.OAUTH_WECHAT_WORK_SECRET || '',
      redirectUri: process.env.OAUTH_WECHAT_WORK_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/wechat-work',
      scope: ['snsapi_base'],
      authUrl: 'https://open.work.weixin.qq.com/wwopen/sso/qrConnect',
      tokenUrl: 'https://qyapi.weixin.qq.com/cgi-bin/gettoken',
      userInfoUrl: 'https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo',
    },
    // QQ登录配置
    qq: {
      enabled: process.env.OAUTH_QQ_ENABLED === 'true',
      clientId: process.env.OAUTH_QQ_APP_ID || '',
      clientSecret: process.env.OAUTH_QQ_APP_KEY || '',
      redirectUri: process.env.OAUTH_QQ_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/qq',
      scope: ['get_user_info'],
      authUrl: 'https://graph.qq.com/oauth2.0/authorize',
      tokenUrl: 'https://graph.qq.com/oauth2.0/token',
      userInfoUrl: 'https://graph.qq.com/user/get_user_info',
    },
    // 支付宝登录配置
    alipay: {
      enabled: process.env.OAUTH_ALIPAY_ENABLED === 'true',
      clientId: process.env.OAUTH_ALIPAY_APP_ID || '',
      clientSecret: process.env.OAUTH_ALIPAY_PRIVATE_KEY || '',
      redirectUri: process.env.OAUTH_ALIPAY_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/alipay',
      scope: ['auth_user'],
      authUrl: 'https://openauth.alipay.com/oauth2/publicAppAuthorize.htm',
      tokenUrl: 'https://openapi.alipay.com/gateway.do',
      userInfoUrl: 'https://openapi.alipay.com/gateway.do',
    },
    // 微博登录配置
    weibo: {
      enabled: process.env.OAUTH_WEIBO_ENABLED === 'true',
      clientId: process.env.OAUTH_WEIBO_APP_KEY || '',
      clientSecret: process.env.OAUTH_WEIBO_APP_SECRET || '',
      redirectUri: process.env.OAUTH_WEIBO_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/weibo',
      scope: ['email'],
      authUrl: 'https://api.weibo.com/oauth2/authorize',
      tokenUrl: 'https://api.weibo.com/oauth2/access_token',
      userInfoUrl: 'https://api.weibo.com/2/users/show.json',
    },
    // GitHub登录配置
    github: {
      enabled: process.env.OAUTH_GITHUB_ENABLED === 'true',
      clientId: process.env.OAUTH_GITHUB_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_GITHUB_CLIENT_SECRET || '',
      redirectUri: process.env.OAUTH_GITHUB_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/github',
      scope: ['read:user', 'user:email'],
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userInfoUrl: 'https://api.github.com/user',
    },
    // Google登录配置
    google: {
      enabled: process.env.OAUTH_GOOGLE_ENABLED === 'true',
      clientId: process.env.OAUTH_GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET || '',
      redirectUri: process.env.OAUTH_GOOGLE_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/google',
      scope: ['openid', 'profile', 'email'],
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    },
    // Facebook登录配置
    facebook: {
      enabled: process.env.OAUTH_FACEBOOK_ENABLED === 'true',
      clientId: process.env.OAUTH_FACEBOOK_APP_ID || '',
      clientSecret: process.env.OAUTH_FACEBOOK_APP_SECRET || '',
      redirectUri: process.env.OAUTH_FACEBOOK_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/facebook',
      scope: ['email', 'public_profile'],
      authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
      userInfoUrl: 'https://graph.facebook.com/v18.0/me',
    },
    // 钉钉登录配置
    dingtalk: {
      enabled: process.env.OAUTH_DINGTALK_ENABLED === 'true',
      clientId: process.env.OAUTH_DINGTALK_APP_ID || '',
      clientSecret: process.env.OAUTH_DINGTALK_APP_SECRET || '',
      redirectUri: process.env.OAUTH_DINGTALK_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/dingtalk',
      scope: ['openid', 'corpid'],
      authUrl: 'https://login.dingtalk.com/oauth2/auth',
      tokenUrl: 'https://api.dingtalk.com/v1.0/oauth2/userAccessToken',
      userInfoUrl: 'https://api.dingtalk.com/v1.0/contact/users/me',
    },
    // 飞书登录配置
    feishu: {
      enabled: process.env.OAUTH_FEISHU_ENABLED === 'true',
      clientId: process.env.OAUTH_FEISHU_APP_ID || '',
      clientSecret: process.env.OAUTH_FEISHU_APP_SECRET || '',
      redirectUri: process.env.OAUTH_FEISHU_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/feishu',
      scope: ['email', 'phone'],
      authUrl: 'https://open.feishu.cn/open-apis/authen/v1/authorize',
      tokenUrl: 'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token',
      userInfoUrl: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
    },
    // Apple Sign In配置
    apple: {
      enabled: process.env.OAUTH_APPLE_ENABLED === 'true',
      clientId: process.env.OAUTH_APPLE_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_APPLE_CLIENT_SECRET || '', // JWT格式
      redirectUri: process.env.OAUTH_APPLE_REDIRECT_URI || 'https://yourdomain.com/oauth/callback/apple',
      scope: ['name', 'email'],
      authUrl: 'https://appleid.apple.com/auth/authorize',
      tokenUrl: 'https://appleid.apple.com/auth/token',
      userInfoUrl: 'https://appleid.apple.com/auth/keys',
    },
  },
  // 服务间通信配置
  serviceClient: {
    apiKey: process.env.SERVICE_API_KEY || 'your-service-api-key',
    timeout: parseInt(process.env.SERVICE_TIMEOUT || '30000'),
    maxRetries: parseInt(process.env.SERVICE_MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.SERVICE_RETRY_DELAY || '1000'),
    enableServiceDiscovery: process.env.SERVICE_DISCOVERY_ENABLED === 'true',
  },
} as MidwayConfig;
