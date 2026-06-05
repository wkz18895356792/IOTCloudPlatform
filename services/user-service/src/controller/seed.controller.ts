import { Controller, Post, Get, Inject, Query } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiTags } from '@midwayjs/swagger';
import { SeedService } from '../service/seed.service';
import { PasswordUtil } from '@baby-monitor/shared-utils';

/**
 * 系统初始化控制器
 * 提供默认管理员账户的初始化和密码重置功能
 */
@ApiTags('系统初始化（运维平台用）')
@Controller('/api/seed')
export class SeedController {
  @Inject()
  ctx!: Context;

  @Inject()
  seedService!: SeedService;

  /**
   * 创建默认管理员
   */
  @Post('/admin')
  @ApiOperation({ summary: '创建默认管理员账户' })
  async createAdmin(@Query('force') force?: string) {
    try {
      // 检查是否已有管理员
      const result = await this.seedService.seedAdmin(force === 'true');

      if (result.success) {
        return {
          success: true,
          message: result.message,
          data: {
            username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
            email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@smarthome.com',
            password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
          },
        };
      }

      return {
        success: false,
        message: result.message,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || '创建管理员失败',
      };
    }
  }

  /**
   * 重置管理员密码
   */
  @Post('/reset-password')
  @ApiOperation({ summary: '重置管理员密码' })
  async resetPassword(@Query('length') length?: string) {
    try {
      const newPasswordLength = length ? parseInt(length) : undefined;
      const result = await this.seedService.resetAdminPassword(
        newPasswordLength ? PasswordUtil.generate(newPasswordLength) : undefined
      );

      return {
        success: result.success,
        message: result.message,
        data: result.password ? { password: result.password } : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || '重置密码失败',
      };
    }
  }

  /**
   * 获取默认管理员信息
   */
  @Get('/admin-info')
  @ApiOperation({ summary: '获取默认管理员信息（不含密码）' })
  getAdminInfo() {
    return {
      success: true,
      data: {
        username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
        email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@smarthome.com',
        nickname: process.env.DEFAULT_ADMIN_NICKNAME || '超级管理员',
        note: '默认密码为 admin123，请登录后立即修改',
      },
    };
  }
}
