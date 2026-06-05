import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, Between } from 'typeorm';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { DeviceEvent } from '../entity/device-event.entity';
import { DeviceAlert } from '../entity/device-alert.entity';
import { MaintenanceRecord } from '../entity/maintenance-record.entity';
import { Device } from '../entity/device.entity';
import { DeviceStatistics, DeviceEventType, DeviceAlertLevel } from '@baby-monitor/shared-types';
import { JsonUtil, NotificationService, NotificationType, NotificationChannel, NotificationPriority } from '@baby-monitor/shared-utils';

/**
 * 设备统计和分析服务
 *
 * 提供设备统计数据、事件记录、告警管理、维保记录等功能
 *
 * 主要功能：
 * - 设备运行数据统计（在线率、响应时间、命令数量等）
 * - 设备事件历史记录和查询
 * - 设备告警创建、确认和查询
 * - 维保记录管理
 * - 设备健康报告生成
 * - 设备使用趋势分析
 */
@Provide()
export class DeviceAnalyticsService {
  // 注入日志记录器
  @Inject()
  logger!: ILogger;

  // 注入Redis服务，用于缓存统计数据
  @Inject()
  redis!: RedisService;

  // 注入通知服务
  @Inject()
  notificationService!: NotificationService;

  // 设备事件数据仓储
  @InjectEntityModel(DeviceEvent)
  deviceEventRepository!: Repository<DeviceEvent>;

  // 设备告警数据仓储
  @InjectEntityModel(DeviceAlert)
  deviceAlertRepository!: Repository<DeviceAlert>;

  // 维保记录数据仓储
  @InjectEntityModel(MaintenanceRecord)
  maintenanceRecordRepository!: Repository<MaintenanceRecord>;

  // 设备数据仓储
  @InjectEntityModel(Device)
  deviceRepository!: Repository<Device>;

  // 统计缓存TTL（1小时）
  private readonly STATS_CACHE_TTL = 3600;

  /**
   * 获取设备统计
   */
  async getDeviceStatistics(deviceId: string): Promise<DeviceStatistics> {
    // 先尝试从缓存获取
    const cacheKey = `device:stats:${deviceId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JsonUtil.parse<DeviceStatistics>(cached);
      if (parsed) return parsed;
    }

    // 计算统计数据
    const stats = await this.calculateDeviceStatistics(deviceId);

    // 缓存结果
    await this.redis.setex(cacheKey, this.STATS_CACHE_TTL, JsonUtil.stringify(stats));

    return stats;
  }

  /**
   * 计算设备统计数据
   */
  private async calculateDeviceStatistics(deviceId: string): Promise<DeviceStatistics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 获取设备信息
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId } as any,
    });

    if (!device) {
      throw new Error('Device not found');
    }

    // 获取最近30天的事件
    const recentEvents = await this.deviceEventRepository.find({
      where: {
        deviceId,
        createdAt: Between(thirtyDaysAgo, now) as any,
      },
    });

    // 计算在线率
    const onlineEvents = recentEvents.filter(e => e.type === DeviceEventType.ONLINE);
    const offlineEvents = recentEvents.filter(e => e.type === DeviceEventType.OFFLINE);
    const totalOnlineTime = this.calculateTotalOnlineTime(onlineEvents, offlineEvents);
    const onlineRate = Math.min(100, (totalOnlineTime / (30 * 24 * 60 * 60 * 1000)) * 100);

    // 计算命令数量
    const commandEvents = recentEvents.filter(e => e.type === DeviceEventType.COMMAND);
    const commandCount = commandEvents.length;

    // 计算错误数量
    const errorEvents = recentEvents.filter(e => e.type === DeviceEventType.ERROR);
    const errorCount = errorEvents.length;

    // 计算平均响应时间
    const responseTimes = commandEvents
      .map(e => e.data?.responseTime)
      .filter(t => t !== undefined);
    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    // 获取最后维保时间
    const lastMaintenance = await this.maintenanceRecordRepository.findOne({
      where: { deviceId } as any,
      order: { performedAt: 'DESC' },
    });

    // 获取固件更新次数
    const firmwareUpdates = recentEvents.filter(e => e.type === DeviceEventType.FIRMWARE_UPDATE);

    return {
      deviceId,
      totalUptime: Math.floor(totalOnlineTime / 1000 / 60), // 转换为分钟
      onlineRate: Math.round(onlineRate * 100) / 100,
      avgResponseTime: Math.round(avgResponseTime),
      commandCount,
      errorCount,
      lastMaintenanceAt: lastMaintenance?.performedAt,
      firmwareUpdateCount: firmwareUpdates.length,
    };
  }

  /**
   * 计算总在线时间
   */
  private calculateTotalOnlineTime(
    onlineEvents: DeviceEvent[],
    offlineEvents: DeviceEvent[]
  ): number {
    // 简化计算：每次上线到下线的时间差
    let totalOnlineTime = 0;

    for (const onlineEvent of onlineEvents) {
      // 找到该上线事件之后的最近下线事件
      const nextOffline = offlineEvents.find(
        e => e.createdAt! > onlineEvent.createdAt!
      );

      if (nextOffline) {
        totalOnlineTime += nextOffline.createdAt!.getTime() - onlineEvent.createdAt!.getTime();
      } else {
        // 如果没有下线事件，说明还在在线
        totalOnlineTime += Date.now() - onlineEvent.createdAt!.getTime();
      }
    }

    return totalOnlineTime;
  }

  /**
   * 获取设备事件历史
   */
  async getDeviceEvents(
    deviceId: string,
    eventType?: DeviceEventType,
    startTime?: Date,
    endTime?: Date,
    limit: number = 100
  ): Promise<DeviceEvent[]> {
    const where: any = { deviceId };
    if (eventType) {
      where.type = eventType;
    }
    if (startTime && endTime) {
      where.createdAt = Between(startTime, endTime);
    }

    return this.deviceEventRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 记录设备事件
   */
  async logDeviceEvent(
    deviceId: string,
    type: DeviceEventType,
    data?: Record<string, any>,
    userId?: string
  ): Promise<void> {
    const event = this.deviceEventRepository.create({
      deviceId,
      type,
      data,
      userId,
    });

    await this.deviceEventRepository.save(event);

    // 清除统计缓存
    await this.clearStatisticsCache(deviceId);

    // 根据事件类型创建告警
    if (this.shouldCreateAlert(type, data)) {
      await this.createDeviceAlert(deviceId, type, data);
    }

    this.logger.debug(`[DeviceAnalyticsService] Event logged for device ${deviceId}: ${type}`);
  }

  /**
   * 批量记录设备事件
   */
  async logDeviceEvents(events: Array<{
    deviceId: string;
    type: DeviceEventType;
    data?: Record<string, any>;
    userId?: string;
  }>): Promise<void> {
    const eventEntities = events.map(e =>
      this.deviceEventRepository.create({
        deviceId: e.deviceId,
        type: e.type,
        data: e.data,
        userId: e.userId,
      })
    );

    await this.deviceEventRepository.save(eventEntities);

    // 清除所有相关设备的统计缓存
    const uniqueDeviceIds = new Set(events.map(e => e.deviceId));
    for (const deviceId of uniqueDeviceIds) {
      await this.clearStatisticsCache(deviceId);
    }

    console.log(`[DeviceAnalyticsService] Batch logged ${events.length} events`);
  }

  /**
   * 获取设备告警列表
   */
  async getDeviceAlerts(
    deviceId: string,
    acknowledged?: boolean,
    level?: DeviceAlertLevel,
    limit: number = 50
  ): Promise<DeviceAlert[]> {
    const where: any = { deviceId };
    if (acknowledged !== undefined) {
      where.acknowledged = acknowledged;
    }
    if (level) {
      where.level = level;
    }

    return this.deviceAlertRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 获取用户的所有告警
   */
  async getUserAlerts(
    userId: string,
    acknowledged?: boolean,
    level?: DeviceAlertLevel,
    limit: number = 100
  ): Promise<DeviceAlert[]> {
    // 首先获取用户的所有设备ID
    const devices = await this.deviceRepository.find({
      where: { ownerId: userId } as any,
      select: ['id'],
    });

    const deviceIds = devices.map(d => d.id);

    if (deviceIds.length === 0) {
      return [];
    }

    const where: any = {};
    if (acknowledged !== undefined) {
      where.acknowledged = acknowledged;
    }
    if (level) {
      where.level = level;
    }

    return this.deviceAlertRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 确认告警
   */
  async acknowledgeAlert(alertId: string, userId: string): Promise<DeviceAlert | null> {
    await this.deviceAlertRepository.update(
      { id: alertId } as any,
      {
        acknowledged: true,
        acknowledgedBy: userId,
        acknowledgedAt: new Date(),
      } as any
    );

    return this.deviceAlertRepository.findOne({
      where: { id: alertId } as any,
    });
  }

  /**
   * 批量确认告警
   */
  async acknowledgeAlerts(alertIds: string[], userId: string): Promise<number> {
    await this.deviceAlertRepository.update(
      alertIds.map(id => ({ id } as any)),
      {
        acknowledged: true,
        acknowledgedBy: userId,
        acknowledgedAt: new Date(),
      } as any
    );

    return alertIds.length;
  }

  /**
   * 创建设备告警
   */
  private async createDeviceAlert(
    deviceId: string,
    type: string,
    data?: Record<string, any>
  ): Promise<void> {
    // 检查是否已存在未确认的相同类型告警（避免重复告警）
    const existingAlert = await this.deviceAlertRepository.findOne({
      where: {
        deviceId,
        type,
        acknowledged: false,
      } as any,
      order: { createdAt: 'DESC' },
    });

    // 如果1小时内已有相同告警，不重复创建
    if (existingAlert && existingAlert.createdAt) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      if (existingAlert.createdAt > oneHourAgo) {
        return;
      }
    }

    const level = this.getAlertLevel(type, data);

    const alert = this.deviceAlertRepository.create({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      deviceId,
      type,
      level,
      title: this.getAlertTitle(type, data),
      message: this.getAlertMessage(type, data),
      data,
      acknowledged: false,
    });

    await this.deviceAlertRepository.save(alert);

    // 发送告警通知
    await this.sendAlertNotification(alert);

    console.log(`[DeviceAnalyticsService] Alert created for device ${deviceId}: ${type}`);
  }

  /**
   * 发送告警通知
   */
  private async sendAlertNotification(alert: DeviceAlert): Promise<void> {
    // 确定通知优先级
    const priority = alert.level === DeviceAlertLevel.CRITICAL
      ? NotificationPriority.URGENT
      : alert.level === DeviceAlertLevel.ERROR
        ? NotificationPriority.HIGH
        : NotificationPriority.NORMAL;

    // 获取设备所有者（发送通知给设备所有者）
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: alert.deviceId } as any,
      select: ['ownerId', 'name'],
    });

    if (!device?.ownerId) {
      this.logger.warn(`[DeviceAnalyticsService] Device owner not found for ${alert.deviceId}`);
      return;
    }

    // 使用统一通知服务发送告警
    await this.notificationService.send({
      type: NotificationType.DEVICE_ALERT,
      title: alert.title,
      content: alert.message,
      priority,
      channels: [NotificationChannel.WEBSOCKET, NotificationChannel.EMAIL],
      targetUsers: [device.ownerId],
      data: {
        alertId: alert.id,
        deviceId: alert.deviceId,
        deviceName: device.name,
        level: alert.level,
        type: alert.type,
        acknowledged: alert.acknowledged,
      },
    });

    this.logger.debug(`[DeviceAnalyticsService] Alert notification sent: ${alert.id}`);
  }

  /**
   * 获取告警级别
   */
  private getAlertLevel(type: string, data?: Record<string, any>): DeviceAlertLevel {
    const criticalEvents = ['firmware_update_failed', 'device_malfunction', 'security_breach'];
    const errorEvents = ['offline', 'error', 'connection_lost'];
    const warningEvents = ['low_battery', 'high_temperature', 'storage_full'];

    if (criticalEvents.includes(type)) {
      return DeviceAlertLevel.CRITICAL;
    }

    if (errorEvents.includes(type)) {
      return DeviceAlertLevel.ERROR;
    }

    if (warningEvents.includes(type)) {
      return DeviceAlertLevel.WARNING;
    }

    return DeviceAlertLevel.INFO;
  }

  /**
   * 获取告警标题
   */
  private getAlertTitle(type: string, data?: Record<string, any>): string {
    const titles: Record<string, string> = {
      offline: '设备离线',
      error: '设备错误',
      firmware_update_failed: '固件升级失败',
      device_malfunction: '设备故障',
      low_battery: '电量低',
      high_temperature: '温度过高',
      storage_full: '存储空间不足',
      connection_lost: '连接丢失',
      security_breach: '安全警告',
    };

    return titles[type] || '设备告警';
  }

  /**
   * 获取告警消息
   */
  private getAlertMessage(type: string, data?: Record<string, any>): string {
    const title = this.getAlertTitle(type, data);

    if (data) {
      if (data.errorMessage) {
        return `${title}: ${data.errorMessage}`;
      }
      if (data.value !== undefined) {
        return `${title}: ${data.value}`;
      }
    }

    return title;
  }

  /**
   * 判断是否应该创建告警
   */
  private shouldCreateAlert(type: DeviceEventType, data?: Record<string, any>): boolean {
    const alertTypes = [
      DeviceEventType.ERROR,
      DeviceEventType.OFFLINE,
      DeviceEventType.FIRMWARE_UPDATE,
    ];

    return alertTypes.includes(type);
  }

  /**
   * 清除统计缓存
   */
  private async clearStatisticsCache(deviceId: string): Promise<void> {
    const cacheKey = `device:stats:${deviceId}`;
    await this.redis.del(cacheKey);
  }

  /**
   * 添加维保记录
   */
  async addMaintenanceRecord(data: {
    deviceId: string;
    type: string;
    title: string;
    description?: string;
    cost?: number;
    performedAt?: Date;
    performedBy?: string;
    nextMaintenanceAt?: Date;
    attachments?: string[];
  }): Promise<MaintenanceRecord> {
    const record = this.maintenanceRecordRepository.create({
      ...data,
    } as any);

    const savedRecord = await this.maintenanceRecordRepository.save(record);

    // 清除统计缓存
    await this.clearStatisticsCache(data.deviceId);

    console.log(`[DeviceAnalyticsService] Maintenance record added for device ${data.deviceId}`);
    return savedRecord as any;
  }

  /**
   * 获取设备的维保记录
   */
  async getMaintenanceRecords(
    deviceId: string,
    limit: number = 20
  ): Promise<MaintenanceRecord[]> {
    return this.maintenanceRecordRepository.find({
      where: { deviceId } as any,
      order: { performedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 更新维保记录
   */
  async updateMaintenanceRecord(
    recordId: string,
    updates: Partial<MaintenanceRecord>
  ): Promise<MaintenanceRecord | null> {
    await this.maintenanceRecordRepository.update(
      { id: recordId } as any,
      updates
    );

    const record = await this.maintenanceRecordRepository.findOne({
      where: { id: recordId } as any,
    });

    if (record) {
      await this.clearStatisticsCache(record.deviceId);
    }

    return record;
  }

  /**
   * 删除维保记录
   */
  async deleteMaintenanceRecord(recordId: string): Promise<boolean> {
    const record = await this.maintenanceRecordRepository.findOne({
      where: { id: recordId } as any,
    });

    if (!record) {
      return false;
    }

    const result = await this.maintenanceRecordRepository.delete({
      id: recordId,
    } as any);

    await this.clearStatisticsCache(record.deviceId);

    return (result.affected ?? 0) > 0;
  }

  /**
   * 获取即将到期的维保
   */
  async getUpcomingMaintenance(days: number = 7): Promise<Array<{
    deviceId: string;
    maintenance: MaintenanceRecord;
    deviceName: string;
  }>> {
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + days);

    const records = await this.maintenanceRecordRepository
      .createQueryBuilder('record')
      .where('record.nextMaintenanceAt BETWEEN :now AND :future', {
        now,
        future,
      })
      .orderBy('record.nextMaintenanceAt', 'ASC')
      .getMany();

    // 获取设备名称
    const deviceIds = records.map(r => r.deviceId);
    const devices = await this.deviceRepository.find({
      where: { id: { $in: deviceIds } } as any,
      select: ['id', 'name'],
    });

    const deviceMap = new Map(devices.map(d => [d.id, d.name]));

    return records.map(record => ({
      deviceId: record.deviceId,
      maintenance: record,
      deviceName: deviceMap.get(record.deviceId) || 'Unknown Device',
    }));
  }

  /**
   * 生成设备健康报告
   */
  async generateHealthReport(deviceId: string): Promise<{
    deviceId: string;
    healthScore: number;
    uptime: number;
    lastOnline: Date;
    recentErrors: number;
    recentAlerts: number;
    recommendations: string[];
  }> {
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 获取设备信息
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId } as any,
    });

    if (!device) {
      throw new Error('Device not found');
    }

    // 获取统计数据
    const stats = await this.getDeviceStatistics(deviceId);

    // 获取最近30天的事件
    const recentEvents = await this.getDeviceEvents(
      deviceId,
      undefined,
      thirtyDaysAgo,
      now
    );

    const errors = recentEvents.filter(e => e.type === DeviceEventType.ERROR);
    const alerts = await this.getDeviceAlerts(deviceId, false, undefined, 100);

    // 计算健康分数（0-100）
    let healthScore = 100;

    // 在线率影响（权重30%）
    healthScore -= (100 - stats.onlineRate) * 0.3;

    // 错误数量影响（权重30%）
    healthScore -= Math.min(errors.length * 3, 30);

    // 未确认告警影响（权重40%）
    healthScore -= Math.min(alerts.length * 5, 40);

    healthScore = Math.max(0, Math.min(100, healthScore));

    // 生成建议
    const recommendations: string[] = [];

    if (stats.onlineRate < 80) {
      recommendations.push('设备在线率较低，建议检查网络连接');
    }

    if (errors.length > 10) {
      recommendations.push('设备故障频繁，建议联系售后');
    }

    if (alerts.length > 5) {
      recommendations.push('存在多个未处理告警，请及时处理');
    }

    if (!stats.lastMaintenanceAt) {
      recommendations.push('设备尚无维保记录，建议定期维护');
    } else {
      const daysSinceLastMaintenance = Math.floor(
        (now.getTime() - stats.lastMaintenanceAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceLastMaintenance > 180) {
        recommendations.push('设备超过6个月未维护，建议安排维护');
      }
    }

    // 检查固件版本
    const deviceInfo = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId } as any,
      select: ['firmwareVersion', 'productId'],
    });

    if (deviceInfo?.productId && deviceInfo?.firmwareVersion) {
      // 从 Redis 缓存或配置服务获取最新固件版本
      const latestFirmwareKey = `product:${deviceInfo.productId}:latest-firmware`;
      const latestFirmware = await this.redis.get(latestFirmwareKey);

      if (latestFirmware && latestFirmware !== deviceInfo.firmwareVersion) {
        recommendations.push(`固件有新版本 (${latestFirmware})，建议更新`);
      }
    }

    return {
      deviceId,
      healthScore: Math.round(healthScore),
      uptime: stats.totalUptime,
      lastOnline: device.lastOnline || now,
      recentErrors: errors.length,
      recentAlerts: alerts.length,
      recommendations,
    };
  }

  /**
   * 获取设备使用趋势
   */
  async getDeviceUsageTrend(
    deviceId: string,
    days: number = 30
  ): Promise<Array<{
    date: Date;
    commandCount: number;
    errorCount: number;
    uptime: number;
  }>> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 获取时间段内所有事件
    const allEvents = await this.deviceEventRepository.find({
      where: {
        deviceId,
        createdAt: Between(startDate, endDate) as any,
      },
    });

    // 按天聚合数据
    const dailyData = new Map<string, {
      commandCount: number;
      errorCount: number;
      onlineEvents: Date[];
      offlineEvents: Date[];
    }>();

    // 初始化所有日期
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      dailyData.set(dateKey, {
        commandCount: 0,
        errorCount: 0,
        onlineEvents: [],
        offlineEvents: [],
      });
    }

    // 填充数据
    for (const event of allEvents) {
      if (!event.createdAt) continue;
      const dateKey = event.createdAt.toISOString().split('T')[0];
      const data = dailyData.get(dateKey);

      if (data) {
        if (event.type === DeviceEventType.COMMAND) {
          data.commandCount++;
        } else if (event.type === DeviceEventType.ERROR) {
          data.errorCount++;
        } else if (event.type === DeviceEventType.ONLINE) {
          data.onlineEvents.push(event.createdAt);
        } else if (event.type === DeviceEventType.OFFLINE) {
          data.offlineEvents.push(event.createdAt);
        }
      }
    }

    // 转换为结果格式
    const trend: Array<{
      date: Date;
      commandCount: number;
      errorCount: number;
      uptime: number;
    }> = [];

    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - i - 1));
      const dateKey = date.toISOString().split('T')[0];
      const data = dailyData.get(dateKey) || {
        commandCount: 0,
        errorCount: 0,
        onlineEvents: [],
        offlineEvents: [],
      };

      // 计算当天在线时间（简化处理）
      let uptime = 0;
      for (const online of data.onlineEvents) {
        const nextOffline = data.offlineEvents.find(o => o > online);
        if (nextOffline) {
          uptime += nextOffline.getTime() - online.getTime();
        } else {
          uptime += date.getTime() + 24 * 60 * 60 * 1000 - online.getTime();
        }
      }

      trend.push({
        date,
        commandCount: data.commandCount,
        errorCount: data.errorCount,
        uptime: Math.round(uptime / 1000 / 60), // 转换为分钟
      });
    }

    return trend;
  }

  /**
   * 获取多设备对比统计
   */
  async getDevicesComparison(deviceIds: string[]): Promise<Array<{
    deviceId: string;
    deviceName: string;
    healthScore: number;
    onlineRate: number;
    errorCount: number;
    commandCount: number;
  }>> {
    const comparison = [];

    for (const deviceId of deviceIds) {
      try {
        const stats = await this.getDeviceStatistics(deviceId);
        const device = await this.deviceRepository.findOne({
          where: { serialNumber: deviceId } as any,
          select: ['id', 'name'],
        });

        if (device) {
          // 计算健康分数
          let healthScore = 100;
          healthScore -= (100 - stats.onlineRate) * 0.3;
          healthScore -= Math.min(stats.errorCount * 3, 30);
          healthScore = Math.max(0, healthScore);

          comparison.push({
            deviceId,
            deviceName: device.name,
            healthScore: Math.round(healthScore),
            onlineRate: stats.onlineRate,
            errorCount: stats.errorCount,
            commandCount: stats.commandCount,
          });
        }
      } catch (error) {
        console.error(`[DeviceAnalyticsService] Error getting stats for device ${deviceId}:`, error);
      }
    }

    // 按健康分数排序
    comparison.sort((a, b) => b.healthScore - a.healthScore);

    return comparison;
  }
}
