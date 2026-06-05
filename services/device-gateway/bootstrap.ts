import { join } from 'path';
import * as dotenv from 'dotenv';
import { existsSync } from 'fs';

// 尝试多个可能的 .env 文件路径
const possibleEnvPaths = [
  join(__dirname, '../../.env'),        // 生产环境: dist -> .env
  join(__dirname, '../../../.env'),     // 开发环境: dist -> services -> platform
  join(process.cwd(), '.env'),          // 当前工作目录
  join(process.cwd(), '../../.env'),    // cwd -> services -> platform
];

let envLoaded = false;
for (const envPath of possibleEnvPaths) {
  try {
    const result = dotenv.config({ path: envPath });
    if (result.error) {
      // 文件不存在，继续尝试下一个
      continue;
    }
    console.log(`[Bootstrap] Loaded .env from: ${envPath}`);
    envLoaded = true;
    break;
  } catch (e) {
    // 忽略错误，继续尝试
  }
}

if (!envLoaded) {
  console.warn('[Bootstrap] Warning: Could not find .env file, using default environment variables');
}

// 导入并启动 Midway 开发服务器
require('@midwayjs/cli/lib/dev').run({
  port: 6010,
  tsMode: true,
});
