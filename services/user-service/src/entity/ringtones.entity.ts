import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@midwayjs/swagger';

/**
 * 通知铃声类型
 */
export enum RingtoneType {
  /** 系统预设铃声 */
  SYSTEM = 'system',
  /** 用户自定义铃声 */
  CUSTOM = 'custom',
}

/**
 * 通知铃声分类
 */
export enum RingtoneCategory {
  /** 默认提示音 */
  DEFAULT = 'default',
  /** 哭声检测 */
  CRYING = 'crying',
  /** 温湿度告警 */
  ALERT = 'alert',
  /** 移动侦测 */
  MOTION = 'motion',
  /** 摇篮曲 */
  LULLABY = 'lullaby',
  /** 轻音乐 */
  GENTLE = 'gentle',
}

/**
 * 通知铃声
 *
 * 存储系统预设和用户自定义的通知铃声
 */
@Entity('notification_ringtones')
@Index(['userId'])
@Index(['category'])
@Index(['type'])
export class NotificationRingtone {
  @ApiProperty({ description: '铃声ID' })
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ApiPropertyOptional({ description: '用户ID（自定义铃声需要）' })
  @Column({ type: 'uuid', nullable: true, comment: '用户ID（自定义铃声需要）' })
  userId!: string | null;

  @ApiProperty({ description: '铃声名称' })
  @Column({ type: 'varchar', length: 100, comment: '铃声名称' })
  name!: string;

  @ApiProperty({ description: '铃声类型', enum: RingtoneType })
  @Column({
    type: 'enum',
    enum: Object.values(RingtoneType),
    default: RingtoneType.SYSTEM,
    comment: '铃声类型',
  })
  type!: RingtoneType;

  @ApiProperty({ description: '铃声分类', enum: RingtoneCategory })
  @Column({
    type: 'enum',
    enum: Object.values(RingtoneCategory),
    default: RingtoneCategory.DEFAULT,
    comment: '铃声分类',
  })
  category!: RingtoneCategory;

  @ApiProperty({ description: '音频文件URL' })
  @Column({ type: 'varchar', length: 512, comment: '音频文件URL' })
  fileUrl!: string;

  @ApiProperty({ description: '音频文件大小（字节）' })
  @Column({ type: 'int', comment: '音频文件大小(字节)' })
  fileSize!: number;

  @ApiProperty({ description: '音频时长（毫秒）' })
  @Column({ type: 'int', comment: '音频时长(毫秒)' })
  duration!: number;

  @ApiPropertyOptional({ description: '格式（mp3/wav/aac等）' })
  @Column({ type: 'varchar', length: 20, nullable: true, comment: '音频格式' })
  format!: string | null;

  @ApiPropertyOptional({ description: '采样率' })
  @Column({ type: 'int', nullable: true, comment: '采样率' })
  sampleRate!: number | null;

  @ApiPropertyOptional({ description: '比特率' })
  @Column({ type: 'int', nullable: true, comment: '比特率' })
  bitRate!: number | null;

  @ApiPropertyOptional({ description: '封面图URL' })
  @Column({ type: 'varchar', length: 512, nullable: true, comment: '封面图URL' })
  thumbnailUrl!: string | null;

  @ApiPropertyOptional({ description: '是否启用' })
  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  isActive!: boolean;

  @ApiPropertyOptional({ description: '播放次数统计' })
  @Column({ type: 'int', default: 0, comment: '播放次数' })
  playCount!: number;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
