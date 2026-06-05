import { Controller, Post, Get, Inject, Body, Param } from '@midwayjs/core';
import { DeviceRegistrationService, DeviceRegistrationRequest } from '../service/device/device-registration.service';

/**
 * 设备注册控制器
 *
 * 处理设备注册相关的HTTP请求
 */
@Controller('/registration', { tagName: 'DeviceRegistration', description: '设备注册API' })
export class DeviceRegistrationController {
  @Inject()
  registrationService!: DeviceRegistrationService;

  /**
   * 设备注册
   *
   * @param request 注册请求
   */
  @Post('/register')
  async register(@Body() request: DeviceRegistrationRequest) {
    return await this.registrationService.handleRegistration(request);
  }

  /**
   * 获取设备注册信息
   *
   * @param deviceId 设备ID
   */
  @Get('/info/:deviceId')
  async getRegistrationInfo(@Param('deviceId') deviceId: string) {
    const info = await this.registrationService.getRegistrationInfo(deviceId);

    if (!info) {
      return {
        success: false,
        error: 'Registration not found',
      };
    }

    return {
      success: true,
      info,
    };
  }

  /**
   * 获取注册统计
   */
  @Get('/statistics')
  async getStatistics() {
    return await this.registrationService.getStatistics();
  }

  /**
   * 完成注册流程
   * 设备完成认证后调用
   *
   * @param deviceId 设备ID
   */
  @Post('/complete/:deviceId')
  async completeRegistration(@Param('deviceId') deviceId: string) {
    await this.registrationService.completeRegistration(deviceId);

    return {
      success: true,
      message: 'Registration completed',
    };
  }
}
