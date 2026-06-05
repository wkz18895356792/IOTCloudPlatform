import { Provide, Inject, Config, Init, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { StorageService } from './storage.service';
import { Recording } from '../entity/recording.entity';
import { DeviceProviderResolver } from '@baby-monitor/shared-utils';
import {
  RecordingStatus, UploadStrategy, IdGenerator,
  RecordingUploadUrlRequest, RecordingUploadUrlResponse,
  RecordingMultipartStartRequest, RecordingMultipartStartResponse,
  RecordingMultipartCompleteRequest, RecordingCompleteResponse,
  RecordingRegisterRequest, RecordingPlaybackInfo,
  RecordingTimeSlot,
  RecordingBatchUploadUrlRequest, RecordingBatchUploadUrlResponse,
  RecordingBatchRegisterRequest, RecordingBatchRegisterResponse,
  StorageProviderType,
} from '@baby-monitor/shared-types';

@Provide()
@Scope(ScopeEnum.Singleton)
export class RecordingService {
  @Inject() logger!: ILogger;
  @Inject() redis!: RedisService;
  @Inject() storageService!: StorageService;
  @InjectEntityModel(Recording) recordingModel!: Repository<Recording>;

  @Config('recording') recordingConfig!: any;
  @Config('storage') storageConfig!: any;

  @Inject() deviceProviderResolver!: DeviceProviderResolver;

  private readonly CACHE_PREFIX = 'recording:';
  private readonly INDEX_PREFIX = 'recording:idx:';
  private readonly EXPIRY_SCHEDULE_KEY = 'recording:expiry:scheduled';
  private readonly CACHE_TTL = 86400 * 7; // 7天

  @Init()
  async initialize(): Promise<void> {
    this.logger.info('[Recording] Service initialized');
  }

  // ==================== 文件名生成 ====================

  /**
   * 生成标准化的录像文件Key
   * 格式: recordings/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{start_timestamp}_{duration}.{ext}
   *
   * @param deviceId 设备ID
   * @param startTime 录像开始时间（ISO string）
   * @param duration 录像时长（秒），可选
   * @param extension 文件扩展名
   * @returns S3 object key
   */
  private generateFileKey(
    deviceId: string,
    startTime?: string,
    duration?: number,
    extension: string = 'ts',
  ): string {
    const now = startTime ? new Date(startTime) : new Date();
    const iso = now.toISOString();

    // 拆分日期组件
    const year = iso.slice(0, 4);    // YYYY
    const month = iso.slice(5, 7);   // MM
    const day = iso.slice(8, 10);    // DD
    const hour = iso.slice(11, 13);   // HH

    // 生成时间戳：YYYYMMDDTHHMMSS
    const timestamp = iso
      .replace(/[-:]/g, '')
      .replace('T', '')
      .slice(0, 15);

    // 时长部分（可选）
    const durationStr = duration !== undefined ? `_${duration}` : '';

    return `recordings/${deviceId}/${year}/${month}/${day}/${hour}/${timestamp}${durationStr}.${extension}`;
  }

  /**
   * 生成连续录制的分段文件Key
   * 格式: recordings/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{HHmmss}.{ext}
   * 注意：连续录制时无法预知 duration，由 registerRecording 时通过重命名或补充元数据添加
   *
   * @param deviceId 设备ID
   * @param segmentStartTime 分段开始时间
   * @param extension 文件扩展名
   * @returns S3 object key
   */
  private computeSegmentFileKey(
    deviceId: string,
    segmentStartTime: Date,
    extension: string = 'ts',
  ): string {
    const iso = segmentStartTime.toISOString();

    // 拆分日期组件
    const year = iso.slice(0, 4);    // YYYY
    const month = iso.slice(5, 7);   // MM
    const day = iso.slice(8, 10);    // DD
    const hour = iso.slice(11, 13);   // HH
    const minute = iso.slice(14, 16); // mm

    return `recordings/${deviceId}/${year}/${month}/${day}/${hour}/${minute}.${extension}`;
  }

  // ==================== 上传URL请求（单次PUT） ====================

  async requestUploadUrl(
    request: RecordingUploadUrlRequest,
  ): Promise<RecordingUploadUrlResponse> {
    const { deviceId, requestId, estimatedSize, contentType, startTime } = request;
    const duration = (request as any).duration; // duration is optional, not in type definition

    const multipartThreshold = this.recordingConfig?.multipartThreshold || 100 * 1024 * 1024;
    const strategy = (estimatedSize && estimatedSize >= multipartThreshold)
      ? UploadStrategy.MULTIPART
      : UploadStrategy.SINGLE_PUT;

    const extension = this.detectExtension(contentType);
    const fileKey = this.generateFileKey(deviceId, startTime, duration, extension);
    const recordingId = IdGenerator.uuid();
    const expiresIn = this.recordingConfig?.presignedUrlTtl || 3600;

    // 生成预签名PUT URL（传入 provider 以支持设备级路由）
    const provider = await this.resolveRecordingProvider(deviceId);
    const uploadUrl = await this.storageService.getPresignedUploadUrl(fileKey, {
      expiresIn,
      contentType: contentType || this.recordingConfig?.defaultContentType || 'video/mp2t',
      provider,
    });

    // 写入DB
    const recording = new Recording();
    recording.id = recordingId;
    recording.deviceId = deviceId;
    recording.fileKey = fileKey;
    recording.startTime = startTime ? new Date(startTime) : new Date();
    recording.contentType = contentType || this.recordingConfig?.defaultContentType || 'video/mp2t';
    recording.uploadStrategy = strategy;
    recording.status = RecordingStatus.PENDING;
    recording.provider = provider || this.storageConfig?.defaultProvider || 'minio';
    await this.recordingModel.save(recording);

    // 写入Redis缓存
    await this.cacheRecording(recording);
    await this.indexRecording(deviceId, recordingId);

    // 设置过期检查
    await this.scheduleExpiryCheck(recordingId, expiresIn + 300);

    return {
      deviceId,
      requestId,
      recordingId,
      fileKey,
      uploadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      strategy,
    };
  }

  // ==================== 分片上传 ====================

  async requestMultipartStart(
    request: RecordingMultipartStartRequest,
  ): Promise<RecordingMultipartStartResponse> {
    const { deviceId, requestId, partCount, contentType, startTime } = request;

    const extension = this.detectExtension(contentType);
    const fileKey = this.generateFileKey(deviceId, startTime, undefined, extension);
    const recordingId = IdGenerator.uuid();
    const expiresIn = this.recordingConfig?.presignedUrlTtl || 3600;

    // 发起分片上传
    const { uploadId } = await this.storageService.createMultipartUpload(fileKey, {
      metadata: { contentType: contentType || 'video/mp2t', recordingId },
    });

    // 为每个分片生成预签名URL
    const partUrls: Array<{ partNumber: number; uploadUrl: string }> = [];
    for (let i = 1; i <= partCount; i++) {
      const partUrl = await this.storageService.getPresignedPartUploadUrl(
        fileKey, uploadId, i, expiresIn,
      );
      partUrls.push({ partNumber: i, uploadUrl: partUrl });
    }

    // 写入DB
    const recording = new Recording();
    recording.id = recordingId;
    recording.deviceId = deviceId;
    recording.fileKey = fileKey;
    recording.startTime = startTime ? new Date(startTime) : new Date();
    recording.contentType = contentType || this.recordingConfig?.defaultContentType || 'video/mp2t';
    recording.uploadStrategy = UploadStrategy.MULTIPART;
    recording.status = RecordingStatus.UPLOADING;
    recording.uploadId = uploadId;
    recording.provider = (await this.resolveRecordingProvider(deviceId)) || this.storageConfig?.defaultProvider || 'minio';
    await this.recordingModel.save(recording);

    // 写入Redis缓存
    await this.cacheRecording(recording);
    await this.indexRecording(deviceId, recordingId);
    await this.scheduleExpiryCheck(recordingId, expiresIn + 300);

    return {
      deviceId,
      requestId,
      recordingId,
      fileKey,
      uploadId,
      partUrls,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async completeMultipart(
    request: RecordingMultipartCompleteRequest,
  ): Promise<RecordingCompleteResponse> {
    const { recordingId, uploadId, parts, fileSize, endTime } = request;

    const recording = await this.recordingModel.findOne({ where: { id: recordingId } });
    if (!recording) {
      throw new Error(`录像 ${recordingId} 不存在`);
    }

    // 完成分片上传
    await this.storageService.completeMultipartUpload(
      uploadId,
      recording.fileKey,
      parts.map(p => ({ partNumber: p.partNumber, etag: p.etag })),
    );

    // 计算时长并重命名文件
    const recEndTime = endTime ? new Date(endTime) : new Date();
    const duration = this.calculateDuration(recording.startTime, recEndTime);

    // 重命名文件以包含 duration
    const finalFileKey = this.addDurationToFileKey(recording.fileKey, duration);
    await this.storageService.move(recording.fileKey, finalFileKey);

    // 更新DB
    recording.status = RecordingStatus.COMPLETED;
    recording.fileKey = finalFileKey;
    recording.fileSize = fileSize;
    recording.endTime = recEndTime;
    recording.duration = duration;
    await this.recordingModel.save(recording);

    // 更新缓存
    await this.cacheRecording(recording);

    return {
      deviceId: recording.deviceId,
      requestId: '',
      recordingId,
      status: RecordingStatus.COMPLETED,
    };
  }

  // ==================== 注册录制完成（单次PUT） ====================

  async registerRecording(
    request: RecordingRegisterRequest,
  ): Promise<RecordingCompleteResponse> {
    const { deviceId, fileKey, fileSize, endTime } = request;

    const recording = await this.recordingModel.findOne({
      where: { deviceId, fileKey },
    });
    if (!recording) {
      throw new Error(`未找到文件 ${fileKey} 对应的录像记录`);
    }

    // 计算时长
    const recEndTime = endTime ? new Date(endTime) : new Date();
    const duration = this.calculateDuration(recording.startTime, recEndTime);

    // 重命名文件以包含 duration
    const finalFileKey = this.addDurationToFileKey(fileKey, duration);
    await this.storageService.move(fileKey, finalFileKey);

    // 更新DB
    recording.status = RecordingStatus.COMPLETED;
    recording.fileKey = finalFileKey;
    recording.fileSize = fileSize;
    recording.endTime = recEndTime;
    recording.duration = duration;
    await this.recordingModel.save(recording);

    await this.cacheRecording(recording);

    return {
      deviceId,
      requestId: '',
      recordingId: recording.id,
      status: RecordingStatus.COMPLETED,
    };
  }

  // ==================== 查询方法 ====================

  async listRecordings(
    deviceId: string,
    startTime?: string,
    endTime?: string,
  ): Promise<Recording[]> {
    const query = this.recordingModel.createQueryBuilder('r')
      .where('r.deviceId = :deviceId', { deviceId })
      .andWhere('r.status = :status', { status: RecordingStatus.COMPLETED });

    if (startTime) {
      query.andWhere('r.startTime >= :startTime', { startTime: new Date(startTime) });
    }
    if (endTime) {
      query.andWhere('r.endTime <= :endTime', { endTime: new Date(endTime) });
    }

    return query.orderBy('r.startTime', 'DESC').getMany();
  }

  async getRecordingsByDay(
    deviceId: string,
    date?: string,
  ): Promise<Array<{ date: string; recordings: Recording[]; timeSlots: RecordingTimeSlot[] }>> {
    const recordings = await this.listRecordings(deviceId);
    const grouped = new Map<string, Recording[]>();

    for (const rec of recordings) {
      const day = rec.startTime.toISOString().slice(0, 10);
      if (date && day !== date) continue;
      if (!grouped.has(day)) grouped.set(day, []);
      grouped.get(day)!.push(rec);
    }

    const results: Array<{ date: string; recordings: Recording[]; timeSlots: RecordingTimeSlot[] }> = [];
    for (const [day, recs] of grouped) {
      const timeSlots: RecordingTimeSlot[] = recs
        .filter(r => r.endTime)
        .map(r => ({
          startTime: r.startTime.toISOString(),
          endTime: r.endTime!.toISOString(),
          recordingId: r.id,
        }))
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      results.push({ date: day, recordings: recs, timeSlots });
    }

    return results.sort((a, b) => b.date.localeCompare(a.date));
  }

  async getPlaybackUrl(
    recordingId: string,
    expiresIn: number = 3600,
  ): Promise<RecordingPlaybackInfo> {
    const recording = await this.recordingModel.findOne({ where: { id: recordingId } });
    if (!recording || recording.status !== RecordingStatus.COMPLETED) {
      throw new Error('录像不存在或未完成上传');
    }

    const playbackUrl = await this.storageService.getUrl(recording.fileKey, expiresIn);

    return {
      recordingId,
      deviceId: recording.deviceId,
      playbackUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      duration: recording.duration,
      fileSize: recording.fileSize,
      startTime: recording.startTime.toISOString(),
      endTime: recording.endTime?.toISOString(),
    };
  }

  async deleteRecording(recordingId: string): Promise<void> {
    const recording = await this.recordingModel.findOne({ where: { id: recordingId } });
    if (!recording) return;

    // 删除S3文件
    try {
      await this.storageService.delete(recording.fileKey);
    } catch (e) {
      this.logger.warn(`[Recording] 删除文件失败 ${recording.fileKey}:`, e);
    }

    // 取消未完成的分片上传
    if (recording.uploadId && recording.status === RecordingStatus.UPLOADING) {
      try {
        await this.storageService.abortMultipartUpload(recording.uploadId, recording.fileKey);
      } catch (e) {
        this.logger.warn(`[Recording] 取消分片上传失败 ${recording.uploadId}:`, e);
      }
    }

    // 更新DB
    recording.status = RecordingStatus.DELETED;
    await this.recordingModel.save(recording);

    // 清除缓存
    await this.removeCache(recordingId);
    await this.removeIndex(recording.deviceId, recordingId);
  }

  // ==================== 过期检查（定时任务调用） ====================

  async processExpiredRecordings(): Promise<number> {
    const now = Date.now();
    const expiredIds = await this.redis.zrangebyscore(
      this.EXPIRY_SCHEDULE_KEY, 0, now,
    );

    let processed = 0;
    for (const recordingId of expiredIds) {
      const recording = await this.recordingModel.findOne({ where: { id: recordingId } });
      if (recording && (recording.status === RecordingStatus.PENDING || recording.status === RecordingStatus.UPLOADING)) {
        recording.status = RecordingStatus.FAILED;
        recording.error = '上传超时';
        await this.recordingModel.save(recording);

        if (recording.uploadId) {
          try {
            await this.storageService.abortMultipartUpload(recording.uploadId, recording.fileKey);
          } catch { /* ignore */ }
        }
        processed++;
      }
      await this.redis.zrem(this.EXPIRY_SCHEDULE_KEY, recordingId);
    }

    return processed;
  }

  // ==================== Redis 缓存辅助方法 ====================

  private async cacheRecording(recording: Recording): Promise<void> {
    await this.redis.setex(
      `${this.CACHE_PREFIX}${recording.id}`,
      this.CACHE_TTL,
      JSON.stringify(recording),
    );
  }

  private async removeCache(recordingId: string): Promise<void> {
    await this.redis.del(`${this.CACHE_PREFIX}${recordingId}`);
  }

  private async indexRecording(deviceId: string, recordingId: string): Promise<void> {
    await this.redis.sadd(`${this.INDEX_PREFIX}${deviceId}`, recordingId);
  }

  private async removeIndex(deviceId: string, recordingId: string): Promise<void> {
    await this.redis.srem(`${this.INDEX_PREFIX}${deviceId}`, recordingId);
  }

  private async scheduleExpiryCheck(recordingId: string, delaySeconds: number): Promise<void> {
    await this.redis.zadd(
      this.EXPIRY_SCHEDULE_KEY,
      Date.now() + delaySeconds * 1000,
      recordingId,
    );
  }

  // ==================== 工具方法 ====================

  private calculateDuration(startTime: Date, endTime: Date): number {
    return Math.round((endTime.getTime() - startTime.getTime()) / 1000);
  }

  /**
   * 根据 Content-Type 检测文件扩展名
   */
  private detectExtension(contentType?: string): string {
    if (!contentType) {
      return 'ts'; // 默认扩展名
    }

    const mimeToExt: Record<string, string> = {
      'video/mp2t': 'ts',
      'video/MP2T': 'ts',
      'video/mp4': 'mp4',
      'video/mpeg': 'mpg',
      'video/webm': 'webm',
      'video/x-matroska': 'mkv',
    };

    return mimeToExt[contentType] || 'ts';
  }

  // ==================== 批量预分配（连续录制） ====================

  /**
   * 批量请求上传URL
   * 为连续录制场景一次性生成多个分段的 Presigned PUT URL
   */
  async requestBatchUploadUrls(
    request: RecordingBatchUploadUrlRequest,
  ): Promise<RecordingBatchUploadUrlResponse> {
    const { deviceId, requestId, planId, segmentDuration, segmentCount, startSegmentIndex, startTime, contentType } = request;

    const extension = this.detectExtension(contentType);
    const expiresIn = this.recordingConfig?.presignedUrlTtl || 3600;
    const resolvedContentType = contentType || this.recordingConfig?.defaultContentType || 'video/mp2t';
    const provider = this.storageConfig?.defaultProvider || 'minio';

    const baseTime = new Date(startTime);
    const segments: RecordingBatchUploadUrlResponse['segments'] = [];
    const recordings: Recording[] = [];

    for (let i = 0; i < segmentCount; i++) {
      const segmentStart = new Date(baseTime.getTime() + i * segmentDuration * 1000);
      const fileKey = this.computeSegmentFileKey(deviceId, segmentStart, extension);
      const recordingId = IdGenerator.uuid();

      // 生成 Presigned PUT URL
      const uploadUrl = await this.storageService.getPresignedUploadUrl(fileKey, {
        expiresIn,
        contentType: resolvedContentType,
      });

      segments.push({
        segmentIndex: startSegmentIndex + i,
        fileKey,
        uploadUrl,
        startTime: segmentStart.toISOString(),
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      });

      // 构建 Recording 实体
      const recording = new Recording();
      recording.id = recordingId;
      recording.deviceId = deviceId;
      recording.fileKey = fileKey;
      recording.startTime = segmentStart;
      recording.contentType = resolvedContentType;
      recording.uploadStrategy = UploadStrategy.SINGLE_PUT;
      recording.status = RecordingStatus.PENDING;
      recording.provider = provider;
      recording.planId = planId;
      recording.segmentIndex = startSegmentIndex + i;
      recordings.push(recording);
    }

    // 批量写入 DB
    await this.recordingModel.save(recordings);

    // 批量写入 Redis 缓存 + 过期检查
    for (const recording of recordings) {
      await this.cacheRecording(recording);
      await this.indexRecording(deviceId, recording.id);
      await this.scheduleExpiryCheck(recording.id, expiresIn + 300);
    }

    this.logger.info(`[Recording] Batch upload URLs generated: planId=${planId}, count=${segmentCount}`);

    return { deviceId, requestId, planId, segments };
  }

  /**
   * 批量确认上传完成
   * 设备上传完一批分段后，一次性确认多个段
   */
  async batchRegisterRecordings(
    request: RecordingBatchRegisterRequest,
  ): Promise<RecordingBatchRegisterResponse> {
    const { deviceId, requestId, planId, completedSegments } = request;

    let registeredCount = 0;
    const failedSegments: RecordingBatchRegisterResponse['failedSegments'] = [];

    for (const segment of completedSegments) {
      try {
        const recording = await this.recordingModel.findOne({
          where: { deviceId, fileKey: segment.fileKey },
        });

        if (!recording) {
          failedSegments.push({ segmentIndex: segment.segmentIndex, error: '录像记录不存在' });
          continue;
        }

        // 计算时长
        let duration: number | undefined;
        if (segment.endTime) {
          recording.endTime = new Date(segment.endTime);
          duration = this.calculateDuration(recording.startTime, recording.endTime);
        }
        recording.fileSize = segment.fileSize;

        // 重命名文件以包含 duration
        const finalFileKey = this.addDurationToFileKey(segment.fileKey, duration || 0);
        await this.storageService.move(segment.fileKey, finalFileKey);

        // 更新录像记录
        recording.status = RecordingStatus.COMPLETED;
        recording.fileKey = finalFileKey;
        recording.duration = duration;
        await this.recordingModel.save(recording);
        await this.cacheRecording(recording);

        registeredCount++;
      } catch (error: any) {
        this.logger.error(`[Recording] Batch register failed for segment ${segment.segmentIndex}:`, error);
        failedSegments.push({ segmentIndex: segment.segmentIndex, error: error.message });
      }
    }

    this.logger.info(`[Recording] Batch register: planId=${planId}, registered=${registeredCount}, failed=${failedSegments.length}`);

    return { deviceId, requestId, planId, registeredCount, failedSegments };
  }

  /**
   * 在文件Key中添加时长信息
   * 将不含duration的key转换为含duration的key
   *
   * 输入: recordings/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{timestamp}.{ext}
   * 输出: recordings/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{timestamp}_{duration}.{ext}
   */
  private addDurationToFileKey(fileKey: string, duration: number): string {
    const lastDotIndex = fileKey.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return fileKey;
    }

    const namePart = fileKey.substring(0, lastDotIndex);
    const extPart = fileKey.substring(lastDotIndex);

    return `${namePart}_${duration}${extPart}`;
  }

  /**
   * 解析录像应使用的存储 Provider
   * 优先使用 deviceProviderResolver（按设备配置），降级到默认
   */
  private async resolveRecordingProvider(deviceId: string): Promise<StorageProviderType | undefined> {
    try {
      const resolved = await this.deviceProviderResolver?.resolveStorageProvider(deviceId);
      return resolved as StorageProviderType;
    } catch {
      return this.storageConfig?.defaultProvider as StorageProviderType || undefined;
    }
  }

  // ==================== 时间轴查询 ====================

  /**
   * 获取设备录像时间轴
   *
   * @param deviceId 设备ID
   * @param startDate 开始日期 (YYYY-MM-DD)
   * @param endDate 结束日期 (YYYY-MM-DD)
   * @param includeIncomplete 是否包含未完成的录像
   * @returns 时间轴数据
   */
  async getTimeline(
    deviceId: string,
    startDate?: string,
    endDate?: string,
    includeIncomplete: boolean = false,
  ): Promise<TimelineData> {
    // 使用 QueryBuilder 构建查询，避免 whereCondition 字段覆盖问题
    const query = this.recordingModel.createQueryBuilder('r')
      .where('r.deviceId = :deviceId', { deviceId });

    if (includeIncomplete) {
      // 包含所有状态
    } else {
      query.andWhere('r.status = :status', { status: RecordingStatus.COMPLETED });
    }

    if (startDate) {
      query.andWhere('r.startTime >= :startDate', { startDate: new Date(startDate) });
    }

    if (endDate) {
      const endDateTime = new Date(endDate + 'T23:59:59.999Z');
      query.andWhere('r.startTime <= :endDate', { endDate: endDateTime });
    }

    // 查询录像，按开始时间升序排列
    const recordings = await query.orderBy('r.startTime', 'ASC').getMany();

    if (recordings.length === 0) {
      return {
        deviceId,
        totalDuration: 0,
        totalSize: 0,
        recordingsCount: 0,
        days: [],
        gaps: [],
      };
    }

    // 按天分组
    const daysMap = new Map<string, TimelineRecording[]>();
    let totalDuration = 0;
    let totalSize = 0;
    const gaps: TimeGap[] = [];

    for (let i = 0; i < recordings.length; i++) {
      const recording = recordings[i];
      const date = recording.startTime.toISOString().slice(0, 10);

      totalDuration += recording.duration || 0;
      totalSize += recording.fileSize || 0;

      // 计算时间间隔（检测断点）
      if (i > 0) {
        const prevRecording = recordings[i - 1];
        const prevEndTime = prevRecording.endTime || prevRecording.startTime;
        const gap = recording.startTime.getTime() - prevEndTime.getTime();

        // 如果间隔大于0秒，认为有断点（容差1秒）
        if (gap > 1000) {
          gaps.push({
            startTime: prevEndTime.toISOString(),
            endTime: recording.startTime.toISOString(),
            duration: Math.round(gap / 1000),
          });
        }
      }

      // 添加到天分组
      if (!daysMap.has(date)) {
        daysMap.set(date, []);
      }

      daysMap.get(date)!.push({
        recordingId: recording.id,
        startTime: recording.startTime.toISOString(),
        endTime: recording.endTime?.toISOString() || '',
        duration: recording.duration || 0,
        fileSize: recording.fileSize || 0,
        fileKey: recording.fileKey,
        status: recording.status,
        hasGap: false,
        gapToNext: 0,
      });
    }

    // 转换为数组并计算每个段的间隔
    const days: DayTimeline[] = [];
    for (const [date, dayRecordings] of daysMap) {
      const dayDuration = dayRecordings.reduce((sum, r) => sum + r.duration, 0);

      // 计算每个片段到下一个片段的间隔
      for (let i = 0; i < dayRecordings.length; i++) {
        if (i < dayRecordings.length - 1) {
          const current = dayRecordings[i];
          const next = dayRecordings[i + 1];
          const currentEndTime = current.endTime ? new Date(current.endTime) : new Date(current.startTime);
          const nextStartTime = new Date(next.startTime);
          const gap = nextStartTime.getTime() - currentEndTime.getTime();

          dayRecordings[i].hasGap = gap > 1000; // 容差1秒
          dayRecordings[i].gapToNext = gap > 1000 ? Math.round(gap / 1000) : 0;
        }
      }

      days.push({
        date,
        totalDuration: dayDuration,
        recordings: dayRecordings,
      });
    }

    // 按日期降序排序
    days.sort((a, b) => b.date.localeCompare(a.date));

    return {
      deviceId,
      totalDuration,
      totalSize,
      recordingsCount: recordings.length,
      days,
      gaps,
    };
  }

  /**
   * 获取连续录像片段
   * 返回所有连续的录像片段（即没有断点的录像序列）
   *
   * @param deviceId 设备ID
   * @param minDuration 最小时长（秒），默认60秒
   * @returns 连续录像片段列表
   */
  async getContinuousSegments(
    deviceId: string,
    minDuration: number = 60,
  ): Promise<ContinuousSegment[]> {
    const timeline = await this.getTimeline(deviceId);
    const segments: ContinuousSegment[] = [];

    if (timeline.days.length === 0) {
      return segments;
    }

    // 合并所有天的录像，按时间排序
    const allRecordings = timeline.days
      .flatMap(day => day.recordings)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    // 查找连续片段
    let currentSegment: TimelineRecording[] = [];

    for (let i = 0; i < allRecordings.length; i++) {
      const recording = allRecordings[i];

      if (currentSegment.length === 0) {
        // 开始新片段
        currentSegment.push(recording);
      } else {
        // 检查是否连续
        const lastRecording = currentSegment[currentSegment.length - 1];
        const lastEndTime = lastRecording.endTime ? new Date(lastRecording.endTime) : new Date(lastRecording.startTime);
        const currentStartTime = new Date(recording.startTime);
        const gap = currentStartTime.getTime() - lastEndTime.getTime();

        if (gap <= 1000) {
          // 连续，添加到当前片段
          currentSegment.push(recording);
        } else {
          // 不连续，保存当前片段（如果满足最小时长）
          const segmentDuration = currentSegment.reduce((sum, r) => sum + r.duration, 0);
          if (segmentDuration >= minDuration) {
            segments.push(this.createContinuousSegment(currentSegment));
          }
          // 开始新片段
          currentSegment = [recording];
        }
      }
    }

    // 处理最后一个片段
    if (currentSegment.length > 0) {
      const segmentDuration = currentSegment.reduce((sum, r) => sum + r.duration, 0);
      if (segmentDuration >= minDuration) {
        segments.push(this.createContinuousSegment(currentSegment));
      }
    }

    return segments;
  }

  /**
   * 获取断点统计信息
   *
   * @param deviceId 设备ID
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @returns 断点统计
   */
  async getGapStatistics(
    deviceId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<GapStatistics> {
    const timeline = await this.getTimeline(deviceId, startDate, endDate);

    const gapCount = timeline.gaps.length;
    const totalGapDuration = timeline.gaps.reduce((sum, gap) => sum + gap.duration, 0);
    const recordingDuration = timeline.totalDuration;
    const totalDuration = recordingDuration + totalGapDuration;
    const coverageRate = totalDuration > 0 ? (recordingDuration / totalDuration) * 100 : 0;

    // 按断点时长分组统计
    const gapDistribution = {
      short: timeline.gaps.filter(g => g.duration <= 60).length,  // ≤1分钟
      medium: timeline.gaps.filter(g => g.duration > 60 && g.duration <= 300).length,  // 1-5分钟
      long: timeline.gaps.filter(g => g.duration > 300).length,  // >5分钟
    };

    return {
      deviceId,
      gapCount,
      totalGapDuration,
      recordingDuration,
      totalDuration,
      coverageRate: Math.round(coverageRate * 100) / 100,
      gapDistribution,
      gaps: timeline.gaps,
    };
  }

  /**
   * 创建连续片段对象
   */
  private createContinuousSegment(recordings: TimelineRecording[]): ContinuousSegment {
    const startTime = recordings[0].startTime;
    const endTime = recordings[recordings.length - 1].endTime || recordings[recordings.length - 1].startTime;
    const duration = recordings.reduce((sum, r) => sum + r.duration, 0);
    const fileSize = recordings.reduce((sum, r) => sum + r.fileSize, 0);

    return {
      startTime,
      endTime,
      duration,
      fileSize,
      recordingCount: recordings.length,
      recordings,
    };
  }
}

/**
 * 时间轴数据结构
 */
export interface TimelineData {
  deviceId: string;
  totalDuration: number;       // 总时长（秒）
  totalSize: number;          // 总大小（字节）
  recordingsCount: number;    // 录像数量
  days: DayTimeline[];
  gaps: TimeGap[];
}

export interface DayTimeline {
  date: string;                // YYYY-MM-DD
  totalDuration: number;
  recordings: TimelineRecording[];
}

export interface TimelineRecording {
  recordingId: string;
  startTime: string;         // ISO 8601
  endTime: string;           // ISO 8601
  duration: number;          // 秒
  fileSize: number;
  fileKey: string;
  status: RecordingStatus;
  hasGap: boolean;           // 后面是否有断点
  gapToNext: number;         // 距下一段的间隔秒数
}

export interface TimeGap {
  startTime: string;
  endTime: string;
  duration: number;
}

export interface ContinuousSegment {
  startTime: string;
  endTime: string;
  duration: number;
  fileSize: number;
  recordingCount: number;
  recordings: TimelineRecording[];
}

export interface GapStatistics {
  deviceId: string;
  gapCount: number;
  totalGapDuration: number;
  recordingDuration: number;
  totalDuration: number;
  coverageRate: number;      // 录像覆盖率（百分比）
  gapDistribution: {
    short: number;   // ≤1分钟
    medium: number;  // 1-5分钟
    long: number;    // >5分钟
  };
  gaps: TimeGap[];
}
