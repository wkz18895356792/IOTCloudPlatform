import { Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { JsonUtil } from '@baby-monitor/shared-utils';
import { BaseSubscriber, SubscriptionConfig } from '@baby-monitor/shared-utils';
import { Device, DeviceStatus } from '../entity/device.entity';

/**
 * 设备状态更新订阅器
 *
 * 监听 MQTT Gateway 发送的设备状态更新通知
 *
 * 订阅频道：
 * - device:status:update - 设备状态更新通知
 *
 * 主要功能：
 * - 接收设备上线/离线事件
 * - 更新数据库中的设备状态
 * - 发布设备状态变更事件
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class DeviceStatusSubscriber extends BaseSubscriber {
  // 设备数据仓储
  @InjectEntityModel(Device)
  deviceRepository!: Repository<Device>;

  /**
   * Redis频道
   * 订阅此频道以接收设备状态更新通知
   */
  private readonly STATUS_CHANNEL = 'device:status:update';

  /**
   * 获取订阅配置
   *
   * @returns 订阅配置对象
   */
  getSubscriptionConfig(): SubscriptionConfig {
    return {
      channels: [this.STATUS_CHANNEL],
    };
  }

  /**
   * 处理接收到的消息
   *
   * @param channel - 频道名称
   * @param message - 消息内容
   */
  async handleMessage(channel: string, message: string): Promise<void> {
    if (channel !== this.STATUS_CHANNEL) {
      return;
    }

    try {
      const parsed = JsonUtil.parse(message);
      if (!parsed || !parsed.type || !parsed.data) {
        this.logger.error('[DeviceStatusSubscriber] Invalid status update message');
        return;
      }

      const { type, data } = parsed;

      // 根据消息类型分发处理
      if (type === 'device.online') {
        await this.handleDeviceOnline(data);
      } else if (type === 'device.offline') {
        await this.handleDeviceOffline(data);
      }
    } catch (error) {
      this.logger.error('[DeviceStatusSubscriber] Error handling status update:', error);
    }
  }

  /**
   * 处理设备上线
   *
   * @param data - 上线事件数据
   * @param data.deviceId - 设备ID
   * @param data.timestamp - 上线时间戳
   * @param data.reason - 上线原因
   *
   * 功能说明：
   * - 更新设备状态为在线
   * - 更新最后在线时间
   */
  private async handleDeviceOnline(data: any): Promise<void> {
    const { deviceId, timestamp, reason } = data;

    try {
      this.logger.debug(`[DeviceStatusSubscriber] Device online: ${deviceId}, reason: ${reason}`);

      // 查找并更新设备状态
      const device = await this.deviceRepository.findOne({
        where: { serialNumber: deviceId },
      });

      if (device) {
        device.status = DeviceStatus.ONLINE;
        device.lastOnline = new Date();
        await this.deviceRepository.save(device);

        this.logger.debug(`[DeviceStatusSubscriber] Updated device ${device.id} to ONLINE`);
      } else {
        this.logger.warn(`[DeviceStatusSubscriber] Device not found: ${deviceId}`);
      }
    } catch (error) {
      this.logger.error(`[DeviceStatusSubscriber] Error handling device online for ${deviceId}:`, error);
    }
  }

  /**
   * 处理设备离线
   *
   * @param data - 离线事件数据
   * @param data.deviceId - 设备ID
   * @param data.timestamp - 离线时间戳
   * @param data.reason - 离线原因
   *
   * 功能说明：
   * - 更新设备状态为离线
   * - 更新最后在线时间
   * - 发布设备离线事件
   */
  private async handleDeviceOffline(data: any): Promise<void> {
    const { deviceId, timestamp, reason } = data;

    try {
      this.logger.debug(`[DeviceStatusSubscriber] Device offline: ${deviceId}, reason: ${reason}`);

      // 查找并更新设备状态
      const device = await this.deviceRepository.findOne({
        where: { serialNumber: deviceId },
      });

      if (device) {
        device.status = DeviceStatus.OFFLINE;
        device.lastOnline = new Date();
        await this.deviceRepository.save(device);

        this.logger.debug(`[DeviceStatusSubscriber] Updated device ${device.id} to OFFLINE`);

        // 发布设备事件（可选）
        await this.publishDeviceEvent(device.id, 'offline', { reason });
      } else {
        this.logger.warn(`[DeviceStatusSubscriber] Device not found: ${deviceId}`);
      }
    } catch (error) {
      this.logger.error(`[DeviceStatusSubscriber] Error handling device offline for ${deviceId}:`, error);
    }
  }

  /**
   * 发布设备事件
   *
   * @param deviceId - 设备ID
   * @param eventType - 事件类型
   * @param data - 事件数据
   *
   * 功能说明：
   * - 将设备状态变更事件发布到Redis
   * - 其他服务可以订阅此频道获取设备状态变更通知
   */
  private async publishDeviceEvent(deviceId: string, eventType: string, data: any): Promise<void> {
    try {
      const event = {
        type: 'device.event',
        data: {
          deviceId,
          eventType,
          eventData: data,
          timestamp: Date.now(),
        },
      };

      // 使用基类的 publish 方法
      await this.publish('device:event', event);
    } catch (error) {
      this.logger.error('[DeviceStatusSubscriber] Error publishing device event:', error);
    }
  }
}
