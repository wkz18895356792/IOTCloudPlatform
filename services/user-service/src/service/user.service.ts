import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@midwayjs/redis';
import { User } from '../entity/user.entity';
import { UserProfile } from '../entity/user-profile.entity';
import { UserDevice } from '../entity/user-device.entity';
import { UserSession } from '../entity/user-session.entity';
import { PasswordUtil, IdGenerator } from '@baby-monitor/shared-utils';
import { NotificationService, NotificationType, NotificationChannel, NotificationPriority } from '@baby-monitor/shared-utils';
import { VerificationCodeService } from './sms.service';

/**
 * 用户服务
 * 负责用户信息管理、资料更新、设备绑定、会话管理等用户相关操作
 */
@Provide()
export class UserService {
  // Redis缓存服务
  @Inject()
  redis!: RedisService;

  // 验证码服务
  @Inject()
  verificationCodeService!: VerificationCodeService;

  // 通知服务
  @Inject()
  notificationService!: NotificationService;

  // 用户数据仓库
  @InjectEntityModel(User)
  userRepository!: Repository<User>;

  // 用户资料数据仓库
  @InjectEntityModel(UserProfile)
  userProfileRepository!: Repository<UserProfile>;

  // 用户设备数据仓库
  @InjectEntityModel(UserDevice)
  userDeviceRepository!: Repository<UserDevice>;

  // 用户会话数据仓库
  @InjectEntityModel(UserSession)
  userSessionRepository!: Repository<UserSession>;

  // 缓存过期时间：1小时（单位：秒）
  private readonly CACHE_TTL = 3600;

  /**
   * 获取用户信息（不含敏感信息）
   * 通过用户ID获取用户基本信息，自动过滤密码等敏感字段
   *
   * @param userId - 用户ID
   * @returns 用户信息对象（不包含密码），用户不存在时返回null
   */
  async getUserById(userId: string): Promise<Omit<User, 'passwordHash'> | null> {
    // 首先尝试从Redis缓存获取用户信息
    const cached = await this.getCachedUser(userId);
    if (cached) {
      return cached;
    }

    // 从数据库查询用户信息
    const user = await this.userRepository.findOne({
      where: { id: userId } as any,
    });

    if (!user) {
      return null;
    }

    // 移除密码哈希等敏感信息
    const { passwordHash, ...userWithoutPassword } = user;

    // 将用户信息缓存到Redis
    await this.cacheUser(userWithoutPassword as any);

    return userWithoutPassword as any;
  }

  /**
   * 获取用户完整信息（包含个人资料）
   * 获取用户基本信息和扩展的个人资料信息
   *
   * @param userId - 用户ID
   * @returns 包含用户基本信息和个人资料的完整对象，用户不存在时返回null
   */
  async getUserFullInfo(userId: string): Promise<any | null> {
    const user = await this.getUserById(userId);
    if (!user) {
      return null;
    }

    // 查询用户的扩展资料信息
    const profile = await this.userProfileRepository.findOne({
      where: { userId } as any,
    });

    return {
      ...user,
      profile,
    };
  }

  /**
   * 更新用户资料
   * 更新或创建用户的个人资料信息
   *
   * @param userId - 用户ID
   * @param updates - 要更新的资料字段
   * @returns 更新后的用户资料对象
   */
  async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<UserProfile | null> {
    // 查找现有的用户资料
    let profile = await this.userProfileRepository.findOne({
      where: { userId } as any,
    });

    if (profile) {
      // 如果资料已存在，进行更新
      await this.userProfileRepository.update(profile.id, updates);
    } else {
      // 如果资料不存在，创建新记录
      profile = this.userProfileRepository.create({
        ...updates,
        userId,
      });
      await this.userProfileRepository.save(profile);
    }

    // 清除用户缓存，确保数据一致性
    await this.clearUserCache(userId);

    // 返回更新后的资料
    return this.userProfileRepository.findOne({
      where: { userId } as any,
    });
  }

  /**
   * 修改密码
   * 验证旧密码后更新用户密码
   *
   * @param userId - 用户ID
   * @param oldPassword - 旧密码
   * @param newPassword - 新密码
   * @returns 修改结果，包含成功标志和可能的错误信息
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId } as any,
    });

    // 用户不存在或未设置密码
    if (!user || !user.passwordHash) {
      return {
        success: false,
        error: '用户不存在',
      };
    }

    // 验证旧密码是否正确
    const isValid = PasswordUtil.verify(oldPassword, user.passwordHash);
    if (!isValid) {
      return {
        success: false,
        error: '当前密码错误',
      };
    }

    // 更新为新的密码哈希
    user.passwordHash = PasswordUtil.hash(newPassword);
    await this.userRepository.save(user);

    // 清除用户缓存
    await this.clearUserCache(userId);

    return {
      success: true,
    };
  }

  /**
   * 重置密码
   * 通过验证码重置用户密码（由管理员或用户在特定场景下使用）
   *
   * @param account - 账号（用户名/邮箱/手机号）
   * @param code - 验证码
   * @param newPassword - 新密码
   * @returns 重置结果，包含成功标志和可能的错误信息
   */
  async resetPassword(
    account: string,
    code: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    // 验证重置密码验证码的有效性
    const isValid = await this.verificationCodeService.verifyCode(
      code,
      'reset_password' as any,
      account
    );

    if (!isValid) {
      return {
        success: false,
        error: '验证码错误或已过期',
      };
    }

    // 通过用户名、邮箱或手机号查找用户
    const user = await this.userRepository.findOne({
      where: [
        { username: account } as any,
        { email: account } as any,
        { phone: account } as any,
      ],
    });

    if (!user) {
      return {
        success: false,
        error: '用户不存在',
      };
    }

    // 验证密码强度
    if (!PasswordUtil.validate(newPassword)) {
      return {
        success: false,
        error: '密码强度不足，请使用8-20位包含大小写字母、数字和特殊字符的密码',
      };
    }

    // 更新用户密码
    user.passwordHash = PasswordUtil.hash(newPassword);
    await this.userRepository.save(user);

    // 清除该用户的缓存
    await this.clearUserCache(user.id);

    return {
      success: true,
    };
  }

  /**
   * 绑定设备
   * 将设备绑定到用户账户，并设置用户的角色权限
   *
   * @param userId - 用户ID
   * @param deviceId - 设备ID
   * @param deviceName - 设备名称（可选）
   * @param role - 用户角色：owner（所有者）、admin（管理员）、viewer（查看者），默认为owner
   * @returns 创建的用户设备绑定记录
   */
  async bindDevice(
    userId: string,
    deviceId: string,
    deviceName?: string,
    role: 'owner' | 'admin' | 'viewer' = 'owner',
    shareInfo?: { isShared?: boolean; sharedBy?: string }
  ): Promise<UserDevice> {
    // 避免重复绑定
    const existing = await this.userDeviceRepository.findOne({
      where: { userId, deviceId } as any,
    });
    if (existing) {
      return existing;
    }

    const userDevice = new UserDevice();
    Object.assign(userDevice, {
      userId,
      deviceId,
      deviceName,
      role,
      permissions: this.getDefaultPermissions(role),
      isShared: shareInfo?.isShared ?? false,
      sharedBy: shareInfo?.sharedBy ?? null,
      sharedAt: shareInfo?.isShared ? new Date() : null,
    });

    await this.userDeviceRepository.save(userDevice);
    return userDevice;
  }

  /**
   * 解绑设备
   * 将设备从用户账户中解绑
   *
   * @param userId - 用户ID
   * @param deviceId - 设备ID
   * @returns 解绑成功返回true，失败返回false
   */
  async unbindDevice(userId: string, deviceId: string): Promise<boolean> {
    const result = await this.userDeviceRepository.delete({
      userId,
      deviceId,
    } as any);

    return (result.affected || 0) > 0;
  }

  /**
   * 获取用户设备列表
   * 获取用户绑定的所有设备，按创建时间倒序排列
   *
   * @param userId - 用户ID
   * @returns 用户设备列表
   */
  async getUserDevices(userId: string): Promise<UserDevice[]> {
    return this.userDeviceRepository.find({
      where: { userId } as any,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 获取用户会话列表
   * 获取用户的所有活跃会话，按最后活跃时间倒序排列
   *
   * @param userId - 用户ID
   * @returns 用户会话列表
   */
  async getUserSessions(userId: string): Promise<UserSession[]> {
    return this.userSessionRepository.find({
      where: { userId } as any,
      order: { lastActiveAt: 'DESC' },
    });
  }

  /**
   * 删除会话（登出指定设备）
   * 删除指定的用户会话，实现单设备登出
   *
   * @param sessionId - 会话ID
   * @param userId - 用户ID
   * @returns 删除成功返回true，失败返回false
   */
  async deleteSession(sessionId: string, userId: string): Promise<boolean> {
    const result = await this.userSessionRepository.delete({
      id: sessionId,
      userId,
    } as any);

    return (result.affected || 0) > 0;
  }

  /**
   * 删除所有会话（全部登出）
   * 删除用户的所有会话，实现所有设备强制登出
   *
   * @param userId - 用户ID
   */
  async deleteAllSessions(userId: string): Promise<void> {
    await this.userSessionRepository.delete({
      userId,
    } as any);
  }

  /**
   * 更新会话活跃时间
   * 更新会话的最后活跃时间，用于会话保活
   *
   * @param sessionId - 会话ID
   */
  async updateSessionActivity(sessionId: string): Promise<void> {
    await this.userSessionRepository.update(
      { id: sessionId } as any,
      { lastActiveAt: new Date() } as any
    );
  }

  /**
   * 上传头像
   * 更新用户的头像URL
   *
   * @param userId - 用户ID
   * @param avatarUrl - 头像URL
   * @returns 返回头像URL
   */
  async uploadAvatar(userId: string, avatarUrl: string): Promise<string> {
    await this.userRepository.update(userId, {
      avatar: avatarUrl,
    } as any);

    // 清除用户缓存以更新头像信息
    await this.clearUserCache(userId);

    return avatarUrl;
  }

  /**
   * 删除账户
   * 验证密码后软删除用户账户（将状态设为inactive）
   *
   * @param userId - 用户ID
   * @param password - 密码（用于验证身份）
   * @returns 删除结果，包含成功标志和可能的错误信息
   */
  async deleteAccount(userId: string, password: string): Promise<{ success: boolean; error?: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId } as any,
    });

    if (!user || !user.passwordHash) {
      return {
        success: false,
        error: '用户不存在',
      };
    }

    // 验证密码是否正确
    const isValid = PasswordUtil.verify(password, user.passwordHash);
    if (!isValid) {
      return {
        success: false,
        error: '密码错误',
      };
    }

    // 软删除：将用户状态设为inactive而非真正删除数据
    user.status = 'inactive' as any;
    await this.userRepository.save(user);

    // 清除用户缓存
    await this.clearUserCache(userId);

    // 发送删除确认邮件
    await this.notificationService.send({
      type: NotificationType.ACCOUNT_NOTICE,
      title: '账户已注销',
      content: `您的账户 ${user.username} 已成功注销。感谢您使用宝宝监控系统。`,
      priority: NotificationPriority.NORMAL,
      channels: [NotificationChannel.EMAIL],
      targetUsers: [userId],
      data: {
        action: 'account_deleted',
        username: user.username,
        deletedAt: new Date().toISOString(),
      },
    });

    return {
      success: true,
    };
  }

  /**
   * 获取默认权限
   * 根据用户角色返回对应的设备操作权限列表
   *
   * @param role - 用户角色：owner（所有者）、admin（管理员）、viewer（查看者）
   * @returns 权限对象
   */
  private getDefaultPermissions(role: 'owner' | 'admin' | 'viewer'): Record<string, boolean> {
    // 定义各角色的默认权限
    const permissions = {
      owner: { read: true, write: true, delete: true, share: true, manage: true },
      admin: { read: true, write: true, share: true },
      viewer: { read: true },
    };

    return permissions[role] || {};
  }

  /**
   * 缓存用户信息
   * 将用户信息存储到Redis缓存中
   *
   * @param user - 用户对象
   */
  private async cacheUser(user: any): Promise<void> {
    const cacheKey = `user:${user.id}`;
    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(user));
  }

  /**
   * 获取缓存的用户信息
   * 从Redis缓存中读取用户信息
   *
   * @param userId - 用户ID
   * @returns 缓存的用户对象，不存在时返回null
   */
  private async getCachedUser(userId: string): Promise<any | null> {
    const cacheKey = `user:${userId}`;
    const cached = await this.redis.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * 清除用户缓存
   * 从Redis缓存中删除用户信息
   *
   * @param userId - 用户ID
   */
  private async clearUserCache(userId: string): Promise<void> {
    const cacheKey = `user:${userId}`;
    await this.redis.del(cacheKey);
  }

  // ========================================================================
  // 设备权限检查方法（供服务间API调用）
  // ========================================================================

  /**
   * 检查用户对设备的权限
   *
   * @param deviceId - 设备ID
   * @param userId - 用户ID
   * @returns 权限检查结果
   */
  async checkDevicePermission(
    deviceId: string,
    userId: string
  ): Promise<{ hasPermission: boolean; role?: 'owner' | 'admin' | 'viewer' }> {
    // 查询用户设备关系
    const userDevice = await this.userDeviceRepository.findOne({
      where: {
        deviceId,
        userId,
      } as any,
    });

    if (!userDevice) {
      return { hasPermission: false };
    }

    // 返回权限信息
    return {
      hasPermission: true,
      role: userDevice.role as 'owner' | 'admin' | 'viewer',
    };
  }

  /**
   * 批量检查用户对多个设备的权限
   *
   * @param deviceIds - 设备ID数组
   * @param userId - 用户ID
   * @returns 批量权限检查结果
   */
  async checkDevicePermissionsBatch(
    deviceIds: string[],
    userId: string
  ): Promise<Array<{ deviceId: string; hasPermission: boolean; role?: 'owner' | 'admin' | 'viewer' }>> {
    // 查询用户的所有设备关系
    const userDevices = await this.userDeviceRepository.find({
      where: { userId } as any,
    });

    // 构建设备ID到权限的映射
    const devicePermissionMap = new Map<string, { hasPermission: boolean; role?: 'owner' | 'admin' | 'viewer' }>();
    for (const ud of userDevices) {
      devicePermissionMap.set(ud.deviceId, {
        hasPermission: true,
        role: ud.role as 'owner' | 'admin' | 'viewer',
      });
    }

    // 返回每个设备的权限检查结果
    return deviceIds.map(deviceId => ({
      deviceId,
      ...devicePermissionMap.get(deviceId) || { hasPermission: false },
    }));
  }

  /**
   * 获取用户有权限访问的所有设备ID
   *
   * @param userId - 用户ID
   * @returns 设备ID数组
   */
  async getUserAccessibleDevices(userId: string): Promise<string[]> {
    const userDevices = await this.userDeviceRepository.find({
      where: { userId } as any,
      select: ['deviceId'],
    });

    return userDevices.map(ud => ud.deviceId);
  }

  /**
   * 检查用户是否通过家庭权限访问设备
   *
   * 当设备属于某个家庭，用户是该家庭成员时，用户可以访问设备
   *
   * @param userId - 用户ID
   * @param deviceId - 设备ID
   * @returns 是否有家庭权限访问
   */
  async checkFamilyDeviceAccess(userId: string, deviceId: string): Promise<boolean> {
    // 家庭权限检查逻辑：
    // 1. 查询用户所属的家庭（通过 admin-service 的 domain API）
    // 2. 查询设备所属的家庭
    // 3. 检查用户是否在该家庭的成员列表中

    // 获取用户的域（家庭）信息
    const user = await this.userRepository.findOne({
      where: { id: userId } as any,
      select: ['domainId'],
    });

    if (!user?.domainId) {
      return false; // 用户不属于任何家庭
    }

    // 通过 Redis 缓存检查设备-家庭关系
    const deviceDomainKey = `device:${deviceId}:domain`;
    const deviceDomainId = await this.redis.get(deviceDomainKey);

    if (!deviceDomainId) {
      return false; // 设备不属于任何家庭
    }

    // 检查用户是否是该家庭的成员
    const familyMembersKey = `domain:${user.domainId}:members`;
    const isMember = await this.redis.sismember(familyMembersKey, userId);

    return isMember === 1;
  }
}
