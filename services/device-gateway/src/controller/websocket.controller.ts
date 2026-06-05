import { Controller, Inject, Get, Post, Body, Query } from '@midwayjs/core';
import { ApiOperation, ApiTags, ApiResponse, ApiQuery } from '@midwayjs/swagger';
import { WebsocketBridgeService } from '../service/mqtt/websocket-bridge.service';
import { ILogger } from '@midwayjs/logger';

/**
 * WebSocket 管理 API 控制器
 *
 * 注意：实际的 WebSocket 连接由 @midwayjs/socketio 处理
 * 这个控制器提供 WebSocket 相关的管理和监控 API
 *
 * 客户端连接方式：
 * ```javascript
 * import { io } from 'socket.io-client';
 *
 * const socket = io('http://localhost:6010', {
 *   transports: ['websocket'],
 * });
 *
 * // 订阅设备
 * socket.emit('subscribe:device', { deviceId: 'device-001' });
 *
 * // 接收设备消息
 * socket.on('device:message', (data) => {
 *   console.log('Device message:', data);
 * });
 *
 * // 发送命令
 * socket.emit('device:command', {
 *   deviceId: 'device-001',
 *   command: { action: 'setPower', params: { power: true } }
 * });
 * ```
 */
@ApiTags('WebSocket')
@Controller('/api/ws')
export class WebsocketController {
  @Inject()
  websocketBridge!: WebsocketBridgeService;

  @Inject()
  logger!: ILogger;

  /**
   * 获取 WebSocket 连接统计
   */
  @Get('/statistics')
  @ApiOperation({ summary: '获取WebSocket统计信息', description: '返回当前WebSocket连接和订阅的统计信息' })
  @ApiResponse({ status: 200, description: '成功获取统计信息' })
  async getStatistics() {
    const stats = this.websocketBridge.getStatistics();

    return {
      success: true,
      data: {
        ...stats,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * 获取订阅的设备列表
   */
  @Get('/devices')
  @ApiOperation({ summary: '获取订阅的设备列表', description: '返回当前有WebSocket客户端订阅的设备列表' })
  @ApiResponse({ status: 200, description: '成功获取设备列表' })
  async getSubscribedDevices() {
    const devices = this.websocketBridge.getSubscribedDevices();

    // 获取每个设备的订阅者数量
    const deviceDetails = devices.map(deviceId => ({
      deviceId,
      subscriberCount: this.websocketBridge.getDeviceSubscriberCount(deviceId),
    }));

    return {
      success: true,
      data: {
        total: devices.length,
        devices: deviceDetails,
      },
    };
  }

  /**
   * 获取设备的订阅者数量
   */
  @Get('/devices/:deviceId/subscribers')
  @ApiOperation({ summary: '获取设备订阅者数量', description: '返回指定设备的WebSocket订阅者数量' })
  @ApiQuery({ name: 'deviceId', description: '设备ID', type: String })
  @ApiResponse({ status: 200, description: '成功获取订阅者数量' })
  async getDeviceSubscribers(deviceId: string) {
    const count = this.websocketBridge.getDeviceSubscriberCount(deviceId);

    return {
      success: true,
      data: {
        deviceId,
        subscriberCount: count,
      },
    };
  }

  /**
   * 广播消息到设备订阅者
   *
   * 用于测试或管理目的，向订阅了指定设备的所有WebSocket客户端发送消息
   */
  @Post('/broadcast')
  @ApiOperation({ summary: '广播消息', description: '向订阅了指定设备的所有WebSocket客户端发送消息' })
  @ApiResponse({ status: 200, description: '消息已发送' })
  @ApiResponse({ status: 400, description: '参数错误' })
  async broadcastMessage(
    @Body() body: { deviceId: string; message: any }
  ) {
    if (!body.deviceId || !body.message) {
      return {
        success: false,
        error: 'Missing deviceId or message',
      };
    }

    const subscriberCount = this.websocketBridge.getDeviceSubscriberCount(body.deviceId);

    if (subscriberCount === 0) {
      return {
        success: true,
        message: 'No subscribers for this device',
        data: { deviceId: body.deviceId, deliveredCount: 0 },
      };
    }

    await this.websocketBridge.broadcastToDeviceClients(body.deviceId, body.message);

    return {
      success: true,
      message: 'Message broadcasted successfully',
      data: {
        deviceId: body.deviceId,
        deliveredCount: subscriberCount,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * 获取 WebSocket 连接信息
   */
  @Get('/info')
  @ApiOperation({ summary: '获取WebSocket服务信息', description: '返回WebSocket服务的配置和状态信息' })
  @ApiResponse({ status: 200, description: '成功获取服务信息' })
  async getServiceInfo() {
    return {
      success: true,
      data: {
        endpoint: '/socket.io',
        transports: ['websocket', 'polling'],
        events: {
          // 客户端发送的事件
          clientToServer: [
            { event: 'subscribe:device', description: '订阅设备消息', params: '{ deviceId: string }' },
            { event: 'unsubscribe:device', description: '取消订阅设备', params: '{ deviceId: string }' },
            { event: 'device:command', description: '发送设备命令', params: '{ deviceId: string, command: any }' },
          ],
          // 服务端发送的事件
          serverToClient: [
            { event: 'connected', description: '连接成功确认' },
            { event: 'subscribed', description: '订阅成功确认' },
            { event: 'unsubscribed', description: '取消订阅确认' },
            { event: 'device:message', description: '设备消息' },
            { event: 'command:sent', description: '命令发送确认' },
            { event: 'command:error', description: '命令发送失败' },
          ],
        },
        statistics: this.websocketBridge.getStatistics(),
      },
    };
  }

  /**
   * 健康检查
   */
  @Get('/health')
  @ApiOperation({ summary: 'WebSocket服务健康检查', description: '检查WebSocket服务是否正常运行' })
  @ApiResponse({ status: 200, description: '服务正常' })
  async healthCheck() {
    const stats = this.websocketBridge.getStatistics();

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      connections: stats.totalConnections,
    };
  }
}
