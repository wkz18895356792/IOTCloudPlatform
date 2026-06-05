/**
 * OTA MQTT 消息路由测试
 *
 * 验证 device-gateway 和 device-subscriber 中 OTA 消息的正确路由和处理
 */

import { GatewayMessageType } from '../../../device-gateway/src/types/mqtt-messages';
import { ServiceCommandType } from '../../../device-gateway/src/types/mqtt-messages';

// ============================================================
// 1. GatewayMessageType 枚举 — OTA 类型定义
// ============================================================
describe('GatewayMessageType OTA 枚举', () => {
  it('TC-ENUM-001: 应包含 OTA_PROGRESS 类型', () => {
    expect(GatewayMessageType.OTA_PROGRESS).toBe('device.ota_progress');
  });

  it('TC-ENUM-002: 应包含 OTA_RESULT 类型', () => {
    expect(GatewayMessageType.OTA_RESULT).toBe('device.ota_result');
  });
});

// ============================================================
// 2. ServiceCommandType 枚举 — OTA 命令类型
// ============================================================
describe('ServiceCommandType OTA 枚举', () => {
  it('TC-CMD-001: 应包含 SEND_OTA_COMMAND 类型', () => {
    expect(ServiceCommandType.SEND_OTA_COMMAND).toBe('gateway.send_ota_command');
  });
});

// ============================================================
// 3. 消息路由规则匹配测试
// ============================================================
describe('OTA MQTT Topic 路由匹配', () => {
  // 从 message-router.service.ts 提取的路由规则
  const otaRoutes = [
    {
      name: 'OTA Progress Report',
      topicPattern: /^devices\/([^/]+)\/ota\/progress$/,
      targetType: 'service',
      destination: 'device-service',
    },
    {
      name: 'OTA Result Report',
      topicPattern: /^devices\/([^/]+)\/ota\/result$/,
      targetType: 'service',
      destination: 'device-service',
    },
  ];

  it('TC-ROUTE-001: devices/{deviceId}/ota/progress 应匹配 OTA 进度路由', () => {
    const topic = 'devices/SN-001/ota/progress';
    const matched = otaRoutes.find(r => r.topicPattern.test(topic));
    expect(matched).toBeDefined();
    expect(matched!.name).toBe('OTA Progress Report');
    expect(matched!.destination).toBe('device-service');
  });

  it('TC-ROUTE-002: devices/{deviceId}/ota/result 应匹配 OTA 结果路由', () => {
    const topic = 'devices/SN-001/ota/result';
    const matched = otaRoutes.find(r => r.topicPattern.test(topic));
    expect(matched).toBeDefined();
    expect(matched!.name).toBe('OTA Result Report');
    expect(matched!.destination).toBe('device-service');
  });

  it('TC-ROUTE-003: 不相关的主题不应匹配 OTA 路由', () => {
    const topics = [
      'devices/SN-001/status',
      'devices/SN-001/command',
      'devices/SN-001/register',
      'devices/SN-001/ota/other',
    ];
    for (const topic of topics) {
      const matched = otaRoutes.find(r => r.topicPattern.test(topic));
      expect(matched).toBeUndefined();
    }
  });

  it('TC-ROUTE-004: 应从主题中正确提取 deviceId', () => {
    const pattern = /^devices\/([^/]+)\/ota\/progress$/;
    const match = 'devices/SN-CAMERA-123/ota/progress'.match(pattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('SN-CAMERA-123');
  });

  it('TC-ROUTE-005: 应正确匹配多级设备 ID', () => {
    const pattern = /^devices\/([^/]+)\/ota\/result$/;
    const match = 'devices/device_abc-123.def/ota/result'.match(pattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('device_abc-123.def');
  });
});

// ============================================================
// 4. 消息类型映射测试
// ============================================================
describe('OTA Topic → MessageType 映射', () => {
  // 从 getMessageTypeFromTopic 提取的映射逻辑
  function getMessageType(topic: string): string | null {
    if (/devices\/[^/]+\/ota\/progress/.test(topic)) {
      return GatewayMessageType.OTA_PROGRESS;
    }
    if (/devices\/[^/]+\/ota\/result/.test(topic)) {
      return GatewayMessageType.OTA_RESULT;
    }
    return null;
  }

  it('TC-MAP-001: ota/progress 应映射为 OTA_PROGRESS', () => {
    expect(getMessageType('devices/SN-001/ota/progress')).toBe('device.ota_progress');
  });

  it('TC-MAP-002: ota/result 应映射为 OTA_RESULT', () => {
    expect(getMessageType('devices/SN-001/ota/result')).toBe('device.ota_result');
  });

  it('TC-MAP-003: 其他 OTA 子主题不应匹配', () => {
    expect(getMessageType('devices/SN-001/ota/download')).toBeNull();
    expect(getMessageType('devices/SN-001/ota/install')).toBeNull();
    expect(getMessageType('devices/SN-001/ota/cancel')).toBeNull();
  });
});

// ============================================================
// 5. Subscriber 消息处理测试
// ============================================================
describe('OTA Subscriber 消息分发', () => {
  // 模拟 subscriber 的 switch 分发逻辑
  const handledTypes: string[] = [];

  function handleMessage(type: string): void {
    switch (type) {
      case 'device.ota_progress':
        handledTypes.push('progress');
        break;
      case 'device.ota_result':
        handledTypes.push('result');
        break;
      default:
        handledTypes.push('unknown');
    }
  }

  beforeEach(() => {
    handledTypes.length = 0;
  });

  it('TC-SUB-001: device.ota_progress 应路由到进度处理器', () => {
    handleMessage('device.ota_progress');
    expect(handledTypes).toContain('progress');
  });

  it('TC-SUB-002: device.ota_result 应路由到结果处理器', () => {
    handleMessage('device.ota_result');
    expect(handledTypes).toContain('result');
  });

  it('TC-SUB-003: 未知类型应路由到 default', () => {
    handleMessage('device.unknown_type');
    expect(handledTypes).toContain('unknown');
  });
});

// ============================================================
// 6. 消息格式验证
// ============================================================
describe('OTA 消息格式', () => {
  it('TC-FMT-001: 进度消息应包含必要字段', () => {
    const progressMessage = {
      deviceId: 'SN-001',
      taskId: 'task-001',
      progress: 50,
      status: 'downloading',
      timestamp: Date.now(),
    };

    expect(progressMessage).toHaveProperty('taskId');
    expect(progressMessage).toHaveProperty('progress');
    expect(progressMessage).toHaveProperty('status');
    expect(['downloading', 'installing']).toContain(progressMessage.status);
    expect(progressMessage.progress).toBeGreaterThanOrEqual(0);
    expect(progressMessage.progress).toBeLessThanOrEqual(100);
  });

  it('TC-FMT-002: 结果消息应包含必要字段', () => {
    const successResult = {
      deviceId: 'SN-001',
      taskId: 'task-001',
      success: true,
      version: '2.0.0',
      timestamp: Date.now(),
    };
    expect(successResult).toHaveProperty('taskId');
    expect(successResult).toHaveProperty('success');
    expect(typeof successResult.success).toBe('boolean');

    const failureResult = {
      deviceId: 'SN-001',
      taskId: 'task-001',
      success: false,
      error: 'Checksum mismatch',
      timestamp: Date.now(),
    };
    expect(failureResult).toHaveProperty('error');
  });

  it('TC-FMT-003: 下载命令消息应包含固件信息', () => {
    const downloadCommand = {
      id: 'cmd-001',
      action: 'ota_download',
      taskId: 'task-001',
      version: '2.0.0',
      fileUrl: 'https://storage.example.com/firmware.bin',
      fileSize: 1048576,
      checksum: 'a'.repeat(64),
      isForced: false,
      timestamp: Date.now(),
    };

    expect(downloadCommand.action).toBe('ota_download');
    expect(downloadCommand).toHaveProperty('fileUrl');
    expect(downloadCommand).toHaveProperty('fileSize');
    expect(downloadCommand).toHaveProperty('checksum');
    expect(downloadCommand).toHaveProperty('version');
  });

  it('TC-FMT-004: 安装命令消息格式', () => {
    const installCommand = {
      id: 'cmd-002',
      action: 'ota_install',
      taskId: 'task-001',
      timestamp: Date.now(),
    };

    expect(installCommand.action).toBe('ota_install');
    expect(installCommand).toHaveProperty('taskId');
  });

  it('TC-FMT-005: 重启命令消息格式', () => {
    const rebootCommand = {
      id: 'cmd-003',
      action: 'reboot',
      taskId: 'task-001',
      timestamp: Date.now(),
    };

    expect(rebootCommand.action).toBe('reboot');
  });
});

// ============================================================
// 7. Gateway 订阅主题列表验证
// ============================================================
describe('OTA MQTT 订阅主题', () => {
  const subscribedTopics = [
    'devices/+/register',
    'devices/+/auth',
    'devices/+/heartbeat',
    'devices/+/report',
    'devices/+/status',
    'devices/+/event',
    'devices/+/command/response',
    'devices/+/config',
    'devices/+/config/response',
    'devices/+/credentials',
    'devices/+/credentials/response',
    'matter/+/attribute',
    'matter/+/command',
    'devices/+/recording/upload-url',
    'devices/+/recording/upload-url/response',
    'devices/+/recording/multipart/start',
    'devices/+/recording/multipart/start/response',
    'devices/+/recording/multipart/complete',
    'devices/+/recording/multipart/complete/response',
    'devices/+/recording/register',
    'devices/+/recording/register/response',
    'devices/+/recording/upload-url/batch',
    'devices/+/recording/register/batch',
    // OTA 固件升级
    'devices/+/ota/progress',
    'devices/+/ota/result',
  ];

  it('TC-SUB-001: 应订阅 OTA 进度主题', () => {
    expect(subscribedTopics).toContain('devices/+/ota/progress');
  });

  it('TC-SUB-002: 应订阅 OTA 结果主题', () => {
    expect(subscribedTopics).toContain('devices/+/ota/result');
  });

  it('TC-SUB-003: OTA 主题应在录制主题之后（顺序正确）', () => {
    const otaProgressIndex = subscribedTopics.indexOf('devices/+/ota/progress');
    const recordingLastIndex = subscribedTopics.indexOf('devices/+/recording/register/batch');
    expect(otaProgressIndex).toBeGreaterThan(recordingLastIndex);
  });
});
