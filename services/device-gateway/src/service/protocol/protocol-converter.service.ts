import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { CacheManager } from '@baby-monitor/shared-utils';
import { DeviceProtocol, ProductType } from '@baby-monitor/shared-types';

/**
 * 统一设备状态
 */
export interface UnifiedDeviceState {
  deviceId: string;
  online: boolean;
  properties: Record<string, any>;
  capabilities: string[];
  lastUpdated: number;
}

/**
 * Matter设备状态
 */
export interface MatterDeviceState {
  nodeId: number;
  endpoint: number;
  clusters: Array<{
    id: number;
    attributes: Record<number, any>;
  }>;
}

/**
 * 私有协议设备状态
 */
export interface PrivateDeviceState {
  serialNumber: string;
  firmwareVersion: string;
  status: string;
  metrics: Record<string, any>;
}

/**
 * 协议转换映射
 */
export interface ProtocolMapping {
  sourceProtocol: DeviceProtocol;
  targetProtocol: DeviceProtocol;
  propertyMappings: Record<string, string>;
  capabilityMappings: Record<string, string>;
  commandMappings: Record<string, string>;
}

/**
 * 转换结果
 */
export interface ConversionResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * 协议转换服务
 *
 * 提供不同协议之间的数据格式转换功能：
 * - 私有协议与Matter协议之间的双向转换
 * - 设备命令的协议转换
 * - 批量状态转换
 * - 协议映射管理
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class ProtocolConverterService {
  @Inject()
  logger!: ILogger;

  @Inject()
  cacheManager!: CacheManager;

  private readonly MAPPING_PREFIX = 'protocol:mapping:';
  private readonly CACHE_PREFIX = 'protocol:cache:';
  private readonly CACHE_TTL = 3600; // 1小时

  /**
   * 私有协议转Matter协议
   *
   * @param deviceId 设备ID
   * @param privateState 私有协议设备状态
   * @param targetNodeType 目标设备产品类型
   */
  async privateToMatter(
    deviceId: string,
    privateState: PrivateDeviceState,
    targetNodeType: ProductType
  ): Promise<ConversionResult> {
    try {
      const matterState: MatterDeviceState = {
        nodeId: await this.generateNodeId(deviceId),
        endpoint: 1,
        clusters: [],
      };

      const clusters = this.getClustersForProductType(targetNodeType);

      for (const cluster of clusters) {
        const clusterData: any = {
          id: cluster,
          attributes: {},
        };

        switch (cluster) {
          case 0x0006: // On/Off Cluster
            if (privateState.status === 'online') {
              clusterData.attributes[0x0000] = privateState.metrics?.power === 'on';
            }
            break;

          case 0x0008: // Level Control Cluster
            if (privateState.metrics?.brightness !== undefined) {
              clusterData.attributes[0x0000] = Math.round(privateState.metrics.brightness);
            }
            break;

          case 0x0300: // Color Control Cluster
            if (privateState.metrics?.color) {
              clusterData.attributes[0x0007] = this.hexToColorTemperature(privateState.metrics.color);
            }
            break;

          case 0x0402: // Temperature Measurement Cluster
            if (privateState.metrics?.temperature !== undefined) {
              clusterData.attributes[0x0000] = Math.round(privateState.metrics.temperature * 100);
            }
            break;

          case 0x0405: // Relative Humidity Measurement Cluster
            if (privateState.metrics?.humidity !== undefined) {
              clusterData.attributes[0x0000] = Math.round(privateState.metrics.humidity * 100);
            }
            break;

          case 0x0101: // Door Lock Cluster
            if (privateState.metrics?.locked !== undefined) {
              clusterData.attributes[0x0000] = privateState.metrics.locked ? 1 : 0;
            }
            break;

          case 0x0102: // Window Covering Cluster
            if (privateState.metrics?.position !== undefined) {
              clusterData.attributes[0x0002] = Math.round(privateState.metrics.position);
            }
            break;
        }

        matterState.clusters.push(clusterData);
      }

      return { success: true, data: matterState };
    } catch (error) {
      this.logger.error('[Protocol Converter] Private to Matter conversion failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Matter协议转私有协议
   */
  async matterToPrivate(
    nodeId: number,
    matterState: MatterDeviceState
  ): Promise<ConversionResult> {
    try {
      const deviceId = await this.getDeviceIdByNodeId(nodeId);

      const privateState: PrivateDeviceState = {
        serialNumber: deviceId,
        firmwareVersion: '1.0.0',
        status: 'online',
        metrics: {},
      };

      for (const cluster of matterState.clusters) {
        switch (cluster.id) {
          case 0x0006: // On/Off
            privateState.metrics.power = cluster.attributes[0x0000] ? 'on' : 'off';
            break;

          case 0x0008: // Level Control
            privateState.metrics.brightness = cluster.attributes[0x0000];
            break;

          case 0x0300: // Color Control
            privateState.metrics.color = this.colorTemperatureToHex(cluster.attributes[0x0007]);
            break;

          case 0x0402: // Temperature Measurement
            privateState.metrics.temperature = cluster.attributes[0x0000] / 100;
            break;

          case 0x0405: // Relative Humidity Measurement
            privateState.metrics.humidity = cluster.attributes[0x0000] / 100;
            break;

          case 0x0101: // Door Lock
            privateState.metrics.locked = cluster.attributes[0x0000] === 1;
            break;

          case 0x0102: // Window Covering
            privateState.metrics.position = cluster.attributes[0x0002];
            break;
        }
      }

      return { success: true, data: privateState };
    } catch (error) {
      this.logger.error('[Protocol Converter] Matter to Private conversion failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 转换设备命令
   */
  async convertCommand(
    sourceProtocol: DeviceProtocol,
    targetProtocol: DeviceProtocol,
    command: any
  ): Promise<ConversionResult> {
    try {
      if (sourceProtocol === targetProtocol) {
        return { success: true, data: command };
      }

      if (sourceProtocol === DeviceProtocol.PRIVATE && targetProtocol === DeviceProtocol.MATTER) {
        return this.convertPrivateToMatterCommand(command);
      }

      if (sourceProtocol === DeviceProtocol.MATTER && targetProtocol === DeviceProtocol.PRIVATE) {
        return this.convertMatterToPrivateCommand(command);
      }

      return { success: false, error: 'Unsupported protocol conversion' };
    } catch (error) {
      this.logger.error('[Protocol Converter] Command conversion failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 私有协议命令转Matter命令
   */
  private async convertPrivateToMatterCommand(command: any): Promise<ConversionResult> {
    const matterCommand: any = {
      nodeId: await this.generateNodeId(command.deviceId),
      endpoint: 1,
    };

    switch (command.action) {
      case 'setPower':
        matterCommand.cluster = 0x0006;
        matterCommand.command = command.value ? 0x0001 : 0x0000;
        break;

      case 'setBrightness':
        matterCommand.cluster = 0x0008;
        matterCommand.command = 0x0000;
        matterCommand.payload = { level: command.value };
        break;

      case 'setColor':
        matterCommand.cluster = 0x0300;
        matterCommand.command = 0x0004;
        matterCommand.payload = { colorTemperature: this.hexToColorTemperature(command.value) };
        break;

      case 'lock':
        matterCommand.cluster = 0x0101;
        matterCommand.command = 0x0000;
        break;

      case 'unlock':
        matterCommand.cluster = 0x0101;
        matterCommand.command = 0x0001;
        break;

      case 'setPosition':
        matterCommand.cluster = 0x0102;
        matterCommand.command = 0x0000;
        matterCommand.payload = { percent: command.value };
        break;

      default:
        return { success: false, error: `Unknown command: ${command.action}` };
    }

    return { success: true, data: matterCommand };
  }

  /**
   * Matter命令转私有协议命令
   */
  private convertMatterToPrivateCommand(command: any): ConversionResult {
    const privateCommand: any = {
      deviceId: this.getDeviceIdByNodeIdSync(command.nodeId),
    };

    switch (command.cluster) {
      case 0x0006:
        privateCommand.action = 'setPower';
        privateCommand.value = command.command === 0x0001;
        break;

      case 0x0008:
        privateCommand.action = 'setBrightness';
        privateCommand.value = command.payload?.level || 0;
        break;

      case 0x0300:
        privateCommand.action = 'setColor';
        privateCommand.value = this.colorTemperatureToHex(command.payload?.colorTemperature);
        break;

      case 0x0101:
        privateCommand.action = command.command === 0x0000 ? 'lock' : 'unlock';
        break;

      case 0x0102:
        privateCommand.action = 'setPosition';
        privateCommand.value = command.payload?.percent || 0;
        break;

      default:
        return { success: false, error: `Unknown cluster: ${command.cluster}` };
    }

    return { success: true, data: privateCommand };
  }

  /**
   * 根据产品类型获取Matter集群
   */
  private getClustersForProductType(productType: ProductType): number[] {
    const clusterMap: Record<ProductType, number[]> = {
      [ProductType.CAMERA]: [0x0028, 0x0003, 0x0402],
      [ProductType.SCREEN]: [0x0028, 0x0003, 0x0006, 0x0008],
      [ProductType.SENSOR]: [0x0028, 0x0003, 0x0402, 0x0405],
      [ProductType.GATEWAY]: [0x0028, 0x0003, 0x0006],
      [ProductType.LIGHT]: [0x0028, 0x0003, 0x0006, 0x0008, 0x0300],
      [ProductType.SWITCH]: [0x0028, 0x0003, 0x0006],
      [ProductType.THERMOSTAT]: [0x0028, 0x0003, 0x0201, 0x0402],
      [ProductType.LOCK]: [0x0028, 0x0003, 0x0101],
      [ProductType.BLINDS]: [0x0028, 0x0003, 0x0102],
      [ProductType.PLUG]: [0x0028, 0x0003, 0x0006, 0x0280],
    };

    return clusterMap[productType] || [0x0028, 0x0003];
  }

  /**
   * 生成或获取Node ID
   */
  private async generateNodeId(deviceId: string): Promise<number> {
    const key = `${this.CACHE_PREFIX}node:${deviceId}`;
    const cached = await this.cacheManager.get<string>(key);

    if (cached.hit && cached.data) {
      return parseInt(cached.data, 10);
    }

    const generatedNodeId = Math.floor(Math.random() * 65534) + 1;
    await this.cacheManager.set(key, generatedNodeId.toString(), this.CACHE_TTL);

    // 反向映射
    await this.cacheManager.set(`${this.CACHE_PREFIX}device:${generatedNodeId}`, deviceId, this.CACHE_TTL);

    return generatedNodeId;
  }

  /**
   * 通过Node ID获取Device ID
   */
  private async getDeviceIdByNodeId(nodeId: number): Promise<string> {
    const key = `${this.CACHE_PREFIX}device:${nodeId}`;
    const deviceId = await this.cacheManager.get<string>(key);

    if (!deviceId.hit || !deviceId.data) {
      throw new Error(`Device not found for node ID: ${nodeId}`);
    }

    return deviceId.data;
  }

  /**
   * 同步获取Device ID by Node ID（用于不需要异步的地方）
   */
  private getDeviceIdByNodeIdSync(nodeId: number): string {
    return `device-${nodeId}`;
  }

  /**
   * 颜色温度转十六进制
   */
  private colorTemperatureToHex(temp: number): string {
    return `#${temp.toString(16).padStart(6, '0')}`;
  }

  /**
   * 十六进制转颜色温度
   */
  private hexToColorTemperature(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
  }

  /**
   * 创建自定义协议映射
   */
  async createMapping(
    deviceId: string,
    sourceProtocol: DeviceProtocol,
    targetProtocol: DeviceProtocol,
    propertyMappings: Record<string, string>,
    commandMappings: Record<string, string>
  ): Promise<void> {
    const mapping: ProtocolMapping = {
      sourceProtocol,
      targetProtocol,
      propertyMappings,
      capabilityMappings: {},
      commandMappings,
    };

    const key = `${this.MAPPING_PREFIX}${deviceId}`;
    await this.cacheManager.set(key, mapping, this.CACHE_TTL);
  }

  /**
   * 获取协议映射
   */
  async getMapping(deviceId: string): Promise<ProtocolMapping | null> {
    const key = `${this.MAPPING_PREFIX}${deviceId}`;
    const cached = await this.cacheManager.get<ProtocolMapping>(key);
    return cached.hit ? (cached.data || null) : null;
  }

  /**
   * 删除协议映射
   */
  async deleteMapping(deviceId: string): Promise<void> {
    const key = `${this.MAPPING_PREFIX}${deviceId}`;
    await this.cacheManager.del(key);
  }
}
