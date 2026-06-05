import { Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { BaseSubscriber, SubscriptionConfig, JsonUtil } from '@baby-monitor/shared-utils';
import { StreamService } from '../service/stream.service';
import { StreamProviderType, DeviceTripleInfo, CloudProvider } from '@baby-monitor/shared-types';
import Redis from 'ioredis';

/**
 * Redis请求频道
 */
const REQUEST_CHANNEL = 'stream:create:request';

/**
 * Redis响应频道前缀
 */
const RESPONSE_CHANNEL_PREFIX = 'stream:create:response:';

/**
 * 创建流请求消息
 */
export interface StreamCreateRequestMessage {
  /** 请求关联ID */
  correlationId: string;
  /** 设备ID */
  deviceId: string;
  /** 云服务商 */
  cloudProvider: CloudProvider;
  /** 请求时间戳 */
  timestamp: number;
}

/**
 * 创建流响应消息
 */
export interface StreamCreateResponseMessage {
  /** 对应的请求关联ID */
  correlationId: string;
  /** 是否成功 */
  success: boolean;
  /** 流名称 */
  streamName?: string;
  /** 是否是新创建的 */
  created?: boolean;
  /** 提供者 */
  provider?: string;
  /** IoT Video 设备三元组信息（仅 cloudProvider=2 时返回） */
  tripleInfo?: DeviceTripleInfo;
  /** 错误消息 */
  error?: string;
  /** 响应时间戳 */
  timestamp: number;
}

/**
 * 流创建订阅器
 *
 * 监听设备注册时的流创建请求
 *
 * 订阅频道：
 * - stream:create:request - 流创建请求
 *
 * 响应频道：
 * - stream:create:response:{correlationId} - 流创建响应
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class StreamCreateSubscriber extends BaseSubscriber {
  private streamService!: StreamService;

  /**
   * 获取Redis客户端
   */
  private get redisClient(): Redis {
    return this.pool.getPublisher();
  }

  /**
   * 设置StreamService（由configuration调用）
   */
  setStreamService(service: StreamService): void {
    this.streamService = service;
  }

  /**
   * 获取订阅配置
   */
  getSubscriptionConfig(): SubscriptionConfig {
    return {
      channels: [REQUEST_CHANNEL],
    };
  }

  /**
   * 处理接收到的消息
   */
  async handleMessage(channel: string, message: string): Promise<void> {
    if (channel !== REQUEST_CHANNEL) {
      return;
    }

    if (!this.streamService) {
      this.logger.error('[StreamCreateSubscriber] StreamService not initialized');
      return;
    }

    await this.handleCreateRequest(message);
  }

  /**
   * 处理流创建请求
   */
  private async handleCreateRequest(messageStr: string): Promise<void> {
    let request: StreamCreateRequestMessage;

    try {
      request = JsonUtil.parse<StreamCreateRequestMessage>(messageStr);
      if (!request || !request.correlationId || !request.deviceId) {
        this.logger.error('[StreamCreateSubscriber] Invalid request message');
        return;
      }

      this.logger.info(
        `[StreamCreateSubscriber] Processing stream create request: deviceId=${request.deviceId}, correlationId=${request.correlationId}`
      );

      // 确定提供者类型
      let providerType: StreamProviderType;
      if (request.cloudProvider === CloudProvider.AWS) {
        providerType = StreamProviderType.AWS_KVS;
      } else if (request.cloudProvider === CloudProvider.TENCENT) {
        providerType = StreamProviderType.IOT_VIDEO;
      } else if (request.cloudProvider === CloudProvider.RJI) {
        providerType = StreamProviderType.WEBRTC;
      } else {
        throw new Error(`Unsupported cloud provider: ${request.cloudProvider}`);
      }
      // const providerType = request.cloudProvider === CloudProvider.AWS
      //   ? StreamProviderType.AWS_KVS
      //   : StreamProviderType.IOT_VIDEO;

      // 调用StreamService创建流
      const result = await this.streamService.ensureDeviceStream(request.deviceId, providerType);

      // 构建响应
      const response: StreamCreateResponseMessage = {
        correlationId: request.correlationId,
        success: true,
        streamName: result.streamName,
        created: result.created,
        provider: result.provider,
        tripleInfo: (result as any)?.tripleInfo,  // IoT Video 设备三元组信息
        timestamp: Date.now(),
      };

      // 发布响应
      await this.publishResponse(request.correlationId, response);

      this.logger.info(
        `[StreamCreateSubscriber] Stream ${result.created ? 'created' : 'exists'}: ${result.streamName} for device: ${request.deviceId}`
      );
    } catch (error: any) {
      this.logger.error('[StreamCreateSubscriber] Error handling request:', error);

      // 发送错误响应
      if (request?.correlationId) {
        const errorResponse: StreamCreateResponseMessage = {
          correlationId: request.correlationId,
          success: false,
          error: error.message || 'Failed to create stream',
          timestamp: Date.now(),
        };
        await this.publishResponse(request.correlationId, errorResponse);
      }
    }
  }

  /**
   * 发布响应到Redis
   */
  private async publishResponse(
    correlationId: string,
    response: StreamCreateResponseMessage
  ): Promise<void> {
    try {
      const channel = `${RESPONSE_CHANNEL_PREFIX}${correlationId}`;
      await this.redisClient.publish(channel, JsonUtil.stringify(response));
      this.logger.debug(
        `[StreamCreateSubscriber] Published response: correlationId=${correlationId}, success=${response.success}`
      );
    } catch (error) {
      this.logger.error('[StreamCreateSubscriber] Error publishing response:', error);
    }
  }
}
