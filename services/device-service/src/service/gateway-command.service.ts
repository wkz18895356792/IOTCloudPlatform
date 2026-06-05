import { Provide, Inject, Scope, ScopeEnum, Init } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import Redis from 'ioredis';
import { JsonUtil, IdGenerator } from '@baby-monitor/shared-utils';

/**
 * 网关命令服务
 *
 * 封装通过 Redis Pub/Sub 向 device-gateway 发送命令的逻辑。
 * device-service 不直接连接 MQTT，所有向设备下发消息的操作都通过此服务转发给 device-gateway，
 * 由 device-gateway 统一通过 MQTT 下发到设备。
 *
 * Redis 频道：service:device-gateway
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class GatewayCommandService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redisService!: RedisService;

  private static readonly GATEWAY_CHANNEL = 'service:device-gateway';

  /** 独立的 Redis 发布客户端 */
  private redisPublisher!: Redis;

  @Init()
  async init(): Promise<void> {
    const redisConfig = (this.redisService as any).getOption?.('client') || {};
    const host = redisConfig.host || process.env.REDIS_HOST || 'localhost';
    const port = redisConfig.port || parseInt(process.env.REDIS_PORT || '6379');

    this.redisPublisher = new Redis({
      host,
      port,
      password: redisConfig.password || process.env.REDIS_PASSWORD || undefined,
      db: redisConfig.db || parseInt(process.env.REDIS_DB || '0'),
      maxRetriesPerRequest: 3,
    });

    this.logger.info('[GatewayCommand] Initialized');
  }

  /**
   * 向设备下发命令（通过 device-gateway 转发 MQTT）
   *
   * @param deviceId 设备ID
   * @param action 命令动作（如 ota_download, collect_logs, reboot 等）
   * @param payload 命令参数
   */
  async sendDeviceCommand(
    deviceId: string,
    action: string,
    payload: Record<string, any>,
  ): Promise<void> {
    const command = {
      type: 'gateway.send_command',
      deviceId,
      timestamp: Date.now(),
      command: action,
      commandId: IdGenerator.uuid(),
      data: payload,
    };

    await this.redisPublisher.publish(
      GatewayCommandService.GATEWAY_CHANNEL,
      JsonUtil.stringify(command),
    );

    this.logger.info(`[GatewayCommand] Sent command "${action}" to device: ${deviceId}`);
  }

  /**
   * 向 device-gateway 发送 OTA 升级命令
   *
   * @param deviceId 设备ID
   * @param action OTA动作（ota_download/ota_install/ota_cancel/ota_pause/ota_resume/reboot）
   * @param taskId OTA任务ID
   * @param payload 额外参数
   */
  async sendOTACommand(
    deviceId: string,
    action: string,
    taskId: string,
    payload?: Record<string, any>,
  ): Promise<void> {
    const command = {
      type: 'gateway.send_ota_command',
      deviceId,
      timestamp: Date.now(),
      action,
      taskId,
      payload,
    };

    await this.redisPublisher.publish(
      GatewayCommandService.GATEWAY_CHANNEL,
      JsonUtil.stringify(command),
    );

    this.logger.info(`[GatewayCommand] Sent OTA command "${action}" to device: ${deviceId}, task: ${taskId}`);
  }

  /**
   * 向 device-gateway 发送日志打捞命令
   *
   * @param deviceId 设备ID
   * @param taskId 日志任务ID
   * @param logType 日志类型
   * @param uploadUrl 预签名上传URL
   * @param fileKey 文件Key
   * @param expiresAt URL过期时间
   * @param description 描述
   */
  async sendCollectLogsCommand(
    deviceId: string,
    taskId: string,
    logType: string,
    uploadUrl: string,
    fileKey: string,
    expiresAt: string,
    description?: string,
  ): Promise<void> {
    const command = {
      type: 'gateway.send_collect_logs_command',
      deviceId,
      timestamp: Date.now(),
      taskId,
      logType,
      uploadUrl,
      fileKey,
      expiresAt,
      description,
    };

    await this.redisPublisher.publish(
      GatewayCommandService.GATEWAY_CHANNEL,
      JsonUtil.stringify(command),
    );

    this.logger.info(`[GatewayCommand] Sent collect_logs command to device: ${deviceId}, task: ${taskId}`);
  }
}
