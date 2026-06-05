import { Provide, Inject } from '@midwayjs/core';
import { RedisService } from '@midwayjs/redis';
import { ILogger } from '@midwayjs/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * 设备类型
 */
export enum DeviceType {
  /** 视频监控 */
  VIDEO_MONITOR = 'video_monitor',
  /** 环境传感器 */
  ENVIRONMENT_SENSOR = 'environment_sensor',
  /** 声音传感器 */
  AUDIO_SENSOR = 'audio_sensor',
  /** 运动传感器 */
  MOTION_SENSOR = 'motion_sensor',
  /** 温湿度传感器 */
  TEMP_HUMIDITY_SENSOR = 'temp_humidity_sensor',
  /** 智能摄像头 */
  SMART_CAMERA = 'smart_camera',
  /** 控制器 */
  CONTROLLER = 'controller',
  /** 网关 */
  GATEWAY = 'gateway',
  /** 自定义 */
  CUSTOM = 'custom',
}

/**
 * 设备能力
 */
export interface DeviceCapability {
  /** 能力ID */
  id: string;
  /** 能力名称 */
  name: string;
  /** 能力类型 */
  type: string;
  /** 是否只读 */
  readonly: boolean;
  /** 数据类型 */
  dataType: 'boolean' | 'number' | 'string' | 'object' | 'array';
  /** 取值范围 */
  range?: { min?: number; max?: number; enum?: any[] };
  /** 单位 */
  unit?: string;
  /** 默认值 */
  defaultValue?: any;
  /** 描述 */
  description?: string;
}

/**
 * 设备配置项
 */
export interface DeviceConfigItem {
  /** 配置项ID */
  id: string;
  /** 配置项名称 */
  name: string;
  /** 配置项键 */
  key: string;
  /** 配置项类型 */
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiline';
  /** 默认值 */
  defaultValue: any;
  /** 是否必需 */
  required: boolean;
  /** 验证规则 */
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
  /** 选项（用于select类型） */
  options?: Array<{ label: string; value: any }>;
  /** 描述 */
  description?: string;
  /** 分组 */
  group?: string;
}

/**
 * 设备模板
 */
export interface DeviceTemplate {
  /** 模板ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板代码 */
  code: string;
  /** 设备类型 */
  deviceType: DeviceType;
  /** 制造商 */
  manufacturer?: string;
  /** 型号 */
  model?: string;
  /** 描述 */
  description?: string;
  /** 图标 */
  icon?: string;
  /** 设备能力列表 */
  capabilities: DeviceCapability[];
  /** 配置项列表 */
  configItems: DeviceConfigItem[];
  /** 支持的协议 */
  supportedProtocols: string[];
  /** 固件版本 */
  firmwareVersion?: string;
  /** 硬件版本 */
  hardwareVersion?: string;
  /** 默认配置 */
  defaultConfig?: Record<string, any>;
  /** 验证规则 */
  validationRules?: Record<string, any>;
  /** 生命周期钩子 */
  lifecycleHooks?: {
    onProvision?: string;
    onActivate?: string;
    onConfigure?: string;
    onDecommission?: string;
  };
  /** 状态 */
  status: 'draft' | 'active' | 'deprecated';
  /** 标签 */
  tags?: string[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 创建者 */
  createdBy: string;
  /** 版本 */
  version: string;
  /** 父模板ID（用于继承） */
  parentTemplateId?: string;
}

/**
 * 模板实例配置
 */
export interface TemplateInstanceConfig {
  /** 实例ID */
  instanceId: string;
  /** 模板ID */
  templateId: string;
  /** 配置值 */
  configValues: Record<string, any>;
  /** 覆盖的默认值 */
  overriddenDefaults?: Record<string, any>;
}

/**
 * 模板统计
 */
export interface TemplateStatistics {
  /** 总模板数 */
  totalTemplates: number;
  /** 按类型统计 */
  byType: Record<DeviceType, number>;
  /** 按状态统计 */
  byStatus: Record<string, number>;
  /** 使用次数最多的模板 */
  mostUsedTemplates: Array<{
    templateId: string;
    templateName: string;
    usageCount: number;
  }>;
}

/**
 * 设备模板管理服务
 * 提供设备模板的创建、管理和实例化功能
 */
@Provide()
export class DeviceTemplateService {
  @Inject()
  redis!: RedisService;

  @Inject()
  logger!: ILogger;

  private readonly TEMPLATE_PREFIX = 'device:template:';
  private readonly INSTANCE_PREFIX = 'device:template:instance:';
  private readonly INDEX_PREFIX = 'device:template:index:';
  private readonly STATS_KEY = 'device:template:stats';
  private readonly DEFAULT_TTL = 86400 * 30; // 30天

  /**
   * 创建设备模板
   *
   * @param template 模板信息
   * @returns 创建的模板
   */
  async createTemplate(template: Omit<DeviceTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<DeviceTemplate> {
    const id = uuidv4();
    const now = Date.now();

    // 验证模板代码唯一性
    const existing = await this.getTemplateByCode(template.code);
    if (existing) {
      throw new Error(`Template with code ${template.code} already exists`);
    }

    const newTemplate: DeviceTemplate = {
      id,
      ...template,
      version: '1.0.0',
      createdAt: now,
      updatedAt: now,
    };

    await this.saveTemplate(newTemplate);
    await this.addToIndex(newTemplate);

    this.logger.info(`[DeviceTemplate] Created template ${newTemplate.code} (ID: ${id})`);
    return newTemplate;
  }

  /**
   * 更新设备模板
   *
   * @param templateId 模板ID
   * @param updates 更新内容
   * @returns 更新后的模板
   */
  async updateTemplate(
    templateId: string,
    updates: Partial<Omit<DeviceTemplate, 'id' | 'createdAt' | 'createdBy' | 'version'>>
  ): Promise<DeviceTemplate | null> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    // 更新模板
    const updated: DeviceTemplate = {
      ...template,
      ...updates,
      updatedAt: Date.now(),
    };

    await this.saveTemplate(updated);

    this.logger.info(`[DeviceTemplate] Updated template ${template.code} (ID: ${templateId})`);
    return updated;
  }

  /**
   * 获取模板
   *
   * @param templateId 模板ID
   * @returns 模板信息
   */
  async getTemplate(templateId: string): Promise<DeviceTemplate | null> {
    try {
      const key = `${this.TEMPLATE_PREFIX}${templateId}`;
      const data = await this.redis.get(key);

      if (data) {
        return JSON.parse(data) as DeviceTemplate;
      }

      return null;
    } catch (error) {
      this.logger.error('[DeviceTemplate] Error getting template:', error);
      return null;
    }
  }

  /**
   * 根据代码获取模板
   *
   * @param code 模板代码
   * @returns 模板信息
   */
  async getTemplateByCode(code: string): Promise<DeviceTemplate | null> {
    try {
      const indexKey = `${this.INDEX_PREFIX}code:${code}`;
      const templateId = await this.redis.get(indexKey);

      if (templateId) {
        return await this.getTemplate(templateId);
      }

      return null;
    } catch (error) {
      this.logger.error('[DeviceTemplate] Error getting template by code:', error);
      return null;
    }
  }

  /**
   * 根据设备类型获取模板列表
   *
   * @param deviceType 设备类型
   * @param status 可选的状态过滤
   * @returns 模板列表
   */
  async getTemplatesByType(deviceType: DeviceType, status?: string): Promise<DeviceTemplate[]> {
    try {
      const indexKey = `${this.INDEX_PREFIX}type:${deviceType}`;
      const templateIds = await this.redis.smembers(indexKey);

      if (!templateIds || templateIds.length === 0) {
        return [];
      }

      const templates: DeviceTemplate[] = [];

      for (const templateId of templateIds) {
        const template = await this.getTemplate(templateId);
        if (template && (!status || template.status === status)) {
          templates.push(template);
        }
      }

      return templates;
    } catch (error) {
      this.logger.error('[DeviceTemplate] Error getting templates by type:', error);
      return [];
    }
  }

  /**
   * 删除模板
   *
   * @param templateId 模板ID
   */
  async deleteTemplate(templateId: string): Promise<void> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    // 检查是否有实例在使用
    const instancesCount = await this.getInstanceCount(templateId);
    if (instancesCount > 0) {
      throw new Error(`Cannot delete template with ${instancesCount} active instances`);
    }

    const key = `${this.TEMPLATE_PREFIX}${templateId}`;
    await this.redis.del(key);

    // 从索引中移除
    await this.removeFromIndex(template);

    this.logger.info(`[DeviceTemplate] Deleted template ${template.code} (ID: ${templateId})`);
  }

  /**
   * 从模板创建设备实例配置
   *
   * @param templateId 模板ID
   * @param customConfig 自定义配置
   * @returns 实例配置
   */
  async createInstance(
    templateId: string,
    customConfig?: Record<string, any>
  ): Promise<TemplateInstanceConfig> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const instanceId = uuidv4();
    const configValues: Record<string, any> = {};

    // 合并默认配置和自定义配置
    if (template.defaultConfig) {
      Object.assign(configValues, template.defaultConfig);
    }

    // 应用配置项的默认值
    for (const configItem of template.configItems) {
      if (!(configItem.key in configValues)) {
        configValues[configItem.key] = configItem.defaultValue;
      }
    }

    // 应用自定义配置
    if (customConfig) {
      Object.assign(configValues, customConfig);
    }

    const instance: TemplateInstanceConfig = {
      instanceId,
      templateId,
      configValues,
    };

    await this.saveInstance(instance);
    await this.incrementUsage(templateId);

    this.logger.info(`[DeviceTemplate] Created instance ${instanceId} from template ${template.code}`);
    return instance;
  }

  /**
   * 获取实例配置
   *
   * @param instanceId 实例ID
   * @returns 实例配置
   */
  async getInstance(instanceId: string): Promise<TemplateInstanceConfig | null> {
    try {
      const key = `${this.INSTANCE_PREFIX}${instanceId}`;
      const data = await this.redis.get(key);

      if (data) {
        return JSON.parse(data) as TemplateInstanceConfig;
      }

      return null;
    } catch (error) {
      this.logger.error('[DeviceTemplate] Error getting instance:', error);
      return null;
    }
  }

  /**
   * 更新实例配置
   *
   * @param instanceId 实例ID
   * @param configValues 新的配置值
   */
  async updateInstance(instanceId: string, configValues: Record<string, any>): Promise<void> {
    const instance = await this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    const template = await this.getTemplate(instance.templateId);
    if (!template) {
      throw new Error(`Template ${instance.templateId} not found`);
    }

    // 验证配置值
    const validatedConfig = await this.validateConfigValues(template, configValues);

    instance.configValues = { ...instance.configValues, ...validatedConfig };
    await this.saveInstance(instance);

    this.logger.info(`[DeviceTemplate] Updated instance ${instanceId}`);
  }

  /**
   * 验证配置值
   *
   * @param template 模板
   * @param configValues 配置值
   * @returns 验证结果
   */
  async validateConfigValues(
    template: DeviceTemplate,
    configValues: Record<string, any>
  ): Promise<{
    valid: boolean;
    errors: Array<{ key: string; message: string }>;
    validated: Record<string, any>;
  }> {
    const errors: Array<{ key: string; message: string }> = [];
    const validated: Record<string, any> = {};

    for (const configItem of template.configItems) {
      const value = configValues[configItem.key];

      // 检查必需字段
      if (configItem.required && (value === undefined || value === null || value === '')) {
        errors.push({ key: configItem.key, message: `${configItem.name} is required` });
        continue;
      }

      // 跳过非必需的空值
      if (!configItem.required && (value === undefined || value === null || value === '')) {
        continue;
      }

      // 验证规则
      if (configItem.validation) {
        const validation = configItem.validation;

        // 数值范围验证
        if (configItem.type === 'number') {
          const numValue = Number(value);
          if (isNaN(numValue)) {
            errors.push({ key: configItem.key, message: `${configItem.name} must be a number` });
            continue;
          }
          if (validation.min !== undefined && numValue < validation.min) {
            errors.push({ key: configItem.key, message: `${configItem.name} must be at least ${validation.min}` });
          }
          if (validation.max !== undefined && numValue > validation.max) {
            errors.push({ key: configItem.key, message: `${configItem.name} must be at most ${validation.max}` });
          }
          validated[configItem.key] = numValue;
        }
        // 字符串长度验证
        else if (configItem.type === 'string' || configItem.type === 'multiline') {
          const strValue = String(value);
          if (validation.pattern && !new RegExp(validation.pattern).test(strValue)) {
            errors.push({ key: configItem.key, message: `${configItem.name} format is invalid` });
          }
          if (validation.minLength && strValue.length < validation.minLength) {
            errors.push({ key: configItem.key, message: `${configItem.name} must be at least ${validation.minLength} characters` });
          }
          if (validation.maxLength && strValue.length > validation.maxLength) {
            errors.push({ key: configItem.key, message: `${configItem.name} must be at most ${validation.maxLength} characters` });
          }
          validated[configItem.key] = strValue;
        }
        // 选择项验证
        else if (configItem.type === 'select') {
          if (configItem.options) {
            const validOptions = configItem.options.map(opt => opt.value);
            if (!validOptions.includes(value)) {
              errors.push({ key: configItem.key, message: `${configItem.name} must be one of: ${validOptions.join(', ')}` });
              continue;
            }
          }
          validated[configItem.key] = value;
        }
        // 布尔值
        else if (configItem.type === 'boolean') {
          validated[configItem.key] = Boolean(value);
        }
        else {
          validated[configItem.key] = value;
        }
      } else {
        validated[configItem.key] = value;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      validated,
    } as any;
  }

  /**
   * 复制模板
   *
   * @param templateId 模板ID
   * @param newCode 新模板代码
   * @param newName 新模板名称
   * @returns 新模板
   */
  async duplicateTemplate(templateId: string, newCode: string, newName: string): Promise<DeviceTemplate> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const duplicated: Omit<DeviceTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version'> = {
      ...template,
      code: newCode,
      name: newName,
      parentTemplateId: templateId,
      status: 'draft',
    };

    return await this.createTemplate(duplicated);
  }

  /**
   * 发布模板
   *
   * @param templateId 模板ID
   */
  async publishTemplate(templateId: string): Promise<void> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    if (template.status === 'active') {
      return;
    }

    template.status = 'active';
    template.updatedAt = Date.now();
    await this.saveTemplate(template);

    this.logger.info(`[DeviceTemplate] Published template ${template.code}`);
  }

  /**
   * 弃用模板
   *
   * @param templateId 模板ID
   */
  async deprecateTemplate(templateId: string): Promise<void> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    template.status = 'deprecated';
    template.updatedAt = Date.now();
    await this.saveTemplate(template);

    this.logger.info(`[DeviceTemplate] Deprecated template ${template.code}`);
  }

  /**
   * 获取模板统计
   *
   * @returns 统计信息
   */
  async getStatistics(): Promise<TemplateStatistics> {
    try {
      const pattern = `${this.TEMPLATE_PREFIX}*`;
      const keys = await this.redis.keys(pattern);

      const byType: Record<DeviceType, number> = {
        [DeviceType.VIDEO_MONITOR]: 0,
        [DeviceType.ENVIRONMENT_SENSOR]: 0,
        [DeviceType.AUDIO_SENSOR]: 0,
        [DeviceType.MOTION_SENSOR]: 0,
        [DeviceType.TEMP_HUMIDITY_SENSOR]: 0,
        [DeviceType.SMART_CAMERA]: 0,
        [DeviceType.CONTROLLER]: 0,
        [DeviceType.GATEWAY]: 0,
        [DeviceType.CUSTOM]: 0,
      };

      const byStatus: Record<string, number> = {};
      const usageMap: Map<string, { name: string; count: number }> = new Map();

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const template: DeviceTemplate = JSON.parse(data);
          byType[template.deviceType]++;
          byStatus[template.status] = (byStatus[template.status] || 0) + 1;

          const usageCount = await this.getInstanceCount(template.id);
          usageMap.set(template.id, { name: template.name, count: usageCount });
        }
      }

      // 获取使用最多的模板
      const mostUsedTemplates = Array.from(usageMap.entries())
        .map(([templateId, info]) => ({ templateId, templateName: info.name, usageCount: info.count }))
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 10);

      return {
        totalTemplates: keys.length,
        byType,
        byStatus,
        mostUsedTemplates,
      };
    } catch (error) {
      this.logger.error('[DeviceTemplate] Error getting statistics:', error);
      return {
        totalTemplates: 0,
        byType: {
          [DeviceType.VIDEO_MONITOR]: 0,
          [DeviceType.ENVIRONMENT_SENSOR]: 0,
          [DeviceType.AUDIO_SENSOR]: 0,
          [DeviceType.MOTION_SENSOR]: 0,
          [DeviceType.TEMP_HUMIDITY_SENSOR]: 0,
          [DeviceType.SMART_CAMERA]: 0,
          [DeviceType.CONTROLLER]: 0,
          [DeviceType.GATEWAY]: 0,
          [DeviceType.CUSTOM]: 0,
        },
        byStatus: {},
        mostUsedTemplates: [],
      };
    }
  }

  /**
   * 保存模板
   */
  private async saveTemplate(template: DeviceTemplate): Promise<void> {
    const key = `${this.TEMPLATE_PREFIX}${template.id}`;
    await this.redis.set(key, JSON.stringify(template), 'EX', this.DEFAULT_TTL);
  }

  /**
   * 保存实例
   */
  private async saveInstance(instance: TemplateInstanceConfig): Promise<void> {
    const key = `${this.INSTANCE_PREFIX}${instance.instanceId}`;
    await this.redis.set(key, JSON.stringify(instance), 'EX', this.DEFAULT_TTL);
  }

  /**
   * 添加到索引
   */
  private async addToIndex(template: DeviceTemplate): Promise<void> {
    // 按类型索引
    const typeIndexKey = `${this.INDEX_PREFIX}type:${template.deviceType}`;
    await this.redis.sadd(typeIndexKey, template.id);
    await this.redis.expire(typeIndexKey, this.DEFAULT_TTL);

    // 按代码索引
    const codeIndexKey = `${this.INDEX_PREFIX}code:${template.code}`;
    await this.redis.set(codeIndexKey, template.id, 'EX', this.DEFAULT_TTL);
  }

  /**
   * 从索引移除
   */
  private async removeFromIndex(template: DeviceTemplate): Promise<void> {
    const typeIndexKey = `${this.INDEX_PREFIX}type:${template.deviceType}`;
    await this.redis.srem(typeIndexKey, template.id);

    const codeIndexKey = `${this.INDEX_PREFIX}code:${template.code}`;
    await this.redis.del(codeIndexKey);
  }

  /**
   * 增加使用计数
   */
  private async incrementUsage(templateId: string): Promise<void> {
    const key = `${this.STATS_KEY}:usage:${templateId}`;
    await this.redis.incr(key);
    await this.redis.expire(key, this.DEFAULT_TTL);
  }

  /**
   * 获取实例数量
   */
  private async getInstanceCount(templateId: string): Promise<number> {
    const key = `${this.STATS_KEY}:usage:${templateId}`;
    const count = await this.redis.get(key);
    return count ? parseInt(count, 10) : 0;
  }
}
