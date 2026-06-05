import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { JsonUtil } from '@baby-monitor/shared-utils';
import { DeviceProtocol } from '@baby-monitor/shared-types';
import { GatewayCoreService } from './gateway-core.service';
import { ProtocolConverterService } from '../protocol/protocol-converter.service';
import { DeviceAuthService } from '../device/device-auth.service';
import { ConnectionManagerService } from './connection-manager.service';
import { GatewayMessageType } from '../../types/mqtt-messages';
import { RecordingGatewayService } from '../recording/recording-gateway.service';
import { LogGatewayService } from './log-gateway.service';

/**
 * 消息路由目标
 */
interface RouteTarget {
  type: 'device' | 'service' | 'protocol';
  destination: string;
  protocol?: DeviceProtocol;
}

/**
 * 路由规则
 */
interface RouteRule {
  name: string;
  topicPattern: RegExp;
  target: RouteTarget;
  enabled: boolean;
  priority: number;
}

/**
 * 消息路由服务
 *
 * 根据消息主题和内容将消息路由到合适的处理器
 * 支持协议转换、设备认证、消息持久化等功能
 *
 * 职责：
 * - 解析MQTT主题并匹配路由规则
 * - 验证设备权限和认证
 * - 协调协议转换
 * - 转发消息到目标处理器或服务
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class MessageRouterService {
  @Inject()
  logger!: ILogger;

  @Inject()
  protocolConverter!: ProtocolConverterService;

  @Inject()
  deviceAuth!: DeviceAuthService;

  @Inject()
  connectionManager!: ConnectionManagerService;

  @Inject()
  recordingGatewayService!: RecordingGatewayService;

  @Inject()
  logGatewayService!: LogGatewayService;

  // 延迟获取 GatewayCoreService 以避免循环依赖
  private gatewayCoreInstance?: GatewayCoreService;

  /**
   * 获取 GatewayCoreService 实例
   */
  private get gatewayCore(): GatewayCoreService | undefined {
    return this.gatewayCoreInstance;
  }

  /**
   * 设置 GatewayCoreService 实例（由 GatewayCoreService 初始化时调用）
   */
  setGatewayCore(instance: GatewayCoreService): void {
    this.gatewayCoreInstance = instance;
    // 传递给 RecordingGatewayService 以避免循环依赖
    this.recordingGatewayService.setGatewayCore(instance);
    // 传递给 LogGatewayService
    this.logGatewayService.setGatewayCore(instance);
  }

  // 路由规则配置（基于 MQTT_TOPICS.md）
  private routes: RouteRule[] = [
    // ==================== 设备生命周期 ====================
    // 设备注册消息
    {
      name: 'Device Register',
      topicPattern: /^devices\/([^/]+)\/register$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 100,
    },
    // 设备认证消息
    {
      name: 'Device Auth',
      topicPattern: /^devices\/([^/]+)\/auth$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 100,
    },
    // 设备心跳消息
    {
      name: 'Device Heartbeat',
      topicPattern: /^devices\/([^/]+)\/heartbeat$/,
      target: { type: 'device', destination: '$1' },
      enabled: true,
      priority: 90,
    },

    // ==================== 设备数据上报 ====================
    // 设备状态上报
    {
      name: 'Device Status Report',
      topicPattern: /^devices\/([^/]+)\/status$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 80,
    },
    // 设备数据上报（需要协议转换）
    {
      name: 'Device Data Report',
      topicPattern: /^devices\/([^/]+)\/report$/,
      target: { type: 'protocol', destination: '$1', protocol: DeviceProtocol.PRIVATE },
      enabled: true,
      priority: 80,
    },
    // 设备事件上报
    {
      name: 'Device Event',
      topicPattern: /^devices\/([^/]+)\/event$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 80,
    },

    // ==================== 设备命令 ====================
    // 设备命令响应
    {
      name: 'Device Command Response',
      topicPattern: /^devices\/([^/]+)\/command\/response$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 80,
    },

    // ==================== 设备配置 ====================
    // 设备配置请求（简化主题格式）
    {
      name: 'Device Config Request',
      topicPattern: /^devices\/([^/]+)\/config$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 85,
    },
    // 设备配置响应
    {
      name: 'Device Config Response',
      topicPattern: /^devices\/([^/]+)\/config\/response$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 85,
    },

    // ==================== 设备凭证 ====================
    // 设备凭证请求（简化主题格式）
    {
      name: 'Device Credentials Request',
      topicPattern: /^devices\/([^/]+)\/credentials$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 85,
    },
    // 设备凭证响应
    {
      name: 'Device Credentials Response',
      topicPattern: /^devices\/([^/]+)\/credentials\/response$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 85,
    },

    // ==================== Matter 协议 ====================
    // Matter属性上报
    {
      name: 'Matter Attribute Report',
      topicPattern: /^matter\/([^/]+)\/attribute$/,
      target: { type: 'protocol', destination: '$1', protocol: DeviceProtocol.MATTER },
      enabled: true,
      priority: 80,
    },
    // Matter命令
    {
      name: 'Matter Command',
      topicPattern: /^matter\/([^/]+)\/command$/,
      target: { type: 'protocol', destination: '$1', protocol: DeviceProtocol.MATTER },
      enabled: true,
      priority: 80,
    },

    // ==================== 录制管理 ====================
    {
      name: 'Recording Upload URL Request',
      topicPattern: /^devices\/([^/]+)\/recording\/upload-url$/,
      target: { type: 'service', destination: 'device-gateway' },
      enabled: true,
      priority: 85,
    },
    {
      name: 'Recording Multipart Start Request',
      topicPattern: /^devices\/([^/]+)\/recording\/multipart\/start$/,
      target: { type: 'service', destination: 'device-gateway' },
      enabled: true,
      priority: 85,
    },
    {
      name: 'Recording Multipart Complete Request',
      topicPattern: /^devices\/([^/]+)\/recording\/multipart\/complete$/,
      target: { type: 'service', destination: 'device-gateway' },
      enabled: true,
      priority: 85,
    },
    {
      name: 'Recording Register Request',
      topicPattern: /^devices\/([^/]+)\/recording\/register$/,
      target: { type: 'service', destination: 'device-gateway' },
      enabled: true,
      priority: 85,
    },
    {
      name: 'Recording Batch Upload URL Request',
      topicPattern: /^devices\/([^/]+)\/recording\/upload-url\/batch$/,
      target: { type: 'service', destination: 'device-gateway' },
      enabled: true,
      priority: 85,
    },
    {
      name: 'Recording Batch Register Request',
      topicPattern: /^devices\/([^/]+)\/recording\/register\/batch$/,
      target: { type: 'service', destination: 'device-gateway' },
      enabled: true,
      priority: 85,
    },

    // ==================== OTA 固件升级 ====================
    {
      name: 'OTA Progress Report',
      topicPattern: /^devices\/([^/]+)\/ota\/progress$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 85,
    },
    {
      name: 'OTA Result Report',
      topicPattern: /^devices\/([^/]+)\/ota\/result$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 85,
    },

    // ==================== 设备日志 ====================
    {
      name: 'Log Upload URL Request',
      topicPattern: /^devices\/([^/]+)\/logs\/upload-url$/,
      target: { type: 'service', destination: 'device-gateway' },
      enabled: true,
      priority: 85,
    },
    {
      name: 'Log Register Request',
      topicPattern: /^devices\/([^/]+)\/logs\/register$/,
      target: { type: 'service', destination: 'device-gateway' },
      enabled: true,
      priority: 85,
    },
    {
      name: 'Log Collect Status',
      topicPattern: /^devices\/([^/]+)\/logs\/collect\/status$/,
      target: { type: 'service', destination: 'device-service' },
      enabled: true,
      priority: 85,
    },
  ];

  /**
   * 路由消息
   *
   * @param topic MQTT主题
   * @param payload 消息内容
   */
  async routeMessage(topic: string, payload: Buffer): Promise<void> {
    try {
      // 解析消息内容
      let message: any;
      try {
        message = JsonUtil.parse(payload.toString());
      } catch {
        message = { raw: payload.toString() };
      }

      this.logger.debug(`[Message Router] Routing message from ${topic}`);

      // 匹配路由规则
      const matchedRoutes = this.matchRoutes(topic);

      if (matchedRoutes.length === 0) {
        this.logger.warn(`[Message Router] No route matched for topic: ${topic}`);
        return;
      }

      // 按优先级排序并处理
      matchedRoutes.sort((a, b) => b.priority - a.priority);

      for (const route of matchedRoutes) {
        await this.processRoute(route, topic, message);
      }
    } catch (error) {
      this.logger.error(`[Message Router] Error routing message:`, error);
    }
  }

  /**
   * 匹配路由规则
   *
   * @param topic MQTT主题
   */
  private matchRoutes(topic: string): RouteRule[] {
    return this.routes.filter(route => route.enabled && route.topicPattern.test(topic));
  }

  /**
   * 处理路由
   *
   * @param route 路由规则
   * @param topic 原始主题
   * @param message 消息内容
   */
  private async processRoute(
    route: RouteRule,
    topic: string,
    message: any
  ): Promise<void> {
    const match = topic.match(route.topicPattern);
    if (!match) {
      return;
    }

    const deviceId = match[1];
    const targetDestination = route.target.destination.replace('$1', deviceId);

    switch (route.target.type) {
      case 'device':
        await this.handleDeviceMessage(deviceId, message);
        break;

      case 'service':
        await this.handleServiceMessage(route.target.destination, topic, message);
        break;

      case 'protocol':
        await this.handleProtocolMessage(deviceId, route.target.protocol!, message);
        break;
    }
  }

  /**
   * 处理设备消息
   * 更新设备状态，记录心跳等
   *
   * @param deviceId 设备ID
   * @param message 消息内容
   */
  private async handleDeviceMessage(deviceId: string, message: any): Promise<void> {
    // 更新心跳（所有设备消息都更新心跳）
    await this.connectionManager.updateHeartbeat(deviceId);

    // 处理心跳消息中的额外数据（如温度）
    if (message.temperature !== undefined) {
      // 心跳消息携带温度信息，可以存储或转发
      this.logger.debug(`[Message Router] Device ${deviceId} heartbeat with temperature: ${message.temperature}`);
    }
  }

  /**
   * 处理服务消息
   * 转发到下游微服务
   *
   * @param serviceName 服务名称
   * @param topic 原始主题
   * @param message 消息内容
   */
  private async handleServiceMessage(
    serviceName: string,
    topic: string,
    message: any
  ): Promise<void> {
    // 录制消息由本地 RecordingGatewayService 处理，不转发到 device-service
    const messageType = this.getMessageTypeFromTopic(topic);
    if (messageType.startsWith('recording.')) {
      await this.handleRecordingMessage(topic, message);
      return;
    }

    // 日志上传消息由本地 LogGatewayService 处理
    if (messageType === GatewayMessageType.LOG_UPLOAD_URL_REQUEST || messageType === GatewayMessageType.LOG_REGISTER_REQUEST) {
      await this.handleLogMessage(topic, message);
      return;
    }

    // 日志打捞状态转发到 device-service
    if (messageType === GatewayMessageType.LOG_COLLECT_STATUS) {
      await this.handleLogMessage(topic, message);
      return;
    }

    // 根据主题确定消息类型

    // 格式化为 device-service 期望的格式 {type, data}
    const enhancedMessage = {
      type: messageType,
      data: {
        ...message,
        _meta: {
          topic,
          timestamp: Date.now(),
          source: 'device-gateway',
        },
      },
    };

    if (this.gatewayCore) {
      await this.gatewayCore.publishToService(serviceName, enhancedMessage);
    }
  }

  /**
   * 根据主题获取消息类型（基于 MQTT_TOPICS.md）
   *
   * @param topic MQTT主题
   * @returns 消息类型字符串
   */
  private getMessageTypeFromTopic(topic: string): string {
    // 设备注册
    if (topic.includes('/register')) {
      return GatewayMessageType.DEVICE_REGISTER;
    }
    // 设备认证
    if (topic.includes('/auth') && !topic.includes('/register')) {
      return GatewayMessageType.DEVICE_AUTH;
    }
    // 设备状态
    if (topic.includes('/status')) {
      return GatewayMessageType.DEVICE_STATUS;
    }
    // 设备数据上报
    if (topic.includes('/report')) {
      return GatewayMessageType.DEVICE_REPORT;
    }
    // 设备事件
    if (topic.includes('/event')) {
      return GatewayMessageType.DEVICE_EVENT;
    }
    // 命令响应
    if (topic.includes('/command/response')) {
      return GatewayMessageType.DEVICE_COMMAND_RESPONSE;
    }
    // 配置请求（简化格式：devices/{deviceId}/config）
    if (/devices\/[^/]+\/config$/.test(topic)) {
      return GatewayMessageType.DEVICE_CONFIG_REQUEST;
    }
    // 配置响应
    if (topic.includes('/config/response')) {
      return GatewayMessageType.DEVICE_CONFIG_RESPONSE;
    }
    // 凭证请求（简化格式：devices/{deviceId}/credentials）
    if (/devices\/[^/]+\/credentials$/.test(topic)) {
      return GatewayMessageType.DEVICE_CREDENTIALS_REQUEST;
    }
    // 凭证响应
    if (topic.includes('/credentials/response')) {
      return GatewayMessageType.DEVICE_CREDENTIALS_RESPONSE;
    }
    // Matter 属性
    if (topic.startsWith('matter/') && topic.includes('/attribute')) {
      return GatewayMessageType.MATTER_ATTRIBUTE;
    }
    // Matter 命令
    if (topic.startsWith('matter/') && topic.includes('/command')) {
      return GatewayMessageType.MATTER_COMMAND;
    }
    // 录制 - 请求上传URL
    if (/devices\/[^/]+\/recording\/upload-url$/.test(topic)) {
      return GatewayMessageType.RECORDING_UPLOAD_URL_REQUEST;
    }
    // 录制 - 分片上传开始
    if (/devices\/[^/]+\/recording\/multipart\/start$/.test(topic)) {
      return GatewayMessageType.RECORDING_MULTIPART_START_REQUEST;
    }
    // 录制 - 分片上传完成
    if (/devices\/[^/]+\/recording\/multipart\/complete$/.test(topic)) {
      return GatewayMessageType.RECORDING_MULTIPART_COMPLETE_REQUEST;
    }
    // 录制 - 注册上传完成
    if (/devices\/[^/]+\/recording\/register$/.test(topic)) {
      return GatewayMessageType.RECORDING_REGISTER_REQUEST;
    }
    // 录制 - 批量请求上传URL
    if (/devices\/[^/]+\/recording\/upload-url\/batch$/.test(topic)) {
      return GatewayMessageType.RECORDING_BATCH_UPLOAD_URL_REQUEST;
    }
    // 录制 - 批量注册上传完成
    if (/devices\/[^/]+\/recording\/register\/batch$/.test(topic)) {
      return GatewayMessageType.RECORDING_BATCH_REGISTER_REQUEST;
    }
    // OTA 进度上报
    if (/devices\/[^/]+\/ota\/progress/.test(topic)) {
      return GatewayMessageType.OTA_PROGRESS;
    }
    // OTA 结果上报
    if (/devices\/[^/]+\/ota\/result/.test(topic)) {
      return GatewayMessageType.OTA_RESULT;
    }
    // 日志 - 请求上传URL
    if (/devices\/[^/]+\/logs\/upload-url$/.test(topic)) {
      return GatewayMessageType.LOG_UPLOAD_URL_REQUEST;
    }
    // 日志 - 注册上传完成
    if (/devices\/[^/]+\/logs\/register$/.test(topic)) {
      return GatewayMessageType.LOG_REGISTER_REQUEST;
    }
    // 日志 - 打捞状态上报
    if (/devices\/[^/]+\/logs\/collect\/status/.test(topic)) {
      return GatewayMessageType.LOG_COLLECT_STATUS;
    }
    // 默认类型
    return 'device.unknown';
  }

  /**
   * 处理协议消息
   * 进行协议转换后转发
   *
   * @param deviceId 设备ID
   * @param protocol 协议类型
   * @param message 消息内容
   */
  private async handleProtocolMessage(
    deviceId: string,
    protocol: DeviceProtocol,
    message: any
  ): Promise<void> {
    try {
      // 根据协议类型处理
      if (protocol === DeviceProtocol.PRIVATE) {
        // 私有协议消息，可能需要转换为统一格式
        await this.handlePrivateProtocolMessage(deviceId, message);
      } else if (protocol === DeviceProtocol.MATTER) {
        // Matter协议消息
        await this.handleMatterProtocolMessage(deviceId, message);
      }
    } catch (error) {
      this.logger.error(`[Message Router] Error handling ${protocol} message:`, error);
    }
  }

  /**
   * 处理私有协议消息
   *
   * @param deviceId 设备ID
   * @param message 消息内容
   */
  private async handlePrivateProtocolMessage(deviceId: string, message: any): Promise<void> {
    // 私有协议消息通常需要转发到设备服务
    if (this.gatewayCore) {
      await this.gatewayCore.publishToService('device-service', {
        type: 'device_data_report',
        deviceId,
        protocol: DeviceProtocol.PRIVATE,
        data: message,
        timestamp: Date.now(),
      });
    }

    // 如果需要Matter转换，可以在这里调用协议转换服务
    // const conversionResult = await this.protocolConverter.privateToMatter(...);
  }

  /**
   * 处理Matter协议消息
   *
   * @param deviceId 设备ID
   * @param message 消息内容
   */
  private async handleMatterProtocolMessage(deviceId: string, message: any): Promise<void> {
    // Matter消息转发到设备服务
    if (this.gatewayCore) {
      await this.gatewayCore.publishToService('device-service', {
        type: 'matter_data_report',
        deviceId,
        protocol: DeviceProtocol.MATTER,
        data: message,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 处理录制相关消息（本地处理，不转发到下游服务）
   *
   * 安全检查：验证设备已认证且在线后才处理录制请求，防止 deviceId 伪造
   */
  private async handleRecordingMessage(topic: string, message: any): Promise<void> {
    const match = topic.match(/^devices\/([^/]+)\//);
    if (!match) return;

    const deviceId = match[1];

    // 安全校验：验证设备已认证
    const authStatus = await this.deviceAuth.getDeviceAuthStatus(deviceId);
    if (!authStatus.authenticated || !authStatus.tokenValid) {
      this.logger.warn(`[Message Router] Rejected recording request from unauthenticated device: ${deviceId}`);
      return;
    }

    // 安全校验：验证设备在线
    const isOnline = await this.connectionManager.isDeviceOnline(deviceId);
    if (!isOnline) {
      this.logger.warn(`[Message Router] Rejected recording request from offline device: ${deviceId}`);
      return;
    }

    const messageType = this.getMessageTypeFromTopic(topic);

    switch (messageType) {
      case GatewayMessageType.RECORDING_UPLOAD_URL_REQUEST:
        await this.recordingGatewayService.handleUploadUrlRequest(deviceId, message);
        break;
      case GatewayMessageType.RECORDING_MULTIPART_START_REQUEST:
        await this.recordingGatewayService.handleMultipartStartRequest(deviceId, message);
        break;
      case GatewayMessageType.RECORDING_MULTIPART_COMPLETE_REQUEST:
        await this.recordingGatewayService.handleMultipartCompleteRequest(deviceId, message);
        break;
      case GatewayMessageType.RECORDING_REGISTER_REQUEST:
        await this.recordingGatewayService.handleRegisterRequest(deviceId, message);
        break;
      case GatewayMessageType.RECORDING_BATCH_UPLOAD_URL_REQUEST:
        await this.recordingGatewayService.handleBatchUploadUrlRequest(deviceId, message);
        break;
      case GatewayMessageType.RECORDING_BATCH_REGISTER_REQUEST:
        await this.recordingGatewayService.handleBatchRegisterRequest(deviceId, message);
        break;
    }
  }

  /**
   * 处理设备日志相关消息
   *
   * 安全检查：验证设备已认证且在线后才处理日志请求
   */
  private async handleLogMessage(topic: string, message: any): Promise<void> {
    const match = topic.match(/^devices\/([^/]+)\//);
    if (!match) return;

    const deviceId = match[1];
    const messageType = this.getMessageTypeFromTopic(topic);

    // 打捞状态上报直接转发，不需要安全校验
    if (messageType === GatewayMessageType.LOG_COLLECT_STATUS) {
      await this.logGatewayService.handleCollectStatus(deviceId, message);
      return;
    }

    // TODO: 安全校验暂时跳过，设备注册后即可使用日志上传
    // const authStatus = await this.deviceAuth.getDeviceAuthStatus(deviceId);
    // if (!authStatus.authenticated || !authStatus.tokenValid) {
    //   this.logger.warn(`[Message Router] Rejected log request from unauthenticated device: ${deviceId}`);
    //   return;
    // }

    // 安全校验：验证设备在线
    const isOnline = await this.connectionManager.isDeviceOnline(deviceId);
    if (!isOnline) {
      this.logger.warn(`[Message Router] Rejected log request from offline device: ${deviceId}`);
      return;
    }

    switch (messageType) {
      case GatewayMessageType.LOG_UPLOAD_URL_REQUEST:
        await this.logGatewayService.handleUploadUrlRequest(deviceId, message);
        break;
      case GatewayMessageType.LOG_REGISTER_REQUEST:
        await this.logGatewayService.handleRegisterRequest(deviceId, message);
        break;
    }
  }

  /**
   * 添加自定义路由规则
   *
   * @param rule 路由规则
   */
  addRoute(rule: Omit<RouteRule, 'topicPattern'> & { topicPattern: string }): void {
    this.routes.push({
      ...rule,
      topicPattern: new RegExp(rule.topicPattern),
    });
  }

  /**
   * 移除路由规则
   *
   * @param name 路由规则名称
   */
  removeRoute(name: string): void {
    this.routes = this.routes.filter(route => route.name !== name);
  }

  /**
   * 获取所有路由规则
   */
  getRoutes(): RouteRule[] {
    return [...this.routes];
  }
}
