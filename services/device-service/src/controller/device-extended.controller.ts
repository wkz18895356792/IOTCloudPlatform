import { Controller, Get, Post, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { DeviceService } from '../service/device.service';
import { OTAService } from '../service/ota.service';
import { DeviceAnalyticsService } from '../service/device-analytics.service';
import { successResponse, errorResponse, ErrorCode } from '@baby-monitor/shared-types';

/**
 * 设备扩展控制器
 * 提供OTA升级、事件告警、统计等功能
 */
@ApiTags('设备扩展管理')
@Controller('/api/devices')
export class DeviceExtendedController {
  @Inject()
  ctx!: Context;

  @Inject()
  deviceService!: DeviceService;

  @Inject()
  otaService!: OTAService;

  @Inject()
  deviceAnalyticsService!: DeviceAnalyticsService;

  // ==================== OTA升级 ====================

  /**
   * 检查固件更新
   */
  @Get('/:deviceId/ota/check')
  @ApiOperation({ summary: '检查固件更新', description: '检查设备是否有可用的固件更新' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async checkUpdate(@Param('deviceId') deviceId: string) {
    const updateInfo = await this.otaService.checkUpdate(deviceId);
    return successResponse(updateInfo);
  }

  /**
   * 创建OTA升级任务
   */
  @Post('/:deviceId/ota')
  @ApiOperation({ summary: '创建OTA任务', description: '为设备创建固件升级任务' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: 'OTA任务信息',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        firmwareId: { type: 'string', description: '固件ID', example: 'firmware-123' },
      },
      required: ['firmwareId'],
    },
  })
  async createOTATask(@Param('deviceId') deviceId: string, @Body() body: { firmwareId: string }) {
    const userId = this.ctx.state.user.userId;
    const { hasPermission, role } = await this.deviceService.checkUserPermission(deviceId, userId);
    if (!hasPermission || role !== 'owner') {
      return errorResponse(ErrorCode.PERMISSION_DENIED, '权限不足，仅设备拥有者可操作');
    }

    const task = await this.otaService.createOTATask({
      deviceId,
      firmwareId: body.firmwareId,
      createdBy: userId,
    });

    return successResponse(task, 'OTA任务创建成功');
  }

  /**
   * 取消OTA任务
   */
  @Del('/ota/:taskId')
  @ApiOperation({ summary: '取消OTA任务', description: '取消指定的OTA升级任务' })
  @ApiParam({ name: 'taskId', description: 'OTA任务ID', example: 'ota-task-123' })
  async cancelOTATask(@Param('taskId') taskId: string) {
    await this.otaService.cancelOTATask(taskId);
    return successResponse(null, 'OTA任务已取消');
  }

  // ==================== 设备事件和告警 ====================

  /**
   * 获取设备事件
   */
  @Get('/:deviceId/events')
  @ApiOperation({ summary: '获取设备事件', description: '获取设备的事件历史记录' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiQuery({ name: 'type', description: '事件类型', required: false })
  @ApiQuery({ name: 'startTime', description: '开始时间', required: false })
  @ApiQuery({ name: 'endTime', description: '结束时间', required: false })
  @ApiQuery({ name: 'limit', description: '返回数量限制', required: false, example: 100 })
  async getDeviceEvents(@Param('deviceId') deviceId: string, @Query() query: any) {
    const { type, startTime, endTime, limit = 100 } = query;
    const events = await this.deviceAnalyticsService.getDeviceEvents(
      deviceId,
      type,
      startTime ? new Date(startTime) : undefined,
      endTime ? new Date(endTime) : undefined,
      limit
    );
    return successResponse(events);
  }

  /**
   * 获取设备告警
   */
  @Get('/:deviceId/alerts')
  @ApiOperation({ summary: '获取设备告警', description: '获取设备的告警列表' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiQuery({ name: 'acknowledged', description: '是否已确认', required: false })
  @ApiQuery({ name: 'limit', description: '返回数量限制', required: false, example: 50 })
  async getDeviceAlerts(@Param('deviceId') deviceId: string, @Query() query: any) {
    const { acknowledged, limit = 50 } = query;
    const alerts = await this.deviceAnalyticsService.getDeviceAlerts(deviceId, acknowledged, limit);
    return successResponse(alerts);
  }

  /**
   * 确认告警
   */
  @Post('/alerts/:alertId/acknowledge')
  @ApiOperation({ summary: '确认告警', description: '确认指定的设备告警' })
  @ApiParam({ name: 'alertId', description: '告警ID', example: 'alert-123' })
  async acknowledgeAlert(@Param('alertId') alertId: string) {
    const userId = this.ctx.state.user.userId;
    const alert = await this.deviceAnalyticsService.acknowledgeAlert(alertId, userId);
    return successResponse(alert, '告警已确认');
  }

  // ==================== 统计和分析 ====================

  /**
   * 获取设备统计
   */
  @Get('/:deviceId/statistics')
  @ApiOperation({ summary: '获取设备统计', description: '获取设备的运行统计数据' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getStatistics(@Param('deviceId') deviceId: string) {
    const statistics = await this.deviceAnalyticsService.getDeviceStatistics(deviceId);
    return successResponse(statistics);
  }

  /**
   * 获取设备健康报告
   */
  @Get('/:deviceId/health-report')
  @ApiOperation({ summary: '获取健康报告', description: '生成设备的健康报告' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getHealthReport(@Param('deviceId') deviceId: string) {
    const report = await this.deviceAnalyticsService.generateHealthReport(deviceId);
    return successResponse(report);
  }

  /**
   * 获取维保记录
   */
  @Get('/:deviceId/maintenance')
  @ApiOperation({ summary: '获取维保记录', description: '获取设备的维保记录列表' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiQuery({ name: 'limit', description: '返回数量限制', required: false, example: 20 })
  async getMaintenanceRecords(@Param('deviceId') deviceId: string, @Query() query: any) {
    const { limit = 20 } = query;
    const records = await this.deviceAnalyticsService.getMaintenanceRecords(deviceId, limit);
    return successResponse(records);
  }

  /**
   * 添加维保记录
   */
  @Post('/:deviceId/maintenance')
  @ApiOperation({ summary: '添加维保记录', description: '为设备添加维保记录' })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '维保记录信息',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '维保类型', example: 'routine' },
        title: { type: 'string', description: '维保标题', example: '定期保养' },
        description: { type: 'string', description: '维保描述' },
        cost: { type: 'number', description: '维保费用' },
        performedAt: { type: 'string', format: 'date-time', description: '维保时间' },
        nextMaintenanceAt: { type: 'string', format: 'date-time', description: '下次维保时间' },
      },
      required: ['type', 'title'],
    },
  })
  async addMaintenanceRecord(@Param('deviceId') deviceId: string, @Body() body: any) {
    const record = await this.deviceAnalyticsService.addMaintenanceRecord({
      deviceId,
      ...body,
    });
    return successResponse(record, '维保记录添加成功');
  }
}
