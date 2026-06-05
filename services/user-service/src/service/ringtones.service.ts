import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
// import { StorageService } from '@baby-monitor/storage-service';
import { NotificationRingtone, RingtoneType, RingtoneCategory } from '../entity/ringtones.entity';
import { IdGenerator, SqlSafeUtil } from '@baby-monitor/shared-utils';

/**
 * 系统预设铃声列表
 */
const SYSTEM_RINGTONES = [
  {
    id: 'system-default',
    name: '默认提示',
    category: RingtoneCategory.DEFAULT,
    fileUrl: 'https://cdn.example.com/ringtones/default.mp3',
    fileSize: 50000,
    duration: 2000,
    format: 'mp3',
    sampleRate: 44100,
    bitRate: 128,
  },
  {
    id: 'system-gentle',
    name: '柔和提示',
    category: RingtoneCategory.GENTLE,
    fileUrl: 'https://cdn.example.com/ringtones/gentle.mp3',
    fileSize: 60000,
    duration: 3000,
    format: 'mp3',
    sampleRate: 44100,
    bitRate: 128,
  },
  {
    id: 'system-alert',
    name: '紧急提醒',
    category: RingtoneCategory.ALERT,
    fileUrl: 'https://cdn.example.com/ringtones/alert.mp3',
    fileSize: 80000,
    duration: 4000,
    format: 'mp3',
    sampleRate: 44100,
    bitRate: 192,
  },
  {
    id: 'system-lullaby',
    name: '摇篮曲',
    category: RingtoneCategory.LULLABY,
    fileUrl: 'https://cdn.example.com/ringtones/lullaby.mp3',
    fileSize: 150000,
    duration: 30000,
    format: 'mp3',
    sampleRate: 44100,
    bitRate: 128,
  },
  {
    id: 'system-crying',
    name: '哭声提示',
    category: RingtoneCategory.CRYING,
    fileUrl: 'https://cdn.example.com/ringtones/crying.mp3',
    fileSize: 70000,
    duration: 5000,
    format: 'mp3',
    sampleRate: 44100,
    bitRate: 128,
  },
  {
    id: 'system-motion',
    name: '移动提醒',
    category: RingtoneCategory.MOTION,
    fileUrl: 'https://cdn.example.com/ringtones/motion.mp3',
    fileSize: 55000,
    duration: 2500,
    format: 'mp3',
    sampleRate: 44100,
    bitRate: 128,
  },
];

/**
 * 通知铃声管理服务
 *
 * 负责通知铃声的上传、管理、播放等功能
 */
@Provide()
export class RingtonesService {
  @Inject()
  logger!: ILogger;

  @InjectEntityModel(NotificationRingtone)
  ringtoneRepository!: Repository<NotificationRingtone>;

  // @Inject()
  // storageService!: any; // StorageService - temporarily commented out

  /**
   * 获取所有可用铃声
   *
   * @param userId - 用户ID
   * @param category - 铃声分类（可选）
   * @returns 铃声列表
   */
  async getRingtones(userId: string, category?: RingtoneCategory): Promise<{
    system: NotificationRingtone[];
    custom: NotificationRingtone[];
  }> {
    const where: any = {
      isActive: true,
    };

    if (category) {
      where.category = category;
    }

    // 获取用户自定义铃声
    const customRingtones = await this.ringtoneRepository.find({
      where: {
        ...where,
        userId,
        type: RingtoneType.CUSTOM,
      } as any,
      order: { createdAt: 'DESC' } as any,
    });

    // 过滤系统铃声
    let systemRingtones = SYSTEM_RINGTONES;
    if (category) {
      systemRingtones = SYSTEM_RINGTONES.filter(r => r.category === category);
    }

    // 转换为实体格式
    const systemEntities = systemRingtones.map(r => ({
      ...r,
      userId: null,
      type: RingtoneType.SYSTEM,
      isActive: true,
      playCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NotificationRingtone));

    return {
      system: systemEntities,
      custom: customRingtones,
    };
  }

  /**
   * 获取铃声详情
   *
   * @param ringtoneId - 铃声ID
   * @param userId - 用户ID
   * @returns 铃声详情
   */
  async getRingtone(ringtoneId: string, userId: string): Promise<NotificationRingtone | null> {
    // 先检查是否是系统铃声
    const systemRingtone = SYSTEM_RINGTONES.find(r => r.id === ringtoneId);
    if (systemRingtone) {
      return {
        ...systemRingtone,
        userId: null,
        type: RingtoneType.SYSTEM,
        isActive: true,
        playCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as NotificationRingtone;
    }

    // 查询用户自定义铃声
    const ringtone = await this.ringtoneRepository.findOne({
      where: {
        id: ringtoneId,
        userId,
        isActive: true,
      } as any,
    });

    return ringtone;
  }

  /**
   * 上传自定义铃声
   *
   * @param userId - 用户ID
   * @param file - 文件信息
   * @param metadata - 元数据
   * @returns 上传的铃声
   */
  async uploadRingtone(userId: string, file: {
    name: string;
    url: string;
    size: number;
    duration: number;
    format: string;
    sampleRate?: number;
    bitRate?: number;
    thumbnailUrl?: string;
  }, metadata: {
    category?: RingtoneCategory;
  }): Promise<NotificationRingtone> {
    // 检查用户自定义铃声数量限制（最多10个）
    const count = await this.ringtoneRepository.count({
      where: {
        userId,
        type: RingtoneType.CUSTOM,
      } as any,
    });

    if (count >= 10) {
      throw new Error('自定义铃声数量已达上限（10个）');
    }

    // 检查文件大小限制（5MB）
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new Error('铃声文件大小不能超过5MB');
    }

    const ringtone = this.ringtoneRepository.create({
      id: IdGenerator.uuid(),
      userId,
      name: file.name,
      type: RingtoneType.CUSTOM,
      category: metadata.category || RingtoneCategory.DEFAULT,
      fileUrl: file.url,
      fileSize: file.size,
      duration: file.duration,
      format: file.format,
      sampleRate: file.sampleRate,
      bitRate: file.bitRate,
      thumbnailUrl: file.thumbnailUrl,
      isActive: true,
      playCount: 0,
    });

    const saved = await this.ringtoneRepository.save(ringtone);

    this.logger.info(`[Ringtones] Uploaded custom ringtone: ${saved.id} for user: ${userId}`);

    return saved;
  }

  /**
   * 删除自定义铃声
   *
   * @param ringtoneId - 铃声ID
   * @param userId - 用户ID
   * @returns 是否删除成功
   */
  async deleteRingtone(ringtoneId: string, userId: string): Promise<boolean> {
    const ringtone = await this.ringtoneRepository.findOne({
      where: {
        id: ringtoneId,
        userId,
      } as any,
    });

    if (!ringtone) {
      return false;
    }

    if (ringtone.type === RingtoneType.SYSTEM) {
      throw new Error('系统预设铃声不能删除');
    }

    await this.ringtoneRepository.remove(ringtone);

    // 删除存储的文件
    // try {
    //   await this.storageService.delete(ringtone.fileUrl);
    // } catch (error) {
    //   this.logger.warn(`[Ringtones] Failed to delete file: ${ringtone.fileUrl}`, error);
    // }

    this.logger.info(`[Ringtones] Deleted ringtone: ${ringtoneId}`);

    return true;
  }

  /**
   * 更新铃声信息
   *
   * @param ringtoneId - 铃声ID
   * @param userId - 用户ID
   * @param updates - 更新数据
   * @returns 更新后的铃声
   */
  async updateRingtone(
    ringtoneId: string,
    userId: string,
    updates: {
      name?: string;
      category?: RingtoneCategory;
      thumbnailUrl?: string;
    }
  ): Promise<NotificationRingtone | null> {
    const ringtone = await this.ringtoneRepository.findOne({
      where: {
        id: ringtoneId,
        userId,
      } as any,
    });

    if (!ringtone) {
      return null;
    }

    if (ringtone.type === RingtoneType.SYSTEM) {
      throw new Error('系统预设铃声不能修改');
    }

    if (updates.name) {
      ringtone.name = updates.name;
    }
    if (updates.category) {
      ringtone.category = updates.category;
    }
    if (updates.thumbnailUrl !== undefined) {
      ringtone.thumbnailUrl = updates.thumbnailUrl;
    }

    const saved = await this.ringtoneRepository.save(ringtone);

    this.logger.info(`[Ringtones] Updated ringtone: ${ringtoneId}`);

    return saved;
  }

  /**
   * 记录铃声播放
   *
   * @param ringtoneId - 铃声ID
   * @param userId - 用户ID
   */
  async recordPlay(ringtoneId: string, userId: string): Promise<void> {
    // 系统铃声不需要记录
    const systemRingtone = SYSTEM_RINGTONES.find(r => r.id === ringtoneId);
    if (systemRingtone) {
      return;
    }

    await this.ringtoneRepository.increment(
      { id: ringtoneId, userId } as any,
      'playCount',
      1
    );
  }

  /**
   * 搜索铃声
   *
   * @param userId - 用户ID
   * @param keyword - 搜索关键词
   * @returns 搜索结果
   */
  async searchRingtones(userId: string, keyword: string): Promise<{
    system: NotificationRingtone[];
    custom: NotificationRingtone[];
  }> {
    const lowerKeyword = keyword.toLowerCase();

    // 搜索系统铃声
    const systemResults = SYSTEM_RINGTONES.filter(function(r) {
      return r.name.toLowerCase().includes(lowerKeyword);
    });

    const systemEntities = systemResults.map(function(r) {
      const entity: any = {
        userId: null,
        type: RingtoneType.SYSTEM,
        isActive: true,
        playCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      Object.assign(entity, r);
      return entity as NotificationRingtone;
    });

    // 搜索用户自定义铃声
    const customResults = await this.ringtoneRepository
      .createQueryBuilder('ringtone')
      .where('ringtone.userId = :userId', { userId })
      .andWhere('ringtone.type = :type', { type: RingtoneType.CUSTOM })
      .andWhere('ringtone.isActive = :isActive', { isActive: true })
      .andWhere('ringtone.name LIKE :keyword', { keyword: SqlSafeUtil.likeContains(keyword) })
      .orderBy('ringtone.createdAt', 'DESC')
      .getMany();

    return {
      system: systemEntities,
      custom: customResults,
    };
  }

  /**
   * 获取用户自定义铃声统计
   *
   * @param userId - 用户ID
   * @returns 统计信息
   */
  async getCustomRingtonesStats(userId: string): Promise<{
    total: number;
    totalSize: number;
    byCategory: Record<string, number>;
  }> {
    const ringtones = await this.ringtoneRepository.find({
      where: {
        userId,
        type: RingtoneType.CUSTOM,
        isActive: true,
      } as any,
    });

    const total = ringtones.length;
    const totalSize = ringtones.reduce((sum, r) => sum + r.fileSize, 0);
    const byCategory: Record<string, number> = {};

    for (const ringtone of ringtones) {
      const category = ringtone.category;
      byCategory[category] = (byCategory[category] || 0) + 1;
    }

    return {
      total,
      totalSize,
      byCategory,
    };
  }
}
