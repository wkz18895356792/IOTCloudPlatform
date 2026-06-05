import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';

/**
 * 性别
 */
export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
}

/**
 * 年龄单位
 */
export enum AgeUnit {
  DAYS = 'days',
  MONTHS = 'months',
  YEARS = 'years',
}

/**
 | 指标类型
 */
export enum MetricType {
  WEIGHT = 'weight',        // 体重
  HEIGHT = 'height',        // 身高/身长
  HEAD_CIRCUMFERENCE = 'head_circumference', // 头围
  BMI = 'bmi',              // BMI
}

/**
 | 生长百分位数据
 */
export interface GrowthPercentile {
  age: number;
  ageUnit: AgeUnit;
  p3: number;   // 第3百分位
  p15: number;  // 第15百分位
  p50: number;  // 第50百分位（中位数）
  p85: number;  // 第85百分位
  p97: number;  // 第97百分位
}

/**
 | 生长记录
 */
export interface GrowthRecord {
  babyId: string;
  date: Date;
  ageMonths: number;
  weight?: number;      // kg
  height?: number;      // cm
  headCircumference?: number; // cm
  BMI?: number;
}

/**
 | 生长分析结果
 */
export interface GrowthAnalysis {
  babyId: string;
  gender: Gender;
  ageMonths: number;
  metrics: {
    weight?: WeightAnalysis;
    height?: HeightAnalysis;
    headCircumference?: HeadCircumferenceAnalysis;
    BMI?: BMIAnalysis;
  };
  overallStatus: 'normal' | 'underweight' | 'overweight' | 'stunted' | 'wasted';
  recommendations: string[];
  lastUpdated: Date;
}

/**
 | 体重分析
 */
export interface WeightAnalysis {
  currentWeight: number;
  percentile: number;
  zScore: number;
  status: 'severely_underweight' | 'underweight' | 'normal' | 'overweight' | 'obese';
  forAge: GrowthPercentile;
  trend: 'gaining' | 'stable' | 'losing';
  growthRate: number; // kg/month
}

/**
 | 身高分析
 */
export interface HeightAnalysis {
  currentHeight: number;
  percentile: number;
  zScore: number;
  status: 'severely_stunted' | 'stunted' | 'normal' | 'tall';
  forAge: GrowthPercentile;
  trend: 'growing' | 'stable' | 'slowing';
  growthRate: number; // cm/month
}

/**
 | 头围分析
 */
export interface HeadCircumferenceAnalysis {
  currentHeadCircumference: number;
  percentile: number;
  zScore: number;
  status: 'microcephaly' | 'below_normal' | 'normal' | 'above_normal' | 'macrocephaly';
  forAge: GrowthPercentile;
}

/**
 | BMI分析
 */
export interface BMIAnalysis {
  currentBMI: number;
  percentile: number;
  zScore: number;
  status: 'wasted' | 'underweight' | 'normal' | 'overweight' | 'obese';
  forAge: GrowthPercentile;
}

/**
 | WHO 生长标准数据
 */
export interface WHOGrowthStandard {
  gender: Gender;
  metric: MetricType;
  data: GrowthPercentile[];
}

/**
 | WHO儿童生长标准服务
 *
 | 基于世界卫生组织（WHO）儿童生长标准进行生长发育评估
 | 支持0-5岁儿童的体重、身高、头围、BMI等指标分析
 */
@Provide()
export class BabyGrowthAnalyticsService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  private readonly WHO_STANDARD_PREFIX = 'who:standard:';

  // WHO 男孩体重标准 (kg) - 0-60个月
  private readonly boyWeightStandards: GrowthPercentile[] = [
    { age: 0, ageUnit: AgeUnit.MONTHS, p3: 2.5, p15: 2.9, p50: 3.3, p85: 3.9, p97: 4.4 },
    { age: 1, ageUnit: AgeUnit.MONTHS, p3: 3.4, p15: 3.9, p50: 4.5, p85: 5.1, p97: 5.7 },
    { age: 2, ageUnit: AgeUnit.MONTHS, p3: 4.3, p15: 4.9, p50: 5.6, p85: 6.3, p97: 7.0 },
    { age: 3, ageUnit: AgeUnit.MONTHS, p3: 5.0, p15: 5.7, p50: 6.4, p85: 7.2, p97: 8.0 },
    { age: 4, ageUnit: AgeUnit.MONTHS, p3: 5.6, p15: 6.2, p50: 7.0, p85: 7.8, p97: 8.7 },
    { age: 5, ageUnit: AgeUnit.MONTHS, p3: 6.0, p15: 6.7, p50: 7.5, p85: 8.4, p97: 9.3 },
    { age: 6, ageUnit: AgeUnit.MONTHS, p3: 6.4, p15: 7.1, p50: 7.9, p85: 8.8, p97: 9.8 },
    { age: 7, ageUnit: AgeUnit.MONTHS, p3: 6.7, p15: 7.5, p50: 8.3, p85: 9.2, p97: 10.3 },
    { age: 8, ageUnit: AgeUnit.MONTHS, p3: 7.0, p15: 7.8, p50: 8.6, p85: 9.6, p97: 10.7 },
    { age: 9, ageUnit: AgeUnit.MONTHS, p3: 7.2, p15: 8.0, p50: 8.9, p85: 9.9, p97: 11.0 },
    { age: 10, ageUnit: AgeUnit.MONTHS, p3: 7.4, p15: 8.3, p50: 9.2, p85: 10.2, p97: 11.4 },
    { age: 11, ageUnit: AgeUnit.MONTHS, p3: 7.6, p15: 8.5, p50: 9.4, p85: 10.5, p97: 11.7 },
    { age: 12, ageUnit: AgeUnit.MONTHS, p3: 7.7, p15: 8.6, p50: 9.6, p85: 10.8, p97: 12.0 },
    { age: 18, ageUnit: AgeUnit.MONTHS, p3: 8.4, p15: 9.4, p50: 10.5, p85: 11.8, p97: 13.2 },
    { age: 24, ageUnit: AgeUnit.MONTHS, p3: 8.9, p15: 10.0, p50: 11.3, p85: 12.7, p97: 14.3 },
    { age: 36, ageUnit: AgeUnit.MONTHS, p3: 9.8, p15: 11.0, p50: 12.7, p85: 14.4, p97: 16.3 },
    { age: 48, ageUnit: AgeUnit.MONTHS, p3: 10.5, p15: 11.9, p50: 13.9, p85: 16.0, p97: 18.3 },
    { age: 60, ageUnit: AgeUnit.MONTHS, p3: 11.2, p15: 12.8, p50: 15.0, p85: 17.5, p97: 20.2 },
  ];

  // WHO 女孩体重标准 (kg) - 0-60个月
  private readonly girlWeightStandards: GrowthPercentile[] = [
    { age: 0, ageUnit: AgeUnit.MONTHS, p3: 2.4, p15: 2.8, p50: 3.2, p85: 3.7, p97: 4.2 },
    { age: 1, ageUnit: AgeUnit.MONTHS, p3: 3.2, p15: 3.6, p50: 4.2, p85: 4.8, p97: 5.4 },
    { age: 2, ageUnit: AgeUnit.MONTHS, p3: 3.9, p15: 4.5, p50: 5.1, p85: 5.8, p97: 6.5 },
    { age: 3, ageUnit: AgeUnit.MONTHS, p3: 4.5, p15: 5.0, p50: 5.8, p85: 6.6, p97: 7.3 },
    { age: 4, ageUnit: AgeUnit.MONTHS, p3: 5.0, p15: 5.5, p50: 6.4, p85: 7.3, p97: 8.0 },
    { age: 5, ageUnit: AgeUnit.MONTHS, p3: 5.3, p15: 5.9, p50: 6.8, p85: 7.7, p97: 8.6 },
    { age: 6, ageUnit: AgeUnit.MONTHS, p3: 5.6, p15: 6.2, p50: 7.2, p85: 8.2, p97: 9.1 },
    { age: 7, ageUnit: AgeUnit.MONTHS, p3: 5.8, p15: 6.5, p50: 7.5, p85: 8.6, p97: 9.6 },
    { age: 8, ageUnit: AgeUnit.MONTHS, p3: 6.0, p15: 6.7, p50: 7.8, p85: 8.9, p97: 10.0 },
    { age: 9, ageUnit: AgeUnit.MONTHS, p3: 6.2, p15: 6.9, p50: 8.0, p85: 9.2, p97: 10.4 },
    { age: 10, ageUnit: AgeUnit.MONTHS, p3: 6.4, p15: 7.1, p50: 8.2, p85: 9.5, p97: 10.7 },
    { age: 11, ageUnit: AgeUnit.MONTHS, p3: 6.5, p15: 7.3, p50: 8.4, p85: 9.7, p97: 11.0 },
    { age: 12, ageUnit: AgeUnit.MONTHS, p3: 6.7, p15: 7.5, p50: 8.5, p85: 9.9, p97: 11.3 },
    { age: 18, ageUnit: AgeUnit.MONTHS, p3: 7.2, p15: 8.1, p50: 9.3, p85: 10.9, p97: 12.4 },
    { age: 24, ageUnit: AgeUnit.MONTHS, p3: 7.7, p15: 8.7, p50: 10.1, p85: 11.9, p97: 13.7 },
    { age: 36, ageUnit: AgeUnit.MONTHS, p3: 8.5, p15: 9.6, p50: 11.3, p85: 13.5, p97: 15.7 },
    { age: 48, ageUnit: AgeUnit.MONTHS, p3: 9.1, p15: 10.4, p50: 12.3, p85: 14.9, p97: 17.6 },
    { age: 60, ageUnit: AgeUnit.MONTHS, p3: 9.8, p15: 11.2, p50: 13.4, p85: 16.3, p97: 19.5 },
  ];

  // WHO 男孩身高标准 (cm) - 0-60个月
  private readonly boyHeightStandards: GrowthPercentile[] = [
    { age: 0, ageUnit: AgeUnit.MONTHS, p3: 45.7, p15: 47.5, p50: 49.9, p85: 52.2, p97: 54.0 },
    { age: 1, ageUnit: AgeUnit.MONTHS, p3: 50.1, p15: 52.1, p50: 54.7, p85: 57.3, p97: 59.3 },
    { age: 2, ageUnit: AgeUnit.MONTHS, p3: 53.6, p15: 55.7, p50: 58.4, p85: 61.2, p97: 63.3 },
    { age: 3, ageUnit: AgeUnit.MONTHS, p3: 56.4, p15: 58.6, p50: 61.4, p85: 64.4, p97: 66.6 },
    { age: 4, ageUnit: AgeUnit.MONTHS, p3: 58.7, p15: 61.0, p50: 63.9, p85: 67.0, p97: 69.3 },
    { age: 5, ageUnit: AgeUnit.MONTHS, p3: 60.6, p15: 62.9, p50: 65.9, p85: 69.1, p97: 71.5 },
    { age: 6, ageUnit: AgeUnit.MONTHS, p3: 62.1, p15: 64.6, p50: 67.6, p85: 70.9, p97: 73.4 },
    { age: 7, ageUnit: AgeUnit.MONTHS, p3: 63.5, p15: 66.0, p50: 69.2, p85: 72.6, p97: 75.2 },
    { age: 8, ageUnit: AgeUnit.MONTHS, p3: 64.7, p15: 67.3, p50: 70.6, p85: 74.1, p97: 76.8 },
    { age: 9, ageUnit: AgeUnit.MONTHS, p3: 65.8, p15: 68.5, p50: 71.9, p85: 75.5, p97: 78.3 },
    { age: 10, ageUnit: AgeUnit.MONTHS, p3: 66.8, p15: 69.6, p50: 73.1, p85: 76.8, p97: 79.7 },
    { age: 11, ageUnit: AgeUnit.MONTHS, p3: 67.7, p15: 70.6, p50: 74.2, p85: 78.0, p97: 81.0 },
    { age: 12, ageUnit: AgeUnit.MONTHS, p3: 68.6, p15: 71.5, p50: 75.2, p85: 79.1, p97: 82.2 },
    { age: 18, ageUnit: AgeUnit.MONTHS, p3: 72.5, p15: 75.7, p50: 79.8, p85: 84.2, p97: 87.7 },
    { age: 24, ageUnit: AgeUnit.MONTHS, p3: 75.7, p15: 79.2, p50: 83.7, p85: 88.5, p97: 92.3 },
    { age: 36, ageUnit: AgeUnit.MONTHS, p3: 80.8, p15: 84.7, p50: 89.8, p85: 95.2, p97: 99.5 },
    { age: 48, ageUnit: AgeUnit.MONTHS, p3: 85.0, p15: 89.3, p50: 94.9, p85: 100.9, p97: 105.7 },
    { age: 60, ageUnit: AgeUnit.MONTHS, p3: 88.6, p15: 93.3, p50: 99.4, p85: 105.9, p97: 111.2 },
  ];

  // WHO 女孩身高标准 (cm) - 0-60个月
  private readonly girlHeightStandards: GrowthPercentile[] = [
    { age: 0, ageUnit: AgeUnit.MONTHS, p3: 44.8, p15: 46.6, p50: 49.1, p85: 51.5, p97: 53.3 },
    { age: 1, ageUnit: AgeUnit.MONTHS, p3: 49.1, p15: 51.1, p50: 53.7, p85: 56.4, p97: 58.4 },
    { age: 2, ageUnit: AgeUnit.MONTHS, p3: 52.4, p15: 54.5, p50: 57.4, p85: 60.2, p97: 62.3 },
    { age: 3, ageUnit: AgeUnit.MONTHS, p3: 55.0, p15: 57.3, p50: 60.2, p85: 63.2, p97: 65.4 },
    { age: 4, ageUnit: AgeUnit.MONTHS, p3: 57.1, p15: 59.5, p50: 62.6, p85: 65.8, p97: 68.1 },
    { age: 5, ageUnit: AgeUnit.MONTHS, p3: 58.9, p15: 61.4, p50: 64.5, p85: 67.9, p97: 70.3 },
    { age: 6, ageUnit: AgeUnit.MONTHS, p3: 60.3, p15: 62.9, p50: 66.2, p85: 69.7, p97: 72.2 },
    { age: 7, ageUnit: AgeUnit.MONTHS, p3: 61.6, p15: 64.3, p50: 67.7, p85: 71.3, p97: 73.9 },
    { age: 8, ageUnit: AgeUnit.MONTHS, p3: 62.8, p15: 65.5, p50: 69.0, p85: 72.8, p97: 75.5 },
    { age: 9, ageUnit: AgeUnit.MONTHS, p3: 63.8, p15: 66.6, p50: 70.2, p85: 74.1, p97: 76.9 },
    { age: 10, ageUnit: AgeUnit.MONTHS, p3: 64.7, p15: 67.6, p50: 71.3, p85: 75.3, p97: 78.2 },
    { age: 11, ageUnit: AgeUnit.MONTHS, p3: 65.5, p15: 68.5, p50: 72.3, p85: 76.4, p97: 79.4 },
    { age: 12, ageUnit: AgeUnit.MONTHS, p3: 66.2, p15: 69.3, p50: 73.2, p85: 77.4, p97: 80.5 },
    { age: 18, ageUnit: AgeUnit.MONTHS, p3: 70.2, p15: 73.7, p50: 78.0, p85: 82.7, p97: 86.2 },
    { age: 24, ageUnit: AgeUnit.MONTHS, p3: 73.4, p15: 77.2, p50: 81.9, p85: 87.0, p97: 90.9 },
    { age: 36, ageUnit: AgeUnit.MONTHS, p3: 78.5, p15: 82.8, p50: 88.1, p85: 93.9, p97: 98.4 },
    { age: 48, ageUnit: AgeUnit.MONTHS, p3: 82.7, p15: 87.5, p50: 93.3, p85: 99.7, p97: 104.8 },
    { age: 60, ageUnit: AgeUnit.MONTHS, p3: 86.4, p15: 91.6, p50: 97.9, p85: 105.0, p97: 110.7 },
  ];

  // WHO 男孩头围标准 (cm) - 0-60个月
  private readonly boyHeadCircumferenceStandards: GrowthPercentile[] = [
    { age: 0, ageUnit: AgeUnit.MONTHS, p3: 32.1, p15: 33.4, p50: 34.9, p85: 36.4, p97: 37.6 },
    { age: 1, ageUnit: AgeUnit.MONTHS, p3: 35.1, p15: 36.3, p50: 37.8, p85: 39.3, p97: 40.5 },
    { age: 2, ageUnit: AgeUnit.MONTHS, p3: 36.9, p15: 38.2, p50: 39.7, p85: 41.2, p97: 42.5 },
    { age: 3, ageUnit: AgeUnit.MONTHS, p3: 38.1, p15: 39.5, p50: 41.0, p85: 42.5, p97: 43.8 },
    { age: 4, ageUnit: AgeUnit.MONTHS, p3: 39.0, p15: 40.4, p50: 41.9, p85: 43.5, p97: 44.8 },
    { age: 5, ageUnit: AgeUnit.MONTHS, p3: 39.7, p15: 41.1, p50: 42.7, p85: 44.3, p97: 45.6 },
    { age: 6, ageUnit: AgeUnit.MONTHS, p3: 40.3, p15: 41.7, p50: 43.3, p85: 44.9, p97: 46.3 },
    { age: 7, ageUnit: AgeUnit.MONTHS, p3: 40.7, p15: 42.2, p50: 43.8, p85: 45.4, p97: 46.8 },
    { age: 8, ageUnit: AgeUnit.MONTHS, p3: 41.1, p15: 42.6, p50: 44.2, p85: 45.9, p97: 47.3 },
    { age: 9, ageUnit: AgeUnit.MONTHS, p3: 41.4, p15: 42.9, p50: 44.6, p85: 46.3, p97: 47.7 },
    { age: 10, ageUnit: AgeUnit.MONTHS, p3: 41.7, p15: 43.2, p50: 44.9, p85: 46.6, p97: 48.1 },
    { age: 11, ageUnit: AgeUnit.MONTHS, p3: 41.9, p15: 43.5, p50: 45.2, p85: 46.9, p97: 48.4 },
    { age: 12, ageUnit: AgeUnit.MONTHS, p3: 42.1, p15: 43.7, p50: 45.4, p85: 47.2, p97: 48.7 },
    { age: 18, ageUnit: AgeUnit.MONTHS, p3: 43.3, p15: 44.9, p50: 46.7, p85: 48.5, p97: 50.1 },
    { age: 24, ageUnit: AgeUnit.MONTHS, p3: 44.1, p15: 45.8, p50: 47.6, p85: 49.5, p97: 51.2 },
    { age: 36, ageUnit: AgeUnit.MONTHS, p3: 45.2, p15: 46.9, p50: 48.8, p85: 50.8, p97: 52.6 },
    { age: 48, ageUnit: AgeUnit.MONTHS, p3: 46.0, p15: 47.8, p50: 49.7, p85: 51.8, p97: 53.7 },
    { age: 60, ageUnit: AgeUnit.MONTHS, p3: 46.7, p15: 48.5, p50: 50.5, p85: 52.7, p97: 54.7 },
  ];

  // WHO 女孩头围标准 (cm) - 0-60个月
  private readonly girlHeadCircumferenceStandards: GrowthPercentile[] = [
    { age: 0, ageUnit: AgeUnit.MONTHS, p3: 31.5, p15: 32.8, p50: 34.2, p85: 35.7, p97: 36.9 },
    { age: 1, ageUnit: AgeUnit.MONTHS, p3: 34.3, p15: 35.6, p50: 37.0, p85: 38.5, p97: 39.7 },
    { age: 2, ageUnit: AgeUnit.MONTHS, p3: 36.0, p15: 37.3, p50: 38.7, p85: 40.3, p97: 41.5 },
    { age: 3, ageUnit: AgeUnit.MONTHS, p3: 37.1, p15: 38.5, p50: 39.9, p85: 41.5, p97: 42.8 },
    { age: 4, ageUnit: AgeUnit.MONTHS, p3: 37.9, p15: 39.3, p50: 40.8, p85: 42.4, p97: 43.7 },
    { age: 5, ageUnit: AgeUnit.MONTHS, p3: 38.5, p15: 40.0, p50: 41.5, p85: 43.2, p97: 44.5 },
    { age: 6, ageUnit: AgeUnit.MONTHS, p3: 39.0, p15: 40.5, p50: 42.0, p85: 43.7, p97: 45.1 },
    { age: 7, ageUnit: AgeUnit.MONTHS, p3: 39.4, p15: 40.9, p50: 42.5, p85: 44.2, p97: 45.6 },
    { age: 8, ageUnit: AgeUnit.MONTHS, p3: 39.7, p15: 41.3, p50: 42.9, p85: 44.6, p97: 46.0 },
    { age: 9, ageUnit: AgeUnit.MONTHS, p3: 40.0, p15: 41.5, p50: 43.2, p85: 44.9, p97: 46.4 },
    { age: 10, ageUnit: AgeUnit.MONTHS, p3: 40.2, p15: 41.8, p50: 43.4, p85: 45.2, p97: 46.7 },
    { age: 11, ageUnit: AgeUnit.MONTHS, p3: 40.4, p15: 42.0, p50: 43.7, p85: 45.5, p97: 47.0 },
    { age: 12, ageUnit: AgeUnit.MONTHS, p3: 40.6, p15: 42.2, p50: 43.9, p85: 45.7, p97: 47.2 },
    { age: 18, ageUnit: AgeUnit.MONTHS, p3: 41.6, p15: 43.3, p50: 45.1, p85: 47.0, p97: 48.6 },
    { age: 24, ageUnit: AgeUnit.MONTHS, p3: 42.3, p15: 44.1, p50: 45.9, p85: 47.9, p97: 49.5 },
    { age: 36, ageUnit: AgeUnit.MONTHS, p3: 43.3, p15: 45.2, p50: 47.1, p85: 49.2, p97: 50.9 },
    { age: 48, ageUnit: AgeUnit.MONTHS, p3: 44.1, p15: 46.0, p50: 48.0, p85: 50.2, p97: 52.0 },
    { age: 60, ageUnit: AgeUnit.MONTHS, p3: 44.7, p15: 46.7, p50: 48.7, p85: 51.0, p97: 52.9 },
  ];

  /**
   * 分析宝宝生长发育
   */
  async analyzeGrowth(record: GrowthRecord, gender: Gender): Promise<GrowthAnalysis> {
    const analysis: GrowthAnalysis = {
      babyId: record.babyId,
      gender,
      ageMonths: record.ageMonths,
      metrics: {},
      overallStatus: 'normal',
      recommendations: [],
      lastUpdated: new Date(),
    };

    // 分析体重
    if (record.weight !== undefined) {
      analysis.metrics.weight = await this.analyzeWeight(
        record.weight,
        record.ageMonths,
        gender
      );
    }

    // 分析身高
    if (record.height !== undefined) {
      analysis.metrics.height = await this.analyzeHeight(
        record.height,
        record.ageMonths,
        gender
      );
    }

    // 分析头围
    if (record.headCircumference !== undefined) {
      analysis.metrics.headCircumference = await this.analyzeHeadCircumference(
        record.headCircumference,
        record.ageMonths,
        gender
      );
    }

    // 计算并分析 BMI
    if (record.weight && record.height) {
      const bmi = record.weight / Math.pow(record.height / 100, 2);
      record.BMI = bmi;
      analysis.metrics.BMI = await this.analyzeBMI(
        bmi,
        record.ageMonths,
        gender
      );
    }

    // 综合评估
    analysis.overallStatus = this.assessOverallStatus(analysis);

    // 生成建议
    analysis.recommendations = this.generateRecommendations(analysis);

    // 缓存分析结果
    await this.cacheAnalysis(analysis);

    return analysis;
  }

  /**
   * 分析体重
   */
  private async analyzeWeight(
    weight: number,
    ageMonths: number,
    gender: Gender
  ): Promise<WeightAnalysis> {
    const standards = gender === Gender.MALE
      ? this.boyWeightStandards
      : this.girlWeightStandards;

    const forAge = this.interpolateStandard(standards, ageMonths);

    const percentile = this.calculatePercentile(weight, forAge);
    const zScore = this.calculateZScore(weight, forAge);

    let status: WeightAnalysis['status'];
    if (zScore < -3) {
      status = 'severely_underweight';
    } else if (zScore < -2) {
      status = 'underweight';
    } else if (zScore > 2) {
      status = 'overweight';
    } else if (zScore > 3) {
      status = 'obese';
    } else {
      status = 'normal';
    }

    return {
      currentWeight: weight,
      percentile,
      zScore,
      status,
      forAge,
      trend: 'stable', // 需要历史数据才能计算趋势
      growthRate: 0,
    };
  }

  /**
   * 分析身高
   */
  private async analyzeHeight(
    height: number,
    ageMonths: number,
    gender: Gender
  ): Promise<HeightAnalysis> {
    const standards = gender === Gender.MALE
      ? this.boyHeightStandards
      : this.girlHeightStandards;

    const forAge = this.interpolateStandard(standards, ageMonths);

    const percentile = this.calculatePercentile(height, forAge);
    const zScore = this.calculateZScore(height, forAge);

    let status: HeightAnalysis['status'];
    if (zScore < -3) {
      status = 'severely_stunted';
    } else if (zScore < -2) {
      status = 'stunted';
    } else if (zScore > 2) {
      status = 'tall';
    } else {
      status = 'normal';
    }

    return {
      currentHeight: height,
      percentile,
      zScore,
      status,
      forAge,
      trend: 'stable',
      growthRate: 0,
    };
  }

  /**
   * 分析头围
   */
  private async analyzeHeadCircumference(
    headCircumference: number,
    ageMonths: number,
    gender: Gender
  ): Promise<HeadCircumferenceAnalysis> {
    const standards = gender === Gender.MALE
      ? this.boyHeadCircumferenceStandards
      : this.girlHeadCircumferenceStandards;

    const forAge = this.interpolateStandard(standards, ageMonths);

    const percentile = this.calculatePercentile(headCircumference, forAge);
    const zScore = this.calculateZScore(headCircumference, forAge);

    let status: HeadCircumferenceAnalysis['status'];
    if (zScore < -3) {
      status = 'microcephaly';
    } else if (zScore < -2) {
      status = 'below_normal';
    } else if (zScore > 2) {
      status = 'above_normal';
    } else if (zScore > 3) {
      status = 'macrocephaly';
    } else {
      status = 'normal';
    }

    return {
      currentHeadCircumference: headCircumference,
      percentile,
      zScore,
      status,
      forAge,
    };
  }

  /**
   * 分析 BMI
   */
  private async analyzeBMI(
    bmi: number,
    ageMonths: number,
    gender: Gender
  ): Promise<BMIAnalysis> {
    // BMI 标准基于体重和身高数据计算
    const weightStandards = gender === Gender.MALE
      ? this.boyWeightStandards
      : this.girlWeightStandards;

    const heightStandards = gender === Gender.MALE
      ? this.boyHeightStandards
      : this.girlHeightStandards;

    const weightForAge = this.interpolateStandard(weightStandards, ageMonths);
    const heightForAge = this.interpolateStandard(heightStandards, ageMonths);

    // 计算参考 BMI（中位数体重/中位数身高的平方）
    const referenceBMI = (weightForAge.p50 / 1000) / Math.pow(heightForAge.p50 / 100, 2);

    // 简化的 BMI 百分位估算
    let percentile = 50;
    if (bmi < referenceBMI * 0.85) percentile = 15;
    else if (bmi < referenceBMI * 0.7) percentile = 3;
    else if (bmi > referenceBMI * 1.15) percentile = 85;
    else if (bmi > referenceBMI * 1.3) percentile = 97;

    const zScore = (bmi - referenceBMI) / (referenceBMI * 0.1);

    let status: BMIAnalysis['status'];
    if (zScore < -2) {
      status = 'wasted';
    } else if (zScore < -1) {
      status = 'underweight';
    } else if (zScore > 1) {
      status = 'overweight';
    } else if (zScore > 2) {
      status = 'obese';
    } else {
      status = 'normal';
    }

    return {
      currentBMI: bmi,
      percentile,
      zScore,
      status,
      forAge: {
        age: ageMonths,
        ageUnit: AgeUnit.MONTHS,
        p3: referenceBMI * 0.85,
        p15: referenceBMI * 0.92,
        p50: referenceBMI,
        p85: referenceBMI * 1.08,
        p97: referenceBMI * 1.15,
      },
    };
  }

  /**
   * 评估整体状态
   */
  private assessOverallStatus(analysis: GrowthAnalysis): GrowthAnalysis['overallStatus'] {
    const { weight, height, BMI } = analysis.metrics;

    // 基于 WHO 标准（儿童营养不良分类）
    if (height?.status === 'severely_stunted' || height?.status === 'stunted') {
      return 'stunted';
    }

    if (weight?.status === 'severely_underweight' || weight?.status === 'underweight') {
      return 'underweight';
    }

    if (BMI?.status === 'wasted' || BMI?.status === 'underweight') {
      return 'wasted';
    }

    if (weight?.status === 'obese' || BMI?.status === 'obese') {
      return 'overweight';
    }

    return 'normal';
  }

  /**
   * 生成建议
   */
  private generateRecommendations(analysis: GrowthAnalysis): string[] {
    const recommendations: string[] = [];
    const ageMonths = analysis.ageMonths;

    // 基于年龄的基本建议
    if (ageMonths < 6) {
      recommendations.push('建议纯母乳喂养至6个月');
      recommendations.push('每月测量体重和身长');
    } else if (ageMonths < 12) {
      recommendations.push('继续母乳喂养，并添加辅食');
      recommendations.push('确保每日摄入足够的蛋白质和热量');
    } else if (ageMonths < 24) {
      recommendations.push('提供多样化食物，确保营养均衡');
      recommendations.push('定期体检，监测生长发育');
    } else {
      recommendations.push('保持均衡饮食，培养良好饮食习惯');
      recommendations.push('每天至少1小时户外活动');
    }

    // 基于分析结果的特定建议
    const { weight, height, headCircumference, BMI } = analysis.metrics;

    if (weight?.status === 'underweight' || weight?.status === 'severely_underweight') {
      recommendations.push('⚠️ 体重偏低，建议咨询儿科医生或营养师');
      recommendations.push('增加热量和蛋白质摄入');
    }

    if (weight?.status === 'overweight' || weight?.status === 'obese') {
      recommendations.push('⚠️ 体重超标，建议控制饮食热量');
      recommendations.push('增加身体活动量');
    }

    if (height?.status === 'stunted' || height?.status === 'severely_stunted') {
      recommendations.push('⚠️ 身高偏低，建议咨询医生排除疾病因素');
      recommendations.push('确保充足的睡眠和营养');
    }

    if (headCircumference?.status === 'microcephaly' || headCircumference?.status === 'below_normal') {
      recommendations.push('⚠️ 头围偏小，建议咨询儿科医生进行发育评估');
    }

    if (headCircumference?.status === 'macrocephaly' || headCircumference?.status === 'above_normal') {
      recommendations.push('⚠️ 头围偏大，建议咨询医生排除脑积水等问题');
    }

    if (BMI?.status === 'wasted') {
      recommendations.push('⚠️ 急性营养不良迹象，请立即就医');
    }

    return recommendations;
  }

  /**
   * 插值计算标准值
   */
  private interpolateStandard(
    standards: GrowthPercentile[],
    ageMonths: number
  ): GrowthPercentile {
    // 找到最接近的两个标准点
    let lower = standards[0];
    let upper = standards[standards.length - 1];

    for (let i = 0; i < standards.length - 1; i++) {
      if (standards[i].age <= ageMonths && standards[i + 1].age >= ageMonths) {
        lower = standards[i];
        upper = standards[i + 1];
        break;
      }
    }

    // 线性插值
    const ratio = (ageMonths - lower.age) / (upper.age - lower.age);

    return {
      age: ageMonths,
      ageUnit: AgeUnit.MONTHS,
      p3: lower.p3 + (upper.p3 - lower.p3) * ratio,
      p15: lower.p15 + (upper.p15 - lower.p15) * ratio,
      p50: lower.p50 + (upper.p50 - lower.p50) * ratio,
      p85: lower.p85 + (upper.p85 - lower.p85) * ratio,
      p97: lower.p97 + (upper.p97 - lower.p97) * ratio,
    };
  }

  /**
   * 计算百分位
   */
  private calculatePercentile(
    value: number,
    standard: GrowthPercentile
  ): number {
    const { p3, p15, p50, p85, p97 } = standard;

    if (value < p3) return 1;
    if (value < p15) return 3 + ((value - p3) / (p15 - p3)) * 12;
    if (value < p50) return 15 + ((value - p15) / (p50 - p15)) * 35;
    if (value < p85) return 50 + ((value - p50) / (p85 - p50)) * 35;
    if (value < p97) return 85 + ((value - p85) / (p97 - p85)) * 12;
    return 99;
  }

  /**
   * 计算 Z 分数
   */
  private calculateZScore(value: number, standard: GrowthPercentile): number {
    // 简化计算：假设数据呈正态分布
    const median = standard.p50;
    const sdApprox = (standard.p97 - standard.p3) / 4; // 近似标准差
    return (value - median) / sdApprox;
  }

  /**
   * 缓存分析结果
   */
  private async cacheAnalysis(analysis: GrowthAnalysis): Promise<void> {
    const key = `growth:analysis:${analysis.babyId}`;
    await this.redis.set(key, JSON.stringify(analysis), 'EX', 86400 * 7); // 7天
  }

  /**
   * 获取 WHO 标准数据
   */
  async getWHOStandards(
    gender: Gender,
    metric: MetricType,
    ageRange?: { min: number; max: number }
  ): Promise<GrowthPercentile[]> {
    let standards: GrowthPercentile[];

    switch (metric) {
      case MetricType.WEIGHT:
        standards = gender === Gender.MALE
          ? this.boyWeightStandards
          : this.girlWeightStandards;
        break;
      case MetricType.HEIGHT:
        standards = gender === Gender.MALE
          ? this.boyHeightStandards
          : this.girlHeightStandards;
        break;
      case MetricType.HEAD_CIRCUMFERENCE:
        standards = gender === Gender.MALE
          ? this.boyHeadCircumferenceStandards
          : this.girlHeadCircumferenceStandards;
        break;
      default:
        throw new Error(`Unsupported metric: ${metric}`);
    }

    if (ageRange) {
      return standards.filter(s => s.age >= ageRange.min && s.age <= ageRange.max);
    }

    return standards;
  }

  /**
   * 获取生长曲线数据（用于图表展示）
   */
  async getGrowthChartData(
    gender: Gender,
    metric: MetricType,
    ageMonths: number
  ): Promise<{
    current: number;
    curve: Array<{ age: number; p3: number; p15: number; p50: number; p85: number; p97: number; }>;
  }> {
    const standards = await this.getWHOStandards(gender, metric);
    const curve = standards.map(s => ({
      age: s.age,
      p3: s.p3,
      p15: s.p15,
      p50: s.p50,
      p85: s.p85,
      p97: s.p97,
    }));

    return {
      current: ageMonths,
      curve,
    };
  }
}
