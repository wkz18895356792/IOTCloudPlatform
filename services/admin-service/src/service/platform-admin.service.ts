import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { IdGenerator, PasswordUtil, SqlSafeUtil } from '@baby-monitor/shared-utils';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';
import { PlatformAdmin, PlatformAdminRole, PlatformAdminStatus } from '../entity/platform-admin.entity';

/**
 * 平台管理员服务
 * 管理平台管理员账户的增删改查
 */
@Provide()
export class PlatformAdminService {
  @Inject()
  logger!: ILogger;

  @InjectEntityModel(PlatformAdmin)
  platformAdminRepository!: Repository<PlatformAdmin>;

  /**
   * 创建平台管理员
   */
  async createAdmin(data: {
    username: string;
    email: string;
    password: string;
    role: PlatformAdminRole;
    nickname?: string;
    remark?: string;
  }): Promise<{ success: boolean; data?: PlatformAdmin; error?: string }> {
    try {
      // 检查用户名是否已存在
      const existingUsername = await this.platformAdminRepository.findOne({
        where: { username: data.username } as any
      });
      if (existingUsername) {
        return { success: false, error: '用户名已存在' };
      }

      // 检查邮箱是否已存在
      const existingEmail = await this.platformAdminRepository.findOne({
        where: { email: data.email } as any
      });
      if (existingEmail) {
        return { success: false, error: '邮箱已存在' };
      }

      // 创建管理员
      const admin = this.platformAdminRepository.create({
        id: IdGenerator.uuid(),
        username: data.username,
        email: data.email,
        passwordHash: PasswordUtil.hash(data.password),
        role: data.role,
        status: PlatformAdminStatus.ACTIVE,
        nickname: data.nickname,
        remark: data.remark,
      });

      const savedAdmin = await this.platformAdminRepository.save(admin);

      this.logger.info(`[PlatformAdminService] Platform admin created: ${savedAdmin.username}`);

      return { success: true, data: savedAdmin };
    } catch (error: any) {
      this.logger.error('[PlatformAdminService] Create admin error:', error);
      return { success: false, error: '创建管理员失败' };
    }
  }

  /**
   * 获取管理员列表
   */
  async getAdminList(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    role?: PlatformAdminRole;
    status?: PlatformAdminStatus;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const { page, pageSize, keyword, role, status } = params;
      const skip = (page - 1) * pageSize;

      const queryBuilder = this.platformAdminRepository.createQueryBuilder('admin');

      // 关键词搜索
      if (keyword) {
        queryBuilder.andWhere(
          '(admin.username LIKE :keyword OR admin.email LIKE :keyword)',
          { keyword: SqlSafeUtil.likeContains(keyword) }
        );
      }

      // 角色过滤
      if (role) {
        queryBuilder.andWhere('admin.role = :role', { role });
      }

      // 状态过滤
      if (status) {
        queryBuilder.andWhere('admin.status = :status', { status });
      }

      // 获取总数
      const total = await queryBuilder.getCount();

      // 分页查询
      const admins = await queryBuilder
        .skip(skip)
        .take(pageSize)
        .orderBy('admin.createdAt', 'DESC')
        .getMany();

      // 移除敏感信息
      const sanitizedAdmins = admins.map(admin => this.sanitizeAdmin(admin));

      return {
        success: true,
        data: {
          items: sanitizedAdmins,
          total,
          page,
          pageSize,
        },
      };
    } catch (error: any) {
      this.logger.error('[PlatformAdminService] Get admin list error:', error);
      return { success: false, error: '获取管理员列表失败' };
    }
  }

  /**
   * 获取管理员详情
   */
  async getAdmin(id: string): Promise<{ success: boolean; data?: PlatformAdmin; error?: string }> {
    try {
      const admin = await this.platformAdminRepository.findOne({
        where: { id } as any
      });

      if (!admin) {
        return { success: false, error: '管理员不存在' };
      }

      return { success: true, data: this.sanitizeAdmin(admin) };
    } catch (error: any) {
      this.logger.error('[PlatformAdminService] Get admin error:', error);
      return { success: false, error: '获取管理员详情失败' };
    }
  }

  /**
   * 更新管理员
   */
  async updateAdmin(
    id: string,
    data: {
      email?: string;
      password?: string;
      role?: PlatformAdminRole;
      status?: PlatformAdminStatus;
      nickname?: string;
      avatar?: string;
      permissions?: string[];
      remark?: string;
    }
  ): Promise<{ success: boolean; data?: PlatformAdmin; error?: string }> {
    try {
      const admin = await this.platformAdminRepository.findOne({
        where: { id } as any
      });

      if (!admin) {
        return { success: false, error: '管理员不存在' };
      }

      // 更新允许的字段
      if (data.email && data.email !== admin.email) {
        // 检查邮箱是否已被占用
        const existingEmail = await this.platformAdminRepository.findOne({
          where: { email: data.email } as any
        });
        if (existingEmail) {
          return { success: false, error: '邮箱已被使用' };
        }
        admin.email = data.email;
      }

      if (data.password) {
        admin.passwordHash = PasswordUtil.hash(data.password);
      }

      if (data.role !== undefined) {
        admin.role = data.role;
      }

      if (data.status !== undefined) {
        admin.status = data.status;
      }

      if (data.nickname !== undefined) {
        admin.nickname = data.nickname;
      }

      if (data.avatar !== undefined) {
        admin.avatar = data.avatar;
      }

      if (data.permissions !== undefined) {
        admin.permissions = data.permissions;
      }

      if (data.remark !== undefined) {
        admin.remark = data.remark;
      }

      const updatedAdmin = await this.platformAdminRepository.save(admin);

      this.logger.info(`[PlatformAdminService] Platform admin updated: ${updatedAdmin.username}`);

      return { success: true, data: this.sanitizeAdmin(updatedAdmin) };
    } catch (error: any) {
      this.logger.error('[PlatformAdminService] Update admin error:', error);
      return { success: false, error: '更新管理员失败' };
    }
  }

  /**
   * 删除管理员
   */
  async deleteAdmin(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const admin = await this.platformAdminRepository.findOne({
        where: { id } as any
      });

      if (!admin) {
        return { success: false, error: '管理员不存在' };
      }

      // 不允许删除超级管理员
      if (admin.role === PlatformAdminRole.SUPER_ADMIN) {
        return { success: false, error: '不能删除超级管理员' };
      }

      await this.platformAdminRepository.remove(admin);

      this.logger.info(`[PlatformAdminService] Platform admin deleted: ${admin.username}`);

      return { success: true };
    } catch (error: any) {
      this.logger.error('[PlatformAdminService] Delete admin error:', error);
      return { success: false, error: '删除管理员失败' };
    }
  }

  /**
   * 重置管理员密码
   */
  async resetPassword(id: string, newPassword?: string): Promise<{ success: boolean; data?: { temporaryPassword: string }; error?: string }> {
    try {
      const admin = await this.platformAdminRepository.findOne({
        where: { id } as any
      });

      if (!admin) {
        return { success: false, error: '管理员不存在' };
      }

      const password = newPassword || PasswordUtil.generate(12);
      admin.passwordHash = PasswordUtil.hash(password);

      await this.platformAdminRepository.save(admin);

      this.logger.info(`[PlatformAdminService] Password reset for admin: ${admin.username}`);

      return { success: true, data: { temporaryPassword: password } };
    } catch (error: any) {
      this.logger.error('[PlatformAdminService] Reset password error:', error);
      return { success: false, error: '重置密码失败' };
    }
  }

  /**
   * 清理管理员敏感信息
   */
  private sanitizeAdmin(admin: PlatformAdmin): any {
    const { passwordHash, ...sanitized } = admin as any;
    return sanitized;
  }
}
