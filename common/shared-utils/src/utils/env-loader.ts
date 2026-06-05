/**
 * 环境变量加载工具
 * 支持开发和生产环境的 .env 文件加载
 */
import { join } from 'path';
import { existsSync } from 'fs';
import * as dotenv from 'dotenv';

/**
 * 加载 .env 文件
 * 自动检测多个可能的路径，适用于开发和生产环境
 */
export function loadEnv(): void {
  // 如果环境变量已经由 PM2 或其他方式加载，跳过
  if (process.env.NODE_ENV === 'production' && process.env.REDIS_HOST) {
    return;
  }

  const envPaths = [
    // 开发环境路径
    join(__dirname, '../../../../.env'),  // common/shared-utils/dist/utils -> .env
    join(__dirname, '../../../../../.env'), // services/xxx/src/config -> .env
    // 生产环境路径
    join(__dirname, '../../../.env'),       // xxx/dist -> .env
    join(__dirname, '../../.env'),          // xxx/dist/configuration -> .env
    // 当前工作目录
    join(process.cwd(), '.env'),
  ];

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const result = dotenv.config({ path: envPath });
      if (!result.error) {
        console.log(`[env-loader] Loaded env from ${envPath}`);
        return;
      }
    }
  }

  // 静默失败，环境变量可能已由 PM2 注入
}
