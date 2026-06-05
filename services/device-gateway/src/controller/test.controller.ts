import { Controller, Get } from '@midwayjs/core';

/**
 * 测试控制器
 * 用于验证服务是否正常运行
 */
@Controller('/test')
export class TestController {
  @Get('/')
  async hello() {
    return {
      message: 'Hello from Device Gateway!',
      timestamp: Date.now(),
    };
  }

  @Get('/ping')
  async ping() {
    return {
      status: 'ok',
      pong: true,
      timestamp: Date.now(),
    };
  }

  @Get('/info')
  async info() {
    return {
      service: 'device-gateway',
      version: '2.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      env: {
        nodeEnv: process.env.NODE_ENV,
        mqttHost: process.env.MQTT_HOST,
        mysqlHost: process.env.MYSQL_HOST,
      },
    };
  }
}
