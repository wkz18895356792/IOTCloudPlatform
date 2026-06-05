/**
 * 设备权限控制器
 *
 * 提供内部API供其他服务检查用户对设备的权限
 * 这些API仅供服务间调用，需要API Key认证
 */

import { Controller, Get, Post, Query, Body, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { UserService } from '../service/user.service';

/**
 * 权限检查结果
 */
export interface PermissionCheckResult {
  hasPermission: boolean;
  role?: 'owner' | 'admin' | 'viewer';
  deviceId: string;
  userId: string;
}

/**
 * 批量权限检查结果
 */
export interface BatchPermissionCheckResult {
  results: Array<{
    deviceId: string;
    hasPermission: boolean;
    role?: 'owner' | 'admin' | 'viewer';
  }>;
}

/**
 * 设备权限控制器
 *
 * 提供内部API用于设备权限检查，仅允许服务间调用
 */
@Controller('/api/internal/devices', { tagName: 'DevicePermission', description: '设备权限内部API' })
export class DevicePermissionController {
  @Inject()
  ctx!: Context;

  @Inject()
  userService!: UserService;

  /**
   * 检查用户对设备的权限
   *
   * @param deviceId - 设备ID
   * @param userId - 用户ID
   * @returns 权限检查结果
   */
  @Get('/permission')
  async checkPermission(
    @Query('deviceId') deviceId: string,
    @Query('userId') userId: string
  ): Promise<PermissionCheckResult> {
    // 验证API Key（从中间件或请求头获取）
    const apiKey = this.ctx.headers['x-service-api-key'] as string;
    if (!apiKey || apiKey !== process.env.SERVICE_API_KEY) {
      this.ctx.throw(401, 'Invalid API Key');
    }

    // 检查权限
    const result = await this.userService.checkDevicePermission(deviceId, userId);

    return {
      ...result,
      deviceId,
      userId,
    };
  }

  /**
   * 批量检查用户对多个设备的权限
   *
   * @param deviceIds - 设备ID列表（逗号分隔）
   * @param userId - 用户ID
   * @returns 批量权限检查结果
   */
  @Get('/permissions/batch')
  async checkPermissionsBatch(
    @Query('deviceIds') deviceIds: string,
    @Query('userId') userId: string
  ): Promise<BatchPermissionCheckResult> {
    // 验证API Key
    const apiKey = this.ctx.headers['x-service-api-key'] as string;
    if (!apiKey || apiKey !== process.env.SERVICE_API_KEY) {
      this.ctx.throw(401, 'Invalid API Key');
    }

    // 解析设备ID列表
    const deviceIdArray = deviceIds.split(',').map(id => id.trim());

    // 批量检查权限
    const results = await this.userService.checkDevicePermissionsBatch(deviceIdArray, userId);

    return { results };
  }

  /**
   * 获取用户有权限访问的所有设备ID
   *
   * @param userId - 用户ID
   * @returns 设备ID列表
   */
  @Get('/permissions/user')
  async getUserDevices(@Query('userId') userId: string): Promise<{ deviceIds: string[] }> {
    // 验证API Key
    const apiKey = this.ctx.headers['x-service-api-key'] as string;
    if (!apiKey || apiKey !== process.env.SERVICE_API_KEY) {
      this.ctx.throw(401, 'Invalid API Key');
    }

    // 获取用户有权限的设备列表
    const deviceIds = await this.userService.getUserAccessibleDevices(userId);

    return { deviceIds };
  }

  /**
   * 内部接口：为用户绑定设备（邀请/分享时由 device-service 调用）
   *
   * 在 user_devices 表中创建记录，使设备出现在用户的设备列表中。
   */
  @Post('/bind')
  async bindDevice(
    @Body()
    body: {
      userId: string;
      deviceId: string;
      deviceName?: string;
      role?: 'owner' | 'admin' | 'viewer';
      isShared?: boolean;
      sharedBy?: string;
    }
  ) {
    // 验证 API Key
    const apiKey = this.ctx.headers['x-service-api-key'] as string;
    if (!apiKey || apiKey !== process.env.SERVICE_API_KEY) {
      this.ctx.throw(401, 'Invalid API Key');
    }

    const { userId, deviceId, deviceName, role = 'viewer', isShared = true, sharedBy } = body;
    if (!userId || !deviceId) {
      this.ctx.throw(400, 'userId and deviceId are required');
    }

    const userDevice = await this.userService.bindDevice(
      userId,
      deviceId,
      deviceName,
      role,
      { isShared, sharedBy }
    );

    return { success: true, id: userDevice.id };
  }

  /**
   * 检查用户是否属于某个家庭，从而可以访问家庭设备
   *
   * @param userId - 用户ID
   * @param deviceId - 设备ID
   * @returns 是否有访问权限
   */
  @Get('/permissions/family')
  async checkFamilyAccess(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId: string
  ): Promise<{ hasAccess: boolean }> {
    // 验证API Key
    const apiKey = this.ctx.headers['x-service-api-key'] as string;
    if (!apiKey || apiKey !== process.env.SERVICE_API_KEY) {
      this.ctx.throw(401, 'Invalid API Key');
    }

    // 检查家庭权限
    const hasAccess = await this.userService.checkFamilyDeviceAccess(userId, deviceId);

    return { hasAccess };
  }
}
