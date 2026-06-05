import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { UserSettings } from '../entity/user-settings.entity';
import { IdGenerator } from '@baby-monitor/shared-utils';
import { DeviceSignatureUtils } from '@baby-monitor/shared-utils';

/**
 * 面容ID登录服务
 *
 * 处理面容ID登录的注册、验证和管理
 * 注意：实际的面容识别由客户端完成，服务端负责存储验证数据和状态管理
 */
@Provide()
export class FaceIdService {
  @Inject()
  logger!: ILogger;

  @InjectEntityModel(UserSettings)
  userSettingsRepository!: Repository<UserSettings>;

  /**
   * 获取用户的面容ID设置状态
   *
   * @param userId - 用户ID
   * @returns 面容ID设置信息
   */
  async getFaceIdStatus(userId: string): Promise<{
    enabled: boolean;
    registeredAt: Date | null;
    deviceSupported: boolean;
  }> {
    const settings = await this.getOrCreateSettings(userId);

    return {
      enabled: settings.faceIdEnabled,
      registeredAt: settings.faceIdRegisteredAt,
      deviceSupported: true, // 由客户端判断设备是否支持
    };
  }

  /**
   * 开通面容ID登录
   *
   * @param userId - 用户ID
   * @param faceIdData - 面容ID绑定数据（由客户端生成，用于后续验证）
   * @returns 开通结果
   */
  async enableFaceId(userId: string, faceIdData: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const settings = await this.getOrCreateSettings(userId);

      // 已经开通
      if (settings.faceIdEnabled) {
        return {
          success: false,
          error: '面容ID登录已开通',
        };
      }

      // 加密存储面容ID数据
      // 生成一个随机密钥用于AES加密
      const encryptionKey = process.env.FACE_ID_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const encryptedData = DeviceSignatureUtils.encryptAES(faceIdData, encryptionKey);

      // 更新设置
      settings.faceIdEnabled = true;
      settings.faceIdData = encryptedData;
      settings.faceIdRegisteredAt = new Date();
      settings.updatedAt = new Date();

      await this.userSettingsRepository.save(settings);

      this.logger.info(`[FaceIdService] User ${userId} enabled Face ID login`);

      return { success: true };
    } catch (error) {
      this.logger.error('[FaceIdService] Enable Face ID error:', error);
      return {
        success: false,
        error: '开通面容ID登录失败',
      };
    }
  }

  /**
   * 关闭面容ID登录
   *
   * @param userId - 用户ID
   * @returns 关闭结果
   */
  async disableFaceId(userId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const settings = await this.getOrCreateSettings(userId);

      // 未开通
      if (!settings.faceIdEnabled) {
        return {
          success: false,
          error: '面容ID登录未开通',
        };
      }

      // 清除面容ID数据
      settings.faceIdEnabled = false;
      settings.faceIdData = null;
      settings.faceIdRegisteredAt = null;
      settings.updatedAt = new Date();

      await this.userSettingsRepository.save(settings);

      this.logger.info(`[FaceIdService] User ${userId} disabled Face ID login`);

      return { success: true };
    } catch (error) {
      this.logger.error('[FaceIdService] Disable Face ID error:', error);
      return {
        success: false,
        error: '关闭面容ID登录失败',
      };
    }
  }

  /**
   * 验证面容ID登录
   *
   * @param userId - 用户ID
   * @param faceIdToken - 面容ID验证令牌（由客户端生成）
   * @returns 验证结果
   */
  async verifyFaceId(userId: string, faceIdToken: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const settings = await this.getOrCreateSettings(userId);

      // 未开通面容ID登录
      if (!settings.faceIdEnabled || !settings.faceIdData) {
        return {
          success: false,
          error: '面容ID登录未开通',
        };
      }

      // 解密存储的面容ID数据进行验证
      const encryptionKey = process.env.FACE_ID_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const storedData = DeviceSignatureUtils.decryptAES(settings.faceIdData, encryptionKey);

      // 这里应该是验证faceIdToken是否与storedData匹配
      // 实际的验证逻辑可能涉及与服务端的密钥对比
      if (faceIdToken !== storedData) {
        return {
          success: false,
          error: '面容ID验证失败',
        };
      }

      this.logger.info(`[FaceIdService] User ${userId} verified Face ID login`);

      return { success: true };
    } catch (error) {
      this.logger.error('[FaceIdService] Verify Face ID error:', error);
      return {
        success: false,
        error: '面容ID验证失败',
      };
    }
  }

  /**
   * 更新面容ID数据
   * 当用户重新注册面容ID时调用
   *
   * @param userId - 用户ID
   * @param faceIdData - 新的面容ID数据
   * @returns 更新结果
   */
  async updateFaceIdData(userId: string, faceIdData: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const settings = await this.getOrCreateSettings(userId);

      if (!settings.faceIdEnabled) {
        return {
          success: false,
          error: '面容ID登录未开通',
        };
      }

      // 加密存储新的面容ID数据
      const encryptionKey = process.env.FACE_ID_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const encryptedData = DeviceSignatureUtils.encryptAES(faceIdData, encryptionKey);

      settings.faceIdData = encryptedData;
      settings.faceIdRegisteredAt = new Date();
      settings.updatedAt = new Date();

      await this.userSettingsRepository.save(settings);

      this.logger.info(`[FaceIdService] User ${userId} updated Face ID data`);

      return { success: true };
    } catch (error) {
      this.logger.error('[FaceIdService] Update Face ID data error:', error);
      return {
        success: false,
        error: '更新面容ID数据失败',
      };
    }
  }

  /**
   * 获取或创建用户设置
   *
   * @param userId - 用户ID
   * @returns 用户设置对象
   */
  private async getOrCreateSettings(userId: string): Promise<UserSettings> {
    let settings = await this.userSettingsRepository.findOne({
      where: { userId } as any,
    });

    if (!settings) {
      settings = this.userSettingsRepository.create({
        id: IdGenerator.uuid(),
        userId,
        faceIdEnabled: false,
        pushNotificationsEnabled: true,
        notificationVibrationEnabled: true,
        discoverable: false,
        onlineStatusVisibility: 'friends',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await this.userSettingsRepository.save(settings);
    }

    return settings;
  }
}
