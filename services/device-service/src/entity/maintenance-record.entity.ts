import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { MaintenanceType } from '@baby-monitor/shared-types';

@Entity('maintenance_records')
@Index(['deviceId'])
@Index(['performedAt'])
export class MaintenanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '设备ID' })
  deviceId!: string;

  @Column({
    type: 'enum',
    enum: MaintenanceType,
    comment: '维护类型',
  })
  type!: MaintenanceType;

  @Column({ type: 'varchar', length: 256, comment: '维护标题' })
  title!: string;

  @Column({ type: 'text', nullable: true, comment: '维护描述' })
  description!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, comment: '维护费用' })
  cost!: number;

  @Column({ type: 'timestamp', nullable: true, comment: '执行时间' })
  performedAt!: Date;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '执行人' })
  performedBy!: string;

  @Column({ type: 'timestamp', nullable: true, comment: '下次维护时间' })
  nextMaintenanceAt!: Date;

  @Column({ type: 'json', nullable: true, comment: '附件列表' })
  attachments!: string[];

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
