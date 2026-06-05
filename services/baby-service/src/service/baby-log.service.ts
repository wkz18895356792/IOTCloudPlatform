import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { BabyLogEntity } from '../entity/baby-log.entity';
import {
  BabyLog,
  BabyLogEventType,
  BabyLogSource,
  BabyLogLevel,
  CreateBabyLogRequest,
  UpdateBabyLogRequest,
  BabyLogQueryParams,
  PaginatedResponse,
  IdGenerator,
} from '@baby-monitor/shared-types';

/**
 * 宝宝日志服务
 *
 * 提供统一的宝宝日志管理功能，整合了喂养、睡眠、尿布、成长、健康、监控、里程碑等所有类型的事件记录
 *
 * 主要功能：
 * - 创建日志记录（支持手动和算法自动检测）
 * - 查询日志（支持按类型、时间范围、来源等筛选）
 * - 更新日志（结束时间、备注、确认状态等）
 * - 删除日志
 * - 统计分析（按类型、日期范围等统计）
 * - 批量操作
 */
@Provide()
export class BabyLogService {
  @Inject()
  logger!: ILogger;

  @InjectEntityModel(BabyLogEntity)
  babyLogRepository!: Repository<BabyLogEntity>;

  /**
   * 创建日志记录
   *
   * @param data 日志数据
   * @returns 创建的日志记录
   */
  async createLog(data: CreateBabyLogRequest): Promise<BabyLog> {
    // 计算持续时长（如果提供了结束时间）
    let duration: number | undefined;
    if (data.endTime) {
      const startTime = typeof data.startTime === 'string' ? new Date(data.startTime).getTime() : data.startTime.getTime();
      const endTime = typeof data.endTime === 'string' ? new Date(data.endTime).getTime() : data.endTime.getTime();
      duration = Math.floor((endTime - startTime) / 1000);
    }

    // 生成唯一事件ID（防止重复记录）
    const eventId = data.eventId || IdGenerator.uuid();

    // 转换日期字符串为Date对象
    const startTime = typeof data.startTime === 'string' ? new Date(data.startTime) : data.startTime;
    const endTime = data.endTime ? (typeof data.endTime === 'string' ? new Date(data.endTime) : data.endTime) : undefined;

    const log = this.babyLogRepository.create({
      id: IdGenerator.uuid(),
      babyId: data.babyId,
      deviceId: data.deviceId,
      eventId,
      eventType: data.eventType,
      startTime,
      endTime,
      duration,
      timezone: data.timezone,
      source: data.source,
      level: data.level,
      videoPath: data.videoPath,
      videoTimestamp: data.videoTimestamp,
      thumbnailUrl: data.thumbnailUrl,
      confidence: data.confidence,
      note: data.note,
      metadata: data.metadata,
      recordedBy: data.recordedBy,
      acknowledged: false,
    });

    await this.babyLogRepository.save(log);
    this.logger.info(`[BabyLogService] 创建日志成功: babyId=${data.babyId}, eventType=${data.eventType}`);

    return this.entityToDto(log);
  }

  /**
   * 批量创建日志记录
   *
   * @param logs 日志数据数组
   * @returns 创建的日志记录数组
   */
  async createLogsBatch(logs: CreateBabyLogRequest[]): Promise<BabyLog[]> {
    const entities = logs.map(data => {
      let duration: number | undefined;
      if (data.endTime) {
        const startTime = typeof data.startTime === 'string' ? new Date(data.startTime).getTime() : data.startTime.getTime();
        const endTime = typeof data.endTime === 'string' ? new Date(data.endTime).getTime() : data.endTime.getTime();
        duration = Math.floor((endTime - startTime) / 1000);
      }

      const eventId = data.eventId || IdGenerator.uuid();

      // 转换日期字符串为Date对象
      const startTime = typeof data.startTime === 'string' ? new Date(data.startTime) : data.startTime;
      const endTime = data.endTime ? (typeof data.endTime === 'string' ? new Date(data.endTime) : data.endTime) : undefined;

      return this.babyLogRepository.create({
        id: IdGenerator.uuid(),
        babyId: data.babyId,
        deviceId: data.deviceId,
        eventId,
        eventType: data.eventType,
        startTime,
        endTime,
        duration,
        timezone: data.timezone,
        source: data.source,
        level: data.level,
        videoPath: data.videoPath,
        videoTimestamp: data.videoTimestamp,
        thumbnailUrl: data.thumbnailUrl,
        confidence: data.confidence,
        note: data.note,
        metadata: data.metadata,
        recordedBy: data.recordedBy,
        acknowledged: false,
      });
    });

    const saved = await this.babyLogRepository.save(entities);
    this.logger.info(`[BabyLogService] 批量创建日志成功: count=${logs.length}`);

    return saved.map(log => this.entityToDto(log));
  }

  /**
   * 获取日志详情
   *
   * @param logId 日志ID
   * @returns 日志记录，不存在返回null
   */
  async getLog(logId: string): Promise<BabyLog | null> {
    const log = await this.babyLogRepository.findOne({ where: { id: logId } });
    return log ? this.entityToDto(log) : null;
  }

  /**
   * 通过事件ID获取日志
   *
   * @param eventId 事件ID
   * @returns 日志记录，不存在返回null
   */
  async getLogByEventId(eventId: string): Promise<BabyLog | null> {
    const log = await this.babyLogRepository.findOne({ where: { eventId } });
    return log ? this.entityToDto(log) : null;
  }

  /**
   * 查询日志列表（分页）
   *
   * @param params 查询参数
   * @returns 分页的日志列表
   */
  async getLogs(params: BabyLogQueryParams): Promise<PaginatedResponse<BabyLog>> {
    const {
      babyId,
      eventTypes,
      startDate,
      endDate,
      source,
      acknowledged,
      page,
      pageSize,
    } = params;

    // 构建查询条件
    const where: any = { babyId };

    if (eventTypes && eventTypes.length > 0) {
      where.eventType = In(eventTypes);
    }

    if (startDate || endDate) {
      where.startTime = Between(
        startDate || new Date('2000-01-01'),
        endDate || new Date()
      );
    }

    if (source) {
      where.source = source;
    }

    if (acknowledged !== undefined) {
      where.acknowledged = acknowledged;
    }

    // 查询数据
    const [items, total] = await this.babyLogRepository.findAndCount({
      where,
      order: { startTime: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items: items.map(log => this.entityToDto(log)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取宝宝最新的一条日志
   *
   * @param babyId 宝宝ID
   * @param eventType 事件类型（可选）
   * @returns 最新的日志记录
   */
  async getLatestLog(babyId: string, eventType?: BabyLogEventType): Promise<BabyLog | null> {
    const where: any = { babyId };
    if (eventType) {
      where.eventType = eventType;
    }

    const log = await this.babyLogRepository.findOne({
      where,
      order: { startTime: 'DESC' },
    });

    return log ? this.entityToDto(log) : null;
  }

  /**
   * 更新日志记录
   *
   * @param logId 日志ID
   * @param data 更新数据
   * @returns 更新后的日志记录，不存在返回null
   */
  async updateLog(logId: string, data: UpdateBabyLogRequest): Promise<BabyLog | null> {
    const log = await this.babyLogRepository.findOne({ where: { id: logId } });
    if (!log) {
      return null;
    }

    // 更新字段
    if (data.endTime !== undefined) {
      // 转换字符串为Date
      log.endTime = typeof data.endTime === 'string' ? new Date(data.endTime) : data.endTime;
      // 重新计算持续时长
      if (data.endTime && log.startTime) {
        const startTime = new Date(log.startTime).getTime();
        const endTime = typeof data.endTime === 'string' ? new Date(data.endTime).getTime() : data.endTime.getTime();
        log.duration = Math.floor((endTime - startTime) / 1000);
      }
    }

    if (data.note !== undefined) {
      log.note = data.note;
    }

    if (data.metadata !== undefined) {
      log.metadata = { ...log.metadata, ...data.metadata };
    }

    if (data.acknowledged !== undefined) {
      log.acknowledged = data.acknowledged;
      if (data.acknowledged) {
        log.acknowledgedAt = new Date();
      } else {
        log.acknowledgedAt = null;
        log.acknowledgedBy = null;
      }
    }

    await this.babyLogRepository.save(log);
    this.logger.info(`[BabyLogService] 更新日志成功: logId=${logId}`);

    return this.entityToDto(log);
  }

  /**
   * 确认日志（主要用于监控事件）
   *
   * @param logId 日志ID
   * @param userId 确认人ID
   * @param notes 备注信息（可选）
   * @returns 更新后的日志记录，不存在或已确认返回null
   */
  async acknowledgeLog(logId: string, userId: string, notes?: string): Promise<BabyLog | null> {
    const log = await this.babyLogRepository.findOne({ where: { id: logId } });
    if (!log || log.acknowledged) {
      return null;
    }

    log.acknowledged = true;
    log.acknowledgedBy = userId;
    log.acknowledgedAt = new Date();
    if (notes) {
      log.note = notes;
    }

    await this.babyLogRepository.save(log);
    this.logger.info(`[BabyLogService] 确认日志成功: logId=${logId}, userId=${userId}`);

    return this.entityToDto(log);
  }

  /**
   * 批量确认日志
   *
   * @param logIds 日志ID数组
   * @param userId 确认人ID
   * @returns 成功确认的日志数量
   */
  async acknowledgeLogsBatch(logIds: string[], userId: string): Promise<number> {
    const result = await this.babyLogRepository
      .createQueryBuilder()
      .update(BabyLogEntity)
      .set({
        acknowledged: true,
        acknowledgedBy: userId,
        acknowledgedAt: new Date(),
      })
      .where({ id: In(logIds) })
      .andWhere({ acknowledged: false })
      .execute();

    this.logger.info(`[BabyLogService] 批量确认日志成功: count=${result.affected || 0}, userId=${userId}`);
    return result.affected || 0;
  }

  /**
   * 删除日志记录
   *
   * @param logId 日志ID
   * @returns 是否删除成功
   */
  async deleteLog(logId: string): Promise<boolean> {
    const result = await this.babyLogRepository.delete({ id: logId });
    const success = (result.affected ?? 0) > 0;

    if (success) {
      this.logger.info(`[BabyLogService] 删除日志成功: logId=${logId}`);
    }

    return success;
  }

  /**
   * 批量删除日志记录
   *
   * @param logIds 日志ID数组
   * @returns 删除的日志数量
   */
  async deleteLogsBatch(logIds: string[]): Promise<number> {
    const result = await this.babyLogRepository.delete({ id: In(logIds) });
    const count = result.affected || 0;

    this.logger.info(`[BabyLogService] 批量删除日志成功: count=${count}`);
    return count;
  }

  /**
   * 获取日志统计
   *
   * @param babyId 宝宝ID
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @returns 统计数据
   */
  async getLogStats(
    babyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    total: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    acknowledged: number;
    unacknowledged: number;
  }> {
    const logs = await this.babyLogRepository.find({
      where: {
        babyId,
        startTime: Between(startDate, endDate),
      },
    });

    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let acknowledged = 0;
    let unacknowledged = 0;

    for (const log of logs) {
      // 按类型统计
      byType[log.eventType] = (byType[log.eventType] || 0) + 1;

      // 按来源统计
      bySource[log.source] = (bySource[log.source] || 0) + 1;

      // 确认状态统计
      if (log.acknowledged) {
        acknowledged++;
      } else {
        unacknowledged++;
      }
    }

    return {
      total: logs.length,
      byType,
      bySource,
      acknowledged,
      unacknowledged,
    };
  }

  /**
   * 获取指定日期的日志汇总
   *
   * @param babyId 宝宝ID
   * @param date 日期
   * @returns 日志汇总数据
   */
  async getDailySummary(babyId: string, date: Date): Promise<{
    date: string;
    feeding: { count: number; totalAmount?: number };
    sleep: { count: number; totalDuration: number };
    diaper: { wet: number; dirty: number; mixed: number; dry: number };
    monitoring: { total: number; byType: Record<string, number> };
    growth: { weight?: number; height?: number };
  }> {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const logs = await this.babyLogRepository.find({
      where: {
        babyId,
        startTime: Between(startDate, endDate),
      },
    });

    // 初始化统计
    const summary = {
      date: date.toISOString().split('T')[0],
      feeding: { count: 0, totalAmount: 0 },
      sleep: { count: 0, totalDuration: 0 },
      diaper: { wet: 0, dirty: 0, mixed: 0, dry: 0 },
      monitoring: { total: 0, byType: {} as Record<string, number> },
      growth: {} as { weight?: number; height?: number },
    };

    // 分类统计
    for (const log of logs) {
      switch (log.eventType) {
        // 喂养相关
        case BabyLogEventType.BREAST_FEEDING:
        case BabyLogEventType.BOTTLE_FEEDING:
          summary.feeding.count++;
          if (log.metadata?.amount) {
            summary.feeding.totalAmount = (summary.feeding.totalAmount || 0) + log.metadata.amount;
          }
          break;

        // 睡眠相关
        case BabyLogEventType.SLEEP:
          summary.sleep.count++;
          if (log.duration) {
            summary.sleep.totalDuration += log.duration;
          }
          break;

        // 尿布相关 - 从 metadata 中读取 diaperType
        case BabyLogEventType.DIAPER_CHANGE:
          const diaperType = log.metadata?.diaperType;
          if (diaperType === 'wet') summary.diaper.wet++;
          else if (diaperType === 'dirty') summary.diaper.dirty++;
          else if (diaperType === 'mixed') summary.diaper.mixed++;
          else if (diaperType === 'dry') summary.diaper.dry++;
          else summary.diaper.wet++; // 默认为湿尿布
          break;

        // 成长记录 - 从 metadata 中读取
        case BabyLogEventType.BREAST_FEEDING:
        case BabyLogEventType.BOTTLE_FEEDING:
          // 喂养记录在上面已经处理
          break;

        // 监控事件
        default:
          if (log.eventType.startsWith('monitoring_')) {
            summary.monitoring.total++;
            summary.monitoring.byType[log.eventType] = (summary.monitoring.byType[log.eventType] || 0) + 1;
          }
          break;
      }
    }

    return summary;
  }

  /**
   * 清理过期日志
   *
   * @param beforeDate 清除此日期之前的日志
   * @returns 删除的日志数量
   */
  async cleanOldLogs(beforeDate: Date): Promise<number> {
    const result = await this.babyLogRepository
      .createQueryBuilder()
      .delete()
      .where('startTime < :beforeDate', { beforeDate })
      .execute();

    const count = result.affected || 0;
    this.logger.info(`[BabyLogService] 清理过期日志成功: count=${count}, beforeDate=${beforeDate}`);

    return count;
  }

  /**
   * 将实体转换为 DTO
   *
   * @param entity 实体对象
   * @returns DTO 对象
   */
  private entityToDto(entity: BabyLogEntity): BabyLog {
    return {
      id: entity.id,
      babyId: entity.babyId,
      deviceId: entity.deviceId || undefined,
      eventId: entity.eventId,
      eventType: entity.eventType as BabyLogEventType,
      startTime: entity.startTime,
      endTime: entity.endTime || undefined,
      duration: entity.duration || undefined,
      timezone: entity.timezone || undefined,
      source: entity.source as BabyLogSource,
      level: entity.level ? (entity.level as BabyLogLevel) : undefined,
      videoPath: entity.videoPath || undefined,
      videoTimestamp: entity.videoTimestamp || undefined,
      thumbnailUrl: entity.thumbnailUrl || undefined,
      confidence: entity.confidence || undefined,
      note: entity.note || undefined,
      metadata: entity.metadata || undefined,
      acknowledged: entity.acknowledged,
      acknowledgedBy: entity.acknowledgedBy || undefined,
      acknowledgedAt: entity.acknowledgedAt || undefined,
      recordedBy: entity.recordedBy || undefined,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
