import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { UserService } from '../service/user.service';
import { PasswordUtil, IdGenerator } from '@baby-monitor/shared-utils';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entity/user.entity';
import { successResponse, errorResponse, ErrorCode, UserRole } from '@baby-monitor/shared-types';
import { SqlSafeUtil } from '@baby-monitor/shared-utils';

/**
 * 管理员用户管理控制器
 * 处理管理员对用户的操作，包括查看、修改、删除用户等
 */
@ApiTags('管理员用户管理（运维平台用）')
@Controller('/api/admin/users')
export class AdminUserController {
  @Inject()
  ctx!: Context;

  @Inject()
  userService!: UserService;

  @InjectEntityModel(User)
  userRepository!: Repository<User>;

  /**
   * 获取用户列表
   */
  @Get('/')
  @ApiOperation({ summary: '获取用户列表', description: '分页获取平台所有用户' })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            items: { type: 'array' },
            total: { type: 'number' },
            page: { type: 'number' },
            pageSize: { type: 'number' }
          }
        }
      }
    }
  })
  @ApiQuery({ name: 'page', description: '页码', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', description: '每页数量', required: false, example: 20 })
  @ApiQuery({ name: 'keyword', description: '搜索关键词（用户名/邮箱/手机号）', required: false })
  @ApiQuery({ name: 'role', description: '用户角色', required: false })
  @ApiQuery({ name: 'status', description: '用户状态', required: false })
  async getUsers(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
    @Query('keyword') keyword?: string,
    @Query('role') role?: string,
    @Query('status') status?: string
  ) {
    try {
      const skip = (page - 1) * pageSize;

      // 构建查询条件
      const queryBuilder = this.userRepository.createQueryBuilder('user');

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

      return successResponse({
        items: sanitizedUsers,
        total,
        page,
        pageSize
      });
    } catch (error: any) {
      console.error('[AdminUserController] Get users error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '获取用户列表失败');
    }
  }

  /**
   * 获取用户详情
   */
  @Get('/:userId')
  @ApiOperation({ summary: '获取用户详情', description: '根据用户ID获取详细信息' })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object' }
      }
    }
  })
  @ApiParam({ name: 'userId', description: '用户ID', example: 'user-123' })
  async getUser(@Param('userId') userId: string) {
    try {
      const user = await this.userRepository.findOne({
        where: { id: userId } as any
      });

      if (!user) {
        return errorResponse(ErrorCode.USER_NOT_FOUND, '用户不存在');
      }

      return successResponse(this.sanitizeUser(user), '获取用户详情成功');
    } catch (error: any) {
      console.error('[AdminUserController] Get user error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '获取用户详情失败');
    }
  }

  /**
   * 更新用户信息
   */
  @Put('/:userId')
  @ApiOperation({ summary: '更新用户信息', description: '更新指定用户的信息' })
  @ApiResponse({
    status: 200,
    description: '更新成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '更新成功' }
      }
    }
  })
  @ApiParam({ name: 'userId', description: '用户ID', example: 'user-123' })
  @ApiBody({
    description: '用户信息',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        nickname: { type: 'string', description: '昵称' },
        email: { type: 'string', description: '邮箱' },
        phone: { type: 'string', description: '手机号' },
        gender: { type: 'string', description: '性别' },
        birthDate: { type: 'string', description: '生日' },
        location: { type: 'string', description: '所在地' },
        bio: { type: 'string', description: '个人简介' },
        role: { type: 'string', description: '用户角色' },
        status: { type: 'string', description: '用户状态' },
      }
    }
  })
  async updateUser(@Param('userId') userId: string, @Body() body: any) {
    try {
      const user = await this.userRepository.findOne({
        where: { id: userId } as any
      });

      if (!user) {
        return errorResponse(ErrorCode.USER_NOT_FOUND, '用户不存在');
      }

      // 更新允许的字段
      const allowedFields = ['nickname', 'email', 'phone', 'gender', 'birthDate', 'location', 'bio', 'role', 'status'];
      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          (user as any)[field] = body[field];
        }
      }

      user.updatedAt = new Date();
      await this.userRepository.save(user);

      return successResponse(this.sanitizeUser(user), '更新用户信息成功');
    } catch (error: any) {
      console.error('[AdminUserController] Update user error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '更新用户信息失败');
    }
  }

  /**
   * 删除用户
   */
  @Del('/:userId')
  @ApiOperation({ summary: '删除用户', description: '删除指定用户' })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '删除成功' }
      }
    }
  })
  @ApiParam({ name: 'userId', description: '用户ID', example: 'user-123' })
  async deleteUser(@Param('userId') userId: string) {
    try {
      const user = await this.userRepository.findOne({
        where: { id: userId } as any
      });

      if (!user) {
        return errorResponse(ErrorCode.USER_NOT_FOUND, '用户不存在');
      }

      // 不允许删除管理员
      if (user.role === UserRole.ADMIN) {
        return errorResponse(ErrorCode.PERMISSION_DENIED, '不能删除管理员用户');
      }

      await this.userRepository.remove(user);

      return successResponse(undefined, '删除用户成功');
    } catch (error: any) {
      console.error('[AdminUserController] Delete user error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '删除用户失败');
    }
  }

  /**
   * 批量删除用户
   */
  @Post('/batch-delete')
  @ApiOperation({ summary: '批量删除用户', description: '批量删除多个用户' })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '批量删除成功' },
        data: {
          type: 'object',
          properties: {
            successCount: { type: 'number', description: '成功删除数量' },
            failedCount: { type: 'number', description: '失败数量' },
            failedIds: { type: 'array', items: { type: 'string' }, description: '失败的用户ID列表' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '用户ID列表',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        userIds: {
          type: 'array',
          items: { type: 'string' },
          description: '用户ID列表'
        }
      },
      required: ['userIds']
    }
  })
  async batchDeleteUsers(@Body() body: { userIds: string[] }) {
    try {
      const { userIds } = body;

      if (!userIds || userIds.length === 0) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '用户ID列表不能为空');
      }

      if (userIds.length > 100) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '批量删除最多支持100个用户');
      }

      const successIds: string[] = [];
      const failedIds: string[] = [];

      for (const userId of userIds) {
        try {
          const user = await this.userRepository.findOne({
            where: { id: userId } as any
          });

          if (!user) {
            failedIds.push(userId);
            continue;
          }

          // 不允许删除管理员
          if (user.role === UserRole.ADMIN) {
            failedIds.push(userId);
            continue;
          }

          await this.userRepository.remove(user);
          successIds.push(userId);
        } catch (error) {
          console.error(`[AdminUserController] Delete user ${userId} error:`, error);
          failedIds.push(userId);
        }
      }

      return successResponse({
        successCount: successIds.length,
        failedCount: failedIds.length,
        failedIds
      }, `批量删除完成，成功 ${successIds.length} 个，失败 ${failedIds.length} 个`);
    } catch (error: any) {
      console.error('[AdminUserController] Batch delete users error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '批量删除失败');
    }
  }

  /**
   * 重置用户密码
   */
  @Post('/:userId/reset-password')
  @ApiOperation({ summary: '重置用户密码', description: '重置指定用户的密码' })
  @ApiResponse({
    status: 200,
    description: '重置成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '密码重置成功' },
        data: {
          type: 'object',
          properties: {
            temporaryPassword: { type: 'string', description: '临时密码' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'userId', description: '用户ID', example: 'user-123' })
  @ApiBody({
    description: '重置密码选项',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        newPassword: { type: 'string', description: '新密码（可选，不提供则生成随机密码）' }
      }
    }
  })
  async resetPassword(@Param('userId') userId: string, @Body() body: { newPassword?: string }) {
    try {
      const user = await this.userRepository.findOne({
        where: { id: userId } as any
      });

      if (!user) {
        return errorResponse(ErrorCode.USER_NOT_FOUND, '用户不存在');
      }

      // 生成或使用提供的新密码
      const newPassword = body.newPassword || PasswordUtil.generate(12);
      user.passwordHash = PasswordUtil.hash(newPassword);
      user.updatedAt = new Date();

      await this.userRepository.save(user);

      console.log(`[AdminUserController] Password reset for user ${userId} by admin`);

      return successResponse({
        temporaryPassword: newPassword
      }, '密码重置成功');
    } catch (error: any) {
      console.error('[AdminUserController] Reset password error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '密码重置失败');
    }
  }

  /**
   * 清理用户敏感信息
   */
  private sanitizeUser(user: User): any {
    const { passwordHash, ...sanitized } = user as any;
    return sanitized;
  }
}
