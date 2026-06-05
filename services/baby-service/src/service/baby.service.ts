import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@midwayjs/redis';
import { Baby } from '../entity/baby.entity';
import { BabyStatus } from '@baby-monitor/shared-types';
import { PaginationParams, PaginatedResponse } from '@baby-monitor/shared-types';

/**
 * 宝宝档案服务类
 *
 * 负责宝宝档案的管理，包括：
 * - 宝宝档案的创建、查询、更新和删除
 * - 设备关联管理
 * - 年龄计算
 * - 缓存管理（使用Redis缓存宝宝信息）
 */
@Provide()
export class BabyService {
  @Inject()
  redis!: RedisService;

  @InjectEntityModel(Baby)
  babyRepository!: Repository<Baby>;

  // 缓存过期时间（秒），设置为1小时
  private readonly CACHE_TTL = 3600; // 1小时

  /**
   * 创建宝宝档案
   *
   * 为用户创建新的宝宝档案，包括基本信息、出生信息等
   * 创建后会自动缓存宝宝信息以提高后续访问速度
   *
   * @param userId - 用户ID，档案的所有者
   * @param data - 宝宝档案数据（姓名、性别、出生日期等）
   * @returns 创建的宝宝档案对象
   */
  async createBaby(userId: string, data: Partial<Baby>): Promise<Baby> {
    // 创建宝宝实体，关联用户ID并设置状态为激活
    const baby = this.babyRepository.create({
      ...data,
      userId,
      status: BabyStatus.ACTIVE,
    });

    // 保存到数据库
    await this.babyRepository.save(baby);
    // 将宝宝信息缓存到Redis
    await this.cacheBaby(baby);

    return baby;
  }

  /**
   * 获取宝宝详情
   *
   * 根据宝宝ID获取详细信息，优先从缓存读取
   * 如果缓存不存在则从数据库查询并更新缓存
   *
   * @param babyId - 宝宝ID
   * @returns 宝宝档案对象，如果不存在则返回null
   */
  async getBaby(babyId: string): Promise<Baby | null> {
    // 先从缓存获取宝宝信息
    const cached = await this.getCachedBaby(babyId);
    if (cached) {
      return cached;
    }

    // 缓存未命中，从数据库查询
    const baby = await this.babyRepository.findOne({ where: { id: babyId } as any });
    if (baby) {
      // 查询成功，更新缓存
      await this.cacheBaby(baby);
    }

    return baby;
  }

  /**
   * 获取用户的宝宝列表
   *
   * 分页获取指定用户的所有激活状态的宝宝档案
   * 支持按指定字段排序
   *
   * @param userId - 用户ID
   * @param pagination - 分页参数（页码、每页数量、排序字段、排序方向）
   * @returns 分页结果，包含宝宝列表和分页信息
   */
  async getUserBabies(
    userId: string,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<Baby>> {
    // 解构分页参数，设置默认排序字段和方向
    const { page, pageSize, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;

    // 查询数据库，同时获取数据和总数
    const [items, total] = await this.babyRepository.findAndCount({
      where: { userId, status: BabyStatus.ACTIVE } as any,
      order: { [sortBy]: sortOrder },
      // 计算跳过的记录数
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // 返回分页结果
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 更新宝宝信息
   *
   * 更新宝宝档案的部分信息，更新后会清除缓存
   * 然后重新查询并缓存最新的宝宝信息
   *
   * @param babyId - 宝宝ID
   * @param updates - 要更新的字段和值
   * @returns 更新后的宝宝档案对象，如果宝宝不存在则返回null
   */
  async updateBaby(babyId: string, updates: Partial<Baby>): Promise<Baby | null> {
    // 执行数据库更新操作
    await this.babyRepository.update(babyId, updates);
    // 清除缓存以确保数据一致性
    await this.clearBabyCache(babyId);
    // 重新获取并缓存最新的宝宝信息
    return this.getBaby(babyId);
  }

  /**
   * 删除宝宝（软删除）
   *
   * 将宝宝档案状态设置为已归档，而不是真正删除数据
   * 这样可以保留历史记录，同时在前端隐藏该档案
   *
   * @param babyId - 宝宝ID
   * @returns 删除是否成功
   */
  async deleteBaby(babyId: string): Promise<boolean> {
    // 软删除：将状态更新为归档
    const result = await this.babyRepository.update(babyId, {
      status: BabyStatus.ARCHIVED,
    });
    // 清除缓存
    await this.clearBabyCache(babyId);
    // 检查是否有记录被更新
    return (result.affected ?? 0) > 0;
  }

  /**
   * 关联设备到宝宝
   *
   * 将监控设备关联到指定宝宝，一个宝宝可以有多个设备
   * 如果设备已经关联则不再重复添加
   *
   * @param babyId - 宝宝ID
   * @param deviceId - 设备ID
   * @throws 如果宝宝不存在则抛出错误
   */
  async linkDevice(babyId: string, deviceId: string): Promise<void> {
    // 获取宝宝信息
    const baby = await this.getBaby(babyId);
    if (!baby) {
      throw new Error('Baby not found');
    }

    // 获取当前设备ID列表
    const deviceIds = baby.deviceIds || [];
    // 检查设备是否已关联，避免重复
    if (!deviceIds.includes(deviceId)) {
      deviceIds.push(deviceId);
      // 更新宝宝的设备列表
      await this.updateBaby(babyId, { deviceIds });
    }
  }

  /**
   * 取消关联设备
   *
   * 将设备从宝宝的关联列表中移除
   *
   * @param babyId - 宝宝ID
   * @param deviceId - 要取消关联的设备ID
   * @throws 如果宝宝不存在则抛出错误
   */
  async unlinkDevice(babyId: string, deviceId: string): Promise<void> {
    // 获取宝宝信息
    const baby = await this.getBaby(babyId);
    if (!baby) {
      throw new Error('Baby not found');
    }

    // 从设备列表中过滤掉要取消的设备
    const deviceIds = (baby.deviceIds || []).filter(id => id !== deviceId);
    // 更新宝宝的设备列表
    await this.updateBaby(babyId, { deviceIds });
  }

  /**
   * 获取宝宝的设备列表
   *
   * 获取所有关联到指定宝宝的设备ID列表
   *
   * @param babyId - 宝宝ID
   * @returns 设备ID数组，如果宝宝不存在则返回空数组
   */
  async getBabyDevices(babyId: string): Promise<string[]> {
    const baby = await this.getBaby(babyId);
    return baby?.deviceIds || [];
  }

  /**
   * 计算宝宝年龄
   *
   * 根据宝宝的出生日期计算当前年龄
   * 返回年、月、日和总天数的详细年龄信息
   *
   * @param babyId - 宝宝ID
   * @returns 年龄信息对象，包含年、月、日和总天数；如果宝宝不存在则返回null
   */
  async calculateAge(babyId: string): Promise<{
    years: number;
    months: number;
    days: number;
    totalDays: number;
  } | null> {
    // 获取宝宝信息
    const baby = await this.getBaby(babyId);
    if (!baby) {
      return null;
    }

    // 获取当前时间和出生时间
    const now = new Date();
    const birth = new Date(baby.birthDate);
    // 计算时间差（毫秒）并转换为天数
    const diffTime = Math.abs(now.getTime() - birth.getTime());
    const totalDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    // 计算年、月、日
    const years = Math.floor(totalDays / 365);
    const months = Math.floor((totalDays % 365) / 30);
    const days = totalDays % 30;

    return { years, months, days, totalDays };
  }

  /**
   * 缓存宝宝信息
   *
   * 将宝宝信息存入Redis缓存，设置过期时间为1小时
   * 使用 baby:{id} 作为缓存键
   *
   * @param baby - 宝宝档案对象
   * @private
   */
  private async cacheBaby(baby: Baby): Promise<void> {
    const cacheKey = `baby:${baby.id}`;
    // 存入Redis并设置过期时间
    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(baby));
  }

  /**
   * 获取缓存的宝宝信息
   *
   * 从Redis缓存中读取宝宝信息
   *
   * @param babyId - 宝宝ID
   * @returns 缓存的宝宝对象，如果缓存不存在则返回null
   * @private
   */
  private async getCachedBaby(babyId: string): Promise<Baby | null> {
    const cacheKey = `baby:${babyId}`;
    const cached = await this.redis.get(cacheKey);
    // 解析JSON字符串为对象
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * 清除宝宝缓存
   *
   * 从Redis中删除指定的宝宝缓存
   * 在更新或删除宝宝信息时调用，确保数据一致性
   *
   * @param babyId - 宝宝ID
   * @private
   */
  private async clearBabyCache(babyId: string): Promise<void> {
    const cacheKey = `baby:${babyId}`;
    await this.redis.del(cacheKey);
  }
}
