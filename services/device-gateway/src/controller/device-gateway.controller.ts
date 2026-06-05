import { Controller, Get, Post, Inject, Body, Query } from '@midwayjs/core';
import { GatewayCoreService } from '../service/core/gateway-core.service';
import { ConnectionManagerService, DeviceConnection } from '../service/core/connection-manager.service';
import { DeviceAuthService, DeviceAuthRequest } from '../service/device/device-auth.service';
import { ProtocolConverterService } from '../service/protocol/protocol-converter.service';
import { successResponse } from '@baby-monitor/shared-types';

/**
 * 设备网关控制器
 *
 * 提供设备网关的HTTP API接口
 */
@Controller('/gateway', { tagName: 'DeviceGateway', description: '设备网关API' })
export class DeviceGatewayController {
  @Inject()
  gatewayCore!: GatewayCoreService;

  @Inject()
  connectionManager!: ConnectionManagerService;

  @Inject()
  deviceAuth!: DeviceAuthService;

  @Inject()
  protocolConverter!: ProtocolConverterService;

  /**
   * 获取网关状态
   */
  @Get('/status')
  async getStatus() {
    return {
      connected: this.gatewayCore.isConnected(),
      onlineDevices: await this.connectionManager.getOnlineDeviceIds(),
      statistics: await this.connectionManager.getStatistics(),
    };
  }

  /**
   * 获取设备连接信息
   */
  @Get('/device/:deviceId/connection')
  async getDeviceConnection(@Query('deviceId') deviceId: string) {
    const connection = await this.connectionManager.getDeviceConnection(deviceId);
    const isOnline = await this.connectionManager.isDeviceOnline(deviceId);

    return {
      connection,
      isOnline,
    };
  }

  /**
   * 获取在线设备列表
   */
  @Get('/devices/online')
  async getOnlineDevices() {
    const deviceIds = await this.connectionManager.getOnlineDeviceIds();
    const devices = await Promise.all(
      deviceIds.map(async (id) => ({
        deviceId: id,
        connection: await this.connectionManager.getDeviceConnection(id),
      }))
    );

    return { devices };
  }

  /**
   * 设备认证
   */
  @Post('/device/auth')
  async authenticateDevice(@Body() authRequest: DeviceAuthRequest) {
    return await this.deviceAuth.authenticateDevice(authRequest);
  }

  /**
   * 验证设备令牌
   */
  @Post('/device/token/verify')
  async verifyToken(@Body() body: { deviceId: string; token: string }) {
    const valid = await this.deviceAuth.verifyToken(body.deviceId, body.token);
    return { valid };
  }

  /**
   * 刷新设备令牌
   */
  @Post('/device/token/refresh')
  async refreshToken(@Body() body: { deviceId: string }) {
    const token = await this.deviceAuth.refreshToken(body.deviceId);
    return { token };
  }

  /**
   * 撤销设备令牌
   */
  @Post('/device/token/revoke')
  async revokeToken(@Body() body: { deviceId: string }) {
    await this.deviceAuth.revokeToken(body.deviceId);
    return successResponse(null, '设备令牌已撤销');
  }

  /**
   * 获取设备认证状态
   */
  @Get('/device/:deviceId/auth-status')
  async getDeviceAuthStatus(@Query('deviceId') deviceId: string) {
    return await this.deviceAuth.getDeviceAuthStatus(deviceId);
  }

  /**
   * 协议转换 - 私有协议转Matter
   */
  @Post('/protocol/convert/private-to-matter')
  async privateToMatter(@Body() body: {
    deviceId: string;
    state: any;
    productType: string;
  }) {
    return await this.protocolConverter.privateToMatter(
      body.deviceId,
      body.state,
      body.productType as any
    );
  }

  /**
   * 协议转换 - Matter转私有协议
   */
  @Post('/protocol/convert/matter-to-private')
  async matterToPrivate(@Body() body: {
    nodeId: number;
    state: any;
  }) {
    return await this.protocolConverter.matterToPrivate(body.nodeId, body.state);
  }

  /**
   * 转换设备命令
   */
  @Post('/protocol/convert/command')
  async convertCommand(@Body() body: {
    sourceProtocol: string;
    targetProtocol: string;
    command: any;
  }) {
    return await this.protocolConverter.convertCommand(
      body.sourceProtocol as any,
      body.targetProtocol as any,
      body.command
    );
  }
}
