import { Provide, Inject, Init, Config } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { Context } from '@midwayjs/koa';
import { Domain, DomainStatus, DomainType } from '../entity/domain.entity';
import { DomainRole, DomainRoleLevel } from '../entity/domain-role.entity';
import { DomainAuditLog, AuditAction } from '../entity/domain-audit-log.entity';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { ServiceClient, SqlSafeUtil } from '@baby-monitor/shared-utils';

/**
 * 域服务
 * 处理域管理、域用户管理、域权限管理等核心业务逻辑
 */
@Provide()
export class DomainService {
  @Inject()
  ctx!: Context;

  @Inject()
  logger!: ILogger;

  @Inject()
  redisService!: RedisService;

  @Inject()
  serviceClient!: ServiceClient;

  @InjectEntityModel(Domain)
  domainRepository!: Repository<Domain>;

  @InjectEntityModel(DomainRole)
  domainRoleRepository!: Repository<DomainRole>;

  @InjectEntityModel(DomainAuditLog)
  domainAuditLogRepository!: Repository<DomainAuditLog>;

  @Config('domain')
  domainConfig: any;

  /**
   * 创建域
   */
  async createDomain(operatorId: string, data: any): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      // 检查域编码是否已存在
      const existingDomain = await this.domainRepository.findOne({
        where: { code: data.code }
      });

      if (existingDomain) {
        return { success: false, error: '域编码已存在' };
      }

      // 创建域
      const domain = new Domain();
      domain.code = data.code;
      domain.name = data.name;
      domain.description = data.description || '';
      domain.type = data.type || DomainType.TRIAL;
      domain.status = DomainStatus.ACTIVE;
      domain.ownerId = data.ownerId || operatorId;
      domain.userLimit = data.userLimit || this.domainConfig.defaultQuota.userLimit;
      domain.deviceLimit = data.deviceLimit || this.domainConfig.defaultQuota.deviceLimit;
      domain.storageLimit = data.storageLimit || this.domainConfig.defaultQuota.storageLimit;
      domain.config = data.config || {};

      // 设置试用到期时间
      if (domain.type === DomainType.TRIAL) {
        const trialDays = this.domainConfig.trialPeriodDays || 30;
        domain.trialExpiresAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
      }

      const savedDomain = await this.domainRepository.save(domain);

      // 自动将创建者设为域管理员
      await this.addUserToDomain(savedDomain.id, operatorId, {
        userId: operatorId,
        role: DomainRoleLevel.DOMAIN_ADMIN
      }, operatorId);

      // 记录审计日志
      await this.createAuditLog({
        domainId: savedDomain.id,
        userId: operatorId,
        username: this.ctx.state.user?.username || 'system',
        action: AuditAction.DOMAIN_CREATE,
        details: `创建域: ${domain.name} (${domain.code})`,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent'),
      });

      // 清除域列表缓存
      await this.clearDomainCache();

      return { success: true, data: savedDomain };
    } catch (error: any) {
      this.logger.error('[DomainService] 创建域失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取域列表
   */
  async getDomains(query: any): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const { code, status, type, page = 1, pageSize = 20 } = query;

      const queryBuilder = this.domainRepository.createQueryBuilder('domain');

      // 过滤条件
      if (code) {
        queryBuilder.andWhere('domain.code LIKE :code', { code: SqlSafeUtil.likeContains(code) });
      }
      if (status) {
        queryBuilder.andWhere('domain.status = :status', { status });
      }
      if (type) {
        queryBuilder.andWhere('domain.type = :type', { type });
      }

      // 排除已删除的域
      queryBuilder.andWhere('domain.status != :deletedStatus', { deletedStatus: DomainStatus.DELETED });

      // 分页
      queryBuilder
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .orderBy('domain.createdAt', 'DESC');

      const [domains, total] = await queryBuilder.getManyAndCount();

      return {
        success: true,
        data: {
          list: domains,
          total,
          page: parseInt(page),
          pageSize: parseInt(pageSize),
        }
      };
    } catch (error: any) {
      this.logger.error('[DomainService] 获取域列表失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取域详情
   */
  async getDomain(domainId: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const domain = await this.domainRepository.findOne({
        where: { id: domainId }
      });

      if (!domain) {
        return { success: false, error: '域不存在' };
      }

      // 获取域统计信息
      const stats = await this.getDomainStatistics(domainId);

      return {
        success: true,
        data: {
          ...domain,
          statistics: stats,
        }
      };
    } catch (error: any) {
      this.logger.error('[DomainService] 获取域详情失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 更新域信息
   */
  async updateDomain(domainId: string, data: any, operatorId: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const domain = await this.domainRepository.findOne({
        where: { id: domainId }
      });

      if (!domain) {
        return { success: false, error: '域不存在' };
      }

      // 更新字段
      const updateData: any = {};
      const allowedFields = ['name', 'description', 'type', 'status', 'userLimit', 'deviceLimit', 'storageLimit', 'config'];
      allowedFields.forEach(field => {
        if (data[field] !== undefined) {
          updateData[field] = data[field];
        }
      });

      await this.domainRepository.update(domainId, updateData);

      // 记录审计日志
      await this.createAuditLog({
        domainId,
        userId: operatorId,
        username: this.ctx.state.user?.username || 'system',
        action: AuditAction.DOMAIN_UPDATE,
        details: `更新域信息: ${JSON.stringify(updateData)}`,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent'),
      });

      // 清除缓存
      await this.clearDomainCache(domainId);

      const updated = await this.domainRepository.findOne({ where: { id: domainId } });
      return { success: true, data: updated };
    } catch (error: any) {
      this.logger.error('[DomainService] 更新域失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除域（软删除）
   */
  async deleteDomain(domainId: string, operatorId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const domain = await this.domainRepository.findOne({
        where: { id: domainId }
      });

      if (!domain) {
        return { success: false, error: '域不存在' };
      }

      // 软删除
      await this.domainRepository.update(domainId, {
        status: DomainStatus.DELETED,
        deletedAt: new Date(),
      });

      // 记录审计日志
      await this.createAuditLog({
        domainId,
        userId: operatorId,
        username: this.ctx.state.user?.username || 'system',
        action: AuditAction.DOMAIN_DELETE,
        details: `删除域: ${domain.name} (${domain.code})`,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent'),
      });

      // 清除缓存
      await this.clearDomainCache(domainId);

      return { success: true };
    } catch (error: any) {
      this.logger.error('[DomainService] 删除域失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 添加用户到域
   */
  async addUserToDomain(domainId: string, operatorId: string, data: any, auditOperatorId?: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const domain = await this.domainRepository.findOne({
        where: { id: domainId }
      });

      if (!domain) {
        return { success: false, error: '域不存在' };
      }

      // 检查用户是否已在域中
      const existingRole = await this.domainRoleRepository.findOne({
        where: { domainId, userId: data.userId }
      });

      if (existingRole) {
        return { success: false, error: '用户已在该域中' };
      }

      // 创建域角色
      const domainRole = new DomainRole();
      domainRole.domainId = domainId;
      domainRole.userId = data.userId;
      domainRole.role = data.role || DomainRoleLevel.DOMAIN_USER;
      domainRole.customPermissions = data.customPermissions || [];
      domainRole.isActive = true;

      const saved = await this.domainRoleRepository.save(domainRole);

      // 记录审计日志
      await this.createAuditLog({
        domainId,
        userId: auditOperatorId || operatorId,
        username: this.ctx.state.user?.username || 'system',
        action: AuditAction.USER_ADD,
        details: `添加用户到域: userId=${data.userId}, role=${domainRole.role}`,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent'),
      });

      // 清除域用户列表缓存
      await this.clearDomainUsersCache(domainId);

      return { success: true, data: saved };
    } catch (error: any) {
      this.logger.error('[DomainService] 添加用户到域失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取域用户列表
   */
  async getDomainUsers(domainId: string, query: any): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const { page = 1, pageSize = 20, role } = query;

      const queryBuilder = this.domainRoleRepository.createQueryBuilder('dr')
        .leftJoinAndSelect('dr.domain', 'domain')
        .where('dr.domainId = :domainId', { domainId });

      if (role) {
        queryBuilder.andWhere('dr.role = :role', { role });
      }

      queryBuilder
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .orderBy('dr.createdAt', 'DESC');

      const [roles, total] = await queryBuilder.getManyAndCount();

      return {
        success: true,
        data: {
          list: roles,
          total,
          page: parseInt(page),
          pageSize: parseInt(pageSize),
        }
      };
    } catch (error: any) {
      this.logger.error('[DomainService] 获取域用户列表失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 从域移除用户
   */
  async removeUserFromDomain(domainId: string, userId: string, operatorId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.domainRoleRepository.delete({
        domainId,
        userId,
      });

      if (result.affected === 0) {
        return { success: false, error: '用户不在该域中' };
      }

      // 记录审计日志
      await this.createAuditLog({
        domainId,
        userId: operatorId,
        username: this.ctx.state.user?.username || 'system',
        action: AuditAction.USER_REMOVE,
        details: `从域移除用户: userId=${userId}`,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent'),
      });

      // 清除缓存
      await this.clearDomainUsersCache(domainId);

      return { success: true };
    } catch (error: any) {
      this.logger.error('[DomainService] 移除用户失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 更新用户域角色
   */
  async updateUserRole(domainId: string, userId: string, role: string, operatorId: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const domainRole = await this.domainRoleRepository.findOne({
        where: { domainId, userId }
      });

      if (!domainRole) {
        return { success: false, error: '用户不在该域中' };
      }

      const oldRole = domainRole.role;
      domainRole.role = role as DomainRoleLevel;

      const updated = await this.domainRoleRepository.save(domainRole);

      // 记录审计日志
      await this.createAuditLog({
        domainId,
        userId: operatorId,
        username: this.ctx.state.user?.username || 'system',
        action: AuditAction.USER_ROLE_CHANGE,
        details: `更新用户角色: userId=${userId}, ${oldRole} -> ${role}`,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent'),
      });

      // 清除缓存
      await this.clearDomainUsersCache(domainId);

      return { success: true, data: updated };
    } catch (error: any) {
      this.logger.error('[DomainService] 更新用户角色失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取域统计信息
   */
  async getDomainStatistics(domainId: string): Promise<any> {
    try {
      // 用户数量
      const userCount = await this.domainRoleRepository.count({
        where: { domainId, isActive: true }
      });

      // 设备数量 - 通过 device-service API 获取
      let deviceCount = 0;
      try {
        const deviceResponse = await this.serviceClient.get('device-service', '/api/devices/count', { domainId });
        deviceCount = deviceResponse.data?.count || 0;
      } catch (error) {
        this.logger.warn('[DomainService] Failed to get device count:', error);
      }

      // 存储使用量 - 通过 storage-service API 获取
      let storageUsed = 0;
      try {
        const storageResponse = await this.serviceClient.get('storage-service', '/api/storage/usage', { domainId });
        storageUsed = storageResponse.data?.bytesUsed || 0;
      } catch (error) {
        this.logger.warn('[DomainService] Failed to get storage usage:', error);
      }

      return {
        userCount,
        deviceCount,
        storageUsed,
      };
    } catch (error: any) {
      this.logger.error('[DomainService] 获取域统计失败:', error);
      return {
        userCount: 0,
        deviceCount: 0,
        storageUsed: 0,
      };
    }
  }

  /**
   * 创建审计日志
   */
  private async createAuditLog(data: any): Promise<void> {
    try {
      const auditLog = new DomainAuditLog();
      auditLog.domainId = data.domainId;
      auditLog.userId = data.userId;
      auditLog.username = data.username;
      auditLog.action = data.action;
      auditLog.details = data.details;
      auditLog.ip = data.ip;
      auditLog.userAgent = data.userAgent;
      auditLog.metadata = data.metadata || {};

      await this.domainAuditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error('[DomainService] 创建审计日志失败:', error);
    }
  }

  /**
   * 清除域缓存
   */
  private async clearDomainCache(domainId?: string): Promise<void> {
    try {
      if (domainId) {
        await this.redisService.del(`domain:${domainId}`);
      }
      await this.redisService.del('domain:list');
    } catch (error) {
      this.logger.error('[DomainService] 清除缓存失败:', error);
    }
  }

  /**
   * 清除域用户列表缓存
   */
  private async clearDomainUsersCache(domainId: string): Promise<void> {
    try {
      await this.redisService.del(`domain:${domainId}:users`);
    } catch (error) {
      this.logger.error('[DomainService] 清除用户缓存失败:', error);
    }
  }
}
