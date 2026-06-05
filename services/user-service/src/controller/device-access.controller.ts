import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { DeviceAccessService } from '../service/device-access.service';
import { InvitationPermissions } from '../entity/user-device-invitation.entity';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 设备访问控制器
 *
 * 统一管理设备邀请、权限和访问日志。
 * 从 device-service 迁移至 user-service，权限数据集中管理。
 */
@ApiTags('设备访问管理')
@Controller('/api/device-access')
export class DeviceAccessController {
  @Inject()
  ctx!: Context;

  @Inject()
  deviceAccessService!: DeviceAccessService;

  // ==================== 邀请管理 ====================

  @Get('/:deviceId/invitations')
  @ApiOperation({ summary: '获取设备邀请列表' })
  @ApiParam({ name: 'deviceId', description: '设备ID' })
  async getInvitations(@Param('deviceId') deviceId: string) {
    const userId = this.ctx.state.user.userId;
    const invitations = await this.deviceAccessService.getDeviceInvitations(deviceId);

    const activeCount = invitations.filter(
      inv => inv.status === 'pending' || inv.status === 'accepted',
    ).length;

    return successResponse({
      invitations,
      total: invitations.length,
      remaining: Math.max(0, 5 - activeCount),
    });
  }

  @Post('/:deviceId/invitations')
  @ApiOperation({ summary: '创建设备观看邀请' })
  @ApiParam({ name: 'deviceId', description: '设备ID' })
  @ApiBody({
    description: '邀请信息',
    schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: '被邀请人手机号' },
        permissions: {
          type: 'object',
          properties: {
            read: { type: 'boolean' },
            write: { type: 'boolean' },
            delete: { type: 'boolean' },
            share: { type: 'boolean' },
            manage: { type: 'boolean' },
          },
        },
      },
      required: ['phone', 'permissions'],
    },
  })
  async createInvitation(
    @Param('deviceId') deviceId: string,
    @Body() body: { phone: string; permissions: InvitationPermissions },
  ) {
    const userId = this.ctx.state.user.userId;

    try {
      const invitation = await this.deviceAccessService.createInvitation({
        deviceId,
        inviterId: userId,
        inviteePhone: body.phone,
        permissions: body.permissions,
      });

      return successResponse({
        id: invitation.id,
        inviteePhone: invitation.inviteePhone,
        permissions: invitation.permissions,
        expiresAt: invitation.expiresAt,
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('最多只能邀请')) return errorResponse(ErrorCode.FAMILY_MEMBER_LIMIT_EXCEEDED, message);
      if (message.includes('已被邀请')) return errorResponse(ErrorCode.RESOURCE_ALREADY_EXISTS, message);
      if (message.includes('只有设备所有者')) return errorResponse(ErrorCode.PERMISSION_DENIED, message);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, message);
    }
  }

  @Post('/invitations/accept-by-code')
  @ApiOperation({ summary: '通过验证码接受邀请' })
  @ApiBody({
    description: '手机号和验证码',
    schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: '接收邀请的手机号' },
        code: { type: 'string', description: '短信验证码' },
      },
      required: ['phone', 'code'],
    },
  })
  async acceptByCode(@Body() body: { phone: string; code: string }) {
    const userId = this.ctx.state.user.userId;

    if (!body.phone || !body.code) {
      return errorResponse(ErrorCode.INVALID_PARAMS, '手机号和验证码不能为空');
    }

    try {
      const invitation = await this.deviceAccessService.acceptInvitationByCode(
        userId,
        body.phone,
        body.code,
      );

      return successResponse({
        id: invitation.id,
        deviceId: invitation.deviceId,
        permissions: invitation.permissions,
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('未找到')) return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, message);
      if (message.includes('验证码错误')) return errorResponse(ErrorCode.VERIFICATION_CODE_ERROR, message);
      if (message.includes('已过期')) return errorResponse(ErrorCode.INVITE_CODE_EXPIRED, message);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, message);
    }
  }

  @Post('/invitations/:inviteId/accept')
  @ApiOperation({ summary: '接受邀请' })
  @ApiParam({ name: 'inviteId', description: '邀请ID' })
  async acceptInvitation(@Param('inviteId') inviteId: string) {
    const userId = this.ctx.state.user.userId;

    try {
      const invitation = await this.deviceAccessService.acceptInvitation(inviteId, userId);
      return successResponse({
        id: invitation.id,
        deviceId: invitation.deviceId,
        permissions: invitation.permissions,
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('不存在')) return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, message);
      if (message.includes('已被处理')) return errorResponse(ErrorCode.RESOURCE_CONFLICT, message);
      if (message.includes('已过期')) return errorResponse(ErrorCode.INVITE_CODE_EXPIRED, message);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, message);
    }
  }

  @Post('/invitations/:inviteId/reject')
  @ApiOperation({ summary: '拒绝邀请' })
  @ApiParam({ name: 'inviteId', description: '邀请ID' })
  async rejectInvitation(@Param('inviteId') inviteId: string) {
    try {
      await this.deviceAccessService.rejectInvitation(inviteId);
      return successResponse(undefined, '邀请已拒绝');
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('不存在')) return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, message);
      if (message.includes('已被处理')) return errorResponse(ErrorCode.RESOURCE_CONFLICT, message);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, message);
    }
  }

  @Del('/invitations/:inviteId')
  @ApiOperation({ summary: '删除邀请' })
  @ApiParam({ name: 'inviteId', description: '邀请ID' })
  async deleteInvitation(@Param('inviteId') inviteId: string) {
    const userId = this.ctx.state.user.userId;

    try {
      await this.deviceAccessService.deleteInvitation(inviteId, userId);
      return successResponse(undefined, '邀请已删除');
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('不存在')) return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, message);
      if (message.includes('只有邀请者')) return errorResponse(ErrorCode.PERMISSION_DENIED, message);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, message);
    }
  }

  @Put('/invitations/:inviteId/permissions')
  @ApiOperation({ summary: '更新邀请权限' })
  @ApiParam({ name: 'inviteId', description: '邀请ID' })
  async updatePermissions(
    @Param('inviteId') inviteId: string,
    @Body() body: { permissions: InvitationPermissions },
  ) {
    const userId = this.ctx.state.user.userId;

    try {
      const invitation = await this.deviceAccessService.updateInvitationPermissions(
        inviteId,
        userId,
        body.permissions,
      );
      return successResponse({ id: invitation.id, permissions: invitation.permissions });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('不存在')) return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, message);
      if (message.includes('只有邀请者')) return errorResponse(ErrorCode.PERMISSION_DENIED, message);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, message);
    }
  }

  // ==================== 权限查询 ====================

  @Get('/devices')
  @ApiOperation({ summary: '获取用户可观看的设备列表' })
  async getViewableDevices() {
    const userId = this.ctx.state.user.userId;
    const devices = await this.deviceAccessService.getUserViewableDevices(userId);
    return successResponse({ devices });
  }

  @Get('/:deviceId/permissions')
  @ApiOperation({ summary: '获取设备权限' })
  @ApiParam({ name: 'deviceId', description: '设备ID' })
  async getDevicePermissions(@Param('deviceId') deviceId: string) {
    const userId = this.ctx.state.user.userId;
    const result = await this.deviceAccessService.getUserPermissions(userId, deviceId);

    if (!result) {
      return errorResponse(ErrorCode.PERMISSION_DENIED, '无权访问该设备');
    }

    return successResponse({
      permissions: result.permissions,
      isOwner: result.isOwner,
    });
  }

  // ==================== 观看记录 ====================

  @Post('/:deviceId/viewing/start')
  @ApiOperation({ summary: '开始观看' })
  @ApiParam({ name: 'deviceId', description: '设备ID' })
  async startViewing(@Param('deviceId') deviceId: string) {
    const userId = this.ctx.state.user.userId;

    const permResult = await this.deviceAccessService.getUserPermissions(userId, deviceId);
    if (!permResult || !permResult.permissions.read) {
      return errorResponse(ErrorCode.PERMISSION_DENIED, '无权观看该设备');
    }

    const history = await this.deviceAccessService.startViewing(deviceId, userId);
    return successResponse({ historyId: history.id });
  }

  @Post('/:deviceId/viewing/end')
  @ApiOperation({ summary: '结束观看' })
  @ApiParam({ name: 'deviceId', description: '设备ID' })
  async endViewing(@Param('deviceId') deviceId: string, @Body() body: { historyId: string }) {
    await this.deviceAccessService.endViewing(body.historyId);
    return successResponse({ duration: 0 });
  }

  @Get('/:deviceId/viewing/history')
  @ApiOperation({ summary: '获取观看历史' })
  @ApiParam({ name: 'deviceId', description: '设备ID' })
  @ApiQuery({ name: 'userId', description: '用户ID筛选', required: false })
  @ApiQuery({ name: 'limit', description: '返回数量', required: false })
  @ApiQuery({ name: 'offset', description: '偏移量', required: false })
  async getViewingHistory(@Param('deviceId') deviceId: string, @Query() query: any) {
    const userId = this.ctx.state.user.userId;

    const permResult = await this.deviceAccessService.getUserPermissions(userId, deviceId);
    if (!permResult || !permResult.isOwner) {
      return errorResponse(ErrorCode.PERMISSION_DENIED, '只有设备所有者可以查看观看历史');
    }

    const result = await this.deviceAccessService.getViewingHistory(deviceId, {
      userId: query.userId,
      limit: query.limit ? parseInt(query.limit) : 50,
      offset: query.offset ? parseInt(query.offset) : 0,
    });

    return successResponse(result);
  }

  @Del('/:deviceId/viewing/history')
  @ApiOperation({ summary: '清空观看历史' })
  @ApiParam({ name: 'deviceId', description: '设备ID' })
  @ApiQuery({ name: 'beforeDate', description: '清空指定日期之前的记录', required: false })
  async clearViewingHistory(
    @Param('deviceId') deviceId: string,
    @Query() query: { beforeDate?: string },
  ) {
    const userId = this.ctx.state.user.userId;

    const permResult = await this.deviceAccessService.getUserPermissions(userId, deviceId);
    if (!permResult || !permResult.isOwner) {
      return errorResponse(ErrorCode.PERMISSION_DENIED, '只有设备所有者可以清空观看历史');
    }

    const beforeDate = query.beforeDate ? new Date(query.beforeDate) : undefined;
    await this.deviceAccessService.clearViewingHistory(deviceId, beforeDate);

    return successResponse(undefined, '观看历史已清空');
  }
}
