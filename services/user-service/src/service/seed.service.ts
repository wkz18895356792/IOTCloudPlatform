import { Provide, Init, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { User } from '../entity/user.entity';
import { UserRole, UserStatus } from '@baby-monitor/shared-types';
import { PasswordUtil, IdGenerator } from '@baby-monitor/shared-utils';

/**
 * 用户初始化服务
 * 负责在应用启动时创建默认管理员账户
 */
@Provide()
export class SeedService {
  @Inject()
  logger!: ILogger;

  @InjectEntityModel(User)
  userRepository!: Repository<User>;

  /**
   * 默认管理员配置
   * 可通过环境变量覆盖
   */
  private readonly DEFAULT_ADMIN = {
    username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
    email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@smarthome.com',
    password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
    nickname: process.env.DEFAULT_ADMIN_NICKNAME || '超级管理员',
  };

  /**
   * 服务初始化方法
   * 在应用启动时自动执行
   */
  @Init()
  async initDefaultAdmin() {
    try {
      this.logger.info('[SeedService] Checking for default admin user...');

      // 检查是否已存在管理员用户
      const existingAdmin = await this.userRepository.findOne({
        where: { role: UserRole.ADMIN } as any,
      });

      if (existingAdmin) {
        this.logger.info('[SeedService] Admin user already exists, skipping initialization');
        return;
      }

      // 检查用户名是否已被占用
      const usernameExists = await this.userRepository.findOne({
        where: { username: this.DEFAULT_ADMIN.username } as any,
      });

      if (usernameExists) {
        this.logger.warn('[SeedService] Username already taken, cannot create default admin');
        return;
      }

      // 创建默认管理员
      const adminUser = this.userRepository.create({
        id: IdGenerator.uuid(),
        username: this.DEFAULT_ADMIN.username,
        email: this.DEFAULT_ADMIN.email,
        passwordHash: PasswordUtil.hash(this.DEFAULT_ADMIN.password),
        nickname: this.DEFAULT_ADMIN.nickname,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        phoneVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await this.userRepository.save(adminUser);

      this.logger.info('[SeedService] Default admin user created successfully');
      this.logger.info(`[SeedService] Username: ${this.DEFAULT_ADMIN.username}`);
      this.logger.info(`[SeedService] Email: ${this.DEFAULT_ADMIN.email}`);
      this.logger.info(`[SeedService] Password: ${this.DEFAULT_ADMIN.password}`);
      this.logger.warn('[SeedService] IMPORTANT: Please change the default password after first login!');
    } catch (error: any) {
      this.logger.error('[SeedService] Failed to create default admin user:', error);
      // 不抛出错误，允许应用继续启动
    }
  }

  /**
   * 手动触发初始化
   * 可通过管理接口调用
   */
  async seedAdmin(force = false): Promise<{ success: boolean; message: string }> {
    try {
      // 如果强制创建，先删除已存在的管理员
      if (force) {
        const existingAdmins = await this.userRepository.find({
          where: { role: UserRole.ADMIN } as any,
        });
        if (existingAdmins.length > 0) {
          await this.userRepository.remove(existingAdmins);
          this.logger.info(`[SeedService] Removed ${existingAdmins.length} existing admin users`);
        }
      }

      // 重新执行初始化
      await this.initDefaultAdmin();

      return {
        success: true,
        message: force ? 'Admin user re-created successfully' : 'Admin user created successfully',
      };
    } catch (error: any) {
      this.logger.error('[SeedService] Manual seeding failed:', error);
      return {
        success: false,
        message: error.message || 'Failed to create admin user',
      };
    }
  }

  /**
   * 重置管理员密码
   * 用于忘记密码时的紧急恢复
   */
  async resetAdminPassword(newPassword?: string): Promise<{ success: boolean; message: string; password?: string }> {
    try {
      const admin = await this.userRepository.findOne({
        where: { role: UserRole.ADMIN } as any,
      });

      if (!admin) {
        return {
          success: false,
          message: 'Admin user not found',
        };
      }

      const password = newPassword || PasswordUtil.generate(12);
      admin.passwordHash = PasswordUtil.hash(password);
      admin.updatedAt = new Date();

      await this.userRepository.save(admin);

      this.logger.info('[SeedService] Admin password reset successfully');
      this.logger.warn('[SeedService] New password: ' + password);

      return {
        success: true,
        message: 'Password reset successfully',
        password,
      };
    } catch (error: any) {
      this.logger.error('[SeedService] Password reset failed:', error);
      return {
        success: false,
        message: error.message || 'Failed to reset password',
      };
    }
  }
}
