import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { JsonUtil, ServiceClient } from '@baby-monitor/shared-utils';
import { GatewayCoreService } from './gateway-core.service';

/**
 * 日志网关服务
 * 桥接 MQTT 消息与 storage-service HTTP API
 * 设备通过 MQTT 请求日志上传URL，本服务转发给 storage-service 获取预签名URL后回复设备
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class LogGatewayService {
  @Inject() logger!: ILogger;
  @Inject() serviceClient!: ServiceClient;

  // 延迟获取 GatewayCoreService 以避免循环依赖
  private gatewayCoreInstance?: GatewayCoreService;

  get gatewayCore(): GatewayCoreService | undefined {
    return this.gatewayCoreInstance;
  }

  setGatewayCore(instance: GatewayCoreService): void {
    this.gatewayCoreInstance = instance;
  }

  private readonly STORAGE_SERVICE = 'storage-service';

  /**
   * 处理设备请求日志上传URL
   */
  async handleUploadUrlRequest(deviceId: string, message: any): Promise<void> {
    try {
      const response = await this.serviceClient.post(
        this.STORAGE_SERVICE,
        '/api/storage/device-logs/upload-url',
        {
          deviceId,
          requestId: message.requestId,
          estimatedSize: message.estimatedSize,
          logType: message.logType,
          description: message.description,
        },
      );

      if (response && response.code === 0 && response.data) {
        await this.gatewayCore?.publish(
          `devices/${deviceId}/logs/upload-url/response`,
          JsonUtil.stringify(response.data),
          1,
        );
      } else {
        await this.publishError(deviceId, message.requestId, 'upload-url', response?.message || '请求日志上传URL失败');
      }
    } catch (error: any) {
      this.logger.error('[Log Gateway] 请求日志上传URL失败:', error);
      await this.publishError(deviceId, message.requestId, 'upload-url', error.message);
    }
  }

  /**
   * 处理设备确认日志上传完成
   */
  async handleRegisterRequest(deviceId: string, message: any): Promise<void> {
    try {
      const response = await this.serviceClient.post(
        this.STORAGE_SERVICE,
        '/api/storage/device-logs/register',
        {
          deviceId,
          requestId: message.requestId,
          logId: message.logId,
          fileKey: message.fileKey,
          fileSize: message.fileSize,
        },
      );

      if (response && response.code === 0 && response.data) {
        await this.gatewayCore?.publish(
          `devices/${deviceId}/logs/register/response`,
          JsonUtil.stringify(response.data),
          1,
        );
      } else {
        await this.publishError(deviceId, message.requestId, 'register', response?.message || '注册日志失败');
      }
    } catch (error: any) {
      this.logger.error('[Log Gateway] 注册日志失败:', error);
      await this.publishError(deviceId, message.requestId, 'register', error.message);
    }
  }

  /**
   * 处理设备上报日志打捞状态（转发到 device-service）
   */
  async handleCollectStatus(deviceId: string, message: any): Promise<void> {
    try {
      if (this.gatewayCore) {
        await this.gatewayCore.publishToService('device-service', {
          type: 'log.collect_status',
          data: {
            ...message,
            deviceId,
            _meta: {
              timestamp: Date.now(),
              source: 'device-gateway',
            },
          },
        });
      }
    } catch (error: any) {
      this.logger.error('[Log Gateway] 转发日志打捞状态失败:', error);
    }
  }

  /**
   * 发布错误响应给设备
   */
  private async publishError(
    deviceId: string,
    requestId: string,
    topic: string,
    errorMessage: string,
  ): Promise<void> {
    await this.gatewayCore?.publish(
      `devices/${deviceId}/logs/${topic}/response`,
      JsonUtil.stringify({ success: false, requestId, error: errorMessage }),
      1,
    );
  }
}
