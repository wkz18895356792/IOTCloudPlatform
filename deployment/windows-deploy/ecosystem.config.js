/**
 * PM2 Process Configuration
 * BabyMonitor Platform Microservices
 *
 * Usage:
 *   pm2 start ecosystem.config.js              - Start all services
 *   pm2 start ecosystem.config.js --only api-gateway  - Start specific service
 *   pm2 stop all                               - Stop all services
 *   pm2 restart all                            - Restart all services
 *   pm2 logs                                   - View logs
 *   pm2 monit                                  - Monitor panel
 */

const fs = require('fs');
const path = require('path');

// 从 .env 文件加载环境变量
const envFile = path.join(__dirname, '.env');
const env = {};
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf-8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key) {
        let value = valueParts.join('=').trim();
        // 移除引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[key.trim()] = value;
      }
    }
  });
}

// 添加 NODE_ENV
env.NODE_ENV = 'production';

module.exports = {
  apps: [
    {
      name: 'api-gateway',
      cwd: './api-gateway',
      script: 'bootstrap.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { ...env, PORT: 6001 },
      error_file: '../logs/api-gateway-error.log',
      out_file: '../logs/api-gateway-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000
    },
    {
      name: 'user-service',
      cwd: './user-service',
      script: 'bootstrap.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { ...env, PORT: 6002 },
      error_file: '../logs/user-service-error.log',
      out_file: '../logs/user-service-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000
    },
    {
      name: 'device-service',
      cwd: './device-service',
      script: 'bootstrap.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { ...env, PORT: 6003 },
      error_file: '../logs/device-service-error.log',
      out_file: '../logs/device-service-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000
    },
    {
      name: 'device-gateway',
      cwd: './device-gateway',
      script: 'bootstrap.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { ...env, PORT: 6010 },
      error_file: '../logs/device-gateway-error.log',
      out_file: '../logs/device-gateway-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 15000
    },
    {
      name: 'baby-service',
      cwd: './baby-service',
      script: 'bootstrap.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { ...env, PORT: 6008 },
      error_file: '../logs/baby-service-error.log',
      out_file: '../logs/baby-service-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000
    },
    {
      name: 'video-service',
      cwd: './video-service',
      script: 'bootstrap.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { ...env, PORT: 6004 },
      error_file: '../logs/video-service-error.log',
      out_file: '../logs/video-service-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000
    },
    {
      name: 'storage-service',
      cwd: './storage-service',
      script: 'bootstrap.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { ...env, PORT: 6005 },
      error_file: '../logs/storage-service-error.log',
      out_file: '../logs/storage-service-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000
    },
    {
      name: 'admin-service',
      cwd: './admin-service',
      script: 'bootstrap.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { ...env, PORT: 6009 },
      error_file: '../logs/admin-service-error.log',
      out_file: '../logs/admin-service-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000
    }
  ]
};
