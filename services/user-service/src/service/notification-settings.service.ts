import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { UserNotificationSettings, NotificationHistory, NotificationType } from '../entity/notification.entity';
import { IdGenerator } from '@baby-monitor/shared-utils';

/**
 * 通知设置服务
 *
 * 处理用户通知偏好配置和管理
 */
@Provide()
export class NotificationSettingsService {
  @Inject()
  logger!: ILogger;

  @InjectEntityModel(UserNotificationSettings)
  settingsRepository!: Repository<UserNotificationSettings>;

  @InjectEntityModel(NotificationHistory)
  historyRepository!: Repository<NotificationHistory>;

  /**
   * 获取用户通知设置
   */
  async getUserSettings(userId: string): Promise<UserNotificationSettings | null> {
    return await this.settingsRepository.findOne({
      where: { userId } as any,
    });
  }

  /**
   * 获取或创建用户通知设置
   */
  async getOrCreateSettings(userId: string): Promise<UserNotificationSettings> {
    let settings = await this.getUserSettings(userId);

    if (!settings) {
      settings = this.settingsRepository.create({
        id: IdGenerator.uuid(),
        userId,
        pushEnabled: true,
        cryingDetectionEnabled: true,
        cryingRecognitionEnabled: true,
        cryingTypesMask: 31, // 全部启用
        temperatureAlertEnabled: true,
        humidityAlertEnabled: true,
        autoSoothingEnabled: false,
        geofenceEnabled: false,
        vibrationEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await this.settingsRepository.save(settings);
    }

    return settings;
  }

  /**
   * 更新推送通知总开关
   */
  async updatePushEnabled(userId: string, enabled: boolean): Promise<UserNotificationSettings> {
    const settings = await this.getOrCreateSettings(userId);
    settings.pushEnabled = enabled;
    settings.updatedAt = new Date();
    return await this.settingsRepository.save(settings);
  }

  /**
   * 更新免打扰时间段
   */
  async updateDNDSettings(
    userId: string,
    dndStart: string | null,
    dndEnd: string | null
  ): Promise<UserNotificationSettings> {
    const settings = await this.getOrCreateSettings(userId);
    settings.dndStart = dndStart;
    settings.dndEnd = dndEnd;
    settings.updatedAt = new Date();
    return await this.settingsRepository.save(settings);
  }

  /**
   * 更新哭声检测通知设置
   */
  async updateCryingSettings(
    userId: string,
    detectionEnabled?: boolean,
    recognitionEnabled?: boolean,
    cryingTypesMask?: number
  ): Promise<UserNotificationSettings> {
    const settings = await this.getOrCreateSettings(userId);

    if (detectionEnabled !== undefined) {
      settings.cryingDetectionEnabled = detectionEnabled;
    }
    if (recognitionEnabled !== undefined) {
      settings.cryingRecognitionEnabled = recognitionEnabled;
    }
    if (cryingTypesMask !== undefined) {
      settings.cryingTypesMask = cryingTypesMask;
    }

    settings.updatedAt = new Date();
    return await this.settingsRepository.save(settings);
  }

  /**
   * 更新温湿度告警设置
   */
  async updateTempHumiditySettings(
    userId: string,
    tempAlertEnabled?: boolean,
    tempMin?: number,
    tempMax?: number,
    humidityAlertEnabled?: boolean,
    humidityMin?: number,
    humidityMax?: number
  ): Promise<UserNotificationSettings> {
    const settings = await this.getOrCreateSettings(userId);

    if (tempAlertEnabled !== undefined) {
      settings.temperatureAlertEnabled = tempAlertEnabled;
    }
    if (tempMin !== undefined) {
      settings.tempMin = tempMin;
    }
    if (tempMax !== undefined) {
      settings.tempMax = tempMax;
    }
    if (humidityAlertEnabled !== undefined) {
      settings.humidityAlertEnabled = humidityAlertEnabled;
    }
    if (humidityMin !== undefined) {
      settings.humidityMin = humidityMin;
    }
    if (humidityMax !== undefined) {
      settings.humidityMax = humidityMax;
    }

    settings.updatedAt = new Date();
    return await this.settingsRepository.save(settings);
  }

  /**
   * 更新自动安抚设置
   */
  async updateAutoSoothingSettings(
    userId: string,
    enabled: boolean,
    musicId?: string,
    maxDuration?: number
  ): Promise<UserNotificationSettings> {
    const settings = await this.getOrCreateSettings(userId);

    settings.autoSoothingEnabled = enabled;
    if (musicId !== undefined) {
      settings.autoSoothingMusicId = musicId;
    }
    if (maxDuration !== undefined) {
      settings.autoSoothingMaxDuration = maxDuration;
    }

    settings.updatedAt = new Date();
    return await this.settingsRepository.save(settings);
  }

  /**
   * 更新电子围栏设置
   */
  async updateGeofenceSettings(
    userId: string,
    enabled: boolean,
    radius?: number
  ): Promise<UserNotificationSettings> {
    const settings = await this.getOrCreateSettings(userId);

    settings.geofenceEnabled = enabled;
    if (radius !== undefined) {
      settings.geofenceRadius = radius;
    }

    settings.updatedAt = new Date();
    return await this.settingsRepository.save(settings);
  }

  /**
   * 更新通知铃声设置
   */
  async updateRingtoneSettings(
    userId: string,
    ringtoneId?: string,
    volume?: number,
    vibrationEnabled?: boolean
  ): Promise<UserNotificationSettings> {
    const settings = await this.getOrCreateSettings(userId);

    if (ringtoneId !== undefined) {
      settings.ringtoneId = ringtoneId;
    }
    if (volume !== undefined) {
      settings.ringtoneVolume = volume;
    }
    if (vibrationEnabled !== undefined) {
      settings.vibrationEnabled = vibrationEnabled;
    }

    settings.updatedAt = new Date();
    return await this.settingsRepository.save(settings);
  }

  /**
   * 获取通知历史
   */
  async getNotificationHistory(
    userId: string,
    options?: {
      type?: NotificationType;
      deviceId?: string;
      isRead?: boolean;
      limit?: number;
      offset?: number;
      startTime?: Date;
      endTime?: Date;
    }
  ): Promise<{ list: NotificationHistory[]; total: number }> {
    const queryBuilder = this.historyRepository.createQueryBuilder('history')
      .where('history.userId = :userId', { userId })
      .andWhere('history.isDeleted = :isDeleted', { isDeleted: false });

    if (options?.type) {
      queryBuilder.andWhere('history.type = :type', { type: options.type });
    }
    if (options?.deviceId) {
      queryBuilder.andWhere('history.deviceId = :deviceId', { deviceId: options.deviceId });
    }
    if (options?.isRead !== undefined) {
      queryBuilder.andWhere('history.isRead = :isRead', { isRead: options.isRead });
    }
    if (options?.startTime) {
      queryBuilder.andWhere('history.createdAt >= :startTime', { startTime: options.startTime });
    }
    if (options?.endTime) {
      queryBuilder.andWhere('history.createdAt <= :endTime', { endTime: options.endTime });
    }

    const total = await queryBuilder.getCount();

    queryBuilder
      .orderBy('history.createdAt', 'DESC')
      .limit(options?.limit || 50)
      .offset(options?.offset || 0);

    const list = await queryBuilder.getMany();

    return { list, total };
  }

  /**
   * 标记通知为已读
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await this.historyRepository.update(
      { id: notificationId, userId } as any,
      { isRead: true } as any
    );
  }

  /**
   * 批量标记通知为已读
   */
  async markMultipleAsRead(notificationIds: string[], userId: string): Promise<void> {
    await this.historyRepository.update(
      { id: { $in: notificationIds }, userId } as any,
      { isRead: true } as any
    );
  }

  /**
   * 标记所有通知为已读
   */
  async markAllAsRead(userId: string): Promise<void> {
    await this.historyRepository.update(
      { userId, isRead: false } as any,
      { isRead: true } as any
    );
  }

  /**
   * 确认通知
   */
  async acknowledgeNotification(notificationId: string, userId: string): Promise<void> {
    await this.historyRepository.update(
      { id: notificationId, userId } as any,
      { isAcknowledged: true, isRead: true } as any
    );
  }

  /**
   * 获取未读通知数量
   */
  async getUnreadCount(userId: string): Promise<number> {
    return await this.historyRepository.count({
      where: { userId, isRead: false, isDeleted: false } as any,
    });
  }

  /**
   * 清空通知历史
   */
  async clearHistory(userId: string, beforeDate?: Date): Promise<void> {
    const queryBuilder = this.historyRepository.createQueryBuilder()
      .where('userId = :userId', { userId });

    if (beforeDate) {
      queryBuilder.andWhere('createdAt < :beforeDate', { beforeDate });
    }

    await queryBuilder.delete().execute();
  }

  /**
   * 点赞通知（切换：点赞 ↔ 取消点赞）
   */
  async likeNotification(notificationId: string, userId: string): Promise<{
    likeStatus: 'liked' | 'none';
  }> {
    const notification = await this.historyRepository.findOne({
      where: { id: notificationId, userId, isDeleted: false } as any,
    });

    if (!notification) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }

    const newStatus = notification.likeStatus === 'liked' ? 'none' : 'liked';
    await this.historyRepository.update(
      { id: notificationId, userId } as any,
      { likeStatus: newStatus } as any
    );

    return { likeStatus: newStatus };
  }

  /**
   * 踩通知（切换：踩 ↔ 取消踩）
   */
  async dislikeNotification(notificationId: string, userId: string): Promise<{
    likeStatus: 'disliked' | 'none';
  }> {
    const notification = await this.historyRepository.findOne({
      where: { id: notificationId, userId, isDeleted: false } as any,
    });

    if (!notification) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }

    const newStatus = notification.likeStatus === 'disliked' ? 'none' : 'disliked';
    await this.historyRepository.update(
      { id: notificationId, userId } as any,
      { likeStatus: newStatus } as any
    );

    return { likeStatus: newStatus };
  }

  /**
   * 提交哭声识别反馈
   */
  async submitNotificationFeedback(
    notificationId: string,
    userId: string,
    feedbackType: string,
    feedbackText?: string
  ): Promise<void> {
    const notification = await this.historyRepository.findOne({
      where: { id: notificationId, userId, isDeleted: false } as any,
    });

    if (!notification) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }

    await this.historyRepository.update(
      { id: notificationId, userId } as any,
      {
        feedbackType,
        feedbackText: feedbackText || null,
        isAcknowledged: true,
        isRead: true,
      } as any
    );
  }

  /**
   * 删除单条通知（软删除）
   */
  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    const result = await this.historyRepository.update(
      { id: notificationId, userId, isDeleted: false } as any,
      { isDeleted: true } as any
    );

    if (result.affected === 0) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }
  }

  /**
   * 批量删除通知（软删除）
   */
  async batchDeleteNotifications(notificationIds: string[], userId: string): Promise<number> {
    const result = await this.historyRepository.update(
      { id: { $in: notificationIds }, userId, isDeleted: false } as any,
      { isDeleted: true } as any
    );

    return result.affected || 0;
  }

  /**
   * 创建通知记录
   */
  async createNotification(data: {
    userId: string;
    deviceId: string;
    babyId?: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<NotificationHistory> {
    const notification = this.historyRepository.create({
      id: IdGenerator.uuid(),
      ...data,
      triggeredAt: new Date(),
      createdAt: new Date(),
    });

    return await this.historyRepository.save(notification);
  }
}
