import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, In } from 'typeorm';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import {
  HelpArticle,
  HelpFeedback,
  SupportTicket,
  HelpCategory,
  HelpArticleStatus,
} from '../entity/help-center.entity';
import { IdGenerator, CacheManager, SqlSafeUtil } from '@baby-monitor/shared-utils';

/**
 * 帮助中心服务
 *
 * 负责帮助文章、FAQ和技术支持工单管理
 */
@Provide()
export class HelpCenterService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  @InjectEntityModel(HelpArticle)
  articleRepository!: Repository<HelpArticle>;

  @InjectEntityModel(HelpFeedback)
  feedbackRepository!: Repository<HelpFeedback>;

  @InjectEntityModel(SupportTicket)
  ticketRepository!: Repository<SupportTicket>;

  // 缓存过期时间（1小时）
  private readonly CACHE_TTL = 3600;

  // ==================== 帮助文章 ====================

  /**
   * 获取帮助文章列表
   *
   * @param options - 查询选项
   * @returns 文章列表
   */
  async getArticles(options: {
    category?: HelpCategory;
    language?: string;
    status?: HelpArticleStatus;
    limit?: number;
    offset?: number;
  }): Promise<{
    list: HelpArticle[];
    total: number;
  }> {
    const cacheKey = `help:articles:${JSON.stringify(options)}`;
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const where: any = {};

    if (options.category) {
      where.category = options.category;
    }

    if (options.status) {
      where.status = options.status;
    } else {
      where.status = HelpArticleStatus.PUBLISHED;
    }

    if (options.language) {
      where.language = options.language;
    }

    const [list, total] = await this.articleRepository.findAndCount({
      where,
      order: { isPinned: 'DESC', order: 'ASC', createdAt: 'DESC' } as any,
      take: options.limit || 50,
      skip: options.offset || 0,
    });

    const result = { list, total };
    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

    return result;
  }

  /**
   * 获取文章详情
   *
   * @param articleId - 文章ID
   * @returns 文章详情
   */
  async getArticle(articleId: string): Promise<HelpArticle | null> {
    const article = await this.articleRepository.findOne({
      where: { id: articleId } as any,
    });

    if (article) {
      // 增加浏览次数
      await this.articleRepository.increment({ id: articleId } as any, 'viewCount', 1);
    }

    return article;
  }

  /**
   * 搜索文章
   *
   * @param keyword - 搜索关键词
   * @param language - 语言代码
   * @returns 搜索结果
   */
  async searchArticles(keyword: string, language = 'zh-CN'): Promise<HelpArticle[]> {
    const articles = await this.articleRepository
      .createQueryBuilder('article')
      .where('article.status = :status', { status: HelpArticleStatus.PUBLISHED })
      .andWhere('article.language = :language', { language })
      .andWhere(
        '(article.title LIKE :keyword OR article.content LIKE :keyword OR article.summary LIKE :keyword)',
        { keyword: SqlSafeUtil.likeContains(keyword) }
      )
      .orderBy('article.isPinned', 'DESC')
      .addOrderBy('article.order', 'ASC')
      .addOrderBy('article.viewCount', 'DESC')
      .limit(20)
      .getMany();

    return articles;
  }

  /**
   * 获取相关文章
   *
   * @param articleId - 文章ID
   * @returns 相关文章列表
   */
  async getRelatedArticles(articleId: string): Promise<HelpArticle[]> {
    const article = await this.articleRepository.findOne({
      where: { id: articleId } as any,
    });

    if (!article || !article.relatedArticles || article.relatedArticles.length === 0) {
      return [];
    }

    const relatedArticles = await this.articleRepository.find({
      where: {
        id: In(article.relatedArticles),
        status: HelpArticleStatus.PUBLISHED,
      } as any,
      order: { order: 'ASC' } as any,
    });

    return relatedArticles;
  }

  /**
   * 记录文章反馈
   *
   * @param articleId - 文章ID
   * @param userId - 用户ID
   * @param feedbackType - 反馈类型
   * @param content - 反馈内容
   */
  async recordFeedback(
    articleId: string,
    userId: string | null,
    feedbackType: 'helpful' | 'not_helpful' | 'contact_us',
    content?: string
  ): Promise<HelpFeedback> {
    const feedback = this.feedbackRepository.create({
      id: IdGenerator.uuid(),
      articleId,
      userId,
      feedbackType,
      content: content || null,
    });

    const saved = await this.feedbackRepository.save(feedback);

    // 更新文章统计
    if (feedbackType === 'helpful') {
      await this.articleRepository.increment({ id: articleId } as any, 'helpfulCount', 1);
    }

    this.logger.info(`[HelpCenter] Recorded feedback for article: ${articleId}, type: ${feedbackType}`);

    return saved;
  }

  /**
   * 获取热门文章
   *
   * @param limit - 返回数量
   * @returns 热门文章列表
   */
  async getPopularArticles(limit = 10): Promise<HelpArticle[]> {
    return await this.articleRepository.find({
      where: { status: HelpArticleStatus.PUBLISHED } as any,
      order: { viewCount: 'DESC' } as any,
      take: limit,
    });
  }

  // ==================== 技术支持工单 ====================

  /**
   * 创建工单
   *
   * @param userId - 用户ID
   * @param ticketData - 工单数据
   * @returns 创建的工单
   */
  async createTicket(userId: string, ticketData: {
    title: string;
    description: string;
    ticketType: 'technical' | 'billing' | 'feature' | 'bug' | 'other';
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    deviceId?: string;
    attachments?: string[];
  }): Promise<SupportTicket> {
    const ticket = this.ticketRepository.create({
      id: IdGenerator.uuid(),
      userId,
      ...ticketData,
      priority: ticketData.priority || 'medium',
      status: 'open',
    });

    const saved = await this.ticketRepository.save(ticket);

    this.logger.info(`[HelpCenter] Created support ticket: ${saved.id} for user: ${userId}`);

    return saved;
  }

  /**
   * 获取用户工单列表
   *
   * @param userId - 用户ID
   * @param options - 查询选项
   * @returns 工单列表
   */
  async getUserTickets(userId: string, options: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    list: SupportTicket[];
    total: number;
  }> {
    const where: any = { userId };

    if (options.status) {
      where.status = options.status;
    }

    const [list, total] = await this.ticketRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' } as any,
      take: options.limit || 20,
      skip: options.offset || 0,
    });

    return { list, total };
  }

  /**
   * 获取工单详情
   *
   * @param ticketId - 工单ID
   * @param userId - 用户ID
   * @returns 工单详情
   */
  async getTicket(ticketId: string, userId: string): Promise<SupportTicket | null> {
    return await this.ticketRepository.findOne({
      where: { id: ticketId, userId } as any,
    });
  }

  /**
   * 更新工单
   *
   * @param ticketId - 工单ID
   * @param userId - 用户ID
   * @param updates - 更新数据
   * @returns 更新后的工单
   */
  async updateTicket(
    ticketId: string,
    userId: string,
    updates: {
      description?: string;
      attachments?: string[];
    }
  ): Promise<SupportTicket | null> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId, userId } as any,
    });

    if (!ticket) {
      return null;
    }

    if (ticket.status === 'closed') {
      throw new Error('工单已关闭，无法更新');
    }

    if (updates.description) {
      ticket.description = updates.description;
    }

    if (updates.attachments) {
      ticket.attachments = updates.attachments;
    }

    const saved = await this.ticketRepository.save(ticket);

    this.logger.info(`[HelpCenter] Updated support ticket: ${ticketId}`);

    return saved;
  }

  /**
   * 关闭工单
   *
   * @param ticketId - 工单ID
   * @param userId - 用户ID
   * @returns 是否关闭成功
   */
  async closeTicket(ticketId: string, userId: string): Promise<boolean> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId, userId } as any,
    });

    if (!ticket) {
      return false;
    }

    ticket.status = 'closed';
    ticket.closedAt = new Date();

    await this.ticketRepository.save(ticket);

    this.logger.info(`[HelpCenter] Closed support ticket: ${ticketId}`);

    return true;
  }

  /**
   * 获取工单统计
   *
   * @param userId - 用户ID
   * @returns 统计信息
   */
  async getTicketStats(userId: string): Promise<{
    total: number;
    open: number;
    inProgress: number;
    pending: number;
    resolved: number;
    closed: number;
  }> {
    const tickets = await this.ticketRepository.find({
      where: { userId } as any,
    });

    const stats = {
      total: tickets.length,
      open: 0,
      inProgress: 0,
      pending: 0,
      resolved: 0,
      closed: 0,
    };

    for (const ticket of tickets) {
      stats[ticket.status as keyof typeof stats]++;
    }

    return stats;
  }

  /**
   * 清除缓存
   *
   * @param pattern - 缓存键模式
   */
  async clearCache(pattern?: string): Promise<void> {
    const keys = await this.cacheManager.keysByPattern(`help:${pattern || '*'}`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
