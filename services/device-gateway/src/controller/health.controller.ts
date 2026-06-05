import { Controller, Get } from '@midwayjs/core';
import { ApiOperation, ApiTags } from '@midwayjs/swagger';

/**
 * 健康检查控制器
 *
 * 提供基础健康检查端点，不依赖其他服务
 * 详细的服务状态通过其他端点获取
 */
@ApiTags('系统')
@Controller('/')
export class HealthController {
  /**
   * 健康检查端点
   * 返回服务基本状态，不依赖其他服务
   */
  @Get('/health')
  @ApiOperation({ summary: '健康检查' })
  async health() {
    return {
      status: 'ok',
      service: 'device-gateway',
      version: '2.0.0',
      timestamp: Date.now(),
      uptime: process.uptime(),
    };
  }

  /**
   * 就绪检查端点
   */
  @Get('/ready')
  @ApiOperation({ summary: '就绪检查' })
  async ready() {
    return {
      ready: true,
      checks: {
        server: 'pass',
      },
    };
  }
}
