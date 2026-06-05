import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { FirmwareVersion } from '../entity/firmware-version.entity';
import { OTATask } from '../entity/ota-task.entity';
import { Device } from '../entity/device.entity';
import { IdGenerator } from '@baby-monitor/shared-utils';
import { GatewayCommandService } from './gateway-command.service';

/**
 * 固件升级服务
 *
 * 负责设备固件版本管理和OTA升级功能
 */
@Provide()
export class FirmwareService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  gatewayCommandService!: GatewayCommandService;

  @InjectEntityModel(FirmwareVersion)
  firmwareRepository!: Repository<FirmwareVersion>;

  @InjectEntityModel(OTATask)
  otaTaskRepository!: Repository<OTATask>;

  @InjectEntityModel(Device)
  deviceRepository!: Repository<Device>;

  /**
   * 创建固件版本
   *
   * @param firmwareData - 固件数据
   * @returns 创建的固件版本
   */
  async createFirmwareVersion(firmwareData: {
    productId: string;
    version: string;
    versionName?: string;
    isForced?: boolean;
    fileUrl: string;
    fileSize: number;
    checksum: string;
    releaseNotes?: string;
    minVersion?: string;
  }): Promise<FirmwareVersion> {
    const firmware = this.firmwareRepository.create({
      id: IdGenerator.uuid(),
      ...firmwareData,
    });

    const saved = await this.firmwareRepository.save(firmware);

    this.logger.info(`[Firmware] Created firmware version: ${firmwareData.version} for product: ${firmwareData.productId}`);

    return saved;
  }

  /**
   * 获取产品的固件版本列表
   *
   * @param productId - 产品ID
   * @returns 固件版本列表
   */
  async getFirmwareVersions(productId: string): Promise<FirmwareVersion[]> {
    return await this.firmwareRepository.find({
      where: { productId, isActive: true } as any,
      order: { uploadedAt: 'DESC' } as any,
    });
  }

  /**
   * 获取最新固件版本
   *
   * @param productId - 产品ID
   * @param currentVersion - 当前版本（可选，用于检查是否有更新）
   * @returns 最新固件版本
   */
  async getLatestFirmware(productId: string, currentVersion?: string): Promise<{
    firmware: FirmwareVersion | null;
    hasUpdate: boolean;
    isForced: boolean;
  }> {
    const firmware = await this.firmwareRepository.findOne({
      where: { productId, isActive: true } as any,
      order: { uploadedAt: 'DESC' } as any,
    });

    if (!firmware) {
      return {
        firmware: null,
        hasUpdate: false,
        isForced: false,
      };
    }

    let hasUpdate = true;
    if (currentVersion) {
      hasUpdate = this.compareVersions(firmware.version, currentVersion) > 0;
    }

    return {
      firmware,
      hasUpdate,
      isForced: firmware.isForced,
    };
  }

  /**
   * 创建OTA升级任务
   *
   * @param deviceId - 设备ID
   * @param firmwareId - 固件ID
   * @returns 升级任务
   */
  async createOTATask(deviceId: string, firmwareId: string): Promise<{
    success: boolean;
    task?: OTATask;
    error?: string;
  }> {
    try {
      // 获取设备信息
      const device = await this.deviceRepository.findOne({
        where: { serialNumber: deviceId } as any,
      });

      if (!device) {
        return {
          success: false,
          error: '设备不存在',
        };
      }

      // 获取固件信息
      const firmware = await this.firmwareRepository.findOne({
        where: { id: firmwareId, isActive: true } as any,
      });

      if (!firmware) {
        return {
          success: false,
          error: '固件版本不存在或已下架',
        };
      }

      // 检查版本兼容性
      if (firmware.minVersion) {
        if (this.compareVersions(device.firmwareVersion, firmware.minVersion) < 0) {
          return {
            success: false,
            error: `当前版本过低，最低需要 ${firmware.minVersion} 版本才能升级`,
          };
        }
      }

      // 检查是否有正在进行的升级任务
      const ongoingTask = await this.otaTaskRepository.findOne({
        where: {
          deviceId,
          status: 'downloading' as any,
        } as any,
      });

      if (ongoingTask) {
        return {
          success: false,
          error: '设备正在进行固件升级',
        };
      }

      // 创建升级任务
      const task = this.otaTaskRepository.create({
        id: IdGenerator.uuid(),
        deviceId,
        firmwareId,
        fromVersion: device.firmwareVersion,
        toVersion: firmware.version,
        status: 'pending',
        progress: 0,
      });

      const saved = await this.otaTaskRepository.save(task);

      // 发送升级命令到设备（通过 device-gateway 转发）
      await this.gatewayCommandService.sendOTACommand(deviceId, 'ota_download', saved.id, {
        version: firmware.version,
        fileUrl: firmware.fileUrl,
        fileSize: firmware.fileSize,
        checksum: firmware.checksum,
        isForced: firmware.isForced,
      });

      this.logger.info(`[Firmware] Created OTA task for device: ${deviceId}, version: ${firmware.version}`);

      return {
        success: true,
        task: saved,
      };
    } catch (error) {
      this.logger.error('[Firmware] Create OTA task error:', error);
      return {
        success: false,
        error: '创建升级任务失败',
      };
    }
  }

  /**
   * 获取OTA任务
   *
   * @param taskId - 任务ID
   * @returns OTA任务
   */
  async getOTATask(taskId: string): Promise<OTATask | null> {
    return await this.otaTaskRepository.findOne({
      where: { id: taskId } as any,
    });
  }

  /**
   * 获取设备的OTA任务列表
   *
   * @param deviceId - 设备ID
   * @param limit - 返回数量
   * @param offset - 偏移量
   * @returns OTA任务列表
   */
  async getDeviceOTATasks(deviceId: string, limit = 20, offset = 0): Promise<{
    list: OTATask[];
    total: number;
  }> {
    const [list, total] = await this.otaTaskRepository.findAndCount({
      where: { deviceId } as any,
      order: { createdAt: 'DESC' } as any,
      take: limit,
      skip: offset,
    });

    return { list, total };
  }

  /**
   * 更新OTA任务状态
   *
   * @param taskId - 任务ID
   * @param updates - 更新数据
   * @returns 更新后的任务
   */
  async updateOTATask(taskId: string, updates: {
    status?: 'pending' | 'downloading' | 'installing' | 'completed' | 'failed' | 'cancelled';
    progress?: number;
    error?: string;
    errorDetails?: Record<string, any>;
    completedAt?: Date;
  }): Promise<OTATask | null> {
    const task = await this.otaTaskRepository.findOne({
      where: { id: taskId } as any,
    });

    if (!task) {
      return null;
    }

    Object.assign(task, updates);

    const updated = await this.otaTaskRepository.save(task);

    // 如果升级完成，更新设备固件版本
    if (updates.status === 'completed') {
      await this.deviceRepository.update(
        { id: task.deviceId } as any,
        { firmwareVersion: task.toVersion }
      );

      this.logger.info(`[Firmware] OTA task completed for device: ${task.deviceId}, new version: ${task.toVersion}`);
    }

    return updated;
  }

  /**
   * 取消OTA任务
   *
   * @param taskId - 任务ID
   * @param userId - 操作用户ID
   * @returns 是否取消成功
   */
  async cancelOTATask(taskId: string, userId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const task = await this.otaTaskRepository.findOne({
      where: { id: taskId } as any,
    });

    if (!task) {
      return {
        success: false,
        error: '任务不存在',
      };
    }

    if (task.status === 'completed' || task.status === 'paused') {
      return {
        success: false,
        error: '任务已完成或已暂停',
      };
    }

    // 更新任务状态
    task.status = 'paused';
    await this.otaTaskRepository.save(task);

    // 发送取消命令到设备（通过 device-gateway 转发）
    await this.gatewayCommandService.sendOTACommand(task.deviceId, 'ota_cancel', taskId);

    this.logger.info(`[Firmware] OTA task cancelled: ${taskId}, by user: ${userId}`);

    return { success: true };
  }

  /**
   * 清理旧的OTA任务
   *
   * @param days - 保留天数，默认30天
   * @returns 清理的任务数量
   */
  async cleanOldOTATasks(days = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.otaTaskRepository
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoffDate', { cutoffDate })
      .andWhere('status IN (:...statuses)', { statuses: ['completed', 'failed', 'cancelled'] })
      .execute();

    const count = result.affected || 0;
    this.logger.info(`[Firmware] Cleaned old OTA tasks: ${count}`);

    return count;
  }

  /**
   * 检查设备固件更新
   *
   * @param deviceId - 设备ID
   * @returns 是否有更新可用
   */
  async checkFirmwareUpdate(deviceId: string): Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    isForced: boolean;
    firmware?: FirmwareVersion;
  }> {
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId } as any,
    });

    if (!device) {
      return {
        hasUpdate: false,
        currentVersion: '',
        isForced: false,
      };
    }

    const { firmware, hasUpdate, isForced } = await this.getLatestFirmware(
      device.productId,
      device.firmwareVersion
    );

    return {
      hasUpdate,
      currentVersion: device.firmwareVersion,
      latestVersion: firmware?.version,
      isForced,
      firmware: firmware || undefined,
    };
  }

  /**
   * 比较版本号
   *
   * @param version1 - 版本1
   * @param version2 - 版本2
   * @returns 1: version1 > version2, 0: version1 == version2, -1: version1 < version2
   */
  private compareVersions(version1: string, version2: string): number {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);

    const maxLength = Math.max(v1Parts.length, v2Parts.length);

    for (let i = 0; i < maxLength; i++) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;

      if (v1Part > v2Part) return 1;
      if (v1Part < v2Part) return -1;
    }

    return 0;
  }
}
