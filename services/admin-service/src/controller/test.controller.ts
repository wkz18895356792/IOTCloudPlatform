import { Controller, Get } from '@midwayjs/core';

@Controller('/test')
export class TestController {
  @Get('/')
  async index() {
    return { message: 'Test endpoint works!', timestamp: Date.now() };
  }
}
