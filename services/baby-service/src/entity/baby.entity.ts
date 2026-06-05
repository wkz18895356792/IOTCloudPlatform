import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { BabyGender, BabyStatus } from '@baby-monitor/shared-types';

@Entity('babies')
@Index(['userId'])
@Index(['status'])
@Index(['birthDate'])
export class Baby {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '用户ID' })
  userId!: string;

  @Column({ type: 'varchar', length: 128, comment: '宝宝姓名' })
  name!: string;

  @Column({
    type: 'enum',
    enum: BabyGender,
    comment: '性别',
  })
  gender!: BabyGender;

  @Column({ type: 'date', comment: '出生日期' })
  birthDate!: Date;

  @Column({ type: 'int', nullable: true, comment: '出生体重(克)' })
  birthWeight!: number;

  @Column({ type: 'int', nullable: true, comment: '出生身高(厘米)' })
  birthHeight!: number;

  @Column({ type: 'date', nullable: true, comment: '预产期' })
  dueDate!: Date;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '头像URL' })
  avatar!: string;

  @Column({
    type: 'enum',
    enum: BabyStatus,
    default: BabyStatus.ACTIVE,
    comment: '状态',
  })
  status!: BabyStatus;

  @Column({ type: 'json', nullable: true, comment: '关联设备ID列表' })
  deviceIds!: string[];

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
