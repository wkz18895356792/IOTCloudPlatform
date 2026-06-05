import { OTAService } from '../../src/service/ota.service';
import { FirmwareVersion } from '../../src/entity/firmware-version.entity';
import { OTATask } from '../../src/entity/ota-task.entity';
import { Device } from '../../src/entity/device.entity';

/**
 * OTA 升级服务 单元测试
 *
 * 覆盖 OTA 全流程中的所有核心函数：
 * 1. 固件上传（uploadFirmware）
 * 2. 检查更新（checkUpdate）
 * 3. 创建升级任务（createOTATask）
 * 4. 进度处理（handleOTAPProgress）
 * 5. 结果处理（handleOTAResult）
 * 6. 任务控制（cancel / pause / resume）
 * 7. 设备重注册同步（syncOTATasksOnReRegistration）
 * 8. 辅助功能（分页查询、旧任务清理）
 */

// ============================================================
// Mock 工厂函数
// ============================================================

function createMockFirmware(overrides?: Partial<FirmwareVersion>): FirmwareVersion {
  return {
    id: 'fw-001',
    productId: 'PROD-camera-v2',
    version: '2.0.0',
    releaseNotes: 'Bug fixes',
    fileUrl: 'https://storage.example.com/firmware/v2.0.0.bin',
    fileSize: 524288,
    checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    checksumType: 'sha256',
    isForced: false,
    isBeta: false,
    isActive: true,
    versionName: null,
    minVersion: '1.0.0',
    maxVersion: null,
    uploadedAt: new Date(),
    ...overrides,
  } as FirmwareVersion;
}

function createMockDevice(overrides?: Partial<Device>): Device {
  return {
    id: 'dev-uuid-001',
    serialNumber: 'SN-TEST-001',
    productId: 'PROD-camera-v2',
    name: 'Test Device',
    firmwareVersion: '1.0.0',
    status: 'online' as any,
    lastOnline: new Date(),
    ...overrides,
  } as Device;
}

function createMockTask(overrides?: Partial<OTATask>): OTATask {
  return {
    id: 'task-001',
    deviceId: 'SN-TEST-001',
    firmwareId: 'fw-001',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    status: 'pending',
    progress: 0,
    error: null,
    startedAt: null,
    completedAt: null,
    createdBy: 'user-001',
    createdAt: new Date(),
    ...overrides,
  } as OTATask;
}

// ============================================================
// Mock 依赖
// ============================================================

const mockFirmwareRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockOtaTaskRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockDeviceRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
};

const mockMqttService = {
  publish: jest.fn().mockResolvedValue(undefined),
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockFirmwareSignatureService = {
  isRevoked: jest.fn().mockResolvedValue(false),
  verifyHash: jest.fn().mockResolvedValue(true),
};

// ============================================================
// 测试主体
// ============================================================

describe('OTAService', () => {
  let otaService: OTAService;

  beforeEach(() => {
    jest.clearAllMocks();

    otaService = new OTAService();
    // 注入 mock 依赖（利用 public 属性）
    (otaService as any).logger = mockLogger;
    (otaService as any).redis = mockRedis;
    (otaService as any).mqttService = mockMqttService;
    (otaService as any).firmwareVersionRepository = mockFirmwareRepo;
    (otaService as any).otaTaskRepository = mockOtaTaskRepo;
    (otaService as any).deviceRepository = mockDeviceRepo;
    (otaService as any).firmwareSignatureService = mockFirmwareSignatureService;
  });

  // ============================================================
  // 1. uploadFirmware — 固件上传
  // ============================================================
  describe('uploadFirmware()', () => {
    const validData = {
      productId: 'PROD-camera-v2',
      version: '2.0.0',
      releaseNotes: 'Bug fixes',
      fileUrl: 'https://storage.example.com/firmware.bin',
      fileSize: 524288,
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    };

    it('TC-UPLOAD-001: 应成功上传固件并返回 FirmwareVersion', async () => {
      const mockFirmware = createMockFirmware(validData);
      mockFirmwareRepo.findOne.mockResolvedValue(null); // 无重复
      mockFirmwareRepo.create.mockReturnValue(mockFirmware);
      mockFirmwareRepo.save.mockResolvedValue(mockFirmware);

      const result = await otaService.uploadFirmware(validData);

      expect(result).toBeDefined();
      expect(result.version).toBe('2.0.0');
      expect(result.productId).toBe('PROD-camera-v2');
      expect(mockFirmwareRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          version: '2.0.0',
          checksumType: 'sha256',
        })
      );
      expect(mockFirmwareRepo.save).toHaveBeenCalled();
    });

    it('TC-UPLOAD-002: 应拒绝无效的校验和格式', async () => {
      await expect(
        otaService.uploadFirmware({ ...validData, checksum: 'not-a-checksum' })
      ).rejects.toThrow('Invalid');
    });

    it('TC-UPLOAD-003: 应拒绝无效的 MD5 校验和格式', async () => {
      await expect(
        otaService.uploadFirmware({
          ...validData,
          checksum: 'not-md5',
          checksumType: 'md5' as any,
        })
      ).rejects.toThrow('Invalid md5 checksum format');
    });

    it('TC-UPLOAD-004: 应拒绝重复的固件版本', async () => {
      mockFirmwareRepo.findOne.mockResolvedValue(createMockFirmware()); // 已存在

      await expect(
        otaService.uploadFirmware(validData)
      ).rejects.toThrow('already exists');
    });

    it('TC-UPLOAD-005: 应根据 checksum 长度自动推断类型为 sha256', async () => {
      const sha256Checksum = 'a'.repeat(64);
      mockFirmwareRepo.findOne.mockResolvedValue(null);
      mockFirmwareRepo.create.mockImplementation((d) => d);
      mockFirmwareRepo.save.mockImplementation((d) => d);

      await otaService.uploadFirmware({ ...validData, checksum: sha256Checksum });

      expect(mockFirmwareRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ checksumType: 'sha256' })
      );
    });

    it('TC-UPLOAD-006: 应根据 checksum 长度自动推断类型为 md5', async () => {
      const md5Checksum = 'a'.repeat(32);
      mockFirmwareRepo.findOne.mockResolvedValue(null);
      mockFirmwareRepo.create.mockImplementation((d) => d);
      mockFirmwareRepo.save.mockImplementation((d) => d);

      await otaService.uploadFirmware({ ...validData, checksum: md5Checksum });

      expect(mockFirmwareRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ checksumType: 'md5' })
      );
    });
  });

  // ============================================================
  // 2. checkUpdate — 检查更新
  // ============================================================
  describe('checkUpdate()', () => {
    it('TC-CHK-001: 设备不存在时应返回 null', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);

      const result = await otaService.checkUpdate('nonexistent-device');

      expect(result).toBeNull();
    });

    it('TC-CHK-002: 无可用固件时返回 hasUpdate=false', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice());
      mockFirmwareRepo.findOne.mockResolvedValue(null);

      const result = await otaService.checkUpdate('SN-TEST-001');

      expect(result).toEqual({ hasUpdate: false, isForced: false });
    });

    it('TC-CHK-003: 有新版本时返回 hasUpdate=true 和固件信息', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice({ firmwareVersion: '1.0.0' }));
      mockFirmwareRepo.findOne.mockResolvedValue(createMockFirmware({ version: '2.0.0' }));

      const result = await otaService.checkUpdate('SN-TEST-001');

      expect(result?.hasUpdate).toBe(true);
      expect(result?.firmware?.version).toBe('2.0.0');
    });

    it('TC-CHK-004: 版本相同时返回 hasUpdate=false', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice({ firmwareVersion: '2.0.0' }));
      mockFirmwareRepo.findOne.mockResolvedValue(createMockFirmware({ version: '2.0.0' }));

      const result = await otaService.checkUpdate('SN-TEST-001');

      expect(result?.hasUpdate).toBe(false);
    });

    it('TC-CHK-005: 强制升级固件应返回 isForced=true', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice({ firmwareVersion: '1.0.0' }));
      mockFirmwareRepo.findOne.mockResolvedValue(createMockFirmware({ version: '2.0.0', isForced: true }));

      const result = await otaService.checkUpdate('SN-TEST-001');

      expect(result?.isForced).toBe(true);
    });
  });

  // ============================================================
  // 3. createOTATask — 创建升级任务
  // ============================================================
  describe('createOTATask()', () => {
    it('TC-TASK-001: 应成功创建任务并下发下载命令', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice());
      mockOtaTaskRepo.findOne.mockResolvedValue(null); // 无进行中任务
      mockFirmwareRepo.findOne.mockResolvedValue(createMockFirmware());
      mockOtaTaskRepo.create.mockImplementation((d) => d);
      mockOtaTaskRepo.save.mockImplementation((d) => ({ ...d }));
      mockFirmwareSignatureService.isRevoked.mockResolvedValue(false);
      mockOtaTaskRepo.update.mockResolvedValue({ affected: 1 });

      const task = await otaService.createOTATask({
        deviceId: 'SN-TEST-001',
        firmwareId: 'fw-001',
      });

      expect(task).toBeDefined();
      expect(task.fromVersion).toBe('1.0.0');
      expect(task.toVersion).toBe('2.0.0');
      // 验证 MQTT 下发了 ota_download 命令
      expect(mockMqttService.publish).toHaveBeenCalledWith(
        'devices/SN-TEST-001/command',
        expect.stringContaining('ota_download')
      );
    });

    it('TC-TASK-002: 设备不存在时应抛出错误', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);

      await expect(
        otaService.createOTATask({ deviceId: 'nonexistent', firmwareId: 'fw-001' })
      ).rejects.toThrow('Device not found');
    });

    it('TC-TASK-003: 固件不存在时应抛出错误', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice());
      mockFirmwareRepo.findOne.mockResolvedValue(null);

      await expect(
        otaService.createOTATask({ deviceId: 'SN-TEST-001', firmwareId: 'nonexistent' })
      ).rejects.toThrow('Firmware not found');
    });

    it('TC-TASK-004: 设备版本过低时应拒绝升级', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(
        createMockDevice({ firmwareVersion: '0.5.0' })
      );
      mockFirmwareRepo.findOne.mockResolvedValue(
        createMockFirmware({ minVersion: '1.0.0' })
      );

      await expect(
        otaService.createOTATask({ deviceId: 'SN-TEST-001', firmwareId: 'fw-001' })
      ).rejects.toThrow('version too low');
    });

    it('TC-TASK-005: 设备版本过高时应拒绝升级', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(
        createMockDevice({ firmwareVersion: '3.0.0' })
      );
      mockFirmwareRepo.findOne.mockResolvedValue(
        createMockFirmware({ maxVersion: '2.5.0' })
      );

      await expect(
        otaService.createOTATask({ deviceId: 'SN-TEST-001', firmwareId: 'fw-001' })
      ).rejects.toThrow('version too high');
    });

    it('TC-TASK-006: 有进行中任务时应拒绝重复创建', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice());
      mockFirmwareRepo.findOne.mockResolvedValue(createMockFirmware());
      mockOtaTaskRepo.findOne.mockResolvedValue(
        createMockTask({ status: 'downloading' })
      );

      await expect(
        otaService.createOTATask({ deviceId: 'SN-TEST-001', firmwareId: 'fw-001' })
      ).rejects.toThrow('ongoing OTA task');
    });

    it('TC-TASK-007: 固件已被撤销时应拒绝升级', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice());
      mockFirmwareRepo.findOne.mockResolvedValue(createMockFirmware());
      // 进行中任务检查：返回 null（无进行中任务）
      mockOtaTaskRepo.findOne
        .mockResolvedValueOnce(null) // 进行中任务查询
        .mockResolvedValueOnce(null) // updateOTATaskProgress 中的 getOTATask
        .mockResolvedValueOnce(null); // updateOTATaskProgress 中第二次 getOTATask
      mockFirmwareSignatureService.isRevoked.mockResolvedValue(true);

      await expect(
        otaService.createOTATask({ deviceId: 'SN-TEST-001', firmwareId: 'fw-001' })
      ).rejects.toThrow('revoked');
    });

    it('TC-TASK-008: 下发命令应包含正确的固件信息', async () => {
      const firmware = createMockFirmware();
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice());
      mockOtaTaskRepo.findOne.mockResolvedValue(null);
      mockFirmwareRepo.findOne.mockResolvedValue(firmware);
      mockOtaTaskRepo.create.mockImplementation((d) => d);
      mockOtaTaskRepo.save.mockImplementation((d) => ({ ...d }));
      mockFirmwareSignatureService.isRevoked.mockResolvedValue(false);
      mockOtaTaskRepo.update.mockResolvedValue({ affected: 1 });

      await otaService.createOTATask({
        deviceId: 'SN-TEST-001',
        firmwareId: 'fw-001',
      });

      const publishCall = mockMqttService.publish.mock.calls[0];
      const message = JSON.parse(publishCall[1]);

      expect(message.action).toBe('ota_download');
      expect(message.version).toBe('2.0.0');
      expect(message.fileUrl).toBe(firmware.fileUrl);
      expect(message.fileSize).toBe(firmware.fileSize);
      expect(message.checksum).toBe(firmware.checksum);
    });
  });

  // ============================================================
  // 4. handleOTAPProgress — 处理进度上报
  // ============================================================
  describe('handleOTAPProgress()', () => {
    it('TC-PROG-001: 应更新任务进度', async () => {
      const task = createMockTask({ status: 'downloading' });
      mockOtaTaskRepo.findOne.mockResolvedValue(task);
      mockOtaTaskRepo.update.mockResolvedValue({ affected: 1 });

      await otaService.handleOTAPProgress('task-001', 50, 'downloading');

      expect(mockOtaTaskRepo.update).toHaveBeenCalledWith(
        { id: 'task-001' } as any,
        expect.objectContaining({ status: 'downloading', progress: 50 })
      );
    });

    it('TC-PROG-002: 任务不存在时应抛出错误', async () => {
      mockOtaTaskRepo.findOne.mockResolvedValue(null);

      await expect(
        otaService.handleOTAPProgress('nonexistent', 50, 'downloading')
      ).rejects.toThrow('OTA task not found');
    });

    it('TC-PROG-003: 下载完成时应自动下发安装命令', async () => {
      const task = createMockTask({ status: 'downloading' });
      mockOtaTaskRepo.findOne
        .mockResolvedValueOnce(task)  // handleOTAPProgress 中查找
        .mockResolvedValueOnce({ ...task, progress: 100 }); // updateOTATaskProgress 中查找
      mockOtaTaskRepo.update.mockResolvedValue({ affected: 1 });

      await otaService.handleOTAPProgress('task-001', 100, 'downloading');

      // 应下发 ota_install 命令
      const installCall = mockMqttService.publish.mock.calls.find(
        (call: any[]) => call[1]?.includes('ota_install')
      );
      expect(installCall).toBeDefined();
    });

    it('TC-PROG-004: 安装进度 100% 不应触发安装命令', async () => {
      const task = createMockTask({ status: 'installing' });
      mockOtaTaskRepo.findOne.mockResolvedValue(task);
      mockOtaTaskRepo.update.mockResolvedValue({ affected: 1 });

      await otaService.handleOTAPProgress('task-001', 100, 'installing');

      const installCall = mockMqttService.publish.mock.calls.find(
        (call: any[]) => call[1]?.includes('ota_install')
      );
      expect(installCall).toBeUndefined();
    });
  });

  // ============================================================
  // 5. handleOTAResult — 处理结果上报
  // ============================================================
  describe('handleOTAResult()', () => {
    it('TC-RESULT-001: 升级成功应更新任务为 completed 并下发重启', async () => {
      const task = createMockTask({ status: 'installing', toVersion: '2.0.0' });
      mockOtaTaskRepo.findOne
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce({ ...task, status: 'completed' });
      mockOtaTaskRepo.update.mockResolvedValue({ affected: 1 });
      mockDeviceRepo.update.mockResolvedValue({ affected: 1 });

      await otaService.handleOTAResult('task-001', true);

      // 任务标记为 completed
      expect(mockOtaTaskRepo.update).toHaveBeenCalledWith(
        { id: 'task-001' } as any,
        expect.objectContaining({ status: 'completed', progress: 100 })
      );
      // 设备固件版本更新为目标版本
      expect(mockDeviceRepo.update).toHaveBeenCalledWith(
        expect.anything(),
        { firmwareVersion: '2.0.0' }
      );
      // 下发重启命令
      expect(mockMqttService.publish).toHaveBeenCalledWith(
        'devices/SN-TEST-001/command',
        expect.stringContaining('reboot')
      );
    });

    it('TC-RESULT-002: 升级失败应更新任务为 failed', async () => {
      const task = createMockTask({ status: 'installing', progress: 60 });
      mockOtaTaskRepo.findOne.mockResolvedValue(task);
      mockOtaTaskRepo.update.mockResolvedValue({ affected: 1 });

      await otaService.handleOTAResult('task-001', false, 'Checksum mismatch');

      expect(mockOtaTaskRepo.update).toHaveBeenCalledWith(
        { id: 'task-001' } as any,
        expect.objectContaining({
          status: 'failed',
          progress: 60,
          error: 'Checksum mismatch',
        })
      );
      // 失败时不应更新设备版本
      expect(mockDeviceRepo.update).not.toHaveBeenCalled();
      // 失败时不应下发重启
      const rebootCall = mockMqttService.publish.mock.calls.find(
        (call: any[]) => call[1]?.includes('reboot')
      );
      expect(rebootCall).toBeUndefined();
    });

    it('TC-RESULT-003: 任务不存在时应抛出错误', async () => {
      mockOtaTaskRepo.findOne.mockResolvedValue(null);

      await expect(
        otaService.handleOTAResult('nonexistent', true)
      ).rejects.toThrow('OTA task not found');
    });
  });

  // ============================================================
  // 6. 任务控制 — cancel / pause / resume
  // ============================================================
  describe('cancelOTATask()', () => {
    it('TC-CTRL-001: 应成功取消任务', async () => {
      mockOtaTaskRepo.findOne.mockResolvedValue(createMockTask({ status: 'downloading' }));
      mockOtaTaskRepo.delete.mockResolvedValue({ affected: 1 });

      const result = await otaService.cancelOTATask('task-001');

      expect(result).toBe(true);
      expect(mockMqttService.publish).toHaveBeenCalledWith(
        'devices/SN-TEST-001/command',
        expect.stringContaining('ota_cancel')
      );
      expect(mockOtaTaskRepo.delete).toHaveBeenCalled();
    });

    it('TC-CTRL-002: 已完成的任务不能取消', async () => {
      mockOtaTaskRepo.findOne.mockResolvedValue(createMockTask({ status: 'completed' }));

      const result = await otaService.cancelOTATask('task-001');

      expect(result).toBe(false);
    });

    it('TC-CTRL-003: 不存在的任务返回 false', async () => {
      mockOtaTaskRepo.findOne.mockResolvedValue(null);

      const result = await otaService.cancelOTATask('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('pauseOTATask()', () => {
    it('TC-CTRL-004: 下载中的任务应能暂停', async () => {
      mockOtaTaskRepo.findOne.mockResolvedValue(createMockTask({ status: 'downloading' }));
      mockOtaTaskRepo.update.mockResolvedValue({ affected: 1 });

      const result = await otaService.pauseOTATask('task-001');

      expect(result).toBe(true);
      expect(mockMqttService.publish).toHaveBeenCalledWith(
        'devices/SN-TEST-001/command',
        expect.stringContaining('ota_pause')
      );
    });

    it('TC-CTRL-005: 已完成的任务不能暂停', async () => {
      mockOtaTaskRepo.findOne.mockResolvedValue(createMockTask({ status: 'completed' }));

      const result = await otaService.pauseOTATask('task-001');

      expect(result).toBe(false);
    });
  });

  describe('resumeOTATask()', () => {
    it('TC-CTRL-006: 暂停中的任务应能恢复', async () => {
      mockOtaTaskRepo.findOne.mockResolvedValue(createMockTask({ status: 'paused' }));
      mockOtaTaskRepo.update.mockResolvedValue({ affected: 1 });

      const result = await otaService.resumeOTATask('task-001');

      expect(result).toBe(true);
      expect(mockMqttService.publish).toHaveBeenCalledWith(
        'devices/SN-TEST-001/command',
        expect.stringContaining('ota_resume')
      );
      expect(mockOtaTaskRepo.update).toHaveBeenCalledWith(
        { id: 'task-001' } as any,
        { status: 'downloading' }
      );
    });

    it('TC-CTRL-007: 非暂停状态的任务不能恢复', async () => {
      mockOtaTaskRepo.findOne.mockResolvedValue(createMockTask({ status: 'downloading' }));

      const result = await otaService.resumeOTATask('task-001');

      expect(result).toBe(false);
    });
  });

  // ============================================================
  // 7. syncOTATasksOnReRegistration — 设备重注册同步
  // ============================================================
  describe('syncOTATasksOnReRegistration()', () => {
    it('TC-SYNC-001: 设备升级到目标版本时应自动完成 OTA 任务', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice());
      mockOtaTaskRepo.find.mockResolvedValue([
        createMockTask({ status: 'installing', toVersion: '2.0.0' }),
      ]);
      mockOtaTaskRepo.update.mockResolvedValue({ affected: 1 });

      await otaService.syncOTATasksOnReRegistration('SN-TEST-001', '2.0.0');

      expect(mockOtaTaskRepo.update).toHaveBeenCalledWith(
        { id: 'task-001' } as any,
        expect.objectContaining({
          status: 'completed',
          progress: 100,
          completedAt: expect.any(Date),
        })
      );
    });

    it('TC-SYNC-002: 设备版本不匹配时应标记任务失败', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice());
      mockOtaTaskRepo.find.mockResolvedValue([
        createMockTask({ status: 'installing', toVersion: '2.0.0' }),
      ]);
      mockOtaTaskRepo.update.mockResolvedValue({ affected: 1 });

      await otaService.syncOTATasksOnReRegistration('SN-TEST-001', '3.0.0');

      expect(mockOtaTaskRepo.update).toHaveBeenCalledWith(
        { id: 'task-001' } as any,
        expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('expected 2.0.0'),
        })
      );
    });

    it('TC-SYNC-003: 无进行中任务时不应报错', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice());
      mockOtaTaskRepo.find.mockResolvedValue([]);

      await otaService.syncOTATasksOnReRegistration('SN-TEST-001', '2.0.0');

      expect(mockOtaTaskRepo.update).not.toHaveBeenCalled();
    });

    it('TC-SYNC-004: 设备不存在时不应报错', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);

      await otaService.syncOTATasksOnReRegistration('nonexistent', '2.0.0');

      expect(mockOtaTaskRepo.find).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 8. 辅助功能
  // ============================================================
  describe('getDeviceOTATasksPaginated()', () => {
    it('TC-AUX-001: 应返回分页结果', async () => {
      const tasks = [createMockTask()];
      mockOtaTaskRepo.findAndCount.mockResolvedValue([tasks, 1]);

      const result = await otaService.getDeviceOTATasksPaginated('SN-TEST-001', 20, 0);

      expect(result).toEqual({ list: tasks, total: 1 });
      expect(mockOtaTaskRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20, skip: 0 })
      );
    });
  });

  describe('cleanOldOTATasks()', () => {
    it('TC-AUX-002: 应清理 30 天前的旧任务', async () => {
      const mockQueryBuilder = {
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 5 }),
      };
      mockOtaTaskRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const count = await otaService.cleanOldOTATasks(30);

      expect(count).toBe(5);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'createdAt < :cutoffDate',
        expect.objectContaining({ cutoffDate: expect.any(Date) })
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'status IN (:...statuses)',
        { statuses: ['completed', 'failed', 'rolled_back'] }
      );
    });
  });

  describe('getOTAStatistics()', () => {
    it('TC-AUX-003: 应返回正确的统计数据', async () => {
      mockOtaTaskRepo.find.mockResolvedValue([
        createMockTask({ status: 'completed' }),
        createMockTask({ id: 'task-002', status: 'failed' }),
        createMockTask({ id: 'task-003', status: 'downloading' }),
      ]);

      const stats = await otaService.getOTAStatistics();

      expect(stats.total).toBe(3);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.downloading).toBe(1);
      expect(stats.pending).toBe(0);
      expect(stats.installing).toBe(0);
    });
  });

  // ============================================================
  // 9. 版本比较
  // ============================================================
  describe('compareVersion()', () => {
    it('TC-VER-001: 应正确比较版本号', async () => {
      // 通过 checkUpdate 间接测试 compareVersion
      mockFirmwareRepo.findOne.mockResolvedValue(createMockFirmware({ version: '2.0.0' }));

      // v1.0.0 < v2.0.0
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice({ firmwareVersion: '1.0.0' }));
      let result = await otaService.checkUpdate('SN-TEST-001');
      expect(result?.hasUpdate).toBe(true);

      // v2.0.0 == v2.0.0
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice({ firmwareVersion: '2.0.0' }));
      result = await otaService.checkUpdate('SN-TEST-001');
      expect(result?.hasUpdate).toBe(false);

      // v3.0.0 > v2.0.0
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice({ firmwareVersion: '3.0.0' }));
      result = await otaService.checkUpdate('SN-TEST-001');
      expect(result?.hasUpdate).toBe(false);
    });

    it('TC-VER-002: 应正确比较多位版本号', async () => {
      mockFirmwareRepo.findOne.mockResolvedValue(createMockFirmware({ version: '1.10.0' }));

      // v1.9.0 < v1.10.0
      mockDeviceRepo.findOne.mockResolvedValue(createMockDevice({ firmwareVersion: '1.9.0' }));
      const result = await otaService.checkUpdate('SN-TEST-001');
      expect(result?.hasUpdate).toBe(true);
    });
  });
});
