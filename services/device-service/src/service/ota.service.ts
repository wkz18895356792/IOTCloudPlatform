import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { FirmwareVersion } from '../entity/firmware-version.entity';
import { OTATask } from '../entity/ota-task.entity';
import { Device } from '../entity/device.entity';
import { IdGenerator, ServiceClient } from '@baby-monitor/shared-utils';
import { GatewayCommandService } from './gateway-command.service';
import { FirmwareSignatureService } from './firmware-signature.service';

/**
 * OTA升级服务
 *
 * 提供固件版本管理、OTA任务创建、进度跟踪、设备通知等功能
 *
 * 主要功能：
 * - 固件版本上传和管理
 * - OTA升级任务创建和执行
 * - 升级进度跟踪和状态更新
 * - 通过MQTT通知设备进行升级
 * - 批量升级和升级统计
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class OTAService {
  // 注入日志记录器，用于记录升级过程和错误信息
  @Inject()
  logger!: ILogger;

  // 注入Redis服务，用于缓存升级相关数据
  @Inject()
  redis!: RedisService;

  // 注入网关命令服务，通过 device-gateway 转发 MQTT 命令
  @Inject()
  gatewayCommandService!: GatewayCommandService;

  // 固件版本数据仓储
  @InjectEntityModel(FirmwareVersion)
  firmwareVersionRepository!: Repository<FirmwareVersion>;

  // OTA任务数据仓储
  @InjectEntityModel(OTATask)
  otaTaskRepository!: Repository<OTATask>;

  // 设备数据仓储
  @InjectEntityModel(Device)
  deviceRepository!: Repository<Device>;

  // 固件签名验证服务
  @Inject()
  firmwareSignatureService!: FirmwareSignatureService;

  @Inject()
  serviceClient!: ServiceClient;

  /**
   * 上传固件版本
   *
   * @param data - 固件信息
   * @param data.productId - 产品ID
   * @param data.version - 固件版本号
   * @param data.releaseNotes - 版本更新说明
   * @param data.fileUrl - 固件文件下载地址
   * @param data.fileSize - 文件大小（字节）
   * @param data.checksum - 文件校验和
   * @param data.isForced - 是否强制升级
   * @param data.isBeta - 是否为测试版本
   * @param data.minVersion - 最低兼容版本
   * @param data.maxVersion - 最高兼容版本
   * @returns 保存的固件版本对象
   */
  async uploadFirmware(data: {
    productId: string;
    version: string;
    releaseNotes: string;
    fileUrl: string;
    fileSize: number;
    checksum: string;
    checksumType?: 'md5' | 'sha256';
    isForced?: boolean;
    isBeta?: boolean;
    minVersion?: string;
    maxVersion?: string;
  }): Promise<FirmwareVersion> {
    // 验证校验和格式（SHA256应为64位十六进制，MD5应为32位十六进制）
    const checksumType = data.checksumType || (data.checksum.length === 64 ? 'sha256' : 'md5');
    const expectedLength = checksumType === 'sha256' ? 64 : 32;
    if (!/^[a-fA-F0-9]+$/.test(data.checksum) || data.checksum.length !== expectedLength) {
      throw new Error(`Invalid ${checksumType} checksum format: expected ${expectedLength} hex characters`);
    }

    // 检查该产品是否已有相同版本的固件
    const existing = await this.firmwareVersionRepository.findOne({
      where: { productId: data.productId, version: data.version } as any,
    });
    if (existing) {
      throw new Error(`Firmware version ${data.version} already exists for product ${data.productId}`);
    }

    const firmware = this.firmwareVersionRepository.create({
      id: IdGenerator.uuid(),
      ...data,
      checksumType,
      uploadedAt: new Date(),
    });

    await this.firmwareVersionRepository.save(firmware);
    this.logger.info(`[OTA Service] Firmware uploaded: ${data.productId}@${data.version}, checksum=${checksumType}:${data.checksum}`);
    return firmware;
  }

  /**
   * 获取产品的所有固件版本
   *
   * @param productId - 产品ID
   * @returns 固件版本列表（按上传时间降序）
   */
  async getFirmwareVersions(productId: string): Promise<FirmwareVersion[]> {
    return this.firmwareVersionRepository.find({
      where: { productId } as any,
      order: { uploadedAt: 'DESC' },
    });
  }

  /**
   * 获取最新固件版本
   *
   * @param productId - 产品ID
   * @param includeBeta - 是否包含测试版本，默认不包含
   * @returns 最新固件版本对象，如果不存在则返回null
   */
  async getLatestFirmware(productId: string, includeBeta: boolean = false): Promise<FirmwareVersion | null> {
    const where: any = { productId };
    if (!includeBeta) {
      where.isBeta = false;
    }

    return this.firmwareVersionRepository.findOne({
      where,
      order: { uploadedAt: 'DESC' },
    });
  }

  /**
   * 检查是否有可用更新
   *
   * @param deviceId - 设备ID
   * @returns 更新检查结果，包含是否有更新、固件信息和是否强制更新
   */
  async checkUpdate(deviceId: string): Promise<{
    hasUpdate: boolean;
    firmware?: FirmwareVersion;
    isForced: boolean;
  } | null> {
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceId } as any,
    });

    if (!device) {
      return null;
    }

    const latestFirmware = await this.getLatestFirmware(device.productId);

    if (!latestFirmware) {
      return { hasUpdate: false, isForced: false };
    }

    // 比较版本号
    const currentVersion = device.firmwareVersion;
    const latestVersion = latestFirmware.version;

    if (this.compareVersion(currentVersion, latestVersion) < 0) {
      return {
        hasUpdate: true,
        firmware: latestFirmware,
        isForced: latestFirmware.isForced,
      };
    }

    return { hasUpdate: false, isForced: false };
  }

  /**
   * 创建OTA升级任务
   *
   * @param data - 任务创建参数
   * @param data.deviceId - 设备ID
   * @param data.firmwareId - 目标固件ID
   * @param data.createdBy - 创建者用户ID
   * @returns 创建的OTA任务对象
   * @throws {Error} 设备不存在、固件不存在或版本不兼容时抛出错误
   */
  async createOTATask(data: {
    deviceId: string;
    firmwareId: string;
    createdBy?: string;
  }): Promise<OTATask> {
    // 查找设备
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: data.deviceId } as any,
    });

    if (!device) {
      throw new Error('Device not found');
    }

    // 查找固件
    const firmware = await this.firmwareVersionRepository.findOne({
      where: { id: data.firmwareId } as any,
    });

    if (!firmware) {
      throw new Error('Firmware not found');
    }

    // 检查版本是否兼容
    if (firmware.minVersion && this.compareVersion(device.firmwareVersion, firmware.minVersion) < 0) {
      throw new Error(`Device version too low. Minimum required: ${firmware.minVersion}`);
    }

    if (firmware.maxVersion && this.compareVersion(device.firmwareVersion, firmware.maxVersion) > 0) {
      throw new Error(`Device version too high. Maximum supported: ${firmware.maxVersion}`);
    }

    // 检查是否有正在进行的升级任务
    const ongoingTask = await this.otaTaskRepository.findOne({
      where: {
        deviceId: data.deviceId,
        status: { $in: ['pending', 'downloading', 'installing'] } as any,
      } as any,
    });
    if (ongoingTask) {
      throw new Error('Device already has an ongoing OTA task');
    }

    // 检查固件是否已被撤销
    try {
      const isRevoked = await this.firmwareSignatureService.isRevoked(firmware.version, firmware.productId);
      if (isRevoked) {
        throw new Error(`Firmware version ${firmware.version} has been revoked`);
      }
    } catch (error) {
      if ((error as Error).message.includes('revoked')) {
        throw error;
      }
      // 撤销检查失败不阻断流程，仅记录警告
      this.logger.warn('[OTA Service] Firmware revocation check failed, proceeding anyway');
    }

    // 创建OTA任务
    const task = this.otaTaskRepository.create({
      id: IdGenerator.uuid(),
      deviceId: data.deviceId,
      firmwareId: data.firmwareId,
      fromVersion: device.firmwareVersion,
      toVersion: firmware.version,
      status: 'pending',
      progress: 0,
      createdBy: data.createdBy,
    });

    await this.otaTaskRepository.save(task);

    // 通知设备开始下载（非阻塞：MQTT 不可用时不阻断任务创建）
    try {
      await this.notifyDeviceToDownload(task.id, data.deviceId, firmware);
    } catch (notifyError) {
      this.logger.warn(`[OTA Service] Failed to notify device ${data.deviceId}, task ${task.id} created but notification pending: ${(notifyError as Error).message}`);
    }

    return task;
  }

  /**
   * 获取设备的OTA任务
   *
   * @param deviceId - 设备ID
   * @returns OTA任务列表（按创建时间降序）
   */
  async getDeviceOTATasks(deviceId: string): Promise<OTATask[]> {
    return this.otaTaskRepository.find({
      where: { deviceId } as any,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 获取OTA任务详情
   *
   * @param taskId - 任务ID
   * @returns OTA任务对象，如果不存在则返回null
   */
  async getOTATask(taskId: string): Promise<OTATask | null> {
    return this.otaTaskRepository.findOne({
      where: { id: taskId } as any,
    });
  }

  /**
   * 更新OTA任务进度
   *
   * @param taskId - 任务ID
   * @param status - 任务状态
   * @param progress - 进度百分比（0-100）
   * @param error - 错误信息（可选）
   * @returns 更新后的OTA任务对象
   */
  async updateOTATaskProgress(
    taskId: string,
    status: 'downloading' | 'installing' | 'completed' | 'failed',
    progress: number,
    error?: string
  ): Promise<OTATask | null> {
    const updates: any = {
      status,
      progress,
    };

    if (error) {
      updates.error = error;
    }

    // 如果升级完成，更新设备固件版本
    if (status === 'completed') {
      updates.completedAt = new Date();
      // 更新设备固件版本（task.deviceId 是序列号，需通过 serialNumber 查找）
      const task = await this.getOTATask(taskId);
      if (task) {
        await this.deviceRepository.update(
          { serialNumber: task.deviceId } as any,
          { firmwareVersion: task.toVersion } as any
        );
      }
    }

    await this.otaTaskRepository.update(
      { id: taskId } as any,
      updates
    );

    return this.getOTATask(taskId);
  }

  /**
   * 取消OTA任务
   *
   * @param taskId - 任务ID
   * @returns 是否成功取消
   */
  async cancelOTATask(taskId: string): Promise<boolean> {
    const task = await this.getOTATask(taskId);

    if (!task || task.status === 'completed') {
      return false;
    }

    // 通知设备取消升级
    await this.notifyDeviceToCancel(taskId, task.deviceId);

    await this.otaTaskRepository.delete({ id: taskId } as any);

    return true;
  }

  /**
   * 批量创建OTA任务（按设备列表）
   *
   * 固件校验、撤销检查、预签名 URL 生成只执行一次，所有设备共享。
   *
   * @param deviceIds - 设备ID列表
   * @param firmwareId - 目标固件ID
   * @param createdBy - 创建者用户ID
   * @returns 成功创建的任务列表和失败设备信息
   */
  async createOTATasks(
    deviceIds: string[],
    firmwareId: string,
    createdBy?: string
  ): Promise<{ succeeded: OTATask[]; failed: Array<{ deviceId: string; reason: string }> }> {
    // 统一校验固件（只做一次）
    const firmware = await this.firmwareVersionRepository.findOne({
      where: { id: firmwareId } as any,
    });
    if (!firmware) {
      throw new Error('Firmware not found');
    }

    // 检查固件是否已被撤销
    try {
      const isRevoked = await this.firmwareSignatureService.isRevoked(firmware.version, firmware.productId);
      if (isRevoked) {
        throw new Error(`Firmware version ${firmware.version} has been revoked`);
      }
    } catch (error) {
      if ((error as Error).message.includes('revoked')) {
        throw error;
      }
      this.logger.warn('[OTA Service] Firmware revocation check failed, proceeding anyway');
    }

    // 预签名 URL（只生成一次，缓存由 getPresignedDownloadUrl 管理）
    await this.getPresignedDownloadUrl(firmware);

    // 查询所有目标设备
    const devices = await this.deviceRepository.find({
      where: { serialNumber: { $in: deviceIds } } as any,
    });
    const deviceMap = new Map(devices.map(d => [d.serialNumber, d]));

    // 查询所有设备正在进行的任务（一次查询）
    const ongoingTasks = await this.otaTaskRepository.find({
      where: {
        deviceId: { $in: deviceIds } as any,
        status: { $in: ['pending', 'downloading', 'installing'] } as any,
      } as any,
    });
    const ongoingDeviceIds = new Set(ongoingTasks.map(t => t.deviceId));

    const succeeded: OTATask[] = [];
    const failed: Array<{ deviceId: string; reason: string }> = [];

    for (const deviceId of deviceIds) {
      const device = deviceMap.get(deviceId);
      if (!device) {
        failed.push({ deviceId, reason: '设备不存在' });
        continue;
      }

      // 版本兼容性检查
      if (firmware.minVersion && this.compareVersion(device.firmwareVersion, firmware.minVersion) < 0) {
        failed.push({ deviceId, reason: `设备版本过低，最低要求 ${firmware.minVersion}` });
        continue;
      }
      if (firmware.maxVersion && this.compareVersion(device.firmwareVersion, firmware.maxVersion) > 0) {
        failed.push({ deviceId, reason: `设备版本过高，最高支持 ${firmware.maxVersion}` });
        continue;
      }

      // 检查是否有正在进行的任务
      if (ongoingDeviceIds.has(deviceId)) {
        failed.push({ deviceId, reason: '设备已有进行中的升级任务' });
        continue;
      }

      try {
        const task = this.otaTaskRepository.create({
          id: IdGenerator.uuid(),
          deviceId,
          firmwareId,
          fromVersion: device.firmwareVersion,
          toVersion: firmware.version,
          status: 'pending',
          progress: 0,
          createdBy,
        });
        await this.otaTaskRepository.save(task);

        // 通知设备下载（预签名 URL 已缓存，不会重复生成）
        try {
          await this.notifyDeviceToDownload(task.id, deviceId, firmware);
        } catch (notifyError) {
          this.logger.warn(`[OTA Service] Failed to notify device ${deviceId}: ${(notifyError as Error).message}`);
        }

        succeeded.push(task);
      } catch (error) {
        failed.push({ deviceId, reason: (error as Error).message });
      }
    }

    return { succeeded, failed };
  }

  /**
   * 通知设备开始下载固件
   *
   * @param taskId - OTA任务ID
   * @param deviceId - 设备ID
   * @param firmware - 固件信息
   * @private
   */
  private async notifyDeviceToDownload(taskId: string, deviceId: string, firmware: FirmwareVersion): Promise<void> {
    // 获取预签名下载 URL（同一固件版本共享缓存，避免批量升级时重复生成）
    const downloadUrl = await this.getPresignedDownloadUrl(firmware);

    try {
      await this.gatewayCommandService.sendOTACommand(deviceId, 'ota_download', taskId, {
        version: firmware.version,
        fileUrl: downloadUrl,
        fileSize: firmware.fileSize,
        checksum: firmware.checksum,
        isForced: firmware.isForced,
      });
      console.log(`[OTA Service] Notified device ${deviceId} to download firmware ${firmware.version}`);

      // 记录任务状态变更
      await this.updateOTATaskProgress(taskId, 'downloading', 0);
    } catch (error) {
      console.error(`[OTA Service] Failed to notify device ${deviceId}:`, error);
      throw new Error('Failed to notify device');
    }
  }

  /**
   * 获取固件预签名下载 URL（带 Redis 缓存，同一固件版本共享）
   *
   * 缓存 TTL 50 分钟，略小于 URL 过期时间 1 小时，确保 URL 有效。
   *
   * @param firmware - 固件版本信息
   * @returns 预签名下载 URL
   * @private
   */
  private async getPresignedDownloadUrl(firmware: FirmwareVersion): Promise<string> {
    // fileUrl 已经是完整 HTTP URL 时直接返回
    if (!firmware.fileUrl || firmware.fileUrl.startsWith('http')) {
      return firmware.fileUrl;
    }

    const cacheKey = `ota:presigned_url:${firmware.id}`;

    // 先从缓存获取
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 调用 storage-service 生成预签名 URL
    try {
      const urlResponse = await this.serviceClient.get<{ url: any }>(
        'storage-service',
        `/api/storage/url/${encodeURIComponent(firmware.fileUrl)}?expiresIn=3600`
      );
      const rawUrl = urlResponse.data?.url;
      const downloadUrl = (rawUrl?.Url as string) || rawUrl || firmware.fileUrl;

      // 缓存 50 分钟（3000 秒）
      await this.redis.set(cacheKey, downloadUrl, 'EX', 3000);

      return downloadUrl;
    } catch (error) {
      this.logger.warn(`[OTA Service] Failed to get presigned URL for ${firmware.fileUrl}: ${(error as Error).message}`);
      return firmware.fileUrl;
    }
  }

  /**
   * 通知设备取消升级
   *
   * @param taskId - OTA任务ID
   * @param deviceId - 设备ID
   * @private
   */
  private async notifyDeviceToCancel(taskId: string, deviceId: string): Promise<void> {
    try {
      await this.gatewayCommandService.sendOTACommand(deviceId, 'ota_cancel', taskId);
      console.log(`[OTA Service] Notified device ${deviceId} to cancel OTA task ${taskId}`);
    } catch (error) {
      console.error(`[OTA Service] Failed to notify device ${deviceId}:`, error);
      // 不抛出错误，允许任务被删除
    }
  }

  /**
   * 通知设备开始安装固件
   *
   * @param taskId - OTA任务ID
   * @param deviceId - 设备ID
   * @private
   */
  private async notifyDeviceToInstall(taskId: string, deviceId: string): Promise<void> {
    try {
      await this.gatewayCommandService.sendOTACommand(deviceId, 'ota_install', taskId);
      console.log(`[OTA Service] Notified device ${deviceId} to install firmware`);
    } catch (error) {
      console.error(`[OTA Service] Failed to notify device ${deviceId}:`, error);
    }
  }

  /**
   * 通知设备重启
   *
   * @param taskId - OTA任务ID
   * @param deviceId - 设备ID
   * @private
   */
  private async notifyDeviceToReboot(taskId: string, deviceId: string): Promise<void> {
    try {
      await this.gatewayCommandService.sendOTACommand(deviceId, 'reboot', taskId);
      console.log(`[OTA Service] Notified device ${deviceId} to reboot`);
    } catch (error) {
      console.error(`[OTA Service] Failed to notify device ${deviceId}:`, error);
    }
  }

  /**
   * 比较版本号
   *
   * @param v1 - 版本号1
   * @param v2 - 版本号2
   * @returns 负数(v1<v2), 0(v1==v2), 正数(v1>v2)
   * @private
   */
  private compareVersion(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }

  /**
   * 获取OTA统计
   *
   * @param productId - 产品ID（可选）
   * @returns 各状态OTA任务数量统计
   */
  async getOTAStatistics(productId?: string): Promise<{
    total: number;
    pending: number;
    downloading: number;
    installing: number;
    completed: number;
    failed: number;
  }> {
    const where: any = {};
    if (productId) {
      // 需要join device表查询
      // 这里简化处理，实际应该使用queryBuilder
    }

    const tasks = await this.otaTaskRepository.find({
      where,
    });

    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      downloading: tasks.filter(t => t.status === 'downloading').length,
      installing: tasks.filter(t => t.status === 'installing').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
    };
  }

  /**
   * 处理设备上报的OTA进度
   *
   * @param taskId - OTA任务ID
   * @param progress - 进度百分比（0-100）
   * @param status - 当前状态（下载中/安装中）
   */
  async handleOTAPProgress(
    taskId: string,
    progress: number,
    status: 'downloading' | 'installing'
  ): Promise<void> {
    const task = await this.getOTATask(taskId);
    if (!task) {
      throw new Error('OTA task not found');
    }

    await this.updateOTATaskProgress(taskId, status, progress);
    console.log(`[OTA Service] Task ${taskId} progress: ${progress}% (${status})`);

    // 如果下载完成，通知设备安装
    if (status === 'downloading' && progress >= 100) {
      await this.notifyDeviceToInstall(taskId, task.deviceId);
    }
  }

  /**
   * 处理设备上报的OTA结果
   *
   * @param taskId - OTA任务ID
   * @param success - 是否成功
   * @param error - 错误信息（失败时）
   */
  async handleOTAResult(
    taskId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    const task = await this.getOTATask(taskId);
    if (!task) {
      throw new Error('OTA task not found');
    }

    if (success) {
      await this.updateOTATaskProgress(taskId, 'completed', 100);
      // 升级成功后通知设备重启
      await this.notifyDeviceToReboot(taskId, task.deviceId);
      console.log(`[OTA Service] Task ${taskId} completed successfully`);
    } else {
      await this.updateOTATaskProgress(taskId, 'failed', task.progress, error);
      console.error(`[OTA Service] Task ${taskId} failed: ${error}`);
    }
  }

  /**
   * 获取固件的详细信息
   *
   * @param firmwareId - 固件ID
   * @returns 固件版本对象，如果不存在则返回null
   */
  async getFirmwareDetail(firmwareId: string): Promise<FirmwareVersion | null> {
    return this.firmwareVersionRepository.findOne({
      where: { id: firmwareId } as any,
    });
  }

  /**
   * 删除固件版本
   *
   * @param firmwareId - 固件ID
   * @returns 是否删除成功
   * @throws {Error} 存在活跃OTA任务时抛出错误
   */
  async deleteFirmware(firmwareId: string): Promise<boolean> {
    // 检查是否有正在使用该固件的OTA任务
    const activeTasks = await this.otaTaskRepository.find({
      where: {
        firmwareId,
        status: { $in: ['pending', 'downloading', 'installing'] } as any,
      },
    });

    if (activeTasks.length > 0) {
      throw new Error('Cannot delete firmware with active OTA tasks');
    }

    const result = await this.firmwareVersionRepository.delete({
      id: firmwareId,
    } as any);

    return (result.affected ?? 0) > 0;
  }

  /**
   * 更新固件信息
   *
   * @param firmwareId - 固件ID
   * @param updates - 要更新的字段
   * @returns 更新后的固件对象
   */
  async updateFirmware(
    firmwareId: string,
    updates: Partial<FirmwareVersion>
  ): Promise<FirmwareVersion | null> {
    await this.firmwareVersionRepository.update(
      { id: firmwareId } as any,
      updates
    );

    return this.firmwareVersionRepository.findOne({
      where: { id: firmwareId } as any,
    });
  }

  /**
   * 获取产品固件升级历史
   *
   * @param productId - 产品ID
   * @returns 固件版本历史列表
   */
  async getFirmwareHistory(productId: string): Promise<Array<{
    version: string;
    releaseNotes: string;
    uploadedAt: Date;
    isBeta: boolean;
  }>> {
    const versions = await this.getFirmwareVersions(productId);

    return versions.map(v => ({
      version: v.version,
      releaseNotes: v.releaseNotes,
      uploadedAt: v.uploadedAt,
      isBeta: v.isBeta || false,
    }));
  }

  /**
   * 暂停OTA任务
   *
   * @param taskId - 任务ID
   * @returns 是否成功暂停
   */
  async pauseOTATask(taskId: string): Promise<boolean> {
    const task = await this.getOTATask(taskId);

    if (!task || !['downloading', 'installing'].includes(task.status)) {
      return false;
    }

    await this.otaTaskRepository.update(
      { id: taskId } as any,
      { status: 'paused' } as any
    );

    // 通知设备暂停
    try {
      await this.gatewayCommandService.sendOTACommand(task.deviceId, 'ota_pause', taskId);
      console.log(`[OTA Service] Paused OTA task ${taskId}`);
      return true;
    } catch (error) {
      console.error(`[OTA Service] Failed to pause task ${taskId}:`, error);
      return false;
    }
  }

  /**
   * 恢复OTA任务
   *
   * @param taskId - 任务ID
   * @returns 是否成功恢复
   */
  async resumeOTATask(taskId: string): Promise<boolean> {
    const task = await this.getOTATask(taskId);

    if (!task || task.status !== 'paused') {
      return false;
    }

    await this.otaTaskRepository.update(
      { id: taskId } as any,
      { status: 'downloading' } as any
    );

    // 通知设备恢复
    try {
      await this.gatewayCommandService.sendOTACommand(task.deviceId, 'ota_resume', taskId);
      console.log(`[OTA Service] Resumed OTA task ${taskId}`);
      return true;
    } catch (error) {
      console.error(`[OTA Service] Failed to resume task ${taskId}:`, error);
      return false;
    }
  }

  /**
   * 获取设备的OTA任务列表（分页）
   *
   * @param deviceId - 设备ID
   * @param limit - 返回数量
   * @param offset - 偏移量
   * @returns 分页结果
   */
  async getDeviceOTATasksPaginated(deviceId: string, limit = 20, offset = 0): Promise<{
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
      .andWhere('status IN (:...statuses)', { statuses: ['completed', 'failed', 'rolled_back'] })
      .execute();

    const count = result.affected || 0;
    this.logger.info(`[OTA Service] Cleaned old OTA tasks: ${count}`);
    return count;
  }

  /**
   * 设备重新注册时同步OTA任务状态
   * 当设备的固件版本变化时，将匹配的OTA任务标记为完成
   *
   * @param deviceSerialNumber - 设备序列号
   * @param newFirmwareVersion - 新的固件版本
   */
  async syncOTATasksOnReRegistration(deviceSerialNumber: string, newFirmwareVersion: string): Promise<void> {
    const device = await this.deviceRepository.findOne({
      where: { serialNumber: deviceSerialNumber } as any,
    });

    if (!device) return;

    // 查找进行中的OTA任务
    const pendingTasks = await this.otaTaskRepository.find({
      where: {
        deviceId: device.serialNumber,
        status: { $in: ['pending', 'downloading', 'installing'] } as any,
      } as any,
    });

    for (const task of pendingTasks) {
      if (task.toVersion === newFirmwareVersion) {
        // 设备已升级到目标版本，标记为完成
        await this.otaTaskRepository.update(
          { id: task.id } as any,
          {
            status: 'completed',
            progress: 100,
            completedAt: new Date(),
          }
        );
        this.logger.info(
          `[OTA Service] Auto-completed OTA task ${task.id} on re-registration (device ${deviceSerialNumber}, version ${newFirmwareVersion})`
        );
      } else {
        // 版本不匹配，标记为失败
        await this.otaTaskRepository.update(
          { id: task.id } as any,
          {
            status: 'failed',
            error: `Device firmware changed to ${newFirmwareVersion}, expected ${task.toVersion}`,
          }
        );
        this.logger.warn(
          `[OTA Service] Marked OTA task ${task.id} as failed on re-registration (expected ${task.toVersion}, got ${newFirmwareVersion})`
        );
      }
    }
  }
}
