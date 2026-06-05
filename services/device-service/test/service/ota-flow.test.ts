import { OTAService } from '../../src/service/ota.service';
import { FirmwareVersion } from '../../src/entity/firmware-version.entity';
import { OTATask } from '../../src/entity/ota-task.entity';
import { Device } from '../../src/entity/device.entity';

/**
 * OTA 升级端到端流程测试
 *
 * 模拟完整升级链路：上传固件 → 创建任务 → 设备下载 → 设备安装 → 设备重启 → 重注册同步
 * 以及失败回滚、强制升级等场景
 */

// ============================================================
// Mock 工厂
// ============================================================

function makeFirmware(overrides?: Partial<FirmwareVersion>): FirmwareVersion {
  return {
    id: 'fw-v200',
    productId: 'PROD-camera-v2',
    version: '2.0.0',
    releaseNotes: 'Major update',
    fileUrl: 'https://storage.example.com/firmware/v2.0.0.bin',
    fileSize: 1048576,
    checksum: 'a'.repeat(64),
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

function makeDevice(overrides?: Partial<Device>): Device {
  return {
    id: 'dev-001',
    serialNumber: 'SN-FLOW-001',
    productId: 'PROD-camera-v2',
    name: 'Flow Test Device',
    firmwareVersion: '1.0.0',
    status: 'online' as any,
    lastOnline: new Date(),
    ...overrides,
  } as Device;
}

function makeTask(overrides?: Partial<OTATask>): OTATask {
  return {
    id: 'task-flow-001',
    deviceId: 'SN-FLOW-001',
    firmwareId: 'fw-v200',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    status: 'pending',
    progress: 0,
    error: null,
    startedAt: null,
    completedAt: null,
    createdBy: 'admin-001',
    createdAt: new Date(),
    ...overrides,
  } as OTATask;
}

// ============================================================
// Mock 依赖
// ============================================================

let taskStore: Map<string, OTATask>;
let deviceStore: Map<string, Device>;

const mocks = {
  firmwareRepo: {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findAndCount: jest.fn(),
    createQueryBuilder: jest.fn(),
  },
  otaTaskRepo: {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findAndCount: jest.fn(),
    createQueryBuilder: jest.fn(),
  },
  deviceRepo: {
    findOne: jest.fn(),
    update: jest.fn(),
  },
  mqtt: { publish: jest.fn().mockResolvedValue(undefined) },
  redis: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  signature: { isRevoked: jest.fn().mockResolvedValue(false), verifyHash: jest.fn().mockResolvedValue(true) },
};

function createService(): OTAService {
  const svc = new OTAService();
  (svc as any).logger = mocks.logger;
  (svc as any).redis = mocks.redis;
  (svc as any).mqttService = mocks.mqtt;
  (svc as any).firmwareVersionRepository = mocks.firmwareRepo;
  (svc as any).otaTaskRepository = mocks.otaTaskRepo;
  (svc as any).deviceRepository = mocks.deviceRepo;
  (svc as any).firmwareSignatureService = mocks.signature;
  return svc;
}

// ============================================================
// 测试
// ============================================================

describe('OTA 端到端流程测试', () => {
  let service: OTAService;
  let device: Device;
  let firmware: FirmwareVersion;
  let taskId: string; // 记录实际创建的任务ID

  beforeEach(() => {
    jest.clearAllMocks();
    taskStore = new Map();
    deviceStore = new Map();
    taskId = '';

    service = createService();
    device = makeDevice();
    firmware = makeFirmware();

    // 通用 mock：设备查找
    mocks.deviceRepo.findOne.mockImplementation(({ where }: any) => {
      if (where.serialNumber) return deviceStore.get(where.serialNumber) || device;
      return device;
    });

    // 通用 mock：设备更新
    mocks.deviceRepo.update.mockImplementation((_where: any, updates: any) => {
      if (updates.firmwareVersion) {
        device.firmwareVersion = updates.firmwareVersion;
      }
      return { affected: 1 };
    });

    // 通用 mock：固件查找
    mocks.firmwareRepo.findOne.mockImplementation(({ where }: any) => {
      if (where.id) return firmware;
      if (where.productId && where.version) return null; // 无重复
      return firmware;
    });

    // 通用 mock：任务查找
    mocks.otaTaskRepo.findOne.mockImplementation(({ where }: any) => {
      if (where.id) return Promise.resolve(taskStore.get(where.id));
      if (where.deviceId && where.status) return Promise.resolve(null); // 无进行中任务
      if (where.serialNumber) return Promise.resolve(deviceStore.get(where.serialNumber) || device);
      return Promise.resolve(null);
    });

    // 通用 mock：任务更新
    mocks.otaTaskRepo.update.mockImplementation((_where: any, updates: any) => {
      const id = _where.id;
      const task = taskStore.get(id);
      if (task) Object.assign(task, updates);
      return { affected: 1 };
    });

    // 通用 mock：任务创建
    mocks.otaTaskRepo.create.mockImplementation((data) => {
      const task = { ...data, status: data.status || 'pending', progress: data.progress || 0 };
      taskStore.set(task.id, task);
      taskId = task.id; // 捕获实际任务ID
      return task;
    });
    mocks.otaTaskRepo.save.mockImplementation((task) => {
      taskStore.set(task.id, task);
      taskId = task.id;
      return task;
    });
    mocks.firmwareRepo.create.mockImplementation((data) => data);
    mocks.firmwareRepo.save.mockImplementation((data) => data);
    mocks.otaTaskRepo.find.mockResolvedValue([]);
    mocks.otaTaskRepo.findAndCount.mockResolvedValue([[], 0]);
    mocks.otaTaskRepo.delete.mockResolvedValue({ affected: 1 });
  });

  // ============================================================
  // 场景 1：完整成功流程
  // ============================================================
  it('E2E-001: 完整成功流程 — 上传 → 创建任务 → 下载 → 安装 → 成功 → 重启 → 重注册同步', async () => {
    // Step 1: 上传固件
    const uploadedFw = await service.uploadFirmware({
      productId: 'PROD-camera-v2',
      version: '2.0.0',
      releaseNotes: 'Major update',
      fileUrl: firmware.fileUrl,
      fileSize: firmware.fileSize,
      checksum: firmware.checksum,
    });
    expect(uploadedFw.version).toBe('2.0.0');

    // Step 2: 创建 OTA 任务
    const task = await service.createOTATask({
      deviceId: 'SN-FLOW-001',
      firmwareId: 'fw-v200',
    });
    expect(task.fromVersion).toBe('1.0.0');
    expect(task.toVersion).toBe('2.0.0');
    expect(taskId).toBeTruthy();

    // 验证下发了 ota_download 命令
    const downloadMsg = JSON.parse(mocks.mqtt.publish.mock.calls[0][1]);
    expect(downloadMsg.action).toBe('ota_download');
    expect(downloadMsg.version).toBe('2.0.0');
    expect(downloadMsg.checksum).toBe(firmware.checksum);

    // Step 3: 设备上报下载进度
    await service.handleOTAPProgress(taskId, 25, 'downloading');
    let storedTask = taskStore.get(taskId)!;
    expect(storedTask.progress).toBe(25);

    await service.handleOTAPProgress(taskId, 75, 'downloading');
    storedTask = taskStore.get(taskId)!;
    expect(storedTask.progress).toBe(75);

    // 3c: 下载完成 100% → 应触发 ota_install
    await service.handleOTAPProgress(taskId, 100, 'downloading');
    const installMsg = mocks.mqtt.publish.mock.calls.find(
      (c: any[]) => c[1]?.includes('ota_install')
    );
    expect(installMsg).toBeDefined();
    expect(JSON.parse(installMsg![1]).action).toBe('ota_install');

    // Step 4: 设备上报安装进度
    await service.handleOTAPProgress(taskId, 50, 'installing');
    storedTask = taskStore.get(taskId)!;
    expect(storedTask.status).toBe('installing');

    // Step 5: 设备上报升级成功
    await service.handleOTAResult(taskId, true);

    storedTask = taskStore.get(taskId)!;
    expect(storedTask.status).toBe('completed');
    expect(storedTask.progress).toBe(100);
    expect(storedTask.completedAt).toBeDefined();

    // 验证设备固件版本更新
    expect(device.firmwareVersion).toBe('2.0.0');

    // 验证下发了重启命令
    const rebootMsg = mocks.mqtt.publish.mock.calls.find(
      (c: any[]) => c[1]?.includes('reboot')
    );
    expect(rebootMsg).toBeDefined();

    // Step 6: 设备重启后重注册，触发 OTA 同步
    mocks.otaTaskRepo.find.mockResolvedValue([]);
    await service.syncOTATasksOnReRegistration('SN-FLOW-001', '2.0.0');
  });

  // ============================================================
  // 场景 2：下载失败流程
  // ============================================================
  it('E2E-002: 下载失败流程 — 创建任务 → 下载失败 → 任务标记 failed', async () => {
    await service.createOTATask({
      deviceId: 'SN-FLOW-001',
      firmwareId: 'fw-v200',
    });

    await service.handleOTAPProgress(taskId, 30, 'downloading');
    let storedTask = taskStore.get(taskId)!;
    expect(storedTask.progress).toBe(30);

    await service.handleOTAResult(taskId, false, 'Network timeout');

    storedTask = taskStore.get(taskId)!;
    expect(storedTask.status).toBe('failed');
    expect(storedTask.error).toBe('Network timeout');
    expect(device.firmwareVersion).toBe('1.0.0');
  });

  // ============================================================
  // 场景 3：安装失败流程
  // ============================================================
  it('E2E-003: 安装失败流程 — 创建 → 下载完成 → 安装失败', async () => {
    await service.createOTATask({
      deviceId: 'SN-FLOW-001',
      firmwareId: 'fw-v200',
    });

    await service.handleOTAPProgress(taskId, 100, 'downloading');

    await service.handleOTAResult(taskId, false, 'Flash write error');

    const storedTask = taskStore.get(taskId)!;
    expect(storedTask.status).toBe('failed');
    expect(storedTask.error).toBe('Flash write error');
    expect(device.firmwareVersion).toBe('1.0.0');
  });

  // ============================================================
  // 场景 4：取消升级
  // ============================================================
  it('E2E-004: 取消升级流程 — 创建 → 下载中 → 取消', async () => {
    await service.createOTATask({
      deviceId: 'SN-FLOW-001',
      firmwareId: 'fw-v200',
    });

    await service.handleOTAPProgress(taskId, 40, 'downloading');

    const result = await service.cancelOTATask(taskId);
    expect(result).toBe(true);

    const cancelMsg = mocks.mqtt.publish.mock.calls.find(
      (c: any[]) => c[1]?.includes('ota_cancel')
    );
    expect(cancelMsg).toBeDefined();
  });

  // ============================================================
  // 场景 5：暂停恢复流程
  // ============================================================
  it('E2E-005: 暂停恢复流程 — 创建 → 暂停 → 恢复 → 完成', async () => {
    await service.createOTATask({
      deviceId: 'SN-FLOW-001',
      firmwareId: 'fw-v200',
    });

    // 暂停
    const paused = await service.pauseOTATask(taskId);
    expect(paused).toBe(true);
    let storedTask = taskStore.get(taskId)!;
    expect(storedTask.status).toBe('paused');

    // 恢复
    const resumed = await service.resumeOTATask(taskId);
    expect(resumed).toBe(true);
    storedTask = taskStore.get(taskId)!;
    expect(storedTask.status).toBe('downloading');

    // 继续下载并完成
    await service.handleOTAPProgress(taskId, 100, 'downloading');
    await service.handleOTAResult(taskId, true);

    storedTask = taskStore.get(taskId)!;
    expect(storedTask.status).toBe('completed');
    expect(device.firmwareVersion).toBe('2.0.0');
  });

  // ============================================================
  // 场景 6：设备重注册时自动完成 OTA 任务
  // ============================================================
  it('E2E-006: 设备升级重启后重注册自动完成 OTA 任务', async () => {
    const installingTask = makeTask({ status: 'installing', toVersion: '2.0.0' });
    taskStore.set('task-flow-001', installingTask);

    mocks.otaTaskRepo.find.mockResolvedValue([installingTask]);

    await service.syncOTATasksOnReRegistration('SN-FLOW-001', '2.0.0');

    const storedTask = taskStore.get('task-flow-001')!;
    expect(storedTask.status).toBe('completed');
    expect(storedTask.progress).toBe(100);
  });

  // ============================================================
  // 场景 7：设备重注册版本不匹配
  // ============================================================
  it('E2E-007: 设备重注册版本不匹配时标记任务失败', async () => {
    const installingTask = makeTask({ status: 'installing', toVersion: '2.0.0' });
    taskStore.set('task-flow-001', installingTask);

    mocks.otaTaskRepo.find.mockResolvedValue([installingTask]);

    await service.syncOTATasksOnReRegistration('SN-FLOW-001', '1.5.0');

    const storedTask = taskStore.get('task-flow-001')!;
    expect(storedTask.status).toBe('failed');
    expect(storedTask.error).toContain('expected 2.0.0');
  });

  // ============================================================
  // 场景 8：强制升级
  // ============================================================
  it('E2E-008: 强制升级 — isForced=true 时下发给设备', async () => {
    firmware.isForced = true;

    await service.createOTATask({
      deviceId: 'SN-FLOW-001',
      firmwareId: 'fw-v200',
    });

    const downloadMsg = JSON.parse(mocks.mqtt.publish.mock.calls[0][1]);
    expect(downloadMsg.isForced).toBe(true);
  });

  // ============================================================
  // 场景 9：MQTT 命令格式一致性
  // ============================================================
  it('E2E-009: 所有 MQTT 命令应使用 action 字段（非 type 字段）', async () => {
    await service.createOTATask({
      deviceId: 'SN-FLOW-001',
      firmwareId: 'fw-v200',
    });

    // 收集所有 MQTT 发布消息
    for (const call of mocks.mqtt.publish.mock.calls) {
      const message = JSON.parse(call[1]);
      expect(message).toHaveProperty('action');
      expect(message).not.toHaveProperty('type');
    }
  });

  // ============================================================
  // 场景 10：版本兼容性检查
  // ============================================================
  it('E2E-010: 版本低于最低要求时拒绝升级', async () => {
    firmware.minVersion = '1.5.0';
    device.firmwareVersion = '1.0.0';

    await expect(
      service.createOTATask({ deviceId: 'SN-FLOW-001', firmwareId: 'fw-v200' })
    ).rejects.toThrow('version too low');
  });

  it('E2E-011: 版本高于最高限制时拒绝升级', async () => {
    firmware.maxVersion = '1.5.0';
    device.firmwareVersion = '2.0.0';

    await expect(
      service.createOTATask({ deviceId: 'SN-FLOW-001', firmwareId: 'fw-v200' })
    ).rejects.toThrow('version too high');
  });

  // ============================================================
  // 场景 12：重复创建任务
  // ============================================================
  it('E2E-012: 有进行中任务时拒绝重复创建', async () => {
    // 第一次成功
    await service.createOTATask({ deviceId: 'SN-FLOW-001', firmwareId: 'fw-v200' });
    expect(taskId).toBeTruthy();

    // 第二次应被拒绝 — 模拟已有进行中任务
    mocks.otaTaskRepo.findOne.mockImplementation(({ where }: any) => {
      if (where.id) return Promise.resolve(taskStore.get(where.id));
      // 模拟进行中任务查询命中
      if (where.deviceId && where.status) {
        const existingTask = taskStore.get(taskId);
        return Promise.resolve(existingTask || null);
      }
      return Promise.resolve(null);
    });

    await expect(
      service.createOTATask({ deviceId: 'SN-FLOW-001', firmwareId: 'fw-v200' })
    ).rejects.toThrow('ongoing OTA task');
  });
});
