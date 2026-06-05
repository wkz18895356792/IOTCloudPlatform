import { Provide, Inject, Config } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import * as tencentcloud from 'tencentcloud-sdk-nodejs-iotvideo';
import * as tencentiotexplorer from 'tencentcloud-sdk-nodejs-iotexplorer';
import { IStreamProvider, DirectPlaybackInfo } from './stream-provider.interface';
import {
  StreamConfig,
  StreamSession,
  RecordConfig,
  StreamProviderType,
  DeviceTripleInfo,
  CloudStorageDetail,
  CloudStorageEventsResult,
  CloudStorageRecordingsResult,
  CloudStorageThumbnailResult,
  CloudStorageThumbnailListResult,
  VideoAntiLeechUrlInfo,
} from '@baby-monitor/shared-types';
import { IdGenerator } from '@baby-monitor/shared-utils';

// 腾讯云 IoT Video 消费版 API 客户端（云存储、设备管理）
// const BizClient = tencentcloud.iotvideo.v20211125.Client;
const ExplorerClient = tencentiotexplorer.iotexplorer.v20190423.Client;

// 腾讯云 SDK 配置类型
type ClientConfig = {
  credential: {
    secretId: string;
    secretKey: string;
  };
  region: string;
  profile?: {
    httpProfile: {
      endpoint: string;
    };
  };
};

/**
 * 腾讯云物联网智能视频服务提供者（消费版）
 *
 * 提供基于腾讯云 IoT Video 消费版的流媒体服务，支持：
 * - 云存储视频回放
 * - 设备状态监控
 * - 云存储管理
 *
 * 消费版与行业版的区别：
 * - 消费版面向消费级 IoT 设备（如婴儿监视器、智能摄像头）
 * - 使用云存储进行视频录制和回放
 * - 实时视频通过 P2P 或设备直连方式，不经过服务器中转
 * - 使用 DescribeCloudStorageTime API 获取云存储播放地址
 *
 * 实现了 IStreamProvider 接口
 */
@Provide()
export class TencentIoTVideoProvider implements IStreamProvider {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Config('tencent')
  tencentConfig!: any;

  /** 腾讯云 IoT Video 业务客户端（云存储、设备管理） */
  private client!: typeof ExplorerClient.prototype;

  /** 腾讯云 物联网开发平台客户端 */
  // private iotExplorerClient!: typeof ExplorerClient.prototype;

  /** 本地会话缓存 */
  private sessions: Map<string, StreamSession> = new Map();

  /** 本地录制缓存 */
  private recordings: Map<string, any> = new Map();

  /** IoT Video 配置 */
  private iotVideoConfig: {
    productId: string;
    devicePrefix: string;
    expireTime: number;
  } = {
    productId: '',
    devicePrefix: '',
    expireTime: 3600, // 默认 1 小时
  };

  /**
   * 初始化腾讯云 IoT Video 客户端
   */
  async initialize(): Promise<void> {
    // 安全地获取配置
    const tencentConfig = this.tencentConfig || {};
    console.log(`[IoT Video Consumer] Initializing with config:`, tencentConfig);
    const secretId = tencentConfig.secretId;
    const secretKey = tencentConfig.secretKey;
    const region = tencentConfig.region || 'ap-guangzhou';

    // 获取 IoT Video 特定配置
    const iotVideoConfig = tencentConfig.iotVideo || {};
    this.iotVideoConfig = {
      productId: iotVideoConfig.productId || '',
      devicePrefix: iotVideoConfig.devicePrefix || '',
      expireTime: iotVideoConfig.expireTime || 3600,
    };

    if (!secretId || !secretKey) {
      console.warn('[IoT Video Consumer] Missing credentials, skipping initialization');
      return;
    }

    if (!this.iotVideoConfig.productId) {
      console.warn('[IoT Video Consumer] Missing productId, some features may not work');
    }

    const clientConfig: ClientConfig = {
      credential: {
        secretId,
        secretKey,
      },
      region,
      profile: {
        httpProfile: {
          endpoint: 'iotexplorer.tencentcloudapi.com',
        },
      },
    };

    this.client = new ExplorerClient(clientConfig);
    // this.iotExplorerClient = new ExplorerClient

    console.log(`[IoT Video Consumer] Provider initialized for region: ${region}`);
    console.log(`[IoT Video Consumer] Product ID: ${this.iotVideoConfig.productId}`);
  }

  getType(): string {
    return StreamProviderType.IOT_VIDEO;
  }

  /**
   * 解析设备 ID 为 ProductId 和 DeviceName
   * IoT Video 消费版设备标识格式: productId/deviceName
   */
  private parseDeviceId(deviceId: string): { productId: string; deviceName: string } {
    // 如果设备 ID 已经是 productId/deviceName 格式
    if (deviceId.includes('/')) {
      const parts = deviceId.split('/');
      return {
        productId: parts[0],
        deviceName: parts[1],
      };
    }

    // 否则使用配置的 productId 和前缀
    const deviceName = this.iotVideoConfig.devicePrefix
      ? `${this.iotVideoConfig.devicePrefix}_${deviceId}`
      : deviceId;

    return {
      productId: this.iotVideoConfig.productId,
      deviceName,
    };
  }

  /**
   * 开始推流
   *
   * 消费版的实时视频通过 P2P 或设备直连方式
   * 此方法返回云存储的最新视频播放地址（如果有的话）
   *
   * 注意：消费版不支持服务器管理的实时流 URL
   * 实时视频需要通过设备直连或 P2P 方式实现
   */
  async startStream(deviceId: string, config: StreamConfig): Promise<StreamSession> {
    console.log(`[IoT Video Consumer] Starting stream for device: ${deviceId}`);
    console.log(`[IoT Video Consumer] Note: Consumer version uses P2P for live streaming`);

    const { productId, deviceName } = this.parseDeviceId(deviceId);
    const now = new Date();

    try {
      // 获取今天的日期
      const today = now.toISOString().split('T')[0]; // YYYY-MM-DD

      // 调用 DescribeCloudStorageTime 获取云存储视频
      // 这会返回最新的云存储视频播放地址
      const result = await this.client.DescribeCloudStorageTime({
        ProductId: productId,
        DeviceName: deviceName,
        Date: today,
        StartTime: Math.floor((now.getTime() - 3600000) / 1000), // 1 小时前
        EndTime: Math.floor(now.getTime() / 1000),
      });

      console.log(`[IoT Video Consumer] Got cloud storage data for device: ${deviceId}`);

      // 从 API 响应中提取播放地址
      const videoUrl = result.Data?.VideoURL || '';
      const timeList = result.Data?.TimeList || [];

      const session: StreamSession = {
        id: IdGenerator.uuid(),
        deviceId,
        provider: StreamProviderType.IOT_VIDEO,
        config,
        status: videoUrl ? 'streaming' : 'stopped',
        streamName: `${productId}/${deviceName}`,
        streamUrl: videoUrl,
        hlsUrl: videoUrl,
        rtmpUrl: '',
        flvUrl: '',
        webrtcUrl: '',
        createdAt: now,
        updatedAt: now,
      };

      // 缓存会话
      this.sessions.set(session.id, session);
      await this.cacheSession(session);

      console.log(`[IoT Video Consumer] Stream session created: ${session.id}`);
      if (!videoUrl) {
        console.log(`[IoT Video Consumer] No cloud storage video available for device`);
      }

      return session;
    } catch (error: any) {
      console.error(`[IoT Video Consumer] Failed to start stream: ${error.message}`);

      // 处理特定错误
      if (error.code === 'InvalidParameterValue.DeviceNotOnline') {
        throw new Error(`Device ${deviceId} is offline`);
      } else if (error.code === 'ResourceNotFound.DeviceNotExist') {
        throw new Error(`Device ${deviceId} not registered in IoT Video platform`);
      } else if (error.code === 'ResourceNotFound.CloudStorageNotEnabled') {
        throw new Error(`Cloud storage not enabled for device ${deviceId}`);
      }

      throw error;
    }
  }

  /**
   * 停止推流
   *
   * 消费版没有显式的停止推流 API
   */
  async stopStream(sessionId: string): Promise<void> {
    console.log(`[IoT Video Consumer] Stopping stream: ${sessionId}`);

    const session = this.sessions.get(sessionId);
    if (!session) {
      // 尝试从 Redis 恢复
      const cached = await this.redis.get(`stream:session:${sessionId}`);
      if (cached) {
        const restoredSession = JSON.parse(cached) as StreamSession;
        this.sessions.set(sessionId, restoredSession);
      } else {
        throw new Error(`Session ${sessionId} not found`);
      }
    }

    // 更新会话状态
    const sessionToUpdate = this.sessions.get(sessionId);
    if (sessionToUpdate) {
      sessionToUpdate.status = 'stopped';
      sessionToUpdate.stoppedAt = new Date();
      sessionToUpdate.updatedAt = new Date();
    }

    // 清除缓存
    await this.redis.del(`stream:session:${sessionId}`);

    console.log(`[IoT Video Consumer] Stream stopped: ${sessionId}`);
  }

  /**
   * 获取播放地址
   *
   * 如果 URL 过期，会重新调用 API 刷新
   */
  async getPlaybackUrl(sessionId: string, protocol: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      // 尝试从缓存恢复
      const cached = await this.redis.get(`stream:session:${sessionId}`);
      if (cached) {
        const restoredSession = JSON.parse(cached) as StreamSession;
        this.sessions.set(sessionId, restoredSession);
        return this.getProtocolUrl(restoredSession, protocol);
      }
      throw new Error(`Session ${sessionId} not found`);
    }

    // 检查 URL 是否过期
    const urlAge = Date.now() - new Date(session.createdAt).getTime();
    const maxAge = this.iotVideoConfig.expireTime * 1000 || 3600000;

    if (urlAge > maxAge) {
      console.log(`[IoT Video Consumer] URL expired for session ${sessionId}, refreshing...`);
      const refreshedSession = await this.refreshStreamUrls(session);
      return this.getProtocolUrl(refreshedSession, protocol);
    }

    return this.getProtocolUrl(session, protocol);
  }

  /**
   * 根据协议获取播放地址
   */
  private getProtocolUrl(session: StreamSession, protocol: string): string {
    switch (protocol.toLowerCase()) {
      case 'hls':
        return session.hlsUrl || session.streamUrl;
      case 'rtmp':
        return session.rtmpUrl || '';
      case 'flv':
        return session.flvUrl || '';
      case 'webrtc':
        return session.webrtcUrl || '';
      default:
        return session.streamUrl;
    }
  }

  /**
   * 刷新流 URL
   */
  private async refreshStreamUrls(session: StreamSession): Promise<StreamSession> {
    const { productId, deviceName } = this.parseDeviceId(session.deviceId);
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    try {
      const result = await this.client.DescribeCloudStorageTime({
        ProductId: productId,
        DeviceName: deviceName,
        Date: today,
        StartTime: Math.floor((now.getTime() - 3600000) / 1000),
        EndTime: Math.floor(now.getTime() / 1000),
      });

      const videoUrl = result.Data?.VideoURL || '';

      // 更新会话中的 URL
      session.streamUrl = videoUrl;
      session.hlsUrl = videoUrl;
      session.updatedAt = new Date();
      session.createdAt = new Date();

      // 更新缓存
      this.sessions.set(session.id, session);
      await this.cacheSession(session);

      return session;
    } catch (error: any) {
      console.error(`[IoT Video Consumer] Failed to refresh URLs: ${error.message}`);
      throw error;
    }
  }

  /**
   * 直接获取设备播放地址
   *
   * 用于设备已持续推流的场景
   * 注意：消费版返回的是云存储视频 URL，不是实时流 URL
   */
  async getDirectPlaybackUrl(deviceId: string): Promise<DirectPlaybackInfo> {
    console.log(`[IoT Video Consumer] Getting direct playback URL for device: ${deviceId}`);

    const { productId, deviceName } = this.parseDeviceId(deviceId);
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    try {
      const result = await this.client.DescribeCloudStorageTime({
        ProductId: productId,
        DeviceName: deviceName,
        Date: today,
        StartTime: Math.floor((now.getTime() - 3600000) / 1000),
        EndTime: Math.floor(now.getTime() / 1000),
      });

      const videoUrl = result.Data?.VideoURL || '';

      return {
        hlsUrl: videoUrl,
        rtmpUrl: '',
        flvUrl: '',
        webrtcUrl: '',
        streamName: `${productId}/${deviceName}`,
        provider: StreamProviderType.IOT_VIDEO,
        deviceId,
        expiresAt: new Date(Date.now() + this.iotVideoConfig.expireTime * 1000),
        isStreaming: !!videoUrl,
      };
    } catch (error: any) {
      console.error(`[IoT Video Consumer] Failed to get direct playback URL: ${error.message}`);

      if (
        error.code === 'InvalidParameterValue.DeviceNotOnline' ||
        error.code === 'ResourceNotFound.CloudStorageNotEnabled'
      ) {
        return {
          hlsUrl: '',
          streamName: `${productId}/${deviceName}`,
          provider: StreamProviderType.IOT_VIDEO,
          deviceId,
          expiresAt: new Date(),
          isStreaming: false,
        };
      }

      throw error;
    }
  }

  /**
   * 检查设备是否正在推流
   *
   * 消费版通过检查云存储是否有数据来判断
   */
  async isDeviceStreaming(deviceId: string): Promise<boolean> {
    const { productId, deviceName } = this.parseDeviceId(deviceId);
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    try {
      const result = await this.client.DescribeCloudStorageTime({
        ProductId: productId,
        DeviceName: deviceName,
        Date: today,
        StartTime: Math.floor((now.getTime() - 300000) / 1000), // 5 分钟前
        EndTime: Math.floor(now.getTime() / 1000),
      });

      // 如果有云存储数据，说明设备在推流
      return !!(result.Data?.VideoURL || (result.Data?.TimeList && result.Data.TimeList.length > 0));
    } catch (error: any) {
      console.error(`[IoT Video Consumer] Failed to check streaming status: ${error.message}`);
      return false;
    }
  }

  /**
   * 开始录制
   *
   * 消费版使用云存储进行录制
   * 使用 CreateCloudStorage API 开通云存储套餐
   */
  async startRecording(deviceId: string, config: RecordConfig): Promise<string> {
    console.log(`[IoT Video Consumer] Starting recording for device: ${deviceId}`);
    return '';
    // const { productId, deviceName } = this.parseDeviceId(deviceId);
    // const recordingId = IdGenerator.uuid();
    // const now = new Date();

    // try {
    //   // 消费版需要开通云存储套餐才能录制
    //   // PackageId 示例: yc1m7d (全时7天存储月套餐), ye1m7d (事件7天存储月套餐)
    //   // 注意：这里需要根据实际业务需求选择套餐
    //   const packageId = config.storageType === 'hot' ? 'yc1m7d' : 'ye1m7d';

    //   if (this.client.CreateCloudStorage) {
    //     await this.client.CreateCloudStorage({
    //       ProductId: productId,
    //       DeviceName: deviceName,
    //       PackageId: packageId,
    //       Override: 1, // 覆盖已有套餐
    //     });
    //   }

    //   const recordingConfig = {
    //     recordingId,
    //     deviceId,
    //     productId,
    //     deviceName,
    //     startTime: now,
    //     format: config.format,
    //     status: 'recording',
    //     createdAt: now,
    //   };

    //   this.recordings.set(recordingId, recordingConfig);

    //   console.log(`[IoT Video Consumer] Recording started: ${recordingId}`);
    //   console.log(`[IoT Video Consumer] Cloud storage package: ${packageId}`);

    //   return recordingId;
    // } catch (error: any) {
    //   console.error(`[IoT Video Consumer] Failed to start recording: ${error.message}`);
    //   // 记录本地状态
    //   this.recordings.set(recordingId, {
    //     recordingId,
    //     deviceId,
    //     productId,
    //     deviceName,
    //     startTime: now,
    //     format: config.format,
    //     status: 'recording',
    //     createdAt: now,
    //     error: error.message,
    //   });
    //   return recordingId;
    // }
  }

  /**
   * 停止录制
   *
   * 消费版的云存储录制无法直接停止
   * 可以通过 ResetCloudStorage 清除云存储数据
   */
  async stopRecording(recordingId: string): Promise<void> {
    console.log(`[IoT Video Consumer] Stopping recording: ${recordingId}`);

    const recording = this.recordings.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    recording.status = 'completed';
    recording.stoppedAt = new Date();

    console.log(`[IoT Video Consumer] Recording stopped: ${recordingId}`);
    console.log(`[IoT Video Consumer] Note: Cloud storage data remains until expiration`);
  }

  /**
   * 获取录制列表
   *
   * 查询 IoT Video 云存储的录制日期和数据
   */
  async getRecordings(
    deviceId: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<any[]> {
    console.log(`[IoT Video Consumer] Getting recordings for device: ${deviceId}`);

    const { productId, deviceName } = this.parseDeviceId(deviceId);
    const list: any[] = [];

    try {
      // 先获取有云存储数据的日期列表
      const dateResult = await this.client.DescribeCloudStorageDate({
        ProductId: productId,
        DeviceName: deviceName,
      });

      // 返回的是日期字符串数组 ["2021-01-05", "2021-01-06"]
      const dates = dateResult.Data || [];

      // 过滤日期范围
      const start = startTime ? startTime.toISOString().split('T')[0] : null;
      const end = endTime ? endTime.toISOString().split('T')[0] : null;

      for (const dateStr of dates) {
        // 日期过滤
        if (start && dateStr < start) continue;
        if (end && dateStr > end) continue;

        // 获取该日期的时间轴数据
        const timeResult = await this.client.DescribeCloudStorageTime({
          ProductId: productId,
          DeviceName: deviceName,
          Date: dateStr,
        });

        list.push({
          date: dateStr,
          videoUrl: timeResult.Data?.VideoURL || '',
          timeSlots: timeResult.Data?.TimeList || [],
        });
      }

      console.log(`[IoT Video Consumer] Found ${list.length} days with recordings`);
      return list;
    } catch (error: any) {
      console.error(`[IoT Video Consumer] Failed to get recordings: ${error.message}`);
      return list;
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    return true;
    // try {
    //   // 尝试调用一个轻量级 API 验证连接
    //   if (this.client.DescribeProject && this.iotVideoConfig.productId) {
    //     await this.client.DescribeProducts({
    //       Offset: 0,
    //       Limit: 1,
    //     });
    //   }
    //   return true;
    // } catch (error: any) {
    //   if (error.code === 'UnauthorizedOperation' || error.code === 'AuthFailure') {
    //     console.warn('[IoT Video Consumer] Health check: credentials may be invalid');
    //     return false;
    //   }
    //   console.error('[IoT Video Consumer] Health check failed:', error.message);
    //   return false;
    // }
  }

  /**
   * 缓存会话到 Redis
   */
  private async cacheSession(session: StreamSession): Promise<void> {
    await this.redis.set(
      `stream:session:${session.id}`,
      JSON.stringify(session),
      'EX',
      86400 // 24 小时
    );
  }

  /**
   * 从缓存恢复会话
   */
  async restoreSession(sessionId: string): Promise<StreamSession | null> {
    const cached = await this.redis.get(`stream:session:${sessionId}`);
    if (cached) {
      const session = JSON.parse(cached) as StreamSession;
      this.sessions.set(sessionId, session);
      return session;
    }
    return null;
  }

  /**
   * 清理过期会话
   */
  async cleanupExpiredSessions(): Promise<number> {
    let cleaned = 0;
    const now = Date.now();
    const maxAge = this.iotVideoConfig.expireTime * 1000 || 3600000;

    for (const [id, session] of this.sessions.entries()) {
      const age = now - new Date(session.createdAt).getTime();
      if (age > maxAge) {
        this.sessions.delete(id);
        await this.redis.del(`stream:session:${id}`);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[IoT Video Consumer] Cleaned up ${cleaned} expired sessions`);
    }

    return cleaned;
  }

  /**
   * 销毁资源
   */
  async destroy(): Promise<void> {
    this.sessions.clear();
    this.recordings.clear();
    console.log('[IoT Video Consumer] Provider destroyed');
  }

  /**
   * 创建 IoT Video 设备并获取三元组信息
   *
   * 当设备首次注册时，调用腾讯云 CreateDevice API 在 IoT Video 平台创建设备
   * 返回设备的三元组信息（ProductId, DeviceName, DeviceSecret）
   *
   * @param deviceName - 设备名称（如果不传则自动生成）
   * @returns 设备三元组信息
   * @see https://cloud.tencent.com/document/api/634/19468
   */
  async createDevice(deviceName?: string): Promise<DeviceTripleInfo> {
    if (!this.client) {
      throw new Error('[IoT Video] IoT Cloud client not initialized');
    }

    const productId = this.iotVideoConfig.productId;
    if (!productId) {
      throw new Error('[IoT Video] ProductId not configured');
    }

    // 生成设备名称：使用前缀 + 时间戳或传入的名称
    const name = deviceName || `${this.iotVideoConfig.devicePrefix || 'device'}_${Date.now()}`;
    const now = new Date();

    console.log(`[IoT Video] Creating device: ${name} in product: ${productId}`);

    try {
      // 调用腾讯云 CreateDevice API
      // @see https://cloud.tencent.com/document/api/634/19468
      const result = await this.client.CreateDevice({
        ProductId: productId,
        DeviceName: name,
      });
      console.log("创建设备成功：", result);
      // API 返回格式：
      // {
      //   DeviceName: string,      // 设备名称
      //   DevicePsk: string,       // 设备密钥（用于设备认证）
      //   RequestId: string        // 请求唯一标识
      // }

      const devicePsk: string = result.Data?.DevicePsk || '';
      const createdDeviceName: string = result.Data?.DeviceName || name;

      console.log(`[IoT Video] Device created successfully: ${createdDeviceName}`);

      // 构建系统内部设备 ID（productId/deviceName 格式）
      return {
        productId,
        deviceName: createdDeviceName,
        deviceSecret: devicePsk,  // DevicePsk 即为 DeviceSecret
        devicePsk,
        deviceId: deviceName,
        createdAt: now,
      };
    } catch (error: any) {
      console.error(`[IoT Video] Failed to create device: ${error.message}`);

      // 处理特定错误
      if (error.code === 'ResourceFailure.DeviceAlreadyExist') {
        // 设备已存在，尝试获取设备信息
        console.log(`[IoT Video] Device already exists, fetching device info...`);
        return this.getDeviceInfo(name);
      }

      throw new Error(`Failed to create IoT Video device: ${error.message}`);
    }
  }

  /**
   * 获取已存在设备的三元组信息
   *
   * 通过 DescribeDevice API 获取设备详情，包含 DevicePsk
   *
   * @param deviceName - 设备名称
   * @returns 设备三元组信息
   */
  async getDeviceInfo(deviceName: string): Promise<DeviceTripleInfo> {
    if (!this.client) {
      throw new Error('[IoT Video] IoT Cloud client not initialized');
    }

    const productId = this.iotVideoConfig.productId;
    if (!productId) {
      throw new Error('[IoT Video] ProductId not configured');
    }

    console.log(`[IoT Video] Getting device info: ${deviceName}`);

    try {
      // 调用腾讯云 DescribeDevice API
      const result = await this.client.DescribeDevice({
        ProductId: productId,
        DeviceName: deviceName,
      });

      // API 返回格式：
      // {
      //   DeviceName: string,
      //   DevicePsk: string,     // 可能为空（如果设备使用证书认证）
      //   ...
      // }

      const devicePsk: string = result.Device?.DevicePsk || '';
      const deviceId = `${productId}/${deviceName}`;

      return {
        productId,
        deviceName,
        deviceSecret: devicePsk,
        devicePsk,
        deviceId,
        createdAt: new Date(),
      };
    } catch (error: any) {
      console.error(`[IoT Video] Failed to get device info: ${error.message}`);
      throw new Error(`Failed to get IoT Video device info: ${error.message}`);
    }
  }

  /**
   * 确保设备存在，不存在则创建
   *
   * @param deviceName - 设备名称
   * @returns 设备三元组信息
   */
  async ensureDevice(deviceName: string): Promise<DeviceTripleInfo> {
    try {
      // 先尝试获取设备信息
      const existingDevice = await this.getDeviceInfo(deviceName);
      console.log(`[IoT Video] Device already exists: ${deviceName}`);
      return existingDevice;
    } catch (error: any) {
      // 设备不存在，创建新设备
      console.log(`[IoT Video] Device not found, creating new device: ${deviceName}`);
      return this.createDevice(deviceName);
      // if (error.code === 'ResourceNotFound.DeviceNotExist') {
      //   console.log(`[IoT Video] Device not found, creating new device: ${deviceName}`);
      //   return this.createDevice(deviceName);
      // }
      // throw error;
    }
  }

  // ==================== 设备数据相关方法 ====================

  /**
   * 获取设备属性数据
   *
   * @param deviceId - 设备ID（productId/deviceName 格式或纯 deviceName）
   * @returns 设备属性数据 JSON 字符串
   * @see https://cloud.tencent.com/document/product/1081/34916
   */
  async describeDeviceData(deviceId: string): Promise<string> {
    const { productId, deviceName } = this.parseDeviceId(deviceId);

    if (!this.client) {
      throw new Error('[IoT Video] Client not initialized');
    }

    console.log(`[IoT Video] Getting device data: ${deviceId}`);

    try {
      const result = await this.client.DescribeDeviceData({
        ProductId: productId,
        DeviceName: deviceName,
      });

      console.log(`[IoT Video] Device data retrieved: ${deviceId}`);
      return result.Data || '{}';
    } catch (error: any) {
      console.error(`[IoT Video] Failed to get device data: ${error.message}`);
      throw new Error(`Failed to get device data: ${error.message}`);
    }
  }

  // ==================== 云存储相关方法 ====================

  /**
   * 对原始云存储视频播放 URL 进行防盗链签名
   *
   * 调用 GenerateSignedVideoURL API 对传入的原始 URL 进行签名，生成防盗链 URL
   *
   * @param videoUrl - 原始云存储视频播放 URL
   * @param deviceId - 设备ID（可选，用于日志和返回信息）
   * @returns 防盗链视频URL信息
   * @see https://cloud.tencent.com/document/product/1131/65433
   */
  async getVideoAntiLeechUrl(
    videoUrl: string,
  ): Promise<VideoAntiLeechUrlInfo> {
    if (!this.client) {
      throw new Error('[IoT Video] Client not initialized');
    }

    if (!videoUrl) {
      throw new Error('videoUrl is required');
    }

    try {
      const now = new Date();
      const requestTime = Math.floor(now.getTime() / 1000);
      const expireTime = requestTime + this.iotVideoConfig.expireTime;

      const signResult = await this.client.GenerateSignedVideoURL({
        VideoURL: videoUrl,
        ExpireTime: expireTime,
      });

      const signedVideoUrl = signResult.SignedVideoURL || videoUrl;

      return {
        videoUrl: signedVideoUrl,
        expireTime,
        deviceId: '',
        requestTime,
      };
    } catch (error: any) {
      console.error(`[IoT Video] Failed to get anti-leech video URL: ${error.message}`);
      throw new Error(`Failed to get anti-leech video URL: ${error.message}`);
    }
  }

  /**
   * 开通设备云存储
   *
   * 调用腾讯云 CreateCloudStorage API 为设备开通云存储套餐
   *
   * @param deviceId - 设备ID（可以是 productId/deviceName 格式或纯 deviceName）
   * @param packageId - 云存储套餐ID
   *   - yc1m7d: 全时7天存储月套餐
   *   - yc1m30d: 全时30天存储月套餐
   *   - ye1m7d: 事件7天存储月套餐
   *   - ye1m30d: 事件30天存储月套餐
   * @param override - 是否覆盖已有套餐，默认 true
   * @returns 开通结果
   * @see https://cloud.tencent.com/document/product/1131/49169
   */
  async createCloudStorage(
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
    const { productId, deviceName } = this.parseDeviceId(deviceId);

    if (!this.client) {
      throw new Error('[IoT Video] Client not initialized');
    }

    if (!productId) {
      throw new Error('[IoT Video] ProductId not configured');
    }

    console.log(`[IoT Video] Creating cloud storage for device: ${deviceId}, package: ${packageId}`);

    try {
      // 调用腾讯云 CreateIotVideoCloudStorage API
      // @see https://cloud.tencent.com/document/product/1131/49169
      const result = await this.client.CreateIotVideoCloudStorage({
        ProductId: productId,
        DeviceName: deviceId,
        PackageId: packageId,
        Override: override ? 1 : 0,
      });

      console.log(`[IoT Video] Cloud storage created for device: ${deviceId}, package: ${packageId}`);

      return {
        success: true,
        packageId,
        deviceId: deviceName,
      };
    } catch (error: any) {
      console.error(`[IoT Video] Failed to create cloud storage: ${error.message}`);

      // 处理特定错误
      if (error.code === 'ResourceNotFound.DeviceNotExist') {
        throw new Error(`Device ${deviceId} not registered in IoT Video platform`);
      } else if (error.code === 'InvalidParameterValue.PackageIdNotFound') {
        throw new Error(`Invalid package ID: ${packageId}`);
      } else if (error.code === 'ResourceInsufficient.PackageInsufficient') {
        throw new Error(`Cloud storage package insufficient`);
      }

      throw new Error(`Failed to create cloud storage: ${error.message}`);
    }
  }

  /**
   * 获取设备云存储详情
   *
   * 调用腾讯云 DescribeCloudStorage API 获取设备云存储状态
   *
   * @param deviceId - 设备ID
   * @returns 云存储详情
   * @see https://cloud.tencent.com/document/product/1131/49170
   */
  async getCloudStorageDetail(deviceId: string): Promise<CloudStorageDetail> {
    const { productId, deviceName } = this.parseDeviceId(deviceId);

    if (!this.client) {
      throw new Error('[IoT Video] Client not initialized');
    }

    console.log(`[IoT Video] Getting cloud storage detail for device: ${deviceId}`);

    try {
      const result = await this.client.DescribeCloudStorage({
        ProductId: productId,
        DeviceName: deviceName,
      });

      return {
        status: String(result.Status ?? 0),
        type: String(result.Type ?? 0),
        expireTime: result.ExpireTime || 0,
        shiftDuration: result.ShiftDuration || 0,
        deviceId: deviceName,
      };
    } catch (error: any) {
      console.error(`[IoT Video] Failed to get cloud storage detail: ${error.message}`);

      if (error.code === 'ResourceNotFound.DeviceNotExist') {
        throw new Error(`Device ${deviceId} not registered in IoT Video platform`);
      } else if (error.code === 'ResourceNotFound.CloudStorageNotEnabled') {
        return {
          status: '0',
          type: '0',
          expireTime: 0,
          shiftDuration: 0,
          deviceId: deviceName,
        };
      }

      throw new Error(`Failed to get cloud storage detail: ${error.message}`);
    }
  }

  /**
   * 获取云存储套餐列表
   *
   * 调用腾讯云 DescribeCloudStoragePackages API 获取可用的云存储套餐
   *
   * @returns 套餐列表
   * @see https://cloud.tencent.com/document/product/1131/49171
   */
  // async getCloudStoragePackages(): Promise<Array<{
  //   packageId: string;
  //   packageName: string;
  //   packageType: string;
  //   duration: number;
  //   price: number;
  //   storageMode: string;
  // }>> {
  //   if (!this.client) {
  //     throw new Error('[IoT Video] Client not initialized');
  //   }

  //   console.log(`[IoT Video] Getting cloud storage packages`);

  //   try {
  //     const result = await this.client.DescribeDevicePackages({
  //       ProductId: this.iotVideoConfig.productId,
  //     });

  //     const packages = (result.Packages || []).map((pkg: any) => ({
  //       packageId: pkg.PackageId || '',
  //       packageName: pkg.PackageName || '',
  //       packageType: pkg.PackageType || '',
  //       duration: pkg.Duration || 0,
  //       price: pkg.Price || 0,
  //       storageMode: pkg.StorageMode || '',
  //     }));

  //     console.log(`[IoT Video] Found ${packages.length} cloud storage packages`);

  //     return packages;
  //   } catch (error: any) {
  //     console.error(`[IoT Video] Failed to get cloud storage packages: ${error.message}`);
  //     throw new Error(`Failed to get cloud storage packages: ${error.message}`);
  //   }
  // }

  /**
   * 获取设备全时云存录像
   *
   * 通过 DescribeCloudStorageDate 获取有云存数据的日期列表，
   * 再通过 DescribeCloudStorageTime 获取指定日期的时间轴数据
   *
   * @param deviceId - 设备ID
   * @param date - 查询日期（YYYY-MM-DD），不传则返回所有有数据的日期的时间轴
   * @param startTime - 开始时间（Unix 时间戳，秒），可选，需配合 date 使用
   * @param endTime - 结束时间（Unix 时间戳，秒），可选，需配合 date 使用
   * @returns 全时云存录像列表
   * @see https://cloud.tencent.com/document/product/1131/49167
   * @see https://cloud.tencent.com/document/product/1131/49168
   */
  async getCloudStorageRecordings(
    deviceId: string,
    date?: string,
    startTime?: number,
    endTime?: number
  ): Promise<CloudStorageRecordingsResult> {
    const { productId, deviceName } = this.parseDeviceId(deviceId);

    if (!this.client) {
      throw new Error('[IoT Video] Client not initialized');
    }

    console.log(`[IoT Video] Getting cloud storage recordings for device: ${deviceId}, date: ${date || 'all'}`);

    try {
      // 1. 获取有云存数据的日期列表
      const dateResult = await this.client.DescribeCloudStorageDate({
        ProductId: productId,
        DeviceName: deviceName,
      });

      const allDates: string[] = dateResult.Data || [];

      // 如果指定了日期，过滤到该日期
      const queryDates = date ? allDates.filter((d: string) => d === date) : allDates;

      if (queryDates.length === 0) {
        return {
          dates: allDates,
          recordings: [],
        };
      }

      // 2. 遍历日期，获取时间轴数据
      const recordings: Array<{
        date: string;
        timeSlots: Array<{ startTime: number; endTime: number }>;
        videoUrl: string;
      }> = [];

      for (const dateStr of queryDates) {
        const timeParams: any = {
          ProductId: productId,
          DeviceName: deviceName,
          Date: dateStr,
        };

        // 支持指定时间范围
        if (startTime) {
          timeParams.StartTime = startTime;
        }
        if (endTime) {
          timeParams.EndTime = endTime;
        }

        const timeResult = await this.client.DescribeCloudStorageTime(timeParams);

        const rawTimeSlots = timeResult.Data?.TimeList || [];

        recordings.push({
          date: dateStr,
          timeSlots: rawTimeSlots.map((slot) => ({
            startTime: slot.StartTime || 0,
            endTime: slot.EndTime || 0,
          })),
          videoUrl: timeResult.Data?.VideoURL || '',
        });
      }

      console.log(`[IoT Video] Found ${recordings.length} days with cloud storage recordings`);

      return {
        dates: allDates,
        recordings,
      };
    } catch (error: any) {
      console.error(`[IoT Video] Failed to get cloud storage recordings: ${error.message}`);

      if (error.code === 'ResourceNotFound.DeviceNotExist') {
        throw new Error(`Device ${deviceId} not registered in IoT Video platform`);
      } else if (error.code === 'ResourceNotFound.CloudStorageNotEnabled') {
        throw new Error(`Cloud storage not enabled for device ${deviceId}`);
      }

      throw new Error(`Failed to get cloud storage recordings: ${error.message}`);
    }
  }

  /**
   * 获取设备云存事件列表
   *
   * 调用腾讯云 DescribeCloudStorageEvents API 获取设备云存储中的事件列表
   * 如移动侦测、人形检测等事件录像
   *
   * @param deviceId - 设备ID
   * @param startTime - 开始时间（Unix 时间戳，秒），可选
   * @param endTime - 结束时间（Unix 时间戳，秒），可选
   * @param context - 翻页游标，可选
   * @param size - 每页数量，默认 10
   * @returns 云存事件列表及总数
   * @see https://cloud.tencent.com/document/product/1131/77502
   */
  async getCloudStorageEvents(
    deviceId: string,
    startTime?: number,
    endTime?: number,
    context?: string,
    size: number = 10
  ): Promise<CloudStorageEventsResult> {
    const { productId, deviceName } = this.parseDeviceId(deviceId);

    if (!this.client) {
      throw new Error('[IoT Video] Client not initialized');
    }

    console.log(`[IoT Video] Getting cloud storage events for device: ${deviceId}`);

    try {
      const params: any = {
        ProductId: productId,
        DeviceName: deviceName,
        Size: Math.min(size, 50),
      };

      if (startTime) {
        params.StartTime = startTime;
      }
      if (endTime) {
        params.EndTime = endTime;
      }
      if (context) {
        params.Context = context;
      }

      const result = await this.client.DescribeCloudStorageEvents(params);

      const events = (result.Events || []).map((event: any) => ({
        eventId: event.EventId || '',
        eventType: event.EventType || '',
        startTime: event.StartTime || 0,
        endTime: event.EndTime || 0,
        thumbnailUrl: event.ThumbnailUrl || '',
        videoUrl: event.VideoUrl || '',
        deviceId: deviceName,
      }));

      console.log(`[IoT Video] Found ${events.length} cloud storage events, total: ${result.Total || 0}`);

      return {
        total: result.Total || 0,
        events,
        listover: result.Listover ?? true,
        context: result.Context || undefined,
      };
    } catch (error: any) {
      console.error(`[IoT Video] Failed to get cloud storage events: ${error.message}`);

      if (error.code === 'ResourceNotFound.DeviceNotExist') {
        throw new Error(`Device ${deviceId} not registered in IoT Video platform`);
      } else if (error.code === 'ResourceNotFound.CloudStorageNotEnabled') {
        throw new Error(`Cloud storage not enabled for device ${deviceId}`);
      }

      throw new Error(`Failed to get cloud storage events: ${error.message}`);
    }
  }

  /**
   * 重置设备云存储
   *
   * 调用腾讯云 ResetCloudStorage API 清除设备的云存储数据
   *
   * @param deviceId - 设备ID
   * @returns 重置结果
   * @see https://cloud.tencent.com/document/product/1131/49173
   */
  async resetCloudStorage(deviceId: string): Promise<{
    success: boolean;
    deviceId: string;
    message?: string;
  }> {
    const { productId, deviceName } = this.parseDeviceId(deviceId);

    if (!this.client) {
      throw new Error('[IoT Video] Client not initialized');
    }

    console.log(`[IoT Video] Resetting cloud storage for device: ${deviceId}`);

    try {
      await this.client.ResetCloudStorage({
        ProductId: productId,
        DeviceName: deviceName,
      });

      console.log(`[IoT Video] Cloud storage reset for device: ${deviceId}`);

      return {
        success: true,
        deviceId: deviceName,
      };
    } catch (error: any) {
      console.error(`[IoT Video] Failed to reset cloud storage: ${error.message}`);

      if (error.code === 'ResourceNotFound.DeviceNotExist') {
        throw new Error(`Device ${deviceId} not registered in IoT Video platform`);
      } else if (error.code === 'ResourceNotFound.CloudStorageNotEnabled') {
        throw new Error(`Cloud storage not enabled for device ${deviceId}`);
      }

      throw new Error(`Failed to reset cloud storage: ${error.message}`);
    }
  }

  /**
   * 获取单个云存储缩略图访问地址
   *
   * 调用腾讯云 DescribeCloudStorageThumbnail API 获取指定缩略图的访问 URL
   *
   * @param deviceId - 设备ID
   * @param thumbnail - 缩略图文件名
   * @returns 缩略图访问地址信息
   * @see https://cloud.tencent.com/document/product/1131/49174
   */
  async getCloudStorageThumbnail(
    deviceId: string,
    thumbnail: string
  ): Promise<CloudStorageThumbnailResult> {
    const { productId, deviceName } = this.parseDeviceId(deviceId);

    if (!this.client) {
      throw new Error('[IoT Video] Client not initialized');
    }

    console.log(`[IoT Video] Getting cloud storage thumbnail for device: ${deviceId}`);

    try {
      const result = await this.client.DescribeCloudStorageThumbnail({
        ProductId: productId,
        DeviceName: deviceName,
        Thumbnail: thumbnail,
      });

      const thumbnailUrl = result.ThumbnailURL || '';
      const expireTime = result.ExpireTime || 0;

      return {
        thumbnailUrl,
        expireTime,
        deviceId: deviceName,
      };
    } catch (error: any) {
      console.error(`[IoT Video] Failed to get cloud storage thumbnail: ${error.message}`);

      if (error.code === 'ResourceNotFound.DeviceNotExist') {
        throw new Error(`Device ${deviceId} not registered in IoT Video platform`);
      } else if (error.code === 'ResourceNotFound.CloudStorageNotEnabled') {
        throw new Error(`Cloud storage not enabled for device ${deviceId}`);
      }

      throw new Error(`Failed to get cloud storage thumbnail: ${error.message}`);
    }
  }

  /**
   * 批量获取云存储缩略图访问地址
   *
   * 调用腾讯云 DescribeCloudStorageThumbnailList API 批量获取缩略图访问 URL
   *
   * @param deviceId - 设备ID
   * @param thumbnails - 缩略图文件名列表
   * @returns 缩略图访问地址列表
   * @see https://cloud.tencent.com/document/product/1131/49175
   */
  async getCloudStorageThumbnailList(
    deviceId: string,
    thumbnails: string[]
  ): Promise<CloudStorageThumbnailListResult> {
    const { productId, deviceName } = this.parseDeviceId(deviceId);

    if (!this.client) {
      throw new Error('[IoT Video] Client not initialized');
    }

    console.log(`[IoT Video] Getting cloud storage thumbnail list for device: ${deviceId}, count: ${thumbnails.length}`);

    try {
      const result = await this.client.DescribeCloudStorageThumbnailList({
        ProductId: productId,
        DeviceName: deviceName,
        ThumbnailList: thumbnails,
      });

      const rawList = result.ThumbnailURLInfoList || [];

      return {
        thumbnails: rawList.map((item) => ({
          thumbnailUrl: item.ThumbnailURL || '',
          expireTime: item.ExpireTime || 0,
        })),
        deviceId: deviceName,
      };
    } catch (error: any) {
      console.error(`[IoT Video] Failed to get cloud storage thumbnail list: ${error.message}`);

      if (error.code === 'ResourceNotFound.DeviceNotExist') {
        throw new Error(`Device ${deviceId} not registered in IoT Video platform`);
      } else if (error.code === 'ResourceNotFound.CloudStorageNotEnabled') {
        throw new Error(`Cloud storage not enabled for device ${deviceId}`);
      }

      throw new Error(`Failed to get cloud storage thumbnail list: ${error.message}`);
    }
  }

  /**
   * 获取多个云存储缩略图访问地址（管道符分隔）
   *
   * 调用腾讯云 DescribeCloudStorageMultiThumbnail API 获取多个缩略图访问 URL
   * 多个缩略图文件名以 | 分隔传入
   *
   * @param deviceId - 设备ID
   * @param multiThumbnail - 多个缩略图文件名，以 | 分隔
   * @returns 缩略图访问地址列表
   * @see https://cloud.tencent.com/document/product/1131/49176
   */
  async getCloudStorageMultiThumbnail(
    deviceId: string,
    multiThumbnail: string
  ): Promise<CloudStorageThumbnailListResult> {
    const { productId, deviceName } = this.parseDeviceId(deviceId);

    if (!this.client) {
      throw new Error('[IoT Video] Client not initialized');
    }

    console.log(`[IoT Video] Getting cloud storage multi thumbnail for device: ${deviceId}`);

    try {
      const result = await this.client.DescribeCloudStorageMultiThumbnail({
        ProductId: productId,
        DeviceName: deviceName,
        MultiThumbnail: multiThumbnail,
      });

      const rawList = result.ThumbnailURLInfoList || [];

      return {
        thumbnails: rawList.map((item) => ({
          thumbnailUrl: item.ThumbnailURL || '',
          expireTime: item.ExpireTime || 0,
        })),
        deviceId: deviceName,
      };
    } catch (error: any) {
      console.error(`[IoT Video] Failed to get cloud storage multi thumbnail: ${error.message}`);

      if (error.code === 'ResourceNotFound.DeviceNotExist') {
        throw new Error(`Device ${deviceId} not registered in IoT Video platform`);
      } else if (error.code === 'ResourceNotFound.CloudStorageNotEnabled') {
        throw new Error(`Cloud storage not enabled for device ${deviceId}`);
      }

      throw new Error(`Failed to get cloud storage multi thumbnail: ${error.message}`);
    }
  }
}
