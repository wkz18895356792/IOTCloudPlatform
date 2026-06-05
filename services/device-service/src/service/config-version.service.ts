import { Provide, Inject } from '@midwayjs/core';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * 配置变更类型
 */
export enum ConfigChangeType {
  /** 创建 */
  CREATE = 'create',
  /** 更新 */
  UPDATE = 'update',
  /** 删除 */
  DELETE = 'delete',
  /** 回滚 */
  ROLLBACK = 'rollback',
}

/**
 * 配置状态
 */
export enum ConfigStatus {
  /** 草稿 */
  DRAFT = 'draft',
  /** 活跃 */
  ACTIVE = 'active',
  /** 已归档 */
  ARCHIVED = 'archived',
}

/**
 * 配置变更记录
 */
export interface ConfigChangeRecord {
  /** 变更ID */
  id: string;
  /** 配置键 */
  configKey: string;
  /** 变更类型 */
  changeType: ConfigChangeType;
  /** 旧值 */
  oldValue?: any;
  /** 新值 */
  newValue?: any;
  /** 变更时间 */
  changedAt: number;
  /** 操作人 */
  changedBy: string;
  /** 变更原因 */
  reason?: string;
  /** 版本号 */
  version: number;
  /** 差异描述 */
  diff?: string;
}

/**
 * 配置版本
 */
export interface ConfigVersion {
  /** 版本ID */
  id: string;
  /** 配置键 */
  configKey: string;
  /** 版本号 */
  version: number;
  /** 配置值 */
  value: any;
  /** 配置状态 */
  status: ConfigStatus;
  /** 创建时间 */
  createdAt: number;
  /** 创建者 */
  createdBy: string;
  /** 父版本ID */
  parentVersionId?: string;
  /** 变更摘要 */
  changeSummary?: string;
  /** 标签 */
  tags?: string[];
  /** 是否为当前活跃版本 */
  isActive: boolean;
  /** 配置数据类型 */
  dataType: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** 配置元数据 */
  metadata?: Record<string, any>;
}

/**
 * 配置比较结果
 */
export interface ConfigDiff {
  /** 配置键 */
  key: string;
  /** 是否有变化 */
  hasChanges: boolean;
  /** 变更类型 */
  changeType: 'added' | 'removed' | 'modified' | 'unchanged';
  /** 旧值 */
  oldValue?: any;
  /** 新值 */
  newValue?: any;
  /** 差异详情 */
  diff?: string;
}

/**
 * 配置快照
 */
export interface ConfigSnapshot {
  /** 快照ID */
  id: string;
  /** 快照名称 */
  name: string;
  /** 快照描述 */
  description?: string;
  /** 配置数据 */
  configs: Array<{
    key: string;
    value: any;
    version: number;
  }>;
  /** 创建时间 */
  createdAt: number;
  /** 创建者 */
  createdBy: string;
  /** 标签 */
  tags?: string[];
}

/**
 * 配置版本管理服务
 * 管理设备配置的版本控制、变更历史和回滚功能
 */
@Provide()
export class ConfigVersionService {
  @Inject()
  redis!: RedisService;

  @Inject()
  logger!: ILogger;

  private readonly VERSION_PREFIX = 'config:version:';
  private readonly CHANGE_PREFIX = 'config:change:';
  private readonly SNAPSHOT_PREFIX = 'config:snapshot:';
  private readonly INDEX_PREFIX = 'config:index:';
  private readonly STATS_KEY = 'config:version:stats';
  private readonly DEFAULT_TTL = 86400 * 90; // 90天

  /**
   * 创建配置版本
   *
   * @param configKey 配置键
   * @param value 配置值
   * @param createdBy 创建者
   * @param changeSummary 变更摘要
   * @param parentVersionId 父版本ID
   * @returns 创建的版本
   */
  async createVersion(
    configKey: string,
    value: any,
    createdBy: string,
    changeSummary?: string,
    parentVersionId?: string
  ): Promise<ConfigVersion> {
    const id = uuidv4();
    const now = Date.now();

    // 获取当前版本号
    const currentVersion = await this.getCurrentVersion(configKey);
    const newVersion = currentVersion ? currentVersion.version + 1 : 1;

    // 确定数据类型
    const dataType = this.getDataType(value);

    const newVersionRecord: ConfigVersion = {
      id,
      configKey,
      version: newVersion,
      value,
      status: ConfigStatus.ACTIVE,
      createdAt: now,
      createdBy,
      parentVersionId,
      changeSummary,
      isActive: true,
      dataType,
    };

    // 保存新版本
    await this.saveVersion(newVersionRecord);

    // 如果有当前活跃版本，将其设为非活跃
    if (currentVersion && currentVersion.isActive) {
      currentVersion.isActive = false;
      currentVersion.status = ConfigStatus.ARCHIVED;
      await this.saveVersion(currentVersion);
    }

    // 记录变更
    await this.recordChange({
      id: uuidv4(),
      configKey,
      changeType: ConfigChangeType.CREATE,
      oldValue: currentVersion?.value,
      newValue: value,
      changedAt: now,
      changedBy: createdBy,
      reason: changeSummary,
      version: newVersion,
    });

    // 更新索引
    await this.updateIndex(configKey, id);

    this.logger.info(`[ConfigVersion] Created version ${newVersion} for config ${configKey}`);
    return newVersionRecord;
  }

  /**
   * 获取当前活跃版本
   *
   * @param configKey 配置键
   * @returns 当前版本
   */
  async getCurrentVersion(configKey: string): Promise<ConfigVersion | null> {
    try {
      const indexKey = `${this.INDEX_PREFIX}${configKey}`;
      const activeVersionId = await this.redis.hget(indexKey, 'active');

      if (activeVersionId) {
        return await this.getVersion(activeVersionId);
      }

      return null;
    } catch (error) {
      this.logger.error('[ConfigVersion] Error getting current version:', error);
      return null;
    }
  }

  /**
   * 获取指定版本
   *
   * @param versionId 版本ID
   * @returns 版本信息
   */
  async getVersion(versionId: string): Promise<ConfigVersion | null> {
    try {
      const key = `${this.VERSION_PREFIX}${versionId}`;
      const data = await this.redis.get(key);

      if (data) {
        return JSON.parse(data) as ConfigVersion;
      }

      return null;
    } catch (error) {
      this.logger.error('[ConfigVersion] Error getting version:', error);
      return null;
    }
  }

  /**
   * 获取配置的所有版本
   *
   * @param configKey 配置键
   * @param limit 限制数量
   * @returns 版本列表
   */
  async getVersions(configKey: string, limit: number = 50): Promise<ConfigVersion[]> {
    try {
      const indexKey = `${this.INDEX_PREFIX}${configKey}`;
      const versionIds = await this.redis.lrange(indexKey + ':history', 0, limit - 1);

      if (!versionIds || versionIds.length === 0) {
        return [];
      }

      const versions: ConfigVersion[] = [];

      for (const versionId of versionIds) {
        const version = await this.getVersion(versionId);
        if (version) {
          versions.push(version);
        }
      }

      return versions.sort((a, b) => b.version - a.version);
    } catch (error) {
      this.logger.error('[ConfigVersion] Error getting versions:', error);
      return [];
    }
  }

  /**
   * 回滚到指定版本
   *
   * @param configKey 配置键
   * @param targetVersionId 目标版本ID
   * @param rolledBy 回滚操作人
   * @param reason 回滚原因
   * @returns 新创建的版本
   */
  async rollbackToVersion(
    configKey: string,
    targetVersionId: string,
    rolledBy: string,
    reason?: string
  ): Promise<ConfigVersion> {
    const targetVersion = await this.getVersion(targetVersionId);
    if (!targetVersion) {
      throw new Error(`Target version ${targetVersionId} not found`);
    }

    if (targetVersion.configKey !== configKey) {
      throw new Error(`Version ${targetVersionId} does not belong to config ${configKey}`);
    }

    const currentVersion = await this.getCurrentVersion(configKey);
    if (!currentVersion) {
      throw new Error(`No current version found for config ${configKey}`);
    }

    // 创建新版本，使用目标版本的值
    const newVersion = await this.createVersion(
      configKey,
      targetVersion.value,
      rolledBy,
      `Rollback to version ${targetVersion.version}: ${reason || 'No reason provided'}`,
      currentVersion.id
    );

    // 记录回滚变更
    await this.recordChange({
      id: uuidv4(),
      configKey,
      changeType: ConfigChangeType.ROLLBACK,
      oldValue: currentVersion.value,
      newValue: targetVersion.value,
      changedAt: Date.now(),
      changedBy: rolledBy,
      reason,
      version: newVersion.version,
    });

    this.logger.info(`[ConfigVersion] Rolled back ${configKey} to version ${targetVersion.version}`);
    return newVersion;
  }

  /**
   * 比较两个版本
   *
   * @param versionId1 版本1 ID
   * @param versionId2 版本2 ID
   * @returns 差异列表
   */
  async compareVersions(versionId1: string, versionId2: string): Promise<ConfigDiff[]> {
    const version1 = await this.getVersion(versionId1);
    const version2 = await this.getVersion(versionId2);

    if (!version1 || !version2) {
      throw new Error('One or both versions not found');
    }

    return this.compareValues(version1.configKey, version1.value, version2.value);
  }

  /**
   * 比较当前值与新值
   *
   * @param configKey 配置键
   * @param newValue 新值
   * @returns 差异信息
   */
  async compareWithCurrent(configKey: string, newValue: any): Promise<ConfigDiff[]> {
    const currentVersion = await this.getCurrentVersion(configKey);
    const oldValue = currentVersion?.value;

    return this.compareValues(configKey, oldValue, newValue);
  }

  /**
   * 获取配置变更历史
   *
   * @param configKey 配置键
   * @param limit 限制数量
   * @returns 变更记录列表
   */
  async getChangeHistory(configKey: string, limit: number = 50): Promise<ConfigChangeRecord[]> {
    try {
      const historyKey = `${this.CHANGE_PREFIX}${configKey}`;
      const records = await this.redis.lrange(historyKey, 0, limit - 1);

      return records.map(record => JSON.parse(record) as ConfigChangeRecord);
    } catch (error) {
      this.logger.error('[ConfigVersion] Error getting change history:', error);
      return [];
    }
  }

  /**
   * 创建配置快照
   *
   * @param name 快照名称
   * @param description 快照描述
   * @param createdBy 创建者
   * @param configKeys 要包含的配置键列表，为空则包含所有
   * @returns 快照ID
   */
  async createSnapshot(
    name: string,
    description: string,
    createdBy: string,
    configKeys?: string[]
  ): Promise<string> {
    const snapshotId = uuidv4();
    const configs: Array<{ key: string; value: any; version: number }> = [];

    // 如果指定了配置键，只获取这些配置
    const keysToSnapshot = configKeys || await this.getAllConfigKeys();

    for (const key of keysToSnapshot) {
      const currentVersion = await this.getCurrentVersion(key);
      if (currentVersion) {
        configs.push({
          key,
          value: currentVersion.value,
          version: currentVersion.version,
        });
      }
    }

    const snapshot: ConfigSnapshot = {
      id: snapshotId,
      name,
      description,
      configs,
      createdAt: Date.now(),
      createdBy,
    };

    const key = `${this.SNAPSHOT_PREFIX}${snapshotId}`;
    await this.redis.set(key, JSON.stringify(snapshot), 'EX', this.DEFAULT_TTL);

    this.logger.info(`[ConfigVersion] Created snapshot ${snapshotId} with ${configs.length} configs`);
    return snapshotId;
  }

  /**
   * 从快照恢复配置
   *
   * @param snapshotId 快照ID
   * @param restoredBy 恢复操作人
   * @returns 恢复的配置数量
   */
  async restoreFromSnapshot(snapshotId: string, restoredBy: string): Promise<number> {
    const key = `${this.SNAPSHOT_PREFIX}${snapshotId}`;
    const data = await this.redis.get(key);

    if (!data) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    const snapshot: ConfigSnapshot = JSON.parse(data);
    let restoredCount = 0;

    for (const config of snapshot.configs) {
      try {
        await this.createVersion(
          config.key,
          config.value,
          restoredBy,
          `Restored from snapshot: ${snapshot.name}`
        );
        restoredCount++;
      } catch (error) {
        this.logger.error(`[ConfigVersion] Error restoring config ${config.key}:`, error);
      }
    }

    this.logger.info(`[ConfigVersion] Restored ${restoredCount} configs from snapshot ${snapshotId}`);
    return restoredCount;
  }

  /**
   * 获取快照
   *
   * @param snapshotId 快照ID
   * @returns 快照信息
   */
  async getSnapshot(snapshotId: string): Promise<ConfigSnapshot | null> {
    try {
      const key = `${this.SNAPSHOT_PREFIX}${snapshotId}`;
      const data = await this.redis.get(key);

      if (data) {
        return JSON.parse(data) as ConfigSnapshot;
      }

      return null;
    } catch (error) {
      this.logger.error('[ConfigVersion] Error getting snapshot:', error);
      return null;
    }
  }

  /**
   * 列出所有快照
   *
   * @param limit 限制数量
   * @returns 快照列表
   */
  async listSnapshots(limit: number = 50): Promise<ConfigSnapshot[]> {
    try {
      const pattern = `${this.SNAPSHOT_PREFIX}*`;
      const keys = await this.redis.keys(pattern);

      const snapshots: ConfigSnapshot[] = [];

      for (const key of keys.slice(0, limit)) {
        const data = await this.redis.get(key);
        if (data) {
          snapshots.push(JSON.parse(data) as ConfigSnapshot);
        }
      }

      return snapshots.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      this.logger.error('[ConfigVersion] Error listing snapshots:', error);
      return [];
    }
  }

  /**
   * 删除快照
   *
   * @param snapshotId 快照ID
   */
  async deleteSnapshot(snapshotId: string): Promise<void> {
    const key = `${this.SNAPSHOT_PREFIX}${snapshotId}`;
    await this.redis.del(key);
    this.logger.info(`[ConfigVersion] Deleted snapshot ${snapshotId}`);
  }

  /**
   * 给版本添加标签
   *
   * @param versionId 版本ID
   * @param tags 标签列表
   */
  async addTagsToVersion(versionId: string, tags: string[]): Promise<void> {
    const version = await this.getVersion(versionId);
    if (!version) {
      throw new Error(`Version ${versionId} not found`);
    }

    version.tags = [...(version.tags || []), ...tags];
    await this.saveVersion(version);

    this.logger.info(`[ConfigVersion] Added tags to version ${versionId}: ${tags.join(', ')}`);
  }

  /**
   * 按标签搜索版本
   *
   * @param tag 标签
   * @returns 版本列表
   */
  async searchByTag(tag: string): Promise<ConfigVersion[]> {
    try {
      const pattern = `${this.VERSION_PREFIX}*`;
      const keys = await this.redis.keys(pattern);

      const matchingVersions: ConfigVersion[] = [];

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const version: ConfigVersion = JSON.parse(data);
          if (version.tags && version.tags.includes(tag)) {
            matchingVersions.push(version);
          }
        }
      }

      return matchingVersions;
    } catch (error) {
      this.logger.error('[ConfigVersion] Error searching by tag:', error);
      return [];
    }
  }

  /**
   * 获取所有配置键
   *
   * @returns 配置键列表
   */
  async getAllConfigKeys(): Promise<string[]> {
    try {
      const pattern = `${this.INDEX_PREFIX}*`;
      const keys = await this.redis.keys(pattern);

      return keys.map(key => key.replace(this.INDEX_PREFIX, ''));
    } catch (error) {
      this.logger.error('[ConfigVersion] Error getting all config keys:', error);
      return [];
    }
  }

  /**
   * 保存版本
   */
  private async saveVersion(version: ConfigVersion): Promise<void> {
    const key = `${this.VERSION_PREFIX}${version.id}`;
    await this.redis.set(key, JSON.stringify(version), 'EX', this.DEFAULT_TTL);
  }

  /**
   * 记录变更
   */
  private async recordChange(record: ConfigChangeRecord): Promise<void> {
    const historyKey = `${this.CHANGE_PREFIX}${record.configKey}`;
    await this.redis.lpush(historyKey, JSON.stringify(record));

    // 限制历史记录长度
    await this.redis.ltrim(historyKey, 0, 999);
    await this.redis.expire(historyKey, this.DEFAULT_TTL);
  }

  /**
   * 更新索引
   */
  private async updateIndex(configKey: string, versionId: string): Promise<void> {
    const indexKey = `${this.INDEX_PREFIX}${configKey}`;
    await this.redis.hset(indexKey, 'active', versionId);

    const historyKey = indexKey + ':history';
    await this.redis.lpush(historyKey, versionId);
    await this.redis.ltrim(historyKey, 0, 99);

    await this.redis.expire(indexKey, this.DEFAULT_TTL);
    await this.redis.expire(historyKey, this.DEFAULT_TTL);
  }

  /**
   * 比较值
   */
  private compareValues(key: string, oldValue: any, newValue: any): ConfigDiff[] {
    const diffs: ConfigDiff[] = [];

    if (oldValue === newValue) {
      diffs.push({
        key,
        hasChanges: false,
        changeType: 'unchanged',
        oldValue,
        newValue,
      });
      return diffs;
    }

    // 处理对象类型
    if (typeof oldValue === 'object' && typeof newValue === 'object' && oldValue !== null && newValue !== null) {
      const allKeys = new Set([...Object.keys(oldValue || {}), ...Object.keys(newValue || {})]);

      for (const subKey of allKeys) {
        const subOldValue = oldValue?.[subKey];
        const subNewValue = newValue?.[subKey];

        if (subKey in (oldValue || {}) && !(subKey in (newValue || {}))) {
          diffs.push({
            key: `${key}.${subKey}`,
            hasChanges: true,
            changeType: 'removed',
            oldValue: subOldValue,
          });
        } else if (!(subKey in (oldValue || {})) && subKey in (newValue || {})) {
          diffs.push({
            key: `${key}.${subKey}`,
            hasChanges: true,
            changeType: 'added',
            newValue: subNewValue,
          });
        } else if (subOldValue !== subNewValue) {
          diffs.push({
            key: `${key}.${subKey}`,
            hasChanges: true,
            changeType: 'modified',
            oldValue: subOldValue,
            newValue: subNewValue,
          });
        }
      }
    } else {
      // 简单值比较
      if (oldValue === undefined) {
        diffs.push({
          key,
          hasChanges: true,
          changeType: 'added',
          newValue,
        });
      } else if (newValue === undefined) {
        diffs.push({
          key,
          hasChanges: true,
          changeType: 'removed',
          oldValue,
        });
      } else {
        diffs.push({
          key,
          hasChanges: true,
          changeType: 'modified',
          oldValue,
          newValue,
        });
      }
    }

    return diffs;
  }

  /**
   * 获取数据类型
   */
  private getDataType(value: any): ConfigVersion['dataType'] {
    if (value === null) return 'object';
    const type = typeof value;
    if (type === 'boolean') return 'boolean';
    if (type === 'number') return 'number';
    if (type === 'string') return 'string';
    if (Array.isArray(value)) return 'array';
    return 'object';
  }
}
