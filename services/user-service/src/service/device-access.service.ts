import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, In } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import {
  UserDeviceInvitation,
  InvitationPermissions,
} from '../entity/user-device-invitation.entity';
import { UserDeviceAccessLog } from '../entity/user-device-access-log.entity';
import { UserDevice } from '../entity/user-device.entity';
import { IdGenerator, NotificationService, NotificationType, NotificationChannel, NotificationPriority } from '@baby-monitor/shared-utils';

/**
 * 设备访问服务
 *
 * 统一管理设备邀请、权限和访问日志。
 * 所有权限数据集中在 user-service 的 user_devices 表中。
 */
@Provide()
export class DeviceAccessService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @InjectEntityModel(UserDeviceInvitation)
  invitationRepository!: Repository<UserDeviceInvitation>;

  @InjectEntityModel(UserDeviceAccessLog)
  accessLogRepository!: Repository<UserDeviceAccessLog>;

  @InjectEntityModel(UserDevice)
  userDeviceRepository!: Repository<UserDevice>;

  @Inject()
  notificationService!: NotificationService;

  /** 每个设备最多邀请人数 */
  private readonly MAX_INVITEES = 5;

  /** 邀请码有效期（7天） */
  private readonly INVITATION_EXPIRY_DAYS = 7;

  // ==================== 邀请管理 ====================

  /**
   * 获取设备的所有邀请
   */
  async getDeviceInvitations(deviceId: string): Promise<UserDeviceInvitation[]> {
    return await this.invitationRepository.find({
      where: { deviceId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 创建设备邀请
   */
  /** 被邀请人默认权限：只读 */
  private static readonly DEFAULT_VIEWER_PERMISSIONS: InvitationPermissions = {
    read: true,
    write: false,
    delete: false,
    share: false,
    manage: false,
  };

  async createInvitation(data: {
    deviceId: string;
    inviterId: string;
    inviteePhone: string;
    permissions?: InvitationPermissions;
  }): Promise<UserDeviceInvitation> {
    // 验证用户是设备所有者（查 user_devices 表，role='owner'）
    const ownership = await this.userDeviceRepository.findOne({
      where: {
        userId: data.inviterId,
        deviceId: data.deviceId,
        role: 'owner',
      },
    });

    if (!ownership) {
      throw new Error('只有设备所有者可以邀请');
    }

    // 检查当前邀请数量
    const currentCount = await this.invitationRepository.count({
      where: {
        deviceId: data.deviceId,
        status: In(['pending', 'accepted']),
      },
    });

    if (currentCount >= this.MAX_INVITEES) {
      throw new Error(`最多只能邀请${this.MAX_INVITEES}人`);
    }

    // 检查是否已邀请过该手机号
    const existing = await this.invitationRepository.findOne({
      where: {
        deviceId: data.deviceId,
        inviteePhone: data.inviteePhone,
        status: In(['pending', 'accepted']),
      },
    });

    if (existing) {
      throw new Error('该用户已被邀请或已接受邀请');
    }

    // 创建邀请记录
    const invitation = this.invitationRepository.create({
      id: IdGenerator.uuid(),
      deviceId: data.deviceId,
      inviterId: data.inviterId,
      inviteePhone: data.inviteePhone,
      permissions: data.permissions || DeviceAccessService.DEFAULT_VIEWER_PERMISSIONS,
      status: 'pending',
      expiresAt: new Date(Date.now() + this.INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    });

    const saved = await this.invitationRepository.save(invitation);

    // 发送邀请短信
    await this.sendInvitationSMS(saved, ownership.deviceName || '设备');

    this.logger.info(`[DeviceAccess] Created invitation ${saved.id} for device ${data.deviceId}`);
    return saved;
  }

  /**
   * 接受邀请
   */
  async acceptInvitation(invitationId: string, userId: string): Promise<UserDeviceInvitation> {
    const invitation = await this.invitationRepository.findOne({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new Error('邀请不存在');
    }

    if (invitation.status !== 'pending') {
      throw new Error('邀请已被处理');
    }

    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      invitation.status = 'expired';
      await this.invitationRepository.save(invitation);
      throw new Error('邀请已过期');
    }

    // 更新邀请状态
    invitation.inviteeId = userId;
    invitation.status = 'accepted';
    invitation.acceptedAt = new Date();

    const saved = await this.invitationRepository.save(invitation);

    // 创建 user_devices 记录（统一权限表）
    await this.bindDeviceFromInvitation(saved);

    this.logger.info(`[DeviceAccess] User ${userId} accepted invitation ${invitationId}`);
    return saved;
  }

  /**
   * 通过手机号+验证码接受邀请
   */
  async acceptInvitationByCode(
    userId: string,
    userPhone: string,
    code: string,
  ): Promise<UserDeviceInvitation> {
    // 1. 根据手机号查找 pending 邀请
    const invitation = await this.invitationRepository.findOne({
      where: {
        inviteePhone: userPhone,
        status: In(['pending']),
      },
      order: { createdAt: 'DESC' },
    });

    if (!invitation) {
      throw new Error('未找到对应的邀请，请确认手机号是否正确');
    }

    // 2. 验证验证码
    const cacheKey = `invitation:code:${invitation.id}`;
    const cachedCode = await this.redis.get(cacheKey);

    if (!cachedCode || cachedCode !== code) {
      throw new Error('验证码错误或已过期');
    }

    // 3. 检查过期
    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      invitation.status = 'expired';
      await this.invitationRepository.save(invitation);
      throw new Error('邀请已过期');
    }

    // 4. 接受邀请
    invitation.inviteeId = userId;
    invitation.status = 'accepted';
    invitation.acceptedAt = new Date();

    const saved = await this.invitationRepository.save(invitation);

    // 5. 删除已使用的验证码
    await this.redis.del(cacheKey);

    // 6. 创建 user_devices 记录
    await this.bindDeviceFromInvitation(saved);

    this.logger.info(`[DeviceAccess] User ${userId} accepted invitation ${invitation.id} via code`);
    return saved;
  }

  /**
   * 拒绝邀请
   */
  async rejectInvitation(invitationId: string): Promise<void> {
    const invitation = await this.invitationRepository.findOne({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new Error('邀请不存在');
    }

    if (invitation.status !== 'pending') {
      throw new Error('邀请已被处理');
    }

    invitation.status = 'rejected';
    await this.invitationRepository.save(invitation);

    this.logger.info(`[DeviceAccess] Invitation ${invitationId} was rejected`);
  }

  /**
   * 删除邀请
   */
  async deleteInvitation(invitationId: string, userId: string): Promise<void> {
    const invitation = await this.invitationRepository.findOne({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new Error('邀请不存在');
    }

    if (invitation.inviterId !== userId) {
      throw new Error('只有邀请者可以删除邀请');
    }

    await this.invitationRepository.remove(invitation);

    this.logger.info(`[DeviceAccess] Invitation ${invitationId} was deleted`);
  }

  /**
   * 更新邀请权限
   */
  async updateInvitationPermissions(
    invitationId: string,
    userId: string,
    permissions: InvitationPermissions,
  ): Promise<UserDeviceInvitation> {
    const invitation = await this.invitationRepository.findOne({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new Error('邀请不存在');
    }

    if (invitation.inviterId !== userId) {
      throw new Error('只有邀请者可以修改权限');
    }

    invitation.permissions = permissions;
    const saved = await this.invitationRepository.save(invitation);

    this.logger.info(`[DeviceAccess] Updated permissions for invitation ${invitationId}`);
    return saved;
  }

  // ==================== 权限查询 ====================

  /**
   * 获取用户的设备权限
   */
  async getUserPermissions(
    userId: string,
    deviceId: string,
  ): Promise<{ permissions: InvitationPermissions; isOwner: boolean } | null> {
    const userDevice = await this.userDeviceRepository.findOne({
      where: { userId, deviceId },
    });

    if (!userDevice) {
      return null;
    }

    if (userDevice.role === 'owner') {
      return {
        permissions: { read: true, write: true, delete: true, share: true, manage: true },
        isOwner: true,
      };
    }

    // 从 permissions JSON 或 invitation 获取细粒度权限
    const invitation = await this.invitationRepository.findOne({
      where: { deviceId, inviteeId: userId, status: 'accepted' },
    });

    return {
      permissions: invitation?.permissions || { read: true, write: false, delete: false, share: false, manage: false },
      isOwner: false,
    };
  }

  /**
   * 获取用户可观看的设备列表
   */
  async getUserViewableDevices(userId: string): Promise<UserDevice[]> {
    return await this.userDeviceRepository.find({
      where: { userId },
    });
  }

  /**
   * 获取用户对指定设备的权限角色
   */
  async getDevicePermission(
    deviceId: string,
    userId: string,
  ): Promise<{ hasPermission: boolean; role?: string }> {
    const userDevice = await this.userDeviceRepository.findOne({
      where: { userId, deviceId },
    });

    if (!userDevice) {
      return { hasPermission: false };
    }

    // 检查是否过期
    if (userDevice.expiresAt && userDevice.expiresAt < new Date()) {
      return { hasPermission: false };
    }

    return { hasPermission: true, role: userDevice.role };
  }

  // ==================== 观看/访问日志 ====================

  /**
   * 开始观看
   */
  async startViewing(deviceId: string, userId: string): Promise<UserDeviceAccessLog> {
    const log = this.accessLogRepository.create({
      id: IdGenerator.uuid(),
      deviceId,
      userId,
      startedAt: new Date(),
      duration: 0,
    });

    return await this.accessLogRepository.save(log);
  }

  /**
   * 结束观看
   */
  async endViewing(logId: string): Promise<void> {
    const log = await this.accessLogRepository.findOne({
      where: { id: logId },
    });

    if (!log) {
      return;
    }

    const endedAt = new Date();
    const duration = Math.floor((endedAt.getTime() - log.startedAt.getTime()) / 1000);

    log.endedAt = endedAt;
    log.duration = duration;

    await this.accessLogRepository.save(log);
  }

  /**
   * 获取观看历史
   */
  async getViewingHistory(
    deviceId: string,
    options?: {
      userId?: string;
      limit?: number;
      offset?: number;
      startTime?: Date;
      endTime?: Date;
    },
  ): Promise<{ list: UserDeviceAccessLog[]; total: number }> {
    const qb = this.accessLogRepository
      .createQueryBuilder('log')
      .where('log.deviceId = :deviceId', { deviceId });

    if (options?.userId) {
      qb.andWhere('log.userId = :userId', { userId: options.userId });
    }
    if (options?.startTime) {
      qb.andWhere('log.startedAt >= :startTime', { startTime: options.startTime });
    }
    if (options?.endTime) {
      qb.andWhere('log.startedAt <= :endTime', { endTime: options.endTime });
    }

    const total = await qb.getCount();

    qb.orderBy('log.startedAt', 'DESC')
      .limit(options?.limit || 50)
      .offset(options?.offset || 0);

    const list = await qb.getMany();
    return { list, total };
  }

  /**
   * 清空观看历史
   */
  async clearViewingHistory(deviceId: string, beforeDate?: Date): Promise<void> {
    const qb = this.accessLogRepository.createQueryBuilder()
      .where('deviceId = :deviceId', { deviceId });

    if (beforeDate) {
      qb.andWhere('startedAt < :beforeDate', { beforeDate });
    }

    await qb.delete().execute();
    this.logger.info(`[DeviceAccess] Cleared viewing history for device ${deviceId}`);
  }

  // ==================== 直接分享（替代 DeviceShareService） ====================

  /**
   * 直接分享设备给另一个用户（无需短信验证码）
   */
  async shareDevice(data: {
    deviceId: string;
    fromUserId: string;
    toUserId: string;
    role: 'admin' | 'viewer';
    expiresAt?: Date;
  }): Promise<UserDevice> {
    // 验证分享者是设备所有者
    const ownership = await this.userDeviceRepository.findOne({
      where: { userId: data.fromUserId, deviceId: data.deviceId, role: 'owner' },
    });

    if (!ownership) {
      throw new Error('只有设备所有者可以分享设备');
    }

    // 避免重复分享
    const existing = await this.userDeviceRepository.findOne({
      where: { userId: data.toUserId, deviceId: data.deviceId },
    });

    if (existing) {
      throw new Error('该用户已绑定此设备');
    }

    const userDevice = this.userDeviceRepository.create({
      id: IdGenerator.uuid(),
      userId: data.toUserId,
      deviceId: data.deviceId,
      role: data.role,
      isShared: true,
      sharedBy: data.fromUserId,
      sharedAt: new Date(),
      ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
    } as UserDevice);

    return await this.userDeviceRepository.save(userDevice);
  }

  /**
   * 获取设备的所有分享记录
   */
  async getDeviceShares(deviceId: string): Promise<UserDevice[]> {
    return await this.userDeviceRepository.find({
      where: { deviceId, isShared: true },
    });
  }

  /**
   * 获取用户收到的分享
   */
  async getReceivedShares(userId: string): Promise<UserDevice[]> {
    return await this.userDeviceRepository.find({
      where: { userId, isShared: true },
    });
  }

  /**
   * 获取用户发起的分享
   */
  async getSentShares(userId: string): Promise<UserDevice[]> {
    return await this.userDeviceRepository.find({
      where: { sharedBy: userId, isShared: true },
    });
  }

  /**
   * 取消/移除分享
   */
  async removeShare(userDeviceId: string, operatorUserId: string): Promise<boolean> {
    const userDevice = await this.userDeviceRepository.findOne({
      where: { id: userDeviceId },
    });

    if (!userDevice) {
      return false;
    }

    // 只有设备所有者或被分享者自己可以移除
    const isOperator = userDevice.sharedBy === operatorUserId || userDevice.userId === operatorUserId;
    if (!isOperator) {
      throw new Error('无权移除此分享');
    }

    await this.userDeviceRepository.remove(userDevice);
    return true;
  }

  /**
   * 更新分享权限
   */
  async updateShareRole(userDeviceId: string, role: 'admin' | 'viewer'): Promise<UserDevice | null> {
    const userDevice = await this.userDeviceRepository.findOne({
      where: { id: userDeviceId },
    });

    if (!userDevice) {
      return null;
    }

    userDevice.role = role;
    return await this.userDeviceRepository.save(userDevice);
  }

  // ==================== 私有方法 ====================

  /**
   * 接受邀请后绑定设备到用户（写入 user_devices 表）
   *
   * 替代原来的 createShareFromInvitation（写 device_shares + HTTP 调 user-service）。
   * 现在直接写 user_devices，无需跨服务调用。
   */
  private async bindDeviceFromInvitation(invitation: UserDeviceInvitation): Promise<void> {
    // 避免重复绑定
    const existing = await this.userDeviceRepository.findOne({
      where: {
        userId: invitation.inviteeId,
        deviceId: invitation.deviceId,
      },
    });

    if (existing) {
      this.logger.info(
        `[DeviceAccess] Device ${invitation.deviceId} already bound to user ${invitation.inviteeId}`,
      );
      return;
    }

    // 根据邀请权限映射角色
    const perms = invitation.permissions;
    const role = perms.manage ? 'owner' : perms.write ? 'admin' : 'viewer';

    const userDevice = this.userDeviceRepository.create({
      id: IdGenerator.uuid(),
      userId: invitation.inviteeId!,
      deviceId: invitation.deviceId,
      role,
      permissions: perms as any,
      isShared: true,
      sharedBy: invitation.inviterId,
      sharedAt: new Date(),
      ...(invitation.expiresAt ? { expiresAt: invitation.expiresAt } : {}),
    } as UserDevice);

    await this.userDeviceRepository.save(userDevice);

    this.logger.info(
      `[DeviceAccess] Bound device ${invitation.deviceId} -> user ${invitation.inviteeId} (${role})`,
    );
  }

  /**
   * 发送邀请短信
   */
  private async sendInvitationSMS(invitation: UserDeviceInvitation, deviceName: string): Promise<void> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 缓存验证码到 Redis
    const cacheKey = `invitation:code:${invitation.id}`;
    await this.redis.setex(
      cacheKey,
      this.INVITATION_EXPIRY_DAYS * 24 * 60 * 60,
      code,
    );

    try {
      await this.notificationService.send({
        type: NotificationType.ACCOUNT_NOTICE,
        title: '设备观看邀请',
        content: `您被邀请观看设备「${deviceName}」，验证码：${code}，${this.INVITATION_EXPIRY_DAYS}天内有效。`,
        priority: NotificationPriority.NORMAL,
        channels: [NotificationChannel.SMS],
        targetUsers: [invitation.inviteePhone],
        data: { code },
      });
    } catch (err) {
      this.logger.warn(
        `[DeviceAccess] Failed to send SMS to ${invitation.inviteePhone}: ${(err as Error).message}`,
      );
    }

    this.logger.info(`[DeviceAccess] Invitation created for ${invitation.inviteePhone}, code: ${code}`);
  }
}
