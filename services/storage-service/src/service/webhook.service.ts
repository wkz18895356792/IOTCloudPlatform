import { Provide, Inject, Scope, ScopeEnum, Config, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { Recording } from '../entity/recording.entity';
import { RecordingStatus, UploadStrategy } from '@baby-monitor/shared-types';
import {
  NormalizedStorageEvent,
  detectProviderAndParse,
  parseS3Event,
  parseCOSEvent,
  parseOSSEvent,
  StorageProvider,
} from '../util/webhook-event-parser';
import {
  isRecordingFileKey,
  parseFileKey,
  stripDurationFromKey,
} from '../util/filekey-parser';

/**
 * 云存储事件回调处理服务
 *
 * 接收 S3/COS/OSS 的对象创建事件通知，
 * 自动创建或更新录像切片索引记录
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class WebhookService {
  @Inject() logger!: ILogger;
  @Inject() redis!: RedisService;
  @InjectEntityModel(Recording) recordingModel!: Repository<Recording>;

  @Config('webhook') webhookConfig!: any;

  private readonly IDEMPOTENCY_PREFIX = 'webhook:processed:';
  private readonly IDEMPOTENCY_TTL = 86400; // 24小时

  @Init()
  async initialize(): Promise<void> {
    this.logger.info('[Webhook] Service initialized');
  }

  /**
   * 解析请求体为标准化事件列表
   * 根据 provider 参数或自动检测选择解析器
   */
  parseEvents(
    body: any,
    headers: Record<string, string>,
    provider?: string,
  ): NormalizedStorageEvent[] {
    if (provider) {
      switch (provider as StorageProvider) {
        case 'aws_s3':
          return parseS3Event(body);
        case 'tencent_cos':
          return parseCOSEvent(body);
        case 'aliyun_oss':
          return parseOSSEvent(body);
        default:
          return [];
      }
    }
    return detectProviderAndParse(body, headers);
  }

  /**
   * 处理单个标准化存储事件
   */
  async processStorageEvent(event: NormalizedStorageEvent): Promise<void> {
    const { fileKey, provider, etag } = event;

    // 1. 幂等检查：setnx 返回 1=设置成功（新事件），0=key 已存在（重复事件）
    const idempotencyKey = `${this.IDEMPOTENCY_PREFIX}${provider}:${fileKey}:${etag}`;
    const isNew = await this.redis.setnx(idempotencyKey, '1');
    if (!isNew) {
      this.logger.info(`[Webhook] Skipping already processed event: ${fileKey}`);
      return;
    }

    // 设置幂等键 TTL（即使后续处理失败也标记，防止重复）
    await this.redis.expire(idempotencyKey, this.webhookConfig?.idempotencyTTL || this.IDEMPOTENCY_TTL);

    // 2. 文件过滤：只处理录像文件
    if (!isRecordingFileKey(fileKey)) {
      this.logger.debug(`[Webhook] Ignoring non-recording file: ${fileKey}`);
      return;
    }

    // 3. 解析文件路径元数据
    const parsed = parseFileKey(fileKey);
    if (!parsed.isValid || !parsed.deviceId) {
      this.logger.warn(`[Webhook] Cannot parse fileKey: ${fileKey}`);
      return;
    }

    // 4. 查找已有录像记录
    let recording = await this.findRecordingByFileKey(fileKey);

    // 5. 分支处理
    if (recording) {
      if (recording.status === RecordingStatus.COMPLETED) {
        // 已完成，设备已注册或已处理过
        this.logger.info(`[Webhook] Recording already completed: ${recording.id}`);
        return;
      }

      // 更新 PENDING/UPLOADING → COMPLETED
      recording.status = RecordingStatus.COMPLETED;
      recording.fileSize = event.fileSize || recording.fileSize;

      if (parsed.duration !== null && parsed.duration > 0) {
        recording.duration = parsed.duration;
        recording.endTime = new Date(recording.startTime.getTime() + parsed.duration * 1000);
      }

      await this.recordingModel.save(recording);
      this.logger.info(`[Webhook] Updated recording ${recording.id} to COMPLETED: ${fileKey}`);
    } else {
      // 不存在，创建新记录
      recording = new Recording();
      recording.id = require('uuid').v4();
      recording.deviceId = parsed.deviceId;
      recording.fileKey = fileKey;
      recording.startTime = parsed.startTime || new Date();
      recording.contentType = parsed.contentType;
      recording.uploadStrategy = UploadStrategy.SINGLE_PUT;
      recording.status = RecordingStatus.COMPLETED;
      recording.provider = provider;
      recording.fileSize = event.fileSize || 0;

      if (parsed.duration !== null && parsed.duration > 0) {
        recording.duration = parsed.duration;
        recording.endTime = new Date(recording.startTime.getTime() + parsed.duration * 1000);
      }

      await this.recordingModel.save(recording);
      this.logger.info(
        `[Webhook] Created new recording ${recording.id} for device ${parsed.deviceId}: ${fileKey}`,
      );
    }
  }

  /**
   * 按 fileKey 查找录像记录
   * 同时尝试不含 duration 后缀的 key（设备上传时可能不含 _duration）
   */
  private async findRecordingByFileKey(fileKey: string): Promise<Recording | null> {
    // 精确匹配
    let recording = await this.recordingModel.findOne({ where: { fileKey } });
    if (recording) return recording;

    // 尝试去掉 duration 后缀匹配
    const baseKey = stripDurationFromKey(fileKey);
    if (baseKey !== fileKey) {
      recording = await this.recordingModel.findOne({ where: { fileKey: baseKey } });
      if (recording) {
        // 更新 fileKey 为带 duration 的版本
        recording.fileKey = fileKey;
        return recording;
      }
    }

    return null;
  }

  /**
   * 验证 webhook token
   */
  validateToken(token: string): boolean {
    if (!this.webhookConfig?.token) {
      this.logger.warn('[Webhook] No webhook token configured');
      return false;
    }
    return token === this.webhookConfig.token;
  }
}
