import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { JsonUtil, ServiceClient } from '@baby-monitor/shared-utils';
import { GatewayCoreService } from '../core/gateway-core.service';

/**
 * 录像网关服务
 * 桥接 MQTT 消息与 storage-service HTTP API
 * 摄像头通过 MQTT 请求上传URL，本服务转发给 storage-service 获取预签名URL后回复摄像头
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class RecordingGatewayService {
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
   * 处理摄像头请求上传URL
   */
  async handleUploadUrlRequest(deviceId: string, message: any): Promise<void> {
    try {
      const response = await this.serviceClient.post(
        this.STORAGE_SERVICE,
        '/api/storage/recordings/upload-url',
        {
          deviceId,
          requestId: message.requestId,
          estimatedSize: message.estimatedSize,
          contentType: message.contentType,
          startTime: message.startTime,
        },
      );

      if (response && response.code === 0 && response.data) {
        await this.gatewayCore?.publish(
          `devices/${deviceId}/recording/upload-url/response`,
          JsonUtil.stringify(response.data),
          1,
        );
      } else {
        await this.publishError(deviceId, message.requestId, 'upload-url', response?.message || '请求上传URL失败');
      }
    } catch (error: any) {
      this.logger.error('[Recording Gateway] 请求上传URL失败:', error);
      await this.publishError(deviceId, message.requestId, 'upload-url', error.message);
    }
  }

  /**
   * 处理摄像头发起分片上传
   */
  async handleMultipartStartRequest(deviceId: string, message: any): Promise<void> {
    try {
      const response = await this.serviceClient.post(
        this.STORAGE_SERVICE,
        '/api/storage/recordings/multipart/start',
        {
          deviceId,
          requestId: message.requestId,
          estimatedSize: message.estimatedSize,
          partCount: message.partCount,
          contentType: message.contentType,
          startTime: message.startTime,
        },
      );

      if (response && response.code === 0 && response.data) {
        await this.gatewayCore?.publish(
          `devices/${deviceId}/recording/multipart/start/response`,
          JsonUtil.stringify(response.data),
          1,
        );
      } else {
        await this.publishError(deviceId, message.requestId, 'multipart/start', response?.message || '发起分片上传失败');
      }
    } catch (error: any) {
      this.logger.error('[Recording Gateway] 发起分片上传失败:', error);
      await this.publishError(deviceId, message.requestId, 'multipart/start', error.message);
    }
  }

  /**
   * 处理摄像头完成分片上传
   */
  async handleMultipartCompleteRequest(deviceId: string, message: any): Promise<void> {
    try {
      const response = await this.serviceClient.post(
        this.STORAGE_SERVICE,
        '/api/storage/recordings/multipart/complete',
        {
          deviceId,
          requestId: message.requestId,
          recordingId: message.recordingId,
          uploadId: message.uploadId,
          parts: message.parts,
          fileSize: message.fileSize,
          endTime: message.endTime,
        },
      );

      if (response && response.code === 0 && response.data) {
        await this.gatewayCore?.publish(
          `devices/${deviceId}/recording/multipart/complete/response`,
          JsonUtil.stringify(response.data),
          1,
        );
      } else {
        await this.publishError(deviceId, message.requestId, 'multipart/complete', response?.message || '完成分片上传失败');
      }
    } catch (error: any) {
      this.logger.error('[Recording Gateway] 完成分片上传失败:', error);
      await this.publishError(deviceId, message.requestId, 'multipart/complete', error.message);
    }
  }

  /**
   * 处理摄像头确认单次上传完成
   */
  async handleRegisterRequest(deviceId: string, message: any): Promise<void> {
    try {
      const response = await this.serviceClient.post(
        this.STORAGE_SERVICE,
        '/api/storage/recordings/register',
        {
          deviceId,
          requestId: message.requestId,
          fileKey: message.fileKey,
          fileSize: message.fileSize,
          endTime: message.endTime,
        },
      );

      if (response && response.code === 0 && response.data) {
        await this.gatewayCore?.publish(
          `devices/${deviceId}/recording/register/response`,
          JsonUtil.stringify(response.data),
          1,
        );
      } else {
        await this.publishError(deviceId, message.requestId, 'register', response?.message || '注册录像失败');
      }
    } catch (error: any) {
      this.logger.error('[Recording Gateway] 注册录像失败:', error);
      await this.publishError(deviceId, message.requestId, 'register', error.message);
    }
  }

  /**
   * 处理摄像头批量请求上传URL（连续录制场景）
   */
  async handleBatchUploadUrlRequest(deviceId: string, message: any): Promise<void> {
    try {
      const response = await this.serviceClient.post(
        this.STORAGE_SERVICE,
        '/api/storage/recordings/upload-url/batch',
        {
          deviceId,
          requestId: message.requestId,
          planId: message.planId,
          segmentDuration: message.segmentDuration,
          segmentCount: message.segmentCount,
          startSegmentIndex: message.startSegmentIndex,
          startTime: message.startTime,
          contentType: message.contentType,
        },
      );

      if (response && response.code === 0 && response.data) {
        await this.gatewayCore?.publish(
          `devices/${deviceId}/recording/upload-url/batch/response`,
          JsonUtil.stringify(response.data),
          1,
        );
      } else {
        await this.publishError(deviceId, message.requestId, 'upload-url/batch', response?.message || '批量请求上传URL失败');
      }
    } catch (error: any) {
      this.logger.error('[Recording Gateway] 批量请求上传URL失败:', error);
      await this.publishError(deviceId, message.requestId, 'upload-url/batch', error.message);
    }
  }

  /**
   * 处理摄像头批量确认上传完成
   */
  async handleBatchRegisterRequest(deviceId: string, message: any): Promise<void> {
    try {
      const response = await this.serviceClient.post(
        this.STORAGE_SERVICE,
        '/api/storage/recordings/register/batch',
        {
          deviceId,
          requestId: message.requestId,
          planId: message.planId,
          completedSegments: message.completedSegments,
        },
      );

      if (response && response.code === 0 && response.data) {
        await this.gatewayCore?.publish(
          `devices/${deviceId}/recording/register/batch/response`,
          JsonUtil.stringify(response.data),
          1,
        );
      } else {
        await this.publishError(deviceId, message.requestId, 'register/batch', response?.message || '批量注册录像失败');
      }
    } catch (error: any) {
      this.logger.error('[Recording Gateway] 批量注册录像失败:', error);
      await this.publishError(deviceId, message.requestId, 'register/batch', error.message);
    }
  }

  /**
   * 发布错误响应给摄像头
   */
  private async publishError(
    deviceId: string,
    requestId: string,
    topic: string,
    errorMessage: string,
  ): Promise<void> {
    await this.gatewayCore?.publish(
      `devices/${deviceId}/recording/${topic}/response`,
      JsonUtil.stringify({ success: false, requestId, error: errorMessage }),
      1,
    );
  }
}
