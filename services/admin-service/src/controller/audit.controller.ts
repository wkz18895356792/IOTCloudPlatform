import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiTags, ApiResponse } from '@midwayjs/swagger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, Like, Between } from 'typeorm';
import { DomainAuditLog, AuditAction } from '../entity/domain-audit-log.entity';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 审计日志查询参数
 */
interface AuditLogQuery {
  domainId?: string;
  userId?: string;
  action?: AuditAction;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 审计日志控制器
 */
@ApiTags('审计日志')
@Controller('/api/admin/audit-logs')
export class AuditController {
  @Inject()
  ctx!: Context;

  @InjectEntityModel(DomainAuditLog)
  domainAuditLogRepository!: Repository<DomainAuditLog>;

  // 导出文件存储目录
  private readonly exportDir = path.join(process.cwd(), 'exports');

  constructor() {
    // 确保导出目录存在
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }
  }

  /**
   * 获取审计日志列表
   */
  @Get()
  @ApiOperation({ summary: '获取审计日志列表' })
  async getAuditLogs(@Query() query: AuditLogQuery) {
    try {
      const {
        domainId,
        userId,
        action,
        startDate,
        endDate,
        page = 1,
        pageSize = 20,
      } = query;

      const queryBuilder = this.domainAuditLogRepository.createQueryBuilder('log');

      // 过滤条件
      if (domainId) {
        queryBuilder.andWhere('log.domainId = :domainId', { domainId });
      }

      if (userId) {
        queryBuilder.andWhere('log.userId = :userId', { userId });
      }

      if (action) {
        queryBuilder.andWhere('log.action = :action', { action });
      }

      if (startDate && endDate) {
        queryBuilder.andWhere('log.createdAt BETWEEN :startDate AND :endDate', {
          startDate: new Date(startDate),
          endDate: new Date(endDate),
        });
      }

      // 分页
      queryBuilder
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .orderBy('log.createdAt', 'DESC');

      const [logs, total] = await queryBuilder.getManyAndCount();

      return {
        success: true,
        data: {
          logs,
          total,
          page,
          pageSize,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        code: 'AUDIT_LOGS_ERROR',
        message: error.message || '获取审计日志失败',
      };
    }
  }

  /**
   * 获取审计日志详情
   */
  @Get('/:logId')
  @ApiOperation({ summary: '获取审计日志详情' })
  async getAuditLogDetail(@Param('logId') logId: string) {
    try {
      const log = await this.domainAuditLogRepository.findOne({
        where: { id: logId },
      });

      if (!log) {
        return {
          success: false,
          code: 'AUDIT_LOG_NOT_FOUND',
          message: '审计日志不存在',
        };
      }

      return {
        success: true,
        data: log,
      };
    } catch (error: any) {
      return {
        success: false,
        code: 'AUDIT_LOG_DETAIL_ERROR',
        message: error.message || '获取审计日志详情失败',
      };
    }
  }

  /**
   * 按域统计审计日志
   */
  @Get('/statistics/by-domain')
  @ApiOperation({ summary: '按域统计审计日志' })
  async getAuditLogsByDomain(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    try {
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const logs = await this.domainAuditLogRepository
        .createQueryBuilder('log')
        .select('log.domainId', 'COUNT(*) as count')
        .where('log.createdAt BETWEEN :start AND :end', { start, end })
        .groupBy('log.domainId')
        .orderBy('count', 'DESC')
        .getRawMany();

      return {
        success: true,
        data: logs,
      };
    } catch (error: any) {
      return {
        success: false,
        code: 'AUDIT_LOGS_STATISTICS_ERROR',
        message: error.message || '获取审计日志统计失败',
      };
    }
  }

  /**
   * 按操作类型统计审计日志
   */
  @Get('/statistics/by-action')
  @ApiOperation({ summary: '按操作类型统计审计日志' })
  async getAuditLogsByAction(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    try {
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const logs = await this.domainAuditLogRepository
        .createQueryBuilder('log')
        .select('log.action', 'COUNT(*) as count')
        .where('log.createdAt BETWEEN :start AND :end', { start, end })
        .groupBy('log.action')
        .orderBy('count', 'DESC')
        .getRawMany();

      return {
        success: true,
        data: logs,
      };
    } catch (error: any) {
      return {
        success: false,
        code: 'AUDIT_LOGS_STATISTICS_ERROR',
        message: error.message || '获取审计日志统计失败',
      };
    }
  }

  /**
   * 导出审计日志
   */
  @Get('/export')
  @ApiOperation({ summary: '导出审计日志' })
  @ApiResponse({
    status: 200,
    description: '导出成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            format: { type: 'string' },
            count: { type: 'number' },
            downloadUrl: { type: 'string' }
          }
        }
      }
    }
  })
  async exportAuditLogs(
    @Query('domainId') domainId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('format') format: 'excel' | 'csv' = 'excel',
  ) {
    try {
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const queryBuilder = this.domainAuditLogRepository.createQueryBuilder('log');

      if (domainId) {
        queryBuilder.andWhere('log.domainId = :domainId', { domainId });
      }

      queryBuilder
        .where('log.createdAt BETWEEN :start AND :end', { start, end })
        .orderBy('log.createdAt', 'DESC');

      const logs = await queryBuilder.getMany();

      if (logs.length === 0) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '没有符合条件的审计日志');
      }

      // 生成文件
      const timestamp = new Date().getTime();
      const filename = `audit-logs-${timestamp}.${format === 'excel' ? 'xlsx' : 'csv'}`;
      const filepath = path.join(this.exportDir, filename);

      if (format === 'excel') {
        await this.generateExcelFile(logs, filepath);
      } else {
        await this.generateCsvFile(logs, filepath);
      }

      // 生成下载 token（使用时间戳作为简单 token）
      const downloadToken = Buffer.from(`${filename}:${Date.now() + 3600000}`).toString('base64');

      return successResponse({
        format,
        count: logs.length,
        downloadUrl: `/api/admin/audit-logs/download?token=${downloadToken}`,
      });
    } catch (error: any) {
      console.error('[AuditController] Export audit logs error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '导出审计日志失败');
    }
  }

  /**
   * 下载审计日志文件
   */
  @Get('/download')
  @ApiOperation({ summary: '下载审计日志文件' })
  @ApiResponse({
    status: 200,
    description: '文件下载',
    schema: {
      type: 'string',
      format: 'binary'
    }
  })
  async downloadAuditLogs(@Query('token') token: string) {
    try {
      // 解析 token
      let filename: string;
      let expiresAt: number;

      try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [file, expiry] = decoded.split(':');
        filename = file;
        expiresAt = parseInt(expiry);
      } catch (e) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '无效的下载令牌');
      }

      // 检查 token 是否过期
      if (Date.now() > expiresAt) {
        return errorResponse(ErrorCode.TOKEN_EXPIRED, '下载令牌已过期');
      }

      // 验证文件名，防止路径遍历攻击
      if (!filename.startsWith('audit-logs-') || filename.includes('..')) {
        return errorResponse(ErrorCode.INVALID_PARAMS, '无效的文件名');
      }

      const filepath = path.join(this.exportDir, filename);

      // 检查文件是否存在
      if (!fs.existsSync(filepath)) {
        return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, '文件不存在或已过期');
      }

      // 设置响应头
      const contentType = filename.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8';

      // 读取文件内容
      const fileContent = fs.readFileSync(filepath);

      // 设置响应
      this.ctx.type = contentType;
      this.ctx.attachment(filename);
      this.ctx.body = fileContent;

      return;

      // 下载后删除文件（延迟删除）
      setTimeout(() => {
        try {
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        } catch (e) {
          console.error('[AuditController] Failed to delete export file:', e);
        }
      }, 1000);

      return;
    } catch (error: any) {
      console.error('[AuditController] Download audit logs error:', error);
      return errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, '下载审计日志失败');
    }
  }

  /**
   * 生成 Excel 文件
   */
  private async generateExcelFile(logs: DomainAuditLog[], filepath: string): Promise<void> {
    const workbook = XLSX.utils.book_new();

    // 转换数据为 Excel 格式
    const data = logs.map(log => ({
      'ID': log.id,
      '域ID': log.domainId,
      '用户ID': log.userId,
      '用户名': log.username,
      '操作': log.action,
      '详情': log.details,
      'IP地址': log.ip,
      '用户代理': log.userAgent || '',
      '元数据': log.metadata ? JSON.stringify(log.metadata) : '',
      '创建时间': log.createdAt.toISOString(),
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);

    // 设置列宽
    worksheet['!cols'] = [
      { wch: 25 }, // ID
      { wch: 25 }, // 域ID
      { wch: 25 }, // 用户ID
      { wch: 20 }, // 用户名
      { wch: 20 }, // 操作
      { wch: 50 }, // 详情
      { wch: 15 }, // IP地址
      { wch: 30 }, // 用户代理
      { wch: 30 }, // 元数据
      { wch: 25 }, // 创建时间
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, '审计日志');

    XLSX.writeFile(workbook, filepath);
  }

  /**
   * 生成 CSV 文件
   */
  private async generateCsvFile(logs: DomainAuditLog[], filepath: string): Promise<void> {
    const { createObjectCsvWriter } = require('csv-writer');

    const csvWriter = createObjectCsvWriter({
      path: filepath,
      header: [
        { id: 'id', title: 'ID' },
        { id: 'domainId', title: '域ID' },
        { id: 'userId', title: '用户ID' },
        { id: 'username', title: '用户名' },
        { id: 'action', title: '操作' },
        { id: 'details', title: '详情' },
        { id: 'ip', title: 'IP地址' },
        { id: 'userAgent', title: '用户代理' },
        { id: 'metadata', title: '元数据' },
        { id: 'createdAt', title: '创建时间' },
      ],
      encoding: 'utf8',
    });

    const data = logs.map(log => ({
      id: log.id,
      domainId: log.domainId,
      userId: log.userId,
      username: log.username,
      action: log.action,
      details: log.details,
      ip: log.ip,
      userAgent: log.userAgent || '',
      metadata: log.metadata ? JSON.stringify(log.metadata) : '',
      createdAt: log.createdAt.toISOString(),
    }));

    await csvWriter.writeRecords(data);
  }
}
