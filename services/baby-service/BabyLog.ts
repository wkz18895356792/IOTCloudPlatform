/*
 * @Author: 宝宝日志实体
 * @Date: 2025-11-05
 * @LastEditors: 张文可
 * @LastEditTime: 2025-11-17 14:15:32
 * @Description: 宝宝日志实体定义，记录宝宝活动和事件
 */
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { BabyLogEventType } from '../enum/device.enum';
import { ApiProperty } from '@midwayjs/swagger';

@Entity()
@Index(['deviceId', 'startTime'])
@Index(['deviceId', 'eventType'])
@Index(['babyId'])
export class BabyLog {
  @ApiProperty({ description: '日志ID' })
  @PrimaryGeneratedColumn({ unsigned: true, comment: '日志ID' })
  id: number;

  @ApiProperty({ description: '婴儿ID' })
  @Column({ type: 'int', unsigned: true, comment: '婴儿ID' })
  babyId: number;

  @ApiProperty({ description: '设备ID' })
  @Column({ type: 'varchar', length: 255, comment: '设备ID' })
  deviceId: string;

  @ApiProperty({ description: '事件唯一标识(UUID格式)，防止重复记录' })
  @Column({ type: 'varchar', length: 36, unique: true, comment: '事件唯一标识(UUID格式)' })
  eventId: string;

  @ApiProperty({ description: '事件类型：sleep-睡觉，diaper_change-换尿布，breast_feeding-哺乳，bottle_feeding-瓶喂，roll_over-翻身', enum: BabyLogEventType })
  @Column({ 
    type: 'enum', 
    enum: BabyLogEventType, 
    comment: '事件类型：sleep-睡觉，diaper_change-换尿布，breast_feeding-哺乳，bottle_feeding-瓶喂，roll_over-翻身' 
  })
  eventType: BabyLogEventType;

  @ApiProperty({ description: '事件开始UTC时间，ISO 8601格式(如: 2025-10-27T10:30:00Z)' })
  @Column({ type: 'datetime', comment: '事件开始UTC时间' })
  startTime: Date;

  @ApiProperty({ description: '事件结束时间，持续性事件(如睡觉)需要记录' })
  @Column({ type: 'datetime', nullable: true, comment: '事件结束时间' })
  endTime: Date;

  @ApiProperty({ description: '事件发生所在时区（如: Asia/Shanghai）' })
  @Column({ type: 'varchar', length: 50, nullable: true, comment: '事件发生所在时区' })
  timezone: string;

  @ApiProperty({ description: '事件持续时长，单位为秒' })
  @Column({ type: 'int', unsigned: true, nullable: true, comment: '事件持续时长(秒)' })
  duration: number;

  @ApiProperty({ description: '数据来源：1-用户手动添加，2-算法自动添加，默认1' })
  @Column({ type: 'tinyint', default: 1, comment: '数据来源：1-手动、 2-算法' })
  source: number;

  @ApiProperty({ description: 'S3视频文件存储路径(如: s3://bucket-name/video.avi)' })
  @Column({ type: 'varchar', length: 500, nullable: true, comment: 'S3视频文件存储路径' })
  videoPath: string;

  @ApiProperty({ description: '事件在视频中的时间偏移量，单位为秒，用于视频跳转定位' })
  @Column({ type: 'int', unsigned: true, nullable: true, comment: '视频时间偏移量(秒)' })
  videoTimestamp: number;

  @ApiProperty({ description: '算法识别置信度，取值范围 0-1，表示事件识别的可靠程度' })
  @Column({ type: 'decimal', precision: 3, scale: 2, default: 1, comment: '识别置信度(0-1)' })
  confidence: number;

  @ApiProperty({ description: '用户备注信息' })
  @Column({ type: 'varchar', length: 500, nullable: true, comment: '用户备注信息' })
  note: string;

  @ApiProperty({ description: '事件附加信息，根据不同事件类型存储特定属性' })
  @Column({ type: 'json', nullable: true, comment: '事件附加信息(JSON格式)' })
  metadata: Record<string, any>;

  @ApiProperty({ description: '记录创建UTC时间，ISO 8601格式，用于数据审计' })
  @CreateDateColumn({ comment: '记录创建UTC时间' })
  createdAt: Date;

  @ApiProperty({ description: '记录更新UTC时间' })
  @UpdateDateColumn({ comment: '记录更新UTC时间' })
  updatedAt: Date;
}
