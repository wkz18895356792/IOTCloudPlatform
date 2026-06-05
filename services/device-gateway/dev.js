const path = require('path');
const dotenv = require('dotenv');

// 尝试多个可能的 .env 文件路径
const possibleEnvPaths = [
  path.join(__dirname, '../../.env'),        // services -> platform
  path.join(__dirname, '../.env'),           // 当前目录
  path.join(process.cwd(), '../.env'),       // cwd -> platform
  path.join(process.cwd(), '../../.env'),    // cwd -> services -> platform
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

// 使用 midway-bin dev 启动开发服务器
const { spawn } = require('child_process');
const dev = spawn('npx', ['midway-bin', 'dev', '--port=6010'], {
  stdio: 'inherit',
  shell: true
});

dev.on('exit', (code) => {
  process.exit(code || 0);
});
