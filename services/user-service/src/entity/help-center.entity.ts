import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@midwayjs/swagger';

/**
 * 帮助文章分类
 */
export enum HelpCategory {
  /** 快速入门 */
  QUICK_START = 'quick_start',
  /** 设备使用 */
  DEVICE_USAGE = 'device_usage',
  /** 账户管理 */
  ACCOUNT = 'account',
  /** 订阅服务 */
  SUBSCRIPTION = 'subscription',
  /** 故障排查 */
  TROUBLESHOOTING = 'troubleshooting',
  /** 常见问题 */
  FAQ = 'faq',
  /** 隐私安全 */
  PRIVACY = 'privacy',
}

/**
 * 帮助文章状态
 */
export enum HelpArticleStatus {
  /** 草稿 */
  DRAFT = 'draft',
  /** 已发布 */
  PUBLISHED = 'published',
  /** 已归档 */
  ARCHIVED = 'archived',
}

/**
 * 帮助文章
 *
 * 存储帮助中心和FAQ文章
 */
@Entity('help_articles')
@Index(['category'])
@Index(['status'])
@Index(['language'])
@Index(['order'])
export class HelpArticle {
  @ApiProperty({ description: '文章ID' })
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ApiProperty({ description: '文章标题' })
  @Column({ type: 'varchar', length: 200, comment: '文章标题' })
  title!: string;

  @ApiProperty({ description: '文章摘要' })
  @Column({ type: 'text', nullable: true, comment: '文章摘要' })
  summary!: string | null;

  @ApiProperty({ description: '文章内容（Markdown格式）' })
  @Column({ type: 'text', comment: '文章内容(Markdown格式)' })
  content!: string;

  @ApiProperty({ description: '文章分类', enum: HelpCategory })
  @Column({
    type: 'enum',
    enum: Object.values(HelpCategory),
    default: HelpCategory.FAQ,
    comment: '文章分类',
  })
  category!: HelpCategory;

  @ApiProperty({ description: '文章状态', enum: HelpArticleStatus })
  @Column({
    type: 'enum',
    enum: Object.values(HelpArticleStatus),
    default: HelpArticleStatus.DRAFT,
    comment: '文章状态',
  })
  status!: HelpArticleStatus;

  @ApiProperty({ description: '语言代码' })
  @Column({ type: 'varchar', length: 10, default: 'zh-CN', comment: '语言代码' })
  language!: string;

  @ApiProperty({ description: '排序权重' })
  @Column({ type: 'int', default: 0, comment: '排序权重（数字越小越靠前）' })
  order!: number;

  @ApiPropertyOptional({ description: '标签（JSON数组）' })
  @Column({ type: 'json', nullable: true, comment: '标签(JSON数组)' })
  tags!: string[] | null;

  @ApiPropertyOptional({ description: '相关文章ID列表（JSON数组）' })
  @Column({ type: 'json', nullable: true, comment: '相关文章ID列表(JSON数组)' })
  relatedArticles!: string[] | null;

  @ApiPropertyOptional({ description: '浏览次数' })
  @Column({ type: 'int', default: 0, comment: '浏览次数' })
  viewCount!: number;

  @ApiPropertyOptional({ description: '点赞次数' })
  @Column({ type: 'int', default: 0, comment: '点赞次数' })
  likeCount!: number;

  @ApiPropertyOptional({ description: '是否有帮助（有用次数）' })
  @Column({ type: 'int', default: 0, comment: '有帮助次数' })
  helpfulCount!: number;

  @ApiProperty({ description: '是否置顶' })
  @Column({ type: 'boolean', default: false, comment: '是否置顶' })
  isPinned!: boolean;

  @ApiProperty({ description: '作者ID' })
  @Column({ type: 'uuid', comment: '作者ID' })
  authorId!: string;

  @ApiProperty({ description: '最后更新者ID' })
  @Column({ type: 'uuid', nullable: true, comment: '最后更新者ID' })
  lastUpdatedBy!: string | null;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}

/**
 * 用户反馈
 *
 * 记录用户对帮助文章的反馈
 */
@Entity('help_feedback')
@Index(['articleId'])
@Index(['userId'])
@Index(['createdAt'])
export class HelpFeedback {
  @ApiProperty({ description: '反馈ID' })
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ApiProperty({ description: '文章ID' })
  @Column({ type: 'uuid', comment: '文章ID' })
  articleId!: string;

  @ApiPropertyOptional({ description: '用户ID' })
  @Column({ type: 'uuid', nullable: true, comment: '用户ID' })
  userId!: string | null;

  @ApiProperty({ description: '反馈类型' })
  @Column({
    type: 'enum',
    enum: ['helpful', 'not_helpful', 'contact_us'],
    comment: '反馈类型',
  })
  feedbackType!: string;

  @ApiPropertyOptional({ description: '反馈内容' })
  @Column({ type: 'text', nullable: true, comment: '反馈内容' })
  content!: string | null;

  @ApiPropertyOptional({ description: '联系方式' })
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '联系方式' })
  contact!: string | null;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}

/**
 * 工单支持
 *
 * 用户提交的技术支持工单
 */
@Entity('support_tickets')
@Index(['userId'])
@Index(['status'])
@Index(['createdAt'])
export class SupportTicket {
  @ApiProperty({ description: '工单ID' })
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ApiProperty({ description: '用户ID' })
  @Column({ type: 'uuid', comment: '用户ID' })
  userId!: string;

  @ApiProperty({ description: '工单标题' })
  @Column({ type: 'varchar', length: 200, comment: '工单标题' })
  title!: string;

  @ApiProperty({ description: '问题描述' })
  @Column({ type: 'text', comment: '问题描述' })
  description!: string;

  @ApiProperty({ description: '工单类型' })
  @Column({
    type: 'enum',
    enum: ['technical', 'billing', 'feature', 'bug', 'other'],
    comment: '工单类型',
  })
  ticketType!: string;

  @ApiProperty({ description: '优先级' })
  @Column({
    type: 'enum',
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
    comment: '优先级',
  })
  priority!: string;

  @ApiProperty({ description: '工单状态' })
  @Column({
    type: 'enum',
    enum: ['open', 'in_progress', 'pending', 'resolved', 'closed'],
    default: 'open',
    comment: '工单状态',
  })
  status!: string;

  @ApiPropertyOptional({ description: '设备ID（技术问题相关）' })
  @Column({ type: 'uuid', nullable: true, comment: '设备ID' })
  deviceId!: string | null;

  @ApiPropertyOptional({ description: '附件URL列表（JSON数组）' })
  @Column({ type: 'json', nullable: true, comment: '附件URL列表(JSON数组)' })
  attachments!: string[] | null;

  @ApiProperty({ description: '处理人ID' })
  @Column({ type: 'uuid', nullable: true, comment: '处理人ID' })
  assigneeId!: string | null;

  @ApiPropertyOptional({ description: '处理备注' })
  @Column({ type: 'text', nullable: true, comment: '处理备注' })
  resolution!: string | null;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;

  @ApiPropertyOptional({ description: '关闭时间' })
  @Column({ type: 'timestamp', nullable: true, comment: '关闭时间' })
  closedAt!: Date | null;
}
