/**
 * 设备 Provider 解析器
 *
 * 根据 deviceId 自动解析设备所属的云平台，映射为对应的 StreamProvider / StorageProvider。
 * 使用 Redis 缓存 + ServiceClient 查询 device-service，避免重复查询。
 *
 * 映射关系：
 *   CloudProvider.AWS(1)     → StreamProviderType.AWS_KVS,   StorageProviderType.AWS_S3
 *   CloudProvider.TENCENT(2) → StreamProviderType.IOT_VIDEO, StorageProviderType.TENCENT_COS
 *   CloudProvider.RJI(3)     → StreamProviderType.WEBRTC,   StorageProviderType.MINIO
 */
import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { ServiceClient } from './service-client';
import { CacheManager } from '../cache/cache-manager';
import { CacheKeyBuilder, CacheTTL } from '../cache/cache.constants';

@Provide()
@Scope(ScopeEnum.Singleton)
export class DeviceProviderResolver {
  @Inject()
  serviceClient!: ServiceClient;

  @Inject()
  cacheManager!: CacheManager;

  @Inject()
  logger!: ILogger;

  /**
   * 解析设备的流媒体 Provider 类型
   */
  async resolveStreamProvider(deviceId: string): Promise<string> {
    const cloudProvider = await this.getDeviceCloudProvider(deviceId);
    return this.mapCloudToStreamProvider(cloudProvider);
  }

  /**
   * 解析设备的存储 Provider 类型
   */
  async resolveStorageProvider(deviceId: string): Promise<string> {
    const cloudProvider = await this.getDeviceCloudProvider(deviceId);
    return this.mapCloudToStorageProvider(cloudProvider);
  }

  /**
   * 获取设备的 cloudProvider，带 Redis 缓存
   */
  private async getDeviceCloudProvider(deviceId: string): Promise<number> {
    const cacheKey = CacheKeyBuilder.deviceProvider(deviceId);

    // 1. 查缓存
    const cached = await this.cacheManager.get<number>(cacheKey);
    if (cached.hit && cached.data !== undefined) {
      return cached.data;
    }

    // 2. 查 device-service
    try {
      const response = await this.serviceClient.get<{ cloudProvider: number }>(
        'device-service',
        `/api/devices/${deviceId}`
      );

      if (response.success && response.data?.cloudProvider !== undefined) {
        const cloudProvider = response.data.cloudProvider;
        await this.cacheManager.set(cacheKey, cloudProvider, CacheTTL.DEVICE_PROVIDER);
        return cloudProvider;
      }
    } catch (error) {
      this.logger.warn(
        `[DeviceProviderResolver] Failed to query device-service for ${deviceId}, using default`,
        error
      );
    }

    // 3. 降级：返回默认值 3 (RJI)
    return 3;
  }

  private mapCloudToStreamProvider(cloudProvider: number): string {
    switch (cloudProvider) {
      case 1: return 'aws_kvs';
      case 2: return 'iot_video';
      case 3: return 'webrtc';
      default: return 'webrtc';
    }
  }

  private mapCloudToStorageProvider(cloudProvider: number): string {
    switch (cloudProvider) {
      case 1: return 'aws_s3';
      case 2: return 'tencent_cos';
      case 3: return 'minio';
      default: return 'minio';
    }
  }
}
