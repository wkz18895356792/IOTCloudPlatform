/**
 * Matter SDK 集成服务
 *
 * 提供 Matter 1.5 协议的设备发现、配网、控制等功能
 *
 * 注意：当前实现为模拟层，实际生产环境需要集成官方 Matter SDK
 * 官方 SDK: https://github.com/project-chip/connectedhomeip
 *
 * 功能模块：
 * - 设备发现 (mDNS/BLE)
 * - 设备配网 (BLE/SoftAP)
 * - 属性读写
 * - 命令执行
 * - 事件订阅
 */
import { Provide, Inject, Scope, ScopeEnum, Init, Destroy } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { CacheManager, IdGenerator } from '@baby-monitor/shared-utils';
import { DeviceProtocol, ProductType } from '@baby-monitor/shared-types';

/**
 * Matter 节点 ID (64-bit)
 */
export type NodeId = bigint;

/**
 * Matter 端点 ID (16-bit)
 */
export type EndpointId = number;

/**
 * Matter 集群 ID (32-bit)
 */
export type ClusterId = number;

/**
 * Matter 属性 ID (32-bit)
 */
export type AttributeId = number;

/**
 * Matter 设备信息
 */
export interface MatterDeviceInfo {
  nodeId: NodeId;
  vendorId: number;
  productId: number;
  deviceName?: string;
  deviceType?: number;
  endpoints: MatterEndpoint[];
  lastSeen: Date;
  reachable: boolean;
}

/**
 * Matter 端点信息
 */
export interface MatterEndpoint {
  endpointId: EndpointId;
  deviceTypeId: number;
  clusters: MatterCluster[];
}

/**
 * Matter 集群信息
 */
export interface MatterCluster {
  clusterId: ClusterId;
  clusterName?: string;
  attributes: MatterAttribute[];
  commands?: number[];
}

/**
 * Matter 属性信息
 */
export interface MatterAttribute {
  attributeId: AttributeId;
  attributeName?: string;
  value: any;
  type: string;
}

/**
 * Matter 配网信息
 */
export interface MatterCommissioningParams {
  setupPinCode: number;
  setupManualCode?: string;
  discoveryMethod: 'ble' | 'wifi' | 'ethernet';
  wifiSsid?: string;
  wifiPassword?: string;
  endpointUrl?: string;
}

/**
 * Matter 配网结果
 */
export interface MatterCommissioningResult {
  success: boolean;
  nodeId?: NodeId;
  error?: string;
  errorDetails?: string;
}

/**
 * Matter 设备发现结果
 */
export interface MatterDiscoveredDevice {
  instanceName: string;
  vendorId: number;
  productId: number;
  discriminator: number;
  commissioningMode: boolean;
  ipAddress?: string;
  port?: number;
  discoveredAt: Date;
}

/**
 * Matter 命令响应
 */
export interface MatterCommandResponse {
  success: boolean;
  status: number;
  response?: any;
  error?: string;
}

/**
 * 预定义集群 ID
 */
export const ClusterId = {
  // 基础集群
  Descriptor: 0x001d,
  AccessControl: 0x001f,
  BasicInformation: 0x0028,
  OtaSoftwareUpdateProvider: 0x0029,
  OtaSoftwareUpdateRequestor: 0x002a,
  LocalizationConfiguration: 0x002b,
  TimeFormatLocalization: 0x002c,
  UnitLocalization: 0x002d,
  PowerSourceConfiguration: 0x002e,
  PowerSource: 0x002f,
  GeneralCommissioning: 0x0030,
  NetworkCommissioning: 0x0031,
  DiagnosticLogs: 0x0032,
  GeneralDiagnostics: 0x0033,
  SoftwareDiagnostics: 0x0034,
  ThreadNetworkDiagnostics: 0x0035,
  WiFiNetworkDiagnostics: 0x0036,
  EthernetNetworkDiagnostics: 0x0037,
  TimeSynchronization: 0x0038,
  BridgedDeviceBasicInformation: 0x0039,
  Switch: 0x003b,
  AdministratorCommissioning: 0x003c,
  OperationalCredentials: 0x003e,
  GroupKeyManagement: 0x003f,
  RemoteProxyConfiguration: 0x0040,
  RemoteProxyManagement: 0x0041,
  ProxyDiscovery: 0x0042,
  ProxyConfiguration: 0x0043,
  IcdManagement: 0x0046,
  Timer: 0x0047,
  OvenCavityOperationalState: 0x0048,
  OvenMode: 0x0049,
  LaundryWasherMode: 0x004a,
  LaundryWasherControls: 0x004b,

  // 应用集群
  OnOff: 0x0006,
  LevelControl: 0x0008,
  ColorControl: 0x0300,
  TemperatureMeasurement: 0x0402,
  RelativeHumidityMeasurement: 0x0405,
  Thermostat: 0x0201,
  DoorLock: 0x0101,
  WindowCovering: 0x0102,
  ElectricalMeasurement: 0x0b04,
  OccupancySensing: 0x0406,
  FlowMeasurement: 0x0404,
  PressureMeasurement: 0x0403,
  PumpConfigurationAndControl: 0x0200,
  FanControl: 0x0202,
  ThermostatUserInterfaceConfiguration: 0x0204,
  AirQuality: 0x005c,
  SmokeCoAlarm: 0x005c,
  DishwasherMode: 0x0059,
  DishwasherAlarm: 0x0058,
  MicrowaveOvenMode: 0x0055,
  MicrowaveOvenControl: 0x0056,
  RvcRunMode: 0x0054,
  RvcCleanMode: 0x0053,
  RvcOperationalState: 0x0052,
  ScenesManagement: 0x0062,
  HepaFilterMonitoring: 0x0072,
  ActivatedCarbonFilterMonitoring: 0x0073,
  EnergyEvse: 0x00c2,
  EnergyEvseMode: 0x00c3,
  EnergyPreference: 0x00c4,
  DeviceEnergyManagement: 0x0151,
  DeviceEnergyManagementMode: 0x0152,
  WaterHeaterManagement: 0x0411,
  WaterHeaterMode: 0x0412,
  ValveConfigurationAndControl: 0x0044,
  EnergyReport: 0x0006,
} as const;

/**
 * 设备类型 ID
 */
export const DeviceTypeId = {
  // 基础设备类型
  RootNode: 0x0016,
  PowerSource: 0x0011,
  BridgedNode: 0x0013,
  BasicVideoPlayer: 0x0023,
  CastingVideoPlayer: 0x0024,
  VideoRemoteControl: 0x0025,
  Speaker: 0x0026,
  ContentApp: 0x0027,
  BasicCluster: 0x0028,

  // 应用设备类型
  OnOffLight: 0x0100,
  DimmableLight: 0x0101,
  ColorDimmableLight: 0x0102,
  ExtendedColorLight: 0x010d,
  OnOffLightSwitch: 0x0103,
  DimmerSwitch: 0x0104,
  ColorDimmerSwitch: 0x0105,
  OnOffPluginUnit: 0x010a,
  DimmablePluginUnit: 0x010b,
  ColorTemperatureLight: 0x010c,
  LightSensor: 0x0106,
  OccupancySensor: 0x0107,
  ContactSensor: 0x0115,
  DoorLock: 0x0109,
  DoorLockController: 0x0113,
  Thermostat: 0x010e,
  Fan: 0x010f,
  WindowCovering: 0x0112,
  TemperatureSensor: 0x0116,
  HumiditySensor: 0x0117,
  AirQualitySensor: 0x002c,
  SmokeCoAlarm: 0x0076,
  WaterFreezeDetector: 0x0041,
  WaterLeakDetector: 0x0043,
  Refrigerator: 0x0070,
  Dishwasher: 0x0075,
  MicrowaveOven: 0x0080,
  LaundryWasher: 0x0073,
  RoboticVacuumCleaner: 0x0074,
  Oven: 0x0071,
  ElectricalSensor: 0x0114,
  Pump: 0x0303,
  PumpController: 0x0304,
  EVSE: 0x0122,
  EnergyMeter: 0x0121,
  SolarPower: 0x0124,
  BatteryStorage: 0x0126,
  WaterHeater: 0x0042,
  PressureSensor: 0x0118,
  FlowSensor: 0x0119,
  AirPurifier: 0x002d,
  AirConditioner: 0x0045,
  Heating: 0x0046,
} as const;

/**
 * Matter SDK 服务
 *
 * 提供完整的 Matter 协议支持
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class MatterSdkService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  // 节点缓存前缀
  private readonly NODE_PREFIX = 'matter:node:';
  private readonly DISCOVERY_PREFIX = 'matter:discovery:';
  private readonly COMMISSIONING_PREFIX = 'matter:commissioning:';

  // 发现状态
  private discoveryActive = false;
  private discoveredDevices: Map<string, MatterDiscoveredDevice> = new Map();

  // 已配网节点
  private commissionedNodes: Map<string, MatterDeviceInfo> = new Map();

  // 事件订阅
  private attributeSubscriptions: Map<string, Set<(value: any) => void>> = new Map();

  @Init()
  async init(): Promise<void> {
    this.logger.info('[Matter SDK] Initializing Matter SDK service...');

    // 加载已配网的节点
    await this.loadCommissionedNodes();

    // 启动后台任务
    this.startBackgroundTasks();

    this.logger.info('[Matter SDK] Matter SDK service initialized');
  }

  @Destroy()
  async destroy(): Promise<void> {
    this.logger.info('[Matter SDK] Destroying Matter SDK service...');
    this.discoveryActive = false;
    this.attributeSubscriptions.clear();
  }

  // ==================== 设备发现 ====================

  /**
   * 开始设备发现
   *
   * 使用 mDNS 和 BLE 发现附近的 Matter 设备
   *
   * @param timeout 发现超时时间（毫秒）
   * @param filter 过滤条件（可选）
   */
  async startDiscovery(
    timeout: number = 60000,
    filter?: { vendorId?: number; productId?: number }
  ): Promise<{ success: boolean; message: string }> {
    if (this.discoveryActive) {
      return { success: false, message: 'Discovery already in progress' };
    }

    this.discoveryActive = true;
    this.discoveredDevices.clear();

    this.logger.info('[Matter SDK] Starting device discovery...', { timeout, filter });

    // 模拟发现过程
    // 实际实现需要使用 Matter SDK 的 mDNS 发现功能
    this.simulateDiscovery(timeout, filter);

    return {
      success: true,
      message: `Discovery started, will timeout in ${timeout}ms`,
    };
  }

  /**
   * 停止设备发现
   */
  async stopDiscovery(): Promise<void> {
    this.discoveryActive = false;
    this.logger.info('[Matter SDK] Device discovery stopped');
  }

  /**
   * 获取发现的设备列表
   */
  async getDiscoveredDevices(): Promise<MatterDiscoveredDevice[]> {
    return Array.from(this.discoveredDevices.values());
  }

  /**
   * 获取特定设备的详细信息
   */
  async getDiscoveredDevice(instanceName: string): Promise<MatterDiscoveredDevice | null> {
    return this.discoveredDevices.get(instanceName) || null;
  }

  // ==================== 设备配网 ====================

  /**
   * 配网设备
   *
   * @param device 设备信息
   * @param params 配网参数
   */
  async commissionDevice(
    device: MatterDiscoveredDevice,
    params: MatterCommissioningParams
  ): Promise<MatterCommissioningResult> {
    this.logger.info('[Matter SDK] Commissioning device...', {
      instanceName: device.instanceName,
      vendorId: device.vendorId,
      productId: device.productId,
    });

    try {
      // 验证 PIN 码
      if (!this.validatePinCode(params.setupPinCode)) {
        return {
          success: false,
          error: 'Invalid PIN code',
        };
      }

      // 模拟配网过程
      // 实际实现需要使用 Matter SDK 的配网功能
      const nodeId = await this.performCommissioning(device, params);

      // 保存配网信息
      const deviceInfo: MatterDeviceInfo = {
        nodeId,
        vendorId: device.vendorId,
        productId: device.productId,
        deviceName: `Matter Device ${nodeId.toString(16)}`,
        endpoints: [],
        lastSeen: new Date(),
        reachable: true,
      };

      await this.saveNode(nodeId, deviceInfo);

      this.logger.info('[Matter SDK] Device commissioned successfully', {
        nodeId: nodeId.toString(16),
      });

      return {
        success: true,
        nodeId,
      };
    } catch (error: any) {
      this.logger.error('[Matter SDK] Commissioning failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 解除设备配网
   */
  async decommissionDevice(nodeId: NodeId): Promise<{ success: boolean; error?: string }> {
    this.logger.info('[Matter SDK] Decommissioning device...', {
      nodeId: nodeId.toString(16),
    });

    try {
      // 从缓存中移除
      this.commissionedNodes.delete(nodeId.toString());

      // 从 Redis 中移除
      await this.redis.del(`${this.NODE_PREFIX}${nodeId}`);

      this.logger.info('[Matter SDK] Device decommissioned successfully');

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ==================== 属性读写 ====================

  /**
   * 读取属性值
   *
   * @param nodeId 节点 ID
   * @param endpointId 端点 ID
   * @param clusterId 集群 ID
   * @param attributeId 属性 ID
   */
  async readAttribute(
    nodeId: NodeId,
    endpointId: EndpointId,
    clusterId: ClusterId,
    attributeId: AttributeId
  ): Promise<{ success: boolean; value?: any; error?: string }> {
    const nodeKey = nodeId.toString();
    const node = this.commissionedNodes.get(nodeKey);

    if (!node) {
      return { success: false, error: 'Node not found' };
    }

    if (!node.reachable) {
      return { success: false, error: 'Node not reachable' };
    }

    this.logger.debug('[Matter SDK] Reading attribute...', {
      nodeId: nodeId.toString(16),
      endpointId,
      clusterId: clusterId.toString(16),
      attributeId: attributeId.toString(16),
    });

    // 模拟读取属性
    // 实际实现需要使用 Matter SDK 的属性读取功能
    const value = await this.simulateAttributeRead(nodeId, endpointId, clusterId, attributeId);

    return { success: true, value };
  }

  /**
   * 写入属性值
   */
  async writeAttribute(
    nodeId: NodeId,
    endpointId: EndpointId,
    clusterId: ClusterId,
    attributeId: AttributeId,
    value: any,
    options?: { timedRequest?: boolean; dataVersion?: number }
  ): Promise<{ success: boolean; error?: string }> {
    const nodeKey = nodeId.toString();
    const node = this.commissionedNodes.get(nodeKey);

    if (!node) {
      return { success: false, error: 'Node not found' };
    }

    if (!node.reachable) {
      return { success: false, error: 'Node not reachable' };
    }

    this.logger.debug('[Matter SDK] Writing attribute...', {
      nodeId: nodeId.toString(16),
      endpointId,
      clusterId: clusterId.toString(16),
      attributeId: attributeId.toString(16),
      value,
    });

    // 模拟写入属性
    await this.simulateAttributeWrite(nodeId, endpointId, clusterId, attributeId, value);

    // 触发订阅回调
    await this.notifyAttributeSubscribers(nodeId, endpointId, clusterId, attributeId, value);

    return { success: true };
  }

  // ==================== 命令执行 ====================

  /**
   * 执行命令
   *
   * @param nodeId 节点 ID
   * @param endpointId 端点 ID
   * @param clusterId 集群 ID
   * @param commandId 命令 ID
   * @param payload 命令载荷
   */
  async executeCommand(
    nodeId: NodeId,
    endpointId: EndpointId,
    clusterId: ClusterId,
    commandId: number,
    payload?: any
  ): Promise<MatterCommandResponse> {
    const nodeKey = nodeId.toString();
    const node = this.commissionedNodes.get(nodeKey);

    if (!node) {
      return { success: false, status: 0x8b, error: 'Node not found' };
    }

    if (!node.reachable) {
      return { success: false, status: 0x8b, error: 'Node not reachable' };
    }

    this.logger.info('[Matter SDK] Executing command...', {
      nodeId: nodeId.toString(16),
      endpointId,
      clusterId: clusterId.toString(16),
      commandId: commandId.toString(16),
      payload,
    });

    // 模拟命令执行
    const response = await this.simulateCommandExecution(
      nodeId,
      endpointId,
      clusterId,
      commandId,
      payload
    );

    return response;
  }

  // ==================== 便捷方法 ====================

  /**
   * 开关控制
   */
  async setOnOff(nodeId: NodeId, endpointId: EndpointId, onOff: boolean): Promise<MatterCommandResponse> {
    const commandId = onOff ? 0x0001 : 0x0000; // On / Off
    return this.executeCommand(nodeId, endpointId, ClusterId.OnOff, commandId);
  }

  /**
   * 切换开关状态
   */
  async toggleOnOff(nodeId: NodeId, endpointId: EndpointId): Promise<MatterCommandResponse> {
    return this.executeCommand(nodeId, endpointId, ClusterId.OnOff, 0x0002); // Toggle
  }

  /**
   * 设置亮度级别
   */
  async setLevel(
    nodeId: NodeId,
    endpointId: EndpointId,
    level: number,
    transitionTime?: number
  ): Promise<MatterCommandResponse> {
    return this.executeCommand(nodeId, endpointId, ClusterId.LevelControl, 0x0000, {
      level,
      transitionTime: transitionTime || 0,
    });
  }

  /**
   * 设置颜色温度
   */
  async setColorTemperature(
    nodeId: NodeId,
    endpointId: EndpointId,
    colorTemperatureMireds: number,
    transitionTime?: number
  ): Promise<MatterCommandResponse> {
    return this.executeCommand(nodeId, endpointId, ClusterId.ColorControl, 0x000a, {
      colorTemperatureMireds,
      transitionTime: transitionTime || 0,
    });
  }

  /**
   * 设置色调和饱和度
   */
  async setHueAndSaturation(
    nodeId: NodeId,
    endpointId: EndpointId,
    hue: number,
    saturation: number,
    transitionTime?: number
  ): Promise<MatterCommandResponse> {
    return this.executeCommand(nodeId, endpointId, ClusterId.ColorControl, 0x0006, {
      hue,
      saturation,
      transitionTime: transitionTime || 0,
    });
  }

  /**
   * 锁门
   */
  async lockDoor(nodeId: NodeId, endpointId: EndpointId): Promise<MatterCommandResponse> {
    return this.executeCommand(nodeId, endpointId, ClusterId.DoorLock, 0x0000);
  }

  /**
   * 解锁门
   */
  async unlockDoor(nodeId: NodeId, endpointId: EndpointId): Promise<MatterCommandResponse> {
    return this.executeCommand(nodeId, endpointId, ClusterId.DoorLock, 0x0001);
  }

  /**
   * 打开窗帘
   */
  async openWindowCovering(nodeId: NodeId, endpointId: EndpointId): Promise<MatterCommandResponse> {
    return this.executeCommand(nodeId, endpointId, ClusterId.WindowCovering, 0x0000);
  }

  /**
   * 关闭窗帘
   */
  async closeWindowCovering(nodeId: NodeId, endpointId: EndpointId): Promise<MatterCommandResponse> {
    return this.executeCommand(nodeId, endpointId, ClusterId.WindowCovering, 0x0001);
  }

  /**
   * 设置窗帘位置
   */
  async setWindowCoveringPosition(
    nodeId: NodeId,
    endpointId: EndpointId,
    positionPercent: number
  ): Promise<MatterCommandResponse> {
    return this.executeCommand(nodeId, endpointId, ClusterId.WindowCovering, 0x0005, {
      positionPercent100ths: Math.round(positionPercent * 100),
    });
  }

  // ==================== 事件订阅 ====================

  /**
   * 订阅属性变化
   */
  async subscribeAttribute(
    nodeId: NodeId,
    endpointId: EndpointId,
    clusterId: ClusterId,
    attributeId: AttributeId,
    callback: (value: any) => void
  ): Promise<{ success: boolean; subscriptionId?: string; error?: string }> {
    const key = `${nodeId}:${endpointId}:${clusterId}:${attributeId}`;

    if (!this.attributeSubscriptions.has(key)) {
      this.attributeSubscriptions.set(key, new Set());
    }

    this.attributeSubscriptions.get(key)!.add(callback);

    const subscriptionId = IdGenerator.uuid();

    this.logger.info('[Matter SDK] Attribute subscribed', {
      subscriptionId,
      nodeId: nodeId.toString(16),
      endpointId,
      clusterId: clusterId.toString(16),
      attributeId: attributeId.toString(16),
    });

    return { success: true, subscriptionId };
  }

  /**
   * 取消订阅
   */
  async unsubscribeAttribute(subscriptionId: string): Promise<void> {
    // 实际实现需要维护订阅 ID 到回调的映射
    this.logger.info('[Matter SDK] Attribute unsubscribed', { subscriptionId });
  }

  // ==================== 节点管理 ====================

  /**
   * 获取所有已配网的节点
   */
  async getCommissionedNodes(): Promise<MatterDeviceInfo[]> {
    return Array.from(this.commissionedNodes.values());
  }

  /**
   * 获取节点信息
   */
  async getNode(nodeId: NodeId): Promise<MatterDeviceInfo | null> {
    return this.commissionedNodes.get(nodeId.toString()) || null;
  }

  /**
   * 检查节点可达性
   */
  async checkNodeReachability(nodeId: NodeId): Promise<boolean> {
    const node = this.commissionedNodes.get(nodeId.toString());
    if (!node) {
      return false;
    }

    // 模拟可达性检查
    // 实际实现需要使用 Matter SDK 的可达性检查功能
    return node.reachable;
  }

  // ==================== 私有方法 ====================

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
          // 转换 NodeId 为 BigInt
          nodeInfo.nodeId = BigInt(nodeInfo.nodeId);
          this.commissionedNodes.set(nodeInfo.nodeId.toString(), nodeInfo);
        }
      }

      this.logger.info(`[Matter SDK] Loaded ${this.commissionedNodes.size} commissioned nodes`);
    } catch (error) {
      this.logger.error('[Matter SDK] Failed to load commissioned nodes:', error);
    }
  }

  /**
   * 保存节点信息
   */
  private async saveNode(nodeId: NodeId, deviceInfo: MatterDeviceInfo): Promise<void> {
    const key = `${this.NODE_PREFIX}${nodeId}`;
    await this.redis.set(key, JSON.stringify(deviceInfo));
    this.commissionedNodes.set(nodeId.toString(), deviceInfo);
  }

  /**
   * 启动后台任务
   */
  private startBackgroundTasks(): void {
    // 定期检查节点可达性
    setInterval(() => this.checkAllNodesReachability(), 60000);
  }

  /**
   * 检查所有节点的可达性
   */
  private async checkAllNodesReachability(): Promise<void> {
    for (const [nodeId, node] of this.commissionedNodes) {
      try {
        // 模拟可达性检查
        // 实际实现需要使用 Matter SDK 的可达性检查功能
        const reachable = Math.random() > 0.1; // 90% 可达

        if (node.reachable !== reachable) {
          node.reachable = reachable;
          node.lastSeen = new Date();
          await this.saveNode(BigInt(nodeId), node);

          if (!reachable) {
            this.logger.warn(`[Matter SDK] Node ${nodeId} is now unreachable`);
          } else {
            this.logger.info(`[Matter SDK] Node ${nodeId} is now reachable`);
          }
        }
      } catch (error) {
        this.logger.error(`[Matter SDK] Failed to check reachability for node ${nodeId}:`, error);
      }
    }
  }

  /**
   * 验证 PIN 码
   */
  private validatePinCode(pinCode: number): boolean {
    // PIN 码应该是 8 位数字 (00000000 - 99999999)
    return pinCode >= 0 && pinCode <= 99999999;
  }

  /**
   * 执行配网（模拟）
   */
  private async performCommissioning(
    device: MatterDiscoveredDevice,
    params: MatterCommissioningParams
  ): Promise<NodeId> {
    // 模拟配网延迟
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 生成随机的 Node ID
    const nodeId = BigInt(`0x${Date.now().toString(16)}${Math.floor(Math.random() * 65535).toString(16).padStart(4, '0')}`);

    return nodeId;
  }

  /**
   * 模拟设备发现
   */
  private simulateDiscovery(timeout: number, filter?: any): void {
    const discoveryTimeout = setTimeout(() => {
      this.discoveryActive = false;
      this.logger.info('[Matter SDK] Discovery timeout reached');
    }, timeout);

    // 模拟发现一些设备
    setTimeout(() => {
      if (this.discoveryActive) {
        const mockDevice: MatterDiscoveredDevice = {
          instanceName: `Matter-Light-${Math.floor(Math.random() * 1000)}`,
          vendorId: 0x131b,
          productId: 0x0001,
          discriminator: Math.floor(Math.random() * 4096),
          commissioningMode: true,
          ipAddress: '192.168.1.100',
          port: 5540,
          discoveredAt: new Date(),
        };

        this.discoveredDevices.set(mockDevice.instanceName, mockDevice);
        this.logger.info('[Matter SDK] Discovered device:', mockDevice.instanceName);
      }
    }, 2000);

    setTimeout(() => {
      if (this.discoveryActive) {
        const mockDevice2: MatterDiscoveredDevice = {
          instanceName: `Matter-Sensor-${Math.floor(Math.random() * 1000)}`,
          vendorId: 0x131b,
          productId: 0x0002,
          discriminator: Math.floor(Math.random() * 4096),
          commissioningMode: true,
          ipAddress: '192.168.1.101',
          port: 5540,
          discoveredAt: new Date(),
        };

        this.discoveredDevices.set(mockDevice2.instanceName, mockDevice2);
        this.logger.info('[Matter SDK] Discovered device:', mockDevice2.instanceName);
      }
    }, 4000);
  }

  /**
   * 模拟属性读取
   */
  private async simulateAttributeRead(
    nodeId: NodeId,
    endpointId: EndpointId,
    clusterId: ClusterId,
    attributeId: AttributeId
  ): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 50));

    // 返回模拟值
    switch (clusterId) {
      case ClusterId.OnOff:
        return attributeId === 0x0000 ? Math.random() > 0.5 : null;
      case ClusterId.LevelControl:
        return attributeId === 0x0000 ? Math.floor(Math.random() * 255) : null;
      case ClusterId.TemperatureMeasurement:
        return attributeId === 0x0000 ? Math.floor(2000 + Math.random() * 1000) : null; // 20-30°C
      case ClusterId.RelativeHumidityMeasurement:
        return attributeId === 0x0000 ? Math.floor(3000 + Math.random() * 4000) : null; // 30-70%
      default:
        return null;
    }
  }

  /**
   * 模拟属性写入
   */
  private async simulateAttributeWrite(
    nodeId: NodeId,
    endpointId: EndpointId,
    clusterId: ClusterId,
    attributeId: AttributeId,
    value: any
  ): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 50));
    // 模拟写入成功
  }

  /**
   * 模拟命令执行
   */
  private async simulateCommandExecution(
    nodeId: NodeId,
    endpointId: EndpointId,
    clusterId: ClusterId,
    commandId: number,
    payload?: any
  ): Promise<MatterCommandResponse> {
    await new Promise(resolve => setTimeout(resolve, 100));

    // 模拟命令执行成功
    return {
      success: true,
      status: 0x00, // Success
      response: payload,
    };
  }

  /**
   * 通知属性订阅者
   */
  private async notifyAttributeSubscribers(
    nodeId: NodeId,
    endpointId: EndpointId,
    clusterId: ClusterId,
    attributeId: AttributeId,
    value: any
  ): Promise<void> {
    const key = `${nodeId}:${endpointId}:${clusterId}:${attributeId}`;
    const callbacks = this.attributeSubscriptions.get(key);

    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(value);
        } catch (error) {
          this.logger.error('[Matter SDK] Error in attribute subscription callback:', error);
        }
      }
    }
  }
}
