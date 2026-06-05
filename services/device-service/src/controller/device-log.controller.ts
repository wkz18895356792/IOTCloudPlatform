import { Controller, Get, Post, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiTags, ApiParam } from '@midwayjs/swagger';
import { DeviceLogService } from '../service/device-log.service';
import { ServiceClient } from '@baby-monitor/shared-utils';

/**
 * 设备日志控制器
 *
 * 提供设备日志打捞、查询、下载、删除等API
 */
@ApiTags('设备日志')
@Controller('/api/devices')
export class DeviceLogController {
  @Inject() ctx!: Context;
  @Inject() deviceLogService!: DeviceLogService;
  @Inject() serviceClient!: ServiceClient;

  /**
   * 触发日志打捞（平台主动下发）
   */
  @Post('/:deviceId/logs/collect')
  @ApiOperation({ summary: '触发日志打捞', description: '平台主动下发日志打捞命令到设备' })
  @ApiParam({ name: 'deviceId', description: '设备ID' })
  async collectLogs(
    @Param('deviceId') deviceId: string,
    @Body() body: any,
  ) {
    try {
      const result = await this.deviceLogService.requestLogCollection(deviceId, {
        logType: body.logType,
        description: body.description,
      });
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: { code: 'COLLECT_FAILED', message: error.message } };
    }
  }

  /**
   * 获取设备日志列表
   */
  @Get('/:deviceId/logs')
  @ApiOperation({ summary: '获取设备日志列表', description: '获取指定设备的日志列表' })
  @ApiParam({ name: 'deviceId', description: '设备ID' })
  async getDeviceLogs(
    @Param('deviceId') deviceId: string,
    @Query('logType') logType?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    try {
      const response = await this.serviceClient.get(
        'storage-service',
        `/api/storage/device-logs/device/${deviceId}?logType=${logType || ''}&status=${status || ''}&page=${page || 1}&pageSize=${pageSize || 20}`,
      );
      return response?.data || response || { success: false, error: { code: 'FETCH_FAILED', message: '获取日志列表失败' } };
    } catch (error: any) {
      return { success: false, error: { code: 'FETCH_FAILED', message: error.message } };
    }
  }

  /**
   * 获取日志下载地址
   */
  @Get('/logs/:logId/download')
  @ApiOperation({ summary: '获取日志下载地址', description: '获取指定日志的预签名下载URL' })
  @ApiParam({ name: 'logId', description: '日志ID' })
  async downloadLog(
    @Param('logId') logId: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    try {
      const response = await this.serviceClient.get(
        'storage-service',
        `/api/storage/device-logs/${logId}/download?expiresIn=${expiresIn || 3600}`,
      );
      return response?.data || response || { success: false, error: { code: 'DOWNLOAD_FAILED', message: '获取下载地址失败' } };
    } catch (error: any) {
      return { success: false, error: { code: 'DOWNLOAD_FAILED', message: error.message } };
    }
  }

  /**
   * 删除日志
   */
  @Del('/logs/:logId')
  @ApiOperation({ summary: '删除日志', description: '删除指定的日志文件和记录' })
  @ApiParam({ name: 'logId', description: '日志ID' })
  async deleteLog(@Param('logId') logId: string) {
    try {
      await this.serviceClient.delete(
        'storage-service',
        `/api/storage/device-logs/${logId}`,
      );
      return { success: true };
    } catch (error: any) {
      return { success: false, error: { code: 'DELETE_FAILED', message: error.message } };
    }
  }
}
