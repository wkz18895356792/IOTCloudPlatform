import { Provide, Inject, Config, Init, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { StorageService } from './storage.service';
import { DeviceLog } from '../entity/device-log.entity';
import {
  LogStatus, LogTriggerType, IdGenerator,
  LogUploadUrlRequest, LogUploadUrlResponse,
  LogRegisterRequest, LogRegisterResponse,
} from '@baby-monitor/shared-types';

@Provide()
@Scope(ScopeEnum.Singleton)
export class DeviceLogService {
  @Inject() logger!: ILogger;
  @Inject() storageService!: StorageService;
  @InjectEntityModel(DeviceLog) deviceLogModel!: Repository<DeviceLog>;

  @Config('deviceLog') deviceLogConfig!: any;
  @Config('storage') storageConfig!: any;

  @Init()
  async initialize(): Promise<void> {
    this.logger.info('[DeviceLog] Service initialized');
  }

  // ==================== 文件名生成 ====================

  /**
   * 生成标准化的日志文件Key
   * 格式: logs/{deviceId}/{YYYY-MM-DD}/{timestamp}.log
   */
  private generateFileKey(deviceId: string): string {
    const now = new Date();
    const iso = now.toISOString();
    const date = iso.slice(0, 10); // YYYY-MM-DD
    const timestamp = iso.replace(/[-:]/g, '').replace('T', '').split('.')[0];
    return `logs/${deviceId}/${date}/${timestamp}`;
  }

  // ==================== 上传URL请求 ====================

  /**
   * 生成日志上传预签名URL
   */
  async requestUploadUrl(
    request: LogUploadUrlRequest & { triggerType?: LogTriggerType; taskId?: string },
  ): Promise<LogUploadUrlResponse> {
    const { deviceId, requestId, logType, description, triggerType, taskId } = request;

    const fileKey = this.generateFileKey(deviceId);
    const logId = IdGenerator.uuid();
    const expiresIn = this.deviceLogConfig?.presignedUrlTtl || 3600;

    // 生成预签名PUT URL（不传 provider，让 storageService 使用 defaultProvider）
    const uploadUrl = await this.storageService.getPresignedUploadUrl(fileKey, {
      expiresIn,
      contentType: 'text/plain',
    });

    // 写入DB
    const defaultProvider = this.storageConfig?.defaultProvider || 'minio';
    const deviceLog = new DeviceLog();
    deviceLog.id = logId;
    deviceLog.deviceId = deviceId;
    deviceLog.fileKey = fileKey;
    deviceLog.logType = logType || 'system';
    deviceLog.contentType = 'text/plain';
    deviceLog.status = LogStatus.PENDING;
    deviceLog.provider = defaultProvider;
    deviceLog.triggerType = triggerType || LogTriggerType.DEVICE_INITIATED;
    deviceLog.taskId = taskId || null;
    deviceLog.description = description || null;
    await this.deviceLogModel.save(deviceLog);

    this.logger.info(`[DeviceLog] Upload URL generated: ${logId}, device: ${deviceId}`);

    return {
      requestId,
      logId,
      fileKey,
      uploadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  // ==================== 确认上传完成 ====================

  /**
   * 确认日志上传完成
   */
  async registerUpload(request: LogRegisterRequest): Promise<LogRegisterResponse> {
    const { requestId, logId, fileKey, fileSize } = request;

    const deviceLog = await this.deviceLogModel.findOne({ where: { id: logId } });
    if (!deviceLog) {
      throw new Error('日志记录不存在');
    }

    deviceLog.status = LogStatus.COMPLETED;
    deviceLog.fileSize = fileSize;
    await this.deviceLogModel.save(deviceLog);

    this.logger.info(`[DeviceLog] Upload registered: ${logId}, size: ${fileSize}`);

    return {
      requestId,
      logId,
      status: LogStatus.COMPLETED,
    };
  }

  // ==================== 下载 ====================

  /**
   * 获取日志下载预签名URL
   */
  async getDownloadUrl(logId: string, expiresIn: number = 3600): Promise<{ logId: string; downloadUrl: string; expiresAt: string }> {
    const deviceLog = await this.deviceLogModel.findOne({ where: { id: logId } });
    if (!deviceLog || deviceLog.status !== LogStatus.COMPLETED) {
      throw new Error('日志不存在或未完成上传');
    }

    const downloadUrl = await this.storageService.getUrl(deviceLog.fileKey, expiresIn);

    return {
      logId,
      downloadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  // ==================== 查询 ====================

  /**
   * 获取设备日志列表
   */
  async listLogs(
    deviceId: string,
    options?: {
      logType?: string;
      status?: LogStatus;
      page?: number;
      pageSize?: number;
    },
  ): Promise<{ list: DeviceLog[]; total: number }> {
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 20;

    const where: any = { deviceId };
    if (options?.logType) where.logType = options.logType;
    if (options?.status) where.status = options.status;

    const [list, total] = await this.deviceLogModel.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { list, total };
  }

  // ==================== 删除 ====================

  /**
   * 删除日志（文件+记录）
   */
  async deleteLog(logId: string): Promise<void> {
    const deviceLog = await this.deviceLogModel.findOne({ where: { id: logId } });
    if (!deviceLog) return;

    // 删除S3文件
    try {
      await this.storageService.delete(deviceLog.fileKey);
    } catch (error) {
      this.logger.warn(`[DeviceLog] Failed to delete file: ${deviceLog.fileKey}`, error);
    }

    await this.deviceLogModel.remove(deviceLog);
    this.logger.info(`[DeviceLog] Deleted: ${logId}`);
  }

  // ==================== 过期处理 ====================

  /**
   * 标记过期的PENDING日志为FAILED
   */
  async processExpiredLogs(): Promise<number> {
    const ttl = this.deviceLogConfig?.presignedUrlTtl || 3600;
    const buffer = 300; // 5分钟缓冲
    const expiredBefore = new Date(Date.now() - (ttl + buffer) * 1000);

    const result = await this.deviceLogModel.update(
      { status: LogStatus.PENDING, createdAt: LessThan(expiredBefore) },
      { status: LogStatus.EXPIRED },
    );

    const count = result.affected || 0;
    if (count > 0) {
      this.logger.info(`[DeviceLog] Marked ${count} expired logs`);
    }
    return count;
  }

  /**
   * 根据taskId更新日志状态（平台打捞结果）
   */
  async updateCollectStatus(taskId: string, status: 'uploading' | 'completed' | 'failed', fileSize?: number, error?: string): Promise<void> {
    const deviceLog = await this.deviceLogModel.findOne({ where: { taskId } });
    if (!deviceLog) {
      this.logger.warn(`[DeviceLog] No log found for taskId: ${taskId}`);
      return;
    }

    if (status === 'completed') {
      deviceLog.status = LogStatus.COMPLETED;
      deviceLog.fileSize = fileSize || deviceLog.fileSize;
    } else if (status === 'failed') {
      deviceLog.status = LogStatus.FAILED;
      deviceLog.error = error || null;
    } else if (status === 'uploading') {
      deviceLog.status = LogStatus.UPLOADING;
    }

    await this.deviceLogModel.save(deviceLog);
    this.logger.info(`[DeviceLog] Collect status updated: taskId=${taskId}, status=${status}`);
  }

}
