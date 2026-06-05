// @ts-nocheck
import { Provide, Inject, Config } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import {
  KinesisVideoClient,
  ListStreamsCommand,
  DescribeStreamCommand,
  CreateStreamCommand,
  GetDataEndpointCommand,
} from '@aws-sdk/client-kinesis-video';
import {
  KinesisVideoArchivedMediaClient,
  GetHLSStreamingSessionURLCommand,
  ListFragmentsCommand,
  GetClipCommand,
} from '@aws-sdk/client-kinesis-video-archived-media';
import { RekognitionClient } from '@aws-sdk/client-rekognition';
import { IStreamProvider, DirectPlaybackInfo } from './stream-provider.interface';
import {
  StreamConfig,
  StreamSession,
  RecordConfig,
  StreamProviderType,
  StreamProtocol,
} from '@baby-monitor/shared-types';
import { IdGenerator } from '@baby-monitor/shared-utils';

/**
 * AWS Kinesis Video Streams (KVS) 流媒体提供者
 *
 * 提供基于AWS KVS的流媒体服务，支持：
 * - 视频推流和拉流
 * - HLS播放会话
 * - 视频录制和片段管理
 * - 支持AWS中国区（北京 cn-north-1 和宁夏 cn-northwest-1）
 *
 * 实现了IStreamProvider接口
 */
@Provide()
export class AWSKVSProvider implements IStreamProvider {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Config('aws')
  awsConfig!: any;

  /** AWS KVS视频流客户端 */
  private kvsVideo!: KinesisVideoClient;
  /** AWS KVS归档内容客户端 */
  private kvsArchivedContent!: KinesisVideoArchivedMediaClient;
  /** AWS KVS信令客户端（信令通道是KVS的一部分） */
  private kvsSignaling!: KinesisVideoClient;

  /** 本地会话缓存 */
  private sessions: Map<string, StreamSession> = new Map();
  /** 本地录制缓存 */
  private recordings: Map<string, any> = new Map();
  /** Stream名称缓存 */
  private streamCache: Map<string, string> = new Map();

  /**
   * 初始化AWS KVS客户端
   *
   * 支持AWS中国区（北京 cn-north-1 和宁夏 cn-northwest-1）
   */
  async initialize(): Promise<void> {
    // 安全地获取配置，处理undefined情况
    const awsConfig = this.awsConfig || {};
    const kvsConfig = awsConfig.kvs || {};

    const region = awsConfig.region || kvsConfig.region || 'cn-north-1';
    const accessKeyId = awsConfig.accessKeyId || kvsConfig.accessKeyId;
    const secretAccessKey = awsConfig.secretAccessKey || kvsConfig.secretAccessKey;
    const isChinaRegion = awsConfig.isChinaRegion ?? region?.startsWith('cn-');
    const endpoint = awsConfig.endpoint || kvsConfig.endpoint;

    const clientConfig: ConstructorParameters<typeof KinesisVideoClient>[0] = {
      region,
      maxAttempts: 3,
    };

    // 设置AWS访问凭证
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }

    // AWS中国区需要使用特殊的endpoint
    if (isChinaRegion || region?.startsWith('cn-')) {
      // 配置中国区endpoint
      if (!endpoint) {
        if (region === 'cn-north-1') {
          // 北京
          clientConfig.endpoint = `https://kinesisvideo.cn-north-1.amazonaws.com.cn`;
        } else if (region === 'cn-northwest-1') {
          // 宁夏
          clientConfig.endpoint = `https://kinesisvideo.cn-northwest-1.amazonaws.com.cn`;
        }
      } else {
        clientConfig.endpoint = endpoint;
      }
    }

    this.kvsVideo = new KinesisVideoClient(clientConfig);

    // 初始化其他KVS服务客户端（需要单独的endpoint）
    this.kvsArchivedContent = new KinesisVideoArchivedMediaClient({
      ...clientConfig,
      endpoint: undefined, // endpoint会在需要时动态获取
    });

    this.kvsSignaling = new KinesisVideoClient(clientConfig);

    console.log(`[AWS KVS] Provider initialized for region: ${region}`);

    // 加载现有的streams到缓存
    await this.loadExistingStreams();
  }

  /**
   * 加载现有的streams
   */
  private async loadExistingStreams(): Promise<void> {
    try {
      const result = await this.kvsVideo.send(new ListStreamsCommand({}));
      if ((result as any).Streams) {
        for (const stream of (result as any).Streams) {
          if (stream.StreamName) {
            this.streamCache.set(stream.StreamName, stream.StreamName);
          }
        }
      }
      console.log(`[AWS KVS] Loaded ${this.streamCache.size} existing streams`);
    } catch (error) {
      console.error('[AWS KVS] Failed to load existing streams:', error);
    }
  }

  /**
   * 获取提供者类型
   *
   * @returns 提供者类型标识符
   */
  getType(): string {
    return StreamProviderType.AWS_KVS;
  }

  /**
   * 获取或创建KVS Stream
   *
   * 检查Stream是否存在，不存在则创建新的
   *
   * @param deviceId - 设备ID
   * @returns Stream名称
   * @private
   */
  private async getOrCreateStream(deviceId: string): Promise<string> {
    const streamName = this.getStreamName(deviceId);

    // 检查缓存
    if (this.streamCache.has(streamName)) {
      return streamName;
    }

    try {
      // 尝试描述stream
      await this.kvsVideo.send(new DescribeStreamCommand({ StreamName: streamName }));
      this.streamCache.set(streamName, streamName);
      return streamName;
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException' || error.$metadata?.httpStatusCode === 404) {
        // Stream不存在，创建新的
        const { retentionPeriod = 24 } = (this.awsConfig?.kvs || this.awsConfig) || {};

        const createParams = {
          StreamName: streamName,
          MediaStore: {
            RetentionPeriodHours: retentionPeriod,
          },
          DataType: 'VIDEO' as const, // VIDEO | AUDIO | MULTIPLEXED
        };

        await this.kvsVideo.send(new CreateStreamCommand(createParams));

        // 等待stream变为ACTIVE
        await this.waitForStreamActive(streamName);

        this.streamCache.set(streamName, streamName);
        console.log(`[AWS KVS] Created new stream: ${streamName}`);
        return streamName;
      }
      throw error;
    }
  }

  /**
   * 确保设备的 KVS Stream 存在（公开方法）
   * 用于设备注册时预先创建 stream
   *
   * @param deviceId - 设备ID
   * @returns Stream 信息
   */
  async ensureStreamExists(deviceId: string): Promise<{ streamName: string; created: boolean }> {
    console.log(`[AWS KVS] Ensuring stream exists for device: ${deviceId}`);
    const streamName = this.getStreamName(deviceId);

    // 检查缓存
    if (this.streamCache.has(streamName)) {
      return { streamName, created: false };
    }

    try {
      // 尝试描述 stream
      const result = await this.kvsVideo.send(new DescribeStreamCommand({ StreamName: streamName }));
      if (result.StreamInfo?.Status === 'ACTIVE') {
        this.streamCache.set(streamName, streamName);
        return { streamName, created: false };
      }
      // Stream 存在但不是 ACTIVE，等待
      await this.waitForStreamActive(streamName);
      this.streamCache.set(streamName, streamName);
      return { streamName, created: false };
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException' || error.$metadata?.httpStatusCode === 404) {
        // Stream 不存在，创建新的
        const { retentionPeriod = 24 } = (this.awsConfig?.kvs || this.awsConfig) || {};

        const createParams = {
          StreamName: streamName,
          MediaStore: {},
          DataRetentionInHours: retentionPeriod,
        };

        console.log(`[AWS KVS] Creating stream: ${streamName}, retention: ${retentionPeriod}h`);
        await this.kvsVideo.send(new CreateStreamCommand(createParams));

        // 等待 stream 变为 ACTIVE
        await this.waitForStreamActive(streamName);

        this.streamCache.set(streamName, streamName);
        console.log(`[AWS KVS] Created new stream for device ${deviceId}: ${streamName}`);
        return { streamName, created: true };
      }
      throw error;
    }
  }

  /**
   * 等待stream变为ACTIVE状态
   */
  private async waitForStreamActive(
    streamName: string,
    maxWaitTime: number = 30000
  ): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const result = await this.kvsVideo.send(new DescribeStreamCommand({ StreamName: streamName }));
        if (result.StreamInfo?.Status === 'ACTIVE') {
          return;
        }
      } catch (error) {
        // 忽略错误，继续等待
      }
      await this.sleep(1000);
    }
    throw new Error(`Stream ${streamName} did not become active in time`);
  }

  /**
   * 生成stream名称
   */
  private getStreamName(deviceId: string): string {
    return `bm-${deviceId.replace(/[^a-zA-Z0-9-]/g, '-')}`;
  }

  /**
   * 获取stream的data endpoint
   */
  private async getDataEndpoint(
    streamName: string,
    apiName: 'GET_HLS_STREAMING_SESSION_URL' | 'GET_DASH_STREAMING_SESSION_URL' | 'PUT_MEDIA' | 'GET_MEDIA'
  ): Promise<string> {
    const result = await this.kvsVideo.send(new GetDataEndpointCommand({
      StreamName: streamName,
      APIName: apiName,
    }));

    if (!result.DataEndpoint) {
      throw new Error(`Failed to get data endpoint for ${apiName}`);
    }

    return result.DataEndpoint;
  }

  /**
   * 开始推流
   */
  async startStream(deviceId: string, config: StreamConfig): Promise<StreamSession> {
    console.log(`[AWS KVS] Starting stream for device: ${deviceId}`);

    const streamName = await this.getOrCreateStream(deviceId);

    // 获取HLS播放端点
    const hlsEndpoint = await this.getDataEndpoint(streamName, 'GET_HLS_STREAMING_SESSION_URL');

    // 创建HLS会话客户端（使用动态获取的endpoint）
    const hlsClient = new KinesisVideoArchivedMediaClient({
      endpoint: hlsEndpoint,
      region: this.awsConfig?.region,
      credentials: this.awsConfig?.accessKeyId && this.awsConfig?.secretAccessKey ? {
        accessKeyId: this.awsConfig?.accessKeyId,
        secretAccessKey: this.awsConfig?.secretAccessKey,
      } : undefined,
    });

    const hlsSession = await hlsClient.send(new GetHLSStreamingSessionURLCommand({
      // 1. 指定要播放的流名称
      StreamName: streamName,
      // 2. 播放模式：LIVE 表示实时直播模式（还有 ON_DEMAND 按需播放模式）
      PlaybackMode: 'LIVE',
      // 3. HLS 片段选择器配置
      HLSFragmentSelector: {
        // 片段选择依据：SERVER_TIMESTAMP 表示使用服务器时间戳（还有 PRODUCER_TIMESTAMP 生产者时间戳）
        FragmentSelectorType: 'SERVER_TIMESTAMP',
      },
      // 4. 容器格式：MPEG_TS 格式（比 FRAGMENTED_MP4 兼容性更好）
      // fMP4 在某些浏览器/编码组合下会导致 bufferAppendError
      ContainerFormat: 'MPEG_TS',
      // 5. 是否显示片段时间戳：ALWAYS 表示始终显示（可选 NEVER）
      DisplayFragmentTimestamp: 'ALWAYS',
      // 6. 媒体播放列表中最多返回的片段数量：设置为 30 个片段
      // 注释说明：增加片段数量是为了提供更大的缓冲窗口，避免直播播放卡顿
      MaxMediaPlaylistFragmentResults: 100,
      MaxPlaylistFragmentResults: 100,      // 新增：控制m3u8总片段数
      HLSFragmentSize: 2,                   // 新增：片段时长2秒（更小的片段=更快容错）
      // 7. URL 过期时间：从配置中读取，默认 3600 秒（1 小时）
      // 先转字符串再转数字，确保类型正确，避免非数字配置导致的错误
      Expires: parseInt(config.expiration?.toString() || '3600'),
    }));

    const now = new Date();
    const session: StreamSession = {
      id: IdGenerator.uuid(),
      deviceId,
      provider: StreamProviderType.AWS_KVS,
      config,
      status: 'streaming',
      streamName,
      streamUrl: hlsSession.HLSStreamingSessionURL || '',
      hlsUrl: hlsSession.HLSStreamingSessionURL || '',
      rtmpUrl: await this.getRTMPUrl(streamName),
      webrtcUrl: await this.getWebRTCUrl(streamName),
      createdAt: now,
      updatedAt: now,
    };

    // 缓存会话
    this.sessions.set(session.id, session);
    await this.cacheSession(session);

    // 保存stream ARN
    if (session.streamArn) {
      await this.redis.set(`kvs:stream:${deviceId}`, session.streamArn, 'EX', 86400);
    }

    console.log(`[AWS KVS] Stream started: ${session.id}`);
    return session;
  }

  /**
   * 获取RTMP推流地址
   */
  private async getRTMPUrl(streamName: string): Promise<string> {
    try {
      const endpoint = await this.getDataEndpoint(streamName, 'PUT_MEDIA');
      // RTMP URL格式: rtmp://endpoint/streamName
      return `rtmp://${endpoint.replace(/^https?:\/\//, '')}/${streamName}`;
    } catch (error) {
      console.warn('[AWS KVS] Failed to get RTMP URL:', error);
      return '';
    }
  }

  /**
   * 获取WebRTC URL
   */
  private async getWebRTCUrl(streamName: string): Promise<string> {
    try {
      // 获取信令通道endpoint
      const endpoint = await this.getDataEndpoint(streamName, 'GET_HLS_STREAMING_SESSION_URL');
      // WebRTC需要通过信令服务器建立连接
      return `${endpoint}/webrtc/${streamName}`;
    } catch (error) {
      console.warn('[AWS KVS] Failed to get WebRTC URL:', error);
      return '';
    }
  }

  /**
   * 停止推流
   */
  async stopStream(sessionId: string): Promise<void> {
    console.log(`[AWS KVS] Stopping stream: ${sessionId}`);

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // KVS的HLS会话会自动过期，这里只需要更新本地状态
    session.status = 'stopped';
    session.stoppedAt = new Date();
    session.updatedAt = new Date();

    // 清除缓存
    await this.redis.del(`stream:session:${sessionId}`);

    console.log(`[AWS KVS] Stream stopped: ${sessionId}`);
  }

  /**
   * 获取播放地址
   */
  async getPlaybackUrl(sessionId: string, protocol: StreamProtocol): Promise<string> {
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

    return this.getProtocolUrl(session, protocol);
  }

  /**
   * 根据协议获取播放地址
   */
  private getProtocolUrl(session: StreamSession, protocol: StreamProtocol): string {
    switch (protocol.toLowerCase()) {
      case 'hls':
        return session.hlsUrl || session.streamUrl;
      case 'rtmp':
        return session.rtmpUrl || '';
      case 'webrtc':
        return session.webrtcUrl || '';
      case 'rtsp':
        // KVS不直接支持RTSP，需要通过网关转换
        return session.streamUrl.replace('/hls/', '/rtsp/');
      case 'dash':
        return session.streamUrl.replace('/hls/', '/dash/');
      default:
        throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }

  /**
   * 开始录制
   */
  async startRecording(deviceId: string, config: RecordConfig): Promise<string> {
    console.log(`[AWS KVS] Starting recording for device: ${deviceId}`);

    const streamName = await this.getOrCreateStream(deviceId);
    const recordingId = IdGenerator.uuid();

    // 获取fragment selector
    const now = new Date();
    const startTime = new Date(now.getTime() - 60000); // 从1分钟前开始

    // 创建录制配置
    const recordingConfig = {
      recordingId,
      deviceId,
      streamName,
      startTime: config.startTime || startTime,
      format: config.format || 'mp4',
      status: 'recording',
      createdAt: now,
    };

    this.recordings.set(recordingId, recordingConfig);

    // 异步执行片段保存
    this.saveFragments(streamName, recordingId, recordingConfig);

    console.log(`[AWS KVS] Recording started: ${recordingId}`);
    return recordingId;
  }

  /**
   * 保存fragments（异步）
   */
  private async saveFragments(
    streamName: string,
    recordingId: string,
    config: any
  ): Promise<void> {
    try {
      const endpoint = await this.getDataEndpoint(streamName, 'GET_MEDIA');

      const client = new KinesisVideoArchivedMediaClient({
        endpoint,
        region: this.awsConfig?.region,
        credentials: this.awsConfig?.accessKeyId && this.awsConfig?.secretAccessKey ? {
          accessKeyId: this.awsConfig?.accessKeyId,
          secretAccessKey: this.awsConfig?.secretAccessKey,
        } : undefined,
      });

      // 获取fragments
      const fragments = await client.send(new ListFragmentsCommand({
        StreamName: streamName,
        FragmentSelector: {
          FragmentSelectorType: 'SERVER_TIMESTAMP',
          TimestampRange: {
            StartTimestamp: config.startTime,
            EndTimestamp: new Date(),
          },
        },
        MaxResults: 1000,
      }));

      if (fragments.Fragments) {
        console.log(
          `[AWS KVS] Found ${fragments.Fragments.length} fragments to save`
        );

        // 下载并合并fragments（这里需要额外实现MP4封装逻辑）
        // 实际项目中建议使用AWS KVS产生的MP4直接存储到S3
      }
    } catch (error) {
      console.error('[AWS KVS] Failed to save fragments:', error);
    }
  }

  /**
   * 停止录制
   */
  async stopRecording(recordingId: string): Promise<void> {
    console.log(`[AWS KVS] Stopping recording: ${recordingId}`);

    const recording = this.recordings.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    recording.status = 'completed';
    recording.stoppedAt = new Date();

    console.log(`[AWS KVS] Recording stopped: ${recordingId}`);
  }

  /**
   * 获取录制列表
   */
  async getRecordings(
    deviceId: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<
    Array<{
      recordingId: string;
      deviceId: string;
      startTime: Date;
      endTime?: Date;
      duration?: number;
      format: string;
      status: string;
      url?: string;
    }>
  > {
    const streamName = this.getStreamName(deviceId);
    const endpoint = await this.getDataEndpoint(streamName, 'GET_MEDIA');

    const client = new KinesisVideoArchivedMediaClient({
      endpoint,
      region: this.awsConfig?.region,
      credentials: this.awsConfig?.accessKeyId && this.awsConfig?.secretAccessKey ? {
        accessKeyId: this.awsConfig?.accessKeyId,
        secretAccessKey: this.awsConfig?.secretAccessKey,
      } : undefined,
    });

    const list: any[] = [];

    try {
      const fragments = await client.send(new ListFragmentsCommand({
        StreamName: streamName,
        FragmentSelector: {
          FragmentSelectorType: 'SERVER_TIMESTAMP',
          TimestampRange: {
            StartTimestamp: startTime || new Date(Date.now() - 86400000),
            EndTimestamp: endTime || new Date(),
          },
        },
      }));

      if (fragments.Fragments) {
        // 按时间段分组fragments，形成录制记录
        const grouped = this.groupFragmentsByTime(fragments.Fragments);
        for (const group of grouped) {
          list.push({
            recordingId: IdGenerator.uuid(),
            deviceId,
            startTime: group.start,
            endTime: group.end,
            duration: (group.end.getTime() - group.start.getTime()) / 1000,
            format: 'mp4',
            status: 'completed',
            url: await this.getFragmentURL(streamName, group.firstFragment),
          });
        }
      }
    } catch (error) {
      console.error('[AWS KVS] Failed to get recordings:', error);
    }

    return list;
  }

  /**
   * 按时间分组fragments
   */
  private groupFragmentsByTime(
    fragments: Array<{ FragmentNumber: string; ProducerTimestamp?: Date }>
  ): Array<{ start: Date; end: Date; firstFragment: string }> {
    const groups: Array<{
      start: Date;
      end: Date;
      firstFragment: string;
    }> = [];
    let currentGroup: any = null;
    const gapThreshold = 60000; // 1分钟间隔视为新录制

    for (const fragment of fragments) {
      const fragmentTime = fragment.FragmentNumber;

      if (!currentGroup) {
        currentGroup = {
          start: fragment.ProducerTimestamp || new Date(),
          end: fragment.ProducerTimestamp || new Date(),
          firstFragment: fragment.FragmentNumber,
        };
      } else {
        const timeDiff =
          (fragment.ProducerTimestamp?.getTime() || 0) -
          currentGroup.end.getTime();

        if (timeDiff > gapThreshold) {
          // 新的录制
          groups.push(currentGroup);
          currentGroup = {
            start: fragment.ProducerTimestamp || new Date(),
            end: fragment.ProducerTimestamp || new Date(),
            firstFragment: fragment.FragmentNumber,
          };
        } else {
          // 继续当前录制
          currentGroup.end = fragment.ProducerTimestamp || new Date();
        }
      }
    }

    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * 获取fragment URL
   */
  private async getFragmentURL(
    streamName: string,
    fragmentNumber: string
  ): Promise<string> {
    const endpoint = await this.getDataEndpoint(streamName, 'GET_MEDIA');

    const client = new KinesisVideoArchivedMediaClient({
      endpoint,
      region: this.awsConfig?.region,
      credentials: this.awsConfig?.accessKeyId && this.awsConfig?.secretAccessKey ? {
        accessKeyId: this.awsConfig?.accessKeyId,
        secretAccessKey: this.awsConfig?.secretAccessKey,
      } : undefined,
    });

    const result = await client.send(new GetClipCommand({
      StreamName: streamName,
      FragmentNumber: fragmentNumber,
    }));

    return result.Payload?.transformToByteArray().then(() => endpoint) || '';
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      // 检查KVS连接
      await this.kvsVideo.send(new ListStreamsCommand({}));
      return true;
    } catch (error) {
      console.error('[AWS KVS] Health check failed:', error);
      return false;
    }
  }

  /**
   * 获取stream状态
   */
  async getStreamStatus(streamName: string): Promise<{
    status: string;
    creationTime?: Date;
    retentionPeriod?: number;
  }> {
    try {
      const result = await this.kvsVideo.send(new DescribeStreamCommand({ StreamName: streamName }));

      return {
        status: result.StreamInfo?.Status || 'UNKNOWN',
        creationTime: result.StreamInfo?.CreationTime,
        retentionPeriod: result.StreamInfo?.RetentionPeriodHours,
      };
    } catch (error) {
      return { status: 'NOT_FOUND' };
    }
  }

  /**
   * 缓存会话
   */
  private async cacheSession(session: StreamSession): Promise<void> {
    await this.redis.set(
      `stream:session:${session.id}`,
      JSON.stringify(session),
      'EX',
      3600
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
    const maxAge = 3600000; // 1小时

    for (const [id, session] of this.sessions.entries()) {
      const age = now - new Date(session.createdAt).getTime();
      if (age > maxAge) {
        this.sessions.delete(id);
        await this.redis.del(`stream:session:${id}`);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[AWS KVS] Cleaned up ${cleaned} expired sessions`);
    }

    return cleaned;
  }

  /**
   * 获取流统计信息
   */
  async getStreamStats(sessionId: string): Promise<{
    viewers: number;
    bitrate: number;
    fps: number;
    uptime: number;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // 从Redis获取统计数据
    const statsKey = `stream:stats:${sessionId}`;
    const stats = await this.redis.hgetall(statsKey);

    return {
      viewers: parseInt(stats.viewers || '0'),
      bitrate: parseInt(stats.bitrate || '0'),
      fps: parseInt(stats.fps || '0'),
      uptime: Date.now() - new Date(session.createdAt).getTime(),
    };
  }

  /**
   * 更新流统计信息
   */
  async updateStreamStats(
    sessionId: string,
    stats: Partial<{
      viewers: number;
      bitrate: number;
      fps: number;
    }>
  ): Promise<void> {
    const statsKey = `stream:stats:${sessionId}`;
    await this.redis.hmset(statsKey, stats as any);
    await this.redis.expire(statsKey, 3600);
  }

  /**
   * 辅助方法：休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 直接获取设备播放地址
   *
   * 用于设备已持续推流的场景，直接获取播放地址而无需创建 session
   * 适用于 App 随时接入观看实时画面的场景
   *
   * @param deviceId - 设备ID
   * @returns 播放地址信息
   */
  async getDirectPlaybackUrl(deviceId: string): Promise<DirectPlaybackInfo> {
    console.log(`[AWS KVS] Getting direct playback URL for device: ${deviceId}`);

    const streamName = this.getStreamName(deviceId);
    const now = new Date();

    try {
      // 1. 检查 stream 是否存在
      let streamExists = false;
      try {
        const describeResult = await this.kvsVideo.send(
          new DescribeStreamCommand({ StreamName: streamName })
        );
        streamExists = describeResult.StreamInfo?.Status === 'ACTIVE';
        console.log(`[AWS KVS] Stream ${streamName} status: ${describeResult.StreamInfo?.Status}`);
      } catch (error: any) {
        if (error.name === 'ResourceNotFoundException' || error.$metadata?.httpStatusCode === 404) {
          console.log(`[AWS KVS] Stream ${streamName} not found, device may not be streaming`);
          streamExists = false;
        } else {
          throw error;
        }
      }

      if (!streamExists) {
        // Stream 不存在，返回空地址但标记为未推流
        return {
          hlsUrl: '',
          rtmpUrl: '',
          webrtcUrl: '',
          flvUrl: '',
          streamName,
          provider: StreamProviderType.AWS_KVS,
          deviceId,
          expiresAt: now,
          isStreaming: false,
        };
      }

      // 2. 获取 HLS 数据端点
      const hlsEndpoint = await this.getDataEndpoint(streamName, 'GET_HLS_STREAMING_SESSION_URL');

      // 3. 创建 HLS 客户端
      const hlsClient = new KinesisVideoArchivedMediaClient({
        endpoint: hlsEndpoint,
        region: this.awsConfig?.region,
        credentials: this.awsConfig?.accessKeyId && this.awsConfig?.secretAccessKey ? {
          accessKeyId: this.awsConfig.accessKeyId,
          secretAccessKey: this.awsConfig.secretAccessKey,
        } : undefined,
      });

      // 4. 获取 HLS 会话 URL（LIVE 实时模式）
      const hlsSession = await hlsClient.send(new GetHLSStreamingSessionURLCommand({
        StreamName: streamName,
        PlaybackMode: 'LIVE',  // 实时播放模式
        HLSFragmentSelector: {
          FragmentSelectorType: 'SERVER_TIMESTAMP',
        },
        // 使用 MPEG_TS 格式，比 FRAGMENTED_MP4 兼容性更好
        // fMP4 在某些浏览器/编码组合下会导致 bufferAppendError
        ContainerFormat: 'MPEG_TS',
        DisplayFragmentTimestamp: 'ALWAYS',
        MaxMediaPlaylistFragmentResults: 30,  // 增加片段数量，提供更大缓冲窗口
        MaxPlaylistFragmentResults: 100,      // 新增：控制m3u8总片段数
        HLSFragmentSize: 2,                   // 新增：片段时长2秒（更小的片段=更快容错）
        Expires: 3600,  // URL 有效期 1 小时
      }));

      const hlsUrl = hlsSession.HLSStreamingSessionURL || '';

      // 5. 获取其他协议地址
      const rtmpUrl = await this.getRTMPUrl(streamName);
      const webrtcUrl = await this.getWebRTCUrl(streamName);

      console.log(`[AWS KVS] Got direct playback URL for device ${deviceId}, HLS URL length: ${hlsUrl.length}`);

      return {
        hlsUrl,
        rtmpUrl,
        webrtcUrl,
        flvUrl: '',  // KVS 不直接支持 FLV
        streamName,
        provider: StreamProviderType.AWS_KVS,
        deviceId,
        expiresAt: new Date(now.getTime() + 3600 * 1000),  // 1小时后过期
        isStreaming: true,
      };
    } catch (error: any) {
      console.error(`[AWS KVS] Failed to get direct playback URL: ${error.message}`);

      // 返回错误信息
      return {
        hlsUrl: '',
        rtmpUrl: '',
        webrtcUrl: '',
        flvUrl: '',
        streamName,
        provider: StreamProviderType.AWS_KVS,
        deviceId,
        expiresAt: now,
        isStreaming: false,
      };
    }
  }

  /**
   * 检查设备是否正在推流
   *
   * @param deviceId - 设备ID
   * @returns 是否正在推流
   */
  async isDeviceStreaming(deviceId: string): Promise<boolean> {
    const streamName = this.getStreamName(deviceId);

    try {
      // 检查缓存
      if (this.streamCache.has(streamName)) {
        return true;
      }

      // 查询 AWS KVS 获取 stream 状态
      const result = await this.kvsVideo.send(
        new DescribeStreamCommand({ StreamName: streamName })
      );

      const isActive = result.StreamInfo?.Status === 'ACTIVE';

      if (isActive) {
        // 更新缓存
        this.streamCache.set(streamName, streamName);
      }

      return isActive;
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      console.error(`[AWS KVS] Failed to check streaming status: ${error.message}`);
      return false;
    }
  }

  /**
   * 销毁资源
   */
  async destroy(): Promise<void> {
    this.sessions.clear();
    this.recordings.clear();
    this.streamCache.clear();
    console.log('[AWS KVS] Provider destroyed');
  }
}
