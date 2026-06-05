import { Provide, Inject } from '@midwayjs/core';
import { BabyService } from './baby.service';
import { BabyLogService } from './baby-log.service';
import { BabyGrowthAnalyticsService, Gender } from './baby-growth-analytics.service';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { BabyGrowthRecord } from '../entity/baby-growth-record.entity';
import { DailySummary, WeeklyReport, GrowthPercentile, BabyLogEventType } from '@baby-monitor/shared-types';

/**
 * 数据分析服务类
 *
 * 负责宝宝护理数据的分析和报告，包括：
 * - 每日摘要和周报生成
 * - 生长百分位计算
 * - 生长趋势分析
 * - 喂养和睡眠模式分析
 */
@Provide()
export class AnalyticsService {
  @Inject()
  babyService!: BabyService;

  @Inject()
  babyLogService!: BabyLogService;

  @Inject()
  babyGrowthAnalyticsService!: BabyGrowthAnalyticsService;

  @InjectEntityModel(BabyGrowthRecord)
  babyGrowthRecordRepository!: Repository<BabyGrowthRecord>;

  /**
   * 生成每日摘要
   *
   * 生成指定日期的宝宝护理摘要，包括：
   * - 喂养记录统计（次数、总奶量）
   * - 睡眠记录统计（总时长）
   * - 换尿布记录统计（次数、尿湿、脏）
   * - 成长记录（体重、身高）
   * - 监控事件统计
   *
   * @param babyId - 宝宝ID
   * @param date - 目标日期
   * @returns 每日摘要数据
   */
  async generateDailySummary(babyId: string, date: Date): Promise<DailySummary> {
    const summary = await this.babyLogService.getDailySummary(babyId, date);

    // 转换为 DailySummary 格式
    const diaperChangeCount = summary.diaper.wet + summary.diaper.dirty + summary.diaper.mixed + summary.diaper.dry;
    const wetDiapers = summary.diaper.wet + summary.diaper.mixed;
    const dirtyDiapers = summary.diaper.dirty + summary.diaper.mixed;

    return {
      babyId,
      date,
      feedingCount: summary.feeding.count,
      feedingAmount: summary.feeding.totalAmount || 0,
      sleepDuration: summary.sleep.totalDuration,
      diaperChangeCount,
      wetDiapers,
      dirtyDiapers,
      growth: Object.keys(summary.growth).length > 0 ? summary.growth : undefined,
      monitoringEvents: {
        total: summary.monitoring.total,
        byType: summary.monitoring.byType,
      },
    };
  }

  /**
   * 生成周报
   *
   * 生成一周的护理数据汇总和分析
   * 包括每日摘要和趋势分析
   *
   * @param babyId - 宝宝ID
   * @param weekStart - 周开始日期（周一）
   * @returns 周报数据，包含每日摘要和趋势分析
   */
  async generateWeeklyReport(babyId: string, weekStart: Date): Promise<WeeklyReport> {
    // 计算周日结束日期
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const dailySummaries: DailySummary[] = [];

    // 生成一周内每天的摘要
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      dailySummaries.push(await this.generateDailySummary(babyId, date));
    }

    // 计算趋势数据
    const totalFeedingAmount = dailySummaries.reduce((sum, day) => sum + day.feedingAmount, 0);
    const totalSleepDuration = dailySummaries.reduce((sum, day) => sum + day.sleepDuration, 0);
    // 统计小睡时长（假设单次睡眠小于12小时的计入白天睡眠）
    const totalNapDuration = dailySummaries.reduce((sum, day) => {
      return sum + (day.sleepDuration < 720 ? day.sleepDuration : 0);
    }, 0);

    // 统计有小睡的天数
    const napDays = dailySummaries.filter(day => day.sleepDuration < 720).length;

    // 计算生长趋势（从成长记录表获取）
    const growthRecords = await this.babyGrowthRecordRepository.find({
      where: {
        babyId,
        recordDate: dailySummaries.map(d => d.date) as any,
      } as any,
      order: { recordDate: 'ASC' },
    });

    let growthTrend = undefined;
    if (growthRecords.length >= 2) {
      const firstWeight = growthRecords[0].weight ? Number(growthRecords[0].weight) / 1000 : 0;
      const lastWeight = growthRecords[growthRecords.length - 1].weight ? Number(growthRecords[growthRecords.length - 1].weight) / 1000 : 0;
      const weightChange = lastWeight - firstWeight;

      const firstHeight = growthRecords[0].height ? Number(growthRecords[0].height) : 0;
      const lastHeight = growthRecords[growthRecords.length - 1].height ? Number(growthRecords[growthRecords.length - 1].height) : 0;
      const heightChange = lastHeight - firstHeight;

      growthTrend = {
        weightGain: Math.round(weightChange * 100) / 100, // kg
        heightIncrease: Math.round(heightChange * 10) / 10,   // cm
      };
    }

    // 返回周报数据
    return {
      babyId,
      weekStart,
      weekEnd,
      dailySummaries,
      trends: {
        feeding: {
          avgAmount: Math.round(totalFeedingAmount / 7),
          avgFrequency: Math.round(dailySummaries.reduce((sum, day) => sum + day.feedingCount, 0) / 7),
        },
        sleep: {
          avgDuration: Math.round(totalSleepDuration / 7),
          avgNaps: Math.round(napDays / 7),
        },
        growth: growthTrend,
      },
    };
  }

  /**
   * 计算生长百分位
   *
   * 根据宝宝年龄和最新的体重、身高数据
   * 计算其在同龄儿童中的百分位位置
   * 用于评估宝宝生长发育情况
   *
   * @param babyId - 宝宝ID
   * @returns 体重和身高的百分位及分类（偏低/中下/中等/中上/偏高）
   */
  async calculateGrowthPercentile(babyId: string): Promise<{
    weight: { percentile: number; category: string } | null;
    height: { percentile: number; category: string } | null;
  }> {
    // 获取宝宝基本信息
    const baby = await this.babyService.getBaby(babyId);
    if (!baby) {
      return { weight: null, height: null };
    }

    // 获取最新的成长记录
    const latestRecord = await this.babyGrowthRecordRepository.findOne({
      where: { babyId } as any,
      order: { recordDate: 'DESC' },
    });

    if (!latestRecord) {
      return { weight: null, height: null };
    }

    // 计算月龄
    const ageInMonths = latestRecord.ageInMonths || this.calculateAgeInMonthsFromDate(baby.birthDate, latestRecord.recordDate);

    // 确定性别
    const gender = baby.gender === 'male' ? Gender.MALE : Gender.FEMALE;

    // 构建成长记录用于分析
    const growthRecord = {
      babyId,
      date: latestRecord.recordDate,
      ageMonths: ageInMonths,
      weight: latestRecord.weight ? Number(latestRecord.weight) / 1000 : undefined, // 转换为 kg
      height: latestRecord.height ? Number(latestRecord.height) : undefined, // cm
    };

    // 使用 BabyGrowthAnalyticsService 进行完整分析
    const analysis = await this.babyGrowthAnalyticsService.analyzeGrowth(growthRecord, gender);

    // 提取体重百分位
    let weightResult = null;
    if (analysis.metrics.weight) {
      weightResult = {
        percentile: Math.round(analysis.metrics.weight.percentile),
        category: this.getGrowthCategory(analysis.metrics.weight.percentile),
      };
    }

    // 提取身高百分位
    let heightResult = null;
    if (analysis.metrics.height) {
      heightResult = {
        percentile: Math.round(analysis.metrics.height.percentile),
        category: this.getGrowthCategory(analysis.metrics.height.percentile),
      };
    }

    return { weight: weightResult, height: heightResult };
  }

  /**
   * 获取生长趋势
   *
   * 获取指定月数内的体重或身高变化趋势
   * 用于绘制生长曲线图
   *
   * @param babyId - 宝宝ID
   * @param type - 数据类型（体重或身高）
   * @param months - 统计月数，默认12个月
   * @returns 按日期排序的生长数据点数组
   */
  async getGrowthTrend(babyId: string, type: 'weight' | 'height', months: number = 12): Promise<Array<{
    date: Date;
    value: number;
  }>> {
    // 计算起始日期
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    // 从成长记录表获取数据
    const records = await this.babyGrowthRecordRepository.find({
      where: {
        babyId,
      } as any,
      order: { recordDate: 'ASC' },
    });

    // 过滤指定时间范围内的记录
    const filteredRecords = records.filter(r => r.recordDate >= startDate);

    // 映射为趋势数据点
    return filteredRecords
      .map(record => {
        const value = type === 'weight'
          ? record.weight
            ? Number(record.weight) / 1000 // 转换为 kg
            : undefined
          : record.height
            ? Number(record.height) // cm
            : undefined;

        return value !== undefined
          ? { date: record.recordDate, value }
          : null;
      })
      .filter((point): point is { date: Date; value: number } => point !== null);
  }

  /**
   * 分析喂养模式
   *
   * 分析指定天数内的喂养模式，包括：
   * - 平均喂奶间隔时间
   * - 喂奶高峰时段
   * - 平均每次喂奶量
   * - 平均每日总奶量
   *
   * @param babyId - 宝宝ID
   * @param days - 分析天数，默认7天
   * @returns 喂养模式分析结果
   */
  async analyzeFeedingPattern(babyId: string, days: number = 7): Promise<{
    avgInterval: number;          // 平均间隔(分钟)
    peakFeedingHours: number[];   // 喂奶高峰时段
    avgAmountPerFeeding: number;  // 平均每次喂奶量
    totalDailyAmount: number;     // 每日总奶量
  }> {
    // 计算日期范围
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 查询指定时间范围内的喂养记录
    const result = await this.babyLogService.getLogs({
      babyId,
      eventTypes: [BabyLogEventType.BREAST_FEEDING, BabyLogEventType.BOTTLE_FEEDING],
      startDate,
      endDate,
      page: 1,
      pageSize: 1000,
    });

    const logs = result.items;

    // 计算相邻两次喂奶的间隔时间
    const intervals: number[] = [];
    const hourlyCounts = new Array(24).fill(0); // 记录每个小时的喂奶次数

    for (let i = 1; i < logs.length; i++) {
      const interval = (new Date(logs[i].startTime).getTime() - new Date(logs[i - 1].startTime).getTime()) / 60000;
      intervals.push(interval);
    }

    // 统计每个小时的喂奶次数
    for (const log of logs) {
      const hour = new Date(log.startTime).getHours();
      hourlyCounts[hour]++;
    }

    // 找出喂奶高峰时段（喂奶次数 >= 最大次数的80%）
    const maxHourlyCount = Math.max(...hourlyCounts);
    const peakFeedingHours = hourlyCounts
      .map((count, hour) => ({ hour, count }))
      .filter(item => item.count >= maxHourlyCount * 0.8)
      .map(item => item.hour);

    // 返回分析结果
    return {
      avgInterval: intervals.length > 0 ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0,
      peakFeedingHours,
      avgAmountPerFeeding: logs.length > 0 ? Math.round(
        logs.reduce((sum, log) => sum + (log.metadata?.amount || 0), 0) / logs.length
      ) : 0,
      totalDailyAmount: Math.round(
        logs.reduce((sum, log) => sum + (log.metadata?.amount || 0), 0) / days
      ),
    };
  }

  /**
   * 从日期计算月龄
   *
   * @param birthDate - 出生日期
   * @param recordDate - 记录日期
   * @returns 月龄（月）
   * @private
   */
  private calculateAgeInMonthsFromDate(birthDate: Date, recordDate: Date): number {
    const months = (recordDate.getFullYear() - birthDate.getFullYear()) * 12 +
      (recordDate.getMonth() - birthDate.getMonth());
    return Math.max(0, months);
  }

  /**
   * 获取生长分类
   *
   * 根据百分位数值返回对应的中文分类描述
   * 分类标准：
   * - <3%: 偏低
   * - 3%-15%: 中下
   * - 15%-85%: 中等
   * - 85%-97%: 中上
   * - >97%: 偏高
   *
   * @param percentile - 百分位数值
   * @returns 中文分类描述
   * @private
   */
  private getGrowthCategory(percentile: number): string {
    if (percentile < 3) return '偏低';
    if (percentile < 15) return '中下';
    if (percentile < 85) return '中等';
    if (percentile < 97) return '中上';
    return '偏高';
  }
}
