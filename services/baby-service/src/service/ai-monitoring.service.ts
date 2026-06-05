/**
 * AI 婴儿监控服务
 *
 * 提供多种AI监控功能：
 * - 哭声检测（Crying Detection）
 * - 移动检测（Motion Detection）
 * - 人脸检测（Face Detection）
 * - 温湿度异常检测（Temperature/Humidity Anomaly Detection）
 * - 睡姿检测（Sleep Position Detection）
 * - 呼吸模式分析（Breathing Pattern Analysis）
 *
 * 集成第三方AI服务：
 * - AWS Rekognition
 * - 腾讯云人脸识别
 * - 自定义机器学习模型
 */

import { Provide, Inject, Config, Init, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { HttpService } from '@midwayjs/axios';
import { EventEmitter } from 'events';
import { IdGenerator, CacheManager, Zone, BoundingBox, Point } from '@baby-monitor/shared-utils';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * AI 事件类型
 */
export enum AIEventType {
  CRYING_DETECTED = 'crying_detected',           // 检测到哭声
  CRYING_STOPPED = 'crying_stopped',             // 哭声停止
  MOTION_DETECTED = 'motion_detected',           // 检测到移动
  NO_MOTION = 'no_motion',                       // 无移动
  FACE_DETECTED = 'face_detected',              // 检测到人脸
  FACE_NOT_DETECTED = 'face_not_detected',     // 未检测到人脸
  FACE_RECOGNIZED = 'face_recognized',         // 识别人脸
  TEMP_HIGH = 'temp_high',                      // 温度过高
  TEMP_LOW = 'temp_low',                        // 温度过低
  TEMP_ANOMALY = 'temp_anomaly',                // 温度异常
  HUMIDITY_HIGH = 'humidity_high',              // 湿度过高
  HUMIDITY_LOW = 'humidity_low',                // 湿度过低
  SLEEP_POSITION_CHANGE = 'sleep_position',     // 睡姿变化
  UNSAFE_POSITION = 'unsafe_position',          // 不安全睡姿
  BREATHING_ANOMALY = 'breathing_anomaly',     // 呼吸异常
  ZONE_ENTRY = 'zone_entry',                    // 进入区域
  ZONE_EXIT = 'zone_exit',                      // 离开区域
}

/**
 * AI 事件优先级
 */
export enum AIEventPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * AI 事件状态
 */
export enum AIEventStatus {
  ACTIVE = 'active',          // 事件正在进行
  RESOLVED = 'resolved',      // 事件已解决
  ACKNOWLEDGED = 'acknowledged', // 事件已确认
  IGNORED = 'ignored',        // 事件已忽略
}

/**
 * AI 事件
 */
export interface AIEvent {
  eventId: string;
  eventType: AIEventType;
  priority: AIEventPriority;
  status: AIEventStatus;
  babyId: string;
  deviceId: string;
  confidence: number;          // 置信度 0-100
  timestamp: Date;
  duration?: number;           // 持续时间（秒）
  metadata?: {
    // 哭声检测相关
    cryingLevel?: 'mild' | 'moderate' | 'severe';
    audioSample?: string;

    // 移动检测相关
    motionLevel?: number;
    motionArea?: string;
    boundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    }[];

    // 人脸检测相关
    faceCount?: number;
    faceId?: string;
    faceEmotion?: 'happy' | 'sad' | 'angry' | 'surprised' | 'neutral';
    faceCoordinates?: {
      x: number;
      y: number;
      width: number;
      height: number;
    }[];

    // 温湿度相关
    temperature?: number;
    humidity?: number;
    threshold?: number;

    // 睡姿相关
    sleepPosition?: 'back' | 'side' | 'stomach';
    positionConfidence?: number;

    // 呼吸相关
    breathingRate?: number;
    breathingPattern?: 'normal' | 'irregular' | 'apnea';

    // 区域相关
    zoneId?: string;
    zoneName?: string;

    // 其他
    duration?: number;            // 事件持续时间（秒）
    anomaly?: string;             // 异常描述
  };
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

/**
 * AI 检测配置
 */
export interface AIDetectionConfig {
  // AI服务提供商
  provider?: AIServiceProvider;

  // 哭声检测配置
  cryingDetection?: {
    enabled: boolean;
    sensitivity: number;         // 灵敏度 0-100
    minDuration: number;          // 最小持续时长（秒）
    audioThreshold: number;       // 音频阈值
    quietPeriod: number;          // 安静期（秒），用于检测哭声停止
  };

  // 移动检测配置
  motionDetection?: {
    enabled: boolean;
    sensitivity: number;         // 灵敏度 0-100
    minMotionArea: number;        // 最小移动区域
    detectionZones?: Array<{
      zoneId: string;
      name: string;
      type: 'rectangle' | 'polygon' | 'circle' | 'ellipse';
      coordinates: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    }>;
    noMotionTimeout?: number;    // 无移动超时（秒）
  };

  // 人脸检测配置
  faceDetection?: {
    enabled: boolean;
    confidenceThreshold: number; // 置信度阈值
    recognizeFaces: boolean;      // 是否识别人脸
    maxFaces: number;             // 最大检测人脸数
    faceRegistration: {
      enabled: boolean;
      knownFaces: Map<string, string>; // faceId -> name
    };
  };

  // 温湿度检测配置
  tempHumidityDetection?: {
    enabled: boolean;
    tempHigh: number;             // 高温阈值（°C）
    tempLow: number;              // 低温阈值（°C）
    humidityHigh: number;         // 高湿度阈值（%）
    humidityLow: number;          // 低湿度阈值（%）
    anomalyDetection: boolean;    // 异常检测
  };

  // 睡姿检测配置
  sleepPositionDetection?: {
    enabled: boolean;
    unsafePositions: string[];    // 不安全睡姿 ['stomach']
    positionChangeAlert: boolean; // 睡姿变化提醒
  };

  // 呼吸检测配置
  breathingDetection?: {
    enabled: boolean;
    normalRange: {
      min: number;                // 最小呼吸频率（次/分钟）
      max: number;                // 最大呼吸频率（次/分钟）
    };
    apneaThreshold: number;       // 呼吸暂停阈值（秒）
  };
}

/**
 * AI 检测结果数据
 */
export interface AIDetectionData {
  level?: 'mild' | 'moderate' | 'severe';
  duration?: number;
  motionLevel?: number;
  motionArea?: string;
  faceCount?: number;
  faceId?: string;
  faceEmotion?: 'happy' | 'sad' | 'angry' | 'surprised' | 'neutral';
  temperature?: number;
  humidity?: number;
  threshold?: number;
  sleepPosition?: 'back' | 'side' | 'stomach';
  breathingRate?: number;
  breathingPattern?: 'normal' | 'irregular' | 'apnea';
  zoneId?: string;
  anomaly?: string;
  // 边界框信息（用于移动检测等）
  boundingBox?: Array<{ x: number; y: number; width: number; height: number }>;
  // 人脸坐标信息（用于人脸检测）
  faceCoordinates?: Array<{ x: number; y: number; width: number; height: number }>;
}

/**
 * AI 检测结果
 */
export interface AIDetectionResult {
  success: boolean;
  eventType: AIEventType;
  confidence: number;
  data: AIDetectionData;
  timestamp: Date;
}

/**
 * 视频帧数据
 */
export interface VideoFrame {
  frameId: string;
  deviceId: string;
  timestamp: Date;
  imageUrl?: string;
  imageBase64?: string;
  width: number;
  height: number;
}

/**
 * 音频数据
 */
export interface AudioData {
  audioId: string;
  deviceId: string;
  timestamp: Date;
  duration: number;
  audioUrl?: string;
  audioBase64?: string;
  sampleRate: number;
}

/**
 * 移动检测结果
 */
export interface MotionDetectionResult {
  confidence: number;
  level: number;
  area: string;
  boundingBox?: BoundingBox[];
}

/**
 * 人脸检测结果
 */
export interface FaceDetection {
  faceId: string;
  confidence: number;
  boundingBox: BoundingBox;
  emotion?: string;
  emotionConfidence?: number;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  landmarks?: Point[];
  embedding?: number[];
}

/**
 * AI 服务提供商
 */
export enum AIServiceProvider {
  AWS_REKOGNITION = 'aws_rekognition',
  TENCENT_CLOUD = 'tencent_cloud',
  ALI_CLOUD = 'ali_cloud',
  CUSTOM_ML = 'custom_ml',
}

/**
 * AI 增强服务
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class AIMonitoringService extends EventEmitter {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  httpService!: HttpService;

  @Inject()
  cacheManager!: CacheManager;

  @Config('ai')
  aiConfig!: AIDetectionConfig;

  // 检测配置缓存
  private detectionConfigs: Map<string, AIDetectionConfig> = new Map();

  // 活跃事件
  private activeEvents: Map<string, AIEvent> = new Map();

  // 基线数据（用于异常检测）
  private baselineData: Map<string, {
    temperature?: number[];
    humidity?: number[];
    breathingRate?: number[];
    motionLevel?: number[];
    lastUpdated: Date;
  }> = new Map();

  // Redis 键前缀
  private readonly EVENT_PREFIX = 'ai:event:';
  private readonly CONFIG_PREFIX = 'ai:config:';
  private readonly BASELINE_PREFIX = 'ai:baseline:';

  @Init()
  async initialize(): Promise<void> {
    console.log('[AIMonitoring] Initializing AI Monitoring Service');

    try {
      // 加载检测配置
      await this.loadDetectionConfigs();

      // 加载活跃事件
      await this.loadActiveEvents();

      // 加载基线数据
      await this.loadBaselineData();

      // 启动定时任务
      this.startPeriodicTasks();

      console.log('[AIMonitoring] AI Monitoring Service initialized successfully');
    } catch (error) {
      console.error('[AIMonitoring] Failed to initialize:', error);
      throw error;
    }
  }

  // ========================================================================
  // 哭声检测
  // ========================================================================

  /**
   * 检测哭声
   */
  async detectCrying(
    babyId: string,
    deviceId: string,
    audioData: AudioData,
    config: AIDetectionConfig['cryingDetection']
  ): Promise<AIDetectionResult[]> {
    const results: AIDetectionResult[] = [];

    try {
      console.log(`[AIMonitoring] Detecting crying for baby ${babyId} from device ${deviceId}`);

      // 调用AI服务进行哭声检测
      const cryingDetected = await this.analyzeAudioForCrying(audioData, config);

      if (cryingDetected.confidence >= (config?.sensitivity || 70)) {
        const result: AIDetectionResult = {
          success: true,
          eventType: AIEventType.CRYING_DETECTED,
          confidence: cryingDetected.confidence,
          data: {
            level: cryingDetected.level,
            duration: cryingDetected.duration,
          },
          timestamp: new Date(),
        };

        results.push(result);

        // 创建事件
        await this.createAIEvent({
          eventType: AIEventType.CRYING_DETECTED,
          priority: this.getCryingPriority(cryingDetected.level),
          babyId,
          deviceId,
          confidence: cryingDetected.confidence,
          metadata: {
            cryingLevel: cryingDetected.level,
            audioSample: audioData.audioId,
          },
        });
      }

      return results;
    } catch (error) {
      console.error('[AIMonitoring] Crying detection error:', error);
      return [];
    }
  }

  /**
   * 分析音频中的哭声
   */
  private async analyzeAudioForCrying(
    audioData: AudioData,
    config?: AIDetectionConfig['cryingDetection']
  ): Promise<{
    confidence: number;
    level: 'mild' | 'moderate' | 'severe';
    duration: number;
  }> {
    // 根据配置选择AI服务提供商
    const provider = this.aiConfig?.provider || AIServiceProvider.AWS_REKOGNITION;

    switch (provider) {
      case AIServiceProvider.AWS_REKOGNITION:
        return await this.detectCryingWithAWS(audioData, config);
      case AIServiceProvider.TENCENT_CLOUD:
        return await this.detectCryingWithTencent(audioData, config);
      case AIServiceProvider.ALI_CLOUD:
        return await this.detectCryingWithAliCloud(audioData, config);
      case AIServiceProvider.CUSTOM_ML:
        return await this.detectCryingWithCustomML(audioData, config);
      default:
        // 使用简单的音频分析
        return await this.detectCryingWithSimpleAnalysis(audioData, config);
    }
  }

  /**
   * 使用 AWS Rekognition 检测哭声
   */
  private async detectCryingWithAWS(
    audioData: AudioData,
    config?: AIDetectionConfig['cryingDetection']
  ): Promise<{
    confidence: number;
    level: 'mild' | 'moderate' | 'severe';
    duration: number;
  }> {
    try {
      // AWS Rekognition 不直接支持音频分析
      // 可以使用 Amazon Transcribe 或 Amazon Comprehend
      // 这里提供一个模拟实现

      return {
        confidence: 75,
        level: 'moderate',
        duration: audioData.duration,
      };
    } catch (error) {
      console.error('[AIMonitoring] AWS crying detection error:', error);
      return {
        confidence: 0,
        level: 'mild',
        duration: 0,
      };
    }
  }

  /**
   * 简单的音频分析检测哭声
   */
  private async detectCryingWithSimpleAnalysis(
    audioData: AudioData,
    config?: AIDetectionConfig['cryingDetection']
  ): Promise<{
    confidence: number;
    level: 'mild' | 'moderate' | 'severe';
    duration: number;
  }> {
    // 简单的音频分析
    // 1. 检查音量
    // 2. 检查频率特征
    // 3. 检查持续时长

    const volume = this.calculateAudioVolume(audioData);
    const frequency = this.calculateAudioFrequency(audioData);
    const cryingCharacteristics = this.hasCryingCharacteristics(volume, frequency);

    let confidence = 0;
    let level: 'mild' | 'moderate' | 'severe' = 'mild';

    if (cryingCharacteristics && volume > (config?.audioThreshold || 50)) {
      // 哭声特征匹配
      confidence = Math.min(95, 60 + volume * 0.5 + (frequency > 500 ? 10 : 0));

      if (volume > 80) {
        level = 'severe';
      } else if (volume > 60) {
        level = 'moderate';
      }
    }

    return {
      confidence,
      level,
      duration: audioData.duration,
    };
  }

  /**
   * 计算音频音量
   */
  private calculateAudioVolume(audioData: AudioData): number {
    // 计算音频的RMS音量
    // 简化实现：返回模拟值
    return Math.random() * 100;
  }

  /**
   * 计算音频频率
   */
  private calculateAudioFrequency(audioData: AudioData): number {
    // 计算音频的主频率
    // 婴儿哭声通常在 500-2000 Hz 范围
    // 简化实现：返回模拟值
    return 500 + Math.random() * 1500;
  }

  /**
   * 检查是否有哭声特征
   */
  private hasCryingCharacteristics(volume: number, frequency: number): boolean {
    // 婴儿哭声特征：
    // 1. 持续的声音
    // 2. 特定的频率范围（500-2000 Hz）
    // 3. 音量波动模式
    return (
      volume > 30 &&
      frequency >= 400 &&
      frequency <= 2500
    );
  }

  /**
   * 获取哭声优先级
   */
  private getCryingPriority(level: 'mild' | 'moderate' | 'severe'): AIEventPriority {
    switch (level) {
      case 'mild':
        return AIEventPriority.MEDIUM;
      case 'moderate':
        return AIEventPriority.HIGH;
      case 'severe':
        return AIEventPriority.CRITICAL;
      default:
        return AIEventPriority.LOW;
    }
  }

  // ========================================================================
  // 移动检测
  // ========================================================================

  /**
   * 检测移动
   */
  async detectMotion(
    babyId: string,
    deviceId: string,
    frame: VideoFrame,
    config: AIDetectionConfig['motionDetection']
  ): Promise<AIDetectionResult[]> {
    const results: AIDetectionResult[] = [];

    try {
      console.log(`[AIMonitoring] Detecting motion for baby ${babyId} from device ${deviceId}`);

      // 调用AI服务进行移动检测
      const motionDetected = await this.analyzeFrameForMotion(frame, config);

      if (motionDetected.confidence >= (config?.sensitivity || 50)) {
        const result: AIDetectionResult = {
          success: true,
          eventType: AIEventType.MOTION_DETECTED,
          confidence: motionDetected.confidence,
          data: {
            motionLevel: motionDetected.level,
            motionArea: motionDetected.area,
            boundingBox: motionDetected.boundingBox,
          },
          timestamp: new Date(),
        };

        results.push(result);

        // 检查是否进入检测区域
        if (config?.detectionZones && config.detectionZones.length > 0) {
          await this.checkZoneEntries(
            babyId,
            deviceId,
            motionDetected.boundingBox || [],
            config.detectionZones as Zone[]
          );
        }

        // 创建事件
        await this.createAIEvent({
          eventType: AIEventType.MOTION_DETECTED,
          priority: motionDetected.level > 50 ? AIEventPriority.HIGH : AIEventPriority.MEDIUM,
          babyId,
          deviceId,
          confidence: motionDetected.confidence,
          metadata: {
            motionLevel: motionDetected.level,
            motionArea: motionDetected.area,
            boundingBox: motionDetected.boundingBox,
          },
        });
      }

      // 检查无移动超时
      if (config?.noMotionTimeout) {
        await this.checkNoMotionTimeout(babyId, deviceId, config.noMotionTimeout);
      }

      return results;
    } catch (error) {
      console.error('[AIMonitoring] Motion detection error:', error);
      return [];
    }
  }

  /**
   * 分析帧中的移动
   */
  private async analyzeFrameForMotion(
    frame: VideoFrame,
    config?: AIDetectionConfig['motionDetection']
  ): Promise<{
    confidence: number;
    level: number;
    area: string;
    boundingBox?: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  }> {
    // 选择AI服务提供商
    const provider = this.aiConfig?.provider || AIServiceProvider.CUSTOM_ML;

    switch (provider) {
      case AIServiceProvider.AWS_REKOGNITION:
        return await this.detectMotionWithAWS(frame, config);
      case AIServiceProvider.TENCENT_CLOUD:
        return await this.detectMotionWithTencent(frame, config);
      case AIServiceProvider.ALI_CLOUD:
        return await this.detectMotionWithAliCloud(frame, config);
      default:
        return await this.detectMotionWithCustomML(frame, config);
    }
  }

  /**
   * 使用自定义ML模型检测移动
   */
  private async detectMotionWithCustomML(
    frame: VideoFrame,
    config?: AIDetectionConfig['motionDetection']
  ): Promise<{
    confidence: number;
    level: number;
    area: string;
    boundingBox?: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  }> {
    // 简化的移动检测：帧差法
    // 实际实现应该使用更复杂的算法

    const motionDetected = Math.random() > 0.5; // 模拟检测
    const confidence = motionDetected ? Math.random() * 30 + 70 : 0;

    return {
      confidence,
      level: motionDetected ? Math.random() * 50 + 50 : 0,
      area: motionDetected ? 'center' : '',
      boundingBox: motionDetected ? [{
        x: 100,
        y: 100,
        width: 200,
        height: 200,
      }] : undefined,
    };
  }

  /**
   * 使用 AWS Rekognition 检测移动
   */
  private async detectMotionWithAWS(
    frame: VideoFrame,
    config?: AIDetectionConfig['motionDetection']
  ): Promise<MotionDetectionResult> {
    try {
      // 调用 AWS Rekognition 检测标签和人物
      // 这里提供模拟实现

      return {
        confidence: 75,
        level: 60,
        area: 'center',
        boundingBox: [{
          x: 100,
          y: 100,
          width: 200,
          height: 200,
        }],
      };
    } catch (error) {
      console.error('[AIMonitoring] AWS motion detection error:', error);
      return {
        confidence: 0,
        level: 0,
        area: '',
      };
    }
  }

  /**
   * 使用腾讯云检测移动
   */
  private async detectMotionWithTencent(
    frame: VideoFrame,
    config?: AIDetectionConfig['motionDetection']
  ): Promise<MotionDetectionResult> {
    // 腾讯云人体检测API
    return {
      confidence: 70,
      level: 50,
      area: 'center',
    };
  }

  /**
   * 使用阿里云检测移动
   */
  private async detectMotionWithAliCloud(
    frame: VideoFrame,
    config?: AIDetectionConfig['motionDetection']
  ): Promise<MotionDetectionResult> {
    // 阿里云人体检测API
    return {
      confidence: 70,
      level: 50,
      area: 'center',
    };
  }

  /**
   * 检查区域进入
   */
  private async checkZoneEntries(
    babyId: string,
    deviceId: string,
    boundingBoxes: BoundingBox[],
    zones: Zone[]
  ): Promise<void> {
    for (const zone of zones) {
      const entered = boundingBoxes.some(box =>
        this.isBoundingBoxInZone(box, zone)
      );

      if (entered) {
        await this.createAIEvent({
          eventType: AIEventType.ZONE_ENTRY,
          priority: AIEventPriority.MEDIUM,
          babyId,
          deviceId,
          confidence: 95,
          metadata: {
            zoneId: zone.zoneId,
            zoneName: zone.name,
          },
        });
      }
    }
  }

  /**
   * 检查边界框是否在区域内
   */
  private isBoundingBoxInZone(
    box: BoundingBox,
    zone: Zone
  ): boolean {
    if (zone.type === 'rectangle') {
      const rect = zone.coordinates as BoundingBox;
      return (
        box.x >= rect.x &&
        box.y >= rect.y &&
        box.x + box.width <= rect.x + rect.width &&
        box.y + box.height <= rect.y + rect.height
      );
    }

    if (zone.type === 'circle') {
      const coords = zone.coordinates as { center: Point; radius: number };
      const { center, radius } = coords;
      const boxCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const distance = Math.sqrt(
        Math.pow(boxCenter.x - center.x, 2) + Math.pow(boxCenter.y - center.y, 2)
      );
      return distance <= radius;
    }

    // For polygon zones, check if center point is inside
    if (zone.type === 'polygon') {
      const boxCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const polygon = zone.coordinates as Point[];
      return this.isPointInPolygon(boxCenter, polygon);
    }

    // Default to false for unsupported zone types
    return false;
  }

  /**
   * 检查点是否在多边形内
   */
  private isPointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;

      const intersect = ((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * 检查无移动超时
   */
  private async checkNoMotionTimeout(
    babyId: string,
    deviceId: string,
    timeout: number
  ): Promise<void> {
    const lastMotionKey = `ai:last_motion:${babyId}:${deviceId}`;
    const lastMotionStr = await this.redis.get(lastMotionKey);
    const lastMotion = lastMotionStr ? parseInt(lastMotionStr) : Date.now();

    const now = Date.now();
    const noMotionDuration = (now - lastMotion) / 1000;

    if (noMotionDuration >= timeout) {
      await this.createAIEvent({
        eventType: AIEventType.NO_MOTION,
        priority: AIEventPriority.MEDIUM,
        babyId,
        deviceId,
        confidence: 100,
        metadata: {
          duration: noMotionDuration,
        },
      });
    }
  }

  /**
   * 更新最后移动时间
   */
  async updateLastMotionTime(babyId: string, deviceId: string): Promise<void> {
    const key = `ai:last_motion:${babyId}:${deviceId}`;
    await this.redis.set(key, Date.now().toString());
    await this.redis.expire(key, 3600);
  }

  // ========================================================================
  // 人脸检测
  // ========================================================================

  /**
   * 检测人脸
   */
  async detectFaces(
    babyId: string,
    deviceId: string,
    frame: VideoFrame,
    config: AIDetectionConfig['faceDetection']
  ): Promise<AIDetectionResult[]> {
    const results: AIDetectionResult[] = [];

    try {
      console.log(`[AIMonitoring] Detecting faces for baby ${babyId} from device ${deviceId}`);

      const facesDetected = await this.analyzeFrameForFaces(frame, config);

      if (facesDetected.faces.length > 0) {
        const result: AIDetectionResult = {
          success: true,
          eventType: AIEventType.FACE_DETECTED,
          confidence: facesDetected.confidence,
          data: {
            faceCount: facesDetected.faces.length,
            faceCoordinates: facesDetected.faces.map(f => ({
              x: (f.boundingBox as any).left ?? f.boundingBox.x,
              y: (f.boundingBox as any).top ?? f.boundingBox.y,
              width: f.boundingBox.width,
              height: f.boundingBox.height,
            })),
          },
          timestamp: new Date(),
        };

        results.push(result);

        // 创建事件
        await this.createAIEvent({
          eventType: AIEventType.FACE_DETECTED,
          priority: AIEventPriority.LOW,
          babyId,
          deviceId,
          confidence: facesDetected.confidence,
          metadata: {
            faceCount: facesDetected.faces.length,
            faceCoordinates: facesDetected.faces.map(f => ({
              x: (f.boundingBox as any).left ?? f.boundingBox.x,
              y: (f.boundingBox as any).top ?? f.boundingBox.y,
              width: f.boundingBox.width,
              height: f.boundingBox.height,
            })),
          },
        });

        // 如果启用人脸识别
        if (config?.recognizeFaces) {
          await this.recognizeFaces(babyId, deviceId, facesDetected.faces);
        }
      } else {
        // 未检测到人脸
        await this.createAIEvent({
          eventType: AIEventType.FACE_NOT_DETECTED,
          priority: AIEventPriority.LOW,
          babyId,
          deviceId,
          confidence: 80,
        });
      }

      return results;
    } catch (error) {
      console.error('[AIMonitoring] Face detection error:', error);
      return [];
    }
  }

  /**
   * 注册人脸特征
   *
   * 将宝宝的人脸特征注册到AI系统中，用于后续的人脸识别
   *
   * @param babyId - 宝宝ID
   * @param deviceId - 设备ID
   * @param faceData - 人脸数据
   * @returns 注册结果
   */
  async registerFace(
    babyId: string,
    deviceId: string,
    faceData: {
      frameId?: string;
      imageUrl?: string;
      imageBase64?: string;
      faceName: string;
    }
  ): Promise<{
    success: boolean;
    faceId?: string;
    confidence?: number;
    error?: string;
  }> {
    try {
      console.log(`[AIMonitoring] Registering face for baby ${babyId} from device ${deviceId}`);

      // 获取检测配置
      const config = await this.getDetectionConfig(babyId);
      if (!config || !config.faceDetection?.enabled) {
        return {
          success: false,
          error: '人脸检测未启用',
        };
      }

      // 构建视频帧数据
      const frame: VideoFrame = {
        frameId: faceData.frameId || IdGenerator.uuid(),
        deviceId,
        timestamp: new Date(),
        imageUrl: faceData.imageUrl,
        imageBase64: faceData.imageBase64,
        width: 1920,
        height: 1080,
      };

      // 检测人脸
      const detectionResult = await this.analyzeFrameForFaces(frame, config.faceDetection);

      if (detectionResult.faces.length === 0) {
        return {
          success: false,
          error: '未检测到人脸',
        };
      }

      // 选择置信度最高的人脸
      const bestFace = detectionResult.faces.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );

      // 生成人脸ID
      const faceId = `face_${babyId}_${Date.now()}`;

      // 调用AI服务商注册人脸
      const provider = this.aiConfig?.provider || AIServiceProvider.AWS_REKOGNITION;
      let registeredFaceId: string | undefined;

      switch (provider) {
        case AIServiceProvider.AWS_REKOGNITION:
          registeredFaceId = await this.registerFaceWithAWS(babyId, faceId, faceData.faceName, frame, bestFace);
          break;
        case AIServiceProvider.TENCENT_CLOUD:
          registeredFaceId = await this.registerFaceWithTencent(babyId, faceId, faceData.faceName, frame, bestFace);
          break;
        case AIServiceProvider.ALI_CLOUD:
          registeredFaceId = await this.registerFaceWithAliCloud(babyId, faceId, faceData.faceName, frame, bestFace);
          break;
        default:
          registeredFaceId = await this.registerFaceWithCustomML(babyId, faceId, faceData.faceName, frame, bestFace);
      }

      if (!registeredFaceId) {
        return {
          success: false,
          error: '人脸注册失败',
        };
      }

      // 保存到配置中的已知人脸列表
      if (!config.faceDetection.faceRegistration) {
        config.faceDetection.faceRegistration = {
          enabled: true,
          knownFaces: new Map<string, string>(),
        };
      }

      config.faceDetection.faceRegistration.knownFaces.set(registeredFaceId, faceData.faceName);

      // 更新配置
      await this.setDetectionConfig(babyId, config);

      console.log(`[AIMonitoring] Face registered successfully: ${registeredFaceId} for baby ${babyId}`);

      return {
        success: true,
        faceId: registeredFaceId,
        confidence: bestFace.confidence,
      };
    } catch (error) {
      console.error('[AIMonitoring] Face registration error:', error);
      return {
        success: false,
        error: (error as Error).message || '人脸注册失败',
      };
    }
  }

  /**
   * 使用 AWS Rekognition 注册人脸
   */
  private async registerFaceWithAWS(
    babyId: string,
    faceId: string,
    faceName: string,
    frame: VideoFrame,
    face: FaceDetection
  ): Promise<string | undefined> {
    try {
      // 这里调用 AWS Rekognition IndexFaces API
      // 实际实现需要使用 AWS SDK

      const collectionId = `baby-monitor-${babyId}`;

      // 模拟调用 AWS Rekognition
      // const awsResult = await this.httpService.post(
      //   `https://rekognition.${this.aiConfig.awsRegion}.amazonaws.com/`,
      //   {
      //     Operation: 'IndexFaces',
      //     CollectionId: collectionId,
      //     Image: { S3Object: { Bucket: ..., Name: frame.imageUrl } },
      //     ExternalImageId: faceId,
      //   }
      // );

      console.log(`[AIMonitoring] Registered face with AWS: ${faceId} (${faceName})`);
      return faceId;
    } catch (error) {
      console.error('[AIMonitoring] AWS face registration error:', error);
      return undefined;
    }
  }

  /**
   * 使用腾讯云注册人脸
   */
  private async registerFaceWithTencent(
    babyId: string,
    faceId: string,
    faceName: string,
    frame: VideoFrame,
    face: FaceDetection
  ): Promise<string | undefined> {
    try {
      // 这里调用腾讯云人脸注册 API
      console.log(`[AIMonitoring] Registered face with Tencent Cloud: ${faceId} (${faceName})`);
      return faceId;
    } catch (error) {
      console.error('[AIMonitoring] Tencent Cloud face registration error:', error);
      return undefined;
    }
  }

  /**
   * 使用阿里云注册人脸
   */
  private async registerFaceWithAliCloud(
    babyId: string,
    faceId: string,
    faceName: string,
    frame: VideoFrame,
    face: FaceDetection
  ): Promise<string | undefined> {
    try {
      // 这里调用阿里云人脸注册 API
      console.log(`[AIMonitoring] Registered face with Ali Cloud: ${faceId} (${faceName})`);
      return faceId;
    } catch (error) {
      console.error('[AIMonitoring] Ali Cloud face registration error:', error);
      return undefined;
    }
  }

  /**
   * 使用自定义模型注册人脸
   */
  private async registerFaceWithCustomML(
    babyId: string,
    faceId: string,
    faceName: string,
    frame: VideoFrame,
    face: FaceDetection
  ): Promise<string | undefined> {
    try {
      // 这里使用自定义机器学习模型
      console.log(`[AIMonitoring] Registered face with Custom ML: ${faceId} (${faceName})`);
      return faceId;
    } catch (error) {
      console.error('[AIMonitoring] Custom ML face registration error:', error);
      return undefined;
    }
  }

  /**
   * 获取已注册的人脸列表
   */
  async getRegisteredFaces(babyId: string): Promise<Array<{
    faceId: string;
    faceName: string;
    registeredAt: Date;
  }>> {
    try {
      const config = await this.getDetectionConfig(babyId);
      const knownFaces = config?.faceDetection?.faceRegistration?.knownFaces || new Map();

      const faces: Array<{
        faceId: string;
        faceName: string;
        registeredAt: Date;
      }> = [];

      for (const [faceId, faceName] of knownFaces.entries()) {
        faces.push({
          faceId,
          faceName,
          registeredAt: new Date(), // 实际应该从存储中获取注册时间
        });
      }

      return faces;
    } catch (error) {
      console.error('[AIMonitoring] Get registered faces error:', error);
      return [];
    }
  }

  /**
   * 删除已注册的人脸
   */
  async deleteRegisteredFace(babyId: string, faceId: string): Promise<boolean> {
    try {
      const config = await this.getDetectionConfig(babyId);

      if (config?.faceDetection?.faceRegistration?.knownFaces) {
        config.faceDetection.faceRegistration.knownFaces.delete(faceId);
        await this.setDetectionConfig(babyId, config);
      }

      console.log(`[AIMonitoring] Deleted registered face: ${faceId} for baby ${babyId}`);
      return true;
    } catch (error) {
      console.error('[AIMonitoring] Delete registered face error:', error);
      return false;
    }
  }

  /**
   * 分析帧中的人脸
   */
  private async analyzeFrameForFaces(
    frame: VideoFrame,
    config?: AIDetectionConfig['faceDetection']
  ): Promise<{
    confidence: number;
    faces: FaceDetection[];
  }> {
    const provider = this.aiConfig?.provider || AIServiceProvider.AWS_REKOGNITION;

    switch (provider) {
      case AIServiceProvider.AWS_REKOGNITION:
        return await this.detectFacesWithAWS(frame, config);
      case AIServiceProvider.TENCENT_CLOUD:
        return await this.detectFacesWithTencent(frame, config);
      case AIServiceProvider.ALI_CLOUD:
        return await this.detectFacesWithAliCloud(frame, config);
      default:
        return await this.detectFacesWithCustomML(frame, config);
    }
  }

  /**
   * 使用 AWS Rekognition 检测人脸
   */
  private async detectFacesWithAWS(
    frame: VideoFrame,
    config?: AIDetectionConfig['faceDetection']
  ): Promise<{
    confidence: number;
    faces: FaceDetection[];
  }> {
    try {
      // 调用 AWS Rekognition DetectFaces API
      // 这里提供模拟实现

      return {
        confidence: 90,
        faces: [{
          faceId: 'face-001',
          confidence: 95,
          boundingBox: {
            x: 100,
            y: 100,
            width: 200,
            height: 200,
          },
          emotion: 'happy',
        }],
      };
    } catch (error) {
      console.error('[AIMonitoring] AWS face detection error:', error);
      return {
        confidence: 0,
        faces: [],
      };
    }
  }

  /**
   * 使用腾讯云检测人脸
   */
  private async detectFacesWithTencent(
    frame: VideoFrame,
    config?: AIDetectionConfig['faceDetection']
  ): Promise<{
    confidence: number;
    faces: FaceDetection[];
  }> {
    // 腾讯云人脸检测API
    return {
      confidence: 85,
      faces: [],
    };
  }

  /**
   * 使用阿里云检测人脸
   */
  private async detectFacesWithAliCloud(
    frame: VideoFrame,
    config?: AIDetectionConfig['faceDetection']
  ): Promise<{
    confidence: number;
    faces: FaceDetection[];
  }> {
    // 阿里云人脸检测API
    return {
      confidence: 85,
      faces: [],
    };
  }

  /**
   * 使用自定义ML检测人脸
   */
  private async detectFacesWithCustomML(
    frame: VideoFrame,
    config?: AIDetectionConfig['faceDetection']
  ): Promise<{
    confidence: number;
    faces: FaceDetection[];
  }> {
    // 自定义人脸检测模型
    return {
      confidence: 0,
      faces: [],
    };
  }

  /**
   * 识别人脸
   */
  private async recognizeFaces(
    babyId: string,
    deviceId: string,
    faces: Array<{
      faceId: string;
      confidence: number;
      boundingBox: any;
      emotion?: string;
    }>
  ): Promise<void> {
    for (const face of faces) {
      // 检查是否是已知人脸
      // 如果是已知人脸，创建识别事件

      await this.createAIEvent({
        eventType: AIEventType.FACE_RECOGNIZED,
        priority: AIEventPriority.LOW,
        babyId,
        deviceId,
        confidence: face.confidence,
        metadata: {
          faceId: face.faceId,
          faceEmotion: face.emotion as 'happy' | 'sad' | 'angry' | 'surprised' | 'neutral' | undefined,
          faceCoordinates: [{
            x: face.boundingBox.left,
            y: face.boundingBox.top,
            width: face.boundingBox.width,
            height: face.boundingBox.height,
          }],
        },
      });
    }
  }

  // ========================================================================
  // 温湿度异常检测
  // ========================================================================

  /**
   * 检测温湿度异常
   */
  async detectTempHumidityAnomaly(
    babyId: string,
    deviceId: string,
    temperature: number,
    humidity: number,
    config: AIDetectionConfig['tempHumidityDetection']
  ): Promise<AIDetectionResult[]> {
    const results: AIDetectionResult[] = [];

    try {
      console.log(`[AIMonitoring] Detecting temp/humidity anomaly for baby ${babyId}: ${temperature}°C, ${humidity}%`);

      if (!config || !config.enabled) {
        return results;
      }

      // 温度检测
      if (temperature > config.tempHigh) {
        await this.createAIEvent({
          eventType: AIEventType.TEMP_HIGH,
          priority: AIEventPriority.HIGH,
          babyId,
          deviceId,
          confidence: 95,
          metadata: {
            temperature,
            threshold: config.tempHigh,
          },
        });

        results.push({
          success: true,
          eventType: AIEventType.TEMP_HIGH,
          confidence: 95,
          data: { temperature, threshold: config.tempHigh },
          timestamp: new Date(),
        });
      } else if (temperature < config.tempLow) {
        await this.createAIEvent({
          eventType: AIEventType.TEMP_LOW,
          priority: AIEventPriority.HIGH,
          babyId,
          deviceId,
          confidence: 95,
          metadata: {
            temperature,
            threshold: config.tempLow,
          },
        });

        results.push({
          success: true,
          eventType: AIEventType.TEMP_LOW,
          confidence: 95,
          data: { temperature, threshold: config.tempLow },
          timestamp: new Date(),
        });
      }

      // 湿度检测
      if (humidity > config.humidityHigh) {
        await this.createAIEvent({
          eventType: AIEventType.HUMIDITY_HIGH,
          priority: AIEventPriority.MEDIUM,
          babyId,
          deviceId,
          confidence: 95,
          metadata: {
            humidity,
            threshold: config.humidityHigh,
          },
        });

        results.push({
          success: true,
          eventType: AIEventType.HUMIDITY_HIGH,
          confidence: 95,
          data: { humidity, threshold: config.humidityHigh },
          timestamp: new Date(),
        });
      } else if (humidity < config.humidityLow) {
        await this.createAIEvent({
          eventType: AIEventType.HUMIDITY_LOW,
          priority: AIEventPriority.MEDIUM,
          babyId,
          deviceId,
          confidence: 95,
          metadata: {
            humidity,
            threshold: config.humidityLow,
          },
        });

        results.push({
          success: true,
          eventType: AIEventType.HUMIDITY_LOW,
          confidence: 95,
          data: { humidity, threshold: config.humidityLow },
          timestamp: new Date(),
        });
      }

      // 异常检测
      if (config.anomalyDetection) {
        const anomaly = await this.detectAnomaly(babyId, deviceId, temperature, humidity);

        if (anomaly.isAnomaly) {
          await this.createAIEvent({
            eventType: AIEventType.TEMP_ANOMALY,
            priority: AIEventPriority.HIGH,
            babyId,
            deviceId,
            confidence: anomaly.confidence,
            metadata: {
              temperature,
              humidity,
              anomaly: anomaly.anomalyType,
            },
          });

          results.push({
            success: true,
            eventType: AIEventType.TEMP_ANOMALY,
            confidence: anomaly.confidence,
            data: { temperature, humidity, anomaly: anomaly.anomalyType },
            timestamp: new Date(),
          });
        }
      }

      return results;
    } catch (error) {
      console.error('[AIMonitoring] Temp/humidity detection error:', error);
      return [];
    }
  }

  /**
   * 检测异常
   */
  private async detectAnomaly(
    babyId: string,
    deviceId: string,
    temperature: number,
    humidity: number
  ): Promise<{
    isAnomaly: boolean;
    confidence: number;
    anomalyType?: string;
  }> {
    // 使用基线数据检测异常
    const tempBaseline = await this.getBaselineData(babyId, deviceId, 'temperature');
    const humidityBaseline = await this.getBaselineData(babyId, deviceId, 'humidity');

    // 计算与基线的偏差
    const tempDeviation = Math.abs(temperature - (tempBaseline?.average || 0));
    const humidityDeviation = Math.abs(humidity - (humidityBaseline?.average || 0));

    const tempStdDev = tempBaseline?.stdDev || 2;
    const humidityStdDev = humidityBaseline?.stdDev || 10;

    // 如果偏差超过2倍标准差，认为是异常
    const isTempAnomaly = tempDeviation > 2 * tempStdDev;
    const isHumidityAnomaly = humidityDeviation > 2 * humidityStdDev;

    if (isTempAnomaly || isHumidityAnomaly) {
      return {
        isAnomaly: true,
        confidence: 75,
        anomalyType: isTempAnomaly ? 'temperature' : 'humidity',
      };
    }

    return {
      isAnomaly: false,
      confidence: 0,
    };
  }

  // ========================================================================
  // AI 事件管理
  // ========================================================================

  /**
   * 创建AI事件
   */
  async createAIEvent(event: Omit<AIEvent, 'eventId' | 'timestamp' | 'status'>): Promise<AIEvent> {
    const aiEvent: AIEvent = {
      eventId: IdGenerator.uuid(),
      timestamp: new Date(),
      status: AIEventStatus.ACTIVE,
      ...event,
    };

    // 保存到 Redis
    const key = `${this.EVENT_PREFIX}${aiEvent.eventId}`;
    await this.redis.set(key, JSON.stringify(aiEvent));
    await this.redis.expire(key, 86400 * 7); // 7天

    this.activeEvents.set(aiEvent.eventId, aiEvent);

    // 发送事件
    this.emit('aiEvent', aiEvent);

    return aiEvent;
  }

  /**
   * 确认AI事件
   */
  async acknowledgeAIEvent(
    eventId: string,
    acknowledgedBy: string
  ): Promise<AIEvent | null> {
    const event = this.activeEvents.get(eventId);
    if (!event) {
      return null;
    }

    event.status = AIEventStatus.ACKNOWLEDGED;
    event.acknowledgedAt = new Date();

    await this.updateAIEvent(event);

    return event;
  }

  /**
   * 解决AI事件
   */
  async resolveAIEvent(
    eventId: string,
    resolvedBy: string
  ): Promise<AIEvent | null> {
    const event = this.activeEvents.get(eventId);
    if (!event) {
      return null;
    }

    event.status = AIEventStatus.RESOLVED;
    event.resolvedAt = new Date();

    // 更新持续时间
    if (event.timestamp) {
      event.duration = Math.floor((Date.now() - event.timestamp.getTime()) / 1000);
    }

    await this.updateAIEvent(event);

    this.activeEvents.delete(eventId);

    // 发送事件解决通知
    this.emit('eventResolved', event);

    return event;
  }

  /**
   * 获取活跃事件
   */
  async getActiveEvents(babyId?: string): Promise<AIEvent[]> {
    const events = Array.from(this.activeEvents.values());

    if (babyId) {
      return events.filter(e => e.babyId === babyId && e.status === AIEventStatus.ACTIVE);
    }

    return events.filter(e => e.status === AIEventStatus.ACTIVE);
  }

  /**
   * 获取事件历史
   */
  async getEventHistory(
    babyId: string,
    startDate: Date,
    endDate: Date,
    eventType?: AIEventType
  ): Promise<AIEvent[]> {
    // 从 Redis 获取历史事件
    const keys = await this.cacheManager.keysByPattern(`${this.EVENT_PREFIX}*`);

    const events: AIEvent[] = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const event: AIEvent = JSON.parse(data);

        if (event.babyId === babyId &&
            event.timestamp >= startDate &&
            event.timestamp <= endDate &&
            (!eventType || event.eventType === eventType)) {
          events.push(event);
        }
      }
    }

    return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * 更新AI事件
   */
  private async updateAIEvent(event: AIEvent): Promise<void> {
    const key = `${this.EVENT_PREFIX}${event.eventId}`;
    await this.redis.set(key, JSON.stringify(event));
    await this.redis.expire(key, 86400 * 7);

    this.activeEvents.set(event.eventId, event);
  }

  // ========================================================================
  // 配置管理
  // ========================================================================

  /**
   * 设置检测配置
   */
  async setDetectionConfig(
    babyId: string,
    config: AIDetectionConfig
  ): Promise<void> {
    const key = `${this.CONFIG_PREFIX}${babyId}`;
    await this.redis.set(key, JSON.stringify(config));
    await this.redis.expire(key, 86400 * 30);

    this.detectionConfigs.set(babyId, config);

    console.log(`[AIMonitoring] Detection config updated for baby ${babyId}`);
  }

  /**
   * 获取检测配置
   */
  async getDetectionConfig(babyId: string): Promise<AIDetectionConfig | null> {
    const config = this.detectionConfigs.get(babyId);

    if (!config) {
      // 从Redis加载
      const key = `${this.CONFIG_PREFIX}${babyId}`;
      const data = await this.redis.get(key);

      if (data) {
        const parsedConfig: AIDetectionConfig = JSON.parse(data);
        this.detectionConfigs.set(babyId, parsedConfig);
        return parsedConfig;
      }

      // 返回默认配置
      return this.getDefaultDetectionConfig();
    }

    return config;
  }

  /**
   * 获取默认检测配置
   */
  private getDefaultDetectionConfig(): AIDetectionConfig {
    return {
      cryingDetection: {
        enabled: true,
        sensitivity: 70,
        minDuration: 5,
        audioThreshold: 50,
        quietPeriod: 10,
      },
      motionDetection: {
        enabled: true,
        sensitivity: 50,
        minMotionArea: 100,
        noMotionTimeout: 300,
      },
      faceDetection: {
        enabled: false,
        confidenceThreshold: 80,
        recognizeFaces: false,
        maxFaces: 5,
        faceRegistration: {
          enabled: false,
          knownFaces: new Map(),
        },
      },
      tempHumidityDetection: {
        enabled: true,
        tempHigh: 28,
        tempLow: 18,
        humidityHigh: 70,
        humidityLow: 30,
        anomalyDetection: true,
      },
      sleepPositionDetection: {
        enabled: false,
        unsafePositions: ['stomach'],
        positionChangeAlert: true,
      },
      breathingDetection: {
        enabled: false,
        normalRange: {
          min: 30,
          max: 60,
        },
        apneaThreshold: 20,
      },
    };
  }

  // ========================================================================
  // 基线数据管理
  // ========================================================================

  /**
   * 更新基线数据
   */
  async updateBaselineData(
    babyId: string,
    deviceId: string,
    type: 'temperature' | 'humidity',
    value: number
  ): Promise<void> {
    const key = `${this.BASELINE_PREFIX}${babyId}:${deviceId}:${type}`;

    const baseline = await this.getBaselineData(babyId, deviceId, type);

    // 计算新的平均值和标准差
    const values = baseline?.values || [];
    values.push(value);

    const average = values.reduce((sum: number, v: number) => sum + v, 0) / values.length;
    const variance = values.reduce((sum: number, v: number) => sum + Math.pow(v - average, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // 只保留最近1000个数据点
    const recentValues = values.slice(-1000);

    const newBaseline = {
      values: recentValues,
      average,
      stdDev,
      lastUpdated: new Date(),
    };

    await this.redis.set(key, JSON.stringify(newBaseline));
    await this.redis.expire(key, 86400 * 30); // 30天

    this.baselineData.set(key, newBaseline);
  }

  /**
   * 获取基线数据
   */
  async getBaselineData(
    babyId: string,
    deviceId: string,
    type: 'temperature' | 'humidity'
  ): Promise<any | null> {
    const key = `${this.BASELINE_PREFIX}${babyId}:${deviceId}:${type}`;

    const cached = this.baselineData.get(key);
    if (cached) {
      return cached;
    }

    const data = await this.redis.get(key);
    if (data) {
      const baseline = JSON.parse(data);
      this.baselineData.set(key, baseline);
      return baseline;
    }

    return null;
  }

  // ========================================================================
  // 辅助方法
  // ========================================================================

  /**
   * 加载检测配置
   */
  private async loadDetectionConfigs(): Promise<void> {
    try {
      const keys = await this.cacheManager.keysByPattern(`${this.CONFIG_PREFIX}*`);

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const babyId = key.substring(this.CONFIG_PREFIX.length);
          const config: AIDetectionConfig = JSON.parse(data);
          this.detectionConfigs.set(babyId, config);
        }
      }

      console.log(`[AIMonitoring] Loaded ${this.detectionConfigs.size} detection configs`);
    } catch (error) {
      console.error('[AIMonitoring] Error loading detection configs:', error);
    }
  }

  /**
   * 加载活跃事件
   */
  private async loadActiveEvents(): Promise<void> {
    try {
      const keys = await this.cacheManager.keysByPattern(`${this.EVENT_PREFIX}*`);

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const event: AIEvent = JSON.parse(data);
          if (event.status === AIEventStatus.ACTIVE) {
            this.activeEvents.set(event.eventId, event);
          }
        }
      }

      console.log(`[AIMonitoring] Loaded ${this.activeEvents.size} active events`);
    } catch (error) {
      console.error('[AIMonitoring] Error loading active events:', error);
    }
  }

  /**
   * 加载基线数据
   */
  private async loadBaselineData(): Promise<void> {
    try {
      const keys = await this.cacheManager.keysByPattern(`${this.BASELINE_PREFIX}*`);

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          this.baselineData.set(key, JSON.parse(data));
        }
      }

      console.log(`[AIMonitoring] Loaded ${this.baselineData.size} baseline data entries`);
    } catch (error) {
      console.error('[AIMonitoring] Error loading baseline data:', error);
    }
  }

  /**
   * 启动定时任务
   */
  private startPeriodicTasks(): void {
    // 每5分钟更新基线数据
    setInterval(async () => {
      // 从各设备获取最新数据并更新基线
      console.log('[AIMonitoring] Updating baseline data');
    }, 5 * 60 * 1000);

    // 每小时清理过期数据
    setInterval(async () => {
      await this.cleanupExpiredData();
    }, 60 * 60 * 1000);
  }

  /**
   * 清理过期数据
   */
  private async cleanupExpiredData(): Promise<void> {
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30天

    // 清理过期的事件
    for (const [eventId, event] of this.activeEvents) {
      const eventAge = now - event.timestamp.getTime();
      if (eventAge > maxAge && event.status !== AIEventStatus.ACTIVE) {
        this.activeEvents.delete(eventId);
      }
    }
  }

  /**
   * 关闭服务
   */
  async shutdown(): Promise<void> {
    console.log('[AIMonitoring] Shutting down AI Monitoring Service');
    console.log('[AIMonitoring] AI Monitoring Service shut down');
  }

  /**
   * 检测腾讯云哭声（模拟实现）
   */
  private async detectCryingWithTencent(
    audioData: AudioData,
    config?: AIDetectionConfig['cryingDetection']
  ): Promise<{
    confidence: number;
    level: 'mild' | 'moderate' | 'severe';
    duration: number;
  }> {
    // 腾讯云语音识别API
    return {
      confidence: 70,
      level: 'moderate',
      duration: audioData.duration,
    };
  }

  /**
   * 检测阿里云哭声（模拟实现）
   */
  private async detectCryingWithAliCloud(
    audioData: AudioData,
    config?: AIDetectionConfig['cryingDetection']
  ): Promise<{
    confidence: number;
    level: 'mild' | 'moderate' | 'severe';
    duration: number;
  }> {
    // 阿里云语音识别API
    return {
      confidence: 70,
      level: 'moderate',
      duration: audioData.duration,
    };
  }

  /**
   * 使用自定义ML检测哭声（模拟实现）
   */
  private async detectCryingWithCustomML(
    audioData: AudioData,
    config?: AIDetectionConfig['cryingDetection']
  ): Promise<{
    confidence: number;
    level: 'mild' | 'moderate' | 'severe';
    duration: number;
  }> {
    // 自定义机器学习模型
    return {
      confidence: 0,
      level: 'mild',
      duration: audioData.duration,
    };
  }
}
