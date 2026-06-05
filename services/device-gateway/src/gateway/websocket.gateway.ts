import { WSController, OnWSConnection, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/socketio';
import { WebsocketBridgeService } from '../service/mqtt/websocket-bridge.service';

/**
 * WebSocket 网关
 *
 * 处理 WebSocket 客户端连接和消息
 * 桥接 WebSocket 客户端与 MQTT 设备
 *
 * 客户端使用方式：
 * ```javascript
 * import { io } from 'socket.io-client';
 *
 * const socket = io('http://localhost:6010', {
 *   transports: ['websocket'],
 *   path: '/socket.io/',
 * });
 *
 * // 连接成功
 * socket.on('connected', (data) => {
 *   console.log('Connected:', data);
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
 *
 * // 接收订阅确认
 * socket.on('subscribed', (data) => {
 *   console.log('Subscribed:', data);
 * });
 * ```
 */
@WSController('/')
export class WebsocketGateway {
  @Inject()
  ctx!: Context;

  @Inject()
  websocketBridge!: WebsocketBridgeService;

  /**
   * 处理客户端连接
   *
   * 所有事件处理（订阅、取消订阅、命令）由 WebsocketBridgeService 内部管理
   */
  @OnWSConnection()
  async onConnection(): Promise<void> {
    // Context 类型扩展了 Socket，可以直接传递给 service
    await this.websocketBridge.handleConnection(this.ctx as any);
  }
}
