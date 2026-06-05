import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { IdGenerator, PasswordUtil, SqlSafeUtil } from '@baby-monitor/shared-utils';
import { AppUser, AppUserRole, AppUserStatus } from '../entity/app-user.entity';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * APP用户服务
 * 管理使用婴儿监护APP的普通用户
 */
@Provide()
export class AppUserService {
  @Inject()
  logger!: ILogger;

  @InjectEntityModel(AppUser)
  appUserRepository!: Repository<AppUser>;

  /**
   * 创建APP用户
   */
  async createUser(data: {
    username: string;
    email?: string;
    phone?: string;
    password: string;
    nickname?: string;
  }): Promise<{ success: boolean; data?: AppUser; error?: string }> {
    try {
      // 检查用户名是否已存在
      const existingUser = await this.appUserRepository.findOne({
        where: { username: data.username } as any
      });
      if (existingUser) {
        return { success: false, error: '用户名已存在' };
      }

      // 检查邮箱是否已存在
      if (data.email) {
        const existingEmail = await this.appUserRepository.findOne({
          where: { email: data.email } as any
        });
        if (existingEmail) {
          return { success: false, error: '邮箱已被注册' };
        }
      }

      // 检查手机号是否已存在
      if (data.phone) {
        const existingPhone = await this.appUserRepository.findOne({
          where: { phone: data.phone } as any
        });
        if (existingPhone) {
          return { success: false, error: '手机号已被注册' };
        }
      }

      // 创建用户
      const user = this.appUserRepository.create({
        id: IdGenerator.uuid(),
        username: data.username,
        email: data.email,
        phone: data.phone,
        passwordHash: PasswordUtil.hash(data.password),
        nickname: data.nickname || data.username,
        role: AppUserRole.USER,
        status: AppUserStatus.INACTIVE,
        notificationSettings: {
          email: true,
          sms: true,
          push: true,
          cryingAlert: true,
          movementAlert: true,
          feedingReminder: true,
          diaperChangeReminder: true,
        },
      });

      const savedUser = await this.appUserRepository.save(user);

      this.logger.info(`[AppUserService] App user created: ${savedUser.username}`);

      return { success: true, data: this.sanitizeUser(savedUser) };
    } catch (error: any) {
      this.logger.error('[AppUserService] Create user error:', error);
      return { success: false, error: '创建用户失败' };
    }
  }

  /**
   * 获取用户列表
   */
  async getUserList(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    role?: AppUserRole;
    status?: AppUserStatus;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const { page, pageSize, keyword, role, status } = params;
      const skip = (page - 1) * pageSize;

      const queryBuilder = this.appUserRepository.createQueryBuilder('user');

      // 关键词搜索
      if (keyword) {
        queryBuilder.andWhere(
          '(user.username LIKE :keyword OR user.email LIKE :keyword OR user.phone LIKE :keyword)',
          { keyword: SqlSafeUtil.likeContains(keyword) }
        );
      }

      // 角色过滤
      if (role) {
        queryBuilder.andWhere('user.role = :role', { role });
      }

      // 状态过滤
      if (status) {
        queryBuilder.andWhere('user.status = :status', { status });
      }

      // 获取总数
      const total = await queryBuilder.getCount();

      // 分页查询
      const users = await queryBuilder
        .skip(skip)
        .take(pageSize)
        .orderBy('user.createdAt', 'DESC')
        .getMany();

      // 移除敏感信息
      const sanitizedUsers = users.map(user => this.sanitizeUser(user));

      return {
        success: true,
        data: {
          items: sanitizedUsers,
          total,
          page,
          pageSize,
        },
      };
    } catch (error: any) {
      this.logger.error('[AppUserService] Get user list error:', error);
      return { success: false, error: '获取用户列表失败' };
    }
  }

  /**
   * 获取用户详情
   */
  async getUser(id: string): Promise<{ success: boolean; data?: AppUser; error?: string }> {
    try {
      const user = await this.appUserRepository.findOne({
        where: { id } as any
      });

      if (!user) {
        return { success: false, error: '用户不存在' };
      }

      return { success: true, data: this.sanitizeUser(user) };
    } catch (error: any) {
      this.logger.error('[AppUserService] Get user error:', error);
      return { success: false, error: '获取用户详情失败' };
    }
  }

  /**
   * 更新用户
   */
  async updateUser(
    id: string,
    data: {
      email?: string;
      password?: string;
      nickname?: string;
      avatar?: string;
      gender?: string;
      birthDate?: string;
      bio?: string;
      location?: string;
      status?: AppUserStatus;
    }
  ): Promise<{ success: boolean; data?: AppUser; error?: string }> {
    try {
      const user = await this.appUserRepository.findOne({
        where: { id } as any
      });

      if (!user) {
        return { success: false, error: '用户不存在' };
      }

      // 更新允许的字段
      if (data.email && data.email !== user.email) {
        const existingEmail = await this.appUserRepository.findOne({
          where: { email: data.email } as any
        });
        if (existingEmail) {
          return { success: false, error: '邮箱已被使用' };
        }
        user.email = data.email;
      }

      if (data.password) {
        user.passwordHash = PasswordUtil.hash(data.password);
      }

      if (data.nickname !== undefined) {
        user.nickname = data.nickname;
      }

      if (data.avatar !== undefined) {
        user.avatar = data.avatar;
      }

      if (data.gender !== undefined) {
        user.gender = data.gender;
      }

      if (data.birthDate !== undefined) {
        user.birthDate = new Date(data.birthDate);
      }

      if (data.bio !== undefined) {
        user.bio = data.bio;
      }

      if (data.location !== undefined) {
        user.location = data.location;
      }

      if (data.status !== undefined) {
        user.status = data.status;
      }

      const updatedUser = await this.appUserRepository.save(user);

      this.logger.info(`[AppUserService] App user updated: ${updatedUser.username}`);

      return { success: true, data: this.sanitizeUser(updatedUser) };
    } catch (error: any) {
      this.logger.error('[AppUserService] Update user error:', error);
      return { success: false, error: '更新用户失败' };
    }
  }

  /**
   * 删除用户
   */
  async deleteUser(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await this.appUserRepository.findOne({
        where: { id } as any
      });

      if (!user) {
        return { success: false, error: '用户不存在' };
      }

      await this.appUserRepository.remove(user);

      this.logger.info(`[AppUserService] App user deleted: ${user.username}`);

      return { success: true };
    } catch (error: any) {
      this.logger.error('[AppUserService] Delete user error:', error);
      return { success: false, error: '删除用户失败' };
    }
  }

  /**
   * 清理用户敏感信息
   */
  private sanitizeUser(user: AppUser): any {
    const { passwordHash, ...sanitized } = user as any;
    return sanitized;
  }
}
