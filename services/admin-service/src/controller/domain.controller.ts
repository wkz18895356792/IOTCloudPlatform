import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiTags } from '@midwayjs/swagger';
import { DomainService } from '../service/domain.service';
import { CreateDomainDTO, UpdateDomainDTO, AddUserToDomainDTO, UpdateUserRoleDTO, DomainQueryDTO } from '../dto/domain.dto';

/**
 * 域管理控制器
 * 处理域CRUD、域用户管理等API
 */
@ApiTags('域管理')
@Controller('/api/domains')
export class DomainController {
  @Inject()
  ctx!: Context;

  @Inject()
  domainService!: DomainService;

  /**
   * 创建域
   */
  @Post('/')
  @ApiOperation({ summary: '创建域' })
  async createDomain(@Body() body: CreateDomainDTO) {
    const operatorId = this.ctx.state.user?.userId;
    const result = await this.domainService.createDomain(operatorId, body);

    if (result.success) {
      return {
        success: true,
        data: result.data,
        message: '域创建成功',
      };
    }
    return {
      success: false,
      code: 'DOMAIN_CREATE_FAILED',
      message: result.error || '域创建失败',
    };
  }

  /**
   * 获取域列表
   */
  @Get('/')
  @ApiOperation({ summary: '获取域列表' })
  async getDomains(@Query() query: DomainQueryDTO) {
    const result = await this.domainService.getDomains(query);

    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    }
    return {
      success: false,
      code: 'DOMAIN_QUERY_FAILED',
      message: result.error || '获取域列表失败',
    };
  }

  /**
   * 获取域详情
   */
  @Get('/:domainId')
  @ApiOperation({ summary: '获取域详情' })
  async getDomain(@Param('domainId') domainId: string) {
    const result = await this.domainService.getDomain(domainId);

    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    }
    return {
      success: false,
      code: 'DOMAIN_NOT_FOUND',
      message: result.error || '域不存在',
    };
  }

  /**
   * 更新域信息
   */
  @Put('/:domainId')
  @ApiOperation({ summary: '更新域信息' })
  async updateDomain(@Param('domainId') domainId: string, @Body() body: UpdateDomainDTO) {
    const operatorId = this.ctx.state.user?.userId;
    const result = await this.domainService.updateDomain(domainId, body, operatorId);

    if (result.success) {
      return {
        success: true,
        data: result.data,
        message: '域信息更新成功',
      };
    }
    return {
      success: false,
      code: 'DOMAIN_UPDATE_FAILED',
      message: result.error || '域更新失败',
    };
  }

  /**
   * 删除域
   */
  @Del('/:domainId')
  @ApiOperation({ summary: '删除域' })
  async deleteDomain(@Param('domainId') domainId: string) {
    const operatorId = this.ctx.state.user?.userId;
    const result = await this.domainService.deleteDomain(domainId, operatorId);

    if (result.success) {
      return {
        success: true,
        message: '域删除成功',
      };
    }
    return {
      success: false,
      code: 'DOMAIN_DELETE_FAILED',
      message: result.error || '域删除失败',
    };
  }

  /**
   * 添加用户到域
   */
  @Post('/:domainId/users')
  @ApiOperation({ summary: '添加用户到域' })
  async addUserToDomain(@Param('domainId') domainId: string, @Body() body: AddUserToDomainDTO) {
    const operatorId = this.ctx.state.user?.userId;
    const result = await this.domainService.addUserToDomain(domainId, operatorId, body);

    if (result.success) {
      return {
        success: true,
        data: result.data,
        message: '用户添加成功',
      };
    }
    return {
      success: false,
      code: 'ADD_USER_FAILED',
      message: result.error || '添加用户失败',
    };
  }

  /**
   * 获取域用户列表
   */
  @Get('/:domainId/users')
  @ApiOperation({ summary: '获取域用户列表' })
  async getDomainUsers(@Param('domainId') domainId: string, @Query() query: any) {
    const result = await this.domainService.getDomainUsers(domainId, query);

    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    }
    return {
      success: false,
      code: 'DOMAIN_USERS_QUERY_FAILED',
      message: result.error || '获取域用户列表失败',
    };
  }

  /**
   * 从域移除用户
   */
  @Del('/:domainId/users/:userId')
  @ApiOperation({ summary: '从域移除用户' })
  async removeUserFromDomain(@Param('domainId') domainId: string, @Param('userId') userId: string) {
    const operatorId = this.ctx.state.user?.userId;
    const result = await this.domainService.removeUserFromDomain(domainId, userId, operatorId);

    if (result.success) {
      return {
        success: true,
        message: '用户移除成功',
      };
    }
    return {
      success: false,
      code: 'REMOVE_USER_FAILED',
      message: result.error || '移除用户失败',
    };
  }

  /**
   * 更新用户域角色
   */
  @Put('/:domainId/users/:userId/role')
  @ApiOperation({ summary: '更新用户域角色' })
  async updateUserRole(@Param('domainId') domainId: string, @Param('userId') userId: string, @Body() body: UpdateUserRoleDTO) {
    const operatorId = this.ctx.state.user?.userId;
    const result = await this.domainService.updateUserRole(domainId, userId, body.role, operatorId);

    if (result.success) {
      return {
        success: true,
        data: result.data,
        message: '用户角色更新成功',
      };
    }
    return {
      success: false,
      code: 'UPDATE_ROLE_FAILED',
      message: result.error || '更新角色失败',
    };
  }

  /**
   * 获取域统计信息
   */
  @Get('/:domainId/statistics')
  @ApiOperation({ summary: '获取域统计信息' })
  async getDomainStatistics(@Param('domainId') domainId: string) {
    const stats = await this.domainService.getDomainStatistics(domainId);
    return {
      success: true,
      data: stats,
    };
  }
}
