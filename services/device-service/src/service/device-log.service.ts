import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { ServiceClient, IdGenerator } from '@baby-monitor/shared-utils';
import { LogTriggerType } from '@baby-monitor/shared-types';
import { GatewayCommandService } from './gateway-command.service';

/**
 * 设备日志服务
 *
 * 负责平台主动日志打捞的编排逻辑：
 * 1. 调用 storage-service 获取预签名上传URL
 * 2. 通过 device-gateway 下发 collect_logs 命令到设备
 * 3. 处理设备上报的打捞结果
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class DeviceLogService {
  @Inject() logger!: ILogger;
  @Inject() serviceClient!: ServiceClient;
  @Inject() gatewayCommandService!: GatewayCommandService;

  private readonly STORAGE_SERVICE = 'storage-service';

  /**
   * 请求日志打捞（平台主动）
   */
  async requestLogCollection(
    deviceId: string,
    options?: {
      logType?: string;
      description?: string;
    },
  ): Promise<{ taskId: string; logId: string; fileKey: string; uploadUrl: string; expiresAt: string }> {
    this.logger.info(`[DeviceLog] Requesting log collection for device: ${deviceId}`);

    // 1. 调用 storage-service 获取预签名URL
    const response = await this.serviceClient.post(
      this.STORAGE_SERVICE,
      '/api/storage/device-logs/upload-url',
      {
        deviceId,
        requestId: IdGenerator.uuid(),
        logType: options?.logType || 'system',
        description: options?.description,
        triggerType: LogTriggerType.PLATFORM_INITIATED,
      },
    );

    if (!response || response.code !== 0 || !response.data) {
      throw new Error(response?.message || '获取日志上传URL失败');
    }

    const { logId, fileKey, uploadUrl, expiresAt } = response.data;

    // 2. 通过 device-gateway 下发 collect_logs 命令
    const taskId = logId;
    await this.gatewayCommandService.sendCollectLogsCommand(
      deviceId,
      taskId,
      options?.logType || 'system',
      uploadUrl,
      fileKey,
      expiresAt,
      options?.description,
    );

    this.logger.info(`[DeviceLog] collect_logs command sent to device: ${deviceId}, taskId: ${taskId}`);

    return { taskId, logId, fileKey, uploadUrl, expiresAt };
  }

  /**
   * 处理设备上报的日志打捞结果
   *
   * @param data 设备上报的打捞状态数据
   */
  async handleCollectStatus(data: any): Promise<void> {
    const { deviceId, taskId, status, fileSize, error } = data;

    this.logger.info(
      `[DeviceLog] Collect status update: device=${deviceId}, taskId=${taskId}, status=${status}`,
    );

    try {
      // 更新 storage-service 中的日志记录状态
      await this.serviceClient.post(
        this.STORAGE_SERVICE,
        '/api/storage/device-logs/collect/status',
        {
          taskId,
          status,
          fileSize,
          error,
        },
      );
    } catch (err) {
      this.logger.error(`[DeviceLog] Failed to update collect status for taskId=${taskId}:`, err);
    }
  }
}
