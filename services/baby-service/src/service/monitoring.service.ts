import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, Between } from 'typeorm';
import { MonitoringEvent } from '../entity/monitoring-event.entity';
import { MonitoringEventType, MonitoringEventLevel } from '@baby-monitor/shared-types';
import { JsonUtil } from '@baby-monitor/shared-utils';
import { PaginationParams, PaginatedResponse } from '@baby-monitor/shared-types';
import { NotificationService, NotificationType, NotificationPriority, NotificationChannel } from '@baby-monitor/shared-utils';

/**
 * 监控事件服务类
 *
 * 负责宝宝监控事件的管理，包括：
 * - 监控事件的创建、查询和确认
 * - AI检测事件的接收和处理
 * - 事件统计分析
 * - 通知发送
 */
@Provide()
export class MonitoringService {
  @InjectEntityModel(MonitoringEvent)
  monitoringEventRepository!: Repository<MonitoringEvent>;

  @Inject()
  notificationService!: NotificationService;

  /**
   * 创建监控事件
   *
   * 创建一条新的监控事件记录
   * 创建后会自动发送实时通知
   *
   * @param data - 监控事件数据（宝宝ID、设备ID、事件类型、级别等）
   * @returns 创建的监控事件对象
   */
  async createEvent(data: Partial<MonitoringEvent>): Promise<MonitoringEvent> {
    // 创建监控事件实体
    const event = this.monitoringEventRepository.create(data);
    // 保存到数据库
    await this.monitoringEventRepository.save(event);

    // 发送实时通知
    await this.sendNotification(event);

    return event;
  }

  /**
   * AI分析回调 - 从设备服务接收检测事件
   *
   * 处理来自设备服务的AI检测结果
   * 根据事件类型和严重程度自动确定告警级别
   * 告警级别包括：INFO（信息）、WARNING（警告）、ALERT（告警）、EMERGENCY（紧急）
   *
   * @param deviceId - 设备ID
   * @param babyId - 宝宝ID
   * @param eventType - 监控事件类型
   * @param data - 事件详细数据
   */
  async handleDetectionEvent(deviceId: string, babyId: string, eventType: MonitoringEventType, data: any): Promise<void> {
    let level = MonitoringEventLevel.INFO;

    // 根据事件类型和内容确定告警级别
    switch (eventType) {
      case MonitoringEventType.CRYING_DETECTED:
        // 哭声检测：持续超过5分钟则为告警级别，否则为警告
        level = data.duration > 300 ? MonitoringEventLevel.ALERT : MonitoringEventLevel.WARNING;
        break;
      case MonitoringEventType.NO_FACE_DETECTED:
        // 未检测到人脸：警告级别
        level = MonitoringEventLevel.WARNING;
        break;
      case MonitoringEventType.AREA_LEFT:
        // 离开监控区域：告警级别
        level = MonitoringEventLevel.ALERT;
        break;
      case MonitoringEventType.TEMPERATURE_ALERT:
        // 温度异常：紧急级别
        level = MonitoringEventLevel.EMERGENCY;
        break;
    }

    // 创建监控事件
    await this.createEvent({
      babyId,
      deviceId,
      type: eventType,
      level,
      timestamp: new Date(),
      data,
    });
  }

  /**
   * 获取监控事件列表
   *
   * 分页获取指定宝宝的监控事件
   * 支持按日期范围筛选和确认状态筛选
   *
   * @param babyId - 宝宝ID
   * @param pagination - 分页参数（页码、每页数量、排序字段、排序方向）
   * @param startDate - 开始日期，可选
   * @param endDate - 结束日期，可选
   * @param acknowledged - 确认状态筛选，可选
   * @returns 分页的监控事件列表
   */
  async getEvents(
    babyId: string,
    pagination: PaginationParams,
    startDate?: Date,
    endDate?: Date,
    acknowledged?: boolean
  ): Promise<PaginatedResponse<MonitoringEvent>> {
    // 解构分页参数，设置默认排序
    const { page, pageSize, sortBy = 'timestamp', sortOrder = 'desc' } = pagination;

    // 构建查询条件
    let where: any = { babyId };
    // 如果提供了日期范围，添加时间筛选
    if (startDate && endDate) {
      where.timestamp = Between(startDate, endDate);
    }
    // 如果提供了确认状态，添加确认状态筛选
    if (acknowledged !== undefined) {
      where.acknowledged = acknowledged;
    }

    // 查询数据
    const [items, total] = await this.monitoringEventRepository.findAndCount({
      where,
      order: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // 返回分页结果
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取未确认的事件
   *
   * 获取指定宝宝所有未确认的监控事件
   * 用于通知提醒，最多返回100条
   *
   * @param babyId - 宝宝ID
   * @returns 未确认的监控事件列表
   */
  async getUnacknowledgedEvents(babyId: string): Promise<MonitoringEvent[]> {
    return this.monitoringEventRepository.find({
      where: {
        babyId,
        acknowledged: false, // 只查询未确认的事件
      } as any,
      order: { timestamp: 'DESC' }, // 按时间倒序
      take: 100, // 最多返回100条
    });
  }

  /**
   * 确认事件
   *
   * 将监控事件标记为已确认，记录确认人和确认时间
   * 可选添加备注说明
   *
   * @param eventId - 监控事件ID
   * @param userId - 确认人ID
   * @param notes - 备注说明，可选
   * @returns 更新后的监控事件对象，如果事件不存在则返回null
   */
  async acknowledgeEvent(eventId: string, userId: string, notes?: string): Promise<MonitoringEvent | null> {
    // 查找监控事件
    const event = await this.monitoringEventRepository.findOne({ where: { id: eventId } as any });
    if (!event) {
      return null;
    }

    // 更新确认信息
    event.acknowledged = true;
    event.acknowledgedBy = userId;
    event.acknowledgedAt = new Date();
    if (notes) event.notes = notes;

    // 保存更新
    await this.monitoringEventRepository.save(event);
    return event;
  }

  /**
   * 获取事件统计
   *
   * 获取指定时间范围内的事件统计数据，包括：
   * - 总事件数
   * - 按类型分组统计
   * - 按级别分组统计
   * - 未确认事件数
   *
   * @param babyId - 宝宝ID
   * @param startDate - 开始日期
   * @param endDate - 结束日期
   * @returns 事件统计数据
   */
  async getEventStats(babyId: string, startDate: Date, endDate: Date): Promise<{
    total: number;
    byType: Record<string, number>;
    byLevel: Record<string, number>;
    unacknowledged: number;
  }> {
    // 查询指定时间范围内的所有事件
    const events = await this.monitoringEventRepository.find({
      where: {
        babyId,
        timestamp: Between(startDate, endDate),
      } as any,
    });

    // 初始化统计对象
    const byType: Record<string, number> = {};
    const byLevel: Record<string, number> = {};
    let unacknowledged = 0;

    // 遍历事件进行统计
    for (const event of events) {
      // 按类型统计
      byType[event.type] = (byType[event.type] || 0) + 1;
      // 按级别统计
      byLevel[event.level] = (byLevel[event.level] || 0) + 1;
      // 统计未确认事件
      if (!event.acknowledged) unacknowledged++;
    }

    // 返回统计结果
    return {
      total: events.length,
      byType,
      byLevel,
      unacknowledged,
    };
  }

  /**
   * 发送通知
   *
   * 根据监控事件的告警级别发送不同类型的通知
   * 通知方式包括：WebSocket、推送通知、短信等
   *
   * @param event - 监控事件对象
   * @private
   */
  private async sendNotification(event: MonitoringEvent): Promise<void> {
    // 根据告警级别映射到通知优先级
    const priorityMap: Record<MonitoringEventLevel, NotificationPriority> = {
      [MonitoringEventLevel.INFO]: NotificationPriority.NORMAL,
      [MonitoringEventLevel.WARNING]: NotificationPriority.HIGH,
      [MonitoringEventLevel.ALERT]: NotificationPriority.URGENT,
      [MonitoringEventLevel.EMERGENCY]: NotificationPriority.URGENT,
    };

    // 根据事件类型映射到通知类型
    const notificationTypeMap: Record<MonitoringEventType, NotificationType> = {
      [MonitoringEventType.CRYING_DETECTED]: NotificationType.BABY_CRYING,
      [MonitoringEventType.MOTION_DETECTED]: NotificationType.BABY_MOTION,
      [MonitoringEventType.FACE_DETECTED]: NotificationType.BABY_FACE,
      [MonitoringEventType.NO_FACE_DETECTED]: NotificationType.BABY_FACE,
      [MonitoringEventType.NOISE_DETECTED]: NotificationType.BABY_MOTION,
      [MonitoringEventType.TEMPERATURE_ALERT]: NotificationType.TEMPERATURE_ALERT,
      [MonitoringEventType.HUMIDITY_ALERT]: NotificationType.HUMIDITY_ALERT,
      [MonitoringEventType.AREA_LEFT]: NotificationType.BABY_MOTION,
      [MonitoringEventType.SLEEP_STATE_CHANGE]: NotificationType.SLEEP_STATE_CHANGE,
    };

    // 根据优先级决定通知渠道
    const channels = priorityMap[event.level] === NotificationPriority.URGENT
      ? [NotificationChannel.WEBSOCKET, NotificationChannel.SMS, NotificationChannel.PUSH]
      : [NotificationChannel.WEBSOCKET, NotificationChannel.PUSH];

    // 构建通知数据
    const notificationData = {
      deviceId: event.deviceId,
      eventLevel: event.level,
      eventData: event.data,
    };

    // 发送通知
    await this.notificationService.send({
      type: notificationTypeMap[event.type],
      title: this.getEventTitle(event),
      content: this.getEventMessage(event),
      priority: priorityMap[event.level],
      channels,
      data: notificationData,
      targetUsers: [event.babyId], // 这里应该是宝宝对应的家长用户ID
    });
  }

  /**
   * 生成事件标题
   *
   * @param event - 监控事件对象
   * @returns 事件标题
   * @private
   */
  private getEventTitle(event: MonitoringEvent): string {
    const titles: Record<MonitoringEventType, string> = {
      [MonitoringEventType.CRYING_DETECTED]: '🔔 宝宝哭声提醒',
      [MonitoringEventType.MOTION_DETECTED]: '👶 宝宝活动提醒',
      [MonitoringEventType.FACE_DETECTED]: '😊 人脸检测提醒',
      [MonitoringEventType.NO_FACE_DETECTED]: '⚠️ 未检测到人脸',
      [MonitoringEventType.NOISE_DETECTED]: '🔊 异常噪音提醒',
      [MonitoringEventType.TEMPERATURE_ALERT]: '🌡️ 温度异常告警',
      [MonitoringEventType.HUMIDITY_ALERT]: '💧 湿度异常告警',
      [MonitoringEventType.AREA_LEFT]: '🚨 离开监控区域告警',
      [MonitoringEventType.SLEEP_STATE_CHANGE]: '😴 睡眠状态变化',
    };

    return titles[event.type] || '监控事件提醒';
  }

  /**
   * 生成事件消息
   *
   * 根据监控事件类型生成对应的中文描述消息
   * 用于通知和显示
   *
   * @param event - 监控事件对象
   * @returns 事件描述消息
   * @private
   */
  private getEventMessage(event: MonitoringEvent): string {
    // 事件类型与中文描述的映射表
    const messages: Record<MonitoringEventType, string> = {
      [MonitoringEventType.CRYING_DETECTED]: '检测到宝宝哭声',
      [MonitoringEventType.MOTION_DETECTED]: '检测到宝宝移动',
      [MonitoringEventType.FACE_DETECTED]: '检测到人脸',
      [MonitoringEventType.NO_FACE_DETECTED]: '未检测到人脸',
      [MonitoringEventType.NOISE_DETECTED]: '检测到异常噪音',
      [MonitoringEventType.TEMPERATURE_ALERT]: '温度异常告警',
      [MonitoringEventType.HUMIDITY_ALERT]: '湿度异常告警',
      [MonitoringEventType.AREA_LEFT]: '宝宝离开监控区域',
      [MonitoringEventType.SLEEP_STATE_CHANGE]: '睡眠状态变化',
    };

    return messages[event.type] || '未知事件';
  }
}
