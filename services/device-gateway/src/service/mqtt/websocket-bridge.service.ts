import { Provide, Inject, Scope, ScopeEnum, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { Socket } from 'socket.io';
import { GatewayCoreService } from '../core/gateway-core.service';

/**
 * WebSocket桥接服务
 *
 * 在WebSocket客户端和MQTT设备之间建立桥接
 * 允许前端应用直接与设备通信
 *
 * 职责：
 * - 管理WebSocket连接
 * - 订阅设备MQTT主题
 * - 转发设备消息到WebSocket客户端
 * - 将WebSocket客户端命令转发到设备
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class WebsocketBridgeService {
  @Inject()
  logger!: ILogger;

  @Inject()
  gatewayCore?: GatewayCoreService;

  // 客户端连接映射: deviceId -> Set<socketId>
  private readonly deviceClients = new Map<string, Set<string>>();

  // Socket映射: socketId -> Socket
  private readonly sockets = new Map<string, Socket>();

  /**
   * 初始化
   */
  @Init()
  async init(): Promise<void> {
    this.logger.info('[WebSocket Bridge] Service initialized');
  }

  /**
   * 处理WebSocket客户端连接
   */
  async handleConnection(socket: Socket): Promise<void> {
    const socketId = socket.id;
    this.sockets.set(socketId, socket);

    this.logger.info(`[WebSocket Bridge] Client connected: ${socketId}`);

    // 处理订阅设备
    socket.on('subscribe:device', async (data: { deviceId: string }) => {
      await this.handleSubscribeDevice(socketId, data.deviceId);
    });

    // 处理取消订阅设备
    socket.on('unsubscribe:device', async (data: { deviceId: string }) => {
      await this.handleUnsubscribeDevice(socketId, data.deviceId);
    });

    // 处理发送设备命令
    socket.on('device:command', async (data: { deviceId: string; command: any }) => {
      await this.handleDeviceCommand(socketId, data.deviceId, data.command);
    });

    // 处理断开连接
    socket.on('disconnecting', () => {
      this.handleDisconnection(socketId);
    });

    socket.on('disconnect', () => {
      this.handleDisconnection(socketId);
    });

    // 发送欢迎消息
    socket.emit('connected', {
      socketId,
      timestamp: Date.now(),
      message: 'Connected to Device Gateway',
    });
  }

  /**
   * 处理订阅设备
   */
  private async handleSubscribeDevice(socketId: string, deviceId: string): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }

    // 添加到设备客户端映射
    if (!this.deviceClients.has(deviceId)) {
      this.deviceClients.set(deviceId, new Set());
    }
    this.deviceClients.get(deviceId)!.add(socketId);

    // 订阅MQTT主题
    const mqttClient = this.gatewayCore?.['mqttClientService']?.getClient();
    if (mqttClient) {
      mqttClient.subscribe(`devices/${deviceId}/#`, { qos: 1 });
      this.logger.info(`[WebSocket Bridge] Socket ${socketId} subscribed to device ${deviceId}`);
    }

    // 发送订阅成功确认
    socket.emit('subscribed', {
      deviceId,
      timestamp: Date.now(),
    });
  }

  /**
   * 处理取消订阅设备
   */
  private async handleUnsubscribeDevice(socketId: string, deviceId: string): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }

    // 从设备客户端映射移除
    const clients = this.deviceClients.get(deviceId);
    if (clients) {
      clients.delete(socketId);

      // 如果没有客户端订阅该设备，取消MQTT订阅
      if (clients.size === 0) {
        this.deviceClients.delete(deviceId);
        const mqttClient = this.gatewayCore?.['mqttClientService']?.getClient();
        if (mqttClient) {
          mqttClient.unsubscribe(`devices/${deviceId}/#`);
        }
      }
    }

    this.logger.info(`[WebSocket Bridge] Socket ${socketId} unsubscribed from device ${deviceId}`);

    socket.emit('unsubscribed', {
      deviceId,
      timestamp: Date.now(),
    });
  }

  /**
   * 处理设备命令
   */
  private async handleDeviceCommand(socketId: string, deviceId: string, command: any): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }

    try {
      // 发布命令到设备
      const topic = `devices/${deviceId}/command`;
      if (this.gatewayCore) {
        await this.gatewayCore.publish(topic, JSON.stringify(command), 1);
        this.logger.info(`[WebSocket Bridge] Command sent to device ${deviceId} from socket ${socketId}`);
      }

      // 发送命令发送确认
      socket.emit('command:sent', {
        deviceId,
        command,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error('[WebSocket Bridge] Failed to send command:', error);

      socket.emit('command:error', {
        deviceId,
        error: 'Failed to send command',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 处理客户端断开连接
   */
  private handleDisconnection(socketId: string): void {
    this.logger.info(`[WebSocket Bridge] Client disconnected: ${socketId}`);

    // 从所有设备订阅中移除
    for (const [deviceId, clients] of this.deviceClients.entries()) {
      clients.delete(socketId);

      // 如果没有客户端订阅该设备，取消MQTT订阅
      if (clients.size === 0) {
        this.deviceClients.delete(deviceId);
        const mqttClient = this.gatewayCore?.['mqttClientService']?.getClient();
        if (mqttClient) {
          mqttClient.unsubscribe(`devices/${deviceId}/#`);
        }
      }
    }

    // 移除socket
    this.sockets.delete(socketId);
  }

  /**
   * 广播设备消息到订阅的WebSocket客户端
   */
  async broadcastToDeviceClients(deviceId: string, message: any): Promise<void> {
    const clients = this.deviceClients.get(deviceId);
    if (!clients || clients.size === 0) {
      return;
    }

    for (const socketId of clients) {
      const socket = this.sockets.get(socketId);
      if (socket && socket.connected) {
        socket.emit('device:message', {
          deviceId,
          message,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * 获取连接统计
   */
  getStatistics(): {
    totalConnections: number;
    totalSubscriptions: number;
    devices: number;
  } {
    let totalSubscriptions = 0;
    for (const clients of this.deviceClients.values()) {
      totalSubscriptions += clients.size;
    }

    return {
      totalConnections: this.sockets.size,
      totalSubscriptions,
      devices: this.deviceClients.size,
    };
  }

  /**
   * 获取设备的订阅者数量
   */
  getDeviceSubscriberCount(deviceId: string): number {
    return this.deviceClients.get(deviceId)?.size || 0;
  }

  /**
   * 获取所有在线设备ID
   */
  getSubscribedDevices(): string[] {
    return Array.from(this.deviceClients.keys());
  }
}
