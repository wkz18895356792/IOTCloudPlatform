import { Controller, Get } from '@midwayjs/core';
import { ApiOperation, ApiTags } from '@midwayjs/swagger';

/**
 * 健康检查控制器
 */
@ApiTags('系统')
@Controller('/')
export class HealthController {
  @Get('/health')
  @ApiOperation({ summary: '健康检查' })
  async health() {
    return {
      status: 'ok',
      service: 'admin-service',
      timestamp: new Date().toISOString(),
    };
  }
}
