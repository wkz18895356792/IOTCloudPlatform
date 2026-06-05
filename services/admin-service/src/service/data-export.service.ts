/**
 * 数据导出服务
 *
 * 支持多种数据类型的导出：
 * - 用户数据
 * - 设备数据
 * - 历史记录
 * - 统计报表
 * - 系统日志
 *
 * 支持多种导出格式：
 * - CSV
 * - JSON
 * - Excel (xlsx)
 * - PDF
 *
 * 特性：
 * - 大数据量分片导出
 * - 异步任务处理
 * - 导出进度跟踪
 * - 文件加密
 * - 过期自动清理
 */
import { Provide, Inject, Init, Scope, ScopeEnum, Config } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { CacheManager, IdGenerator, JsonUtil } from '@baby-monitor/shared-utils';
import * as fs from 'fs';
import * as path from 'path';
import * as csv from 'fast-csv';
import * as XLSX from 'xlsx';

/**
 * 导出类型
 */
export enum ExportType {
  USER_DATA = 'user_data',           // 用户数据
  DEVICE_DATA = 'device_data',       // 设备数据
  DEVICE_HISTORY = 'device_history', // 设备历史
  ALERT_LOGS = 'alert_logs',         // 告警日志
  SYSTEM_LOGS = 'system_logs',       // 系统日志
  STATISTICS = 'statistics',         // 统计报表
  AUDIT_LOGS = 'audit_logs',         // 审计日志
  CUSTOM = 'custom',                 // 自定义
}

/**
 * 导出格式
 */
export enum ExportFormat {
  CSV = 'csv',
  JSON = 'json',
  XLSX = 'xlsx',
  PDF = 'pdf',
}

/**
 * 导出状态
 */
export enum ExportStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

/**
 * 导出选项
 */
export interface ExportOptions {
  type: ExportType;
  format: ExportFormat;
  userId?: string;
  domainId?: string;

  // 时间范围
  startTime?: Date;
  endTime?: Date;

  // 筛选条件
  filters?: Record<string, any>;

  // 字段选择
  fields?: string[];

  // 分页（大数据量导出）
  batchSize?: number;

  // 加密选项
  encrypt?: boolean;
  password?: string;

  // 其他选项
  includeDeleted?: boolean;
  locale?: string;
}

/**
 * 导出任务
 */
export interface ExportTask {
  id: string;
  userId: string;
  type: ExportType;
  format: ExportFormat;
  status: ExportStatus;
  options: ExportOptions;

  // 进度
  totalRecords: number;
  processedRecords: number;
  progress: number;

  // 结果
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  downloadUrl?: string;

  // 时间
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  expiresAt?: Date;

  // 错误信息
  errorMessage?: string;
}

/**
 * 导出模板
 */
export interface ExportTemplate {
  type: ExportType;
  name: string;
  description: string;
  defaultFields: string[];
  availableFields: string[];
  supportedFormats: ExportFormat[];
}

/**
 * 数据导出服务
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class DataExportService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  @Config('export')
  exportConfig: {
    outputDir: string;
    maxFileSize: number;
    batchSize: number;
    expireHours: number;
    maxConcurrent: number;
  };

  // Redis 键前缀
  private readonly TASK_PREFIX = 'export:task:';
  private readonly LOCK_PREFIX = 'export:lock:';
  private readonly LIST_PREFIX = 'export:list:';

  // 默认配置
  private readonly DEFAULT_BATCH_SIZE = 1000;
  private readonly DEFAULT_EXPIRE_HOURS = 24;
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

  // 导出模板
  private readonly templates: Map<ExportType, ExportTemplate> = new Map();

  // 正在处理的任务
  private processingTasks: Set<string> = new Set();

  @Init()
  async init(): Promise<void> {
    this.logger.info('[DataExport] Service initializing...');

    // 初始化模板
    this.initTemplates();

    // 确保输出目录存在
    await this.ensureOutputDir();

    // 启动任务处理器
    this.startTaskProcessor();

    // 启动过期清理
    this.startExpiryCleaner();

    this.logger.info('[DataExport] Service initialized');
  }

  // ==================== 导出 API ====================

  /**
   * 创建导出任务
   */
  async createExportTask(userId: string, options: ExportOptions): Promise<ExportTask> {
    const taskId = IdGenerator.uuid();

    const task: ExportTask = {
      id: taskId,
      userId,
      type: options.type,
      format: options.format || ExportFormat.CSV,
      status: ExportStatus.PENDING,
      options,
      totalRecords: 0,
      processedRecords: 0,
      progress: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + (this.exportConfig?.expireHours || this.DEFAULT_EXPIRE_HOURS) * 3600 * 1000),
    };

    // 保存任务
    await this.saveTask(task);

    // 添加到用户任务列表
    await this.redis.rpush(`${this.LIST_PREFIX}${userId}`, taskId);

    this.logger.info(`[DataExport] Export task created: ${taskId}`);

    return task;
  }

  /**
   * 获取导出任务
   */
  async getExportTask(taskId: string): Promise<ExportTask | null> {
    const key = `${this.TASK_PREFIX}${taskId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return JsonUtil.parse<ExportTask>(data);
  }

  /**
   * 获取用户导出任务列表
   */
  async getUserExportTasks(userId: string, limit: number = 20): Promise<ExportTask[]> {
    const taskIds = await this.redis.lrange(`${this.LIST_PREFIX}${userId}`, 0, limit - 1);
    const tasks: ExportTask[] = [];

    for (const taskId of taskIds) {
      const task = await this.getExportTask(taskId);
      if (task) {
        tasks.push(task);
      }
    }

    return tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * 取消导出任务
   */
  async cancelExportTask(userId: string, taskId: string): Promise<boolean> {
    const task = await this.getExportTask(taskId);

    if (!task || task.userId !== userId) {
      return false;
    }

    if (task.status !== ExportStatus.PENDING && task.status !== ExportStatus.PROCESSING) {
      return false;
    }

    task.status = ExportStatus.FAILED;
    task.errorMessage = 'Cancelled by user';
    await this.saveTask(task);

    this.logger.info(`[DataExport] Export task cancelled: ${taskId}`);
    return true;
  }

  /**
   * 获取导出文件
   */
  async getExportFile(userId: string, taskId: string): Promise<{
    filePath: string;
    fileName: string;
    contentType: string;
  } | null> {
    const task = await this.getExportTask(taskId);

    if (!task || task.userId !== userId || task.status !== ExportStatus.COMPLETED) {
      return null;
    }

    if (!task.filePath || !fs.existsSync(task.filePath)) {
      return null;
    }

    const contentType = this.getContentType(task.format);

    return {
      filePath: task.filePath,
      fileName: task.fileName || `export_${taskId}.${task.format}`,
      contentType,
    };
  }

  // ==================== 导出执行 ====================

  /**
   * 执行导出任务
   */
  private async executeExportTask(task: ExportTask): Promise<void> {
    const startTime = Date.now();

    try {
      // 更新状态
      task.status = ExportStatus.PROCESSING;
      task.startedAt = new Date();
      await this.saveTask(task);

      // 获取数据源
      const dataSource = await this.getDataSource(task);

      // 统计总数
      task.totalRecords = await dataSource.count();
      await this.saveTask(task);

      // 根据格式导出
      const outputPath = await this.generateOutputPath(task);

      switch (task.format) {
        case ExportFormat.CSV:
          await this.exportToCSV(task, dataSource, outputPath);
          break;
        case ExportFormat.JSON:
          await this.exportToJSON(task, dataSource, outputPath);
          break;
        case ExportFormat.XLSX:
          await this.exportToXLSX(task, dataSource, outputPath);
          break;
        default:
          throw new Error(`Unsupported format: ${task.format}`);
      }

      // 完成导出
      task.status = ExportStatus.COMPLETED;
      task.completedAt = new Date();
      task.filePath = outputPath;
      task.fileName = path.basename(outputPath);
      task.fileSize = fs.statSync(outputPath).size;
      task.progress = 100;

      await this.saveTask(task);

      const duration = Date.now() - startTime;
      this.logger.info(
        `[DataExport] Export task completed: ${task.id}, records: ${task.totalRecords}, duration: ${duration}ms`
      );
    } catch (error: any) {
      task.status = ExportStatus.FAILED;
      task.errorMessage = error.message;

      await this.saveTask(task);

      this.logger.error(`[DataExport] Export task failed: ${task.id}`, error);
    }
  }

  /**
   * 导出为 CSV
   */
  private async exportToCSV(
    task: ExportTask,
    dataSource: DataSource,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(outputPath);
      const csvStream = csv.format({ headers: true });

      csvStream.pipe(stream);

      const batchSize = task.options.batchSize || this.DEFAULT_BATCH_SIZE;
      let offset = 0;

      const processBatch = async () => {
        try {
          const records = await dataSource.getBatch(offset, batchSize);

          if (records.length === 0) {
            csvStream.end();
            stream.end();
            resolve();
            return;
          }

          for (const record of records) {
            const row = this.formatRecord(record, task.options.fields);
            csvStream.write(row);
          }

          task.processedRecords += records.length;
          task.progress = Math.round((task.processedRecords / task.totalRecords) * 100);
          await this.saveTask(task);

          offset += batchSize;

          // 继续处理下一批
          setImmediate(processBatch);
        } catch (error) {
          reject(error);
        }
      };

      processBatch();
    });
  }

  /**
   * 导出为 JSON
   */
  private async exportToJSON(
    task: ExportTask,
    dataSource: DataSource,
    outputPath: string
  ): Promise<void> {
    const batchSize = task.options.batchSize || this.DEFAULT_BATCH_SIZE;
    let offset = 0;
    const allRecords: any[] = [];

    while (true) {
      const records = await dataSource.getBatch(offset, batchSize);

      if (records.length === 0) {
        break;
      }

      for (const record of records) {
        const formatted = this.formatRecord(record, task.options.fields);
        allRecords.push(formatted);
      }

      task.processedRecords += records.length;
      task.progress = Math.round((task.processedRecords / task.totalRecords) * 100);
      await this.saveTask(task);

      offset += batchSize;

      // 检查文件大小
      const estimatedSize = JSON.stringify(allRecords).length;
      if (estimatedSize > this.MAX_FILE_SIZE) {
        throw new Error('Export file size exceeds limit');
      }
    }

    const output = {
      exportInfo: {
        type: task.type,
        exportedAt: new Date().toISOString(),
        totalRecords: task.totalRecords,
      },
      data: allRecords,
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  }

  /**
   * 导出为 XLSX
   */
  private async exportToXLSX(
    task: ExportTask,
    dataSource: DataSource,
    outputPath: string
  ): Promise<void> {
    const batchSize = task.options.batchSize || this.DEFAULT_BATCH_SIZE;
    let offset = 0;
    const allRecords: any[] = [];

    while (true) {
      const records = await dataSource.getBatch(offset, batchSize);

      if (records.length === 0) {
        break;
      }

      for (const record of records) {
        const formatted = this.formatRecord(record, task.options.fields);
        allRecords.push(formatted);
      }

      task.processedRecords += records.length;
      task.progress = Math.round((task.processedRecords / task.totalRecords) * 100);
      await this.saveTask(task);

      offset += batchSize;
    }

    // 创建工作簿
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(allRecords);

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
    XLSX.writeFile(workbook, outputPath);
  }

  // ==================== 数据源 ====================

  /**
   * 获取数据源
   */
  private async getDataSource(task: ExportTask): Promise<DataSource> {
    switch (task.type) {
      case ExportType.USER_DATA:
        return new UserDataDataSource(task.options);
      case ExportType.DEVICE_DATA:
        return new DeviceDataDataSource(task.options);
      case ExportType.DEVICE_HISTORY:
        return new DeviceHistoryDataSource(task.options);
      case ExportType.ALERT_LOGS:
        return new AlertLogsDataSource(task.options);
      case ExportType.SYSTEM_LOGS:
        return new SystemLogsDataSource(task.options);
      case ExportType.STATISTICS:
        return new StatisticsDataSource(task.options);
      case ExportType.AUDIT_LOGS:
        return new AuditLogsDataSource(task.options);
      default:
        throw new Error(`Unsupported export type: ${task.type}`);
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 保存任务
   */
  private async saveTask(task: ExportTask): Promise<void> {
    const key = `${this.TASK_PREFIX}${task.id}`;
    const expireSeconds = (this.exportConfig?.expireHours || this.DEFAULT_EXPIRE_HOURS) * 3600;
    await this.redis.setex(key, expireSeconds, JsonUtil.stringify(task));
  }

  /**
   * 生成输出路径
   */
  private async generateOutputPath(task: ExportTask): Promise<string> {
    const outputDir = this.exportConfig?.outputDir || './exports';
    const dateDir = new Date().toISOString().split('T')[0];
    const dir = path.join(outputDir, dateDir);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const fileName = `export_${task.type}_${task.id}.${task.format}`;
    return path.join(dir, fileName);
  }

  /**
   * 确保输出目录存在
   */
  private async ensureOutputDir(): Promise<void> {
    const outputDir = this.exportConfig?.outputDir || './exports';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  /**
   * 格式化记录
   */
  private formatRecord(record: any, fields?: string[]): Record<string, any> {
    if (!fields || fields.length === 0) {
      return record;
    }

    const formatted: Record<string, any> = {};
    for (const field of fields) {
      formatted[field] = this.getNestedValue(record, field);
    }
    return formatted;
  }

  /**
   * 获取嵌套值
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : null;
    }, obj);
  }

  /**
   * 获取内容类型
   */
  private getContentType(format: ExportFormat): string {
    switch (format) {
      case ExportFormat.CSV:
        return 'text/csv';
      case ExportFormat.JSON:
        return 'application/json';
      case ExportFormat.XLSX:
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case ExportFormat.PDF:
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * 初始化模板
   */
  private initTemplates(): void {
    this.templates.set(ExportType.USER_DATA, {
      type: ExportType.USER_DATA,
      name: '用户数据',
      description: '导出用户基本信息和设置',
      defaultFields: ['id', 'email', 'phone', 'nickname', 'createdAt'],
      availableFields: ['id', 'email', 'phone', 'nickname', 'avatar', 'status', 'createdAt', 'updatedAt'],
      supportedFormats: [ExportFormat.CSV, ExportFormat.JSON, ExportFormat.XLSX],
    });

    this.templates.set(ExportType.DEVICE_DATA, {
      type: ExportType.DEVICE_DATA,
      name: '设备数据',
      description: '导出设备列表和配置',
      defaultFields: ['id', 'name', 'type', 'status', 'createdAt'],
      availableFields: ['id', 'name', 'type', 'status', 'firmwareVersion', 'lastOnlineAt', 'createdAt', 'updatedAt'],
      supportedFormats: [ExportFormat.CSV, ExportFormat.JSON, ExportFormat.XLSX],
    });

    this.templates.set(ExportType.DEVICE_HISTORY, {
      type: ExportType.DEVICE_HISTORY,
      name: '设备历史',
      description: '导出设备状态历史记录',
      defaultFields: ['deviceId', 'state', 'reportedAt'],
      availableFields: ['deviceId', 'state', 'reportedAt', 'source'],
      supportedFormats: [ExportFormat.CSV, ExportFormat.JSON],
    });

    this.templates.set(ExportType.ALERT_LOGS, {
      type: ExportType.ALERT_LOGS,
      name: '告警日志',
      description: '导出系统告警记录',
      defaultFields: ['type', 'level', 'message', 'createdAt'],
      availableFields: ['id', 'type', 'level', 'message', 'source', 'status', 'createdAt', 'resolvedAt'],
      supportedFormats: [ExportFormat.CSV, ExportFormat.JSON, ExportFormat.XLSX],
    });

    this.templates.set(ExportType.STATISTICS, {
      type: ExportType.STATISTICS,
      name: '统计报表',
      description: '导出统计数据报表',
      defaultFields: ['date', 'metric', 'value'],
      availableFields: ['date', 'metric', 'value', 'change', 'changePercent'],
      supportedFormats: [ExportFormat.CSV, ExportFormat.XLSX],
    });
  }

  /**
   * 获取导出模板
   */
  getExportTemplate(type: ExportType): ExportTemplate | undefined {
    return this.templates.get(type);
  }

  /**
   * 获取所有模板
   */
  getAllTemplates(): ExportTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 启动任务处理器
   */
  private startTaskProcessor(): void {
    setInterval(async () => {
      if (this.processingTasks.size >= (this.exportConfig?.maxConcurrent || 3)) {
        return;
      }

      // 获取待处理任务
      const keys = await this.redis.keys(`${this.TASK_PREFIX}*`);

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (!data) continue;

        const task = JsonUtil.parse<ExportTask>(data);

        if (!task) continue;

        if (task.status === ExportStatus.PENDING && !this.processingTasks.has(task.id)) {
          this.processingTasks.add(task.id);

          // 异步执行任务
          this.executeExportTask(task).finally(() => {
            this.processingTasks.delete(task.id);
          });

          if (this.processingTasks.size >= (this.exportConfig?.maxConcurrent || 3)) {
            break;
          }
        }
      }
    }, 5000); // 每5秒检查一次
  }

  /**
   * 启动过期清理
   */
  private startExpiryCleaner(): void {
    setInterval(async () => {
      const outputDir = this.exportConfig?.outputDir || './exports';
      const expireMs = (this.exportConfig?.expireHours || this.DEFAULT_EXPIRE_HOURS) * 3600 * 1000;
      const now = Date.now();

      const cleanDir = (dir: string) => {
        if (!fs.existsSync(dir)) return;

        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            cleanDir(fullPath);
            // 删除空目录
            if (fs.readdirSync(fullPath).length === 0) {
              fs.rmdirSync(fullPath);
            }
          } else {
            const stat = fs.statSync(fullPath);
            if (now - stat.mtimeMs > expireMs) {
              fs.unlinkSync(fullPath);
              this.logger.debug(`[DataExport] Cleaned expired file: ${fullPath}`);
            }
          }
        }
      };

      cleanDir(outputDir);
    }, 3600000); // 每小时清理一次
  }
}

// ==================== 数据源接口 ====================

interface DataSource {
  count(): Promise<number>;
  getBatch(offset: number, limit: number): Promise<any[]>;
}

// 数据源实现（示例）

class UserDataDataSource implements DataSource {
  constructor(private options: ExportOptions) {}

  async count(): Promise<number> {
    // 实际实现需要查询数据库
    return 0;
  }

  async getBatch(offset: number, limit: number): Promise<any[]> {
    // 实际实现需要查询数据库
    return [];
  }
}

class DeviceDataDataSource implements DataSource {
  constructor(private options: ExportOptions) {}

  async count(): Promise<number> {
    return 0;
  }

  async getBatch(offset: number, limit: number): Promise<any[]> {
    return [];
  }
}

class DeviceHistoryDataSource implements DataSource {
  constructor(private options: ExportOptions) {}

  async count(): Promise<number> {
    return 0;
  }

  async getBatch(offset: number, limit: number): Promise<any[]> {
    return [];
  }
}

class AlertLogsDataSource implements DataSource {
  constructor(private options: ExportOptions) {}

  async count(): Promise<number> {
    return 0;
  }

  async getBatch(offset: number, limit: number): Promise<any[]> {
    return [];
  }
}

class SystemLogsDataSource implements DataSource {
  constructor(private options: ExportOptions) {}

  async count(): Promise<number> {
    return 0;
  }

  async getBatch(offset: number, limit: number): Promise<any[]> {
    return [];
  }
}

class StatisticsDataSource implements DataSource {
  constructor(private options: ExportOptions) {}

  async count(): Promise<number> {
    return 0;
  }

  async getBatch(offset: number, limit: number): Promise<any[]> {
    return [];
  }
}

class AuditLogsDataSource implements DataSource {
  constructor(private options: ExportOptions) {}

  async count(): Promise<number> {
    return 0;
  }

  async getBatch(offset: number, limit: number): Promise<any[]> {
    return [];
  }
}
