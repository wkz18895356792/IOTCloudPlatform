import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { PlatformAdminService } from '../service/platform-admin.service';
import { PlatformAdminRole, PlatformAdminStatus } from '../entity/platform-admin.entity';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 平台管理员控制器
 * 管理平台管理员账户
 */
@ApiTags('平台管理员')
@Controller('/api/admin/platform-admins')
export class PlatformAdminController {
  @Inject()
  platformAdminService!: PlatformAdminService;

  /**
   * 创建平台管理员
   */
  @Post('/')
  @ApiOperation({ summary: '创建平台管理员', description: '创建新的平台管理员账户' })
  @ApiResponse({
    status: 200,
    description: '创建成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' },
        message: { type: 'string' }
      }
    }
  })
  @ApiBody({
    description: '管理员信息',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: '用户名' },
        email: { type: 'string', description: '邮箱' },
        password: { type: 'string', description: '密码' },
        role: {
          type: 'string',
          enum: ['super_admin', 'ops_admin', 'read_only_admin'],
          description: '角色'
        },
        nickname: { type: 'string', description: '昵称' },
        remark: { type: 'string', description: '备注' },
      },
      required: ['username', 'email', 'password', 'role']
    }
  })
  async createAdmin(@Body() body: any) {
    const result = await this.platformAdminService.createAdmin(body);
    if (result.success) {
      return successResponse(result.data, '创建管理员成功');
    }
    return errorResponse(ErrorCode.INVALID_PARAMS, result.error || '创建管理员失败');
  }

  /**
   * 获取管理员列表
   */
  @Get('/')
  @ApiOperation({ summary: '获取管理员列表', description: '分页获取平台管理员列表' })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
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
  @ApiQuery({ name: 'keyword', description: '搜索关键词（用户名/邮箱）', required: false })
  @ApiQuery({ name: 'role', description: '角色', required: false })
  @ApiQuery({ name: 'status', description: '状态', required: false })
  async getAdminList(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
    @Query('keyword') keyword?: string,
    @Query('role') role?: PlatformAdminRole,
    @Query('status') status?: PlatformAdminStatus
  ) {
    const result = await this.platformAdminService.getAdminList({
      page,
      pageSize,
      keyword,
      role,
      status,
    });

    if (result.success) {
      return successResponse(result.data);
    }
    return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '获取管理员列表失败');
  }

  /**
   * 获取管理员详情
   */
  @Get('/:adminId')
  @ApiOperation({ summary: '获取管理员详情', description: '根据ID获取管理员详细信息' })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' }
      }
    }
  })
  @ApiParam({ name: 'adminId', description: '管理员ID', example: 'admin-123' })
  async getAdmin(@Param('adminId') adminId: string) {
    const result = await this.platformAdminService.getAdmin(adminId);

    if (result.success) {
      return successResponse(result.data);
    }
    return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, result.error || '管理员不存在');
  }

  /**
   * 更新管理员信息
   */
  @Put('/:adminId')
  @ApiOperation({ summary: '更新管理员信息', description: '更新指定管理员的信息' })
  @ApiResponse({
    status: 200,
    description: '更新成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  @ApiParam({ name: 'adminId', description: '管理员ID', example: 'admin-123' })
  @ApiBody({
    description: '更新内容',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: '邮箱' },
        password: { type: 'string', description: '新密码' },
        role: { type: 'string', description: '角色' },
        status: { type: 'string', description: '状态' },
        nickname: { type: 'string', description: '昵称' },
        avatar: { type: 'string', description: '头像' },
        permissions: { type: 'array', items: { type: 'string' }, description: '权限列表' },
        remark: { type: 'string', description: '备注' },
      }
    }
  })
  async updateAdmin(@Param('adminId') adminId: string, @Body() body: any) {
    const result = await this.platformAdminService.updateAdmin(adminId, body);

    if (result.success) {
      return successResponse(result.data, '更新管理员成功');
    }
    return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, result.error || '更新管理员失败');
  }

  /**
   * 删除管理员
   */
  @Del('/:adminId')
  @ApiOperation({ summary: '删除管理员', description: '删除指定的管理员' })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  @ApiParam({ name: 'adminId', description: '管理员ID', example: 'admin-123' })
  async deleteAdmin(@Param('adminId') adminId: string) {
    const result = await this.platformAdminService.deleteAdmin(adminId);

    if (result.success) {
      return successResponse(undefined, '删除管理员成功');
    }
    return errorResponse(ErrorCode.PERMISSION_DENIED, result.error || '删除管理员失败');
  }

  /**
   * 重置管理员密码
   */
  @Post('/:adminId/reset-password')
  @ApiOperation({ summary: '重置管理员密码', description: '重置指定管理员的密码' })
  @ApiResponse({
    status: 200,
    description: '重置成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            temporaryPassword: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'adminId', description: '管理员ID', example: 'admin-123' })
  @ApiBody({
    description: '重置选项',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        newPassword: { type: 'string', description: '新密码（可选，不提供则生成随机密码）' }
      }
    }
  })
  async resetPassword(@Param('adminId') adminId: string, @Body() body: { newPassword?: string }) {
    const result = await this.platformAdminService.resetPassword(adminId, body.newPassword);

    if (result.success) {
      return successResponse(result.data, '密码重置成功');
    }
    return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '密码重置失败');
  }
}
