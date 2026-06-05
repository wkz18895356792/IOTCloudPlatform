/**
 * Matter.js SDK 集成服务
 *
 * 使用官方 @project-chip/matter.js SDK 实现完整的 Matter 协议支持
 *
 * 文档: https://github.com/project-chip/matter.js
 *
 * 功能模块：
 * - Matter 控制器（Commissioner）
 * - 设备发现 (mDNS)
 * - 设备配网
 * - 集群操作
 * - 属性读写
 * - 命令执行
 */
import { Provide, Inject, Scope, ScopeEnum, Init, Destroy, Config } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';

// Matter.js SDK imports
import {
  CommissioningController,
  CommissioningOptions,
  ControllerNode,
  NodeCommissioningOptions,
} from '@project-chip/matter.js';
import {
  BasicInformationCluster,
  OnOffCluster,
  LevelControlCluster,
  ColorControlCluster,
  TemperatureMeasurementCluster,
  RelativeHumidityMeasurementCluster,
  DoorLockCluster,
  WindowCoveringCluster,
  ThermostatCluster,
  PowerSourceCluster,
  DescriptorCluster,
  IdentifyCluster,
  GroupsCluster,
  ScenesCluster,
  BooleanStateCluster,
  OccupancySensingCluster,
} from '@project-chip/matter.js/cluster';
import {
  DeviceTypeDefinition,
  DeviceTypes,
  OnOffLightDevice,
  DimmableLightDevice,
  ColorTemperatureLightDevice,
  OnOffPluginUnitDevice,
  DimmablePluginUnitDevice,
  TemperatureSensorDevice,
  HumiditySensorDevice,
  OccupancySensorDevice,
  ContactSensorDevice,
  DoorLockDevice,
  WindowCoveringDevice,
  ThermostatDevice,
} from '@project-chip/matter.js/devices';
import { Environment, StorageService, StorageContext } from '@project-chip/matter.js/environment';
import { MdnsInstance } from '@project-chip/matter.js/mdns';
import { Logger as MatterLogger, LogLevel } from '@project-chip/matter.js/log';
import { NodeId } from '@project-chip/matter.js/datatype';
import { VendorId } from '@project-chip/matter.js';

/**
 * Matter 配置
 */
export interface MatterConfig {
  // 控制器配置
  vendorId: number;
  vendorName: string;
  productId: number;
  productName: string;
  productLabel: string;

  // 网络配置
  wifiSsid?: string;
  wifiPassword?: string;

  // 存储配置
  storagePath: string;

  // 日志级别
  logLevel: 'error' | 'warn' | 'info' | 'debug';

  // 配网超时
  commissioningTimeout: number;
}

/**
 * 已配网的 Matter 节点信息
 */
export interface MatterNodeInfo {
  nodeId: NodeId;
  commissioned: boolean;
  lastSeen: Date;
  deviceType?: DeviceTypeDefinition;
  endpoints: EndpointInfo[];
  basicInfo?: {
    vendorName?: string;
    productName?: string;
    productLabel?: string;
    serialNumber?: string;
    hardwareVersion?: string;
    softwareVersion?: string;
  };
}

/**
 * 端点信息
 */
export interface EndpointInfo {
  endpointId: number;
  deviceType: DeviceTypeDefinition;
  clusters: ClusterInfo[];
}

/**
 * 集群信息
 */
export interface ClusterInfo {
  clusterId: number;
  clusterName: string;
  attributes: string[];
  commands: string[];
}

/**
 * 发现的设备
 */
export interface DiscoveredMatterDevice {
  discriminator: number;
  vendorId: number;
  productId: number;
  commissioningMode: boolean;
  instanceName: string;
  addresses: Array<{ ip: string; port: number }>;
  discoveredAt: Date;
}

/**
 * 属性值
 */
export interface AttributeValue {
  cluster: string;
  attribute: string;
  value: any;
  timestamp: Date;
}

/**
 * Matter.js SDK 服务
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class MatterNodeService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Config('matter')
  matterConfig!: MatterConfig;

  // Matter 控制器
  private controller!: CommissioningController;
  private controllerNode!: ControllerNode;

  // 存储服务
  private storageService!: StorageService;

  // 已配网的节点
  private commissionedNodes: Map<string, MatterNodeInfo> = new Map();

  // 发现的设备
  private discoveredDevices: Map<string, DiscoveredMatterDevice> = new Map();

  // 是否已初始化
  private initialized = false;

  // Redis 键前缀
  private readonly NODE_PREFIX = 'matter:node:';
  private readonly DISCOVERY_PREFIX = 'matter:discovery:';

  @Init()
  async init(): Promise<void> {
    this.logger.info('[Matter Node] Initializing Matter.js SDK service...');

    try {
      // 设置 Matter 日志级别
      this.setMatterLogLevel(this.matterConfig?.logLevel || 'info');

      // 初始化存储服务
      await this.initStorage();

      // 初始化控制器
      await this.initController();

      // 加载已配网的节点
      await this.loadCommissionedNodes();

      this.initialized = true;
      this.logger.info('[Matter Node] Matter.js SDK service initialized successfully');
    } catch (error: any) {
      this.logger.error('[Matter Node] Failed to initialize Matter.js SDK:', error);
      throw error;
    }
  }

  @Destroy()
  async destroy(): Promise<void> {
    this.logger.info('[Matter Node] Destroying Matter.js SDK service...');

    try {
      if (this.controller) {
        await this.controller.close();
      }
      this.initialized = false;
      this.logger.info('[Matter Node] Matter.js SDK service destroyed');
    } catch (error: any) {
      this.logger.error('[Matter Node] Error during destroy:', error);
    }
  }

  // ==================== 设备发现 ====================

  /**
   * 开始设备发现
   *
   * 使用 mDNS 发现附近的 Matter 设备
   */
  async startDiscovery(timeout: number = 60000): Promise<void> {
    this.ensureInitialized();

    this.logger.info('[Matter Node] Starting device discovery...');
    this.discoveredDevices.clear();

    try {
      // 使用 Matter SDK 的 mDNS 发现
      const mdns = await MdnsInstance.create();

      // 设置发现超时
      const timeoutHandle = setTimeout(() => {
        this.logger.info('[Matter Node] Discovery timeout reached');
        mdns.close();
      }, timeout);

      // 监听发现的设备
      mdns.on('device-discovered', (device: any) => {
        const discoveredDevice: DiscoveredMatterDevice = {
          discriminator: device.discriminator,
          vendorId: device.vendorId,
          productId: device.productId,
          commissioningMode: device.commissioningMode,
          instanceName: device.instanceName,
          addresses: device.addresses || [],
          discoveredAt: new Date(),
        };

        this.discoveredDevices.set(device.instanceName, discoveredDevice);
        this.logger.info('[Matter Node] Discovered device:', device.instanceName);

        // 保存到 Redis
        this.saveDiscoveredDevice(device.instanceName, discoveredDevice);
      });

      // 开始发现
      await mdns.announce();

      // 存储超时句柄以便后续清理
      (mdns as any)._timeoutHandle = timeoutHandle;
    } catch (error: any) {
      this.logger.error('[Matter Node] Discovery failed:', error);
      throw error;
    }
  }

  /**
   * 获取发现的设备列表
   */
  async getDiscoveredDevices(): Promise<DiscoveredMatterDevice[]> {
    return Array.from(this.discoveredDevices.values());
  }

  // ==================== 设备配网 ====================

  /**
   * 配网设备
   *
   * @param discriminator 设备识别码
   * @param setupPinCode 配网 PIN 码
   * @param wifiSsid WiFi SSID（可选，使用配置中的值）
   * @param wifiPassword WiFi 密码（可选）
   */
  async commissionDevice(
    discriminator: number,
    setupPinCode: number,
    wifiSsid?: string,
    wifiPassword?: string
  ): Promise<{ success: boolean; nodeId?: NodeId; error?: string }> {
    this.ensureInitialized();

    this.logger.info('[Matter Node] Commissioning device...', { discriminator });

    try {
      // 构建配网选项
      const commissioningOptions: NodeCommissioningOptions = {
        regulatoryLocation: 0, // 0 = indoor
        regulatoryCountryCode: 'CN',

        // WiFi 配置
        wifiNetwork: {
          ssid: wifiSsid || this.matterConfig?.wifiSsid || '',
          credentials: wifiPassword || this.matterConfig?.wifiPassword || '',
        },

        // 配网码
        commissioning: {
          discriminator,
          passcode: setupPinCode,
        },

        // 设备发现
        discovery: {
          discoveryCapabilities: {
            onIpNetwork: true,
          },
          identifierData: {
            discriminator,
          },
        },
      };

      // 执行配网
      const nodeId = await this.controller.commissionNode(commissioningOptions);

      // 获取设备信息
      const nodeInfo = await this.getNodeInfo(nodeId);

      // 保存节点信息
      this.commissionedNodes.set(nodeId.toString(), nodeInfo);
      await this.saveNodeInfo(nodeId, nodeInfo);

      this.logger.info('[Matter Node] Device commissioned successfully:', nodeId.toString());

      return { success: true, nodeId };
    } catch (error: any) {
      this.logger.error('[Matter Node] Commissioning failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 使用二维码配网
   */
  async commissionWithQrCode(qrCode: string): Promise<{ success: boolean; nodeId?: NodeId; error?: string }> {
    this.ensureInitialized();

    this.logger.info('[Matter Node] Commissioning with QR code...');

    try {
      // 解析二维码
      const commissioningOptions = this.parseQrCode(qrCode);

      // 执行配网
      const nodeId = await this.controller.commissionNode(commissioningOptions);

      // 获取并保存设备信息
      const nodeInfo = await this.getNodeInfo(nodeId);
      this.commissionedNodes.set(nodeId.toString(), nodeInfo);
      await this.saveNodeInfo(nodeId, nodeInfo);

      this.logger.info('[Matter Node] Device commissioned with QR code successfully:', nodeId.toString());

      return { success: true, nodeId };
    } catch (error: any) {
      this.logger.error('[Matter Node] QR code commissioning failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 解除设备配网
   */
  async decommissionDevice(nodeId: NodeId): Promise<{ success: boolean; error?: string }> {
    this.ensureInitialized();

    this.logger.info('[Matter Node] Decommissioning device:', nodeId.toString());

    try {
      await this.controller.removeNode(nodeId);

      // 从缓存中移除
      this.commissionedNodes.delete(nodeId.toString());
      await this.redis.del(`${this.NODE_PREFIX}${nodeId}`);

      this.logger.info('[Matter Node] Device decommissioned successfully');

      return { success: true };
    } catch (error: any) {
      this.logger.error('[Matter Node] Decommissioning failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== 属性读写 ====================

  /**
   * 读取属性值
   */
  async readAttribute(
    nodeId: NodeId,
    endpointId: number,
    clusterId: number,
    attributeId: number
  ): Promise<AttributeValue> {
    this.ensureInitialized();

    const clusterName = this.getClusterName(clusterId);
    const attributeName = this.getAttributeName(clusterId, attributeId);

    this.logger.debug('[Matter Node] Reading attribute:', {
      nodeId: nodeId.toString(),
      endpointId,
      cluster: clusterName,
      attribute: attributeName,
    });

    try {
      const node = this.controller.getConnectedNode(nodeId);
      if (!node) {
        throw new Error(`Node ${nodeId} not connected`);
      }

      const endpoint = node.getEndpoint(endpointId);
      if (!endpoint) {
        throw new Error(`Endpoint ${endpointId} not found`);
      }

      const cluster = endpoint.getCluster(clusterId);
      if (!cluster) {
        throw new Error(`Cluster ${clusterName} not found`);
      }

      const value = await cluster.getAttribute(attributeId);

      return {
        cluster: clusterName,
        attribute: attributeName,
        value,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('[Matter Node] Failed to read attribute:', error);
      throw error;
    }
  }

  /**
   * 写入属性值
   */
  async writeAttribute(
    nodeId: NodeId,
    endpointId: number,
    clusterId: number,
    attributeId: number,
    value: any
  ): Promise<void> {
    this.ensureInitialized();

    const clusterName = this.getClusterName(clusterId);
    const attributeName = this.getAttributeName(clusterId, attributeId);

    this.logger.debug('[Matter Node] Writing attribute:', {
      nodeId: nodeId.toString(),
      endpointId,
      cluster: clusterName,
      attribute: attributeName,
      value,
    });

    try {
      const node = this.controller.getConnectedNode(nodeId);
      if (!node) {
        throw new Error(`Node ${nodeId} not connected`);
      }

      const endpoint = node.getEndpoint(endpointId);
      if (!endpoint) {
        throw new Error(`Endpoint ${endpointId} not found`);
      }

      const cluster = endpoint.getCluster(clusterId);
      if (!cluster) {
        throw new Error(`Cluster ${clusterName} not found`);
      }

      await cluster.setAttribute(attributeId, value);
    } catch (error: any) {
      this.logger.error('[Matter Node] Failed to write attribute:', error);
      throw error;
    }
  }

  // ==================== 命令执行 ====================

  /**
   * 执行命令
   */
  async executeCommand(
    nodeId: NodeId,
    endpointId: number,
    clusterId: number,
    commandId: number,
    args?: any
  ): Promise<any> {
    this.ensureInitialized();

    const clusterName = this.getClusterName(clusterId);
    const commandName = this.getCommandName(clusterId, commandId);

    this.logger.info('[Matter Node] Executing command:', {
      nodeId: nodeId.toString(),
      endpointId,
      cluster: clusterName,
      command: commandName,
      args,
    });

    try {
      const node = this.controller.getConnectedNode(nodeId);
      if (!node) {
        throw new Error(`Node ${nodeId} not connected`);
      }

      const endpoint = node.getEndpoint(endpointId);
      if (!endpoint) {
        throw new Error(`Endpoint ${endpointId} not found`);
      }

      const cluster = endpoint.getCluster(clusterId);
      if (!cluster) {
        throw new Error(`Cluster ${clusterName} not found`);
      }

      const result = await cluster.executeCommand(commandId, args);
      return result;
    } catch (error: any) {
      this.logger.error('[Matter Node] Failed to execute command:', error);
      throw error;
    }
  }

  // ==================== 便捷方法 ====================

  /**
   * 开关控制
   */
  async setOnOff(nodeId: NodeId, endpointId: number, onOff: boolean): Promise<void> {
    const commandId = onOff ? OnOffCluster.Commands.onId : OnOffCluster.Commands.offId;
    await this.executeCommand(nodeId, endpointId, OnOffCluster.id, commandId);
  }

  /**
   * 切换开关
   */
  async toggleOnOff(nodeId: NodeId, endpointId: number): Promise<void> {
    await this.executeCommand(
      nodeId,
      endpointId,
      OnOffCluster.id,
      OnOffCluster.Commands.toggleId
    );
  }

  /**
   * 设置亮度级别
   */
  async setLevel(nodeId: NodeId, endpointId: number, level: number, transitionTime?: number): Promise<void> {
    await this.executeCommand(
      nodeId,
      endpointId,
      LevelControlCluster.id,
      LevelControlCluster.Commands.moveToLevelId,
      { level, transitionTime: transitionTime || 0 }
    );
  }

  /**
   * 设置色温
   */
  async setColorTemperature(
    nodeId: NodeId,
    endpointId: number,
    colorTemperatureMireds: number,
    transitionTime?: number
  ): Promise<void> {
    await this.executeCommand(
      nodeId,
      endpointId,
      ColorControlCluster.id,
      ColorControlCluster.Commands.moveToColorTemperatureId,
      { colorTemperatureMireds, transitionTime: transitionTime || 0 }
    );
  }

  /**
   * 锁门
   */
  async lockDoor(nodeId: NodeId, endpointId: number, pinCode?: string): Promise<void> {
    await this.executeCommand(
      nodeId,
      endpointId,
      DoorLockCluster.id,
      DoorLockCluster.Commands.lockDoorId,
      { pinCode }
    );
  }

  /**
   * 解锁门
   */
  async unlockDoor(nodeId: NodeId, endpointId: number, pinCode?: string): Promise<void> {
    await this.executeCommand(
      nodeId,
      endpointId,
      DoorLockCluster.id,
      DoorLockCluster.Commands.unlockDoorId,
      { pinCode }
    );
  }

  /**
   * 设置窗帘位置
   */
  async setWindowCoveringPosition(nodeId: NodeId, endpointId: number, positionPercent: number): Promise<void> {
    await this.executeCommand(
      nodeId,
      endpointId,
      WindowCoveringCluster.id,
      WindowCoveringCluster.Commands.goToLiftPercentageId,
      { liftPercent100thsValue: Math.round(positionPercent * 100) }
    );
  }

  /**
   * 设置温度
   */
  async setTemperature(nodeId: NodeId, endpointId: number, temperature: number): Promise<void> {
    await this.writeAttribute(
      nodeId,
      endpointId,
      ThermostatCluster.id,
      ThermostatCluster.Attributes.occupiedHeatingSetpoint.id,
      Math.round(temperature * 100) // 转换为百分之一度
    );
  }

  // ==================== 节点管理 ====================

  /**
   * 获取所有已配网的节点
   */
  async getCommissionedNodes(): Promise<MatterNodeInfo[]> {
    return Array.from(this.commissionedNodes.values());
  }

  /**
   * 获取节点信息
   */
  async getNodeInfo(nodeId: NodeId): Promise<MatterNodeInfo> {
    const node = this.controller.getConnectedNode(nodeId);

    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    const endpoints: EndpointInfo[] = [];

    for (const endpoint of node.getEndpoints()) {
      const endpointInfo: EndpointInfo = {
        endpointId: endpoint.number,
        deviceType: endpoint.deviceType,
        clusters: [],
      };

      for (const cluster of endpoint.getClusters()) {
        const clusterInfo: ClusterInfo = {
          clusterId: cluster.id,
          clusterName: this.getClusterName(cluster.id),
          attributes: Object.keys(cluster.attributes),
          commands: Object.keys(cluster.commands),
        };
        endpointInfo.clusters.push(clusterInfo);
      }

      endpoints.push(endpointInfo);
    }

    // 获取基本信息
    let basicInfo: any = {};
    try {
      const basicCluster = node.getRootEndpoint().getCluster(BasicInformationCluster);
      if (basicCluster) {
        basicInfo = {
          vendorName: await basicCluster.getVendorName(),
          productName: await basicCluster.getProductName(),
          productLabel: await basicCluster.getProductLabel(),
          serialNumber: await basicCluster.getSerialNumber(),
          hardwareVersion: await basicCluster.getHardwareVersionString(),
          softwareVersion: await basicCluster.getSoftwareVersionString(),
        };
      }
    } catch (error) {
      this.logger.warn('[Matter Node] Failed to get basic info:', error);
    }

    return {
      nodeId,
      commissioned: true,
      lastSeen: new Date(),
      endpoints,
      basicInfo,
    };
  }

  /**
   * 检查节点连接状态
   */
  async isNodeConnected(nodeId: NodeId): Promise<boolean> {
    try {
      const node = this.controller.getConnectedNode(nodeId);
      return node !== undefined && node.isConnected();
    } catch {
      return false;
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 确保服务已初始化
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Matter service not initialized');
    }
  }

  /**
   * 设置 Matter 日志级别
   */
  private setMatterLogLevel(level: string): void {
    const logLevelMap: Record<string, LogLevel> = {
      error: LogLevel.ERROR,
      warn: LogLevel.WARN,
      info: LogLevel.INFO,
      debug: LogLevel.DEBUG,
    };

    MatterLogger.level = logLevelMap[level] || LogLevel.INFO;
  }

  /**
   * 初始化存储服务
   */
  private async initStorage(): Promise<void> {
    const storagePath = this.matterConfig?.storagePath || './data/matter';

    this.storageService = await StorageService.create(storagePath);
    this.logger.info('[Matter Node] Storage initialized at:', storagePath);
  }

  /**
   * 初始化 Matter 控制器
   */
  private async initController(): Promise<void> {
    const config = this.matterConfig || {};

    const commissioningOptions: CommissioningOptions = {
      regulatoryLocation: 0, // 0 = indoor
      regulatoryCountryCode: 'CN',

      controllerOptions: {
        vendorId: VendorId.of(config.vendorId || 0xfff1),
        vendorName: config.vendorName || 'BabyMonitor',
        productId: config.productId || 0x8000,
        productName: config.productName || 'Baby Monitor Controller',
        productLabel: config.productLabel || 'Baby Monitor Matter Controller',
      },
    };

    this.controller = await CommissioningController.create({
      environment: Environment.default,
      storage: this.storageService,
      commissioningOptions,
    });

    this.logger.info('[Matter Node] Controller initialized');
  }

  /**
   * 加载已配网的节点
   */
  private async loadCommissionedNodes(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.NODE_PREFIX}*`);

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const nodeInfo = JSON.parse(data);
          nodeInfo.nodeId = NodeId.fromString(nodeInfo.nodeId);
          nodeInfo.lastSeen = new Date(nodeInfo.lastSeen);
          this.commissionedNodes.set(nodeInfo.nodeId.toString(), nodeInfo);
        }
      }

      this.logger.info(`[Matter Node] Loaded ${this.commissionedNodes.size} commissioned nodes`);
    } catch (error) {
      this.logger.error('[Matter Node] Failed to load commissioned nodes:', error);
    }
  }

  /**
   * 保存节点信息
   */
  private async saveNodeInfo(nodeId: NodeId, nodeInfo: MatterNodeInfo): Promise<void> {
    const key = `${this.NODE_PREFIX}${nodeId}`;
    await this.redis.set(key, JSON.stringify(nodeInfo));
  }

  /**
   * 保存发现的设备
   */
  private async saveDiscoveredDevice(instanceName: string, device: DiscoveredMatterDevice): Promise<void> {
    const key = `${this.DISCOVERY_PREFIX}${instanceName}`;
    await this.redis.setex(key, 3600, JSON.stringify(device)); // 1小时过期
  }

  /**
   * 获取集群名称
   */
  private getClusterName(clusterId: number): string {
    const clusterNames: Record<number, string> = {
      [BasicInformationCluster.id]: 'BasicInformation',
      [OnOffCluster.id]: 'OnOff',
      [LevelControlCluster.id]: 'LevelControl',
      [ColorControlCluster.id]: 'ColorControl',
      [TemperatureMeasurementCluster.id]: 'TemperatureMeasurement',
      [RelativeHumidityMeasurementCluster.id]: 'RelativeHumidityMeasurement',
      [DoorLockCluster.id]: 'DoorLock',
      [WindowCoveringCluster.id]: 'WindowCovering',
      [ThermostatCluster.id]: 'Thermostat',
      [PowerSourceCluster.id]: 'PowerSource',
      [DescriptorCluster.id]: 'Descriptor',
      [IdentifyCluster.id]: 'Identify',
      [GroupsCluster.id]: 'Groups',
      [ScenesCluster.id]: 'Scenes',
      [BooleanStateCluster.id]: 'BooleanState',
      [OccupancySensingCluster.id]: 'OccupancySensing',
    };

    return clusterNames[clusterId] || `Unknown(${clusterId})`;
  }

  /**
   * 获取属性名称
   */
  private getAttributeName(clusterId: number, attributeId: number): string {
    // 简化实现，返回属性ID
    return `Attribute(${attributeId})`;
  }

  /**
   * 获取命令名称
   */
  private getCommandName(clusterId: number, commandId: number): string {
    // 简化实现，返回命令ID
    return `Command(${commandId})`;
  }

  /**
   * 解析二维码
   */
  private parseQrCode(qrCode: string): NodeCommissioningOptions {
    // 实际实现需要解析 Matter 二维码格式
    throw new Error('QR code parsing not implemented');
  }
}
