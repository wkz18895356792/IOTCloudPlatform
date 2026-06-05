import { Provide, Inject, Init, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RecordingService } from './recording.service';

/**
 * 录像过期清理定时器
 * 定期检查并标记超时未完成的录像
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class RecordingCleanerScheduler {
  @Inject() logger!: ILogger;
  @Inject() recordingService!: RecordingService;

  private timer: NodeJS.Timeout | null = null;

  @Init()
  async init(): Promise<void> {
    const interval = 5 * 60 * 1000; // 每5分钟
    this.timer = setInterval(async () => {
      try {
        const expired = await this.recordingService.processExpiredRecordings();
        if (expired > 0) {
          this.logger.info(`[Recording Cleaner] 标记 ${expired} 条录像为超时失败`);
        }
      } catch (error: any) {
        this.logger.error('[Recording Cleaner] 执行失败:', error);
      }
    }, interval);

    this.logger.info('[Recording Cleaner] 定时任务已启动（间隔: 5分钟）');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
