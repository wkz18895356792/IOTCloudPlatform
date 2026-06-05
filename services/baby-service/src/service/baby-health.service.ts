/**
 * 宝宝健康与发育服务
 *
 * 提供宝宝成长记录、健康事件和里程碑的管理功能
 */
import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, Between } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { BabyGrowthRecord } from '../entity/baby-growth-record.entity';
import { BabyHealthEvent } from '../entity/baby-health-event.entity';
import { BabyMilestone } from '../entity/baby-milestone.entity';
import { IdGenerator } from '@baby-monitor/shared-utils';

/**
 * 百分位数据
 */
export interface GrowthPercentile {
  ageInMonths: number;
  p3: number;   // 第3百分位
  p15: number;  // 第15百分位
  p50: number;  // 第50百分位（中位数）
  p85: number;  // 第85百分位
  p97: number;  // 第97百分位
}

/**
 * 标准生长数据（包含身高、体重、头围的标准值）
 */
export interface StandardGrowthData {
  height: GrowthPercentile;
  weight: GrowthPercentile;
  headCircumference: GrowthPercentile;
}

@Provide()
export class BabyHealthService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @InjectEntityModel(BabyGrowthRecord)
  growthRecordRepository!: Repository<BabyGrowthRecord>;

  @InjectEntityModel(BabyHealthEvent)
  healthEventRepository!: Repository<BabyHealthEvent>;

  @InjectEntityModel(BabyMilestone)
  milestoneRepository!: Repository<BabyMilestone>;

  // ==================== 成长记录 ====================

  /**
   * 创建成长记录
   */
  async createGrowthRecord(babyId: string, data: {
    recordDate: Date;
    height?: number;
    weight?: number;
    headCircumference?: number;
    chestCircumference?: number;
    ageInMonths?: number;
    notes?: string;
    recordedBy: string;
  }): Promise<BabyGrowthRecord> {
    const record = this.growthRecordRepository.create({
      id: IdGenerator.uuid(),
      babyId,
      ...data,
    });

    const saved = await this.growthRecordRepository.save(record);

    // 计算百分位
    await this.calculatePercentiles(saved.id);

    this.logger.info(`[BabyHealth] Created growth record for baby ${babyId}`);
    return saved;
  }

  /**
   * 获取成长记录列表
   */
  async getGrowthRecords(babyId: string, options: {
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  } = {}): Promise<BabyGrowthRecord[]> {
    const where: any = { babyId };

    if (options.startDate && options.endDate) {
      where.recordDate = Between(options.startDate, options.endDate);
    }

    return this.growthRecordRepository.find({
      where,
      order: { recordDate: 'DESC' },
      take: options.limit || 100,
    });
  }

  /**
   * 计算百分位
   */
  private async calculatePercentiles(recordId: string): Promise<void> {
    const record = await this.growthRecordRepository.findOne({
      where: { id: recordId } as any,
    });

    if (!record || !record.ageInMonths) {
      return;
    }

    // 获取标准生长曲线数据（WHO标准）
    const standardData = this.getStandardGrowthData(record.ageInMonths);

    const percentiles = {
      height: this.calculatePercentile(record.height, standardData.height),
      weight: this.calculatePercentile(record.weight, standardData.weight),
      headCircumference: this.calculatePercentile(record.headCircumference, standardData.headCircumference),
    };

    record.percentiles = percentiles;
    await this.growthRecordRepository.save(record);
  }

  /**
   * 获取标准生长数据（WHO标准简化版）
   */
  private getStandardGrowthData(ageInMonths: number): StandardGrowthData {
    // 这里应该使用实际的WHO生长标准数据
    // 这里提供简化的示例数据
    return {
      height: { ageInMonths, p3: 45, p15: 48, p50: 52, p85: 56, p97: 60 },
      weight: { ageInMonths, p3: 2500, p15: 2800, p50: 3200, p85: 3600, p97: 4000 },
      headCircumference: { ageInMonths, p3: 32, p15: 34, p50: 36, p85: 38, p97: 40 },
    };
  }

  /**
   * 计算单个值的百分位
   */
  private calculatePercentile(value: number | undefined, standard: GrowthPercentile): number | undefined {
    if (!value) return undefined;

    if (value <= standard.p3) return 3;
    if (value <= standard.p15) return 15;
    if (value <= standard.p50) return 50;
    if (value <= standard.p85) return 85;
    return 97;
  }

  /**
   * 获取生长曲线
   */
  async getGrowthCurve(babyId: string): Promise<{
    height: Array<{ date: Date; value: number; percentile?: number }>;
    weight: Array<{ date: Date; value: number; percentile?: number }>;
  }> {
    const records = await this.growthRecordRepository.find({
      where: { babyId } as any,
      order: { recordDate: 'ASC' },
    });

    const height = records
      .filter(r => r.height !== null && r.height !== undefined)
      .map(r => ({
        date: r.recordDate,
        value: r.height!,
        percentile: r.percentiles?.height,
      }));

    const weight = records
      .filter(r => r.weight !== null && r.weight !== undefined)
      .map(r => ({
        date: r.recordDate,
        value: r.weight!,
        percentile: r.percentiles?.weight,
      }));

    return { height, weight };
  }

  // ==================== 健康事件 ====================

  /**
   * 创建健康事件
   */
  async createHealthEvent(babyId: string, data: {
    eventType: string;
    eventDate: Date;
    title: string;
    description?: string;
    details?: any;
    hospital?: string;
    doctor?: string;
    cost?: number;
    attachments?: Array<{ url: string; type: string; name: string }>;
    requiresFollowUp?: boolean;
    followUpDate?: Date;
    recordedBy: string;
  }): Promise<BabyHealthEvent> {
    const event = this.healthEventRepository.create({
      babyId,
      eventType: data.eventType,
      eventDate: data.eventDate,
      title: data.title,
      description: data.description,
      details: data.details,
      hospital: data.hospital,
      doctor: data.doctor,
      cost: data.cost,
      attachments: data.attachments as Array<{ url: string; type: 'image' | 'document' | 'report'; name: string; }>,
      requiresFollowUp: data.requiresFollowUp ?? false,
      followUpDate: data.followUpDate,
      recordedBy: data.recordedBy,
    });

    const saved = await this.healthEventRepository.save(event);

    // 设置跟进提醒
    if (data.requiresFollowUp && data.followUpDate) {
      await this.scheduleFollowUp(saved.id, data.followUpDate);
    }

    this.logger.info(`[BabyHealth] Created health event for baby ${babyId}`);
    return saved;
  }

  /**
   * 获取健康事件列表
   */
  async getHealthEvents(babyId: string, options: {
    eventType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  } = {}): Promise<BabyHealthEvent[]> {
    const where: any = { babyId };

    if (options.eventType) {
      where.eventType = options.eventType;
    }

    if (options.startDate && options.endDate) {
      where.eventDate = Between(options.startDate, options.endDate);
    }

    return this.healthEventRepository.find({
      where,
      order: { eventDate: 'DESC' },
      take: options.limit || 100,
    });
  }

  /**
   * 获取待跟进的健康事件
   */
  async getPendingFollowUps(babyId: string): Promise<BabyHealthEvent[]> {
    return this.healthEventRepository.find({
      where: {
        babyId,
        requiresFollowUp: true,
        followUpDate: { $lte: new Date() } as any,
      } as any,
      order: { followUpDate: 'ASC' },
    });
  }

  /**
   * 安排跟进提醒
   */
  private async scheduleFollowUp(eventId: string, followUpDate: Date): Promise<void> {
    // 使用 Redis 存储提醒
    const key = `health:followup:${eventId}`;
    await this.redis.set(key, JSON.stringify({ eventId, followUpDate }));
    await this.redis.expireat(key, Math.floor(followUpDate.getTime() / 1000) + 86400);
  }

  // ==================== 里程碑 ====================

  /**
   * 创建里程碑记录
   */
  async createMilestone(babyId: string, data: {
    category: string;
    milestoneDate: Date;
    title: string;
    description?: string;
    ageInMonths?: number;
    isEarly?: boolean;
    isDelayed?: boolean;
    notes?: string;
    attachments?: Array<{ url: string; type: string; name: string }>;
    recordedBy: string;
  }): Promise<BabyMilestone> {
    const milestone = this.milestoneRepository.create({
      babyId,
      category: data.category,
      milestoneDate: data.milestoneDate,
      title: data.title,
      description: data.description,
      ageInMonths: data.ageInMonths,
      isEarly: data.isEarly ?? false,
      isDelayed: data.isDelayed ?? false,
      notes: data.notes,
      attachments: data.attachments as Array<{ url: string; type: 'image' | 'video'; name: string; }>,
      recordedBy: data.recordedBy,
    });

    const saved = await this.milestoneRepository.save(milestone);

    this.logger.info(`[BabyHealth] Created milestone for baby ${babyId}`);
    return saved;
  }

  /**
   * 获取里程碑列表
   */
  async getMilestones(babyId: string, options: {
    category?: string;
    limit?: number;
  } = {}): Promise<BabyMilestone[]> {
    const where: any = { babyId };

    if (options.category) {
      where.category = options.category;
    }

    return this.milestoneRepository.find({
      where,
      order: { milestoneDate: 'DESC' },
      take: options.limit || 100,
    });
  }

  /**
   * 获取里程碑统计
   */
  async getMilestoneStats(babyId: string): Promise<{
    total: number;
    byCategory: Record<string, number>;
    earlyCount: number;
    delayedCount: number;
  }> {
    const milestones = await this.milestoneRepository.find({
      where: { babyId } as any,
    });

    const byCategory: Record<string, number> = {};
    let earlyCount = 0;
    let delayedCount = 0;

    for (const milestone of milestones) {
      byCategory[milestone.category] = (byCategory[milestone.category] || 0) + 1;
      if (milestone.isEarly) earlyCount++;
      if (milestone.isDelayed) delayedCount++;
    }

    return {
      total: milestones.length,
      byCategory,
      earlyCount,
      delayedCount,
    };
  }

  /**
   * 获取推荐的里程碑
   */
  async getRecommendedMilestones(babyId: string, ageInMonths: number): Promise<Array<{
    category: string;
    title: string;
    description: string;
    typicalAgeRange: [number, number];
  }>> {
    // 基于年龄返回推荐里程碑（简化版）
    const recommendations: Array<{
      category: string;
      title: string;
      description: string;
      typicalAgeRange: [number, number];
    }> = [];

    // 运动发育
    if (ageInMonths >= 2 && ageInMonths < 4) {
      recommendations.push({
        category: 'motor',
        title: '抬头',
        description: '宝宝可以在俯卧时抬头',
        typicalAgeRange: [2, 4],
      });
    }

    if (ageInMonths >= 6 && ageInMonths < 10) {
      recommendations.push({
        category: 'motor',
        title: '独坐',
        description: '宝宝可以独自坐着',
        typicalAgeRange: [6, 8],
      });
    }

    if (ageInMonths >= 9 && ageInMonths < 12) {
      recommendations.push({
        category: 'motor',
        title: '爬行',
        description: '宝宝可以手脚并用爬行',
        typicalAgeRange: [9, 12],
      });
    }

    if (ageInMonths >= 12 && ageInMonths < 15) {
      recommendations.push({
        category: 'motor',
        title: '走路',
        description: '宝宝可以独立行走',
        typicalAgeRange: [12, 15],
      });
    }

    // 语言发育
    if (ageInMonths >= 6 && ageInMonths < 9) {
      recommendations.push({
        category: 'language',
        title: '咿呀学语',
        description: '宝宝开始发出简单的声音',
        typicalAgeRange: [6, 9],
      });
    }

    if (ageInMonths >= 12 && ageInMonths < 18) {
      recommendations.push({
        category: 'language',
        title: '说第一个词',
        description: '宝宝说出第一个有意义的词',
        typicalAgeRange: [12, 18],
      });
    }

    // 认知发育
    if (ageInMonths >= 8 && ageInMonths < 12) {
      recommendations.push({
        category: 'cognitive',
        title: '物体永久性',
        description: '理解物体即使看不见也仍然存在',
        typicalAgeRange: [8, 12],
      });
    }

    return recommendations;
  }
}
