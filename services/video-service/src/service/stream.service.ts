import { Provide, Inject, Config, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { IStreamProvider, DirectPlaybackInfo } from '../provider/stream-provider.interface';
import { AWSKVSProvider } from '../provider/aws-kvs.provider';
import { TencentIoTVideoProvider } from '../provider/tencent-iot-video.provider';
import { StreamConfig, StreamSession, RecordConfig, StreamProviderType, StreamProtocol, DeviceTripleInfo, CloudStorageEventsResult, CloudStorageRecordingsResult, CloudStorageDetail, VideoAntiLeechUrlInfo, CloudStorageThumbnailResult, CloudStorageThumbnailListResult } from '@baby-monitor/shared-types';
import { RedisService } from '@midwayjs/redis';
import { CacheManager, DeviceProviderResolver } from '@baby-monitor/shared-utils';

@Provide()
export class StreamService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  @Inject()
  awsProvider!: AWSKVSProvider;

  @Inject()
  iotVideoProvider!: TencentIoTVideoProvider;

  @Inject()
  deviceProviderResolver!: DeviceProviderResolver;


  /** 所有已注册的流媒体提供者 */
  private providers: Map<string, IStreamProvider> = new Map();
  /** 当前默认使用的流媒体提供者 */
  private currentProvider!: IStreamProvider;

  /**
   * 初始化流媒体服务
   *
   * 初始化所有支持的流媒体提供者实例
   * 使用 @Init 装饰器确保在依赖注入完成后自动调用
   */
  @Init()
  async initialize(): Promise<void> {
    console.log('[Stream Service] Initializing...');

    // 初始化所有提供者（AWS KVS、腾讯云 IoT Video、WebRTC）
    await this.awsProvider.initialize();
    this.providers.set(StreamProviderType.AWS_KVS, this.awsProvider);

    await this.iotVideoProvider.initialize();
    this.providers.set(StreamProviderType.IOT_VIDEO, this.iotVideoProvider);

    // 设置默认提供者为AWS KVS
    this.currentProvider = this.awsProvider;

    console.log('[Stream Service] Initialized with providers:', Array.from(this.providers.keys()));
  }

  /**
   * 设置当前默认的流媒体提供者
   *
   * @param providerType - 流媒体提供者类型（AWS_KVS/TENCENT/WEBRTC）
   * @throws {Error} 如果指定的提供者不存在
   */
  setProvider(providerType: StreamProviderType): void {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Provider ${providerType} not found`);
    }
    this.currentProvider = provider;
    console.log(`[Stream Service] Provider switched to: ${providerType}`);
  }

  /**
   * 公开方法：根据 deviceId 解析对应的 StreamProviderType
   * 供 controller 调用
   */
  async resolveProviderForDevice(deviceId: string): Promise<string> {
    return this.deviceProviderResolver.resolveStreamProvider(deviceId);
  }

  /**
   * 内部 helper：自动解析 provider，显式传入时直接使用
   */
  private async resolveProvider(deviceId: string, explicit?: StreamProviderType): Promise<StreamProviderType> {
    if (explicit) return explicit;
    return this.deviceProviderResolver.resolveStreamProvider(deviceId) as unknown as StreamProviderType;
  }

  /**
   * 开始推流
   *
   * 为指定设备启动视频推流，支持多种协议和配置
   *
   * @param deviceId - 设备ID
   * @param config - 流配置（协议、编码、分辨率等）
   * @param providerType - 可选的流媒体提供者类型
   * @returns 推流会话信息
   * @throws {Error} 如果指定的提供者不可用
   */
  async startStream(deviceId: string, config: StreamConfig, providerType?: StreamProviderType): Promise<StreamSession> {
    const resolvedType = await this.resolveProvider(deviceId, providerType);
    const provider = this.providers.get(resolvedType);

    if (!provider) {
      throw new Error(`Provider ${resolvedType} not available`);
    }

    // 健康检查：检查选定的提供者是否正常工作
    const healthy = await provider.healthCheck();
    if (!healthy) {
      console.warn(`[Stream Service] Provider ${provider.getType()} unhealthy, trying fallback...`);

      // 尝试故障转移：遍历所有其他提供者，寻找健康的提供者
      for (const [type, p] of this.providers) {
        if (p !== provider && await p.healthCheck()) {
          console.log(`[Stream Service] Fallback to provider: ${type}`);
          return p.startStream(deviceId, config);
        }
      }

      throw new Error('No healthy stream provider available');
    }

    // 调用提供者的startStream方法启动推流
    const session = await provider.startStream(deviceId, config);

    // 缓存会话信息到Redis，方便后续查询
    await this.cacheSession(session);

    return session;
  }

  /**
   * 停止推流
   *
   * 停止指定会话的视频推流
   *
   * @param sessionId - 推流会话ID
   * @throws {Error} 如果会话不存在或提供者不可用
   */
  async stopStream(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const provider = this.providers.get(session.provider);
    if (!provider) {
      throw new Error(`Provider ${session.provider} not found`);
    }

    await provider.stopStream(sessionId);
    await this.clearSession(sessionId);
  }

  /**
   * 获取播放地址
   *
   * 根据指定的协议获取推流会话的播放地址
   *
   * @param sessionId - 推流会话ID
   * @param protocol - 播放协议（hls、flv、rtmp等）
   * @returns 播放URL
   * @throws {Error} 如果会话不存在或提供者不可用
   */
  async getPlaybackUrl(sessionId: string, protocol: string): Promise<string> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const provider = this.providers.get(session.provider);
    if (!provider) {
      throw new Error(`Provider ${session.provider} not found`);
    }

    return provider.getPlaybackUrl(sessionId, protocol);
  }

  /**
   * 开始录制
   *
   * 为指定设备启动视频录制
   *
   * @param deviceId - 设备ID
   * @param config - 录制配置（格式、时长、存储类型等）
   * @param providerType - 可选的流媒体提供者类型
   * @returns 录制任务ID
   * @throws {Error} 如果指定的提供者不可用
   */
  async startRecording(deviceId: string, config: RecordConfig, providerType?: StreamProviderType): Promise<string> {
    const resolvedType = await this.resolveProvider(deviceId, providerType);
    const provider = this.providers.get(resolvedType);

    if (!provider) {
      throw new Error(`Provider ${resolvedType} not available`);
    }

    return provider.startRecording(deviceId, config);
  }

  /**
   * 停止录制
   *
   * 停止指定的录制任务
   *
   * @param recordingId - 录制任务ID
   * @param providerType - 可选的流媒体提供者类型
   * @throws {Error} 如果指定的提供者不可用
   */
  async stopRecording(recordingId: string, providerType?: StreamProviderType): Promise<void> {
    // 优先使用显式指定的 provider，否则使用当前默认
    const provider = providerType ? this.providers.get(providerType) : this.currentProvider;

    if (!provider) {
      throw new Error(`Provider ${providerType} not found`);
    }

    await provider.stopRecording(recordingId);
  }

  /**
   * 获取录制列表
   *
   * 查询指定设备的录制记录，支持时间范围筛选
   *
   * @param deviceId - 设备ID
   * @param startTime - 可选的开始时间
   * @param endTime - 可选的结束时间
   * @param providerType - 可选的流媒体提供者类型
   * @returns 录制记录列表
   * @throws {Error} 如果指定的提供者不可用
   */
  async getRecordings(deviceId: string, startTime?: Date, endTime?: Date, providerType?: StreamProviderType): Promise<any[]> {
    const resolvedType = await this.resolveProvider(deviceId, providerType);
    const provider = this.providers.get(resolvedType);

    if (!provider) {
      throw new Error(`Provider ${resolvedType} not found`);
    }

    return provider.getRecordings(deviceId, startTime, endTime);
  }

  /**
   * 获取设备的所有推流会话
   *
   * @param deviceId - 设备ID
   * @returns 该设备的所有推流会话列表
   */
  async getDeviceStreams(deviceId: string): Promise<StreamSession[]> {
    const keys = await this.cacheManager.keysByPattern(`stream:session:${deviceId}:*`);
    const sessions: StreamSession[] = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        sessions.push(JSON.parse(data));
      }
    }

    return sessions;
  }

  /**
   * 获取所有流媒体提供者的状态
   *
   * @returns 提供者状态列表，包含类型和健康状态
   */
  async getProvidersStatus(): Promise<Array<{ type: string; healthy: boolean }>> {
    const statuses = [];

    for (const [type, provider] of this.providers) {
      const healthy = await provider.healthCheck();
      statuses.push({ type, healthy });
    }

    return statuses;
  }

  /**
   * 直接获取设备播放地址
   *
   * 用于设备已持续推流的场景，直接获取播放地址而无需创建 session
   * 适用于 App 随时接入观看实时画面的场景
   *
   * @param deviceId - 设备ID
   * @param providerType - 可选的流媒体提供者类型，默认使用 aws_kvs
   * @returns 播放地址信息
   * @throws {Error} 如果指定的提供者不可用
   */
  async getDevicePlaybackUrl(
    deviceId: string,
    providerType?: StreamProviderType
  ): Promise<DirectPlaybackInfo> {
    const resolvedType = await this.resolveProvider(deviceId, providerType);
    console.log(`[Stream Service] Getting direct playback URL for device: ${deviceId}, provider: ${resolvedType}`);

    const provider = this.providers.get(resolvedType);

    if (!provider) {
      throw new Error(`Provider ${resolvedType} not available`);
    }

    // 检查提供者是否支持直接获取播放地址
    if (!provider.getDirectPlaybackUrl) {
      // 如果不支持，降级为创建 session 的方式
      console.warn(`[Stream Service] Provider ${resolvedType} does not support getDirectPlaybackUrl, falling back to startStream`);

      const config: StreamConfig = {
        protocol: StreamProtocol.HLS,
        video: {
          codec: 'h264',
          resolution: '720p',
          fps: 30,
          bitrate: 2000000,
        },
      };

      const session = await this.startStream(deviceId, config, resolvedType);

      return {
        hlsUrl: session.hlsUrl || session.streamUrl,
        rtmpUrl: session.rtmpUrl,
        flvUrl: session.flvUrl,
        streamName: session.streamName || '',
        provider: resolvedType,
        deviceId,
        expiresAt: new Date(Date.now() + 3600 * 1000),
        isStreaming: session.status === 'streaming',
      };
    }

    // 直接获取播放地址
    return provider.getDirectPlaybackUrl(deviceId);
  }

  /**
   * 检查设备是否正在推流
   *
   * @param deviceId - 设备ID
   * @param providerType - 可选的流媒体提供者类型
   * @returns 是否正在推流
   */
  async isDeviceStreaming(
    deviceId: string,
    providerType?: StreamProviderType
  ): Promise<boolean> {
    const resolvedType = await this.resolveProvider(deviceId, providerType);
    const provider = this.providers.get(resolvedType);

    if (!provider || !provider.isDeviceStreaming) {
      return false;
    }

    return provider.isDeviceStreaming(deviceId);
  }

  /**
   * 确保设备的流媒体资源已创建
   * 用于设备注册时预先创建 KVS Stream 或 IoT Video 设备
   *
   * @param deviceId - 设备ID
   * @param providerType - 流媒体提供者类型，默认 AWS KVS
   * @returns Stream 信息
   */
  async ensureDeviceStream(
    deviceId: string,
    providerType?: StreamProviderType
  ): Promise<{ streamName: string; created: boolean; provider: string; tripleInfo?: DeviceTripleInfo }> {
    const resolvedType = await this.resolveProvider(deviceId, providerType);
    console.log(`[Stream Service] Ensuring stream for device: ${deviceId}, provider: ${resolvedType}`);

    const provider = this.providers.get(resolvedType);

    if (!provider) {
      throw new Error(`Provider ${resolvedType} not found`);
    }

    // AWS KVS: 创建 KVS Stream
    if (resolvedType === StreamProviderType.AWS_KVS && (provider as any).ensureStreamExists) {
      const result = await (provider as any).ensureStreamExists(deviceId);
      return {
        streamName: result.streamName,
        created: result.created,
        provider: resolvedType,
      };
    }

    // IoT Video: 创建设备并获取三元组
    if (resolvedType === StreamProviderType.IOT_VIDEO) {
      const iotVideoProvider = provider as TencentIoTVideoProvider;
      if (iotVideoProvider.ensureDevice) {
        // 从 deviceId 中提取 deviceName（如果包含 /）
        const deviceName = deviceId.includes('/') ? deviceId.split('/')[1] : deviceId;
        const tripleInfo = await iotVideoProvider.ensureDevice(deviceName);

        return {
          streamName: deviceName,
          created: true,
          provider: resolvedType,
          tripleInfo,
        };
      }
    }

    // 其他提供者暂不支持
    return {
      streamName: '',
      created: false,
      provider: resolvedType,
    };
  }

  /**
   * 缓存会话信息到Redis
   *
   * @param session - 要缓存的会话信息
   * @private
   */
  private async cacheSession(session: StreamSession): Promise<void> {
    const key = `stream:session:${session.deviceId}:${session.id}`;
    await this.redis.setex(key, 86400, JSON.stringify(session)); // 24小时
  }

  /**
   * 从Redis获取会话信息
   *
   * @param sessionId - 会话ID
   * @returns 会话信息，如果不存在则返回null
   * @private
   */
  private async getSession(sessionId: string): Promise<StreamSession | null> {
    const keys = await this.cacheManager.keysByPattern(`stream:session:*:${sessionId}`);
    if (keys.length === 0) {
      return null;
    }

    const data = await this.redis.get(keys[0]);
    return data ? JSON.parse(data) : null;
  }

  /**
   * 从Redis清除会话信息
   *
   * @param sessionId - 会话ID
   * @private
   */
  private async clearSession(sessionId: string): Promise<void> {
    const keys = await this.cacheManager.keysByPattern(`stream:session:*:${sessionId}`);
    if (keys.length > 0) {
      await this.redis.del(keys[0]);
    }
  }


  // ==================== IoT Video 云存储相关方法 ====================

  /**
   * 对原始云存储视频播放 URL 进行防盗链签名
   *
   * @param videoUrl - 原始云存储视频播放 URL
   * @param deviceId - 设备ID（可选，用于日志和返回信息）
   * @returns 防盗链视频URL信息
   */
  async getVideoAntiLeechUrl(
    videoUrl: string,
  ): Promise<VideoAntiLeechUrlInfo> {
    const iotVideoProvider = this.providers.get(StreamProviderType.IOT_VIDEO) as TencentIoTVideoProvider;
    if (!iotVideoProvider) {
      throw new Error('IoT Video provider not available');
    }

    if (!iotVideoProvider.getVideoAntiLeechUrl) {
      throw new Error('IoT Video provider does not support anti-leech URL');
    }

    return iotVideoProvider.getVideoAntiLeechUrl(videoUrl);
  }

  /**
   * 开通设备云存储
   *
   * 调用腾讯云 CreateCloudStorage API 为设备开通云存储套餐
   *
   * @param deviceId - 设备ID
   * @param packageId - 云存储套餐ID（默认 yc1m7d 全时7天存储月套餐）
   * @param override - 是否覆盖已有套餐，默认 true
   * @returns 开通结果
   */
  async createIoTVideoCloudStorage(
    deviceId: string,
    packageId: string = 'yc1m7d',
    override: boolean = true
  ): Promise<{
    success: boolean;
    packageId: string;
    deviceId: string;
    orderId?: string;
    message?: string;
  }> {
    const iotVideoProvider = this.providers.get(StreamProviderType.IOT_VIDEO) as TencentIoTVideoProvider;
    if (!iotVideoProvider) {
      throw new Error('IoT Video provider not available');
    }

    if (!iotVideoProvider.createCloudStorage) {
      throw new Error('IoT Video provider does not support cloud storage management');
    }

    const result = await iotVideoProvider.createCloudStorage(deviceId, packageId, override);

    this.logger.info(
      `[Stream Service] Cloud storage ${result.success ? 'created' : 'failed'} for device: ${deviceId}, package: ${packageId}`
    );

    return result;
  }

  /**
   * 获取设备云存储详情
   *
   * @param deviceId - 设备ID
   * @returns 云存储详情
   */
  async getIoTVideoCloudStorageDetail(deviceId: string): Promise<CloudStorageDetail> {
    const provider = this.providers.get(StreamProviderType.IOT_VIDEO);
    if (!provider?.getCloudStorageDetail) {
      throw new Error('IoT Video provider not available or does not support cloud storage query');
    }

    return provider.getCloudStorageDetail(deviceId);
  }

  /**
   * 获取设备属性数据
   *
   * @param deviceId - 设备ID
   * @returns 设备属性数据 JSON 字符串
   */
  async getStreamVideoDeviceData(deviceId: string): Promise<string> {
    const iotVideoProvider = this.providers.get(StreamProviderType.IOT_VIDEO) as TencentIoTVideoProvider;
    if (!iotVideoProvider) {
      throw new Error('IoT Video provider not available');
    }

    if (!iotVideoProvider.describeDeviceData) {
      throw new Error('IoT Video provider does not support device data query');
    }

    return iotVideoProvider.describeDeviceData(deviceId);
  }

  /**
   * 批量获取设备属性数据
   *
   * @param deviceIds - 设备ID数组
   * @returns 设备ID到属性数据的映射
   */
  async getIoTVideoDevicesData(deviceIds: string[]): Promise<Record<string, any>> {
    const iotVideoProvider = this.providers.get(StreamProviderType.IOT_VIDEO) as TencentIoTVideoProvider;
    if (!iotVideoProvider) {
      throw new Error('IoT Video provider not available');
    }

    if (!iotVideoProvider.describeDeviceData) {
      throw new Error('IoT Video provider does not support device data query');
    }

    const results: Record<string, any> = {};
    const tasks = deviceIds.map(async (deviceId) => {
      try {
        const data = await iotVideoProvider.describeDeviceData(deviceId);
        results[deviceId] = JSON.parse(data);
      } catch (error: any) {
        results[deviceId] = { error: error.message };
      }
    });

    await Promise.all(tasks);
    return results;
  }

  /**
   * 获取云存储套餐列表
   *
   * @returns 套餐列表
   */
  // async getIoTVideoCloudStoragePackages(): Promise<Array<{
  //   packageId: string;
  //   packageName: string;
  //   packageType: string;
  //   duration: number;
  //   price: number;
  //   storageMode: string;
  // }>> {
  //   const iotVideoProvider = this.providers.get(StreamProviderType.IOT_VIDEO) as TencentIoTVideoProvider;
  //   if (!iotVideoProvider) {
  //     throw new Error('IoT Video provider not available');
  //   }

  //   if (!iotVideoProvider.getCloudStoragePackages) {
  //     throw new Error('IoT Video provider does not support package query');
  //   }

  //   return iotVideoProvider.getCloudStoragePackages();
  // }

  /**
   * 获取设备全时云存录像
   *
   * @param deviceId - 设备ID
   * @param date - 查询日期（YYYY-MM-DD），不传则返回所有有数据日期的时间轴
   * @param startTime - 开始时间（Unix 时间戳，秒），可选
   * @param endTime - 结束时间（Unix 时间戳，秒），可选
   * @returns 全时云存录像列表
   */
  async getIoTVideoCloudStorageRecordings(
    deviceId: string,
    date?: string,
    startTime?: number,
    endTime?: number
  ): Promise<{
    dates: string[];
    recordings: Array<{
      date: string;
      timeSlots: Array<{ startTime: number; endTime: number }>;
      videoUrl: string;
    }>;
  }> {
    const iotVideoProvider = this.providers.get(StreamProviderType.IOT_VIDEO) as TencentIoTVideoProvider;
    if (!iotVideoProvider) {
      throw new Error('IoT Video provider not available');
    }

    if (!iotVideoProvider.getCloudStorageRecordings) {
      throw new Error('IoT Video provider does not support cloud storage recordings query');
    }

    return iotVideoProvider.getCloudStorageRecordings(deviceId, date, startTime, endTime);
  }

  /**
   * 获取设备云存事件列表
   *
   * 调用腾讯云 DescribeCloudStorageEvents API 获取设备的云存事件录像列表
   *
   * @param deviceId - 设备ID
   * @param startTime - 开始时间（Unix 时间戳，秒），可选
   * @param endTime - 结束时间（Unix 时间戳，秒），可选
   * @param context - 翻页游标，可选
   * @param size - 每页数量，默认 10
   * @returns 云存事件列表及总数
   */
  async getIoTVideoCloudStorageEvents(
    deviceId: string,
    startTime?: number,
    endTime?: number,
    context?: string,
    size: number = 10
  ): Promise<{
    total: number;
    events: Array<{
      eventId: string;
      eventType: string;
      startTime: number;
      endTime: number;
      thumbnailUrl: string;
      videoUrl: string;
      deviceId: string;
    }>;
  }> {
    const iotVideoProvider = this.providers.get(StreamProviderType.IOT_VIDEO) as TencentIoTVideoProvider;
    if (!iotVideoProvider) {
      throw new Error('IoT Video provider not available');
    }

    if (!iotVideoProvider.getCloudStorageEvents) {
      throw new Error('IoT Video provider does not support cloud storage events query');
    }

    return iotVideoProvider.getCloudStorageEvents(deviceId, startTime, endTime, context, size);
  }

  /**
   * 重置设备云存储
   *
   * 清除设备的云存储数据
   *
   * @param deviceId - 设备ID
   * @returns 重置结果
   */
  async resetIoTVideoCloudStorage(deviceId: string): Promise<{
    success: boolean;
    deviceId: string;
    message?: string;
  }> {
    const iotVideoProvider = this.providers.get(StreamProviderType.IOT_VIDEO) as TencentIoTVideoProvider;
    if (!iotVideoProvider) {
      throw new Error('IoT Video provider not available');
    }

    if (!iotVideoProvider.resetCloudStorage) {
      throw new Error('IoT Video provider does not support cloud storage reset');
    }

    const result = await iotVideoProvider.resetCloudStorage(deviceId);

    this.logger.info(`[Stream Service] Cloud storage reset for device: ${deviceId}`);

    return result;
  }

  /**
   * 获取单个云存储缩略图访问地址
   *
   * @param deviceId - 设备ID
   * @param thumbnail - 缩略图文件名
   * @returns 缩略图访问地址信息
   */
  async getIoTVideoCloudStorageThumbnail(
    deviceId: string,
    thumbnail: string
  ): Promise<CloudStorageThumbnailResult> {
    const iotVideoProvider = this.providers.get(StreamProviderType.IOT_VIDEO) as TencentIoTVideoProvider;
    if (!iotVideoProvider) {
      throw new Error('IoT Video provider not available');
    }

    if (!iotVideoProvider.getCloudStorageThumbnail) {
      throw new Error('IoT Video provider does not support cloud storage thumbnail query');
    }

    return iotVideoProvider.getCloudStorageThumbnail(deviceId, thumbnail);
  }

  /**
   * 批量获取云存储缩略图访问地址
   *
   * @param deviceId - 设备ID
   * @param thumbnails - 缩略图文件名列表
   * @returns 缩略图访问地址列表
   */
  async getIoTVideoCloudStorageThumbnailList(
    deviceId: string,
    thumbnails: string[]
  ): Promise<CloudStorageThumbnailListResult> {
    const iotVideoProvider = this.providers.get(StreamProviderType.IOT_VIDEO) as TencentIoTVideoProvider;
    if (!iotVideoProvider) {
      throw new Error('IoT Video provider not available');
    }

    if (!iotVideoProvider.getCloudStorageThumbnailList) {
      throw new Error('IoT Video provider does not support cloud storage thumbnail list query');
    }

    return iotVideoProvider.getCloudStorageThumbnailList(deviceId, thumbnails);
  }

  /**
   * 获取多个云存储缩略图访问地址（管道符分隔）
   *
   * @param deviceId - 设备ID
   * @param multiThumbnail - 多个缩略图文件名，以 | 分隔
   * @returns 缩略图访问地址列表
   */
  async getIoTVideoCloudStorageMultiThumbnail(
    deviceId: string,
    multiThumbnail: string
  ): Promise<CloudStorageThumbnailListResult> {
    const iotVideoProvider = this.providers.get(StreamProviderType.IOT_VIDEO) as TencentIoTVideoProvider;
    if (!iotVideoProvider) {
      throw new Error('IoT Video provider not available');
    }

    if (!iotVideoProvider.getCloudStorageMultiThumbnail) {
      throw new Error('IoT Video provider does not support cloud storage multi thumbnail query');
    }

    return iotVideoProvider.getCloudStorageMultiThumbnail(deviceId, multiThumbnail);
  }

  // ==================== 统一云存储接口（按 provider 路由） ====================

  /**
   * 获取云存储事件列表
   *
   * @param deviceId - 设备ID
   * @param providerType - 云厂商类型
   * @param startTime - 开始时间（Unix 时间戳，秒）
   * @param endTime - 结束时间（Unix 时间戳，秒）
   * @param context - 翻页游标
   * @param size - 每页数量，默认 10
   */
  async getCloudStorageEvents(
    deviceId: string,
    providerType: StreamProviderType,
    startTime?: number,
    endTime?: number,
    context?: string,
    size: number = 10
  ): Promise<CloudStorageEventsResult> {
    const provider = this.providers.get(providerType);
    if (!provider?.getCloudStorageEvents) {
      throw new Error(`Provider ${providerType} does not support cloud storage events`);
    }
    return provider.getCloudStorageEvents(deviceId, startTime, endTime, context, size);
  }

  /**
   * 获取云存录像列表
   *
   * @param deviceId - 设备ID
   * @param providerType - 云厂商类型
   * @param date - 查询日期（YYYY-MM-DD）
   * @param startTime - 开始时间（Unix 时间戳，秒）
   * @param endTime - 结束时间（Unix 时间戳，秒）
   */
  async getCloudStorageRecordings(
    deviceId: string,
    providerType: StreamProviderType,
    date?: string,
    startTime?: number,
    endTime?: number
  ): Promise<CloudStorageRecordingsResult> {
    const provider = this.providers.get(providerType);
    if (!provider?.getCloudStorageRecordings) {
      throw new Error(`Provider ${providerType} does not support cloud storage recordings`);
    }
    return provider.getCloudStorageRecordings(deviceId, date, startTime, endTime);
  }

  /**
   * 获取云存储详情
   *
   * @param deviceId - 设备ID
   * @param providerType - 云厂商类型
   */
  async getCloudStorageDetail(
    deviceId: string,
    providerType: StreamProviderType
  ): Promise<CloudStorageDetail> {
    const provider = this.providers.get(providerType);
    if (!provider?.getCloudStorageDetail) {
      throw new Error(`Provider ${providerType} does not support cloud storage detail`);
    }
    return provider.getCloudStorageDetail(deviceId);
  }

  /**
   * 重置云存储
   *
   * @param deviceId - 设备ID
   * @param providerType - 云厂商类型
   */
  async resetCloudStorage(
    deviceId: string,
    providerType: StreamProviderType
  ): Promise<{ success: boolean; deviceId: string; message?: string }> {
    const provider = this.providers.get(providerType);
    if (!provider?.resetCloudStorage) {
      throw new Error(`Provider ${providerType} does not support cloud storage reset`);
    }
    const result = await provider.resetCloudStorage(deviceId);
    this.logger.info(`[Stream Service] Cloud storage reset for device: ${deviceId}, provider: ${providerType}`);
    return result;
  }

  /**
   * 开通云存储
   *
   * @param deviceId - 设备ID
   * @param providerType - 云厂商类型
   * @param packageId - 云存储套餐ID
   * @param override - 是否覆盖已有套餐
   */
  async createCloudStorage(
    deviceId: string,
    providerType: StreamProviderType,
    packageId: string = 'yc1m7d',
    override: boolean = true
  ): Promise<{ success: boolean; packageId: string; deviceId: string; orderId?: string; message?: string }> {
    const provider = this.providers.get(providerType);
    if (!provider?.createCloudStorage) {
      throw new Error(`Provider ${providerType} does not support cloud storage creation`);
    }
    const result = await provider.createCloudStorage(deviceId, packageId, override);
    this.logger.info(`[Stream Service] Cloud storage created for device: ${deviceId}, provider: ${providerType}, package: ${packageId}`);
    return result;
  }
}
