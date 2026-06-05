import { MidwayConfig } from '@midwayjs/core';

export default {
  keys: '1700647148485',
  koa: {
    port: 6002,
  },
  // 本地开发 MySQL 配置
  // 请根据本地 MySQL 配置修改以下参数，或设置环境变量
  orm: {
    type: 'mysql',
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    username: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'password',
    database: process.env.MYSQL_DATABASE || 'smart_home',
    synchronize: false,
    logging: true,
  },
  // Redis 可选配置 - 本地开发可以不启用
  // redis: {
  //   port: 6379,
  //   host: 'localhost',
  //   password: '',
  //   db: 0,
  // },
  // MQTT 可选配置 - 本地开发可以不启用
  // mqtt: {
  //   host: 'localhost',
  //   port: 1883,
  //   username: '',
  //   password: '',
  // },
} as MidwayConfig;
